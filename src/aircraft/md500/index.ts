// MD 500E (369E, 250-C20B): the aircraft definition. SCAFFOLD STUB (owner after the scaffold: T2).
//
// Until T2 lands the 500E flight model, the turboshaft and the freewheel, this is the Schweizer 300CB's definition
// under the MD 500E identity with the 500E rotor geometry (rotorcraft.ts), so every loader, the consistency check and
// the scenario spawns run on a coherent helicopter. It is NOT a placeholder (`placeholder` stays unset): the
// catalogue row's `available: false` is the only gate. It must be a rotorcraft from day one (isRotorcraftId drives
// snapshot validation, sim/resume.ts).
//
// T2 builds it explicitly (not by spreading the S269 or R22: no piston powerplant, carb, MAP, belt clutch or UI).
import type { AircraftDefinition } from '../types';
import S269_DEFINITION from '../s269/index';
import { MD500_ROTORCRAFT as rotor } from './rotorcraft';

export const MD500_DEFINITION: AircraftDefinition = {
  ...S269_DEFINITION,
  id: 'md500',
  name: 'MD Helicopters MD 500E',
  shortName: 'MD 500E',
  variant: '369E (Rolls-Royce 250-C20B), standard skids, LH command',
  icaoType: 'H500',
  rotorcraft: rotor,
  notModelled: [
    'IN DEVELOPMENT: this build flies the Schweizer 300CB engine and rotor dynamics under the MD 500E name; the 250-C20B turboshaft, freewheel, N2 governor and the 500E flight model are being built.',
  ],
  geometry: { ...S269_DEFINITION.geometry,
    wing: { ...S269_DEFINITION.geometry.wing, span: 2 * rotor.main.radius, area: Math.PI * rotor.main.radius ** 2 },
    propellers: [{ hub: rotor.main.hub, diameter: 2 * rotor.main.radius, blades: rotor.main.blades, rotation: rotor.rotation }] },
};

export default MD500_DEFINITION;
