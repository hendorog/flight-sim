import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { SimContext } from '../../src/core/context';
import { DEG } from '../../src/core/math';
import { Celestial } from '../../src/render/sky/celestial';
import {
  MOON_DISPLAY_EV,
  MoonModel,
  moonApparentRadius,
  moonDiscPoint,
  moonDisplayScale,
  moonSurfaceLatLon,
  moonTexCoord,
} from '../../src/render/sky/moon';
import { DEFAULT_MOON_SCALE, MOON_ANGULAR_RADIUS, SCENE_UNITS_PER_LUX } from '../../src/render/sky/params';
import { MOON_GLSL } from '../../src/render/sky/glsl/moon';

const R = MOON_ANGULAR_RADIUS;

describe('moonApparentRadius', () => {
  it('is exactly real size at every altitude for s = 1', () => {
    for (const h of [-10, -1, 0, 5, 20, 34.9, 35, 60, 90]) expect(moonApparentRadius(1, h * DEG)).toBe(R);
  });

  it('is 4x above 35 deg and ~6.4x at the horizon by default', () => {
    expect(DEFAULT_MOON_SCALE).toBe(4);
    expect(moonApparentRadius(4, 40 * DEG) / R).toBeCloseTo(4, 10);
    expect(moonApparentRadius(4, 90 * DEG) / R).toBeCloseTo(4, 10);
    expect(moonApparentRadius(4, 0) / R).toBeCloseTo(6.4, 6);
    expect(moonApparentRadius(4, -3 * DEG) / R).toBeCloseTo(6.4, 6);
    // s = 5: 5 * (1 + 0.6 * 4 / 3) = 9x at the horizon (the plan's "8.2x" was an arithmetic slip).
    expect(moonApparentRadius(5, 0) / R).toBeCloseTo(9, 6);
  });

  it('shrinks monotonically with altitude and grows with the setting', () => {
    for (const s of [1, 1.25, 2, 3, 4, 5]) {
      let prev = Infinity;
      for (let h = -5; h <= 90; h += 0.5) {
        const r = moonApparentRadius(s, h * DEG);
        expect(r).toBeLessThanOrEqual(prev);
        prev = r;
      }
    }
    for (const h of [0, 10, 50]) expect(moonApparentRadius(3, h * DEG)).toBeLessThan(moonApparentRadius(3.25, h * DEG));
  });
});

describe('Moon map orientation', () => {
  it('maps the sub-Earth point to the map centre and round-trips', () => {
    const c = moonSurfaceLatLon(0, 0);
    expect(moonTexCoord(c.lat, c.lon)).toEqual({ u: 0.5, v: 0.5 });
    for (const [lat, lon] of [[33, -16], [-43, -11], [17, 59], [-60, 70]]) {
      const p = moonDiscPoint(lat, lon)!;
      const ll = moonSurfaceLatLon(p.x, p.y);
      expect(ll.lat / DEG).toBeCloseTo(lat, 9);
      expect(ll.lon / DEG).toBeCloseTo(lon, 9);
    }
    // Tycho in the equirect map (north row at the top, three's flipY): left of centre, in the lower half.
    const t = moonTexCoord(-43 * DEG, -11 * DEG);
    expect(t.u).toBeCloseTo(0.5 - 11 / 360, 9);
    expect(t.v).toBeCloseTo(0.5 - 43 / 180, 9);
  });

  it('shows Imbrium upper left, Tycho lower centre and Crisium on the right limb for a Moon due south', () => {
    // Find a time when the Moon crosses the meridian (due south) at the airfield, then project surface features
    // through the shader's basis onto a camera looking at it.
    const c = new Celestial();
    let best = { tod: 0, east: 1 };
    for (let tod = 20; tod < 28; tod += 0.01) {
      c.update(tod % 24, tod >= 24 ? 351 : 350);
      if (c.moonDir.y > 0 && c.moonDir.z > 0 && Math.abs(c.moonDir.x) < Math.abs(best.east)) best = { tod, east: c.moonDir.x };
    }
    c.update(best.tod % 24, best.tod >= 24 ? 351 : 350);
    expect(Math.abs(c.moonDir.x)).toBeLessThan(0.01);
    const D = c.moonDir.clone();
    const pole = new THREE.Vector3(0, 0, 1).applyMatrix3(c.equatorialToWorld);
    const ax = new THREE.Vector3().crossVectors(pole, D).normalize();
    const ay = new THREE.Vector3().crossVectors(D, ax);
    // Camera looking at the Moon, world up: screen right = forward x up, screen up = right x forward.
    const right = new THREE.Vector3().crossVectors(D, new THREE.Vector3(0, 1, 0)).normalize();
    const up = new THREE.Vector3().crossVectors(right, D);
    const screen = (lat: number, lon: number): { x: number; y: number } => {
      const p = moonDiscPoint(lat, lon)!;
      const d = D.clone().addScaledVector(ax, p.x * 0.01).addScaledVector(ay, p.y * 0.01).normalize();
      return { x: d.dot(right) / 0.01, y: d.dot(up) / 0.01 };
    };
    const imbrium = screen(33, -16);
    expect(imbrium.x).toBeLessThan(-0.1);
    expect(imbrium.y).toBeGreaterThan(0.4);
    const tycho = screen(-43, -11);
    expect(Math.abs(tycho.x)).toBeLessThan(0.2);
    expect(tycho.y).toBeLessThan(-0.5);
    const crisium = screen(17, 59);
    expect(crisium.x).toBeGreaterThan(0.75);
  });
});

describe('night display cap', () => {
  // The real peak (brightest highlands at full phase), as the shader sees it through uMoonLook.x.
  const model = new MoonModel();
  const c = new Celestial();
  c.update(23, 172);
  model.update({ moonScale: 4 } as unknown as SimContext, c);
  const peak = (2 ** MOON_DISPLAY_EV * 0.18) / model.uniforms.uMoonLook.value.x;
  /** The dome's uNight (SkyDome.update). */
  const uNight = (cel: Celestial): number => THREE.MathUtils.smoothstep(-cel.sunDir.y, -0.1, 0.05);

  it('is physical by day, even on a dim day with exposure bias, and without a known exposure', () => {
    const day = new Celestial();
    day.update(10, 172);
    expect(uNight(day)).toBe(0);
    /** EXPOSURE_GLSL's sceneExposure() (post/AutoExposure.ts) for an adapted luminance in cd/m^2 and a bias, EV. */
    const sceneExposure = (cdm2: number, bias: number): number => {
      const logL = Math.log2(cdm2 * SCENE_UNITS_PER_LUX);
      const keyBias = Math.max(-0.2 * Math.max(0, 11 - Math.log2(cdm2)), -4.5);
      return 0.18 * 2 ** (keyBias + bias - logL);
    };
    // Overcast / low-sun days, and a bright day under the dev harness's ev=2: the cap alone would bite here.
    for (const [cdm2, bias] of [[300, 0], [1000, 2], [2000, 3]]) {
      const exposure = sceneExposure(cdm2, bias);
      expect(moonDisplayScale(exposure, true, peak, 1)).toBeLessThan(0.6);
      expect(moonDisplayScale(exposure, true, peak, uNight(day))).toBe(1);
    }
    expect(moonDisplayScale(1e3, false, peak, 1)).toBe(1);
  });

  it('places the brightest highlands MOON_DISPLAY_EV over grey at night', () => {
    expect(uNight(c)).toBe(1);
    const exposure = 0.18 / 1e-2;
    const k = moonDisplayScale(exposure, true, peak, uNight(c));
    expect(k).toBeLessThan(1);
    expect(Math.log2((peak * k * exposure) / 0.18)).toBeCloseTo(MOON_DISPLAY_EV, 9);
  });

  it('gates the cap in the shader by uNight', () => {
    expect(MOON_GLSL).toMatch(/mix\(1\.0, min\(1\.0, uMoonLook\.x \/ sceneExposure\(\)\), uNight\)/);
  });
});

describe('MoonModel', () => {
  const ctx = (moonScale?: number): SimContext => ({ moonScale }) as unknown as SimContext;

  it('renders procedurally in node and writes the apparent radius every frame', () => {
    const m = new MoonModel();
    expect(m.uniforms.uMoonMapReady.value).toBe(0);
    const c = new Celestial();
    c.update(23, 172);
    const alt = Math.asin(c.moonDir.y);
    m.update(ctx(), c);
    expect(m.uniforms.uMoonAngularRadius.value).toBeCloseTo(moonApparentRadius(DEFAULT_MOON_SCALE, alt), 12);
    m.update(ctx(1), c);
    expect(m.uniforms.uMoonAngularRadius.value).toBe(R);
    m.update(ctx(5), c);
    expect(m.uniforms.uMoonAngularRadius.value).toBeCloseTo(moonApparentRadius(5, alt), 12);
  });

  it('never changes the moonlight: the size setting reaches only the disc', () => {
    const c = new Celestial();
    c.update(23, 172);
    const e = c.moonIlluminance;
    const m = new MoonModel();
    const radiance = m.uniforms.uMoonRadiance.value.clone();
    m.update(ctx(1), c);
    m.update(ctx(5), c);
    expect(c.moonIlluminance).toBe(e);
    expect(m.uniforms.uMoonRadiance.value.equals(radiance)).toBe(true);
    // Only the presentation path reads the setting (no lighting module does).
    const allowed = new Set([
      'src/core/context.ts',
      'src/render/sky/moon.ts',
      'src/render/sky/params.ts',
      'src/sim/Simulator.ts',
      'src/sim/skyPrefs.ts',
      'src/sim/params.ts',
      'src/ui/menu.ts',
      'src/dev/sky.ts',
    ]);
    const sources = import.meta.glob<string>('../../src/**/*.ts', { query: '?raw', import: 'default', eager: true });
    const readers = Object.entries(sources)
      .filter(([, text]) => /moonScale|MoonScale|MOON_SCALE/.test(text))
      .map(([path]) => path.replace('../../', ''));
    expect(readers).toContain('src/render/sky/moon.ts');
    for (const f of readers) expect(allowed.has(f), f).toBe(true);
  });
});
