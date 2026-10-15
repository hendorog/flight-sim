import { describe, expect, it } from 'vitest';
import { matrixPencil } from '../../src/physics/identification/matrixPencil';
import { rig, DT, seaLevel } from './helpers';

describe('rank-two free-response matrix pencil', () => {
  it('recovers two real decay poles', () => {
    const y = Array.from({ length: 200 }, (_, k) => 2*Math.exp(-k*0.02) - Math.exp(-4*k*0.02));
    const result = matrixPencil(y, 0.02)!;
    expect(result).not.toBeNull();
    const poles = result.continuousPoles.map(p => p.re).sort((a, b) => a-b);
    expect(poles[0]).toBeCloseTo(-4, 6); expect(poles[1]).toBeCloseTo(-1, 6);
    expect(result.recurrenceError).toBeLessThan(1e-10);
  });
  it('recovers a damped resonance in deterministic measurement noise', () => {
    const y = Array.from({ length: 300 }, (_, k) => Math.exp(-0.6*k*0.02)*Math.cos(5*k*0.02+0.3) + 1e-4*Math.sin(87*k));
    const r = matrixPencil(y, 0.02)!;
    expect(r.continuousPoles[0].re).toBeCloseTo(-0.6, 2);
    expect(Math.abs(r.continuousPoles[0].im)).toBeCloseTo(5, 2);
    expect(r.retainedEnergy).toBeGreaterThan(0.999);
    expect(r.recurrenceError).toBeLessThan(0.002);
  });
  it('rejects absent, rank-one and invalid information', () => {
    for (const y of [Array(100).fill(0), Array(100).fill(1), Array.from({ length: 100 }, (_, k) => Math.exp(-k*0.02)), [1, 2, NaN]])
      expect(matrixPencil(y, 0.02)).toBeNull();
    expect(matrixPencil(Array(100).fill(1), 0)).toBeNull();
    expect(matrixPencil(Array(100).fill(1), Infinity)).toBeNull();
  });
});

/** Two independent, identically trimmed trajectories remove trim drift. Only the
 * perturbed trajectory gets a short cyclic pulse; after release both use the SAME
 * constant pilot controls. No feedback poles or hidden physics states enter MPM.
 */
describe('R22 local roll identification experiment', () => {
  for (const [name, speed, gross] of [['hover-gross', 0, true], ['cruise-gross', 65, true], ['cruise-solo', 65, false]] as const) {
    it(`records the pulse response at ${name}`, () => {
      const baseline = rig(speed, gross), excited = rig(speed, gross);
      const samples: number[] = [];
      const pulse = 0.01, pulseSteps = 24, totalSteps = 504;
      const trim = excited.c.aileron;
      let maxRoll = 0;
      for (let k = 0; k < totalSteps; k++) {
        excited.c.aileron = trim + (k < pulseSteps ? pulse : 0);
        baseline.fm.step(DT, baseline.c, seaLevel); excited.fm.step(DT, excited.c, seaLevel);
        if (k >= pulseSteps && (k-pulseSteps)%4 === 0)
          samples.push(excited.fm.state.angularVelocity.x - baseline.fm.state.angularVelocity.x);
        maxRoll = Math.max(maxRoll, Math.abs(excited.fm.state.roll));
      }
      expect(baseline.fm.state.crashed).toBe(false); expect(excited.fm.state.crashed).toBe(false);
      expect(maxRoll).toBeLessThan(0.35);
      expect(samples.every(Number.isFinite)).toBe(true);
      expect(Math.max(...samples.map(Math.abs))).toBeGreaterThan(1e-5);
      const result = matrixPencil(samples, 4*DT);
      // Acceptance here is a MODEL FIT screen, never a stability certificate.
      const usable = result !== null && result.retainedEnergy > 0.99 && result.recurrenceError < 0.02;
      console.info(JSON.stringify({ experiment: name, sampleDt: 4*DT, pulse, duration: samples.length*4*DT,
        maxRoll, usable, result }));
    }, 30_000);
  }
});
