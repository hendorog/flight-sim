// Spoken warnings (AudioProfile.voiceWarnings): the AH-56A's FLAWS, the fault locator aural warning system with its
// voice warning (P that it existed and was rated excellent: ASTA-72 para 73f, APE-I para 134g; the CONTENT of the
// messages is not in any source read, so the words and their triggers are ESTIMATES). Pure logic here (which message,
// when, how often), so it is unit-tested; the speaking goes through a Speaker, which in the browser is the Web Speech
// API (browserSpeaker) and in node nothing at all.

import type { AircraftState } from '../core/types';
import type { AudioProfile, VoiceMessage } from './profile';

/** What says the words: the browser's speech synthesis, or a test double. */
export interface Speaker {
  speak(text: string, volume: number): void;
  /** Stop whatever this speaker started (a pause, a mute, a change of type). */
  cancel(): void;
}

/** Rotor speed below which a rotor-rpm warning disarms (a start or a shutdown), % of its 100 % rpm. ESTIMATE */
export const ROTOR_RPM_DISARM_PCT = 50;
/** Time a message takes to say, s: 0.4 s plus 0.07 s a character (about 150 words a minute). ESTIMATE */
export const speechSeconds = (text: string): number => 0.4 + 0.07 * text.length;

type Profile = NonNullable<AudioProfile['voiceWarnings']>;

/**
 * Which messages of `profile` the state calls for now, by index. 'rotorRpm': the rotor outside [low, high] % once it
 * has been armed (`armed[i]`, updated here: armed on reaching `low`, disarmed below ROTOR_RPM_DISARM_PCT). 'engineFire':
 * no state reports an engine fire (EngineState has no fire member), so never. 'caution': `caution` (a new master
 * caution, latched by the caller). Nothing without bus power (`powered`).
 */
export function activeMessages(s: AircraftState, powered: boolean, profile: Profile, armed: boolean[], caution: boolean): boolean[] {
  return profile.messages.map((m: VoiceMessage, i) => {
    const w = m.when;
    if (w.kind === 'rotorRpm') {
      const pct = s.rotorcraft ? (100 * Math.max(0, s.rotorcraft.rotorRpm)) / w.rpm100 : 0;
      if (pct >= w.low) armed[i] = true;
      else if (pct < ROTOR_RPM_DISARM_PCT) armed[i] = false;
      return powered && armed[i] === true && (pct < w.low || pct > w.high);
    }
    if (w.kind === 'caution') return powered && caution;
    return false;
  });
}

/**
 * Speaks the messages of a profile: a message is spoken as soon as it becomes active and again every `repeatSeconds`
 * while it stays so; one message at a time (the next waits until the last has been said), the first in the list
 * first. A caution is said once per caution() call.
 */
export class VoiceWarner {
  private t = 0;
  private busyUntil = 0;
  private readonly nextAt: number[];
  private readonly armed: boolean[];
  private caution = false;
  /** The messages spoken, in order (for tests and the debug readout). */
  readonly said: string[] = [];

  constructor(private readonly profile: Profile, private readonly speaker: Speaker | null) {
    this.nextAt = profile.messages.map(() => 0);
    this.armed = profile.messages.map(() => false);
  }

  /** A new master caution (the 'caws' event): spoken once. */
  noteCaution(): void {
    this.caution = this.profile.messages.some((m) => m.when.kind === 'caution');
  }

  /** `volume`: the master volume 0..1 (0 while muted: nothing is spoken, the timers still run). */
  update(s: AircraftState, powered: boolean, dt: number, volume: number): void {
    this.t += Math.max(0, dt);
    const active = activeMessages(s, powered, this.profile, this.armed, this.caution);
    if (!powered) this.caution = false;
    for (let i = 0; i < active.length; i++) if (!active[i]) this.nextAt[i] = 0;
    if (this.t < this.busyUntil) return;
    for (let i = 0; i < active.length; i++) {
      if (!active[i] || this.t < this.nextAt[i]) continue;
      const m = this.profile.messages[i];
      if (m.when.kind === 'caution') this.caution = false;
      this.nextAt[i] = this.t + this.profile.repeatSeconds;
      this.busyUntil = this.t + speechSeconds(m.text);
      this.said.push(m.text);
      if (volume > 0) this.speaker?.speak(m.text, Math.min(1, volume * this.profile.volume));
      return;
    }
  }

  /** Stop speaking and start over (a pause, a mute, a reset). */
  silence(): void {
    this.speaker?.cancel();
    this.busyUntil = 0;
    this.caution = false;
    this.nextAt.fill(0);
  }
}

interface WebSpeech {
  speak(u: unknown): void;
  cancel(): void;
}
type UtteranceCtor = new (text: string) => { volume: number; rate: number; pitch: number; onend: (() => void) | null; onerror: (() => void) | null };

/**
 * The browser's speech synthesis as a Speaker, or null where there is none (node, a browser without it).
 * window.speechSynthesis is one queue per page, shared with the Flight School's instructor: cancel() empties it only
 * while one of this speaker's own utterances is still queued or being said, so a pause never cuts the instructor off
 * on the warner's account. `g`: the global scope (injectable for tests).
 */
export function browserSpeaker(g: { speechSynthesis?: WebSpeech; SpeechSynthesisUtterance?: UtteranceCtor } = globalThis as never): Speaker | null {
  const synth = g.speechSynthesis;
  const Utterance = g.SpeechSynthesisUtterance;
  if (!synth || !Utterance) return null;
  let pending = 0;
  return {
    speak(text, volume) {
      const u = new Utterance(text);
      u.volume = volume;
      // A clipped, slightly fast and low announcer voice.
      u.rate = 1.1;
      u.pitch = 0.8;
      u.onend = u.onerror = () => {
        pending = Math.max(0, pending - 1);
      };
      try {
        synth.speak(u);
        pending++;
      } catch {
        // A browser that refuses speech before a gesture: nothing said.
      }
    },
    cancel() {
      if (pending === 0) return;
      pending = 0;
      try {
        synth.cancel();
      } catch {
        // Nothing to stop.
      }
    },
  };
}
