// The world seed (src/world/worldSeed.ts): seed 0 is today's world exactly; another seed reshapes the terrain, the
// field pattern and the shaders' hash with it, and setting 0 again restores today's world.
import { afterAll, describe, expect, it } from 'vitest';
import { makeSample, sampleTerrain } from '../../src/world/terrain/heightfield';
import { hash2i } from '../../src/world/terrain/noise';
import { HASH_GLSL, hashGlsl } from '../../src/world/terrain/glsl';
import { makeParcel, parcelAt } from '../../src/world/terrain/fields';
import { regionalRoads, villageSites } from '../../src/world/terrain/roads';
import { setWorldSeed, worldSeed } from '../../src/world/worldSeed';

const POINTS: [number, number][] = [[0, 0], [5000, -3000], [-8000, 12000], [20000, 4000], [-15000, -9000]];
const sampleAll = (): number[] => {
  const s = makeSample();
  return POINTS.flatMap(([n, e]) => {
    sampleTerrain(n, e, s);
    return [s.ground, s.standing, s.riverDist];
  });
};

describe('world seed', () => {
  afterAll(() => setWorldSeed(0));
  const today = sampleAll();
  const todayHash = hash2i(123, -456);
  const todayParcel = parcelAt(3100, -2700, makeParcel()).id;

  it('is 0 by default, with the shaders\' hash text unchanged', () => {
    expect(worldSeed()).toBe(0);
    expect(hashGlsl()).toBe(HASH_GLSL);
    expect(regionalRoads().length).toBeGreaterThan(0);
    expect(villageSites().length).toBeGreaterThan(0);
  });

  it('reshapes the world for another seed, and switches the baked roads off', () => {
    setWorldSeed(7);
    const other = sampleAll();
    expect(other).not.toEqual(today);
    expect(hash2i(123, -456)).not.toBe(todayHash);
    expect(parcelAt(3100, -2700, makeParcel()).id).not.toBe(todayParcel);
    expect(hashGlsl()).not.toBe(HASH_GLSL);
    expect(regionalRoads().length).toBe(0);
    expect(villageSites().length).toBe(0);
    // Deterministic: the same seed gives the same world.
    setWorldSeed(0);
    setWorldSeed(7);
    expect(sampleAll()).toEqual(other);
  });

  it('restores today\'s world at seed 0', () => {
    setWorldSeed(7);
    setWorldSeed(0);
    expect(sampleAll()).toEqual(today);
    expect(hash2i(123, -456)).toBe(todayHash);
  });
});
