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
}

export const C172S_CAMERA: CameraAircraft = {
  pilotEye: C172S_GEOMETRY.fuselage.pilotEye,
  radius: C172S_GEOMETRY.bounds.radius,
  fitSize: C172S_GEOMETRY.bounds.fitSize,
  defaultPitchDeg: C172S_VISUAL.cockpit.defaultPitchDeg,
};
