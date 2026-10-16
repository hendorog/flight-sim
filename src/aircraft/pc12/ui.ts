// Pilatus PC-12/47: what the UI says about this type (start-up card, starter advice, the switches announced by toast,
// the HUD's lever bars and engine read-outs, the hints that only this type needs). The closures are written INLINE
// against the controls and the state.
//
// What differs from the C208 (a PT6 too): the quadrant has a POWER CONTROL LEVER (the throttle keys) with beta and
// reverse AFT of the idle gate (the reverse control), a CONDITION lever (the mixture keys: CUT-OFF/FEATHER, GROUND
// IDLE, FLIGHT IDLE) and NO propeller lever (the propeller is governed at 1700 rpm; feathering is by the condition
// lever at CUT-OFF). One press of the STARTER latches it until 50 % Ng. There is no fuel selector: FUEL PUMPS only.
// Torque is read in psi (pc12TorquePsi), as on the PC-12's gauge.

import { engineControl, type ControlInputs } from '../../core/types';
import { CUTOFF_BELOW } from '../../physics/propulsion/turbineEngine';
import type { UiProfile } from '../types';
import { PC12_ITT_C, PC12_START, pc12TorquePsi } from './facts';

/** Condition lever: from CUT-OFF up to this it reads GND IDLE (the gate just above CUT-OFF), at or above FLIGHT_IDLE it reads FLT IDLE. */
export const PC12_CONDITION = { cutoffBelow: CUTOFF_BELOW, flightIdle: 0.95 } as const;
/** Power lever beyond this is not at IDLE (a start with power on is a hot start). */
const POWER_IDLE_MAX = 0.05;

/** Power lever travel aft of the gate, 0..1 (absent = 0). */
const reverseOf = (c: ControlInputs, engine = 0): number => engineControl(c, engine, 'reverse') ?? 0;
const onOff = (b: boolean): string => (b ? 'ON' : 'OFF');
const percent = (v: number): string => `${Math.round(v * 100)}%`;

/** The condition lever's position as its quadrant is lettered. */
export function pc12ConditionLabel(m: number): string {
  if (m < PC12_CONDITION.cutoffBelow) return 'CUT-OFF';
  if (m >= PC12_CONDITION.flightIdle) return 'FLT IDLE';
  if (m <= 0.5) return 'GND IDLE';
  return percent(m);
}

/** Power lever as lettered: IDLE on the gate, BETA then REV aft of it (REV once the blades are in the negative range), else percent. */
export function pc12PowerLabel(c: ControlInputs, bladePitchRad: number): string {
  const rev = reverseOf(c);
  if (rev > 0) return bladePitchRad < 0 ? 'REV' : 'BETA';
  return c.throttle <= POWER_IDLE_MAX ? 'IDLE' : percent(c.throttle);
}

const STARTUP_STEPS: readonly [string, string][] = [
  ['Parking brake', 'check SET (PARKING BRAKE shown); only if it is not, Shift+B sets it'],
  ['Power lever (PCL)', 'IDLE: F1'],
  ['Condition lever', 'CUT-OFF / FEATHER: hold M until COND shows CUT-OFF'],
  ['Battery', 'W: ON (battery and generators); voltage 24 V or more'],
  ['Fuel pumps and beacon', 'J: FUEL PUMPS ON · Shift+O: beacon ON'],
  ['Ignition', '1: AUTO (the igniters spark while the starter runs; 4 is ON, continuous)'],
  ['Starter', 'S: ONE press: STARTER lights, Ng climbs (the start latches; Shift+N or the STARTER INTR button is the STARTER INTERRUPT; pressing S again also cuts it)'],
  ['At 13 % Ng or more', 'Shift+M briefly until COND shows GND IDLE: fuel on. Watch the ITT: 1000 °C for 5 s at most; if it races up, M to CUT-OFF at once'],
  ['At about 50 % Ng', 'the starter cuts out by itself; Ng settles at 50.7-61.4 %, ITT falls back, GEN 1 OFF goes out'],
  ['After start', 'oil pressure green · I avionics ON · release the parking brake (Shift+B) to taxi; use beta (PCL aft of the gate) to control the taxi speed'],
];

export const PC12_UI: UiProfile = {
  controlName: 'yoke',
  startupSteps: STARTUP_STEPS,
  // Checked in the order a pilot would find it while cranking: no power to the starter, igniters, power lever not at idle,
  // no pumps; then, a start in progress, when to bring the fuel in.
  starterAdvice(c, engine) {
    if (!c.masterBattery) return 'Starter: the battery switch is OFF. Press W first.';
    if (engineControl(c, engine, 'throttle') > POWER_IDLE_MAX || reverseOf(c, engine) > 0) return 'Power lever (PCL) is not at IDLE: F1 first. A start with the power lever forward overheats the turbine.';
    if (!engineControl(c, engine, 'fuelPump')) return 'FUEL PUMPS are OFF: press J; the start is made with the pumps on (FUEL PRESS out).';
    if (engineControl(c, engine, 'mixture') < CUTOFF_BELOW) {
      return `Press STARTER once; condition lever to GROUND IDLE at ${Math.round(PC12_START.conditionAtNg * 100)} % Ng (Shift+M briefly); the starter cuts out at ${Math.round(PC12_START.starterCutoutNg * 100)} % Ng. ITT ${PC12_ITT_C.start} °C for 5 s at most.`;
    }
    return null;
  },
  switches: [
    { id: 'masterBattery', label: 'Battery', read: (c) => onOff(c.masterBattery) },
    { id: 'alternator', label: 'Generators', read: (c) => onOff(c.alternator) },
    { id: 'avionics', label: 'Avionics', read: (c) => onOff(c.avionics) },
    { id: 'magnetos', label: 'Ignition', read: (c) => (c.magnetos === 0 ? 'AUTO' : 'ON') },
    { id: 'fuelPump', label: 'Fuel pumps', read: (c) => onOff(c.fuelPump) },
    { id: 'pitotHeat', label: 'Pitot heat', read: (c) => onOff(c.pitotHeat) },
    { id: 'nav', label: 'Nav lights', read: (c) => onOff(c.lights.nav) },
    { id: 'beacon', label: 'Beacon', read: (c) => onOff(c.lights.beacon) },
    { id: 'strobe', label: 'Strobes', read: (c) => onOff(c.lights.strobe) },
    { id: 'landing', label: 'Landing lights', read: (c) => onOff(c.lights.landing) },
    { id: 'taxi', label: 'Taxi lights', read: (c) => onOff(c.lights.taxi) },
  ],
  hud: {
    levers: [
      // Forward of the gate the bar is the lever; aft of it (beta, reverse) the bar fills with the reverse travel.
      { label: 'PWR', read: (c) => (reverseOf(c) > 0 ? reverseOf(c) : c.throttle), text: (c, s) => pc12PowerLabel(c, s.propellers[0]?.bladePitch ?? 0) },
      { label: 'COND', read: (c) => c.mixture, text: (c) => pc12ConditionLabel(c.mixture), style: 'mixture' },
      { label: 'FLAPS', read: (c) => c.flaps, text: (_c, s) => `${Math.round((s.surfaces.flaps * 180) / Math.PI)}°` },
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
    // Power is set by torque (psi) against the ITT and Ng limits; Np is the governed propeller speed.
    readouts: [
      { label: 'TRQ', text: (s) => pc12TorquePsi(s.engine.torque).toFixed(1) },
      { label: 'ITT', text: (s) => `${Math.round(s.engine.itt ?? s.engine.egt)}` },
      { label: 'Ng', text: (s) => (s.engine.ng ?? 0).toFixed(1) },
      { label: 'Np', text: (s) => `${Math.round(s.engine.propRpm / 10) * 10}` },
    ],
  },
  hints: [
    ['Power lever (PCL)', 'F1 idle · F2 / F3 (Page Down / Up) less / more · F4 full; aft of the idle gate: BETA then REV (reverse keys, see Controls); set torque in psi'],
    ['Condition lever', 'M / Shift+M: CUT-OFF / FEATHER (shuts the engine down and feathers the propeller), GROUND IDLE, FLIGHT IDLE'],
    ['Propeller', 'No propeller lever: the propeller is governed at 1700 rpm; stabilised ground running between 350 and 950 rpm is prohibited'],
    ['Starter and ignition', 'S: STARTER (one press latches it to 50 % Ng) · 1 IGNITION AUTO, 4 ON (continuous)'],
    ['Fuel pumps', 'J FUEL PUMPS (no fuel selector)'],
    ['Generators', 'Shift+W: GEN 1 / GEN 2 ON / OFF (on line from about 50 % Ng)'],
    ['Stick pusher', 'The stick shaker then the pusher protect the stall; PUSHER INTR on the panel (or its key) interrupts it'],
  ],
};
