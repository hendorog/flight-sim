// The channel-form law (channelForm.ts, organic-map DESIGN.md sections 2-3): its numbers on the NZ reaches it was
// fitted to, the heterogeneity field's spread, and the laid thread's planform on a straight synthetic floor.
import { describe, expect, it } from 'vitest';
import { beltOffsets, besselJ0, fitSwing, formOf, hField, layThread, sineAmplitude, struveH0 } from '../../src/world/terrain/channelForm';
import { setWorldSeed } from '../../src/world/worldSeed';

describe('channel-form law', () => {
  it('special functions', () => {
    expect(besselJ0(0)).toBeCloseTo(1, 9);
    expect(besselJ0(1)).toBeCloseTo(0.7651976866, 8);
    expect(besselJ0(2)).toBeCloseTo(0.2238907791, 8);
    expect(struveH0(1)).toBeCloseTo(0.5686566270, 7);
    expect(struveH0(2)).toBeCloseTo(0.7908588350, 6);
    // A swing that does not fit is lowered until it does.
    const om = fitSwing(200, 1.3, 20);
    expect(sineAmplitude(200, om)).toBeLessThanOrEqual(20 + 1e-6);
    expect(sineAmplitude(200, om)).toBeGreaterThan(19.5);
  });

  it('the heterogeneity field has zero mean and unit spread', () => {
    setWorldSeed(42);
    let s = 0;
    let s2 = 0;
    const n = 200000;
    for (let i = 0; i < n; i++) {
      const v = hField((i % 997) * 0.731 + 0.13, Math.floor(i / 997) * 0.617 - 0.29, 5);
      s += v;
      s2 += v * v;
    }
    const mean = s / n;
    const sd = Math.sqrt(s2 / n - mean * mean);
    setWorldSeed(0);
    expect(Math.abs(mean)).toBeLessThan(0.05);
    expect(sd).toBeGreaterThan(0.9);
    expect(sd).toBeLessThan(1.1);
  });

  it('single-thread NZ reaches (lawcheck.out: confined, one thread, the bed W_s)', () => {
    // [A km², S, F m, law W_a, law phi]: gorges, the Selwyn, the creek, hill V's and torrents.
    const rows: Array<[number, number, number, number, number]> = [
      [2575.7, 0.0031, 219, 95.6, 0.4],
      [2188.5, 0.0034, 198, 89.7, 0.4],
      [1187.8, 0.0026, 361, 70.7, 0.8],
      [6.4, 0.0014, 121, 9.2, 0.8],
      [18.0, 0.0378, 113, 13.8, 0.4],
      [8.1, 0.1245, 51, 10.1, 0.4],
    ];
    for (const [A, S, F, Wa, phi] of rows) {
      // (The bed's pattern share is nil or a few hundredths on these confined reaches: the bed within 5 % of W_s, the
      // water - one thread, its catchment's - within 3 % of the fit's.)
      const f = formOf(A, S, F);
      expect(f.Wa).toBeGreaterThan(Wa * 0.97);
      expect(f.Wa).toBeLessThan(Wa * 1.05);
      expect(f.phi * f.Wa).toBeGreaterThan(phi * Wa * 0.97);
      expect(f.phi * f.Wa).toBeLessThan(phi * Wa * 1.03);
    }
  });

  it('the thread stays in its room with no bend tighter than its width', () => {
    setWorldSeed(42);
    // (name, A, S, F): lawcheck's classes; the floor straight, 20 km.
    const cases: Array<[string, number, number, number]> = [
      ['lowland', 69, 0.0036, 520],
      ['plains', 1052, 0.0015, 1670],
      ['p7-8 319', 64, 0.012, 600],
      ['mtn floor', 160, 0.0143, 370],
      ['gorge', 38, 0.0341, 40],
      ['line 60', 120, 0.034, 450],
    ];
    for (const [name, A, S, F] of cases) {
      const f = formOf(A, S, F);
      const w = f.phi * f.Wa;
      const R = Math.max(0, F / 2 - w / 2);
      const lam2 = Math.max(48, f.lam2);
      const a2f = Math.min(sineAmplitude(lam2, f.om2), 0.8 * R);
      const om2 = fitSwing(lam2, f.om2, a2f);
      const m = 201;
      const N = Array.from({ length: m }, (_, i) => i * 100);
      const E = Array.from({ length: m }, () => 0);
      const c = (v: number): number[] => Array.from({ length: m }, () => v);
      // The belt wanders the floor, keeping the thread's swing and the bed on it (riverNetwork.ts lawAlong).
      const om1 = fitSwing(f.lam1, f.om1, Math.max(0, 0.8 * R - a2f));
      const hi = Math.min(R - 1.35 * (a2f + sineAmplitude(f.lam1, om1)), F / 2 - f.Wa / 2);
      const belt = beltOffsets(N, c(-hi), c(hi), c(Math.max(f.lam1, 3 * F)), 7);
      const t = layThread(N, E, { belt, lam1: c(f.lam1), om1: c(om1), lam2: c(lam2), om2: c(om2), Wa: c(f.Wa), roomL: c(R), roomR: c(R) }, 7);
      const maxOff = Math.max(...t.off.map(Math.abs));
      expect(maxOff, name).toBeLessThanOrEqual(R + 0.5);
      // (It wanders: the belt reaches past half its range both ways, where it has room to.)
      const beltMax = Math.max(...Array.from(belt)), beltMin = Math.min(...Array.from(belt));
      if (hi > 20) expect(beltMax - beltMin, name).toBeGreaterThan(hi);
      // Radius through three points one W apart (resampled every W/6), kinks (R < W) per 10 km.
      const step = Math.max(1, f.Wa / 6);
      const s = [0];
      for (let i = 1; i < t.north.length; i++) s.push(s[i - 1] + Math.hypot(t.north[i] - t.north[i - 1], t.east[i] - t.east[i - 1]));
      const X: number[] = [];
      const Y: number[] = [];
      for (let sv = 0, j = 0; sv < s[s.length - 1]; sv += step) {
        while (j < s.length - 2 && s[j + 1] < sv) j++;
        const u = (sv - s[j]) / Math.max(1e-9, s[j + 1] - s[j]);
        X.push(t.north[j] + (t.north[j + 1] - t.north[j]) * u);
        Y.push(t.east[j] + (t.east[j + 1] - t.east[j]) * u);
      }
      const k = Math.max(1, Math.round(f.Wa / step));
      let kinks = 0;
      let prevTight = false;
      for (let i = k; i < X.length - k; i++) {
        const ab = Math.hypot(X[i - k] - X[i], Y[i - k] - Y[i]);
        const bc = Math.hypot(X[i + k] - X[i], Y[i + k] - Y[i]);
        const ca = Math.hypot(X[i + k] - X[i - k], Y[i + k] - Y[i - k]);
        const cross = Math.abs((X[i] - X[i - k]) * (Y[i + k] - Y[i - k]) - (Y[i] - Y[i - k]) * (X[i + k] - X[i - k]));
        const Rc = (ab * bc * ca) / Math.max(1e-9, 2 * cross);
        const tight = Rc < f.Wa;
        if (tight && !prevTight) kinks++;
        prevTight = tight;
      }
      const sinu = s[s.length - 1] / Math.hypot(t.north[t.north.length - 1] - t.north[0], t.east[t.east.length - 1] - t.east[0]);
      console.log(`${name}: Wa ${f.Wa.toFixed(1)} w ${w.toFixed(1)} belt ${beltMin.toFixed(0)}..${beltMax.toFixed(0)} om2 ${om2.toFixed(2)} max|off| ${maxOff.toFixed(1)} room ${R.toFixed(1)} kinks/10km ${((kinks * 10000) / s[s.length - 1]).toFixed(2)} sinuosity ${sinu.toFixed(3)}`);
      expect((kinks * 10000) / s[s.length - 1], name).toBeLessThanOrEqual(0.5);
    }
    setWorldSeed(0);
  });
});
