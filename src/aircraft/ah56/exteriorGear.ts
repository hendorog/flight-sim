// AH-56A retractable tail-wheel gear (P ASTA-72 App B para 2, para 93): main legs that swing forward and up into the
// sponsons, and the full-swivelling, lockable tail wheel (5.00x4 at 100 psi, P) that swings aft and up into the lower end
// of the ventral fin. Each leg is posed from AircraftState.gear.extension (0 up, 1 down; tail wheel in the "nose" slot,
// then left, right), wheels[i].compression (oleo stroke), wheels[i].rotation (spin) and wheels[0].steerAngle (castering).
// Contacts come from dimensions.ts (AG's gear contract); leg geometry and the retraction swing are ESTIMATES (3V).
// Built with its own meshes: the fixed-wing wheel and leg renderers are not used.
import * as THREE from 'three';
import type { AircraftState } from '../../core/types';
import type { FRD } from '../../render/aircraft/airframe/types';
import { frd, MeshBatch } from '../../render/aircraft/geometry';
import { box, tube } from '../../render/aircraft/rotorcraft/geometry';
import * as D from './dimensions';
import { MAIN_PIVOT, MAIN_TYRE, TAIL_PIVOT, TAIL_TYRE, fs, wl } from './visual';
import type { AH56Materials } from './exteriorGeometry';

const IN = 0.0254;
/** Main legs swing this far forward when up (3V: the leg lies fore-and-aft in the sponson), rad. */
export const MAIN_RETRACT = 98 * Math.PI / 180;
/** The tail-wheel fork swings this far aft and up into the fin, rad. */
export const TAIL_RETRACT = 90 * Math.PI / 180;
/** The main leg stands inboard of its wheel (3V), m from the wheel plane. */
const LEG_INSET = MAIN_TYRE.width / 2 + 1.4 * IN;

/** Tyre (torus) and hub with its axle along FRD y, centred at the origin. */
function wheelParts(b: MeshBatch, m: AH56Materials, r: number, width: number, rim: number): void {
  const tube = width / 2;
  b.add(m.rubber, new THREE.TorusGeometry(r - tube, tube, 14, 40).rotateY(Math.PI / 2));
  b.add(m.cast, new THREE.CylinderGeometry(rim, rim, width * 0.92, 28).rotateZ(Math.PI / 2));
  b.add(m.metal, new THREE.CylinderGeometry(rim * 0.35, rim * 0.35, width * 1.08, 14).rotateZ(Math.PI / 2));
  // Brake disc / tread marks so the spin reads.
  for (let k = 0; k < 6; k++) b.add(m.dark, box([Math.cos(k * Math.PI / 3) * rim * 0.65, 0, Math.sin(k * Math.PI / 3) * rim * 0.65], [0.012, width * 0.95, 0.012], 0.002));
}

export interface AH56GearLeg {
  /** Retraction pivot (rotation.x). */
  pivot: THREE.Group;
  /** Oleo slider: moves up the leg with compression. */
  slider: THREE.Group;
  /** Castering yoke (tail wheel only): rotation about the strut. */
  caster?: THREE.Group;
  /** Wheel: spins about its axle. */
  wheel: THREE.Group;
  /** Unit vector from the pivot down the leg (model space of the pivot), and the extended slider rest position. */
  axis: THREE.Vector3;
  retract: number;
}

export class AH56Gear {
  readonly group = new THREE.Group();
  readonly legs: AH56GearLeg[] = [];

  constructor(m: AH56Materials) {
    this.group.name = 'ah56Gear';
    this.legs.push(this.tailLeg(m));
    for (const side of [-1, 1]) this.legs.push(this.mainLeg(m, side));
    this.update();
  }

  private mainLeg(m: AH56Materials, side: number): AH56GearLeg {
    const y = side * D.MAIN_GEAR.halfTrack, legY = y - side * LEG_INSET;
    const pivot = new THREE.Group(); pivot.name = side < 0 ? 'ah56MainLegLeft' : 'ah56MainLegRight';
    pivot.position.copy(frd(fs(MAIN_PIVOT.fs), legY, wl(MAIN_PIVOT.wl)));
    // Extended axle (pivot frame, FRD): over the contact, one tyre radius up.
    const axle: FRD = [D.MAIN_GEAR.x - fs(MAIN_PIVOT.fs), 0, D.GROUND_Z - MAIN_TYRE.radius - wl(MAIN_PIVOT.wl)];
    const fixed = new MeshBatch();
    fixed.add(m.cast, tube([0, -0.08, 0], [0, 0.08, 0], 0.04, 0.04, 16));
    fixed.add(m.cast, tube([0, 0, 0], [axle[0] * 0.55, 0, axle[2] * 0.55], 0.058, 0.055, 20));
    fixed.add(m.metal, tube([axle[0] * 0.5, 0, axle[2] * 0.5], [axle[0] * 0.56, 0, axle[2] * 0.56], 0.064, 0.064, 20));
    // Drag brace forward to the sponson fitting and the retraction actuator lug.
    fixed.add(m.cast, tube([axle[0] * 0.35, 0, axle[2] * 0.35], [0.42, 0, -0.06], 0.022, 0.018, 12));
    fixed.add(m.cast, box([0.42, 0, -0.06], [0.06, 0.07, 0.05], 0.01));
    pivot.add(fixed.build('ah56MainLegCylinder'));
    const slider = new THREE.Group(); slider.name = 'ah56MainOleo'; pivot.add(slider);
    const moving = new MeshBatch();
    moving.add(m.metal, tube([axle[0] * 0.5, 0, axle[2] * 0.5], [axle[0], 0, axle[2] - 0.02], 0.04, 0.04, 18));
    moving.add(m.cast, box([axle[0], 0, axle[2]], [0.10, 0.06, 0.09], 0.012));
    moving.add(m.metal, tube([axle[0], 0, axle[2]], [axle[0], side * LEG_INSET, axle[2]], 0.026, 0.026, 12));
    // Torque links (scissors) on the leg's front.
    moving.add(m.cast, tube([axle[0] * 0.98 + 0.06, 0, axle[2] * 0.9], [axle[0] * 0.72 + 0.09, 0, axle[2] * 0.76], 0.012, 0.012, 8));
    moving.add(m.cast, tube([axle[0] * 0.72 + 0.09, 0, axle[2] * 0.76], [axle[0] * 0.58 + 0.05, 0, axle[2] * 0.6], 0.012, 0.012, 8));
    slider.add(moving.build('ah56MainOleoParts'));
    const wheel = new THREE.Group(); wheel.name = 'ah56MainWheel';
    wheel.position.copy(frd(axle[0], side * LEG_INSET, axle[2]));
    const tyre = new MeshBatch(); wheelParts(tyre, m, MAIN_TYRE.radius, MAIN_TYRE.width, MAIN_TYRE.rim);
    const tyreGroup = tyre.build('ah56MainTyre'); tyreGroup.children.forEach(c => { if (c instanceof THREE.Mesh && c.material === m.rubber) c.name = 'ah56Tyre'; });
    wheel.add(tyreGroup); slider.add(wheel);
    this.group.add(pivot);
    return { pivot, slider, wheel, axis: frd(...axle).normalize(), retract: MAIN_RETRACT };
  }

  private tailLeg(m: AH56Materials): AH56GearLeg {
    const pivot = new THREE.Group(); pivot.name = 'ah56TailWheelLeg';
    pivot.position.copy(frd(fs(TAIL_PIVOT.fs), 0, wl(TAIL_PIVOT.wl)));
    const axleX = D.TAIL_WHEEL.x - fs(TAIL_PIVOT.fs), axleZ = D.GROUND_Z - TAIL_TYRE.radius - wl(TAIL_PIVOT.wl);
    // Strut straight down from the pivot to the castering head; the fork trails the swivel axis to the axle.
    const head = axleZ - 0.12;
    const fixed = new MeshBatch();
    fixed.add(m.cast, tube([0, -0.05, 0], [0, 0.05, 0], 0.03, 0.03, 14));
    fixed.add(m.cast, tube([0, 0, 0], [0, 0, head * 0.6], 0.042, 0.04, 18));
    pivot.add(fixed.build('ah56TailStrut'));
    const slider = new THREE.Group(); slider.name = 'ah56TailOleo'; pivot.add(slider);
    const piston = new MeshBatch();
    piston.add(m.metal, tube([0, 0, head * 0.55], [0, 0, head], 0.03, 0.03, 14));
    slider.add(piston.build('ah56TailPiston'));
    const caster = new THREE.Group(); caster.name = 'ah56TailCaster'; caster.position.copy(frd(0, 0, head)); slider.add(caster);
    const fork = new MeshBatch();
    fork.add(m.cast, box([0, 0, 0.01], [0.08, 0.17, 0.05], 0.01));
    for (const s of [-1, 1]) fork.add(m.cast, tube([0, s * 0.075, 0.02], [axleX, s * 0.075, 0.12], 0.016, 0.016, 10));
    // Tail-wheel lock pin housing (P: lockable).
    fork.add(m.dark, tube([0.04, 0, -0.02], [0.08, 0, -0.02], 0.014, 0.014, 10));
    caster.add(fork.build('ah56TailFork'));
    const wheel = new THREE.Group(); wheel.name = 'ah56TailWheel'; wheel.position.copy(frd(axleX, 0, 0.12)); caster.add(wheel);
    const tyre = new MeshBatch(); wheelParts(tyre, m, TAIL_TYRE.radius, TAIL_TYRE.width, TAIL_TYRE.rim);
    const tyreGroup = tyre.build('ah56TailTyre'); tyreGroup.children.forEach(c => { if (c instanceof THREE.Mesh && c.material === m.rubber) c.name = 'ah56Tyre'; });
    wheel.add(tyreGroup);
    this.group.add(pivot);
    return { pivot, slider, caster, wheel, axis: new THREE.Vector3(0, -1, 0), retract: -TAIL_RETRACT };
  }

  /** Pose from the aircraft state (absent: gear down, no compression). */
  update(state?: Pick<AircraftState, 'gear' | 'wheels'>): void {
    this.legs.forEach((leg, i) => {
      const e = THREE.MathUtils.clamp(state?.gear.extension[i] ?? 1, 0, 1);
      leg.pivot.rotation.x = (1 - e) * leg.retract;
      leg.pivot.visible = true;
      const w = state?.wheels[i];
      const comp = Math.max(0, Math.min(0.12, w?.compression ?? 0)) * e;
      leg.slider.position.copy(leg.axis).multiplyScalar(-comp);
      leg.wheel.rotation.x = -(w?.rotation ?? 0);
      if (leg.caster) leg.caster.rotation.y = -(w?.steerAngle ?? 0);
    });
  }
}
