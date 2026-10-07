// What a type must measure in the conformance suite (suite.ts): one ConformanceTargets per type, written in
// targets/<id>.ts with every number's source. Speeds are knots: KIAS / KCAS / KTAS as each member's name says
// (a sweep over trims is in KTAS, as the fdm tests sweep it); altitudes in feet.
//
// A Band is a target with a half-width, a Range an interval; both carry where the number comes from. `blockedBy`
// names a request (work/design/requests/<id>.md) that stands between the model and the number: while that id is
// in OPEN_REQUESTS (requests.ts) the item is reported as SKIPPED with the id and its measured value, whatever it
// measures; once the id is removed from that list the item is judged again and fails if it is still not met.

import type { AircraftId, ControlPatch, EngineControls } from '../../src/core/types';
import type { SpeedRange, TrimCase } from '../fdm/measure';

/** target +- tol, in the target's unit. */
export interface Band {
  target: number;
  tol: number;
  source: string;
  blockedBy?: string;
}

/** min .. max (either may be infinite). */
export interface Range {
  min: number;
  max: number;
  source: string;
  blockedBy?: string;
}

export type Limit = Band | Range;

/** target +- percent % of the target. */
export const pct = (target: number, percent: number, source: string, blockedBy?: string): Band => ({ target, tol: (Math.abs(target) * percent) / 100, source, ...(blockedBy ? { blockedBy } : {}) });
/** target +- tol. */
export const band = (target: number, tol: number, source: string, blockedBy?: string): Band => ({ target, tol, source, ...(blockedBy ? { blockedBy } : {}) });
export const range = (min: number, max: number, source: string, blockedBy?: string): Range => ({ min, max, source, ...(blockedBy ? { blockedBy } : {}) });
export const below = (max: number, source: string, blockedBy?: string): Range => range(-Infinity, max, source, blockedBy);
export const above = (min: number, source: string, blockedBy?: string): Range => range(min, Infinity, source, blockedBy);

export const isBand = (l: Limit): l is Band => 'target' in l;

export interface StallTarget {
  flapDeg: number;
  /** Trimmed entry, KTAS, 3000 ft above the field. */
  entryKt: number;
  /** V_S1g from the highest lift coefficient, KCAS (forward-limit loading). */
  vs1gKcas: Band;
  /** First stall warning, KCAS above V_S1g. */
  warningMarginKt: Range;
}

export interface TwinTargets {
  /** 'none' for counter-rotation: the two sides must agree. */
  criticalEngine: 'left' | 'right' | 'none';
  /** Handbook Vmca and Vyse, KCAS: the pedal fractions are measured at 1.10 x Vmca and at Vyse. */
  vmcaKcas: number;
  vyseKcas: number;
  /** Pedal fraction, failed engine windmilling, live engine `throttle`, gear and flaps up, 5 deg bank to the live engine, aft loading, sea level. */
  pedalAt110Vmca: Range;
  pedalAtVyse: Range;
  /** Lever of the live engine for the Vmca and pedal trims (default 1). */
  throttle?: number;
  /** Vmca by secant (judged only when it is rudder-limited; a stall-limited type is judged on the pedal fractions). */
  vmca: Band;
  /** Left vs right failed. 'none': |Vmca difference| within vmcaKt OR pedal difference at 1.10 x Vmca within pedal. Otherwise the critical side needs more pedal. */
  sides: { vmcaKt: number; pedal: number; source: string };
  /** OEI climb, failed engine FEATHERED, zero sideslip, gear and flaps up, at Vyse: one row per altitude. */
  oeiClimb: { altitudeFt: number; fpm: Band }[];
  /** Live engine's lever in the OEI climb (PA-34 1, DA42 0.92). */
  oeiThrottle?: number;
  /** Cowl flaps per engine for the OEI climb (the live engine's open); absent: as the controls are. */
  oeiCowlFlaps?: { leftFailed: readonly number[]; rightFailed: readonly number[] };
  /** Windmilling instead of feathered at Vyse, sea level: climb lost, ft/min. */
  windmillingLossFpm: Range;
  /** Dead engine at the handbook zero-thrust setting against feathered, sea level, Vyse: |difference| in ft/min. */
  zeroThrust?: { controls: EngineControls; withinFpm: number; source: string; blockedBy?: string };
  /**
   * Flown engine cut at Vmca + 5 kt, scripted pilot reacting after 1 s (behaviour only). minVerticalSpeedFpm: the
   * vertical speed at the end that still counts as recovered, the dead engine windmilling and the wings level
   * (absent: the "recovered" flag, sinking less than 0.5 m/s); a marginal twin sets its windmilling capability.
   */
  engineCut: { maxHeadingChangeDeg: Range; source: string; minVerticalSpeedFpm?: Range };
}

export interface SystemsTargets {
  /** Magneto drop at a run-up rpm (each magneto, and their difference). */
  magnetoDrop?: { rpm: number; drop: Range; difference: Range };
  /** Carburettor heat rpm drop: full throttle on the brakes, and at the run-up rpm. */
  carbHeat?: { runUpRpm: number; fullThrottle: Range; runUp: Range };
  /** Gear retraction / extension time in the air at `kias`, s. */
  gearTransit?: { kias: number; up: Range; down: Range };
  /** Climb lost with the gear down (both engines, best-rate speed), ft/min. */
  gearDownClimb?: { kcas: number; throttle?: number; lossFpm: Range };
}

export interface ConformanceTargets {
  aircraft: AircraftId;
  stall: { clean: StallTarget; landing: StallTarget };
  /** Contract 3.1: full aft stick 5 s at idle from a trimmed glide at `entryKias` (1.3 Vs), then forward. */
  stallRecovery: { entryKias: number; recoveryS: Range };
  climb: {
    /** TAS sweep at sea level, full throttle (or `throttle`). */
    range: SpeedRange;
    throttle?: number;
    rocFpm: Band;
    vyKias: Band;
    /** Rate of climb at altitude (flown tier), leaned at `leanAtKt` for best power. */
    table?: { range: SpeedRange; leanAtKt?: number; rows: { ft: number; fpm: Band }[] };
  };
  maxLevel: { bracketKt: readonly [number, number]; throttle?: number; ktas: Band; rpm?: Range };
  cruise?: { altitudeFt: number; powerFraction: number; bracketKt: readonly [number, number]; leanAtKt?: number; resetKt: number; ktas: Band; powerFractionReached: Band; rpm?: Range };
  /** Full throttle on the brakes at the field (rpm of every engine; MAP for governed engines). */
  staticRun: { rpm?: Range; mapInHg?: Range; groundSpeed: Range };
  takeoff: { flapDeg: number; rotateKias: number; pitchDeg: number; staticRunUp: boolean; controls?: ControlPatch; groundRollM: Band };
  /** brake: the pedal on the roll the handbook's chart implies (LandingOptions.brake); absent: full. */
  landing: { flapDeg: number; approachKt: number; touchdownPitchDeg: number; brake?: number; groundRollM: Band };
  glide: {
    /** TAS sweep at 300 m, every engine off. */
    range: SpeedRange;
    propeller: 'windmilling' | 'feathered';
    ratio: Band;
    bestKias: Band;
    /** Ratio at the handbook best-glide speed. */
    at?: { kias: number; ratio: Band };
    windmillingRpm?: Range;
  };
  /**
   * The trim block flies on one rig, in this order (trim.test.ts): every case, the trim-wheel check, the impossible
   * climb, then the hands-off cruise. Each measurement resets, and a reset does not depend on the rig's history
   * (C-C5a-01), so the order is not part of the measurement.
   */
  trim: {
    cases: readonly TrimCase[];
    maxResidual: number;
    maxRateDegS: number;
    /** Normal-flight trim at `kt` TAS: the wheel trims it, the yoke is neutral, the ball centred. */
    wheel: { kt: number; maxWheel: number; maxBall: number };
    /** Climb at `kt` TAS asked for `fpaDeg`, more than full power gives: throttle pinned at 1, path solved below maxFpaDeg. */
    impossibleClimb?: { kt: number; fpaDeg: number; maxFpaDeg: number };
  };
  handsOff: { kt: number; ftAboveField: number; seconds: number; altDriftM: Range; headingDriftDeg: Range; maxVsFpm: Range; tasChangeMps: Range };
  ground: {
    restHeightM: Band;
    idleRpm: Range;
    parkedDriftMm: Range;
    parkedRateDegS: Range;
    taxi: { meanSteer: Range; maxHeadingErrorDeg: Range; speedKt: Band; radiusM: Range; maxYawAccelDegS2: Range };
  };
  /** Pedal for zero sideslip with power (+ = right): signed, so a counter-rotating twin asks for about 0. */
  yaw: {
    ftAboveField: number;
    resetKt: number;
    climbKias: number;
    climb: Range;
    throttle?: number;
    steep?: { kias: number; rudder: Range };
    cruise?: { kias: number; rudder: Range };
    /** Full-throttle level near sea level, by bisection over bracketKt (the C172S's rudder-tab rig point). */
    rigPoint?: { bracketKt: readonly [number, number]; resetKt: number; rudder: Range };
  };
  systems?: SystemsTargets;
  twin?: TwinTargets;
}
