import * as js from '../../src/physics/aero/linalg.ts';
export { solveDenseInPlace } from '../../src/physics/aero/linalg.ts';

export const counters = { factorCalls: 0, solveCalls: 0, factorMs: 0, solveMs: 0, sizes: {} as Record<number, number> };
export function resetCounters() {
  counters.factorCalls = counters.solveCalls = counters.factorMs = counters.solveMs = 0;
  counters.sizes = {};
}
export function luFactor(n: number, a: Float64Array, piv: Int32Array): boolean {
  const t = performance.now();
  const ok = js.luFactor(n, a, piv);
  counters.factorMs += performance.now() - t;
  counters.factorCalls++;
  counters.sizes[n] = (counters.sizes[n] ?? 0) + 1;
  return ok;
}
export function luSolve(n: number, a: Float64Array, piv: Int32Array, b: Float64Array): void {
  const t = performance.now();
  js.luSolve(n, a, piv, b);
  counters.solveMs += performance.now() - t;
  counters.solveCalls++;
}
