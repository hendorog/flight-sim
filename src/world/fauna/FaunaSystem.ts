// The fauna subsystem (Deep Time): herds and flyers of the era's roster, streamed around the camera, animated in
// the vertex shader and drawn as instanced meshes.
//
// SHELL CONTRACT (src/sim/Simulator.ts):
//   - createFaunaSystem(era()) after the terrain is initialised. null for a roster with no entries (the present
//     day): nothing is constructed and the present pays nothing.
//   - init(ctx) BEFORE cloudShadows.scan and warmUpShaders: it allocates every mesh and buffer at the quality
//     maximum (presets.ts FAUNA_MAX) and adds them to ctx.scene, so their materials get the cloud-shadow patch and
//     are compiled before the first frame. Afterwards only instance counts change (never a reallocation).
//   - update(dt, ctx) runs every frame after the airport (Simulator.run('fauna', ...)), with the frame's simulated
//     dt (0 while paused; clamped here to 0.1 s per step); it never throws (NaN guarded, counts clamped).
//   - Emits 'faunaSighted' {species, distanceM} on a species' first approach within 500 m and below 300 m AGL
//     in a session.
//
// FRAME: (1) every STREAM_PERIOD, release far herds/flyers, probe at most one habitat cell (<= 30 terrain samples)
// and spawn at most one herd or kettle; (2) herd brains at 10 Hz round-robin and the flyers, sharing the
// 200-terrain-read budget; (3) sphere-cull each herd and flyer against the frustum, bucket by distance into
// LOD0/1/2 (LOD0 capped; the nearest LOD0 also cast shadows), write the 12-float instances (types.ts) and upload
// only the used range.
//
// ART SEAM: the species meshes and the animated material come from a FaunaArt (WP4: species/index.ts and
// faunaMaterial.ts). Until that lands, PLACEHOLDER_ART builds simple primitive bodies behind the same API
// (CreatureMeshSet + the 12-float instance attributes), so integration is a swap of `art`.
// Meshes are THREE.Mesh + InstancedBufferGeometry (the vegetation idiom: no 64-byte instanceMatrix per instance);
// the material places each vertex from aInstA/B/C itself; frustumCulled = false.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { QualityLevel, SimContext, Subsystem } from '../../core/context';
import { makeThermalCore } from '../../physics/weather/thermals';
import type { ThermalFrame } from '../../physics/weather/windField';
import type { SimEnvironment } from '../../physics/environment';
import type { EraParams } from '../era/types';
import { HABITAT_CELL, HERD_EPOCH_S, cellRandom, countingTerrain, makeSite, probeHabitatCell, type FaunaTerrain, type HabitatSite } from './habitat';
import { HerdPool, type AircraftView } from './herds';
import { FLYER_MODE, FlyerPool, type FlyerMode } from './flight';
import { FAUNA_MAX, FAUNA_PRESETS, FLYER_RANGE_FACTOR, MAX_GROUND_ANIMALS, MAX_HERD_SIZE, MAX_HERDS, TERRAIN_CALLS_PER_FRAME, type FaunaPreset } from './presets';
import { ROSTERS, SPECIES_REFERENCE_M } from './roster';
import { KETTLE_BIRDS, KETTLE_MAX_AGL, KETTLE_MIN_AGL, RIVER_HERD_SIZE, kettleSeeds, restingPair, riverHerdSite } from './showcase';
import { BONE, BONE_COUNT, FAUNA_SPECIES_IDS, FAUNA_STRIDE, type CreatureMeshSet, type FaunaRoster, type FaunaSpeciesId, type FaunaStats } from './types';

export interface FaunaSystem extends Subsystem {
  init(ctx: SimContext): void | Promise<void>;
  update(dt: number, ctx: SimContext): void;
  dispose(): void;
  readonly stats: FaunaStats;
}

/** Materials for one species: the lit one, and the animated depth material for its shadow casters. */
export interface FaunaMaterials {
  material: THREE.Material;
  depthMaterial: THREE.Material;
  /** Called once per frame with the scene time (secondary motion noise). */
  setTime?(t: number): void;
  dispose?(): void;
}

/** Where the creature art comes from (WP4's species builders and animated material, or the placeholders). */
export interface FaunaArt {
  build(species: FaunaSpeciesId): CreatureMeshSet;
  materials(species: FaunaSpeciesId, set: CreatureMeshSet): FaunaMaterials;
}

export interface FaunaSystemOptions {
  art?: FaunaArt;
  /** Terrain reads (counted); default the real terrain. */
  terrain?: FaunaTerrain;
}

/** The fauna system of an era, or null when its roster is empty (the present day). */
export function createFaunaSystem(era: EraParams, opts: FaunaSystemOptions = {}): FaunaSystem | null {
  const roster = ROSTERS[era.fauna];
  if (!roster || roster.entries.length === 0) return null;
  return new FaunaSystemImpl(roster, opts);
}

// ---------------------------------------------------------------------------------------------------------------
// Rendering buffers

/** One species-LOD draw: a mesh over a fixed-capacity interleaved instance buffer. */
class InstanceDraw {
  readonly mesh: THREE.Mesh;
  readonly geometry: THREE.InstancedBufferGeometry;
  readonly array: Float32Array;
  readonly buffer: THREE.InstancedInterleavedBuffer;
  count = 0;
  private uploaded = 0;

  constructor(
    base: THREE.BufferGeometry,
    material: THREE.Material,
    readonly capacity: number,
    name: string,
  ) {
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index;
    for (const [n, a] of Object.entries(base.attributes)) g.setAttribute(n, a);
    this.array = new Float32Array(Math.max(1, capacity) * FAUNA_STRIDE);
    this.buffer = new THREE.InstancedInterleavedBuffer(this.array, FAUNA_STRIDE);
    this.buffer.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aInstA', new THREE.InterleavedBufferAttribute(this.buffer, 4, 0));
    g.setAttribute('aInstB', new THREE.InterleavedBufferAttribute(this.buffer, 4, 4));
    g.setAttribute('aInstC', new THREE.InterleavedBufferAttribute(this.buffer, 4, 8));
    g.instanceCount = 0;
    this.geometry = g;
    this.mesh = new THREE.Mesh(g, material);
    this.mesh.name = name;
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
  }

  /** Upload the used range and set the draw count. */
  commit(): void {
    this.geometry.instanceCount = this.count;
    if (this.count === 0 && this.uploaded === 0) return;
    this.uploaded = this.count;
    this.buffer.clearUpdateRanges();
    this.buffer.addUpdateRange(0, Math.max(1, this.count) * FAUNA_STRIDE);
    this.buffer.needsUpdate = true;
  }
}

interface SpeciesDraws {
  species: FaunaSpeciesId;
  set: CreatureMeshSet;
  mats: FaunaMaterials;
  lod: [InstanceDraw, InstanceDraw, InstanceDraw];
  caster: InstanceDraw;
  /** Rendered scale per unit of roster scale (SPECIES_REFERENCE_M / lengthM). */
  unit: number;
  /** Bounding radius at scale 1, m (culling). */
  radius: number;
  /** Triangles per instance, LOD0/1/2. */
  tris: [number, number, number];
}

// ---------------------------------------------------------------------------------------------------------------
// Habitat cell cache (open addressing, fixed size: no per-frame allocation)

const CELL_SLOTS = 4096;
const CELL_EMPTY = 0;
const CELL_NONE = 1;
const CELL_SITE = 2;
const cellKey = (ci: number, cj: number): number => (ci + 32768) * 65536 + (cj + 32768);

class CellCache {
  readonly keys = new Float64Array(CELL_SLOTS);
  readonly status = new Uint8Array(CELL_SLOTS);
  readonly n = new Float64Array(CELL_SLOTS);
  readonly e = new Float64Array(CELL_SLOTS);
  readonly ground = new Float64Array(CELL_SLOTS);
  readonly size = new Uint8Array(CELL_SLOTS);
  readonly entry = new Int16Array(CELL_SLOTS);
  /** Herd slot alive for this cell, or -1. */
  readonly herd = new Int16Array(CELL_SLOTS).fill(-1);
  used = 0;

  /** Slot of a key (existing, or the empty slot it would go in); -1 when full. */
  find(key: number): number {
    let i = (Math.imul(key % 2147483647 | 0, 0x9e3779b1) >>> 20) & (CELL_SLOTS - 1);
    for (let p = 0; p < CELL_SLOTS; p++) {
      if (this.status[i] === CELL_EMPTY || this.keys[i] === key) return i;
      i = (i + 1) & (CELL_SLOTS - 1);
    }
    return -1;
  }

  clear(): void {
    this.status.fill(CELL_EMPTY);
    this.herd.fill(-1);
    this.used = 0;
  }
}

// ---------------------------------------------------------------------------------------------------------------

const SIGHT_RANGE = 500;
const SIGHT_AGL = 300;
/** Ambient flyers are released beyond this multiple of the active radius. */
const FLYER_RELEASE = 1.3;
/** Streaming (release, one probe, one spawn) runs this often, s. */
const STREAM_PERIOD = 0.25;
/** Terrain reads kept back from the herds for the flyers each frame. */
const FLYER_RESERVE = 40;

export class FaunaSystemImpl implements FaunaSystem {
  readonly stats: FaunaStats = { visible: 0, terrainCalls: 0, reallocs: 0, cpuMs: 0 };
  /** Diagnostics (window.__sim.fauna.debug). */
  readonly debug = { herds: 0, animals: 0, flyers: 0, cellsProbed: 0, triangles: 0, deferred: 0, errors: 0 };

  readonly root = new THREE.Group();
  readonly herds = new HerdPool();
  readonly flyers = new FlyerPool(FAUNA_MAX.flyers);
  private readonly cells = new CellCache();
  readonly terrain: FaunaTerrain;
  private readonly art: FaunaArt;
  private preset: FaunaPreset = FAUNA_PRESETS.high;
  private draws: SpeciesDraws[] = [];
  /** Roster entry index -> species draw index. */
  private entryDraw: number[] = [];
  private readonly flyerEntries: number[] = [];
  private unsubscribe: (() => void) | null = null;
  private initialised = false;
  /** Showcase flyers are never released for distance; ambient kettles are. */
  private readonly showcaseFlyer = new Uint8Array(FAUNA_MAX.flyers);
  /** Slot of the showcase river herd (-1 none). */
  riverHerd = -1;
  private readonly sighted = new Set<FaunaSpeciesId>();
  private brainClock = 0;
  private streamClock = 0;
  private ambientSerial = 0;
  private sceneTime = 0;

  // Scratch (no per-frame allocation).
  private readonly site: HabitatSite = makeSite();
  private readonly ac: AircraftView = { n: 0, e: 0, alt: 0, vN: 0, vE: 0, vD: 0, tas: 0 };
  private readonly frame: ThermalFrame = { seed: 0, driftN: 0, driftE: 0, wStar: 0, cloudBaseM: 0, minDepth: 300 };
  private readonly wind = { n: 0, e: 0 };
  private readonly core = makeThermalCore();
  private readonly frustum = new THREE.Frustum();
  private readonly projView = new THREE.Matrix4();
  private readonly sphere = new THREE.Sphere();
  private readonly order = new Int16Array(MAX_HERDS);
  private readonly orderD = new Float64Array(MAX_HERDS);
  private readonly lod0Used = new Int32Array(FAUNA_SPECIES_IDS.length);
  private readonly casterUsed = new Int32Array(FAUNA_SPECIES_IDS.length);

  constructor(
    private readonly roster: FaunaRoster,
    opts: FaunaSystemOptions,
  ) {
    this.terrain = opts.terrain ?? countingTerrain();
    this.art = opts.art ?? PLACEHOLDER_ART;
    this.root.name = 'fauna';
    roster.entries.forEach((e, i) => e.role === 'flyer' && this.flyerEntries.push(i));
  }

  init(ctx: SimContext): void {
    if (this.initialised) return;
    this.initialised = true;
    // Every buffer at the quality maximum, once.
    const species = new Set(this.roster.entries.map((e) => e.species));
    for (const sp of FAUNA_SPECIES_IDS) {
      if (!species.has(sp)) continue;
      const set = this.art.build(sp);
      const mats = this.art.materials(sp, set);
      const flyer = this.roster.entries.some((e) => e.species === sp && e.role === 'flyer');
      const cap = flyer ? FAUNA_MAX.flyers : FAUNA_MAX.groundVisible;
      const lod0 = new InstanceDraw(set.lod0, mats.material, Math.min(cap, FAUNA_MAX.lod0Max), `fauna-${sp}-lod0`);
      const lod1 = new InstanceDraw(set.lod1, mats.material, cap, `fauna-${sp}-lod1`);
      const lod2 = new InstanceDraw(set.lod2, mats.material, cap, `fauna-${sp}-lod2`);
      const caster = new InstanceDraw(set.caster, CASTER_HIDDEN, Math.min(cap, FAUNA_MAX.casters), `fauna-${sp}-caster`);
      // The caster mesh only casts (its colour pass draws nothing; the LOD0 mesh draws the animal).
      caster.mesh.customDepthMaterial = mats.depthMaterial;
      caster.mesh.castShadow = true;
      for (const d of [lod0, lod1, lod2]) {
        d.mesh.castShadow = false;
        d.mesh.receiveShadow = true;
      }
      for (const d of [lod0, lod1, lod2, caster]) this.root.add(d.mesh);
      set.lod0.computeBoundingSphere();
      const bs = set.lod0.boundingSphere;
      const radius = bs ? bs.radius + bs.center.length() : set.lengthM;
      const unit = SPECIES_REFERENCE_M[sp] / Math.max(0.1, set.lengthM);
      const tris: [number, number, number] = [triangles(set.lod0), triangles(set.lod1), triangles(set.lod2)];
      this.draws.push({ species: sp, set, mats, lod: [lod0, lod1, lod2], caster, unit, radius, tris });
    }
    this.entryDraw = this.roster.entries.map((e) => this.draws.findIndex((d) => d.species === e.species));
    ctx.scene.add(this.root);
    this.setQuality(ctx.quality);
    this.unsubscribe = ctx.events.on('qualityChanged', (e) => this.setQuality(e.quality));
    this.spawnShowcase(ctx);
  }

  setQuality(q: QualityLevel): void {
    this.preset = FAUNA_PRESETS[q] ?? FAUNA_PRESETS.high;
    // Fewer flyers: release ambient ones first, then showcase ones from the top.
    let n = this.flyers.count();
    for (let pass = 0; pass < 2; pass++) {
      for (let i = this.flyers.capacity - 1; i >= 0 && n > this.preset.flyers; i--) {
        if (!this.flyers.active[i] || (pass === 0 && this.showcaseFlyer[i])) continue;
        this.flyers.release(i);
        this.showcaseFlyer[i] = 0;
        n--;
      }
    }
  }

  // ------------------------------------------------------------------------------------------------- showcase

  private thermalFrame(ctx: SimContext): ThermalFrame | null {
    const wf = (ctx.env as Partial<SimEnvironment> | undefined)?.windField;
    if (!wf || typeof wf.thermalFrame !== 'function') return null;
    return wf.thermalFrame(this.frame);
  }

  /** Unit vector the wind blows toward, shortened in light air (0 when calm). */
  private windTo(ctx: SimContext): { n: number; e: number } {
    const w = ctx.weather;
    const from = ((w?.windDirectionDeg ?? 0) * Math.PI) / 180;
    const k = Math.min(1, Math.max(0, (w?.windSpeedKt ?? 0) / 6));
    this.wind.n = -Math.cos(from) * k;
    this.wind.e = -Math.sin(from) * k;
    return this.wind;
  }

  private spawnShowcase(ctx: SimContext): void {
    const herdEntry = this.roster.entries.findIndex((e) => e.role === 'herd');
    if (herdEntry >= 0) {
      const s = riverHerdSite(this.terrain);
      const e = this.roster.entries[herdEntry];
      this.riverHerd = this.herds.spawn(
        { north: s.north, east: s.east, ground: s.ground, size: RIVER_HERD_SIZE, entry: herdEntry, scale: e.scale, variant: e.variant, seed: 0x5ca1ab1e, heading: s.heading, pinned: true },
        -1,
      );
    }
    const big = this.roster.entries.findIndex((e) => e.species === 'quetzalcoatlus');
    const small = this.roster.entries.findIndex((e) => e.species === 'azhdarchidSmall');
    // The resting pair, standing on the Flats beyond the 25 end.
    if (big >= 0) {
      restingPair().forEach((p, k) => {
        const i = this.spawnFlyer(big, p.north, p.east, p.ground, p.ground, FLYER_MODE.stand, p.heading, 0x9a1200 + k, p.north, p.east);
        if (i >= 0) this.showcaseFlyer[i] = 1;
      });
    }
    // Two kettles of mixed sizes, on the cores nearest the seeds (ridge by day without thermals; roost at night).
    const f = this.thermalFrame(ctx);
    const t = ctx.simTime ?? 0;
    const wind = this.windTo(ctx);
    const day = (ctx.sky?.dayFactor ?? 1) > 0.25;
    kettleSeeds().forEach((p, g) => {
      for (let b = 0; b < KETTLE_BIRDS; b++) {
        const entry = b === 0 && big >= 0 ? big : small >= 0 ? small : big;
        if (entry < 0) continue;
        const seed = 0xce77 + g * 16 + b;
        const ground = this.terrain.height(p.north, p.east);
        const agl = KETTLE_MIN_AGL + (KETTLE_MAX_AGL - KETTLE_MIN_AGL) * cellRandom(seed, 7, b);
        const i = this.spawnFlyer(entry, p.north, p.east, ground + agl, ground, FLYER_MODE.glide, 0, seed, p.north, p.east);
        if (i < 0) continue;
        this.showcaseFlyer[i] = 1;
        this.placeAirborne(i, f, t, day, wind, p.north, p.east, agl);
      }
    });
  }

  /** Put an airborne flyer in a kettle on the nearest core, else on the ridge (day) or standing (night). */
  private placeAirborne(i: number, f: ThermalFrame | null, t: number, day: boolean, wind: { n: number; e: number }, n: number, e: number, agl: number): void {
    const fl = this.flyers;
    if (!day) {
      fl.alt[i] = fl.ground[i];
      fl.speed[i] = 0;
      fl.blend[i] = 0;
      fl.mode[i] = FLYER_MODE.stand;
      fl.modeT[i] = fl.time;
      return;
    }
    if (f && f.wStar > 0.05 && fl.nearestCore(f, t, n, e, this.core)) {
      fl.startKettle(i, this.core, f, this.terrain);
      fl.alt[i] = fl.coreGround[i] + agl;
      return;
    }
    fl.startRidge(i, this.terrain, wind.n, wind.e);
    fl.alt[i] = fl.ground[i] + fl.rOff[i];
  }

  private spawnFlyer(entry: number, n: number, e: number, alt: number, ground: number, mode: FlyerMode, heading: number, seed: number, an: number, ae: number): number {
    const re = this.roster.entries[entry];
    const draw = this.draws[this.entryDraw[entry]];
    const unit = draw ? draw.unit : 1;
    const size = re.scale * (0.92 + 0.16 * cellRandom(seed, 3, 1));
    return this.flyers.spawn({ north: n, east: e, alt, ground, entry, scale: size * unit, size, variant: re.variant, seed, mode, heading, anchorN: an, anchorE: ae });
  }

  // ------------------------------------------------------------------------------------------------- update

  update(dtIn: number, ctx: SimContext): void {
    const t0 = performance.now();
    this.terrain.calls = 0;
    try {
      this.step(dtIn, ctx);
    } catch (err) {
      // Never throw into the frame loop.
      if (this.debug.errors++ === 0) console.error('fauna: update failed', err);
    }
    this.stats.terrainCalls = this.terrain.calls;
    this.stats.cpuMs = performance.now() - t0;
  }

  private step(dtIn: number, ctx: SimContext): void {
    const dt = Number.isFinite(dtIn) ? Math.min(0.1, Math.max(0, dtIn)) : 0;
    this.sceneTime += dt;
    const cam = ctx.camera;
    const camN = -cam.position.z;
    const camE = cam.position.x;
    const s = ctx.state;
    let ac: AircraftView | null = null;
    if (s && Number.isFinite(s.position.x) && Number.isFinite(s.position.y) && Number.isFinite(s.position.z)) {
      const a = this.ac;
      a.n = s.position.x;
      a.e = s.position.y;
      a.alt = -s.position.z;
      a.vN = s.velocity.x || 0;
      a.vE = s.velocity.y || 0;
      a.vD = s.velocity.z || 0;
      a.tas = s.tas || 0;
      ac = a;
    }
    if (dt > 0) {
      // Streaming first (bounded: one probe of <= 30 reads), then the brains and flyers with what is left.
      this.streamClock += dt;
      if (this.streamClock >= STREAM_PERIOD) {
        this.streamClock = 0;
        this.stream(ctx, camN, camE);
      }
      const f = this.thermalFrame(ctx);
      const wind = this.windTo(ctx);
      const day = (ctx.sky?.dayFactor ?? 1) > 0.25;
      const budget = TERRAIN_CALLS_PER_FRAME;
      this.herds.step(dt, ac, this.terrain, Math.max(0, budget - this.terrain.calls - FLYER_RESERVE), camN, camE);
      this.flyers.step(dt, ctx.simTime ?? this.sceneTime, f, ac, this.terrain, Math.max(0, budget - this.terrain.calls), day, wind.n, wind.e);
      this.debug.deferred = this.herds.deferred;
      this.brainClock += dt;
      if (this.brainClock >= 0.1) {
        this.brainClock = 0;
        if (ac) this.checkSightings(ctx, ac);
      }
    }
    for (const d of this.draws) d.mats.setTime?.(this.sceneTime);
    this.render(cam);
  }

  /** Stream habitat: release far herds/flyers, probe at most one new cell, spawn at most one herd or kettle. */
  private stream(ctx: SimContext, camN: number, camE: number): void {
    const R = this.preset.activeRadius;
    const H = this.herds;
    const C = this.cells;
    for (let h = 0; h < MAX_HERDS; h++) {
      if (!H.active[h] || H.pinned[h]) continue;
      if (Math.hypot(H.cN[h] - camN, H.cE[h] - camE) > R * 1.15) {
        const slot = C.find(H.key[h]);
        if (slot >= 0 && C.status[slot] !== CELL_EMPTY) C.herd[slot] = -1;
        H.release(h);
      }
    }
    const F = this.flyers;
    for (let i = 0; i < F.capacity; i++) {
      if (F.active[i] && !this.showcaseFlyer[i] && Math.hypot(F.n[i] - camN, F.e[i] - camE) > R * FLYER_RELEASE) F.release(i);
    }
    if (C.used > CELL_SLOTS * 0.7) this.resetCells();
    // Cells in range, ring by ring from the camera's: probe the first unknown one, spawn the first unspawned site.
    const ci0 = Math.floor(camN / HABITAT_CELL);
    const cj0 = Math.floor(camE / HABITAT_CELL);
    const rings = Math.ceil(R / HABITAT_CELL);
    let probed = false;
    let spawned = false;
    let members = H.members();
    for (let ring = 0; ring <= rings && !(probed && spawned); ring++) {
      for (let di = -ring; di <= ring; di++) {
        for (let dj = -ring; dj <= ring; dj++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== ring) continue;
          const ci = ci0 + di;
          const cj = cj0 + dj;
          if (Math.hypot((ci + 0.5) * HABITAT_CELL - camN, (cj + 0.5) * HABITAT_CELL - camE) > R) continue;
          const key = cellKey(ci, cj);
          const slot = C.find(key);
          if (slot < 0) continue;
          if (C.status[slot] === CELL_EMPTY) {
            if (probed) continue;
            probed = true;
            this.debug.cellsProbed++;
            C.keys[slot] = key;
            C.used++;
            if (probeHabitatCell(ci, cj, this.roster, this.terrain, this.site)) {
              C.status[slot] = CELL_SITE;
              C.n[slot] = this.site.north;
              C.e[slot] = this.site.east;
              C.ground[slot] = this.site.ground;
              C.size[slot] = this.site.size;
              C.entry[slot] = this.site.entry;
            } else C.status[slot] = CELL_NONE;
            continue;
          }
          if (spawned || C.status[slot] !== CELL_SITE || C.herd[slot] >= 0) continue;
          if (members + C.size[slot] > MAX_GROUND_ANIMALS) continue;
          // Herd state from (cell, epoch): a herd revisited later is somewhere plausible, not where it was left.
          const epoch = Math.floor(Math.max(0, ctx.simTime ?? 0) / HERD_EPOCH_S);
          const seed = (Math.imul(ci, 73856093) ^ Math.imul(cj, 19349663) ^ Math.imul(epoch + 1, 83492791)) >>> 0;
          const e = this.roster.entries[C.entry[slot]];
          const h = H.spawn(
            {
              north: C.n[slot],
              east: C.e[slot],
              ground: C.ground[slot],
              size: Math.min(MAX_HERD_SIZE, C.size[slot]),
              entry: C.entry[slot],
              scale: e.scale,
              variant: e.variant,
              seed,
              heading: 2 * Math.PI * cellRandom(ci, cj, 50 + epoch),
              pinned: false,
            },
            key,
          );
          if (h >= 0) {
            C.herd[slot] = h;
            members += H.size[h];
          }
          spawned = true;
        }
      }
    }
    // Ambient kettles on thermal cores near the camera, by day, up to the preset.
    if (!spawned && !probed && this.flyerEntries.length > 0 && F.count() + 2 <= this.preset.flyers) this.spawnAmbientKettle(ctx, camN, camE);
  }

  /** Forget the probed cells (the table is nearly full): live herds keep running and are re-linked by key. */
  private resetCells(): void {
    const C = this.cells;
    C.clear();
    const H = this.herds;
    for (let h = 0; h < MAX_HERDS; h++) {
      if (!H.active[h] || H.key[h] < 0) continue;
      const slot = C.find(H.key[h]);
      if (slot < 0) continue;
      C.keys[slot] = H.key[h];
      C.status[slot] = CELL_SITE;
      C.n[slot] = H.homeN[h];
      C.e[slot] = H.homeE[h];
      C.ground[slot] = H.cH[h];
      C.size[slot] = H.size[h];
      C.entry[slot] = H.entry[h];
      C.herd[slot] = h;
      C.used++;
    }
  }

  private spawnAmbientKettle(ctx: SimContext, camN: number, camE: number): void {
    const f = this.thermalFrame(ctx);
    if (!f || f.wStar <= 0.05 || (ctx.sky?.dayFactor ?? 1) < 0.25) return;
    const F = this.flyers;
    const k = this.ambientSerial++;
    const R = this.preset.activeRadius * 0.8;
    const a = 2 * Math.PI * cellRandom(k, 0xa3b, 0);
    const r = R * (0.3 + 0.7 * cellRandom(k, 0xa3b, 1));
    const n = camN + r * Math.cos(a);
    const e = camE + r * Math.sin(a);
    const t = ctx.simTime ?? 0;
    if (!F.nearestCore(f, t, n, e, this.core)) return;
    // Not on a core another group already circles.
    for (let i = 0; i < F.capacity; i++) {
      if (F.active[i] && F.mode[i] === FLYER_MODE.kettle && F.coreI[i] === this.core.i && F.coreJ[i] === this.core.j) return;
    }
    const entry = this.flyerEntries[Math.floor(cellRandom(k, 0xa3b, 2) * this.flyerEntries.length)];
    const re = this.roster.entries[entry];
    const birds = Math.min(this.preset.flyers - F.count(), re.groupMin + Math.floor(cellRandom(k, 0xa3b, 3) * (re.groupMax - re.groupMin + 1)));
    const cn = this.core.x + f.driftN;
    const ce = this.core.y + f.driftE;
    const ground = this.terrain.height(cn, ce);
    for (let b = 0; b < birds; b++) {
      const seed = (0xa3b000 + k * 8 + b) >>> 0;
      const agl = 300 + 600 * cellRandom(seed, 5, b);
      const i = this.spawnFlyer(entry, cn, ce, ground + agl, ground, FLYER_MODE.glide, 0, seed, cn, ce);
      if (i < 0) break;
      F.startKettle(i, this.core, f, this.terrain);
      F.alt[i] = F.coreGround[i] + agl;
    }
  }

  private checkSightings(ctx: SimContext, ac: AircraftView): void {
    if (this.sighted.size >= this.draws.length) return;
    const agl = ctx.state.altitudeAGL;
    if (!(agl < SIGHT_AGL)) return;
    const H = this.herds;
    for (let h = 0; h < MAX_HERDS; h++) {
      if (!H.active[h]) continue;
      const sp = this.draws[this.entryDraw[H.entry[h]]]?.species;
      if (!sp || this.sighted.has(sp)) continue;
      const d = Math.max(0, Math.hypot(H.cN[h] - ac.n, H.cE[h] - ac.e, H.cH[h] - ac.alt) - H.radius[h]);
      if (d < SIGHT_RANGE) {
        this.sighted.add(sp);
        ctx.events.emit('faunaSighted', { species: sp, distanceM: Math.round(d) });
      }
    }
    const F = this.flyers;
    for (let i = 0; i < F.capacity; i++) {
      if (!F.active[i]) continue;
      const sp = this.draws[this.entryDraw[F.entry[i]]]?.species;
      if (!sp || this.sighted.has(sp)) continue;
      const d = Math.hypot(F.n[i] - ac.n, F.e[i] - ac.e, F.alt[i] - ac.alt);
      if (d < SIGHT_RANGE) {
        this.sighted.add(sp);
        ctx.events.emit('faunaSighted', { species: sp, distanceM: Math.round(d) });
      }
    }
  }

  // ------------------------------------------------------------------------------------------------- render

  private render(cam: THREE.Camera): void {
    cam.updateMatrixWorld();
    this.projView.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projView);
    const cx = cam.position.x;
    const cy = cam.position.y;
    const cz = cam.position.z;
    const P = this.preset;
    for (const d of this.draws) d.lod[0].count = d.lod[1].count = d.lod[2].count = d.caster.count = 0;
    this.lod0Used.fill(0);
    this.casterUsed.fill(0);
    let visible = 0;

    // Herds, nearest first (insertion sort of <= MAX_HERDS).
    const H = this.herds;
    let nh = 0;
    for (let h = 0; h < MAX_HERDS; h++) {
      if (!H.active[h]) continue;
      const d = Math.hypot(H.cE[h] - cx, H.cH[h] - cy, -H.cN[h] - cz);
      let k = nh++;
      while (k > 0 && this.orderD[k - 1] > d) {
        this.order[k] = this.order[k - 1];
        this.orderD[k] = this.orderD[k - 1];
        k--;
      }
      this.order[k] = h;
      this.orderD[k] = d;
    }
    const lod0R2 = P.lod0Range * P.lod0Range;
    const lod1R2 = P.lod1Range * P.lod1Range;
    const lod2R2 = P.lod2Range * P.lod2Range;
    for (let o = 0; o < nh && visible < P.groundVisible; o++) {
      const h = this.order[o];
      const di = this.entryDraw[H.entry[h]];
      const draw = this.draws[di];
      if (!draw) continue;
      if (this.orderD[o] - H.radius[h] > P.lod2Range) continue;
      this.sphere.center.set(H.cE[h], H.cH[h] + 2, -H.cN[h]);
      this.sphere.radius = H.radius[h] + draw.radius * 1.5 + 30;
      if (!this.frustum.intersectsSphere(this.sphere)) continue;
      const base = h * MAX_HERD_SIZE;
      const size = H.size[h];
      for (let k = 0; k < size && visible < P.groundVisible; k++) {
        const i = base + k;
        const dx = H.mE[i] - cx;
        const dy = H.mH[i] - cy;
        const dz = -H.mN[i] - cz;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (!(d2 < lod2R2)) continue;
        let lod = d2 < lod0R2 && this.lod0Used[di] < P.lod0Max ? 0 : d2 < lod1R2 ? 1 : 2;
        if (draw.lod[lod].count >= draw.lod[lod].capacity) lod = 2;
        const tgt = draw.lod[lod];
        if (tgt.count >= tgt.capacity) continue;
        const sc = H.scale[i] * draw.unit;
        writeInstance(tgt.array, tgt.count++, H.mE[i], H.mH[i], H.mN[i], H.yaw[i], H.pitch[i], 0, H.phase[i], H.blend[i], 0, H.head[i], sc, H.variant[i]);
        visible++;
        if (lod === 0) {
          this.lod0Used[di]++;
          const c = draw.caster;
          if (this.casterUsed[di] < P.casters && c.count < c.capacity) {
            this.casterUsed[di]++;
            writeInstance(c.array, c.count++, H.mE[i], H.mH[i], H.mN[i], H.yaw[i], H.pitch[i], 0, H.phase[i], H.blend[i], 0, H.head[i], sc, H.variant[i]);
          }
        }
      }
    }

    // Flyers (silhouettes against the sky: a longer range).
    const F = this.flyers;
    const fR = P.lod2Range * FLYER_RANGE_FACTOR;
    for (let i = 0; i < F.capacity; i++) {
      if (!F.active[i]) continue;
      const di = this.entryDraw[F.entry[i]];
      const draw = this.draws[di];
      if (!draw) continue;
      const x = F.e[i];
      const y = F.alt[i];
      const z = -F.n[i];
      const d = Math.hypot(x - cx, y - cy, z - cz);
      if (!(d < fR)) continue;
      this.sphere.center.set(x, y, z);
      this.sphere.radius = draw.radius * F.scale[i] + 2;
      if (!this.frustum.intersectsSphere(this.sphere)) continue;
      let lod = d < P.lod0Range && this.lod0Used[di] < P.lod0Max ? 0 : d < P.lod1Range ? 1 : 2;
      if (draw.lod[lod].count >= draw.lod[lod].capacity) lod = 2;
      const tgt = draw.lod[lod];
      if (tgt.count >= tgt.capacity) continue;
      writeInstance(tgt.array, tgt.count++, x, y, F.n[i], F.heading[i], F.pitch[i], F.bank[i], F.phase[i], F.blend[i], F.flap[i], F.head[i], F.scale[i], F.variant[i]);
      visible++;
      if (lod === 0) {
        this.lod0Used[di]++;
        const c = draw.caster;
        if (this.casterUsed[di] < P.casters && c.count < c.capacity) {
          this.casterUsed[di]++;
          writeInstance(c.array, c.count++, x, y, F.n[i], F.heading[i], F.pitch[i], F.bank[i], F.phase[i], F.blend[i], F.flap[i], F.head[i], F.scale[i], F.variant[i]);
        }
      }
    }

    let tris = 0;
    for (const d of this.draws) {
      for (let l = 0; l < 3; l++) {
        d.lod[l].commit();
        tris += d.lod[l].count * d.tris[l];
      }
      d.caster.commit();
    }
    this.stats.visible = visible;
    this.debug.triangles = tris;
    this.debug.herds = H.count();
    this.debug.animals = H.members();
    this.debug.flyers = F.count();
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.root.removeFromParent();
    for (const d of this.draws) {
      for (const l of d.lod) l.geometry.dispose();
      d.caster.geometry.dispose();
      d.mats.dispose?.();
    }
    this.draws = [];
  }
}

function triangles(g: THREE.BufferGeometry): number {
  return Math.floor((g.index ? g.index.count : g.getAttribute('position').count) / 3);
}

/** Write instance k (FAUNA_STRIDE floats, types.ts layout); non-finite values are zeroed. */
function writeInstance(
  a: Float32Array,
  k: number,
  east: number,
  alt: number,
  north: number,
  yaw: number,
  pitch: number,
  bank: number,
  phase: number,
  blend: number,
  flap: number,
  head: number,
  scale: number,
  variant: number,
): void {
  const o = k * FAUNA_STRIDE;
  a[o] = east;
  a[o + 1] = alt;
  a[o + 2] = north;
  a[o + 3] = yaw;
  a[o + 4] = pitch;
  a[o + 5] = bank;
  a[o + 6] = phase;
  a[o + 7] = blend;
  a[o + 8] = flap;
  a[o + 9] = head;
  a[o + 10] = scale;
  a[o + 11] = variant;
  for (let j = o; j < o + FAUNA_STRIDE; j++) if (!Number.isFinite(a[j])) a[j] = 0;
}

/** Colour pass of the shadow-caster meshes: draws nothing (every vertex dropped). */
const CASTER_HIDDEN = (() => {
  const m = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', 'vec3 transformed = vec3(0.0, -1e6, 0.0);');
  };
  m.customProgramCacheKey = () => 'fauna-caster-hidden-v1';
  return m;
})();

// ---------------------------------------------------------------------------------------------------------------
// PLACEHOLDER ART (until WP4's species/index.ts and faunaMaterial.ts land): simple primitive bodies with the
// contract's attributes (aBone, aBoneW, color), and a material that places them from aInstA/B/C with a little
// motion (leg swing by gait phase, wing fold by gaitBlend, flap, head down to graze). Swapped out by passing
// WP4's FaunaArt.

const PLACEHOLDER_INSTANCE_GLSL = /* glsl */ `
attribute vec4 aInstA;
attribute vec4 aInstB;
attribute vec4 aInstC;
attribute float aBone;
// Body space (+x forward, +y up, +z right) -> world offset (three: x east, y up, z = -north).
vec3 faunaOrient(vec3 p) {
  float cb = cos(aInstB.y), sb = sin(aInstB.y);
  p = vec3(p.x, p.y * cb - p.z * sb, p.y * sb + p.z * cb);
  float cp = cos(aInstB.x), sp = sin(aInstB.x);
  p = vec3(p.x * cp - p.y * sp, p.x * sp + p.y * cp, p.z);
  float cy = cos(aInstA.w), sy = sin(aInstA.w);
  float north = p.x * cy - p.z * sy;
  float east = p.x * sy + p.z * cy;
  return vec3(east, p.y, -north);
}
vec3 faunaPose(vec3 p) {
  float phase = 6.2831853 * aInstB.z;
  float gait = aInstB.w;
  int bone = int(aBone + 0.5);
  if (bone >= ${BONE.legFL} && bone <= ${BONE.legHR}) {
    float side = (bone == ${BONE.legFL} || bone == ${BONE.legHR}) ? 0.0 : 3.14159;
    float swing = sin(phase + side) * clamp(gait, 0.0, 1.0) * (1.0 - step(1.5, gait));
    p.x += swing * 0.45 * max(0.0, 2.2 - p.y);
  }
  if (bone == ${BONE.wingL} || bone == ${BONE.wingR}) {
    float spread = smoothstep(1.2, 1.9, gait);
    p.z *= mix(0.12, 1.0, spread);
    p.y += spread * aInstC.x * sin(phase) * abs(p.z) * 0.35;
  }
  if (bone == ${BONE.head}) {
    float graze = 1.0 - clamp(gait, 0.0, 1.0);
    p.y -= graze * 1.5;
    float c = cos(aInstC.y), s = sin(aInstC.y);
    p.xz = vec2(p.x * c + p.z * s, -p.x * s + p.z * c);
  }
  return p;
}
`;

const PLACEHOLDER_BEGIN = 'vec3 transformed = faunaOrient(faunaPose(position) * aInstC.z) + aInstA.xyz * vec3(1.0, 1.0, -1.0);';

function placeholderMaterials(species: FaunaSpeciesId): FaunaMaterials {
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, side: THREE.DoubleSide });
  material.name = `fauna-${species}`;
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${PLACEHOLDER_INSTANCE_GLSL}`)
      .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = faunaOrient(normal);\n#ifdef USE_TANGENT\nvec3 objectTangent = vec3(tangent.xyz);\n#endif')
      .replace('#include <begin_vertex>', PLACEHOLDER_BEGIN);
  };
  material.customProgramCacheKey = () => `fauna-placeholder-v1-${species}`;
  const depthMaterial = new THREE.MeshDepthMaterial();
  depthMaterial.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>\n${PLACEHOLDER_INSTANCE_GLSL}`).replace('#include <begin_vertex>', PLACEHOLDER_BEGIN);
  };
  depthMaterial.customProgramCacheKey = () => `fauna-placeholder-depth-v1-${species}`;
  return {
    material,
    depthMaterial,
    dispose() {
      material.dispose();
      depthMaterial.dispose();
    },
  };
}

type RGB = [number, number, number];

/** A primitive part in body space, tagged with a bone and a colour. */
function part(g: THREE.BufferGeometry, bone: number, color: RGB, m: THREE.Matrix4): THREE.BufferGeometry {
  const ng = (g.index ? g.toNonIndexed() : g.clone()).applyMatrix4(m);
  const n = ng.getAttribute('position').count;
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', ng.getAttribute('position'));
  out.setAttribute('normal', ng.getAttribute('normal'));
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set(color, i * 3);
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  out.setAttribute('aBone', new THREE.Float32BufferAttribute(new Float32Array(n).fill(bone), 1));
  out.setAttribute('aBoneW', new THREE.Float32BufferAttribute(new Float32Array(n).fill(1), 1));
  return out;
}

const M = (x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, rz = 0): THREE.Matrix4 =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, rz)), new THREE.Vector3(sx, sy, sz));

function placeholderHadrosaur(detail: number): THREE.BufferGeometry {
  const seg = Math.max(4, detail);
  const sphere = new THREE.SphereGeometry(1, seg, Math.max(3, seg >> 1));
  const cyl = new THREE.CylinderGeometry(0.22, 0.16, 1, Math.max(3, seg >> 1));
  const cone = new THREE.ConeGeometry(1, 1, seg);
  const skin: RGB = [0.085, 0.075, 0.05];
  const belly: RGB = [0.13, 0.115, 0.08];
  return mergeGeometries([
    part(sphere, BONE.spine1, skin, M(0, 2.4, 0, 3.0, 1.15, 0.95)),
    part(sphere, BONE.spine2, belly, M(0.4, 2.0, 0, 2.2, 0.8, 0.8)),
    part(cone, BONE.tail1, skin, M(-4.6, 2.4, 0, 0.75, 4.8, 0.6, Math.PI / 2)),
    part(cyl, BONE.neck1, skin, M(3.3, 2.9, 0, 2.2, 1.6, 2.2, -1.0)),
    part(sphere, BONE.head, skin, M(4.6, 3.3, 0, 0.9, 0.4, 0.35)),
    part(cyl, BONE.legHL, skin, M(-0.8, 1.0, 0.6, 2.6, 2.0, 2.6)),
    part(cyl, BONE.legHR, skin, M(-0.8, 1.0, -0.6, 2.6, 2.0, 2.6)),
    part(cyl, BONE.legFL, skin, M(1.9, 0.9, 0.5, 1.3, 1.8, 1.3)),
    part(cyl, BONE.legFR, skin, M(1.9, 0.9, -0.5, 1.3, 1.8, 1.3)),
  ])!;
}

function placeholderAzhdarchid(detail: number, small: boolean): THREE.BufferGeometry {
  const seg = Math.max(4, detail);
  const sphere = new THREE.SphereGeometry(1, seg, Math.max(3, seg >> 1));
  const cyl = new THREE.CylinderGeometry(0.12, 0.09, 1, Math.max(3, seg >> 1));
  const cone = new THREE.ConeGeometry(1, 1, seg);
  const skin: RGB = small ? [0.11, 0.09, 0.06] : [0.12, 0.115, 0.1];
  const wingC: RGB = small ? [0.09, 0.06, 0.04] : [0.1, 0.085, 0.06];
  const crest: RGB = small ? [0.15, 0.05, 0.03] : [0.14, 0.09, 0.04];
  // Wing membrane: a flat quad from the shoulder out to the tip (half span 5.25 m) and back to the hip.
  const wing = (side: number): THREE.BufferGeometry => {
    const g = new THREE.BufferGeometry();
    const p = [0.4, 0, 0, -0.6, 0, 5.25 * side, -0.9, 0, 0];
    g.setAttribute('position', new THREE.Float32BufferAttribute(side > 0 ? p : [p[0], p[1], p[2], p[6], p[7], p[8], p[3], p[4], p[5]], 3));
    g.computeVertexNormals();
    return g;
  };
  // Standing: the body sits ~2.5 m up on its legs (origin on the ground under the hips while standing).
  return mergeGeometries([
    part(sphere, BONE.spine1, skin, M(0, 2.4, 0, 1.0, 0.45, 0.4)),
    part(cyl, BONE.neck1, skin, M(1.6, 3.4, 0, 2.2, 2.6, 2.2, -0.9)),
    part(cone, BONE.head, skin, M(3.6, 4.1, 0, 0.2, 2.2, 0.15, -Math.PI / 2 - 0.15)),
    part(cone, BONE.neck2, crest, M(2.5, 4.5, 0, 0.12, 0.9, 0.05, 0.6)),
    part(wing(1), BONE.wingR, wingC, M(0, 2.6, 0)),
    part(wing(-1), BONE.wingL, wingC, M(0, 2.6, 0)),
    part(cyl, BONE.legHL, skin, M(-0.6, 1.1, 0.3, 1, 2.2, 1)),
    part(cyl, BONE.legHR, skin, M(-0.6, 1.1, -0.3, 1, 2.2, 1)),
    part(cyl, BONE.legFL, skin, M(0.7, 1.2, 0.4, 1, 2.4, 1)),
    part(cyl, BONE.legFR, skin, M(0.7, 1.2, -0.4, 1, 2.4, 1)),
  ])!;
}

/** Placeholder bodies at real size (lengthM: hadrosaur length, azhdarchid span, at scale 1). */
export const PLACEHOLDER_ART: FaunaArt = {
  build(species) {
    const flyer = species !== 'edmontosaurus';
    const make = (d: number) => (flyer ? placeholderAzhdarchid(d, species === 'azhdarchidSmall') : placeholderHadrosaur(d));
    const pivots = new Float32Array(BONE_COUNT * 4);
    for (let b = 0; b < BONE_COUNT; b++) pivots[b * 4 + 3] = b === 0 ? -1 : 0;
    return { lod0: make(12), lod1: make(6), lod2: make(4), caster: make(6), pivots, lengthM: flyer ? 10.5 : 11.5 };
  },
  materials(species) {
    return placeholderMaterials(species);
  },
};
