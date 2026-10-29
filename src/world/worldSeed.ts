// The world seed of this thread (the eraState.ts pattern): one module-level value, set once at boot before the
// world is built, read on hot paths without allocation. Seed 0 is today's hand-tuned world, byte for byte; any other
// seed reshapes it: the gradient noise's permutation table (noise.ts) - hills, coast, mountains, woods, moisture -
// and a salt on the integer hashes shared with the shaders (fields, plantations, tree placement), and the random
// streams of the airport module's town, villages and farms.
//
//   setWorldSeed(n)  main thread: Simulator constructor, right after setEra (from ?seed=); terrain workers: on the
//                    setup message; dev pages: src/dev/harness.ts from ?seed=; node tests: directly (restore 0 after).
//   worldSeed()      the current seed (0 until set).
//   onWorldSeed(f)   run f whenever the seed changes (modules that build something from the noise at load).
//
// Pure (no three.js, no DOM, no imports).

let S = 0;
let SALT_X = 0;
let SALT_Y = 0;
const hooks: Array<() => void> = [];

/** The seed this thread's world is built from (0: today's world). */
export const worldSeed = (): number => S;

/** A seed from anything (a URL parameter, a number): a non-negative 32-bit integer, 0 for nothing usable. */
export function normalizeSeed(v: unknown): number {
  const n = typeof v === 'string' ? Number(v.trim()) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? Math.trunc(Math.abs(n)) >>> 0 : 0;
}

/** Set this thread's world seed; modules that registered with onWorldSeed rebuild. Returns the seed set. */
export function setWorldSeed(v: unknown): number {
  const s = normalizeSeed(v);
  if (s === S) return S;
  S = s;
  SALT_X = S === 0 ? 0 : mix(S, 0x9e3779b9) & 0xfffff;
  SALT_Y = S === 0 ? 0 : mix(S, 0x85ebca6b) & 0xfffff;
  for (const h of hooks) h();
  return S;
}

/** Call `f` whenever the world seed changes (after the change). */
export function onWorldSeed(f: () => void): void {
  hooks.push(f);
}

/** Offsets added to the integer cell coordinates of the shared hashes (noise.ts hash2i, GLSL hash2u): 0 at seed 0. */
export const seedSaltX = (): number => SALT_X;
export const seedSaltY = (): number => SALT_Y;

/** A fixed random-stream seed made specific to this world: `n` itself at seed 0. */
export function seeded(n: number): number {
  return S === 0 ? n : mix(S, n);
}

function mix(a: number, b: number): number {
  let h = (Math.imul(a, 0x27d4eb2d) ^ Math.imul(b, 0x165667b1)) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return h >>> 0;
}
