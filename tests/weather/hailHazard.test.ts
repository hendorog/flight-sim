// Hail as a hazard (sim/weather/hailExposure.ts, the weather line's GR / GS groups, the airframe sound, the HUD and
// toast cues, the aircraft sample): no hail without storms, warning levels at their thresholds, the dose, and the
// groups at the airport. Each test logs its measured numbers.

import { describe, expect, it, vi } from 'vitest';
import { defaultWeather, type StormCell, type WeatherSettings } from '../../src/core/types';
import { hailNoise, HAIL_FULL_MMH, precipNoise, RAIN_FULL_IAS, SoundTracker } from '../../src/audio/mapping';
import { P } from '../../src/audio/params';
import { makeMockEnvironment, makeMockState } from '../../src/core/mockState';
import { defaultControls } from '../../src/core/types';
import { stormCentreAt } from '../../src/core/weatherFields';
import { createEnvironment, type TerrainProvider } from '../../src/physics/environment';
import { emptyLocalPrecip, localPrecipAt, type LocalPrecip } from '../../src/physics/weather/stormPrecip';
import { applyWeatherPreset, weatherPresetById } from '../../src/sim/weatherPresets';
import { AircraftWeather } from '../../src/sim/weather/aircraftWeather';
import {
  HAIL_MODERATE_DOSE_JM2,
  HAIL_MODERATE_FLUX_WM2,
  HAIL_MODERATE_STONE_J,
  HAIL_SEVERE_DOSE_JM2,
  HAIL_SEVERE_FLUX_WM2,
  HAIL_SEVERE_STONE_J,
  HAIL_WARN_MMH,
  HailExposure,
  hailLevel,
} from '../../src/sim/weather/hailExposure';
import { hailAtField, weatherLine } from '../../src/training/content/weatherPresets';
import { hailCue, hailToast } from '../../src/ui/hudCues';
import type { SimContext } from '../../src/core/context';

const report = (label: string, values: Record<string, number | string>) =>
  console.log(`[hail] ${label}: ${Object.entries(values).map(([k, v]) => `${k}=${typeof v === 'number' ? +v.toPrecision(4) : v}`).join('  ')}`);

const hail = (rate: number, max: number): LocalPrecip => ({ ...emptyLocalPrecip(), type: 'rain', rateMmH: 30, stormRainMmH: 30, hailMmH: rate, hailMaxMm: max });
const cell = (over: Partial<StormCell> = {}): StormCell => ({ northM: 0, eastM: 0, radiusM: 3000, topM: 11_000, intensity: 1, motionDeg: 0, motionKt: 0, ...over });

describe('hail warning levels', () => {
  it('are none below the warning rate, then light, moderate and severe at the stone, flux and dose thresholds', () => {
    expect(hailLevel(0, 100, 1e6, 1e6)).toBe('none');
    expect(hailLevel(0.5 * HAIL_WARN_MMH, 100, 1e6, 1e6)).toBe('none');
    expect(hailLevel(HAIL_WARN_MMH, 0, 0, 0)).toBe('light');
    expect(hailLevel(1, HAIL_MODERATE_STONE_J * 0.999, 0, 0)).toBe('light');
    expect(hailLevel(1, HAIL_MODERATE_STONE_J, 0, 0)).toBe('moderate');
    expect(hailLevel(1, 0, HAIL_MODERATE_FLUX_WM2, 0)).toBe('moderate');
    expect(hailLevel(1, 0, 0, HAIL_MODERATE_DOSE_JM2)).toBe('moderate');
    expect(hailLevel(1, HAIL_SEVERE_STONE_J, 0, 0)).toBe('severe');
    expect(hailLevel(1, 0, HAIL_SEVERE_FLUX_WM2, 0)).toBe('severe');
    expect(hailLevel(1, 0, 0, HAIL_SEVERE_DOSE_JM2)).toBe('severe');
  });

  it('rise with the stone size and the airspeed, and the dose accumulates while in hail and is kept after it', () => {
    const x = new HailExposure();
    const small = { ...x.update(hail(2, 8), 50, 0) };
    const large = { ...x.update(hail(2, 40), 50, 0) };
    const fast = { ...x.update(hail(2, 40), 80, 0) };
    report('stone energy', { small8mmJ: small.stoneJ, large40mmJ: large.stoneJ, large80msJ: fast.stoneJ, flux40mm: large.fluxWm2 });
    expect(small.level).toBe('light');
    expect(large.stoneJ).toBeGreaterThan(small.stoneJ);
    expect(fast.stoneJ).toBeGreaterThan(large.stoneJ);
    expect(large.level).toBe('severe');
    const y = new HailExposure();
    let t = 0;
    while (y.state.level !== 'moderate' && t < 3600) {
      y.update(hail(5, 9), 50, 1);
      t++;
    }
    report('time to moderate by dose at 5 mm/h of 9 mm stones, 50 m/s', { s: t, doseJm2: y.state.doseJm2, flux: y.state.fluxWm2 });
    expect(y.state.level).toBe('moderate');
    const dose = y.state.doseJm2;
    y.update(emptyLocalPrecip(), 50, 1);
    expect(y.state.level).toBe('none');
    expect(y.state.doseJm2).toBe(dose);
    y.reset();
    expect(y.state.doseJm2).toBe(0);
  });

  it('give a HUD chip and a toast only when the level rises', () => {
    expect(hailCue('none')).toBeNull();
    expect(hailCue(undefined)).toBeNull();
    expect(hailCue('light')).toEqual({ text: 'HAIL LIGHT', level: 'warn' });
    expect(hailCue('severe')).toEqual({ text: 'HAIL SEVERE', level: 'alert' });
    expect(hailToast('none', 'light')).toBe('Hail: light');
    expect(hailToast('light', 'severe')).toBe('Hail: severe');
    expect(hailToast('severe', 'moderate')).toBeNull();
    expect(hailToast('none', 'none')).toBeNull();
  });
});

describe('hail at the aircraft', () => {
  const ctxFor = (w: WeatherSettings, north: number, alt: number): SimContext => {
    const state = makeMockState();
    state.position = { x: north, y: 0, z: -alt };
    state.altitudeMSL = alt;
    state.tas = 50;
    return { weather: w, state, simTime: 0, weatherFx: { flash: { x: 0, y: 0, z: 0, energy: 0 } } } as unknown as SimContext;
  };

  it('publishes no hail and the stratiform precipitation in the default weather', () => {
    const ctx = ctxFor(defaultWeather(), 0, 600);
    new AircraftWeather().update(0.016, ctx);
    expect(ctx.weatherFx!.precip).toEqual(emptyLocalPrecip());
    expect(ctx.weatherFx!.hail!.level).toBe('none');
    expect(ctx.weatherFx!.hail!.doseJm2).toBe(0);
  });

  it('publishes hail under an explicit cell and a warning', () => {
    const w = { ...defaultWeather(), cloudBaseM: 900, storms: [cell()] };
    const ctx = ctxFor(w, 0, 400);
    const a = new AircraftWeather();
    a.update(0.016, ctx);
    report('under an explicit cell', { hailMmH: ctx.weatherFx!.precip!.hailMmH, maxMm: ctx.weatherFx!.precip!.hailMaxMm, level: ctx.weatherFx!.hail!.level });
    expect(ctx.weatherFx!.precip!.hailMmH).toBeGreaterThan(0);
    expect(ctx.weatherFx!.hail!.level).not.toBe('none');
  });
});

describe('hail at the aircraft with the wind field', () => {
  it('reads the cells of the wind field at the aircraft (the selection the convective wind reads)', () => {
    const w = applyWeatherPreset(defaultWeather(), weatherPresetById('thunderstorm')!);
    const env = createEnvironment({ weather: w, terrain: { height: () => 0, normal: () => ({ x: 0, y: 0, z: -1 }), surface: () => 'grass' } as unknown as TerrainProvider });
    const state = makeMockState();
    const a = new AircraftWeather();
    const out = emptyLocalPrecip();
    const select = vi.spyOn(env.windField.stormField, 'select');
    let withHail = 0;
    // Toward the centre of the nearest cell with rain, and 4 km past it.
    const near = env.windField.stormCells(0, 0, 0).filter((c) => c.rain > 0.5).map((c) => stormCentreAt(c, 0, { north: 0, east: 0 }));
    near.sort((p, q) => Math.hypot(p.north, p.east) - Math.hypot(q.north, q.east));
    const goal = near[0];
    const len = Math.hypot(goal.north, goal.east);
    for (let k = 0; k < 200; k++) {
      const f = ((len + 4000) * k) / 199 / len;
      const north = goal.north * f, east = goal.east * f;
      state.position = { x: north, y: east, z: -400 };
      state.altitudeMSL = 400;
      const ctx = { weather: w, state, simTime: k, env, weatherFx: { flash: { x: 0, y: 0, z: 0, energy: 0 } } } as unknown as SimContext;
      const before = select.mock.calls.length;
      a.update(0.1, ctx);
      expect(select.mock.calls.length).toBe(before + 1);
      const cells = env.windField.stormCells(north, east, k);
      const field = env.windField.stormField;
      localPrecipAt(w, cells, k, cells.length > 0 ? field.convective(w).capeJkg : 0, north, east, 400, out);
      expect(ctx.weatherFx!.precip).toEqual(out);
      if (out.hailMmH > 0) withHail++;
    }
    report('aircraft sample against the wind field cells, 200 points', { cellKm: len / 1000, withHail });
    expect(withHail).toBeGreaterThan(0);
    select.mockRestore();
  });
});

describe('hail sound', () => {
  it('is 0 without hail and grows with the rate, the stone size and the airspeed', () => {
    expect(hailNoise(0, 30, 50)).toBe(0);
    expect(hailNoise(3, 0, 50)).toBe(0);
    expect(hailNoise(HAIL_FULL_MMH, 50, RAIN_FULL_IAS)).toBeCloseTo(1, 12);
    expect(hailNoise(2, 10, 40)).toBeLessThan(hailNoise(4, 10, 40));
    expect(hailNoise(2, 10, 40)).toBeLessThan(hailNoise(2, 30, 40));
    expect(hailNoise(2, 10, 20)).toBeLessThan(hailNoise(2, 10, 40));
  });

  it('leaves the parameter block of the default weather as it was: hail and hailSize 0, the rain from the stratiform fields', () => {
    const s = makeMockState();
    const env = makeMockEnvironment();
    const a = new SoundTracker().update(s, defaultControls(), env, defaultWeather(), 0.016);
    const b = new SoundTracker().update(s, defaultControls(), env, defaultWeather(), 0.016, emptyLocalPrecip());
    expect(Array.from(b)).toEqual(Array.from(a));
    expect(a[P.hail]).toBe(0);
    expect(a[P.hailSize]).toBe(0);
    const c = new SoundTracker().update(s, defaultControls(), env, defaultWeather(), 0.016, hail(3, 20));
    expect(c[P.hail]).toBeGreaterThan(0);
    expect(c[P.hailSize]).toBe(20);
    expect(c[P.rain]).toBe(precipNoise('rain', 30, s.ias));
  });
});

describe('weather line hail groups', () => {
  it('reports no GR or GS in the default weather, the lesson weather or without hail at the airport', () => {
    expect(weatherLine(defaultWeather())).not.toMatch(/GR|GS/);
    expect(weatherLine({ ...defaultWeather(), storms: [] })).not.toMatch(/GR|GS/);
    expect(weatherLine({ ...defaultWeather(), storms: [cell({ northM: 40_000 })] })).not.toMatch(/GR|GS/);
    expect(hailAtField({ ...defaultWeather(), storms: [] }).rateMmH).toBe(0);
  });

  it('reports GR for hail of 5 mm and larger over the airport and GS for small hail', () => {
    const big = { ...defaultWeather(), cloudBaseM: 900, storms: [cell()] };
    const h = hailAtField(big);
    const line = weatherLine(big);
    report('cell over the airport', { rateMmH: h.rateMmH, maxMm: h.maxMm, line });
    expect(line).toMatch(/\bGR\b/);
    expect(line).not.toMatch(/\bGS\b/);
    // A weak cell: the field's updraft at intensity 0.2 holds stones of under 5 mm.
    const small = { ...defaultWeather(), cloudBaseM: 900, storms: [cell({ intensity: 0.32 })] };
    const s = hailAtField(small);
    report('weak cell over the airport', { rateMmH: s.rateMmH, maxMm: s.maxMm, line: weatherLine(small) });
    expect(s.maxMm).toBeLessThan(5);
    if (s.rateMmH >= 0.05) expect(weatherLine(small)).toMatch(/\bGS\b/);
  });
});
