// Reduced harmonic articulated hub; per-blade transients/ground resonance remain incomplete.
// RFM geometry/limits plus explicitly estimated blade mass, polars, wake and ground coefficients.
import { DEG } from '../../core/math';
import type { RotorcraftDefinition } from '../../physics/rotorcraft/definition';
import { R22_ROTORCRAFT as base } from '../r22/rotorcraft';
import * as D from './dimensions';
import { S269_REFERENCE as V } from './reference';
import { S269_VNE } from './limits';
import { S269_ARTICULATED, S269_BLADE_ROOT } from './articulated';
export const S269_ROTORCRAFT: RotorcraftDefinition = {
  ...base,
  // FAA 4H12 rev32 Note9(b), p19: CB S/N0001 onward, elastomeric lag damper269A1290-3.
  hubModel: { kind: 'articulated', flapHingeOffset: D.FLAP_HINGE_OFFSET,
    lagHingeOffset: D.LAG_HINGE_OFFSET, lagDamper: 'elastomeric' },
  // ESTIMATE ratios from rounded published upper RPM limits, not measured gearbox tooth counts.
  referenceRpm: V.rotorRpm100, nominalRpm: V.rotorRpm100 * 2650 / 2700,
  engineRatio: V.engineRpm100 / V.rotorRpm100, tailRatio: 3094 / 471,
  rotation: D.MAIN_ROTOR_ROTATION, tailRotation: D.TAIL_ROTOR_ROTATION,
  // Symmetric 7° equivalent cyclic travel is an ESTIMATE; actual RFM 1-10 limits are asymmetric.
  cyclicLimit: 7 * DEG,
  airspeedLimits: S269_VNE, manifoldLimits: undefined,
  airspeedCorrections: { heavyMass: Infinity, heavyReduction: 0, powerOffReduction: 0, highPowerCap: Infinity, doorsOffCap: V.doorsOffVne },
  controlSystem: { cyclic: 'mechanical', collective: 'mechanical', pedals: 'mechanical', trim: 'electric-spring' },
  systems: { ...base.systems, governorInstalled: false,
    // Base CB without optional STAR low-RPM system; zero disables the inherited warning threshold.
    lowRpmWarning: 0, continuousPower: V.continuousPower, takeoffPower: V.takeoffPower, takeoffSeconds: Infinity },
  main: { ...base.main, radius: D.MAIN_ROTOR_RADIUS, chord: D.MAIN_ROTOR_CHORD,
    rootCutout: S269_BLADE_ROOT, inertia: D.MAIN_ROTOR_BLADES * S269_ARTICULATED.blade.polar,
    blades: D.MAIN_ROTOR_BLADES, hub: D.MAIN_HUB, twist: D.MAIN_ROTOR_TWIST_DEG * DEG,
    // RFM 1-10 at 0.75R: 2.5±1.5° down, 12±1° travel. Effective section datum unverified.
    minPitch: 2.5 * DEG, maxPitch: 14.5 * DEG,
    // Analytic NACA0015 approximation, NOT a measured section polar: finite-Re stall/drag uncertain.
    liftSlope: 5.7, maxCl: 1.25, profileCd: 0.011, inducedDrag: 0.01, inducedFactor: 1.15 },
  tail: { ...base.tail, radius: D.TAIL_ROTOR_RADIUS, chord: D.TAIL_ROTOR_CHORD,
    blades: D.TAIL_ROTOR_BLADES, hub: D.TAIL_HUB, twist: D.TAIL_ROTOR_TWIST_DEG * DEG,
    minPitch: -12 * DEG, maxPitch: 26 * DEG },
  // Estimated exposed-frame/cabin flat-plate areas. No Schweizer wind-tunnel dataset obtained.
  dragArea: { x: 0.8, y: 2.0, z: 2.5 },
  fuselageWash: 1 + -D.MAIN_HUB.z / Math.hypot(D.MAIN_ROTOR_RADIUS, D.MAIN_HUB.z),
  // The legacy surface solver has no canted single-side stabilizer: projected stand-in only.
  stabilizer: { ...base.stabilizer, centre: { x: D.HORIZONTAL_STABILIZER.leadingX - D.HORIZONTAL_STABILIZER.chord / 4,
    y: D.HORIZONTAL_STABILIZER_OUTLINE[3].y / 2,
    z: (D.HORIZONTAL_STABILIZER_OUTLINE[0].z + D.HORIZONTAL_STABILIZER_OUTLINE[3].z) / 2 },
    area: D.HORIZONTAL_STABILIZER.span * D.HORIZONTAL_STABILIZER.chord, incidence: D.HORIZONTAL_STABILIZER.incidenceDeg * DEG },
  fins: [{ ...base.fins[0], centre: D.VERTICAL_FIN_CENTRE, area: D.VERTICAL_FIN_AREA }],
  tailProtection: { ...base.tailProtection!, stinger: D.TAIL_STINGER, radius: D.TAIL_STINGER_RADIUS, fin: D.VERTICAL_FIN_OUTLINE },
  skids: { ...base.skids, suspension: 'oleo', halfTrack: D.SKID_HALF_TRACK, front: D.SKID_CONTACT_FRONT_X,
    rear: D.SKID_CONTACT_REAR_X, z: D.SKID_Z },
};
