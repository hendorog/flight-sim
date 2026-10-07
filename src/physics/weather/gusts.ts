// Discrete gusts: the "G" in a METAR (e.g. 27012G22KT) as a sequence of 1-cosine gusts of a few seconds,
// the standard discrete-gust shape of MIL-F-8785C 3.7.4, on top of the steady wind. Time is cut into slots;
// each slot holds at most one gust whose occurrence, timing, length, strength and direction come from a hash
// of the slot index, so the gust history is a pure deterministic function of time.

import { DEG } from '../../core/math';
import { hashUnit } from './random';

const SLOT = 10; // s
const OCCURRENCE = 0.75;
const MIN_DURATION = 2.5; // s
const MAX_DURATION = 7.5; // s
/** Gusts swing up to +/- this much off the mean wind direction. */
const DIRECTION_SPREAD = 15 * DEG;

export interface GustSample {
  /** Gust speed increment, m/s (0 between gusts). */
  speed: number;
  /** Direction offset from the mean wind, rad. */
  angle: number;
}

/**
 * Gust at time t for a gust factor `spread` (reported gust minus mean wind, m/s). Peak increments range
 * from half to all of the spread, so the reported gust speed is reached by the strongest gusts.
 */
export function gustAt(seed: number, t: number, spread: number, out: GustSample): GustSample {
  out.speed = 0;
  out.angle = 0;
  if (spread <= 0) return out;
  const slot = Math.floor(t / SLOT);
  if (hashUnit(seed, slot, 0) > OCCURRENCE) return out;
  const duration = MIN_DURATION + (MAX_DURATION - MIN_DURATION) * hashUnit(seed, slot, 1);
  const start = slot * SLOT + (SLOT - duration) * hashUnit(seed, slot, 2);
  const tau = (t - start) / duration;
  if (tau <= 0 || tau >= 1) return out;
  const peak = spread * (0.5 + 0.5 * hashUnit(seed, slot, 3));
  out.speed = peak * 0.5 * (1 - Math.cos(2 * Math.PI * tau));
  out.angle = DIRECTION_SPREAD * (2 * hashUnit(seed, slot, 4) - 1);
  return out;
}
