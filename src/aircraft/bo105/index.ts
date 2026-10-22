// MBB Bo 105 CB-4 (2 x Allison 250-C20B, ZF FS 72B, 2500 kg): the aircraft definition. Owner: BO. Node-safe assembly
// only; every number lives in a file of this directory (dimensions, facts, reference, hub, coning, rotorcraft,
// powerplant, mass, limits, input, sim) or in twin.ts (TW's twin data).
//
// The fixed-wing compatibility fields every AircraftDefinition carries (gear(), controls, autopilot) are the MD 500E's
// (the C152's), as the other helicopters': the rotorcraft runtime bypasses them (flightModel.ts builds a Rotorcraft and
// SkidGear when `rotorcraft` is present). Two engines: the flight model needs one aero propeller station per engine, so
// the compatibility `aero()` is the PA-34's (two stations); the rotorcraft runtime replaces its loads.
import { KT } from '../../core/math';
import type { AircraftDefinition } from '../types';
import { MD500_DEFINITION as md } from '../md500';
import { PA34_DEFINITION } from '../pa34';
import { BO105_ROTORCRAFT as rotor } from './rotorcraft';
import { BO105_POWERPLANT } from './powerplant';
import { BO105_INPUT } from './input';
import { BO105_SIM } from './sim';
import { BO105_MASS } from './mass';
import { BO105_REFERENCE as V } from './reference';
import * as D from './dimensions';

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
  // Turbines start with the ignition off (consistency), both power levers OFF; no clutch or governor switch (the
  // freewheels are always engaged and the N2 governors hydromechanical; rotorGovernor false is a governor failure).
  controlDefaults: { fuelSelector: 'on', collective: 0, rotorGovernor: true, rotorClutch: true, magnetos: 0, throttle: 0, mixture: 1 },
  notModelled: [
    'Optional kits (AGENT choice: none fitted): the SAS/IFR kit (FMS 11-2), Category A (FMS 11-4), rotor brake, floats, hoist, cargo hook.',
    'The lead-lag degree of freedom (soft in-plane, 0.66-0.73/rev): no air or ground resonance; blade elastic modes beyond the equivalent hinge.',
    'Hydraulic system failures (HYD 1 / HYD 2, HY BLOCK) are lamps only; the servo forces after a failure are not fed back.',
    'Engine anti-ice, pitot heat, the engine fire and chip detectors; the N1-split warning reset; the fuel transfer pumps beyond an equal-share approximation.',
    'Control travels, the tail-rotor rpm and delta-3, the stabiliser and fin aerodynamics and the empty CG are estimates fitted to AR-280 data; see KNOWN_ISSUES.md.',
    'Performance is the CB-5 flight manual\'s (Type 2 blades) set about 1,700 ft lower in hover ceiling; no CB-4 chart was found.',
  ],
  geometry: { ...md.geometry,
    wing: { ...md.geometry.wing, span: 2 * D.MAIN_ROTOR_RADIUS, area: Math.PI * D.MAIN_ROTOR_RADIUS ** 2 },
    fuselage: { length: D.FUSELAGE_LENGTH, noseX: D.NOSE_X, tailX: D.TAIL_END_X, maxWidth: D.HULL_WIDTH,
      maxHeight: D.CABIN_ROOF_HEIGHT - D.BELLY_HEIGHT, pilotEye: D.PILOT_EYE },
    gear: { ...md.geometry.gear, nose: { x: rotor.skids.front, y: 0, z: rotor.skids.frontZ ?? D.SKID_Z },
      leftMain: { x: rotor.skids.rear, y: -rotor.skids.halfTrack, z: D.SKID_Z },
      rightMain: { x: rotor.skids.rear, y: rotor.skids.halfTrack, z: D.SKID_Z }, maxNoseSteer: 0 },
    // One `propellers` entry per engine (contract): both engines drive the one main rotor, so both entries are the rotor.
    propellers: [0, 1].map(() => ({ hub: rotor.main.hub, diameter: 2 * D.MAIN_ROTOR_RADIUS, blades: D.MAIN_ROTOR_BLADES,
      rotation: D.MAIN_ROTOR_ROTATION })),
    restHeight: D.SKID_Z, bounds: { radius: D.OVERALL_LENGTH / 2 + 0.5, fitSize: D.OVERALL_LENGTH + 1 } },
  // Legacy wing/control fields are compatibility metadata; the rotor solver bypasses fixed-wing aero.
  limits: { ...md.limits, diveSpeedCas: V.vne * KT / 0.9, vfeCas: [Infinity] },
  // P5 FM Section 5 airspeed calibration (D agent reading: IAS 50 -> CAS about 54 kt, 90 -> 91, 100 -> 100): IAS = CAS
  // within about 4 kt; unreliable below about 30 kt.
  airData: { calibration: [], referenceMass: BO105_MASS.maxTakeoff, asiAliveKt: [0, 20] },
  reference: { vs0: 0, vs1: 0, vr: 0, vx: V.vy, vy: V.vy, vglide: V.autorotationKias, va: 0, vfe: [],
    vno: V.vne, vne: V.vne, vapp: V.approachKias, vref: 0, vcruise: V.cruiseKias, vdownwind: V.downwindKias, glideRatio: 4 },
};

export default BO105_DEFINITION;
