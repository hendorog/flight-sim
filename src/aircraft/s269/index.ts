// Assembly only. The compatibility wing/gear constructors are bypassed by the rotorcraft runtime.
import { KT } from '../../core/math';
import type { AircraftDefinition } from '../types';
import { R22_DEFINITION as base } from '../r22';
import { S269_ROTORCRAFT as rotor } from './rotorcraft';
import { S269_MASS } from './mass';
import { S269_POWERPLANT } from './powerplant';
import { S269_INPUT } from './input';
import { S269_REFERENCE as V } from './reference';
import * as D from './dimensions';
export const S269_DEFINITION: AircraftDefinition = {
  ...base, id: 's269', name: 'Schweizer 269C-1 / 300CB (in development)', shortName: 'Schweizer 300CB',
  variant: '300CB, HO-360-C1A, S/N 0106–0138 configuration, right PIC, single tank', icaoType: 'H269',
  rotorcraft: rotor, mass: S269_MASS, powerplant: S269_POWERPLANT, input: S269_INPUT,
  controlDefaults: { fuelSelector: 'on', collective: 0, rotorGovernor: false, rotorClutch: true },
  notModelled: [
    'PLACEHOLDER: reduced harmonic articulated hub; transient flap/lag and ground resonance are not implemented.',
    'Geometry/limits are sourced; estimated blade masses, hub phase and analytic polars are not validated Schweizer handling.',
    'Oleo gas/poppet dynamics and spring trim/control forces are absent. Clutch HOLD API awaits shared control/panel wiring.',
    'No governor or optional STAR system is fitted; manual throttle uses an uncalibrated inherited correlator.',
    'Hot/high IGE hover is optimistic. CB OGE, engine cooling/fuel flow and autorotation flare need independent validation.',
    'Exterior and instrument layout are temporary stand-ins; percent tach is not the real absolute-RPM instrument.',
    'No lessons, demonstrations or validated startup checklist. See docs/s269-flight-model.md.',
  ],
  geometry: { ...base.geometry,
    wing: { ...base.geometry.wing, span: 2 * D.MAIN_ROTOR_RADIUS, area: Math.PI * D.MAIN_ROTOR_RADIUS ** 2 },
    fuselage: { length: D.FUSELAGE_LENGTH, noseX: D.NOSE_X, tailX: D.TAIL_END_X,
      maxWidth: D.CABIN_WIDTH, maxHeight: D.CABIN_HEIGHT, pilotEye: D.PILOT_EYE },
    gear: { ...base.geometry.gear, nose: { x: rotor.skids.front, y: 0, z: D.SKID_Z },
      leftMain: { x: rotor.skids.rear, y: -rotor.skids.halfTrack, z: D.SKID_Z },
      rightMain: { x: rotor.skids.rear, y: rotor.skids.halfTrack, z: D.SKID_Z } },
    propellers: [{ hub: D.MAIN_HUB, diameter: 2 * D.MAIN_ROTOR_RADIUS, blades: D.MAIN_ROTOR_BLADES, rotation: D.MAIN_ROTOR_ROTATION }],
    restHeight: D.SKID_Z, bounds: { radius: 5.7, fitSize: 11.4 } },
  limits: { ...base.limits, diveSpeedCas: V.vne * KT / 0.9 },
  airData: { ...base.airData, referenceMass: S269_MASS.maxTakeoff },
  reference: { ...base.reference, vx: V.vy, vy: V.vy, vglide: V.autorotationKias, vne: V.vne, vno: V.vne,
    vcruise: 70, vdownwind: 60, vapp: 52 },
  sim: { ...base.sim, scenario: { ...base.sim.scenario, cruiseKias: 70, downwindKias: 60, afterTakeoffKias: V.vy },
    presets: { ...base.sim.presets, cold: { ...base.sim.presets.cold, rotorGovernor: false } } },
};
export default S269_DEFINITION;
