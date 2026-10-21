// Lockheed AH-56A Cheyenne (AMCS default, 1973 ship 7, 66-8832; ICS 1972 configuration selectable at runtime with
// config=ics): the aircraft definition. SCAFFOLD STUB (owner after the scaffold: AG). Plan revision 2, section 2.3.
//
// Until AG lands the stage-2 aircraft, this is the MD 500E's definition under the AH-56A identity, flying the MD 500E
// rotor with four blades (base.ts, through the frozen assembly rotorcraft.ts). It is NOT a placeholder: the catalogue
// row's `available: false` is the only gate.
import type { AircraftDefinition } from '../types';
import { AH56_REFERENCE } from './reference';
import { MD500_DEFINITION as md } from '../md500';
import { AH56_ROTORCRAFT as rotor } from './rotorcraft';
import { AH56_POWERPLANT } from './powerplant';
import { AH56_INPUT } from './input';
import { AH56_SIM } from './sim';
import { AH56_MASS } from './mass';
import { ah56Gear } from './gear';

export const AH56_DEFINITION: AircraftDefinition = {
  ...md,
  id: 'ah56',
  name: 'Lockheed AH-56A Cheyenne',
  shortName: 'AH-56A',
  variant: 'AH-56A AMCS (ship 7, 66-8832, T64-GE-716); ICS 1972 configuration selectable',
  icaoType: 'ZZZZ',
  reference: { ...md.reference, vne: AH56_REFERENCE.vne },
  engineCount: 1,
  rotorcraft: rotor, powerplant: AH56_POWERPLANT, input: AH56_INPUT, sim: AH56_SIM, mass: AH56_MASS, gear: ah56Gear,
  notModelled: [
    'IN DEVELOPMENT: this build flies the MD 500E airframe, rotor (with four blades), skids and 250-C20B under the AH-56A name; the AH-56A rotor, control gyro, T64, wheels, wing, pusher and high-speed aerodynamics are being built in stages.',
  ],
  geometry: { ...md.geometry,
    wing: { ...md.geometry.wing, span: 2 * rotor.main.radius, area: Math.PI * rotor.main.radius ** 2 },
    propellers: [{ hub: rotor.main.hub, diameter: 2 * rotor.main.radius, blades: rotor.main.blades, rotation: rotor.rotation }],
    bounds: { radius: rotor.main.radius + 6, fitSize: 2 * (rotor.main.radius + 6) } },
};

export default AH56_DEFINITION;
