// Stage 1, handling: L01-L07 (section 4.1). Dual lessons in the training area (L02 on the ground).
//
// Altitudes: the training area's terrain reaches about 1,450 ft (1,750 ft within 9 NM along the headings
// used), so every upper-air lesson works at or above 3,500 ft MSL (terrain + 2,000 ft, section 2.8) and keeps
// the 1,500 ft upper-air envelope. L04 therefore starts at 3,500 ft rather than the 2,500 ft of section 4.1
// (its climb and descent bands move up 1,000 ft); no 3 NM circle near the field clears 2,500 ft by 2,000 ft.
// Long straight tasks fly headings 100 or 200, which stay over the low valley floor; phases that need room
// begin by repositioning over the area ("I've brought us back over the area").

import {
  all, any, binary, capture, check, checklist, demo, end, eq, ev, ever, exerciseGrade, ge, gt, handover, held, hold,
  le, lt, near, not, peak, say, setup, turned, v, vs, wait,
} from '../../engine/dsl';
import type { Criterion, Lesson, Ref, StepDef, TaskCard, TaskStep } from '../../types';
import {
  alt, areaStart, assessedEx, between, demoEx, dualRules, hdg, ias, PARKING_COLD, practiceEx, rpm, task,
  UPPER_AIR,
} from './common';
import {
  clearingTurnTask, climbTask, descentTask, slowFlightTask, stallTask, straightLevelTask,
  turn360Task, wingsLevel,
} from './manoeuvres';
import { presetWhile, tuneLessonCoach } from '../coachPresets';
import { engineStartSteps, runupSteps, taxiToA1Task } from './ground';
import {
  beyond, clearingTurnFeedback, climbFeedback, descentFeedback, feedback, HANDLING, limits, ms, ontoFeedback,
  slowFlightFeedback, stallFeedback, straightLevelFeedback, turnFeedback,
} from './instruction';

/**
 * Assessed tasks: she said she would stay quiet, so no running commentary; a neutral "Thank you" closes each
 * item (an FI or examiner says no more during an assessment).
 */
const ASSESSED = feedback({ success: 'Thank you.' });

/** Back over the middle of the area at a known altitude and heading, trimmed (instructor flying). */
const backToArea = (id: string, altFt: number, hdgDeg: number, kias = vs('Vcruise')) =>
  setup(id, { reposition: areaStart(altFt, hdgDeg, kias), cue: 'common.backToArea', pf: 'instructor' });

// =====================================================================================================
// L01 Effects of controls
// =====================================================================================================

/** L01 limits: bank beyond 45 deg, pitch beyond +20/-15 deg, speed below 60 or above 125 KIAS. */
const L01_SPEC = { bank: 45, pitchUp: 20, pitchDown: -15, minKias: 60, maxKias: 125 } as const;
const L01_LIMITS = limits(L01_SPEC);

/**
 * "Yawed with the rudder" (owner playtest: half rudder never registered on the ball). The ball out past half
 * way, or the yaw itself: a sideslip beyond 4 degrees, or a yaw rate beyond 3 deg/s with the rudder in, held
 * 1 s. Telemetry has no sideslip or yaw-rate signal yet, so the evidence is read where it shows: in L01's calm
 * air the heading minus the track (driftDeg) is the sideslip, and the turn coordinator (turnRate, standard-rate
 * units: 1 = 3 deg/s) shows the yaw rate. The rudder gate keeps a turn flown on aileron alone out of it.
 */
const YAWED = any(
  beyond('ball', 0.5),
  held(beyond('driftDeg', 4), 1),
  held(all(beyond('turnRate', 1), beyond('rudder', 0.15)), 1),
);

/** L01 trimming: the nose-down trim she wound in (0.04) has been wound back out, at least half of it. */
const RETRIMMED = ever(ge('trim', v('t0', -0.02)));

/**
 * Right rudder holding the ball in the middle at full power in the climb: ball within 0.12 (feet off it sits
 * 0.15-0.25 out to the right), at least 0.12 of right pedal (a balanced Vy climb at full power takes about 0.25,
 * README), at Vy +-10, held 3 s. Round 7, item 9: the pedal was measured from r0, the rudder captured after the
 * handover, which in the real app could already hold the student's (or the yaw damper's) pedal; the student is
 * handed the pedals centred (setup feetOff), so the pedal is now measured from centre.
 */
const POWER_BALANCED = held(all(ge('throttle', 0.9), near('ball', 0, 0.12), gt('rudder', 0.12), near('asiKt', vs('Vy'), 10)), 3);
/** The student's right pedal is in. */
const PEDAL_IN = gt('rudder', 0.1);

/**
 * L01 power and yaw (owner playtest: "the yaw from adding power looks much too low"). Full power and a Vy climb:
 * slipstream and P-factor swing the nose left and put the ball out to the right; the student centres it with
 * right rudder and holds it. The lines say what is still missing (power, attitude, rudder), from the state.
 */
function powerYawTask(): StepDef[] {
  const fullPower = ge('throttle', 0.9);
  return [
    // Slow, level and trimmed first (playtest 3: flown from 101 KIAS the swing was 2 degrees; it shows at climb
    // speed). She brings us back over the area at 68 KIAS, then hands over feet-off.
    setup('slowForPower', { reposition: areaStart(3500, 200, 68), controls: { rudder: 0 }, pf: 'instructor' }),
    say('powerSetup', 'L01.powerSetup', { wait: true }),
    // Handed over first, then feet off: the pedals centred (the real-app run handed over 0.128 of right rudder,
    // the instructor's yaw damper, which halves the swing the student is meant to see).
    handover('powerHandover', 'student'),
    setup('feetOff', { controls: { rudder: 0 } }),
    task({ id: 'powerYaw', exercise: 'powerYaw', pf: 'student', brief: 'L01.power',
      card: { title: 'Full power climb: ball centred with right rudder', targets: [
        { label: 'BALL', sig: 'ball', value: 0, tol: 0.2, unit: '' }, ias(vs('Vy'), 10)] },
      goal: all(ever(held(fullPower, 2)), POWER_BALANCED), timeoutS: 120, onTimeout: 'next', coach: [],
      criteria: [
        check('fullPower', 'Full power set', { pred: held(fullPower, 2), required: true }),
        check('rightRudder', 'Ball centred with right rudder', { pred: POWER_BALANCED, required: true,
          advice: { fail: 'At full power the ball goes right: step on the ball, right rudder, and hold it.' } }),
      ],
      feedback: feedback({
        start: 'Go ahead: feet off the pedals, throttle fully in, and watch the nose and the ball.',
        milestones: [
          ms('power', held(fullPower, 1), ['Full power. See the nose swing left, and the ball slide out to the right?']),
          ms('skid', all(ever(held(fullPower, 2)), held(all(gt('ball', 0.1), not(PEDAL_IN)), 2)),
            ["That's the yaw. Now right rudder, key X, until the ball centres. Nose up to the climb attitude."]),
          ms('pedal', all(ever(held(fullPower, 1)), PEDAL_IN, gt('ball', 0.12)), ["That's the right pedal. A little more: step on the ball."]),
          ms('centred', all(ever(held(fullPower, 1)), near('ball', 0, 0.12), PEDAL_IN), ['Ball in the middle. Feel the pedal you need? Hold it, at {vspeed.Vy:kt}.']),
        ],
        success: 'Good. Full power yaws us left; right rudder keeps us in balance. Remember it on every take-off.',
        nudge: ['Still waiting on {missing}.'],
        nudgeMissing: [
          { when: lt('throttle', 0.9), text: 'full power', cue: { text: 'Throttle fully in: F4, or hold F3.' }, point: 'throttle' },
          { when: not(PEDAL_IN), text: 'the right pedal', cue: { text: 'The ball is out to the right: right rudder, key X, and keep it pressed.' }, point: 'rudderPedals' },
          { when: not(near('ball', 0, 0.12)), text: 'the ball', cue: { text: 'Not quite in balance yet: a little more or less right pedal until the ball is centred.' }, point: 'ball' },
          { when: not(near('asiKt', vs('Vy'), 10)), text: 'the climb speed', cue: { text: 'Pitch for {vspeed.Vy:kt}: the nose a little up or down, then hold the attitude.' }, point: 'asi' },
        ],
        nudgeAfterS: 15, nudgeEveryS: 20,
      }),
      // Full power from 68 KIAS hands-off raises the nose and bleeds the speed: 55 KIAS (Vs1 + 7), not 60.
      limits: limits({ ...L01_SPEC, minKias: 55 }) }),
  ];
}

export const L01: Lesson = tuneLessonCoach({
  id: 'L01', version: 3, number: 1, title: 'Effects of controls',
  syllabusRef: { easa: 'Ex 3 & 4', faa: 'ACS I (familiarisation)' },
  stage: 'handling', kind: 'dual', persona: 'instructor', requires: [], aircraft: 'any', estMinutes: 12,
  start: areaStart(3500, 200, 100), startOptions: { payload: 'forward', fuelFraction: 0.8 },
  weather: { preset: 'calm' },
  rules: dualRules({ coachLevel: 'full', maxDurationS: 1500, envelope: UPPER_AIR }),
  briefing: {
    aim: 'To learn what each control does, and to trim the aircraft to fly hands-off.',
    points: [
      'Elevator controls pitch, ailerons control roll, rudder controls yaw: always relative to the aircraft.',
      'Further effects: rudder also rolls, aileron causes adverse yaw, power changes pitch and yaw.',
      'Flap raises the nose and lowers the speed; trim removes the control pressure.',
      'Attitude, power, trim: set the attitude, set the power, then trim the pressure away.',
    ],
    numbers: [{ label: 'Cruise speed', value: vs('Vcruise'), unit: 'kt' }, { label: 'Cruise power', value: { setting: 'cruiseRpm' }, unit: 'rpm' },
      { label: 'Flap limit, 10°', value: vs('Vfe10'), unit: 'kt' }, { label: 'Flap limit, full', value: vs('VfeFull'), unit: 'kt' }],
    tolerances: ['altitude'],
    airmanship: ['Lookout before every manoeuvre: scan the sky in sectors.', 'Hand over and take over with the three-way call.'],
    keys: ['pitchUp', 'pitchDown', 'rollLeft', 'rollRight', 'rudderLeft', 'rudderRight', 'trimNoseUp', 'trimNoseDown', 'ack'],
    diagram: { kind: 'turn', bankDeg: 15 },
    more: 'The trim tab holds the elevator where you leave it, so the aircraft keeps its attitude with no force on the controls. A trimmed aircraft is easier and less tiring to fly precisely.',
    spoken: 'L01.brief',
  },
  exercises: [
    demoEx('primaryDemo', 'Demonstration: primary effects', 'effectsOfControls'),
    demoEx('furtherDemo', 'Demonstration: further effects', 'effectsOfControls'),
    assessedEx('controls', 'Your turn: pitch, roll and yaw', 'effectsOfControls', { standard: 'training', weight: 1 }),
    assessedEx('trim', 'Trim for hands-off flight', 'effectsOfControls', { standard: 'training', weight: 1 }),
    // Required (round 7, item 9): the AutoStudent flies it, with the keys too.
    assessedEx('powerYaw', 'Power and yaw: right rudder in the climb', 'effectsOfControls', { standard: 'training', weight: 1 }),
  ],
  flow: [
    { id: 'demo', title: 'Demonstration', steps: [
      say('intro', 'L01.demoIntro', { wait: true }),
      demo('demoPrimary', 'primaryEffects', { followMeThrough: true, highlight: ['ai'] }),
      demo('demoFurther', 'furtherEffects', { followMeThrough: true, highlight: ['ai', 'ball'] }),
      say('demoWrap', 'L01.demoWrap', { wait: true }),
    ] },
    { id: 'yourTurn', title: 'Your turn', steps: [
      capture('capP', { p0: 'aiPitchDeg' }),
      task({ id: 'pitch', exercise: 'controls', pf: 'student', brief: 'L01.pitch',
        card: { title: 'Pitch up 5°, down 5°, back to level', targets: [{ label: 'PITCH', sig: 'aiPitchDeg', value: v('p0'), tol: 6, unit: 'deg' }] },
        goal: all(ever(ge('aiPitchDeg', v('p0', 5))), ever(le('aiPitchDeg', v('p0', -5))), held(near('aiPitchDeg', v('p0'), 2), 3)),
        timeoutS: 90, onTimeout: 'next', coach: [],
        criteria: [
          check('pitchUp', 'Nose raised 5°', { pred: ge('aiPitchDeg', v('p0', 5)), required: true }),
          check('pitchDown', 'Nose lowered 5°', { pred: le('aiPitchDeg', v('p0', -5)), required: true }),
        ],
        feedback: feedback({
          start: 'Go ahead. Ease the column back, and watch the attitude indicator.',
          milestones: [
            ms('rising', ge('aiPitchDeg', v('p0', 2.5)), ["That's it, the nose is coming up.", 'Good, the nose is rising against the horizon.']),
            ms('up', ge('aiPitchDeg', v('p0', 5)), ['Five degrees up. See the speed washing off? Now ease forward, through level, to 5 below.']),
            ms('down', all(ever(ge('aiPitchDeg', v('p0', 5))), le('aiPitchDeg', v('p0', -4))), ['Nose below the horizon: hear the speed building? Pitch changes the speed.']),
            ms('level', all(ever(le('aiPitchDeg', v('p0', -5))), held(near('aiPitchDeg', v('p0'), 2), 1)), ['And back to level. Hold it there.']),
          ],
          success: 'Good. Elevator controls pitch, and pitch controls the speed. Nicely done.',
          // Neutral: a nudge cannot know which part the student is on (release playtest: "back pressure" was said
          // while the nose needed to come down).
          nudge: ['Small, smooth movements, and watch the nose against the horizon.',
            'Take your time: move the column a little, then pause and let the attitude settle.'],
          nudgeAfterS: 12, nudgeEveryS: 15,
        }),
        limits: L01_LIMITS }),
      task({ id: 'roll', exercise: 'controls', brief: 'L01.roll',
        card: { title: 'Bank 15° left, 15° right, level', targets: [{ label: 'BANK', sig: 'aiBankDeg', value: 0, tol: 15, unit: 'deg' }] },
        goal: all(ever(le('aiBankDeg', -12)), ever(ge('aiBankDeg', 12)), held(near('aiBankDeg', 0, 3), 3)),
        timeoutS: 120, onTimeout: 'next', coach: [],
        criteria: [
          check('rollLeft', 'Bank 15° left', { pred: le('aiBankDeg', -12), required: true }),
          check('rollRight', 'Bank 15° right', { pred: ge('aiBankDeg', 12), required: true }),
          check('rollLevel', 'Wings level again', { pred: held(near('aiBankDeg', 0, 3), 3), required: true }),
        ],
        feedback: feedback({
          start: 'Go ahead. Wheel to the left, gently, and watch the horizon tilt.',
          milestones: [
            ms('rolling', le('aiBankDeg', -6), ["That's it, rolling left. Centralise the wheel and the bank stays.", 'Good, the left wing is going down.']),
            ms('left', le('aiBankDeg', -12), ['Fifteen left, and the nose starts to turn. Now roll smoothly through level to 15 right.']),
            ms('right', all(ever(le('aiBankDeg', -12)), ge('aiBankDeg', 12)), ['Fifteen right. Now roll the wings level and hold them there.']),
          ],
          success: 'Wings level. Ailerons control roll, and the bank makes us turn. Well done.',
          nudge: ['A small movement of the wheel, then centralise it: the bank stays where you leave it.',
            'Smoothly does it. Watch the horizon tilt, and check the bank on the attitude indicator.'],
          nudgeAfterS: 12, nudgeEveryS: 15,
        }),
        limits: L01_LIMITS }),
      task({ id: 'yaw', exercise: 'controls', brief: 'L01.yaw',
        card: { title: 'Yaw, then centre the ball', targets: [{ label: 'BALL', sig: 'ball', value: 0, tol: 0.3, unit: '' }] },
        goal: all(ever(YAWED), held(near('ball', 0, 0.15), 3)),
        timeoutS: 90, onTimeout: 'next', coach: [],
        criteria: [
          check('yawed', 'Yawed with the rudder', { pred: YAWED, required: true }),
          check('ballCentred', 'Ball centred', { pred: held(near('ball', 0, 0.15), 3), required: true }),
        ],
        feedback: feedback({
          start: 'Go ahead. Left pedal, firmly, and hold it. Watch the nose slide along the horizon.',
          milestones: [
            ms('pedal', held(beyond('rudder', 0.15), 0.5), ["That's the rudder. See the nose yaw, and the ball swing out the other way?"]),
            ms('yawed', YAWED, ["That's yaw. See the wing start to drop? That's roll. Now ease the rudder off and centre the ball."]),
            ms('centring', all(ever(YAWED), near('ball', 0, 0.3), near('rudder', 0, 0.15)), ["Rudder off, and the ball's coming back to the middle."]),
          ],
          success: "Ball in the middle: we're in balance. Rudder controls yaw; keep the ball centred.",
          nudge: ['Smooth pressure on the pedals, and keep an eye on the ball.', 'Feet on the rudder, and watch the ball: the rudder moves it.'],
          nudgeAfterS: 12, nudgeEveryS: 15,
        }),
        limits: L01_LIMITS }),
      ...powerYawTask(),
    ] },
    { id: 'trim', title: 'Trimming', steps: [
      // After the full-power climb: she levels off and brings us back over the area at cruise, then hands over.
      backToArea('backForTrim', 3500, 200),
      capture('capT', { a0: 'altFt', hdg0: 'hdgDeg', t0: 'trim' }),
      // Out of trim first (release playtest: the aircraft was handed over already trimmed, so the task passed
      // without a touch): she winds in nose-down trim, the student holds the attitude, then trims it out.
      // Said first and heard in full (the trim change comes after it, so the student is ready to hold the nose);
      // a small change: 0.15 had the nose 24 degrees down within 4 s in the playtest.
      say('mistrimSay', 'L01.mistrim', { wait: true }),
      setup('mistrim', { trimDelta: -0.04 }),
      task({ id: 'trimTask', exercise: 'trim', pf: 'student', brief: 'L01.trim',
        card: { title: 'Trim hands-off, hold altitude 30 s', targets: [alt(v('a0')), hdg(v('hdg0'))] },
        // The nose-down trim wound back out (at least half of it), and then hands-off for 30 s.
        goal: all(RETRIMMED, held(all(lt('untrimmedS', 1), near('altFt', v('a0'), 200)), 30)), timeoutS: 180, onTimeout: 'next',
        coach: ['trim', 'altitude'],
        criteria: [
          check('trimmed', 'Trimmed hands-off for 30 s', { pred: held(lt('untrimmedS', 1), 30), required: true,
            advice: { fail: 'Hold the attitude, then trim until you can relax your grip: the pressure should be zero.' } }),
          hold('trimAlt', 'Altitude', 'altFt', v('a0'), 'altitude', { settleS: 10, required: true }),
        ],
        feedback: feedback({
          start: 'Go ahead. Trim nose up until you can relax your grip, and watch the altimeter.',
          milestones: [
            // Each only once the nose-down trim has been wound back out: "no pressure" from a student who is not
            // holding the yoke at all is not trimming (release playtest).
            ms('noPressure', all(RETRIMMED, held(lt('untrimmedS', 1), 5)), ["That's it, no pressure now. Let's see if it holds the altitude."], 8),
            ms('steady', all(RETRIMMED, held(all(lt('untrimmedS', 1), near('altFt', v('a0'), 100)), 15)), ['Halfway. The altitude is steady: the aircraft is flying itself.']),
            ms('nearly', all(RETRIMMED, held(all(lt('untrimmedS', 1), near('altFt', v('a0'), 150)), 25)), ['Nearly there. Hands light, eyes outside.']),
          ],
          success: 'Trimmed. Attitude, power, trim: set the attitude, hold it, then trim the pressure away.',
          nudge: ['Trim in the direction of the pressure, a little at a time, then relax and see.',
            'Hold the attitude first. Then trim until the pressure on the column is gone.'],
        }),
        limits: limits({ ...L01_SPEC, alt: { var: 'a0', below: 400, above: 400 } }) }),
      end('fin', 'L01.wrap'),
    ] },
  ],
  debriefTips: {
    'trimAlt.drift': 'A slow drift in altitude means the aircraft is not quite in trim: small trim changes, then wait.',
  },
  lookAhead: 'Next: straight and level flight, holding altitude, heading and speed at cruise and slower speeds.',
});

// =====================================================================================================
// L02 Ground: start, taxi, power checks, shutdown
// =====================================================================================================

// The ground pieces (before-start checks, start, taxi to A1, run-up) live in ground.ts.

export const L02: Lesson = tuneLessonCoach({
  id: 'L02', version: 2, number: 2, title: 'Ground: start, taxi, power checks, shutdown',
  syllabusRef: { easa: 'Ex 2 & 5', faa: 'ACS II.C-F' },
  stage: 'handling', kind: 'dual', persona: 'instructor', requires: ['L01'], aircraft: 'any', estMinutes: 14,
  start: PARKING_COLD, startOptions: { payload: 'forward', fuelFraction: 0.8 },
  weather: { preset: 'calm' },
  rules: dualRules({ coachLevel: 'full', maxDurationS: 1800 }),
  briefing: {
    aim: 'To set up and start the engine by the checklist, taxi to holding point A1 and do the power checks.',
    points: [
      'Before start, every switch and lever is checked: I point to each one and say where it goes, and why.',
      'Starter for no more than 10 seconds; oil pressure within 30 seconds; then set 1,000 rpm.',
      'Route to A1: right along the apron, left on B1, right on Alpha, left on A1. I call each turn.',
      'Taxi at a brisk walking pace, no faster than 15 knots, on the yellow line. Test the brakes as you move off.',
      'Stop before the double yellow lines at the holding point. Then the power checks at 1,800 rpm.',
    ],
    numbers: [{ label: 'Taxi speed, max', value: vs('Vtaxi'), unit: 'kt' }, { label: 'After start', value: 1000, unit: 'rpm' },
      { label: 'Run-up', value: { setting: 'runupRpm' }, unit: 'rpm' },
      { label: 'Max magneto drop', value: { setting: 'magDropMaxRpm' }, unit: 'rpm' }, { label: 'Max difference', value: { setting: 'magDiffMaxRpm' }, unit: 'rpm' }],
    tolerances: [],
    airmanship: ['Look outside before starting: shout "Clear prop!" and check nobody is near.', 'Keep your eyes outside while taxiing; check the instruments in turns.',
      'Hold the yoke into the wind on the ground.'],
    keys: ['parkingBrake', 'fuelSelector', 'mixtureRich', 'throttleUp', 'throttleDown', 'masterSwitch', 'avionics', 'beacon', 'flapsUp', 'trimNoseUp', 'trimNoseDown',
      'magnetoOff', 'fuelPump', 'starter', 'brakes', 'rudderLeft', 'rudderRight', 'magnetoRight', 'magnetoLeft', 'magnetoBoth', 'navLights', 'strobes', 'landingLight', 'ack'],
    more: 'Avionics stay off for the start: the starter draws a big current and the voltage dip and spike can damage the radios. The magneto check proves each ignition system works on its own: one magneto fires one plug in each cylinder, so a small drop is normal. No drop at all can mean a magneto is not switching off.',
    spoken: 'L02.brief',
  },
  exercises: [
    assessedEx('engineStart', 'Engine start by the checklist', 'groundOps', { standard: 'training', weight: 1 }),
    assessedEx('taxi', 'Taxi to holding point A1', 'groundOps', { standard: 'training', weight: 2 }),
    assessedEx('runup', 'Power checks and before take-off checks', 'checks', { standard: 'training', weight: 1 }),
    practiceEx('shutdown', 'Shutdown', 'checks'),
  ],
  flow: [
    { id: 'start', title: 'Engine start', lowLevel: true, steps: [
      say('intro', 'L02.intro', { wait: true }),
      handover('toStudent', 'student'),
      ...engineStartSteps('', 'engineStart', 'challengeResponse'),
    ] },
    { id: 'taxi', title: 'Taxi', lowLevel: true, steps: [
      // Not off the stand above 1,000 rpm (playtest 3: the taxi began at 1,850 rpm and lurched to 10 kt); the
      // ground coach asks for it, then takes the throttle back herself.
      wait('idleForTaxi', all(eq('engineRunning', true), lt('rpm', 1250)), { timeoutS: 90, point: 'throttle', pointState: '1,000 RPM' }),
      say('taxiRoute', 'L02.taxiRoute', { wait: true, when: eq('engineRunning', true), timeoutS: 120,
        whenPrompt: { afterS: 3, cue: 'L02.engineStopped', everyS: 25 } }),
      taxiToA1Task('taxiA1', 'taxi', 'L02.taxi', true),
    ] },
    { id: 'runup', title: 'Power checks', lowLevel: true, steps: [
      say('runupIntro', 'L02.runupIntro', { wait: true }),
      ...runupSteps('', 'runup', 'challengeResponse'),
    ] },
    { id: 'shutdown', title: 'Back to parking and shut down', lowLevel: true, steps: [
      setup('toParking', { reposition: { kind: 'ground', spot: 'parking', engine: 'running' }, cue: 'L02.backAtParking' }),
      checklist('ckShutdown', 'shutdown', 'challengeResponse', { exercise: 'shutdown' }),
      end('fin', 'L02.wrap'),
    ] },
  ],
  lookAhead: 'Next: we fly. Straight and level, holding altitude, heading and speed.',
});

// =====================================================================================================
// L03 Straight and level
// =====================================================================================================

/** L03 limits: bank 30, altitude +-400 ft, pitch +15/-10, speed below `minKias` (65 at cruise) or above 130. */
const l03Limits = (altVar: string, minKias = 65) =>
  limits({ bank: 30, pitchUp: 15, pitchDown: -10, minKias, maxKias: 130, alt: { var: altVar, below: 400, above: 400 } });

export const L03: Lesson = tuneLessonCoach({
  id: 'L03', version: 1, number: 3, title: 'Straight and level',
  syllabusRef: { easa: 'Ex 6', faa: 'ACS VI.A' },
  stage: 'handling', kind: 'dual', persona: 'instructor', requires: ['L02'], aircraft: 'any', estMinutes: 13,
  start: areaStart(3500, 200), startOptions: { payload: 'forward', fuelFraction: 0.8 },
  weather: { preset: 'smooth' },
  rules: dualRules({ coachLevel: 'full', maxDurationS: 1500, envelope: UPPER_AIR }),
  briefing: {
    aim: 'To hold a constant altitude, heading and speed at cruise power and at reduced speeds.',
    points: [
      'Lookout, attitude, instruments: most of your attention is outside on the attitude.',
      'Power sets the speed; attitude holds the altitude. Change one, adjust the other.',
      'Every change is Attitude, Power, Trim, in that order.',
      'Slower speeds need more power and a higher nose; flap lowers the nose attitude.',
    ],
    numbers: [{ label: 'Cruise', value: vs('Vcruise'), unit: 'kt' }, { label: 'Cruise power', value: { setting: 'cruiseRpm' }, unit: 'rpm' },
      { label: 'Slow cruise', value: 80, unit: 'kt' }, { label: 'Slow cruise power', value: { setting: 'descentRpm' }, unit: 'rpm' },
      { label: 'Flap 20', value: vs('Vapp'), unit: 'kt' }],
    tolerances: ['altitude', 'heading', 'speed'],
    airmanship: ['Lookout in sectors every 30 seconds.', 'Check the engine temperatures and pressures every few minutes.'],
    keys: ['pitchUp', 'pitchDown', 'throttleUp', 'throttleDown', 'trimNoseUp', 'trimNoseDown', 'flapsDown', 'flapsUp'],
    diagram: { kind: 'climb' },
    spoken: 'L03.brief',
  },
  exercises: [
    demoEx('slDemo', 'Demonstration: attitude, power, trim', 'straightLevel'),
    practiceEx('slCruise', 'Straight and level at cruise', 'straightLevel'),
    practiceEx('slSlow', 'Reduced speeds, clean and with flap', 'straightLevel'),
    assessedEx('assessedSL', 'Assessed: straight and level with a speed change', 'straightLevel'),
  ],
  flow: [
    { id: 'demo', title: 'Demonstration', steps: [
      say('intro', 'L03.demoIntro', { wait: true }),
      capture('cap0', { alt0: 'altFt', hdg0: 'hdgDeg' }),
      demo('demoSL', 'straightLevel', { followMeThrough: true, highlight: ['ai', 'alt', 'asi'] }),
      say('demoWrap', 'L03.demoWrap', { wait: true }),
    ] },
    { id: 'cruise', title: 'Your turn: cruise', retryFrom: areaStart(3500, 200), steps: [
      backToArea('repos', 3500, 200),
      capture('capC', { a0: 'altFt', hdg0: 'hdgDeg' }),
      straightLevelTask({ id: 'slC', exercise: 'slCruise', brief: 'L03.holdCruise', altVar: 'a0', hdgVar: 'hdg0', kias: vs('Vcruise'), seconds: 120,
        feedback: straightLevelFeedback({ altVar: 'a0', hdgVar: 'hdg0', kias: vs('Vcruise'), seconds: 120 }), limits: l03Limits('a0') }),
    ] },
    { id: 'slow', title: 'Reduced speeds', retryFrom: areaStart(3500, 200), steps: [
      backToArea('reposS', 3500, 200),
      capture('capS', { a0: 'altFt', hdg0: 'hdgDeg' }),
      task({ id: 'slow80', exercise: 'slSlow', pf: 'student', brief: 'L03.slow80',
        card: { title: '80 kt clean, 1,900 rpm', targets: [ias(80), alt(v('a0')), hdg(v('hdg0')), rpm({ setting: 'descentRpm' }, 150)] },
        goal: { elapsed: 90 }, timeoutS: 120, onTimeout: 'next', coach: ['speed', 'altitude', 'heading', 'trim'],
        criteria: [
          hold('s80Ias', 'Speed', 'asiKt', 80, 'speed', { settleS: 25, required: true }),
          hold('s80Alt', 'Altitude', 'altFt', v('a0'), 'altitude', { settleS: 8, required: true }),
          hold('s80Hdg', 'Heading', 'hdgDeg', v('hdg0'), 'heading', { settleS: 8, required: false }),
        ],
        feedback: feedback({
          start: 'Go ahead: power back to {setting.descentRpm:rpm}, then raise the nose gradually to hold the height.',
          milestones: [
            ms('power', lt('rpm', { setting: 'cruiseRpm', add: -200 }), ["Power's back. Now the nose up a little as the speed decays.", 'Good. Raise the nose as the speed comes back.'], 1),
            ms('settled', held(all(near('asiKt', 80, 5), near('altFt', v('a0'), 100)), 5), ['Eighty knots and level. See the higher nose attitude? Now trim.']),
            ms('trimmed', all(ever(near('asiKt', 80, 5)), held(lt('untrimmedS', 1), 10)), ['Trimmed and steady. Every speed has its own attitude and power.'], 30),
          ],
          success: 'That is 80 knots, level. Slower means a higher nose and less power.',
          nudge: ['Hold the height with the attitude; the speed settles with the power.', 'Attitude for height, then trim. Be patient with the speed.'],
          nudgeAfterS: 25, nudgeEveryS: 40,
        }),
        limits: l03Limits('a0', 55) }),
      task({ id: 'slow70', exercise: 'slSlow', brief: 'L03.flap20',
        card: { title: 'Flap 20, 70 kt', targets: [ias(vs('Vapp')), alt(v('a0')), hdg(v('hdg0'))] },
        goal: all({ elapsed: 60 }, ge('flapsDeg', 18)), timeoutS: 120, onTimeout: 'next', coach: ['speed', 'altitude', 'flapLimit', 'trim'],
        criteria: [
          hold('s70Ias', 'Speed with flap 20', 'asiKt', vs('Vapp'), 'speed', { settleS: 20, activeWhen: ge('flapsDeg', 18), required: true }),
          hold('s70Alt', 'Altitude', 'altFt', v('a0'), 'altitude', { settleS: 10, required: true }),
          binary('s70Vfe', 'Flap limit speed respected', held(all(gt('flapsDeg', 12), gt('kias', vs('VfeFull'))), 1), { required: true,
            advice: { fail: 'Slow below the flap limit before you lower more than 10 degrees of flap.' } }),
        ],
        feedback: feedback({
          start: 'Go ahead: check the speed is in the white arc, then flap in stages. Expect the nose to rise.',
          milestones: [
            ms('flap10', ge('flapsDeg', 8), ['Flap coming down. Feel the nose pitch up? Hold the attitude.', 'First stage of flap. Hold the nose where it was.']),
            ms('flap20', ge('flapsDeg', 18), ['Flap 20. More drag, so a little more power to hold the height.']),
            ms('settled', all(ever(ge('flapsDeg', 18)), held(all(near('asiKt', vs('Vapp'), 5), near('altFt', v('a0'), 100)), 5)),
              ['Seventy knots, level, with flap. Notice the lower nose attitude?']),
          ],
          success: 'Good. Flap lowers the nose and adds drag: more power for the same speed.',
          nudge: ['Flap in stages, then power to hold the height and attitude for the speed.'],
          nudgeAfterS: 25, nudgeEveryS: 40,
        }),
        limits: l03Limits('a0', 55) }),
      task({ id: 'cleanUp', exercise: 'slSlow', brief: 'L03.cleanUp',
        card: { title: 'Flap up, back to cruise', targets: [ias(vs('Vcruise')), alt(v('a0'))] },
        goal: held(all(lt('flapsDeg', 1), near('asiKt', vs('Vcruise'), 8)), 5), timeoutS: 120, onTimeout: 'next', coach: ['speed', 'altitude'],
        criteria: [hold('cuAlt', 'Altitude while cleaning up', 'altFt', v('a0'), 'altitude', { settleS: 5, required: false })],
        feedback: feedback({
          start: 'Go ahead: cruise power first, then flap up in stages. Hold the nose down a touch.',
          milestones: [
            ms('power', gt('rpm', { setting: 'cruiseRpm', add: -150 }), ['Cruise power. Now the flap, one stage at a time.']),
            ms('flap', lt('flapsDeg', 11), ['Flap coming up. The nose wants to sink: hold the height.']),
            ms('clean', all(ever(lt('flapsDeg', 11)), lt('flapsDeg', 1)), ['Flap up. Let the speed build to cruise, then trim.']),
          ],
          success: 'Back at cruise, clean and level. Nicely done.',
          nudge: ['Cruise power, flap up a stage at a time, hold the height, then trim.'],
          nudgeAfterS: 25, nudgeEveryS: 40,
        }),
        limits: l03Limits('a0', 55) }),
    ] },
    { id: 'assessed', title: 'Assessed straight and level', coachLevel: 'silent', retryFrom: areaStart(3500, 200), steps: [
      backToArea('reposA', 3500, 200),
      say('quiet', 'common.illStayQuiet', { wait: true }),
      capture('capA', { a1: 'altFt', hdg1: 'hdgDeg' }),
      straightLevelTask({ id: 'aSL', exercise: 'assessedSL', brief: 'L03.assessCruise', altVar: 'a1', hdgVar: 'hdg1', kias: vs('Vcruise'), seconds: 60, coach: [],
        feedback: ASSESSED, limits: l03Limits('a1') }),
      straightLevelTask({ id: 'aSlow', exercise: 'assessedSL', brief: 'L03.assessSlow', altVar: 'a1', hdgVar: 'hdg1', kias: 85, seconds: 75, speedSettleS: 25, coach: [],
        feedback: ASSESSED, limits: l03Limits('a1', 60) }),
      end('fin', 'common.endDual'),
    ] },
  ],
  debriefTips: {
    'aSlowAlt.biasLow': 'When you took the power off the nose dropped: raise it as the speed decays, then trim.',
    'aSLAlt.oscillation': 'Small, smooth pitch changes: pick an attitude, hold it, let the altimeter settle before correcting again.',
  },
  lookAhead: 'Next: climbing and descending, and levelling off on an exact altitude.',
});

// =====================================================================================================
// L04 Climbing and descending (section 2.12, altitudes raised 1,000 ft: see the file header)
// =====================================================================================================

/**
 * L04 limits: wings within 30 deg, pitch -15 (descents also +20), and a speed band for the manoeuvre (climb: 60-125 KIAS; glide:
 * 55-110; powered descent: 65-125); 400 ft past the level-off altitude means the level-off was missed.
 */
// No nose-up limit in a climb: the speed band says it better (the climb entry from cruise briefly passes 20 deg).
const climbLimits = (tgtVar: string) => limits({ bank: 30, pitchDown: HANDLING.pitchDown, minKias: 60, maxKias: 125, alt: { var: tgtVar, above: 400 } });
const descentLimits = (tgtVar: string, glide = false) =>
  limits({ bank: 30, ...HANDLING, minKias: glide ? 55 : 65, maxKias: glide ? 110 : 125, alt: { var: tgtVar, below: 400 } });

export const L04: Lesson = tuneLessonCoach({
  id: 'L04', version: 1, number: 4, title: 'Climbing and descending',
  syllabusRef: { easa: 'Ex 7 & 8', faa: 'ACS VI.B-C (basic attitude: climbs, descents)' },
  stage: 'handling', kind: 'dual', persona: 'instructor', requires: ['L03'], aircraft: 'any', estMinutes: 12,
  start: areaStart(3500, 100), startOptions: { payload: 'forward', fuelFraction: 0.8 },
  weather: { preset: 'smooth' },
  rules: dualRules({ coachLevel: 'full', maxDurationS: 1500, envelope: UPPER_AIR }),
  briefing: {
    aim: 'To climb and descend at a chosen speed and rate, and level off at a chosen altitude.',
    points: [
      'Every change is Attitude, then Power, then Trim (APT); level-off is Attitude, Power, Trim too.',
      'Climb at Vy with full power; the speed is held with attitude.',
      'Begin the level-off at 10 % of the vertical speed: 50 ft early at 500 fpm.',
      'Descents: glide at best glide speed with idle power, or 500 fpm at 90 kt with reduced power.',
    ],
    numbers: [{ label: 'Vy', value: vs('Vy'), unit: 'kt' }, { label: 'Cruise climb', value: vs('Vcc'), unit: 'kt' },
      { label: 'Best glide', value: vs('Vglide'), unit: 'kt' }, { label: 'Descent speed', value: vs('Vdescent'), unit: 'kt' },
      { label: 'Descent rate', value: 500, unit: 'fpm' }, { label: 'Descent power', value: { setting: 'descentRpm' }, unit: 'rpm' }],
    tolerances: ['altitude', 'heading', 'speedClimbApproach', 'speed', 'vs'],
    airmanship: ['Lookout ahead and above before climbing; ahead and below before descending.',
      'Watch the oil temperature in a long climb: lower the nose if it rises toward the red line.',
      'The 172S is fuel injected: there is no carburettor heat.'],
    keys: ['throttleUp', 'throttleDown', 'throttleFull', 'pitchUp', 'pitchDown', 'trimNoseUp', 'trimNoseDown'],
    diagram: { kind: 'climb' },
    spoken: 'L04.brief',
  },
  exercises: [
    demoEx('climbDemo', 'Demonstration: climb and level-off', 'climb'),
    practiceEx('climbPractice', 'Climb at Vy and level off', 'climb'),
    practiceEx('descentPractice', 'Glide and powered descents', 'descent'),
    assessedEx('assessedClimb', 'Assessed: climb and level-off', 'climb'),
    assessedEx('assessedDescent', 'Assessed: 500 fpm descent and level-off', 'descent'),
  ],
  flow: [
    { id: 'demo', title: 'Demonstration', steps: [
      say('intro', 'L04.demoIntro', { wait: true }),
      capture('cap0', { alt0: 'altFt', hdg0: 'hdgDeg' }),
      demo('demoClimb', 'climbLevelOff', { followMeThrough: true, highlight: ['ai', 'asi', 'vsi'] }),
      say('demoWrap', { id: 'L04.demoWrap', vars: { alt: v('alt0', 1000) } }, { wait: true }),
    ] },
    { id: 'practiceClimb', title: 'Your climb', repeat: { max: 2, until: exerciseGrade('climbPractice', 2) }, retryFrom: areaStart(3500, 100), steps: [
      backToArea('repos', 3500, 100),
      capture('capC', { hdg0: 'hdgDeg', a0: 'altFt' }),
      capture('tgtC', { tgt: v('a0', 1000) }),
      climbTask({ id: 'climb', exercise: 'climbPractice', brief: { id: 'L04.climbTo', vars: { alt: v('tgt') } }, tgtVar: 'tgt', hdgVar: 'hdg0', required: true, demoOnTimeout: 'climbLevelOff',
        feedback: climbFeedback({ tgtVar: 'tgt' }), limits: climbLimits('tgt') }),
      say('climbDone', 'common.goodNowCruise'),
      task({ id: 'settle', exercise: 'climbPractice', brief: 'L04.settleCruise',
        card: { title: 'Cruise: 2,300 rpm, trimmed', targets: [rpm({ setting: 'cruiseRpm' }, 100)] },
        goal: held(all(near('rpm', { setting: 'cruiseRpm' }, 100), lt('untrimmedS', 1)), 5), timeoutS: 60, onTimeout: 'next',
        coach: ['trim'], criteria: [check('trimmed', 'Trimmed after level-off', { pred: held(lt('untrimmedS', 1), 5), required: false })],
        feedback: feedback({
          start: 'Go ahead: throttle back to {setting.cruiseRpm:rpm}, then trim the pressure away.',
          milestones: [
            ms('rpm', near('rpm', { setting: 'cruiseRpm' }, 100), ['Cruise power set. Now trim until you can relax your grip.']),
            ms('light', all(ever(near('rpm', { setting: 'cruiseRpm' }, 100)), held(lt('untrimmedS', 1), 2)), ["That's it, hands light. It holds the attitude for you."]),
          ],
          success: "Trimmed at cruise. That's the level-off finished: attitude, power, trim.",
          nudge: 'Trim a little at a time, in the direction you are holding pressure.',
        }),
        limits: limits({ bank: 30, ...HANDLING, minKias: 65, maxKias: 130, alt: { var: 'tgt', below: 400, above: 400 } }) }),
    ] },
    { id: 'practiceDescent', title: 'Descents', retryFrom: areaStart(4500, 200), steps: [
      backToArea('reposD', 4500, 200),
      capture('capD', { a1: 'altFt', hdg0: 'hdgDeg' }),
      capture('tgtD', { glideTo: v('a1', -500), descTo: v('a1', -1000) }),
      descentTask({ id: 'glide', exercise: 'descentPractice', brief: { id: 'L04.glideTo', vars: { alt: v('glideTo') } }, tgtVar: 'glideTo', hdgVar: 'hdg0', glide: true, heading: false, demoOnTimeout: 'glideLevelOff',
        feedback: descentFeedback({ tgtVar: 'glideTo', glide: true }), limits: descentLimits('glideTo', true) }),
      descentTask({ id: 'powered', exercise: 'descentPractice', brief: { id: 'L04.descend500', vars: { alt: v('descTo') } }, tgtVar: 'descTo', hdgVar: 'hdg0', heading: false,
        feedback: descentFeedback({ tgtVar: 'descTo' }), limits: descentLimits('descTo') }),
    ] },
    { id: 'assessed', title: 'Assessed climb and descent', coachLevel: 'silent', retryFrom: areaStart(3500, 100), steps: [
      backToArea('reposA', 3500, 100),
      say('quiet', 'common.illStayQuiet', { wait: true }),
      capture('capA', { a2: 'altFt', hdg0: 'hdgDeg' }),
      capture('tgtA', { up: v('a2', 1000) }),
      climbTask({ id: 'aClimb', exercise: 'assessedClimb', brief: { id: 'L04.climbTo', vars: { alt: v('up') } }, tgtVar: 'up', hdgVar: 'hdg0', coach: [],
        feedback: ASSESSED, limits: climbLimits('up') }),
      capture('tgtB', { down: v('up', -1000) }),
      descentTask({ id: 'aDesc', exercise: 'assessedDescent', brief: { id: 'L04.descend500', vars: { alt: v('down') } }, tgtVar: 'down', hdgVar: 'hdg0', coach: [],
        feedback: ASSESSED, limits: descentLimits('down') }),
      end('fin', 'L04.wrap'),
    ] },
  ],
  debriefTips: {
    'aClimbIas.oscillation': 'You were chasing the airspeed. Set the attitude, hold it, wait five seconds, then adjust.',
    'aDescVs.biasHigh': 'The descent was shallow: a little less power, and keep 90 kt with the attitude.',
  },
  lookAhead: 'Next: medium turns, level, climbing and descending, and rolling out on a heading.',
});

// =====================================================================================================
// L05 Medium turns
// =====================================================================================================

const ONTO_290: TaskCard = { title: 'Right onto 290', targets: [hdg(290, 'rollout'), alt(v('a0')), { label: 'BANK', sig: 'aiBankDeg', value: 30, tol: 'bankMedium', unit: 'deg' }] };
const ONTO_110: TaskCard = { title: 'Left onto 110', targets: [hdg(110, 'rollout'), alt(v('a0')), { label: 'BANK', sig: 'aiBankDeg', value: -30, tol: 'bankMedium', unit: 'deg' }] };
/**
 * Turns onto a heading: the bank is coached only while the turn is under way, from 10 s after the brief (time to
 * look out and roll in) until 20 degrees before the heading, where the roll-out begins.
 */
const ontoCoach = (card: TaskCard, hdgDeg: number): TaskStep['coach'] =>
  [presetWhile('bank', card, all(gt('step.t', 10), not(near('hdgDeg', hdgDeg, 20)))), 'altitude', 'ball'];

/** Level-turn limits: bank 15 deg beyond the target, altitude +-400 ft, pitch +20/-15, 70-130 KIAS. */
const turnLimits = (bankDeg: number, altVar: string) =>
  limits({ bank: bankDeg, ...HANDLING, minKias: 70, maxKias: 130, alt: { var: altVar, below: 400, above: 400 } });

export const L05: Lesson = tuneLessonCoach({
  id: 'L05', version: 1, number: 5, title: 'Medium turns',
  syllabusRef: { easa: 'Ex 9', faa: 'ACS VI.D' },
  stage: 'handling', kind: 'dual', persona: 'instructor', requires: ['L04'], aircraft: 'any', estMinutes: 13,
  start: areaStart(3500, 200, 100), startOptions: { payload: 'forward', fuelFraction: 0.8 },
  weather: { preset: 'light' },
  rules: dualRules({ coachLevel: 'reduced', maxDurationS: 1500, envelope: UPPER_AIR }),
  briefing: {
    aim: 'To fly level, climbing and descending turns at a constant bank, and roll out on a chosen heading.',
    points: [
      'Lookout first, into the turn and above and below.',
      'Roll on the bank with aileron and a touch of rudder; hold it there.',
      'In a level turn, add a little back pressure to hold altitude.',
      'Roll out about half the bank angle early: 15 degrees before the heading at 30 degrees of bank.',
    ],
    numbers: [{ label: 'Medium bank', value: 30, unit: 'deg' }, { label: 'Turn speed', value: 100, unit: 'kt' },
      { label: 'Climbing turn bank', value: 15, unit: 'deg' }, { label: 'Vy', value: vs('Vy'), unit: 'kt' }, { label: 'Best glide', value: vs('Vglide'), unit: 'kt' }],
    tolerances: ['bankMedium', 'altitude', 'speed', 'rollout'],
    airmanship: ['Clear the airspace in the direction of the turn before rolling.', 'Look out through the turn, not at the instruments.'],
    keys: ['rollLeft', 'rollRight', 'rudderLeft', 'rudderRight', 'pitchUp', 'trimNoseUp'],
    diagram: { kind: 'turn', bankDeg: 30 },
    spoken: 'L05.brief',
  },
  exercises: [
    demoEx('turnDemo', 'Demonstration: 30° turn and roll-out', 'turns'),
    practiceEx('turns360', 'Level 360s left and right', 'turns'),
    practiceEx('turnsOnto', 'Turns onto headings', 'turns'),
    practiceEx('turnsClimbDesc', 'Climbing and descending turns', 'turns'),
    assessedEx('assessedTurns', 'Assessed: 360 left and right at 30°', 'turns'),
  ],
  flow: [
    { id: 'demo', title: 'Demonstration', steps: [
      say('intro', 'L05.demoIntro', { wait: true }),
      capture('cap0', { alt0: 'altFt', hdg0: 'hdgDeg' }),
      demo('demoTurn', 'mediumTurn', { followMeThrough: true, highlight: ['ai', 'alt'] }),
      say('demoWrap', 'L05.demoWrap', { wait: true }),
    ] },
    { id: 'practice360', title: 'Level 360s', retryFrom: areaStart(3500, 200, 100), steps: [
      backToArea('repos', 3500, 200, 100),
      capture('capL', { a0: 'altFt', hdg0: 'hdgDeg' }),
      turn360Task({ id: 'p360L', exercise: 'turns360', brief: 'L05.turn360Left', dir: 'left', bankDeg: 30, bankTol: 'bankMedium', kias: 100, altVar: 'a0', hdgVar: 'hdg0',
        feedback: turnFeedback({ dir: 'left', bankDeg: 30 }), limits: turnLimits(45, 'a0') }),
      capture('capR', { a0: 'altFt', hdg0: 'hdgDeg' }),
      turn360Task({ id: 'p360R', exercise: 'turns360', brief: 'L05.turn360Right', dir: 'right', bankDeg: 30, bankTol: 'bankMedium', kias: 100, altVar: 'a0', hdgVar: 'hdg0',
        feedback: turnFeedback({ dir: 'right', bankDeg: 30 }), limits: turnLimits(45, 'a0') }),
    ] },
    { id: 'onto', title: 'Turns onto headings', retryFrom: areaStart(3500, 200, 100), steps: [
      backToArea('reposO', 3500, 200, 100),
      capture('capO', { a0: 'altFt' }),
      task({ id: 'onto290', exercise: 'turnsOnto', pf: 'student', brief: 'L05.onto290', card: ONTO_290,
        goal: all(held(near('hdgDeg', 290, 5), 3), ev('rolloutComplete')), timeoutS: 90, onTimeout: 'next', coach: ontoCoach(ONTO_290, 290),
        criteria: [
          { id: 'o290Hdg', label: 'Roll-out heading', kind: 'final', sig: 'hdgDeg', target: 290, tol: 'rollout', required: true },
          hold('o290Alt', 'Altitude', 'altFt', v('a0'), 'altitude', { settleS: 5, required: true }),
        ],
        feedback: ontoFeedback({ dir: 'right', hdgDeg: 290 }), limits: turnLimits(45, 'a0') }),
      task({ id: 'onto110', exercise: 'turnsOnto', brief: 'L05.onto110', card: ONTO_110,
        goal: all(held(near('hdgDeg', 110, 5), 3), ev('rolloutComplete')), timeoutS: 120, onTimeout: 'next', coach: ontoCoach(ONTO_110, 110),
        criteria: [
          { id: 'o110Hdg', label: 'Roll-out heading', kind: 'final', sig: 'hdgDeg', target: 110, tol: 'rollout', required: true },
          hold('o110Alt', 'Altitude', 'altFt', v('a0'), 'altitude', { settleS: 5, required: true }),
        ],
        feedback: ontoFeedback({ dir: 'left', hdgDeg: 110 }), limits: turnLimits(45, 'a0') }),
    ] },
    { id: 'climbDesc', title: 'Climbing and descending turns', retryFrom: areaStart(3500, 200, 100), steps: [
      backToArea('reposC', 3500, 200, 100),
      task({ id: 'climbTurn', exercise: 'turnsClimbDesc', pf: 'student', brief: 'L05.climbingTurn',
        card: { title: 'Climbing turn left at Vy, 15°', targets: [ias(vs('Vy'), 'speedClimbApproach'), { label: 'BANK', sig: 'aiBankDeg', value: -15, tol: 10, unit: 'deg' }] },
        goal: all(lt('step.turnDeg', -165), wingsLevel), timeoutS: 150, onTimeout: 'next', coach: ['speed', 'bank', 'ball'],
        criteria: [
          hold('ctIas', 'Climb speed', 'asiKt', vs('Vy'), 'speedClimbApproach', { settleS: 12, required: true }),
          hold('ctBank', 'Bank angle', 'aiBankDeg', -15, 10, { settleS: 4, activeWhen: all(lt('step.turnDeg', -15), gt('step.turnDeg', -160)), required: true }),
        ],
        feedback: feedback({
          start: 'Go ahead: lookout left, full power, climb attitude, then roll on just 15 degrees.',
          milestones: [
            ms('climbing', held(all(le('aiBankDeg', -10), gt('vsiFpm', 200)), 2), ['Climbing turn established. Keep the speed at {vspeed.Vy:kt} with the attitude.']),
            ms('half', all(ever(le('aiBankDeg', -10)), turned(90)), ['Halfway round. Keep the ball in the middle with right rudder.']),
            ms('rollout', all(ever(le('aiBankDeg', -10)), turned(150)), ['Coming round: roll the wings level, keep climbing.']),
          ],
          success: 'Good. Only 15 degrees in a climbing turn: more bank costs climb rate.',
          nudge: 'Hold 15 degrees of bank and the climb speed; adjust the nose for speed.',
        }),
        limits: limits({ bank: 30, pitchDown: HANDLING.pitchDown, minKias: 60, maxKias: 125 }) }),
      task({ id: 'glideTurn', exercise: 'turnsClimbDesc', brief: 'L05.glidingTurn',
        card: { title: 'Gliding turn right, 30°', targets: [ias(vs('Vglide')), { label: 'BANK', sig: 'aiBankDeg', value: 30, tol: 'bankMedium', unit: 'deg' }] },
        goal: all(gt('step.turnDeg', 165), wingsLevel), timeoutS: 150, onTimeout: 'next', coach: ['speed', 'bank', 'ball'],
        criteria: [
          hold('gtIas', 'Glide speed', 'asiKt', vs('Vglide'), 'speed', { settleS: 10, required: true,
            advice: { low: 'In a gliding turn the nose must come down to keep the speed: lower it as you roll in.' } }),
          hold('gtBank', 'Bank angle', 'aiBankDeg', 30, 'bankMedium', { settleS: 4, activeWhen: all(gt('step.turnDeg', 15), lt('step.turnDeg', 160)), required: true }),
        ],
        feedback: feedback({
          start: 'Go ahead: throttle closed, glide speed first, then roll right to 30 degrees.',
          milestones: [
            ms('banked', held(ge('aiBankDeg', 25), 2), ['Thirty degrees. Lower the nose a little more to keep the speed.']),
            ms('half', all(ever(ge('aiBankDeg', 25)), turned(90)), ['Halfway. The descent rate is higher in the turn; that is normal.']),
            ms('rollout', all(ever(ge('aiBankDeg', 25)), turned(150)), ['Roll out now, and raise the nose back to the glide attitude.']),
          ],
          success: 'Nicely done. In a gliding turn the nose goes down to hold the speed.',
          nudge: 'Nose down a touch to keep {vspeed.Vglide:kt}, and hold 30 degrees of bank.',
        }),
        limits: limits({ bank: 45, ...HANDLING, minKias: 55, maxKias: 110 }) }),
      say('powerOn', 'L05.powerBackOn', { wait: true }),
    ] },
    { id: 'assessed', title: 'Assessed turns', coachLevel: 'silent', retryFrom: areaStart(3500, 200, 100), steps: [
      backToArea('reposA', 3500, 200, 100),
      say('quiet', 'common.illStayQuiet', { wait: true }),
      capture('capAL', { a0: 'altFt', hdg0: 'hdgDeg' }),
      turn360Task({ id: 'a360L', exercise: 'assessedTurns', brief: 'L05.turn360Left', dir: 'left', bankDeg: 30, bankTol: 'bankMedium', kias: 100, altVar: 'a0', hdgVar: 'hdg0', coach: [],
        feedback: ASSESSED, limits: turnLimits(45, 'a0') }),
      capture('capAR', { a0: 'altFt', hdg0: 'hdgDeg' }),
      turn360Task({ id: 'a360R', exercise: 'assessedTurns', brief: 'L05.turn360Right', dir: 'right', bankDeg: 30, bankTol: 'bankMedium', kias: 100, altVar: 'a0', hdgVar: 'hdg0', coach: [],
        feedback: ASSESSED, limits: turnLimits(45, 'a0') }),
      end('fin', 'common.endDual'),
    ] },
  ],
  debriefTips: {
    'a360LAlt.biasLow': 'You lost height in the turn: more back pressure as the bank goes on, and release it on the roll-out.',
    'a360RAlt.biasLow': 'You lost height in the turn: more back pressure as the bank goes on, and release it on the roll-out.',
    'a360LBank.oscillation': 'The bank wandered: pick the attitude on the horizon, then hold it with small corrections.',
  },
  lookAhead: 'Next: slow flight, close to the stall, with full control.',
});

// =====================================================================================================
// L06 Slow flight
// =====================================================================================================

/**
 * Slow-flight limits: bank 30 (the gentle turns are 15), altitude +-400 ft, pitch +20/-15, and the stall speed of
 * the configuration (clean Vs1 + 2, full flap Vs0 + 3): below it the wing is stalling, not flying slowly.
 */
const slowLimits = (altVar: string, minKias: Ref) =>
  limits({ bank: 30, ...HANDLING, minKias, maxKias: 125, alt: { var: altVar, below: 400, above: 400 } });

export const L06: Lesson = tuneLessonCoach({
  id: 'L06', version: 1, number: 6, title: 'Slow flight',
  syllabusRef: { easa: 'Ex 10A', faa: 'ACS VII.A' },
  stage: 'handling', kind: 'dual', persona: 'instructor', requires: ['L05'], aircraft: 'any', estMinutes: 13,
  start: areaStart(4000, 200, 90), startOptions: { payload: 'forward', fuelFraction: 0.8 },
  weather: { preset: 'calm' },
  // The stall warning is coached in this lesson, not a safety breach (section 4.1).
  rules: dualRules({ coachLevel: 'reduced', maxDurationS: 1500, envelope: { ...UPPER_AIR, stallAllowed: true } }),
  briefing: {
    aim: 'To fly the aircraft at low speed with full control, clean and with full flap.',
    points: [
      'HASELL checks first: Height, Airframe, Security, Engine, Location, Lookout.',
      'At low speed the controls are less effective: bigger, slower movements.',
      'Power controls the altitude, attitude controls the speed.',
      'Keep the ball in the middle: at high power and low speed the aircraft yaws left.',
    ],
    numbers: [{ label: 'Slow flight', value: vs('Vslow'), unit: 'kt' }, { label: 'Stall, clean', value: vs('Vs1'), unit: 'kt' },
      { label: 'Stall, full flap', value: vs('Vs0'), unit: 'kt' }, { label: 'Flap limit, full', value: vs('VfeFull'), unit: 'kt' }],
    tolerances: ['slowFlightSpeed', 'altitude', 'heading'],
    airmanship: ['HASELL before every slow-flight or stall exercise.', 'Never let the stall warning sound continuously: lower the nose a touch, add power.'],
    keys: ['throttleUp', 'throttleDown', 'pitchUp', 'pitchDown', 'rudderLeft', 'rudderRight', 'flapsDown', 'flapsUp', 'trimNoseUp'],
    diagram: { kind: 'stall' },
    spoken: 'L06.brief',
  },
  exercises: [
    assessedEx('hasell', 'HASELL checks', 'checks', { standard: 'training', weight: 1, required: false }),
    demoEx('slowDemo', 'Demonstration: slow flight', 'slowFlight'),
    practiceEx('slowPractice', 'Slow flight, clean and full flap', 'slowFlight'),
    assessedEx('assessedSlow', 'Assessed: slow flight with gentle turns', 'slowFlight'),
  ],
  flow: [
    { id: 'demo', title: 'Checks and demonstration', steps: [
      say('intro', 'L06.demoIntro', { wait: true }),
      checklist('ckHasell', 'hasell', 'challengeResponse', { exercise: 'hasell' }),
      capture('cap0', { alt0: 'altFt', hdg0: 'hdgDeg' }),
      demo('demoSlow', 'slowFlight', { followMeThrough: true, highlight: ['asi', 'alt', 'ball'] }),
      say('demoWrap', 'L06.demoWrap', { wait: true }),
    ] },
    { id: 'practice', title: 'Your turn: slow flight', retryFrom: areaStart(4000, 200, 90), steps: [
      backToArea('repos', 4000, 200, 90),
      capture('capP', { a0: 'altFt', hdg0: 'hdgDeg' }),
      slowFlightTask({ id: 'pClean', exercise: 'slowPractice', brief: 'L06.clean', altVar: 'a0', hdgVar: 'hdg0', kias: vs('Vslow', 10), seconds: 90,
        feedback: slowFlightFeedback({ altVar: 'a0', kias: vs('Vslow', 10) }), limits: slowLimits('a0', vs('Vs1', 2)) }),
      slowFlightTask({ id: 'pFlap', exercise: 'slowPractice', brief: 'L06.fullFlap', altVar: 'a0', hdgVar: 'hdg0', seconds: 90, flapsDeg: 30,
        feedback: slowFlightFeedback({ altVar: 'a0', kias: vs('Vslow'), flapsDeg: 30 }), limits: slowLimits('a0', vs('Vs0', 3)) }),
      task({ id: 'pRecover', exercise: 'slowPractice', brief: 'L06.recover',
        card: { title: 'Full power, flap up in stages, cruise', targets: [alt(v('a0')), ias(vs('Vcruise'))] },
        goal: held(all(lt('flapsDeg', 1), gt('kias', 90)), 5), timeoutS: 120, onTimeout: 'next', coach: ['altitude', 'ball', 'flapLimit'],
        criteria: [hold('pRecAlt', 'Altitude in the clean-up', 'altFt', v('a0'), 'altitude', { settleS: 5, required: false })],
        feedback: feedback({
          start: 'Go ahead: full power, right rudder, then flap up in stages as the speed builds.',
          milestones: [
            ms('power', gt('throttle', 0.9), ['Full power. Hold the nose down a little; keep the height.']),
            ms('flap', all(ever(gt('throttle', 0.9)), lt('flapsDeg', 11)), ['Flap coming up. Keep accelerating, hold the height.']),
            ms('clean', all(ever(lt('flapsDeg', 11)), lt('flapsDeg', 1), gt('kias', 80)), ['Clean and accelerating. Cruise power when you reach cruise speed.']),
          ],
          success: 'Back at cruise. Nicely recovered from slow flight.',
          nudge: 'Full power, then flap up a stage at a time, holding the height.',
        }),
        limits: slowLimits('a0', vs('Vs0', 3)) }),
    ] },
    { id: 'assessed', title: 'Assessed slow flight', coachLevel: 'silent', retryFrom: areaStart(4000, 200, 90), steps: [
      backToArea('reposA', 4000, 200, 90),
      say('quiet', 'common.illStayQuiet', { wait: true }),
      capture('capA', { a1: 'altFt', hdg1: 'hdgDeg' }),
      slowFlightTask({ id: 'aSlow', exercise: 'assessedSlow', brief: 'L06.assessed', altVar: 'a1', hdgVar: 'hdg1', seconds: 60, flapsDeg: 30, coach: [],
        feedback: ASSESSED, limits: slowLimits('a1', vs('Vs0', 3)) }),
      slowFlightTask({ id: 'aTurnL', exercise: 'assessedSlow', brief: 'L06.gentleLeft', altVar: 'a1', seconds: 60, turnDir: 'left', coach: [],
        feedback: ASSESSED, limits: slowLimits('a1', vs('Vs0', 3)) }),
      slowFlightTask({ id: 'aTurnR', exercise: 'assessedSlow', brief: 'L06.gentleRight', altVar: 'a1', seconds: 60, turnDir: 'right', coach: [],
        feedback: ASSESSED, limits: slowLimits('a1', vs('Vs0', 3)) }),
      end('fin', 'common.endDual'),
    ] },
  ],
  debriefTips: {
    'aSlowIas.biasLow': 'You sat at the bottom of the band: a touch more power and the speed comes up a few knots.',
    'aSlowAlt.drift': 'At low speed power holds the altitude: small throttle changes and wait.',
  },
  lookAhead: 'Next: stalling. Recognising the stall and recovering at the warning and at the break.',
});

// =====================================================================================================
// L07 Stalling
// =====================================================================================================

/**
 * A clean or approach-configuration stall: the clearing turn, then the stall and its recovery (one task, see
 * stallTask). Approach-configuration stalls are always taken to the break (section 4.1 L07). `assessed`: the
 * clearing turn is a safety item and the instructor makes no recovery call.
 */
/**
 * Stall limits: a wing down beyond 40 deg or the nose below -20 deg for 2 s (the incipient spin and the
 * steep dive she will not let a first-time student explore), or 120 KIAS in the recovery. No low-speed limit:
 * the stall is the exercise; the envelope still guards the height.
 */
const STALL_LIMITS = limits({ bank: 40, pitchDown: -20, maxKias: 120, forS: 2 });

function stallSequence(o: { pre: string; exercise: string; at: 'warning' | 'break'; approach?: boolean; assessed?: boolean; talk?: boolean }) {
  const p = o.pre;
  // L07 talks the student through (o.talk); the skill test (L21) flies the same sequence in silence, no limits.
  const clearing = o.talk ? { feedback: o.assessed ? ASSESSED : clearingTurnFeedback({ degrees: 180 }), limits: limits({ bank: 45, ...HANDLING, minKias: 65, maxKias: 130 }) } : {};
  const stall = o.talk ? { feedback: o.assessed ? ASSESSED : stallFeedback({ at: o.at, approach: o.approach }), limits: STALL_LIMITS } : {};
  return [
    clearingTurnTask({ id: `${p}Clear`, exercise: o.exercise, brief: 'L07.clearingTurn', degrees: 180, safety: o.assessed, required: o.assessed === true, ...clearing }),
    capture(`${p}Cap`, { hdgS: 'hdgDeg' }),
    stallTask({ id: `${p}Stall`, exercise: o.exercise, at: o.at, approach: o.approach, hdgVar: 'hdgS', callRecovery: !o.assessed,
      brief: o.approach ? 'L07.entryApproachBreak' : o.at === 'warning' ? 'L07.entryCleanWarning' : 'L07.entryCleanBreak', ...stall }),
  ];
}

export const L07: Lesson = tuneLessonCoach({
  id: 'L07', version: 1, number: 7, title: 'Stalling',
  syllabusRef: { easa: 'Ex 10B', faa: 'ACS VII.B-C' },
  stage: 'handling', kind: 'dual', persona: 'instructor', requires: ['L06'], aircraft: 'any', estMinutes: 15,
  start: areaStart(4500, 200, 90), startOptions: { payload: 'forward', fuelFraction: 0.8 },
  weather: { preset: 'calm' },
  // Stalls allowed; the minimum height is 2,000 ft above the ground rather than 2,500 (section 4.1), because
  // at 4,500 ft over the 1,750 ft ground near the area a 300 ft practice height loss must not trigger the save.
  rules: dualRules({ coachLevel: 'reduced', maxDurationS: 1800, envelope: { stallAllowed: true, maxBankDeg: 60, minAglFt: 2000 } }),
  briefing: {
    aim: 'To recognise the approach to the stall and recover at the incipient stage and at the stall, clean and in the approach configuration.',
    points: [
      'HASELL, and a clearing turn of at least 180 degrees before every stall.',
      'Symptoms: high nose, low and falling speed, the stall warning, buffet, then the nose drops.',
      'Recovery: control column forward to unstall the wing, full power, wings level with rudder, then climb away.',
      'With flap, raise it in stages once the speed is above Vx.',
      'Spins are not flown here: if a wing drops, PARE (power idle, ailerons neutral, rudder opposite, elevator forward).',
    ],
    numbers: [{ label: 'Stall, clean', value: vs('Vs1'), unit: 'kt' }, { label: 'Stall, full flap', value: vs('Vs0'), unit: 'kt' },
      { label: 'Vx', value: vs('Vx'), unit: 'kt' }, { label: 'Vy', value: vs('Vy'), unit: 'kt' }, { label: 'Approach power', value: 1500, unit: 'rpm' }],
    tolerances: ['heading', 'stallHeightLossFt'],
    airmanship: ['Never stall below 2,000 ft above the ground.', 'A clearing turn before every stall: look below and behind as well.'],
    keys: ['pitchDown', 'throttleFull', 'rudderLeft', 'rudderRight', 'flapsUp', 'flapsDown', 'throttleIdle'],
    diagram: { kind: 'stall' },
    more: 'The wing stalls at a critical angle of attack, not a speed. The stall speed rises with weight, bank and load factor, which is why a steep turn can stall the aircraft at cruise speed.',
    spoken: 'L07.brief',
  },
  exercises: [
    assessedEx('hasell', 'HASELL checks', 'checks', { standard: 'training', weight: 1, required: false }),
    demoEx('stallDemo', 'Demonstration: power-off stall, clean', 'stalls'),
    practiceEx('stallIncipient', 'Recovery at the warning', 'stalls'),
    practiceEx('stallFull', 'Recovery at the break, clean and with flap', 'stalls'),
    assessedEx('assessedStalls', 'Assessed: two stalls', 'stalls'),
  ],
  flow: [
    { id: 'demo', title: 'Checks and demonstration', steps: [
      say('intro', 'L07.demoIntro', { wait: true }),
      checklist('ckHasell', 'hasell', 'challengeResponse', { exercise: 'hasell' }),
      demo('demoStall', 'powerOffStall', { followMeThrough: true, highlight: ['asi', 'ai'] }),
      say('demoWrap', 'L07.demoWrap', { wait: true }),
    ] },
    { id: 'incipient', title: 'Recover at the warning', retryFrom: areaStart(4500, 200, 90), steps: [
      backToArea('repos', 4500, 200, 90),
      ...stallSequence({ pre: 'pw', exercise: 'stallIncipient', at: 'warning', talk: true }),
    ] },
    { id: 'full', title: 'Recover at the break', retryFrom: areaStart(4500, 200, 90), steps: [
      backToArea('reposF', 4500, 200, 90),
      ...stallSequence({ pre: 'pb', exercise: 'stallFull', at: 'break', talk: true }),
      backToArea('reposG', 4500, 200, 90),
      ...stallSequence({ pre: 'pa', exercise: 'stallFull', at: 'break', approach: true, talk: true }),
    ] },
    { id: 'assessed', title: 'Assessed stalls', coachLevel: 'silent', retryFrom: areaStart(4500, 200, 90), steps: [
      backToArea('reposA', 4500, 200, 90),
      say('quiet', 'common.illStayQuiet', { wait: true }),
      ...stallSequence({ pre: 'a1', exercise: 'assessedStalls', at: 'break', assessed: true, talk: true }),
      backToArea('reposB', 4500, 200, 90),
      ...stallSequence({ pre: 'a2', exercise: 'assessedStalls', at: 'break', approach: true, assessed: true, talk: true }),
      end('fin', 'common.endDual'),
    ] },
  ],
  lookAhead: 'Next: stage 2, the circuit. We start with the take-off and climb.',
});

export const STAGE1: readonly Lesson[] = [L01, L02, L03, L04, L05, L06, L07];

/** Shared with the skill test (L21), which flies the same ground items and stalls. */
export const handlingPieces = { engineStartSteps, taxiToA1Task, runupSteps, stallSequence };
