// R44 Raven II teetering-rotor data. Published dimensions/rigging plus explicit engineering estimates.
// See docs/r44-flight-model.md for chart errors and limitations; no flight-test handling validation.
import { DEG, type Vec3 } from '../../core/math';
import type { RotorcraftDefinition } from '../../physics/rotorcraft/definition';
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
  referenceRpm: V.rotorRpm100, nominalRpm: V.rotorRpm100 * 1.015,
  // POH 1-6 tach references; equivalent to the rounded .778 × 11/57 gearing in 1-4.
  engineRatio: V.engineRpm100 / V.rotorRpm100, tailRatio: 57 / 11 * 31 / 27,
  rotation: 1, transmissionEfficiency: 0.94,
  // MM 10.121 longitudinal stops, midpoint 13.875 deg. The shared solver has one symmetric
  // disc-tilt command, not individual blade-pitch stops (lateral 7.5–8.5 left / 6–7 right).
  cyclicLimit: 13.875 * DEG, teeterLimit: 12 * DEG,
  airspeedLimits: R44_VNE, manifoldLimits: R44_MAP,
  // POH 7-7: three irreversible hydraulic main-rotor servos; pedals remain mechanical (7-6).
  controlSystem: { cyclic: 'hydraulic', collective: 'hydraulic', pedals: 'mechanical' },
  systems: { continuousPower: V.continuousPower, takeoffPower: V.takeoffPower, takeoffSeconds: 300,
    // POH 7-6/7-25 thresholds. Actuator time, gains, belt capacity and switch deadband ESTIMATED.
    clutchSeconds: 45, beltTorque: 1000, correlator: 0.3, governorRate: 0.3,
    governorGain: 10, governorIntegralGain: 1, governorLead: 0.5,
    governorEngage: 0.8, lowRpmWarning: 0.97, powerCheckMinRpm: 0.97, hornCollectiveMin: 0.02 },
  main: { radius: MAIN_ROTOR_RADIUS, hub: MAIN_HUB, blades: 2,
    chord: (MAIN_ROTOR_CHORD[0] + MAIN_ROTOR_CHORD[1]) / 2, twist: MAIN_ROTOR_TWIST_DEG * DEG,
    // MM 10.122: 1–2 deg on MT525-1 at .75R, then 12.5–13.5 deg travel.
    // Those readings are averaged (÷2, not +2 deg). The unknown fixture/zero-lift offset is
    // absorbed into an effective section stop, checked against MM Fig 10-17; not a measured offset.
    minPitch: 1.75 * DEG, maxPitch: 14.75 * DEG,
    // ESTIMATED finite-blade polar. Aggregate induction 1.20 calibrated against POH 5-4/5-5;
    // it includes tip/nonuniform-wake losses. Remaining IGE/OGE disagreement is documented.
    liftSlope: 5.7, maxCl: 1.25, profileCd: 0.009, inducedDrag: 0.009, inducedFactor: 1.20,
    // ESTIMATE: two 21 kg blades uniform from 1 to 5.03 m plus ~13 kg m² root/hub allowance.
    rootCutout: 1.0, inertia: 450 },
  tail: { radius: TAIL_ROTOR_RADIUS, hub: TAIL_HUB, chord: TAIL_ROTOR_CHORD, blades: 2,
    // MM 10.140: left 18.5–19 deg, right 15.5–16.5 deg. Symmetric-section approximation.
    minPitch: -16 * DEG, maxPitch: 18.75 * DEG, twist: 0,
    liftSlope: 5.7, maxCl: 1.2, profileCd: 0.012, inducedDrag: 0.012,
    // ESTIMATE: two ~1.5 kg blades and hub.
    rootCutout: 0.12, inertia: 0.65 },
  // Surface slopes/incidences and wake immersion are estimates; all areas/arms use shared geometry.
  stabilizer: { centre: { x: HS.leadingX - (HS.leftChord + HS.rightChord) / 8, y: 0, z: HS.z },
    area: HS.span * (HS.leftChord + HS.rightChord) / 2, liftSlope: 3.8, incidence: 0, maxCl: 1.1, wash: 0.45 },
  fins: [
    { ...finGeometry(UPPER_FIN_OUTLINE), liftSlope: 2.8, incidence: 0, maxCl: 1.1 },
    { ...finGeometry(LOWER_FIN_OUTLINE), liftSlope: 2.6, incidence: 0, maxCl: 1.1 },
  ],
  // Longitudinal flat-plate area calibrated to POH 5-7's later-aircraft Vh (~108 KTAS at MCP).
  // Lateral/vertical areas and destabilising derivatives remain geometric engineering estimates.
  fuselageMoment: { pitch: 0.2, yaw: 0.1 },
  dragArea: { x: 0.65, y: 3.0, z: 3.6 }, dragCentre: { x: 0, y: 0, z: 0 },
  fuselageWash: 1 + -MAIN_HUB.z / Math.hypot(MAIN_ROTOR_RADIUS, MAIN_HUB.z),
  // Contact compliance and damage thresholds are estimates, not certified structural limits.
  tailProtection: { stinger: TAIL_STINGER, radius: TAIL_STINGER_RADIUS, fin: LOWER_FIN_OUTLINE,
    stiffness: 20000, damping: 800, maxSink: 1, maxCompression: 0.08 },
  skids: { halfTrack: SKID_HALF_TRACK, front: SKID_CONTACT_FRONT_X,
    rear: SKID_CONTACT_REAR_X, z: SKID_Z, stiffness: 110000, damping: 3600, friction: 0.5, maxSink: 3.5,
    surfaces: {
      grass: { static: 0.65, sliding: 0.2, lateral: 0.65 },
      dirt: { static: 0.65, sliding: 0.25, lateral: 0.65 },
      runway: { static: 0.6, sliding: 0.3, lateral: 0.3 },
      taxiway: { static: 0.6, sliding: 0.3, lateral: 0.3 },
      rock: { static: 0.6, sliding: 0.4, lateral: 0.5 },
      snow: { static: 0.2, sliding: 0.08, lateral: 0.2 },
      water: { static: 0, sliding: 0, lateral: 0 },
    } },
};
