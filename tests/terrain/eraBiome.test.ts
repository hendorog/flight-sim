// Deep Time, WP1: land cover and surfaces in the Late Cretaceous (the CPU side of the era's look): no farmland,
// no snow, the Flats are dirt, and the farmland channel carries marsh on the wet floodplain only.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setEra } from '../../src/world/era/eraState';
import { LINE_UP } from '../../src/world/airport/layout';
import { computeBiome, CoverShapeField, makeBiome, makeCoverShape, MARSH_UP_FULL, MARSH_UP_MIN, treeLine } from '../../src/world/terrain/biome';
import { hydrology, makeSample, sampleTerrain, snowLine, terrainSurface } from '../../src/world/terrain/heightfield';
import { buildTile } from '../../src/world/terrain/tileBuilder';

/** A lattice over +-R km, step m (north, east pairs). */
function lattice(R: number, step: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let n = -R; n <= R; n += step) for (let e = -R; e <= R; e += step) out.push([n, e]);
  return out;
}

/** Points either side of the river, `off` m beyond its water edge, along its whole course. */
function besideRiver(off: number): Array<[number, number]> {
  const r = hydrology.river;
  const out: Array<[number, number]> = [];
  for (let k = 2; k < r.north.length - 2; k += 3) {
    const tn = r.north[k + 1] - r.north[k - 1];
    const te = r.east[k + 1] - r.east[k - 1];
    const l = Math.hypot(tn, te) || 1;
    const d = r.halfWidth[k] + off;
    for (const side of [-1, 1]) out.push([r.north[k] - (side * te * d) / l, r.east[k] + (side * tn * d) / l]);
  }
  return out;
}

interface Cover {
  farmland: number;
  marsh: number;
  up: number;
  airportBlend: number;
}

function coverAt(points: Array<[number, number]>): Cover[] {
  const s = makeSample();
  const b = makeBiome();
  const shape = makeCoverShape();
  const field = new CoverShapeField();
  return points.map(([n, e]) => {
    sampleTerrain(n, e, s);
    field.build(n - 40, e - 40, n + 40, e + 40).at(n, e, shape);
    computeBiome(n, e, s, shape.up, b, shape.north);
    return { farmland: b.farmland, marsh: b.marsh, up: shape.up, airportBlend: s.airportBlend };
  });
}

describe('era land cover: the present day keeps its farmland and has no marsh', () => {
  it('farmland on the valley floor, marsh 0 everywhere', () => {
    const c = coverAt([...lattice(12_000, 1500), ...besideRiver(60)]);
    expect(Math.max(...c.map((x) => x.farmland))).toBeGreaterThan(0.5);
    expect(Math.max(...c.map((x) => x.marsh))).toBe(0);
    for (const l of LINE_UP) expect(terrainSurface(l.north, l.east)).toBe('grass');
  });
});

describe('era land cover: the Late Cretaceous', () => {
  beforeAll(() => setEra('cretaceous'));
  afterAll(() => setEra('present'));

  it('has no farmland anywhere', () => {
    const c = coverAt([...lattice(45_000, 2000), ...lattice(4000, 250), ...besideRiver(30), ...besideRiver(200)]);
    expect(Math.max(...c.map((x) => x.farmland))).toBe(0);
  });

  it('has no snow surface anywhere on the lattice (bare rock peaks)', () => {
    const pts = lattice(45_000, 1000);
    let rock = 0;
    for (const [n, e] of pts) {
      const surf = terrainSurface(n, e);
      expect(surf, `${n},${e}`).not.toBe('snow');
      if (surf === 'rock') rock++;
    }
    // The mountains are still there, as rock.
    expect(rock).toBeGreaterThan(20);
    // The snow line clears the highest ground everywhere.
    for (const [n, e] of pts) expect(snowLine(n, e)).toBeGreaterThan(sampleTerrain(n, e, makeSample()).ground + 1000);
  });

  it('raises the tree line by 600 m', () => {
    const t = treeLine(5000, -3000);
    setEra('present');
    const p = treeLine(5000, -3000);
    setEra('cretaceous');
    expect(t - p).toBeCloseTo(600, 9);
  });

  it('is dirt where the runway was: the Flats', () => {
    for (const l of LINE_UP) expect(terrainSurface(l.north, l.east), l.name).toBe('dirt');
    expect(terrainSurface(0, 0)).toBe('dirt');
  });

  it('has marsh along the floodplain river', () => {
    const c = coverAt(besideRiver(60)).filter((x) => x.airportBlend === 1 && x.up > MARSH_UP_FULL);
    expect(c.length).toBeGreaterThan(20);
    const marshy = c.filter((x) => x.marsh > 0).length;
    expect(marshy / c.length).toBeGreaterThan(0.3);
    expect(Math.max(...c.map((x) => x.marsh))).toBeGreaterThan(0.8);
  });

  it('has no marsh on slopes, far from the river or on the Flats', () => {
    // The slope limit is 4 degrees (plan), stated here independently of the constants.
    const up4 = Math.cos((4 * Math.PI) / 180);
    expect(MARSH_UP_MIN).toBeCloseTo(up4, 6);
    expect(MARSH_UP_FULL).toBeGreaterThan(up4);
    const c = coverAt([...lattice(45_000, 1500), ...besideRiver(60), ...besideRiver(1500), ...lattice(1500, 150)]);
    for (const x of c) {
      if (x.up <= up4) expect(x.marsh).toBe(0);
      if (x.airportBlend < 0.15) expect(x.marsh).toBe(0);
    }
    const far = coverAt(besideRiver(1500));
    expect(Math.max(...far.map((x) => x.marsh))).toBe(0);
  });

  it('carries marsh in the tiles’ farmland channel (aBiome.y)', () => {
    const r = hydrology.river;
    let best = 0;
    for (let k = 0; k < r.north.length && best === 0; k += Math.floor(r.north.length / 12)) {
      const t = buildTile({ level: 1, ix: Math.floor(r.east[k] / 256), iz: Math.floor(r.north[k] / 256), grid: 32, leafSize: 128 });
      for (let v = 0; v < t.biome.length / 4; v++) best = Math.max(best, t.biome[v * 4 + 1]);
    }
    expect(best).toBeGreaterThan(100);
  });
});
