// Twin turboshaft drivetrain (Bo 105 CB-4: two Allison 250-C20B on one main transmission, each through its own
// freewheel). Owner: TW. Plan revision 2, sections 3.2 and 5; the design, the calibration of every number and the
// acceptance rows: docs/twin-turboshaft.md.
//
// Seams placed at S0 (RC keeps them in rotorcraft.ts; flightModel.ts is TW's):
//  - Rotorcraft.drive(..., extraEngines?) -> driveFreewheel: `if (d.systems.twinTurboshaft && extraEngines)` integrates
//    the rotor's free deceleration once, couples every engine through jointFreewheelImpulse() and publishes through
//    publishTwin(); otherwise the legacy single-engine text.
//  - flightModel.ts: the substep calls stepTwinTurboshaft() in place of stepTurboshaft() on a twin and passes
//    units.slice(1) to drive(); the reset bisects the running engines together (twinResetEngineControls) and seeds the
//    governors with resetTwinTurboshaft().
//
// The model in one paragraph. Each engine has its own fuel control and N2 governor on the single-engine law
// (turboshaft.ts: PLA schedule, proportional droop with a collective compensator, an integral that only acts in
// transients), engine 1 on RotorcraftState.turboshaft and engine 2 on RotorcraftState.twinTurboshaft.second. The two
// output shafts meet the rotor through two one-way clutches; with both engaged they turn at the same speed, so the
// load splits by the droop of the two governors: equal rigging, equal torque. ENGINE TRIM fore/aft (n2Beep) moves both
// set points together; left/right (n2BeepSplit) moves splitPct, which raises engine 2's fuel demand (its droop
// compensator's datum) by half of it and lowers engine 1's by the other half (P5 FM 7-12: one engine's torque up, the
// other's down), so the torques trade with no change of N2 and without the governor integral's lag. `rigMismatch`
// offsets engine 2's datum the same way, so a fresh run-up shows a small torque split until the pilot synchronises
// (FM 4-16 "Torque - synchronize"). The warning unit (P TM 00-44, P5 FM 3-16) and the AEO/OEI ratings (P TCDS p9) are
// published here.
import { clamp } from '../../core/math';
import { engineControl, type ControlInputs, type EngineControls } from '../../core/types';
import type { EngineUnit } from '../propulsion/engineUnit';
import { TurbineEngine } from '../propulsion/turbineEngine';
import type { RotorcraftDefinition, RotorcraftState } from './definition';
import { emptyTurboshaftState, TURBOSHAFT_BUS_VOLTS, TurboshaftControl } from './turboshaft';

export interface TwinTurboshaftDef {
  engines: 2;
  /** ENGINE TRIM left/right: rate of the split between the two governors' datums (N1 fraction/s) and its authority
   *  (+/- N1 fraction). ESTIMATE (the FM gives neither): set so a held switch moves the torque split at 1.5-3 %/s. */
  splitTrim: { rate: number; range: number };
  /** Engine 2's droop-compensator datum offset, N1 fraction: the rigging difference between the two governors that
   *  leaves a torque split at hover until the pilot synchronises (AGENT choice, ESTIMATE value). */
  rigMismatch: number;
  /** FS 72B ratings in the gauge unit (% torque, deg C, s): OEI MCP 95 % / 779 C; OEI emergency 95 % / 810 C, 30 min
   *  (P TCDS p9, P5 FM 2-9). The torque values are compared only on a 'percent' torque gauge. */
  oei: { mcpPct: number; mcpTotC: number; emergencyPct: number; emergencyTotC: number; emergencySeconds: number };
  /** Warning unit (P TM 00-44, P5 FM 3-16): N1 split >= 12 %; NR <= 95 % (light + 650 Hz 5/s); NR >= 103 % (light);
   *  NR >= 108 % (2600 Hz steady). Percent. `nrLowFloorPct`: the low-rotor band's lower end (TM 00-44: 75-95 %), so
   *  the unit is quiet at ground idle; absent: no floor. */
  warnings: { n1SplitPct: number; nrLowPct: number; nrHighPct: number; nrHighTonePct: number; nrLowFloorPct?: number };
}

/** RotorcraftState.twinTurboshaft (created in reset for a twin, never lazily). RotorcraftState.turboshaft stays engine 1. */
export interface TwinTurboshaftState {
  /** Engine 2's block, the same shape as RotorcraftState.turboshaft. Its n2SetPct always equals engine 1's (the common
   *  ENGINE TRIM fore/aft set point); the split is applied at each step to the datums, never stored in the set points. */
  second: NonNullable<RotorcraftState['turboshaft']>;
  /** ENGINE TRIM split, % N1 of the governors' datums (+ raises engine 2, lowers engine 1, half each). */
  splitPct: number;
  /** The warning unit (bus powered). n1SplitLight: N1 differ by >= n1SplitPct (the unit beeps with it); nrLowLight /
   *  nrLowTone: NR in [nrLowFloorPct, nrLowPct] (650 Hz, 5 per s); nrHighLight: NR >= nrHighPct; nrHighTone: NR >=
   *  nrHighTonePct (2600 Hz steady). All of them flash the one RPM warning light (RotorcraftState.lowRpmLight). */
  n1SplitLight: boolean; nrLowLight: boolean; nrLowTone: boolean; nrHighLight: boolean; nrHighTone: boolean;
  /** One engine out (N1 below the turboshaft's engineOut.n1Below) with the other running; seconds above the OEI MCP. */
  oei: boolean; oeiSeconds: number;
}

type Block = NonNullable<RotorcraftState['turboshaft']>;

export function emptyTwinTurboshaftState(d: RotorcraftDefinition, running: boolean): TwinTurboshaftState {
  return { second: emptyTurboshaftState(d.systems.turboshaft!, running), splitPct: 0,
    n1SplitLight: false, nrLowLight: false, nrLowTone: false, nrHighLight: false, nrHighTone: false, oei: false, oeiSeconds: 0 };
}

/** Engine 2's control, one per engine-1 control (its slot is a function of the state: a resume replaces the block). */
const SECOND = new WeakMap<TurboshaftControl, TurboshaftControl>();
/** The fuel control and governor of engine 2 of the twin whose engine-1 control is `ts`. */
export function secondEngineControl(ts: TurboshaftControl, state: RotorcraftState): TurboshaftControl {
  let t = SECOND.get(ts);
  if (!t) {
    t = new TurboshaftControl(ts.def, state, (s) => s.twinTurboshaft?.second);
    SECOND.set(ts, t);
  }
  return t;
}

/**
 * One-way freewheel impulses (N m s at each engine's output shaft) for one step, after RC has integrated the rotor's
 * free deceleration: `omega` rotor rad/s, `inertia` the drivetrain inertia reflected to the rotor (kg m^2), the
 * engines' shaft speeds (rad/s) and inertias (kg m^2), the engine-to-rotor ratio r, the transmission efficiency eta and
 * the coupling cap (N m at each engine shaft: at most capNm x dt per engine and step).
 *
 * A joint inelastic impulse over the engaged set S, the engines whose shaft overruns the rotor (omega_i > r omega):
 * the rotor gains eta r sum J / I, and every free engine of S ends at the common shaft speed v = r omega', so with
 * a = eta r^2 / I and C the capped engines (J = capNm dt)
 *   v (1 + a sum_free I_i) = r omega + a sum_free I_i omega_i + a sum_C capNm dt,   J_i = I_i (omega_i - v).
 * An engine whose J would be negative leaves S, one whose J exceeds the cap joins C, and the set is solved again. The
 * sums run in a canonical order (by shaft speed, then inertia), so the result does not depend on the engines' order
 * (T2). One engine, no cap: the legacy impulse excess / (1/I_e + eta r^2 / I).
 */
export function jointFreewheelImpulse(omega: number, inertia: number, engines: readonly { omega: number; inertia: number }[],
  ratio: number, efficiency: number, capNm: number, dt: number): number[] {
  const n = engines.length, out = new Array<number>(n).fill(0);
  const a = efficiency * ratio * ratio / inertia, cap = capNm * dt;
  const order = engines.map((_, i) => i).sort((i, k) => engines[i].omega - engines[k].omega || engines[i].inertia - engines[k].inertia);
  const free = engines.map((e) => e.omega > omega * ratio);
  const capped = engines.map(() => false);
  for (let pass = 0; pass <= n; pass++) {
    let sumIw = 0, sumI = 0, sumCap = 0;
    for (const i of order) {
      if (free[i]) { sumIw += engines[i].inertia * engines[i].omega; sumI += engines[i].inertia; } else if (capped[i]) sumCap += cap;
    }
    const v = (omega * ratio + a * sumIw + a * sumCap) / (1 + a * sumI);
    let changed = false;
    for (let i = 0; i < n; i++) {
      if (!free[i]) continue;
      const j = engines[i].inertia * (engines[i].omega - v);
      if (j < 0) { free[i] = false; changed = true; } else if (j > cap) { free[i] = false; capped[i] = true; changed = true; }
    }
    if (!changed) {
      for (let i = 0; i < n; i++) out[i] = free[i] ? engines[i].inertia * (engines[i].omega - v) : capped[i] ? cap : 0;
      return out;
    }
  }
  // Every pass that does not return takes an engine out of the free set, so n + 1 passes always end above.
  return out;
}

/** The ENGINE OUT N1 test of one engine, its N1 (fraction), TOT (C) and whether it is alight. */
function gasProducer(unit: EngineUnit): { n1: number; tot: number; firing: boolean } {
  const t = unit.engine instanceof TurbineEngine ? unit.engine : undefined;
  return { n1: t ? t.ng : 0, tot: t ? t.ittC : 15, firing: t?.firing === true };
}

/**
 * Gauges and warnings of both engines and the rotor (called by RC in place of TurboshaftControl.publish on a twin).
 * Each engine publishes its own block (torque, N2, needles split, over-torque and over-temperature against
 * TurboshaftControlDef.limits) with the rotor-level writes suppressed; then this sets the rotor-level fields:
 *  - the warning unit's flags; lowRpm = NR at or below nrLowPct; lowRpmLight = the one RPM warning light (any of
 *    N1 split, NR low, NR high); lowRpmHorn = the 650 Hz low-rotor tone (the N1-split beeping is n1SplitLight, the
 *    2600 Hz tone nrHighTone);
 *  - governorActive: either engine governed;
 *  - with one engine out (`oei`), powerLimitExceeded from the OEI ratings (torque on a 'percent' gauge, TOT, N1, the
 *    30-min emergency timer `oeiSeconds` that runs above the OEI MCP); otherwise from the AEO limits of each engine
 *    and the take-off timer (takeoffPowerSeconds) that runs while either engine is above MCP.
 */
export function publishTwin(ts: TurboshaftControl, state: RotorcraftState, dt: number, c: ControlInputs,
  units: readonly EngineUnit[], volts: number, onGround: boolean): void {
  const tw = state.twinTurboshaft, def = ts.def.systems.twinTurboshaft, s1 = state.turboshaft;
  ts.publish(dt, c, units[0], volts, onGround, false);
  secondEngineControl(ts, state).publish(dt, c, units[1], volts, onGround, false);
  if (!tw || !def || !s1) return;
  const s2 = tw.second, l = ts.ts.limits, w = def.warnings;
  const e1 = gasProducer(units[0]), e2 = gasProducer(units[1]);
  const nr = 100 * state.rotorRpm / ts.def.referenceRpm;
  const powered = volts > TURBOSHAFT_BUS_VOLTS;
  // Warning unit K-DW02/01 (needs the bus).
  tw.n1SplitLight = powered && 100 * Math.abs(e1.n1 - e2.n1) >= w.n1SplitPct;
  tw.nrLowLight = tw.nrLowTone = powered && nr <= w.nrLowPct && nr >= (w.nrLowFloorPct ?? -Infinity);
  tw.nrHighLight = powered && nr >= w.nrHighPct;
  tw.nrHighTone = powered && nr >= w.nrHighTonePct;
  state.lowRpm = nr <= w.nrLowPct;
  state.lowRpmLight = tw.n1SplitLight || tw.nrLowLight || tw.nrHighLight;
  state.lowRpmHorn = tw.nrLowTone;
  state.governorActive = s1.governorMode === 'governed' || s2.governorMode === 'governed';
  // OEI: one gas producer below the ENGINE OUT N1 with the other above it.
  const out1 = e1.n1 < ts.ts.engineOut.n1Below, out2 = e2.n1 < ts.ts.engineOut.n1Below;
  tw.oei = out1 !== out2;
  if (tw.oei) {
    const s = out1 ? s2 : s1, e = out1 ? e2 : e1;
    const pct = ts.ts.torqueGauge === 'percent' ? s.torquePsi : NaN;
    const aboveMcp = pct > def.oei.mcpPct || (e.firing && e.tot > def.oei.mcpTotC);
    tw.oeiSeconds = aboveMcp ? tw.oeiSeconds + dt : 0;
    state.takeoffPowerSeconds = 0;
    state.powerLimitExceeded = pct > def.oei.emergencyPct || (e.firing && e.tot > def.oei.emergencyTotC) ||
      100 * e.n1 > l.n1Pct.continuous || tw.oeiSeconds > def.oei.emergencySeconds;
  } else {
    tw.oeiSeconds = 0;
    const aboveMcp = (s: Block, e: ReturnType<typeof gasProducer>): boolean =>
      s.torquePsi > (e.tot > l.mcpPsiAboveTot.totC ? l.mcpPsiAboveTot.psi : l.mcpPsi) || (e.firing && e.tot > l.totC.mcp);
    state.takeoffPowerSeconds = aboveMcp(s1, e1) || aboveMcp(s2, e2) ? state.takeoffPowerSeconds + dt : 0;
    state.powerLimitExceeded = s1.overTorque || s2.overTorque || s1.overTemp || s2.overTemp ||
      100 * Math.max(e1.n1, e2.n1) > l.n1Pct.continuous || state.takeoffPowerSeconds > l.takeoffSeconds;
  }
}

/**
 * Both fuel controls and governors for one step, writing `out` (the engine controls the powerplant sees): the ENGINE
 * TRIM split (electric, like the beep), then each engine on its own lever (engineControl(c, i, 'throttle')) and block
 * on the common set point, engine 1's datum at -splitPct/2 and engine 2's at +splitPct/2 + rigMismatch. `out.engines` is a fresh array of the two overrides (each keeps the pilot's own per-engine overrides,
 * e.g. the selected engine's starter); the scalars carry engine 1's.
 */
export function stepTwinTurboshaft(dt: number, c: Readonly<ControlInputs>, units: readonly EngineUnit[], out: ControlInputs,
  busVolts: number, ts: TurboshaftControl, state: RotorcraftState): void {
  const tw = state.twinTurboshaft, def = ts.def.systems.twinTurboshaft;
  if (!tw || !def) throw new Error('stepTwinTurboshaft: state.twinTurboshaft is missing (reset the rotorcraft first)');
  if (dt > 0 && busVolts > TURBOSHAFT_BUS_VOLTS) {
    const range = 100 * def.splitTrim.range;
    tw.splitPct = clamp(tw.splitPct + 100 * def.splitTrim.rate * clamp(c.n2BeepSplit ?? 0, -1, 1) * dt, -range, range);
  }
  const half = tw.splitPct / 200;
  const e1 = ts.stepEngine(dt, c, 0, units[0], busVolts, 0, -half);
  const e2 = secondEngineControl(ts, state).stepEngine(dt, c, 1, units[1], busVolts, 0, half + def.rigMismatch);
  state.governorThrottle = state.governorIntegral = e1.throttle!;
  state.governorActive = state.turboshaft!.governorMode === 'governed' || tw.second.governorMode === 'governed';
  state.previousThrottle = engineControl(c, 0, 'throttle'); state.previousCollective = clamp(c.collective ?? 0, 0, 1);
  out.throttle = e1.throttle!;
  out.mixture = e1.mixture!;
  out.magnetos = e1.magnetos!;
  out.engines = [e1, e2];
}

/**
 * The per-engine overrides the reset's quasi-steady engine bisection uses on a twin: a running engine follows the
 * bisected scalar throttle; a stopped one (running[i] false) has its lever OFF and its fuel cut.
 */
export function twinResetEngineControls(running: readonly boolean[] = [true, true]): EngineControls[] {
  return running.map((on) => (on ? {} : { throttle: 0, mixture: 0 }));
}

/**
 * Seed both governors after the reset's bisection so the release has no transient (T10): `ng` is the N1 demand
 * (fraction) the bisection found for the running engines (the same for both), `collective` and `propLever` the trimmed
 * controls. The split is synchronised (splitPct cancels the rig mismatch, so the datums and torques match), both set
 * points take the common value at which the governors hold the present N2, and each running engine's integral is the
 * steady one. A stopped engine (running[i] false) keeps the common set point, a zero integral and its grip at CUTOFF.
 */
export function resetTwinTurboshaft(ts: TurboshaftControl, state: RotorcraftState, units: readonly EngineUnit[],
  running: readonly boolean[], ng: number, collective: number, propLever?: number): void {
  const tw = state.twinTurboshaft, def = ts.def.systems.twinTurboshaft, s1 = state.turboshaft;
  if (!tw || !def || !s1) return;
  const g = ts.ts.governor, second = secondEngineControl(ts, state), s2 = tw.second;
  const range = 100 * def.splitTrim.range;
  // Equal datums, so equal N1 and torque at the shared N2: splitPct / 100 = -rigMismatch.
  tw.splitPct = clamp(-100 * def.rigMismatch, -range, range);
  const half = tw.splitPct / 200, offset = [-half, half + def.rigMismatch];
  for (const [i, s] of [[0, s1], [1, s2]] as const) if (!running[i]) { s.ptgIntegral = 0; s.grip = 'cutoff'; s.governorMode = 'manual'; }
  const lead = running[0] ? 0 : running[1] ? 1 : -1;
  if (lead < 0) return;
  // The common set point that holds this N2 at this N1 on the running engine's datum.
  const set = clamp(ts.steadySetPct(ng, ts.n2(units[lead]), collective, propLever, offset[lead]), 100 * g.setRange[0], 100 * g.setRange[1]);
  s1.n2SetPct = s2.n2SetPct = set;
  if (running[0]) s1.ptgIntegral = ts.steadyIntegral(ng, ts.n2(units[0]), set, collective, propLever, offset[0]);
  if (running[1]) s2.ptgIntegral = second.steadyIntegral(ng, second.n2(units[1]), set, collective, propLever, offset[1]);
}
