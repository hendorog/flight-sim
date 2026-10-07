// Cessna 172S: the sim profile (scenario start numbers, switch presets, the scripted pilot's numbers and the
// take-off trim). src/sim reads it: scenarios.ts, starts.ts and autoflight.ts build every start and fly every
// phase from a profile of this shape, and keep their old constant names as views of this one
// (tests/aircraft/leaves.A2-sim.test.ts).

import type { ControlPatch } from '../../core/types';
import type { SimProfile } from '../types';
import { C172S_REFERENCE } from './reference';

/** Switch settings of an aircraft with the engine running on the ground (after the after-start checks). */
const GROUND_RUNNING: ControlPatch = {
  masterBattery: true,
  alternator: true,
  avionics: true,
  fuelPump: false,
  fuelSelector: 'both',
  lights: { nav: true, beacon: true, strobe: false, landing: false, taxi: true, panel: 0.6, dome: false },
};

export const C172S_SIM: SimProfile = {
  scenario: {
    // 3 NM final at 70 KIAS with the flaps at the 20 degree detent.
    finalKias: 70,
    finalFlapsDeg: 20,
    // A base-leg start that names no flap setting.
    baseFlapsDeg: 20,
    // 4500 ft MSL (below the default 1500 m cloud base), trimmed at about 110 KIAS.
    cruiseKias: 110,
    cruiseAltFt: 4500,
    // Mid-field left downwind at pattern altitude, clean.
    downwindKias: 90,
    downwindFlapsDeg: 0,
    // Speed held after the take-off's climb to pattern altitude.
    afterTakeoffKias: 90,
    // The trim that precedes a restore: at least 25 m/s TAS, and 50 m/s if the trim near the saved speed fails.
    restoreMinTas: 25,
    restoreFallbackTas: 50,
  },
  presets: {
    // Cold and dark, as the 'apron' scenario.
    cold: {
      masterBattery: false,
      alternator: false,
      avionics: false,
      fuelPump: false,
      lights: { nav: false, beacon: false, strobe: false, landing: false, taxi: false, panel: 0, dome: false },
    },
    groundRunning: GROUND_RUNNING,
    // Lined up: strobes and landing light on, taxi light off (the before-take-off checks done).
    linedUp: { ...GROUND_RUNNING, lights: { nav: true, beacon: true, strobe: true, landing: true, taxi: false, panel: 0.6, dome: false } },
    // In flight: everything on that a pilot has on in the air.
    airborne: { lights: { nav: true, beacon: true, strobe: true, landing: false, taxi: false, panel: 0.6, dome: false } },
    approach: { lights: { nav: true, beacon: true, strobe: true, landing: true, taxi: false, panel: 0.6, dome: false } },
  },
  autoflight: {
    takeoff: {
      // Flaps up.
      flapsDeg: 0,
      // Lift the nose wheel at 55 KIAS (POH); the attitude comes up from 4 to 8 degrees over the next 6 kt.
      rotateKias: 55,
      rotatePitchDeg: [4, 8],
      rotateBlendKt: 6,
      // Rotation law: elevator per rad of pitch error, per rad/s of pitch rate, and the steady pull.
      elevatorBias: 0.3,
      pitchGain: 5,
      pitchRateGain: 1.5,
      // The ailerons hold the wings level in the take-off roll above this speed.
      aileronAliveKias: 40,
      handoverM: 15,
    },
    // Vy, and the vertical-speed limit of the level-off at the plan's altitude, m/s.
    climb: { kias: C172S_REFERENCE.vy, vsLimit: 3 },
    // The A key: lowest speed held, bank limit, vertical-speed limit of the altitude capture.
    hold: { minKias: 65, maxBankDeg: 25, vsLimit: 3.5 },
    flare: { minHeightM: 6, timeS: 3, pitchRiseDeg: 7, maxPitchDeg: 10 },
    rollout: {
      brake: 0.8,
      // The nose-holding elevator is clamp((kias - 25) / 40, 0, 0.5).
      noseHoldKias: [25, 65],
      noseHoldMax: 0.5,
    },
    // The pedals steer the nosewheel.
    steering: { kind: 'rudder' },
    centreline: { headingGain: 4, yawRateGain: 1.5, lookAheadM: 60 },
    // Nothing to configure by phase: fixed gear, fixed pitch, no carburettor heat, no cowl flaps.
    phaseControls: {},
  },
  takeoffTrim: { kias: C172S_REFERENCE.vy, flapsDeg: 0 },
};
