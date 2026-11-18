// Orography tiles and the near-surface terrain terms (physics/weather/orography/: tiles, terrainGrid, shelter,
// channel, slopeWind, sites). Each test logs its measured numbers.

import { describe, expect, test } from 'vitest';
import { sunDirectionNED } from '../../src/core/world';
import { channelDelta, channelDepth } from '../../src/physics/weather/orography/channel';
import { SITE_OUTER, siteMask } from '../../src/physics/weather/orography/sites';
import { shelterExcess, shelterFactor } from '../../src/physics/weather/orography/shelter';
import { SlopeWindSky, slopeWindAt, type SlopeWindSample } from '../../src/physics/weather/orography/slopeWind';
import { buildTileTerrain } from '../../src/physics/weather/orography/terrainGrid';
import {
  TILE_CENTRE,
  TILE_DX,
  TILE_SPACING,
  WINDOW_N,
  WINDOW_START,
  tileFloor,
  tileWeight1d,
  windowBilinear,
} from '../../src/physics/weather/orography/tiles';

const report = (label: string, values: Record<string, number | string>) =>
  console.log(`[orography] ${label}: ${Object.entries(values).map(([k, v]) => `${k}=${typeof v === 'number' ? +v.toPrecision(4) : v}`).join('  ')}`);

/** Window coordinates (cells) of NED (north, east) in tile (0, 0). */
const win = (north: number, east: number): [number, number] => [north / TILE_DX + TILE_CENTRE - WINDOW_START, east / TILE_DX + TILE_CENTRE - WINDOW_START];

describe('tiles', () => {
  test('the weights of the tiles covering a point sum to 1; at most two tiles per axis', () => {
    let s = 7;
    const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
    let maxErr = 0;
    for (let k = 0; k < 20_000; k++) {
      const n = (rnd() - 0.5) * 600_000;
      const e = (rnd() - 0.5) * 600_000;
      let sum = 0;
      for (let ti = tileFloor(n) - 1; ti <= tileFloor(n) + 2; ti++) {
        for (let tj = tileFloor(e) - 1; tj <= tileFloor(e) + 2; tj++) {
          const w = tileWeight1d(n - ti * TILE_SPACING) * tileWeight1d(e - tj * TILE_SPACING);
          if (w > 0) expect(ti === tileFloor(n) || ti === tileFloor(n) + 1).toBe(true);
          sum += w;
        }
      }
      maxErr = Math.max(maxErr, Math.abs(sum - 1));
    }
    report('tile weights', { maxSumError: maxErr });
    expect(maxErr).toBeLessThan(1e-12);
  });

  test('a flat or planar tile has no relief; a ridge has its height', () => {
    expect(buildTileTerrain(() => 120, 0, 0).envelope).toBeNull();
    const plane = buildTileTerrain((n, e) => 120 + 0.15 * n - 0.02 * e, 0, 0);
    const ridge = buildTileTerrain((n) => 120 + 600 * Math.exp(-((n / 2000) ** 2)), 0, 0);
    report('relief', { planeRelief: plane.relief, ridgeRelief: ridge.relief, ridgeMean: ridge.mean });
    expect(plane.relief).toBeLessThan(1e-6);
    expect(plane.envelope).toBeNull();
    expect(ridge.relief).toBeGreaterThan(590);
    expect(ridge.envelope).not.toBeNull();
  });
});

describe('lee shelter', () => {
  test('behind a ridge the wind is reduced; upwind and on flat ground it is not', () => {
    const height = (n: number) => 120 + 600 * Math.exp(-((n / 2000) ** 2));
    const t = buildTileTerrain(height, 0, 0);
    // Wind toward the north: the lee is north of the ridge.
    const ex = shelterExcess(t, 1, 0, new Float32Array(WINDOW_N * WINDOW_N));
    const at = (n: number, agl: number) => {
      const [x, y] = win(n, 0);
      return shelterFactor(windowBilinear(ex, x, y), height(n), height(n) + agl);
    };
    const lee30 = at(3000, 30);
    const lee300 = at(3000, 300);
    const lee1500 = at(3000, 1500);
    const upwind = at(-3000, 30);
    const far = at(-30_000, 30);
    report('shelter, 600 m ridge, wind across', { lee3km30m: lee30, lee3km300m: lee300, lee3km1500m: lee1500, upwind3km30m: upwind, upwind30km: far });
    expect(lee30).toBeLessThan(0.6);
    expect(lee1500).toBe(1);
    expect(upwind).toBe(1);
    expect(far).toBe(1);
  });
});

describe('valley channelling', () => {
  test('a valley removes the cross-valley component and keeps the along-valley one', () => {
    // An east-west valley 800 m deep: the cross-valley direction is north.
    const height = (n: number) => 120 + 800 * (1 - Math.exp(-((n / 3000) ** 2)));
    const t = buildTileTerrain(height, 0, 0);
    const [x, y] = win(0, 0);
    const nn = windowBilinear(t.chanNN!, x, y);
    const ne = windowBilinear(t.chanNE!, x, y);
    const ee = windowBilinear(t.chanEE!, x, y);
    const env = windowBilinear(t.envWindow!, x, y);
    const floor = height(0);
    const c = channelDepth(env, floor, floor + 20);
    const d = channelDelta(nn, ne, ee, c, 5, 5, new Float64Array(2));
    report('channelling', { a: nn + ee, envelopeAboveFloor: env - floor, depthShare: c, dNorth: d[0], dEast: d[1] });
    expect(nn).toBeGreaterThan(0.5);
    expect(Math.abs(d[1])).toBeLessThan(1e-3);
    expect(d[0]).toBeLessThan(-1.5);
    // At the envelope height and above: none.
    expect(channelDepth(env, floor, env + 1)).toBe(0);
  });
});

describe('slope winds', () => {
  const out = (): SlopeWindSample => ({ north: 0, east: 0, up: 0 });

  test('upslope by day on a sunny slope, downslope at night under a clear sky; none under overcast at night or on flat ground', () => {
    const sky = new SlopeWindSky();
    const noon = sunDirectionNED(12.5, 172);
    sky.set(noon.x, noon.y, noon.z, 0.2);
    // A south-facing slope of 0.3: the ground rises toward the north, grad h = (0.3, 0).
    let dayPeak = 0;
    for (let agl = 5; agl <= 300; agl += 5) dayPeak = Math.max(dayPeak, slopeWindAt(sky, 0.3, 0, agl, 0, out()).north);
    const day60 = slopeWindAt(sky, 0.3, 0, 60, 0, out());
    const windy = slopeWindAt(sky, 0.3, 0, 60, 15, out());
    const flat = slopeWindAt(sky, 0, 0, 60, 0, out());
    const night = sunDirectionNED(1, 172);
    sky.set(night.x, night.y, night.z, 0);
    const night25 = slopeWindAt(sky, 0.3, 0, 25, 0, out());
    let nightPeak = 0;
    for (let agl = 5; agl <= 300; agl += 5) nightPeak = Math.min(nightPeak, slopeWindAt(sky, 0.3, 0, agl, 0, out()).north);
    sky.set(night.x, night.y, night.z, 1);
    const overcast = slopeWindAt(sky, 0.3, 0, 25, 0, out());
    report('slope winds', { dayPeakUpslope: dayPeak, day60mUp: day60.up, nightPeakDownslope: nightPeak, night25mUp: night25.up, overcastNight: overcast.north, flatDay: flat.north, windy15: windy.north });
    expect(day60.north).toBeGreaterThan(1.5);
    expect(day60.up).toBeCloseTo(day60.north * 0.3, 9);
    expect(night25.north).toBeLessThan(-1.5);
    expect(overcast.north).toBe(0);
    expect(flat.north).toBe(0);
    expect(windy.north).toBe(0);
  });
});

describe('reference sites', () => {
  test('the mask is 0 at a site and 1 beyond SITE_OUTER of every site', () => {
    const sites = [{ north: 0, east: 0 }, { north: -12_403, east: -35_787 }];
    expect(siteMask(sites, 0, 0)).toBe(0);
    expect(siteMask(sites, -12_403, -35_787)).toBe(0);
    expect(siteMask(sites, SITE_OUTER, 0)).toBe(1);
    expect(siteMask(sites, 3500, 0)).toBeGreaterThan(0);
    expect(siteMask(sites, 3500, 0)).toBeLessThan(1);
  });
});
