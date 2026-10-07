// Personas (section 1.4): the instructor (Kate Mercer, FI(A); name editable) and the examiner (David Hale).
// Both are fictional. The voice preferences are consumed by speech/voices.ts (pickVoice).

import type { Lesson } from '../types';

export interface PersonaDef {
  id: Lesson['persona'];
  name: string;              // 'Kate Mercer'
  title: string;             // 'FI(A)'
  /** Logbook signature, 'K. Mercer FI(A)'. */
  signature: string;
  /** Voice preference, first match wins: BCP-47 prefixes with an optional gender hint from the voice name. */
  voicePrefs: { lang: string; gender?: 'female' | 'male' }[];
  /** With a single available voice (examiner): pitch and rate factor. */
  fallbackPitch: number; fallbackRate: number;
}

export const PERSONAS: Readonly<Record<Lesson['persona'], PersonaDef>> = {
  instructor: {
    id: 'instructor',
    name: 'Kate Mercer',
    title: 'FI(A)',
    signature: 'K. Mercer FI(A)',
    // en-GB female, en-AU, en-NZ, en-IE, any en-* female, any en-*.
    voicePrefs: [
      { lang: 'en-GB', gender: 'female' }, { lang: 'en-AU' }, { lang: 'en-NZ' }, { lang: 'en-IE' },
      { lang: 'en', gender: 'female' }, { lang: 'en' },
    ],
    fallbackPitch: 1,
    fallbackRate: 1,
  },
  examiner: {
    id: 'examiner',
    name: 'David Hale',
    title: 'Examiner',
    signature: 'D. Hale, Examiner',
    // en-GB male, en-US male, any other English voice (pickVoice prefers one the instructor would not get).
    voicePrefs: [{ lang: 'en-GB', gender: 'male' }, { lang: 'en-US', gender: 'male' }, { lang: 'en', gender: 'male' }, { lang: 'en' }],
    fallbackPitch: 0.85,
    fallbackRate: 0.92,
  },
};

/** The logbook signature for an edited instructor name: 'Jo Bloggs' -> 'J. Bloggs FI(A)'. */
export function signatureFor(name: string, title: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return title;
  const sig = parts.length === 1 ? parts[0] : `${parts[0].charAt(0).toUpperCase()}. ${parts.slice(1).join(' ')}`;
  return `${sig} ${title}`;
}
