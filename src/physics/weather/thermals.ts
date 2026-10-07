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
