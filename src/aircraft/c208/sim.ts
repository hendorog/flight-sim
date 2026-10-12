// Cessna 208 Caravan 675: the sim profile (scenario start numbers, switch presets, the scripted pilot's numbers
// and the take-off trim). Speeds are the type's (reference.ts); circuit numbers are common operating practice.
//
// Power is set by torque on the PT6A: the power lever's position for the 1865 ft lbf limit at sea level is about
// 0.9 (97 % Ng; 101.6 % is reached only with the lever fully forward, which would over-torque the engine low
// down). The scripted pilot takes off at that setting and climbs a little below it.

import type { ControlPatch } from '../../core/types';
import type { SimProfile } from '../types';
import { C208_REFERENCE } from './reference';

/** Power lever at the take-off torque limit at sea level, and the climb setting. */
const TAKEOFF_LEVER = 0.885;
const CLIMB_LEVER = 0.86;

/** Engine running on the ground after the after-start checks: generator on, boost pump NORM, condition LOW IDLE. */
const GROUND_RUNNING: ControlPatch = {
  masterBattery: true,
  alternator: true,
  avionics: true,
  fuelPump: false,
  fuelSelector: 'on',
  // Condition lever at LOW IDLE for the taxi (turbineEngine.ts CUTOFF_BELOW), ignition NORM (off), propeller lever MAX.
  mixture: 0.1,
  magnetos: 0,
  propeller: 1,
  lights: { nav: true, beacon: true, strobe: false, landing: false, taxi: true, panel: 0.6, dome: false },
};

export const C208_SIM: SimProfile = {
  scenario: {
    // 3 NM final at 95 KIAS with flaps 20.
    finalKias: C208_REFERENCE.vapp,
    finalFlapsDeg: 20,
    baseFlapsDeg: 20,
    // 10 000 ft, trimmed at the cruise speed.
    cruiseKias: C208_REFERENCE.vcruise,
    cruiseAltFt: 10_000,
    downwindKias: C208_REFERENCE.vdownwind,
    downwindFlapsDeg: 0,
    afterTakeoffKias: 110,
    restoreMinTas: 35,
    restoreFallbackTas: 60,
  },
  presets: {
    cold: {
      masterBattery: false,
      alternator: false,
      avionics: false,
      fuelPump: false,
      mixture: 0,
      magnetos: 0,
      lights: { nav: false, beacon: false, strobe: false, landing: false, taxi: false, panel: 0, dome: false },
    },
    groundRunning: GROUND_RUNNING,
    // Lined up: condition HIGH IDLE, strobes and landing lights on, taxi lights off.
    linedUp: { ...GROUND_RUNNING, mixture: 1, lights: { nav: true, beacon: true, strobe: true, landing: true, taxi: false, panel: 0.6, dome: false } },
    airborne: { mixture: 1, magnetos: 0, propeller: 1, lights: { nav: true, beacon: true, strobe: true, landing: false, taxi: false, panel: 0.6, dome: false } },
    // On approach: propeller MAX, condition HIGH IDLE (quick spool-up for a go-around).
    approach: { mixture: 1, propeller: 1, lights: { nav: true, beacon: true, strobe: true, landing: true, taxi: false, panel: 0.6, dome: false } },
  },
  autoflight: {
    takeoff: {
      // POH normal take-off: flaps 20, rotate at 70 KIAS, climb out at 85-95 and raise the flaps above 85.
      flapsDeg: 20,
      rotateKias: C208_REFERENCE.vr,
      rotatePitchDeg: [5, 9],
      rotateBlendKt: 8,
      elevatorBias: 0.2,
      pitchGain: 3,
      pitchRateGain: 1.2,
      aileronAliveKias: 40,
      handoverM: 20,
      throttle: TAKEOFF_LEVER,
    },
    climb: { kias: C208_REFERENCE.vy, vsLimit: 3, throttle: CLIMB_LEVER },
    hold: { minKias: 90, maxBankDeg: 25, vsLimit: 3 },
    // Flaps FULL at 78 KIAS: a small flare, mains first at about 65 KIAS.
    flare: { minHeightM: 6, timeS: 4, pitchRiseDeg: 8, maxPitchDeg: 8 },
    rollout: { brake: 0.8, noseHoldKias: [30, 70], noseHoldMax: 0.4 },
    steering: { kind: 'rudder' },
    centreline: { headingGain: 4, yawRateGain: 1.5, lookAheadM: 80 },
    phaseControls: {
      takeoff: { mixture: 1, propeller: 1 },
      climb: { mixture: 1, propeller: 1 },
      cruise: { mixture: 1, propeller: 1 },
      approach: { mixture: 1, propeller: 1 },
      rollout: { mixture: 1, propeller: 1 },
    },
  },
  takeoffTrim: { kias: C208_REFERENCE.vy, flapsDeg: 0 },
};
