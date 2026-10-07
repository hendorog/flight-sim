// Voice selection (spec 1.4) and personas, plus the speech audio cues (AudioSystem.setDuck / chime, 3.7.2).

import { afterEach, describe, expect, it, vi } from 'vitest';
import { pickVoice, voiceGender, type VoiceInfo } from '../../src/training/speech/voices';
import { PERSONAS, signatureFor } from '../../src/training/content/personas';
import { AudioSystem, DUCK_RAMP_S, duckGain, synthChime } from '../../src/audio/AudioSystem';

const v = (voiceURI: string, name: string, lang: string, isDefault = false): VoiceInfo => ({ voiceURI, name, lang, default: isDefault });
const SETTINGS = { rate: 1, volume: 0.9 };

// A typical Windows Chrome list, deliberately in an unhelpful order.
const WINDOWS = [
  v('us-david', 'Microsoft David - English (United States)', 'en-US', true),
  v('us-zira', 'Microsoft Zira - English (United States)', 'en-US'),
  v('gb-george', 'Microsoft George - English (United Kingdom)', 'en-GB'),
  v('gb-hazel', 'Microsoft Hazel - English (United Kingdom)', 'en-GB'),
  v('de', 'Microsoft Hedda - German (Germany)', 'de-DE'),
];

describe('voiceGender', () => {
  it.each([
    ['Google UK English Female', 'female'], ['Google UK English Male', 'male'], ['Microsoft Hazel - English (United Kingdom)', 'female'],
    ['Daniel', 'male'], ['Karen', 'female'], ['english+f3', 'female'], ['English (Great Britain)+m1', 'male'],
    ['English (Great Britain)', null], ['Microsoft Sonia Online (Natural) - English (United Kingdom)', 'female'],
  ])('%s -> %s', (name, g) => {
    expect(voiceGender(name)).toBe(g);
  });
});

describe('pickVoice', () => {
  it('instructor: en-GB female first', () => {
    expect(pickVoice(WINDOWS, 'instructor', null, SETTINGS)).toEqual({ voiceURI: 'gb-hazel', lang: 'en-GB', rate: 1, pitch: 1, volume: 0.9 });
  });

  it('examiner: en-GB male first, then en-US male', () => {
    expect(pickVoice(WINDOWS, 'examiner', null, SETTINGS).voiceURI).toBe('gb-george');
    expect(pickVoice(WINDOWS.filter((x) => x.voiceURI !== 'gb-george'), 'examiner', null, SETTINGS).voiceURI).toBe('us-david');
  });

  it('instructor falls through en-AU, en-NZ, en-IE, any en female, any en', () => {
    const list = [v('us-m', 'Alex', 'en-US'), v('ie', 'Moira', 'en_IE'), v('au', 'Karen', 'en-AU')];
    expect(pickVoice(list, 'instructor', null, SETTINGS).voiceURI).toBe('au');
    expect(pickVoice(list.slice(0, 2), 'instructor', null, SETTINGS).voiceURI).toBe('ie');
    expect(pickVoice([v('us-m', 'Alex', 'en-US'), v('us-f', 'Samantha', 'en-US')], 'instructor', null, SETTINGS).voiceURI).toBe('us-f');
    expect(pickVoice([v('fr', 'Thomas', 'fr-FR'), v('us-m', 'Alex', 'en-US')], 'instructor', null, SETTINGS).voiceURI).toBe('us-m');
  });

  it("the player's choice wins, with the rate and volume settings clamped", () => {
    expect(pickVoice(WINDOWS, 'instructor', 'us-zira', { rate: 2, volume: 1.5 })).toEqual({
      voiceURI: 'us-zira', lang: 'en-US', rate: 1.3, pitch: 1, volume: 1,
    });
    // A stale choice (voice uninstalled) falls back to the preferences.
    expect(pickVoice(WINDOWS, 'instructor', 'gone', SETTINGS).voiceURI).toBe('gb-hazel');
  });

  it('examiner takes a different English voice from the instructor when one exists', () => {
    const list = [v('a', 'English (Great Britain)', 'en-GB'), v('b', 'English (America)', 'en-US')];
    expect(pickVoice(list, 'instructor', null, SETTINGS).voiceURI).toBe('a');
    expect(pickVoice(list, 'examiner', null, SETTINGS)).toMatchObject({ voiceURI: 'b', pitch: 1, rate: 1 });
  });

  it('with a single voice the examiner gets pitch 0.85 and rate 0.92 x the setting', () => {
    const one = [v('only', 'English (Great Britain)', 'en-GB')];
    expect(pickVoice(one, 'instructor', null, SETTINGS)).toMatchObject({ voiceURI: 'only', pitch: 1, rate: 1 });
    const ex = pickVoice(one, 'examiner', null, { rate: 1.1, volume: 0.9 });
    expect(ex.voiceURI).toBe('only');
    expect(ex.pitch).toBe(0.85);
    expect(ex.rate).toBeCloseTo(1.1 * 0.92, 9);
  });

  it('with no English voice the default voice is used in the persona language', () => {
    expect(pickVoice([], 'instructor', null, SETTINGS)).toEqual({ voiceURI: null, lang: 'en-GB', rate: 1, pitch: 1, volume: 0.9 });
    expect(pickVoice([v('de', 'Anna', 'de-DE')], 'examiner', null, SETTINGS)).toMatchObject({ voiceURI: null, pitch: 0.85 });
  });
});

describe('personas', () => {
  it('match section 1.4', () => {
    expect(PERSONAS.instructor).toMatchObject({ id: 'instructor', name: 'Kate Mercer', title: 'FI(A)', signature: 'K. Mercer FI(A)', fallbackPitch: 1 });
    expect(PERSONAS.examiner).toMatchObject({ id: 'examiner', name: 'David Hale', fallbackPitch: 0.85, fallbackRate: 0.92 });
    expect(PERSONAS.instructor.voicePrefs[0]).toEqual({ lang: 'en-GB', gender: 'female' });
    expect(PERSONAS.examiner.voicePrefs[0]).toEqual({ lang: 'en-GB', gender: 'male' });
    // Every persona ends with a catch-all, so any English voice is usable.
    for (const p of Object.values(PERSONAS)) expect(p.voicePrefs[p.voicePrefs.length - 1]).toEqual({ lang: 'en' });
  });

  it('signatureFor follows the logbook style for an edited name', () => {
    expect(signatureFor('Kate Mercer', 'FI(A)')).toBe(PERSONAS.instructor.signature);
    expect(signatureFor('  jo  van Dyke ', 'FI(A)')).toBe('J. van Dyke FI(A)');
    expect(signatureFor('Cher', 'FI(A)')).toBe('Cher FI(A)');
  });
});

// ---- Audio cues ------------------------------------------------------------------------------------------

/** Minimal Web Audio fakes: record construction, connections and source start/stop. */
function installFakeAudio() {
  const made: { type: string; opts: Record<string, unknown>; started?: number; stopped?: number; to: unknown[] }[] = [];
  const param = () => ({ value: 1, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn(), cancelScheduledValues: vi.fn() });
  const node = (type: string) => class {
    rec = { type, opts: {} as Record<string, unknown>, to: [] as unknown[] } as (typeof made)[number];
    gain = param();
    constructor(_ac: unknown, opts: Record<string, unknown> = {}) {
      this.rec.opts = opts;
      made.push(this.rec);
    }
    connect(n: unknown) {
      this.rec.to.push(n);
      return n;
    }
    start(t: number) {
      this.rec.started = t;
    }
    stop(t: number) {
      this.rec.stopped = t;
    }
  };
  vi.stubGlobal('GainNode', node('gain'));
  vi.stubGlobal('OscillatorNode', node('osc'));
  vi.stubGlobal('BiquadFilterNode', node('biquad'));
  vi.stubGlobal('AudioBufferSourceNode', node('buffer'));
  const ac = {
    sampleRate: 48000, currentTime: 10, state: 'running',
    createBuffer: (_c: number, n: number) => ({ length: n, getChannelData: () => new Float32Array(n) }),
  };
  return { made, ac };
}

describe('audio cues', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('duck maps 0..1 to 0..-6 dB and clamps', () => {
    expect(duckGain(0)).toBe(1);
    expect(20 * Math.log10(duckGain(1))).toBeCloseTo(-6, 9);
    expect(20 * Math.log10(duckGain(0.5))).toBeCloseTo(-3, 9);
    expect(duckGain(5)).toBe(duckGain(1));
    expect(duckGain(Number.NaN)).toBe(1);
  });

  it.each(['intercom', 'caption', 'radio'] as const)('%s chime: one-shot sources that start and stop, routed to the destination', (kind) => {
    const { made, ac } = installFakeAudio();
    const dest = { name: 'dest' };
    synthChime(ac as unknown as BaseAudioContext, dest as unknown as AudioNode, kind, 10);
    const sources = made.filter((m) => m.type === 'osc' || m.type === 'buffer');
    expect(sources.length).toBe(kind === 'caption' ? 2 : 1);
    for (const s of sources) {
      expect(s.started).toBeGreaterThanOrEqual(10);
      expect(s.stopped).toBeGreaterThan(s.started!);
      expect(s.stopped! - 10).toBeLessThan(0.6); // short cues, never a lingering source
    }
    expect(made.some((m) => m.to.includes(dest))).toBe(true);
    if (kind === 'intercom') expect(sources[0].stopped! - 10).toBeLessThan(0.03); // the 15 ms click
  });

  it('setDuck before the audio graph exists is remembered, and ramps over 150 ms once it does', () => {
    const audio = new AudioSystem();
    expect(() => audio.setDuck(1)).not.toThrow();
    expect(() => audio.chime('intercom')).not.toThrow();
    const gain = { value: 1, cancelScheduledValues: vi.fn(), setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() };
    (audio as unknown as { g: unknown }).g = { ac: { currentTime: 5, state: 'running' }, duck: { gain } };
    audio.setDuck(0.5);
    expect(gain.cancelScheduledValues).toHaveBeenCalledWith(5);
    expect(gain.linearRampToValueAtTime).toHaveBeenCalledWith(duckGain(0.5), 5 + DUCK_RAMP_S);
  });
});
