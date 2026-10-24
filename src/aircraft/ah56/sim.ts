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

// The pilot's cyclic for the lift-off (tuning round 2, KNOWN_ISSUES T9; D from the 3 ft IGE hover trim, typical load: 0.058 / -0.028
// of the travel): on the wheels the trim leaves the stick at 0, about 0.06 forward of the hover's, and the keyboard cyclic re-centres
// there, so a keyboard lift-off left the ground nose 2-2.5 deg low and running forward at 1-2 kt/s (W/tune/ah56/r2 out/
// p3_lifttrace.log). Set where a pilot holds it before raising the collective, it sits still on the wheels (20 s hands off, brakes off:
// 0 m, 0.2 deg) and lifts nose -0.4 deg. The ground starts only (cold too): the airborne and approach starts keep their trim. The pedal
// is not preset: at the hover's 0.38 left on the ground, with the collective down, the tail rotor turned the aircraft 36 deg on its
// locked tail wheel in 20 s (out/p1_trim.log); the STAB ASSIST's heading hold takes it as the wheels unload.
const LIFT_OFF_CYCLIC: ControlPatch = { elevator: 0.06, aileron: -0.03 };

export const AH56_SIM: SimProfile = {
  ...MD500_SIM,
  scenario: { ...MD500_SIM.scenario, finalKias: 60, cruiseKias: 120, cruiseAltFt: 1500, downwindKias: 80, afterTakeoffKias: 80 },
  presets: {
    cold: { ...MD500_SIM.presets.cold, ...LIFT_OFF_CYCLIC, tailWheelLock: true, parkingBrake: true, gearLever: 'down' },
    groundRunning: { ...RUNNING, ...LIFT_OFF_CYCLIC, gearLever: 'down' },
    linedUp: { ...RUNNING, ...LIFT_OFF_CYCLIC, gearLever: 'down', lights: { ...LIGHTS_ON, landing: true } },
    airborne: RUNNING,
    approach: { ...RUNNING, lights: { ...LIGHTS_ON, landing: true } },
  },
};
