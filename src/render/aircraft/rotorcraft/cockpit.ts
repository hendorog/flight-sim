// Shaped helicopter panels and controls, independent of the aeroplane panel/yoke builder.
import { BallCompass } from '../compass';
import type { CompassReading } from '../../../instruments/dynamics/magneticCompass';
import * as THREE from 'three';
import type { AirframeVisualDef } from '../airframe/types';
import { SCENE_UNITS_PER_LUX } from '../../../core/context';
import { isAircraftId, type ControlInputs } from '../../../core/types';
import type { PanelDef } from '../../../instruments/panelDef';
import { frd, MeshBatch } from '../geometry';
import type { AircraftMaterials } from '../materials';
import { box, pathTube, tube } from './geometry';
import { buildConsole, consoleShape } from './console';
import { collectiveFittings, ConsolePullControl, ConsoleSwitchCover, pedalPlate } from './fittings';

export class RotorcraftCockpit {
  readonly group = new THREE.Group();
  readonly panel: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  readonly cyclic = new THREE.Group();
  readonly bar = new THREE.Group();
  readonly collectives: THREE.Group[] = [];
  readonly throttles: THREE.Group[] = [];
  readonly pedals: THREE.Group[] = [];
  readonly moving: THREE.Object3D[] = [];
  private readonly governorSwitches: THREE.Group[] = [];
  private readonly pullControls: ConsolePullControl[] = [];
  private readonly switchCovers: ConsoleSwitchCover[] = [];
  private readonly compass?: BallCompass;
  private readonly textures: THREE.Texture[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly dimmer = { value: 1 };

  constructor(private readonly def: AirframeVisualDef, mat: AircraftMaterials, floor: THREE.BufferGeometry,
    private readonly panelDef?: PanelDef) {
    const d = def.rotorcraftVisual!;
    this.group.name = 'rotorcraftCockpit';
    const fixed = new MeshBatch();
    fixed.add(mat.carpet, floor);
    const p = d.panel;
    const pod = new THREE.Group(); pod.name = 'consolePod';
    pod.position.copy(frd(...p.centre)); pod.rotation.x = -p.tiltBackDeg * Math.PI / 180;
    const outline = p.outline ?? [[0, 0], [p.canvas.w, 0], [p.canvas.w, p.canvas.h], [0, p.canvas.h]];
    const shape = consoleShape(outline, p);
    this.materials.push(...buildConsole(pod, p, panelDef, mat.glareshield));
    const face = new THREE.ShapeGeometry(shape);
    const pos = face.getAttribute('position'), uv = face.getAttribute('uv');
    for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / p.width + 0.5, pos.getY(i) / p.height + 0.5);
    this.panel = new THREE.Mesh(face, new THREE.MeshStandardMaterial({ name: 'rotorcraftPanel', color: 0xffffff, roughness: 0.86, emissive: 0x000000 }));
    // Match the aeroplane panel shader: suppress near-black paint in the dedicated emissive texture.
    // A plain emissive map lights the whole dial face at night exposure, washing out its markings.
    this.panel.material.onBeforeCompile = shader => {
      shader.uniforms.cockpitPanelDimmer = this.dimmer;
      shader.fragmentShader = 'uniform float cockpitPanelDimmer;\n' + shader.fragmentShader.replace('#include <emissivemap_fragment>', `
#ifdef USE_EMISSIVEMAP
  vec4 emissiveColor = texture2D( emissiveMap, vEmissiveMapUv );
  float emissivePeak = max( emissiveColor.r, max( emissiveColor.g, emissiveColor.b ) );
  float circuitLevel = emissiveColor.a < 0.75 ? cockpitPanelDimmer : 1.0;
  totalEmissiveRadiance *= emissiveColor.rgb * smoothstep( 0.006, 0.03, emissivePeak ) * circuitLevel;
#endif`);
    };
    this.panel.material.customProgramCacheKey = () => 'rotorcraftPanelBacklight';
    this.panel.name = 'instrumentPanel'; this.panel.receiveShadow = true; pod.add(this.panel);
    this.group.add(pod);
    for (const gauge of panelDef?.gauges ?? []) if (gauge.kind === 'pullKnob') this.pullControls.push(new ConsolePullControl(gauge, p, pod, mat));
    if (panelDef) for (const s of panelDef.switchRow.switches) if (s.cover) this.switchCovers.push(new ConsoleSwitchCover(s, panelDef.switchRow, p, pod, mat));
    if (def.cockpit.compass) {
      this.compass = new BallCompass(def.cockpit.compass.pos, isAircraftId(def.id) ? def.id : 'c172s', def.cockpit.compass.mount); this.group.add(this.compass.group);
    }
    const seatBack = mat.seatFabric.clone();
    if (d.interior) seatBack.color.setHex(d.interior.seatBackColor);
    this.materials.push(seatBack);
    // Pedestal heel connects the sloping radio/control face to the cabin floor, with a mounting foot.
    const angle = p.tiltBackDeg * Math.PI / 180;
    const bottomZ = p.centre[2] + p.height / 2 * Math.cos(angle);
    const bottomX = p.centre[0] - p.height / 2 * Math.sin(angle);
    const floorZ = def.cockpit.floor.z;
    const support = p.pedestal === undefined ? { forwardOffset: 0.14, depth: 0.22, width: 0.19,
      footDepth: 0.28, footWidth: 0.22 } : p.pedestal;
    if (support) {
      fixed.add(mat.glareshield, box([bottomX + support.forwardOffset, p.centre[1], (bottomZ + floorZ) / 2],
        [support.depth, support.width, floorZ - bottomZ + 0.02], 0.018));
      fixed.add(mat.darkMetal, box([bottomX + support.forwardOffset, p.centre[1], floorZ - 0.01],
        [support.footDepth, support.footWidth, 0.02]));
    }
    for (const seat of def.cockpit.seats) {
      const z = seat.z!, backX = seat.x - seat.depth;
      fixed.add(mat.trimPlastic, box([seat.x - seat.depth / 2, seat.y, z + 0.11], [seat.depth, seat.width, 0.20], 0.035));
      fixed.add(mat.seatFabric, box([seat.x - seat.depth / 2, seat.y, z + 0.02], [seat.depth - 0.02, seat.width - 0.02, 0.09], 0.035));
      const back = box([0, 0, 0], [0.09, seat.width - 0.02, seat.back?.height ?? 0.56], 0.035);
      back.rotateX(-(seat.reclineDeg ?? 10) * Math.PI / 180);
      back.translate(...frd(backX - 0.01, seat.y, z - 0.24).toArray()); fixed.add(seatBack, back);
      // Cushion seams and a laid-down lap belt, with the shoulder harness running from the rear bulkhead.
      for (const dy of [-0.14, 0, 0.14]) fixed.add(mat.trimPlastic, tube([seat.x - 0.03, seat.y + dy, z - 0.026], [backX + 0.06, seat.y + dy, z - 0.026], 0.0018, 0.0018, 6));
      fixed.add(mat.black, box([seat.x - 0.16, seat.y, z - 0.029], [0.044, seat.width - 0.035, 0.006], 0.002));
      fixed.add(mat.aluminium, box([seat.x - 0.16, seat.y, z - 0.038], [0.045, 0.056, 0.012], 0.003));
      const belt = box([0, 0, 0], [0.008, 0.045, 0.48], 0.002);
      belt.rotateZ(0.28); belt.rotateX(-0.18);
      belt.translate(...frd(backX + 0.052, seat.y - 0.04, z - 0.24).toArray()); fixed.add(mat.black, belt);
    }

    const column = def.cockpit.column;
    if (column.kind !== 'stick') throw new Error('Rotorcraft cockpit requires cyclic sticks');
    this.cyclic.name = 'cyclic'; this.cyclic.position.copy(frd(...column.pivot));
    if (d.cyclic?.kind === 'individual') {
      const parts = new MeshBatch();
      for (const y of d.cyclic.gripYs) {
        const path = d.cyclic.stem.map(p => [p[0], p[1] + y, p[2]] as const);
        parts.add(mat.darkMetal, pathTube(path, 0.014));
        const end = path[path.length - 1];
        parts.add(mat.knobBlack, tube([end[0], end[1], end[2] + 0.06], [end[0], end[1], end[2] - 0.06], 0.020));
      }
      this.cyclic.add(parts.build('individualCyclicSticks')); this.group.add(this.cyclic); this.moving.push(this.cyclic);
    } else {
    const stem = new MeshBatch();
    const stemPath = d.cyclic?.stem ?? [[0, 0, 0], [0.02, 0, -0.13], [-0.08, 0, -0.39], [-0.08, 0, -column.height]];
    stem.add(mat.darkMetal, pathTube(stemPath, 0.014));
    stem.add(mat.black, box([0, 0, -0.03], [0.13, 0.12, 0.09], 0.03));
    this.cyclic.add(stem.build('cyclicStem'));
    this.bar.name = 'cyclicTeeterBar'; this.bar.position.copy(frd(...stemPath[stemPath.length - 1]));
    const barParts = new MeshBatch();
    const grips = d.cyclic?.gripYs ?? [-0.33, 0.33];
    barParts.add(mat.darkMetal, tube([0, grips[0], 0], [0, grips[1], 0], 0.013));
    barParts.add(mat.aluminium, tube([-0.025, 0, 0], [0.025, 0, 0], 0.028));
    for (const y of grips) {
      barParts.add(mat.darkMetal, tube([0, y, 0], [0.04, y, -0.045], 0.011));
      barParts.add(mat.knobBlack, tube([0.04, y, -0.04], [0.085, y, -0.14], 0.022, 0.017));
      barParts.add(mat.knobRed, box([0.085, y, -0.143], [0.012, 0.018, 0.008], 0.003));
    }
    this.bar.add(barParts.build('cyclicGrips')); this.cyclic.add(this.bar); this.group.add(this.cyclic);
    this.moving.push(this.cyclic, this.bar);
    }

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
      if (d.interior?.collectiveFittings) {
        const governor = collectiveFittings(lever, d.collective.length, mat);
        this.governorSwitches.push(governor.switch); this.materials.push(governor.material); this.textures.push(governor.texture);
      }
      this.collectives.push(lever); this.throttles.push(twist); this.moving.push(lever, twist); this.group.add(lever);
    }
    for (const y of def.cockpit.pedals.ys) {
      const pedal = new THREE.Group(); pedal.name = 'pedal'; pedal.position.copy(frd(def.cockpit.pedals.x, y, d.pedalZ ?? 0.36));
      const parts = new MeshBatch();
      parts.add(mat.darkMetal, tube([-0.06, 0, 0.04], [0, 0, -0.09], 0.012));
      parts.add(mat.aluminium, tube([0, -0.066, -0.09], [0, 0.066, -0.09], 0.015));
      parts.add(d.interior?.perforatedPedals ? mat.aluminium : mat.black, d.interior?.perforatedPedals
        ? pedalPlate() : box([0, 0, -0.09], [0.032, 0.115, 0.04], 0.009));
      pedal.add(parts.build('pedalParts')); this.pedals.push(pedal); this.moving.push(pedal); this.group.add(pedal);
    }
    this.group.add(fixed.build('cabinFurniture'));
  }

  setPanelTexture(texture: THREE.Texture): void { this.panel.material.map = texture; this.panel.material.needsUpdate = true; }
  setPanelEmissiveTexture(texture: THREE.Texture): void { this.panel.material.emissiveMap = texture; this.panel.material.needsUpdate = true; }

  update(c: ControlInputs, busVoltage: number, emissiveScale: number, compass?: CompassReading): void {
    if (compass) this.compass?.update(compass, c.lights.panel * (busVoltage > 10 ? 1 : 0) * 1.2 * emissiveScale);
    this.pullControls.forEach(control => control.update(c));
    this.switchCovers.forEach(cover => cover.update(c));
    this.governorSwitches.forEach(s => { s.rotation.x = (c.rotorGovernor ? -1 : 1) * 0.25; });
    this.cyclic.rotation.x = c.elevator * (this.def.cockpit.column.kind === 'stick' ? this.def.cockpit.column.pitchDeg : 12) * Math.PI / 180;
    this.cyclic.rotation.z = -c.aileron * this.def.cockpit.column.rollDeg * Math.PI / 180;
    // Free teeter pivot is posed with the right grip lower (command seat); both grips move with cyclic.
    this.bar.rotation.z = (this.def.rotorcraftVisual!.cyclic?.barTiltDeg ?? -9) * Math.PI / 180;
    for (let i = 0; i < this.collectives.length; i++) {
      this.collectives[i].rotation.x = (4 + 29 * (c.collective ?? 0)) * Math.PI / 180;
      this.throttles[i].rotation.z = -c.throttle * Math.PI * 0.65;
    }
    this.pedals.forEach((p, i) => { p.position.z = -this.def.cockpit.pedals.x + (i % 2 === 0 ? 1 : -1) * c.rudder * 0.045; });
    // Use the same luminance scale as the aeroplane panels: markings 2–20 cd/m², displays 20–200.
    const [dead, full] = this.def.rotorcraftVisual!.panel.poweredVolts ?? [10, 12];
    const power = Math.min(1, Math.max(0, (busVoltage - dead) / (full - dead)));
    this.dimmer.value = this.panelDef?.lightingDimmerExponent === undefined ? 1
      : Math.max(0, Math.min(1, c.lights.panel)) ** this.panelDef.lightingDimmerExponent;
    this.panel.material.emissive.setScalar(power * (this.def.rotorcraftVisual!.panel.emissiveLuminance ?? (20 + 180 * c.lights.panel)) * SCENE_UNITS_PER_LUX * emissiveScale);
  }

  dispose(): void { this.panel.material.dispose(); this.materials.forEach(m => m.dispose()); this.textures.forEach(t => t.dispose()); this.compass?.dispose(); this.pullControls.forEach(c => c.dispose()); }
}
