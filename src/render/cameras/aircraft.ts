// What the cameras need to know of the aircraft flown: where its pilot's eye is, how big it is and where its
// pilot looks by default. CameraSystem.setAircraft hands these to the rigs; until it is called, and as the
// default of everything that takes one of them, they are the Cessna 172S's.

import { C172S_GEOMETRY } from '../../aircraft/c172s/geometry';
import { C172S_VISUAL } from '../../aircraft/c172s/visual';
import type { Vec3 } from '../../core/math';

export interface CameraAircraft {
  /** The pilot's design eye point, body FRD from the reference point, m (AircraftGeometry.fuselage.pilotEye). */
  pilotEye: Readonly<Vec3>;
  /** Bounding radius about the reference point, m (AircraftGeometry.bounds.radius). */
  radius: number;
  /** Size the fly-by and tower cameras zoom to fit, m: wingspan plus margin (AircraftGeometry.bounds.fitSize). */
  fitSize: number;
  /** Pitch of the default cockpit view, degrees, + up (CockpitDef.defaultPitchDeg). */
  defaultPitchDeg: number;
  /** Optional vertical FOV for cockpits with a low central console. */
  defaultFovDeg?: number;
  /** The instrument focus view (CockpitDef.focus); absent: the focus key does nothing. */
  focus?: CockpitFocus;
}

/**
 * The instrument focus view of a cockpit (the Q key): the head turned `yawDeg` (+ left) and `pitchDeg` (+ up) from
 * straight ahead, the same angles as CockpitDef.defaultPitchDeg, with a vertical field of view of `fovDeg`. Chosen so
 * the main flight and engine instruments on the pilot's side are legible (a 3-1/8 in dial ~120 px across or more on a
 * 991 px high view) while the top of the frame still looks out through the windscreen.
 */
export interface CockpitFocus {
  yawDeg: number;
  pitchDeg: number;
  fovDeg: number;
}

export const C172S_CAMERA: CameraAircraft = {
  pilotEye: C172S_GEOMETRY.fuselage.pilotEye,
  radius: C172S_GEOMETRY.bounds.radius,
  fitSize: C172S_GEOMETRY.bounds.fitSize,
  defaultPitchDeg: C172S_VISUAL.cockpit.defaultPitchDeg,
};
