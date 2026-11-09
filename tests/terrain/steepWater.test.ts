// Steep water's stones and rock (channelStones.ts, vegetation/boulders.ts, bedrock.ts rockAtPoint, placement.ts): the
// lattice is deterministic and sized from the bed's grain; the rocks in the bed stand on it at the lattice's places,
// show its radius at the waterline and stand out of the water; no tree is planted on the bare rock; seed 0 has none.

import { afterAll, describe, expect, it, vi } from 'vitest';
import { hydrology, makeSample, sampleTerrain } from '../../src/world/terrain/heightfield';
import { rockAtPoint, rockReach } from '../../src/world/terrain/bedrock';
import { grainToUnit, stoneAt, stonePresence, unitToGrain, STONE_R_MAX, type ChannelStone } from '../../src/world/terrain/channelStones';
import { BOULDER_STRIDE, buildBoulderCell } from '../../src/world/terrain/vegetation/boulders';
import { buildTreeCell, TREE_STRIDE } from '../../src/world/terrain/vegetation/placement';
import type { FlowHit } from '../../src/world/terrain/hydrology';
import { setWorldSeed } from '../../src/world/worldSeed';
// (Under a full parallel suite run its slowest test here takes up to about 23 s, over the 5 s default: round T repairs.)
vi.setConfig({ testTimeout: 60_000 });

afterAll(() => {
  setWorldSeed(0);
});

const CELL = 256;
/** Candidate spacing of the tree cells (VegetationSystem's). */
const TREE_SPACING = 7;
const stone: ChannelStone = { s: 0, x: 0, r: 0, submerged: false, stand: 0, u7: 0, u8: 0 };

describe('the stone lattice', () => {
  it('holds no stones below rapids, more on steeper reaches, bigger with a coarser bed, the same every time', () => {
    setWorldSeed(42);
    expect(stonePresence(0.45)).toBe(0);
    expect(stonePresence(0.9)).toBeGreaterThan(stonePresence(0.65));
    const count = (steep: number, grain: number): { n: number; r: number } => {
      let n = 0;
      let r = 0;
      for (let k = 0; k < 400; k++)
        for (let j = -2; j <= 2; j++)
          if (stoneAt(k, j, steep, grain, 10, stone)) {
            n++;
            r += stone.r;
            expect(stone.r).toBeLessThanOrEqual(STONE_R_MAX);
          }
      return { n, r: r / Math.max(1, n) };
    };
    const a = count(0.6, 1);
    const b = count(0.9, 1);
    const c = count(0.9, 3);
    expect(count(0.4, 1).n).toBe(0);
    expect(b.n).toBeGreaterThan(a.n);
    expect(c.r).toBeGreaterThan(2 * b.r);
    expect(count(0.9, 3)).toEqual(c);
    // The grain byte round-trips within a few per cent over the stones' sizes.
    for (const g of [0.3, 1, 2.5, 4.5]) expect(Math.abs(unitToGrain(Math.round(255 * grainToUnit(g)) / 255) - g)).toBeLessThan(0.03 * g + 0.01);
  });
});

describe('seed 42 steep channels', () => {
  /** Cells along the steepest reaches of the network. */
  function steepCells(): Array<[number, number]> {
    const cells = new Map<string, [number, number]>();
    for (const r of hydrology.rivers ?? []) {
      if (!r.steepness || cells.size > 16) continue;
      for (let i = 0; i < r.north.length; i += 6) {
        if (r.steepness[i] < 0.85) continue;
        const c: [number, number] = [Math.floor(r.east[i] / CELL), Math.floor(r.north[i] / CELL)];
        cells.set(c.join(','), c);
        if (cells.size > 16) break;
      }
    }
    return [...cells.values()];
  }

  it('stands the bed rocks on the ground, out of the water, at most a block of the lattice size', () => {
    setWorldSeed(42);
    const s = makeSample();
    const hit = {} as FlowHit;
    let inWater = 0;
    for (const [cx, cz] of steepCells()) {
      const c = buildBoulderCell({ cx, cz, size: CELL });
      const b = c.boulders;
      for (let i = 0; i < c.count; i++) {
        const o = i * BOULDER_STRIDE;
        const [east, ground, north, r, hy, , , , dy, shown] = Array.from(b.subarray(o, o + BOULDER_STRIDE));
        sampleTerrain(north, east, s);
        expect(Math.abs(s.ground - ground)).toBeLessThan(0.01);
        expect(shown).toBeGreaterThan(0.05);
        expect(r).toBeLessThan(8);
        // Its foot at or under the ground (never floating), its top over it.
        expect(ground + dy - hy).toBeLessThanOrEqual(ground + 1e-3);
        expect(ground + dy + hy).toBeGreaterThan(ground);
        hydrology.queryFlow!(north, east, hit);
        if (hit.line >= 0 && hit.dist < hit.halfWidth * 0.8 && hit.level > ground + 0.3) {
          inWater++;
          // A rock in the water shows its top over the surface.
          expect(ground + dy + hy).toBeGreaterThan(hit.level - 0.25);
        }
      }
    }
    expect(inWater).toBeGreaterThan(50);
  });

  it('plants no tree on the bare rock', () => {
    setWorldSeed(42);
    const hit = {} as FlowHit;
    let checked = 0;
    for (const [cx, cz] of steepCells().slice(0, 8)) {
      const t = buildTreeCell({ cx, cz, size: CELL, spacing: TREE_SPACING });
      for (let i = 0; i < t.count; i++) {
        const east = t.instances[i * TREE_STRIDE];
        const north = t.instances[i * TREE_STRIDE + 2];
        hydrology.queryFlow!(north, east, hit);
        if (hit.line < 0 || hit.dist > hit.halfWidth + rockReach(hit.halfWidth) * 1.5) continue;
        checked++;
        expect(rockAtPoint(hit.steepness, hit.halfWidth, hit.dist - hit.halfWidth, east, north)).toBeLessThan(0.05);
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe('seed 0', () => {
  it('has no stones in any channel', () => {
    setWorldSeed(0);
    const k = Math.floor(hydrology.river.north.length / 3);
    const c = buildBoulderCell({ cx: Math.floor(hydrology.river.east[k] / CELL), cz: Math.floor(hydrology.river.north[k] / CELL), size: CELL });
    expect(c.count).toBe(0);
  });
});
