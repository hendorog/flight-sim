// Defaults of a new career file (section 1.6 settings table). Shared by the store (new profiles) and the
// validator (fields of an older or hand-edited file that are missing or invalid are reset to these).

import type { AuthorityId, TrainingSettings } from '../types';

export function defaultSettings(authority: AuthorityId = 'easa'): TrainingSettings {
  return {
    authority,
    talkativeness: 'normal',
    voice: { instructor: null, examiner: null, rate: 1, volume: 0.9, captions: true, captionsOnly: false },
    instructorSaves: true,
    liveBars: true,
    autoAck: false,
    logFreeFlights: true,
  };
}

/** Default instructor name (spec 1.4: "Kate Mercer, FI(A)", editable). */
export const DEFAULT_INSTRUCTOR = 'Kate Mercer';
/** The examiner persona (spec 1.4); not editable. */
export const EXAMINER_NAME = 'David Hale';
export const DEFAULT_STUDENT = 'Student pilot';
