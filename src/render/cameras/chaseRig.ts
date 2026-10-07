// Chase camera: follows behind the aircraft through a lagged reference frame.
//
// The frame's heading, pitch and roll chase the aircraft's with first-order lags, and only part of the
// pitch and bank is followed, so manoeuvres read clearly on screen (the aircraft visibly rolls and pitches
// before the camera catches up) while the camera never swings wildly.

import * as THREE from 'three';
import { clamp, DEG, quat, wrapPi } from '../../core/math';
import { quatToThree } from '../../core/frames';
import type { SimContext } from '../../core/context';
import { lookAtQuat, smoothing, type AircraftPose, type CameraPose } from './pose';
import type { CameraRig } from './rig';

const DEFAULT_DISTANCE = 15;
const HEIGHT_RATIO = 0.2; // camera height above the aircraft as a fraction of distance
const FOV = 55;
/** Lag time constants, s, and the fraction of each angle the camera follows. */
const HEADING_TAU = 0.45;
const PITCH_TAU = 0.35;
const ROLL_TAU = 0.3;
const PITCH_FOLLOW = 0.75;
const ROLL_FOLLOW = 0.45;

export class ChaseRig implements CameraRig {
  readonly groundClearance = 1.0;
  readonly watchesAircraft = true;
  readonly lineOfSight = true;
  private distance = DEFAULT_DISTANCE;
  private targetDistance = DEFAULT_DISTANCE;
  private heading = 0;
  private pitch = 0;
  private roll = 0;
  /** User orbit offsets from dragging, rad. */
  private azimuth = 0;
  private elevation = 0;
  private readonly frame = new THREE.Quaternion();
  private readonly offset = new THREE.Vector3();
  private readonly target = new THREE.Vector3();
  private readonly up = new THREE.Vector3();

  activate(ctx: SimContext): void {
    const s = quat.toEuler(ctx.state.orientation);
    this.heading = s.heading;
    this.pitch = s.pitch * PITCH_FOLLOW;
    this.roll = s.roll * ROLL_FOLLOW;
  }

  update(dt: number, realDt: number, ctx: SimContext, a: AircraftPose, out: CameraPose): void {
    // Attitude from the interpolated orientation (the scalar roll/pitch/heading are the last physics step's).
    const s = quat.toEuler(ctx.state.orientation);
    this.heading += wrapPi(s.heading - this.heading) * smoothing(dt, HEADING_TAU);
    this.pitch += (s.pitch * PITCH_FOLLOW - this.pitch) * smoothing(dt, PITCH_TAU);
    this.roll += (s.roll * ROLL_FOLLOW - this.roll) * smoothing(dt, ROLL_TAU);
    this.distance += (this.targetDistance - this.distance) * smoothing(realDt, 0.15);

    quatToThree(quat.fromEuler(this.roll, this.pitch, this.heading), this.frame);
    // Behind (+Z in model space) and above, rotated by the user's drag offsets.
    const el = clamp(Math.atan(HEIGHT_RATIO) + this.elevation, -20 * DEG, 85 * DEG);
    const d = this.distance;
    this.offset.set(Math.sin(this.azimuth) * Math.cos(el) * d, Math.sin(el) * d, Math.cos(this.azimuth) * Math.cos(el) * d);
    this.offset.applyQuaternion(this.frame);
    out.position.copy(a.position).add(this.offset);

    // Aim a little above the aircraft so it sits just below the centre of the view.
    this.up.set(0, 1, 0).applyQuaternion(this.frame);
    this.target.copy(a.position).addScaledVector(this.up, 0.08 * d);
    lookAtQuat(out.position, this.target, this.up, out.quaternion);
    out.fov = FOV;
  }

  look(dx: number, dy: number): void {
    this.azimuth -= dx * 0.005;
    this.elevation = clamp(this.elevation + dy * 0.005, -30 * DEG, 75 * DEG);
  }

  zoom(steps: number): void {
    this.targetDistance = clamp(this.targetDistance * Math.pow(0.88, steps), 7, 120);
  }

  recentre(): void {
    this.azimuth = 0;
    this.elevation = 0;
    this.targetDistance = DEFAULT_DISTANCE;
  }
}
