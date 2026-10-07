// Landing gear and ground contact. The Cessna 172S configuration (C172_GEAR) is LandingGear's default.
export { LandingGear, classifyImpact, type RestingPose } from './landingGear';
export { C172_GEAR, type GearConfig, type WheelConfig } from './c172Gear';
export type { ImpactThresholds, PropellerDisc, RetractConfig, StructuralPoint } from './gearConfig';
export { RetractActuator, SQUAT_DELAY, type RetractInput } from './retract';
export { SURFACES, type SurfaceProperties } from './surfaces';
