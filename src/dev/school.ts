// Flight School UI dev page: every school screen over the mock scene, driven by fixture models (no lesson
// engine needed), for screenshots at 1280x720 and 1600x900 (scripts/shot.mjs).
//
// URL parameters:
//   screen=welcome | home | syllabus | challenges | briefing | debrief | ceremony | logbook | licence | settings
//          | flight | card | hood | blackout | menu | menu-free | crash          (default home)
//   lesson=L04 | L10 | L20      briefing / debrief fixture (L10: circuit trace with the ground track;
//                               L20: route briefing with the nav log)
//   fresh=1                     a brand-new profile (one lesson available, empty logbook)
//   late=1                      a career past the first solo (stage 3, challenges and endorsements)
//   voices=0                    no speech voices installed
//   page=0                      logbook page (default: the latest)
//   select=climbIas             debrief: select a criterion row (band and worst point highlighted)
//   cursor=200                  debrief: scrub the graph to this trace time (s)
//   flown=c152                  home: flying another type than the school's (D5 banner with the offer to change)
// window.__school is the SchoolUi, window.__ui the UISystem; school commands are logged to the console and
// collected in window.__commands.

import * as THREE from 'three';
import { aircraftSummary, isAircraftId } from '../aircraft/registry';
import { KEY_BINDINGS } from '../input';
import { PANEL_HEIGHT, PANEL_WIDTH, PANEL_LAYOUT } from '../instruments/layout';
import { STANDARDS } from '../training/grading/standards';
import type {
  AuthorityId, BriefingModel, Caption, CardModel, CareerTotals, ChallengeDef, Criterion, CriterionResult, DebriefModel, ExerciseResult,
  Grade, Lesson, LessonProgress, LessonResult, LessonStripModel, LogbookEntry, Ref, SignalId, TolKey, TraceBand, TraceChannel, TraceData,
  TrainingSave,
} from '../training/types';
import { UISystem } from '../ui';
import type { SchoolCareer, SchoolProgressFns } from '../ui/school/models';
import { fromRunway } from '../ui/school/trackMap';
import { SchoolUi } from '../ui/school/schoolUi';
import { runHarness } from './harness';
import { MockFlight } from './instrumentsFlight';

const params = new URLSearchParams(location.search);
const screen = params.get('screen') ?? 'home';
const lessonParam = params.get('lesson') ?? 'L04';
const fresh = params.get('fresh') === '1';
const late = params.get('late') === '1';
const AUTH: AuthorityId = 'easa';
const NOW = new Date('2026-10-01T10:00:00Z');

// ---- Syllabus fixture --------------------------------------------------------------------------------------

type LessonSeed = [id: string, n: number, title: string, easa: string, faa: string, stage: Lesson['stage'], kind: Lesson['kind'], min: number, requires: string[]];

const SEEDS: LessonSeed[] = [
  ['L01', 1, 'Effects of controls', 'Ex 3-4', 'ACS I', 'handling', 'dual', 10, []],
  ['L02', 2, 'Start, taxi and power checks', 'Ex 2, 5', 'ACS II.C-F', 'handling', 'dual', 14, ['L01']],
  ['L03', 3, 'Straight and level', 'Ex 6', 'ACS VI.A', 'handling', 'dual', 12, ['L02']],
  ['L04', 4, 'Climbing and descending', 'Ex 7 & 8', 'ACS VI.B-C', 'handling', 'dual', 12, ['L03']],
  ['L05', 5, 'Medium turns', 'Ex 9', 'ACS VI.D', 'handling', 'dual', 12, ['L04']],
  ['L06', 6, 'Slow flight', 'Ex 10A', 'ACS VII.A', 'handling', 'dual', 11, ['L05']],
  ['L07', 7, 'Stalling', 'Ex 10B', 'ACS VII.B-C', 'handling', 'dual', 14, ['L06']],
  ['L08', 8, 'Take-off and climb', 'Ex 12', 'ACS IV.A', 'circuits', 'dual', 10, ['L07']],
  ['L09', 9, 'Approach and landing', 'Ex 13', 'ACS IV.B', 'circuits', 'dual', 13, ['L08']],
  ['L10', 10, 'The circuit', 'Ex 13', 'ACS III.B', 'circuits', 'dual', 15, ['L09']],
  ['L11', 11, 'Go-arounds, flapless and glide approaches', 'Ex 13', 'ACS IV.B, IV.N', 'circuits', 'dual', 15, ['L10']],
  ['L12', 12, 'Circuit emergencies', 'Ex 12E, 13E', 'ACS IX.B', 'circuits', 'dual', 14, ['L11']],
  ['L13', 13, 'Pre-solo progress check', 'Ex 14 prep', 'Pre-solo check', 'circuits', 'check', 15, ['L12']],
  ['L14', 14, 'First solo', 'Ex 14', 'Solo', 'circuits', 'solo', 8, ['L13']],
  ['L15', 15, 'Steep turns and spiral dives', 'Ex 15', 'ACS V.A', 'advanced', 'dual', 12, ['L14']],
  ['L16', 16, 'Forced landing without power', 'Ex 16', 'ACS IX.B', 'advanced', 'dual', 15, ['L14']],
  ['L17', 17, 'Crosswind circuits', 'Ex 13', 'ACS IV.C-D', 'advanced', 'dual', 15, ['L14']],
  ['L18', 18, 'Short-field take-off and landing', 'Ex 13', 'ACS IV.E-F', 'advanced', 'dual', 12, ['L14']],
  ['L19', 19, 'Instruments and unusual attitudes', 'Ex 19', 'ACS VIII', 'advanced', 'dual', 14, ['L14']],
  ['L20', 20, 'Navigation', 'Ex 18', 'ACS VI.A', 'navigation', 'dual', 40, ['L15', 'L16', 'L17', 'L18', 'L19']],
  ['L21', 21, 'PPL skill test', 'Skill test 1-5', 'ACS', 'test', 'test', 60, ['L20']],
  ['N1', 22, 'Night circuits', 'Night rating', '61.109(a)(2)', 'rating', 'dual', 20, ['L14']],
];

const v = (name: string, add?: number) => ({ var: name, ...(add !== undefined ? { add } : {}) });

function baseLesson(s: LessonSeed): Lesson {
  const [id, number, title, easa, faa, stage, kind, estMinutes, requires] = s;
  return {
    id, version: 1, number, title, syllabusRef: { easa, faa }, stage, kind, persona: kind === 'test' ? 'examiner' : 'instructor',
    requires, aircraft: 'any', estMinutes,
    start: stage === 'handling' ? { kind: 'air', at: 'trainingArea', altFt: 3500, altRef: 'msl', hdgDeg: 100, kias: 100 } : { kind: 'ground', spot: 'lineup07', engine: 'running' },
    weather: { preset: 'smooth' },
    rules: { coachLevel: 'full', autopilot: 'forbidden', maxTimeScale: 1, instructorSaves: kind === 'dual', maxDurationS: 1500 },
    briefing: { aim: title, points: [], numbers: [], tolerances: [], airmanship: [], keys: [], spoken: `${id}.brief` },
    exercises: [], flow: [],
  };
}

const crit = (id: string, label: string, kind: Criterion['kind'], sig: SignalId, target: Ref, tol: TolKey): Criterion =>
  ({ id, label, kind, sig, target, tol, required: true });

/** L04 as in the spec's worked example (section 2.12), trimmed to what the screens read. */
function l04(): Lesson {
  const l = baseLesson(SEEDS[3]);
  l.start = { kind: 'air', at: 'trainingArea', altFt: 2500, altRef: 'msl', hdgDeg: 100, kias: { vspeed: 'Vcruise' } };
  l.briefing = {
    aim: 'To climb and descend at a chosen speed and rate, and level off at a chosen altitude.',
    points: [
      'Every change is Attitude, then Power, then Trim (APT); level-off is Attitude, Power, Trim too.',
      'Climb at Vy with full power; the speed is held with attitude.',
      'Begin the level-off at 10 % of the vertical speed: 50 ft early at 500 fpm.',
      'Descents: glide at best glide speed with idle power, or 500 fpm at 90 kt with reduced power.',
    ],
    numbers: [
      { label: 'Vy', value: { vspeed: 'Vy' }, unit: 'kt' }, { label: 'Cruise climb', value: { vspeed: 'Vcc' }, unit: 'kt' },
      { label: 'Best glide', value: { vspeed: 'Vglide' }, unit: 'kt' }, { label: 'Descent speed', value: { vspeed: 'Vdescent' }, unit: 'kt' },
      { label: 'Descent rate', value: 500, unit: 'fpm' }, { label: 'Descent power', value: { setting: 'descentRpm' }, unit: 'rpm' },
    ],
    tolerances: ['altitude', 'heading', 'speedClimbApproach', 'speed', 'vs'],
    airmanship: [
      'Lookout ahead and above before climbing; ahead and below before descending.',
      'Watch the oil temperature in a long climb: lower the nose if it rises toward the red line.',
      'The 172S is fuel injected: there is no carburettor heat.',
    ],
    keys: ['throttleUp', 'throttleDown', 'throttleFull', 'pitchUp', 'pitchDown', 'trimNoseUp', 'trimNoseDown'],
    diagram: { kind: 'climb' },
    more: 'In a steady climb the excess power, not the elevator, makes the aeroplane climb: the elevator sets the speed. ' +
      'Hold the climb attitude and let the speed settle before trimming.\n\nThe best rate of climb speed Vy gives the most height per minute; ' +
      'Vx gives the most height per mile and is used to clear obstacles.',
    spoken: 'L04.brief',
  };
  l.exercises = [
    { id: 'climbDemo', title: 'Demonstration: climb and level-off', skill: 'climb', mode: 'demo', standard: 'training', required: false, weight: 0 },
    { id: 'climbPractice', title: 'Climb at Vy and level off', skill: 'climb', mode: 'practice', standard: 'training', required: false, weight: 1 },
    { id: 'descentPractice', title: 'Glide and powered descents', skill: 'descent', mode: 'practice', standard: 'training', required: false, weight: 1 },
    { id: 'assessedClimb', title: 'Assessed: climb and level-off', skill: 'climb', mode: 'assessed', standard: 'test', required: true, weight: 2 },
    { id: 'assessedDescent', title: 'Assessed: 500 fpm descent and level-off', skill: 'descent', mode: 'assessed', standard: 'test', required: true, weight: 2 },
  ];
  const card = { title: 'Climb at Vy, level off', targets: [] };
  l.flow = [{
    id: 'all', title: 'All', steps: [{
      kind: 'task', id: 'climb', exercise: 'climbPractice', brief: 'L04.climbTo', card, goal: { const: true },
      criteria: [
        crit('climbIas', 'Climb speed', 'hold', 'asiKt', { vspeed: 'Vy' }, 'speedClimbApproach'),
        crit('climbHdg', 'Heading', 'hold', 'hdgDeg', v('hdg0'), 'heading'),
        crit('levelOff', 'Level-off overshoot', 'peak', 'altFt', v('tgt'), 'altitude'),
        crit('levelAlt', 'Altitude after level-off', 'final', 'altFt', v('tgt'), 'altitude'),
        crit('glideIas', 'Glide speed', 'hold', 'asiKt', 68, 'speed'),
        crit('glideLevel', 'Level-off', 'peak', 'altFt', v('glideTo'), 'altitude'),
        crit('descIas', 'Descent speed', 'hold', 'asiKt', 90, 'speed'),
        crit('descVs', 'Descent rate', 'hold', 'vsiFpm', -500, 'vs'),
        crit('aDescHdg', 'Heading', 'hold', 'hdgDeg', v('hdg0'), 'heading'),
        crit('aDescLevel', 'Level-off', 'peak', 'altFt', v('down'), 'altitude'),
      ],
    }],
  }];
  l.lookAhead = 'Next lesson: medium turns. Same scan, one more axis.';
  return l;
}

function l10(): Lesson {
  const l = baseLesson(SEEDS[9]);
  l.briefing = { ...l.briefing, aim: 'To fly a complete circuit to a landing.', diagram: { kind: 'circuit' } };
  l.exercises = [
    { id: 'circuitDemo', title: 'Demonstration circuit', skill: 'circuit', mode: 'demo', standard: 'training', required: false, weight: 0 },
    { id: 'circuitAssessed', title: 'Assessed circuit and landing', skill: 'circuit', mode: 'assessed', standard: 'test', required: true, weight: 2 },
  ];
  l.flow = [{ id: 'all', title: 'All', steps: [{
    kind: 'task', id: 'c', exercise: 'circuitAssessed', brief: 'x', card: { title: 'Circuit', targets: [] }, goal: { const: true },
    criteria: [
      crit('dwAlt', 'Circuit height', 'hold', 'altFt', 1394, 'altitude'),
      crit('appIas', 'Approach speed', 'hold', 'asiKt', 65, 'speedClimbApproach'),
      crit('gp', 'Glide path', 'hold', 'gpDevFt', 0, 'glidepathFt'),
      crit('sink', 'Sink at touchdown', 'final', 'vsiFpm', 0, 'sinkFpm'),
    ],
  }] }];
  return l;
}

function l20(): Lesson {
  const l = baseLesson(SEEDS[19]);
  l.start = { kind: 'ground', spot: 'holdA1', engine: 'running' };
  l.briefing = {
    aim: 'To plan and fly a closed route by map, compass and clock, and divert to an alternate.',
    points: ['Set heading overhead and start the clock.', 'Check the track every five minutes: heading, time, features.', 'Divert with a heading and a time estimate within 90 s.'],
    numbers: [{ label: 'Cruise', value: 105, unit: 'kt' }, { label: 'Altitude', value: 3500, unit: 'ft' }, { label: 'Cruise power', value: 2300, unit: 'rpm' }],
    tolerances: ['navAltitude', 'navHeading', 'xtkNm', 'etaMin'],
    airmanship: ['Minimum safe altitude on every leg: 1,000 ft above the highest ground.'],
    keys: ['headingBugLeft', 'headingBugRight', 'kollsmanUp', 'kollsmanDown'], spoken: 'L20.brief',
  };
  l.route = {
    id: 'local', name: 'Local navigation route', altFt: 3500, legMinutes: [9, 11, 7, 8], legHeadingsDeg: [32, 141, 228, 304],
    waypoints: [
      { id: 'kfbl', name: 'KFBL', north: 0, east: 0 }, { id: 'lake', name: 'Foothill Lake', north: 12000, east: 8000 },
      { id: 'valley', name: 'Valley Lake', north: 2000, east: 22000 }, { id: 'town', name: 'Town', north: -8000, east: 12000 },
      { id: 'kfbl2', name: 'KFBL', north: 0, east: 0 },
    ],
  };
  return l;
}

const SYLLABUS: Lesson[] = SEEDS.map((s) => (s[0] === 'L04' ? l04() : s[0] === 'L10' ? l10() : s[0] === 'L20' ? l20() : baseLesson(s)));
const lessonById = (id: string): Lesson => SYLLABUS.find((l) => l.id === id)!;

const CHALLENGES: ChallengeDef[] = [
  { id: 'spot', title: 'Spot landing', description: 'Land on the aim point from a 3 NM final. Sink costs points; nose first scores zero.', unlockedBy: 'L09', lesson: lessonById('L09'), scoring: 'spotLanding' },
  { id: 'circuit', title: 'Precision circuit', description: 'One circuit flown to the numbers: every target held tight.', unlockedBy: 'L10', lesson: lessonById('L10'), scoring: 'precisionCircuit' },
  { id: 'deadstick', title: 'Dead-stick', description: 'Engine stopped, 3,000 ft above the field, 3 NM east. Make the runway.', unlockedBy: 'L16', lesson: lessonById('L16'), scoring: 'deadStick' },
  { id: 'xwind', title: 'Crosswind master', description: '15 kt across runway 07 with gusts to 25. Centreline, drift and sink.', unlockedBy: 'L17', lesson: lessonById('L17'), scoring: 'crosswindMaster' },
];

// ---- Career fixture ----------------------------------------------------------------------------------------

const ZERO_TIMES = { blockS: 0, airborneS: 0, nightS: 0, instrumentS: 0, landingsDay: 0, landingsNight: 0, takeoffs: 0 };

function logEntry(i: number, lessonId: string | null, date: string, minutes: number, extra: Partial<LogbookEntry> = {}): LogbookEntry {
  const l = lessonId ? lessonById(lessonId) : null;
  const block = minutes * 60;
  return {
    id: `e${i}`, date, aircraftType: 'C172', registration: 'G-FSCK', from: 'KFBL', to: 'KFBL', role: l?.kind === 'solo' ? 'solo' : lessonId ? 'dual' : 'solo',
    times: { ...ZERO_TIMES, blockS: block, airborneS: block - 120, landingsDay: l && l.stage !== 'handling' ? 3 : lessonId ? 0 : 1, takeoffs: lessonId ? 0 : 1 },
    lessonId, lessonVersion: l ? 1 : null,
    exercise: l ? `${l.syllabusRef.easa} ${l.title}` : 'Free flight', outcome: lessonId ? 'competent' : 'freeFlight', stars: lessonId ? 2 : null,
    remarks: '', signedBy: lessonId ? 'K. Mercer FI(A)' : null, ...extra,
  };
}

function makeSave(): TrainingSave {
  const competent = fresh ? [] : late ? SEEDS.slice(0, 17).map((x) => x[0]) : ['L01', 'L02', 'L03', 'L04', 'L05'];
  const progress: Record<string, LessonProgress> = {};
  competent.forEach((id, i) => {
    progress[id] = { status: 'competent', attempts: id === 'L04' ? 2 : 1, bestStars: [3, 2, 2, 3, 1][i % 5], lastOutcome: 'competent', exercises: {}, completedAt: new Date(Date.UTC(2026, 8, 10 + i) + 11 * 3600_000).toISOString(), lessonVersion: 1 };
  });
  if (!fresh && !late) progress.L06 = { status: 'available', attempts: 1, bestStars: 0, lastOutcome: 'notYet', exercises: {}, lessonVersion: 1 };
  const logbook: LogbookEntry[] = fresh ? [] : [
    logEntry(1, 'L01', '2026-09-10T10:20:00Z', 14, { stars: 3, remarks: 'Trim, trim, trim.' }),
    logEntry(2, 'L02', '2026-09-12T09:05:00Z', 22),
    logEntry(3, null, '2026-09-12T16:40:00Z', 35, { remarks: 'free flight', signedBy: null }),
    logEntry(4, 'L03', '2026-09-13T10:00:00Z', 16),
    logEntry(5, 'L03', '2026-09-14T10:00:00Z', 15, { outcome: 'notYet', stars: null, remarks: 'Altitude wandered at 80 kt.' }),
    logEntry(6, 'L04', '2026-09-16T10:00:00Z', 15, { outcome: 'notYet', stars: null }),
    logEntry(7, 'L04', '2026-09-19T10:30:00Z', 14, { traceId: 'tr-L04', stars: 3 }),
    logEntry(8, null, '2026-09-20T15:10:00Z', 48, { remarks: 'Valley tour, sunset', signedBy: null, times: { ...ZERO_TIMES, blockS: 2880, airborneS: 2700, nightS: 600, landingsNight: 1, takeoffs: 1 } }),
    logEntry(9, 'L05', '2026-09-22T09:40:00Z', 13, { stars: 1 }),
    logEntry(10, 'L06', '2026-09-24T09:40:00Z', 12, { outcome: 'notYet', stars: null, remarks: 'Stall warning held too long.' }),
    logEntry(11, null, '2026-09-25T17:00:00Z', 26, { signedBy: null }),
    logEntry(12, null, '2026-09-27T12:00:00Z', 31, { signedBy: null, times: { ...ZERO_TIMES, blockS: 1860, airborneS: 1700, instrumentS: 900, landingsDay: 2, takeoffs: 2 } }),
    ...(late ? [
      logEntry(13, 'L13', '2026-09-28T09:00:00Z', 24),
      logEntry(14, 'L14', '2026-09-28T10:00:00Z', 9, { role: 'solo', signedBy: null, stamp: 'FIRST SOLO', remarks: 'First solo!' }),
      logEntry(15, 'L15', '2026-09-29T10:00:00Z', 13),
      logEntry(16, 'L17', '2026-09-30T10:00:00Z', 17),
    ] : []),
  ];
  return {
    format: 'fs-training', schema: 1, createdAt: '2026-09-10T09:50:00Z', updatedAt: NOW.toISOString(), appBuild: 'dev',
    profile: { studentName: fresh ? 'Student pilot' : 'Alex Morgan', instructorName: 'Kate Mercer', licenceNo: 'FBL-0421', experienced: false },
    settings: {
      authority: AUTH, talkativeness: 'normal',
      voice: { instructor: null, examiner: null, rate: 1, volume: 0.9, captions: true, captionsOnly: params.get('voices') === '0' },
      instructorSaves: true, liveBars: true, autoAck: false, logFreeFlights: true,
    },
    progress, skills: {},
    endorsements: late ? [{ id: 'firstSolo', at: '2026-09-28T10:10:00Z', lessonId: 'L14' }, { id: 'crosswind15', at: '2026-09-30T10:20:00Z', lessonId: 'L17' }] : [],
    logbook,
    results: fresh ? {} : { L04: [debriefResult('L04')] },
    bests: fresh ? {} : { spot: [
      { score: 84, at: '2026-09-21T10:00:00Z', authority: 'easa', flags: { calmAir: false, kbdAssists: true, instructorSaves: true, inputDevice: 'keyboard' } },
      { score: 71, at: '2026-09-20T10:00:00Z', authority: 'easa', flags: { calmAir: false, kbdAssists: true, instructorSaves: true, inputDevice: 'keyboard' } },
      { score: 58, at: '2026-09-19T10:00:00Z', authority: 'easa', flags: { calmAir: false, kbdAssists: true, instructorSaves: true, inputDevice: 'keyboard' } },
    ] },
    testHistory: [],
  };
}

/** Simple stand-ins for the module-2 progress functions (the dev page must not depend on their state). */
const FAKE_PROGRESS: SchoolProgressFns = {
  lessonStatuses(save, syllabus) {
    const out: Record<string, LessonProgress['status']> = {};
    for (const l of syllabus) {
      if (save.progress[l.id]?.status === 'competent') out[l.id] = 'competent';
      else out[l.id] = save.profile.experienced || l.requires.every((r) => save.progress[r]?.status === 'competent') ? 'available' : 'locked';
    }
    return out;
  },
  missingPrerequisites: (save, lesson) => lesson.requires.filter((r) => save.progress[r]?.status !== 'competent'),
  nextLesson(save, syllabus, a) {
    const st = FAKE_PROGRESS.lessonStatuses(save, syllabus, a);
    return syllabus.find((l) => st[l.id] === 'available' && l.stage !== 'rating') ?? null;
  },
  rank: (save) => (save.endorsements.some((e) => e.id === 'ppl') ? 'Private Pilot (A)' : save.endorsements.some((e) => e.id === 'firstSolo') ? 'First Solo' : 'Student Pilot'),
  totals(logbook): CareerTotals {
    const t: CareerTotals = { totalS: 0, dualS: 0, soloS: 0, picS: 0, nightS: 0, instrumentS: 0, landingsDay: 0, landingsNight: 0, takeoffs: 0, flights: 0 };
    for (const e of logbook) {
      t.totalS += e.times.blockS;
      if (e.role === 'dual' || e.role === 'test') t.dualS += e.times.blockS;
      else if (e.role === 'solo') t.soloS += e.times.blockS;
      else t.picS += e.times.blockS;
      t.nightS += e.times.nightS;
      t.instrumentS += e.times.instrumentS;
      t.landingsDay += e.times.landingsDay;
      t.landingsNight += e.times.landingsNight;
      t.takeoffs += e.times.takeoffs;
      t.flights++;
    }
    return t;
  },
};

// ---- Trace fixtures ----------------------------------------------------------------------------------------

/** Seeded noise so screenshots are stable. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32) * 2 - 1;
}

/** Piecewise path through keyframes [t, value] with eased segments. */
function path(keys: [number, number][], t: number): number {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [t1, v1] = keys[i];
    const [t0, v0] = keys[i - 1];
    if (t <= t1) {
      const u = (t - t0) / (t1 - t0);
      return v0 + (v1 - v0) * (0.5 - 0.5 * Math.cos(Math.PI * u));
    }
  }
  return keys[keys.length - 1][1];
}

function emptyChannels(): Record<TraceChannel, number[]> {
  const names: TraceChannel[] = ['t', 'altFt', 'asiKt', 'hdgDeg', 'aiBankDeg', 'vsiFpm', 'pitchDeg', 'aglFt', 'north', 'east', 'throttle', 'flapsDeg', 'gpDevFt', 'rwyAcrossM', 'authority'];
  return Object.fromEntries(names.map((n) => [n, [] as number[]])) as Record<TraceChannel, number[]>;
}

const tol = (key: keyof (typeof STANDARDS)['easa']['test'], std: 'training' | 'test') => STANDARDS[AUTH][std][key];

function traceL04(id: string, wobble: number): TraceData {
  const r = rng(id.length * 97 + wobble * 13);
  const ch = emptyChannels();
  const alt: [number, number][] = [[0, 2500], [25, 2500], [140, 3500], [190, 3500], [205, 3500], [330, 4560], [345, 4520], [375, 4500], [395, 4500], [470, 4010], [490, 4000], [500, 4000], [600, 3480], [612, 3500], [630, 3500], [740, 4540], [760, 4500], [790, 4500], [905, 3500], [930, 3500]];
  const ias: [number, number][] = [[0, 105], [25, 105], [45, 76], [130, 74], [150, 100], [205, 104], [220, 81], [240, 77], [325, 75], [350, 102], [395, 104], [410, 69], [470, 67], [495, 95], [505, 90], [595, 88], [620, 103], [640, 104], [655, 75], [735, 76], [760, 103], [790, 104], [805, 90], [900, 92], [930, 104]];
  const N = 930 * 2;
  let n = 0;
  let e = 0;
  for (let i = 0; i <= N; i++) {
    const t = i / 2;
    const a = path(alt, t) + r() * 6;
    const a2 = path(alt, t + 0.5);
    ch.t.push(t);
    ch.altFt.push(a);
    ch.asiKt.push(path(ias, t) + r() * 1.2 + wobble * Math.sin(t / 9));
    const hdg = 100 + 4 * Math.sin(t / 37) + r() * 1.2 + (t > 500 && t < 600 ? 6 : 0);
    ch.hdgDeg.push(((hdg % 360) + 360) % 360);
    ch.aiBankDeg.push(2 * Math.sin(t / 23) + r());
    ch.vsiFpm.push((a2 - path(alt, t)) * 120);
    ch.pitchDeg.push(2 + (a2 - path(alt, t)) * 0.4);
    ch.aglFt.push(a - 600);
    n += Math.cos((hdg * Math.PI) / 180) * 50 * 0.5;
    e += Math.sin((hdg * Math.PI) / 180) * 50 * 0.5;
    ch.north.push(n);
    ch.east.push(e);
    ch.throttle.push(0.7);
    ch.flapsDeg.push(0);
    ch.gpDevFt.push(NaN);
    ch.rwyAcrossM.push(NaN);
    ch.authority.push(t < 190 ? 1 : 0);
  }
  const bands: TraceBand[] = [];
  const band = (sig: TraceBand['sig'], fromS: number, toS: number, target: number, t: { minus: number; plus: number }, taskId: string): void => {
    bands.push({ sig, fromS, toS, target, minus: t.minus, plus: t.plus, taskId });
  };
  band('asiKt', 222, 320, 74, tol('speedClimbApproach', 'training'), 'climb');
  band('altFt', 320, 395, 4500, tol('altitude', 'training'), 'climb');
  band('hdgDeg', 205, 395, 100, tol('heading', 'training'), 'climb');
  band('asiKt', 415, 470, 68, tol('speed', 'training'), 'glide');
  band('altFt', 470, 500, 4000, tol('altitude', 'training'), 'glide');
  band('asiKt', 510, 595, 90, tol('speed', 'training'), 'powered');
  band('vsiFpm', 515, 590, -500, tol('vs', 'training'), 'powered');
  band('asiKt', 660, 735, 74, tol('speedClimbApproach', 'test'), 'aClimb');
  band('altFt', 735, 790, 4500, tol('altitude', 'test'), 'aClimb');
  band('hdgDeg', 640, 930, 100, tol('heading', 'test'), 'aDescent');
  band('asiKt', 810, 900, 90, tol('speed', 'test'), 'aDescent');
  band('vsiFpm', 815, 895, -500, tol('vs', 'test'), 'aDescent');
  band('altFt', 895, 930, 3500, tol('altitude', 'test'), 'aDescent');
  return {
    id, lessonId: 'L04', hz: 2, channels: ch, bands,
    events: [
      { t: 214, type: 'coach', label: 'Speed’s high, 81. Raise the nose a touch.' },
      { t: 312, type: 'coach', label: 'Start levelling now: attitude, power, trim.' },
      { t: 190, type: 'handover', label: 'You have control' },
      { t: 425, type: 'coach', label: 'Lower the nose: speed 66.' },
    ],
    demoSpans: [[0, 190]],
    phases: [{ t: 0, label: 'Demonstration' }, { t: 190, label: 'Your climb' }, { t: 395, label: 'Descents' }, { t: 630, label: 'Assessed' }],
    interrupted: false,
  };
}

/** Two circuits of runway 07: the instructor's demonstration, then the student's (a little wide). */
function traceL10(): TraceData {
  const r = rng(10);
  const ch = emptyChannels();
  const half = 900;
  const lap = (wide: number): [number, number, number][] => [
    // [along, across, height AGL]
    [-half + 50, 0, 0], [-half + 450, 0, 0], [half, 0, 380], [half + 1000, 0, 520], [half + 1000, -450, 800],
    [half + 1000, -900 - wide, 1000], [0, -900 - wide, 1000], [-half, -900 - wide, 1000], [-half - 1200, -900 - wide, 780],
    [-half - 1200, -450, 600], [-half - 1200, 0, 480], [-half - 600, 0, 210], [-half + 150, 0, 0], [-half + 700, 0, 0],
  ];
  const pts = [...lap(0), ...lap(220)];
  let t = 0;
  for (let k = 1; k < pts.length; k++) {
    const [a0, x0, h0] = pts[k - 1];
    const [a1, x1, h1] = pts[k];
    const d = Math.hypot(a1 - a0, x1 - x0);
    const steps = Math.max(4, Math.round((d / 45) * 2));
    for (let s = 0; s < steps; s++) {
      const u = s / steps;
      const along = a0 + (a1 - a0) * u;
      const across = x0 + (x1 - x0) * u + (k > 14 && h1 > 0 ? r() * 15 : 0);
      const h = Math.max(0, h0 + (h1 - h0) * u + (h1 > 0 ? r() * 20 : 0));
      const p = fromRunway(along, across);
      ch.t.push(t);
      ch.north.push(p.north);
      ch.east.push(p.east);
      ch.aglFt.push(h);
      ch.altFt.push(394 + h + (k > 14 && h1 === 1000 ? 70 : 0));
      const onFinal = across > -60 && along < -half + 160 && h > 0 && h < 700;
      ch.asiKt.push(h === 0 ? 40 : onFinal ? 67 + r() * 3 + (k > 14 ? 5 : 0) : h1 >= 1000 ? 90 + r() * 2 : 75 + r() * 2);
      const hdg = (Math.atan2(fromRunway(a1, x1).east - fromRunway(a0, x0).east, fromRunway(a1, x1).north - fromRunway(a0, x0).north) * 180) / Math.PI;
      ch.hdgDeg.push((hdg + 360) % 360);
      ch.aiBankDeg.push(r() * 3);
      ch.vsiFpm.push(((h1 - h0) / Math.max(1, steps / 2)) * 60);
      ch.pitchDeg.push(2);
      ch.throttle.push(0.6);
      ch.flapsDeg.push(onFinal ? 30 : 0);
      ch.gpDevFt.push(onFinal ? (k > 14 ? 40 : 0) + r() * 25 : NaN);
      ch.rwyAcrossM.push(onFinal || h === 0 ? across / 3 : NaN);
      ch.authority.push(k <= 13 ? 1 : 0);
      t += 0.5;
    }
  }
  const endT = t;
  const half2 = endT / 2;
  return {
    id: 'tr-L10', lessonId: 'L10', hz: 2, channels: ch,
    bands: [
      { sig: 'altFt', fromS: half2 + 60, toS: half2 + 150, target: 1394, minus: 150, plus: 150, taskId: 'c' },
      { sig: 'asiKt', fromS: endT - 70, toS: endT - 25, target: 65, minus: 5, plus: 15, taskId: 'c' },
      { sig: 'gpDevFt', fromS: endT - 70, toS: endT - 30, target: 0, minus: 100, plus: 100, taskId: 'c' },
    ],
    events: [
      { t: 9, type: 'liftoff', label: 'Lift-off 56 kt' }, { t: half2 - 10, type: 'touchdown', label: 'Touchdown 180 fpm' },
      { t: half2 + 9, type: 'liftoff', label: 'Lift-off 57 kt' }, { t: endT - 12, type: 'touchdown', label: 'Touchdown 310 fpm' },
      { t: half2 + 100, type: 'coach', label: 'You’re a bit wide: bring it in.' },
    ],
    demoSpans: [[0, half2]],
    phases: [{ t: 0, label: 'Demonstration circuit' }, { t: half2, label: 'Assessed circuit' }],
    interrupted: false,
  };
}

// ---- Results and models ------------------------------------------------------------------------------------

function cr(id: string, label: string, kind: CriterionResult['kind'], grade: Grade, testGrade: Grade, target: number, t: { minus: number; plus: number }, dev: number, atS: number, within: number, pattern: CriterionResult['pattern'] = 'ok', extra: Partial<CriterionResult> = {}): CriterionResult {
  return {
    id, label, kind, required: true, safety: false, target, tol: t, testTol: t, grade, testGrade, within,
    maxN: Math.abs(dev) / (dev >= 0 ? t.plus || 0.5 : t.minus || 0.5), worst: { value: target + dev, dev, atS },
    excursions: 0, longestOutS: 0, pattern, detail: `Within ${t.plus} for ${Math.round(within * 100)} %`, ...extra,
  };
}

function exercises(): ExerciseResult[] {
  const ex = (exerciseId: string, title: string, mode: ExerciseResult['mode'], standard: ExerciseResult['standard'], grade: Grade | null, testGrade: Grade | null, criteria: CriterionResult[], attempts = 1): ExerciseResult =>
    ({ exerciseId, title, mode, standard, grade, testGrade, criteria, attempts, interventions: 0, faults: [] });
  const tr = (k: Parameters<typeof tol>[0]) => tol(k, 'training');
  const te = (k: Parameters<typeof tol>[0]) => tol(k, 'test');
  return [
    ex('climbDemo', 'Demonstration: climb and level-off', 'demo', 'training', null, null, []),
    ex('climbPractice', 'Climb at Vy and level off', 'practice', 'training', 2, 1, [
      cr('climbIas', 'Climb speed', 'hold', 3, 3, 74, tr('speedClimbApproach'), 7, 214, 0.94, 'biasHigh'),
      cr('climbHdg', 'Heading', 'hold', 4, 4, 100, tr('heading'), 5, 280, 1),
      cr('levelOff', 'Level-off overshoot', 'peak', 2, 1, 4500, tr('altitude'), 60, 331, 0, 'late'),
      cr('levelAlt', 'Altitude after level-off', 'final', 4, 4, 4500, tr('altitude'), 4, 395, 0),
    ], 2),
    ex('descentPractice', 'Glide and powered descents', 'practice', 'training', 3, 3, [
      cr('glideIas', 'Glide speed', 'hold', 3, 3, 68, tr('speed'), -3, 452, 0.97),
      cr('glideLevel', 'Level-off', 'peak', 4, 4, 4000, tr('altitude'), -12, 489, 0),
      cr('descVs', 'Descent rate', 'hold', 3, 2, -500, tr('vs'), 140, 560, 0.93, 'oscillation'),
    ]),
    ex('assessedClimb', 'Assessed: climb and level-off', 'assessed', 'test', 3, 3, [
      cr('climbIas', 'Climb speed', 'hold', 3, 3, 74, te('speedClimbApproach'), 4, 700, 0.99),
      cr('levelOff', 'Level-off overshoot', 'peak', 3, 3, 4500, te('altitude'), 40, 742, 0),
    ]),
    ex('assessedDescent', 'Assessed: 500 fpm descent and level-off', 'assessed', 'test', 3, 3, [
      cr('aDescHdg', 'Heading', 'hold', 3, 3, 100, te('heading'), 7, 870, 0.98),
      cr('descVs', 'Descent rate', 'hold', 3, 3, -500, te('vs'), -120, 850, 0.96),
      cr('aDescLevel', 'Level-off', 'peak', 4, 4, 3500, te('altitude'), -20, 905, 0),
    ]),
  ];
}

function debriefResult(lessonId: string): LessonResult {
  const circuit = lessonId === 'L10';
  return {
    lessonId, lessonVersion: 1, attemptId: `a-${lessonId}`, authority: AUTH,
    startedAt: '2026-09-19T10:30:00Z', endedAt: '2026-09-19T10:44:00Z',
    outcome: 'competent', stars: circuit ? 1 : 2,
    exercises: circuit ? [
      { exerciseId: 'circuitDemo', title: 'Demonstration circuit', mode: 'demo', standard: 'training', grade: null, testGrade: null, criteria: [], attempts: 1, interventions: 0, faults: [] },
      { exerciseId: 'circuitAssessed', title: 'Assessed circuit and landing', mode: 'assessed', standard: 'test', grade: 2, testGrade: 2, attempts: 1, interventions: 0, faults: [{ id: 'downwindChecks', severity: 'minor', atS: 620 }], criteria: [
        cr('dwAlt', 'Circuit height', 'hold', 3, 3, 1394, tol('altitude', 'test'), 85, 640, 0.97, 'biasHigh'),
        cr('appIas', 'Approach speed', 'hold', 2, 2, 65, tol('speedClimbApproach', 'test'), 9, 790, 0.91, 'biasHigh'),
        cr('gp', 'Glide path', 'hold', 3, 3, 0, tol('glidepathFt', 'test'), 62, 770, 0.98),
        { ...cr('sink', 'Sink at touchdown', 'final', 3, 3, 0, tol('sinkFpm', 'test'), 310, 812, 0), safety: true },
      ] },
    ] : exercises(),
    interventions: 0, handbacks: 0, phaseRetries: circuit ? 1 : 0,
    flags: { calmAir: false, kbdAssists: true, instructorSaves: true, inputDevice: 'keyboard' },
    weatherLine: circuit ? 'Wind 080/9, CAVOK, 10:15' : 'Wind 090/7, CAVOK, 09:30',
    flight: { ...ZERO_TIMES, blockS: 840, airborneS: 840, landingsDay: circuit ? 2 : 0 },
    debrief: circuit ? {
      strength: 'Glide path held within 62 feet all the way down.',
      main: 'Approach speed sat 9 knots fast. Set the attitude for 65 and trim before the base turn.',
      next: 'Next lesson: go-arounds, flapless and glide approaches.',
      spoken: ['Competent.', 'Main point: approach speed.'],
    } : {
      strength: 'Good climbs: speed within 4 knots on the assessed climb.',
      main: 'Level-offs. You went 60 feet through 4,500 in practice. Start levelling at 10 percent of the climb rate, about 50 feet early.',
      next: 'Next lesson: medium turns. Same scan, one more axis.',
      spoken: ['Competent, two stars.', 'Main point: level-offs.'],
    },
    traceId: circuit ? 'tr-L10' : 'tr-L04',
  };
}

const TRACES: Record<string, TraceData> = {};
const trace = (id: string): TraceData | null => {
  if (!TRACES[id]) {
    if (id === 'tr-L04') TRACES[id] = traceL04(id, 0);
    else if (id === 'tr-L04-best') TRACES[id] = traceL04(id, 2);
    else if (id === 'tr-L10') TRACES[id] = traceL10();
    else return null;
  }
  return TRACES[id];
};

function briefingModel(id: string): BriefingModel {
  const lesson = lessonById(id);
  const numbers: BriefingModel['numbers'] = id === 'L04'
    ? [{ label: 'Vy', value: 74, unit: 'kt' }, { label: 'Cruise climb', value: 85, unit: 'kt' }, { label: 'Best glide', value: 68, unit: 'kt' }, { label: 'Descent speed', value: 90, unit: 'kt' }, { label: 'Descent rate', value: 500, unit: 'fpm' }, { label: 'Descent power', value: 1900, unit: 'rpm' }]
    : lesson.briefing.numbers.map((n) => ({ label: n.label, value: typeof n.value === 'number' ? n.value : 0, unit: n.unit }));
  return {
    lesson, aircraft: null as never, authority: AUTH, numbers,
    tolerances: lesson.briefing.tolerances.map((key) => ({ key, lesson: STANDARDS[AUTH].training[key], test: STANDARDS[AUTH].test[key] })),
    weatherLine: 'Wind 090/7, CAVOK, 09:30', practiceOnly: false,
  };
}

function debriefModel(id: string, milestone: DebriefModel['milestone'] = null): DebriefModel {
  const lesson = lessonById(id);
  const result = debriefResult(id);
  const preview = logEntry(99, id, result.endedAt, 14, { traceId: result.traceId ?? undefined, stars: result.stars, ...(milestone === 'firstSolo' ? { stamp: 'FIRST SOLO' as const } : {}) });
  return {
    lesson, result, trace: trace(result.traceId!), bestTrace: id === 'L04' ? trace('tr-L04-best') : null, logbookPreview: preview,
    retryPhases: id === 'L04' ? [{ phaseId: 'practiceClimb', title: 'Your climb' }, { phaseId: 'practiceDescent', title: 'Descents' }, { phaseId: 'assessed', title: 'Assessed climb and descent' }] : [{ phaseId: 'assessed', title: 'Assessed circuit' }],
    nextLessonId: id === 'L04' ? 'L05' : 'L11', milestone,
  };
}

const STRIP: LessonStripModel = {
  lessonId: 'L04', lessonTitle: 'Lesson 4 · Climbing and descending', authority: 'student', holds: [], matchThrottle: null,
  taskTitle: 'Climb at Vy, level off at 3,500', assessed: false,
  chips: [
    { label: 'IAS', text: 'IAS +7', n: 0.47, state: 'green' },
    { label: 'ALT', text: 'ALT −420', n: 2.1, state: 'red' },
    { label: 'HDG', text: 'HDG 3°', n: 0.2, state: 'green' },
    { label: 'BALL', text: 'BALL ½', n: 0.8, state: 'amber' },
  ],
};

const CAPTIONS: Caption[] = [
  { id: 'c1', actor: 'instructor', channel: 'cabin', text: 'You have control.', atWall: 0, atSim: 180, spoken: true },
  { id: 'c2', actor: 'student', channel: 'cabin', text: 'I have control.', atWall: 0, atSim: 181, spoken: false },
  { id: 'c3', actor: 'instructor', channel: 'cabin', text: 'Climb to 3,500 ft at 74 kt. Lookout first.', atWall: 0, atSim: 186, spoken: true },
  { id: 'c4', actor: 'instructor', channel: 'cabin', text: 'Speed’s high, 81. Raise the nose a touch.', atWall: 0, atSim: 214, spoken: true },
];

const CARD: CardModel = {
  lessonTitle: 'Lesson 4: Climbing and descending', phaseTitle: 'Your climb', taskTitle: 'Climb at Vy, level off at 3,500 ft', stepT: 74,
  targets: [
    { label: 'IAS', unit: 'kt', target: 74, value: 81, tol: { minus: 5, plus: 15 }, n: 0.47 },
    { label: 'ALT', unit: 'ft', target: 3500, value: 3080, tol: { minus: 200, plus: 200 }, n: 2.1 },
    { label: 'HDG', unit: 'deg', target: 100, value: 103, tol: { minus: 15, plus: 15 }, n: 0.2 },
  ],
  liveFeedback: true, captions: CAPTIONS,
  checklist: { title: 'After take-off', items: [
    { id: 'flaps', label: 'Flaps: up', state: 'done' }, { id: 'power', label: 'Power: climb', state: 'done' },
    { id: 'lights', label: 'Landing light: on', state: 'missed' }, { id: 'temps', label: 'Temperatures and pressures: green', state: 'active' },
    { id: 'fuel', label: 'Fuel pump: off', state: 'pending' },
  ] },
};

// ---- Page --------------------------------------------------------------------------------------------------

const save = makeSave();
const career: SchoolCareer = {
  save: screen === 'welcome' ? null : save, syllabus: SYLLABUS, challenges: CHALLENGES, authority: AUTH,
  storage: params.get('storage') === 'mem' ? 'memoryOnly' : 'ok', resume: params.get('resume') === '1' ? { lessonId: 'L06', title: 'Lesson 6: Slow flight' } : null,
  voices: params.get('voices') === '0' ? [] : [
    { voiceURI: 'gb-f', name: 'Google UK English Female', lang: 'en-GB' }, { voiceURI: 'gb-m', name: 'Google UK English Male', lang: 'en-GB' },
    { voiceURI: 'us', name: 'Google US English', lang: 'en-US' },
  ],
  now: NOW,
};
const flown = params.get('flown');
if (isAircraftId(flown) && flown !== 'c172s') {
  career.aircraft = { flown: { id: flown, name: aircraftSummary(flown).shortName }, supported: false, school: { id: 'c172s', name: aircraftSummary('c172s').shortName } };
}

const BINDINGS = [...KEY_BINDINGS, { keys: 'Escape', action: 'Menu', category: 'Simulation' }];
const ui = new UISystem({ bindings: BINDINGS, hints: 'never' });
const school = new SchoolUi(ui.schoolLayer, {
  ...FAKE_PROGRESS,
  loadTrace: trace,
  previewImport: () => ({ studentName: 'Alex Morgan', lessonsCompetent: 5, hours: 3.9, landings: 6 }),
  testVoice: (p, voice) => ui.showToast(`Test voice: ${p} ${voice ?? 'automatic'}`),
  updateProfile: (p) => console.log('[school] updateProfile', p),
  playDebrief: (lines) => ui.showToast(lines.join(' ')),
});
const commands: unknown[] = [];
school.onCommand = (cmd) => {
  commands.push(cmd);
  console.log('[school] command', JSON.stringify(cmd));
};
Object.assign(window as object, { __school: school, __ui: ui, __commands: commands });

const flight = new MockFlight();
const aircraft = new THREE.Group();

/** A painted stand-in for the cockpit panel, so highlight rings and the hood line have something to sit on. */
function fakePanel(): { project(px: number, py: number): [number, number] } {
  const c = document.createElement('canvas');
  const w = window.innerWidth;
  const h = Math.round(w * (PANEL_HEIGHT / PANEL_WIDTH));
  const top = window.innerHeight - h * 0.82;
  c.width = w;
  c.height = h;
  c.style.cssText = `position:fixed;left:0;top:${top}px;width:${w}px;height:${h}px;z-index:5;pointer-events:none`;
  const g = c.getContext('2d')!;
  const s = w / PANEL_WIDTH;
  g.fillStyle = '#23272d';
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#16191d';
  g.fillRect(0, 0, w, 10 * s + 6);
  const L = PANEL_LAYOUT;
  const gauge = (x: number, y: number, r: number, label: string): void => {
    g.fillStyle = '#0b0d10';
    g.beginPath();
    g.arc(x * s, y * s, r * s, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#4a525c';
    g.lineWidth = 2;
    g.stroke();
    g.fillStyle = '#c9d1da';
    g.font = `${Math.round(14 * s * 2)}px Inter, sans-serif`;
    g.textAlign = 'center';
    g.fillText(label, x * s, y * s + 5 * s);
  };
  const names = [['ASI', 'AI', 'ALT'], ['TC', 'DG', 'VSI']];
  L.sixPack.rows.forEach((y, ri) => L.sixPack.cols.forEach((x, ci) => gauge(x, y, L.apertures.sixPack, names[ri][ci])));
  gauge(L.engineRow.tach, L.engineRow.y, L.apertures.sixPack, 'RPM');
  gauge(L.engineRow.fuel, L.engineRow.y, L.apertures.small, 'FUEL');
  gauge(L.engineRow.oil, L.engineRow.y, L.apertures.small, 'OIL');
  document.body.appendChild(c);
  return { project: (px, py) => [px * s, top + py * s] };
}

void runHarness({
  setup(ctx) {
    ctx.cameraMode = 'chase';
    ctx.commands.reset = (s) => ctx.events.emit('reset', { scenario: s });
    ctx.commands.setCameraMode = (m) => {
      ctx.cameraMode = m;
    };
    const h = 1 / 60;
    for (let t = 0; t < 110; t += h) flight.step(h, ctx.state, ctx.controls);
  },
  beforeUpdate(dt, ctx) {
    flight.step(dt, ctx.state, ctx.controls);
  },
  subsystems: [
    {
      init(ctx) {
        const ground = new THREE.Mesh(new THREE.PlaneGeometry(40000, 40000).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x5d7f45, roughness: 1 }));
        ground.position.y = 120;
        ctx.scene.add(ground);
        const white = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.5 });
        aircraft.add(new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.2, 7.5), white));
        const wing = new THREE.Mesh(new THREE.BoxGeometry(11, 0.14, 1.5), white);
        wing.position.set(0, 0.7, -0.3);
        aircraft.add(wing);
        ctx.aircraftRoot.add(aircraft);
      },
      update(_dt, ctx) {
        const back = new THREE.Vector3(0, 0, 1).applyQuaternion(ctx.aircraftRoot.quaternion).setY(0).normalize();
        ctx.camera.position.copy(ctx.aircraftRoot.position).addScaledVector(back, 25).add(new THREE.Vector3(0, 6, 0));
        ctx.camera.lookAt(ctx.aircraftRoot.position);
      },
    },
    ui,
  ],
}).then((ctx) => {
  ui.hideLoading();
  ui.attachSchool(school);
  school.setCareer(career);
  const lessonInFlight = (): void => {
    school.setStrip(STRIP);
    school.setCard(CARD);
    school.showCaption(CAPTIONS[3]);
  };
  switch (screen) {
    case 'briefing':
      school.showBriefing(briefingModel(lessonParam));
      break;
    case 'debrief':
    case 'ceremony': {
      school.showDebrief(debriefModel(lessonParam, screen === 'ceremony' ? 'firstSolo' : null));
      const sel = params.get('select');
      const cursor = params.get('cursor');
      if (sel || cursor) {
        window.setTimeout(() => {
          // The first row with that label (the practice exercise is the open one).
          if (sel) {
            const label = sel === 'climbIas' ? 'Climb speed' : sel;
            Array.from(document.querySelectorAll<HTMLElement>('.sc-crit tbody tr')).find((tr) => tr.textContent?.startsWith(label))?.click();
          }
          const canvas = document.querySelector('.sc-graph canvas') as HTMLCanvasElement | null;
          if (canvas && cursor) {
            const r = canvas.getBoundingClientRect();
            const t = Number(cursor);
            const span = Number(debriefModel(lessonParam).trace?.channels.t.at(-1) ?? 1);
            const x = r.left + 70 + (t / span) * (r.width - 82);
            canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: r.top + 40, bubbles: true }));
            window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
            canvas.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: r.top + 40, bubbles: true }));
          }
        }, 300);
      }
      break;
    }
    case 'flight':
    case 'card':
    case 'hood':
    case 'blackout': {
      const panel = fakePanel();
      school.setView({ cockpit: () => true, project: panel.project });
      lessonInFlight();
      school.setHighlight(['asi', 'ai', 'vsi']);
      if (screen === 'flight') {
        school.setStrip({ ...STRIP, authority: 'offered', holds: ['THROTTLE: INSTRUCTOR'] });
        school.setFollowMeThrough(true);
      }
      if (screen === 'card') school.cycleCard();
      if (screen === 'hood' || screen === 'blackout') {
        school.setHighlight([]);
        school.setHood(screen === 'hood' ? 'hood' : 'blackout');
        school.setStrip({ ...STRIP, assessed: true, chips: [], taskTitle: 'Rate-one turn onto 280' });
        school.showCaption({ id: 'x', actor: 'instructor', channel: 'cabin', text: screen === 'hood' ? 'Hood on. Instruments only from here.' : 'Close your eyes. I have control.', atWall: 0, atSim: 0, spoken: true }, { safety: screen === 'blackout' });
      }
      break;
    }
    case 'menu':
      // A briefing first, as in a real lesson (the School tab shows the lesson's objective).
      school.showBriefing(briefingModel('L04'));
      school.hideBriefing();
      school.setStrip(STRIP);
      school.setCard(CARD);
      CAPTIONS.forEach((c) => school.showCaption(c));
      window.setTimeout(() => ui.openMenu(), 150);
      break;
    case 'menu-free':
      window.setTimeout(() => ui.openMenu('school'), 150);
      break;
    case 'crash':
      lessonInFlight();
      ui.crashActions = () => [
        { label: 'Debrief', primary: true, keys: ['Enter', 'NumpadEnter'], run: () => console.log('[crash] debrief') },
        { label: 'Try again from checkpoint', keys: ['KeyR'], run: () => console.log('[crash] retry') },
        { label: 'Restart lesson', run: () => console.log('[crash] restart') },
      ];
      ctx.events.emit('crash', { reason: 'nose gear collapsed on landing' });
      break;
    default:
      school.open(screen as Parameters<SchoolUi['open']>[0]);
  }
  if (screen === 'logbook' && params.get('page') === '0') {
    // Page back with the pager buttons (the screen re-renders on each click), as a user would.
    for (let i = 0; i < 10; i++) {
      const prev = Array.from(document.querySelectorAll<HTMLButtonElement>('.sc-pager button')).find((b) => b.textContent === '◀');
      if (!prev || prev.disabled) break;
      prev.click();
    }
  }
});
