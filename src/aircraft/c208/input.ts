// Cessna 208 Caravan 675: the input profile (which levers and switches exist, the flap detents, the fuel selector
// cycle and the tuning of the keyboard assists). Plain data.
//
// The turboprop's levers on the existing controls: the throttle keys move the POWER lever, the mixture keys the
// CONDITION lever (CUT-OFF / LOW IDLE / HIGH IDLE), the propeller keys the PROP lever (with FEATHER at its aft
// end); the starter is its own switch and the magneto keys work the IGNITION switch ('toggles'). The assists are
// the Cessna 152's with the speeds scaled by the ratio of the stall speeds, 70 / 48 KCAS.

import type { InputProfile } from '../types';

/** Clean stall speed of the 208 over the 152's (KCAS, forward CG). */
const STALL_RATIO = 70 / 48;

export const C208_INPUT: InputProfile = {
  engines: 1,
  // UP, 10, 20, FULL (30): thirds of the selector's travel.
  flapDetents: [0, 1 / 3, 2 / 3, 1],
  // Both tank selectors ON, left only, right only, both OFF.
  fuelSelectorCycle: ['on', 'left', 'right', 'off'],
  ignition: 'toggles',
  has: {
    mixture: true,
    propeller: true,
    feather: true,
    carbHeat: false,
    alternateAir: false,
    cowlFlaps: false,
    gear: false,
    rudderTrim: true,
    fuelPump: true,
    // The power lever aft of the idle gate: beta, then reverse (powerplant.ts C208_BETA).
    reverse: true,
  },
  assists: {
    axes: {
      aileron: { baseRate: 0.2, maxRate: 1.0, accelTime: 1.2, accelExponent: 2, reverseGain: 1.3, fullAuthoritySpeed: 33 * (48 / 53) * STALL_RATIO, authorityExponent: 1, minAuthority: 0.4, negativeScale: 1 },
      elevator: { baseRate: 0.15, maxRate: 0.6, accelTime: 1.5, accelExponent: 2, reverseGain: 1.2, fullAuthoritySpeed: 28 * (48 / 53) * STALL_RATIO, authorityExponent: 2, minAuthority: 0.22, negativeScale: 0.55 },
      rudder: { baseRate: 0.25, maxRate: 1.2, accelTime: 1.0, accelExponent: 2, reverseGain: 1.3, fullAuthoritySpeed: 30 * (48 / 53) * STALL_RATIO, authorityExponent: 1, minAuthority: 0.5, negativeScale: 1 },
    },
    groundElevatorRate: 0.6,
    rotation: {
      rate: (4 * Math.PI) / 180,
      rateLead: 0.25,
      // The tail tie-down touches at about 15 degrees (gear.ts).
      pitchLimitGround: (11 * Math.PI) / 180,
      pitchLimitAir: (12 * Math.PI) / 180,
      pitchLead: 0.5,
      bleed: 4,
    },
    // Pedal steering through the spring link, 15 degrees at full pedal.
    steering: { kind: 'rudder', kp: 2, ki: 1, kd: 1.6, limit: 0.35, fadeInSpeed: [1, 4] },
    rollTrim: { ki: 1.2, kb: 0.25, limit: 0.07 },
    gStops: { pull: 2.2, push: 0.35 },
    handoverSpeed: 8 * (48 / 53) * STALL_RATIO,
  },
  labels: { throttleUp: 'Power lever forward', throttleDown: 'Power lever back', mixtureRich: 'Condition lever forward (HIGH IDLE)', mixtureLean: 'Condition lever back (CUT-OFF)' },
};
