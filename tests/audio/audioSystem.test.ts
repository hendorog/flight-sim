// AudioSystem builds its graph from a sound profile: the stem routes, the cabin resonances and the levels,
// and the 'config' message that sets the worklet's voices. Web Audio is replaced by recording stand-ins.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { C172S_AUDIO } from '../../src/aircraft/c172s/audio';
import { AudioSystem } from '../../src/audio';
import { PARAM_COUNT, STEM, STEM_COUNT } from '../../src/audio/params';
import { SYNTH_PROCESSOR_NAME } from '../../src/audio/synthSource';
import { createEventBus, type SimContext } from '../../src/core/context';
import { makeMockState } from '../../src/core/mockState';
import { defaultControls, defaultWeather } from '../../src/core/types';
import { variant } from './profiles';
import { DIESEL_AUDIO_TESTBED, TWIN_AUDIO_TESTBED } from './testbed';

interface Made {
  kind: string;
  opts: Record<string, unknown>;
  /** What it was connected to, with the output index given. */
  to: { node: Made; output: number | undefined }[];
  posted: unknown[];
  disconnected?: boolean;
}

let made: Made[] = [];

/** A Web Audio node (or the context's destination) that records how it was built and connected. */
function standIn(kind: string) {
  return class {
    readonly rec: Made;
    readonly port = { postMessage: (m: unknown) => void this.rec.posted.push(m) };
    constructor(_ac?: unknown, a?: unknown, b?: unknown) {
      // AudioWorkletNode(ac, name, options); every other node (ac, options).
      this.rec = { kind, opts: { ...((typeof a === 'string' ? b : a) as object), ...(typeof a === 'string' ? { name: a } : {}) }, to: [], posted: [] };
      made.push(this.rec);
      const param = { value: 0, setTargetAtTime: () => undefined, setValueAtTime: () => undefined, cancelScheduledValues: () => undefined, linearRampToValueAtTime: () => undefined };
      for (const name of ['gain', 'frequency', 'delayTime', 'pan']) Object.assign(this, { [name]: { ...param } });
    }
    connect(node: { rec: Made }, output?: number): unknown {
      this.rec.to.push({ node: node.rec, output });
      return node;
    }
    disconnect(): void {
      this.rec.to.length = 0;
      this.rec.disconnected = true;
    }
  };
}

class FakeContext {
  currentTime = 0;
  state = 'running';
  sampleRate = 48000;
  destination = new (standIn('destination'))();
  audioWorklet = { addModule: async () => undefined };
  addEventListener(): void {}
  resume = async () => undefined;
  suspend = async () => undefined;
  close = async () => undefined;
}

beforeEach(() => {
  made = [];
  vi.stubGlobal('window', { addEventListener: () => undefined, removeEventListener: () => undefined });
  vi.stubGlobal('AudioContext', FakeContext);
  vi.stubGlobal('AudioWorkletNode', standIn('worklet'));
  vi.stubGlobal('GainNode', standIn('gain'));
  vi.stubGlobal('BiquadFilterNode', standIn('biquad'));
  vi.stubGlobal('DelayNode', standIn('delay'));
  vi.stubGlobal('StereoPannerNode', standIn('pan'));
  vi.stubGlobal('DynamicsCompressorNode', standIn('limiter'));
});
afterEach(() => vi.unstubAllGlobals());

let events = createEventBus();

async function started(audio: AudioSystem): Promise<AudioSystem> {
  events = createEventBus();
  const ctx = {
    paused: false,
    events,
    state: makeMockState(),
    controls: defaultControls(),
    env: { surface: () => 'runway', atmosphere: () => ({ speedOfSound: 340 }) },
    weather: defaultWeather(),
  } as unknown as SimContext;
  audio.init(ctx);
  await audio.start();
  expect(audio.running).toBe(true);
  return audio;
}

const synth = (): Made => made.find((m) => m.kind === 'worklet')!;
/** The path of every stem connection: output index, the gain it enters, the filters after it, the sum it ends in. */
function routes(): { stem: number | undefined; gain: unknown; filters: Record<string, unknown>[]; sum: unknown }[] {
  return synth().to.map(({ node, output }) => {
    const filters: Record<string, unknown>[] = [];
    let at = node.to[0].node;
    while (at.kind === 'biquad') {
      filters.push(at.opts);
      at = at.to[0].node;
    }
    return { stem: output, gain: node.opts.gain, filters, sum: at.opts.gain };
  });
}
const biquads = (type: string): Record<string, unknown>[] => made.filter((m) => m.kind === 'biquad' && m.opts.type === type).map((m) => m.opts);

describe('AudioSystem graph', () => {
  it('without a profile it is the Cessna 172S graph, and the worklet is sent no config message', async () => {
    await started(new AudioSystem());
    expect(synth().opts).toMatchObject({ name: SYNTH_PROCESSOR_NAME, numberOfOutputs: STEM_COUNT });
    // Only parameter blocks reach the worklet: its built-in voices play.
    expect(synth().posted).toHaveLength(1);
    expect(synth().posted[0]).toBeInstanceOf(Float32Array);
    expect(synth().posted[0]).toHaveLength(PARAM_COUNT);

    const lowpass = (frequency: number) => ({ type: 'lowpass', frequency, Q: 0.6, gain: 0 });
    expect(routes()).toEqual([
      { stem: STEM.engine, gain: 0.9, filters: [lowpass(750)], sum: 0.7 },
      { stem: STEM.prop, gain: 0.6, filters: [lowpass(1100)], sum: 0.7 },
      { stem: STEM.airframe, gain: 0.35, filters: [lowpass(2200)], sum: 0.7 },
      { stem: STEM.cabin, gain: 1, filters: [], sum: 0.7 },
      { stem: STEM.engine, gain: 1, filters: [], sum: 1.2 },
      { stem: STEM.prop, gain: 1.1, filters: [], sum: 1.2 },
      { stem: STEM.airframe, gain: 0.25, filters: [], sum: 1.2 },
    ]);
    expect(biquads('peaking')).toEqual([
      { type: 'peaking', frequency: 105, Q: 1.2, gain: 6 },
      { type: 'peaking', frequency: 190, Q: 1.5, gain: 3 },
    ]);
    // Three stem low-passes and the air absorption of the exterior path: no filter on an unfiltered stem.
    expect(biquads('lowpass')).toHaveLength(4);
  });

  it('the Cessna 172S profile given by name builds the same graph, again without a config message', async () => {
    await started(new AudioSystem());
    const plain = { routes: routes(), nodes: made.map((m) => [m.kind, m.opts]) };
    made = [];
    await started(new AudioSystem({ profile: C172S_AUDIO }));
    expect({ routes: routes(), nodes: made.map((m) => [m.kind, m.opts]) }).toEqual(plain);
    expect(synth().posted).toHaveLength(1);
  });

  it('another profile is sent to the worklet ahead of the first parameters and shapes the mix', async () => {
    const profile = variant((p) => {
      p.engines[0].prop.blades = 3;
      p.busPoweredV = 10;
      p.cabin.routes = [
        { stem: STEM.engine, lowpassHz: 900, lowpassQ: 1.5, gain: 0.8 },
        { stem: STEM.prop, lowpassHz: 0, gain: 0.5 },
        { stem: STEM.cabin, lowpassHz: 0, gain: 1 },
      ];
      p.cabin.bus = [{ type: 'lowshelf', hz: 150, gainDb: 4, q: 0.7 }];
      p.cabin.level = 0.6;
      p.exterior.routes = [{ stem: STEM.engine, lowpassHz: 0, gain: 0.9 }];
      p.exterior.level = 1.1;
    });
    await started(new AudioSystem({ profile }));
    expect(synth().posted).toHaveLength(2);
    expect(synth().posted[0]).toEqual({ type: 'config', profile });
    expect(structuredClone(synth().posted[0])).toEqual({ type: 'config', profile });
    expect(synth().posted[1]).toBeInstanceOf(Float32Array);

    expect(routes()).toEqual([
      { stem: STEM.engine, gain: 0.8, filters: [{ type: 'lowpass', frequency: 900, Q: 1.5, gain: 0 }], sum: 0.6 },
      { stem: STEM.prop, gain: 0.5, filters: [], sum: 0.6 },
      { stem: STEM.cabin, gain: 1, filters: [], sum: 0.6 },
      { stem: STEM.engine, gain: 0.9, filters: [], sum: 1.1 },
    ]);
    expect(biquads('lowshelf')).toEqual([{ type: 'lowshelf', frequency: 150, Q: 0.7, gain: 4 }]);
    expect(biquads('peaking')).toEqual([]);
    expect(biquads('lowpass')).toHaveLength(2);
  });

  it('gear events become thump messages, a locking leg the loudest', async () => {
    await started(new AudioSystem({ profile: TWIN_AUDIO_TESTBED }));
    const before = synth().posted.length;
    events.emit('gear', { kind: 'unlock', leg: 0 });
    events.emit('gear', { kind: 'up', leg: 1 });
    events.emit('gear', { kind: 'downLocked', leg: 2 });
    expect(synth().posted.slice(before)).toEqual([
      { type: 'thump', amp: 0.4 },
      { type: 'thump', amp: 0.7 },
      { type: 'thump', amp: 1 },
    ]);
  });

  it('a two-engine profile is sent whole, and its parameter blocks carry both engines', async () => {
    await started(new AudioSystem({ profile: TWIN_AUDIO_TESTBED }));
    expect(synth().posted[0]).toEqual({ type: 'config', profile: TWIN_AUDIO_TESTBED });
    expect(structuredClone(synth().posted[0])).toEqual({ type: 'config', profile: TWIN_AUDIO_TESTBED });
    expect(synth().posted[1]).toHaveLength(PARAM_COUNT);
  });

  it('setProfile replaces the voices and both mix chains of a running graph, and is remembered before there is one', async () => {
    const audio = await started(new AudioSystem());
    const first = made.filter((m) => m.kind === 'gain' || m.kind === 'biquad');
    const stays = (kind: string): Made => made.find((m) => m.kind === kind)!;
    const [delay, limiter] = [stays('delay'), stays('limiter')];
    made = [synth()];
    const profile = variant((p) => {
      p.cabin.routes = [{ stem: STEM.engine, lowpassHz: 600, gain: 0.7 }, { stem: STEM.cabin, lowpassHz: 0, gain: 1 }];
      p.cabin.bus = [{ type: 'highshelf', hz: 3000, gainDb: -6, q: 0.7 }];
      p.cabin.level = 0.5;
      p.exterior.routes = [{ stem: STEM.prop, lowpassHz: 0, gain: 1.3 }];
      p.exterior.level = 0.9;
    });
    audio.setProfile(profile);
    // The worklet is told, and from now on the stems run through the new routes only.
    expect(synth().posted.at(-1)).toEqual({ type: 'config', profile });
    expect(routes()).toEqual([
      { stem: STEM.engine, gain: 0.7, filters: [{ type: 'lowpass', frequency: 600, Q: 0.6, gain: 0 }], sum: 0.5 },
      { stem: STEM.cabin, gain: 1, filters: [], sum: 0.5 },
      { stem: STEM.prop, gain: 1.3, filters: [], sum: 0.9 },
    ]);
    expect(biquads('highshelf')).toEqual([{ type: 'highshelf', frequency: 3000, Q: 0.7, gain: -6 }]);
    // Every node of the Cessna's mix (seven route gains, three low-passes, two sums, two resonances) is cut out;
    // the propagation chain and the master section stay as they were.
    const cut = first.filter((m) => m.disconnected);
    expect(cut).toHaveLength(14);
    expect(delay.disconnected).toBeUndefined();
    expect(limiter.disconnected).toBeUndefined();
    // The exterior sum of the new mix feeds the same delay line.
    expect(made.some((m) => m.kind === 'gain' && m.opts.gain === 0.9 && m.to[0]?.node === delay)).toBe(true);
    // The same profile again does nothing.
    const posted = synth().posted.length;
    audio.setProfile(profile);
    expect(synth().posted).toHaveLength(posted);

    made = [];
    const later = new AudioSystem();
    later.setProfile(DIESEL_AUDIO_TESTBED);
    await started(later);
    expect(synth().posted[0]).toEqual({ type: 'config', profile: DIESEL_AUDIO_TESTBED });
  });
});
