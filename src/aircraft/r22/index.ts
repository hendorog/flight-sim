import { HP, KT } from '../../core/math';
import type { AircraftDefinition } from '../types';
import { C152_DEFINITION as base } from '../c152';
import { C152_ENGINE, C152_POWERPLANT } from '../c152/powerplant';
import { R22_ROTORCRAFT } from './rotorcraft';
import { R22_INPUT } from './input';

const crew = { payload: 154, payloadPosition: { x: 0.15, y: 0, z: 0 } };
const capacity = 26.4 * 2.72155;
/** Legacy panel/camera contracts still include wing fields. They are metadata only for rotorcraft;
 * the flight model bypasses the fixed-wing aero/control solver entirely. */
export const R22_DEFINITION: AircraftDefinition = {
  ...base, id: 'r22', name: 'Robinson R22 Beta II (experimental)', shortName: 'R22 Beta II',
  variant: 'R22 Beta II, O-360-J2A, standard + auxiliary fuel tanks', icaoType: 'R22',
  rotorcraft: R22_ROTORCRAFT,
  controlDefaults: { fuelSelector: 'on', collective: 0, rotorGovernor: true, rotorClutch: true },
  notModelled: [
    'Experimental, not flight-test validated: analytic rotor polars, estimated inertia and flapping response.',
    'Free wake, elastic blades, mast bumping, ground resonance, dynamic rollover damage and LTE are not resolved.',
    'Governor/clutch engagement and engine derating are simplified; no five-minute takeoff-power timer.',
    'Procedural exterior and generic instrument panel/audio; not an R22 cockpit or sound recording.',
    'Fixed-wing autoflight and Flight School are unavailable; R44 and Schweizer 269 are not yet implemented.',
  ],
  geometry: { ...base.geometry,
    wing: { ...base.geometry.wing, span: 7.6708, area: Math.PI * 3.8354 ** 2 },
    fuselage: { length: 6.5, noseX: 1.6, tailX: -4.9, maxWidth: 1.2, maxHeight: 1.6,
      pilotEye: { x: 0.7, y: 0.28, z: -0.35 } },
    gear: { ...base.geometry.gear, nose: { x: 0.85, y: 0, z: 0.9 },
      leftMain: { x: -1.1, y: -0.965, z: 0.9 }, rightMain: { x: -1.1, y: 0.965, z: 0.9 }, maxNoseSteer: 0 },
    propellers: [{ hub: R22_ROTORCRAFT.main.hub, diameter: 7.6708, blades: 2, rotation: 1 }],
    restHeight: 0.877, bounds: { radius: 5.2, fitSize: 10 } },
  mass: { empty: 389, maxTakeoff: 622.56, maxLanding: 622.56,
    emptyCg: { x: -crew.payload * crew.payloadPosition.x / 389, y: 0, z: 0 }, seatY: 0.28,
    inertia: { about: 'cg', Ixx: 320, Iyy: 900, Izz: 850, Ixz: 0 }, inertiaLoading: crew,
    loadings: { typical: crew, forward: { ...crew, payloadPosition: { x: 0.3, y: 0, z: 0 } },
      aft: { ...crew, payloadPosition: { x: 0, y: 0, z: 0 } },
      maxGross: { ...crew, payload: 622.56 - 389 - capacity } } },
  limits: { ...base.limits, diveSpeedCas: 102 * KT / 0.9, vfeCas: [Infinity] },
  controls: { ...base.controls, flaps: { maxDeflection: 1, detents: [0], drive: { kind: 'manual', rate: 1 } },
    aileron: { ...base.controls.aileron, rigging: 0 }, steering: { kind: 'castering' } },
  airData: { calibration: [], referenceMass: 622.56, asiAliveKt: [0, 10] },
  reference: { vs0: 0, vs1: 0, vr: 0, vx: 53, vy: 53, vglide: 65, va: 0, vfe: [],
    vno: 102, vne: 102, vapp: 60, vref: 0, vcruise: 80, vdownwind: 70, glideRatio: 4 },
  powerplant: { ...C152_POWERPLANT,
    electrical: { ...C152_POWERPLANT.electrical, nominalVolts: 14, regulatorVolts: 14.2,
      lowVoltsLamp: 12.5, overVolts: 16, busDeadVolts: 10,
      battery: { capacityAh: 25, ocvEmpty: 11.6, ocvSpan: 1.3, rDischarge: 0.0125, rChargeBase: 0.04, rChargeFull: 0.75 } },
    engines: [{ ...C152_POWERPLANT.engines[0], hub: { x: 0, y: 0, z: 0 },
      // Propeller is a compatibility carrier for the generic engine module; externalDrive disables its loads.
      propeller: { ...C152_POWERPLANT.engines[0].propeller, inertia: 0.05 },
      engine: { ...C152_ENGINE, name: 'Lycoming O-360-J2A (derated)', ratedPower: 131 * HP,
        ratedRpm: 2652, displacement: 5.916e-3, compressionRatio: 8.5, rotatingInertia: 0.45,
        airStartRpm: 2652, groundStartRpm: 2652, starter: { k: 0.00145, r: 0.025 },
        induction: { ...C152_ENGINE.induction, idleArea: 0.000018, throttleBoreArea: Math.PI * 0.03 ** 2 },
        metering: { kind: 'floatCarburettor', takeoffFuelFlow: 0.0075, leanestFraction: 0.35 } } }],
    fuel: { ...C152_POWERPLANT.fuel, tanks: [
      { id: 'main', side: 'left', capacity: 19.2 * 2.72155, position: { x: 0, y: -0.3, z: -0.1 } },
      { id: 'aux', side: 'right', capacity: 7.2 * 2.72155, position: { x: 0, y: 0.3, z: -0.1 } },
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
