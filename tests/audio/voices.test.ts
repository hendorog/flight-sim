// The worklet's engine and propeller voices are built from a sound profile: the built-in one is the Cessna
// 172S, and a { type: 'config', profile } message rebuilds them for another type.

import { describe, expect, it } from 'vitest';
import { C172S_AUDIO } from '../../src/aircraft/c172s/audio';
import { STEM, STEM_COUNT, type SynthParamName } from '../../src/audio/params';
import { SYNTH_SOURCE } from '../../src/audio/synthSource';
import { variant } from './profiles';
import { BLOCK, rms, SR, SynthHost, toneMagnitude } from './workletHost';

const cruise = { rpm: 2400, firing: 1, load: 0.8, throttle: 0.8, propLoad: 1, tipMach: 0.76 };

/** Samples of the stems `a` that are not the same number in `b`. */
function differing(a: Float32Array[], b: Float32Array[]): number {
  let n = 0;
  for (let s = 0; s < a.length; s++) for (let i = 0; i < a[s].length; i++) if (!Object.is(a[s][i], b[s][i])) n++;
  return n;
}

/** A start, an idle with the flap motor, a slam to full power on a rolling aircraft, the horn, a chirp, a crash and a shut-down: 6 s. */
function flight(host: SynthHost): Float32Array[] {
  const steps: [number, Partial<Record<SynthParamName, number>>, unknown?][] = [
    [0, { starter: 1, rpm: 170, throttle: 0.1, gyro: 0.4, fan: 1, windLevel: 0.02, windFreq: 300, turbulence: 0.3 }],
    [0.6, { firing: 1, rpm: 750, load: 0.08, roughness: 0.5, propLoad: 0.1, tipMach: 0.2 }],
    [0.9, { starter: 0, roughness: 0, flapMotor: 1 }],
    [1.5, { flapMotor: 0, rpm: 2300, load: 1, throttle: 1, propLoad: 1.5, tipMach: 0.7 }],
    [2.2, { rolling: 0.7, rollSpeed: 18, windLevel: 0.4, windFreq: 450, slip: 0.3, brakeSqueal: 0.4 }],
    [3, { horn: 0.7, buffet: 0.4, flapNoise: 0.5, surface: 2, skid: 0.5 }, { type: 'chirp', amp: 1.2 }],
    [3.6, { horn: 0, buffet: 0, skid: 0, brakeSqueal: 0, surface: 1 }, { type: 'crash', amp: 1 }],
    [4.2, { firing: 0, load: 0, throttle: 0, roughness: 0.5 }],
    [4.6, { rpm: 300, tipMach: 0.01, rolling: 0, propLoad: 0 }],
  ];
  const blocks = (6 * SR) / BLOCK;
  const stems = Array.from({ length: STEM_COUNT }, () => new Float32Array(blocks * BLOCK));
  let next = 0;
  for (let b = 0; b < blocks; b++) {
    while (next < steps.length && steps[next][0] <= (b * BLOCK) / SR) {
      host.set(steps[next][1]);
      if (steps[next][2]) host.message(steps[next][2]);
      next++;
    }
    const out = host.block();
    for (let s = 0; s < STEM_COUNT; s++) stems[s].set(out[s], b * BLOCK);
  }
  return stems;
}

describe('synthesis worklet voices', () => {
  it('the built-in profile is the Cessna 172S profile', () => {
    const text = /^const DEFAULT_PROFILE = (.*);$/m.exec(SYNTH_SOURCE);
    expect(text).not.toBeNull();
    expect(JSON.parse(text![1])).toEqual(C172S_AUDIO);
  }, 60_000);

  it('a config message with the Cessna 172S profile changes no sample', () => {
    const builtIn = flight(new SynthHost());
    const configured = flight(new SynthHost(C172S_AUDIO));
    for (const s of builtIn) expect(rms(s)).toBeGreaterThan(0.01);
    expect(differing(configured, builtIn)).toBe(0);
  }, 60_000);

  it('the stem levels of the profile scale the voices', () => {
    const builtIn = new SynthHost().set(cruise).render(1);
    const half = new SynthHost(
      variant((p) => {
        p.engines[0].engine.level = 0.5;
        p.engines[0].prop.level = 0.25;
      }),
    )
      .set(cruise)
      .render(1);
    expect(half[STEM.engine]).toEqual(builtIn[STEM.engine].map((v) => v * 0.5));
    expect(half[STEM.prop]).toEqual(builtIn[STEM.prop].map((v) => v * 0.25));
    expect(differing([half[STEM.airframe], half[STEM.cabin]], [builtIn[STEM.airframe], builtIn[STEM.cabin]])).toBe(0);
  }, 60_000);

  it('the blade count sets the blade-passage tone of a direct-drive propeller', () => {
    // 2400 rpm: 40 rev/s, two blades 80 Hz, three blades 120 Hz.
    const two = new SynthHost().set(cruise).render(2)[STEM.prop].subarray(SR / 2);
    const three = new SynthHost(variant((p) => void (p.engines[0].prop.blades = 3))).set(cruise).render(2)[STEM.prop].subarray(SR / 2);
    expect(toneMagnitude(two, 80)).toBeGreaterThan(10 * toneMagnitude(two, 120));
    expect(toneMagnitude(three, 120)).toBeGreaterThan(10 * toneMagnitude(three, 80));
  }, 60_000);

  it('even cylinders lose the lumpy beat that the uneven ones of the Cessna give', () => {
    const even = variant((p) => {
      p.engines[0].engine.firingOffsets = [0, 0, 0, 0];
      p.engines[0].engine.cylGains = [0.87, 0.87, 0.87, 0.87];
    });
    // 2400 rpm: firing at 80 Hz. The four-cylinder pattern repeats every two revolutions (20 Hz and its odd
    // multiples such as 120 Hz); 40 Hz is left out, the once-per-revolution rumble sits there.
    const lumpy = new SynthHost().set(cruise).render(3)[STEM.engine].subarray(SR);
    const smooth = new SynthHost(even).set(cruise).render(3)[STEM.engine].subarray(SR);
    expect(toneMagnitude(smooth, 80) / toneMagnitude(lumpy, 80)).toBeGreaterThan(0.8);
    expect(toneMagnitude(smooth, 80) / toneMagnitude(lumpy, 80)).toBeLessThan(1.25);
    expect(toneMagnitude(smooth, 20)).toBeLessThan(0.2 * toneMagnitude(lumpy, 20));
    expect(toneMagnitude(smooth, 120)).toBeLessThan(0.2 * toneMagnitude(lumpy, 120));
  }, 60_000);

  it('the exhaust resonators and the idle lope are the profile\'s', () => {
    // One sharp resonator on the third firing harmonic (240 Hz at 2400 rpm) instead of the Cessna's three.
    const one = (hz: number) => variant((p) => void (p.engines[0].engine.exhaust = [{ hz, perRps: 0, perLoad: 0, q: 8, gain: 1.6 }]));
    const engine = (host: SynthHost): Float32Array => host.set(cruise).render(2)[STEM.engine].subarray(SR);
    const at240 = toneMagnitude(engine(new SynthHost(one(240))), 240);
    expect(at240).toBeGreaterThan(3 * toneMagnitude(engine(new SynthHost(one(480))), 240));
    expect(at240).toBeGreaterThan(3 * toneMagnitude(engine(new SynthHost()), 240));

    // Idle at 700 rpm: the Cessna's speed wanders (lope below 1100 rpm), which smears the firing line at
    // 23.33 Hz into its neighbourhood; with the lope switched off (0) the line stands alone.
    const idle = { rpm: 700, firing: 1, load: 0.05, throttle: 0.05 };
    const steady = variant((p) => void (p.engines[0].engine.idleLopeRpm = 0));
    const a = new SynthHost().set(idle).render(8)[STEM.engine].subarray(2 * SR);
    const b = new SynthHost(steady).set(idle).render(8)[STEM.engine].subarray(2 * SR);
    expect(toneMagnitude(b, 1400 / 60)).toBeGreaterThan(2 * toneMagnitude(a, 1400 / 60));
    expect(toneMagnitude(a, 23)).toBeGreaterThan(5 * toneMagnitude(b, 23));
  }, 60_000);

  it('the stall warner pitch is the profile\'s', () => {
    const builtIn = new SynthHost().set({ horn: 1 }).render(1)[STEM.cabin].subarray(SR / 2);
    const low = new SynthHost(variant((p) => void (p.stallWarner = { ...p.stallWarner, baseHz: 1000, sweepHz: 200 })))
      .set({ horn: 1 })
      .render(1)[STEM.cabin].subarray(SR / 2);
    expect(toneMagnitude(builtIn, 2800)).toBeGreaterThan(20 * toneMagnitude(builtIn, 1200));
    expect(toneMagnitude(low, 1200)).toBeGreaterThan(20 * toneMagnitude(low, 2800));
  }, 60_000);

  it('a config message in mid-flight restarts the voices without disturbing the other stems', () => {
    const plain = new SynthHost().set({ ...cruise, windLevel: 1, windFreq: 700, gyro: 1 });
    const switched = new SynthHost().set({ ...cruise, windLevel: 1, windFreq: 700, gyro: 1 });
    plain.render(0.5);
    switched.render(0.5);
    switched.message({ type: 'config', profile: variant((p) => void (p.engines[0].prop.blades = 3)) });
    const a = plain.render(1);
    const b = switched.render(1);
    expect(b[STEM.engine].every(Number.isFinite)).toBe(true);
    expect(toneMagnitude(b[STEM.prop].subarray(SR / 2), 120)).toBeGreaterThan(10 * toneMagnitude(b[STEM.prop].subarray(SR / 2), 80));
    // The gyro whine draws no noise: the cabin stem is untouched. The airframe shares the noise source with the engine.
    expect(differing([b[STEM.cabin]], [a[STEM.cabin]])).toBe(0);
  }, 60_000);
});
