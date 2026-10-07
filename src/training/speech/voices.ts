// Voice selection by persona preference (section 1.4) or the player's choice.
//
// The Web Speech API does not report a voice's gender, so it is inferred from the voice name: explicit words
// ("Google UK English Female", espeak-ng's "+f3" variants) first, then a table of the common platform voice
// names (Windows, macOS, Chrome OS, Android, Edge "Online (Natural)"). Unknown names match only the
// gender-less preferences, which every persona ends with.

import { PERSONAS } from '../content/personas';
import type { Lesson, VoiceProfile } from '../types';

/** The subset of SpeechSynthesisVoice that selection needs (fakes in tests). */
export interface VoiceInfo { voiceURI: string; name: string; lang: string; default?: boolean }

const FEMALE_NAMES = new Set([
  'hazel', 'susan', 'libby', 'sonia', 'mia', 'maisie', 'kate', 'serena', 'stephanie', 'fiona', 'moira', 'tessa',
  'karen', 'catherine', 'natasha', 'emily', 'molly', 'samantha', 'victoria', 'allison', 'ava', 'zira',
  'jenny', 'aria', 'michelle', 'emma', 'clara', 'linda', 'heather', 'heera', 'neerja', 'veena', 'leah',
  'amy', 'joanna', 'kendra', 'kimberly', 'salli', 'ivy', 'olivia', 'nicole', 'aoife', 'sarah', 'isla',
]);
const MALE_NAMES = new Set([
  'george', 'ryan', 'thomas', 'oliver', 'daniel', 'arthur', 'william', 'james', 'liam', 'mitchell',
  'connor', 'alex', 'fred', 'tom', 'aaron', 'evan', 'nathan', 'david', 'mark', 'guy', 'eric', 'christopher',
  'roger', 'steffan', 'brian', 'matthew', 'joey', 'justin', 'russell', 'gordon', 'lee', 'rishi', 'prabhat',
  'ravi', 'sean', 'elliot', 'andrew', 'brandon', 'davis', 'tony', 'jason',
]);

export type Gender = 'female' | 'male';

/** Best guess at a voice's gender from its name; null when unknown. */
export function voiceGender(name: string): Gender | null {
  const n = name.toLowerCase();
  if (/\bfemale\b|\+f\d*\b/.test(n)) return 'female';
  if (/\bmale\b|\+m\d*\b/.test(n)) return 'male';
  for (const word of n.split(/[^a-z]+/)) {
    if (FEMALE_NAMES.has(word)) return 'female';
    if (MALE_NAMES.has(word)) return 'male';
  }
  return null;
}

/** 'en_GB' / 'EN-gb' -> 'en-gb'. */
function normLang(lang: string): string {
  return lang.replace(/_/g, '-').toLowerCase();
}

function langMatches(voiceLang: string, prefix: string): boolean {
  const v = normLang(voiceLang);
  const p = normLang(prefix);
  return v === p || v.startsWith(`${p}-`);
}

/** The first voice matching the persona's preference list (the default voice wins ties), or null. */
function byPreference(voices: readonly VoiceInfo[], persona: Lesson['persona'], exclude?: string): VoiceInfo | null {
  const pool = exclude === undefined ? voices : voices.filter((v) => v.voiceURI !== exclude);
  // Ties within one preference go to the platform default voice, then keep the browser's own order.
  const ordered = [...pool].sort((a, b) => Number(b.default ?? false) - Number(a.default ?? false));
  for (const pref of PERSONAS[persona].voicePrefs) {
    const hit = ordered.find((v) => langMatches(v.lang, pref.lang) && (pref.gender === undefined || voiceGender(v.name) === pref.gender));
    if (hit) return hit;
  }
  return null;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/**
 * Pick a voice: the player's `choice` (voiceURI) when present, else the persona's preference list. When only
 * one voice exists, the examiner gets pitch 0.85 and rate 0.92 x the setting.
 *
 * "Only one voice" is read as "no English voice other than the instructor's": the examiner then shares the
 * instructor's voice and the pitch and rate set him apart. With no English voice at all the browser's default
 * voice is used (voiceURI null) with the persona's language.
 */
export function pickVoice(voices: readonly VoiceInfo[], persona: Lesson['persona'], choice: string | null, settings: { rate: number; volume: number }): VoiceProfile {
  const def = PERSONAS[persona];
  const rate = clamp(settings.rate, 0.8, 1.3);
  const volume = clamp(settings.volume, 0, 1);
  const chosen = choice !== null ? voices.find((v) => v.voiceURI === choice) : undefined;
  if (chosen) return { voiceURI: chosen.voiceURI, lang: chosen.lang, rate, pitch: 1, volume };

  let voice = byPreference(voices, persona);
  let distinct = true;
  if (persona === 'examiner') {
    // "Any other English voice": prefer one the instructor would not be given.
    const instructorVoice = byPreference(voices, 'instructor');
    if (instructorVoice && voice?.voiceURI === instructorVoice.voiceURI) {
      const other = byPreference(voices, 'examiner', instructorVoice.voiceURI);
      if (other) voice = other;
      else distinct = false;
    }
    if (!voice) distinct = false;
  }
  const pitch = distinct ? 1 : def.fallbackPitch;
  const rateOut = distinct ? rate : clamp(rate * def.fallbackRate, 0.5, 2);
  if (!voice) return { voiceURI: null, lang: def.voicePrefs[0].lang, rate: rateOut, pitch, volume };
  return { voiceURI: voice.voiceURI, lang: voice.lang, rate: rateOut, pitch, volume };
}
