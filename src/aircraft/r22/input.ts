import type { InputProfile } from '../../input/profile';
import { C152_INPUT } from '../c152/input';
// Hold position without attitude/heading assists. A 100 ms tap is ~0.006 travel (~0.066° cyclic);
// sustained holds retain the original .45/s authority. See the real-InputSystem hover test.
const axis = { baseRate: 0.06, maxRate: 0.45, accelTime: 1.2, accelExponent: 2, reverseGain: 1.2,
  fullAuthoritySpeed: 1000, authorityExponent: 1, minAuthority: 1, negativeScale: 1 };
export const R22_INPUT: InputProfile = {
  // No hand primer (the C152's): handPrimer cleared.
  ...C152_INPUT, rotorcraft: true, handPrimer: undefined, collectiveRate: 0.15, flapDetents: [0],
  // Continuous fine cyclic at hover; full authority remains at 80% of the view's half-span.
  mouseYoke: { expo: 0.85, deadzone: 0 },
  assists: { ...C152_INPUT.assists, axes: { elevator: axis, aileron: axis, rudder: { ...axis, baseRate: 0.08 } } },
  labels: { pitchUp: 'Cyclic aft', pitchDown: 'Cyclic forward', rollLeft: 'Cyclic left', rollRight: 'Cyclic right',
    rudderLeft: 'Left pedal', rudderRight: 'Right pedal', flapsUp: 'Lower collective (hold)', flapsDown: 'Raise collective (hold)',
    throttleDown: 'Twist throttle closed', throttleUp: 'Twist throttle open',
    throttleIdle: 'Twist throttle fully closed (overtravel)', throttleFull: 'Twist throttle fully open' },
};
