import { describe, expect, it } from 'vitest';
import { R22_DEFINITION as d } from '../../src/aircraft/r22';
import { R22_FUEL_CAPACITY } from '../../src/aircraft/r22/mass';
import { createFlightModelFor } from '../../src/physics';
import { KT, LB } from '../../src/core/math';
import { inflowTarget } from '../../src/physics/rotorcraft/rotor';
import { seaLevel } from './helpers';

const speeds = [0, 2, 5, 8, 10, 12, 16, 20, 40, 60, 80, 102];
const initial = { position: { x: 0, y: 0, z: -100 }, heading: 0, onGround: false, engineRunning: true };
describe('R22 airborne initialisation envelope', () => {
  it('has continuous inflow through zero disc incidence and the vortex-ring boundaries', () => {
    for (const axial of [0, -4, -12, -16]) for (const horizontal of [0, 5, 10, 16, 20]) {
      const a = inflowTarget(6100, 1.225, 3.8354, axial - 1e-6, horizontal);
      const b = inflowTarget(6100, 1.225, 3.8354, axial + 1e-6, horizontal);
      expect(Math.abs(a - b)).toBeLessThan(0.001);
    }
  });
  it('regression: 154 kg payload at x = 0.15 trims at 10 knots and neighbouring speeds/masses', () => {
    // These deliberately include the reviewer’s slightly over-gross loadings as numerical regressions.
    for (const payload of [147, 154, 161]) for (const airspeed of [5, 10, 15]) {
      const fm = createFlightModelFor(d);
      fm.setLoading({ payload, payloadPosition: { x: 0.15, y: 0, z: 0 } });
      fm.reset({ ...initial, airspeed: airspeed * KT }, seaLevel);
      expect(fm.lastTrim?.converged, `${payload} kg payload, ${airspeed} kt`).toBe(true);
      expect(fm.lastTrim!.residual).toBeLessThan(1e-4);
    }
  });
  for (const name of ['typical', 'forward', 'aft', 'maxGross'] as const)
    it(`${name} loading, depleted and full tanks, 0–102 KIAS`, () => {
      const fm = createFlightModelFor(d); fm.setLoading(d.mass.loadings[name]);
      for (const fuelFraction of [0.05, 1]) for (const speed of speeds) {
        fm.reset({ ...initial, airspeed: speed * KT, fuelFraction }, seaLevel);
        expect(fm.lastTrim?.converged, `${fuelFraction} fuel, ${speed} kt`).toBe(true);
        expect(fm.lastTrim!.residual).toBeLessThan(1e-4);
        expect(fm.state.rotorcraft!.mastBump).toBe(false);
      }
    }, 120000);
  it('trims the POH 2-5 longitudinal/lateral envelope corners, including the light aft corner', () => {
    // Equivalent ballast constructs the published CG, rather than pretending a seat loading reaches every
    // corner. Empty mass/moments stay fixed; the ballast mass and moment are explicitly solved below.
    const corners = [[920, 95.5, -0.8], [920, 95.5, 1], [920, 98, -2.2], [920, 98, 2.6],
      [920, 102, -0.5], [920, 102, 1.2], [1175, 102, 0], [1275, 95.5, 0],
      [1370, 96.5, 0], [1370, 100, 0]];
    for (const [lb, station, lateral] of corners) {
      const mass = lb * LB, fuel = 0.01, fuelMass = R22_FUEL_CAPACITY.reduce((a, b) => a + b) * fuel;
      const payload = mass - d.mass.empty - fuelMass;
      const cg = { x: (100 - station) * 0.0254, y: lateral * 0.0254, z: 0 };
      const position = { x: 0, y: 0, z: 0 };
      for (const axis of ['x', 'y', 'z'] as const) position[axis] = (mass * cg[axis] -
        d.mass.empty * d.mass.emptyCg![axis] - d.powerplant.fuel.tanks.reduce((sum, tank) =>
          sum + tank.capacity * fuel * tank.position[axis], 0)) / payload;
      const fm = createFlightModelFor(d); fm.setLoading({ payload, payloadPosition: position });
      for (const speed of speeds) {
        fm.reset({ ...initial, airspeed: speed * KT, fuelFraction: fuel }, seaLevel);
        expect(fm.massProperties.cgOffset.x).toBeCloseTo(cg.x, 8);
        expect(fm.lastTrim?.converged, `${lb} lb, station ${station}, lateral ${lateral}, ${speed} kt`).toBe(true);
        expect(fm.lastTrim!.residual).toBeLessThan(1e-4);
      }
    }
  }, 120000);
});
