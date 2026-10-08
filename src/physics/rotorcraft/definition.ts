import type { Vec3 } from '../../core/math';

/** SI units; rotor rotation is +1 about its upward thrust axis (CCW viewed from above). */
export interface RotorDefinition {
  radius: number; rootCutout: number; chord: number; blades: number;
  /** Pitch at 75% radius and linear root-to-tip twist, radians. */
  minPitch: number; maxPitch: number; twist: number;
  liftSlope: number; maxCl: number; profileCd: number; inducedDrag: number;
  inertia: number; hub: Vec3;
}
export interface RotorcraftDefinition {
  main: RotorDefinition;
  tail: RotorDefinition;
  nominalRpm: number;
  rotation: 1 | -1;
  engineRatio: number; tailRatio: number; transmissionEfficiency: number;
  cyclicLimit: number; flapTime: number;
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
}
export function emptyRotorcraftState(): RotorcraftState {
  return { omega: 0, azimuth: 0, inflow: 0, tailInflow: 0, flapForward: 0, flapRight: 0,
    governorThrottle: 0, thrust: 0, tailThrust: 0, torque: 0, driveTorque: 0,
    rotorRpm: 0, lowRpm: false, vortexRing: 0, stalledFraction: 0 };
}
