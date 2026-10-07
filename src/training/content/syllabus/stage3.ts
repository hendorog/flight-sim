// Stage 3, advanced: L15-L19 (section 4.1). L15-L19 each need the first solo (L14) and can be flown in any
// order. Dual lessons.
//
// Choices where section 4.1 is silent or cannot be expressed literally (also in the module report):
// - L15 spiral dive and L19 unusual attitudes: the copilot's set-up demos (spiralSetup, unusualNoseHigh/Low)
//   fly the aircraft into the attitude and hold it; the recovery task's handover gives it to the student.
// - L16 key points are graded as `final` heights when the aircraft passes abeam the upwind end (high key) and
//   abeam the threshold (low key) on the dead side, heading downwind; no key-point event exists.
// - L17 practises and assesses the crosswind landings from a 3 NM final rather than full circuits (one
//   crosswind take-off is flown), keeping the lesson near the 15-minute target; the crosswind15 endorsement
//   is not awarded from data because Award has no grade condition (see the module report).
// - L18 records the stop point as a non-required criterion ("stop distance recorded").

import {
  all, any, binary, capture, check, demo, end, eq, ev, final, gt, held, hold, leg, lt, near, not, peak, say,
  setup, v, vs,
} from '../../engine/dsl';
import type { Criterion, Lesson, StartSpec, StepDef } from '../../types';
import {
  approachLandingTask, areaStart, assessedEx, centreline, demoEx, dualRules, finalStart, goAroundCriteria, hdg,
  ias, LINEUP, practiceEx, RWY_HDG, takeoffTask, task, UPPER_AIR,
} from './common';
import {
  clearingTurnTask, climbTask, descentTask, rateOneTurnTask, spiralRecoveryTask, straightLevelTask, touchDrills,
  turn360Task, unusualAttitudeTask,
} from './manoeuvres';
import { circuitPieces } from './stage2';
import { approachFeedback, climbFeedback, descentFeedback, feedback, limits, ms, spiralFeedback, turnFeedback } from './instruction';

/** Steep-turn limits (practice): bank 15 deg beyond the 45 target. */
const STEEP_LIMITS = limits({ bank: 60 });

const backToArea = (id: string, altFt: number, hdgDeg: number, kias = vs('Vcruise')) =>
  setup(id, { reposition: areaStart(altFt, hdgDeg, kias), cue: 'common.backToArea', pf: 'instructor' });

// =====================================================================================================
// L15 Steep turns and spiral-dive recovery
// =====================================================================================================

export const L15: Lesson = {
  id: 'L15', version: 1, number: 15, title: 'Steep turns and spiral-dive recovery',
  syllabusRef: { easa: 'Ex 15', faa: 'ACS V.A' },
  stage: 'advanced', kind: 'dual', persona: 'instructor', requires: ['L14'], aircraft: 'any', estMinutes: 14,
  start: areaStart(4000, 200, vs('VsteepTurn')), startOptions: { payload: 'forward', fuelFraction: 0.8 },
  weather: { preset: 'smooth' },
  rules: dualRules({ coachLevel: 'minimal', maxDurationS: 1500, envelope: { ...UPPER_AIR, maxBankDeg: 65 } }),
  briefing: {
    aim: 'To fly 360-degree turns at 45 degrees of bank within test limits, and recover from a spiral dive.',
    points: [
      'Lookout and a clearing turn first. Roll in smoothly; add power as you pass 30 degrees.',
      'Hold the nose on the horizon with firm back pressure, and trim if you need to.',
      'Roll out 20 degrees before the entry heading; release the back pressure as you roll out.',
      'Spiral dive: power off, roll the wings level, then ease out of the dive. Never pull in a bank.',
    ],
    numbers: [{ label: 'Steep-turn speed', value: vs('VsteepTurn'), unit: 'kt' }, { label: 'Manoeuvring speed', value: vs('Va'), unit: 'kt' },
      { label: 'Bank', value: 45, unit: 'deg' }, { label: 'Load factor at 45°', value: 1.4, unit: '' }, { label: 'Vno', value: vs('Vno'), unit: 'kt' }],
    tolerances: ['bankSteep', 'altitude', 'speed', 'rollout'],
    airmanship: ['Clearing turn before every steep turn: the turn covers a lot of sky.', 'Stay below the manoeuvring speed in steep turns.'],
    keys: ['rollLeft', 'rollRight', 'pitchUp', 'throttleUp', 'throttleIdle', 'trimNoseUp'],
    diagram: { kind: 'turn', bankDeg: 45 },
    more: 'At 45 degrees of bank the wing must give 1.41 times the weight, so the stall speed rises by 19 percent. A spiral dive is a steep turn where the nose has dropped: the speed and the load factor rise quickly.',
    spoken: 'L15.brief',
  },
  exercises: [
    demoEx('steepDemo', 'Demonstration: steep turn', 'steepTurn'),
    practiceEx('steepPractice', 'Steep turns left and right', 'steepTurn'),
    practiceEx('spiral', 'Spiral-dive recovery', 'unusualAttitude'),
    assessedEx('assessedSteep', 'Assessed: 360 left and right at 45°', 'steepTurn'),
  ],
  flow: [
    { id: 'demo', title: 'Demonstration', steps: [
      say('intro', 'L15.demoIntro', { wait: true }),
      capture('cap0', { alt0: 'altFt', hdg0: 'hdgDeg' }),
      demo('demoSteep', 'steepTurn', { followMeThrough: true, highlight: ['ai', 'alt'] }),
      say('demoWrap', 'L15.demoWrap', { wait: true }),
    ] },
    { id: 'practice', title: 'Your steep turns', retryFrom: areaStart(4000, 200, vs('VsteepTurn')), steps: [
      backToArea('repos', 4000, 200, vs('VsteepTurn')),
      capture('capL', { a0: 'altFt', hdg0: 'hdgDeg' }),
      turn360Task({ id: 'pL', exercise: 'steepPractice', brief: 'L15.steepLeft', dir: 'left', bankDeg: 45, bankTol: 'bankSteep', kias: vs('VsteepTurn'), altVar: 'a0', hdgVar: 'hdg0',
        feedback: turnFeedback({ dir: 'left', bankDeg: 45 }), limits: STEEP_LIMITS }),
      capture('capR', { a0: 'altFt', hdg0: 'hdgDeg' }),
      turn360Task({ id: 'pR', exercise: 'steepPractice', brief: 'L15.steepRight', dir: 'right', bankDeg: 45, bankTol: 'bankSteep', kias: vs('VsteepTurn'), altVar: 'a0', hdgVar: 'hdg0',
        feedback: turnFeedback({ dir: 'right', bankDeg: 45 }), limits: STEEP_LIMITS }),
    ] },
    { id: 'spiral', title: 'Spiral dive', retryFrom: areaStart(4500, 200), steps: [
      say('spiralBrief', 'L15.spiralBrief', { wait: true }),
      demo('spiralSet', 'spiralSetup', { followMeThrough: false, highlight: ['ai', 'asi'] }),
      spiralRecoveryTask({ id: 'sp', exercise: 'spiral', brief: 'L15.recoverNow', required: true, feedback: spiralFeedback() }),
    ] },
    { id: 'assessed', title: 'Assessed steep turns', coachLevel: 'silent', retryFrom: areaStart(4000, 200, vs('VsteepTurn')), steps: [
      backToArea('reposA', 4000, 200, vs('VsteepTurn')),
      say('quiet', 'common.illStayQuiet', { wait: true }),
      clearingTurnTask({ id: 'aClear', exercise: 'assessedSteep', brief: 'L15.clearingTurn', degrees: 90, coach: [] }),
      capture('capAL', { a0: 'altFt', hdg0: 'hdgDeg' }),
      turn360Task({ id: 'aL', exercise: 'assessedSteep', brief: 'L15.steepLeft', dir: 'left', bankDeg: 45, bankTol: 'bankSteep', kias: vs('VsteepTurn'), altVar: 'a0', hdgVar: 'hdg0', coach: [] }),
      capture('capAR', { a0: 'altFt', hdg0: 'hdgDeg' }),
      turn360Task({ id: 'aR', exercise: 'assessedSteep', brief: 'L15.steepRight', dir: 'right', bankDeg: 45, bankTol: 'bankSteep', kias: vs('VsteepTurn'), altVar: 'a0', hdgVar: 'hdg0', coach: [] }),
      end('fin', 'common.endDual'),
    ] },
  ],
  debriefTips: {
    'aLAlt.biasLow': 'The nose dropped in the turn: more back pressure, and look at the horizon, not the altimeter.',
    'aRAlt.biasLow': 'The nose dropped in the turn: more back pressure, and look at the horizon, not the altimeter.',
    'aLBank.oscillation': 'The bank wandered: fix the attitude on the horizon and hold it, small corrections only.',
  },
  lookAhead: 'Next: forced landings without power.',
};

// =====================================================================================================
// L16 Forced landing without power
// =====================================================================================================

/** Dead side of 07 (right of the centreline) heading downwind (250). */
const deadsideDownwind = all(gt('rwyAcrossM', 300), near('hdgDeg', 250, 60));
const glideBand = { minus: 5, plus: 10 };
/** Abeam the field, 2 NM out on the dead side, 3,000 ft above the field, heading 070 (the assessed start). */
const PFL_ABEAM: StartSpec = { kind: 'air', at: { north: -3481, east: 1267 }, altFt: 3000, altRef: 'field', hdgDeg: RWY_HDG, kias: vs('Vcruise') };
const PFL_START: StartSpec = { kind: 'air', at: 'pflHighKey', altFt: 3000, altRef: 'field', hdgDeg: RWY_HDG, kias: vs('Vcruise') };

/** One practice forced landing to the go-around at 200 ft, the throttle held closed by the instructor. */
function pfl(pre: string, exercise: string, start: StartSpec, assessed: boolean): StepDef[] {
  const req = true;
  const coach = assessed ? { coach: [] } : {};
  // The first glide criterion settles over 15 s: the failure comes at cruise speed, and trading the excess for
  // height down to the glide speed takes 10-15 s (with 8 s every PFL graded the deceleration as a deviation).
  const glide = (id: string, settleS = 8): Criterion => hold(id, 'Glide speed', 'asiKt', vs('Vglide'), glideBand, { settleS, required: req });
  return [
    setup(`${pre}Repos`, { reposition: start, cue: 'L16.inPosition', pf: 'instructor' }),
    // One hold for the whole glide (a per-task hold would hand the throttle back between tasks).
    setup(`${pre}Hold`, { holds: { throttle: 0, release: lt('hafFt', 200) } }),
    task({ id: `${pre}High`, exercise, pf: 'student', brief: 'L16.engineFailure', ...coach,
      ...(assessed ? {} : { feedback: feedback({
        milestones: [
          ms('glide', held(near('asiKt', vs('Vglide'), 5), 3), ['Glide speed, good. Now pick the field: the runway.'], 3),
          ms('drills', touchDrills, ['Drills done. Plan the pattern to the high key.']),
        ],
        nudge: 'Speed first: trim for {vspeed.Vglide:kt}, then the field, the drills, the plan.', nudgeAfterS: 15, nudgeEveryS: 25,
      }) }),
      card: { title: 'Forced landing: to the high key', targets: [ias(vs('Vglide'), glideBand), { label: 'HGT', sig: 'hafFt', value: 2000, tol: 300, unit: 'ft' }] },
      goal: all(gt('rwyAlongM', -200), lt('rwyAlongM', 1900), deadsideDownwind), timeoutS: 360, onTimeout: 'fail',
      criteria: [
        glide(`${pre}HiIas`, 15),
        check(`${pre}Drills`, 'Touch drills within 60 s', { pred: touchDrills, withinS: 60, required: req }),
        final(`${pre}HighKey`, 'Height at the high key', 'hafFt', 2000, 300, { required: req,
          advice: { high: 'High at the high key: widen the pattern or use a turn to lose it before the low key.',
            low: 'Low at the high key: close the pattern in, and keep the glide speed exact.' } }),
      ] }),
    task({ id: `${pre}Low`, exercise, brief: 'L16.lowKey', ...coach,
      ...(assessed ? {} : { feedback: feedback({
        milestones: [ms('turning', all(lt('rwyAlongM', 400), gt('rwyAcrossM', 300)), ['Heading for the low key. Adjust the pattern, not the speed.'])],
        nudge: 'Hold the glide speed; widen or tighten the pattern to arrive at 1,000 feet.', nudgeAfterS: 20, nudgeEveryS: 30,
      }) }),
      card: { title: 'Forced landing: to the low key', targets: [ias(vs('Vglide'), glideBand), { label: 'HGT', sig: 'hafFt', value: 1000, tol: 200, unit: 'ft' }] },
      goal: any(all(lt('rwyAlongM', 0), deadsideDownwind), lt('hafFt', 700)), timeoutS: 240, onTimeout: 'fail',
      criteria: [
        glide(`${pre}LoIas`),
        final(`${pre}LowKey`, 'Height at the low key', 'hafFt', 1000, 200, { required: req }),
      ] }),
    task({ id: `${pre}Fin`, exercise, brief: 'L16.securityChecks', ...coach,
      ...(assessed ? {} : { feedback: feedback({
        milestones: [
          ms('final', leg('final'), ['On final. Are we making it? Flap only when you are sure.']),
          ms('secure', all(eq('fuelSel', 'off'), lt('mixture', 0.1), eq('mags', 0)), ['Security checks done. Fly the aircraft; I will call the go-around.']),
        ],
        nudge: 'Security checks on final: fuel off, mixture cut-off, magnetos off.', nudgeAfterS: 15, nudgeEveryS: 25,
      }) }),
      card: { title: 'Base and final: security checks', targets: [ias(vs('Vglide'), glideBand), centreline(60)] },
      goal: lt('hafFt', 200), timeoutS: 240, onTimeout: 'fail',
      criteria: [
        glide(`${pre}FinIas`),
        check(`${pre}Security`, 'Security checks on final', { pred: all(eq('fuelSel', 'off'), lt('mixture', 0.1), eq('mags', 0)), required: req }),
        final(`${pre}Reach`, 'Glide reaches the touchdown zone', 'rwyAlongM', -100, 450, { required: req,
          advice: { low: 'You would have landed short: keep more height in hand until the field is made, then flap.',
            high: 'Too high: more flap, or a sideslip, once you are sure of the field.' } }),
        final(`${pre}Line`, 'Lined up with the runway', 'rwyAcrossM', 0, 60, { required: req }),
      ] }),
    setup(`${pre}Restore`, { controls: { mixture: 1, fuelSelector: 'both', magnetos: 3, fuelPump: true, masterBattery: true }, cue: 'L16.restored' }),
    task({ id: `${pre}Ga`, exercise, brief: 'L16.goAround',
      card: { title: 'Go around', targets: [ias(vs('Vy'), 'speedClimbApproach')] },
      goal: held(gt('hafFt', 400), 1), timeoutS: 90, onTimeout: 'fail', coach: [],
      criteria: goAroundCriteria(`${pre}Ga`, false).filter((c) => c.id !== `${pre}GaHdg`) }),
  ];
}

export const L16: Lesson = {
  id: 'L16', version: 1, number: 16, title: 'Forced landing without power',
  syllabusRef: { easa: 'Ex 16', faa: 'ACS IX.B' },
  stage: 'advanced', kind: 'dual', persona: 'instructor', requires: ['L14'], aircraft: 'any', estMinutes: 20,
  start: PFL_START, startOptions: { payload: 'forward', fuelFraction: 0.8 },
  weather: { preset: 'light' },
  rules: dualRules({ coachLevel: 'minimal', maxDurationS: 2400 }),
  briefing: {
    aim: 'To plan and fly a glide to a chosen field, here the runway, after an engine failure.',
    points: [
      'Glide speed first. Then choose the field, then the touch drills, then the plan.',
      'High key: 2,000 ft above the field, abeam the far end. Low key: 1,000 ft abeam the threshold.',
      'Fly the pattern to the keys; adjust it, not the speed. Flap only when the field is made.',
      'Security checks on final: fuel off, mixture cut-off, magnetos off. I will restore them for the go-around.',
    ],
    numbers: [{ label: 'Best glide', value: vs('Vglide'), unit: 'kt' }, { label: 'High key', value: 2000, unit: 'ft' },
      { label: 'Low key', value: 1000, unit: 'ft' }, { label: 'Glide ratio', value: 9, unit: '' }],
    tolerances: ['speed'],
    airmanship: ['Pick the field early and do not change your mind below the low key.', 'I keep my hand on the throttle; I call the go-around at 200 feet.'],
    keys: ['pitchDown', 'fuelSelector', 'mixtureRich', 'mixtureLean', 'magnetoBoth', 'magnetoOff', 'fuelPump', 'flapsDown'],
    diagram: { kind: 'pfl' },
    more: 'The 172S glides about 9 feet forward for every foot of height at 68 knots with the propeller windmilling: from 2,000 feet, about 3 nautical miles in still air.',
    spoken: 'L16.brief',
  },
  exercises: [
    demoEx('pflDemo', 'Demonstration: forced landing', 'forcedLanding'),
    practiceEx('pflPractice', 'Practice forced landings', 'forcedLanding'),
    assessedEx('assessedPfl', 'Assessed: forced landing from 3,000 ft', 'forcedLanding'),
  ],
  flow: [
    { id: 'demo', title: 'Demonstration', lowLevel: true, steps: [
      say('intro', 'L16.demoIntro', { wait: true }),
      demo('demoPfl', 'pfl', { followMeThrough: true }),
      say('demoWrap', 'L16.demoWrap', { wait: true }),
    ] },
    { id: 'practice', title: 'Your forced landings', lowLevel: true, repeat: { max: 2 }, retryFrom: PFL_START, steps: pfl('p', 'pflPractice', PFL_START, false) },
    { id: 'assessed', title: 'Assessed forced landing', lowLevel: true, coachLevel: 'silent', retryFrom: PFL_ABEAM, steps: [
      ...pfl('a', 'assessedPfl', PFL_ABEAM, true),
      end('fin', 'common.endDual'),
    ] },
  ],
  debriefTips: {
    'aHiIas.biasHigh': 'Fast in the glide: every extra knot costs distance. Trim for the glide speed.',
  },
  lookAhead: 'Next: crosswind take-offs and landings.',
};

// =====================================================================================================
// L17 Crosswind circuits
// =====================================================================================================

const XW_FINAL = finalStart(3, 20, undefined, 75);

/** Crosswind items at contact (wind from the right, 160 degrees): bank into wind, roll-out line, aileron. */
function crosswindCriteria(prefix: string, required = true): Criterion[] {
  return [
    binary(`${prefix}XwBank`, 'Bank at contact: into wind, under 6°', any(ev('mainsTouchdown', { bankDeg: [-90, -1] }), ev('mainsTouchdown', { bankDeg: [6, 90] })), { required,
      advice: { fail: 'Wing down into wind for the touchdown: the into-wind main wheel touches first, a few degrees only.' } }),
    { id: `${prefix}XwRoll`, label: 'Roll-out on the centreline', kind: 'atEvent', event: 'landing', field: 'rolloutMaxAcrossM', sig: 'rwyAcrossM', target: 0, tol: 8, required },
    check(`${prefix}XwAil`, 'Into-wind aileron on the roll', { pred: held(all(eq('onGround', true), lt('kias', 40), gt('kias', 5), gt('aileron', 0.15)), 4, 1), required,
      advice: { fail: 'Keep the aileron into wind as you slow down: full deflection by the time you taxi.' } }),
  ];
}

export const L17: Lesson = {
  id: 'L17', version: 1, number: 17, title: 'Crosswind take-off and landing',
  syllabusRef: { easa: 'Ex 12 & 13 (crosswind)', faa: 'ACS IV.C-D' },
  stage: 'advanced', kind: 'dual', persona: 'instructor', requires: ['L14'], aircraft: 'any', estMinutes: 22,
  start: LINEUP, startOptions: { payload: 'forward', fuelFraction: 0.8 },
  weather: { preset: 'xwind10' },
  rules: dualRules({ coachLevel: 'reduced', maxDurationS: 2700 }),
  briefing: {
    aim: 'To take off and land with a crosswind, keeping straight and on the centreline.',
    points: [
      'Take-off: full aileron into wind at the start of the roll, easing off as the speed builds.',
      'Approach: crab into wind to track the centreline.',
      'Before touchdown: rudder to align the nose with the runway, aileron into wind to stop the drift.',
      'After touchdown: keep straight and increase the into-wind aileron as you slow.',
    ],
    numbers: [{ label: 'Wind', value: 160, unit: 'deg' }, { label: 'Crosswind', value: 10, unit: 'kt' },
      { label: 'Max demonstrated crosswind', value: { setting: 'maxDemoCrosswindKt' }, unit: 'kt' }, { label: 'Vref', value: vs('Vref'), unit: 'kt' }],
    tolerances: ['centrelineM', 'speedClimbApproach', 'touchdownZoneFt', 'sinkFpm'],
    airmanship: ['Know the aircraft crosswind limit, and your own.', 'Gusts: add half the gust factor to the approach speed.'],
    keys: ['rollLeft', 'rollRight', 'rudderLeft', 'rudderRight', 'throttleUp', 'throttleDown'],
    diagram: { kind: 'landingZone' },
    spoken: 'L17.brief',
  },
  exercises: [
    demoEx('xwDemo', 'Demonstration: crosswind landing', 'crosswind'),
    practiceEx('xwTakeoff', 'Crosswind take-off', 'crosswind'),
    practiceEx('xwPractice', 'Crosswind landings', 'crosswind'),
    assessedEx('assessedXw1', 'Assessed crosswind landing 1', 'crosswind'),
    assessedEx('assessedXw2', 'Assessed crosswind landing 2', 'crosswind'),
    assessedEx('xwind15', 'Stronger crosswind: 13 kt gusting 17', 'crosswind', { required: false, weight: 1 }),
  ],
  flow: [
    { id: 'demo', title: 'Demonstration', lowLevel: true, retryFrom: XW_FINAL, steps: [
      setup('reposD', { reposition: XW_FINAL, cue: 'L17.onFinal', pf: 'instructor' }),
      say('intro', 'L17.demoIntro', { wait: true }),
      demo('demoXw', 'crosswindLanding', { followMeThrough: true }),
      say('demoWrap', 'L17.demoWrap', { wait: true }),
    ] },
    { id: 'takeoff', title: 'Crosswind take-off', lowLevel: true, retryFrom: LINEUP, steps: [
      setup('reposT', { reposition: LINEUP, cue: 'common.linedUp', pf: 'instructor' }),
      takeoffTask({ id: 'xTo', exercise: 'xwTakeoff', standard: 'training', brief: 'L17.takeoff',
        feedback: feedback({
          milestones: [
            ms('aileron', all(eq('onGround', true), gt('aileron', 0.3)), ['Aileron into wind, good. Ease it off as the speed builds.']),
            ms('airborne', all(ev('liftoff'), gt('aglFt', 50)), ['Airborne. Let it weathercock into wind, and climb at {vspeed.Vy:kt}.']),
          ],
          success: 'Good crosswind take-off. Into-wind aileron, then eased off.',
        }),
        extra: [check('xToAil', 'Into-wind aileron at the start of the roll', { pred: all(eq('onGround', true), gt('aileron', 0.3)), withinS: 10, required: true })] }),
    ] },
    { id: 'practice', title: 'Crosswind landings', lowLevel: true, repeat: { max: 3 }, retryFrom: XW_FINAL, steps: [
      setup('reposP', { reposition: XW_FINAL, cue: 'L17.onFinal', pf: 'instructor' }),
      approachLandingTask({ id: 'xP', exercise: 'xwPractice', standard: 'training', brief: 'L17.land', student: true, coach: ['crosswindDrift', 'centreline', 'approachSpeed', 'flare'],
        feedback: feedback({
          milestones: [
            ms('crab', all(leg('final'), lt('hafFt', 600), near('rwyAcrossM', 0, 15)), ['Nice crab: tracking the centreline. Rudder straight just before touchdown.']),
            ms('down', ev('mainsTouchdown'), ['Down. More aileron into wind as we slow.']),
          ],
          success: 'Good crosswind landing.',
        }),
        extra: crosswindCriteria('xP') }),
    ] },
    { id: 'assessed1', title: 'Assessed crosswind landing 1', lowLevel: true, coachLevel: 'silent', retryFrom: XW_FINAL, steps: [
      setup('reposA', { reposition: XW_FINAL, cue: 'L17.onFinal', pf: 'instructor' }),
      say('quiet', 'common.illStayQuiet', { wait: true }),
      approachLandingTask({ id: 'xA1', exercise: 'assessedXw1', standard: 'test', brief: 'L17.land', student: true, coach: [], extra: crosswindCriteria('xA1') }),
    ] },
    { id: 'assessed2', title: 'Assessed crosswind landing 2', lowLevel: true, coachLevel: 'silent', retryFrom: XW_FINAL, steps: [
      setup('reposB', { reposition: XW_FINAL, cue: 'L17.onFinal', pf: 'instructor' }),
      approachLandingTask({ id: 'xA2', exercise: 'assessedXw2', standard: 'test', brief: 'L17.land', student: true, coach: [], extra: crosswindCriteria('xA2') }),
    ] },
    { id: 'strong', title: 'Stronger crosswind', lowLevel: true, coachLevel: 'silent', retryFrom: XW_FINAL, steps: [
      setup('reposS', { reposition: XW_FINAL, weather: { preset: 'xwind15' }, cue: 'L17.stronger', pf: 'instructor' }),
      approachLandingTask({ id: 'x15', exercise: 'xwind15', standard: 'test', brief: 'L17.land', student: true, coach: [], extra: crosswindCriteria('x15') }),
      end('fin', 'common.endDual'),
    ] },
  ],
  debriefTips: {
    'xA1Slope.biasLow': 'Low on the slope in the gusts: carry a little more power and speed on a gusty day.',
  },
  lookAhead: 'Next: short-field take-offs and landings.',
};

// =====================================================================================================
// L18 Short-field take-off and landing
// =====================================================================================================

const SHORT_FINAL = finalStart(2, 30, 0, vs('VshortField'));
/** Short-field rotation speed, KIAS (POH 172S short-field take-off: lift off at 51 KIAS). */
const SHORT_VR = 51;

function shortTakeoffTask(id: string, exercise: string, standard: 'training' | 'test', brief: string): StepDef {
  // From 20 ft: below it the aircraft has just lifted off at the short-field rotation speed (51 kt, the
  // lift-off band 48-58 kt below) and is still accelerating to Vx in ground effect, so a window opening at
  // lift-off could never be flown inside Vx -0/+10 (wave-2 integration fix; was aglFt > 5).
  const climbing50 = all(gt('aglFt', 20), lt('aglFt', 50));
  return task({
    id, exercise, pf: 'student', brief,
    card: { title: 'Short-field take-off', targets: [ias(vs('Vx'), { minus: 0, plus: 10 }), hdg(RWY_HDG), centreline()] },
    goal: gt('aglFt', 300), timeoutS: 240, onTimeout: 'fail', coach: standard === 'test' ? [] : ['ball'],   // the card speed (Vx) applies to 50 ft only: too short to coach
    criteria: [
      binary(`${id}Flap`, 'Flap 10 for take-off', all(eq('onGround', true), gt('kias', 20), not(near('flapsDeg', 10, 3))), { required: true }),
      check(`${id}Brakes`, 'Full power against the brakes', { pred: all(gt('brakes', 0.5), gt('throttle', 0.9)), required: true,
        advice: { fail: 'Hold the brakes, set full power, check the gauges, then release.' } }),
      { id: `${id}Vr`, label: 'Lift-off speed', kind: 'atEvent', event: 'liftoff', field: 'kias', sig: 'kias', target: SHORT_VR, tol: { minus: 3, plus: 7 }, required: true },
      peak(`${id}VxLow`, 'Lowest speed to 50 ft', 'kias', vs('Vx'), { minus: 0, plus: 100 }, { peakOf: 'min', activeWhen: climbing50, required: true }),
      peak(`${id}VxHigh`, 'Highest speed to 50 ft', 'kias', vs('Vx'), { minus: 100, plus: 10 }, { peakOf: 'max', activeWhen: climbing50, required: true,
        advice: { high: 'Hold Vx to 50 feet: that is the steepest climb over the obstacle.' } }),
      hold(`${id}Vy`, 'Vy above 100 ft', 'asiKt', vs('Vy'), 'speedClimbApproach', { settleS: 5, activeWhen: gt('aglFt', 100), required: false }),
    ],
  });
}

function shortLandingTask(id: string, exercise: string, standard: 'training' | 'test', brief: string, student: boolean) {
  return approachLandingTask({ id, exercise, standard, brief, student, vref: vs('VshortField'), zone: 'touchdownZoneShortFt', slope: 'shown',
    ...(standard === 'test' ? {} : { feedback: approachFeedback({ vref: vs('VshortField') }) }),
    coach: standard === 'test' ? [] : ['approachSpeed', 'glidepath', 'centreline', 'flare'],
    extra: [
      hold(`${id}Vsf`, 'Short-field speed on final', 'asiKt', vs('VshortField'), { minus: 5, plus: 10 }, { settleS: 5, activeWhen: all(leg('final'), lt('hafFt', 500), gt('hafFt', 50)), required: true }),
      final(`${id}Stop`, 'Stopped at (from the threshold)', 'rwyAlongM', 450, 450, { required: false, chart: false }),
    ] });
}

export const L18: Lesson = {
  id: 'L18', version: 1, number: 18, title: 'Short-field take-off and landing',
  syllabusRef: { easa: 'Ex 12 & 13 (short field)', faa: 'ACS IV.E-F' },
  stage: 'advanced', kind: 'dual', persona: 'instructor', requires: ['L14'], aircraft: 'any', estMinutes: 18,
  start: LINEUP, startOptions: { payload: 'forward', fuelFraction: 0.8 },
  weather: { preset: 'calm' },
  rules: dualRules({ coachLevel: 'reduced', maxDurationS: 2400 }),
  briefing: {
    aim: 'To fly a maximum-performance take-off and a precise short landing.',
    points: [
      'Take-off: flap 10, hold the brakes, full power, then release. Lift off at 51 knots.',
      'Climb at Vx to 50 feet to clear the obstacle, then lower the nose to Vy and raise the flap.',
      'Landing: full flap, final at 61 knots, power to hold the aim point exactly.',
      'Touch down firmly on the point, then flap up and maximum braking.',
    ],
    numbers: [{ label: 'Lift-off', value: SHORT_VR, unit: 'kt' }, { label: 'Vx', value: vs('Vx'), unit: 'kt' }, { label: 'Vy', value: vs('Vy'), unit: 'kt' },
      { label: 'Short final', value: vs('VshortField'), unit: 'kt' }],
    tolerances: ['touchdownZoneShortFt', 'speedClimbApproach', 'sinkFpm'],
    airmanship: ['Short-field speeds leave little margin: no turns below 300 feet.', 'Brake hard but keep straight.'],
    keys: ['flapsDown', 'flapsUp', 'brakes', 'throttleFull', 'throttleIdle', 'pitchUp'],
    diagram: { kind: 'landingZone' },
    spoken: 'L18.brief',
  },
  exercises: [
    practiceEx('shortToPractice', 'Short-field take-off', 'shortField'),
    practiceEx('shortLdgPractice', 'Short-field landings', 'shortField'),
    assessedEx('assessedShortTo', 'Assessed: short-field take-off', 'shortField'),
    assessedEx('assessedShortLdg', 'Assessed: short-field landing', 'shortField'),
  ],
  flow: [
    { id: 'takeoffs', title: 'Short-field take-offs', lowLevel: true, retryFrom: LINEUP, steps: [
      say('intro', 'L18.intro', { wait: true }),
      shortTakeoffTask('sTo', 'shortToPractice', 'training', 'L18.takeoff'),
    ] },
    { id: 'landings', title: 'Short-field landings', lowLevel: true, repeat: { max: 2 }, retryFrom: SHORT_FINAL, steps: [
      setup('reposL', { reposition: SHORT_FINAL, cue: 'L18.onFinal', pf: 'instructor' }),
      shortLandingTask('sL', 'shortLdgPractice', 'training', 'L18.land', true),
    ] },
    { id: 'assessedTo', title: 'Assessed take-off', lowLevel: true, coachLevel: 'silent', retryFrom: LINEUP, steps: [
      circuitPieces.lineUp('reposAT'),
      say('quiet', 'common.illStayQuiet', { wait: true }),
      shortTakeoffTask('aTo', 'assessedShortTo', 'test', 'L18.takeoff'),
    ] },
    { id: 'assessedLdg', title: 'Assessed landing', lowLevel: true, coachLevel: 'silent', retryFrom: SHORT_FINAL, steps: [
      setup('reposAL', { reposition: SHORT_FINAL, cue: 'L18.onFinal', pf: 'instructor' }),
      shortLandingTask('aL', 'assessedShortLdg', 'test', 'L18.land', true),
      end('fin', 'common.endDual'),
    ] },
  ],
  debriefTips: {
    'aLVsf.biasHigh': 'Fast on short final: every extra knot is runway used in the float.',
  },
  lookAhead: 'Next: flight by instruments, and recovery from unusual attitudes.',
};

// =====================================================================================================
// L19 Instrument appreciation and unusual attitudes
// =====================================================================================================

export const L19: Lesson = {
  id: 'L19', version: 1, number: 19, title: 'Instrument appreciation and unusual attitudes',
  syllabusRef: { easa: 'Ex 19', faa: 'ACS VIII' },
  stage: 'advanced', kind: 'dual', persona: 'instructor', requires: ['L14'], aircraft: 'any', estMinutes: 20,
  start: areaStart(4000, 200), startOptions: { payload: 'forward', fuelFraction: 0.8 },
  weather: { preset: 'smooth' },
  // The unusual attitudes start beyond the normal pitch limits and close to the stall: the envelope allows them.
  rules: dualRules({ coachLevel: 'reduced', maxDurationS: 2400, hood: true,
    envelope: { ...UPPER_AIR, maxPitchUpDeg: 30, maxPitchDownDeg: -30, stallAllowed: true } }),
  briefing: {
    aim: 'To fly basic manoeuvres by sole reference to the instruments, and recover from unusual attitudes.',
    points: [
      'Selective radial scan: the attitude indicator is the centre; glance out to one instrument and back.',
      'Believe the instruments, not your senses: the balance organs are fooled in cloud.',
      'Rate-one turn: 3 degrees per second, about 15 degrees of bank at 100 knots.',
      'Unusual attitude: read the attitude indicator and the airspeed, then recover in the right order.',
    ],
    numbers: [{ label: 'Rate-one turn bank at 100 kt', value: 15, unit: 'deg' }, { label: 'Vy', value: vs('Vy'), unit: 'kt' },
      { label: 'Descent', value: 500, unit: 'fpm' }, { label: 'Vne', value: vs('Vne'), unit: 'kt' }],
    tolerances: ['instrAltitude', 'instrHeading', 'speed', 'turnRate'],
    airmanship: ['Under the hood I am the lookout: I will keep us clear.', 'If you lose the picture, say so: I have control.'],
    keys: ['pitchUp', 'pitchDown', 'rollLeft', 'rollRight', 'throttleUp', 'throttleDown', 'throttleIdle', 'throttleFull'],
    diagram: { kind: 'turn', bankDeg: 15 },
    more: 'Nose low and speed increasing: power off, roll wings level, then ease out of the dive. Nose high and speed decreasing: full power, lower the nose to the horizon, then level the wings.',
    spoken: 'L19.brief',
  },
  exercises: [
    demoEx('scanDemo', 'Demonstration: the instrument scan', 'instrument'),
    practiceEx('instrPractice', 'Instrument flying practice', 'instrument'),
    assessedEx('assessedInstr', 'Assessed: basic instrument flight', 'instrument'),
    assessedEx('assessedUa', 'Assessed: unusual-attitude recoveries', 'unusualAttitude'),
  ],
  flow: [
    { id: 'demo', title: 'Demonstration', steps: [
      setup('hoodOn', { hood: true, cue: 'L19.hoodOn' }),
      say('intro', 'L19.demoIntro', { wait: true }),
      capture('cap0', { alt0: 'altFt', hdg0: 'hdgDeg' }),
      demo('demoScan', 'instrumentScan', { followMeThrough: true, highlight: ['ai', 'alt', 'dg', 'asi'] }),
      say('demoWrap', 'L19.demoWrap', { wait: true }),
    ] },
    { id: 'practice', title: 'Instrument practice', retryFrom: areaStart(4000, 200), steps: [
      backToArea('repos', 4000, 200),
      capture('capP', { a0: 'altFt', hdg0: 'hdgDeg' }),
      straightLevelTask({ id: 'pSL', exercise: 'instrPractice', brief: 'L19.straightLevel', altVar: 'a0', hdgVar: 'hdg0', kias: vs('Vcruise'), seconds: 60, instrument: true,
        feedback: feedback({
          milestones: [ms('steady', held(all(near('altFt', v('a0'), 60), near('hdgDeg', v('hdg0'), 5)), 10), ['Good scan. Attitude, altimeter, attitude, heading, attitude.'], 10)],
          nudge: 'Back to the attitude indicator after every glance.', nudgeAfterS: 20, nudgeEveryS: 30,
        }) }),
      rateOneTurnTask({ id: 'pTurn', exercise: 'instrPractice', brief: 'L19.rateOneRight', dir: 'right', altVar: 'a0', hdgVar: 'hdg0', kias: vs('Vcruise'),
        feedback: feedback({
          start: 'Go ahead: roll right until the turn coordinator shows rate one, about 15 degrees.',
          milestones: [ms('rate', held(near('turnRate', 1, 0.2), 3), ['Rate one. Hold that bank on the attitude indicator.'])],
          success: 'Good. Rate one: three degrees a second, two minutes for a full turn.',
        }) }),
      capture('capPc', { up: { sig: 'altFt', add: 500 }, hdg1: 'hdgDeg' }),
      climbTask({ id: 'pClimb', exercise: 'instrPractice', brief: { id: 'L19.climbTo', vars: { alt: { var: 'up' } } }, tgtVar: 'up', hdgVar: 'hdg1', instrument: true,
        feedback: climbFeedback({ tgtVar: 'up', instrument: true }) }),
      capture('capPd', { down: { var: 'a0' } }),
      descentTask({ id: 'pDesc', exercise: 'instrPractice', brief: { id: 'L19.descendTo', vars: { alt: { var: 'down' } } }, tgtVar: 'down', hdgVar: 'hdg1', instrument: true,
        feedback: descentFeedback({ tgtVar: 'down', instrument: true }) }),
    ] },
    { id: 'assessed', title: 'Assessed instrument flight', coachLevel: 'silent', retryFrom: areaStart(4000, 200), steps: [
      backToArea('reposA', 4000, 200),
      say('quiet', 'common.illStayQuiet', { wait: true }),
      capture('capA', { a1: 'altFt', hdg1: 'hdgDeg' }),
      straightLevelTask({ id: 'aSL', exercise: 'assessedInstr', brief: 'L19.straightLevel', altVar: 'a1', hdgVar: 'hdg1', kias: vs('Vcruise'), seconds: 120, instrument: true, coach: [] }),
      rateOneTurnTask({ id: 'aTurn', exercise: 'assessedInstr', brief: 'L19.rateOneLeft', dir: 'left', altVar: 'a1', hdgVar: 'hdg1', kias: vs('Vcruise'), coach: [] }),
      capture('capAc', { up: { sig: 'altFt', add: 500 }, hdg2: 'hdgDeg' }),
      climbTask({ id: 'aClimb', exercise: 'assessedInstr', brief: { id: 'L19.climbTo', vars: { alt: { var: 'up' } } }, tgtVar: 'up', hdgVar: 'hdg2', instrument: true, coach: [] }),
      capture('capAd', { down: { var: 'a1' } }),
      descentTask({ id: 'aDesc', exercise: 'assessedInstr', brief: { id: 'L19.descendTo', vars: { alt: { var: 'down' } } }, tgtVar: 'down', hdgVar: 'hdg2', instrument: true, coach: [] }),
    ] },
    { id: 'unusual', title: 'Unusual attitudes', coachLevel: 'silent', retryFrom: areaStart(4500, 200), steps: [
      backToArea('reposU', 4500, 200),
      say('closeEyes', 'L19.closeEyes', { wait: true }),
      demo('setHigh', 'unusualNoseHigh', { followMeThrough: false }),
      unusualAttitudeTask({ id: 'uaHigh', exercise: 'assessedUa', brief: 'L19.recoverNow', kind: 'noseHigh' }),
      backToArea('reposU2', 5000, 200),
      say('again', 'L19.closeEyesAgain', { wait: true }),
      demo('setLow', 'unusualNoseLow', { followMeThrough: false }),
      unusualAttitudeTask({ id: 'uaLow', exercise: 'assessedUa', brief: 'L19.recoverNow', kind: 'noseLow' }),
      setup('hoodOff', { hood: false, cue: 'L19.hoodOff' }),
      end('fin', 'common.endDual'),
    ] },
  ],
  debriefTips: {
    'aSLAlt.drift': 'A slow altitude drift: your scan was missing the altimeter. AI, altimeter, AI, heading, AI.',
    'aTurnRate.biasHigh': 'Turning too fast: at 105 knots rate one needs about 16 degrees of bank.',
  },
  lookAhead: 'Next: navigation. A closed route by map, compass and clock.',
};

export const STAGE3: readonly Lesson[] = [L15, L16, L17, L18, L19];

// Shared with the skill test (L21).
export const advancedPieces = { pfl, PFL_ABEAM, shortLandingTask, crosswindCriteria };
