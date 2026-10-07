// Dense linear solve for the small (n < 40) Newton systems of the lifting-line solver.

/**
 * Solve A x = b in place by Gaussian elimination with partial pivoting. `a` is row-major n x n and is
 * destroyed; `b` is overwritten with x. Returns false if the matrix is numerically singular.
 */
export function solveDenseInPlace(n: number, a: Float64Array, b: Float64Array): boolean {
  for (let k = 0; k < n; k++) {
    let piv = k;
    let best = Math.abs(a[k * n + k]);
    for (let i = k + 1; i < n; i++) {
      const v = Math.abs(a[i * n + k]);
      if (v > best) {
        best = v;
        piv = i;
      }
    }
    if (!(best > 1e-12)) return false;
    if (piv !== k) {
      for (let j = k; j < n; j++) {
        const t = a[k * n + j];
        a[k * n + j] = a[piv * n + j];
        a[piv * n + j] = t;
      }
      const t = b[k];
      b[k] = b[piv];
      b[piv] = t;
    }
    const inv = 1 / a[k * n + k];
    for (let i = k + 1; i < n; i++) {
      const f = a[i * n + k] * inv;
      if (f === 0) continue;
      for (let j = k + 1; j < n; j++) a[i * n + j] -= f * a[k * n + j];
      b[i] -= f * b[k];
    }
  }
  for (let i = n - 1; i >= 0; i--) {
    let s = b[i];
    for (let j = i + 1; j < n; j++) s -= a[i * n + j] * b[j];
    b[i] = s / a[i * n + i];
  }
  return true;
}

/**
 * LU factorisation with partial pivoting, in place: `a` (row-major n x n) receives L (unit diagonal, below)
 * and U (on and above the diagonal), `piv` the row interchanges. Returns false if the matrix is numerically
 * singular (the contents are then undefined).
 *
 * A row interchange at step k moves the two rows' active parts only (columns k onward); the multipliers already
 * stored to the left stay where they are (the LINPACK convention), which is what luSolve's interleaved
 * interchanges of the right-hand side assume. (Interchanging the whole rows, multipliers included, is the LAPACK
 * convention: it pairs with a solve that permutes the right-hand side first, and with luSolve it gives a wrong x
 * whenever an interchange happens after the first column.)
 */
export function luFactor(n: number, a: Float64Array, piv: Int32Array): boolean {
  for (let k = 0; k < n; k++) {
    let p = k;
    let best = Math.abs(a[k * n + k]);
    for (let i = k + 1; i < n; i++) {
      const v = Math.abs(a[i * n + k]);
      if (v > best) {
        best = v;
        p = i;
      }
    }
    if (!(best > 1e-12)) return false;
    piv[k] = p;
    if (p !== k) {
      for (let j = k; j < n; j++) {
        const t = a[k * n + j];
        a[k * n + j] = a[p * n + j];
        a[p * n + j] = t;
      }
    }
    const inv = 1 / a[k * n + k];
    for (let i = k + 1; i < n; i++) {
      const f = a[i * n + k] * inv;
      a[i * n + k] = f;
      if (f === 0) continue;
      for (let j = k + 1; j < n; j++) a[i * n + j] -= f * a[k * n + j];
    }
  }
  return true;
}

/** Solve A x = b in place (b becomes x) with a factorisation from luFactor. */
export function luSolve(n: number, a: Float64Array, piv: Int32Array, b: Float64Array): void {
  for (let k = 0; k < n; k++) {
    const p = piv[k];
    if (p !== k) {
      const t = b[k];
      b[k] = b[p];
      b[p] = t;
    }
    const bk = b[k];
    if (bk !== 0) for (let i = k + 1; i < n; i++) b[i] -= a[i * n + k] * bk;
  }
  for (let i = n - 1; i >= 0; i--) {
    let s = b[i];
    for (let j = i + 1; j < n; j++) s -= a[i * n + j] * b[j];
    b[i] = s / a[i * n + i];
  }
}
