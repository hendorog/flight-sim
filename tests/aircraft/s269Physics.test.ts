import { describe, expect, it } from 'vitest';
import { S269_DEFINITION as d } from '../../src/aircraft/s269';
import { S269_ENGINE } from '../../src/aircraft/s269/powerplant';
import { S269_ARTICULATED } from '../../src/aircraft/s269/articulated';
import { s269Occupants } from '../../src/aircraft/s269/mass';
import { S269_RPM_LIMITS, S269_CG_LIMITS } from '../../src/aircraft/s269/limits';
import { MAIN_HUB, MAIN_ROTOR_RADIUS, SEAT_CENTRES } from '../../src/aircraft/s269/dimensions';
import { HP, LB, v3 } from '../../src/core/math';

describe('269C-1 installation, source and loading contracts', () => {
  it('retains the selected carburetted two-seat CB without STAR/governor or enabled chooser', () => {
    expect(d.placeholder).toBe(true); expect(d.rotorcraft!.systems.governorInstalled).toBe(false);
    expect(d.rotorcraft!.systems.lowRpmWarning).toBe(0);
    expect(S269_ENGINE.name).toBe('Lycoming HO-360-C1A');
    expect(S269_ENGINE.ratedPower / HP).toBe(180); expect(S269_ENGINE.ratedRpm).toBe(2700);
    expect(S269_ENGINE.displacement).toBe(361 * 0.000016387064);
    expect(S269_ENGINE.compressionRatio).toBe(8.5);
    expect(d.powerplant.fuel.tanks).toHaveLength(1);
    expect(d.powerplant.fuel.tanks[0].capacity / LB).toBeCloseTo(32.5 * 6, 10);
  });
  it('uses frozen geometry and distinct estimated pin inertias with a three-blade polar sum', () => {
    expect(d.rotorcraft!.main.hub).toBe(MAIN_HUB); expect(d.rotorcraft!.main.radius).toBe(MAIN_ROTOR_RADIUS);
    const b = S269_ARTICULATED.blade;
    expect(d.rotorcraft!.main.inertia).toBe(3 * b.polar);
    expect(b.flapInertia).toBeLessThan(b.polar); expect(b.lagInertia).toBeLessThan(b.flapInertia);
  });
  it('encodes absolute powered/unpowered RPM and rectangular CG limits from the RFM', () => {
    expect(S269_RPM_LIMITS).toEqual({ engine: [2530, 2700], powered: [442, 471], autorotation: [390, 504] });
    expect(S269_CG_LIMITS).toEqual({ forward: 95, aft: 101, left: -2.5, right: 4 });
  });
  it('retains each occupant moment and rejects impossible masses', () => {
    for (const weights of [[0, 77], [82, 65], [0, 0]] as const) {
      const p = s269Occupants(weights), moment = v3.scale(p.payloadPosition, p.payload);
      const expected = v3.add(v3.scale(SEAT_CENTRES[0], weights[0]), v3.scale(SEAT_CENTRES[1], weights[1]));
      for (const axis of ['x', 'y', 'z'] as const) expect(moment[axis]).toBeCloseTo(expected[axis], 10);
      if (p.payload > 0) expect(p.payloadDistribution!.reduce((sum, v) => sum + v.fraction, 0)).toBeCloseTo(1, 12);
    }
    expect(() => s269Occupants([-1, 0])).toThrow(); expect(() => s269Occupants([NaN, 0])).toThrow();
  });
  it('keeps representative presets within published mass/CG at full and empty fuel', () => {
    for (const loading of Object.values(d.mass.loadings)) for (const fraction of [0, 1]) {
      const fuel = d.powerplant.fuel.tanks[0], mass = d.mass.empty + loading.payload + fuel.capacity * fraction;
      const moment = v3.add(v3.add(v3.scale(d.mass.emptyCg!, d.mass.empty),
        v3.scale(loading.payloadPosition, loading.payload)), v3.scale(fuel.position, fuel.capacity * fraction));
      const cg = v3.scale(moment, 1 / mass), station = 100 - cg.x / 0.0254, lateral = cg.y / 0.0254;
      expect(mass).toBeLessThanOrEqual(d.mass.maxTakeoff + 1e-9);
      expect(station).toBeGreaterThanOrEqual(95); expect(station).toBeLessThanOrEqual(101);
      expect(lateral).toBeGreaterThanOrEqual(-2.5); expect(lateral).toBeLessThanOrEqual(4);
    }
  });
});
