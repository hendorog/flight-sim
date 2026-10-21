// Lockheed AH-56A Cheyenne: the sim profile (scenario start numbers and switch presets). Owner: AG (stage 2).
//
// Every running preset holds the condition grip at RUN (the Nf governor flies the engine) with fuel on and the igniters
// off; the gear lever DOWN except in the air (the scenario builder sets the gear per start); the tail wheel locked for
// take-off and landing (P ASTA-72 para 79) and on the ground running; the parking brake off once running. Cold and dark:
// grip OFF, battery off, the parking brake set. Scenario speeds: the 85-95 KCAS autorotation band (P) and the pure
// helicopter's cruise (stage 2: 120 KIAS) until the compound (AC) raises them.
import type { ControlPatch } from '../../core/types';
import type { SimProfile } from '../types';
import { MD500_SIM } from '../md500/sim';

const LIGHTS_ON = { nav: true, beacon: true, strobe: true, landing: false, taxi: false, panel: 0.6, dome: false };
const RUNNING: ControlPatch = {
  masterBattery: true, alternator: true, avionics: true, fuelPump: false, fuelSelector: 'on',
  throttle: 1, mixture: 1, magnetos: 0, rotorGovernor: true, rotorClutch: true, n2Beep: 0, lights: LIGHTS_ON,
  tailWheelLock: true, parkingBrake: false,
};

export const AH56_SIM: SimProfile = {
  ...MD500_SIM,
  scenario: { ...MD500_SIM.scenario, finalKias: 60, cruiseKias: 120, cruiseAltFt: 1500, downwindKias: 80, afterTakeoffKias: 80 },
  presets: {
    cold: { ...MD500_SIM.presets.cold, tailWheelLock: true, parkingBrake: true, gearLever: 'down' },
    groundRunning: { ...RUNNING, gearLever: 'down' },
    linedUp: { ...RUNNING, gearLever: 'down', lights: { ...LIGHTS_ON, landing: true } },
    airborne: RUNNING,
    approach: { ...RUNNING, lights: { ...LIGHTS_ON, landing: true } },
  },
};
