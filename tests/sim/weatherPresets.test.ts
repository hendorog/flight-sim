// Free-flight weather presets and the restore helpers (src/sim/weatherPresets.ts): every preset clears the
// optional fields it does not set, saved copies restored with restoreWeather do not leave a lesson's or preset's
// fields behind, the lesson weather is built without the player's fields and with the derived storm cells off, and
// explicit storm cells keep their place across a clock reset. The pause menu's new weather section is checked on the stand-in DOM (tests/ui/fakeDom.ts).

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { defaultWeather, defaultControls, type WeatherSettings } from '../../src/core/types';
import { NEUTRAL_EXTRAS, NO_STORMS, WEATHER_EXTRA_KEYS, stormCentreAt, stormsOf } from '../../src/core/weatherFields';
import {
  CB_DEFAULT_RADIUS_M,
  WEATHER_PRESETS,
  applyWeatherPreset,
  reanchorStorms,
  restoreWeather,
  stormCell,
  weatherPresetById,
  withoutExtras,
} from '../../src/sim/weatherPresets';
import { convectiveState, emptyConvectiveState, proceduralStorms } from '../../src/physics/weather/stormField';
import { buildWeather } from '../../src/training/content/weatherPresets';
import { mulberry32 } from '../../src/physics/weather/random';
import { applyEraWeather } from '../../src/sim/eraChoice';
import type { SimContext } from '../../src/core/context';
import { makeMockEnvironment, makeMockState } from '../../src/core/mockState';
import C172S_DEFINITION from '../../src/aircraft/c172s/index';
import { PauseMenu, type MenuHost } from '../../src/ui/menu';
import { SimPhysics } from '../../src/sim/SimPhysics';
import { FakeElement, installFakeDom } from '../ui/fakeDom';

const preset = (id: string) => weatherPresetById(id)!;
/** Two explicit cells west of the field, moving from 270 at 15 kt (the Thunderstorm preset's before it was derived). */
const TWO_CELLS = Object.freeze([
  stormCell({ northM: 0, eastM: -12_000, radiusM: CB_DEFAULT_RADIUS_M, topM: 11_000, intensity: 0.8, motionDeg: 270, motionKt: 15 }),
  stormCell({ northM: 0, eastM: -25_000, radiusM: CB_DEFAULT_RADIUS_M, topM: 11_000, intensity: 0.5, motionDeg: 270, motionKt: 15 }),
]);
/** A weather preset with explicit cells (for the clock tests). */
const CELLS_PRESET = { id: 'cells', name: 'Cells', settings: { ...NEUTRAL_EXTRAS, storms: TWO_CELLS } };

describe('free-flight weather presets', () => {
  it('keeps the five original menu presets with their values', () => {
    expect(WEATHER_PRESETS.slice(0, 5).map((p) => p.name)).toEqual(['Clear & calm', 'Fair', 'Overcast', 'Gusty crosswind', 'Low IFR']);
    // The literals of c0f8711:src/ui/menu.ts:127-131.
    const old: Record<string, Partial<WeatherSettings>> = {
      clear: { windSpeedKt: 0, gustKt: 0, turbulence: 0.03, cloudCover: 0.05, visibilityM: 80000, cirrusCover: 0 },
      fair: { windDirectionDeg: 100, windSpeedKt: 8, gustKt: 0, turbulence: 0.15, cloudCover: 0.35, cloudBaseM: 1500, cloudTopM: 2600, visibilityM: 50000, cirrusCover: 0.15 },
      overcast: { windDirectionDeg: 230, windSpeedKt: 12, gustKt: 4, turbulence: 0.3, cloudCover: 0.95, cloudBaseM: 700, cloudTopM: 2200, visibilityM: 15000, cirrusCover: 0 },
      gusty: { windDirectionDeg: 160, windSpeedKt: 15, gustKt: 10, turbulence: 0.5, cloudCover: 0.3, cloudBaseM: 1400, cloudTopM: 2400, visibilityM: 40000, cirrusCover: 0.1 },
      lowifr: { windDirectionDeg: 60, windSpeedKt: 5, gustKt: 0, turbulence: 0.2, cloudCover: 1, cloudBaseM: 200, cloudTopM: 1500, visibilityM: 1500, cirrusCover: 0 },
    };
    for (const [id, v] of Object.entries(old)) expect(preset(id).settings).toEqual({ ...NEUTRAL_EXTRAS, ...v });
    expect('cloudBaseM' in preset('clear').settings).toBe(false);
  });

  it('gives every preset a unique id and every optional key', () => {
    expect(new Set(WEATHER_PRESETS.map((p) => p.id)).size).toBe(WEATHER_PRESETS.length);
    for (const p of WEATHER_PRESETS) for (const k of WEATHER_EXTRA_KEYS) expect(k in p.settings, `${p.id}.${k}`).toBe(true);
  });

  it('holds the new presets with the planned values', () => {
    expect(preset('fog').settings).toMatchObject({ windSpeedKt: 0, cloudCover: 0, fogTopM: 60, fogVisibilityM: 200, visibilityM: 8000, timeOfDay: 6.5 });
    expect(preset('drizzle').settings).toMatchObject({ cloudType: 'stratus', cloudBaseM: 250, cloudTopM: 700, cloudCover: 1, precipType: 'drizzle', precipRateMmH: 0.5 });
    expect(preset('rain').settings).toMatchObject({ cloudType: 'nimbostratus', cloudBaseM: 600, cloudTopM: 3000, cloudCover: 1, precipType: 'rain', precipRateMmH: 4, midType: 'altostratus', midCover: 0.9, midAltM: 4500 });
    expect(preset('snow').settings).toMatchObject({ cloudType: 'nimbostratus', isaDeviation: -20, precipType: 'snow', precipRateMmH: 2, visibilityM: 4000 });
    const ts = preset('thunderstorm').settings;
    expect(ts).toMatchObject({ cloudType: 'towering', cloudCover: 0.3, cloudBaseM: 900, cloudTopM: 2600, isaDeviation: 8, timeOfDay: 15, dayOfYear: 196 });
    // No explicit cells: they are derived from the conditions, which give activity 1.
    expect(ts.storms).toBeUndefined();
    expect(convectiveState({ ...defaultWeather(), ...ts }, emptyConvectiveState()).activity).toBe(1);
  });

  it('presets are frozen', () => {
    expect(Object.isFrozen(preset('rain').settings)).toBe(true);
    expect(Object.isFrozen(preset('thunderstorm').settings)).toBe(true);
  });

  it('every preset leaves the storm cells to the conditions, and only "Thunderstorm" gives activity above 0', () => {
    for (const p of WEATHER_PRESETS) {
      const w = applyWeatherPreset(defaultWeather(), p);
      expect(proceduralStorms(w), p.id).toBe(true);
      expect(convectiveState(w, emptyConvectiveState()).activity > 0, p.id).toBe(p.id === 'thunderstorm');
    }
  });

  it('applying "Fair" after explicit cells clears the cells and the type', () => {
    const w = defaultWeather();
    applyWeatherPreset(w, CELLS_PRESET);
    w.cloudType = 'towering';
    expect(stormsOf(w)).toHaveLength(2);
    applyWeatherPreset(w, preset('fair'));
    expect(stormsOf(w)).toHaveLength(0);
    expect(proceduralStorms(w)).toBe(true);
    expect(w).toMatchObject(NEUTRAL_EXTRAS);
    expect(w).toMatchObject({ cloudBaseM: 1500, cloudTopM: 2600 });
  });

  it('"Clear & calm" keeps the cloud base and top', () => {
    const w = { ...defaultWeather(), cloudBaseM: 900, cloudTopM: 1700 };
    applyWeatherPreset(w, preset('clear'));
    expect([w.cloudBaseM, w.cloudTopM]).toEqual([900, 1700]);
  });
});

describe('restoring saved weather', () => {
  it('a saved copy without the optional keys clears them', () => {
    const w = defaultWeather();
    const saved = { ...w };
    Object.assign(w, preset('thunderstorm').settings, { fogTopM: 80, storms: TWO_CELLS });
    restoreWeather(w, saved);
    expect(w).toEqual({ ...saved, ...NEUTRAL_EXTRAS });
  });

  it('a saved copy with the keys restores them', () => {
    const w = defaultWeather();
    applyWeatherPreset(w, preset('rain'));
    const saved = { ...w };
    applyWeatherPreset(w, preset('fair'));
    restoreWeather(w, saved);
    expect(w).toEqual(saved);
  });

  it('a lesson flies without the player fields, and the end of the lesson clears the fields it set', () => {
    // Mirrors src/training/TrainingSystem.ts (applyWeather and the lesson-end block that restores playerWeather)
    // rather than calling it: playerWeather is a copy, the lesson weather is built on withoutExtras(playerWeather),
    // and the end restores playerWeather. A change there needs a change here.
    const live: WeatherSettings = { ...defaultWeather(), fogTopM: 50 };
    const player = { ...live };
    const lesson = buildWeather({ preset: 'light', override: { storms: TWO_CELLS } }, withoutExtras(player), mulberry32(7));
    restoreWeather(live, lesson);
    expect(live.fogTopM).toBe(0);
    expect(stormsOf(live)).toHaveLength(2);
    restoreWeather(live, player);
    expect(live.fogTopM).toBe(50);
    expect(stormsOf(live)).toHaveLength(0);
    expect(live.storms).toBeUndefined();
    expect(proceduralStorms(live)).toBe(true);
    // Without an override the lesson weather has the derived cells off.
    const plain = buildWeather({ preset: 'light' }, withoutExtras({ ...live, ...preset('thunderstorm').settings }), mulberry32(7));
    expect(plain.storms).toBe(NO_STORMS);
    expect(proceduralStorms(plain)).toBe(false);
  });

  it('withoutExtras does not change the seeded lesson sampling', () => {
    const base = defaultWeather();
    const a = buildWeather({ preset: 'light' }, base, mulberry32(3));
    const b = buildWeather({ preset: 'light' }, withoutExtras({ ...base, precipType: 'rain', precipRateMmH: 4 }), mulberry32(3));
    expect(b).toEqual({ ...a, ...NEUTRAL_EXTRAS, storms: NO_STORMS });
  });

  it('the era preset path keeps the layer depth through deriveCloudTop', () => {
    const w = applyEraWeather({ ...defaultWeather(), cloudBaseM: 1500, cloudTopM: 2600 }, { cloudBaseM: 2600 });
    expect([w.cloudBaseM, w.cloudTopM]).toEqual([2600, 3700]);
  });
});

describe('presets applied after simulation time 0', () => {
  it('puts explicit cells where the preset places them at the time of applying', () => {
    const centre = { north: 0, east: 0 };
    for (const t of [0, 1800]) {
      const w = applyWeatherPreset(defaultWeather(), CELLS_PRESET, t);
      const [a, b] = stormsOf(w);
      stormCentreAt(a, t, centre);
      expect(centre.north).toBeCloseTo(0, 6);
      expect(centre.east).toBeCloseTo(-12_000, 6);
      stormCentreAt(b, t, centre);
      expect(centre.east).toBeCloseTo(-25_000, 6);
      expect(Object.isFrozen(a)).toBe(true);
    }
    // The preset table itself keeps its time-0 positions.
    expect(CELLS_PRESET.settings.storms[0].eastM).toBe(-12_000);
  });

  it('leaves a preset without cells unchanged by the time', () => {
    expect(applyWeatherPreset(defaultWeather(), preset('fair'), 1800)).toEqual(applyWeatherPreset(defaultWeather(), preset('fair')));
  });
});

describe('storm cells across a clock reset', () => {
  const centres = (w: WeatherSettings, t: number): number[][] =>
    stormsOf(w).map((c) => {
      const p = stormCentreAt(c, t, { north: 0, east: 0 });
      return [p.north, p.east];
    });

  it('reanchorStorms keeps every cell where it is from one clock reading to another', () => {
    const w = applyWeatherPreset(defaultWeather(), CELLS_PRESET, 600);
    const before = centres(w, 600);
    reanchorStorms(w, 600, 0);
    const after = centres(w, 0);
    for (let i = 0; i < before.length; i++) {
      expect(after[i][0]).toBeCloseTo(before[i][0], 6);
      expect(after[i][1]).toBeCloseTo(before[i][1], 6);
    }
    expect(after[0][1]).toBeCloseTo(-12_000, 6);
    expect(Object.isFrozen(w.storms![0])).toBe(true);
  });

  it('reanchorStorms leaves a weather without cells, or an unchanged clock, as it is', () => {
    const w = defaultWeather();
    reanchorStorms(w, 600, 0);
    expect('storms' in w).toBe(false);
    const t = applyWeatherPreset(defaultWeather(), CELLS_PRESET, 600);
    const list = t.storms;
    reanchorStorms(t, 600, 600);
    expect(t.storms).toBe(list);
  });

  it('a scenario reset (SimPhysics.reset, the clock back to 0) keeps the cells where they were', () => {
    const w = defaultWeather();
    const p = new SimPhysics({ weather: w });
    p.reset('cruise', w);
    p.step(30);
    const t = p.time;
    expect(t).toBeGreaterThan(29);
    applyWeatherPreset(w, CELLS_PRESET, t);
    const before = centres(w, t);
    p.reset('cruise', w);
    expect(p.time).toBe(0);
    const after = centres(w, 0);
    for (let i = 0; i < before.length; i++) {
      expect(after[i][0]).toBeCloseTo(before[i][0], 6);
      expect(after[i][1]).toBeCloseTo(before[i][1], 6);
    }
  });
});

describe('pause menu: the weather page sections for the optional fields', () => {
  beforeAll(installFakeDom);
  afterAll(() => vi.unstubAllGlobals());

  function build(weather: WeatherSettings): FakeElement {
    const ctx = {
      era: 'present',
      state: makeMockState({ heightAGL: 0, tas: 0 }),
      env: makeMockEnvironment(),
      controls: defaultControls(C172S_DEFINITION),
      weather,
      simTime: 0,
      timeScale: 1,
      cameraMode: 'chase',
      quality: 'high',
      commands: {},
    } as unknown as SimContext;
    const host = { ctx, close() {}, toast() {}, weatherEdited() {}, hudEnabled: true, fpsVisible: false, autopilot: null, showHints() {}, school: null } as unknown as MenuHost;
    const parent = new FakeElement('div');
    new PauseMenu(parent as unknown as HTMLElement, [], host).open('weather');
    return parent;
  }

  const all = (root: FakeElement, tag: string): FakeElement[] => {
    const out: FakeElement[] = [];
    const walk = (e: FakeElement): void => {
      if (e.tagName === tag) out.push(e);
      e.children.forEach(walk);
    };
    walk(root);
    return out;
  };

  it('has the new heading, the preset chips and the field controls, selected from the weather', () => {
    const root = build({ ...defaultWeather(), ...preset('rain').settings });
    expect(all(root, 'h3').map((h) => h.textContent)).toContain('Precipitation, fog and storms');
    const buttons = all(root, 'button');
    const names = buttons.map((b) => b.textContent);
    for (const p of WEATHER_PRESETS) expect(names).toContain(p.name);
    for (const n of ['Nimbostratus', 'Altostratus', 'Rain', 'From conditions', 'No storms']) expect(names).toContain(n);
    for (const n of ['Distant cell', 'Overhead cell', 'Line of three']) expect(names).not.toContain(n);
    const sel = buttons.filter((b) => b.classList.contains('sel')).map((b) => b.textContent);
    expect(sel).toEqual(expect.arrayContaining(['Nimbostratus', 'Altostratus', 'Rain', 'From conditions']));
    const labels = all(root, 'label').map((l) => l.textContent);
    for (const l of ['Mid-level cloud', 'Mid-level altitude', 'Precipitation rate', 'Ground fog depth', 'Fog visibility']) expect(labels).toContain(l);
    const outputs = all(root, 'output').map((o) => o.textContent);
    expect(outputs).toContain('4 mm/h');
  });

  it('shows the defaults when the fields are absent', () => {
    const root = build(defaultWeather());
    const sel = all(root, 'button').filter((b) => b.classList.contains('sel')).map((b) => b.textContent);
    expect(sel).toEqual(expect.arrayContaining(['Auto', 'Altostratus', 'No precipitation', 'From conditions']));
    expect(all(root, 'p').map((e) => e.textContent)).toContain('Convective activity from these conditions: 0 %');
    const rows = all(root, 'div').filter((d) => d.className === 'row');
    const value = (label: string) => rows.find((r) => r.children[0].textContent === label)!.children[2].textContent;
    expect(value('Precipitation rate')).toBe('none');
    expect(value('Ground fog depth')).toBe('none');
    expect(value('Fog visibility')).toBe('200 m');
    expect(value('Mid-level cloud')).toBe('none');
  });
});
