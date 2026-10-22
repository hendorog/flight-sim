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
  // STAB ASSIST (tuning round 2026-10-22, KNOWN_ISSUES T8 / T9): a SIM AID for the laptop pilot, not a modelled AH-56A system (the
  // AMCS's only augmentation is the speed-scheduled trim and the sideslip SAS; the ICS's the desensitizer, decoupler and roll
  // compensator; neither had a yaw damper or an attitude hold beyond the gyro's own). The law is the shared one (src/sim/rotorcraft/
  // stabilityAssist.ts: an attitude hold below fadeKias[0] faded out by fadeKias[1], the heading hold while the pedal keys rest, the
  // keyboard trim follow-up). Round 1 took the Bo 105's tuning unchanged: on the keyboard beginner of tests/rotorcraft/
  // bo105KeyPilot.ts (taps 0.3-0.6 s late every 0.8-1.6 s, 60 s from the 15 m hover and a 3 ft IGE hover) the AMCS without it drifts
  // 27-30 m (lost at 58-60 s in three of six runs) with the heading wandering 72-180 deg; with it 1.9-2.8 m and 0.1 deg (W/tune/ah56/
  // probes ah56key.test.ts, out/key-off.log, key-bo-r1.log). ON by default; Shift+A toggles it. The physics is untouched.
  // Round 2 (the Fable pilot gate's beginner side, KNOWN_ISSUES T9; W/tune/ah56/r2, out/bat-H30.log and wbat-H30.log): the Bo 105
  // tuning held the hover but trapped the beginner in it. The AH-56A's keyboard cyclic re-centres (the gyro is a rate command with
  // attitude hold at stick centre), so the law's attitude-command datum (the captured attitude + stickAttitude x the stick) went back
  // to the captured hover attitude whenever the key came up: each push was pulled back within about 4 s (1.5 s pushes every 4 s never
  // reached 60 KIAS in 60 s, 46.9 at most). Here the cyclic hold is a light one, katt 0.3 (was 1.2) and stickAttitude 0.6 (was 1.3):
  // the hover still holds (the Bo 105 helper's tapper 4.8-8.2 m in 60 s, the row's bound 10 m; the watching beginner of
  // tests/rotorcraft/ah56KeyPilot.ts 2.0-2.7 m) while a released push keeps most of its attitude (the same pushes reach 60 KIAS in
  // 41.9 s; the watching beginner 40 KIAS in 22-24 s, against 39-44 s with the heading lost on the way). The band runs to 60 KIAS
  // (fadeKias [30, 60], was [30, 50]): the trims move 0.10 of the stick aft and 0.62 of the pedal right between the hover and 45-60
  // KIAS (r2 out/p5_speedtrim.log), and the rate damping and the pedal follow-up now carry through the transition. The heading hold
  // gets the authority the lift-off needs (holdAuthority 0.5, 25 % of travel; the hover pedal is 0.38 left of the ground trim) and
  // the rate damping more room (kr 0.5 within yawAuthority 0.25: the Bo 105's 0.3 within 0.13 saturated at the 15-22 deg/s ringing);
  // the pedal follow-up walks at up to 0.5 of the axis per second (was 0.2). A 2 s pedal hold now rings at 4.2 deg/s at most from 6 s
  // on (was 14.3); a 0.5 s F6 tap swings the nose 3.0 deg/s (was 8.7). The price of the light hold: a released 2 s roll push drifts
  // further hands off (2 s ArrowRight from the hover: 148 m in 22 s, was 118 m). The shared law's re-capture on a centring stick's
  // return (attitude hold at the attitude the pilot left, as the gyro itself does) is the Bo 105 lane's to add (contract request).
  stabilityAssist: { default: true, kp: 0.15, kq: 0.3, kr: 0.5, katt: 0.3, stickAttitude: 0.6, authority: 0.2, yawAuthority: 0.25,
    holdAuthority: 0.5, kpsi: 1.0, kpsiI: 0.3, datumRelaxKt: 2, groundLoad: 0.5, fadeKias: [30, 60],
    followUp: { filterS: 0.5, deadBand: 0.2, cyclicGain: 0.3, cyclicRate: 0.1, pedalGain: 1, pedalRate: 0.5 } },
  // Collective keys (round 2; AGENT input choices): the MD 500E's 0.12 of the travel per second is 2.5 deg/s on this collective's 21
  // deg: F5 held 1 s from the 15 m hover reached the ground at 1,057 fpm (a crash); at 0.06 it settles onto the wheels (645 fpm at
  // most), and a 0.5 s tap sinks at 369 fpm and stays up. The hand-rate pair of the Bo 105 (Shift+F5 1.0 / Shift+F6 0.5 of the travel
  // per second, ESTIMATES) for the engine failure and the cushion; Shift+F5 stops at 0.15 of the travel (7.7 deg indicated), the
  // autorotation entry this model holds at 98.6 % Nr at 90 KIAS and 101.4 % at 75 KIAS (2,450 / 2,444 ft/min; 0.10 gives 103.4 /
  // 106.9 %, the floor 108 / 112.5 %: r2 out/p7_auto.log). Bare F5 goes on down.
  collectiveRate: 0.06,
  collectiveFastRate: { down: 1.0, up: 0.5, downStop: 0.15 },
  // Keyboard gearing (tuning round, KNOWN_ISSUES T5 / T9; AGENT input choices, the stick- and pedal-to-blade gearings are P and
  // untouched). Pedal: about 53 deg/s per inch in the hover (momentum-theory damping, D), so the MD 500E's key ramp (0.06 -> 0.35 of
  // the axis per second over 1.2 s) put 0.35 in on the pedal in a 1 s tap and 1.4 in in 2 s (95 deg/s). 0.03 -> 0.2 over 1.5 s: a 1 s
  // tap is 0.15 in, a 2 s hold 0.7 in; full pedal is still there held. Cyclic (round 2): the MD 500E's ramp (0.05 -> 0.35 per second
  // over 1.2 s, squared) on a rate-command gyro gave nothing for a second and then a lot (with the STAB ASSIST 2.3 / 13.6 / 33.7 deg
  // of pitch for 1 / 2 / 3 s holds, roll 3.2 / 20.5 / 51.7: a 3 s roll hold reached the ground). A constant 0.1 of the axis per
  // second: 1.3 / 4.6 / 9.7 deg, roll 1.9 / 6.9 / 14.6 (r2 out/bat-H30.log, G).
  assists: { ...MD500_INPUT.assists, axes: { ...mdAxes,
    elevator: { ...mdAxes.elevator, baseRate: 0.1, maxRate: 0.1, accelTime: 1, accelExponent: 1 },
    aileron: { ...mdAxes.aileron, baseRate: 0.1, maxRate: 0.1, accelTime: 1, accelExponent: 1 },
    rudder: { ...mdAxes.rudder, baseRate: 0.03, maxRate: 0.2, accelTime: 1.5 } } },
  has: { ...MD500_INPUT.has, gear: true },
  labels: { ...MD500_INPUT.labels,
    throttleDown: 'Condition grip toward OFF', throttleUp: 'Condition grip toward RUN',
    throttleIdle: 'Condition grip to IDLE', throttleFull: 'Condition grip RUN',
    trimNoseUp: 'Cyclic trim aft (hold)', trimNoseDown: 'Cyclic trim forward (hold)',
    fuelPump: 'Boost pump', starter: 'START button (hold)',
    collectiveFastDown: 'Lower the collective at hand speed (hold) to the autorotation entry position (15 %): engine failure; bare F5 goes on down',
    collectiveFastUp: 'Raise the collective at hand speed (hold): the cushion',
    stabilityAssist: 'STAB ASSIST on / off: a gentle attitude hold below 30 KIAS, the heading held while the pedals rest, the yaw damped to 60 KIAS, and the keyboard stick and pedals walked to the trim (a sim aid: the AH-56A had no such system)' },
};
