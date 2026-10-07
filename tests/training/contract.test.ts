// Wave-0 contract tests: the spec's worked example (section 2.12, L04 and its demo script) must type-check
// against src/training/types.ts and the DSL exactly as written in the spec; the DSL must produce the plain
// objects of the contract; the barrel must import in node; the tolerance table must match section 2.2.

import { describe, expect, it } from 'vitest';
import type { DemoScript, Lesson, Pred, TaskStep } from '../../src/training/types';
import { Priority } from '../../src/training/types';
import {
  all, capture, check, demo, end, ev, final, ge, gt, handover, held, hold, lt, near, peak, say, std, task, v, vs,
} from '../../src/training/engine/dsl';
import * as training from '../../src/training';
import { STANDARDS } from '../../src/training/grading/standards';
import { baseScenario } from '../../src/sim/starts';
import { pendingValue } from '../../src/training/stub';

// ---- Section 2.12, verbatim apart from the imports ------------------------------------------------------

const climbTo = (tgtVar: string) => task({
  id: 'climb', exercise: 'climbPractice', pf: 'student',
  brief: { id: 'L04.climbTo', vars: { alt: v(tgtVar) } },
  card: { title: 'Climb at Vy, level off', targets: [
    { label: 'IAS', sig: 'asiKt', value: vs('Vy'), tol: 'speedClimbApproach', unit: 'kt' },
    { label: 'ALT', sig: 'altFt', value: v(tgtVar), tol: 'altitude', unit: 'ft' },
    { label: 'HDG', sig: 'hdgDeg', value: v('hdg0'), tol: 'heading', unit: 'deg' } ] },
  goal: held(near('altFt', v(tgtVar), 60), 10),
  timeoutS: 240, onTimeout: { demo: 'climbLevelOff', thenRetry: true },
  coach: ['speed', 'heading', 'ball', 'trim', 'levelOff'],
  criteria: [
    hold('climbIas', 'Climb speed', 'asiKt', vs('Vy'), 'speedClimbApproach',
         { settleS: 12, activeWhen: lt('altFt', v(tgtVar, -150)), required: true,
           advice: { high: 'Raise the nose a little: in the climb, speed is controlled with attitude.',
                     low: 'Lower the nose: at full power a low speed means too much attitude.' } }),
    hold('climbHdg', 'Heading', 'hdgDeg', v('hdg0'), 'heading', { settleS: 8, required: true }),
    peak('levelOff', 'Level-off overshoot', 'altFt', v(tgtVar), 'altitude', { peakOf: 'max', required: true,
         advice: { high: 'Start levelling at 10 % of the climb rate: about 50 ft early at 500 fpm.' } }),
    final('levelAlt', 'Altitude after level-off', 'altFt', v(tgtVar), 'altitude', { required: true }),
  ],
});

const L04: Lesson = {
  id: 'L04', version: 1, number: 4, title: 'Climbing and descending',
  syllabusRef: { easa: 'Ex 7 & 8', faa: 'ACS VI.B-C (basic attitude: climbs, descents)' },
  stage: 'handling', kind: 'dual', persona: 'instructor', requires: ['L03'], aircraft: 'any', estMinutes: 12,
  start: { kind: 'air', at: 'trainingArea', altFt: 2500, altRef: 'msl', hdgDeg: 100, kias: vs('Vcruise') },
  startOptions: { payload: 'forward', fuelFraction: 0.8 },
  weather: { preset: 'smooth' },
  rules: { coachLevel: 'full', autopilot: 'forbidden', maxTimeScale: 1, instructorSaves: true, maxDurationS: 1500 },
  briefing: {
    aim: 'To climb and descend at a chosen speed and rate, and level off at a chosen altitude.',
    points: ['Every change is Attitude, then Power, then Trim (APT); level-off is Attitude, Power, Trim too.',
             'Climb at Vy with full power; the speed is held with attitude.',
             'Begin the level-off at 10 % of the vertical speed: 50 ft early at 500 fpm.',
             'Descents: glide at best glide speed with idle power, or 500 fpm at 90 kt with reduced power.'],
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
    { id: 'climbDemo', title: 'Demonstration: climb and level-off', skill: 'climb', mode: 'demo', standard: 'training', required: false, weight: 0 },
    { id: 'climbPractice', title: 'Climb at Vy and level off', skill: 'climb', mode: 'practice', standard: 'training', required: false, weight: 1 },
    { id: 'descentPractice', title: 'Glide and powered descents', skill: 'descent', mode: 'practice', standard: 'training', required: false, weight: 1 },
    { id: 'assessedClimb', title: 'Assessed: climb and level-off', skill: 'climb', mode: 'assessed', standard: 'test', required: true, weight: 2 },
    { id: 'assessedDescent', title: 'Assessed: 500 fpm descent and level-off', skill: 'descent', mode: 'assessed', standard: 'test', required: true, weight: 2 },
  ],
  flow: [
    { id: 'demo', title: 'Demonstration', steps: [
      say('intro', 'L04.demoIntro', { wait: true }),
      capture('cap0', { alt0: 'altFt', hdg0: 'hdgDeg' }),
      demo('demoClimb', 'climbLevelOff', { followMeThrough: true, highlight: ['ai', 'asi', 'vsi'] }),
      say('demoWrap', 'L04.demoWrap', { wait: true }),
    ] },
    { id: 'practiceClimb', title: 'Your climb', repeat: { max: 2, until: { exerciseGrade: 'climbPractice', atLeast: 2 } }, steps: [
      handover('toStudent', 'student'),
      capture('capC', { hdg0: 'hdgDeg', a0: 'altFt' }),
      { kind: 'capture', id: 'tgtC', vars: { tgt: v('a0', 1000) } },
      climbTo('tgt'),
      say('climbDone', 'common.goodNowCruise'),
      task({ id: 'settle', exercise: 'climbPractice', brief: 'L04.settleCruise',
             card: { title: 'Cruise: 2,300 rpm, trimmed', targets: [{ label: 'RPM', sig: 'rpm', value: { setting: 'cruiseRpm' }, tol: 100, unit: 'rpm' }] },
             goal: held(all(near('rpm', { setting: 'cruiseRpm' }, 100), lt('untrimmedS', 1)), 5), timeoutS: 60, onTimeout: 'next',
             coach: ['trim'], criteria: [check('trimmed', 'Trimmed after level-off', { pred: held(lt('untrimmedS', 1), 5), required: false })] }),
    ] },
    { id: 'practiceDescent', title: 'Descents', steps: [
      capture('capD', { a1: 'altFt', hdg0: 'hdgDeg' }),
      { kind: 'capture', id: 'tgtD', vars: { glideTo: v('a1', -500), descTo: v('a1', -1000) } },
      task({ id: 'glide', exercise: 'descentPractice', pf: 'student',
             brief: { id: 'L04.glideTo', vars: { alt: v('glideTo') } },
             card: { title: 'Glide at best glide speed', targets: [
               { label: 'IAS', sig: 'asiKt', value: vs('Vglide'), tol: 'speed', unit: 'kt' },
               { label: 'ALT', sig: 'altFt', value: v('glideTo'), tol: 'altitude', unit: 'ft' } ] },
             goal: held(near('altFt', v('glideTo'), 60), 8), timeoutS: 180, onTimeout: 'next',
             coach: ['speed', 'ball', 'levelOff'],
             criteria: [hold('glideIas', 'Glide speed', 'asiKt', vs('Vglide'), 'speed', { settleS: 10, activeWhen: gt('altFt', v('glideTo', 150)), required: true }),
                        peak('glideLevel', 'Level-off', 'altFt', v('glideTo'), 'altitude', { peakOf: 'min', required: true })] }),
      task({ id: 'powered', exercise: 'descentPractice',
             brief: { id: 'L04.descend500', vars: { alt: v('descTo') } },
             card: { title: '500 fpm at 90 kt', targets: [
               { label: 'IAS', sig: 'asiKt', value: vs('Vdescent'), tol: 'speed', unit: 'kt' },
               { label: 'VS', sig: 'vsiFpm', value: -500, tol: 'vs', unit: 'fpm' },
               { label: 'ALT', sig: 'altFt', value: v('descTo'), tol: 'altitude', unit: 'ft' } ] },
             goal: held(near('altFt', v('descTo'), 60), 10), timeoutS: 200, onTimeout: 'next',
             coach: ['speed', 'vs', 'ball', 'trim', 'levelOff'],
             criteria: [hold('descIas', 'Descent speed', 'asiKt', vs('Vdescent'), 'speed', { settleS: 12, activeWhen: gt('altFt', v('descTo', 150)), required: true }),
                        hold('descVs', 'Descent rate', 'vsiFpm', -500, 'vs', { settleS: 15, activeWhen: gt('altFt', v('descTo', 150)), required: true }),
                        peak('descLevel', 'Level-off', 'altFt', v('descTo'), 'altitude', { peakOf: 'min', required: true })] }),
    ] },
    { id: 'assessed', title: 'Assessed climb and descent', coachLevel: 'silent', steps: [
      say('quiet', 'common.illStayQuiet', { wait: true }),
      capture('capA', { a2: 'altFt', hdg0: 'hdgDeg' }),
      { kind: 'capture', id: 'tgtA', vars: { up: v('a2', 1000) } },
      { ...climbTo('up'), id: 'aClimb', exercise: 'assessedClimb', coach: [] },
      { kind: 'capture', id: 'tgtB', vars: { down: v('up', -1000) } },
      task({ id: 'aDescent', exercise: 'assessedDescent',
             brief: { id: 'L04.descend500', vars: { alt: v('down') } },
             card: { title: '500 fpm at 90 kt, level off', targets: [
               { label: 'IAS', sig: 'asiKt', value: vs('Vdescent'), tol: 'speed', unit: 'kt' },
               { label: 'VS', sig: 'vsiFpm', value: -500, tol: 'vs', unit: 'fpm' },
               { label: 'ALT', sig: 'altFt', value: v('down'), tol: 'altitude', unit: 'ft' },
               { label: 'HDG', sig: 'hdgDeg', value: v('hdg0'), tol: 'heading', unit: 'deg' } ] },
             goal: held(near('altFt', v('down'), 60), 10), timeoutS: 200, onTimeout: 'fail',
             criteria: [hold('aDescIas', 'Descent speed', 'asiKt', vs('Vdescent'), 'speed', { settleS: 12, activeWhen: gt('altFt', v('down', 150)), required: true }),
                        hold('aDescVs', 'Descent rate', 'vsiFpm', -500, 'vs', { settleS: 15, activeWhen: gt('altFt', v('down', 150)), required: true }),
                        hold('aDescHdg', 'Heading', 'hdgDeg', v('hdg0'), 'heading', { required: true }),
                        peak('aDescLevel', 'Level-off', 'altFt', v('down'), 'altitude', { peakOf: 'min', required: true }),
                        final('aDescAlt', 'Altitude after level-off', 'altFt', v('down'), 'altitude', { required: true }),
                        hold('aBall', 'Balance', 'ball', 0, 0.5, { required: false })] }),
      end('fin', 'L04.wrap'),
    ] },
  ],
  debriefTips: {
    'levelOff.late': 'Anticipate: at 500 fpm start levelling 50 ft before the target.',
    'climbIas.oscillation': 'You were chasing the airspeed. Set the attitude, hold it, wait five seconds, then adjust.',
    'aDescVs.biasHigh': 'The descent was shallow: a little less power, and keep 90 kt with the attitude.',
  },
};

const climbLevelOff: DemoScript = { id: 'climbLevelOff', segments: [
  { kind: 'ap', say: 'L04.demoClimbEntry', ap: { lateral: 'heading', hdgDeg: v('hdg0'), vertical: 'airspeed', kias: vs('Vy'), autoTrim: true },
    set: { throttle: { to: 1, overS: 2 } }, until: all(gt('vsFpm', 400), held(near('kias', vs('Vy'), 4), 5)), timeoutS: 40 },
  { kind: 'ap', say: 'L04.demoLeadLevelOff', ap: {}, until: ge('altFt', v('alt0', 950)), timeoutS: 150 },
  { kind: 'ap', say: 'L04.demoApt', ap: { vertical: 'altitude', altFt: v('alt0', 1000) }, set: { throttle: { to: 0.72, overS: 4 } },
    until: held(near('vsFpm', 0, 100), 8), timeoutS: 40 },
], abortWhen: lt('aglFt', 1500) };

// ---------------------------------------------------------------------------------------------------------

describe('training contract (wave 0)', () => {
  it('accepts the section 2.12 worked example as plain JSON data', () => {
    // A lesson must survive a JSON round trip unchanged (validation, resume and export rely on it).
    expect(JSON.parse(JSON.stringify(L04))).toEqual(L04);
    expect(JSON.parse(JSON.stringify(climbLevelOff))).toEqual(climbLevelOff);
    const assessed = L04.flow.find((p) => p.id === 'assessed')!;
    const aClimb = assessed.steps.find((s) => s.id === 'aClimb') as TaskStep;
    expect(aClimb.kind).toBe('task');
    expect(aClimb.exercise).toBe('assessedClimb');
    expect(aClimb.coach).toEqual([]);
  });

  it('DSL builders produce the literal contract objects', () => {
    expect(v('a0', 1000)).toEqual({ var: 'a0', add: 1000 });
    expect(v('a0')).toEqual({ var: 'a0' });
    expect(vs('Vy')).toEqual({ vspeed: 'Vy' });
    expect(std('altitude')).toBe('altitude');
    expect(std('altitude', 0.5)).toEqual({ key: 'altitude', scale: 0.5 });
    const p: Pred = held(near('altFt', v('t'), 60), 10);
    expect(p).toEqual({ held: { sig: 'altFt', near: { var: 't' }, tol: 60 }, s: 10 });
    expect(ev('touchdown', { wheel: 'nose' })).toEqual({ event: 'touchdown', where: { wheel: 'nose' } });
    expect(say('a', 'x.y', { wait: true })).toEqual({ id: 'a', kind: 'say', cue: 'x.y', wait: true });
    expect(end('fin')).toEqual({ id: 'fin', kind: 'end' });
    expect(hold('c', 'C', 'asiKt', 74, 'speed', { required: true })).toEqual({
      id: 'c', label: 'C', kind: 'hold', sig: 'asiKt', target: 74, tol: 'speed', required: true,
    });
  });

  it('the barrel imports in node and Priority is a runtime enum', () => {
    expect(typeof training.LessonRunner).toBe('function');
    expect(typeof training.dsl.task).toBe('function');
    expect(Priority.Safety).toBe(0);
    expect(Priority.Praise).toBe(3);
  });

  it('tolerance table matches section 2.2 spot values', () => {
    expect(STANDARDS.easa.test.altitude).toEqual({ minus: 150, plus: 150 });
    expect(STANDARDS.faa.test.altitude).toEqual({ minus: 100, plus: 100 });
    expect(STANDARDS.easa.test.bankSteep).toEqual({ minus: 10, plus: 10 });
    expect(STANDARDS.faa.test.bankSteep).toEqual({ minus: 5, plus: 5 });
    expect(STANDARDS.faa.training.speedClimbApproach).toEqual({ minus: 5, plus: 15 });
    expect(STANDARDS.easa.commercial.speedClimbApproach).toEqual({ minus: 0, plus: 5 });
    expect(STANDARDS.faa.test.navHeading).toEqual({ minus: 15, plus: 15 });
    expect(STANDARDS.easa.training.sinkFpm).toEqual({ minus: 0, plus: 500 });
    for (const a of ['easa', 'faa'] as const)
      for (const s of ['training', 'test', 'commercial'] as const) expect(Object.keys(STANDARDS[a][s])).toHaveLength(24);
  });

  it('baseScenario maps every start kind onto an existing scenario', () => {
    expect(baseScenario({ kind: 'ground', spot: 'parking', engine: 'cold' })).toBe('apron');
    expect(baseScenario({ kind: 'ground', spot: 'holdA1', engine: 'running' })).toBe('apron');
    expect(baseScenario({ kind: 'ground', spot: 'lineup07', engine: 'running' })).toBe('runway');
    expect(baseScenario(L04.start)).toBe('cruise');
    expect(baseScenario({ kind: 'attitude', at: 'trainingArea', altFt: 4000, kias: 60, pitchDeg: 25, bankDeg: 30, hdgDeg: 0 })).toBe('cruise');
    expect(baseScenario({ kind: 'final', distNm: 3, kias: 70, flapsDeg: 20 })).toBe('final');
    expect(baseScenario({ kind: 'circuit', leg: 'downwind', position: 'abeamMid', kias: 90 })).toBe('downwind');
    expect(baseScenario({ kind: 'scenario', id: 'final' })).toBe('final');
  });

  it('wave-0 placeholders throw on use, never pass silently', () => {
    const t = pendingValue<{ x: number }>('T');
    expect(() => t.x).toThrow(/not implemented/);
  });
});
