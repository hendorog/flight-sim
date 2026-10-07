// Captions-only backend (section 3.7.2): timer-driven with the same duration estimate as the web speech
// backend (minimum 1.5 s), so pacing is identical with or without voices.
//
// It has no timers of its own: the scheduler calls tick() from update(), which reads the injected clock. That
// keeps it deterministic under fake clocks (the headless conformance host runs it at physics speed).

import type { SpeechBackend, VoiceProfile } from '../types';
import { estimateSpeechS } from './webSpeech';

/** Shortest time a caption-only line occupies the "voice", s. */
export const MIN_CAPTION_S = 1.5;

interface Pending {
  endAt: number;
  cb: { onStart(): void; onEnd(): void; onError(e: string): void };
}

export class CaptionBackend implements SpeechBackend {
  readonly kind = 'captions' as const;
  private current: Pending | null = null;
  /** Remaining ms of the current line while paused; null when running. */
  private pausedRemaining: number | null = null;

  /** `now`: wall ms; the backend polls it from tick() so fake clocks work in tests. */
  constructor(private readonly now: () => number) {}

  ready(): Promise<boolean> {
    return Promise.resolve(true);
  }

  /** How long a line is held, ms (the web speech estimate, minimum 1.5 s). */
  static durationMs(text: string, rate: number): number {
    return Math.max(MIN_CAPTION_S, estimateSpeechS(text, rate)) * 1000;
  }

  speak(text: string, voice: VoiceProfile, cb: { onStart(): void; onEnd(): void; onError(e: string): void }): void {
    const ms = CaptionBackend.durationMs(text, voice.rate);
    this.current = { endAt: this.now() + ms, cb };
    if (this.pausedRemaining !== null) this.pausedRemaining = ms;
    cb.onStart();
  }

  /** Advance timers (the scheduler calls it from update()). */
  tick(): void {
    const cur = this.current;
    if (!cur || this.pausedRemaining !== null || this.now() < cur.endAt) return;
    this.current = null;
    cur.cb.onEnd();
  }

  /** Stop the current line without calling back (the scheduler already knows it cancelled it). */
  cancel(): void {
    this.current = null;
  }

  pause(): void {
    if (this.pausedRemaining !== null) return;
    this.pausedRemaining = this.current ? Math.max(0, this.current.endAt - this.now()) : 0;
  }

  resume(): void {
    if (this.pausedRemaining === null) return;
    if (this.current) this.current.endAt = this.now() + this.pausedRemaining;
    this.pausedRemaining = null;
  }
}
