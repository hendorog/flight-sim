// Orbit camera: mouse-orbit around the aircraft with world-up locked. The azimuth is relative to the
// (smoothed) aircraft heading, so the chosen viewing angle is kept through turns.

import { clamp, DEG, quat, wrapPi } from '../../core/math';
import type { SimContext } from '../../core/context';
import { lookAtQuat, smoothing, WORLD_UP, type AircraftPose, type CameraPose } from './pose';
import type { CameraRig } from './rig';

const DEFAULT_AZIMUTH = 145 * DEG; // from the nose, clockwise seen from above: behind and to the right
const DEFAULT_ELEVATION = 12 * DEG;
const DEFAULT_DISTANCE = 20;
const FOV = 50;

export class OrbitRig implements CameraRig {
  readonly groundClearance = 1.0;
  readonly watchesAircraft = true;
  readonly lineOfSight = true;
  private azimuth = DEFAULT_AZIMUTH;
  private elevation = DEFAULT_ELEVATION;
  private distance = DEFAULT_DISTANCE;
  private targetAzimuth = DEFAULT_AZIMUTH;
  private targetElevation = DEFAULT_ELEVATION;
  private targetDistance = DEFAULT_DISTANCE;
  private heading = 0;

  activate(ctx: SimContext): void {
    this.heading = quat.toEuler(ctx.state.orientation).heading;
  }

  update(dt: number, realDt: number, ctx: SimContext, a: AircraftPose, out: CameraPose): void {
    const heading = quat.toEuler(ctx.state.orientation).heading;
    this.heading += wrapPi(heading - this.heading) * smoothing(dt, 0.6);
    const k = smoothing(realDt, 0.08);
    this.azimuth += (this.targetAzimuth - this.azimuth) * k;
    this.elevation += (this.targetElevation - this.elevation) * k;
    this.distance += (this.targetDistance - this.distance) * smoothing(realDt, 0.12);

    // Direction from the aircraft to the camera in NED, then mapped to three (x = E, y = up, z = -N).
    const az = this.heading + this.azimuth;
    const ce = Math.cos(this.elevation);
    const n = Math.cos(az) * ce;
    const e = Math.sin(az) * ce;
    const up = Math.sin(this.elevation);
    out.position.set(e, up, -n).multiplyScalar(this.distance).add(a.position);
    lookAtQuat(out.position, a.position, WORLD_UP, out.quaternion);
    out.fov = FOV;
  }

  look(dx: number, dy: number): void {
    this.targetAzimuth += dx * 0.006;
    this.targetElevation = clamp(this.targetElevation + dy * 0.005, -15 * DEG, 88 * DEG);
  }

  zoom(steps: number): void {
    this.targetDistance = clamp(this.targetDistance * Math.pow(0.88, steps), 6, 600);
  }

  recentre(): void {
    // Take the short way round, however many turns the user has dragged.
    this.targetAzimuth = this.azimuth + wrapPi(DEFAULT_AZIMUTH - this.azimuth);
    this.targetElevation = DEFAULT_ELEVATION;
    this.targetDistance = DEFAULT_DISTANCE;
  }
}
