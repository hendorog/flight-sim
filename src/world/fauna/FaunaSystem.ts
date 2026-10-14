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
//     in a session, and again each time the pilot gets at least SIGHT_CLOSER m closer than the last emit (so the
//     Field Guide's 'closest' distance tracks the session's best approach; at most ~20 emits per species).
//
// FRAME: (1) every STREAM_PERIOD, release far herds/flyers, probe at most one habitat cell (<= 40 terrain samples)
// and spawn at most one herd or kettle; (2) herd brains at 10 Hz round-robin and the flyers, sharing the
// 200-terrain-read budget; (3) sphere-cull each herd and flyer against the frustum, bucket by distance into
// LOD0/1/2 (LOD0 capped; the nearest LOD0 also cast shadows), write the 12-float instances (types.ts) and upload
// only the used range.
//
// INCREMENT 2 (WP0b): solo agents (agents.ts, brains.ts) step after the herds with AGENT_RESERVE terrain reads;
// the showcase hooks (showcaseHooks.ts) add the T. rex, the Triceratops group, the Alamosaurus trio and kettle
// places; showcase kettles circle a virtual core when the real thermals are dead (flight.ts). Rendering is
// budgeted per species (profiles.ts render: lod0Max per quality, lodRangeScale, farRangeM) and by a shared LOD0
// triangle pool (preset.lod0TriPool, nearest first: agents, then herds, then flyers); meshes with no instances
// are hidden (no draw, no state change; visible through init so warmUpShaders compiles them); stats.tris and
// stats.draws count what was submitted.
//
// INCREMENT 2b (fauna across the landscape): the stream probes both habitat layers (habitat.ts probeCell: the
// layer-1 Edmontosaurus waterside herds, unchanged, and layer 2: plains Edmontosaurus, Triceratops, Alamosaurus),
// spawning each herd with its own species (and `roam` for layer 2); when the herd slots are full a site at least
// EVICT_MARGIN nearer the camera than the farthest unpinned herd takes that herd's slot. On a quiet stream tick (no
// probe, no spawn) a roaming T. rex may be placed beside a streamed prey herd (placeRex: at most AMBIENT_REX_MAX,
// never within REX_QUIET_M of the safari footprint, out of sight), and released with its herd. Ambient kettles weight
// their species toward water (roster waterAffinity) from the one terrain read they take. Every number an agent
// choice.
//
// ART SEAM: the species meshes and the animated material come from a FaunaArt; the default, CREATURE_ART (art.ts),
// is the procedural creature art (species/index.ts and faunaMaterial.ts). Tests may pass their own.
// Meshes are THREE.Mesh + InstancedBufferGeometry (the vegetation idiom: no 64-byte instanceMatrix per instance);
// the material places each vertex from aInstA/B/C itself; frustumCulled = false.

import * as THREE from 'three';
import type { QualityLevel, SimContext, Subsystem } from '../../core/context';
import { makeThermalCore } from '../../physics/weather/thermals';
import type { ThermalFrame } from '../../physics/weather/windField';
import type { SimEnvironment } from '../../physics/environment';
import * as Anchors from '../era/cretaceousAnchors';
import type { EraParams } from '../era/types';
import { SoloAgentPool, type AgentContext, type SoloBrain } from './agents';
import { brainFor } from './brains';
import { HABITAT_CELL, HERD_BANK_MARGIN, HERD_EPOCH_S, REX_QUIET_M, cellRandom, countingTerrain, kettleEntry, kettleNearWater, makeSite, probeCell, rexRandom, safariFootprintDist, type FaunaTerrain, type HabitatSite } from './habitat';
import { HerdPool, type AircraftView } from './herds';
import { FLYER_MODE, FlyerPool, type FlyerMode } from './flight';
import { AGENT_RESERVE, FAUNA_MAX, FAUNA_PRESETS, FLYER_RANGE_FACTOR, FLYER_RESERVE, MAX_AGENTS, MAX_GROUND_ANIMALS, MAX_HERD_SIZE, MAX_HERDS, TERRAIN_CALLS_PER_FRAME, type FaunaPreset } from './presets';
import { PROFILES, type SpeciesProfile } from './profiles';
import { ROSTERS, SPECIES_REFERENCE_M } from './roster';
import { KETTLE_BIRDS, KETTLE_MAX_AGL, KETTLE_MIN_AGL, RIVER_HERD_SIZE, SAFARI_AGL_M, kettleSeeds, restingPair, riverHerdSite } from './showcase';
import { kettleComposition, showcaseSpawns, type ShowcaseSpawn } from './showcaseHooks';
import { CREATURE_ART } from './art';
import { FAUNA_SPECIES } from './species/index';
import { FAUNA_SPECIES_IDS, FAUNA_STRIDE, speciesIndex, type CreatureMeshSet, type FaunaRoster, type FaunaSpeciesId, type FaunaStats } from './types';
import { makeSample } from '../terrain/heightfield';

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

/** Where the creature art comes from (default CREATURE_ART: the species builders and the animated material). */
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

  /** Upload the used range and set the draw count; a mesh with no instances is hidden (no draw call at all). */
  commit(): void {
    this.geometry.instanceCount = this.count;
    this.mesh.visible = this.count > 0;
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
  /** Height of the body origin above the feet at scale 1, m (the azhdarchids' origin is the centre of mass). */
  originM: number;
  profile: SpeciesProfile;
  /** At the current quality: squared LOD0/LOD1 ranges, the squared and plain draw range, the LOD0 cap. */
  lod0R2: number;
  lod1R2: number;
  farR2: number;
  farR: number;
  /**
   * The draw range of streamed animals (unpinned herds, ambient agents): farR, but for a species drawn beyond the
   * preset (profile.render.farRangeM > 0: Alamosaurus, T. rex) clamped inside activeRadius - POP_MARGIN, so a group
   * that streams in at the edge of the active radius does not pop into view.
   */
  ambR2: number;
  ambR: number;
  lod0Cap: number;
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
/** A repeat 'faunaSighted' needs an approach at least this much closer than the species' last one, m. */
const SIGHT_CLOSER = 25;
/** Ambient flyers are released beyond this multiple of the active radius. */
const FLYER_RELEASE = 1.3;
/** Streaming (release, one probe, one spawn) runs this often, s. */
const STREAM_PERIOD = 0.25;
/** A site must be this much nearer the camera than the farthest unpinned herd to evict it when the slots are full, m. */
const EVICT_MARGIN = 1500;
/** Streamed far-drawn species are clamped inside activeRadius minus this (ambR), m. */
const POP_MARGIN = 1500;
/** Roaming T. rexes alive at once at most (the agent pool keeps one slot spare: MAX_AGENTS - 1). */
export const AMBIENT_REX_MAX = 2;
/** A roaming T. rex stands this far (+ up to REX_RANGE_SPAN) from its prey herd's home, m. */
export const REX_RANGE_MIN = 320;
export const REX_RANGE_SPAN = 130;
/** A roaming T. rex is only placed beyond this distance from the camera, or outside the view, m. */
const REX_UNSEEN_M = 2500;
/**
 * The brain a roaming T. rex runs: the T. rex brain with ctx.riverHerd masked to -1 for its init and step. The river
 * herd belongs to the scripted encounter (slot 0); a roaming T. rex never sees it, so it can never stalk it or send it
 * a threat, whichever T. rex brain is in the build (the inc-2 brain, which only hunts ctx.riverHerd, keeps a roaming
 * one in LURK; the generalised brain is ambient for riverHerd -1 and picks its own unpinned prey). No allocation.
 */
export const AMBIENT_REX_BRAIN: SoloBrain = {
  init(pool: SoloAgentPool, i: number, ctx: AgentContext): void {
    const rh = ctx.riverHerd;
    ctx.riverHerd = -1;
    try {
      brainFor('tyrannosaurus').init(pool, i, ctx);
    } finally {
      ctx.riverHerd = rh;
    }
  },
  step(pool: SoloAgentPool, i: number, ctx: AgentContext): void {
    const rh = ctx.riverHerd;
    ctx.riverHerd = -1;
    try {
      brainFor('tyrannosaurus').step(pool, i, ctx);
    } finally {
      ctx.riverHerd = rh;
    }
  },
};
const EDMONTOSAURUS = speciesIndex('edmontosaurus');
const TRICERATOPS = speciesIndex('triceratops');

/**
 * Herd terrain reads per frame at most (inside TERRAIN_CALLS_PER_FRAME's share for the herds). A stampede of a few
 * hundred running members wants a ground snap for each of them every ~0.2 s; uncapped, the river herd's brain tick
 * took 104-111 reads in one frame (measured at G3-G4). The cap bounds that worst-case burst (Deep Time inc 2 WP8;
 * it did not measurably move the 4x-throttled CPU p95, which is noise-bound). Between snaps a member follows its
 * herd's terrain plane, so the cap only spreads the snaps.
 */
const HERD_FRAME_READS = 64;
/** The herds' and agents' sub-step, s (their models are tuned for dt <= this). */
const SUB_DT = 0.1;
/**
 * Sim time the herds and agents follow per frame at most, s (in SUB_DT sub-steps): time acceleration (up to 16x)
 * at a low frame rate must not leave the scripted encounter (charge, roar, stampede) behind the aircraft, which
 * flies the real sim time. Beyond this the animals fall behind (a frame longer than a second is a stall anyway).
 */
const MAX_FRAME_SIM_S = 1;

export class FaunaSystemImpl implements FaunaSystem {
  readonly stats: FaunaStats = { visible: 0, terrainCalls: 0, reallocs: 0, cpuMs: 0, tris: 0, draws: 0 };
  /** Diagnostics (window.__sim.fauna.debug). */
  readonly debug = { herds: 0, animals: 0, flyers: 0, agents: 0, cellsProbed: 0, triangles: 0, deferred: 0, errors: 0, agentTerrainCalls: 0, ambientRex: 0, evictions: 0 };

  readonly root = new THREE.Group();
  readonly herds = new HerdPool();
  readonly flyers = new FlyerPool(FAUNA_MAX.flyers);
  readonly agents: SoloAgentPool;
  private readonly cells = new CellCache();
  readonly terrain: FaunaTerrain;
  private readonly art: FaunaArt;
  private preset: FaunaPreset = FAUNA_PRESETS.high;
  private quality: QualityLevel = 'high';
  /** Showcase herd slots by species (the hooks' pinned herds; the river herd is riverHerd). */
  readonly showcaseHerds: number[] = [];
  /** Showcase kettle membership of each flyer slot (-1 none, 0 / 1 the kettle). */
  readonly kettleOf = new Int8Array(FAUNA_MAX.flyers).fill(-1);
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
  /** Per species, the distance of its last 'faunaSighted' emit this session, m. */
  private readonly sighted = new Map<FaunaSpeciesId, number>();
  private brainClock = 0;
  private streamClock = 0;
  private ambientSerial = 0;
  private sceneTime = 0;
  /** Roaming T. rex bookkeeping per agent slot: 1 = ambient (placed by placeRex), its prey herd slot and that herd's key. */
  readonly ambientAgent = new Uint8Array(MAX_AGENTS);
  readonly agentHerd = new Int16Array(MAX_AGENTS).fill(-1);
  readonly agentHerdKey = new Float64Array(MAX_AGENTS).fill(-1);
  /** Per herd slot: the key of a herd whose T. rex could not be placed (water both ways), so it is not retried. */
  private readonly rexFailKey = new Float64Array(MAX_HERDS).fill(-1);
  /** Roster entry of the T. rex and its 'nearHerd' occupancy (-1 / 0: none). */
  private readonly rexEntry: number;
  private readonly rexOccupancy: number;
  /** Farthest unpinned herd's distance from the camera (farthestUnpinned's second result), m. */
  private farD = 0;

  // Scratch (no per-frame allocation).
  private readonly site: HabitatSite = makeSite();
  private readonly sample = makeSample();
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
  /** LOD0 triangles still available this frame (preset.lod0TriPool). */
  private poolLeft = 0;

  constructor(
    private readonly roster: FaunaRoster,
    opts: FaunaSystemOptions,
  ) {
    this.terrain = opts.terrain ?? countingTerrain();
    this.art = opts.art ?? CREATURE_ART;
    this.agents = new SoloAgentPool(this.herds, this.terrain, Anchors);
    this.root.name = 'fauna';
    // Ambient kettles pick among the ambient flyer entries by weight.
    roster.entries.forEach((e, i) => e.role === 'flyer' && e.ambient !== false && e.weight > 0 && this.flyerEntries.push(i));
    this.rexEntry = roster.entries.findIndex((e) => e.species === 'tyrannosaurus' && e.role === 'solo' && e.habitat === 'nearHerd' && e.ambient !== false);
    this.rexOccupancy = this.rexEntry >= 0 ? (roster.entries[this.rexEntry].occupancy ?? 0) : 0;
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
      const solo = this.roster.entries.every((e) => e.species !== sp || e.role === 'solo');
      const cap = flyer ? FAUNA_MAX.flyers : solo ? MAX_AGENTS : FAUNA_MAX.groundVisible;
      const profile = PROFILES[sp];
      const lod0 = new InstanceDraw(set.lod0, mats.material, Math.min(cap, Math.max(1, profile.render.lod0Max.ultra)), `fauna-${sp}-lod0`);
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
      this.draws.push({ species: sp, set, mats, lod: [lod0, lod1, lod2], caster, unit, radius, tris, originM: FAUNA_SPECIES[sp].groundOffsetM, profile, lod0R2: 0, lod1R2: 0, farR2: 0, farR: 0, ambR2: 0, ambR: 0, lod0Cap: 0 });
    }
    this.entryDraw = this.roster.entries.map((e) => this.draws.findIndex((d) => d.species === e.species));
    ctx.scene.add(this.root);
    this.preset = FAUNA_PRESETS[ctx.quality] ?? FAUNA_PRESETS.high;
    this.quality = FAUNA_PRESETS[ctx.quality] ? ctx.quality : 'high';
    this.applyRanges();
    this.spawnShowcase(ctx);
    // After the showcase is in the pool, so its flyers are trimmed to the preset too.
    this.setQuality(ctx.quality);
    const offQuality = ctx.events.on('qualityChanged', (e) => this.setQuality(e.quality));
    // A scenario reset (a restart, a new start) stages the showcase again: the opening hunt replays.
    const offReset = ctx.events.on('reset', () => this.reseedShowcase(ctx));
    this.unsubscribe = () => {
      offQuality?.();
      offReset?.();
    };
  }

  /**
   * Release the showcase (the river herd, the hooks' herds, the solo agents and the showcase flyers) and spawn it
   * again from its anchors: every brain re-inits (the T. rex lurks, its rearm cooldown cleared), every herd is back in
   * place and calm. Streamed herds and ambient kettles stay.
   */
  reseedShowcase(ctx: SimContext): void {
    if (!this.initialised) return;
    if (this.riverHerd >= 0 && this.herds.active[this.riverHerd]) this.herds.release(this.riverHerd);
    this.riverHerd = -1;
    for (const h of this.showcaseHerds) if (this.herds.active[h]) this.herds.release(h);
    this.showcaseHerds.length = 0;
    for (let i = 0; i < this.agents.capacity; i++) if (this.agents.active[i]) this.agents.release(i);
    // (The roaming T. rexes go too; placeRex puts them back beside their herds, after the showcase T. rex's slot 0.)
    this.ambientAgent.fill(0);
    this.agentHerd.fill(-1);
    this.agentHerdKey.fill(-1);
    for (let i = 0; i < this.flyers.capacity; i++) {
      if (!this.showcaseFlyer[i]) continue;
      if (this.flyers.active[i]) this.flyers.release(i);
      this.showcaseFlyer[i] = 0;
      this.kettleOf[i] = -1;
    }
    this.spawnShowcase(ctx);
    this.setQuality(this.quality);
  }

  setQuality(q: QualityLevel): void {
    this.preset = FAUNA_PRESETS[q] ?? FAUNA_PRESETS.high;
    this.quality = FAUNA_PRESETS[q] ? q : 'high';
    this.applyRanges();
    // Fewer flyers: release ambient ones first, then showcase ones from the top.
    let n = this.flyers.count();
    for (let pass = 0; pass < 2; pass++) {
      for (let i = this.flyers.capacity - 1; i >= 0 && n > this.preset.flyers; i--) {
        if (!this.flyers.active[i] || (pass === 0 && this.showcaseFlyer[i])) continue;
        this.flyers.release(i);
        this.showcaseFlyer[i] = 0;
        this.kettleOf[i] = -1;
        n--;
      }
    }
  }

  /** Per-species LOD ranges and LOD0 caps at the current quality (profiles.ts render). */
  private applyRanges(): void {
    const P = this.preset;
    for (const d of this.draws) {
      const r = d.profile.render;
      const k = r.lodRangeScale > 0 ? r.lodRangeScale : 1;
      d.lod0R2 = (P.lod0Range * k) ** 2;
      d.lod1R2 = (P.lod1Range * k) ** 2;
      d.farR = r.farRangeM > 0 ? r.farRangeM : P.lod2Range * k;
      d.farR2 = d.farR * d.farR;
      d.ambR = r.farRangeM > 0 ? Math.max(0, Math.min(d.farR, P.activeRadius - POP_MARGIN)) : d.farR;
      d.ambR2 = d.ambR * d.ambR;
      d.lod0Cap = Math.min(d.lod[0].capacity, Math.max(0, r.lod0Max[this.quality] ?? P.lod0Max));
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
    const site = riverHerdSite(this.terrain);
    if (herdEntry >= 0) {
      const e = this.roster.entries[herdEntry];
      this.riverHerd = this.herds.spawn(
        { north: site.north, east: site.east, ground: site.ground, size: RIVER_HERD_SIZE, entry: herdEntry, scale: e.scale, variant: e.variant, seed: 0x5ca1ab1e, heading: site.heading, pinned: true, species: e.species },
        -1,
      );
    }
    // The species' hooks (inc 2): herds, solo agents, kettle places and standing flyers.
    const entryOf = (sp: FaunaSpeciesId): number => this.roster.entries.findIndex((e) => e.species === sp);
    const spawns = showcaseSpawns({ anchors: Anchors, riverHerd: site, terrain: this.terrain, quality: this.quality }, (sp) => entryOf(sp) >= 0);
    for (const sp of spawns) this.spawnHook(sp, entryOf(sp.species));

    const big = entryOf('quetzalcoatlus');
    // The resting pair, standing on the Flats beside the strip.
    if (big >= 0) {
      restingPair().forEach((p, k) => {
        const i = this.spawnFlyer(big, p.north, p.east, p.ground, p.ground, FLYER_MODE.stand, p.heading, 0x9a1200 + k, p.north, p.east);
        if (i >= 0) this.showcaseFlyer[i] = 1;
      });
    }
    // Two kettles of mixed sizes (kettleComposition: the hooks' birds replace places from the end), on the cores
    // nearest the seeds by day with thermals, on a virtual core by day without (the dusk safari), roosting at night.
    const f = this.thermalFrame(ctx);
    const t = ctx.simTime ?? 0;
    const wind = this.windTo(ctx);
    const day = (ctx.sky?.dayFactor ?? 1) > 0.25;
    const line: FaunaSpeciesId[] = [];
    kettleSeeds().forEach((p, g) => {
      kettleComposition(spawns, g as 0 | 1, line);
      for (let b = 0; b < KETTLE_BIRDS; b++) {
        let entry = entryOf(line[b]);
        if (entry < 0) entry = b === 0 && big >= 0 ? big : entryOf('azhdarchidSmall') >= 0 ? entryOf('azhdarchidSmall') : big;
        if (entry < 0) continue;
        const seed = 0xce77 + g * 16 + b;
        const ground = this.terrain.height(p.north, p.east);
        const agl = KETTLE_MIN_AGL + (KETTLE_MAX_AGL - KETTLE_MIN_AGL) * cellRandom(seed, 7, b);
        const i = this.spawnFlyer(entry, p.north, p.east, ground + agl, ground, FLYER_MODE.glide, 0, seed, p.north, p.east);
        if (i < 0) continue;
        this.showcaseFlyer[i] = 1;
        this.kettleOf[i] = g;
        if (day && !(f && f.wStar > 0.05)) {
          // The dusk licence: a pinned virtual core. Kettle 0 at the computed evening point, KETTLE0_LIFT_M above the
          // safari's own altitude +- the band (just above eye level, on the sky); kettle 1 over its seed.
          const k0 = Anchors.KETTLE0_EVENING;
          if (g === 0) this.flyers.startVirtualKettle(i, k0.north, k0.east, k0.ground, Anchors.SAFARI_FLIGHT.altitudeMSL + Anchors.KETTLE0_LIFT_M + (agl - SAFARI_AGL_M));
          else this.flyers.startVirtualKettle(i, p.north, p.east, ground, ground + agl);
          continue;
        }
        this.placeAirborne(i, f, t, day, wind, p.north, p.east, agl);
      }
    });
  }

  /** Spawn one hook's showcase group. */
  private spawnHook(sp: ShowcaseSpawn, entry: number): void {
    if (entry < 0) return;
    const re = this.roster.entries[entry];
    if (sp.kind === 'herd') {
      const ground = sp.ground ?? this.terrain.height(sp.north, sp.east);
      const h = this.herds.spawn(
        { north: sp.north, east: sp.east, ground, size: Math.min(MAX_HERD_SIZE, Math.max(1, sp.size)), entry, scale: sp.scale ?? re.scale, variant: sp.variant ?? re.variant, seed: sp.seed, heading: sp.heading, pinned: true, species: sp.species },
        -1,
      );
      if (h >= 0) this.showcaseHerds.push(h);
    } else if (sp.kind === 'solo') {
      const ground = sp.ground ?? this.terrain.height(sp.north, sp.east);
      this.agents.spawn({ species: sp.species, entry, north: sp.north, east: sp.east, ground, heading: sp.heading, scale: sp.scale ?? re.scale, variant: sp.variant ?? re.variant, seed: sp.seed }, brainFor(sp.species));
    } else if (sp.kettle === undefined && sp.north !== undefined && sp.east !== undefined) {
      const ground = this.terrain.height(sp.north, sp.east);
      for (let c = 0; c < Math.max(0, Math.floor(sp.count)); c++) {
        const seed = ((sp.seed ?? 0x5f1e) + c) >>> 0;
        const n = sp.north + 6 * c;
        const i = this.spawnFlyer(entry, n, sp.east, ground, ground, FLYER_MODE.stand, sp.heading ?? 0, seed, sp.north, sp.east);
        if (i >= 0) this.showcaseFlyer[i] = 1;
      }
    }
    // (Kettle places are taken in spawnShowcase through kettleComposition.)
  }

  /** Put an airborne flyer in a kettle on the nearest core, else on the ridge (day) or landed at its roost (night). */
  private placeAirborne(i: number, f: ThermalFrame | null, t: number, day: boolean, wind: { n: number; e: number }, n: number, e: number, agl: number): void {
    const fl = this.flyers;
    if (!day) {
      // Roosting (not standing): the dawn handler relaunches roosted birds.
      fl.startRoosted(i, this.terrain);
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
    // Size relative to Quetzalcoatlus (speeds and wingbeat scale with it): the roster scale x the species' real
    // span over Quetzalcoatlus's (1 for the inc-1 azhdarchids, which share its body; 6.5 / 10.5 for Pteranodon).
    const rel = SPECIES_REFERENCE_M[re.species] / SPECIES_REFERENCE_M.quetzalcoatlus;
    const size = re.scale * rel * (0.92 + 0.16 * cellRandom(seed, 3, 1));
    const shown = re.scale * (0.92 + 0.16 * cellRandom(seed, 3, 1));
    return this.flyers.spawn({ north: n, east: e, alt, ground, entry, scale: shown * unit, size, variant: re.variant, seed, mode, heading, anchorN: an, anchorE: ae, flapHz: PROFILES[re.species].flapHz });
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
      // Streaming first (bounded: one probe of <= 40 reads), then the brains and flyers with what is left.
      this.streamClock += dt;
      if (this.streamClock >= STREAM_PERIOD) {
        this.streamClock = 0;
        this.stream(ctx, camN, camE);
      }
      const f = this.thermalFrame(ctx);
      const wind = this.windTo(ctx);
      const day = (ctx.sky?.dayFactor ?? 1) > 0.25;
      const budget = TERRAIN_CALLS_PER_FRAME;
      // Herds and agents follow the whole sim time (up to MAX_FRAME_SIM_S) in sub-steps of <= SUB_DT, on one clock
      // (agents.ts CLOCK). HERD_FRAME_READS holds across the sub-steps; the agents get AGENT_RESERVE a sub-step
      // (in practice a few: a ground snap per 1.5 m or 1 s, a water check per 0.5 s), and the flyers what is left.
      const total = Number.isFinite(dtIn) ? Math.min(MAX_FRAME_SIM_S, Math.max(0, dtIn)) : 0;
      const subs = Math.max(1, Math.ceil(total / SUB_DT - 1e-9));
      const sub = total / subs;
      const herdStart = this.terrain.calls;
      let agentReads = 0;
      for (let k = 0; k < subs; k++) {
        const herdLeft = Math.max(0, HERD_FRAME_READS - (this.terrain.calls - herdStart - agentReads));
        this.herds.step(sub, ac, this.terrain, Math.min(herdLeft, Math.max(0, budget - this.terrain.calls - FLYER_RESERVE - AGENT_RESERVE)), camN, camE);
        // Solo agents after the herds (their brains read and drive the herds), on the herds' clock.
        agentReads += this.agents.step(sub, ac, this.terrain, this.riverHerd);
      }
      this.debug.agentTerrainCalls = agentReads;
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

  /**
   * Stream habitat: release far herds/flyers, probe at most one new cell (both layers, <= 40 reads), spawn at most
   * one herd (evicting the farthest unpinned one when the slots are full and the site is EVICT_MARGIN nearer),
   * release roaming T. rexes whose herd is gone, and on a quiet tick place a roaming T. rex or an ambient kettle.
   */
  private stream(ctx: SimContext, camN: number, camE: number): void {
    const R = this.preset.activeRadius;
    const H = this.herds;
    const C = this.cells;
    const rel2 = R * 1.15 * (R * 1.15);
    for (let h = 0; h < MAX_HERDS; h++) {
      if (!H.active[h] || H.pinned[h]) continue;
      const dn = H.cN[h] - camN;
      const de = H.cE[h] - camE;
      if (dn * dn + de * de > rel2) this.releaseHerd(h);
    }
    const F = this.flyers;
    const fr2 = R * FLYER_RELEASE * (R * FLYER_RELEASE);
    for (let i = 0; i < F.capacity; i++) {
      if (!F.active[i] || this.showcaseFlyer[i]) continue;
      const dn = F.n[i] - camN;
      const de = F.e[i] - camE;
      if (dn * dn + de * de > fr2) F.release(i);
    }
    if (C.used > CELL_SLOTS * 0.7) this.resetCells();
    // Cells in range, ring by ring from the camera's: probe the first unknown one, spawn the first unspawned site.
    const ci0 = Math.floor(camN / HABITAT_CELL);
    const cj0 = Math.floor(camE / HABITAT_CELL);
    const rings = Math.ceil(R / HABITAT_CELL);
    let probed = false;
    let spawned = false;
    /** The herd slots are full and there is no unpinned herd to evict (or a spawn failed): no candidate qualifies. */
    let full = false;
    /** When the slots are full: the farthest unpinned herd (-1 none; found once per tick, its distance in farD). */
    let far = -2;
    let members = H.members();
    for (let ring = 0; ring <= rings && !(probed && (spawned || full)); ring++) {
      for (let di = -ring; di <= ring; di++) {
        for (let dj = -ring; dj <= ring; dj++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== ring) continue;
          const ci = ci0 + di;
          const cj = cj0 + dj;
          const cn = (ci + 0.5) * HABITAT_CELL - camN;
          const ce = (cj + 0.5) * HABITAT_CELL - camE;
          if (cn * cn + ce * ce > R * R) continue;
          const key = cellKey(ci, cj);
          const slot = C.find(key);
          if (slot < 0) continue;
          if (C.status[slot] === CELL_EMPTY) {
            if (probed) continue;
            probed = true;
            this.debug.cellsProbed++;
            C.keys[slot] = key;
            C.used++;
            if (probeCell(ci, cj, this.roster, this.terrain, this.site)) {
              C.status[slot] = CELL_SITE;
              C.n[slot] = this.site.north;
              C.e[slot] = this.site.east;
              C.ground[slot] = this.site.ground;
              C.size[slot] = this.site.size;
              C.entry[slot] = this.site.entry;
            } else C.status[slot] = CELL_NONE;
            continue;
          }
          if (spawned || full || C.status[slot] !== CELL_SITE || C.herd[slot] >= 0) continue;
          if (members + C.size[slot] > MAX_GROUND_ANIMALS) continue;
          if (H.count() >= MAX_HERDS) {
            // Full: the farthest unpinned herd gives up its slot to a site well nearer the camera. A site that is not
            // near enough is skipped, not taken as the end of the scan: the ring walk is not ordered by site distance,
            // so a nearer site may follow.
            if (far === -2) far = this.farthestUnpinned(camN, camE);
            if (far < 0) {
              full = true;
              continue;
            }
            const sn = C.n[slot] - camN;
            const se = C.e[slot] - camE;
            if (Math.sqrt(sn * sn + se * se) > this.farD - EVICT_MARGIN) continue;
            members -= H.size[far];
            this.releaseHerd(far);
            this.debug.evictions++;
          }
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
              species: e.species,
              roam: e.habitat !== undefined && e.habitat !== 'waterside',
            },
            key,
          );
          if (h >= 0) {
            C.herd[slot] = h;
            members += H.size[h];
            spawned = true;
          } else full = true;
        }
      }
    }
    // Roaming T. rexes whose herd was released or evicted (its slot's key changed), or that are out of range.
    this.sweepAmbientAgents(camN, camE, R);
    if (spawned || probed) return;
    // A quiet tick: a roaming T. rex first (capped, rarely due), else an ambient kettle on a thermal core.
    if (this.placeRex(camN, camE)) return;
    if (this.flyerEntries.length > 0 && F.count() + 2 <= this.preset.flyers) this.spawnAmbientKettle(ctx, camN, camE);
  }

  /** Release herd h and unlink it from its habitat cell (its roaming T. rex goes at the next sweep). */
  private releaseHerd(h: number): void {
    const H = this.herds;
    const C = this.cells;
    if (H.key[h] >= 0) {
      const slot = C.find(H.key[h]);
      if (slot >= 0 && C.status[slot] !== CELL_EMPTY && C.herd[slot] === h) C.herd[slot] = -1;
    }
    H.release(h);
  }

  /** The farthest unpinned live herd from the camera (-1 none); its distance in farD. */
  private farthestUnpinned(camN: number, camE: number): number {
    const H = this.herds;
    let best = -1;
    let bestD2 = -1;
    for (let h = 0; h < MAX_HERDS; h++) {
      if (!H.active[h] || H.pinned[h]) continue;
      const dn = H.cN[h] - camN;
      const de = H.cE[h] - camE;
      const d2 = dn * dn + de * de;
      if (d2 > bestD2) {
        bestD2 = d2;
        best = h;
      }
    }
    this.farD = best >= 0 ? Math.sqrt(bestD2) : 0;
    return best;
  }

  /** Release every roaming T. rex whose herd is gone (released, or its slot holds another key) or that is out of range. */
  private sweepAmbientAgents(camN: number, camE: number, R: number): void {
    const A = this.agents;
    const H = this.herds;
    const rel2 = R * 1.15 * (R * 1.15);
    let n = 0;
    for (let i = 0; i < A.capacity; i++) {
      if (!this.ambientAgent[i]) continue;
      const h = this.agentHerd[i];
      const dn = A.n[i] - camN;
      const de = A.e[i] - camE;
      if (!A.active[i] || h < 0 || !H.active[h] || H.key[h] !== this.agentHerdKey[i] || dn * dn + de * de > rel2) {
        if (A.active[i]) A.release(i);
        this.ambientAgent[i] = 0;
        this.agentHerd[i] = -1;
        this.agentHerdKey[i] = -1;
        continue;
      }
      n++;
    }
    this.debug.ambientRex = n;
  }

  /**
   * Place a roaming T. rex beside the nearest streamed prey herd (an unpinned Edmontosaurus or Triceratops herd)
   * whose cell draws one (rexRandom < the roster occupancy), at least REX_QUIET_M from the safari footprint and
   * without one yet; at most AMBIENT_REX_MAX alive, one agent slot always spare, never where the camera would see it
   * appear. Its spawn point is the herd's home + REX_RANGE_MIN..+SPAN at a drawn bearing (the opposite one if that is
   * water or the river bank): <= 2 terrain reads. Returns true when one was placed.
   */
  private placeRex(camN: number, camE: number): boolean {
    if (this.rexEntry < 0 || !(this.rexOccupancy > 0)) return false;
    const A = this.agents;
    const H = this.herds;
    let amb = 0;
    for (let i = 0; i < A.capacity; i++) amb += this.ambientAgent[i];
    if (amb >= AMBIENT_REX_MAX || A.count() >= MAX_AGENTS - 1) return false;
    let best = -1;
    let bestD2 = Infinity;
    for (let h = 0; h < MAX_HERDS; h++) {
      if (!H.active[h] || H.pinned[h] || H.key[h] < 0) continue;
      if (H.species[h] !== EDMONTOSAURUS && H.species[h] !== TRICERATOPS) continue;
      if (this.rexFailKey[h] === H.key[h]) continue;
      let taken = false;
      for (let i = 0; i < A.capacity; i++) if (this.ambientAgent[i] && this.agentHerd[i] === h) taken = true;
      if (taken) continue;
      const ci = Math.floor(H.key[h] / 65536) - 32768;
      const cj = (H.key[h] % 65536) - 32768;
      if (!(rexRandom(ci, cj, 0) < this.rexOccupancy)) continue;
      if (safariFootprintDist(H.homeN[h], H.homeE[h]) < REX_QUIET_M) continue;
      const dn = H.cN[h] - camN;
      const de = H.cE[h] - camE;
      const d2 = dn * dn + de * de;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = h;
      }
    }
    if (best < 0) return false;
    const key = H.key[best];
    const ci = Math.floor(key / 65536) - 32768;
    const cj = (key % 65536) - 32768;
    const r = REX_RANGE_MIN + REX_RANGE_SPAN * rexRandom(ci, cj, 1);
    const b0 = 2 * Math.PI * rexRandom(ci, cj, 2);
    let seen = false;
    for (let attempt = 0; attempt < 2; attempt++) {
      const b = b0 + attempt * Math.PI;
      const n = H.homeN[best] + r * Math.cos(b);
      const e = H.homeE[best] + r * Math.sin(b);
      // Never in sight as it appears: beyond REX_UNSEEN_M, or outside the last frame's view (else the other side,
      // or a later tick).
      const dn = n - camN;
      const de = e - camE;
      if (dn * dn + de * de <= REX_UNSEEN_M * REX_UNSEEN_M) {
        this.sphere.center.set(e, H.cH[best] + 4, -n);
        this.sphere.radius = 20;
        if (this.frustum.intersectsSphere(this.sphere)) {
          seen = true;
          continue;
        }
      }
      const s = this.terrain.sample(n, e, this.sample);
      if (s.ground < Math.max(s.standing, s.river) + 0.3 || (s.riverHalfWidth > 0 && s.riverDist < s.riverHalfWidth + HERD_BANK_MARGIN)) continue;
      const i = A.spawn(
        {
          species: 'tyrannosaurus',
          entry: this.rexEntry,
          north: n,
          east: e,
          ground: s.ground,
          heading: Math.atan2(H.cE[best] - e, H.cN[best] - n),
          scale: 1,
          variant: 0,
          seed: Math.floor(rexRandom(ci, cj, 3) * 4294967296) >>> 0,
        },
        AMBIENT_REX_BRAIN,
      );
      if (i < 0) return false;
      this.ambientAgent[i] = 1;
      this.agentHerd[i] = best;
      this.agentHerdKey[i] = key;
      this.debug.ambientRex = amb + 1;
      return true;
    }
    // Water (or the bank) on both sides: this herd gets none. (In sight: try again on a later tick.)
    if (!seen) this.rexFailKey[best] = key;
    return false;
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
    // One terrain read at the core: its surface height (terrainHeight's max of ground and water) and whether it is
    // near water, which weights the species (roster waterAffinity: the Pteranodon keeps to the water).
    const cn = this.core.x + f.driftN;
    const ce = this.core.y + f.driftE;
    const s = this.terrain.sample(cn, ce, this.sample);
    const ground = Math.max(s.ground, s.standing, s.river);
    const entry = kettleEntry(this.roster, this.flyerEntries, cellRandom(k, 0xa3b, 2), kettleNearWater(s));
    const re = this.roster.entries[entry];
    const birds = Math.min(this.preset.flyers - F.count(), re.groupMin + Math.floor(cellRandom(k, 0xa3b, 3) * (re.groupMax - re.groupMin + 1)));
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
    const agl = ctx.state.altitudeAGL;
    if (!(agl < SIGHT_AGL)) return;
    const H = this.herds;
    for (let h = 0; h < MAX_HERDS; h++) {
      if (!H.active[h]) continue;
      const sp = this.draws[this.entryDraw[H.entry[h]]]?.species;
      if (!sp) continue;
      this.sight(ctx, sp, Math.max(0, Math.hypot(H.cN[h] - ac.n, H.cE[h] - ac.e, H.cH[h] - ac.alt) - H.radius[h]));
    }
    const F = this.flyers;
    for (let i = 0; i < F.capacity; i++) {
      if (!F.active[i]) continue;
      const sp = this.draws[this.entryDraw[F.entry[i]]]?.species;
      if (!sp) continue;
      this.sight(ctx, sp, Math.hypot(F.n[i] - ac.n, F.e[i] - ac.e, F.alt[i] - ac.alt));
    }
    const A = this.agents;
    for (let i = 0; i < A.capacity; i++) {
      if (!A.active[i]) continue;
      const sp = this.draws[this.entryDraw[A.entry[i]]]?.species;
      if (!sp) continue;
      this.sight(ctx, sp, Math.hypot(A.n[i] - ac.n, A.e[i] - ac.e, A.h[i] - ac.alt));
    }
  }

  /** Emit 'faunaSighted' for a first approach within range, or one SIGHT_CLOSER m closer than the last emit. */
  private sight(ctx: SimContext, sp: FaunaSpeciesId, d: number): void {
    if (!(d < SIGHT_RANGE)) return;
    const last = this.sighted.get(sp);
    if (last !== undefined && !(d <= last - SIGHT_CLOSER)) return;
    this.sighted.set(sp, d);
    ctx.events.emit('faunaSighted', { species: sp, distanceM: Math.round(d) });
  }

  // ------------------------------------------------------------------------------------------------- render

  /**
   * The LOD for an instance of draw di at squared distance d2 (-1: beyond far2, its squared draw range: farR2, or
   * ambR2 for streamed animals): LOD0 while within its LOD0
   * range, under the species' LOD0 cap and the frame's LOD0 triangle pool; else LOD1 / LOD2 by range.
   */
  private pickLod(di: number, d2: number, far2: number): number {
    const d = this.draws[di];
    if (!(d2 < far2)) return -1;
    let lod = d2 < d.lod0R2 && this.lod0Used[di] < d.lod0Cap && this.poolLeft >= d.tris[0] ? 0 : d2 < d.lod1R2 ? 1 : 2;
    if (d.lod[lod].count >= d.lod[lod].capacity) lod = 2;
    return d.lod[lod].count >= d.lod[lod].capacity ? -1 : lod;
  }

  /** Write one instance at its LOD (and as a caster for the nearest LOD0s). */
  private emit(di: number, lod: number, east: number, alt: number, north: number, yaw: number, pitch: number, bank: number, phase: number, blend: number, flap: number, head: number, scale: number, variant: number): void {
    const draw = this.draws[di];
    const tgt = draw.lod[lod];
    writeInstance(tgt.array, tgt.count++, east, alt, north, yaw, pitch, bank, phase, blend, flap, head, scale, variant);
    if (lod !== 0) return;
    this.lod0Used[di]++;
    this.poolLeft -= draw.tris[0];
    const c = draw.caster;
    if (this.casterUsed[di] < this.preset.casters && c.count < c.capacity) {
      this.casterUsed[di]++;
      writeInstance(c.array, c.count++, east, alt, north, yaw, pitch, bank, phase, blend, flap, head, scale, variant);
    }
  }

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
    this.poolLeft = P.lod0TriPool;
    let visible = 0;

    // Solo agents first (few, and the showcase's stars).
    const A = this.agents;
    for (let i = 0; i < A.capacity && visible < P.groundVisible; i++) {
      if (!A.active[i]) continue;
      const di = this.entryDraw[A.entry[i]];
      const draw = this.draws[di];
      if (!draw) continue;
      const sc = A.scale[i] * draw.unit;
      const y = A.h[i] + draw.originM * sc;
      this.sphere.center.set(A.e[i], y + 2, -A.n[i]);
      this.sphere.radius = draw.radius * sc + 2;
      if (!this.frustum.intersectsSphere(this.sphere)) continue;
      const dx = A.e[i] - cx;
      const dy = y - cy;
      const dz = -A.n[i] - cz;
      const lod = this.pickLod(di, dx * dx + dy * dy + dz * dz, this.ambientAgent[i] ? draw.ambR2 : draw.farR2);
      if (lod < 0) continue;
      this.emit(di, lod, A.e[i], y, A.n[i], A.yaw[i], A.pitch[i], 0, A.phase[i], A.blend[i], A.flap[i], A.head[i], sc, A.variant[i]);
      visible++;
    }

    // Herds, nearest first (insertion sort of <= MAX_HERDS).
    const H = this.herds;
    let nh = 0;
    for (let h = 0; h < MAX_HERDS; h++) {
      if (!H.active[h]) continue;
      const ex = H.cE[h] - cx;
      const ey = H.cH[h] - cy;
      const ez = -H.cN[h] - cz;
      const d = Math.sqrt(ex * ex + ey * ey + ez * ez);
      let k = nh++;
      while (k > 0 && this.orderD[k - 1] > d) {
        this.order[k] = this.order[k - 1];
        this.orderD[k] = this.orderD[k - 1];
        k--;
      }
      this.order[k] = h;
      this.orderD[k] = d;
    }
    for (let o = 0; o < nh && visible < P.groundVisible; o++) {
      const h = this.order[o];
      const di = this.entryDraw[H.entry[h]];
      const draw = this.draws[di];
      if (!draw) continue;
      // The members' current spread (a scattered herd reaches far beyond its formation radius).
      const spread = Math.max(H.radius[h], this.herdSpread(h));
      const farR = H.pinned[h] ? draw.farR : draw.ambR;
      const far2 = H.pinned[h] ? draw.farR2 : draw.ambR2;
      if (this.orderD[o] - spread > farR) continue;
      this.sphere.center.set(H.cE[h], H.cH[h] + 2, -H.cN[h]);
      this.sphere.radius = spread + draw.radius * draw.unit * 1.5 + 30;
      if (!this.frustum.intersectsSphere(this.sphere)) continue;
      const base = h * MAX_HERD_SIZE;
      const size = H.size[h];
      for (let k = 0; k < size && visible < P.groundVisible; k++) {
        const i = base + k;
        const dx = H.mE[i] - cx;
        const dy = H.mH[i] - cy;
        const dz = -H.mN[i] - cz;
        const lod = this.pickLod(di, dx * dx + dy * dy + dz * dz, far2);
        if (lod < 0) continue;
        this.emit(di, lod, H.mE[i], H.mH[i], H.mN[i], H.yaw[i], H.pitch[i], 0, H.phase[i], H.blend[i], H.alert[i], H.head[i], H.scale[i] * draw.unit, H.variant[i]);
        visible++;
      }
    }

    // Flyers (silhouettes against the sky: a longer range).
    const F = this.flyers;
    for (let i = 0; i < F.capacity; i++) {
      if (!F.active[i]) continue;
      const di = this.entryDraw[F.entry[i]];
      const draw = this.draws[di];
      if (!draw) continue;
      const x = F.e[i];
      // The flyers' alt is their feet (the ground when standing); the rig's origin is the centre of mass above it.
      const y = F.alt[i] + draw.originM * F.scale[i];
      const z = -F.n[i];
      const d2 = (x - cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2;
      if (!(d2 < draw.farR2 * FLYER_RANGE_FACTOR * FLYER_RANGE_FACTOR)) continue;
      this.sphere.center.set(x, y, z);
      this.sphere.radius = draw.radius * F.scale[i] + 2;
      if (!this.frustum.intersectsSphere(this.sphere)) continue;
      // (pickLod's range test is the ground one: beyond it a flyer still draws at LOD2.)
      let lod = this.pickLod(di, Math.min(d2, draw.farR2 * 0.999), draw.farR2);
      if (lod < 0) continue;
      if (lod < 2 && !(d2 < draw.lod1R2)) lod = 2;
      this.emit(di, lod, x, y, F.n[i], F.heading[i], F.pitch[i], F.bank[i], F.phase[i], F.blend[i], F.flap[i], F.head[i], F.scale[i], F.variant[i]);
      visible++;
    }

    let tris = 0;
    let draws = 0;
    for (const d of this.draws) {
      for (let l = 0; l < 3; l++) {
        d.lod[l].commit();
        tris += d.lod[l].count * d.tris[l];
        if (d.lod[l].count > 0) draws++;
      }
      d.caster.commit();
    }
    this.stats.visible = visible;
    this.stats.tris = tris;
    this.stats.draws = draws;
    this.debug.triangles = tris;
    this.debug.herds = H.count();
    this.debug.animals = H.members();
    this.debug.flyers = F.count();
    this.debug.agents = A.count();
  }

  /** Farthest member of herd h from its centre (cN, cE, cH + 2), m. */
  private herdSpread(h: number): number {
    const H = this.herds;
    const base = h * MAX_HERD_SIZE;
    const cn = H.cN[h];
    const ce = H.cE[h];
    const ch = H.cH[h] + 2;
    let m2 = 0;
    for (let k = 0; k < H.size[h]; k++) {
      const i = base + k;
      const dn = H.mN[i] - cn;
      const de = H.mE[i] - ce;
      const dh = H.mH[i] - ch;
      const d2 = dn * dn + de * de + dh * dh;
      if (d2 > m2) m2 = d2;
    }
    return Math.sqrt(m2);
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

