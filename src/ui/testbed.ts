// Test-bed for the type-dependent UI before Stage D: a synthetic twin UiProfile (two lever sets, per-engine
// switches and read-outs, the type's own hints rows) and a twin definition made from another one, for
// tests/ui and the dev page (dev/ui.html?type=twin). Synthetic: no real aircraft's texts or numbers.

import type { AircraftDefinition, UiProfile } from '../aircraft/types';
import { KT, RAD } from '../core/math';
import { engineControl, type ControlInputs, type EngineControlKey } from '../core/types';

const onOff = (b: boolean): string => (b ? 'ON' : 'OFF');
const percent = (v: number): string => `${Math.round(v * 100)}%`;
const SIDES = ['L', 'R'] as const;

/** One HUD lever per engine for a per-engine control. */
function leverPair(label: string, key: EngineControlKey & ('throttle' | 'propeller' | 'mixture'), style?: 'mixture'): UiProfile['hud']['levers'] {
  return SIDES.map((side, i) => ({
    label: `${label} ${side}`,
    read: (c: ControlInputs) => engineControl(c, i, key),
    text: (c: ControlInputs) => percent(engineControl(c, i, key)),
    ...(style ? { style } : {}),
  }));
}

export const TWIN_TESTBED_UI: UiProfile = {
  controlName: 'yoke',
  startupSteps: [
    ['Master', 'W (battery and both alternators on)'],
    ['Engine', '8 left engine (9 right)'],
    ['Mixture', 'hold Shift+M until FULL RICH'],
    ['Propeller', 'hold Shift+; until full forward'],
    ['Parking brake', 'check SET (PARKING BRAKE shown); only if it is not, Shift+B sets it'],
    ['Start', 'hold S until the engine runs, then let go; then the other engine'],
  ],
  starterAdvice(c, engine) {
    const side = SIDES[engine] ?? 'L';
    if (!c.masterBattery) return 'Starter: the master switch is OFF. Press W first.';
    if (engineControl(c, engine, 'fuelSelector') === 'off') return `Starter: the ${side} fuel selector is OFF (Shift+J).`;
    if (engineControl(c, engine, 'mixture') < 0.02) return `${side} mixture at IDLE CUT-OFF: hold Shift+M for full rich, then crank (S).`;
    return null;
  },
  switches: [
    { id: 'masterBattery', label: 'Battery', read: (c) => onOff(c.masterBattery) },
    { id: 'alternator', label: 'Alternators', read: (c) => onOff(c.alternator) },
    { id: 'avionics', label: 'Avionics', read: (c) => onOff(c.avionics) },
    { id: 'magnetosL', label: 'Left magnetos', read: (c) => String(engineControl(c, 0, 'magnetos')) },
    { id: 'magnetosR', label: 'Right magnetos', read: (c) => String(engineControl(c, 1, 'magnetos')) },
    { id: 'fuelPumpL', label: 'Left fuel pump', read: (c) => onOff(engineControl(c, 0, 'fuelPump')) },
    { id: 'fuelPumpR', label: 'Right fuel pump', read: (c) => onOff(engineControl(c, 1, 'fuelPump')) },
    { id: 'landing', label: 'Landing light', read: (c) => onOff(c.lights.landing) },
  ],
  hud: {
    levers: [
      ...leverPair('THR', 'throttle'),
      ...leverPair('PROP', 'propeller'),
      ...leverPair('MIX', 'mixture', 'mixture'),
      { label: 'FLAPS', read: (c) => c.flaps, text: (_c, s) => `${Math.round(s.surfaces.flaps * RAD)}°` },
      { label: 'TRIM', read: (c) => 0.5 + c.elevatorTrim * 0.5, text: (c) => percent(c.elevatorTrim), style: 'marker' },
      { label: 'R TRIM', read: (c) => 0.5 + c.rudderTrim * 0.5, text: (c) => percent(c.rudderTrim), style: 'marker' },
    ],
    readouts: [
      { label: 'RPM L', text: (s) => `${Math.round((s.engines[0]?.rpm ?? 0) / 10) * 10}` },
      { label: 'RPM R', text: (s) => `${Math.round((s.engines[1]?.rpm ?? 0) / 10) * 10}` },
    ],
  },
  hints: [
    ['Engines', '8 left · 9 right · 0 both'],
    ['Propellers', '; lower rpm · Shift+; higher · Shift+F feather'],
    ['Gear', 'F7 down · Shift+F7 up'],
  ],
};

/**
 * `base` as a retractable twin with constant-speed propellers and rudder trim: two engines, Vmca 66 and Vyse
 * 88 KIAS, gear limit speeds, and the flap and gear overspeed chips switched on. Everything else is `base`'s.
 */
export function twinTestbedDefinition(base: AircraftDefinition): AircraftDefinition {
  return {
    ...base,
    engineCount: 2,
    reference: { ...base.reference, vmca: 66, vyse: 88, vle: 130, vloExtend: 130, vloRetract: 110 },
    limits: {
      ...base.limits,
      vleCas: 130 * KT,
      vloExtendCas: 130 * KT,
      vloRetractCas: 110 * KT,
      flapOverspeed: { consequence: 'warn', margin: 0.02, time: 1 },
      gearOverspeed: { consequence: 'warn', margin: 0.02, time: 1 },
    },
    input: {
      ...base.input,
      engines: 2,
      ignition: 'toggles',
      has: { ...base.input.has, propeller: true, feather: true, cowlFlaps: true, gear: true, rudderTrim: true },
    },
  };
}
