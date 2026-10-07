// Wind, turbulence and atmosphere through createEnvironment / WindField. Each test logs its measured numbers.

import { describe, expect, test } from 'vitest';
import { DEG, FT, KT, RAD, v3, type Vec3 } from '../../src/core/math';
import { defaultWeather, type SurfaceType, type WeatherSettings } from '../../src/core/types';
import { createEnvironment, type TerrainProvider } from '../../src/physics/environment';
import { gradientWindFactor, milTurbulenceIntensity, WindField, type TurbulenceIntensity } from '../../src/physics/weather';
import { drydenLongitudinalSpectrum, drydenTransverseSpectrum } from '../../src/physics/weather/turbulence';
import { welchPsd } from './spectrum';

const ELEV = 120;
const report = (label: string, values: Record<string, number | string>) =>
  console.log(`[weather] ${label}: ${Object.entries(values).map(([k, v]) => `${k}=${typeof v === 'number' ? +v.toPrecision(4) : v}`).join('  ')}`);

function flatTerrain(elevation = ELEV, surface: SurfaceType = 'grass'): TerrainProvider {
  return { height: () => elevation, normal: () => ({ x: 0, y: 0, z: -1 }), surface: () => surface };
}

/** Calm, smooth, night-time (no thermals) weather to switch single effects on in isolation. */
function calm(overrides: Partial<WeatherSettings> = {}): WeatherSettings {
  return { ...defaultWeather(), windSpeedKt: 0, gustKt: 0, turbulence: 0, timeOfDay: 0, ...overrides };
}

const at = (heightAGL: number, north = 0, east = 0): Vec3 => ({ x: north, y: east, z: -(ELEV + heightAGL) });

describe('atmosphere', () => {
  test('ISA at sea level and the live QNH / temperature deviation', () => {
    const weather = calm();
    const env = createEnvironment({ weather, terrain: flatTerrain() });
    const sl = env.atmosphere(0);
    weather.qnhHpa = 993;
    weather.isaDeviation = 20;
    const hot = env.atmosphere(0);
    const hot1500 = env.atmosphere(1500);
    report('atmosphere', { T0: sl.temperature, p0: sl.pressure, rho0: sl.density, hotRho0: hot.density, hotP0: hot.pressure, hotRho1500: hot1500.density });
    expect(sl.temperature).toBeCloseTo(288.15, 2);
    expect(sl.pressure).toBeCloseTo(101325, 0);
    expect(sl.density).toBeCloseTo(1.225, 3);
    expect(hot.pressure).toBeCloseTo(99300, 0);
    expect(hot.temperature).toBeCloseTo(308.15, 2);
    expect(hot.density).toBeLessThan(sl.density * 0.95);
  });
});

describe('mean wind', () => {
  test('10 m wind matches the setting; weaker and backed near the ground, stronger and veered aloft', () => {
    const weather = calm({ windSpeedKt: 15, windDirectionDeg: 270 });
    const field = new WindField(weather, () => ELEV);
    // The steady component only: a 15 kt wind also makes mechanical turbulence.
    const w10 = field.breakdown(at(10), 0).mean;
    const w2 = field.breakdown(at(1.25), 0).mean;
    const w600 = field.breakdown(at(600), 0).mean;
    const dirFrom = (w: Vec3) => ((Math.atan2(-w.y, -w.x) * RAD) + 360) % 360;
    report('profile', {
      speed10mKt: v3.len(w10) / KT,
      speedWheelKt: v3.len(w2) / KT,
      speed600mKt: v3.len(w600) / KT,
      from10m: dirFrom(w10),
      from600m: dirFrom(w600),
      gradientRatio: gradientWindFactor,
    });
    expect(v3.len(w10) / KT).toBeCloseTo(15, 6);
    expect(dirFrom(w10)).toBeCloseTo(270, 6);
    // A westerly blows toward the east.
    expect(w10.y).toBeGreaterThan(0);
    expect(v3.len(w2)).toBeLessThan(0.8 * v3.len(w10));
    expect(v3.len(w600)).toBeGreaterThan(1.4 * v3.len(w10));
    expect(v3.len(w600)).toBeLessThan(1.8 * v3.len(w10));
    // Northern hemisphere: wind veers (direction increases) with height.
    expect(dirFrom(w600) - 270).toBeGreaterThan(15);
    expect(dirFrom(w600) - 270).toBeLessThan(30);
  });

  test('reads the live settings object on every call', () => {
    const weather = calm({ windSpeedKt: 5 });
    const env = createEnvironment({ weather, terrain: flatTerrain() });
    const before = v3.len(env.windField.breakdown(at(10), 0).mean);
    weather.windSpeedKt = 25;
    const after = v3.len(env.windField.breakdown(at(10), 0).mean);
    weather.turbulence = 1;
    const turbulent = env.windField.breakdown(at(10), 0).intensity.sigmaW;
    expect(before / KT).toBeCloseTo(5, 6);
    expect(after / KT).toBeCloseTo(25, 6);
    expect(turbulent).toBeGreaterThan(2);
  });

  test('gusts reach the reported gust speed and never fall below the mean wind', () => {
    const weather = calm({ windSpeedKt: 12, gustKt: 22 });
    const field = new WindField(weather, () => ELEV, 7);
    let max = 0;
    let min = Infinity;
    let gusting = 0;
    const n = 3600 * 10;
    for (let i = 0; i < n; i++) {
      const b = field.breakdown(at(10), i * 0.1);
      const s = v3.len(v3.add(b.mean, b.gust)) / KT;
      max = Math.max(max, s);
      min = Math.min(min, s);
      if (s > 13) gusting++;
    }
    report('gusts 12G22', { maxKt: max, minKt: min, fractionGusting: gusting / n });
    expect(max).toBeLessThanOrEqual(22 + 1e-9);
    expect(max).toBeGreaterThan(20);
    expect(min).toBeGreaterThanOrEqual(12 - 1e-9);
    expect(gusting / n).toBeGreaterThan(0.1);
    expect(gusting / n).toBeLessThan(0.6);
  });
});

describe('turbulence', () => {
  /** Turbulence components sampled every dx metres along a horizontal line at a height, frozen in time. */
  function line(field: WindField, heightAGL: number, headingDeg: number, n: number, dx: number) {
    const u = new Float64Array(n);
    const v = new Float64Array(n);
    const w = new Float64Array(n);
    const c = Math.cos(headingDeg * DEG);
    const s = Math.sin(headingDeg * DEG);
    let I!: TurbulenceIntensity;
    for (let i = 0; i < n; i++) {
      const b = field.breakdown(at(heightAGL, i * dx * c + 5e4, i * dx * s - 3e4), 0);
      u[i] = b.turbulence.u;
      v[i] = b.turbulence.v;
      w[i] = b.turbulence.w;
      I = b.intensity;
    }
    return { u, v, w, I };
  }
  const rms = (a: Float64Array) => Math.sqrt(a.reduce((s, x) => s + x * x, 0) / a.length);

  test('MIL-F-8785C intensities and scale lengths', () => {
    const I = { sigmaU: 0, sigmaV: 0, sigmaW: 0, lengthU: 0, lengthV: 0, lengthW: 0 };
    milTurbulenceIntensity(1000 * FT, 1 / 3, 0, I);
    const low = { ...I };
    milTurbulenceIntensity(5000 * FT, 2 / 3, 0, I);
    const moderateHigh = { ...I };
    report('MIL', {
      light1000ftSigmaW: low.sigmaW,
      light1000ftLw: low.lengthW,
      moderate5000ftSigma: moderateHigh.sigmaW,
      moderate5000ftL: moderateHigh.lengthU,
    });
    // Light: W20 = 15 kt, sigma_w = 0.1 W20; at 1000 ft sigma_u = sigma_w and L = 1000 ft.
    expect(low.sigmaW).toBeCloseTo(1.5 * KT, 6);
    expect(low.sigmaU).toBeCloseTo(1.5 * KT, 6);
    expect(low.lengthW).toBeCloseTo(1000 * FT, 6);
    expect(low.lengthU).toBeCloseTo(1000 * FT, 6);
    // Moderate at 5000 ft: table value between 10.6 ft/s (3750 ft) and 10.1 ft/s (7500 ft); L = 1750 ft.
    expect(moderateHigh.sigmaW / FT).toBeCloseTo(10.6 - (0.5 * 1250) / 3750, 6);
    expect(moderateHigh.lengthU).toBeCloseTo(1750 * FT, 6);
  });

  test('RMS matches the requested intensity', () => {
    const cases = [
      { height: 30, severity: 1 / 3 },
      { height: 150, severity: 2 / 3 },
      { height: 1500, severity: 2 / 3 },
    ];
    for (const c of cases) {
      const field = new WindField(calm({ turbulence: c.severity }), () => ELEV, 3);
      let su = 0;
      let sv = 0;
      let sw = 0;
      let I!: TurbulenceIntensity;
      const headings = [0, 45, 90, 135, 200, 290];
      for (const h of headings) {
        const r = line(field, c.height, h, 40000, 10);
        su += rms(r.u) ** 2;
        sv += rms(r.v) ** 2;
        sw += rms(r.w) ** 2;
        I = r.I;
      }
      const ru = Math.sqrt(su / headings.length) / I.sigmaU;
      const rv = Math.sqrt(sv / headings.length) / I.sigmaV;
      const rw = Math.sqrt(sw / headings.length) / I.sigmaW;
      report(`rms h=${c.height} m`, { sigmaU: I.sigmaU, sigmaW: I.sigmaW, Lu: I.lengthU, Lw: I.lengthW, ratioU: ru, ratioV: rv, ratioW: rw });
      for (const r of [ru, rv, rw]) {
        expect(r).toBeGreaterThan(0.85);
        expect(r).toBeLessThan(1.15);
      }
    }
  }, 60_000);

  test('spectra follow the Dryden forms and roll off at -2 in log-log', () => {
    const height = 150;
    const field = new WindField(calm({ turbulence: 2 / 3 }), () => ELEV, 11);
    // 2 m spacing puts the Nyquist wavenumber (1.57 rad/m) well above the compared band (< 0.5 rad/m).
    const dx = 2;
    const segment = 8192;
    const acc: { u: number[]; w: number[] } = { u: [], w: [] };
    let k: number[] = [];
    let I!: TurbulenceIntensity;
    const headings = [10, 70, 130, 190, 250, 310];
    for (const h of headings) {
      const r = line(field, height, h, segment * 6, dx);
      I = r.I;
      const pu = welchPsd(r.u, dx, segment);
      const pw = welchPsd(r.w, dx, segment);
      k = pu.k;
      pu.psd.forEach((p, i) => (acc.u[i] = (acc.u[i] ?? 0) + p / headings.length));
      pw.psd.forEach((p, i) => (acc.w[i] = (acc.w[i] ?? 0) + p / headings.length));
    }
    // The synthetic field is a sum of discrete modes (a line spectrum), so compare energy per octave band.
    const octaves = (psd: number[], theory: (k: number) => number, k0: number, k1: number) => {
      const bands: { k: number; measured: number; theory: number }[] = [];
      for (let lo = k0; lo * 2 <= k1 * 1.0001; lo *= 2) {
        let m = 0;
        let t = 0;
        k.forEach((kk, i) => {
          if (kk >= lo && kk < 2 * lo) {
            m += psd[i];
            t += theory(kk);
          }
        });
        bands.push({ k: lo * Math.SQRT2, measured: m, theory: t });
      }
      return bands;
    };
    /** Least-squares slope of log(band power density) vs log(k). */
    const slope = (bands: { k: number; measured: number }[]) => {
      const xs = bands.map((b) => Math.log(b.k));
      const ys = bands.map((b) => Math.log(b.measured / b.k));
      const mx = xs.reduce((a, b) => a + b) / xs.length;
      const my = ys.reduce((a, b) => a + b) / ys.length;
      let num = 0;
      let den = 0;
      xs.forEach((x, i) => {
        num += (x - mx) * (ys[i] - my);
        den += (x - mx) ** 2;
      });
      return num / den;
    };
    const bandsU = octaves(acc.u, (kk) => drydenLongitudinalSpectrum(kk, I.sigmaU, I.lengthU), 0.5 / 1024, 0.5);
    const bandsW = octaves(acc.w, (kk) => drydenTransverseSpectrum(kk, I.sigmaW, I.lengthW), 0.5 / 1024, 0.5);
    const inRange = (bands: typeof bandsU, lo: number) => bands.filter((b) => b.k >= lo);
    const slopeU = slope(inRange(bandsU, 8 / I.lengthU));
    const slopeW = slope(inRange(bandsW, 8 / I.lengthW));
    const ratiosU = inRange(bandsU, 0.004).map((b) => b.measured / b.theory);
    const ratiosW = inRange(bandsW, 0.004).map((b) => b.measured / b.theory);
    report('spectra h=150 m', {
      Lu: I.lengthU,
      Lw: I.lengthW,
      slopeU,
      slopeW,
      octaveRatiosU: ratiosU.map((r) => r.toFixed(2)).join(','),
      octaveRatiosW: ratiosW.map((r) => r.toFixed(2)).join(','),
    });
    expect(slopeU).toBeGreaterThan(-2.3);
    expect(slopeU).toBeLessThan(-1.7);
    expect(slopeW).toBeGreaterThan(-2.3);
    expect(slopeW).toBeLessThan(-1.7);
    for (const r of [...ratiosU, ...ratiosW]) {
      expect(r).toBeGreaterThan(0.5);
      expect(r).toBeLessThan(2);
    }
  }, 60_000);

  test('mechanical turbulence grows with the surface wind; the field drifts with the wind', () => {
    const weather = calm({ windSpeedKt: 0 });
    const field = new WindField(weather, () => ELEV, 5);
    const sigmaCalm = field.breakdown(at(30), 0).intensity.sigmaW;
    weather.windSpeedKt = 25;
    const sigmaWindy = field.breakdown(at(30), 0).intensity.sigmaW;
    // Frozen turbulence: a point moving with the drift wind keeps seeing (nearly) the same gust, while a
    // fixed point sees the field sweep past. Correlations over many points, 3 s apart.
    const drift = field.breakdown(at(100), 0).mean; // the field drifts with the 100 m wind
    const tau = 3;
    const a: number[] = [];
    const moving: number[] = [];
    const fixed: number[] = [];
    for (let i = 0; i < 400; i++) {
      const n = i * 97;
      const e = -i * 61;
      a.push(field.breakdown(at(200, n, e), 100).turbulence.w);
      moving.push(field.breakdown(at(200, n + drift.x * tau, e + drift.y * tau), 100 + tau).turbulence.w);
      fixed.push(field.breakdown(at(200, n, e), 100 + tau).turbulence.w);
    }
    const corr = (x: number[], y: number[]) => {
      const mx = x.reduce((s, v) => s + v) / x.length;
      const my = y.reduce((s, v) => s + v) / y.length;
      let sxy = 0;
      let sxx = 0;
      let syy = 0;
      x.forEach((v, i) => {
        sxy += (v - mx) * (y[i] - my);
        sxx += (v - mx) ** 2;
        syy += (y[i] - my) ** 2;
      });
      return sxy / Math.sqrt(sxx * syy);
    };
    const frozen = corr(a, moving);
    const swept = corr(a, fixed);
    report('mechanical', { sigmaWCalm: sigmaCalm, sigmaW25kt: sigmaWindy, corrMovingWithWind: frozen, corrFixedPoint: swept });
    expect(sigmaCalm).toBe(0);
    // MIL-F-8785C: sigma_w = 0.1 W20, W20 = log-profile wind at 20 ft.
    expect(sigmaWindy).toBeGreaterThan(0.08 * 25 * KT);
    expect(sigmaWindy).toBeLessThan(0.1 * 25 * KT);
    expect(frozen).toBeGreaterThan(0.85);
    expect(swept).toBeLessThan(frozen - 0.1);
  });

  test('deterministic for a seed', () => {
    const weather = calm({ windSpeedKt: 10, gustKt: 18, turbulence: 0.5, timeOfDay: 13 });
    const a = createEnvironment({ weather, terrain: flatTerrain(), seed: 42 });
    const b = createEnvironment({ weather, terrain: flatTerrain(), seed: 42 });
    const c = createEnvironment({ weather, terrain: flatTerrain(), seed: 43 });
    let same = true;
    let differs = false;
    for (let i = 0; i < 500; i++) {
      const p = at(50 + i, i * 37, -i * 11);
      const wa = a.wind(p, i * 0.25);
      const wb = b.wind(p, i * 0.25);
      const wc = c.wind(p, i * 0.25);
      same &&= wa.x === wb.x && wa.y === wb.y && wa.z === wb.z;
      differs ||= Math.abs(wa.z - wc.z) > 1e-3;
    }
    expect(same).toBe(true);
    expect(differs).toBe(true);
  });
});

describe('terrain and convection', () => {
  test('orographic up-draught on the windward slope, down-draught in the lee', () => {
    const slope = 0.15; // terrain rising toward the north
    const terrain: TerrainProvider = { height: (n) => ELEV + slope * n, normal: () => v3.normalize({ x: -slope, y: 0, z: -1 }), surface: () => 'grass' };
    const weather = calm({ windSpeedKt: 20, windDirectionDeg: 180 }); // southerly: blows north, up the slope
    const env = createEnvironment({ weather, terrain });
    const p = (agl: number): Vec3 => ({ x: 1000, y: 0, z: -(ELEV + slope * 1000 + agl) });
    const up50 = env.windField.breakdown(p(50), 0).orographic;
    const up1000 = env.windField.breakdown(p(1000), 0).orographic;
    const horizontal = env.windField.breakdown(p(50), 0).mean;
    weather.windDirectionDeg = 0; // northerly: blows down the slope
    const down50 = env.windField.breakdown(p(50), 0).orographic;
    const expected = horizontal.x * slope * Math.exp(-50 / 300);
    report('orographic', { up50m: up50, up1000m: up1000, lee50m: down50, expected50m: expected });
    expect(up50).toBeCloseTo(expected, 3);
    expect(up50).toBeGreaterThan(1);
    expect(up50).toBeLessThanOrEqual(4);
    expect(up1000).toBeLessThan(0.2 * up50);
    expect(down50).toBeLessThan(-1);
  });

  test('thermals under a convective sky: strong cores, gentle sink, none at night', () => {
    const weather = calm({ timeOfDay: 13.5, dayOfYear: 180, cloudCover: 0.4, cloudBaseM: 1800, windSpeedKt: 4 });
    const field = new WindField(weather, () => ELEV, 9);
    let max = 0;
    let min = 0;
    let sum = 0;
    let n = 0;
    for (let i = 0; i < 400; i++) {
      for (let j = 0; j < 400; j++) {
        const w = field.breakdown(at(500, i * 25, j * 25), 600).thermal;
        max = Math.max(max, w);
        min = Math.min(min, w);
        sum += w;
        n++;
      }
    }
    const wStar = field.convectiveVelocity(4 * KT);
    weather.timeOfDay = 1;
    const night = field.breakdown(at(500, 5000, 5000), 600).thermal;
    report('thermals 10x10 km at 500 m', { wStar, maxUp: max, maxSink: min, mean: sum / n });
    expect(max).toBeGreaterThan(1.5);
    expect(max).toBeLessThan(5);
    expect(min).toBeGreaterThan(-1.5);
    expect(Math.abs(sum / n)).toBeLessThan(0.1);
    expect(night).toBe(0);
  });
});

describe('performance', () => {
  test('cost per wind() call with everything enabled', () => {
    const weather = { ...defaultWeather(), windSpeedKt: 12, gustKt: 20, turbulence: 0.5, timeOfDay: 13 };
    const env = createEnvironment({ weather, terrain: flatTerrain() });
    const n = 50000;
    const p = { x: 0, y: 0, z: -(ELEV + 300) };
    const start = performance.now();
    let acc = 0;
    for (let i = 0; i < n; i++) {
      p.x = i * 0.2;
      acc += env.wind(p, i / 240).z;
    }
    const us = ((performance.now() - start) / n) * 1000;
    report('performance', { microsecondsPerWindCall: us, checksum: acc });
    expect(us).toBeLessThan(30);
  });
});

describe('reset', () => {
  test('a reset restarts the frozen-turbulence advection: the same flight meets the same air whatever flew before', () => {
    const weather = calm({ windSpeedKt: 15, turbulence: 0.6 });
    const field = new WindField(weather, () => ELEV, 7);
    const probe = at(300, 100, 50);
    const reference = { ...field.sample(probe, 0.5) };
    // A previous flight that ended (e.g. crashed) at t = 0.65 s, less than a second in.
    field.sample(probe, 0.4);
    field.sample(probe, 0.65);
    field.reset();
    field.sample(probe, 0);
    const again = field.sample(probe, 0.5);
    report('wind after a reset', { dx: again.x - reference.x, dy: again.y - reference.y, dz: again.z - reference.z });
    expect(again.x).toBe(reference.x);
    expect(again.y).toBe(reference.y);
    expect(again.z).toBe(reference.z);
  });
});

