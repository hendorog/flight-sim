// Richard Pearse 1903 Monoplane: UI profile (startup card, starter advice, switch toasts, HUD readouts & hints).

import { RAD } from '../../core/math';
import { engineControl, type FuelSelector, type MagnetoPosition } from '../../core/types';
import type { UiProfile } from '../types';

const MIXTURE_CUTOFF = 0.02;
const FULL_RICH = 0.985;
const START_MIXTURE_MIN = 0.5;

const MAGNETO_NAMES: Record<MagnetoPosition, string> = { 0: 'OFF', 1: 'AFT COIL', 2: 'FWD COIL', 3: 'BOTH COILS' };
const FUEL_NAMES: Record<FuelSelector, string> = { off: 'OFF', left: 'ON', right: 'ON', both: 'ON', on: 'ON', crossfeed: 'ON' };

const STARTUP_STEPS: readonly [string, string][] = [
  ['Overhead petrol tap', 'check ON (Shift+J if shut)'],
  ['Mixture lever', 'hold Shift+M until FULL RICH'],
  ['Throttle lever', 'crack open slightly: F3 (or Page Up) ~10%'],
  ['Airscrew area', 'CLEAR ahead of the front bamboo frame'],
  ['Ignition accumulator', 'W (accumulator and dynamo ON)'],
  ['Wheel brake latch', 'check SET; Shift+B toggles it'],
  ['Swing / start', 'hold S until the twin fires (~450 rpm idle)'],
  ['Before roll', 'I comms coil ON · Shift+B release brake · steer nosewheel with rudder bar'],
];

const onOff = (b: boolean): string => (b ? 'ON' : 'OFF');
const percent = (v: number): string => `${Math.round(v * 100)}%`;

export const PEARSE_UI: UiProfile = {
  controlName: 'stick',
  startupSteps: STARTUP_STEPS,
  starterAdvice(c, engine) {
    if (!c.masterBattery) return 'Ignition accumulator is OFF: press W first.';
    if (engineControl(c, engine, 'fuelSelector') === 'off') return 'Overhead petrol tap is OFF (Shift+J).';
    const mixture = engineControl(c, engine, 'mixture');
    if (mixture < MIXTURE_CUTOFF) return 'Mixture closed: hold Shift+M for full rich, then crank (S).';
    if (mixture < START_MIXTURE_MIN) return 'Mixture too lean to light: hold Shift+M for full rich.';
    return null;
  },
  switches: [
    { id: 'masterBattery', label: 'Ignition accumulator', read: (c) => onOff(c.masterBattery) },
    { id: 'alternator', label: 'Charging dynamo', read: (c) => onOff(c.alternator) },
    { id: 'avionics', label: 'Trembler coil & comms', read: (c) => onOff(c.avionics) },
    { id: 'magnetos', label: 'Spark coils', read: (c) => MAGNETO_NAMES[c.magnetos] },
    { id: 'fuelSelector', label: 'Overhead petrol tap', read: (c) => FUEL_NAMES[c.fuelSelector] },
    { id: 'nav', label: 'Marker lamps', read: (c) => onOff(c.lights.nav) },
    { id: 'landing', label: 'Forward lamp', read: (c) => onOff(c.lights.landing) },
  ],
  hud: {
    levers: [
      { label: 'THR', read: (c) => c.throttle, text: (c) => percent(c.throttle) },
      { label: 'MIX', read: (c) => c.mixture, text: (c) => percent(c.mixture), style: 'mixture' },
      { label: 'CAMB', read: (c) => c.flaps, text: (_c, s) => `${Math.round(s.surfaces.flaps * RAD)}°` },
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
    readouts: [{ label: 'RPM', text: (s) => `${Math.round(s.engine.rpm / 5) * 5}` }],
  },
  hints: [
    ['Pioneer speeds', 'Rotates ~31 kt, climbs at 39 kt, cruises ~46 kt; never exceed 65 kt (bamboo & wire frame)'],
    ['Wing camber flaps', 'F / V: 0°, 8°, 16° trailing-edge camber'],
    ['Tricycle road gear', 'Foot rudder bar steers the front spoked wheel directly — watch gorse hedges on Waitohi runs!'],
  ],
};
