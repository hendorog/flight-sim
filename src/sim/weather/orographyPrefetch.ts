// The browser's source of mountain-wave tile solutions (physics/weather/orography/orographyField.ts
// OrographySource): one worker (orographyWorker.ts) solves the tiles the wind field asks for and the ones the
// aircraft will need soon. Registered for the world terrain (terrainHeight) before the physics is built, so the
// main thread never solves a tile of the world terrain itself; a miss reads as no terrain terms for that tile until
// the solution arrives, after which it ramps in (OrographyField).
//
// update() runs once per frame from the Simulator with the aircraft position and velocity: the wanted list becomes
// the tiles with weight > 0 at the position and LOOKAHEAD_S ahead along the velocity, for the current wave weather.
// A newer list replaces the queued one (one job is in the worker at a time; what is queued is not sent yet). A weather
// edit therefore drops the queue of the old weather.

import { tileFloor, tileWeight1d, TILE_SPACING } from '../../physics/weather/orography/tiles';
import type { OrographyField, OrographySource } from '../../physics/weather/orography/orographyField';
import type { TileSolution, WaveWeather } from '../../physics/weather/orography/tileSolve';
import type { WorkerSetup } from '../../world/terrain/terrainWorker';

export type OrographyJob = { kind: 'solve'; id: number; ti: number; tj: number; ww: WaveWeather; key: string };
export type OrographyReply = { id: number; key: string; sol: TileSolution; terrainMs: number };

/** Solutions kept on the main thread (8.3 MB each at 256 x 256, 18 levels). */
const KEEP = 10;
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
  private readonly worker: Worker;
  private readonly solutions = new Map<string, TileSolution>();
  private want: Want[] = [];
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

  get(ti: number, tj: number, ww: WaveWeather, key: string): TileSolution | null {
    const k = solKey(ti, tj, key);
    const s = this.solutions.get(k);
    if (s) return s;
    if (k !== this.inflight && !this.want.some((x) => x.ti === ti && x.tj === tj && x.key === key)) {
      // A newer wave weather replaces the queue of an older one.
      if (this.want.length > 0 && this.want[0].key !== key) this.want = [];
      this.want.push({ ti, tj, ww, key });
      this.pump();
    }
    return null;
  }

  /** Once per frame: queue the tiles needed at the aircraft position and ahead of it (see the header). */
  update(field: OrographyField, north: number, east: number, vNorth: number, vEast: number): void {
    const ww = field.waveWeather;
    const key = field.waveKey;
    if (!ww || !key) return;
    const want: Want[] = [];
    for (const dt of LOOKAHEAD_S) {
      const n = north + vNorth * dt;
      const e = east + vEast * dt;
      for (let ti = tileFloor(n); ti <= tileFloor(n) + 1; ti++) {
        if (tileWeight1d(n - ti * TILE_SPACING) === 0) continue;
        for (let tj = tileFloor(e); tj <= tileFloor(e) + 1; tj++) {
          if (tileWeight1d(e - tj * TILE_SPACING) === 0) continue;
          const k = solKey(ti, tj, key);
          if (this.solutions.has(k) || k === this.inflight || want.some((x) => x.ti === ti && x.tj === tj)) continue;
          want.push({ ti, tj, ww, key });
        }
      }
    }
    this.want = want;
    this.pump();
  }

  private pump(): void {
    if (!this.setupDone || this.inflight !== null) return;
    const next = this.want.shift();
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
    const t = { tile: `${r.sol.ti},${r.sol.tj}`, solveMs: Math.round(r.sol.ms), terrainMs: Math.round(r.terrainMs) };
    this.timings.push(t);
    console.log(`[orography] tile ${t.tile} solved in ${t.solveMs} ms (terrain ${t.terrainMs} ms)`);
    this.pump();
  }

  dispose(): void {
    this.worker.terminate();
    this.solutions.clear();
    this.want = [];
  }
}
