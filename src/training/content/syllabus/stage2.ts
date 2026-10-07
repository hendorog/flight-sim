// Stage 2, circuits and first solo: L08-L14 (section 4.1). Runway 07, left-hand circuits at 1,000 ft above
// the field. Practice phases reposition behind the curtain (line-up, final, downwind) instead of taxiing back.
//
// Choices where section 4.1 is silent or cannot be expressed literally (also in the module report):
// - "Assessed x2" (L09, L10) is two exercises, one per attempt, so both must reach the standard; practice
//   repeats score one exercise and the best attempt counts (section 3.4).
// - The go-around call height "random 300-100 ft" (L11) is 250 ft on the first approach and 150 ft on the
//   second: predicates have no random source, and two fixed heights cover the band.
// - "Projected glide reaches the runway" (L12 downwind failure) is graded where the instructor calls the
//   go-around, at 200 ft above the field: at a 9:1 glide that leaves about 550 m, so the aircraft must be
//   between 450 m short of the threshold and 350 m beyond it, lined up within 60 m.

import {
  all, any, binary, check, checklist, demo, end, eq, ev, ever, final, gt, handover, held, hold, le, leg, lt, near,
  peak, say, setup, vs, wait,
} from '../../engine/dsl';
import type { Criterion, Lesson, StepDef } from '../../types';
import {
  approachLandingTask, assessedEx, centreline, demoEx, DOWNWIND_MID, downwindTask, dualRules, finalStart,
  goAroundCriteria, hdg, HOLD_A1, ias, landingCriteria, LINEUP, practiceEx, RWY_HDG, soloRules, takeoffTask,
  task,
} from './common';
import { touchDrills } from './manoeuvres';
import { tuneLessonCoach } from '../coachPresets';
import { approachFeedback, downwindFeedback, feedback, limits, ms, takeoffFeedback } from './instruction';

/** A go-around (L11, L12): what she says as it comes together. */
const GO_AROUND_TALK = feedback({
  milestones: [
    ms('power', gt('throttle', 0.9), ['Full power. Now stop the descent: climb attitude.']),
    ms('climbing', all(ever(gt('throttle', 0.9)), held(gt('vsFpm', 200), 1)), ['Climbing. Flap up a stage once above 60 knots.']),
  ],
  success: 'Good go-around: power, attitude, then the flap in stages.',
});

const lineUp = (id: string) => setup(id, { reposition: LINEUP, cue: 'common.linedUp', pf: 'instructor' });

/** One circuit from the line-up to a full stop: take-off, downwind checks, downwind, approach and landing. */
function circuit(o: { pre: string; exercise: string; standard: 'training' | 'test'; checks: 'flow' | 'silent'; quiet?: boolean; first?: boolean }): StepDef[] {
  const coach = o.quiet ? { coach: [] } : {};
  // Practice circuits are talked through (lightly: by L10 the student has flown each part before).
  const talk = <T extends object>(f: T): T | object => (o.quiet ? {} : f);
  return [
    takeoffTask({ id: `${o.pre}To`, exercise: o.exercise, standard: o.standard, brief: o.first ? 'L10.firstCircuit' : 'L10.circuitAgain', ...coach,
      ...talk({ feedback: takeoffFeedback() }) }),
    checklist(`${o.pre}Dw`, 'downwind', o.checks, { exercise: o.exercise, when: leg('downwind'), timeoutS: 300, onTimeout: 'next' }),
    downwindTask({ id: `${o.pre}Down`, exercise: o.exercise, standard: o.standard, brief: 'L10.downwind', ...coach, ...talk({ feedback: downwindFeedback() }) }),
    approachLandingTask({ id: `${o.pre}Ldg`, exercise: o.exercise, standard: o.standard, brief: 'L10.baseFinal', ...coach, ...talk({ feedback: approachFeedback() }) }),
  ];
}

// =====================================================================================================
// L08 Take-off and climb
// =====================================================================================================

/**
 * Take-off limits: bank beyond 30 deg, or the nose above 20 deg (an over-rotation that will stall) or below -5 deg
 * (pushing over toward the runway). No speed limit: a TaskLimit has no condition, and the roll starts at zero.
 */
const TAKEOFF_LIMITS = limits({ bank: 30, pitchUp: 20, pitchDown: -5 });

export const L08: Lesson = tuneLessonCoach({
  id: 'L08', version: 1, number: 8, title: 'Take-off and climb',
  syllabusRef: { easa: 'Ex 12', faa: 'ACS IV.A' },
  stage: 'circuits', kind: 'dual', persona: 'instructor', requires: ['L07'], aircraft: 'any', estMinutes: 12,
  start: LINEUP, startOptions: { payload: 'forward', fuelFraction: 0.8 },
  weather: { preset: 'light' },
  rules: dualRules({ coachLevel: 'full', maxDurationS: 1500 }),
  briefing: {
    aim: 'To fly a normal take-off, keeping straight, and climb away at Vy.',
    points: [
      'Before take-off checks complete, landing light on, flaps up.',
      'Full power smoothly; keep straight on the centreline with rudder: the aircraft swings left.',
      'Rotate at Vr, about 55 knots: raise the nose to the climb attitude and let it fly off.',
      'Accelerate to Vy and climb on runway heading; after-take-off checks at 500 ft.',
    ],
    numbers: [{ label: 'Vr', value: vs('Vr'), unit: 'kt' }, { label: 'Vx', value: vs('Vx'), unit: 'kt' }, { label: 'Vy', value: vs('Vy'), unit: 'kt' },
      { label: 'Runway heading', value: RWY_HDG, unit: 'deg' }, { label: 'Circuit height', value: { setting: 'patternAglFt' }, unit: 'ft' }],
    tolerances: ['centrelineM', 'speedClimbApproach', 'heading'],
    airmanship: ['Check the approach is clear before lining up.', 'Abandon the take-off if anything is wrong: close the throttle and brake.',
      'Note the time of departure.'],
    keys: ['throttleFull', 'rudderLeft', 'rudderRight', 'pitchUp', 'landingLight', 'trimNoseUp'],
    diagram: { kind: 'circuit' },
    spoken: 'L08.brief',
  },
  exercises: [
    demoEx('toDemo', 'Demonstration: normal take-off', 'takeoff'),
    practiceEx('toPractice', 'Take-off and climb', 'takeoff'),
    assessedEx('assessedTakeoff', 'Assessed: normal take-off and climb', 'takeoff'),
  ],
  flow: [
    { id: 'demo', title: 'Demonstration', lowLevel: true, steps: [
      say('intro', 'L08.demoIntro', { wait: true }),
      demo('demoTo', 'takeoff', { followMeThrough: true, highlight: ['asi'] }),
      say('demoWrap', 'L08.demoWrap', { wait: true }),
    ] },
    { id: 'practice', title: 'Your take-offs', lowLevel: true, repeat: { max: 2 }, retryFrom: LINEUP, steps: [
      lineUp('repos'),
      takeoffTask({ id: 'pTo', exercise: 'toPractice', standard: 'training', brief: 'L08.yourTakeoff', feedback: takeoffFeedback(), limits: TAKEOFF_LIMITS }),
      say('pDone', 'L08.practiceDone', { wait: true }),
    ] },
    { id: 'assessed', title: 'Assessed take-off', lowLevel: true, coachLevel: 'silent', retryFrom: LINEUP, steps: [
      lineUp('reposA'),
      say('quiet', 'common.illStayQuiet', { wait: true }),
      handover('toStudent', 'student'),
      checklist('ckBeforeTo', 'beforeTakeoff', 'flow', { exercise: 'assessedTakeoff', timeoutS: 90, onTimeout: 'next' }),
      takeoffTask({ id: 'aTo', exercise: 'assessedTakeoff', standard: 'test', brief: 'L08.assessedTakeoff', coach: [],
        extra: [binary('aToLight', 'Landing light on for take-off', all(gt('kias', 30), eq('lightLanding', false)), { required: true })],
        feedback: feedback({ success: ['Thank you.', 'Thank you. Nicely flown.'] }), limits: TAKEOFF_LIMITS }),
      end('fin', 'common.endDual'),
    ] },
  ],
  debriefTips: {
    'aToCl.biasLow': 'You drifted left on the roll: more right rudder as the power comes up.',
    'aToVy.biasHigh': 'The climb was fast: raise the nose a little more after lift-off and trim for Vy.',
  },
  lookAhead: 'Next: the approach and landing, from a long final.',
});

// =====================================================================================================
// L09 Approach and landing
// =====================================================================================================

const FINAL3 = finalStart(3, 20, undefined, 75);
const onFinal = (id: string) => setup(id, { reposition: FINAL3, cue: 'L09.onFinal', pf: 'instructor' });

export const L09: Lesson = {
  id: 'L09', version: 1, number: 9, title: 'Approach and landing',
  syllabusRef: { easa: 'Ex 13', faa: 'ACS IV.B' },
  stage: 'circuits', kind: 'dual', persona: 'instructor', requires: ['L08'], aircraft: 'any', estMinutes: 14,
  start: FINAL3, startOptions: { payload: 'forward', fuelFraction: 0.8 },
  weather: { preset: 'light' },
  rules: dualRules({ coachLevel: 'full', maxDurationS: 1800 }),
  briefing: {
    aim: 'To fly a stabilised approach and land in the touchdown zone.',
    points: [
      'Stabilised by 300 ft: on speed, on the centreline, landing flap, sink under 1,000 fpm. If not, go around.',
      'Power controls the path, attitude controls the speed. Watch the PAPI: two white, two red.',
      'Aim point fixed in the windscreen; at about 15 ft, close the throttle and start the flare.',
      'Hold it off: keep raising the nose until the mains touch, nose wheel held off.',
    ],
    numbers: [{ label: 'Approach, flap 20', value: vs('Vapp'), unit: 'kt' }, { label: 'Final, flap 30 (Vref)', value: vs('Vref'), unit: 'kt' },
      { label: 'Descent on a 3° path', value: 400, unit: 'fpm' }, { label: 'Stabilised gate', value: 300, unit: 'ft' }],
    tolerances: ['speedClimbApproach', 'glidepathFt', 'touchdownZoneFt', 'centrelineM', 'sinkFpm'],
    airmanship: ['Go around whenever the approach is not stable at 300 ft.', 'After landing, keep straight and slow to taxi speed before turning off.'],
    keys: ['throttleUp', 'throttleDown', 'throttleIdle', 'flapsDown', 'pitchUp', 'pitchDown', 'rudderLeft', 'rudderRight', 'brakes'],
    diagram: { kind: 'landingZone' },
    more: 'A stabilised approach leaves only small corrections for the last 300 ft, so all your attention can go to the flare. Most landing accidents start with an approach that was not stable.',
    spoken: 'L09.brief',
  },
  exercises: [
    demoEx('ldgDemo', 'Demonstration: approach and landing', 'landing'),
    practiceEx('ldgPractice', 'Approaches and landings', 'landing'),
    assessedEx('assessedLanding1', 'Assessed landing 1', 'landing'),
    assessedEx('assessedLanding2', 'Assessed landing 2', 'landing'),
  ],
  flow: [
    { id: 'demo', title: 'Demonstration', lowLevel: true, steps: [
      say('intro', 'L09.demoIntro', { wait: true }),
      demo('demoLdg', 'landing', { followMeThrough: true, highlight: ['asi'] }),
      say('demoWrap', 'L09.demoWrap', { wait: true }),
    ] },
    { id: 'practice', title: 'Your landings', lowLevel: true, repeat: { max: 3 }, retryFrom: FINAL3, steps: [
      onFinal('repos'),
      approachLandingTask({ id: 'pLdg', exercise: 'ldgPractice', standard: 'training', brief: 'L09.yourLanding', student: true, feedback: approachFeedback() }),
    ] },
    { id: 'assessed1', title: 'Assessed landing 1', lowLevel: true, coachLevel: 'reduced', retryFrom: FINAL3, steps: [
      onFinal('reposA'),
      say('quiet', 'L09.assessedIntro', { wait: true }),
      approachLandingTask({ id: 'a1Ldg', exercise: 'assessedLanding1', standard: 'test', brief: 'L09.yourLanding', student: true, slope: 'required' }),
    ] },
    { id: 'assessed2', title: 'Assessed landing 2', lowLevel: true, coachLevel: 'reduced', retryFrom: FINAL3, steps: [
      onFinal('reposB'),
      approachLandingTask({ id: 'a2Ldg', exercise: 'assessedLanding2', standard: 'test', brief: 'L09.yourLanding', student: true, slope: 'required' }),
      end('fin', 'common.endDual'),
    ] },
  ],
  debriefTips: {
    'a1LdgSlope.biasHigh': 'High on the slope: take off a little power early, before you need a big correction.',
    'a1LdgSlope.biasLow': 'Low on the slope: add power at once; never chase the aim point with the nose.',
  },
  lookAhead: 'Next: the full circuit, from take-off to landing.',
};

// =====================================================================================================
// L10 The circuit
// =====================================================================================================

export const L10: Lesson = {
  id: 'L10', version: 1, number: 10, title: 'The circuit',
  syllabusRef: { easa: 'Ex 13', faa: 'ACS III.B' },
  stage: 'circuits', kind: 'dual', persona: 'instructor', requires: ['L09'], aircraft: 'any', estMinutes: 30,
  start: LINEUP, startOptions: { payload: 'forward', fuelFraction: 0.8 },
  weather: { preset: 'light' },
  rules: dualRules({ coachLevel: 'reduced', maxDurationS: 3000 }),
  briefing: {
    aim: 'To fly a complete left-hand circuit at 1,000 ft and land.',
    points: [
      'Climb straight ahead to 500 ft, then turn left onto crosswind; level at 1,000 ft on downwind.',
      'Downwind: 2,200 rpm, 90 kt, wingtip just along the runway, downwind checks.',
      'Abeam the threshold: 1,500 rpm, flap 10. Turn base at 45 degrees behind the threshold, flap 20.',
      'Final: flap 30, Vref, stabilised by 300 ft, then land.',
    ],
    numbers: [{ label: 'Circuit height', value: { setting: 'patternAglFt' }, unit: 'ft' }, { label: 'Downwind speed', value: vs('Vdownwind'), unit: 'kt' },
      { label: 'Downwind power', value: { setting: 'circuitRpm' }, unit: 'rpm' }, { label: 'Downwind spacing', value: 0.85, unit: 'nm' },
      { label: 'Approach, flap 20', value: vs('Vapp'), unit: 'kt' }, { label: 'Vref, flap 30', value: vs('Vref'), unit: 'kt' }],
    tolerances: ['altitude', 'speed', 'speedClimbApproach', 'touchdownZoneFt', 'sinkFpm'],
    airmanship: ['Lookout before each turn, especially for traffic joining.', 'Downwind checks: brakes, undercarriage fixed, mixture rich, fuel on both, harness, hatches.'],
    keys: ['throttleUp', 'throttleDown', 'flapsDown', 'flapsUp', 'trimNoseUp', 'trimNoseDown', 'landingLight', 'ack'],
    diagram: { kind: 'circuit' },
    spoken: 'L10.brief',
  },
  exercises: [
    demoEx('cctDemo', 'Demonstration: one circuit', 'circuit'),
    practiceEx('cctPractice', 'Circuits to a full stop', 'circuit'),
    assessedEx('assessedCircuit1', 'Assessed circuit 1', 'circuit'),
    assessedEx('assessedCircuit2', 'Assessed circuit 2', 'circuit'),
  ],
  flow: [
    { id: 'demo', title: 'Demonstration', lowLevel: true, steps: [
      say('intro', 'L10.demoIntro', { wait: true }),
      demo('demoCct', 'circuit', { followMeThrough: true }),
      say('demoWrap', 'L10.demoWrap', { wait: true }),
    ] },
    { id: 'practice', title: 'Your circuits', lowLevel: true, repeat: { max: 2 }, retryFrom: LINEUP, steps: [
      lineUp('repos'),
      ...circuit({ pre: 'p', exercise: 'cctPractice', standard: 'training', checks: 'flow', first: true }),
    ] },
    { id: 'assessed1', title: 'Assessed circuit 1', lowLevel: true, coachLevel: 'silent', retryFrom: LINEUP, steps: [
      lineUp('reposA'),
      say('quiet', 'common.illStayQuiet', { wait: true }),
      ...circuit({ pre: 'a1', exercise: 'assessedCircuit1', standard: 'test', checks: 'flow', quiet: true }),
    ] },
    { id: 'assessed2', title: 'Assessed circuit 2', lowLevel: true, coachLevel: 'silent', retryFrom: LINEUP, steps: [
      lineUp('reposB'),
      ...circuit({ pre: 'a2', exercise: 'assessedCircuit2', standard: 'test', checks: 'flow', quiet: true }),
      end('fin', 'common.endDual'),
    ] },
  ],
  debriefTips: {
    'a1DownHgt.drift': 'Your height crept away on downwind: check the altimeter every few seconds and trim.',
    'a1DownSpace.biasHigh': 'Wide on downwind: put the runway just under the wingtip.',
    'a1DownSpace.biasLow': 'Close on downwind: a short base leaves no time to stabilise.',
  },
  lookAhead: 'Next: go-arounds, flapless and glide approaches.',
};

// =====================================================================================================
// L11 Go-arounds, flapless and glide approaches
// =====================================================================================================

const FINAL2_LANDING = finalStart(2, 30, 0, vs('Vref'));
/** The unstable set-up: 1 NM, 150 ft high, 85 kt, flap 10. */
const UNSTABLE = finalStart(1, 10, 150, 85);

/** Approach until the call height, then the go-around on the instructor's call. */
function goAroundOnCall(pre: string, exercise: string, callFt: number, quiet = false): StepDef[] {
  return [
    setup(`${pre}Repos`, { reposition: FINAL2_LANDING, cue: 'L11.onFinal', pf: 'instructor' }),
    task({ id: `${pre}App`, exercise, pf: 'student', brief: 'L11.flyApproach',
      card: { title: 'Approach: expect a go-around', targets: [ias(vs('Vref'), 'speedClimbApproach'), centreline(45)] },
      goal: lt('hafFt', callFt), timeoutS: 180, onTimeout: 'next', coach: ['approachSpeed', 'glidepath', 'centreline'], criteria: [],
      ...(quiet ? {} : { feedback: feedback({
        start: 'Your aircraft. Fly it as if to land: on speed, on the slope, on the centreline.',
        milestones: [ms('stable', all(leg('final'), near('asiKt', vs('Vref'), 5), lt('hafFt', 600)), ['Nicely stable. Hand on the throttle, ready for my call.'])],
        nudge: 'Power for the slope, attitude for the speed.', nudgeAfterS: 20, nudgeEveryS: 30,
      }) }) }),
    task({ id: `${pre}Ga`, exercise, brief: 'L11.goAroundNow',
      card: { title: 'Go around', targets: [ias(vs('Vy'), 'speedClimbApproach'), hdg(RWY_HDG, 10)] },
      goal: held(gt('hafFt', 500), 1), timeoutS: 90, onTimeout: 'fail', coach: ['speed', 'heading', 'flapLimit'],
      criteria: goAroundCriteria(`${pre}Ga`),
      ...(quiet ? {} : { feedback: GO_AROUND_TALK }) }),
  ];
}

/** Stable through the 300-200 ft window: what makes continuing the unstable set-up acceptable. */
const stableNow = all(leg('final'), near('kias', vs('Vref'), 'speedClimbApproach'), near('rwyAcrossM', 0, 45), gt('vsFpm', -1000), gt('flapsDeg', 25));

function glideApproachCriteria(prefix: string, standard: 'training' | 'test'): Criterion[] {
  const landing = landingCriteria({ prefix, standard, vref: vs('Vglide') }).filter((c) => c.id !== `${prefix}zone` && c.id !== `${prefix}vref`);
  return [
    check(`${prefix}Closed`, 'Throttle closed abeam the aim point', { pred: all(lt('throttle', 0.1), leg('downwind')), required: true }),
    binary(`${prefix}NoPower`, 'No power once the throttle is closed', held(all(gt('throttle', 0.25), leg('base', 'final'), gt('hafFt', 50)), 2), { required: true,
      advice: { fail: 'A glide approach is flown without power: judge it with the turn onto base, flap, and a sideslip.' } }),
    hold(`${prefix}Ias`, 'Glide speed', 'asiKt', vs('Vglide'), 'speed', { settleS: 8, activeWhen: all(leg('base', 'final'), gt('hafFt', 100)), required: true }),
    { id: `${prefix}Zone`, label: 'Touchdown in the first third', kind: 'atEvent', event: 'landing', field: 'distAimFt', sig: 'distAimFt', target: 0, tol: { minus: 0, plus: 600 }, required: true },
    ...landing,
  ];
}

export const L11: Lesson = {
  id: 'L11', version: 1, number: 11, title: 'Go-arounds, flapless and glide approaches',
  syllabusRef: { easa: 'Ex 13', faa: 'ACS IV.B, IV.N' },
  stage: 'circuits', kind: 'dual', persona: 'instructor', requires: ['L10'], aircraft: 'any', estMinutes: 25,
  start: FINAL2_LANDING, startOptions: { payload: 'forward', fuelFraction: 0.8 },
  weather: { preset: 'light' },
  rules: dualRules({ coachLevel: 'reduced', maxDurationS: 2700 }),
  briefing: {
    aim: 'To go around from an approach, and to land without flap and without power.',
    points: [
      'Go-around: full power, stop the descent, flap to 20, climb at Vy; then flap up in stages above 60 knots.',
      'Unstable at 300 ft? Go around. It is a decision, not a failure.',
      'Flapless: a flatter approach, higher speed, longer float. Aim a little further into the runway.',
      'Glide approach: close the throttle abeam the aim point and judge the turn onto base.',
    ],
    numbers: [{ label: 'Vy', value: vs('Vy'), unit: 'kt' }, { label: 'Vx', value: vs('Vx'), unit: 'kt' },
      { label: 'Flapless approach', value: vs('VappFlapsUp'), unit: 'kt' }, { label: 'Best glide', value: vs('Vglide'), unit: 'kt' }],
    tolerances: ['speedClimbApproach', 'heading', 'touchdownZoneFt', 'sinkFpm'],
    airmanship: ['On a go-around, fly the aircraft first: attitude and power before anything else.', 'Move to the dead side if traffic is ahead.'],
    keys: ['throttleFull', 'throttleIdle', 'flapsUp', 'flapsDown', 'pitchUp', 'pitchDown', 'trimNoseUp'],
    diagram: { kind: 'glide' },
    spoken: 'L11.brief',
  },
  exercises: [
    demoEx('gaDemo', 'Demonstration: go-around from 200 ft', 'goAround'),
    assessedEx('goAround', 'Go-around on call', 'goAround'),
    assessedEx('unstableApproach', 'Unstable approach: your decision', 'approach'),
    assessedEx('flapless', 'Flapless approach and landing', 'landing'),
    assessedEx('glideApproach', 'Glide approach and landing', 'glideApproach'),
  ],
  flow: [
    { id: 'demo', title: 'Demonstration', lowLevel: true, steps: [
      say('intro', 'L11.demoIntro', { wait: true }),
      demo('demoGa', 'goAround', { followMeThrough: true }),
      say('demoWrap', 'L11.demoWrap', { wait: true }),
    ] },
    { id: 'goArounds', title: 'Go-arounds on call', lowLevel: true, retryFrom: FINAL2_LANDING, steps: [
      ...goAroundOnCall('g1', 'goAround', 250),
      ...goAroundOnCall('g2', 'goAround', 150),
    ] },
    { id: 'unstable', title: 'Unstable approach', lowLevel: true, coachLevel: 'silent', retryFrom: UNSTABLE, steps: [
      setup('reposU', { reposition: UNSTABLE, cue: 'L11.unstableSetup', pf: 'instructor' }),
      task({ id: 'unst', exercise: 'unstableApproach', pf: 'student', brief: 'L11.yourDecision',
        card: { title: 'Your decision', targets: [ias(vs('Vref'), 'speedClimbApproach'), centreline(45)] },
        goal: any(all(ev('goAround'), gt('hafFt', 400)), all(ev('landing'), ev('stopped'))), timeoutS: 240, onTimeout: 'fail', coach: [],
        criteria: [
          check('unstDecision', 'Went around, or stable by 300 ft', { pred: any(ev('goAround'), held(all(lt('hafFt', 300), gt('hafFt', 150), stableNow), 3)), required: true,
            advice: { fail: 'High, fast and short of flap at 1 NM: that approach will not be stable. Go around early.' } }),
          binary('unstContinued', 'Unstable approach continued below 200 ft', held(all(lt('hafFt', 200), gt('aglFt', 5), leg('final'), any(lt('vsFpm', -1000), gt('kias', vs('Vref', 15)), lt('flapsDeg', 25))), 2),
            { required: true, safety: true, advice: { fail: 'Unstable at 200 feet means go around, every time.' } }),
          ...landingCriteria({ prefix: 'unst', standard: 'test', required: false }),
        ] }),
    ] },
    { id: 'flapless', title: 'Flapless landing', lowLevel: true, retryFrom: DOWNWIND_MID, steps: [
      setup('reposF', { reposition: DOWNWIND_MID, cue: 'L11.flaplessSetup', pf: 'instructor' }),
      approachLandingTask({ id: 'fl', exercise: 'flapless', standard: 'test', brief: 'L11.flapless', student: true, vref: vs('VappFlapsUp'), flapsMin: 0, slope: 'none',
        extra: [binary('flUp', 'Flap stays up', gt('flapsDeg', 2), { required: true })], feedback: approachFeedback({ vref: vs('VappFlapsUp') }) }),
    ] },
    { id: 'glide', title: 'Glide approach', lowLevel: true, retryFrom: DOWNWIND_MID, steps: [
      setup('reposG', { reposition: DOWNWIND_MID, cue: 'L11.glideSetup', pf: 'instructor' }),
      task({ id: 'gl', exercise: 'glideApproach', pf: 'student', brief: 'L11.glideApproach',
        card: { title: 'Glide approach', targets: [ias(vs('Vglide')), centreline(45)] },
        goal: all(ev('landing'), ev('stopped')), timeoutS: 420, onTimeout: 'fail', coach: ['speed', 'centreline', 'flare'],
        criteria: glideApproachCriteria('gl', 'test'),
        feedback: feedback({
          start: 'Your aircraft. Throttle closed abeam the aim point, then glide speed, and judge the base turn.',
          milestones: [
            ms('closed', all(leg('downwind'), lt('throttle', 0.1)), ['Throttle closed. Glide speed first, then turn in when it looks right.']),
            ms('final', all(ever(lt('throttle', 0.1)), leg('final')), ['On final. Flap only when you are sure of reaching the runway.']),
          ],
          success: 'Good glide approach. Speed first, then judge it with the turn and the flap.',
          nudge: 'Hold {vspeed.Vglide:kt}; judge the height with the turn onto base.', nudgeAfterS: 20, nudgeEveryS: 30,
        }) }),
      end('fin', 'common.endDual'),
    ] },
  ],
  debriefTips: {
    'glIas.biasHigh': 'Fast on the glide approach: a fast glide floats a long way. Hold the glide speed exactly.',
  },
  lookAhead: 'Next: engine failures in the circuit.',
};

// =====================================================================================================
// L12 Circuit emergencies
// =====================================================================================================

/** EFATO from the line-up: climb out, the failure at 500 ft (instructor holds the throttle), go-around at 200 ft. */
function efato(pre: string, exercise: string, quiet = false): StepDef[] {
  return [
    lineUp(`${pre}Repos`),
    wait(`${pre}Climb`, gt('hafFt', 500), { pf: 'student', cue: 'L12.takeOff', timeoutS: 300, onTimeout: 'fail' }),
    task({ id: `${pre}Fail`, exercise, brief: 'L12.engineFailure',
      holds: { throttle: 0, release: lt('hafFt', 200), cue: 'L12.haveThrottle' },
      card: { title: 'Engine failure after take-off', targets: [ias(vs('Vglide')), hdg(RWY_HDG, 30)] },
      goal: lt('hafFt', 200), timeoutS: 120, onTimeout: 'fail', coach: quiet ? [] : ['speed', 'heading'],
      ...(quiet ? {} : { feedback: feedback({
        milestones: [
          ms('nose', le('kias', vs('Vglide', 10)), ['Nose down, glide speed. Good. Now pick your field ahead.']),
          ms('drills', touchDrills, ['Drills done. Keep the speed, and land ahead.']),
        ],
        nudge: 'Speed first: glide attitude, and land straight ahead.', nudgeAfterS: 8, nudgeEveryS: 15,
      }) }),
      criteria: [
        check(`${pre}Nose`, 'Nose lowered: glide speed within 4 s', { pred: le('kias', vs('Vglide', 10)), withinS: 4, required: true,
          advice: { fail: 'Lower the nose at once: with no power the speed decays to the stall in seconds.' } }),
        hold(`${pre}Glide`, 'Glide speed', 'asiKt', vs('Vglide'), 'speed', { settleS: 6, required: true }),
        peak(`${pre}Hdg`, 'Within 30° of the runway heading', 'hdgDeg', RWY_HDG, 30, { peakOf: 'abs', required: true }),
        binary(`${pre}TurnBack`, 'No turn back below 700 ft', all(lt('aglFt', 700), any(gt('step.turnDeg', 90), lt('step.turnDeg', -90))), { required: true, safety: true,
          advice: { fail: 'Never turn back below 700 feet: land ahead, within 30 degrees either side.' } }),
        check(`${pre}Drills`, 'Touch drills within 20 s', { pred: touchDrills, withinS: 20, required: true }),
      ] }),
    task({ id: `${pre}Ga`, exercise, brief: 'L12.goAround',
      card: { title: 'Go around', targets: [ias(vs('Vy'), 'speedClimbApproach'), hdg(RWY_HDG, 10)] },
      goal: held(gt('hafFt', 400), 1), timeoutS: 90, onTimeout: 'fail', coach: quiet ? [] : ['speed'],
      criteria: goAroundCriteria(`${pre}Ga`).filter((c) => c.id !== `${pre}GaHdg`),
      ...(quiet ? {} : { feedback: GO_AROUND_TALK }) }),
  ];
}

/** Engine failure on downwind (hold from the midpoint) to the go-around call at 200 ft. */
function downwindFailure(pre: string, exercise: string, quiet = false): StepDef[] {
  return [
    setup(`${pre}Repos`, { reposition: DOWNWIND_MID, cue: 'L12.downwindSetup', pf: 'instructor' }),
    task({ id: `${pre}Fail`, exercise, pf: 'student', brief: 'L12.engineFailureDownwind',
      holds: { throttle: 0, release: lt('hafFt', 200), cue: 'L12.haveThrottle' },
      card: { title: 'Engine failure: reach the runway', targets: [ias(vs('Vglide')), centreline(60)] },
      goal: lt('hafFt', 200), timeoutS: 300, onTimeout: 'fail', coach: quiet ? [] : ['speed'],
      ...(quiet ? {} : { feedback: feedback({
        milestones: [
          ms('glide', held(near('asiKt', vs('Vglide'), 5), 3), ['Glide speed. Good. Now turn toward the runway, early.']),
          ms('drills', touchDrills, ['Drills done. Judge the glide: are we reaching it?']),
          ms('final', all(ever(touchDrills), leg('final')), ['Lined up. Flap now only if we will make it easily.']),
        ],
        nudge: 'Speed first, then turn toward the runway.', nudgeAfterS: 10, nudgeEveryS: 20,
      }) }),
      criteria: [
        hold(`${pre}Glide`, 'Glide speed', 'asiKt', vs('Vglide'), 'speed', { settleS: 6, required: true }),
        check(`${pre}Drills`, 'Touch drills within 20 s', { pred: touchDrills, withinS: 20, required: true }),
        final(`${pre}Reach`, 'Glide reaches the runway', 'rwyAlongM', -100, 450, { required: true,
          advice: { low: 'You would have landed short: turn in earlier and keep the glide speed exact.',
            high: 'Too high and long: lose height with flap or a wider pattern sooner.' } }),
        final(`${pre}Line`, 'Lined up with the runway', 'rwyAcrossM', 0, 60, { required: true }),
      ] }),
    task({ id: `${pre}Ga`, exercise, brief: 'L12.goAround',
      card: { title: 'Go around', targets: [ias(vs('Vy'), 'speedClimbApproach')] },
      goal: held(gt('hafFt', 400), 1), timeoutS: 90, onTimeout: 'fail', coach: [],
      criteria: goAroundCriteria(`${pre}Ga`, false) }),
  ];
}

export const L12: Lesson = {
  id: 'L12', version: 1, number: 12, title: 'Circuit emergencies',
  syllabusRef: { easa: 'Ex 12E & 13E', faa: 'ACS IX.B' },
  stage: 'circuits', kind: 'dual', persona: 'instructor', requires: ['L11'], aircraft: 'any', estMinutes: 22,
  start: LINEUP, startOptions: { payload: 'forward', fuelFraction: 0.8 },
  weather: { preset: 'light' },
  rules: dualRules({ coachLevel: 'reduced', maxDurationS: 2700 }),
  briefing: {
    aim: 'To handle an engine failure after take-off and on downwind.',
    points: [
      'After take-off: lower the nose at once to the glide attitude. Speed first.',
      'Land ahead, within 30 degrees either side. Never turn back below 700 feet.',
      'Touch drills if there is time: fuel selector both, mixture rich, magnetos both, fuel pump on.',
      'On downwind: turn toward the runway early and judge the glide; flap only when the field is made.',
    ],
    numbers: [{ label: 'Best glide', value: vs('Vglide'), unit: 'kt' }, { label: 'No turn-back below', value: 700, unit: 'ft' },
      { label: 'Glide ratio', value: 9, unit: '' }],
    tolerances: ['speed', 'heading'],
    airmanship: ['I will say "simulated engine failure" and close the throttle; I keep my hand on it.', 'When I say go around, you have the throttle: full power.'],
    keys: ['pitchDown', 'fuelSelector', 'mixtureRich', 'magnetoBoth', 'fuelPump', 'throttleFull'],
    diagram: { kind: 'glide' },
    spoken: 'L12.brief',
  },
  exercises: [
    demoEx('efatoDemo', 'Demonstration: engine failure after take-off', 'efato'),
    assessedEx('efato', 'Engine failure after take-off', 'efato'),
    assessedEx('efDownwind', 'Engine failure on downwind', 'efato'),
  ],
  flow: [
    { id: 'demo', title: 'Demonstration', lowLevel: true, steps: [
      say('intro', 'L12.demoIntro', { wait: true }),
      demo('demoEfato', 'efato', { followMeThrough: true, highlight: ['asi'] }),
      say('demoWrap', 'L12.demoWrap', { wait: true }),
    ] },
    { id: 'efato', title: 'Engine failures after take-off', lowLevel: true, repeat: { max: 2 }, retryFrom: LINEUP, steps: efato('e', 'efato') },
    { id: 'downwind', title: 'Engine failure on downwind', lowLevel: true, retryFrom: DOWNWIND_MID, steps: [
      ...downwindFailure('d', 'efDownwind'),
      end('fin', 'common.endDual'),
    ] },
  ],
  debriefTips: {
    'eGlide.biasLow': 'Slow in the glide: the nose must go down further than you expect when the engine stops.',
  },
  lookAhead: 'Next: the pre-solo progress check.',
};

// =====================================================================================================
// L13 Pre-solo progress check
// =====================================================================================================

export const L13: Lesson = {
  id: 'L13', version: 1, number: 13, title: 'Pre-solo progress check',
  syllabusRef: { easa: 'Ex 14 (preparation)', faa: '14 CFR 61.87 pre-solo' },
  stage: 'circuits', kind: 'check', persona: 'instructor', requires: ['L12'], aircraft: 'any', estMinutes: 30,
  start: LINEUP, startOptions: { payload: 'forward', fuelFraction: 0.8 },
  weather: { preset: 'light', windKt: [3, 10] },
  // A check ride keeps instructor saves on (section 4.1): an intervention fails the check.
  rules: dualRules({ coachLevel: 'silent', maxDurationS: 3000 }),
  briefing: {
    aim: 'To show you are safe to fly solo: a circuit, a go-around, an engine failure after take-off and a glide approach.',
    points: [
      'Fly it as if I am not here. I will only give you tasks.',
      'Everything is graded to the test standard, first attempt.',
      'If I have to take control, the check stops there.',
    ],
    numbers: [{ label: 'Circuit height', value: { setting: 'patternAglFt' }, unit: 'ft' }, { label: 'Vref', value: vs('Vref'), unit: 'kt' },
      { label: 'Best glide', value: vs('Vglide'), unit: 'kt' }, { label: 'Vy', value: vs('Vy'), unit: 'kt' }],
    tolerances: ['altitude', 'speedClimbApproach', 'touchdownZoneFt', 'sinkFpm', 'speed'],
    airmanship: ['Your checks, your lookout, your decisions.'],
    keys: ['ack'],
    diagram: { kind: 'circuit' },
    spoken: 'L13.brief',
  },
  exercises: [
    assessedEx('chkCircuit', 'Circuit to land', 'circuit'),
    assessedEx('chkGoAround', 'Circuit with a go-around on call', 'goAround'),
    assessedEx('chkEfato', 'Engine failure after take-off', 'efato'),
    assessedEx('chkGlide', 'Glide approach', 'glideApproach'),
  ],
  flow: [
    { id: 'circuit', title: 'Circuit to land', lowLevel: true, steps: [
      say('intro', 'L13.intro', { wait: true }),
      handover('toStudent', 'student'),
      ...circuit({ pre: 'c', exercise: 'chkCircuit', standard: 'test', checks: 'silent', quiet: true, first: true }),
    ] },
    { id: 'goAround', title: 'Circuit with a go-around', lowLevel: true, steps: [
      lineUp('reposG'),
      takeoffTask({ id: 'gTo', exercise: 'chkGoAround', standard: 'test', brief: 'L13.goAroundCircuit', coach: [] }),
      downwindTask({ id: 'gDown', exercise: 'chkGoAround', standard: 'test', brief: 'L10.downwind', coach: [] }),
      task({ id: 'gApp', exercise: 'chkGoAround', brief: 'L10.baseFinal',
        card: { title: 'Approach', targets: [ias(vs('Vref'), 'speedClimbApproach'), centreline(45)] },
        goal: all(leg('final'), lt('hafFt', 300)), timeoutS: 300, onTimeout: 'fail', coach: [], criteria: [] }),
      task({ id: 'gGa', exercise: 'chkGoAround', brief: 'L11.goAroundNow',
        card: { title: 'Go around', targets: [ias(vs('Vy'), 'speedClimbApproach'), hdg(RWY_HDG, 10)] },
        goal: held(gt('hafFt', 500), 1), timeoutS: 90, onTimeout: 'fail', coach: [], criteria: goAroundCriteria('gGa') }),
    ] },
    { id: 'efato', title: 'Engine failure after take-off', lowLevel: true, steps: efato('e', 'chkEfato', true) },
    { id: 'glide', title: 'Glide approach', lowLevel: true, steps: [
      setup('reposGl', { reposition: DOWNWIND_MID, cue: 'L11.glideSetup', pf: 'instructor' }),
      task({ id: 'gl', exercise: 'chkGlide', pf: 'student', brief: 'L11.glideApproach',
        card: { title: 'Glide approach', targets: [ias(vs('Vglide')), centreline(45)] },
        goal: all(ev('landing'), ev('stopped')), timeoutS: 420, onTimeout: 'fail', coach: [],
        criteria: glideApproachCriteria('gl', 'test') }),
      end('fin', 'L13.wrap'),
    ] },
  ],
  lookAhead: 'Next: your first solo.',
};

// =====================================================================================================
// L14 First solo
// =====================================================================================================

export const L14: Lesson = {
  id: 'L14', version: 1, number: 14, title: 'First solo',
  syllabusRef: { easa: 'Ex 14', faa: '14 CFR 61.87 solo' },
  stage: 'circuits', kind: 'solo', persona: 'instructor', requires: ['L13'], aircraft: 'any', estMinutes: 10,
  start: HOLD_A1, startOptions: { payload: 'forward', fuelFraction: 0.8 },
  // Wind at most 6 kt within 30 degrees of the runway (section 4.1).
  weather: { preset: 'calm', windDirDeg: [40, 100], windKt: [0, 6] },
  rules: soloRules({ maxDurationS: 1500 }),
  briefing: {
    aim: 'One circuit, full-stop landing, on your own.',
    points: [
      'Exactly what you have flown with me: same speeds, same checks, same circuit.',
      'The aircraft climbs better without me: expect it, and lower the nose a little.',
      'If the approach is not right, go around. There is no hurry and plenty of fuel.',
    ],
    numbers: [{ label: 'Vy', value: vs('Vy'), unit: 'kt' }, { label: 'Circuit height', value: { setting: 'patternAglFt' }, unit: 'ft' },
      { label: 'Vref', value: vs('Vref'), unit: 'kt' }],
    tolerances: ['altitude', 'sinkFpm'],
    airmanship: ['Your aircraft, your decisions: go around whenever in doubt.'],
    keys: ['ack'],
    diagram: { kind: 'circuit' },
    spoken: 'L14.brief',
  },
  exercises: [
    assessedEx('soloCircuit', 'Solo circuit to a full stop', 'circuit', { standard: 'training' }),
  ],
  flow: [
    { id: 'ground', title: 'On the ground', lowLevel: true, steps: [
      say('kate', 'L14.kateLeaves', { wait: true }),
      say('offYouGo', 'L14.offYouGo', { wait: true }),
      handover('solo', 'student'),
    ] },
    { id: 'circuit', title: 'Solo circuit', lowLevel: true, checkpoint: false, steps: [
      takeoffTask({ id: 'sTo', exercise: 'soloCircuit', standard: 'training', brief: 'L14.cleared', coach: [], required: false, timeoutS: 420 }),
      checklist('sDw', 'downwind', 'silent', { exercise: 'soloCircuit', when: leg('downwind'), timeoutS: 300, onTimeout: 'next' }),
      downwindTask({ id: 'sDown', exercise: 'soloCircuit', standard: 'training', brief: 'L14.silent', coach: [] }),
      approachLandingTask({ id: 'sLdg', exercise: 'soloCircuit', standard: 'training', brief: 'L14.silent', coach: [], safeOnly: true, sinkTol: { minus: 0, plus: 600 }, slope: 'none' }),
      end('fin', 'L14.congratulations'),
    ] },
  ],
  awards: [{ id: 'firstSolo', when: 'competent', title: 'First solo' }],
  lookAhead: 'Next: advanced handling. Steep turns, forced landings, crosswinds and more.',
};

export const STAGE2: readonly Lesson[] = [L08, L09, L10, L11, L12, L13, L14];

/** Exported for the skill test (L21) and the challenges, which fly the same pieces. */
export const circuitPieces = { circuit, efato, downwindFailure, goAroundOnCall, glideApproachCriteria, lineUp };
