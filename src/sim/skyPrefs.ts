// The night sky's presentation settings (mirrors the carburettor-icing switch in aircraftChoice.ts). Node-safe:
// tests/sim/skyPrefs.test.ts runs it with a fake store.
//
//   moon size   'fs.moonScale': the Moon's presentation size, a multiple of its real size (1..5 in steps of 0.25;
//               default 4: owner "about 3x", then "more cinematic"; the exact numbers are agent choices). At boot
//               the URL's moon= wins and is NOT stored (dev and test links do not change the owner's setting);
//               else the stored value; else the default. The menu's slider calls commands.setMoonScale, which
//               stores it and applies it live.

import { DEFAULT_MOON_SCALE, MOON_SCALE_MAX, MOON_SCALE_MIN, MOON_SCALE_STEP } from '../render/sky/params';
import type { SimParams } from './params';
import type { KeyValueStore } from './resume';

export { DEFAULT_MOON_SCALE, MOON_SCALE_MAX, MOON_SCALE_MIN, MOON_SCALE_STEP };

/** localStorage key of the Moon size setting. */
export const MOON_SCALE_KEY = 'fs.moonScale';

/** A valid setting: a finite number clamped into range and rounded to the slider's step; null otherwise. */
export function sanitizeMoonScale(v: unknown): number | null {
  const n = typeof v === 'string' ? (v.trim() === '' ? NaN : Number(v)) : typeof v === 'number' ? v : NaN;
  if (!Number.isFinite(n)) return null;
  const c = Math.min(MOON_SCALE_MAX, Math.max(MOON_SCALE_MIN, n));
  return Math.round(c / MOON_SCALE_STEP) * MOON_SCALE_STEP;
}

/** The stored Moon size, or the default when absent or invalid. */
export function loadMoonScale(store: KeyValueStore | null): number {
  let raw: string | null = null;
  try {
    raw = store?.getItem(MOON_SCALE_KEY) ?? null;
  } catch {
    raw = null;
  }
  return sanitizeMoonScale(raw) ?? DEFAULT_MOON_SCALE;
}

/** Store the Moon size the pilot chose in the menu (ignored when invalid or when storage fails). */
export function saveMoonScale(store: KeyValueStore | null, scale: number): void {
  const s = sanitizeMoonScale(scale);
  if (s === null) return;
  try {
    store?.setItem(MOON_SCALE_KEY, String(s));
  } catch {
    /* ignore */
  }
}

/** The Moon size this session starts with: the URL's moon= (not stored), else the stored setting, else the default. */
export function chooseMoonScale(params: Pick<SimParams, 'moonScale'>, store: KeyValueStore | null): number {
  return params.moonScale ?? loadMoonScale(store);
}
