// Free-flight weather presets (the pause menu's Weather chips and the URL's wx=) and the helpers every writer of
// the shell's weather object uses for the optional fields (cloud type, mid-level sheet, precipitation, ground fog,
// storm cells; core/weatherFields.ts). Node-safe (no DOM, no three.js): tests/sim/weatherPresets.test.ts runs it.
//
// Restores and presets: the shell keeps one live WeatherSettings object and writers Object.assign into it. A saved
// copy taken before an optional key was set does not hold that key, so assigning the copy back would leave the key
// set (a lesson's storms surviving the lesson). restoreWeather spreads NEUTRAL_EXTRAS under the copy, and every
// preset here carries NEUTRAL_EXTRAS under its own values, so applying "Fair" after "Thunderstorm" clears the cells.
//
// The training presets (training/content/weatherPresets.ts, lesson weather) are a separate table.

import { DEG, KT, clamp } from '../core/math';
import type { StormCell, WeatherSettings } from '../core/types';
import { MAX_STORMS, NEUTRAL_EXTRAS, NO_STORMS, deriveCloudTop } from '../core/weatherFields';

/** A free-flight preset: `settings` is assigned over the live weather; keys it lacks keep their value. */
export interface WeatherPreset {
  /** URL id (wx=<id>). */
  readonly id: string;
  /** Menu chip label. */
  readonly name: string;
  readonly settings: Readonly<Partial<WeatherSettings>>;
}

// ---------------------------------------------------------------------------------------------- storm cells
// StormCell ranges documented in core/types.ts; the URL and menu clamp to them.
export const CB_RADIUS_MIN_M = 1000;
export const CB_RADIUS_MAX_M = 5000;
export const CB_TOP_MIN_M = 6000;
export const CB_TOP_MAX_M = 14_000;
/**
 * Cell values when the URL's cb= or the menu leaves them out. Unconfirmed: chosen for the presets and the
 * menu, not taken from observations (core radius 3 km, anvil top 11 km MSL, intensity 0.8, stationary).
 */
export const CB_DEFAULT_RADIUS_M = 3000;
export const CB_DEFAULT_TOP_M = 11_000;
export const CB_DEFAULT_INTENSITY = 0.8;

/** A frozen cell with every number finite and clamped to the StormCell ranges (motionDeg wrapped to [0, 360)). */
export function stormCell(c: StormCell): StormCell {
  const cell: StormCell = {
    northM: c.northM,
    eastM: c.eastM,
    radiusM: clamp(c.radiusM, CB_RADIUS_MIN_M, CB_RADIUS_MAX_M),
    topM: clamp(c.topM, CB_TOP_MIN_M, CB_TOP_MAX_M),
    intensity: clamp(c.intensity, 0, 1),
    motionDeg: ((c.motionDeg % 360) + 360) % 360,
    motionKt: Math.max(0, c.motionKt),
  };
  if (c.lightning === false) cell.lightning = false;
  return Object.freeze(cell);
}

const cells = (list: StormCell[]): readonly StormCell[] => Object.freeze(list.slice(0, MAX_STORMS).map(stormCell));

// ---------------------------------------------------------------------------------------------- presets
/**
 * The menu's presets, in chip order. The first five are the menu's original table (src/ui/menu.ts before the
 * optional fields existed), unchanged apart from NEUTRAL_EXTRAS. "Clear & calm" leaves the cloud base and top.
 */
const PRESETS: WeatherPreset[] = [
  { id: 'clear', name: 'Clear & calm', settings: { ...NEUTRAL_EXTRAS, windSpeedKt: 0, gustKt: 0, turbulence: 0.03, cloudCover: 0.05, visibilityM: 80000, cirrusCover: 0 } },
  { id: 'fair', name: 'Fair', settings: { ...NEUTRAL_EXTRAS, windDirectionDeg: 100, windSpeedKt: 8, gustKt: 0, turbulence: 0.15, cloudCover: 0.35, cloudBaseM: 1500, cloudTopM: 2600, visibilityM: 50000, cirrusCover: 0.15 } },
  { id: 'overcast', name: 'Overcast', settings: { ...NEUTRAL_EXTRAS, windDirectionDeg: 230, windSpeedKt: 12, gustKt: 4, turbulence: 0.3, cloudCover: 0.95, cloudBaseM: 700, cloudTopM: 2200, visibilityM: 15000, cirrusCover: 0 } },
  { id: 'gusty', name: 'Gusty crosswind', settings: { ...NEUTRAL_EXTRAS, windDirectionDeg: 160, windSpeedKt: 15, gustKt: 10, turbulence: 0.5, cloudCover: 0.3, cloudBaseM: 1400, cloudTopM: 2400, visibilityM: 40000, cirrusCover: 0.1 } },
  { id: 'lowifr', name: 'Low IFR', settings: { ...NEUTRAL_EXTRAS, windDirectionDeg: 60, windSpeedKt: 5, gustKt: 0, turbulence: 0.2, cloudCover: 1, cloudBaseM: 200, cloudTopM: 1500, visibilityM: 1500, cirrusCover: 0 } },
  // Calm dawn with a 60 m fog layer over the field; 8 km prevailing visibility above it.
  { id: 'fog', name: 'Radiation fog', settings: { ...NEUTRAL_EXTRAS, windSpeedKt: 0, gustKt: 0, turbulence: 0.03, cloudCover: 0, cirrusCover: 0, visibilityM: 8000, fogTopM: 60, fogVisibilityM: 200, timeOfDay: 6.5 } },
  { id: 'drizzle', name: 'Low stratus & drizzle', settings: { ...NEUTRAL_EXTRAS, cloudType: 'stratus', cloudCover: 1, cloudBaseM: 250, cloudTopM: 700, cirrusCover: 0, precipType: 'drizzle', precipRateMmH: 0.5 } },
  { id: 'rain', name: 'Rain', settings: { ...NEUTRAL_EXTRAS, cloudType: 'nimbostratus', cloudCover: 1, cloudBaseM: 600, cloudTopM: 3000, cirrusCover: 0, precipType: 'rain', precipRateMmH: 4, midType: 'altostratus', midCover: 0.9, midAltM: 4500 } },
  { id: 'snow', name: 'Snow', settings: { ...NEUTRAL_EXTRAS, cloudType: 'nimbostratus', cloudCover: 1, cirrusCover: 0, isaDeviation: -20, precipType: 'snow', precipRateMmH: 2, visibilityM: 4000 } },
  // Two cells west of the field (12 km and 25 km), moving from 270 at 15 kt toward it.
  {
    id: 'thunderstorm',
    name: 'Thunderstorm',
    settings: {
      ...NEUTRAL_EXTRAS,
      cloudType: 'towering',
      cloudCover: 0.45,
      cloudBaseM: 1400,
      cloudTopM: 3200,
      storms: cells([
        { northM: 0, eastM: -12_000, radiusM: CB_DEFAULT_RADIUS_M, topM: 11_000, intensity: 0.8, motionDeg: 270, motionKt: 15 },
        { northM: 0, eastM: -25_000, radiusM: CB_DEFAULT_RADIUS_M, topM: 11_000, intensity: 0.5, motionDeg: 270, motionKt: 15 },
      ]),
    },
  },
];
export const WEATHER_PRESETS: readonly WeatherPreset[] = Object.freeze(PRESETS.map((p) => Object.freeze({ ...p, settings: Object.freeze({ ...p.settings }) })));

/** The preset with this URL id, or undefined. */
export function weatherPresetById(id: string | null | undefined): WeatherPreset | undefined {
  return WEATHER_PRESETS.find((p) => p.id === id);
}

/** Apply a preset to the live weather, in place (a base without a top keeps the current layer depth). */
export function applyWeatherPreset(weather: WeatherSettings, preset: WeatherPreset): WeatherSettings {
  const values: Partial<WeatherSettings> = { ...preset.settings };
  deriveCloudTop(values, weather);
  return Object.assign(weather, values);
}

/**
 * Assign a saved weather copy back over the live weather, in place. Optional keys the copy lacks go back to their
 * NEUTRAL_EXTRAS value instead of keeping what was set after the copy was taken.
 */
export function restoreWeather(weather: WeatherSettings, saved: Readonly<Partial<WeatherSettings>>): WeatherSettings {
  return Object.assign(weather, { ...NEUTRAL_EXTRAS, ...saved });
}

/** `w` with every optional field at its NEUTRAL_EXTRAS value (a copy; the base a lesson's weather is built on). */
export function withoutExtras(w: Readonly<WeatherSettings>): WeatherSettings {
  return { ...w, ...NEUTRAL_EXTRAS };
}

// ---------------------------------------------------------------------------------------------- menu storm layouts
export type StormLayout = 'none' | 'distant' | 'overhead' | 'line';

/** Distance of the 'distant' cell and of the 'line' from the aircraft, m, and the spacing along the line. */
export const DISTANT_CELL_M = 20_000;
export const LINE_DISTANCE_M = 15_000;
export const LINE_SPACING_M = 8000;

/**
 * Cells for a menu storm chip, placed relative to the aircraft at `at` (NED m) at simulation time `t` (s). The
 * cells move with the surface wind (from windDirectionDeg at windSpeedKt), a menu choice, not a model of the
 * steering-level wind. 'distant' is one cell DISTANT_CELL_M upwind; 'overhead' one cell centred on the aircraft;
 * 'line' three cells LINE_DISTANCE_M upwind, LINE_SPACING_M apart across the wind. Positions are stored at
 * simTime 0 (core/weatherFields.stormCentreAt), so each is moved back along its track by t.
 */
export function stormLayout(layout: StormLayout, at: { x: number; y: number }, t: number, w: Readonly<WeatherSettings>): readonly StormCell[] {
  if (layout === 'none') return NO_STORMS;
  const from = w.windDirectionDeg * DEG;
  // Unit vector toward where the wind comes from, and the one across it.
  const upN = Math.cos(from);
  const upE = Math.sin(from);
  const travel = Math.max(0, w.windSpeedKt) * KT * t;
  const cell = (alongM: number, acrossM: number): StormCell => ({
    northM: at.x + upN * alongM - upE * acrossM + upN * travel,
    eastM: at.y + upE * alongM + upN * acrossM + upE * travel,
    radiusM: CB_DEFAULT_RADIUS_M,
    topM: CB_DEFAULT_TOP_M,
    intensity: CB_DEFAULT_INTENSITY,
    motionDeg: w.windDirectionDeg,
    motionKt: Math.max(0, w.windSpeedKt),
  });
  if (layout === 'distant') return cells([cell(DISTANT_CELL_M, 0)]);
  if (layout === 'overhead') return cells([cell(0, 0)]);
  return cells([cell(LINE_DISTANCE_M, -LINE_SPACING_M), cell(LINE_DISTANCE_M, 0), cell(LINE_DISTANCE_M, LINE_SPACING_M)]);
}
