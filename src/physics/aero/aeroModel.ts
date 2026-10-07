// Blade-element aerodynamic model of the whole aircraft (X-Plane style): the airframe is a set of
// lifting strips plus non-lifting bodies; each element finds its own local airflow every call and
// looks up 2-D section data. Stability and control characteristics are not inputs; they emerge.
//
// Per call:
//  1. Local free stream at every strip control point: aircraft motion (incl. rotation), wind, the propeller
//     slipstreams (one jet per propeller: axial + swirl, averaged over each strip's span) and the potential
//     cross-flow around the fuselage in sideslip (2-D doublet; this is what gives a high wing its extra
//     dihedral effect and end-plates the fin).
//  2. Section constants per strip for the local Reynolds and Mach numbers and control deflections.
//  3. Wing lifting line (Newton, warm-started), then the tail lifting line with the wing's downwash and
//     sidewash, computed from the wing circulation lagged by the wing-to-tail convection time. Before the
//     tail solve each propeller jet is turned by the wing's downwash and the tail strips are re-sampled.
//     The fuselage and parasite items also sit in the wing's flow field (upwash ahead, downwash behind).
//  4. Strip forces from the local (induced) flow, fuselage, nacelle and parasite-drag loads, moments about the CG.
//  5. Advance the dynamic-stall and downwash-lag states by input.dt.
//
// State advance: every call with dt > 0 advances the lag states by dt. An RK4 assembler should pass the
// step size on ONE evaluation per step (e.g. the first stage) and dt = 0 on the others.

import { quat, smoothstep, v3, wrapPi, type Quat, type Vec3 } from '../../core/math';
import type { SurfaceState } from '../../core/types';
import type { AeroInput, AeroOutput } from '../interfaces';
import {
  SEPARATION_LAG,
  addFlapDeflection,
  allMovingRotation,
  clearFlapIncrement,
  evaluateSection,
  fowlerExtension,
  makeSectionCondition,
  makeSectionCoefficients,
  prepareSection,
  staticSeparation,
  type FlapIncrement,
  type SectionCoefficients,
  type SectionCondition,
} from './airfoil';
import { Fuselage, addDragItemLoads, addStrutLoads, strutMidpoint, type FlowSampler, type LoadAccumulator } from './bodies';
import { createC172AeroDefinition } from './c172Aero';
import type { AircraftAeroDefinition, PropellerStation, StallSensor } from './definition';
import { LiftingLine, WakeCoupling, type GroundPlane, type SectionLift } from './liftingLine';
import { MAX_PATH, SlipstreamField } from './slipstream';
import type { Strip, SurfaceId } from './strips';
import type { MutableVec3 } from './vortex';

/** Per-strip state exposed for debugging and visual effects (updated in place every call). */
export interface StripDiagnostics {
  readonly surface: SurfaceId;
  readonly side: -1 | 0 | 1;
  /** Quarter-chord midpoint, reference-point body axes, m. */
  readonly position: Vec3;
  readonly area: number;
  /** Effective local angle of attack of the section (after induced flow; an all-moving surface's deflection included), rad. */
  alpha: number;
  /**
   * Angle of attack without the surface's own induced flow (the tail's includes the wing downwash), rad, of the
   * strip's FIXED chord: an all-moving surface's deflection is not in it.
   */
  geometricAlpha: number;
  cl: number;
  cd: number;
  cm: number;
  /** Trailing-edge separation point, 1 = attached, 0 = fully separated. */
  separation: number;
  stalled: boolean;
  /** Bound circulation, m^2/s. */
  circulation: number;
  /** Local dynamic pressure, Pa. */
  dynamicPressure: number;
}

export interface AeroModelOptions {
  /**
   * Treat every call as steady flow: lag states jump to their equilibrium and the solver runs to
   * convergence. For trim and tests; slower than normal operation.
   */
  quasiSteady?: boolean;
}

/** Vortex core radius on a surface itself and for the rolled-up wing wake reaching the tail, m. */
const SURFACE_CORE = 0.02;
const WAKE_CORE = 0.25;
const BODY_AFT: Vec3 = { x: -1, y: 0, z: 0 };
/**
 * Rebuild the wing-to-tail and wing-to-body influence matrices when the wake has turned by more than this
 * from the direction they were built for (between rebuilds they are corrected linearly for the wake's
 * direction, see WakeCoupling), or when the ground moves.
 */
const WAKE_REBUILD_COS = Math.cos((1.5 * Math.PI) / 180);
const GROUND_REBUILD_COS = Math.cos((0.3 * Math.PI) / 180);
/**
 * Body-x stations from the propeller disc to beyond the tail at which the velocity the wing induces in the
 * propeller jet is sampled to convect the jet's centreline (see updateJetPath), and the heights (body z) of the
 * sample column at each station. These are the Cessna 172's tables, in absolute body coordinates: the defaults
 * of AircraftAeroDefinition.jetStations and jetGrid (whose offsets are taken from each hub instead).
 */
const JET_STATIONS = [1.4, 0.8, 0.2, -0.4, -1.0, -1.6, -2.3, -3.0, -3.8, -4.6, -5.4];
const JET_COLUMN = Array.from({ length: 13 }, (_, k) => -1.8 + 0.25 * k);
/** Lateral positions (body y) of the sample columns: the jet drifts sideways with the sideslip. */
const JET_ROWS = [-2, 0, 2];
/** Rebuild the jet grid's matrices past this wake turn (or ground tilt). */
const JET_REBUILD_COS = Math.cos((4 * Math.PI) / 180);
/**
 * Wake direction behind the wing: the free stream turned by this multiple of the mean downwash at the wing. The
 * trailing vortex sheet moves with the local flow, whose downwash grows from its value at the lifting line to
 * twice that far behind; over the ~0.3 span to the tail its mean is ~1.4-1.5 times the value at the wing
 * (horseshoe-vortex downwash 1 + x / sqrt(x^2 + (b/2)^2) on the centre line), so a straight wake along this
 * direction passes the tail where the curved sheet does.
 */
const WAKE_DOWNWASH_FACTOR = 1.5;
/** Points per strip over which the slipstream is averaged. */
const SPAN_SAMPLES = 4;
/** Points round a fuselage section's outline over which the slipstream is averaged (see Airflow.sampleSection). */
const SECTION_POINTS = 8;
const SECTION_COS = Float64Array.from({ length: SECTION_POINTS }, (_, k) => Math.cos(((k + 0.5) * 2 * Math.PI) / SECTION_POINTS));
const SECTION_SIN = Float64Array.from({ length: SECTION_POINTS }, (_, k) => Math.sin(((k + 0.5) * 2 * Math.PI) / SECTION_POINTS));
/** Largest centre-line dynamic-pressure loss in a wing wake (a fully stalled section's wake); AircraftAeroDefinition.wake.maxLoss. */
const MAX_WAKE_LOSS = 0.7;
/** Half-width of a wing wake in chords per sqrt(cd (x/c + 0.15)) (see applyWingWake); times wake.widthScale. */
const WAKE_HALF_WIDTH = 0.68;
/** Relative Reynolds-number and absolute Mach-number changes below which a strip's section constants are reused. */
const SECTION_REUSE_RE = 0.003;
const SECTION_REUSE_MACH = 0.0005;
/** Spanwise artificial viscosity on a fully separated strip (scaled by 1 - f). */
const SEPARATED_VISCOSITY = 1;

/** One propeller's jet: its field, the path its centreline takes past the wing, and its disc among the body points. */
interface Jet {
  readonly field: SlipstreamField;
  readonly hub: Vec3;
  readonly radius: number;
  /** PropellerStation.wingBlowing (1 when absent). */
  readonly wingBlowing: number;
  /** PropellerStation.jetAtTail and swirlBehindWing (1 when absent). */
  readonly tailJet: number;
  readonly tailSwirl: number;
  /**
   * Free stream at the disc of a propeller off the centre line (with yaw rate a wing engine's disc meets
   * V -/+ r y); null for a hub on the centre line, whose jet is prepared with the free stream at the CG.
   */
  readonly freeStream: MutableVec3 | null;
  /** Body x of the quarter chord of the wing strip the jet passes (where the jet-boundary downwash is centred). */
  readonly wingQuarterChordX: number;
  /** Lateral positions (body y) and heights (body z) of the path's sample columns. */
  readonly rows: readonly number[];
  readonly column: readonly number[];
  /** Path stations (the disc first) and the centreline displacement along them. */
  readonly x: Float64Array;
  readonly y: Float64Array;
  readonly z: Float64Array;
  /** Wing-induced velocity at the jet-path sample grid (stations x rows x column, xyz interleaved). */
  readonly coupling: WakeCoupling;
  readonly grid: Float64Array;
  /** Wake direction and ground the grid's matrices were built for (see updateJetInfluence). */
  builtWake: Vec3 | null;
  builtGround: GroundPlane | null;
  /** Whether there is a jet at all this call. */
  active: boolean;
  /** Velocity the wing induces over the disc, plus the blockage (see AeroModel.propellerInflow), body axes, m/s. */
  readonly inflow: MutableVec3;
  /**
   * Axial velocity the bodies (fuselage and nacelles) induce at the propeller disc per unit axial free-stream speed
   * (mean of the same 0.7-radius points), + forward: the cowling's blockage; for a wing propeller nearly all of it
   * is its own nacelle's. On the Cessna 172 the disc sits 0.15 m ahead of a cowl that widens to
   * 0.85 m, so slender-body potential flow (Fuselage.axialBlockage) slows the inflow through the disc by ~2.3 %
   * at 0.7 R (~2.6 % thrust-weighted; up to 20-45 % near the spinner). The isolated-propeller BEMT does not know
   * about the body behind it; with this it works at the effective advance ratio of the installed propeller
   * (McCormick, "Aerodynamics, Aeronautics and Flight Mechanics" sec. 6.6: body blockage behind a tractor
   * propeller raises its power absorption and thrust at a given flight speed; nothing changes at static thrust).
   */
  readonly blockage: number;
  /** Where its four disc points start in bodyInduced. */
  readonly discOffset: number;
}

/**
 * Four points on the 0.7-radius circle of a propeller disc, where the thrust is centred. The wing's bound vortex
 * lies within the disc's height (0.62 m above the hub), so the axial part of its induced velocity changes sign
 * across the disc and a hub sample alone would overstate it.
 */
function discPoints(station: PropellerStation): Vec3[] {
  const hub = station.hub, r7 = 0.7 * station.radius;
  return [
    { x: hub.x, y: hub.y, z: hub.z - r7 },
    { x: hub.x, y: hub.y + r7, z: hub.z },
    { x: hub.x, y: hub.y, z: hub.z + r7 },
    { x: hub.x, y: hub.y - r7, z: hub.z },
  ];
}

class Loads implements LoadAccumulator {
  fx = 0; fy = 0; fz = 0; mx = 0; my = 0; mz = 0;
  cg: Vec3 = { x: 0, y: 0, z: 0 };

  reset(cg: Vec3): void {
    this.fx = this.fy = this.fz = this.mx = this.my = this.mz = 0;
    this.cg = cg;
  }

  addForce(p: Vec3, fx: number, fy: number, fz: number): void {
    const rx = p.x - this.cg.x, ry = p.y - this.cg.y, rz = p.z - this.cg.z;
    this.fx += fx;
    this.fy += fy;
    this.fz += fz;
    this.mx += ry * fz - rz * fy;
    this.my += rz * fx - rx * fz;
    this.mz += rx * fy - ry * fx;
  }

  addMoment(mx: number, my: number, mz: number): void {
    this.mx += mx;
    this.my += my;
    this.mz += mz;
  }
}

/** Air velocity relative to the airframe at body points: wind - (v + w x r) + the slipstreams. */
class Airflow implements FlowSampler {
  vx = 0; vy = 0; vz = 0;
  wx = 0; wy = 0; wz = 0;
  windX = 0; windY = 0; windZ = 0;
  cg: Vec3 = { x: 0, y: 0, z: 0 };
  windAt: ((p: Vec3) => Vec3) | undefined;
  orientation: Quat = { w: 1, x: 0, y: 0, z: 0 };

  /** Which of the fields may reach the section being sampled (sampleSection). */
  private readonly reach: Uint8Array;

  /**
   * `wingBlowing[j]`: the factor on field j's axial increment at the wing's strips (PropellerStation.wingBlowing);
   * `tailJet[j]` and `tailSwirl[j]`: its axial increment and its swirl at the tail's (jetAtTail, swirlBehindWing).
   */
  constructor(
    readonly slipstreams: readonly SlipstreamField[],
    private readonly wingBlowing: readonly number[],
    private readonly tailJet: readonly number[] = slipstreams.map(() => 1),
    private readonly tailSwirl: readonly number[] = slipstreams.map(() => 1),
  ) {
    this.reach = new Uint8Array(slipstreams.length);
  }

  sample(p: Vec3, out: MutableVec3): void {
    this.sampleFreeStream(p, out);
    const fields = this.slipstreams;
    for (let j = 0; j < fields.length; j++) fields[j].add(p, out, 1);
  }

  /**
   * Air velocity at a strip's control point p, with the slipstream averaged over the strip's span a->b
   * (midpoint rule). A strip is wider than the slipstream's mixing layer, so a point sample would switch
   * the whole strip in or out of the jet as the jet drifts sideways in sideslip. `blown`: a strip of the wing,
   * which gains (or loses) only the wingBlowing part of each jet's axial increment; otherwise a strip of the tail,
   * which sees the tailJet part of it and the tailSwirl part of the swirl.
   */
  sampleStrip(p: Vec3, a: Vec3, b: Vec3, halfLength: number, out: MutableVec3, blown: boolean): void {
    this.sampleFreeStream(p, out);
    this.freeStreamY = out.y;
    this.freeStreamZ = out.z;
    const fields = this.slipstreams;
    for (let j = 0; j < fields.length; j++) {
      const field = fields[j];
      if (!field.mayReach(p, halfLength)) continue;
      const axial = blown ? this.wingBlowing[j] : this.tailJet[j];
      const swirl = blown ? 1 : this.tailSwirl[j];
      const q = this.spanPoint;
      const w = 1 / SPAN_SAMPLES;
      for (let k = 0; k < SPAN_SAMPLES; k++) {
        const f = (k + 0.5) * w - 0.5;
        q.x = p.x + f * (b.x - a.x);
        q.y = p.y + f * (b.y - a.y);
        q.z = p.z + f * (b.z - a.z);
        field.add(q, out, w, axial, swirl);
      }
    }
  }

  /**
   * Free stream at p plus the slipstream's mean over the outline of an elliptic section of semi-axes a (lateral)
   * and b (vertical), sampled at SECTION_POINTS points round it. The mean of a velocity field round a closed
   * contour is the velocity that the vorticity OUTSIDE the contour induces at its centre (the vorticity inside
   * contributes nothing to the contour mean: the mean-value property of the field it induces outside itself, by
   * the Cauchy integral). That is the cross-flow the body actually meets: the swirling air that would occupy the
   * section's own area is displaced by the body, so it cannot push it sideways. A section whose outline encloses
   * the jet's axis therefore sees the rotating air flow round it with no mean cross-flow, and one well clear of
   * the axis sees the swirl's local speed. (Interior samples, exact for a field quadratic across the section,
   * counted the fictitious vorticity inside the body: when the jet's axis passed through a section near one of
   * the samples, the swirl's jump across the axis gave the section a side force of either sign.) Returns the
   * variance of the cross-flow round the outline about that mean (m^2/s^2): the swirl's own speed over the skin,
   * which loads the skin but not the side.
   */
  sampleSection(p: Vec3, a: number, b: number, out: MutableVec3): number {
    this.sampleFreeStream(p, out);
    const fields = this.slipstreams, reach = this.reach;
    let any = false;
    for (let j = 0; j < fields.length; j++) {
      reach[j] = fields[j].mayReach(p, Math.max(a, b)) ? 1 : 0;
      if (reach[j] === 1) any = true;
    }
    if (!any) return 0;
    const q = this.spanPoint;
    const v = this.sectionSample;
    const w = 1 / SECTION_POINTS;
    let sx = 0, sy = 0, sz = 0, syy = 0;
    for (let k = 0; k < SECTION_POINTS; k++) {
      q.x = p.x;
      q.y = p.y + a * SECTION_COS[k];
      q.z = p.z + b * SECTION_SIN[k];
      v.x = v.y = v.z = 0;
      for (let j = 0; j < fields.length; j++) if (reach[j] === 1) fields[j].add(q, v, 1);
      sx += w * v.x;
      sy += w * v.y;
      sz += w * v.z;
      syy += w * (v.y * v.y + v.z * v.z);
    }
    out.x += sx;
    out.y += sy;
    out.z += sz;
    return Math.max(syy - sy * sy - sz * sz, 0);
  }

  private readonly spanPoint: MutableVec3 = { x: 0, y: 0, z: 0 };
  private readonly sectionSample: MutableVec3 = { x: 0, y: 0, z: 0 };
  /** Lateral and vertical air velocity at the last sampleStrip point without the slipstream, m/s. */
  freeStreamY = 0;
  freeStreamZ = 0;

  /** Air velocity at p without any slipstream. */
  sampleFreeStream(p: Vec3, out: MutableVec3): void {
    const rx = p.x - this.cg.x, ry = p.y - this.cg.y, rz = p.z - this.cg.z;
    let wx = this.windX, wy = this.windY, wz = this.windZ;
    if (this.windAt) {
      const w = quat.rotateInv(this.orientation, this.windAt(p));
      wx = w.x;
      wy = w.y;
      wz = w.z;
    }
    out.x = wx - this.vx - (this.wy * rz - this.wz * ry);
    out.y = wy - this.vy - (this.wz * rx - this.wx * rz);
    out.z = wz - this.vz - (this.wx * ry - this.wy * rx);
  }
}

/** Section lift for a contiguous block of strips at their current separation state. */
class BlockSections implements SectionLift {
  constructor(
    private readonly conds: SectionCondition[],
    private readonly sep: Float64Array,
    /** Rotation of each strip's section by its all-moving controls, rad (AeroModel.rotation). */
    private readonly rotation: Float64Array,
    private readonly offset: number,
  ) {}

  sectionLift(i: number, alpha: number, out: SectionCoefficients): void {
    evaluateSection(this.conds[this.offset + i], alpha + this.rotation[this.offset + i], this.sep[this.offset + i], out);
  }
}

export class AeroModel {
  readonly definition: AircraftAeroDefinition;
  /** Wing strips first (left tip to right tip), then tailplane, then fin. */
  readonly diagnostics: readonly StripDiagnostics[];

  private readonly quasiSteady: boolean;
  private readonly strips: Strip[];
  private readonly nWing: number;
  private readonly wing: LiftingLine;
  private readonly tail: LiftingLine;
  private readonly coupling: WakeCoupling;
  /**
   * Wing-induced flow at the body points (upwash ahead, downwash behind): the fuselage segments from 0, each
   * nacelle's from nacelleOffsets, the parasite items from itemOffset, the struts from strutOffset, then each
   * jet's disc points (Jet.discOffset).
   */
  private readonly bodyCoupling: WakeCoupling;
  private readonly bodyInduced: Float64Array;
  private readonly nacelleOffsets: number[];
  private readonly itemOffset: number;
  private readonly strutOffset: number;
  private readonly fuselage: Fuselage;
  /** Engine nacelles (AircraftAeroDefinition.nacelles): slender bodies like the fuselage, on their own axes. */
  private readonly nacelles: Fuselage[];
  /** One per propeller of the definition, in its order. */
  private readonly jets: Jet[];
  private readonly flow: Airflow;
  private readonly loads = new Loads();
  private readonly conds: SectionCondition[];
  private readonly separation: Float64Array;
  /** Per strip: fuselage cross-flow factors on the lateral velocity, half the strip length, section-constant cache. */
  private readonly crossflowY: Float64Array;
  private readonly crossflowZ: Float64Array;
  private readonly halfLength: Float64Array;
  /**
   * Where a strip that lies inside the fuselage (the fin's slender-body carry-through to the tail-cone axis) takes
   * its slipstream sample: the root of the exposed panel, or null to sample along the strip itself.
   */
  private readonly bodyCarrySample: (Vec3 | null)[];
  private readonly sectionCache: Float64Array;
  /**
   * Strip whose separation state each strip follows: itself, except for the body sections over the cabin,
   * whose flow separates with the wing root beside them (the cabin roof has no stall of its own: its "section"
   * is a body, and in the upwash of a lowered flap's inner end it would otherwise stall long before the wing).
   */
  private readonly separationSource: Int32Array;
  /**
   * Rotation of each strip's section by its all-moving controls (a stabilator), rad: the section works at the
   * strip's angle of attack plus this (see allMovingRotation in airfoil.ts). Zero on every other strip.
   */
  private readonly rotation: Float64Array;
  /** Section angle of attack (rotation included) that drives each strip's separation, lagged (see advanceLags). */
  private readonly alphaLag: Float64Array;
  /**
   * Section angle of attack each strip's control surfaces see (their large-deflection loss depends on it, see
   * addFlapDeflection): the strip's angle of attack of the previous step, updated once per step (and each pass
   * of a quasi-steady settle), so the section constants stay fixed between the stages of a step.
   */
  private readonly flapAlpha: Float64Array;
  private readonly wingSections: BlockSections;
  private readonly tailSections: BlockSections;
  private readonly u0Wing: Float64Array;
  private readonly u0TailBase: Float64Array;
  private readonly u0Tail: Float64Array;
  /** Scratch: air velocity at a forceAtBound strip's bound vortex (assemble). */
  private readonly boundFlow = { x: 0, y: 0, z: 0 };
  /** Wing circulation as seen at the tail (lagged by the convection time). */
  private readonly gammaAtTail: Float64Array;
  /** Local-velocity factor sqrt(q_local / q) of each tail strip in the wing's and the fuselage's viscous wakes. */
  readonly tailWakeFactor: Float64Array;
  /** Speed ratio of each tail strip in the fuselage boundary layer (Fuselage.boundaryLayerSpeedRatio). */
  private readonly tailBodyLayer: Float64Array;


  /**
   * Velocity the wing induces over the propeller disc in the last call (mean of the 0.7-radius samples), body
   * axes, m/s: mainly the bound vortex's
   * upwash ahead of the wing (DATCOM 4.4.1's upwash gradient ahead of a lifting surface, ~0.25-0.3 at the C172's
   * disc, 1.2 root chords ahead of the quarter chord). The propeller meets the free stream plus this, so its
   * normal force (destabilising, ahead of the CG) grows with the upwash (Ribner, NACA ARR 3L02; Perkins & Hage
   * sec. 5-8). Propeller 0's: the same object as propellerInflows[0].
   */
  readonly propellerInflow: MutableVec3 = { x: 0, y: 0, z: 0 };
  /** The same for every propeller of the definition, in its order (also AeroOutput.propellerInflows). */
  readonly propellerInflows: readonly MutableVec3[];

  /** Pitching moment about the CG of each group of elements in the last call, N*m (diagnostics). */
  readonly pitchBreakdown = { wing: 0, hTail: 0, vTail: 0, fuselage: 0, nacelles: 0, items: 0, struts: 0 };
  /** Yawing moment about the CG of each group in the last call, N*m (diagnostics). */
  readonly yawBreakdown = { wing: 0, hTail: 0, vTail: 0, fuselage: 0, nacelles: 0, items: 0, struts: 0 };
  /** Rolling moment about the CG of each group in the last call, N*m (diagnostics). */
  readonly rollBreakdown = { wing: 0, hTail: 0, vTail: 0, fuselage: 0, nacelles: 0, items: 0, struts: 0 };

  private readonly tailArm: number;
  private readonly wingArea: number;
  /** Body x of the trailing edge of the wing strip in the plane of symmetry (where applyWingWake starts the wake). */
  private readonly rootTrailingEdgeX: number;
  /** Stall-warning sensors (AircraftAeroDefinition.stallWarning as a list). */
  private readonly stallSensors: readonly StallSensor[];
  /** Wing-wake constants (AircraftAeroDefinition.wake over the module defaults). */
  private readonly wakeMaxLoss: number;
  private readonly wakeHalfWidth: number;
  private initialized = false;
  /** The self-influence matrices are valid for `ground` (they depend on nothing else). */
  private selfBuilt = false;
  private air: Vec3 = { x: -1, y: 0, z: 0 };
  private airspeed = 0;
  /** Area-weighted mean velocity induced at the wing (from the last wing solve). */
  private readonly downwash: MutableVec3 = { x: 0, y: 0, z: 0 };
  private wakeDir: Vec3 = { x: -1, y: 0, z: 0 };
  private builtWake: Vec3 | null = null;
  private ground: GroundPlane | null = null;
  private readonly flapInc: FlapIncrement = { dAlpha0: 0, dStall: 0, dCd: 0, dCm: 0, chordExtension: 0 };
  private readonly coeffs = makeSectionCoefficients();
  private readonly scratch: MutableVec3 = { x: 0, y: 0, z: 0 };
  /** Recompute the jets' paths in this call (calls that advance time, and quasi-steady or first calls). */
  private advancePath = true;
  private readonly centre: MutableVec3 = { x: 0, y: 0, z: 0 };
  /** Inputs of the current call used when the strips are (re)sampled. */
  private readonly stripInputs: { surfaces: SurfaceState; viscosity: number; speedOfSound: number; density: number } = {
    surfaces: { elevator: 0, aileronLeft: 0, aileronRight: 0, rudder: 0, flaps: 0, elevatorTrim: 0, rudderTrim: 0 },
    viscosity: 1.8e-5,
    speedOfSound: 340,
    density: 1.225,
  };
  /** Let the lifting-line solves reuse their last Jacobian factorisation (see LiftingLine.solve). */
  private reuseJacobian = false;

  /**
   * Optional hook called before every tail solve with the tailplane's geometric angle of attack for the
   * current inflow (it does not depend on the tail's own surfaces). It may change `surfaces` (the caller's
   * AeroInput.surfaces object) and returns true if it did, and the tail is then re-sampled. Used by trim to
   * set the trim tab that floats the elevator for that angle of attack.
   */
  tailHook: ((tailAlpha: number, surfaces: SurfaceState) => boolean) | null = null;

  constructor(definition: AircraftAeroDefinition = createC172AeroDefinition(), options: AeroModelOptions = {}) {
    this.definition = definition;
    this.quasiSteady = options.quasiSteady ?? false;
    this.strips = [...definition.wing, ...definition.tail];
    this.nWing = definition.wing.length;
    const n = this.strips.length;
    this.wing = new LiftingLine(definition.wing, SURFACE_CORE);
    this.tail = new LiftingLine(definition.tail, SURFACE_CORE);
    this.coupling = new WakeCoupling(definition.wing, definition.tail.map((s) => s.cp), WAKE_CORE);
    this.fuselage = new Fuselage(definition.fuselage);
    this.nacelles = (definition.nacelles ?? []).map((d) => new Fuselage(d));
    const stations = definition.propellers;
    if (!stations || stations.length === 0) throw new Error('AeroModel: the definition names no propeller (AircraftAeroDefinition.propellers)');
    // Body points: every body's segments, the parasite items, the struts, then four points on each propeller's
    // disc (see propellerInflow).
    const bodyPoints: Vec3[] = [...this.fuselage.points];
    this.nacelleOffsets = this.nacelles.map((nacelle) => {
      const offset = 3 * bodyPoints.length;
      bodyPoints.push(...nacelle.points);
      return offset;
    });
    this.itemOffset = 3 * bodyPoints.length;
    bodyPoints.push(...definition.dragItems.map((d) => d.position));
    this.strutOffset = 3 * bodyPoints.length;
    bodyPoints.push(...definition.struts.map(strutMidpoint));
    const discs = stations.map(discPoints);
    const discOffsets = discs.map((disc) => {
      const offset = 3 * bodyPoints.length;
      bodyPoints.push(...disc);
      return offset;
    });
    this.bodyCoupling = new WakeCoupling(definition.wing, bodyPoints, WAKE_CORE);
    this.bodyInduced = new Float64Array(3 * bodyPoints.length);
    this.propellerInflows = stations.map((_, j) => (j === 0 ? this.propellerInflow : { x: 0, y: 0, z: 0 }));
    this.jets = stations.map((station, j) => this.makeJet(station, discs[j], discOffsets[j], this.propellerInflows[j]));
    this.flow = new Airflow(
      this.jets.map((jet) => jet.field),
      this.jets.map((jet) => jet.wingBlowing),
      this.jets.map((jet) => jet.tailJet),
      this.jets.map((jet) => jet.tailSwirl),
    );
    this.conds = this.strips.map(() => makeSectionCondition());
    this.separation = new Float64Array(n).fill(1);
    this.crossflowY = new Float64Array(n);
    this.crossflowZ = new Float64Array(n);
    this.halfLength = new Float64Array(n);
    this.sectionCache = new Float64Array(7 * n).fill(NaN);
    const section = { radius: 0, z: 0, lateralDoublet: 0 };
    this.bodyCarrySample = this.strips.map(() => null);
    this.strips.forEach((st, i) => {
      this.halfLength[i] = 0.5 * Math.hypot(st.b.x - st.a.x, st.b.y - st.a.y, st.b.z - st.a.z);
      this.fuselage.sectionAt(st.cp.x, section);
      const ry = st.cp.y, rz = st.cp.z - section.z;
      const r2 = ry * ry + rz * rz;
      // A panel continued into the body to its axis stands for the exposed panel's lift carried over onto the
      // body (slender-body theory: Nielsen, "Missile Aerodynamics" ch. 5), so it works at the exposed root's
      // angle of attack. Sampling the slipstream inside the tail cone instead put that strip on the far side of
      // the jet's axis whenever the jet passed between the tail cone and the fin, with the swirl reversed.
      // (A carry-over strip across the body, such as the tailplane's, spans both sides and keeps its own samples.)
      if (!st.carryover && section.radius > 0 && r2 < section.radius * section.radius) {
        const d = (q: Vec3) => Math.hypot(q.y, q.z - section.z);
        const end = d(st.a) > d(st.b) ? st.a : st.b;
        // The control point moved out along the span to the exposed end.
        this.bodyCarrySample[i] = {
          x: st.cp.x + end.x - 0.5 * (st.a.x + st.b.x),
          y: st.cp.y + end.y - 0.5 * (st.a.y + st.b.y),
          z: st.cp.z + end.z - 0.5 * (st.a.z + st.b.z),
        };
      }
      if (section.radius > 0 && r2 > section.radius * section.radius) {
        this.crossflowY[i] = (section.lateralDoublet / r2) * (1 - (2 * ry * ry) / r2);
        this.crossflowZ[i] = (section.lateralDoublet / r2) * ((-2 * ry * rz) / r2);
      }
    });
    this.separationSource = Int32Array.from(this.strips, (st, i) => {
      // An explicit source is an index into the strip's own list (wing or tail).
      const source = st.separationFrom === undefined ? (st.bodySection ? i + st.side : i) : (i < this.nWing ? 0 : this.nWing) + st.separationFrom;
      const inList = i < this.nWing ? source >= 0 && source < this.nWing : source >= this.nWing && source < n;
      if (!Number.isInteger(source) || !inList) throw new Error(`AeroModel: strip ${i} follows the separation of a strip outside its list (Strip.separationFrom)`);
      return source;
    });
    this.rotation = new Float64Array(n);
    const turns = (list: Strip[]) => list.some((st) => st.controls.some((c) => c.flap.kind === 'allMoving'));
    if (turns(definition.wing)) this.wing.sectionRotation = this.rotation.subarray(0, this.nWing);
    if (turns(definition.tail)) this.tail.sectionRotation = this.rotation.subarray(this.nWing);
    this.alphaLag = new Float64Array(n);
    this.flapAlpha = new Float64Array(n);
    this.wingSections = new BlockSections(this.conds, this.separation, this.rotation, 0);
    this.tailSections = new BlockSections(this.conds, this.separation, this.rotation, this.nWing);
    this.u0Wing = new Float64Array(3 * this.nWing);
    this.u0TailBase = new Float64Array(3 * definition.tail.length);
    this.u0Tail = new Float64Array(3 * definition.tail.length);
    this.gammaAtTail = new Float64Array(this.nWing);
    this.tailWakeFactor = new Float64Array(definition.tail.length).fill(1);
    // Strips wholly inside the tail cone stand for the load carried over through the body: they take the layer
    // of the exposed strips beside them. The fin is left out: its lift slope is already set against the
    // measured whole-aircraft Cn_beta (see c172Aero.ts), which includes its root's share of the layer.
    const layer = definition.tail.map((st) => (st.surface === 'hTail' ? this.fuselage.boundaryLayerSpeedRatio(st.a, st.b) : 1));
    this.tailBodyLayer = Float64Array.from(layer, (v, k) => {
      if (!Number.isNaN(v)) return v;
      const near = [layer[k - 1], layer[k + 1]].filter((x, j) => x !== undefined && !Number.isNaN(x) && definition.tail[k + 2 * j - 1].surface === definition.tail[k].surface);
      return near.length > 0 ? near.reduce((s, x) => s + x, 0) / near.length : 1;
    });

    const meanX = (s: Strip[]) => s.reduce((acc, st) => acc + st.mid.x * st.area, 0) / s.reduce((acc, st) => acc + st.area, 0);
    // The wing-to-tail convection distance; a tail without a tailplane is measured to all of its strips.
    const tailplane = definition.tail.filter((s) => s.surface === 'hTail');
    this.tailArm = Math.abs(meanX(definition.wing) - meanX(tailplane.length > 0 ? tailplane : definition.tail));
    if (!(this.tailArm > 0)) throw new Error('AeroModel: the tail lies at the wing (no wing-to-tail distance)');
    this.wingArea = definition.wing.reduce((acc, s) => acc + s.area, 0);
    // The wing strip in the plane of symmetry: the carry-over strip or the first of the two halves' root strips
    // (mirror images, so either gives the same trailing edge), wherever winglet strips put the list's middle.
    const root = this.stripAt(0);
    this.rootTrailingEdgeX = root.mid.x + 0.75 * root.chord * root.t.x;
    const sensors = definition.stallWarning;
    this.stallSensors = Array.isArray(sensors) ? sensors : [sensors];
    if (this.stallSensors.length === 0) throw new Error('AeroModel: the definition names no stall-warning sensor');
    for (const sensor of this.stallSensors) {
      // A findIndex that found nothing (-1) would otherwise read the section of no strip.
      if (!Number.isInteger(sensor.strip) || sensor.strip < 0 || sensor.strip >= this.nWing) {
        throw new Error(`AeroModel: stall-warning sensor on wing strip ${sensor.strip}, the wing has strips 0..${this.nWing - 1}`);
      }
    }
    this.wakeMaxLoss = definition.wake?.maxLoss ?? MAX_WAKE_LOSS;
    this.wakeHalfWidth = WAKE_HALF_WIDTH * (definition.wake?.widthScale ?? 1);
    this.diagnostics = this.strips.map((s) => ({
      surface: s.surface,
      side: s.side,
      position: s.mid,
      area: s.area,
      alpha: 0,
      geometricAlpha: 0,
      cl: 0,
      cd: 0,
      cm: 0,
      separation: 1,
      stalled: false,
      circulation: 0,
      dynamicPressure: 0,
    }));
  }

  /**
   * The wing strip at spanwise station y: the one whose bound vortex spans it, the inboard one where y lies on a
   * strip edge (the same choice on both wings; the first of two equally near the centre line); the strip of
   * largest chord for a station beyond the tips.
   */
  private stripAt(y: number): Strip {
    const wing = this.definition.wing;
    let found: Strip | null = null;
    for (const st of wing) {
      if (y < Math.min(st.a.y, st.b.y) || y > Math.max(st.a.y, st.b.y)) continue;
      if (found === null || Math.abs(st.mid.y) < Math.abs(found.mid.y)) found = st;
    }
    return found ?? wing.reduce((a, b) => (b.chord > a.chord ? b : a));
  }

  /** The jet of one propeller, whose disc points are `disc` (at discOffset in bodyInduced). */
  private makeJet(station: PropellerStation, disc: Vec3[], discOffset: number, inflow: MutableVec3): Jet {
    const { definition, fuselage } = this;
    const { hub, radius } = station;
    // The jet passes the wing at its hub's spanwise station: that strip's trailing edge is where the downwash
    // starts to turn it. (On the Cessna 172 that is a centre strip over the cabin, of the root chord: the same
    // trailing edge, to the last bit, as the largest-chord strip this was taken from before.)
    const root = this.stripAt(hub.y);
    const stations = [hub.x, ...(definition.jetStations ?? JET_STATIONS).filter((x) => x < hub.x - 0.1)];
    // A grid of the definition is laid out about the hub; the default tables are absolute (the Cessna 172's).
    const grid = definition.jetGrid;
    const rows = grid ? grid.rows.map((y) => hub.y + y) : JET_ROWS;
    const column = grid ? grid.column.map((z) => hub.z + z) : JET_COLUMN;
    const uniform = (v: readonly number[]) => v.length >= 2 && v.every((x, k) => k === 0 || Math.abs(x - v[k - 1] - (v[1] - v[0])) < 1e-9) && v[1] > v[0];
    if (!uniform(rows) || !uniform(column)) throw new Error('AeroModel: jetGrid rows and column must each be ascending and evenly spaced (at least two values)');
    if (stations.length < 2 || stations.length > MAX_PATH || stations.some((x, k) => k > 0 && !(x < stations[k - 1]))) {
      throw new Error(`AeroModel: jetStations must descend from behind the disc and give 2..${MAX_PATH} path stations with the hub's`);
    }
    const points = stations.flatMap((x) => rows.flatMap((y) => column.map((z) => ({ x, y, z }))));
    let blockage = disc.reduce((sum, q) => sum + fuselage.axialBlockage(q), 0) / disc.length;
    for (const nacelle of this.nacelles) blockage += disc.reduce((sum, q) => sum + nacelle.axialBlockage(q), 0) / disc.length;
    return {
      field: new SlipstreamField(radius, root.mid.x + 0.75 * root.chord * root.t.x),
      hub,
      radius,
      wingBlowing: station.wingBlowing ?? 1,
      tailJet: station.jetAtTail ?? 1,
      tailSwirl: station.swirlBehindWing ?? 1,
      freeStream: hub.y !== 0 ? { x: 0, y: 0, z: 0 } : null,
      wingQuarterChordX: root.mid.x,
      rows,
      column,
      x: Float64Array.from(stations),
      y: new Float64Array(stations.length),
      z: new Float64Array(stations.length),
      coupling: new WakeCoupling(definition.wing, points, WAKE_CORE),
      grid: new Float64Array(3 * points.length),
      builtWake: null,
      builtGround: null,
      active: false,
      inflow,
      blockage,
      discOffset,
    };
  }

  /**
   * Area-weighted mean geometric angle of attack of the horizontal tail's strips in the last call (the flow
   * angle at the tailplane, downwash included, relative to its chord), rad. Drives the elevator's float. For a
   * stabilator it is the angle of the FIXED reference chord (the deflection is not included): the input of the
   * float law, which adds the deflection itself.
   */
  tailplaneAlpha(): number {
    let sa = 0, a = 0;
    for (const d of this.diagnostics) {
      if (d.surface !== 'hTail') continue;
      sa += d.area * d.geometricAlpha;
      a += d.area;
    }
    return a > 0 && Number.isFinite(sa) ? sa / a : 0;
  }

  /** Area-weighted mean geometric angle of attack of the fin's strips in the last call (flow from the left +), rad. */
  finAlpha(): number {
    let sa = 0, a = 0;
    for (const d of this.diagnostics) {
      if (d.surface !== 'vTail') continue;
      sa += d.area * d.geometricAlpha;
      a += d.area;
    }
    return a > 0 && Number.isFinite(sa) ? sa / a : 0;
  }

  /** Area-weighted mean local dynamic pressure over the fin's strips in the last call (slipstream included), Pa. */
  finDynamicPressure(): number {
    let sq = 0, a = 0;
    for (const d of this.diagnostics) {
      if (d.surface !== 'vTail') continue;
      sq += d.area * d.dynamicPressure;
      a += d.area;
    }
    return a > 0 && Number.isFinite(sq) ? sq / a : 0;
  }

  /** Forget all lag and solver state; the next call starts from the steady solution. */
  reset(): void {
    this.initialized = false;
    this.builtWake = null;
    this.downwash.x = this.downwash.y = this.downwash.z = 0;
    this.wing.gamma.fill(0);
    this.tail.gamma.fill(0);
    this.separation.fill(1);
    this.flapAlpha.fill(0);
    const jets = this.jets;
    for (let j = 0; j < jets.length; j++) {
      const jet = jets[j];
      jet.inflow.x = jet.inflow.y = jet.inflow.z = 0;
      jet.field.clearPath();
    }
  }

  /**
   * Forget the influence matrices as well (built for the ground and wake of earlier calls, and reused while the
   * flow stays within their rebuild thresholds), so that the next call computes as on a new model. For a new
   * flight; reset() alone keeps them, as every quasi-steady call does.
   */
  resetInfluence(): void {
    this.selfBuilt = false;
    this.ground = null;
    this.builtWake = null;
    this.wakeDir = { x: -1, y: 0, z: 0 };
    for (const jet of this.jets) {
      jet.builtWake = null;
      jet.builtGround = null;
    }
  }

  /** Copy each controlled strip's current angle of attack into flapAlpha; returns the largest change, rad. */
  private updateFlapAlpha(): number {
    const { strips, nWing, flapAlpha } = this;
    let change = 0;
    for (let i = 0; i < strips.length; i++) {
      if (strips[i].controls.length === 0) continue;
      // The surface's geometric angle of attack: the inflow before its own induced velocity (the wing's downwash
      // included at the tail). DATCOM's large-deflection data are section data at zero angle of attack; relief by
      // the surface's own induced upwash is left out.
      const st = strips[i];
      const u = i < nWing ? this.u0Wing : this.u0Tail;
      const k = 3 * (i < nWing ? i : i - nWing);
      // (A tab on an all-moving surface sits on the rotated section.)
      const a = Math.atan2(u[k] * st.n.x + u[k + 1] * st.n.y + u[k + 2] * st.n.z, u[k] * st.t.x + u[k + 1] * st.t.y + u[k + 2] * st.t.z) + this.rotation[i];
      if (!Number.isFinite(a)) continue;
      change = Math.max(change, Math.abs(a - flapAlpha[i]));
      flapAlpha[i] = a;
    }
    return change;
  }

  compute(input: AeroInput): AeroOutput {
    const { body, atmosphere: atm } = input;
    const rho = atm.density;
    const flow = this.flow;
    const wind = quat.rotateInv(body.orientation, input.windNED);
    flow.vx = body.velocityBody.x;
    flow.vy = body.velocityBody.y;
    flow.vz = body.velocityBody.z;
    flow.wx = body.angularVelocity.x;
    flow.wy = body.angularVelocity.y;
    flow.wz = body.angularVelocity.z;
    flow.windX = wind.x;
    flow.windY = wind.y;
    flow.windZ = wind.z;
    flow.cg = body.cgOffset;
    flow.windAt = input.windAt;
    flow.orientation = body.orientation;
    // Air velocity relative to the aircraft at the CG (points aft in forward flight).
    const air = { x: wind.x - body.velocityBody.x, y: wind.y - body.velocityBody.y, z: wind.z - body.velocityBody.z };
    const airspeed = v3.len(air);
    this.air = air;
    this.airspeed = airspeed;
    // One jet per propeller: `slipstreams` by index, or the single `slipstream` as propeller 0's.
    const jets = this.jets, list = input.slipstreams;
    this.advancePath = input.dt > 0 || this.quasiSteady || !this.initialized;
    for (let j = 0; j < jets.length; j++) {
      const jet = jets[j];
      const ss = list ? (list[j] ?? null) : j === 0 ? input.slipstream : null;
      // The disc of a propeller on the centre line meets the free stream at the CG, a wing propeller's its own.
      if (jet.freeStream) flow.sampleFreeStream(jet.hub, jet.freeStream);
      jet.field.prepare(ss, jet.freeStream ?? air);
      jet.active = ss !== null && (ss.inducedVelocity !== 0 || ss.swirlRate !== 0);
    }

    const si = this.stripInputs;
    si.surfaces = input.surfaces;
    si.viscosity = atm.viscosity;
    si.speedOfSound = atm.speedOfSound;
    si.density = rho;
    this.prepareStrips(0, this.strips.length);
    this.updateSelfInfluence(body.orientation, input.heightAGL);

    if (!this.initialized || this.quasiSteady) {
      // Quasi-steady calls start from attached flow so the result is a function of the input alone
      // (beyond the stall several steady solutions exist; this picks the one reached from below).
      if (this.quasiSteady) this.reset();
      this.settle();
      this.initialized = true;
    } else {
      // Stages without a time advance (RK stages 2-4) start from the factorised Jacobian of stage 1.
      this.reuseJacobian = input.dt === 0;
      this.solveWing(3);
      this.solveTail(3);
      this.reuseJacobian = false;
      if (input.dt > 0) this.advanceLags(input.dt, airspeed);
    }
    return this.assemble(input, air, airspeed);
  }

  /** Free-stream velocity and section constants at every strip. */
  private prepareStrips(from: number, to: number): void {
    const { strips, nWing, flow, scratch: u } = this;
    const { surfaces, viscosity, speedOfSound, density: rho } = this.stripInputs;
    const { crossflowY, crossflowZ, halfLength } = this;
    for (let i = from; i < to; i++) {
      const st = strips[i];
      const carry = this.bodyCarrySample[i];
      if (carry) flow.sampleStrip(carry, carry, carry, 0, u, i < nWing);
      else flow.sampleStrip(st.cp, st.a, st.b, halfLength[i], u, i < nWing);
      // Potential cross-flow around the fuselage from the lateral velocity (2-D doublet). The doublet is the
      // fuselage's blockage of a uniform cross-flow, so it is driven by the free stream's lateral velocity
      // (sideslip, yaw rate, wind) alone. The slipstream's swirl is a rotation about an axis that runs along the
      // fuselage: the cabin and tail cone lie inside it and it flows round them rather than being blocked, so it
      // must not be turned into the up- and downwash that sideslip gives the wing roots (that made the swirl's
      // sideways flow over the cabin roof meet the root sections at +-9 deg and yaw the aircraft nose-right).
      // The wing's centre section lies on the cabin roof (Strip.bodySection), a solid boundary across the jet: the
      // slipstream's swirl, which circulates round the cabin, crosses the roof tangentially, so the swirl's
      // component normal to the roof (body z) vanishes there (flow tangency). Sampling the free vortex there as if
      // the cabin were not in the jet met the two centre strips with +-3 deg of up- and downwash at Vy and +-7 deg at
      // the power-on stall, where the jet's axis rises toward the roof: a large asymmetric lift over the cabin whose
      // tilt yawed the aircraft nose-right. The exposed roots beside the cabin's side walls keep the swirl's
      // vertical part (the walls turn the circulating flow up on the left and down on the right).
      // The same holds for the wing strips across an engine nacelle (Planform.bodyBands), whose jet's axis runs
      // along the nacelle they lie on.
      if (st.bodySection) u.z = flow.freeStreamZ;
      const vy = flow.freeStreamY;
      u.y += crossflowY[i] * vy;
      u.z += crossflowZ[i] * vy;
      const target = i < nWing ? this.u0Wing : this.u0TailBase;
      const j = 3 * (i < nWing ? i : i - nWing);
      target[j] = u.x;
      target[j + 1] = u.y;
      target[j + 2] = u.z;

      const inc = clearFlapIncrement(this.flapInc);
      let rotation = 0;
      for (const c of st.controls) {
        const delta = c.gain * surfaces[c.source] * c.coverage;
        if (c.flap.kind === 'allMoving') rotation += allMovingRotation(c.flap, delta);
        else addFlapDeflection(c.flap, delta, inc, this.flapAlpha[i]);
      }
      this.rotation[i] = rotation;
      const ut = u.x * st.t.x + u.y * st.t.y + u.z * st.t.z;
      const un = u.x * st.n.x + u.y * st.n.y + u.z * st.n.z;
      const q = Math.sqrt(ut * ut + un * un);
      const re = (rho * q * st.chord) / viscosity;
      const mach = q / speedOfSound;
      // The section constants depend on the Reynolds and Mach numbers only weakly (logarithmically and through
      // Prandtl-Glauert): between the stages of a step they are reused unless something changed noticeably.
      const c = this.sectionCache;
      const k = 7 * i;
      if (
        this.quasiSteady ||
        !(Math.abs(re - c[k]) <= SECTION_REUSE_RE * re) ||
        !(Math.abs(mach - c[k + 1]) <= SECTION_REUSE_MACH) ||
        inc.dAlpha0 !== c[k + 2] ||
        inc.dStall !== c[k + 3] ||
        inc.dCd !== c[k + 4] ||
        inc.dCm !== c[k + 5] ||
        inc.chordExtension !== c[k + 6]
      ) {
        prepareSection(st.section, re, mach, inc, st.cd90, st.skinFactor, this.conds[i], st.liftSlopeFactor);
        c[k] = re;
        c[k + 1] = mach;
        c[k + 2] = inc.dAlpha0;
        c[k + 3] = inc.dStall;
        c[k + 4] = inc.dCd;
        c[k + 5] = inc.dCm;
        c[k + 6] = inc.chordExtension;
      }
    }
  }

  /**
   * Rebuild the self-influence matrices when the ground geometry has changed. A surface's influence on
   * itself uses trailing legs fixed along the body x axis (standard vortex-lattice practice; a skewed
   * near wake on a coarse lattice would bias the local downwash in sideslip).
   */
  private updateSelfInfluence(orientation: Quat, heightAGL: number): void {
    const span = this.definition.referenceSpan;
    const weight = 1 - smoothstep(span, 2 * span, heightAGL);
    const ground: GroundPlane | null = weight > 0 ? { normal: quat.rotateInv(orientation, { x: 0, y: 0, z: -1 }), height: heightAGL, weight } : null;
    const bg = this.ground;
    const same =
      this.selfBuilt &&
      (bg === ground ||
        (bg !== null &&
          ground !== null &&
          v3.dot(bg.normal, ground.normal) > GROUND_REBUILD_COS &&
          Math.abs(bg.height - ground.height) < 0.01 + 0.01 * ground.height &&
          Math.abs(bg.weight - ground.weight) < 0.02));
    if (same) return;
    this.ground = ground;
    this.wing.rebuild(BODY_AFT, ground);
    this.tail.rebuild(BODY_AFT, ground);
    this.selfBuilt = true;
    this.builtWake = null;
  }

  /**
   * The wing's influence on the tail and the fuselage uses legs along the wake direction: the free
   * stream deflected by the mean downwash at the wing, so the tail leaves the wake at high angle of
   * attack and sees the sidewash in sideslip.
   */
  private updateWakeInfluence(): void {
    const { air, downwash: w } = this;
    const kw = WAKE_DOWNWASH_FACTOR;
    if (this.airspeed > 1) this.wakeDir = v3.normalize({ x: air.x + kw * w.x, y: air.y + kw * w.y, z: air.z + kw * w.z });
    if (this.builtWake === null || v3.dot(this.builtWake, this.wakeDir) < WAKE_REBUILD_COS) {
      this.coupling.rebuild(this.wakeDir, this.ground);
      this.bodyCoupling.rebuild(this.wakeDir, this.ground);
      this.builtWake = this.wakeDir;
    }
    this.coupling.setWake(this.wakeDir);
    this.bodyCoupling.setWake(this.wakeDir);
  }

  /**
   * The jet-path sample grid's influence matrices, rebuilt only when the wake has turned well away from the
   * direction they were built for or the ground has moved appreciably (the path is a smooth integral of them,
   * and the grid is large: rebuilding it with the tail's matrices on every small ground change cost more than
   * the rest of the step on the ground).
   */
  private updateJetInfluence(jet: Jet): void {
    const g = this.ground, bg = jet.builtGround;
    const groundSame =
      jet.builtWake !== null &&
      (g === bg ||
        (g !== null && bg !== null && v3.dot(g.normal, bg.normal) > JET_REBUILD_COS && Math.abs(g.height - bg.height) < 0.02 + 0.02 * g.height && Math.abs(g.weight - bg.weight) < 0.02));
    if (!groundSame || v3.dot(jet.builtWake!, this.wakeDir) < JET_REBUILD_COS) {
      jet.coupling.rebuild(this.wakeDir, g);
      jet.builtWake = this.wakeDir;
      jet.builtGround = g;
    }
  }

  /** Chattot viscosity from the current separation state. */
  private setViscosity(): void {
    const { nWing, separation, strips } = this;
    for (let i = 0; i < strips.length; i++) {
      const mu = strips[i].carryover ? 0 : SEPARATED_VISCOSITY * (1 - separation[i]);
      if (i < nWing) this.wing.viscosity[i] = mu;
      else this.tail.viscosity[i - nWing] = mu;
    }
  }

  private solveWing(maxSteps: number): void {
    const { wing, u0Wing, downwash, strips } = this;
    this.setViscosity();
    wing.solve(u0Wing, this.wingSections, maxSteps, undefined, this.reuseJacobian);
    downwash.x = downwash.y = downwash.z = 0;
    let area = 0;
    for (let i = 0; i < this.nWing; i++) {
      if (strips[i].carryover) continue;
      const a = strips[i].area;
      downwash.x += a * (wing.velocity[3 * i] - u0Wing[3 * i]);
      downwash.y += a * (wing.velocity[3 * i + 1] - u0Wing[3 * i + 1]);
      downwash.z += a * (wing.velocity[3 * i + 2] - u0Wing[3 * i + 2]);
      area += a;
    }
    downwash.x /= area;
    downwash.y /= area;
    downwash.z /= area;
    if (!Number.isFinite(downwash.x + downwash.y + downwash.z)) downwash.x = downwash.y = downwash.z = 0;
    this.updateWakeInfluence();
  }

  private solveTail(maxSteps: number): void {
    // The propeller jet passing the wing is carried down by the wing's induced flow on its way to the tail
    // (updateJetPath); the tail strips are then sampled in the displaced jet.
    if (this.advancePath) {
      const jets = this.jets;
      let moved = false;
      for (let j = 0; j < jets.length; j++) {
        const jet = jets[j];
        if (!jet.active) jet.field.clearPath();
        else if (this.updateJetPath(jet)) moved = true;
      }
      if (moved) this.prepareStrips(this.nWing, this.strips.length);
    }
    this.formTailInflow();
    if (this.tailHook && this.tailHook(this.inflowTailAlpha(), this.stripInputs.surfaces)) {
      this.prepareStrips(this.nWing, this.strips.length);
      this.formTailInflow();
    }
    this.tail.solve(this.u0Tail, this.tailSections, maxSteps, undefined, this.reuseJacobian);
  }

  /** Air velocity at the tail strips before their own induced flow: free stream, jet, wing wake and downwash. */
  private formTailInflow(): void {
    this.u0Tail.set(this.u0TailBase);
    this.coupling.addInduced(this.gammaAtTail, this.u0Tail);
    // The viscous wake slows the flow but does not turn it: the local velocity (downwash included) is scaled.
    this.applyWingWake();
  }

  /** Area-weighted geometric angle of attack of the horizontal-tail strips for the current inflow, rad. */
  private inflowTailAlpha(): number {
    const { strips, nWing, u0Tail } = this;
    let sa = 0, a = 0;
    for (let k = 0; nWing + k < strips.length; k++) {
      const st = strips[nWing + k];
      if (st.surface !== 'hTail') continue;
      const ux = u0Tail[3 * k], uy = u0Tail[3 * k + 1], uz = u0Tail[3 * k + 2];
      const alpha = Math.atan2(ux * st.n.x + uy * st.n.y + uz * st.n.z, ux * st.t.x + uy * st.t.y + uz * st.t.z);
      sa += st.area * alpha;
      a += st.area;
    }
    return a > 0 && Number.isFinite(sa) ? sa / a : 0;
  }

  /**
   * Velocity deficit in the wing's viscous wake at the tail strips (Silverstein, Katzoff & Bullivant, NACA TR 651,
   * "Downwash and wake behind plain and flapped airfoils"). The wake of a section with profile drag cd leaves
   * its trailing edge along the local flow; at a distance x behind it (in chords) its half-width and
   * centre-line dynamic-pressure loss are
   *   zeta / c = 0.68 sqrt(cd (x/c + 0.15)),   (dq/q)_0 = 2.42 sqrt(cd) / (x/c + 0.3),
   * with dq/q = (dq/q)_0 cos^2(pi z / (2 zeta)) at a distance z from the centre line. The profile drag is that
   * of the source strip at its current angle of attack and separation state, so a flap or a stalled wing
   * puts a thick, slow wake over the tail.
   * The wing's wake leaves the (flap) trailing edge in the direction of the wing's trailing vortices. Over the
   * cabin the wake of the wing-root sections is used (the centre section is faired over the cabin roof).
   * AircraftAeroDefinition.wake scales the width and caps the loss (the handle for a T-tail, which this wake
   * reaches at 10-35 deg of angle of attack: the reverse of a low tail, which it leaves there).
   * (The tailplane's own wake over the rudder, which matters in spins, is not represented: the fin strips'
   * control points lie ahead of the tailplane's trailing edge.)
   */
  private applyWingWake(): void {
    const { strips, nWing, wakeDir: d, u0Tail, tailWakeFactor, air, airspeed } = this;
    // The fuselage's boundary layer lies along the tail cone while the air comes from ahead; it is swept off the
    // body as the flow turns broadside and is gone when the air arrives from behind.
    const ahead = airspeed > 1e-6 ? Math.max(-air.x / airspeed, 0) : 0;
    const bl = ahead * ahead;
    for (let k = 0; k < tailWakeFactor.length; k++) tailWakeFactor[k] = 1 - (1 - this.tailBodyLayer[k]) * bl;
    const nl = Math.hypot(d.x, d.z);
    if (nl < 1e-6 || d.x > -1e-3) {
      this.scaleTailInflow();
      return;
    }
    const nx = -d.z / nl, nz = d.x / nl;
    const teX = this.rootTrailingEdgeX;
    for (let k = 0; k < tailWakeFactor.length; k++) {
      const p = strips[nWing + k].cp;
      // Spanwise station of the wing trailing edge whose wake passes this point (the wake drifts with sideslip).
      const ySrc = p.y - (d.y / d.x) * (p.x - teX);
      let j = -1;
      for (let i = 0; i < nWing; i++) {
        const w = strips[i];
        if (ySrc >= Math.min(w.a.y, w.b.y) && ySrc <= Math.max(w.a.y, w.b.y)) {
          j = i;
          break;
        }
      }
      let keep = 1;
      if (j >= 0) {
        if (strips[j].carryover) {
          // Behind the body the wake of the two exposed roots beside it (a carry-over strip has neighbours).
          keep = 1 - 0.5 * (this.wakeLoss(j - 1, this.wing.alpha[j - 1], p, d, nx, nz) + this.wakeLoss(j + 1, this.wing.alpha[j + 1], p, d, nx, nz));
        } else {
          keep = 1 - this.wakeLoss(j, this.wing.alpha[j], p, d, nx, nz);
        }
      }
      tailWakeFactor[k] *= Math.sqrt(Math.max(keep, 0));
    }
    this.scaleTailInflow();
  }

  /** Scale the tail strips' inflow by their wake factors. */
  private scaleTailInflow(): void {
    const { u0Tail, tailWakeFactor } = this;
    for (let k = 0; k < tailWakeFactor.length; k++) {
      const factor = tailWakeFactor[k];
      if (factor !== 1) {
        u0Tail[3 * k] *= factor;
        u0Tail[3 * k + 1] *= factor;
        u0Tail[3 * k + 2] *= factor;
      }
    }
  }

  /**
   * Dynamic-pressure loss fraction at point p in the viscous wake of strip j (global index) at angle of attack
   * `alpha`, shed along the unit direction d; (nx, nz) is the wake sheet's normal in the body x-z plane.
   */
  private wakeLoss(j: number, alpha: number, p: Vec3, d: Vec3, nx: number, nz: number): number {
    const st = this.strips[j];
    const surfaces = this.stripInputs.surfaces;
    evaluateSection(this.conds[j], alpha + this.rotation[j], this.separation[j], this.coeffs);
    const cd = Math.max(this.coeffs.cd, 0);
    // Trailing edge, moved by deflected flaps and control surfaces (and aft by Fowler travel).
    let te = 0.75 * st.chord;
    let drop = 0;
    for (const c of st.controls) {
      if (c.flap.kind === 'allMoving') continue;
      const delta = c.gain * surfaces[c.source] * c.coverage;
      drop += c.flap.chordFraction * st.chord * Math.sin(delta);
      te += fowlerExtension(c.flap, delta) * st.chord;
    }
    const rx = p.x - (st.mid.x + te * st.t.x - drop * st.n.x);
    const ry = p.y - (st.mid.y + te * st.t.y - drop * st.n.y);
    const rz = p.z - (st.mid.z + te * st.t.z - drop * st.n.z);
    const along = rx * d.x + ry * d.y + rz * d.z;
    if (along <= 0) return 0;
    const xc = along / st.chord;
    const halfWidth = this.wakeHalfWidth * st.chord * Math.sqrt(cd * (xc + 0.15));
    const off = Math.abs(rx * nx + rz * nz);
    if (!(off < halfWidth)) return 0;
    const c = Math.cos((Math.PI * off) / (2 * halfWidth));
    return Math.min((2.42 * Math.sqrt(cd)) / (xc + 0.3), this.wakeMaxLoss) * c * c;
  }

  /**
   * Convect the propeller jet's centreline with the flow inside it (vorticity, and a stream tube, move with the
   * fluid): from the disc aft, the centre drifts by the cross-flow at the centre over the jet's axial speed. The
   * free stream's part is the straight line the jet leaves the disc along (SlipstreamField.prepare); the rest is
   * the velocity the wing's vortex system induces at the jet (bound vortex and trailing legs, the same lattice
   * that gives the tail its downwash: the bound vortex's upwash ahead of the wing raises the jet, its downwash
   * behind lowers it again, and the trailing vortices, including those shed at the jet's edges, carry it down),
   * plus the jet-boundary downwash (see slipstream.ts). Before this the jet was turned by 1.5 times the mean
   * lifting-line downwash at the wing strips inside it; at a lowered flap's inner end that mean is an upwash
   * (the trailing vortex there), which turned the jet UP with the flaps down, and with the flaps up it put the
   * jet's axis at mid-fin height at the power-on stall. Returns false when nothing changed.
   */
  private updateJetPath(jet: Jet): boolean {
    const { centre, strips, nWing, wing } = this;
    const { field: slip, x: jetX, y: jetY, z: jetZ, grid: jetGrid } = jet;
    if (!slip.isActive) {
      slip.clearPath();
      return false;
    }
    this.updateJetInfluence(jet);
    jetGrid.fill(0);
    jet.coupling.addInduced(this.gammaAtTail, jetGrid);
    // Jet-boundary downwash: the circulation the jet adds to the sections inside it (each strip's circulation in
    // the proportion of its speed that is the jet's axial increment) over the jet's area and speed at the wing.
    const u = this.scratch;
    let excess = 0;
    for (let i = 0; i < nWing; i++) {
      const st = strips[i];
      if (st.carryover) continue;
      u.x = u.y = u.z = 0;
      slip.add(st.cp, u, 1, jet.wingBlowing);
      const q = wing.speed[i];
      if (!(-u.x > 0) || !(q > 1e-3)) continue;
      excess += this.gammaAtTail[i] * Math.min(-u.x / q, 1) * Math.abs(st.b.y - st.a.y);
    }
    const vjWing = slip.centreline(jet.wingQuarterChordX, centre);
    const V = Math.max(-this.air.x, 0);
    const mu = vjWing > 1e-3 ? Math.min(V / vjWing, 1) : 1;
    const R = slip.radius;
    const eps = vjWing > 1 && R > 0 ? ((1 - mu * mu) / (1 + mu * mu)) * (excess / (2 * vjWing * Math.PI * R * R)) : 0;
    slip.setBoundaryDownwash(Math.max(eps, 0), jet.wingQuarterChordX);
    // March the centreline aft (Heun's method): the slope at a station is the induced cross-flow at the displaced
    // centre over the jet's axial speed there, plus the boundary downwash angle.
    const s0 = this.jetSlope0, s1 = this.jetSlope1;
    jetY[0] = jetZ[0] = 0;
    for (let k = 0; k + 1 < jetX.length; k++) {
      const dx = jetX[k] - jetX[k + 1];
      this.jetSlope(jet, k, jetY[k], jetZ[k], s0);
      this.jetSlope(jet, k + 1, jetY[k] + s0.y * dx, jetZ[k] + s0.z * dx, s1);
      const y = jetY[k] + 0.5 * (s0.y + s1.y) * dx;
      const z = jetZ[k] + 0.5 * (s0.z + s1.z) * dx;
      const ok = Number.isFinite(y + z);
      jetY[k + 1] = ok ? y : jetY[k];
      jetZ[k + 1] = ok ? z : jetZ[k];
    }
    slip.setPath(jetX, jetY, jetZ, jetX.length);
    return true;
  }

  /**
   * Slope of the jet's centreline at path station k for a displacement (dy, dz) there: the wing-induced cross-flow
   * (interpolated in the station's sample grid at the displaced centre) over the jet's axial speed, plus the
   * jet-boundary downwash angle.
   */
  private jetSlope(jet: Jet, k: number, dy: number, dz: number, out: MutableVec3): void {
    const { field: slip, grid: jetGrid, rows, column } = jet;
    const centre = this.centre;
    const speed = Math.max(slip.centreline(jet.x[k], centre), 1);
    const nz = column.length, ny = rows.length;
    const fz = Math.min(Math.max((centre.z + dz - column[0]) / (column[1] - column[0]), 0), nz - 1.000001);
    const fy = Math.min(Math.max((centre.y + dy - rows[0]) / (rows[1] - rows[0]), 0), ny - 1.000001);
    const jz = Math.floor(fz), tz = fz - jz, jy = Math.floor(fy), ty = fy - jy;
    let wy = 0, wz = 0;
    for (let a = 0; a < 2; a++) {
      for (let b = 0; b < 2; b++) {
        const w = (a === 0 ? 1 - ty : ty) * (b === 0 ? 1 - tz : tz);
        const i = 3 * ((k * ny + jy + a) * nz + jz + b);
        wy += w * jetGrid[i + 1];
        wz += w * jetGrid[i + 2];
      }
    }
    out.y = wy / speed;
    out.z = wz / speed + slip.boundaryAngle(jet.x[k]);
  }

  private readonly jetSlope0: MutableVec3 = { x: 0, y: 0, z: 0 };
  private readonly jetSlope1: MutableVec3 = { x: 0, y: 0, z: 0 };

  /** Converge circulation, downwash and separation together as if the flow had been steady. */
  private settle(): void {
    const { strips, nWing, conds, separation, alphaLag } = this;
    for (let pass = 0; pass < 12; pass++) {
      // The downwash, and with it the wake direction, is still converging: the first pass builds the wake
      // influence for the free stream, later ones correct it for the wake's turn (or rebuild past the
      // threshold), and the final solve below rebuilds it exactly for the converged direction.
      if (pass === 0) this.builtWake = null;
      this.solveWing(10);
      this.gammaAtTail.set(this.wing.gamma);
      this.solveTail(10);
      let change = 0;
      for (let i = 0; i < strips.length; i++) {
        if (strips[i].carryover) continue;
        const alpha = (i < nWing ? this.wing.alpha[i] : this.tail.alpha[i - nWing]) + this.rotation[i];
        alphaLag[i] = alpha;
        const fs = staticSeparation(conds[i], alpha);
        change = Math.max(change, Math.abs(fs - separation[i]));
        separation[i] = pass === 0 ? fs : separation[i] + 0.6 * (fs - separation[i]);
      }
      this.followSeparation();
      // The control surfaces' effectiveness follows their sections' angle of attack.
      const flapChange = this.updateFlapAlpha();
      if (flapChange > 1e-7) this.prepareStrips(0, strips.length);
      // Once the separation state has converged the passes repeat themselves (the wing solution depends on
      // nothing else, and the tail's wake direction on the wing alone).
      if (pass > 0 && change < 1e-9 && flapChange < 1e-5) break;
    }
    this.builtWake = null;
    this.solveWing(10);
    this.gammaAtTail.set(this.wing.gamma);
    this.solveTail(10);
  }

  /** Strips without a separation state of their own take their source strip's (see separationSource). */
  private followSeparation(): void {
    const { separation, separationSource: src } = this;
    for (let i = 0; i < src.length; i++) if (src[i] !== i) separation[i] = separation[src[i]];
  }

  /** Leishman-Beddoes lags on the separation state, and the wing-to-tail convection lag. */
  private advanceLags(dt: number, airspeed: number): void {
    const { strips, nWing, conds, separation, alphaLag } = this;
    for (let i = 0; i < strips.length; i++) {
      if (strips[i].carryover) continue;
      const ll = i < nWing ? this.wing : this.tail;
      const k = i < nWing ? i : i - nWing;
      const q = Math.max(ll.speed[k], 1);
      const semichordTime = strips[i].chord / (2 * q);
      const kp = 1 - Math.exp(-dt / (SEPARATION_LAG.pressure * semichordTime));
      alphaLag[i] = wrapPi(alphaLag[i] + kp * wrapPi(ll.alpha[k] + this.rotation[i] - alphaLag[i]));
      const kf = 1 - Math.exp(-dt / (SEPARATION_LAG.boundaryLayer * semichordTime));
      separation[i] += kf * (staticSeparation(conds[i], alphaLag[i]) - separation[i]);
      if (!Number.isFinite(separation[i] + alphaLag[i])) {
        separation[i] = 1;
        alphaLag[i] = 0;
      }
    }
    this.followSeparation();
    this.updateFlapAlpha();
    const kd = 1 - Math.exp(-(dt * Math.max(airspeed, 1)) / this.tailArm);
    for (let j = 0; j < nWing; j++) {
      const g = this.gammaAtTail[j] + kd * (this.wing.gamma[j] - this.gammaAtTail[j]);
      this.gammaAtTail[j] = Number.isFinite(g) ? g : 0;
    }
  }

  /** Strip, body and parasite loads; outputs and diagnostics. */
  private assemble(input: AeroInput, air: Vec3, airspeed: number): AeroOutput {
    const rho = input.atmosphere.density;
    const { strips, nWing, loads, coeffs, conds, separation } = this;
    loads.reset(input.body.cgOffset);
    const pb = this.pitchBreakdown, yb = this.yawBreakdown, rb = this.rollBreakdown;
    pb.wing = pb.hTail = pb.vTail = 0;
    yb.wing = yb.hTail = yb.vTail = 0;
    rb.wing = rb.hTail = rb.vTail = 0;
    let stalledArea = 0;
    for (let i = 0; i < strips.length; i++) {
      const st = strips[i];
      const mx0 = loads.mx, my0 = loads.my, mz0 = loads.mz;
      const ll = i < nWing ? this.wing : this.tail;
      const k = i < nWing ? i : i - nWing;
      const ux = ll.velocity[3 * k], uy = ll.velocity[3 * k + 1], uz = ll.velocity[3 * k + 2];
      // Velocity in the section plane: drag along it, lift perpendicular to it (toward n at alpha = 0).
      const vt = ux * st.t.x + uy * st.t.y + uz * st.t.z;
      const vn = ux * st.n.x + uy * st.n.y + uz * st.n.z;
      const q = Math.sqrt(vt * vt + vn * vn);
      // The section's angle of attack: the strip's, plus the rotation of an all-moving surface. Lift and drag
      // stay resolved about the local wind (ct, cn below are the wind's direction, whatever the section's angle).
      const alpha = ll.alpha[k] + this.rotation[i];
      if (st.carryover) {
        coeffs.cl = ll.cl[k];
        coeffs.cd = 0;
        coeffs.cm = 0;
      } else {
        evaluateSection(conds[i], alpha, separation[i], coeffs);
        if (st.bodySection) coeffs.cd = 0;
      }
      const qd = 0.5 * rho * q * q;
      if (q > 1e-6) {
        let ct = vt / q, cn = vn / q;
        if (st.forceAtBound) {
          // Non-planar line: the force is normal to the flow at the bound vortex, its size the control point's.
          const ub = this.boundFlow;
          ll.boundVelocity(k, i < nWing ? this.u0Wing : this.u0Tail, ub);
          const bt = ub.x * st.t.x + ub.y * st.t.y + ub.z * st.t.z;
          const bn = ub.x * st.n.x + ub.y * st.n.y + ub.z * st.n.z;
          const qb = Math.sqrt(bt * bt + bn * bn);
          if (qb > 1e-6) {
            ct = bt / qb;
            cn = bn / qb;
          }
        }
        // Drag along d = ct t + cn n, lift along l = ct n - cn t.
        const ft = coeffs.cd * ct - coeffs.cl * cn;
        const fn = coeffs.cd * cn + coeffs.cl * ct;
        const f = qd * st.area;
        loads.addForce(st.mid, f * (ft * st.t.x + fn * st.n.x), f * (ft * st.t.y + fn * st.n.y), f * (ft * st.t.z + fn * st.n.z));
        const m = f * st.chord * coeffs.cm;
        loads.addMoment(m * st.e.x, m * st.e.y, m * st.e.z);
      }
      rb[st.surface] += loads.mx - mx0;
      pb[st.surface] += loads.my - my0;
      yb[st.surface] += loads.mz - mz0;
      // A strip counts as stalled past the Leishman-Beddoes break: f below its section's breakSeparation (0.7).
      const stalled = separation[i] < conds[i].breakSeparation;
      if (i < nWing && stalled) stalledArea += st.area;
      const d = this.diagnostics[i];
      const u0 = i < nWing ? this.u0Wing : this.u0Tail;
      d.alpha = alpha;
      d.geometricAlpha = Math.atan2(
        u0[3 * k] * st.n.x + u0[3 * k + 1] * st.n.y + u0[3 * k + 2] * st.n.z,
        u0[3 * k] * st.t.x + u0[3 * k + 1] * st.t.y + u0[3 * k + 2] * st.t.z,
      );
      d.cl = coeffs.cl;
      d.cd = coeffs.cd;
      d.cm = coeffs.cm;
      d.separation = separation[i];
      d.stalled = stalled;
      d.circulation = ll.gamma[k];
      d.dynamicPressure = qd;
    }
    this.bodyInduced.fill(0);
    this.bodyCoupling.addInduced(this.wing.gamma, this.bodyInduced);
    const bi = this.bodyInduced, jets = this.jets;
    for (let j = 0; j < jets.length; j++) {
      const h = jets[j].discOffset, pi = jets[j].inflow;
      pi.x = 0.25 * (bi[h] + bi[h + 3] + bi[h + 6] + bi[h + 9]);
      pi.y = 0.25 * (bi[h + 1] + bi[h + 4] + bi[h + 7] + bi[h + 10]);
      pi.z = 0.25 * (bi[h + 2] + bi[h + 5] + bi[h + 8] + bi[h + 11]);
      // The cowling's blockage, proportional to the axial component of the free stream (air.x < 0 from ahead).
      pi.x -= jets[j].blockage * air.x;
      if (!Number.isFinite(pi.x + pi.y + pi.z)) pi.x = pi.y = pi.z = 0;
    }

    let mx0 = loads.mx, my0 = loads.my, mz0 = loads.mz;
    this.fuselage.addLoads(rho, this.flow, this.bodyInduced, 0, loads, input.atmosphere.viscosity);
    rb.fuselage = loads.mx - mx0;
    pb.fuselage = loads.my - my0;
    yb.fuselage = loads.mz - mz0;
    mx0 = loads.mx;
    my0 = loads.my;
    mz0 = loads.mz;
    const nacelles = this.nacelles;
    for (let k = 0; k < nacelles.length; k++) nacelles[k].addLoads(rho, this.flow, this.bodyInduced, this.nacelleOffsets[k], loads, input.atmosphere.viscosity);
    rb.nacelles = loads.mx - mx0;
    pb.nacelles = loads.my - my0;
    yb.nacelles = loads.mz - mz0;
    mx0 = loads.mx;
    my0 = loads.my;
    mz0 = loads.mz;
    addDragItemLoads(this.definition.dragItems, rho, this.flow, this.bodyInduced, this.itemOffset, loads, input.dragScales);
    rb.items = loads.mx - mx0;
    pb.items = loads.my - my0;
    yb.items = loads.mz - mz0;
    mx0 = loads.mx;
    my0 = loads.my;
    mz0 = loads.mz;
    addStrutLoads(this.definition.struts, rho, this.flow, this.bodyInduced, this.strutOffset, loads);
    rb.struts = loads.mx - mx0;
    pb.struts = loads.my - my0;
    yb.struts = loads.mz - mz0;

    // Aircraft motion relative to the air: alpha, beta and wind-axis lift and drag.
    const u = -air.x, v = -air.y, w = -air.z;
    const alpha = Math.atan2(w, u);
    const beta = airspeed > 1e-6 ? Math.asin(Math.max(-1, Math.min(1, v / airspeed))) : 0;
    const drag = airspeed > 1e-6 ? -(loads.fx * u + loads.fy * v + loads.fz * w) / airspeed : 0;
    const lift = loads.fx * Math.sin(alpha) - loads.fz * Math.cos(alpha);

    // The first sensor whose flap range holds the present deflection; outside every range, the first (a gap
    // between the ranges must not silence the warning).
    const sensors = this.stallSensors;
    let sw = sensors[0];
    if (sensors.length > 1 || sw.flaps) {
      const flaps = input.surfaces.flaps;
      for (let k = 0; k < sensors.length; k++) {
        const range = sensors[k].flaps;
        if (!range || (flaps >= range[0] && flaps <= range[1])) {
          sw = sensors[k];
          break;
        }
      }
    }
    const sensorCond = conds[sw.strip];
    const sensorAlpha = this.alphaLag[sw.strip];
    const stallWarning = Math.cos(sensorAlpha) < 0 || sensorAlpha - sensorCond.alpha0 > sensorCond.stallPos - sw.margin;

    return {
      force: { x: loads.fx, y: loads.fy, z: loads.fz },
      moment: { x: loads.mx, y: loads.my, z: loads.mz },
      alpha,
      beta,
      stallFraction: stalledArea / this.wingArea,
      stallWarning: stallWarning && airspeed > 5,
      lift,
      drag,
      propellerInflows: this.propellerInflows,
    };
  }
}

