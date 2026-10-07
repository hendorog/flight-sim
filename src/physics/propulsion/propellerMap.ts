// Four-quadrant propeller coefficient maps, generated at start-up by the BEMT solver.
//
// Coefficients are referred to the "0.7R" reference speed U = sqrt(Va^2 + Vip^2 + (0.7 omega R)^2), which stays
// finite in every state (static, stopped, flow from behind), instead of n^2 D^4 which diverges for a stopped
// propeller. The three map coordinates are
//   beta = atan2(Va, 0.7 omega R)   advance angle, -90 deg (flow from behind, prop stopped) .. +90 deg (stopped)
//   eta  = Vip / U                  in-plane (inclined-inflow) fraction, drives the P-factor
//   mach = U / a                    reference Mach number (tip compressibility)
// and the stored channels are, with q = 0.5 rho U^2 and A the disc area,
//   CT = T / (q A),  CQ = Q / (q A R),  CF = Fz / (q A),  CM = Mz / (q A R)
// for in-plane flow toward body -z; other in-plane directions follow by rotating about the (axisymmetric) axis.
//
// A fixed-pitch propeller is ONE such map. A constant-speed propeller is a set of them, one per blade angle
// ("slices", PropellerCharacteristics), each on a smaller grid laid round its own blade angle, with linear
// interpolation in blade angle between neighbours at the same angle of attack (see sample).

import { DEG } from '../../core/math';
import { BemtSolver } from './bemt';
import { PROP_RADIUS, bladeAngleAt } from './bladeGeometry';
import { C172_PROPELLER } from './c172Powerplant';
import type { PropellerDef } from './defs';

/** Advance-angle nodes: 2 deg through the operating band (static to windmilling), coarser in the far quadrants. */
const BETA = [
  ...Array.from({ length: 10 }, (_, i) => (-90 + 6 * i) * DEG),
  ...Array.from({ length: 40 }, (_, i) => (-30 + 2 * i) * DEG),
  ...Array.from({ length: 9 }, (_, i) => (50 + 5 * i) * DEG),
];
/** In-plane fraction nodes; 1 is a stopped propeller in purely in-plane flow. */
const ETA = [0, 0.05, 0.12, 0.25, 0.45, 0.7, 1];
const MACH = [0.05, 0.2, 0.3, 0.36, 0.4, 0.43, 0.46, 0.49, 0.52, 0.55, 0.58, 0.61, 0.65, 0.7];
const CHANNELS = 4;
const AZIMUTHS = 6;
/** Blade elements of the solver a map is tabulated with. */
const MAP_ELEMENTS = 14;
/** Speed of sound used while building; only the Mach number matters to the coefficients. */
const BUILD_SOUND_SPEED = 340;

/** The operating points a map is tabulated at, and how its coefficients are stored. */
export interface PropellerMapGrid {
  /** Advance-angle nodes, rad, ascending. */
  beta: readonly number[];
  /** In-plane fraction nodes, ascending from 0 to 1. */
  eta: readonly number[];
  /** Reference Mach number nodes, ascending. */
  mach: readonly number[];
  /** Single-precision storage (a slice of a constant-speed propeller). */
  single: boolean;
}

/** The grid of a fixed-pitch propeller's map: the whole four-quadrant range in double precision. */
const FULL_GRID: PropellerMapGrid = { beta: BETA, eta: ETA, mach: MACH, single: false };

/**
 * Constant-speed slices: in-plane fraction and Mach nodes. The in-plane loads are nearly linear in the fraction
 * over the few hundredths a propeller in flight sees, so four nodes do. The Mach number needs the 0.03 spacing of
 * the full grid between 0.52 and 0.61, where these propellers take off and climb: the wave drag of the heavily
 * loaded tips grows with the fourth power of the excess over the critical Mach number, and seven nodes
 * interpolated the static torque 7 to 12 % high.
 */
const SLICE_ETA = [0, 0.1, 0.4, 1];
const SLICE_MACH = [0.05, 0.3, 0.4, 0.44, 0.48, 0.52, 0.55, 0.58, 0.61, 0.65, 0.7];
/** Advance-angle nodes of a slice, degrees: fine spacing within this band of the blade angle, coarse outside it. */
const SLICE_BETA_FROM = -20;
const SLICE_BETA_BAND = 20;
const SLICE_BETA_FINE = 2;
const SLICE_BETA_COARSE = 5;
/** Most slices a constant-speed propeller may have (about 1 600 operating points each: 0.4 MB and under a second to tabulate in all). */
export const PROP_MAX_SLICES = 16;
/** Advance angle of a stopped propeller, rad: the angle-of-attack alignment of the slices fades out toward it (see sample). */
const STOPPED_BETA = Math.PI / 2;

/**
 * The grid of one slice of a constant-speed propeller, for the blade angle `bladeAngle` at 0.75 R, rad. The
 * propeller works between static (advance angle 0) and windmilling (a little above the blade angle), so the
 * advance angle is tabulated every 2 degrees within 20 degrees of the blade angle and every 5 degrees over the
 * rest of -20 .. +90 degrees: a fine blade is resolved round the take-off and climb, a feathered one round the
 * stopped propeller at 90 degrees, where its torque passes through zero.
 */
export function sliceGrid(bladeAngle: number): PropellerMapGrid {
  const centre = SLICE_BETA_FINE * Math.round(bladeAngle / DEG / SLICE_BETA_FINE);
  const lo = centre - SLICE_BETA_BAND;
  const hi = centre + SLICE_BETA_BAND;
  const beta: number[] = [];
  for (let b = SLICE_BETA_FROM; b < 90; ) {
    beta.push(b * DEG);
    // Coarse steps stop on the band's lower edge, so the band starts on a node.
    b = b >= lo && b < hi ? b + SLICE_BETA_FINE : b < lo ? Math.min(b + SLICE_BETA_COARSE, lo) : b + SLICE_BETA_COARSE;
  }
  beta.push(90 * DEG);
  return { beta, eta: SLICE_ETA, mach: SLICE_MACH, single: true };
}

/** Disc area of the Cessna 172S propeller, m^2 (a map carries its own: PropellerMap.discArea). */
export const DISC_AREA = Math.PI * PROP_RADIUS * PROP_RADIUS;

export interface MapSample {
  ct: number;
  cq: number;
  cf: number;
  cm: number;
}

/** Continuous index of x in an ascending array (node i plus fraction), clamped to the array. */
function fractionalIndex(xs: readonly number[], x: number): number {
  const n = xs.length;
  if (x <= xs[0]) return 0;
  if (x >= xs[n - 1]) return n - 1.000001;
  let i = 0;
  while (xs[i + 1] < x) i++;
  return i + (x - xs[i]) / (xs[i + 1] - xs[i]);
}

/** Radial bins of the slipstream's swirl profile (equal steps of r / R). */
export const SWIRL_BINS = 10;
/** Reference Mach number (0.7R) of the swirl profiles: the climb and cruise operating band. */
const SWIRL_MACH = 0.49;

/**
 * Radial distribution of the swirl the propeller leaves in its slipstream, per advance-angle node (no in-plane
 * flow). Annulus momentum balance (Glauert, "Airplane propellers", in Durand, Aerodynamic Theory IV, div. L,
 * 1935): the torque of an annulus is the angular momentum flux through it, dQ = dmdot r v_theta, and r v_theta
 * is then conserved along the stream tube as it contracts. With the uniform axial velocity of the actuator-disc
 * jet, r v_theta = (Q / mdot) k(xi) where k is the torque per unit disc area over its mean, (dQ/dA) / (Q/A), at
 * xi = r / R (the contraction keeps the area fraction, so xi is also the radius over the far-wake radius). This
 * blade loads mostly its outer half, so k grows roughly linearly with xi: v_theta is nearly uniform across the
 * jet, not the solid-body rotation (v_theta ~ r) that piles the swirl up at the jet's edge.
 * Where the loading changes sign along the blade (windmilling) the net torque no longer measures the swirl and
 * the solid-body profile, k = 2 xi^2, is stored.
 */
function buildSwirlProfiles(solver: BemtSolver, betas: readonly number[]): Float64Array {
  const out = new Float64Array(betas.length * SWIRL_BINS);
  const u = SWIRL_MACH * BUILD_SOUND_SPEED;
  const R = solver.radius;
  const bin = new Float64Array(SWIRL_BINS);
  for (let i = 0; i < betas.length; i++) {
    const va = u * Math.sin(betas[i]);
    const omega = Math.max(0, (u * Math.cos(betas[i])) / (0.7 * R));
    bin.fill(0);
    let q = 0, qAbs = 0;
    for (const e of solver.elements) {
      const dq = e.r * e.dr * solver.solveElement(e, va, omega * e.r, 1, BUILD_SOUND_SPEED).tangentialForce;
      q += dq;
      qAbs += Math.abs(dq);
      // Spread the element's torque over the bins its radial extent overlaps.
      const lo = (e.r - 0.5 * e.dr) / R, hi = (e.r + 0.5 * e.dr) / R;
      for (let j = Math.max(0, Math.floor(lo * SWIRL_BINS)); j < SWIRL_BINS && j / SWIRL_BINS < hi; j++) {
        const overlap = Math.min(hi, (j + 1) / SWIRL_BINS) - Math.max(lo, j / SWIRL_BINS);
        if (overlap > 0) bin[j] += (dq * overlap) / (hi - lo);
      }
    }
    for (let j = 0; j < SWIRL_BINS; j++) {
      const xi = (j + 0.5) / SWIRL_BINS;
      // Area fraction of the bin: ((j+1)^2 - j^2) / n^2 = 2 xi / n.
      out[i * SWIRL_BINS + j] = omega > 0 && q > 0.8 * qAbs ? bin[j] / q / ((2 * xi) / SWIRL_BINS) : 2 * xi * xi;
    }
  }
  return out;
}

export class PropellerMap {
  /** Tip radius, m, and disc area, m^2, of the propeller the coefficients are referred to. */
  readonly radius: number;
  readonly discArea: number;
  private readonly table: Float64Array | Float32Array;
  private readonly swirl: Float64Array;
  private readonly beta: readonly number[];
  private readonly eta: readonly number[];
  private readonly mach: readonly number[];

  /** `grid`: the operating points to tabulate (default: the whole range, as a fixed-pitch propeller needs it). */
  constructor(solver: BemtSolver = new BemtSolver(MAP_ELEMENTS), grid: PropellerMapGrid = FULL_GRID) {
    const { beta: betas, eta: etas, mach: machs } = grid;
    this.beta = betas;
    this.eta = etas;
    this.mach = machs;
    this.radius = solver.radius;
    this.discArea = Math.PI * this.radius * this.radius;
    this.swirl = buildSwirlProfiles(solver, betas);
    const size = betas.length * etas.length * machs.length * CHANNELS;
    this.table = grid.single ? new Float32Array(size) : new Float64Array(size);
    const loads = { thrust: 0, torque: 0, forceZ: 0, momentZ: 0 };
    const r = this.radius;
    const area = this.discArea;
    for (let k = 0; k < machs.length; k++) {
      const u = machs[k] * BUILD_SOUND_SPEED;
      const q = 0.5 * u * u; // unit density
      for (let j = 0; j < etas.length; j++) {
        const axialAndRotation = u * Math.sqrt(1 - etas[j] * etas[j]);
        for (let i = 0; i < betas.length; i++) {
          const beta = betas[i];
          const va = axialAndRotation * Math.sin(beta);
          const omega = Math.max(0, (axialAndRotation * Math.cos(beta)) / (0.7 * r));
          solver.rotorLoads(va, u * etas[j], omega, 1, BUILD_SOUND_SPEED, AZIMUTHS, loads);
          const o = this.offset(i, j, k);
          this.table[o] = loads.thrust / (q * area);
          this.table[o + 1] = loads.torque / (q * area * r);
          this.table[o + 2] = loads.forceZ / (q * area);
          this.table[o + 3] = loads.momentZ / (q * area * r);
        }
      }
    }
  }

  /** Number of operating points tabulated. */
  get points(): number {
    return this.table.length / CHANNELS;
  }

  private offset(i: number, j: number, k: number): number {
    return ((k * this.eta.length + j) * this.beta.length + i) * CHANNELS;
  }

  /** Swirl profile k(xi) at advance angle `beta` (see buildSwirlProfiles) into `out` (SWIRL_BINS values). */
  swirlProfile(beta: number, out: Float64Array): Float64Array {
    const x = fractionalIndex(this.beta, beta);
    const i = Math.floor(x);
    const f = x - i;
    const s = this.swirl;
    for (let j = 0; j < SWIRL_BINS; j++) out[j] = (1 - f) * s[i * SWIRL_BINS + j] + f * s[(i + 1) * SWIRL_BINS + j];
    return out;
  }

  /** Trilinear lookup. Coordinates outside the tabulated range are clamped. */
  sample(beta: number, eta: number, mach: number, out: MapSample): MapSample {
    const x = fractionalIndex(this.beta, beta);
    const i = Math.floor(x);
    const fi = x - i;
    const y = fractionalIndex(this.eta, eta);
    const j = Math.floor(y);
    const fj = y - j;
    const z = fractionalIndex(this.mach, mach);
    const k = Math.floor(z);
    const fk = z - k;
    const t = this.table;
    let ct = 0;
    let cq = 0;
    let cf = 0;
    let cm = 0;
    for (let dk = 0; dk < 2; dk++) {
      const wk = dk ? fk : 1 - fk;
      for (let dj = 0; dj < 2; dj++) {
        const wjk = wk * (dj ? fj : 1 - fj);
        for (let di = 0; di < 2; di++) {
          const w = wjk * (di ? fi : 1 - fi);
          if (w === 0) continue;
          const o = this.offset(i + di, j + dj, k + dk);
          ct += w * t[o];
          cq += w * t[o + 1];
          cf += w * t[o + 2];
          cm += w * t[o + 3];
        }
      }
    }
    out.ct = ct;
    out.cq = cq;
    out.cf = cf;
    out.cm = cm;
    return out;
  }
}

/**
 * The coefficient tables of one propeller design.
 *
 * A fixed-pitch propeller has ONE slice: the PropellerMap of the blade as built. A constant-speed propeller has
 * one slice per entry of its definition's `pitchNodes` (blade angles at the reference station, fine stop to
 * feather or coarse stop), each on the reduced grid of sliceGrid(); sample() interpolates linearly in blade
 * angle between the two neighbouring slices, each read at the advance angle that gives its blade the angle of
 * attack the blade between them has.
 *
 * Slices are tabulated on first use (fixed pitch about 0.15 s, a constant-speed slice about a quarter of that),
 * so a definition costs nothing until a propeller of it is made. The application calls prebuild() while the
 * aircraft loads, so that no slice is ever tabulated inside the frame loop.
 */
export class PropellerCharacteristics {
  readonly radius: number;
  readonly discArea: number;
  readonly sliceCount: number;
  /** Blade angle of each slice at the reference station, rad (empty for a fixed-pitch propeller). */
  readonly pitchNodes: readonly number[];
  /** The blade angle is variable: sample() and swirlProfile() take it; slice(0) alone is not the propeller. */
  readonly variablePitch: boolean;
  private readonly slices: (PropellerMap | undefined)[];
  private readonly upper: MapSample = { ct: 0, cq: 0, cf: 0, cm: 0 };
  private readonly upperSwirl = new Float64Array(SWIRL_BINS);

  constructor(readonly def: PropellerDef) {
    const control = def.pitchControl;
    this.variablePitch = control.kind === 'constantSpeed';
    this.pitchNodes = control.kind === 'constantSpeed' ? control.pitchNodes : [];
    if (control.kind === 'constantSpeed') {
      const nodes = control.pitchNodes;
      if (nodes.length < 2 || nodes.length > PROP_MAX_SLICES) throw new Error(`${def.name}: 2 to ${PROP_MAX_SLICES} pitch nodes, not ${nodes.length}`);
      for (let i = 1; i < nodes.length; i++) if (!(nodes[i] > nodes[i - 1])) throw new Error(`${def.name}: pitch nodes must ascend`);
      const coarsest = control.feather ? Math.max(control.feather.angle, control.coarseStop) : control.coarseStop;
      if (nodes[0] > control.fineStop + 1e-9 || nodes[nodes.length - 1] < coarsest - 1e-9) {
        throw new Error(`${def.name}: the pitch nodes must span the blade's travel, fine stop to ${control.feather ? 'feather' : 'coarse stop'}`);
      }
    }
    this.sliceCount = this.variablePitch ? this.pitchNodes.length : 1;
    this.slices = new Array<PropellerMap | undefined>(this.sliceCount).fill(undefined);
    this.radius = def.diameter / 2;
    this.discArea = Math.PI * this.radius * this.radius;
  }

  /** The map at blade-angle node `i` (fixed pitch: the one slice, 0). */
  slice(i = 0): PropellerMap {
    const built = this.slices[i];
    if (built) return built;
    if (!this.variablePitch) return (this.slices[i] = new PropellerMap(new BemtSolver(MAP_ELEMENTS, this.def)));
    const pitch = this.pitchNodes[i];
    return (this.slices[i] = new PropellerMap(new BemtSolver(MAP_ELEMENTS, this.def, pitch), sliceGrid(bladeAngleAt(this.def, 0.75, pitch))));
  }

  /** Tabulate every slice that is not tabulated yet (governing and feather range alike). Returns how many it built. */
  prebuild(): number {
    let built = 0;
    for (let i = 0; i < this.sliceCount; i++) {
      if (!this.slices[i]) built++;
      this.slice(i);
    }
    return built;
  }

  /** Slice below blade angle `pitch` and the fraction of the way to the next, as index + fraction (clamped to the nodes). */
  private bracket(pitch: number): number {
    return fractionalIndex(this.pitchNodes, pitch);
  }

  /**
   * Coefficients at blade angle `pitch` (rad, at the reference station; ignored by a fixed-pitch propeller):
   * the two neighbouring slices, each looked up on its own grid, blended linearly in blade angle.
   *
   * Each slice is read at the advance angle shifted by its blade's difference from `pitch` (the finer slice at a
   * smaller advance angle, the coarser at a larger), so that both are read at the angle of attack of the blade
   * in between. Read at the same advance angle, the two put the stall of the inboard sections at low advance
   * ratio (take-off, climb) in two places, and the blend of the two knees was 7-13 % off the solver between
   * nodes (review-Bm-propulsion F2); aligned, within the 3-4 % the grid makes on a node. The shift fades out over
   * the last node spacing before the stopped propeller (beta 90 degrees), the edge of every slice's grid.
   */
  sample(beta: number, eta: number, mach: number, pitch: number, out: MapSample): MapSample {
    if (!this.variablePitch) return this.slice(0).sample(beta, eta, mach, out);
    const x = this.bracket(pitch);
    const i = Math.floor(x);
    const f = x - i;
    if (f === 0) return this.slice(i).sample(beta, eta, mach, out);
    const shift = this.alignment(beta, i);
    this.slice(i).sample(beta - f * shift, eta, mach, out);
    const b = this.slice(i + 1).sample(beta + (1 - f) * shift, eta, mach, this.upper);
    out.ct += f * (b.ct - out.ct);
    out.cq += f * (b.cq - out.cq);
    out.cf += f * (b.cf - out.cf);
    out.cm += f * (b.cm - out.cm);
    return out;
  }

  /**
   * Spacing of the slices on either side of blade angle node `i` .. `i + 1` that sample() shifts the advance angle
   * by, rad: the whole spacing, fading to none over the last spacing before the stopped propeller.
   */
  private alignment(beta: number, i: number): number {
    const spacing = this.pitchNodes[i + 1] - this.pitchNodes[i];
    return spacing * Math.min(1, Math.max(0, (STOPPED_BETA - beta) / spacing));
  }

  /** Swirl profile k(xi) at advance angle `beta` and blade angle `pitch` into `out` (SWIRL_BINS values), slices aligned as in sample(). */
  swirlProfile(beta: number, pitch: number, out: Float64Array): Float64Array {
    if (!this.variablePitch) return this.slice(0).swirlProfile(beta, out);
    const x = this.bracket(pitch);
    const i = Math.floor(x);
    const f = x - i;
    if (f === 0) return this.slice(i).swirlProfile(beta, out);
    const shift = this.alignment(beta, i);
    this.slice(i).swirlProfile(beta - f * shift, out);
    const b = this.slice(i + 1).swirlProfile(beta + (1 - f) * shift, this.upperSwirl);
    for (let j = 0; j < SWIRL_BINS; j++) out[j] += f * (b[j] - out[j]);
    return out;
  }
}

const characteristics = new WeakMap<PropellerDef, PropellerCharacteristics>();

/**
 * The characteristics of a propeller definition. They are a pure function of the blade design, so ONE instance
 * per definition object serves every propeller made from it (both propellers of a twin share theirs).
 */
export function propellerCharacteristicsFor(def: PropellerDef): PropellerCharacteristics {
  let c = characteristics.get(def);
  if (!c) {
    c = new PropellerCharacteristics(def);
    characteristics.set(def, c);
  }
  return c;
}

/** The map of the Cessna 172S propeller: the one slice of its characteristics. */
export function sharedPropellerMap(): PropellerMap {
  return propellerCharacteristicsFor(C172_PROPELLER).slice(0);
}
