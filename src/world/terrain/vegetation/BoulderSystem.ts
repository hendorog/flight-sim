// Boulder fields along fast water (vegetation/boulders.ts places them per 256 m cell in the terrain workers). Only the
// cells near the viewer are kept, and only the nearest stones within a hard budget are drawn: a few shared low-poly
// rock shapes, one instanced draw each, in two tiers - the nearest casting shadows, the rest not. The lists are
// rebuilt when the viewer has moved NEAR_REBUILD or cells arrived; stones shrink away over the last fifth of the
// drawn range (of the range the budget leaves), so none pops in or out. A seeded world only (TerrainSystem creates it
// when the world has flow data); ?boulders=0 switches it off (for measuring its cost).

import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { QualityLevel, SimContext } from '../../../core/context';
import type { WorkerPool } from '../workerPool';
import { BOULDER_SHAPES, BOULDER_STRIDE, type BoulderCellData } from './boulders';
import { PALETTES } from '../eraPalette';
import { era } from '../../era/eraState';
import { hash2i } from '../noise';

interface BoulderPreset {
  /** Stones are drawn to this distance, m (3D, from the viewer). */
  range: number;
  /** Most stones drawn. */
  budget: number;
  /** Stones within this distance cast shadows, m. */
  shadowRange: number;
}

const PRESETS: Record<QualityLevel, BoulderPreset> = {
  low: { range: 300, budget: 1200, shadowRange: 0 },
  medium: { range: 420, budget: 2000, shadowRange: 120 },
  high: { range: 560, budget: 3500, shadowRange: 220 },
  ultra: { range: 750, budget: 6000, shadowRange: 320 },
};

const CELL = 256;
/** Rebuild the lists after the viewer has moved this far, m (a rebuild is 0.5-1.5 ms here, about 3 ms at a 4x slower CPU). */
const NEAR_REBUILD = 40;
/**
 * A stone is drawn out to this many times its (shown) radius, m: about two pixels across at 1600 pixels over a 60
 * degree view, so cobbles only near and the big blocks to the full range.
 */
const SIZE_RANGE = 900;
/** Most cell jobs in flight at once (tiles and trees go first). */
const MAX_INFLIGHT = 2;

/** `?boulders=0` switches the boulders off. */
export function bouldersEnabled(): boolean {
  if (typeof location === 'undefined') return true;
  return new URLSearchParams(location.search).get('boulders') !== '0';
}

interface Cell {
  cx: number;
  cz: number;
  data: BoulderCellData | null;
}

const cellKey = (cx: number, cz: number): number => (cx + 1048576) * 2097152 + (cz + 1048576);

function cellDistance(cx: number, cz: number, east: number, north: number): number {
  const e0 = cx * CELL;
  const n0 = cz * CELL;
  const de = east < e0 ? e0 - east : east > e0 + CELL ? east - e0 - CELL : 0;
  const dn = north < n0 ? n0 - north : north > n0 + CELL ? north - n0 - CELL : 0;
  return Math.sqrt(de * de + dn * dn);
}

/** A GLSL vec3 literal of the palette (linear albedo) as numbers. */
function vec3Of(glsl: string): [number, number, number] {
  const m = glsl.replace(/^\s*vec3\s*\(/, '').match(/-?\d*\.?\d+/g) ?? ['0.1', '0.1', '0.1'];
  return [Number(m[0]), Number(m[1]), Number(m[2])];
}

/**
 * A rock shape: an icosphere (80 faces) pushed in and out by hashed lattice noise into a lumpy stone, some flattened
 * faces (cleavage planes), its lower part a little narrower; vertex colours darken its foot (damp, where it sits in
 * the ground) and add a faint mottle. y spans about -1..1.
 */
function rockGeometry(k: number): THREE.BufferGeometry {
  let g: THREE.BufferGeometry = new THREE.IcosahedronGeometry(1, 1);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  // Four to six cleavage planes per shape, cut close: a block with faces and edges, not an egg.
  const planes: Array<[THREE.Vector3, number]> = [];
  for (let c = 0; c < 4 + (k % 3); c++) {
    const h = hash2i(k * 31 + c, 77);
    const a = ((h & 0xffff) / 65536) * Math.PI * 2;
    const b = (((h >>> 16) & 0xffff) / 65536) * 1.2 - 0.4;
    planes.push([new THREE.Vector3(Math.cos(a) * Math.cos(b), Math.sin(b), Math.sin(a) * Math.cos(b)), 0.55 + 0.2 * ((hash2i(k, c + 9) & 0xff) / 255)]);
  }
  const colors = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const h = hash2i(Math.round(v.x * 1000) + k * 7, Math.round(v.y * 1000) * 3 + Math.round(v.z * 1000));
    let r = 0.82 + 0.3 * ((h & 0xffff) / 65536);
    v.multiplyScalar(r);
    for (const [n, d] of planes) {
      const t = v.dot(n);
      if (t > d) v.addScaledVector(n, d - t);
    }
    if (v.y < 0) v.set(v.x * (1 + 0.25 * v.y), v.y, v.z * (1 + 0.25 * v.y));
    p.setXYZ(i, v.x, v.y, v.z);
    r = 0.88 + 0.24 * (((h >>> 16) & 0xffff) / 65536);
    const foot = 0.55 + 0.45 * THREE.MathUtils.smoothstep(v.y, -0.6, 0.1);
    colors[i * 3] = r * foot;
    colors[i * 3 + 1] = r * foot;
    colors[i * 3 + 2] = r * foot * 0.97;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/** One instanced draw of one shape in one tier. */
class Tier {
  readonly mesh: THREE.InstancedMesh;
  count = 0;
  constructor(geometry: THREE.BufferGeometry, material: THREE.Material, capacity: number, shadows: boolean, name: string) {
    this.mesh = new THREE.InstancedMesh(geometry, material, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, new THREE.Color(1, 1, 1));
    this.mesh.instanceColor!.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.castShadow = shadows;
    this.mesh.receiveShadow = true;
    this.mesh.name = name;
  }
}

export class BoulderSystem {
  readonly root = new THREE.Group();
  private preset: BoulderPreset = PRESETS.high;
  private readonly cells = new Map<number, Cell>();
  private geometries: THREE.BufferGeometry[] = [];
  private material!: THREE.MeshStandardMaterial;
  /** tiers[shadow ? 1 : 0][shape]. */
  private tiers: Tier[][] = [[], []];
  private readonly last = new THREE.Vector3(Infinity, 0, 0);
  private changed = false;
  private inflight = 0;
  private generation = 0;
  private camCx = NaN;
  private camCz = NaN;
  private scanDirty = true;
  private readonly rockA: [number, number, number];
  private readonly rockB: [number, number, number];
  /** Diagnostics: stones drawn (and in shadow tier), held in cells, last rebuild's CPU time (ms). */
  readonly stats = { drawn: 0, shadowed: 0, held: 0, cells: 0, rebuildMs: 0, range: 0 };
  // Scratch.
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly pos = new THREE.Vector3();
  private readonly scl = new THREE.Vector3();
  private readonly col = new THREE.Color();
  /** Rebuild candidates: each one's cell data, offset in it, distance; and the order they are written in. */
  private readonly src: Float32Array[] = [];
  private readonly off: number[] = [];
  private readonly dist: number[] = [];
  private readonly order: number[] = [];
  private readonly byDistance = (x: number, y: number): number => this.dist[x] - this.dist[y];

  constructor(private readonly pool: WorkerPool) {
    this.root.name = 'boulders';
    const P = PALETTES[era().palette];
    this.rockA = vec3Of(P.rockA);
    this.rockB = vec3Of(P.rockB);
  }

  init(quality: QualityLevel): void {
    for (let k = 0; k < BOULDER_SHAPES; k++) this.geometries.push(rockGeometry(k));
    // Grey-brown rock as the terrain's (eraPalette rockA..rockB), its tone and wetness per stone (instance colour).
    this.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0, name: 'boulders' });
    // Mottled in world space (no texture): blotches and grain, the joints darker, lichen-pale on the tops of the dry
    // stones (the instance colour's brightness says how dry a stone is).
    this.material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vRockPos;\nvarying vec3 vRockN;')
        .replace(
          '#include <worldpos_vertex>',
          '#include <worldpos_vertex>\nvRockPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;\nvRockN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal);',
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
varying vec3 vRockPos;
varying vec3 vRockN;
float rockHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float rockNoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(rockHash(i), rockHash(i + vec3(1, 0, 0)), f.x), mix(rockHash(i + vec3(0, 1, 0)), rockHash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(rockHash(i + vec3(0, 0, 1)), rockHash(i + vec3(1, 0, 1)), f.x), mix(rockHash(i + vec3(0, 1, 1)), rockHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}`,
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
{
  float big = rockNoise(vRockPos * 0.9);
  float fine = rockNoise(vRockPos * 4.3 + 7.1);
  diffuseColor.rgb *= 0.72 + 0.4 * big + 0.22 * (fine - 0.5);
  float dry = smoothstep(0.06, 0.12, dot(vColor.rgb, vec3(0.333)));
  float lichen = smoothstep(0.35, 0.8, vRockN.y) * smoothstep(0.55, 0.75, rockNoise(vRockPos * 2.1 + 3.3)) * dry;
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.2, 0.2, 0.17), lichen * 0.5);
}`,
        );
    };
    this.material.customProgramCacheKey = () => 'boulders-v1';
    this.setQuality(quality);
  }

  setQuality(q: QualityLevel): void {
    this.preset = PRESETS[q];
    for (const t of this.tiers.flat()) {
      t.mesh.removeFromParent();
      t.mesh.dispose();
    }
    this.tiers = [[], []];
    const cap = this.preset.budget;
    for (const shadow of [0, 1]) {
      for (let k = 0; k < BOULDER_SHAPES; k++) {
        const t = new Tier(this.geometries[k], this.material, cap, shadow === 1, `boulders-${shadow ? 'near' : 'far'}-${k}`);
        this.tiers[shadow].push(t);
        this.root.add(t.mesh);
      }
    }
    this.last.set(Infinity, 0, 0);
    this.scanDirty = true;
  }

  update(camera: THREE.Camera): void {
    const cam = camera.position;
    this.stream(cam);
    if (this.changed || cam.distanceToSquared(this.last) > NEAR_REBUILD * NEAR_REBUILD) this.rebuild(cam);
  }

  /** Request missing cells nearest first (a few at a time, behind the terrain's own jobs); drop far ones. */
  private stream(cam: THREE.Vector3): void {
    const east = cam.x;
    const north = -cam.z;
    const range = this.preset.range + NEAR_REBUILD;
    const ccx = Math.floor(east / CELL);
    const ccz = Math.floor(north / CELL);
    if (ccx !== this.camCx || ccz !== this.camCz) {
      this.camCx = ccx;
      this.camCz = ccz;
      this.scanDirty = true;
      for (const [k, c] of this.cells) {
        if (cellDistance(c.cx, c.cz, east, north) > range + 2 * CELL) {
          this.cells.delete(k);
          this.changed = true;
        }
      }
    }
    if (!this.scanDirty) return;
    // Only when the terrain leaves a worker slot free; next frame again otherwise.
    if (this.pool.freeSlots < 2 || this.inflight >= MAX_INFLIGHT) return;
    const r = Math.ceil(range / CELL);
    let bestD = Infinity;
    let bx = 0;
    let bz = 0;
    let missing = 0;
    for (let cz = ccz - r; cz <= ccz + r; cz++)
      for (let cx = ccx - r; cx <= ccx + r; cx++) {
        const d = cellDistance(cx, cz, east, north);
        if (d > range || this.cells.has(cellKey(cx, cz))) continue;
        missing++;
        if (d < bestD) {
          bestD = d;
          bx = cx;
          bz = cz;
        }
      }
    if (missing === 0) {
      this.scanDirty = false;
      return;
    }
    this.request(bx, bz);
  }

  private request(cx: number, cz: number): void {
    const key = cellKey(cx, cz);
    const cell: Cell = { cx, cz, data: null };
    this.cells.set(key, cell);
    this.inflight++;
    const gen = this.generation;
    this.pool
      .run({ kind: 'boulders', req: { cx, cz, size: CELL } })
      .then((res) => {
        if (gen === this.generation) this.inflight--;
        if (gen !== this.generation || this.cells.get(key) !== cell) return;
        cell.data = res as BoulderCellData;
        if (cell.data.count > 0) this.changed = true;
        this.scanDirty = true;
      })
      .catch(() => {
        if (gen === this.generation) {
          this.inflight = Math.max(0, this.inflight - 1);
          if (this.cells.get(key) === cell) {
            this.cells.delete(key);
            this.scanDirty = true;
          }
        }
      });
  }

  /** Write the nearest stones (within the range and the budget) into the instance lists. */
  private rebuild(cam: THREE.Vector3): void {
    const t0 = performance.now();
    this.changed = false;
    this.last.copy(cam);
    const { range, budget, shadowRange } = this.preset;
    const east = cam.x;
    const north = -cam.z;
    // Candidates within range (3D distance to the stone).
    let n = 0;
    let held = 0;
    let cells = 0;
    for (const c of this.cells.values()) {
      if (!c.data) continue;
      cells++;
      held += c.data.count;
      if (c.data.count === 0 || cellDistance(c.cx, c.cz, east, north) > range + 10) continue;
      const a = c.data.boulders;
      for (let i = 0; i < c.data.count; i++) {
        const o = i * BOULDER_STRIDE;
        const de = a[o] - east;
        const dn = a[o + 2] - north;
        const dy = a[o + 1] - cam.y;
        const d = Math.sqrt(de * de + dn * dn + dy * dy);
        // (A small stone only near: drawn while it spans more than a pixel or two.)
        if (d > range || d > a[o + 9] * SIZE_RANGE) continue;
        this.src[n] = a;
        this.off[n] = o;
        this.dist[n] = d;
        this.order[n] = n;
        n++;
      }
    }
    // Over budget: the nearest `budget` (their range shrinks to the farthest of them).
    let use = n;
    let reach = range;
    this.order.length = n;
    if (n > budget) {
      this.order.sort(this.byDistance);
      use = budget;
      reach = this.dist[this.order[budget - 1]];
    }
    const fade0 = reach * 0.8;
    const counts = [new Array<number>(BOULDER_SHAPES).fill(0), new Array<number>(BOULDER_SHAPES).fill(0)];
    const [ra, ga, ba] = this.rockA;
    const [rb, gb, bb] = this.rockB;
    let shadowed = 0;
    for (let j = 0; j < use; j++) {
      const w = this.order[j];
      const a = this.src[w];
      const o = this.off[w];
      const d = this.dist[w];
      // Shrinking away over the last fifth of its own range (the budget's, or its size's).
      const own = Math.min(reach, a[o + 9] * SIZE_RANGE);
      const fade = d <= own * 0.8 ? 1 : Math.max(0, 1 - (d - own * 0.8) / (own * 0.2));
      if (fade <= 0.02) continue;
      const r = a[o + 3] * fade;
      const hy = a[o + 4] * fade;
      const yaw = a[o + 5];
      const shapeTone = a[o + 6];
      const shape = Math.min(BOULDER_SHAPES - 1, Math.floor(shapeTone));
      const tone = shapeTone - shape;
      const wet = a[o + 7];
      const tier = d < shadowRange ? 1 : 0;
      if (tier) shadowed++;
      const t = this.tiers[tier][shape];
      const k = counts[tier][shape]++;
      // Its centre over the ground (sunk into it, or a rock in the water reaching up from the bed), a small tilt (none
      // for a tall block standing in the water: it would lean out of its collar of foam).
      const squash = hy / Math.max(1e-3, r);
      this.pos.set(a[o], a[o + 1] + a[o + 8] * fade, -a[o + 2]);
      const tilt = squash > 1.05 ? 0.15 : 1;
      this.e.set((tone - 0.5) * 0.3 * tilt, yaw, (Math.min(1, squash) - 0.7) * 0.4 * tilt);
      this.q.setFromEuler(this.e);
      this.scl.set(r * (0.85 + 0.3 * tone * tilt), hy, r * (1.15 - 0.3 * tone * tilt));
      this.m.compose(this.pos, this.q, this.scl);
      t.mesh.setMatrixAt(k, this.m);
      // Tone between the palette's rock colours; darker where it is wet (in and by the water).
      const dark = 1 - 0.45 * wet;
      this.col.setRGB((ra + (rb - ra) * tone) * dark, (ga + (gb - ga) * tone) * dark, (ba + (bb - ba) * tone) * dark, THREE.LinearSRGBColorSpace);
      t.mesh.setColorAt(k, this.col);
    }
    let drawn = 0;
    for (const tier of [0, 1]) {
      this.tiers[tier].forEach((t, s) => {
        const c = counts[tier][s];
        t.count = c;
        t.mesh.count = c;
        drawn += c;
        if (c > 0) {
          t.mesh.instanceMatrix.clearUpdateRanges();
          t.mesh.instanceMatrix.addUpdateRange(0, c * 16);
          t.mesh.instanceMatrix.needsUpdate = true;
          t.mesh.instanceColor!.clearUpdateRanges();
          t.mesh.instanceColor!.addUpdateRange(0, c * 3);
          t.mesh.instanceColor!.needsUpdate = true;
          t.mesh.computeBoundingSphere();
        }
      });
    }
    this.stats.drawn = drawn;
    this.stats.shadowed = shadowed;
    this.stats.held = held;
    this.stats.cells = cells;
    this.stats.range = reach;
    this.stats.rebuildMs = performance.now() - t0;
    this.src.length = 0;
  }

  dispose(): void {
    this.generation++;
    for (const t of this.tiers.flat()) t.mesh.dispose();
    for (const g of this.geometries) g.dispose();
    this.material?.dispose();
    this.root.removeFromParent();
  }
}
