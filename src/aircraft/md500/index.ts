// MD 500E (369E, 250-C20B): the aircraft definition. Owner: T2. Node-safe assembly only; every number lives in a
// file of this directory (dimensions, facts, reference, rotorcraft, powerplant, mass, limits, input, sim).
//
// Built explicitly: no R22 or S269 piston powerplant, carburettor, MAP placard, belt clutch, governor switch or UI
// is inherited. The fixed-wing compatibility fields every AircraftDefinition carries (aero(), gear(), controls,
// autopilot) are the C152's, as the R44's: the rotorcraft runtime bypasses them (flightModel.ts builds a Rotorcraft
// and SkidGear when `rotorcraft` is present).
import { KT } from '../../core/math';
import type { AircraftDefinition } from '../types';
import { C152_DEFINITION as base } from '../c152';
import { MD500_ROTORCRAFT as rotor } from './rotorcraft';
import { MD500_MASS } from './mass';
import { MD500_POWERPLANT } from './powerplant';
import { MD500_INPUT } from './input';
import { MD500_SIM } from './sim';
import { MD500_REFERENCE as V } from './reference';
import * as D from './dimensions';

export const MD500_DEFINITION: AircraftDefinition = {
  ...base,
  id: 'md500',
  name: 'MD Helicopters MD 500E',
  shortName: 'MD 500E',
  variant: '369E (Rolls-Royce 250-C20B), standard skids, LH command',
  icaoType: 'H500',
  engineCount: 1,
  rotorcraft: rotor, mass: MD500_MASS, powerplant: MD500_POWERPLANT, input: MD500_INPUT, sim: MD500_SIM,
  // A turbine starts with the igniters off (consistency); the grip at CUTOFF; no clutch or governor switch exists
  // (rotorClutch / rotorGovernor stay true: the freewheel is always engaged and the N2 governor is hydromechanical;
  // rotorGovernor false is the governor-failure case, RFM 3-14).
  controlDefaults: { fuelSelector: 'on', collective: 0, rotorGovernor: true, rotorClutch: true, magnetos: 0, throttle: 0, mixture: 1 },
  notModelled: [
    'Optional kits: particle separator, floats, cargo hook, the 4-blade tail rotor, the 250-C20R/2 engine, extended gear.',
    'Cabin heat and engine anti-ice bleed (the RFM 4-19 TOT rise and the Fig 5-4 hover penalties); the scavenge-air switch.',
    'The hydraulic one-way lock in the longitudinal cyclic and its failure (control forces are not fed back).',
    'Per-blade flap and lag transients, ground resonance and the elastomeric dampers beyond the reduced harmonic hub.',
    'Auto-reignition beyond the ENGINE OUT light/horn and the igniter logic; flame-out by snow, ice or water ingestion.',
    'Tail-rotor speed (2933 rpm), main-rotor blade data and the stabiliser incidence sign are estimates; see KNOWN_ISSUES.md.',
  ],
  geometry: { ...base.geometry,
    wing: { ...base.geometry.wing, span: 2 * D.MAIN_ROTOR_RADIUS, area: Math.PI * D.MAIN_ROTOR_RADIUS ** 2 },
    fuselage: { length: D.FUSELAGE_LENGTH, noseX: D.NOSE_X, tailX: D.TAIL_END_X,
      maxWidth: D.CABIN_WIDTH, maxHeight: D.BELLY_Z - D.CABIN_ROOF_Z, pilotEye: D.PILOT_EYE },
    gear: { ...base.geometry.gear, nose: { x: rotor.skids.front, y: 0, z: D.SKID_FRONT_Z },
      leftMain: { x: rotor.skids.rear, y: -rotor.skids.halfTrack, z: D.SKID_Z },
      rightMain: { x: rotor.skids.rear, y: rotor.skids.halfTrack, z: D.SKID_Z }, maxNoseSteer: 0 },
    propellers: [{ hub: rotor.main.hub, diameter: 2 * D.MAIN_ROTOR_RADIUS, blades: D.MAIN_ROTOR_BLADES, rotation: D.MAIN_ROTOR_ROTATION }],
    restHeight: D.SKID_Z, bounds: { radius: D.OVERALL_LENGTH / 2 + 0.5, fitSize: D.OVERALL_LENGTH + 1 } },
  // Legacy wing/control fields are compatibility metadata; the rotor solver bypasses fixed-wing aero.
  limits: { ...base.limits, diveSpeedCas: V.vne * KT / 0.9, vfeCas: [Infinity] },
  controls: { ...base.controls, flaps: { maxDeflection: 1, detents: [0], drive: { kind: 'manual', rate: 1 } },
    aileron: { ...base.controls.aileron, rigging: 0 }, steering: { kind: 'castering' } },
  // RFM 5-4: IAS = CAS within about 0.5 kt; unreliable below 40 kt in the climb.
  airData: { calibration: [], referenceMass: MD500_MASS.maxTakeoff, asiAliveKt: [0, 20] },
  reference: { vs0: 0, vs1: 0, vr: 0, vx: V.vy, vy: V.vy, vglide: V.autorotationKias, va: 0, vfe: [],
    vno: V.vne, vne: V.vne, vapp: 60, vref: 0, vcruise: 120, vdownwind: 80, glideRatio: 4 },
};

export default MD500_DEFINITION;
