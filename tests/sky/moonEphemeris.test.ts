import { describe, expect, it } from 'vitest';
import { DEG } from '../../src/core/math';
import { Celestial, eclipticToEquatorial, moonEcliptic, sunEclipticLongitude } from '../../src/render/sky/celestial';
import { skyJulianDate } from '../../src/render/sky/skyTime';

/** Julian Date of a Gregorian UT instant. */
const jdOf = (y: number, mo: number, d: number, h = 0, mi = 0): number => Date.UTC(y, mo - 1, d, h, mi) / 86400000 + 2440587.5;

/** Geocentric Sun-Moon elongation at `jd`, deg. */
function elongation(jd: number): number {
  const m = moonEcliptic(jd);
  return Math.acos(Math.cos(m.lat) * Math.cos(m.lon - sunEclipticLongitude(jd))) / DEG;
}

describe('lunar ephemeris (Meeus ch. 47, truncated)', () => {
  it('matches Meeus Example 47.a (1992-04-12 0h TD)', () => {
    const jd = 2448724.5;
    expect(jdOf(1992, 4, 12)).toBeCloseTo(jd, 6);
    const m = moonEcliptic(jd);
    expect(Math.abs(m.lon / DEG - 133.162655)).toBeLessThan(0.05);
    expect(Math.abs(m.lat / DEG - -3.229126)).toBeLessThan(0.05);
    expect(Math.abs(m.distKm - 368409.7)).toBeLessThan(100);
    // Meeus's RA/Dec are apparent (of date, true obliquity 23.440636 deg, nutation in longitude +0.0046 deg).
    const [x, y, z] = eclipticToEquatorial(m.lon, m.lat, 23.440636 * DEG);
    const ra = (((Math.atan2(y, x) / DEG) % 360) + 360) % 360;
    const dec = Math.asin(z) / DEG;
    expect(Math.abs(ra - 134.68847)).toBeLessThan(0.3);
    expect(Math.abs(dec - 13.768368)).toBeLessThan(0.3);
  });

  it('puts 2016 full and new Moons on their dates', () => {
    // Full / new Moon is defined by the difference in ecliptic LONGITUDE (180 / 0 deg). The elongation itself also
    // carries the Moon's latitude: on 2016-06-20 the Moon is 4.9 deg north of the ecliptic, so the full-Moon
    // elongation is ~175 deg (no eclipse that month), not 180 +- 2 as the plan's brief guessed.
    const dLon = (jd: number): number => {
      const m = moonEcliptic(jd);
      return ((((m.lon - sunEclipticLongitude(jd)) / DEG) % 360) + 360) % 360;
    };
    const full = jdOf(2016, 6, 20, 11, 2);
    const fullBeta = Math.abs(moonEcliptic(full).lat / DEG);
    expect(Math.abs(dLon(full) - 180)).toBeLessThan(0.5);
    expect(Math.abs(elongation(full) - (180 - fullBeta))).toBeLessThan(0.5);
    const newMoon = jdOf(2016, 7, 4, 11, 1);
    expect(Math.min(dLon(newMoon), 360 - dLon(newMoon))).toBeLessThan(0.5);
    expect(elongation(newMoon)).toBeLessThan(5);
    // The sky calendar: day 172 of 2016 is 20 June.
    expect(skyJulianDate(172, 11 + 2 / 60)).toBeCloseTo(jdOf(2016, 6, 20, 11, 2), 6);
  });

  it('keeps the default scenario night (day 172, 23 h) at full Moon in the sim', () => {
    const c = new Celestial();
    c.update(23, 172);
    expect((1 + Math.cos(c.moonPhaseAngle)) / 2).toBeGreaterThan(0.98);
    // Low in the south-east to south (full Moon at 46.5 N in June culminates at ~20 deg).
    const alt = Math.asin(c.moonDir.y) / DEG;
    expect(alt).toBeGreaterThan(5);
    expect(alt).toBeLessThan(25);
    expect(c.moonDir.z).toBeGreaterThan(0); // three z = -north: south of the observer
  });

  it('swings the Moon above and below the ecliptic (5.1 deg orbit)', () => {
    let max = 0;
    let min = 0;
    for (let d = 0; d < 28; d += 0.25) {
      const b = moonEcliptic(jdOf(2016, 6, 1) + d).lat / DEG;
      max = Math.max(max, b);
      min = Math.min(min, b);
    }
    expect(max).toBeGreaterThan(4.5);
    expect(min).toBeLessThan(-4.5);
  });

  it('shifts the Moon down by the horizontal parallax near the horizon', () => {
    // Geocentric vs topocentric altitude: ~0.95 deg near the horizon.
    const c = new Celestial();
    let best = { tod: 0, alt: 90 };
    for (let tod = 18; tod < 23; tod += 0.02) {
      c.update(tod, 172);
      const alt = Math.asin(c.moonDir.y) / DEG;
      if (Math.abs(alt - 2) < Math.abs(best.alt - 2)) best = { tod, alt };
    }
    c.update(best.tod, 172);
    const topo = c.moonDir.clone();
    // Recompute geocentric: undo the parallax shift.
    const geoY = topo.y + 6378.14 / c.moonDistanceKm;
    const shift = Math.asin(Math.min(1, geoY / Math.hypot(topo.x, geoY, topo.z))) / DEG - best.alt;
    expect(shift).toBeGreaterThan(0.85);
    expect(shift).toBeLessThan(1.05);
  });
});
