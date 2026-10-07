// Cockpit camera: the pilot's eye in the left seat, with mouse-look, FOV zoom and head inertia.

import * as THREE from 'three';
import { clamp, DEG, type Vec3 } from '../../core/math';
import type { SimContext } from '../../core/context';
import { C172S_CAMERA, type CameraAircraft } from './aircraft';
import { HeadMotion } from './headMotion';
import { smoothing, zoomFov, type AircraftPose, type CameraPose } from './pose';
import type { CameraRig } from './rig';

const DEFAULT_FOV = 60;
const YAW_LIMIT = 165 * DEG;
const PITCH_MIN = -75 * DEG;
const PITCH_MAX = 80 * DEG;
/** Radians of look per pixel of mouse drag. */
const LOOK_SENSITIVITY = 0.0035;
/** The head turns slightly into a turn: yaw per rad/s of turn rate, and its limit. */
const TURN_LOOK_GAIN = 1.2;
const TURN_LOOK_MAX = 8 * DEG;

/**
 * The head turns about the top of the neck, not about the eyes: the eyes sit ~0.09 m forward of and ~0.07 m
 * above that pivot (model space: x right, y up, z aft). Looking to the side therefore moves the eye sideways
 * and slightly back, and looking up moves it up and back, as a real head does.
 */
const EYE_FROM_NECK = new THREE.Vector3(0, 0.07, -0.09);
/** A head alone turns about this far; beyond it the torso twists and the pilot leans (look-back views). */
const HEAD_YAW_MAX = 70 * DEG;
/** Look angle at which the lean starts, and where it is complete. */
const LEAN_START = 60 * DEG;
const LEAN_FULL = 150 * DEG;
/**
 * Lean at a full look-back, m: forward (away from the seat back) and toward the looked-at side. The pilot
 * sits in the left seat, so there is little room toward the door (outboard, left) and plenty over the centre
 * of the cabin (inboard, right). Looking back past the shoulder then sees the rear cabin, the rear window and
 * the tail beside the seat back rather than the inside of the pilot's own headrest.
 */
const LEAN_FORWARD = 0.13;
const LEAN_OUTBOARD = 0.03;
const LEAN_INBOARD = 0.17;

/**
 * Glance (Flight School callouts): the head turns toward a model-space point (x right, y up, z aft, m) while
 * set, then back to where the pilot was looking. A module-level hook so the school can drive the cockpit
 * camera without a reference to the camera system. The pilot looking around (mouse, look keys) cancels it.
 */
export interface CockpitGlance { x: number; y: number; z: number }
let glanceTarget: CockpitGlance | null = null;
let glanceSeq = 0;
/** Glance at a model-space point, or null to look back. */
export function setCockpitGlance(p: CockpitGlance | null): void {
  glanceTarget = p ? { x: p.x, y: p.y, z: p.z } : null;
  glanceSeq++;
}
/** The glance in progress (null: none), e.g. for the automation API. */
export function cockpitGlance(): CockpitGlance | null {
  return glanceTarget;
}
/**
 * Head yaw (+ left) and pitch (+ up) that put a model-space point at the centre of the view from the eye
 * (`eye`: the pilot's design eye point, body FRD, m).
 */
export function glanceAngles(p: CockpitGlance, eye: Readonly<Vec3> = C172S_CAMERA.pilotEye): { yaw: number; pitch: number } {
  const dx = p.x - eye.y;
  const dy = p.y + eye.z;
  const dz = p.z + eye.x;
  return { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) };
}

const X_AXIS = new THREE.Vector3(1, 0, 0);
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);
/** Eye relative to the neck in a default view of that pitch, so that view keeps the eye exactly at pilotEye. */
const eyeInDefaultView = (pitch: number, out = new THREE.Vector3()): THREE.Vector3 => out.copy(EYE_FROM_NECK).applyAxisAngle(X_AXIS, pitch);
const C172S_EYE_DEFAULT = eyeInDefaultView(C172S_CAMERA.defaultPitchDeg * DEG);

export class CockpitRig implements CameraRig {
  readonly groundClearance = 0.3;
  readonly watchesAircraft = false;
  readonly lineOfSight = false;
  private readonly head = new HeadMotion();
  private pilotEye = C172S_CAMERA.pilotEye;
  /** Default view slightly below the horizon so the glare shield and upper panel are in view. */
  private defaultPitch = C172S_CAMERA.defaultPitchDeg * DEG;
  private readonly eyeDefault = eyeInDefaultView(this.defaultPitch);
  private yaw = 0;
  private pitch = this.defaultPitch;
  private targetYaw = 0;
  private targetPitch = this.defaultPitch;
  private fov = DEFAULT_FOV;
  private targetFov = DEFAULT_FOV;
  private turnLook = 0;
  private readonly eye = new THREE.Vector3();
  private readonly neckOffset = new THREE.Vector3();
  private readonly q = new THREE.Quaternion();
  private readonly qHead = new THREE.Quaternion();
  /** The pilot's own view while a glance holds the head elsewhere; the glance sequence it belongs to. */
  private saved: { yaw: number; pitch: number } | null = null;
  private seenGlance = 0;

  activate(): void {
    this.head.reset();
  }

  /** Another aircraft: its eye point and default view, and the pilot looking straight ahead in it. */
  setAircraft(a: CameraAircraft): void {
    this.pilotEye = a.pilotEye;
    this.head.eye = a.pilotEye;
    this.defaultPitch = a.defaultPitchDeg * DEG;
    eyeInDefaultView(this.defaultPitch, this.eyeDefault);
    this.recentre();
    this.yaw = this.targetYaw;
    this.pitch = this.targetPitch;
  }

  /** Vertical kick from a touchdown, m/s of sink. */
  touchdown(sinkRate: number): void {
    this.head.bump(sinkRate);
  }

  update(dt: number, realDt: number, ctx: SimContext, a: AircraftPose, out: CameraPose): void {
    const s = ctx.state;
    const surface = s.onGround ? ctx.env.surface(s.position.x, s.position.y) : 'runway';
    const h = this.head.update(dt, s, ctx.weather.turbulence, surface);

    this.applyGlance();
    // A glance turns the head more slowly than a mouse look, so the student can follow where it goes.
    const k = smoothing(realDt, this.saved ? 0.18 : 0.06);
    this.yaw += (this.targetYaw - this.yaw) * k;
    this.pitch += (this.targetPitch - this.pitch) * k;
    this.fov += (this.targetFov - this.fov) * smoothing(realDt, 0.08);
    if (dt > 0) {
      // Body yaw rate r > 0 is a right turn; looking right is a negative yaw about three's +Y.
      const want = clamp(-s.angularVelocity.z * TURN_LOOK_GAIN, -TURN_LOOK_MAX, TURN_LOOK_MAX);
      this.turnLook += (want - this.turnLook) * smoothing(dt, 1.2);
    }

    // Eye point: FRD (x, y, z) -> model space (y, -z, -x), moved by the head turning about the neck and the
    // torso lean, then into the world with the aircraft pose.
    const e = this.pilotEye;
    const o = h.offset;
    this.eye.set(e.y + o.y, -(e.z + o.z), -(e.x + o.x));
    this.eye.add(headOffset(this.yaw + this.turnLook, this.pitch, this.neckOffset, this.qHead, this.q, this.eyeDefault));
    this.eye.applyQuaternion(a.quaternion).add(a.position);
    out.position.copy(this.eye);

    // Orientation: aircraft attitude, then head yaw (about model up) and pitch (about model right), then
    // the small shake rotations (body roll about -Z, pitch about +X, yaw about -Y in model space).
    out.quaternion.copy(a.quaternion);
    out.quaternion.multiply(this.q.setFromAxisAngle(Y_AXIS, this.yaw + this.turnLook - h.shake.z));
    out.quaternion.multiply(this.q.setFromAxisAngle(X_AXIS, this.pitch + h.shake.y));
    out.quaternion.multiply(this.q.setFromAxisAngle(Z_AXIS, -h.shake.x));
    out.fov = this.fov;
  }

  look(dx: number, dy: number): void {
    if (this.saved) {
      // The student looks around: the glance is over and their own movement continues from here.
      this.saved = null;
      glanceTarget = null;
      this.seenGlance = ++glanceSeq;
    }
    this.targetYaw = clamp(this.targetYaw - dx * LOOK_SENSITIVITY, -YAW_LIMIT, YAW_LIMIT);
    this.targetPitch = clamp(this.targetPitch - dy * LOOK_SENSITIVITY, PITCH_MIN, PITCH_MAX);
  }

  zoom(steps: number): void {
    this.targetFov = zoomFov(this.targetFov, steps, 20, 95);
  }

  zoomAt(steps: number, nx: number, ny: number, aspect: number): void {
    const before = this.targetFov;
    this.zoom(steps);
    // Angular offsets of the pointer from the view centre before and after the FOV change; turn the head by
    // the difference so the same direction stays under the pointer (looking right is negative yaw).
    const t0 = Math.tan((before * DEG) / 2);
    const t1 = Math.tan((this.targetFov * DEG) / 2);
    const dYaw = Math.atan(nx * t0 * aspect) - Math.atan(nx * t1 * aspect);
    const dPitch = Math.atan(ny * t0) - Math.atan(ny * t1);
    this.targetYaw = clamp(this.targetYaw - dYaw, -YAW_LIMIT, YAW_LIMIT);
    this.targetPitch = clamp(this.targetPitch + dPitch, PITCH_MIN, PITCH_MAX);
  }

  /** Follow the module-level glance: turn toward it, and back to the saved view when it is cleared. */
  private applyGlance(): void {
    if (this.seenGlance === glanceSeq) return;
    this.seenGlance = glanceSeq;
    const g = glanceTarget;
    if (g) {
      this.saved ??= { yaw: this.targetYaw, pitch: this.targetPitch };
      const a = glanceAngles(g, this.pilotEye);
      this.targetYaw = clamp(a.yaw, -YAW_LIMIT, YAW_LIMIT);
      this.targetPitch = clamp(a.pitch, PITCH_MIN, PITCH_MAX);
    } else if (this.saved) {
      this.targetYaw = this.saved.yaw;
      this.targetPitch = this.saved.pitch;
      this.saved = null;
    }
  }

  recentre(): void {
    this.saved = null;
    this.targetYaw = 0;
    this.targetPitch = this.defaultPitch;
    this.targetFov = DEFAULT_FOV;
  }
}

const smoothstep = (t: number): number => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/**
 * Displacement of the eye from its position in the default view (model space) when the pilot looks `yaw` rad left
 * (+) or right (-) and `pitch` rad up: the head turns about the neck up to HEAD_YAW_MAX, and further look
 * angles come from the torso twisting and leaning forward and toward the looked-at side. `eyeDefault` is the
 * eye relative to the neck in the default view (default: the C172S's, 7 degrees down).
 */
export function headOffset(
  yaw: number,
  pitch: number,
  out = new THREE.Vector3(),
  qHead = new THREE.Quaternion(),
  q = new THREE.Quaternion(),
  eyeDefault: THREE.Vector3 = C172S_EYE_DEFAULT,
): THREE.Vector3 {
  const headYaw = clamp(yaw, -HEAD_YAW_MAX, HEAD_YAW_MAX);
  qHead.setFromAxisAngle(Y_AXIS, headYaw).multiply(q.setFromAxisAngle(X_AXIS, pitch));
  out.copy(EYE_FROM_NECK).applyQuaternion(qHead).sub(eyeDefault);
  const lean = smoothstep((Math.abs(yaw) - LEAN_START) / (LEAN_FULL - LEAN_START));
  // Looking left (yaw > 0) is toward the door for the left-seat pilot: model -x.
  out.x += lean * (yaw > 0 ? -LEAN_OUTBOARD : LEAN_INBOARD);
  out.z -= lean * LEAN_FORWARD;
  return out;
}
