// Diamond DA20-C1: the input profile (which levers and switches exist, the flap detents, the fuel shut-off valve
// and the tuning of the keyboard assists). Plain data.
//
// The assists are the Cessna 172S's (aircraft/c172s/input.ts, where input/virtualYoke.ts and input/InputSystem.ts
// explain each number), with the speeds scaled by the ratio of the clean stall speeds, 54 / 53 KCAS, then checked
// on the conformance suite's keyboard circuit and taxi (tests/conformance/da20.test.ts). The castering nosewheel is
// steered on the ground by differential braking (contract 3.6): the rudder keys brake the inside wheel below the
// speed at which the rudder takes over.

import type { InputProfile } from '../types';

/** Clean stall speed of the DA20 over the 172S's (KCAS, forward CG). */
const STALL_RATIO = 54 / 53;

export const DA20_INPUT: InputProfile = {
  engines: 1,
  // CRUISE, T/O and LDG: 0, 15 and 45 of the 45 degrees.
  flapDetents: [0, 1 / 3, 1],
  // One shut-off valve, OPEN / CLOSED (s.9 of the type's data sheet).
  fuelSelectorCycle: ['on', 'off'],
  ignition: 'key',
  // Fuel-injected, fixed pitch, fixed gear: throttle, mixture, alternate air and the electric fuel pump.
  has: {
    mixture: true,
    propeller: false,
    feather: false,
    carbHeat: false,
    alternateAir: true,
    cowlFlaps: false,
    gear: false,
    rudderTrim: false,
    fuelPump: true,
  },
  assists: {
    axes: {
      aileron: { baseRate: 0.2, maxRate: 1.0, accelTime: 1.2, accelExponent: 2, reverseGain: 1.3, fullAuthoritySpeed: 33 * STALL_RATIO, authorityExponent: 1, minAuthority: 0.4, negativeScale: 1 },
      elevator: { baseRate: 0.15, maxRate: 0.6, accelTime: 1.5, accelExponent: 2, reverseGain: 1.2, fullAuthoritySpeed: 28 * STALL_RATIO, authorityExponent: 2, minAuthority: 0.22, negativeScale: 0.55 },
      // The rudder is powerful (27 degrees, 38 % of the fin's chord: in a steady slip at 50 KIAS a third of its travel
      // holds 12 degrees of sideslip, the 172S's 5): the keys' authority falls off above 15 m/s.
      rudder: { baseRate: 0.25, maxRate: 1.2, accelTime: 1.0, accelExponent: 2, reverseGain: 1.3, fullAuthoritySpeed: 15, authorityExponent: 1, minAuthority: 0.4, negativeScale: 1 },
    },
    groundElevatorRate: 0.6,
    rotation: {
      // About 5 deg/s.
      rate: (5 * Math.PI) / 180,
      rateLead: 0.2,
      // The tail skid touches at about 12 degrees of rotation on the mains (gear.ts).
      pitchLimitGround: (10 * Math.PI) / 180,
      pitchLimitAir: (11 * Math.PI) / 180,
      pitchLead: 0.5,
      bleed: 4,
    },
    // Castering nosewheel: the assist's heading hold goes to the rudder and, fading out toward 25 m/s (49 KIAS), to the
    // toe brakes as well; a rudder key beyond half travel adds up to half brake on its side (contract 3.6's law). The
    // rudder takes over only late in the take-off roll ("rudder, brake if needed in a crosswind", AFM 4.4.7): with the
    // default 15 m/s a 10 kt crosswind weathervaned the keyboard take-off 5.4 m off the centre line (D-M-D2-02).
    steering: { kind: 'differentialBrake', kp: 3, ki: 1.5, kd: 2.2, limit: 0.45, fadeInSpeed: [1, 4], rudderEffectiveSpeed: 25, brakeGain: 1, pedalBrakeGain: 0.5 },
    rollTrim: { ki: 1.2, kb: 0.25, limit: 0.07 },
    gStops: { pull: 2.2, push: 0.35 },
    handoverSpeed: 8 * STALL_RATIO,
  },
  labels: {
    pitchUp: 'Stick back (nose up); stays where you leave it',
    pitchDown: 'Stick forward (nose down); stays where you leave it',
    fuelPump: 'Electric fuel pump on/off',
    fuelSelector: 'Fuel shut-off valve: OPEN, CLOSED',
  },
};
