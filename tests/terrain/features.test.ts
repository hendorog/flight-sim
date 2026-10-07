// Land-cover features: the valley town's clear zone, the river channel (signed distance, bankside strip and
// trees, never trees in the water), and the tree line's aspect dependence.
import { afterAll, describe, expect, it } from 'vitest';
import { findTownSite } from '../../src/world/airport/valley';
import { computeBiome, makeBiome, RIVER_STRIP, treeLine, TREE_LINE_ASPECT } from '../../src/world/terrain/biome';
import { hydrology, makeSample, sampleTerrain, terrainHeight } from '../../src/world/terrain/heightfield';
import { RIPARIAN_FAR, RIPARIAN_NEAR, riparianPresence } from '../../src/world/terrain/riparian';
import { RIVER_FAR, RIVER_UNITS, buildTile, tileVertexCount } from '../../src/world/terrain/tileBuilder';
import { setTownSite, TOWN_CORE, TOWN_WOOD_MARGIN, townSite } from '../../src/world/terrain/townMask';
import { buildTreeCell, TREE_STRIDE } from '../../src/world/terrain/vegetation/placement';

const CELL = 256;
const SPACING = 7;

/** Trees of every cell overlapping a disc. */
function treesAround(north: number, east: number, radius: number): { north: number; east: number; h: number }[] {
  const out: { north: number; east: number; h: number }[] = [];
  for (let cz = Math.floor((north - radius) / CELL); cz <= Math.floor((north + radius) / CELL); cz++)
    for (let cx = Math.floor((east - radius) / CELL); cx <= Math.floor((east + radius) / CELL); cx++) {
      const c = buildTreeCell({ cx, cz, size: CELL, spacing: SPACING });
      for (let k = 0; k < c.count; k++) out.push({ east: c.instances[k * TREE_STRIDE], north: c.instances[k * TREE_STRIDE + 2], h: c.instances[k * TREE_STRIDE + 3] });
    }
  return out;
}

describe('valley town', () => {
  const site = findTownSite(terrainHeight);
  afterAll(() => setTownSite(null));

  it('exists on this terrain', () => {
    expect(site).not.toBeNull();
  });

  it('has no woodland, canopy or trees within its radius plus the clear margin, and no fields in its core', () => {
    setTownSite(site);
    const t = townSite()!;
    const s = makeSample();
    const b = makeBiome();
    let forestInside = 0;
    let farmCore = 0;
    for (let r = 0; r <= t.radius + TOWN_WOOD_MARGIN; r += 60)
      for (let a = 0; a < 16; a++) {
        const n = t.north + r * Math.cos((a / 16) * 2 * Math.PI);
        const e = t.east + r * Math.sin((a / 16) * 2 * Math.PI);
        sampleTerrain(n, e, s);
        computeBiome(n, e, s, 1, b);
        forestInside = Math.max(forestInside, b.forest);
        if (r < t.radius * TOWN_CORE) farmCore = Math.max(farmCore, b.farmland);
      }
    expect(forestInside).toBe(0);
    expect(farmCore).toBe(0);
    const trees = treesAround(t.north, t.east, t.radius + TOWN_WOOD_MARGIN);
    const inside = trees.filter((p) => Math.hypot(p.north - t.north, p.east - t.east) < t.radius + TOWN_WOOD_MARGIN);
    expect(inside.length).toBe(0);
  });

  it('leaves land cover untouched when there is no town', () => {
    setTownSite(null);
    const t = site!;
    const s = makeSample();
    const b = makeBiome();
    let farm = 0;
    for (let a = 0; a < 16; a++) {
      const n = t.north + 100 * Math.cos(a);
      const e = t.east + 100 * Math.sin(a);
      sampleTerrain(n, e, s);
      computeBiome(n, e, s, 1, b);
      farm = Math.max(farm, b.farmland);
    }
    expect(farm).toBeGreaterThan(0.5);
  });
});

describe('river', () => {
  const r = hydrology.river;
  // A lowland stretch well away from the source and the coast.
  const idx = Math.floor(r.north.length * 0.55);

  it('gives a signed distance that changes sign across the channel and matches the unsigned one', () => {
    const tn = r.north[idx + 1] - r.north[idx - 1];
    const te = r.east[idx + 1] - r.east[idx - 1];
    const l = Math.hypot(tn, te);
    // Perpendicular to the flow, (north, east).
    const pn = -te / l;
    const pe = tn / l;
    const s = makeSample();
    for (let d = -60; d <= 60; d += 10) {
      sampleTerrain(r.north[idx] + pn * d, r.east[idx] + pe * d, s);
      expect(Math.abs(s.riverSigned)).toBeCloseTo(s.riverDist, 6);
      expect(s.riverHalfWidth).toBeGreaterThan(10);
    }
    // Monotonic across the channel (linear, so tiles can interpolate it).
    const vals: number[] = [];
    for (let d = -40; d <= 40; d += 10) {
      sampleTerrain(r.north[idx] + pn * d, r.east[idx] + pe * d, s);
      vals.push(s.riverSigned);
    }
    const inc = vals.every((v, k) => k === 0 || v > vals[k - 1]);
    const dec = vals.every((v, k) => k === 0 || v < vals[k - 1]);
    expect(inc || dec).toBe(true);
    for (let k = 1; k < vals.length; k++) expect(Math.abs(Math.abs(vals[k] - vals[k - 1]) - 10)).toBeLessThan(0.5);
  });

  it('puts the channel into tile attributes even on coarse tiles', () => {
    // A level-5 tile (4 km, 64 m lattice) containing the chosen river point.
    const level = 5;
    const size = 128 * 2 ** level;
    const t = buildTile({ level, ix: Math.floor(r.east[idx] / size), iz: Math.floor(r.north[idx] / size), grid: 64, leafSize: 128 });
    const n = 65;
    expect(t.river.length).toBe(tileVertexCount(64) * 2);
    let pos = 0;
    let neg = 0;
    let far = 0;
    for (let v = 0; v < n * n; v++) {
      const sd = t.river[v * 2] / RIVER_UNITS;
      if (sd > 0) pos++;
      else if (sd < 0) neg++;
      if (Math.abs(sd) >= RIVER_FAR - 0.5) far++;
      expect(t.river[v * 2 + 1] / RIVER_UNITS).toBeLessThan(60);
    }
    // The river crosses the tile: both banks present.
    expect(pos).toBeGreaterThan(0);
    expect(neg).toBeGreaterThan(0);
    expect(far).toBeLessThan(n * n);
  });

  it('keeps fields back from the bank', () => {
    const s = makeSample();
    const b = makeBiome();
    let farm = 0;
    for (let i = Math.floor(r.north.length * 0.3); i < r.north.length * 0.8; i += 13) {
      const tn = r.north[i + 1] - r.north[i - 1];
      const te = r.east[i + 1] - r.east[i - 1];
      const l = Math.hypot(tn, te);
      for (const side of [-1, 1]) {
        const d = r.halfWidth[i] + RIVER_STRIP * 0.8;
        const n = r.north[i] - (te / l) * d * side;
        const e = r.east[i] + (tn / l) * d * side;
        sampleTerrain(n, e, s);
        computeBiome(n, e, s, 1, b);
        farm = Math.max(farm, b.farmland);
      }
    }
    expect(farm).toBeLessThan(0.05);
  });

  it('has no trees in the channel and bankside trees where the gallery says', () => {
    const s = makeSample();
    let inChannel = 0;
    let bankside = 0;
    let bankPresence = 0;
    for (let i = Math.floor(r.north.length * 0.35); i < r.north.length * 0.7; i += 40) {
      for (const p of treesAround(r.north[i], r.east[i], 150)) {
        sampleTerrain(p.north, p.east, s);
        if (s.riverHalfWidth <= 0) continue;
        const edge = s.riverDist - s.riverHalfWidth;
        if (edge < 2) inChannel++;
        if (edge > RIPARIAN_NEAR && edge < RIPARIAN_FAR) {
          bankside++;
          bankPresence += riparianPresence(s.riverArc, Math.sign(s.riverSigned));
        }
      }
    }
    expect(inChannel).toBe(0);
    expect(bankside).toBeGreaterThan(20);
    // Bankside trees stand mostly where the (shared, reflected) gallery presence is high.
    expect(bankPresence / bankside).toBeGreaterThan(0.5);
  });
});

describe('tree line', () => {
  it('is higher on south faces than on north faces', () => {
    const s = makeSample();
    const b = makeBiome();
    // Probe a mountain point at the level-ground tree line + 100 m: forested facing south, not facing north.
    const n = 30000;
    const e = 14000;
    sampleTerrain(n, e, s);
    const tl = treeLine(n, e);
    s.ground = tl + 100;
    s.standing = 0;
    s.river = -Infinity;
    s.airportBlend = 1;
    s.approach = 0;
    const south = computeBiome(n, e, s, 0.85, makeBiome(), -0.5).forest;
    const north = computeBiome(n, e, s, 0.85, b, 0.5).forest;
    expect(TREE_LINE_ASPECT).toBeGreaterThan(100);
    expect(south).toBeGreaterThan(north);
    expect(north).toBeLessThan(0.05);
  });

  it('stores the LOD-independent land-cover slope in the tile shape attribute', () => {
    const t = buildTile({ level: 2, ix: Math.floor(14000 / 512), iz: Math.floor(30000 / 512), grid: 32, leafSize: 128 });
    let minUp = 1;
    for (let v = 0; v < 33 * 33; v++) minUp = Math.min(minUp, t.shape[v * 4 + 3] / 255);
    expect(minUp).toBeGreaterThan(0.2);
    expect(minUp).toBeLessThan(0.99);
  });
});
