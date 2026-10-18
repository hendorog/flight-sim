// Cumulonimbus cells (physics/weather/convection.ts) and their coupling into WindField: the Oseguera-Bowles
// downdraft and outflow, the updraft profile, the severity, motion, determinism, reset and cost. Each test logs its
// measured numbers.

import { describe, expect, test } from 'vitest';
import { KT, type Vec3 } from '../../src/core/math';
import { defaultWeather, type StormCell, type WeatherSettings } from '../../src/core/types';
import { stormCentreAt } from '../../src/core/weatherFields';
import { createEnvironment, type TerrainProvider } from '../../src/physics/environment';
import { WindField } from '../../src/physics/weather';
import {
  DOWNDRAFT_MAX,
  DOWNDRAFT_RADIUS,
  DOWNDRAFT_TAPER_M,
  OB_EPSILON_M,
  OB_Z_STAR_M,
  SUBCLOUD_FRACTION,
  UPDRAFT_BASE,
  UPDRAFT_PER_INTENSITY,
  cbSample,
  cbSeverity,
  downdraftCentreAt,
  emptyCbSample,
  inStormCore,
  obLambda,
  obVelocity,
  type ObVelocity,
} from '../../src/physics/weather/convection';

const ELEV = 120;
const BASE = 1500;
const report = (label: string, values: Record<string, number | string>) =>
  console.log(`[convection] ${label}: ${Object.entries(values).map(([k, v]) => `${k}=${typeof v === 'number' ? +v.toPrecision(4) : v}`).join('  ')}`);

const flatTerrain = (): TerrainProvider => ({ height: () => ELEV, normal: () => ({ x: 0, y: 0, z: -1 }), surface: () => 'grass' });
const cell = (over: Partial<StormCell> = {}): StormCell => ({
  northM: 0,
  eastM: 0,
  radiusM: 3000,
  topM: 11000,
  intensity: 0.8,
  motionDeg: 270,
  motionKt: 15,
  ...over,
});
const atAlt = (alt: number, north = 0, east = 0): Vec3 => ({ x: north, y: east, z: -alt });
/** cbSample over flat ground at ELEV with the base at BASE. */
const sampleAt = (cells: StormCell[], north: number, east: number, alt: number, t = 0) =>
  cbSample(cells, atAlt(alt, north, east), t, Math.max(0.3, alt - ELEV), ELEV, BASE, emptyCbSample());

describe('Oseguera-Bowles downdraft and outflow', () => {
  const rd = 1500;
  const lambda = obLambda(30, rd);
  const v: ObVelocity = { q: 0, w: 0 };

  test('no vertical wind at the ground', () => {
    let worst = 0;
    for (let i = 0; i < 50; i++) {
      const r = (i / 49) * 4 * rd;
      worst = Math.max(worst, Math.abs(obVelocity(r * r, 0, lambda, rd, v).w));
    }
    report('w at z = 0', { radii: 50, maxAbsW: worst });
    expect(worst).toBe(0);
  });

  test('divergence-free (central differences, 1 m step) at 200 points', () => {
    const vel = (x: number, y: number, z: number): [number, number, number] => {
      obVelocity(x * x + y * y, z, lambda, rd, v);
      return [v.q * x, v.q * y, v.w];
    };
    let s = 7;
    const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
    let worst = 0;
    for (let i = 0; i < 200; i++) {
      const x = (rnd() - 0.5) * 6 * rd;
      const y = (rnd() - 0.5) * 6 * rd;
      const z = 2 + 1500 * rnd() * rnd();
      const div = (vel(x + 1, y, z)[0] - vel(x - 1, y, z)[0]) / 2 + (vel(x, y + 1, z)[1] - vel(x, y - 1, z)[1]) / 2 + (vel(x, y, z + 1)[2] - vel(x, y, z - 1)[2]) / 2;
      worst = Math.max(worst, Math.abs(div));
    }
    report('divergence', { points: 200, maxAbsPerS: worst, lambda });
    expect(worst).toBeLessThan(1e-3);
  });

  test('peak outflow 10 + 20 intensity m/s within 10 %, through the cell', () => {
    for (const intensity of [0, 0.5, 1]) {
      const c = cell({ radiusM: 4000, intensity });
      const dd = downdraftCentreAt(c, 0, { north: 0, east: 0 });
      let peak = 0;
      for (let k = 0; k <= 120; k++) {
        const r = (k / 120) * 2 * DOWNDRAFT_RADIUS * c.radiusM;
        for (let agl = 5; agl <= 300; agl += 5) {
          const cb = sampleAt([c], dd.north + r, dd.east, ELEV + agl);
          peak = Math.max(peak, Math.hypot(cb.outN, cb.outE));
        }
      }
      const want = 10 + 20 * intensity;
      report('peak outflow', { intensity, peak, want });
      expect(Math.abs(peak - want) / want).toBeLessThan(0.1);
    }
  });

  test('the downdraft stays within DOWNDRAFT_MAX for a small, intense cell', () => {
    const lam = obLambda(30, DOWNDRAFT_RADIUS * 1000);
    const w = obVelocity(0, 1000, lam, DOWNDRAFT_RADIUS * 1000, v).w;
    report('small cell downdraft', { w, limit: DOWNDRAFT_MAX, atHeight: -lam * (OB_Z_STAR_M - OB_EPSILON_M) });
    expect(w).toBeLessThan(0);
    expect(-w).toBeLessThanOrEqual(DOWNDRAFT_MAX + 1e-9);
  });
});

describe('updraft', () => {
  const c = cell({ intensity: 1 });
  const wMax = UPDRAFT_BASE + UPDRAFT_PER_INTENSITY;
  // Above BASE + DOWNDRAFT_TAPER_M the downdraft is tapered to 0, so cbSample's vertical wind is the updraft.
  const high = BASE + DOWNDRAFT_TAPER_M + 10;

  test('zero beyond 2 R and at the top, peaking near wMax inside the cloud', () => {
    let outside = 0;
    for (let k = 0; k < 64; k++) {
      const r = 2 * c.radiusM + k * 25;
      const a = (k / 64) * 2 * Math.PI;
      outside = Math.max(outside, Math.abs(sampleAt([c], r * Math.cos(a), r * Math.sin(a), high).up));
    }
    const atTop = sampleAt([c], 0, 0, c.topM).up;
    const aboveTop = sampleAt([c], 0, 0, c.topM + 200).up;
    let peak = 0;
    for (let alt = BASE; alt <= c.topM; alt += 50) peak = Math.max(peak, alt > high ? sampleAt([c], 0, 0, alt).up : 0);
    report('updraft', { maxBeyond2R: outside, atTop, aboveTop, peak, wMax });
    expect(outside).toBe(0);
    expect(Math.abs(atTop)).toBeLessThan(1e-9);
    expect(aboveTop).toBe(0);
    expect(peak).toBeGreaterThan(0.99 * wMax);
    expect(peak).toBeLessThanOrEqual(wMax);
  });

  test('continuous at the cloud base and zero at the ground', () => {
    const below = sampleAt([c], 0, 0, BASE - 0.01).up;
    const above = sampleAt([c], 0, 0, BASE + 0.01).up;
    // The downdraft reaches the core axis below the base; subtract it to read the updraft alone.
    const ob = (alt: number) => {
      const dd = downdraftCentreAt(c, 0, { north: 0, east: 0 });
      const rd = DOWNDRAFT_RADIUS * c.radiusM;
      const v = obVelocity(dd.north * dd.north + dd.east * dd.east, alt - ELEV, obLambda(30, rd), rd, { q: 0, w: 0 });
      return v.w;
    };
    const updraftBelow = below - ob(BASE - 0.01);
    const ground = sampleAt([c], 0, 0, ELEV).up;
    report('updraft at the base', { below, above, updraftBelow, want: SUBCLOUD_FRACTION * wMax, atGround: ground });
    expect(Math.abs(above - below)).toBeLessThan(0.01);
    expect(updraftBelow).toBeCloseTo(SUBCLOUD_FRACTION * wMax, 2);
    expect(Math.abs(ground)).toBeLessThan(0.05);
  });
});

describe('cells in the wind field', () => {
  const stormy = (over: Partial<WeatherSettings> = {}, cells: StormCell[] = [cell()]): WeatherSettings => ({
    ...defaultWeather(),
    windSpeedKt: 10,
    gustKt: 18,
    turbulence: 0.2,
    timeOfDay: 13,
    cloudBaseM: BASE,
    storms: cells,
    ...over,
  });

  test('the convective breakdown is the difference to the field without cells where the severity is 0', () => {
    const weather = stormy({ turbulence: 0 });
    const env = createEnvironment({ weather, terrain: flatTerrain(), seed: 3 });
    const calmEnv = createEnvironment({ weather: { ...weather, storms: undefined }, terrain: flatTerrain(), seed: 3 });
    // 3 R east of the centre: beyond the severity reach (2.5 R), inside the downdraft taper (the cell moves east).
    const p = atAlt(ELEV + 80, 0, 3 * 3000);
    const b = env.windField.breakdown(p, 0);
    const a = env.wind(p, 0);
    const z = calmEnv.wind(p, 0);
    report('convective term', { up: b.convective.up, outN: b.convective.outN, outE: b.convective.outE });
    expect(Math.abs(b.convective.outE)).toBeGreaterThan(0.5);
    expect(a.x - z.x).toBeCloseTo(b.convective.outN, 9);
    expect(a.y - z.y).toBeCloseTo(b.convective.outE, 9);
    expect(a.z - z.z).toBeCloseTo(-b.convective.up, 9);
  });

  test('the cell moves with its motion: the field at time t is the field at t = 0 shifted to the new centre', () => {
    const c = cell();
    const t = 1800;
    const centre = stormCentreAt(c, t, { north: 0, east: 0 });
    const now = sampleAt([c], centre.north + 500, centre.east - 700, ELEV + 300, t);
    const then = sampleAt([c], 500, -700, ELEV + 300, 0);
    report('motion', { centreN: centre.north, centreE: centre.east, upNow: now.up, upThen: then.up });
    expect(centre.east).toBeCloseTo(15 * KT * t, 6);
    expect(now.up).toBeCloseTo(then.up, 9);
    expect(now.outN).toBeCloseTo(then.outN, 9);
    expect(now.outE).toBeCloseTo(then.outE, 9);
  });

  test('severity: the cell intensity in the core, 0 beyond 2.5 R, and stronger turbulence near the cell', () => {
    const c = cell({ intensity: 0.9 });
    const weather = stormy({ turbulence: 0.1, windSpeedKt: 0, gustKt: 0 }, [c]);
    const field = new WindField(weather, () => ELEV, 4);
    const core = cbSeverity([c], atAlt(3000, 500, 0), 0);
    const far = cbSeverity([c], atAlt(3000, 2.6 * 3000, 0), 0);
    const above = cbSeverity([c], atAlt(c.topM + 1500), 0);
    const sigmaNear = field.breakdown(atAlt(3000, 500, 0), 0).intensity.sigmaW;
    const sigmaFar = field.breakdown(atAlt(3000, 20000, 0), 0).intensity.sigmaW;
    report('severity', { core, far, above, sigmaWNear: sigmaNear, sigmaWFar: sigmaFar });
    expect(core).toBeCloseTo(0.9, 9);
    expect(far).toBe(0);
    expect(above).toBe(0);
    expect(sigmaNear).toBeGreaterThan(2 * sigmaFar);
    expect(field.stormTurbulence(atAlt(3000, 500, 0), 0)).toBe(core);
  });

  test('stormTurbulence is read-only: interleaved calls leave the field unchanged', () => {
    const weather = stormy();
    const a = new WindField(weather, () => ELEV, 11);
    const b = new WindField(weather, () => ELEV, 11);
    let same = true;
    for (let i = 0; i < 200; i++) {
      const p = atAlt(ELEV + 50 + i * 10, i * 40, -i * 25);
      b.stormTurbulence(p, i * 0.5 + 7);
      const wa = a.sample(p, i * 0.5);
      const wb = b.sample(p, i * 0.5);
      same &&= wa.x === wb.x && wa.y === wb.y && wa.z === wb.z;
    }
    expect(same).toBe(true);
  });

  test('a reset restarts the advection with a cell present: the same air after a reset', () => {
    const weather = stormy({ windSpeedKt: 15, turbulence: 0.6 });
    const field = new WindField(weather, () => ELEV, 7);
    const probe = atAlt(ELEV + 300, 100, 50);
    const reference = { ...field.sample(probe, 0.5) };
    field.sample(probe, 0.4);
    field.sample(probe, 0.65);
    field.reset();
    field.sample(probe, 0);
    const again = field.sample(probe, 0.5);
    report('reset with a cell', { dx: again.x - reference.x, dy: again.y - reference.y, dz: again.z - reference.z });
    expect(again.x).toBe(reference.x);
    expect(again.y).toBe(reference.y);
    expect(again.z).toBe(reference.z);
  });

  test('deterministic for a seed with a cell present', () => {
    const weather = stormy({ turbulence: 0.5 });
    const a = createEnvironment({ weather, terrain: flatTerrain(), seed: 42 });
    const b = createEnvironment({ weather, terrain: flatTerrain(), seed: 42 });
    const c = createEnvironment({ weather, terrain: flatTerrain(), seed: 43 });
    let same = true;
    let differs = false;
    for (let i = 0; i < 500; i++) {
      const p = atAlt(ELEV + 50 + i, i * 17, -i * 11);
      const wa = a.wind(p, i * 0.25);
      const wb = b.wind(p, i * 0.25);
      const wc = c.wind(p, i * 0.25);
      same &&= wa.x === wb.x && wa.y === wb.y && wa.z === wb.z;
      differs ||= Math.abs(wa.z - wc.z) > 1e-3;
    }
    expect(same).toBe(true);
    expect(differs).toBe(true);
  });

  test('inStormCore: inside R between the base and the top, following the motion', () => {
    const c = cell();
    const t = 600;
    const ctr = stormCentreAt(c, t, { north: 0, east: 0 });
    expect(inStormCore([c], ctr.north, ctr.east + 2900, 5000, t, BASE)).toBe(true);
    expect(inStormCore([c], ctr.north, ctr.east + 3100, 5000, t, BASE)).toBe(false);
    expect(inStormCore([c], ctr.north, ctr.east, BASE - 1, t, BASE)).toBe(false);
    expect(inStormCore([c], ctr.north, ctr.east, c.topM + 1, t, BASE)).toBe(false);
    expect(inStormCore([c], 0, 0, 5000, t, BASE)).toBe(false);
  });

  test('cost per wind() call with four cells along the path', () => {
    const cells = [0, 1, 2, 3].map((k) => cell({ northM: 1500 + k * 2500, eastM: (k % 2 ? 1 : -1) * 1500, radiusM: 2000 + 500 * k }));
    const weather = { ...defaultWeather(), windSpeedKt: 12, gustKt: 20, turbulence: 0.5, timeOfDay: 13, storms: cells };
    const env = createEnvironment({ weather, terrain: flatTerrain() });
    const n = 50000;
    const p = { x: 0, y: 0, z: -(ELEV + 300) };
    let active = 0;
    const start = performance.now();
    let acc = 0;
    for (let i = 0; i < n; i++) {
      p.x = i * 0.2;
      acc += env.wind(p, i / 240).z;
    }
    const us = ((performance.now() - start) / n) * 1000;
    for (let i = 0; i < n; i += 500) {
      p.x = i * 0.2;
      if (env.windField.breakdown(p, i / 240).convective.up !== 0) active++;
    }
    report('performance, 4 cells', { microsecondsPerWindCall: us, checksum: acc, samplesWithConvection: `${active}/100` });
    expect(active).toBeGreaterThan(80);
    expect(us).toBeLessThan(30);
  });
});
