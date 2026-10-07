// Hand-written guards for the career file and the snapshot's training block (style of resume.ts
// validateSnapshot). Invalid entities (one logbook line, one result) are dropped with a reason, not the file;
// settings fields are reset to their defaults one by one. Only a value that is not a career file at all
// (wrong format, other schema, no profile) is rejected.

import { validateSnapshot } from '../../sim/resume';
import type {
  CheckpointBlob, ExerciseResult, FlightTimerState, FlightTimes, Grade, LessonProgress, LessonResult, LogbookEntry,
  RunSnapshot, StartSpec, TrainingResumeBlock, TrainingSave, TrainingSettings, ChallengeBest,
} from '../types';
import { DEFAULT_INSTRUCTOR, defaultSettings } from './defaults';
import { TRAINING_SCHEMA } from './migrations';

export interface ValidatedSave {
  save: TrainingSave;
  /** Human-readable reasons for dropped entities ("logbook[3]: bad date"). */
  dropped: string[];
}

// ---- primitives ----------------------------------------------------------------------------------------

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isBool = (v: unknown): v is boolean => typeof v === 'boolean';
const isGrade = (v: unknown): v is Grade => v === 1 || v === 2 || v === 3 || v === 4;
const isGradeOrNull = (v: unknown): v is Grade | null => v === null || isGrade(v);
const isDate = (v: unknown): v is string => isStr(v) && !Number.isNaN(Date.parse(v));
const oneOf = <T extends string>(v: unknown, xs: readonly T[]): v is T => isStr(v) && (xs as readonly string[]).includes(v);

const OUTCOMES = ['competent', 'notYet', 'incomplete', 'abandoned', 'crashed', 'testPass', 'testPartial', 'testFail'] as const;
const TEST_OUTCOMES = ['testPass', 'testPartial', 'testFail'] as const;
const MODES = ['demo', 'practice', 'assessed'] as const;
const STANDARDS = ['training', 'test', 'commercial'] as const;
const SEVERITIES = ['minor', 'major', 'critical'] as const;
const CRITERION_KINDS = ['hold', 'peak', 'final', 'atEvent', 'check', 'binary'] as const;
const PATTERNS = ['ok', 'biasHigh', 'biasLow', 'oscillation', 'drift', 'late'] as const;
const ROLES = ['dual', 'solo', 'pic', 'test'] as const;
const STAMPS = ['FIRST SOLO', 'SKILL TEST PASS', 'NIGHT'] as const;
const AUTHORITIES = ['easa', 'faa'] as const;
const STATUSES = ['locked', 'available', 'competent'] as const;
const DEVICES = ['keyboard', 'mouse', 'hardware'] as const;
const START_KINDS = ['scenario', 'ground', 'air', 'final', 'circuit', 'attitude'] as const;

// ---- entities ------------------------------------------------------------------------------------------

export function isFlightTimes(v: unknown): v is FlightTimes {
  return isObj(v) && ['blockS', 'airborneS', 'nightS', 'instrumentS', 'landingsDay', 'landingsNight', 'takeoffs'].every((k) => isNum(v[k]) && (v[k] as number) >= 0);
}

const isTol = (v: unknown): boolean => isObj(v) && isNum(v.minus) && isNum(v.plus);

function isCriterionResult(v: unknown): boolean {
  if (!isObj(v)) return false;
  if (!isStr(v.id) || !isStr(v.label) || !oneOf(v.kind, CRITERION_KINDS) || !isBool(v.required) || !isBool(v.safety)) return false;
  if (!isGrade(v.grade) || !isGrade(v.testGrade) || !isNum(v.within) || !isNum(v.maxN)) return false;
  if (!isNum(v.excursions) || !isNum(v.longestOutS) || !oneOf(v.pattern, PATTERNS) || !isStr(v.detail)) return false;
  if (v.target !== undefined && !isNum(v.target) && v.target !== null) return false;
  if (v.tol !== undefined && !isTol(v.tol)) return false;
  if (v.testTol !== undefined && !isTol(v.testTol)) return false;
  return v.worst === undefined || (isObj(v.worst) && isNum(v.worst.value) && isNum(v.worst.dev) && isNum(v.worst.atS));
}

const isFault = (v: unknown): boolean => isObj(v) && isStr(v.id) && oneOf(v.severity, SEVERITIES) && isNum(v.atS);

export function isExerciseResult(v: unknown): v is ExerciseResult {
  return isObj(v) && isStr(v.exerciseId) && isStr(v.title) && oneOf(v.mode, MODES) && oneOf(v.standard, STANDARDS)
    && isGradeOrNull(v.grade) && isGradeOrNull(v.testGrade) && Array.isArray(v.criteria) && v.criteria.every(isCriterionResult)
    && isNum(v.attempts) && isNum(v.interventions) && Array.isArray(v.faults) && v.faults.every(isFault);
}

const isFlags = (v: unknown): boolean => isObj(v) && isBool(v.calmAir) && isBool(v.kbdAssists) && isBool(v.instructorSaves) && oneOf(v.inputDevice, DEVICES);

export function isLessonResult(v: unknown): v is LessonResult {
  if (!isObj(v)) return false;
  if (!isStr(v.lessonId) || !isNum(v.lessonVersion) || !isStr(v.attemptId) || !oneOf(v.authority, AUTHORITIES)) return false;
  if (!isDate(v.startedAt) || !isDate(v.endedAt) || !oneOf(v.outcome, OUTCOMES) || ![0, 1, 2, 3].includes(v.stars as number)) return false;
  if (!Array.isArray(v.exercises) || !v.exercises.every(isExerciseResult)) return false;
  if (!isNum(v.interventions) || !isNum(v.handbacks) || !isNum(v.phaseRetries) || !isFlags(v.flags)) return false;
  if (!isStr(v.weatherLine) || !isFlightTimes(v.flight)) return false;
  const d = v.debrief;
  if (!isObj(d) || !isStr(d.strength) || !isStr(d.main) || !isStr(d.next) || !Array.isArray(d.spoken) || !d.spoken.every(isStr)) return false;
  if (v.traceId !== null && !isStr(v.traceId)) return false;
  return v.safeLandings === undefined || isNum(v.safeLandings);
}

export function isLogbookEntry(v: unknown): v is LogbookEntry {
  if (!isObj(v)) return false;
  if (!isStr(v.id) || v.id === '' || !isDate(v.date) || !isStr(v.aircraftType) || !isStr(v.registration)) return false;
  if (v.from !== 'KFBL' || v.to !== 'KFBL' || !oneOf(v.role, ROLES) || !isFlightTimes(v.times)) return false;
  if (v.lessonId !== null && !isStr(v.lessonId)) return false;
  if (v.lessonVersion !== null && !isNum(v.lessonVersion)) return false;
  if (!isStr(v.exercise) || !(oneOf(v.outcome, OUTCOMES) || v.outcome === 'freeFlight')) return false;
  if (v.stars !== null && !isNum(v.stars)) return false;
  if (!isStr(v.remarks) || (v.signedBy !== null && !isStr(v.signedBy))) return false;
  if (v.stamp !== undefined && !oneOf(v.stamp, STAMPS)) return false;
  return v.traceId === undefined || isStr(v.traceId);
}

export function isLessonProgress(v: unknown): v is LessonProgress {
  if (!isObj(v) || !oneOf(v.status, STATUSES) || !isNum(v.attempts) || !isNum(v.bestStars) || !isNum(v.lessonVersion)) return false;
  if (v.lastOutcome !== null && !oneOf(v.lastOutcome, OUTCOMES)) return false;
  if (!isObj(v.exercises)) return false;
  for (const e of Object.values(v.exercises)) {
    if (!isObj(e) || !isGrade(e.best) || !isGrade(e.last) || (e.competentAt !== undefined && !isDate(e.competentAt))) return false;
  }
  if (v.bestTraceId !== undefined && !isStr(v.bestTraceId)) return false;
  return v.completedAt === undefined || isDate(v.completedAt);
}

const isChallengeBest = (v: unknown): v is ChallengeBest =>
  isObj(v) && isNum(v.score) && isDate(v.at) && oneOf(v.authority, AUTHORITIES) && isFlags(v.flags) && (v.traceId === undefined || isStr(v.traceId));

function settingsFrom(v: unknown, dropped: string[]): TrainingSettings {
  const d = defaultSettings();
  if (!isObj(v)) {
    dropped.push('settings: reset to defaults');
    return d;
  }
  const pick = <T>(key: string, ok: (x: unknown) => boolean, fallback: T, src: Record<string, unknown> = v, path = 'settings'): T => {
    if (ok(src[key])) return src[key] as T;
    if (src[key] !== undefined) dropped.push(`${path}.${key}: reset to default`);
    return fallback;
  };
  const voice = isObj(v.voice) ? v.voice : {};
  if (!isObj(v.voice)) dropped.push('settings.voice: reset to defaults');
  const strOrNull = (x: unknown): boolean => x === null || isStr(x);
  const inRange = (lo: number, hi: number) => (x: unknown): boolean => isNum(x) && x >= lo && x <= hi;
  return {
    authority: pick('authority', (x) => oneOf(x, AUTHORITIES), d.authority),
    talkativeness: pick('talkativeness', (x) => oneOf(x, ['quiet', 'normal', 'chatty'] as const), d.talkativeness),
    voice: {
      instructor: pick('instructor', strOrNull, d.voice.instructor, voice, 'settings.voice'),
      examiner: pick('examiner', strOrNull, d.voice.examiner, voice, 'settings.voice'),
      rate: pick('rate', inRange(0.5, 2), d.voice.rate, voice, 'settings.voice'),
      volume: pick('volume', inRange(0, 1), d.voice.volume, voice, 'settings.voice'),
      captions: pick('captions', isBool, d.voice.captions, voice, 'settings.voice'),
      captionsOnly: pick('captionsOnly', isBool, d.voice.captionsOnly, voice, 'settings.voice'),
    },
    instructorSaves: pick('instructorSaves', isBool, d.instructorSaves),
    liveBars: pick('liveBars', isBool, d.liveBars),
    autoAck: pick('autoAck', isBool, d.autoAck),
    logFreeFlights: pick('logFreeFlights', isBool, d.logFreeFlights),
  };
}

/** Keep the valid members of a record of entities; drop the rest with a reason. */
function recordOf<T>(v: unknown, path: string, ok: (x: unknown) => x is T, dropped: string[]): Record<string, T> {
  const out: Record<string, T> = {};
  if (!isObj(v)) {
    if (v !== undefined) dropped.push(`${path}: not an object`);
    return out;
  }
  for (const [k, x] of Object.entries(v)) {
    if (ok(x)) out[k] = x;
    else dropped.push(`${path}.${k}: invalid`);
  }
  return out;
}

function arrayOf<T>(v: unknown, path: string, ok: (x: unknown) => x is T, dropped: string[]): T[] {
  if (!Array.isArray(v)) {
    if (v !== undefined) dropped.push(`${path}: not a list`);
    return [];
  }
  const out: T[] = [];
  v.forEach((x, i) => {
    if (ok(x)) out.push(x);
    else dropped.push(`${path}[${i}]: invalid`);
  });
  return out;
}

/** Null when the value is not a TrainingSave at all (wrong format, schema newer than supported, garbage). */
export function validateTrainingSave(v: unknown): ValidatedSave | null {
  if (!isObj(v) || v.format !== 'fs-training' || v.schema !== TRAINING_SCHEMA) return null;
  const p = v.profile;
  if (!isObj(p) || !isStr(p.studentName)) return null;
  const dropped: string[] = [];
  const now = new Date().toISOString();
  const date = (k: 'createdAt' | 'updatedAt'): string => {
    if (isDate(v[k])) return v[k] as string;
    dropped.push(`${k}: invalid, reset`);
    return now;
  };
  const save: TrainingSave = {
    format: 'fs-training', schema: 1,
    createdAt: date('createdAt'), updatedAt: date('updatedAt'),
    appBuild: isStr(v.appBuild) ? v.appBuild : '',
    profile: {
      studentName: p.studentName,
      instructorName: isStr(p.instructorName) ? p.instructorName : DEFAULT_INSTRUCTOR,
      licenceNo: isStr(p.licenceNo) ? p.licenceNo : 'FBL-0000',
      experienced: isBool(p.experienced) ? p.experienced : false,
    },
    settings: settingsFrom(v.settings, dropped),
    progress: recordOf(v.progress, 'progress', isLessonProgress, dropped),
    skills: recordOf(v.skills, 'skills', (x): x is { last5: Grade[] } => isObj(x) && Array.isArray(x.last5) && x.last5.length <= 5 && x.last5.every(isGrade), dropped),
    endorsements: arrayOf(v.endorsements, 'endorsements',
      (x): x is TrainingSave['endorsements'][number] => isObj(x) && isStr(x.id) && isDate(x.at) && (x.lessonId === null || isStr(x.lessonId)), dropped),
    logbook: arrayOf(v.logbook, 'logbook', isLogbookEntry, dropped),
    results: {},
    bests: {},
    testHistory: arrayOf(v.testHistory, 'testHistory',
      (x): x is TrainingSave['testHistory'][number] => isObj(x) && isDate(x.at) && oneOf(x.outcome, TEST_OUTCOMES) && Array.isArray(x.failedSections) && x.failedSections.every(isNum), dropped),
  };
  if (isObj(v.results)) {
    for (const [k, list] of Object.entries(v.results)) save.results[k] = arrayOf(list, `results.${k}`, isLessonResult, dropped);
  } else if (v.results !== undefined) dropped.push('results: not an object');
  if (isObj(v.bests)) {
    for (const [k, list] of Object.entries(v.bests)) save.bests[k] = arrayOf(list, `bests.${k}`, isChallengeBest, dropped);
  } else if (v.bests !== undefined) dropped.push('bests: not an object');
  // A duplicate logbook id would make merges and remarks edits ambiguous: keep the first.
  const ids = new Set<string>();
  save.logbook = save.logbook.filter((e, i) => {
    if (ids.has(e.id)) { dropped.push(`logbook[${i}]: duplicate id`); return false; }
    ids.add(e.id);
    return true;
  });
  if (v.records !== undefined) {
    if (isObj(v.records) && isNum(v.records.safeLandings)) save.records = { safeLandings: v.records.safeLandings };
    else dropped.push('records: invalid');
  }
  return { save, dropped };
}

// ---- the snapshot's training block ----------------------------------------------------------------------

export function isFlightTimerState(v: unknown): v is FlightTimerState {
  return isObj(v) && isFlightTimes(v.times) && isBool(v.blockOn) && isBool(v.airborne) && isNum(v.offGroundS) && isNum(v.onGroundS);
}

export function isRunSnapshot(v: unknown): v is RunSnapshot {
  if (!isObj(v)) return false;
  for (const k of ['lessonId', 'attemptId', 'phaseId', 'stepId', 'startedAt']) if (!isStr(v[k])) return false;
  for (const k of ['lessonVersion', 'phaseRepeat', 'stepAttempt', 'interventions', 'handbacks', 'phaseRetries', 'elapsedSimS', 'weatherSeed']) if (!isNum(v[k])) return false;
  if (!isObj(v.vars) || !Object.values(v.vars).every(isNum)) return false;
  if (!oneOf(v.authority, ['student', 'instructor'] as const)) return false;
  if (v.holds !== null && !isObj(v.holds)) return false;
  if (!isObj(v.exercises) || !Object.values(v.exercises).every((l) => Array.isArray(l) && l.every(isExerciseResult))) return false;
  if (!Array.isArray(v.faults) || !v.faults.every(isFault)) return false;
  return isFlightTimerState(v.flightTimer);
}

const isStartSpec = (v: unknown): v is StartSpec => isObj(v) && oneOf(v.kind, START_KINDS);

export function validateCheckpoint(v: unknown): CheckpointBlob | null {
  if (!isObj(v) || !isNum(v.traceOffset) || v.traceOffset < 0 || !isRunSnapshot(v.runner)) return null;
  const flight = validateSnapshot(v.flight);
  return flight ? { flight, runner: v.runner, traceOffset: v.traceOffset } : null;
}

/** FlightSnapshot.training (schema 2); null when absent or invalid (the flight then resumes as free flight). */
export function validateTrainingBlock(v: unknown): TrainingResumeBlock | null {
  if (!isObj(v) || !isStr(v.lessonId) || !isNum(v.lessonVersion) || !isRunSnapshot(v.run) || !isStartSpec(v.start)) return null;
  if (v.run.lessonId !== v.lessonId) return null;
  let checkpoint: CheckpointBlob | null = null;
  if (v.checkpoint !== null && v.checkpoint !== undefined) {
    checkpoint = validateCheckpoint(v.checkpoint);
    if (!checkpoint) return null;
  }
  const block: TrainingResumeBlock = { lessonId: v.lessonId, lessonVersion: v.lessonVersion, run: v.run, start: v.start, checkpoint };
  if (v.aircraftId !== undefined) {
    if (!isStr(v.aircraftId)) return null;
    block.aircraftId = v.aircraftId;
  }
  return block;
}
