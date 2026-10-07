// Propeller slipstream velocity field seen by the airframe.
//
// Actuator-disc momentum theory: the axial velocity increment develops from v_i at the disc to 2 v_i
// far downstream as v(d) = v_i (1 + d / sqrt(d^2 + R^2)) (d = distance downstream of the disc; the same
// expression gives the inflow ahead of it), while the tube contracts to the far-wake radius. Inside the
// tube the air also rotates about the body x axis, with the angular momentum the blades gave each stream tube
// (the propeller's radial torque distribution; see angularMomentum()). The tube is convected with
// the flow: its centreline leaves the disc along the resultant of the free stream and the jet, so at
// high angle of attack and low power the tail drops out of the slipstream; behind the wing it is also
// carried by the velocity the wing induces in it (set by the caller through setPath(): see AeroModel).
//
// Jet boundary. The wing sections inside the jet carry more circulation than those outside; the vortices shed
// at the jet's edges lie on the jet's boundary, a shear layer across which the pressure is continuous while the
// speed jumps from Vj to V. That boundary condition is met by image vortices of the same sense (an open jet:
// Glauert, "Wind tunnel interference on wings, bodies and airscrews", ARC R&M 1566, 1933), of strength
// (1 - mu^2) / (1 + mu^2) times the shed vorticity for a jet in a moving stream, mu = V / Vj (Koning, in Durand,
// "Aerodynamic Theory" vol. IV div. M, 1935; Rethorst, J. Aero. Sci. 25, 1958). They add a downwash inside the jet
// that a lattice in uniform flow does not have: at the wing (Glauert's delta = 1/8 for a small wing in a circular
// jet) dalpha = (1/8) (1 - mu^2)/(1 + mu^2) L_ex / (q_j A_j), with L_ex the lift the jet adds to the immersed
// sections, A_j the jet's area and q_j its dynamic pressure; twice that far behind. It is why the downwash inside
// a slipstream behind a lifting wing exceeds the free stream's beside it (Perkins & Hage, "Airplane Performance,
// Stability and Control", sec. 5-8), and it grows with the lift and the jet's velocity ratio, so at high power and
// high lift it carries the jet down past the tail. It is used for the jet's path (AeroModel.updateJetPath;
// setBoundaryDownwash, boundaryAngle).
// The same images act on the lifting surfaces inside the jet: they lower the immersed wing sections' angle of
// attack by half the far value and, at the tail, both turn the flow and (through the tail's own images) reduce
// the tail's response to it - Koning's reduction of the lift increment in a slipstream. Those are left to the
// lifting lines' strip treatment of the jet: adding the turning at the tail without the tail's own images put
// the full-power neutral point 0.14 MAC ahead of the power-off one, against ~0 measured with the path alone.
//
// Mixing. The jet's edge is a shear layer that thickens linearly downstream at a rate proportional to the
// velocity ratio lambda = (Vj - V) / (Vj + V) (Vj = V + 2 v_i the jet speed): for a jet into still air
// (lambda = 1) the layer reaches the axis about five diameters behind the disc, the classical length of a
// round jet's potential core. The profile is a plateau with a smooth edge across the layer, and its
// amplitude keeps the excess momentum flux of the jet (integral of u^n dA, n = 2 for a static jet, n = 1
// for a weak jet in a fast free stream). At low speed and high power the jet that reaches the tail is
// therefore wider, slower on its axis and carries less of its momentum across the tailplane's line, as on
// the real aircraft; in cruise (lambda ~0.1) it barely spreads.

import type { Slipstream } from '../interfaces';
import type { MutableVec3 } from './vortex';
import type { Vec3 } from '../../core/math';

/** Growth of the jet's shear-layer thickness per metre downstream per unit velocity ratio (static jet: the
 *  layer reaches the axis ~5 diameters behind the disc). */
const MIXING_RATE = 0.32;
/**
 * Radial distribution of the swirl (see Slipstream.swirlProfile): bins of equal xi = r / (tube radius). Swirl is
 * not reduced behind the wing here: the wing sections in the jet meet the rotating flow at opposite angles on the
 * two sides of its axis, and the change in their circulation sheds trailing vorticity that counter-rotates the
 * flow behind them (the "swirl recovery" measured behind tractor wing-propeller combinations: Witkowski, Lee &
 * Sullivan, J. Aircraft 26(9) 1989; Veldhuis, TU Delft 2005). The aerodynamic model already carries that
 * vorticity to the tail through the wing's vortex wake (its circulation, swirl response included, induces the
 * tail's inflow), so scaling the swirl down as well counted the recovery twice. On this high wing only the jet's
 * upper edge crosses the wing; the jet core that reaches the fin passes along the cabin sides.
 */
const PROFILE_BINS = 10;
const SOLID_BODY = Float64Array.from({ length: PROFILE_BINS }, (_, j) => 2 * ((j + 0.5) / PROFILE_BINS) ** 2);
/** Tabulation of the mixing amplitude along the jet: points and spacing, m (the tail is ~6.5 m behind the disc). */
const AMP_POINTS = 21;
const AMP_STEP = 0.5;
/**
 * Largest far-wake radius of a deficit tube behind a windmilling propeller (inducedVelocity < 0), in disc radii. Such
 * a wake is a deficit tube as momentum theory has it, EXPANDING to R sqrt((V + u) / (V + 2u)), and it mixes out like
 * an excess jet at the velocity ratio |Vj - V| / (Vj + V).
 */
const DEFICIT_EXPANSION = 1.15;
/** Most stations the jet's convected path (setPath) can be given at. */
export const MAX_PATH = 16;

/** Integral of the (linear-ramp) profile to the power n over the jet's cross-section, per pi. */
function profileIntegral(mid: number, width: number, n: 1 | 2): number {
  const c = mid + 0.5 * width;
  const a = mid - 0.5 * width;
  if (a > 0) return n === 2 ? a * a + 2 * ((c * width) / 3 - (width * width) / 4) : a * a + 2 * ((c * width) / 2 - (width * width) / 3);
  // The layer has reached the axis: the ramp starts below 1 on the axis.
  return n === 2 ? (c * c * c * c) / (6 * width * width) : (c * c * c) / (3 * width);
}

/** Amplitude that keeps the excess momentum flux of a jet whose shear layer has grown from minWidth to width. */
function mixingAmplitude(mid: number, minWidth: number, width: number, lambda: number): number {
  const a1 = profileIntegral(mid, minWidth, 1) / profileIntegral(mid, width, 1);
  const a2 = Math.sqrt(profileIntegral(mid, minWidth, 2) / profileIntegral(mid, width, 2));
  return Math.pow(a1, 1 - lambda) * Math.pow(a2, lambda);
}

const smooth = (x: number) => x * x * (3 - 2 * x);

export class SlipstreamField {
  private active = false;
  private ox = 0;
  private oy = 0;
  private oz = 0;
  /** Unit direction in which the jet travels (body axes). */
  private jx = -1;
  private jy = 0;
  private jz = 0;
  private vi = 0;
  /** Axial free-stream speed at the disc, m/s. */
  private freeSpeed = 0;
  /** r v_theta = kScale k(xi): half the mean swirl rate times the far-wake radius squared, m^2/s. */
  private kScale = 0;
  /** Swirl profile k(xi) at xi = (j + 0.5) / PROFILE_BINS. */
  private readonly profile = new Float64Array(PROFILE_BINS);
  private rFar = 0;
  /**
   * Displacement of the centreline from the straight line along (jx, jy, jz) by the velocity the wing induces in
   * the jet, at body-x stations pathX (descending); applied behind the wing's trailing edge (see setPath()).
   */
  private readonly pathX = new Float64Array(MAX_PATH);
  private readonly pathY = new Float64Array(MAX_PATH);
  private readonly pathZ = new Float64Array(MAX_PATH);
  private pathN = 0;
  /** Largest |displacement| along the path, m (for mayReach). */
  private pathMax = 0;
  /** Jet-boundary downwash angle far behind the wing (see the header), rad, and the wing's quarter-chord x. */
  private boundaryEps = 0;
  private boundaryX = 0;
  /** Scratch for the centreline displacement at a point. */
  private offY = 0;
  private offZ = 0;
  /** Velocity ratio |Vj - V| / (Vj + V) of the jet and the free stream, 0..1 (a deficit counts too). */
  private lambda = 0;
  /** Mixing amplitude tabulated against the distance downstream (every AMP_STEP metres). */
  private readonly amp = new Float64Array(AMP_POINTS);
  /**
   * Overall strength 0..1: a jet blowing into air that arrives from behind (tailwind run-up, tail slide) does
   * not form a clean tube; it breaks down (vortex-ring state) and is gone once the reverse flow reaches its
   * own far-wake speed.
   */
  private strength = 1;

  constructor(
    private readonly discRadius: number,
    /** Body x of the wing trailing edge, where the wing's downwash starts to turn the jet. */
    private readonly wingTrailingEdgeX: number,
  ) {}

  /**
   * Displace the jet's centreline behind the wing's trailing edge: (ys[k], zs[k]) is its sideways and downward
   * displacement at body x = xs[k] (xs descending, from the disc aft) from the straight line it leaves the disc
   * along. Linear between stations, continued along the last segment's slope beyond the last one.
   */
  setPath(xs: ArrayLike<number>, ys: ArrayLike<number>, zs: ArrayLike<number>, n: number): void {
    const m = Math.min(n, MAX_PATH);
    let max = 0;
    for (let k = 0; k < m; k++) {
      this.pathX[k] = xs[k];
      this.pathY[k] = ys[k];
      this.pathZ[k] = zs[k];
      max = Math.max(max, Math.abs(ys[k]) + Math.abs(zs[k]));
    }
    this.pathN = m;
    this.pathMax = max;
  }

  /** Straight jet again (no displacement by the wing, no boundary downwash). */
  clearPath(): void {
    this.pathN = 0;
    this.pathMax = 0;
    this.boundaryEps = 0;
  }

  /** Jet-boundary downwash far behind the wing, rad, for a wing whose quarter chord is at body x = wingX. */
  setBoundaryDownwash(eps: number, wingX: number): void {
    this.boundaryEps = Number.isFinite(eps) ? eps : 0;
    this.boundaryX = wingX;
  }

  /** Jet-boundary downwash angle at body x (see the header): the far value times the horseshoe's growth. */
  boundaryAngle(x: number): number {
    if (this.boundaryEps === 0) return 0;
    const d = this.boundaryX - x;
    const R = this.rFar;
    return 0.5 * this.boundaryEps * (1 + d / Math.sqrt(d * d + R * R));
  }

  /** Body x of the wing trailing edge, behind which the jet's path and boundary downwash apply. */
  get trailingEdgeX(): number {
    return this.wingTrailingEdgeX;
  }

  /** Whether there is a jet this step. */
  get isActive(): boolean {
    return this.active && this.strength > 0;
  }

  /** Far-wake radius of the jet, m. */
  get radius(): number {
    return this.rFar;
  }

  /**
   * The straight centreline (before setPath's displacement) at body x: writes its y and z into `out` and returns
   * the jet's axial speed there (free stream plus the developing momentum-theory increment), m/s.
   */
  centreline(x: number, out: MutableVec3): number {
    const t = Math.abs(this.jx) > 1e-6 ? (x - this.ox) / this.jx : 0;
    out.x = x;
    out.y = this.oy + this.jy * t;
    out.z = this.oz + this.jz * t;
    const d = Math.max(t, 0);
    return this.freeSpeed + this.vi * (1 + d / Math.sqrt(d * d + this.discRadius * this.discRadius));
  }

  /** Centreline displacement at body x into offY / offZ. */
  private offsetAt(x: number): void {
    const n = this.pathN;
    if (n < 2 || x >= this.wingTrailingEdgeX) {
      this.offY = this.offZ = 0;
      return;
    }
    const X = this.pathX;
    if (x >= X[0]) {
      this.offY = this.pathY[0];
      this.offZ = this.pathZ[0];
      return;
    }
    let k = 0;
    while (k < n - 2 && x < X[k + 1]) k++;
    const f = (x - X[k]) / (X[k + 1] - X[k]);
    this.offY = this.pathY[k] + (this.pathY[k + 1] - this.pathY[k]) * f;
    this.offZ = this.pathZ[k] + (this.pathZ[k + 1] - this.pathZ[k]) * f;
  }

  /**
   * Set up the field for this step. `freeStream` is the air velocity relative to the aircraft at the
   * disc (body axes, pointing aft in forward flight).
   */
  prepare(ss: Slipstream | null, freeStream: Vec3): void {
    this.active = ss !== null && (ss.inducedVelocity !== 0 || ss.swirlRate !== 0);
    if (!ss || !this.active) return;
    this.ox = ss.origin.x;
    this.oy = ss.origin.y;
    this.oz = ss.origin.z;
    this.vi = ss.inducedVelocity;
    const deficit = ss.inducedVelocity < 0;
    this.rFar = Math.min(Math.max(ss.radius, 0.3 * this.discRadius), deficit ? DEFICIT_EXPANSION * this.discRadius : this.discRadius);
    this.kScale = 0.5 * ss.swirlRate * this.rFar * this.rFar;
    const k = ss.swirlProfile && ss.swirlProfile.length === PROFILE_BINS ? ss.swirlProfile : SOLID_BODY;
    for (let j = 0; j < PROFILE_BINS; j++) this.profile[j] = k[j];
    const V = Math.max(-freeStream.x, 0);
    this.freeSpeed = V;
    const vj = V + 2 * (deficit ? ss.inducedVelocity : Math.max(ss.inducedVelocity, 0));
    this.lambda = vj + V > 1e-6 ? Math.min(Math.max((deficit ? V - vj : vj - V) / (vj + V), 0), 1) : 0;
    for (let k = 0; k < AMP_POINTS; k++) {
      const d = k * AMP_STEP;
      const R = this.discRadius;
      const tube = R + (this.rFar - R) * (d / Math.sqrt(d * d + R * R));
      const minWidth = 0.15 * tube;
      const width = MIXING_RATE * this.lambda * d;
      this.amp[k] = width > minWidth ? mixingAmplitude(0.925 * tube, minWidth, width, this.lambda) : 1;
    }
    // Air arriving from behind: fade the jet out as the reverse flow approaches the jet's far-wake increment.
    const jetIncrement = 2 * Math.abs(ss.inducedVelocity);
    const reverse = jetIncrement > 1e-6 ? Math.max(freeStream.x, 0) / jetIncrement : freeStream.x > 0 ? 1 : 0;
    this.strength = reverse <= 0.25 ? 1 : reverse >= 1 ? 0 : 1 - smooth((reverse - 0.25) / 0.75);
    // Jet direction: free stream plus the fully developed jet increment along -x (kept pointing aft; the jet
    // has faded out before a reverse flow could turn it round).
    const jx = Math.min(freeStream.x - 2 * ss.inducedVelocity, -0.5 * jetIncrement), jy = freeStream.y, jz = freeStream.z;
    const l = Math.hypot(jx, jy, jz);
    if (l > 1e-3) {
      this.jx = jx / l;
      this.jy = jy / l;
      this.jz = jz / l;
    } else {
      this.jx = -1;
      this.jy = this.jz = 0;
    }
  }

  /**
   * Angular momentum per unit mass of the swirl, r v_theta (m^2/s), at xi = r / (tube radius): the profile
   * interpolated between bin centres, falling linearly to zero on the axis (the spinner passes no torque) and
   * extrapolated to the tube's edge. Beyond the edge it keeps that value: air entrained by the mixing layer
   * shares the edge's angular momentum, so its swirl falls off as 1 / r (Rankine).
   */
  private angularMomentum(xi: number): number {
    const k = this.profile;
    const x = Math.min(xi, 1) * PROFILE_BINS - 0.5;
    if (x <= 0) return this.kScale * k[0] * Math.max(xi * 2 * PROFILE_BINS, 0);
    const j = Math.min(Math.floor(x), PROFILE_BINS - 2);
    const f = x - j;
    return this.kScale * (k[j] + (k[j + 1] - k[j]) * f);
  }

  /**
   * False when no point within `radius` of p can be inside the jet (a cheap test that lets a caller skip the
   * samples of a strip well clear of it).
   */
  mayReach(p: Vec3, radius: number): boolean {
    if (!this.active || this.strength <= 0) return false;
    this.offsetAt(p.x);
    const rx = p.x - this.ox, ry = p.y - this.oy - this.offY, rz = p.z - this.oz - this.offZ;
    const d = rx * this.jx + ry * this.jy + rz * this.jz;
    const px = rx - d * this.jx, py = ry - d * this.jy, pz = rz - d * this.jz;
    // Largest outer edge of the jet anywhere within `radius` downstream (only a deficit tube exceeds the disc radius),
    // and the smallest radial distance a point within `radius` of p can have (the path bends the centreline by
    // at most a few tenths of a metre per metre).
    const R = Math.max(this.discRadius, this.rFar);
    const outer = 0.925 * R + 0.5 * Math.max(0.15 * R, MIXING_RATE * this.lambda * Math.max(d + radius, 0));
    const reach = outer + radius * 1.5 + (this.pathMax > 0 && p.x - radius < this.wingTrailingEdgeX ? 0.1 : 0);
    return px * px + py * py + pz * pz < reach * reach;
  }

  /**
   * Add `weight` times the slipstream velocity at body point p (reference-point axes) to `out`. `axial` scales
   * the axial increment alone, whatever its sign (PropellerStation.wingBlowing on the wing's strips: a wing in a
   * jet about one chord deep does not gain the lift of a wing in an unbounded stream of the jet's speed). `swirl`
   * scales the swirl alone (PropellerStation.swirlBehindWing on the tail's strips).
   */
  add(p: Vec3, out: MutableVec3, weight: number, axial = 1, swirl = 1): void {
    if (!this.active || this.strength <= 0) return;
    this.offsetAt(p.x);
    const rx = p.x - this.ox, ry = p.y - this.oy - this.offY, rz = p.z - this.oz - this.offZ;
    const d = rx * this.jx + ry * this.jy + rz * this.jz;
    // Radial offset from the (convected) jet centreline.
    const px = rx - d * this.jx, py = ry - d * this.jy, pz = rz - d * this.jz;
    const radial = Math.sqrt(px * px + py * py + pz * pz);
    const R = this.discRadius;
    const dev = d / Math.sqrt(d * d + R * R);
    const tubeRadius = d > 0 ? R + (this.rFar - R) * dev : R;
    // Shear layer centred on 0.925 of the tube radius, 0.15 radii thick at the disc (the old fixed soft edge),
    // thickening downstream; the amplitude conserves the jet's excess momentum flux.
    const mid = 0.925 * tubeRadius;
    const minWidth = 0.15 * tubeRadius;
    const width = Math.max(minWidth, MIXING_RATE * this.lambda * Math.max(d, 0));
    const outer = mid + 0.5 * width;
    if (radial >= outer) return;
    const e = Math.min((outer - radial) / width, 1);
    let amplitude = 1;
    if (width > minWidth) {
      const x = Math.min(d / AMP_STEP, AMP_POINTS - 1.000001);
      const k = Math.floor(x);
      amplitude = this.amp[k] + (this.amp[k + 1] - this.amp[k]) * (x - k);
    }
    const w = e * e * (3 - 2 * e) * amplitude * weight * this.strength;
    // The actuator disc accelerates the air along its axis, the propeller shaft (body -x): in inclined flow the
    // induced velocity is normal to the disc (Glauert's momentum theory for the oblique disc), while the tube
    // that carries it is convected along the resultant of the free stream and the jet (see prepare()). Inside
    // the jet the cross-flow component is therefore the free stream's alone, diluted by the faster axial flow,
    // which is what makes a tractor propeller's slipstream reduce the tail's angle-of-attack change with the
    // aircraft's (a destabilising power effect; Perkins & Hage sec. 5-8, Obert ch. 29).
    out.x -= this.vi * (1 + dev) * w * axial;
    // Swirl about the jet's own (convected) centreline, about body x (only the y-z part of the offset from the
    // centreline rotates): v_theta = K(xi) / r with K = r v_theta the angular momentum per unit mass the blade
    // put into that stream tube, conserved as the tube contracts (see angularMomentum()).
    if (radial < 1e-6) return;
    const s = (this.angularMomentum(radial / tubeRadius) * w * swirl) / (radial * radial);
    out.y += -s * pz;
    out.z += s * py;
  }
}
