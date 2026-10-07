// Challenges (section 4.3): spot landing, dead-stick, crosswind master, precision circuit. Each is a
// one-exercise lesson flown alone (kind 'solo': no instructor saves, no coaching) and scored 0-100 by the
// career module (career/challenges.ts scoreChallenge) from the landing and the hold criteria. Challenges never
// affect lesson competency; lesson ids start with 'C' and the lessons are not part of SYLLABUS.

import { all, binary, end, eq, ev, gt, hold, say, setup, vs } from '../../engine/dsl';
import type { ChallengeDef, Lesson, StartSpec } from '../../types';
import {
  approachLandingTask, assessedEx, centreline, finalStart, ias, landingCriteria, LINEUP, soloRules, task,
} from './common';
import { circuitPieces } from './stage2';

const FINAL3 = finalStart(3, 20, undefined, 75);
/** 3 NM east of the field, 3,000 ft above it, heading west: the dead-stick start. */
const DEAD_STICK_START: StartSpec = { kind: 'air', at: { north: 0, east: 5556 }, altFt: 3000, altRef: 'field', hdgDeg: 270, kias: vs('Vglide') };

/** The shared shape of a challenge lesson: stage, kind, solo rules, a one-line briefing. */
function challengeLesson(o: Pick<Lesson, 'id' | 'title' | 'start' | 'weather' | 'exercises' | 'flow' | 'estMinutes'> & { stage: Lesson['stage']; aim: string; points: string[]; spoken: string }): Lesson {
  return {
    id: o.id, version: 1, number: 0, title: o.title,
    syllabusRef: { easa: 'Challenge', faa: 'Challenge' },
    stage: o.stage, kind: 'solo', persona: 'instructor', requires: [], aircraft: 'any', estMinutes: o.estMinutes,
    start: o.start, startOptions: { payload: 'forward', fuelFraction: 0.6 },
    weather: o.weather,
    rules: soloRules({ maxDurationS: 1500 }),
    briefing: {
      aim: o.aim, points: o.points,
      numbers: [{ label: 'Vref', value: vs('Vref'), unit: 'kt' }, { label: 'Best glide', value: vs('Vglide'), unit: 'kt' }],
      tolerances: ['touchdownZoneFt', 'sinkFpm'],
      airmanship: ['A challenge is still flying: go around if it is not working.'],
      keys: ['throttleUp', 'throttleDown', 'flapsDown', 'pitchUp'],
      diagram: { kind: 'landingZone' },
      spoken: o.spoken,
    },
    exercises: o.exercises,
    flow: o.flow,
  };
}

const spotLanding: ChallengeDef = {
  id: 'spotLanding', title: 'Spot landing', unlockedBy: 'L09', scoring: 'spotLanding',
  description: 'Land on the aim point from a 3 NM final. Every foot off the spot and every heavy arrival costs points.',
  lesson: challengeLesson({
    id: 'C01', title: 'Challenge: spot landing', stage: 'circuits', estMinutes: 4, start: FINAL3, weather: { preset: 'light' },
    aim: 'Touch down exactly on the aim point, gently.', spoken: 'C.spotBrief',
    points: ['Score: 100 minus a point for every 4 ft from the aim point.', 'Sink above 300 fpm costs points; nose first or off the runway scores nothing.',
      'A stabilised approach is still the way to a precise touchdown.'],
    exercises: [assessedEx('spot', 'Spot landing', 'landing', { required: false })],
    flow: [{ id: 'fly', title: 'Spot landing', lowLevel: true, checkpoint: false, steps: [
      say('go', 'C.go', { wait: true }),
      approachLandingTask({ id: 'spot', exercise: 'spot', standard: 'test', brief: 'C.spotLand', student: true, coach: [], required: false }),
      end('fin', 'C.done'),
    ] }],
  }),
};

const deadStick: ChallengeDef = {
  id: 'deadStick', title: 'Dead-stick', unlockedBy: 'L16', scoring: 'deadStick',
  description: 'The engine is stopped 3 NM east of the field at 3,000 ft. Glide to the runway and land in the touchdown zone.',
  lesson: challengeLesson({
    id: 'C02', title: 'Challenge: dead-stick landing', stage: 'advanced', estMinutes: 6, start: DEAD_STICK_START, weather: { preset: 'light' },
    aim: 'Glide to a landing on runway 07 with the engine stopped.', spoken: 'C.deadStickBrief',
    points: ['Touchdown zone 40 points, glide speed 30, no stall warning 15, sink rate 15.', 'The mixture stays at cut-off: no restart.',
      'Glide speed first, then the plan: 3 NM and 3,000 ft leave room for a pattern.'],
    exercises: [assessedEx('deadStick', 'Dead-stick landing', 'forcedLanding', { required: false })],
    flow: [{ id: 'fly', title: 'Dead-stick', lowLevel: true, checkpoint: false, steps: [
      setup('engineStopped', { holds: { mixture: 0 }, cue: 'C.engineStopped' }),
      task({ id: 'ds', exercise: 'deadStick', pf: 'student', brief: 'C.deadStickGo',
        card: { title: 'Dead-stick: land on 07', targets: [ias(vs('Vglide'), { minus: 5, plus: 10 }), centreline(60)] },
        goal: all(ev('landing'), ev('stopped')), timeoutS: 900, onTimeout: 'fail', coach: [],
        criteria: [
          hold('dsGlide', 'Glide speed', 'asiKt', vs('Vglide'), { minus: 5, plus: 10 }, { settleS: 10, activeWhen: gt('hafFt', 200), required: false }),
          binary('dsWarn', 'No stall warning', all(eq('stallWarn', true), gt('aglFt', 5)), { required: false }),
          ...landingCriteria({ prefix: 'ds', standard: 'test', vref: vs('Vglide'), required: false }),
        ] }),
      end('fin', 'C.done'),
    ] }],
  }),
};

const crosswindMaster: ChallengeDef = {
  id: 'crosswindMaster', title: 'Crosswind master', unlockedBy: 'L17', scoring: 'crosswindMaster',
  description: 'A gusty 13 kt crosswind from the right, gusting 23. Land on the centreline, straight, gently and in the zone.',
  lesson: challengeLesson({
    id: 'C03', title: 'Challenge: crosswind master', stage: 'advanced', estMinutes: 4, start: FINAL3,
    weather: { preset: 'xwind15', override: { gustKt: 23 } },
    aim: 'Land in a strong, gusty crosswind.', spoken: 'C.crosswindBrief',
    points: ['Centreline 30 points, drift at touchdown 30, sink rate 20, touchdown zone 20.', 'Add half the gust factor to the approach speed.',
      'Crab on final, then rudder straight and the into-wind wing down for the touchdown.'],
    exercises: [assessedEx('xwMaster', 'Crosswind landing', 'crosswind', { required: false })],
    flow: [{ id: 'fly', title: 'Crosswind landing', lowLevel: true, checkpoint: false, steps: [
      say('go', 'C.go', { wait: true }),
      approachLandingTask({ id: 'xm', exercise: 'xwMaster', standard: 'test', brief: 'C.crosswindLand', student: true, coach: [], required: false }),
      end('fin', 'C.done'),
    ] }],
  }),
};

const precisionCircuit: ChallengeDef = {
  id: 'precisionCircuit', title: 'Precision circuit', unlockedBy: 'L10', scoring: 'precisionCircuit',
  description: 'One circuit from the line-up to a full stop, graded on every target: height, spacing, speeds and the slope.',
  lesson: challengeLesson({
    id: 'C04', title: 'Challenge: precision circuit', stage: 'circuits', estMinutes: 8, start: LINEUP, weather: { preset: 'light' },
    aim: 'Fly the most accurate circuit you can.', spoken: 'C.circuitBrief',
    points: ['Score: 100 times one minus half the mean normalised error over the circuit targets.', 'Every target counts: climb speed, height, spacing, approach speed, slope.',
      'Trim at every change: a trimmed aircraft holds its numbers.'],
    exercises: [assessedEx('precision', 'Precision circuit', 'circuit', { required: false })],
    flow: [{ id: 'fly', title: 'Precision circuit', lowLevel: true, checkpoint: false, steps: [
      say('go', 'C.go', { wait: true }),
      ...circuitPieces.circuit({ pre: 'pc', exercise: 'precision', standard: 'test', checks: 'silent', quiet: true, first: true }),
      end('fin', 'C.done'),
    ] }],
  }),
};

export const CHALLENGES: readonly ChallengeDef[] = [spotLanding, deadStick, crosswindMaster, precisionCircuit];

