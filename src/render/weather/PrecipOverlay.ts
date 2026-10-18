// Precipitation streaks at the camera (WeatherSettings.precipType, precipRateMmH): a post-TAA overlay.
// Stub: returns null, so the registry (index.ts) adds nothing.

import type { SceneEffect } from '../../core/context';
import type { WeatherEffectContext } from './index';

/** The precipitation overlay, or null. */
export function createPrecipOverlay(_c: WeatherEffectContext): SceneEffect | null {
  return null;
}
