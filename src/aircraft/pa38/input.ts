// Piper PA-38-112 Tomahawk II: the input profile (which levers and switches exist, the flap detents, the fuel selector
// cycle and the tuning of the keyboard assists). Plain data.
//
// The assists are the Cessna 172S's (aircraft/c172s/input.ts, where input/virtualYoke.ts and input/InputSystem.ts
// explain each number), with the speeds scaled by the ratio of the stall speeds, 54 / 53 KCAS, and the ground
// steering softened for the pedals' direct link to the nosewheel; then checked on the conformance suite's keyboard
// circuit (tests/conformance/pa38.test.ts).

import type { InputProfile } from '../types';

/** Clean stall speed of the Tomahawk over the 172S's (KCAS, forward CG). */
const STALL_RATIO = 54 / 53;

export const PA38_INPUT: InputProfile = {
  engines: 1,
  // 0, 21 and 34 degrees: the hand lever's two notches.
  flapDetents: [0, 21 / 34, 1],
  // LEFT, RIGHT and OFF; the selector has no BOTH (s.9 of the type's data sheet).
  fuelSelectorCycle: ['left', 'right', 'off'],
  ignition: 'key',
  // Carburetted, fixed pitch, fixed gear: throttle, mixture, carburettor heat and the electric fuel pump; no trims
  // but the elevator's.
  has: {
    mixture: true,
    propeller: false,
    feather: false,
    carbHeat: true,
    alternateAir: false,
    cowlFlaps: false,
    gear: false,
    rudderTrim: false,
    fuelPump: true,
  },
  assists: {
    axes: {
      aileron: { baseRate: 0.2, maxRate: 1.0, accelTime: 1.2, accelExponent: 2, reverseGain: 1.3, fullAuthoritySpeed: 33 * STALL_RATIO, authorityExponent: 1, minAuthority: 0.4, negativeScale: 1 },
      elevator: { baseRate: 0.15, maxRate: 0.6, accelTime: 1.5, accelExponent: 2, reverseGain: 1.2, fullAuthoritySpeed: 28 * STALL_RATIO, authorityExponent: 2, minAuthority: 0.22, negativeScale: 0.55 },
      rudder: { baseRate: 0.25, maxRate: 1.2, accelTime: 1.0, accelExponent: 2, reverseGain: 1.3, fullAuthoritySpeed: 30 * STALL_RATIO, authorityExponent: 1, minAuthority: 0.5, negativeScale: 1 },
    },
    groundElevatorRate: 0.6,
    rotation: {
      // About 5 deg/s.
      rate: (5 * Math.PI) / 180,
      rateLead: 0.2,
      // The tail skid touches at about 16 degrees of pitch (gear.ts).
      pitchLimitGround: (12 * Math.PI) / 180,
      pitchLimitAir: (12 * Math.PI) / 180,
      pitchLead: 0.5,
      bleed: 4,
    },
    // The pedals steer the nosewheel directly, 30 degrees at full pedal (the 172S: 10 through its bungee): the
    // assist's gains and its limit are a third of the 172S's for the same wheel angle per unit of error.
    steering: { kind: 'rudder', kp: 1, ki: 0.5, kd: 0.75, limit: 0.15, fadeInSpeed: [1, 4] },
    rollTrim: { ki: 1.2, kb: 0.25, limit: 0.07 },
    gStops: { pull: 2.2, push: 0.35 },
    handoverSpeed: 8 * STALL_RATIO,
  },
};
