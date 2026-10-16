// Pilatus PC-12/47: the sim profile (scenario start numbers, switch presets, the scripted pilot's numbers and the
// take-off trim). Speeds are the type's (reference.ts); circuit numbers are common operating practice (AGENT).
//
// Power is set by torque, and on the PC-12 the PCL's torque limiter (powerplant.ts) holds the take-off torque, 44.3 psi
// at sea level (47E-PROXY 7-10): the scripted pilot takes off with the lever fully forward (TAKEOFF_LEVER 1.0) and
// climbs at the maximum-continuous torque, 36.95 psi (CLIMB_LEVER, the lever position for it at sea level and Vy).
// There is no propeller lever: `propeller` is never set (the governor holds 1700 rpm).

import type { ControlPatch } from '../../core/types';
import { CUTOFF_BELOW } from '../../physics/propulsion/turbineEngine';
import type { SimProfile } from '../types';
import { PC12_FLAPS_UP_ABOVE_KIAS, PC12_REFERENCE } from './reference';

/** PCL fully forward: the torque limiter holds 44.3 psi at sea level. */
export const PC12_TAKEOFF_LEVER = 1.0;
/** PCL for the maximum-continuous torque (36.95 psi) in the Vy climb near sea level (CALIBRATED: 36.6 psi at 130 KTAS at sea level, about 90 % Ng). */
export const PC12_CLIMB_LEVER = 0.63;
/** Condition lever: GROUND IDLE (just above CUT-OFF/FEATHER) and FLIGHT IDLE. */
export const PC12_GROUND_IDLE = CUTOFF_BELOW;
export const PC12_FLIGHT_IDLE = 1;
/** Take-off rudder trim, nose right (ESTIMATE: about a third of the right rudder the 1200 shp climb needs). */
const TAKEOFF_RUDDER_TRIM = 0.3;

/** Engine running on the ground after the after-start checks: generators on, fuel pumps AUTO, condition GROUND IDLE. */
const GROUND_RUNNING: ControlPatch = {
  masterBattery: true,
  alternator: true,
  avionics: true,
  fuelPump: false,
  fuelSelector: 'on',
  mixture: PC12_GROUND_IDLE,
  magnetos: 0,
  lights: { nav: true, beacon: true, strobe: false, landing: false, taxi: true, panel: 0.6, dome: false },
};

export const PC12_SIM: SimProfile = {
  scenario: {
    // 3 NM final at Vref + 5 with flaps 40 (47E-PROXY 4.2: approach flaps 40 at 85 KIAS).
    finalKias: PC12_REFERENCE.vref + 5,
    finalFlapsDeg: 40,
    baseFlapsDeg: 15,
    // FL 200 is the type's natural cruise; the scenario starts at 12 000 ft (below the oxygen altitudes), trimmed.
    cruiseKias: 210,
    cruiseAltFt: 12_000,
    downwindKias: PC12_REFERENCE.vdownwind,
    downwindFlapsDeg: 0,
    afterTakeoffKias: 130,
    restoreMinTas: 45,
    restoreFallbackTas: 75,
  },
  presets: {
    cold: {
      masterBattery: false,
      alternator: false,
      avionics: false,
      fuelPump: false,
      // Condition lever CUT-OFF/FEATHER, ignition OFF (AUTO is the starter's).
      mixture: 0,
      magnetos: 0,
      lights: { nav: false, beacon: false, strobe: false, landing: false, taxi: false, panel: 0, dome: false },
    },
    groundRunning: GROUND_RUNNING,
    // Lined up: condition FLIGHT IDLE (47E-PROXY 4.8), strobes and landing lights on, taxi lights off.
    linedUp: { ...GROUND_RUNNING, mixture: PC12_FLIGHT_IDLE, lights: { nav: true, beacon: true, strobe: true, landing: true, taxi: false, panel: 0.6, dome: false } },
    airborne: { mixture: PC12_FLIGHT_IDLE, magnetos: 0, lights: { nav: true, beacon: true, strobe: true, landing: false, taxi: false, panel: 0.6, dome: false } },
    approach: { mixture: PC12_FLIGHT_IDLE, lights: { nav: true, beacon: true, strobe: true, landing: true, taxi: false, panel: 0.6, dome: false } },
  },
  autoflight: {
    takeoff: {
      // 47E-PROXY 4.2: flaps 15, rotate at 82 KIAS (10 450 lb), climb out and flaps up above 100 KIAS.
      flapsDeg: 15,
      rotateKias: PC12_REFERENCE.vr,
      rotatePitchDeg: [6, 10],
      rotateBlendKt: 8,
      elevatorBias: 0.2,
      pitchGain: 3,
      pitchRateGain: 1.2,
      aileronAliveKias: 45,
      handoverM: 20,
      throttle: PC12_TAKEOFF_LEVER,
    },
    climb: { kias: PC12_REFERENCE.vy, vsLimit: 4, throttle: PC12_CLIMB_LEVER },
    hold: { minKias: PC12_FLAPS_UP_ABOVE_KIAS + 10, maxBankDeg: 25, vsLimit: 4 },
    // Flaps 40 at 85-90 KIAS: a small flare, mains first at about 75 KIAS.
    flare: { minHeightM: 7, timeS: 4, pitchRiseDeg: 7, maxPitchDeg: 7 },
    // 47E-PROXY 4.16: PCL to IDLE at touchdown, then reverse as required, brakes; back to the gate below 40 KIAS.
    rollout: { brake: 0.8, noseHoldKias: [35, 75], noseHoldMax: 0.4, reverse: { lever: 1, cancelKias: 40 } },
    steering: { kind: 'rudder' },
    centreline: { headingGain: 4, yawRateGain: 1.5, lookAheadM: 90 },
    phaseControls: {
      takeoff: { mixture: PC12_FLIGHT_IDLE, rudderTrim: TAKEOFF_RUDDER_TRIM },
      climb: { mixture: PC12_FLIGHT_IDLE },
      cruise: { mixture: PC12_FLIGHT_IDLE },
      approach: { mixture: PC12_FLIGHT_IDLE },
      rollout: { mixture: PC12_FLIGHT_IDLE },
    },
  },
  takeoffTrim: { kias: PC12_REFERENCE.vy, flapsDeg: 0 },
};
