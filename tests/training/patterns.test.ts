// Pattern diagnosis (section 3.4) on synthetic series: bias, oscillation, drift, late and ok, plus the
// pattern of single-sample criteria.

import { describe, expect, it } from 'vitest';
import { HoldAccumulator } from '../../src/training/grading/accumulators';
import { diagnose, samplePattern } from '../../src/training/grading/patterns';
import type { Tol } from '../../src/training/types';

const tol: Tol = { minus: 100, plus: 100 };

function run(s: number, e: (t: number) => number, o: { targetChangeAt?: number; startAt?: number } = {}) {
  const acc = new HoldAccumulator(tol, tol, false);
  if (o.targetChangeAt !== undefined) acc.targetChanged(o.targetChangeAt);
  for (let t = o.startAt ?? 0; t < s; t += 0.1) acc.add(1000 + e(t), 1000, t, 0.1);
  return acc.summary();
}

describe('diagnose', () => {
  it('reports ok for small centred scatter', () => {
    expect(diagnose(run(60, (t) => 20 * Math.sin(t / 3)), tol, 8)).toBe('ok');
  });

  it('reports a consistent one-sided error as a bias', () => {
    expect(diagnose(run(60, (t) => 60 + 10 * Math.sin(t)), tol, 8)).toBe('biasHigh');
    expect(diagnose(run(60, (t) => -55 + 10 * Math.sin(t)), tol, 8)).toBe('biasLow');
  });

  it('does not call a large but centred error a bias', () => {
    // Mean 45 (> 0.4 tol) but a quarter of the time on the other side: not consistent.
    const s = run(60, (t) => (Math.floor(t) % 4 === 0 ? -60 : 80));
    expect(diagnose(s, tol, 8)).not.toMatch(/bias/);
  });

  it('reports chasing as an oscillation (>= 4 qualifying sign changes per minute)', () => {
    expect(diagnose(run(60, (t) => 80 * Math.sin((2 * Math.PI * t) / 20)), tol, 8)).toBe('oscillation');   // 6 per minute
    // Large swings but slow: 2 per minute is not chasing.
    expect(diagnose(run(60, (t) => 30 + 70 * Math.sin((2 * Math.PI * t) / 60)), tol, 8)).not.toBe('oscillation');
  });

  it('ignores sign changes inside half a tolerance', () => {
    expect(diagnose(run(60, (t) => 40 * Math.sin(t)), tol, 8)).toBe('ok');
  });

  it('reports a slow trend as a drift', () => {
    // -60 -> +60 over 2 minutes: slope 60 per minute > 0.5 tol, centred so not a bias.
    expect(diagnose(run(120, (t) => -60 + t), tol, 8)).toBe('drift');
  });

  it('reports a slow capture as late (> 2 settleS after the target changed)', () => {
    const s = run(60, (t) => (t < 25 ? 150 - t * 2 : 10), { targetChangeAt: 0 });
    expect(s.firstInS).toBeCloseTo(25, 0);
    expect(diagnose(s, tol, 8)).toBe('late');
    const quick = run(60, (t) => (t < 12 ? 150 - t * 5 : 10), { targetChangeAt: 0 });
    expect(diagnose(quick, tol, 8)).not.toBe('late');
  });

  it('measures late from the last target change', () => {
    const acc = new HoldAccumulator(tol, tol, false);
    for (let t = 0; t < 30; t += 0.1) acc.add(1000, 1000, t, 0.1);
    acc.targetChanged(30);
    for (let t = 30; t < 90; t += 0.1) acc.add(t < 65 ? 1300 : 1500, 1500, t, 0.1);
    expect(acc.summary().firstInS).toBeCloseTo(35, 0);
    expect(diagnose(acc.summary(), tol, 8)).toBe('late');
  });

  it('has nothing to say without samples', () => {
    expect(diagnose(new HoldAccumulator(tol, tol, false).summary(), tol, 8)).toBe('ok');
  });
});

describe('single-sample patterns', () => {
  it('calls an overshoot of a one-sided peak a late level-off', () => {
    expect(samplePattern(160, 1.07, 'max')).toBe('late');
    expect(samplePattern(-160, 1.07, 'min')).toBe('late');
    expect(samplePattern(50, 0.33, 'max')).toBe('ok');
  });
  it('names the side of other samples', () => {
    expect(samplePattern(120, 0.8, null)).toBe('biasHigh');
    expect(samplePattern(-120, 0.8, 'abs')).toBe('biasLow');
  });
});
