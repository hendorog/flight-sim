// Tower camera: an observer at the control tower (default: near the apron) tracking the aircraft and
// zooming like a pair of binoculars to keep it a readable size at any range.
//
// The given position is the centre of the tower cab at eye height. From there the cab's own structure is in
// the way whenever the aircraft is high (the roof slab), close below (the sill) or behind one of the corner
// mullions, which a binocular field of view magnifies to fill the frame. So the observer stands out on the
// cab's catwalk on the side facing the aircraft, just past the railing: outside the glazing and the mullions,
// clear of the roof overhang above and the catwalk below, with an unobstructed view of the whole sky and
// airfield in the aircraft's direction. The spot follows the aircraft around the catwalk smoothly.

import * as THREE from 'three';
import { clamp, type Vec3 } from '../../core/math';
import { nedToThree } from '../../core/frames';
import { AIRPORT } from '../../core/world';
import { C172S_CAMERA, type CameraAircraft } from './aircraft';
import { fitFov, lookAtQuat, smoothing, WORLD_UP, type AircraftPose, type CameraPose } from './pose';
import type { CameraRig } from './rig';

/** Fallback tower cab when no position is given: just north-west of the apron, 25 m above the field. */
export const DEFAULT_TOWER_NED: Vec3 = {
  x: AIRPORT.apron.north + 60,
  y: AIRPORT.apron.east - 70,
  z: -(AIRPORT.elevation + 25),
};

/**
 * Distance of the observer from the cab centre, m: past the catwalk railing (radius ~4.35 m in
 * world/airport/buildings.ts tower()) and the roof overhang (~4.1 m), out of the glazing (3.1-3.6 m).
 */
export const TOWER_STAND_OFF = 4.6;
/** Time constant with which the observer walks round the catwalk to follow the aircraft, s. */
const WALK_TAU = 1.5;
/** Below this horizontal distance to the aircraft the observer's side is left as it is, m. */
const OVERHEAD = 5;

const DEFAULT_FILL = 0.2;
/** Narrowest view: roughly a pair of 15x binoculars. Widest: the naked eye. */
const MIN_FOV = 2.5;
const MAX_FOV = 50;

export class TowerRig implements CameraRig {
  readonly groundClearance = 1.0;
  readonly watchesAircraft = true;
  readonly lineOfSight = false;
  /** Cab centre at eye height. */
  private readonly centre = new THREE.Vector3();
  /** Observer's position (on the catwalk). */
  private readonly spot = new THREE.Vector3();
  /** Unit horizontal direction from the cab centre to the observer (x, z in three's frame). */
  private dirX = 1;
  private dirZ = 0;
  /** Fraction of the view height the aircraft fills (binocular zoom-to-fit); zoom keys scale it. */
  private fill = DEFAULT_FILL;
  private fov = 30;
  /** Size used for zoom-to-fit, m (wingspan plus margin). */
  private fitSize = C172S_CAMERA.fitSize;

  constructor(
    positionNED: Vec3 = DEFAULT_TOWER_NED,
    private readonly standOff = TOWER_STAND_OFF,
  ) {
    this.setPosition(positionNED);
  }

  /** Move the tower (NED metres: the cab centre at eye height). */
  setPosition(ned: Vec3): void {
    nedToThree(ned, this.centre);
    this.placeSpot();
  }

  /** The observer's current position (three.js world frame). */
  get position(): THREE.Vector3 {
    return this.spot;
  }

  setAircraft(a: CameraAircraft): void {
    this.fitSize = a.fitSize;
  }

  activate(_ctx: unknown, a: AircraftPose): void {
    this.follow(a, Infinity);
    this.fov = this.fit(a);
  }

  update(dt: number, realDt: number, _ctx: unknown, a: AircraftPose, out: CameraPose): void {
    this.follow(a, realDt);
    out.position.copy(this.spot);
    lookAtQuat(out.position, a.position, WORLD_UP, out.quaternion);
    this.fov += (this.fit(a) - this.fov) * smoothing(realDt, 0.4);
    out.fov = this.fov;
  }

  /** Walk round the catwalk toward the aircraft's side (at once when dt is Infinity). */
  private follow(a: AircraftPose, dt: number): void {
    const dx = a.position.x - this.centre.x;
    const dz = a.position.z - this.centre.z;
    const d = Math.hypot(dx, dz);
    if (d < OVERHEAD) return;
    const k = dt === Infinity ? 1 : smoothing(dt, WALK_TAU);
    const x = this.dirX + (dx / d - this.dirX) * k;
    const z = this.dirZ + (dz / d - this.dirZ) * k;
    const n = Math.hypot(x, z);
    // Passing straight through the centre (aircraft swapping sides in one step): jump to the new side.
    if (n < 1e-3) {
      this.dirX = dx / d;
      this.dirZ = dz / d;
    } else {
      this.dirX = x / n;
      this.dirZ = z / n;
    }
    this.placeSpot();
  }

  private placeSpot(): void {
    this.spot.set(this.centre.x + this.dirX * this.standOff, this.centre.y, this.centre.z + this.dirZ * this.standOff);
  }

  private fit(a: AircraftPose): number {
    return fitFov(this.fitSize, this.spot.distanceTo(a.position), this.fill, MIN_FOV, MAX_FOV);
  }

  look(): void {
    // Fixed observer: the mouse does not steer it.
  }

  zoom(steps: number): void {
    this.fill = clamp(this.fill * Math.pow(1.15, steps), 0.02, 0.8);
  }

  recentre(): void {
    this.fill = DEFAULT_FILL;
  }
}
