// The terrain terms of the wind field (physics/weather/orography/ through WindField): continuity across tile seams,
// determinism, the worker path against the synchronous one, blocking, the breaking limiter, the reference sites, and
// the measured wave field over the world terrain. Each test logs its measured numbers.

import { describe, expect, test } from 'vitest';
import { DEG, KT, type Vec3 } from '../../src/core/math';
import { windSpeedFactor, windVeer } from '../../src/physics/weather/boundaryLayer';
import { defaultWeather, type WeatherSettings } from '../../src/core/types';
import { createEnvironment, type TerrainProvider } from '../../src/physics/environment';
import {
  setOrographySource,
  tileTerrainOf,
  type OrographySource,
} from '../../src/physics/weather/orography/orographyField';
import { buildTileTerrain } from '../../src/physics/weather/orography/terrainGrid';
import { detachableSolution, solutionBuffers, solveTile, type TileSolution } from '../../src/physics/weather/orography/tileSolve';
import { WINDOW_N } from '../../src/physics/weather/orography/tiles';
import { createWorldEnvironment } from '../../src/sim/worldEnvironment';
import { airfields } from '../../src/world/airfields';
import { terrainHeight } from '../../src/world/terrain/heightfield';
import { windAloftAt, windFromDeg, windKt } from '../../src/physics/weather/windsAloft';

const report = (label: string, values: Record<string, number | string>) =>
  console.log(`[orography] ${label}: ${Object.entries(values).map(([k, v]) => `${k}=${typeof v === 'number' ? +v.toPrecision(4) : v}`).join('  ')}`);

/** Gaussian hills, some across tile seams (tile centres every 64 km; weights change between 16 and 48 km). */
const HILLS = [
  [20_000, 5000, 900, 4000],
  [40_000, 36_000, 1200, 6000],
  [-30_000, 25_000, 700, 3000],
  [50_000, -20_000, 1000, 5000],
];
const hills = (n: number, e: number): number => {
  let h = 120;
  for (const [hn, he, a, r] of HILLS) h += a * Math.exp(-((n - hn) ** 2 + (e - he) ** 2) / (r * r));
  return h;
};
const hillTerrain: TerrainProvider = { height: hills, normal: () => ({ x: 0, y: 0, z: -1 }), surface: () => 'grass' };

/** Steady weather (no gusts, turbulence or thermals) with a 25 kt north-westerly. */
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

const mean = (env: ReturnType<typeof createEnvironment>, p: Vec3, t = 1) => {
  const b = env.windField.breakdown(p, t);
  return { x: b.mean.x + b.slope.x, y: b.mean.y + b.slope.y, z: b.wave.z + b.orographic + b.slope.z };
};

describe('tiles in the wind field', () => {
  test('continuous across the tile seams: second difference over 1 m steps < 1e-3 m/s', () => {
    // A jump J between two samples 1 m apart shows as a second difference of about J; a smooth field gives
    // |f''| (1 m)^2 (about 1e-6 m/s for a 4 m/s wave 10 km long).
    const env = createEnvironment({ weather: steady(), terrain: hillTerrain });
    let maxSecond = 0;
    let maxWave = 0;
    let crossings = 0;
    // Across the bands where tiles (0, 0), (1, 0), (0, 1) and (1, 1) enter and leave (16 and 48 km from a centre).
    for (const z of [3000, 0]) {
      for (const [n0, e0, dn, de] of [[10_000, 40_000, 1, 0], [40_000, 10_000, 0, 1], [30_000, 30_000, Math.SQRT1_2, Math.SQRT1_2]]) {
        const f: { x: number; y: number; z: number }[] = [];
        for (let s = 0; s <= 44_000; s += 1) {
          const n = n0 + dn * s;
          const e = e0 + de * s;
          if (Math.abs(n % 64_000) === 16_000 || Math.abs(n % 64_000) === 48_000) crossings++;
          const alt = z > 0 ? z : hills(n, e) + 300;
          const v = mean(env, { x: n, y: e, z: -alt });
          maxWave = Math.max(maxWave, Math.abs(v.z));
          f.push(v);
          if (f.length === 3) {
            maxSecond = Math.max(maxSecond, Math.abs(f[2].x - 2 * f[1].x + f[0].x), Math.abs(f[2].y - 2 * f[1].y + f[0].y), Math.abs(f[2].z - 2 * f[1].z + f[0].z));
            f.shift();
          }
        }
      }
    }
    report('seams', { maxSecondDifference1m: maxSecond, maxVertical: maxWave, seamCrossings: crossings });
    expect(maxWave).toBeGreaterThan(0.1);
    expect(maxSecond).toBeLessThan(1e-3);
  }, 300_000);

  test('deterministic across instances, and a reset ends the fade of a weather edit', () => {
    const w1 = steady();
    const a = createEnvironment({ weather: w1, terrain: hillTerrain, seed: 3 });
    const b = createEnvironment({ weather: steady(), terrain: hillTerrain, seed: 3 });
    const pts: Vec3[] = Array.from({ length: 200 }, (_, i) => ({ x: 15_000 + i * 97, y: 3000 - i * 41, z: -(1500 + i * 13) }));
    let same = true;
    for (const p of pts) {
      const va = a.wind(p, 1);
      const vb = b.wind(p, 1);
      same &&= va.x === vb.x && va.y === vb.y && va.z === vb.z;
    }
    // A weather edit at t = 10 fades over 3 s; mid-fade the field is between the two; after a reset it is the new one.
    const before = { ...a.windField.breakdown(pts[50], 10).wave };
    w1.windDirectionDeg = 280;
    // The edit is seen at the first sample after it (t = 10); half way through the fade at 11.5.
    a.windField.breakdown(pts[50], 10);
    const mid = { ...a.windField.breakdown(pts[50], 11.5).wave };
    const fresh = createEnvironment({ weather: steady({ windDirectionDeg: 280 }), terrain: hillTerrain, seed: 3 });
    const after = { ...fresh.windField.breakdown(pts[50], 11.5).wave };
    a.windField.reset();
    let resetSame = true;
    for (const p of pts) {
      const va = a.wind(p, 0.5);
      const vf = fresh.wind(p, 0.5);
      resetSame &&= va.x === vf.x && va.y === vf.y && va.z === vf.z;
    }
    report('fade', { beforeW: before.z, midW: mid.z, newW: after.z });
    expect(same).toBe(true);
    expect(resetSame).toBe(true);
    expect(Math.min(before.z, after.z) - 1e-9).toBeLessThanOrEqual(mid.z);
    expect(Math.max(before.z, after.z) + 1e-9).toBeGreaterThanOrEqual(mid.z);
  }, 120_000);

  test('the worker path reproduces the synchronous solution bit for bit', () => {
    const weather = steady({ windDirectionDeg: 300 });
    const sync = createEnvironment({ weather, terrain: hillTerrain, seed: 2 });
    // A source that misses, then delivers what the worker would post (solved from the same terrain, buffers
    // transferred through a structured clone).
    const delivered = new Map<string, TileSolution>();
    const queue: { ti: number; tj: number; ww: Parameters<OrographySource['get']>[2] }[] = [];
    const source: OrographySource = {
      sync: false,
      get(ti, tj, ww, key) {
        const s = delivered.get(`${ti},${tj}:${key}`);
        if (!s) queue.push({ ti, tj, ww });
        return s ?? null;
      },
    };
    const workerTerrain = (n: number, e: number) => hills(n, e);
    const async = createEnvironment({ weather, terrain: hillTerrain, seed: 2, orographyTerrain: workerTerrain });
    setOrographySource(workerTerrain, source);
    try {
      const p: Vec3 = { x: 30_000, y: 30_000, z: -2500 };
      const missed = { ...async.windField.breakdown(p, 0).wave };
      while (queue.length) {
        const j = queue.shift()!;
        const sol = detachableSolution(solveTile(tileTerrainOf(workerTerrain, j.ti, j.tj), j.ww));
        const copy = structuredClone(sol, { transfer: solutionBuffers(sol) });
        delivered.set(`${j.ti},${j.tj}:${copy.key}`, copy);
      }
      async.windField.breakdown(p, 0);
      async.windField.reset();
      let same = true;
      for (let i = 0; i < 300; i++) {
        const q: Vec3 = { x: 20_000 + i * 71, y: 20_000 + i * 53, z: -(800 + i * 17) };
        const va = async.wind(q, 2);
        const vs = sync.wind(q, 2);
        same &&= va.x === vs.x && va.y === vs.y && va.z === vs.z;
      }
      report('worker path', { waveWhileMissing: missed.z, tilesSolved: delivered.size });
      expect(missed.z).toBe(0);
      expect(same).toBe(true);
    } finally {
      setOrographySource(workerTerrain, null);
    }
  }, 120_000);
});

describe('amplitude limits', () => {
  test('blocked flow: the effective terrain of a corrugated range flattens as the wind falls', () => {
    const ridges = (n: number) => 1000 + 500 * Math.cos((2 * Math.PI * n) / 5000);
    const t = buildTileTerrain(ridges, 0, 0);
    const spreads: number[] = [];
    for (const kt of [40, 20, 10, 5]) {
      const s = solveTile(t, { windDirectionDeg: 0, windSpeedKt: kt, dayOfYear: 172, isaDeviation: 0, windsAloft: [] });
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = 0; i < WINDOW_N * WINDOW_N; i++) {
        lo = Math.min(lo, s.hEff![i]);
        hi = Math.max(hi, s.hEff![i]);
      }
      spreads.push(hi - lo);
    }
    report('blocking, 1000 m corrugations', { spread40kt: spreads[0], spread20kt: spreads[1], spread10kt: spreads[2], spread5kt: spreads[3] });
    for (let i = 1; i < spreads.length; i++) expect(spreads[i]).toBeLessThanOrEqual(spreads[i - 1]);
    expect(spreads[3]).toBeLessThan(0.5 * spreads[0]);
  }, 120_000);

  test('the breaking limiter keeps the along-wind perturbation within the background wind', () => {
    const big = (n: number, e: number) => 200 + 2500 * Math.exp(-((n / 6000) ** 2) - (e / 30_000) ** 2);
    const env = createEnvironment({ weather: steady({ windDirectionDeg: 180, windSpeedKt: 20 }), terrain: { height: big, normal: () => ({ x: 0, y: 0, z: -1 }), surface: () => 'grass' } });
    let worst = 0;
    let maxSev = 0;
    for (let i = 0; i < 4000; i++) {
      const n = -20_000 + i * 10;
      for (const alt of [1000, 3000, 5000, 8000]) {
        const z = Math.max(alt, big(n, 0) + 50);
        const b = env.windField.breakdown({ x: n, y: 0, z: -z }, 1);
        const f = windAloftAt(steady({ windDirectionDeg: 180, windSpeedKt: 20 }), z, { north: 0, east: 0 });
        const F = Math.hypot(f.north, f.east);
        const along = -(b.wave.x * f.north + b.wave.y * f.east) / F;
        worst = Math.max(worst, along / F);
        maxSev = Math.max(maxSev, b.waveSeverity);
      }
    }
    report('breaking limiter', { maxDecelerationShare: worst, maxBreakingSeverity: maxSev });
    expect(worst).toBeLessThan(0.8 + 1e-9);
  }, 120_000);
});

describe('world terrain', () => {
  test('the reference-site mask gives the set wind at every airfield', () => {
    for (const kt of [6, 15]) {
      const weather = steady({ windSpeedKt: kt, windDirectionDeg: 230, timeOfDay: 13, cloudCover: 0.2 });
      const env = createWorldEnvironment(weather);
      for (const f of airfields()) {
        // 10 m above the field: the boundary-layer wind of the setting at that height above the smoothed ground (the
        // runway surface is raised a few centimetres), with no terrain term.
        const b = env.windField.breakdown({ x: f.north, y: f.east, z: -(f.elevation + 10) }, 1);
        const v = { north: b.mean.x, east: b.mean.y };
        expect(windKt(v)).toBeCloseTo(kt * windSpeedFactor(b.heightAGL), 9);
        expect(windFromDeg(v)).toBeCloseTo(230 + windVeer(b.heightAGL) / DEG, 9);
        expect(Math.abs(b.heightAGL - 10)).toBeLessThan(0.1);
      }
    }
  }, 300_000);

  test('wave field around the Alps for a 25 kt north-westerly in default stability', () => {
    const weather = steady();
    const env = createWorldEnvironment(weather);
    const stats: Record<string, number | string> = {};
    for (const alt of [3000, 5000, 8000]) {
      let up = 0;
      let down = 0;
      for (let n = 0; n <= 60_000; n += 500) {
        for (let e = -30_000; e <= 30_000; e += 500) {
          const z = Math.max(alt, terrainHeight(n, e) + 200);
          const w = env.windField.breakdown({ x: n, y: e, z: -z }, 1).wave.z;
          up = Math.max(up, w);
          down = Math.min(down, w);
        }
      }
      stats[`maxUp${alt}`] = up;
      stats[`maxDown${alt}`] = down;
    }
    // Along the wind (toward 135 deg) through the airport region at 4000 m: spacing of the w maxima.
    const peaks: number[] = [];
    let a = 0;
    let b = 0;
    for (let s = -40_000; s <= 40_000; s += 250) {
      const n = 30_000 + s * Math.cos((135 * Math.PI) / 180);
      const e = s * Math.sin((135 * Math.PI) / 180);
      const w = env.windField.breakdown({ x: n, y: e, z: -4000 }, 1).wave.z;
      if (b > a && b > w && b > 0.3) peaks.push(s - 250);
      a = b;
      b = w;
    }
    const spacing = peaks.length > 1 ? (peaks[peaks.length - 1] - peaks[0]) / (peaks.length - 1) : NaN;
    stats.peaksAlongWind4000 = peaks.length;
    stats.meanPeakSpacingM = spacing;
    report('Alps 25 kt NW, w (m/s)', stats);
    // Wind at 3000 m over the plain (south of the range) and over the ridge line.
    const plain = env.windField.breakdown({ x: -15_000, y: 0, z: -3000 }, 1).mean;
    let ridge = { n: 0, e: 0, h: 0 };
    for (let n = 20_000; n <= 60_000; n += 1000) for (let e = -20_000; e <= 20_000; e += 1000) if (terrainHeight(n, e) > ridge.h) ridge = { n, e, h: terrainHeight(n, e) };
    const overRidge = env.windField.breakdown({ x: ridge.n, y: ridge.e, z: -Math.max(3000, ridge.h + 100) }, 1).mean;
    report('3000 m MSL, 25 kt NW', {
      plainKt: Math.hypot(plain.x, plain.y) / KT,
      plainFrom: windFromDeg({ north: plain.x, east: plain.y }),
      ridgeKt: Math.hypot(overRidge.x, overRidge.y) / KT,
      ridgeFrom: windFromDeg({ north: overRidge.x, east: overRidge.y }),
      ridgeGroundM: ridge.h,
      freeKt: windKt(windAloftAt(weather, 3000, { north: 0, east: 0 })),
    });
    expect(Number(stats.maxUp5000)).toBeGreaterThan(0.2);
  }, 600_000);

  test('slope winds over the world terrain by day and by night (calm, clear)', () => {
    const calm = steady({ windSpeedKt: 0, windsAloft: [], cloudCover: 0.1, timeOfDay: 13 });
    const env = createWorldEnvironment(calm);
    let day = 0;
    let night = 0;
    const pts: [number, number][] = [];
    for (let n = 15_000; n <= 55_000; n += 700) for (let e = -20_000; e <= 20_000; e += 700) pts.push([n, e]);
    for (const [n, e] of pts) {
      const b = env.windField.breakdown({ x: n, y: e, z: -(terrainHeight(n, e) + 60) }, 1).slope;
      day = Math.max(day, Math.hypot(b.x, b.y));
    }
    calm.timeOfDay = 2;
    for (const [n, e] of pts) {
      const b = env.windField.breakdown({ x: n, y: e, z: -(terrainHeight(n, e) + 25) }, 1).slope;
      night = Math.max(night, Math.hypot(b.x, b.y));
    }
    report('slope winds, world terrain', { maxDay60mAgl: day, maxNight25mAgl: night });
    expect(day).toBeGreaterThan(0.5);
    expect(night).toBeGreaterThan(0.5);
  }, 300_000);
});
