/** Rank-two, real-data matrix pencil for a uniformly sampled FREE RESPONSE.
 * Diagnostic only: arbitrary forced/closed-loop output does not identify plant poles.
 * Retains the two leading left singular vectors of the Hankel matrix, using a
 * symmetric Jacobi eigensolve of H0 H0ᵀ. Normal equations lose accuracy for weak
 * modes; the rank gate rejects those cases rather than returning confident poles.
 */
export interface Pole { re: number; im: number }
export interface PencilResult {
  discretePoles: [Pole, Pole];
  continuousPoles: [Pole, Pole];
  retainedEnergy: number;
  secondModeRatio: number;
  recurrenceError: number;
}
export function matrixPencil(samples: readonly number[], dt: number, rows = 12): PencilResult | null {
  if (!(dt > 0) || !Number.isFinite(dt) || !Number.isInteger(rows) || rows < 2 ||
      samples.length < 2 * rows + 1 || samples.some(x => !Number.isFinite(x))) return null;
  const scale = Math.max(...samples.map(Math.abs));
  if (scale < 1e-12) return null;
  const y = samples.map(x => x / scale), cols = y.length - rows;
  const covariance = Array.from({ length: rows }, () => Array(rows).fill(0) as number[]);
  const shifted = Array.from({ length: rows }, () => Array(rows).fill(0) as number[]);
  for (let i = 0; i < rows; i++) for (let j = 0; j < rows; j++) {
    for (let k = 0; k < cols; k++) {
      covariance[i][j] += y[i + k] * y[j + k];
      shifted[i][j] += y[i + k + 1] * y[j + k];
    }
  }
  const a = covariance.map(row => [...row]);
  const v = Array.from({ length: rows }, (_, i) => Array.from({ length: rows }, (_, j) => Number(i === j)));
  for (let step = 0; step < 100 * rows * rows; step++) {
    let p = 0, q = 1;
    for (let i = 0; i < rows; i++) for (let j = i + 1; j < rows; j++)
      if (Math.abs(a[i][j]) > Math.abs(a[p][q])) { p = i; q = j; }
    if (Math.abs(a[p][q]) < 1e-13 * Math.max(1, ...a.map((r, i) => Math.abs(r[i])))) break;
    const angle = 0.5 * Math.atan2(2 * a[p][q], a[q][q] - a[p][p]);
    const c = Math.cos(angle), s = Math.sin(angle), pp = a[p][p], qq = a[q][q], pq = a[p][q];
    for (let i = 0; i < rows; i++) if (i !== p && i !== q) {
      const ip = a[i][p], iq = a[i][q];
      a[i][p] = a[p][i] = c * ip - s * iq;
      a[i][q] = a[q][i] = s * ip + c * iq;
    }
    a[p][p] = c*c*pp - 2*c*s*pq + s*s*qq;
    a[q][q] = s*s*pp + 2*c*s*pq + c*c*qq;
    a[p][q] = a[q][p] = 0;
    for (let i = 0; i < rows; i++) {
      const ip = v[i][p], iq = v[i][q];
      v[i][p] = c * ip - s * iq; v[i][q] = s * ip + c * iq;
    }
  }
  const order = Array.from({ length: rows }, (_, i) => i).sort((i, j) => a[j][j] - a[i][i]);
  const eigen = order.map(i => Math.max(0, a[i][i]));
  const secondModeRatio = Math.sqrt(eigen[1] / eigen[0]);
  if (!Number.isFinite(secondModeRatio) || secondModeRatio < 1e-4) return null;
  const b = [[0, 0], [0, 0]];
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
    for (let r = 0; r < rows; r++) for (let t = 0; t < rows; t++)
      b[i][j] += v[r][order[i]] * shifted[r][t] * v[t][order[j]];
    b[i][j] /= eigen[j];
  }
  const trace = b[0][0] + b[1][1], determinant = b[0][0]*b[1][1] - b[0][1]*b[1][0];
  const discriminant = trace*trace - 4*determinant;
  const root = Math.sqrt(Math.abs(discriminant));
  const discretePoles: [Pole, Pole] = discriminant >= 0
    ? [{ re: (trace + root)/2, im: 0 }, { re: (trace - root)/2, im: 0 }]
    : [{ re: trace/2, im: root/2 }, { re: trace/2, im: -root/2 }];
  if (discretePoles.some(z => !Number.isFinite(z.re) || !Number.isFinite(z.im) || Math.hypot(z.re, z.im) < 1e-12)) return null;
  const continuousPoles = discretePoles.map(z => ({ re: Math.log(Math.hypot(z.re, z.im))/dt,
    im: Math.atan2(z.im, z.re)/dt })) as [Pole, Pole];
  let error = 0, energy = 0;
  for (let k = 0; k < y.length - 2; k++) {
    error += (y[k+2] - trace*y[k+1] + determinant*y[k]) ** 2;
    energy += y[k+2] ** 2;
  }
  return { discretePoles, continuousPoles, retainedEnergy: (eigen[0]+eigen[1])/eigen.reduce((s, x) => s+x, 0),
    secondModeRatio, recurrenceError: Math.sqrt(error / Math.max(energy, 1e-30)) };
}
