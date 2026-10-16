// Pilatus PC-12/47 (PT6A-67B, 4740 kg): the aircraft definition (flight model, systems, sim profile and input
// profile). Node-safe: this file and what it assembles never touch the DOM, the 3D model, the panel or the sound
// (those are presentation.ts).
//
// It only ASSEMBLES the files of this directory; every number lives in one of them (sources: docs/pc12-sources.md;
// the model and its calibration: docs/pc12-flight-model.md; what is missing: KNOWN_ISSUES.md).

import type { AircraftDefinition } from '../types';
import { createPC12AeroDefinition } from './aero';
import { createPC12Gear } from './gear';
import { PC12_GEOMETRY } from './geometry';
import { PC12_INPUT } from './input';
import { PC12_POWERPLANT } from './powerplant';
import { PC12_REFERENCE } from './reference';
import { PC12_SIM } from './sim';
import { PC12_AIR_DATA, PC12_AUTOPILOT, PC12_CONTROLS, PC12_LIMITS, PC12_MASS } from './systems';

export const PC12_DEFINITION: AircraftDefinition = {
  id: 'pc12',
  name: 'Pilatus PC-12/47',
  shortName: 'PC-12',
  variant: 'PC-12/47 (P&WC PT6A-67B 1200 shp, 4740 kg)',
  icaoType: 'PC12',
  engineCount: 1,
  // Both wings feeding; the condition lever starts at CUT-OFF/FEATHER only through the cold preset.
  controlDefaults: { fuelSelector: 'on' },
  notModelled: [
    'The MANUAL OVERRIDE (MOR) lever and its emergency fuel path: the lever is drawn fixed at OFF; the torque limiter, Nf and Ng governors always work.',
    'Pressurisation and the environmental system: the cabin altitude and differential gauges follow a display schedule of the pressure altitude, not a cabin model.',
    'Ice protection (boots, propeller, windshield, probes) and the inertial separator, with their power, ITT and drag penalties; the stick pusher\'s ice mode and safe mode.',
    'The aileron trim (the left aileron tab) and the elevator down-spring: the yoke trims roll, and the hands-off elevator is held where the yoke puts it.',
    'The fuel system\'s collector tanks, motive-flow jet pumps and automatic fuel balance: one tank a side feeds the engine.',
    'The legacy CAWS beyond the lights the panel drives (ice protection, inverter, bus tie, ECS and others are lamp-test only).',
    'The /47\'s own climb and cruise charts (not obtained): performance is fitted to the PC-12/47E book, which overstates the /47 above about 14 000 ft.',
    'The gear horn\'s "below 200 ft radio altitude with torque below 10 psi" rule (no radio altimeter) and the hydraulic system\'s pressures (the pump and the accumulator are timings).',
  ],
  geometry: PC12_GEOMETRY,
  mass: PC12_MASS,
  limits: PC12_LIMITS,
  controls: PC12_CONTROLS,
  airData: PC12_AIR_DATA,
  autopilot: PC12_AUTOPILOT,
  reference: PC12_REFERENCE,
  powerplant: PC12_POWERPLANT,
  aero: createPC12AeroDefinition,
  gear: createPC12Gear,
  sim: PC12_SIM,
  input: PC12_INPUT,
};

export default PC12_DEFINITION;
