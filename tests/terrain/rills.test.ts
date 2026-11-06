// Hillside rills (rills.ts): patches built alone agree at their borders and do not depend on the window they were traced
// in or on what was built before; seed 0 has none, and its terrain shader text carries none of their code.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { buildRillPatch, RILL_PATCH, RILL_TEX, RILL_TEXEL, rillTexelCentre } from '../../src/world/terrain/rills';
import { setWorldSeed } from '../../src/world/worldSeed';
import { createTerrainMaterial, type TerrainUniforms } from '../../src/world/terrain/terrainMaterial';
import type { TerrainTextures } from '../../src/world/terrain/textures';

/** A hillside patch on seed 1 with rills over its borders, and its east and north neighbours. */
const SEED = 1;
const A = { pi: 10, pj: -31 };

const T = RILL_TEX;
/** Texel (k, l) of a patch's RGBA bytes. */
const px = (t: Uint8Array, k: number, l: number): number[] => Array.from(t.subarray((l * T + k) * 4, (l * T + k) * 4 + 4));
/** Texels with a rill in reach (its size code over 0). */
const lit = (t: Uint8Array, ks: number[], ls: number[]): number => {
  let c = 0;
  for (const l of ls) for (const k of ks) if (t[(l * T + k) * 4 + 3] > 0 && t[(l * T + k) * 4 + 2] < 255) c++;
  return c;
};
/** Byte-equal. */
const same = (x: Uint8Array | null, y: Uint8Array | null): boolean => !!x && !!y && x.length === y.length && x.every((v, i) => v === y[i]);
const range = (a: number, b: number): number[] => Array.from({ length: b - a }, (_, i) => a + i);

describe('rills', () => {
  setWorldSeed(SEED);
  const a = buildRillPatch(A);
  const east = buildRillPatch({ pi: A.pi + 1, pj: A.pj });
  const north = buildRillPatch({ pi: A.pi, pj: A.pj + 1 });

  it('texel centres: the apron of one patch is the edge of the next', () => {
    expect(rillTexelCentre(T - 2) + RILL_TEXEL).toBeCloseTo(RILL_PATCH + rillTexelCentre(1), 9);
    expect(rillTexelCentre(T - 1)).toBeCloseTo(RILL_PATCH + rillTexelCentre(1), 9);
  });

  it('the patch has rills, and they cross both borders', () => {
    expect(a.texels).not.toBeNull();
    expect(a.stats.km).toBeGreaterThan(2);
    // (Rills within a texel of the east and north borders: what the comparisons below compare.)
    expect(lit(a.texels!, [T - 2, T - 1], range(0, T))).toBeGreaterThan(20);
    expect(lit(a.texels!, range(0, T), [T - 2, T - 1])).toBeGreaterThan(20);
  });

  it('matches its neighbours across the border: same position, distance and size', () => {
    // Patch A's last core column and its apron are the east patch's apron and first core column (texel centres agree).
    for (let l = 0; l < T; l++) {
      // The east neighbour's rows run over the same north range.
      expect(px(a.texels!, T - 2, l)).toEqual(px(east.texels!, 0, l));
      expect(px(a.texels!, T - 1, l)).toEqual(px(east.texels!, 1, l));
    }
    for (let k = 0; k < T; k++) {
      expect(px(a.texels!, k, T - 2)).toEqual(px(north.texels!, k, 0));
      expect(px(a.texels!, k, T - 1)).toEqual(px(north.texels!, k, 1));
    }
  });

  it('does not depend on the window it is traced in', () => {
    const wide = buildRillPatch(A, 9, 3);
    const wider = buildRillPatch(A, 1, 23);
    expect(same(wide.texels, a.texels)).toBe(true);
    expect(same(wider.texels, a.texels)).toBe(true);
  });

  it('is deterministic: the same after other patches and another seed', () => {
    setWorldSeed(42);
    buildRillPatch({ pi: -12, pj: 35 });
    setWorldSeed(SEED);
    const again = buildRillPatch(A);
    expect(same(again.texels, a.texels)).toBe(true);
  });
});

describe('rills at seed 0', () => {
  const textures = {
    noise: new THREE.Texture(),
    albedo: new THREE.DataArrayTexture(),
    normal: new THREE.DataArrayTexture(),
    layerMeans: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()],
    ready: Promise.resolve(),
    dispose: () => {},
  } as unknown as TerrainTextures;
  const terrainUniforms = (): TerrainUniforms =>
    ({
      uMorph: { value: [] },
      uSkirt: { value: [] },
      uLodCenter: { value: new THREE.Vector3() },
      uForestFade: { value: new THREE.Vector2() },
      uCanopyKeep: { value: new THREE.Vector4() },
      uViewPos: { value: new THREE.Vector3() },
    }) as unknown as TerrainUniforms;
  const fragment = (): { text: string; uniforms: string[] } => {
    const u = terrainUniforms();
    const mat = createTerrainMaterial(textures, u);
    const shader = { uniforms: {} as Record<string, unknown>, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
    (mat.onBeforeCompile as unknown as (s: typeof shader, r: unknown) => void)(shader, null);
    return { text: shader.fragmentShader, uniforms: Object.keys(shader.uniforms) };
  };

  it('builds no rills and adds nothing to the terrain shader', () => {
    setWorldSeed(0);
    expect(buildRillPatch({ pi: 0, pj: 0 }).texels).toBeNull();
    const f = fragment();
    expect(f.text).not.toMatch(/rill/i);
    expect(f.uniforms).not.toContain('tRills');
  });

  it('a seeded world draws them', () => {
    setWorldSeed(SEED);
    const f = fragment();
    expect(f.text).toContain('rillNear(');
    expect(f.uniforms).toContain('tRills');
    expect(f.uniforms).toContain('uRillKey');
    setWorldSeed(0);
  });
});
