// Shared fixtures for the grading and career tests: a hand-driven EvalContext over the real predicate
// compiler and training bus, a minimal aircraft type, and builders of results and career files.

import { TrainingBus } from '../../src/training/engine/bus';
import { STANDARDS } from '../../src/training/grading/standards';
import { defaultSettings } from '../../src/training/career/defaults';
import type {
  AircraftTypeDef, AuthorityId, EvalContext, SignalId, ExerciseDef, ExerciseResult, Grade, Lesson, LessonResult, SignalDef,
  SignalFrame, Standard, TrainingSave,
} from '../../src/training/types';

const ANGLES = new Set(['hdgDeg', 'hdgTrueDeg', 'trackDeg']);

/** Only what the graders read; everything else is filler of the right type. */
export const TEST_AIRCRAFT = {
  id: 'c172s', name: 'Test 172', icaoType: 'C172', registration: 'N172FS', classRating: 'SEP',
  vspeeds: { Vs0: 40, Vs1: 48, Vr: 55, Vx: 62, Vy: 74, Vcc: 85, Vglide: 68, Va: 105, Vfe10: 110, VfeFull: 85, Vno: 129, Vne: 163,
    Vapp: 70, VappFlapsUp: 75, Vref: 65, VshortField: 61, Vcruise: 105, Vslow: 55, VsteepTurn: 95, Vdescent: 90, Vdownwind: 90, Vtaxi: 15 },
  settings: { patternAglFt: 1000, cruiseRpm: 2300, descentRpm: 1900, circuitRpm: 2200, runupRpm: 1800, magDropMaxRpm: 150,
    magDiffMaxRpm: 50, approachFlapLever: 1, takeoffFlapLever: 0, shortFieldFlapLever: 1 / 3, maxDemoCrosswindKt: 15 },
  flapDetentsDeg: [0, 10, 20, 30], flapLeverForDeg: { 0: 0, 10: 1 / 3, 20: 2 / 3, 30: 1 },
  limits: { gPos: 3.8, gNeg: -1.52, maxDemoCrosswindKt: 15 },
  checklists: {},
  envelope: {
    maxBankDeg: 60, maxPitchUpDeg: 25, maxPitchDownDeg: -25, maxKias: 140, maxG: 3.3, minG: 0, minAglFt: 1000,
    lowAndSlow: { aglFt: 300, belowKias: 53 }, maxSinkFpmBelow200: 1000, stallAllowed: false, runwayExcursionM: 13,
  },
} as unknown as AircraftTypeDef;

/** A mutable context the test advances by hand: set frame values, then tick(dt). */
export class Ctx implements EvalContext {
  frame: SignalFrame = {};
  vars: Record<string, number> = {};
  readonly aircraft = TEST_AIRCRAFT;
  readonly fieldElevFt = 394;
  readonly standards = STANDARDS;
  authority: AuthorityId;
  standard: Standard;
  readonly events = new TrainingBus();
  stepMark = 0;
  stepT = 0;
  dt = 0;
  simT: number;
  pilot: 'student' | 'instructor' = 'student';
  speechIdle = true;
  grades: Record<string, Grade | null> = {};

  constructor(o: { authority?: AuthorityId; standard?: Standard; simT?: number } = {}) {
    this.authority = o.authority ?? 'easa';
    this.standard = o.standard ?? 'training';
    this.simT = o.simT ?? 0;
  }

  signalDef(id: SignalId): SignalDef | undefined {
    return { id, kind: ANGLES.has(id) ? 'angle' : 'number', unit: '', hyst: 0, describe: id };
  }

  exerciseGrade(id: string): Grade | null {
    return this.grades[id] ?? null;
  }

  /** Step entry: reset step time and take the bus mark. */
  enterStep(): void {
    this.stepT = 0;
    this.stepMark = this.events.mark();
  }

  /** Advance time by dt after setting `values` (merged into the frame). */
  tick(dt: number, values: SignalFrame = {}): void {
    Object.assign(this.frame, values);
    this.dt = dt;
    this.simT += dt;
    this.stepT += dt;
  }
}

export const ex = (id: string, mode: ExerciseDef['mode'], standard: Standard, o: Partial<ExerciseDef> = {}): ExerciseDef =>
  ({ id, title: o.title ?? id, skill: o.skill ?? 'climb', mode, standard, required: o.required ?? mode === 'assessed', weight: o.weight ?? (mode === 'assessed' ? 2 : 1), ...o });

/** A minimal lesson: only the fields grading and progression read are meaningful. */
export function lesson(o: Partial<Lesson> & { id: string }): Lesson {
  return {
    version: 1, number: 1, title: `Lesson ${o.id}`, syllabusRef: { easa: 'Ex 1', faa: 'ACS I' }, stage: 'handling', kind: 'dual',
    persona: 'instructor', requires: [], aircraft: 'any', estMinutes: 10,
    start: { kind: 'scenario', id: 'cruise' }, weather: { preset: 'calm' },
    rules: { coachLevel: 'full', autopilot: 'forbidden', maxTimeScale: 1, instructorSaves: true, maxDurationS: 1200 },
    briefing: { aim: '', points: [], numbers: [], tolerances: [], airmanship: [], keys: [], spoken: 'x' },
    exercises: [], flow: [],
    ...o,
  };
}

export function exerciseResult(id: string, grade: Grade | null, o: Partial<ExerciseResult> = {}): ExerciseResult {
  return { exerciseId: id, title: id, mode: 'assessed', standard: 'test', grade, testGrade: grade, criteria: [], attempts: 1, interventions: 0, faults: [], ...o };
}

export function lessonResult(lessonId: string, o: Partial<LessonResult> = {}): LessonResult {
  return {
    lessonId, lessonVersion: 1, attemptId: `${lessonId}-a1`, authority: 'easa',
    startedAt: '2026-09-01T10:00:00.000Z', endedAt: '2026-09-01T10:20:00.000Z',
    outcome: 'competent', stars: 2, exercises: [], interventions: 0, handbacks: 0, phaseRetries: 0,
    flags: { calmAir: false, kbdAssists: true, instructorSaves: true, inputDevice: 'keyboard' },
    weatherLine: 'Wind 090/7', flight: { blockS: 900, airborneS: 800, nightS: 0, instrumentS: 0, landingsDay: 1, landingsNight: 0, takeoffs: 1 },
    debrief: { strength: 's', main: 'm', next: 'n', spoken: ['x'] }, traceId: null,
    ...o,
  };
}

export function newSave(o: Partial<TrainingSave> = {}): TrainingSave {
  return {
    format: 'fs-training', schema: 1, createdAt: '2026-09-01T09:00:00.000Z', updatedAt: '2026-09-01T09:00:00.000Z', appBuild: 'test',
    profile: { studentName: 'Ann Pilot', instructorName: 'Kate Mercer', licenceNo: 'FBL-0421', experienced: false },
    settings: defaultSettings(), progress: {}, skills: {}, endorsements: [], logbook: [], results: {}, bests: {}, testHistory: [],
    records: { safeLandings: 0 },
    ...o,
  };
}
