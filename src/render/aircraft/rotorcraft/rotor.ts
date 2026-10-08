// Two-blade teetering rotor. Airfoil grids have the published chord and twist; the exact R22 airfoil
// contour is not claimed. Motion smear integrates one 30 Hz exposure; a radial solidity disc takes
// over as the swept sectors overlap (the same approach as propeller.ts).
import * as THREE from 'three';
import { surfacePoint } from '../airfoil';
import { gridGeometry, MeshBatch } from '../geometry';
import type { AircraftMaterials } from '../materials';
import { box, tube } from './geometry';

export interface RotorSpec { radius: number; root: number; chord: readonly [number, number]; twist: number; tail?: boolean }
const COPIES = 10;
const smooth = THREE.MathUtils.smoothstep;

export function rotorBladeGeometry(d: RotorSpec): THREE.BufferGeometry {
  const rows = d.tail ? 16 : 36, cols = 25;
  const g = gridGeometry({ rows, cols, wrap: true,
    position(i, j, out) {
      const f = i / (rows - 1), r = THREE.MathUtils.lerp(d.root, d.radius, f);
      const c = THREE.MathUtils.lerp(...d.chord, f);
      const angle = j / (cols - 1) * Math.PI * 2;
      const xc = (1 - Math.cos(angle)) / 2;
      const face = angle <= Math.PI ? 1 : -1;
      const [ax, ay] = surfacePoint({ m: 0, p: 0.4, t: 0.12 }, xc, face);
      const beta = d.twist * (f - 0.75), along = (0.25 - ax) * c;
      const thickness = ay * c * Math.min(1, (1 - f) * 40 + 0.06);
      out.set(r, along * Math.sin(beta) + thickness * Math.cos(beta), -along * Math.cos(beta) + thickness * Math.sin(beta));
    },
  });
  const colours = new Float32Array(g.getAttribute('position').count * 3);
  const dark = new THREE.Color(0x393d40), light = new THREE.Color(0xd9d7cb);
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) (i > rows - (d.tail ? 4 : 2) ? light : dark).toArray(colours, (i * cols + j) * 3);
  g.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  return g;
}

export class TeeteringRotor {
  readonly group = new THREE.Group();
  readonly spin = new THREE.Group();
  readonly blades: THREE.InstancedMesh;
  readonly blur: THREE.Mesh;
  readonly swashplate = new THREE.Group();
  private readonly bladeMat: THREE.MeshStandardMaterial;
  private readonly blurMat: THREE.MeshStandardMaterial;
  private readonly texture: THREE.DataTexture;
  private readonly m = new THREE.Matrix4();
  private readonly coneM = new THREE.Matrix4();
  private readonly pitchM = new THREE.Matrix4();
  private readonly links: THREE.Mesh[] = [];
  private cone = 0;

  constructor(private readonly d: RotorSpec, mat: AircraftMaterials) {
    this.group.name = d.tail ? 'tailRotor' : 'mainRotor'; this.spin.name = 'rotorAzimuth';
    this.group.add(this.spin);
    this.bladeMat = new THREE.MeshStandardMaterial({ name: 'rotorBlade', vertexColors: true, roughness: 0.53, metalness: 0.2, transparent: true, side: THREE.DoubleSide });
    this.blades = new THREE.InstancedMesh(rotorBladeGeometry(d), this.bladeMat, COPIES * 2);
    this.blades.name = 'rotorBlades'; this.blades.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.blades.frustumCulled = false;
    this.spin.add(this.blades);
    const head = new MeshBatch();
    const k = d.tail ? 0.38 : 1;
    // Yoke, central teeter spindle and independent coning-hinge bolts (main rotor only).
    head.add(mat.darkMetal, box([0, 0, 0.015], [0.105 * k, 0.59 * k, 0.055 * k], 0.015 * k));
    head.add(mat.aluminium, tube([-0.07 * k, 0, 0], [0.07 * k, 0, 0], 0.033 * k));
    for (const side of [-1, 1]) {
      head.add(mat.aluminium, tube([-0.055 * k, side * 0.24 * k, 0], [0.055 * k, side * 0.24 * k, 0], 0.023 * k));
      head.add(mat.darkMetal, tube([0, side * 0.26 * k, 0], [0, side * d.root, 0], 0.033 * k));
    }
    head.add(mat.aluminium, tube([0, 0, -0.07 * k], [0, 0, 0.085 * k], 0.035 * k));
    this.spin.add(head.build('teeteringHub'));
    if (!d.tail) {
      this.swashplate.name = 'swashplate'; this.swashplate.position.y = -0.20;
      for (const [radius, y, material] of [[0.105, 0, mat.aluminium], [0.10, -0.027, mat.darkMetal]] as const) {
        const g = new THREE.TorusGeometry(radius, 0.015, 8, 24); g.rotateX(Math.PI / 2);
        const ring = new THREE.Mesh(g, material); ring.position.y = y; this.swashplate.add(ring);
      }
      this.group.add(this.swashplate);
      for (const side of [-1, 1]) {
        const link = new THREE.Mesh(tube([0.064, side * 0.17, 0.20], [0.064, side * 0.31, 0.008], 0.007), mat.chrome);
        link.name = 'pitchLink'; this.spin.add(link); this.links.push(link);
      }
    }
    const data = new Uint8Array(256 * 4);
    for (let i = 0; i < 256; i++) {
      const r = (i + 0.5) / 256 * d.radius;
      const sigma = 2 * THREE.MathUtils.lerp(...d.chord, r / d.radius) / (2 * Math.PI * Math.max(r, d.root));
      const tip = smooth(r, d.radius - (d.tail ? 0.08 : 0.10), d.radius - 0.01);
      const rim = smooth(d.radius - r, 0, 0.022);
      const v = 70 + 135 * tip;
      data.set([v, v, v, 255 * Math.min(0.25, 0.035 + sigma + tip * 0.04) * rim], i * 4);
    }
    this.texture = new THREE.DataTexture(data, 256, 1); this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.minFilter = this.texture.magFilter = THREE.LinearFilter; this.texture.needsUpdate = true;
    this.blurMat = new THREE.MeshStandardMaterial({ name: 'rotorBlur', map: this.texture, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, roughness: 0.7 });
    const g = gridGeometry({ rows: 9, cols: 73, wrap: true,
      position(i, j, out) { const r = THREE.MathUtils.lerp(d.root, d.radius, i / 8), a = j / 72 * Math.PI * 2; out.set(r * Math.cos(a), 0, r * Math.sin(a)); },
      uv(i, _j, out) { out.set(THREE.MathUtils.lerp(d.root, d.radius, i / 8) / d.radius, 0.5); },
    });
    this.blur = new THREE.Mesh(g, this.blurMat); this.blur.name = 'rotorBlur'; this.blur.renderOrder = 1; this.group.add(this.blur);
    this.update(0, 0, 0, d.tail ? 0.02 : -0.035);
  }

  /** cone is a visual elastic/precone estimate; flap and azimuth are supplied directly by the flight model. */
  update(azimuth: number, rpm: number, pitch: number, cone: number): void {
    this.spin.rotation.y = azimuth;
    const sweep = Math.min(Math.PI, Math.abs(rpm) * Math.PI * 2 / 60 / 30);
    const toDisc = smooth(sweep, Math.PI * 0.40, Math.PI * 0.85);
    const sharp = sweep < 0.015, n = sharp ? 1 : COPIES;
    this.blades.count = 2 * n;
    this.pitchM.makeRotationX(pitch); this.coneM.makeRotationZ(cone).multiply(this.pitchM);
    for (let b = 0; b < 2; b++) for (let k = 0; k < n; k++) {
      this.m.makeRotationY(b * Math.PI - (n > 1 ? sweep * k / (n - 1) : 0)).multiply(this.coneM);
      this.blades.setMatrixAt(b * n + k, this.m);
    }
    this.blades.instanceMatrix.needsUpdate = true;
    this.bladeMat.opacity = (sharp ? 1 : Math.min(1, 2 / COPIES + 0.8 * Math.max(0, 1 - sweep / 0.12))) * (1 - toDisc);
    this.bladeMat.depthWrite = sharp; this.blades.castShadow = sharp; this.blades.receiveShadow = sharp;
    this.blades.visible = this.bladeMat.opacity > 0.005;
    this.blurMat.opacity = toDisc; this.blur.visible = toDisc > 0.01;
    if (cone !== this.cone) {
      const pos = this.blur.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) pos.setY(i, Math.hypot(pos.getX(i), pos.getZ(i)) * Math.sin(cone));
      pos.needsUpdate = true; this.blur.geometry.computeVertexNormals(); this.blur.geometry.computeBoundingSphere(); this.cone = cone;
    }
    for (const link of this.links) link.scale.y = 1 + Math.sin(cone) * 0.31 / 0.20;
  }

  dispose(): void { this.bladeMat.dispose(); this.blurMat.dispose(); this.texture.dispose(); }
}
