// Positions of the sun, moon and the celestial sphere for the sky and lighting.
//
// The sun comes from sunDirectionNED (the one source every module shares). The moon and the stars use a
// low-precision model consistent with it: the sun's ecliptic longitude follows the same day-of-year
// formula, local sidereal time follows from the sun's hour angle, and the moon moves along the ecliptic
// by its synodic age (its +-5 deg orbital inclination is ignored). WeatherSettings has no year, so the
// lunar cycle is anchored to put a full moon on day 172, the default scenario's date.

import * as THREE from 'three';
import { nedToThree } from '../../core/frames';
import { DEG } from '../../core/math';
import { AIRPORT, sunDirectionNED } from '../../core/world';
import { MOON_FULL_ILLUMINANCE_TOA } from './params';

const OBLIQUITY = 23.44 * DEG;
const SYNODIC_MONTH_DAYS = 29.530589;
/** Days added to dayOfYear so that day 172 falls at lunar age ~14.8 d (full). */
const LUNAR_EPOCH_OFFSET_DAYS = 20;

export class Celestial {
  /** Unit vectors toward the sun and moon, three.js world space. */
  readonly sunDir = new THREE.Vector3(0, 1, 0);
  readonly moonDir = new THREE.Vector3(0, -1, 0);
  /** Rotation from equatorial coordinates (x = RA 0h, z = north celestial pole) to three.js world. */
  readonly equatorialToWorld = new THREE.Matrix3();
  /** Moon illuminance at the top of the atmosphere for its current phase, scene units. */
  moonIlluminance = 0;
  /** Sun-moon-earth phase angle, rad (0 = full moon). */
  moonPhaseAngle = 0;

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

    const age = (((dayOfYear + timeOfDay / 24 + LUNAR_EPOCH_OFFSET_DAYS) % SYNODIC_MONTH_DAYS) + SYNODIC_MONTH_DAYS) % SYNODIC_MONTH_DAYS;
    const moonLongitude = sunLongitude + (2 * Math.PI * age) / SYNODIC_MONTH_DAYS;
    const dec = Math.asin(Math.sin(OBLIQUITY) * Math.sin(moonLongitude));
    const ra = Math.atan2(Math.cos(OBLIQUITY) * Math.sin(moonLongitude), Math.cos(moonLongitude));
    this.moonDir.set(Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)).applyMatrix3(this.equatorialToWorld).normalize();

    // Phase angle ~ 180 deg minus the sun-moon elongation; brightness law from Allen (1973).
    this.moonPhaseAngle = Math.PI - Math.acos(THREE.MathUtils.clamp(this.sunDir.dot(this.moonDir), -1, 1));
    const a = this.moonPhaseAngle / DEG;
    this.moonIlluminance = MOON_FULL_ILLUMINANCE_TOA * Math.pow(10, -0.4 * (0.026 * a + 4e-9 * a ** 4));
  }
}
