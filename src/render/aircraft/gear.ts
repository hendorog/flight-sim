// Tricycle landing gear. Main gear: tapered tubular spring-steel legs that bend like cantilevers as the
// strut compression rises (the leg geometry is re-posed when compression changes); nose gear: oleo strut
// whose chrome piston slides into the cylinder, scissor torque links that fold as it compresses,
// steering about the strut axis. Wheels spin with WheelState.rotation; wheel fairings are optional.
//
// Contact points, wheel and rim radii, tyre widths, the leg roots and the strut's lengths are the airframe
// definition's (AirframeVisualDef.gear: nose, left, right; default the Cessna 172S, whose contact points and
// wheel radii come from C172.gear and whose tyres are 5.00-5, a 5 in rim).
//
// Each wheel has one of four legs (LegVisualDef: spring tube, leaf spring, oleo, trailing link), whichever
// place it stands at. A wheel with `retract` hangs with its whole leg on one more hinge and swings up with
// GearState.extension; its doors follow the same value, a dark decal on the skin stands for the well (no hole
// is cut: the wheel folds into the closed wing or nacelle and is not drawn when fully up).

import * as THREE from 'three';
import { C172S_VISUAL } from '../../aircraft/c172s/visual';
import type { WheelState } from '../../core/types';
import type { AirframeVisualDef, LegVisualDef, WheelVisualDef } from './airframe/types';
import { frd, gridGeometry, Hinge, MeshBatch, outlineNormal, plateGeometry, refreshGrid, sweepGeometry, type GridSpec } from './geometry';
import type { AircraftMaterials } from './materials';

type SpringLegDef = Extract<LegVisualDef, { kind: 'springTube' | 'leafSpring' }>;
type OleoLegDef = Extract<LegVisualDef, { kind: 'oleo' }>;
type TrailingLegDef = Extract<LegVisualDef, { kind: 'trailingLink' }>;

/** Where a wheel stands: -1 left main, 1 right main, 0 nose (on the centre line, steered or castering). */
type Place = -1 | 0 | 1;

/** Cylinder between two model-space points. */
function rod(a: THREE.Vector3, b: THREE.Vector3, r0: number, r1: number, seg = 16): THREE.BufferGeometry {
  const d = new THREE.Vector3().subVectors(b, a);
  const g = new THREE.CylinderGeometry(r1, r0, d.length(), seg);
  g.translate(0, d.length() / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
  g.translate(a.x, a.y, a.z);
  return g;
}

/** Tyre (lathe) and hub parts about model +X, centred at the origin. */
function wheelGeometries(radius: number, width: number, rimR: number): { tyre: THREE.BufferGeometry; hub: THREE.BufferGeometry[] } {
  const pts: THREE.Vector2[] = [];
  const rc = rimR + (radius - rimR) * 0.52;
  const a = radius - rc;
  const b = width / 2;
  const n = 2.6;
  const thMax = 0.78 * Math.PI;
  // Bead to bead with the axial coordinate ascending, so the lathe faces outward.
  for (let k = 0; k <= 26; k++) {
    const th = -thMax + (2 * thMax * k) / 26;
    const c = Math.cos(th);
    const s = Math.sin(th);
    const r = rc + a * Math.sign(c) * Math.pow(Math.abs(c), 2 / n);
    const y = b * Math.sign(s) * Math.pow(Math.abs(s), 2 / n);
    pts.push(new THREE.Vector2(Math.max(rimR, r), y));
  }
  const tyre = new THREE.LatheGeometry(pts, 40);
  tyre.rotateZ(-Math.PI / 2);

  const hub: THREE.BufferGeometry[] = [];
  const rim = new THREE.CylinderGeometry(rimR + 0.004, rimR + 0.004, width * 0.8, 32, 1, true);
  rim.rotateZ(Math.PI / 2);
  hub.push(rim);
  for (const side of [-1, 1]) {
    const face = new THREE.CylinderGeometry(rimR * 0.95, rimR + 0.006, 0.012, 32);
    face.rotateZ(Math.PI / 2);
    face.translate(side * (width * 0.4 + 0.006), 0, 0);
    hub.push(face);
    const cap = new THREE.CylinderGeometry(0.026, 0.03, 0.03, 16);
    cap.rotateZ(Math.PI / 2);
    cap.translate(side * (width * 0.4 + 0.02), 0, 0);
    hub.push(cap);
    // Wheel bolts make the spin visible.
    for (let k = 0; k < 6; k++) {
      const ang = (k / 6) * Math.PI * 2;
      const bolt = new THREE.CylinderGeometry(0.0055, 0.0055, 0.012, 6);
      bolt.rotateZ(Math.PI / 2);
      bolt.translate(side * (width * 0.4 + 0.016), Math.cos(ang) * 0.045, Math.sin(ang) * 0.045);
      hub.push(bolt);
    }
  }
  return { tyre, hub };
}

/** Where along its length (from the nose) a wheel fairing is deepest; the axle sits there. */
const PANT_MAX_AT = 0.4;

/**
 * Wheel-fairing thickness along its length (t = 0 nose, 1 tail), 1 at PANT_MAX_AT: a fine entry (a
 * sine-power rise, much sharper than an aerofoil's round nose) and a long taper to a point.
 */
function pantProfile(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  if (x <= PANT_MAX_AT) return Math.pow(Math.sin((Math.PI / 2) * (x / PANT_MAX_AT)), 0.62);
  const u = (x - PANT_MAX_AT) / (1 - PANT_MAX_AT);
  return Math.pow(Math.cos((Math.PI / 2) * u), 0.85);
}

/**
 * Streamlined wheel fairing around a wheel at `centre` (model space); the tyre protrudes below it.
 * In side and plan view a long teardrop (pantProfile, deepest over the axle at PANT_MAX_AT of its length);
 * in section a superellipse with fairly slab sides and the inboard face flatter still (`inboard` = model x
 * sign of the inboard side, 0 for the symmetric nose fairing), and a tail that rises slightly to a point.
 */
function pantGeometry(centre: THREE.Vector3, length: number, halfW: number, top: number, bottom: number, inboard: -1 | 0 | 1): THREE.BufferGeometry {
  const rows = 34;
  const cols = 40;
  const fwd = PANT_MAX_AT * length;
  const spec: GridSpec = {
    rows,
    cols: cols + 1,
    wrap: true,
    flip: true,
    position(i, j, out) {
      // Rows bunched toward the nose.
      const t = Math.pow(i / (rows - 1), 1.4);
      const x = fwd - length * t;
      const f = pantProfile(t);
      const zc = -0.07 * Math.max(0, (t - 0.45) / 0.55) ** 1.6;
      const a = (j / cols) * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const h = c > 0 ? bottom : top;
      // Model x of this side (FRD y maps to model x): the inboard half is flatter and a little narrower.
      // Exponents below 1 square the section up (superellipse n = 2 / e: ~2.9 outboard, 4 inboard).
      const flat = inboard !== 0 && Math.sign(s) === inboard;
      const e = flat ? 0.5 : 0.68;
      const w = halfW * (flat ? 0.9 : 1);
      frd(x, w * f * Math.sign(s) * Math.pow(Math.abs(s), e), zc + h * f * Math.sign(c) * Math.pow(Math.abs(c), 0.85), out).add(centre);
    },
  };
  return gridGeometry(spec);
}

const shadowed = (g: THREE.BufferGeometry, m: THREE.Material): THREE.Mesh => {
  const mesh = new THREE.Mesh(g, m);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
};

/** One wheel with its leg, as LandingGear poses it and lays out its shadow casters. */
interface WheelAssembly {
  update(w: WheelState): void;
  /** Shadow proxy layout (see LandingGear.shadowRig). */
  moving: THREE.Object3D[];
  keep: THREE.Mesh[];
  none: THREE.Mesh[];
}

/** What a leg is built into: the materials, its parent node, and the batch of its parts that never move. */
interface LegSite {
  mat: AircraftMaterials;
  pants: boolean;
  carrier: THREE.Object3D;
  fixed: MeshBatch;
}

/**
 * A cantilever spring leg (tube or leaf) from the airframe to the axle. At a main wheel it ends at the axle
 * fitting inboard of the wheel, which carries the brake; at the nose it ends over the tyre in a fork that
 * swivels with the steering angle.
 */
class SpringLeg implements WheelAssembly {
  readonly moving: THREE.Object3D[];
  readonly keep: THREE.Mesh[];
  readonly none: THREE.Mesh[] = [];
  private readonly leg: THREE.Mesh;
  private readonly legSpec: GridSpec;
  private readonly axle = new THREE.Group();
  private readonly spin = new THREE.Group();
  private compression = -1;

  constructor(
    site: LegSite,
    private readonly side: Place,
    private readonly def: WheelVisualDef,
  ) {
    const { mat, pants, carrier } = site;
    const wheel = def;
    const { axle, spin } = this;
    const parts = wheelGeometries(wheel.radius, wheel.width, wheel.rimRadius);
    axle.add(spin);
    spin.add(shadowed(parts.tyre, mat.tyre));
    const rotating = new MeshBatch();
    for (const g of parts.hub) rotating.add(mat.aluminium, g);
    const still = new MeshBatch();
    const pant = wheel.fairing;
    if (side !== 0) {
      // Lateral distance from the wheel centre plane to the leg end / axle fitting.
      const AXLE_OFFSET = springAxleOffset(wheel);
      const disc = new THREE.CylinderGeometry(0.085, 0.085, 0.006, 32);
      disc.rotateZ(Math.PI / 2);
      disc.translate(-side * 0.082, 0, 0);
      rotating.add(mat.darkMetal, disc);
      spin.add(...rotating.build('mainWheel').children);

      const caliper = new THREE.BoxGeometry(0.03, 0.05, 0.06);
      caliper.translate(-side * 0.082, 0.07, 0.02);
      still.add(mat.darkMetal, caliper);
      const fitting = new THREE.BoxGeometry(0.05, 0.07, 0.08);
      fitting.translate(-side * AXLE_OFFSET, 0, 0);
      still.add(mat.darkMetal, fitting);
      if (pants && pant) still.add(mat.plainPaint, pantGeometry(new THREE.Vector3(), pant.length, pant.halfWidth, pant.top, pant.bottom, side > 0 ? -1 : 1));
      axle.add(...still.build('mainAxle').children);
    } else {
      spin.add(...rotating.build('noseHub').children);
      // Fork: a crown over the tyre (where the leg ends) and a leg down each side to the axle.
      const half = wheel.width / 2 + 0.022;
      const crown = new THREE.Vector3(0, wheel.radius + 0.035, 0);
      still.add(mat.darkMetal, rod(new THREE.Vector3(-half, crown.y, 0), new THREE.Vector3(half, crown.y, 0), 0.016, 0.016));
      for (const s of [-1, 1]) still.add(mat.darkMetal, rod(new THREE.Vector3(s * half, crown.y, 0), new THREE.Vector3(s * half, 0, 0), 0.014, 0.012));
      still.add(mat.darkMetal, rod(new THREE.Vector3(-half, 0, 0), new THREE.Vector3(half, 0, 0), 0.011, 0.011));
      if (pants && pant) still.add(mat.plainPaint, pantGeometry(new THREE.Vector3(), pant.length, pant.halfWidth, pant.top, pant.bottom, 0));
      axle.add(...still.build('noseAxle').children);
    }
    carrier.add(axle);

    this.legSpec = legSpec(side, wheel, () => Math.max(0, this.compression));
    this.leg = shadowed(gridGeometry(this.legSpec), mat.plainPaint);
    carrier.add(this.leg);
    this.moving = [axle];
    this.keep = [this.leg];
  }

  update(w: WheelState): void {
    const c = Math.max(0, w.compression);
    if (Math.abs(c - this.compression) > 1e-5) {
      this.compression = c;
      refreshGrid(this.leg.geometry, this.legSpec);
      const contact = this.def.contact;
      frd(contact[0], contact[1], contact[2] - this.def.radius - c, this.axle.position);
    }
    this.spin.rotation.x = -w.rotation;
    // The nose fork swivels about the vertical through the axle (positive = the wheel turns right).
    if (this.side === 0) this.axle.rotation.y = -w.steerAngle;
  }
}

/** Lateral distance from a main wheel's centre plane to where its spring leg ends. */
function springAxleOffset(wheel: WheelVisualDef): number {
  const leg = wheel.leg as SpringLegDef;
  return leg.kind === 'springTube' ? leg.axleOffset : wheel.width / 2 + 0.035;
}

/**
 * An oleo strut: the cylinder is fixed, the chrome piston with the fork and the wheel slides into it, scissor
 * torque links fold as it compresses; a steered (or castering) one turns about the strut axis.
 */
class OleoLeg implements WheelAssembly {
  readonly moving: THREE.Object3D[];
  readonly keep: THREE.Mesh[] = [];
  readonly none: THREE.Mesh[] = [];
  private readonly noseSteer: Hinge;
  private readonly noseSlider = new THREE.Group();
  private readonly noseSpin = new THREE.Group();
  private readonly linkUpper: THREE.Mesh | null = null;
  private readonly linkLower: THREE.Mesh | null = null;
  /** Vertical compression -> travel along the raked strut. */
  private readonly strutCos: number;
  /** Direction the torque links fold toward, in the steering frame. */
  private readonly linkFwd = new THREE.Vector3();
  private readonly knee = new THREE.Vector3();
  private readonly pivot = new THREE.Vector3();
  private readonly linkDir = new THREE.Vector3();
  private static readonly Y = new THREE.Vector3(0, 1, 0);
  /** Fixed cylinder length and piston crown position along the strut from its top, m. */
  private readonly cylinderLen: number;
  private readonly crownAt: number;
  private readonly steers: boolean;

  constructor(site: LegSite, nose: WheelVisualDef) {
    const { mat, pants, carrier, fixed } = site;
    const strut = nose.leg as OleoLegDef;
    this.steers = strut.steers;
    const CYLINDER_LEN = (this.cylinderLen = strut.cylinderLen);
    const CROWN_AT = (this.crownAt = strut.crownAt);
    const FORK_HALF = strut.forkHalf;
    const top = frd(strut.top[0], strut.top[1], strut.top[2]);
    const axle0 = frd(nose.contact[0], nose.contact[1], nose.contact[2] - nose.radius);
    const axis = axle0.clone().sub(top).normalize();
    this.strutCos = Math.abs(axis.y);
    const at = (d: number): THREE.Vector3 => top.clone().addScaledVector(axis, d);
    const lateral = new THREE.Vector3(1, 0, 0);

    fixed.add(mat.darkMetal, rod(top, at(CYLINDER_LEN), 0.038, 0.036, 20));
    fixed.add(mat.darkMetal, rod(at(CYLINDER_LEN - 0.04), at(CYLINDER_LEN), 0.046, 0.046, 20));

    // Steering frame: hinge on the strut axis (pointing down), positive angle = nose wheel turns right.
    this.noseSteer = new Hinge(top, axis);
    this.noseSteer.object.add(this.noseSlider);
    const slider = new MeshBatch();
    slider.add(mat.chrome, this.noseSteer.adopt(rod(at(CYLINDER_LEN - 0.12), at(CROWN_AT), 0.026, 0.026)));
    const crown = at(CROWN_AT);
    slider.add(mat.darkMetal, this.noseSteer.adopt(rod(crown.clone().addScaledVector(lateral, -0.09), crown.clone().addScaledVector(lateral, 0.09), 0.028, 0.028)));
    for (const s of [-1, 1]) {
      const a = crown.clone().addScaledVector(lateral, s * FORK_HALF);
      const b = axle0.clone().addScaledVector(lateral, s * FORK_HALF);
      slider.add(mat.darkMetal, this.noseSteer.adopt(rod(a, b, 0.016, 0.013)));
    }
    slider.add(mat.darkMetal, this.noseSteer.adopt(rod(axle0.clone().addScaledVector(lateral, -0.09), axle0.clone().addScaledVector(lateral, 0.09), 0.012, 0.012)));
    const nosePant = nose.fairing;
    if (pants && nosePant) slider.add(mat.plainPaint, this.noseSteer.adopt(pantGeometry(axle0, nosePant.length, nosePant.halfWidth, nosePant.top, nosePant.bottom, 0)));
    this.noseSlider.add(...slider.build('noseSlider').children);

    // The wheel mount re-aligns with the model axes so the tyre spins about its axle.
    const mount = new THREE.Group();
    mount.position.copy(axle0).applyMatrix4(this.noseSteer.object.matrix.clone().invert());
    mount.quaternion.copy(this.noseSteer.object.quaternion).invert();
    mount.add(this.noseSpin);
    const noseWheel = wheelGeometries(nose.radius, nose.width, nose.rimRadius);
    this.noseSpin.add(shadowed(noseWheel.tyre, mat.tyre));
    const hub = new MeshBatch();
    for (const g of noseWheel.hub) hub.add(mat.aluminium, g);
    this.noseSpin.add(...hub.build('noseHub').children);
    this.noseSlider.add(mount);

    if (strut.scissors) {
      // Scissor links, posed each frame in the steering frame.
      this.linkUpper = shadowed(new THREE.BoxGeometry(0.02, 0.14, 0.028), mat.darkMetal);
      this.linkLower = shadowed(new THREE.BoxGeometry(0.02, 0.14, 0.028), mat.darkMetal);
      this.noseSteer.object.add(this.linkUpper, this.linkLower);
      this.none.push(this.linkUpper, this.linkLower);
    }
    this.linkFwd.set(0, 0, -1).applyQuaternion(this.noseSteer.object.quaternion.clone().invert());
    this.linkFwd.x = 0;
    this.linkFwd.normalize();

    carrier.add(this.noseSteer.object);
    this.moving = [this.noseSteer.object, this.noseSlider];
  }

  update(n: WheelState): void {
    const travel = Math.max(0, n.compression) / this.strutCos;
    this.noseSlider.position.set(-travel, 0, 0);
    if (this.steers) this.noseSteer.setAngle(n.steerAngle);
    this.noseSpin.rotation.x = -n.rotation;
    if (this.linkUpper) this.poseLinks(travel);
  }

  /** Upper link pivots under the collar, lower link on the fork crown (which rises with the piston). */
  private poseLinks(travel: number): void {
    const u = this.cylinderLen + 0.005;
    const l = this.crownAt - travel;
    const len = 0.14;
    const half = (l - u) / 2;
    const offset = 0.04;
    const bulge = Math.sqrt(Math.max(0, len * len - half * half)) + offset;
    this.knee.set(u + half, 0, 0).addScaledVector(this.linkFwd, bulge);
    this.poseLink(this.linkUpper!, this.pivot.set(u, 0, 0).addScaledVector(this.linkFwd, offset), this.knee);
    this.poseLink(this.linkLower!, this.pivot.set(l, 0, 0).addScaledVector(this.linkFwd, offset), this.knee);
  }

  private poseLink(m: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3): void {
    m.position.addVectors(a, b).multiplyScalar(0.5);
    this.linkDir.subVectors(b, a).normalize();
    m.quaternion.setFromUnitVectors(OleoLeg.Y, this.linkDir);
  }
}

/**
 * A trailing-link leg: the wheel sits at the end of an arm hinged on a fixed post; as the strut compresses the
 * arm swings up about its pivot (the axle moves on an arc of armLen). At the nose the arm is a fork and the
 * whole leg turns with the steering angle about the vertical through the pivot.
 */
class TrailingLeg implements WheelAssembly {
  readonly moving: THREE.Object3D[];
  readonly keep: THREE.Mesh[] = [];
  readonly none: THREE.Mesh[] = [];
  private readonly steer = new THREE.Group();
  private readonly arm = new THREE.Group();
  private readonly spin = new THREE.Group();
  /** The axle from the pivot at rest (model y up, z aft), and the arm's kinematic length. */
  private readonly restY: number;
  private readonly restZ: number;
  private readonly armLen: number;

  constructor(
    site: LegSite,
    private readonly side: Place,
    wheel: WheelVisualDef,
  ) {
    const { mat, carrier, fixed } = site;
    const leg = wheel.leg as TrailingLegDef;
    const pivot = frd(leg.pivot[0], leg.pivot[1], leg.pivot[2]);
    const axle0 = frd(wheel.contact[0], wheel.contact[1], wheel.contact[2] - wheel.radius);
    this.restY = axle0.y - pivot.y;
    this.restZ = axle0.z - pivot.z;
    this.armLen = Math.max(leg.armLen, Math.abs(this.restY) + 1e-6);
    // The fixed post the arm hangs on.
    const topAt = leg.top ?? wheel.retract?.pivot;
    if (topAt) fixed.add(mat.darkMetal, rod(frd(topAt[0], topAt[1], topAt[2]), pivot, 0.03, 0.034, 16));

    this.steer.position.copy(pivot);
    this.steer.add(this.arm);
    const parts = new MeshBatch();
    // Arm beams beside the wheel (inboard of a main wheel, a fork at the nose), the pivot tube and the axle.
    const off = wheel.width / 2 + 0.03;
    const sides = side === 0 ? [-1, 1] : [-side];
    const lateral = axle0.x - pivot.x;
    for (const s of sides) parts.add(mat.darkMetal, rod(new THREE.Vector3(s * off, 0, 0), new THREE.Vector3(lateral + s * off, this.restY, this.restZ), 0.022, 0.018, 12));
    const reach = Math.max(...sides.map((s) => Math.abs(s * off))) + 0.012;
    parts.add(mat.darkMetal, rod(new THREE.Vector3(-reach, 0, 0), new THREE.Vector3(reach, 0, 0), 0.026, 0.026, 12));
    parts.add(mat.darkMetal, rod(new THREE.Vector3(lateral - reach, this.restY, this.restZ), new THREE.Vector3(lateral + reach, this.restY, this.restZ), 0.012, 0.012, 12));
    this.arm.add(...parts.build('trailingArm').children);
    this.spin.position.set(lateral, this.restY, this.restZ);
    const tyre = wheelGeometries(wheel.radius, wheel.width, wheel.rimRadius);
    this.spin.add(shadowed(tyre.tyre, mat.tyre));
    const hub = new MeshBatch();
    for (const g of tyre.hub) hub.add(mat.aluminium, g);
    this.spin.add(...hub.build('wheelHub').children);
    this.arm.add(this.spin);
    carrier.add(this.steer);
    this.moving = [this.steer, this.arm];
  }

  update(w: WheelState): void {
    // The axle rises by the compression: the arm turns about the lateral axis through the pivot.
    const L = this.armLen;
    const c = Math.max(0, w.compression);
    const a0 = Math.asin(Math.min(1, Math.max(-1, this.restY / L)));
    const a1 = Math.asin(Math.min(1, Math.max(-1, (this.restY + c) / L)));
    this.arm.rotation.x = this.restZ >= 0 ? a0 - a1 : a1 - a0;
    this.spin.rotation.x = -w.rotation;
    if (this.side === 0) this.steer.rotation.y = -w.steerAngle;
  }
}

/** A retracting wheel: the hinge its leg hangs on, how far that swings, and its doors. */
interface Retraction {
  hinge: Hinge;
  angle: number;
  doors: { hinge: Hinge; angle: number }[];
}

const ALL_DOWN: readonly number[] = [1, 1, 1];
const ease = (t: number): number => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
};

export class LandingGear {
  readonly group = new THREE.Group();
  /** nose, left, right: the order of AircraftState.wheels. */
  private readonly wheels: WheelAssembly[] = [];
  private readonly retractions: (Retraction | null)[] = [null, null, null];
  private readonly doorMeshes: THREE.Mesh[] = [];
  /** The node the nose leg hangs on (it swings with a retracting leg): a lamp on the nose gear is parented here. */
  noseMount: THREE.Object3D = this.group;

  private readonly tyreMat: THREE.MeshStandardMaterial;
  private readonly treadBump: number;

  /**
   * @param pants fit the wheel fairings the definition gives
   * @param def   nose, left and right wheel of the airframe definition (default: the Cessna 172S)
   */
  constructor(mat: AircraftMaterials, pants: boolean, def: AirframeVisualDef['gear'] = C172S_VISUAL.gear) {
    this.group.name = 'landingGear';
    this.tyreMat = mat.tyre;
    this.treadBump = mat.tyre.bumpScale;
    const fixed = new MeshBatch();

    // Main gear first, then the nose gear (the top of an oleo cylinder is inside the cowling; the axle is at the
    // contact point minus the radius).
    for (const [index, side] of [
      [1, -1],
      [2, 1],
      [0, 0],
    ] as const) {
      const wheel = def[index];
      // A retracting wheel hangs on its own hinge with its own fixed parts; the others share the group.
      const retract = wheel.retract;
      let site: LegSite = { mat, pants, carrier: this.group, fixed };
      if (retract) {
        const hinge = new Hinge(frd(retract.pivot[0], retract.pivot[1], retract.pivot[2]), frd(retract.axis[0], retract.axis[1], retract.axis[2]));
        hinge.object.name = 'gearRetract';
        // Parts are authored in model space: this node undoes the hinge's rest transform.
        const inner = new THREE.Group();
        hinge.object.matrix.clone().invert().decompose(inner.position, inner.quaternion, inner.scale);
        hinge.object.add(inner);
        this.group.add(hinge.object);
        site = { mat, pants, carrier: inner, fixed: new MeshBatch() };
        this.retractions[index] = { hinge, angle: retract.angle, doors: this.buildDoors(mat, retract, fixed) };
      }
      if (index === 0) this.noseMount = site.carrier;
      const kind = wheel.leg.kind;
      this.wheels[index] = kind === 'oleo' ? new OleoLeg(site, wheel) : kind === 'trailingLink' ? new TrailingLeg(site, side, wheel) : new SpringLeg(site, side, wheel);
      if (retract) site.carrier.add(...site.fixed.build('gearLeg').children);
    }
    // (Nothing is fixed to the airframe where every leg is a spring and nothing retracts.)
    const rest = fixed.build('gearFixed').children;
    if (rest.length > 0) this.group.add(...rest);
  }

  /** The doors of a retracting wheel on their hinges, and the dark decal of its well in the fixed batch. */
  private buildDoors(mat: AircraftMaterials, retract: NonNullable<WheelVisualDef['retract']>, fixed: MeshBatch): Retraction['doors'] {
    const inside = frd(retract.pivot[0], retract.pivot[1], retract.pivot[2]);
    if (retract.well) for (const g of plateGeometry(retract.well, outlineNormal(retract.well, inside), 0.002, false)) fixed.add(mat.black, g);
    return retract.doors.map((door) => {
      const hinge = new Hinge(frd(door.hinge[0], door.hinge[1], door.hinge[2]), frd(door.axis[0], door.axis[1], door.axis[2]));
      const b = new MeshBatch();
      for (const g of plateGeometry(door.pts, outlineNormal(door.pts, inside), 0.006, true)) b.add(mat.plainPaint, hinge.adopt(g));
      // (A copy: adopting the meshes empties the batch group's own child list.)
      const meshes = [...b.build('gearDoor').children] as THREE.Mesh[];
      hinge.object.add(...meshes);
      this.doorMeshes.push(...meshes);
      this.group.add(hinge.object);
      return { hinge, angle: door.angle };
    });
  }

  /**
   * Shadow proxy layout (shadowProxy.ts): the axles and the nose slider move; the wheels spin about their
   * axles, which leaves their shadow unchanged, so they merge into their axle's proxy. The legs deform and
   * keep casting themselves; the scissor links are too small to matter, and the doors do not cast.
   */
  shadowRig(): { moving: THREE.Object3D[]; keep: THREE.Mesh[]; none: THREE.Mesh[] } {
    const order = [this.wheels[1], this.wheels[2], this.wheels[0]];
    const retracting = this.retractions.flatMap((r) => (r ? [r.hinge.object] : []));
    return {
      moving: [...order.flatMap((w) => w.moving), ...retracting],
      keep: order.flatMap((w) => w.keep),
      none: [...order.flatMap((w) => w.none), ...this.doorMeshes],
    };
  }

  /**
   * @param extension per leg (nose, left, right; GearState.extension): 0 = up, 1 = down. Default: all down.
   */
  update(wheels: readonly WheelState[], extension: readonly number[] = ALL_DOWN): void {
    this.wheels[1].update(wheels[1]);
    this.wheels[2].update(wheels[2]);
    this.wheels[0].update(wheels[0]);
    for (let i = 0; i < 3; i++) {
      const r = this.retractions[i];
      if (!r) continue;
      const k = ease(extension[i]);
      r.hinge.setAngle(r.angle * (1 - k));
      // Fully up, the wheel is inside the closed wing or nacelle: not drawn.
      r.hinge.object.visible = extension[i] > 1e-3;
      for (const door of r.doors) door.hinge.setAngle(door.angle * k);
    }
    // Motion blur of the tread: once a frame turns the wheel by more than about half a tread block (~0.1
    // rad at 60 fps, from ~5 rad/s = 2 kt) the blocks would strobe; the eye sees a smooth grey band instead.
    let spin = 0;
    for (const w of wheels) spin = Math.max(spin, Math.abs(w.spinRate));
    const blur = Math.min(1, Math.max(0, (spin - 5) / 15));
    this.tyreMat.bumpScale = this.treadBump * (1 - blur * blur * (3 - 2 * blur));
  }
}

/** Spring leg: from the airframe root to the axle fitting (over the tyre at the nose), bending with compression. */
function legSpec(side: Place, wheel: WheelVisualDef, compression: () => number): GridSpec {
  const leg = wheel.leg as SpringLegDef;
  const root = frd(leg.root[0], leg.root[1], leg.root[2]);
  const contact = wheel.contact;
  const end0 =
    side === 0
      ? frd(contact[0], contact[1], contact[2] - 2 * wheel.radius - 0.035)
      : frd(contact[0], contact[1] - side * springAxleOffset(wheel), contact[2] - wheel.radius);
  const spec = sweepGeometry(
    (t, out) => {
      // Cantilever deflection under a tip load: w(s) = w_tip * s^2 (3 - s) / 2.
      out.lerpVectors(root, end0, t);
      out.y += compression() * t * t * (3 - t) * 0.5;
    },
    leg.kind === 'springTube'
      ? (t, a, out) => {
          const r = leg.r0 - (leg.r0 - leg.r1) * t;
          out.set(Math.cos(a) * r, Math.sin(a) * r);
        }
      : (t, a, out) => {
          // A flat leaf with rounded edges, narrowing a little toward the axle: thin across (the sweep's
          // side axis), `width` along the aircraft (its up axis, which is forward).
          const c = Math.cos(a);
          const s = Math.sin(a);
          out.set(Math.sign(c) * Math.pow(Math.abs(c), 0.3) * 0.5 * leg.thickness, Math.sign(s) * Math.pow(Math.abs(s), 0.3) * 0.5 * leg.width * (1 - 0.3 * t));
        },
    14,
    16,
    new THREE.Vector3(0, 0, -1),
  );
  return spec;
}
