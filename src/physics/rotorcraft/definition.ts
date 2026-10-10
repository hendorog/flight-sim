import type { Vec3 } from '../../core/math';
import type { SurfaceType } from '../../core/types';
import type { ManifoldPlacard, SpeedPlacard, SpeedCorrections } from './limits';

/** SI units; rotor rotation is +1 about its upward thrust axis (CCW viewed from above). */
export interface RotorDefinition {
  radius: number; rootCutout: number; chord: number; blades: number;
  /** Pitch at 75% radius and linear root-to-tip twist, radians. */
  minPitch: number; maxPitch: number; twist: number;
  liftSlope: number; maxCl: number; profileCd: number; inducedDrag: number;
  inertia: number; hub: Vec3;
  /** Nonuniform-wake induced-velocity correction; one is ideal uniform momentum theory. */
  inducedFactor?: number;
}
export interface RotorcraftDefinition {
  /** Installation metadata. Absent retains the legacy teetering hub. Articulated dynamics are
   * not implemented yet: that installation currently uses the free-hinge placeholder solver. */
  hubModel?: { kind: 'teetering' } | { kind: 'articulated'; flapHingeOffset: number; lagHingeOffset: number;
    lagDamper: 'elastomeric' | 'friction' };
  main: RotorDefinition;
  tail: RotorDefinition;
  nominalRpm: number;
  /** Tachometer 100%, distinct from the governed operating speed. */
  referenceRpm: number;
  airspeedLimits: SpeedPlacard;
  airspeedCorrections?: SpeedCorrections;
  manifoldLimits?: ManifoldPlacard;
  rotation: 1 | -1;
  /** Tail rotation relative to main azimuth about the renderer's local axis; legacy is -1. */
  tailRotation?: 1 | -1;
  engineRatio: number; tailRatio: number; transmissionEfficiency: number;
  cyclicLimit: number;
  teeterLimit: number;
  /** Control actuation metadata. Inputs command position; servo failures and hand forces are not simulated. */
  controlSystem: { cyclic: 'mechanical' | 'hydraulic'; collective: 'mechanical' | 'hydraulic'; pedals: 'mechanical';
    /** Installation only; no hand-force/trim-actuator simulation. */
    trim?: 'electric-spring' | 'none' };
  systems: { clutchSeconds: number; beltTorque: number; correlator: number; governorRate: number;
    /** False for a manual-throttle installation; absence retains the legacy governor. */
    governorInstalled?: boolean;
    /** Fractions of tachometer reference RPM, not governed RPM. */
    governorEngage: number; lowRpmWarning: number; powerCheckMinRpm: number;
    /** Collective switch deadband, normalized travel. */
    hornCollectiveMin: number;
    governorGain?: number; governorIntegralGain?: number;
    /** Estimated RPM prediction horizon of the governor's rate feedback, seconds. */
    governorLead?: number;
    continuousPower: number; takeoffPower: number; takeoffSeconds: number };
  stabilizer: { centre: Vec3; area: number; liftSlope: number; incidence: number; maxCl: number; wash: number };
  fins: { centre: Vec3; area: number; liftSlope: number; incidence: number; maxCl: number }[];
  /** Fuselage destabilising moment derivatives, Nm/(Pa rad). */
  fuselageMoment: { pitch: number; yaw: number };
  /** Equivalent flat plate areas along FRD axes, m². */
  dragArea: Vec3;
  /** Local fuselage downwash / disc induced velocity; actuator-disc near/far wake spans 1–2. */
  fuselageWash?: number;
  /** Aerodynamic drag application point relative to reference point. */
  dragCentre: Vec3;
  tailProtection?: { stinger: readonly Vec3[]; radius: number; fin: readonly Vec3[];
    stiffness: number; damping: number; maxSink: number; maxCompression: number };
  skids: { halfTrack: number; front: number; rear: number; z: number; stiffness: number; damping: number; friction: number; maxSink: number;
    /** Installation only. Oleo gas/poppet dynamics and ground resonance are not yet simulated. */
    suspension?: 'cross-tube' | 'oleo';
    /** Shoe/terrain contact, distinct from tyre coefficients. Lateral includes soil ploughing by the tube. */
    surfaces?: Partial<Record<SurfaceType, { static: number; sliding: number; lateral: number }>> };
}
export interface RotorcraftState {
  omega: number; azimuth: number; inflow: number; tailInflow: number;
  flapForward: number; flapRight: number; governorThrottle: number;
  thrust: number; tailThrust: number; torque: number; driveTorque: number;
  rotorRpm: number; lowRpm: boolean; vortexRing: number; stalledFraction: number;
  coning: number; retreatingFlap: number; teeterAngle: number; mastBump: boolean;
  /** Latched ground-contact report. A light stinger touch is reported without stopping the simulation. */
  tailContact: 'none' | 'stinger-touch' | 'stinger-impact' | 'fin-strike' | 'rotor-strike';
  /** Last pilot positions allow correlator/governor state to resume without a throttle step. */
  previousCollective: number; previousThrottle: number; governorIntegral: number;
  takeoffPowerSeconds: number; powerLimitExceeded: boolean;
  vneKias: number; airspeedLimitExceeded: boolean;
  /** Departure mass in kg, retained through fuel burn/resume; refreshed on the ground. Zero before reset. */
  takeoffMass: number;
  /** Systems outputs read by the panel, annunciators and audio (contract between physics and presentation).
   * clutchEngagement: belt/clutch engagement 0 (slack) .. 1 (fully tensioned).
   * clutchLight: CLUTCH caution, lit while the clutch actuator is moving.
   * governorActive: governor switched on AND active (engine above its engagement RPM).
   * lowRpmLight: powered LOW RPM indication, independent of collective position.
   * lowRpmHorn: audible warning below the type's threshold with collective not fully down. */
  clutchEngagement: number; clutchLight: boolean; governorActive: boolean; lowRpmHorn: boolean; lowRpmLight: boolean;
}
export function emptyRotorcraftState(): RotorcraftState {
  return { omega: 0, azimuth: 0, inflow: 0, tailInflow: 0, flapForward: 0, flapRight: 0,
    governorThrottle: 0, thrust: 0, tailThrust: 0, torque: 0, driveTorque: 0,
    rotorRpm: 0, lowRpm: false, vortexRing: 0, stalledFraction: 0,
    coning: 0, retreatingFlap: 0, teeterAngle: 0, mastBump: false, tailContact: 'none',
    previousCollective: 0, previousThrottle: 0, governorIntegral: 0,
    takeoffPowerSeconds: 0, powerLimitExceeded: false,
    vneKias: 0, airspeedLimitExceeded: false, takeoffMass: 0,
    clutchEngagement: 0, clutchLight: false, governorActive: false, lowRpmHorn: false, lowRpmLight: false };
}
