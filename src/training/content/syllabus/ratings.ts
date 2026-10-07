// Ratings: N1 night circuits (section 4.1). Required before the skill test under FAA (14 CFR 61.109(a)(2));
// an optional rating under EASA. The lesson logs three night landings per run; the hub counts toward ten.
//
// The `night` endorsement ("when 10 night landings are logged with one competent N1") is a career rule, not
// a lesson award: Award has no landing-count condition, so it is left to the career module (module report).

import { all, binary, checklist, end, eq, gt, held, hold, leg, lt, say, setup, vs } from '../../engine/dsl';
import type { Lesson } from '../../types';
import { approachLandingTask, assessedEx, downwindTask, dualRules, HOLD_A1, LINEUP, takeoffTask } from './common';

/** Below 500 ft on final and still airborne: where the PAPI path is graded. */
const papiWindow = all(leg('final'), lt('hafFt', 500), gt('hafFt', 50));

export const N1: Lesson = {
  id: 'N1', version: 1, number: 22, title: 'Night circuits',
  syllabusRef: { easa: 'Night rating (FCL.810)', faa: '14 CFR 61.109(a)(2)' },
  stage: 'rating', kind: 'dual', persona: 'instructor', requires: ['L14'], requiredFor: ['faa'], aircraft: 'any', estMinutes: 30,
  start: HOLD_A1, startOptions: { payload: 'forward', fuelFraction: 0.8 },
  weather: { preset: 'night' },
  rules: dualRules({ coachLevel: 'reduced', maxDurationS: 3000 }),
  briefing: {
    aim: 'To fly circuits by night, with the lighting checks, and land on the PAPI path.',
    points: [
      'Lights: navigation lights, beacon and strobes on before moving; landing light on final.',
      'Let your eyes adapt: panel lights low, no white light in the cockpit.',
      'Fly the circuit on instruments as much as by the ground lights; the horizon is hard to see.',
      'On final, stay on the PAPI: two white, two red. Below 500 feet, do not go below the path.',
    ],
    numbers: [{ label: 'Circuit height', value: { setting: 'patternAglFt' }, unit: 'ft' }, { label: 'Vref', value: vs('Vref'), unit: 'kt' },
      { label: 'PAPI path', value: 3, unit: 'deg' }, { label: 'Night landings needed (FAA)', value: 10, unit: '' }],
    tolerances: ['glidepathFt', 'altitude', 'touchdownZoneFt', 'sinkFpm'],
    airmanship: ['A torch, and know where the panel light switch is.', 'At night a black hole approach looks high: trust the PAPI.'],
    keys: ['navLights', 'beacon', 'strobes', 'landingLight', 'taxiLight', 'panelLights'],
    diagram: { kind: 'circuit' },
    spoken: 'N1.brief',
  },
  exercises: [
    assessedEx('nightLights', 'Lighting checks', 'night', { standard: 'training', weight: 1 }),
    assessedEx('nightCircuits', 'Night circuits to a full stop', 'night'),
  ],
  flow: [
    { id: 'lights', title: 'Lighting checks', lowLevel: true, steps: [
      say('intro', 'N1.intro', { wait: true }),
      checklist('ckLights', 'nightLights', 'challengeResponse', { exercise: 'nightLights' }),
    ] },
    { id: 'circuits', title: 'Night circuits', lowLevel: true, repeat: { max: 3 }, retryFrom: LINEUP, steps: [
      setup('repos', { reposition: LINEUP, cue: 'N1.linedUp', pf: 'instructor' }),
      takeoffTask({ id: 'nTo', exercise: 'nightCircuits', standard: 'test', brief: 'N1.takeoff', required: false }),
      downwindTask({ id: 'nDown', exercise: 'nightCircuits', standard: 'test', brief: 'N1.downwind' }),
      approachLandingTask({ id: 'nLdg', exercise: 'nightCircuits', standard: 'test', brief: 'N1.final', slope: 'none',
        extra: [
          hold('nPapi', 'PAPI path below 500 ft', 'gpDevFt', 0, 75, { settleS: 2, activeWhen: papiWindow, required: true,
            advice: { low: 'Low on the PAPI at night is the classic accident: three or four reds, add power now.' } }),
          binary('nLandingLight', 'Landing light on final', held(all(papiWindow, eq('lightLanding', false)), 3), { required: true }),
        ] }),
    ] },
    { id: 'end', title: 'Debrief', steps: [end('fin', 'common.endDual')] },
  ],
  debriefTips: {
    'nPapi.biasLow': 'You were low on the path: at night the runway looks further away than it is. Trust the PAPI.',
  },
  lookAhead: 'Ten night landings in all complete the night requirement; each run of this lesson logs three.',
};

export const RATINGS: readonly Lesson[] = [N1];
