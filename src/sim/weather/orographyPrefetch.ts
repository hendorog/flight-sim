// The browser's source of mountain-wave tile solutions (physics/weather/orography/orographyField.ts
// OrographySource): one worker (orographyWorker.ts) solves the tiles the wind field asks for and the ones the
// aircraft will need soon. Registered for the world terrain (terrainHeight) before the physics is built, so the
// main thread never solves a tile of the world terrain itself; a miss reads as no terrain terms for that tile until
// the solution arrives, after which it ramps in (OrographyField).
//
// Two queues feed the worker, one job at a time:
//   - requested: tiles get() missed (any sampler: the aircraft, an airfield windsock), in the order asked;
//   - wanted: rebuilt once per frame by update() from the aircraft position and LOOKAHEAD_S ahead along its velocity.
// The requested queue goes first; update() never replaces it. Both drop the entries of a wave key the field no longer
// uses (neither its current nor its waiting key). A tile the field still holds, or kept here, is not queued.
// Received solutions are kept in a least-recently-used map of KEEP; get() refreshes an entry.

import { tileFloor, tileWeight1d, TILE_SPACING } from '../../physics/weather/orography/tiles';
import type { OrographyField, OrographySource } from '../../physics/weather/orography/orographyField';
import type { TileSolution, WaveWeather } from '../../physics/weather/orography/tileSolve';
import type { WorkerSetup } from '../../world/terrain/terrainWorker';

export type OrographyJob = { kind: 'solve'; id: number; ti: number; tj: number; ww: WaveWeather; key: string };
export type OrographyReply = { id: number; key: string; sol: TileSolution; terrainMs: number };

/**
 * Solutions kept here, least recently used dropped first. A solution with waves holds 8,939,760 bytes (window 193 x 193,
 * 18 levels x 3 fields plus 6 terrain and shelter windows, float32).
 */
export const KEEP = 10;
/** Look-ahead times along the velocity for the wanted tiles, s. */
const LOOKAHEAD_S = [0, 60, 180];

interface Want {
  ti: number;
  tj: number;
  ww: WaveWeather;
  key: string;
}

const solKey = (ti: number, tj: number, key: string): string => `${ti},${tj}:${key}`;

export class OrographyPrefetch implements OrographySource {
  readonly sync = false;
  /** Bumped on every solution received (OrographySource.version). */
  version = 0;
  private readonly worker: Worker;
  private readonly solutions = new Map<string, TileSolution>();
  private requested: Want[] = [];
  private wanted: Want[] = [];
  private inflight: string | null = null;
  private setupDone = false;
  private nextId = 1;
  /** Solve times of the tiles received, ms (diagnostics: window.__sim.orography). */
  readonly timings: { tile: string; solveMs: number; terrainMs: number }[] = [];

  constructor() {
    this.worker = new Worker(new URL('./orographyWorker.ts', import.meta.url), { type: 'module', name: 'orography' });
    this.worker.onmessage = (e: MessageEvent<OrographyReply>) => this.receive(e.data);
    this.worker.onerror = (e) => {
      console.error('[orography] worker error', e.message);
      this.inflight = null;
    };
  }

  /** The world setup (era, seed, town site: the terrain workers' setup); jobs are sent only after it. */
  setup(setup: WorkerSetup): void {
    this.worker.postMessage(setup);
    this.setupDone = true;
    this.pump();
  }

  /** Solutions kept here (diagnostics and tests). */
  get kept(): number {
    return this.solutions.size;
  }

  get(ti: number, tj: number, ww: WaveWeather, key: string): TileSolution | null {
    const k = solKey(ti, tj, key);
    const s = this.solutions.get(k);
    if (s) {
      // Least recently used: a read moves the entry to the end.
      this.solutions.delete(k);
      this.solutions.set(k, s);
      return s;
    }
    if (k !== this.inflight && !queued(this.requested, ti, tj, key)) {
      this.requested.push({ ti, tj, ww, key });
      this.pump();
    }
    return null;
  }

  /** Once per frame: rebuild the wanted queue at the aircraft position and ahead of it (see the header). */
  update(field: OrographyField, north: number, east: number, vNorth: number, vEast: number): void {
    const key = field.pendingWaveKey ?? field.waveKey;
    const ww = field.pendingWaveWeather ?? field.waveWeather;
    if (!ww || !key) return;
    const current = field.waveKey;
    if (this.requested.some((x) => x.key !== key && x.key !== current)) this.requested = this.requested.filter((x) => x.key === key || x.key === current);
    const wanted: Want[] = [];
    for (const dt of LOOKAHEAD_S) {
      const n = north + vNorth * dt;
      const e = east + vEast * dt;
      for (let ti = tileFloor(n); ti <= tileFloor(n) + 1; ti++) {
        if (tileWeight1d(n - ti * TILE_SPACING) === 0) continue;
        for (let tj = tileFloor(e); tj <= tileFloor(e) + 1; tj++) {
          if (tileWeight1d(e - tj * TILE_SPACING) === 0) continue;
          const k = solKey(ti, tj, key);
          if (field.holds(ti, tj, key) || this.solutions.has(k) || k === this.inflight) continue;
          if (queued(wanted, ti, tj, key) || queued(this.requested, ti, tj, key)) continue;
          wanted.push({ ti, tj, ww, key });
        }
      }
    }
    this.wanted = wanted;
    this.pump();
  }

  private pump(): void {
    if (!this.setupDone || this.inflight !== null) return;
    let next = this.requested.shift() ?? this.wanted.shift();
    // A requested tile may have arrived meanwhile under the wanted queue (or the reverse): skip what is kept.
    while (next && this.solutions.has(solKey(next.ti, next.tj, next.key))) next = this.requested.shift() ?? this.wanted.shift();
    if (!next) return;
    this.inflight = solKey(next.ti, next.tj, next.key);
    const job: OrographyJob = { kind: 'solve', id: this.nextId++, ti: next.ti, tj: next.tj, ww: next.ww, key: next.key };
    this.worker.postMessage(job);
  }

  private receive(r: OrographyReply): void {
    const k = solKey(r.sol.ti, r.sol.tj, r.key);
    this.solutions.set(k, r.sol);
    while (this.solutions.size > KEEP) this.solutions.delete(this.solutions.keys().next().value as string);
    this.inflight = null;
    this.version++;
    const t = { tile: `${r.sol.ti},${r.sol.tj}`, solveMs: Math.round(r.sol.ms), terrainMs: Math.round(r.terrainMs) };
    this.timings.push(t);
    console.log(`[orography] tile ${t.tile} solved in ${t.solveMs} ms (terrain ${t.terrainMs} ms)`);
    this.pump();
  }

  dispose(): void {
    this.worker.terminate();
    this.solutions.clear();
    this.requested = [];
    this.wanted = [];
  }
}

const queued = (q: readonly Want[], ti: number, tj: number, key: string): boolean => q.some((x) => x.ti === ti && x.tj === tj && x.key === key);
