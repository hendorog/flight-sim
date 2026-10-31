// Proves the Career's performance table (src/career/perf.ts) against the aircraft definitions it must not import:
// every Career type has a row; empty mass, MTOW, MLW, ICAO type, usable fuel (the tank sum), fuel grade, class
// (helicopter, twin, turbine) and the CG figures (the empty airframe and the type's own forward and aft loadings,
// through the real mass model) equal the definition; delivery fuel is half tanks; every planning TAS is below Vno
// at the 2,000 ft planning height; the helicopters' TAS follows the vcruise rule; the da42 and ah56 are absent; the
// game-scaled buy-in pays back in 30 to 50 block hours; and none of the Career's pure modules imports an aircraft
// module (each type is a lazy chunk).

import { describe, expect, it } from 'vitest';
import { loadAircraft } from '../../src/aircraft/registry';
import { FT, KT } from '../../src/core/math';
import { atmosphereAt, casFromTas } from '../../src/physics/atmosphere';
import { createMassModel } from '../../src/physics/massModel';
import { CAREER_PERF, careerPerf, isRotorcraftClass } from '../../src/career/perf';
import { CAREER_AIRCRAFT_IDS, type CareerAircraftId } from '../../src/career/types';

const IDS: readonly CareerAircraftId[] = CAREER_AIRCRAFT_IDS;

describe('the Career performance table', () => {
  it('has exactly one row per Career type, keyed by its own id, and no row for the da42 or the ah56', () => {
    expect(Object.keys(CAREER_PERF).sort()).toEqual([...IDS].sort());
    for (const id of IDS) expect(careerPerf(id).id).toBe(id);
    expect('da42' in CAREER_PERF).toBe(false);
    expect('ah56' in CAREER_PERF).toBe(false);
  });

  it.each(IDS)('%s: masses, ICAO type, fuel and grade equal the definition', async (id) => {
    const def = await loadAircraft(id);
    const p = CAREER_PERF[id];
    expect(p.emptyKg).toBeCloseTo(def.mass.empty, 6);
    expect(p.mtowKg).toBeCloseTo(def.mass.maxTakeoff, 6);
    expect(p.mlwKg).toBeCloseTo(def.mass.maxLanding, 6);
    expect(p.icaoType).toBe(def.icaoType);
    const tanks = def.powerplant.fuel.tanks.reduce((s, t) => s + t.capacity, 0);
    expect(Math.abs(p.usableFuelKg - tanks)).toBeLessThanOrEqual(0.1);
    expect(p.deliveryFuelKg).toBeCloseTo(p.usableFuelKg / 2, 9);
    for (const e of def.powerplant.engines) expect(e.engine.fuel.name).toBe(p.fuel);
  });

  it.each(IDS)('%s: the class follows the definition (helicopter, twin, turbine) and the ratings follow the class', async (id) => {
    const def = await loadAircraft(id);
    const p = CAREER_PERF[id];
    const engines = def.powerplant.engines;
    const turbine = engines.every((e) => e.engine.kind === 'freeTurbine');
    expect(isRotorcraftClass(p.cls)).toBe(def.rotorcraft !== undefined);
    expect(p.cls === 'twin').toBe(!def.rotorcraft && engines.length === 2 && engines.every((e) => e.engine.kind === 'sparkPiston'));
    expect(p.cls === 'turbine').toBe(!def.rotorcraft && turbine);
    expect(p.cls === 'heliTurbine').toBe(def.rotorcraft !== undefined && turbine);
    expect(p.ratings.includes(def.rotorcraft ? 'heli' : 'sep')).toBe(true);
    if (p.cls === 'twin') expect(p.ratings).toContain('mep');
    if (turbine) expect(p.ratings).toContain('turbine');
    expect(p.maxDemoCrosswindKt === null).toBe(def.rotorcraft !== undefined);
    if (def.rotorcraft) {
      expect(p.minRunwayM).toBe(0);
      expect(p.grassOk).toBe(true);
    }
    expect(p.pressurised).toBe(id === 'pc12');
  });

  it.each(IDS)('%s: the empty, forward and aft CGs equal the mass model\'s within 1 mm', async (id) => {
    const def = await loadAircraft(id);
    const model = createMassModel(def.mass, def.powerplant.fuel.tanks);
    const empty = model.properties({ payload: 0, payloadPosition: { x: 0, y: 0, z: 0 }, tanks: def.powerplant.fuel.tanks.map(() => 0) });
    const cg = CAREER_PERF[id].cg;
    expect(Math.abs(cg.emptyX - empty.cgOffset.x)).toBeLessThan(1e-3);
    expect(Math.abs(cg.fwdX - model.properties(model.loadingFor('forward')).cgOffset.x)).toBeLessThan(1e-3);
    expect(Math.abs(cg.aftX - model.properties(model.loadingFor('aft')).cgOffset.x)).toBeLessThan(1e-3);
  });

  it.each(IDS)('%s: the planning TAS is below Vno at 2,000 ft ISA', async (id) => {
    const def = await loadAircraft(id);
    const kias = casFromTas(CAREER_PERF[id].cruiseTasKt * KT, atmosphereAt(2000 * FT)) / KT;
    expect(kias).toBeLessThan(def.reference.vno);
  });

  it.each(IDS.filter((id) => isRotorcraftClass(CAREER_PERF[id].cls)))('%s: the helicopter plans at vcruise plus 2 % per 1,000 ft at 2,000 ft', async (id) => {
    const def = await loadAircraft(id);
    expect(CAREER_PERF[id].cruiseTasKt).toBe(Math.round(def.reference.vcruise * 1.04));
  });

  it('owning pays back the buy-in in 30 to 50 block hours for every type', () => {
    for (const id of IDS) {
      const p = CAREER_PERF[id];
      const hours = p.buyIn / (p.leaseHourly - p.ownedHourly);
      expect(hours, id).toBeGreaterThanOrEqual(30);
      expect(hours, id).toBeLessThanOrEqual(50);
    }
  });

  it('perf, stations, costs, fit and registration import nothing under src/aircraft/', () => {
    const sources = import.meta.glob<string>('../../src/career/{perf,stations,costs,fit,registration}.ts', { query: '?raw', import: 'default', eager: true });
    expect(Object.keys(sources)).toHaveLength(5);
    for (const [path, text] of Object.entries(sources)) {
      const specifiers = [...text.matchAll(/(?:from\s+|import\s*\(\s*)['"]([^'"]+)['"]/g)].map((m) => m[1]);
      expect(specifiers.length, path).toBeGreaterThan(0);
      for (const s of specifiers) expect(s, path).not.toMatch(/(^|\/)aircraft\//);
    }
  });
});
