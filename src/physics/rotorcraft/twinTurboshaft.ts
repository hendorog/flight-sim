// Twin turboshaft drivetrain (Bo 105 CB-4: two Allison 250-C20B on one freewheeling transmission): the contract and an
// S0 stub. Owner after the scaffold: TW. Plan revision 2, sections 3.2 and 5.
//
// Seams placed at S0:
//  - Rotorcraft.drive(..., extraEngines?) -> driveFreewheel: `if (d.systems.twinTurboshaft && extraEngines)` couples
//    every engine through jointFreewheelImpulse() and publishes through publishTwin(); otherwise the legacy text.
//  - flightModel.ts: the substep calls stepTwinTurboshaft() in place of stepTurboshaft() on a twin, passes
//    units.slice(1) to drive(), and the reset's engine bisection calls twinResetEngineControls(); every rotorcraft unit
//    is externalDrive. TW owns flightModel.ts and replaces these stub branches.
// The S0 stub flies on engine 0 alone and keeps engine 2 cut (mixture 0), so the Bo 105 stub spawns.
import type { ControlInputs, EngineControls } from '../../core/types';
import type { EngineUnit } from '../propulsion/engineUnit';
import type { RotorcraftDefinition, RotorcraftState } from './definition';
import { emptyTurboshaftState, type TurboshaftControl } from './turboshaft';

export interface TwinTurboshaftDef {
  engines: 2;
  /** ENGINE TRIM left/right: differential set-point rate (fraction N2/s) and authority (+/- fraction N2). ESTIMATE. */
  splitTrim: { rate: number; range: number };
  /** Engine 2 governor datum offset, fraction N2 (AGENT: torque split 4 +/- 2 % at hover until synchronised). */
  rigMismatch: number;
  /** FS 72B ratings in the gauge unit (% torque, deg C, s): OEI MCP 95 % / 779 C; OEI emergency 95 % / 810 C, 30 min
   *  (P TCDS p9, P5 FM 2-9). */
  oei: { mcpPct: number; mcpTotC: number; emergencyPct: number; emergencyTotC: number; emergencySeconds: number };
  /** Warning unit (P TM 00-44, P5 FM 3-16): N1 split >= 12 %; NR <= 95 % (light + 650 Hz 5/s); NR >= 103 % (light);
   *  NR >= 108 % (2600 Hz steady). Percent. */
  warnings: { n1SplitPct: number; nrLowPct: number; nrHighPct: number; nrHighTonePct: number };
}

/** RotorcraftState.twinTurboshaft (created in reset for a twin, never lazily). RotorcraftState.turboshaft stays engine 1. */
export interface TwinTurboshaftState {
  /** Engine 2's block, the same shape as RotorcraftState.turboshaft. */
  second: NonNullable<RotorcraftState['turboshaft']>;
  /** ENGINE TRIM split, % N2 (+ raises engine 2, lowers engine 1). */
  splitPct: number;
  n1SplitLight: boolean; nrLowLight: boolean; nrLowTone: boolean; nrHighLight: boolean; nrHighTone: boolean;
  /** One engine below 55 % N1 with the other running; seconds above the OEI MCP. */
  oei: boolean; oeiSeconds: number;
}

export function emptyTwinTurboshaftState(d: RotorcraftDefinition, running: boolean): TwinTurboshaftState {
  return { second: emptyTurboshaftState(d.systems.turboshaft!, running), splitPct: 0,
    n1SplitLight: false, nrLowLight: false, nrLowTone: false, nrHighLight: false, nrHighTone: false, oei: false, oeiSeconds: 0 };
}

/**
 * One-way freewheel impulses (N m s at each engine's output shaft) for one step, after RC has integrated the rotor's
 * free deceleration: omega rotor rad/s, inertia the drivetrain inertia reflected to the rotor (kg m^2), engines' shaft
 * speeds (rad/s) and inertias, the engine-to-rotor ratio, the transmission efficiency, the coupling cap (N m at the
 * engine shaft). TW: a joint inelastic impulse over the engaged set, closed form, order independent (T2).
 * S0 STUB: the legacy single-engine impulse on engine 0, nothing on the others.
 */
export function jointFreewheelImpulse(omega: number, inertia: number, engines: readonly { omega: number; inertia: number }[],
  ratio: number, efficiency: number, capNm: number, dt: number): number[] {
  const out = engines.map(() => 0);
  const e = engines[0];
  const excess = e.omega - omega * ratio;
  out[0] = excess > 0 ? Math.min(excess / (1 / e.inertia + efficiency * ratio ** 2 / inertia), capNm * dt) : 0;
  return out;
}

/** Gauges and warnings of both engines and the rotor (called by RC in place of TurboshaftControl.publish on a twin).
 *  S0 STUB: engine 1 as on the MD 500E. */
export function publishTwin(ts: TurboshaftControl, _state: RotorcraftState, dt: number, c: ControlInputs,
  units: readonly EngineUnit[], volts: number, onGround: boolean): void {
  ts.publish(dt, c, units[0], volts, onGround);
}

/** Both fuel controls and governors for one step, writing `out` (the engine controls the powerplant sees).
 *  S0 STUB: engine 1 as on the MD 500E; engine 2 cut. */
export function stepTwinTurboshaft(dt: number, c: Readonly<ControlInputs>, units: readonly EngineUnit[], out: ControlInputs,
  busVolts: number, ts: TurboshaftControl, _state: RotorcraftState): void {
  ts.stepTurboshaft(dt, c, units[0], out, busVolts);
  out.engines = twinStubEngines();
}

/** The per-engine control overrides the reset's quasi-steady engine bisection uses on a twin. S0 STUB: engine 2 cut. */
export function twinResetEngineControls(): EngineControls[] {
  return twinStubEngines();
}

function twinStubEngines(): EngineControls[] {
  return [{}, { mixture: 0, throttle: 0 }];
}
