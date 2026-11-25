// Richard Pearse 1903 Monoplane: scenario start conditions, switch presets and scripted-pilot profile.

import type { ControlPatch } from '../../core/types';
import type { SimProfile } from '../types';
import { PEARSE_REFERENCE } from './reference';

const GROUND_RUNNING: ControlPatch = {
  masterBattery: true,
  alternator: true,
  avionics: true,
  fuelPump: false,
  fuelSelector: 'on',
  lights: { nav: true, beacon: false, strobe: false, landing: false, taxi: false, panel: 0.6, dome: false },
};

export const PEARSE_SIM: SimProfile = {
  scenario: {
    finalKias: PEARSE_REFERENCE.vapp,
    finalFlapsDeg: 8,
    baseFlapsDeg: 8,
    cruiseKias: PEARSE_REFERENCE.vcruise,
    // Low pioneer cruise altitude (2600 ft MSL, ~2200 ft above the valley floor), clear of foothills.
    cruiseAltFt: 2600,
    downwindKias: PEARSE_REFERENCE.vdownwind,
    downwindFlapsDeg: 0,
    afterTakeoffKias: 42,
    restoreMinTas: 15,
    restoreFallbackTas: 23,
  },
  presets: {
    cold: {
      masterBattery: false,
      alternator: false,
      avionics: false,
      fuelPump: false,
      lights: { nav: false, beacon: false, strobe: false, landing: false, taxi: false, panel: 0, dome: false },
    },
    groundRunning: GROUND_RUNNING,
    linedUp: { ...GROUND_RUNNING, lights: { nav: true, beacon: false, strobe: false, landing: true, taxi: false, panel: 0.6, dome: false } },
    airborne: { lights: { nav: true, beacon: false, strobe: false, landing: false, taxi: false, panel: 0.6, dome: false } },
    approach: { lights: { nav: true, beacon: false, strobe: false, landing: true, taxi: false, panel: 0.6, dome: false } },
  },
  autoflight: {
    takeoff: {
      flapsDeg: 0,
      rotateKias: PEARSE_REFERENCE.vr,
      rotatePitchDeg: [5.5, 9.0],
      rotateBlendKt: 4,
      elevatorBias: 0.28,
      pitchGain: 3.8,
      pitchRateGain: 1.1,
      aileronAliveKias: 20,
      handoverM: 8,
    },
    climb: { kias: PEARSE_REFERENCE.vx, vsLimit: 2.4 },
    hold: { minKias: 34, maxBankDeg: 20, vsLimit: 2.2 },
    flare: { minHeightM: 4.5, timeS: 3.5, pitchRiseDeg: 7, maxPitchDeg: 9 },
    rollout: {
      brake: 0.65,
      noseHoldKias: [15, 34],
      noseHoldMax: 0.35,
    },
    steering: { kind: 'rudder' },
    centreline: { headingGain: 3.5, yawRateGain: 1.4, lookAheadM: 45 },
    phaseControls: {},
  },
  takeoffTrim: { kias: PEARSE_REFERENCE.vy, flapsDeg: 0 },
};
