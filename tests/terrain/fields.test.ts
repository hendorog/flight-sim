import { describe, expect, it } from 'vitest';
import { DISTRICT_M, makeParcel, parcelAt } from '../../src/world/terrain/fields';
import { SOIL_ALBEDO } from '../../src/world/terrain/terrainMaterial';

describe('farmland layout', () => {
  // Districts sampled every 100 m over a 24 km square.
  const STEP = 100;
  const N = 240;
  const p = makeParcel();
  const ids = new Map<string, number>();
  const grid = new Int32Array(N * N);
  const border = new Float64Array(N * N);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      parcelAt(-12000 + i * STEP, -12000 + j * STEP, p);
      const key = `${p.districtX},${p.districtY}`;
      if (!ids.has(key)) ids.set(key, ids.size);
      grid[j * N + i] = ids.get(key)!;
      border[j * N + i] = p.border;
    }
  }

  it('cuts the land into districts of about the design size', () => {
    const expected = (N * STEP) ** 2 / DISTRICT_M ** 2;
    expect(ids.size).toBeGreaterThan(expected * 0.7);
    expect(ids.size).toBeLessThan(expected * 1.5);
  });

  it('has irregular districts (a jittered Voronoi diagram, not a warped lattice of equal cells)', () => {
    const area = new Array<number>(ids.size).fill(0);
    for (let k = 0; k < grid.length; k++) area[grid[k]]++;
    // Districts cut by the edge of the sampled square are left out.
    const edge = new Set<number>();
    for (let k = 0; k < N; k++) for (const v of [grid[k], grid[(N - 1) * N + k], grid[k * N], grid[k * N + N - 1]]) edge.add(v);
    const inner = area.filter((_, id) => !edge.has(id));
    const mean = inner.reduce((a, b) => a + b, 0) / inner.length;
    const sd = Math.sqrt(inner.reduce((a, b) => a + (b - mean) ** 2, 0) / inner.length);
    expect(inner.length).toBeGreaterThan(40);
    expect(sd / mean).toBeGreaterThan(0.18);
  });

  it('reports the distance to the district border (the winding lanes)', () => {
    let changes = 0;
    for (let j = 0; j < N; j++) {
      for (let i = 0; i + 1 < N; i++) {
        const k = j * N + i;
        if (grid[k] !== grid[k + 1]) {
          changes++;
          // The border lies between the two samples, so neither is farther from it than their spacing (plus
          // the warp's stretch of distances).
          expect(Math.min(border[k], border[k + 1])).toBeLessThan(STEP * 1.5);
        } else if (border[k] > STEP * 3) expect(grid[k]).toBe(grid[k + 1]);
      }
    }
    expect(changes).toBeGreaterThan(100);
  });

  it('keeps hedgerows, tracks and margins consistent', () => {
    let hedges = 0;
    const q = makeParcel();
    for (let k = 0; k < 4000; k++) {
      parcelAt(Math.sin(k * 12.9898) * 9000, Math.cos(k * 78.233) * 9000, q);
      expect(q.margin).toBeLessThanOrEqual(Math.min(q.hedge, q.track) + 1e-9);
      expect(q.track).toBeLessThanOrEqual(q.border + 1e-9);
      if (q.hedge < 5) hedges++;
    }
    // Hedgerows along roughly a third of the field edges: a few per cent of the ground lies within 5 m.
    expect(hedges).toBeGreaterThan(40);
    expect(hedges).toBeLessThan(600);
  });
});

describe('soil palette', () => {
  const srgb = (c: number): number => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
  it('is warm brown to tan (no grey-mauve soils)', () => {
    for (const [name, lin] of Object.entries(SOIL_ALBEDO)) {
      const [r, g, b] = lin.map(srgb);
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const hue = (60 * (g - b)) / (max - min);
      expect(r, name).toBe(max);
      expect(hue, name).toBeGreaterThanOrEqual(25);
      expect(hue, name).toBeLessThanOrEqual(50);
      expect((max - min) / max, name).toBeGreaterThan(0.25);
    }
  });
});
