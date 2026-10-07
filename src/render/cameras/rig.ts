// Interface implemented by each camera mode.

import type { SimContext } from '../../core/context';
import type { CameraAircraft } from './aircraft';
import type { AircraftPose, CameraPose } from './pose';

export interface CameraRig {
  /**
   * Called when the mode becomes active. `from` is the camera's current pose, so a rig can start from
   * where the viewer is (e.g. the flyby camera picks its first spot).
   */
  activate(ctx: SimContext, aircraft: AircraftPose, from: CameraPose): void;
  /**
   * Compute this frame's pose.
   * @param dt     simulation dt (0 while paused): drives physical motion such as head inertia and lag
   * @param realDt wall-clock dt: drives user-facing smoothing (look, zoom) so it still works while paused
   */
  update(dt: number, realDt: number, ctx: SimContext, aircraft: AircraftPose, out: CameraPose): void;
  /** Mouse drag / captured-mouse movement in pixels. */
  look(dx: number, dy: number): void;
  /** Wheel notches or zoom keys, + = zoom in / closer. */
  zoom(steps: number): void;
  /**
   * Zoom about a point on screen: (nx, ny) are normalised device coordinates of the pointer (-1..1, y up) and
   * aspect the viewport width/height. The direction under the pointer stays under the pointer, so a quick look
   * at an instrument is a wheel turn with the mouse over it. Rigs that zoom by distance rather than FOV omit it.
   */
  zoomAt?(steps: number, nx: number, ny: number, aspect: number): void;
  recentre(): void;
  /** Another aircraft is flown (CameraSystem.setAircraft). Rigs that use nothing of it omit this. */
  setAircraft?(aircraft: CameraAircraft): void;
  /** Minimum clearance of this camera above the terrain, m. */
  readonly groundClearance: number;
  /** External camera looking at the aircraft: when lifted clear of the terrain it turns to keep the aircraft in place on screen. */
  readonly watchesAircraft: boolean;
  /** Following camera: raised when a ridge would come between it and the aircraft (fixed observers are not). */
  readonly lineOfSight: boolean;
}
