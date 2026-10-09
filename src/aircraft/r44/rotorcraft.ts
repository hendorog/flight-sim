// PLACEHOLDER dynamics derived from the R22. Published R44 geometry and RPM do not validate these loads.
// Flight-model owner must replace/calibrate inertias, polars, rigging, drivetrain, governor and airframe data.
import { DEG, type Vec3 } from '../../core/math';
import type { RotorcraftDefinition } from '../../physics/rotorcraft/definition';
import { R22_ROTORCRAFT as base } from '../r22/rotorcraft';
import { R44_REFERENCE as V } from './reference';
import { R44_MAP, R44_VNE } from './limits';
import { MAIN_HUB, MAIN_ROTOR_RADIUS, MAIN_ROTOR_CHORD, MAIN_ROTOR_TWIST_DEG,
  TAIL_HUB, TAIL_ROTOR_RADIUS, TAIL_ROTOR_CHORD, SKID_Z, SKID_HALF_TRACK,
  SKID_CONTACT_FRONT_X, SKID_CONTACT_REAR_X, HORIZONTAL_STABILIZER as HS,
  UPPER_FIN_OUTLINE, LOWER_FIN_OUTLINE, TAIL_STINGER, TAIL_STINGER_RADIUS } from './dimensions';

/** Projected area/centroid of the shared x/z outline. Centroid as force application point is an ESTIMATE. */
function finGeometry(outline: readonly Vec3[]): { centre: Vec3; area: number } {
  let twiceArea = 0, xMoment = 0, zMoment = 0;
  outline.forEach((a, i) => {
    const b = outline[(i + 1) % outline.length], cross = a.x * b.z - b.x * a.z;
    twiceArea += cross; xMoment += (a.x + b.x) * cross; zMoment += (a.z + b.z) * cross;
  });
  return { area: Math.abs(twiceArea) / 2,
    centre: { x: xMoment / (3 * twiceArea), y: outline[0].y, z: zMoment / (3 * twiceArea) } };
}

export const R44_ROTORCRAFT: RotorcraftDefinition = {
  ...base,
  referenceRpm: V.rotorRpm100, nominalRpm: V.rotorRpm100 * 1.015,
  // POH 1-6 tach references; equivalent to the rounded .778 × 11/57 gearing in 1-4.
  engineRatio: V.engineRpm100 / V.rotorRpm100, tailRatio: 57 / 11 * 31 / 27,
  airspeedLimits: R44_VNE, manifoldLimits: R44_MAP,
  // POH 7-7: three irreversible hydraulic main-rotor servos; pedals remain mechanical (7-6).
  controlSystem: { cyclic: 'hydraulic', collective: 'hydraulic', pedals: 'mechanical' },
  systems: { ...base.systems, continuousPower: V.continuousPower, takeoffPower: V.takeoffPower,
    // POH 7-6/7-25. Actuator times/gains/deadband remain R22-derived estimates.
    governorEngage: 0.8, lowRpmWarning: 0.97, beltTorque: 1000 },
  main: { ...base.main, radius: MAIN_ROTOR_RADIUS, hub: MAIN_HUB,
    chord: (MAIN_ROTOR_CHORD[0] + MAIN_ROTOR_CHORD[1]) / 2, twist: MAIN_ROTOR_TWIST_DEG * DEG,
    rootCutout: 1.0, inertia: 450 },
  tail: { ...base.tail, radius: TAIL_ROTOR_RADIUS, hub: TAIL_HUB, chord: TAIL_ROTOR_CHORD,
    rootCutout: 0.12, inertia: 0.65 },
  stabilizer: { ...base.stabilizer, centre: { x: HS.leadingX - (HS.leftChord + HS.rightChord) / 8, y: 0, z: HS.z },
    area: HS.span * (HS.leftChord + HS.rightChord) / 2 },
  fins: [
    { ...base.fins[0], ...finGeometry(UPPER_FIN_OUTLINE) },
    { ...base.fins[1], ...finGeometry(LOWER_FIN_OUTLINE) },
  ],
  dragArea: { x: 0.9, y: 3.0, z: 3.6 }, dragCentre: { x: 0, y: 0, z: 0 },
  fuselageWash: 1 + -MAIN_HUB.z / Math.hypot(MAIN_ROTOR_RADIUS, MAIN_HUB.z),
  tailProtection: { ...base.tailProtection!, stinger: TAIL_STINGER, radius: TAIL_STINGER_RADIUS, fin: LOWER_FIN_OUTLINE },
  skids: { ...base.skids, halfTrack: SKID_HALF_TRACK, front: SKID_CONTACT_FRONT_X,
    rear: SKID_CONTACT_REAR_X, z: SKID_Z, stiffness: 110000, damping: 3600 },
};
