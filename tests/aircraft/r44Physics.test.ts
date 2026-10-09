import { describe, expect, it } from 'vitest';
import { R44_DEFINITION as def } from '../../src/aircraft/r44';
import { R44_ENGINE } from '../../src/aircraft/r44/powerplant';
import { R44_MASS, R44_SOLO, r44Occupants } from '../../src/aircraft/r44/mass';
import { R44_LOADING_LIMITS, r44CgLimits, r44Map, r44Vne } from '../../src/aircraft/r44/limits';
import { SEAT_CENTRES } from '../../src/aircraft/r44/dimensions';
import { createMassModel } from '../../src/physics/massModel';
import { PistonEngine } from '../../src/physics/propulsion/engine';
import { atmosphereAt } from '../../src/physics/atmosphere';
import { FT, HP, LB, v3 } from '../../src/core/math';

const tanks = def.powerplant.fuel.tanks;
const massModel = createMassModel(R44_MASS, tanks);

describe('R44 Raven II published loading and operating limits', () => {
  it('uses actual four-seat point masses and POH 6-4/6-6 moments at full and empty fuel', () => {
    const weights = [140, 180, 120, 190].map(w => w * LB) as [number, number, number, number];
    const load = r44Occupants(weights);
    expect(load.payloadDistribution).toHaveLength(4);
    expect(R44_SOLO.payloadDistribution).toHaveLength(1);
    for (const fraction of [0, 0.5, 1]) {
      const fuel = tanks.map(t => t.capacity * fraction), mp = massModel.properties({ ...load, tanks: fuel });
      let moment = v3.scale(R44_MASS.emptyCg!, R44_MASS.empty);
      SEAT_CENTRES.forEach((p, i) => { moment = v3.add(moment, v3.scale(p, weights[i])); });
      tanks.forEach((t, i) => { moment = v3.add(moment, v3.scale(t.position, fuel[i])); });
      expect(v3.len(v3.sub(mp.cgOffset, v3.scale(moment, 1 / mp.mass)))).toBeLessThan(1e-12);
      expect(mp.inertia.Ixx).toBeGreaterThan(0);
      expect(mp.inertia.Iyy).toBeGreaterThan(0);
      expect(mp.inertia.Ixx * mp.inertia.Izz - mp.inertia.Ixz ** 2).toBeGreaterThan(0);
    }
    expect(() => r44Occupants([0, -1, 0, 0])).toThrow();
    expect(() => r44Occupants([0, NaN, 0, 0])).toThrow();
    expect(r44Occupants([0, 0, 0, 0]).payload).toBe(0);
  });

  it('keeps representative presets legal at both fuel endpoints, without moving seat arms', () => {
    for (const [name, load] of Object.entries(R44_MASS.loadings)) for (const fraction of [0, 1]) {
      const mp = massModel.properties({ ...load, tanks: tanks.map(t => t.capacity * fraction) });
      const station = 100 - mp.cgOffset.x / 0.0254, lateral = mp.cgOffset.y / 0.0254;
      const limits = r44CgLimits(mp.mass, station);
      expect(limits.weightAllowed, `${name}, fuel ${fraction}`).toBe(true);
      expect(station).toBeGreaterThanOrEqual(limits.forward);
      expect(station).toBeLessThanOrEqual(limits.aft);
      expect(Math.abs(lateral)).toBeLessThanOrEqual(limits.lateral);
      for (const point of load.payloadDistribution!) {
        expect(point.fraction * load.payload).toBeLessThanOrEqual(R44_LOADING_LIMITS.seatAndBaggage);
        const position = v3.add(point.offset, load.payloadPosition);
        expect(SEAT_CENTRES.some(p => v3.len(v3.sub(p, position)) < 1e-12)).toBe(true);
      }
    }
    const gross = massModel.properties({ ...R44_MASS.loadings.maxGross, tanks: tanks.map(t => t.capacity) });
    expect(gross.mass / LB).toBeCloseTo(2500, 10);
  });

  it('represents the tapered longitudinal and lateral CG boundaries, POH 2-4', () => {
    expect(r44CgLimits(2500 * LB, 98)).toEqual({ weightAllowed: true, forward: 93, aft: 98, lateral: 3 });
    expect(r44CgLimits(2300 * LB, 100)).toEqual({ weightAllowed: true, forward: 92, aft: 100.25, lateral: 3 });
    expect(r44CgLimits(2100 * LB, 102.5).lateral).toBe(1.5);
    expect(r44CgLimits(1599 * LB, 100).weightAllowed).toBe(false);
    expect(r44CgLimits(2501 * LB, 98).weightAllowed).toBe(false);
  });

  it('computes Vne weight, autorotation, high-power and doors-off restrictions, including altitude reductions', () => {
    const light = { takeoffMass: 2200 * LB }, heavy = { takeoffMass: 2500 * LB };
    expect(r44Vne(0, 288.15, light)).toBe(130);
    expect(r44Vne(0, 288.15, heavy)).toBe(120);
    expect(r44Vne(0, 288.15, { ...heavy, powerOff: true })).toBe(100);
    expect(r44Vne(0, 288.15, { ...light, aboveMcp: true })).toBe(100);
    expect(r44Vne(0, 288.15, { ...light, doorsOff: true })).toBe(100);
    expect(r44Vne(8000 * FT, 293.15, heavy)).toBeCloseTo(91);
    expect(r44Vne(8000 * FT, 293.15, { ...heavy, powerOff: true })).toBeCloseTo(71);
    expect(r44Vne(10000 * FT, 313.15, light)).toBe(0);
    expect(r44Vne(15000 * FT, 253.15, heavy)).toBe(0);
  });

  it('interpolates finite MAP limits and recognises full-throttle cells, POH 2-9', () => {
    expect(r44Map(0, 288.15)).toBeCloseTo(22.75);
    expect(r44Map(4000 * FT, 293.15)).toBeCloseTo(21.8);
    expect(r44Map(10000 * FT, 273.15)).toBe(19.9);
    expect(r44Map(10000 * FT, 283.15)).toBe(Infinity);
    expect(r44Map(12000 * FT, 243.15)).toBe(Infinity);
  });
});

describe('IO-540-AE1A5 MAP/power cross-check', () => {
  // Independent TOP/altitude checks; only SL/15 C MCP is the calibration point. The generic
  // full-rich mixture law leaves altitude errors, reported with the actual numbers in the model notes.
  for (const ft of [0, 4000, 8000]) it(`${ft} ft: POH continuous/takeoff placard across OAT`, () => {
    for (const celsius of [-20, 15, 40]) for (const takeoff of [false, true]) {
      const a = atmosphereAt(ft * FT), engine = new PistonEngine(R44_ENGINE);
      a.temperature = celsius + 273.15; a.density = a.pressure / (287.05287 * a.temperature);
      const target = r44Map(ft * FT, a.temperature) + (takeoff ? 2.8 : 0);
      const p = { omega: 2718 * Math.PI / 30, throttle: 1, mixture: 1, magnetos: 3 as const,
        ambientPressure: a.pressure, ambientTemperature: a.temperature, ambientDensity: a.density,
        ramPressure: 0, oilTemperature: 85, accessoryPower: 0 };
      let lo = 0, hi = 1;
      for (let i = 0; i < 25; i++) {
        p.throttle = (lo + hi) / 2;
        for (let j = 0; j < 8; j++) engine.breathe(p);
        if (engine.manifoldPressure / 3386.389 > target) hi = p.throttle; else lo = p.throttle;
      }
      engine.burn(p, engine.fuelDemand);
      const hp = (engine.indicatedTorque - engine.lossTorque) * p.omega / HP;
      const rating = takeoff ? 245 : 205;
      expect(hp).toBeLessThan(rating * 1.02);
      if (p.throttle < 0.999) expect(Math.abs(hp / rating - 1)).toBeLessThan(0.08);
      else expect(hp).toBeGreaterThan(180); // WOT above critical altitude: not the placarded rating.
    }
  });
  it('has fuel injection with priming and no carburettor heat or ice model', () => {
    expect(R44_ENGINE.metering.kind).toBe('rsaInjection');
    expect(R44_ENGINE.induction.carburettor).toBeUndefined();
    expect(def.input.has.carbHeat).toBe(false);
    expect(def.powerplant.fuel.feeds[0].delivery.kind).toBe('injector');
    expect(def.powerplant.fuel.feeds[0].film.cold!.capacity).toBeGreaterThan(0);
  });
});
