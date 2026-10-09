import type { InputProfile } from '../../input/profile';
import { C152_INPUT } from '../c152/input';
// Position commands, without stability assists. These are keyboard hand-motion estimates, not
// hydraulic servo dynamics or force feedback. Small taps give ~0.07 deg longitudinal cyclic.
const axis = { baseRate: 0.05, maxRate: 0.35, accelTime: 1.2, accelExponent: 2, reverseGain: 1.2,
  fullAuthoritySpeed: 1000, authorityExponent: 1, minAuthority: 1, negativeScale: 1 };
export const R44_INPUT: InputProfile = {
  ...C152_INPUT, rotorcraft: true, primeKey: true, collectiveRate: 0.12, flapDetents: [0],
  has: { ...C152_INPUT.has, carbHeat: false, fuelPump: true },
  assists: { ...C152_INPUT.assists, axes: { elevator: axis, aileron: axis, rudder: { ...axis, baseRate: 0.06 } } },
  labels: { fuelPump: 'Ignition PRIME (hold)', pitchUp: 'Cyclic aft', pitchDown: 'Cyclic forward', rollLeft: 'Cyclic left', rollRight: 'Cyclic right',
    rudderLeft: 'Left pedal', rudderRight: 'Right pedal', flapsUp: 'Lower collective (hold)', flapsDown: 'Raise collective (hold)',
    throttleDown: 'Twist throttle closed', throttleUp: 'Twist throttle open',
    throttleIdle: 'Twist throttle fully closed (overtravel)', throttleFull: 'Twist throttle fully open' },
};
