// Piper PA-34-200 Seneca I: the aircraft definition (flight model, systems, sim profile and input profile).
// Node-safe: this file and what it assembles never touch the DOM, the 3D model, the panel or the sound (those are
// presentation.ts).
//
// It only ASSEMBLES the files of this directory; every number lives in one of them. Their source is the type's
// engineering data sheet (aircraft-data/pa34.md in the design work folder).

import type { AircraftDefinition } from '../types';
import { createPA34AeroDefinition } from './aero';
import { createPA34Gear } from './gear';
import { PA34_GEOMETRY } from './geometry';
import { PA34_INPUT } from './input';
import { PA34_POWERPLANT } from './powerplant';
import { PA34_REFERENCE } from './reference';
import { PA34_SIM } from './sim';
import { PA34_AIR_DATA, PA34_AUTOPILOT, PA34_CONTROLS, PA34_LIMITS, PA34_MASS, PA34_TAB_GEARING } from './systems';

export const PA34_DEFINITION: AircraftDefinition = {
  id: 'pa34',
  name: 'Piper PA-34-200 Seneca I',
  shortName: 'Piper Seneca',
  variant: 'PA-34-200 Seneca I (Lycoming IO-360-C1E6 2 x 200 hp, 4200 lb)',
  icaoType: 'PA34',
  engineCount: 2,
  // Per-engine ON / OFF / CROSSFEED selectors; cowl flaps open on the ground (s.10).
  controlDefaults: { fuelSelector: 'on', cowlFlaps: 1 },
  notModelled: [
    'The aileron-rudder spring interconnect: feet-off Dutch roll and the roll due to pedal differ a little from the aeroplane.',
    'The hand-operated alternate-air doors beyond a switch per engine.',
    'Landing above the 4000 lb maximum landing weight: the sim permits it (the handbook does not).',
    'The propeller dampers and the 2200-2400 rpm avoid band: nothing happens to an engine run there.',
    'The dome\'s nitrogen charge: a propeller always feathers, and never overspeeds from a lost charge.',
    'The gear-light dimming with the nav lights on, the nose-gear mirror and a hydraulic leak dropping the gear.',
    'The optional Janitrol heater, ice protection and AltiMatic autopilot.',
  ],
  geometry: PA34_GEOMETRY,
  mass: PA34_MASS,
  limits: PA34_LIMITS,
  controls: PA34_CONTROLS,
  airData: PA34_AIR_DATA,
  autopilot: PA34_AUTOPILOT,
  reference: PA34_REFERENCE,
  powerplant: PA34_POWERPLANT,
  aero: () => createPA34AeroDefinition(PA34_TAB_GEARING),
  gear: createPA34Gear,
  sim: PA34_SIM,
  input: PA34_INPUT,
};

export default PA34_DEFINITION;
