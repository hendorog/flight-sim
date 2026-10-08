import type { Vec3 } from '../../core/math';
import type { SpeedPlacard } from './limits';

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
  main: RotorDefinition;
  tail: RotorDefinition;
  nominalRpm: number;
  /** Tachometer 100%, distinct from the governed operating speed. */
  referenceRpm: number;
  airspeedLimits: SpeedPlacard;
  rotation: 1 | -1;
  engineRatio: number; tailRatio: number; transmissionEfficiency: number;
  cyclicLimit: number;
  teeterLimit: number;
  systems: { clutchSeconds: number; beltTorque: number; correlator: number; governorRate: number;
    continuousPower: number; takeoffPower: number; takeoffSeconds: number };
  stabilizer: { centre: Vec3; area: number; liftSlope: number; incidence: number; maxCl: number; wash: number };
  fins: { centre: Vec3; area: number; liftSlope: number; incidence: number; maxCl: number }[];
  /** Fuselage destabilising moment derivatives, Nm/(Pa rad). */
  fuselageMoment: { pitch: number; yaw: number };
  /** Equivalent flat plate areas along FRD axes, m². */
  dragArea: Vec3;
  /** Aerodynamic drag application point relative to reference point. */
  dragCentre: Vec3;
  skids: { halfTrack: number; front: number; rear: number; z: number; stiffness: number; damping: number; friction: number; maxSink: number };
}
export interface RotorcraftState {
  omega: number; azimuth: number; inflow: number; tailInflow: number;
  flapForward: number; flapRight: number; governorThrottle: number;
  thrust: number; tailThrust: number; torque: number; driveTorque: number;
  rotorRpm: number; lowRpm: boolean; vortexRing: number; stalledFraction: number;
  coning: number; retreatingFlap: number; teeterAngle: number; mastBump: boolean;
  /** Last pilot positions allow correlator/governor state to resume without a throttle step. */
  previousCollective: number; previousThrottle: number; governorIntegral: number;
  takeoffPowerSeconds: number; powerLimitExceeded: boolean;
  vneKias: number; airspeedLimitExceeded: boolean;
  /** Systems outputs read by the panel, annunciators and audio (contract between physics and presentation).
   * clutchEngagement: belt/clutch engagement 0 (slack) .. 1 (fully tensioned).
   * clutchLight: CLUTCH caution, lit while the clutch actuator is moving.
   * governorActive: governor switched on AND active (engine above its engagement RPM).
   * lowRpmHorn: LOW RPM light and horn (rotor below 97 % with collective not fully down). */
  clutchEngagement: number; clutchLight: boolean; governorActive: boolean; lowRpmHorn: boolean;
}
export function emptyRotorcraftState(): RotorcraftState {
  return { omega: 0, azimuth: 0, inflow: 0, tailInflow: 0, flapForward: 0, flapRight: 0,
    governorThrottle: 0, thrust: 0, tailThrust: 0, torque: 0, driveTorque: 0,
    rotorRpm: 0, lowRpm: false, vortexRing: 0, stalledFraction: 0,
    coning: 0, retreatingFlap: 0, teeterAngle: 0, mastBump: false,
    previousCollective: 0, previousThrottle: 0, governorIntegral: 0,
    takeoffPowerSeconds: 0, powerLimitExceeded: false,
    vneKias: 0, airspeedLimitExceeded: false,
    clutchEngagement: 0, clutchLight: false, governorActive: false, lowRpmHorn: false };
}
