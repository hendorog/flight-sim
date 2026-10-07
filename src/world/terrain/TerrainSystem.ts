// The terrain subsystem: a CDLOD quadtree of mesh tiles out to 150 km, built in a pool of workers and
// uploaded a few per frame (more, within a time budget, while a backlog waits after a teleport), with
// geomorphing in the vertex shader, standing water per tile, a river ribbon, instanced forests
// (VegetationSystem) and 3D grass on the airfield near a low camera (AirfieldGrass).
//
// Every frame: pick the LOD metric's dz from the terrain around the camera, select the node set
// (quadtree.ts), show those meshes, queue the missing nodes nearest-first, integrate finished tiles,
// evict the least recently used ones beyond the memory budget.

import * as THREE from 'three';
import type { QualityLevel, SimContext, Subsystem } from '../../core/context';
import { findTownSite } from '../airport/valley';
import { terrainHeight } from './heightfield';
import { morphWindow, nodeKey, nodeSize, NodeRefPool, selectNodes, type LodSettings, type LodView, type NodeRef } from './quadtree';
import { CANOPY_HEIGHT, createTerrainDepthMaterial, createTerrainMaterial, MAX_LEVELS, setTerrainDebug, setTerrainDetail, type TerrainUniforms } from './terrainMaterial';
import { createTerrainTextures, type TerrainTextures } from './textures';
import { buildTileIndices, type TileData } from './tileBuilder';
import { AirfieldGrass } from './vegetation/grass';
import { VegetationSystem } from './vegetation/VegetationSystem';
import { setTownSite, townSite } from './townMask';
import { createRiverGeometry, createWaterGeometry, createWaterMaterial, type WaterUniforms } from './water';
import { WorkerPool } from './workerPool';

interface QualityPreset {
  grid: number;
  rangeFactor: number;
  /** Tile meshes kept resident beyond those in use. */
  spareNodes: number;
  /** Tiles integrated per frame (time slicing of GPU uploads). */
  uploadsPerFrame: number;
}

const PRESETS: Record<QualityLevel, QualityPreset> = {
  low: { grid: 32, rangeFactor: 3.5, spareNodes: 64, uploadsPerFrame: 4 },
  medium: { grid: 32, rangeFactor: 4.5, spareNodes: 96, uploadsPerFrame: 4 },
  high: { grid: 64, rangeFactor: 3.0, spareNodes: 96, uploadsPerFrame: 3 },
  ultra: { grid: 64, rangeFactor: 4.5, spareNodes: 128, uploadsPerFrame: 3 },
};

/** Size of a level-0 tile, m (2 m vertex spacing at grid 64). */
const LEAF_SIZE = 128;
/** Root tiles are 131 km across. */
const ROOT_LEVEL = 10;
/** Terrain is drawn to this distance, m. */
export const TERRAIN_MAX_DISTANCE = 150_000;

interface TerrainNode {
  mesh: THREE.Mesh;
  water: THREE.Mesh | null;
  lastUsed: number;
}

export interface TerrainSystemOptions {
  /** Number of tile workers; default: hardware threads - 2, clamped to 2..8. */
  workers?: number;
  /** Disable the instanced trees (the ground still shows forest). */
  vegetation?: boolean;
  /** Keep land cover off the airport module's valley town (default true). */
  town?: boolean;
}

export class TerrainSystem implements Subsystem {
  /** Everything the terrain draws lives under this group. */
  readonly root = new THREE.Group();
  private readonly tileGroup = new THREE.Group();
  private readonly waterGroup = new THREE.Group();
  private pool!: WorkerPool;
  private settings!: LodSettings;
  private preset!: QualityPreset;
  private textures!: TerrainTextures;
  private material!: THREE.MeshStandardMaterial;
  private depthMaterial!: THREE.MeshDepthMaterial;
  private waterMaterial!: THREE.MeshStandardMaterial;
  private riverMaterial!: THREE.MeshStandardMaterial;
  private river!: THREE.Mesh;
  private indices!: THREE.BufferAttribute;
  private vegetation: VegetationSystem | null = null;
  private grass: AirfieldGrass | null = null;
  private readonly nodes = new Map<number, TerrainNode>();
  private readonly inflight = new Set<number>();
  private readonly arrived: TileData[] = [];
  private arrivalWaiter: (() => void) | null = null;
  private shown: TerrainNode[] = [];
  private readonly draw: NodeRef[] = [];
  private readonly want: NodeRef[] = [];
  /** Marks each node the selection keeps (drawn, an ancestor or prefetched) as used this frame; counts them. */
  private keptCount = 0;
  private readonly keep = {
    add: (key: number): void => {
      const n = this.nodes.get(key);
      if (n && n.lastUsed !== this.frame) {
        n.lastUsed = this.frame;
        this.keptCount++;
      }
    },
  };
  private readonly refPool = new NodeRefPool();
  private readonly view: LodView = { east: 0, north: 0, dz: 0 };
  private dzAge = Infinity;
  private readonly dzAt = new THREE.Vector3(Infinity, 0, 0);
  private frame = 0;
  private generation = 0;
  private readonly unsubscribe: Array<() => void> = [];
  private uploader: GeometryUploader | null = null;

  readonly uniforms: TerrainUniforms = {
    uMorph: { value: Array.from({ length: MAX_LEVELS }, () => new THREE.Vector2(1e9, 1)) },
    uSkirt: { value: new Array<number>(MAX_LEVELS).fill(0) },
    uLodCenter: { value: new THREE.Vector3() },
    // Without tree meshes the canopy shell stands at every distance.
    uForestFade: { value: new THREE.Vector2(0, 1) },
    // Without impostors the canopy shell is the whole canopy at every distance (w = 0).
    uCanopyKeep: { value: new THREE.Vector4(0, 0, 0, 0) },
    uViewPos: { value: new THREE.Vector3() },
  };
  readonly waterUniforms: WaterUniforms = {
    uTime: { value: 0 },
    uSkyColor: { value: new THREE.Color(0.3, 0.45, 0.8) },
    uHazeColor: { value: new THREE.Color(0.7, 0.78, 0.88) },
  };

  constructor(private readonly options: TerrainSystemOptions = {}) {
    this.root.name = 'terrain';
    this.tileGroup.name = 'terrain-tiles';
    this.waterGroup.name = 'terrain-water';
    this.root.add(this.tileGroup, this.waterGroup);
  }

  /** How long each part of init() took, ms (diagnostics). */
  readonly initTiming = { textures: 0, vegetation: 0, tiles: 0, trees: 0, tilesBuilt: 0 };

  async init(ctx: SimContext): Promise<void> {
    let t0 = performance.now();
    const lap = (): number => {
      const t = performance.now();
      const d = t - t0;
      t0 = t;
      return Math.round(d);
    };
    const threads = navigator.hardwareConcurrency || 4;
    this.pool = new WorkerPool(this.options.workers ?? Math.min(8, Math.max(2, threads - 2)));
    // Keep woodland and crop fields off the valley town (the airport module builds it on the site
    // findTownSite picks for this terrain); the workers need it before their first job.
    if (this.options.town !== false) setTownSite(findTownSite(terrainHeight));
    this.pool.broadcast({ kind: 'setup', town: townSite() });
    this.uploader = new GeometryUploader(ctx.renderer);
    this.textures = createTerrainTextures(ctx.renderer);
    this.material = createTerrainMaterial(this.textures, this.uniforms);
    this.depthMaterial = createTerrainDepthMaterial(this.uniforms);
    this.waterMaterial = createWaterMaterial(this.textures.noise, this.waterUniforms, false);
    this.riverMaterial = createWaterMaterial(this.textures.noise, this.waterUniforms, true);
    this.river = new THREE.Mesh(createRiverGeometry(), this.riverMaterial);
    this.river.name = 'river';
    this.waterGroup.add(this.river);
    ctx.scene.add(this.root);
    this.precompileWater(ctx);

    this.applyQuality(ctx.quality);
    this.unsubscribe.push(ctx.events.on('qualityChanged', (e) => this.applyQuality(e.quality)));

    await this.textures.ready;
    this.initTiming.textures = lap();
    if (this.options.vegetation !== false) {
      this.vegetation = new VegetationSystem(this.pool, this.uniforms.uForestFade.value, this.uniforms.uCanopyKeep.value);
      await this.vegetation.init(ctx);
      this.root.add(this.vegetation.root);
      this.grass = new AirfieldGrass();
      this.grass.setQuality(ctx.quality);
      this.root.add(this.grass.mesh);
    }
    this.initTiming.vegetation = lap();
    await this.preload(ctx.camera);
    this.initTiming.tiles = lap();
    this.initTiming.tilesBuilt = this.nodes.size;
    if (this.vegetation) await this.vegetation.preload(ctx);
    this.initTiming.trees = lap();
  }

  update(dt: number, ctx: SimContext): void {
    this.frame++;
    this.updateView(ctx.camera, dt);
    this.select();
    this.request();
    this.integrate(this.preset.uploadsPerFrame);
    this.evict();
    this.uploader?.flush();
    this.waterUniforms.uTime.value += dt;
    this.waterUniforms.uSkyColor.value.copy(ctx.sky.skyColor);
    this.waterUniforms.uHazeColor.value.copy(ctx.sky.hazeColor);
    this.vegetation?.update(dt, ctx);
    this.grass?.update(dt, ctx.camera);
  }

  dispose(): void {
    for (const u of this.unsubscribe) u();
    this.clearNodes();
    this.vegetation?.dispose();
    this.grass?.dispose();
    this.pool.dispose();
    this.uploader?.dispose();
    this.textures.dispose();
    this.material.dispose();
    this.depthMaterial.dispose();
    this.waterMaterial.dispose();
    this.riverMaterial.dispose();
    this.river.geometry.dispose();
    this.root.removeFromParent();
  }

  /**
   * Tiles selected / resident / being built, tree instances as meshes / impostors, and the LOD distance of
   * the nearest tile the current view needs but does not have yet (Infinity when nothing is missing).
   */
  get stats(): { drawn: number; resident: number; inflight: number; trees: number; impostors: number; nearestMissing: number } {
    const v = this.vegetation?.stats;
    let nearestMissing = Infinity;
    for (const w of this.want) nearestMissing = Math.min(nearestMissing, w.dist);
    return {
      drawn: this.draw.length,
      resident: this.nodes.size,
      inflight: this.inflight.size,
      trees: v?.near ?? 0,
      impostors: v?.impostors ?? 0,
      nearestMissing,
    };
  }

  /** Terrain debug view (see setTerrainDebug in terrainMaterial.ts); 0 = normal shading. */
  setDebugView(mode: number): void {
    setTerrainDebug(this.material, mode);
  }

  /**
   * Compile the standing-water program against the real scene (its lights and shadows decide the program
   * variant); otherwise the first lake or sea tile to appear would stall a frame on shader compilation.
   */
  private precompileWater(ctx: SimContext): void {
    const g = new THREE.PlaneGeometry(1, 1);
    g.setAttribute('aDepth', new THREE.Float32BufferAttribute([1, 1, 1, 1], 1));
    const probe = new THREE.Mesh(g, this.waterMaterial);
    this.waterGroup.add(probe);
    ctx.renderer.compile(ctx.scene, ctx.camera);
    probe.removeFromParent();
    g.dispose();
  }

  private applyQuality(q: QualityLevel): void {
    this.preset = PRESETS[q];
    setTerrainDetail(this.material, q === 'low' ? 0 : 1);
    this.grass?.setQuality(q);
    const s: LodSettings = {
      grid: this.preset.grid,
      leafSize: LEAF_SIZE,
      rootLevel: ROOT_LEVEL,
      rangeFactor: this.preset.rangeFactor,
      maxDistance: TERRAIN_MAX_DISTANCE,
    };
    if (this.settings && this.settings.grid === s.grid && this.settings.rangeFactor === s.rangeFactor) return;
    this.settings = s;
    for (let l = 0; l < MAX_LEVELS; l++) {
      const [a, b] = l <= ROOT_LEVEL ? morphWindow(s, l) : [1e9, 2e9];
      this.uniforms.uMorph.value[l].set(a, 1 / (b - a));
      // Skirts hang a few lattice spacings: enough to cover any residual gap, short enough to stay hidden.
      this.uniforms.uSkirt.value[l] = 2 + 3 * (nodeSize(s, l) / s.grid);
    }
    if (this.indices) this.clearNodes();
    this.indices = new THREE.BufferAttribute(buildTileIndices(s.grid), 1);
    this.generation++;
    this.vegetation?.setQuality(q);
  }

  private clearNodes(): void {
    for (const n of this.nodes.values()) this.destroyNode(n);
    this.nodes.clear();
    this.shown = [];
    this.inflight.clear();
    this.arrived.length = 0;
  }

  /** Camera position for the LOD metric, and dz = camera height above the highest terrain within 1.5 km. */
  private updateView(camera: THREE.Camera, dt: number): void {
    const p = camera.position;
    this.view.east = p.x;
    this.view.north = -p.z;
    this.dzAge += dt;
    if (this.dzAge > 0.25 || p.distanceToSquared(this.dzAt) > 200 * 200) {
      let maxH = -Infinity;
      for (let j = -2; j <= 2; j++)
        for (let i = -2; i <= 2; i++) maxH = Math.max(maxH, terrainHeight(this.view.north + j * 750, this.view.east + i * 750));
      this.view.dz = Math.max(0, p.y - maxH);
      this.dzAge = 0;
      this.dzAt.copy(p);
    }
    this.uniforms.uLodCenter.value.set(p.x, this.view.dz, p.z);
    this.uniforms.uViewPos.value.copy(p);
  }

  private readonly isReady = (k: number): boolean => this.nodes.has(k);

  private select(): void {
    this.draw.length = 0;
    this.want.length = 0;
    this.keptCount = 0;
    selectNodes(this.settings, this.view, this.isReady, this.draw, this.want, this.keep, this.refPool);
    for (const n of this.shown) {
      n.mesh.visible = false;
      if (n.water) n.water.visible = false;
    }
    this.shown.length = 0;
    for (const ref of this.draw) {
      const n = this.nodes.get(ref.key)!;
      n.mesh.visible = true;
      if (n.water) n.water.visible = true;
      this.shown.push(n);
    }
  }

  private request(): void {
    if (this.want.length === 0) return;
    this.want.sort(byDistance);
    // Leave two slots for tree cells while any are missing, so forests appear while tiles still stream.
    let slots = this.pool.freeSlots - (this.vegetation && this.vegetation.missingCells > 0 ? 2 : 0);
    for (const ref of this.want) {
      if (slots <= 0) break;
      // (The ref is recycled by the next selection: keep only its key past this frame.)
      const key = ref.key;
      if (this.inflight.has(key)) continue;
      this.inflight.add(key);
      slots--;
      const gen = this.generation;
      this.pool
        .run({ kind: 'tile', req: { level: ref.level, ix: ref.ix, iz: ref.iz, grid: this.settings.grid, leafSize: LEAF_SIZE } })
        .then((r) => {
          if (gen !== this.generation) return;
          this.inflight.delete(key);
          this.arrived.push(r as TileData);
          this.arrivalWaiter?.();
        })
        .catch(() => undefined);
    }
  }

  /**
   * Turn finished tiles into meshes: at least `min` per frame, more while a backlog waits (after a teleport
   * or quality change) within a small time budget, so detail comes back in a second or two without a hitch.
   */
  private integrate(min: number, budgetMs = 1.5): void {
    // Nearest-first would need re-sorting; arrival order already follows request priority.
    const t0 = performance.now();
    let n = 0;
    while (n < this.arrived.length && (n < min || performance.now() - t0 < budgetMs)) this.addNode(this.arrived[n++]);
    this.arrived.splice(0, n);
  }

  private addNode(d: TileData): void {
    const key = nodeKey(d.level, d.ix, d.iz);
    if (this.nodes.has(key)) return;
    const size = nodeSize(this.settings, d.level);
    const g = new THREE.BufferGeometry();
    g.setIndex(this.indices);
    // The vertex data is only ever read by the GPU: each array is released once uploaded (bounds below
    // are computed from the tile's height range, not the positions).
    g.setAttribute('position', gpuOnly(new THREE.BufferAttribute(d.positions, 3)));
    g.setAttribute('aNormals', gpuOnly(new THREE.BufferAttribute(d.normals, 4, true)));
    g.setAttribute('aMorph', gpuOnly(new THREE.BufferAttribute(d.morph, 1)));
    g.setAttribute('aBiome', gpuOnly(new THREE.BufferAttribute(d.biome, 4, true)));
    g.setAttribute('aShape', gpuOnly(new THREE.BufferAttribute(d.shape, 4, true)));
    g.setAttribute('aRiver', gpuOnly(new THREE.BufferAttribute(d.river, 2, false)));
    // Bounds include the geomorph range (coarse targets never leave the node's height span by much).
    const pad = 4 + this.uniforms.uSkirt.value[d.level];
    g.boundingBox = new THREE.Box3(new THREE.Vector3(0, d.minHeight - pad, -size), new THREE.Vector3(size, d.maxHeight + 4 + CANOPY_HEIGHT, 0));
    g.boundingSphere = g.boundingBox.getBoundingSphere(new THREE.Sphere());
    const mesh = new THREE.Mesh(g, this.material);
    mesh.name = `tile ${key}`;
    mesh.position.set(d.ix * size, 0, -d.iz * size);
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    mesh.customDepthMaterial = this.depthMaterial;
    mesh.visible = false;
    this.tileGroup.add(mesh);
    this.uploader?.add(g);

    let water: THREE.Mesh | null = null;
    if (d.water) {
      const wg = createWaterGeometry(d.water);
      for (const a of Object.values(wg.attributes)) gpuOnly(a as THREE.BufferAttribute);
      if (wg.index) gpuOnly(wg.index);
      // Bounds from the water surface itself: over a lake bed the surface lies above all the ground.
      let top = -Infinity;
      for (let i = 1; i < d.water.positions.length; i += 3) top = Math.max(top, d.water.positions[i]);
      wg.boundingBox = new THREE.Box3(new THREE.Vector3(0, top - 1, -size), new THREE.Vector3(size, top + 1, 0));
      wg.boundingSphere = wg.boundingBox.getBoundingSphere(new THREE.Sphere());
      water = new THREE.Mesh(wg, this.waterMaterial);
      water.name = `water ${key}`;
      water.position.copy(mesh.position);
      water.matrixAutoUpdate = false;
      water.updateMatrix();
      water.receiveShadow = true;
      water.visible = false;
      this.waterGroup.add(water);
      this.uploader?.add(wg);
    }
    this.nodes.set(key, { mesh, water, lastUsed: this.frame });
  }

  private destroyNode(n: TerrainNode): void {
    n.mesh.removeFromParent();
    n.mesh.geometry.dispose();
    if (n.water) {
      n.water.removeFromParent();
      n.water.geometry.dispose();
    }
  }

  private evict(): void {
    const budget = this.keptCount + this.preset.spareNodes;
    if (this.nodes.size <= budget) return;
    const idle: Array<[number, TerrainNode]> = [];
    for (const e of this.nodes) if (e[1].lastUsed !== this.frame) idle.push(e);
    idle.sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    for (let i = 0; i < idle.length && this.nodes.size > budget; i++) {
      this.destroyNode(idle[i][1]);
      this.nodes.delete(idle[i][0]);
    }
  }

  /** Build everything the current view needs before the first frame (used by init). */
  private async preload(camera: THREE.Camera): Promise<void> {
    const t0 = performance.now();
    for (;;) {
      this.updateView(camera, 1);
      this.select();
      if (this.want.length === 0 && this.inflight.size === 0 && this.arrived.length === 0) break;
      if (performance.now() - t0 > 30_000) {
        console.warn('[terrain] preload timed out');
        break;
      }
      this.request();
      if (this.arrived.length === 0) await new Promise<void>((r) => (this.arrivalWaiter = r));
      this.arrivalWaiter = null;
      this.integrate(Infinity, Infinity);
      this.uploader?.flush();
    }
  }
}

const byDistance = (a: NodeRef, b: NodeRef): number => a.dist - b.dist;

/** Drop an attribute's CPU copy once three has uploaded it. */
function gpuOnly(a: THREE.BufferAttribute): THREE.BufferAttribute {
  return a.onUpload(releaseArray);
}
function releaseArray(this: THREE.BufferAttribute): void {
  (this as { array: unknown }).array = null;
}

/**
 * Uploads new tile geometry to the GPU as soon as it is built, so its CPU arrays (gpuOnly) are released
 * at once. three uploads a geometry only when it is first drawn, and many resident tiles are never drawn
 * for a long time (the quadtree keeps every ancestor of the drawn nodes, prefetched children and nodes
 * outside the view), which otherwise left tens of MB of vertex arrays on the JS heap. The geometries are
 * drawn once into a 1x1 target with every vertex clipped, which costs a draw call per tile and nothing else.
 */
class GeometryUploader {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera();
  private readonly target = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false });
  private readonly material = new THREE.ShaderMaterial({
    vertexShader: 'void main() { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); }',
    fragmentShader: 'void main() { gl_FragColor = vec4(0.0); }',
    depthTest: false,
    depthWrite: false,
    colorWrite: false,
  });
  private readonly meshes: THREE.Mesh[] = [];
  private pending = 0;

  constructor(private readonly renderer: THREE.WebGLRenderer) {
    this.scene.matrixWorldAutoUpdate = false;
  }

  add(g: THREE.BufferGeometry): void {
    let m = this.meshes[this.pending];
    if (!m) {
      m = new THREE.Mesh(g, this.material);
      m.frustumCulled = false;
      m.matrixAutoUpdate = false;
      this.meshes.push(m);
      this.scene.add(m);
    }
    m.geometry = g;
    m.visible = true;
    this.pending++;
  }

  flush(): void {
    if (this.pending === 0) return;
    const r = this.renderer;
    const prevTarget = r.getRenderTarget();
    const prevAutoClear = r.autoClear;
    r.autoClear = false;
    r.setRenderTarget(this.target);
    r.render(this.scene, this.camera);
    r.setRenderTarget(prevTarget);
    r.autoClear = prevAutoClear;
    // Drop the references so evicted tiles are not kept alive here.
    for (const m of this.meshes) {
      m.visible = false;
      m.geometry = EMPTY_GEOMETRY;
    }
    this.pending = 0;
  }

  dispose(): void {
    this.target.dispose();
    this.material.dispose();
  }
}

const EMPTY_GEOMETRY = new THREE.BufferGeometry();
