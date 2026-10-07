// The Cessna 172S sound profile (src/aircraft/c172s/audio.ts) against the constants it describes: every member
// IS the constant of audio/mapping.ts, audio/mix.ts or core/c172.ts it stands for, and the synthesis worklet
// (plain JavaScript) plays it: its built-in voice is the profile itself, prepended to the worklet source as the
// JSON `DEFAULT_PROFILE` (audio/synthSource.ts), and the cylinder tables are found there as array literals.

import { describe, expect, it } from 'vitest';
import { C172S_AUDIO } from '../../src/aircraft/c172s/audio';
import {
  BUS_POWERED_V,
  CRANK_RPM,
  CRUISE_THRUST,
  MAP_FULL,
  MAP_IDLE,
  SPEED_OF_SOUND,
  crankRpm,
  engineLoad,
  fillSynthParams,
  makeParamBlock,
  propLoad,
  stepGyro,
  tipMach,
  windNoise,
  type SoundContext,
} from '../../src/audio/mapping';
import { EXTERIOR_LEVEL, EXTERIOR_ROUTES, INTERIOR_BUS, INTERIOR_LEVEL, INTERIOR_ROUTES, type StemRoute as MixRoute } from '../../src/audio/mix';
import { P, STEM } from '../../src/audio/params';
import { SYNTH_SOURCE } from '../../src/audio/synthSource';
import { C172 } from '../../src/core/c172';
import { DEG } from '../../src/core/math';
import { makeMockState } from '../../src/core/mockState';
import { defaultControls } from '../../src/core/types';

const ENGINE = C172S_AUDIO.engines[0].engine;
const PROP = C172S_AUDIO.engines[0].prop;

/** Every array literal of numbers in the worklet source (`[0.0, 0.014, -0.01, 0.008]`), as numbers. */
function workletArrays(): number[][] {
  const out: number[][] = [];
  for (const m of SYNTH_SOURCE.matchAll(/\[\s*(-?\d*\.?\d+(?:\s*,\s*-?\d*\.?\d+)+)\s*\]/g)) out.push(m[1].split(',').map(Number));
  return out;
}

/** The profile the worklet plays when it is given none: the JSON prepended to its source. */
function workletDefaultProfile(): unknown {
  const m = /^const DEFAULT_PROFILE = (.*);$/m.exec(SYNTH_SOURCE);
  return m ? JSON.parse(m[1]) : undefined;
}

describe('C172S_AUDIO: engine and propeller voice', () => {
  it('takes the mapping constants and the airframe figures by reference', () => {
    expect(ENGINE.ratedPowerW).toBe(C172.engine.ratedPower);
    expect(ENGINE.mapRange).not.toBeNull();
    expect(ENGINE.mapRange![0]).toBe(MAP_IDLE);
    expect(ENGINE.mapRange![1]).toBe(MAP_FULL);
    expect(ENGINE.crankRpm).toBe(CRANK_RPM);
    expect(PROP.blades).toBe(C172.prop.blades);
    expect(PROP.diameterM).toBe(C172.prop.diameter);
    expect(PROP.cruiseThrustN).toBe(CRUISE_THRUST);
  });

  it('is one direct-drive spark-ignition flat four at unit level', () => {
    expect(C172S_AUDIO.engines).toHaveLength(1);
    expect(ENGINE.cylinders).toBe(4);
    expect(ENGINE.combustion).toBe('spark');
    expect(ENGINE.turbo).toBeUndefined();
    expect(ENGINE.gearRatio).toBe(1);
    expect(ENGINE.level).toBe(1);
    expect(PROP.level).toBe(1);
    expect(ENGINE.firingOffsets).toHaveLength(ENGINE.cylinders);
    expect(ENGINE.cylGains).toHaveLength(ENGINE.cylinders);
  });

  it('gives the mapping functions the values they use today', () => {
    expect(engineLoad(ENGINE.mapRange![0], 0)).toBe(0);
    expect(engineLoad(ENGINE.mapRange![1], ENGINE.ratedPowerW)).toBe(0.6 * 1 + 0.4 * 1);
    expect(crankRpm(0, true, false)).toBe(ENGINE.crankRpm);
    expect(propLoad(PROP.cruiseThrustN)).toBe(1);
    expect(tipMach(2700, 0, SPEED_OF_SOUND)).toBe((Math.PI * PROP.diameterM * 2700) / 60 / SPEED_OF_SOUND);
    expect(windNoise(60, 0, C172S_AUDIO.flapMaxRad).flap).toBe(1);
    expect(windNoise(60, 0, C172S_AUDIO.flapMaxRad / 2).flap).toBe(0.5);
  });

  it('has the cylinder tables of the worklet source text', () => {
    const arrays = workletArrays();
    expect(arrays).toContainEqual([...ENGINE.firingOffsets]);
    expect(arrays).toContainEqual([...ENGINE.cylGains]);
  });

  it('is the built-in profile of the worklet source text (resonators, idle lope, cylinder and blade counts, horn)', () => {
    expect(workletDefaultProfile()).toEqual(C172S_AUDIO);
  });
});

describe('C172S_AUDIO: warning and system sounds', () => {
  it('names the bus voltage the mapping uses', () => {
    expect(C172S_AUDIO.busPoweredV).toBe(BUS_POWERED_V);
    expect(BUS_POWERED_V).toBe(20);
  });

  it('describes the equipment the mapping assumes', () => {
    expect(C172S_AUDIO.stallWarner.kind).toBe('reed');
    expect(C172S_AUDIO.stallWarner.needsBus).toBe(true);
    expect(C172S_AUDIO.flapMotor).toBe(true);
    expect(C172S_AUDIO.flapMaxRad).toBe(C172.wing.flap.maxDeflection);
    expect(C172S_AUDIO.gear).toBeNull();
    expect(C172S_AUDIO.gyros).toBe('vacuum+electric');
  });

  it('the horn, the flap motor, the fan and the electric gyro work above busPoweredV and not at it', () => {
    const s = makeMockState();
    s.stallWarning = true;
    s.alpha = 16 * DEG;
    s.ias = 30;
    const c = defaultControls();
    const x: SoundContext = { surface: 'runway', speedOfSound: SPEED_OF_SOUND, turbulence: 0, gyroSpin: 0, flapMotor: 1 };
    const out = makeParamBlock();

    s.electrical.busVoltage = C172S_AUDIO.busPoweredV;
    fillSynthParams(s, c, x, out);
    expect(out[P.horn]).toBe(0);
    expect(out[P.flapMotor]).toBe(0);
    expect(out[P.fan]).toBe(0);
    expect(stepGyro(0, 0, C172S_AUDIO.busPoweredV, 1)).toBe(0);

    s.electrical.busVoltage = C172S_AUDIO.busPoweredV + 0.5;
    fillSynthParams(s, c, x, out);
    expect(out[P.horn]).toBeGreaterThan(0.9);
    expect(out[P.flapMotor]).toBe(1);
    expect(out[P.fan]).toBe(1);
    expect(stepGyro(0, 0, C172S_AUDIO.busPoweredV + 0.5, 1)).toBeGreaterThan(0);
  });
});

describe('C172S_AUDIO: cabin and exterior mix', () => {
  /** Each route of the profile against the route of audio/mix.ts it was made from. */
  function expectRoutes(routes: readonly { stem: number; lowpassHz: number; gain: number }[], mix: MixRoute[]): void {
    expect(routes).toHaveLength(mix.length);
    mix.forEach((m, i) => {
      expect(routes[i].stem).toBe(m.stem);
      expect(routes[i].gain).toBe(m.gain);
      // The profile can say "one low-pass or none" (0) per stem: the mix must not hold anything else.
      expect(m.filters.length).toBeLessThanOrEqual(1);
      for (const f of m.filters) expect(f.type).toBe('lowpass');
      expect(routes[i].lowpassHz).toBe(m.filters.length > 0 ? m.filters[0].frequency : 0);
    });
  }

  it('cabin routes, bus and level are those of audio/mix.ts', () => {
    expectRoutes(C172S_AUDIO.cabin.routes, INTERIOR_ROUTES);
    expect(C172S_AUDIO.cabin.routes.map((r) => r.stem)).toEqual([STEM.engine, STEM.prop, STEM.airframe, STEM.cabin]);
    expect(C172S_AUDIO.cabin.routes.map((r) => r.lowpassHz > 0)).toEqual([true, true, true, false]);
    expect(C172S_AUDIO.cabin.bus).toHaveLength(INTERIOR_BUS.length);
    INTERIOR_BUS.forEach((f, i) => {
      const b = C172S_AUDIO.cabin.bus[i];
      expect(['peaking', 'lowshelf', 'highshelf']).toContain(f.type);
      expect(b.type).toBe(f.type);
      expect(b.hz).toBe(f.frequency);
      expect(b.q).toBe(f.Q);
      expect(f.gainDb).toBeDefined();
      expect(b.gainDb).toBe(f.gainDb);
    });
    expect(C172S_AUDIO.cabin.level).toBe(INTERIOR_LEVEL);
  });

  it('exterior routes and level are those of audio/mix.ts', () => {
    expectRoutes(C172S_AUDIO.exterior.routes, EXTERIOR_ROUTES);
    expect(C172S_AUDIO.exterior.routes.map((r) => r.stem)).toEqual([STEM.engine, STEM.prop, STEM.airframe]);
    expect(C172S_AUDIO.exterior.routes.every((r) => r.lowpassHz === 0)).toBe(true);
    expect(C172S_AUDIO.exterior.level).toBe(EXTERIOR_LEVEL);
  });
});

describe('C172S_AUDIO: plain data', () => {
  it('survives structuredClone (it is sent to the worklet as a message)', () => {
    const copy = structuredClone(C172S_AUDIO);
    expect(copy).toEqual(C172S_AUDIO);
    expect(copy).not.toBe(C172S_AUDIO);
    expect(copy.cabin.routes).not.toBe(C172S_AUDIO.cabin.routes);
  });

  it('survives JSON (no Infinity, NaN, undefined member or function)', () => {
    expect(JSON.parse(JSON.stringify(C172S_AUDIO))).toEqual(C172S_AUDIO);
    const walk = (v: unknown): void => {
      if (typeof v === 'number') expect(Number.isFinite(v)).toBe(true);
      else if (v !== null && typeof v === 'object') Object.values(v).forEach(walk);
      else expect(['string', 'boolean', 'object']).toContain(typeof v);
    };
    walk(C172S_AUDIO);
  });
});
