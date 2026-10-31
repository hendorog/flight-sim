// Slow (tests/slow-tests.txt: about 40 s of CPU for each helicopter, 4.5 min for the file). Calibrates the Career's
// planning figures (src/career/perf.ts cruiseTasKt, fuelFlowKgH) against the real flight model: every Career type,
// fixed wing and helicopter alike, flown headless through SimPhysics on the 'cruise' scenario moved to 2,500 ft, in
// still air (no wind, gusts or turbulence), with its `typical` loading, full tanks and the type's airborne preset
// (full rich: nothing leans), the autoflight holding heading and altitude with the speed on the throttle at the
// KIAS of the table's TAS. After 60 s to settle, 3 minutes must burn the table's flow and fly the table's TAS within
// 10 %, at the held altitude, uncrashed, and (aeroplanes) without the throttle pinned at full: the type can make its
// planning speed. No helicopter needed the fallback of calibrating from its definition alone.

import { describe, expect, it } from 'vitest';
import { loadAircraft } from '../../src/aircraft/registry';
import { FT, KT } from '../../src/core/math';
import { defaultWeather } from '../../src/core/types';
import { casFromTas } from '../../src/physics/atmosphere';
import { buildScenario, type Scenario } from '../../src/sim/scenarios';
import { SimPhysics } from '../../src/sim/SimPhysics';
import { CAREER_PERF, isRotorcraftClass } from '../../src/career/perf';
import { CAREER_AIRCRAFT_IDS, type CareerAircraftId } from '../../src/career/types';

/** Calibration height, ft MSL (the planning height is 2,000 ft; 2,500 keeps the cruise track's terrain well clear). */
const ALT_FT = 2500;
/** Settling time before the measurement, and the measurement, s. */
const SETTLE_S = 60;
const MEASURE_S = 180;
/** Allowed relative error of the burn and the TAS. */
const TOLERANCE = 0.1;

const IDS: readonly CareerAircraftId[] = CAREER_AIRCRAFT_IDS;

describe('Career performance calibration', () => {
  it.each(IDS)('%s: at its planning speed at 2,500 ft for 3 minutes it burns the table flow and flies the table TAS within 10 %', async (id) => {
    const perf = CAREER_PERF[id];
    const def = await loadAircraft(id);
    const weather = { ...defaultWeather(), windSpeedKt: 0, gustKt: 0, turbulence: 0 };
    const p = new SimPhysics({ weather, aircraft: def });
    const base = buildScenario('cruise', p.env, def);
    const alt = ALT_FT * FT;
    const kias = casFromTas(perf.cruiseTasKt * KT, p.env.atmosphere(alt)) / KT;
    const sc: Scenario = {
      ...base,
      ic: { ...base.ic, position: { ...base.ic.position, z: -alt }, airspeed: perf.cruiseTasKt * KT },
      autoflight: { kind: 'hold', heading: base.ic.heading, altitude: alt, kias },
    };
    p.autoflightOnReset = true;
    p.resetTo(sc);
    const s = p.state;
    const fuel = () => s.fuel.tanks.reduce((sum, t) => sum + t.quantity, 0);

    p.step(SETTLE_S);
    const before = fuel();
    let tas = 0;
    let throttle = 0;
    let worstAltFt = 0;
    for (let i = 0; i < MEASURE_S; i++) {
      p.step(1);
      tas += s.tas / KT / MEASURE_S;
      throttle += p.controls.throttle / MEASURE_S;
      worstAltFt = Math.max(worstAltFt, Math.abs(s.altitudeMSL / FT - ALT_FT));
    }
    const burnKgH = ((before - fuel()) / MEASURE_S) * 3600;

    expect(s.crashed).toBe(false);
    expect(worstAltFt).toBeLessThan(100);
    expect(Math.abs(burnKgH / perf.fuelFlowKgH - 1), `burn ${burnKgH.toFixed(1)} kg/h`).toBeLessThanOrEqual(TOLERANCE);
    expect(Math.abs(tas / perf.cruiseTasKt - 1), `TAS ${tas.toFixed(1)} kt`).toBeLessThanOrEqual(TOLERANCE);
    if (!isRotorcraftClass(perf.cls)) expect(throttle).toBeLessThan(0.95);
  }, 240_000);
});
