// Deep Time, increment 2 (WP0a): the era hooks the parallel packages build on.
//   - present day: the terrain shader carries no era text (presentGuard pins it byte for byte), the era uniforms are
//     never assigned or updated, and the era effects / layers are only reached behind isPresent() / flora checks;
//   - Cretaceous: the terrain shader is byte-identical to increment 1's (tests/fixtures/eraCretaceousTerrainInc1.json,
//     captured before WP0a) apart from the era uniform declarations: the VOLCANO_PALETTE extraction and the empty
//     slots change nothing;
//   - the slots: text a package puts in VOLCANO_LAVA(_HEAD)_GLSL / UNDERSTOREY_(HEAD|SPECKLE)_GLSL lands where the
//     contract says, inside #if VOLCANO for the lava, and ?eraoff= removes it;
//   - ERA_UNIFORMS' night ramp, the eraoff parser, the stubs.

import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NIGHT_RAMP_FROM_DEG, NIGHT_RAMP_TO_DEG, nightRamp } from '../../src/world/era/eraLight';
import { parseEraOff } from '../../src/world/era/eraOff';
import type { TerrainTextures } from '../../src/world/terrain/textures';
import type { TerrainUniforms } from '../../src/world/terrain/terrainMaterial';

interface Fs {
  readFileSync(path: URL, encoding: 'utf8'): string;
}
const fs = (await import(/* @vite-ignore */ 'node:fs' as string)) as Fs;
const FIXTURE = JSON.parse(fs.readFileSync(new URL('../fixtures/eraCretaceousTerrainInc1.json', import.meta.url), 'utf8')) as Record<string, { vertex: string; fragment: string; defines: Record<string, number>; uniforms: string[]; cacheKey: string }>;

/** Set the era in the CURRENT module graph (tests reset modules, so a static import would be stale). */
async function useEra(id: 'present' | 'cretaceous'): Promise<void> {
  (await import('../../src/world/era/eraState')).setEra(id);
}

afterEach(async () => {
  await useEra('present');
  (await import('../../src/world/era/eraOff')).setEraOff(null);
  vi.doUnmock('../../src/world/terrain/volcano');
  vi.doUnmock('../../src/world/terrain/vegetation/understorey');
  vi.resetModules();
});

const textures = (): TerrainTextures =>
  ({ noise: new THREE.Texture(), albedo: new THREE.DataArrayTexture(), normal: new THREE.DataArrayTexture(), layerMeans: [0, 1, 2, 3].map(() => new THREE.Vector3()), ready: Promise.resolve(), dispose: () => {} }) as unknown as TerrainTextures;
const uniforms = (): TerrainUniforms =>
  ({ uMorph: { value: [] }, uSkirt: { value: [] }, uLodCenter: { value: new THREE.Vector3() }, uForestFade: { value: new THREE.Vector2() }, uCanopyKeep: { value: new THREE.Vector4() }, uViewPos: { value: new THREE.Vector3() } }) as unknown as TerrainUniforms;

/** The terrain material's program text as three would compile it (onBeforeCompile on ShaderLib.standard). */
async function terrainProgram(): Promise<{ vertex: string; fragment: string; defines: Record<string, unknown>; uniforms: Record<string, unknown>; cacheKey: string }> {
  const { createTerrainMaterial } = await import('../../src/world/terrain/terrainMaterial');
  const mat = createTerrainMaterial(textures(), uniforms());
  const src = THREE.ShaderLib.standard;
  const shader = { uniforms: {} as Record<string, unknown>, vertexShader: src.vertexShader, fragmentShader: src.fragmentShader };
  (mat.onBeforeCompile as unknown as (s: unknown, r: unknown) => void)(shader, null);
  return { vertex: shader.vertexShader, fragment: shader.fragmentShader, defines: { ...(mat.defines ?? {}) }, uniforms: shader.uniforms, cacheKey: mat.customProgramCacheKey() };
}

describe('increment 2 era hooks', () => {
  it('present day: no era uniforms or era text in the terrain program', async () => {
    await useEra('present');
    const { ERA_TERRAIN_UNIFORMS_GLSL } = await import('../../src/world/terrain/eraUniforms');
    const p = await terrainProgram();
    expect(Object.keys(p.uniforms)).not.toContain('uEraTime');
    expect(Object.keys(p.uniforms)).not.toContain('uLava');
    expect(p.fragment).not.toContain(ERA_TERRAIN_UNIFORMS_GLSL);
    expect(p.fragment).not.toContain('VOLCANO');
  });

  it('Cretaceous: the terrain program equals increment 1 apart from the era uniform declarations', async () => {
    await useEra('cretaceous');
    const { ERA_TERRAIN_UNIFORMS_GLSL } = await import('../../src/world/terrain/eraUniforms');
    const p = await terrainProgram();
    const f = FIXTURE.terrain;
    expect(p.fragment.split(ERA_TERRAIN_UNIFORMS_GLSL).length).toBe(2);
    expect(p.fragment.replace(ERA_TERRAIN_UNIFORMS_GLSL, '')).toBe(f.fragment);
    expect(p.vertex).toBe(f.vertex);
    expect(p.defines).toEqual(f.defines);
    expect(p.cacheKey).toBe(f.cacheKey);
    expect(Object.keys(p.uniforms).sort()).toEqual([...f.uniforms, 'uEraTime', 'uLava', 'uNight'].sort());
  });

  it('VOLCANO_PALETTE holds the exact increment-1 literals', async () => {
    const { VOLCANO_PALETTE } = await import('../../src/world/terrain/volcano');
    const frag = FIXTURE.terrain.fragment;
    for (const v of Object.values(VOLCANO_PALETTE)) expect(frag).toContain(v);
  });

  it('the slots: lava inside #if VOLCANO before opaque_fragment, the speckle after the ground layers; eraoff removes them', async () => {
    vi.doMock('../../src/world/terrain/volcano', async (orig) => ({ ...(await orig<object>()), VOLCANO_LAVA_HEAD_GLSL: 'float lavaHeadMarker() { return 1.0; }\n', VOLCANO_LAVA_GLSL: 'outgoingLight += vec3(0.0); // LAVA_BODY_MARKER\n' }));
    vi.doMock('../../src/world/terrain/vegetation/understorey', async (orig) => ({ ...(await orig<object>()), UNDERSTOREY_HEAD_GLSL: 'float speckleHeadMarker() { return 1.0; }', UNDERSTOREY_SPECKLE_GLSL: 'acc.albedo *= 1.0; // SPECKLE_MARKER' }));
    vi.resetModules();
    await useEra('cretaceous');
    const p = await terrainProgram();
    const f = p.fragment;
    expect(f).toContain('#if VOLCANO\nfloat lavaHeadMarker() { return 1.0; }\n#endif\n');
    expect(f).toContain('#if VOLCANO\noutgoingLight += vec3(0.0); // LAVA_BODY_MARKER\n#endif\n#include <opaque_fragment>');
    expect(f).toContain('float speckleHeadMarker() { return 1.0; }\n');
    const speckle = f.indexOf('// SPECKLE_MARKER');
    expect(speckle).toBeGreaterThan(f.indexOf('addMat(acc, layerTop(') );
    expect(speckle).toBeLessThan(f.indexOf('acc.albedo *= tEdgeShade;'));
    expect(f.indexOf('lavaHeadMarker')).toBeLessThan(f.indexOf('void main()'));
    expect(f.indexOf('speckleHeadMarker')).toBeLessThan(f.indexOf('void main()'));
    // ?eraoff=lava,speckle: the same program without them.
    vi.resetModules();
    const eo = await import('../../src/world/era/eraOff');
    eo.setEraOff(['lava', 'speckle']);
    const q = await terrainProgram();
    expect(q.fragment).not.toContain('MARKER');
    expect(q.fragment).not.toContain('lavaHeadMarker');
    // And never in the present day.
    vi.resetModules();
    const es = await import('../../src/world/era/eraState');
    es.setEra('present');
    const r = await terrainProgram();
    expect(r.fragment).not.toContain('Marker');
    es.setEra('cretaceous');
  });

  it('ERA_UNIFORMS: uNight ramps +15 .. -6 deg; uEraTime counts simulation time; the lava stub gives no glow', async () => {
    await useEra('cretaceous');
    const { ERA_UNIFORMS, updateEraUniforms } = await import('../../src/world/terrain/eraUniforms');
    const sin = (deg: number): number => Math.sin((deg * Math.PI) / 180);
    expect(nightRamp(sin(20))).toBe(0);
    expect(nightRamp(sin(NIGHT_RAMP_FROM_DEG))).toBeCloseTo(0, 9);
    expect(nightRamp(sin(NIGHT_RAMP_TO_DEG))).toBeCloseTo(1, 6);
    expect(nightRamp(sin(7.2))).toBeGreaterThan(0.15);
    expect(nightRamp(sin(0))).toBeGreaterThan(0.5);
    const t0 = ERA_UNIFORMS.uEraTime.value;
    updateEraUniforms(0.5, { sunDir: { y: sin(-10) } });
    updateEraUniforms(Number.NaN, { sunDir: { y: sin(-10) } });
    expect(ERA_UNIFORMS.uEraTime.value).toBeCloseTo(t0 + 0.5, 9);
    expect(ERA_UNIFORMS.uNight.value).toBe(1);
    // The volcano's crater floor, intensity 0 (WP5 fills it).
    expect(ERA_UNIFORMS.uLava.value.x).toBe(-17500);
    expect(ERA_UNIFORMS.uLava.value.y).toBe(2000);
    expect(ERA_UNIFORMS.uLava.value.z).toBe(2600 - 160);
    expect(ERA_UNIFORMS.uLava.value.w).toBe(0);
  });

  it('TerrainSystem.update touches the era uniforms only outside the present day', async () => {
    const { ERA_UNIFORMS } = await import('../../src/world/terrain/eraUniforms');
    const { TerrainSystem } = await import('../../src/world/terrain/TerrainSystem');
    const calls: number[] = [];
    const fake = {
      frame: 0,
      updateView: () => {},
      select: () => {},
      request: () => {},
      integrate: () => {},
      evict: () => {},
      uploader: null,
      waterUniforms: { uTime: { value: 0 }, uSkyColor: { value: new THREE.Color() }, uHazeColor: { value: new THREE.Color() } },
      preset: { uploadsPerFrame: 1 },
      vegetation: null,
      grass: null,
      eraLayers: [{ object: new THREE.Object3D(), update: () => calls.push(1), dispose: () => {} }],
    };
    const ctx = { camera: new THREE.PerspectiveCamera(), sky: { skyColor: new THREE.Color(), hazeColor: new THREE.Color(), sunDir: new THREE.Vector3(0, 1, 0) } };
    await useEra('present');
    const t0 = ERA_UNIFORMS.uEraTime.value;
    (TerrainSystem.prototype.update as (this: unknown, dt: number, ctx: unknown) => void).call(fake, 0.25, ctx);
    expect(ERA_UNIFORMS.uEraTime.value).toBe(t0);
    expect(calls.length).toBe(0);
    await useEra('cretaceous');
    (TerrainSystem.prototype.update as (this: unknown, dt: number, ctx: unknown) => void).call(fake, 0.25, ctx);
    expect(ERA_UNIFORMS.uEraTime.value).toBeCloseTo(t0 + 0.25, 9);
    expect(calls.length).toBe(1);
  });

  it('the era effects and layers are reached only behind the era checks (stubs return nothing)', async () => {
    const sim = fs.readFileSync(new URL('../../src/sim/Simulator.ts', import.meta.url), 'utf8');
    // Inserted before the clouds, behind isPresent().
    const at = sim.indexOf('if (!isPresent()) for (const effect of createEraEffects(');
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(sim.indexOf('post.addEffect(clouds);'));
    expect(sim.split('createEraEffects(').length).toBe(2);
    const ts = fs.readFileSync(new URL('../../src/world/terrain/TerrainSystem.ts', import.meta.url), 'utf8');
    const gate = ts.indexOf("if (era().flora !== 'present') {\n        this.eraLayers = createEraLayers(");
    expect(gate).toBeGreaterThan(0);
    expect(ts.split('createEraLayers(').length).toBe(2);
    const { createEraEffects } = await import('../../src/render/post/eraEffects');
    const { createEraLayers } = await import('../../src/world/terrain/eraLayers');
    const { createUnderstorey } = await import('../../src/world/terrain/vegetation/understorey');
    await useEra('cretaceous');
    expect(createEraEffects({} as never)).toEqual([]);
    expect(createEraLayers({} as never)).toEqual([]);
    expect(createUnderstorey({} as never)).toBeNull();
  });

  it('?eraoff= parsing', () => {
    expect([...parseEraOff('?eraoff=plume,lava')].sort()).toEqual(['lava', 'plume']);
    expect([...parseEraOff('?x=1&eraoff=all')].sort()).toEqual(['lava', 'plume', 'speckle', 'understorey']);
    expect([...parseEraOff('?eraoff=bogus, Speckle')]).toEqual(['speckle']);
    expect(parseEraOff('').size).toBe(0);
  });
});
