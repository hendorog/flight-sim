// A seeded world's macro model cells (erosion.ts steadyLattice) and its mountains' threshold hillslopes (hillslopes.ts)
// for the main thread, before the Simulator builds the
// world (main.ts): read from this browser's cache (IndexedDB, keyed by the seed and erosion.ts MODEL_VERSION), or
// worked out once in one worker (macroWorker.ts) and cached, then handed to this thread's build
// (heightfield.ts provideSeededModel); the terrain workers get them in their setup message (TerrainSystem.ts). The
// build checks the cells' input key (the noise ground and uplift sampled, the settings): a stale entry is not used,
// the build works the model out itself, and rememberSeededModel stores the fresh one. Seed 0 has no model. Node (the
// tests) never comes here: each build works the model out itself, synchronously.

import { provideSeededModel, seededModel, type SeededModel } from './heightfield';
import { MODEL_VERSION } from './erosion';
import type { EraId } from '../era/types';
import type { ModelReply, ModelRequest } from './macroWorker';

/** What prepareSeededModel did, for the automation API and the boot log. */
export interface ModelPrep {
  seed: number;
  source: 'none' | 'cache' | 'worker' | 'failed';
  ms: number;
}
export let modelPrep: ModelPrep = { seed: 0, source: 'none', ms: 0 };

const DB_NAME = 'fs-terrain-model';
const STORE = 'models';
/** The key the cache entry handed over was stored under (rememberSeededModel writes when the build's differs). */
let cachedKey: string | null = null;
let cacheOn = true;

/**
 * Get the seed's model cells (the cache, else a worker) and hand them to this thread's next build. `cache` false
 * skips reading the cache (measurements: the cold path). Never throws.
 */
export async function prepareSeededModel(seed: number, era: EraId, cache = true): Promise<ModelPrep> {
  const t0 = performance.now();
  cacheOn = cache;
  cachedKey = null;
  if (seed === 0) return (modelPrep = { seed, source: 'none', ms: 0 });
  try {
    const hit = cache ? await readCached(seed) : null;
    if (hit) {
      cachedKey = hit.key;
      provideSeededModel(hit);
      return (modelPrep = { seed, source: 'cache', ms: performance.now() - t0 });
    }
    const model = await computeInWorker(seed, era);
    if (model) {
      provideSeededModel(model);
      // (Stored as a copy: this thread's build keeps the cells.)
      void writeCached(copyOf(model));
      cachedKey = model.key;
    }
    modelPrep = { seed, source: model ? 'worker' : 'failed', ms: performance.now() - t0 };
  } catch (err) {
    console.warn('[terrain] no model cells handed over; the world builds its model itself', err);
    modelPrep = { seed, source: 'failed', ms: performance.now() - t0 };
  }
  return modelPrep;
}

/** After the world is built: store its model cells if the cache had none or a stale entry for this seed. */
export function rememberSeededModel(): void {
  const m = seededModel();
  if (!m || !cacheOn || m.key === cachedKey) return;
  cachedKey = m.key;
  void writeCached(copyOf(m));
}

/** A copy of the model to store (this thread's build keeps its own arrays). */
function copyOf(m: SeededModel): SeededModel {
  const s = m.slopes;
  return { seed: m.seed, key: m.key, lattice: m.lattice.slice(), slopes: s ? { h: s.h.slice(), w: s.w.slice(), chan: s.chan.slice(), core: s.core.slice() } : null };
}

function computeInWorker(seed: number, era: EraId): Promise<SeededModel | null> {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('./macroWorker.ts', import.meta.url), { type: 'module', name: 'terrain-model' });
    w.onmessage = (e: MessageEvent<ModelReply>) => {
      w.terminate();
      resolve(e.data.model);
    };
    w.onerror = (e) => {
      w.terminate();
      reject(new Error(e.message));
    };
    const req: ModelRequest = { seed, era };
    w.postMessage(req);
  });
}

interface Entry {
  id: string;
  seed: number;
  key: string;
  lattice: ArrayBuffer;
  /** The threshold hillslopes' fine-grid fields (hillslopes.ts SlopeField), when the seed has them. */
  slopes?: { h: ArrayBuffer; w: ArrayBuffer; chan: ArrayBuffer; core: ArrayBuffer };
}

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

const entryId = (seed: number): string => `${seed}:${MODEL_VERSION}`;

async function readCached(seed: number): Promise<SeededModel | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(entryId(seed));
      req.onsuccess = () => {
        const e = req.result as Entry | undefined;
        db.close();
        if (!e || e.seed !== seed || !(e.lattice instanceof ArrayBuffer)) return resolve(null);
        const s = e.slopes;
        const slopes = s && s.h instanceof ArrayBuffer && s.w instanceof ArrayBuffer && s.chan instanceof ArrayBuffer && s.core instanceof ArrayBuffer ? { h: new Float32Array(s.h), w: new Uint8Array(s.w), chan: new Uint8Array(s.chan), core: new Uint8Array(s.core) } : null;
        resolve({ seed, key: e.key, lattice: new Float32Array(e.lattice), slopes });
      };
      req.onerror = () => {
        db.close();
        resolve(null);
      };
    } catch {
      db.close();
      resolve(null);
    }
  });
}

async function writeCached(m: SeededModel): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    const tx = db.transaction(STORE, 'readwrite');
    const entry: Entry = { id: entryId(m.seed), seed: m.seed, key: m.key, lattice: m.lattice.buffer as ArrayBuffer };
    if (m.slopes) entry.slopes = { h: m.slopes.h.buffer as ArrayBuffer, w: m.slopes.w.buffer as ArrayBuffer, chan: m.slopes.chan.buffer as ArrayBuffer, core: m.slopes.core.buffer as ArrayBuffer };
    tx.objectStore(STORE).put(entry);
    tx.oncomplete = () => db.close();
    tx.onerror = () => db.close();
  } catch {
    db.close();
  }
}
