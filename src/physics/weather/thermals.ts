// Convective thermals under a daytime fair-weather sky.
//
// Thermals sit on a jittered 2 km lattice drifting with the boundary-layer wind; each lives for 15-25 min and
// then re-forms. The vertical profile and core radius follow Allen (2006, "Updraft model for development of
// autonomous soaring uninhabited air vehicles", AIAA 2006-1510), from Lenschow & Stephens (1980):
//   mean updraft   w(z) = w* (z/zi)^(1/3) (1 - 1.1 z/zi),  peak ~3x the mean;
//   core radius    r(z) = 0.102 (z/zi)^(1/3) (1 - 0.25 z/zi) zi.
// The radial shape w ~ (1 - rho^2) exp(-rho^2), rho = r / R, has zero net mass flux: the updraft core is
// surrounded by a gentle ring of sink.

import { clamp } from '../../core/math';
import { hashUnit } from './random';

const CELL = 2000; // m
const JITTER = 0.6; // fraction of a cell
const OCCURRENCE = 0.6;
const MIN_LIFE = 900; // s
const MAX_LIFE = 1500; // s
const PEAK_TO_MEAN = 3;
/** Beyond this many core radii a thermal has no influence. */
const REACH = 3;

/**
 * Vertical air velocity (m/s, + up) from thermals at a horizontal position in the frame drifting with the
 * wind, a height above ground, the convective velocity scale w* (m/s) and the convective layer depth zi (m).
 */
export function thermalUpdraft(seed: number, x: number, y: number, heightAGL: number, t: number, wStar: number, zi: number): number {
  if (wStar <= 0 || heightAGL <= 0 || heightAGL >= 0.9 * zi) return 0;
  const zr = heightAGL / zi;
  const cube = Math.cbrt(zr);
  const shape = cube * (1 - 1.1 * zr);
  const radius = Math.max(30, 0.102 * cube * (1 - 0.25 * zr) * zi);
  const ci = Math.floor(x / CELL);
  const cj = Math.floor(y / CELL);
  let w = 0;
  for (let i = ci - 1; i <= ci + 1; i++) {
    for (let j = cj - 1; j <= cj + 1; j++) {
      if (hashUnit(seed, i, j, 0) > OCCURRENCE) continue;
      const cx = (i + 0.5 + JITTER * (hashUnit(seed, i, j, 1) - 0.5)) * CELL;
      const cy = (j + 0.5 + JITTER * (hashUnit(seed, i, j, 2) - 0.5)) * CELL;
      const r = radius * (0.7 + 0.6 * hashUnit(seed, i, j, 3));
      const rho2 = ((x - cx) ** 2 + (y - cy) ** 2) / (r * r);
      if (rho2 > REACH * REACH) continue;
      const life = MIN_LIFE + (MAX_LIFE - MIN_LIFE) * hashUnit(seed, i, j, 4);
      const cycle = Math.sin(Math.PI * (t / life + hashUnit(seed, i, j, 5)));
      const strength = (0.6 + 0.8 * hashUnit(seed, i, j, 6)) * cycle * cycle;
      w += strength * (1 - rho2) * Math.exp(-rho2);
    }
  }
  return clamp(PEAK_TO_MEAN * wStar * shape * w, -3 * wStar, 3 * wStar);
}

/** One thermal core of the lattice (see thermalCores), in the frame drifting with the wind. */
export interface ThermalCore {
  /** Core centre in the drifting frame, m (world north = x + driftN, east = y + driftE; WindField.thermalFrame). */
  x: number;
  y: number;
  /** Lattice cell of the core. */
  i: number;
  j: number;
  /** Multiplier on the height-dependent core radius r(z) (0.7..1.3). */
  radiusFactor: number;
  /** Strength now, 0..1.4 (amplitude x the life-cycle factor; 0 between generations). */
  strength: number;
  /** Life-cycle period, s, and phase now in [0, 1): the strength is amp * sin^2(PI * phase). */
  life: number;
  phase: number;
}

/** A blank core record for thermalCores' output array. */
export function makeThermalCore(): ThermalCore {
  return { x: 0, y: 0, i: 0, j: 0, radiusFactor: 1, strength: 0, life: MIN_LIFE, phase: 0 };
}

/**
 * The thermal cores that thermalUpdraft sums, enumerated from the same jittered lattice with the same hash salts
 * (read-only; for the wildlife that circles in them). Writes the cores of the (2 * reach + 1)^2 cells around
 * (x, y) (the drifting frame, as thermalUpdraft takes it) into `out` (caller-owned records, see makeThermalCore)
 * and returns how many it wrote; no allocation. Cores between generations are listed with strength 0.
 */
export function thermalCores(seed: number, x: number, y: number, t: number, out: ThermalCore[], reach = 1): number {
  const ci = Math.floor(x / CELL);
  const cj = Math.floor(y / CELL);
  let n = 0;
  for (let i = ci - reach; i <= ci + reach; i++) {
    for (let j = cj - reach; j <= cj + reach; j++) {
      if (n >= out.length) return n;
      if (hashUnit(seed, i, j, 0) > OCCURRENCE) continue;
      const c = out[n++];
      c.i = i;
      c.j = j;
      c.x = (i + 0.5 + JITTER * (hashUnit(seed, i, j, 1) - 0.5)) * CELL;
      c.y = (j + 0.5 + JITTER * (hashUnit(seed, i, j, 2) - 0.5)) * CELL;
      c.radiusFactor = 0.7 + 0.6 * hashUnit(seed, i, j, 3);
      c.life = MIN_LIFE + (MAX_LIFE - MIN_LIFE) * hashUnit(seed, i, j, 4);
      const ph = t / c.life + hashUnit(seed, i, j, 5);
      c.phase = ph - Math.floor(ph);
      const cycle = Math.sin(Math.PI * (t / c.life + hashUnit(seed, i, j, 5)));
      c.strength = (0.6 + 0.8 * hashUnit(seed, i, j, 6)) * cycle * cycle;
    }
  }
  return n;
}

/** Core radius r(z) of thermalUpdraft at a height above ground, before the per-core factor, m. */
export function thermalCoreRadius(heightAGL: number, zi: number): number {
  const zr = Math.max(0, heightAGL) / zi;
  const cube = Math.cbrt(zr);
  return Math.max(30, 0.102 * cube * (1 - 0.25 * zr) * zi);
}
