// Turboshaft output stage of a helicopter (by definition data; the pattern is the Rolls-Royce (Allison) 250-C20B of
// the MD 500E): the twist grip as the power lever, the hydromechanical power-turbine (N2) governor that trims the
// gas producer's (N1) demand, its collective droop compensator and the electric beep, and the ENGINE OUT / low-rotor
// warning with auto-reignition. The gas producer and the free power turbine are the existing turbine core
// (propulsion/turbineEngine.ts, gasGenerator.ts) with the engine output shaft as its "crank" (EngineDef.gearRatio 1);
// the freewheel between that shaft and the transmission is Rotorcraft.drive()'s 'freewheel' path. Design and the
// calibration of every gain: docs/turboshaft-model.md.
//
// The fuel control (one lever law for the whole engine, read from the engine's own fcu, never duplicated):
//   PLA schedule  ngPla = groundIdle Ng below the GROUND IDLE stop, rising linearly to fullOpen Ng at FULL OPEN;
//   PTG demand    ngPtg = datum + anticipation x collective + gain x (set - N2 - lead x dN2/dt) + integral,
//                 the integral driving (set - N2) toward droop x (ngPtg - datum - anticipation x collective):
//                 a proportional governor with `droop` of steady N2 per unit N1 above the compensator's datum,
//                 stiffened by the integral in transients only;
//   N1 demand     min(ngPla, max(ngPtg, groundIdle)): the governor never asks for less than ground idle, and the grip
//                 caps it (grip below full open, or ControlInputs.rotorGovernor === false: manual, RFM 3-14/3-15).
// The demand reaches the turbine core as a PLA-equivalent throttle: with fcu.lowIdleNg = fcu.highIdleNg =
// plaNg.groundIdle and fcu.maxNg = plaNg.fullOpen, turbineEngine's lever law ngDemand = idle + (max - idle) x
// throttle inverts exactly. The fuel topping governor (powerTurbine.topping) stays in the core.

import { clamp } from '../../core/math';
import { engineControl, type ControlInputs, type EngineControls } from '../../core/types';
import type { EngineUnit } from '../propulsion/engineUnit';
import { TurbineEngine } from '../propulsion/turbineEngine';
import type { RotorcraftDefinition, RotorcraftState, TurboshaftControlDef } from './definition';

/** Bus voltage the beep actuator, the ENG OUT warning unit and the reignition relay need, V (the MD 500E's 18 V). */
export const TURBOSHAFT_BUS_VOLTS = 18;
/** Transmission oil pressure that arms the auto-reignition (RFM 1-12: "armed by M/R transmission oil pressure"), psi. ESTIMATE. */
export const REIGNITION_ARM_PSI = 5;
/**
 * The low-rotor half of the ENGINE OUT warning arms once Nr has reached its threshold and disarms below this fraction
 * of 100 % Nr ON THE GROUND only (skids loaded): the warnings are out at ground idle (RFM 4-16), while a severe
 * underspeed in flight keeps the light and horn on however low Nr falls. ESTIMATE (the unit's logic is not published).
 */
export const LOW_ROTOR_DISARM = 0.7;
/** Time constant of the governor's N2-rate sensing, s. */
const RATE_FILTER = 0.05;

/** Grip position against the twist-grip stops. */
export function gripPosition(grip: TurboshaftControlDef['grip'], throttle: number): 'cutoff' | 'groundIdle' | 'between' | 'fullOpen' {
  const g = clamp(throttle, 0, 1);
  if (g < grip.cutoffBelow) return 'cutoff';
  if (g <= grip.groundIdle + 1e-9) return 'groundIdle';
  return g >= 1 - 1e-9 ? 'fullOpen' : 'between';
}

/** N1 the grip's PLA schedule allows, fraction. */
export function plaNg(ts: TurboshaftControlDef, throttle: number): number {
  const g = clamp(throttle, 0, 1), idle = ts.grip.groundIdle;
  return g <= idle ? ts.plaNg.groundIdle : ts.plaNg.groundIdle + (ts.plaNg.fullOpen - ts.plaNg.groundIdle) * (g - idle) / (1 - idle);
}

/** Where one engine's persistent turboshaft block lives in the rotorcraft state. Evaluated on every call, never
 *  cached: a resume replaces the blocks (Object.assign of a cloned state). */
export type TurboshaftSlot = (s: RotorcraftState) => RotorcraftState['turboshaft'];
const ENGINE_1_SLOT: TurboshaftSlot = (s) => s.turboshaft;

/**
 * The turboshaft's fuel control and N2 governor. Its persistent state is RotorcraftState.turboshaft (snapshots), or
 * the block `slot` names: a twin (twinTurboshaft.ts) runs a second control on RotorcraftState.twinTurboshaft.second.
 */
export class TurboshaftControl {
  readonly ts: TurboshaftControlDef;

  constructor(readonly def: RotorcraftDefinition, private readonly state: RotorcraftState,
    private readonly slot: TurboshaftSlot = ENGINE_1_SLOT) {
    if (!def.systems.turboshaft) throw new Error('TurboshaftControl: the definition has no systems.turboshaft');
    this.ts = def.systems.turboshaft;
  }

  /** This control's persistent block (engine 1: RotorcraftState.turboshaft). */
  block(): RotorcraftState['turboshaft'] {
    return this.slot(this.state);
  }

  /** Engine output shaft (N2) speed, fraction of ratedRpm. */
  n2(engine: EngineUnit): number {
    return engine.omega * engine.gearRatio * 30 / Math.PI / engine.install.engine.ratedRpm;
  }

  /** The droop compensator's datum: datumNg (flat-pitch N1) + anticipation x collective (+ propAnticipation x the
   *  pusher lever on a type that declares it, AH-56A; seam placed at S0, TW owns this file). */
  datum(collective: number, propLever?: number): number {
    const prop = this.ts.governor.propAnticipation;
    if (prop) return (this.ts.governor.datumNg ?? this.ts.plaNg.groundIdle) + this.ts.governor.anticipation * clamp(collective, 0, 1) +
      prop * clamp(propLever ?? 0, 0, 1);
    return (this.ts.governor.datumNg ?? this.ts.plaNg.groundIdle) + this.ts.governor.anticipation * clamp(collective, 0, 1);
  }

  /**
   * The governor integral that holds N1 demand `ng` at N2 `n2` with the beep at `setPct` (%), collective
   * `collective`: a quasi-steady state for resets (no transient at release).
   */
  steadyIntegral(ng: number, n2: number, setPct: number, collective: number, propLever?: number, datumOffset = 0): number {
    const g = this.ts.governor;
    const datum = datumOffset ? this.datum(collective, propLever) + datumOffset : this.datum(collective, propLever);
    return ng - datum - g.gain * (setPct / 100 - n2);
  }

  /** The beep set point (%) at which the governor holds N2 `n2` steady while demanding N1 `ng`. `datumOffset`: an
   *  engine's droop-compensator datum offset, N1 fraction (twin rig mismatch). */
  steadySetPct(ng: number, n2: number, collective: number, propLever?: number, datumOffset = 0): number {
    const datum = datumOffset ? this.datum(collective, propLever) + datumOffset : this.datum(collective, propLever);
    return 100 * (n2 + this.ts.governor.droop * (ng - datum));
  }

  /**
   * One step of the fuel control and governor (called by the flight model in place of Rotorcraft.throttle()):
   * writes the PLA-equivalent throttle, the condition (mixture: fuel cut-off), the igniters (auto-reignition) and a
   * fresh per-engine override list into `out`, and fills state.turboshaft.
   */
  stepTurboshaft(dt: number, c: Readonly<ControlInputs>, engine: EngineUnit, out: ControlInputs, busVolts: number): void {
    const ts = this.ts, r = this.state, s = this.slot(r);
    if (!s) throw new Error('TurboshaftControl: state.turboshaft is missing (reset the rotorcraft first)');
    const gi = ts.plaNg.groundIdle, fo = ts.plaNg.fullOpen;
    const collective = clamp(c.collective ?? 0, 0, 1);
    const demand = this.govern(s, dt, c, clamp(c.throttle, 0, 1), engine, busVolts, 0, 0);
    r.governorThrottle = r.governorIntegral = clamp((demand - gi) / (fo - gi), 0, 1);
    r.governorActive = s.governorMode === 'governed';
    r.previousThrottle = c.throttle; r.previousCollective = collective;
    out.throttle = r.governorThrottle;
    out.mixture = s.grip === 'cutoff' ? 0 : 1;
    // Auto-reignition fires the exciter while RE IGN P RST is lit (generic harness: until the pilot resets it).
    out.magnetos = s.reignitionLight ? 3 : c.magnetos;
    out.engines = [{}];
  }

  /**
   * One engine of a multi-engine installation (twinTurboshaft.ts): engine `i`'s lever is engineControl(c, i,
   * 'throttle') and its own block (this control's slot) carries the governor. `setOffset` (N2 fraction, the ENGINE TRIM
   * split) is added to the beep set point and `datumOffset` (N1 fraction, a rig mismatch) to the compensator datum.
   * Returns the engine's override (the pilot's own per-engine overrides kept, then throttle, mixture, magnetos);
   * writes no rotor-level field.
   */
  stepEngine(dt: number, c: Readonly<ControlInputs>, i: number, engine: EngineUnit, busVolts: number, setOffset: number,
    datumOffset: number): EngineControls {
    const ts = this.ts, s = this.slot(this.state);
    if (!s) throw new Error('TurboshaftControl: the engine block is missing (reset the rotorcraft first)');
    const gi = ts.plaNg.groundIdle, fo = ts.plaNg.fullOpen;
    const demand = this.govern(s, dt, c, clamp(engineControl(c, i, 'throttle'), 0, 1), engine, busVolts, setOffset, datumOffset);
    return { ...c.engines[i], throttle: clamp((demand - gi) / (fo - gi), 0, 1), mixture: s.grip === 'cutoff' ? 0 : 1,
      magnetos: s.reignitionLight ? 3 : engineControl(c, i, 'magnetos') };
  }

  /** The fuel control and governor of one engine block for one step; returns the N1 demand (fraction). */
  private govern(s: NonNullable<RotorcraftState['turboshaft']>, dt: number, c: Readonly<ControlInputs>, grip: number,
    engine: EngineUnit, busVolts: number, setOffset: number, datumOffset: number): number {
    const ts = this.ts, g = ts.governor;
    const gi = ts.plaNg.groundIdle;
    const collective = clamp(c.collective ?? 0, 0, 1);
    const n2 = this.n2(engine);
    // N2 of the last step and its filtered rate live in the state (snapshots: a resume mid-transient keeps the
    // governor's rate term); absent after a reset, they are seeded from the shaft with no rate.
    const seeded = Number.isFinite(s.n2Last) && Number.isFinite(s.n2Rate);
    let n2Rate = seeded ? s.n2Rate! : 0;
    if (dt > 0 && seeded) n2Rate += ((n2 - s.n2Last!) / dt - n2Rate) * (1 - Math.exp(-dt / RATE_FILTER));
    if (dt > 0 || !seeded) { s.n2Last = n2; s.n2Rate = n2Rate; }
    if (dt > 0) {
      // The beep actuator is electric (N2 GOV circuit breaker).
      if (busVolts > TURBOSHAFT_BUS_VOLTS) s.n2SetPct = clamp(s.n2SetPct + 100 * g.beepRate * clamp(c.n2Beep ?? 0, -1, 1) * dt,
        100 * g.setRange[0], 100 * g.setRange[1]);
    }
    s.grip = gripPosition(ts.grip, grip);
    const pla = plaNg(ts, grip);
    const set = setOffset ? s.n2SetPct / 100 + setOffset : s.n2SetPct / 100;
    const datum = datumOffset ? this.datum(collective, c.propLever) + datumOffset : this.datum(collective, c.propLever);
    const ptg = datum + g.gain * (set - n2 - g.lead * n2Rate) + s.ptgIntegral;
    const governing = c.rotorGovernor !== false;
    let demand: number;
    if (governing) {
      demand = Math.min(pla, Math.max(ptg, gi));
      // Integral with droop feedback; frozen while a limit holds the demand against it (no wind-up).
      const drive = set - n2 - g.droop * (ptg - datum);
      const limitedHigh = ptg > pla && drive > 0, limitedLow = ptg < gi && drive < 0;
      if (dt > 0 && !limitedHigh && !limitedLow) s.ptgIntegral += g.integralGain * g.gain * drive * dt;
      // Bumpless return from the grip's limit: the integral follows the demand the grip allows.
      if (ptg > pla + 0.02) s.ptgIntegral = pla + 0.02 - datum - g.gain * (set - n2 - g.lead * n2Rate);
    } else {
      // Governor failed / out of the system (RFM 3-14): the grip alone; the integral tracks for a bumpless return.
      demand = pla;
      s.ptgIntegral = demand - datum - g.gain * (set - n2 - g.lead * n2Rate);
    }
    s.ptgIntegral = clamp(s.ptgIntegral, -1, 1);
    s.governorMode = governing && s.grip === 'fullOpen' ? 'governed' : 'manual';
    return demand;
  }

  /**
   * After the coupling (Rotorcraft.drive): the gauges and warnings of the turboshaft installation, from the engine's
   * N1, TOT and output-shaft torque. `onGround` (skids loaded) lets the low-rotor warning disarm at ground idle.
   */
  publish(dt: number, c: Readonly<ControlInputs>, engine: EngineUnit, busVolts: number, onGround = false, rotorLevel = true): void {
    const ts = this.ts, d = this.def, r = this.state, s = this.slot(r);
    if (!s) return;
    const turbine = engine.engine instanceof TurbineEngine ? engine.engine : undefined;
    const n1 = turbine ? turbine.ng : 0, tot = turbine ? turbine.ittC : 15;
    const n2 = this.n2(engine), nr = r.rotorRpm / d.referenceRpm;
    s.n2Pct = 100 * n2; s.nrPct = 100 * nr;
    s.torquePsi = engine.state.torque * ts.psiPerNm;
    s.needlesSplit = s.nrPct - s.n2Pct > 1;
    const powered = busVolts > TURBOSHAFT_BUS_VOLTS;
    if (nr >= ts.engineOut.nrBelow) s.lowRotorArmed = true;
    else if (nr < LOW_ROTOR_DISARM && onGround) s.lowRotorArmed = false;
    const warning = n1 < ts.engineOut.n1Below || (s.lowRotorArmed === true && nr < ts.engineOut.nrBelow);
    s.engineOutLight = powered && warning;
    // Pre-generic and late-generic harness: the audio is enabled by the generator switch (RFM 3-25 note, 4-17).
    s.engineOutHorn = s.engineOutLight && c.alternator;
    const armed = powered && (r.transmission ? r.transmission.oilPressurePsi > REIGNITION_ARM_PSI : true);
    if (armed && s.engineOutLight) s.reignitionLight = true;
    if (c.lampTestId === 'reign' && !warning) s.reignitionLight = false;
    if (!powered) s.reignitionLight = false;
    const l = ts.limits;
    s.overTorque = s.torquePsi > l.takeoffPsi;
    s.overTemp = turbine !== undefined && turbine.firing && tot > l.totC.takeoff;
    s.avoidRange = s.n2Pct > l.n2AvoidPct[0] && s.n2Pct < l.n2AvoidPct[1];
    // One engine of a twin: the rotor-level fields are the twin's (twinTurboshaft.ts publishTwin).
    if (!rotorLevel) return;
    const mcp = tot > l.mcpPsiAboveTot.totC ? l.mcpPsiAboveTot.psi : l.mcpPsi;
    r.takeoffPowerSeconds = s.torquePsi > mcp || (turbine?.firing === true && tot > l.totC.mcp) ? r.takeoffPowerSeconds + dt : 0;
    r.powerLimitExceeded = s.overTorque || s.overTemp || 100 * n1 > l.n1Pct.continuous || r.takeoffPowerSeconds > l.takeoffSeconds;
    r.lowRpm = nr < d.systems.lowRpmWarning;
    r.lowRpmLight = s.engineOutLight;
    r.lowRpmHorn = s.engineOutHorn;
    r.governorActive = s.governorMode === 'governed';
  }
}

/** The turboshaft's state after a reset: stopped (grip CUTOFF) or running governed at the default set point. */
export function emptyTurboshaftState(ts: TurboshaftControlDef, running: boolean): NonNullable<RotorcraftState['turboshaft']> {
  return { n2SetPct: 100 * ts.governor.setDefault, ptgIntegral: 0, grip: running ? 'fullOpen' : 'cutoff',
    governorMode: running ? 'governed' : 'manual', n2Pct: 0, nrPct: 0, torquePsi: 0, needlesSplit: false,
    engineOutLight: false, engineOutHorn: false, reignitionLight: false, overTorque: false, overTemp: false,
    avoidRange: false, lowRotorArmed: running };
}
