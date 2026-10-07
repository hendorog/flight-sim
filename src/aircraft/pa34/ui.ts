// Piper PA-34-200 Seneca I: what the UI says about this type (start-up card, starter advice, the switches announced
// by toast, the HUD's lever bars and engine read-outs, the hints that only this type needs). The closures are
// written INLINE against the controls and the state.
//
// What differs from the C172S: two engines, each with its throttle, propeller and mixture lever (the keys act on
// the engine selected with 8 / 9 / 0), constant-speed feathering propellers, four magneto toggles and one starter
// rocker, two alternators and two electric fuel pumps, a fuel selector per engine with ON / CROSSFEED / OFF, alternate
// air instead of carburettor heat (fuel injection), cowl flaps, retractable gear with an emergency extension, rudder
// trim, hand flaps on the floor, no avionics master (the radios have their own switches; the avionics key stands for
// them). "s.N" is section N of the type's engineering data sheet (aircraft-data/pa34.md in the design work folder).

import { RAD } from '../../core/math';
import { engineControl, PROP_FEATHER_GATE, type AircraftState, type ControlInputs, type EngineControlKey, type FuelSelector, type MagnetoPosition } from '../../core/types';
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

const SIDES = ['L', 'R'] as const;
const SIDE_NAMES = ['Left', 'Right'] as const;
const MAGNETO_NAMES: Record<MagnetoPosition, string> = { 0: 'OFF', 1: 'R', 2: 'L', 3: 'BOTH' };
const FUEL_NAMES: Record<FuelSelector, string> = { off: 'OFF', left: 'LEFT', right: 'RIGHT', both: 'BOTH', on: 'ON', crossfeed: 'CROSSFEED' };

/**
 * Engine start (s.10, cold start, each engine in turn), each step a check or a target state. With both engines
 * selected the starter key cranks the left engine first and the right one once the left is running.
 */
const STARTUP_STEPS: readonly [string, string][] = [
  ['Fuel selectors', 'check both ON (Shift+J cycles ON, CROSSFEED, OFF on the selected engine)'],
  ['Cowl flaps', 'check OPEN (\\ opens, Shift+\\ closes)'],
  ['Master and alternators', 'W: ON'],
  ['Mixtures', 'hold Shift+M until FULL RICH'],
  ['Propellers', 'hold Shift+; until full forward'],
  ['Throttles', 'open half an inch: F3 (or Page Up) briefly (~10%)'],
  ['Electric fuel pumps', 'J: ON to prime until fuel flow shows (3-5 s), then J: OFF; a warm engine needs no prime'],
  ['Parking brake', 'check SET (PARKING BRAKE shown); only if it is not, Shift+B sets it'],
  ['Start', 'hold S: the left engine starts, then the right (8 / 9 picks one); about 1,000 rpm. Flooded (no start in 10 s): mixture IDLE CUT-OFF, throttle full, crank; as it fires, throttle back and mixture rich'],
  ['After start', 'oil pressure rising on both · J pumps OFF, fuel pressure green · I radios on · release the parking brake (Shift+B) to taxi'],
];

const onOff = (b: boolean): string => (b ? 'ON' : 'OFF');
const percent = (v: number): string => `${Math.round(v * 100)}%`;
/** Cowl flaps: three positions (s.4). */
const cowlFlaps = (v: number): string => (v > 0.75 ? 'OPEN' : v > 0.25 ? 'INTERMEDIATE' : 'CLOSED');

function mixtureLabel(m: number): string {
  if (m < MIXTURE_CUTOFF) return 'mixture IDLE CUT-OFF';
  if (m >= FULL_RICH) return 'mixture FULL RICH';
  return `mixture ${Math.round(m * 100)}%`;
}

/** One toast entry per engine for a per-engine control. */
function perEngine(id: EngineControlKey, label: string, read: (c: ControlInputs, engine: number) => string): UiProfile['switches'] {
  return SIDES.map((side, i) => ({ id: `${id}${side}`, label: `${SIDE_NAMES[i]} ${label}`, read: (c: ControlInputs) => read(c, i) }));
}

/** One HUD lever bar per engine for a per-engine lever. */
function leverPair(label: string, key: 'throttle' | 'propeller' | 'mixture', style?: 'mixture'): UiProfile['hud']['levers'] {
  return SIDES.map((side, i) => ({
    label: `${label} ${side}`,
    read: (c: ControlInputs) => engineControl(c, i, key),
    text: (c: ControlInputs) => (key === 'propeller' && engineControl(c, i, key) < PROP_FEATHER_GATE ? 'FEATH' : percent(engineControl(c, i, key))),
    ...(style ? { style } : {}),
  }));
}

export const PA34_UI: UiProfile = {
  controlName: 'yoke',
  startupSteps: STARTUP_STEPS,
  // Checked in the order a pilot would find it: no power to the starter, no fuel, mixture at cut-off or too lean,
  // magnetos off.
  starterAdvice(c, engine) {
    const side = SIDE_NAMES[engine] ?? SIDE_NAMES[0];
    if (!c.masterBattery) return 'Starter: the master switch is OFF. Press W first.';
    if (engineControl(c, engine, 'fuelSelector') === 'off') return `Starter: the ${side.toLowerCase()} fuel selector is OFF. Select the engine (8 / 9) and Shift+J to ON.`;
    const mixture = engineControl(c, engine, 'mixture');
    if (mixture < MIXTURE_CUTOFF) return `${side} mixture at IDLE CUT-OFF: hold Shift+M for full rich, then crank (S).`;
    if (mixture < START_MIXTURE_MIN) return `${side} ${mixtureLabel(mixture)}: too lean to start. Hold Shift+M for full rich.`;
    if (engineControl(c, engine, 'magnetos') === 0) return `${side} magnetos OFF: select the engine (8 / 9) and press 4 for both on.`;
    return null;
  },
  // In the order they are announced.
  switches: [
    { id: 'masterBattery', label: 'Master', read: (c) => onOff(c.masterBattery) },
    ...perEngine('alternator', 'alternator', (c, i) => onOff(engineControl(c, i, 'alternator'))),
    { id: 'avionics', label: 'Radios', read: (c) => onOff(c.avionics) },
    ...perEngine('magnetos', 'magnetos', (c, i) => MAGNETO_NAMES[engineControl(c, i, 'magnetos')]),
    ...perEngine('fuelSelector', 'fuel selector', (c, i) => FUEL_NAMES[engineControl(c, i, 'fuelSelector')]),
    ...perEngine('fuelPump', 'electric fuel pump', (c, i) => onOff(engineControl(c, i, 'fuelPump'))),
    ...perEngine('alternateAir', 'alternate air', (c, i) => onOff(engineControl(c, i, 'alternateAir'))),
    ...perEngine('cowlFlaps', 'cowl flap', (c, i) => cowlFlaps(engineControl(c, i, 'cowlFlaps'))),
    { id: 'pitotHeat', label: 'Pitot heat', read: (c) => onOff(c.pitotHeat) },
    { id: 'nav', label: 'Nav lights', read: (c) => onOff(c.lights.nav) },
    { id: 'beacon', label: 'Beacon', read: (c) => onOff(c.lights.beacon) },
    { id: 'strobe', label: 'Strobes', read: (c) => onOff(c.lights.strobe) },
    { id: 'landing', label: 'Landing light', read: (c) => onOff(c.lights.landing) },
    { id: 'taxi', label: 'Taxi light', read: (c) => onOff(c.lights.taxi) },
  ],
  hud: {
    levers: [
      ...leverPair('THR', 'throttle'),
      ...leverPair('PROP', 'propeller'),
      ...leverPair('MIX', 'mixture', 'mixture'),
      // The bar is the lever, the number the flap angle reached.
      { label: 'FLAPS', read: (c) => c.flaps, text: (_c, s) => `${Math.round(s.surfaces.flaps * RAD)}°` },
      // The trim wheels' positions along their travel (centre = neutral) and their sense.
      {
        label: 'TRIM',
        read: (c) => 0.5 + c.elevatorTrim * 0.5,
        text: (c) => {
          const pct = Math.round(Math.abs(c.elevatorTrim) * 100);
          return pct === 0 ? '0%' : `${pct}% ${c.elevatorTrim > 0 ? 'UP' : 'DN'}`;
        },
        style: 'marker',
      },
      {
        label: 'R TRIM',
        read: (c) => 0.5 + c.rudderTrim * 0.5,
        text: (c) => {
          const pct = Math.round(Math.abs(c.rudderTrim) * 100);
          return pct === 0 ? '0%' : `${pct}% ${c.rudderTrim > 0 ? 'R' : 'L'}`;
        },
        style: 'marker',
      },
    ],
    // Manifold pressure and rpm of each engine, as the twin-needle gauges show them (s.11 sets power by both).
    readouts: SIDES.flatMap((side, i) => [
      { label: `MP ${side}`, text: (s: AircraftState) => (s.engines[i] ? s.engines[i].manifoldPressure.toFixed(1) : '--') },
      { label: `RPM ${side}`, text: (s: AircraftState) => (s.engines[i] ? `${Math.round(s.engines[i].rpm / 10) * 10}` : '--') },
    ]),
  },
  hints: [
    ['Engines', '8 left · 9 right · 0 both: the engine keys act on the selected engine(s)'],
    ['Propellers', '; lower rpm · Shift+; higher rpm · Shift+F feathers the selected engine (above 800 rpm)'],
    ['Landing gear', 'F7 down · Shift+F7 up (below 109 KIAS) · F10 emergency extension (below 87 KIAS)'],
    ['Cowl flaps', '\\ open · Shift+\\ close (open for ground running and the climb)'],
    ['Rudder trim', '6 left · 7 right'],
    ['Fuel selectors', 'Shift+J: ON, CROSSFEED, OFF on the selected engine (crossfeed in level flight only)'],
    ['Alternate air', '/ : ON for induction icing, OFF for take-off'],
    ['Electric fuel pumps', 'J: ON for take-off, landing and priming'],
  ],
};
