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
import { AH56_INPUT } from './input';

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
  // The hold (A; src/sim/rotorcraft/autopilot.ts HeliHoldTuning; KNOWN_ISSUES "Hold autopilot", docs/ah56-integration.md
  // section 16). AGENT choices for the owner (no helicopter experience, laptop), measured headlessly through SimPhysics +
  // InputSystem (W/rigid/ah56ap notes.md).
  heliHold: {
    // The shared inner loop (4 per rad, 1.5 per rad/s, trim 0.8: the R22 family's position-command cyclic) sawed the AMCS's
    // rate-command stick at the 1/s hand-rate limit: +/-0.3 of the stick, the aircraft rocking +/-3 deg in pitch and roll about
    // once a second at every speed. Roll damping 0.8 still cycles in the hover (0.6 s); 0.4 holds with twice that margin.
    // The ICS keeps the shared gains (rock steady with them: pitch range 0.07 deg in the hover).
    inner: { amcs: { pitchGain: 2, pitchDamping: 0.6, pitchLearning: 0.3, rollGain: 2, rollDamping: 0.4, rollLearning: 0.3, cyclicRate: 1 } },
    // Heading-bug turns at a standard rate (3 deg/s) with the bank for it (up to 25 deg, rolled at 5 deg/s) and the ball centred
    // from 20 KIAS up (back to the shared pedal turn below 15 and in the hover hold): the shared law slewed the heading on the pedals at every speed
    // (a 180 at 60 KIAS: 38 deg of sideslip, the pedal on its stop, +/-14 kt).
    turns: { onKias: 20, offKias: 15, rateDegS: 3, headingGain: 0.25, maxBankDeg: 25, rollRateDegS: 5, slipGain: 1, trimLearning: 0.2 },
    // The ASI's speed above 40 KIAS (the shared law holds the forward ground speed: 113 kt over the ground with the ASI at
    // 96-100 in a 12 kt crosswind), walked at 2 kt/s to a new value instead of stepping (a 100 -> 130 kt step: 36 deg of pitch).
    airspeedAboveKias: 40, speedRateKtS: 2,
    // Climb and descent at up to 2 m/s, the demand walked at 0.3 m/s per s (engaged in a 2 m/s climb: levels off where that
    // walk ends instead of a collective step and a 12 deg roll kick).
    climb: { accel: 0.3, heightGain: 0.3, maxClimb: 2, liftGain: 0.1, liftLearning: 0.05 },
    // The pusher grip on the PROP SCHEDULE's table at the held speed (the hover detent below 30 kt).
    pusher: { kias: AH56_INPUT.propLever!.schedule!.kias, lever: AH56_INPUT.propLever!.schedule!.lever, ratePerS: 0.1 },
    // The keyboard stick's spring-trim anchor walked to the hold's stick, so A off leaves the stick where the hold had it.
    trimFollowUp: { tauS: 2 },
    // Engaged drifting in the hover: stop at 0.5 m/s per s and hold where it stopped.
    hoverCapture: { decel: 0.5, minMs: 1.5 },
  },
  presets: {
    cold: { ...MD500_SIM.presets.cold, ...LIFT_OFF_CYCLIC, tailWheelLock: true, parkingBrake: true, gearLever: 'down' },
    groundRunning: { ...RUNNING, ...LIFT_OFF_CYCLIC, gearLever: 'down' },
    linedUp: { ...RUNNING, ...LIFT_OFF_CYCLIC, gearLever: 'down', lights: { ...LIGHTS_ON, landing: true } },
    airborne: RUNNING,
    approach: { ...RUNNING, lights: { ...LIGHTS_ON, landing: true } },
  },
};
