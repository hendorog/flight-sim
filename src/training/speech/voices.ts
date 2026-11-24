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
  'abigail', 'amber', 'ana', 'annette', 'ashley', 'ayanda', 'bella', 'carly', 'claire', 'cora', 'danielle',
  'elizabeth', 'ellen', 'elsie', 'eva', 'flo', 'freya', 'grandma', 'hollie', 'imani', 'joelle', 'kathy',
  'kim', 'luna', 'martha', 'monica', 'nancy', 'niamh', 'nicky', 'nikki', 'nora', 'ruth', 'sandy', 'sara',
  'shelley', 'tina', 'vicki', 'yan', 'zoe',
]);
const MALE_NAMES = new Set([
  'george', 'ryan', 'thomas', 'oliver', 'daniel', 'arthur', 'william', 'james', 'liam', 'mitchell',
  'connor', 'alex', 'fred', 'tom', 'aaron', 'evan', 'nathan', 'david', 'mark', 'guy', 'eric', 'christopher',
  'roger', 'steffan', 'brian', 'matthew', 'joey', 'justin', 'russell', 'gordon', 'lee', 'rishi', 'prabhat',
  'ravi', 'sean', 'elliot', 'andrew', 'brandon', 'davis', 'tony', 'jason',
  'abeo', 'alan', 'alfie', 'bryce', 'chilemba', 'eddy', 'elim', 'ethan', 'geraint', 'grandpa', 'gregory',
  'jacob', 'jacques', 'jamie', 'joe', 'john', 'junior', 'kevin', 'lukas', 'luke', 'martin', 'noah', 'norman',
  'ralph', 'reed', 'richard', 'rocko', 'sam', 'stephen', 'wayne',
]);

/** macOS novelty / musical voices that declare `en-US` but are unsuitable for cockpit or ATC speech. */
const NOVELTY_VOICES = new Set([
  'albert', 'bad news', 'bahh', 'bells', 'boing', 'bubbles', 'cellos', 'deranged', 'good news',
  'hysterical', 'jester', 'organ', 'pipe organ', 'princess', 'superstar', 'trinoids', 'whisper',
  'wobble', 'zarvox',
]);

export type Gender = 'female' | 'male';
export type RadioStation = 'tower' | 'ground' | 'atis';

/** Best guess at a voice's gender from its name; null when unknown. */
export function voiceGender(name: string): Gender | null {
  const n = name.toLowerCase();
  if (/\bfemale\b|\bwom[ae]n\b|\bgirl\b|\+f\d*\b/.test(n)) return 'female';
  if (/\bmale\b|\bm[ae]n\b|\bboy\b|\+m\d*\b/.test(n)) return 'male';
  // Chrome's unlabelled built-in US network voice is female.
  if (/\bgoogle us english\b/.test(n)) return 'female';
  for (const word of n.split(/[^a-z]+/)) {
    if (FEMALE_NAMES.has(word)) return 'female';
    if (MALE_NAMES.has(word)) return 'male';
  }
  return null;
}

function isSpeechVoice(v: VoiceInfo): boolean {
  const base = v.name.toLowerCase().replace(/\s*\(.*$/, '').trim();
  return !NOVELTY_VOICES.has(base);
}

/** English speech voices (excluding novelty voices unless no other English voice exists). */
function englishVoices(voices: readonly VoiceInfo[]): VoiceInfo[] {
  const en = voices.filter((v) => langMatches(v.lang, 'en'));
  const natural = en.filter(isSpeechVoice);
  return natural.length > 0 ? natural : en;
}

/** Interleave voices round-robin across regional language tags (`en-US`, `en-GB`, `en-AU`, ...) for accent variety. */
function spreadByLang(voices: readonly VoiceInfo[], preferredLangs: readonly string[] = []): VoiceInfo[] {
  const buckets = new Map<string, VoiceInfo[]>();
  for (const v of voices) {
    const k = normLang(v.lang);
    let b = buckets.get(k);
    if (!b) buckets.set(k, (b = []));
    b.push(v);
  }
  const keys = [...buckets.keys()].sort((a, b) => {
    const ia = preferredLangs.findIndex((p) => a === p || a.startsWith(`${p}-`));
    const ib = preferredLangs.findIndex((p) => b === p || b.startsWith(`${p}-`));
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  const out: VoiceInfo[] = [];
  let added = true;
  while (added) {
    added = false;
    for (const k of keys) {
      const b = buckets.get(k)!;
      if (b.length > 0) {
        out.push(b.shift()!);
        added = true;
      }
    }
  }
  return out;
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
  const clean = pool.filter(isSpeechVoice);
  const candidates = clean.length > 0 ? clean : pool;
  // Ties within one preference go to the platform default voice, then keep the browser's own order.
  const ordered = [...candidates].sort((a, b) => Number(b.default ?? false) - Number(a.default ?? false));
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

const STATION_LANGS = ['en-us', 'en-gb', 'en-au', 'en-ca', 'en-nz', 'en-ie'];
const TRAFFIC_LANGS = ['en-gb', 'en-us', 'en-au', 'en-ie', 'en-nz', 'en-ca', 'en-za', 'en-in'];

/**
 * Distinct controller / broadcast voices for Tower, Ground and ATIS (docs/atc.md):
 * male English voices first (spread across accents) so controllers contrast immediately with the cabin
 * instructor, then other non-instructor English voices; each station gets its own voice when available and
 * its own cadence and pitch when voices must be shared.
 */
export function pickStationVoice(
  voices: readonly VoiceInfo[],
  settings: { rate: number; volume: number },
  station: RadioStation = 'tower',
): VoiceProfile {
  const instructor = pickVoice(voices, 'instructor', null, settings);
  const volume = clamp(settings.volume, 0, 1);
  const en = englishVoices(voices);
  const nonInstructor = en.filter((v) => v.voiceURI !== instructor.voiceURI);
  const base = nonInstructor.length > 0 ? nonInstructor : en;
  const males = spreadByLang(base.filter((v) => voiceGender(v.name) === 'male'), STATION_LANGS);
  const neutral = spreadByLang(base.filter((v) => voiceGender(v.name) === null), STATION_LANGS);
  const females = spreadByLang(base.filter((v) => voiceGender(v.name) === 'female'), STATION_LANGS);
  const ordered = [...males, ...neutral, ...females];

  const rateMul = station === 'tower' ? 1.12 : station === 'ground' ? 1.05 : 1.02;
  const rate = clamp(settings.rate * rateMul, 0.8, 1.35);

  if (ordered.length === 0) {
    const fallbackLang = station === 'tower' ? 'en-US' : station === 'ground' ? 'en-GB' : 'en-AU';
    const fallbackPitch = station === 'tower' ? 0.82 : station === 'ground' ? 0.75 : 0.88;
    return { voiceURI: null, lang: fallbackLang, rate, pitch: fallbackPitch, volume };
  }

  const towerHit = ordered[0];
  const groundHit = ordered[1] ?? ordered[0];
  const atisHit = ordered[2] ?? ordered[0];

  if (station === 'tower') {
    const male = voiceGender(towerHit.name) === 'male';
    const pitch = male && towerHit.voiceURI !== instructor.voiceURI ? 0.96 : 0.82;
    return { voiceURI: towerHit.voiceURI, lang: towerHit.lang, rate, pitch, volume };
  }
  if (station === 'ground') {
    const shared = groundHit.voiceURI === towerHit.voiceURI || groundHit.voiceURI === instructor.voiceURI;
    const male = voiceGender(groundHit.name) === 'male';
    const pitch = shared ? 0.78 : male ? 0.92 : 0.90;
    return { voiceURI: groundHit.voiceURI, lang: groundHit.lang, rate, pitch, volume };
  }
  const shared = atisHit.voiceURI === towerHit.voiceURI || atisHit.voiceURI === groundHit.voiceURI || atisHit.voiceURI === instructor.voiceURI;
  const male = voiceGender(atisHit.name) === 'male';
  const pitch = shared ? 0.78 : male ? 0.90 : 0.86;
  return { voiceURI: atisHit.voiceURI, lang: atisHit.lang, rate, pitch, volume };
}

/** The home tower's voice (retained for callers expecting a single radio voice). */
export function pickRadioVoice(voices: readonly VoiceInfo[], settings: { rate: number; volume: number }): VoiceProfile {
  return pickStationVoice(voices, settings, 'tower');
}

interface TrafficSlot {
  want: Gender;
  rate: number;
  pitch: number;
  sharedPitch: number;
  lang: string;
}

/**
 * Sixteen pilot personas (~62 % male, ~38 % female, interleaved so consecutive aircraft contrast in gender,
 * accent, speaking pace and pitch).
 */
const TRAFFIC_SLOTS: readonly TrafficSlot[] = [
  { want: 'male', rate: 0.95, pitch: 0.92, sharedPitch: 0.82, lang: 'en-GB' },
  { want: 'female', rate: 1.08, pitch: 1.03, sharedPitch: 1.06, lang: 'en-US' },
  { want: 'male', rate: 1.18, pitch: 1.03, sharedPitch: 1.09, lang: 'en-US' },
  { want: 'male', rate: 0.91, pitch: 0.84, sharedPitch: 0.75, lang: 'en-AU' },
  { want: 'female', rate: 0.96, pitch: 0.94, sharedPitch: 0.90, lang: 'en-AU' },
  { want: 'male', rate: 1.06, pitch: 0.97, sharedPitch: 0.88, lang: 'en-IE' },
  { want: 'male', rate: 1.14, pitch: 0.90, sharedPitch: 1.14, lang: 'en-CA' },
  { want: 'female', rate: 1.15, pitch: 1.08, sharedPitch: 1.14, lang: 'en-IE' },
  { want: 'male', rate: 0.98, pitch: 0.88, sharedPitch: 0.79, lang: 'en-NZ' },
  { want: 'female', rate: 1.02, pitch: 0.98, sharedPitch: 0.86, lang: 'en-GB' },
  { want: 'male', rate: 1.21, pitch: 1.05, sharedPitch: 1.17, lang: 'en-US' },
  { want: 'male', rate: 0.93, pitch: 0.86, sharedPitch: 0.72, lang: 'en-GB' },
  { want: 'female', rate: 0.93, pitch: 1.05, sharedPitch: 1.11, lang: 'en-NZ' },
  { want: 'male', rate: 1.10, pitch: 0.94, sharedPitch: 0.85, lang: 'en-AU' },
  { want: 'female', rate: 1.12, pitch: 0.92, sharedPitch: 0.95, lang: 'en-CA' },
  { want: 'male', rate: 1.01, pitch: 1.01, sharedPitch: 1.04, lang: 'en-IE' },
];

/**
 * The voice of one of the circuit or area traffic's pilots (`variant`: aircraft speaker index): balances male and
 * female voices across regional English accents with per-pilot rate and pitch, keeping male voices in the traffic
 * rotation even on browsers that expose only one male TTS voice.
 */
export function pickTrafficVoice(voices: readonly VoiceInfo[], settings: { rate: number; volume: number }, variant: number): VoiceProfile {
  const slotIdx = ((Math.trunc(variant) % TRAFFIC_SLOTS.length) + TRAFFIC_SLOTS.length) % TRAFFIC_SLOTS.length;
  const slot = TRAFFIC_SLOTS[slotIdx];
  const rate = clamp(settings.rate * slot.rate, 0.78, 1.38);
  const volume = clamp(settings.volume, 0, 1);

  const en = englishVoices(voices);
  if (en.length === 0) {
    return { voiceURI: null, lang: slot.lang, rate, pitch: slot.sharedPitch, volume };
  }

  const instructor = pickVoice(voices, 'instructor', null, settings);
  const tower = pickStationVoice(voices, settings, 'tower');
  const ground = pickStationVoice(voices, settings, 'ground');
  const stationUris = new Set([tower.voiceURI, ground.voiceURI]);

  // Unused male voices first, then controller male voices so a 1-male-voice browser still has male traffic pilots.
  const allMales = en.filter((v) => voiceGender(v.name) === 'male');
  const males = [
    ...spreadByLang(allMales.filter((v) => !stationUris.has(v.voiceURI)), TRAFFIC_LANGS),
    ...spreadByLang(allMales.filter((v) => stationUris.has(v.voiceURI)), TRAFFIC_LANGS),
  ];

  // Neutral and non-instructor female voices first, then the instructor's voice last if needed.
  const rest = en.filter((v) => voiceGender(v.name) !== 'male');
  const nonMales = [
    ...spreadByLang(rest.filter((v) => v.voiceURI !== instructor.voiceURI && !stationUris.has(v.voiceURI)), TRAFFIC_LANGS),
    ...spreadByLang(rest.filter((v) => v.voiceURI !== instructor.voiceURI && stationUris.has(v.voiceURI)), TRAFFIC_LANGS),
    ...rest.filter((v) => v.voiceURI === instructor.voiceURI),
  ];

  let rank = 0;
  for (let i = 0; i < slotIdx; i++) if (TRAFFIC_SLOTS[i].want === slot.want) rank++;

  if (slot.want === 'male') {
    if (males.length > 0) {
      const hit = males[rank % males.length];
      const shared = stationUris.has(hit.voiceURI) || rank >= males.length;
      return { voiceURI: hit.voiceURI, lang: hit.lang, rate, pitch: shared ? slot.sharedPitch : slot.pitch, volume };
    }
    const hit = nonMales[slotIdx % nonMales.length];
    return { voiceURI: hit.voiceURI, lang: hit.lang, rate, pitch: Math.min(slot.sharedPitch, 0.84), volume };
  }

  if (nonMales.length > 0) {
    const hit = nonMales[rank % nonMales.length];
    const shared = hit.voiceURI === instructor.voiceURI || stationUris.has(hit.voiceURI) || rank >= nonMales.length;
    return { voiceURI: hit.voiceURI, lang: hit.lang, rate, pitch: shared ? slot.sharedPitch : slot.pitch, volume };
  }
  const hit = males[slotIdx % males.length];
  return { voiceURI: hit.voiceURI, lang: hit.lang, rate, pitch: Math.max(slot.sharedPitch, 1.08), volume };
}

