// Lockheed AH-56A Cheyenne: the input profile. Owner: AG (stage 2); the new profile fields are implemented by TW in
// src/input/**. Plan revision 2, sections 0 item 7 and 5 (AGENT choices for a laptop, not owner decisions).
//
// Boosted cyclic, collective and pedals. The stick commands MOMENTS on the control gyro (a rate command with attitude hold
// at stick centre on the AMCS). Tune3 (the owner's keyboard reports): the keyboard cyclic and pedals are NOT re-centred; they
// stay where the keys leave them, and with the STAB ASSIST on the keyboard stick is an attitude command and the pedal keys a
// yaw-rate command (below); the mouse yoke keeps TW's small deadzone (set explicitly, it was the re-centring cyclic's default);
// the 4-way coolie-hat trim moves the anchor (springTrim). The condition grip OFF / IDLE / RUN is the twist-grip axis (ControlInputs.throttle, the stops
// of facts.ts; consistency deep-equals systems.turboshaft.grip). The pusher's twist grip is the propeller lever on the
// propeller keys with three snaps (hover detent -2.2 deg, autorotation +8 deg, full reverse -12 deg); the Nf "RPM SET"
// beep moves to the shifted pair. The tail-wheel lock, the gear lever and the toe and parking brakes have keys.
import type { InputProfile } from '../../input/profile';
import { MD500_INPUT } from '../md500/input';
import { interp1 } from '../../core/math';
import { AH56_CONDITION_GRIP, AH56_PROP_BETA_DEG, ah56PropLever } from './facts';
import { PROP_GRIP_TABLE, PROP_TRIM_SCHEDULE } from './compound';

const lever = (beta: number): number => ah56PropLever(beta);
const mdAxes = MD500_INPUT.assists.axes!;

export const AH56_INPUT: InputProfile = {
  ...MD500_INPUT,
  rotorcraft: true, rotorGovernor: false, springTrim: true, flapDetents: [0],
  twistGrip: { ...AH56_CONDITION_GRIP }, n2Beep: true,
  // TW's default for a re-centring cyclic, kept for the mouse yoke now the keyboard cyclic does not re-centre (tune3): a 0.03
  // deadzone (about 0.17 in of the AMCS's 5.8 in lateral travel). A deadzone, not a pull-back: nothing moves the mouse's stick.
  // (InputSystem's CENTRING_MOUSE_DEADZONE; written out, a profile does not import the input module.)
  mouseYoke: { expo: 0.3, deadzone: 0.03 },
  propLever: { detent: lever(AH56_PROP_BETA_DEG.hoverDetent),
    snaps: [lever(AH56_PROP_BETA_DEG.hoverDetent), lever(AH56_PROP_BETA_DEG.autorotation), lever(AH56_PROP_BETA_DEG.flightMin)],
    // PROP SCHEDULE (round 3; a laptop sim aid, the existing InputAssists.propSchedule, ON for this type; no toggle key: a propeller
    // key or a snap hands the grip back to the pilot until the next reset; it lets go with the engine stopped): the grip follows a
    // schedule against IAS. The P technique is the propeller: "Transition to forward flight from a hover was initiated by slowly
    // increasing propeller thrust while maintaining attitude" (APE-I para 97), and two power controls were the workload (para 112).
    // From 40 KIAS up it is the AMCS trim schedule (compound.ts PROP_TRIM_SCHEDULE, read as IAS: the sea-level table; the ICS's is
    // about 1 deg lower) through the grip's table; below 30 KIAS it holds the -2.2 deg hover detent (AGENT choice, off the table's 5
    // deg at 20 kt, a level-flight trim): with the table's low-speed angles the beginner's stop pushed against prop thrust and 0-1 of 4
    // decelerations reached the hover, with the detent 3 of 4. With the rotor speed-stable since T10 the beginner tilting the nose
    // alone settled at 42-50 KIAS (the pushes row never reached 60); with this schedule the watching beginner reaches 38 KIAS in
    // 27-30 s (the full table: 19-20 s) and the circuit runs at 62-69 KIAS (W/tune2/ah56 out/c8_*.log, c1i_*.log, c1j_*.log).
    schedule: { kias: [0, 30, ...PROP_TRIM_SCHEDULE.kt.filter((k) => k >= 40)],
      lever: [lever(AH56_PROP_BETA_DEG.hoverDetent), lever(AH56_PROP_BETA_DEG.hoverDetent),
        ...PROP_TRIM_SCHEDULE.betaDeg.filter((_b, i) => PROP_TRIM_SCHEDULE.kt[i] >= 40).map((b) => interp1(PROP_GRIP_TABLE.betaDeg, PROP_GRIP_TABLE.lever, b))],
      default: true } },
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
  // 41.9 s; the watching beginner 40 KIAS in 22-24 s, against 34-44 s with the heading 50-95 deg off). The band runs to 60 KIAS
  // (fadeKias [30, 60], was [30, 50]): the trims move 0.10 of the stick aft and 0.62 of the pedal right between the hover and 45-60
  // KIAS (r2 out/p5_speedtrim.log), and the rate damping and the pedal follow-up now carry through the transition. The heading hold
  // gets the authority the lift-off needs (holdAuthority 0.5, 25 % of travel; the hover pedal is 0.38 left of the ground trim) and
  // the rate damping more room (kr 0.5 within yawAuthority 0.25: the Bo 105's 0.3 within 0.13 saturated at the 15-22 deg/s ringing);
  // the pedal follow-up walks at up to 0.5 of the axis per second (was 0.2). A 2 s pedal hold now rings at 4.2 deg/s at most from 6 s
  // on (was 14.3); a 0.5 s F6 tap swings the nose 3.0 deg/s (was 8.7). The price of the light hold: a released 2 s roll push drifts
  // further hands off (2 s ArrowRight from the hover: 148 m in 22 s, was 118 m). The shared law's re-capture on a centring stick's
  // return (attitude hold at the attitude the pilot left, as the gyro itself does) is the Bo 105 lane's to add (contract request).
  // Round 3 (tune2, KNOWN_ISSUES T10 / T11; AGENT choices for the owner). The owner prefers the attitude stability to come from the
  // gyro, not from a pitch/roll STAB ASSIST. With the AMCS net-spring refit (gyro.ts AMCS_NET_SPRING) the gyro alone holds the
  // trimmed hover hands off (ah56GyroHover), and the keyboard beginner holds the hover with the cyclic attitude term OFF (the Bo 105
  // helper's tapper 3.7-5.0 m in 60 s against the row's 10 m; the watching beginner 2.2-15.4 m). It is kept ON, light, for the WAY
  // BACK: with it off, the full mission (lift-off, circuit, back to a hover, landing) completed 2 of 4 paces, the hover after the
  // deceleration drifting 80-900 m; with it 4 of 4, 5-24 m (W/tune2/ah56 out/c1h-c1j). It is no longer round 2's attitude COMMAND
  // back to a captured hover attitude: recaptureOnCentre takes the datum where the re-centring keyboard stick comes back to rest (the
  // attitude the pilot left, held as the gyro holds it, firmer), and captureAirborne takes the first datum fully airborne with the
  // stick quiet (the integrator's contract requests 2 and 3). katt 0.3 within authority 0.2 (10 % of the travel); katt 0.15 or
  // authority 0.1 completed 3 of 4. The price is the knock: a 2 s ArrowRight push let go drifts 168 m in 22 s (round 2 148 m; katt 0
  // 162 m), ArrowUp 114 m (99; 103), because the push's attitude is held. Shift+A removes all of it. The rate terms kp / kq stay:
  // their follow-up walks the keyboard stick's anchor to the zero-rate stick, which a rate-command gyro needs from the keys.
  // New opt-in fields of the shared law, set here:
  // - sideslipPedal: the keyboard pedal walks toward zero sideslip from 20 to 160 kt of forward air speed (the round-2 gate's "one
  //   gate": above 25 KIAS the keyboard pedal stayed at the hover's -0.38 against a trim of +0.02 at 40 and +0.26 at 60 KIAS, 15-40
  //   kt of sideslip, the heading 60-120 deg off). The circuit's legs and turns now complete at every pace; hands off at 80 / 100
  //   KIAS with the pedal knocked 0.13 off, the pedal is back in 5 s and the slip at 0 (without it the roll spiralled to -30 deg).
  // - heightHold (the Bo 105 lane's law; landAglM 4.5 for this reference point 1.96 m above the wheels): the keyboard collective at
  //   rest holds the height, a held F5 / F6 airborne is a 2 m/s sink / climb command slowing to 0.5 m/s near the ground. F6 held 1-2
  //   s past the first unload: no crash (without: 2 crashes of 4, left main 143-146 kN); F5 held 2 s in the 15 m hover: 13 m
  //   minimum (without: 885-960 fpm and a crash); Shift+F6 used to stop a sink: 20-31 m (without: 164-199 m, heading 180 deg off).
  // Round 4 (the pass-2 gate's should; KNOWN_ISSUES T11): groundRollHeading holds the touchdown heading on the keyboard pedals on
  // the wheels, tail wheel locked, 6-50 kt of ground speed (faded in from 3, out by 60): the run-on's roll-out swung 105-150 deg
  // with the tail rotor as the collective came down (the main term is off on heavy wheels). 40-50 KIAS approaches at three paces,
  // feet off (W/tune2/ah56/r4/out/runon-5.log, runon-6.log): with the brakes held below 20 kt 7 of 7 roll-outs end intact (without
  // it 1 of 7: wingtip strikes and main-leg collapses); with the brakes held from the touchdown 5 of 7 (2 nose-overs onto the
  // turret: the straight roll-out takes the full braking, which the swing was hiding; without it 6 of 7, swinging 38-150 deg).
  // kpsi 2 crashed 3 of 14 (1.5: 2 of 14); kpsi 3 nosed over in the 45 KIAS full-brake case.
  stabilityAssist: { default: true, kp: 0.15, kq: 0.3, kr: 0.5, katt: 0.3, stickAttitude: 0.6, authority: 0.2, yawAuthority: 0.25,
    holdAuthority: 0.5, kpsi: 1.0, kpsiI: 0.3, datumRelaxKt: 2, groundLoad: 0.5, fadeKias: [30, 60],
    followUp: { filterS: 0.5, deadBand: 0.2, cyclicGain: 0.3, cyclicRate: 0.1, pedalGain: 1, pedalRate: 0.5 },
    captureAirborne: { quietS: 0.5 },
    keyAttitude: { travel: 0.6, rollDeg: 30, pitchDeg: 15, kattRoll: 3, kattPitch: 2.5, kp: 0.2, kq: 0.1, ffRoll: 1, ffPitch: 1.5, authority: 0.8,
      trimRate: 0.1 },
    keyPedal: { turnPerUnit: 200, turnDegS: 35, ff: 0.33, kr: 1.5, authority: 0.9, brakeDegS: 2, returnRate: 0.5, travel: 0.35 },
    sideslipPedal: { kias: [20, 30, 140, 160], gain: 1, rate: 0.2, filterS: 1 },
    groundRollHeading: { gsKt: [3, 6, 50, 60], kpsi: 1.5, kr: 0.5, authority: 0.5, gain: 1, rate: 0.5, filterS: 0.5 },
    heightHold: { fadeKias: [30, 40], kv: 0.06, kp: 0.06, kvHeld: 0.03, rate: 0.1, captureMps: 0.3, kh: 0.3, vsMax: 1, floor: 0.1,
      minNrPct: 95, held: { climbMps: 4.5, sinkMps: 3.5, landSinkMps: 0.5, landAglM: 4.5, landBandM: 8, rate: 0.4, limitBackRate: 0.05 } } },
  // Collective keys (round 2; AGENT input choices): the MD 500E's 0.12 of the travel per second is 2.5 deg/s on this collective's 21
  // deg: F5 held 1 s from the 15 m hover reached the ground at 1,057 fpm (a crash); at 0.06 it settles onto the wheels (645 fpm at
  // most), and a 0.5 s tap sinks at 369 fpm and stays up. The hand-rate pair of the Bo 105 (Shift+F5 1.0 / Shift+F6 0.5 of the travel
  // per second, ESTIMATES) for the engine failure and the cushion; Shift+F5 stops at 0.15 of the travel (7.7 deg indicated), the
  // autorotation entry this model holds at 98.6 % Nr at 90 KIAS and 101.4 % at 75 KIAS (2,450 / 2,444 ft/min; 0.10 gives 103.4 /
  // 106.9 %, the floor 108 / 112.5 %: r2 out/p7_auto.log). Bare F5 goes on down.
  collectiveRate: 0.1,
  // Round 3: Shift+F6 stops at 0.8 of the travel (the hover's 0.53-0.65 plus the cushion; collectiveFastRate.upStop): held to stop a
  // hover sink it ran the collective to 1.0, climbed to 160-200 m and spun the heading 180 deg (the round-2 gate); bare F6 goes on up.
  // Round 4 (the pass-2 gate; collectiveFastRate.downGate, a sim guard): with the engine running below 30 kt of forward air speed
  // Shift+F5 acts as bare F5 (with the STAB ASSIST, a held F5 is the 2 m/s sink command slowing near the ground): for 1 s in the 15
  // m hover it hit the ground at 2,640 fpm every time, the key label and the hint its only protection. In forward flight and with
  // the engine stopped it keeps the hand speed (the autorotation entry, the IGE engine failure's own collective).
  collectiveFastRate: { down: 1.0, up: 0.5, downStop: 0.15, upStop: 0.8, downGate: { minKias: 30 } },
  // Keyboard gearing (tuning round, KNOWN_ISSUES T5 / T9; AGENT input choices, the stick- and pedal-to-blade gearings are P and
  // untouched). Pedal: about 53 deg/s per inch in the hover (momentum-theory damping, D), so the MD 500E's key ramp (0.06 -> 0.35 of
  // the axis per second over 1.2 s) put 0.35 in on the pedal in a 1 s tap and 1.4 in in 2 s (95 deg/s). 0.03 -> 0.2 over 1.5 s: a 1 s
  // tap is 0.15 in, a 2 s hold 0.7 in; full pedal is still there held. Cyclic (round 2): the MD 500E's ramp (0.05 -> 0.35 per second
  // over 1.2 s, squared) on a rate-command gyro gave nothing for a second and then a lot (with the STAB ASSIST 2.3 / 13.6 / 33.7 deg
  // of pitch for 1 / 2 / 3 s holds, roll 3.2 / 20.5 / 51.7: a 3 s roll hold reached the ground). A constant 0.1 of the axis per
  // second: 1.3 / 4.6 / 9.7 deg, roll 1.9 / 6.9 / 14.6 (r2 out/bat-H30.log, G).
  assists: { ...MD500_INPUT.assists, axes: { ...mdAxes,
    elevator: { ...mdAxes.elevator, baseRate: 0.5, maxRate: 0.5, accelTime: 1, accelExponent: 1 },
    aileron: { ...mdAxes.aileron, baseRate: 0.5, maxRate: 0.5, accelTime: 1, accelExponent: 1 },
    rudder: { ...mdAxes.rudder, baseRate: 0.5, maxRate: 0.5, accelTime: 1, accelExponent: 1 } } },
  has: { ...MD500_INPUT.has, gear: true },
  labels: { ...MD500_INPUT.labels,
    throttleDown: 'Condition grip toward OFF', throttleUp: 'Condition grip toward RUN',
    throttleIdle: 'Condition grip to IDLE', throttleFull: 'Condition grip RUN',
    trimNoseUp: 'Cyclic trim aft (hold)', trimNoseDown: 'Cyclic trim forward (hold)',
    fuelPump: 'Boost pump', starter: 'START button (hold)',
    collectiveFastDown: 'Lower the collective at hand speed (hold) to the autorotation entry position (15 %): an engine failure in forward flight or with the engine stopped; with the engine running below 30 KIAS it acts as F5 (a sim guard: in the hover the hand-speed drop puts the aircraft on the ground at about 2,700 fpm); bare F5 goes on down',
    stabilityAssist: 'STAB ASSIST on / off: the keyboard stick as an attitude command (where it sits is the bank and pitch held), the pedal keys a turn that stops when they come up with the heading then held, the yaw damped to 60 KIAS, the pedals walked to zero sideslip in forward flight, the heading held on the wheels above 6 kt with the tail wheel locked (taxi, run-on, rolling take-off), the height held while the collective keys rest (F5 / F6 held: descend / climb) (a sim aid: the AH-56A had no such system)',
    collectiveFastUp: 'Raise the collective at hand speed (hold), up to 80 %: the landing cushion; bare F6 goes on up' },
};
