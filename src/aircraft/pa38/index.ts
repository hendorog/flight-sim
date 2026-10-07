// Piper PA-38-112 Tomahawk II: the aircraft definition (flight model, systems, sim profile and input profile).
// Node-safe: this file and what it assembles never touch the DOM, the 3D model, the panel or the sound (those are
// presentation.ts).
//
// It only ASSEMBLES the files of this directory; every number lives in one of them. Their source is the type's
// engineering data sheet (aircraft-data/pa38.md in the design work folder).

import type { AircraftDefinition } from '../types';
import { createPA38AeroDefinition } from './aero';
import { createPA38Gear } from './gear';
import { PA38_GEOMETRY } from './geometry';
import { PA38_INPUT } from './input';
import { PA38_POWERPLANT } from './powerplant';
import { PA38_REFERENCE } from './reference';
import { PA38_SIM } from './sim';
import { PA38_AIR_DATA, PA38_AUTOPILOT, PA38_CONTROLS, PA38_LIMITS, PA38_MASS } from './systems';

export const PA38_DEFINITION: AircraftDefinition = {
  id: 'pa38',
  name: 'Piper PA-38-112 Tomahawk II',
  shortName: 'Piper Tomahawk',
  variant: 'PA-38-112 Tomahawk II (Lycoming O-235-L2C 112 hp, 757.5 kg)',
  icaoType: 'PA38',
  engineCount: 1,
  // A LEFT / RIGHT / OFF selector instead of the generic BOTH: the take-off tank (POH 4.27: an hour on the first).
  controlDefaults: { fuelSelector: 'left' },
  notModelled: [
    'The hand primer: a cold engine starts without priming; no over-priming, no stumble on a fast throttle opening (there is no accelerator pump).',
    'The flow strips as anything but an earlier stall over their span: their stations are estimates (Piper SL 876 not found).',
    'The rattle and shake of the T-tail in the wing\'s wake at the stall: the buffet is the generic one.',
    'Detonation at full throttle with carburettor heat on (POH 4.29): the power falls with the hot air, nothing breaks.',
    'The Tomahawk I (outboard flow strips only, 5.00-5 wheels): the Tomahawk II as every aircraft has been since AD 83-14-08.',
    'The ground-adjustable rudder tab as anything but a fixed rigging offset.',
  ],
  geometry: PA38_GEOMETRY,
  mass: PA38_MASS,
  limits: PA38_LIMITS,
  controls: PA38_CONTROLS,
  airData: PA38_AIR_DATA,
  autopilot: PA38_AUTOPILOT,
  reference: PA38_REFERENCE,
  powerplant: PA38_POWERPLANT,
  aero: createPA38AeroDefinition,
  gear: createPA38Gear,
  sim: PA38_SIM,
  input: PA38_INPUT,
};

export default PA38_DEFINITION;
