// The small console pod and helicopter controls are independent of the aeroplane panel/yoke builder.
import * as THREE from 'three';
import type { AirframeVisualDef } from '../airframe/types';
import type { ControlInputs } from '../../../core/types';
import { frd, MeshBatch } from '../geometry';
import type { AircraftMaterials } from '../materials';
import { box, pathTube, tube } from './geometry';

export class RotorcraftCockpit {
  readonly group = new THREE.Group();
  readonly panel: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  readonly cyclic = new THREE.Group();
  readonly bar = new THREE.Group();
  readonly collectives: THREE.Group[] = [];
  readonly throttles: THREE.Group[] = [];
  readonly pedals: THREE.Group[] = [];
  readonly moving: THREE.Object3D[] = [];

  constructor(private readonly def: AirframeVisualDef, mat: AircraftMaterials, floor: THREE.BufferGeometry) {
    const d = def.rotorcraftVisual!;
    this.group.name = 'rotorcraftCockpit';
    const fixed = new MeshBatch();
    fixed.add(mat.carpet, floor);
    const p = d.panel;
    const pod = new THREE.Group(); pod.name = 'consolePod';
    pod.position.copy(frd(...p.centre)); pod.rotation.x = -p.tiltBackDeg * Math.PI / 180;
    const outline = p.outline ?? [[0, 0], [p.canvas.w, 0], [p.canvas.w, p.canvas.h], [0, p.canvas.h]];
    const points = outline.map(([x, y]) => new THREE.Vector2((x / p.canvas.w - 0.5) * p.width, (0.5 - y / p.canvas.h) * p.height));
    const shape = new THREE.Shape(points);
    // A closed, rounded enclosure extends 0.20 m forward of the face; bevels form the padded brow.
    const shell = new THREE.ExtrudeGeometry(shape, { depth: 0.18, steps: 1, bevelEnabled: true,
      bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 4, curveSegments: 12 });
    shell.translate(0, 0, -0.196);
    const housing = new THREE.Mesh(shell, mat.glareshield); housing.name = 'consoleHousing';
    housing.castShadow = housing.receiveShadow = true; pod.add(housing);
    // A narrow rubber rim stands proud of the face. Rounded joints follow the same outline as the UVs.
    const rimPoints = points.map(q => new THREE.Vector3(q.x, q.y, 0.003));
    const rim = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(rimPoints, true, 'centripetal'), 160, 0.007, 8, true), mat.glareshield);
    rim.name = 'consoleRim'; rim.castShadow = true; pod.add(rim);
    const face = new THREE.ShapeGeometry(shape);
    const pos = face.getAttribute('position'), uv = face.getAttribute('uv');
    for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / p.width + 0.5, pos.getY(i) / p.height + 0.5);
    this.panel = new THREE.Mesh(face, new THREE.MeshStandardMaterial({ name: 'rotorcraftPanel', color: 0xffffff, roughness: 0.86, emissive: 0x000000 }));
    this.panel.name = 'panelFace'; this.panel.receiveShadow = true; pod.add(this.panel);
    this.group.add(pod);
    // Pedestal heel connects the sloping radio/control face to the cabin floor, with a mounting foot.
    const angle = p.tiltBackDeg * Math.PI / 180;
    const bottomZ = p.centre[2] + p.height / 2 * Math.cos(angle);
    const bottomX = p.centre[0] - p.height / 2 * Math.sin(angle);
    const floorZ = def.cockpit.floor.z;
    fixed.add(mat.glareshield, box([bottomX + 0.07, 0, (bottomZ + floorZ) / 2], [0.22, p.width * 0.59, floorZ - bottomZ + 0.02], 0.018));
    fixed.add(mat.darkMetal, box([bottomX + 0.06, 0, floorZ - 0.01], [0.28, p.width * 0.67, 0.02]));
    for (const seat of def.cockpit.seats) {
      const z = seat.z!, backX = seat.x - seat.depth;
      fixed.add(mat.trimPlastic, box([seat.x - seat.depth / 2, seat.y, z + 0.11], [seat.depth, seat.width, 0.20], 0.035));
      fixed.add(mat.seatFabric, box([seat.x - seat.depth / 2, seat.y, z + 0.02], [seat.depth - 0.02, seat.width - 0.02, 0.09], 0.035));
      const back = box([0, 0, 0], [0.09, seat.width - 0.02, 0.56], 0.035);
      back.rotateX(-(seat.reclineDeg ?? 10) * Math.PI / 180);
      back.translate(...frd(backX - 0.01, seat.y, z - 0.24).toArray()); fixed.add(mat.seatFabric, back);
      // Cushion seams and a laid-down lap belt, with the shoulder harness running from the rear bulkhead.
      for (const dy of [-0.14, 0, 0.14]) fixed.add(mat.trimPlastic, tube([seat.x - 0.03, seat.y + dy, z - 0.026], [backX + 0.06, seat.y + dy, z - 0.026], 0.0018, 0.0018, 6));
      fixed.add(mat.black, box([seat.x - 0.16, seat.y, z - 0.029], [0.044, seat.width - 0.035, 0.006], 0.002));
      fixed.add(mat.aluminium, box([seat.x - 0.16, seat.y, z - 0.038], [0.045, 0.056, 0.012], 0.003));
      const belt = box([0, 0, 0], [0.008, 0.045, 0.48], 0.002);
      belt.rotateZ(0.28); belt.rotateX(-0.18);
      belt.translate(...frd(backX + 0.052, seat.y - 0.04, z - 0.24).toArray()); fixed.add(mat.black, belt);
    }

    const column = def.cockpit.column;
    if (column.kind !== 'stick') throw new Error('Rotorcraft cockpit requires a central stick');
    this.cyclic.name = 'cyclic'; this.cyclic.position.copy(frd(...column.pivot));
    const stem = new MeshBatch();
    stem.add(mat.darkMetal, pathTube([[0, 0, 0], [0.02, 0, -0.13], [-0.08, 0, -0.39], [-0.08, 0, -column.height]], 0.014));
    stem.add(mat.black, box([0, 0, -0.03], [0.13, 0.12, 0.09], 0.03));
    this.cyclic.add(stem.build('cyclicStem'));
    this.bar.name = 'cyclicTeeterBar'; this.bar.position.copy(frd(-0.08, 0, -column.height));
    const barParts = new MeshBatch();
    barParts.add(mat.darkMetal, tube([0, -0.33, 0], [0, 0.33, 0], 0.013));
    barParts.add(mat.aluminium, tube([-0.025, 0, 0], [0.025, 0, 0], 0.028));
    for (const y of [-0.33, 0.33]) {
      barParts.add(mat.darkMetal, tube([0, y, 0], [0.04, y, -0.045], 0.011));
      barParts.add(mat.knobBlack, tube([0.04, y, -0.04], [0.085, y, -0.14], 0.022, 0.017));
      barParts.add(mat.knobRed, box([0.085, y, -0.143], [0.012, 0.018, 0.008], 0.003));
    }
    this.bar.add(barParts.build('cyclicGrips')); this.cyclic.add(this.bar); this.group.add(this.cyclic);
    this.moving.push(this.cyclic, this.bar);

    for (const pivot of d.collective.pivots) {
      const lever = new THREE.Group(); lever.name = 'collective'; lever.position.copy(frd(...pivot));
      const parts = new MeshBatch();
      parts.add(mat.darkMetal, tube([0, 0, 0], [d.collective.length - 0.10, 0, 0], 0.012));
      parts.add(mat.aluminium, tube([0, -0.02, 0], [0, 0.02, 0], 0.034));
      lever.add(parts.build('collectiveLever'));
      const twist = new THREE.Group(); twist.name = 'throttleGrip';
      twist.position.copy(frd(d.collective.length - 0.09, 0, 0));
      const grip = new MeshBatch();
      grip.add(mat.knobBlack, tube([-0.055, 0, 0], [0.075, 0, 0], 0.021, 0.021));
      grip.add(mat.trimPlastic, box([0.01, 0, -0.021], [0.085, 0.004, 0.003], 0.001));
      twist.add(grip.build('twistGrip')); lever.add(twist);
      this.collectives.push(lever); this.throttles.push(twist); this.moving.push(lever, twist); this.group.add(lever);
    }
    for (const y of def.cockpit.pedals.ys) {
      const pedal = new THREE.Group(); pedal.name = 'pedal'; pedal.position.copy(frd(def.cockpit.pedals.x, y, 0.36));
      const parts = new MeshBatch();
      parts.add(mat.darkMetal, tube([-0.06, 0, 0.04], [0, 0, -0.09], 0.012));
      parts.add(mat.aluminium, tube([0, -0.066, -0.09], [0, 0.066, -0.09], 0.015));
      parts.add(mat.black, box([0, 0, -0.09], [0.032, 0.115, 0.04], 0.009));
      pedal.add(parts.build('pedalParts')); this.pedals.push(pedal); this.moving.push(pedal); this.group.add(pedal);
    }
    this.group.add(fixed.build('cabinFurniture'));
  }

  setPanelTexture(texture: THREE.Texture): void { this.panel.material.map = texture; this.panel.material.needsUpdate = true; }
  setPanelEmissiveTexture(texture: THREE.Texture): void { this.panel.material.emissiveMap = texture; this.panel.material.needsUpdate = true; }

  update(c: ControlInputs, busVoltage: number, emissiveScale: number): void {
    this.cyclic.rotation.x = c.elevator * 12 * Math.PI / 180;
    this.cyclic.rotation.z = -c.aileron * 12 * Math.PI / 180;
    // Free teeter pivot is posed with the right grip lower (command seat); both grips move with cyclic.
    this.bar.rotation.z = -9 * Math.PI / 180;
    for (let i = 0; i < this.collectives.length; i++) {
      this.collectives[i].rotation.x = (4 + 29 * (c.collective ?? 0)) * Math.PI / 180;
      this.throttles[i].rotation.z = -c.throttle * Math.PI * 0.65;
    }
    this.pedals.forEach((p, i) => { p.position.z = -this.def.cockpit.pedals.x + (i % 2 === 0 ? 1 : -1) * c.rudder * 0.045; });
    this.panel.material.emissive.setScalar(busVoltage > 10 ? c.lights.panel * 0.3 * emissiveScale : 0);
  }

  dispose(): void { this.panel.material.dispose(); }
}
