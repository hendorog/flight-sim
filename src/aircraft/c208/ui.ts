// Cessna 208 Caravan 675: what the UI says about this type (start-up card, starter advice, the switches announced
// by toast, the HUD's lever bars and engine read-outs, the hints that only this type needs). The closures are
// written INLINE against the controls and the state.
//
// What differs from the piston singles: a PT6A-114A free turbine. The keys keep their names (no new control keys):
// the POWER lever is the throttle (F1-F4, Page Up / Down), the PROPELLER lever the propeller keys (; and Shift+;,
// Shift+F feathers), the CONDITION lever the mixture keys (M / Shift+M: CUT-OFF, LOW IDLE, HIGH IDLE), the
// STARTER switch is S (held), the IGNITION switch the magneto keys (1 = OFF, 4 = NORM), FUEL BOOST is J, the
// two tank selectors Shift+J, the generator Shift+W. The start is the PT6 start of POH sect. 4: starter on with
// the condition lever at CUT-OFF, fuel at 13 % Ng, watch the ITT (1090 C for 2 s at most), starter off at 50 %.

import { RAD } from '../../core/math';
import { engineControl, PROP_FEATHER_GATE, type ControlInputs, type FuelSelector } from '../../core/types';
import { CUTOFF_BELOW } from '../../physics/propulsion/turbineEngine';
import type { UiProfile } from '../types';
import { PT6A_114A } from './powerplant';

/** Condition lever: from CUT-OFF up to this it reads LOW IDLE (the gate just above CUT-OFF). */
const LOW_IDLE_TOP = CUTOFF_BELOW + 0.1;
/** Condition lever: at or above this it reads HIGH IDLE. */
const HIGH_IDLE = 0.97;
/** Power lever beyond this is not at IDLE (a start with power on is a hot start). */
const POWER_IDLE_MAX = 0.05;
/** Propeller-shaft torque from the power turbine's (EngineState.torque), ft lbf per N m of the power turbine. */
const TORQUE_FT_LB_PER_NM = PT6A_114A.gearRatio / 1.3558179;

const FUEL_NAMES: Record<FuelSelector, string> = { off: 'BOTH OFF', left: 'LEFT ON, RIGHT OFF', right: 'RIGHT ON, LEFT OFF', both: 'BOTH ON', on: 'BOTH ON', crossfeed: 'CROSSFEED' };

/**
 * Engine start (POH sect. 4, battery start), each step a check or a target state. The propeller is parked
 * feathered and comes out of feather by itself as oil pressure builds.
 */
const STARTUP_STEPS: readonly [string, string][] = [
  ['Fuel tank selectors', 'check both ON (Shift+J cycles them)'],
  ['Power lever', 'IDLE: F1'],
  ['Propeller lever', 'full forward: hold Shift+; (the blades unfeather as the oil pressure builds)'],
  ['Condition lever', 'CUT-OFF: hold M until COND shows CUT-OFF'],
  ['Battery', 'W: ON (battery and generator); voltage 24 V or more'],
  ['Fuel boost and beacon', 'J: FUEL BOOST ON, FUEL PRESS LOW goes out · Shift+O: beacon ON'],
  ['Ignition', '1: NORM (the igniters spark while the starter runs; 4 is ON, continuous)'],
  ['Parking brake', 'check SET (PARKING BRAKE shown); only if it is not, Shift+B sets it'],
  ['Starter', 'hold S: STARTER ENERGIZED and IGNITION ON light, oil pressure rises, Ng climbs'],
  ['At 13 % Ng or more', 'Shift+M briefly until COND shows LO IDLE: fuel on. Light-off: watch the ITT, 1090 °C for 2 s at most; if it races up, M to CUT-OFF at once'],
  ['At about 50 % Ng', 'let go of S: starter OFF. Ng settles at 52 % or more, ITT falls back, GENERATOR OFF goes out'],
  ['After start', 'oil pressure green · I avionics ON · lights as needed · release the parking brake (Shift+B) to taxi'],
];

const onOff = (b: boolean): string => (b ? 'ON' : 'OFF');
const percent = (v: number): string => `${Math.round(v * 100)}%`;

/** The condition lever's position as its quadrant is lettered. */
function conditionLabel(m: number): string {
  if (m < CUTOFF_BELOW) return 'CUT-OFF';
  if (m <= LOW_IDLE_TOP) return 'LO IDLE';
  if (m >= HIGH_IDLE) return 'HI IDLE';
  return percent(m);
}

const propLabel = (c: ControlInputs): string => (c.propeller < PROP_FEATHER_GATE ? 'FEATH' : c.propeller >= 0.985 ? 'MAX' : percent(c.propeller));

export const C208_UI: UiProfile = {
  controlName: 'yoke',
  startupSteps: STARTUP_STEPS,
  // Checked in the order a pilot would find it while cranking: no power to the starter, no fuel, igniters off,
  // power lever not at idle, no boost pump; then, a start in progress, when to bring the fuel in.
  starterAdvice(c, engine) {
    if (!c.masterBattery) return 'Starter: the battery switch is OFF. Press W first.';
    if (engineControl(c, engine, 'fuelSelector') === 'off') return 'Starter: both fuel tank selectors are OFF (FUEL SELECT OFF). Shift+J to turn them ON.';
    if (engineControl(c, engine, 'throttle') > POWER_IDLE_MAX) return 'Power lever is not at IDLE: F1 first. A start with the power lever forward overheats the turbine.';
    if (!engineControl(c, engine, 'fuelPump')) return 'FUEL BOOST is OFF: press J; the start is made on the boost pump (FUEL PRESS LOW out).';
    if (engineControl(c, engine, 'mixture') < CUTOFF_BELOW) return 'Condition lever at CUT-OFF: once Ng shows 13 % or more, Shift+M briefly until COND shows LO IDLE. Keep S held to about 50 % Ng.';
    return null;
  },
  // In the order they are announced. 'masterBattery' and 'alternator' (battery and generator) are announced as one
  // "Master switch ON / OFF" when they end up alike (the W key moves both).
  switches: [
    { id: 'masterBattery', label: 'Battery', read: (c) => onOff(c.masterBattery) },
    { id: 'alternator', label: 'Generator', read: (c) => onOff(c.alternator) },
    { id: 'avionics', label: 'Avionics', read: (c) => onOff(c.avionics) },
    { id: 'magnetos', label: 'Ignition', read: (c) => (c.magnetos === 0 ? 'NORM' : 'ON') },
    { id: 'fuelSelector', label: 'Fuel tank selectors', read: (c) => FUEL_NAMES[c.fuelSelector] },
    { id: 'fuelPump', label: 'Fuel boost', read: (c) => onOff(c.fuelPump) },
    { id: 'pitotHeat', label: 'Pitot heat', read: (c) => onOff(c.pitotHeat) },
    { id: 'nav', label: 'Nav lights', read: (c) => onOff(c.lights.nav) },
    { id: 'beacon', label: 'Beacon', read: (c) => onOff(c.lights.beacon) },
    { id: 'strobe', label: 'Strobes', read: (c) => onOff(c.lights.strobe) },
    { id: 'landing', label: 'Landing lights', read: (c) => onOff(c.lights.landing) },
    { id: 'taxi', label: 'Taxi lights', read: (c) => onOff(c.lights.taxi) },
  ],
  hud: {
    levers: [
      { label: 'PWR', read: (c) => c.throttle, text: (c) => (c.throttle <= POWER_IDLE_MAX ? 'IDLE' : percent(c.throttle)) },
      { label: 'PROP', read: (c) => c.propeller, text: propLabel },
      { label: 'COND', read: (c) => c.mixture, text: (c) => conditionLabel(c.mixture), style: 'mixture' },
      // The bar is the selector, the number the flap angle reached.
      { label: 'FLAPS', read: (c) => c.flaps, text: (_c, s) => `${Math.round(s.surfaces.flaps * RAD)}°` },
      // The trim wheel's position along its travel (centre = neutral) and its sense.
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
    // Power is set by torque against the ITT and Ng limits; Np is the governed propeller speed.
    readouts: [
      { label: 'TRQ', text: (s) => `${Math.round((s.engine.torque * TORQUE_FT_LB_PER_NM) / 10) * 10}` },
      { label: 'ITT', text: (s) => `${Math.round(s.engine.itt ?? s.engine.egt)}` },
      { label: 'Ng', text: (s) => (s.engine.ng ?? 0).toFixed(1) },
      { label: 'Np', text: (s) => `${Math.round(s.engine.propRpm / 10) * 10}` },
    ],
  },
  hints: [
    ['Power lever', 'F1 idle · F2 / F3 (Page Down / Up) less / more · F4 full; set torque, keep ITT and Ng in the green'],
    ['Propeller lever', '; lower rpm · Shift+; higher rpm (1600-1900) · Shift+F feathers'],
    ['Condition lever', 'M / Shift+M: CUT-OFF (shuts the engine down), LOW IDLE, HIGH IDLE'],
    ['Starter and ignition', 'S held: STARTER · 1 IGNITION NORM, 4 ON (continuous) · a dry motoring run: STARTER with the condition lever at CUT-OFF'],
    ['Fuel', 'J FUEL BOOST · Shift+J tank selectors (keep both ON)'],
    ['Generator', 'Shift+W: generator ON / OFF (on line from about 52 % Ng)'],
  ],
};
