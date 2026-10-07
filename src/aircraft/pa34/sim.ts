// Piper PA-34-200 Seneca I: the sim profile (scenario start numbers, switch presets, the scripted pilot's numbers
// and the take-off trim). Speeds are the type's (reference.ts); the procedures are the handbook's and the AFM's
// (s.10 of the type's data sheet, aircraft-data/pa34.md in the design work folder), the circuit numbers a flying
// school's MEP syllabus (s.11).

import type { ControlPatch } from '../../core/types';
import type { SimProfile } from '../types';
import { PA34_REFERENCE } from './reference';

/** Propeller lever for `rpm` in the governing range (1700 rpm at the feather gate, 2700 at the stop; powerplant.ts). */
const propellerFor = (rpm: number) => 0.08 + (0.92 * (rpm - 1700)) / 1000;

/** Switch settings of an aircraft with both engines running on the ground (after the after-start checks). */
const GROUND_RUNNING: ControlPatch = {
  masterBattery: true,
  alternator: true,
  avionics: true,
  // The electric pumps are off after the start (s.10).
  fuelPump: false,
  fuelSelector: 'on',
  // Cowl flaps open on the ground; alternate air off (s.10).
  cowlFlaps: 1,
  alternateAir: false,
  propeller: 1,
  gearLever: 'down',
  lights: { nav: true, beacon: true, strobe: false, landing: false, taxi: false, panel: 0.6, dome: false },
};

export const PA34_SIM: SimProfile = {
  scenario: {
    // 3 NM final at blue line with 25 degrees of flap (base with 25 at 105 mph; 40 only once the landing is
    // assured, s.10).
    finalKias: PA34_REFERENCE.vapp,
    finalFlapsDeg: 25,
    baseFlapsDeg: 25,
    // 6500 ft MSL, trimmed at a normal cruise of about 65-75 %.
    cruiseKias: PA34_REFERENCE.vcruise,
    cruiseAltFt: 6500,
    // Mid-field left downwind at pattern altitude, gear down (s.11: "gear down mid-field"), 100 KIAS, flaps up.
    downwindKias: PA34_REFERENCE.vdownwind,
    downwindFlapsDeg: 0,
    // Speed held after the take-off's climb to pattern altitude: the cruise climb's 120 mph.
    afterTakeoffKias: 104,
    // The trim that precedes a restore: at least 35 m/s TAS, and 50 m/s if the trim near the saved speed fails.
    restoreMinTas: 35,
    restoreFallbackTas: 50,
  },
  presets: {
    // Cold and dark, as the 'apron' scenario.
    cold: {
      masterBattery: false,
      alternator: false,
      avionics: false,
      fuelPump: false,
      cowlFlaps: 1,
      alternateAir: false,
      gearLever: 'down',
      lights: { nav: false, beacon: false, strobe: false, landing: false, taxi: false, panel: 0, dome: false },
    },
    groundRunning: GROUND_RUNNING,
    // Lined up: the before-take-off checks done, electric fuel pumps ON, propellers full forward, cowl flaps open
    // (s.10); strobes and landing light on.
    linedUp: { ...GROUND_RUNNING, fuelPump: true, lights: { nav: true, beacon: true, strobe: true, landing: true, taxi: false, panel: 0.6, dome: false } },
    // In the cruise: pumps off, cowl flaps closed, 2400 rpm and the mixtures leaned (s.10), gear up. The lever is
    // best power at the cruise start's 6500 ft (0.67, about 9.6 US gal/h a side at 145 KIAS) and at the 1500 ft
    // downwind just rich of peak (best power there 0.76); the approach preset puts it rich again.
    airborne: {
      fuelPump: false,
      cowlFlaps: 0,
      propeller: propellerFor(2400),
      mixture: 0.7,
      gearLever: 'up',
      lights: { nav: true, beacon: true, strobe: true, landing: false, taxi: false, panel: 0.6, dome: false },
    },
    // Before landing (s.10): pumps ON, mixtures rich, propellers 2500 then full forward on short final, gear down,
    // cowl flaps as required (half).
    approach: {
      fuelPump: true,
      mixture: 1,
      propeller: 1,
      cowlFlaps: 0.5,
      gearLever: 'down',
      lights: { nav: true, beacon: true, strobe: true, landing: true, taxi: false, panel: 0.6, dome: false },
    },
  },
  autoflight: {
    takeoff: {
      // Normal take-off, flaps up (s.10).
      flapsDeg: 0,
      // Rotate at 80-85 mph (contract 5.4: 72 KIAS); the attitude comes up from 6 to 9 degrees over the next 6 kt.
      rotateKias: PA34_REFERENCE.vr,
      rotatePitchDeg: [6, 9],
      rotateBlendKt: 6,
      elevatorBias: 0.25,
      pitchGain: 4,
      pitchRateGain: 1.2,
      aileronAliveKias: 45,
      handoverM: 15,
    },
    // Vy, both engines (contract 5.4: climb 91), and the vertical-speed limit of the level-off, m/s.
    climb: { kias: PA34_REFERENCE.vy, vsLimit: 3 },
    // The A key: lowest speed held (blue line), bank limit, vertical-speed limit of the altitude capture.
    hold: { minKias: PA34_REFERENCE.vyse!, maxBankDeg: 25, vsLimit: 3 },
    // Mains first with the nose held off ("heavy pull in the flare", s.11): the round-out at about 23 ft, the power
    // off as it begins. From the 'final' scenario (91 KIAS): touchdown at 61-63 KIAS, 5-6 degrees nose-up, sinking
    // 0.5-0.8 m/s, the nose wheel 0.3 s later (an 8 degree rise from 6 m put all three wheels down together at 73 KIAS).
    flare: { minHeightM: 7, timeS: 3, pitchRiseDeg: 15, maxPitchDeg: 9 },
    rollout: {
      brake: 0.8,
      noseHoldKias: [35, 70],
      noseHoldMax: 0.5,
    },
    // The pedals steer the nosewheel.
    steering: { kind: 'rudder' },
    centreline: { headingGain: 4, yawRateGain: 1.5, lookAheadM: 60 },
    // s.10: electric pumps ON, propellers forward and cowl flaps open for the take-off; gear up once climbing, the
    // pumps off in the cruise with the cowl flaps closed; for the approach pumps on, mixtures rich, propellers
    // forward, cowl flaps half, gear down; after landing the pumps off and the cowl flaps open.
    phaseControls: {
      takeoff: { fuelPump: true, propeller: 1, cowlFlaps: 1, gearLever: 'down' },
      climb: { fuelPump: true, propeller: 1, cowlFlaps: 1, gearLever: 'up' },
      cruise: { fuelPump: false, cowlFlaps: 0 },
      approach: { fuelPump: true, mixture: 1, propeller: 1, cowlFlaps: 0.5, gearLever: 'down' },
      rollout: { fuelPump: false, cowlFlaps: 1 },
    },
  },
  takeoffTrim: { kias: PA34_REFERENCE.vy, flapsDeg: 0 },
};
