// The geometry of a storm cell as the render draws it (StormCellEffect, the lightning overlay, the cumulus layer's
// storm terms in render/clouds/cloudModel.ts) and as the local precipitation sample reads it (stormPrecip.ts): pure
// functions, no three.js. render/weather/cellGeometry.ts re-exports this module.
//
// The centre moves with the cell (stormCentreAt); the core, anvil and rain shares of a derived cell (its selection
// weight and life cycle) scale the three densities; the base is the weather's cloudBaseM, the top the cell's topM;
// the anvil's radius is ANVIL_PER_RADIUS x the core radius (at most ANVIL_MAX_M) and its centre lies half that
// radius downwind of the steering wind (stormSteering: the surface wind veered to 2000 m, the motion of every derived
// cell; scaled down below ANVIL_FULL_DRIFT_KT); the rain shaft's radius is SHAFT_PER_RADIUS x the core radius.

import type { StormCell, WeatherSettings } from '../../core/types';
import { DEG } from '../../core/math';
import { stormCentreAt, type NorthEast } from '../../core/weatherFields';
import { hailMaxDiameterMm, hailOccurrence, hailUpdraftMs } from './hail';
import { stormShare, stormSteering } from './stormField';

/** Range of the drawn core radius, m (cellGeometry; the cumulus clearing uses the same radius). */
export const DRAWN_RADIUS_MIN_M = 500;
export const DRAWN_RADIUS_MAX_M = 8000;

/** The core radius of `cell` as the render draws it, m. */
export const drawnCoreRadiusM = (cell: StormCell): number => Math.min(DRAWN_RADIUS_MAX_M, Math.max(DRAWN_RADIUS_MIN_M, cell.radiusM));

/** Anvil radius per core radius, and its largest value, m. Unconfirmed: look values. */
export const ANVIL_PER_RADIUS = 3;
export const ANVIL_MAX_M = 18_000;
/**
 * Steering-wind speed (stormSteering) at which the anvil reaches its full downwind offset (half its radius), kt:
 * 36 kt is a 20 kt surface wind times STEERING_FACTOR 1.8. Unconfirmed: a look value.
 */
export const ANVIL_FULL_DRIFT_KT = 36;
/** Rain-shaft radius per core radius (section 3.3 of the weather plan). */
export const SHAFT_PER_RADIUS = 0.6;
/** Margin of the bounding cylinder beyond the density's support, m. */
const BOUND_MARGIN_M = 400;

/** One cell's geometry in three.js world (x east, y up MSL, z south). */
export interface CellGeometry {
  x: number;
  z: number;
  radius: number;
  base: number;
  top: number;
  intensity: number;
  /** Density shares 0..1 of the core, anvil and rain (stormField.ts ActiveStorm; 1 for a plain StormCell). */
  core: number;
  anvil: number;
  rain: number;
  anvilRadius: number;
  anvilX: number;
  anvilZ: number;
  shaftRadius: number;
  /** Largest hailstone, mm (hail.ts, from the intensity and the CAPE given to cellGeometry). */
  hailMm: number;
  /**
   * Hail share 0..1: the smaller of the rain and lightning shares (the mature stage of the life cycle) times the
   * occurrence of the largest stone (hailOccurrence).
   */
  hail: number;
  /** Offset of the cell's noise domain, m (from its id: each cell has its own turrets). */
  seedX: number;
  seedZ: number;
  /** Bounding cylinder (ground to top + 100 m): centre and radius. */
  boundX: number;
  boundZ: number;
  boundRadius: number;
}

export function makeCellGeometry(): CellGeometry {
  return { x: 0, z: 0, radius: 0, base: 0, top: 0, intensity: 0, core: 1, anvil: 1, rain: 1, anvilRadius: 0, anvilX: 0, anvilZ: 0, shaftRadius: 0, hailMm: 0, hail: 0, seedX: 0, seedZ: 0, boundX: 0, boundZ: 0, boundRadius: 0 };
}

const _ne: NorthEast = { north: 0, east: 0 };
const _steer = { fromDeg: 0, kt: 0 };

/**
 * Geometry of `cell` at simulation time t in weather w (pure; writes `out`). The core radius is clamped to
 * 500..8000 m (drawnCoreRadiusM), the intensity to 0..1, and the top to at least the base + 2000 m (the anvil's
 * depth plus 500 m; a derived cell's top never lies below it, stormField.ts MIN_GROWING_DEPTH_M). `capeJkg`: the
 * CAPE of the weather (stormField.ts StormField.convective), for the hail size; 0 leaves the updraft at the field's
 * wMax.
 */
export function cellGeometry(cell: StormCell, w: Pick<WeatherSettings, 'cloudBaseM' | 'windDirectionDeg' | 'windSpeedKt'>, t: number, out: CellGeometry, capeJkg = 0): CellGeometry {
  stormCentreAt(cell, t, _ne);
  out.x = _ne.east;
  out.z = -_ne.north;
  out.radius = drawnCoreRadiusM(cell);
  out.base = w.cloudBaseM;
  out.top = Math.max(cell.topM, out.base + 2000);
  out.intensity = Math.min(1, Math.max(0, cell.intensity));
  out.core = stormShare(cell, 'core');
  out.anvil = stormShare(cell, 'anvil');
  out.rain = stormShare(cell, 'rain');
  out.anvilRadius = Math.min(ANVIL_MAX_M, ANVIL_PER_RADIUS * out.radius);
  out.shaftRadius = SHAFT_PER_RADIUS * out.radius;
  out.hailMm = hailMaxDiameterMm(hailUpdraftMs(out.intensity, capeJkg));
  out.hail = Math.min(out.rain, stormShare(cell, 'flash')) * hailOccurrence(out.hailMm);
  // The id of a derived or explicit cell (stormField.ts ActiveStorm), 0 for a plain StormCell.
  const id = (cell as { id?: number }).id ?? 0;
  out.seedX = ((id * 7919) % 9973) * 37.1;
  out.seedZ = ((id * 104729) % 9967) * 41.3;
  // Downwind of the steering wind (where it blows FROM; a derived cell's motionDeg and motionKt); three.js x = east,
  // z = -north.
  stormSteering(w, _steer);
  const from = _steer.fromDeg * DEG;
  const drift = 0.5 * out.anvilRadius * Math.min(1, _steer.kt / ANVIL_FULL_DRIFT_KT);
  const toE = -Math.sin(from);
  const toN = -Math.cos(from);
  out.anvilX = out.x + toE * drift;
  out.anvilZ = out.z - toN * drift;
  // The cylinder around the core's footprint (its flare, 1.6 R, plus its billow, 0.35 R) and the anvil (its radius
  // plus its billow, 0.225 of it); stormGlsl.ts cellDensity.
  out.boundX = 0.5 * (out.x + out.anvilX);
  out.boundZ = 0.5 * (out.z + out.anvilZ);
  const half = 0.5 * drift;
  out.boundRadius = half + Math.max(1.95 * out.radius, 1.225 * out.anvilRadius) + BOUND_MARGIN_M;
  return out;
}
