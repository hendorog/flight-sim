// The storm cells' local precipitation (physics/weather/stormPrecip.ts) and hail (hail.ts): nothing without cells,
// continuous along paths into, through and out of a rain shaft, hail size growing with the updraft, the size
// distribution, and the curtain noise's hash. Each test logs its measured numbers.

import { describe, expect, it } from 'vitest';
import { defaultWeather, type StormCell, type WeatherSettings } from '../../src/core/types';
import { precipExtinctionPerM, precipRateForExtinction } from '../../src/core/weatherFields';
import { StormField } from '../../src/physics/weather/stormField';
import {
  HAIL_FULL_MM,
  HAIL_ONSET_MM,
  hailDiameterMm,
  hailFallSpeed,
  hailLowMm,
  hailMaxDiameterMm,
  hailNumberDensity,
  hailOccurrence,
  hailUpdraftMs,
} from '../../src/physics/weather/hail';
import { emptyLocalPrecip, localPrecipAt, rainHash, rainValueNoise, stratiformPrecip, type LocalPrecip } from '../../src/physics/weather/stormPrecip';
import { HailExposure } from '../../src/sim/weather/hailExposure';
import { applyWeatherPreset, weatherPresetById } from '../../src/sim/weatherPresets';

const report = (label: string, values: Record<string, number | string>) =>
  console.log(`[stormPrecip] ${label}: ${Object.entries(values).map(([k, v]) => `${k}=${typeof v === 'number' ? +v.toPrecision(4) : v}`).join('  ')}`);

const cell = (over: Partial<StormCell> = {}): StormCell => ({ northM: 0, eastM: 0, radiusM: 3000, topM: 11_000, intensity: 0.9, motionDeg: 0, motionKt: 0, ...over });
const weather = (over: Partial<WeatherSettings> = {}): WeatherSettings => ({ ...defaultWeather(), cloudBaseM: 900, windSpeedKt: 10, windDirectionDeg: 250, ...over });

describe('local precipitation without storms', () => {
  it('is the stratiform precipitation, with no hail, in the default weather and with an empty cell list', () => {
    const w = defaultWeather();
    const field = new StormField();
    expect(field.select(w, 0, 0, 0)).toHaveLength(0);
    const a = localPrecipAt(w, field.select(w, 0, 0, 0), 0, 0, 0, 0, 300, emptyLocalPrecip());
    expect(a).toEqual({ type: 'none', rateMmH: 0, stormRainMmH: 0, hailMmH: 0, hailMaxMm: 0, extinctionPerM: 0 });
    const rain = { ...w, precipType: 'rain' as const, precipRateMmH: 6, storms: [] };
    const b = localPrecipAt(rain, [], 0, 0, 1000, -2000, 300, emptyLocalPrecip());
    expect(b).toEqual(stratiformPrecip(rain, emptyLocalPrecip()));
    expect(b.rateMmH).toBe(6);
    expect(b.extinctionPerM).toBe(precipExtinctionPerM('rain', 6));
  });

  it('inverts the extinction fit', () => {
    for (const r of [0.5, 5, 40]) expect(precipRateForExtinction('rain', precipExtinctionPerM('rain', r))).toBeCloseTo(r, 9);
    expect(precipRateForExtinction('none', 1)).toBe(0);
  });
});

describe('local precipitation along paths through a shaft', () => {
  const w = weather();
  const cells = [cell()];
  const out: LocalPrecip = emptyLocalPrecip();

  /** Largest change of each quantity between 5 m steps along a straight path. */
  const walk = (n0: number, e0: number, n1: number, e1: number, alt: number) => {
    const steps = Math.round(Math.hypot(n1 - n0, e1 - e0) / 5);
    let prev: LocalPrecip | null = null;
    const max = { rate: 0, ext: 0, hail: 0, peakRate: 0, peakHail: 0, peakExt: 0 };
    for (let i = 0; i <= steps; i++) {
      const f = i / steps;
      const p = { ...localPrecipAt(w, cells, 0, 2500, n0 + (n1 - n0) * f, e0 + (e1 - e0) * f, alt, out) };
      if (prev) {
        max.rate = Math.max(max.rate, Math.abs(p.rateMmH - prev.rateMmH));
        max.ext = Math.max(max.ext, Math.abs(p.extinctionPerM - prev.extinctionPerM));
        max.hail = Math.max(max.hail, Math.abs(p.hailMmH - prev.hailMmH));
      }
      max.peakRate = Math.max(max.peakRate, p.rateMmH);
      max.peakHail = Math.max(max.peakHail, p.hailMmH);
      max.peakExt = Math.max(max.peakExt, p.extinctionPerM);
      prev = p;
    }
    return max;
  };

  it('changes by less than 2 % of its peak per 5 m on straight paths into and out of the core, at three heights', () => {
    for (const [label, n0, e0, n1, e1] of [
      ['south to north', -9000, 0, 9000, 0],
      ['west to east, off-centre', 600, -9000, 600, 9000],
      ['diagonal', -7000, -7000, 7000, 7000],
    ] as const) {
      for (const alt of [200, 500, 850]) {
        const m = walk(n0, e0, n1, e1, alt);
        report(`${label} at ${alt} m`, { peakMmH: m.peakRate, stepMmH: m.rate, peakExt: m.peakExt, stepExt: m.ext, peakHail: m.peakHail, stepHail: m.hail });
        expect(m.peakRate).toBeGreaterThan(5);
        expect(m.rate).toBeLessThan(0.02 * m.peakRate);
        expect(m.ext).toBeLessThan(0.02 * m.peakExt);
        expect(m.hail).toBeLessThan(0.02 * Math.max(m.peakHail, 1e-9) + 1e-9);
      }
    }
  });

  it('rains heavily in the core, lightly at the edge, and not at all 2.5 radii out', () => {
    const at = (n: number) => localPrecipAt(w, cells, 0, 2500, n, 0, 300, out).rateMmH;
    const core = at(0), edge = at(1900), out3 = at(7500);
    report('rate by distance', { core, edge, out3 });
    expect(core).toBeGreaterThan(20);
    expect(edge).toBeLessThan(core);
    expect(out3).toBe(0);
  });

  it('is continuous in time as the cell moves over a fixed point', () => {
    const moving = [cell({ motionDeg: 270, motionKt: 20, eastM: -6000 })];
    let prev = -1;
    let step = 0;
    let peak = 0;
    for (let t = 0; t <= 1200; t += 0.5) {
      const r = localPrecipAt(w, moving, t, 0, 0, 0, 300, out).rateMmH;
      if (prev >= 0) step = Math.max(step, Math.abs(r - prev));
      peak = Math.max(peak, r);
      prev = r;
    }
    report('fixed point, cell at 20 kt', { peak, step });
    expect(step).toBeLessThan(0.01 * peak);
  });
});

describe('hail', () => {
  it('falls at about 9 m/s at 5 mm and 30 m/s at 50 mm, faster for larger stones', () => {
    report('fall speed', { at5mm: hailFallSpeed(5), at10mm: hailFallSpeed(10), at25mm: hailFallSpeed(25), at50mm: hailFallSpeed(50) });
    expect(hailFallSpeed(5)).toBeGreaterThan(8.5);
    expect(hailFallSpeed(5)).toBeLessThan(10.5);
    expect(hailFallSpeed(50)).toBeGreaterThan(28);
    expect(hailFallSpeed(50)).toBeLessThan(32);
    for (let d = 1; d < 100; d++) expect(hailFallSpeed(d + 1)).toBeGreaterThan(hailFallSpeed(d));
  });

  it('grows with the updraft: the largest stone rises monotonically with intensity and CAPE', () => {
    let prev = -1;
    for (let w = 0; w <= 60; w += 0.5) {
      const d = hailMaxDiameterMm(w);
      expect(d).toBeGreaterThanOrEqual(prev);
      prev = d;
    }
    for (const cape of [0, 500, 1500, 2743, 4000]) {
      let p = -1;
      for (let i = 0; i <= 1; i += 0.05) {
        const d = hailMaxDiameterMm(hailUpdraftMs(i, cape));
        expect(d).toBeGreaterThanOrEqual(p);
        p = d;
      }
    }
    const ts = hailMaxDiameterMm(hailUpdraftMs(1, 2743));
    const weak = hailMaxDiameterMm(hailUpdraftMs(0.2, 0));
    const explicit = hailMaxDiameterMm(hailUpdraftMs(0.8, 0));
    report('largest stone', { thunderstormI1: ts, explicitI08: explicit, weakI02: weak });
    expect(ts).toBeGreaterThan(50);
    expect(explicit).toBeGreaterThan(5);
    expect(hailOccurrence(weak)).toBe(0);
    expect(hailOccurrence(HAIL_ONSET_MM)).toBe(0);
    expect(hailOccurrence(HAIL_FULL_MM)).toBe(1);
  });

  it('draws stone sizes from the smallest to the largest, increasing with the quantile', () => {
    for (const max of [4, 10, 30, 60]) {
      let prev = -1;
      for (let u = 0; u <= 1; u += 0.01) {
        const d = hailDiameterMm(u, max);
        expect(d).toBeGreaterThanOrEqual(prev);
        expect(d).toBeGreaterThanOrEqual(hailLowMm(max) - 1e-9);
        expect(d).toBeLessThanOrEqual(max + 1e-9);
        prev = d;
      }
    }
    report('quantiles at 60 mm', { q10: hailDiameterMm(0.1, 60), q50: hailDiameterMm(0.5, 60), q90: hailDiameterMm(0.9, 60), q99: hailDiameterMm(0.99, 60) });
  });

  it('falls in the core, at the shaft edge beyond the heaviest rain and under the anvil downwind, with none without storms', () => {
    const w = weather();
    const cells = [cell({ intensity: 1 })];
    const out = emptyLocalPrecip();
    const core = { ...localPrecipAt(w, cells, 0, 2743, 0, 0, 300, out) };
    // The anvil lies downwind of the steering wind (from about 275 deg): to the east. Its hail reaches the ground
    // only near the core (HAIL_ANVIL_NEAR_R core radii); farther out it is virga below the anvil's underside.
    let anvil = 0, farLow = 0, farHigh = 0;
    for (let e = 3000; e <= 5000; e += 50) for (let n = -2000; n <= 2000; n += 250) anvil = Math.max(anvil, localPrecipAt(w, cells, 0, 2743, n, e, 300, out).hailMmH);
    for (let e = 6000; e <= 14_000; e += 250) {
      farLow = Math.max(farLow, localPrecipAt(w, cells, 0, 2743, 0, e, 300, out).hailMmH);
      farHigh = Math.max(farHigh, localPrecipAt(w, cells, 0, 2743, 0, e, 8500, out).hailMmH);
    }
    const edge = { ...localPrecipAt(w, cells, 0, 2743, 0, -2200, 300, out) };
    report('hail', { coreMmH: core.hailMmH, coreMaxMm: core.hailMaxMm, edgeMmH: edge.hailMmH, edgeRainMmH: edge.rateMmH, anvilMmH: anvil, farAnvil300m: farLow, farAnvil8500m: farHigh });
    expect(core.hailMmH).toBeGreaterThan(1);
    expect(core.hailMaxMm).toBeGreaterThan(50);
    expect(edge.hailMmH).toBeGreaterThan(0);
    expect(edge.rateMmH).toBeLessThan(core.rateMmH);
    expect(anvil).toBeGreaterThan(0);
    expect(farLow).toBe(0);
    expect(farHigh).toBeGreaterThan(0);
    const none = localPrecipAt(defaultWeather(), [], 0, 2743, 0, 0, 300, out);
    expect(none.hailMmH).toBe(0);
    expect(hailNumberDensity(0, 30)).toBe(0);
  });

  it('reaches the ground under the anvil only near the core: none 5 km from the core at 150 and 900 m, no warning there', () => {
    // The review case: a cell 5 km north of the airport, R 3 km, intensity 0.9, in the default weather.
    const w = { ...defaultWeather(), storms: [cell({ northM: 5000 })] };
    const out = emptyLocalPrecip();
    const cape = 0;
    let outside = 0, band = 0, inBandCount = 0;
    for (const alt of [150, 900]) {
      const x = new HailExposure();
      for (let r = 5000; r <= 10_000; r += 250)
        for (let b = 0; b < 72; b++) {
          const a = (b * Math.PI) / 36;
          const p = localPrecipAt(w, w.storms, 0, cape, 5000 + r * Math.cos(a), r * Math.sin(a), alt, out);
          outside = Math.max(outside, p.hailMmH);
          expect(x.update(p, 50, 0.1).level).toBe('none');
        }
      const airport = localPrecipAt(w, w.storms, 0, cape, 0, 0, alt, out);
      expect(airport.hailMmH).toBe(0);
      expect(new HailExposure().update(airport, 50, 0.1).level).toBe('none');
      for (let r = 3300; r <= 4300; r += 100)
        for (let b = 0; b < 72; b++) {
          const a = (b * Math.PI) / 36;
          const h = localPrecipAt(w, w.storms, 0, cape, 5000 + r * Math.cos(a), r * Math.sin(a), alt, out).hailMmH;
          if (h > 0) inBandCount++;
          band = Math.max(band, h);
        }
    }
    report('anvil hail by distance from the core', { outside5to10kmMmH: outside, band3300to4300mMmH: band, bandPointsWithHail: inBandCount });
    expect(outside).toBe(0);
    expect(band).toBeGreaterThan(0.05);
  });

  it('comes with the Thunderstorm preset: some selected cell has hail somewhere under it', () => {
    const w = applyWeatherPreset(defaultWeather(), weatherPresetById('thunderstorm')!);
    const field = new StormField();
    const cape = field.convective(w).capeJkg;
    const out = emptyLocalPrecip();
    let best = 0, size = 0;
    for (let n = -30_000; n <= 30_000; n += 1000)
      for (let e = -30_000; e <= 30_000; e += 1000) {
        const p = localPrecipAt(w, field.select(w, 0, n, e), 0, cape, n, e, 400, out);
        if (p.hailMmH > best) {
          best = p.hailMmH;
          size = p.hailMaxMm;
        }
      }
    report('thunderstorm preset, 60 km square at 1 km', { cape, bestHailMmH: best, maxMm: size });
    expect(best).toBeGreaterThan(0);
  });
});

describe('curtain noise', () => {
  it('hashes lattice points to [0, 1) the same way each call, and interpolates between them', () => {
    const seen = new Set<number>();
    for (let i = -50; i < 50; i++) {
      const h = rainHash(i, 3 * i - 7, 0x1b873593);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(1);
      expect(rainHash(i, 3 * i - 7, 0x1b873593)).toBe(h);
      seen.add(h);
    }
    expect(seen.size).toBe(100);
    expect(rainValueNoise(1100, 2200, 1100, 7)).toBeCloseTo(rainHash(1, 2, 7), 12);
  });
});
