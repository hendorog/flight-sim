// SpeechScheduler (spec 3.7.1) with a fake clock and a fake backend: priority, TTL drop, dedupe/cooldown,
// preemption and resume, channel exclusion, pause, captions on start, gaps, and the caption backend's pacing.

import { beforeEach, describe, expect, it } from 'vitest';
import { Priority } from '../../src/training/types';
import type { ActorId, Caption, Channel, SpeechBackend, SpeechRequest, VoiceProfile } from '../../src/training/types';
import { GAP_MS, RADIO_GAP_MS, SpeechScheduler, TRANSCRIPT_MAX } from '../../src/training/speech/scheduler';
import { CaptionBackend } from '../../src/training/speech/captionBackend';
import { estimateSpeechS } from '../../src/training/speech/webSpeech';

type Cb = { onStart(): void; onEnd(): void; onError(e: string): void };

/** Records calls; the test ends utterances explicitly with finish()/fail(). */
class FakeBackend implements SpeechBackend {
  readonly kind: 'webspeech' | 'captions';
  spoken: { text: string; voice: VoiceProfile; cb: Cb }[] = [];
  cancels = 0;
  pauses = 0;
  resumes = 0;
  constructor(kind: 'webspeech' | 'captions' = 'webspeech') {
    this.kind = kind;
  }
  ready(): Promise<boolean> {
    return Promise.resolve(true);
  }
  speak(text: string, voice: VoiceProfile, cb: Cb): void {
    this.spoken.push({ text, voice, cb });
    cb.onStart();
  }
  cancel(): void {
    this.cancels++;
  }
  pause(): void {
    this.pauses++;
  }
  resume(): void {
    this.resumes++;
  }
  get last(): { text: string; cb: Cb } {
    return this.spoken[this.spoken.length - 1];
  }
  finish(): void {
    this.last.cb.onEnd();
  }
}

let t = 0;
const clock = (): number => t;
let backend: FakeBackend;
let s: SpeechScheduler;
let events: string[];
let captions: Caption[];

function req(caption: string, o: Partial<SpeechRequest> = {}): Omit<SpeechRequest, 'id'> & { id?: string } {
  return {
    actor: 'instructor' as ActorId, channel: 'cabin' as Channel, caption, speak: caption.toLowerCase(),
    priority: Priority.Instruction, interrupt: false, resumable: true, ttlMs: 8000, ...o,
  };
}

/** Advance the fake clock in frame-sized steps, calling update() each frame. */
function run(ms: number, frame = 16): void {
  const end = t + ms;
  while (t < end) {
    t = Math.min(end, t + frame);
    s.update();
  }
}

beforeEach(() => {
  t = 1000;
  backend = new FakeBackend();
  s = new SpeechScheduler(backend, clock);
  events = [];
  captions = [];
  s.onEvent = (e, r, result) => events.push(result ? `${e}:${r.caption}:${result}` : `${e}:${r.caption}`);
  s.onCaption = (c) => captions.push(c);
});

describe('SpeechScheduler ordering', () => {
  it('speaks one at a time: priority first, then age', () => {
    s.enqueue(req('coach', { priority: Priority.Coach, ttlMs: 60000 }));
    s.enqueue(req('praise', { priority: Priority.Praise, ttlMs: 60000 }));
    s.enqueue(req('instr A'));
    s.enqueue(req('instr B'));
    s.update();
    expect(backend.spoken.map((x) => x.text)).toEqual(['instr a']);
    expect(s.busy()).toBe(true);
    s.update();
    expect(backend.spoken).toHaveLength(1);
    const order: string[] = [];
    for (let i = 0; i < 4; i++) {
      order.push(backend.last.text);
      backend.finish();
      run(GAP_MS + 20);
    }
    expect(order).toEqual(['instr a', 'instr b', 'coach', 'praise']);
    expect(s.idle()).toBe(true);
  });

  it('waits 250 ms between utterances and 600 ms after radio', () => {
    s.enqueue(req('one'));
    s.enqueue(req('two'));
    s.update();
    backend.finish();
    t += GAP_MS - 1;
    s.update();
    expect(backend.spoken).toHaveLength(1);
    t += 1;
    s.update();
    expect(backend.spoken).toHaveLength(2);
    // After a radio call the gap is longer.
    s.enqueue(req('tower', { actor: 'tower', channel: 'radio' }));
    backend.finish();
    run(GAP_MS + 20);
    expect(backend.last.text).toBe('tower');
    s.enqueue(req('three'));
    backend.finish();
    t += RADIO_GAP_MS - 1;
    s.update();
    expect(backend.last.text).toBe('tower');
    t += 1;
    s.update();
    expect(backend.last.text).toBe('three');
  });

  it('uses the voice the host sets per actor', () => {
    const kate: VoiceProfile = { voiceURI: 'kate', lang: 'en-GB', rate: 1.1, pitch: 1, volume: 0.8 };
    s.voiceFor = (a) => (a === 'instructor' ? kate : { ...kate, voiceURI: 'other' });
    s.enqueue(req('hello'));
    s.update();
    expect(backend.last).toMatchObject({ voice: kate });
  });
});

describe('SpeechScheduler TTL, dedupe and cooldown', () => {
  it('drops a request whose TTL expired before it could start', () => {
    s.enqueue(req('long instruction'));
    s.update();
    s.enqueue(req('stale coaching', { priority: Priority.Coach, ttlMs: 3000 }));
    t += 3500;
    backend.finish();
    run(GAP_MS + 20);
    expect(events).toContain('end:stale coaching:dropped');
    expect(backend.spoken).toHaveLength(1);
    expect(s.idle()).toBe(true);
  });

  it('a queued key is replaced by a newer request with the same key', () => {
    s.enqueue(req('busy'));
    s.update();
    s.enqueue(req("speed's high, 80 kt", { priority: Priority.Coach, key: 'speed' }));
    s.enqueue(req("speed's high, 82 kt", { priority: Priority.Coach, key: 'speed' }));
    expect(events).toContain("end:speed's high, 80 kt:dropped");
    backend.finish();
    run(GAP_MS + 20);
    expect(backend.last.text).toBe("speed's high, 82 kt");
  });

  it('drops a key spoken within its cooldown, accepts it after', () => {
    s.enqueue(req('ball out left', { key: 'ball', cooldownMs: 25000 }));
    s.update();
    backend.finish();
    t += 10000;
    s.enqueue(req('ball out left again', { key: 'ball', cooldownMs: 25000 }));
    expect(events).toContain('end:ball out left again:dropped');
    t += 16000;
    s.enqueue(req('ball out right', { key: 'ball', cooldownMs: 25000 }));
    s.update();
    expect(backend.last.text).toBe('ball out right');
  });
});

describe('SpeechScheduler preemption', () => {
  it('Safety preempts; a resumable instruction replays afterwards', () => {
    s.enqueue(req('climb to 3,500 ft'));
    s.update();
    expect(events).toEqual(['start:climb to 3,500 ft']);
    s.enqueue(req('I have control', { priority: Priority.Safety, ttlMs: 2000 }));
    s.update();
    expect(backend.cancels).toBe(1);
    expect(backend.last.text).toBe('i have control');
    // The instruction is not ended: it waits at the head of its priority.
    expect(events.filter((e) => e.startsWith('end'))).toEqual([]);
    s.enqueue(req('another instruction'));
    backend.finish();
    run(GAP_MS + 20);
    expect(backend.last.text).toBe('climb to 3,500 ft');
    backend.finish();
    run(GAP_MS + 20);
    expect(backend.last.text).toBe('another instruction');
    // The replay re-shows the caption but keeps one transcript entry.
    expect(captions.map((c) => c.text)).toEqual(['climb to 3,500 ft', 'I have control', 'climb to 3,500 ft', 'another instruction']);
    expect(s.transcript.map((c) => c.text)).toEqual(['I have control', 'climb to 3,500 ft', 'another instruction']);
  });

  it('a non-resumable line that is cut off ends interrupted', () => {
    s.enqueue(req('nice work', { priority: Priority.Praise, resumable: false }));
    s.update();
    s.enqueue(req('stall warning', { priority: Priority.Safety }));
    s.update();
    expect(events).toContain('end:nice work:interrupted');
    expect(backend.last.text).toBe('stall warning');
  });

  it('interrupt cuts lower priorities only; without it the line waits', () => {
    s.enqueue(req('coaching', { priority: Priority.Coach }));
    s.update();
    s.enqueue(req('plain instruction'));
    s.update();
    expect(backend.last.text).toBe('coaching');
    s.enqueue(req('urgent instruction', { interrupt: true }));
    s.update();
    expect(backend.last.text).toBe('urgent instruction');
    // Equal priority never preempts, even with interrupt.
    s.enqueue(req('equal', { interrupt: true }));
    s.update();
    expect(backend.last.text).toBe('urgent instruction');
  });

  it('Safety does not preempt Safety', () => {
    s.enqueue(req('pull up', { priority: Priority.Safety }));
    s.update();
    s.enqueue(req('power', { priority: Priority.Safety, interrupt: true }));
    s.update();
    expect(backend.last.text).toBe('pull up');
  });

  it('stale callbacks from a cut-off utterance are ignored', () => {
    s.enqueue(req('first'));
    s.update();
    const firstCb = backend.last.cb;
    s.enqueue(req('safety', { priority: Priority.Safety }));
    s.update();
    firstCb.onEnd(); // the synthesiser reports the cancelled line late
    expect(s.busy()).toBe(true);
    expect(events).not.toContain('end:safety:done');
  });
});

describe('SpeechScheduler channels', () => {
  it('cabin lines below Safety do not cut into a radio transmission; Safety does', () => {
    s.enqueue(req('tower: cleared to land', { actor: 'tower', channel: 'radio', priority: Priority.Coach }));
    s.update();
    expect(s.busy('radio')).toBe(true);
    expect(s.busy('cabin')).toBe(false);
    s.enqueue(req('cabin instruction', { interrupt: true }));
    s.update();
    expect(backend.last.text).toBe('tower: cleared to land');
    s.enqueue(req('go around', { priority: Priority.Safety }));
    s.update();
    expect(backend.last.text).toBe('go around');
  });
});

describe('SpeechScheduler pause, cancel and flush', () => {
  it('pause requeues the current resumable line with a fresh TTL; queue does not age while paused', () => {
    s.enqueue(req('instruction', { ttlMs: 2000 }));
    s.enqueue(req('queued coach', { priority: Priority.Coach, ttlMs: 3000 }));
    s.update();
    t += 1500;
    s.pause();
    expect(backend.cancels).toBe(1);
    expect(backend.pauses).toBe(1);
    expect(s.busy()).toBe(false);
    t += 60000; // a long pause
    s.update();
    expect(backend.spoken).toHaveLength(1);
    s.resume();
    expect(backend.resumes).toBe(1);
    s.update();
    expect(backend.last.text).toBe('instruction');
    backend.finish();
    run(GAP_MS + 20);
    expect(backend.last.text).toBe('queued coach');
    expect(events.filter((e) => e.includes('dropped'))).toEqual([]);
  });

  it('pause ends a non-resumable line as interrupted', () => {
    s.enqueue(req('praise', { priority: Priority.Praise, resumable: false }));
    s.update();
    s.pause();
    expect(events).toContain('end:praise:interrupted');
  });

  it('cancel matches id, key, actor and priorityAtLeast (that priority and less important)', () => {
    const a = s.enqueue(req('instr'));
    s.enqueue(req('coach', { priority: Priority.Coach }));
    s.enqueue(req('praise', { priority: Priority.Praise }));
    s.enqueue(req('tower', { actor: 'tower', channel: 'radio' }));
    s.cancel({ priorityAtLeast: Priority.Coach });
    expect(events).toEqual(['end:coach:dropped', 'end:praise:dropped'].reverse());
    s.cancel({ actor: 'tower' });
    expect(events).toContain('end:tower:dropped');
    s.update();
    expect(backend.last.text).toBe('instr');
    s.cancel({ id: a });
    expect(events).toContain('end:instr:interrupted');
    expect(backend.cancels).toBe(1);
    expect(s.idle()).toBe(true);
  });

  it('flush drops the queue and interrupts the current line', () => {
    s.enqueue(req('a'));
    s.enqueue(req('b'));
    s.update();
    s.flush();
    expect(events).toEqual(['start:a', 'end:b:dropped', 'end:a:interrupted']);
    expect(s.idle()).toBe(true);
    run(1000);
    expect(backend.spoken).toHaveLength(1);
  });

  it('every request ends exactly once', () => {
    const ends = new Map<string, number>();
    s.onEvent = (e, r) => {
      if (e === 'end') ends.set(r.id, (ends.get(r.id) ?? 0) + 1);
    };
    const ids = [
      s.enqueue(req('i1')), s.enqueue(req('c1', { priority: Priority.Coach, ttlMs: 500 })),
      s.enqueue(req('k1', { key: 'k' })), s.enqueue(req('k2', { key: 'k' })),
      s.enqueue(req('p1', { priority: Priority.Praise, resumable: false })),
    ];
    s.update();
    ids.push(s.enqueue(req('s1', { priority: Priority.Safety })));
    s.update();
    s.pause();
    s.resume();
    for (let i = 0; i < 10; i++) {
      run(100);
      if (s.busy()) backend.finish();
    }
    run(1000);
    expect(s.idle()).toBe(true);
    for (const id of ids) expect(ends.get(id)).toBe(1);
  });
});

describe('SpeechScheduler captions', () => {
  it('captions appear on start with wall and sim time, never on enqueue', () => {
    s.setSimTime(42.5);
    s.enqueue(req('one'));
    s.enqueue(req('two'));
    expect(captions).toHaveLength(0);
    s.update();
    expect(captions).toEqual([{ id: expect.any(String), actor: 'instructor', channel: 'cabin', text: 'one', atWall: t, atSim: 42.5, spoken: true }]);
    backend.finish();
    run(GAP_MS + 20);
    expect(captions.map((c) => c.text)).toEqual(['one', 'two']);
  });

  it('student (YOU:) lines are captioned, never voiced, and take their turn', () => {
    s.enqueue(req('I have control', { actor: 'student' }));
    s.enqueue(req('Thank you'));
    s.update();
    expect(captions[0]).toMatchObject({ actor: 'student', text: 'I have control', spoken: false });
    expect(backend.spoken).toHaveLength(0);
    expect(events).toEqual(['start:I have control', 'end:I have control:done']);
    run(GAP_MS + 20);
    expect(backend.last.text).toBe('thank you');
  });

  it('captions are marked unspoken with the caption backend; transcript keeps the last 200', () => {
    s.setBackend(new FakeBackend('captions'));
    for (let i = 0; i < TRANSCRIPT_MAX + 5; i++) s.enqueue(req(`line ${i}`, { actor: 'student', ttlMs: 1e9 }));
    run((TRANSCRIPT_MAX + 5) * (GAP_MS + 16));
    expect(s.transcript).toHaveLength(TRANSCRIPT_MAX);
    expect(s.transcript[0].text).toBe('line 5');
    const voiced = new FakeBackend('captions');
    s.setBackend(voiced);
    s.enqueue(req('captions only'));
    run(GAP_MS + 20);
    expect(s.transcript[s.transcript.length - 1].spoken).toBe(false);
  });

  it('a backend error ends the line done and the queue moves on', () => {
    s.enqueue(req('a'));
    s.enqueue(req('b'));
    s.update();
    backend.last.cb.onError('synthesis-failed');
    expect(events).toContain('end:a:done');
    run(GAP_MS + 20);
    expect(backend.last.text).toBe('b');
  });

  it('setBackend replays the line in flight on the new backend', () => {
    s.enqueue(req('mid sentence'));
    s.update();
    const next = new FakeBackend('captions');
    s.setBackend(next);
    expect(backend.cancels).toBe(1);
    s.update();
    expect(next.last.text).toBe('mid sentence');
  });
});

describe('CaptionBackend pacing', () => {
  it('holds each line for the speech estimate (minimum 1.5 s), drives ends from update()', () => {
    const cap = new CaptionBackend(clock);
    s.setBackend(cap);
    const ends: number[] = [];
    s.onEvent = (e) => e === 'end' && ends.push(t);
    const long = 'Lookout first, then lower the nose to the climb attitude, full power, and trim for seventy-four knots.';
    s.enqueue(req('Ok', { speak: 'Ok' }));
    s.enqueue(req(long, { speak: long }));
    const t0 = t;
    run(20000, 10);
    expect(ends[0] - t0).toBeGreaterThanOrEqual(1500);
    expect(ends[0] - t0).toBeLessThanOrEqual(1520);
    const expected = estimateSpeechS(long, 1) * 1000;
    expect(ends[1] - ends[0] - GAP_MS).toBeGreaterThanOrEqual(expected - 20);
    expect(ends[1] - ends[0] - GAP_MS).toBeLessThanOrEqual(expected + 40);
  });

  it('pause freezes the remaining time and the scheduler replays the line', async () => {
    const cap = new CaptionBackend(clock);
    expect(await cap.ready()).toBe(true);
    let ended = 0;
    cap.speak('one two three four five six seven eight nine', { voiceURI: null, lang: 'en-GB', rate: 1, pitch: 1, volume: 1 }, {
      onStart() {}, onEnd: () => ended++, onError() {},
    });
    const dur = CaptionBackend.durationMs('one two three four five six seven eight nine', 1);
    t += dur / 2;
    cap.pause();
    t += 100000;
    cap.tick();
    expect(ended).toBe(0);
    cap.resume();
    t += dur / 2 - 1;
    cap.tick();
    expect(ended).toBe(0);
    t += 2;
    cap.tick();
    expect(ended).toBe(1);
    cap.cancel();
    cap.tick();
    expect(ended).toBe(1);
  });

  it('rate scales the estimate', () => {
    expect(CaptionBackend.durationMs('a b c d e f g h i j k l m n o p', 1.3)).toBeCloseTo((0.35 + 16 / 2.7) / 1.3 * 1000, 6);
    expect(CaptionBackend.durationMs('Rotate.', 1)).toBe(1500);
  });
});
