// Diamond DA20-C1: the aircraft definition (flight model, systems, sim profile and input profile). Node-safe: this
// file and what it assembles never touch the DOM, the 3D model, the panel or the sound (those are presentation.ts).
//
// It only ASSEMBLES the files of this directory; every number lives in one of them. Their source is the type's
// engineering data sheet (aircraft-data/da20.md in the design work folder).

import type { AircraftDefinition } from '../types';
import { createDA20AeroDefinition } from './aero';
import { createDA20Gear } from './gear';
import { DA20_GEOMETRY } from './geometry';
import { DA20_INPUT } from './input';
import { DA20_POWERPLANT } from './powerplant';
import { DA20_REFERENCE } from './reference';
import { DA20_SIM } from './sim';
import { DA20_AIR_DATA, DA20_AUTOPILOT, DA20_CONTROLS, DA20_LIMITS, DA20_MASS } from './systems';

export const DA20_DEFINITION: AircraftDefinition = {
  id: 'da20',
  name: 'Diamond DA20-C1',
  shortName: 'Diamond DA20',
  variant: 'DA20-C1 (Continental IO-240-B 125 hp, 800 kg)',
  icaoType: 'DV20',
  engineCount: 1,
  // One fuel shut-off valve, OPEN / CLOSED, instead of a tank selector.
  controlDefaults: { fuelSelector: 'on' },
  notModelled: [
    'The two-speed electric pump\'s high speed (FUEL PRIME) and priming: a cold engine starts without priming; no flooded or hot starts.',
    'The altitude-compensating fuel pump of some aircraft and its idle instability: the standard pump.',
    'The canopy: the cabin is closed, an unlatched or open canopy has no effect on the flight.',
    'The trim indicator shows the trim switch\'s command; the spring datum follows it at 2 deg/s, and only with bus power.',
    'Spins: the stall is modelled, a developed spin and its recovery are not.',
    'The structural temperature limit (55 C on a hot ramp) and the optional MT propeller and G500 TXi panel.',
  ],
  geometry: DA20_GEOMETRY,
  mass: DA20_MASS,
  limits: DA20_LIMITS,
  controls: DA20_CONTROLS,
  airData: DA20_AIR_DATA,
  autopilot: DA20_AUTOPILOT,
  reference: DA20_REFERENCE,
  powerplant: DA20_POWERPLANT,
  aero: createDA20AeroDefinition,
  gear: createDA20Gear,
  sim: DA20_SIM,
  input: DA20_INPUT,
};

export default DA20_DEFINITION;
