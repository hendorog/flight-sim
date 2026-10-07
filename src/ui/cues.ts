// Pure helpers behind the UI's pilot cues: key-cap parsing for the Controls tab, lever / switch change
// messages (toasts for keyboard pilots), starter advice when a start cannot succeed, and trim readouts.
// No DOM here, so all of it is unit tested (tests/instruments/uiCues.test.ts).

import { C172S_UI, FULL_RICH, STARTUP_STEPS } from '../aircraft/c172s/ui';
import type { UiProfile } from '../aircraft/types';
import type { ControlInputs, FuelSelector, MagnetoPosition } from '../core/types';
import { IDLE_CUTOFF } from '../physics/propulsion/combustion';

// --- Controls tab key caps ---------------------------------------------------------------------------

/** "A / D" -> ["A", "D"]. Alternatives are joined with " / " (spaces required, so a "/" key survives). */
export function splitKeyAlternatives(keys: string): string[] {
  return keys.split(/\s+\/\s+/).filter((k) => k.length > 0);
}

/**
 * "Shift+F" -> ["Shift", "F"]; "Num +" stays one key; "Shift+Num +" -> ["Shift", "Num +"]. Only a '+' with
 * non-space text on both sides joins a modifier to a key.
 */
export function splitKeyCombo(combo: string): string[] {
  return combo
    .split(/(?<=\S)\+(?=\S)/)
    .map((k) => k.trim())
    .filter((k) => k.length > 0);
}

// --- Lever and switch readouts -----------------------------------------------------------------------

// The Cessna 172S's tables and thresholds, under the names this module has always exported.
export { FUEL_NAMES, FULL_RICH, MAGNETO_NAMES, STARTUP_STEPS, START_MIXTURE_MIN } from '../aircraft/c172s/ui';

export function mixtureLabel(m: number): string {
  if (m < IDLE_CUTOFF) return 'Mixture IDLE CUT-OFF';
  if (m >= FULL_RICH) return 'Mixture FULL RICH';
  return `Mixture ${Math.round(m * 100)}%`;
}

/** Trim readout: percentage of travel from the neutral mark, with its sense ("12% UP", "8% DN", "0%"). */
export function trimLabel(trim: number): string {
  const pct = Math.round(Math.abs(trim) * 100);
  if (pct === 0) return '0%';
  return `${pct}% ${trim > 0 ? 'UP' : 'DN'}`;
}

/** The read-outs of a type's announced switches (UiProfile.switches order), written into `out` when given. */
export function switchReads(ui: UiProfile, c: ControlInputs, out?: string[]): string[] {
  const o = out ?? [];
  const sw = ui.switches;
  o.length = sw.length;
  for (let i = 0; i < sw.length; i++) o[i] = sw[i].read(c);
  return o;
}

/**
 * One message "<label> <read>" per switch whose read-out changed between two switchReads() of the same
 * profile. The two halves of a split master switch (ids 'masterBattery' and 'alternator') are announced once
 * as "Master switch <read>" when they end up alike, else the half that changed (the alternator when both did).
 */
export function switchMessages(ui: UiProfile, prev: readonly string[], cur: readonly string[]): string[] {
  const out: string[] = [];
  const sw = ui.switches;
  const bat = sw.findIndex((s) => s.id === 'masterBattery');
  const alt = sw.findIndex((s) => s.id === 'alternator');
  const master = bat >= 0 && alt >= 0;
  for (let i = 0; i < sw.length; i++) {
    if (master && (i === bat || i === alt)) {
      // Announced once, where the first of the two halves is listed.
      if (i !== Math.min(bat, alt)) continue;
      const batChanged = prev[bat] !== cur[bat];
      const altChanged = prev[alt] !== cur[alt];
      if (!batChanged && !altChanged) continue;
      if (cur[bat] === cur[alt]) out.push(`Master switch ${cur[bat]}`);
      else if (altChanged) out.push(`${sw[alt].label} ${cur[alt]}`);
      else out.push(`${sw[bat].label} ${cur[bat]}`);
      continue;
    }
    if (prev[i] !== cur[i]) out.push(`${sw[i].label} ${cur[i]}`);
  }
  return out;
}

/** The discrete controls the UI announces when they change (the Cessna 172S's switches). */
export interface SwitchSnapshot {
  masterBattery: boolean;
  alternator: boolean;
  avionics: boolean;
  magnetos: MagnetoPosition;
  fuelPump: boolean;
  fuelSelector: FuelSelector;
  pitotHeat: boolean;
  nav: boolean;
  beacon: boolean;
  strobe: boolean;
  landing: boolean;
  taxi: boolean;
}

/** Snapshot of the switches, written into `out` when given (no allocation per frame). */
export function switchSnapshot(c: ControlInputs, out?: SwitchSnapshot): SwitchSnapshot {
  const o = out ?? ({} as SwitchSnapshot);
  o.masterBattery = c.masterBattery;
  o.alternator = c.alternator;
  o.avionics = c.avionics;
  o.magnetos = c.magnetos;
  o.fuelPump = c.fuelPump;
  o.fuelSelector = c.fuelSelector;
  o.pitotHeat = c.pitotHeat;
  o.nav = c.lights.nav;
  o.beacon = c.lights.beacon;
  o.strobe = c.lights.strobe;
  o.landing = c.lights.landing;
  o.taxi = c.lights.taxi;
  return o;
}

/** The switch positions of a snapshot as the controls C172S_UI.switches read. */
function snapshotControls(s: SwitchSnapshot): ControlInputs {
  const { nav, beacon, strobe, landing, taxi, ...rest } = s;
  return { ...rest, lights: { nav, beacon, strobe, landing, taxi } } as unknown as ControlInputs;
}

/** One message per switch that changed between two snapshots (the master's two halves are merged). Cessna 172S. */
export function switchChanges(prev: SwitchSnapshot, cur: SwitchSnapshot): string[] {
  return switchMessages(C172S_UI, switchReads(C172S_UI, snapshotControls(prev)), switchReads(C172S_UI, snapshotControls(cur)));
}

/**
 * Why cranking cannot start the engine, or null when nothing obvious is wrong. Checked in the order a
 * pilot would find it: no power to the starter, no fuel, mixture at cut-off or too lean. Cessna 172S.
 */
export function starterAdvice(c: ControlInputs): string | null {
  return C172S_UI.starterAdvice(c, 0);
}

/** Index of the parking-brake check in STARTUP_STEPS. */
export const STARTUP_BRAKE_STEP = STARTUP_STEPS.findIndex(([what]) => what === 'Parking brake');

/**
 * The parking-brake step for the live hints card, from the brake's actual state: a tick when it is already
 * set (nothing to press), otherwise the key that sets it.
 */
export function parkingBrakeStepText(set: boolean): string {
  return set ? '\u2713 SET (PARKING BRAKE shown): leave it' : 'NOT set: press Shift+B to set it';
}

// --- Simulation rate ------------------------------------------------------------------------------------

/** Time-acceleration choices on the menu's Flight page (the simulator accepts 0.125..16). */
export const SIM_RATES: readonly number[] = [0.5, 1, 2, 4, 8, 16];

/**
 * Note beside the rate buttons: the rate the CPU actually achieves when it falls short of the request
 * (physics per-frame budget), otherwise empty.
 */
export function achievedRateLabel(requested: number, achieved: number | undefined, paused: boolean): string {
  if (paused || achieved === undefined || !Number.isFinite(achieved) || requested <= 1) return '';
  if (achieved >= requested * 0.95) return '';
  const a = achieved >= 10 ? Math.round(achieved) : Math.round(achieved * 10) / 10;
  return `Achieving about ${a}× (limited by the CPU)`;
}
