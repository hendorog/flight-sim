import assert from 'node:assert/strict';
import * as js from '../../src/physics/aero/linalg.ts';
import * as wasm from './backend.mjs';

let seed = 7, checked = 0;
const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
function check(n: number, source: Float64Array, rhs: Float64Array) {
  const a = source.slice(), w = source.slice(), b = rhs.slice(), c = rhs.slice();
  const p = new Int32Array(n), q = new Int32Array(n);
  const ok = js.luFactor(n, a, p);
  assert.equal(wasm.luFactor(n, w, q), ok);
  if (!ok) return;
  assert.deepEqual(q, p);
  js.luSolve(n, a, p, b);
  wasm.luSolve(n, w, q, c);
  const oracle = rhs.slice();
  assert(js.solveDenseInPlace(n, source.slice(), oracle));
  for (let i = 0; i < n; i++) {
    assert(Number.isFinite(c[i]));
    assert(Math.abs(c[i] - b[i]) <= 1e-11 * Math.max(1, Math.abs(b[i])));
    assert(Math.abs(c[i] - oracle[i]) <= 1e-10 * Math.max(1, Math.abs(oracle[i])));
    let residual = -rhs[i], magnitude = Math.abs(rhs[i]);
    for (let j = 0; j < n; j++) {
      residual += source[i * n + j] * c[j];
      magnitude += Math.abs(source[i * n + j] * c[j]);
    }
    assert(Math.abs(residual) <= 1e-11 * Math.max(1, magnitude));
  }
  // Factor once, reuse for a different RHS, as subsequent Newton stages do.
  b.fill(1); c.fill(1);
  js.luSolve(n, a, p, b); wasm.luSolve(n, w, q, c);
  for (let i = 0; i < n; i++) assert(Math.abs(c[i] - b[i]) <= 1e-11 * Math.max(1, Math.abs(b[i])));
  checked++;
}

// Existing regression: a pivot AFTER the first column (LINPACK convention).
check(4, Float64Array.from([4, 1, 2, 1, 2, .5, 3, 1, 1, 3, 1, 2, 2, 1, 1, 5]), Float64Array.from([1, 2, 3, 4]));
for (const n of [1, 2, 3, 8, 12, 16, 20, 24, 32, 40, 64]) {
  for (let trial = 0; trial < 20; trial++) {
    const a = Float64Array.from({ length: n * n }, random);
    for (let i = 0; i < n; i++) a[i * n + i] += n;
    // Row swaps force pivoting while preserving conditioning.
    for (let i = 0; i < n; i++) {
      const k = (i * 7 + trial) % n;
      for (let j = 0; j < n; j++) [a[i * n + j], a[k * n + j]] = [a[k * n + j], a[i * n + j]];
    }
    check(n, a, Float64Array.from({ length: n }, random));
  }
}
for (const a of [new Float64Array(4), Float64Array.from([1, 2, 2, 4]), Float64Array.from([1e-13, 0, 0, 1]), Float64Array.from([NaN, 0, 0, 1])]) {
  assert.equal(wasm.luFactor(2, a.slice(), new Int32Array(2)), false);
}
assert.throws(() => wasm.luFactor(65, new Float64Array(65 * 65), new Int32Array(65)), RangeError);
console.log(`Verified ${checked} systems, repeated RHS solves, pivot regression, singular/non-finite cases and bounds; WASM ${wasm.wasmBytes} bytes.`);
