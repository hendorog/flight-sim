// Cumulonimbus cells: updraft, downdraft and outflow, and a turbulence severity, from WeatherSettings.storms.
//
// The cells are an explicit list (core/types.ts StormCell), each moving at constant velocity: the centre at time t
// is the analytic stormCentreAt(cell, t), so the field holds no state and does not depend on how often it is
// sampled. Every cell is active at constant intensity (no life cycle). Per cell, with r the horizontal distance to
// the centre and R the core radius:
//   updraft   inside the cloud (base..top): w = wMax sin(pi (a + (1 - a) s)), s = (z - base) / (top - base),
//             sin(pi a) = SUBCLOUD_FRACTION; below the base w = SUBCLOUD_FRACTION wMax agl / (base - ground). The
//             two meet at the base (SUBCLOUD_FRACTION wMax) and w is 0 at the ground and the top. Radial shape
//             exp(-(r/R)^2), tapered to 0 between 1.5 R and 2 R. wMax = 5 + 15 intensity, m/s.
//   downdraft and outflow   the Oseguera-Bowles axisymmetric field (Oseguera & Bowles 1988, NASA TM-100632),
//             centred DOWNDRAFT_OFFSET R toward where the cell moves, radius Rd = 0.5 R, z height above ground:
//               u_r = (lambda Rd^2 / (2 r)) (1 - exp(-(r/Rd)^2)) (exp(-z/z*) - exp(-z/eps))
//               w   = -lambda exp(-(r/Rd)^2) [eps (exp(-z/eps) - 1) - z* (exp(-z/z*) - 1)]
//             It is divergence-free and w = 0 at the ground. lambda is set so the peak u_r is 10 + 20 intensity
//             m/s, limited so the downdraft (lambda (z* - eps) at height) stays within DOWNDRAFT_MAX. The field is
//             tapered to 0 between 2.5 R and 3 R from its centre and between the cloud base and
//             DOWNDRAFT_TAPER_M above it or the top, whichever is lower (the tapers are not divergence-free).
//   severity  intensity * smoothstep(2.5 R, R, r) up to the top, tapered to 0 over SEVERITY_TOP_TAPER_M above it;
//             WindField passes max(weather.turbulence, severity) to the MIL-F-8785C intensities (clamped there at 1).
// A cell's share of the wind field (physics/weather/stormField.ts ActiveStorm.wind: its selection weight times its
// life cycle; 1 for a plain StormCell) multiplies its updraft, downdraft, outflow and severity; inCore needs a core
// share (ActiveStorm.core) of at least CORE_SHARE_MIN.
// Unconfirmed: wMax, the peak outflow, z*, eps, Rd / R, the downdraft offset and limit, the tapers and the severity
// shape are tuning values chosen for this model; the coefficients of the source have not been checked against it.

import { clamp, DEG, smoothstep, type Vec3 } from '../../core/math';
import type { StormCell } from '../../core/types';
import { MAX_STORMS, stormCentreAt, type NorthEast } from '../../core/weatherFields';
import { stormShare } from './stormField';

/** Updraft peak wMax = UPDRAFT_BASE + UPDRAFT_PER_INTENSITY * intensity, m/s (unconfirmed). */
export const UPDRAFT_BASE = 5;
export const UPDRAFT_PER_INTENSITY = 15;
/** Updraft at the cloud base as a fraction of wMax; below the base it falls linearly to 0 at the ground. */
export const SUBCLOUD_FRACTION = 0.4;
/** Peak radial outflow = OUTFLOW_BASE + OUTFLOW_PER_INTENSITY * intensity, m/s (unconfirmed). */
export const OUTFLOW_BASE = 10;
export const OUTFLOW_PER_INTENSITY = 20;
/** Oseguera-Bowles height scales: outflow depth z* and surface boundary-layer depth eps, m (unconfirmed). */
export const OB_Z_STAR_M = 300;
export const OB_EPSILON_M = 30;
/** Downdraft radius as a fraction of the core radius, and its centre's offset toward the cell's motion, in R. */
export const DOWNDRAFT_RADIUS = 0.5;
export const DOWNDRAFT_OFFSET = 0.6;
/**
 * Largest downdraft speed lambda (z* - eps) may reach, m/s (unconfirmed). With Rd = 0.5 R it binds, and the peak
 * outflow falls below OUTFLOW_BASE + OUTFLOW_PER_INTENSITY intensity, for R < 2914 m at intensity 1 and
 * R < 1457 m at intensity 0.5; at R = 1000 m, intensity 1, the peak outflow is 10.3 m/s.
 */
export const DOWNDRAFT_MAX = 25;
/** The downdraft and outflow fade out over this height above the cloud base (ending at the top if lower), m. */
export const DOWNDRAFT_TAPER_M = 2000;
/** The turbulence severity fades out over this height above the cell top, m. */
export const SEVERITY_TOP_TAPER_M = 1000;
/** Range of the core radius and anvil top the field uses (the StormCell contract ranges), m. */
export const CELL_RADIUS_MIN_M = 1000;
export const CELL_RADIUS_MAX_M = 5000;
export const CELL_TOP_MIN_M = 6000;
export const CELL_TOP_MAX_M = 14000;

/** Core share from which a point inside the core counts as in cloud (inCore, inStormCore). */
export const CORE_SHARE_MIN = 0.5;

/** Updraft radial taper (r / R), downdraft radial taper (r_d / R) and severity reach (r / R). */
const UPDRAFT_TAPER_START = 1.5;
const UPDRAFT_TAPER_END = 2;
const DOWNDRAFT_TAPER_START = 2.5;
const DOWNDRAFT_TAPER_END = 3;
const SEVERITY_REACH = 2.5;
/** Beyond this many core radii from the centre a cell has no influence (the downdraft offset plus its reach). */
const REACH = DOWNDRAFT_OFFSET + DOWNDRAFT_TAPER_END;
/** Smallest base-to-ground and base-to-top depth the profiles divide by, m. */
const MIN_DEPTH = 10;
/** Phase a of the in-cloud updraft: sin(pi a) = SUBCLOUD_FRACTION. */
const UPDRAFT_PHASE = Math.asin(SUBCLOUD_FRACTION) / Math.PI;

/** Peak over x > 0 of (1 - exp(-x^2)) / (2 x): the radial factor of u_r at its maximum (x = r / Rd). */
export const OB_RADIAL_PEAK = (() => {
  // The maximum solves exp(-x^2) (1 + 2 x^2) = 1; bisect on [0.5, 2], where the left side falls through 1.
  let lo = 0.5;
  let hi = 2;
  for (let i = 0; i < 60; i++) {
    const x = 0.5 * (lo + hi);
    if (Math.exp(-x * x) * (1 + 2 * x * x) > 1) lo = x;
    else hi = x;
  }
  const x = 0.5 * (lo + hi);
  return -Math.expm1(-x * x) / (2 * x);
})();
/** Peak over z of exp(-z / zStar) - exp(-z / eps), at z = ln(zStar / eps) zStar eps / (zStar - eps). */
export const OB_HEIGHT_PEAK = (() => {
  const z = (Math.log(OB_Z_STAR_M / OB_EPSILON_M) * OB_Z_STAR_M * OB_EPSILON_M) / (OB_Z_STAR_M - OB_EPSILON_M);
  return Math.exp(-z / OB_Z_STAR_M) - Math.exp(-z / OB_EPSILON_M);
})();

/** The convective wind of the storm cells at one point (CbSample is reused by the caller). */
export interface CbSample {
  /** Vertical velocity, m/s, + up (updraft plus downdraft). */
  up: number;
  /** Horizontal outflow, NED m/s. */
  outN: number;
  outE: number;
  /** Turbulence severity from the cells, 0..1 (the largest of the cells). */
  severity: number;
  /** Inside a cell's core: within R of the centre, between the cloud base and the top. */
  inCore: boolean;
}

/** Oseguera-Bowles velocity at one point: u_r / r (so u_N = q dN, u_E = q dE) and w (+ up). */
export interface ObVelocity {
  q: number;
  w: number;
}

export const emptyCbSample = (): CbSample => ({ up: 0, outN: 0, outE: 0, severity: 0, inCore: false });

/** The core radius of a cell as the field uses it, m. */
export const cellRadiusM = (cell: StormCell): number => clamp(cell.radiusM, CELL_RADIUS_MIN_M, CELL_RADIUS_MAX_M);
/** The anvil top of a cell as the field uses it, m MSL. */
export const cellTopM = (cell: StormCell): number => clamp(cell.topM, CELL_TOP_MIN_M, CELL_TOP_MAX_M);
/** The intensity of a cell as the field uses it, 0..1. */
export const cellIntensity = (cell: StormCell): number => clamp(cell.intensity, 0, 1);

/**
 * Oseguera-Bowles lambda (1/s) for a peak radial outflow `peakOutflow` (m/s) and downdraft radius `rd` (m),
 * limited so the downdraft at height, lambda (z* - eps), is at most DOWNDRAFT_MAX.
 */
export function obLambda(peakOutflow: number, rd: number): number {
  const lambda = peakOutflow / (rd * OB_RADIAL_PEAK * OB_HEIGHT_PEAK);
  return Math.min(lambda, DOWNDRAFT_MAX / (OB_Z_STAR_M - OB_EPSILON_M));
}

/**
 * The Oseguera-Bowles field at squared horizontal distance r2 (m^2) from the downdraft axis and height z above
 * ground (m), for lambda (1/s) and downdraft radius rd (m). Written into `out`; untapered.
 */
export function obVelocity(r2: number, z: number, lambda: number, rd: number, out: ObVelocity): ObVelocity {
  const x2 = r2 / (rd * rd);
  const ez = Math.exp(-z / OB_Z_STAR_M);
  const ee = Math.exp(-z / OB_EPSILON_M);
  // u_r / r = (lambda / 2) (1 - exp(-x^2)) / x^2 (exp(-z/z*) - exp(-z/eps)); (1 - exp(-x^2)) / x^2 -> 1 on the axis.
  const radial = x2 > 1e-12 ? -Math.expm1(-x2) / x2 : 1;
  out.q = 0.5 * lambda * radial * (ez - ee);
  out.w = -lambda * Math.exp(-x2) * (OB_EPSILON_M * (ee - 1) - OB_Z_STAR_M * (ez - 1));
  return out;
}

/** Centre of a cell's downdraft at time t, NED m: DOWNDRAFT_OFFSET R toward where the cell moves (motionDeg + 180). */
export function downdraftCentreAt(cell: StormCell, t: number, out: NorthEast): NorthEast {
  stormCentreAt(cell, t, out);
  const d = DOWNDRAFT_OFFSET * cellRadiusM(cell);
  const a = cell.motionDeg * DEG;
  out.north -= d * Math.cos(a);
  out.east -= d * Math.sin(a);
  return out;
}

const centre: NorthEast = { north: 0, east: 0 };
const ob: ObVelocity = { q: 0, w: 0 };

/**
 * The storm cells' wind at NED position p, time t, height above ground `agl` over ground at `groundM` MSL, with
 * the cloud base at `baseM` MSL. Reads at most the first MAX_STORMS cells; written into `out`.
 */
export function cbSample(cells: readonly StormCell[], p: Vec3, t: number, agl: number, groundM: number, baseM: number, out: CbSample): CbSample {
  out.up = out.outN = out.outE = out.severity = 0;
  out.inCore = false;
  const alt = -p.z;
  const n = Math.min(cells.length, MAX_STORMS);
  for (let i = 0; i < n; i++) {
    const cell = cells[i];
    const R = cellRadiusM(cell);
    stormCentreAt(cell, t, centre);
    const dN = p.x - centre.north;
    const dE = p.y - centre.east;
    const r2 = dN * dN + dE * dE;
    if (r2 > REACH * REACH * R * R) continue;
    const r = Math.sqrt(r2);
    const top = cellTopM(cell);
    const intensity = cellIntensity(cell);
    const share = stormShare(cell, 'wind');

    // Updraft: under and inside the core.
    if (r < UPDRAFT_TAPER_END * R && alt < top) {
      const wMax = UPDRAFT_BASE + UPDRAFT_PER_INTENSITY * intensity;
      const radial = Math.exp(-r2 / (R * R)) * (1 - smoothstep(UPDRAFT_TAPER_START * R, UPDRAFT_TAPER_END * R, r));
      let profile: number;
      if (alt >= baseM) {
        const s = (alt - baseM) / Math.max(MIN_DEPTH, top - baseM);
        profile = Math.sin(Math.PI * (UPDRAFT_PHASE + (1 - UPDRAFT_PHASE) * s));
      } else {
        profile = SUBCLOUD_FRACTION * Math.min(1, agl / Math.max(MIN_DEPTH, baseM - groundM));
      }
      out.up += wMax * profile * radial * share;
    }

    // Downdraft and outflow, centred toward where the cell moves.
    const a = cell.motionDeg * DEG;
    const ddN = dN + DOWNDRAFT_OFFSET * R * Math.cos(a);
    const ddE = dE + DOWNDRAFT_OFFSET * R * Math.sin(a);
    const rd2 = ddN * ddN + ddE * ddE;
    const taperEnd = Math.max(baseM + MIN_DEPTH, Math.min(baseM + DOWNDRAFT_TAPER_M, top));
    const taperV = 1 - smoothstep(baseM, taperEnd, alt);
    if (rd2 < DOWNDRAFT_TAPER_END * DOWNDRAFT_TAPER_END * R * R && taperV > 0) {
      const rd = DOWNDRAFT_RADIUS * R;
      obVelocity(rd2, agl, obLambda(OUTFLOW_BASE + OUTFLOW_PER_INTENSITY * intensity, rd), rd, ob);
      const taper = taperV * (1 - smoothstep(DOWNDRAFT_TAPER_START * R, DOWNDRAFT_TAPER_END * R, Math.sqrt(rd2))) * share;
      out.outN += ob.q * ddN * taper;
      out.outE += ob.q * ddE * taper;
      out.up += ob.w * taper;
    }

    // Turbulence in and around the cell, up to the top.
    const severity = intensity * smoothstep(SEVERITY_REACH * R, R, r) * (1 - smoothstep(top, top + SEVERITY_TOP_TAPER_M, alt)) * share;
    if (severity > out.severity) out.severity = severity;
    if (r < R && alt >= baseM && alt <= top && stormShare(cell, 'core') >= CORE_SHARE_MIN) out.inCore = true;
  }
  return out;
}

/**
 * Turbulence severity of the cells at NED position p, time t, 0..1 (the severity part of cbSample alone; the
 * vertical taper above the top uses the altitude -p.z).
 */
export function cbSeverity(cells: readonly StormCell[], p: Vec3, t: number): number {
  let best = 0;
  const alt = -p.z;
  const n = Math.min(cells.length, MAX_STORMS);
  for (let i = 0; i < n; i++) {
    const cell = cells[i];
    const R = cellRadiusM(cell);
    stormCentreAt(cell, t, centre);
    const r = Math.hypot(p.x - centre.north, p.y - centre.east);
    if (r >= SEVERITY_REACH * R) continue;
    const top = cellTopM(cell);
    const severity = cellIntensity(cell) * smoothstep(SEVERITY_REACH * R, R, r) * (1 - smoothstep(top, top + SEVERITY_TOP_TAPER_M, alt)) * stormShare(cell, 'wind');
    if (severity > best) best = severity;
  }
  return best;
}

/**
 * True inside a cell's core at time t: within R of the centre, between the cloud base `baseM` and the top (m MSL),
 * for a cell whose core share is at least CORE_SHARE_MIN.
 */
export function inStormCore(cells: readonly StormCell[], north: number, east: number, altM: number, t: number, baseM: number): boolean {
  if (altM < baseM) return false;
  const n = Math.min(cells.length, MAX_STORMS);
  for (let i = 0; i < n; i++) {
    const cell = cells[i];
    if (altM > cellTopM(cell) || stormShare(cell, 'core') < CORE_SHARE_MIN) continue;
    const R = cellRadiusM(cell);
    stormCentreAt(cell, t, centre);
    const dN = north - centre.north;
    const dE = east - centre.east;
    if (dN * dN + dE * dE < R * R) return true;
  }
  return false;
}
