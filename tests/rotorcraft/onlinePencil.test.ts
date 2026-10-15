import { expect, it } from 'vitest';
import { OnlinePencil } from '../../src/physics/identification/onlinePencil';

it('identifies known actuator-to-rate dynamics and bounds slow adaptation after authority changes', () => {
  const estimator = new OnlinePencil(); estimator.enabled = true;
  let y = 0, oldY = 0, oldU = 0, seed = 123;
  let accepted = false, changed = false, lastScale = 1;
  for (let k = 0; k < 1000; k++) {
    seed = (1664525*seed+1013904223) >>> 0;
    const u = (seed/4294967296-0.5)*0.4;
    const authority = k < 400 ? 1 : 1.5;
    const next = 1.4*y-0.48*oldY+authority*(0.1*u+0.03*oldU);
    oldY = y; y = next; oldU = u;
    estimator.update(0.05, y, u);
    expect(estimator.scale).toBeGreaterThanOrEqual(0.8-1e-10);
    expect(estimator.scale).toBeLessThanOrEqual(1.2+1e-10);
    expect(Math.abs(estimator.scale-lastScale)).toBeLessThanOrEqual(0.00101);
    lastScale = estimator.scale;
    if (k === 350) {
      expect(estimator.model).not.toBeNull(); accepted = true;
      const poles = estimator.model!.discretePoles.map(p => p.re).sort();
      expect(poles[0]).toBeCloseTo(0.6, 4); expect(poles[1]).toBeCloseTo(0.8, 4);
    }
    changed ||= k > 600 && estimator.scale < 0.95;
  }
  expect(accepted).toBe(true); expect(changed).toBe(true);
  estimator.enabled = false;
  for (let k = 0; k < 250; k++) estimator.update(0.05, 0, 0);
  expect(estimator.scale).toBeCloseTo(1, 6);
  expect(estimator.model).toBeNull();
});
it('does not adapt without excitation or with irregular samples', () => {
  const e = new OnlinePencil(); e.enabled = true;
  for (let k = 0; k < 300; k++) e.update(0.05, 0.1, 0.3);
  expect(e.model).toBeNull(); expect(e.scale).toBe(1); expect(e.status).toBe('awaiting excitation');
  e.update(0.07, 0.1, 0.3); expect(e.model).toBeNull(); expect(e.status).toBe('unsupported sample rate');
});
