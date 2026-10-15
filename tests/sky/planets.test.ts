import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Celestial } from '../../src/render/sky/celestial';
import { MAG0_ILLUMINANCE, PLANET_IDS, PlanetModel, planetCutoffY, planetKernel, planetPosition } from '../../src/render/sky/planets';
import { skyJulianDate } from '../../src/render/sky/skyTime';
import type { SimContext } from '../../src/core/context';

const DEG = Math.PI / 180;
const jdOf = (y: number, m: number, d: number, h = 0): number => Date.UTC(y, m - 1, d, h) / 86400000 + 2440587.5;

/** Angular separation of two (RA, Dec) positions, deg. */
function separationDeg(ra1: number, dec1: number, ra2: number, dec2: number): number {
  const c = Math.sin(dec1) * Math.sin(dec2) + Math.cos(dec1) * Math.cos(dec2) * Math.cos(ra1 - ra2);
  return Math.acos(Math.min(1, Math.max(-1, c))) / DEG;
}

describe('planet ephemeris (Standish elements, Mallama & Hilton magnitudes)', () => {
  it('Venus matches Meeus Example 33.a (1992-12-20 0h TD) within 0.3 deg', () => {
    const p = planetPosition('venus', 2448976.5);
    // Meeus: apparent RA 21h04m41.454s, Dec -18 deg 53' 16.84" (of date; J2000 differs by ~0.1 deg of precession).
    const ra = (21 + 4 / 60 + 41.454 / 3600) * 15 * DEG;
    const dec = -(18 + 53 / 60 + 16.84 / 3600) * DEG;
    expect(separationDeg(p.ra, p.dec, ra, dec)).toBeLessThan(0.3);
    // Meeus: distance 0.910947 au; magnitude about -4.3 at that phase.
    expect(p.delta).toBeCloseTo(0.911, 2);
    expect(p.mag).toBeGreaterThan(-4.6);
    expect(p.mag).toBeLessThan(-4.0);
  });

  it('Mars is at opposition on 2016-05-22, brighter than -1.8', () => {
    const p = planetPosition('mars', jdOf(2016, 5, 22));
    expect(p.elongationDeg).toBeGreaterThan(170);
    expect(p.mag).toBeLessThan(-1.8);
    expect(p.mag).toBeGreaterThan(-2.3);
  });

  it('Saturn is at opposition on 2016-06-03', () => {
    const p = planetPosition('saturn', jdOf(2016, 6, 3));
    expect(p.elongationDeg).toBeGreaterThan(170);
    // Rings well open in 2016 (B ~ 26 deg): about magnitude 0.
    expect(p.mag).toBeGreaterThan(-0.4);
    expect(p.mag).toBeLessThan(0.3);
  });

  it('Jupiter is in Leo at RA ~11h in mid-June 2016', () => {
    const p = planetPosition('jupiter', jdOf(2016, 6, 15));
    expect(Math.abs(p.ra / DEG - 165)).toBeLessThan(2);
    expect(p.mag).toBeLessThan(-1.6);
  });

  it('Venus and Mercury stay near the Sun', () => {
    for (let d = 0; d < 400; d += 13) {
      expect(planetPosition('venus', 2457388.5 + d).elongationDeg).toBeLessThan(48);
      expect(planetPosition('mercury', 2457388.5 + d).elongationDeg).toBeLessThan(28.5);
    }
  });
});

describe('PlanetModel', () => {
  it('writes world directions and illuminances in place, without reallocating', () => {
    const model = new PlanetModel();
    const celestial = new Celestial();
    const ctx = { weather: { dayOfYear: 186, timeOfDay: 23.5 } } as unknown as SimContext;
    celestial.update(23.5, 186);
    const before = model.uniforms.uPlanets.value;
    const v0 = before[0];
    model.update(ctx, celestial);
    expect(model.uniforms.uPlanets.value).toBe(before);
    expect(model.uniforms.uPlanets.value[0]).toBe(v0);
    const jd = skyJulianDate(186, 23.5);
    PLANET_IDS.forEach((id, i) => {
      const p = planetPosition(id, jd);
      const u = model.uniforms.uPlanets.value[i];
      const world = new THREE.Vector3(p.eq[0], p.eq[1], p.eq[2]).applyMatrix3(celestial.equatorialToWorld);
      expect(new THREE.Vector3(u.x, u.y, u.z).angleTo(world)).toBeLessThan(1e-3);
      if (world.y > 0) expect(u.w).toBeCloseTo(MAG0_ILLUMINANCE * 10 ** (-0.4 * p.mag), 12);
      else if (world.y < -0.02) expect(u.w).toBe(0);
    });
  });

  it('Mars and Saturn stand in the south near Antares around midnight in early July 2016 at 46.5 N', () => {
    const model = new PlanetModel();
    const celestial = new Celestial();
    celestial.update(23.5, 186);
    model.update({ weather: { dayOfYear: 186, timeOfDay: 23.5 } } as unknown as SimContext, celestial);
    for (const i of [PLANET_IDS.indexOf('mars'), PLANET_IDS.indexOf('saturn')]) {
      const u = model.uniforms.uPlanets.value[i];
      // three.js world: x east, y up, z = -north. South-ish and above the horizon.
      expect(u.y).toBeGreaterThan(0.1);
      expect(u.z).toBeGreaterThan(0.5);
      expect(u.w).toBeGreaterThan(0);
    }
  });
});

describe('planet horizon cutoff', () => {
  it('follows the geometric horizon dip with camera altitude', () => {
    expect(planetCutoffY(0)).toBeCloseTo(-0.0208, 3);
    // ~1.15 deg dip at 1.3 km, ~3 deg at 9 km (sin), plus the 0.02 margin.
    expect(planetCutoffY(1300)).toBeCloseTo(-Math.sin(1.157 * DEG) - 0.02, 3);
    expect(planetCutoffY(9000)).toBeCloseTo(-Math.sin(3.045 * DEG) - 0.02, 3);
  });

  it('keeps a planet that is below sea-level horizontal but above the horizon seen from 9 km', () => {
    const model = new PlanetModel();
    const celestial = new Celestial();
    const camAt = (altM: number) => {
      const camera = new THREE.PerspectiveCamera();
      camera.position.set(0, altM, 0);
      camera.updateMatrixWorld();
      return camera;
    };
    // Find a moment when some planet sits between the sea-level cutoff and the 9 km horizon.
    let found: { tod: number; i: number } | undefined;
    for (let tod = 0; tod < 24 && !found; tod += 0.05) {
      celestial.update(tod, 186);
      model.update({ weather: { dayOfYear: 186, timeOfDay: tod }, camera: camAt(0) } as unknown as SimContext, celestial);
      const i = model.uniforms.uPlanets.value.findIndex((u) => u.y < -0.03 && u.y > -0.06);
      if (i >= 0) found = { tod, i };
    }
    expect(found).toBeDefined();
    const { tod, i } = found!;
    expect(model.uniforms.uPlanets.value[i].w).toBe(0);
    model.update({ weather: { dayOfYear: 186, timeOfDay: tod }, camera: camAt(9000) } as unknown as SimContext, celestial);
    expect(model.uniforms.uPlanets.value[i].w).toBeGreaterThan(0);
  });
});

describe('planet pixel kernel', () => {
  it('carries the full flux at any sub-pixel position (no shimmer) and is compact', () => {
    for (let phase = 0; phase < 1; phase += 0.0625) {
      let sum = 0;
      for (let i = -4; i <= 4; i++) for (let j = -4; j <= 4; j++) sum += planetKernel(i - phase) * planetKernel(j - 0.37 * phase);
      expect(sum).toBeCloseTo(1, 12);
    }
    expect(planetKernel(2)).toBe(0);
    expect(planetKernel(0)).toBeCloseTo(2 / 3, 12);
  });
});
