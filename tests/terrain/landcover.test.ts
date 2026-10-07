// Land cover, landform lattice, tile landform attributes, and the vegetation LOD / shadow-proxy models.
import { describe, expect, it } from 'vitest';
import { AIRPORT, runwayCoords } from '../../src/core/world';
import { FENCE_RECT } from '../../src/world/airport/layout';
import { computeBiome, CoverShapeField, coverShape, fenceDistance, makeBiome, makeCoverShape, SHAPE_LATTICE } from '../../src/world/terrain/biome';
import { makeSample, sampleTerrain } from '../../src/world/terrain/heightfield';
import { buildTile, tileVertexCount } from '../../src/world/terrain/tileBuilder';
import { createShadowProxies, createTreeGeometries } from '../../src/world/terrain/vegetation/treeModels';

const localToNed = (u: number, v: number): { north: number; east: number } => {
  const c = Math.cos(AIRPORT.runway.heading);
  const s = Math.sin(AIRPORT.runway.heading);
  return { north: AIRPORT.runway.center.north + u * c - v * s, east: AIRPORT.runway.center.east + u * s + v * c };
};

describe('airport land cover', () => {
  it('measures the signed distance from the perimeter fence', () => {
    const inside = localToNed(0, (FENCE_RECT.v0 + FENCE_RECT.v1) / 2);
    expect(fenceDistance(inside.north, inside.east)).toBeLessThan(-100);
    const out = localToNed(0, FENCE_RECT.v1 + 50);
    expect(fenceDistance(out.north, out.east)).toBeCloseTo(50, 5);
    const corner = localToNed(FENCE_RECT.u1 + 30, FENCE_RECT.v1 + 40);
    expect(fenceDistance(corner.north, corner.east)).toBeCloseTo(50, 5);
    // Agrees with runwayCoords (the shader's version uses the same frame).
    const r = runwayCoords(out.north, out.east);
    expect(r.across).toBeCloseTo(FENCE_RECT.v1 + 50, 6);
  });

  it('has no farmland inside the fence and fields right outside it on the flattened valley floor', () => {
    const s = makeSample();
    const b = makeBiome();
    let inside = 0;
    let outside = 0;
    let outsideFarm = 0;
    for (let u = -900; u <= 900; u += 150) {
      for (const v of [FENCE_RECT.v0 + 30, 60, FENCE_RECT.v1 - 20]) {
        const p = localToNed(u, v);
        sampleTerrain(p.north, p.east, s);
        computeBiome(p.north, p.east, s, 1, b);
        inside = Math.max(inside, b.farmland);
      }
      for (const v of [FENCE_RECT.v0 - 150, FENCE_RECT.v1 + 150]) {
        const p = localToNed(u, v);
        sampleTerrain(p.north, p.east, s);
        computeBiome(p.north, p.east, s, 1, b);
        outside++;
        if (b.farmland > 0.5) outsideFarm++;
        // No forest in the obstacle-free zone around the runway.
        if (s.airportBlend < 0.98) expect(b.forest).toBe(0);
      }
    }
    expect(inside).toBe(0);
    expect(outsideFarm / outside).toBeGreaterThan(0.6);
  });
});

describe('landform lattice', () => {
  it('matches the per-point landform measure closely', () => {
    const f = new CoverShapeField().build(28000, -3000, 29000, -2000);
    const s = makeSample();
    const a = makeCoverShape();
    const b = makeCoverShape();
    let worst = 0;
    for (let k = 0; k < 200; k++) {
      const n = 28000 + ((k * 37) % 1000);
      const e = -3000 + ((k * 53) % 1000);
      coverShape(n, e, sampleTerrain(n, e, s).ground, a);
      f.at(n, e, b);
      worst = Math.max(worst, Math.abs(a.up - b.up));
    }
    // Mountain terrain; the lattice interpolates between 32 m nodes.
    expect(worst).toBeLessThan(0.2);
  });

  it('gives the same landform whatever rectangle it was built for (LOD independent)', () => {
    const big = new CoverShapeField().build(20000, 1000, 22048, 3048);
    const small = new CoverShapeField().build(20500, 1500, 20628, 1628);
    const a = makeCoverShape();
    const b = makeCoverShape();
    for (let k = 0; k < 50; k++) {
      const n = 20500 + k * 2.5;
      const e = 1500 + ((k * 7) % 128);
      big.at(n, e, a);
      small.at(n, e, b);
      expect(b.up).toBeCloseTo(a.up, 5);
      expect(b.curvature).toBeCloseTo(a.curvature, 6);
    }
    expect(SHAPE_LATTICE).toBe(32);
  });
});

describe('tile landform attribute', () => {
  it('stores curvature and the parent-lattice forest density per vertex', () => {
    const t = buildTile({ level: 0, ix: 9, iz: 100, grid: 32, leafSize: 128 });
    const n = 33;
    expect(t.shape.length).toBe(tileVertexCount(32) * 4);
    // Even vertices lie on the parent lattice: their parent forest density is their own.
    for (let j = 0; j < n; j += 2) {
      for (let i = 0; i < n; i += 2) {
        const v = j * n + i;
        expect(Math.abs(t.shape[v * 4 + 1] - t.biome[v * 4])).toBeLessThanOrEqual(1);
      }
    }
    // Odd vertices take the mean of the two parent vertices at the ends of their edge.
    const v = 3 * n + 4;
    expect(Math.abs(t.shape[v * 4 + 1] - (t.biome[(v - n) * 4] + t.biome[(v + n) * 4]) / 2)).toBeLessThanOrEqual(1);
  });
});

describe('tree models', () => {
  it('has a reduced far LOD for every species with well under the cards of the full tree', () => {
    const full = createTreeGeometries(0);
    const far = createTreeGeometries(1);
    expect(far.length).toBe(full.length);
    for (let s = 0; s < full.length; s++) {
      const a = full[s].index!.count;
      const b = far[s].index!.count;
      expect(b).toBeLessThan(a * 0.7);
      expect(b).toBeGreaterThan(a * 0.2);
    }
  });

  it('has a small closed shadow proxy per species inside the unit tree', () => {
    const proxies = createShadowProxies();
    expect(proxies.length).toBe(4);
    for (const g of proxies) {
      expect(g.index!.count / 3).toBeLessThan(400);
      g.computeBoundingBox();
      expect(g.boundingBox!.max.y).toBeLessThanOrEqual(1);
      expect(g.boundingBox!.min.y).toBeGreaterThanOrEqual(-0.01);
      expect(g.boundingBox!.max.x).toBeLessThan(0.4);
    }
  });
});
