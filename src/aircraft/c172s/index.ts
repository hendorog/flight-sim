// Cessna 172S: the aircraft definition (flight model, systems, sim profile and input profile). Node-safe: this
// file and what it assembles never touch the DOM, the 3D model, the panel or the sound (those are
// presentation.ts).
//
// It only ASSEMBLES the files of this directory; every number lives in one of them. It is the default of every
// component: the type the simulator flies unless another is chosen.

import type { AircraftDefinition } from '../types';
import { createC172AeroDefinition } from './aero';
import { C172_GEAR } from './gear';
import { C172S_GEOMETRY } from './geometry';
import { C172S_INPUT } from './input';
import { C172_POWERPLANT } from './powerplant';
import { C172S_REFERENCE } from './reference';
import { C172S_SIM } from './sim';
import { C172S_AIR_DATA, C172S_AUTOPILOT, C172S_CONTROLS, C172S_LIMITS, C172S_MASS } from './systems';

export const C172S_DEFINITION: AircraftDefinition = {
  id: 'c172s',
  name: 'Cessna 172S Skyhawk SP',
  shortName: 'Cessna 172S',
  variant: 'Cessna 172S Skyhawk SP (Lycoming IO-360-L2A 180 hp, 2550 lb)',
  icaoType: 'C172',
  engineCount: 1,
  // The generic defaults of defaultControls() ARE this aircraft's (fuel selector BOTH, no cowl flaps).
  controlDefaults: {},
  geometry: C172S_GEOMETRY,
  mass: C172S_MASS,
  limits: C172S_LIMITS,
  controls: C172S_CONTROLS,
  airData: C172S_AIR_DATA,
  autopilot: C172S_AUTOPILOT,
  reference: C172S_REFERENCE,
  powerplant: C172_POWERPLANT,
  aero: createC172AeroDefinition,
  // The gear configuration is one shared object today (LandingGear's default argument).
  gear: () => C172_GEAR,
  sim: C172S_SIM,
  input: C172S_INPUT,
};

export default C172S_DEFINITION;
