// MBB Bo 105 CB-4 main and tail rotor heads. The main rotor is HINGELESS (P TCDS p8: "hingeless four-bladed main
// rotor, blades made of fibreglass reinforced plastics"): a forged titanium hub star carrying four feathering-bearing
// housings, the blades bolted into forks at their ends, pitch horns on the leading side with pitch links down to the
// swashplate, and NO flap or lag hinge. The blades flap by bending their glass-fibre roots: each blade is drawn bent
// over 0.1 R starting at the equivalent hinge offset (the hub model's, else dimensions.ts 0.12 R), with its outboard
// part straight at the published flap angle (RotorcraftState.articulated.blades[i].flap). The swashplate tilt comes
// from swashplateCyclic() (the one swashplate law, src/physics/rotorcraft/swashplate.ts), never from the stick alone.
// Hardware proportions are ESTIMATES from the 0570b rotor-head photograph and the Flying Bulls / D-HILF photographs
// (docs/bo105-exterior.md); no dimensioned hub drawing was obtained.
import * as THREE from 'three';
import type { SimContext } from '../../core/context';
import type { RotorcraftDefinition, RotorcraftState } from '../../physics/rotorcraft/definition';
import type { TeeteringRotor } from '../../render/aircraft/rotorcraft/rotor';
import type { FRD, RotorcraftVisualDef } from '../../render/aircraft/airframe/types';
import { MeshBatch } from '../../render/aircraft/geometry';
import { bladeBlur } from '../../render/aircraft/bladeBlur';
import { articulatedBladeConing } from '../../physics/rotorcraft/coning';
import { swashplateCyclic } from '../../physics/rotorcraft/swashplate';
import { clamp, quat } from '../../core/math';
import { box, tube } from '../../render/aircraft/rotorcraft/geometry';
import * as D from './dimensions';
import { BendingNeck, bentAxis, ellipsoid, fitRod, outboardBladeMatrix, virtualHinge, type BladeBend, type Bo105Materials } from './exteriorGeometry';

/** Length of the bend region of the blade root: 0.1 R (plan revision 2, section 6.3). */
export const BEND_LENGTH = 0.1 * D.MAIN_ROTOR_RADIUS;
/** Hub cap top above the hub centre: dimensions.ts puts the hub 0.10 m under the 3.00 m head top (P TCDS p8). */
export const HUB_TOP = D.HEIGHT_TO_HEAD - D.HUB_HEIGHT;
/** Hub hardware radii, m (photograph 0570b scaled by the 0.27 m chord). ESTIMATE */
export const HUB = { star: 0.115, housingStart: 0.16, housingEnd: 0.40, housingRadius: 0.062, forkStart: 0.38, forkEnd: 0.54 } as const;
/** Swashplate centre below the hub centre, m; rotating-ring radius. ESTIMATE (photographs). */
export const SWASHPLATE_DROP = 0.27;
export const SWASH_RING = 0.165;
/** Pitch-horn ball in the pitch-housing frame (local +X out along the blade, -Z the leading edge, +Y up). ESTIMATE */
export const HORN_BALL = new THREE.Vector3(0.30, -0.075, -0.125);
/** Forward tilt of the drawn shaft, rad: the definition's shaftTilt when declared, else dimensions.ts 3 deg (P5 FM
 *  Fig 1-1; P AR-280). The whole head (hub, blades, disc, swashplate) turns with it; the mast parts in exteriorDetails
 *  sit on the same axis. */
export function shaftTilt(def: RotorcraftDefinition): number { return def.shaftTilt ?? D.SHAFT_TILT; }
/** NACA 23012 Type 1 blade (P MM ch 14): thickness 12 % of the 0.27 m chord, as the shared blade grid. */
export const MAIN_SECTION_THICKNESS = 0.12;

/** The equivalent flap hinge offset the blades bend from, m: the hingeless hub model's when declared, else the
 *  dimensions.ts 0.12 R (P BK117-ERF7 "12 %, zero spring"). */
export function equivalentOffset(def: RotorcraftDefinition): number {
  const h = def.hubModel;
  return h?.kind === 'hingeless' ? h.equivalentHingeOffset : D.EQUIVALENT_HINGE_OFFSET_FRACTION * D.MAIN_ROTOR_RADIUS;
}

/** Renderer adapter for the published per-blade pose: total flap (incl. coning, + tip up) and feathering, rad. */
export interface Bo105RotorPose { blades: readonly { flap: number; lag?: number; pitch?: number }[] }

export class Bo105MainRotor {
  readonly group = new THREE.Group();
  readonly arms: { azimuth: THREE.Group; pitch: THREE.Group; neck: THREE.Mesh }[] = [];
  readonly necks: BendingNeck[] = [];
  readonly swashplate = new THREE.Group();
  readonly bend: BladeBend;
  /** Last posed flap and pitch per blade (rad), for tests and the disc. */
  readonly flaps: number[] = [];
  readonly pitches: number[] = [];
  private readonly pitchLinks: THREE.Mesh[] = [];
  private readonly matrix = new THREE.Matrix4();
  private readonly arm = new THREE.Matrix4();
  private readonly inverse = new THREE.Matrix4();
  private readonly inverseSpin = new THREE.Quaternion();
  private readonly a = new THREE.Vector3();
  private readonly b = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly tilt = new THREE.Vector3();
  private readonly axis: [number, number, number] = [0, 0, 0];
  private readonly mast = new THREE.Quaternion();
  private blurCone = NaN;

  constructor(private readonly rotor: TeeteringRotor, private readonly spec: RotorcraftVisualDef['main'],
    private readonly definition: RotorcraftDefinition, m: Bo105Materials) {
    for (const child of rotor.spin.children) if (child !== rotor.blades && child !== rotor.trail.mesh) child.visible = false;
    rotor.swashplate.visible = false;
    this.group.name = 'bo105HingelessHead'; rotor.spin.add(this.group);
    this.bend = { e: equivalentOffset(definition), length: BEND_LENGTH };
    // Top forward: +Y (up) turned about +X (right) by -tilt leans towards -Z (forward).
    this.mast.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -shaftTilt(definition));
    const n = definition.main.blades;
    // Rotating hub: the titanium star (a flat centre body with four short arms to the housing flanges), the cap on
    // top at the 3.00 m head height, the drive flange underneath.
    const hub = new MeshBatch();
    // FRD inside the spin frame: z down; arm k points along (sin a, cos a, 0) (three.js +X turned by a about +Y).
    hub.add(m.titanium, tube([0, 0, -0.055], [0, 0, 0.06], HUB.star, HUB.star, 32));
    hub.add(m.titanium, tube([0, 0, -0.085], [0, 0, -0.055], 0.07, 0.095, 28));
    hub.add(m.cast, tube([0, 0, -HUB_TOP], [0, 0, -0.085], 0.045, 0.06, 24));
    hub.add(m.metal, tube([0, 0, 0.06], [0, 0, 0.11], 0.07, 0.07, 24));
    for (let k = 0; k < n; k++) {
      const a = k * 2 * Math.PI / n, dir = (r: number, z = 0): FRD => [r * Math.sin(a), r * Math.cos(a), z];
      hub.add(m.titanium, tube(dir(0.05), dir(HUB.housingStart + 0.01), 0.075, 0.07, 20));
      hub.add(m.titanium, tube(dir(HUB.housingStart - 0.005), dir(HUB.housingStart + 0.012), 0.085, 0.085, 20));
      // Flange bolts round the housing joint.
      const p = dir(HUB.housingStart + 0.016);
      for (let j = 0; j < 6; j++) {
        const t = j / 6 * Math.PI * 2, side = 0.072 * Math.cos(t), down = 0.072 * Math.sin(t);
        hub.add(m.metal, ellipsoid([p[0] + side * Math.cos(a), p[1] - side * Math.sin(a), down], [0.009, 0.009, 0.009], 8, 6));
      }
    }
    this.group.add(hub.build('bo105HubStar'));
    // Swashplate (non-rotating frame, tilted from swashplateCyclic): rotating and stationary rings on a sliding ball.
    const swash = new MeshBatch();
    for (const [r, dy, mat] of [[SWASH_RING, 0.014, m.housing], [SWASH_RING + 0.012, -0.022, m.cast]] as const) {
      const ring = new THREE.TorusGeometry(r, 0.018, 10, 48); ring.rotateX(Math.PI / 2); ring.translate(0, dy, 0); swash.add(mat, ring);
    }
    swash.add(m.housing, new THREE.CylinderGeometry(SWASH_RING - 0.01, SWASH_RING - 0.01, 0.03, 40).translate(0, 0.012, 0));
    swash.add(m.metal, new THREE.SphereGeometry(0.075, 20, 12).scale(1, 0.7, 1));
    // Stationary control-rod lugs (three, the servo rods below them are in exteriorDetails).
    for (let i = 0; i < 3; i++) {
      const a = i * Math.PI * 2 / 3 + 0.5;
      swash.add(m.cast, new THREE.BoxGeometry(0.04, 0.05, 0.04).translate(Math.cos(a) * (SWASH_RING + 0.03), -0.04, Math.sin(a) * (SWASH_RING + 0.03)));
    }
    this.swashplate.add(swash.build('bo105SwashplateRings')); this.swashplate.position.y = -SWASHPLATE_DROP;
    this.swashplate.name = 'bo105Swashplate'; rotor.group.add(this.swashplate);
    // Rotating scissors from the hub's drive flange to the rotating ring.
    const scissors = new MeshBatch();
    scissors.add(m.cast, tube([-0.06, 0.04, HUB_TOP - 0.02], [-0.13, 0.05, 0.17], 0.011));
    scissors.add(m.cast, tube([-0.13, 0.05, 0.17], [-0.15, 0.05, SWASHPLATE_DROP - 0.03], 0.011));
    scissors.add(m.metal, tube([-0.13, 0.03, 0.17], [-0.13, 0.07, 0.17], 0.013));
    this.group.add(scissors.build('bo105SwashplateScissors'));
    const rootTwist = this.spec.twist * (0 - 0.75);
    for (let i = 0; i < n; i++) {
      const azimuth = new THREE.Group(); azimuth.name = `bo105Blade${i}`; azimuth.rotation.y = i * 2 * Math.PI / n;
      const pitch = new THREE.Group(); pitch.name = 'bo105FeatheringHousing';
      this.group.add(azimuth); azimuth.add(pitch);
      // Feathering-bearing housing (black tube, collar), the fork at its end with its two blade bolts, the pitch horn
      // with its ball end below the leading edge, and the pair of balance weights under the fork (photograph).
      const housing = new MeshBatch();
      housing.add(m.housing, new THREE.CylinderGeometry(HUB.housingRadius, HUB.housingRadius * 1.08, HUB.housingEnd - HUB.housingStart, 24)
        .rotateZ(-Math.PI / 2).translate((HUB.housingStart + HUB.housingEnd) / 2, 0, 0));
      housing.add(m.metal, new THREE.CylinderGeometry(HUB.housingRadius + 0.008, HUB.housingRadius + 0.008, 0.02, 24)
        .rotateZ(-Math.PI / 2).translate(HUB.housingEnd - 0.03, 0, 0));
      const forkLength = HUB.forkEnd - HUB.forkStart, forkMid = (HUB.forkStart + HUB.forkEnd) / 2;
      for (const y of [-0.045, 0.045]) housing.add(m.fork, new THREE.BoxGeometry(forkLength, 0.022, 0.12).translate(forkMid, y, 0));
      housing.add(m.fork, new THREE.BoxGeometry(0.05, 0.11, 0.13).translate(HUB.forkStart + 0.02, 0, 0));
      for (const x of [HUB.forkStart + 0.065, HUB.forkEnd - 0.03]) {
        housing.add(m.metal, new THREE.CylinderGeometry(0.014, 0.014, 0.13, 10).translate(x, 0, 0));
        for (const y of [-0.068, 0.068]) housing.add(m.metal, new THREE.CylinderGeometry(0.02, 0.02, 0.012, 6).translate(x, y, 0));
      }
      housing.add(m.cast, new THREE.BoxGeometry(0.06, 0.03, 0.10).translate(HORN_BALL.x, -0.035, -0.065));
      housing.add(m.cast, new THREE.BoxGeometry(0.035, 0.05, 0.03).translate(HORN_BALL.x, HORN_BALL.y + 0.025, HORN_BALL.z));
      housing.add(m.metal, new THREE.SphereGeometry(0.013, 10, 8).translate(HORN_BALL.x, HORN_BALL.y, HORN_BALL.z));
      for (const z of [0.05, 0.10]) {
        housing.add(m.cast, new THREE.CylinderGeometry(0.007, 0.007, 0.10, 8).translate(HUB.forkStart + 0.04, -0.09, z));
        housing.add(m.grey, new THREE.SphereGeometry(0.03, 14, 10).translate(HUB.forkStart + 0.04, -0.14, z));
      }
      pitch.add(housing.build('bo105HousingAndFork'));
      // The bending glass-fibre root, from inside the fork into the aerofoil root (it overlaps the blade by 2 cm).
      const neck = new BendingNeck(HUB.forkStart + 0.02, Math.max(spec.root, this.bend.e + this.bend.length) + 0.02,
        { chord: spec.chord[0], thickness: spec.chord[0] * MAIN_SECTION_THICKNESS, twist: rootTwist });
      const neckMesh = new THREE.Mesh(neck.geometry, m.blade); neckMesh.name = 'bo105BladeRoot'; neckMesh.castShadow = true;
      azimuth.add(neckMesh);
      this.arms.push({ azimuth, pitch, neck: neckMesh }); this.necks.push(neck);
      const link = new THREE.Mesh(new THREE.CylinderGeometry(0.0085, 0.0085, 1, 10), m.grey);
      link.name = 'bo105PitchLink'; link.castShadow = true; this.group.add(link); this.pitchLinks.push(link);
      this.flaps.push(0); this.pitches.push(0);
    }
  }

  update(ctx: SimContext, state?: RotorcraftState): void {
    const s = state ?? ctx.state.rotorcraft;
    if (!s) return;
    // The head stands on the forward-tilted shaft and does not tilt further: flapping is each blade's own root bending.
    this.rotor.group.quaternion.copy(this.mast);
    const d = this.definition, n = d.main.blades, c = ctx.controls;
    const collective = clamp(c.collective ?? 0, 0, 1);
    const theta0 = THREE.MathUtils.lerp(d.main.minPitch, d.main.maxPitch, collective);
    // The one swashplate law: the stick law rotated by the hingeless control phase (or the gyro's cyclic).
    const cyclic = swashplateCyclic(d, c, s);
    this.tilt.set(Math.tan(cyclic.right), 1, Math.tan(cyclic.aft)).normalize();
    this.swashplate.quaternion.setFromUnitVectors(this.up, this.tilt);
    this.swashplate.position.y = -SWASHPLATE_DROP + collective * 0.04;
    this.swashplate.updateWorldMatrix(true, false);
    this.group.updateWorldMatrix(true, false); this.inverse.copy(this.group.matrixWorld).invert();
    const omega = s.rotorRpm * Math.PI / 30;
    const normalGravity = quat.rotateInv(ctx.state.orientation, { x: 0, y: 0, z: 9.80665 }).z;
    const pose = s.articulated;
    let meanFlap = 0, forwardFlap = 0, rightFlap = 0, meanPitch = 0;
    for (let i = 0; i < n; i++) {
      const arm = this.arms[i], psi = s.azimuth + i * 2 * Math.PI / n, actual = pose?.blades[i];
      // A published pose already includes the mean (coning): never add it twice.
      const flap = actual && Number.isFinite(actual.flap) ? actual.flap
        : articulatedBladeConing(this.spec.coning, omega, s.thrust / n,
          -s.flapForward * Math.sin(psi) - s.flapRight * Math.cos(psi), normalGravity).angle;
      const pitch = actual && Number.isFinite(actual.pitch) ? actual.pitch
        : theta0 + d.rotation * (cyclic.right * Math.sin(psi) + cyclic.aft * Math.cos(psi));
      this.flaps[i] = flap; this.pitches[i] = pitch;
      meanFlap += flap / n; forwardFlap += 2 * flap * Math.sin(psi) / n; rightFlap += 2 * flap * Math.cos(psi) / n;
      meanPitch += pitch / n;
      arm.pitch.rotation.x = pitch;
      this.necks[i].pose(flap, pitch, this.bend);
      outboardBladeMatrix(flap, pitch, this.bend, this.matrix);
      this.rotor.blades.setMatrixAt(i, this.matrix.premultiply(this.arm.makeRotationY(i * 2 * Math.PI / n)));
      // Pitch link: rotating swashplate ring (at the horn's azimuth) to the pitch-horn ball.
      arm.azimuth.updateMatrixWorld(true);
      const hornAzimuth = psi + Math.atan2(-HORN_BALL.z, HORN_BALL.x);
      this.a.set(SWASH_RING, 0.014, 0).applyAxisAngle(this.up, hornAzimuth).applyMatrix4(this.swashplate.matrixWorld).applyMatrix4(this.inverse);
      this.b.copy(HORN_BALL).applyMatrix4(arm.pitch.matrixWorld).applyMatrix4(this.inverse);
      fitRod(this.pitchLinks[i], this.a, this.b);
    }
    this.rotor.blades.instanceMatrix.needsUpdate = true;
    // The exposure disc and the trail use the same bent-blade solution (mean flap, first-harmonic tilt).
    const bend = this.bend, p = this.rotor.blur.geometry.getAttribute('position');
    if (meanFlap !== this.blurCone) {
      for (let i = 0; i < p.count; i++) {
        const x = this.rotor.discPositions[3 * i], z = this.rotor.discPositions[3 * i + 2], radius = Math.hypot(x, z);
        bentAxis(radius, meanFlap, bend, this.axis);
        p.setXYZ(i, x * this.axis[0] / radius, this.axis[1], z * this.axis[0] / radius);
      }
      p.needsUpdate = true; this.rotor.blur.geometry.computeVertexNormals(); this.rotor.blur.geometry.computeBoundingSphere();
      this.blurCone = meanFlap;
    }
    this.tilt.set(-Math.tan(rightFlap), 1, Math.tan(forwardFlap)).normalize();
    this.rotor.blur.quaternion.setFromUnitVectors(this.up, this.tilt);
    // The trail's parent spins, the disc's does not: S * (S^-1 * tilt * S) = tilt * S.
    this.inverseSpin.copy(this.rotor.spin.quaternion).invert();
    const trail = this.rotor.trail.mesh;
    trail.quaternion.copy(this.inverseSpin).multiply(this.rotor.blur.quaternion).multiply(this.rotor.spin.quaternion);
    trail.position.set(0, 0, 0);
    this.rotor.trail.update(bladeBlur(s.rotorRpm, n), meanPitch, meanFlap, virtualHinge(meanFlap, bend));
  }

  dispose(): void { for (const neck of this.necks) neck.geometry.dispose(); }
}

/** Two-blade teetering tail rotor on the LEFT of the fin top: yoke on its teeter bolt, the pitch-change crosshead
 *  outboard, blade grips that follow the blades. ESTIMATE proportions (photographs). */
export function buildBo105TailHead(rotor: TeeteringRotor, m: Bo105Materials): () => void {
  for (const child of rotor.spin.children) if (child !== rotor.blades && child !== rotor.trail.mesh) child.visible = false;
  // In the tail rotor's spin frame, three.js Y is the rotor shaft pointing outboard (to the left of the fin).
  const head = new MeshBatch();
  head.add(m.cast, box([0, 0, 0], [0.065, 0.20, 0.05], 0.010));
  head.add(m.metal, tube([0.045, 0, 0], [-0.045, 0, 0], 0.013, 0.013, 10));
  head.add(m.cast, new THREE.CylinderGeometry(0.028, 0.028, 0.05, 16).translate(0, 0.05, 0));
  head.add(m.metal, new THREE.CylinderGeometry(0.009, 0.009, 0.06, 8).translate(0, 0.095, 0));
  for (const s of [-1, 1]) head.add(m.metal, tube([0, s * 0.024, -0.05], [0.03, s * 0.085, -0.012], 0.0055));
  rotor.spin.add(head.build('bo105TailHub'));
  const grips: THREE.Group[] = [];
  for (let i = 0; i < 2; i++) {
    const g = new THREE.Group(); g.name = 'bo105TailGrip'; g.matrixAutoUpdate = false;
    const b = new MeshBatch(); b.add(m.cast, box([0, 0.12, 0], [0.06, 0.08, 0.028], 0.006));
    b.add(m.metal, tube([-0.036, 0.12, 0], [0.036, 0.12, 0], 0.009, 0.009, 6));
    b.add(m.cast, tube([0.03, 0.095, 0], [0.05, 0.095, -0.03], 0.006));
    g.add(b.build('bo105TailGripFittings')); rotor.spin.add(g); grips.push(g);
  }
  const matrix = new THREE.Matrix4();
  return () => grips.forEach((g, i) => { rotor.blades.getMatrixAt(i, matrix); g.matrix.copy(matrix); });
}
