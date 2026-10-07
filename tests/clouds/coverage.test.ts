// Cloud cover: the coverage field keeps a uniform distribution while the weather evolves, and the requested
// cover maps through the measured calibration to the coverage control, so `cloudCover` means the fraction of
// the sky overhead (of the ground under cloud) at every stage of the evolution.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  blendFields,
  COVER_CALIBRATION,
  coverageControl,
  coverageParams,
  equalizeToNormal,
  evolveWeights,
  normalCdf,
  normalQuantile,
  Z_RANGE,
} from '../../src/render/clouds/coverage';
import { CloudModel } from '../../src/render/clouds/cloudModel';
import { defaultWeather } from '../../src/core/types';
import type { SimContext } from '../../src/core/context';

/** Deterministic pseudo-random numbers (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** An RGBA8 image whose channel 0 is a skewed (non-uniform) random field, as the raw noise shader gives. */
function skewedField(n: number, seed: number): Uint8Array {
  const r = rng(seed);
  const px = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) px[i * 4] = Math.round(255 * Math.pow(r(), 2.5));
  return px;
}

const decode = (v: number): number => (v / 255 - 0.5) * 2 * Z_RANGE;

describe('normal CDF and quantile', () => {
  it('are accurate and inverse to each other', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 7);
    expect(normalCdf(1)).toBeCloseTo(0.841345, 5);
    expect(normalCdf(-1.959964)).toBeCloseTo(0.025, 5);
    for (const p of [0.001, 0.02, 0.1, 0.35, 0.5, 0.8, 0.975, 0.999]) expect(normalCdf(normalQuantile(p))).toBeCloseTo(p, 6);
  });
  it('the shader form (tanh approximation) stays within 2e-4 of the CDF', () => {
    const glsl = (z: number): number => 0.5 + 0.5 * Math.tanh(0.7978845608 * (z + 0.044715 * z * z * z));
    for (let z = -3; z <= 3; z += 0.05) expect(Math.abs(glsl(z) - normalCdf(z))).toBeLessThan(2e-4);
  });
});

describe('coverage field', () => {
  const N = 200_000;
  it('is stored as standard normal scores', () => {
    const px = skewedField(N, 1);
    equalizeToNormal(px, 0);
    let m = 0;
    let m2 = 0;
    for (let i = 0; i < N; i++) {
      const z = decode(px[i * 4]);
      m += z;
      m2 += z * z;
    }
    m /= N;
    expect(Math.abs(m)).toBeLessThan(0.03);
    expect(Math.sqrt(m2 / N - m * m)).toBeCloseTo(1, 1);
  });

  it('keeps a uniform distribution at every stage of the cross-fade (a linear mix would not)', () => {
    const a = skewedField(N, 2);
    const b = skewedField(N, 3);
    equalizeToNormal(a, 0);
    equalizeToNormal(b, 0);
    const w = { x: 0, y: 0 };
    for (const evolve of [0, 0.25, 0.5, 0.75, 1]) {
      evolveWeights(evolve, w);
      for (const threshold of [0.5, 0.65, 0.8, 0.9]) {
        let above = 0;
        let aboveLinear = 0;
        for (let i = 0; i < N; i++) {
          const v0 = a[i * 4] / 255;
          const v1 = b[i * 4] / 255;
          // Shader form: normalCdf(dot(v - 0.5, w)).
          if (normalCdf((v0 - 0.5) * w.x + (v1 - 0.5) * w.y) > threshold) above++;
          if (i % 5000 === 0) expect(blendFields(v0, v1, evolve)).toBeCloseTo(normalCdf((v0 - 0.5) * w.x + (v1 - 0.5) * w.y), 9);
          // What a plain mix of two uniform fields gives halfway through (triangular distribution).
          if ((normalCdf(decode(a[i * 4])) + normalCdf(decode(b[i * 4]))) / 2 > threshold) aboveLinear++;
        }
        expect(above / N).toBeCloseTo(1 - threshold, 1);
        expect(Math.abs(above / N - (1 - threshold))).toBeLessThan(0.02);
        if (evolve === 0.5 && threshold === 0.65) expect(aboveLinear / N).toBeLessThan(0.3);
      }
    }
  });
});

describe('cover calibration', () => {
  it('is monotonic and spans no cloud to a closed deck', () => {
    for (let i = 1; i < COVER_CALIBRATION.length; i++) {
      expect(COVER_CALIBRATION[i][0]).toBeGreaterThan(COVER_CALIBRATION[i - 1][0]);
      expect(COVER_CALIBRATION[i][1]).toBeGreaterThanOrEqual(COVER_CALIBRATION[i - 1][1]);
    }
    expect(COVER_CALIBRATION[0][1]).toBe(0);
    expect(COVER_CALIBRATION[COVER_CALIBRATION.length - 1][1]).toBe(1);
  });

  it('inverts the measured fraction: the control for a table fraction is that row', () => {
    const out = { x: 0, y: 0 };
    const ctl = { x: 0, y: 0 };
    for (const [x, f] of COVER_CALIBRATION) {
      if (f <= 0 || f >= 1) continue;
      coverageParams(f, out);
      coverageControl(x, ctl);
      expect(out.x).toBeCloseTo(ctl.x, 6);
      expect(out.y).toBeCloseTo(ctl.y, 6);
    }
  });

  it('lowers the threshold, then fills the gaps, as the cover rises', () => {
    const out = { x: 0, y: 0 };
    expect(coverageParams(0, out).x).toBe(1);
    let prevT = 2;
    let prevF = -1;
    for (let c = 0; c <= 1.0001; c += 0.05) {
      coverageParams(c, out);
      expect(out.x).toBeLessThanOrEqual(prevT);
      expect(out.y).toBeGreaterThanOrEqual(prevF);
      prevT = out.x;
      prevF = out.y;
    }
    // Scattered cumulus (3/8) needs a threshold well below 1 - cover: the cells' rims and noise erode them.
    expect(coverageParams(0.35, out).x).toBeLessThan(1 - 0.35 - 0.1);
    expect(out.y).toBe(0);
    expect(coverageParams(1, out).y).toBeGreaterThan(0.3);
  });

  it('maps an overcast to the fully filled deck, not to the first control that measures closed', () => {
    const out = { x: 0, y: 0 };
    const full = coverageControl(2, { x: 0, y: 0 });
    coverageParams(1, out);
    expect(out.x).toBe(full.x);
    expect(out.y).toBeCloseTo(full.y, 9);
    // Just below overcast the gaps are still partly open.
    expect(coverageParams(0.95, out).y).toBeLessThan(full.y);
  });

  it('is what CloudModel hands the shaders', () => {
    const m = new CloudModel();
    const expected = new THREE.Vector2();
    for (const cloudCover of [0, 0.2, 0.35, 0.6, 1]) {
      m.update({ weather: { ...defaultWeather(), cloudCover }, simTime: 0 } as unknown as SimContext, 0.016);
      coverageParams(cloudCover, expected);
      expect(m.uniforms.uCoverage.value.x).toBeCloseTo(expected.x, 9);
      expect(m.uniforms.uCoverage.value.y).toBeCloseTo(expected.y, 9);
    }
  });
});
