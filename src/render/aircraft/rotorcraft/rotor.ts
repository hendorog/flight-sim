// Rotor mesh with data-driven blade count/direction. Legacy defaults retain the two-blade teetering head.
// The articulated head is a visible placeholder; aircraft adapters supply resolved hinge/lag motion.
// Airfoil grids have the published chord and twist; the exact R22 airfoil contour is not claimed.
// The shared perceptual blur model preserves the real planform at low RPM.
// Paint and hub references: Robinson R22 Maintenance Manual, Figs. 26-17, 28-5 and chapter 26:
// https://robinsonstrapistorprod.blob.core.windows.net/uploads/assets/r22_mm_book_6eaf5686aa.pdf
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { surfacePoint } from '../airfoil';
import { capGeometry, gridGeometry, MeshBatch } from '../geometry';
import type { AircraftMaterials } from '../materials';
import type { RotorBladePaint } from '../airframe/types';
import { box, tube } from './geometry';
import { bladeBlur } from '../bladeBlur';
import { BladeTrail, bladeShadowMaterial } from '../bladeTrail';
import { bladeBendShape, bladeConing, type BladeConingDefinition } from '../../../physics/rotorcraft/coning';

export interface RotorSpec { radius: number; root: number; chord: readonly [number, number]; twist: number; tail?: boolean; paint?: RotorBladePaint;
  coning?: BladeConingDefinition; blades?: number; rotation?: 1 | -1; hubType?: 'teetering' | 'articulated' | 'hingeless';
  /** Scale on the blur disc's alpha (after the shared 0.25 cap); absent = 1, the legacy disc. */
  blurAlpha?: number }

const smooth = THREE.MathUtils.smoothstep;

function rotorBladeRadii(d: RotorSpec): number[] {
  // Paint boundaries have paired stations so the stripes have crisp edges without extra draw calls.
  // R22 MM Figs. 26-17 / 28-5: white/yellow upper main blade, dark underside, striped tail blades.
  const bands = d.paint ? d.paint.bands.map(b => d.radius - b.tipDistance)
    : d.tail ? Array.from({ length: 7 }, (_, i) => d.radius - 0.05842 - i * 0.0508)
    : [0.254, 1.2192, 1.8288, 2.9464].map(x => d.radius - x);
  const capLength = d.paint?.capLength ?? (d.tail ? 0.004 : 0.008);
  return [...Array.from({ length: 25 }, (_, i) => THREE.MathUtils.lerp(d.root, d.radius, i / 24)),
    ...[...bands, d.radius - capLength].filter(r => r > d.root).flatMap(r => [r - 0.00001, r + 0.00001]),
    d.radius - 0.02].sort((a, b) => a - b);
}

function rotorChord(d: RotorSpec, r: number): number {
  const tip = smooth(r, d.radius - 0.02, d.radius);
  const root = d.tail ? THREE.MathUtils.lerp(0.45, 1, smooth(r, d.root, 0.16)) : 1;
  return THREE.MathUtils.lerp(...d.chord, (r - d.root) / (d.radius - d.root)) * root * (1 - 0.045 * tip);
}

export function rotorBladeGeometry(d: RotorSpec): THREE.BufferGeometry {
  const radii = rotorBladeRadii(d);
  const capLength = d.paint?.capLength ?? (d.tail ? 0.004 : 0.008);
  const rows = radii.length, cols = 33;
  const rotation = d.rotation ?? (d.tail ? -1 : 1);
  const g = gridGeometry({ rows, cols, wrap: true, flip: rotation > 0,
    position(i, j, out) {
      const r = radii[i], f = (r - d.root) / (d.radius - d.root);
      // Published main chord grows outboard; only the rounded tip cover narrows. Tail chord is constant
      // beyond the tapered blade root. Neither rotor is modelled as a wedge of zero thickness at its tip.
      const c = rotorChord(d, r);
      const angle = j / (cols - 1) * Math.PI * 2;
      const xc = (1 - Math.cos(angle)) / 2;
      const face = angle <= Math.PI ? 1 : -1;
      const [ax, ay] = surfacePoint({ m: 0, p: 0.4, t: 0.12 }, xc, face);
      const beta = d.twist * (f - 0.75), along = (0.25 - ax) * c;
      const thickness = ay * c;
      const tangent = -along * Math.cos(beta) + thickness * Math.sin(beta);
      // The tail turns the opposite way about its local axis; its leading edge faces that motion.
      out.set(r, along * Math.sin(beta) + thickness * Math.cos(beta), rotation < 0 ? -tangent : tangent);
    },
  });
  const colours = new Float32Array(g.getAttribute('position').count * 3);
  const dark = new THREE.Color(0x42484d), light = new THREE.Color(0xe4e6e1);
  const yellow = new THREE.Color(0xe1b536), metal = new THREE.Color(0x919b9f);
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
    const r = radii[i], tipDistance = d.radius - r, xc = (1 - Math.cos(j / (cols - 1) * Math.PI * 2)) / 2;
    let colour: THREE.Color;
    if (d.paint) {
      const band = d.paint.bands.find(b => tipDistance < b.tipDistance);
      colour = new THREE.Color(j > (cols - 1) / 2 ? band?.lower ?? d.paint.rootLower : band?.upper ?? d.paint.rootUpper);
    } else if (d.tail) colour = tipDistance < 0.05842 || (tipDistance < 0.36322 && Math.floor((tipDistance - 0.05842) / 0.0508) % 2 === 1) ? light : dark;
    else colour = tipDistance < 0.254 ? yellow : j > (cols - 1) / 2 ? dark
      : tipDistance < 1.2192 || (tipDistance > 1.8288 && tipDistance < 2.9464) ? light : yellow;
    if (xc < 0.075 || tipDistance < capLength) colour = metal;
    colour.toArray(colours, (i * cols + j) * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  const p = g.getAttribute('position'), parts = [g];
  for (const row of [0, rows - 1]) {
    const loop = Array.from({ length: cols - 1 }, (_, j) => new THREE.Vector3().fromBufferAttribute(p, row * cols + j));
    const cap = capGeometry(loop, new THREE.Vector3(row === 0 ? -1 : 1, 0, 0));
    const c = new Float32Array(cap.getAttribute('position').count * 3);
    for (let i = 0; i < c.length / 3; i++) metal.toArray(c, i * 3);
    cap.setAttribute('color', new THREE.BufferAttribute(c, 3)); parts.push(cap);
  }
  const closed = mergeGeometries(parts)!; parts.forEach(p => p.dispose()); return closed;
}

export class TeeteringRotor {
  readonly group = new THREE.Group();
  readonly spin = new THREE.Group();
  readonly blades: THREE.InstancedMesh;
  readonly trail: BladeTrail;
  readonly blur: THREE.Mesh;
  readonly swashplate = new THREE.Group();
  private readonly bladeMat: THREE.MeshStandardMaterial;
  private readonly blurMat: THREE.MeshStandardMaterial;
  private readonly hardwareMat: THREE.MeshStandardMaterial;
  private readonly texture: THREE.DataTexture;
  private readonly bladeShadow = bladeShadowMaterial();
  private readonly m = new THREE.Matrix4();
  private readonly coneM = new THREE.Matrix4();
  private readonly pitchM = new THREE.Matrix4();
  private readonly links: THREE.Mesh[] = [];
  private readonly upperJoints: THREE.Mesh[] = [];
  private readonly linkA = new THREE.Vector3();
  private readonly linkB = new THREE.Vector3();
  private readonly linkAxis = new THREE.Vector3(0, 1, 0);
  private readonly linkDelta = new THREE.Vector3();
  private cone = NaN;
  private bend = NaN;
  private bendPitch = NaN;
  private readonly bladePositions: Float32Array;
  private readonly bendShapes: Float32Array;
  /** Undeformed exposure-disc vertices, also used by articulated pose adapters. Do not mutate. */
  readonly discPositions: Float32Array;

  constructor(private readonly d: RotorSpec, mat: AircraftMaterials) {
    this.group.name = d.tail ? 'tailRotor' : 'mainRotor'; this.spin.name = 'rotorAzimuth';
    this.group.add(this.spin);
    this.bladeMat = new THREE.MeshStandardMaterial({ name: 'rotorBlade', vertexColors: true, roughness: 0.44, metalness: 0.12, transparent: true });
    this.hardwareMat = new THREE.MeshStandardMaterial({ name: 'rotorHeadPaint', color: 0x929c9f, roughness: 0.38, metalness: 0.25 });
    const bladeGeometry = rotorBladeGeometry(d);
    this.bladePositions = new Float32Array(bladeGeometry.getAttribute('position').array);
    this.bendShapes = new Float32Array(this.bladePositions.length / 3);
    const bending = d.coning?.bending;
    if (bending) for (let i = 0; i < this.bendShapes.length; i++) {
      this.bendShapes[i] = bladeBendShape((this.bladePositions[i * 3] - bending.rootRadius) / (bending.radius - bending.rootRadius));
    }
    this.blades = new THREE.InstancedMesh(bladeGeometry, this.bladeMat, d.blades ?? 2);

    this.blades.customDepthMaterial = this.bladeShadow;
    this.blades.name = 'rotorBlades'; this.blades.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.blades.frustumCulled = false;
    this.spin.add(this.blades);
    const colours = bladeGeometry.getAttribute('color');
    this.trail = new BladeTrail(rotorBladeRadii(d).map((radius, i) => ({
      radius, chord: rotorChord(d, radius), pitch: d.twist * ((radius - d.root) / (d.radius - d.root) - 0.75),
      front: new THREE.Color().fromBufferAttribute(colours, i * 33 + 8),
      back: new THREE.Color().fromBufferAttribute(colours, i * 33 + 24),
    })), 'y', d.blades ?? 2, d.rotation ?? (d.tail ? -1 : 1));
    this.spin.add(this.trail.mesh);
    const head = new MeshBatch();
    const k = d.tail ? 0.38 : 1;
    // Twin cheeks of the teetering yoke, coning bolts, grip barrels and elastomeric pitch-change boots.
    // Proportions estimated from R22 MM chapter 26 and preflight photographs; no fastener CAD is claimed.
    const grey = this.hardwareMat;
    if (d.hubType === 'articulated' || d.hubType === 'hingeless') {
      // Deliberately simple hub with one arm per blade, pending the aircraft exterior worker.
      head.add(grey, box([0, 0, 0], [0.16, 0.16, 0.12], 0.03));
      for (let i = 0; i < (d.blades ?? 3); i++) {
        const a = i * 2 * Math.PI / (d.blades ?? 3);
        head.add(grey, tube([0, 0, 0], [-d.root * Math.sin(a), d.root * Math.cos(a), 0], 0.035));
      }
      this.spin.add(head.build('articulatedHubPlaceholder'));
    } else {
      if (!d.tail) {
        const cheek = new THREE.Shape();
        cheek.moveTo(-0.135, -0.04); cheek.lineTo(0.135, -0.04);
        cheek.quadraticCurveTo(0.16, -0.04, 0.16, -0.015); cheek.lineTo(0.16, 0.065);
        cheek.quadraticCurveTo(0.16, 0.092, 0.13, 0.092); cheek.lineTo(0.085, 0.092);
        cheek.lineTo(0.06, 0.12); cheek.lineTo(-0.06, 0.12); cheek.lineTo(-0.085, 0.092);
        cheek.lineTo(-0.13, 0.092); cheek.quadraticCurveTo(-0.16, 0.092, -0.16, 0.065);
        cheek.lineTo(-0.16, -0.015); cheek.quadraticCurveTo(-0.16, -0.04, -0.135, -0.04);
        for (const x of [-0.11, 0.11]) { const hole = new THREE.Path(); hole.absarc(x, 0.063, 0.020, 0, Math.PI * 2, true); cheek.holes.push(hole); }
        const window = new THREE.Path(); window.moveTo(-0.045, -0.018); window.lineTo(-0.045, 0.023);
        window.lineTo(0.045, 0.023); window.lineTo(0.045, -0.018); window.closePath(); cheek.holes.push(window);
        for (const side of [-1, 1]) {
          const g = new THREE.ExtrudeGeometry(cheek, { depth: 0.018, bevelEnabled: true, bevelSize: 0.003, bevelThickness: 0.003, bevelSegments: 1, steps: 1, curveSegments: 10 });
          head.add(grey, g.translate(0, 0, side * 0.046 - 0.009));
        }
      } else head.add(grey, box([0, 0, 0], [0.075, 0.15, 0.027], 0.01));
      head.add(grey, tube([0, 0, 0.12 * k], [0, 0, -0.073 * k], 0.037 * k));
      for (const span of [-0.12, 0, 0.12]) {
        const z = span === 0 && !d.tail ? -0.075 : 0;
        head.add(mat.aluminium, tube([-0.073 * k, span * k, z], [0.073 * k, span * k, z], 0.024 * k));
        for (const end of [-1, 1]) {
          head.add(grey, tube([end * 0.057 * k, span * k, z], [end * 0.064 * k, span * k, z], 0.036 * k, 0.036 * k, 16));
          head.add(mat.aluminium, tube([end * 0.064 * k, span * k, z], [end * 0.079 * k, span * k, z], 0.027 * k, 0.027 * k, 6));
        }
      }
      for (const side of [-1, 1]) {
        head.add(grey, tube([0, side * 0.17 * k, 0], [0, side * d.root, 0], 0.049 * k, 0.035 * k, 20));
        head.add(mat.black, tube([0, side * 0.18 * k, 0], [0, side * 0.22 * k, 0], 0.05 * k, 0.05 * k, 20));
        for (const y of [0.181, 0.215]) head.add(mat.aluminium, tube([0, side * y * k, 0], [0, side * (y + 0.006) * k, 0], 0.051 * k, 0.051 * k, 20));
        if (!d.tail) {
          head.add(grey, tube([0, side * 0.28, 0], [side * 0.095, side * 0.17, 0.008], 0.018));
          for (const y of [0.335, 0.385]) head.add(mat.aluminium, tube([0, side * y, -0.039], [0, side * y, -0.053], 0.011, 0.011, 6));
        }
      }
      this.spin.add(head.build('teeteringHub'));
      if (!d.tail) {
        this.swashplate.name = 'swashplate'; this.swashplate.position.y = -0.20;
        const swash = new MeshBatch();
        for (const [radius, y, material] of [[0.105, 0, grey], [0.10, -0.027, mat.darkMetal]] as const) {
          const g = new THREE.TorusGeometry(radius, 0.016, 8, 24); g.rotateX(Math.PI / 2); g.translate(0, y, 0);
          swash.add(material, g);
        }
        swash.add(grey, tube([0, 0, -0.045], [0, 0, 0.05], 0.047, 0.052, 20));
        for (let i = 0; i < 3; i++) {
          const a = i * Math.PI * 2 / 3;
          const x = 0.092 * Math.cos(a), y = 0.092 * Math.sin(a);
          swash.add(grey, tube([0, 0, 0.014], [x, y, 0.014], 0.011));
          swash.add(mat.chrome, tube([x, y, 0.025], [x * 0.85, y * 0.85, 0.16], 0.007));
        }
        this.swashplate.add(swash.build('swashplateRings')); this.group.add(this.swashplate);
        for (const side of [-1, 1]) {
          const link = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 1, 8), mat.chrome);
          link.name = 'pitchLink'; this.spin.add(link); this.links.push(link);
          for (const [span, y] of [[0.075, -0.20], [0.17, -0.008]]) {
            const ball = new THREE.Mesh(new THREE.SphereGeometry(0.014, 10, 8), grey);
            ball.position.set(side * span, y, -side * 0.095); this.spin.add(ball);
            if (y === -0.008) this.upperJoints.push(ball);
          }
        }
        // Scissors carry the rotating swashplate; these short arms are visible alongside the mast.
        const scissors = new MeshBatch();
        scissors.add(grey, tube([-0.07, 0, 0.09], [-0.12, 0, 0.145], 0.011));
        scissors.add(grey, tube([-0.12, 0, 0.145], [-0.07, 0, 0.20], 0.011));
        this.spin.add(scissors.build('swashplateScissors'));
      }
    }
    const data = new Uint8Array(256 * 4);
    for (let i = 0; i < 256; i++) {
      const r = (i + 0.5) / 256 * d.radius;
      const sigma = (d.blades ?? 2) * THREE.MathUtils.lerp(...d.chord, r / d.radius) / (2 * Math.PI * Math.max(r, d.root));
      const tip = smooth(r, d.radius - (d.tail ? 0.08 : 0.10), d.radius - 0.01);
      const rim = smooth(d.radius - r, 0, 0.022);
      const v = 70 + 135 * tip;
      data.set([v, v, v, 255 * Math.min(0.25, 0.035 + sigma + tip * 0.04) * rim * (d.blurAlpha ?? 1)], i * 4);
    }
    this.texture = new THREE.DataTexture(data, 256, 1); this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.minFilter = this.texture.magFilter = THREE.LinearFilter; this.texture.needsUpdate = true;
    this.blurMat = new THREE.MeshStandardMaterial({ name: 'rotorBlur', map: this.texture, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, roughness: 0.7 });
    const g = gridGeometry({ rows: 9, cols: 73, wrap: true,
      position(i, j, out) { const r = THREE.MathUtils.lerp(d.root, d.radius, i / 8), a = j / 72 * Math.PI * 2; out.set(r * Math.cos(a), 0, r * Math.sin(a)); },
      uv(i, _j, out) { out.set(THREE.MathUtils.lerp(d.root, d.radius, i / 8) / d.radius, 0.5); },
    });
    this.blur = new THREE.Mesh(g, this.blurMat); this.blur.name = 'rotorBlur'; this.blur.renderOrder = 1; this.group.add(this.blur);
    this.discPositions = new Float32Array(g.getAttribute('position').array);
    const resting = d.coning ? bladeConing(d.coning, 0, 0) : undefined;
    this.update(0, 0, 0, resting?.angle ?? (d.tail ? -0.02 : 0), resting?.tipBend);
  }

  /** Hinge angle and curved tip displacement come from the shared per-blade moment balance. */
  update(azimuth: number, rpm: number, pitch: number, cone: number, tipBend = 0): void {
    this.spin.rotation.y = azimuth;
    const blades = this.d.blades ?? 2, blur = bladeBlur(rpm, blades);
    const spacing = 2 * Math.PI / blades;
    // Preserve the legacy pitch sign for each local axis; mirror it when that rotor reverses.
    const pitchSign = (this.d.rotation ?? (this.d.tail ? -1 : 1)) * (this.d.tail ? -1 : 1);
    pitch *= pitchSign;
    const hinge = this.d.coning?.hingeRadius ?? 0, bending = this.d.coning?.bending;
    const cs = Math.cos(cone), sn = Math.sin(cone);
    if (tipBend !== this.bend || (tipBend !== 0 && pitch !== this.bendPitch)) {
      const pos = this.blades.geometry.getAttribute('position') as THREE.BufferAttribute;
      // Counter-rotate the sag through feathering: gravity bends in the flap plane, not the pitch plane.
      for (let i = 0; i < pos.count; i++) {
        const sag = tipBend * this.bendShapes[i];
        pos.setY(i, this.bladePositions[3 * i + 1] + sag * Math.cos(pitch));
        pos.setZ(i, this.bladePositions[3 * i + 2] - sag * Math.sin(pitch));
      }
      pos.needsUpdate = true; this.blades.geometry.computeVertexNormals();
      this.blades.geometry.computeBoundingSphere(); this.bendPitch = pitch;
    }
    this.pitchM.makeRotationX(pitch); this.coneM.makeRotationZ(cone).multiply(this.pitchM);
    this.coneM.setPosition(hinge * (1 - cs), -hinge * sn, 0);
    for (let b = 0; b < blades; b++) {
      this.m.makeRotationY(b * spacing).multiply(this.coneM);

      this.blades.setMatrixAt(b, this.m);
    }
    this.blades.instanceMatrix.needsUpdate = true;
    this.bladeMat.opacity = this.bladeShadow.opacity = blur.solid;
    this.bladeMat.depthWrite = blur.solid === 1;
    this.blades.castShadow = blur.solid > 0; this.blades.receiveShadow = true;
    this.blades.visible = blur.solid > 0;
    this.trail.update(blur, pitch, cone, hinge, tipBend, bending?.rootRadius, bending ? bending.radius - bending.rootRadius : undefined);

    this.blurMat.opacity = blur.disc; this.blur.visible = blur.disc > 0;
    if (cone !== this.cone || tipBend !== this.bend) {
      const pos = this.blur.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const x = this.discPositions[i * 3], z = this.discPositions[i * 3 + 2], r = Math.hypot(x, z);
        const sag = bending ? tipBend * bladeBendShape((r - bending.rootRadius) / (bending.radius - bending.rootRadius)) : 0;
        const projected = hinge + (r - hinge) * cs - sag * sn;
        pos.setXYZ(i, x * projected / r, (r - hinge) * sn + sag * cs, z * projected / r);
      }
      pos.needsUpdate = true; this.blur.geometry.computeVertexNormals(); this.blur.geometry.computeBoundingSphere(); this.cone = cone;
    }
    this.bend = tipBend;
    this.links.forEach((link, i) => {
      const side = i === 0 ? -1 : 1;
      this.linkA.set(side * 0.075, -0.20, -side * 0.095);
      this.linkB.set(side * (hinge + (0.17 - hinge) * cs), -0.008 + (0.17 - hinge) * sn, -side * 0.095);
      this.linkDelta.subVectors(this.linkB, this.linkA);
      link.scale.y = this.linkDelta.length();
      link.quaternion.setFromUnitVectors(this.linkAxis, this.linkDelta.normalize());
      link.position.copy(this.linkA).add(this.linkB).multiplyScalar(0.5);
      this.upperJoints[i].position.copy(this.linkB);
    });
  }

  dispose(): void {
    this.bladeMat.dispose(); this.bladeShadow.dispose(); this.trail.dispose();
    this.hardwareMat.dispose(); this.blurMat.dispose(); this.texture.dispose();
  }
}

/**
 * Change the normal thickness of a shared NACA 0012 blade grid to `thickness` (t/c) in each UNTWISTED section,
 * keeping the published chord, twist, radial stations, paint and caps. `rotation` is the rotor's local sense
 * (the grid mirrors the chordwise axis for -1). Used by aircraft heads whose section differs from 0012
 * (MD 500E: NACA 0015, F tag). Call before any bend/coning pose is applied to the geometry.
 */
export function setRotorBladeThickness(g: THREE.BufferGeometry, spec: { root: number; radius: number; twist: number }, thickness: number, rotation: number): void {
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const beta = spec.twist * ((p.getX(i) - spec.root) / (spec.radius - spec.root) - 0.75);
    const y = p.getY(i), z = p.getZ(i) * rotation, s = Math.sin(beta), c = Math.cos(beta);
    const along = y * s - z * c, thick = (y * c + z * s) * thickness / 0.12;
    p.setY(i, along * s + thick * c); p.setZ(i, (-along * c + thick * s) * rotation);
  }
  p.needsUpdate = true; g.computeVertexNormals(); g.computeBoundingSphere();
}
