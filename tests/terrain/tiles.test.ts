import { describe, expect, it } from 'vitest';
import { morphWindow, nodeKey, nodeSize, NodeRefPool, selectNodes, type LodSettings, type NodeRef } from '../../src/world/terrain/quadtree';
import { buildTile, buildTileIndices, tileVertexCount } from '../../src/world/terrain/tileBuilder';
import { BUCKETS, buildTreeCell, TREE_STRIDE } from '../../src/world/terrain/vegetation/placement';
import { AIRPORT } from '../../src/core/world';
import { makeParcel, parcelAt } from '../../src/world/terrain/fields';

const settings: LodSettings = { grid: 32, leafSize: 128, rootLevel: 10, rangeFactor: 4, maxDistance: 150_000 };

describe('tile builder', () => {
  it('builds consistent attribute arrays and indices', () => {
    const t = buildTile({ level: 3, ix: 2, iz: 7, grid: 32, leafSize: 128 });
    const n = tileVertexCount(32);
    expect(t.positions.length).toBe(n * 3);
    expect(t.normals.length).toBe(n * 4);
    expect(t.morph.length).toBe(n);
    expect(t.biome.length).toBe(n * 4);
    expect(t.shape.length).toBe(n * 4);
    // 36 bytes per vertex on the GPU.
    expect(t.river.length).toBe(n * 2);
    expect(t.positions.byteLength + t.normals.byteLength + t.morph.byteLength + t.biome.byteLength + t.shape.byteLength + t.river.byteLength).toBe(n * 36);
    // Level bytes: the level on the lattice, level + 16 on the skirts.
    expect(t.shape[2]).toBe(3);
    expect(t.shape[(n - 1) * 4 + 2]).toBe(3 + 16);
    const idx = buildTileIndices(32);
    expect(Math.max(...idx)).toBeLessThan(n);
    expect(t.maxHeight).toBeGreaterThanOrEqual(t.minHeight);
  });

  it('matches its neighbour exactly along the shared edge', () => {
    const a = buildTile({ level: 2, ix: 5, iz: 9, grid: 32, leafSize: 128 });
    const b = buildTile({ level: 2, ix: 6, iz: 9, grid: 32, leafSize: 128 });
    for (let j = 0; j <= 32; j++) {
      const ea = (j * 33 + 32) * 3 + 1; // a's east edge
      const eb = (j * 33) * 3 + 1; // b's west edge
      expect(a.positions[ea]).toBe(b.positions[eb]);
      expect(a.morph[j * 33 + 32]).toBe(b.morph[j * 33]);
      for (let c = 0; c < 4; c++) expect(a.normals[(j * 33 + 32) * 4 + c]).toBe(b.normals[j * 33 * 4 + c]);
    }
  });

  it('geomorphs odd vertices onto the parent lattice', () => {
    const child = buildTile({ level: 1, ix: 40, iz: 80, grid: 32, leafSize: 128 });
    const parent = buildTile({ level: 2, ix: 20, iz: 40, grid: 32, leafSize: 128 });
    // Child covers the parent's south-west quarter: child vertex (2i, 2j) = parent vertex (i, j).
    for (let j = 0; j <= 32; j += 2) {
      for (let i = 0; i <= 32; i += 2) {
        const c = (j * 33 + i) * 3 + 1;
        const p = ((j / 2) * 33 + i / 2) * 3 + 1;
        expect(child.positions[c]).toBeCloseTo(parent.positions[p], 6);
      }
    }
    // An odd vertex on a parent edge morphs to the mean of its two even neighbours.
    const v = 1 * 33 + 2;
    const target = child.positions[v * 3 + 1] + child.morph[v];
    expect(target).toBeCloseTo(0.5 * (child.positions[(v - 33) * 3 + 1] + child.positions[(v + 33) * 3 + 1]), 4);
  });

  it('builds a full-resolution tile in a worker-friendly time', () => {
    buildTile({ level: 4, ix: 3, iz: 12, grid: 64, leafSize: 128 }); // warm-up
    const t0 = performance.now();
    const n = 4;
    for (let k = 0; k < n; k++) buildTile({ level: 4, ix: k, iz: 13, grid: 64, leafSize: 128 });
    const ms = (performance.now() - t0) / n;
    const t1 = performance.now();
    for (let k = 0; k < n; k++) buildTreeCell({ cx: k, cz: 40, size: 256, spacing: 5.5 });
    const cellMs = (performance.now() - t1) / n;
    console.log(`buildTile(grid 64, mountains): ${ms.toFixed(1)} ms; buildTreeCell: ${cellMs.toFixed(1)} ms`);
    expect(ms).toBeLessThan(200);
    expect(cellMs).toBeLessThan(100);
  });

  it('is flat at the airport and produces sea water to the south', () => {
    const airport = buildTile({ level: 0, ix: -1, iz: -1, grid: 32, leafSize: 128 });
    for (let v = 0; v < 33 * 33; v++) expect(airport.positions[v * 3 + 1]).toBe(AIRPORT.elevation);
    expect(airport.water).toBeNull();
    const sea = buildTile({ level: 6, ix: 0, iz: -6, grid: 32, leafSize: 128 });
    expect(sea.water).not.toBeNull();
    expect(sea.water!.index.length).toBeGreaterThan(0);
  });
});

describe('quadtree selection', () => {
  const select = (east: number, north: number, dz: number, ready: (k: number) => boolean) => {
    const draw: NodeRef[] = [];
    const want: NodeRef[] = [];
    const keep = new Set<number>();
    selectNodes(settings, { east, north, dz }, ready, draw, want, keep);
    return { draw, want, keep };
  };

  it('asks for the roots first when nothing is built', () => {
    const { draw, want } = select(0, 0, 100, () => false);
    expect(draw.length).toBe(0);
    expect(want.every((w) => w.level === settings.rootLevel)).toBe(true);
  });

  it('gives every node a distinct key, small integers near the origin', () => {
    const seen = new Set<number>();
    for (const level of [0, 1, 7, 10, 15]) {
      for (const ix of [-600000, -4097, -4096, -1, 0, 1, 4095, 4096, 600000]) {
        for (const iz of [-4097, -4096, 0, 4095, 4096]) {
          const k = nodeKey(level, ix, iz);
          expect(seen.has(k)).toBe(false);
          seen.add(k);
          if (Math.abs(ix + 0.5) < 4096 && Math.abs(iz + 0.5) < 4096) {
            expect(Number.isInteger(k)).toBe(true);
            expect(k).toBeLessThan(2 ** 30);
            expect(k).toBeGreaterThanOrEqual(0);
          }
        }
      }
    }
  });

  it('selects the same nodes with a recycling pool, reusing its objects', () => {
    const pool = new NodeRefPool();
    const view = { east: 1000, north: -300, dz: 50 };
    const ready = (k: number): boolean => k % 7 !== 0;
    const plain = { draw: [] as NodeRef[], want: [] as NodeRef[], keep: new Set<number>() };
    selectNodes(settings, view, ready, plain.draw, plain.want, plain.keep);
    const pooled = { draw: [] as NodeRef[], want: [] as NodeRef[], keep: new Set<number>() };
    selectNodes(settings, view, ready, pooled.draw, pooled.want, pooled.keep, pool);
    const first = pooled.draw[0];
    pooled.draw.length = 0;
    pooled.want.length = 0;
    pooled.keep.clear();
    selectNodes(settings, view, ready, pooled.draw, pooled.want, pooled.keep, pool);
    expect(pooled.draw.map((r) => ({ ...r }))).toEqual(plain.draw);
    expect(pooled.want.map((r) => ({ ...r }))).toEqual(plain.want);
    expect([...pooled.keep].sort()).toEqual([...plain.keep].sort());
    // The second selection recycled the first one's objects.
    expect(pooled.draw.includes(first) || pooled.want.includes(first)).toBe(true);
  });

  it('covers the ground without overlaps when everything is ready', () => {
    const { draw } = select(1000, -300, 50, () => true);
    const finest = Math.min(...draw.map((d) => d.level));
    expect(finest).toBe(0);
    // Sample points around the camera: exactly one drawn node covers each.
    for (let k = 0; k < 400; k++) {
      const e = 1000 + Math.cos(k) * k * 60;
      const n = -300 + Math.sin(k * 1.3) * k * 60;
      const covering = draw.filter((d) => {
        const s = nodeSize(settings, d.level);
        return e >= d.ix * s && e < (d.ix + 1) * s && n >= d.iz * s && n < (d.iz + 1) * s;
      });
      expect(covering.length).toBe(1);
    }
  });

  it('only neighbours levels that differ by one near the camera', () => {
    const { draw } = select(0, 0, 20, () => true);
    const byKey = new Map(draw.map((d) => [nodeKey(d.level, d.ix, d.iz), d]));
    // For every drawn node, points just outside its edges belong to nodes at most one level apart.
    for (const d of draw) {
      const s = nodeSize(settings, d.level);
      if (d.dist > 20000) continue;
      for (const [de, dn] of [[-1, 0.5], [1, 0.5], [0.5, -1], [0.5, 1]]) {
        const e = (d.ix + (de < 0 ? 0 : de > 0.9 ? 1 : 0.5)) * s + (de < 0 ? -1 : de > 0.9 ? 1 : 0);
        const n = (d.iz + (dn < 0 ? 0 : dn > 0.9 ? 1 : 0.5)) * s + (dn < 0 ? -1 : dn > 0.9 ? 1 : 0);
        for (let l = 0; l <= settings.rootLevel; l++) {
          const sl = nodeSize(settings, l);
          const other = byKey.get(nodeKey(l, Math.floor(e / sl), Math.floor(n / sl)));
          if (other) expect(Math.abs(other.level - d.level)).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('has morph windows inside each level range', () => {
    for (let l = 0; l < 10; l++) {
      const [a, b] = morphWindow(settings, l);
      expect(a).toBeLessThan(b);
      expect(a).toBeGreaterThan(nodeSize(settings, l) * settings.rangeFactor * 0.5);
    }
  });
});

describe('vegetation placement', () => {
  it('is deterministic, sorted by rank and keeps the airfield clear', () => {
    const a = buildTreeCell({ cx: 3, cz: 20, size: 256, spacing: 5.5 });
    const b = buildTreeCell({ cx: 3, cz: 20, size: 256, spacing: 5.5 });
    expect(Array.from(a.instances)).toEqual(Array.from(b.instances));
    for (let i = 1; i < a.count; i++) {
      const r0 = a.instances[(i - 1) * TREE_STRIDE + 5] % 1;
      const r1 = a.instances[i * TREE_STRIDE + 5] % 1;
      expect(r1).toBeGreaterThanOrEqual(r0 - 1e-6);
    }
    const field = buildTreeCell({ cx: -1, cz: -1, size: 256, spacing: 5.5 });
    expect(field.count).toBe(0);
  });

  it('groups each cell\'s trees by sub-square for front-to-back writing', () => {
    const c = buildTreeCell({ cx: -12, cz: -14, size: 256, spacing: 5.5 });
    expect(c.count).toBeGreaterThan(500);
    expect(c.bucketStart[BUCKETS * BUCKETS]).toBe(c.count);
    const seen = new Uint8Array(c.count);
    const sub = 256 / BUCKETS;
    for (let b = 0; b < BUCKETS * BUCKETS; b++) {
      for (let k = c.bucketStart[b]; k < c.bucketStart[b + 1]; k++) {
        const i = c.order[k];
        expect(seen[i]).toBe(0);
        seen[i] = 1;
        const e = c.instances[i * TREE_STRIDE] - c.cx * 256;
        const n = c.instances[i * TREE_STRIDE + 2] - c.cz * 256;
        expect(Math.min(BUCKETS - 1, Math.floor(e / sub))).toBe(b % BUCKETS);
        expect(Math.min(BUCKETS - 1, Math.floor(n / sub))).toBe(Math.floor(b / BUCKETS));
      }
    }
  });

  it('shares the field layout between CPU and shader constants', () => {
    const p = makeParcel();
    parcelAt(1234.5, -6789.25, p);
    expect(p.id).toBeGreaterThanOrEqual(0);
    expect(p.id).toBeLessThanOrEqual(1);
    expect(p.margin).toBeLessThanOrEqual(Math.min(p.hedge, p.track));
  });
});
