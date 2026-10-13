// PRESENT GUARD (Deep Time, WP0): the present-day world must stay byte-identical while eras are added.
//
// tests/fixtures/eraPresent.json holds SHA-256 hashes, captured from untouched main before any era code
// existed, of:
//   - sampleTerrain (every field) on a 96 x 96 lattice over +-45 km plus 200 seeded random points (half of them
//     within 5 km of the field), terrainSurface and computeBiome (land-cover shape as the tile builder measures
//     it) on the same points, and the continuous snowLine / treeLine values there (categorical surfaces alone
//     miss a small threshold shift);
//   - the hydrology singleton (lakes and the densified river);
//   - buildTile for 6 TileRequests at different LODs (airport flat, river, lake, higher levels, the root);
//   - buildTreeCell for 8 vegetation cells at the high preset's spacing;
//   - the onBeforeCompile-patched vertex and fragment text, defines, uniform names and customProgramCacheKey
//     of the terrain, terrain-depth, water and river materials (run against three's real ShaderLib sources).
// Land cover is computed with the valley town site set exactly as TerrainSystem.init sets it in present
// (findTownSite(terrainHeight)); the site is part of the fixture.
//
// Regenerating the fixture is NOT a fix for a failure here: a mismatch means the present world changed.
// The fixture is (re)written only by scripts/captureEraFixture.mjs (CAPTURE_ERA_FIXTURE=1), and only from a
// commit whose present world is the reference.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { findTownSite } from '../../src/world/airport/valley';
import { computeBiome, coverShape, makeBiome, makeCoverShape, treeLine } from '../../src/world/terrain/biome';
import { hydrology, makeSample, sampleTerrain, snowLine, terrainHeight, terrainSurface } from '../../src/world/terrain/heightfield';
import { createTerrainDepthMaterial, createTerrainMaterial, type TerrainUniforms } from '../../src/world/terrain/terrainMaterial';
import type { TerrainTextures } from '../../src/world/terrain/textures';
import { buildTile, type TileRequest } from '../../src/world/terrain/tileBuilder';
import { setTownSite, townSite } from '../../src/world/terrain/townMask';
import { buildTreeCell, type TreeCellRequest } from '../../src/world/terrain/vegetation/placement';
import { createWaterMaterial, type WaterUniforms } from '../../src/world/terrain/water';

// node:fs and node:crypto at run time (the project type-checks tests without node's types, as tests/golden does).
interface Fs {
  existsSync(path: URL): boolean;
  readFileSync(path: URL, encoding: 'utf8'): string;
  writeFileSync(path: URL, data: string): void;
}
interface Hash {
  update(data: string | Uint8Array): Hash;
  digest(encoding: 'hex'): string;
}
const fs = (await import(/* @vite-ignore */ 'node:fs' as string)) as Fs;
const { createHash } = (await import(/* @vite-ignore */ 'node:crypto' as string)) as { createHash(alg: 'sha256'): Hash };
const FIXTURE = new URL('../fixtures/eraPresent.json', import.meta.url);
const CAPTURE = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env.CAPTURE_ERA_FIXTURE === '1';

// ------------------------------------------------------------------------------------------ hashing

const sha = (...parts: Array<string | ArrayBufferView>): string => {
  const h = createHash('sha256');
  for (const p of parts) h.update(typeof p === 'string' ? p : new Uint8Array(p.buffer, p.byteOffset, p.byteLength));
  return h.digest('hex');
};

/** mulberry32: a tiny deterministic PRNG (never Math.random here). */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The probe points, NED (north, east) pairs: the lattice, then the random points. */
function probePoints(): Float64Array {
  const N = 96;
  const R = 45_000;
  const random = 200;
  const pts = new Float64Array((N * N + random) * 2);
  let k = 0;
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      pts[k++] = -R + (2 * R * j) / (N - 1);
      pts[k++] = -R + (2 * R * i) / (N - 1);
    }
  const rnd = prng(0x0e7a);
  for (let p = 0; p < random; p++) {
    const r = p < random / 2 ? 5000 : R;
    pts[k++] = (rnd() * 2 - 1) * r;
    pts[k++] = (rnd() * 2 - 1) * r;
  }
  return pts;
}

function terrainHashes(): Record<string, string> {
  const pts = probePoints();
  const n = pts.length / 2;
  const s = makeSample();
  const shape = makeCoverShape();
  const b = makeBiome();
  const samples = new Float64Array(n * 9);
  const biomes = new Float64Array(n * 4);
  const lines = new Float64Array(n * 2);
  const surfaces: string[] = [];
  for (let p = 0; p < n; p++) {
    const north = pts[p * 2];
    const east = pts[p * 2 + 1];
    sampleTerrain(north, east, s);
    samples.set([s.ground, s.standing, s.river, s.airportBlend, s.riverDist, s.riverSigned, s.riverHalfWidth, s.riverArc, s.approach], p * 9);
    coverShape(north, east, s.ground, shape);
    computeBiome(north, east, s, shape.up, b, shape.north);
    biomes.set([b.forest, b.farmland, b.moisture, b.sand], p * 4);
    surfaces.push(terrainSurface(north, east));
    lines[p * 2] = snowLine(north, east);
    lines[p * 2 + 1] = treeLine(north, east);
  }
  const r = hydrology.river;
  const lakes = JSON.stringify(hydrology.lakes.map((l) => Object.fromEntries(Object.entries(l).sort(([a], [c]) => a.localeCompare(c)))));
  return {
    points: sha(pts),
    sampleTerrain: sha(samples),
    computeBiome: sha(biomes),
    terrainSurface: sha(surfaces.join(',')),
    snowAndTreeLine: sha(lines),
    hydrology: sha(lakes, r.north, r.east, r.level, r.halfWidth, r.s),
  };
}

/** Production shapes: leafSize 128 (TerrainSystem LEAF_SIZE), grid 64 (high/ultra) or 32 (low/medium). */
function tileRequests(): Array<[string, TileRequest]> {
  const k = Math.floor(hydrology.river.north.length / 2);
  const rn = hydrology.river.north[k];
  const re = hydrology.river.east[k];
  const lake = hydrology.lakes[0];
  return [
    ['airport-l0-g64', { level: 0, ix: 0, iz: 0, grid: 64, leafSize: 128 }],
    ['river-l0-g64', { level: 0, ix: Math.floor(re / 128), iz: Math.floor(rn / 128), grid: 64, leafSize: 128 }],
    ['lake-l2-g64', { level: 2, ix: Math.floor(lake.east / 512), iz: Math.floor(lake.north / 512), grid: 64, leafSize: 128 }],
    ['l3-g32', { level: 3, ix: 2, iz: 7, grid: 32, leafSize: 128 }],
    ['l6-g32', { level: 6, ix: -2, iz: 1, grid: 32, leafSize: 128 }],
    ['root-l10-g32', { level: 10, ix: -1, iz: -1, grid: 32, leafSize: 128 }],
  ];
}

function tileHashes(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, req] of tileRequests()) {
    const t = buildTile(req);
    const w = t.water;
    const parts: Array<string | ArrayBufferView> = [
      `${t.level},${t.ix},${t.iz},${t.minHeight},${t.maxHeight}`,
      t.positions,
      t.normals,
      t.morph,
      t.biome,
      t.shape,
      t.river,
    ];
    if (w) parts.push('water', w.positions, w.depth, w.index);
    out[name] = sha(...parts);
  }
  return out;
}

/** VegetationSystem CELL = 256 m, high-preset spacing 5.5 m. */
function treeCellRequests(): Array<[string, TreeCellRequest]> {
  const town = townSite();
  const k = Math.floor(hydrology.river.north.length / 3);
  const cell = (n: number, e: number): { cx: number; cz: number } => ({ cx: Math.floor(e / 256), cz: Math.floor(n / 256) });
  const req = (c: { cx: number; cz: number }): TreeCellRequest => ({ ...c, size: 256, spacing: 5.5 });
  return [
    ['airport', req(cell(0, 0))],
    ['airport-sw', req({ cx: -3, cz: -2 })],
    ['ne', req({ cx: 5, cz: 4 })],
    ['river', req(cell(hydrology.river.north[k], hydrology.river.east[k]))],
    ['town', req(town ? cell(town.north, town.east) : { cx: 9, cz: -9 })],
    ['far-e', req({ cx: 20, cz: -10 })],
    ['far-w', req({ cx: -30, cz: 15 })],
    ['nw', req({ cx: -8, cz: 12 })],
  ];
}

function treeHashes(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, req] of treeCellRequests()) {
    const c = buildTreeCell(req);
    out[name] = sha(`${c.cx},${c.cz},${c.count}`, c.instances, c.order, c.bucketStart);
  }
  return out;
}

// ------------------------------------------------------------------------------------------ shaders

interface FakeShader {
  uniforms: Record<string, { value: unknown }>;
  vertexShader: string;
  fragmentShader: string;
}

function patched(mat: THREE.Material, lib: 'standard' | 'depth'): string {
  const src = THREE.ShaderLib[lib];
  const shader: FakeShader = { uniforms: {}, vertexShader: src.vertexShader, fragmentShader: src.fragmentShader };
  (mat.onBeforeCompile as unknown as (s: FakeShader, r: unknown) => void)(shader, null);
  // The patch must have found its anchors in three's real sources (a missed anchor is a silent no-op).
  if (shader.vertexShader.includes('#include <begin_vertex>')) throw new Error(`${mat.name || lib}: begin_vertex not patched`);
  if (lib === 'standard' && shader.fragmentShader.includes('#include <map_fragment>')) throw new Error(`${mat.name}: map_fragment not patched`);
  const defines = JSON.stringify(Object.entries((mat as THREE.Material & { defines?: Record<string, unknown> }).defines ?? {}).sort(([a], [b]) => a.localeCompare(b)));
  const uniforms = Object.keys(shader.uniforms).sort().join(',');
  return JSON.stringify({
    vertex: sha(shader.vertexShader),
    fragment: sha(shader.fragmentShader),
    defines,
    uniforms,
    cacheKey: mat.customProgramCacheKey(),
  });
}

function shaderHashes(): Record<string, string> {
  const textures = {
    noise: new THREE.Texture(),
    albedo: new THREE.DataArrayTexture(),
    normal: new THREE.DataArrayTexture(),
    layerMeans: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()],
    ready: Promise.resolve(),
    dispose: () => {},
  } as unknown as TerrainTextures;
  const terrainUniforms = {
    uMorph: { value: [] },
    uSkirt: { value: [] },
    uLodCenter: { value: new THREE.Vector3() },
    uForestFade: { value: new THREE.Vector2() },
    uCanopyKeep: { value: new THREE.Vector4() },
    uViewPos: { value: new THREE.Vector3() },
  } as unknown as TerrainUniforms;
  const waterUniforms = (): WaterUniforms => ({ uTime: { value: 0 }, uSkyColor: { value: new THREE.Color() }, uHazeColor: { value: new THREE.Color() } });
  return {
    terrain: patched(createTerrainMaterial(textures, terrainUniforms), 'standard'),
    terrainDepth: patched(createTerrainDepthMaterial(terrainUniforms), 'depth'),
    water: patched(createWaterMaterial(textures.noise, waterUniforms(), false), 'standard'),
    river: patched(createWaterMaterial(textures.noise, waterUniforms(), true), 'standard'),
  };
}

// ------------------------------------------------------------------------------------------ fixture

export interface EraPresentFixture {
  townSite: { north: number; east: number; radius: number } | null;
  terrain: Record<string, string>;
  tiles: Record<string, string>;
  trees: Record<string, string>;
  shaders: Record<string, string>;
}

/** Everything the guard pins, computed now. Sets the present town site (as TerrainSystem.init does). */
function computeFixture(): EraPresentFixture {
  setTownSite(findTownSite(terrainHeight));
  const site = townSite();
  return {
    townSite: site ? { north: site.north, east: site.east, radius: site.radius } : null,
    terrain: terrainHashes(),
    tiles: tileHashes(),
    trees: treeHashes(),
    shaders: shaderHashes(),
  };
}

const sortKeys = (v: unknown): unknown =>
  v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, sortKeys(x)]))
    : v;

describe('present guard: the present-day world is byte-identical to the pinned fixture', () => {
  it('matches tests/fixtures/eraPresent.json', { timeout: 120_000 }, () => {
    const now = computeFixture();
    if (CAPTURE) {
      fs.writeFileSync(FIXTURE, `${JSON.stringify(sortKeys(now), null, 2)}\n`);
      return;
    }
    expect(fs.existsSync(FIXTURE), 'fixture missing: run node scripts/captureEraFixture.mjs on the reference commit').toBe(true);
    const pinned = JSON.parse(fs.readFileSync(FIXTURE, 'utf8')) as EraPresentFixture;
    expect(now.townSite).toEqual(pinned.townSite);
    expect(now.terrain).toEqual(pinned.terrain);
    expect(now.tiles).toEqual(pinned.tiles);
    expect(now.trees).toEqual(pinned.trees);
    expect(now.shaders).toEqual(pinned.shaders);
  });
});
