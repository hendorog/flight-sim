import { describe, expect, it } from 'vitest';
import type { DataTexture } from 'three';
import { claddingProfile, CLADDING_TILE, makeAsphaltTexture, makeConcreteTexture } from '../../src/world/airport/textures';
import { RUNWAY_PAINT_ALBEDO } from '../../src/world/airport/pavementGlsl';

/** Mean of the packed albedo channel (R, linear). */
function meanAlbedo(t: DataTexture): number {
  const d = t.image.data as Uint8Array;
  let s = 0;
  for (let i = 0; i < d.length; i += 4) s += d[i];
  return s / (d.length / 4) / 255;
}

describe('pavement albedo', () => {
  const asphalt = meanAlbedo(makeAsphaltTexture(1));
  const concrete = meanAlbedo(makeConcreteTexture(1));
  it('uses weathered-asphalt and aged-concrete albedos', () => {
    expect(asphalt).toBeGreaterThan(0.08);
    expect(asphalt).toBeLessThan(0.13);
    expect(concrete).toBeGreaterThan(0.25);
    expect(concrete).toBeLessThan(0.4);
  });
  it('gives runway paint a 5:1 or better contrast against the asphalt', () => {
    expect(RUNWAY_PAINT_ALBEDO).toBeGreaterThanOrEqual(0.7);
    expect(RUNWAY_PAINT_ALBEDO / asphalt).toBeGreaterThan(5);
  });
});

describe('steel cladding profile', () => {
  it('tiles seamlessly with three 32 mm major ribs per sheet', () => {
    expect(claddingProfile(0.001)).toBeCloseTo(claddingProfile(CLADDING_TILE + 0.001), 6);
    let ribs = 0, prev = claddingProfile(0);
    for (let i = 1; i <= 3000; i++) {
      const h = claddingProfile((i / 3000) * CLADDING_TILE);
      if (prev < 0.016 && h >= 0.016) ribs++;
      prev = h;
    }
    expect(ribs).toBe(3);
    expect(Math.max(...Array.from({ length: 300 }, (_, i) => claddingProfile((i / 300) * CLADDING_TILE)))).toBeCloseTo(0.032, 3);
  });
});
