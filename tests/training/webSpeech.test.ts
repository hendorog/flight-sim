// WebSpeechBackend (spec 3.7.2) against a fake speechSynthesis: the voiceschanged wait and timeout, sentence
// splitting, cancel-before-speak, the watchdog for a missing onend (and for an engine that never starts),
// 'interrupted'/'canceled' as ends, stale callbacks, and the downgrade to captions after 3 errors, end to end
// through the scheduler.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DOWNGRADE_ERRORS, VOICES_TIMEOUT_MS, WebSpeechBackend, estimateSpeechS, splitSentences } from '../../src/training/speech/webSpeech';
import { CaptionBackend } from '../../src/training/speech/captionBackend';
import { SpeechScheduler } from '../../src/training/speech/scheduler';
import { Priority } from '../../src/training/types';
import type { VoiceProfile } from '../../src/training/types';

class FakeUtterance {
  voice: unknown = null;
  lang = '';
  rate = 1;
  pitch = 1;
  volume = 1;
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  constructor(public text: string) {}
}

type Voice = { voiceURI: string; name: string; lang: string; default: boolean; localService: boolean };

/** A scriptable speechSynthesis. `mode` decides what happens to each spoken utterance. */
class FakeSynth {
  voices: Voice[] = [];
  spoken: FakeUtterance[] = [];
  calls: string[] = [];
  paused = false;
  speaking = false;
  pending = false;
  /** 'manual': nothing fires until the test calls start()/end(); 'silent': nothing ever fires. */
  mode: 'manual' | 'silent' | 'throw' = 'manual';
  private listeners: (() => void)[] = [];
  getVoices(): Voice[] {
    return this.voices;
  }
  addEventListener(type: string, fn: () => void): void {
    if (type === 'voiceschanged') this.listeners.push(fn);
  }
  removeEventListener(type: string, fn: () => void): void {
    if (type === 'voiceschanged') this.listeners = this.listeners.filter((l) => l !== fn);
  }
  get listenerCount(): number {
    return this.listeners.length;
  }
  setVoices(v: Voice[]): void {
    this.voices = v;
    this.listeners.forEach((l) => l());
  }
  speak(u: FakeUtterance): void {
    this.calls.push(`speak:${u.text}`);
    if (this.mode === 'throw') throw new Error('boom');
    this.spoken.push(u);
  }
  cancel(): void {
    this.calls.push('cancel');
  }
  pause(): void {
    this.calls.push('pause');
    this.paused = true;
  }
  resume(): void {
    this.calls.push('resume');
    this.paused = false;
  }
  get last(): FakeUtterance {
    return this.spoken[this.spoken.length - 1];
  }
}

const VOICE: VoiceProfile = { voiceURI: 'gb-f', lang: 'en-GB', rate: 1, pitch: 1, volume: 0.9 };
const GB_F: Voice = { voiceURI: 'gb-f', name: 'Google UK English Female', lang: 'en-GB', default: false, localService: false };

let synth: FakeSynth;
let backend: WebSpeechBackend;
let log: string[];
const cb = () => ({ onStart: () => log.push('start'), onEnd: () => log.push('end'), onError: (e: string) => log.push(`error:${e}`) });

beforeEach(() => {
  vi.useFakeTimers();
  synth = new FakeSynth();
  backend = new WebSpeechBackend(synth as unknown as SpeechSynthesis, { Utterance: FakeUtterance as unknown as new (t: string) => SpeechSynthesisUtterance, win: null });
  log = [];
});
afterEach(() => {
  vi.useRealTimers();
});

describe('estimate and splitting', () => {
  it('estimate = 0.35 s + words / 2.7, scaled by 1 / rate', () => {
    expect(estimateSpeechS('one two three four five six seven eight nine', 1)).toBeCloseTo(0.35 + 9 / 2.7, 9);
    expect(estimateSpeechS('  ', 1)).toBeCloseTo(0.35, 9);
    expect(estimateSpeechS('a b c', 1.25)).toBeCloseTo((0.35 + 3 / 2.7) / 1.25, 9);
  });

  it('splits at sentence boundaries but not inside decimals or ellipses', () => {
    expect(splitSentences('Hold it off... hold it off. Four point five is 4.5 miles! Ready?')).toEqual([
      'Hold it off...', 'hold it off.', 'Four point five is 4.5 miles!', 'Ready?',
    ]);
    const runOn = Array.from({ length: 30 }, (_, i) => `clause number ${i},`).join(' ');
    const parts = splitSentences(runOn);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(160);
    expect(parts.join(' ')).toBe(runOn);
  });
});

describe('ready()', () => {
  it('resolves true at once when voices are listed', async () => {
    synth.voices = [GB_F];
    await expect(backend.ready()).resolves.toBe(true);
  });

  it('waits for voiceschanged', async () => {
    const p = backend.ready();
    vi.advanceTimersByTime(500);
    synth.setVoices([GB_F]);
    await expect(p).resolves.toBe(true);
    expect(synth.listenerCount).toBe(0);
  });

  it('gives up after 1.5 s without voices', async () => {
    const p = backend.ready();
    let settled = false;
    void p.then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(VOICES_TIMEOUT_MS - 10);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(20);
    await expect(p).resolves.toBe(false);
    expect(synth.listenerCount).toBe(0);
  });

  it('is false without speechSynthesis at all, and speak() then fails instead of hanging', async () => {
    const none = new WebSpeechBackend(undefined, { Utterance: undefined, win: null });
    // Node has neither global, so this is the "browser without speech" case.
    expect(none.available).toBe(false);
    await expect(none.ready()).resolves.toBe(false);
    none.speak('hello', VOICE, cb());
    expect(log).toEqual(['error:unsupported']);
  });
});

describe('speak()', () => {
  it('speaks sentence by sentence with the chosen voice, onStart once, onEnd after the last', () => {
    synth.voices = [GB_F];
    backend.speak('Lookout. Attitude. Instruments.', { ...VOICE, rate: 1.2, pitch: 0.85 }, cb());
    expect(synth.spoken.map((u) => u.text)).toEqual(['Lookout.']);
    const u = synth.last;
    expect(u.voice).toBe(GB_F);
    expect(u).toMatchObject({ lang: 'en-GB', rate: 1.2, pitch: 0.85, volume: 0.9 });
    u.onstart?.();
    u.onend?.();
    synth.last.onstart?.();
    synth.last.onend?.();
    expect(synth.spoken).toHaveLength(3);
    synth.last.onend?.();
    expect(log).toEqual(['start', 'end']);
  });

  it("'interrupted' and 'canceled' errors count as an end, not an error", () => {
    backend.speak('One.', VOICE, cb());
    synth.last.onerror?.({ error: 'interrupted' });
    backend.speak('Two.', VOICE, cb());
    synth.last.onerror?.({ error: 'canceled' });
    expect(log).toEqual(['end', 'end']);
    expect(backend.errorCount).toBe(0);
  });

  it('calls cancel() (and resume()) before the next speak() after a cancel or a pause', () => {
    backend.speak('One.', VOICE, cb());
    backend.cancel();
    synth.calls = [];
    backend.speak('Two.', VOICE, cb());
    expect(synth.calls).toEqual(['cancel', 'speak:Two.']);
    backend.pause();
    synth.calls = [];
    backend.speak('Three.', VOICE, cb());
    expect(synth.calls).toEqual(['cancel', 'resume', 'speak:Three.']);
    synth.calls = [];
    synth.last.onend?.();
    backend.speak('Four.', VOICE, cb());
    expect(synth.calls).toEqual(['speak:Four.']);
  });

  it('ignores late callbacks from a cancelled utterance', () => {
    backend.speak('Old.', VOICE, cb());
    const old = synth.last;
    backend.cancel();
    backend.speak('New.', VOICE, cb());
    old.onstart?.();
    old.onend?.();
    old.onerror?.({ error: 'synthesis-failed' });
    expect(log).toEqual([]);
    expect(backend.errorCount).toBe(0);
  });

  it('pagehide cancels speech', () => {
    const handlers: Record<string, () => void> = {};
    const win = { addEventListener: (t: string, f: () => void) => (handlers[t] = f), removeEventListener: vi.fn() };
    const b = new WebSpeechBackend(synth as unknown as SpeechSynthesis, { Utterance: FakeUtterance as never, win: win as never });
    b.speak('Hello.', VOICE, cb());
    synth.calls = [];
    handlers.pagehide();
    expect(synth.calls).toEqual(['cancel']);
    synth.last.onend?.();
    expect(log).toEqual([]);
    b.dispose();
    expect(win.removeEventListener).toHaveBeenCalledWith('pagehide', expect.any(Function));
  });
});

describe('watchdog', () => {
  it('ends an utterance whose onend never comes after 1.5 x estimate + 2 s', () => {
    const text = 'Climb to three thousand five hundred feet.';
    backend.speak(text, VOICE, cb());
    synth.last.onstart?.();
    const ms = (1.5 * estimateSpeechS(text, 1) + 2) * 1000;
    vi.advanceTimersByTime(ms - 5);
    expect(log).toEqual(['start']);
    vi.advanceTimersByTime(10);
    expect(log).toEqual(['start', 'end']);
    expect(backend.errorCount).toBe(0);
    // A late onend from the abandoned utterance changes nothing.
    synth.last.onend?.();
    expect(log).toEqual(['start', 'end']);
  });

  it('moves on chunk by chunk when onend is missing for each sentence', () => {
    backend.speak('One two. Three four.', VOICE, cb());
    synth.last.onstart?.();
    vi.advanceTimersByTime(10000);
    expect(synth.spoken).toHaveLength(2);
    vi.advanceTimersByTime(10000);
    expect(log).toEqual(['start', 'end']);
  });

  it('pause holds the watchdog; resume re-arms it', () => {
    backend.speak('Hold it.', VOICE, cb());
    synth.last.onstart?.();
    backend.pause();
    vi.advanceTimersByTime(60000);
    expect(log).toEqual(['start']);
    backend.resume();
    vi.advanceTimersByTime(10000);
    expect(log).toEqual(['start', 'end']);
  });
});

describe('downgrade to captions', () => {
  it('3 non-cancel errors call onDowngrade once; not-allowed does not count', () => {
    const reasons: string[] = [];
    backend.onDowngrade = (r) => reasons.push(r);
    for (let i = 0; i < 5; i++) {
      backend.speak('x.', VOICE, cb());
      synth.last.onerror?.({ error: 'not-allowed' });
    }
    expect(reasons).toEqual([]);
    for (let i = 0; i < DOWNGRADE_ERRORS + 2; i++) {
      backend.speak('x.', VOICE, cb());
      synth.last.onerror?.({ error: 'synthesis-failed' });
    }
    expect(reasons).toEqual(['synthesis-failed']);
    expect(log.filter((l) => l.startsWith('error'))).toHaveLength(DOWNGRADE_ERRORS + 2);
  });

  it('an engine that never starts (Linux without voices) times out as errors and downgrades', () => {
    synth.mode = 'silent';
    const reasons: string[] = [];
    backend.onDowngrade = (r) => reasons.push(r);
    for (let i = 0; i < 3; i++) {
      backend.speak('Nothing happens.', VOICE, cb());
      vi.advanceTimersByTime(10000);
    }
    expect(log).toEqual(['error:no-start', 'error:no-start', 'error:no-start']);
    expect(reasons).toEqual(['no-start']);
  });

  it('a throwing speak() is an error, not an exception', () => {
    synth.mode = 'throw';
    expect(() => backend.speak('x.', VOICE, cb())).not.toThrow();
    expect(log).toEqual(['error:boom']);
  });

  it('end to end: the scheduler keeps going and switches to captions without losing a line', () => {
    synth.mode = 'silent';
    let now = 0;
    const sched = new SpeechScheduler(backend, () => now);
    const caps: string[] = [];
    const ends: string[] = [];
    sched.onCaption = (c) => caps.push(`${c.text}${c.spoken ? '' : ' (caption)'}`);
    sched.onEvent = (e, r, res) => e === 'end' && ends.push(`${r.caption}:${res}`);
    backend.onDowngrade = () => sched.setBackend(new CaptionBackend(() => now));
    const lines = ['One.', 'Two.', 'Three.', 'Four.', 'Five.'];
    for (const l of lines) {
      sched.enqueue({ actor: 'instructor', channel: 'cabin', caption: l, speak: l, priority: Priority.Instruction, interrupt: false, resumable: true, ttlMs: 60000 });
    }
    for (let i = 0; i < 4000; i++) {
      now += 16;
      vi.advanceTimersByTime(16);
      sched.update();
    }
    expect(sched.backendKind).toBe('captions');
    expect(caps).toEqual(['One.', 'Two.', 'Three.', 'Four. (caption)', 'Five. (caption)']);
    expect(ends).toEqual(lines.map((l) => `${l}:done`));
  });
});
