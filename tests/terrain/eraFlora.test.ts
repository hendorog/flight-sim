// Deep Time flora (WP2): the Late Cretaceous trees in the four existing slots. Placement (deterministic,
// species 0..3 by habitat, no hedgerows, heights in each slot's range, a valid bucket layout), the models
// (card budgets, LOD 1 at most half, every vertex inside the impostor bound), and arrays aligned slot for slot.
// The present day's tree cells are pinned by tests/era/presentGuard.test.ts (buildTreeCell hashes); its tree
// models and patched shaders are pinned here, to hashes taken before Deep Time (commit 2cdce84).

import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setEra } from '../../src/world/era/eraState';
import { FLORA, FLORA_SLOTS } from '../../src/world/terrain/vegetation/flora';
import { BUCKETS, buildTreeCell, SPECIES_COUNT, TREE_STRIDE, type TreeCellData, type TreeCellRequest } from '../../src/world/terrain/vegetation/placement';
import {
  createImpostorDepthMaterial,
  createImpostorMaterial,
  createNearTreeMaterial,
  createShadowProxyMaterials,
  type TreeUniforms,
} from '../../src/world/terrain/vegetation/treeMaterials';
import { createShadowProxies, createTreeGeometries, SPECIES_TINT, speciesTints, TREE_BOUND_RADIUS } from '../../src/world/terrain/vegetation/treeModels';
import { hydrology, makeSample, sampleTerrain } from '../../src/world/terrain/heightfield';
import { makeParcel, parcelAt } from '../../src/world/terrain/fields';

const SLOTS = FLORA.cretaceous.slots;

/** VegetationSystem CELL = 256 m at the high preset's spacing; over forest, river, floodplain and uplands. */
function cells(): TreeCellRequest[] {
  const req = (cx: number, cz: number): TreeCellRequest => ({ cx, cz, size: 256, spacing: 5.5 });
  const out = [req(0, 0), req(-3, -2), req(5, 4), req(20, -10), req(-30, 15), req(-8, 12), req(12, 30), req(-20, -25)];
  // Along the river.
  for (let k = 1; k < 6; k++) {
    const i = Math.floor((hydrology.river.north.length * k) / 6);
    out.push(req(Math.floor(hydrology.river.east[i] / 256), Math.floor(hydrology.river.north[i] / 256)));
  }
  // A coarse sweep of the valley and the foothills to the north (+-18 km).
  for (let j = -8; j <= 8; j += 2) for (let i = -8; i <= 8; i += 2) out.push(req(i * 9 + 1, j * 9 - 2));
  return out;
}

function checkLayout(c: TreeCellData, req: TreeCellRequest): void {
  expect(c.instances.length).toBe(c.count * TREE_STRIDE);
  expect(c.bucketStart.length).toBe(BUCKETS * BUCKETS + 1);
  expect(c.bucketStart[0]).toBe(0);
  expect(c.bucketStart[BUCKETS * BUCKETS]).toBe(c.count);
  for (let b = 0; b < BUCKETS * BUCKETS; b++) expect(c.bucketStart[b + 1]).toBeGreaterThanOrEqual(c.bucketStart[b]);
  // order is a permutation, and each tree lies in its bucket's sub-square.
  const seen = new Uint8Array(c.count);
  const sub = req.size / BUCKETS;
  for (let b = 0; b < BUCKETS * BUCKETS; b++) {
    for (let o = c.bucketStart[b]; o < c.bucketStart[b + 1]; o++) {
      const k = c.order[o];
      expect(seen[k]).toBe(0);
      seen[k] = 1;
      const bx = Math.min(BUCKETS - 1, Math.max(0, Math.floor((c.instances[k * TREE_STRIDE] - req.cx * req.size) / sub)));
      const bz = Math.min(BUCKETS - 1, Math.max(0, Math.floor((c.instances[k * TREE_STRIDE + 2] - req.cz * req.size) / sub)));
      expect(bz * BUCKETS + bx).toBe(b);
    }
  }
  // Ranks ascending (sorted in float64, stored with the species in float32).
  let last = -1;
  for (let k = 0; k < c.count; k++) {
    const v = c.instances[k * TREE_STRIDE + 5];
    const r = v - Math.floor(v);
    expect(r).toBeGreaterThanOrEqual(last - 1e-6);
    last = r;
  }
}

describe('Cretaceous flora', () => {
  beforeAll(() => {
    setEra('cretaceous');
  });
  afterAll(() => {
    setEra('present');
  });

  it('the flora table has four distinct Cretaceous species, none of today’s', () => {
    expect(SLOTS.length).toBe(FLORA_SLOTS);
    expect(SLOTS.map((s) => s.key)).toEqual(['araucaria', 'taxodioid', 'platanoid', 'sabal']);
    for (const s of SLOTS) {
      expect(s.height[0]).toBeLessThan(s.height[1]);
      expect(s.tint.length).toBe(3);
    }
  });

  it('places deterministic cells of the four species by habitat, without hedgerows, heights in range', () => {
    const counts = [0, 0, 0, 0];
    let total = 0;
    for (const req of cells()) {
      const a = buildTreeCell(req);
      const b = buildTreeCell(req);
      expect(b.count).toBe(a.count);
      expect(Array.from(b.instances)).toEqual(Array.from(a.instances));
      expect(Array.from(b.order)).toEqual(Array.from(a.order));
      checkLayout(a, req);
      for (let k = 0; k < a.count; k++) {
        const s = Math.floor(a.instances[k * TREE_STRIDE + 5]);
        expect(s).toBeGreaterThanOrEqual(0);
        expect(s).toBeLessThan(SPECIES_COUNT);
        const h = a.instances[k * TREE_STRIDE + 3];
        // Every tree within its species' range (so no hedgerow shrubs of 3.5-6.5 m either).
        expect(h).toBeGreaterThanOrEqual(SLOTS[s].height[0] - 1e-3);
        expect(h).toBeLessThanOrEqual(SLOTS[s].height[1] + 1e-3);
        counts[s]++;
      }
      total += a.count;
    }
    // Every species grows somewhere (the palms mostly outside the forest, so fewer); the angiosperm
    // broadleaf dominates.
    expect(total).toBeGreaterThan(5000);
    for (const s of [0, 1, 2]) expect(counts[s]).toBeGreaterThan(total * 0.02);
    expect(counts[3]).toBeGreaterThan(200);
    expect(counts[2]).toBe(Math.max(...counts));
  }, 60000);

  it('puts each species in its habitat: araucaria high, taxodioids low and by the river, palms on the plain', () => {
    const ground = [0, 0, 0, 0];
    const river = [0, 0, 0, 0];
    const n = [0, 0, 0, 0];
    const s = makeSample();
    for (const req of cells()) {
      const c = buildTreeCell(req);
      for (let k = 0; k < c.count; k++) {
        const sp = Math.floor(c.instances[k * TREE_STRIDE + 5]);
        sampleTerrain(c.instances[k * TREE_STRIDE + 2], c.instances[k * TREE_STRIDE], s);
        n[sp]++;
        ground[sp] += s.ground;
        river[sp] += s.riverHalfWidth > 0 ? Math.min(2000, s.riverDist - s.riverHalfWidth) : 2000;
      }
    }
    const meanGround = ground.map((g, i) => g / n[i]);
    const meanRiver = river.map((r, i) => r / n[i]);
    const [ar, tx, pl, pa] = [0, 1, 2, 3];
    // Uplands and slopes: the araucarias stand well above the lowland broadleaf forest.
    expect(meanGround[ar]).toBeGreaterThan(meanGround[pl] + 250);
    // Wet ground: the taxodioids are the lowest of all and much nearer the river than the broadleaves.
    expect(meanGround[tx]).toBe(Math.min(...meanGround));
    expect(meanRiver[tx]).toBeLessThan(0.6 * meanRiver[pl]);
    // Palms on the low floodplain, below the broadleaf average and far below the araucarias.
    expect(meanGround[pa]).toBeLessThan(meanGround[pl]);
    expect(meanRiver[pa]).toBeLessThan(meanRiver[pl]);
  }, 60000);

  it('plants no hedgerows: no more trees on the field-edge hedge lines than their share of the land', () => {
    // Share of trees standing on a hedge line (parcel.hedge < 2.2 m, the band the present day plants)
    // over that band's share of the land. The present day's hedgerows put it well above 1 (a control that
    // the measure sees them); the Cretaceous has no farmland, so its trees ignore the lines.
    const p = makeParcel();
    let bandArea = 0;
    let area = 0;
    for (const req of cells()) {
      for (let i = 0; i < 400; i++) {
        parcelAt(req.cx * req.size + ((i % 20) + 0.5) * 12.8, req.cz * req.size + (Math.floor(i / 20) + 0.5) * 12.8, p);
        area++;
        if (p.hedge < 2.2) bandArea++;
      }
    }
    const enrichment = (): number => {
      let on = 0;
      let total = 0;
      for (const req of cells()) {
        const c = buildTreeCell(req);
        for (let k = 0; k < c.count; k++) {
          parcelAt(c.instances[k * TREE_STRIDE], c.instances[k * TREE_STRIDE + 2], p);
          if (p.hedge < 2.2) on++;
          total++;
        }
      }
      return on / total / (bandArea / area);
    };
    const cretaceous = enrichment();
    setEra('present');
    let present: number;
    try {
      present = enrichment();
    } finally {
      setEra('cretaceous');
    }
    expect(present).toBeGreaterThan(1.5);
    expect(cretaceous).toBeLessThan(1.1);
  }, 60000);

  it('builds four aligned models, proxies and tints', () => {
    const lod0 = createTreeGeometries(0);
    const lod1 = createTreeGeometries(1);
    const proxies = createShadowProxies();
    const tints = speciesTints();
    expect(lod0.length).toBe(SPECIES_COUNT);
    expect(lod1.length).toBe(SPECIES_COUNT);
    expect(proxies.length).toBe(SPECIES_COUNT);
    expect(tints.length).toBe(SPECIES_COUNT);
    tints.forEach((t, s) => expect(t).toEqual([...SLOTS[s].tint]));
    // Each shadow caster stays inside its tree: no higher, and no wider, than the LOD 0 model.
    proxies.forEach((p, s) => {
      expect(p.getAttribute('position').count).toBeGreaterThan(20);
      p.computeBoundingBox();
      lod0[s].computeBoundingBox();
      const pb = p.boundingBox!;
      const mb = lod0[s].boundingBox!;
      expect(pb.max.y, SLOTS[s].key).toBeLessThanOrEqual(mb.max.y + 0.03);
      for (const k of ['x', 'z'] as const) {
        expect(pb.max[k], SLOTS[s].key).toBeLessThanOrEqual(mb.max[k]);
        expect(pb.min[k], SLOTS[s].key).toBeGreaterThanOrEqual(mb.min[k]);
      }
    });
  });

  it('keeps each model within the card budget, LOD 1 at most half of LOD 0', () => {
    const lod0 = createTreeGeometries(0);
    const lod1 = createTreeGeometries(1);
    for (let s = 0; s < SPECIES_COUNT; s++) {
      const c0 = lod0[s].userData.cards as number;
      const c1 = lod1[s].userData.cards as number;
      expect(c0, SLOTS[s].key).toBeGreaterThanOrEqual(100);
      expect(c0, SLOTS[s].key).toBeLessThanOrEqual(210);
      expect(c1, SLOTS[s].key).toBeLessThanOrEqual(0.5 * c0);
    }
  });

  it('keeps every vertex inside the impostor bound, the tree topping out near height 1', () => {
    for (const lod of [0, 1] as const) {
      createTreeGeometries(lod).forEach((g, s) => {
        const p = g.getAttribute('position');
        let worst = 0;
        let top = 0;
        for (let i = 0; i < p.count; i++) {
          worst = Math.max(worst, Math.hypot(p.getX(i), p.getY(i) - 0.5, p.getZ(i)));
          top = Math.max(top, p.getY(i));
        }
        expect(worst, `${SLOTS[s].key} lod ${lod}`).toBeLessThanOrEqual(TREE_BOUND_RADIUS);
        expect(top, `${SLOTS[s].key} lod ${lod}`).toBeGreaterThan(0.85);
        expect(top, `${SLOTS[s].key} lod ${lod}`).toBeLessThanOrEqual(1.03);
      });
    }
  });

  it('gives the palm its crown sway in the near material, and the era its own program key', () => {
    const shader = patchNear();
    expect(shader.defines.TREE_PALM).toBe(3);
    expect(shader.key).toBe('tree-near-v6-0-cretaceous');
    expect(shader.vertex).toContain('#ifdef TREE_PALM');
  });
});

describe('present-day trees (era code off)', () => {
  it('builds today’s four species, tints and near material', () => {
    setEra('present');
    expect(speciesTints()).toBe(SPECIES_TINT);
    const cards = createTreeGeometries(0).map((g) => g.userData.cards as number);
    expect(cards.length).toBe(4);
    const shader = patchNear();
    expect(shader.defines).toEqual({ TREE_LOD: 0 });
    expect(shader.key).toBe('tree-near-v6-0');
    expect(shader.vertex).not.toContain('TREE_PALM');
  });

  it('keeps today’s tree models and patched shaders byte for byte (hashes from before Deep Time)', () => {
    setEra('present');
    // Geometry: every attribute and index buffer of each species (userData, which gained a card count, is
    // left out). Materials: type, defines, program cache key, patched vertex and fragment text and the
    // uniforms the patch adds (textures by kind, not uuid). Taken at commit 2cdce84; a three.js upgrade that
    // changes ShaderLib moves the material hashes, which then need retaking on a pre-Deep-Time checkout.
    expect(presentTreeHashes()).toEqual({
      lod0: '8c673bc2',
      lod1: 'ad188453',
      proxies: 'd8cc6740',
      near0: '6d06d983',
      near1: '8a345959',
      proxyMain: '37d4d04c',
      proxyDepth: 'b21e918c',
      impostor: '97f2d485',
      impostorDepth: 'bb759d55',
    });
  });
});

function patchNear(): { defines: Record<string, unknown>; key: string; vertex: string } {
  const uniforms: TreeUniforms = {
    uTime: { value: 0 },
    uFade: { value: new THREE.Vector4() },
    uDensityRange: { value: 1 },
    uViewPos: { value: new THREE.Vector3() },
    uShadowRange: { value: 1 },
    uLodFade: { value: new THREE.Vector2() },
  };
  const mat = createNearTreeMaterial(new THREE.Texture(), uniforms, 0);
  const src = THREE.ShaderLib.standard;
  const shader = { uniforms: {}, vertexShader: src.vertexShader, fragmentShader: src.fragmentShader };
  (mat.onBeforeCompile as unknown as (s: typeof shader, r: unknown) => void)(shader, null);
  expect(shader.vertexShader).not.toContain('#include <begin_vertex>');
  return { defines: { ...mat.defines }, key: mat.customProgramCacheKey(), vertex: shader.vertexShader };
}

/** FNV-1a over a byte stream. */
class Fnv {
  h = 0x811c9dc5;
  bytes(b: Uint8Array): this {
    for (let i = 0; i < b.length; i++) this.h = Math.imul(this.h ^ b[i], 0x01000193) >>> 0;
    return this;
  }
  text(s: string): this {
    return this.bytes(new TextEncoder().encode(s));
  }
  hex(): string {
    return this.h.toString(16).padStart(8, '0');
  }
}

function geometryHash(geos: THREE.BufferGeometry[]): string {
  const f = new Fnv();
  for (const g of geos) {
    for (const name of Object.keys(g.attributes).sort()) {
      const a = g.getAttribute(name) as THREE.BufferAttribute;
      f.text(`${name}:${a.itemSize}:${a.count}`);
      f.bytes(new Uint8Array(a.array.buffer, a.array.byteOffset, a.array.byteLength));
    }
    const idx = g.getIndex();
    if (idx) f.bytes(new Uint8Array(idx.array.buffer, idx.array.byteOffset, idx.array.byteLength));
  }
  return f.hex();
}

const LIB: Record<string, string> = { MeshStandardMaterial: 'standard', MeshDepthMaterial: 'depth', MeshBasicMaterial: 'basic' };

function uniformsText(u: Record<string, { value: unknown }>): string {
  return JSON.stringify(Object.keys(u).sort().map((k) => [k, u[k].value instanceof THREE.Texture ? 'texture' : u[k].value]));
}

/** The patched shader text, defines, cache key and patch-added uniforms of a tree material. */
function materialHash(mat: THREE.Material): string {
  const src = THREE.ShaderLib[LIB[mat.type]];
  const shader = { uniforms: {} as Record<string, { value: unknown }>, vertexShader: src.vertexShader, fragmentShader: src.fragmentShader };
  (mat.onBeforeCompile as unknown as (s: typeof shader, r: unknown) => void)(shader, null);
  const m = mat as THREE.Material & { defines?: Record<string, unknown> };
  return new Fnv().text(mat.type).text(JSON.stringify(m.defines ?? {})).text(mat.customProgramCacheKey()).text(shader.vertexShader).text(shader.fragmentShader).text(uniformsText(shader.uniforms)).hex();
}

function presentTreeHashes(): Record<string, string> {
  const uniforms: TreeUniforms = {
    uTime: { value: 0 },
    uFade: { value: new THREE.Vector4() },
    uDensityRange: { value: 1 },
    uViewPos: { value: new THREE.Vector3() },
    uShadowRange: { value: 1 },
    uLodFade: { value: new THREE.Vector2() },
  };
  const tex = new THREE.Texture();
  const proxy = createShadowProxyMaterials(uniforms);
  return {
    lod0: geometryHash(createTreeGeometries(0)),
    lod1: geometryHash(createTreeGeometries(1)),
    proxies: geometryHash(createShadowProxies()),
    near0: materialHash(createNearTreeMaterial(tex, uniforms, 0)),
    near1: materialHash(createNearTreeMaterial(tex, uniforms, 1)),
    proxyMain: materialHash(proxy.main),
    proxyDepth: materialHash(proxy.depth),
    impostor: materialHash(createImpostorMaterial(tex, tex, uniforms)),
    impostorDepth: materialHash(createImpostorDepthMaterial(tex, uniforms)),
  };
}
