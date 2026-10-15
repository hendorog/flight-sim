// Naked-eye planets (package P3 of the night-sky plan owns this file and glsl/planets.ts).
//
// Positions: Keplerian elements and their rates from E. M. Standish, "Keplerian Elements for Approximate Positions
// of the Major Planets" (JPL Solar System Dynamics, Table 1, valid 1800-2050 AD; ~arcminute accuracy for the inner
// planets, a few arcminutes for Jupiter and Saturn). Heliocentric J2000 ecliptic positions of the planet and of the
// Earth-Moon barycentre (the Earth to better than 0.003 deg as seen from the planets), geocentric difference with a
// one-step light-time correction, rotated to J2000 equatorial by the obliquity (23.4393 deg); then
// Celestial.equatorialToWorld places them on the sim's sky like the stars.
//
// Magnitudes: A. Mallama and J. L. Hilton (2018), "Computing apparent planetary magnitudes for The Astronomical
// Almanac", Astronomy and Computing 25, 10-24: the simple (geometric-albedo + phase-angle polynomial) forms; Saturn
// with its rings' tilt term.
//
// The instant comes from skyTime.ts (SKY_EPOCH_YEAR 2016, the shared fixed year), so the planets agree with the
// Moon's ephemeris. Which planets are drawn, their colours and their rendering are AGENT choices of the night-sky
// plan (not owner decisions): Mercury, Venus, Mars, Jupiter, Saturn and Uranus (at mag ~5.7 only under a dark sky),
// steady points with no scintillation (a real naked-eye cue that tells a planet from a star).
//
// Interface (frozen by the scaffold; see the plan): `uniforms` is spread into the sky dome's uniforms; update()
// runs once per frame from SkyDome.update, after the Celestial has moved. No per-frame allocation.

import * as THREE from 'three';
import type { SimContext } from '../../core/context';
import type { Celestial } from './celestial';
import { EARTH_RADIUS_KM, SCENE_UNITS_PER_LUX } from './params';
import { skyJulianDate } from './skyTime';

const DEG = Math.PI / 180;
/** Obliquity of the ecliptic at J2000, rad. */
const OBLIQUITY_J2000 = 23.4392911 * DEG;
/** Light time per astronomical unit, days. */
const LIGHT_DAYS_PER_AU = 0.0057755183;
/** Illuminance of a magnitude-0 source, 2.54e-6 lux (the stars' STAR_E0), in scene units. */
export const MAG0_ILLUMINANCE = 2.54e-6 * SCENE_UNITS_PER_LUX;

export type PlanetId = 'mercury' | 'venus' | 'mars' | 'jupiter' | 'saturn' | 'uranus';

/** Standish Table 1: a (au), e, I (deg), L (deg), long. perihelion (deg), long. node (deg); value and rate per Julian century. */
type Elements = readonly [number, number, number, number, number, number];
interface PlanetElements {
  readonly el: Elements;
  readonly rate: Elements;
}

const ELEMENTS: Record<PlanetId | 'earth', PlanetElements> = {
  mercury: { el: [0.38709927, 0.20563593, 7.00497902, 252.2503235, 77.45779628, 48.33076593], rate: [0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081] },
  venus: { el: [0.72333566, 0.00677672, 3.39467605, 181.9790995, 131.60246718, 76.67984255], rate: [0.0000039, -0.00004107, -0.0007889, 58517.81538729, 0.00268329, -0.27769418] },
  // The Earth-Moon barycentre.
  earth: { el: [1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0.0], rate: [0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0.0] },
  mars: { el: [1.52371034, 0.0933941, 1.84969142, -4.55343205, -23.94362959, 49.55953891], rate: [0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343] },
  jupiter: { el: [5.202887, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909], rate: [-0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106] },
  saturn: { el: [9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448], rate: [-0.0012506, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794] },
  uranus: { el: [19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.9542763, 74.01692503], rate: [-0.00196176, -0.00004397, -0.00242939, 428.48202785, 0.40805281, 0.04240589] },
};

export const PLANET_IDS: readonly PlanetId[] = ['mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus'];

/**
 * Display colours (linear sRGB, normalised to luminance 1 below): AGENT choice, the planets' colours as the eye sees
 * them at night (Venus pale cream, Mars orange, Jupiter warm white, Saturn pale gold, Mercury pinkish grey, Uranus
 * pale cyan), kept unsaturated like the stars. Since night-sky round 3 the tone map shows the planets' own colour
 * (post/ToneMap.ts, the point-source flag) where the rod shift used to neutralise it: Mars deepened from
 * (1, 0.72, 0.5) to read orange on the display's shoulder, Saturn paled from (1, 0.92, 0.74), as the atmosphere's
 * reddening at its usual altitudes already warms it.
 */
const COLOURS: Record<PlanetId, readonly [number, number, number]> = {
  mercury: [1.0, 0.93, 0.86],
  venus: [1.0, 0.97, 0.88],
  mars: [1.0, 0.62, 0.4],
  jupiter: [1.0, 0.95, 0.86],
  saturn: [1.0, 0.97, 0.9],
  uranus: [0.82, 0.96, 1.0],
};

/** Saturn's north pole (IAU, J2000 equatorial): RA 40.589 deg, Dec 83.537 deg. */
const SATURN_POLE = (() => {
  const ra = 40.589 * DEG;
  const dec = 83.537 * DEG;
  return [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)] as const;
})();

/** Heliocentric J2000 ecliptic position (au) of `id` at `jd` (TT ~ UT), written into `out`. */
export function heliocentricEcliptic(id: PlanetId | 'earth', jd: number, out: number[] = [0, 0, 0]): number[] {
  const T = (jd - 2451545.0) / 36525;
  const { el, rate } = ELEMENTS[id];
  const a = el[0] + rate[0] * T;
  const e = el[1] + rate[1] * T;
  const I = (el[2] + rate[2] * T) * DEG;
  const L = el[3] + rate[3] * T;
  const varpi = el[4] + rate[4] * T;
  const node = (el[5] + rate[5] * T) * DEG;
  const omega = varpi * DEG - node;
  const M = (((((L - varpi) % 360) + 540) % 360) - 180) * DEG;
  // Kepler's equation by Newton iteration (e < 0.21: converges in a few steps).
  let E = M + e * Math.sin(M);
  for (let i = 0; i < 8; i++) {
    const dE = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= dE;
    if (Math.abs(dE) < 1e-12) break;
  }
  const xp = a * (Math.cos(E) - e);
  const yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const cw = Math.cos(omega);
  const sw = Math.sin(omega);
  const cO = Math.cos(node);
  const sO = Math.sin(node);
  const cI = Math.cos(I);
  const sI = Math.sin(I);
  out[0] = (cw * cO - sw * sO * cI) * xp + (-sw * cO - cw * sO * cI) * yp;
  out[1] = (cw * sO + sw * cO * cI) * xp + (-sw * sO + cw * cO * cI) * yp;
  out[2] = sw * sI * xp + cw * sI * yp;
  return out;
}

export interface PlanetPosition {
  id: PlanetId;
  /** Unit vector, J2000 equatorial (x = RA 0h, z = north celestial pole). */
  readonly eq: number[];
  /** Right ascension and declination, rad (J2000, geometric + light time). */
  ra: number;
  dec: number;
  /** Distances from the Sun and from the Earth, au. */
  r: number;
  delta: number;
  /** Sun-planet-Earth phase angle and Sun-Earth-planet elongation, deg. */
  phaseDeg: number;
  elongationDeg: number;
  /** Apparent visual magnitude. */
  mag: number;
}

const _p = [0, 0, 0];
const _earth = [0, 0, 0];

/** Apparent visual magnitude (Mallama & Hilton 2018, simple forms). r, delta in au; alpha (phase angle) in deg. */
export function planetMagnitude(id: PlanetId, r: number, delta: number, alpha: number, ringSinB = 0): number {
  const d = 5 * Math.log10(r * delta);
  switch (id) {
    case 'mercury':
      return d - 0.613 + alpha * (6.328e-2 + alpha * (-1.6336e-3 + alpha * (3.3644e-5 + alpha * (-3.4265e-7 + alpha * (1.6893e-9 - alpha * 3.0334e-12)))));
    case 'venus':
      return alpha < 163.7
        ? d - 4.384 + alpha * (-1.044e-3 + alpha * (3.687e-4 + alpha * (-2.814e-6 + alpha * 8.938e-9)))
        : d + 236.05828 + alpha * (-2.81914 + alpha * 8.39034e-3);
    case 'mars':
      return d - 1.601 + alpha * (2.267e-2 - alpha * 1.302e-4);
    case 'jupiter':
      return d - 9.395 + alpha * (-3.7e-4 + alpha * 6.16e-4);
    case 'saturn':
      return d - 8.914 - 1.825 * ringSinB + 0.026 * alpha - 0.378 * ringSinB * Math.exp(-2.25 * alpha);
    case 'uranus':
      return d - 7.11 + alpha * (6.587e-3 + alpha * 1.045e-4);
  }
}

/** Geocentric position (J2000 equatorial, light time applied) and magnitude of `id` at Julian Date `jd`. */
export function planetPosition(id: PlanetId, jd: number, out?: PlanetPosition): PlanetPosition {
  const o: PlanetPosition = out ?? { id, eq: [0, 0, 0], ra: 0, dec: 0, r: 0, delta: 0, phaseDeg: 0, elongationDeg: 0, mag: 0 };
  o.id = id;
  heliocentricEcliptic('earth', jd, _earth);
  // Light time: the planet where it was when the light left it (one iteration is plenty at this accuracy).
  heliocentricEcliptic(id, jd, _p);
  const tau = Math.hypot(_p[0] - _earth[0], _p[1] - _earth[1], _p[2] - _earth[2]) * LIGHT_DAYS_PER_AU;
  heliocentricEcliptic(id, jd - tau, _p);
  const gx = _p[0] - _earth[0];
  const gy = _p[1] - _earth[1];
  const gz = _p[2] - _earth[2];
  const delta = Math.hypot(gx, gy, gz);
  const r = Math.hypot(_p[0], _p[1], _p[2]);
  const R = Math.hypot(_earth[0], _earth[1], _earth[2]);
  // Ecliptic -> equatorial: rotation about x by the obliquity.
  const ce = Math.cos(OBLIQUITY_J2000);
  const se = Math.sin(OBLIQUITY_J2000);
  const ex = gx / delta;
  const ey = (ce * gy - se * gz) / delta;
  const ez = (se * gy + ce * gz) / delta;
  o.eq[0] = ex;
  o.eq[1] = ey;
  o.eq[2] = ez;
  o.ra = Math.atan2(ey, ex);
  if (o.ra < 0) o.ra += 2 * Math.PI;
  o.dec = Math.asin(Math.max(-1, Math.min(1, ez)));
  o.r = r;
  o.delta = delta;
  // Phase angle at the planet (Sun-planet-Earth) and elongation at the Earth (Sun-Earth-planet): law of cosines.
  o.phaseDeg = Math.acos(Math.max(-1, Math.min(1, (r * r + delta * delta - R * R) / (2 * r * delta)))) / DEG;
  o.elongationDeg = Math.acos(Math.max(-1, Math.min(1, (R * R + delta * delta - r * r) / (2 * R * delta)))) / DEG;
  // Saturn's rings: sine of the Earth's saturnicentric latitude (how open the rings are seen from the Earth).
  const sinB = id === 'saturn' ? Math.abs(ex * SATURN_POLE[0] + ey * SATURN_POLE[1] + ez * SATURN_POLE[2]) : 0;
  o.mag = planetMagnitude(id, r, delta, o.phaseDeg, sinB);
  return o;
}

/**
 * The planets' pixel kernel (TS mirror of glsl/planets.ts planetKernel): the cubic B-spline, i.e. a quadratic
 * B-spline spot integrated over a 1 px box. Sums to 1 over integer shifts (no shimmer), zero beyond 2 px.
 */
export function planetKernel(x: number): number {
  const a = Math.abs(x);
  if (a >= 2) return 0;
  if (a < 1) return (4 - 6 * a * a + 3 * a * a * a) / 6;
  const t = 2 - a;
  return (t * t * t) / 6;
}

/**
 * World-up component of a direction below which the planet is skipped (E = 0): 0.02 below the geometric horizon
 * seen from `altitudeM` (the same camera radius as the dome's uCamR), so the skip never hides a planet the dome would
 * still draw above the ground - the horizon dips ~1.15 deg at 1.3 km, ~3 deg at 9 km. The margin keeps a planet just
 * under the horizon whose 2 px kernel still reaches sky pixels.
 */
export function planetCutoffY(altitudeM: number): number {
  const r = EARTH_RADIUS_KM / (EARTH_RADIUS_KM + Math.max(altitudeM / 1000, 0.002));
  return -Math.sqrt(1 - r * r) - 0.02;
}

/** Most planets the dome draws (the GLSL array size). */
export const MAX_PLANETS = 6;

export class PlanetModel {
  /**
   * uPlanets[i]: xyz = world direction (unit), w = illuminance at the top of the atmosphere, scene units (0 = not
   * drawn: below the horizon). uPlanetColours[i]: linear RGB, luminance 1.
   */
  readonly uniforms = {
    uPlanets: { value: Array.from({ length: MAX_PLANETS }, () => new THREE.Vector4(0, 1, 0, 0)) },
    uPlanetColours: {
      value: PLANET_IDS.map((id) => {
        const [r, g, b] = COLOURS[id];
        return new THREE.Vector3(r, g, b).divideScalar(0.2126 * r + 0.7152 * g + 0.0722 * b);
      }),
    },
    /** The camera's screen axes, world space: the pixel grid glsl/planets.ts integrates each point over. */
    uPlanetRight: { value: new THREE.Vector3(1, 0, 0) },
    uPlanetUp: { value: new THREE.Vector3(0, 1, 0) },
  };
  /** The last update's positions, in PLANET_IDS order (tools and tests read them). */
  readonly positions: PlanetPosition[] = PLANET_IDS.map((id) => planetPosition(id, 2451545.0));
  private lastJd = NaN;

  update(ctx: SimContext, celestial: Celestial): void {
    const w = ctx.weather;
    const jd = skyJulianDate(w.dayOfYear, w.timeOfDay);
    // Against the stars the planets move < 0.1 deg a day (Mercury ~2 deg): recompute every ~6 sim minutes. The
    // sky's daily rotation is applied every frame through equatorialToWorld.
    if (!(Math.abs(jd - this.lastJd) < 0.004)) {
      this.lastJd = jd;
      for (let i = 0; i < PLANET_IDS.length; i++) planetPosition(PLANET_IDS[i], jd, this.positions[i]);
    }
    const cam = ctx.camera?.matrixWorld.elements;
    const cutoffY = planetCutoffY(cam ? cam[13] : 0);
    if (cam) {
      this.uniforms.uPlanetRight.value.set(cam[0], cam[1], cam[2]).normalize();
      this.uniforms.uPlanetUp.value.set(cam[4], cam[5], cam[6]).normalize();
    }
    const m = celestial.equatorialToWorld.elements;
    const out = this.uniforms.uPlanets.value;
    for (let i = 0; i < MAX_PLANETS; i++) {
      const p = this.positions[i];
      const v = out[i];
      const [x, y, z] = p.eq;
      // Matrix3 elements are column-major.
      const wx = m[0] * x + m[3] * y + m[6] * z;
      const wy = m[1] * x + m[4] * y + m[7] * z;
      const wz = m[2] * x + m[5] * y + m[8] * z;
      // Below the (altitude-dipped) horizon the dome draws the ground there anyway; E = 0 lets the shader skip it.
      v.set(wx, wy, wz, wy > cutoffY ? MAG0_ILLUMINANCE * Math.pow(10, -0.4 * p.mag) : 0);
    }
  }
}
