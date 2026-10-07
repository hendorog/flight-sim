// View-model types of the school screens. The models the runner publishes are part of the training contract
// (src/training/types.ts) and re-exported here; the screen-local types below are what SchoolUi needs from
// TrainingSystem beyond the TrainingUiPort (the career for the hub screens, and a few store/speech services).

import type {
  AircraftTypeId, AuthorityId, CareerTotals, ChallengeDef, Lesson, LessonProgress, LogbookEntry, TraceData, TrainingSave,
} from '../../training/types';

export type {
  AuthorityChip, BriefingModel, CardModel, CardTargetModel, DebriefModel, LessonStripModel, SchoolCommand,
  ToleranceChip, TrainingUiPort,
} from '../../training/types';

/** The modal screens of the school (section 5). */
export type SchoolScreen =
  | 'welcome' | 'home' | 'syllabus' | 'briefing' | 'debrief' | 'logbook' | 'licence' | 'settings' | 'challenges';

/** A synthesiser voice offered in the welcome card and settings (a SpeechSynthesisVoice subset). */
export interface SchoolVoice { voiceURI: string; name: string; lang: string }

/**
 * Everything the hub screens (home, syllabus, challenges, logbook, licence, settings, School menu tab) show.
 * TrainingSystem pushes a fresh one with SchoolUi.setCareer() whenever the save or the session changes.
 */
export interface SchoolCareer {
  /** The career file; null before the welcome card has created a profile. */
  save: TrainingSave | null;
  syllabus: readonly Lesson[];
  challenges: readonly ChallengeDef[];
  /** Authority for this session (`standard=` overrides the profile without saving). */
  authority: AuthorityId;
  /** TrainingStore.status, or 'unavailable' when there is no storage at all (banner on the home screen). */
  storage: 'ok' | 'memoryOnly' | 'readOnly' | 'unavailable';
  /** A checkpoint of an interrupted lesson exists: the home screen offers "Resume lesson". */
  resume: { lessonId: string; title: string } | null;
  voices: readonly SchoolVoice[];
  /** `unlock=1`: every lesson can be opened this session (practice credit only). */
  unlockAll?: boolean;
  /** Wall clock for the currency nudge (tests and screenshots pin it). Default: now. */
  now?: Date;
  /** (multi-aircraft) The type flown and the school's. Absent: the school's own type is flown. */
  aircraft?: SchoolAircraft;
}

/** The aircraft being flown, seen from the school: lessons are flown only in the school's type (decision D5). */
export interface SchoolAircraft {
  flown: { id: AircraftTypeId; name: string };
  /** Lessons can be flown in the flown type. */
  supported: boolean;
  /** The type the school offers to change to when `supported` is false. */
  school: { id: AircraftTypeId; name: string };
}

/** Career functions (module 2) the hub screens call. Injected so the dev page and tests can use fakes. */
export interface SchoolProgressFns {
  lessonStatuses(save: TrainingSave, syllabus: readonly Lesson[], authority: AuthorityId): Record<string, LessonProgress['status']>;
  missingPrerequisites(save: TrainingSave, lesson: Lesson, syllabus: readonly Lesson[], authority: AuthorityId): string[];
  nextLesson(save: TrainingSave, syllabus: readonly Lesson[], authority: AuthorityId): Lesson | null;
  rank(save: TrainingSave, authority: AuthorityId): string;
  totals(logbook: readonly LogbookEntry[]): CareerTotals;
}

/** What an import file holds, for the Replace / Merge choice (TrainingStore.previewImport). */
export interface SchoolImportPreview { studentName: string; lessonsCompetent: number; hours: number; landings: number }

/**
 * Services beyond SchoolCommand. Every one is optional except the progress functions (which default to the
 * real module-2 implementations); a missing service hides or disables its control rather than failing.
 */
export interface SchoolUiDeps extends SchoolProgressFns {
  /** A stored trace (logbook "View debrief", "Compare with best"). */
  loadTrace?(id: string): TraceData | null;
  /** Parse and validate an import file without writing anything; throws with a reason when invalid. */
  previewImport?(json: string): SchoolImportPreview;
  /** Speak a sample line with a voice (settings / welcome "Test voice"); null = the persona's default. */
  testVoice?(persona: Lesson['persona'], voiceURI: string | null): void;
  /** Profile fields that are not TrainingSettings (instructor name, "experienced pilot"). */
  updateProfile?(p: Partial<Pick<TrainingSave['profile'], 'studentName' | 'instructorName' | 'experienced'>>): void;
  /** Replay the debrief's spoken summary (debrief "Play"). */
  playDebrief?(lines: readonly string[]): void;
}

/** Where the cockpit panel is on screen (UISystem provides it from CockpitClicks). */
export interface SchoolViewHost {
  /** True in the cockpit view (instrument highlights and the hood only make sense there). */
  cockpit(): boolean;
  /** Client (CSS px) position of a panel pixel (src/instruments/layout.ts), or null when not projectable. */
  project(px: number, py: number): [number, number] | null;
}

/** Hood state (section 5.4): off, the instrument hood (mask above the glareshield), or eyes closed (full). */
export type HoodMode = 'off' | 'hood' | 'blackout';
