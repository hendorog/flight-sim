// The terrain-wave and near-surface terrain fields at a point (design sections 5.1, 5.6, 6): the weighted sum over
// the orography tiles covering the point (tiles.ts) of each tile's solution (tileSolve.ts) for the current wave
// weather. One instance per WindField; the solutions come from a source shared by terrain function:
//   - node / tests (and any terrain without a registered source): solved synchronously on first use and cached
//     (module-level LRU of SOLUTION_CACHE solutions and TERRAIN_CACHE tile terrains);
//   - the browser: setOrographySource() registers the worker-backed source (sim/weather/orographyPrefetch.ts) for
//     the world terrain; a missing solution is requested and reads as absent until it arrives.
// Continuity in time: a solution that arrives after a miss ramps in over FADE_S simulated seconds; after a change of
// the wave weather the previous solutions fade out over FADE_S while the new ones (synchronous: at once; worker: on
// arrival) fade in. reset() (a scenario reset) ends every fade. Allocation-free per sample.

import type { WeatherSettings, WindAloftLevel } from '../../../core/types';
import { windsAloftOf } from '../../../core/weatherFields';
import { buildTileTerrain, type TileTerrain } from './terrainGrid';
import { OUTPUT_LEVELS_M, STORED_KINDS, solveTile, waveWeatherKey, waveWeatherOf, type TileSolution, type WaveWeather } from './tileSolve';
import { TILE_CENTRE, TILE_DX, TILE_SPACING, WINDOW_N, WINDOW_START, tileFloor, tileWeight1d } from './tiles';

export type HeightFn = (north: number, east: number) => number;

/** Fade time of a solution in or out, s (simulated). */
export const FADE_S = 3;
/** Solutions kept by the synchronous source. */
const SOLUTION_CACHE = 8;
/** Tile terrains kept by the synchronous source. */
const TERRAIN_CACHE = 16;
/** A tile that missed is queried again after this much simulated time, s. */
const REQUERY_S = 0.25;
/** Entries a field keeps per wave weather before dropping the farthest. */
const MAX_ENTRIES = 12;

/** Where the solutions come from. */
export interface OrographySource {
  /** True when get() never misses (computes on demand). */
  readonly sync: boolean;
  /** The solution of tile (ti, tj) for the wave weather, or null when not available yet (then requested). */
  get(ti: number, tj: number, ww: WaveWeather, key: string): TileSolution | null;
}

// ---------------------------------------------------------------------------------------------- synchronous source
const fnIds = new WeakMap<HeightFn, number>();
let nextFnId = 1;
const fnId = (f: HeightFn): number => {
  let id = fnIds.get(f);
  if (id === undefined) {
    id = nextFnId++;
    fnIds.set(f, id);
  }
  return id;
};

const terrainCache = new Map<string, TileTerrain>();
const solutionCache = new Map<string, TileSolution>();

function lruGet<T>(m: Map<string, T>, k: string): T | undefined {
  const v = m.get(k);
  if (v !== undefined) {
    m.delete(k);
    m.set(k, v);
  }
  return v;
}

function lruSet<T>(m: Map<string, T>, k: string, v: T, max: number): void {
  m.set(k, v);
  while (m.size > max) m.delete(m.keys().next().value as string);
}

/** The tile terrain of a terrain function (cached). */
export function tileTerrainOf(heightFn: HeightFn, ti: number, tj: number): TileTerrain {
  const k = `${fnId(heightFn)}:${ti},${tj}`;
  let t = lruGet(terrainCache, k);
  if (!t) {
    t = buildTileTerrain(heightFn, ti, tj);
    lruSet(terrainCache, k, t, TERRAIN_CACHE);
  }
  return t;
}

/** Solve synchronously (cached): the node path, and the reference the worker path must reproduce. */
export function syncSolution(heightFn: HeightFn, ti: number, tj: number, ww: WaveWeather, key: string): TileSolution {
  const k = `${fnId(heightFn)}:${ti},${tj}:${key}`;
  let s = lruGet(solutionCache, k);
  if (!s) {
    s = solveTile(tileTerrainOf(heightFn, ti, tj), ww);
    lruSet(solutionCache, k, s, SOLUTION_CACHE);
  }
  return s;
}

/** Drop the synchronous caches (tests). */
export function clearOrographyCaches(): void {
  terrainCache.clear();
  solutionCache.clear();
}

const sources = new Map<HeightFn, OrographySource>();

/** Register (or with null remove) the source for a terrain function; others are solved synchronously. */
export function setOrographySource(heightFn: HeightFn, source: OrographySource | null): void {
  if (source) sources.set(heightFn, source);
  else sources.delete(heightFn);
}

// ---------------------------------------------------------------------------------------------- the field
/** The terrain terms at a point, before the limiter, the gain and the site mask (OrographyField.sample). */
export interface OrographySample {
  /** Wave perturbation: north, east, up, m/s. */
  waveN: number;
  waveE: number;
  waveW: number;
  /** Lee-shelter excess, m (weighted). */
  shelter: number;
  /** Envelope, m MSL (normalised over the tiles that have one); 0 when none. */
  envelope: number;
  /** Channelling tensor a n n^T (weighted). */
  nn: number;
  ne: number;
  ee: number;
}

export function emptyOrographySample(): OrographySample {
  return { waveN: 0, waveE: 0, waveW: 0, shelter: 0, envelope: 0, nn: 0, ne: 0, ee: 0 };
}

interface Entry {
  sol: TileSolution;
  /** Simulated time the solution starts to ramp in (-Infinity: in full). */
  start: number;
}

const ramp = (x: number): number => (x <= 0 ? 0 : x >= FADE_S ? 1 : x / FADE_S);
const pack = (ti: number, tj: number): number => (ti + 4096) * 8192 + (tj + 4096);
const LEVELS = OUTPUT_LEVELS_M.length;
const KINDS = STORED_KINDS.length;
const CELLS = WINDOW_N * WINDOW_N;

export class OrographyField {
  private cur = new Map<number, Entry>();
  private prev = new Map<number, Entry>();
  private prevStart = -Infinity;
  private key: string | null = null;
  private keyTime = -Infinity;
  private ww: WaveWeather | null = null;
  /** Tiles that missed (worker source) for the current key, with the time of the last query: they ramp in on arrival. */
  private readonly missed = new Map<number, number>();
  // Change detection of the wave weather.
  private kDir = NaN;
  private kSpeed = NaN;
  private kDay = NaN;
  private kIsa = NaN;
  private kTable: readonly WindAloftLevel[] | undefined | null = null;
  private lastN = 0;
  private lastE = 0;

  constructor(readonly heightFn: HeightFn) {}

  /** The current wave weather and its key (null before the first update). */
  get waveWeather(): WaveWeather | null {
    return this.ww;
  }

  get waveKey(): string | null {
    return this.key;
  }

  /** Track the settings; on a change of the wave weather at time t start the cross-fade. */
  update(w: WeatherSettings, t: number): void {
    const table = windsAloftOf(w);
    if (
      w.windDirectionDeg === this.kDir &&
      w.windSpeedKt === this.kSpeed &&
      w.dayOfYear === this.kDay &&
      w.isaDeviation === this.kIsa &&
      table === this.kTable
    ) {
      return;
    }
    this.kDir = w.windDirectionDeg;
    this.kSpeed = w.windSpeedKt;
    this.kDay = w.dayOfYear;
    this.kIsa = w.isaDeviation;
    this.kTable = table;
    const ww = waveWeatherOf(w, table);
    const key = waveWeatherKey(ww);
    this.ww = ww;
    if (key === this.key) return;
    const first = this.key === null;
    this.key = key;
    if (!first) {
      // Keep the older set while nothing of the newer one has arrived (a slider being dragged).
      if (this.cur.size > 0) {
        this.prev = this.cur;
        this.prevStart = t;
      }
      this.cur = new Map();
    }
    this.keyTime = first ? -Infinity : t;
    this.missed.clear();
  }

  /** End every fade (a scenario reset: the clock restarts). */
  reset(): void {
    for (const e of this.cur.values()) e.start = -Infinity;
    this.prev.clear();
    this.prevStart = -Infinity;
    this.keyTime = -Infinity;
  }

  private entry(ti: number, tj: number, t: number): Entry | null {
    const k = pack(ti, tj);
    const e = this.cur.get(k);
    if (e) return e;
    if (!this.ww || !this.key) return null;
    // A tile that missed is asked for again at most every REQUERY_S simulated seconds (no work per sample).
    const last = this.missed.get(k);
    if (last !== undefined && Math.abs(t - last) < REQUERY_S) return null;
    const src = sources.get(this.heightFn);
    const sol = src ? src.get(ti, tj, this.ww, this.key) : syncSolution(this.heightFn, ti, tj, this.ww, this.key);
    if (!sol) {
      this.missed.set(k, t);
      return null;
    }
    if (this.cur.size >= MAX_ENTRIES) this.evict();
    const entry: Entry = { sol, start: this.missed.has(k) ? t : this.keyTime };
    this.cur.set(k, entry);
    return entry;
  }

  private evict(): void {
    let far = -1;
    let farD = -1;
    for (const [k, e] of this.cur) {
      const d = Math.hypot(e.sol.ti * TILE_SPACING - this.lastN, e.sol.tj * TILE_SPACING - this.lastE);
      if (d > farD) [far, farD] = [k, d];
    }
    this.cur.delete(far);
  }

  /** The terms at NED (north, east) and altitude z m MSL, at simulated time t, into `out`. */
  sample(north: number, east: number, z: number, t: number, out: OrographySample): OrographySample {
    out.waveN = out.waveE = out.waveW = out.shelter = out.envelope = out.nn = out.ne = out.ee = 0;
    this.lastN = north;
    this.lastE = east;
    let envWeight = 0;
    const i0 = tileFloor(north);
    const j0 = tileFloor(east);
    const fadePrev = this.prev.size > 0 ? 1 - ramp(t - this.prevStart) : 0;
    if (fadePrev === 0 && this.prev.size > 0 && t >= this.prevStart) this.prev.clear();
    for (let ti = i0; ti <= i0 + 1; ti++) {
      const wn = tileWeight1d(north - ti * TILE_SPACING);
      if (wn === 0) continue;
      for (let tj = j0; tj <= j0 + 1; tj++) {
        const we = tileWeight1d(east - tj * TILE_SPACING);
        if (we === 0) continue;
        const ws = wn * we;
        const e = this.entry(ti, tj, t);
        if (e) {
          const r = ramp(t - e.start);
          if (r > 0) envWeight += this.accumulate(e.sol, north, east, z, ws * r, out);
        }
        if (fadePrev > 0) {
          const p = this.prev.get(pack(ti, tj));
          if (p) envWeight += this.accumulate(p.sol, north, east, z, ws * fadePrev, out);
        }
      }
    }
    if (envWeight > 0) out.envelope /= envWeight;
    return out;
  }

  /** Add one solution's terms with weight g; returns the weight its envelope carried (0 without one). */
  private accumulate(s: TileSolution, north: number, east: number, z: number, g: number, out: OrographySample): number {
    let x = (north - s.ti * TILE_SPACING) / TILE_DX + TILE_CENTRE - WINDOW_START;
    let y = (east - s.tj * TILE_SPACING) / TILE_DX + TILE_CENTRE - WINDOW_START;
    const max = WINDOW_N - 1;
    x = x < 0 ? 0 : x > max ? max : x;
    y = y < 0 ? 0 : y > max ? max : y;
    let i = Math.floor(x);
    let j = Math.floor(y);
    if (i >= max) i = max - 1;
    if (j >= max) j = max - 1;
    const fx = x - i;
    const fy = y - j;
    const o = i * WINDOW_N + j;
    const w00 = (1 - fx) * (1 - fy);
    const w10 = fx * (1 - fy);
    const w01 = (1 - fx) * fy;
    const w11 = fx * fy;
    const o10 = o + WINDOW_N;
    const o01 = o + 1;
    const o11 = o + WINDOW_N + 1;
    let envWeight = 0;
    if (s.envelope) {
      out.envelope += g * (s.envelope[o] * w00 + s.envelope[o10] * w10 + s.envelope[o01] * w01 + s.envelope[o11] * w11);
      envWeight = g;
      const nn = s.chanNN!;
      const ne = s.chanNE!;
      const ee = s.chanEE!;
      out.nn += g * (nn[o] * w00 + nn[o10] * w10 + nn[o01] * w01 + nn[o11] * w11);
      out.ne += g * (ne[o] * w00 + ne[o10] * w10 + ne[o01] * w01 + ne[o11] * w11);
      out.ee += g * (ee[o] * w00 + ee[o10] * w10 + ee[o01] * w01 + ee[o11] * w11);
    }
    if (s.shelter) {
      const sh = s.shelter;
      out.shelter += g * (sh[o] * w00 + sh[o10] * w10 + sh[o01] * w01 + sh[o11] * w11);
    }
    const f = s.fields;
    if (f && s.hEff) {
      const he = s.hEff;
      const hEff = he[o] * w00 + he[o10] * w10 + he[o01] * w01 + he[o11] * w11;
      // Terrain-following height above the tile mean, relaxing to z - mean aloft.
      const above = z - hEff;
      const zeta = z - s.mean - (hEff - s.mean) * Math.exp(-(above > 0 ? above : 0) / s.relaxDepth);
      let l = 0;
      let fl = 0;
      if (zeta >= OUTPUT_LEVELS_M[LEVELS - 1]) {
        l = LEVELS - 2;
        fl = 1;
      } else if (zeta > 0) {
        while (l < LEVELS - 2 && zeta >= OUTPUT_LEVELS_M[l + 1]) l++;
        fl = (zeta - OUTPUT_LEVELS_M[l]) / (OUTPUT_LEVELS_M[l + 1] - OUTPUT_LEVELS_M[l]);
      }
      const ga = g * (1 - fl);
      const gb = g * fl;
      const a = l * KINDS * CELLS;
      const b = (l + 1) * KINDS * CELLS;
      // kinds: w, u (north), v (east)
      out.waveW += ga * (f[a + o] * w00 + f[a + o10] * w10 + f[a + o01] * w01 + f[a + o11] * w11);
      out.waveW += gb * (f[b + o] * w00 + f[b + o10] * w10 + f[b + o01] * w01 + f[b + o11] * w11);
      const au = a + CELLS;
      const bu = b + CELLS;
      out.waveN += ga * (f[au + o] * w00 + f[au + o10] * w10 + f[au + o01] * w01 + f[au + o11] * w11);
      out.waveN += gb * (f[bu + o] * w00 + f[bu + o10] * w10 + f[bu + o01] * w01 + f[bu + o11] * w11);
      const av = au + CELLS;
      const bv = bu + CELLS;
      out.waveE += ga * (f[av + o] * w00 + f[av + o10] * w10 + f[av + o01] * w01 + f[av + o11] * w11);
      out.waveE += gb * (f[bv + o] * w00 + f[bv + o10] * w10 + f[bv + o01] * w01 + f[bv + o11] * w11);
    }
    return envWeight;
  }

  /**
   * True when every tile with weight > 0 at (north, east) has its solution for the current wave weather (the boot
   * wait in the browser). Requests the missing ones; one that has arrived is taken in full (no ramp).
   */
  ready(north: number, east: number): boolean {
    if (!this.ww || !this.key) return false;
    const src = sources.get(this.heightFn);
    if (!src) return true;
    let ok = true;
    const i0 = tileFloor(north);
    const j0 = tileFloor(east);
    for (let ti = i0; ti <= i0 + 1; ti++) {
      if (tileWeight1d(north - ti * TILE_SPACING) === 0) continue;
      for (let tj = j0; tj <= j0 + 1; tj++) {
        if (tileWeight1d(east - tj * TILE_SPACING) === 0) continue;
        const k = pack(ti, tj);
        if (this.cur.has(k)) continue;
        const sol = src.get(ti, tj, this.ww, this.key);
        // Waited for at boot: in full at once (no ramp).
        if (sol) this.cur.set(k, { sol, start: -Infinity });
        else ok = false;
      }
    }
    return ok;
  }
}
