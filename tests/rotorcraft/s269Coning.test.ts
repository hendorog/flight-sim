import { describe, expect, it } from 'vitest';
import { DEG, quat, v3 } from '../../src/core/math';
import { defaultControls } from '../../src/core/types';
import { S269_DEFINITION } from '../../src/aircraft/s269';
import { S269_BLADE_CONING as d } from '../../src/aircraft/s269/coning';
import { S269_ARTICULATED } from '../../src/aircraft/s269/articulated';
import { articulatedBladeConing, bladeConing } from '../../src/physics/rotorcraft/coning';
import { Rotorcraft } from '../../src/physics/rotorcraft/rotorcraft';

const def = S269_DEFINITION.rotorcraft!, full = def.nominalRpm * Math.PI / 30;
const body = { time: 0, position: v3.zero(), orientation: quat.identity(), velocityBody: v3.zero(),
  angularVelocity: v3.zero(), cgOffset: v3.zero(), mass: 700 };

describe('269 physical articulated blade poses', () => {
  it('uses the existing mass integrals about the actual flap pin, not teetering inertia', () => {
    const b = S269_ARTICULATED.blade;
    expect(d.mass).toBe(b.mass);
    expect(d.inertia * 3).toBe(def.main.inertia);
    expect(d.inertia - d.mass * d.hingeRadius * d.cgRadius)
      .toBeCloseTo(b.flapInertia + S269_ARTICULATED.flapOffset * b.flapFirst, 10);
    expect(d.mass * (d.cgRadius - d.hingeRadius)).toBeCloseTo(b.flapFirst, 10);
  });

  it('sits on the droop stops at rest and rises continuously with speed and aerodynamic load', () => {
    let previous = -Infinity;
    for (let rpm = 0; rpm <= def.nominalRpm; rpm += 0.25) {
      const angle = bladeConing(d, rpm * Math.PI / 30, 50 / 3 * (rpm / 120) ** 2).angle;
      expect(angle).toBeGreaterThanOrEqual(previous - 1e-12);
      if (previous !== -Infinity) expect(angle - previous).toBeLessThan(0.02 * DEG);
      previous = angle;
    }
    expect(bladeConing(d, 0, 0).angle).toBe(d.droopStop);
    for (const rpm of [30, 60, 120])
      expect(bladeConing(d, rpm * Math.PI / 30, 50 / 3 * (rpm / 120) ** 2).angle).toBeLessThan(0);
    expect(Math.abs(bladeConing(d, full, 0).angle)).toBeLessThan(0.1 * DEG);
    const light = bladeConing(d, full, 6300 / 3), heavy = bladeConing(d, full, 7900 / 3);
    expect(light.angle).toBeGreaterThan(0);
    expect(heavy.angle).toBeGreaterThan(light.angle);
    expect(heavy.angle).toBeLessThan(4 * DEG);
    expect(bladeConing(d, full, -100).angle).toBeLessThan(bladeConing(d, full, 0).angle);
  });

  it('applies a stop to each blade and preserves free harmonic differences exactly', () => {
    const harmonics = [0.02, -0.015, -0.005];
    const free = harmonics.map(h => articulatedBladeConing(d, full, 2500, h).angle);
    expect(free.reduce((a, b) => a + b, 0) / 3).toBeCloseTo(bladeConing(d, full, 2500).angle, 12);
    free.forEach((f, i) => expect(f - free[0]).toBeCloseTo(harmonics[i] - harmonics[0], 12));
    for (const h of [-0.5, 0, 0.5]) expect(articulatedBladeConing(d, 0, 0, h).angle).toBe(d.droopStop);
    const slow = [0.03, -0.03, 0].map(h => articulatedBladeConing(d, 120 * Math.PI / 30, 50 / 3, h).angle);
    expect(Math.min(...slow)).toBe(d.droopStop);
    expect(Math.max(...slow)).toBeGreaterThan(d.droopStop);
  });

  it('publishes drooping low-RPM physics poses, including reset and shutdown from a loaded rotor', () => {
    const rotor = new Rotorcraft(def), c = defaultControls(S269_DEFINITION); c.collective = 0;
    rotor.reset(false);
    expect(rotor.state.articulated!.blades.every(b => b.flap === d.droopStop)).toBe(true);
    for (const rpm of [def.nominalRpm, 120, 60, 30, 0]) {
      rotor.state.omega = rpm * Math.PI / 30; rotor.state.rotorRpm = rpm;
      rotor.settle(body, v3.zero(), 1.225, 0, c);
      const blades = rotor.state.articulated!.blades;
      expect(blades.every(b => Number.isFinite(b.flap) && b.flap >= d.droopStop)).toBe(true);
      if (rpm <= 120) expect(blades.every(b => b.flap < 0)).toBe(true);
      if (rpm === 0) expect(blades.every(b => b.flap === d.droopStop)).toBe(true);
    }
  });

  it('uses resolved hinge moment and body-normal gravity without altering load coordinates', () => {
    const rotor = new Rotorcraft(def), c = defaultControls(S269_DEFINITION);
    rotor.reset(true);
    Object.assign(rotor.state, { thrust: 7000, coning: 0.08, flapForward: 0.025, flapRight: -0.01, azimuth: 1.3 });
    const snapshot = { ...rotor.state };
    rotor.publishBlades(c, 5, 5000);
    const mean = rotor.state.articulated!.blades.reduce((sum, b) => sum + b.flap, 0) / 3;
    expect(mean).toBeCloseTo(bladeConing(d, full, 7000 / 3, 5, 5000).angle, 12);
    for (const key of ['thrust', 'coning', 'flapForward', 'flapRight', 'omega', 'azimuth'] as const)
      expect(rotor.state[key]).toBe(snapshot[key]);
  });
});
