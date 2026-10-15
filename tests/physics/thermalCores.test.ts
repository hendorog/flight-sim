// thermalCores enumerates the same lattice thermalUpdraft sums (Deep Time: the azhdarchid kettles circle in real
// lift), and WindField.thermalFrame is a read-only view of the field sample() uses.

import { describe, expect, it } from 'vitest';
import { defaultWeather } from '../../src/core/types';
import { makeThermalCore, thermalCoreRadius, thermalCores, thermalUpdraft } from '../../src/physics/weather/thermals';
import { WindField } from '../../src/physics/weather/windField';

const SEED = 0x1234abcd;
const ZI = 1500;
const AGL = 300;
const W_STAR = 2;

describe('thermalCores', () => {
  it('core centres are the thermalUpdraft maxima (within 5 m)', () => {
    const cores = Array.from({ length: 25 }, makeThermalCore);
    let checked = 0;
    for (const t of [0, 400, 1300]) {
      const n = thermalCores(SEED, 3000, -5000, t, cores, 2);
      for (let k = 0; k < n; k++) {
        const c = cores[k];
        if (c.strength < 0.1) continue;
        // Search a 60 m square around the reported centre for the updraft peak.
        let best = -Infinity;
        let bx = 0;
        let by = 0;
        for (let dx = -30; dx <= 30; dx += 1) {
          for (let dy = -30; dy <= 30; dy += 1) {
            const w = thermalUpdraft(SEED, c.x + dx, c.y + dy, AGL, t, W_STAR, ZI);
            if (w > best) {
              best = w;
              bx = dx;
              by = dy;
            }
          }
        }
        expect(Math.hypot(bx, by)).toBeLessThanOrEqual(5);
        expect(best).toBeGreaterThan(0);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(10);
  });

  it('summing the cores reproduces thermalUpdraft', () => {
    const cores = Array.from({ length: 9 }, makeThermalCore);
    let rnd = 7;
    const next = () => ((rnd = (rnd * 16807) % 2147483647) / 2147483647);
    for (let k = 0; k < 300; k++) {
      const x = (next() - 0.5) * 40000;
      const y = (next() - 0.5) * 40000;
      const t = next() * 3000;
      const agl = 50 + next() * 1200;
      const n = thermalCores(SEED, x, y, t, cores, 1);
      const r0 = thermalCoreRadius(agl, ZI);
      const zr = agl / ZI;
      const shape = Math.cbrt(zr) * (1 - 1.1 * zr);
      let w = 0;
      for (let c = 0; c < n; c++) {
        const r = r0 * cores[c].radiusFactor;
        const rho2 = ((x - cores[c].x) ** 2 + (y - cores[c].y) ** 2) / (r * r);
        if (rho2 > 9) continue;
        w += cores[c].strength * (1 - rho2) * Math.exp(-rho2);
      }
      const expected = Math.min(3 * W_STAR, Math.max(-3 * W_STAR, 3 * W_STAR * shape * w));
      expect(thermalUpdraft(SEED, x, y, agl, t, W_STAR, ZI)).toBeCloseTo(expected, 9);
    }
  });

  it('never allocates past the output array and reports the strength phase', () => {
    const cores = Array.from({ length: 3 }, makeThermalCore);
    const n = thermalCores(SEED, 0, 0, 100, cores, 3);
    expect(n).toBeLessThanOrEqual(3);
    for (let k = 0; k < n; k++) {
      const c = cores[k];
      expect(c.phase).toBeGreaterThanOrEqual(0);
      expect(c.phase).toBeLessThan(1);
      expect(c.strength).toBeGreaterThanOrEqual(0);
      expect(c.strength).toBeLessThanOrEqual(1.4 + 1e-9);
    }
  });
});

describe('WindField.thermalFrame', () => {
  it('is read-only: sampling with or without it gives identical wind', () => {
    const weather = defaultWeather();
    const ground = (n: number, e: number) => 120 + 0.01 * n + 0.005 * e;
    const a = new WindField(weather, ground, 3);
    const b = new WindField(weather, ground, 3);
    const p = { x: 500, y: -200, z: -500 };
    for (let k = 0; k < 200; k++) {
      const t = k * 0.1;
      b.thermalFrame();
      b.convectiveDepth(150);
      const wa = a.sample(p, t);
      const wb = b.sample(p, t);
      expect(wb).toEqual(wa);
    }
  });

  it('reproduces the thermal component of sample()', () => {
    const weather = { ...defaultWeather(), windSpeedKt: 6, cloudCover: 0.35, timeOfDay: 13 };
    const ground = () => 200;
    const wf = new WindField(weather, ground, 5);
    // Fly a slow line across the lattice so some samples fall in cores.
    let seen = 0;
    for (let k = 1; k < 2000; k++) {
      const t = k * 0.5;
      const p = { x: 1234 + 7 * k, y: -4321 + 3 * k, z: -(200 + 400) };
      const thermal = wf.breakdown(p, t).thermal;
      const f = wf.thermalFrame();
      expect(f.wStar).toBeGreaterThan(0);
      const w = thermalUpdraft(f.seed, p.x - f.driftN, p.y - f.driftE, 400, t, f.wStar, wf.convectiveDepth(200));
      expect(w).toBeCloseTo(thermal, 9);
      if (Math.abs(thermal) > 0.01) seen++;
    }
    expect(seen).toBeGreaterThan(0);
  });
});
