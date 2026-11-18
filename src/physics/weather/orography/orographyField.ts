// The terrain-wave and near-surface terrain fields at a point (design sections 5.1, 5.6, 6): the weighted sum over
// the orography tiles covering the point (tiles.ts) of each tile's solution (tileSolve.ts) for the current wave
// weather. One instance per WindField; the solutions come from a source shared by terrain function:
//   - node / tests (and any terrain without a registered source): solved synchronously on first use and cached
//     (module-level LRU of SOLUTION_CACHE solutions and TERRAIN_CACHE tile terrains);
//   - the browser: setOrographySource() registers the worker-backed source (sim/weather/orographyPrefetch.ts) for
//     the world terrain; a missing solution is requested and reads as absent until it arrives.
// Cache keys hold the terrain function, its terrain tag (setTerrainTag: era and world seed for the world terrain)
// and the tile; a field's wave key holds the tag too, so a change of era or seed never reuses an old tile.
//
// Continuity in time:
//   - a solution that arrives after a miss ramps in over FADE_S simulated seconds; a tile that was evicted and is
//     found again without a miss keeps its ramp (no restart);
//   - a change of the wave weather turns the set on display into the fading set: each tile with the weight it had at
//     that moment, all scaled by 1 - ramp(t - change) over FADE_S, while the new set fades in. A further change while
//     that fade runs and part of the newer set is already on display waits until the fade ends (at most FADE_S), so
//     the field never steps; a change while nothing of the newer set is on display replaces it at once;
//   - reset(w) (a scenario reset) takes the current weather's set in full, with no fade; a sample more than
//     TIME_RESET s before the previous one is treated the same way (a clock set back).
// The day used by the wave weather is frozen at a reset and at a weather edit: the date advancing at midnight with the
// clock running re-solves nothing (the free-atmosphere wind of the flight itself still follows the date).
// Allocation-free per sample.

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
/** Entries a field keeps for its wave weather before dropping the least recently sampled one not in use. */
export const MAX_ENTRIES = 12;
/** An entry sampled within this simulated time before the current sample is in use and never dropped, s. */
const IN_USE_S = 1;
/** A sample this much earlier than the previous one is a clock set back (a reset), s (windField.ts TIME_RESET). */
const TIME_RESET = 1;

/** Where the solutions come from. */
export interface OrographySource {
  /** True when get() never misses (computes on demand). */
  readonly sync: boolean;
  /**
   * Bumped whenever a solution arrives (optional). A field asks again for a tile that missed only after it changed;
   * without it the field asks on every sample.
   */
  readonly version?: number;
  /** The solution of tile (ti, tj) for the wave weather, or null when not available yet (then requested). */
  get(ti: number, tj: number, ww: WaveWeather, key: string): TileSolution | null;
}

// ---------------------------------------------------------------------------------------------- terrain tags
const tags = new Map<HeightFn, () => string>();

/**
 * Register (or with null remove) the tag of a terrain function: a string that changes whenever the heights it returns
 * change (era, world seed). Part of every cache key and of the fields' wave keys. The function is called on every
 * sample: return the same string while nothing changed.
 */
export function setTerrainTag(heightFn: HeightFn, tag: (() => string) | null): void {
  if (tag) tags.set(heightFn, tag);
  else tags.delete(heightFn);
}

const tagOf = (f: HeightFn): string => {
  const t = tags.get(f);
  return t ? t() : '';
};

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

/** The tile terrain of a terrain function (cached on the function, its terrain tag and the tile). */
export function tileTerrainOf(heightFn: HeightFn, ti: number, tj: number): TileTerrain {
  const k = `${fnId(heightFn)}:${tagOf(heightFn)}:${ti},${tj}`;
  let t = lruGet(terrainCache, k);
  if (!t) {
    t = buildTileTerrain(heightFn, ti, tj);
    lruSet(terrainCache, k, t, TERRAIN_CACHE);
  }
  return t;
}

/** Solve synchronously (cached): the node path, and the reference the worker path must reproduce. */
export function syncSolution(heightFn: HeightFn, ti: number, tj: number, ww: WaveWeather, key: string): TileSolution {
  const k = `${fnId(heightFn)}:${tagOf(heightFn)}:${ti},${tj}:${key}`;
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
  /** Simulated time of the last sample that read it. */
  used: number;
}

/** A tile of the fading set: its solution and the weight it had on display when the fade started. */
interface Fading {
  sol: TileSolution;
  weight: number;
}

const ramp = (x: number): number => (x <= 0 ? 0 : x >= FADE_S ? 1 : x / FADE_S);
const pack = (ti: number, tj: number): number => (ti + 4096) * 8192 + (tj + 4096);
const LEVELS = OUTPUT_LEVELS_M.length;
const KINDS = STORED_KINDS.length;
const CELLS = WINDOW_N * WINDOW_N;

export class OrographyField {
  private cur = new Map<number, Entry>();
  private prev = new Map<number, Fading>();
  private prevStart = -Infinity;
  private key: string | null = null;
  private keyTime = -Infinity;
  private ww: WaveWeather | null = null;
  /** A newer wave weather waiting for the running fade to end (see the header). */
  private pendingKey: string | null = null;
  private pendingWw: WaveWeather | null = null;
  /** Tiles that missed (worker source) for the current key, with the source version at the miss. */
  private readonly missed = new Map<number, number>();
  /** Ramp start of every tile taken for the current key (kept when an entry is evicted). */
  private readonly starts = new Map<number, number>();
  // Change detection of the wave weather.
  private kDir = NaN;
  private kSpeed = NaN;
  private kDay = NaN;
  private kIsa = NaN;
  private kTime = NaN;
  private kTag: string | null = null;
  private kTable: readonly WindAloftLevel[] | undefined | null = null;
  /** The day of the year the wave weather uses (frozen at a reset and at an edit). */
  private waveDay = NaN;
  private lastT = -Infinity;

  constructor(readonly heightFn: HeightFn) {}

  /** The current wave weather and its key (null before the first update). */
  get waveWeather(): WaveWeather | null {
    return this.ww;
  }

  get waveKey(): string | null {
    return this.key;
  }

  /** The wave weather and key the field changes to when the running fade ends (null when none is waiting). */
  get pendingWaveWeather(): WaveWeather | null {
    return this.pendingWw;
  }

  get pendingWaveKey(): string | null {
    return this.pendingKey;
  }

  /** True when the field holds the solution of tile (ti, tj) for wave key `key`. */
  holds(ti: number, tj: number, key: string): boolean {
    return key === this.key && this.cur.has(pack(ti, tj));
  }

  /** Track the settings; on a change of the wave weather at time t start the cross-fade (or queue it). */
  update(w: WeatherSettings, t: number): void {
    this.track(w, t, false);
  }

  private track(w: WeatherSettings, t: number, resetting: boolean): void {
    const table = windsAloftOf(w);
    const tag = tagOf(this.heightFn);
    const lastTime = this.kTime;
    this.kTime = w.timeOfDay;
    const same =
      w.windDirectionDeg === this.kDir &&
      w.windSpeedKt === this.kSpeed &&
      w.isaDeviation === this.kIsa &&
      table === this.kTable &&
      tag === this.kTag;
    const dayChanged = w.dayOfYear !== this.kDay;
    if (same && !dayChanged && !resetting) return;
    this.kDay = w.dayOfYear;
    // The clock passed midnight (the date moved on while the time of day went back): the wave weather keeps its day.
    if (same && !resetting && w.timeOfDay < lastTime) return;
    this.kDir = w.windDirectionDeg;
    this.kSpeed = w.windSpeedKt;
    this.kIsa = w.isaDeviation;
    this.kTable = table;
    this.kTag = tag;
    this.waveDay = w.dayOfYear;
    const ww = waveWeatherOf(w, table, this.waveDay);
    const key = tag === '' ? waveWeatherKey(ww) : `${tag}|${waveWeatherKey(ww)}`;
    if (key === this.key) {
      this.pendingKey = null;
      this.pendingWw = null;
      return;
    }
    if (this.key === null) {
      this.key = key;
      this.ww = ww;
      this.keyTime = -Infinity;
      return;
    }
    this.pendingKey = key;
    this.pendingWw = ww;
    if (!resetting && this.canAdopt(t)) this.adopt(t);
  }

  /** True when the waiting wave weather can be taken at t without a step (see the header). */
  private canAdopt(t: number): boolean {
    if (this.prev.size === 0 || t >= this.prevStart + FADE_S) return true;
    for (const e of this.cur.values()) if (ramp(t - e.start) > 0) return false;
    return true;
  }

  /** Take the waiting wave weather at t: the set on display becomes the fading set. */
  private adopt(t: number): void {
    if (this.prev.size === 0 || t >= this.prevStart + FADE_S) {
      const fading = new Map<number, Fading>();
      for (const [k, e] of this.cur) {
        const r = ramp(t - e.start);
        if (r > 0) fading.set(k, { sol: e.sol, weight: r });
      }
      this.prev = fading;
      this.prevStart = fading.size > 0 ? t : -Infinity;
    }
    // else nothing of the current set is on display: the fading set keeps fading.
    this.cur = new Map();
    this.key = this.pendingKey;
    this.ww = this.pendingWw;
    this.pendingKey = null;
    this.pendingWw = null;
    this.keyTime = t;
    this.missed.clear();
    this.starts.clear();
  }

  /** End every fade: the current weather's set in full (a reset, or the clock set back). */
  private settle(): void {
    if (this.pendingKey !== null) {
      this.cur = new Map();
      this.key = this.pendingKey;
      this.ww = this.pendingWw;
      this.pendingKey = null;
      this.pendingWw = null;
    }
    for (const e of this.cur.values()) {
      e.start = -Infinity;
      e.used = -Infinity;
    }
    this.prev.clear();
    this.prevStart = -Infinity;
    this.keyTime = -Infinity;
    this.missed.clear();
    this.starts.clear();
    this.lastT = -Infinity;
  }

  /**
   * A scenario reset (the clock restarts): with `w`, take its wave weather now (the day included), then end every
   * fade, so the first sample after the reset meets the current weather's set in full.
   */
  reset(w?: WeatherSettings): void {
    if (w) this.track(w, 0, true);
    this.settle();
  }

  private entry(ti: number, tj: number, t: number): Entry | null {
    const k = pack(ti, tj);
    const e = this.cur.get(k);
    if (e) {
      e.used = t;
      return e;
    }
    if (!this.ww || !this.key) return null;
    const src = sources.get(this.heightFn);
    // A tile that missed is asked for again only after a solution arrived (no work per sample while waiting).
    if (src && src.version !== undefined && this.missed.get(k) === src.version) return null;
    const sol = src ? src.get(ti, tj, this.ww, this.key) : syncSolution(this.heightFn, ti, tj, this.ww, this.key);
    if (!sol) {
      this.missed.set(k, src?.version ?? NaN);
      return null;
    }
    if (this.cur.size >= MAX_ENTRIES) this.evict(t);
    // After a miss the tile read as absent: it ramps in from now. Found again without a miss (evicted, then served
    // from the source's cache): it keeps the ramp it had.
    const start = this.missed.has(k) ? t : (this.starts.get(k) ?? this.keyTime);
    this.missed.delete(k);
    this.starts.set(k, start);
    const entry: Entry = { sol, start, used: t };
    this.cur.set(k, entry);
    return entry;
  }

  /** Drop the least recently sampled entry that is not in use (none in use: keep all; the map grows past the cap). */
  private evict(t: number): void {
    let lru = -1;
    let oldest = Infinity;
    for (const [k, e] of this.cur) {
      if (e.used >= t - IN_USE_S) continue;
      if (e.used < oldest) [lru, oldest] = [k, e.used];
    }
    if (lru >= 0) this.cur.delete(lru);
  }

  /** The terms at NED (north, east) and altitude z m MSL, at simulated time t, into `out`. */
  sample(north: number, east: number, z: number, t: number, out: OrographySample): OrographySample {
    out.waveN = out.waveE = out.waveW = out.shelter = out.envelope = out.nn = out.ne = out.ee = 0;
    // The clock set back by more than TIME_RESET: a reset (no fade, the current weather in full).
    if (t < this.lastT - TIME_RESET) this.settle();
    this.lastT = t;
    if (this.pendingKey !== null && this.canAdopt(t)) this.adopt(t);
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
          if (p) envWeight += this.accumulate(p.sol, north, east, z, ws * fadePrev * p.weight, out);
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
      // Terrain-following height above the solution's base, relaxing to z - base aloft.
      const above = z - hEff;
      const zeta = z - s.base - (hEff - s.base) * Math.exp(-(above > 0 ? above : 0) / s.relaxDepth);
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
        if (sol) {
          this.cur.set(k, { sol, start: -Infinity, used: this.lastT });
          this.starts.set(k, -Infinity);
          this.missed.delete(k);
        } else ok = false;
      }
    }
    return ok;
  }
}
