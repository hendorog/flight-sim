// The dense linear solves of the lifting lines (linalg.ts): LU with partial pivoting must give the same x as plain
// Gaussian elimination whenever rows are interchanged (until the C172S golden update, luFactor interchanged the
// whole rows, which with luSolve's interleaved interchanges gave a wrong x: residual 0.25 on the example below).

import { describe, expect, it } from 'vitest';
import { luFactor, luSolve, solveDenseInPlace } from '../../src/physics/aero/linalg';

/** A system that needs an interchange after the first column (the CCR's example). */
const A = [4, 1, 2, 1, 2, 0.5, 3, 1, 1, 3, 1, 2, 2, 1, 1, 5];
const B = [1, 2, 3, 4];

function residual(x: Float64Array): number {
  let worst = 0;
  for (let i = 0; i < 4; i++) {
    let s = -B[i];
    for (let j = 0; j < 4; j++) s += A[4 * i + j] * x[j];
    worst = Math.max(worst, Math.abs(s));
  }
  return worst;
}

function lu(): Float64Array {
  const a = Float64Array.from(A), b = Float64Array.from(B), piv = new Int32Array(4);
  expect(luFactor(4, a, piv)).toBe(true);
  luSolve(4, a, piv, b);
  return b;
}

describe('LU with partial pivoting', () => {
  it('solves A x = b to round-off when a row interchange happens after the first column', () => {
    const gauss = Float64Array.from(B);
    expect(solveDenseInPlace(4, Float64Array.from(A), gauss)).toBe(true);
    const x = lu();
    expect(residual(gauss)).toBeLessThan(1e-14);
    expect(residual(x)).toBeLessThan(1e-14);
    for (let i = 0; i < 4; i++) expect(x[i]).toBeCloseTo(gauss[i], 13);
  });

  it('gives the exact solution of the example, (-12, 16, 21, 27) / 37, not the whole-row interchange\'s (-0.3581, 0.3108, 0.6892, 0.7432)', () => {
    const x = lu();
    [-12, 16, 21, 27].forEach((v, i) => expect(x[i]).toBeCloseTo(v / 37, 13));
  });

  it('solves random well-conditioned systems like Gaussian elimination', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
    for (let trial = 0; trial < 50; trial++) {
      const n = 3 + (trial % 9);
      const a = new Float64Array(n * n).map(rnd);
      for (let i = 0; i < n; i++) a[i * n + i] += 0.5 * rnd();
      const b = new Float64Array(n).map(rnd);
      const g = Float64Array.from(b), f = Float64Array.from(b), piv = new Int32Array(n);
      if (!solveDenseInPlace(n, Float64Array.from(a), g)) continue;
      const lu = Float64Array.from(a);
      expect(luFactor(n, lu, piv)).toBe(true);
      luSolve(n, lu, piv, f);
      for (let i = 0; i < n; i++) expect(f[i]).toBeCloseTo(g[i], 8);
    }
  });
});
