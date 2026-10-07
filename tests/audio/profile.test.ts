// The audio mapping and the mix read the numbers of the aircraft type from its sound profile. Left out, the
// profile is the Cessna 172S, and the constants this directory exported before the profile existed still
// carry the values they had as literals.

import { describe, expect, it } from 'vitest';
import { C172S_AUDIO } from '../../src/aircraft/c172s/audio';
import {
  BUS_POWERED_V,
  CRANK_RPM,
  crankRpm,
  CRUISE_THRUST,
  engineLoad,
  fillSynthParams,
  makeParamBlock,
  MAP_FULL,
  MAP_IDLE,
  propLoad,
  SoundTracker,
  SPEED_OF_SOUND,
  stepGyro,
  tipMach,
  windNoise,
  type SoundContext,
} from '../../src/audio/mapping';
import { EXTERIOR_LEVEL, EXTERIOR_ROUTES, INTERIOR_BUS, INTERIOR_LEVEL, INTERIOR_ROUTES, mixFor, STEM_LOWPASS_Q } from '../../src/audio/mix';
import { P, PARAM_COUNT, STEM, SYNTH_PARAMS } from '../../src/audio/params';
import { DEG, KT } from '../../src/core/math';
import { makeMockState } from '../../src/core/mockState';
import { defaultControls, defaultWeather, type AircraftState, type Environment } from '../../src/core/types';
import { biquad, exteriorMix, interiorMix } from './mixModel';
import { variant } from './profiles';

const ENGINE = C172S_AUDIO.engines[0].engine;
const PROP = C172S_AUDIO.engines[0].prop;

describe('Cessna 172S constants of the audio modules', () => {
  it('the mapping constants are the numbers they were as literals', () => {
    expect(CRANK_RPM).toBe(170);
    expect(CRUISE_THRUST).toBe(1400);
    expect(MAP_IDLE).toBe(8.5);
    expect(MAP_FULL).toBe(28.8);
    expect(BUS_POWERED_V).toBe(20);
  });

  it('the mix constants are the tables they were as literals', () => {
    expect(INTERIOR_ROUTES).toEqual([
      { stem: STEM.engine, filters: [{ type: 'lowpass', frequency: 750, Q: 0.6 }], gain: 0.9 },
      { stem: STEM.prop, filters: [{ type: 'lowpass', frequency: 1100, Q: 0.6 }], gain: 0.6 },
      { stem: STEM.airframe, filters: [{ type: 'lowpass', frequency: 2200, Q: 0.6 }], gain: 0.35 },
      { stem: STEM.cabin, filters: [], gain: 1.0 },
    ]);
    expect(INTERIOR_LEVEL).toBe(0.7);
    expect(INTERIOR_BUS).toEqual([
      { type: 'peaking', frequency: 105, Q: 1.2, gainDb: 6 },
      { type: 'peaking', frequency: 190, Q: 1.5, gainDb: 3 },
    ]);
    expect(EXTERIOR_ROUTES).toEqual([
      { stem: STEM.engine, filters: [], gain: 1.0 },
      { stem: STEM.prop, filters: [], gain: 1.1 },
      { stem: STEM.airframe, filters: [], gain: 0.25 },
    ]);
    expect(EXTERIOR_LEVEL).toBe(1.2);
  });

  it('the parameter block keeps its 23 names at their indices', () => {
    const names = [
      'rpm', 'firing', 'load', 'throttle', 'starter', 'roughness', 'propLoad', 'tipMach', 'windLevel', 'windFreq', 'slip', 'flapNoise',
      'buffet', 'horn', 'flapMotor', 'rolling', 'rollSpeed', 'surface', 'brakeSqueal', 'skid', 'gyro', 'fan', 'turbulence',
    ] as const;
    expect(SYNTH_PARAMS.slice(0, names.length)).toEqual(names);
    names.forEach((name, i) => expect(P[name], name).toBe(i));
    expect(PARAM_COUNT).toBeGreaterThanOrEqual(names.length);
    expect(STEM).toEqual({ engine: 0, prop: 1, airframe: 2, cabin: 3 });
  });
});

describe('mapping functions and the profile', () => {
  it('give the same numbers with the Cessna 172S profile passed as without it', () => {
    for (const [rpm, starter, running] of [[0, true, false], [60, true, false], [900, true, true], [0, false, false]] as const) {
      expect(crankRpm(rpm, starter, running, ENGINE)).toBe(crankRpm(rpm, starter, running));
    }
    for (const [map, power] of [[8.5, 2200], [20, 60000], [28.5, 159 * 745.7], [3, -18 * 745.7], [31, 150000]]) {
      expect(engineLoad(map, power, ENGINE)).toBe(engineLoad(map, power));
    }
    expect(tipMach(2700, 0, 340.3, PROP)).toBe(tipMach(2700, 0, 340.3));
    expect(tipMach(2400, 55, 330, PROP)).toBe(tipMach(2400, 55, 330));
    for (const thrust of [700, -150, 2400]) expect(propLoad(thrust, PROP)).toBe(propLoad(thrust));
    expect(windNoise(42, 4 * DEG, 20 * DEG, C172S_AUDIO)).toEqual(windNoise(42, 4 * DEG, 20 * DEG));
    expect(stepGyro(0.2, 2000, 28, 0.5, C172S_AUDIO)).toBe(stepGyro(0.2, 2000, 28, 0.5));
    expect(stepGyro(0.9, 0, 0, 0.5, C172S_AUDIO)).toBe(stepGyro(0.9, 0, 0, 0.5));
  });

  it('take the engine numbers from the profile', () => {
    const small = variant((p) => {
      p.engines[0].engine.ratedPowerW = 110 * 745.7;
      p.engines[0].engine.mapRange = [9, 28];
      p.engines[0].engine.crankRpm = 140;
    }).engines[0].engine;
    expect(crankRpm(0, true, false, small)).toBe(140);
    expect(crankRpm(900, true, true, small)).toBe(900);
    expect(engineLoad(9, 0, small)).toBe(0);
    expect(engineLoad(28, 110 * 745.7, small)).toBe(0.6 * 1 + 0.4 * 1);
    // The same shaft power is a higher load on the smaller engine.
    expect(engineLoad(20, 60000, small)).toBeGreaterThan(engineLoad(20, 60000));
    // No manifold pressure range: the load is the power fraction alone.
    const powerOnly = variant((p) => void (p.engines[0].engine.mapRange = null)).engines[0].engine;
    expect(engineLoad(5, 0.5 * ENGINE.ratedPowerW, powerOnly)).toBe(0.5);
    expect(engineLoad(40, 0.5 * ENGINE.ratedPowerW, powerOnly)).toBe(0.5);
    expect(engineLoad(20, -5000, powerOnly)).toBe(0);
  });

  it('take the propeller, flap and bus numbers from the profile', () => {
    const other = variant((p) => {
      p.engines[0].prop.diameterM = 1.75;
      p.engines[0].prop.cruiseThrustN = 900;
      p.flapMaxRad = 40 * DEG;
      p.busPoweredV = 10;
    });
    const prop = other.engines[0].prop;
    expect(tipMach(2550, 0, SPEED_OF_SOUND, prop)).toBe((Math.PI * 1.75 * 2550) / 60 / SPEED_OF_SOUND);
    expect(tipMach(2550, 40, SPEED_OF_SOUND, prop)).toBeLessThan(tipMach(2550, 40, SPEED_OF_SOUND));
    expect(propLoad(900, prop)).toBe(1);
    expect(propLoad(-450, prop)).toBe(0.5);
    expect(windNoise(60, 0, 40 * DEG, other).flap).toBe(1);
    expect(windNoise(60, 0, 30 * DEG, other).flap).toBe(0.75);
    // A 14 V bus runs the electric gyro at 13 V; the 28 V Cessna does not.
    expect(stepGyro(0, 0, 13, 1, other)).toBeGreaterThan(0);
    expect(stepGyro(0, 0, 13, 1)).toBe(0);
    expect(stepGyro(0, 0, 10, 1, other)).toBe(0);
  });

  /** A stalled approach with the flap motor running and the starter held. */
  function stalledState(busVoltage: number): AircraftState {
    const s = makeMockState();
    s.stallWarning = true;
    s.alpha = 16 * DEG;
    s.ias = 30;
    s.engine.rpm = 0;
    s.engine.running = false;
    s.electrical.busVoltage = busVoltage;
    return s;
  }
  const sound: SoundContext = { surface: 'runway', speedOfSound: SPEED_OF_SOUND, turbulence: 0, gyroSpin: 0, flapMotor: 1 };

  it('fillSynthParams: the bus voltage, the warner supply and the flap motor are the profile\'s', () => {
    const c = defaultControls();
    c.starter = true;

    // 13 V: dead for the 28 V Cessna, alive on a 14 V bus.
    const cessna = fillSynthParams(stalledState(13), c, sound, makeParamBlock());
    expect([cessna[P.horn], cessna[P.flapMotor], cessna[P.fan], cessna[P.starter], cessna[P.rpm]]).toEqual([0, 0, 0, 0, 0]);
    const lowVolt = variant((p) => {
      p.busPoweredV = 10;
      p.engines[0].engine.crankRpm = 140;
    });
    const alive = fillSynthParams(stalledState(13), c, sound, makeParamBlock(), lowVolt);
    expect(alive[P.horn]).toBeGreaterThan(0.9);
    expect([alive[P.flapMotor], alive[P.fan], alive[P.starter], alive[P.rpm]]).toEqual([1, 1, 1, 140]);

    // A warner that needs no electricity sounds with the bus dead; the Cessna's (as simulated) does not.
    const reed = variant((p) => void (p.stallWarner.needsBus = false));
    expect(fillSynthParams(stalledState(0), c, sound, makeParamBlock(), reed)[P.horn]).toBeGreaterThan(0.9);
    expect(fillSynthParams(stalledState(0), c, sound, makeParamBlock())[P.horn]).toBe(0);

    // Manual flaps: no motor, whatever moves.
    const manual = variant((p) => void (p.flapMotor = false));
    expect(fillSynthParams(stalledState(28), c, sound, makeParamBlock(), manual)[P.flapMotor]).toBe(0);
    expect(fillSynthParams(stalledState(28), c, sound, makeParamBlock())[P.flapMotor]).toBe(1);
  });

  it('fillSynthParams with the Cessna 172S profile fills the block it fills without one', () => {
    const s = makeMockState({ heightAGL: 900, tas: 110 * KT, rpm: 2400 });
    s.surfaces.flaps = 10 * DEG;
    const c = defaultControls();
    c.throttle = 0.75;
    const x: SoundContext = { surface: 'grass', speedOfSound: 336, turbulence: 0.2, gyroSpin: 1, flapMotor: 1 };
    expect(Array.from(fillSynthParams(s, c, x, makeParamBlock(), variant()))).toEqual(Array.from(fillSynthParams(s, c, x, makeParamBlock())));
  });

  it('SoundTracker(profile) follows a flight like SoundTracker(), and uses its own profile', () => {
    const env = { surface: () => 'grass', atmosphere: () => ({ speedOfSound: 338 }) } as unknown as Environment;
    const weather = defaultWeather();
    const c = defaultControls();
    const plain = new SoundTracker();
    const same = new SoundTracker(variant());
    const manual = new SoundTracker(variant((p) => void (p.flapMotor = false)));
    const s = makeMockState({ heightAGL: 0, rpm: 900 });
    for (const t of [plain, same, manual]) t.reset(s);
    let motorHeard = false;
    for (let i = 0; i < 120; i++) {
      // Run up, then lower the flaps.
      s.engine.rpm = s.propeller.rpm = 900 + 10 * i;
      if (i > 60) s.surfaces.flaps += 0.1 * DEG;
      const want = plain.update(s, c, env, weather, 1 / 60);
      expect(Array.from(same.update(s, c, env, weather, 1 / 60)), `frame ${i}`).toEqual(Array.from(want));
      expect(manual.update(s, c, env, weather, 1 / 60)[P.flapMotor]).toBe(0);
      motorHeard ||= want[P.flapMotor] === 1;
    }
    expect(motorHeard).toBe(true);
    expect(plain.sound.gyroSpin).toBe(same.sound.gyroSpin);
  });
});

describe('mix from the profile', () => {
  it('a stem gets a low-pass only when lowpassHz is above 0', () => {
    const mix = mixFor(
      variant((p) => {
        p.cabin.routes = [
          { stem: STEM.engine, lowpassHz: 900, gain: 0.8 },
          { stem: STEM.prop, lowpassHz: 1300, lowpassQ: 2, gain: 0.5 },
          { stem: STEM.cabin, lowpassHz: 0, gain: 1 },
        ];
        p.cabin.bus = [{ type: 'lowshelf', hz: 150, gainDb: 4, q: 0.7 }];
        p.cabin.level = 0.6;
        p.exterior.level = 1.1;
      }),
    );
    expect(mix.interiorRoutes).toEqual([
      { stem: STEM.engine, filters: [{ type: 'lowpass', frequency: 900, Q: STEM_LOWPASS_Q }], gain: 0.8 },
      { stem: STEM.prop, filters: [{ type: 'lowpass', frequency: 1300, Q: 2 }], gain: 0.5 },
      { stem: STEM.cabin, filters: [], gain: 1 },
    ]);
    expect(STEM_LOWPASS_Q).toBe(0.6);
    expect(mix.interiorBus).toEqual([{ type: 'lowshelf', frequency: 150, Q: 0.7, gainDb: 4 }]);
    expect(mix.interiorLevel).toBe(0.6);
    expect(mix.exteriorRoutes).toEqual(EXTERIOR_ROUTES);
    expect(mix.exteriorLevel).toBe(1.1);
    // The Cessna 172S profile gives the constants.
    expect(mixFor(C172S_AUDIO)).toEqual({
      interiorRoutes: INTERIOR_ROUTES,
      interiorLevel: INTERIOR_LEVEL,
      interiorBus: INTERIOR_BUS,
      exteriorRoutes: EXTERIOR_ROUTES,
      exteriorLevel: EXTERIOR_LEVEL,
    });
  });

  it('the mix model runs no biquad on an unfiltered stem', () => {
    // Deterministic full-band stems.
    let x = 0x1234567;
    const stems = Array.from({ length: 4 }, () =>
      Float32Array.from({ length: 4800 }, () => {
        x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
        return x / 0x80000000 - 1;
      }),
    );
    // Every route unfiltered at unit gain, no bus filter, unit level: the interior mix is the plain sum.
    const flat = variant((p) => {
      p.cabin.routes = [0, 1, 2, 3].map((stem) => ({ stem, lowpassHz: 0, gain: 1 }));
      p.cabin.bus = [];
      p.cabin.level = 1;
    });
    const sum = new Float32Array(4800);
    for (const s of stems) for (let i = 0; i < sum.length; i++) sum[i] += s[i];
    expect(interiorMix(stems, flat)).toEqual(sum);
    // With the Cessna 172S profile passed, the model gives the samples it gives without one.
    expect(interiorMix(stems, variant())).toEqual(interiorMix(stems));
    expect(exteriorMix(stems, 40, variant())).toEqual(exteriorMix(stems, 40));
    // A low-pass on the cabin stem (the Cessna has none) changes the mix.
    const muffled = variant((p) => void (p.cabin.routes[3].lowpassHz = 800));
    expect(interiorMix(stems, muffled)).not.toEqual(interiorMix(stems));
  });

  it('the mix model has the shelving filters of a cabin bus', () => {
    // Web Audio shelves (slope 1): the whole gain well inside the shelf, half of it (in dB) at the corner,
    // none far outside. A lowshelf of +6 dB at 200 Hz and a highshelf of -9 dB at 2 kHz, measured with sines.
    const gainDb = (type: 'lowshelf' | 'highshelf', corner: number, db: number, hz: number): number => {
      const sine = Float32Array.from({ length: 48000 }, (_, i) => Math.sin((2 * Math.PI * hz * i) / 48000));
      const out = biquad(sine, { type, frequency: corner, Q: 0, gainDb: db });
      const power = (x: Float32Array): number => x.subarray(24000).reduce((a, v) => a + v * v, 0);
      return 10 * Math.log10(power(out) / power(sine));
    };
    expect(gainDb('lowshelf', 200, 6, 20)).toBeCloseTo(6, 1);
    expect(gainDb('lowshelf', 200, 6, 200)).toBeCloseTo(3, 1);
    expect(gainDb('lowshelf', 200, 6, 4000)).toBeCloseTo(0, 1);
    expect(gainDb('highshelf', 2000, -9, 16000)).toBeCloseTo(-9, 1);
    expect(gainDb('highshelf', 2000, -9, 2000)).toBeCloseTo(-4.5, 1);
    expect(gainDb('highshelf', 2000, -9, 100)).toBeCloseTo(0, 1);
    // A cabin bus with a shelf goes through the interior mix (it threw "not modelled" before).
    const shelved = variant((p) => void (p.cabin.bus = [{ type: 'lowshelf', hz: 200, gainDb: 6, q: 0.7 }]));
    const low = [0, 1, 2, 3].map(() => Float32Array.from({ length: 48000 }, (_, i) => Math.sin((2 * Math.PI * 20 * i) / 48000)));
    const flat = variant((p) => void (p.cabin.bus = []));
    const ratio = Math.max(...interiorMix(low, shelved).subarray(24000)) / Math.max(...interiorMix(low, flat).subarray(24000));
    expect(20 * Math.log10(ratio)).toBeCloseTo(6, 1);
  });
});
