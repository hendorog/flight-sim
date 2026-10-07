// The career store (section 3.11): round trip, previous-good copy, corrupt file -> .prev, per-entity
// validation, migration with backup, newer schema read-only, quota eviction of traces with a fake storage,
// memory-only fallback, debounced saves, checkpoint and welcome flag, export, import replace and merge.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { MIGRATIONS, TRAINING_SCHEMA } from '../../src/training/career/migrations';
import {
  CHECKPOINT_KEY, PREV_KEY, TRACE_BUDGET, TRAINING_KEY, TrainingStore, backupKey, exportFileName, memoryStore, mergeSaves, traceKey,
} from '../../src/training/career/store';
import { validateTrainingBlock, validateTrainingSave } from '../../src/training/career/validate';
import { TraceRecorder } from '../../src/training/grading/trace';
import type { KeyValueStore } from '../../src/sim/resume';
import type { LogbookEntry, RunSnapshot, TraceData, TrainingSave } from '../../src/training/types';
import { lessonResult, newSave } from './gradingFixtures';

/** Web Storage with a quota: setItem throws QuotaExceededError beyond `capacity` characters in total. */
class QuotaStore implements KeyValueStore {
  readonly data = new Map<string, string>();
  constructor(public capacity: number) {}
  private used(except?: string): number {
    let n = 0;
    for (const [k, v] of this.data) if (k !== except) n += k.length + v.length;
    return n;
  }
  getItem(k: string): string | null { return this.data.get(k) ?? null; }
  setItem(k: string, v: string): void {
    if (this.used(k) + k.length + v.length > this.capacity) {
      const e = new Error('quota') as Error & { name: string };
      e.name = 'QuotaExceededError';
      throw e;
    }
    this.data.set(k, v);
  }
  removeItem(k: string): void { this.data.delete(k); }
}

const line = (id: string, o: Partial<LogbookEntry> = {}): LogbookEntry => ({
  id, date: '2026-09-01', aircraftType: 'C172', registration: 'G-FSCK', from: 'KFBL', to: 'KFBL', role: 'dual',
  times: { blockS: 900, airborneS: 800, nightS: 0, instrumentS: 0, landingsDay: 1, landingsNight: 0, takeoffs: 1 },
  lessonId: 'L04', lessonVersion: 1, exercise: 'Ex 7 & 8 Climbing and descending', outcome: 'competent', stars: 2,
  remarks: '', signedBy: 'K. Mercer FI(A)', ...o,
});

function trace(id: string, lessonId: string, seconds = 600): TraceData {
  const r = new TraceRecorder(id, lessonId);
  for (let t = 0; t < seconds; t += 0.5) r.sample({ altFt: 3000 + Math.sin(t) * 50 + t, asiKt: 90 + Math.cos(t * 3) }, t, false, { x: t * 37, y: -t * 11 });
  return r.data();
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('TrainingStore: the career file', () => {
  it('has no profile until one is saved, then round-trips it exactly', () => {
    const kv = memoryStore();
    const store = new TrainingStore(kv);
    expect(store.load()).toBeNull();
    const s = store.create({ studentName: 'Ann Pilot', instructorName: 'Kate Mercer', licenceNo: '', experienced: false },
      newSave().settings, new Date('2026-09-01T09:00:00Z'));
    expect(s.profile.licenceNo).toMatch(/^FBL-\d{4}$/);
    expect(store.save(s)).toBe(true);
    expect(new TrainingStore(kv).load()).toEqual(s);
    expect(store.status).toBe('ok');
  });

  it('keeps the previous good value in .prev and recovers from a corrupt file', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const kv = memoryStore();
    const store = new TrainingStore(kv);
    const a = newSave({ updatedAt: '2026-09-01T10:00:00.000Z' });
    const b = newSave({ updatedAt: '2026-09-02T10:00:00.000Z', logbook: [line('x1')] });
    store.save(a);
    store.save(b);
    expect(JSON.parse(kv.getItem(PREV_KEY)!)).toEqual(a);
    kv.setItem(TRAINING_KEY, '{"format":"fs-training", trunc');
    const s2 = new TrainingStore(kv);
    expect(s2.load()).toEqual(a);
    expect(s2.recoveredFromPrev).toBe(true);
    // The recovered copy is written back so the next boot is clean.
    expect(JSON.parse(kv.getItem(TRAINING_KEY)!)).toEqual(a);
  });

  it('never makes a corrupt value the previous-good copy', () => {
    const kv = memoryStore();
    const store = new TrainingStore(kv);
    store.save(newSave({ updatedAt: '2026-09-01T10:00:00.000Z' }));
    store.save(newSave({ updatedAt: '2026-09-02T10:00:00.000Z' }));
    const prev = kv.getItem(PREV_KEY);
    kv.setItem(TRAINING_KEY, 'garbage');
    store.save(newSave({ updatedAt: '2026-09-03T10:00:00.000Z' }));
    expect(kv.getItem(PREV_KEY)).toBe(prev);
  });

  it('drops one invalid entity, not the file', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const kv = memoryStore();
    const s = newSave({ logbook: [line('a'), line('b', { date: 'yesterday' }), line('c')], results: { L04: [lessonResult('L04'), { bad: true } as never] } });
    kv.setItem(TRAINING_KEY, JSON.stringify(s));
    const store = new TrainingStore(kv);
    const loaded = store.load()!;
    expect(loaded.logbook.map((e) => e.id)).toEqual(['a', 'c']);
    expect(loaded.results.L04).toHaveLength(1);
    expect(store.lastDropped).toEqual(['logbook[1]: invalid', 'results.L04[1]: invalid']);
    expect(warn).toHaveBeenCalled();
  });

  it('resets invalid settings fields to their defaults one by one', () => {
    const s = newSave();
    const raw = JSON.parse(JSON.stringify(s));
    raw.settings.talkativeness = 'loud';
    raw.settings.voice.rate = 9;
    const r = validateTrainingSave(raw)!;
    expect(r.save.settings.talkativeness).toBe('normal');
    expect(r.save.settings.voice.rate).toBe(1);
    expect(r.save.settings.authority).toBe(s.settings.authority);
    expect(r.dropped).toEqual(['settings.talkativeness: reset to default', 'settings.voice.rate: reset to default']);
  });

  it('rejects values that are not a career file at all', () => {
    expect(validateTrainingSave(null)).toBeNull();
    expect(validateTrainingSave({ format: 'other', schema: 1 })).toBeNull();
    expect(validateTrainingSave({ ...newSave(), profile: null })).toBeNull();
  });

  it('migrates an older schema after writing a backup', () => {
    const table = MIGRATIONS as Record<number, (v: Record<string, unknown>) => Record<string, unknown>>;
    table[0] = (v) => ({ ...v, profile: { ...(v.profile as object), studentName: (v as { name: string }).name } });
    try {
      const kv = memoryStore();
      const { profile, ...rest } = newSave();
      const old = { ...rest, schema: 0, name: 'Old Timer', profile: { ...profile, studentName: '' } };
      kv.setItem(TRAINING_KEY, JSON.stringify(old));
      const loaded = new TrainingStore(kv).load()!;
      expect(loaded.profile.studentName).toBe('Old Timer');
      expect(loaded.schema).toBe(TRAINING_SCHEMA);
      expect(JSON.parse(kv.getItem(backupKey(0))!)).toEqual(old);
      expect(JSON.parse(kv.getItem(TRAINING_KEY)!).schema).toBe(TRAINING_SCHEMA);   // the migration is persisted
    } finally {
      delete table[0];
    }
  });

  it('opens a newer schema read-only and never overwrites it', () => {
    const kv = memoryStore();
    const future = { ...newSave(), schema: TRAINING_SCHEMA + 1, futureField: 1 };
    const raw = JSON.stringify(future);
    kv.setItem(TRAINING_KEY, raw);
    const store = new TrainingStore(kv);
    expect(store.load()?.profile.studentName).toBe('Ann Pilot');
    expect(store.status).toBe('readOnly');
    expect(store.save(newSave())).toBe(false);
    expect(kv.getItem(TRAINING_KEY)).toBe(raw);
  });

  it('works in memory without storage', () => {
    const store = new TrainingStore(null);
    expect(store.load()).toBeNull();
    expect(store.save(newSave())).toBe(false);
    expect(store.status).toBe('memoryOnly');
  });

  it('debounces saveSoon by 500 ms and flushes on demand', () => {
    vi.useFakeTimers();
    const kv = memoryStore();
    const store = new TrainingStore(kv);
    store.saveSoon(newSave({ updatedAt: '2026-09-01T10:00:00.000Z' }));
    store.saveSoon(newSave({ updatedAt: '2026-09-01T11:00:00.000Z' }));
    expect(kv.getItem(TRAINING_KEY)).toBeNull();
    vi.advanceTimersByTime(499);
    expect(kv.getItem(TRAINING_KEY)).toBeNull();
    vi.advanceTimersByTime(1);
    expect(JSON.parse(kv.getItem(TRAINING_KEY)!).updatedAt).toBe('2026-09-01T11:00:00.000Z');
    store.saveSoon(newSave({ updatedAt: '2026-09-01T12:00:00.000Z' }));
    store.flush();
    expect(JSON.parse(kv.getItem(TRAINING_KEY)!).updatedAt).toBe('2026-09-01T12:00:00.000Z');
  });
});

describe('TrainingStore: traces and quota', () => {
  it('stores and reads back a trace', () => {
    const store = new TrainingStore(memoryStore());
    const t = trace('t1', 'L04', 60);
    expect(store.putTrace(t, 'latest')).toBe(true);
    expect(store.getTrace('t1')?.channels.t.length).toBe(t.channels.t.length);
    expect(store.getTrace('nope')).toBeNull();
  });

  it('supersedes the previous latest trace of a lesson unless the career links to it', () => {
    const kv = memoryStore();
    const store = new TrainingStore(kv);
    store.save(newSave({ logbook: [line('l1', { traceId: 'old-linked' })] }));
    store.putTrace(trace('old-linked', 'L04', 10), 'latest');
    store.putTrace(trace('old', 'L05', 10), 'latest');
    store.putTrace(trace('new', 'L05', 10), 'latest');
    store.putTrace(trace('newer', 'L04', 10), 'latest');
    expect(kv.getItem(traceKey('old'))).toBeNull();
    expect(kv.getItem(traceKey('old-linked'))).not.toBeNull();
    expect(store.traceIndex().map((e) => e.id).sort()).toEqual(['new', 'newer', 'old-linked']);
  });

  it('evicts latest traces of lessons with a best, oldest first, over the 2.5 MB budget', () => {
    const kv = memoryStore();
    const store = new TrainingStore(kv);
    store.save(newSave({ progress: {} }));
    const big = (id: string, lesson: string) => trace(id, lesson, 1800);
    let at = Date.parse('2026-09-01T10:00:00Z');
    vi.useFakeTimers();
    const put = (id: string, lesson: string, kind: 'best' | 'latest') => {
      vi.setSystemTime(at += 60_000);
      return store.putTrace(big(id, lesson), kind);
    };
    // Lessons L01-L12 each with a best and a latest: well over the budget.
    for (let i = 1; i <= 12; i++) {
      const l = `L${String(i).padStart(2, '0')}`;
      put(`${l}-best`, l, 'best');
      put(`${l}-latest`, l, 'latest');
    }
    const total = store.traceIndex().reduce((n, e) => n + (kv.getItem(traceKey(e.id))?.length ?? 0), 0);
    expect(total).toBeLessThanOrEqual(TRACE_BUDGET);
    const ids = store.traceIndex().map((e) => e.id);
    for (let i = 1; i <= 12; i++) expect(ids).toContain(`L${String(i).padStart(2, '0')}-best`);
    // The evicted ones are the oldest latest traces; the newest latest survives.
    expect(ids).toContain('L12-latest');
    expect(ids).not.toContain('L01-latest');
  });

  it('evicts traces and retries once when the career file hits the quota, then falls back to memory', () => {
    const kv = new QuotaStore(400_000);
    const store = new TrainingStore(kv);
    store.save(newSave());
    store.putTrace(trace('b1', 'L04', 1200), 'best');
    store.putTrace(trace('l1', 'L04', 1200), 'latest');
    store.putTrace(trace('b2', 'L05', 1200), 'best');
    expect(kv.getItem(traceKey('l1'))).not.toBeNull();
    // A career file that only fits once the evictable trace is gone.
    const free = kv.capacity - [...kv.data].reduce((n, [k, v]) => n + k.length + v.length, 0);
    const lineCount = Math.ceil((free + 1000) / 400);
    const s = newSave({ logbook: Array.from({ length: lineCount }, (_, i) => line(`e${i}`, { remarks: 'x'.repeat(100) })) });
    expect(JSON.stringify(s).length).toBeGreaterThan(free);
    expect(store.save(s)).toBe(true);
    expect(kv.getItem(traceKey('l1'))).toBeNull();
    expect(kv.getItem(traceKey('b1'))).not.toBeNull();
    expect(store.status).toBe('ok');
    // Nothing left to evict: memory only, and the stored file is untouched.
    const huge = newSave({ logbook: Array.from({ length: lineCount * 4 }, (_, i) => line(`h${i}`, { remarks: 'y'.repeat(100) })) });
    expect(store.save(huge)).toBe(false);
    expect(store.status).toBe('memoryOnly');
    expect(JSON.parse(kv.getItem(TRAINING_KEY)!).logbook).toHaveLength(lineCount);
  });
});

describe('TrainingStore: checkpoint, flags, reset', () => {
  const run: RunSnapshot = {
    lessonId: 'L04', lessonVersion: 1, attemptId: 'a1', phaseId: 'practiceClimb', phaseRepeat: 0, stepId: 'climb', stepAttempt: 1,
    vars: { alt0: 2500 }, authority: 'student', holds: null, exercises: {}, faults: [], interventions: 0, handbacks: 0, phaseRetries: 0,
    flightTimer: { times: { blockS: 10, airborneS: 10, nightS: 0, instrumentS: 0, landingsDay: 0, landingsNight: 0, takeoffs: 0 }, blockOn: true, airborne: true, offGroundS: 10, onGroundS: 0 },
    startedAt: '2026-09-01T10:00:00.000Z', elapsedSimS: 10, weatherSeed: 42,
  };

  it('stores the welcome flag and clears a checkpoint', () => {
    const kv = memoryStore();
    const store = new TrainingStore(kv);
    expect(store.welcomeDismissed).toBe(false);
    store.welcomeDismissed = true;
    expect(new TrainingStore(kv).welcomeDismissed).toBe(true);
    kv.setItem(CHECKPOINT_KEY, '{"bad":1}');
    expect(store.loadCheckpoint()).toBeNull();
    store.saveCheckpoint(null);
    expect(kv.getItem(CHECKPOINT_KEY)).toBeNull();
  });

  it('validates the snapshot training block', () => {
    const block = { lessonId: 'L04', lessonVersion: 1, run, start: { kind: 'air', at: 'trainingArea', altFt: 2500, altRef: 'msl', hdgDeg: 100, kias: 105 }, checkpoint: null };
    expect(validateTrainingBlock(JSON.parse(JSON.stringify(block)))).toEqual(block);
    expect(validateTrainingBlock({ ...block, run: { ...run, authority: 'cat' } })).toBeNull();
    expect(validateTrainingBlock({ ...block, lessonId: 'L05' })).toBeNull();
    expect(validateTrainingBlock({ ...block, start: { kind: 'teleport' } })).toBeNull();
    expect(validateTrainingBlock({ ...block, checkpoint: { flight: {}, runner: run, traceOffset: 3 } })).toBeNull();
    expect(validateTrainingBlock(undefined)).toBeNull();
  });

  it('reset deletes the profile, traces and checkpoint but keeps the welcome flag', () => {
    const kv = memoryStore();
    const store = new TrainingStore(kv);
    store.save(newSave());
    store.save(newSave({ updatedAt: '2026-09-02T00:00:00.000Z' }));
    store.putTrace(trace('t1', 'L04', 10), 'best');
    store.welcomeDismissed = true;
    kv.setItem(CHECKPOINT_KEY, '{}');
    store.reset();
    expect([...kv.data.keys()]).toEqual(['fs.training.v1.welcomeDismissed']);
    expect(store.load()).toBeNull();
  });
});

describe('export and import', () => {
  const now = new Date('2026-09-05T12:00:00Z');

  it('names the export file after the student and the date', () => {
    expect(exportFileName(newSave(), now)).toBe('fs-training-ann-pilot-2026-09-05.json');
  });

  it('exports with traces and previews the import without writing anything', () => {
    const kv = memoryStore();
    const store = new TrainingStore(kv);
    const s = newSave({ logbook: [line('a'), line('b', { times: { ...line('b').times, landingsNight: 2 } })],
      progress: { L04: { status: 'competent', attempts: 2, bestStars: 2, lastOutcome: 'competent', exercises: {}, lessonVersion: 1 } } });
    store.save(s);
    store.putTrace(trace('t1', 'L04', 30), 'best');
    const json = store.exportJson(s, true, 'build-7', now);
    const file = JSON.parse(json);
    expect(file).toMatchObject({ format: 'fs-training', version: 1, exportedAt: now.toISOString(), app: { build: 'build-7' } });
    expect(Object.keys(file.traces)).toEqual(['t1']);
    expect(JSON.parse(store.exportJson(s, false, 'b', now)).traces).toBeUndefined();

    const other = new TrainingStore(memoryStore());
    const p = other.previewImport(json);
    expect(p).toMatchObject({ studentName: 'Ann Pilot', lessonsCompetent: 1, landings: 4 });
    expect(p.hours).toBeCloseTo(0.5);
    expect(Object.keys(p.traces)).toEqual(['t1']);
    expect(other.load()).toBeNull();
  });

  it('rejects invalid files with a reason', () => {
    const store = new TrainingStore(memoryStore());
    expect(() => store.previewImport('nope')).toThrow(/not valid JSON/);
    expect(() => store.previewImport('{"format":"x"}')).toThrow(/not a Flight School export/);
    expect(() => store.previewImport(JSON.stringify({ format: 'fs-training', version: 1, data: { schema: 99 } }))).toThrow(/newer version/);
    expect(() => store.previewImport(JSON.stringify({ format: 'fs-training', version: 1, data: { schema: 1, format: 'fs-training' } }))).toThrow(/damaged/);
  });

  it('replaces or merges the career on import', () => {
    const kv = memoryStore();
    const store = new TrainingStore(kv);
    const mine = newSave({ updatedAt: '2026-09-04T00:00:00.000Z', logbook: [line('a'), line('b')] });
    store.save(mine);
    const theirs = newSave({ updatedAt: '2026-09-03T00:00:00.000Z', profile: { ...mine.profile, studentName: 'Other' }, logbook: [line('b'), line('c')] });
    const p = store.previewImport(store.exportJson(theirs, false, 'b', now));
    const replaced = new TrainingStore(memoryStore()).applyImport(p, 'replace', mine);
    expect(replaced.logbook.map((e) => e.id)).toEqual(['b', 'c']);
    const merged = store.applyImport(p, 'merge', mine);
    expect(merged.logbook.map((e) => e.id).sort()).toEqual(['a', 'b', 'c']);
    expect(merged.profile.studentName).toBe('Ann Pilot');      // the newer profile
    expect(new TrainingStore(kv).load()).toEqual(merged);
  });
});

describe('mergeSaves', () => {
  it('takes the better progress, the best grades, the union of the logbook and endorsements (earliest date) and the top bests', () => {
    const flags = { calmAir: false, kbdAssists: true, instructorSaves: true, inputDevice: 'keyboard' as const };
    const a: TrainingSave = newSave({
      updatedAt: '2026-09-02T00:00:00.000Z',
      progress: {
        L04: { status: 'competent', attempts: 2, bestStars: 1, lastOutcome: 'competent', lessonVersion: 1, exercises: { x: { best: 2, last: 2, competentAt: '2026-08-02T00:00:00.000Z' } } },
        L05: { status: 'available', attempts: 4, bestStars: 0, lastOutcome: 'notYet', lessonVersion: 1, exercises: {} },
      },
      endorsements: [{ id: 'firstSolo', at: '2026-08-05T00:00:00.000Z', lessonId: 'L14' }],
      bests: { spot: [{ score: 70, at: '2026-08-01T00:00:00.000Z', authority: 'easa', flags }, { score: 50, at: '2026-08-02T00:00:00.000Z', authority: 'faa', flags }] },
      results: { L04: [lessonResult('L04', { attemptId: 'a1', endedAt: '2026-08-01T00:00:00.000Z' })] },
      records: { safeLandings: 2 },
    });
    const b: TrainingSave = newSave({
      updatedAt: '2026-09-01T00:00:00.000Z',
      progress: {
        L04: { status: 'competent', attempts: 3, bestStars: 3, lastOutcome: 'competent', lessonVersion: 1, exercises: { x: { best: 4, last: 3, competentAt: '2026-08-01T00:00:00.000Z' }, y: { best: 2, last: 2 } } },
        L05: { status: 'competent', attempts: 1, bestStars: 1, lastOutcome: 'competent', lessonVersion: 1, exercises: {} },
      },
      endorsements: [{ id: 'firstSolo', at: '2026-08-04T00:00:00.000Z', lessonId: 'L14' }, { id: 'night', at: '2026-08-10T00:00:00.000Z', lessonId: 'N1' }],
      bests: { spot: [80, 75, 72, 71, 69].map((score, i) => ({ score, at: `2026-08-1${i}T00:00:00.000Z`, authority: 'easa' as const, flags })) },
      results: { L04: [lessonResult('L04', { attemptId: 'a2', endedAt: '2026-08-03T00:00:00.000Z' }), lessonResult('L04', { attemptId: 'a3', endedAt: '2026-08-04T00:00:00.000Z' }), lessonResult('L04', { attemptId: 'a1', endedAt: '2026-08-01T00:00:00.000Z' })] },
      records: { safeLandings: 5 },
    });
    const m = mergeSaves(a, b);
    expect(m.progress.L04).toMatchObject({ bestStars: 3, attempts: 3 });
    expect(m.progress.L04.exercises.x).toEqual({ best: 4, last: 3, competentAt: '2026-08-01T00:00:00.000Z' });
    expect(m.progress.L04.exercises.y).toEqual({ best: 2, last: 2 });
    expect(m.progress.L05.status).toBe('competent');
    expect(m.progress.L05.attempts).toBe(4);
    expect(m.endorsements).toEqual([{ id: 'firstSolo', at: '2026-08-04T00:00:00.000Z', lessonId: 'L14' }, { id: 'night', at: '2026-08-10T00:00:00.000Z', lessonId: 'N1' }]);
    expect(m.bests.spot.filter((x) => x.authority === 'easa').map((x) => x.score)).toEqual([80, 75, 72, 71, 70]);
    expect(m.bests.spot.filter((x) => x.authority === 'faa')).toHaveLength(1);
    expect(m.results.L04.map((r) => r.attemptId)).toEqual(['a1', 'a2', 'a3']);   // union by attempt, last 3
    expect(m.records?.safeLandings).toBe(5);
    expect(m.updatedAt).toBe(a.updatedAt);
    expect(validateTrainingSave(JSON.parse(JSON.stringify(m)))?.dropped).toEqual([]);
  });
});
