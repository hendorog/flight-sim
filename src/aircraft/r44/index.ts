// Experimental flight-model assembly. PLACEHOLDER remains until the complete R44 is reviewed.
import { KT } from '../../core/math';
import type { AircraftDefinition } from '../types';
import { C152_DEFINITION as base } from '../c152';
import { R44_ROTORCRAFT as rotor } from './rotorcraft';
import { R44_MASS } from './mass';
import { R44_POWERPLANT } from './powerplant';
import { R44_INPUT } from './input';
import { MAIN_ROTOR_RADIUS, FUSELAGE_LENGTH, NOSE_X, TAIL_END_X, CABIN_WIDTH, CABIN_HEIGHT, PILOT_EYE, SKID_Z } from './dimensions';
export const R44_DEFINITION: AircraftDefinition = {
  ...base, id: 'r44', name: 'Robinson R44 Raven II', shortName: 'R44 Raven II',
  variant: 'Raven II / IO-540-AE1A5; experimental', icaoType: 'R44',
  rotorcraft: rotor, mass: R44_MASS, powerplant: R44_POWERPLANT, input: R44_INPUT,
  controlDefaults: { fuelSelector: 'on', collective: 0, rotorGovernor: true, rotorClutch: true },
  notModelled: [
    'PLACEHOLDER: experimental R44 dynamics and unfinished presentation; not flight-test validated.',
    'Rotor/airframe inertia, polars, fixture-to-section rigging offset and governor response are estimates.',
    'Hydraulic actuation is identified; servo failures, control forces and hydraulic switch are not simulated.',
    'Interconnected tank flow, exact closed-throttle/hot starts and fuel-filter sensing remain unfinished; pump pressures and oil-switch threshold are estimates.',
    'Cooling uses a shared fixed fan-flow approximation; fan shaft losses and engine thermals need validation.',
    'Autorotation landing/flare remains an open limitation; see docs/r44-flight-model.md.',
    'Configuration-aware Vne/MAP warnings report limits without automatic enforcement; no R44 demos or lessons.',
    'Panel, sounds and exterior are temporary; see docs/r44-sources.md and work/r44-plan.md.',
  ],
  geometry: { ...base.geometry,
    wing: { ...base.geometry.wing, span: 2 * MAIN_ROTOR_RADIUS, area: Math.PI * MAIN_ROTOR_RADIUS ** 2 },
    fuselage: { length: FUSELAGE_LENGTH, noseX: NOSE_X, tailX: TAIL_END_X,
      maxWidth: CABIN_WIDTH, maxHeight: CABIN_HEIGHT, pilotEye: PILOT_EYE },
    gear: { ...base.geometry.gear, nose: { x: rotor.skids.front, y: 0, z: SKID_Z },
      leftMain: { x: rotor.skids.rear, y: -rotor.skids.halfTrack, z: SKID_Z },
      rightMain: { x: rotor.skids.rear, y: rotor.skids.halfTrack, z: SKID_Z }, maxNoseSteer: 0 },
    propellers: [{ hub: rotor.main.hub, diameter: 2 * MAIN_ROTOR_RADIUS, blades: 2, rotation: 1 }],
    restHeight: SKID_Z, bounds: { radius: 7.1, fitSize: 14 } },
  // Legacy wing/control fields are compatibility metadata; the rotor solver bypasses fixed-wing aero.
  limits: { ...base.limits, diveSpeedCas: 130 * KT / 0.9, vfeCas: [Infinity] },
  controls: { ...base.controls, flaps: { maxDeflection: 1, detents: [0], drive: { kind: 'manual', rate: 1 } },
    aileron: { ...base.controls.aileron, rigging: 0 }, steering: { kind: 'castering' } },
  airData: { calibration: [], referenceMass: R44_MASS.maxTakeoff, asiAliveKt: [0, 10] },
  reference: { vs0: 0, vs1: 0, vr: 0, vx: 60, vy: 60, vglide: 90, va: 0, vfe: [],
    vne: 130, vno: 110, vcruise: 100, vapp: 60, vref: 0, vdownwind: 80, glideRatio: 4.7 },
  sim: { ...base.sim, scenario: { finalKias: 60, finalFlapsDeg: 0, baseFlapsDeg: 0,
    cruiseKias: 100, cruiseAltFt: 1500, downwindKias: 80, downwindFlapsDeg: 0, afterTakeoffKias: 60,
    restoreMinTas: 0, restoreFallbackTas: 0 },
    presets: { ...base.sim.presets, approach: { carbHeat: 0 },
      cold: { ...base.sim.presets.cold, rotorClutch: false, rotorGovernor: true } } },
};
export default R44_DEFINITION;
