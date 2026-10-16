// The MD 500E's sound (src/aircraft/md500/audio.ts), the first turbine helicopter voice: the 250-C20B's whine on N1,
// the five-blade main rotor at 492 rpm (41 Hz) through the propeller voice, the two-blade tail rotor at about
// 2930 rpm (98 Hz) on its own channel with its slap, the transmission's mesh, the igniters, the ENGINE OUT horn; and
// the mapping from a rotorcraft state (RotorcraftState.turboshaft, tailThrust) to the parameters.

import { describe, expect, it } from 'vitest';
import { MD500_AUDIO } from '../../src/aircraft/md500/audio';
import { MD500_BUS_DEAD_VOLTS, MD500_ENGINE_RATED_W, MD500_GENERATOR_PAD_RATIO, MD500_N1_100_RPM, MD500_NR_NOMINAL, MD500_TAIL_RATIO } from '../../src/aircraft/md500/facts';
import { MD500_ROTORCRAFT as rotor } from '../../src/aircraft/md500/rotorcraft';
import { S269_AUDIO } from '../../src/aircraft/s269/audio';
import { fillSynthParams, makeParamBlock, SPEED_OF_SOUND, tailRotorSound, warningHornOn, type SoundContext } from '../../src/audio/mapping';
import { P, STEM } from '../../src/audio/params';
import type { AudioProfile } from '../../src/audio/profile';
import { makeMockState } from '../../src/core/mockState';
import { defaultControls, type AircraftState } from '../../src/core/types';
import { emptyRotorcraftState, type RotorcraftState } from '../../src/physics/rotorcraft/definition';
import { biquad, dbfs, exteriorMix, interiorMix } from './mixModel';
import { peak, rms, SR, SynthHost, toneMagnitude } from './workletHost';

const ENGINE = MD500_AUDIO.engines[0].engine;
const TURBINE = ENGINE.turbine!;
const ROTOR = MD500_AUDIO.engines[0].prop;
const TAIL = MD500_AUDIO.tailRotor!;
const n1 = (fraction: number): number => fraction * MD500_N1_100_RPM;
const shaftHz = (fraction: number): number => n1(fraction) / 60;
/** The tail rotor at 492 rpm Nr with the 500E's ratio (5.96; facts.ts, ESTIMATE): 2933 rpm. */
const TAIL_RPM = MD500_NR_NOMINAL * MD500_TAIL_RATIO;
const tail = (load: number): Record<string, number> => ({ tailRpm: TAIL_RPM, tailLoad: load, tailTipMach: 0.63 });
/** Hover at about 2700 lb: N1 88 %, Nr 492, tip Mach 0.61, both rotors at their hover thrust. */
const HOVER = { rpm: n1(0.88), firing: 1, load: 0.75, propRpm: MD500_NR_NOMINAL, tipMach: 0.61, propLoad: 1, ...tail(1) };
const band = (x: Float32Array, lo: number, hi: number): Float32Array => biquad(biquad(x, { type: 'highpass', frequency: lo, Q: 0 }), { type: 'lowpass', frequency: hi, Q: 0 });
const stems = (params: Record<string, number>, seconds = 3, profile: AudioProfile = MD500_AUDIO): Float32Array[] =>
  new SynthHost(profile).set(params).render(seconds).map((x) => x.subarray(SR));

describe('MD500_AUDIO', () => {
  it('is a turbine on the rotor drive, with the numbers of facts.ts and the rotor definition', () => {
    expect(MD500_AUDIO.engines).toHaveLength(1);
    expect(ENGINE.combustion).toBe('turbine');
    expect(TURBINE.ngRpm).toBe(MD500_N1_100_RPM);
    expect(ENGINE.ratedPowerW).toBe(MD500_ENGINE_RATED_W);
    // The consistency check ties the drive ratio to the rotor definition (T2 sets it to MD500_ENGINE_RATIO, 12.594).
    expect(ENGINE.gearRatio).toBe(rotor.engineRatio);
    expect(TURBINE.starter.perNgRev).toBeCloseTo(MD500_GENERATOR_PAD_RATIO * 24, 12);
    expect(ROTOR.blades).toBe(5);
    expect(ROTOR.blades).toBe(rotor.main.blades);
    expect(ROTOR.diameterM).toBe(rotor.main.radius * 2);
    expect(TAIL.blades).toBe(rotor.tail.blades);
    expect(TAIL.blades).toBe(2);
    expect(TAIL.diameterM).toBe(rotor.tail.radius * 2);
    expect(TAIL.ratio).toBe(rotor.tailRatio);
    expect(MD500_AUDIO.busPoweredV).toBe(MD500_BUS_DEAD_VOLTS);
    expect(MD500_AUDIO.gear).toBeNull();
    expect(MD500_AUDIO.flapMotor).toBe(false);
    expect(MD500_AUDIO.stallWarner.kind).toBe('electric');
    // Blade passages: 5 x 492 / 60 = 41 Hz; 2 x 2933 / 60 = 97.8 Hz.
    expect((ROTOR.blades * MD500_NR_NOMINAL) / 60).toBeCloseTo(41, 6);
    expect((TAIL.blades * TAIL_RPM) / 60).toBeCloseTo(97.77, 2);
    for (const t of TURBINE.tones) expect(t.order * shaftHz(1.06)).toBeLessThan(0.45 * 44_100);
  });

  it('is plain data (structuredClone and JSON)', () => {
    expect(structuredClone(MD500_AUDIO)).toEqual(MD500_AUDIO);
    expect(JSON.parse(JSON.stringify(MD500_AUDIO))).toEqual(MD500_AUDIO);
  });
});

describe('250-C20B voice', () => {
  it('whines on N1: the compressor tone at 6 x 849.5 Hz (5.1 kHz at 100 %), at ground idle and in the hover', () => {
    for (const [fraction, load] of [[0.645, 0.15], [0.88, 0.75], [1, 1]]) {
      const x = stems({ rpm: n1(fraction), firing: 1, load })[STEM.engine];
      const f = 6 * shaftHz(fraction);
      expect(toneMagnitude(x, f), `${fraction}`).toBeGreaterThan(20 * toneMagnitude(x, 1.03 * f));
    }
    expect(6 * shaftHz(1)).toBeCloseTo(5097, 0);
  }, 60_000);

  it('the main transmission meshes at 166 x the rotor rate (1.36 kHz at 492 rpm), audible at rotor speed', () => {
    const x = stems({ rpm: n1(0.88), firing: 1, load: 0.75, propRpm: MD500_NR_NOMINAL })[STEM.engine];
    const f = (166 * MD500_NR_NOMINAL) / 60;
    expect(toneMagnitude(x, f)).toBeGreaterThan(10 * toneMagnitude(x, 1.04 * f));
  }, 30_000);

  it('the igniters snap four times a second through the start', () => {
    const x = new SynthHost(MD500_AUDIO).set({ rpm: n1(0.15), starter: 1, ignitor: 1 }).render(3)[STEM.engine].subarray(SR);
    const off = new SynthHost(MD500_AUDIO).set({ rpm: n1(0.15), starter: 1 }).render(3)[STEM.engine].subarray(SR);
    const crack = (y: Float32Array): Float32Array => band(y, 2500, 6000);
    expect(peak(crack(x))).toBeGreaterThan(3 * peak(crack(off)));
  }, 30_000);
});

describe('rotors', () => {
  it('the main rotor beats at 41 Hz and the tail rotor drones at 97.8 Hz, in the propeller stem', () => {
    const prop = stems(HOVER)[STEM.prop];
    expect(toneMagnitude(prop, 41)).toBeGreaterThan(10 * toneMagnitude(prop, 45));
    expect(toneMagnitude(prop, 97.77)).toBeGreaterThan(10 * toneMagnitude(prop, 92));
    // Without the tail rotor's parameters, its line has gone and the main rotor's is untouched.
    const noTail = stems({ ...HOVER, tailRpm: 0, tailLoad: 0, tailTipMach: 0 })[STEM.prop];
    expect(toneMagnitude(noTail, 97.77)).toBeLessThan(0.1 * toneMagnitude(prop, 97.77));
    expect(toneMagnitude(noTail, 41) / toneMagnitude(prop, 41)).toBeCloseTo(1, 1);
  }, 60_000);

  it('the tail rotor slaps as its thrust grows past the hover value: its upper harmonics rise faster than its fundamental', () => {
    const bp = (2 * TAIL_RPM) / 60;
    const harmonicRatio = (load: number): number => {
      const x = stems({ ...tail(load) })[STEM.prop];
      return toneMagnitude(x, 5 * bp) / toneMagnitude(x, bp);
    };
    const hover = harmonicRatio(1);
    const pedal = harmonicRatio(2);
    expect(pedal).toBeGreaterThan(2 * hover);
    // And it is louder in a hard pedal turn: +4 dB or more.
    const level = (load: number): number => dbfs(rms(stems({ ...tail(load) })[STEM.prop]));
    expect(level(2) - level(1)).toBeGreaterThan(4);
    expect(level(0.3)).toBeLessThan(level(1));
  }, 60_000);

  it('a profile without a tail rotor plays nothing on its parameters (the Schweizer 300)', () => {
    expect(peak(stems(tail(2), 2, S269_AUDIO)[STEM.prop])).toBe(0);
  }, 30_000);
});

describe('MD 500E mix', () => {
  it('hover: in the cockpit window of the C172S (-17 .. -9 dBFS), nothing clips; a hard pedal turn neither', () => {
    for (const [name, params] of [['hover', HOVER], ['pedal', { ...HOVER, ...tail(2) }]] as const) {
      const all = new SynthHost(MD500_AUDIO).set(params).render(4);
      const inside = interiorMix(all, MD500_AUDIO);
      const level = dbfs(rms(inside, SR));
      expect(level, name).toBeGreaterThan(-17);
      expect(level, name).toBeLessThan(-9);
      expect(dbfs(peak(inside.subarray(SR))), name).toBeLessThan(-2);
      expect(dbfs(peak(exteriorMix(all, 15, MD500_AUDIO).subarray(SR))), name).toBeLessThan(-1);
    }
  }, 60_000);

  it('the ENGINE OUT horn at its pitch in the cabin', () => {
    const x = stems({ ...HOVER, horn: 1 })[STEM.cabin];
    expect(toneMagnitude(x, MD500_AUDIO.stallWarner.baseHz)).toBeGreaterThan(20 * toneMagnitude(x, 1.1 * MD500_AUDIO.stallWarner.baseHz));
  }, 30_000);
});

describe('MD 500E mapping', () => {
  const sound = (): SoundContext => ({ surface: 'runway', speedOfSound: SPEED_OF_SOUND, turbulence: 0, gyroSpin: 0, flapMotor: 0 });
  /** A hovering 500E: Nr 492, the tail rotor at its hover thrust (pushing left, negative), N1 88 %. */
  const hover = (edit: (r: RotorcraftState, s: AircraftState) => void = () => undefined): AircraftState => {
    const s = makeMockState();
    s.electrical.busVoltage = 28;
    s.tas = 0;
    const r = emptyRotorcraftState();
    Object.assign(r, { rotorRpm: MD500_NR_NOMINAL, thrust: 12_000, tailThrust: -TAIL.hoverThrustN });
    r.turboshaft = {
      n2SetPct: 103, ptgIntegral: 0, grip: 'fullOpen', governorMode: 'governed', n2Pct: 103, nrPct: 103, torquePsi: 60,
      needlesSplit: false, engineOutLight: false, engineOutHorn: false, reignitionLight: false, overTorque: false, overTemp: false, avoidRange: false,
    };
    s.rotorcraft = r;
    Object.assign(s.engine, { running: true, lit: true, ng: 88, itt: 650, fuelFlow: 0.025, power: 220e3, propRpm: MD500_NR_NOMINAL });
    Object.assign(s.propeller, { rpm: MD500_NR_NOMINAL, thrust: 12_000 });
    edit(r, s);
    return s;
  };
  const fill = (s: AircraftState, starter = false): Float32Array => {
    const c = defaultControls();
    c.masterBattery = true;
    c.starter = starter;
    return fillSynthParams(s, c, sound(), makeParamBlock(), MD500_AUDIO);
  };

  it('the tail rotor at ratio x Nr, its loading |tailThrust| / hover thrust, its tip Mach', () => {
    const out = fill(hover());
    expect(out[P.tailRpm]).toBe(Math.fround(MD500_NR_NOMINAL * TAIL.ratio));
    expect(out[P.tailLoad]).toBe(1);
    const vt = (Math.PI * TAIL.diameterM * MD500_NR_NOMINAL * TAIL.ratio) / 60;
    expect(out[P.tailTipMach]).toBe(Math.fround(vt / SPEED_OF_SOUND));
    // With the 500E's ratio (5.96, T2): 2933 rpm, tip Mach 0.63.
    expect((Math.PI * TAIL.diameterM * TAIL_RPM) / 60 / SPEED_OF_SOUND).toBeCloseTo(0.63, 2);
    expect(tailRotorSound(hover((r) => (r.tailThrust = 3 * TAIL.hoverThrustN)), SPEED_OF_SOUND, MD500_AUDIO).load).toBe(2);
    // The turbine voice reads N1 and the rotor through the propeller voice.
    expect(out[P.rpm]).toBe(Math.fround(0.88 * MD500_N1_100_RPM));
    expect(out[P.propRpm]).toBe(MD500_NR_NOMINAL);
    expect(out[P.firing]).toBe(1);
    // A fixed-wing state (no rotorcraft) under this profile: no tail rotor.
    const plane = makeMockState();
    expect(tailRotorSound(plane, SPEED_OF_SOUND, MD500_AUDIO)).toEqual({ rpm: 0, load: 0, tipMach: 0 });
  });

  it('the horn sounds on turboshaft.engineOutHorn (lowRpmHorn mirrors it), on the bus', () => {
    expect(fill(hover())[P.horn]).toBe(0);
    expect(fill(hover((r) => (r.turboshaft!.engineOutHorn = true)))[P.horn]).toBe(1);
    // The turboshaft state is what counts on a turboshaft type; a piston helicopter's lowRpmHorn as before.
    expect(warningHornOn(hover((r) => (r.lowRpmHorn = true)))).toBe(false);
    expect(warningHornOn(hover((r) => { delete r.turboshaft; r.lowRpmHorn = true; }))).toBe(true);
    const dead = hover((r, s) => { r.turboshaft!.engineOutHorn = true; s.electrical.busVoltage = MD500_BUS_DEAD_VOLTS; });
    expect(fill(dead)[P.horn]).toBe(0);
  });

  it('igniters with the starter; no reverse, shaker or clacker on a helicopter', () => {
    expect(fill(hover(), true)[P.ignitor]).toBe(1);
    const out = fill(hover((_r, s) => Object.assign(s, { stickShaker: true, ias: 300, mach: 0.9 })));
    expect([out[P.ignitor], out[P.reverse], out[P.shaker], out[P.overspeed]]).toEqual([0, 0, 0, 0]);
  });
});
