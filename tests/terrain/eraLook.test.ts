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

/** The era capability defines, the only macros preprocess() resolves. */
const ERA_DEFINES = ['ERA_FARM', 'MARSH_CHANNEL', 'STRIP_MUD'] as const;

/**
 * A minimal GLSL preprocessor for the era capability defines: it resolves the #if / #ifdef / #ifndef / #elif /
 * #else / #endif blocks whose condition names one of ERA_DEFINES (as NAME, NAME > n or NAME == n), dropping the
 * lines a real compile would skip, and leaves every other conditional (three.js's own) and its lines in place.
 */
function preprocess(src: string, defs: Record<(typeof ERA_DEFINES)[number], number>): string {
  const evalCond = (kind: string, expr: string): boolean | null => {
    const name = ERA_DEFINES.find((d) => new RegExp(`\\b${d}\\b`).test(expr));
    if (!name) return null;
    const v = defs[name];
    if (kind === 'ifdef') return true;
    if (kind === 'ifndef') return false;
    const m = new RegExp(`^${name}\\s*(==|>|!=)?\\s*(\\d+)?$`).exec(expr.trim());
    if (!m) throw new Error(`unsupported era condition: ${expr}`);
    if (!m[1]) return v !== 0;
    const n = Number(m[2]);
    return m[1] === '==' ? v === n : m[1] === '>' ? v > n : v !== n;
  };
  // Each frame: whether it is resolved here, whether its current branch is live, and whether a branch was taken.
  const stack: { resolved: boolean; live: boolean; taken: boolean; outer: boolean }[] = [];
  const out: string[] = [];
  const active = (): boolean => stack.every((f) => f.live);
  for (const line of src.split('\n')) {
    const t = line.trim();
    const open = /^#(if|ifdef|ifndef)\b\s*(.*)$/.exec(t);
    if (open) {
      const outer = active();
      const c = evalCond(open[1], open[2]);
      if (c === null) {
        stack.push({ resolved: false, live: true, taken: false, outer });
        if (outer) out.push(line);
      } else stack.push({ resolved: true, live: c, taken: c, outer });
      continue;
    }
    const top = stack[stack.length - 1];
    const elif = /^#elif\b\s*(.*)$/.exec(t);
    if (elif && top) {
      if (!top.resolved) {
        if (top.outer) out.push(line);
        continue;
      }
      const c = evalCond('if', elif[1]);
      if (c === null) throw new Error(`mixed era #elif: ${t}`);
      top.live = !top.taken && c;
      top.taken ||= c;
      continue;
    }
    if (t.startsWith('#else') && top) {
      if (top.resolved) {
        top.live = !top.taken;
        top.taken = true;
      } else if (top.outer) out.push(line);
      continue;
    }
    if (t.startsWith('#endif') && top) {
      stack.pop();
      if (!top.resolved && top.outer) out.push(line);
      continue;
    }
    if (active()) out.push(line);
  }
  if (stack.length) throw new Error('unbalanced conditionals');
  return out.join('\n');
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

  it('guards the farm, marsh and Flats paths: each drops out when its define is off', () => {
    const frag = patch(materials().terrain, 'standard').fragmentShader;
    expect(conditionalDepth(frag)).toBe(0);
    for (const d of ['#if ERA_FARM', '#if MARSH_CHANNEL', '#if STRIP_MUD']) expect(frag, d).toContain(d);
    // Preprocessed as compiled (the material's own defines) and with each capability flipped: the field
    // patchwork (its parcel helpers and the parcel lookup), the farm weight and the town drop out without
    // ERA_FARM; the marsh weight without MARSH_CHANNEL; the Flats' cracks without STRIP_MUD.
    const on = { ERA_FARM: 1, MARSH_CHANNEL: 1, STRIP_MUD: 1 };
    const farm = ['Parcel parcelAt(vec2 p)', 'parcelAt(vec2(tP.x, -tP.z))', 'vec3 crop = cropColor(', 'farmW = mix(farmW,', 'tTownD = length(', 'tUrbanW = urbanW;'];
    const marsh = ['float tMarshW = smoothstep(', 'meadow = mix(meadow, marsh, tMarshW);'];
    const mud = ['float crackDistance(vec2 p)'];
    const all = preprocess(frag, on);
    for (const s of [...farm, ...marsh, ...mud]) expect(all, s).toContain(s);
    const noFarm = preprocess(frag, { ...on, ERA_FARM: 0 });
    for (const s of farm) expect(noFarm, s).not.toContain(s);
    expect(noFarm).toContain('farmW = 0.0;');
    for (const s of [...marsh, ...mud]) expect(noFarm, s).toContain(s);
    const noMarsh = preprocess(frag, { ...on, MARSH_CHANNEL: 0 });
    for (const s of marsh) expect(noMarsh, s).not.toContain(s);
    expect(noMarsh).toContain('float tMarshW = 0.0;');
    for (const s of [...farm, ...mud]) expect(noMarsh, s).toContain(s);
    const noMud = preprocess(frag, { ...on, STRIP_MUD: 0 });
    for (const s of mud) expect(noMud, s).not.toContain(s);
    for (const s of [...farm, ...marsh]) expect(noMud, s).toContain(s);
    // As compiled for the Cretaceous: no farm or town code, marsh and the Flats in.
    const d = materials().terrain.defines as Record<string, number>;
    const cret = preprocess(frag, { ERA_FARM: d.ERA_FARM, MARSH_CHANNEL: d.MARSH_CHANNEL, STRIP_MUD: d.STRIP_MUD });
    for (const s of farm) expect(cret, s).not.toContain(s);
    for (const s of [...marsh, ...mud]) expect(cret, s).toContain(s);
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
