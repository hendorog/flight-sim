// MD 500E (369E): the sim profile (scenario start numbers and switch presets). Owner: T2.
//
// Every running preset holds the twist grip FULL OPEN (the N2 governor flies the engine, RFM 4-17: "Twistgrip FULL
// OPEN" before run-up) with fuel on, the igniter switch off (the auto-reignition fires it when needed) and the
// generator on. Cold and dark: grip CUTOFF, battery off. The fixed-wing autoflight block is never used by a
// rotorcraft (the helicopter hold is sim/rotorcraft/autopilot.ts); it is the C152's, as the other helicopters'.
import type { ControlPatch } from '../../core/types';
import type { SimProfile } from '../types';
import { C152_SIM } from '../c152/sim';
import { MD500_REFERENCE as V } from './reference';

const LIGHTS_ON = { nav: true, beacon: true, strobe: true, landing: false, taxi: false, panel: 0.6, dome: false };
/** Engine running, grip FULL OPEN, governed; generator on, start pump off, fuel valve open. */
const RUNNING: ControlPatch = {
  masterBattery: true, alternator: true, avionics: true, fuelPump: false, fuelSelector: 'on',
  throttle: 1, mixture: 1, magnetos: 0, rotorGovernor: true, rotorClutch: true, n2Beep: 0, lights: LIGHTS_ON,
};

export const MD500_SIM: SimProfile = {
  ...C152_SIM,
  scenario: {
    // RFM 4-24: the normal approach at about 60 KIAS; cruise 120 KIAS (spec p7: max-range speed); downwind 80.
    finalKias: 60, finalFlapsDeg: 0, baseFlapsDeg: 0,
    cruiseKias: 120, cruiseAltFt: 1500,
    downwindKias: 80, downwindFlapsDeg: 0,
    afterTakeoffKias: V.vy,
    restoreMinTas: 0, restoreFallbackTas: 0,
  },
  presets: {
    cold: {
      masterBattery: false, alternator: false, avionics: false, fuelPump: false, fuelSelector: 'on',
      throttle: 0, mixture: 1, magnetos: 0, rotorGovernor: true, rotorClutch: true, starter: false,
      lights: { nav: false, beacon: false, strobe: false, landing: false, taxi: false, panel: 0, dome: false },
    },
    groundRunning: RUNNING,
    linedUp: { ...RUNNING, lights: { ...LIGHTS_ON, landing: true } },
    airborne: RUNNING,
    approach: { ...RUNNING, lights: { ...LIGHTS_ON, landing: true } },
  },
};
