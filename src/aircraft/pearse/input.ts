// Richard Pearse 1903 Monoplane: input profile and low-speed keyboard assists.

import type { InputProfile } from '../types';

/** Stall-speed scale relative to the C172S (29 / 53 KCAS). */
const STALL_RATIO = 29 / 53;

export const PEARSE_INPUT: InputProfile = {
  engines: 1,
  flapDetents: [0, 0.5, 1],
  fuelSelectorCycle: ['on', 'off'],
  ignition: 'key',
  has: {
    mixture: true,
    propeller: false,
    feather: false,
    carbHeat: false,
    alternateAir: false,
    cowlFlaps: false,
    gear: false,
    rudderTrim: false,
    fuelPump: false,
  },
  assists: {
    axes: {
      aileron: { baseRate: 0.32, maxRate: 1.25, accelTime: 0.9, accelExponent: 2, reverseGain: 1.3, fullAuthoritySpeed: 33 * STALL_RATIO, authorityExponent: 1, minAuthority: 0.45, negativeScale: 1 },
      elevator: { baseRate: 0.24, maxRate: 0.85, accelTime: 1.0, accelExponent: 2, reverseGain: 1.2, fullAuthoritySpeed: 28 * STALL_RATIO, authorityExponent: 2, minAuthority: 0.28, negativeScale: 0.6, fullTravel: true },
      rudder: { baseRate: 0.28, maxRate: 1.25, accelTime: 0.95, accelExponent: 2, reverseGain: 1.3, fullAuthoritySpeed: 30 * STALL_RATIO, authorityExponent: 1, minAuthority: 0.55, negativeScale: 1 },
    },
    groundElevatorRate: 0.6,
    groundElevatorShape: { baseRate: 0.16, maxRate: 0.6, accelTime: 1.4 },
    rotation: {
      rate: (5 * Math.PI) / 180,
      rateLead: 0.2,
      pitchLimitGround: (11 * Math.PI) / 180,
      pitchLimitAir: (12 * Math.PI) / 180,
      pitchLead: 0.5,
      bleed: 4,
    },
    steering: { kind: 'rudder', kp: 2.8, ki: 1.2, kd: 2.0, limit: 0.45, fadeInSpeed: [0.8, 3.5] },
    rollTrim: { ki: 1.1, kb: 0.25, limit: 0.08 },
    gStops: { pull: 2.0, push: 0.4 },
    handoverSpeed: 8 * STALL_RATIO,
  },
};
