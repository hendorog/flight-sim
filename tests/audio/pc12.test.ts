// The Pilatus PC-12/47's sound (src/aircraft/pc12/audio.ts): the PT6A-67B's whine on its gas-generator speed, its
// heavier roar, the four-blade propeller at 1700 rpm (113 Hz) and its growl, the reverse growl, the igniters, the
// stick shaker, the overspeed clacker, the CAWS chimes, and the mapping from the state that keys them.

import { describe, expect, it } from 'vitest';
import { C208_AUDIO } from '../../src/aircraft/c208/audio';
import { PC12_AUDIO, REVERSE_PITCH_DEG } from '../../src/aircraft/pc12/audio';
import { PC12_BUS_DEAD_VOLTS, PC12_GEAR_RATIO, PC12_NG_100_RPM, PC12_NG_MAX, PC12_NP_GOVERNED, PC12_OVERSPEED, PT6A_67B_RATED_W } from '../../src/aircraft/pc12/facts';
import { PC12_PROP, PC12_WING } from '../../src/aircraft/pc12/geometry';
import { fillSynthParams, makeParamBlock, overspeedWarning, reverseGrowl, SPEED_OF_SOUND, type SoundContext } from '../../src/audio/mapping';
import { P, STEM } from '../../src/audio/params';
import type { AudioProfile } from '../../src/audio/profile';
import { DEG, KT } from '../../src/core/math';
import { makeMockState } from '../../src/core/mockState';
import { defaultControls } from '../../src/core/types';
import { biquad, dbfs, exteriorMix, interiorMix } from './mixModel';
import { envelope, maxStep, peak, rms, SR, SynthHost, toneMagnitude } from './workletHost';

const ENGINE = PC12_AUDIO.engines[0].engine;
const TURBINE = ENGINE.turbine!;
const PROP = PC12_AUDIO.engines[0].prop;
const ng = (fraction: number): number => fraction * PC12_NG_100_RPM;
const shaftHz = (fraction: number): number => ng(fraction) / 60;
/** Static take-off: 100 % Ng, 1700 rpm, tip Mach 0.70 standing still. */
const TAKE_OFF = { rpm: ng(1), firing: 1, load: 1, propRpm: 1700, tipMach: 0.7, propLoad: 1.6 };
/** Full reverse on the ground: the cam has the gas generator at about 85 % Ng, the governor holds 1650 rpm (47E-PROXY). */
const REVERSE = { rpm: ng(0.85), firing: 1, load: 0.6, propRpm: 1650, tipMach: 0.68, propLoad: 1.2 };
const band = (x: Float32Array, lo: number, hi: number): Float32Array => biquad(biquad(x, { type: 'highpass', frequency: lo, Q: 0 }), { type: 'lowpass', frequency: hi, Q: 0 });
const stems = (profile: AudioProfile, params: Record<string, number>, seconds = 3): Float32Array[] =>
  new SynthHost(profile).set(params).render(seconds).map((x) => x.subarray(SR));
/** Times (s) at which the loudness (`window` s windows) jumps by more than a third of its maximum within two windows: strikes. */
function strikes(x: Float32Array, window = 0.005): number[] {
  const env = envelope(x, window);
  const jump = Math.max(...env) / 3;
  const at: number[] = [];
  for (let w = 0; w < env.length; w++) if (env[w] - (w >= 2 ? env[w - 2] : 0) > jump && (at.length === 0 || w * window - at[at.length - 1] > 0.05)) at.push(w * window);
  return at;
}
/** Times (s) at which the loudness (`window` s windows) rises through half of its maximum. */
function onsets(x: Float32Array, window = 0.005): number[] {
  const env = envelope(x, window);
  const half = 0.5 * Math.max(...env);
  const at: number[] = [];
  for (let w = 0; w < env.length; w++) if ((w === 0 || env[w - 1] < half) && env[w] >= half) at.push(w * window);
  return at;
}

describe('PC12_AUDIO', () => {
  it('takes its numbers from facts.ts and geometry.ts', () => {
    expect(PC12_AUDIO.engines).toHaveLength(1);
    expect(ENGINE.combustion).toBe('turbine');
    expect(TURBINE.ngRpm).toBe(PC12_NG_100_RPM);
    expect(ENGINE.ratedPowerW).toBe(PT6A_67B_RATED_W);
    expect(ENGINE.gearRatio).toBe(PC12_GEAR_RATIO);
    expect(ENGINE.gearRatio).toBeCloseTo(29_894 / 1700, 9);
    expect(PROP.blades).toBe(4);
    expect(PROP.blades).toBe(PC12_PROP.blades);
    expect(PROP.diameterM).toBe(PC12_PROP.diameter);
    expect(PROP.reverse?.fullPitchDeg).toBe(REVERSE_PITCH_DEG);
    expect(REVERSE_PITCH_DEG).toBe(-17.5);
    expect(PC12_AUDIO.busPoweredV).toBe(PC12_BUS_DEAD_VOLTS);
    expect(PC12_AUDIO.flapMaxRad).toBeCloseTo(40 * DEG, 12);
    expect(PC12_AUDIO.flapMaxRad).toBe(PC12_WING.flap.detentsDeg[3] * DEG);
    expect(PC12_AUDIO.overspeedWarning).toMatchObject(PC12_OVERSPEED);
    expect(PC12_AUDIO.gear).not.toBeNull();
    expect(PC12_AUDIO.flapMotor).toBe(true);
    expect(PC12_AUDIO.stallWarner.kind).toBe('none');
    // 4 x 1700 / 60 = 113.3 Hz blade passage.
    expect((PROP.blades * PC12_NP_GOVERNED) / 60).toBeCloseTo(113.33, 2);
    // Every tone of the whine below the band a 44.1 kHz context carries, at the 104 % Ng limit.
    for (const t of TURBINE.tones) expect(t.order * shaftHz(PC12_NG_MAX)).toBeLessThan(0.45 * 44_100);
  });

  it('is plain data (structuredClone and JSON)', () => {
    expect(structuredClone(PC12_AUDIO)).toEqual(PC12_AUDIO);
    expect(JSON.parse(JSON.stringify(PC12_AUDIO))).toEqual(PC12_AUDIO);
  });
});

describe('PT6A-67B voice', () => {
  it('whines on its gas-generator speed: the compressor at 5 x 624.5 Hz and the fourth stage at 7 x', () => {
    // Ground idle (55 % Ng, the burner at about a sixth) and 100 % at take-off load.
    for (const [fraction, load] of [[0.55, 0.15], [1, 1]]) {
      const x = stems(PC12_AUDIO, { rpm: ng(fraction), firing: 1, load })[STEM.engine];
      for (const order of [5, 7]) {
        const f = order * shaftHz(fraction);
        expect(toneMagnitude(x, f), `${fraction} ${order}`).toBeGreaterThan(20 * toneMagnitude(x, 1.03 * f));
      }
    }
    expect(5 * shaftHz(1)).toBeCloseTo(3122.3, 1);
    expect(7 * shaftHz(1)).toBeCloseTo(4371.3, 1);
  }, 60_000);

  it('roars louder than the Caravan\'s PT6A-114A at take-off power (outside, the engine alone)', () => {
    const pc12 = rms(stems(PC12_AUDIO, TAKE_OFF)[STEM.engine]);
    const c208 = rms(stems(C208_AUDIO, { ...TAKE_OFF, rpm: 37_500, propRpm: 1900 })[STEM.engine]);
    const louder = dbfs(pc12) - dbfs(c208);
    expect(louder).toBeGreaterThan(1);
    expect(louder).toBeLessThan(4);
  }, 60_000);

  it('the igniters snap 2.5 times a second while the starter turns the spool, and not without the parameter', () => {
    const start = { rpm: ng(0.12), starter: 1, firing: 0, load: 0 };
    const crack = (x: Float32Array): Float32Array => band(x, 2500, 6000);
    const on = new SynthHost(PC12_AUDIO).set({ ...start, ignitor: 1 }).render(4)[STEM.engine].subarray(SR);
    const off = new SynthHost(PC12_AUDIO).set(start).render(4)[STEM.engine].subarray(SR);
    const snaps = onsets(crack(on), 0.01);
    expect(snaps.length).toBeGreaterThanOrEqual(7);
    expect(snaps.length).toBeLessThanOrEqual(8);
    expect(peak(crack(on))).toBeGreaterThan(3 * peak(crack(off)));
  }, 60_000);
});

describe('propeller: drone, growl and reverse', () => {
  it('drones at four times 1700 rpm, 113.3 Hz, and dominates the cockpit at take-off power', () => {
    const s = stems(PC12_AUDIO, TAKE_OFF);
    const prop = s[STEM.prop];
    expect(toneMagnitude(prop, 113.33)).toBeGreaterThan(20 * toneMagnitude(prop, 119));
    expect(toneMagnitude(prop, 226.67)).toBeGreaterThan(10 * toneMagnitude(prop, 215));
    const silent = prop.map(() => 0);
    const propInside = rms(interiorMix([silent, prop, silent, silent], PC12_AUDIO));
    const engineInside = rms(interiorMix([s[STEM.engine], silent, silent, silent], PC12_AUDIO));
    expect(dbfs(propInside) - dbfs(engineInside)).toBeGreaterThan(6);
  }, 60_000);

  it('reverse: a roar under the drone, beaten at the blade passage, growing with the reverse parameter', () => {
    const plain = stems(PC12_AUDIO, { ...REVERSE, reverse: 0 })[STEM.prop];
    const half = stems(PC12_AUDIO, { ...REVERSE, reverse: 0.4 })[STEM.prop];
    const full = stems(PC12_AUDIO, { ...REVERSE, reverse: 1.2 })[STEM.prop];
    const roar = (x: Float32Array): number => dbfs(rms(band(x, 150, 1500)));
    const rise = roar(full) - roar(plain);
    expect(rise).toBeGreaterThan(6);
    // The growl is added on top of the same drone (its noise source is its own): the difference is the growl alone,
    // about in proportion to the parameter (0.4 against 1.2: -9.5 dB; a little more, its upper band weaker and its
    // bands lower at 0.4).
    const growl = (x: Float32Array): Float32Array => x.map((v, i) => v - plain[i]);
    const ratio = dbfs(rms(growl(half))) - dbfs(rms(growl(full)));
    expect(ratio).toBeGreaterThan(-13);
    expect(ratio).toBeLessThan(-8);
    expect(roar(half)).toBeGreaterThan(roar(plain) + 0.5);
    expect(roar(half)).toBeLessThan(roar(full) - 2);
    // Beaten at the blade passage: the loudness of the roar band (2 ms windows) has a line at 113 Hz... at 1650 rpm, 110 Hz.
    const env = envelope(band(full, 150, 1500), 0.002);
    const bp = (4 * 1650) / 60;
    expect(toneMagnitude(env, bp, 500)).toBeGreaterThan(3 * toneMagnitude(env, bp * 1.37, 500));
    // Inside, the reverse is the loudest thing: louder than the take-off drone, short of clipping.
    const inside = dbfs(rms(interiorMix(new SynthHost(PC12_AUDIO).set({ ...REVERSE, reverse: 1.2 }).render(3), PC12_AUDIO), SR));
    const takeoff = dbfs(rms(interiorMix(new SynthHost(PC12_AUDIO).set(TAKE_OFF).render(3), PC12_AUDIO), SR));
    expect(inside).toBeGreaterThan(takeoff - 1);
    expect(inside).toBeLessThan(-7);
  }, 90_000);

  it('reverse 0 leaves every sample as a profile without reverse plays it', () => {
    const withoutReverse: AudioProfile = { ...PC12_AUDIO, engines: [{ engine: ENGINE, prop: { ...PROP, reverse: undefined } }] };
    const a = new SynthHost(PC12_AUDIO).set(TAKE_OFF).render(1)[STEM.prop];
    const b = new SynthHost(withoutReverse).set(TAKE_OFF).render(1)[STEM.prop];
    expect(rms(a)).toBeGreaterThan(0.01);
    expect(Array.from(a)).toEqual(Array.from(b));
  }, 30_000);
});

describe('PC-12 mix', () => {
  it('take-off power on the ground sits in the cockpit window of the C172S (-17 .. -9 dBFS); nothing clips', () => {
    const all = new SynthHost(PC12_AUDIO).set(TAKE_OFF).render(4);
    const inside = interiorMix(all, PC12_AUDIO);
    const level = dbfs(rms(inside, SR));
    expect(level).toBeGreaterThan(-17);
    expect(level).toBeLessThan(-9);
    expect(dbfs(peak(inside.subarray(SR)))).toBeLessThan(-2);
    const outside = exteriorMix(all, 15, PC12_AUDIO);
    expect(dbfs(peak(outside.subarray(SR)))).toBeLessThan(-1);
  }, 30_000);
});

describe('warnings in the cabin', () => {
  it('stick shaker: a rattle knocking twice a turn of its 22 Hz weight, spinning up in a tenth of a second', () => {
    const host = new SynthHost(PC12_AUDIO);
    const before = host.render(0.5)[STEM.cabin];
    expect(peak(before)).toBe(0);
    const on = host.set({ shaker: 1 }).render(2)[STEM.cabin];
    const steady = on.subarray(SR / 2);
    expect(rms(steady)).toBeGreaterThan(0.02);
    // The knocks: 44 a second.
    const env = envelope(band(steady, 800, 3000), 0.002);
    expect(toneMagnitude(env, 44, 500)).toBeGreaterThan(4 * toneMagnitude(env, 31, 500));
    // Spins up: the first 50 ms are quieter than the steady rattle; no click at switch-on.
    expect(rms(on, 0, 0.05 * SR)).toBeLessThan(0.7 * rms(steady));
    expect(maxStep(on, 1, 0.02 * SR)).toBeLessThan(maxStep(steady) + 1e-6);
    // And runs down after it stops.
    const off = host.set({ shaker: 0 }).render(1.5)[STEM.cabin];
    expect(rms(off, SR)).toBeLessThan(1e-3 * rms(steady));
  }, 30_000);

  it('overspeed clacker: 8 strokes a second while it sounds, nothing before', () => {
    const host = new SynthHost(PC12_AUDIO);
    expect(peak(host.render(0.3)[STEM.cabin])).toBe(0);
    const on = host.set({ overspeed: 1 }).render(2)[STEM.cabin];
    const strokes = onsets(on, 0.005);
    expect(strokes.length).toBeGreaterThanOrEqual(15);
    expect(strokes.length).toBeLessThanOrEqual(17);
    expect(strokes[2] - strokes[1]).toBeCloseTo(0.125, 1);
    expect(dbfs(peak(on))).toBeLessThan(-3);
  }, 30_000);

  it('CAWS: a warning is a triple chime, a caution a single one; a profile without CAWS ignores the message', () => {
    const chimes = (level: string, profile: AudioProfile = PC12_AUDIO): Float32Array => {
      const host = new SynthHost(profile);
      host.render(0.1);
      host.message({ type: 'caws', level });
      return host.render(2)[STEM.cabin];
    };
    const warning = chimes('warning');
    const caution = chimes('caution');
    const w = strikes(warning);
    expect(w).toHaveLength(3);
    expect(w[1] - w[0]).toBeCloseTo(0.24, 1);
    expect(strikes(caution)).toHaveLength(1);
    expect(toneMagnitude(caution.subarray(0, SR / 2), 1047)).toBeGreaterThan(10 * toneMagnitude(caution.subarray(0, SR / 2), 1150));
    expect(dbfs(peak(warning))).toBeLessThan(-3);
    expect(peak(chimes('warning', C208_AUDIO))).toBe(0);
  }, 30_000);
});

describe('warnings heard over take-off power', () => {
  it('shaker, clacker, CAWS warning and gear horn each reach the cockpit within 10 dB of the take-off level', () => {
    const background = dbfs(rms(interiorMix(new SynthHost(PC12_AUDIO).set(TAKE_OFF).render(3), PC12_AUDIO), SR));
    const silent = new Float32Array(3 * SR);
    const alone = (params: Record<string, number>, message?: unknown): number => {
      const host = new SynthHost(PC12_AUDIO).set(params);
      if (message) host.message(message);
      return dbfs(rms(interiorMix([silent, silent, silent, host.render(3)[STEM.cabin]], PC12_AUDIO), 0, 2 * SR));
    };
    const levels = {
      shaker: alone({ shaker: 1 }),
      clacker: alone({ overspeed: 1 }),
      warning: alone({}, { type: 'caws', level: 'warning' }),
      gearHorn: alone({ gearHorn: 1 }),
    };
    for (const [name, level] of Object.entries(levels)) {
      expect(level, name).toBeGreaterThan(background - 10);
      expect(level, name).toBeLessThan(background);
    }
  }, 60_000);
});

describe('PC-12 mapping', () => {
  const sound = (): SoundContext => ({ surface: 'runway', speedOfSound: SPEED_OF_SOUND, turbulence: 0, gyroSpin: 0, flapMotor: 0 });
  const fill = (edit: (s: ReturnType<typeof makeMockState>) => void, starter = false, volts = 28): Float32Array => {
    const s = makeMockState();
    s.electrical.busVoltage = volts;
    edit(s);
    const c = defaultControls();
    c.masterBattery = true;
    c.starter = starter;
    return fillSynthParams(s, c, sound(), makeParamBlock(), PC12_AUDIO);
  };

  it('reverse growl: blades below flat and reverse thrust; nothing at flat pitch, in beta above it, or in forward thrust', () => {
    const full = REVERSE_PITCH_DEG * DEG;
    expect(reverseGrowl(full, -PROP.cruiseThrustN, PROP)).toBeCloseTo(1.2, 9);
    expect(reverseGrowl(full / 2, -PROP.cruiseThrustN / 2, PROP)).toBeCloseTo(0.5 * 0.7, 9);
    expect(reverseGrowl(full, -10 * PROP.cruiseThrustN, PROP)).toBe(1.5);
    expect(reverseGrowl(0, -PROP.cruiseThrustN, PROP)).toBe(0);
    expect(reverseGrowl(5 * DEG, 0, PROP)).toBe(0);
    expect(reverseGrowl(full, 0, PROP)).toBeCloseTo(0.2, 9);
    expect(reverseGrowl(full, -PROP.cruiseThrustN, C208_AUDIO.engines[0].prop)).toBe(0);
    const out = fill((s) => Object.assign(s.propeller, { bladePitch: full, thrust: -4000, rpm: 1650, beta: true }));
    expect(out[P.reverse]).toBe(Math.fround(reverseGrowl(full, -4000, PROP)));
  });

  it('shaker on AircraftState.stickShaker with the bus alive', () => {
    expect(fill((s) => (s.stickShaker = true))[P.shaker]).toBe(1);
    expect(fill((s) => (s.stickShaker = false))[P.shaker]).toBe(0);
    expect(fill(() => undefined)[P.shaker]).toBe(0);
    expect(fill((s) => (s.stickShaker = true), false, PC12_BUS_DEAD_VOLTS)[P.shaker]).toBe(0);
  });

  it('overspeed clacker above 236 KIAS or Mach 0.48, with the bus alive', () => {
    expect(overspeedWarning(237 * KT, 0.4, PC12_OVERSPEED)).toBe(true);
    expect(overspeedWarning(235 * KT, 0.4, PC12_OVERSPEED)).toBe(false);
    expect(overspeedWarning(200 * KT, 0.49, PC12_OVERSPEED)).toBe(true);
    expect(fill((s) => Object.assign(s, { ias: 240 * KT, mach: 0.4 }))[P.overspeed]).toBe(1);
    expect(fill((s) => Object.assign(s, { ias: 220 * KT, mach: 0.47 }))[P.overspeed]).toBe(0);
    expect(fill((s) => Object.assign(s, { ias: 220 * KT, mach: 0.485 }))[P.overspeed]).toBe(1);
    expect(fill((s) => Object.assign(s, { ias: 240 * KT, mach: 0.4 }), false, 12)[P.overspeed]).toBe(0);
  });

  it('igniters with the starter, no stall horn on the stall warning, gear warning and pump from the gear state', () => {
    expect(fill(() => undefined, true)[P.ignitor]).toBe(1);
    expect(fill(() => undefined, false)[P.ignitor]).toBe(0);
    expect(fill((s) => Object.assign(s, { stallWarning: true, alpha: 16 * DEG, ias: 40 }))[P.horn]).toBe(0);
    const out = fill((s) => (s.gear = { retractable: true, lever: 'up', extension: [0.4, 0.4, 0.4], locked: [false, false, false], inTransit: true, warning: true }));
    expect([out[P.gearPump], out[P.gearHorn]]).toEqual([1, 1]);
    // A fixed-wing type has no tail rotor.
    expect([out[P.tailRpm], out[P.tailLoad], out[P.tailTipMach]]).toEqual([0, 0, 0]);
  });
});
