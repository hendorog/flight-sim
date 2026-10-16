// MD 500E main and tail rotor heads. RFM 1-10: five fully articulated blades held by a laminated stainless-steel
// "V" strap pack (each blade's straps run to the two opposite blades and carry the centrifugal load; the straps
// flex for flap and feather), elastomeric lead-lag dampers (500D onward), a STATIC mast carrying the lift with the
// drive shaft inside it; 2-blade teetering tail rotor on the left of the boom. Hinge offsets come ONLY from
// dimensions.ts (flap = lag = 0.140 m, the 500C value, F / ESTIMATE). Hardware proportions are visual ESTIMATES
// from the photographs (docs/md500-exterior.md): no dimensioned 369D/E hub drawing was obtained.
import * as THREE from 'three';
import type { SimContext } from '../../core/context';
import type { RotorcraftDefinition } from '../../physics/rotorcraft/definition';
import type { TeeteringRotor } from '../../render/aircraft/rotorcraft/rotor';
import type { FRD, RotorcraftVisualDef } from '../../render/aircraft/airframe/types';
import { frd, MeshBatch } from '../../render/aircraft/geometry';
import { bladeBlur } from '../../render/aircraft/bladeBlur';
import { setRotorBladeThickness } from '../../render/aircraft/rotorcraft/rotor';
import { articulatedBladeConing } from '../../physics/rotorcraft/coning';
import { quat } from '../../core/math';
import { box, tube } from '../../render/aircraft/rotorcraft/geometry';
import { FLAP_HINGE_OFFSET as F, LAG_HINGE_OFFSET as L, MAIN_ROTOR_BLADES, MAIN_HUB, HUB_FAIRING_TOP_Z } from './dimensions';
import { ellipsoid, fitRod, type MD500Materials } from './exteriorGeometry';

/** Renderer adapter for the published articulated pose (RotorcraftState.articulated): per blade b, in the order
 * of azimuth + b 2 pi / 5, total flap (incl. coning, + tip up), lag (+ about model +Y) and feathering pitch, rad. */
export interface MD500RotorPose { blades: readonly { flap: number; lag: number; pitch?: number }[] }

/** NACA 0015 main blade (Heffley p34, CR-166256 p5; F / ESTIMATE); NACA 0012 stand-in kept for the tail. */
export const MD500_MAIN_SECTION = 0.15;
/** Swashplate centre below the hub, m (3V: just above the mast fairing top WL 77). */
export const SWASHPLATE_DROP = 0.105;
/** Dome (hub fairing) top above the hub centre: RFM Fig 6-3 WL 89.5 - WL 83.0. */
export const DOME_RISE = MAIN_HUB.z - HUB_FAIRING_TOP_Z;

/** A flat bar (strap plate) from a to b in arm-local FRD, width across and thickness along FRD z. */
function strap(a: FRD, b: FRD, width: number, thickness: number): THREE.BufferGeometry {
  const p = frd(...a), q = frd(...b), u = q.clone().sub(p), length = u.length(); u.normalize();
  const up = new THREE.Vector3(0, 1, 0), w = new THREE.Vector3().crossVectors(u, up).normalize();
  const g = new THREE.BoxGeometry(1, 1, 1);
  const m = new THREE.Matrix4().makeBasis(u.multiplyScalar(length), up.multiplyScalar(thickness), w.multiplyScalar(width));
  m.setPosition(p.add(q).multiplyScalar(0.5));
  return g.applyMatrix4(m);
}

export class MD500MainRotor {
  readonly group = new THREE.Group();
  readonly arms: { azimuth: THREE.Group; flap: THREE.Group; lag: THREE.Group; pitch: THREE.Group }[] = [];
  readonly swashplate = new THREE.Group();
  private readonly pitchLinks: THREE.Mesh[] = [];
  private readonly damperBodies: THREE.Mesh[] = [];
  private readonly damperRods: THREE.Mesh[] = [];
  private readonly matrix = new THREE.Matrix4();
  private readonly transform = new THREE.Matrix4();
  private readonly inverse = new THREE.Matrix4();
  private readonly inverseSpin = new THREE.Quaternion();
  private readonly a = new THREE.Vector3();
  private readonly b = new THREE.Vector3();
  private readonly c = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly tilt = new THREE.Vector3();
  private blurCone = NaN;

  constructor(private readonly rotor: TeeteringRotor, private readonly spec: RotorcraftVisualDef['main'],
    private readonly definition: RotorcraftDefinition, m: MD500Materials) {
    for (const child of rotor.spin.children) if (child !== rotor.blades && child !== rotor.trail.mesh) child.visible = false;
    rotor.swashplate.visible = false;
    this.group.name = 'md500ArticulatedHead'; rotor.spin.add(this.group);
    setRotorBladeThickness(rotor.blades.geometry, spec, MD500_MAIN_SECTION, 1);
    const n = MAIN_ROTOR_BLADES;
    // Rotating hub: drive plate on the inner shaft, the V-strap pack (a five-pointed star of laminated plates
    // joining each blade root to the two opposite roots), the flattened dome cap over the head.
    const hub = new MeshBatch();
    hub.add(m.cast, tube([0, 0, 0.055], [0, 0, -0.035], 0.088, 0.088, 30));
    hub.add(m.metal, tube([0, 0, 0.10], [0, 0, 0.05], 0.05, 0.05, 20));
    const root = (k: number, r: number, z: number): FRD => [r * Math.sin(k * 2 * Math.PI / n), r * Math.cos(k * 2 * Math.PI / n), z];
    for (let k = 0; k < n; k++) for (const z of [-0.016, -0.005, 0.006, 0.017])
      hub.add(m.metal, strap(root(k, F - 0.005, z), root(k + 2, F - 0.005, z), 0.052, 0.008));
    for (let k = 0; k < n; k++) {
      // Strap-pack end fitting (the "pitch housing" bearing block) at each root.
      hub.add(m.cast, ellipsoid(root(k, F - 0.01, 0), [0.04, 0.04, 0.032], 16, 10));
      for (const s of [-1, 1]) hub.add(m.metal, tube(root(k + s * 0.08, 0.065, -0.03), root(k + s * 0.08, 0.065, 0.035), 0.009, 0.009, 8));
    }
    // Dome: top at the RFM hub-fairing height; a dark lip where it seats on the hub.
    const domeHeight = 0.075;
    hub.add(m.dark, ellipsoid([0, 0, -(DOME_RISE - domeHeight)], [0.205, 0.205, domeHeight], 32, 12));
    hub.add(m.cast, tube([0, 0, -0.02], [0, 0, -(DOME_RISE - domeHeight) + 0.005], 0.17, 0.2, 32));
    this.group.add(hub.build('md500HubAndStrapPack'));
    // Swashplate (non-rotating frame): stationary and rotating rings over a spherical slider on the static mast.
    const swash = new MeshBatch();
    for (const [r, dz] of [[0.125, 0.012], [0.118, -0.016]] as const) {
      const ring = new THREE.TorusGeometry(r, 0.014, 10, 48); ring.rotateX(Math.PI / 2); ring.translate(0, dz, 0); swash.add(m.cast, ring);
    }
    swash.add(m.metal, tube([0, 0, -0.04], [0, 0, 0.04], 0.062, 0.062, 24));
    this.swashplate.add(swash.build('md500SwashplateRings')); this.swashplate.position.y = -SWASHPLATE_DROP;
    this.swashplate.name = 'md500Swashplate'; rotor.group.add(this.swashplate);
    // Rotating scissors from the drive plate to the upper swashplate ring.
    const scissors = new MeshBatch();
    scissors.add(m.cast, tube([-0.05, 0.03, 0.03], [-0.10, 0.03, 0.065], 0.009));
    scissors.add(m.cast, tube([-0.10, 0.03, 0.065], [-0.11, 0.03, SWASHPLATE_DROP - 0.015], 0.009));
    scissors.add(m.metal, tube([-0.10, 0.012, 0.065], [-0.10, 0.048, 0.065], 0.011));
    this.group.add(scissors.build('md500SwashplateScissors'));
    const rod = (name: string, radius: number, material: THREE.Material) => {
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 1, 10), material);
      mesh.name = name; mesh.castShadow = true; this.group.add(mesh); return mesh;
    };
    for (let i = 0; i < n; i++) {
      const azimuth = new THREE.Group(); azimuth.name = `md500Blade${i}`; azimuth.rotation.y = i * 2 * Math.PI / n;
      const flap = new THREE.Group(); flap.name = 'md500FlapHinge'; flap.position.x = F;
      const lag = new THREE.Group(); lag.name = 'md500LagHinge'; lag.position.x = L - F;
      const pitch = new THREE.Group(); pitch.name = 'md500PitchHousing';
      this.group.add(azimuth); azimuth.add(flap); flap.add(lag); lag.add(pitch);
      this.arms.push({ azimuth, flap, lag, pitch });
      // Pitch housing (tapered barrel over the strap ends) to the blade-root fitting and its two quick-release pins.
      const housing = new MeshBatch(), lagArm = new MeshBatch();
      const rootR = spec.root - L;
      housing.add(m.cast, tube([0, 0.0, 0], [0, rootR - 0.06, 0], 0.044, 0.034, 20));
      housing.add(m.metal, tube([0, -0.01, 0], [0, 0.012, 0], 0.048, 0.048, 20));
      housing.add(m.cast, box([0, rootR - 0.02, 0], [0.12, 0.10, 0.034], 0.008));
      for (const y of [rootR - 0.05, rootR + 0.005]) housing.add(m.metal, tube([0, y, -0.026], [0, y, 0.026], 0.0085, 0.0085, 8));
      // Pitch horn on the leading edge, its ball end below the plane of the strap pack.
      housing.add(m.cast, tube([0.02, 0.05, 0.01], [0.085, 0.07, 0.032], 0.012));
      housing.add(m.metal, ellipsoid([0.085, 0.07, 0.032], [0.014, 0.014, 0.014], 12, 8));
      // Elastomeric damper drive lug on the trailing side; moves with lag, not with feathering.
      lagArm.add(m.cast, tube([0, 0.02, 0], [-0.075, 0.085, 0.008], 0.013));
      pitch.add(housing.build('md500PitchHousingParts')); lag.add(lagArm.build('md500LagDamperLug'));
      this.pitchLinks.push(rod('md500PitchLink', 0.0065, m.metal));
      this.damperBodies.push(rod('md500ElastomericLagDamper', 0.024, m.rubber));
      this.damperRods.push(rod('md500LagDamperEnd', 0.010, m.metal));
    }
  }

  update(ctx: SimContext, pose?: MD500RotorPose): void {
    const state = ctx.state.rotorcraft;
    if (!state) return;
    // The static mast does not tilt: flapping happens at each blade's hinge, not by tilting the head.
    this.rotor.group.quaternion.identity();
    const r = this.definition, n = MAIN_ROTOR_BLADES;
    const pitch = THREE.MathUtils.lerp(r.main.minPitch, r.main.maxPitch, ctx.controls.collective ?? 0);
    const omega = state.rotorRpm * Math.PI / 30;
    const normalGravity = quat.rotateInv(ctx.state.orientation, { x: 0, y: 0, z: 9.80665 }).z;
    // Visual swash travel follows the commanded cyclic and collective (rigging estimate).
    this.tilt.set(ctx.controls.aileron * r.cyclicLimit, 1, ctx.controls.elevator * r.cyclicLimit).normalize();
    this.swashplate.quaternion.setFromUnitVectors(this.up, this.tilt);
    this.swashplate.position.y = -SWASHPLATE_DROP + (ctx.controls.collective ?? 0) * 0.03;
    this.swashplate.updateWorldMatrix(true, false);
    this.group.updateWorldMatrix(true, true); this.inverse.copy(this.group.matrixWorld).invert();
    let meanFlap = 0, forwardFlap = 0, rightFlap = 0, meanPitch = 0;
    for (let i = 0; i < n; i++) {
      const arm = this.arms[i], psi = state.azimuth + i * 2 * Math.PI / n;
      const actual = pose?.blades[i];
      // A published pose already includes the mean (coning): never add it twice.
      const flap = actual && Number.isFinite(actual.flap) ? actual.flap
        : articulatedBladeConing(this.spec.coning, omega, state.thrust / n,
          -state.flapForward * Math.sin(psi) - state.flapRight * Math.cos(psi), normalGravity).angle;
      arm.flap.rotation.z = flap;
      meanFlap += flap / n;
      forwardFlap += 2 * flap * Math.sin(psi) / n;
      rightFlap += 2 * flap * Math.cos(psi) / n;
      arm.lag.rotation.y = actual && Number.isFinite(actual.lag) ? actual.lag : 0;
      arm.pitch.rotation.x = actual?.pitch !== undefined && Number.isFinite(actual.pitch) ? actual.pitch : pitch;
      meanPitch += arm.pitch.rotation.x / n;
      arm.azimuth.updateMatrixWorld(true);
      this.transform.multiplyMatrices(this.inverse, arm.pitch.matrixWorld).multiply(this.matrix.makeTranslation(-L, 0, 0));
      this.rotor.blades.setMatrixAt(i, this.transform);
      // Pitch link: swashplate rotating ring (non-rotating frame, at this blade's azimuth) to the pitch-horn ball.
      this.a.set(0.118, 0, -0.075).applyAxisAngle(this.up, psi).applyMatrix4(this.swashplate.matrixWorld).applyMatrix4(this.inverse);
      this.b.set(0.07, -0.032, -0.085).applyMatrix4(arm.pitch.matrixWorld).applyMatrix4(this.inverse);
      fitRod(this.pitchLinks[i], this.a, this.b);
      // Damper from the hub (fixed in the azimuth frame) to the lag lug.
      this.a.set(0.03, -0.004, 0.10).applyMatrix4(arm.azimuth.matrixWorld).applyMatrix4(this.inverse);
      this.b.set(0.085, -0.008, 0.075).applyMatrix4(arm.lag.matrixWorld).applyMatrix4(this.inverse);
      this.c.copy(this.a).lerp(this.b, 0.7); fitRod(this.damperBodies[i], this.a, this.c); fitRod(this.damperRods[i], this.c, this.b);
    }
    this.rotor.blades.instanceMatrix.needsUpdate = true;
    // The exposure disc and the trail use the same blade solution (mean coning about the hinge, first harmonic tilt).
    const p = this.rotor.blur.geometry.getAttribute('position');
    const firstY = (this.spec.root - F) * Math.sin(meanFlap);
    if (meanFlap !== this.blurCone || Math.abs(p.getY(0) - firstY) > 1e-7) {
      for (let i = 0; i < p.count; i++) {
        const x = this.rotor.discPositions[3 * i], z = this.rotor.discPositions[3 * i + 2], radius = Math.hypot(x, z);
        const projected = F + (radius - F) * Math.cos(meanFlap);
        p.setXYZ(i, x * projected / radius, (radius - F) * Math.sin(meanFlap), z * projected / radius);
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
    this.rotor.trail.update(bladeBlur(state.rotorRpm, n), meanPitch, meanFlap, F);
  }
}

/** Two-blade teetering tail rotor: yoke on a teeter bolt, blade grips, the pitch-change crosshead outboard. */
export function buildMD500TailHead(rotor: TeeteringRotor, m: MD500Materials): () => void {
  for (const child of rotor.spin.children) if (child !== rotor.blades && child !== rotor.trail.mesh) child.visible = false;
  // In the tail rotor's spin frame, three.js Y is the rotor shaft pointing outboard (to the left of the boom).
  const head = new MeshBatch();
  head.add(m.cast, box([0, 0, 0], [0.06, 0.16, 0.05], 0.010));
  head.add(m.metal, tube([0.04, 0, 0], [-0.04, 0, 0], 0.012, 0.012, 10));
  const crosshead = new THREE.CylinderGeometry(0.026, 0.026, 0.05, 16).translate(0, 0.05, 0);
  head.add(m.cast, crosshead);
  head.add(m.metal, new THREE.CylinderGeometry(0.008, 0.008, 0.06, 8).translate(0, 0.095, 0));
  for (const s of [-1, 1]) head.add(m.metal, tube([0, s * 0.022, -0.05], [0.03, s * 0.075, -0.012], 0.005));
  rotor.spin.add(head.build('md500TailHub'));
  const cuffs: THREE.Group[] = [];
  for (let i = 0; i < 2; i++) {
    const c = new THREE.Group(); c.name = 'md500TailGrip'; c.matrixAutoUpdate = false;
    const b = new MeshBatch(); b.add(m.cast, box([0, 0.105, 0], [0.06, 0.075, 0.026], 0.006));
    b.add(m.metal, tube([-0.036, 0.105, 0], [0.036, 0.105, 0], 0.009, 0.009, 6));
    b.add(m.cast, tube([0.03, 0.085, 0], [0.05, 0.085, -0.03], 0.006));
    c.add(b.build('md500TailGripFittings')); rotor.spin.add(c); cuffs.push(c);
  }
  const matrix = new THREE.Matrix4();
  return () => cuffs.forEach((c, i) => { rotor.blades.getMatrixAt(i, matrix); c.matrix.copy(matrix); });
}
