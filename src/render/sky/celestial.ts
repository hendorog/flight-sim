// Positions of the sun, moon and the celestial sphere for the sky and lighting.
//
// The sun comes from sunDirectionNED (the one source every module shares). The celestial sphere is consistent
// with it: the sun's ecliptic longitude follows the same day-of-year formula and the local sidereal time follows
// from the sun's hour angle, so equatorialToWorld places J2000 equatorial directions (stars, the Milky Way, the
// Moon, the planets) around the sim's sun.
//
// The Moon comes from a low-precision lunar theory (Meeus, Astronomical Algorithms 2nd ed., ch. 47, the leading
// terms of tables 47.A and 47.B: ~0.01 deg against the full series) at the sky's calendar instant (skyTime.ts:
// SKY_EPOCH_YEAR = 2016, the time of day taken as UT). That gives its true ecliptic longitude, its latitude (the
// 5.1 deg inclined orbit with its 18.6-year node regression) and its distance, so its phases fall on 2016's dates
// (full on day 172, 2016-06-20 11:02 UT) and its path swings above and below the ecliptic month by month. The
// geocentric direction is rotated from the mean equinox of date to J2000 (general precession in longitude,
// ~0.22 deg in 2016), converted to J2000 equatorial and then to the world, and finally shifted by the
// topocentric parallax (~0.95 deg at the horizon) for an observer on the surface below the camera.
//
// The phase angle comes from the Moon's world direction and the sim's own sun (the sim's simple sun formula is up
// to ~2 deg off the real Sun), so the drawn terminator and the moonlight always match the lit side the player
// sees.

import * as THREE from 'three';
import { nedToThree } from '../../core/frames';
import { DEG } from '../../core/math';
import { AIRPORT, sunDirectionNED } from '../../core/world';
import { MOON_FULL_ILLUMINANCE_TOA } from './params';
import { skyJulianDate } from './skyTime';

const OBLIQUITY = 23.44 * DEG;
/** Mean obliquity of the ecliptic at J2000 (IAU 1976: 23 deg 26' 21.448"). */
export const OBLIQUITY_J2000 = 23.4392911 * DEG;
/** Equatorial radius of the Earth, km (parallax). */
const EARTH_RADIUS_KM = 6378.14;

// Meeus table 47.A: multiples of D, M, M', F, then the sine coefficient of longitude (1e-6 deg) and the cosine
// coefficient of distance (1e-3 km). The 32 largest of 60 rows (the rest are each below 0.002 deg / 9 km).
// prettier-ignore
const LR_TERMS = [
  0, 0, 1, 0, 6288774, -20905355,  2, 0, -1, 0, 1274027, -3699111,  2, 0, 0, 0, 658314, -2955968,
  0, 0, 2, 0, 213618, -569925,  0, 1, 0, 0, -185116, 48888,  0, 0, 0, 2, -114332, -3149,
  2, 0, -2, 0, 58793, 246158,  2, -1, -1, 0, 57066, -152138,  2, 0, 1, 0, 53322, -170733,
  2, -1, 0, 0, 45758, -204586,  0, 1, -1, 0, -40923, -129620,  1, 0, 0, 0, -34720, 108743,
  0, 1, 1, 0, -30383, 104755,  2, 0, 0, -2, 15327, 10321,  0, 0, 1, 2, -12528, 0,
  0, 0, 1, -2, 10980, 79661,  4, 0, -1, 0, 10675, -34782,  0, 0, 3, 0, 10034, -23210,
  4, 0, -2, 0, 8548, -21636,  2, 1, -1, 0, -7888, 24208,  2, 1, 0, 0, -6766, 30824,
  1, 0, -1, 0, -5163, -8379,  1, 1, 0, 0, 4987, -16675,  2, -1, 1, 0, 4036, -12831,
  2, 0, 2, 0, 3994, -10445,  4, 0, 0, 0, 3861, -11650,  2, 0, -3, 0, 3665, 14403,
  0, 1, -2, 0, -2689, -7003,  2, 0, -1, 2, -2602, 0,  2, -1, -2, 0, 2390, 10056,
  1, 0, 1, 0, -2348, 6322,  2, -2, 0, 0, 2236, -9884,
] as const;

// Meeus table 47.B: multiples of D, M, M', F and the sine coefficient of latitude (1e-6 deg). The 30 largest.
// prettier-ignore
const B_TERMS = [
  0, 0, 0, 1, 5128122,  0, 0, 1, 1, 280602,  0, 0, 1, -1, 277693,  2, 0, 0, -1, 173237,
  2, 0, -1, 1, 55413,  2, 0, -1, -1, 46271,  2, 0, 0, 1, 32573,  0, 0, 2, 1, 17198,
  2, 0, 1, -1, 9266,  0, 0, 2, -1, 8822,  2, -1, 0, -1, 8216,  2, 0, -2, -1, 4324,
  2, 0, 1, 1, 4200,  2, 1, 0, -1, -3359,  2, -1, -1, 1, 2463,  2, -1, 0, 1, 2211,
  2, -1, -1, -1, 2065,  0, 1, -1, -1, -1870,  4, 0, -1, -1, 1828,  0, 1, 0, 1, -1794,
  0, 0, 0, 3, -1749,  0, 1, -1, 1, -1565,  1, 0, 0, 1, -1491,  0, 1, 1, 1, -1475,
  0, 1, 1, -1, -1410,  0, 1, 0, -1, -1344,  1, 0, 0, -1, -1335,  0, 0, 3, 1, 1107,
  4, 0, 0, -1, 1021,  4, 0, -1, 1, 833,
] as const;

/** Geocentric ecliptic position of the Moon: longitude and latitude (rad, mean equinox of date), distance (km). */
export interface MoonEcliptic {
  lon: number;
  lat: number;
  distKm: number;
}

const wrapDeg = (x: number): number => ((x % 360) + 360) % 360;
const eccentricityFactor = (m: number, E: number): number => (m === 0 ? 1 : m === 1 || m === -1 ? E : E * E);

/** The Moon's geocentric ecliptic coordinates at Julian Date `jd` (TT ~ UT here), Meeus ch. 47 (truncated). */
export function moonEcliptic(jd: number, out: MoonEcliptic = { lon: 0, lat: 0, distKm: 0 }): MoonEcliptic {
  const T = (jd - 2451545.0) / 36525;
  const T2 = T * T;
  const T3 = T2 * T;
  const T4 = T3 * T;
  const Lp = wrapDeg(218.3164477 + 481267.88123421 * T - 0.0015786 * T2 + T3 / 538841 - T4 / 65194000);
  const D = wrapDeg(297.8501921 + 445267.1114034 * T - 0.0018819 * T2 + T3 / 545868 - T4 / 113065000) * DEG;
  const M = wrapDeg(357.5291092 + 35999.0502909 * T - 0.0001536 * T2 + T3 / 24490000) * DEG;
  const Mp = wrapDeg(134.9633964 + 477198.8675055 * T + 0.0087414 * T2 + T3 / 69699 - T4 / 14712000) * DEG;
  const F = wrapDeg(93.272095 + 483202.0175233 * T - 0.0036539 * T2 - T3 / 3526000 + T4 / 863310000) * DEG;
  const A1 = wrapDeg(119.75 + 131.849 * T) * DEG;
  const A2 = wrapDeg(53.09 + 479264.29 * T) * DEG;
  const A3 = wrapDeg(313.45 + 481266.484 * T) * DEG;
  const E = 1 - 0.002516 * T - 0.0000074 * T2;
  const LpR = Lp * DEG;

  let sl = 0;
  let sr = 0;
  for (let i = 0; i < LR_TERMS.length; i += 6) {
    const m = LR_TERMS[i + 1];
    const arg = LR_TERMS[i] * D + m * M + LR_TERMS[i + 2] * Mp + LR_TERMS[i + 3] * F;
    const e = eccentricityFactor(m, E);
    sl += LR_TERMS[i + 4] * e * Math.sin(arg);
    sr += LR_TERMS[i + 5] * e * Math.cos(arg);
  }
  let sb = 0;
  for (let i = 0; i < B_TERMS.length; i += 5) {
    const m = B_TERMS[i + 1];
    const arg = B_TERMS[i] * D + m * M + B_TERMS[i + 2] * Mp + B_TERMS[i + 3] * F;
    sb += B_TERMS[i + 4] * eccentricityFactor(m, E) * Math.sin(arg);
  }
  sl += 3958 * Math.sin(A1) + 1962 * Math.sin(LpR - F) + 318 * Math.sin(A2);
  sb += -2235 * Math.sin(LpR) + 382 * Math.sin(A3) + 175 * Math.sin(A1 - F) + 175 * Math.sin(A1 + F) + 127 * Math.sin(LpR - Mp) - 115 * Math.sin(LpR + Mp);

  out.lon = wrapDeg(Lp + sl / 1e6) * DEG;
  out.lat = (sb / 1e6) * DEG;
  out.distKm = 385000.56 + sr / 1000;
  return out;
}

/** The Sun's geometric ecliptic longitude at `jd` (rad, mean equinox of date; Meeus ch. 25, ~0.01 deg). */
export function sunEclipticLongitude(jd: number): number {
  const T = (jd - 2451545.0) / 36525;
  const L0 = 280.46646 + 36000.76983 * T + 0.0003032 * T * T;
  const M = (357.52911 + 35999.05029 * T - 0.0001537 * T * T) * DEG;
  const C = (1.914602 - 0.004817 * T - 0.000014 * T * T) * Math.sin(M) + (0.019993 - 0.000101 * T) * Math.sin(2 * M) + 0.000289 * Math.sin(3 * M);
  return wrapDeg(L0 + C) * DEG;
}

/** General precession in longitude from J2000 to `jd`, rad (Lieske 1977, leading terms). */
export function precessionInLongitude(jd: number): number {
  const T = (jd - 2451545.0) / 36525;
  return (5029.0966 * T + 1.11113 * T * T) * (DEG / 3600);
}

/**
 * Ecliptic (lon, lat, rad) to an equatorial unit vector (x = RA 0h, z = north pole) for obliquity `eps`, written
 * into `out` as [x, y, z].
 */
export function eclipticToEquatorial(lon: number, lat: number, eps: number, out: number[] = [0, 0, 0]): number[] {
  const cb = Math.cos(lat);
  const x = cb * Math.cos(lon);
  const y = cb * Math.sin(lon);
  const z = Math.sin(lat);
  const ce = Math.cos(eps);
  const se = Math.sin(eps);
  out[0] = x;
  out[1] = y * ce - z * se;
  out[2] = y * se + z * ce;
  return out;
}

/**
 * The Moon's geocentric J2000 equatorial unit vector at `jd` (x = RA 0h, z = north celestial pole), written into
 * `out`; returns the distance in km. The ecliptic longitude is precessed from the equinox of date to J2000 (the
 * small motion of the ecliptic itself, < 0.01 deg here, is ignored).
 */
export function moonEquatorialJ2000(jd: number, out: number[], scratch: MoonEcliptic = { lon: 0, lat: 0, distKm: 0 }): number {
  const m = moonEcliptic(jd, scratch);
  eclipticToEquatorial(m.lon - precessionInLongitude(jd), m.lat, OBLIQUITY_J2000, out);
  return m.distKm;
}

export class Celestial {
  /** Unit vectors toward the sun and moon, three.js world space. moonDir is topocentric (parallax included). */
  readonly sunDir = new THREE.Vector3(0, 1, 0);
  readonly moonDir = new THREE.Vector3(0, -1, 0);
  /** Rotation from equatorial coordinates (x = RA 0h, z = north celestial pole) to three.js world. */
  readonly equatorialToWorld = new THREE.Matrix3();
  /** Moon illuminance at the top of the atmosphere for its current phase, scene units. */
  moonIlluminance = 0;
  /** Sun-moon-earth phase angle, rad (0 = full moon). */
  moonPhaseAngle = 0;
  /** Earth-Moon distance, km (geocentric). */
  moonDistanceKm = 384400;
  /** The Moon's geocentric ecliptic latitude, rad (+-5.1 deg over a draconic month). */
  moonEclipticLatitude = 0;
  /** Julian Date of the last update (skyTime.ts calendar). */
  julianDate = 0;

  private readonly eq = [0, 0, 0];
  private readonly ecl: MoonEcliptic = { lon: 0, lat: 0, distKm: 0 };

  update(timeOfDay: number, dayOfYear: number, latitudeDeg: number = AIRPORT.latitudeDeg): void {
    nedToThree(sunDirectionNED(timeOfDay, dayOfYear, latitudeDeg), this.sunDir);

    // Local sidereal time = sun hour angle + sun right ascension.
    const sunLongitude = ((2 * Math.PI) / 365) * (dayOfYear - 81);
    const sunRA = Math.atan2(Math.cos(OBLIQUITY) * Math.sin(sunLongitude), Math.cos(sunLongitude));
    const lst = (timeOfDay - 12) * 15 * DEG + sunRA;
    const lat = latitudeDeg * DEG;
    const sL = Math.sin(lst);
    const cL = Math.cos(lst);
    const sP = Math.sin(lat);
    const cP = Math.cos(lat);
    // Rows give three.x = east, three.y = up, three.z = -north (see celestial header / frames.ts).
    this.equatorialToWorld.set(-sL, cL, 0, cP * cL, cP * sL, sP, sP * cL, sP * sL, -cP);

    this.julianDate = skyJulianDate(dayOfYear, timeOfDay);
    const dist = moonEquatorialJ2000(this.julianDate, this.eq, this.ecl);
    this.moonDistanceKm = dist;
    this.moonEclipticLatitude = this.ecl.lat;
    // Topocentric: the observer stands one Earth radius from the centre along the local vertical (world +y).
    this.moonDir.fromArray(this.eq).applyMatrix3(this.equatorialToWorld).multiplyScalar(dist / EARTH_RADIUS_KM);
    this.moonDir.y -= 1;
    this.moonDir.normalize();

    // Phase angle ~ 180 deg minus the sun-moon elongation; brightness law from Allen (1973).
    this.moonPhaseAngle = Math.PI - Math.acos(THREE.MathUtils.clamp(this.sunDir.dot(this.moonDir), -1, 1));
    const a = this.moonPhaseAngle / DEG;
    this.moonIlluminance = MOON_FULL_ILLUMINANCE_TOA * Math.pow(10, -0.4 * (0.026 * a + 4e-9 * a ** 4));
  }
}
