// The optional weather fields' accessors (core/weatherFields.ts): defaults when a field is absent or malformed,
// clamping, the visibility identity without precipitation, storm motion and the snapshot sanitiser.

import { describe, expect, it } from 'vitest';
import { KT } from '../../src/core/math';
import { defaultWeather, type StormCell, type WeatherSettings } from '../../src/core/types';
import {
  CLOUD_TYPE_PROFILES,
  NEUTRAL_EXTRAS,
  NO_STORMS,
  WEATHER_EXTRA_KEYS,
  cloudTypeOf,
  deriveCloudTop,
  effectiveVisibilityM,
  fogOf,
  midLayerOf,
  precipExtinctionPerM,
  precipOf,
  sanitizeExtras,
  stormCentreAt,
  stormsOf,
  type FogLayer,
  type MidLayer,
  type Precip,
} from '../../src/core/weatherFields';

/** defaultWeather() with arbitrary (possibly ill-typed) extra keys, as a snapshot or URL could deliver them. */
const withFields = (extra: Record<string, unknown>): WeatherSettings => ({ ...defaultWeather(), ...extra }) as WeatherSettings;

const cell = (o: Partial<StormCell> = {}): StormCell => ({
  northM: 1000,
  eastM: -12_000,
  radiusM: 3000,
  topM: 11_000,
  intensity: 0.8,
  motionDeg: 270,
  motionKt: 15,
  ...o,
});

const mid = (): MidLayer => ({ cover: -1, type: 'altocumulus', altM: -1 });
const precip = (): Precip => ({ type: 'snow', rateMmH: -1 });
const fog = (): FogLayer => ({ topM: -1, visibilityM: -1 });

/** Values a malformed field may hold; each must read as absent. */
const BAD = [undefined, null, Number.NaN, Number.POSITIVE_INFINITY, '3', 'unknown', {}, [], true];

describe('weatherFields accessors with the fields absent', () => {
  const w = defaultWeather();

  it('return the documented defaults', () => {
    expect(cloudTypeOf(w)).toBe('auto');
    expect(midLayerOf(w, mid())).toEqual({ cover: 0, type: 'altostratus', altM: Math.max(4500, w.cloudTopM + 1000) });
    expect(precipOf(w, precip())).toEqual({ type: 'none', rateMmH: 0 });
    expect(fogOf(w, fog())).toEqual({ topM: 0, visibilityM: 200 });
    expect(stormsOf(w)).toBe(NO_STORMS);
    expect(Object.isFrozen(NO_STORMS)).toBe(true);
  });

  it('effectiveVisibilityM returns visibilityM itself without precipitation', () => {
    for (const vis of [50, 799.123, 8000, 60_000, 0.1 + 0.2]) {
      const x = { ...w, visibilityM: vis };
      expect(effectiveVisibilityM(x)).toBe(vis);
      expect(effectiveVisibilityM({ ...x, precipType: 'rain', precipRateMmH: 0 } as WeatherSettings)).toBe(vis);
      expect(effectiveVisibilityM({ ...x, precipType: 'none', precipRateMmH: 10 } as WeatherSettings)).toBe(vis);
    }
  });

  it('write into the caller-supplied objects', () => {
    const m = mid();
    const p = precip();
    const f = fog();
    expect(midLayerOf(w, m)).toBe(m);
    expect(precipOf(w, p)).toBe(p);
    expect(fogOf(w, f)).toBe(f);
  });
});

describe('weatherFields accessors with malformed fields', () => {
  it('treat NaN, non-numbers and unknown strings as absent', () => {
    for (const v of BAD) {
      const w = withFields({
        cloudType: v,
        midCover: v,
        midType: v,
        midAltM: v,
        precipType: v,
        precipRateMmH: v,
        fogTopM: v,
        fogVisibilityM: v,
        storms: v,
      });
      expect(cloudTypeOf(w)).toBe('auto');
      expect(midLayerOf(w, mid())).toEqual({ cover: 0, type: 'altostratus', altM: 4500 });
      expect(precipOf(w, precip())).toEqual({ type: 'none', rateMmH: 0 });
      expect(fogOf(w, fog())).toEqual({ topM: 0, visibilityM: 200 });
      expect(stormsOf(w)).toBe(Array.isArray(v) ? v : NO_STORMS);
      expect(effectiveVisibilityM(w)).toBe(w.visibilityM);
    }
  });

  it('a non-finite rate with a valid type reads as rate 0', () => {
    expect(precipOf(withFields({ precipType: 'rain', precipRateMmH: Number.NaN }), precip())).toEqual({ type: 'rain', rateMmH: 0 });
  });

  it('a storm list with one malformed cell reads as no storms', () => {
    expect(stormsOf(withFields({ storms: [cell(), { ...cell(), radiusM: 'big' }] }))).toBe(NO_STORMS);
    expect(stormsOf(withFields({ storms: [cell(), null] }))).toBe(NO_STORMS);
    expect(stormsOf(withFields({ storms: [{ ...cell(), lightning: 'yes' }] }))).toBe(NO_STORMS);
    const ok = [cell(), cell({ lightning: false })];
    expect(stormsOf(withFields({ storms: ok }))).toBe(ok);
  });
});

describe('weatherFields clamping', () => {
  it('clamps out-of-range values to the documented ranges', () => {
    expect(midLayerOf(withFields({ midCover: 3, midAltM: -50 }), mid())).toEqual({ cover: 1, type: 'altostratus', altM: 0 });
    expect(midLayerOf(withFields({ midCover: -0.5, midType: 'altocumulus', midAltM: 99_000 }), mid())).toEqual({ cover: 0, type: 'altocumulus', altM: 15_000 });
    expect(precipOf(withFields({ precipType: 'rain', precipRateMmH: 80 }), precip())).toEqual({ type: 'rain', rateMmH: 50 });
    expect(precipOf(withFields({ precipType: 'snow', precipRateMmH: -4 }), precip())).toEqual({ type: 'snow', rateMmH: 0 });
    expect(fogOf(withFields({ fogTopM: 900, fogVisibilityM: 5 }), fog())).toEqual({ topM: 300, visibilityM: 50 });
    expect(fogOf(withFields({ fogTopM: -10, fogVisibilityM: 4000 }), fog())).toEqual({ topM: 0, visibilityM: 1000 });
  });

  it('the mid sheet altitude default follows the cloud top', () => {
    expect(midLayerOf(withFields({ cloudTopM: 2600 }), mid()).altM).toBe(4500);
    expect(midLayerOf(withFields({ cloudTopM: 5200 }), mid()).altM).toBe(6200);
  });

  it('accepts every cloud type in the profile table', () => {
    for (const t of Object.keys(CLOUD_TYPE_PROFILES)) expect(cloudTypeOf(withFields({ cloudType: t }))).toBe(t);
    expect(CLOUD_TYPE_PROFILES.auto).toEqual({ deckOverride: 0, deckWeight: 0, extinctionScale: 1, shapeFreqScale: 1, towerExt: 1.6 });
  });
});

describe('precipitation extinction and effective visibility', () => {
  it('is 0 for none or rate 0 and grows with the rate', () => {
    expect(precipExtinctionPerM('none', 10)).toBe(0);
    expect(precipExtinctionPerM('rain', 0)).toBe(0);
    for (const t of ['rain', 'drizzle', 'snow'] as const) {
      expect(precipExtinctionPerM(t, 1)).toBeGreaterThan(0);
      expect(precipExtinctionPerM(t, 10)).toBeGreaterThan(precipExtinctionPerM(t, 1));
    }
    // The fit's coefficient at R = 1 mm/h, 1/km -> 1/m.
    expect(precipExtinctionPerM('rain', 1)).toBeCloseTo(0.25e-3, 12);
  });

  it('lowers the visibility by adding the extinction to the haze', () => {
    const w = withFields({ visibilityM: 10_000, precipType: 'rain', precipRateMmH: 4 });
    const k = precipExtinctionPerM('rain', 4);
    expect(effectiveVisibilityM(w)).toBeCloseTo(3.912 / (3.912 / 10_000 + k), 9);
    expect(effectiveVisibilityM(w)).toBeLessThan(10_000);
  });
});

describe('stormCentreAt', () => {
  it('a cell from 270 deg at 15 kt is at its position at t = 0 and 15 kt x 1 h east of it at t = 3600 s', () => {
    const c = cell();
    const out = { north: Number.NaN, east: Number.NaN };
    expect(stormCentreAt(c, 0, out)).toBe(out);
    expect(out.north).toBe(c.northM);
    expect(out.east).toBe(c.eastM);
    stormCentreAt(c, 3600, out);
    expect(out.north).toBeCloseTo(c.northM, 6);
    expect(out.east).toBeCloseTo(c.eastM + 15 * KT * 3600, 6);
  });
});

describe('deriveCloudTop', () => {
  it('keeps the current layer depth when only the base moves', () => {
    const cur = defaultWeather();
    const p: Partial<WeatherSettings> = { cloudBaseM: 800 };
    deriveCloudTop(p, cur);
    expect(p.cloudTopM).toBe(800 + (cur.cloudTopM - cur.cloudBaseM));
    const q: Partial<WeatherSettings> = { cloudBaseM: 800, cloudTopM: 1200 };
    deriveCloudTop(q, cur);
    expect(q.cloudTopM).toBe(1200);
    const r: Partial<WeatherSettings> = { visibilityM: 5000 };
    deriveCloudTop(r, cur);
    expect('cloudTopM' in r).toBe(false);
  });
});

describe('NEUTRAL_EXTRAS and sanitizeExtras', () => {
  it('NEUTRAL_EXTRAS holds exactly the optional keys, each reading as absent', () => {
    const keys = ['cloudType', 'midCover', 'midType', 'midAltM', 'precipType', 'precipRateMmH', 'fogTopM', 'fogVisibilityM', 'storms'];
    expect(Object.keys(NEUTRAL_EXTRAS)).toEqual(keys);
    expect([...WEATHER_EXTRA_KEYS]).toEqual(keys);
    expect(Object.isFrozen(NEUTRAL_EXTRAS)).toBe(true);
    const w = { ...defaultWeather(), ...NEUTRAL_EXTRAS };
    expect(cloudTypeOf(w)).toBe('auto');
    expect(midLayerOf(w, mid()).cover).toBe(0);
    expect(precipOf(w, precip()).rateMmH).toBe(0);
    expect(fogOf(w, fog()).topM).toBe(0);
    expect(stormsOf(w)).toBe(NO_STORMS);
    expect(effectiveVisibilityM(w)).toBe(w.visibilityM);
  });

  it('spreading NEUTRAL_EXTRAS under a saved copy clears keys the copy lacks', () => {
    const live = withFields({ storms: [cell()], fogTopM: 60 });
    const saved = defaultWeather();
    Object.assign(live, { ...NEUTRAL_EXTRAS, ...saved });
    expect(stormsOf(live)).toBe(NO_STORMS);
    expect(fogOf(live, fog()).topM).toBe(0);
  });

  it('drops a malformed storms value and keeps the well-formed fields', () => {
    const w: Record<string, unknown> = { ...defaultWeather(), storms: [cell(), { northM: 'x' }], fogTopM: 60, cloudType: 'cumulus' };
    sanitizeExtras(w);
    expect('storms' in w).toBe(false);
    expect(w.fogTopM).toBe(60);
    expect(w.cloudType).toBe('cumulus');
    expect(w.visibilityM).toBe(defaultWeather().visibilityM);
  });

  it('drops every ill-typed key and keeps values of the right type unclamped', () => {
    const w: Record<string, unknown> = {
      cloudType: 'cirrus',
      midCover: '0.5',
      midType: 7,
      midAltM: Number.NaN,
      precipType: 'hail',
      precipRateMmH: null,
      fogTopM: 400,
      fogVisibilityM: Number.POSITIVE_INFINITY,
      storms: 'none',
    };
    sanitizeExtras(w);
    expect(w).toEqual({ fogTopM: 400 });
    const ok: Record<string, unknown> = { storms: [cell()] };
    sanitizeExtras(ok);
    expect(ok.storms).toEqual([cell()]);
    const empty: Record<string, unknown> = {};
    sanitizeExtras(empty);
    expect(empty).toEqual({});
  });
});
