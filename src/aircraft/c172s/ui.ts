// Cessna 172S: what the UI says about this type (start-up card, starter advice, the switches announced by
// toast, the HUD's lever bars and engine read-out). The closures are written INLINE against the controls and
// the state. The tables and thresholds live here; src/ui/cues.ts re-exports them under the names it has always
// exported, and its starterAdvice / switchChanges are wrappers over C172S_UI.

import { RAD } from '../../core/math';
import { engineControl, type FuelSelector, type MagnetoPosition } from '../../core/types';
import type { UiProfile } from '../types';

/**
 * Mixture lever positions below this are idle cut-off: the lever's cut-off position, the same number as
 * IDLE_CUTOFF of physics/propulsion/combustion.ts (tests/ui/profile.test.ts checks they agree).
 */
const MIXTURE_CUTOFF = 0.02;
/** Mixture lever positions at or above this read FULL RICH. */
export const FULL_RICH = 0.985;
/** Below this the metered mixture is too lean for a start (see combustion.ts meteredPhi): lean flammability limit near phi 0.6. */
export const START_MIXTURE_MIN = 0.5;

export const MAGNETO_NAMES: Record<MagnetoPosition, string> = { 0: 'OFF', 1: 'R', 2: 'L', 3: 'BOTH' };
export const FUEL_NAMES: Record<FuelSelector, string> = { off: 'OFF', left: 'LEFT', right: 'RIGHT', both: 'BOTH', on: 'ON', crossfeed: 'CROSSFEED' };

/**
 * Engine start procedure shown in the hints card and the Controls tab. Every step is phrased as a check
 * or a target state, never as a bare toggle: the apron scenario already has the parking brake set, and a
 * "set (Shift+B)" step followed literally released it (tests/instruments/uiCues.test.ts).
 */
export const STARTUP_STEPS: readonly [string, string][] = [
  ['Master', 'W (battery and alternator on)'],
  ['Mixture', 'hold Shift+M until FULL RICH'],
  ['Throttle', 'open about a quarter inch: F3 (or Page Up) briefly (~10%)'],
  ['Parking brake', 'check SET (PARKING BRAKE shown); only if it is not, Shift+B sets it'],
  ['Start', 'hold S until the engine runs, then let go'],
  ['After start', 'I avionics on · lights as needed · release the parking brake (Shift+B) when ready to taxi'],
];

const onOff = (b: boolean): string => (b ? 'ON' : 'OFF');
const percent = (v: number): string => `${Math.round(v * 100)}%`;

function mixtureLabel(m: number): string {
  if (m < MIXTURE_CUTOFF) return 'Mixture IDLE CUT-OFF';
  if (m >= FULL_RICH) return 'Mixture FULL RICH';
  return `Mixture ${Math.round(m * 100)}%`;
}

export const C172S_UI: UiProfile = {
  controlName: 'yoke',
  startupSteps: STARTUP_STEPS,
  // Checked in the order a pilot would find it: no power to the starter, no fuel, mixture at cut-off or too lean.
  starterAdvice(c, engine) {
    if (!c.masterBattery) return 'Starter: the master switch is OFF. Press W first.';
    if (engineControl(c, engine, 'fuelSelector') === 'off') return 'Starter: the fuel selector is OFF (Shift+J).';
    const mixture = engineControl(c, engine, 'mixture');
    if (mixture < MIXTURE_CUTOFF) return 'Mixture at IDLE CUT-OFF: hold Shift+M for full rich, then crank (S).';
    if (mixture < START_MIXTURE_MIN) return `${mixtureLabel(mixture)}: too lean to start. Hold Shift+M for full rich.`;
    return null;
  },
  // In the order they are announced. The two halves of the master switch ('masterBattery', 'alternator') are
  // announced as one "Master switch ON / OFF" when they end up alike (cues.ts switchMessages).
  switches: [
    { id: 'masterBattery', label: 'Battery', read: (c) => onOff(c.masterBattery) },
    { id: 'alternator', label: 'Alternator', read: (c) => onOff(c.alternator) },
    { id: 'avionics', label: 'Avionics', read: (c) => onOff(c.avionics) },
    { id: 'magnetos', label: 'Magnetos', read: (c) => MAGNETO_NAMES[c.magnetos] },
    { id: 'fuelPump', label: 'Fuel pump', read: (c) => onOff(c.fuelPump) },
    { id: 'fuelSelector', label: 'Fuel selector', read: (c) => FUEL_NAMES[c.fuelSelector] },
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
    readouts: [{ label: 'RPM', text: (s) => `${Math.round(s.engine.rpm / 10) * 10}` }],
  },
  // The hints card has no row that only this type needs.
  hints: [],
};
