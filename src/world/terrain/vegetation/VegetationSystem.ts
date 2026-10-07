// Instanced forests. Tree positions are generated per 256 m cell in the terrain workers (placement.ts)
// and kept while the cell is within range. Two representations are drawn:
//   - near: the full meshes (one instanced draw per species), casting shadows, out to `near` metres;
//   - far: hemi-octahedral impostors of all species in one instanced draw, thinned by rank with distance
//     and faded out by `far`. Beyond the near range the terrain draws closed forest as a raised canopy shell
//     (uForestFade, terrainMaterial.ts) that the impostors stand in.
// The near lists are small and rebuilt (sorted front to back) whenever the camera has moved 30 m. The
// impostor list (up to several MB) is double-buffered: after the camera has moved 150 m, or cells have
// arrived, a new list - cells nearest first, so the GPU rejects hidden impostors early - is written into
// the second buffer at most FAR_UPLOAD_BUDGET instances per frame (streaming never uploads megabytes in
// one frame, and never into the buffer being drawn), and the two swap when it is complete. The staging
// list is drawn with no instances meanwhile: that is what makes three upload each frame's part.
// Per-pixel distance fades in the shaders make rebuild points invisible. Both lists are capped by
// per-quality budgets: in dense forest the near range and the impostors' full-density range shrink (eased
// over a second or so) until the counts fit.

import * as THREE from 'three';
import type { QualityLevel, SimContext } from '../../../core/context';
import type { WorkerPool } from '../workerPool';
import { createFoliageAtlas } from './foliageTexture';
import { bakeImpostors, type ImpostorAtlas } from './impostors';
import { BUCKETS, SPECIES_COUNT, TREE_STRIDE, type TreeCellData } from './placement';
import { createImpostorDepthMaterial, createImpostorMaterial, createNearTreeMaterial, createShadowProxyMaterials, type TreeUniforms } from './treeMaterials';
import { createShadowProxies, createTreeGeometries } from './treeModels';

interface VegetationPreset {
  /** Near meshes are drawn to this distance (hand-over to impostors over its last 8%), m. */
  near: number;
  /** Impostors are gone by this distance, m. */
  far: number;
  /** Impostors keep full density to this distance, m. */
  dense: number;
  /** Candidate spacing in dense forest, m. */
  spacing: number;
  /** Most near meshes drawn; in dense forest the near range shrinks to fit. */
  nearBudget: number;
  /** Most impostors drawn; in dense forest the full-density range shrinks to fit. */
  impostorBudget: number;
  /** Near trees cast shadows within this distance, m. */
  shadowRange: number;
  /** Full meshes hand over to the reduced LOD over [lod, lod * 1.25], m. */
  lod: number;
}

const PRESETS: Record<QualityLevel, VegetationPreset> = {
  low: { near: 90, far: 2000, dense: 350, spacing: 6.5, nearBudget: 600, impostorBudget: 20_000, shadowRange: 70, lod: 30 },
  medium: { near: 140, far: 2800, dense: 450, spacing: 6, nearBudget: 1000, impostorBudget: 32_000, shadowRange: 140, lod: 45 },
  high: { near: 180, far: 3600, dense: 550, spacing: 5.5, nearBudget: 1600, impostorBudget: 50_000, shadowRange: 180, lod: 60 },
  ultra: { near: 280, far: 5000, dense: 800, spacing: 5, nearBudget: 3500, impostorBudget: 90_000, shadowRange: 280, lod: 100 },
};
/** Rate at which the effective ranges follow their budgeted targets, 1/s. */
const RANGE_RATE = 1.5;

const CELL = 256;
/** Rebuild the near / far instance lists after the camera moves this far, m. */
const NEAR_REBUILD = 30;
const FAR_REBUILD = 150;
/**
 * Shortest interval between impostor-list rebuilds caused by arriving cells, ms of wall-clock time (not
 * simulation time, so a paused scene still fills in after a teleport or a quality change).
 */
const FAR_REBUILD_INTERVAL_MS = 200;
/** Most impostor instances written per frame: 192 KB of buffer upload. */
const FAR_UPLOAD_BUDGET = 8192;
/** Impostor list capacity, as a multiple of the budget (the budget fit is not exact at tiny ranges). */
const FAR_CAPACITY = 1.1;

interface Cell {
  cx: number;
  cz: number;
  data: TreeCellData | null;
}

/** Numeric key of cell (cx, cz); exact for |cx|, |cz| < 2^20 (268,000 km). */
const cellKey = (cx: number, cz: number): number => (cx + 1048576) * 2097152 + (cz + 1048576);

/** A growable interleaved instance buffer bound to one or more instanced geometries. */
class InstanceList {
  readonly geometry: THREE.InstancedBufferGeometry;
  private readonly geometries: THREE.InstancedBufferGeometry[] = [];
  private buffer!: THREE.InstancedInterleavedBuffer;
  array = new Float32Array(0);
  count = 0;
  /** Instances uploaded by the last commit(). */
  private committed = 0;

  constructor(base: THREE.BufferGeometry) {
    this.geometry = this.addGeometry(base);
    this.reserve(1024);
  }

  /** Another geometry drawn with the same instances (e.g. a shadow proxy). */
  addGeometry(base: THREE.BufferGeometry): THREE.InstancedBufferGeometry {
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index;
    for (const [name, attr] of Object.entries(base.attributes)) g.setAttribute(name, attr);
    if (this.buffer) this.bind(g);
    g.instanceCount = this.count;
    this.geometries.push(g);
    return g;
  }

  private bind(g: THREE.InstancedBufferGeometry): void {
    g.setAttribute('aInstA', new THREE.InterleavedBufferAttribute(this.buffer, 4, 0));
    g.setAttribute('aInstB', new THREE.InterleavedBufferAttribute(this.buffer, 2, 4));
  }

  reserve(n: number): void {
    if (n * TREE_STRIDE <= this.array.length) return;
    const cap = Math.max(n, Math.ceil((this.array.length / TREE_STRIDE) * 1.5));
    const next = new Float32Array(cap * TREE_STRIDE);
    next.set(this.array.subarray(0, this.count * TREE_STRIDE));
    this.array = next;
    this.buffer = new THREE.InstancedInterleavedBuffer(this.array, TREE_STRIDE);
    this.buffer.setUsage(THREE.DynamicDrawUsage);
    for (const g of this.geometries) this.bind(g);
  }

  commit(): void {
    for (const g of this.geometries) g.instanceCount = this.count;
    // An empty list that was already empty has nothing to upload (every buffer update is a command).
    if (this.count === 0 && this.committed === 0) return;
    this.committed = this.count;
    this.buffer.clearUpdateRanges();
    this.buffer.addUpdateRange(0, Math.max(1, this.count) * TREE_STRIDE);
    this.buffer.needsUpdate = true;
  }

  /** Upload instances [start, start + n) this frame (three merges adjacent ranges). */
  touch(start: number, n: number): void {
    if (n <= 0) return;
    this.buffer.addUpdateRange(start * TREE_STRIDE, n * TREE_STRIDE);
    this.buffer.needsUpdate = true;
  }

  /** Draw the first n instances. */
  setDrawCount(n: number): void {
    this.count = n;
    for (const g of this.geometries) g.instanceCount = n;
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
  }
}

export class VegetationSystem {
  readonly root = new THREE.Group();
  private preset: VegetationPreset = PRESETS.high;
  private readonly cells = new Map<number, Cell>();
  private readonly uniforms: TreeUniforms = {
    uTime: { value: 0 },
    uFade: { value: new THREE.Vector4() },
    uDensityRange: { value: 500 },
    uViewPos: { value: new THREE.Vector3() },
    uShadowRange: { value: 100 },
    uLodFade: { value: new THREE.Vector2(60, 75) },
  };
  private foliage!: THREE.Texture;
  private geometries: THREE.BufferGeometry[] = [];
  private proxyGeometries: THREE.BufferGeometry[] = [];
  private lodGeometries: THREE.BufferGeometry[] = [];
  private atlas!: ImpostorAtlas;
  /** Near mesh lists, indexed [lod][species]. */
  private near: InstanceList[][] = [[], []];
  /** The two impostor lists: far[farLive] is drawn, the other is the one being written. */
  private readonly far: InstanceList[] = [];
  private farLive = 0;
  /** The list being written: cells (nearest first) and how many of each one's trees; next to write. */
  private readonly farPlan: Array<[TreeCellData, number]> = [];
  private farPlanPos = 0;
  private farBuilding = false;
  private readonly bucketOrder = new Uint8Array(BUCKETS * BUCKETS);
  private readonly bucketDist = new Float64Array(BUCKETS * BUCKETS);
  private nearMeshes: THREE.Mesh[] = [];
  private materials: THREE.Material[] = [];
  private readonly lastNear = new THREE.Vector3(Infinity, 0, 0);
  private readonly lastFar = new THREE.Vector3(Infinity, 0, 0);
  private cellsChanged = false;
  /** Cells changed since the impostor list was last planned; wall-clock time of that plan, ms. */
  private farCellsChanged = false;
  private lastFarPlan = -Infinity;
  /** Tree cells in range still waiting to be built (the terrain leaves worker slots free while > 0). */
  missingCells = 0;
  /** Cell streaming: the camera's cell, and whether the set of cells in range must be scanned again. */
  private camCx = NaN;
  private camCz = NaN;
  private scanDirty = true;
  /** Scratch lists of the scan (reused; no per-frame allocation). */
  private readonly wantCx: number[] = [];
  private readonly wantCz: number[] = [];
  private readonly wantD: number[] = [];
  private readonly wantOrder: number[] = [];
  private readonly byWantDistance = (a: number, b: number): number => this.wantD[a] - this.wantD[b];
  private generation = 0;
  /** Budget-limited near range and impostor full-density range: targets and eased current values. */
  private nearTarget = 0;
  private nearRange = 0;
  private denseTarget = 0;
  private denseRange = 0;
  /** Ranges the current instance lists were built for. */
  private nearBuilt = 0;
  private denseBuilt = 0;

  /**
   * @param pool       the terrain worker pool (tree cells are built there, behind terrain tiles)
   * @param forestFade receives the distances over which the terrain's forest canopy shell rises
   * @param canopyKeep receives the impostors' thinning (full-density range, fade-out start and end, m), so
   *                   the canopy shell can take over the sunlit crowns where the impostors thin out
   */
  constructor(
    private readonly pool: WorkerPool,
    private readonly forestFade: THREE.Vector2,
    private readonly canopyKeep: THREE.Vector4 = new THREE.Vector4(),
  ) {
    this.root.name = 'vegetation';
  }

  async init(ctx: SimContext): Promise<void> {
    this.foliage = createFoliageAtlas(ctx.renderer);
    this.geometries = createTreeGeometries();
    this.atlas = bakeImpostors(ctx.renderer, this.geometries, this.foliage);

    const impMat = createImpostorMaterial(this.atlas.albedo, this.atlas.normal, this.uniforms);
    // The impostor billboards turn to face the light in the shadow pass: both sides.
    impMat.shadowSide = THREE.DoubleSide;
    const impDepth = createImpostorDepthMaterial(this.atlas.albedo, this.uniforms);
    const proxyMat = createShadowProxyMaterials(this.uniforms);
    this.proxyGeometries = createShadowProxies();
    this.lodGeometries = createTreeGeometries(1);
    this.materials.push(impMat, impDepth, proxyMat.main, proxyMat.depth);
    for (const lod of [0, 1] as const) {
      const nearMat = createNearTreeMaterial(this.foliage, this.uniforms, lod);
      this.materials.push(nearMat);
      for (let s = 0; s < SPECIES_COUNT; s++) {
        const list = new InstanceList((lod ? this.lodGeometries : this.geometries)[s]);
        // The trees cast their shadows through solid proxies (treeModels.ts createShadowProxies).
        const proxy = new THREE.Mesh(list.addGeometry(this.proxyGeometries[s]), proxyMat.main);
        proxy.name = `tree-shadows-${lod}-${s}`;
        proxy.frustumCulled = false;
        proxy.castShadow = true;
        proxy.customDepthMaterial = proxyMat.depth;
        this.root.add(proxy);
        const mesh = new THREE.Mesh(list.geometry, nearMat);
        mesh.name = `trees-${lod}-${s}`;
        mesh.frustumCulled = false;
        mesh.castShadow = false;
        mesh.receiveShadow = true;
        // Draw trees after the terrain: tree depth is written from the vertex stage (treeMaterials.ts), so
        // hills and the forest canopy shell in front reject hidden foliage before it is shaded. (The terrain
        // writes its depth per fragment, so it would gain nothing from being drawn after the trees.)
        mesh.renderOrder = 1;
        this.near[lod].push(list);
        this.nearMeshes.push(mesh);
        this.root.add(mesh);
      }
    }
    const plane = new THREE.PlaneGeometry(2, 2);
    this.proxyGeometries.push(plane);
    for (let k = 0; k < 2; k++) {
      const list = new InstanceList(plane);
      this.far.push(list);
      const impostors = new THREE.Mesh(list.geometry, impMat);
      impostors.name = k === 0 ? 'tree-impostors' : 'tree-impostors-staging';
      impostors.frustumCulled = false;
      impostors.receiveShadow = true;
      // Trees beyond the shadow proxies' range cast their shadows through their impostors.
      impostors.castShadow = true;
      impostors.customDepthMaterial = impDepth;
      impostors.renderOrder = 2;
      this.root.add(impostors);
    }
    this.setQuality(ctx.quality);
  }

  setQuality(q: QualityLevel): void {
    const p = PRESETS[q];
    // The scene is multisampled from medium up (render/post/PostPipeline.ts): fade and antialias foliage
    // through alpha-to-coverage there.
    for (const m of this.materials) {
      if (m.name.startsWith('tree') && m.alphaToCoverage !== (q !== 'low')) {
        m.alphaToCoverage = q !== 'low';
        m.needsUpdate = true;
      }
    }
    const spacingChanged = p.spacing !== this.preset.spacing;
    this.preset = p;
    this.nearTarget = this.nearRange = p.near;
    this.denseTarget = this.denseRange = p.dense;
    this.applyRanges();
    if (spacingChanged) {
      this.cells.clear();
      this.generation++;
      this.scanDirty = true;
    }
    // Both impostor buffers at their full size now, so they never grow (reallocate) in flight.
    for (const l of this.far) l.reserve(Math.ceil(p.impostorBudget * FAR_CAPACITY));
    this.farBuilding = false;
    this.lastNear.set(Infinity, 0, 0);
    this.lastFar.set(Infinity, 0, 0);
  }

  update(dt: number, ctx: SimContext): void {
    this.uniforms.uTime.value += dt;
    this.uniforms.uViewPos.value.copy(ctx.camera.position);
    // Ease the budgeted ranges so a change of budget never makes a batch of trees pop (while paused, dt is
    // 0: settle at once, so a paused scene shows what it will look like).
    const k = dt > 0 ? Math.min(1, dt * RANGE_RATE) : 1;
    this.nearRange += (this.nearTarget - this.nearRange) * k;
    this.denseRange += (this.denseTarget - this.denseRange) * k;
    this.applyRanges();
    const cam = ctx.camera.position;
    this.streamCells(cam);
    // Re-plan after moving, when cells arrive or leave, or once the eased ranges have shrunk enough that
    // the lists carry many instances the shaders no longer draw.
    const farStale = this.denseRange < this.denseBuilt * 0.85;
    const nearStale = this.nearRange < this.nearBuilt * 0.85;
    // While cells stream in (after a teleport) they arrive every frame: re-plan the impostors at most every
    // FAR_REBUILD_INTERVAL_MS of wall-clock time (dt is 0 while paused, and a paused scene must still fill
    // in after a teleport or quality change), the near list (small) at once.
    const now = performance.now();
    const farDue = this.farCellsChanged && now - this.lastFarPlan >= FAR_REBUILD_INTERVAL_MS;
    // (A list being written is finished first: restarting it on every arriving cell could starve it.)
    if (!this.farBuilding && (farDue || farStale || cam.distanceToSquared(this.lastFar) > FAR_REBUILD * FAR_REBUILD)) this.planFar(cam);
    this.pumpFar(cam, FAR_UPLOAD_BUDGET);
    if (this.cellsChanged || nearStale || cam.distanceToSquared(this.lastNear) > NEAR_REBUILD * NEAR_REBUILD) this.rebuildNear(cam);
    this.cellsChanged = false;
  }

  private applyRanges(): void {
    const p = this.preset;
    this.uniforms.uFade.value.set(this.nearRange * 0.92, this.nearRange, p.far * 0.75, p.far);
    this.uniforms.uDensityRange.value = this.denseRange;
    this.uniforms.uShadowRange.value = Math.min(p.shadowRange, this.nearRange);
    this.uniforms.uLodFade.value.set(Math.min(p.lod, this.nearRange * 0.6), Math.min(p.lod * 1.25, this.nearRange * 0.75));
    // The canopy shell rises where the tree meshes hand over to impostors.
    this.forestFade.set(this.nearRange * 0.8, this.nearRange * 1.05);
    this.canopyKeep.set(this.denseRange, p.far * 0.75, p.far, 1);
  }

  /** Instances in the near (mesh) and far (impostor) lists, and cells held, for diagnostics. */
  get stats(): { near: number; impostors: number; cells: number } {
    let near = 0;
    for (const lod of this.near) for (const l of lod) near += l.count;
    return { near, impostors: this.far[this.farLive].count, cells: this.cells.size };
  }

  /** Load every cell in range before the first frame. */
  async preload(ctx: SimContext): Promise<void> {
    const cam = ctx.camera.position;
    const t0 = performance.now();
    while (performance.now() - t0 < 20_000) {
      const missing = this.streamCells(cam);
      if (missing === 0) break;
      await new Promise((r) => setTimeout(r, 5));
    }
    // Start at the budgeted ranges rather than easing into them.
    this.planFar(cam);
    this.rebuildNear(cam);
    this.denseRange = this.denseTarget;
    this.nearRange = this.nearTarget;
    this.applyRanges();
    this.planFar(cam);
    this.pumpFar(cam, Infinity);
    this.rebuildNear(cam);
  }

  dispose(): void {
    this.atlas.dispose();
    this.foliage.dispose();
    for (const g of [...this.geometries, ...this.lodGeometries, ...this.proxyGeometries]) g.dispose();
    for (const l of [...this.near.flat(), ...this.far]) l.dispose();
    for (const m of this.materials) m.dispose();
    this.root.removeFromParent();
  }

  /**
   * Request missing cells nearest-first, drop far ones. Returns the number of cells in range still missing
   * (requested or not). The cells in range are scanned only when the camera enters another cell, cells
   * arrive, or requests are still to be made; nothing is allocated per call.
   */
  private streamCells(cam: THREE.Vector3): number {
    const east = cam.x;
    const north = -cam.z;
    const range = this.preset.far;
    const ccx = Math.floor(east / CELL);
    const ccz = Math.floor(north / CELL);
    if (ccx !== this.camCx || ccz !== this.camCz) {
      this.camCx = ccx;
      this.camCz = ccz;
      this.scanDirty = true;
      const keepRange = range + 2 * CELL;
      for (const [k, c] of this.cells) {
        if (cellDistance(c.cx, c.cz, east, north) > keepRange) {
          this.cells.delete(k);
          this.cellsChanged = this.farCellsChanged = true;
        }
      }
    }
    if (!this.scanDirty) return this.missingCells;
    this.scanDirty = false;
    // Cells in range without data; those not yet requested go into the want lists.
    let missing = 0;
    let n = 0;
    const r = Math.ceil(range / CELL);
    for (let cz = ccz - r; cz <= ccz + r; cz++) {
      for (let cx = ccx - r; cx <= ccx + r; cx++) {
        const d = cellDistance(cx, cz, east, north);
        if (d > range) continue;
        const c = this.cells.get(cellKey(cx, cz));
        if (c && c.data) continue;
        missing++;
        if (c) continue;
        this.wantCx[n] = cx;
        this.wantCz[n] = cz;
        this.wantD[n] = d;
        this.wantOrder[n] = n;
        n++;
      }
    }
    this.wantOrder.length = n;
    this.wantOrder.sort(this.byWantDistance);
    let slots = this.pool.freeSlots;
    for (let i = 0; i < n && slots > 0; i++, slots--) {
      const w = this.wantOrder[i];
      this.request(this.wantCx[w], this.wantCz[w]);
    }
    // More to request once worker slots free up: scan again next frame.
    if (n > this.pool.freeSlots) this.scanDirty = true;
    this.missingCells = missing;
    return missing;
  }

  private request(cx: number, cz: number): void {
    const key = cellKey(cx, cz);
    const cell: Cell = { cx, cz, data: null };
    this.cells.set(key, cell);
    const gen = this.generation;
    this.pool
      .run({ kind: 'trees', req: { cx, cz, size: CELL, spacing: this.preset.spacing } })
      .then((res) => {
        if (gen !== this.generation || this.cells.get(key) !== cell) return;
        cell.data = res as TreeCellData;
        this.farCellsChanged = this.scanDirty = true;
        // The near list only needs rebuilding for cells within its reach.
        const cam = this.uniforms.uViewPos.value;
        if (cellDistance(cx, cz, cam.x, -cam.z) < this.preset.near + NEAR_REBUILD + 20) this.cellsChanged = true;
      })
      .catch(() => undefined);
  }

  private rebuildNear(cam: THREE.Vector3): void {
    this.lastNear.copy(cam);
    const east = cam.x;
    const north = -cam.z;
    const margin = NEAR_REBUILD + 20;
    const maxReach = this.preset.near + margin;
    // Distances (squared, 3D: the shaders fade by 3D distance, so trees far below a high camera never
    // need the near mesh) of every candidate, histogrammed to find the range that fits the budget.
    const bins = new Uint32Array(64);
    const binSize = maxReach / bins.length;
    const visit = (fn: (a: Float32Array, o: number, d: number, base: number) => void): void => {
      for (const c of this.cells.values()) {
        if (!c.data || cellDistance(c.cx, c.cz, east, north) > maxReach) continue;
        const a = c.data.instances;
        for (let i = 0; i < c.data.count; i++) {
          const o = i * TREE_STRIDE;
          const de = a[o] - east;
          const dn = a[o + 2] - north;
          const dy = Math.max(0, cam.y - a[o + 1] - a[o + 3]);
          const d2 = de * de + dn * dn + dy * dy;
          const dyBase = cam.y - a[o + 1];
          if (d2 < maxReach * maxReach) fn(a, o, Math.sqrt(d2), Math.sqrt(de * de + dn * dn + dyBase * dyBase));
        }
      }
    };
    visit((_a, _o, d) => bins[Math.min(bins.length - 1, Math.floor(d / binSize))]++);
    let total = 0;
    let fit = maxReach;
    for (let b = 0; b < bins.length; b++) {
      total += bins[b];
      if (total > this.preset.nearBudget) {
        fit = b * binSize;
        break;
      }
    }
    this.nearTarget = Math.max(20, Math.min(this.preset.near, fit - margin));
    // Keep everything the eased range can still reach; the dither fades the rest.
    this.nearBuilt = Math.max(this.nearTarget, this.nearRange);
    const reach = this.nearBuilt + margin;
    // Gather per LOD and species with distances, then write each list front to back: with depth written
    // from the vertex stage (treeMaterials.ts) the GPU rejects foliage hidden behind nearer trees before
    // shading. A tree within the LOD hand-over band (plus the rebuild margin) goes into both LOD lists.
    const [lod0, lod1] = [this.uniforms.uLodFade.value.x - margin, this.uniforms.uLodFade.value.y + margin];
    const picked: Array<Array<Array<{ a: Float32Array; o: number; d: number }>>> = [0, 1].map(() => this.near[0].map(() => []));
    visit((a, o, d, base) => {
      if (d > reach) return;
      const s = Math.floor(a[o + 5]);
      if (base <= lod1) picked[0][s].push({ a, o, d });
      if (base >= lod0) picked[1][s].push({ a, o, d });
    });
    for (const lod of [0, 1]) {
      this.near[lod].forEach((list, s) => {
        const items = picked[lod][s].sort((x, y) => x.d - y.d);
        list.count = 0;
        list.reserve(items.length);
        for (const it of items) list.array.set(it.a.subarray(it.o, it.o + TREE_STRIDE), list.count++ * TREE_STRIDE);
        list.commit();
      });
    }
  }

  /**
   * Start writing a new impostor list into the staging buffer: the cells in range nearest first, each with
   * the rank-sorted prefix of its trees the shader keeps at the full-density range that fits the budget.
   */
  private planFar(cam: THREE.Vector3): void {
    this.lastFar.copy(cam);
    this.lastFarPlan = performance.now();
    this.farCellsChanged = false;
    const east = cam.x;
    const north = -cam.z;
    const { far, dense, impostorBudget } = this.preset;
    // Conservative per-cell distance: the nearest point of the cell, less the rebuild margin.
    const cells: Array<[TreeCellData, number]> = [];
    for (const c of this.cells.values()) {
      if (!c.data) continue;
      const d = Math.max(1, cellDistance(c.cx, c.cz, east, north) - FAR_REBUILD);
      if (d <= far) cells.push([c.data, d]);
    }
    // Nearest cells first, so the impostors are drawn roughly front to back.
    cells.sort((x, y) => x[1] - y[1]);
    const total = (range: number): number => {
      let n = 0;
      for (const [data, d] of cells) n += keptCount(data, d, range);
      return n;
    };
    // Largest full-density range (<= preset) whose impostor count fits the budget.
    let target = dense;
    if (total(dense) > impostorBudget) {
      let lo = 20;
      let hi = dense;
      for (let it = 0; it < 8; it++) {
        const mid = 0.5 * (lo + hi);
        if (total(mid) > impostorBudget) hi = mid;
        else lo = mid;
      }
      target = lo;
    }
    this.denseTarget = target;
    // Build for whichever of the eased and target ranges is larger, so nothing the shader still keeps
    // is missing from the list while the range eases down.
    const range = Math.max(target, this.denseRange);
    this.denseBuilt = range;
    const plan = this.farPlan;
    plan.length = 0;
    const staging = this.far[1 - this.farLive];
    const capacity = staging.array.length / TREE_STRIDE;
    let n = 0;
    for (const [data, d] of cells) {
      const k = Math.min(keptCount(data, d, range), capacity - n);
      if (k <= 0) continue;
      plan.push([data, k]);
      n += k;
    }
    this.farPlanPos = 0;
    staging.count = 0;
    this.farBuilding = true;
  }

  /**
   * Write up to `budget` instances of the planned impostor list into the staging buffer (one contiguous
   * buffer range per frame); once it is complete, draw it instead of the live one.
   */
  private pumpFar(cam: THREE.Vector3, budget: number): void {
    if (!this.farBuilding) return;
    const staging = this.far[1 - this.farLive];
    const plan = this.farPlan;
    const start = staging.count;
    while (this.farPlanPos < plan.length && staging.count - start < budget) {
      const [data, n] = plan[this.farPlanPos++];
      this.writeNearFirst(staging, data, n, cam);
    }
    staging.touch(start, staging.count - start);
    if (this.farPlanPos < plan.length) return;
    // Complete: swap. The old list stays in the scene, drawing nothing, as the next staging buffer.
    this.far[this.farLive].setDrawCount(0);
    staging.setDrawCount(staging.count);
    this.farLive = 1 - this.farLive;
    this.farBuilding = false;
    plan.length = 0;
  }

  /**
   * Append a cell's first n trees by rank (the ones the shader keeps at this distance), its sub-square
   * buckets nearest the camera first: where impostors overlap, front-to-back order lets the GPU reject
   * hidden ones early.
   */
  private writeNearFirst(list: InstanceList, data: TreeCellData, n: number, cam: THREE.Vector3): void {
    const sub = CELL / BUCKETS;
    const nb = BUCKETS * BUCKETS;
    const order = this.bucketOrder;
    const dist = this.bucketDist;
    // Insertion sort of the buckets by distance (no allocation).
    for (let b = 0; b < nb; b++) {
      const de = (data.cx * BUCKETS + (b % BUCKETS) + 0.5) * sub - cam.x;
      const dn = (data.cz * BUCKETS + Math.floor(b / BUCKETS) + 0.5) * sub + cam.z;
      const d = de * de + dn * dn;
      let i = b;
      for (; i > 0 && dist[i - 1] > d; i--) {
        dist[i] = dist[i - 1];
        order[i] = order[i - 1];
      }
      dist[i] = d;
      order[i] = b;
    }
    const src = data.instances;
    const dst = list.array;
    let o = list.count * TREE_STRIDE;
    for (let i = 0; i < nb; i++) {
      const b = order[i];
      // (Each bucket lists its trees in rank order: the kept ones come first.)
      for (let k = data.bucketStart[b]; k < data.bucketStart[b + 1] && data.order[k] < n; k++) {
        const s0 = data.order[k] * TREE_STRIDE;
        for (let c = 0; c < TREE_STRIDE; c++) dst[o++] = src[s0 + c];
      }
    }
    list.count += n;
  }
}

/** Distance from a point to the nearest point of cell (cx, cz), m. */
function cellDistance(cx: number, cz: number, east: number, north: number): number {
  const e0 = cx * CELL;
  const n0 = cz * CELL;
  const de = east < e0 ? e0 - east : east > e0 + CELL ? east - e0 - CELL : 0;
  const dn = north < n0 ? n0 - north : north > n0 + CELL ? north - n0 - CELL : 0;
  return Math.sqrt(de * de + dn * dn);
}

/**
 * Impostors of a cell the shader may keep at distance d (m) with full density to `range`: all within it,
 * then the rank-sorted prefix of fraction (range / d)^1.5 (the same law as the impostor vertex shader).
 */
function keptCount(data: TreeCellData, d: number, range: number): number {
  const keep = Math.min(1, Math.pow(range / d, 1.5));
  return keep >= 1 ? data.count : rankPrefix(data, keep);
}

/** Number of leading instances (sorted by rank) whose rank is below `keep`. */
function rankPrefix(cell: TreeCellData, keep: number): number {
  const a = cell.instances;
  let lo = 0;
  let hi = cell.count;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const v = a[mid * TREE_STRIDE + 5];
    if ((v - Math.floor(v)) / 0.99 < keep) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
