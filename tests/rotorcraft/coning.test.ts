import { describe, expect, it } from 'vitest';
import { bladeBendShape, bladeConing, type BladeConingDefinition } from '../../src/physics/rotorcraft/coning';
import { R22_BLADE_CONING } from '../../src/aircraft/r22/coning';
import { R44_BLADE_CONING } from '../../src/aircraft/r44/coning';
import { R22_DEFINITION } from '../../src/aircraft/r22';
import { R44_DEFINITION } from '../../src/aircraft/r44';
import { DEG } from '../../src/core/math';

describe.each([[R22_DEFINITION, R22_BLADE_CONING], [R44_DEFINITION, R44_BLADE_CONING]] as const)
  ('%s per-blade coning balance', (aircraft, d) => {
    const rotor = aircraft.rotorcraft!, omega = rotor.nominalRpm * Math.PI / 30;
    const tipHeight = (w: number, thrust: number) => {
      const s = bladeConing(d, w, thrust);
      return (rotor.main.radius - d.hingeRadius) * Math.sin(s.angle) + s.tipBend * Math.cos(s.angle);
    };

    it('is nearly horizontal unloaded at full RPM, and cones 2–4° at gross hover', () => {
      const unloaded = bladeConing(d, omega, 0);
      expect(unloaded.angle).toBeLessThanOrEqual(d.precone);
      expect(Math.abs(unloaded.angle)).toBeLessThan(0.15 * DEG);
      const hover = bladeConing(d, omega, aircraft.mass.maxTakeoff * 9.80665 / rotor.main.blades);
      expect(hover.angle / DEG).toBeGreaterThan(2);
      expect(hover.angle / DEG).toBeLessThan(4);
      expect(Math.abs(hover.tipBend)).toBeLessThan(0.01);
    });

    it('satisfies the unconstrained moment balance with the existing rotor inertia', () => {
      expect(d.inertia * rotor.main.blades).toBe(rotor.main.inertia);
      const thrust = aircraft.mass.maxTakeoff * 9.80665 / rotor.main.blades;
      const { angle } = bladeConing(d, omega, thrust);
      const lift = thrust * (d.thrustRadius - d.hingeRadius);
      const weight = d.mass * 9.80665 * (d.cgRadius - d.hingeRadius);
      const cf = omega ** 2 * (d.inertia - d.mass * d.hingeRadius * d.cgRadius) * angle;
      expect(lift - weight).toBeCloseTo(cf + d.hingeStiffness * (angle - d.precone), 8);
    });

    it.each([0, 0.15])('droops monotonically as RPM falls with load coefficient %s', fraction => {
      let previous = Infinity;
      for (let rpm = rotor.nominalRpm; rpm >= 0; rpm -= 0.5) {
        const w = rpm * Math.PI / 30;
        // In a real shutdown aerodynamic load falls with Ω²; holding hover thrust at zero Ω
        // would physically lift the blade, so is not a valid droop test.
        const thrust = fraction * aircraft.mass.maxTakeoff * 9.80665 / rotor.main.blades * (w / omega) ** 2;
        const height = tipHeight(w, thrust);
        expect(height).toBeLessThanOrEqual(previous + 1e-10); previous = height;
      }
      const stopped = bladeConing(d, 0, 0);
      expect(stopped.angle).toBe(d.droopStop);
      expect(stopped.tipBend).toBeLessThan(-0.1);
      expect(stopped.tipBend).toBeGreaterThan(-0.2);
    });

    it('is continuous through zero RPM and droop-stop release in both directions', () => {
      const release = Math.sqrt(-d.mass * 9.80665 * (d.cgRadius - d.hingeRadius) /
        (d.droopStop * (d.inertia - d.mass * d.hingeRadius * d.cgRadius)));
      for (const w of [0, 1e-6, release, omega]) {
        const a = bladeConing(d, Math.max(0, w - 1e-7), 0), b = bladeConing(d, w + 1e-7, 0);
        expect(Math.abs(a.angle - b.angle)).toBeLessThan(1e-8);
        expect(Math.abs(a.tipBend - b.tipBend)).toBeLessThan(1e-8);
      }
      const speeds = [0, 30, 60, 120, rotor.nominalRpm];
      expect(speeds.map(rpm => bladeConing(d, rpm * Math.PI / 30, 0)))
        .toEqual([...speeds].reverse().map(rpm => bladeConing(d, rpm * Math.PI / 30, 0)).reverse());
    });

    it('increases with signed thrust, including negative thrust', () => {
      const angles = [-2000, 0, 2000, 4000, 6000].map(t => bladeConing(d, omega, t).angle);
      for (let i = 1; i < angles.length; i++) expect(angles[i]).toBeGreaterThan(angles[i - 1]);
    });
  });

it('supports an articulated blade, hinge spring/precone, resolved moments and optional upper stop', () => {
  const d: BladeConingDefinition = { mass: 10, cgRadius: 2, inertia: 50, hingeRadius: 0.2,
    thrustRadius: 3, precone: 0.02, hingeStiffness: 10000, droopStop: -0.1, coningStop: 0.15 };
  // A spring, unlike a free hinge, does enforce precone with no external load at rest.
  expect(bladeConing(d, 0, 0, 0).angle).toBe(d.precone);
  expect(bladeConing(d, 0, 0).angle).toBeCloseTo(d.precone - 10 * 9.80665 * 1.8 / 10000, 10);
  expect(bladeConing(d, 30, 20000).angle).toBe(d.coningStop);
  expect(bladeConing(d, 30, -20000).angle).toBe(d.droopStop);
  expect(bladeConing(d, 30, 1000)).toEqual(bladeConing(d, 30, 0, 9.80665, 2800));
  expect(bladeConing(d, 30, 0, -9.80665).angle).toBeGreaterThan(bladeConing(d, 30, 0).angle);
});

it('has finite free-hinge zero-speed limits and a clamped-root, unit-tip bending shape', () => {
  const free = { ...R22_BLADE_CONING, bending: undefined };
  expect(bladeConing(free, 0, 0, 0)).toEqual({ angle: 0, tipBend: 0 });
  expect(bladeConing(free, 0, 1000, 0).angle).toBe(Math.PI / 2);
  expect(bladeBendShape(-1)).toBe(0); expect(bladeBendShape(0)).toBe(0);
  expect(bladeBendShape(1)).toBe(1); expect(bladeBendShape(2)).toBe(1);
  expect(bladeBendShape(1e-6)).toBeLessThan(3e-12);
});
