// Pilatus PC-12/47: the input profile (which levers and switches exist, the flap detents, the fuel cycle and the
// tuning of the keyboard assists). Plain data.
//
// The quadrant on the existing controls (plan sect. 0): the throttle keys move the POWER CONTROL LEVER forward of the
// idle gate; aft of it the reverse input (ControlInputs.reverse: beta, then reverse; keyboard and hardware binding by
// the input package) moves it into the ground range; the mixture keys move the CONDITION lever (CUT-OFF/FEATHER,
// GROUND IDLE, FLIGHT IDLE), a detent a press: back stops at GROUND IDLE, and CUT-OFF takes a fresh press there held
// for a second (InputProfile.conditionDetents). There is no propeller lever (the governor holds 1700 rpm; feathering is the condition
// lever's), so no propeller or feather keys. The STARTER is a press switch that latches (powerplant.ts); the magneto
// keys work the IGNITION switch ('toggles'). The assists are the C208's with the speeds scaled by the ratio of the
// clean stall speeds, 97 / 70 KCAS.

import type { InputProfile } from '../types';

/** Clean stall (pusher) speed of the PC-12 over the C208's (KCAS). */
const STALL_RATIO = 97 / 70;
/** The C208's assists' speeds over the Cessna 152's (c208/input.ts). */
const C208_RATIO = 70 / 48;

export const PC12_INPUT: InputProfile = {
  engines: 1,
  // 0, 15, 30, 40 deg of 40.
  flapDetents: [0, 15 / 40, 30 / 40, 1],
  // Both wings feeding, left only, right only, FUEL EMERG SHUT OFF.
  fuelSelectorCycle: ['on', 'left', 'right', 'off'],
  ignition: 'toggles',
  has: {
    mixture: true,
    propeller: false,
    feather: false,
    reverse: true,
    carbHeat: false,
    alternateAir: false,
    cowlFlaps: false,
    gear: true,
    rudderTrim: true,
    fuelPump: true,
  },
  // The condition lever's detents: CUT-OFF/FEATHER 0, GROUND IDLE at turbineEngine CUTOFF_BELOW (0.1, sim.ts
  // PC12_GROUND_IDLE), FLIGHT IDLE 1.
  conditionDetents: { groundIdle: 0.1 },
  // PUSHER INTR on the control wheel (Shift+D) and the overhead STARTER INTERRUPT switch (Shift+N), both held.
  pusherInterrupt: true,
  starterInterrupt: true,
  assists: {
    axes: {
      aileron: { baseRate: 0.2, maxRate: 1.0, accelTime: 1.2, accelExponent: 2, reverseGain: 1.3, fullAuthoritySpeed: 33 * (48 / 53) * C208_RATIO * STALL_RATIO, authorityExponent: 1, minAuthority: 0.4, negativeScale: 1 },
      elevator: { baseRate: 0.15, maxRate: 0.6, accelTime: 1.5, accelExponent: 2, reverseGain: 1.2, fullAuthoritySpeed: 28 * (48 / 53) * C208_RATIO * STALL_RATIO, authorityExponent: 2, minAuthority: 0.22, negativeScale: 0.55 },
      rudder: { baseRate: 0.25, maxRate: 1.2, accelTime: 1.0, accelExponent: 2, reverseGain: 1.3, fullAuthoritySpeed: 30 * (48 / 53) * C208_RATIO * STALL_RATIO, authorityExponent: 1, minAuthority: 0.5, negativeScale: 1 },
    },
    groundElevatorRate: 0.6,
    rotation: {
      rate: (3 * Math.PI) / 180,
      rateLead: 0.25,
      // The ventral strakes touch at about 13 deg (gear.ts).
      pitchLimitGround: (10 * Math.PI) / 180,
      pitchLimitAir: (12 * Math.PI) / 180,
      pitchLead: 0.5,
      bleed: 4,
    },
    // Pedal steering through the spring link, 12 deg at full pedal.
    steering: { kind: 'rudder', kp: 2, ki: 1, kd: 1.6, limit: 0.35, fadeInSpeed: [1, 4] },
    rollTrim: { ki: 1.2, kb: 0.25, limit: 0.07 },
    gStops: { pull: 2.0, push: 0.35 },
    handoverSpeed: 8 * (48 / 53) * C208_RATIO * STALL_RATIO,
  },
  labels: {
    throttleUp: 'Power lever forward (from BETA / REVERSE: back to the idle gate)',
    throttleDown: 'Power lever back (to the idle gate)',
    powerLeverReverse: 'Power lever to the idle gate; let go and hold again: over the gate into BETA, then REVERSE (on the ground)',
    throttleIdle: 'Power lever IDLE, on the gate',
    mixtureRich: 'Condition lever forward one detent (CUT-OFF/FEATHER, GROUND IDLE, FLIGHT IDLE)',
    mixtureLean: 'Condition lever back to GROUND IDLE; pressed again there and held 1 s: CUT-OFF/FEATHER',
  },
};
