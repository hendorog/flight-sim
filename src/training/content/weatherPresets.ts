// Weather presets (section 2.8) and the seeded sampling of a WeatherSpec into WeatherSettings.
//
// A lesson names a preset; the preset fixes everything that makes the lesson repeatable (time of day,
// pressure, temperature, cloud, visibility, turbulence) and gives sampling ranges for the wind. Ranges are
// sampled with the run's seeded Rng (seed = hash(lessonId, attempt), made by the runner), so a retry of the
// same attempt flies the same weather and the next attempt a slightly different one.
//
// Winds: every preset keeps the wind within 040-160 degrees so runway 07 is always into wind (the autoflight's
// approach and the circuit geometry assume 07). Wind directions are degrees true FROM, as WeatherSettings.

import type { WeatherSettings } from '../../core/types';
import { fogOf, precipOf, stormsOf, type FogLayer, type Precip } from '../../core/weatherFields';
import { StormField, proceduralStorms } from '../../physics/weather/stormField';
import { AIRPORT } from '../../core/world';
import { HAIL_GR_MM } from '../../physics/weather/hail';
import { emptyLocalPrecip, localPrecipAt } from '../../physics/weather/stormPrecip';
import type { Rng, WeatherPresetId, WeatherSpec } from '../types';

/** Each preset is a partial override of the player's weather plus default sampling ranges. */
export interface WeatherPreset {
  id: WeatherPresetId;
  /** Human line for the briefing ('Light winds, scattered cloud'). */
  label: string;
  settings: Partial<WeatherSettings>;
  ranges?: Pick<WeatherSpec, 'windDirDeg' | 'windKt' | 'gustKt' | 'turbulence'>;
}

/** Repeatable daytime conditions shared by the day presets (09:30 is the existing free-flight default). */
const DAY: Partial<WeatherSettings> = {
  timeOfDay: 9.5, qnhHpa: 1013.25, isaDeviation: 0, gustKt: 0,
  visibilityM: 40000, cloudBaseM: 1500, cloudTopM: 2600, cirrusCover: 0.1,
};

export const WEATHER_PRESETS: Readonly<Record<WeatherPresetId, WeatherPreset>> = {
  calm: {
    id: 'calm', label: 'Calm, few clouds',
    settings: { ...DAY, turbulence: 0.03, cloudCover: 0.2 },
    ranges: { windDirDeg: [40, 160], windKt: [0, 3] },
  },
  smooth: {
    id: 'smooth', label: 'Light wind, smooth air',
    settings: { ...DAY, turbulence: 0.05, cloudCover: 0.25 },
    ranges: { windDirDeg: [60, 120], windKt: [5, 5] },
  },
  light: {
    id: 'light', label: 'Light winds, scattered cloud',
    settings: { ...DAY, turbulence: 0.1, cloudCover: 0.35 },
    ranges: { windDirDeg: [70, 110], windKt: [5, 9] },
  },
  xwind10: {
    id: 'xwind10', label: 'Crosswind from the right, 10 knots, gusting 14',
    settings: { ...DAY, turbulence: 0.15, cloudCover: 0.35, windDirectionDeg: 160, windSpeedKt: 10, gustKt: 14 },
  },
  xwind15: {
    id: 'xwind15', label: 'Crosswind from the right, 13 knots, gusting 17',
    settings: { ...DAY, turbulence: 0.2, cloudCover: 0.4, windDirectionDeg: 160, windSpeedKt: 13, gustKt: 17 },
  },
  gusty: {
    id: 'gusty', label: 'Wind down the runway, 12 knots, gusting 20',
    settings: { ...DAY, turbulence: 0.25, cloudCover: 0.45, windDirectionDeg: 90, windSpeedKt: 12, gustKt: 20 },
  },
  hazy: {
    id: 'hazy', label: 'Haze, visibility 6 km',
    settings: { ...DAY, turbulence: 0.08, cloudCover: 0.15, visibilityM: 6000 },
    ranges: { windDirDeg: [60, 120], windKt: [3, 7] },
  },
  night: {
    id: 'night', label: 'Night, calm and clear',
    settings: { ...DAY, timeOfDay: 21.5, turbulence: 0.03, cloudCover: 0, cirrusCover: 0 },
    ranges: { windDirDeg: [40, 160], windKt: [0, 3] },
  },
  imc: {
    id: 'imc', label: 'Overcast 2,000 ft, visibility 1,500 m',
    settings: { ...DAY, turbulence: 0.12, cloudCover: 1, cloudBaseM: 600, cloudTopM: 1800, visibilityM: 1500 },
    ranges: { windDirDeg: [60, 120], windKt: [5, 10] },
  },
};

/** Uniform sample in [lo, hi] (inclusive ends are fine for weather). */
const sample = (r: [number, number], rng: Rng): number => r[0] + (r[1] - r[0]) * rng();

/**
 * A direction range, clockwise from r[0] to r[1] (so [340, 20] spans north). Returned in [0, 360).
 */
const sampleDir = (r: [number, number], rng: Rng): number => {
  const span = (((r[1] - r[0]) % 360) + 360) % 360;
  return (((r[0] + span * rng()) % 360) + 360) % 360;
};

/** Round to a tenth: the sampled values are displayed and logged, and noise beyond that is meaningless. */
const tenth = (x: number): number => Math.round(x * 10) / 10;

/** The weather a lesson flies in: `base` (the player's weather) with the preset, ranges and overrides applied. */
export function buildWeather(spec: WeatherSpec, base: Readonly<WeatherSettings>, rng: Rng): WeatherSettings {
  const preset = WEATHER_PRESETS[spec.preset];
  if (!preset) throw new Error(`unknown weather preset '${spec.preset}'`);
  const w: WeatherSettings = { ...base, ...preset.settings };
  // The lesson's own ranges win over the preset's. Samples are drawn in a fixed order (direction, speed,
  // gust, turbulence) whether or not a range exists, so adding one range to a lesson does not reshuffle the
  // others' values for the same seed.
  const pick = <K extends 'windDirDeg' | 'windKt' | 'gustKt' | 'turbulence'>(k: K): [number, number] | undefined =>
    spec[k] ?? preset.ranges?.[k];
  const dirR = pick('windDirDeg');
  const ktR = pick('windKt');
  const gustR = pick('gustKt');
  const turbR = pick('turbulence');
  const u = [rng(), rng(), rng(), rng()];
  const draw = (k: number): Rng => () => u[k];
  if (dirR) w.windDirectionDeg = Math.round(sampleDir(dirR, draw(0)));
  if (ktR) w.windSpeedKt = tenth(sample(ktR, draw(1)));
  if (gustR) w.gustKt = tenth(sample(gustR, draw(2)));
  if (turbR) w.turbulence = Math.round(sample(turbR, draw(3)) * 100) / 100;
  // A gust value is the peak speed; never below the mean wind (a sampled mean can exceed a fixed gust).
  if (w.gustKt > 0 && w.gustKt < w.windSpeedKt) w.gustKt = w.windSpeedKt;
  if (spec.override) Object.assign(w, spec.override);
  return w;
}

const pad = (n: number, width: number): string => String(n).padStart(width, '0');
const thousands = (n: number): string => Math.round(n).toLocaleString('en-US');

/** Cloud amount in METAR terms from the 0..1 cover. */
function cloudAmount(cover: number): 'FEW' | 'SCT' | 'BKN' | 'OVC' | null {
  if (cover < 0.1) return null;
  if (cover < 0.3) return 'FEW';
  if (cover < 0.55) return 'SCT';
  if (cover < 0.9) return 'BKN';
  return 'OVC';
}

function turbulenceWord(t: number): string | null {
  if (t < 0.08) return null;
  if (t < 0.2) return 'light';
  if (t < 0.45) return 'moderate';
  return 'severe';
}

const _precip: Precip = { type: 'none', rateMmH: 0 };
const _fog: FogLayer = { topM: 0, visibilityM: 0 };
const _storms = new StormField();

/** Distance from the airport within which a derived cell with lightning gives TS, m (10 NM). */
export const TS_RANGE_M = 18_520;
/** Core or anvil share from which a derived cell counts for CB and TS. */
const CB_SHARE_MIN = 0.1;

/**
 * Thunderstorm (TS) and cumulonimbus (CB) at the airport (NED origin). Explicit cells: TS when a cell has
 * lightning, CB when there is a cell, wherever they are. Derived cells (stormField.ts, selected at the airport, so
 * within FADE_END_M 60 km): CB when a selected cell's core or anvil share is at least CB_SHARE_MIN; TS when such a
 * cell lies within TS_RANGE_M and has a lightning share above 0.
 */
function stormsAtField(w: Readonly<WeatherSettings>): { ts: boolean; cb: boolean } {
  if (!proceduralStorms(w)) {
    const cells = stormsOf(w);
    return { ts: cells.some((c) => c.lightning !== false), cb: cells.length > 0 };
  }
  let ts = false;
  let cb = false;
  for (const c of _storms.select(w, 0, 0, 0)) {
    if (Math.max(c.core, c.anvil) < CB_SHARE_MIN) continue;
    cb = true;
    if (c.flash > 0 && Math.hypot(c.northM, c.eastM) <= TS_RANGE_M) ts = true;
  }
  return { ts, cb };
}

/** Distance from the airport within which hail counts as at the airport, m (the four points of hailAtField). */
export const HAIL_NEAR_M = 3000;
/** Hail rate from which GR or GS is reported, mm/h. */
export const HAIL_REPORT_MMH = 0.05;

const _local = emptyLocalPrecip();

/**
 * The storm cells' hail at the airport (physics/weather/stormPrecip.ts localPrecipAt at simulation time 0, 2 m above
 * the field elevation, at the NED origin and at HAIL_NEAR_M north, east, south and west of it): the largest rate and
 * the largest stone where it is largest. Explicit cells as listed; derived cells selected at the airport. 0 without
 * cells.
 */
export function hailAtField(w: Readonly<WeatherSettings>): { rateMmH: number; maxMm: number } {
  const ww = w as WeatherSettings;
  const cells = proceduralStorms(ww) ? _storms.select(ww, 0, 0, 0) : stormsOf(ww);
  let rate = 0, max = 0;
  if (cells.length === 0) return { rateMmH: 0, maxMm: 0 };
  const cape = _storms.convective(ww).capeJkg;
  for (const [n, e] of [[0, 0], [HAIL_NEAR_M, 0], [0, HAIL_NEAR_M], [-HAIL_NEAR_M, 0], [0, -HAIL_NEAR_M]]) {
    const p = localPrecipAt(ww, cells, 0, cape, n, e, AIRPORT.elevation + 2, _local);
    if (p.hailMmH > rate) {
      rate = p.hailMmH;
      max = p.hailMaxMm;
    }
  }
  return { rateMmH: rate, maxMm: max };
}

/**
 * Present-weather groups of the optional fields (core/weatherFields.ts), in METAR order: TS (stormsAtField), then the precipitation (DZ; -RA / RA / +RA below 2.5 / 10 mm/h / above; -SN / SN / +SN below 1 /
 * 2.5 mm/h / above), then GR (hail, the largest stone HAIL_GR_MM or more) or GS (small hail) when the storm cells'
 * hail at the airport (hailAtField) reaches HAIL_REPORT_MMH, then FG for a ground fog layer. Empty when the fields
 * are absent.
 */
function presentWeather(w: Readonly<WeatherSettings>, ts: boolean): string[] {
  const groups: string[] = [];
  if (ts) groups.push('TS');
  const p = precipOf(w, _precip);
  if (p.rateMmH > 0) {
    if (p.type === 'drizzle') groups.push('DZ');
    else if (p.type === 'rain') groups.push(p.rateMmH < 2.5 ? '-RA' : p.rateMmH < 10 ? 'RA' : '+RA');
    else if (p.type === 'snow') groups.push(p.rateMmH < 1 ? '-SN' : p.rateMmH < 2.5 ? 'SN' : '+SN');
  }
  const hail = hailAtField(w);
  if (hail.rateMmH >= HAIL_REPORT_MMH) groups.push(hail.maxMm >= HAIL_GR_MM ? 'GR' : 'GS');
  if (fogOf(w, _fog).topM > 0) groups.push('FG');
  return groups;
}

/**
 * 'Wind 090/7, CAVOK, turbulence light, 09:30' (results, briefing). METAR-like: CAVOK when visibility is
 * at least 10 km, no cloud lies below 5,000 ft (1,524 m) and there is no present weather and no storm cell;
 * otherwise the visibility, the present-weather groups and the cloud layer (CB after it, stormsAtField,
 * FEW at the base when the cover alone reports no cloud).
 */
export function weatherLine(w: Readonly<WeatherSettings>): string {
  const parts: string[] = [];
  const storms = stormsAtField(w);
  const wx = presentWeather(w, storms.ts);
  const cb = storms.cb;
  const kt = Math.round(w.windSpeedKt);
  if (kt < 1) parts.push('Wind calm');
  else {
    const dir = (Math.round(w.windDirectionDeg / 10) * 10) % 360;
    const gust = Math.round(w.gustKt);
    parts.push(`Wind ${pad(dir === 0 ? 360 : dir, 3)}/${kt}${gust > kt ? `G${gust}` : ''}`);
  }
  const amount = cb ? cloudAmount(w.cloudCover) ?? 'FEW' : cloudAmount(w.cloudCover);
  const baseFt = w.cloudBaseM / 0.3048;
  if (w.visibilityM >= 10000 && (amount === null || baseFt >= 5000) && wx.length === 0 && !cb) parts.push('CAVOK');
  else {
    // As in a METAR, 10 km or more is not worth a word once there is cloud to report.
    if (w.visibilityM < 10000) parts.push(w.visibilityM >= 5000 ? `visibility ${Math.round(w.visibilityM / 1000)} km` : `visibility ${thousands(w.visibilityM)} m`);
    parts.push(...wx);
    if (amount) parts.push(`${amount} ${thousands(Math.round(baseFt / 100) * 100)} ft${cb ? ' CB' : ''}`);
  }
  const turb = turbulenceWord(w.turbulence);
  if (turb) parts.push(`turbulence ${turb}`);
  const minutes = Math.round((((w.timeOfDay % 24) + 24) % 24) * 60) % (24 * 60);
  parts.push(`${pad(Math.floor(minutes / 60), 2)}:${pad(minutes % 60, 2)}`);
  return parts.join(', ');
}
