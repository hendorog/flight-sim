// The terrain terms of the wind in time and across caches (physics/weather/orography/orographyField.ts): a reset
// after a weather change, two weather changes within the fade, a sample before the last change, eviction and the
// ramp of a tile found again, the requery of a missed tile, the terrain tag in the cache keys, the frozen day of the
// wave weather, the windsock's horizontal sample inside the reference-site mask, and the waves under a calm surface.
// Each test logs its measured numbers.

import { describe, expect, test } from 'vitest';
import type { Vec3 } from '../../src/core/math';
import { defaultWeather, type WeatherSettings } from '../../src/core/types';
import { createEnvironment, type TerrainProvider } from '../../src/physics/environment';
import {
  MAX_ENTRIES,
  OrographyField,
  emptyOrographySample,
  setOrographySource,
  setTerrainTag,
  tileTerrainOf,
  type OrographySource,
} from '../../src/physics/weather/orography/orographyField';
import { buildTileTerrain } from '../../src/physics/weather/orography/terrainGrid';
import { MIN_WAVE_WIND, solveTile, type TileSolution, type WaveWeather } from '../../src/physics/weather/orography/tileSolve';
import { TILE_SPACING, WINDOW_N } from '../../src/physics/weather/orography/tiles';
import { advanceTimeOfDay } from '../../src/sim/clock';

const report = (label: string, values: Record<string, number | string>) =>
  console.log(`[orography-time] ${label}: ${Object.entries(values).map(([k, v]) => `${k}=${typeof v === 'number' ? +v.toPrecision(4) : v}`).join('  ')}`);

/** Gaussian hills around the tiles (0, 0) .. (1, 1). */
const HILLS = [
  [20_000, 5000, 900, 4000],
  [40_000, 36_000, 1200, 6000],
  [-30_000, 25_000, 700, 3000],
];
const hills = (n: number, e: number): number => {
  let h = 120;
  for (const [hn, he, a, r] of HILLS) h += a * Math.exp(-((n - hn) ** 2 + (e - he) ** 2) / (r * r));
  return h;
};
const terrainOf = (height: (n: number, e: number) => number): TerrainProvider => ({ height, normal: () => ({ x: 0, y: 0, z: -1 }), surface: () => 'grass' });

/** Steady weather (no gusts, turbulence or thermals, night overcast: no slope winds). */
const steady = (o: Partial<WeatherSettings> = {}): WeatherSettings => ({
  ...defaultWeather(),
  windDirectionDeg: 315,
  windSpeedKt: 25,
  gustKt: 0,
  turbulence: 0,
  timeOfDay: 0,
  cloudCover: 1,
  ...o,
});

const A = { windDirectionDeg: 315, windSpeedKt: 25 };
const B = { windDirectionDeg: 250, windSpeedKt: 18 };
const C = { windDirectionDeg: 200, windSpeedKt: 30 };
const P: Vec3 = { x: 22_000, y: 8000, z: -2500 };
const PTS: Vec3[] = Array.from({ length: 60 }, (_, i) => ({ x: 15_000 + i * 397, y: 3000 + i * 211, z: -(1500 + i * 41) }));

const wave = (env: ReturnType<typeof createEnvironment>, p: Vec3, t: number): Vec3 => ({ ...env.windField.breakdown(p, t).wave });
const same = (a: Vec3, b: Vec3) => a.x === b.x && a.y === b.y && a.z === b.z;

describe('time', () => {
  test('a reset after a weather change takes the new weather in full before its first sample', () => {
    const w = steady(A);
    const env = createEnvironment({ weather: w, terrain: terrainOf(hills), seed: 4 });
    for (const p of PTS) env.wind(p, 50);
    // The weather changes and the scenario is reset before any sample sees it.
    Object.assign(w, B);
    env.windField.reset();
    const fresh = createEnvironment({ weather: steady(B), terrain: terrainOf(hills), seed: 4 });
    let equal = true;
    let largest = 0;
    for (const t of [0, 0.5, 1.5, 4]) {
      for (const p of PTS) {
        const a = env.wind(p, t);
        const b = fresh.wind(p, t);
        equal &&= a.x === b.x && a.y === b.y && a.z === b.z;
        largest = Math.max(largest, Math.abs(wave(fresh, p, t).z));
      }
    }
    report('reset before the first sample', { largestNewWaveW: largest });
    expect(largest).toBeGreaterThan(0.05);
    expect(equal).toBe(true);
  }, 120_000);

  test('two weather changes within the fade: no step (largest change per 0.01 s under 1 % of the largest difference)', () => {
    const w = steady(A);
    const env = createEnvironment({ weather: w, terrain: terrainOf(hills), seed: 4 });
    const settled = (o: Partial<WeatherSettings>) => wave(createEnvironment({ weather: steady(o), terrain: terrainOf(hills), seed: 4 }), P, 1);
    const [a, b, c] = [settled(A), settled(B), settled(C)];
    const diff = Math.max(...[[a, b], [b, c], [a, c]].map(([x, y]) => Math.hypot(x.x - y.x, x.y - y.y, x.z - y.z)));
    wave(env, P, 5);
    let prev = wave(env, P, 10);
    let step = 0;
    for (let i = 1; i <= 1500; i++) {
      const t = 10 + i * 0.01;
      if (i === 1) Object.assign(w, B); // the first change, seen at t = 10.01
      if (i === 150) Object.assign(w, C); // the second, half way through the first fade
      const v = wave(env, P, t);
      step = Math.max(step, Math.hypot(v.x - prev.x, v.y - prev.y, v.z - prev.z));
      prev = v;
    }
    report('two changes 1.5 s apart', { largestStep: step, largestDifference: diff, endMinusC: Math.hypot(prev.x - c.x, prev.y - c.y, prev.z - c.z) });
    expect(diff).toBeGreaterThan(0.05);
    expect(step).toBeLessThan(0.01 * diff);
    // 15 s after the second change: the new weather in full.
    expect(same(prev, c)).toBe(true);
  }, 120_000);

  test('a sample earlier than the last weather change (clock set back) reads the settled field, not 0', () => {
    const w = steady(A);
    const env = createEnvironment({ weather: w, terrain: terrainOf(hills), seed: 4 });
    wave(env, P, 10);
    Object.assign(w, B);
    wave(env, P, 100);
    wave(env, P, 104);
    const back = wave(env, P, 50);
    const fresh = wave(createEnvironment({ weather: steady(B), terrain: terrainOf(hills), seed: 4 }), P, 50);
    report('clock set back', { waveW: back.z, settledW: fresh.z });
    expect(Math.abs(fresh.z)).toBeGreaterThan(0.01);
    expect(same(back, fresh)).toBe(true);
  }, 120_000);

  test('the wave weather keeps its day across midnight with the clock running; an edit or a reset takes the date', () => {
    const w = steady({ ...A, dayOfYear: 40, timeOfDay: 23.99 });
    const field = new OrographyField(hills);
    field.update(w, 0);
    const key = field.waveKey;
    advanceTimeOfDay(w, 120);
    expect(w.dayOfYear).toBe(41);
    field.update(w, 120);
    expect(field.waveKey).toBe(key);
    expect(field.pendingWaveKey).toBeNull();
    // A reset takes the date the clock reached.
    field.reset(w);
    expect(field.waveKey).not.toBe(key);
    expect(field.waveWeather!.dayOfYear).toBe(41);
    // A menu edit of the day (time of day unchanged) is a weather edit.
    const g = new OrographyField(hills);
    const v = steady({ ...A, dayOfYear: 40, timeOfDay: 10 });
    g.update(v, 0);
    v.dayOfYear = 200;
    g.update(v, 1);
    expect(g.waveWeather!.dayOfYear).toBe(200);
  });
});

/** A worker-like source: a miss queues the tile; deliver() solves the queue and bumps the version. */
function asyncSource(height: (n: number, e: number) => number, versioned: boolean) {
  const delivered = new Map<string, TileSolution>();
  const queue: { ti: number; tj: number; ww: WaveWeather; key: string }[] = [];
  const calls = new Map<string, number>();
  const hits = new Map<string, number>();
  let version = 0;
  const source: OrographySource & { version?: number } = {
    sync: false,
    get(ti, tj, ww, key) {
      const k = `${ti},${tj}`;
      calls.set(k, (calls.get(k) ?? 0) + 1);
      const s = delivered.get(`${k}:${key}`);
      if (s) hits.set(k, (hits.get(k) ?? 0) + 1);
      else if (!queue.some((q) => q.ti === ti && q.tj === tj && q.key === key)) queue.push({ ti, tj, ww, key });
      return s ?? null;
    },
  };
  if (versioned) Object.defineProperty(source, 'version', { get: () => version });
  return {
    source,
    calls,
    hits,
    deliver() {
      while (queue.length) {
        const j = queue.shift()!;
        delivered.set(`${j.ti},${j.tj}:${j.key}`, solveTile(tileTerrainOf(height, j.ti, j.tj), j.ww));
      }
      version++;
    },
  };
}

describe('the field and its source', () => {
  test('tiles sampled in the last second are never evicted; a tile found again after an eviction keeps its ramp', () => {
    const height = (n: number, e: number) => hills(n, e);
    const src = asyncSource(height, true);
    setOrographySource(height, src.source);
    try {
      const field = new OrographyField(height);
      field.update(steady(A), 0);
      const out = emptyOrographySample();
      // The aircraft at (30 km, 30 km) reads four tiles; 14 far samplers each read one tile (at its centre).
      const Q: Vec3 = { x: 30_000, y: 30_000, z: -2500 };
      const farA = Array.from({ length: 14 }, (_, i) => [6 * TILE_SPACING, (i - 7) * TILE_SPACING] as const);
      const farB = Array.from({ length: 14 }, (_, i) => [-6 * TILE_SPACING, (i - 7) * TILE_SPACING] as const);
      const frame = (t: number, aircraft: boolean, far: readonly (readonly [number, number])[]) => {
        if (aircraft) field.sample(Q.x, Q.y, -Q.z, t, out);
        for (const [n, e] of far) field.sample(n, e, 2000, t, out);
      };
      // 18 tiles in use every 0.1 s for 5 s (more than MAX_ENTRIES).
      frame(0, true, farA);
      src.deliver();
      for (let i = 1; i <= 50; i++) frame(i * 0.1, true, farA);
      const aircraftTiles = ['0,0', '0,1', '1,0', '1,1'];
      const taken = aircraftTiles.map((k) => src.hits.get(k) ?? 0);
      const full = field.sample(Q.x, Q.y, -Q.z, 5, emptyOrographySample()).waveW;
      // From 6.5 s 14 other tiles come in while the aircraft's are more than 1 s old: they are evicted first.
      frame(6.5, false, farB);
      src.deliver();
      for (let i = 66; i <= 80; i++) frame(i * 0.1, false, farB);
      const again = field.sample(Q.x, Q.y, -Q.z, 8.1, emptyOrographySample()).waveW;
      const retaken = aircraftTiles.map((k) => src.hits.get(k) ?? 0);
      report('eviction', { maxEntries: MAX_ENTRIES, inUse: 18, hitsWhileInUse: taken.join('/'), hitsAfterReturn: retaken.join('/'), waveW: full, waveWAfterReturn: again });
      // Each aircraft tile was taken once while in use (never evicted and fetched again).
      expect(taken).toEqual([1, 1, 1, 1]);
      // Evicted, then served from the source again without a miss: in full, not ramping from 0.
      expect(retaken).toEqual([2, 2, 2, 2]);
      expect(Math.abs(full)).toBeGreaterThan(0.01);
      expect(again).toBe(full);
    } finally {
      setOrographySource(height, null);
    }
  }, 300_000);

  test('a missed tile is asked for again only after the source received something (no throttle on simulated time)', () => {
    const height = (n: number, e: number) => hills(n, e);
    const src = asyncSource(height, true);
    setOrographySource(height, src.source);
    try {
      const field = new OrographyField(height);
      field.update(steady(A), 0);
      const out = emptyOrographySample();
      // Paused: every sample at t = 3.
      for (let i = 0; i < 100; i++) field.sample(P.x, P.y, -P.z, 3, out);
      const callsWaiting = src.calls.get('0,0') ?? 0;
      src.deliver();
      field.sample(P.x, P.y, -P.z, 3, out);
      const taken = src.hits.get('0,0') ?? 0;
      report('requery', { callsWhileWaiting100Samples: callsWaiting, hitsAfterDelivery: taken });
      expect(callsWaiting).toBe(1);
      // At the same simulated time, right after the delivery.
      expect(taken).toBe(1);
    } finally {
      setOrographySource(height, null);
    }
  }, 120_000);

  test('the terrain tag is part of the cache keys: a new terrain generation is solved again', () => {
    let generation = 0;
    const second = (n: number, e: number) => 120 + 1500 * Math.exp(-((n - 25_000) ** 2 + (e - 10_000) ** 2) / 5000 ** 2);
    const height = (n: number, e: number) => (generation === 0 ? hills(n, e) : second(n, e));
    setTerrainTag(height, () => `g${generation}`);
    try {
      const w = steady(A);
      const field = new OrographyField(height);
      field.update(w, 0);
      const meanBefore = tileTerrainOf(height, 0, 0).mean;
      const before = { ...field.sample(P.x, P.y, -P.z, 1, emptyOrographySample()) };
      generation = 1;
      const meanAfter = tileTerrainOf(height, 0, 0).mean;
      // A reset takes the new generation in full; compare with a terrain function that never had another generation.
      field.reset(w);
      const after = { ...field.sample(P.x, P.y, -P.z, 1, emptyOrographySample()) };
      const ref = new OrographyField(second);
      ref.update(w, 0);
      const reference = { ...ref.sample(P.x, P.y, -P.z, 1, emptyOrographySample()) };
      report('terrain tag', { meanBefore, meanAfter, waveWBefore: before.waveW, waveWAfter: after.waveW, waveWReference: reference.waveW });
      expect(meanAfter).not.toBe(meanBefore);
      expect(after).toEqual(reference);
      expect(after.waveW).not.toBe(before.waveW);
    } finally {
      setTerrainTag(height, null);
    }
  }, 120_000);

  test('the windsock sample inside the reference-site mask requests no tile and gives the horizontal wind of sample()', () => {
    const height = (n: number, e: number) => hills(n, e);
    const src = asyncSource(height, true);
    setOrographySource(height, src.source);
    try {
      // A field on flat ground 10 km from the nearest hill, inside the tiles of the hills.
      const site = { north: 8000, east: -6000 };
      const env = createEnvironment({ weather: steady(A), terrain: terrainOf(height), seed: 4, referenceSites: [site], orographyTerrain: height });
      const at: Vec3 = { x: site.north + 500, y: site.east, z: -(hills(site.north + 500, site.east) + 8) };
      const h = { ...env.windField.sampleHorizontal(at, 1) };
      const callsInside = [...src.calls.values()].reduce((a, b) => a + b, 0);
      // Outside the mask it samples the tiles as sample() does.
      const out: Vec3 = { x: 40_000, y: 30_000, z: -3000 };
      env.windField.sampleHorizontal(out, 1);
      const callsOutside = [...src.calls.values()].reduce((a, b) => a + b, 0);
      // Every tile delivered (sample() at the site asks for its own): inside the mask the horizontal wind equals
      // sample()'s where no wave breaks; outside it equals sample() in all three components.
      src.deliver();
      env.windField.breakdown(at, 1);
      src.deliver();
      env.windField.reset();
      const full = env.windField.breakdown(at, 1);
      const hs = { ...env.windField.sampleHorizontal(at, 1) };
      const s = { ...env.windField.sample(at, 1) };
      const so = { ...env.windField.sample(out, 1) };
      const ho = { ...env.windField.sampleHorizontal(out, 1) };
      report('windsock sample', { callsInsideMask: callsInside, callsOutsideMask: callsOutside, waveSeverityAtSock: full.waveSeverity, waveWAtSock: full.wave.z, sockKt: Math.hypot(h.x, h.y) / 0.514444 });
      expect(callsInside).toBe(0);
      expect(callsOutside).toBeGreaterThan(0);
      expect(full.waveSeverity).toBe(0);
      expect([hs.x, hs.y]).toEqual([s.x, s.y]);
      expect([ho.x, ho.y, ho.z]).toEqual([so.x, so.y, so.z]);
    } finally {
      setOrographySource(height, null);
    }
  }, 120_000);
});

describe('waves under a calm surface', () => {
  test('a calm surface with winds aloft launches waves from the lowest layer with wind; the air below is blocked', () => {
    // A 2000 m ridge across the westerlies, the tile mean near 400 m.
    const ridge = (n: number, e: number) => 300 + 2000 * Math.exp(-((e / 6000) ** 2) - (n / 30_000) ** 2);
    const t = buildTileTerrain(ridge, 0, 0);
    const ww: WaveWeather = { windDirectionDeg: 270, windSpeedKt: 0, dayOfYear: 15, isaDeviation: 0 };
    const s = solveTile(t, ww);
    let maxW = 0;
    const cells = WINDOW_N * WINDOW_N;
    for (let l = 0; l < 18; l++) for (let c = 0; c < cells; c++) maxW = Math.max(maxW, Math.abs(s.fields![l * 3 * cells + c]));
    let minEff = Infinity;
    for (const v of s.hEff!) minEff = Math.min(minEff, v);
    // The same ridge in a 25 kt westerly: launched from the tile mean.
    const windy = solveTile(t, { ...ww, windSpeedKt: 25 });
    report('calm surface, day 15, 2000 m ridge', { tileMean: t.mean, base: s.base, lowestEffectiveTerrain: minEff, maxAbsW: maxW, windyBase: windy.base, minWaveWind: MIN_WAVE_WIND });
    expect(s.base).toBeGreaterThan(t.mean);
    expect(minEff).toBeGreaterThanOrEqual(s.base - 1e-3);
    expect(maxW).toBeGreaterThan(0.1);
    expect(windy.base).toBe(t.mean);
  }, 120_000);
});
