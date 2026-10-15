import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { SimContext } from '../../src/core/context';
import { Celestial } from '../../src/render/sky/celestial';
import { STAR_E0 } from '../../src/render/sky/glsl/stars';
import { decodeStarCatalog, starIndexByHR } from '../../src/render/sky/starCatalog';
import { POINT_SPREAD_MAX, POINT_SPREAD_WHITE, pointSpread } from '../../src/render/sky/glsl/pointSpread';
import { STAR_FRAG, STAR_RADIANCE_CLAMP, STAR_VERT, StarField, peakWeight, starAttributes } from '../../src/render/sky/StarField';

interface Fs {
  readFileSync(path: URL): Uint8Array;
}

describe('StarField', () => {
  it('constructs, builds and updates in node with the procedural fallbacks (no fetch, ready flags 0)', () => {
    expect(typeof document).toBe('undefined');
    const field = new StarField();
    expect(field.uniforms.uCatalogReady.value).toBe(0);
    expect(field.uniforms.uMilkyWayReady.value).toBe(0);
    expect(field.uniforms.tMilkyWay.value).toBeInstanceOf(THREE.Texture);
    const shared = { ...field.uniforms, uNight: { value: 1 } };
    field.build(shared);
    const celestial = new Celestial();
    celestial.update(23, 172);
    field.update({} as SimContext, celestial, 0.001);
    expect(field.object.children).toHaveLength(0);
    expect(field.uniforms.uCatalogReady.value).toBe(0);
    field.dispose();
  });

  it('carries each star’s flux: Sirius at E0 10^(0.584), luminance-normalised colour', async () => {
    const fs = (await import(/* @vite-ignore */ 'node:fs' as string)) as Fs;
    const bytes = fs.readFileSync(new URL('../../public/sky/stars/bsc5.bin', import.meta.url));
    const cat = decodeStarCatalog(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    const a = starAttributes(cat);
    expect(a.position).toHaveLength(cat.count * 3);
    const i = starIndexByHR(cat, 2491);
    const lum = 0.2126 * a.flux[3 * i] + 0.7152 * a.flux[3 * i + 1] + 0.0722 * a.flux[3 * i + 2];
    expect(lum / (STAR_E0 * Math.pow(10, 0.4 * 1.46))).toBeCloseTo(1, 5);
    for (let k = 0; k < cat.count; k++) {
      expect(Math.hypot(a.position[3 * k], a.position[3 * k + 1], a.position[3 * k + 2])).toBeCloseTo(1, 5);
      expect(a.twinkle[2 * k]).toBeGreaterThanOrEqual(0);
      expect(a.twinkle[2 * k]).toBeLessThan(1);
    }
  });

  it('box-integrated Gaussian: a 5 px sprite holds the whole flux at any sub-pixel phase', () => {
    // Mirror of the fragment shader's pixelShare (sigma 0.6 px) over the pixels a 5 px point covers.
    const erf = (x: number): number => {
      const t = 1 / (1 + 0.3275911 * Math.abs(x));
      return Math.sign(x) * (1 - t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429)))) * Math.exp(-x * x));
    };
    const share = (c: number): number => 0.5 * (erf((c + 0.5) / (0.6 * Math.SQRT2)) - erf((c - 0.5) / (0.6 * Math.SQRT2)));
    for (let phase = -0.5; phase <= 0.5; phase += 0.05) {
      // Pixel centres inside [centre - 2.5, centre + 2.5].
      let sum = 0;
      for (let p = -3; p <= 3; p++) {
        const c = p - phase;
        if (Math.abs(c) <= 2.5) sum += share(c);
      }
      expect(sum).toBeGreaterThan(0.999);
      expect(sum).toBeLessThan(1.0001);
    }
  });

  it('a star over display white spreads wider but keeps its flux in its (larger) sprite', () => {
    const erf = (x: number): number => {
      const t = 1 / (1 + 0.3275911 * Math.abs(x));
      return Math.sign(x) * (1 - t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429)))) * Math.exp(-x * x));
    };
    expect(pointSpread(0.5)).toBe(1);
    expect(pointSpread(POINT_SPREAD_WHITE)).toBe(1);
    expect(pointSpread(POINT_SPREAD_WHITE * 4)).toBeGreaterThan(1.5);
    expect(pointSpread(1e9)).toBe(POINT_SPREAD_MAX);
    for (const spread of [1, 1.7, POINT_SPREAD_MAX]) {
      const sigma = 0.6 * spread;
      // As the vertex shader: side = ceil(5 / 0.6 * sigma), so the sprite reaches +-4.17 sigma.
      const size = Math.ceil((5 / 0.6) * sigma - 0.001);
      const k = 1 / (sigma * Math.SQRT2);
      const share = (c: number): number => 0.5 * (erf((c + 0.5) * k) - erf((c - 0.5) * k));
      for (let phase = -0.5; phase <= 0.5; phase += 0.1) {
        let sum = 0;
        for (let p = -12; p <= 12; p++) {
          const c = p - phase;
          if (Math.abs(c) <= size / 2) sum += share(c);
        }
        expect(sum).toBeGreaterThan(0.999);
        expect(sum).toBeLessThan(1.0001);
      }
    }
    expect(STAR_FRAG).toContain('(gl_PointCoord - 0.5) * vSize');
  });

  it('clamps a star pixel below half-float overflow, which a narrow FOV would otherwise reach', () => {
    // Sirius's central pixel, unit gains, no extinction, a 900 px tall view: radiance = E w / pixelAngle^2.
    const e = STAR_E0 * Math.pow(10, 0.4 * 1.46);
    const centre = (fovDeg: number): number => {
      const pixelAngle = (2 * Math.tan((fovDeg * Math.PI) / 360)) / 900;
      return (e * peakWeight()) / (pixelAngle * pixelAngle);
    };
    expect(centre(0.1)).toBeGreaterThan(65504);
    expect(centre(60)).toBeLessThan(STAR_RADIANCE_CLAMP / 100);
    // Per sprite, but sprites add: three coincident clamped sprites (a close pair at an extreme zoom) stay finite.
    expect(3 * STAR_RADIANCE_CLAMP).toBeLessThan(65504);
    const out = /gl_FragColor\s*=\s*vec4\(min\((.*)\),\s*1\.0\);/.exec(STAR_FRAG);
    expect(out, 'the fragment output is min(..., vec3(clamp))').not.toBeNull();
    expect(out![1]).toContain(`vec3(${STAR_RADIANCE_CLAMP.toFixed(1)})`);
  });

  it('keeps a star\'s flux off the view axis: radiance scales as 1 / cos^3 of the off-axis angle', () => {
    // The gnomonic pixel solid angle, measured: the pixel at tangent-plane offset (x, y) spans pa^2 / (1 + x^2 + y^2)^1.5.
    const pa = 1e-3;
    for (const [x, y] of [[0, 0], [0.4, 0.2], [0.51, 0.29], [1, 0.7]]) {
      const corner = (a: number, b: number): number[] => {
        const n = Math.hypot(a, b, 1);
        return [a / n, b / n, 1 / n];
      };
      // Solid angle of the small quad from its corner directions (two spherical triangles, Van Oosterom & Strackee).
      const tri = (a: number[], b: number[], c: number[]): number => {
        const dot = (u: number[], v: number[]): number => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
        const cr = [b[1] * c[2] - b[2] * c[1], b[2] * c[0] - b[0] * c[2], b[0] * c[1] - b[1] * c[0]];
        return 2 * Math.atan2(Math.abs(dot(a, cr)), 1 + dot(a, b) + dot(b, c) + dot(c, a));
      };
      const h = pa / 2;
      const p00 = corner(x - h, y - h);
      const p10 = corner(x + h, y - h);
      const p11 = corner(x + h, y + h);
      const p01 = corner(x - h, y + h);
      const omega = tri(p00, p10, p11) + tri(p00, p11, p01);
      const cd = 1 / Math.hypot(x, y, 1);
      expect(omega / (pa * pa * cd ** 3)).toBeCloseTo(1, 5);
    }
    // ...and the vertex shader divides by exactly that (cd = -view.z, the off-axis cosine).
    expect(STAR_VERT).toMatch(/float cd = -view\.z;/);
    expect(STAR_VERT).toMatch(/\/ \(uPixelAngle \* uPixelAngle \* cd \* cd \* cd\)/);
    expect(STAR_VERT).toMatch(/vec3 view = mat3\(viewMatrix\) \* dir;/);
  });
});
