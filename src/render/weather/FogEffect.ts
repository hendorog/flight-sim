// Ground fog layer (WeatherSettings.fogTopM, fogVisibilityM): a scene effect after the storm cells.
// Stub: returns null, so the registry (index.ts) adds nothing.

import type { SceneEffect } from '../../core/context';
import type { WeatherEffectContext } from './index';

/** The ground-fog scene effect, or null. */
export function createFogEffect(_c: WeatherEffectContext): SceneEffect | null {
  return null;
}
