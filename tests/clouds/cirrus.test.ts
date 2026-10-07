// Cirrus is independent weather (not tied to the cumulus cover), and its deck drifts along the upper wind
// with a wrap period that every cirrus texture tiles with, so the wrap never shows.
import { describe, expect, it } from 'vitest';
import { defaultWeather, type WeatherSettings } from '../../src/core/types';
import { cirrusCover, DEFAULT_CIRRUS_COVER } from '../../src/render/clouds/CloudsEffect';
import { CloudModel } from '../../src/render/clouds/cloudModel';
import type { SimContext } from '../../src/core/context';

const withCirrus = (c: unknown): WeatherSettings => ({ ...defaultWeather(), cirrusCover: c }) as WeatherSettings;

describe('cirrusCover', () => {
  it('defaults to a thin cover when the weather does not set one, whatever the cumulus cover', () => {
    for (const cloudCover of [0, 0.35, 1]) {
      expect(cirrusCover({ ...defaultWeather(), cloudCover })).toBe(DEFAULT_CIRRUS_COVER);
    }
    expect(DEFAULT_CIRRUS_COVER).toBeLessThanOrEqual(0.2);
  });
  it('uses and clamps an explicit cirrusCover', () => {
    expect(cirrusCover(withCirrus(0))).toBe(0);
    expect(cirrusCover(withCirrus(0.6))).toBe(0.6);
    expect(cirrusCover(withCirrus(3))).toBe(1);
    expect(cirrusCover(withCirrus(-1))).toBe(0);
    expect(cirrusCover(withCirrus(NaN))).toBe(DEFAULT_CIRRUS_COVER);
    expect(cirrusCover(withCirrus('0.5'))).toBe(DEFAULT_CIRRUS_COVER);
  });
});

describe('CloudModel cirrus drift', () => {
  const ctxFor = (windDirectionDeg: number, windSpeedKt: number): SimContext =>
    ({ weather: { ...defaultWeather(), windDirectionDeg, windSpeedKt }, simTime: 0 }) as unknown as SimContext;

  it('aligns the fibre axis with the direction the wind blows toward (three.js x = east, z = south)', () => {
    const m = new CloudModel();
    m.update(ctxFor(270, 20), 0.1); // from the west: blows toward the east (+x)
    expect(m.cirrusAxis.x).toBeCloseTo(1, 6);
    expect(m.cirrusAxis.y).toBeCloseTo(0, 6);
    m.update(ctxFor(0, 20), 0.1); // from the north: blows toward the south (+z)
    expect(m.cirrusAxis.x).toBeCloseTo(0, 6);
    expect(m.cirrusAxis.y).toBeCloseTo(1, 6);
  });

  it('drifts only along the axis, wrapped to [0, 30 km)', () => {
    const m = new CloudModel();
    for (let i = 0; i < 2000; i++) m.update(ctxFor(270, 30), 1);
    expect(m.cirrusOffset.y).toBe(0);
    expect(m.cirrusOffset.x).toBeGreaterThanOrEqual(0);
    expect(m.cirrusOffset.x).toBeLessThan(30_000);
    const before = m.cirrusOffset.x;
    m.update(ctxFor(270, 30), 1);
    // Sampling at (q + offset) with offset = -displacement moves the pattern downwind: the offset decreases.
    const step = (before - m.cirrusOffset.x + 30_000) % 30_000;
    expect(step).toBeGreaterThan(0);
    expect(step).toBeLessThan(200);
  });
});
