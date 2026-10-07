// Flyby camera: a fixed spectator position dropped ahead of the flight path and off to one side. It
// tracks the aircraft as it passes, zooming to keep it a constant size on screen, and jumps to a new spot
// ahead once the aircraft has gone past and is far away.

import * as THREE from 'three';
import { clamp } from '../../core/math';
import { nedToThree } from '../../core/frames';
import type { SimContext } from '../../core/context';
import { C172S_CAMERA, type CameraAircraft } from './aircraft';
import { fitFov, lookAtQuat, smoothing, WORLD_UP, type AircraftPose, type CameraPose } from './pose';
import type { CameraRig } from './rig';

/** Zoom-to-fit size of the C172S, m (the rigs take the size of the aircraft flown: setAircraft). */
export const AIRCRAFT_FIT_SIZE = C172S_CAMERA.fitSize;
/** Seconds of flight ahead where the camera is placed. */
const LEAD_TIME = 6;
/** Eye height of a spectator standing on the ground, m. */
const SPECTATOR_HEIGHT = 1.7;

export class FlybyRig implements CameraRig {
  readonly groundClearance = 1.0;
  readonly watchesAircraft = true;
  readonly lineOfSight = false;
  private readonly spot = new THREE.Vector3();
  private placed = false;
  private side = 1;
  private lead = 100;
  /** Fraction of the view height the aircraft should fill; zoom keys scale it. */
  private fill = 0.3;
  private fov = 40;
  /** Size used for zoom-to-fit, m (wingspan plus margin). */
  private fitSize = C172S_CAMERA.fitSize;
  private readonly tmp = new THREE.Vector3();
  private readonly toCam = new THREE.Vector3();

  setAircraft(a: CameraAircraft): void {
    this.fitSize = a.fitSize;
  }

  activate(ctx: SimContext, a: AircraftPose): void {
    this.place(ctx, a);
    this.fov = this.fitFov(a);
  }

  update(dt: number, realDt: number, ctx: SimContext, a: AircraftPose, out: CameraPose): void {
    if (!this.placed || this.shouldReposition(ctx, a)) {
      this.place(ctx, a);
      this.fov = this.fitFov(a);
    }
    out.position.copy(this.spot);
    lookAtQuat(out.position, a.position, WORLD_UP, out.quaternion);
    this.fov += (this.fitFov(a) - this.fov) * smoothing(realDt, 0.25);
    out.fov = this.fov;
  }

  private fitFov(a: AircraftPose): number {
    return fitFov(this.fitSize, this.spot.distanceTo(a.position), this.fill, 4, 60);
  }

  /** Reposition once the aircraft has passed and is well beyond the original lead distance. */
  private shouldReposition(ctx: SimContext, a: AircraftPose): boolean {
    const v = nedToThree(ctx.state.velocity, this.tmp);
    const toCam = this.toCam.subVectors(this.spot, a.position);
    const dist = toCam.length();
    const receding = v.dot(toCam) < 0;
    return dist > 4000 || (receding && dist > Math.max(this.lead * 1.3, 120));
  }

  private place(ctx: SimContext, a: AircraftPose): void {
    const s = ctx.state;
    const speed = Math.hypot(s.velocity.x, s.velocity.y);
    const moving = speed > 3;
    const track = moving ? Math.atan2(s.velocity.y, s.velocity.x) : s.heading;
    this.side = -this.side;
    this.lead = moving ? clamp(speed * LEAD_TIME, 60, 700) : 0;
    const T = moving ? this.lead / speed : 0;

    // Predict where the aircraft will be in T seconds assuming a constant turn rate (Euler heading rate
    // from the body rates), so the camera still ends up beside the flight path during a turn.
    const w = s.angularVelocity;
    const psiDot = (w.y * Math.sin(s.roll) + w.z * Math.cos(s.roll)) / Math.max(Math.cos(s.pitch), 0.2);
    const turn = psiDot * T;
    let fwd: number;
    let across: number;
    if (Math.abs(turn) < 1e-3) {
      fwd = speed * T;
      across = 0;
    } else {
      const r = speed / psiDot;
      fwd = r * Math.sin(turn);
      across = r * (1 - Math.cos(turn));
    }
    const endTrack = track + turn;
    // Offset to one side of the predicted flight path, perpendicular to the track there.
    const lateral = (moving ? 20 + speed * 0.3 : 30) * this.side;
    const north = s.position.x + fwd * Math.cos(track) - across * Math.sin(track) - lateral * Math.sin(endTrack);
    const east = s.position.y + fwd * Math.sin(track) + across * Math.cos(track) + lateral * Math.cos(endTrack);

    // Near the ground stand on it like a spectator; in the air sit a little below the predicted height.
    const ground = ctx.env.groundElevation(north, east);
    const lowAndSlow = s.altitudeAGL < 40 || s.onGround;
    const futureAlt = s.altitudeMSL + s.verticalSpeed * T;
    const alt = lowAndSlow ? ground + SPECTATOR_HEIGHT : Math.max(futureAlt - 10, ground + SPECTATOR_HEIGHT);
    nedToThree({ x: north, y: east, z: -alt }, this.spot);
    this.placed = true;
  }

  look(): void {
    // A spectator camera is not steered by the mouse; the zoom level is the only user control.
  }

  zoom(steps: number): void {
    this.fill = clamp(this.fill * Math.pow(1.15, steps), 0.05, 0.9);
  }

  recentre(): void {
    this.fill = 0.3;
  }
}
