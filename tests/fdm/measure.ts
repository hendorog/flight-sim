// Measurements of whole-aircraft behaviour, for the flight-model tests and the per-type conformance suite
// (tests/conformance). Each function is the measuring code of an fdm test, with the literals that made it a C172S
// test turned into parameters; called with the C172S's values it does exactly what the test does, call for call,
// so the C172S measures the numbers of the [fdm] report. Speeds and masses come from the rig's definition.
//
// Nothing here asserts or prints: a function returns what it measured (a trim that should converge and does not
// throws), the caller judges it. No vitest import, so a node script can load this module.

import { DEG, FT, G0, KT, wrapPi } from '../../src/core/math';
import {
  clearEngineControl,
  setEngineControl,
  type AircraftState,
  type ControlInputs,
  type ControlPatch,
  type EngineControls,
} from '../../src/core/types';
import type { AircraftDefinition } from '../../src/aircraft/types';
import {
  Autopilot,
  atmosphereAt,
  casFromTas,
  createAirData,
  engineStopControls,
  tasFromCas,
  type BladeElementFlightModel,
  type TrimResult,
  type TrimSpec,
} from '../../src/physics';
import { ELEVATION, FRAME, at, calmWeather, flatEnvironment, fpm, kt, makeRig, resetTo, type Rig } from './helpers';

/** A rig of any type. */
export type AnyRig = Rig<BladeElementFlightModel>;

/** Terrain far below sea level, so sea-level flight is out of ground effect (performance.test.ts). */
export const LOW_TERRAIN = -2000;
/** Runway 07 of the ground tests, through the origin. */
export const RUNWAY_HEADING = 70 * DEG;

/** Speeds swept from `fromKt` up to `toKt` in `stepKt` (default 1) steps. */
export interface SpeedRange {
  fromKt: number;
  toKt: number;
  stepKt?: number;
}

// ------------------------------------------------------------------------------------------------ air data

/** Indicated airspeed (kt) of a true airspeed at an altitude in 1-g flight at maximum weight, flaps up. */
export function kiasOf(def: AircraftDefinition, tas: number, altitude: number): number {
  const atm = atmosphereAt(altitude);
  const cl = (def.mass.maxTakeoff * G0) / (0.5 * atm.density * tas * tas * def.geometry.wing.area);
  return kt(airDataOf(def).indicatedAirspeed(casFromTas(tas, atm), 0, cl));
}

/** True airspeed for an indicated airspeed (kt) at an altitude, flaps up (bisection between 20 and 80 m/s). */
export function tasForKias(def: AircraftDefinition, kiasTarget: number, altitude: number, lo = 20, hi = 80): number {
  for (let i = 0; i < 40; i++) {
    const mid = 0.5 * (lo + hi);
    if (kiasOf(def, mid, altitude) < kiasTarget) lo = mid;
    else hi = mid;
  }
  return 0.5 * (lo + hi);
}

/** True airspeed of a calibrated airspeed (kt) at an altitude in the rig's atmosphere, m/s. */
export function tasForKcas(rig: AnyRig, kcas: number, altitude: number): number {
  return tasFromCas(kcas * KT, rig.env.atmosphere(altitude));
}

const airData = new WeakMap<AircraftDefinition, ReturnType<typeof createAirData>>();
function airDataOf(def: AircraftDefinition) {
  let a = airData.get(def);
  if (!a) airData.set(def, (a = createAirData(def.airData, def.geometry.wing.area, def.controls.flaps.maxDeflection)));
  return a;
}

/** Flap lever of a detent given in degrees (the detent's lever value, ControlSystemDef.flaps). */
export function flapLever(def: AircraftDefinition, flapDeg: number): number {
  const f = def.controls.flaps;
  const detent = f.detents.find((d) => Math.abs(d / DEG - flapDeg) < 0.01);
  if (detent === undefined) throw new Error(`${def.id}: no flap detent at ${flapDeg} deg`);
  return detent === f.maxDeflection ? 1 : detent / f.maxDeflection;
}

// ------------------------------------------------------------------------------------------------ trims and power

/** A fixed-throttle trim at a TAS; throws if it does not converge (performance.test.ts pathAngle). */
export function trimAt(rig: AnyRig, tas: number, altitude: number, throttle: number, fixed: ControlPatch = {}): TrimResult {
  const t = rig.fm.solveTrim({ tas, altitude, throttle }, rig.env, fixed);
  if (!t.converged) throw new Error(`${rig.fm.definition.id}: trim at ${kt(tas).toFixed(1)} KTAS, ${altitude.toFixed(0)} m, throttle ${throttle} did not converge`);
  return t;
}

/** Brake power engine i delivers at its present (settled) state, W. */
export function brakePower(fm: BladeElementFlightModel, i = 0): number {
  const u = fm.propulsion.units[i];
  return (u.engine.indicatedTorque - u.engine.lossTorque) * (u.omega * u.gearRatio);
}

/** Sum of the brake powers of every engine, W. */
export function totalBrakePower(fm: BladeElementFlightModel): number {
  let p = 0;
  for (let i = 0; i < fm.propulsion.units.length; i++) p += brakePower(fm, i);
  return p;
}

/** Sum of the engines' rated powers, W. */
export function ratedPower(def: AircraftDefinition): number {
  let p = 0;
  for (const e of def.powerplant.engines) p += e.engine.ratedPower;
  return p;
}

/** Crank rpm of every engine at the powerplant's present (settled) state. */
export function settledRpm(fm: BladeElementFlightModel): number[] {
  return fm.propulsion.units.map((u) => u.rpm);
}

/** True when the type's engines have a mixture lever (spark ignition; a FADEC unit has none). */
export function hasMixture(def: AircraftDefinition): boolean {
  return def.powerplant.engines.every((e) => e.engine.kind === 'sparkPiston');
}

// ------------------------------------------------------------------------------------------------ static run

export interface StaticRun {
  /** Crank rpm per engine after the run. */
  rpm: number[];
  mapInHg: number[];
  /** Ground speed at the end: the parking brake holds when it is (nearly) zero, m/s. */
  groundSpeed: number;
}

/** Full throttle on the parking brake for `seconds` (performance.test.ts). The rig sits at the field elevation. */
export function staticRun(rig: AnyRig, seconds = 10, throttle = 1): StaticRun {
  resetTo(rig, { onGround: true, position: at(0) });
  rig.controls.throttle = throttle;
  rig.run(seconds);
  const s = rig.fm.state;
  return { rpm: s.engines.map((e) => e.rpm), mapInHg: s.engines.map((e) => e.manifoldPressure), groundSpeed: s.groundSpeed };
}

// ------------------------------------------------------------------------------------------------ level speed, cruise, climb, glide

export interface LevelSpeedOptions {
  /** Altitude of the trims, m (0: sea level; the rig should be over LOW_TERRAIN). */
  altitude: number;
  throttle?: number;
  bracketKt?: readonly [number, number];
  iterations?: number;
  fixed?: ControlPatch;
}

/**
 * Level-flight TAS where a fixed throttle just holds altitude: bisection on the flight-path angle of fixed-throttle
 * trims (performance.test.ts levelSpeed). Reset at 300 m first. rpm: per engine at the last trim.
 */
export function maxLevelSpeed(rig: AnyRig, o: LevelSpeedOptions): { ktas: number; rpm: number[] } {
  resetTo(rig, { position: at(300) });
  const [loKt, hiKt] = o.bracketKt ?? [100, 140];
  let lo = loKt * KT, hi = hiKt * KT;
  const throttle = o.throttle ?? 1;
  for (let i = 0; i < (o.iterations ?? 30); i++) {
    const mid = 0.5 * (lo + hi);
    if (trimAt(rig, mid, o.altitude, throttle, o.fixed).flightPathAngle > 0) lo = mid;
    else hi = mid;
  }
  return { ktas: kt(0.5 * (lo + hi)), rpm: settledRpm(rig.fm) };
}

/** Mixture lever (stepped from `from` down to `to`) that gives the steepest full-throttle climb at a TAS. */
export function bestPowerMixture(rig: AnyRig, tas: number, altitude: number, from = 1, to = 0.5, step = 0.02, throttle = 1): number {
  let mixture = 1, best = -Infinity;
  for (let m = from; m >= to; m -= step) {
    const g = trimAt(rig, tas, altitude, throttle, { mixture: m }).flightPathAngle;
    if (g > best) {
      best = g;
      mixture = m;
    }
  }
  return mixture;
}

export interface CruiseOptions {
  altitude: number;
  /** Fraction of the summed rated power. */
  powerFraction: number;
  bracketKt?: readonly [number, number];
  iterations?: number;
  /** Lean for best power at this TAS (kt) at full throttle first; absent or a FADEC type: no leaning. */
  leanAtKt?: number;
  /** Speed the reset is made at, kt. */
  resetKt?: number;
}

/**
 * Speed at which level flight takes `powerFraction` of rated power, leaned to best power (performance.test.ts
 * "75 % cruise"). Bisection on trims at the fixed mixture; a trim that cannot converge needs more than full throttle.
 */
export function cruiseSpeed(rig: AnyRig, o: CruiseOptions): { ktas: number; powerFraction: number; mixture: number; rpm: number[] } {
  const alt = o.altitude;
  resetTo(rig, { position: at(alt), airspeed: (o.resetKt ?? 120) * KT });
  const lean = o.leanAtKt !== undefined && hasMixture(rig.fm.definition);
  const mixture = lean ? bestPowerMixture(rig, o.leanAtKt! * KT, alt) : 1;
  const fixed: ControlPatch = lean ? { mixture } : {};
  const rated = ratedPower(rig.fm.definition);
  const [loKt, hiKt] = o.bracketKt ?? [100, 140];
  let lo = loKt * KT, hi = hiKt * KT;
  for (let i = 0; i < (o.iterations ?? 25); i++) {
    const mid = 0.5 * (lo + hi);
    const t = rig.fm.solveTrim({ tas: mid, altitude: alt }, rig.env, fixed);
    // Beyond full throttle the trim cannot converge: that speed needs more than the fraction.
    const power = t.converged ? totalBrakePower(rig.fm) : Infinity;
    if (power < o.powerFraction * rated) lo = mid;
    else hi = mid;
  }
  // Power at the bracket's slow end, which always converged (the last midpoint can be the fast, unconverged one).
  const v = lo;
  if (!rig.fm.solveTrim({ tas: v, altitude: alt }, rig.env, fixed).converged) throw new Error(`${rig.fm.definition.id}: cruise trim did not converge`);
  return { ktas: kt(v), powerFraction: totalBrakePower(rig.fm) / rated, mixture, rpm: settledRpm(rig.fm) };
}

export interface ClimbOptions {
  altitude: number;
  range: SpeedRange;
  throttle?: number;
  /** Lean for best power at this TAS (kt) first, mixture stepped from 1 down to `leanTo`; absent: as the controls are. */
  leanAtKt?: number;
  leanTo?: number;
  fixed?: ControlPatch;
}

/**
 * Best rate of climb over fixed-throttle trims at 1 kt steps of TAS (performance.test.ts): the rate is V sin(gamma),
 * Vy the indicated airspeed of the best point. The rig is NOT reset (the caller resets it once, as the tests do).
 */
export function bestClimb(rig: AnyRig, o: ClimbOptions): { rocFpm: number; vyKias: number; mixture?: number } {
  const def = rig.fm.definition;
  const throttle = o.throttle ?? 1;
  let fixed = o.fixed ?? {};
  let mixture: number | undefined;
  if (o.leanAtKt !== undefined && hasMixture(def)) {
    mixture = bestPowerMixture(rig, o.leanAtKt * KT, o.altitude, 1, o.leanTo ?? 0.4, 0.02, throttle);
    fixed = { ...fixed, mixture };
  }
  const step = o.range.stepKt ?? 1;
  let bestRoc = -Infinity, vy = 0;
  for (let v = o.range.fromKt; v <= o.range.toKt; v += step) {
    const t = trimAt(rig, v * KT, o.altitude, throttle, fixed);
    const roc = v * KT * Math.sin(t.flightPathAngle);
    if (roc > bestRoc) {
      bestRoc = roc;
      vy = kiasOf(def, v * KT, o.altitude);
    }
  }
  return { rocFpm: fpm(bestRoc), vyKias: vy, mixture };
}

export interface GlideResult {
  ratio: number;
  bestKias: number;
  /** Propeller rpm per engine at the best point (windmilling). */
  rpm: number[];
  /** Glide ratio at `atKias`, when asked for. */
  ratioAt: number;
}

/**
 * Engine-dead glide: one reset per TAS step with every engine off (performance.test.ts): L/D = -1 / tan(gamma).
 * `atKias`: also the ratio at that indicated airspeed. `feathered`: twins with both propellers feathered.
 */
export function bestGlide(rig: AnyRig, o: { altitude: number; range: SpeedRange; atKias?: number; feathered?: boolean }): GlideResult {
  const def = rig.fm.definition;
  const feathered = o.feathered ? def.powerplant.engines.map(() => true) : undefined;
  let bestLd = 0, bestKias = 0, rpm: number[] = [];
  const step = o.range.stepKt ?? 1;
  for (let v = o.range.fromKt; v <= o.range.toKt; v += step) {
    resetTo(rig, { position: at(o.altitude), airspeed: v * KT, engineRunning: false, ...(feathered ? { feathered } : {}) });
    const t = rig.fm.lastTrim!;
    if (!t.converged) throw new Error(`${def.id}: glide trim at ${v} KTAS did not converge`);
    const ld = -1 / Math.tan(t.flightPathAngle);
    if (ld > bestLd) {
      bestLd = ld;
      bestKias = kiasOf(def, v * KT, o.altitude);
      rpm = rig.fm.state.engines.map((e) => e.rpm);
    }
  }
  let ratioAt = NaN;
  if (o.atKias !== undefined) {
    resetTo(rig, { position: at(o.altitude), airspeed: tasForKias(def, o.atKias, o.altitude), engineRunning: false, ...(feathered ? { feathered } : {}) });
    ratioAt = -1 / Math.tan(rig.fm.lastTrim!.flightPathAngle);
  }
  return { ratio: bestLd, bestKias, rpm, ratioAt };
}

// ------------------------------------------------------------------------------------------------ trim-ability, hands-off, yaw

/** One in-air trim case of the trim-ability block; positions are given in feet above the field or MSL. */
export interface TrimCase {
  kt: number;
  flaps?: number;
  fpaDeg?: number;
  engineRunning?: boolean;
  ftAboveField?: number;
  ftMsl?: number;
}

export interface TrimCaseResult {
  converged: boolean;
  residual: number;
  /** Body rate after 0.5 s from the trimmed state, rad/s. */
  rate: number;
}

/** Reset trimmed at each case, then fly 0.5 s (trim.test.ts "converges across the envelope"). */
export function trimEnvelope(rig: AnyRig, cases: readonly TrimCase[]): TrimCaseResult[] {
  return cases.map((c) => {
    resetTo(rig, {
      airspeed: c.kt * KT,
      ...(c.flaps === undefined ? {} : { flaps: c.flaps }),
      ...(c.fpaDeg === undefined ? {} : { flightPathAngle: c.fpaDeg * DEG }),
      ...(c.engineRunning === undefined ? {} : { engineRunning: c.engineRunning }),
      ...(c.ftAboveField === undefined ? {} : { position: at(ELEVATION + c.ftAboveField * FT) }),
      ...(c.ftMsl === undefined ? {} : { position: at(c.ftMsl * FT) }),
    });
    const t = rig.fm.lastTrim!;
    rig.run(0.5);
    const w = rig.fm.state.angularVelocity;
    return { converged: t.converged, residual: t.residual, rate: Math.hypot(w.x, w.y, w.z) };
  });
}

/** A trimmed reset in normal flight (trim.test.ts "trims hands-off with the trim wheel, not the yoke"). */
export function trimWheel(rig: AnyRig, o: { kt: number }): { yoke: number; wheel: number; slipBall: number; gLoadError: number } {
  resetTo(rig, { airspeed: o.kt * KT });
  const s = rig.fm.state, c = rig.fm.trimControls;
  return { yoke: c.elevator, wheel: c.elevatorTrim, slipBall: s.slipBall, gLoadError: s.gLoad - Math.cos(s.pitch) };
}

/** A trimmed reset asked for a climb steeper than full power gives (trim.test.ts "pins the throttle"). */
export function impossibleClimb(rig: AnyRig, o: { kt: number; fpaDeg: number }): { converged: boolean; throttle: number; fpaDeg: number } {
  resetTo(rig, { airspeed: o.kt * KT, flightPathAngle: o.fpaDeg * DEG });
  const t = rig.fm.lastTrim!;
  return { converged: t.converged, throttle: t.throttle, fpaDeg: t.flightPathAngle / DEG };
}

export interface HandsOffResult {
  altDriftM: number;
  headingDriftDeg: number;
  maxVsFpm: number;
  tasChange: number;
}

/** Trimmed cruise flown hands-off (trim.test.ts): drifts are absolute values. */
export function handsOff(rig: AnyRig, o: { kt: number; ftAboveField: number; heading?: number; seconds?: number }): HandsOffResult {
  resetTo(rig, { airspeed: o.kt * KT, position: at(ELEVATION + o.ftAboveField * FT), heading: o.heading ?? 1 });
  const s = rig.fm.state;
  const alt0 = s.altitudeMSL, hdg0 = s.heading, tas0 = s.tas;
  let maxVs = 0;
  rig.run(o.seconds ?? 60, () => {
    maxVs = Math.max(maxVs, Math.abs(s.verticalSpeed));
  });
  return {
    altDriftM: Math.abs(s.altitudeMSL - alt0),
    headingDriftDeg: Math.abs(wrapPi(s.heading - hdg0) / DEG),
    maxVsFpm: fpm(maxVs),
    tasChange: Math.abs(s.tas - tas0),
  };
}

/** Rudder for zero sideslip in a trim at an indicated (calibrated) airspeed; throws if it does not converge. */
export function zeroSideslipRudder(rig: AnyRig, kias: number, altitude: number, throttle?: number): number {
  const tas = tasFromCas(kias * KT, rig.env.atmosphere(altitude));
  const t = rig.fm.solveTrim({ tas, altitude, ...(throttle === undefined ? {} : { throttle }), lateral: 'zeroSideslip' }, rig.env);
  if (!t.converged) throw new Error(`${rig.fm.definition.id}: zero-sideslip trim at ${kias} KIAS did not converge`);
  return t.rudder;
}

export interface PowerYawResult {
  climb: number;
  steep?: number;
  cruise?: number;
}

/**
 * Pedal for zero sideslip at full power in the climb (and the steep climb), and in level flight at a cruise speed
 * (handling.test.ts). Reset at `resetKt` at `ftAboveField` first.
 */
export function powerYaw(rig: AnyRig, o: { ftAboveField: number; resetKt: number; climbKias: number; steepKias?: number; cruiseKias?: number; throttle?: number }): PowerYawResult {
  const alt = ELEVATION + o.ftAboveField * FT;
  resetTo(rig, { airspeed: o.resetKt * KT, position: at(alt) });
  const throttle = o.throttle ?? 1;
  const climb = zeroSideslipRudder(rig, o.climbKias, alt, throttle);
  const steep = o.steepKias === undefined ? undefined : zeroSideslipRudder(rig, o.steepKias, alt, throttle);
  const cruise = o.cruiseKias === undefined ? undefined : zeroSideslipRudder(rig, o.cruiseKias, alt);
  return { climb, steep, cruise };
}

/**
 * Pedal for zero sideslip at the full-throttle level speed near sea level, found by bisection over `bracketKt`
 * (handling.test.ts: the point the C172S's rudder tab is rigged for). The rig should be over LOW_TERRAIN.
 */
export function rigPointRudder(rig: AnyRig, bracketKt: readonly [number, number], resetKt: number, iterations = 16, throttle = 1): { ktas: number; rudder: number } {
  resetTo(rig, { airspeed: resetKt * KT, position: at(300) });
  let [lo, hi] = bracketKt;
  for (let i = 0; i < iterations; i++) {
    const m = 0.5 * (lo + hi);
    if (rig.fm.solveTrim({ tas: m * KT, altitude: 0, throttle, lateral: 'zeroSideslip' }, rig.env).flightPathAngle > 0) lo = m;
    else hi = m;
  }
  return { ktas: lo, rudder: rig.fm.solveTrim({ tas: lo * KT, altitude: 0, throttle, lateral: 'zeroSideslip' }, rig.env).rudder };
}

// ------------------------------------------------------------------------------------------------ stalls

export interface StallRun {
  vs1g: number;
  warningCas: number;
  /** Largest nose-down pitch rate after the lift peak, rad/s (negative). */
  noseDropRate: number;
  pitchLoss: number;
  heightLost: number;
  recoveredIas: number;
  recoveredClimb: number;
  crashed: boolean;
}

export interface StallOptions {
  flapLever: number;
  /** TAS of the trimmed entry, kt. */
  entryKt: number;
  /** Height of the entry above the field, ft. */
  ftAboveField?: number;
  /** Recover after the break: release, full power, then climb away at this IAS (kt). */
  recoverKias?: number;
}

/**
 * Power-off stall, POH style (stall.test.ts): idle, wings level, 1 kt/s deceleration flown on the yoke by the
 * type's autopilot. The stall speed is V_S1g from the highest lift coefficient reached.
 */
export function stallRun(rig: AnyRig, o: StallOptions): StallRun {
  const fm = rig.fm;
  const area = fm.definition.geometry.wing.area;
  resetTo(rig, { airspeed: o.entryKt * KT, position: at(ELEVATION + (o.ftAboveField ?? 3000) * 0.3048), flaps: o.flapLever });
  rig.controls.throttle = 0;
  const ap = new Autopilot(fm.definition.autopilot);
  ap.settings = { ...ap.settings, lateral: 'wingLeveler', vertical: 'airspeed', autoTrim: false };
  const s = fm.state;
  let target = kt(s.ias);
  let warningCas = 0;
  const W = fm.massProperties.mass * G0;
  // Record the entry: lift coefficient, pitch attitude and pitch rate.
  const cl: number[] = [], pitch: number[] = [], q: number[] = [];
  let peak = 0;
  // The entry is flown until the break is clearly past: 6 s after the lift peak with the wing stalled, or 38 s at most.
  rig.run(38, () => {
    target -= FRAME;
    ap.settings.airspeed = target * KT;
    ap.update(FRAME, s, rig.controls);
    if (s.stallWarning && !warningCas) warningCas = kt(fm.cas);
    cl.push(fm.lastAero!.lift / (0.5 * s.airDensity * s.tas * s.tas * area));
    pitch.push(s.pitch);
    q.push(s.angularVelocity.y);
    if (cl[cl.length - 1] > cl[peak]) peak = cl.length - 1;
    return (cl.length - 1 - peak) * FRAME > 6 && fm.lastAero!.stallFraction > 0.2;
  });
  // The break: what the aircraft does in the 6 s after the lift peak.
  const after = Math.min(cl.length, peak + Math.round(6 / FRAME));
  const noseDropRate = Math.min(...q.slice(peak, after));
  const pitchLoss = pitch[peak] - Math.min(...pitch.slice(peak, after));
  const clMax = cl[peak];
  // Height lost from the start of the recovery (6 s after the lift peak) to its lowest point.
  const recoveryStart = s.altitudeMSL;
  let lowest = recoveryStart;
  if (o.recoverKias !== undefined) {
    // Release back pressure, full power, wings level; then climb away.
    ap.settings = { ...ap.settings, vertical: 'pitch', pitch: -2 * DEG };
    rig.controls.throttle = 1;
    const track = () => {
      lowest = Math.min(lowest, s.altitudeMSL);
      ap.update(FRAME, s, rig.controls);
    };
    rig.run(3, track);
    ap.settings = { ...ap.settings, vertical: 'airspeed', airspeed: o.recoverKias * KT };
    rig.run(12, track);
  }
  return {
    vs1g: kt(Math.sqrt((2 * W) / (1.225 * area * clMax))),
    warningCas,
    noseDropRate,
    pitchLoss,
    heightLost: recoveryStart - lowest,
    recoveredIas: kt(s.ias),
    recoveredClimb: s.verticalSpeed,
    crashed: s.crashed,
  };
}

export interface StallRecoveryResult {
  /** Largest stalled fraction of the wing while the stick was held back. */
  stalledFraction: number;
  /** Time from the stick going forward until the wing is unstalled (stallFraction <= `unstalled`), s; Infinity if never. */
  recoveryTime: number;
  /** Highest angle of attack while held back, rad. */
  maxAlpha: number;
  crashed: boolean;
}

/**
 * Stall recovery (contract 3.1, every type): from a trimmed idle glide at `entryKias`, full aft stick held
 * `holdS` s with ailerons and pedals neutral, then the stick forward to `push`; the time until the wing has
 * unstalled is measured over at most `limitS` s.
 */
export function stallRecovery(rig: AnyRig, o: { entryKias: number; ftAboveField?: number; holdS?: number; push?: number; limitS?: number; unstalled?: number }): StallRecoveryResult {
  const def = rig.fm.definition;
  const alt = ELEVATION + (o.ftAboveField ?? 5000) * FT;
  // A glide steeper than idle can fly: the reset pins the throttle at idle and solves the flight path.
  resetTo(rig, { airspeed: tasForKias(def, o.entryKias, alt), position: at(alt), flightPathAngle: -20 * DEG });
  const s = rig.fm.state, c = rig.controls;
  c.throttle = 0;
  c.elevator = 1;
  c.aileron = 0;
  c.rudder = 0;
  let stalledFraction = 0, maxAlpha = -Infinity;
  rig.run(o.holdS ?? 5, () => {
    stalledFraction = Math.max(stalledFraction, s.stallFraction);
    maxAlpha = Math.max(maxAlpha, s.alpha);
  });
  c.elevator = o.push ?? -0.3;
  const t0 = s.time;
  let recoveryTime = Infinity;
  const unstalled = o.unstalled ?? 0.02;
  rig.run(o.limitS ?? 8, () => {
    if (s.stallFraction <= unstalled) {
      recoveryTime = s.time - t0;
      return true;
    }
  });
  return { stalledFraction, recoveryTime, maxAlpha, crashed: s.crashed };
}

// ------------------------------------------------------------------------------------------------ on the ground

/** Cross-track distance from the runway centreline through the origin, m (+ = right of the centreline). */
export function crossTrack(s: AircraftState): number {
  return -s.position.x * Math.sin(RUNWAY_HEADING) + s.position.y * Math.cos(RUNWAY_HEADING);
}

/** Distance along the runway from the origin, m. */
export function alongTrack(s: AircraftState): number {
  return s.position.x * Math.cos(RUNWAY_HEADING) + s.position.y * Math.sin(RUNWAY_HEADING);
}

/** Ground steering law: writes the controls toward a desired heading. */
export type SteerFn = (s: AircraftState, c: ControlInputs, desiredHeading: number) => void;

/** Rudder (and the pedal-steered nosewheel): ground.test.ts steer(). */
export const pedalSteer: SteerFn = (s, c, desired) => {
  const e = wrapPi(desired - s.heading);
  c.rudder = Math.max(-1, Math.min(1, 4 * e - 1.5 * s.angularVelocity.z));
};

/** Differential brake (castering nosewheel), with the rudder doing the same once it has airflow. */
export const brakeSteer: SteerFn = (s, c, desired) => {
  const e = wrapPi(desired - s.heading);
  const d = Math.max(-1, Math.min(1, 4 * e - 1.5 * s.angularVelocity.z));
  c.rudder = d;
  c.brakeLeft = Math.max(c.brakeLeft, -d);
  c.brakeRight = Math.max(c.brakeRight, d);
};

/** The steering law of a type: pedal-steered nosewheel, or differential brake on a castering one. */
export function steerFor(def: AircraftDefinition): SteerFn {
  return def.controls.steering.kind === 'castering' ? brakeSteer : pedalSteer;
}

/** Heading toward a point 60 m ahead on the centreline of RUNWAY_HEADING. */
export function centrelineHeading(s: AircraftState): number {
  return RUNWAY_HEADING - Math.atan2(crossTrack(s), 60);
}

export interface RestResult {
  allWheelsOnGround: boolean;
  /** Height of the reference point above the ground, m. */
  height: number;
  pitchDeg: number;
  /** Crank rpm per engine at idle. */
  idleRpm: number[];
  parkingBrake: boolean;
  takeoffTrim: number;
}

/** Reset on the ground (trim.test.ts "places the aircraft at rest"). */
export function restOnGround(rig: AnyRig): RestResult {
  resetTo(rig, { onGround: true, position: at(0), heading: RUNWAY_HEADING });
  const s = rig.fm.state;
  return {
    allWheelsOnGround: s.wheels.every((w) => w.onGround),
    height: s.altitudeAGL,
    pitchDeg: s.pitch / DEG,
    idleRpm: s.engines.map((e) => e.rpm),
    parkingBrake: rig.fm.trimControls.parkingBrake,
    takeoffTrim: rig.fm.trimControls.elevatorTrim,
  };
}

/** Parked at idle with the parking brake set (ground.test.ts): drift over `seconds` after 2 s, m; largest body rate, rad/s. */
export function parkedDrift(rig: AnyRig, seconds = 30): { drift: number; maxRate: number; running: boolean; minWheelLoad: number } {
  resetTo(rig, { onGround: true, heading: RUNWAY_HEADING });
  const s = rig.fm.state;
  rig.run(2);
  const p0 = { ...s.position };
  let maxRate = 0;
  rig.run(seconds, () => {
    maxRate = Math.max(maxRate, Math.hypot(s.angularVelocity.x, s.angularVelocity.y, s.angularVelocity.z));
  });
  return {
    drift: Math.hypot(s.position.x - p0.x, s.position.y - p0.y, s.position.z - p0.z),
    maxRate,
    running: s.engines.every((e) => e.running),
    minWheelLoad: Math.min(...s.wheels.map((w) => (w.onGround ? w.load : 0))),
  };
}

export interface TaxiResult {
  /** Mean pedal over the straight leg (pedal steering) or mean brake difference right - left (brake steering). */
  meanSteer: number;
  maxHeadingErrorDeg: number;
  groundSpeedKt: number;
  /** Steady turn with full right pedal (or full right brake), m. */
  radius: number;
  maxYawAccel: number;
}

/**
 * Taxi at `speedKt` held with throttle and brakes, straight along the centreline, then a steady turn with full
 * right pedal, or with full right brake on a castering nosewheel (ground.test.ts).
 */
export function taxi(rig: AnyRig, o: { speedKt?: number; idleThrottle?: number } = {}): TaxiResult {
  const castering = rig.fm.definition.controls.steering.kind === 'castering';
  resetTo(rig, { onGround: true, heading: RUNWAY_HEADING });
  const s = rig.fm.state;
  const c = rig.controls;
  c.parkingBrake = false;
  const speed = o.speedKt === undefined ? 5.14 : o.speedKt * KT;
  const base = o.idleThrottle ?? 0.15;
  // Hold the speed with throttle and brakes.
  const hold = () => {
    const e = speed - s.groundSpeed;
    c.throttle = Math.max(0, Math.min(1, base + 0.1 * e));
    c.brakeLeft = c.brakeRight = Math.max(0, Math.min(1, -1.5 * e));
  };
  const steer = castering ? brakeSteer : pedalSteer;
  rig.run(15, () => {
    hold();
    steer(s, c, centrelineHeading(s));
  });
  let sum = 0, maxHdgErr = 0, n = 0;
  rig.run(10, () => {
    hold();
    steer(s, c, centrelineHeading(s));
    sum += castering ? c.brakeRight - c.brakeLeft : c.rudder;
    n++;
    maxHdgErr = Math.max(maxHdgErr, Math.abs(wrapPi(s.heading - RUNWAY_HEADING)));
  });
  const meanSteer = sum / n;
  const maxHeadingErrorDeg = maxHdgErr / DEG;
  const groundSpeedKt = kt(s.groundSpeed);
  // Full right pedal (castering: full right brake as well): steady turn; radius from speed and yaw rate.
  const turn = () => {
    hold();
    if (castering) c.brakeRight = 1;
  };
  c.rudder = 1;
  rig.run(8, turn);
  let prevR = s.angularVelocity.z, maxYawAccel = 0, rSum = 0;
  n = 0;
  rig.run(4, () => {
    turn();
    maxYawAccel = Math.max(maxYawAccel, Math.abs(s.angularVelocity.z - prevR) / FRAME);
    prevR = s.angularVelocity.z;
    rSum += s.angularVelocity.z;
    n++;
  });
  return { meanSteer, maxHeadingErrorDeg, groundSpeedKt, radius: s.groundSpeed / (rSum / n), maxYawAccel };
}

export interface TakeoffRun {
  /** Ground roll from brake release to lift-off, m. */
  roll: number;
  liftoffKias: number;
  maxCross: number;
  maxBank: number;
  crashed: boolean;
  reason: string;
  climbing: boolean;
}

export interface TakeoffOptions {
  flapLever: number;
  rotateKias: number;
  /** Lift-off attitude, rad. */
  pitch: number;
  windKt?: number;
  windFromDeg?: number;
  /** Full power against the brakes for 5 s before releasing them (short-field technique). */
  staticRunUp?: boolean;
  /** Ground steering; default: the type's (steerFor). */
  steer?: SteerFn;
  /** Controls set before the run (gear lever, propeller levers, cowl flaps). */
  controls?: ControlPatch;
  throttle?: number;
}

/** The rig of a ground-roll measurement: sea-level runway, calm or with a steady wind. */
export function runwayRig(def: AircraftDefinition | undefined, loading: 'forward' | 'typical' | 'aft' | 'maxGross', windKt = 0, windFromDeg = 0): AnyRig {
  const env = flatEnvironment(calmWeather({ windSpeedKt: windKt, windDirectionDeg: windFromDeg }), 0);
  return def ? makeRig({ def, loading, env }) : makeRig({ env });
}

/** Ground roll from brake release to lift-off, rotating to `pitch` at `rotateKias` (ground.test.ts takeoffRoll). */
export function takeoffRoll(rig: AnyRig, o: TakeoffOptions): TakeoffRun {
  const windKt = o.windKt ?? 0, windFromDeg = o.windFromDeg ?? 0;
  const steerLaw = o.steer ?? steerFor(rig.fm.definition);
  const steer = (s: AircraftState, c: ControlInputs) => steerLaw(s, c, centrelineHeading(s));
  resetTo(rig, { onGround: true, position: at(0), heading: RUNWAY_HEADING, flaps: o.flapLever });
  const s = rig.fm.state;
  const c = rig.controls;
  if (o.controls) Object.assign(c, o.controls);
  c.throttle = o.throttle ?? 1;
  // Short-field technique: full power against the brakes before releasing them; otherwise a rolling start.
  if (o.staticRunUp ?? true) rig.run(5, () => steer(s, c));
  c.parkingBrake = false;
  c.brakeLeft = c.brakeRight = 0;
  const start = alongTrack(s);
  let liftoff = NaN, liftoffKias = NaN, maxCross = 0, maxBank = 0, rotating = false, pitchTarget = s.pitch, integral = 0;
  const ap = new Autopilot(rig.fm.definition.autopilot);
  ap.settings = { ...ap.settings, lateral: 'wingLeveler', vertical: 'pitch', yawDamper: false, autoTrim: false };
  rig.run(40, () => {
    if (s.onGround) {
      maxCross = Math.max(maxCross, Math.abs(crossTrack(s)));
      maxBank = Math.max(maxBank, Math.abs(s.roll));
      if (steerLaw === brakeSteer) c.brakeLeft = c.brakeRight = 0;
      steer(s, c);
      // Aileron into the wind, washed out as the ailerons gain authority.
      const crosswind = windKt * Math.sin(windFromDeg * DEG - s.heading);
      c.aileron = Math.max(-1, Math.min(1, (0.8 * crosswind) / Math.max(kt(s.ias), 10)));
    }
    rotating ||= kt(s.ias) >= o.rotateKias;
    // Rotate briskly (5 deg/s) to the lift-off attitude and hold it on the yoke.
    if (rotating) pitchTarget = Math.min(o.pitch, pitchTarget + 5 * DEG * FRAME);
    if (rotating) integral = Math.max(-1, Math.min(1, integral + 3 * (pitchTarget - s.pitch) * FRAME));
    c.elevator = rotating ? Math.max(-1, Math.min(1, 5 * (pitchTarget - s.pitch) - 1.5 * s.angularVelocity.y + integral)) : 0;
    if (!s.onGround) {
      if (Number.isNaN(liftoff)) {
        liftoff = alongTrack(s) - start;
        liftoffKias = kt(s.ias);
        ap.settings.pitch = o.pitch;
        ap.reset();
      }
      ap.update(FRAME, s, c);
    }
    return !Number.isNaN(liftoff) && s.altitudeAGL > 15;
  });
  return { roll: liftoff, liftoffKias, maxCross, maxBank, crashed: s.crashed, reason: s.crashReason, climbing: s.verticalSpeed > 0 };
}

export interface LandingRun {
  /** Ground roll from the mains' touchdown to a stop, m. */
  roll: number;
  touchdownSink: number;
  touchdownKias: number;
  crashed: boolean;
}

export interface LandingOptions {
  /** TAS on the 3 degree path, kt. */
  approachKt: number;
  flapLever: number;
  /** Touchdown attitude the flare raises the nose to, rad. */
  touchdownPitch: number;
  /** Height the flare starts at, m above the wheels' rest height. */
  flareM?: number;
  /** Lever retracting the flaps on the roll (0); undefined: as they are. */
  rollFlaps?: number;
  /**
   * Brake pedal on the roll, 0..1; absent: 1 (full). A handbook whose "maximum braking" chart is flown well below
   * the tyres' limit (Piper, Diamond) is matched by the braking it implies, not by weaker brakes (DECISIONS-D2).
   */
  brake?: number;
  steer?: SteerFn;
}

/**
 * Landing ground roll with maximum braking (ground.test.ts): 3 degree path from 60 ft, autopilot vertical speed
 * -1.6 m/s, flare from 6 m with the throttle closed, then nose down, flaps up and full brakes 1 s after touchdown.
 * The rig should sit on a sea-level runway (runwayRig).
 */
export function landingRoll(rig: AnyRig, o: LandingOptions): LandingRun {
  const rest = rig.fm.definition.geometry.restHeight;
  const steerLaw = o.steer ?? steerFor(rig.fm.definition);
  const h = 60 * 0.3048;
  const back = h / Math.tan(3 * DEG);
  resetTo(rig, {
    position: { x: -back * Math.cos(RUNWAY_HEADING), y: -back * Math.sin(RUNWAY_HEADING), z: -(h + rest) },
    heading: RUNWAY_HEADING,
    airspeed: o.approachKt * KT,
    flaps: o.flapLever,
    flightPathAngle: -3 * DEG,
  });
  const s = rig.fm.state;
  const c = rig.controls;
  const ap = new Autopilot(rig.fm.definition.autopilot);
  ap.settings = { ...ap.settings, lateral: 'heading', heading: RUNWAY_HEADING, vertical: 'verticalSpeed', verticalSpeed: -1.6, autoTrim: false };
  const flareM = o.flareM ?? 6;
  let touchdown = NaN, stop = NaN, touchdownSink = NaN, touchdownKias = NaN, touchdownTime = 0, flareStart = 0;
  rig.run(60, () => {
    if (Number.isNaN(touchdown)) {
      // Flare: close the throttle and raise the nose progressively to the touchdown attitude.
      const agl = s.altitudeAGL - rest;
      if (agl < flareM) {
        c.throttle = 0;
        if (ap.settings.vertical !== 'pitch') {
          flareStart = s.pitch;
          ap.settings = { ...ap.settings, vertical: 'pitch' };
        }
        ap.settings.pitch = flareStart + (o.touchdownPitch - flareStart) * Math.min(1, 1 - agl / flareM);
      }
      ap.update(FRAME, s, c);
      if (s.wheels[1].onGround || s.wheels[2].onGround) {
        touchdown = alongTrack(s);
        touchdownKias = kt(s.ias);
        touchdownTime = s.time;
        touchdownSink = -s.verticalSpeed;
      }
    } else {
      // Lower the nose wheel, flaps up, then heavy braking about a second after the mains touch.
      c.throttle = 0;
      c.elevator = 0;
      c.flaps = o.rollFlaps ?? 0;
      c.brakeLeft = c.brakeRight = s.time - touchdownTime > 1 ? (o.brake ?? 1) : 0;
      steerLaw(s, c, centrelineHeading(s));
      if (s.groundSpeed < 0.2) {
        stop = alongTrack(s);
        return true;
      }
    }
  });
  return { roll: stop - touchdown, touchdownSink, touchdownKias, crashed: s.crashed };
}

// ------------------------------------------------------------------------------------------------ cost

/** Minimum over `repeats` of a timed function, ms. */
export function minTime(repeats: number, f: () => void): number {
  let best = Infinity;
  for (let i = 0; i < repeats; i++) {
    const t0 = performance.now();
    f();
    best = Math.min(best, performance.now() - t0);
  }
  return best;
}

/** CPU per physics sub-step in trimmed cruise at `kt`, us (one sample: the caller takes the minimum of several). */
export function subStepCost(rig: AnyRig, o: { kt: number; seconds?: number }): number {
  resetTo(rig, { position: at(ELEVATION + 2000 * FT), airspeed: o.kt * KT });
  rig.run(0.5);
  const seconds = o.seconds ?? 2;
  const t0 = performance.now();
  rig.run(seconds);
  return ((performance.now() - t0) * 1000) / (seconds * rig.fm.physicsRate);
}

/** CPU of one in-air (trimmed) reset and one ground reset, ms (one sample). */
export function resetCost(rig: AnyRig, o: { kt: number }): number {
  const t0 = performance.now();
  resetTo(rig, { position: at(ELEVATION + 2000 * FT), airspeed: o.kt * KT });
  resetTo(rig, { onGround: true });
  return performance.now() - t0;
}

// ------------------------------------------------------------------------------------------------ twins (contract 3.4 "Engine-out trim")

/** Which engine fails: 0 = left, 1 = right. */
export type FailedSide = 0 | 1;

/** Controls of an engine that is not running (contract 3.4 "Failed engine": the flight model's engineStopControls). */
export function stopControls(def: AircraftDefinition, i: number, mode: 'windmilling' | 'feathered'): EngineControls {
  return engineStopControls(def, i, mode);
}

export interface EngineOutTrimOptions {
  failed: FailedSide;
  propeller: 'windmilling' | 'feathered';
  /** Calibrated airspeed, kt. */
  kcas: number;
  altitude: number;
  /** 'fixedBank' (pedal fraction, Vmca: 5 deg toward the live engine) or 'zeroSideslip' (OEI climb). */
  lateral: 'fixedBank' | 'zeroSideslip';
  bankDeg?: number;
  /** Live engine's lever(s); default full throttle. */
  throttle?: number;
  flaps?: number;
  gearDown?: boolean;
  /** Cowl flaps per engine (OEI climb: the live engine's open). */
  cowlFlaps?: readonly number[];
  /** Further fixed controls (the zero-thrust setting of the dead engine through `engines`). */
  fixed?: ControlPatch;
}

/** One engine-out trim. Bank toward the live engine: right wing down (+) when the left engine has failed. */
export function engineOutTrim(rig: AnyRig, o: EngineOutTrimOptions): TrimResult {
  const bank = (o.bankDeg ?? 5) * DEG * (o.failed === 0 ? 1 : -1);
  const spec: TrimSpec = {
    tas: tasForKcas(rig, o.kcas, o.altitude),
    altitude: o.altitude,
    throttle: o.throttle ?? 1,
    flaps: o.flaps ?? 0,
    lateral: o.lateral,
    engineOut: { index: o.failed, propeller: o.propeller },
    gearDown: o.gearDown ?? false,
    ...(o.lateral === 'fixedBank' ? { bank } : {}),
    ...(o.cowlFlaps ? { cowlFlaps: o.cowlFlaps } : {}),
  };
  return rig.fm.solveTrim(spec, rig.env, o.fixed ?? {});
}

/**
 * Pedal fraction an engine-out needs (|rudder| of a converged fixedBank trim; the pedal box is [-1, 1]); NaN when
 * the trim does not converge.
 */
export function pedalFraction(rig: AnyRig, o: Omit<EngineOutTrimOptions, 'lateral'>): number {
  const t = engineOutTrim(rig, { ...o, lateral: 'fixedBank' });
  return t.converged ? Math.abs(t.rudder) : NaN;
}

export interface VmcaResult {
  /** KCAS where the pedal fraction reaches 1 (secant over converged trims), or the slowest converged speed. */
  kcas: number;
  limit: 'rudder' | 'stall';
  /** The converged points the secant used, slowest last: [KCAS, pedal]. */
  points: [number, number][];
}

/**
 * Vmca by secant on pedal(V) = 1 from above over CONVERGED trims only (contract 3.4): "rudder-limited at V" only if a
 * converged trim with pedal >= 0.9 lies within 3 kt of it; otherwise "stall-limited" at the slowest converged speed.
 */
export function vmcaSecant(rig: AnyRig, o: Omit<EngineOutTrimOptions, 'lateral' | 'kcas'> & { startKcas: number; stepKt?: number; minKcas?: number }): VmcaResult {
  const points: [number, number][] = [];
  const step = o.stepKt ?? 5;
  const minKcas = o.minKcas ?? 30;
  // March down until the pedal passes 1 or the trims stop converging.
  for (let v = o.startKcas; v >= minKcas; v -= step) {
    const p = pedalFraction(rig, { ...o, kcas: v });
    if (Number.isNaN(p)) break;
    points.push([v, p]);
    if (p >= 1) break;
  }
  if (points.length === 0) return { kcas: NaN, limit: 'stall', points };
  // Secant iterations between the last two converged points.
  let a = points[Math.max(0, points.length - 2)], b = points[points.length - 1];
  let root = b[1] >= 1 || points.length < 2 ? b[0] : NaN;
  for (let k = 0; k < 8 && points.length >= 2; k++) {
    if (Math.abs(b[1] - a[1]) < 1e-9) break;
    let v = b[0] + ((1 - b[1]) * (b[0] - a[0])) / (b[1] - a[1]);
    // The pedal must grow as the speed falls toward a rudder limit; a secant that points the other way finds none.
    if (!(v < b[0])) break;
    let p = pedalFraction(rig, { ...o, kcas: v });
    // Below the root the trims do not converge (the rudder is on its stop): step back half way toward the slowest
    // converged speed (as tests/fixtures/testbeds.test.ts does).
    while (Number.isNaN(p) && v < b[0] - 0.2) {
      v = 0.5 * (v + b[0]);
      p = pedalFraction(rig, { ...o, kcas: v });
    }
    if (Number.isNaN(p)) {
      // The trims stop converging within 0.2 kt of the slowest converged one: that is the edge.
      root = b[0];
      break;
    }
    points.push([v, p]);
    a = b;
    b = [v, p];
    root = v;
    if (Math.abs(p - 1) < 0.005) break;
  }
  const near = Number.isFinite(root) && points.some(([v, p]) => p >= 0.9 && Math.abs(v - root) <= 3);
  if (near) return { kcas: root, limit: 'rudder', points };
  const slowest = points.reduce((m, p) => (p[0] < m[0] ? p : m));
  return { kcas: slowest[0], limit: 'stall', points };
}

/** OEI rate of climb at a calibrated airspeed, zero sideslip, gear and flaps up, ft/min; NaN if the trim fails. */
export function oeiClimb(rig: AnyRig, o: Omit<EngineOutTrimOptions, 'lateral'>): number {
  const t = engineOutTrim(rig, { ...o, lateral: 'zeroSideslip' });
  return t.converged ? fpm(tasForKcas(rig, o.kcas, o.altitude) * Math.sin(t.flightPathAngle)) : NaN;
}

/**
 * Climb with the dead engine RUNNING at a fixed setting (the handbook's zero-thrust setting) instead of failed,
 * live engine at `throttle`, zero sideslip, gear and flaps up, ft/min; NaN if the trim fails.
 */
export function zeroThrustClimb(rig: AnyRig, o: { dead: FailedSide; setting: EngineControls; kcas: number; altitude: number; throttle?: number; cowlFlaps?: readonly number[] }): number {
  const tas = tasForKcas(rig, o.kcas, o.altitude);
  const engines: EngineControls[] = rig.fm.definition.powerplant.engines.map((_, i) => (i === o.dead ? { ...o.setting } : {}));
  const t = rig.fm.solveTrim(
    { tas, altitude: o.altitude, throttle: o.throttle ?? 1, flaps: 0, lateral: 'zeroSideslip', gearDown: false, ...(o.cowlFlaps ? { cowlFlaps: o.cowlFlaps } : {}) },
    rig.env,
    { engines },
  );
  return t.converged ? fpm(tas * Math.sin(t.flightPathAngle)) : NaN;
}

export interface EngineCutResult {
  maxHeadingChangeDeg: number;
  maxBankDeg: number;
  /** Climbing (or level) at the end of the run. */
  recovered: boolean;
  crashed: boolean;
  /** Vertical speed at the end of the run, ft/min. */
  verticalSpeedFpm: number;
}

/**
 * Flown engine cut (BEHAVIOUR check only): trimmed full-power climb at `kcas`, engine `failed` cut (windmilling
 * controls), the scripted pilot holds wings level and the speed throughout and answers with rudder after
 * `reactionS`.
 */
export function engineCut(rig: AnyRig, o: { failed: FailedSide; kcas: number; ftAboveField?: number; reactionS?: number; seconds?: number }): EngineCutResult {
  const def = rig.fm.definition;
  const alt = ELEVATION + (o.ftAboveField ?? 3000) * FT;
  resetTo(rig, { airspeed: tasForKcas(rig, o.kcas, alt), position: at(alt), flightPathAngle: 3 * DEG });
  const s = rig.fm.state, c = rig.controls;
  c.throttle = 1;
  const ap = new Autopilot(def.autopilot);
  ap.settings = { ...ap.settings, lateral: 'wingLeveler', vertical: 'airspeed', airspeed: o.kcas * KT, yawDamper: false, autoTrim: false };
  rig.run(2, () => ap.update(FRAME, s, c));
  const h0 = s.heading;
  const stop = stopControls(def, o.failed, 'windmilling');
  for (const k of Object.keys(stop) as (keyof EngineControls)[]) setEngineControl(c, o.failed, k, stop[k] as never);
  const t0 = s.time;
  let maxHdg = 0, maxBank = 0, rudderI = 0;
  rig.run(o.seconds ?? 20, () => {
    ap.update(FRAME, s, c);
    if (s.time - t0 > (o.reactionS ?? 1)) {
      const e = wrapPi(h0 - s.heading);
      rudderI = Math.max(-1, Math.min(1, rudderI + 0.5 * e * FRAME));
      c.rudder = Math.max(-1, Math.min(1, 3 * e - 1.5 * s.angularVelocity.z + rudderI));
    } else c.rudder = 0;
    maxHdg = Math.max(maxHdg, Math.abs(wrapPi(s.heading - h0)));
    maxBank = Math.max(maxBank, Math.abs(s.roll));
  });
  return { maxHeadingChangeDeg: maxHdg / DEG, maxBankDeg: maxBank / DEG, recovered: s.verticalSpeed > -0.5 && !s.crashed, crashed: s.crashed, verticalSpeedFpm: fpm(s.verticalSpeed) };
}

// ------------------------------------------------------------------------------------------------ systems

/** Ground run at a throttle that gives `rpm` on engine `i` (bisection on the throttle), then settled; returns the throttle. */
export function runUpTo(rig: AnyRig, rpm: number, i = 0, seconds = 3): number {
  resetTo(rig, { onGround: true, position: at(0) });
  let lo = 0, hi = 1;
  for (let k = 0; k < 12; k++) {
    const m = 0.5 * (lo + hi);
    rig.controls.throttle = m;
    rig.run(seconds);
    if (rig.fm.state.engines[i].rpm < rpm) lo = m;
    else hi = m;
  }
  rig.controls.throttle = 0.5 * (lo + hi);
  rig.run(seconds);
  return rig.controls.throttle;
}

/** rpm drop of engine `i` when `patch` is applied for `seconds` from the present state (the patch is undone after). */
export function rpmDrop(rig: AnyRig, patch: EngineControls, i = 0, seconds = 5): number {
  const c = rig.controls;
  const before = rig.fm.state.engines[i].rpm;
  const keys = Object.keys(patch) as (keyof EngineControls)[];
  // The engine's own overrides before the patch (absent: it followed the scalar).
  const saved = keys.map((k) => c.engines[i][k]);
  for (const k of keys) setEngineControl(c, i, k, patch[k] as never);
  rig.run(seconds);
  const drop = before - rig.fm.state.engines[i].rpm;
  keys.forEach((k, j) => (saved[j] === undefined ? clearEngineControl(c, k, i) : setEngineControl(c, i, k, saved[j] as never)));
  rig.run(seconds);
  return drop;
}

/** Magneto drop at a run-up rpm: [drop on the left magneto, drop on the right magneto] of engine `i`. */
export function magnetoDrop(rig: AnyRig, o: { rpm: number; engine?: number }): [number, number] {
  const i = o.engine ?? 0;
  runUpTo(rig, o.rpm, i);
  const left = rpmDrop(rig, { magnetos: 2 }, i);
  const right = rpmDrop(rig, { magnetos: 1 }, i);
  return [left, right];
}

/** Carburettor-heat rpm drop of engine `i`: at full throttle on the brakes, and at a run-up rpm. */
export function carbHeatDrop(rig: AnyRig, o: { runUpRpm: number; engine?: number }): { fullThrottle: number; runUp: number } {
  const i = o.engine ?? 0;
  resetTo(rig, { onGround: true, position: at(0) });
  rig.controls.throttle = 1;
  rig.run(10);
  const fullThrottle = rpmDrop(rig, { carbHeat: 1 }, i);
  runUpTo(rig, o.runUpRpm, i);
  const runUp = rpmDrop(rig, { carbHeat: 1 }, i);
  return { fullThrottle, runUp };
}

/** Gear retraction and extension times in the air at `kias`, s (Infinity if not completed in 20 s). */
export function gearTransit(rig: AnyRig, o: { kias: number; ftAboveField?: number }): { up: number; down: number } {
  const def = rig.fm.definition;
  const alt = ELEVATION + (o.ftAboveField ?? 3000) * FT;
  resetTo(rig, { airspeed: tasForKias(def, o.kias, alt), position: at(alt), gearDown: true });
  const s = rig.fm.state, c = rig.controls;
  const ap = new Autopilot(def.autopilot);
  ap.settings = { ...ap.settings, lateral: 'wingLeveler', vertical: 'altitude', altitude: s.altitudeMSL, autoTrim: true };
  const timed = (lever: 'up' | 'down', done: () => boolean) => {
    c.gearLever = lever;
    const t0 = s.time;
    let t = Infinity;
    rig.run(20, () => {
      ap.update(FRAME, s, c);
      if (done()) {
        t = s.time - t0;
        return true;
      }
    });
    return t;
  };
  const up = timed('up', () => s.gear.extension.every((e) => e <= 0));
  const down = timed('down', () => s.gear.locked.every((l) => l));
  return { up, down };
}

/** Loss of the best-rate climb (both engines, `throttle`) at `kcas` with the gear down instead of up, ft/min. */
export function gearDownClimbLoss(rig: AnyRig, o: { kcas: number; altitude: number; throttle?: number }): number {
  const tas = tasForKcas(rig, o.kcas, o.altitude);
  const climb = (gearDown: boolean) => {
    const t = rig.fm.solveTrim({ tas, altitude: o.altitude, throttle: o.throttle ?? 1, gearDown }, rig.env);
    if (!t.converged) throw new Error(`${rig.fm.definition.id}: climb trim with the gear ${gearDown ? 'down' : 'up'} did not converge`);
    return fpm(tas * Math.sin(t.flightPathAngle));
  };
  return climb(false) - climb(true);
}
