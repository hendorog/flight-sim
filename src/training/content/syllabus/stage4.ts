// Stage 4, navigation and the skill test: L20-L21 (section 4.1).
//
// Navigation signals (module 1, src/training/telemetry/providers/nav.ts) are read as: `nav.leg` the index of
// the leg being flown (leg i runs from waypoint i to i + 1, so it becomes i + 1 when waypoint i + 1 is
// passed), `nav.distNm` the distance to the next waypoint, `nav.xtkNm` the cross-track error from the leg,
// and `nav.etaErrMin` the projected arrival error at the next waypoint against the nav log.
//
// Not expressible with the contract, so not graded from data (also in the module report): the nav log form on
// the ground ("headings +/-3 degrees, times +/-1 min") and the diversion time estimate. The briefing shows the
// solved nav log; the diversion grades the heading chosen and flown.

import {
  all, any, capture, demo, end, eq, ev, final, ge, gt, handover, held, hold, leg, lt, near, say, setup, v, vs,
  wait,
} from '../../engine/dsl';
import type { Lesson, StepDef } from '../../types';
import {
  alt, approachLandingTask, areaStart, assessedEx, downwindTask, dualRules, finalStart, hdg, height, HOLD_A1,
  PARKING_COLD, soloRules, takeoffTask, task,
} from './common';
import {
  climbTask, descentTask, slowFlightTask, straightLevelTask, turn360Task, unusualAttitudeTask,
} from './manoeuvres';
import { DIVERSION, LEG_NM, NAV_ROUTE, ROUTE_ALT_FT } from './route';
import { handlingPieces } from './stage1';
import { circuitPieces } from './stage2';
import { advancedPieces } from './stage3';
import { feedback, ms } from './instruction';

const LEG_HDG = NAV_ROUTE.legHeadingsDeg;
const enrouteCoach = ['altitude', 'heading'] as const;

/**
 * One en-route leg (index `i`): the cruise part at up to 4x time (until 2 NM from the turning point), then 1x
 * to the turning point. Cross-track (settled 120 s), altitude and heading are held; the ETA error is held over
 * the last 2 NM, where it is the projected error at the turning point.
 */
function navLeg(i: number, exercise: string, opts: { quiet?: boolean; brief?: string } = {}): StepDef[] {
  const coach = opts.quiet ? [] : [...enrouteCoach];
  const legMin = NAV_ROUTE.legMinutes[i];
  const next = NAV_ROUTE.waypoints[i + 1];
  return [
    setup(`leg${i}Fast`, { timeScaleMax: 4 }),
    task({ id: `leg${i}`, exercise, brief: { id: opts.brief ?? 'L20.leg', vars: { hdg: LEG_HDG[i], min: legMin } },
      card: { title: `Leg ${i + 1}: to ${next.name}`, targets: [hdg(LEG_HDG[i], 'navHeading'), alt(ROUTE_ALT_FT, 'navAltitude'),
        { label: 'XTK', sig: 'nav.xtkNm', value: 0, tol: 'xtkNm', unit: 'nm' }] },
      goal: any(lt('nav.distNm', 2), ge('nav.leg', i + 1)), timeoutS: Math.round(legMin * 60 * 2 + 300), onTimeout: 'fail', coach,
      ...(opts.quiet ? {} : { feedback: feedback({
        milestones: [ms('settled', held(all(near('hdgDeg', LEG_HDG[i], 'navHeading'), near('altFt', ROUTE_ALT_FT, 'navAltitude')), 30),
          ['Good heading and height. Map to ground: what should we see next?'], 20)],
      }) }),
      criteria: [
        // Settled 120 s (section 4.1), but at most 40 % of the planned leg: leg 1 is under 6 NM, and its task ends
        // 2 NM short of the turning point, so a 120 s settling left nothing to grade (wave-3 calibration).
        hold(`leg${i}Xtk`, 'Track', 'nav.xtkNm', 0, 'xtkNm', { settleS: Math.min(120, Math.round(legMin * 60 * 0.4)), required: true }),
        hold(`leg${i}Alt`, 'Cruise altitude', 'altFt', ROUTE_ALT_FT, 'navAltitude', { settleS: 30, required: true }),
        hold(`leg${i}Hdg`, 'Heading', 'hdgDeg', LEG_HDG[i], 'navHeading', { settleS: 60, required: true }),
      ] }),
    setup(`leg${i}Slow`, { timeScaleMax: 1 }),
    task({ id: `tp${i}`, exercise, brief: { id: 'L20.turningPoint', vars: { nextHdg: LEG_HDG[i + 1] ?? LEG_HDG[i] } },
      card: { title: `Turning point: ${next.name}`, targets: [alt(ROUTE_ALT_FT, 'navAltitude'), { label: 'ETA', sig: 'nav.etaErrMin', value: 0, tol: 'etaMin', unit: 'min' }] },
      goal: ge('nav.leg', i + 1), timeoutS: 420, onTimeout: 'fail', coach,
      criteria: [
        hold(`tp${i}Eta`, 'Arrival time against the plan', 'nav.etaErrMin', 0, 'etaMin', { settleS: 5, required: true }),
        hold(`tp${i}Alt`, 'Cruise altitude', 'altFt', ROUTE_ALT_FT, 'navAltitude', { settleS: 5, required: false }),
      ] }),
  ];
}

/** Overhead the field: within about 500 m of the runway midpoint (the route's first waypoint). */
const OVERHEAD = all(gt('rwyAlongM', 300), lt('rwyAlongM', 1500), gt('rwyAcrossM', -600), lt('rwyAcrossM', 600));

/**
 * From the climb-out to on course for leg 1: climb over the field to cruise altitude, then set heading
 * overhead (section 4.1: "set heading overhead and start the clock"). (Wave-3 calibration: climbing on course,
 * the 3,100 ft climb took longer than the 5.8 NM first leg, so the first turning point passed during the
 * departure and leg 1 was never graded.) The route's clock starts 1 NM from the field.
 */
function departure(exercise: string, quiet: boolean): StepDef[] {
  // The skill test (quiet) gives the same tasks in the examiner's words.
  const lines = quiet ? { climb: 'L21.climbOverhead', course: 'L21.setCourse' } : { climb: 'L20.climbOverhead', course: 'L20.setCourse' };
  return [
    task({ id: 'climbOverhead', exercise, brief: lines.climb,
      card: { title: 'Climb to 3,500 ft over the field', targets: [alt(ROUTE_ALT_FT, 'navAltitude')] },
      goal: all(held(near('altFt', ROUTE_ALT_FT, 150), 5), OVERHEAD), timeoutS: 900, onTimeout: 'fail', coach: quiet ? [] : ['speed'],
      criteria: [final('climbOverheadAlt', 'Levelled at cruise altitude', 'altFt', ROUTE_ALT_FT, 'navAltitude', { required: true })] }),
    task({ id: 'setCourse', exercise, brief: { id: lines.course, vars: { hdg: LEG_HDG[0] } },
      card: { title: 'Overhead: set course', targets: [hdg(LEG_HDG[0], 'navHeading'), alt(ROUTE_ALT_FT, 'navAltitude')] },
      goal: held(near('hdgDeg', LEG_HDG[0], 'navHeading'), 10), timeoutS: 180, onTimeout: 'fail', coach: quiet ? [] : ['altitude'],
      ...(quiet ? {} : { feedback: feedback({
        milestones: [ms('onHdg', held(near('hdgDeg', LEG_HDG[0], 'navHeading'), 3), ['On heading. Clock started? Now find the first feature on the map.'])],
        success: 'Course set. Heading, time, and map to ground from here.',
      }) }),
      criteria: [
        { id: 'setCourseHdg', label: 'Course set within a minute', kind: 'check', pred: held(near('hdgDeg', LEG_HDG[0], 'navHeading'), 5), withinS: 60, required: true },
      ] }),
  ];
}

/** The diversion in the middle of leg 2: heading worked out and set within 90 s, then held for 3 minutes. */
function diversion(exercise: string, quiet: boolean): StepDef[] {
  return [
    setup('divSlow', { timeScaleMax: 1 }),
    task({ id: 'divert', exercise, brief: 'L20.diversion',
      card: { title: 'Diversion: the glacial lake', targets: [alt(ROUTE_ALT_FT, 'navAltitude')] },
      goal: { elapsed: 240 }, timeoutS: 300, onTimeout: 'next', coach: quiet ? [] : ['altitude'],
      ...(quiet ? {} : { feedback: feedback({
        milestones: [ms('onHdg', held(near('hdgDeg', DIVERSION.headingDeg, 10), 5), ["That's a sensible heading. Note the time, and estimate the arrival."])],
        nudge: 'Track on the map, the wind correction, then turn. Within 90 seconds.', nudgeAfterS: 30, nudgeEveryS: 40,
      }) }),
      criteria: [
        { id: 'divHdgSet', label: 'Diversion heading within 90 s', kind: 'check', pred: held(near('hdgDeg', DIVERSION.headingDeg, 10), 10), withinS: 90, required: true,
          advice: { fail: 'Estimate the track on the map, apply the wind correction you have been using, and turn: within 90 seconds.' } },
        hold('divHdg', 'Diversion heading', 'hdgDeg', DIVERSION.headingDeg, 'navHeading', { settleS: 90, required: true }),
        hold('divAlt', 'Altitude', 'altFt', ROUTE_ALT_FT, 'navAltitude', { settleS: 30, required: true }),
      ] }),
  ];
}

// =====================================================================================================
// L20 Navigation
// =====================================================================================================

export const L20: Lesson = {
  id: 'L20', version: 1, number: 20, title: 'Navigation',
  syllabusRef: { easa: 'Ex 18', faa: 'ACS VI.A (pilotage and dead reckoning)' },
  stage: 'navigation', kind: 'dual', persona: 'instructor', requires: ['L15', 'L16', 'L17', 'L18', 'L19'], aircraft: 'any', estMinutes: 45,
  start: HOLD_A1, startOptions: { payload: 'forward', fuelFraction: 0.9 },
  weather: { preset: 'light', override: { windDirectionDeg: 100, windSpeedKt: 9, gustKt: 0 } },
  rules: dualRules({ coachLevel: 'minimal', maxDurationS: 4800 }),
  route: NAV_ROUTE,
  briefing: {
    aim: 'To plan and fly a closed route by map, compass and clock, and divert to an alternate.',
    points: [
      'The nav log gives each leg a heading to steer and a time, solved for the forecast wind.',
      'Set heading overhead and start the clock. Fly the heading, then check the map against the ground.',
      'At each turning point: turn onto the next heading, note the time, check the fuel.',
      'Diversion: estimate the track and distance on the map, correct for the wind, turn within 90 seconds.',
      'Rejoin overhead at 2,000 ft above the field, descend on the dead side, join the circuit.',
    ],
    numbers: [
      { label: 'Cruise altitude', value: ROUTE_ALT_FT, unit: 'ft' }, { label: 'Cruise', value: vs('Vcruise'), unit: 'kt' },
      ...NAV_ROUTE.legHeadingsDeg.map((h, i) => ({ label: `Leg ${i + 1} heading`, value: h, unit: 'deg' as const })),
      ...NAV_ROUTE.legMinutes.map((m, i) => ({ label: `Leg ${i + 1} time, min`, value: m, unit: '' as const })),
    ],
    tolerances: ['xtkNm', 'etaMin', 'navAltitude', 'navHeading'],
    airmanship: ['Minimum safe altitude: 1,000 ft above anything within a mile of track.', 'Lookout and log: do not fly with your head in the map.',
      'Rejoin: listen for traffic, overhead at 2,000 ft above the field, dead side descent.'],
    keys: ['headingBugLeft', 'headingBugRight', 'dgAlign', 'kollsmanUp', 'kollsmanDown', 'ack'],
    diagram: { kind: 'circuit' },
    more: 'Dead reckoning: heading and time from the planned wind. Pilotage: the map against the ground. Use both: the clock tells you where to look; the ground tells you where you are.',
    spoken: 'L20.brief',
  },
  exercises: [
    assessedEx('departure', 'Departure: on course at cruise altitude', 'navigation', { weight: 1 }),
    assessedEx('enroute', 'En route: track, altitude, heading and times', 'navigation', { weight: 3 }),
    assessedEx('diversion', 'Diversion', 'navigation', { weight: 2 }),
    assessedEx('arrival', 'Rejoin, circuit and landing', 'circuit', { weight: 2 }),
  ],
  flow: [
    { id: 'departure', title: 'Departure', lowLevel: true, steps: [
      say('intro', 'L20.intro', { wait: true }),
      handover('toStudent', 'student'),
      wait('airborne', gt('hafFt', 300), { pf: 'student', cue: 'L20.takeOff', timeoutS: 600, onTimeout: 'fail' }),
      ...departure('departure', false),
    ] },
    { id: 'leg1', title: 'Leg 1: Foothill Lake', maxTimeScale: 4, steps: navLeg(0, 'enroute') },
    { id: 'leg2', title: 'Leg 2, the diversion, and on to the town', maxTimeScale: 4, steps: [
      setup('leg1Fast', { timeScaleMax: 4 }),
      task({ id: 'leg1', exercise: 'enroute', brief: { id: 'L20.leg', vars: { hdg: LEG_HDG[1], min: NAV_ROUTE.legMinutes[1] } },
        card: { title: 'Leg 2: to Valley Lake', targets: [hdg(LEG_HDG[1], 'navHeading'), alt(ROUTE_ALT_FT, 'navAltitude'),
          { label: 'XTK', sig: 'nav.xtkNm', value: 0, tol: 'xtkNm', unit: 'nm' }] },
        goal: lt('nav.distNm', LEG_NM[1] / 2), timeoutS: 900, onTimeout: 'fail', coach: [...enrouteCoach],
        criteria: [
          hold('leg1Xtk', 'Track', 'nav.xtkNm', 0, 'xtkNm', { settleS: 120, required: true }),
          hold('leg1Alt', 'Cruise altitude', 'altFt', ROUTE_ALT_FT, 'navAltitude', { settleS: 30, required: true }),
          hold('leg1Hdg', 'Heading', 'hdgDeg', LEG_HDG[1], 'navHeading', { settleS: 60, required: true }),
        ] }),
      ...diversion('diversion', false),
      say('cancelDiv', 'L20.cancelDiversion', { wait: true }),
      // The diversion has taken us abeam Valley Lake, so the route has moved on to the town leg (nav.ts
      // sequences a leg on passing abeam its end): direct to the town, the next turning point. (Wave-3
      // calibration: "direct to Valley Lake" ended at once on the leg already sequenced, and the town leg was
      // then timed from the diversion point against the Valley Lake plan.)
      task({ id: 'resume', exercise: 'enroute', brief: 'L20.directTown',
        card: { title: 'Direct to the town', targets: [alt(ROUTE_ALT_FT, 'navAltitude')] },
        // Until 3 NM short of the town: the town is under 2 NM from the field, too close to start the 1,100 ft
        // descent to the rejoin height there.
        goal: any(ge('nav.leg', 3), all(eq('nav.leg', 2), lt('nav.distNm', 3))), timeoutS: 1200, onTimeout: 'fail', coach: [...enrouteCoach],
        criteria: [hold('resumeAlt', 'Cruise altitude', 'altFt', ROUTE_ALT_FT, 'navAltitude', { settleS: 30, required: true })] }),
    ] },
    { id: 'arrival', title: 'Rejoin and land', lowLevel: true, steps: [
      task({ id: 'homeLeg', exercise: 'arrival', brief: 'L20.rejoin',
        card: { title: 'Overhead at 2,000 ft above the field', targets: [height(2000)] },
        // Overhead the runway itself: the route's last leg completes 1 NM out (its pass radius), where a
        // student still descending to the rejoin height was graded for it (wave-3 calibration).
        goal: OVERHEAD, timeoutS: 600, onTimeout: 'fail', coach: ['altitude'],
        criteria: [final('overheadHgt', 'Height overhead', 'hafFt', 2000, 'altitude', { required: true })] }),
      task({ id: 'deadside', exercise: 'arrival', brief: 'L20.deadside',
        card: { title: 'Dead-side descent to circuit height', targets: [height(1000)] },
        goal: all(leg('crosswind', 'downwind'), near('hafFt', 1000, 150)), timeoutS: 480, onTimeout: 'fail', coach: ['altitude'],
        criteria: [{ id: 'deadsideFlown', label: 'Descended on the dead side', kind: 'check', pred: all(leg('deadside'), lt('hafFt', 1900)), required: true }] }),
      downwindTask({ id: 'arrDown', exercise: 'arrival', standard: 'test', brief: 'L10.downwind', coach: [] }),
      approachLandingTask({ id: 'arrLdg', exercise: 'arrival', standard: 'test', brief: 'L10.baseFinal', coach: [] }),
      end('fin', 'L20.wrap'),
    ] },
  ],
  debriefTips: {
    'leg0Xtk.drift': 'Your track drifted off the line: the wind was not quite the forecast. Correct the heading early.',
    'leg1Xtk.drift': 'Your track drifted off the line: the wind was not quite the forecast. Correct the heading early.',
    'leg0Alt.drift': 'The altitude wandered while you navigated: trim, and check the altimeter in every scan.',
  },
  lookAhead: 'Next: the skill test with the examiner.',
};

// =====================================================================================================
// L21 PPL skill test
// =====================================================================================================

const backToArea = (id: string, altFt: number, hdgDeg: number) =>
  setup(id, { reposition: areaStart(altFt, hdgDeg), cue: 'L21.generalHandling', pf: 'instructor' });

const { engineStartSteps, taxiToA1Task, runupSteps, stallSequence } = handlingPieces;
const { circuit, efato, goAroundOnCall, lineUp } = circuitPieces;
const { pfl, PFL_ABEAM } = advancedPieces;

export const L21: Lesson = {
  id: 'L21', version: 1, number: 21, title: 'PPL skill test',
  syllabusRef: { easa: 'Skill test, sections 1-5 (FCL.235)', faa: 'Private Pilot ACS' },
  stage: 'test', kind: 'test', persona: 'examiner', requires: ['L20'], aircraft: 'any', estMinutes: 80,
  start: PARKING_COLD, startOptions: { payload: 'forward', fuelFraction: 0.9 },
  // Random fair weather: wind up to 12 kt from 040-160 (section 4.1).
  weather: { preset: 'light', windDirDeg: [40, 160], windKt: [3, 12] },
  rules: soloRules({ maxDurationS: 7200, hood: true, envelope: { stallAllowed: true, maxBankDeg: 65, maxPitchUpDeg: 30, maxPitchDownDeg: -30 } }),
  route: NAV_ROUTE,
  briefing: {
    aim: 'To pass the skill test for the private pilot licence.',
    points: [
      'Five sections: departure, general handling, navigation, approach and landing, emergencies.',
      'Each item is flown once at the test standard. I may allow one repeat of an item per section.',
      'I will give you tasks only, and the debrief on the ground. Fly as if I am a passenger.',
      'Treat everything as real: lookout, checks, and your decisions.',
    ],
    numbers: [{ label: 'Vy', value: vs('Vy'), unit: 'kt' }, { label: 'Vref', value: vs('Vref'), unit: 'kt' }, { label: 'Best glide', value: vs('Vglide'), unit: 'kt' },
      { label: 'Steep turn', value: vs('VsteepTurn'), unit: 'kt' }, { label: 'Cruise altitude', value: ROUTE_ALT_FT, unit: 'ft' }],
    tolerances: ['altitude', 'heading', 'speed', 'speedClimbApproach', 'bankSteep', 'navAltitude', 'touchdownZoneFt', 'sinkFpm'],
    airmanship: ['You are pilot in command: I will not take control unless it is unsafe.', 'If you are unsure what I asked for, ask me to say again.'],
    keys: ['sayAgain', 'ack'],
    spoken: 'L21.brief',
  },
  exercises: [
    assessedEx('t1Start', 'Pre-flight checks and engine start', 'checks', { testSection: 1, weight: 1 }),
    assessedEx('t1Taxi', 'Taxi', 'groundOps', { testSection: 1, weight: 1 }),
    assessedEx('t1Runup', 'Power checks and before take-off checks', 'checks', { testSection: 1, weight: 1 }),
    assessedEx('t1Takeoff', 'Normal take-off', 'takeoff', { testSection: 1 }),
    assessedEx('t3Nav', 'Navigation: first leg', 'navigation', { testSection: 3 }),
    assessedEx('t3Diversion', 'Diversion', 'navigation', { testSection: 3 }),
    assessedEx('t2SL', 'Straight and level with a speed change', 'straightLevel', { testSection: 2 }),
    assessedEx('t2ClimbDesc', 'Climb and descent', 'climb', { testSection: 2 }),
    assessedEx('t2Turns', 'Medium turns', 'turns', { testSection: 2 }),
    assessedEx('t2Steep', 'Steep turns', 'steepTurn', { testSection: 2 }),
    assessedEx('t2Slow', 'Slow flight', 'slowFlight', { testSection: 2 }),
    assessedEx('t2Stalls', 'Stalls', 'stalls', { testSection: 2 }),
    assessedEx('t2Ua', 'Unusual attitude on instruments', 'unusualAttitude', { testSection: 2 }),
    assessedEx('t5Pfl', 'Forced landing without power', 'forcedLanding', { testSection: 5 }),
    assessedEx('t4Flapless', 'Flapless approach and landing', 'landing', { testSection: 4 }),
    assessedEx('t4Landing', 'Circuit and normal landing', 'landing', { testSection: 4 }),
    assessedEx('t4GoAround', 'Go-around from 200 ft', 'goAround', { testSection: 4 }),
    assessedEx('t5Efato', 'Engine failure after take-off', 'efato', { testSection: 5 }),
  ],
  flow: [
    { id: 's1', title: 'Section 1: departure', lowLevel: true, steps: [
      say('intro', 'L21.intro', { wait: true }),
      handover('toStudent', 'student'),
      ...engineStartSteps('t1', 't1Start', 'silent'),
      taxiToA1Task('t1Taxi', 't1Taxi', 'L21.taxi'),
      ...runupSteps('t1', 't1Runup', 'silent'),
      takeoffTask({ id: 't1To', exercise: 't1Takeoff', standard: 'test', brief: 'L21.takeoff', coach: [], timeoutS: 420 }),
    ] },
    { id: 's3', title: 'Section 3: navigation', lowLevel: true, maxTimeScale: 4, steps: [
      ...departure('t3Nav', true),
      ...navLeg(0, 't3Nav', { quiet: true, brief: 'L21.leg' }),
      setup('t3Fast', { timeScaleMax: 4 }),
      task({ id: 't3Leg2', exercise: 't3Nav', brief: { id: 'L21.leg', vars: { hdg: LEG_HDG[1], min: NAV_ROUTE.legMinutes[1] } },
        card: { title: 'Leg 2: to Valley Lake', targets: [hdg(LEG_HDG[1], 'navHeading'), alt(ROUTE_ALT_FT, 'navAltitude')] },
        goal: lt('nav.distNm', LEG_NM[1] / 2), timeoutS: 900, onTimeout: 'fail', coach: [],
        criteria: [hold('t3Leg2Alt', 'Cruise altitude', 'altFt', ROUTE_ALT_FT, 'navAltitude', { settleS: 30, required: true })] }),
      ...diversion('t3Diversion', true),
    ] },
    { id: 's2', title: 'Section 2: general handling', steps: [
      backToArea('s2Repos', 3500, 200),
      capture('s2Cap', { a0: 'altFt', h0: 'hdgDeg' }),
      straightLevelTask({ id: 't2Cruise', exercise: 't2SL', brief: 'L21.straightLevel', altVar: 'a0', hdgVar: 'h0', kias: vs('Vcruise'), seconds: 60, coach: [] }),
      straightLevelTask({ id: 't2Slow', exercise: 't2SL', brief: 'L21.speedChange', altVar: 'a0', hdgVar: 'h0', kias: 85, seconds: 75, speedSettleS: 25, coach: [] }),
      capture('s2CapC', { up: v('a0', 1000), h1: 'hdgDeg' }),
      climbTask({ id: 't2Climb', exercise: 't2ClimbDesc', brief: { id: 'L21.climbTo', vars: { alt: v('up') } }, tgtVar: 'up', hdgVar: 'h1', coach: [] }),
      descentTask({ id: 't2Desc', exercise: 't2ClimbDesc', brief: { id: 'L21.descendTo', vars: { alt: v('a0') } }, tgtVar: 'a0', hdgVar: 'h1', coach: [] }),
      capture('s2CapT', { a1: 'altFt', h2: 'hdgDeg' }),
      turn360Task({ id: 't2Med', exercise: 't2Turns', brief: 'L21.mediumTurn', dir: 'left', bankDeg: 30, bankTol: 'bankMedium', kias: 100, altVar: 'a1', hdgVar: 'h2', coach: [] }),
      capture('s2CapS', { a2: 'altFt', h3: 'hdgDeg' }),
      turn360Task({ id: 't2SteepR', exercise: 't2Steep', brief: 'L21.steepRight', dir: 'right', bankDeg: 45, bankTol: 'bankSteep', kias: vs('VsteepTurn'), altVar: 'a2', hdgVar: 'h3', coach: [] }),
      capture('s2CapS2', { a3: 'altFt', h4: 'hdgDeg' }),
      turn360Task({ id: 't2SteepL', exercise: 't2Steep', brief: 'L21.steepLeft', dir: 'left', bankDeg: 45, bankTol: 'bankSteep', kias: vs('VsteepTurn'), altVar: 'a3', hdgVar: 'h4', coach: [] }),
      backToArea('s2ReposSlow', 4500, 200),
      capture('s2CapSl', { a4: 'altFt', h5: 'hdgDeg' }),
      slowFlightTask({ id: 't2SlowFlight', exercise: 't2Slow', brief: 'L21.slowFlight', altVar: 'a4', hdgVar: 'h5', seconds: 60, flapsDeg: 30, coach: [] }),
      backToArea('s2ReposStall', 4500, 200),
      ...stallSequence({ pre: 't2a', exercise: 't2Stalls', at: 'break', assessed: true }),
      backToArea('s2ReposStall2', 4500, 200),
      ...stallSequence({ pre: 't2b', exercise: 't2Stalls', at: 'break', approach: true, assessed: true }),
      backToArea('s2ReposUa', 5000, 200),
      setup('s2Hood', { hood: true, cue: 'L21.hood' }),
      demo('s2Ua', 'unusualNoseLow', { followMeThrough: false }),
      unusualAttitudeTask({ id: 't2Ua', exercise: 't2Ua', brief: 'L21.recover', kind: 'noseLow', coach: [] }),
      setup('s2HoodOff', { hood: false }),
    ] },
    { id: 's5pfl', title: 'Section 5: forced landing', lowLevel: true, steps: pfl('t5', 't5Pfl', PFL_ABEAM, true) },
    { id: 's4', title: 'Section 4: approach and landing', lowLevel: true, steps: [
      setup('s4Flapless', { reposition: { kind: 'circuit', leg: 'downwind', position: 'abeamMid', kias: vs('Vdownwind') }, cue: 'L21.flapless', pf: 'instructor' }),
      approachLandingTask({ id: 't4Fl', exercise: 't4Flapless', standard: 'test', brief: 'L11.flapless', student: true, coach: [], vref: vs('VappFlapsUp'), flapsMin: 0, slope: 'none' }),
      lineUp('s4Line'),
      ...circuit({ pre: 't4', exercise: 't4Landing', standard: 'test', checks: 'silent', quiet: true }),
      ...goAroundOnCall('t4g', 't4GoAround', 200, true),
    ] },
    { id: 's5efato', title: 'Section 5: engine failure after take-off', lowLevel: true, steps: [
      ...efato('t5e', 't5Efato', true),
      setup('backOnFinal', { reposition: finalStart(3, 20, undefined, 75), cue: 'L21.landNow', pf: 'student' }),
      wait('lastLanding', all(ev('landing'), ev('stopped')), { cue: 'L21.fullStop', timeoutS: 420, onTimeout: 'next' }),
      end('fin', 'L21.endOfTest'),
    ] },
  ],
  awards: [{ id: 'ppl', when: 'testPass', title: 'Private Pilot Licence' }],
  lookAhead: 'Keep current: three circuits every month, and fly with an instructor once a year.',
};

export const STAGE4: readonly Lesson[] = [L20, L21];

