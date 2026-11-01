// The Career's own seeded random streams (docs/career.md "Job generation"): FNV-1a of a text key seeds a mulberry32
// stream (the src/physics/weather/random.ts generator), so a job board is a pure function of its key and never
// shares a stream with the world's siting (airfieldSiting.ts) or uses Math.random.
//
// A board's key is `${seed}|${day}|${origin}` (boardKey), with a salt appended for a further stream (wave 4's
// '|w4', BOARD_RULES.wave4Salt), so a new stream never moves a draw of an existing one. The helpers below each take
// a fixed number of draws (one per call, `weighted` one however many keys), which is what keeps a board's draw order
// stable; jobs.ts documents that order and tests/career/boards.golden.json pins it.

import { mulberry32 } from '../physics/weather/random';

/** FNV-1a offset basis and prime (32-bit). */
const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** 32-bit FNV-1a hash of a string's UTF-16 code units, an unsigned integer. */
export function fnv1a32(text: string): number {
  let h = FNV_OFFSET;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, FNV_PRIME);
  }
  return h >>> 0;
}

/** The key of a job board's stream: `${seed}|${day}|${origin}` plus an optional salt (wave 4: '|w4'). */
export function boardKey(seed: number, day: number, origin: string, salt = ''): string {
  return `${seed}|${day}|${origin}${salt}`;
}

/** A seeded stream of uniform numbers with the few draws the Career needs. Each method takes exactly one draw. */
export interface CareerRng {
  /** The next uniform number in [0, 1). */
  next(): number;
  /** A uniform integer in [lo, hi], both included. */
  int(lo: number, hi: number): number;
  /** A uniform number in [lo, hi). */
  range(lo: number, hi: number): number;
  /** True with probability `p` (0..1). */
  chance(p: number): boolean;
  /** One element of a non-empty list, uniformly. */
  pick<T>(list: readonly T[]): T;
  /**
   * One key by weight, renormalised over the keys given (in that order; a key with weight 0 or less is never
   * chosen). Throws if no key has a positive weight.
   */
  weighted<K>(keys: readonly K[], weightOf: (k: K) => number): K;
}

/** A CareerRng over mulberry32 seeded with `fnv1a32(key)`. */
export function careerRng(key: string): CareerRng {
  const r = mulberry32(fnv1a32(key));
  return {
    next: r,
    int: (lo, hi) => lo + Math.floor(r() * (hi - lo + 1)),
    range: (lo, hi) => lo + r() * (hi - lo),
    chance: (p) => r() < p,
    pick: (list) => {
      if (list.length === 0) throw new Error('careerRng.pick: empty list');
      return list[Math.min(list.length - 1, Math.floor(r() * list.length))];
    },
    weighted: (keys, weightOf) => {
      const w = keys.map((k) => Math.max(0, weightOf(k)));
      const total = w.reduce((s, x) => s + x, 0);
      if (!(total > 0)) throw new Error('careerRng.weighted: no positive weight');
      let x = r() * total;
      for (let i = 0; i < keys.length; i++) {
        if (w[i] <= 0) continue;
        if (x < w[i]) return keys[i];
        x -= w[i];
      }
      // Rounding at the top end: the last key with a weight.
      for (let i = keys.length - 1; i >= 0; i--) if (w[i] > 0) return keys[i];
      throw new Error('careerRng.weighted: unreachable');
    },
  };
}

/** The stream of one job board (and salt). */
export function boardRng(seed: number, day: number, origin: string, salt = ''): CareerRng {
  return careerRng(boardKey(seed, day, origin, salt));
}
