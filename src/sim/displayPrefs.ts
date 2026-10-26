// The 3D cockpit's render resolution on a HiDPI screen (mirrors skyPrefs.ts). Node-safe: tests/sim/displayPrefs.test.ts
// runs it with a fake store.
//
// The 3D view renders at CSS-pixel resolution (Simulator DPR_CAP), so on a devicePixelRatio 1.5 screen the cockpit
// panel is upscaled and its dial legends blur. 'fs.cockpitSharpness' lets the 3D cockpit view (not the external
// cameras, not the fixed panel) render at up to 1.25x or 1.5x CSS pixels, never above the screen's own ratio, on the
// high and ultra quality levels. Absent or 'auto': 1.25x on high, 1x on ultra (ultra is already ~13-14 ms of GPU at
// 1x). Measured GPU time of the frame (scene + post, EXT_disjoint_timer_query) in the 3D cockpit at 1920 x 991,
// Radeon 8060S, C172S / C208 / PC-12 / R44 (2026-10-26, scripts/cockpit-focus.mjs --perf):
//   high   1x 8.7-9.4 ms   1.25x 10.2-11.2 ms   1.5x 17.5-19.8 ms
//   ultra  1x 12.8-14.2    1.25x 14.2-15.8      1.5x 23.5-26.9
// 1.5x leaves no 60 fps margin on this GPU, so it is a choice, never the default.

import type { QualityLevel } from '../core/context';
import type { KeyValueStore } from './resume';

/** localStorage key of the setting. */
export const COCKPIT_SHARPNESS_KEY = 'fs.cockpitSharpness';
/** The choices: automatic (by quality level) or a fixed scale over CSS pixels. */
export const COCKPIT_SHARPNESS = ['auto', 1, 1.25, 1.5] as const;
export type CockpitSharpness = typeof COCKPIT_SHARPNESS[number];

/** A valid setting, or null. */
export function sanitizeCockpitSharpness(v: unknown): CockpitSharpness | null {
  if (v === 'auto') return 'auto';
  const n = typeof v === 'string' ? (v.trim() === '' ? NaN : Number(v)) : typeof v === 'number' ? v : NaN;
  return (COCKPIT_SHARPNESS as readonly unknown[]).includes(n) ? (n as CockpitSharpness) : null;
}

/** The stored setting, or 'auto' when absent or invalid. */
export function loadCockpitSharpness(store: KeyValueStore | null): CockpitSharpness {
  let raw: string | null = null;
  try {
    raw = store?.getItem(COCKPIT_SHARPNESS_KEY) ?? null;
  } catch {
    raw = null;
  }
  return sanitizeCockpitSharpness(raw) ?? 'auto';
}

/** Store the setting the pilot chose in the menu (ignored when invalid or when storage fails). */
export function saveCockpitSharpness(store: KeyValueStore | null, v: CockpitSharpness): void {
  const s = sanitizeCockpitSharpness(v);
  if (s === null) return;
  try {
    store?.setItem(COCKPIT_SHARPNESS_KEY, String(s));
  } catch {
    /* ignore */
  }
}

/**
 * The device-pixel-ratio cap of the 3D cockpit view: the setting's scale on high and ultra ('auto': 1.25 on high, 1
 * on ultra), 1 on low and medium. The renderer then uses min(devicePixelRatio, this) x the render scale.
 */
export function cockpitDprCap(setting: CockpitSharpness, quality: QualityLevel): number {
  if (quality !== 'high' && quality !== 'ultra') return 1;
  if (setting === 'auto') return quality === 'high' ? 1.25 : 1;
  return setting;
}
