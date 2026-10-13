// Deep Time, WP1: the era's look in the terrain and water shaders. The present text is pinned byte for byte by
// tests/era/presentGuard.test.ts; here the Cretaceous build: the palette substituted, the capability defines,
// the era cache keys, and the CPU/GLSL twins (the tree and snow line thresholds the shader emits are the CPU's).

import * as THREE from 'three';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { setEra } from '../../src/world/era/eraState';
import { treeLine, treeLineBase } from '../../src/world/terrain/biome';
import { ERA_GROUND, PALETTES } from '../../src/world/terrain/eraPalette';
import { snowLine, snowLineBase } from '../../src/world/terrain/heightfield';
import { createTerrainDepthMaterial, createTerrainMaterial, setTerrainDetail, type TerrainUniforms } from '../../src/world/terrain/terrainMaterial';
import type { TerrainTextures } from '../../src/world/terrain/textures';
import { createWaterMaterial, type WaterUniforms } from '../../src/world/terrain/water';

interface FakeShader {
  uniforms: Record<string, { value: unknown }>;
  vertexShader: string;
  fragmentShader: string;
}

function patch(mat: THREE.Material, lib: 'standard' | 'depth'): FakeShader {
  const src = THREE.ShaderLib[lib];
  const shader: FakeShader = { uniforms: {}, vertexShader: src.vertexShader, fragmentShader: src.fragmentShader };
  (mat.onBeforeCompile as unknown as (s: FakeShader, r: unknown) => void)(shader, null);
  return shader;
}

function materials() {
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
    terrain: createTerrainMaterial(textures, terrainUniforms),
    depth: createTerrainDepthMaterial(terrainUniforms),
    water: createWaterMaterial(textures.noise, waterUniforms(), false),
    river: createWaterMaterial(textures.noise, waterUniforms(), true),
  };
}

/** The tree / snow line threshold literal the fragment shader emits. */
const threshold = (frag: string, name: 'treeLine' | 'snowLine'): string => {
  const m = new RegExp(`float ${name} = (\\d+\\.\\d) \\+`).exec(frag);
  if (!m) throw new Error(`no ${name} threshold in the fragment shader`);
  return m[1];
};

/** Preprocessor conditionals are balanced (an unbalanced splice would not compile). */
function conditionalDepth(src: string): number {
  let depth = 0;
  for (const line of src.split('\n')) {
    const t = line.trim();
    if (/^#if(n?def)?\b/.test(t)) depth++;
    else if (t.startsWith('#endif')) {
      depth--;
      if (depth < 0) return -1;
    }
  }
  return depth;
}

const PROBES: Array<[number, number]> = [
  [0, 0],
  [12_000, -8_000],
  [-20_000, 15_000],
  [30_000, 30_000],
  [-4_000, -27_000],
];

describe('era look: the present day', () => {
  it('emits today’s thresholds, no capability defines and the plain cache keys', () => {
    const m = materials();
    const frag = patch(m.terrain, 'standard').fragmentShader;
    expect(threshold(frag, 'treeLine')).toBe('1750.0');
    expect(threshold(frag, 'snowLine')).toBe('2500.0');
    expect(frag).not.toMatch(/ERA_FARM|MARSH_CHANNEL|STRIP_MUD/);
    expect(Object.keys(m.terrain.defines ?? {}).sort()).toEqual(['TERRAIN_DEBUG', 'TERRAIN_DETAIL']);
    expect(m.terrain.customProgramCacheKey()).toBe('terrain-v5-1-0');
    expect(m.depth.customProgramCacheKey()).toBe('terrain-depth-v4');
    expect(m.water.customProgramCacheKey()).toBe('water-v4');
    expect(m.river.customProgramCacheKey()).toBe('river-v4');
  });
});

describe('era look: the Late Cretaceous', () => {
  beforeAll(() => setEra('cretaceous'));
  afterAll(() => setEra('present'));
  afterEach(() => setEra('cretaceous'));

  it('substitutes the Cretaceous palette into the terrain and water shaders', () => {
    const m = materials();
    const frag = patch(m.terrain, 'standard').fragmentShader;
    const water = patch(m.water, 'standard').fragmentShader;
    const river = patch(m.river, 'standard').fragmentShader;
    const P = PALETTES.cretaceous;
    expect(P).not.toBe(PALETTES.present);
    const waterKeys = new Set(['seaAtten', 'seaBodyDeep', 'seaBodyShallow', 'riverAtten', 'riverBody']);
    for (const [key, glsl] of Object.entries(P)) {
      expect(glsl, key).toMatch(/^vec3\([^()]*\)$/);
      expect((waterKeys.has(key) ? water + river : frag).includes(glsl), `${key} = ${glsl}`).toBe(true);
    }
    for (const [key, glsl] of Object.entries(ERA_GROUND.cretaceous!)) expect(frag.includes(glsl), `${key} = ${glsl}`).toBe(true);
    // The present meadow, river and sea colours are gone.
    for (const key of ['meadowWet', 'meadowDry', 'rockA', 'riverBody'] as const) {
      expect(frag + water + river, key).not.toContain(PALETTES.present[key]);
    }
    // Low linear albedos (the brief: 0.02-0.3) for the ground colours.
    const comps = (s: string): number[] => s.slice(5, -1).split(',').map(Number);
    for (const key of ['meadowWet', 'meadowDry', 'floor', 'rockA', 'rockB', 'sand', 'mud', 'alpine', 'scree'] as const) {
      for (const c of comps(P[key])) expect(c, key).toBeGreaterThanOrEqual(0.015), expect(c, key).toBeLessThanOrEqual(0.32);
    }
    // No grass before the Cenozoic: the ground cover is a muted olive, less saturated than today's meadow green.
    const sat = (v: number[]): number => (Math.max(...v) - Math.min(...v)) / Math.max(...v);
    expect(sat(comps(P.meadowWet))).toBeLessThan(sat(comps(PALETTES.present.meadowWet)));
    // Laterite: red-brown (red > green > blue).
    const soil = comps(ERA_GROUND.cretaceous!.soil);
    expect(soil[0]).toBeGreaterThan(soil[1]);
    expect(soil[1]).toBeGreaterThan(soil[2]);
    // A tea / silt river: browner (red over blue) than today's.
    const rb = comps(P.riverBody);
    expect(rb[0]).toBeGreaterThan(rb[2]);
  });

  it('sets the capability defines and keys the programs by era', () => {
    const m = materials();
    expect(m.terrain.defines).toMatchObject({ ERA_FARM: 0, MARSH_CHANNEL: 1, STRIP_MUD: 1, TERRAIN_DETAIL: 1, TERRAIN_DEBUG: 0 });
    expect(m.terrain.customProgramCacheKey()).toBe('terrain-v5-1-0-cretaceous');
    // The quality switch keeps the era defines and the key suffix.
    setTerrainDetail(m.terrain, 0);
    expect(m.terrain.defines).toMatchObject({ ERA_FARM: 0, MARSH_CHANNEL: 1, STRIP_MUD: 1, TERRAIN_DETAIL: 0 });
    expect(m.terrain.customProgramCacheKey()).toBe('terrain-v5-0-0-cretaceous');
    for (const mat of [m.depth, m.water, m.river]) expect(mat.customProgramCacheKey().endsWith('-cretaceous')).toBe(true);
    expect(m.depth.customProgramCacheKey()).toBe('terrain-depth-v4-cretaceous');
    expect(m.water.customProgramCacheKey()).toBe('water-v4-cretaceous');
    expect(m.river.customProgramCacheKey()).toBe('river-v4-cretaceous');
  });

  it('guards the farm, marsh and Flats paths with balanced conditionals', () => {
    const frag = patch(materials().terrain, 'standard').fragmentShader;
    expect(conditionalDepth(frag)).toBe(0);
    for (const d of ['#if ERA_FARM', '#if MARSH_CHANNEL', '#if STRIP_MUD']) expect(frag, d).toContain(d);
    // The field patchwork (and its parcel helpers) and the town sit inside ERA_FARM.
    const farmOpen = frag.indexOf('#if ERA_FARM');
    expect(farmOpen).toBeGreaterThan(-1);
    expect(frag.indexOf('Parcel parcelAt(')).toBeGreaterThan(farmOpen);
    // The Flats' crack helpers come with STRIP_MUD.
    expect(frag).toContain('float crackDistance(vec2 p)');
  });

  it('emits the CPU tree and snow lines as the shader thresholds (CPU/GLSL twins)', () => {
    const frag = patch(materials().terrain, 'standard').fragmentShader;
    expect(threshold(frag, 'treeLine')).toBe(treeLineBase().toFixed(1));
    expect(threshold(frag, 'snowLine')).toBe(snowLineBase().toFixed(1));
    expect(treeLineBase()).toBe(1750 + 600);
    expect(snowLineBase()).toBe(2500 + 6000);
    // The CPU functions carry the same offset over their (era-independent) noise.
    const cret = PROBES.map(([n, e]) => [treeLine(n, e), snowLine(n, e)]);
    setEra('present');
    const pres = PROBES.map(([n, e]) => [treeLine(n, e), snowLine(n, e)]);
    for (let i = 0; i < PROBES.length; i++) {
      expect(cret[i][0] - pres[i][0]).toBeCloseTo(600, 9);
      expect(cret[i][1] - pres[i][1]).toBeCloseTo(6000, 9);
    }
  });
});
