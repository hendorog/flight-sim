// Cessna 152 (1978 model): the input profile (which levers and switches exist, the flap detents, the fuel selector
// cycle and the tuning of the keyboard assists). Plain data.
//
// The assists are the Cessna 172S's (aircraft/c172s/input.ts, where input/virtualYoke.ts and input/InputSystem.ts
// explain each number), with the speeds scaled by the ratio of the stall speeds, 48 / 53 KCAS, then checked on the
// conformance suite's keyboard circuit (tests/conformance/c152.test.ts).

import type { InputProfile } from '../types';

/** Clean stall speed of the 152 over the 172S's (KCAS, forward CG). */
const STALL_RATIO = 48 / 53;

export const C152_INPUT: InputProfile = {
  engines: 1,
  // 0, 10, 20 and 30 degrees: the pre-select lever's stops, thirds of its travel.
  flapDetents: [0, 1 / 3, 2 / 3, 1],
  // One ON / OFF shut-off valve on the cabin floor (s.9 of the type's data sheet).
  fuelSelectorCycle: ['on', 'off'],
  ignition: 'key',
  // Carburetted, fixed pitch, fixed gear: throttle, mixture and carburettor heat; no fuel pump, no trims but the elevator's.
  has: {
    mixture: true,
    propeller: false,
    feather: false,
    carbHeat: true,
    alternateAir: false,
    cowlFlaps: false,
    gear: false,
    rudderTrim: false,
    fuelPump: false,
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
      // The tail tie-down touches at about 15 degrees of pitch (s.2.4).
      pitchLimitGround: (12 * Math.PI) / 180,
      pitchLimitAir: (12 * Math.PI) / 180,
      pitchLead: 0.5,
      bleed: 4,
    },
    // The pedals steer the nosewheel through the bungee: the assist holds the heading with rudder alone.
    steering: { kind: 'rudder', kp: 3, ki: 1.5, kd: 2.2, limit: 0.45, fadeInSpeed: [1, 4] },
    rollTrim: { ki: 1.2, kb: 0.25, limit: 0.07 },
    gStops: { pull: 2.2, push: 0.35 },
    handoverSpeed: 8 * STALL_RATIO,
  },
};
