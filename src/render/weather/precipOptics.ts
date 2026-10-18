// Pure geometry and tables of the precipitation streaks at the camera (PrecipOverlay.ts). No three.js import, so
// every number the overlay sends to its shader is unit-tested in node (tests/render/precipOptics.test.ts).
//
// The overlay draws drops on a few spheres ("shells") of fixed radius about the camera. On each shell the drops
// are placed in cells of a grid aligned with the drops' motion relative to the camera, vRel: with theta the angle
// between a view direction and vRel and phi its azimuth about vRel, the coordinates are
//   psi = ln tan(theta / 2),  phi
// (the Mercator projection with its pole on vRel). A drop moving at vRel crosses the shell along a meridian, and
// in these coordinates every drop moves at the same rate, d(psi)/dt = -|vRel| / R, so the whole grid scrolls in psi
// by one phase per shell (shellPhase) and a streak has the same length L / R in psi everywhere on the shell. The
// projection is conformal: one unit of psi or phi spans R sin(theta) metres on the shell, which the shader uses to
// turn a distance in the grid into an angle and pixels.

import type { QualityLevel } from '../../core/context';
import type { PrecipType } from '../../core/types';

/**
 * Fall speeds in still air, m/s. Unconfirmed: typical values (rain drops of about 2 mm, drizzle drops of about
 * 0.3 mm, aggregate snowflakes) to be checked against a source before one is cited.
 */
export const FALL_SPEED_MS: Readonly<Record<PrecipType, number>> = Object.freeze({
  none: 0,
  rain: 7,
  drizzle: 2.5,
  snow: 1,
});

/** Exposure time of a streak (the motion one frame of a 60 Hz display shows), s. */
export const STREAK_EXPOSURE_S = 1 / 60;
/** Longest streak drawn, m (a drop passing the camera at more than 180 m/s). */
export const STREAK_MAX_M = 3;
/** Grid cell size on a shell as a fraction of its radius (the angular spacing of the cells, rad). Tuning value. */
export const CELL_ANGLE = 0.05;
/** Cells of the grid along psi before it repeats (a power of 2; the grid spans |psi| <= PSI_MAX). */
export const PSI_TILE = 1024;
/** |cos(theta)| is clamped below 1 - 1e-4 so psi stays finite: |psi| <= about 5.3. */
export const COS_MAX = 0.9999;
/** Below this relative speed the streak axis keeps its last direction, m/s. */
export const AXIS_MIN_SPEED = 0.05;

/** Shell radii by quality tier, m (ascending, at most 4). 'low' draws no precipitation. */
export const SHELL_RADII_M: Readonly<Record<QualityLevel, readonly number[]>> = Object.freeze({
  low: [],
  medium: [2, 6, 20],
  high: [2, 5, 12, 30],
  ultra: [2, 5, 12, 30],
});

/**
 * Rate at which every cell of a shell holds a drop, mm/h, by shell (index into SHELL_RADII_M's list, the last
 * entry repeated for further shells). Unconfirmed: tuning values for the look on index.html, not measured.
 */
export const RATE_FULL_MMH: readonly number[] = [12, 9, 7, 6];

/**
 * Multiplier on the rate for the drop count, by type: snow's rate is a liquid-water equivalent, and a millimetre of
 * water falls as many more flakes than drops. Unconfirmed: tuning values.
 */
export const RATE_COUNT_SCALE: Readonly<Record<PrecipType, number>> = Object.freeze({ none: 0, rain: 1, drizzle: 2, snow: 6 });

/** Fall speed of the precipitation type, m/s (0 for 'none'). */
export function fallSpeed(type: PrecipType): number {
  return FALL_SPEED_MS[type] ?? 0;
}

/** A 3-vector (any frame; the overlay uses three.js world axes, y up). */
export interface V3 {
  x: number;
  y: number;
  z: number;
}

/**
 * Velocity of the falling drops relative to the camera, three.js world axes (y up), m/s: the wind, minus the
 * camera's velocity, plus the fall. Written into `out`.
 */
export function relativeVelocity(wind: V3, camera: V3, fallMs: number, out: V3): V3 {
  out.x = wind.x - camera.x;
  out.y = wind.y - camera.y - fallMs;
  out.z = wind.z - camera.z;
  return out;
}

/** Length of a streak, m: the distance a drop moves relative to the camera in STREAK_EXPOSURE_S, at most STREAK_MAX_M. */
export function streakLengthM(speedMs: number): number {
  return Math.min(STREAK_MAX_M, Math.max(0, speedMs) * STREAK_EXPOSURE_S);
}

/**
 * Length of a grid cell along psi for a streak of length streakM on a shell of radius R, as a multiple of CELL_ANGLE:
 * the smallest power of 2 that holds the streak (streakM / R in psi) plus a margin of 0.3 cells, so each streak lies
 * inside its own cell and the shader reads one cell per shell. The cell is CELL_ANGLE times this long in psi.
 */
export function psiScale(streakM: number, radiusM: number): number {
  const need = streakM / radiusM / CELL_ANGLE + 0.3;
  return need <= 1 ? 1 : 2 ** Math.ceil(Math.log2(need));
}

/** Number of cells around phi on every shell (a whole number, so the grid closes at phi = +-pi). */
export const PHI_CELLS = Math.round((2 * Math.PI) / CELL_ANGLE);

/**
 * Drops the shader places in one cell, at most: a cell `scale` times CELL_ANGLE long holds min(scale, this) drops,
 * each hashed on its own, so the count can follow the rate after the cells lengthen. Tuning value (the cost is one
 * hash per drop per shell per pixel).
 */
export const MAX_DROPS_PER_CELL = 4;
/**
 * Largest factor on a drop's coverage when the rate asks for more drops than a cell holds (dropWeight). Unconfirmed:
 * tuning value.
 */
export const MAX_DROP_WEIGHT = 4;

/** Drops the shader places in a cell `scale` times CELL_ANGLE long (psiScale). */
export function dropSlots(scale: number): number {
  return Math.min(scale, MAX_DROPS_PER_CELL);
}

/**
 * Mean number of drops in a cell of shell k at rate rateMmH, for a cell `scale` times CELL_ANGLE long in psi
 * (psiScale): the rate times RATE_COUNT_SCALE[type] over RATE_FULL_MMH[k], times the cell's length, so the drops
 * per solid angle do not fall as the cells lengthen.
 */
export function dropsPerCell(rateMmH: number, shell: number, scale: number, type: PrecipType = 'rain'): number {
  const full = RATE_FULL_MMH[Math.min(shell, RATE_FULL_MMH.length - 1)];
  return ((Math.max(0, rateMmH) * (RATE_COUNT_SCALE[type] ?? 0)) / full) * scale;
}

/** Probability that each of a cell's dropSlots(scale) drops is present: dropsPerCell over the slots, at most 1. */
export function dropProbability(rateMmH: number, shell: number, scale: number, type: PrecipType = 'rain'): number {
  return Math.min(1, dropsPerCell(rateMmH, shell, scale, type) / dropSlots(scale));
}

/**
 * Factor on each drop's coverage: dropsPerCell over the slots once that exceeds 1 (every slot holds a drop), at most
 * MAX_DROP_WEIGHT, else 1. Above the rate that fills the slots, the screen's mean coverage keeps rising with the
 * rate through the drops' opacity instead of their count.
 */
export function dropWeight(rateMmH: number, shell: number, scale: number, type: PrecipType = 'rain'): number {
  return Math.min(MAX_DROP_WEIGHT, Math.max(1, dropsPerCell(rateMmH, shell, scale, type) / dropSlots(scale)));
}

/**
 * Advance a shell's psi phase by dt at the relative speed `speedMs`, wrapped into [0, cellLength * PSI_TILE)
 * (the shader hashes cell indices modulo PSI_TILE, so the wrap is invisible).
 */
export function shellPhase(phase: number, speedMs: number, radiusM: number, dt: number, cellLength: number): number {
  const period = cellLength * PSI_TILE;
  const p = (phase + (speedMs * dt) / radiusM) % period;
  return p < 0 ? p + period : p;
}

/**
 * Parallel transport of the phi = 0 reference of the grid: `u` (a unit vector perpendicular to the old axis) made
 * perpendicular to the new unit axis `a` with the least rotation. When u is (nearly) parallel to a, another
 * perpendicular is chosen. Written into `u`.
 */
export function transportReference(a: V3, u: V3): V3 {
  let d = a.x * u.x + a.y * u.y + a.z * u.z;
  let x = u.x - a.x * d;
  let y = u.y - a.y * d;
  let z = u.z - a.z * d;
  let n = Math.hypot(x, y, z);
  if (n < 1e-3) {
    // Any perpendicular: the world axis least aligned with a.
    const ax = Math.abs(a.x), ay = Math.abs(a.y), az = Math.abs(a.z);
    const r = ax <= ay && ax <= az ? { x: 1, y: 0, z: 0 } : ay <= az ? { x: 0, y: 1, z: 0 } : { x: 0, y: 0, z: 1 };
    d = a.x * r.x + a.y * r.y + a.z * r.z;
    x = r.x - a.x * d;
    y = r.y - a.y * d;
    z = r.z - a.z * d;
    n = Math.hypot(x, y, z);
  }
  u.x = x / n;
  u.y = y / n;
  u.z = z / n;
  return u;
}

/**
 * Direction a streak runs on the screen: vRel (world) rotated into view space by the 4x4 column-major
 * world-to-view matrix `view` (three.js Camera.matrixWorldInverse.elements), its x (right) and y (up) parts
 * normalised. [0, 0] when vRel is along the view axis (the streak is a point). For tests and tools; the shader
 * evaluates the same motion per pixel.
 */
export function streakAxis(vRel: V3, view: ArrayLike<number>): [x: number, y: number] {
  const x = view[0] * vRel.x + view[4] * vRel.y + view[8] * vRel.z;
  const y = view[1] * vRel.x + view[5] * vRel.y + view[9] * vRel.z;
  const n = Math.hypot(x, y);
  return n < 1e-9 ? [0, 0] : [x / n, y / n];
}

/** psi = ln tan(theta / 2) for cos(theta) = c, with |c| clamped to COS_MAX (the shader's formula). */
export function psiOf(c: number): number {
  const k = Math.max(-COS_MAX, Math.min(COS_MAX, c));
  return 0.5 * Math.log((1 - k) / (1 + k));
}
