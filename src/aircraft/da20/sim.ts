// Diamond DA20-C1: the sim profile (scenario start numbers, switch presets, the scripted pilot's numbers and the
// take-off trim). Speeds are the type's (reference.ts); the procedures are the AFM's chapter 4 and the circuit
// numbers common flying-school practice (s.10, s.11 of the type's data sheet, aircraft-data/da20.md in the design
// work folder).

import type { ControlPatch } from '../../core/types';
import type { SimProfile } from '../types';
import { DA20_REFERENCE } from './reference';

/**
 * Switch settings of an aircraft with the engine running on the ground (after the before-taxi checks, AFM 4.4.4):
 * the electric fuel pump ON for every low-power and ground operation (AFM 4.4.17), no beacon (the strobes are on
 * the wing tips), the fuel shut-off valve OPEN.
 */
const GROUND_RUNNING: ControlPatch = {
  masterBattery: true,
  alternator: true,
  avionics: true,
  fuelPump: true,
  fuelSelector: 'on',
  alternateAir: false,
  lights: { nav: true, beacon: false, strobe: false, landing: false, taxi: true, panel: 0.6, dome: false },
};

export const DA20_SIM: SimProfile = {
  scenario: {
    // 3 NM final at 65 KIAS with the flaps LDG (the school's normal final, s.11; the AFM's 55 is at 50 ft).
    finalKias: 65,
    finalFlapsDeg: 45,
    // Base with flaps LDG at 70 KIAS (s.11).
    baseFlapsDeg: 45,
    // 4500 ft MSL, trimmed at the training cruise (2500 rpm, reference.ts vcruise).
    cruiseKias: DA20_REFERENCE.vcruise,
    cruiseAltFt: 4500,
    // Mid-field left downwind at pattern altitude, clean, 90 KIAS (s.11).
    downwindKias: DA20_REFERENCE.vdownwind,
    downwindFlapsDeg: 0,
    // Speed held after the take-off's climb to pattern altitude.
    afterTakeoffKias: 90,
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
      alternateAir: false,
      lights: { nav: false, beacon: false, strobe: false, landing: false, taxi: false, panel: 0, dome: false },
    },
    groundRunning: GROUND_RUNNING,
    // Lined up: strobes and landing light on, taxi light off, fuel pump ON (AFM 4.4.7).
    linedUp: { ...GROUND_RUNNING, lights: { nav: true, beacon: false, strobe: true, landing: true, taxi: false, panel: 0.6, dome: false } },
    // In the air the pump is OFF in the cruise (AFM 4.4.9).
    airborne: { fuelPump: false, lights: { nav: true, beacon: false, strobe: true, landing: false, taxi: false, panel: 0.6, dome: false } },
    // Descent and approach: fuel pump ON (AFM 4.4.10, 4.4.11).
    approach: { fuelPump: true, lights: { nav: true, beacon: false, strobe: true, landing: true, taxi: false, panel: 0.6, dome: false } },
  },
  autoflight: {
    takeoff: {
      // Normal take-off, flaps T/O (AFM 4.4.7).
      flapsDeg: 15,
      // Rotate at 44 KIAS (AFM 4.4.7); the T-tail's elevator is weak at low speed and the rotation needs a definite
      // pull (s.11): the attitude comes up from 5 to 8 degrees over the next 8 kt, and it flies off at about 50 KIAS.
      rotateKias: DA20_REFERENCE.vr,
      rotatePitchDeg: [5, 8],
      rotateBlendKt: 8,
      elevatorBias: 0.15,
      pitchGain: 4,
      pitchRateGain: 1.2,
      aileronAliveKias: 35,
      handoverM: 15,
    },
    // Vy with flaps T/O, 68 KIAS (AFM 4.2): the autoflight leaves the take-off flaps out; the vertical-speed limit of
    // the level-off, m/s.
    climb: { kias: 68, vsLimit: 2.5 },
    // The A key: lowest speed held, bank limit, vertical-speed limit of the altitude capture.
    hold: { minKias: 65, maxBankDeg: 25, vsLimit: 3 },
    // Main wheels first, the nose held up; "fly the numbers": excess speed floats a long way (s.11). The tail skid
    // touches at about 12 degrees on the mains. The idle descent with flaps LDG is 5-7 degrees nose-down: the round-out
    // raises the nose 10 degrees, to 3-5 nose-up at 40-41 KIAS (with 8 it arrived flat, +0.6 degrees at 47 KIAS; with
    // 12 it stalled onto the runway at 1.1 m/s).
    flare: { minHeightM: 5, timeS: 4, pitchRiseDeg: 10, maxPitchDeg: 6 },
    rollout: {
      brake: 0.8,
      // The nose cannot be held off for long (s.11): the T-tail's elevator loses authority quickly.
      noseHoldKias: [30, 55],
      noseHoldMax: 0.5,
    },
    // The castering nosewheel: differential brake, blending to rudder as the rudder becomes effective (s.11).
    steering: { kind: 'differentialBrake', rudderEffectiveKias: 30, brakeGain: 1 },
    centreline: { headingGain: 4, yawRateGain: 1.5, lookAheadM: 60 },
    // Fuel pump ON for the take-off and the climb, OFF in the cruise, ON for the approach and landing (AFM 4.4).
    phaseControls: {
      takeoff: { fuelPump: true },
      climb: { fuelPump: true },
      cruise: { fuelPump: false },
      approach: { fuelPump: true },
      rollout: { fuelPump: true },
    },
  },
  // The take-off trim: the climb after take-off, Vy with flaps T/O (68 KIAS, AFM 4.2) at full power; the AFM's
  // "trim NEUTRAL" is about there.
  takeoffTrim: { kias: 68, flapsDeg: 15 },
};
