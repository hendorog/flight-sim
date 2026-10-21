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
  stabilityAssist: { default: true, kp: 0.15, kq: 0.3, kr: 0.3, katt: 1.2, stickAttitude: 1.3, authority: 0.2, yawAuthority: 0.13,
    kpsi: 1.0, kpsiI: 0.3, datumRelaxKt: 2, groundYawLoad: 0.5, fadeKias: [30, 50] },
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
    stabilityAssist: 'STAB ASSIST on / off: holds the attitude below 30 KIAS and the heading when the pedals rest (a sim aid: the CB-4 has no SAS)',
    setTrimHere: 'Keyboard trim here: 5 returns the stick to this position (sim convenience: the CB-4 has beep trim only)' },
};
