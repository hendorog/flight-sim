// Piper PA-38-112 Tomahawk II: the sim profile (scenario start numbers, switch presets, the scripted pilot's numbers
// and the take-off trim). Speeds are the type's (reference.ts); the procedures are the POH's (s.10 of the type's data
// sheet, aircraft-data/pa38.md in the design work folder), the circuit numbers common flying-school practice
// (s.10, s.11).

import type { ControlPatch } from '../../core/types';
import type { SimProfile } from '../types';
import { PA38_REFERENCE } from './reference';

/** Switch settings of an aircraft with the engine running on the ground (after the after-start checks). */
const GROUND_RUNNING: ControlPatch = {
  masterBattery: true,
  alternator: true,
  avionics: true,
  // The electric pump is off after the start (POH 4.13).
  fuelPump: false,
  fuelSelector: 'left',
  carbHeat: 0,
  lights: { nav: true, beacon: false, strobe: false, landing: false, taxi: false, panel: 0.6, dome: false },
};

export const PA38_SIM: SimProfile = {
  scenario: {
    // 3 NM final at 70 KIAS with the first notch of flap (POH 4.5: trim to 70; full flap and 67 once the field is
    // made, s.10).
    finalKias: PA38_REFERENCE.vapp,
    finalFlapsDeg: 21,
    baseFlapsDeg: 21,
    // 4500 ft MSL, trimmed at a normal cruise just under 75 %.
    cruiseKias: PA38_REFERENCE.vcruise,
    cruiseAltFt: 4500,
    // Mid-field left downwind at pattern altitude, clean, 80 KIAS (the bottom of the school's 80-85, below Vfe 89).
    downwindKias: PA38_REFERENCE.vdownwind,
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
    // Lined up: the before-take-off checks done, electric fuel pump ON (POH 4.5), strobes and landing light on.
    linedUp: { ...GROUND_RUNNING, fuelPump: true, lights: { nav: true, beacon: false, strobe: true, landing: true, taxi: false, panel: 0.6, dome: false } },
    // In the cruise the electric pump is off (switched off at the cruise altitude, POH 4.5).
    airborne: { fuelPump: false, lights: { nav: true, beacon: false, strobe: true, landing: false, taxi: false, panel: 0.6, dome: false } },
    // Before landing: electric fuel pump ON (POH 4.5); carburettor heat only if icing is suspected.
    approach: { fuelPump: true, lights: { nav: true, beacon: false, strobe: true, landing: true, taxi: false, panel: 0.6, dome: false } },
  },
  autoflight: {
    takeoff: {
      // Normal take-off, flaps up (POH 4.5).
      flapsDeg: 0,
      // Rotate at 53 KIAS (POH 4.5); the Tomahawk sits level on its wheels, so the attitude comes up from 6 to 9
      // degrees over the next 6 kt: it flies off at about 55-57 KIAS.
      rotateKias: PA38_REFERENCE.vr,
      rotatePitchDeg: [6, 9],
      rotateBlendKt: 6,
      elevatorBias: 0.25,
      pitchGain: 4,
      pitchRateGain: 1.2,
      aileronAliveKias: 35,
      handoverM: 15,
    },
    // Vy, and the vertical-speed limit of the level-off, m/s.
    climb: { kias: PA38_REFERENCE.vy, vsLimit: 2.5 },
    // The A key: lowest speed held, bank limit, vertical-speed limit of the altitude capture.
    hold: { minKias: 65, maxBankDeg: 25, vsLimit: 3 },
    // Main wheels first, nose high (s.10: "touch down near the stall on the mains, hold the nose wheel off"). The
    // throttle closes as the flare begins and the flapped Tomahawk loses its speed fast, so the round-out starts low
    // (about 10 ft): from the 70 KIAS final, touchdown at about 55 KIAS, 7-8 degrees nose-up, sinking 0.6-0.7 m/s,
    // the nose wheel 0.4 s later. Begun at 7 m it ran out of speed above the runway (1.7-1.9 m/s at 51 KIAS).
    flare: { minHeightM: 3, timeS: 2, pitchRiseDeg: 12, maxPitchDeg: 12 },
    rollout: {
      brake: 0.8,
      noseHoldKias: [25, 60],
      noseHoldMax: 0.5,
    },
    // The pedals steer the nosewheel.
    steering: { kind: 'rudder' },
    centreline: { headingGain: 4, yawRateGain: 1.5, lookAheadM: 60 },
    // The electric fuel pump ON for the take-off and climb, OFF in the cruise, ON again for the approach and OFF after
    // landing (POH 4.5); carburettor heat cold throughout (POH 4.29: only when icing is suspected).
    phaseControls: {
      takeoff: { fuelPump: true, carbHeat: 0 },
      climb: { fuelPump: true, carbHeat: 0 },
      cruise: { fuelPump: false, carbHeat: 0 },
      approach: { fuelPump: true, carbHeat: 0 },
      rollout: { fuelPump: false, carbHeat: 0 },
    },
  },
  takeoffTrim: { kias: PA38_REFERENCE.vy, flapsDeg: 0 },
};
