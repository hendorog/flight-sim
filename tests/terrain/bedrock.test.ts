// Bare rock and boulder fields along fast water (bedrock.ts, vegetation/boulders.ts, the tiles' flow attribute):
// nothing of it at seed 0; in a seeded world the rock follows the channels' steepness (placid and riffle reaches keep
// their gravel and silt), the stones lie by steep channels and falls only, out of the lakes, and the same cell gives
// the same stones however and whenever it is built.

import { afterAll, describe, expect, it, vi } from 'vitest';
import { hydrology, makeSample, sampleTerrain } from '../../src/world/terrain/heightfield';
import { bedRock, rockAt, rockReach, ROCK_STEEP_LO } from '../../src/world/terrain/bedrock';
import { BOULDER_STEEP, BOULDER_STRIDE, buildBoulderCell } from '../../src/world/terrain/vegetation/boulders';
import { buildTile } from '../../src/world/terrain/tileBuilder';
import { steepnessOf } from '../../src/world/terrain/streams';
import type { FlowHit } from '../../src/world/terrain/hydrology';
import { setWorldSeed } from '../../src/world/worldSeed';
// (Under a full parallel suite run its slowest test here takes up to about 22 s, over the 5 s default: round T repairs.)
vi.setConfig({ testTimeout: 60_000 });

afterAll(() => {
  setWorldSeed(0);
});

const CELL = 256;

describe('bare rock', () => {
  it('is none on placid and riffle reaches, full on step-pool cascades, and reaches further by a bigger channel', () => {
    expect(bedRock(steepnessOf(0.004))).toBe(0);
    expect(bedRock(steepnessOf(0.019))).toBe(0);
    expect(bedRock(ROCK_STEEP_LO)).toBe(0);
    expect(bedRock(steepnessOf(0.05))).toBeGreaterThan(0.3);
    expect(bedRock(steepnessOf(0.15))).toBe(1);
    let last = -1;
    for (let g = 0; g < 0.3; g += 0.005) {
      const r = bedRock(steepnessOf(g));
      expect(r).toBeGreaterThanOrEqual(last);
      last = r;
    }
    expect(rockReach(10)).toBeGreaterThan(rockReach(1));
    expect(rockAt(1, 2, -1)).toBe(1);
    expect(rockAt(1, 2, rockReach(2) + 0.1)).toBe(0);
  });
});

describe('seed 0', () => {
  it('has no flow data, no flow attribute and no boulders', () => {
    setWorldSeed(0);
    expect(hydrology.queryFlow).toBeUndefined();
    const t = buildTile({ level: 0, ix: 3, iz: 2, grid: 32, leafSize: 128 });
    expect(t.flow).toBeNull();
    const k = Math.floor(hydrology.river.north.length / 2);
    const c = buildBoulderCell({ cx: Math.floor(hydrology.river.east[k] / CELL), cz: Math.floor(hydrology.river.north[k] / CELL), size: CELL });
    expect(c.count).toBe(0);
  });
});

describe('seed 42', () => {
  /** Cells along the steepest stretch of the steepest streams. */
  function steepCells(): Array<[number, number]> {
    const cells = new Map<string, [number, number]>();
    for (const r of hydrology.rivers ?? []) {
      if (!r.steepness || cells.size > 24) continue;
      for (let i = 0; i < r.north.length; i += 4) {
        if (r.steepness[i] < 0.85) continue;
        const c: [number, number] = [Math.floor(r.east[i] / CELL), Math.floor(r.north[i] / CELL)];
        cells.set(c.join(','), c);
        if (cells.size > 24) break;
      }
    }
    return [...cells.values()];
  }

  it('lays stones by steep channels and falls, never in a lake, the same however the cells are built', () => {
    setWorldSeed(42);
    const cells = steepCells();
    expect(cells.length).toBeGreaterThan(10);
    const first = cells.map(([cx, cz]) => buildBoulderCell({ cx, cz, size: CELL }));
    const again = [...cells].reverse().map(([cx, cz]) => buildBoulderCell({ cx, cz, size: CELL })).reverse();
    let stones = 0;
    const s = makeSample();
    const hit = {} as FlowHit;
    const fallsNear: number[] = [];
    for (let k = 0; k < cells.length; k++) {
      expect(Array.from(again[k].boulders)).toEqual(Array.from(first[k].boulders));
      const b = first[k].boulders;
      stones += first[k].count;
      for (let i = 0; i < first[k].count; i++) {
        const o = i * BOULDER_STRIDE;
        const [east, base, north, radius] = [b[o], b[o + 1], b[o + 2], b[o + 3]];
        expect(radius).toBeGreaterThan(0.05);
        expect(radius).toBeLessThan(8);
        sampleTerrain(north, east, s);
        expect(Math.abs(s.ground - base)).toBeLessThan(0.01);
        expect(s.standing).toBeLessThanOrEqual(s.ground - 1);
        // By a steep channel (within its bare banks, plus slack for the nearest line being another) or a fall.
        hydrology.queryFlow!(north, east, hit);
        const byChannel = hit.line >= 0 && hit.dist < hit.halfWidth + rockReach(hit.halfWidth) + 30;
        const byFall = hydrology.fallsNear!(north, east, 60, fallsNear) > 0;
        expect(byChannel || byFall).toBe(true);
      }
    }
    expect(stones).toBeGreaterThan(200);
  });

  it('gives a tile the steepness of the channels in it, and none far from them', () => {
    setWorldSeed(42);
    // The tile holding the first steep reach's sample (the tile at its boulder cell's corner may miss the channel).
    const r = (hydrology.rivers ?? []).find((x) => x.steepness?.some((v) => v >= 0.85))!;
    const i = r.steepness!.findIndex((v) => v >= 0.85);
    const t = buildTile({ level: 0, ix: Math.floor(r.east[i] / 128), iz: Math.floor(r.north[i] / 128), grid: 32, leafSize: 128 });
    expect(t.flow).not.toBeNull();
    let steep = 0;
    for (const v of t.flow!) if (v / 255 >= BOULDER_STEEP) steep++;
    expect(steep).toBeGreaterThan(0);
    // A tile far from any channel: all zero.
    const far = buildTile({ level: 0, ix: 1000, iz: 1000, grid: 32, leafSize: 128 });
    expect(far.flow?.every((v) => v === 0) ?? true).toBe(true);
  });
});
