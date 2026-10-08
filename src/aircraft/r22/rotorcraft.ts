import { DEG, HP } from '../../core/math';
import type { RotorcraftDefinition } from '../../physics/rotorcraft/definition';
import { R22_MAP, R22_VNE } from './limits';
import { MAIN_HUB, MAIN_ROTOR_RADIUS, TAIL_HUB, TAIL_ROTOR_RADIUS,
  SKID_HALF_TRACK, SKID_CONTACT_FRONT_X, SKID_CONTACT_REAR_X, SKID_Z, HORIZONTAL_STABILIZER as HS } from './dimensions';

/** R22 Beta II baseline. Published dimensions/speeds plus explicitly estimated dynamic parameters;
 * see docs/r22-flight-model.md before interpreting these as validated handling data. */
export const R22_ROTORCRAFT: RotorcraftDefinition = {
  // POH 1-6: 100% = 510 / 2550 rpm; normal operation at 104% (1-5).
  nominalRpm: 510 * 1.04, referenceRpm: 510, rotation: 1, engineRatio: 5, tailRatio: 47 / 11 * 1.5,
  airspeedLimits: R22_VNE, manifoldLimits: R22_MAP,
  transmissionEfficiency: 0.94, cyclicLimit: 10.75 * DEG,
  // Stop angle, actuator time, torque capacity and throttle linkage gains are engineering estimates.
  teeterLimit: 12 * DEG,
  systems: { clutchSeconds: 45, beltTorque: 520, correlator: 0.7, governorRate: 0.3,
    continuousPower: 124 * HP, takeoffPower: 131 * HP, takeoffSeconds: 300 },
  main: { radius: MAIN_ROTOR_RADIUS, rootCutout: 0.75, chord: 0.18923, blades: 2,
    // R22 MM 10.122: pitch at .75R, 2 ±.5° down / 14 ±.5° up; final low stop is flight-rigged (10.250).
    // Flight-rigged at the upper end of that tolerance against MM Fig 10-15 (see model notes).
    minPitch: 2.5 * DEG, maxPitch: 14 * DEG, twist: -8 * DEG,
    // Pokhrel et al. (2015), p. 3: kappa = 1.15, effective induced radius = .9R. Combined here
    // relative to the full disc area. Engineering estimate including tip loss, not measured R22 polars.
    liftSlope: 5.7, maxCl: 1.25, profileCd: 0.009, inducedDrag: 0.009, inducedFactor: 1.15 / 0.9,
    // ESTIMATE: two ~12 kg blades distributed from .75 to 3.84 m give ~146 kg m², including hub.
    inertia: 146, hub: MAIN_HUB },
  tail: { radius: TAIL_ROTOR_RADIUS, rootCutout: 0.1, chord: 0.1016, blades: 2,
    // MM 10.140: full right 9.6–10.6° nose-right, full left 19–19.5° nose-left.
    minPitch: -10 * DEG, maxPitch: 19.25 * DEG, twist: 0,
    liftSlope: 5.7, maxCl: 1.2, profileCd: 0.012, inducedDrag: 0.012,
    inertia: 0.22, hub: TAIL_HUB },
  // ESTIMATES from POH 1-3 three-view proportions; finite-span slopes, symmetric section.
  stabilizer: { centre: { x: HS.leadingX - (HS.leftChord + HS.rightChord) / 8, y: 0, z: HS.z },
    area: HS.span * (HS.leftChord + HS.rightChord) / 2, liftSlope: 3.4, incidence: 0, maxCl: 1.1, wash: 0.45 },
  fins: [
    { centre: { x: TAIL_HUB.x + 0.12, y: 0, z: TAIL_HUB.z - 0.42 }, area: 0.25, liftSlope: 2.8, incidence: 0, maxCl: 1.1 },
    { centre: { x: TAIL_HUB.x + 0.18, y: 0, z: TAIL_HUB.z + 0.3 }, area: 0.17, liftSlope: 2.6, incidence: 0, maxCl: 1.1 },
  ],
  fuselageMoment: { pitch: 0.12, yaw: 0.06 },
  // Pokhrel et al., AHS Sustainability 2015, p. 3: 5.26 ft² (Prouty estimate, not a wind-tunnel datum).
  // https://www.researchgate.net/publication/303753069
  dragArea: { x: 5.26 * 0.3048 ** 2, y: 1.8, z: 2.2 }, dragCentre: { x: -0.35, y: 0, z: 0 },
  skids: { halfTrack: SKID_HALF_TRACK, front: SKID_CONTACT_FRONT_X, rear: SKID_CONTACT_REAR_X, z: SKID_Z,
    stiffness: 65000, damping: 2200, friction: 0.65, maxSink: 3.5 },
};
