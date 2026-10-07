// Diamond DA20-C1: what the UI says about this type (start-up card, starter advice, the switches announced by
// toast, the HUD's lever bars and engine read-out, the hints that only this type needs). The closures are written
// INLINE against the controls and the state.
//
// What differs from the C172S: a stick; a fuel-injected engine with an electric fuel pump that primes it and stays
// on for take-off and landing, and an alternate-air lever (key /) instead of carburettor heat; one fuselage tank
// behind a fuel shut-off valve (OPEN / CLOSED), no tank selector; a split GEN / BAT master; three flap positions
// CRUISE, T/O and LDG; a free-castering nose wheel, steered on the ground with the toe brakes. "s.N" is section N
// of the type's engineering data sheet (aircraft-data/da20.md in the design work folder).

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
/** The flap positions and the angle each stands for (AFM 7.3.3, s.9). */
const FLAP_NAMES: readonly (readonly [number, string])[] = [
  [0, 'CRUISE'],
  [15, 'T/O'],
  [45, 'LDG'],
];

const MAGNETO_NAMES: Record<MagnetoPosition, string> = { 0: 'OFF', 1: 'R', 2: 'L', 3: 'BOTH' };
/** The fuel shut-off valve reads OPEN / CLOSED (AFM 7.10); the other positions do not exist on the type. */
const FUEL_NAMES: Record<FuelSelector, string> = { off: 'CLOSED', left: 'LEFT', right: 'RIGHT', both: 'BOTH', on: 'OPEN', crossfeed: 'CROSSFEED' };

/**
 * Engine start, cold (AFM 4.4.3, s.10), each step a check or a target state. The FUEL PRIME switch is not
 * modelled: the electric pump primes the injected engine.
 */
const STARTUP_STEPS: readonly [string, string][] = [
  ['Fuel shut-off valve', 'check OPEN (Shift+J if it is not)'],
  ['Mixture', 'hold Shift+M until FULL RICH'],
  ['Throttle', 'IDLE, then open a quarter inch: F3 (or Page Up) briefly'],
  ['GEN / BAT master', 'W (GEN light on until the engine runs)'],
  ['Parking brake', 'check SET (PARKING BRAKE shown); only if it is not, Shift+B sets it'],
  ['Fuel pump', 'J: ON (it primes, and stays on for take-off)'],
  ['Start', 'hold S until the engine fires (10 seconds at most), then let go; 1,000 rpm'],
  ['After start', 'oil pressure above 10 psi within 30 s · I avionics master on · lights as needed · release the parking brake (Shift+B) to taxi'],
];

const onOff = (b: boolean): string => (b ? 'ON' : 'OFF');
const percent = (v: number): string => `${Math.round(v * 100)}%`;

function mixtureLabel(m: number): string {
  if (m < MIXTURE_CUTOFF) return 'Mixture IDLE CUT-OFF';
  if (m >= FULL_RICH) return 'Mixture FULL RICH';
  return `Mixture ${Math.round(m * 100)}%`;
}

/** The flap position reached, or the two it is between. */
function flapPosition(deg: number): string {
  for (const [d, name] of FLAP_NAMES) if (Math.abs(deg - d) < 1) return name;
  return `${Math.round(deg)}°`;
}

export const DA20_UI: UiProfile = {
  controlName: 'stick',
  startupSteps: STARTUP_STEPS,
  // Checked in the order a pilot would find it: no power to the starter, no fuel, mixture at cut-off or too lean.
  starterAdvice(c, engine) {
    if (!c.masterBattery) return 'Starter: the GEN / BAT master is OFF. Press W first.';
    if (engineControl(c, engine, 'fuelSelector') === 'off') return 'Starter: the fuel shut-off valve is CLOSED (Shift+J).';
    const mixture = engineControl(c, engine, 'mixture');
    if (mixture < MIXTURE_CUTOFF) return 'Mixture at IDLE CUT-OFF: hold Shift+M for full rich, then crank (S).';
    if (mixture < START_MIXTURE_MIN) return `${mixtureLabel(mixture)}: too lean to start. Hold Shift+M for full rich.`;
    return null;
  },
  // In the order they are announced. The two halves of the master switch ('masterBattery', 'alternator') are
  // announced as one "Master switch ON / OFF" when they end up alike.
  switches: [
    { id: 'masterBattery', label: 'Battery', read: (c) => onOff(c.masterBattery) },
    { id: 'alternator', label: 'Generator', read: (c) => onOff(c.alternator) },
    { id: 'avionics', label: 'Avionics master', read: (c) => onOff(c.avionics) },
    { id: 'magnetos', label: 'Magnetos', read: (c) => MAGNETO_NAMES[c.magnetos] },
    { id: 'fuelPump', label: 'Fuel pump', read: (c) => onOff(c.fuelPump) },
    { id: 'fuelSelector', label: 'Fuel shut-off valve', read: (c) => FUEL_NAMES[c.fuelSelector] },
    { id: 'alternateAir', label: 'Alternate air', read: (c) => onOff(c.alternateAir) },
    { id: 'nav', label: 'Position lights', read: (c) => onOff(c.lights.nav) },
    { id: 'strobe', label: 'Strobes', read: (c) => onOff(c.lights.strobe) },
    { id: 'landing', label: 'Landing light', read: (c) => onOff(c.lights.landing) },
    { id: 'taxi', label: 'Taxi light', read: (c) => onOff(c.lights.taxi) },
  ],
  hud: {
    levers: [
      { label: 'THR', read: (c) => c.throttle, text: (c) => percent(c.throttle) },
      { label: 'MIX', read: (c) => c.mixture, text: (c) => percent(c.mixture), style: 'mixture' },
      // The bar is the switch's selection, the text the position the flaps have reached.
      { label: 'FLAPS', read: (c) => c.flaps, text: (_c, s) => flapPosition(s.surfaces.flaps * RAD) },
      // The spring-bias trim's position along its travel (centre = NEUTRAL, the take-off setting) and its sense.
      {
        label: 'TRIM',
        read: (c) => 0.5 + c.elevatorTrim * 0.5,
        text: (c) => {
          const pct = Math.round(Math.abs(c.elevatorTrim) * 100);
          return pct === 0 ? 'NEUTRAL' : `${pct}% ${c.elevatorTrim > 0 ? 'UP' : 'DN'}`;
        },
        style: 'marker',
      },
    ],
    // The tachometer is the only engine power instrument of the type (no manifold pressure gauge, s.4).
    readouts: [{ label: 'RPM', text: (s) => `${Math.round(s.engine.rpm / 10) * 10}` }],
  },
  hints: [
    ['Taxi turns', 'rudder keys, or , and . for the toe brakes'],
    ['Nose wheel', 'free castering: it does not follow the pedals; brake on the inside of the turn, a trickle of power'],
    ['Fuel pump', 'J: ON for start, take-off, landing and below 1,400 rpm; OFF in cruise'],
    ['Alternate air', '/ : the unfiltered second inlet, if the air filter is blocked'],
    ['Flaps', 'F6 / F5: CRUISE, T/O, LDG'],
  ],
};
