// Small procedural cabin fittings. Their pose follows controls; dimensions are photographic estimates.
import * as THREE from 'three';
import type { ControlInputs } from '../../../core/types';
import type { GaugeDef, PanelDef, SwitchDef } from '../../../instruments/panelDef';
import type { RotorcraftVisualDef } from '../airframe/types';
import type { AircraftMaterials } from '../materials';
import { frd, MeshBatch } from '../geometry';
import { box, tube } from './geometry';

/** Punched aluminium pedal plate, with actual holes so the carpet is visible through it. */
export function pedalPlate(): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-0.058, -0.036); shape.lineTo(0.058, -0.036); shape.lineTo(0.058, 0.036); shape.lineTo(-0.058, 0.036); shape.closePath();
  for (let row = 0; row < 4; row++) for (let col = 0; col < 8; col++) {
    const hole = new THREE.Path(); hole.absarc(-0.046 + col * 0.013, -0.023 + row * 0.015, 0.004, 0, Math.PI * 2, true); shape.holes.push(hole);
  }
  const g = new THREE.ExtrudeGeometry(shape, { depth: 0.003, bevelEnabled: false, curveSegments: 6 });
  g.rotateX(-55 * Math.PI / 180); g.translate(0, 0.102, 0.035); return g;
}

export function collectiveFittings(lever: THREE.Group, length: number, mat: AircraftMaterials): { switch: THREE.Group; material: THREE.Material; texture: THREE.Texture } {
  const parts = new MeshBatch();
  parts.add(mat.darkMetal, tube([0.02, -0.02, 0], [0.02, 0.048, 0], 0.008));
  parts.add(mat.knobBlack, tube([0.02, 0.034, 0], [0.02, 0.056, 0], 0.029, 0.029, 24));
  // The governor rocker sits on the fixed grip-end housing, not the rotating throttle sleeve.
  parts.add(mat.knobBlack, box([length - 0.012, 0, -0.022], [0.05, 0.044, 0.037], 0.009));
  lever.add(parts.build('collectiveFrictionAndGovernorHousing'));
  const rocker = new THREE.Group(); rocker.name = 'governorSwitch';
  rocker.position.copy(frd(length - 0.012, 0, -0.044));
  const paddle = new THREE.Mesh(box([0, 0, 0], [0.023, 0.024, 0.006], 0.002), mat.trimPlastic);
  rocker.add(paddle); lever.add(rocker);
  const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 320;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#141814'; g.fillRect(0, 0, 256, 320); g.fillStyle = '#dddcd3';
  g.font = 'bold 38px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('GOV', 128, 30); g.font = '24px sans-serif'; g.fillText('ON', 128, 76); g.fillText('OFF', 128, 286);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.8 });
  const label = new THREE.Mesh(new THREE.PlaneGeometry(0.042, 0.054).rotateX(-Math.PI / 2), material);
  label.position.copy(frd(length - 0.012, 0, -0.0415)); lever.add(label);
  return { switch: rocker, material, texture };
}

type Pull = Extract<GaugeDef, { kind: 'pullKnob' }>;
/** Visual hinged clutch cover. The simulator's existing direct clutch-switch binding is retained. */
export class ConsoleSwitchCover {
  private readonly hinge = new THREE.Group();
  constructor(private readonly def: SwitchDef, row: PanelDef['switchRow'], p: RotorcraftVisualDef['panel'], pod: THREE.Group, mat: AircraftMaterials) {
    const sx = p.width / p.canvas.w, sy = p.height / p.canvas.h;
    this.hinge.name = `${def.id}Cover`;
    this.hinge.position.set((row.bounds.x + def.x - p.canvas.w / 2) * sx,
      (p.canvas.h / 2 - row.bounds.y - (def.top ?? row.rockerTop)) * sy, 0.004);
    const width = row.rockerW * sx + 0.004, height = row.rockerH * sy;
    this.hinge.add(new THREE.Mesh(new THREE.BoxGeometry(width, height, 0.004).translate(0, -height / 2, 0.005), mat.knobRed));
    pod.add(this.hinge);
  }
  update(c: ControlInputs): void { this.hinge.rotation.x = this.def.on(c) ? -1.25 : -0.15; }
}

export class ConsolePullControl {
  readonly knob: THREE.Mesh;
  private readonly guard?: THREE.Group;
  private readonly material: THREE.MeshStandardMaterial;
  constructor(private readonly def: Pull, p: RotorcraftVisualDef['panel'], pod: THREE.Group, mat: AircraftMaterials) {
    const b = def.bounds, x = ((b.x + b.w / 2) / p.canvas.w - 0.5) * p.width, y = (0.5 - (b.y + b.h / 2) / p.canvas.h) * p.height;
    this.material = new THREE.MeshStandardMaterial({ color: def.color, roughness: 0.55 });
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.026, 12).rotateX(Math.PI / 2), mat.aluminium);
    shaft.position.set(x, y, 0.007); pod.add(shaft);
    this.knob = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.010, 24).rotateX(Math.PI / 2), this.material);
    this.knob.name = `${def.id}PullControl`; this.knob.position.set(x, y, 0.014); pod.add(this.knob);
    if (def.guard) {
      this.guard = new THREE.Group(); this.guard.name = 'mixtureGuard'; this.guard.position.set(x, y + 0.012, 0.003);
      const frame = new MeshBatch();
      frame.add(mat.knobRed, box([0, 0, 0.012], [0.005, 0.030, 0.025], 0.003));
      this.guard.add(frame.build('mixtureGuardCover')); pod.add(this.guard);
    }
  }
  update(c: ControlInputs): void {
    this.knob.position.z = 0.014 + 0.020 * this.def.read(c);
    if (this.guard) this.guard.rotation.x = this.def.guard!.closed(c) ? 0 : -Math.PI * 0.65;
  }
  dispose(): void { this.material.dispose(); }
}
