// Piper PA-38-112 Tomahawk II: what the UI says about this type (start-up card, starter advice, the switches
// announced by toast, the HUD's lever bars and engine read-out, the hints that only this type needs). The closures
// are written INLINE against the controls and the state.
//
// What differs from the C172S: a carburetted engine with a carburettor heat lever on the quadrant (key /), a fuel
// selector LEFT / RIGHT / OFF with no BOTH (one tank at a time: the pilot changes tanks), an electric fuel pump
// for take-off, landing and tank changes, no avionics master (the radios have their own switches; the avionics
// key stands for them), hand flaps on the floor. "s.N" is section N of the type's engineering data sheet
// (aircraft-data/pa38.md in the design work folder).

import { RAD } from '../../core/math';
import { engineControl, type FuelSelector, type MagnetoPosition } from '../../core/types';
import type { UiProfile } from '../types';

/**
 * Mixture lever positions below this are idle cut-off: the lever's cut-off position, the same number as
 * IDLE_CUTOFF of physics/propulsion/combustion.ts.
 */
const MIXTURE_CUTOFF = 0.02;
/** Mixture lever positions at or above this read FULL RICH. */
const FULL_RICH = 0.985;
/** Below this the metered mixture is too lean for a start (lean flammability limit near phi 0.6). */
const START_MIXTURE_MIN = 0.5;
/** Carburettor heat lever: further down than this reads ON. */
const CARB_HEAT_ON = 0.5;

const MAGNETO_NAMES: Record<MagnetoPosition, string> = { 0: 'OFF', 1: 'R', 2: 'L', 3: 'BOTH' };
const FUEL_NAMES: Record<FuelSelector, string> = { off: 'OFF', left: 'LEFT', right: 'RIGHT', both: 'BOTH', on: 'ON', crossfeed: 'CROSSFEED' };

/**
 * Engine start (POH 4.13, s.10), each step a check or a target state. No priming: the hand primer is not
 * modelled (the engine starts without it).
 */
const STARTUP_STEPS: readonly [string, string][] = [
  ['Fuel selector', 'check LEFT or RIGHT, the fuller tank (Shift+J cycles; there is no BOTH)'],
  ['Carburettor heat', 'OFF (/ toggles it)'],
  ['Throttle', 'open half an inch: F3 (or Page Up) briefly (~10%)'],
  ['Master', 'W (battery and alternator on)'],
  ['Electric fuel pump', 'J: ON'],
  ['Mixture', 'hold Shift+M until FULL RICH'],
  ['Parking brake', 'check SET (PARKING BRAKE shown); only if it is not, Shift+B sets it'],
  ['Start', 'hold S until the engine runs, then let go; about 800 rpm'],
  ['After start', 'oil pressure rising · J fuel pump OFF, fuel pressure green · I radios on · release the parking brake (Shift+B) to taxi'],
];

const onOff = (b: boolean): string => (b ? 'ON' : 'OFF');
const percent = (v: number): string => `${Math.round(v * 100)}%`;
const carbHeat = (v: number): string => (v > CARB_HEAT_ON ? 'ON' : 'OFF');

function mixtureLabel(m: number): string {
  if (m < MIXTURE_CUTOFF) return 'Mixture IDLE CUT-OFF';
  if (m >= FULL_RICH) return 'Mixture FULL RICH';
  return `Mixture ${Math.round(m * 100)}%`;
}

export const PA38_UI: UiProfile = {
  controlName: 'yoke',
  startupSteps: STARTUP_STEPS,
  // Checked in the order a pilot would find it: no power to the starter, no fuel, mixture at cut-off or too lean.
  starterAdvice(c, engine) {
    if (!c.masterBattery) return 'Starter: the master switch is OFF. Press W first.';
    if (engineControl(c, engine, 'fuelSelector') === 'off') return 'Starter: the fuel selector is OFF. Shift+J selects a tank.';
    const mixture = engineControl(c, engine, 'mixture');
    if (mixture < MIXTURE_CUTOFF) return 'Mixture at IDLE CUT-OFF: hold Shift+M for full rich, then crank (S).';
    if (mixture < START_MIXTURE_MIN) return `${mixtureLabel(mixture)}: too lean to start. Hold Shift+M for full rich.`;
    return null;
  },
  // In the order they are announced. The two halves of the master switch ('masterBattery', 'alternator') are
  // announced as one "Master switch ON / OFF" when they end up alike.
  switches: [
    { id: 'masterBattery', label: 'Battery', read: (c) => onOff(c.masterBattery) },
    { id: 'alternator', label: 'Alternator', read: (c) => onOff(c.alternator) },
    { id: 'avionics', label: 'Radios', read: (c) => onOff(c.avionics) },
    { id: 'magnetos', label: 'Magnetos', read: (c) => MAGNETO_NAMES[c.magnetos] },
    { id: 'fuelSelector', label: 'Fuel selector', read: (c) => FUEL_NAMES[c.fuelSelector] },
    { id: 'fuelPump', label: 'Electric fuel pump', read: (c) => onOff(c.fuelPump) },
    { id: 'carbHeat', label: 'Carburettor heat', read: (c) => carbHeat(c.carbHeat) },
    { id: 'pitotHeat', label: 'Pitot heat', read: (c) => onOff(c.pitotHeat) },
    { id: 'nav', label: 'Nav lights', read: (c) => onOff(c.lights.nav) },
    { id: 'beacon', label: 'Beacon', read: (c) => onOff(c.lights.beacon) },
    { id: 'strobe', label: 'Strobes', read: (c) => onOff(c.lights.strobe) },
    { id: 'landing', label: 'Landing light', read: (c) => onOff(c.lights.landing) },
    { id: 'taxi', label: 'Taxi light', read: (c) => onOff(c.lights.taxi) },
  ],
  hud: {
    levers: [
      { label: 'THR', read: (c) => c.throttle, text: (c) => percent(c.throttle) },
      { label: 'MIX', read: (c) => c.mixture, text: (c) => percent(c.mixture), style: 'mixture' },
      // The lever's travel (1 = full heat).
      { label: 'CARB', read: (c) => c.carbHeat, text: (c) => carbHeat(c.carbHeat) },
      // The bar is the lever, the number the flap angle reached.
      { label: 'FLAPS', read: (c) => c.flaps, text: (_c, s) => `${Math.round(s.surfaces.flaps * RAD)}°` },
      // The trim wheel's position along its travel (centre = neutral) and its sense ("12% UP", "8% DN", "0%").
      {
        label: 'TRIM',
        read: (c) => 0.5 + c.elevatorTrim * 0.5,
        text: (c) => {
          const pct = Math.round(Math.abs(c.elevatorTrim) * 100);
          return pct === 0 ? '0%' : `${pct}% ${c.elevatorTrim > 0 ? 'UP' : 'DN'}`;
        },
        style: 'marker',
      },
    ],
    // The tachometer is the only engine power instrument of the type (s.4: no manifold pressure gauge).
    readouts: [{ label: 'RPM', text: (s) => `${Math.round(s.engine.rpm / 10) * 10}` }],
  },
  hints: [
    ['Fuel selector', 'Shift+J: LEFT, RIGHT, OFF (no BOTH: change tanks every hour, electric pump on for the change)'],
    ['Electric fuel pump', 'J: ON for take-off, landing and tank changes'],
    ['Carburettor heat', '/ : ON when icing is suspected and before closing the throttle for a long descent; OFF for take-off and go-around'],
  ],
};
