// Trim solver and trimmed initial conditions. One rig flies the tests in order; since C-C5a-01 a reset no longer
// depends on the rig's history, so the order changes no number.

import { describe, expect, it } from 'vitest';
import { DEG, KT } from '../../src/core/math';
import { solveNewton } from '../../src/physics';
import { makeRig, report, resetTo } from './helpers';
import { handsOff, impossibleClimb, restOnGround, trimEnvelope } from './measure';

describe('Newton solver', () => {
  it('solves a coupled nonlinear system and respects bounds', () => {
    // x^2 + y^2 = 4, x = y  ->  (sqrt 2, sqrt 2)
    const f = (x: Float64Array, out: Float64Array) => {
      out[0] = x[0] * x[0] + x[1] * x[1] - 4;
      out[1] = x[0] - x[1];
    };
    const r = solveNewton(f, [1, 0.5], { lower: [0, 0], upper: [5, 5], step: [1e-7, 1e-7] });
    expect(r.converged).toBe(true);
    expect(r.x[0]).toBeCloseTo(Math.SQRT2, 6);
    expect(r.x[1]).toBeCloseTo(Math.SQRT2, 6);
  });
});

describe('trim', () => {
  const rig = makeRig();
  const fm = rig.fm;

  it('converges across the envelope', () => {
    const cases = [
      { kt: 60, flaps: 1, fpaDeg: -3 },
      { kt: 65, flaps: 0.33 },
      { kt: 74, fpaDeg: 5 },
      { kt: 90 },
      { kt: 110, ftAboveField: 6000 },
      { kt: 125, ftMsl: 8000 },
      { kt: 100, fpaDeg: -5 },
      { kt: 68, engineRunning: false },
    ];
    trimEnvelope(rig, cases).forEach((t, i) => {
      expect(t.converged, JSON.stringify(cases[i])).toBe(true);
      expect(t.residual).toBeLessThan(1e-5);
      // The state starts steady: no angular acceleration shows up in the first half second.
      expect(t.rate).toBeLessThan(0.2 * DEG);
    });
  });

  it('trims hands-off with the trim wheel, not the yoke, in normal flight', () => {
    const t0 = performance.now();
    resetTo(rig, { airspeed: 100 * KT });
    report('in-flight reset (trim solve) time', performance.now() - t0, '< 150', 'ms');
    // The outputs describe the trimmed state from the start: 1 g along the body normal is cos(pitch).
    expect(fm.state.gLoad).toBeCloseTo(Math.cos(fm.state.pitch), 3);
    expect(Math.abs(fm.state.slipBall)).toBeLessThan(0.05);
    expect(fm.trimControls.elevator).toBeCloseTo(0, 6);
    expect(Math.abs(fm.trimControls.elevatorTrim)).toBeLessThan(1);
  });

  it('pins the throttle and solves the flight path when the requested climb is impossible', () => {
    const t = impossibleClimb(rig, { kt: 74, fpaDeg: 15 });
    expect(t.converged).toBe(true);
    expect(t.throttle).toBe(1);
    expect(t.fpaDeg).toBeLessThan(10);
  });

  it('holds altitude and heading hands-off in trimmed cruise for 60 s in still air', () => {
    const h = handsOff(rig, { kt: 110, ftAboveField: 3000 });
    report('hands-off cruise 60 s: altitude drift', h.altDriftM, '< 15', 'm');
    report('hands-off cruise 60 s: heading drift', h.headingDriftDeg, '< 3', 'deg');
    report('hands-off cruise 60 s: max vertical speed', h.maxVsFpm, '< 50', 'fpm');
    expect(h.altDriftM).toBeLessThan(15);
    expect(h.headingDriftDeg).toBeLessThan(3);
    expect(h.tasChange).toBeLessThan(0.5);
    expect(h.maxVsFpm).toBeLessThan(50);
  }, 30000);

  it('places the aircraft at rest on its wheels with take-off trim set', () => {
    const rest = restOnGround(rig);
    expect(fm.state.onGround).toBe(true);
    expect(rest.allWheelsOnGround).toBe(true);
    expect(rest.parkingBrake).toBe(true);
    expect(rest.takeoffTrim).toBeGreaterThan(0);
    expect(rest.height).toBeGreaterThan(1.1);
    expect(rest.height).toBeLessThan(1.3);
    expect(rest.idleRpm[0]).toBeGreaterThan(600);
    expect(rest.idleRpm[0]).toBeLessThan(800);
  });
});
