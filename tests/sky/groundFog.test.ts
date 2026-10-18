// The ground fog layer (render/weather/fogModel.ts, ported to GLSL in fogGlsl.ts) must integrate its own medium
// exactly: the analytic optical depth along any straight segment must match a fine numeric integral of the density
// profile (uniform below the ramp, smoothstep fall-off to the top), a horizontal path of fogVisibilityM inside the
// uniform part must leave the Koschmieder 2 % contrast, nothing above the top may be fogged, and without a fog layer
// the uniform must leave the scene untouched.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { defaultWeather, type WeatherSettings } from '../../src/core/types';
import { AIRPORT } from '../../src/core/world';
import { FOG_GLSL, fogUniformValue } from '../../src/render/weather/fogGlsl';
import {
  FOG_FLAT_DY_M,
  FOG_RAMP_FRACTION,
  fogDensity,
  fogOpticalDepth,
  fogRadiance,
  fogShape,
  fogSunTransmittance,
  phaseHG,
  type FogShape,
} from '../../src/render/weather/fogModel';

const ELEV = AIRPORT.elevation;

function report(label: string, values: Record<string, number>): void {
  const parts = Object.entries(values).map(([k, v]) => `${k}=${Number(v.toPrecision(4))}`);
  console.log(`[groundFog] ${label}: ${parts.join(' ')}`);
}

/** Midpoint-rule integral of beta * rho along the segment, `steps` steps. */
function numericDepth(s: FogShape, y0: number, y1: number, d: number, steps = 2000): number {
  let tau = 0;
  for (let i = 0; i < steps; i++) {
    const y = y0 + ((i + 0.5) / steps) * (y1 - y0);
    tau += s.beta * fogDensity(s.yA, s.yTop, y) * (d / steps);
  }
  return tau;
}

/** A segment from (camera altitude, elevation angle deg, length m). */
function segment(y0: number, elevDeg: number, d: number): [number, number, number] {
  return [y0, y0 + d * Math.sin((elevDeg * Math.PI) / 180), d];
}

describe('ground fog optical depth', () => {
  const shape = fogShape(60, 200, ELEV, { beta: 0, yA: 0, yTop: 0 });

  it('places the layer on the field: top at elevation + fogTopM, ramp over the top FOG_RAMP_FRACTION, beta 3.912 / visibility', () => {
    expect(shape.yTop).toBe(ELEV + 60);
    expect(shape.yA).toBeCloseTo(ELEV + 60 - FOG_RAMP_FRACTION * 60, 12);
    expect(shape.beta).toBeCloseTo(3.912 / 200, 15);
    expect(fogShape(0, 200, ELEV, { beta: 1, yA: 0, yTop: 0 }).beta).toBe(0);
    expect(fogDensity(shape.yA, shape.yTop, ELEV)).toBe(1);
    expect(fogDensity(shape.yA, shape.yTop, shape.yTop)).toBe(0);
    expect(fogDensity(shape.yA, shape.yTop, 0.5 * (shape.yA + shape.yTop))).toBeCloseTo(0.5, 12);
  });

  it('matches a 2000-step numeric integral within 1 % for 20 ray geometries', () => {
    const cases: [number, number, number][] = [
      // horizontal, inside the uniform part, in the ramp, at the top, above
      segment(ELEV + 2, 0, 500),
      segment(ELEV + 30, 0, 3000),
      segment(shape.yA + 3, 0, 800),
      segment(shape.yA + 10, 0, 800),
      // 10 degrees up from inside, from below the field, from the ramp
      segment(ELEV + 2, 10, 600),
      segment(ELEV + 2, 10, 100),
      segment(ELEV - 40, 10, 1500),
      segment(shape.yA + 5, 10, 200),
      // 45 degrees down from above the layer, from inside, through the ramp only
      segment(ELEV + 300, -45, 450),
      segment(ELEV + 300, -45, 1000),
      segment(ELEV + 40, -45, 50),
      segment(shape.yTop + 5, -45, 15),
      // shallow descents and climbs through the ramp
      segment(ELEV + 100, -3, 1500),
      segment(ELEV + 100, -1, 4000),
      segment(shape.yA - 2, 2, 400),
      segment(ELEV + 5, 2, 3000),
      // steep, vertical, and a segment whose altitude change is just above the flat threshold
      segment(ELEV + 1, 80, 200),
      segment(ELEV + 500, -90, 500),
      [shape.yA + 2, shape.yA + 2 + 2 * FOG_FLAT_DY_M, 300],
      [shape.yA + 6, shape.yA + 6 + 0.4 * FOG_FLAT_DY_M, 300],
    ];
    expect(cases.length).toBe(20);
    let worst = 0;
    for (const [y0, y1, d] of cases) {
      const a = fogOpticalDepth(shape.beta, shape.yA, shape.yTop, y0, y1, d);
      const n = numericDepth(shape, y0, y1, d);
      expect(n).toBeGreaterThan(0);
      const err = Math.abs(a - n) / n;
      worst = Math.max(worst, err);
      expect(err, `y0 ${y0.toFixed(1)} y1 ${y1.toFixed(1)} d ${d}`).toBeLessThan(0.01);
      // Direction does not matter.
      expect(fogOpticalDepth(shape.beta, shape.yA, shape.yTop, y1, y0, d)).toBeCloseTo(a, 9);
    }
    report('analytic vs 2000-step integral', { cases: cases.length, worstRelErr: worst });
  });

  it('leaves exp(-3.912) = 0.020 +- 0.0005 over fogVisibilityM horizontally inside the uniform part', () => {
    for (const vis of [50, 200, 1000]) {
      const s = fogShape(100, vis, ELEV, { beta: 0, yA: 0, yTop: 0 });
      const t = Math.exp(-fogOpticalDepth(s.beta, s.yA, s.yTop, ELEV + 10, ELEV + 10, vis));
      report(`horizontal transmittance at ${vis} m`, { T: t });
      expect(Math.abs(t - Math.exp(-3.912))).toBeLessThan(0.0005);
    }
  });

  it('gives zero optical depth for a segment entirely above the top, and for no fog', () => {
    expect(fogOpticalDepth(shape.beta, shape.yA, shape.yTop, shape.yTop, shape.yTop + 500, 2000)).toBe(0);
    expect(fogOpticalDepth(shape.beta, shape.yA, shape.yTop, shape.yTop + 1, shape.yTop + 1, 5000)).toBe(0);
    expect(fogOpticalDepth(0, shape.yA, shape.yTop, ELEV, ELEV, 5000)).toBe(0);
  });

  it('lets the full sun through above the top and dims it inside the layer', () => {
    expect(fogSunTransmittance(shape.beta, shape.yA, shape.yTop, shape.yTop + 10, 0.5)).toBe(1);
    const inside = fogSunTransmittance(shape.beta, shape.yA, shape.yTop, ELEV + 2, 0.5);
    const low = fogSunTransmittance(shape.beta, shape.yA, shape.yTop, ELEV + 2, 0.1);
    report('sun transmittance from 2 m AGL, 60 m fog of 200 m', { mu05: inside, mu01: low });
    expect(inside).toBeLessThan(1);
    expect(low).toBeLessThan(inside);
  });
});

describe('ground fog radiance and uniform', () => {
  it('returns the input exactly at zero optical depth and the in-scatter when saturated', () => {
    const c = [123.4, 56.7, 8.9];
    const out = [0, 0, 0];
    fogRadiance(c, 0, [50, 60, 70], [1e4, 1e4, 1e4], 0.3, 1, out);
    expect(out).toEqual(c);
    fogRadiance(c, 80, [50, 60, 70], [0, 0, 0], 0.3, 1, out);
    expect(out[0]).toBeCloseTo(50, 9);
    expect(out[2]).toBeCloseTo(70, 9);
  });

  it('uses a normalised Henyey-Greenstein sun phase', () => {
    let sum = 0;
    const n = 4000;
    for (let i = 0; i < n; i++) {
      const mu = -1 + (2 * (i + 0.5)) / n;
      sum += phaseHG(mu, 0.85) * 2 * Math.PI * (2 / n);
    }
    expect(sum).toBeCloseTo(1, 3);
  });

  it('sets uFog to zero without a fog layer and to (beta, yA, yTop, 1) with one', () => {
    const v = new THREE.Vector4(9, 9, 9, 9);
    fogUniformValue(defaultWeather(), v);
    expect(v.toArray()).toEqual([0, 0, 0, 0]);
    const w: WeatherSettings = { ...defaultWeather(), fogTopM: 60, fogVisibilityM: 150 };
    fogUniformValue(w, v);
    expect(v.x).toBeCloseTo(3.912 / 150, 12);
    expect(v.z).toBe(ELEV + 60);
    expect(v.y).toBeCloseTo(ELEV + 60 - FOG_RAMP_FRACTION * 60, 9);
    expect(v.w).toBe(1);
    // An out-of-range depth is clamped by fogOf; a malformed one reads as no fog.
    fogUniformValue({ ...defaultWeather(), fogTopM: 'deep' as unknown as number }, v);
    expect(v.w).toBe(0);
  });

  it('ports the flat-segment threshold and the antiderivative into the GLSL', () => {
    expect(FOG_GLSL).toContain(`abs(dy) < ${FOG_FLAT_DY_M.toFixed(2)}`);
    expect(FOG_GLSL).toContain('s - s3 + 0.5 * s3 * s');
    expect(FOG_GLSL).toContain('if (uFog.w < 0.5) return 0.0;');
  });
});
