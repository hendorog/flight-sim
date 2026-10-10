import { afterAll, describe, expect, it } from 'vitest';
import { S269_DEFINITION as def } from '../../src/aircraft/s269';
import { createFlightModelFor } from '../../src/physics';
import { Rotorcraft } from '../../src/physics/rotorcraft/rotorcraft';
import { cloneControls, defaultControls } from '../../src/core/types';
import { DEG, KT, HP, quat, v3 } from '../../src/core/math';
import { flatEnvironment } from '../fdm/helpers';
const d = def.rotorcraft!, world = flatEnvironment(undefined, 0), env = { ...world, atmosphere: () => world.atmosphere(0) };
const report: Record<string, unknown> = {};
const trace = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.S269_TRACE;
afterAll(async () => { if (trace) {
  const fs = await import(/* @vite-ignore */ 'node:fs' as string);
  fs.writeFileSync('work/s269-fm/dynamics.json', JSON.stringify(report, null, 2));
} });

describe('269 articulated reduced-model integration', () => {
  it('retains centrifugal hinge moment at zero thrust without adding a rigid-disc gyro twice', () => {
    for (const offset of [0, d.hubModel!.kind === 'articulated' ? d.hubModel!.flapHingeOffset : 0]) {
      const r = new Rotorcraft({ ...d, hubModel: { kind: 'articulated', flapHingeOffset: offset,
        lagHingeOffset: 0, lagDamper: 'elastomeric' } });
      const c = defaultControls(def), rate = { x: 0.2, y: -0.1, z: 0.03 };
      r.reset(true); r.state.flapForward = 0.05; r.state.flapRight = 0.04;
      const load = r.compute({ time: 0, position: v3.zero(), orientation: quat.identity(), velocityBody: v3.zero(),
        angularVelocity: rate, mass: 700, cgOffset: v3.zero() }, v3.zero(), 0, 100, c, 0);
      const physical = v3.sub(load.moment, v3.cross(rate, r.angularMomentum));
      expect(r.state.thrust).toBe(0);
      if (offset === 0) expect(v3.len(physical)).toBeLessThan(1e-12);
      else { expect(physical.x).toBeGreaterThan(0); expect(physical.y).toBeLessThan(0); }
    }
  });
  it('measures full-flight time-step convergence at 240/480/960 Hz against 1920 Hz', () => {
    const rows = [240, 480, 960, 1920].map(hz => {
      const fm = createFlightModelFor(def);
      fm.reset({ position: { x: 0, y: 0, z: -300 }, heading: 0, airspeed: 41 * KT,
        onGround: false, engineRunning: true, fuelFraction: 0.5 }, env);
      const c = cloneControls(fm.trimControls), elevator = c.elevator, aileron = c.aileron;
      for (let i = 0; i < hz * 2; i++) {
        const t = i / hz;
        c.elevator = elevator + 0.02 * Math.sin(Math.PI * t);
        c.aileron = aileron + 0.015 * Math.sin(Math.PI * t);
        fm.step(1 / hz, c, env);
      }
      expect(fm.state.crashed).toBe(false);
      return { hz, pitch: fm.state.pitch, roll: fm.state.roll, rpm: fm.state.rotorcraft!.rotorRpm,
        height: fm.state.altitudeAGL, speed: fm.state.ias, cone: fm.state.rotorcraft!.coning };
    });
    const fine = rows[3];
    const errors = rows.slice(0, 3).map(r => Math.hypot(r.pitch - fine.pitch, r.roll - fine.roll,
      (r.rpm - fine.rpm) / 471, (r.height - fine.height) / 100, (r.speed - fine.speed) / 50));
    report.convergence = { rows, errors };
    expect(errors[1]).toBeLessThan(errors[0]); expect(errors[2]).toBeLessThan(errors[1]);
    // Numerical resolution criterion, not a measured flight-response tolerance.
    expect(Math.abs(rows[0].pitch - fine.pitch) / DEG).toBeLessThan(0.1);
    expect(Math.abs(rows[0].rpm - fine.rpm)).toBeLessThan(0.1);
  }, 120000);
  it('reports sensitivity to ±20% estimated blade mass without recalibrating performance', () => {
    const rows = [0.8, 1, 1.2].map(scale => {
      const definition = { ...def, rotorcraft: { ...d, main: { ...d.main, inertia: d.main.inertia * scale } } };
      const fm = createFlightModelFor(definition); fm.setLoading(def.mass.loadings.maxGross);
      fm.reset({ position: { x: 0, y: 0, z: -100 }, heading: 0, airspeed: 0,
        onGround: false, engineRunning: true }, env);
      expect(fm.lastTrim?.converged).toBe(true);
      const r = fm.state.rotorcraft!;
      return { bladeKg: 15 * scale, coneDeg: r.coning / DEG, forward: r.flapForward / DEG,
        hp: r.torque * r.omega / d.transmissionEfficiency / HP, elevator: fm.trimControls.elevator };
    });
    report.massSensitivity = rows;
    expect(rows[2].coneDeg).toBeLessThan(rows[0].coneDeg);
  });
});
