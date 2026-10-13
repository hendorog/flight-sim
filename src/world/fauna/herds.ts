// Ground herds (Deep Time): Edmontosaurus herds of 30-80 grazing and wandering beside water, reacting to the
// aircraft (reactions.ts). Pure and three-free: structure-of-arrays state in fixed typed arrays (no allocation
// after construction), stepped every frame by the FaunaSystem.
//
// INCREMENT 2 (WP0b contract, FROZEN for WP1-WP7):
// - Each herd has a species (HerdSpawn.species, default Edmontosaurus) and reads its formation, strides, gait
//   thresholds and reaction from profiles.ts PROFILES[species] (Edmontosaurus's numbers are inc 1's, unchanged).
//   STRIDE_WALK / STRIDE_RUN remain as the Edmontosaurus aliases.
// - Reaction kinds (profiles.ts ReactionKind): 'flee' (inc 1), 'face' (alarmed members turn on the spot toward
//   the source and stop, alert channel 1, until calm), 'ignore' (heads turn only).
// - EXTERNAL THREATS: setExternalThreat(h, n, e, vN, vE, untilT, level, lead). PRECEDENCE:
//     * while an external FLEE is active (time < untilT) it OWNS the flee direction (reactions.ts
//       externalFleeDirection: away from the source position, `lead` of its heading mixed in) and the wave
//       origin (the herd edge nearest the source: its nearest member; the wave then spreads at waveSpeed);
//     * the aircraft can only ESCALATE: a member still waiting for the alarm wave (alert, not yet running)
//       starts running at once; it never re-aims an active external flee;
//     * after untilT the aircraft rules apply as in inc 1 (and the herd calms calmMin-calmMax s after untilT).
//   An external ALERT only raises heads (and stills 'flee'/'face' herds) toward the source. untilT is in this
//   pool's clock (HerdPool.time, which FaunaSystem advances with the agents' clock).
// - Pinned herds beyond NEAR_SNAP_M (the far showcase herds) take at most 2 terrain reads per brain tick: the
//   centroid every tick, plus one of the plane's two gradient samples or the wander look-ahead in turn.
//
// - The herd centroid grazes in place or wanders at walking pace; every brain tick (10 Hz, round-robin) it looks
//   40 m ahead and turns away from water, slopes > 0.3, the airfield and dry ground far from water, and keeps a
//   leash on its home site.
// - Members hold jittered sunflower formation offsets about the centroid (index neighbours i +- 1, 8, 13 are
//   spatial neighbours, which makes separation cheap), steer toward them, and advance their gait phase by
//   distance / stride so the feet do not skate.
// - Ground: within NEAR_SNAP_M of the camera each member is snapped once per brain tick (one terrain sample), and
//   follows the herd's local terrain plane between ticks; farther herds use the centroid height plus that plane.
//   Every read is counted against the per-frame budget (TERRAIN_CALLS_PER_FRAME); what does not fit waits.

import { makeSample, type TerrainSample } from '../terrain/heightfield';
import { HERD_MIN_AIRPORT_BLEND, HERD_MAX_RIVER_DIST, cellRandom, type FaunaTerrain } from './habitat';
import { PROFILES, type SpeciesProfile } from './profiles';
import { MAX_HERDS, MAX_HERD_SIZE } from './presets';
import { THREAT, alarmDelay, calmDelay, closingSpeed, externalFleeDirection, fleeDirection, fleeSpeed, speciesThreat } from './reactions';
import { FAUNA_SPECIES_IDS, type FaunaSpeciesId } from './types';

/** Brain tick period, s. */
export const BRAIN_DT = 0.1;
/** Herds nearer the camera than this snap every member to the ground; farther ones use the herd plane, m. */
export const NEAR_SNAP_M = 2500;
const GOLDEN = Math.PI * (3 - Math.sqrt(5));
/** Index offsets of a sunflower point's spatial neighbours. */
const NEIGHBOURS = [1, 8, 13] as const;
/** Stride per gait cycle at scale 1, m: walk and run, of the Edmontosaurus (aliases of PROFILES.edmontosaurus.strideM;
 * every herd uses its own species' profile). */
export const STRIDE_WALK = PROFILES.edmontosaurus.strideM.walk;
export const STRIDE_RUN = PROFILES.edmontosaurus.strideM.run;
/** Alertness (head up) follows its target at this rate, 1/s (~0.4 s to settle). */
const ALERT_RATE = 6;
const MAX_SLOPE = 0.3;
const PLANE_STEP = 30;
/** Facing members turn on the spot toward the source at this rate, rad/s. */
const FACE_TURN_RATE = 1.0;
/** Reaction kinds as stored per herd (HerdPool.kind). */
export const REACTION_KIND = { flee: 0, face: 1, ignore: 2 } as const;
/** What an alarmed herd is doing (HerdPool.react): running, or facing the source. */
export const ALARM = { run: 0, face: 1 } as const;
/** A member is snapped to the ground again once it has moved this far (|dn| + |de|) since its last snap, m. */
const SNAP_MOVE = 1.5;

export const HERD_MODE = { graze: 0, walk: 1 } as const;

/** What the herds need of the aircraft (from ctx.state), NED m and m/s; alt is MSL. */
export interface AircraftView {
  n: number;
  e: number;
  alt: number;
  vN: number;
  vE: number;
  vD: number;
  tas: number;
}

export interface HerdSpawn {
  north: number;
  east: number;
  ground: number;
  size: number;
  entry: number;
  scale: number;
  variant: number;
  /** Seed of this herd's random draws (cell hash, epoch). */
  seed: number;
  /** Initial heading, rad. */
  heading: number;
  /** Never released for distance (the showcase herds). */
  pinned: boolean;
  /** The species (its profile drives formation, gait and reaction); default 'edmontosaurus'. */
  species?: FaunaSpeciesId;
}

/** Herd centroid out-parameter (herdCentroid). */
export interface HerdCentroid {
  north: number;
  east: number;
  /** Ground height at the centroid, MSL m. */
  ground: number;
}

const wrapPi = (a: number): number => a - 2 * Math.PI * Math.floor((a + Math.PI) / (2 * Math.PI));

function rand(seed: number, k: number): number {
  return cellRandom(seed, 0x5eed, k);
}

export class HerdPool {
  readonly capacity = MAX_HERDS;
  readonly memberCap = MAX_HERD_SIZE;
  /** Internal clock (sum of dt), s. */
  time = 0;

  // ---- per herd
  readonly active = new Uint8Array(MAX_HERDS);
  readonly pinned = new Uint8Array(MAX_HERDS);
  readonly size = new Uint8Array(MAX_HERDS);
  readonly entry = new Int16Array(MAX_HERDS);
  /** Owner's key (habitat cell key; -1 for scripted herds). */
  readonly key = new Float64Array(MAX_HERDS);
  readonly seed = new Uint32Array(MAX_HERDS);
  readonly cN = new Float64Array(MAX_HERDS);
  readonly cE = new Float64Array(MAX_HERDS);
  readonly cH = new Float64Array(MAX_HERDS);
  /** Local terrain plane gradient, dh/dn and dh/de. */
  readonly gN = new Float64Array(MAX_HERDS);
  readonly gE = new Float64Array(MAX_HERDS);
  readonly homeN = new Float64Array(MAX_HERDS);
  readonly homeE = new Float64Array(MAX_HERDS);
  readonly heading = new Float64Array(MAX_HERDS);
  readonly mode = new Uint8Array(MAX_HERDS);
  readonly modeUntil = new Float64Array(MAX_HERDS);
  readonly modeCount = new Uint32Array(MAX_HERDS);
  /** Formation radius, m. */
  readonly radius = new Float64Array(MAX_HERDS);
  readonly nextBrain = new Float64Array(MAX_HERDS);
  /** Threat level (reactions.ts THREAT) at the last brain tick. */
  readonly threat = new Uint8Array(MAX_HERDS);
  /** Fleeing: 1 from the alarm until calmAt. */
  readonly fleeing = new Uint8Array(MAX_HERDS);
  readonly alertUntil = new Float64Array(MAX_HERDS);
  readonly calmAt = new Float64Array(MAX_HERDS);
  readonly alarmT = new Float64Array(MAX_HERDS);
  /** Aircraft position and ground velocity at the last flee tick (the ground track the herd runs from). */
  readonly trackN = new Float64Array(MAX_HERDS);
  readonly trackE = new Float64Array(MAX_HERDS);
  readonly trackVN = new Float64Array(MAX_HERDS);
  readonly trackVE = new Float64Array(MAX_HERDS);
  /** Members not yet snapped this brain cycle (round-robin cursor when the budget runs short). */
  readonly snapCursor = new Uint8Array(MAX_HERDS);
  /** Species (index in FAUNA_SPECIES_IDS) and its reaction kind (REACTION_KIND). */
  readonly species = new Uint8Array(MAX_HERDS);
  readonly kind = new Uint8Array(MAX_HERDS);
  /** While fleeing: ALARM.run or ALARM.face. */
  readonly react = new Uint8Array(MAX_HERDS);
  /** The point a facing herd turns toward (the threat's position at the last brain tick). */
  readonly faceN = new Float64Array(MAX_HERDS);
  readonly faceE = new Float64Array(MAX_HERDS);
  /** External threat (setExternalThreat): until when (pool clock), level (THREAT), source position, velocity, lead. */
  readonly extUntil = new Float64Array(MAX_HERDS);
  readonly extLevel = new Uint8Array(MAX_HERDS);
  readonly extN = new Float64Array(MAX_HERDS);
  readonly extE = new Float64Array(MAX_HERDS);
  readonly extVN = new Float64Array(MAX_HERDS);
  readonly extVE = new Float64Array(MAX_HERDS);
  readonly extLead = new Float32Array(MAX_HERDS);
  /** Brain ticks of a far pinned herd (which of its cheap reads it takes). */
  readonly farTick = new Uint32Array(MAX_HERDS);
  /** Each herd's species profile. */
  private readonly prof: SpeciesProfile[] = new Array<SpeciesProfile>(MAX_HERDS).fill(PROFILES.edmontosaurus);

  // ---- per member (herd h, member k at h * MAX_HERD_SIZE + k)
  readonly mN = new Float64Array(MAX_HERDS * MAX_HERD_SIZE);
  readonly mE = new Float64Array(MAX_HERDS * MAX_HERD_SIZE);
  readonly mH = new Float64Array(MAX_HERDS * MAX_HERD_SIZE);
  readonly snapN = new Float64Array(MAX_HERDS * MAX_HERD_SIZE);
  readonly snapE = new Float64Array(MAX_HERDS * MAX_HERD_SIZE);
  readonly snapH = new Float64Array(MAX_HERDS * MAX_HERD_SIZE);
  readonly offN = new Float32Array(MAX_HERDS * MAX_HERD_SIZE);
  readonly offE = new Float32Array(MAX_HERDS * MAX_HERD_SIZE);
  readonly yaw = new Float32Array(MAX_HERDS * MAX_HERD_SIZE);
  readonly speed = new Float32Array(MAX_HERDS * MAX_HERD_SIZE);
  readonly pitch = new Float32Array(MAX_HERDS * MAX_HERD_SIZE);
  readonly phase = new Float32Array(MAX_HERDS * MAX_HERD_SIZE);
  readonly blend = new Float32Array(MAX_HERDS * MAX_HERD_SIZE);
  readonly head = new Float32Array(MAX_HERDS * MAX_HERD_SIZE);
  /** Alertness 0..1 (aInstC.x for the hadrosaur rig: head up and still; also carried while fleeing). */
  readonly alert = new Float32Array(MAX_HERDS * MAX_HERD_SIZE);
  readonly scale = new Float32Array(MAX_HERDS * MAX_HERD_SIZE);
  readonly variant = new Float32Array(MAX_HERDS * MAX_HERD_SIZE);
  /** When the alarm reaches this member (Infinity: not alarmed). */
  readonly fleeT0 = new Float64Array(MAX_HERDS * MAX_HERD_SIZE);
  readonly fleeDN = new Float32Array(MAX_HERDS * MAX_HERD_SIZE);
  readonly fleeDE = new Float32Array(MAX_HERDS * MAX_HERD_SIZE);
  /** 1 while snapH is this member's own ground sample (0: the herd plane). */
  readonly snapped = new Uint8Array(MAX_HERDS * MAX_HERD_SIZE);

  /** Diagnostics: brain ticks run last step, ticks deferred for lack of terrain budget. */
  ticks = 0;
  deferred = 0;

  private cursor = 0;
  private readonly s: TerrainSample = makeSample();
  private readonly dir = { n: 0, e: 0 };

  /** Live herds. */
  count(): number {
    let n = 0;
    for (let h = 0; h < MAX_HERDS; h++) n += this.active[h];
    return n;
  }

  /** Live members over all herds. */
  members(): number {
    let n = 0;
    for (let h = 0; h < MAX_HERDS; h++) if (this.active[h]) n += this.size[h];
    return n;
  }

  /** Start a herd; returns its slot or -1 when full. No terrain reads (members take the site plane until snapped). */
  spawn(sp: HerdSpawn, key: number): number {
    let h = -1;
    for (let i = 0; i < MAX_HERDS; i++) {
      if (!this.active[i]) {
        h = i;
        break;
      }
    }
    if (h < 0) return -1;
    const size = Math.max(1, Math.min(MAX_HERD_SIZE, sp.size | 0));
    const speciesId = sp.species ?? 'edmontosaurus';
    const P = PROFILES[speciesId];
    const F = P.formation;
    this.prof[h] = P;
    this.species[h] = Math.max(0, FAUNA_SPECIES_IDS.indexOf(speciesId));
    this.kind[h] = REACTION_KIND[P.reaction.kind];
    this.react[h] = ALARM.run;
    this.extUntil[h] = -Infinity;
    this.extLevel[h] = THREAT.none;
    this.farTick[h] = 0;
    this.active[h] = 1;
    this.pinned[h] = sp.pinned ? 1 : 0;
    this.size[h] = size;
    this.entry[h] = sp.entry;
    this.key[h] = key;
    this.seed[h] = sp.seed >>> 0;
    this.cN[h] = this.homeN[h] = sp.north;
    this.cE[h] = this.homeE[h] = sp.east;
    this.cH[h] = sp.ground;
    this.gN[h] = this.gE[h] = 0;
    this.heading[h] = sp.heading;
    this.mode[h] = HERD_MODE.graze;
    this.modeCount[h] = 0;
    this.modeUntil[h] = this.time + 30 + 90 * rand(sp.seed, 1);
    this.threat[h] = THREAT.none;
    this.fleeing[h] = 0;
    this.alertUntil[h] = -Infinity;
    this.calmAt[h] = -Infinity;
    this.alarmT[h] = -Infinity;
    this.snapCursor[h] = 0;
    // Stagger the brains.
    this.nextBrain[h] = this.time + BRAIN_DT * ((h * 7) % 10) * 0.1;
    // Sunflower formation, stretched 1.5x along the heading (herds string out along a bank), jittered.
    const ch = Math.cos(sp.heading);
    const sh = Math.sin(sp.heading);
    let rmax = 0;
    for (let k = 0; k < size; k++) {
      const i = h * MAX_HERD_SIZE + k;
      const r = F.spacing * sp.scale * Math.sqrt(k + 0.5);
      const a = k * GOLDEN;
      const along = F.stringOut * r * Math.cos(a) + 2.5 * (rand(sp.seed, 100 + k) - 0.5);
      const across = r * Math.sin(a) + 2.5 * (rand(sp.seed, 200 + k) - 0.5);
      this.offN[i] = along * ch - across * sh;
      this.offE[i] = along * sh + across * ch;
      rmax = Math.max(rmax, Math.hypot(this.offN[i], this.offE[i]));
      this.mN[i] = this.snapN[i] = sp.north + this.offN[i];
      this.mE[i] = this.snapE[i] = sp.east + this.offE[i];
      this.mH[i] = this.snapH[i] = sp.ground;
      this.yaw[i] = sp.heading + 1.2 * (rand(sp.seed, 300 + k) - 0.5);
      this.speed[i] = 0;
      this.pitch[i] = 0;
      this.phase[i] = rand(sp.seed, 400 + k);
      this.blend[i] = 0;
      this.head[i] = 0;
      this.alert[i] = 0;
      // One in ten is a juvenile.
      const juvenile = rand(sp.seed, 500 + k) < 0.1;
      this.scale[i] = sp.scale * (juvenile ? 0.5 + 0.1 * rand(sp.seed, 600 + k) : 0.88 + 0.2 * rand(sp.seed, 600 + k));
      // Integer variant plus a per-animal fraction (individual tint and idle timing in the material).
      this.variant[i] = sp.variant + 0.99 * rand(sp.seed, 700 + k);
      this.fleeT0[i] = Infinity;
      this.fleeDN[i] = this.fleeDE[i] = 0;
      this.snapped[i] = 0;
    }
    this.radius[h] = rmax;
    return h;
  }

  release(h: number): void {
    this.active[h] = 0;
  }

  /** The species profile of herd h. */
  profile(h: number): SpeciesProfile {
    return this.prof[h];
  }

  /** Herd h's centroid (formation centre; it follows the members while they flee) and the ground there. */
  herdCentroid(h: number, out: HerdCentroid): HerdCentroid {
    out.north = this.cN[h];
    out.east = this.cE[h];
    out.ground = this.cH[h];
    return out;
  }

  /** Herd h's formation radius, m (members scatter beyond it while fleeing). */
  herdRadius(h: number): number {
    return this.radius[h];
  }

  /** The member (global index h * memberCap + k) of herd h nearest (n, e), or -1 for an inactive herd. */
  nearestMember(h: number, n: number, e: number): number {
    if (!(h >= 0 && h < MAX_HERDS) || !this.active[h]) return -1;
    const base = h * MAX_HERD_SIZE;
    let best = -1;
    let bd = Infinity;
    for (let k = 0; k < this.size[h]; k++) {
      const d = (this.mN[base + k] - n) ** 2 + (this.mE[base + k] - e) ** 2;
      if (d < bd) {
        bd = d;
        best = base + k;
      }
    }
    return best;
  }

  /**
   * An external threat to herd h (a predator, or any scripted source) at (n, e) moving at (vN, vE) m/s, active
   * until untilT (this pool's clock, HerdPool.time) at `level` (THREAT.alert: heads up toward it; THREAT.flee:
   * the herd's reaction kind: run / face / heads only). `lead` 0..1: share of the source's heading in the flee
   * direction (0 = straight away from the source). Call it again to move the source or extend the threat (the
   * alarm wave is not restarted). Takes effect at the herd's next brain tick (<= BRAIN_DT). Returns false for an
   * inactive herd. See the PRECEDENCE rules at the top of this file.
   */
  setExternalThreat(h: number, n: number, e: number, vN: number, vE: number, untilT: number, level: number, lead = 0): boolean {
    if (!(h >= 0 && h < MAX_HERDS) || !this.active[h]) return false;
    if (!(Number.isFinite(n) && Number.isFinite(e) && untilT === untilT)) return false;
    this.extN[h] = n;
    this.extE[h] = e;
    this.extVN[h] = Number.isFinite(vN) ? vN : 0;
    this.extVE[h] = Number.isFinite(vE) ? vE : 0;
    this.extUntil[h] = untilT;
    this.extLevel[h] = level >= THREAT.flee ? THREAT.flee : level >= THREAT.alert ? THREAT.alert : THREAT.none;
    this.extLead[h] = Math.min(1, Math.max(0, lead || 0));
    return true;
  }

  /** True while herd h has an active external threat at the flee level. */
  externalFlee(h: number): boolean {
    return this.active[h] === 1 && this.time < this.extUntil[h] && this.extLevel[h] === THREAT.flee;
  }

  /**
   * Advance every herd by dt (s). Brains run at 10 Hz, round-robin, while terrain budget remains (`budget`:
   * terrain reads this step may take at most this many, counted on terrain.calls). view = camera position
   * (north, east) for the near/far snap choice. Returns the terrain reads used.
   */
  step(dt: number, ac: AircraftView | null, terrain: FaunaTerrain, budget: number, viewN: number, viewE: number): number {
    if (!(dt > 0)) return 0;
    this.time += dt;
    const t = this.time;
    const start = terrain.calls;
    this.ticks = 0;
    this.deferred = 0;
    // Brains, round-robin from the cursor.
    for (let k = 0; k < MAX_HERDS; k++) {
      const h = (this.cursor + k) % MAX_HERDS;
      if (!this.active[h] || this.nextBrain[h] > t) continue;
      const near = Math.hypot(this.cN[h] - viewN, this.cE[h] - viewE) < NEAR_SNAP_M;
      const left = budget - (terrain.calls - start);
      // The plane and the look-ahead take 4 reads; a near herd wants one per member on top.
      if (left < 4) {
        this.deferred++;
        continue;
      }
      this.brain(h, ac, terrain, near, left - 4);
      this.ticks++;
      this.nextBrain[h] = Math.max(this.nextBrain[h] + BRAIN_DT, t);
      this.cursor = (h + 1) % MAX_HERDS;
    }
    for (let h = 0; h < MAX_HERDS; h++) if (this.active[h]) this.move(h, dt, ac);
    return terrain.calls - start;
  }

  /** 10 Hz herd brain: ground plane, wander, threat, ground snap and separation. */
  private brain(h: number, ac: AircraftView | null, terrain: FaunaTerrain, near: boolean, snapBudget: number): void {
    const t = this.time;
    const s = this.s;
    const seed = this.seed[h];
    const base = h * MAX_HERD_SIZE;
    const size = this.size[h];

    // Centroid follows the members while fleeing (the herd relocates).
    if (this.fleeing[h]) {
      let sn = 0;
      let se = 0;
      for (let k = 0; k < size; k++) {
        sn += this.mN[base + k];
        se += this.mE[base + k];
      }
      this.cN[h] = sn / size;
      this.cE[h] = se / size;
    }

    const P = this.prof[h];
    const R = P.reaction;
    // A far pinned herd (a showcase herd seen from afar) reads less: the centroid every tick, and one of the plane's
    // gradient samples or the wander look-ahead in turn (<= 2 reads per tick).
    const cheap = !near && this.pinned[h] === 1;
    const slot = cheap ? this.farTick[h]++ % 3 : -1;

    // Local ground plane (3 reads; a cheap herd 1 + one gradient sample on slots 0 and 1).
    const cn = this.cN[h];
    const ce = this.cE[h];
    const h0 = terrain.sample(cn, ce, s).ground;
    const water0 = Math.max(s.standing, s.river);
    const hc = Math.max(h0, water0 - 0.5);
    this.cH[h] = hc;
    if (!cheap) {
      const hn = terrain.sample(cn + PLANE_STEP, ce, s).ground;
      const he = terrain.sample(cn, ce + PLANE_STEP, s).ground;
      this.gN[h] = (hn - h0) / PLANE_STEP;
      this.gE[h] = (he - h0) / PLANE_STEP;
    } else if (slot === 0) {
      this.gN[h] = (terrain.sample(cn + PLANE_STEP, ce, s).ground - h0) / PLANE_STEP;
    } else if (slot === 1) {
      this.gE[h] = (terrain.sample(cn, ce + PLANE_STEP, s).ground - h0) / PLANE_STEP;
    }

    // Mode changes: graze <-> walk.
    if (!this.fleeing[h] && t >= this.modeUntil[h]) {
      const c = ++this.modeCount[h];
      const walk = this.mode[h] === HERD_MODE.graze;
      this.mode[h] = walk ? HERD_MODE.walk : HERD_MODE.graze;
      this.modeUntil[h] = t + (walk ? 25 + 60 * rand(seed, 1000 + c) : 60 + 120 * rand(seed, 1000 + c));
      if (walk) this.heading[h] = wrapPi(this.heading[h] + 1.6 * (rand(seed, 2000 + c) - 0.5));
    }

    // Wander look-ahead (1 read): turn away from bad ground.
    if (this.mode[h] === HERD_MODE.walk && !this.fleeing[h] && (!cheap || slot === 2)) {
      const hd = this.heading[h];
      const ln = cn + 40 * Math.cos(hd);
      const le = ce + 40 * Math.sin(hd);
      const a = terrain.sample(ln, le, s);
      const slope = Math.abs(a.ground - h0) / 40;
      const bad =
        a.ground < Math.max(a.standing, a.river) + 0.3 ||
        (a.riverHalfWidth > 0 && a.riverDist < a.riverHalfWidth + 15) ||
        slope > MAX_SLOPE ||
        Math.hypot(this.gN[h], this.gE[h]) > MAX_SLOPE ||
        a.airportBlend < HERD_MIN_AIRPORT_BLEND ||
        !(a.riverDist < HERD_MAX_RIVER_DIST + 200 || a.standing > 0) ||
        Math.hypot(ln - this.homeN[h], le - this.homeE[h]) > P.formation.leash;
      if (bad) {
        // Turn back toward home, with a random swing.
        const home = Math.atan2(this.homeE[h] - ce, this.homeN[h] - cn);
        this.heading[h] = wrapPi(home + 1.4 * (rand(seed, 3000 + Math.floor(t * 10)) - 0.5));
      }
    }

    // Threat: the aircraft (the species' ranges) and an external threat (setExternalThreat).
    const kind = this.kind[h];
    const extActive = t < this.extUntil[h];
    const ext: number = extActive ? this.extLevel[h] : THREAT.none;
    let threat: number = THREAT.none;
    if (ac) {
      const rn = ac.n - cn;
      const re = ac.e - ce;
      const rd = -(ac.alt - hc);
      const d = Math.sqrt(rn * rn + re * re + rd * rd);
      const slant = Math.max(0, d - this.radius[h]);
      threat = speciesThreat(R, slant, ac.alt - hc, closingSpeed(rn, re, rd, ac.vN, ac.vE, ac.vD), ac.tas);
      if (threat === THREAT.flee && kind !== REACTION_KIND.ignore) {
        if (ext === THREAT.flee) {
          // An external flee owns the herd: the aircraft only escalates the members still waiting for the wave.
          if (this.fleeing[h]) for (let k = 0; k < size; k++) if (this.fleeT0[base + k] > t) this.fleeT0[base + k] = t;
        } else if (kind === REACTION_KIND.flee) {
          this.trackN[h] = ac.n;
          this.trackE[h] = ac.e;
          this.trackVN[h] = ac.vN;
          this.trackVE[h] = ac.vE;
          this.calmAt[h] = t + calmDelay(rand(seed, 4000 + Math.floor(t / 60)), R);
          if (!this.fleeing[h]) this.startAlarm(h, ac.n, ac.e, ALARM.run);
          // Each member runs from the ground track as it stands now, with its own spread.
          for (let k = 0; k < size; k++) {
            const i = base + k;
            fleeDirection(this.mN[i], this.mE[i], ac.n, ac.e, ac.vN, ac.vE, this.dir);
            this.setFleeDir(i, seed, k);
          }
        } else {
          // 'face': turn toward the aircraft and stand.
          this.calmAt[h] = t + calmDelay(rand(seed, 4000 + Math.floor(t / 60)), R);
          if (!this.fleeing[h]) this.startAlarm(h, ac.n, ac.e, ALARM.face);
          this.faceN[h] = ac.n;
          this.faceE[h] = ac.e;
        }
      }
    }
    if (ext === THREAT.flee && kind !== REACTION_KIND.ignore) {
      const sn = this.extN[h];
      const se = this.extE[h];
      // A 'face' herd runs after all when the predator is right on top of it.
      const run = kind === REACTION_KIND.flee || (R.predatorFleeRange > 0 && Math.hypot(sn - cn, se - ce) - this.radius[h] < R.predatorFleeRange);
      const calm = this.extUntil[h] + calmDelay(rand(seed, 4100 + Math.floor(this.extUntil[h] / 60)), R);
      if (calm > this.calmAt[h] || !this.fleeing[h]) this.calmAt[h] = calm;
      if (!this.fleeing[h]) this.startAlarm(h, sn, se, run ? ALARM.run : ALARM.face, true);
      else if (run) this.react[h] = ALARM.run;
      if (run) {
        this.trackN[h] = sn;
        this.trackE[h] = se;
        this.trackVN[h] = this.extVN[h];
        this.trackVE[h] = this.extVE[h];
        for (let k = 0; k < size; k++) {
          const i = base + k;
          externalFleeDirection(this.mN[i], this.mE[i], sn, se, this.extVN[h], this.extVE[h], this.extLead[h], this.dir);
          this.setFleeDir(i, seed, k);
        }
      } else {
        this.faceN[h] = sn;
        this.faceE[h] = se;
      }
    }
    if (ext > threat) threat = ext;
    if (threat >= THREAT.alert) this.alertUntil[h] = t + 6;
    // Heads turn to the threat while alert: the external source while it is active, else the aircraft.
    if ((ac || extActive) && (threat >= THREAT.alert || t < this.alertUntil[h])) {
      const tn = extActive ? this.extN[h] : ac!.n;
      const te = extActive ? this.extE[h] : ac!.e;
      for (let k = 0; k < size; k++) {
        const i = base + k;
        const b = wrapPi(Math.atan2(te - this.mE[i], tn - this.mN[i]) - this.yaw[i]);
        this.head[i] = Math.max(-0.9, Math.min(0.9, b));
      }
    }
    this.threat[h] = threat;
    if (t >= this.alertUntil[h]) for (let k = 0; k < size; k++) this.head[base + k] *= 0.8;

    // Calm down: the herd re-forms where it stopped.
    if (this.fleeing[h] && t >= this.calmAt[h]) {
      this.fleeing[h] = 0;
      let sn = 0;
      let se = 0;
      for (let k = 0; k < size; k++) {
        sn += this.mN[base + k];
        se += this.mE[base + k];
      }
      this.cN[h] = sn / size;
      this.cE[h] = se / size;
      const lim = 1.3 * this.radius[h];
      for (let k = 0; k < size; k++) {
        const i = base + k;
        let on = this.mN[i] - this.cN[h];
        let oe = this.mE[i] - this.cE[h];
        const l = Math.hypot(on, oe);
        if (l > lim) {
          on *= lim / l;
          oe *= lim / l;
        }
        this.offN[i] = on;
        this.offE[i] = oe;
        this.fleeT0[i] = Infinity;
      }
      this.react[h] = ALARM.run;
      this.mode[h] = HERD_MODE.graze;
      this.modeUntil[h] = t + 40 + 60 * rand(seed, 7000 + this.modeCount[h]);
    }

    // Ground snap: one read per member that has moved since its last snap (grazers standing still cost nothing),
    // round-robin while the budget lasts. Between snaps a member follows the herd's terrain plane.
    if (near) {
      let left = snapBudget;
      let k = this.snapCursor[h] % size;
      let j = 0;
      for (; j < size && left > 0; j++, k = (k + 1) % size) {
        const i = base + k;
        const moved = Math.abs(this.mN[i] - this.snapN[i]) + Math.abs(this.mE[i] - this.snapE[i]);
        if (moved < SNAP_MOVE && this.snapped[i]) continue;
        left--;
        const a = terrain.sample(this.mN[i], this.mE[i], s);
        const water = Math.max(a.standing, a.river);
        if (a.ground < water - 0.4) {
          // Wading too deep: step back toward the centroid.
          this.offN[i] *= 0.85;
          this.offE[i] *= 0.85;
          if (this.fleeing[h]) {
            this.fleeDN[i] = -this.fleeDN[i];
            this.fleeDE[i] = -this.fleeDE[i];
          }
        }
        this.snapN[i] = this.mN[i];
        this.snapE[i] = this.mE[i];
        this.snapH[i] = Math.max(a.ground, water - 0.5);
        this.mH[i] = this.snapH[i];
        this.snapped[i] = 1;
      }
      this.snapCursor[h] = k;
    } else {
      for (let k = 0; k < size; k++) {
        const i = base + k;
        this.snapN[i] = this.cN[h];
        this.snapE[i] = this.cE[h];
        this.snapH[i] = hc;
        this.snapped[i] = 0;
      }
    }

    // Separation between sunflower neighbours.
    for (let k = 0; k < size; k++) {
      const i = base + k;
      for (let q = 0; q < NEIGHBOURS.length; q++) {
        const kk = k + NEIGHBOURS[q];
        if (kk >= size) break;
        const j = base + kk;
        const dn = this.mN[j] - this.mN[i];
        const de = this.mE[j] - this.mE[i];
        const d2 = dn * dn + de * de;
        const min = P.formation.personal * 0.5 * (this.scale[i] + this.scale[j]);
        if (d2 < min * min && d2 > 1e-6) {
          const d = Math.sqrt(d2);
          const push = (0.5 * (min - d)) / d;
          this.mN[i] -= dn * push;
          this.mE[i] -= de * push;
          this.mN[j] += dn * push;
          this.mE[j] += de * push;
        }
      }
      // Grazers shuffle now and then.
      if (!this.fleeing[h] && rand(seed, 8000 + k + Math.floor(t * 10) * 97) < 0.01) {
        this.offN[i] += 3 * (rand(seed, 9000 + k + Math.floor(t)) - 0.5);
        this.offE[i] += 3 * (rand(seed, 9500 + k + Math.floor(t)) - 0.5);
      }
    }
  }

  /**
   * Start the alarm wave of herd h from its edge nearest (srcN, srcE); `react` = ALARM.run or ALARM.face. The
   * aircraft's edge (inc 1) is the formation radius toward it; an external threat's is the member nearest to it
   * (`member`), so the wave starts at once where the predator is.
   */
  private startAlarm(h: number, srcN: number, srcE: number, react: number, member = false): void {
    const t = this.time;
    const seed = this.seed[h];
    const base = h * MAX_HERD_SIZE;
    const R = this.prof[h].reaction;
    this.fleeing[h] = 1;
    this.react[h] = react;
    this.alarmT[h] = t;
    // The alarm starts at the herd's edge nearest the threat and spreads at the wave speed.
    const cn = this.cN[h];
    const ce = this.cE[h];
    const rn = srcN - cn;
    const re = srcE - ce;
    const rh = Math.hypot(rn, re) || 1;
    const reach = Math.min(rh, this.radius[h]);
    let on = cn + (rn / rh) * reach;
    let oe = ce + (re / rh) * reach;
    const m = member ? this.nearestMember(h, srcN, srcE) : -1;
    if (m >= 0) {
      on = this.mN[m];
      oe = this.mE[m];
    }
    for (let k = 0; k < this.size[h]; k++) {
      const i = base + k;
      this.fleeT0[i] = t + alarmDelay(Math.hypot(this.mN[i] - on, this.mE[i] - oe), R) + 0.3 * rand(seed, 5000 + k);
    }
  }

  /** Member i's flee direction: this.dir with its own jitter. */
  private setFleeDir(i: number, seed: number, k: number): void {
    const jit = 0.5 * (rand(seed, 6000 + k) - 0.5);
    const cj = Math.cos(jit);
    const sj = Math.sin(jit);
    this.fleeDN[i] = this.dir.n * cj - this.dir.e * sj;
    this.fleeDE[i] = this.dir.n * sj + this.dir.e * cj;
  }

  /** Per-frame member motion (no terrain reads). */
  private move(h: number, dt: number, ac: AircraftView | null): void {
    const t = this.time;
    const base = h * MAX_HERD_SIZE;
    const size = this.size[h];
    const P = this.prof[h];
    const F = P.formation;
    const R = P.reaction;
    const walking = this.mode[h] === HERD_MODE.walk && !this.fleeing[h];
    if (walking) {
      this.cN[h] += F.wanderSpeed * Math.cos(this.heading[h]) * dt;
      this.cE[h] += F.wanderSpeed * Math.sin(this.heading[h]) * dt;
    }
    const ignore = this.kind[h] === REACTION_KIND.ignore;
    // An 'ignore' herd never freezes; it only holds its heads toward the threat while alert.
    const alert = !ignore && !this.fleeing[h] && t < this.alertUntil[h];
    const headHold = ignore && t < this.alertUntil[h];
    const facing = this.fleeing[h] === 1 && this.react[h] === ALARM.face;
    const gN = this.gN[h];
    const gE = this.gE[h];
    for (let k = 0; k < size; k++) {
      const i = base + k;
      const sc = this.scale[i];
      let want = 0;
      let wantYaw = this.yaw[i];
      let turnRate = 0.8;
      let accel = 1.2;
      let turnInPlace = false;
      const fleeingNow = this.fleeing[h] && t >= this.fleeT0[i];
      if (fleeingNow && facing) {
        // Facing: stop and turn on the spot toward the threat.
        wantYaw = Math.atan2(this.faceE[h] - this.mE[i], this.faceN[h] - this.mN[i]);
        turnRate = FACE_TURN_RATE;
        accel = 3;
        turnInPlace = true;
      } else if (fleeingNow) {
        want = fleeSpeed(t - this.fleeT0[i], R) * (0.75 + 0.25 * sc);
        wantYaw = Math.atan2(this.fleeDE[i], this.fleeDN[i]);
        turnRate = 1.6;
        accel = 3;
      } else if (!alert) {
        const dn = this.cN[h] + this.offN[i] - this.mN[i];
        const de = this.cE[h] + this.offE[i] - this.mE[i];
        const d = Math.sqrt(dn * dn + de * de);
        if (d > 0.6) {
          want = Math.min(F.memberWalkMax, 0.35 * d + (walking ? F.wanderSpeed : 0));
          wantYaw = Math.atan2(de, dn);
        } else if (walking) {
          want = F.wanderSpeed;
          wantYaw = this.heading[h];
        }
      }
      // Speed and heading (animals turn along arcs, not on the spot; a facing animal pivots in place).
      const sp = this.speed[i];
      const dv = want - sp;
      const maxDv = accel * dt;
      const ns = sp + (dv > maxDv ? maxDv : dv < -2 * maxDv ? -2 * maxDv : dv);
      this.speed[i] = ns > 0 ? ns : 0;
      if (want > 0.05 || turnInPlace) {
        const dy = wrapPi(wantYaw - this.yaw[i]);
        const maxTurn = turnRate * dt;
        this.yaw[i] = wrapPi(this.yaw[i] + (dy > maxTurn ? maxTurn : dy < -maxTurn ? -maxTurn : dy));
      }
      const cy = Math.cos(this.yaw[i]);
      const sy = Math.sin(this.yaw[i]);
      const step = this.speed[i] * dt;
      this.mN[i] += cy * step;
      this.mE[i] += sy * step;
      this.mH[i] = this.snapH[i] + gN * (this.mN[i] - this.snapN[i]) + gE * (this.mE[i] - this.snapE[i]);
      this.pitch[i] = Math.atan(gN * cy + gE * sy);
      // Gait: phase by distance / the stride of the gait being drawn (so the planted feet do not skate);
      // blend 0 graze / stand .. 1 walk .. 2 run. An alert animal stands still, head up (the alert channel).
      const v = this.speed[i];
      const run = v > F.runFrom ? Math.min(1, (v - F.runFrom) / F.runSpan) : 0;
      const drawnRun = Math.min(1, Math.max(0, this.blend[i] - 1));
      const stride = (P.strideM.walk + (P.strideM.run - P.strideM.walk) * drawnRun) * sc;
      const ph = this.phase[i] + step / stride;
      this.phase[i] = ph - Math.floor(ph);
      const target = v < 0.25 ? v / 0.25 : v <= F.runFrom ? 1 : 1 + run;
      this.blend[i] += (target - this.blend[i]) * Math.min(1, 3 * dt);
      const alertTarget = alert || fleeingNow ? 1 : 0;
      this.alert[i] += (alertTarget - this.alert[i]) * Math.min(1, ALERT_RATE * dt);
      if (ac && !alert && !fleeingNow && !headHold) this.head[i] *= 1 - Math.min(1, dt);
    }
  }
}
