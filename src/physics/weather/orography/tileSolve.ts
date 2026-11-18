// One orography tile solution (design sections 5.1-5.5): the mountain-wave fields of the linear solver on the tile's
// valid window, the effective terrain they were solved over, and the lee-shelter excess for the low-level wind. A
// pure function of the tile terrain (terrainGrid.ts) and the wave weather (the settings the solution depends on), so
// the worker (sim/weather/orographyWorker.ts) and the synchronous node path produce bit-identical solutions.
//
// Background: layers bounded by the tile mean and LAYER_BOUNDS_M (bounds within LAYER_MIN_DEPTH_M of the mean are
// dropped), each with the free-atmosphere wind (windsAloft.ts) and N^2 (stability.ts) at its middle.
// Blocked flow: the terrain is filled to the envelope minus h_c = BLOCKING_FROUDE U_low / N_low (lowest layer):
// h_eff = max(h, envelope - h_c). The least-squares plane of h_eff is removed and the edges tapered (tiles.ts).
// Levels: OUTPUT_LEVELS_M above the tile mean; amplitudes scaled by sqrt(rho(mean) / rho(z)).

import type { AtmosphereSample, WeatherSettings, WindAloftLevel } from '../../../core/types';
import { atmosphereInto, type AtmosphereConditions } from '../../atmosphere';
import { bruntVaisala2 } from '../stability';
import { AloftProfile, temperatureProfileOf, type WindNE } from '../windsAloft';
import { FIELD_U, FIELD_V, FIELD_W, emptyWaveLayers, solveWaveGrid, type WaveOptions } from './linearWaves';
import { shelterExcess } from './shelter';
import { FLAT_RELIEF, planeFit, type TileTerrain } from './terrainGrid';
import { TILE_CENTRE, TILE_DX, TILE_N, WINDOW_N, WINDOW_START, edgeTaper } from './tiles';

/** Layer bounds above the tile mean, m MSL. */
const LAYER_BOUNDS_M = [1500, 3000, 4500, 6500, 9000, 11_000, 14_000];
/** Bounds closer than this above the tile mean are dropped, m. */
const LAYER_MIN_DEPTH_M = 300;
/** The top layer's wind and stability are taken this far above its bottom, m. */
const TOP_LAYER_SAMPLE_M = 2000;
/** Output levels above the tile mean, m. */
export const OUTPUT_LEVELS_M = Float64Array.from([0, 150, 300, 500, 750, 1000, 1500, 2000, 2500, 3000, 4000, 5000, 6000, 7500, 9000, 10_500, 12_000, 14_000]);
/** Field kinds stored per level, in this order. */
export const STORED_KINDS = [FIELD_W, FIELD_U, FIELD_V] as const;
/** Solver settings: Rayleigh damping (unconfirmed), the shortest wavelength (3 grid cells), the critical speed. */
export const WAVE_OPTIONS: WaveOptions = { nu: 1.5e-4, minWavelength: 3 * TILE_DX, criticalSpeed: 0.5 };
/** Critical Froude number of the blocking height h_c = F_c U / N. Unconfirmed. */
const BLOCKING_FROUDE = 1;
/** Below this free-atmosphere wind in every layer no waves are solved, m/s. */
const MIN_WAVE_WIND = 0.5;
/** Below this low-level wind no lee shelter is stored, m/s. */
const MIN_SHELTER_WIND = 0.1;
/** Smallest relaxation depth of the terrain-following coordinate, m; and its multiple of the largest terrain offset. */
const MIN_RELAX_DEPTH = 1500;
const RELAX_FACTOR = 1.2;

/** The settings a solution depends on (a subset of WeatherSettings; also the worker's job). */
export interface WaveWeather {
  windDirectionDeg: number;
  windSpeedKt: number;
  dayOfYear: number;
  isaDeviation: number;
  windsAloft?: readonly WindAloftLevel[];
}

/**
 * The wave weather of a WeatherSettings (allocates; on a change of the settings only). `dayOfYear` is the day the
 * solution uses (default w.dayOfYear; OrographyField passes the day frozen at its last reset or weather edit).
 */
export function waveWeatherOf(w: WeatherSettings, windsAloft: readonly WindAloftLevel[] | undefined, dayOfYear = w.dayOfYear): WaveWeather {
  const ww: WaveWeather = { windDirectionDeg: w.windDirectionDeg, windSpeedKt: w.windSpeedKt, dayOfYear, isaDeviation: w.isaDeviation };
  if (windsAloft) ww.windsAloft = windsAloft;
  return ww;
}

/**
 * A solution prepared for a transfer from the worker: the terrain windows (shared with the worker's terrain cache)
 * are copied, so transferring every buffer of the result detaches nothing the worker keeps.
 */
export function detachableSolution(s: TileSolution): TileSolution {
  return {
    ...s,
    envelope: s.envelope ? s.envelope.slice() : null,
    chanNN: s.chanNN ? s.chanNN.slice() : null,
    chanNE: s.chanNE ? s.chanNE.slice() : null,
    chanEE: s.chanEE ? s.chanEE.slice() : null,
  };
}

/** A string key identifying the wave weather (solution caches, the worker queue). */
export function waveWeatherKey(w: WaveWeather): string {
  return JSON.stringify([w.windDirectionDeg, w.windSpeedKt, w.dayOfYear, w.isaDeviation, w.windsAloft ?? null]);
}

export interface TileSolution {
  ti: number;
  tj: number;
  key: string;
  /** Tile mean, m MSL. */
  mean: number;
  /** Relaxation depth of the terrain-following coordinate, m. */
  relaxDepth: number;
  /** Wave fields on the window: (level * 3 + kind) * WINDOW_N^2 + cell, kinds w, u (north), v (east), m/s; null: none. */
  fields: Float32Array | null;
  /** Effective terrain on the window, m MSL (null without waves). */
  hEff: Float32Array | null;
  /** Lee-shelter excess on the window, m (null without a low-level wind or on flat ground). */
  shelter: Float32Array | null;
  /** Terrain windows from the tile terrain: envelope and channelling tensor (null on flat ground). */
  envelope: Float32Array | null;
  chanNN: Float32Array | null;
  chanNE: Float32Array | null;
  chanEE: Float32Array | null;
  /** Solve time, ms (diagnostics; not part of the field). */
  ms: number;
}

const _atm: AtmosphereSample = { temperature: 0, pressure: 0, density: 0, speedOfSound: 0, viscosity: 0 };
const _f: WindNE = { north: 0, east: 0 };

/** Solve one tile. Allocates its output (call off the hot path: the worker or a cache miss in node). */
export function solveTile(t: TileTerrain, ww: WaveWeather): TileSolution {
  const start = typeof performance !== 'undefined' ? performance.now() : 0;
  const weather = {
    windDirectionDeg: ww.windDirectionDeg,
    windSpeedKt: ww.windSpeedKt,
    dayOfYear: ww.dayOfYear,
    isaDeviation: ww.isaDeviation,
    windsAloft: ww.windsAloft,
  } as WeatherSettings;
  const aloft = new AloftProfile().update(weather);
  const cond: AtmosphereConditions = { isaDeviation: ww.isaDeviation, seaLevelPressure: 101325, profile: temperatureProfileOf(weather) };
  const sol: TileSolution = {
    ti: t.ti,
    tj: t.tj,
    key: waveWeatherKey(ww),
    mean: t.mean,
    relaxDepth: MIN_RELAX_DEPTH,
    fields: null,
    hEff: null,
    shelter: null,
    envelope: t.envWindow,
    chanNN: t.chanNN,
    chanNE: t.chanNE,
    chanEE: t.chanEE,
    ms: 0,
  };
  if (!t.envelope) {
    sol.ms = (typeof performance !== 'undefined' ? performance.now() : 0) - start;
    return sol;
  }

  // Background layers.
  const L = emptyWaveLayers();
  const bounds = [t.mean];
  for (const b of LAYER_BOUNDS_M) if (b > t.mean + LAYER_MIN_DEPTH_M) bounds.push(b);
  L.count = bounds.length;
  let maxWind = 0;
  for (let j = 0; j < bounds.length; j++) {
    const mid = j + 1 < bounds.length ? 0.5 * (bounds[j] + bounds[j + 1]) : bounds[j] + TOP_LAYER_SAMPLE_M;
    aloft.freeWind(mid, _f);
    L.bottom[j] = bounds[j] - t.mean;
    L.U[j] = _f.north;
    L.V[j] = _f.east;
    L.N2[j] = bruntVaisala2(mid, cond);
    maxWind = Math.max(maxWind, Math.hypot(_f.north, _f.east));
  }
  const lowN = L.U[0];
  const lowE = L.V[0];
  const lowSpeed = Math.hypot(lowN, lowE);

  // Lee shelter for the low-level wind.
  if (lowSpeed > MIN_SHELTER_WIND) sol.shelter = shelterExcess(t, lowN / lowSpeed, lowE / lowSpeed, new Float32Array(WINDOW_N * WINDOW_N));

  if (t.relief < FLAT_RELIEF || maxWind < MIN_WAVE_WIND) {
    sol.ms = (typeof performance !== 'undefined' ? performance.now() : 0) - start;
    return sol;
  }

  // Blocked flow: fill to the envelope minus h_c.
  const n = TILE_N;
  const hc = (BLOCKING_FROUDE * lowSpeed) / Math.sqrt(L.N2[0]);
  const hEff = new Float64Array(n * n);
  const env = t.envelope;
  for (let i = 0; i < n * n; i++) hEff[i] = Math.max(t.h[i], env[i] - hc);
  const [c0, c1, c2] = planeFit(hEff);
  const d = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    const ti = edgeTaper((i - TILE_CENTRE) * TILE_DX);
    for (let j = 0; j < n; j++) d[i * n + j] = (hEff[i * n + j] - (c0 + c1 * i + c2 * j)) * ti * edgeTaper((j - TILE_CENTRE) * TILE_DX);
  }

  // Density scaling per level.
  const rho0 = atmosphereInto(t.mean, cond, _atm).density;
  const scale = new Float64Array(OUTPUT_LEVELS_M.length);
  for (let l = 0; l < scale.length; l++) scale[l] = Math.sqrt(rho0 / atmosphereInto(t.mean + OUTPUT_LEVELS_M[l], cond, _atm).density);

  const W = WINDOW_N;
  const cells = W * W;
  const fields = new Float32Array(OUTPUT_LEVELS_M.length * STORED_KINDS.length * cells);
  solveWaveGrid(n, n, TILE_DX, d, L, { levels: OUTPUT_LEVELS_M, scale, kinds: STORED_KINDS }, WAVE_OPTIONS, (f, grid) => {
    const base = f * cells;
    for (let wi = 0; wi < W; wi++) {
      const row = (WINDOW_START + wi) * n + WINDOW_START;
      for (let wj = 0; wj < W; wj++) fields[base + wi * W + wj] = grid[row + wj];
    }
  });
  sol.fields = fields;
  const hw = new Float32Array(cells);
  let maxOffset = 0;
  for (let wi = 0; wi < W; wi++) {
    for (let wj = 0; wj < W; wj++) {
      const v = hEff[(WINDOW_START + wi) * n + WINDOW_START + wj];
      hw[wi * W + wj] = v;
      maxOffset = Math.max(maxOffset, Math.abs(v - t.mean));
    }
  }
  sol.hEff = hw;
  sol.relaxDepth = Math.max(MIN_RELAX_DEPTH, RELAX_FACTOR * maxOffset);
  sol.ms = (typeof performance !== 'undefined' ? performance.now() : 0) - start;
  return sol;
}

/** The typed arrays of a solution (for a transfer from the worker). Terrain windows shared with a cache are included. */
export function solutionBuffers(s: TileSolution): ArrayBuffer[] {
  const out: ArrayBuffer[] = [];
  for (const a of [s.fields, s.hEff, s.shelter, s.envelope, s.chanNN, s.chanNE, s.chanEE]) if (a && !out.includes(a.buffer as ArrayBuffer)) out.push(a.buffer as ArrayBuffer);
  return out;
}
