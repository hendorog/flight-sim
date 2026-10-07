// The career store (section 3.11): `fs.training.v1` with a previous-good copy, migration backups, traces
// with a 2.5 MB budget, the lesson checkpoint and the welcome flag. Every storage access is in try/catch;
// `tstore=mem` uses an in-memory KeyValueStore (or `null`: nothing persists, the store works in memory).
//
// Writes are verified: copy the current good value to `.prev`, write, read back and parse. A quota failure
// evicts traces and retries once; after that the store keeps the career in memory (status 'memoryOnly', the
// UI shows "Progress can't be saved in this browser; use Export"). A file of a newer schema is opened
// read-only.

import type { KeyValueStore } from '../../sim/resume';
import { decodeTrace, encodeTrace } from '../grading/trace';
import type { CheckpointBlob, Grade, LessonProgress, TraceData, TraceIndexEntry, TrainingSave } from '../types';
import { addBest } from './challenges';
import { migrate, TRAINING_SCHEMA } from './migrations';
import { totals } from './totals';
import { validateCheckpoint, validateTrainingSave } from './validate';

export const TRAINING_KEY = 'fs.training.v1';
export const PREV_KEY = `${TRAINING_KEY}.prev`;
export const TRACE_INDEX_KEY = `${TRAINING_KEY}.traceIndex`;
export const CHECKPOINT_KEY = `${TRAINING_KEY}.checkpoint`;
export const WELCOME_KEY = `${TRAINING_KEY}.welcomeDismissed`;
export const traceKey = (id: string): string => `${TRAINING_KEY}.trace.${id}`;
export const backupKey = (schema: number): string => `${TRAINING_KEY}.backup.s${schema}`;

/** Total size of stored traces before eviction, in characters (UTF-16 code units, as localStorage counts). */
export const TRACE_BUDGET = 2.5 * 1024 * 1024;
/** Traces linked from this many most recent logbook lines are kept. */
const LINKED_LOGBOOK_LINES = 20;
/** Debounce of saveSoon (settings, remarks), ms. */
export const SAVE_DEBOUNCE_MS = 500;

export type StoreStatus = 'ok' | 'memoryOnly' | 'readOnly';

export interface ImportPreview {
  save: TrainingSave;
  traces: Record<string, string>;
  studentName: string; lessonsCompetent: number; hours: number; landings: number;
}

/** The export file (section 3.11). */
interface ExportFile {
  format: 'fs-training'; version: 1; exportedAt: string; app: { build: string };
  data: TrainingSave; traces?: Record<string, string>;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function isQuotaError(e: unknown): boolean {
  if (!isObj(e) && !(e instanceof Error)) return false;
  const err = e as { name?: string; code?: number };
  return err.name === 'QuotaExceededError' || err.name === 'NS_ERROR_DOM_QUOTA_REACHED' || err.code === 22 || err.code === 1014;
}

/** A plain in-memory KeyValueStore (URL `tstore=mem`, tests). */
export function memoryStore(): KeyValueStore & { readonly data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => { data.set(k, String(v)); },
    removeItem: (k) => { data.delete(k); },
  };
}

/** A licence number 'FBL-0421' derived from the creation time (stable, not secret). */
function licenceNo(now: Date): string {
  return `FBL-${String(now.getTime() % 10000).padStart(4, '0')}`;
}

export class TrainingStore {
  private readonly kv: KeyValueStore | null;
  private st: StoreStatus = 'ok';
  /** The last save written or loaded (traces linked from its logbook and bests are protected). */
  private current: TrainingSave | null = null;
  private pending: TrainingSave | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** Load fell back to `.prev` (the UI shows a toast once). */
  recoveredFromPrev = false;
  /** Reasons for entities dropped by the last load or import preview. */
  lastDropped: string[] = [];

  constructor(kv: KeyValueStore | null) {
    this.kv = kv;
  }

  /** 'memoryOnly' after a quota failure (banner "use Export"); 'readOnly' for a newer schema. */
  get status(): StoreStatus {
    return this.st;
  }

  // ---- guarded storage access ----------------------------------------------------------------------------

  private get(key: string): string | null {
    try {
      return this.kv?.getItem(key) ?? null;
    } catch {
      return null;
    }
  }

  /** Throws only on a quota failure (the caller evicts and retries); other failures return false. */
  private setOrThrowQuota(key: string, value: string): boolean {
    if (!this.kv) return false;
    try {
      this.kv.setItem(key, value);
      return true;
    } catch (e) {
      if (isQuotaError(e)) throw e;
      return false;
    }
  }

  private set(key: string, value: string): boolean {
    try {
      return this.setOrThrowQuota(key, value);
    } catch {
      return false;
    }
  }

  private remove(key: string): void {
    try {
      this.kv?.removeItem(key);
    } catch {
      /* ignore */
    }
  }

  // ---- the career file ---------------------------------------------------------------------------------

  /** Parse, migrate (writing the backup first) and validate one stored value; null when unusable. */
  private parse(raw: string | null, writeBackup: boolean): TrainingSave | null {
    if (!raw) return null;
    let v: unknown;
    try {
      v = JSON.parse(raw);
    } catch {
      return null;
    }
    if (!isObj(v) || v.format !== 'fs-training' || typeof v.schema !== 'number') return null;
    if (v.schema > TRAINING_SCHEMA) {
      // A newer app wrote this: show it, never overwrite it.
      this.st = 'readOnly';
      const r = validateTrainingSave({ ...v, schema: TRAINING_SCHEMA });
      return r ? r.save : null;
    }
    if (v.schema < TRAINING_SCHEMA) {
      if (writeBackup) this.set(backupKey(v.schema), raw);
      try {
        v = migrate(v, v.schema);
      } catch {
        return null;
      }
    }
    const r = validateTrainingSave(v);
    if (!r) return null;
    this.lastDropped = r.dropped;
    for (const d of r.dropped) console.warn(`[training] dropped from the career file: ${d}`);
    return r.save;
  }

  /** Load (falling back to `.prev` on corruption, migrating older schemas); null when no profile exists. */
  load(): TrainingSave | null {
    this.recoveredFromPrev = false;
    const raw = this.get(TRAINING_KEY);
    let save = this.parse(raw, true);
    if (!save && raw !== null) {
      save = this.parse(this.get(PREV_KEY), false);
      if (save) {
        this.recoveredFromPrev = true;
        console.warn('[training] the career file was unreadable; restored the previous copy');
      }
    }
    const rawSchema = (safeParse(raw) as { schema?: unknown } | undefined)?.schema;
    if (save && this.st !== 'readOnly' && (this.recoveredFromPrev || rawSchema !== TRAINING_SCHEMA)) {
      this.save(save);   // persist the migration (its backup is already written) or the recovered copy
    }
    this.current = save;
    return save;
  }

  /** A fresh profile (Welcome card). Not written until save(). */
  create(profile: TrainingSave['profile'], settings: TrainingSave['settings'], now: Date): TrainingSave {
    const at = now.toISOString();
    return {
      format: 'fs-training', schema: 1, createdAt: at, updatedAt: at, appBuild: '',
      profile: { ...profile, licenceNo: profile.licenceNo || licenceNo(now) },
      settings: structuredClone(settings),
      progress: {}, skills: {}, endorsements: [], logbook: [], results: {}, bests: {}, testHistory: [],
      records: { safeLandings: 0 },
    };
  }

  /** Copy current to `.prev`, write, read back and parse. False when it could not be persisted. */
  save(s: TrainingSave): boolean {
    this.current = s;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.pending = null;
    if (this.st === 'readOnly') return false;
    if (!this.kv) {
      this.st = 'memoryOnly';   // no storage in this browser (private mode, blocked): the banner says "use Export"
      return false;
    }
    const json = JSON.stringify(s);
    const old = this.get(TRAINING_KEY);
    // Only a value that still reads back as a career file becomes the previous-good copy.
    if (old !== null && old !== json && validateTrainingSave(safeParse(old))) this.set(PREV_KEY, old);
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        if (!this.setOrThrowQuota(TRAINING_KEY, json)) break;
        const back = this.get(TRAINING_KEY);
        if (back === json && safeParse(back) !== undefined) {
          if (this.st === 'memoryOnly') this.st = 'ok';
          return true;
        }
        break;
      } catch {
        if (attempt === 0) this.evictTraces(0);   // quota: drop every evictable trace, then retry once
      }
    }
    this.st = 'memoryOnly';
    return false;
  }

  /** Debounced save (500 ms) for settings and remarks; flush() on pagehide. */
  saveSoon(s: TrainingSave): void {
    this.current = s;
    this.pending = s;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), SAVE_DEBOUNCE_MS);
  }

  flush(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    const p = this.pending;
    this.pending = null;
    if (p) this.save(p);
  }

  // ---- traces ------------------------------------------------------------------------------------------

  traceIndex(): TraceIndexEntry[] {
    const v = safeParse(this.get(TRACE_INDEX_KEY));
    if (!Array.isArray(v)) return [];
    return v.filter((e): e is TraceIndexEntry => isObj(e) && typeof e.id === 'string' && typeof e.lessonId === 'string'
      && typeof e.at === 'string' && (e.kind === 'best' || e.kind === 'latest' || e.kind === 'challenge'));
  }

  private writeIndex(ix: TraceIndexEntry[]): void {
    this.set(TRACE_INDEX_KEY, JSON.stringify(ix));
  }

  /** Trace ids the career links to: lesson bests, challenge bests and the last 20 logbook lines. */
  private protectedTraces(): Set<string> {
    const p = new Set<string>();
    const s = this.current;
    if (!s) return p;
    for (const pr of Object.values(s.progress)) if (pr.bestTraceId) p.add(pr.bestTraceId);
    for (const list of Object.values(s.bests)) for (const b of list) if (b.traceId) p.add(b.traceId);
    for (const e of s.logbook.slice(-LINKED_LOGBOOK_LINES)) if (e.traceId) p.add(e.traceId);
    return p;
  }

  putTrace(t: TraceData, kind: TraceIndexEntry['kind']): boolean {
    return this.putEncoded(t.id, t.lessonId, encodeTrace(t), kind);
  }

  private putEncoded(id: string, lessonId: string, encoded: string, kind: TraceIndexEntry['kind'], at = new Date().toISOString()): boolean {
    if (this.st === 'readOnly') return false;
    let ok = false;
    for (let attempt = 0; attempt < 2 && !ok; attempt++) {
      try {
        ok = this.setOrThrowQuota(traceKey(id), encoded);
        if (!ok) return false;
      } catch {
        if (attempt === 0) this.evictTraces(0);
      }
    }
    if (!ok) return false;
    const protectedIds = this.protectedTraces();
    let ix = this.traceIndex().filter((e) => e.id !== id);
    // A new best / latest of a lesson supersedes the previous one unless the career still links to it.
    if (kind !== 'challenge') {
      for (const e of ix.filter((x) => x.lessonId === lessonId && x.kind === kind && !protectedIds.has(x.id))) this.remove(traceKey(e.id));
      ix = ix.filter((x) => !(x.lessonId === lessonId && x.kind === kind && !protectedIds.has(x.id)));
    }
    ix.push({ id, kind, lessonId, at });
    this.writeIndex(ix);
    this.evictTraces(TRACE_BUDGET);
    return true;
  }

  getTrace(id: string): TraceData | null {
    const raw = this.get(traceKey(id));
    return raw ? decodeTrace(raw) : null;
  }

  /**
   * Bring the stored traces under `budget` characters: evict `latest` traces whose lesson also has a `best`,
   * oldest first, never one linked from the career (bests, challenge bests, the last 20 logbook lines).
   */
  private evictTraces(budget: number): void {
    const ix = this.traceIndex();
    const size = new Map(ix.map((e) => [e.id, this.get(traceKey(e.id))?.length ?? 0]));
    let total = [...size.values()].reduce((a, b) => a + b, 0);
    if (total <= budget) return;
    const protectedIds = this.protectedTraces();
    const withBest = new Set(ix.filter((e) => e.kind === 'best').map((e) => e.lessonId));
    const candidates = ix
      .filter((e) => e.kind === 'latest' && withBest.has(e.lessonId) && !protectedIds.has(e.id))
      .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    const removed = new Set<string>();
    for (const e of candidates) {
      if (total <= budget) break;
      this.remove(traceKey(e.id));
      removed.add(e.id);
      total -= size.get(e.id) ?? 0;
    }
    if (removed.size > 0) this.writeIndex(ix.filter((e) => !removed.has(e.id)));
  }

  // ---- checkpoint and flags ------------------------------------------------------------------------------

  saveCheckpoint(cp: CheckpointBlob | null): void {
    if (cp === null) this.remove(CHECKPOINT_KEY);
    else this.set(CHECKPOINT_KEY, JSON.stringify(cp));
  }

  loadCheckpoint(): CheckpointBlob | null {
    return validateCheckpoint(safeParse(this.get(CHECKPOINT_KEY)));
  }

  get welcomeDismissed(): boolean {
    return this.get(WELCOME_KEY) === '1';
  }

  set welcomeDismissed(on: boolean) {
    if (on) this.set(WELCOME_KEY, '1');
    else this.remove(WELCOME_KEY);
  }

  // ---- export / import ------------------------------------------------------------------------------------

  /** The export file's JSON text (`fs-training-<student>-<yyyy-mm-dd>.json`, see exportFileName). */
  exportJson(s: TrainingSave, includeTraces: boolean, build: string, now: Date): string {
    const file: ExportFile = { format: 'fs-training', version: 1, exportedAt: now.toISOString(), app: { build }, data: s };
    if (includeTraces) {
      const traces: Record<string, string> = {};
      for (const e of this.traceIndex()) {
        const raw = this.get(traceKey(e.id));
        if (raw) traces[e.id] = raw;
      }
      file.traces = traces;
    }
    return JSON.stringify(file);
  }

  /** Parse, validate and migrate an export; nothing is written. Throws with a reason when invalid. */
  previewImport(json: string): ImportPreview {
    let v: unknown;
    try {
      v = JSON.parse(json);
    } catch {
      throw new Error('The file is not valid JSON.');
    }
    if (!isObj(v) || v.format !== 'fs-training') throw new Error('This is not a Flight School export.');
    // Accept the export wrapper or a bare career file.
    let data: unknown = 'data' in v ? v.data : v;
    if (!isObj(data) || typeof data.schema !== 'number') throw new Error('The file has no career data.');
    const schema = data.schema;
    if (schema > TRAINING_SCHEMA) throw new Error('The file comes from a newer version of the simulator.');
    if (schema < TRAINING_SCHEMA) {
      try {
        data = migrate(data, schema);
      } catch {
        throw new Error(`The file's format (schema ${schema}) can't be upgraded.`);
      }
    }
    const r = validateTrainingSave(data);
    if (!r) throw new Error('The career data in the file is damaged.');
    this.lastDropped = r.dropped;
    const traces: Record<string, string> = {};
    if (isObj(v.traces)) {
      for (const [id, raw] of Object.entries(v.traces)) if (typeof raw === 'string' && decodeTrace(raw)) traces[id] = raw;
    }
    const t = totals(r.save.logbook);
    return {
      save: r.save, traces, studentName: r.save.profile.studentName,
      lessonsCompetent: Object.values(r.save.progress).filter((p) => p.status === 'competent').length,
      hours: t.totalS / 3600, landings: t.landingsDay + t.landingsNight,
    };
  }

  /** Apply a previewed import: replace, or merge into `current`. Returns the saved result. */
  applyImport(p: ImportPreview, mode: 'replace' | 'merge', current: TrainingSave | null): TrainingSave {
    const s = mode === 'merge' && current ? mergeSaves(current, p.save) : structuredClone(p.save);
    this.save(s);
    for (const [id, raw] of Object.entries(p.traces)) {
      const t = decodeTrace(raw);
      if (!t) continue;
      const isBest = Object.values(s.progress).some((x) => x.bestTraceId === id);
      const isChallenge = Object.values(s.bests).some((l) => l.some((b) => b.traceId === id));
      this.putEncoded(id, t.lessonId, raw, isBest ? 'best' : isChallenge ? 'challenge' : 'latest');
    }
    return s;
  }

  /** Delete the profile, traces and checkpoint ("RESET"). The welcome flag is kept. */
  reset(): void {
    for (const e of this.traceIndex()) this.remove(traceKey(e.id));
    for (const k of [TRAINING_KEY, PREV_KEY, TRACE_INDEX_KEY, CHECKPOINT_KEY]) this.remove(k);
    for (let n = 0; n <= TRAINING_SCHEMA; n++) this.remove(backupKey(n));
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.pending = null;
    this.current = null;
    this.st = 'ok';   // a read-only (newer) file is gone too
  }
}

/** JSON.parse that returns undefined instead of throwing. */
function safeParse(raw: string | null): unknown {
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

/** `fs-training-<student>-<yyyy-mm-dd>.json` */
export function exportFileName(s: TrainingSave, now: Date): string {
  const name = s.profile.studentName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'student';
  return `fs-training-${name}-${now.toISOString().slice(0, 10)}.json`;
}

// ---- merge ---------------------------------------------------------------------------------------------

const STATUS_RANK: Record<LessonProgress['status'], number> = { locked: 0, available: 1, competent: 2 };
const earliest = (a: string | undefined, b: string | undefined): string | undefined =>
  a === undefined ? b : b === undefined ? a : Date.parse(a) <= Date.parse(b) ? a : b;

function mergeProgress(a: LessonProgress, b: LessonProgress): LessonProgress {
  // The better record (status, then stars, then attempts) leads; exercises keep the best grade of either.
  const key = (p: LessonProgress): number[] => [STATUS_RANK[p.status], p.bestStars, p.attempts];
  const ka = key(a), kb = key(b);
  const aBetter = ka[0] !== kb[0] ? ka[0] > kb[0] : ka[1] !== kb[1] ? ka[1] > kb[1] : ka[2] >= kb[2];
  const [lead, other] = aBetter ? [a, b] : [b, a];
  const out: LessonProgress = structuredClone(lead);
  out.attempts = Math.max(a.attempts, b.attempts);
  out.bestStars = Math.max(a.bestStars, b.bestStars);
  const completedAt = earliest(a.completedAt, b.completedAt);
  if (completedAt) out.completedAt = completedAt;
  // Sign-offs only merge within the same lesson version.
  if (other.lessonVersion === lead.lessonVersion) {
    for (const [id, e] of Object.entries(other.exercises)) {
      const mine = out.exercises[id];
      if (!mine) { out.exercises[id] = structuredClone(e); continue; }
      const competentAt = earliest(mine.competentAt, e.competentAt);
      out.exercises[id] = { best: Math.max(mine.best, e.best) as Grade, last: mine.last, ...(competentAt ? { competentAt } : {}) };
    }
  }
  return out;
}

/** Merge rules for import (section 3.11): logbook union by id, better progress, best grades, bests top 5... */
export function mergeSaves(a: TrainingSave, b: TrainingSave): TrainingSave {
  const newer = Date.parse(b.updatedAt) > Date.parse(a.updatedAt) ? b : a;
  const out: TrainingSave = structuredClone(newer);
  out.createdAt = earliest(a.createdAt, b.createdAt) ?? newer.createdAt;
  out.updatedAt = newer.updatedAt;

  // Logbook: union by id, in date order (the newer copy's line wins: remarks are edited there).
  const lines = new Map<string, TrainingSave['logbook'][number]>();
  for (const e of [...(newer === a ? b : a).logbook, ...newer.logbook]) lines.set(e.id, structuredClone(e));
  out.logbook = [...lines.values()].sort((x, y) => Date.parse(x.date) - Date.parse(y.date));

  out.progress = {};
  for (const id of new Set([...Object.keys(a.progress), ...Object.keys(b.progress)])) {
    const pa = a.progress[id], pb = b.progress[id];
    out.progress[id] = pa && pb ? mergeProgress(pa, pb) : structuredClone((pa ?? pb) as LessonProgress);
  }

  // Endorsements: union with the earliest date.
  const ends = new Map<string, TrainingSave['endorsements'][number]>();
  for (const e of [...a.endorsements, ...b.endorsements]) {
    const old = ends.get(e.id);
    if (!old || Date.parse(e.at) < Date.parse(old.at)) ends.set(e.id, structuredClone(e));
  }
  out.endorsements = [...ends.values()].sort((x, y) => Date.parse(x.at) - Date.parse(y.at));

  // Results: union by attempt, the last 3 per lesson.
  out.results = {};
  for (const id of new Set([...Object.keys(a.results), ...Object.keys(b.results)])) {
    const byAttempt = new Map<string, TrainingSave['results'][string][number]>();
    for (const r of [...(a.results[id] ?? []), ...(b.results[id] ?? [])]) byAttempt.set(r.attemptId, structuredClone(r));
    out.results[id] = [...byAttempt.values()].sort((x, y) => Date.parse(x.endedAt) - Date.parse(y.endedAt)).slice(-3);
  }

  // Challenge bests: merged and re-trimmed to 5 per authority.
  out.bests = {};
  for (const id of new Set([...Object.keys(a.bests), ...Object.keys(b.bests)])) {
    let list: TrainingSave['bests'][string] = [];
    const seen = new Set<string>();
    for (const x of [...(a.bests[id] ?? []), ...(b.bests[id] ?? [])]) {
      const k = `${x.authority}|${x.at}|${x.score}`;
      if (seen.has(k)) continue;
      seen.add(k);
      list = addBest(list, structuredClone(x));
    }
    out.bests[id] = list;
  }

  // Test history: union by time and outcome.
  const tests = new Map<string, TrainingSave['testHistory'][number]>();
  for (const t of [...a.testHistory, ...b.testHistory]) tests.set(`${t.at}|${t.outcome}`, structuredClone(t));
  out.testHistory = [...tests.values()].sort((x, y) => Date.parse(x.at) - Date.parse(y.at));

  const safe = Math.max(a.records?.safeLandings ?? 0, b.records?.safeLandings ?? 0);
  out.records = { safeLandings: safe };
  return out;
}
