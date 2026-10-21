// Hail and snow lying on the ground (render/weather/groundCover.ts): the ground temperature falling under hail and
// snow until the particles lie, grass before pavement, snow needing more than hail, nothing lying under light hail
// or with warm air, the melting after the fall stops, continuity, step-size independence, reset and determinism.
// Each test logs its measured numbers.

import { describe, expect, it } from 'vitest';
import { GroundCover, PAVEMENT, restingC, SOIL, surfaceAirC, type SurfaceCover } from '../../src/render/weather/groundCover';

const report = (label: string, values: Record<string, number | string>) =>
  console.log(`[ground cover] ${label}: ${Object.entries(values).map(([k, v]) => `${k}=${typeof v === 'number' ? +v.toPrecision(4) : v}`).join('  ')}`);

interface Times {
  /** Seconds to the skin at 0.5 deg C, to cover 0.2 and to cover 0.5 (Infinity if not reached). */
  freeze: number;
  cover02: number;
  cover05: number;
}

/** Run hail and snow (mm/h) at airC for up to maxS in 0.5 s steps; the times per surface class. */
function run(hailMmH: number, snowMmH: number, airC: number, maxS: number, g = new GroundCover()): { soil: Times; pavement: Times; g: GroundCover } {
  const blank = (): Times => ({ freeze: Infinity, cover02: Infinity, cover05: Infinity });
  const out = { soil: blank(), pavement: blank(), g };
  g.update(0, 0, 0, airC, 0);
  for (let t = 0.5; t <= maxS; t += 0.5) {
    g.update(hailMmH, snowMmH, 0, airC, 0.5);
    for (const k of ['soil', 'pavement'] as const) {
      const s: SurfaceCover = g[k];
      const r = out[k];
      if (r.freeze === Infinity && s.groundC <= 0.5) r.freeze = t;
      if (r.cover02 === Infinity && s.cover >= 0.2) r.cover02 = t;
      if (r.cover05 === Infinity && s.cover >= 0.5) r.cover05 = t;
    }
  }
  return out;
}

/** Seconds after the fall stops until the cover is under 0.05 (Infinity within maxS). */
function meltTime(s: SurfaceCover, g: GroundCover, airC: number, maxS: number): number {
  for (let t = 1; t <= maxS; t += 1) {
    g.update(0, 0, 0, airC, 1);
    if (s.cover < 0.05) return t;
  }
  return Infinity;
}

describe('ground temperature and lying hail', () => {
  it('starts at the resting temperature over the surface air temperature', () => {
    const g = new GroundCover();
    const air = surfaceAirC(120, 8);
    g.update(0, 0, 0, air, 0);
    report('start, Thunderstorm preset at 120 m', { airC: air, soilC: g.soil.groundC, pavementC: g.pavement.groundC });
    expect(air).toBeCloseTo(15 + 8 - 0.0065 * 120, 1);
    expect(g.soil.groundC).toBe(restingC(SOIL, air));
    expect(g.pavement.groundC).toBe(restingC(PAVEMENT, air));
    for (let t = 0; t < 600; t++) g.update(0, 0, 0, air, 1);
    expect(g.soil.groundC).toBeCloseTo(restingC(SOIL, air), 9);
  });

  it('freezes the skin after one to two minutes of the heaviest storm-cell hail, grass before pavement', () => {
    // 9.1 mm/h: the largest hail rate measured at 120 m under the Thunderstorm preset's derived cells and an explicit
    // cell of intensity 1 (stormPrecip.ts, 2026-10-21).
    for (const [rate, air] of [[9.1, 22], [9.1, 15], [20, 22], [36.7, 22], [36.7, 10], [5, 22], [3, 10]]) {
      const r = run(rate, 0, air, 1800);
      report(`hail ${rate} mm/h, air ${air} C`, {
        soilFreezeS: r.soil.freeze, paveFreezeS: r.pavement.freeze,
        soilCover02S: r.soil.cover02, paveCover02S: r.pavement.cover02,
        soilCover05S: r.soil.cover05, paveCover05S: r.pavement.cover05,
      });
      expect(r.soil.freeze).toBeLessThan(r.pavement.freeze);
      expect(r.soil.cover05).toBeLessThan(r.pavement.cover05);
    }
    const heavy = run(9.1, 0, 22, 600);
    expect(heavy.soil.freeze).toBeGreaterThan(30);
    expect(heavy.soil.freeze).toBeLessThan(120);
    expect(heavy.pavement.freeze).toBeGreaterThan(60);
    expect(heavy.pavement.freeze).toBeLessThan(180);
  });

  it('lays nothing under light hail on warm ground: stones melt and wet the surface', () => {
    for (const [rate, air] of [[2, 22], [1, 15], [1, 10]]) {
      const r = run(rate, 0, air, 3600);
      const g = r.g;
      report(`light hail ${rate} mm/h, air ${air} C, 1 h`, { soilC: g.soil.groundC, paveC: g.pavement.groundC, soilKg: g.soil.hailKg, paveKg: g.pavement.hailKg, wetness: g.pavement.wetness });
      expect(g.soil.hailKg).toBe(0);
      expect(g.pavement.hailKg).toBe(0);
      expect(g.soil.cover).toBe(0);
      expect(g.pavement.wetness).toBeGreaterThan(0.99);
      expect(g.clear).toBe(false);
    }
  });

  it('lays hail from the start on frozen ground', () => {
    const r = run(5, 0, -4, 60);
    expect(r.soil.freeze).toBe(0.5);
    expect(r.g.pavement.hailKg).toBeCloseTo((5 / 3600) * 60, 6);
  });

  it('melts the lying hail after it stops, slower in colder air', () => {
    const melt: Record<string, number> = {};
    for (const air of [22, 15, 10]) {
      const r = run(36.7, 0, air, 180);
      const g = r.g;
      const depth = { soil: g.soil.hailMm, pavement: g.pavement.hailMm };
      const coverAtStop = { soil: g.soil.cover, pavement: g.pavement.cover };
      const pave = meltTime(g.pavement, g, air, 14_400);
      const g2 = run(36.7, 0, air, 180).g;
      const soil = meltTime(g2.soil, g2, air, 14_400);
      melt[`soil${air}`] = soil;
      melt[`pave${air}`] = pave;
      report(`melt after 180 s of 36.7 mm/h, air ${air} C`, {
        soilMm: depth.soil, paveMm: depth.pavement, soilCover: coverAtStop.soil, paveCover: coverAtStop.pavement, soilMeltS: soil, paveMeltS: pave,
      });
      expect(pave).toBeLessThan(soil);
      expect(soil).toBeLessThan(14_400);
    }
    expect(melt.soil10).toBeGreaterThan(melt.soil22);
    expect(melt.pave10).toBeGreaterThan(melt.pave22);
  });
});

describe('lying snow', () => {
  it('covers grass before pavement under the same snowfall', () => {
    for (const [rate, air] of [[1.5, 0.5], [2, 1], [5, 0]]) {
      const r = run(0, rate, air, 7200);
      report(`snow ${rate} mm/h, air ${air} C`, {
        soilFreezeS: r.soil.freeze, paveFreezeS: r.pavement.freeze, soilCover05S: r.soil.cover05, paveCover05S: r.pavement.cover05,
        soilSnowMm: r.g.soil.snowMm, paveSnowMm: r.g.pavement.snowMm,
      });
      expect(r.soil.cover05).toBeLessThan(r.pavement.cover05);
    }
  });

  it('needs more time and more water than hail at the same liquid-equivalent rate', () => {
    for (const [rate, air] of [[5, 1], [9.1, 0.5], [2, 0]]) {
      const hail = run(rate, 0, air, 7200);
      const snow = run(0, rate, air, 7200);
      report(`hail against snow, ${rate} mm/h, air ${air} C`, {
        hailSoil05S: hail.soil.cover05, snowSoil05S: snow.soil.cover05, hailPave05S: hail.pavement.cover05, snowPave05S: snow.pavement.cover05,
      });
      expect(snow.soil.cover05).toBeGreaterThan(hail.soil.cover05);
      expect(snow.pavement.cover05).toBeGreaterThan(hail.pavement.cover05);
    }
  });

  it('lets no light snow lie with the air above +3 C', () => {
    for (const [rate, air] of [[1, 3.2], [2, 4], [0.5, 3.5]]) {
      const r = run(0, rate, air, 3600);
      report(`snow ${rate} mm/h, air ${air} C, 1 h`, { soilC: r.g.soil.groundC, soilKg: r.g.soil.snowKg, paveKg: r.g.pavement.snowKg, wetness: r.g.soil.wetness });
      expect(r.g.soil.snowKg).toBe(0);
      expect(r.g.pavement.snowKg).toBe(0);
    }
  });
});

describe('ground cover integration', () => {
  it('is zero and clear without precipitation, and clear in rain alone', () => {
    const g = new GroundCover();
    for (let t = 0; t < 600; t++) g.update(0, 0, 0, 15, 1);
    for (const s of [g.soil, g.pavement]) expect([s.hailKg, s.snowKg, s.waterKg, s.cover, s.wetness, s.hailCover, s.snowCover]).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(g.clear).toBe(true);
    for (let t = 0; t < 600; t++) g.update(0, 0, 6, 15, 1);
    expect(g.soil.wetness).toBeGreaterThan(0.99);
    expect(g.soil.hailKg + g.soil.snowKg).toBe(0);
    expect(g.clear).toBe(true);
  });

  it('changes continuously frame by frame as hail starts and stops', () => {
    const g = new GroundCover();
    const dt = 1 / 60;
    g.update(0, 0, 0, 22, 0);
    let prev = { t: g.pavement.groundC, c: g.pavement.cover, s: g.soil.cover };
    let maxT = 0, maxC = 0;
    for (let i = 0; i < 60 * 600; i++) {
      const hail = i < 60 * 240 ? 36.7 * Math.min(1, i / 600) : 0;
      g.update(hail, 0, 0, 22, dt);
      maxT = Math.max(maxT, Math.abs(g.pavement.groundC - prev.t));
      maxC = Math.max(maxC, Math.abs(g.pavement.cover - prev.c), Math.abs(g.soil.cover - prev.s));
      prev = { t: g.pavement.groundC, c: g.pavement.cover, s: g.soil.cover };
    }
    report('largest change per 1/60 s frame', { groundC: maxT, cover: maxC });
    expect(maxT).toBeLessThan(0.05);
    expect(maxC).toBeLessThan(0.005);
  });

  it('gives the same state for frames of 1/60 s, 0.5 s and 30 s (time acceleration)', () => {
    const at = (dt: number) => {
      const g = new GroundCover();
      g.update(0, 0, 0, 22, 0);
      for (let t = 0; t < 300 - 1e-9; t += dt) g.update(20, 0, 0, 22, dt);
      for (let t = 0; t < 600 - 1e-9; t += dt) g.update(0, 0, 0, 22, dt);
      return g.pavement;
    };
    const a = at(1 / 60), b = at(0.5), c = at(30);
    report('pavement after 300 s of 20 mm/h and 600 s without, by frame length', { hailMm60: a.hailMm, hailMm05: b.hailMm, hailMm30: c.hailMm, groundC60: a.groundC, groundC30: c.groundC });
    expect(b.hailKg).toBeCloseTo(a.hailKg, 3);
    expect(c.hailKg).toBeCloseTo(a.hailKg, 3);
    expect(c.groundC).toBeCloseTo(a.groundC, 2);
  });

  it('is deterministic and resets to the start', () => {
    const go = () => run(9.1, 1, 2, 400).g;
    const a = go(), b = go();
    expect([a.soil.groundC, a.soil.hailKg, a.soil.snowKg, a.pavement.waterKg]).toEqual([b.soil.groundC, b.soil.hailKg, b.soil.snowKg, b.pavement.waterKg]);
    a.reset();
    expect(a.clear).toBe(true);
    expect(Number.isNaN(a.soil.groundC)).toBe(true);
    a.update(0, 0, 0, 10, 0);
    expect(a.soil.groundC).toBe(restingC(SOIL, 10));
  });
});
