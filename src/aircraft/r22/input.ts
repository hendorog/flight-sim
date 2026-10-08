import type { InputProfile } from '../../input/profile';
import { C152_INPUT } from '../c152/input';
const axis = { baseRate: 0.12, maxRate: 0.45, accelTime: 1.2, accelExponent: 2, reverseGain: 1.2,
  fullAuthoritySpeed: 1000, authorityExponent: 1, minAuthority: 1, negativeScale: 1 };
export const R22_INPUT: InputProfile = {
  ...C152_INPUT, rotorcraft: true, flapDetents: [0],
  assists: { ...C152_INPUT.assists, axes: { elevator: axis, aileron: axis, rudder: { ...axis, baseRate: 0.2 } } },
  labels: { pitchUp: 'Cyclic aft', pitchDown: 'Cyclic forward', rollLeft: 'Cyclic left', rollRight: 'Cyclic right',
    rudderLeft: 'Left pedal', rudderRight: 'Right pedal', flapsUp: 'Lower collective (hold)', flapsDown: 'Raise collective (hold)' },
};
