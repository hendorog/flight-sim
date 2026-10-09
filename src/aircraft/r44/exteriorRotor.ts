// R44 hub hardware, MM Figs. 28-5/7/8 and 30-1; swashplate, MM Fig. 8-12.
// Hardware dimensions are ESTIMATED from the illustrations. The shared rotor owns blades, azimuth,
// pitch, coning and blur; this fitting follows its matrices without changing the physical rotor state.
import * as THREE from 'three';
import { MeshBatch } from '../../render/aircraft/geometry';
import { box, tube } from '../../render/aircraft/rotorcraft/geometry';
import type { TeeteringRotor } from '../../render/aircraft/rotorcraft/rotor';
import { ellipsoid, type R44DetailMaterials } from './exteriorGeometry';

export class R44RotorHead {
  readonly group = new THREE.Group();
  readonly cuffs: THREE.Group[] = [];
  private readonly links: THREE.Mesh[] = [];
  private readonly a = new THREE.Vector3();
  private readonly b = new THREE.Vector3();
  private readonly delta = new THREE.Vector3();
  private readonly axis = new THREE.Vector3(0, 1, 0);
  private readonly matrix = new THREE.Matrix4();

  constructor(private readonly rotor: TeeteringRotor, mat: R44DetailMaterials, tail = false) {
    // Keep hidden originals attached so the shared disposer still releases their geometries/materials.
    for (const child of rotor.spin.children) if (child !== rotor.blades) child.visible = false;
    rotor.swashplate.visible = false;
    this.group.name = tail ? 'r44TailRotorHead' : 'r44MainRotorHead';
    const fixed = new MeshBatch(), stationary = new MeshBatch();
    if (!tail) {
      // The C154 yoke: parallel machined cheeks with coning-bearing eyes and central relief windows.
      // This is an underslung two-blade head, with no articulated lead/lag hinges or extra blades.
      const cheek = new THREE.Shape();
      cheek.moveTo(-0.195, -0.055); cheek.lineTo(0.195, -0.055);
      cheek.quadraticCurveTo(0.218, -0.055, 0.218, -0.030); cheek.lineTo(0.218, 0.082);
      cheek.quadraticCurveTo(0.218, 0.11, 0.187, 0.11); cheek.lineTo(0.075, 0.11);
      cheek.lineTo(0.049, 0.12); cheek.lineTo(-0.049, 0.12); cheek.lineTo(-0.075, 0.11);
      cheek.lineTo(-0.187, 0.11); cheek.quadraticCurveTo(-0.218, 0.11, -0.218, 0.082);
      cheek.lineTo(-0.218, -0.030); cheek.quadraticCurveTo(-0.218, -0.055, -0.195, -0.055);
      for (const x of [-0.151, 0.151]) { const hole = new THREE.Path(); hole.absarc(x, 0.036, 0.026, 0, 2 * Math.PI, true); cheek.holes.push(hole); }
      const window = new THREE.Path();
      window.moveTo(-0.053, -0.025); window.lineTo(-0.053, 0.030); window.lineTo(0.053, 0.030); window.lineTo(0.053, -0.025); window.closePath();
      cheek.holes.push(window);
      for (const side of [-1, 1]) {
        const g = new THREE.ExtrudeGeometry(cheek, { depth: 0.025, bevelEnabled: true, bevelSize: 0.003,
          bevelThickness: 0.003, bevelSegments: 2, steps: 1, curveSegments: 12 });
        g.translate(0, 0, side * 0.060 - 0.0125); fixed.add(mat.cast, g);
      }
      // Transverse teeter bolt above the mast and paired coning pins, washers, castellated nut shapes.
      for (const span of [-0.151, 0, 0.151]) {
        const z = span === 0 ? -0.087 : -0.036;
        fixed.add(mat.metal, tube([-0.094, span, z], [0.094, span, z], 0.020));
        for (const end of [-1, 1]) {
          fixed.add(mat.cast, tube([end * 0.074, span, z], [end * 0.080, span, z], 0.036));
          fixed.add(mat.metal, tube([end * 0.080, span, z], [end * 0.100, span, z], 0.027, 0.027, 6));
        }
      }
      fixed.add(mat.cast, tube([0, 0, -0.075], [0, 0, 0.18], 0.043));
      for (const side of [-1, 1]) fixed.add(mat.rubber, box([0, side * 0.089, 0.083], [0.053, 0.031, 0.037], 0.008));

      // Double swashplate race, rotating scissors and three rod-end attachment lugs. Hydraulic servos
      // and reservoir are enclosed below this exposed section; no fictitious external cylinders.
      for (const [radius, z] of [[0.137, 0.215], [0.132, 0.244]]) {
        const ring = new THREE.TorusGeometry(radius, 0.014, 10, 40); ring.rotateX(Math.PI / 2); ring.translate(0, -z, 0);
        (z > 0.23 ? stationary : fixed).add(mat.cast, ring);
      }
      fixed.add(mat.cast, tube([0, 0, 0.18], [0, 0, 0.275], 0.058));
      for (let i = 0; i < 3; i++) {
        const angle = i * 2 * Math.PI / 3, x = Math.cos(angle) * 0.125, y = Math.sin(angle) * 0.125;
        stationary.add(mat.cast, tube([0, 0, 0.244], [x, y, 0.244], 0.015));
        stationary.add(mat.metal, tube([x, y, 0.244], [x * 0.88, y * 0.88, 0.33], 0.008));
        stationary.add(mat.cast, ellipsoid([x, y, 0.244], [0.020, 0.020, 0.020]));
      }
      fixed.add(mat.cast, tube([-0.065, 0, 0.13], [-0.13, 0, 0.18], 0.013));
      fixed.add(mat.cast, tube([-0.13, 0, 0.18], [-0.105, 0, 0.24], 0.013));
    } else {
      // C008 single-piece yoke and bearing sleeves, distinctly shorter than a main-rotor spindle.
      for (const side of [-1, 1]) fixed.add(mat.cast, box([side * 0.026, 0, 0], [0.014, 0.245, 0.036], 0.007));
      fixed.add(mat.metal, tube([0, 0, -0.038], [0, 0, 0.047], 0.020));
      for (const span of [-0.088, 0.088]) {
        fixed.add(mat.rubber, tube([-0.022, span, 0], [0.022, span, 0], 0.022));
        fixed.add(mat.metal, tube([-0.041, span, 0], [0.041, span, 0], 0.010, 0.010, 6));
      }
      fixed.add(mat.cast, tube([0, -0.067, 0.046], [0, 0.067, 0.046], 0.011));
    }
    this.group.add(fixed.build(tail ? 'r44TailYoke' : 'r44MainYoke'));
    if (!tail) rotor.group.add(stationary.build('r44StationarySwashplate'));
    // Both blade-root fittings use the identical transformation as the first sharp blade in each
    // exposure group. They therefore remain attached under pitch, coning and opposite-side rotation.
    for (let i = 0; i < 2; i++) {
      const cuff = new THREE.Group(); cuff.name = tail ? 'r44TailBladeRoot' : 'r44MainBladeRoot'; cuff.matrixAutoUpdate = false;
      const parts = new MeshBatch();
      if (!tail) {
        parts.add(mat.cast, tube([0, 0.18, 0], [0, 0.53, 0], 0.067, 0.043, 24));
        parts.add(mat.cast, ellipsoid([0, 0.31, 0], [0.070, 0.16, 0.065]));
        for (let j = 0; j < 5; j++) parts.add(mat.rubber, tube([0, 0.195 + j * 0.012, 0], [0, 0.201 + j * 0.012, 0], 0.070));
        for (const y of [0.19, 0.25]) parts.add(mat.metal, tube([0, y, 0], [0, y + 0.007, 0], 0.072));
        parts.add(mat.cast, box([0, 0.53, 0], [0.15, 0.10, 0.044], 0.014));
        for (const x of [-0.05, 0, 0.05]) for (const y of [0.50, 0.555])
          parts.add(mat.metal, tube([x, y, -0.024], [x, y, -0.037], 0.009, 0.009, 6));
        parts.add(mat.cast, tube([0, 0.29, 0], [0.113, 0.21, 0.02], 0.017));
      } else {
        parts.add(mat.cast, box([0, 0.10, 0], [0.066, 0.072, 0.020], 0.006));
        parts.add(mat.metal, tube([-0.04, 0.11, 0], [0.04, 0.11, 0], 0.009, 0.009, 6));
        parts.add(mat.cast, tube([0.015, 0.073, 0], [0.047, 0.075, 0.015], 0.008));
      }
      cuff.add(parts.build('r44BladeCuff')); this.cuffs.push(cuff); this.group.add(cuff);
      const link = new THREE.Mesh(new THREE.CylinderGeometry(tail ? 0.0035 : 0.007, tail ? 0.0035 : 0.007, 1, 10), mat.metal);
      link.name = 'r44PitchLink'; link.castShadow = true; this.links.push(link); this.group.add(link);
    }
    this.group.userData.tail = tail;
    rotor.spin.add(this.group); this.update();
  }

  update(): void {
    const tail = this.group.userData.tail as boolean;
    for (let i = 0; i < 2; i++) {
      this.rotor.blades.getMatrixAt(i * this.rotor.blades.count / 2, this.matrix);
      this.cuffs[i].matrix.copy(this.matrix);
      const side = i === 0 ? 1 : -1;
      this.a.set(side * (tail ? 0.055 : 0.09), tail ? -0.046 : -0.215, -side * (tail ? 0.025 : 0.095));
      this.b.set(tail ? 0.075 : 0.21, tail ? -0.015 : -0.02, tail ? -0.047 : -0.113).applyMatrix4(this.matrix);
      this.delta.subVectors(this.b, this.a);
      const link = this.links[i]; link.scale.y = this.delta.length();
      link.quaternion.setFromUnitVectors(this.axis, this.delta.normalize()); link.position.copy(this.a).add(this.b).multiplyScalar(0.5);
    }
  }
}
