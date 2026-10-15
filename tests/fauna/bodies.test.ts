// Creature art (Deep Time WP4): the species meshes are well formed, within their triangle budgets, at real
// scale, and every LOD shares the pivots the animated material poses them about.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { azhdarchidFold, AZHDARCHID_GROUND_OFFSET_M } from '../../src/world/fauna/species/azhdarchid';
import { buildFaunaSpecies, FAUNA_SPECIES, strideM } from '../../src/world/fauna/species/index';
import { createFaunaInstances, createFaunaMaterials, createFaunaMesh, faunaVertexGLSL, rigOf, writeFaunaInstance } from '../../src/world/fauna/faunaMaterial';
import { PROFILES } from '../../src/world/fauna/profiles';
import { BONE, BONE_COUNT, FAUNA_SPECIES_IDS, FAUNA_STRIDE, type CreatureMeshSet } from '../../src/world/fauna/types';

// Triangle budgets [lod0, lod1, lod2, caster] per species: profiles.ts PROFILES[id].render.tris (types.ts table;
// the inc-2 packages own their species' rows in species/<id>.data.ts).
const BUDGET = (id: (typeof FAUNA_SPECIES_IDS)[number]): readonly [number, number, number, number] => PROFILES[id].render.tris;

const sets = new Map<string, CreatureMeshSet>(FAUNA_SPECIES_IDS.map((id) => [id, buildFaunaSpecies(id)]));
const lods = (s: CreatureMeshSet): [string, THREE.BufferGeometry][] => [
  ['lod0', s.lod0],
  ['lod1', s.lod1],
  ['lod2', s.lod2],
  ['caster', s.caster],
];
const tris = (g: THREE.BufferGeometry): number => g.index!.count / 3;

describe.each(FAUNA_SPECIES_IDS)('%s', (id) => {
  const set = sets.get(id)!;

  it('has finite attributes and valid bones and weights', () => {
    for (const [, g] of lods(set)) {
      for (const name of ['position', 'normal', 'color', 'aBone', 'aBoneW', 'aRig']) {
        const a = g.getAttribute(name).array as Float32Array;
        for (let i = 0; i < a.length; i++) expect(Number.isFinite(a[i]), `${name}[${i}]`).toBe(true);
      }
      const bone = g.getAttribute('aBone').array as Float32Array;
      const w = g.getAttribute('aBoneW').array as Float32Array;
      for (let i = 0; i < bone.length; i++) {
        expect(Number.isInteger(bone[i]) && bone[i] >= 0 && bone[i] < BONE_COUNT).toBe(true);
        // aBoneW to the bone, 1 - aBoneW to its parent: both in 0..1, so the pair sums to 1.
        expect(w[i]).toBeGreaterThanOrEqual(0);
        expect(w[i]).toBeLessThanOrEqual(1);
        expect(Math.abs(w[i] + (1 - w[i]) - 1)).toBeLessThan(1e-5);
        // A partial weight needs a parent to give the rest to.
        if (w[i] < 1) expect(set.pivots[bone[i] * 4 + 3]).toBeGreaterThanOrEqual(0);
      }
      const n = g.getAttribute('normal');
      for (let i = 0; i < n.count; i++) expect(Math.hypot(n.getX(i), n.getY(i), n.getZ(i))).toBeCloseTo(1, 3);
      const idx = g.index!;
      for (let i = 0; i < idx.count; i++) expect(idx.getX(i)).toBeLessThan(g.getAttribute('position').count);
    }
  });

  it('keeps the baked albedo in the linear 0.02-0.16 range', () => {
    for (const [, g] of lods(set)) {
      const c = g.getAttribute('color').array as Float32Array;
      for (let i = 0; i < c.length; i++) {
        expect(c[i]).toBeGreaterThanOrEqual(0.015);
        expect(c[i]).toBeLessThanOrEqual(0.161);
      }
    }
  });

  it('meets the triangle budgets', () => {
    const [b0, b1, b2, bc] = BUDGET(id);
    expect(tris(set.lod0)).toBeLessThanOrEqual(b0);
    expect(tris(set.lod0)).toBeLessThanOrEqual(PROFILES[id].render.lod0Tris);
    expect(tris(set.lod1)).toBeLessThanOrEqual(b1);
    expect(tris(set.lod2)).toBeLessThanOrEqual(b2);
    expect(tris(set.caster)).toBeLessThanOrEqual(bc);
    // Each LOD is a real step down.
    expect(tris(set.lod1)).toBeLessThan(tris(set.lod0) * 0.3);
    expect(tris(set.lod2)).toBeLessThan(tris(set.lod1) * 0.4);
  });

  it('is at real scale: the bounding size matches lengthM within 10%', () => {
    for (const [, g] of lods(set)) {
      g.computeBoundingBox();
      const size = g.boundingBox!.getSize(new THREE.Vector3());
      // Walkers by their length (x), flyers (the azhdarchid rig) by their span (z).
      const measured = FAUNA_SPECIES[id].rig === 'azhdarchid' ? size.z : size.x;
      expect(Math.abs(measured / set.lengthM - 1)).toBeLessThan(0.1);
    }
  });

  it('stands on the ground: the lowest point is groundOffsetM below the origin', () => {
    const off = FAUNA_SPECIES[id].groundOffsetM;
    // (The azhdarchid LOD2 has no legs: at 2.5+ km they are below a pixel.)
    for (const [name, g] of lods(set)) {
      if (name === 'lod2' && off > 0) continue;
      g.computeBoundingBox();
      expect(g.boundingBox!.min.y).toBeGreaterThan(-off - 0.08);
      expect(g.boundingBox!.min.y).toBeLessThan(-off + 0.08);
    }
  });

  it('shares one set of pivots across all LODs: an acyclic tree to the root, every chain within the shader bound', () => {
    expect(set.pivots.length).toBe(BONE_COUNT * 4);
    expect(set.pivots[BONE.root * 4 + 3]).toBe(-1);
    // Parents need not come before children (the sauropod's head hangs off wingR = neck4, types.ts BONE_ALIAS):
    // the shader only follows uPivots[b].w. Every bone reaches the root without a cycle, walking at most 8 parents
    // after its own rotation (faunaSkin's loop bound), so the root is applied.
    for (let b = 1; b < BONE_COUNT; b++) {
      const parent = set.pivots[b * 4 + 3];
      expect(Number.isInteger(parent) && parent >= 0 && parent < BONE_COUNT && parent !== b).toBe(true);
      let parents = 0;
      let i = parent;
      for (; i >= 0 && parents <= BONE_COUNT; i = set.pivots[i * 4 + 3]) parents++;
      expect(i, `bone ${b} reaches the root`).toBe(-1);
      expect(parents, `bone ${b} chain`).toBeLessThanOrEqual(8);
    }
    for (const [, g] of lods(set)) for (const v of g.getAttribute('aBone').array as Float32Array) expect(v).toBeLessThan(BONE_COUNT);
  });
});

describe('species set', () => {
  it('builds Edmontosaurus at 11.5 m and the azhdarchids at a 10.5 m span (the small one drawn at 0.43)', () => {
    expect(sets.get('edmontosaurus')!.lengthM).toBeCloseTo(11.5, 5);
    expect(sets.get('quetzalcoatlus')!.lengthM).toBeCloseTo(10.5, 5);
    expect(FAUNA_SPECIES.azhdarchidSmall.defaultScale).toBeCloseTo(0.43, 5);
    expect(sets.get('azhdarchidSmall')!.lengthM * FAUNA_SPECIES.azhdarchidSmall.defaultScale).toBeCloseTo(4.5, 1);
  });

  it('gives Quetzalcoatlus a ~5 m standing head height', () => {
    const g = sets.get('quetzalcoatlus')!.lod0;
    g.computeBoundingBox();
    const top = g.boundingBox!.max.y + AZHDARCHID_GROUND_OFFSET_M;
    expect(top).toBeGreaterThan(4.6);
    expect(top).toBeLessThan(5.6);
  });

  it('folds the azhdarchid wing so the hand rests on the ground', () => {
    const { quats, hand } = azhdarchidFold();
    expect(hand.y + AZHDARCHID_GROUND_OFFSET_M).toBeGreaterThan(0.0);
    expect(hand.y + AZHDARCHID_GROUND_OFFSET_M).toBeLessThan(0.15);
    // Hands ahead of the shoulders, beside the body.
    expect(hand.x).toBeGreaterThan(0.6);
    expect(hand.z).toBeGreaterThan(0.2);
    for (let k = 0; k < 4; k++) expect(Math.hypot(quats[k * 4], quats[k * 4 + 1], quats[k * 4 + 2], quats[k * 4 + 3])).toBeCloseTo(1, 5);
  });

  it('strides lengthen from walk to run and scale with the body', () => {
    expect(strideM('edmontosaurus', 2)).toBeGreaterThan(strideM('edmontosaurus', 1));
    expect(strideM('azhdarchidSmall', 1, 0.43)).toBeCloseTo(strideM('quetzalcoatlus', 1) * 0.43, 5);
  });

  it('builds materials with a stable per-rig cache key and instanced drawables without reallocation', () => {
    for (const id of FAUNA_SPECIES_IDS) {
      const set = sets.get(id)!;
      const m = createFaunaMaterials(id, set);
      const rig = rigOf(id);
      expect(rig).toBe({ hadrosaur: 0, azhdarchid: 1, theropod: 2, ceratopsian: 3, sauropod: 4 }[FAUNA_SPECIES[id].rig]);
      expect(m.material.customProgramCacheKey()).toBe(`fauna-v2-${rig}`);
      // FAUNA_WINGS (wing fold, 14/15 mirroring, wing sub-joints) only on the azhdarchid rig.
      expect('FAUNA_WINGS' in (m.material.defines ?? {})).toBe(rig === 1);
      expect(m.material.defines?.FAUNA_RIG).toBe(rig);
      expect(m.depth.customProgramCacheKey()).toBe(`fauna-depth-v1-${rig}`);
      expect(m.uniforms.uPivots.value.length).toBe(BONE_COUNT);
      // The patch applies to three's actual chunks.
      const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.physical.vertexShader, fragmentShader: THREE.ShaderLib.physical.fragmentShader };
      m.material.onBeforeCompile(shader as never, undefined as never);
      expect(shader.vertexShader).toContain('faunaSkin();');
      expect(shader.vertexShader).toContain('vec3 transformed = fWorldP;');
      expect(shader.fragmentShader).toContain('diffuseColor.rgb *= vFaunaTint;');
      const depth = { uniforms: {}, vertexShader: THREE.ShaderLib.depth.vertexShader, fragmentShader: THREE.ShaderLib.depth.fragmentShader };
      m.depth.onBeforeCompile(depth as never, undefined as never);
      expect(depth.vertexShader).toContain('faunaSkin();');

      const inst = createFaunaInstances(8);
      const mesh = createFaunaMesh(set.lod0, inst, m);
      const array = inst.array;
      writeFaunaInstance(inst.array, 7, 1, 2, 3, 0.1, 0.2, 0.3, 4.25, 1, 0.5, 0.1, 1, 2.5);
      expect(Array.from(inst.array.subarray(7 * FAUNA_STRIDE, 8 * FAUNA_STRIDE)).map((v) => +v.toFixed(4))).toEqual([1, 2, 3, 0.1, 0.2, 0.3, 0.25, 1, 0.5, 0.1, 1, 2.5]);
      inst.setCount(99);
      expect(inst.count).toBe(8);
      expect((mesh.geometry as THREE.InstancedBufferGeometry).instanceCount).toBe(8);
      inst.setCount(Number.NaN);
      expect(inst.count).toBe(0);
      expect(inst.array).toBe(array);
      expect(mesh.frustumCulled).toBe(false);
      expect(mesh.customDepthMaterial).toBe(m.depth);
    }
  });

  it('emits a vertex stage with every bone of the contract in range', () => {
    for (const rig of [0, 1, 2, 3, 4] as const) {
      const src = faunaVertexGLSL(rig);
      expect(src).toContain('void faunaPose()');
      expect(src).toContain('#ifdef FAUNA_WINGS');
      expect(src).toContain(`uniform vec4 uPivots[${BONE_COUNT}]`);
      expect(src).not.toMatch(/NaN|undefined/);
    }
  });
});
