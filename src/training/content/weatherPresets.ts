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

/**
 * 'Wind 090/7, CAVOK, turbulence light, 09:30' (results, briefing). METAR-like: CAVOK when visibility is
 * at least 10 km and no cloud lies below 5,000 ft (1,524 m); otherwise the visibility and the cloud layer.
 */
export function weatherLine(w: Readonly<WeatherSettings>): string {
  const parts: string[] = [];
  const kt = Math.round(w.windSpeedKt);
  if (kt < 1) parts.push('Wind calm');
  else {
    const dir = (Math.round(w.windDirectionDeg / 10) * 10) % 360;
    const gust = Math.round(w.gustKt);
    parts.push(`Wind ${pad(dir === 0 ? 360 : dir, 3)}/${kt}${gust > kt ? `G${gust}` : ''}`);
  }
  const amount = cloudAmount(w.cloudCover);
  const baseFt = w.cloudBaseM / 0.3048;
  if (w.visibilityM >= 10000 && (amount === null || baseFt >= 5000)) parts.push('CAVOK');
  else {
    // As in a METAR, 10 km or more is not worth a word once there is cloud to report.
    if (w.visibilityM < 10000) parts.push(w.visibilityM >= 5000 ? `visibility ${Math.round(w.visibilityM / 1000)} km` : `visibility ${thousands(w.visibilityM)} m`);
    if (amount) parts.push(`${amount} ${thousands(Math.round(baseFt / 100) * 100)} ft`);
  }
  const turb = turbulenceWord(w.turbulence);
  if (turb) parts.push(`turbulence ${turb}`);
  const minutes = Math.round((((w.timeOfDay % 24) + 24) % 24) * 60) % (24 * 60);
  parts.push(`${pad(Math.floor(minutes / 60), 2)}:${pad(minutes % 60, 2)}`);
  return parts.join(', ');
}
