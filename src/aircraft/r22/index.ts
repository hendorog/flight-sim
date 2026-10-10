import { HP, KT } from '../../core/math';
import type { AircraftDefinition } from '../types';
import { C152_DEFINITION as base } from '../c152';
import { C152_ENGINE, C152_POWERPLANT } from '../c152/powerplant';
import { R22_ROTORCRAFT } from './rotorcraft';
import { R22_INPUT } from './input';
import { R22_MASS, R22_FUEL_CAPACITY } from './mass';
import { MAIN_ROTOR_RADIUS, FUSELAGE_LENGTH, NOSE_X, TAIL_END_X, CABIN_WIDTH, PILOT_EYE } from './dimensions';

/** Legacy panel/camera contracts still include wing fields. They are metadata only for rotorcraft;
 * the flight model bypasses the fixed-wing aero/control solver entirely. */
export const R22_DEFINITION: AircraftDefinition = {
  ...base, id: 'r22', name: 'Robinson R22 Beta II', shortName: 'R22 Beta II',
  variant: 'R22 Beta II, O-360-J2A, standard + auxiliary fuel tanks', icaoType: 'R22',
  rotorcraft: R22_ROTORCRAFT,
  controlDefaults: { fuelSelector: 'on', collective: 0, rotorGovernor: true, rotorClutch: true },
  notModelled: [
    'Experimental, not flight-test validated: analytic rotor polars, estimated inertia and flapping response.',
    'Free wake, elastic blades, ground resonance and LTE are not resolved; teeter-stop damage uses an estimated limit.',
    'Clutch, governor and throttle correlation are reduced-order models; power/MAP calibration needs flight-test data.',
    'Autorotation descent is checked; a complete slow flare/cushion landing has not yet been validated.',
    'Synthesized audio is not an R22 sound recording.',
    'Fixed-wing autoflight and Flight School are unavailable; R44 and Schweizer 269 are not yet implemented.',
  ],
  geometry: { ...base.geometry,
    wing: { ...base.geometry.wing, span: 2 * MAIN_ROTOR_RADIUS, area: Math.PI * MAIN_ROTOR_RADIUS ** 2 },
    fuselage: { length: FUSELAGE_LENGTH, noseX: NOSE_X, tailX: TAIL_END_X, maxWidth: CABIN_WIDTH, maxHeight: 1.6,
      pilotEye: PILOT_EYE },
    gear: { ...base.geometry.gear, nose: { x: R22_ROTORCRAFT.skids.front, y: 0, z: R22_ROTORCRAFT.skids.z },
      leftMain: { x: R22_ROTORCRAFT.skids.rear, y: -R22_ROTORCRAFT.skids.halfTrack, z: R22_ROTORCRAFT.skids.z },
      rightMain: { x: R22_ROTORCRAFT.skids.rear, y: R22_ROTORCRAFT.skids.halfTrack, z: R22_ROTORCRAFT.skids.z }, maxNoseSteer: 0 },
    propellers: [{ hub: R22_ROTORCRAFT.main.hub, diameter: 2 * MAIN_ROTOR_RADIUS, blades: 2, rotation: 1 }],
    restHeight: 0.877, bounds: { radius: 5.2, fitSize: 10 } },
  mass: R22_MASS,
  limits: { ...base.limits, diveSpeedCas: 102 * KT / 0.9, vfeCas: [Infinity] },
  controls: { ...base.controls, flaps: { maxDeflection: 1, detents: [0], drive: { kind: 'manual', rate: 1 } },
    aileron: { ...base.controls.aileron, rigging: 0 }, steering: { kind: 'castering' } },
  airData: { calibration: [], referenceMass: R22_MASS.maxTakeoff, asiAliveKt: [0, 10] },
  reference: { vs0: 0, vs1: 0, vr: 0, vx: 53, vy: 53, vglide: 65, va: 0, vfe: [],
    vno: 102, vne: 102, vapp: 60, vref: 0, vcruise: 80, vdownwind: 70, glideRatio: 4 },
  powerplant: { ...C152_POWERPLANT,
    electrical: { ...C152_POWERPLANT.electrical, nominalVolts: 14, regulatorVolts: 14.2,
      lowVoltsLamp: 12.5, overVolts: 16, busDeadVolts: 10,
      battery: { capacityAh: 25, ocvEmpty: 11.6, ocvSpan: 1.3, rDischarge: 0.0125, rChargeBase: 0.04, rChargeFull: 0.75 } },
    engines: [{ ...C152_POWERPLANT.engines[0], hub: { x: 0, y: 0, z: 0 },
      // Propeller is a compatibility carrier for the generic engine module; externalDrive disables its loads.
      propeller: { ...C152_POWERPLANT.engines[0].propeller, inertia: 0.05 },
      engine: { ...C152_ENGINE, name: 'Lycoming O-360-J2A (derated)', ratedPower: 145 * HP,
        // POH 2-11: MCP = 124 hp at 2652 rpm, SL/15°C MAP = 22.45 inHg. MM 6.002:
        // the engine is capable of 180 hp; 145 hp is a derating, not a WOT calibration.
        calibration: { power: 124 * HP, rpm: 2652, manifoldPressure: 22.45 * 3386.389 },
        ratedRpm: 2700, displacement: 5.916e-3, compressionRatio: 8.5, rotatingInertia: 0.45,
        airStartRpm: 2652, groundStartRpm: 2652, starter: { k: 0.00145, r: 0.025 },
        induction: { ...C152_ENGINE.induction, idleArea: 0.000018, throttleBoreArea: Math.PI * 0.03 ** 2,
          // ESTIMATE: scale the C152 induction throat by displacement, rather than choking a 5.9 L engine.
          inletArea: 1.0e-3 * 5.916 / 3.823 },
        // Full-rich is rich of peak. The previous fuel-flow calibration made it phi = 0.89 (lean).
        // Exact enrichment is estimated; check MAP/power against POH and fuel against Lycoming Fig. 3-40.
        metering: { kind: 'floatCarburettor', fullRichPhi: 1.15, leanestFraction: 0.35 } } }],
    fuel: { ...C152_POWERPLANT.fuel, tanks: [
      { id: 'main', side: 'left', capacity: R22_FUEL_CAPACITY[0], position: { x: -8.6 * 0.0254, y: -11 * 0.0254, z: -0.1 } },
      { id: 'aux', side: 'right', capacity: R22_FUEL_CAPACITY[1], position: { x: -3.8 * 0.0254, y: 11.2 * 0.0254, z: -0.1 } },
    ] } },
  // Unused legacy aero/gear constructors are retained for diagnostic APIs. Actual loads use rotorcraft + SkidGear.
  input: R22_INPUT,
  sim: { ...base.sim, scenario: { finalKias: 60, finalFlapsDeg: 0, baseFlapsDeg: 0,
    cruiseKias: 80, cruiseAltFt: 1500, downwindKias: 70, downwindFlapsDeg: 0, afterTakeoffKias: 65,
    restoreMinTas: 0, restoreFallbackTas: 0 },
    presets: { ...base.sim.presets, approach: { carbHeat: 0 },
      cold: { ...base.sim.presets.cold, rotorClutch: false, rotorGovernor: false } } },
};
export default R22_DEFINITION;
