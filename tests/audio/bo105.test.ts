// The Bo 105 CB-4's sound (src/aircraft/bo105/audio.ts): two 250-C20B voices each on its own N1, ONE four-blade rotor
// at 424.5 rpm (28.3 Hz) through engine 1's propeller voice (a twin rotorcraft must not double the rotor), the two-blade
// tail rotor at 2229 rpm (74.3 Hz), the ZF transmission's mesh, both engines' igniters, and the warning unit K-DW02/01
// (650 Hz at 5 a second for NR LOW and N1 SPLIT, 2600 Hz steady for NR HIGH); and the mapping from a twin rotorcraft
// state (RotorcraftState.twinTurboshaft, the second engine) to the parameters.

import { describe, expect, it } from 'vitest';
import { BO105_AUDIO } from '../../src/aircraft/bo105/audio';
import { BO105_MASS_KG, BO105_N1_100_RPM, BO105_NR_100, BO105_WARNINGS } from '../../src/aircraft/bo105/facts';
import { BO105_POWERPLANT } from '../../src/aircraft/bo105/powerplant';
import { BO105_ROTORCRAFT as rotor } from '../../src/aircraft/bo105/rotorcraft';
import { MD500_AUDIO } from '../../src/aircraft/md500/audio';
import { fillSynthParams, makeParamBlock, SPEED_OF_SOUND, type SoundContext } from '../../src/audio/mapping';
import { ENGINE_P, P, STEM } from '../../src/audio/params';
import type { AudioProfile } from '../../src/audio/profile';
import { tailHoverThrustN } from '../../src/audio/rotorcraftProfile';
import { G0 } from '../../src/core/math';
import { makeMockState } from '../../src/core/mockState';
import { defaultControls, type AircraftState } from '../../src/core/types';
import { emptyRotorcraftState, type RotorcraftState } from '../../src/physics/rotorcraft/definition';
import { emptyTwinTurboshaftState } from '../../src/physics/rotorcraft/twinTurboshaft';
import { biquad, dbfs, exteriorMix, interiorMix } from './mixModel';
import { envelope, peak, rms, SR, SynthHost, toneMagnitude } from './workletHost';

const [V1, V2] = BO105_AUDIO.engines;
const TURBINE = V1.engine.turbine!;
const ROTOR = V1.prop;
const TAIL = BO105_AUDIO.tailRotor!;
const WARN = BO105_AUDIO.rotorWarnings!;
const n1 = (fraction: number): number => fraction * BO105_N1_100_RPM;
const shaftHz = (fraction: number): number => n1(fraction) / 60;
/** 4 x 424.5 / 60 = 28.3 Hz; the tail rotor 5.25 x 424.5 = 2229 rpm, 2 x 2229 / 60 = 74.3 Hz. */
const ROTOR_HZ = (4 * BO105_NR_100) / 60;
const TAIL_RPM = BO105_NR_100 * rotor.tailRatio;
const TAIL_HZ = (2 * TAIL_RPM) / 60;
const tail = (load: number): Record<string, number> => ({ tailRpm: TAIL_RPM, tailLoad: load, tailTipMach: 0.65 });
/** Engine 2's block as the mapping fills it on a twin rotorcraft: its own N1, no rotor voice, its mesh at the rotor's speed. */
const engine2 = (fraction: number, load: number): Record<string, number> => ({ rpm: n1(fraction), firing: 1, load, propRpm: BO105_NR_100, tipMach: 0, propLoad: 0 });
/** Hover at 2200 kg: N1 85 % each, Nr 424.5, tip Mach 0.64, both rotors at their hover thrust. */
const HOVER = { rpm: n1(0.85), firing: 1, load: 0.7, propRpm: BO105_NR_100, tipMach: 0.64, propLoad: 1, ...tail(1) };
/** Cruise at 110 KIAS (56.6 m/s: wind level (56.6 / 50)^2 = 1.28), N1 92 %, the tail rotor unloaded by the fin. */
const CRUISE = { ...HOVER, rpm: n1(0.92), load: 0.9, tipMach: 0.69, propLoad: 1.1, ...tail(0.5), tailTipMach: 0.67, windLevel: 1.28, windFreq: 250 + 56.6 * 9, turbulence: 0.1 };
const band = (x: Float32Array, lo: number, hi: number): Float32Array => biquad(biquad(x, { type: 'highpass', frequency: lo, Q: 0 }), { type: 'lowpass', frequency: hi, Q: 0 });

/** Render `seconds` of the Bo 105 with engine 0's (shared) parameters and engine 2's block; the first second dropped. */
function stems(params: Record<string, number>, e2: Record<string, number> = engine2(0.85, 0.7), seconds = 3, profile: AudioProfile = BO105_AUDIO): Float32Array[] {
  return new SynthHost(profile).set(params).setEngine(1, e2).render(seconds).map((x) => x.subarray(SR));
}

describe('BO105_AUDIO', () => {
  it('two 250-C20B turbines on the rotor drive, with the numbers of the definition, the powerplant and facts.ts', () => {
    expect(BO105_AUDIO.engines).toHaveLength(2);
    for (const v of BO105_AUDIO.engines) {
      expect(v.engine.combustion).toBe('turbine');
      expect(v.engine.turbine!.ngRpm).toBe(BO105_N1_100_RPM);
      expect(v.engine.ratedPowerW).toBe(BO105_POWERPLANT.engines[0].engine.ratedPower);
      expect(v.engine.gearRatio).toBe(rotor.engineRatio);
      // Two equal voices, each 1 / sqrt(2).
      expect(v.engine.level).toBeCloseTo(0.71, 2);
      expect(v.prop.blades).toBe(rotor.main.blades);
      expect(v.prop.diameterM).toBe(rotor.main.radius * 2);
    }
    // ONE rotor: engine 2's rotor voice is silent, and one transmission mesh (engine 1's).
    expect(V1.prop.level).toBe(1);
    expect(V2.prop.level).toBe(0);
    expect(V1.engine.turbine!.gearMesh.level).toBeGreaterThan(0);
    expect(V2.engine.turbine!.gearMesh.level).toBe(0);
    expect(rotor.engineRatio).toBeCloseTo(14.17, 2);
    expect(ROTOR.blades).toBe(4);
    expect(ROTOR.diameterM).toBeCloseTo(9.84, 6);
    expect(ROTOR.cruiseThrustN).toBeCloseTo(BO105_MASS_KG.typical * G0, 6);
    expect(TAIL.blades).toBe(rotor.tail.blades);
    expect(TAIL.blades).toBe(2);
    expect(TAIL.diameterM).toBe(rotor.tail.radius * 2);
    expect(TAIL.diameterM).toBeCloseTo(1.9, 6);
    expect(TAIL.ratio).toBe(rotor.tailRatio);
    expect(TAIL.hoverThrustN).toBe(tailHoverThrustN(rotor, BO105_MASS_KG.typical * G0));
    expect(BO105_AUDIO.busPoweredV).toBe(BO105_POWERPLANT.electrical.busDeadVolts);
    // The warning unit's numbers (P TM 00-44): 650 Hz at 5 a second, 2600 Hz.
    expect(WARN).toMatchObject({ lowHz: 650, lowPerSecond: 5, highHz: 2600 });
    expect(WARN.lowHz).toBe(BO105_WARNINGS.nrLowToneHz);
    // No ENGINE OUT horn (AGENT choice: the warning unit instead), no gear, no flaps, no pusher.
    expect(BO105_AUDIO.stallWarner.kind).toBe('none');
    expect(BO105_AUDIO.gear).toBeNull();
    expect(BO105_AUDIO.flapMotor).toBe(false);
    expect(BO105_AUDIO.pusher).toBeUndefined();
    // Blade passages: 4 x 424.5 / 60 = 28.3 Hz; 2 x 2228.6 / 60 = 74.3 Hz.
    expect(ROTOR_HZ).toBeCloseTo(28.3, 1);
    expect(TAIL_HZ).toBeCloseTo(74.3, 1);
    for (const t of TURBINE.tones) expect(t.order * shaftHz(1.06)).toBeLessThan(0.45 * 44_100);
  });

  it('is plain data (structuredClone and JSON)', () => {
    expect(structuredClone(BO105_AUDIO)).toEqual(BO105_AUDIO);
    expect(JSON.parse(JSON.stringify(BO105_AUDIO))).toEqual(BO105_AUDIO);
  });
});

describe('two 250-C20B voices', () => {
  it('each whines on its own N1: the compressor tones at 6 x each shaft rate', () => {
    // Engine 1 at 85 %, engine 2 at 78 % (a split): two compressor lines 6 x 722 = 4.33 kHz and 6 x 663 = 3.98 kHz.
    const x = stems({ rpm: n1(0.85), firing: 1, load: 0.7 }, { rpm: n1(0.78), firing: 1, load: 0.5 })[STEM.engine];
    for (const fraction of [0.85, 0.78]) {
      const f = 6 * shaftHz(fraction);
      expect(toneMagnitude(x, f), `${fraction}`).toBeGreaterThan(20 * toneMagnitude(x, 1.03 * f));
    }
    // Engine 2 shut down: its line has gone, engine 1's is untouched.
    const one = stems({ rpm: n1(0.85), firing: 1, load: 0.7 }, { rpm: 0, firing: 0, load: 0 })[STEM.engine];
    expect(toneMagnitude(one, 6 * shaftHz(0.78))).toBeLessThan(0.05 * toneMagnitude(x, 6 * shaftHz(0.78)));
    expect(toneMagnitude(one, 6 * shaftHz(0.85)) / toneMagnitude(x, 6 * shaftHz(0.85))).toBeCloseTo(1, 1);
  }, 60_000);

  it('the ZF transmission meshes at 190 x the rotor rate (1.34 kHz at 424.5 rpm), once', () => {
    const f = (190 * BO105_NR_100) / 60;
    const x = stems(HOVER)[STEM.engine];
    expect(toneMagnitude(x, f)).toBeGreaterThan(10 * toneMagnitude(x, 1.04 * f));
    // Engine 2's block alone (engine 1 cut, its rotor speed 0) carries no mesh line: one transmission, voiced once.
    const e2Only = stems({ rpm: 0, firing: 0, load: 0, propRpm: 0 })[STEM.engine];
    expect(toneMagnitude(e2Only, f)).toBeLessThan(2 * toneMagnitude(e2Only, 1.04 * f));
    expect(toneMagnitude(e2Only, f)).toBeLessThan(0.05 * toneMagnitude(x, f));
  }, 60_000);

  it('both engines\' igniters snap on their own starts (ignitor for engine 1, ignitor2 for engine 2)', () => {
    const crack = (y: Float32Array): number => peak(band(y, 2500, 6000));
    const quiet = { rpm: 0, firing: 0, load: 0 };
    const start = (ign: Record<string, number>): number =>
      crack(new SynthHost(BO105_AUDIO).set({ ...quiet, ...ign }).setEngine(1, { rpm: n1(0.15), starter: 1 }).render(3)[STEM.engine].subarray(SR));
    const off = start({});
    expect(start({ ignitor2: 1 })).toBeGreaterThan(3 * off);
    expect(start({ ignitor: 1 })).toBeGreaterThan(3 * off);
    // The MD 500E (one engine) has no second igniter: ignitor2 changes nothing.
    const md = (ign: Record<string, number>): Float32Array => new SynthHost(MD500_AUDIO).set({ rpm: n1(0.15), starter: 1, ...ign }).render(2)[STEM.engine];
    expect(md({ ignitor2: 1 })).toEqual(md({}));
  }, 60_000);
});

describe('one rotor', () => {
  it('the main rotor beats at 28.3 Hz and the tail rotor drones at 74.3 Hz, in the propeller stem', () => {
    const prop = stems(HOVER)[STEM.prop];
    expect(toneMagnitude(prop, ROTOR_HZ)).toBeGreaterThan(10 * toneMagnitude(prop, 32));
    expect(toneMagnitude(prop, TAIL_HZ)).toBeGreaterThan(10 * toneMagnitude(prop, 68));
  }, 60_000);

  it('is not doubled: engine 2\'s propeller block adds nothing to it, even if it were given the rotor\'s parameters', () => {
    const single = stems(HOVER)[STEM.prop];
    const e2Rotor = stems(HOVER, { ...engine2(0.85, 0.7), tipMach: 0.64, propLoad: 1 })[STEM.prop];
    // Engine 2's prop voice is at level 0: the rotor line is the same.
    expect(toneMagnitude(e2Rotor, ROTOR_HZ) / toneMagnitude(single, ROTOR_HZ)).toBeCloseTo(1, 2);
    // A profile that voiced engine 2's rotor at level 1 would put it 6 dB up (the doubling the rule prevents).
    const doubled: AudioProfile = { ...BO105_AUDIO, engines: [V1, { ...V2, prop: { ...V2.prop, level: 1 } }] };
    const two = stems(HOVER, { ...engine2(0.85, 0.7), tipMach: 0.64, propLoad: 1 }, 3, doubled)[STEM.prop];
    expect(20 * Math.log10(toneMagnitude(two, ROTOR_HZ) / toneMagnitude(single, ROTOR_HZ))).toBeGreaterThan(3);
  }, 60_000);
});

describe('warning unit K-DW02/01', () => {
  const lowBeat = (x: Float32Array): number => toneMagnitude(envelope(band(x, 500, 900), 0.01), WARN.lowPerSecond, 100);
  it('NR LOW: 650 Hz, intermittent at 5 a second', () => {
    const x = stems({ ...HOVER, nrLowTone: 1 })[STEM.cabin];
    expect(toneMagnitude(x, 650)).toBeGreaterThan(20 * toneMagnitude(x, 720));
    // The loudness envelope beats at 5 Hz.
    const env = envelope(band(x, 500, 900), 0.01);
    expect(toneMagnitude(env, 5, 100)).toBeGreaterThan(5 * toneMagnitude(env, 3.5, 100));
    // Off: no tone.
    const off = stems(HOVER)[STEM.cabin];
    expect(toneMagnitude(off, 650)).toBeLessThan(0.01 * toneMagnitude(x, 650));
  }, 60_000);

  it('N1 SPLIT: the same intermittent tone', () => {
    const x = stems({ ...HOVER, n1SplitTone: 1 })[STEM.cabin];
    expect(toneMagnitude(x, 650)).toBeGreaterThan(20 * toneMagnitude(x, 720));
    // The loudness envelope beats at 5 Hz, as NR LOW's.
    const env = envelope(band(x, 500, 900), 0.01);
    expect(toneMagnitude(env, 5, 100)).toBeGreaterThan(5 * toneMagnitude(env, 3.5, 100));
    expect(lowBeat(x)).toBeCloseTo(lowBeat(stems({ ...HOVER, nrLowTone: 1 })[STEM.cabin]), 6);
  }, 60_000);

  it('NR HIGH: a steady 2600 Hz tone', () => {
    const x = stems({ ...HOVER, nrHighTone: 1 })[STEM.cabin];
    expect(toneMagnitude(x, 2600)).toBeGreaterThan(20 * toneMagnitude(x, 2800));
    // Steady: its 10 ms envelope varies by less than 5 %.
    const env = envelope(band(x, 2300, 2900), 0.01);
    const mean = env.reduce((a, b) => a + b, 0) / env.length;
    expect(Math.max(...env) / mean).toBeLessThan(1.05);
    expect(Math.min(...env) / mean).toBeGreaterThan(0.95);
  }, 60_000);

  it('a profile without the unit plays nothing on its parameters (the MD 500E)', () => {
    const x = new SynthHost(MD500_AUDIO).set({ nrLowTone: 1, nrHighTone: 1, n1SplitTone: 1 }).render(2)[STEM.cabin];
    expect(peak(x)).toBe(0);
  }, 30_000);
});

describe('Bo 105 mix', () => {
  it('hover, a hard pedal turn and a 110 KIAS cruise: in the cockpit window of the C172S (-17 .. -9 dBFS), nothing clips', () => {
    for (const [name, params, e2] of [
      ['hover', HOVER, engine2(0.85, 0.7)],
      ['pedal', { ...HOVER, ...tail(2) }, engine2(0.85, 0.7)],
      ['cruise', CRUISE, engine2(0.92, 0.9)],
    ] as const) {
      const all = new SynthHost(BO105_AUDIO).set(params).setEngine(1, e2).render(4);
      const inside = interiorMix(all, BO105_AUDIO);
      const level = dbfs(rms(inside, SR));
      expect(level, name).toBeGreaterThan(-17);
      expect(level, name).toBeLessThan(-9);
      expect(dbfs(peak(inside.subarray(SR))), name).toBeLessThan(-2);
      expect(dbfs(peak(exteriorMix(all, 15, BO105_AUDIO).subarray(SR))), name).toBeLessThan(-1);
    }
  }, 90_000);

  it('the warning tones stand out of the hover in the cabin (each at least 10 dB above the hover in its band)', () => {
    const inside = (p: Record<string, number>): Float32Array => interiorMix(new SynthHost(BO105_AUDIO).set(p).setEngine(1, engine2(0.85, 0.7)).render(3), BO105_AUDIO).subarray(SR);
    const hover = inside(HOVER);
    expect(20 * Math.log10(toneMagnitude(inside({ ...HOVER, nrLowTone: 1 }), 650) / toneMagnitude(hover, 650))).toBeGreaterThan(10);
    expect(20 * Math.log10(toneMagnitude(inside({ ...HOVER, nrHighTone: 1 }), 2600) / toneMagnitude(hover, 2600))).toBeGreaterThan(10);
  }, 60_000);
});

describe('Bo 105 mapping', () => {
  const sound = (): SoundContext => ({ surface: 'runway', speedOfSound: SPEED_OF_SOUND, turbulence: 0, gyroSpin: 0, flapMotor: 0 });
  /** A hovering Bo 105: Nr 424.5, both engines at N1 85 %, engine 2's PropellerState NOT the rotor (the S0 stub reads 2790 rpm). */
  const hover = (edit: (r: RotorcraftState, s: AircraftState) => void = () => undefined): AircraftState => {
    const s = makeMockState({ engines: 2 });
    s.electrical.busVoltage = 28;
    s.tas = 0;
    const r = emptyRotorcraftState();
    Object.assign(r, { rotorRpm: BO105_NR_100, thrust: 21_600, tailThrust: -TAIL.hoverThrustN });
    r.twinTurboshaft = emptyTwinTurboshaftState(rotor, true);
    s.rotorcraft = r;
    for (const e of [s.engine, s.engines[0], s.engines[1]]) Object.assign(e, { running: true, lit: true, ng: 85, itt: 650, fuelFlow: 0.022, power: 190e3 });
    Object.assign(s.propeller, { rpm: BO105_NR_100, thrust: 21_600 });
    Object.assign(s.propellers[0], { rpm: BO105_NR_100, thrust: 21_600 });
    Object.assign(s.propellers[1], { rpm: 2790, thrust: 0 });
    edit(r, s);
    return s;
  };
  const fill = (s: AircraftState, edit: (c: ReturnType<typeof defaultControls>) => void = () => undefined): Float32Array => {
    const c = defaultControls({ engineCount: 2, controlDefaults: {} });
    c.masterBattery = true;
    edit(c);
    return fillSynthParams(s, c, sound(), makeParamBlock(), BO105_AUDIO);
  };

  it('engine 2 plays its own N1 but not the rotor: no tip Mach, no loading, its mesh at the rotor\'s speed', () => {
    const out = fill(hover((_r, s) => (s.engines[1].ng = 78)));
    expect(out[P.rpm]).toBe(Math.fround(0.85 * BO105_N1_100_RPM));
    expect(out[ENGINE_P[1].rpm]).toBe(Math.fround(0.78 * BO105_N1_100_RPM));
    expect(out[ENGINE_P[1].firing]).toBe(1);
    expect(out[P.tipMach]).toBeGreaterThan(0.6);
    expect(out[P.propLoad]).toBeCloseTo(1, 1);
    expect(out[ENGINE_P[1].tipMach]).toBe(0);
    expect(out[ENGINE_P[1].propLoad]).toBe(0);
    expect(out[ENGINE_P[1].propRpm]).toBe(Math.fround(BO105_NR_100));
    // A fixed-wing twin keeps each propeller's own numbers (the rule is a rotorcraft's).
    const plane = hover((_r, s) => delete s.rotorcraft);
    expect(fill(plane)[ENGINE_P[1].propRpm]).toBe(2790);
  });

  it('the warning unit\'s tones from twinTurboshaft (nrLowTone, nrHighTone, n1SplitLight), on the bus', () => {
    expect([P.nrLowTone, P.nrHighTone, P.n1SplitTone].map((i) => fill(hover())[i])).toEqual([0, 0, 0]);
    expect(fill(hover((r) => (r.twinTurboshaft!.nrLowTone = true)))[P.nrLowTone]).toBe(1);
    expect(fill(hover((r) => (r.twinTurboshaft!.nrHighTone = true)))[P.nrHighTone]).toBe(1);
    expect(fill(hover((r) => (r.twinTurboshaft!.n1SplitLight = true)))[P.n1SplitTone]).toBe(1);
    // The NR HIGH light alone (103 %) has no tone; nor the NR LOW light without its tone.
    expect(fill(hover((r) => (r.twinTurboshaft!.nrHighLight = true)))[P.nrHighTone]).toBe(0);
    // No bus, no warning unit.
    const dead = hover((r, s) => { r.twinTurboshaft!.nrLowTone = true; s.electrical.busVoltage = BO105_AUDIO.busPoweredV; });
    expect(fill(dead)[P.nrLowTone]).toBe(0);
  });

  it('no ENGINE OUT horn on the Bo 105, whatever turboshaft.engineOutHorn says', () => {
    const s = hover((r) => {
      r.turboshaft = { n2SetPct: 100, ptgIntegral: 0, grip: 'fullOpen', governorMode: 'governed', n2Pct: 100, nrPct: 100, torquePsi: 0,
        needlesSplit: false, engineOutLight: true, engineOutHorn: true, reignitionLight: false, overTorque: false, overTemp: false, avoidRange: false };
    });
    expect(fill(s)[P.horn]).toBe(0);
  });

  it('each engine\'s igniters on its own starter (ignitor, ignitor2), on the bus', () => {
    const out = (starters: [boolean, boolean]): number[] => {
      const s = hover();
      s.engines[0].starter = starters[0];
      s.engines[1].starter = starters[1];
      const o = fill(s);
      return [o[P.ignitor], o[P.ignitor2]];
    };
    expect(out([false, false])).toEqual([0, 0]);
    expect(out([false, true])).toEqual([0, 1]);
    expect(out([true, false])).toEqual([1, 0]);
    // The per-engine start switch when the engine does not report its starter.
    const s = hover();
    const o = fill(s, (c) => (c.engines[1].starter = true));
    expect(o[P.ignitor2]).toBe(1);
    // A single-engine profile never fills ignitor2.
    expect(fillSynthParams(s, defaultControls(), sound(), makeParamBlock(), MD500_AUDIO)[P.ignitor2]).toBe(0);
  });

  it('none of the AH-56A\'s voices', () => {
    const o = fill(hover((_r, s) => (s.tas = 70)));
    expect([o[P.advTipMach], o[P.pusherRpm], o[P.vibration], o[P.halfP]]).toEqual([0, 0, 0, 0]);
  });
});
