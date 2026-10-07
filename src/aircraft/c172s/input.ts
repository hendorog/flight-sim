// Cessna 172S: the input profile (which levers and switches exist, the flap detents, the fuel selector cycle
// and the tuning of the keyboard assists). Plain data.
//
// The assists were tuned against this aircraft (tests/input/keyboardFlight.test.ts); what each number does is
// described where it is used (input/virtualYoke.ts, input/InputSystem.ts), which keep their old names for these
// values (KEY_AXIS_TUNING, FLAP_DETENTS, RotationGuard.RATE, ...).

import type { InputProfile } from '../types';

export const C172S_INPUT: InputProfile = {
  engines: 1,
  // 0, 10, 20 and 30 degrees: thirds of the lever travel.
  flapDetents: [0, 1 / 3, 2 / 3, 1],
  fuelSelectorCycle: ['both', 'left', 'right', 'off'],
  ignition: 'key',
  // Fuel-injected, fixed pitch, fixed gear: throttle and mixture, and the auxiliary fuel pump.
  has: {
    mixture: true,
    propeller: false,
    feather: false,
    carbHeat: false,
    alternateAir: false,
    cowlFlaps: false,
    gear: false,
    rudderTrim: false,
    fuelPump: true,
  },
  assists: {
    axes: {
      aileron: { baseRate: 0.2, maxRate: 1.0, accelTime: 1.2, accelExponent: 2, reverseGain: 1.3, fullAuthoritySpeed: 33, authorityExponent: 1, minAuthority: 0.4, negativeScale: 1 },
      elevator: { baseRate: 0.15, maxRate: 0.6, accelTime: 1.5, accelExponent: 2, reverseGain: 1.2, fullAuthoritySpeed: 28, authorityExponent: 2, minAuthority: 0.22, negativeScale: 0.55 },
      rudder: { baseRate: 0.25, maxRate: 1.2, accelTime: 1.0, accelExponent: 2, reverseGain: 1.3, fullAuthoritySpeed: 30, authorityExponent: 1, minAuthority: 0.5, negativeScale: 1 },
    },
    // On the mains the same yoke movement pitches the nose about twice as fast as in the air.
    groundElevatorRate: 0.6,
    rotation: {
      // About 5 deg/s.
      rate: (5 * Math.PI) / 180,
      rateLead: 0.2,
      // The tail strikes at about 13-14 degrees.
      pitchLimitGround: (11 * Math.PI) / 180,
      pitchLimitAir: (11 * Math.PI) / 180,
      pitchLead: 0.5,
      bleed: 4,
    },
    // The pedals steer the nosewheel: the assist holds the heading with rudder alone.
    steering: { kind: 'rudder', kp: 3, ki: 1.5, kd: 2.2, limit: 0.45, fadeInSpeed: [1, 4] },
    rollTrim: { ki: 1.2, kb: 0.25, limit: 0.07 },
    gStops: { pull: 2.2, push: 0.35 },
    handoverSpeed: 8,
  },
};
