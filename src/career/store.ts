// The Career store (docs/career.md "Persistence, boot and reloads"): the save under CAREER_KEY ('fs.career.v1')
// with a previous-good copy and migration backups, modelled on the school's TrainingStore
// (src/training/career/store.ts) without its traces, checkpoint and welcome flag. It never reads or writes the
// school's `fs.training.v1` keys.
//
// Every storage access is in try/catch. Writes are verified: copy the current value to `.prev` when it still
// validates, write, read back. Any failure (quota, a throwing or missing storage) leaves the career in memory with
// status 'memoryOnly' (the UI says "use Export") and never throws; a file of a newer schema is opened read-only.
// Where the save is kept is the URL's `cstore=` (careerKv): 'local' localStorage, 'mem' an in-memory map (the
// school's memoryStore), 'session' sessionStorage (survives the same-tab reload of a type switch).
//
// Migrations: schema 1 is the first, so the table below is empty; a later schema adds MIGRATIONS[n] (n -> n + 1)
// and the store writes `${CAREER_BACKUP_PREFIX}${n}` before running it.

import { browserStore, type KeyValueStore } from '../sim/resume';
import { memoryStore } from '../training/career/store';
import { createCareer, type CareerCreateContext, type CareerForm } from './create';
import {
  CAREER_BACKUP_PREFIX, CAREER_KEY, CAREER_PREV_KEY, CAREER_SAVE_DEBOUNCE_MS, CAREER_SCHEMA,
  type CareerSave, type CareerStoreKind,
} from './types';
import { validateCareerSave } from './validate';

/** 'memoryOnly' after a failed write or with no storage (banner "use Export"); 'readOnly' for a newer schema. */
export type CareerStoreStatus = 'ok' | 'memoryOnly' | 'readOnly';

/** The export file: a wrapper around the save (import also takes a bare save). */
interface CareerExportFile {
  format: 'fs-career'; version: 1; exportedAt: string; app: { build: string };
  data: CareerSave;
}

/** Migrations of older schemas: MIGRATIONS[n] upgrades a schema-n save to n + 1. Empty at schema 1. */
export const CAREER_MIGRATIONS: Readonly<Record<number, (v: Record<string, unknown>) => Record<string, unknown>>> = {};

/** Run the migrations from `from` up to CAREER_SCHEMA (not yet validated); throws where a step is missing. */
export function migrateCareer(v: Record<string, unknown>, from: number): Record<string, unknown> {
  let out = v;
  for (let n = from; n < CAREER_SCHEMA; n++) {
    const m = CAREER_MIGRATIONS[n];
    if (!m) throw new Error(`no migration from career schema ${n}`);
    out = { ...m(out), schema: n + 1 };
  }
  return out;
}

/** The pre-migration backup key of schema n. */
export const careerBackupKey = (schema: number): string => `${CAREER_BACKUP_PREFIX}${schema}`;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** JSON.parse that returns undefined instead of throwing. */
function safeParse(raw: string | null): unknown {
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

/** window.sessionStorage, or null where it is missing or throws on access (sandboxed or private pages). */
export function sessionKv(): KeyValueStore | null {
  try {
    const s = (globalThis as { sessionStorage?: KeyValueStore }).sessionStorage;
    return s ?? null;
  } catch {
    return null;
  }
}

/** The KeyValueStore for a `cstore=` kind: localStorage, a fresh in-memory map, or sessionStorage (null if unavailable). */
export function careerKv(kind: CareerStoreKind): KeyValueStore | null {
  switch (kind) {
    case 'mem': return memoryStore();
    case 'session': return sessionKv();
    default: return browserStore();
  }
}

/**
 * The Career save on one KeyValueStore: load (with `.prev` recovery and migration), verified writes, a debounced
 * save, reset, export and import. Never throws on storage failure; `status` says what persisted.
 */
export class CareerStore {
  private readonly kv: KeyValueStore | null;
  /** Where the save is kept (`cstore=`): only 'local' ever writes a resume block. */
  readonly kind: CareerStoreKind;
  private st: CareerStoreStatus = 'ok';
  private cur: CareerSave | null = null;
  private pending: CareerSave | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** Load fell back to `.prev` (the UI shows a toast once). */
  recoveredFromPrev = false;
  /** Reasons for entities dropped by the last load or import. */
  lastDropped: string[] = [];

  /** `kv` null: no storage (the career works in memory, status 'memoryOnly' at the first save). */
  constructor(kv: KeyValueStore | null, kind: CareerStoreKind = 'local') {
    this.kv = kv;
    this.kind = kind;
  }

  /** A store on the KV `cstore=` names (careerKv). */
  static forKind(kind: CareerStoreKind): CareerStore {
    return new CareerStore(careerKv(kind), kind);
  }

  get status(): CareerStoreStatus {
    return this.st;
  }

  /** The save last loaded, created into the store, saved or imported (null: no career). */
  get current(): CareerSave | null {
    return this.cur;
  }

  // ---- guarded storage access ----------------------------------------------------------------------------

  private get(key: string): string | null {
    try {
      return this.kv?.getItem(key) ?? null;
    } catch {
      return null;
    }
  }

  private set(key: string, value: string): boolean {
    if (!this.kv) return false;
    try {
      this.kv.setItem(key, value);
      return true;
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

  // ---- the save ----------------------------------------------------------------------------------------

  /** Parse, migrate (writing the backup first) and validate one stored value; null when unusable. */
  private parse(raw: string | null, writeBackup: boolean): CareerSave | null {
    const v0 = safeParse(raw);
    if (!isObj(v0) || v0.format !== 'fs-career' || typeof v0.schema !== 'number') return null;
    let v: Record<string, unknown> = v0;
    const schema = v0.schema;
    if (schema > CAREER_SCHEMA) {
      // A newer build wrote this: show it, never overwrite it.
      this.st = 'readOnly';
      const r = validateCareerSave({ ...v, schema: CAREER_SCHEMA });
      return r ? r.save : null;
    }
    if (schema < CAREER_SCHEMA) {
      if (writeBackup && raw !== null) this.set(careerBackupKey(schema), raw);
      try {
        v = migrateCareer(v, schema);
      } catch {
        return null;
      }
    }
    const r = validateCareerSave(v);
    if (!r) return null;
    this.lastDropped = r.dropped;
    for (const d of r.dropped) console.warn(`[career] dropped from the career save: ${d}`);
    return r.save;
  }

  /** Load (falling back to `.prev` when the save is unreadable, migrating older schemas); null when there is no career. */
  load(): CareerSave | null {
    this.recoveredFromPrev = false;
    this.lastDropped = [];
    const raw = this.get(CAREER_KEY);
    let save = this.parse(raw, true);
    if (!save && raw !== null && this.st !== 'readOnly') {
      save = this.parse(this.get(CAREER_PREV_KEY), false);
      if (save) {
        this.recoveredFromPrev = true;
        console.warn('[career] the career save was unreadable; restored the previous copy');
      }
    }
    const rawSchema = (safeParse(raw) as { schema?: unknown } | undefined)?.schema;
    if (save && this.st !== 'readOnly' && (this.recoveredFromPrev || rawSchema !== CAREER_SCHEMA)) {
      this.save(save);   // persist the migration (its backup is already written) or the recovered copy
    }
    this.cur = save;
    return save;
  }

  /** A new career from the first-open form (src/career/create.ts). Not written until save(). */
  create(form: CareerForm, ctx: CareerCreateContext): CareerSave {
    return createCareer(form, ctx);
  }

  /**
   * Write now: copy the stored value to `.prev` when it validates, write, read back. False when it could not be
   * persisted (the career stays in memory; status 'memoryOnly' until a later write succeeds). Never throws.
   */
  save(s: CareerSave): boolean {
    this.cur = s;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.pending = null;
    if (this.st === 'readOnly') return false;
    if (!this.kv) {
      this.st = 'memoryOnly';
      return false;
    }
    let json: string;
    try {
      json = JSON.stringify(s);
    } catch {
      this.st = 'memoryOnly';
      return false;
    }
    const old = this.get(CAREER_KEY);
    // Only a value that still reads back as a Career save becomes the previous-good copy.
    if (old !== null && old !== json && validateCareerSave(safeParse(old))) this.set(CAREER_PREV_KEY, old);
    if (this.set(CAREER_KEY, json) && this.get(CAREER_KEY) === json) {
      this.st = 'ok';
      return true;
    }
    this.st = 'memoryOnly';
    return false;
  }

  /** Debounced save (CAREER_SAVE_DEBOUNCE_MS) for settings and small changes; flush() on pagehide. */
  saveSoon(s: CareerSave): void {
    this.cur = s;
    this.pending = s;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), CAREER_SAVE_DEBOUNCE_MS);
  }

  /** Write a pending saveSoon at once (pagehide, beforeunload, a reload). */
  flush(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    const p = this.pending;
    this.pending = null;
    if (p) this.save(p);
  }

  /** Delete the save, its previous copy and the backups ("Start a new career"). */
  reset(): void {
    for (const k of [CAREER_KEY, CAREER_PREV_KEY]) this.remove(k);
    for (let n = 0; n <= CAREER_SCHEMA; n++) this.remove(careerBackupKey(n));
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.pending = null;
    this.cur = null;
    this.lastDropped = [];
    this.recoveredFromPrev = false;
    this.st = 'ok';   // a read-only (newer) save is gone too
  }

  // ---- export / import ------------------------------------------------------------------------------------

  /** The export file's JSON text (see careerExportFileName). */
  exportJson(s: CareerSave, build: string, now: Date): string {
    const file: CareerExportFile = { format: 'fs-career', version: 1, exportedAt: now.toISOString(), app: { build }, data: s };
    return JSON.stringify(file);
  }

  /** Parse, migrate and validate an export (or a bare save); nothing is written. Throws with a reason when unusable. */
  previewImport(json: string): CareerSave {
    let v: unknown;
    try {
      v = JSON.parse(json);
    } catch {
      throw new Error('The file is not valid JSON.');
    }
    if (!isObj(v) || v.format !== 'fs-career') throw new Error('This is not a Career export.');
    let data: unknown = 'data' in v ? v.data : v;
    if (!isObj(data) || typeof data.schema !== 'number') throw new Error('The file has no career data.');
    const schema = data.schema;
    if (schema > CAREER_SCHEMA) throw new Error('The file comes from a newer version of the simulator.');
    if (schema < CAREER_SCHEMA) {
      try {
        data = migrateCareer(data, schema);
      } catch {
        throw new Error(`The file's format (schema ${schema}) can't be upgraded.`);
      }
    }
    const r = validateCareerSave(data);
    if (!r) throw new Error('The career data in the file is damaged.');
    this.lastDropped = r.dropped;
    return r.save;
  }

  /** Import an export, replacing the current career, and save it at once. Throws (writing nothing) when unusable. */
  importJson(json: string): CareerSave {
    const s = this.previewImport(json);
    if (this.st === 'readOnly') this.st = 'ok';   // the player chose to replace the newer save
    this.save(s);
    return s;
  }
}

/** `fs-career-<company>-<yyyy-mm-dd>.json` */
export function careerExportFileName(s: CareerSave, now: Date): string {
  const name = s.company.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'company';
  return `fs-career-${name}-${now.toISOString().slice(0, 10)}.json`;
}
