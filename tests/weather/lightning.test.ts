// The lightning schedule (sim/weather/lightning.ts) is a pure function of the storm cells and the time window:
// splitting a window into smaller ones gives the same strikes, the rate follows the cell's intensity, a cell with
// lightning: false and an empty window give none, and the stroke envelope starts at each stroke and decays.

import { describe, expect, it } from 'vitest';
import type { StormCell } from '../../src/core/types';
import { stormCentreAt } from '../../src/core/weatherFields';
import {
  CG_FRACTION,
  FLASH_PER_MIN,
  STROKE_INTERVAL_S,
  STROKE_TAU_S,
  STROKES_MIN,
  STROKES_SPREAD,
  flashEnd,
  flashEnvelope,
  strikesBetween,
  type Strike,
} from '../../src/sim/weather/lightning';

const cell = (o: Partial<StormCell> = {}): StormCell => ({
  northM: 20_000,
  eastM: -5_000,
  radiusM: 3000,
  topM: 11_000,
  intensity: 1,
  motionDeg: 270,
  motionKt: 15,
  ...o,
});

/** Every strike in [t0, t1), split into windows of `step` s, as plain copies. */
function collect(cells: StormCell[], t0: number, t1: number, step: number): Strike[] {
  const all: Strike[] = [];
  const buf: Strike[] = [];
  for (let t = t0; t < t1; t += step) {
    const n = strikesBetween(cells, t, Math.min(t + step, t1), buf);
    for (let i = 0; i < n; i++) all.push({ ...buf[i] });
  }
  return all;
}

/** Strikes in start-time order (one call lists them by slot, then cell; split windows by start time). */
const byTime = (s: Strike[]): Strike[] => [...s].sort((a, b) => a.tStart - b.tStart || a.id - b.id);

describe('strikesBetween', () => {
  const cells = [cell(), cell({ northM: -8000, intensity: 0.5 })];

  it('gives the same strikes over an hour as 3600 one-second calls and 60 one-minute calls', () => {
    const whole = collect(cells, 0, 3600, 3600);
    expect(whole.length).toBeGreaterThan(100);
    expect(byTime(collect(cells, 0, 3600, 1))).toEqual(byTime(whole));
    expect(byTime(collect(cells, 0, 3600, 60))).toEqual(byTime(whole));
    // Uneven frame-like windows.
    const frames: Strike[] = [];
    const buf: Strike[] = [];
    let t = 0;
    for (let i = 0; t < 3600; i++) {
      const t1 = Math.min(3600, t + 0.004 + 0.03 * ((i * 7919) % 13) / 13);
      const n = strikesBetween(cells, t, t1, buf);
      for (let j = 0; j < n; j++) frames.push({ ...buf[j] });
      t = t1;
    }
    expect(byTime(frames)).toEqual(byTime(whole));
  });

  it('flashes intensity x FLASH_PER_MIN times a minute within 10 % over an hour', () => {
    for (const intensity of [0.5, 1]) {
      const n = collect([cell({ intensity })], 0, 3600, 3600).length;
      const perMin = n / 60;
      console.log(`[lightning] intensity ${intensity}: ${perMin.toFixed(2)} flashes/min (expected ${(intensity * FLASH_PER_MIN).toFixed(2)})`);
      expect(Math.abs(perMin - intensity * FLASH_PER_MIN)).toBeLessThan(0.1 * intensity * FLASH_PER_MIN);
    }
  });

  it('gives none for an empty or reversed window', () => {
    const buf: Strike[] = [];
    expect(strikesBetween(cells, 100, 100, buf)).toBe(0);
    expect(strikesBetween(cells, 200, 100, buf)).toBe(0);
    expect(strikesBetween([], 0, 3600, buf)).toBe(0);
  });

  it('gives none for a cell with lightning: false or intensity 0', () => {
    expect(collect([cell({ lightning: false })], 0, 3600, 3600)).toHaveLength(0);
    expect(collect([cell({ intensity: 0 })], 0, 3600, 3600)).toHaveLength(0);
  });

  it('places each strike in its window, inside the core around the moving centre, with valid fields', () => {
    const c = cell();
    const strikes = collect([c], 0, 3600, 3600);
    const centre = { north: 0, east: 0 };
    let cg = 0;
    const ids = new Set<number>();
    for (const s of strikes) {
      expect(s.tStart).toBeGreaterThanOrEqual(0);
      expect(s.tStart).toBeLessThan(3600);
      stormCentreAt(c, s.tStart, centre);
      expect(Math.hypot(s.north - centre.north, s.east - centre.east)).toBeLessThanOrEqual(c.radiusM + 1e-6);
      expect(s.strokes).toBeGreaterThanOrEqual(STROKES_MIN);
      expect(s.strokes).toBeLessThan(STROKES_MIN + STROKES_SPREAD);
      expect(s.energy).toBeGreaterThanOrEqual(0.5);
      expect(s.energy).toBeLessThanOrEqual(1);
      expect(s.heightFrac).toBeGreaterThanOrEqual(0);
      expect(s.heightFrac).toBeLessThanOrEqual(1);
      if (s.kind === 'cg') cg++;
      ids.add(s.id);
    }
    expect(ids.size).toBe(strikes.length);
    const share = cg / strikes.length;
    console.log(`[lightning] cloud-to-ground share ${share.toFixed(3)} of ${strikes.length}`);
    expect(Math.abs(share - CG_FRACTION)).toBeLessThan(0.1);
  });

  it('changes with the seed', () => {
    const a = collect(cells, 0, 600, 600);
    const buf: Strike[] = [];
    const n = strikesBetween(cells, 0, 600, buf, 2);
    expect(buf.slice(0, n).map((s) => s.tStart)).not.toEqual(a.map((s) => s.tStart));
  });
});

describe('flashEnvelope', () => {
  const s = { tStart: 10, strokes: 3 };

  it('is 0 before the first stroke and 1 at its onset', () => {
    expect(flashEnvelope(s, 9.999)).toBe(0);
    expect(flashEnvelope(s, 10)).toBe(1);
  });

  it('decays with STROKE_TAU_S and adds each stroke at STROKE_INTERVAL_S', () => {
    expect(flashEnvelope(s, 10 + STROKE_TAU_S)).toBeCloseTo(Math.exp(-1), 12);
    const t = 10 + STROKE_INTERVAL_S;
    expect(flashEnvelope(s, t)).toBeCloseTo(1 + Math.exp(-STROKE_INTERVAL_S / STROKE_TAU_S), 12);
    expect(flashEnvelope(s, flashEnd(s))).toBeLessThan(1e-4);
  });
});
