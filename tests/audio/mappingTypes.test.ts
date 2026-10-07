// The parameter mapping for what the Cessna 172S does not have: a second engine with its own block of
// parameters and its own levers, a diesel, a turbocharger, a geared propeller, retractable gear, an electric
// stall warner, gyros that are all electric or absent.

import { describe, expect, it } from 'vitest';
import { C172S_AUDIO } from '../../src/aircraft/c172s/audio';
import {
  crankRpm,
  engineLoad,
  fillSynthParams,
  gearThumpAmplitude,
  gearWind,
  makeParamBlock,
  propLoad,
  MELT_WATER_ROUGHNESS,
  roughness,
  SoundTracker,
  SPEED_OF_SOUND,
  stallHorn,
  stepGyro,
  tipMach,
  turboSpool,
  windNoise,
  type SoundContext,
} from '../../src/audio/mapping';
import { ENGINE_P, ENGINE_PARAMS, MAX_ENGINES, P, PARAM_COUNT, SYNTH_PARAMS } from '../../src/audio/params';
import type { AudioProfile } from '../../src/audio/profile';
import { DEG, KT } from '../../src/core/math';
import { makeMockState } from '../../src/core/mockState';
import { defaultControls, defaultWeather, setEngineControl, type AircraftState, type ControlInputs, type Environment } from '../../src/core/types';
import { variant } from './profiles';
import { DIESEL_AUDIO_TESTBED, DIESEL_ENGINE_TESTBED, DIESEL_GEAR_RATIO, DIESEL_PROP_TESTBED, TWIN_AUDIO_TESTBED } from './testbed';

const sound = (): SoundContext => ({ surface: 'runway', speedOfSound: SPEED_OF_SOUND, turbulence: 0, gyroSpin: 0, flapMotor: 0 });
const twinControls = (): ControlInputs => defaultControls({ engineCount: 2, controlDefaults: {} });
const fill = (s: AircraftState, c: ControlInputs, profile: AudioProfile): Float32Array => fillSynthParams(s, c, sound(), makeParamBlock(), profile);
/** The block of one engine by parameter name. */
const block = (out: Float32Array, engine: number): Record<string, number> => Object.fromEntries(ENGINE_PARAMS.map((n) => [n, out[ENGINE_P[engine][n]]]));
const f32 = Math.fround;

/** A twin in cruise with different numbers left and right. */
function twinState(): AircraftState {
  const s = makeMockState({ engines: 2 });
  Object.assign(s.engines[1], { rpm: 2500, manifoldPressure: 20, power: 80_000, propRpm: 2500 });
  Object.assign(s.propellers[1], { rpm: 2500, thrust: 700 });
  return s;
}

describe('parameter block layout', () => {
  it('appends the shared parameters, then engine 0\'s two, then a block for the second engine', () => {
    expect(SYNTH_PARAMS.slice(23)).toEqual(['gearPump', 'gearHorn', 'gearWind', 'propRpm', 'turbo']);
    expect([P.gearPump, P.gearHorn, P.gearWind, P.propRpm, P.turbo]).toEqual([23, 24, 25, 26, 27]);
    expect(ENGINE_PARAMS).toEqual(['rpm', 'firing', 'load', 'throttle', 'starter', 'roughness', 'propLoad', 'tipMach', 'propRpm', 'turbo']);
    expect(MAX_ENGINES).toBe(2);
    // Engine 0 keeps the indices its eight parameters always had.
    expect(ENGINE_P[0]).toEqual({ rpm: 0, firing: 1, load: 2, throttle: 3, starter: 4, roughness: 5, propLoad: 6, tipMach: 7, propRpm: 26, turbo: 27 });
    expect(ENGINE_PARAMS.map((n) => ENGINE_P[1][n])).toEqual([28, 29, 30, 31, 32, 33, 34, 35, 36, 37]);
    expect(PARAM_COUNT).toBe(38);
    expect(makeParamBlock()).toHaveLength(38);
    // No index is used twice.
    const all = [...Object.values(P), ...Object.values(ENGINE_P[1])];
    expect(new Set(all).size).toBe(PARAM_COUNT);
  });
});

describe('two engines', () => {
  it('each engine fills its block from its own state', () => {
    const s = twinState();
    const out = fill(s, twinControls(), TWIN_AUDIO_TESTBED);
    const [engine, prop] = [TWIN_AUDIO_TESTBED.engines[1].engine, TWIN_AUDIO_TESTBED.engines[1].prop];
    expect(block(out, 1)).toEqual({
      rpm: 2500,
      firing: 1,
      load: f32(engineLoad(20, 80_000, engine)),
      throttle: 0,
      starter: 0,
      roughness: 0,
      propLoad: f32(propLoad(700, prop)),
      tipMach: f32(tipMach(2500, s.tas, SPEED_OF_SOUND, prop)),
      propRpm: 2500,
      turbo: 0,
    });
    // Engine 0 from the first engine, at the indices it always had.
    expect(out[P.rpm]).toBe(2350);
    expect(out[P.load]).toBe(f32(engineLoad(23, 95_000, TWIN_AUDIO_TESTBED.engines[0].engine)));
    expect(out[P.tipMach]).toBe(f32(tipMach(2350, s.tas, SPEED_OF_SOUND, TWIN_AUDIO_TESTBED.engines[0].prop)));
    expect(out[P.propRpm]).toBe(2350);
    // 200 hp and a 1.93 m propeller: other numbers than the Cessna's for the same state.
    expect(out[P.load]).not.toBe(f32(engineLoad(23, 95_000)));
    // The tip of a 1.93 m propeller at 2500 rpm moves at pi x 1.93 x 2500 / 60 = 252.6 m/s.
    expect(tipMach(2500, 0, 340.3, prop) * 340.3).toBeCloseTo(252.6, 1);
  });

  it('each engine follows its own levers and switches', () => {
    const s = twinState();
    const c = twinControls();
    c.throttle = 0.8;
    setEngineControl(c, 1, 'throttle', 0.25);
    setEngineControl(c, 1, 'mixture', 0.3);
    setEngineControl(c, 0, 'magnetos', 1);
    let out = fill(s, c, TWIN_AUDIO_TESTBED);
    expect(out[ENGINE_P[0].throttle]).toBe(f32(0.8));
    expect(out[ENGINE_P[1].throttle]).toBe(0.25);
    expect(out[ENGINE_P[0].roughness]).toBe(f32(roughness(1, 1)));
    expect(out[ENGINE_P[1].roughness]).toBe(f32(roughness(0.3, 3)));
    // Melt water from carburettor ice runs rough on top of mixture and magnetos (EngineState.roughness).
    s.engines[0].roughness = 1;
    expect(fill(s, c, TWIN_AUDIO_TESTBED)[ENGINE_P[0].roughness]).toBe(f32(roughness(1, 1) + MELT_WATER_ROUGHNESS));
    delete s.engines[0].roughness;

    // The starter of the right engine alone, with that engine stopped: it cranks, the left one is untouched.
    Object.assign(s.engines[1], { running: false, rpm: 0, power: 0 });
    setEngineControl(c, 1, 'starter', true);
    out = fill(s, c, TWIN_AUDIO_TESTBED);
    expect(block(out, 1)).toMatchObject({ rpm: TWIN_AUDIO_TESTBED.engines[1].engine.crankRpm, firing: 0, load: 0, starter: 1 });
    expect(out[ENGINE_P[0].starter]).toBe(0);
    expect(out[ENGINE_P[0].rpm]).toBe(2350);
    // A dead bus (a 14 V system is alive above 10 V) turns no starter.
    s.electrical.busVoltage = 9;
    expect(block(fill(s, c, TWIN_AUDIO_TESTBED), 1)).toMatchObject({ rpm: 0, starter: 0 });
    s.electrical.busVoltage = 12;
    expect(block(fill(s, c, TWIN_AUDIO_TESTBED), 1)).toMatchObject({ rpm: 170, starter: 1 });
  });

  it('a failed engine windmills silent of combustion while the other one plays on', () => {
    const s = twinState();
    Object.assign(s.engine, { running: false, rpm: 900, power: -4000, manifoldPressure: 27 });
    Object.assign(s.propeller, { rpm: 900, thrust: -250 });
    const out = fill(s, twinControls(), TWIN_AUDIO_TESTBED);
    expect(block(out, 0)).toMatchObject({ rpm: 900, firing: 0, load: 0, propRpm: 900 });
    // A windmilling propeller still loads its blades (drag) and still turns: its blade passage is heard.
    expect(out[ENGINE_P[0].propLoad]).toBe(f32(250 / TWIN_AUDIO_TESTBED.engines[0].prop.cruiseThrustN));
    expect(out[ENGINE_P[0].tipMach]).toBeGreaterThan(0.25);
    expect(block(out, 1)).toMatchObject({ rpm: 2500, firing: 1 });
    // A feathered, stopped propeller makes no blade-passage sound (the worklet is silent below Mach 0.02 ... at rest).
    Object.assign(s.propeller, { rpm: 0, thrust: -20, feathered: true });
    s.tas = 0;
    expect(fill(s, twinControls(), TWIN_AUDIO_TESTBED)[ENGINE_P[0].tipMach]).toBe(0);
  });

  it('a state with one engine under a two-engine profile leaves the second block silent', () => {
    const out = fillSynthParams(makeMockState(), defaultControls(), sound(), makeParamBlock().fill(7), TWIN_AUDIO_TESTBED);
    expect(Object.values(block(out, 1))).toEqual(ENGINE_PARAMS.map(() => 0));
    expect(out[P.rpm]).toBe(2350);
  });

  it('the Cessna 172S profile writes nothing into the second block and no gear sound', () => {
    const s = makeMockState();
    const out = fillSynthParams(s, defaultControls(), sound(), makeParamBlock());
    expect(Array.from(out.subarray(ENGINE_P[1].rpm))).toEqual(ENGINE_PARAMS.map(() => 0));
    expect([out[P.gearPump], out[P.gearHorn], out[P.gearWind], out[P.turbo]]).toEqual([0, 0, 0, 0]);
    expect(out[P.propRpm]).toBe(s.propeller.rpm);
    // Even with a (mock) retractable gear in transit and warning: the profile has no gear.
    s.gear = { retractable: true, lever: 'up', extension: [0.5, 0.5, 0.5], locked: [false, false, false], inTransit: true, warning: true };
    const again = fillSynthParams(s, defaultControls(), sound(), makeParamBlock());
    expect([again[P.gearPump], again[P.gearHorn], again[P.gearWind]]).toEqual([0, 0, 0]);
  });
});

describe('diesel, turbocharger, reduction gear', () => {
  const diesel = (loadPercent: number, running = true): AircraftState => {
    const s = makeMockState({ engines: 2 });
    for (let i = 0; i < 2; i++) {
      // The DA42 pattern: 2300 propeller rpm through the 1.69 gearbox is 3887 crank rpm.
      Object.assign(s.engines[i], { running, rpm: 2300 * DIESEL_GEAR_RATIO, propRpm: 2300, power: (loadPercent / 100) * 123_500, manifoldPressure: 60, loadPercent });
      Object.assign(s.propellers[i], { rpm: 2300, thrust: 1500 });
    }
    return s;
  };

  it('the load is the power fraction alone, and neither mixture nor magnetos roughen it', () => {
    const c = twinControls();
    c.throttle = 0.3;
    c.mixture = 0;
    c.magnetos = 1;
    const out = fill(diesel(92), c, DIESEL_AUDIO_TESTBED);
    for (const e of [0, 1]) {
      // Maximum continuous power of the pattern is 92 %: the manifold pressure (boosted, 60 inHg here) is not read.
      expect(out[ENGINE_P[e].load]).toBe(f32(0.92));
      expect(out[ENGINE_P[e].roughness]).toBe(0);
      // No throttle plate: the intake noise follows the air the engine is given, not the lever.
      expect(out[ENGINE_P[e].throttle]).toBe(f32(0.92));
    }
  });

  it('crank and propeller speeds are sent apart, and the tip speed is the propeller\'s', () => {
    const s = diesel(100);
    const out = fill(s, twinControls(), DIESEL_AUDIO_TESTBED);
    expect(out[P.rpm]).toBe(f32(2300 * DIESEL_GEAR_RATIO));
    expect(out[P.propRpm]).toBe(2300);
    expect(out[ENGINE_P[1].propRpm]).toBe(2300);
    // 1.87 m at 2300 rpm: pi x 1.87 x 2300 / 60 = 225.2 m/s at the tip, not the 380.6 m/s of the crank speed.
    expect(tipMach(2300, 0, 340.3, DIESEL_PROP_TESTBED) * 340.3).toBeCloseTo(225.2, 1);
    expect(out[P.tipMach]).toBe(f32(tipMach(2300, s.tas, SPEED_OF_SOUND, DIESEL_PROP_TESTBED)));
    expect(crankRpm(0, true, false, DIESEL_ENGINE_TESTBED)).toBe(DIESEL_ENGINE_TESTBED.crankRpm);
  });

  it('the turbocharger speed goes with the square root of the load and stops with the engine', () => {
    // Compressor pressure rise ~ tip speed squared, boost ~ load: full speed at full load, about a third at idle.
    expect(turboSpool(1, true)).toBe(1);
    expect(turboSpool(1.2, true)).toBe(1);
    expect(turboSpool(0, true)).toBeCloseTo(Math.sqrt(0.1), 12);
    expect(turboSpool(0.5, true)).toBeCloseTo(Math.sqrt(0.55), 12);
    for (let load = 0; load < 1; load += 0.1) expect(turboSpool(load + 0.1, true)).toBeGreaterThan(turboSpool(load, true));
    expect(turboSpool(0.8, false)).toBe(0);
    expect(fill(diesel(100), twinControls(), DIESEL_AUDIO_TESTBED)[P.turbo]).toBe(1);
    expect(fill(diesel(50), twinControls(), DIESEL_AUDIO_TESTBED)[ENGINE_P[1].turbo]).toBe(f32(Math.sqrt(0.55)));
    expect(fill(diesel(50, false), twinControls(), DIESEL_AUDIO_TESTBED)[P.turbo]).toBe(0);
    // An engine without a turbocharger sends none.
    expect(fill(twinState(), twinControls(), TWIN_AUDIO_TESTBED)[P.turbo]).toBe(0);
  });
});

describe('retractable gear', () => {
  const state = (gear: Partial<AircraftState['gear']>, ias = 45): AircraftState => {
    const s = makeMockState({ engines: 2 });
    s.gear = { retractable: true, lever: 'down', extension: [1, 1, 1], locked: [true, true, true], inTransit: false, warning: false, ...gear };
    s.ias = ias;
    return s;
  };
  const gearParams = (s: AircraftState, c = twinControls(), profile = TWIN_AUDIO_TESTBED): number[] => {
    const out = fill(s, c, profile);
    return [out[P.gearPump], out[P.gearHorn], out[P.gearWind]];
  };

  it('the pump runs while a leg is in transit, with the bus alive and not on the emergency release', () => {
    expect(gearParams(state({}))[0]).toBe(0);
    const moving = state({ lever: 'up', extension: [0.4, 0.5, 0.5], locked: [false, false, false], inTransit: true });
    expect(gearParams(moving)[0]).toBe(1);
    // Free fall on the emergency release: the pump is not what moves the gear.
    const c = twinControls();
    c.gearEmergency = true;
    expect(gearParams(moving, c)[0]).toBe(0);
    // 14 V system: dead at 9 V.
    moving.electrical.busVoltage = 9;
    expect(gearParams(moving)[0]).toBe(0);
    // A gear without a hydraulic pump.
    moving.electrical.busVoltage = 14;
    expect(gearParams(moving, twinControls(), { ...TWIN_AUDIO_TESTBED, gear: { pump: false, warningHorn: true } })[0]).toBe(0);
  });

  it('the warning sounds when the gear system says so and the bus is alive', () => {
    const warned = state({ lever: 'up', extension: [0, 0, 0], locked: [false, false, false], warning: true });
    expect(gearParams(warned)[1]).toBe(1);
    expect(gearParams(state({}))[1]).toBe(0);
    warned.electrical.busVoltage = 9;
    expect(gearParams(warned)[1]).toBe(0);
    warned.electrical.busVoltage = 14;
    expect(gearParams(warned, twinControls(), { ...TWIN_AUDIO_TESTBED, gear: { pump: true, warningHorn: false } })[1]).toBe(0);
  });

  it('the legs rumble in the flow with their extension and the dynamic pressure', () => {
    // Unsteady load ~ dynamic pressure: IAS squared, 1 at 50 m/s with every leg out, like the wind noise.
    expect(gearWind(1, 50)).toBe(1);
    expect(gearWind(1, 50)).toBe(windNoise(50, 0, 0).level);
    expect(gearWind(1, 25)).toBeCloseTo(0.25, 12);
    expect(gearWind(0.5, 50)).toBe(0.5);
    expect(gearWind(0, 60)).toBe(0);
    expect(gearWind(1, 0)).toBe(0);
    expect(gearWind(1, -5)).toBe(0);
    expect(gearWind(1, 200)).toBe(2.5);
    expect(gearParams(state({}, 45))[2]).toBe(f32(0.81));
    expect(gearParams(state({ extension: [0, 0, 0], locked: [false, false, false] }, 45))[2]).toBe(0);
    // One leg out of three (the nose leg hanging, say): a third.
    expect(gearParams(state({ extension: [1, 0, 0] }, 50))[2]).toBe(f32(1 / 3));
    // A fixed gear is part of the airframe's wind noise.
    expect(gearParams(state({ retractable: false }, 45))).toEqual([0, 0, 0]);
  });

  it('a leg locking down thumps hardest, an unlocking one least', () => {
    expect(gearThumpAmplitude('downLocked')).toBe(1);
    expect(gearThumpAmplitude('up')).toBeLessThan(gearThumpAmplitude('downLocked'));
    expect(gearThumpAmplitude('unlock')).toBeLessThan(gearThumpAmplitude('up'));
    expect(gearThumpAmplitude('unlock')).toBeGreaterThan(0);
  });
});

describe('stall warner kinds', () => {
  it('an electric warner is on or off; the reed grows with the angle of attack and needs airflow', () => {
    const electric = TWIN_AUDIO_TESTBED.stallWarner;
    expect(stallHorn(true, 9 * DEG, 50 * KT, electric)).toBe(1);
    expect(stallHorn(true, 18 * DEG, 40 * KT, electric)).toBe(1);
    expect(stallHorn(true, 14 * DEG, 0, electric)).toBe(1);
    expect(stallHorn(false, 18 * DEG, 40 * KT, electric)).toBe(0);
    expect(stallHorn(true, 9 * DEG, 50 * KT)).toBeLessThan(stallHorn(true, 16 * DEG, 50 * KT));
    expect(stallHorn(true, 14 * DEG, 0)).toBe(0);
    expect(stallHorn(true, 14 * DEG, 30, C172S_AUDIO.stallWarner)).toBe(stallHorn(true, 14 * DEG, 30));
  });

  it('the electric warner is dead with the bus; a reed that needs no bus sounds with the master off', () => {
    const s = makeMockState({ engines: 2 });
    s.stallWarning = true;
    s.alpha = 15 * DEG;
    expect(fill(s, twinControls(), TWIN_AUDIO_TESTBED)[P.horn]).toBe(1);
    s.electrical.busVoltage = 0;
    expect(fill(s, twinControls(), TWIN_AUDIO_TESTBED)[P.horn]).toBe(0);
    // The pneumatic reed of a type that is not silenced with the bus (a suction horn has no wire to it).
    const reed = variant((p) => void (p.stallWarner.needsBus = false));
    expect(fill(s, defaultControls(), reed)[P.horn]).toBe(f32(stallHorn(true, 15 * DEG, s.ias)));
    expect(fill(s, defaultControls(), C172S_AUDIO)[P.horn]).toBe(0);
  });
});

describe('gyro kinds', () => {
  const run = (profile: AudioProfile, rpm: number, volts: number, seconds: number, from = 0): number => {
    let spin = from;
    for (let t = 0; t < seconds; t += 0.1) spin = stepGyro(spin, rpm, volts, 0.1, profile);
    return spin;
  };
  const electric = variant((p) => void (p.gyros = 'electric'));

  it('all-electric gyros spin on the bus alone; without spinning gyros there is no whine', () => {
    // Engine stopped, bus alive: full spin (the Cessna's vacuum gyros would reach only the turn coordinator's 0.3).
    expect(run(electric, 0, 28, 300)).toBeCloseTo(1, 3);
    expect(run(C172S_AUDIO, 0, 28, 300)).toBeCloseTo(0.3, 3);
    // Engine running, bus dead: nothing.
    expect(run(electric, 2300, 0, 300)).toBe(0);
    expect(run(C172S_AUDIO, 2300, 0, 300)).toBeCloseTo(0.7, 3);
    // Same time constants: 20 s up, 60 s down.
    expect(run(electric, 0, 28, 20)).toBeCloseTo(1 - Math.exp(-1), 2);
    expect(run(electric, 0, 0, 60, 1)).toBeCloseTo(Math.exp(-1), 2);
    expect(run(DIESEL_AUDIO_TESTBED, 2300, 28, 300)).toBe(0);
    expect(stepGyro(0.8, 2300, 28, 0.1, DIESEL_AUDIO_TESTBED)).toBe(0);
  });

  it('the tracker spins the vacuum gyros from whichever engine runs', () => {
    const env: Environment = { groundElevation: () => 0, surface: () => 'runway', atmosphere: () => ({ speedOfSound: 340 }) } as unknown as Environment;
    const s = makeMockState({ engines: 2 });
    Object.assign(s.engine, { running: false, rpm: 0 });
    s.electrical.busVoltage = 0;
    // 14 V twin with vacuum pumps on both engines: the left engine dead, the right one turning.
    const tracker = new SoundTracker(TWIN_AUDIO_TESTBED);
    tracker.reset(s);
    expect(tracker.sound.gyroSpin).toBe(1);
    const c = twinControls();
    for (let i = 0; i < 600; i++) tracker.update(s, c, env, defaultWeather(), 1);
    expect(tracker.sound.gyroSpin).toBeCloseTo(0.7, 3);
    // Both stopped: they run down.
    Object.assign(s.engines[1], { running: false, rpm: 0 });
    tracker.reset(s);
    expect(tracker.sound.gyroSpin).toBe(0);

    // Reset of the other kinds: electric gyros are up when the bus is alive, whatever the engines do.
    const all = new SoundTracker(electric);
    all.reset(s);
    expect(all.sound.gyroSpin).toBe(0);
    s.electrical.busVoltage = 28;
    all.reset(s);
    expect(all.sound.gyroSpin).toBe(1);
    const none = new SoundTracker(DIESEL_AUDIO_TESTBED);
    s.engines[1].rpm = 3000;
    none.reset(s);
    expect(none.sound.gyroSpin).toBe(0);
    expect(none.update(s, twinControls(), env, defaultWeather(), 0.1)[P.gyro]).toBe(0);
  });
});
