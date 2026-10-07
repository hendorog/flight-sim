// Cessna 152 (1978 model): the aircraft definition (flight model, systems, sim profile and input profile).
// Node-safe: this file and what it assembles never touch the DOM, the 3D model, the panel or the sound (those are
// presentation.ts).
//
// It only ASSEMBLES the files of this directory; every number lives in one of them. Their source is the type's
// engineering data sheet (aircraft-data/c152.md in the design work folder).

import type { AircraftDefinition } from '../types';
import { createC152AeroDefinition } from './aero';
import { createC152Gear } from './gear';
import { C152_GEOMETRY } from './geometry';
import { C152_INPUT } from './input';
import { C152_POWERPLANT } from './powerplant';
import { C152_REFERENCE } from './reference';
import { C152_SIM } from './sim';
import { C152_AIR_DATA, C152_AUTOPILOT, C152_CONTROLS, C152_LIMITS, C152_MASS } from './systems';

export const C152_DEFINITION: AircraftDefinition = {
  id: 'c152',
  name: 'Cessna 152',
  shortName: 'Cessna 152',
  variant: 'Cessna 152 (1978, Lycoming O-235-L2C 110 hp, 757.5 kg)',
  icaoType: 'C152',
  engineCount: 1,
  // One ON / OFF fuel shut-off valve instead of a LEFT / RIGHT / BOTH selector.
  controlDefaults: { fuelSelector: 'on' },
  notModelled: [
    'The hand primer and the missing accelerator pump: a cold engine starts without priming; no over-priming, no stumble on a fast throttle opening.',
    'The optional wheel fairings and long-range tanks: the trainer as most schools fly it (the POH cruise figures include fairings, about 2 kt).',
    'Fuel cross-feed between the tanks through the vent line on a slope: both tanks feed equally through the shut-off valve.',
    "The ailerons' rigged droop of 1 degree, and the ground-adjustable rudder tab as anything but a fixed rigging offset.",
    'The O-235-N2C of 1983 on (108 hp) and the 1979 ramp-weight increase: the 1978 model as its POH describes it.',
  ],
  geometry: C152_GEOMETRY,
  mass: C152_MASS,
  limits: C152_LIMITS,
  controls: C152_CONTROLS,
  airData: C152_AIR_DATA,
  autopilot: C152_AUTOPILOT,
  reference: C152_REFERENCE,
  powerplant: C152_POWERPLANT,
  aero: createC152AeroDefinition,
  gear: createC152Gear,
  sim: C152_SIM,
  input: C152_INPUT,
};

export default C152_DEFINITION;
