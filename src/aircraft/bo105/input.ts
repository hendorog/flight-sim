// MBB Bo 105 CB-4: the input profile. Owner: BO (the profile fields are TW's, src/input/**).
//
// Two overhead power levers OFF - IDLE - FLIGHT on ControlInputs.engines[i].throttle with the stops of facts.ts
// BO105_POWER_LEVER (consistency: twistGrip deep-equals systems.turboshaft.grip); the engine-select keys 8 / 9 / 0 choose
// the lever (TW: src/input). ENGINE TRIM fore/aft (n2Beep: both N2) and left/right (n2BeepSplit: the torque split) on the
// collective head (P5 FM 7-12). Electric cyclic trim with feel springs (P5 FM 7-24). The keyboard cyclic is a
// position command (non-centring), as on the other helicopters; no mixture, carburettor heat or primer: turboshafts.
//
// Keyboard axes (plan 6.2, input only; the dynamics stay as calibrated). The plan's starting values (aileron baseRate
// 0.03, maxRate 0.22, accelTime 1.5; elevator 0.04) left a 1 s lateral key tap at 80 KIAS at 0.058 of the axis (2.9 % of
// travel) and 5.7 deg of bank 3 s after the key went down, below the tap-to-bank row's 8-14 deg (tests/rotorcraft/
// bo105Handling.test.ts: the bank 2 s after a 1 s tap, the plan's "first 1-2 s" roll window). The aileron key is the
// row's knob: baseRate 0.07, maxRate 0.35, accelTime 1.5 put a 1 s tap at 0.11 of the axis (5.6 % of travel). The
// elevator key baseRate 0.04 and the mouse yoke's expo 0.9 and 0.02 dead zone are the plan's. ESTIMATES.
import type { InputProfile } from '../../input/profile';
import { MD500_INPUT } from '../md500/input';
import { BO105_POWER_LEVER } from './facts';

const md = MD500_INPUT, mdAxes = md.assists.axes!;

export const BO105_INPUT: InputProfile = {
  ...md,
  engines: 2,
  engineLever: 'overheadPowerLevers',
  twistGrip: { ...BO105_POWER_LEVER },
  n2Beep: true,
  n2BeepSplit: true,
  springTrim: true,
  mouseYoke: { expo: 0.9, deadzone: 0.02 },
  // STAB ASSIST (flyability pass, 2026-10-22; W/bofly/fix-plan.md F1): a sim aid, not a CB-4 system (the CB-4 has no
  // SAS; the optional IFR-kit SAS is not modelled). The real Bo 105 hover is unstable (ERF 1995 VII-7, P), and the sim
  // matches it; this series term (at most 10 % of travel) holds the attitude below 30 KIAS (faded out by 50) and damps
  // the yaw rate, so a keyboard pilot can hover. Gains from the hands-off probe (W/bofly/probes sas2.log: 0.7 deg calm,
  // 2.3 deg in 8 kt wind with 5 kt gusts, 0.8 / 2.4 % of travel used); stickAttitude from the keyboard tap probe
  // (W/bofly/probes-fix assist.log). ON by default (the owner's flip: `default: false`); Shift+A toggles it.
  // Round 2 (W/bofly/r2, the pilot gate's follow-ups): the pedal term holds the heading once the pedal keys rest (kpsi
  // 1.0 per rad, kpsiI 0.3 per rad s, inside the same 6.5 % of pedal travel: yaw.log); the cyclic datum tracks the trim
  // while the pilot flies a deceleration (one e-fold per 2 kt of slowing: decel.log); the pedal term works on the ground
  // once the skids carry less than half the weight (liftoff.log).
  // Round 3 (W/bofly/pilot-r3, the round-2 gate's must items): the heading hold gets its own 15 % of pedal travel
  // (holdAuthority 0.3; the rate damping keeps 6.5 %, so full-pedal turns are unchanged): a 0.5 / 0.6 s collective tap no
  // longer spins the nose (out/final/d_yaw.log). The trim follow-up walks the KEYBOARD stick and pedals to the trim
  // (followUp): the cyclic at 0.3 per second per unit of the low-passed series term beyond 20 % of its authority, at most
  // 0.1 of the axis per second (5 % of travel); the pedals at 1 per second, at most 0.2 (2 rang the heading +/-12 deg
  // after a collective tap, 1.4 still rang: out/n_ytrace.log, out/d_yaw.g.log; out/final/a_liftoff.log). The assist also
  // works on light skids, the cyclic too (groundLoad; round 2's groundYawLoad was the pedal term only). ESTIMATES tuned
  // on the probes.
  // Tune pass (W/tune/bo105, item 1: the keyboard deceleration to the hover was lost by the collective): a HEIGHT HOLD on
  // the keyboard collective (ADS-33E's rate command / height hold): full below 30 KIAS, gone at 40 (the trouble starts at
  // 30-35 kt; a [20, 30] band reached the hover in 2-4 of 10 decelerations, [30, 40] in 6-7), a PI on the climb rate
  // (kv 0.06 of the travel per second per m/s, kp 0.06 per m/s; without kp the height loop rang at 0.05-0.15 of the travel,
  // g_loop.log), the height captured once the climb is under 0.3 m/s and held at 0.3 m/s per m, at most 0.1 of the travel
  // per second, damping 0.03 per m/s while a collective key is held, never above the maximum continuous power, never
  // below 0.1, off with an engine out, the needles split or NR under 95 %. With it a COLLECTIVE-TO-PEDAL CROSSFEED on the
  // keyboard pedals (-3 of the pedal axis per unit of collective, round 3's trim slope, j_slope.log; washed out over 3 s;
  // airborne, pedal keys at rest): the height hold's quick collective moves rang the heading (a 1 s F6 tap: 5.6 deg/s
  // still at 15 s) and an unwashed crossfeed of its own moves piled up through the deceleration (0-1 of 10).
  // Measured (d_hh_final, h_rows_final): the tapping beginner's deceleration reaches the hover in 9 of 10 variants and,
  // flying on, holds it 20 s (round 3: 0 of 10, all lost); collective taps 0.3 / 0.5 / 0.6 / 1.0 s with the pedals untouched
  // peak 1.2 / 2.0 / 2.4 / 4.1 deg (round 3: 7.1 / 11.4 / 13.5 / 20.2). ESTIMATES tuned on the probes.
  // Tune round 2 (W/tune/bo105 r2, the round-1 pilot gate's must items):
  // - TRANSLATIONAL RATE COMMAND on the keyboard cyclic (ADS-33E's TRC response type at hover and low speed): the
  //   attitude datums lean 1 deg per kt of ground speed against the drift (at most 6 deg), and once the keyboard stick
  //   has rested 2.5 s they walk to the zero-ground-speed trim at 0.3 deg per second per kt (at most 2 deg per second),
  //   full below 15 kt of ground speed, gone at 30; the walk also waits 2.5 s after a capture (the hold letting go at 27
  //   kt pitched up 5.3 deg in 2 s without it). Hands off it comes back to a hover over the ground: let go after the 45
  //   KIAS deceleration it held within 10.6 m for 60 s (round 1: slid sideways past 30 m in 10.5 s and crashed at 41 s); a
  //   1 s ArrowUp knock in the hover 27.7 m (round 1: 490 m, 35 KIAS); 9 of 10 keyboard decelerations held as before
  //   (r2 p1_m2). Swept 0.5-1.0 deg per kt, 0.1-0.3 deg/s per kt, rest 1-3.5 s, walk limit 0.5-2 deg/s: a shorter rest or a
  //   stronger walk fought the tapping beginner (lost after the hover in 2 of 10), a weaker one or a 1 deg/s limit left the
  //   knock past 30 m (p1_a..h, m0..m05).
  // - CLIMB-RATE COMMAND on a held bare F5 / F6 (airborne, below the height hold's band): the key's own move is taken back
  //   and the lever walked to 2 m/s up or down, the sink falling to 0.7 m/s over the 4 m above 4 m of CG height (the CG
  //   sits 1.4 m up on the skids), stopping at the power limit and backing off at 0.05 per second while F6 stays held past
  //   it. F5 held from 16 m and from 3 ft touches down at 0.44 m/s (round 1: crashed in a 5.9 m/s sink; 2.2 m/s); F6 held
  //   5 s peaks at 86.2 % torque against the 86 % AEO limit (round 1: 118.6 %). Shift+F5 / Shift+F6 stay raw (p4_*).
  // - The crossfeed on light skids too, unless a pedal key was worked on the skids: the untouched lift-off's swing in its
  //   first 6 s 38.9 deg (59.6 airborne only); the 2 s left-pedal lift-off unchanged at 24.2 (p3, p7).
  // - CRUISE ATTITUDE HOLD on the keyboard cyclic (the gate's "either owner" should): the cyclic terms keep full gain
  //   above the 30-50 KIAS fade instead of fading out (the pedal term and the height hold still fade), so the keys stay
  //   attitude command / attitude hold in cruise. The gate's tapping beginners at 60 / 80 / 100 KIAS (taps every 1 / 2 /
  //   3 s, plus no collective): 0 of 15 crashed in 60 s (without it 10 of 15, at 14-52 s); the hands-off aircraft at 120 /
  //   140 KIAS held (raw: diverged and crashed at 51 / 16 s); a 0.5 gain crashed 9 of 15 at 80-140 KIAS. By-hand
  //   accelerations out of the hover: 6 of 12 not lost (0 of 12; the rest fly into the ground from 3 ft or over-torque
  //   climbing). Above about 110 KIAS the 1 s tapper still loses it (p12_ch1hi). A mouse yoke or hardware stick flies the
  //   raw aircraft above the fade, as before (r2 p11 / p12). ESTIMATES.
  // Tune pass 2 (W/tune2/bo105, the round-2 gate's must items; docs section 9 "Tune pass 2"):
  // - KEYBOARD CYCLIC LIMIT (keyboardLimit, in the input module): below 15 kt of ground speed the arrow keys move the stick
  //   at most 0.12 of the axis from where it last rested (8.9 deg of commanded attitude, inside the 0.2 series authority),
  //   open by 30 kt; 2.5 s after the arrow keys rest the keyed displacement glides back at 0.1 per second. An arrow held
  //   1.5-2 s used to take the stick past the authority (ArrowUp 2 s crashed at 5.3 s; 12 of 40 holds of 1-5 s came
  //   back): now 40 of 40, at most 18.6 deg, 10.6 kt, 37 m (q1_held). Swept 0.10 / 0.12 / 0.15 (0.15: 87 m).
  // - The TRC walk waits for the arrow keys (translationalRate.keyRest): a key held against the limit is still a command
  //   (without it the beginner could not accelerate out of the hover, 0 of 10).
  // - LETTING DOWN (recentre.landing, landingRestS 0): with the CG under 8 m and a bare F5 within 5 s the keyed stick glides
  //   back at once and the walk runs whenever no arrow is held: the wings-level beginner lands under 5 kt in 12 of 12
  //   (3 of 12, sliding 17-29 kt and rolling over, before; q2_land).
  // - CLIMB-RATE COMMAND AT EVERY SPEED (heightHold.held.everySpeed): a held F5 / F6 in cruise walks the lever to 2 m/s
  //   (F5 held 2 s at 100 KIAS: 84 deg / 135 % before, 8.7 deg / 63 % now; q3_cruise); the limit back-off of a held F6
  //   never lowers the lever below where the key found it (at 140 KIAS the beginner's F6 taps flew it into the ground).
  //   ESTIMATES.
  // Tune pass 2 fix round (W/tune2/bo105 fix1, the pass-2 gate gate1):
  // - ONE ENGINE OUT, the held F5 / F6 (heightHold.oei): above the 30-40 KIAS band the climb-rate command keeps working
  //   with one engine out, F6 stopped at the survivor's OEI limits (95 % torque, 810 C, 105 % N1) and never backed off;
  //   below the band the keys stay raw (the OEI cushion). The beginner holding the height at 100 KIAS pumped the raw lever
  //   against the topping and rolled inverted (111.9 %, crashed); now 80 / 100 KIAS with the height law (gain 1, 0.5) or
  //   the attitude alone: none crashed in 60 s, NR at least 96.3 % (f_oei). An at-rest back-off over the limits (0.01-0.05
  //   per second) flew the attitude-only beginner into the ground at 100 KIAS; held in the hover band, the OEI landing
  //   from 16 m crashed (3.9-5.2 m/s; raw 2.1-2.3): both measured, not adopted.
  // - THE TRC WALK AT 1 DEG/S (translationalRate.trimMaxDegS, round 2's 2): an arrow key reversal in the hover (ArrowUp
  //   2 s, ArrowDown 2 s) rang the walk against the saturated attitude hold into a growing limit cycle and crashed from
  //   16 m and 3 ft (f_rev); at 1 deg/s 10 of 10 reversals come back (1.5: 8 of 10). Round 2 dropped 1 deg/s for the 1 s
  //   knock past 30 m; behind the keyboard cyclic limit it stays within 15 m. The 10 kt tailwind deceleration with 1 s
  //   taps now reaches the hover (50.5 s; it pirouetted before).
  // - THE KEYBOARD CYCLIC LIMIT AT SPEED (keyboardLimit.cruise): above 15 kt of ground speed one press of an arrow key
  //   moves the stick at most 0.12 of the axis (about 9 deg of commanded attitude) from where it was when the keys last
  //   rested 0.3 s (the limit used to open to the whole travel by 30 kt). Held 1.5-3 s at 20-100 KIAS a key took the stick
  //   0.3-0.8 out, past the series authority, and the raw aircraft answered: with the beginner recovering 12 of 60
  //   crashed, hands off 35 of 60 (the pass-2 gate's k1). Now 0 of 60 and 9 of 60: the nine are ArrowUp held then hands
  //   off at 45-100 KIAS, the commanded 9 deg nose down held into a dive (17-41 s from 150 m). Swept 0.12 / 0.16 / 0.2
  //   (0.2: the 100 KIAS recovery through 180 deg) and the rest 1 / 0.3 s (the 1 s rest, and a limit kept through the
  //   15-30 kt band, added the beginner's taps up: by-hand accelerations past 45 kt 10-15 s later, the circuit's
  //   approaches 1 of 8 done; with 0.3 s across the band they are as before, the circuit 6 of 8 against 5).
  // - THE CRUISE ATTITUDE HOLD ON THE MOUSE YOKE TOO (cruiseHold.handHeld): a hand-held stick (the mouse yoke, Y; a
  //   hardware stick) kept the raw aircraft above the 30-50 KIAS fade, and with the owner's trackpad as the yoke every
  //   careless input in cruise departed (the pass-2 gate's h5: the tapper crashed at 80 / 100 KIAS; hands off at 120 / 140
  //   and F5 / F6 held 2 s at 100 crashed; f_h5: 13 of 17 crashed). Now the yoke is attitude command / attitude hold at
  //   every speed, as the keys are (no follow-up: the hand holds it): 1 of 20 crashed, the yoke left forward after a
  //   knock at 100 KIAS, the commanded dive. Control wheel steering (the datum following the flown attitude while the yoke
  //   moves, 0.25-2 s) crashed the 100-120 KIAS tappers and both speed changes: measured, not adopted.
  stabilityAssist: { default: true, kp: 0.15, kq: 0.3, kr: 0.3, katt: 1.2, stickAttitude: 1.3, authority: 0.2, yawAuthority: 0.13,
    holdAuthority: 0.3, kpsi: 1.0, kpsiI: 0.3, datumRelaxKt: 2, groundLoad: 0.5, fadeKias: [30, 50],
    followUp: { filterS: 0.5, deadBand: 0.2, cyclicGain: 0.3, cyclicRate: 0.1, pedalGain: 1, pedalRate: 0.2 },
    heightHold: { fadeKias: [30, 40], kv: 0.06, kp: 0.06, kvHeld: 0.03, rate: 0.1, captureMps: 0.3, kh: 0.3, vsMax: 1, floor: 0.1, minNrPct: 95,
      held: { climbMps: 2, sinkMps: 2, landSinkMps: 0.7, landAglM: 4, landBandM: 4, rate: 0.2, limitBackRate: 0.05, everySpeed: true },
      oei: true },
    pedalCrossfeed: { perCollective: -3, washS: 3, onLightSkids: true },
    cruiseHold: { gain: 1, handHeld: true },
    translationalRate: { degPerKt: 1.0, limitDeg: 6, trimDegPerSPerKt: 0.3, restS: 2.5, trimMaxDegS: 1, fadeKt: [15, 30], keyRest: true, landingRestS: 0 },
    keyboardLimit: { travel: 0.12, fadeKt: [15, 30], recentre: { rate: 0.1, restS: 2.5, landing: { aglM: 8, restS: 0, f5S: 5 } },
      cruise: { travel: 0.12, restS: 0.3 } } },
  // Hand-rate collective keys (flyability pass F2): Shift+F5 lowers at 1.0 of the travel per second (full down in about
  // 0.4 s from the cruise collective), Shift+F6 raises at 0.5 per second (a 0.4 cushion in 0.8 s). The double-engine
  // failure's NR decays about 19 %/s at 100 KIAS (840 kJ in the rotor against 325 kW: D, KNOWN_ISSUES 22), and the fine
  // F5 / F6 (the MD 500E's 0.12 per second) take 2.9-3.7 s to reach full down; bare F5 / F6 stay the fine hover keys.
  // ESTIMATES (down: the hand rate of W/bofly/probes-controls auto.log; up: arithmetic).
  // Entry stop (round 2, W/bofly/r2 autoSteady / auto): Shift+F5 stops at 0.08 of the travel, the autorotation entry
  // position, and never takes the collective below it (bare F5 does, at the fine rate). Run to the floor and held, it
  // overspun the rotor to 118 % (100 KIAS) / 126 % (120 KIAS) with the pilot slowing to 70 KIAS, past the power-off
  // limit (85-110 %, P5 FM 2-8). Steady 75 KIAS autorotation at 0.08: about 97 % NR at 2200 kg and 102 % at 2500 kg
  // (full down: 110 / 117 %). The FM's "collective fully down" is the pilot's, with bare F5, watching NR.
  collectiveFastRate: { down: 1.0, up: 0.5, downStop: 0.08 },
  // The keyboard re-centring (5 / Numpad 5) at 1 travel per second instead of 4 (flyability pass F3): the keyboard centre
  // is the spring-trim anchor (the hover stick at a reset), so an untrimmed pilot at 120 KIAS pressing 5 would get 0.44 of
  // the travel aft in 0.22 s, about 230 deg/s^2 of pitch acceleration on this hub; at 1 per second it takes 0.9 s.
  // Shift+5 sets the keyboard centre to the stick as it is (a sim convenience: the CB-4 has beep trim only).
  centreRate: 1,
  setTrimHere: true,
  // 5 leaves the pedals where they are (the tune pass, item 3; W/tune/bo105): the keys and the STAB ASSIST's pedal
  // follow-up set the pedal trim, and round 3's 5 threw a pedal set with the keys away (KeyZ 2 s at lift-off, then 5:
  // 62 deg/s of yaw, the nose 136 deg round). The cyclic still glides back to the keyboard trim.
  centreKeepsPedals: true,
  assists: { ...md.assists, axes: {
    elevator: { ...mdAxes.elevator, baseRate: 0.04 },
    aileron: { ...mdAxes.aileron, baseRate: 0.07, maxRate: 0.35, accelTime: 1.5 },
    rudder: mdAxes.rudder,
  } },
  // The power levers' texts come from the engineLever profile (bindings.ts); the MD 500E's twist-grip labels are dropped.
  labels: { pitchUp: 'Cyclic aft', pitchDown: 'Cyclic forward', rollLeft: 'Cyclic left', rollRight: 'Cyclic right',
    rudderLeft: 'Left pedal', rudderRight: 'Right pedal', flapsUp: 'Lower collective (hold)', flapsDown: 'Raise collective (hold)',
    trimNoseUp: 'Cyclic trim aft (hold)', trimNoseDown: 'Cyclic trim forward (hold)',
    rudderTrimLeft: 'Cyclic trim left (hold)', rudderTrimRight: 'Cyclic trim right (hold)',
    fuelPump: 'Fuel pumps', starter: 'STARTER/GENERATOR to START (hold)',
    collectiveFastDown: 'Lower the collective at hand speed (hold) to the autorotation entry position (8 %): engine failure; bare F5 goes on down',
    collectiveFastUp: 'Raise the collective at hand speed (hold): the autorotation cushion',
    centreControls: 'Cyclic back to the keyboard trim (the pedals stay where they are)',
    stabilityAssist: 'STAB ASSIST on / off: holds the attitude (on the arrow keys and the mouse yoke at every speed; with the arrow keys at rest below 30 kt it comes back to a hover over the ground, and one press of an arrow key moves the stick at most 0.12 of the travel), the heading when the pedals rest and the height when F5 / F6 rest (held, they climb or descend at up to 2 m/s at any speed, with one engine out too), pedals with the collective, and walks the keyboard stick and pedals to the trim (a sim aid: the CB-4 has no SAS)',
    setTrimHere: 'Keyboard trim here: 5 returns the stick to this position (sim convenience: the CB-4 has beep trim only)' },
};
