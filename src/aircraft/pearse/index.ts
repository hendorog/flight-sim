// Richard Pearse 1903 Waitohi Monoplane: node-safe aircraft definition.

import type { AircraftDefinition } from '../types';
import { createPearseAeroDefinition } from './aero';
import { createPearseGear } from './gear';
import { PEARSE_GEOMETRY } from './geometry';
import { PEARSE_INPUT } from './input';
import { PEARSE_POWERPLANT } from './powerplant';
import { PEARSE_REFERENCE } from './reference';
import { PEARSE_SIM } from './sim';
import { PEARSE_AIR_DATA, PEARSE_AUTOPILOT, PEARSE_CONTROLS, PEARSE_LIMITS, PEARSE_MASS } from './systems';

export const PEARSE_DEFINITION: AircraftDefinition = {
  id: 'pearse',
  name: 'Richard Pearse 1903 Monoplane',
  shortName: 'Pearse Monoplane',
  variant: 'Waitohi Flat bamboo & canvas monoplane (1903 / NZ Patent 21476, 24 hp double-acting twin)',
  icaoType: 'PRSE',
  engineCount: 1,
  controlDefaults: { fuelSelector: 'on' },
  notModelled: [
    'Dimensions and weights are historical engineering estimates after Ogilvie, Rodliffe, MOTAT surviving components and NZ Patent No. 21476 (1906); no contemporary drawings survive.',
    'The ground/hand-settable variable-pitch airscrew collar is represented as a fixed 68 in geometric pitch matched to the 1150 rpm engine.',
    'Pearse’s original Waitohi machine carried no cockpit dials or electric lamps; a compact pioneer brass instrument board and 12 V accumulator circuit are fitted for simulator compatibility.',
    'Flexible bamboo-and-wire aeroelastic twist and single-surface fabric billowing at negative angle of attack.',
  ],
  geometry: PEARSE_GEOMETRY,
  mass: PEARSE_MASS,
  limits: PEARSE_LIMITS,
  controls: PEARSE_CONTROLS,
  airData: PEARSE_AIR_DATA,
  autopilot: PEARSE_AUTOPILOT,
  reference: PEARSE_REFERENCE,
  powerplant: PEARSE_POWERPLANT,
  aero: createPearseAeroDefinition,
  gear: createPearseGear,
  sim: PEARSE_SIM,
  input: PEARSE_INPUT,
};

export default PEARSE_DEFINITION;
