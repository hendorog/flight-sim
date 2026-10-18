// Lightning strikes from the cumulonimbus cells of WeatherSettings.storms. Pure (no three.js, no DOM): the
// render overlay (render/weather/LightningOverlay.ts) asks for the strikes that began in each frame's time window,
// and the audio schedules the thunder from the 'lightning' event the overlay emits.
//
// The schedule is a function of the cells and the simulation time only. Time is cut into 1 s slots; for cell i
// and slot k a strike happens when hashUnit(seed', i, k, 0) < intensity * FLASH_PER_MIN / 60, so the expected
// rate is intensity * FLASH_PER_MIN per minute. Further hashes of (i, k) give its kind (cloud-to-ground with
// probability CG_FRACTION), its start time inside the slot, its position (uniform over the core's disc around the
// cell centre at that time, stormCentreAt), its height inside the cell, its stroke count and its energy.
// strikesBetween(t0, t1) returns the strikes whose start lies in [t0, t1): the result depends on the window only,
// so one call over an hour and 3600 calls over its seconds give the same strikes. A cell with lightning: false
// has none. The strokes of a strike (flashEnvelope) follow its start at STROKE_INTERVAL_S and each decays with
// STROKE_TAU_S.

import { hashU32, hashUnit } from '../../physics/weather/random';
import { MAX_STORMS, stormCentreAt, type NorthEast } from '../../core/weatherFields';
import type { StormCell } from '../../core/types';

/** Flashes per minute of a cell at intensity 1. Unconfirmed: a tuning value, no source checked. */
export const FLASH_PER_MIN = 6;
/** Share of the strikes that are cloud-to-ground (the rest are intracloud). Unconfirmed: a tuning value. */
export const CG_FRACTION = 0.3;
/** Return strokes per strike: STROKES_MIN + floor(STROKES_SPREAD * u), u uniform in [0, 1). */
export const STROKES_MIN = 3;
export const STROKES_SPREAD = 3;
/** Time between the strokes of a strike, s, and the decay time of each stroke's light, s. Unconfirmed: tuning values. */
export const STROKE_INTERVAL_S = 0.06;
export const STROKE_TAU_S = 0.03;
/** A strike's light is treated as over this long after its last stroke, s (exp(-10) of the stroke peak). */
export const FLASH_TAIL_S = 10 * STROKE_TAU_S;
/** Default seed of the schedule. */
export const LIGHTNING_SEED = 1;
/** Slot length, s. */
const SLOT_S = 1;
/** Mixed into the seed so the schedule does not share hashes with the other users of hashUnit. */
const SALT = 0x6c746e67;

export type StrikeKind = 'cg' | 'ic';

/** One strike. Positions are NED m (as the cells); the altitude is the share of the cell's height. */
export interface Strike {
  /** Unique per (slot, cell): slot * MAX_STORMS + cell index. */
  id: number;
  /** Index of the cell in the storms array. */
  cell: number;
  kind: StrikeKind;
  /** Simulation time of the first stroke, s. */
  tStart: number;
  /** Strike position, NED m (for a cloud-to-ground strike the channel's ground point). */
  north: number;
  east: number;
  /**
   * 0..1: the flash's height between the cloud base (0) and the cell top (1). A consumer converts it with the
   * weather's cloudBaseM and the cell's topM.
   */
  heightFrac: number;
  /** Return strokes, STROKES_MIN..STROKES_MIN + STROKES_SPREAD - 1. */
  strokes: number;
  /** Relative energy 0.5..1. */
  energy: number;
}

/** A Strike with every field zero (for pools). */
export function makeStrike(): Strike {
  return { id: 0, cell: 0, kind: 'ic', tStart: 0, north: 0, east: 0, heightFrac: 0, strokes: STROKES_MIN, energy: 0 };
}

const _centre: NorthEast = { north: 0, east: 0 };

/** Strike probability per slot of a cell (0 for lightning: false). */
export function strikeChance(cell: StormCell): number {
  if (cell.lightning === false) return 0;
  const i = Number.isFinite(cell.intensity) ? Math.min(1, Math.max(0, cell.intensity)) : 0;
  return (i * FLASH_PER_MIN * SLOT_S) / 60;
}

/**
 * The strikes of the first MAX_STORMS cells whose first stroke falls in [t0, t1), s, written into `out` (entries
 * are reused, and created only when `out` is shorter than the count), in slot order and cell order within a slot.
 * Returns the count. t1 <= t0 gives none.
 */
export function strikesBetween(cells: readonly StormCell[], t0: number, t1: number, out: Strike[], seed = LIGHTNING_SEED): number {
  if (!(t1 > t0) || cells.length === 0) return 0;
  const s = hashU32(seed ^ SALT);
  const n = Math.min(cells.length, MAX_STORMS);
  const k0 = Math.floor(t0 / SLOT_S);
  const k1 = Math.floor(t1 / SLOT_S);
  let count = 0;
  for (let k = k0; k <= k1; k++) {
    for (let i = 0; i < n; i++) {
      const cell = cells[i];
      const p = strikeChance(cell);
      if (p <= 0 || hashUnit(s, i, k, 0) >= p) continue;
      const tStart = (k + hashUnit(s, i, k, 5)) * SLOT_S;
      if (tStart < t0 || tStart >= t1) continue;
      const strike = out[count] ?? (out[count] = makeStrike());
      count++;
      strike.id = k * MAX_STORMS + i;
      strike.cell = i;
      strike.kind = hashUnit(s, i, k, 1) < CG_FRACTION ? 'cg' : 'ic';
      strike.tStart = tStart;
      stormCentreAt(cell, tStart, _centre);
      const r = Math.max(0, cell.radiusM) * Math.sqrt(hashUnit(s, i, k, 2));
      const bearing = 2 * Math.PI * hashUnit(s, i, k, 3);
      strike.north = _centre.north + r * Math.cos(bearing);
      strike.east = _centre.east + r * Math.sin(bearing);
      strike.strokes = STROKES_MIN + Math.floor(STROKES_SPREAD * hashUnit(s, i, k, 4));
      // Intracloud flashes sit in the upper two thirds of the cell; a ground strike's light is the channel's
      // cloud end, near the base.
      strike.heightFrac = strike.kind === 'cg' ? 0.05 : 0.3 + 0.6 * hashUnit(s, i, k, 6);
      strike.energy = 0.5 + 0.5 * hashUnit(s, i, k, 7);
    }
  }
  return count;
}

/**
 * Relative brightness of a strike at time t, s: the sum over its strokes of exp(-(t - t_s) / STROKE_TAU_S) for
 * t >= t_s, with t_s = tStart + STROKE_INTERVAL_S * stroke. 0 before the first stroke; 1 at a stroke's onset
 * (plus what remains of the earlier ones).
 */
export function flashEnvelope(strike: Pick<Strike, 'tStart' | 'strokes'>, t: number): number {
  let e = 0;
  for (let j = 0; j < strike.strokes; j++) {
    const dt = t - (strike.tStart + STROKE_INTERVAL_S * j);
    if (dt < 0) break;
    e += Math.exp(-dt / STROKE_TAU_S);
  }
  return e;
}

/** Simulation time after which a strike's light is over, s. */
export function flashEnd(strike: Pick<Strike, 'tStart' | 'strokes'>): number {
  return strike.tStart + STROKE_INTERVAL_S * (strike.strokes - 1) + FLASH_TAIL_S;
}
