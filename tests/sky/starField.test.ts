import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { SimContext } from '../../src/core/context';
import { Celestial } from '../../src/render/sky/celestial';
import { STAR_E0 } from '../../src/render/sky/glsl/stars';
import { decodeStarCatalog, starIndexByHR } from '../../src/render/sky/starCatalog';
import { STAR_FRAG, STAR_RADIANCE_CLAMP, StarField, peakWeight, starAttributes } from '../../src/render/sky/StarField';

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

  it('clamps a star pixel below half-float overflow, which a narrow FOV would otherwise reach', () => {
    // Sirius's central pixel, unit gains, no extinction, a 900 px tall view: radiance = E w / pixelAngle^2.
    const e = STAR_E0 * Math.pow(10, 0.4 * 1.46);
    const centre = (fovDeg: number): number => {
      const pixelAngle = (2 * Math.tan((fovDeg * Math.PI) / 360)) / 900;
      return (e * peakWeight()) / (pixelAngle * pixelAngle);
    };
    expect(centre(0.1)).toBeGreaterThan(65504);
    expect(centre(60)).toBeLessThan(STAR_RADIANCE_CLAMP / 100);
    expect(STAR_RADIANCE_CLAMP).toBeLessThan(65504);
    const out = /gl_FragColor\s*=\s*vec4\(min\((.*)\),\s*1\.0\);/.exec(STAR_FRAG);
    expect(out, 'the fragment output is min(..., vec3(clamp))').not.toBeNull();
    expect(out![1]).toContain(`vec3(${STAR_RADIANCE_CLAMP.toFixed(1)})`);
  });
});
