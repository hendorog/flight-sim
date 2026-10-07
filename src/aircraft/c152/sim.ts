// Cessna 152 (1978 model): the sim profile (scenario start numbers, switch presets, the scripted pilot's numbers
// and the take-off trim). Speeds are the type's (reference.ts); the circuit numbers are common flying-school
// practice (s.10, s.11 of the type's data sheet, aircraft-data/c152.md in the design work folder).

import type { ControlPatch } from '../../core/types';
import type { SimProfile } from '../types';
import { C152_REFERENCE } from './reference';

/** Switch settings of an aircraft with the engine running on the ground (after the after-start checks). */
const GROUND_RUNNING: ControlPatch = {
  masterBattery: true,
  alternator: true,
  avionics: true,
  fuelPump: false,
  // The ON / OFF shut-off valve (s.9).
  fuelSelector: 'on',
  carbHeat: 0,
  lights: { nav: true, beacon: true, strobe: false, landing: false, taxi: true, panel: 0.6, dome: false },
};

export const C152_SIM: SimProfile = {
  scenario: {
    // 3 NM final at 65 KIAS with the flaps at 20 degrees (the school's base and early final, s.10).
    finalKias: C152_REFERENCE.vapp,
    finalFlapsDeg: 20,
    baseFlapsDeg: 20,
    // 4500 ft MSL, trimmed at the cruise speed of 2300-2400 rpm.
    cruiseKias: C152_REFERENCE.vcruise,
    cruiseAltFt: 4500,
    // Mid-field left downwind at pattern altitude, clean, 80 KIAS (the bottom of the school's 80-90, below Vfe).
    downwindKias: 80,
    downwindFlapsDeg: 0,
    // Speed held after the take-off's climb to pattern altitude.
    afterTakeoffKias: 80,
    // The trim that precedes a restore: at least 25 m/s TAS, and 45 m/s if the trim near the saved speed fails.
    restoreMinTas: 25,
    restoreFallbackTas: 45,
  },
  presets: {
    // Cold and dark, as the 'apron' scenario.
    cold: {
      masterBattery: false,
      alternator: false,
      avionics: false,
      fuelPump: false,
      carbHeat: 0,
      lights: { nav: false, beacon: false, strobe: false, landing: false, taxi: false, panel: 0, dome: false },
    },
    groundRunning: GROUND_RUNNING,
    // Lined up: strobes and landing light on, taxi light off (the before-take-off checks done).
    linedUp: { ...GROUND_RUNNING, lights: { nav: true, beacon: true, strobe: true, landing: true, taxi: false, panel: 0.6, dome: false } },
    airborne: { lights: { nav: true, beacon: true, strobe: true, landing: false, taxi: false, panel: 0.6, dome: false } },
    // On approach the carburettor heat is hot (s.10: full heat before closing the throttle).
    approach: { carbHeat: 1, lights: { nav: true, beacon: true, strobe: true, landing: true, taxi: false, panel: 0.6, dome: false } },
  },
  autoflight: {
    takeoff: {
      // Normal take-off, flaps up (0-10, POH sect. 4).
      flapsDeg: 0,
      // Lift the nose wheel at 50 KIAS (POH); the attitude comes up from 6 to 10 degrees over the next 6 kt (the
      // 152 sits 3.5 degrees nose-up on its wheels): it flies off at about 54 KIAS.
      rotateKias: C152_REFERENCE.vr,
      rotatePitchDeg: [6, 10],
      rotateBlendKt: 6,
      elevatorBias: 0.25,
      pitchGain: 4,
      pitchRateGain: 1.2,
      aileronAliveKias: 35,
      handoverM: 15,
    },
    // Vy, and the vertical-speed limit of the level-off, m/s.
    climb: { kias: C152_REFERENCE.vy, vsLimit: 2.5 },
    // The A key: lowest speed held, bank limit, vertical-speed limit of the altitude capture.
    hold: { minKias: 60, maxBankDeg: 25, vsLimit: 3 },
    // Main wheels first, nose high, near 45-50 KIAS (POH sect. 4): the 152 comes down the approach at about 0 degrees
    // of pitch, below its 3.5 degree ground attitude, so the round-out starts higher and raises the nose further
    // than the 172's (touchdown about 47 KIAS, 7 degrees, from the 65 KIAS final); the tail meets the ground at 15.
    flare: { minHeightM: 6, timeS: 4, pitchRiseDeg: 12, maxPitchDeg: 11 },
    rollout: {
      brake: 0.8,
      noseHoldKias: [25, 60],
      noseHoldMax: 0.5,
    },
    // The pedals steer the nosewheel.
    steering: { kind: 'rudder' },
    centreline: { headingGain: 4, yawRateGain: 1.5, lookAheadM: 60 },
    // Carburettor heat cold for the take-off, the climb and the cruise; hot on the approach (s.10); cold after landing.
    phaseControls: {
      takeoff: { carbHeat: 0 },
      climb: { carbHeat: 0 },
      cruise: { carbHeat: 0 },
      approach: { carbHeat: 1 },
      rollout: { carbHeat: 0 },
    },
  },
  takeoffTrim: { kias: C152_REFERENCE.vy, flapsDeg: 0 },
};
