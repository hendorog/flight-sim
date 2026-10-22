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
const mdAxes = MD500_INPUT.assists.axes!;

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
  // STAB ASSIST (tuning round 2026-10-22, KNOWN_ISSUES T8): a SIM AID for the laptop pilot, not a modelled AH-56A system (the AMCS's
  // only augmentation is the speed-scheduled trim and the sideslip SAS; the ICS's the desensitizer, decoupler and roll compensator;
  // neither had a yaw damper or an attitude hold beyond the gyro's own). The law is the shared one (src/sim/rotorcraft/
  // stabilityAssist.ts: attitude hold below 30 KIAS faded out by 50, the heading hold while the pedal keys rest, the keyboard trim
  // follow-up), with the Bo 105's tuning unchanged: on the keyboard beginner of tests/rotorcraft/bo105KeyPilot.ts (taps 0.3-0.6 s
  // late every 0.8-1.6 s, 60 s from the 15 m hover and a 3 ft IGE hover) the AMCS without it drifts 27-30 m (lost at 58-60 s in
  // three of six runs) with the heading wandering 72-180 deg; with it 1.9-2.8 m and 0.1 deg (W/tune/ah56/probes ah56key.test.ts,
  // out/key-off.log, key-bo-r1.log). ON by default; Shift+A toggles it. The physics is untouched.
  stabilityAssist: { default: true, kp: 0.15, kq: 0.3, kr: 0.3, katt: 1.2, stickAttitude: 1.3, authority: 0.2, yawAuthority: 0.13,
    holdAuthority: 0.3, kpsi: 1.0, kpsiI: 0.3, datumRelaxKt: 2, groundLoad: 0.5, fadeKias: [30, 50],
    followUp: { filterS: 0.5, deadBand: 0.2, cyclicGain: 0.3, cyclicRate: 0.1, pedalGain: 1, pedalRate: 0.2 } },
  // Keyboard pedal gearing (tuning round, KNOWN_ISSUES T5; AGENT input choice, the pedal-to-blade gearing is P and untouched): the
  // AH-56A's pedal is about 53 deg/s per inch in the hover (momentum-theory damping, D), so the MD 500E's key ramp (0.06 -> 0.35 of
  // the axis per second over 1.2 s) put 0.35 in on the pedal in a 1 s tap and 1.4 in in 2 s (95 deg/s). 0.03 -> 0.2 over 1.5 s: a 1
  // s tap is 0.15 in (5 deg/s with the STAB ASSIST, 17 without), a 2 s hold 0.7 in (23 / 60 deg/s); full pedal is still there held.
  assists: { ...MD500_INPUT.assists, axes: { ...mdAxes, rudder: { ...mdAxes.rudder, baseRate: 0.03, maxRate: 0.2, accelTime: 1.5 } } },
  has: { ...MD500_INPUT.has, gear: true },
  labels: { ...MD500_INPUT.labels,
    throttleDown: 'Condition grip toward OFF', throttleUp: 'Condition grip toward RUN',
    throttleIdle: 'Condition grip to IDLE', throttleFull: 'Condition grip RUN',
    trimNoseUp: 'Cyclic trim aft (hold)', trimNoseDown: 'Cyclic trim forward (hold)',
    fuelPump: 'Boost pump', starter: 'START button (hold)',
    stabilityAssist: 'STAB ASSIST on / off: holds the attitude below 30 KIAS and the heading when the pedals rest, and walks the keyboard stick and pedals to the trim (a sim aid: the AH-56A had no such system)' },
};
