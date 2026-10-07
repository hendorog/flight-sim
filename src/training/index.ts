// Public barrel of the Flight School (src/training). Shell code (Simulator, UI, scripts) imports from here;
// modules inside src/training import each other by path to keep the dependency graph explicit.
//
// TrainingSystem is deliberately not re-exported: it pulls in the DOM-facing school UI, and this barrel must
// stay importable from node tests. Import it from './TrainingSystem'.

export * from './types';

// Lesson-authoring builders, namespaced (their short names - v, vs, all, any, end - would collide).
export * as dsl from './engine/dsl';

// Module 1: telemetry, geometry, predicates, events
export { Telemetry } from './telemetry/telemetry';
export { createCoreProvider } from './telemetry/providers/core';
export { createGeoProvider } from './telemetry/providers/geo';
export { createNavProvider } from './telemetry/providers/nav';
export { AREAS } from './geo/areas';
export { classifyCircuitLeg } from './geo/circuit';
export { legGeometry, type LegGeometry } from './geo/route';
export { compile } from './engine/predicates';
export { resolveRef, resolveSig, resolveTol } from './engine/refs';
export { DerivedEventDetector, LandingDetector, touchdownData } from './engine/events';
export { TrainingBus } from './engine/bus';

// Module 2: grading and career
export { STANDARDS, STANDARD_NOTES } from './grading/standards';
export { HoldAccumulator, normalisedError, type HoldSummary } from './grading/accumulators';
export { Grader, aggregateExercise, gradeHold, gradeSample, type GraderOptions } from './grading/grade';
export { diagnose } from './grading/patterns';
export { gradeLanding, type LandingGradeOptions } from './grading/landing';
export { StallGrader } from './grading/stall';
export { UnusualAttitudeGrader } from './grading/unusual';
export { lessonOutcome, lessonStars, overallImpression, type OutcomeInput } from './grading/results';
export { buildDebrief } from './grading/debrief';
export { TraceRecorder, decodeTrace, encodeTrace } from './grading/trace';
export { TRAINING_KEY, TrainingStore, mergeSaves, type ImportPreview, type StoreStatus } from './career/store';
export { validateTrainingBlock, validateTrainingSave, type ValidatedSave } from './career/validate';
export { MIGRATIONS, TRAINING_SCHEMA, migrate } from './career/migrations';
export { applyResult, lessonStatuses, missingPrerequisites, nextLesson, rank, type ApplyResultOutput } from './career/progress';
export { totals } from './career/totals';
export { FlightTimer, logbookEntryFor } from './career/logbook';
export { addBest, medalFor, scoreChallenge, type ChallengeInputs } from './career/challenges';

// Module 3: speech
export { SpeechScheduler } from './speech/scheduler';
export { WebSpeechBackend, estimateSpeechS } from './speech/webSpeech';
export { CaptionBackend } from './speech/captionBackend';
export { pickVoice, type VoiceInfo } from './speech/voices';
export { render, type RenderContext, type Rendered } from './speech/phraseology';
export { PERSONAS, type PersonaDef } from './content/personas';

// Module 4: copilot, aircraft, demos (buildStart / baseScenario live in src/sim/starts.ts)
export { InstructorPilot, type CopilotMode, type RecoveryKind } from './copilot/instructorPilot';
export { C172S } from './aircraft/c172s';
export {
  DEFAULT_AIRCRAFT, getAircraftType, hasAircraftType, listAircraftTypes, registerAircraftType, SCHOOL_AIRCRAFT, schoolSupports,
} from './aircraft/registry';
export { DEMOS } from './content/demos';
export { baseScenario, buildStart, type StartRefResolver } from '../sim/starts';

// Module 5: runner, authority, coach, safety, checklists
export { LessonRunner, type RunPhase, type RunnerDeps, type RunnerHost } from './engine/runner';
export { AuthorityFsm, type AuthorityUpdate, type HandoverState } from './engine/authority';
export { Coach, type CoachDeps, type CoachRemark } from './engine/coach';
export { SafetyMonitor, type SafetyBreach } from './engine/safety';
export { ChecklistRunner, type ChecklistItemState } from './engine/checklists';
export { bindPreset } from './content/coachPresets';

// Module 6: content
export { SYLLABUS, CHALLENGES, lessonById } from './content/syllabus/index';
export { LINES } from './content/lines';
export { WEATHER_PRESETS, buildWeather, weatherLine, type WeatherPreset } from './content/weatherPresets';
export { validateLesson, validateSyllabus, type LintContext } from './content/validate';
