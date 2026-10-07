// The exponential haze published in ctx.sky (hazeExtinction, hazeScaleHeight) must match the sky's
// two-layer atmosphere where aircraft, terrain and clouds are: exact at sea level, within ~15 % up to 3 km.
import { describe, expect, it } from 'vitest';
import { atmosphereParams, fitHaze } from '../../src/render/sky/params';

const vec2 = () => ({ x: 0, y: 0, set(x: number, y: number) { this.x = x; this.y = y; return this; } });

describe('fitHaze', () => {
  for (const visKm of [2, 5, 10, 30, 60, 150]) {
    it(`matches the model at ${visKm} km visibility`, () => {
      const p = atmosphereParams(visKm * 1000);
      const f = fitHaze(p, vec2());
      const truth = (hM: number) =>
        (p.mieExtinction[1] * Math.exp(-hM / 1000 / p.mieScaleHeight) + p.rayleighScattering[1] * Math.exp(-hM / 1000 / p.rayleighScaleHeight)) / 1000;
      expect(f.x).toBeCloseTo(truth(0), 12);
      expect(f.y).toBeGreaterThan(1000);
      expect(f.y).toBeLessThan(8000);
      for (let h = 0; h <= 3000; h += 250) {
        const ratio = (f.x * Math.exp(-h / f.y)) / truth(h);
        expect(ratio).toBeGreaterThan(0.85);
        expect(ratio).toBeLessThan(1.15);
      }
    });
  }
});
