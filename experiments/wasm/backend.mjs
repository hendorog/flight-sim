import { readFileSync } from 'node:fs';

// One reusable arena, one synchronous call at a time. No buffer allocations in the hot
// path, no memory growth, no f32 conversion or fast-math. Copy costs are included.
const MAX_N = 64;
const A = 4096, P = A + MAX_N * MAX_N * 8, B = P + MAX_N * 4;
const bytes = readFileSync(new URL('./solver.wasm', import.meta.url));
const { instance } = await WebAssembly.instantiate(bytes);
const { memory, factor, solve } = instance.exports;
const aView = new Float64Array(memory.buffer, A, MAX_N * MAX_N);
const pView = new Int32Array(memory.buffer, P, MAX_N);
const bView = new Float64Array(memory.buffer, B, MAX_N);

function check(n, a, piv, b) {
  if (!Number.isInteger(n) || n < 1 || n > MAX_N || a.length !== n * n || piv.length !== n || (b && b.length !== n)) {
    throw new RangeError('WASM experiment requires square systems of size 1..64');
  }
}

export function luFactor(n, a, piv) {
  check(n, a, piv);
  aView.set(a);
  const ok = !!factor(n, A, P);
  a.set(aView.subarray(0, n * n));
  piv.set(pView.subarray(0, n));
  return ok;
}

export function luSolve(n, a, piv, b) {
  check(n, a, piv, b);
  aView.set(a);
  pView.set(piv);
  bView.set(b);
  solve(n, A, P, B);
  b.set(bView.subarray(0, n));
}

export const wasmBytes = bytes.length;
