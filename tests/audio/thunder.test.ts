// Thunder (audio/thunder.ts): the sound starts when the sound from the channel's nearest point arrives (d / c), lasts
// for the spread of arrivals over the channel plus the tail, is low-passed more with distance, pans toward the
// strike, and is absent beyond THUNDER_MAX_DISTANCE_M. scheduleThunder is checked against a recording AudioContext.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { AudioSystem } from '../../src/audio';
import { createEventBus, type SimContext } from '../../src/core/context';
import { makeMockState } from '../../src/core/mockState';
import { defaultControls, defaultWeather } from '../../src/core/types';
import {
  THUNDER_MAX_DISTANCE_M,
  THUNDER_MIN_S,
  THUNDER_TAIL_S,
  scheduleThunder,
  thunderCutoff,
  thunderPlan,
  type ThunderListener,
  type ThunderSource,
} from '../../src/audio/thunder';

const listener = (o: Partial<ThunderListener> = {}): ThunderListener => ({ north: 0, east: 0, altM: 120, rightNorth: 0, rightEast: 1, rightUp: 0, ...o });
const strike = (o: Partial<ThunderSource> = {}): ThunderSource => ({ id: 5, kind: 'cg', north: 3000, east: 4000, altM: 4500, energy: 1, strokes: 4, ...o });

describe('thunderPlan', () => {
  it('starts after the nearest point of the channel over the speed of sound', () => {
    const p = thunderPlan(strike(), listener(), 120, 340)!;
    // The listener is at the channel's ground height: the nearest point is the ground point, 5 km away.
    expect(p.nearM).toBeCloseTo(5000, 6);
    expect(p.delayS).toBeCloseTo(5000 / 340, 9);
    expect(p.farM).toBeCloseTo(Math.hypot(5000, 4500 - 120), 6);
    expect(p.durationS).toBeCloseTo(Math.max(THUNDER_MIN_S, (p.farM - p.nearM) / 340) + THUNDER_TAIL_S, 9);
  });

  it('measures an intracloud flash from its vertical channel', () => {
    const p = thunderPlan(strike({ kind: 'ic', north: 0, east: 0, altM: 6000 }), listener({ altM: 9000 }), 120, 330)!;
    expect(p.nearM).toBeCloseTo(9000 - 7500, 6);
  });

  it('is silent beyond THUNDER_MAX_DISTANCE_M', () => {
    expect(thunderPlan(strike({ north: THUNDER_MAX_DISTANCE_M + 10, east: 0 }), listener(), 120, 340)).toBeNull();
  });

  it('low-passes more and plays quieter with distance', () => {
    const near = thunderPlan(strike({ north: 800, east: 0 }), listener(), 120, 340)!;
    const far = thunderPlan(strike({ north: 12_000, east: 0 }), listener(), 120, 340)!;
    expect(far.cutoffHz).toBeLessThan(near.cutoffHz);
    expect(far.gain).toBeLessThan(near.gain);
    expect(thunderCutoff(1e6)).toBe(100);
    expect(thunderCutoff(10)).toBe(20_000);
  });

  it('pans toward the strike on the listener right axis', () => {
    expect(thunderPlan(strike({ north: 0, east: 3000 }), listener(), 120, 340)!.pan).toBeGreaterThan(0.3);
    expect(thunderPlan(strike({ north: 0, east: -3000 }), listener(), 120, 340)!.pan).toBeLessThan(-0.3);
  });
});

interface Call {
  node: string;
  method: string;
  args: unknown[];
}
let calls: Call[] = [];

function standIn(kind: string) {
  return class {
    constructor(_ac?: unknown, opts?: Record<string, unknown>) {
      calls.push({ node: kind, method: 'new', args: [opts] });
      const param = (name: string) => ({
        setValueAtTime: (...a: unknown[]) => void calls.push({ node: kind, method: `${name}.setValueAtTime`, args: a }),
        linearRampToValueAtTime: (...a: unknown[]) => void calls.push({ node: kind, method: `${name}.linearRamp`, args: a }),
        exponentialRampToValueAtTime: (...a: unknown[]) => void calls.push({ node: kind, method: `${name}.exponentialRamp`, args: a }),
        setTargetAtTime: () => undefined,
        cancelScheduledValues: () => undefined,
        value: 1,
      });
      for (const name of ['gain', 'frequency', 'delayTime', 'pan']) Object.assign(this, { [name]: param(name) });
      Object.assign(this, { port: { postMessage: () => undefined } });
    }
    connect<T>(n: T): T {
      return n;
    }
    start(t: number): void {
      calls.push({ node: kind, method: 'start', args: [t] });
    }
    stop(t?: number): void {
      calls.push({ node: kind, method: 'stop', args: [t] });
    }
    disconnect(): void {}
  };
}

beforeEach(() => {
  calls = [];
  vi.stubGlobal('AudioBufferSourceNode', standIn('source'));
  vi.stubGlobal('BiquadFilterNode', standIn('biquad'));
  vi.stubGlobal('GainNode', standIn('gain'));
  vi.stubGlobal('StereoPannerNode', standIn('pan'));
});
afterEach(() => vi.unstubAllGlobals());

const fakeContext = () =>
  ({
    sampleRate: 8000,
    currentTime: 12.5,
    createBuffer: (_c: number, n: number) => {
      const data = new Float32Array(n);
      return { getChannelData: () => data, length: n };
    },
  }) as unknown as BaseAudioContext;

describe('scheduleThunder', () => {
  it('starts the source d / c after the strike, within 1 ms', () => {
    const plan = thunderPlan(strike(), listener(), 120, 343)!;
    const ac = fakeContext();
    const s = scheduleThunder(ac, {} as AudioNode, plan, 12.5, false);
    const start = calls.find((c) => c.node === 'source' && c.method === 'start')!;
    expect(Math.abs((start.args[0] as number) - (12.5 + 5000 / 343))).toBeLessThan(1e-3);
    expect(s.startAt).toBeCloseTo(12.5 + 5000 / 343, 9);
    const stop = calls.find((c) => c.node === 'source' && c.method === 'stop')!;
    expect(stop.args[0] as number).toBeCloseTo(s.endAt + 0.01, 9);
  });

  it('adds the cabin low-pass in cockpit view', () => {
    const plan = thunderPlan(strike(), listener(), 120, 343)!;
    scheduleThunder(fakeContext(), {} as AudioNode, plan, 0, false);
    const outside = calls.filter((c) => c.node === 'biquad' && c.method === 'new').length;
    calls = [];
    scheduleThunder(fakeContext(), {} as AudioNode, plan, 0, true);
    expect(calls.filter((c) => c.node === 'biquad' && c.method === 'new').length).toBe(outside + 1);
  });
});

class FakeAudioContext {
  currentTime = 40;
  state = 'running';
  sampleRate = 8000;
  destination = {};
  audioWorklet = { addModule: async () => undefined };
  addEventListener(): void {}
  resume = async () => undefined;
  suspend = async () => undefined;
  close = async () => undefined;
  createBuffer(_c: number, n: number) {
    const data = new Float32Array(n);
    return { getChannelData: () => data, length: n };
  }
}

describe('AudioSystem thunder', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { addEventListener: () => undefined, removeEventListener: () => undefined });
    vi.stubGlobal('AudioContext', FakeAudioContext);
    vi.stubGlobal('AudioWorkletNode', standIn('worklet'));
    vi.stubGlobal('DelayNode', standIn('delay'));
    vi.stubGlobal('DynamicsCompressorNode', standIn('limiter'));
  });

  async function started() {
    const events = createEventBus();
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 120, 0);
    const ctx = {
      paused: false,
      events,
      camera,
      cameraMode: 'chase',
      state: makeMockState(),
      controls: defaultControls(),
      env: { surface: () => 'runway', atmosphere: () => ({ speedOfSound: 340 }), groundElevation: () => 120 },
      weather: defaultWeather(),
    } as unknown as SimContext;
    const audio = new AudioSystem();
    audio.init(ctx);
    await audio.start();
    return { audio, events };
  }

  it('schedules the thunder of a lightning event d / c after it, and a reset stops it', async () => {
    const { events } = await started();
    calls = [];
    events.emit('lightning', { id: 3, kind: 'cg', north: 3000, east: 4000, altM: 4500, energy: 1, strokes: 3 });
    const start = calls.find((c) => c.node === 'source' && c.method === 'start')!;
    expect(Math.abs((start.args[0] as number) - (40 + 5000 / 340))).toBeLessThan(1e-3);
    calls = [];
    events.emit('reset', { scenario: 'runway' });
    expect(calls.some((c) => c.node === 'source' && c.method === 'stop')).toBe(true);
  });

  it('makes no sound for a strike beyond THUNDER_MAX_DISTANCE_M', async () => {
    const { events } = await started();
    calls = [];
    events.emit('lightning', { id: 4, kind: 'ic', north: 30_000, east: 0, altM: 6000, energy: 1, strokes: 3 });
    expect(calls.some((c) => c.node === 'source')).toBe(false);
  });
});
