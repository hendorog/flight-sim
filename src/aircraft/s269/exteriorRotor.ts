// Three mechanical flap/lag hinges, feathering grips and elastomeric lag dampers (FAA 4H12 Note 9b).
// Offsets come ONLY from dimensions.ts. Hardware proportions and hinge sequence remain estimates:
// no dimensioned CB HMI head drawing was obtained. This is not a hingeless/elastomeric hub.
import * as THREE from 'three';
import type { SimContext } from '../../core/context';
import type { RotorcraftDefinition } from '../../physics/rotorcraft/definition';
import type { TeeteringRotor } from '../../render/aircraft/rotorcraft/rotor';
import type { RotorcraftVisualDef } from '../../render/aircraft/airframe/types';
import { MeshBatch } from '../../render/aircraft/geometry';
import { box, tube } from '../../render/aircraft/rotorcraft/geometry';
import { FLAP_HINGE_OFFSET as F, LAG_HINGE_OFFSET as L, MAIN_ROTOR_BLADES } from './dimensions';
import { ellipsoid, fitRod, type S269Materials } from './exteriorGeometry';

/** Renderer adapter, not an extension/reinterpretation of RotorcraftState. All angles radians.
 * Supply total per-blade flap (including coning), lag and optional pitch at .75R, in blade order
 * b at azimuth + b*2π/3. Positive flap raises the tip; positive lag rotates about model +Y.
 * The supervisor should adapt the flight worker's final state into this shape at assembly time. */
export interface S269RotorPose { blades: readonly { flap: number; lag: number; pitch?: number }[] }
export type S269RotorPoseReader = (ctx: SimContext) => S269RotorPose | undefined;

/** Shared grids use NACA 0012. Change only normal thickness in each UNTWISTED section, retaining
 * published chord/twist, topology, paint and caps. Tail 0014 is a stand-in for the unspecified modification. */
export function setS269Section(g: THREE.BufferGeometry, spec: { root: number; radius: number; twist: number }, thickness: number, rotation: number): void {
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const beta = spec.twist * ((p.getX(i) - spec.root) / (spec.radius - spec.root) - 0.75);
    const y = p.getY(i), z = p.getZ(i) * rotation, s = Math.sin(beta), c = Math.cos(beta);
    const along = y * s - z * c, thick = (y * c + z * s) * thickness / 0.12;
    p.setY(i, along * s + thick * c); p.setZ(i, (-along * c + thick * s) * rotation);
  }
  p.needsUpdate = true; g.computeVertexNormals(); g.computeBoundingSphere();
}

export class S269MainRotor {
  readonly group = new THREE.Group();
  readonly arms: { azimuth: THREE.Group; flap: THREE.Group; lag: THREE.Group; pitch: THREE.Group }[] = [];
  readonly swashplate = new THREE.Group();
  private readonly pitchLinks: THREE.Mesh[] = [];
  private readonly damperBodies: THREE.Mesh[] = [];
  private readonly damperRods: THREE.Mesh[] = [];
  private readonly matrix = new THREE.Matrix4();
  private readonly transform = new THREE.Matrix4();
  private readonly inverse = new THREE.Matrix4();
  private readonly a = new THREE.Vector3();
  private readonly b = new THREE.Vector3();
  private readonly c = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly tilt = new THREE.Vector3();
  private blurCone = NaN;

  constructor(private readonly rotor: TeeteringRotor, private readonly spec: RotorcraftVisualDef['main'],
    private readonly definition: RotorcraftDefinition, m: S269Materials) {
    for (const child of rotor.spin.children) if (child !== rotor.blades) child.visible = false;
    rotor.swashplate.visible = false;
    this.group.name = 's269ArticulatedHead'; rotor.spin.add(this.group);
    setS269Section(rotor.blades.geometry, spec, 0.15, 1);
    const hub = new MeshBatch();
    hub.add(m.cast, tube([0, 0, 0.05], [0, 0, -0.025], 0.105, 0.105, 24));
    hub.add(m.metal, tube([0, 0, -0.023], [0, 0, -0.048], 0.036, 0.036, 6));
    hub.add(m.cast, tube([0, 0, 0.03], [0, 0, 0.26], 0.042));
    this.group.add(hub.build('s269HubCentre'));
    const swash = new MeshBatch();
    for (const [r, z] of [[0.135, 0], [0.128, 0.030]]) {
      const ring = new THREE.TorusGeometry(r, 0.013, 10, 48); ring.rotateX(Math.PI / 2); ring.translate(0, -z, 0); swash.add(m.cast, ring);
    }
    swash.add(m.metal, tube([0, 0, -0.025], [0, 0, 0.045], 0.054));
    for (let i = 0; i < 3; i++) {
      const a = i * 2 * Math.PI / 3, x = 0.12 * Math.sin(a), y = 0.12 * Math.cos(a);
      swash.add(m.cast, tube([x * 0.7, y * 0.7, 0.03], [x, y, 0.03], 0.013));
      swash.add(m.metal, ellipsoid([x, y, 0.035], [0.016, 0.016, 0.016]));
    }
    this.swashplate.add(swash.build('s269SwashplateRaces')); this.swashplate.position.y = -0.27;
    this.swashplate.name = 's269Swashplate'; rotor.group.add(this.swashplate);
    const scissors = new MeshBatch();
    scissors.add(m.cast, tube([-0.07, 0, 0.12], [-0.14, 0, 0.20], 0.011));
    scissors.add(m.cast, tube([-0.14, 0, 0.20], [-0.12, 0, 0.27], 0.011));
    scissors.add(m.metal, tube([-0.14, -0.022, 0.20], [-0.14, 0.022, 0.20], 0.014));
    this.group.add(scissors.build('s269SwashplateScissors'));
    const rod = (name: string, radius: number, material: THREE.Material) => {
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 1, 12), material);
      mesh.name = name; mesh.castShadow = true; this.group.add(mesh); return mesh;
    };
    for (let i = 0; i < MAIN_ROTOR_BLADES; i++) {
      const azimuth = new THREE.Group(); azimuth.name = `s269Blade${i}`; azimuth.rotation.y = i * 2 * Math.PI / MAIN_ROTOR_BLADES;
      const flap = new THREE.Group(); flap.name = 's269FlapHinge'; flap.position.x = F;
      const lag = new THREE.Group(); lag.name = 's269LagHinge'; lag.position.x = L - F;
      const pitch = new THREE.Group(); pitch.name = 's269FeatheringGrip';
      this.group.add(azimuth); azimuth.add(flap); flap.add(lag); lag.add(pitch);
      this.arms.push({ azimuth, flap, lag, pitch });
      const fixed = new MeshBatch(), flapping = new MeshBatch(), gripping = new MeshBatch();
      // Two pierced cheeks around a transverse flap pin, then a distinct vertical lag pin.
      for (const fore of [-1, 1]) {
        fixed.add(m.cast, box([fore * 0.044, (F + 0.07) / 2, 0], [0.022, F - 0.01, 0.066], 0.012));
        fixed.add(m.metal, tube([fore * 0.048, F, 0], [fore * 0.065, F, 0], 0.023, 0.023, 6));
      }
      fixed.add(m.metal, tube([-0.062, F, 0], [0.062, F, 0], 0.013));
      for (const z of [-0.035, 0.035]) flapping.add(m.cast, box([0, (L - F) / 2, z], [0.073, L - F + 0.10, 0.018], 0.007));
      flapping.add(m.metal, tube([0, L - F, -0.061], [0, L - F, 0.061], 0.016));
      for (const z of [-0.055, 0.049]) flapping.add(m.metal, tube([0, L - F, z], [0, L - F, z + 0.010], 0.025, 0.025, 6));
      gripping.add(m.cast, tube([0, 0.015, 0], [0, spec.root - L + 0.035, 0], 0.055, 0.035, 24));
      for (let k = 0; k < 5; k++) gripping.add(m.rubber, tube([0, 0.045 + k * 0.013, 0], [0, 0.053 + k * 0.013, 0], 0.057));
      gripping.add(m.cast, box([0, spec.root - L, 0], [0.13, 0.11, 0.039], 0.009));
      for (const x of [-0.043, 0.043]) for (const y of [spec.root - L - 0.035, spec.root - L + 0.035])
        gripping.add(m.metal, tube([x, y, -0.020], [x, y, -0.032], 0.009, 0.009, 6));
      gripping.add(m.cast, tube([0, 0.07, 0], [0.105, 0.09, 0.022], 0.016));
      gripping.add(m.cast, ellipsoid([0.105, 0.09, 0.022], [0.017, 0.017, 0.017]));
      // Damper drive arm moves with lag but not feathering.
      const damperArm = new MeshBatch();
      damperArm.add(m.cast, tube([0, 0.045, 0], [-0.095, 0.105, 0.012], 0.015));
      lag.add(damperArm.build('s269LagDamperArm'));
      azimuth.add(fixed.build('s269FlapClevis')); flap.add(flapping.build('s269LagClevis')); pitch.add(gripping.build('s269BladeGrip'));
      this.pitchLinks.push(rod('s269PitchLink', 0.007, m.metal));
      this.damperBodies.push(rod('s269ElastomericLagDamper', 0.029, m.dark));
      this.damperRods.push(rod('s269LagDamperEnd', 0.012, m.metal));
    }
  }

  update(ctx: SimContext, pose?: S269RotorPose): void {
    const state = ctx.state.rotorcraft;
    if (!state) return;
    // The mast/head is fixed in the airframe. Flap belongs at EACH hinge, not a tilted whole mast.
    this.rotor.group.quaternion.identity();
    const r = this.definition;
    const pitch = THREE.MathUtils.lerp(r.main.minPitch, r.main.maxPitch, ctx.controls.collective ?? 0);
    const spin = Math.min(1, Math.max(0, state.rotorRpm / r.nominalRpm));
    const coning = this.spec.coning;
    const cone = coning ? THREE.MathUtils.lerp(coning.droopDeg * Math.PI / 180,
      Math.min(coning.maxDeg, Math.max(0, state.thrust) / coning.referenceThrust * coning.angleDeg) * Math.PI / 180, spin * spin) : 0;
    const copies = this.rotor.blades.count / MAIN_ROTOR_BLADES;
    const sweep = Math.min(2 * Math.PI / MAIN_ROTOR_BLADES, Math.abs(state.rotorRpm) * 2 * Math.PI / 60 / 15);
    // Estimated swash travel/rigging follows the commanded cyclic, not the aerodynamic disc lag.
    this.tilt.set(ctx.controls.aileron * r.cyclicLimit, 1, ctx.controls.elevator * r.cyclicLimit).normalize();
    this.swashplate.quaternion.setFromUnitVectors(this.up, this.tilt);
    this.swashplate.position.y = -0.27 + (ctx.controls.collective ?? 0) * 0.035;
    this.swashplate.updateWorldMatrix(true, false);
    this.group.updateWorldMatrix(true, true); this.inverse.copy(this.group.matrixWorld).invert();
    let meanFlap = 0, forwardFlap = 0, rightFlap = 0;
    for (let i = 0; i < MAIN_ROTOR_BLADES; i++) {
      const arm = this.arms[i], psi = state.azimuth + i * 2 * Math.PI / MAIN_ROTOR_BLADES;
      const actual = pose?.blades[i];
      const flap = actual && Number.isFinite(actual.flap) ? actual.flap
        : cone + Math.atan(state.flapForward * Math.sin(psi) + state.flapRight * Math.cos(psi));
      arm.flap.rotation.z = flap;
      meanFlap += flap / MAIN_ROTOR_BLADES;
      forwardFlap += 2 * flap * Math.sin(psi) / MAIN_ROTOR_BLADES;
      rightFlap += 2 * flap * Math.cos(psi) / MAIN_ROTOR_BLADES;
      arm.lag.rotation.y = actual && Number.isFinite(actual.lag) ? actual.lag : 0;
      arm.pitch.rotation.x = actual?.pitch !== undefined && Number.isFinite(actual.pitch) ? actual.pitch : pitch;
      arm.azimuth.updateMatrixWorld(true);
      this.transform.multiplyMatrices(this.inverse, arm.pitch.matrixWorld).multiply(this.matrix.makeTranslation(-L, 0, 0));
      for (let k = 0; k < copies; k++) {
        this.matrix.makeRotationY(copies > 1 ? -sweep * k / (copies - 1) : 0).multiply(this.transform);
        this.rotor.blades.setMatrixAt(i * copies + k, this.matrix);
      }
      // Both rod ends are transformed through the same chain as their attachment fittings.
      this.a.set(0.12, 0, -0.085).applyAxisAngle(this.up, psi).applyMatrix4(this.swashplate.matrixWorld).applyMatrix4(this.inverse);
      this.b.set(0.09, -0.022, -0.105).applyMatrix4(arm.pitch.matrixWorld).applyMatrix4(this.inverse);
      fitRod(this.pitchLinks[i], this.a, this.b);
      this.a.set(0.08, -0.015, 0.11).applyMatrix4(arm.azimuth.matrixWorld).applyMatrix4(this.inverse);
      this.b.set(0.105, -0.012, 0.095).applyMatrix4(arm.lag.matrixWorld).applyMatrix4(this.inverse);
      this.c.copy(this.a).lerp(this.b, 0.72); fitRod(this.damperBodies[i], this.a, this.c); fitRod(this.damperRods[i], this.c, this.b);
    }
    this.rotor.blades.instanceMatrix.needsUpdate = true;
    // The high-RPM exposure disc uses the same blade solution, including coning. It is still an
    // exposure approximation, not a second independent set of blade angles from the generic renderer.
    const p = this.rotor.blur.geometry.getAttribute('position');
    const firstY = (Math.hypot(p.getX(0), p.getZ(0)) - F) * Math.sin(meanFlap);
    if (meanFlap !== this.blurCone || Math.abs(p.getY(0) - firstY) > 1e-7) {
      for (let i = 0; i < p.count; i++) p.setY(i, (Math.hypot(p.getX(i), p.getZ(i)) - F) * Math.sin(meanFlap));
      p.needsUpdate = true; this.rotor.blur.geometry.computeVertexNormals(); this.rotor.blur.geometry.computeBoundingSphere();
      this.blurCone = meanFlap;
    }
    this.tilt.set(Math.tan(rightFlap), 1, -Math.tan(forwardFlap)).normalize();
    this.rotor.blur.quaternion.setFromUnitVectors(this.up, this.tilt);
  }
}

export function buildS269TailHead(rotor: TeeteringRotor, spec: RotorcraftVisualDef['tail'], m: S269Materials): () => void {
  for (const child of rotor.spin.children) if (child !== rotor.blades) child.visible = false;
  setS269Section(rotor.blades.geometry, { ...spec, twist: spec.twist ?? 0 }, 0.14, -1);
  const head = new MeshBatch();
  head.add(m.cast, box([0, 0, 0], [0.075, 0.18, 0.034], 0.010));
  head.add(m.metal, tube([0, 0, 0.04], [0, 0, -0.045], 0.019));
  rotor.spin.add(head.build('s269TailHub'));
  const cuffs: THREE.Group[] = [];
  for (let i = 0; i < 2; i++) {
    const c = new THREE.Group(); c.name = 's269TailGrip'; c.matrixAutoUpdate = false;
    const b = new MeshBatch(); b.add(m.cast, box([0, 0.105, 0], [0.066, 0.067, 0.027], 0.006));
    b.add(m.metal, tube([-0.04, 0.105, 0], [0.04, 0.105, 0], 0.010, 0.010, 6));
    c.add(b.build('s269TailGripFittings')); rotor.spin.add(c); cuffs.push(c);
  }
  const matrix = new THREE.Matrix4();
  return () => cuffs.forEach((c, i) => { rotor.blades.getMatrixAt(i * rotor.blades.count / 2, matrix); c.matrix.copy(matrix); });
}
