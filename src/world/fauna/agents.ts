// Solo agents (Deep Time inc 2, WP0b contract, FROZEN for WP1-WP7): single large animals with a scripted brain
// (the showcase T. rex). Pure and three-free: structure-of-arrays state for MAX_AGENTS (4) agents in fixed typed
// arrays, zero allocations after construction, stepped every frame by the FaunaSystem after the herds.
//
// DIVISION OF LABOUR
//   - The BRAIN (brains.ts BRAINS[species], a SoloBrain) decides: every frame it sets the agent's wants
//     (wantSpeed, wantYaw, turnRate, accel), its action channel (flap: the roar for the theropod), its head turn,
//     an optional gait override (blendOverride >= 0), its state machine (state, stateT) and up to AGENT_MEM floats
//     of its own memory (mem[i * AGENT_MEM + k]). It may read the terrain through ctx.terrain while
//     ctx.terrainLeft() > 0, and act on the herds through ctx.herds (setExternalThreat, herdCentroid, herdRadius,
//     nearestMember, kind, active ...).
//   - The POOL moves the agent: speed toward wantSpeed at `accel`, heading toward wantYaw at `turnRate` (on the spot
//     when stopped), position along the heading, gait phase by distance / the species' stride at the drawn gait (no
//     foot skate: profiles.ts strideM), gaitBlend from the speed (0 stand .. 1 walk up to formation.runFrom, then
//     1 + (v - runFrom) / runSpan up to 2) unless the brain overrides it, and the ground: one terrain read when the
//     agent has moved SNAP_MOVE m or SNAP_S s since its last one, while the per-frame budget lasts (between reads
//     it follows the slope of its last two reads).
//
// BUDGET: AGENT_RESERVE (12) terrain reads per frame for all agents together (brains first, then the ground
// snaps); the CPU budget is <= 0.03 ms per frame for 4 agents. ZERO ALLOCATION per frame (tests/fauna/agents.test.ts
// measures it): note that V8's Math.hypot allocates (~64 B a call), so per-frame code uses Math.sqrt(x*x + y*y), and
// keeps numbers in typed arrays or class fields (a double stored into an object literal's field allocates).
//
// CLOCK: ctx.time is the herds' clock (HerdPool.time), so a brain's setExternalThreat(..., ctx.time + 20, ...)
// lasts 20 s. The pool's own `time` equals it (FaunaSystem steps both with the same dt).
//
// INSTANCE CHANNELS written by FaunaSystem for an agent: aInstA (e, h, n, yaw), aInstB (pitch, 0, phase, blend),
// aInstC (flap, head, scale * unit, variant): the rig's meanings (species/index.ts).

import type * as Anchors from '../era/cretaceousAnchors';
import { cellRandom, type FaunaTerrain } from './habitat';
import type { AircraftView, HerdPool } from './herds';
import { AGENT_RESERVE, MAX_AGENTS } from './presets';
import { PROFILES, profileStride, type SpeciesProfile } from './profiles';
import { FAUNA_SPECIES_IDS, type FaunaSpeciesId } from './types';

/** Floats of private memory per agent for its brain (mem[i * AGENT_MEM + k]). */
export const AGENT_MEM = 8;
/** An agent re-reads the ground once it has moved this far, m, or after SNAP_S. */
export const SNAP_MOVE = 1.5;
export const SNAP_S = 1;

const wrapPi = (a: number): number => a - 2 * Math.PI * Math.floor((a + Math.PI) / (2 * Math.PI));

/** What a brain sees (one object, reused every frame: brains must not keep references to its fields' targets). */
export interface AgentContext {
  /** The herds' clock (HerdPool.time), s. */
  time: number;
  /** The frame's dt (s, > 0 when brains run). */
  dt: number;
  /** The aircraft (NED, MSL), or null (no state yet). */
  aircraft: AircraftView | null;
  /** Counted terrain (FaunaSystem's): reads count against the frame's fauna cap. Check terrainLeft() first. */
  terrain: FaunaTerrain;
  /** Terrain reads the agents may still take this frame (AGENT_RESERVE minus those taken). */
  terrainLeft(): number;
  /** The herds: herdCentroid, herdRadius, nearestMember, setExternalThreat, kind (REACTION_KIND), active ... */
  herds: HerdPool;
  /** Slot of the showcase river herd in `herds` (-1 none). */
  riverHerd: number;
  /** The safari's computed anchors (TREX_LAIR, RIVER_HERD_SITE, TRICERATOPS_GROUP, SAFARI, pathToNed ...). */
  anchors: typeof Anchors;
  /** Stride (m per gait cycle) of a species at a gaitBlend and body scale (profiles.ts). */
  strideM(id: FaunaSpeciesId, gaitBlend: number, scale: number): number;
}

/** A species' behaviour (brains.ts BRAINS). Must not allocate in step. */
export interface SoloBrain {
  /** Once, right after the agent spawns (position, heading, home and seed are set; state 0, mem zeroed). */
  init(pool: SoloAgentPool, i: number, ctx: AgentContext): void;
  /** Every frame with dt > 0, before the pool moves the agent. */
  step(pool: SoloAgentPool, i: number, ctx: AgentContext): void;
}

export interface AgentSpawn {
  species: FaunaSpeciesId;
  /** Roster entry index (FaunaSystem's draw lookup). */
  entry: number;
  north: number;
  east: number;
  /** Ground MSL at the spawn, m. */
  ground: number;
  /** Heading, rad (0 north, clockwise). */
  heading: number;
  /** Roster scale (x the species' real size; FaunaSystem multiplies by the mesh unit when drawing). */
  scale: number;
  /** Integer variant (the pool adds the per-animal fraction). */
  variant: number;
  seed: number;
}

/** The AgentContext (a class: its numeric fields are updated in place every frame, with no allocation). */
class AgentContextImpl implements AgentContext {
  time = 0;
  dt = 0;
  aircraft: AircraftView | null = null;
  riverHerd = -1;
  constructor(
    private readonly pool: SoloAgentPool,
    readonly herds: HerdPool,
    public terrain: FaunaTerrain,
    readonly anchors: typeof Anchors,
  ) {}
  terrainLeft(): number {
    const t = this.pool.budgetTerrain;
    return t ? Math.max(0, AGENT_RESERVE - (t.calls - this.pool.budgetStart)) : 0;
  }
  strideM(id: FaunaSpeciesId, gaitBlend: number, scale: number): number {
    return profileStride(PROFILES[id], gaitBlend, scale);
  }
}

export class SoloAgentPool {
  readonly capacity = MAX_AGENTS;
  /** Clock (sum of dt), s: equal to the herds' clock in FaunaSystem. */
  time = 0;

  readonly active = new Uint8Array(MAX_AGENTS);
  /** Species index (FAUNA_SPECIES_IDS) and roster entry. */
  readonly species = new Uint8Array(MAX_AGENTS);
  readonly entry = new Int16Array(MAX_AGENTS);
  readonly seed = new Uint32Array(MAX_AGENTS);
  /** Position NED and ground MSL (the body origin of a ground rig is on the ground), m. */
  readonly n = new Float64Array(MAX_AGENTS);
  readonly e = new Float64Array(MAX_AGENTS);
  readonly h = new Float64Array(MAX_AGENTS);
  readonly homeN = new Float64Array(MAX_AGENTS);
  readonly homeE = new Float64Array(MAX_AGENTS);
  readonly yaw = new Float32Array(MAX_AGENTS);
  readonly pitch = new Float32Array(MAX_AGENTS);
  readonly speed = new Float32Array(MAX_AGENTS);
  readonly phase = new Float32Array(MAX_AGENTS);
  readonly blend = new Float32Array(MAX_AGENTS);
  /** Action channel (aInstC.x): the theropod's roar 0..1. Brain-written. */
  readonly flap = new Float32Array(MAX_AGENTS);
  /** Head turn, rad (+ right). Brain-written. */
  readonly head = new Float32Array(MAX_AGENTS);
  readonly scale = new Float32Array(MAX_AGENTS);
  readonly variant = new Float32Array(MAX_AGENTS);
  /** Brain wants: speed (m/s), heading (rad), turn rate (rad/s), acceleration (m/s^2). */
  readonly wantSpeed = new Float32Array(MAX_AGENTS);
  readonly wantYaw = new Float32Array(MAX_AGENTS);
  readonly turnRate = new Float32Array(MAX_AGENTS);
  readonly accel = new Float32Array(MAX_AGENTS);
  /** Gait override: >= 0 sets the drawn gaitBlend target directly (eased); < 0 derives it from the speed. */
  readonly blendOverride = new Float32Array(MAX_AGENTS);
  /** Brain state id and when it was entered (pool clock). */
  readonly state = new Uint8Array(MAX_AGENTS);
  readonly stateT = new Float64Array(MAX_AGENTS);
  /** Brain memory, AGENT_MEM floats per agent. */
  readonly mem = new Float64Array(MAX_AGENTS * AGENT_MEM);
  /** Ground snaps: the last two reads (position and height). */
  readonly snapN = new Float64Array(MAX_AGENTS);
  readonly snapE = new Float64Array(MAX_AGENTS);
  readonly snapH = new Float64Array(MAX_AGENTS);
  readonly snapT = new Float64Array(MAX_AGENTS);
  readonly slope = new Float32Array(MAX_AGENTS);

  /** Diagnostics: terrain reads by the agents last step. */
  terrainCalls = 0;
  private readonly brains: (SoloBrain | null)[] = new Array<SoloBrain | null>(MAX_AGENTS).fill(null);
  private readonly prof: SpeciesProfile[] = new Array<SpeciesProfile>(MAX_AGENTS).fill(PROFILES.edmontosaurus);
  /** Reads the agents had taken when the step began (on terrain.calls). */
  budgetStart = 0;
  budgetTerrain: FaunaTerrain | null = null;
  private readonly ctx: AgentContextImpl;

  constructor(herds: HerdPool, terrain: FaunaTerrain, anchors: typeof Anchors) {
    this.ctx = new AgentContextImpl(this, herds, terrain, anchors);
  }

  /** The context brains get (for tests and FaunaSystem; riverHerd is set by the owner). */
  context(): AgentContext {
    return this.ctx;
  }

  count(): number {
    let c = 0;
    for (let i = 0; i < MAX_AGENTS; i++) c += this.active[i];
    return c;
  }

  /** Species id of agent i. */
  speciesId(i: number): FaunaSpeciesId {
    return FAUNA_SPECIES_IDS[this.species[i]];
  }

  /** Start an agent with a brain (null: it stands still); returns its slot or -1 when full. No terrain reads. */
  spawn(sp: AgentSpawn, brain: SoloBrain | null): number {
    let i = -1;
    for (let k = 0; k < MAX_AGENTS; k++) {
      if (!this.active[k]) {
        i = k;
        break;
      }
    }
    if (i < 0) return -1;
    this.active[i] = 1;
    this.species[i] = Math.max(0, FAUNA_SPECIES_IDS.indexOf(sp.species));
    this.prof[i] = PROFILES[sp.species];
    this.entry[i] = sp.entry;
    this.seed[i] = sp.seed >>> 0;
    this.n[i] = this.homeN[i] = this.snapN[i] = sp.north;
    this.e[i] = this.homeE[i] = this.snapE[i] = sp.east;
    this.h[i] = this.snapH[i] = sp.ground;
    this.snapT[i] = this.time;
    this.slope[i] = 0;
    this.yaw[i] = this.wantYaw[i] = sp.heading;
    this.pitch[i] = 0;
    this.speed[i] = this.wantSpeed[i] = 0;
    this.turnRate[i] = 1;
    this.accel[i] = 2;
    this.blendOverride[i] = -1;
    this.phase[i] = cellRandom(sp.seed, 0xa6e, 1);
    this.blend[i] = 0;
    this.flap[i] = 0;
    this.head[i] = 0;
    this.scale[i] = sp.scale;
    this.variant[i] = sp.variant + 0.99 * cellRandom(sp.seed, 0xa6e, 2);
    this.state[i] = 0;
    this.stateT[i] = this.time;
    this.mem.fill(0, i * AGENT_MEM, (i + 1) * AGENT_MEM);
    this.brains[i] = brain;
    this.ctx.time = this.time;
    brain?.init(this, i, this.ctx);
    return i;
  }

  release(i: number): void {
    this.active[i] = 0;
    this.brains[i] = null;
  }

  /** Enter brain state s now. */
  setState(i: number, s: number): void {
    this.state[i] = s;
    this.stateT[i] = this.time;
  }

  /**
   * Advance every agent by dt: brains, then motion and ground. Terrain reads are capped at AGENT_RESERVE for the
   * step (counted on terrain.calls). Returns the reads used.
   */
  step(dt: number, ac: AircraftView | null, terrain: FaunaTerrain, riverHerd: number): number {
    if (!(dt > 0)) return 0;
    this.time += dt;
    const ctx = this.ctx;
    ctx.time = this.time;
    ctx.dt = dt;
    ctx.aircraft = ac;
    ctx.terrain = terrain;
    ctx.riverHerd = riverHerd;
    this.budgetTerrain = terrain;
    this.budgetStart = terrain.calls;
    for (let i = 0; i < MAX_AGENTS; i++) {
      if (!this.active[i]) continue;
      this.brains[i]?.step(this, i, ctx);
    }
    for (let i = 0; i < MAX_AGENTS; i++) if (this.active[i]) this.move(i, dt, terrain);
    this.terrainCalls = terrain.calls - this.budgetStart;
    this.budgetTerrain = null;
    return this.terrainCalls;
  }

  private move(i: number, dt: number, terrain: FaunaTerrain): void {
    const P = this.prof[i];
    const F = P.formation;
    // Speed and heading.
    const want = Math.max(0, this.wantSpeed[i] || 0);
    const sp = this.speed[i];
    const maxDv = Math.max(0.1, this.accel[i]) * dt;
    const dv = want - sp;
    const ns = sp + (dv > maxDv ? maxDv : dv < -1.5 * maxDv ? -1.5 * maxDv : dv);
    this.speed[i] = ns > 0 ? ns : 0;
    const dy = wrapPi((this.wantYaw[i] || 0) - this.yaw[i]);
    const maxTurn = Math.max(0, this.turnRate[i]) * dt;
    this.yaw[i] = wrapPi(this.yaw[i] + (dy > maxTurn ? maxTurn : dy < -maxTurn ? -maxTurn : dy));
    const cy = Math.cos(this.yaw[i]);
    const sy = Math.sin(this.yaw[i]);
    const step = this.speed[i] * dt;
    this.n[i] += cy * step;
    this.e[i] += sy * step;
    // Ground: a read when it has moved SNAP_MOVE or SNAP_S has passed, while the budget lasts; else the slope.
    const mn = this.n[i] - this.snapN[i];
    const me = this.e[i] - this.snapE[i];
    const moved = Math.sqrt(mn * mn + me * me);
    if ((moved >= SNAP_MOVE || this.time - this.snapT[i] >= SNAP_S) && this.ctx.terrainLeft() > 0) {
      const g = terrain.height(this.n[i], this.e[i]);
      if (Number.isFinite(g)) {
        if (moved > 0.5) this.slope[i] = Math.max(-1, Math.min(1, (g - this.snapH[i]) / moved));
        this.snapN[i] = this.n[i];
        this.snapE[i] = this.e[i];
        this.snapH[i] = g;
        this.snapT[i] = this.time;
      }
    }
    const along = (this.n[i] - this.snapN[i]) * cy + (this.e[i] - this.snapE[i]) * sy;
    this.h[i] = this.snapH[i] + this.slope[i] * along;
    this.pitch[i] += (Math.atan(this.slope[i]) - this.pitch[i]) * Math.min(1, 2 * dt);
    // Gait: phase by distance / the stride drawn; blend from the speed (or the brain's override).
    const drawnRun = Math.min(1, Math.max(0, this.blend[i] - 1));
    const stride = (P.strideM.walk + (P.strideM.run - P.strideM.walk) * drawnRun) * Math.max(0.05, this.scale[i]);
    const ph = this.phase[i] + step / stride;
    this.phase[i] = ph - Math.floor(ph);
    const v = this.speed[i];
    const run = v > F.runFrom ? Math.min(1, (v - F.runFrom) / F.runSpan) : 0;
    const target = this.blendOverride[i] >= 0 ? Math.min(2, this.blendOverride[i]) : v < 0.25 ? v / 0.25 : v <= F.runFrom ? 1 : 1 + run;
    this.blend[i] += (target - this.blend[i]) * Math.min(1, 3 * dt);
    // NaN guard: a broken agent goes home and stands.
    if (!(Number.isFinite(this.n[i]) && Number.isFinite(this.e[i]) && Number.isFinite(this.h[i]) && Number.isFinite(this.yaw[i]))) {
      this.n[i] = this.snapN[i] = this.homeN[i];
      this.e[i] = this.snapE[i] = this.homeE[i];
      this.h[i] = this.snapH[i] = Number.isFinite(this.snapH[i]) ? this.snapH[i] : 0;
      this.yaw[i] = this.wantYaw[i] = 0;
      this.speed[i] = this.wantSpeed[i] = 0;
      this.slope[i] = 0;
    }
  }
}
