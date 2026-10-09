// PLACEHOLDER assembly for parallel R44 development. Reachable by URL, hidden from the chooser.
import { KT } from '../../core/math';
import type { AircraftDefinition } from '../types';
import { R22_DEFINITION as base } from '../r22';
import { R44_ROTORCRAFT as rotor } from './rotorcraft';
import { R44_MASS } from './mass';
import { R44_POWERPLANT } from './powerplant';
import { R44_INPUT } from './input';
import { MAIN_ROTOR_RADIUS, FUSELAGE_LENGTH, NOSE_X, TAIL_END_X, CABIN_WIDTH, CABIN_HEIGHT, PILOT_EYE, SKID_Z } from './dimensions';
export const R44_DEFINITION: AircraftDefinition = {
  ...base, id: 'r44', name: 'Robinson R44 Raven II (placeholder)', shortName: 'R44 Raven II',
  variant: 'Raven II / IO-540-AE1A5; development scaffold', icaoType: 'R44', placeholder: true,
  rotorcraft: rotor, mass: R44_MASS, powerplant: R44_POWERPLANT, input: R44_INPUT,
  notModelled: [
    'PLACEHOLDER: R22-derived dynamics and artwork, not an accepted R44 flight model or cockpit.',
    'Rotor/airframe inertia, polars, rigging, governor, engine thermals and performance require R44 validation.',
    'Hydraulic actuation is identified; servo failures, control forces and hydraulic switch are not simulated.',
    'Fuel pump automation, interconnected tank flow, priming and fuel-pressure warnings are unfinished.',
    'Vne weight, power-off, high-power and doors-off corrections are not applied; no R44 demos or lessons.',
    'Panel, sounds and exterior are temporary; see docs/r44-sources.md and work/r44-plan.md.',
  ],
  geometry: { ...base.geometry,
    wing: { ...base.geometry.wing, span: 2 * MAIN_ROTOR_RADIUS, area: Math.PI * MAIN_ROTOR_RADIUS ** 2 },
    fuselage: { length: FUSELAGE_LENGTH, noseX: NOSE_X, tailX: TAIL_END_X,
      maxWidth: CABIN_WIDTH, maxHeight: CABIN_HEIGHT, pilotEye: PILOT_EYE },
    gear: { ...base.geometry.gear, nose: { x: rotor.skids.front, y: 0, z: SKID_Z },
      leftMain: { x: rotor.skids.rear, y: -rotor.skids.halfTrack, z: SKID_Z },
      rightMain: { x: rotor.skids.rear, y: rotor.skids.halfTrack, z: SKID_Z } },
    propellers: [{ hub: rotor.main.hub, diameter: 2 * MAIN_ROTOR_RADIUS, blades: 2, rotation: 1 }],
    restHeight: SKID_Z, bounds: { radius: 7.1, fitSize: 14 } },
  limits: { ...base.limits, diveSpeedCas: 130 * KT / 0.9 },
  airData: { ...base.airData, referenceMass: R44_MASS.maxTakeoff },
  reference: { ...base.reference, vx: 60, vy: 60, vglide: 90, vne: 130, vno: 110, vcruise: 100 },
};
export default R44_DEFINITION;
