import * as THREE from 'three';
import type { RotorcraftDefinition } from '../../physics/rotorcraft/definition';
import type { SimContext } from '../../core/context';
import { frd } from './geometry';

/** Procedural engineering exterior, deliberately separate from the fixed-wing mesh builder. */
export class RotorcraftVisual {
  readonly root = new THREE.Group();
  readonly main = new THREE.Group();
  readonly tail = new THREE.Group();
  readonly disc = new THREE.Group();
  readonly panel: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
  private readonly materials: THREE.Material[];
  constructor(private readonly d: RotorcraftDefinition) {
    const red = new THREE.MeshStandardMaterial({ color: 0xb52326, roughness: 0.3, metalness: 0.15 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x22272c, roughness: 0.5, metalness: 0.3 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x9ac1ce, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false });
    const panelMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 });
    this.materials = [red, dark, glass, panelMat];
    const mesh = (geometry: THREE.BufferGeometry, material: THREE.Material, p: THREE.Vector3, group = this.root) => {
      const m = new THREE.Mesh(geometry, material); m.position.copy(p); m.castShadow = true; m.receiveShadow = true; group.add(m); return m;
    };
    const tube = (a: THREE.Vector3, b: THREE.Vector3, radius: number, material = dark) => {
      const delta = b.clone().sub(a);
      const m = mesh(new THREE.CylinderGeometry(radius, radius, delta.length(), 12), material, a.clone().add(b).multiplyScalar(0.5));
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize()); return m;
    };
    const cabin = mesh(new THREE.SphereGeometry(1, 32, 20), red, frd(0.2, 0, 0.15));
    cabin.scale.set(0.64, 0.6, 1.05);
    const canopy = mesh(new THREE.SphereGeometry(1, 32, 20), glass, frd(0.4, 0, -0.2));
    canopy.scale.set(0.62, 0.68, 1.0); canopy.castShadow = false;
    // Engine bay, tail boom, mast, skids and two seats.
    mesh(new THREE.BoxGeometry(0.8, 0.6, 0.8), red, frd(-0.7, 0, 0));
    tube(frd(-0.7, 0, 0), frd(-4.1, 0, -0.3), 0.09, red);
    tube(frd(0, 0, -0.3), frd(0, 0, d.main.hub.z), 0.045);
    for (const y of [-d.skids.halfTrack, d.skids.halfTrack]) {
      tube(frd(-1.25, y, d.skids.z), frd(1.15, y, d.skids.z), 0.032);
      for (const x of [-0.65, 0.6]) tube(frd(x, y * 0.45, 0.4), frd(x, y, d.skids.z), 0.028);
      mesh(new THREE.BoxGeometry(0.38, 0.5, 0.13), dark, frd(0.02, y * 0.3, 0));
    }
    mesh(new THREE.BoxGeometry(0.05, 0.8, 0.6), red, frd(-4, 0, -0.25));
    mesh(new THREE.BoxGeometry(1.15, 0.04, 0.35), red, frd(-3.6, 0, -0.2));
    this.disc.position.copy(frd(d.main.hub.x, d.main.hub.y, d.main.hub.z));
    this.root.add(this.disc); this.disc.add(this.main);
    mesh(new THREE.BoxGeometry(d.main.radius * 2, 0.025, d.main.chord), dark, new THREE.Vector3(), this.main);
    this.tail.position.copy(frd(d.tail.hub.x, d.tail.hub.y, d.tail.hub.z)); this.root.add(this.tail);
    mesh(new THREE.BoxGeometry(0.02, d.tail.radius * 2, d.tail.chord), dark, new THREE.Vector3(), this.tail);
    this.panel = new THREE.Mesh(new THREE.PlaneGeometry(0.86, 0.33), panelMat);
    this.panel.position.copy(frd(1.02, 0, -0.04)); this.root.add(this.panel);
  }
  update(ctx: SimContext): void {
    const r = ctx.state.rotorcraft;
    if (!r) return;
    this.main.rotation.y = r.azimuth;
    this.disc.rotation.x = r.flapForward; this.disc.rotation.z = -r.flapRight;
    this.tail.rotation.x = -r.azimuth * this.d.tailRatio;
    this.panel.material.emissive.setScalar(ctx.controls.lights.panel * (ctx.state.electrical.busVoltage > 10 ? 0.3 : 0));
  }
  dispose(): void {
    this.root.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
    for (const m of this.materials) m.dispose();
    this.root.removeFromParent();
  }
}
