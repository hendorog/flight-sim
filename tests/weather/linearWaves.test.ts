// Linear mountain-wave solver (physics/weather/orography/linearWaves.ts) and FFT against analytic solutions. Each
// test logs its measured numbers.

import { describe, expect, test } from 'vitest';
import { fft, fft2 } from '../../src/physics/weather/orography/fft';
import {
  FIELD_ETA,
  FIELD_U,
  FIELD_W,
  ModeSolver,
  emptyWaveLayers,
  solveWaveGrid,
  type WaveLayers,
  type WaveOptions,
} from '../../src/physics/weather/orography/linearWaves';

const report = (label: string, values: Record<string, number | string>) =>
  console.log(`[waves] ${label}: ${Object.entries(values).map(([k, v]) => `${k}=${typeof v === 'number' ? +v.toPrecision(4) : v}`).join('  ')}`);

const TEST_OPTIONS: WaveOptions = { nu: 1e-6, minWavelength: 0, criticalSpeed: 0.5 };

function layers(spec: { bottom: number; U: number; V?: number; N: number }[]): WaveLayers {
  const L = emptyWaveLayers();
  L.count = spec.length;
  spec.forEach((s, j) => {
    L.bottom[j] = s.bottom;
    L.U[j] = s.U;
    L.V[j] = s.V ?? 0;
    L.N2[j] = s.N * s.N;
  });
  return L;
}

/** Solve a 2-D (x-z) case on an nx x 8 grid: terrain h(x) uniform across the 8 columns; returns field rows at x. */
function solve2d(nx: number, dx: number, hx: (x: number) => number, L: WaveLayers, levels: number[], kinds: number[], o = TEST_OPTIONS) {
  const ny = 8;
  const h = new Float64Array(nx * ny);
  for (let i = 0; i < nx; i++) {
    const x = (i < nx / 2 ? i : i - nx) * dx;
    for (let j = 0; j < ny; j++) h[i * ny + j] = hx(x);
  }
  const out: Float64Array[] = [];
  solveWaveGrid(nx, ny, dx, h, L, { levels: Float64Array.from(levels), scale: new Float64Array(levels.length).fill(1), kinds }, o, (f, grid) => {
    const row = new Float64Array(nx);
    for (let i = 0; i < nx; i++) row[i] = grid[i * ny + 3];
    out[f] = row;
  });
  return out;
}

describe('FFT', () => {
  test('1-D and 2-D transforms invert and match a direct DFT', () => {
    const n = 16;
    const re = Float64Array.from({ length: n }, (_, i) => Math.sin(i * 0.7) + 0.3 * i);
    const im = Float64Array.from({ length: n }, (_, i) => Math.cos(i * 1.3));
    const r0 = Float64Array.from(re);
    const i0 = Float64Array.from(im);
    fft(re, im);
    let err = 0;
    for (let k = 0; k < n; k++) {
      let sr = 0;
      let si = 0;
      for (let t = 0; t < n; t++) {
        const a = (-2 * Math.PI * k * t) / n;
        sr += r0[t] * Math.cos(a) - i0[t] * Math.sin(a);
        si += r0[t] * Math.sin(a) + i0[t] * Math.cos(a);
      }
      err = Math.max(err, Math.abs(sr - re[k]), Math.abs(si - im[k]));
    }
    fft(re, im, true);
    let back = 0;
    for (let t = 0; t < n; t++) back = Math.max(back, Math.abs(re[t] - r0[t]), Math.abs(im[t] - i0[t]));
    const nx = 8;
    const ny = 32;
    const a = Float64Array.from({ length: nx * ny }, (_, i) => Math.sin(i * 0.37));
    const b = new Float64Array(nx * ny);
    const a0 = Float64Array.from(a);
    fft2(a, b, nx, ny);
    fft2(a, b, nx, ny, true);
    let back2 = 0;
    for (let i = 0; i < nx * ny; i++) back2 = Math.max(back2, Math.abs(a[i] - a0[i]), Math.abs(b[i]));
    report('fft', { dftError: err, inverseError: back, inverse2dError: back2 });
    expect(err).toBeLessThan(1e-12);
    expect(back).toBeLessThan(1e-13);
    expect(back2).toBeLessThan(1e-13);
  });
});

describe('uniform atmosphere', () => {
  test('hydrostatic Witch of Agnesi (a 10 km, U 10, N 0.01): eta within 5 % of h0 at z = pi/(2l) and pi/l', () => {
    const a = 10_000;
    const h0 = 100;
    const U = 10;
    const N = 0.01;
    const l = N / U;
    const nx = 512;
    const dx = 1000;
    const zs = [Math.PI / (2 * l), Math.PI / l];
    const rows = solve2d(nx, dx, (x) => (h0 * a * a) / (x * x + a * a), layers([{ bottom: 0, U, N }]), zs, [FIELD_ETA]);
    const Lx = nx * dx;
    for (let zi = 0; zi < zs.length; zi++) {
      const z = zs[zi];
      const analytic = new Float64Array(nx);
      let mean = 0;
      for (let i = 0; i < nx; i++) {
        const x0 = (i < nx / 2 ? i : i - nx) * dx;
        let s = 0;
        for (let n = -400; n <= 400; n++) {
          const x = x0 + n * Lx;
          s += (h0 * a * (a * Math.cos(l * z) - x * Math.sin(l * z))) / (x * x + a * a);
        }
        analytic[i] = s;
        mean += s / nx;
      }
      let err = 0;
      let peak = 0;
      for (let i = 0; i < nx; i++) {
        err = Math.max(err, Math.abs(rows[zi][i] - (analytic[i] - mean)));
        peak = Math.max(peak, Math.abs(rows[zi][i]));
      }
      report(`Witch z=${z.toFixed(0)} m`, { maxErrorOverH0: err / h0, peakEtaOverH0: peak / h0 });
      expect(err / h0).toBeLessThan(0.05);
    }
  });

  test('non-hydrostatic ridge (aN/U = 1): downstream wavelength 2 pi U / N within 10 %', () => {
    const a = 1000;
    const U = 10;
    const N = 0.01;
    const nx = 1024;
    const dx = 200;
    const z = 1000;
    const [w] = solve2d(nx, dx, (x) => (10 * a * a) / (x * x + a * a), layers([{ bottom: 0, U, N }]), [z], [FIELD_W]);
    // Zero crossings of w downstream (x north = row index) between 5 and 40 km.
    const crossings: number[] = [];
    for (let i = 5000 / dx; i < 40_000 / dx; i++) {
      if (w[i] > 0 !== w[i + 1] > 0) crossings.push((i + w[i] / (w[i] - w[i + 1])) * dx);
    }
    const wavelength = (2 * (crossings[crossings.length - 1] - crossings[0])) / (crossings.length - 1);
    report('non-hydrostatic', { measuredWavelengthM: wavelength, expectedM: (2 * Math.PI * U) / N, crossings: crossings.length });
    expect(crossings.length).toBeGreaterThan(4);
    expect(Math.abs(wavelength / ((2 * Math.PI * U) / N) - 1)).toBeLessThan(0.1);
  });

  test('evanescent mode (aN/U = 0.2): decays as exp(-mu z), mu = K sqrt(1 - (N/kU)^2)', () => {
    const U = 10;
    const N = 0.01;
    const nx = 512;
    const dx = 50;
    const k = (2 * Math.PI * 20) / (nx * dx);
    const zs = [0, 250, 500, 1000];
    const rows = solve2d(nx, dx, (x) => 10 * Math.cos(k * x), layers([{ bottom: 0, U, N }]), zs, [FIELD_ETA]);
    const amp = rows.map((r) => Math.max(...r));
    const mu = k * Math.sqrt(1 - (N / (k * U)) ** 2);
    const ratios = zs.map((z, i) => amp[i] / amp[0] / Math.exp(-mu * z));
    report('evanescent', { k, mu, ratio250: ratios[1], ratio500: ratios[2], ratio1000: ratios[3], decayVsExpKdz1000: amp[3] / amp[0] / Math.exp(-k * 1000) });
    expect(amp[0]).toBeCloseTo(10, 6);
    for (const r of ratios) expect(Math.abs(r - 1)).toBeLessThan(0.01);
  });
});

describe('layered atmosphere', () => {
  test('two-layer trapped lee wave: response peak at the k solving tan(n1 H) = -n1/n2 within 5 %', () => {
    const U = 10;
    const N1 = 0.01;
    const N2 = 0.002;
    const H = 3000;
    const l1 = N1 / U;
    const l2 = N2 / U;
    const L = layers([
      { bottom: 0, U, N: N1 },
      { bottom: H, U, N: N2 },
    ]);
    // Analytic root on the branch n1 H in (pi/2, l1 H) (l1 H = 3 < pi: the only branch).
    const f = (k: number) => {
      const n1 = Math.sqrt(l1 * l1 - k * k);
      const n2 = Math.sqrt(k * k - l2 * l2);
      return Math.tan(n1 * H) + n1 / n2;
    };
    let lo = l2 + 1e-12;
    let hi = Math.sqrt(l1 * l1 - (Math.PI / 2 / H) ** 2) - 1e-12;
    for (let i = 0; i < 200; i++) {
      const mid = 0.5 * (lo + hi);
      if (f(lo) * f(mid) <= 0) hi = mid;
      else lo = mid;
    }
    const kRoot = 0.5 * (lo + hi);
    const mode = new ModeSolver();
    const at = new Float64Array(4);
    let best = 0;
    let kPeak = 0;
    for (let i = 1; i < 4000; i++) {
      const k = l2 + ((l1 - l2) * i) / 4000;
      if (!mode.solve(k, 0, L, { ...TEST_OPTIONS, nu: 2e-5 })) continue;
      mode.at(H, at);
      const r = Math.hypot(at[0], at[1]);
      if (r > best) [best, kPeak] = [r, k];
    }
    report('trapped wave', { kRoot, kPeak, wavelengthRootM: (2 * Math.PI) / kRoot, wavelengthPeakM: (2 * Math.PI) / kPeak, peakResponse: best });
    expect(Math.abs(kPeak / kRoot - 1)).toBeLessThan(0.05);
    expect(best).toBeGreaterThan(5);
  });

  test('energy flux Re(p w*) is equal across an interface of stability', () => {
    const U = 10;
    const L = layers([
      { bottom: 0, U, N: 0.012 },
      { bottom: 2000, U, N: 0.008 },
    ]);
    const mode = new ModeSolver();
    const at = new Float64Array(4);
    const k = 3e-4;
    mode.solve(k, 0, L, TEST_OPTIONS);
    const flux = (z: number) => {
      const j = mode.at(z, at);
      const s = mode.sigma(j);
      // p ~ sigma^2 eta' / K^2, w = i sigma eta.
      const pr = (s * s * at[2]) / (k * k);
      const pi = (s * s * at[3]) / (k * k);
      const wr = -s * at[1];
      const wi = s * at[0];
      return pr * wr + pi * wi;
    };
    const below = flux(1999.999);
    const above = flux(2000.001);
    const deep = flux(500);
    const high = flux(6000);
    report('energy flux', { below, above, deepLower: deep, highUpper: high });
    expect(Math.abs(above / below - 1)).toBeLessThan(1e-4);
    // Within a layer the flux falls only by the damping nu (1e-6 1/s: about 2e-3 over 4 km here).
    expect(Math.abs(deep / below - 1)).toBeLessThan(3e-3);
    expect(Math.abs(high / above - 1)).toBeLessThan(3e-3);
    expect(below).not.toBe(0);
  });

  test('a critical level absorbs the wave: zero above, non-zero below', () => {
    const L = layers([
      { bottom: 0, U: 10, N: 0.01 },
      { bottom: 2000, U: -5, N: 0.01 },
    ]);
    const a = 5000;
    const rows = solve2d(256, 1000, (x) => (100 * a * a) / (x * x + a * a), L, [1000, 3000], [FIELD_W, FIELD_U]);
    const maxAbs = (r: Float64Array) => Math.max(...Array.from(r, Math.abs));
    report('critical level', { wBelow: maxAbs(rows[0]), uBelow: maxAbs(rows[1]), wAbove: maxAbs(rows[2]), uAbove: maxAbs(rows[3]) });
    expect(maxAbs(rows[0])).toBeGreaterThan(0.05);
    expect(maxAbs(rows[2])).toBe(0);
    expect(maxAbs(rows[3])).toBe(0);
  });
});
