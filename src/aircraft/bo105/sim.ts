// MBB Bo 105 CB-4: the sim profile (scenario start numbers and switch presets). Owner: BO.
//
// Every running preset has both power levers at FLIGHT (ControlInputs.throttle, the scalar both levers follow until one
// is moved on its own; P5 FM 4-16 "power levers smoothly to FLIGHT" before take-off), the four fuel pumps on (P5 FM 4-9:
// "fuel pumps (4) ON" for the start and in flight; the panel's fuel-pump switch), the ignition off (P5 FM 4-11: off at
// 58 % N1 with the starter), both generators on and the battery on. Cold and dark: levers OFF, battery off. The N2 set
// point is the governor's state, not a switch: every running reset holds 100 % (P5 FM 4-17, "100 % recommended for
// steady flight"); the pre-take-off "N2 trim to 98 %" (FM 4-16) is the pilot's beep. The fixed-wing autoflight block is
// never used by a rotorcraft (the helicopter hold is sim/rotorcraft/autopilot.ts); it is the C152's, as the other
// helicopters'.
import type { ControlPatch } from '../../core/types';
import type { SimProfile } from '../types';
import { C152_SIM } from '../c152/sim';
import { BO105_REFERENCE as V } from './reference';

const LIGHTS_ON = { nav: true, beacon: true, strobe: true, landing: false, taxi: false, panel: 0.6, dome: false };
/** Both levers FLIGHT, governed; generators and fuel pumps on, ignition off. */
const RUNNING: ControlPatch = {
  masterBattery: true, alternator: true, avionics: true, fuelPump: true, fuelSelector: 'on',
  throttle: 1, mixture: 1, magnetos: 0, rotorGovernor: true, rotorClutch: true, n2Beep: 0, n2BeepSplit: 0, lights: LIGHTS_ON,
};

export const BO105_SIM: SimProfile = {
  ...C152_SIM,
  scenario: {
    // P5 FM 3-24 / Section 5: approach at 60 KIAS; take-off to 50 ft at 50 KIAS then Vy 60; cruise start 100 KIAS
    // (ESTIMATE near the FM range example's 90 KCAS); downwind 80 KIAS.
    finalKias: V.approachKias, finalFlapsDeg: 0, baseFlapsDeg: 0,
    cruiseKias: V.cruiseKias, cruiseAltFt: 1500,
    downwindKias: V.downwindKias, downwindFlapsDeg: 0,
    afterTakeoffKias: V.vy,
    restoreMinTas: 0, restoreFallbackTas: 0,
  },
  presets: {
    cold: {
      masterBattery: false, alternator: false, avionics: false, fuelPump: false, fuelSelector: 'on',
      throttle: 0, mixture: 1, magnetos: 0, rotorGovernor: true, rotorClutch: true, starter: false, n2Beep: 0, n2BeepSplit: 0,
      lights: { nav: false, beacon: false, strobe: false, landing: false, taxi: false, panel: 0, dome: false },
    },
    groundRunning: RUNNING,
    linedUp: { ...RUNNING, lights: { ...LIGHTS_ON, landing: true } },
    airborne: RUNNING,
    approach: { ...RUNNING, lights: { ...LIGHTS_ON, landing: true } },
  },
  // The hover hold (A) engaged below 30 kt of ground speed slows to a hover at 1.5 kt/s and holds the position there (the
  // tune pass, item 1; a sim aid for the keyboard beginner's deceleration, W/tune/bo105 c_aslow.log): engaged by the
  // tapping beginner at 30 / 25 / 15 kt it reached the hover 9-19 s later with the attitude within 15 deg, not lost
  // (1 kt/s: 11-28 s; 3 kt/s: up to 16 deg). Above 30 kt it holds the speed it was engaged at, as every helicopter's.
  // ESTIMATE (the rate is gentler than ADS-33E's deceleration MTE; the band is the STAB ASSIST's full-gain band).
  heliHoldSlowToHover: { belowKt: 30, ktPerS: 1.5 },
  // Faster than that it holds the speed over the ground it was engaged at, not that speed's part along the nose (tune pass
  // 2 fix; W/tune2/bo105 fix1 f_hold, the pass-2 gate's g10): the by-hand acceleration ends sliding 35 kt sideways at 42
  // kt (the pedal at its stop), and A then held 22.7 kt; now 42 (41.9 KIAS calm 40 s later). A sim convenience.
  heliHoldGroundSpeed: true,
  // The hover scenario (hover=1) starts into the wind, trimmed at the wind's speed, still over the ground (the tune pass,
  // item 2: in the default 8 kt it started at 11.1 kt of ground speed with the air mass and the round-2 gate's beginner
  // crashed at 14-15 s; W/tune/bo105 j_wind.log). A sim convenience: a pilot hovers into the wind.
  hoverIntoWind: true,
};
