// The menu's winds-aloft table (src/ui/menu.ts, Weather page): nine standard levels with direction, speed and
// temperature. An empty field shows the derived value (physics/weather/windsAloft.ts, the atmosphere model) as its
// placeholder. A row with any field set is a manual level; its empty fields take the derived values. Levels at other
// altitudes (from the URL) are kept. Node-safe; the DOM side is in menu.ts.

import { FT } from '../core/math';
import type { WeatherSettings, WindAloftLevel } from '../core/types';
import { ALOFT_KT_MAX, ALOFT_TEMP_MAX_C, ALOFT_TEMP_MIN_C, windsAloftOf } from '../core/weatherFields';
import { atmosphereAt } from '../physics/atmosphere';
import { derivedWindAloftAt, temperatureProfileOf, windFromDeg, windKt, type WindNE } from '../physics/weather/windsAloft';

/** The table's levels, ft MSL. */
export const MENU_ALOFT_LEVELS_FT = [3000, 6000, 9000, 12000, 18000, 24000, 30000, 34000, 39000] as const;

export interface AloftRowValues {
  altFt: number;
  /** The manual level at this altitude, if any. */
  manual: WindAloftLevel | undefined;
  /** Derived direction (deg, rounded to 10), speed (kt, rounded) and temperature (deg C, rounded). */
  derivedDir: number;
  derivedKt: number;
  derivedTempC: number;
}

/** An edited row: undefined fields are empty. */
export interface AloftRowInput {
  altFt: number;
  dirDeg?: number;
  kt?: number;
  tempC?: number;
}

const _v: WindNE = { north: 0, east: 0 };

/** The derived wind and temperature at an altitude (ft MSL), rounded as the table shows them. */
export function derivedAt(w: WeatherSettings, altFt: number): { dirDeg: number; kt: number; tempC: number } {
  const z = altFt * FT;
  const f = derivedWindAloftAt(w, z, _v);
  const kt = Math.round(windKt(f));
  const dir = kt === 0 ? 0 : (Math.round(windFromDeg(f) / 10) * 10) % 360;
  const t = atmosphereAt(z, { isaDeviation: w.isaDeviation, seaLevelPressure: w.qnhHpa * 100 }).temperature - 273.15;
  return { dirDeg: dir === 0 && kt > 0 ? 360 : dir, kt, tempC: Math.round(t) };
}

/** The rows of the table for the live weather. */
export function aloftRows(w: WeatherSettings): AloftRowValues[] {
  const table = windsAloftOf(w) ?? [];
  return MENU_ALOFT_LEVELS_FT.map((altFt) => {
    const d = derivedAt(w, altFt);
    return { altFt, manual: table.find((l) => l.altFt === altFt), derivedDir: d.dirDeg, derivedKt: d.kt, derivedTempC: d.tempC };
  });
}

/**
 * The table after an edit: the rows with any field set become levels (empty fields from the derived values; a
 * direction of 360 is stored as 360, speeds and temperatures clamped), plus the existing levels at altitudes the
 * table does not show. undefined when no level remains (back to derived). Frozen and sorted.
 */
export function tableFromRows(w: WeatherSettings, rows: readonly AloftRowInput[]): readonly WindAloftLevel[] | undefined {
  const levels: WindAloftLevel[] = [];
  for (const l of windsAloftOf(w) ?? []) if (!(MENU_ALOFT_LEVELS_FT as readonly number[]).includes(l.altFt)) levels.push(l);
  for (const r of rows) {
    if (r.dirDeg === undefined && r.kt === undefined && r.tempC === undefined) continue;
    const d = derivedAt(w, r.altFt);
    const level: WindAloftLevel = {
      altFt: r.altFt,
      dirDeg: (((r.dirDeg ?? d.dirDeg) % 360) + 360) % 360,
      kt: Math.min(ALOFT_KT_MAX, Math.max(0, r.kt ?? d.kt)),
    };
    if (r.tempC !== undefined) level.tempC = Math.min(ALOFT_TEMP_MAX_C, Math.max(ALOFT_TEMP_MIN_C, r.tempC));
    levels.push(level);
  }
  if (levels.length === 0) return undefined;
  levels.sort((a, b) => a.altFt - b.altFt);
  return Object.freeze(levels.map((l) => Object.freeze(l)));
}

/** "Fill from derived": every table level set to the derived wind (no temperatures; they stay derived). */
export function derivedTable(w: WeatherSettings): readonly WindAloftLevel[] {
  const base: WeatherSettings = { ...w, windsAloft: undefined };
  return tableFromRows(base, MENU_ALOFT_LEVELS_FT.map((altFt) => {
    const d = derivedAt(base, altFt);
    return { altFt, dirDeg: d.dirDeg, kt: d.kt };
  }))!;
}

/** The temperature the atmosphere model gives at a level (manual temperatures included), deg C. */
export function levelTemperatureC(w: WeatherSettings, altFt: number): number {
  return atmosphereAt(altFt * FT, { isaDeviation: w.isaDeviation, seaLevelPressure: w.qnhHpa * 100, profile: temperatureProfileOf(w) }).temperature - 273.15;
}
