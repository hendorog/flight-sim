// Lockheed AH-56A Cheyenne: the input profile. Owner: AG (stage 2); the new profile fields are implemented by TW in
// src/input/**. Plan revision 2, sections 0 item 7 and 5 (AGENT choices for a laptop, not owner decisions).
//
// Boosted cyclic, collective and pedals. The stick commands MOMENTS on the control gyro (a rate command with attitude hold
// at stick centre on the AMCS), so the keyboard cyclic RE-CENTRES to the trim anchor when no cyclic key is held
// (centringCyclic) and the mouse yoke keeps TW's small deadzone (no mouseYoke override); the 4-way coolie-hat trim moves
// the anchor (springTrim). The condition grip OFF / IDLE / RUN is the twist-grip axis (ControlInputs.throttle, the stops
// of facts.ts; consistency deep-equals systems.turboshaft.grip). The pusher's twist grip is the propeller lever on the
// propeller keys with three snaps (hover detent -2.2 deg, autorotation +8 deg, full reverse -12 deg); the Nf "RPM SET"
// beep moves to the shifted pair. The tail-wheel lock, the gear lever and the toe and parking brakes have keys.
import type { InputProfile } from '../../input/profile';
import { MD500_INPUT } from '../md500/input';
import { AH56_CONDITION_GRIP, AH56_PROP_BETA_DEG, ah56PropLever } from './facts';

const lever = (beta: number): number => ah56PropLever(beta);

export const AH56_INPUT: InputProfile = {
  ...MD500_INPUT,
  rotorcraft: true, rotorGovernor: false, springTrim: true, flapDetents: [0],
  twistGrip: { ...AH56_CONDITION_GRIP }, n2Beep: true,
  // TW's default for a re-centring cyclic: a 0.03 deadzone (about 0.17 in of the AMCS's 5.8 in lateral travel).
  mouseYoke: undefined,
  centringCyclic: true,
  propLever: { detent: lever(AH56_PROP_BETA_DEG.hoverDetent),
    snaps: [lever(AH56_PROP_BETA_DEG.hoverDetent), lever(AH56_PROP_BETA_DEG.autorotation), lever(AH56_PROP_BETA_DEG.flightMin)] },
  tailWheelLock: true, gearLever: true, wheelBrakes: true,
  has: { ...MD500_INPUT.has, gear: true },
  labels: { ...MD500_INPUT.labels,
    throttleDown: 'Condition grip toward OFF', throttleUp: 'Condition grip toward RUN',
    throttleIdle: 'Condition grip to IDLE', throttleFull: 'Condition grip RUN',
    trimNoseUp: 'Cyclic trim aft (hold)', trimNoseDown: 'Cyclic trim forward (hold)',
    fuelPump: 'Boost pump', starter: 'START button (hold)' },
};
