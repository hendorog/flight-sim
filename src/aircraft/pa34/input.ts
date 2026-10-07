// Piper PA-34-200 Seneca I: the input profile (which levers and switches exist, the flap detents, the fuel selector
// cycle and the tuning of the keyboard assists). Plain data.
//
// The assists are the Cessna 172S's (aircraft/c172s/input.ts, where input/virtualYoke.ts and input/InputSystem.ts
// explain each number), with the speeds scaled by the ratio of the stall speeds, 66 / 53 KCAS, and the ground
// steering softened for the pedals' direct link to the nosewheel; the keyboard rudder keeps full travel up to Vmca
// (contract 3.6 "Twins"); then checked on the conformance suite's keyboard blocks (tests/conformance/pa34.test.ts).

import { KT } from '../../core/math';
import type { InputProfile } from '../types';
import { PA34_REFERENCE } from './reference';

/** Clean stall speed of the Seneca over the 172S's (KCAS, forward CG). */
const STALL_RATIO = 66 / 53;

export const PA34_INPUT: InputProfile = {
  engines: 2,
  // 0, 10, 25 and 40 degrees: the floor lever's notches.
  flapDetents: [0, 10 / 40, 25 / 40, 1],
  // Each engine's selector: ON, CROSSFEED, OFF (s.9).
  fuelSelectorCycle: ['on', 'crossfeed', 'off'],
  // Four magneto toggles and a starter rocker (s.9).
  ignition: 'toggles',
  // Injected, constant speed and feathering, alternate air, cowl flaps, retractable gear, rudder trim, electric
  // pumps (s.4, s.9).
  has: {
    mixture: true,
    propeller: true,
    feather: true,
    carbHeat: false,
    alternateAir: true,
    cowlFlaps: true,
    gear: true,
    rudderTrim: true,
    fuelPump: true,
  },
  assists: {
    axes: {
      aileron: { baseRate: 0.2, maxRate: 1.0, accelTime: 1.2, accelExponent: 2, reverseGain: 1.3, fullAuthoritySpeed: 33 * STALL_RATIO, authorityExponent: 1, minAuthority: 0.4, negativeScale: 1 },
      elevator: { baseRate: 0.15, maxRate: 0.6, accelTime: 1.5, accelExponent: 2, reverseGain: 1.2, fullAuthoritySpeed: 28 * STALL_RATIO, authorityExponent: 2, minAuthority: 0.22, negativeScale: 0.55 },
      // Full travel up to Vmca, then no faster than 1 / V (contract 3.6): the keys reach what an engine-out needs. A
      // held key reaches full travel sooner than on the 172S (an engine failure asks for most of the rudder at once):
      // the keyboard engine-out's largest heading change 15.1 deg with the 172S's rates (band 15), 14.9 with these; 1.6 / 0.7
      // (14.7) put the crosswind keyboard circuit 19 m off the centre line.
      rudder: { baseRate: 0.25, maxRate: 1.4, accelTime: 0.85, accelExponent: 2, reverseGain: 1.3, fullAuthoritySpeed: PA34_REFERENCE.vmca! * KT, authorityExponent: 1, minAuthority: 0.5, negativeScale: 1 },
    },
    groundElevatorRate: 0.6,
    rotation: {
      // About 5 deg/s.
      rate: (5 * Math.PI) / 180,
      rateLead: 0.2,
      // The tail cone touches at about 12 degrees (gear.ts).
      pitchLimitGround: (10 * Math.PI) / 180,
      pitchLimitAir: (11 * Math.PI) / 180,
      pitchLead: 0.5,
      bleed: 4,
    },
    // The pedals steer the nosewheel directly, 21 degrees at full pedal (the 172S: 10 through its bungee): the
    // assist's gains and its limit are half the 172S's for the same wheel angle per unit of error.
    steering: { kind: 'rudder', kp: 1.5, ki: 0.75, kd: 1.1, limit: 0.22, fadeInSpeed: [1, 4] },
    rollTrim: { ki: 1.2, kb: 0.25, limit: 0.07 },
    gStops: { pull: 2.2, push: 0.35 },
    handoverSpeed: 8 * STALL_RATIO,
  },
};
