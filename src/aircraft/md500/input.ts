// MD 500E (369E): the input profile. Owner: T2.
//
// Position-commanded cyclic, collective and pedals (mechanical controls, no boost); the keyboard's released cyclic
// centre follows the electric spring-trim anchors (4-way coolie; RFM 1-10). The twist grip is ControlInputs.throttle
// with the CUTOFF / GROUND IDLE / FULL OPEN stops of facts.ts (consistency: deep-equals systems.turboshaft.grip); the
// governor INCR/DECR beep switch on the collective drives ControlInputs.n2Beep; ignition and start are switches
// (the START button on the collective, the igniter with it). No governor switch, clutch, mixture, carburettor heat
// or primer: a turboshaft. Keyboard rates are the R44's hand-motion estimates (the 500's controls are lighter and
// quicker; no measured pilot transfer functions).
import type { InputProfile } from '../../input/profile';
import { C152_INPUT } from '../c152/input';
import { MD500_TWIST_GRIP } from './facts';

const axis = { baseRate: 0.05, maxRate: 0.35, accelTime: 1.2, accelExponent: 2, reverseGain: 1.2,
  fullAuthoritySpeed: 1000, authorityExponent: 1, minAuthority: 1, negativeScale: 1 };

export const MD500_INPUT: InputProfile = {
  ...C152_INPUT,
  rotorcraft: true, rotorGovernor: false, springTrim: true, collectiveRate: 0.12, flapDetents: [0],
  twistGrip: { ...MD500_TWIST_GRIP }, n2Beep: true,
  ignition: 'toggles',
  // One fuel shut-off valve (FUEL VALVE pull knob, RFM Fig 4-2).
  fuelSelectorCycle: ['on', 'off'],
  mouseYoke: { expo: 0.85, deadzone: 0 },
  // The start (boost) pump switch (RFM 2-9) is the fuel pump.
  has: { mixture: false, propeller: false, feather: false, carbHeat: false, alternateAir: false, cowlFlaps: false,
    gear: false, rudderTrim: false, fuelPump: true, reverse: false },
  assists: { ...C152_INPUT.assists, axes: { elevator: axis, aileron: axis, rudder: { ...axis, baseRate: 0.06 } } },
  labels: { pitchUp: 'Cyclic aft', pitchDown: 'Cyclic forward', rollLeft: 'Cyclic left', rollRight: 'Cyclic right',
    rudderLeft: 'Left pedal', rudderRight: 'Right pedal', flapsUp: 'Lower collective (hold)', flapsDown: 'Raise collective (hold)',
    throttleDown: 'Twist grip toward idle', throttleUp: 'Twist grip open',
    throttleIdle: 'Twist grip to GROUND IDLE', throttleFull: 'Twist grip FULL OPEN',
    trimNoseUp: 'Cyclic trim aft (hold)', trimNoseDown: 'Cyclic trim forward (hold)',
    rudderTrimLeft: 'Cyclic trim left (hold)', rudderTrimRight: 'Cyclic trim right (hold)',
    fuelPump: 'Start pump', starter: 'START button (hold)' },
};
