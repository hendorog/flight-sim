// The speech scheduler (section 3.7.1): one utterance at a time; priority then age; TTL drops; key dedupe and
// cooldown; preemption (Safety preempts anything, `interrupt` preempts lower priorities) with resumable
// requeue; radio/cabin channel exclusion; 250 ms gaps (600 ms after radio); pause requeues; captions on start.
// Pure with an injected clock and backend, so it is tested with fakes.
//
// Lifecycle guarantees (what the runner and the UI can rely on):
// - Every enqueued request gets exactly one onEvent('end', ..) with 'done', 'interrupted' or 'dropped'. A
//   request that was cut off and requeued (preemption, pause, backend switch) gets another 'start' and caption
//   when it plays again, and only then its single 'end'.
// - A line is "started" when the scheduler hands it to the backend: the caption and onEvent('start') happen
//   then, not on the synthesiser's onstart, which some browsers never fire.
// - A backend error ends the line as 'done': its caption was shown, which is the part that cannot be lost.
// - `student` lines (the YOU: acknowledgements, rule 8 of section 1.4) are captioned, never voiced: they take
//   their turn in the queue, show their caption and end at once.

import { Priority, type ActorId, type Caption, type Channel, type SpeechBackend, type SpeechRequest, type VoiceProfile } from '../types';

export type { Caption, SpeechBackend, SpeechRequest, VoiceProfile } from '../types';

/** Gap between utterances, ms (rule 6). */
export const GAP_MS = 250;
/** Gap after a radio transmission, ms (rule 6). */
export const RADIO_GAP_MS = 600;
/** Captions kept in the transcript. */
export const TRANSCRIPT_MAX = 200;

/** Voice used until the host sets one per actor (the browser's default English voice). */
export const DEFAULT_VOICE: VoiceProfile = { voiceURI: null, lang: 'en-GB', rate: 1, pitch: 1, volume: 0.9 };

/** A backend driven by the scheduler's update() (the caption backend). */
interface Tickable { tick(): void }
function isTickable(b: SpeechBackend): b is SpeechBackend & Tickable {
  return typeof (b as Partial<Tickable>).tick === 'function';
}

interface Entry {
  req: SpeechRequest;
  /** When the TTL clock started (enqueue, or the requeue after a cut-off), wall ms. */
  queuedAt: number;
  /** Sort key within a priority: enqueue order; requeued lines get negative keys so they go to the head. */
  order: number;
  /** Cut off once already: its caption is in the transcript and is refreshed rather than repeated. */
  replay?: boolean;
}

interface Playing {
  entry: Entry;
  /** Identifies this hand-over to the backend; stale callbacks carry an older token. */
  token: number;
}

export class SpeechScheduler {
  onCaption?: (c: Caption) => void;
  onEvent?: (e: 'start' | 'end', r: SpeechRequest, result?: 'done' | 'interrupted' | 'dropped') => void;
  /** Voice per actor (pickVoice); the host sets it when settings or the lesson persona change. */
  voiceFor: (actor: ActorId) => VoiceProfile = () => DEFAULT_VOICE;

  private backend: SpeechBackend;
  private readonly queue: Entry[] = [];
  private current: Playing | null = null;
  private token = 0;
  private seq = 0;
  private headSeq = 0;
  private idSeq = 0;
  /** No utterance starts before this wall time (the gap after the previous one). */
  private gapUntil = 0;
  /** Wall time each key last started speaking (cooldowns). */
  private readonly lastSpoken = new Map<string, number>();
  private readonly captions: Caption[] = [];
  private paused = false;
  private pausedAt = 0;
  private simTime = 0;

  /** `now`: wall-clock ms. */
  constructor(backend: SpeechBackend, private readonly now: () => number) {
    this.backend = backend;
  }

  get backendKind(): SpeechBackend['kind'] {
    return this.backend.kind;
  }

  /** Queue a request; returns its id (generated when absent). */
  enqueue(r: Omit<SpeechRequest, 'id'> & { id?: string }): string {
    const req: SpeechRequest = { ...r, id: r.id ?? `sp${++this.idSeq}` };
    const now = this.now();
    if (req.key !== undefined) {
      // Rule 3: a key spoken within its cooldown is dropped; a queued request with the same key is replaced.
      const last = this.lastSpoken.get(req.key);
      if (last !== undefined && req.cooldownMs !== undefined && now - last < req.cooldownMs) {
        this.onEvent?.('end', req, 'dropped');
        return req.id;
      }
      const i = this.queue.findIndex((e) => e.req.key === req.key);
      if (i >= 0) this.onEvent?.('end', this.queue.splice(i, 1)[0].req, 'dropped');
    }
    this.queue.push({ req, queuedAt: this.paused ? this.pausedAt : now, order: ++this.seq });
    return req.id;
  }

  /**
   * Cancel queued and playing requests matching every given field. `priorityAtLeast` matches that priority
   * and anything less important (numerically >=): `{ priorityAtLeast: Priority.Coach }` silences coaching and
   * praise but keeps instructions and safety calls. `queuedOnly`: a line already playing finishes.
   */
  cancel(match: { id?: string; key?: string; actor?: ActorId; priorityAtLeast?: Priority; queuedOnly?: boolean }): void {
    const hit = (r: SpeechRequest): boolean =>
      (match.id === undefined || r.id === match.id) &&
      (match.key === undefined || r.key === match.key) &&
      (match.actor === undefined || r.actor === match.actor) &&
      (match.priorityAtLeast === undefined || r.priority >= match.priorityAtLeast);
    for (let i = this.queue.length - 1; i >= 0; i--) {
      if (hit(this.queue[i].req)) this.onEvent?.('end', this.queue.splice(i, 1)[0].req, 'dropped');
    }
    if (!match.queuedOnly && this.current && hit(this.current.entry.req)) this.stopCurrent('interrupted');
  }

  /** Once per frame (wall time). */
  update(): void {
    if (isTickable(this.backend)) this.backend.tick();
    if (this.paused) return;
    const now = this.now();

    if (this.current) {
      const cur = this.current.entry.req;
      const cut = this.next(now, (r) => this.canPreempt(r, cur));
      if (!cut) return;
      this.cutOff(now);
      this.start(cut, now);
      return;
    }
    if (now < this.gapUntil) return;
    const next = this.next(now, () => true);
    if (next) this.start(next, now);
  }

  pause(): void {
    if (this.paused) return;
    this.paused = true;
    this.pausedAt = this.now();
    if (this.current) this.cutOff(this.pausedAt);
    this.backend.pause();
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    // Time spent paused does not age the queue: a line queued just before the pause still plays after it.
    const shift = this.now() - this.pausedAt;
    for (const e of this.queue) e.queuedAt += shift;
    this.gapUntil += shift;
    this.backend.resume();
  }

  /** Curtain / reposition: drop everything queued and stop the current utterance. */
  flush(): void {
    const dropped = this.queue.splice(0);
    for (const e of dropped) this.onEvent?.('end', e.req, 'dropped');
    if (this.current) this.stopCurrent('interrupted');
  }

  /** An utterance is playing (on `channel`, when given). */
  busy(channel?: Channel): boolean {
    return this.current !== null && (channel === undefined || this.current.entry.req.channel === channel);
  }

  /** Nothing playing or queued (for `actor`, when given). */
  idle(actor?: ActorId): boolean {
    const mine = (r: SpeechRequest): boolean => actor === undefined || r.actor === actor;
    return !(this.current && mine(this.current.entry.req)) && !this.queue.some((e) => mine(e.req));
  }

  /** Last 200 captions. */
  get transcript(): readonly Caption[] {
    return this.captions;
  }

  /** Switch backends (captions-only downgrade, or voices appearing): the line in flight is replayed. */
  setBackend(b: SpeechBackend): void {
    if (b === this.backend) return;
    if (this.current) this.cutOff(this.now());
    this.backend = b;
    if (this.paused) b.pause();
  }

  /** Sim time stamped on captions (Caption.atSim); set by the host each frame. */
  setSimTime(t: number): void {
    this.simTime = t;
  }

  // ---- internals ------------------------------------------------------------------------------------------

  /** Rule 4 and 5: may queued request `r` cut off the playing `cur`? */
  private canPreempt(r: SpeechRequest, cur: SpeechRequest): boolean {
    if (r.priority >= cur.priority) return false;
    if (r.priority === Priority.Safety) return true;
    // Below Safety, nothing cuts into a radio transmission from the cabin.
    if (cur.channel === 'radio' && r.channel === 'cabin') return false;
    return r.interrupt;
  }

  /**
   * The best queued request satisfying `ok` (priority, then age), removed from the queue. Expired requests
   * met on the way are dropped (rule 2).
   */
  private next(now: number, ok: (r: SpeechRequest) => boolean): Entry | null {
    this.queue.sort((a, b) => a.req.priority - b.req.priority || a.order - b.order);
    for (let i = 0; i < this.queue.length; ) {
      const e = this.queue[i];
      if (now - e.queuedAt > e.req.ttlMs) {
        this.queue.splice(i, 1);
        this.onEvent?.('end', e.req, 'dropped');
        continue;
      }
      if (ok(e.req)) {
        this.queue.splice(i, 1);
        return e;
      }
      i++;
    }
    return null;
  }

  private start(entry: Entry, now: number): void {
    const req = entry.req;
    const token = ++this.token;
    this.current = { entry, token };
    if (req.key !== undefined) this.lastSpoken.set(req.key, now);
    const voiced = req.actor !== 'student' && this.backend.kind === 'webspeech';
    this.caption({ id: req.id, actor: req.actor, channel: req.channel, text: req.caption, atWall: now, atSim: this.simTime, spoken: voiced }, entry.replay === true);
    this.onEvent?.('start', req);
    if (req.actor === 'student') {
      this.finish(token, 'done');
      return;
    }
    this.backend.speak(req.speak, this.voiceFor(req.actor), {
      onStart: () => {},
      onEnd: () => this.finish(token, 'done'),
      onError: () => this.finish(token, 'done'),
    });
  }

  /** The backend (or the student shortcut) finished the hand-over `token`. */
  private finish(token: number, result: 'done' | 'interrupted'): void {
    const cur = this.current;
    if (!cur || cur.token !== token) return;
    this.current = null;
    const now = this.now();
    this.gapUntil = now + (cur.entry.req.channel === 'radio' ? RADIO_GAP_MS : GAP_MS);
    this.onEvent?.('end', cur.entry.req, result);
  }

  /**
   * Stop the playing line because something else needs the voice (preemption, pause, backend switch): it goes
   * back to the head of its priority with a fresh TTL when resumable, else it ends 'interrupted'.
   */
  private cutOff(now: number): void {
    const cur = this.current;
    if (!cur) return;
    this.current = null;
    this.backend.cancel();
    if (cur.entry.req.resumable) {
      this.queue.push({ req: cur.entry.req, queuedAt: now, order: -(++this.headSeq), replay: true });
    } else {
      this.onEvent?.('end', cur.entry.req, 'interrupted');
    }
  }

  /** Stop the playing line for good (cancel, flush). */
  private stopCurrent(result: 'interrupted'): void {
    const cur = this.current;
    if (!cur) return;
    this.current = null;
    this.backend.cancel();
    this.onEvent?.('end', cur.entry.req, result);
  }

  private caption(c: Caption, replay: boolean): void {
    // A replayed line keeps one transcript entry (refreshed), but the UI is told again so it re-shows it.
    if (replay) {
      for (let i = this.captions.length - 1; i >= 0; i--) {
        if (this.captions[i].id === c.id) {
          this.captions.splice(i, 1);
          break;
        }
      }
    }
    this.captions.push(c);
    if (this.captions.length > TRANSCRIPT_MAX) this.captions.splice(0, this.captions.length - TRANSCRIPT_MAX);
    this.onCaption?.(c);
  }
}
