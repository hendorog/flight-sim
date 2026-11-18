// Thermally driven slope winds (design section 6): anabatic (upslope) by day on slopes facing the sun, katabatic
// (downslope) at night under a clear sky. Along the fall line, with a profile peaking at height delta above the
// ground:
//   v = A min(1, |grad h| / FULL_SLOPE) (agl / delta) exp(1 - agl / delta) (1 - smoothstep(5, 12, |F|)),
//   day:   A = +DAY_SPEED sun(elevation) sky(cover) max(0, n . s), delta = DAY_DEPTH,
//   night: A = -NIGHT_SPEED (1 - cover) night(elevation), delta = NIGHT_DEPTH,
// n the slope normal, s the direction to the sun, F the free-atmosphere wind (a synoptic wind sweeps them away).
// The vertical part is v |grad h| (the flow follows the slope). Both terms are summed, so the field is continuous
// through dusk and dawn. All constants unconfirmed.

import { smoothstep } from '../../../core/math';

/** Peak upslope speed, m/s, and the height of the peak, m. */
const DAY_SPEED = 3;
const DAY_DEPTH = 60;
/** Peak downslope speed, m/s, and the height of the peak, m. */
const NIGHT_SPEED = 2;
const NIGHT_DEPTH = 25;
/** Slope (|grad h|) from which the slope wind is at full strength. */
const FULL_SLOPE = 0.3;
/** The free-atmosphere wind removes the slope winds between these speeds, m/s. */
const SWEEP_LOW = 5;
const SWEEP_HIGH = 12;

export interface SlopeWindSample {
  /** Horizontal wind toward north and east, m/s. */
  north: number;
  east: number;
  /** Vertical wind, m/s (+ up). */
  up: number;
}

/** The sun and sky inputs, set once per change of time or cover (SlopeWindSky.set). */
export class SlopeWindSky {
  /** Day amplitude per unit max(0, n . s), m/s. */
  day = 0;
  /** Night amplitude (negative: downslope), m/s. */
  night = 0;
  /** Direction to the sun: north, east, up. */
  sunN = 0;
  sunE = 0;
  sunU = 0;

  /** sunNED: unit vector to the sun in NED (core/world.ts sunDirectionNED); cover 0..1. */
  set(sunNorth: number, sunEast: number, sunDown: number, cover: number): void {
    this.sunN = sunNorth;
    this.sunE = sunEast;
    this.sunU = -sunDown;
    const elevation = this.sunU;
    this.day = DAY_SPEED * smoothstep(0, 0.2, elevation) * (1 - smoothstep(0.5, 0.9, cover));
    this.night = -NIGHT_SPEED * (1 - Math.min(1, Math.max(0, cover))) * (1 - smoothstep(-0.15, -0.05, elevation));
  }
}

/**
 * The slope wind at `agl` m above ground with terrain gradient (gN, gE) (dh/dnorth, dh/deast, on a 200 m baseline)
 * and free-atmosphere wind speed `freeSpeed` m/s, into `out`.
 */
export function slopeWindAt(sky: SlopeWindSky, gN: number, gE: number, agl: number, freeSpeed: number, out: SlopeWindSample): SlopeWindSample {
  out.north = out.east = out.up = 0;
  const slope = Math.hypot(gN, gE);
  if (!(slope > 0) || (sky.day === 0 && sky.night === 0)) return out;
  const sweep = 1 - smoothstep(SWEEP_LOW, SWEEP_HIGH, freeSpeed);
  if (sweep === 0) return out;
  // Unit normal of the slope (north, east, up) and its insolation.
  const nl = Math.sqrt(1 + slope * slope);
  const insolation = Math.max(0, (-gN * sky.sunN - gE * sky.sunE + sky.sunU) / nl);
  const a = agl / DAY_DEPTH;
  const b = agl / NIGHT_DEPTH;
  const v =
    (sky.day * insolation * a * Math.exp(1 - a) + sky.night * b * Math.exp(1 - b)) * Math.min(1, slope / FULL_SLOPE) * sweep;
  if (v === 0) return out;
  out.north = (v * gN) / slope;
  out.east = (v * gE) / slope;
  out.up = v * slope;
  return out;
}
