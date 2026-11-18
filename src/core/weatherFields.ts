// Accessors for the optional weather fields of WeatherSettings (cloud type, mid-level sheet, precipitation, ground
// fog, cumulonimbus cells, winds aloft, mountain-wave gain). Node-safe (no three.js): physics, render, audio, UI and the snapshot validation all read
// the fields through this module, so each one is clamped and defaulted in one place.
//
// Every accessor treats an absent field, a non-finite number, a value of the wrong type and an unknown enum string
// as absent, clamps numbers to the documented range, and allocates nothing (the `out` objects are the caller's).
// With every optional field absent, each accessor returns its default and effectiveVisibilityM returns
// w.visibilityM itself, so code that reads the fields through them computes what it did before they existed.
// See docs/weather.md for the field and accessor tables.

import { DEG, KT, clamp } from './math';
import type { CloudType, MidCloudType, PrecipType, StormCell, WeatherSettings, WindAloftLevel } from './types';

// ---------------------------------------------------------------------------------------------- ranges and defaults
/** Mid-level sheet altitude when midAltM is absent: max(MID_ALT_MIN_DEFAULT_M, cloudTopM + MID_ABOVE_TOP_M), m MSL. */
export const MID_ALT_MIN_DEFAULT_M = 4500;
export const MID_ABOVE_TOP_M = 1000;
/** Upper bound of midAltM, m MSL (a range check on the input, not a meteorological limit). */
export const MID_ALT_MAX_M = 15_000;
/** Precipitation rate range, mm/h liquid-water equivalent. */
export const PRECIP_RATE_MAX_MMH = 50;
/** Ground fog depth above the field elevation, m. */
export const FOG_TOP_MAX_M = 300;
/** Visibility inside the fog layer, m: range and the value when fogVisibilityM is absent. */
export const FOG_VIS_MIN_M = 50;
export const FOG_VIS_MAX_M = 1000;
export const FOG_VIS_DEFAULT_M = 200;
/** Most storm cells the consumers read (the first entries of `storms`). */
export const MAX_STORMS = 6;
/** Wind-aloft table limits: entries, altitude range ft MSL, speed kt, temperature deg C. */
export const MAX_ALOFT_LEVELS = 12;
export const ALOFT_ALT_MIN_FT = 1000;
export const ALOFT_ALT_MAX_FT = 60_000;
export const ALOFT_KT_MAX = 250;
export const ALOFT_TEMP_MIN_C = -90;
export const ALOFT_TEMP_MAX_C = 50;
/** Koschmieder constant: visibility = KOSCHMIEDER / extinction for a 2 % contrast threshold (as Simulator.ts and render/sky/params.ts use). */
const KOSCHMIEDER = 3.912;

const CLOUD_TYPES: readonly CloudType[] = ['auto', 'stratus', 'stratocumulus', 'cumulus', 'towering', 'nimbostratus'];
const MID_TYPES: readonly MidCloudType[] = ['altostratus', 'altocumulus'];
const PRECIP_TYPES: readonly PrecipType[] = ['none', 'drizzle', 'rain', 'snow'];

/** The optional weather keys this module owns, in declaration order (types.ts). */
export const WEATHER_EXTRA_KEYS = [
  'cloudType',
  'midCover',
  'midType',
  'midAltM',
  'precipType',
  'precipRateMmH',
  'fogTopM',
  'fogVisibilityM',
  'storms',
  'windsAloft',
  'mountainWaves',
] as const;
export type WeatherExtraKey = typeof WEATHER_EXTRA_KEYS[number];

/** The empty storm list stormsOf returns when `storms` is absent or malformed. */
export const NO_STORMS: readonly StormCell[] = Object.freeze([]);

/**
 * Every optional field at its absent value. Restore sites spread it under a saved weather copy
 * (`{ ...NEUTRAL_EXTRAS, ...saved }`) so a key the copy lacks does not stay set from a lesson or preset.
 * midAltM is the fixed MID_ALT_MIN_DEFAULT_M, not the cloud-top rule: with midCover 0 no sheet is drawn.
 * storms is undefined, which reads as absent: the cells are derived from the conditions
 * (physics/weather/stormField.ts). An empty array instead means no cells at all. windsAloft is undefined too: the
 * winds aloft are derived (physics/weather/windsAloft.ts); an empty array would mean no shear above the boundary
 * layer. mountainWaves is 1, the value absent reads as.
 */
export const NEUTRAL_EXTRAS: Readonly<
  Required<Pick<WeatherSettings, Exclude<WeatherExtraKey, 'storms' | 'windsAloft'>>> & { storms: undefined; windsAloft: undefined }
> = Object.freeze({
  cloudType: 'auto',
  midCover: 0,
  midType: 'altostratus',
  midAltM: MID_ALT_MIN_DEFAULT_M,
  precipType: 'none',
  precipRateMmH: 0,
  fogTopM: 0,
  fogVisibilityM: FOG_VIS_DEFAULT_M,
  storms: undefined,
  windsAloft: undefined,
  mountainWaves: 1,
});

// ---------------------------------------------------------------------------------------------- cloud type profiles
/** Uniform inputs of one low-layer cloud type (render/clouds cloudModel). */
export interface CloudTypeProfile {
  /** Deck shape the type forces: 0 = cumulus cells, 1 = stratiform deck (mixed in by deckWeight). */
  readonly deckOverride: number;
  /** 0 = cover-driven deck shape (today's mapping), 1 = deckOverride. */
  readonly deckWeight: number;
  /** Multiplier on the cloud extinction coefficient. */
  readonly extinctionScale: number;
  /** Multiplier on the shape-noise frequency. */
  readonly shapeFreqScale: number;
  /** Layer top = base + (cloudTopM - base) * towerExt; 'auto' is render/clouds TOWER_EXTENSION (1.6). */
  readonly towerExt: number;
}

/**
 * Per-type profiles. Unconfirmed: the extinction, frequency and top values are tuning values to be set on
 * dev/clouds.html, not measured; 'auto' reproduces the uniforms the clouds module sets without a type.
 */
export const CLOUD_TYPE_PROFILES: Readonly<Record<CloudType, CloudTypeProfile>> = Object.freeze({
  auto: { deckOverride: 0, deckWeight: 0, extinctionScale: 1, shapeFreqScale: 1, towerExt: 1.6 },
  stratus: { deckOverride: 1, deckWeight: 1, extinctionScale: 0.6, shapeFreqScale: 0.15, towerExt: 1.0 },
  stratocumulus: { deckOverride: 1, deckWeight: 1, extinctionScale: 1, shapeFreqScale: 1, towerExt: 1.2 },
  cumulus: { deckOverride: 0, deckWeight: 1, extinctionScale: 1, shapeFreqScale: 1, towerExt: 1.6 },
  towering: { deckOverride: 0, deckWeight: 1, extinctionScale: 1.2, shapeFreqScale: 1, towerExt: 2.5 },
  nimbostratus: { deckOverride: 1, deckWeight: 1, extinctionScale: 2.0, shapeFreqScale: 0.3, towerExt: 1.0 },
});

// ---------------------------------------------------------------------------------------------- precipitation optics
/**
 * Extinction of precipitation, 1/km, as a power law in the rate R (mm/h): k = a * R^b. Unconfirmed: these fits
 * need a checked source before one is cited here; rain 0.25 R^0.63, drizzle 1.5 R^0.5, snow 1.3 S^0.8 (S the
 * liquid-water-equivalent rate).
 */
const PRECIP_EXTINCTION_FIT: Readonly<Record<Exclude<PrecipType, 'none'>, readonly [a: number, b: number]>> = {
  rain: [0.25, 0.63],
  drizzle: [1.5, 0.5],
  snow: [1.3, 0.8],
};

/** Extinction coefficient of falling precipitation, 1/m; 0 for 'none' or a rate of 0 (PRECIP_EXTINCTION_FIT). */
export function precipExtinctionPerM(type: PrecipType, rateMmH: number): number {
  if (type === 'none' || !(rateMmH > 0)) return 0;
  const fit = PRECIP_EXTINCTION_FIT[type];
  if (!fit) return 0;
  return (fit[0] * Math.pow(rateMmH, fit[1])) / 1000;
}

/**
 * The rate (mm/h) whose extinction (PRECIP_EXTINCTION_FIT) is kPerM (1/m): the inverse of precipExtinctionPerM;
 * 0 for 'none' or kPerM 0.
 */
export function precipRateForExtinction(type: PrecipType, kPerM: number): number {
  if (type === 'none' || !(kPerM > 0)) return 0;
  const fit = PRECIP_EXTINCTION_FIT[type];
  if (!fit) return 0;
  return Math.pow((kPerM * 1000) / fit[0], 1 / fit[1]);
}

// ---------------------------------------------------------------------------------------------- accessors
export interface MidLayer {
  /** 0..1; 0 = no sheet. */
  cover: number;
  type: MidCloudType;
  /** m MSL. */
  altM: number;
}

export interface Precip {
  type: PrecipType;
  /** mm/h, 0..PRECIP_RATE_MAX_MMH; 0 whenever type is 'none'. */
  rateMmH: number;
}

export interface FogLayer {
  /** Depth above AIRPORT.elevation, m, 0..FOG_TOP_MAX_M; 0 = no fog. */
  topM: number;
  /** Visibility inside the fog, m, FOG_VIS_MIN_M..FOG_VIS_MAX_M. */
  visibilityM: number;
}

/** A horizontal NED position, m. */
export interface NorthEast {
  north: number;
  east: number;
}

type Loose = Partial<Record<WeatherExtraKey, unknown>>;

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === 'string' && list.includes(v as T);

/** The low layer's type; 'auto' when absent or unknown. */
export function cloudTypeOf(w: WeatherSettings): CloudType {
  const t = (w as Loose).cloudType;
  return oneOf(CLOUD_TYPES, t) ? t : 'auto';
}

/** The mid-level sheet, written into `out`: cover 0 when absent. */
export function midLayerOf(w: WeatherSettings, out: MidLayer): MidLayer {
  const x = w as Loose;
  out.cover = finite(x.midCover) ? clamp(x.midCover, 0, 1) : 0;
  out.type = oneOf(MID_TYPES, x.midType) ? x.midType : 'altostratus';
  out.altM = finite(x.midAltM) ? clamp(x.midAltM, 0, MID_ALT_MAX_M) : Math.max(MID_ALT_MIN_DEFAULT_M, w.cloudTopM + MID_ABOVE_TOP_M);
  return out;
}

/** The stratiform precipitation, written into `out`: type 'none' and rate 0 when absent. */
export function precipOf(w: WeatherSettings, out: Precip): Precip {
  const x = w as Loose;
  out.type = oneOf(PRECIP_TYPES, x.precipType) ? x.precipType : 'none';
  out.rateMmH = out.type !== 'none' && finite(x.precipRateMmH) ? clamp(x.precipRateMmH, 0, PRECIP_RATE_MAX_MMH) : 0;
  return out;
}

/** The ground fog layer, written into `out`: topM 0 when absent, visibilityM FOG_VIS_DEFAULT_M. */
export function fogOf(w: WeatherSettings, out: FogLayer): FogLayer {
  const x = w as Loose;
  out.topM = finite(x.fogTopM) ? clamp(x.fogTopM, 0, FOG_TOP_MAX_M) : 0;
  out.visibilityM = finite(x.fogVisibilityM) ? clamp(x.fogVisibilityM, FOG_VIS_MIN_M, FOG_VIS_MAX_M) : FOG_VIS_DEFAULT_M;
  return out;
}

/** True when `c` has every StormCell field with the right type (numbers finite). */
export function isStormCell(c: unknown): c is StormCell {
  if (typeof c !== 'object' || c === null) return false;
  const s = c as Record<string, unknown>;
  return (
    finite(s.northM) &&
    finite(s.eastM) &&
    finite(s.radiusM) &&
    finite(s.topM) &&
    finite(s.intensity) &&
    finite(s.motionDeg) &&
    finite(s.motionKt) &&
    (s.lightning === undefined || typeof s.lightning === 'boolean')
  );
}

/**
 * The explicit storm cells: w.storms when it is an array whose entries are all well-formed cells, else NO_STORMS.
 * Consumers read at most the first MAX_STORMS entries. The cells are returned as stored (not clamped). With
 * `storms` absent the consumers use the cells derived from the conditions instead (physics/weather/stormField.ts
 * StormField.select); this accessor returns NO_STORMS for that case too.
 */
export function stormsOf(w: WeatherSettings): readonly StormCell[] {
  const s = (w as Loose).storms;
  if (!Array.isArray(s)) return NO_STORMS;
  for (let i = 0; i < s.length; i++) if (!isStormCell(s[i])) return NO_STORMS;
  return s as readonly StormCell[];
}

/** True when `l` is a WindAloftLevel with every field finite and inside the documented ranges. */
function isAloftLevel(l: unknown): l is WindAloftLevel {
  if (typeof l !== 'object' || l === null) return false;
  const v = l as Record<string, unknown>;
  return (
    finite(v.altFt) &&
    v.altFt >= ALOFT_ALT_MIN_FT &&
    v.altFt <= ALOFT_ALT_MAX_FT &&
    finite(v.dirDeg) &&
    finite(v.kt) &&
    v.kt >= 0 &&
    v.kt <= ALOFT_KT_MAX &&
    (v.tempC === undefined || (finite(v.tempC) && v.tempC >= ALOFT_TEMP_MIN_C && v.tempC <= ALOFT_TEMP_MAX_C))
  );
}

/** True when `a` is a valid wind-aloft table: at most MAX_ALOFT_LEVELS valid levels, altitudes strictly ascending. */
export function isAloftTable(a: unknown): a is readonly WindAloftLevel[] {
  if (!Array.isArray(a) || a.length > MAX_ALOFT_LEVELS) return false;
  for (let i = 0; i < a.length; i++) {
    if (!isAloftLevel(a[i])) return false;
    if (i > 0 && !((a[i] as WindAloftLevel).altFt > (a[i - 1] as WindAloftLevel).altFt)) return false;
  }
  return true;
}

/**
 * The manual wind-aloft table: w.windsAloft when it is a valid table (isAloftTable), else undefined, which reads as
 * derived (a malformed table is treated as absent). An empty array is returned as is: no shear above the boundary
 * layer. The array is returned as stored.
 */
export function windsAloftOf(w: WeatherSettings): readonly WindAloftLevel[] | undefined {
  const a = (w as Loose).windsAloft;
  return isAloftTable(a) ? a : undefined;
}

/**
 * Parse URL wind-aloft levels (`aloft=altFt,dir,kt[,tempC]`, repeatable; `aloft=none` for no shear): returns the
 * table (sorted by altitude, frozen; malformed entries and repeated altitudes dropped, values clamped to the ranges,
 * at most MAX_ALOFT_LEVELS), [] for `none`, or undefined when nothing usable was given (derived). For
 * sim/params.ts and the dev weather page.
 */
export function parseAloftParams(values: readonly string[]): readonly WindAloftLevel[] | undefined {
  if (values.includes('none')) return Object.freeze([]);
  const levels: WindAloftLevel[] = [];
  for (const v of values) {
    const c = v.split(',').map((x) => (x.trim() === '' ? NaN : Number(x)));
    if (c.length < 3 || c.length > 4 || !c.every(Number.isFinite)) continue;
    const l: WindAloftLevel = {
      altFt: clamp(c[0], ALOFT_ALT_MIN_FT, ALOFT_ALT_MAX_FT),
      dirDeg: ((c[1] % 360) + 360) % 360,
      kt: clamp(c[2], 0, ALOFT_KT_MAX),
    };
    if (c.length === 4) l.tempC = clamp(c[3], ALOFT_TEMP_MIN_C, ALOFT_TEMP_MAX_C);
    if (!levels.some((x) => x.altFt === l.altFt)) levels.push(l);
  }
  levels.sort((a, b) => a.altFt - b.altFt);
  const table = Object.freeze(levels.slice(0, MAX_ALOFT_LEVELS).map((l) => Object.freeze(l)));
  return table.length > 0 && isAloftTable(table) ? table : undefined;
}

/** The mountain-wave gain, 0..1: 1 when absent or not a finite number. */
export function mountainWavesOf(w: WeatherSettings): number {
  const g = (w as Loose).mountainWaves;
  return finite(g) ? clamp(g, 0, 1) : 1;
}

/**
 * Centre of a cell at simulation time t, s, written into `out` (NED m). The cell moves toward motionDeg + 180 at
 * motionKt: north = northM - cos(motionDeg) v t, east = eastM - sin(motionDeg) v t. Analytic, no state.
 */
export function stormCentreAt(cell: StormCell, t: number, out: NorthEast): NorthEast {
  const d = cell.motionKt * KT * t;
  const a = cell.motionDeg * DEG;
  out.north = cell.northM - Math.cos(a) * d;
  out.east = cell.eastM - Math.sin(a) * d;
  return out;
}

const _precip: Precip = { type: 'none', rateMmH: 0 };

/**
 * Prevailing visibility with the precipitation's extinction added, m. Without precipitation (rate 0) it returns
 * w.visibilityM itself, with no arithmetic, so a consumer comparing it with its last value sees no change.
 */
export function effectiveVisibilityM(w: WeatherSettings): number {
  const p = precipOf(w, _precip);
  if (p.rateMmH === 0) return w.visibilityM;
  return KOSCHMIEDER / (KOSCHMIEDER / w.visibilityM + precipExtinctionPerM(p.type, p.rateMmH));
}

/**
 * A partial weather that moves the cloud base without giving a top keeps the current layer depth
 * (cloudTopM = cloudBaseM + current depth), the rule of the URL weather in the Simulator constructor and of
 * eraChoice.applyEraWeather. Edits `partial`.
 */
export function deriveCloudTop(partial: Partial<WeatherSettings>, current: WeatherSettings): void {
  if (partial.cloudBaseM !== undefined) partial.cloudTopM ??= partial.cloudBaseM + (current.cloudTopM - current.cloudBaseM);
}

/**
 * Delete every optional key of WEATHER_EXTRA_KEYS whose value fails its type check (a wrong type, a non-finite
 * number, an unknown enum string, a `storms` value that is not an array of well-formed cells, a `windsAloft` value
 * that is not a valid table). Values of the right
 * type stay as they are; the accessors clamp them. For snapshot validation (sim/resume.ts).
 */
export function sanitizeExtras(w: Record<string, unknown>): void {
  const drop = (k: WeatherExtraKey, ok: boolean): void => {
    if (k in w && !ok) delete w[k];
  };
  drop('cloudType', oneOf(CLOUD_TYPES, w.cloudType));
  drop('midCover', finite(w.midCover));
  drop('midType', oneOf(MID_TYPES, w.midType));
  drop('midAltM', finite(w.midAltM));
  drop('precipType', oneOf(PRECIP_TYPES, w.precipType));
  drop('precipRateMmH', finite(w.precipRateMmH));
  drop('fogTopM', finite(w.fogTopM));
  drop('fogVisibilityM', finite(w.fogVisibilityM));
  drop('storms', Array.isArray(w.storms) && w.storms.every(isStormCell));
  drop('windsAloft', isAloftTable(w.windsAloft));
  drop('mountainWaves', finite(w.mountainWaves));
}
