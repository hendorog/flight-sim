// speechSynthesis backend (section 3.7.2): voiceschanged wait (1.5 s), sentence splitting, cancel-before-speak,
// a watchdog for missing onend (1.5 x estimate + 2 s), 'interrupted'/'canceled' as ends, and a downgrade to
// captions after 3 other errors.
//
// Browsers differ widely here, and every failure must end in a callback, never in a stuck instructor:
// - Chrome drops onend for long utterances and stops speaking after ~15 s, hence sentence splitting and the
//   watchdog; Chrome on Linux without speech-dispatcher accepts speak() and then never fires anything.
// - After pause() or cancel(), some engines keep a stale queue or stay paused, hence cancel() (and resume())
//   before the next speak().
// - A cancelled utterance's onend/onerror often arrives after the next one has started, hence the generation
//   counter: callbacks from an older speak() are ignored.

import type { SpeechBackend, VoiceProfile } from '../types';

/** Wait this long for `voiceschanged` when getVoices() is empty at first, ms. */
export const VOICES_TIMEOUT_MS = 1500;
/** Non-cancel errors that switch the instructor to captions. */
export const DOWNGRADE_ERRORS = 3;
/** Sentences longer than this are split again at commas (Chrome cuts long utterances). */
const MAX_CHUNK_CHARS = 160;

type Callbacks = { onStart(): void; onEnd(): void; onError(e: string): void };
type UtteranceCtor = new (text: string) => SpeechSynthesisUtterance;

export interface WebSpeechOptions {
  /** Utterance constructor (tests inject a fake); defaults to the global SpeechSynthesisUtterance. */
  Utterance?: UtteranceCtor;
  /** Where `pagehide` is observed; defaults to window when present, null for none. */
  win?: Pick<Window, 'addEventListener' | 'removeEventListener'> | null;
}

/** Utterance duration estimate, s: 0.35 + words / 2.7, scaled by 1 / rate. */
export function estimateSpeechS(text: string, rate: number): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  return (0.35 + words / 2.7) / (rate > 0 ? rate : 1);
}

/** Split a line into utterance-sized chunks at sentence boundaries ("4.5" and "Hold it off..." stay whole). */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  for (const sentence of text.trim().split(/(?<=[.!?])\s+/)) {
    if (!sentence) continue;
    if (sentence.length <= MAX_CHUNK_CHARS) {
      out.push(sentence);
      continue;
    }
    // A run-on sentence: break after commas/semicolons, packing clauses up to the chunk size.
    let cur = '';
    for (const clause of sentence.split(/(?<=[,;:])\s+/)) {
      if (cur && cur.length + 1 + clause.length > MAX_CHUNK_CHARS) {
        out.push(cur);
        cur = clause;
      } else {
        cur = cur ? `${cur} ${clause}` : clause;
      }
    }
    if (cur) out.push(cur);
  }
  return out;
}

/** Errors that mean "stopped" rather than "broken". */
const END_ERRORS = new Set(['interrupted', 'canceled']);
/**
 * Autoplay policy: speech before the first user gesture fails with 'not-allowed'. That is not a broken
 * synthesiser (it works after a click), so it ends the line without counting toward the downgrade.
 */
const BENIGN_ERRORS = new Set(['not-allowed']);

export class WebSpeechBackend implements SpeechBackend {
  readonly kind = 'webspeech' as const;
  /** Called after 3 non-cancel errors: the host switches the scheduler to the caption backend. */
  onDowngrade?: (reason: string) => void;

  private readonly synth: SpeechSynthesis | null;
  private readonly Utterance: UtteranceCtor | null;
  private readonly win: Pick<Window, 'addEventListener' | 'removeEventListener'> | null;
  /** Bumped by every speak() and cancel(); callbacks of an older generation are ignored. */
  private gen = 0;
  private watchdog: ReturnType<typeof setTimeout> | null = null;
  /** Re-arms the watchdog of the chunk in flight (after resume()). */
  private rearm: (() => void) | null = null;
  private needCancel = false;
  private paused = false;
  private errors = 0;
  private downgraded = false;
  private readyPromise: Promise<boolean> | null = null;

  /** `synth` is injectable for tests (defaults to window.speechSynthesis). */
  constructor(synth?: SpeechSynthesis, opts: WebSpeechOptions = {}) {
    const g = globalThis as { speechSynthesis?: SpeechSynthesis; SpeechSynthesisUtterance?: UtteranceCtor; window?: Window };
    this.synth = synth ?? g.speechSynthesis ?? null;
    this.Utterance = opts.Utterance ?? g.SpeechSynthesisUtterance ?? null;
    this.win = opts.win === undefined ? (g.window ?? null) : opts.win;
    this.win?.addEventListener('pagehide', this.onPageHide);
  }

  /** True when the browser has a synthesiser at all (the host uses captions when not). */
  get available(): boolean {
    return this.synth !== null && this.Utterance !== null;
  }

  /** Non-cancel errors so far (the downgrade fires at 3). */
  get errorCount(): number {
    return this.errors;
  }

  /** Resolves true once at least one voice is listed; false after 1.5 s without one (or without a synth). */
  ready(): Promise<boolean> {
    const synth = this.synth;
    if (!synth || !this.Utterance) return Promise.resolve(false);
    if (this.voices().length > 0) return Promise.resolve(true);
    this.readyPromise ??= new Promise<boolean>((resolve) => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      const finish = (): void => {
        if (timer === null) return;
        clearTimeout(timer);
        timer = null;
        synth.removeEventListener?.('voiceschanged', onChange);
        this.readyPromise = null;
        resolve(this.voices().length > 0);
      };
      const onChange = (): void => {
        if (this.voices().length > 0) finish();
      };
      timer = setTimeout(finish, VOICES_TIMEOUT_MS);
      synth.addEventListener?.('voiceschanged', onChange);
    });
    return this.readyPromise;
  }

  /** The voices available after ready() (for the settings list and pickVoice). */
  voices(): SpeechSynthesisVoice[] {
    try {
      return this.synth?.getVoices() ?? [];
    } catch {
      return [];
    }
  }

  speak(text: string, voice: VoiceProfile, cb: Callbacks): void {
    this.clearWatchdog();
    const gen = ++this.gen;
    const synth = this.synth;
    const Utterance = this.Utterance;
    if (!synth || !Utterance) {
      this.fail(cb, 'unsupported');
      return;
    }
    try {
      if (this.needCancel) synth.cancel();
      if (synth.paused || this.paused) synth.resume();
    } catch {
      // A broken synth fails below, in speak(), where the error is counted.
    }
    this.needCancel = false;
    this.paused = false;

    const synthVoice = voice.voiceURI !== null ? this.voices().find((v) => v.voiceURI === voice.voiceURI) ?? null : null;
    const chunks = splitSentences(text);
    let started = false;

    const speakChunk = (i: number): void => {
      if (gen !== this.gen) return;
      if (i >= chunks.length) {
        this.rearm = null;
        cb.onEnd();
        return;
      }
      const chunk = chunks[i];
      let settled = false;
      const settle = (then: () => void): void => {
        if (settled || gen !== this.gen) return;
        settled = true;
        this.clearWatchdog();
        then();
      };
      const u = new Utterance(chunk);
      if (synthVoice) u.voice = synthVoice;
      u.lang = voice.lang;
      u.rate = voice.rate;
      u.pitch = voice.pitch;
      u.volume = voice.volume;
      u.onstart = () => {
        if (gen !== this.gen || started) return;
        started = true;
        cb.onStart();
      };
      u.onend = () => settle(() => speakChunk(i + 1));
      u.onerror = (e: SpeechSynthesisErrorEvent) => settle(() => {
        const code = e?.error ?? 'unknown';
        if (END_ERRORS.has(code) || BENIGN_ERRORS.has(code)) {
          this.rearm = null;
          cb.onEnd();
        } else {
          this.fail(cb, code);
        }
      });
      // The watchdog: no onend within 1.5 x estimate + 2 s ends the chunk. If the chunk never even started,
      // the synthesiser is silently broken (Linux Chrome without voices): that counts as an error.
      const arm = (): void => {
        this.clearWatchdog();
        const ms = (1.5 * estimateSpeechS(chunk, voice.rate) + 2) * 1000;
        this.watchdog = setTimeout(() => settle(() => {
          this.watchdog = null;
          this.needCancel = true;
          if (!started) this.fail(cb, 'no-start');
          else speakChunk(i + 1);
        }), ms);
      };
      this.rearm = arm;
      arm();
      try {
        synth.speak(u);
      } catch (err) {
        settle(() => this.fail(cb, err instanceof Error ? err.message : 'speak-threw'));
      }
    };
    speakChunk(0);
  }

  cancel(): void {
    this.gen++;
    this.clearWatchdog();
    this.rearm = null;
    this.needCancel = true;
    try {
      this.synth?.cancel();
    } catch {
      // Nothing to stop.
    }
  }

  pause(): void {
    this.paused = true;
    this.needCancel = true;
    this.clearWatchdog();
    try {
      this.synth?.pause();
    } catch {
      // Not supported: the scheduler cancels the line on pause anyway.
    }
  }

  resume(): void {
    this.paused = false;
    try {
      this.synth?.resume();
    } catch {
      // Not supported.
    }
    this.rearm?.();
  }

  /** Stop speech and drop the pagehide listener. */
  dispose(): void {
    this.cancel();
    this.win?.removeEventListener('pagehide', this.onPageHide);
  }

  private readonly onPageHide = (): void => this.cancel();

  private clearWatchdog(): void {
    if (this.watchdog !== null) clearTimeout(this.watchdog);
    this.watchdog = null;
  }

  /** A real failure: report it, and after DOWNGRADE_ERRORS of them ask the host for captions (once). */
  private fail(cb: Callbacks, code: string): void {
    this.rearm = null;
    this.needCancel = true;
    this.errors++;
    cb.onError(code);
    if (this.errors >= DOWNGRADE_ERRORS && !this.downgraded) {
      this.downgraded = true;
      this.onDowngrade?.(code);
    }
  }
}
