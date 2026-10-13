// Azhdarchid flight (Deep Time): Quetzalcoatlus and the small azhdarchid soaring in kettles on the REAL thermal
// cores of the physics (src/physics/weather/thermals.ts thermalCores, through WindField.thermalFrame), so
// following them finds real lift; ridge soaring when there are no thermals; standing, walking and the quadrupedal
// launch on the ground. Pure and three-free: structure-of-arrays state, no allocation after construction.
//
// KETTLE: a circle about the core (which drifts with the wind) at 15 m/s and 20 deg bank, r = v^2 / (g tan 20)
// ~ 63 m; climb = thermalUpdraft(at the bird) - 0.8 m/s sink. At 0.8 zi a bird leaves on a glide at L/D 15 to the
// next core; a core that dies or stops lifting is left too. Terrain is read only when a core is acquired.
// RIDGE (w* = 0 by day): a long figure along the windward valley wall, 80-150 m above the slope.
// ROOST (night): the birds glide down and stand.
// GROUND: stand and walk slowly (folded wings as forelimbs); when the aircraft comes within LAUNCH_RANGE on the
// ground or low, the quad launch: crouch, vault, first downstroke, then a flapping climb-out to the nearest core.
// Never within 60 m of the aircraft: inside 120 m a wing-over and flap burst away, and a hard push-out at 60 m.
//
// INSTANCE CHANNELS this writes for the azhdarchid rig (FaunaSystem copies them into aInstB/C):
//   gaitBlend  0 standing .. 1 walking (wings folded, quadrupedal) .. 2 airborne (wings spread);
//              between 1 and 2 is the launch (crouch -> vault -> first downstroke) with gaitPhase = launch progress.
//   gaitPhase  walking: cycles of the stride (distance / stride); airborne: cycles of the wing stroke (~1 Hz).
//   flap       0 glide .. 1 full stroke (airborne only).
//   pitch, bank  rad (bank + right wing down).

import { thermalUpdraft, makeThermalCore, thermalCores, type ThermalCore } from '../../physics/weather/thermals';
import type { ThermalFrame } from '../../physics/weather/windField';
import { cellRandom, type FaunaTerrain } from './habitat';
import type { AircraftView } from './herds';
import { FAUNA_MAX } from './presets';
import { FLYER_REACTION } from './reactions';

const G = 9.81;
/** Still-air sink of a soaring azhdarchid, m/s. */
export const SOAR_SINK = 0.8;
/** Kettle speed (Quetzalcoatlus) and bank. */
export const KETTLE_SPEED = 15;
export const KETTLE_BANK = (20 * Math.PI) / 180;
/** Glide ratio between thermals. */
export const GLIDE_RATIO = 15;
/** Leave a thermal at this fraction of the convective layer depth. */
export const TOP_OUT = 0.8;
/** Ground animals launch when the aircraft comes this close on the ground or low (below LAUNCH_HEIGHT), m. */
export const LAUNCH_RANGE = 400;
export const LAUNCH_HEIGHT = 80;
/** Duration of the quad launch (crouch, vault, first downstroke), s. */
export const LAUNCH_S = 1.6;
/** Ridge soaring height band above the slope, m. */
export const RIDGE_MIN = 80;
export const RIDGE_MAX = 150;
/** Wing-stroke frequency, Hz. */
const FLAP_HZ = 1;
/** Stride per walking cycle at scale 1 (Quetzalcoatlus), m. */
const WALK_STRIDE = 2.4;

export const FLYER_MODE = {
  stand: 0,
  walk: 1,
  launch: 2,
  climbOut: 3,
  kettle: 4,
  glide: 5,
  ridge: 6,
  roost: 7,
  evade: 8,
} as const;
export type FlyerMode = (typeof FLYER_MODE)[keyof typeof FLYER_MODE];

/** Circle radius at a speed and bank, m. */
export const turnRadius = (v: number, bank: number): number => (v * v) / (G * Math.tan(bank));

export interface FlyerSpawn {
  north: number;
  east: number;
  /** Altitude MSL, m (ground birds: the ground). */
  alt: number;
  /** Ground under the spawn, m MSL. */
  ground: number;
  entry: number;
  /** Rendered body scale (aInstC.z) and the size relative to Quetzalcoatlus (speeds scale with it). */
  scale: number;
  size: number;
  variant: number;
  seed: number;
  mode: FlyerMode;
  heading: number;
  /** The group's home (kettles stay within a leash of it; ground birds walk about it), NED m. */
  anchorN: number;
  anchorE: number;
}

const wrapPi = (a: number): number => a - 2 * Math.PI * Math.floor((a + Math.PI) / (2 * Math.PI));
const rand = (seed: number, k: number): number => cellRandom(seed, 0xf1e5, k);

const CORE_SCAN = 25;

export class FlyerPool {
  readonly capacity = FAUNA_MAX.flyers;
  readonly active: Uint8Array;
  readonly entry: Int16Array;
  readonly mode: Uint8Array;
  readonly seed: Uint32Array;
  readonly n: Float64Array;
  readonly e: Float64Array;
  readonly alt: Float64Array;
  /** Ground under the bird as last known (standing: exact; flying: at the core / ridge / roost), m MSL. */
  readonly ground: Float64Array;
  readonly heading: Float32Array;
  readonly speed: Float32Array;
  readonly bank: Float32Array;
  readonly pitch: Float32Array;
  readonly flap: Float32Array;
  readonly phase: Float32Array;
  readonly blend: Float32Array;
  readonly head: Float32Array;
  readonly scale: Float32Array;
  readonly size: Float32Array;
  readonly variant: Float32Array;
  readonly anchorN: Float64Array;
  readonly anchorE: Float64Array;
  readonly modeT: Float64Array;
  /** Thermal core (drifting frame), its ground, zi, radius factor, lattice cell. */
  readonly coreX: Float64Array;
  readonly coreY: Float64Array;
  readonly coreI: Int32Array;
  readonly coreJ: Int32Array;
  readonly coreGround: Float64Array;
  readonly coreZi: Float64Array;
  readonly orbitDir: Int8Array;
  readonly orbitAng: Float64Array;
  readonly orbitR: Float64Array;
  /** Last climb rate (kettle), m/s, and seconds of sinking in the current kettle. */
  readonly climb: Float32Array;
  readonly sinkT: Float32Array;
  /** Glide / roost target, NED m (glide: the core's drifting-frame position; add the drift). */
  readonly tgtX: Float64Array;
  readonly tgtY: Float64Array;
  /** Ridge beat: centre, unit direction along the wall, half-length, ground at -L/0/+L and the height offset. */
  readonly rN: Float64Array;
  readonly rE: Float64Array;
  readonly rDN: Float32Array;
  readonly rDE: Float32Array;
  readonly rL: Float32Array;
  readonly rH0: Float64Array;
  readonly rH1: Float64Array;
  readonly rH2: Float64Array;
  readonly rOff: Float32Array;
  readonly rPh: Float64Array;
  /** Evade: until when, direction away, the mode to resume. */
  readonly evadeUntil: Float64Array;
  readonly evadeDN: Float32Array;
  readonly evadeDE: Float32Array;
  readonly evadeDU: Float32Array;
  readonly resume: Uint8Array;
  /** Ground walking target. */
  readonly walkN: Float64Array;
  readonly walkE: Float64Array;

  time = 0;
  /** Diagnostics: closest approach to the aircraft seen last step, m. */
  closest = Infinity;
  private readonly cores: ThermalCore[] = Array.from({ length: CORE_SCAN }, makeThermalCore);

  constructor(capacity = FAUNA_MAX.flyers) {
    this.capacity = capacity;
    const f64 = () => new Float64Array(capacity);
    const f32 = () => new Float32Array(capacity);
    this.active = new Uint8Array(capacity);
    this.entry = new Int16Array(capacity);
    this.mode = new Uint8Array(capacity);
    this.seed = new Uint32Array(capacity);
    this.n = f64();
    this.e = f64();
    this.alt = f64();
    this.ground = f64();
    this.heading = f32();
    this.speed = f32();
    this.bank = f32();
    this.pitch = f32();
    this.flap = f32();
    this.phase = f32();
    this.blend = f32();
    this.head = f32();
    this.scale = f32();
    this.size = f32();
    this.variant = f32();
    this.anchorN = f64();
    this.anchorE = f64();
    this.modeT = f64();
    this.coreX = f64();
    this.coreY = f64();
    this.coreI = new Int32Array(capacity);
    this.coreJ = new Int32Array(capacity);
    this.coreGround = f64();
    this.coreZi = f64();
    this.orbitDir = new Int8Array(capacity);
    this.orbitAng = f64();
    this.orbitR = f64();
    this.climb = f32();
    this.sinkT = f32();
    this.tgtX = f64();
    this.tgtY = f64();
    this.rN = f64();
    this.rE = f64();
    this.rDN = f32();
    this.rDE = f32();
    this.rL = f32();
    this.rH0 = f64();
    this.rH1 = f64();
    this.rH2 = f64();
    this.rOff = f32();
    this.rPh = f64();
    this.evadeUntil = f64();
    this.evadeDN = f32();
    this.evadeDE = f32();
    this.evadeDU = f32();
    this.resume = new Uint8Array(capacity);
    this.walkN = f64();
    this.walkE = f64();
  }

  count(): number {
    let c = 0;
    for (let i = 0; i < this.capacity; i++) c += this.active[i];
    return c;
  }

  spawn(sp: FlyerSpawn): number {
    let i = -1;
    for (let k = 0; k < this.capacity; k++) {
      if (!this.active[k]) {
        i = k;
        break;
      }
    }
    if (i < 0) return -1;
    this.active[i] = 1;
    this.entry[i] = sp.entry;
    this.seed[i] = sp.seed >>> 0;
    this.n[i] = sp.north;
    this.e[i] = sp.east;
    this.alt[i] = sp.alt;
    this.ground[i] = sp.ground;
    this.heading[i] = sp.heading;
    this.scale[i] = sp.scale;
    this.size[i] = sp.size;
    this.variant[i] = sp.variant;
    this.anchorN[i] = sp.anchorN;
    this.anchorE[i] = sp.anchorE;
    this.orbitDir[i] = rand(sp.seed, 1) < 0.5 ? -1 : 1;
    this.orbitAng[i] = 2 * Math.PI * rand(sp.seed, 2);
    this.orbitR[i] = this.kettleRadius(i);
    this.coreGround[i] = sp.ground;
    this.coreZi[i] = 1200;
    this.climb[i] = 0;
    this.sinkT[i] = 0;
    this.evadeUntil[i] = -Infinity;
    this.flap[i] = 0;
    this.phase[i] = rand(sp.seed, 3);
    this.head[i] = 0;
    this.pitch[i] = 0;
    this.bank[i] = 0;
    this.walkN[i] = sp.north;
    this.walkE[i] = sp.east;
    const ground = sp.mode === FLYER_MODE.stand || sp.mode === FLYER_MODE.walk || sp.mode === FLYER_MODE.roost;
    this.speed[i] = ground ? 0 : this.cruise(i);
    this.blend[i] = ground ? 0 : 2;
    this.setMode(i, sp.mode);
    return i;
  }

  release(i: number): void {
    this.active[i] = 0;
  }

  /** Soaring speed of bird i (smaller birds fly slower), m/s. */
  cruise(i: number): number {
    return KETTLE_SPEED * Math.sqrt(Math.max(0.3, this.size[i]));
  }

  /** Kettle radius of bird i at its cruise speed and 20 deg bank, m. */
  kettleRadius(i: number): number {
    return turnRadius(this.cruise(i), KETTLE_BANK);
  }

  private setMode(i: number, m: FlyerMode): void {
    this.mode[i] = m;
    this.modeT[i] = this.time;
  }

  /** Put bird i into a kettle on core c (terrain read: the ground at the core, 1 call). */
  private joinCore(i: number, c: ThermalCore, f: ThermalFrame, terrain: FaunaTerrain): void {
    this.coreX[i] = c.x;
    this.coreY[i] = c.y;
    this.coreI[i] = c.i;
    this.coreJ[i] = c.j;
    const g = terrain.height(c.x + f.driftN, c.y + f.driftE);
    this.coreGround[i] = g;
    this.coreZi[i] = Math.max(f.minDepth, f.cloudBaseM - g);
    const cn = c.x + f.driftN;
    const ce = c.y + f.driftE;
    this.orbitAng[i] = Math.atan2(this.e[i] - ce, this.n[i] - cn);
    this.orbitR[i] = Math.max(this.kettleRadius(i), Math.min(400, Math.hypot(this.n[i] - cn, this.e[i] - ce)));
    this.sinkT[i] = 0;
    this.ground[i] = g;
    this.setMode(i, FLYER_MODE.kettle);
  }

  /**
   * Best core for bird i from where it is: strong and young, near, within the leash of its anchor and within glide
   * reach. Returns the index in this.cores or -1. No terrain reads.
   */
  private pickCore(i: number, f: ThermalFrame, t: number, exclude: boolean): number {
    const x = this.n[i] - f.driftN;
    const y = this.e[i] - f.driftE;
    const nc = thermalCores(f.seed, x, y, t, this.cores, 2);
    const height = this.alt[i] - this.ground[i];
    let best = -1;
    let score = -Infinity;
    for (let k = 0; k < nc; k++) {
      const c = this.cores[k];
      if (exclude && c.i === this.coreI[i] && c.j === this.coreJ[i]) continue;
      if (c.strength < 0.25) continue;
      const d = Math.hypot(c.x - x, c.y - y);
      // Glide reach with a 120 m reserve.
      if (d / GLIDE_RATIO > height - 120) continue;
      const leash = Math.hypot(c.x + f.driftN - this.anchorN[i], c.y + f.driftE - this.anchorE[i]);
      const young = c.phase < 0.55 ? 1 : 0.5;
      const s = c.strength * young - d / 5000 - leash / 4000;
      if (s > score) {
        score = s;
        best = k;
      }
    }
    return best;
  }

  /** Nearest live core to a point (drifting frame scan); for spawning kettles. */
  nearestCore(f: ThermalFrame, t: number, north: number, east: number, out: ThermalCore): boolean {
    const x = north - f.driftN;
    const y = east - f.driftE;
    const nc = thermalCores(f.seed, x, y, t, this.cores, 1);
    let best = -1;
    let bd = Infinity;
    for (let k = 0; k < nc; k++) {
      const c = this.cores[k];
      if (c.strength < 0.35) continue;
      const d = Math.hypot(c.x - x, c.y - y);
      if (d < bd) {
        bd = d;
        best = k;
      }
    }
    if (best < 0) return false;
    Object.assign(out, this.cores[best]);
    return true;
  }

  /** Spawn-time helper: put bird i straight into a kettle on `core`. */
  startKettle(i: number, core: ThermalCore, f: ThermalFrame, terrain: FaunaTerrain): void {
    const cn = core.x + f.driftN;
    const ce = core.y + f.driftE;
    const r = this.kettleRadius(i);
    this.n[i] = cn + r * Math.cos(this.orbitAng[i]);
    this.e[i] = ce + r * Math.sin(this.orbitAng[i]);
    const keepAng = this.orbitAng[i];
    this.joinCore(i, core, f, terrain);
    this.orbitAng[i] = keepAng;
    this.orbitR[i] = r;
  }

  /**
   * Find a windward wall near the anchor and start a ridge beat there (terrain reads: <= 3 per ring point + 3).
   * windToN/E: unit vector the wind blows toward (0, 0 in calm air).
   */
  startRidge(i: number, terrain: FaunaTerrain, windToN: number, windToE: number): void {
    const RING = 8;
    const R = 1200;
    const D = 40;
    let best = -Infinity;
    let bn = this.anchorN[i];
    let be = this.anchorE[i];
    let bgn = 0;
    let bge = 0;
    let bh = 0;
    const calm = Math.hypot(windToN, windToE) < 0.1;
    for (let k = 0; k < RING; k++) {
      const a = (2 * Math.PI * (k + rand(this.seed[i], 10))) / RING;
      const pn = this.anchorN[i] + R * Math.cos(a);
      const pe = this.anchorE[i] + R * Math.sin(a);
      const h0 = terrain.height(pn, pe);
      const gn = (terrain.height(pn + D, pe) - h0) / D;
      const ge = (terrain.height(pn, pe + D) - h0) / D;
      // Windward: the ground rises downwind (the wind blows up the slope).
      const s = calm ? Math.hypot(gn, ge) : gn * windToN + ge * windToE;
      if (s > best) {
        best = s;
        bn = pn;
        be = pe;
        bgn = gn;
        bge = ge;
        bh = h0;
      }
    }
    const gl = Math.hypot(bgn, bge);
    // Along the wall: perpendicular to the slope (any direction on flat ground).
    let dn = gl > 1e-4 ? -bge / gl : 1;
    let de = gl > 1e-4 ? bgn / gl : 0;
    if (rand(this.seed[i], 11) < 0.5) {
      dn = -dn;
      de = -de;
    }
    const L = 450;
    this.rN[i] = bn;
    this.rE[i] = be;
    this.rDN[i] = dn;
    this.rDE[i] = de;
    this.rL[i] = L;
    this.rH0[i] = terrain.height(bn - dn * L, be - de * L);
    this.rH1[i] = bh;
    this.rH2[i] = terrain.height(bn + dn * L, be + de * L);
    this.rOff[i] = 100 + 30 * rand(this.seed[i], 12);
    this.rPh[i] = 2 * Math.PI * rand(this.seed[i], 13);
    this.ground[i] = bh;
    this.setMode(i, FLYER_MODE.ridge);
  }

  /** Ground height under the ridge beat at along-coordinate s (-L..L), piecewise linear through 3 samples. */
  private ridgeGround(i: number, s: number): number {
    const u = s / this.rL[i];
    return u < 0 ? this.rH1[i] + (this.rH1[i] - this.rH0[i]) * u : this.rH1[i] + (this.rH2[i] - this.rH1[i]) * u;
  }

  /**
   * Advance all flyers by dt. t = sim time (the thermals' clock). f = the thermal frame (null: no wind field,
   * treated as no thermals). daylight: false at night (roost). windTo: unit vector the wind blows toward.
   */
  step(
    dt: number,
    t: number,
    f: ThermalFrame | null,
    ac: AircraftView | null,
    terrain: FaunaTerrain,
    budget: number,
    daylight: boolean,
    windToN: number,
    windToE: number,
  ): number {
    if (!(dt > 0)) return 0;
    this.time += dt;
    const start = terrain.calls;
    this.closest = Infinity;
    const thermals = !!f && f.wStar > 0.05;
    for (let i = 0; i < this.capacity; i++) {
      if (!this.active[i]) continue;
      const left = budget - (terrain.calls - start);
      this.stepOne(i, dt, t, f, thermals, ac, terrain, left, daylight, windToN, windToE);
    }
    return terrain.calls - start;
  }

  private stepOne(
    i: number,
    dt: number,
    t: number,
    f: ThermalFrame | null,
    thermals: boolean,
    ac: AircraftView | null,
    terrain: FaunaTerrain,
    budget: number,
    daylight: boolean,
    windToN: number,
    windToE: number,
  ): void {
    const mode = this.mode[i] as FlyerMode;
    const airborne = mode !== FLYER_MODE.stand && mode !== FLYER_MODE.walk && mode !== FLYER_MODE.launch;

    // Reactions: the aircraft close by.
    if (ac) {
      const rn = this.n[i] - ac.n;
      const re = this.e[i] - ac.e;
      const ru = this.alt[i] - ac.alt;
      const d = Math.sqrt(rn * rn + re * re + ru * ru);
      if (!airborne && mode !== FLYER_MODE.launch) {
        const height = ac.alt - this.ground[i];
        if (Math.hypot(rn, re) < LAUNCH_RANGE && height < LAUNCH_HEIGHT && daylight) {
          this.heading[i] = Math.atan2(re, rn);
          this.setMode(i, FLYER_MODE.launch);
        }
      } else if (airborne && d < FLYER_REACTION.evadeRange && mode !== FLYER_MODE.evade) {
        // Wing-over away from the aircraft: horizontally away, and down if the aircraft is above (else up).
        const hl = Math.hypot(rn, re) || 1;
        this.evadeDN[i] = rn / hl;
        this.evadeDE[i] = re / hl;
        this.evadeDU[i] = ru >= 0 ? 1 : -1;
        this.evadeUntil[i] = this.time + FLYER_REACTION.evadeS;
        this.resume[i] = mode === FLYER_MODE.roost ? FLYER_MODE.roost : mode === FLYER_MODE.ridge ? FLYER_MODE.ridge : FLYER_MODE.kettle;
        if (mode === FLYER_MODE.kettle) {
          // Come back to this core afterwards.
          this.tgtX[i] = this.coreX[i];
          this.tgtY[i] = this.coreY[i];
        }
        this.setMode(i, FLYER_MODE.evade);
      }
    }

    // Night: everyone airborne goes to roost; at dawn with lift, roosting birds launch again.
    if (!daylight && airborne && this.mode[i] !== FLYER_MODE.roost && this.mode[i] !== FLYER_MODE.evade && budget >= 1) {
      this.tgtX[i] = this.anchorN[i] + 60 * (rand(this.seed[i], 20) - 0.5);
      this.tgtY[i] = this.anchorE[i] + 60 * (rand(this.seed[i], 21) - 0.5);
      this.ground[i] = terrain.height(this.tgtX[i], this.tgtY[i]);
      this.setMode(i, FLYER_MODE.roost);
    }

    // Dawn: a bird that roosted takes off again once there is light (and lift, or a ridge to work).
    if (daylight && this.mode[i] === FLYER_MODE.roost && this.alt[i] <= this.ground[i] + 0.05 && this.time - this.modeT[i] > 30) {
      this.setMode(i, FLYER_MODE.launch);
    }

    switch (this.mode[i] as FlyerMode) {
      case FLYER_MODE.stand:
      case FLYER_MODE.walk:
        this.groundStep(i, dt);
        break;
      case FLYER_MODE.launch: {
        const p = (this.time - this.modeT[i]) / LAUNCH_S;
        // Crouch (0-0.35), vault (0.35-0.6), first downstroke (0.6-1).
        this.blend[i] = 1 + Math.min(1, Math.max(0, p));
        this.phase[i] = Math.min(0.999, Math.max(0, p));
        const vault = p > 0.35 ? Math.min(1, (p - 0.35) / 0.65) : 0;
        this.speed[i] = 9 * vault * Math.sqrt(this.size[i]);
        this.alt[i] = this.ground[i] + 3 * vault * vault;
        this.pitch[i] = 0.5 * vault;
        this.advance(i, dt);
        if (p >= 1) {
          this.flap[i] = 1;
          this.phase[i] = 0;
          this.setMode(i, FLYER_MODE.climbOut);
        }
        break;
      }
      case FLYER_MODE.climbOut: {
        // Flapping climb to a thermal (or the ridge) at ~3 m/s.
        this.blend[i] = 2;
        this.flap[i] = 1;
        this.speed[i] = Math.min(this.cruise(i), this.speed[i] + 2 * dt);
        this.alt[i] += 3 * dt;
        this.pitch[i] = 0.15;
        this.bank[i] *= 1 - Math.min(1, dt);
        this.flapPhase(i, dt);
        this.advance(i, dt);
        if (this.alt[i] - this.ground[i] > 120 && budget >= 1) {
          if (thermals && f) {
            const k = this.pickCore(i, f, t, false);
            if (k >= 0) {
              this.tgtX[i] = this.cores[k].x;
              this.tgtY[i] = this.cores[k].y;
              this.coreI[i] = this.cores[k].i;
              this.coreJ[i] = this.cores[k].j;
              this.setMode(i, FLYER_MODE.glide);
              break;
            }
          }
          if (budget >= 30) this.startRidge(i, terrain, windToN, windToE);
        }
        break;
      }
      case FLYER_MODE.kettle:
        this.kettleStep(i, dt, t, f, thermals, terrain, budget, windToN, windToE);
        break;
      case FLYER_MODE.glide:
        this.glideStep(i, dt, t, f, thermals, terrain, budget, windToN, windToE);
        break;
      case FLYER_MODE.ridge:
        this.ridgeStep(i, dt);
        if (thermals && f && this.time - this.modeT[i] > 60) {
          const k = this.pickCore(i, f, t, false);
          if (k >= 0 && budget >= 1) {
            this.tgtX[i] = this.cores[k].x;
            this.tgtY[i] = this.cores[k].y;
            this.coreI[i] = this.cores[k].i;
            this.coreJ[i] = this.cores[k].j;
            this.setMode(i, FLYER_MODE.glide);
          }
        }
        break;
      case FLYER_MODE.roost:
        this.roostStep(i, dt);
        break;
      case FLYER_MODE.evade:
        this.evadeStep(i, dt, f, budget, terrain, windToN, windToE);
        break;
    }

    // Hard separation from the aircraft.
    if (ac) {
      const rn = this.n[i] - ac.n;
      const re = this.e[i] - ac.e;
      const grounded = this.mode[i] === FLYER_MODE.stand || this.mode[i] === FLYER_MODE.walk;
      const ru = grounded ? 0 : this.alt[i] - ac.alt;
      let d = Math.sqrt(rn * rn + re * re + ru * ru);
      const min = FLYER_REACTION.minSeparation;
      if (d < min) {
        if (d < 1e-3) {
          this.alt[i] += grounded ? 0 : min;
          if (grounded) this.n[i] += min;
        } else {
          const k = min / d;
          this.n[i] = ac.n + rn * k;
          this.e[i] = ac.e + re * k;
          if (!grounded) this.alt[i] = ac.alt + ru * k;
        }
        d = min;
      }
      if (!grounded) this.closest = Math.min(this.closest, Math.sqrt((this.n[i] - ac.n) ** 2 + (this.e[i] - ac.e) ** 2 + (this.alt[i] - ac.alt) ** 2));
    }

    // NaN guard: a broken bird goes home and stands.
    if (!(Number.isFinite(this.n[i]) && Number.isFinite(this.e[i]) && Number.isFinite(this.alt[i]))) {
      this.n[i] = this.anchorN[i];
      this.e[i] = this.anchorE[i];
      this.alt[i] = this.ground[i];
      this.speed[i] = 0;
      this.blend[i] = 0;
      this.setMode(i, FLYER_MODE.stand);
    }
  }

  /** Move along the heading at the current speed (horizontal). */
  private advance(i: number, dt: number): void {
    const s = this.speed[i] * dt;
    this.n[i] += Math.cos(this.heading[i]) * s;
    this.e[i] += Math.sin(this.heading[i]) * s;
  }

  private flapPhase(i: number, dt: number): void {
    const p = this.phase[i] + (FLAP_HZ / Math.sqrt(Math.max(0.3, this.size[i]))) * dt;
    this.phase[i] = p - Math.floor(p);
  }

  /** Turn toward a heading with a bank-limited rate; sets bank from the turn. */
  private steer(i: number, want: number, dt: number, maxBank: number): void {
    const v = Math.max(3, this.speed[i]);
    const maxRate = (G * Math.tan(maxBank)) / v;
    const dy = wrapPi(want - this.heading[i]);
    const rate = Math.max(-maxRate, Math.min(maxRate, dy * 0.8));
    this.heading[i] = wrapPi(this.heading[i] + rate * dt);
    const bank = Math.atan((v * rate) / G);
    this.bank[i] += (bank - this.bank[i]) * Math.min(1, 3 * dt);
  }

  private groundStep(i: number, dt: number): void {
    // Wander about the anchor: walk to a point, stand a while, pick another.
    const seed = this.seed[i];
    const t = this.time;
    const dn = this.walkN[i] - this.n[i];
    const de = this.walkE[i] - this.e[i];
    const d = Math.hypot(dn, de);
    const k = Math.floor(t / 9);
    if (this.mode[i] === FLYER_MODE.stand) {
      this.speed[i] = Math.max(0, this.speed[i] - dt);
      if (t - this.modeT[i] > 6 + 10 * rand(seed, 30 + k)) {
        const a = 2 * Math.PI * rand(seed, 40 + k);
        const r = 30 * rand(seed, 50 + k);
        this.walkN[i] = this.anchorN[i] + r * Math.cos(a);
        this.walkE[i] = this.anchorE[i] + r * Math.sin(a);
        this.setMode(i, FLYER_MODE.walk);
      }
    } else {
      this.speed[i] = Math.min(0.6 * Math.sqrt(this.size[i]), this.speed[i] + 0.5 * dt);
      const want = Math.atan2(de, dn);
      const dy = wrapPi(want - this.heading[i]);
      this.heading[i] = wrapPi(this.heading[i] + Math.max(-0.5 * dt, Math.min(0.5 * dt, dy)));
      if (d < 2) this.setMode(i, FLYER_MODE.stand);
    }
    this.advance(i, dt);
    this.alt[i] = this.ground[i];
    this.pitch[i] = 0;
    this.bank[i] = 0;
    this.flap[i] = 0;
    const p = this.phase[i] + (this.speed[i] * dt) / (WALK_STRIDE * this.size[i]);
    this.phase[i] = p - Math.floor(p);
    const target = this.speed[i] < 0.15 ? 0 : 1;
    this.blend[i] += (target - this.blend[i]) * Math.min(1, 2 * dt);
  }

  private kettleStep(i: number, dt: number, t: number, f: ThermalFrame | null, thermals: boolean, terrain: FaunaTerrain, budget: number, windToN: number, windToE: number): void {
    this.blend[i] = 2;
    this.flap[i] *= 1 - Math.min(1, 2 * dt);
    this.flapPhase(i, dt);
    const v = this.cruise(i);
    this.speed[i] += (v - this.speed[i]) * Math.min(1, dt);
    const r0 = this.kettleRadius(i);
    this.orbitR[i] += (r0 - this.orbitR[i]) * Math.min(1, 0.3 * dt);
    const r = this.orbitR[i];
    const dir = this.orbitDir[i];
    this.orbitAng[i] = wrapPi(this.orbitAng[i] + (dir * this.speed[i] * dt) / r);
    const dN = f ? f.driftN : 0;
    const dE = f ? f.driftE : 0;
    const cn = this.coreX[i] + dN;
    const ce = this.coreY[i] + dE;
    const a = this.orbitAng[i];
    this.n[i] = cn + r * Math.cos(a);
    this.e[i] = ce + r * Math.sin(a);
    // Tangent heading (dir +1: clockwise from above, a right turn).
    this.heading[i] = wrapPi(a + (dir * Math.PI) / 2);
    const bank = dir * Math.atan((this.speed[i] * this.speed[i]) / (G * r));
    this.bank[i] += (bank - this.bank[i]) * Math.min(1, 2 * dt);
    const agl = this.alt[i] - this.coreGround[i];
    const w = thermals && f ? thermalUpdraft(f.seed, this.n[i] - dN, this.e[i] - dE, agl, t, f.wStar, this.coreZi[i]) : 0;
    const climb = w - SOAR_SINK;
    this.climb[i] = climb;
    this.alt[i] += climb * dt;
    this.pitch[i] = Math.atan2(climb, this.speed[i]) * 0.5;
    this.sinkT[i] = climb < 0 ? this.sinkT[i] + dt : Math.max(0, this.sinkT[i] - dt);
    // Leave at the top, when the core dies or stops lifting, or when too low.
    const top = agl >= TOP_OUT * this.coreZi[i];
    const weak = this.sinkT[i] > 20 || !thermals;
    const low = agl < 100;
    if ((top || weak || low) && budget >= 1) {
      if (thermals && f) {
        const k = this.pickCore(i, f, t, true);
        if (k >= 0) {
          this.tgtX[i] = this.cores[k].x;
          this.tgtY[i] = this.cores[k].y;
          this.coreI[i] = this.cores[k].i;
          this.coreJ[i] = this.cores[k].j;
          this.setMode(i, FLYER_MODE.glide);
          return;
        }
      }
      if (!thermals && budget >= 30) {
        this.startRidge(i, terrain, windToN, windToE);
        return;
      }
      if (low) {
        // Nowhere to go: flap back up a little.
        this.alt[i] += 1.5 * dt;
        this.flap[i] = 1;
      }
    }
  }

  private glideStep(i: number, dt: number, t: number, f: ThermalFrame | null, thermals: boolean, terrain: FaunaTerrain, budget: number, windToN: number, windToE: number): void {
    this.blend[i] = 2;
    this.flap[i] *= 1 - Math.min(1, 2 * dt);
    this.flapPhase(i, dt);
    const v = this.cruise(i) * 1.15;
    this.speed[i] += (v - this.speed[i]) * Math.min(1, dt);
    const dN = f ? f.driftN : 0;
    const dE = f ? f.driftE : 0;
    const tn = this.tgtX[i] + dN;
    const te = this.tgtY[i] + dE;
    this.steer(i, Math.atan2(te - this.e[i], tn - this.n[i]), dt, (30 * Math.PI) / 180);
    this.advance(i, dt);
    const sink = this.speed[i] / GLIDE_RATIO;
    this.alt[i] -= sink * dt;
    this.pitch[i] = -Math.atan(1 / GLIDE_RATIO);
    const d = Math.hypot(tn - this.n[i], te - this.e[i]);
    if (d < this.kettleRadius(i) * 1.3 && budget >= 1 && f) {
      // Arrived: acquire the core (its live state from the lattice).
      const nc = thermalCores(f.seed, this.tgtX[i], this.tgtY[i], t, this.cores, 0);
      if (nc > 0) {
        this.joinCore(i, this.cores[0], f, terrain);
        return;
      }
    }
    if ((!thermals || this.time - this.modeT[i] > 300) && budget >= 30) this.startRidge(i, terrain, windToN, windToE);
  }

  private ridgeStep(i: number, dt: number): void {
    this.blend[i] = 2;
    this.flap[i] *= 1 - Math.min(1, 2 * dt);
    this.flapPhase(i, dt);
    const v = this.cruise(i) * 0.9;
    this.speed[i] += (v - this.speed[i]) * Math.min(1, dt);
    // A long, narrow loop along the wall: along = L sin(ph), out = W (1 - cos(ph)) / 2 ... as a closed figure.
    const L = this.rL[i];
    const W = 45;
    // Phase rate so the speed along the loop is ~v.
    const ph0 = this.rPh[i];
    const sp = Math.max(1, Math.hypot(L * Math.cos(ph0), W * Math.sin(ph0)));
    this.rPh[i] = ph0 + (this.speed[i] / sp) * dt;
    const ph = this.rPh[i];
    const along = L * Math.sin(ph);
    const out = W * Math.cos(ph);
    // "Out" is horizontal, perpendicular to the wall direction.
    const pn = -this.rDE[i];
    const pe = this.rDN[i];
    const nn = this.rN[i] + this.rDN[i] * along + pn * out;
    const ne = this.rE[i] + this.rDE[i] * along + pe * out;
    const vn = nn - this.n[i];
    const ve = ne - this.e[i];
    if (Math.hypot(vn, ve) > 1e-3) {
      const want = Math.atan2(ve, vn);
      const dy = wrapPi(want - this.heading[i]);
      const rate = dt > 0 ? dy / dt : 0;
      this.heading[i] = want;
      const bank = Math.atan((this.speed[i] * rate) / G);
      this.bank[i] += (Math.max(-0.7, Math.min(0.7, bank)) - this.bank[i]) * Math.min(1, 3 * dt);
    }
    const target = this.ridgeGround(i, along) + this.rOff[i];
    // Converge on the beat smoothly (from wherever the bird joined it).
    const k = Math.min(1, 0.6 * dt);
    this.n[i] += (nn - this.n[i]) * Math.max(k, Math.min(1, (this.time - this.modeT[i]) / 20));
    this.e[i] += (ne - this.e[i]) * Math.max(k, Math.min(1, (this.time - this.modeT[i]) / 20));
    const da = target - this.alt[i];
    this.alt[i] += Math.max(-3 * dt, Math.min(3 * dt, da));
    this.pitch[i] = 0;
    this.climb[i] = 0;
  }

  private roostStep(i: number, dt: number): void {
    const dn = this.tgtX[i] - this.n[i];
    const de = this.tgtY[i] - this.e[i];
    const d = Math.hypot(dn, de);
    if (this.alt[i] <= this.ground[i] + 0.05 && d < 30) {
      this.alt[i] = this.ground[i];
      this.speed[i] = 0;
      this.flap[i] = 0;
      this.bank[i] = 0;
      this.pitch[i] = 0;
      this.blend[i] += (0 - this.blend[i]) * Math.min(1, dt);
      return;
    }
    this.blend[i] = 2;
    this.flapPhase(i, dt);
    this.speed[i] += (Math.max(4, Math.min(this.cruise(i), d / 8)) - this.speed[i]) * Math.min(1, dt);
    this.steer(i, Math.atan2(de, dn), dt, (25 * Math.PI) / 180);
    this.advance(i, dt);
    const h = this.alt[i] - this.ground[i];
    // Glide slope to the roost.
    const descend = Math.min(3, Math.max(0.5, (h / Math.max(20, d)) * this.speed[i]));
    this.alt[i] = Math.max(this.ground[i], this.alt[i] - descend * dt);
    this.flap[i] = d < 60 ? 0.6 : 0;
    this.pitch[i] = d < 60 ? 0.3 : -0.05;
  }

  private evadeStep(i: number, dt: number, f: ThermalFrame | null, budget: number, terrain: FaunaTerrain, windToN: number, windToE: number): void {
    // Wing-over and a burst of flaps away.
    this.blend[i] = 2;
    this.flap[i] = 1;
    this.flapPhase(i, dt);
    this.speed[i] += (this.cruise(i) * 1.35 - this.speed[i]) * Math.min(1, 2 * dt);
    this.steer(i, Math.atan2(this.evadeDE[i], this.evadeDN[i]), dt, (60 * Math.PI) / 180);
    this.advance(i, dt);
    const floor = this.ground[i] + 40;
    this.alt[i] = Math.max(floor, this.alt[i] + this.evadeDU[i] * 3 * dt);
    if (this.time >= this.evadeUntil[i]) {
      const back = this.resume[i] as FlyerMode;
      if (back === FLYER_MODE.kettle && f) {
        // Glide back to the core it left.
        this.setMode(i, FLYER_MODE.glide);
      } else if (back === FLYER_MODE.ridge) {
        this.setMode(i, FLYER_MODE.ridge);
      } else if (back === FLYER_MODE.roost) {
        this.setMode(i, FLYER_MODE.roost);
      } else if (budget >= 30) {
        this.startRidge(i, terrain, windToN, windToE);
      } else {
        this.setMode(i, FLYER_MODE.glide);
      }
    }
  }
}
