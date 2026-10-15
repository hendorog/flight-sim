// Which era a session is set in (Deep Time; mirrors aircraftChoice.ts). Node-safe: tests/sim/eraChoice.test.ts
// runs it with a fake store.
//
//   at boot     era=<id> in the URL if it is a known id; else the stored preference ('fs.era') if it is a known
//               id; else the present day. An era chosen by URL is not stored (dev and test links do not change
//               the world the owner flies next). The Simulator constructor calls setEra() with the result right
//               after parseParams, before anything era-dependent is built.
//   the chooser commands.setEra stores the preference and reloads without the URL parameters that would undo
//               the choice (eraSwitchUrl).
//   weather     applyEraWeather merges the era's preset over the defaults, before the URL's weather.

import type { ScenarioId } from '../core/context';
import type { WeatherSettings } from '../core/types';
import { isEraId } from '../world/era/registry';
import type { EraId } from '../world/era/types';
import type { SimParams } from './params';
import type { KeyValueStore } from './resume';

/**
 * Start scenarios that belong to the eras (EraWorld.defaultScenario), beyond src/sim/scenarios.ts SCENARIO_IDS
 * (which the present-day suites and goldens iterate). A URL and a resume snapshot may name them.
 */
export const ERA_SCENARIO_IDS: readonly ScenarioId[] = ['safari'];

/** localStorage key of the chosen era. */
export const ERA_PREF_KEY = 'fs.era';

/**
 * URL parameters a change of era removes: the era itself (the choice is stored instead) and those that would
 * bring the old world's flight back (scenario, lesson, phase, brief, resume, and the R22 scripted demo with its
 * trace graph, which would otherwise restart the demo and its weather in place of the new era's start). The
 * aircraft stays.
 */
export const ERA_SWITCH_DROPS = ['era', 'scenario', 'lesson', 'phase', 'brief', 'resume', 'demo', 'trace'] as const;

export interface EraChoice {
  id: EraId;
  /** Where the choice came from. */
  source: 'url' | 'preference' | 'default';
}

function read(store: KeyValueStore | null, key: string): string | null {
  try {
    return store?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/** The era this session is set in (see the header for the order). */
export function chooseEra(params: Pick<SimParams, 'era'>, store: KeyValueStore | null): EraChoice {
  if (params.era) return { id: params.era, source: 'url' };
  const pref = read(store, ERA_PREF_KEY);
  if (isEraId(pref)) return { id: pref, source: 'preference' };
  return { id: 'present', source: 'default' };
}

/** Store the era the pilot chose in the menu. */
export function saveEraPreference(store: KeyValueStore | null, id: EraId): void {
  try {
    store?.setItem(ERA_PREF_KEY, id);
  } catch {
    /* ignore */
  }
}

/**
 * The page a change of era reloads into: the current URL without ERA_SWITCH_DROPS. The new world then starts
 * its default scenario (EraWorld.defaultScenario; the Simulator applies it when the URL names none and the boot
 * is not a resume), and a reload later resumes the flight as usual (a scenario= left in the URL would stop that).
 */
export function eraSwitchUrl(href: string): string {
  const url = new URL(href);
  for (const k of ERA_SWITCH_DROPS) url.searchParams.delete(k);
  return url.toString();
}

/**
 * Merge an era's weather preset into `weather` (the defaults), in place. A preset that moves the cloud base
 * without a top keeps the layer's depth (as the URL's base= does). The present day's preset is empty: no change.
 */
export function applyEraWeather(weather: WeatherSettings, preset: Readonly<Partial<WeatherSettings>>): WeatherSettings {
  const w: Partial<WeatherSettings> = { ...preset };
  if (w.cloudBaseM !== undefined) w.cloudTopM ??= w.cloudBaseM + (weather.cloudTopM - weather.cloudBaseM);
  return Object.assign(weather, w);
}
