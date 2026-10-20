// MBB Bo 105 CB-4 (2 x Allison 250-C20B, ZF FS 72B, 2500 kg): the aircraft definition. SCAFFOLD STUB (owner after the
// scaffold: BO). Plan revision 2, section 2.3.
//
// Until RC (hingeless hub), TW (twin drivetrain) and BO (the Bo 105 flight model) land, this is the MD 500E's
// definition under the Bo 105 identity, flying the Bo 105 rotor geometry, rotor speed and the twin installation
// (rotorcraft.ts). It is NOT a placeholder: the catalogue row's `available: false` is the only gate.
//
// Two engines: the flight model needs one aero propeller station per engine (flightModel.ts), so the fixed-wing
// compatibility `aero()` comes from a two-station donor (the PA-34's); the rotorcraft runtime replaces its loads.
import type { AircraftDefinition } from '../types';
import { MD500_DEFINITION as md } from '../md500';
import { PA34_DEFINITION } from '../pa34';
import { BO105_ROTORCRAFT as rotor } from './rotorcraft';
import { BO105_POWERPLANT } from './powerplant';
import { BO105_INPUT } from './input';
import { BO105_SIM } from './sim';
import { BO105_MASS } from './mass';

export const BO105_DEFINITION: AircraftDefinition = {
  ...md,
  id: 'bo105',
  name: 'MBB Bo 105 CB-4',
  shortName: 'Bo 105',
  variant: 'Bo 105 CB-4 (2 x Allison 250-C20B, ZF FS 72B, 2500 kg)',
  icaoType: 'B105',
  engineCount: 2,
  aero: PA34_DEFINITION.aero,
  rotorcraft: rotor, powerplant: BO105_POWERPLANT, input: BO105_INPUT, sim: BO105_SIM, mass: BO105_MASS,
  notModelled: [
    'IN DEVELOPMENT: this build flies the MD 500E airframe, articulated hub and single-engine drive under the Bo 105 name with the Bo 105 rotor geometry; the hingeless rotor, the twin drivetrain and the Bo 105 flight model are being built.',
  ],
  // One `propellers` entry per engine (contract): both engines drive the one main rotor, so both entries are the rotor.
  geometry: { ...md.geometry,
    wing: { ...md.geometry.wing, span: 2 * rotor.main.radius, area: Math.PI * rotor.main.radius ** 2 },
    propellers: [0, 1].map(() => ({ hub: rotor.main.hub, diameter: 2 * rotor.main.radius, blades: rotor.main.blades, rotation: rotor.rotation })) },
};

export default BO105_DEFINITION;
