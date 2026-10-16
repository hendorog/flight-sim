// Cessna 208 Caravan 675 (PT6A-114A, 8000 lb): the aircraft definition (flight model, systems, sim profile and
// input profile). Node-safe: this file and what it assembles never touch the DOM, the 3D model, the panel or the
// sound (those are presentation.ts).
//
// It only ASSEMBLES the files of this directory; every number lives in one of them.

import type { AircraftDefinition } from '../types';
import { createC208AeroDefinition } from './aero';
import { createC208Gear } from './gear';
import { C208_GEOMETRY } from './geometry';
import { C208_INPUT } from './input';
import { C208_POWERPLANT } from './powerplant';
import { C208_REFERENCE } from './reference';
import { C208_SIM } from './sim';
import { C208_AIR_DATA, C208_AUTOPILOT, C208_CONTROLS, C208_LIMITS, C208_MASS } from './systems';

export const C208_DEFINITION: AircraftDefinition = {
  id: 'c208',
  name: 'Cessna 208 Caravan 675',
  shortName: 'Cessna Caravan',
  variant: 'Cessna 208 Caravan 675 (P&WC PT6A-114A 675 shp, 3629 kg)',
  icaoType: 'C208',
  engineCount: 1,
  // Both tank selectors ON; the condition lever (mixture) starts at CUT-OFF only through the cold preset.
  controlDefaults: { fuelSelector: 'on' },
  notModelled: [
    'The beta range on a cam: the blade angle follows the power lever linearly from the low-pitch stop to ground fine, so the first half of the beta travel slows a taxi less than the real lever does.',
    'The reverse limits as timed exceedances (1 min at 1825 rpm) and the beta / reverse annunciation: the lever reads BETA / REV on the HUD only.',
    'The roll spoilers: the ailerons alone carry the roll power.',
    'The cargo pod, the 208B Grand Caravan and the G1000 cockpit: the 208 Caravan 675 with its analogue panel.',
    'The inertial separator, the engine and propeller anti-ice and their power and ITT penalties.',
    'A windmilling gas generator after an in-flight flame-out (Ng runs down to zero); air starts are starter-assisted.',
    'The fuel reservoir, the firewall shut-off and the separate LEFT and RIGHT tank selector handles: one selector stands for them.',
  ],
  geometry: C208_GEOMETRY,
  mass: C208_MASS,
  limits: C208_LIMITS,
  controls: C208_CONTROLS,
  airData: C208_AIR_DATA,
  autopilot: C208_AUTOPILOT,
  reference: C208_REFERENCE,
  powerplant: C208_POWERPLANT,
  aero: createC208AeroDefinition,
  gear: createC208Gear,
  sim: C208_SIM,
  input: C208_INPUT,
};

export default C208_DEFINITION;
