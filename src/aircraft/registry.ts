// The aircraft the simulator can fly: the ids, the catalogue the chooser and the URL parser read without
// loading anything, and the lazy loaders of the definitions (flight model side, node-safe) and presentations
// (browser side). The Cessna 172S definition is imported statically (it is every component's default); each
// other type is its own chunk and nothing of it is evaluated unless it is selected.
//
// The livery worker must not import this file (it carries the C172S flight model): it imports
// aircraft/visualLoader.ts.

import type { AircraftId } from '../core/types';
import C172S_DEFINITION from './c172s/index';
import type { AircraftDefinition, AircraftPresentation, AircraftSummary } from './types';

export { AIRCRAFT_IDS, DEFAULT_AIRCRAFT_ID, isAircraftId } from '../core/types';
/** Re-export of visualLoader.ts for the main thread. */
export { loadAirframeVisual } from './visualLoader';

/** localStorage key of the chosen aircraft. */
export const AIRCRAFT_PREF_KEY = 'fs.aircraft';

/** One row per id, in the order of AIRCRAFT_IDS. A type is `available` once its Stage D is accepted. */
export const AIRCRAFT_CATALOGUE: readonly AircraftSummary[] = [
  {
    id: 'c172s',
    name: 'Cessna 172S Skyhawk SP',
    shortName: 'Cessna 172S',
    blurb: 'Four-seat high-wing trainer, 180 hp',
    engineCount: 1,
    available: true,
  },
  {
    id: 'c152',
    name: 'Cessna 152',
    shortName: 'Cessna 152',
    blurb: 'Two-seat high-wing trainer, 110 hp',
    engineCount: 1,
    available: true,
  },
  {
    id: 'pa38',
    name: 'Piper PA-38-112 Tomahawk II',
    shortName: 'Piper Tomahawk',
    blurb: 'Two-seat low-wing T-tail trainer, 112 hp',
    engineCount: 1,
    available: true,
  },
  {
    id: 'da20',
    name: 'Diamond DA20-C1',
    shortName: 'Diamond DA20',
    blurb: 'Two-seat composite T-tail trainer with a stick, 125 hp',
    engineCount: 1,
    available: true,
  },
  {
    id: 'pa34',
    name: 'Piper PA-34-200 Seneca I',
    shortName: 'Piper Seneca',
    blurb: 'Six-seat twin with retractable gear, 2 x 200 hp',
    engineCount: 2,
    available: true,
  },
  {
    id: 'da42',
    name: 'Diamond DA42 NG',
    shortName: 'Diamond DA42',
    blurb: 'Four-seat diesel twin with retractable gear, 2 x 168 hp (analogue panel)',
    engineCount: 2,
    available: false,
  },
];

export function aircraftSummary(id: AircraftId): AircraftSummary {
  const row = AIRCRAFT_CATALOGUE.find((r) => r.id === id);
  if (!row) throw new Error(`unknown aircraft '${id}'`);
  return row;
}

// Literal import paths, so the bundler makes one chunk per type. The C172S definition needs no entry: it is
// loaded from the start.
const DEFINITION_LOADERS: Readonly<Record<Exclude<AircraftId, 'c172s'>, () => Promise<{ default: AircraftDefinition }>>> = {
  c152: () => import('./c152/index'),
  pa38: () => import('./pa38/index'),
  da20: () => import('./da20/index'),
  pa34: () => import('./pa34/index'),
  da42: () => import('./da42/index'),
};

// The C172S presentation is imported statically by the application shell, so there this resolves without a
// network round trip; a node test that only loads definitions never evaluates it.
const PRESENTATION_LOADERS: Readonly<Record<AircraftId, () => Promise<{ default: AircraftPresentation }>>> = {
  c172s: () => import('./c172s/presentation'),
  c152: () => import('./c152/presentation'),
  pa38: () => import('./pa38/presentation'),
  da20: () => import('./da20/presentation'),
  pa34: () => import('./pa34/presentation'),
  da42: () => import('./da42/presentation'),
};

const definitions = new Map<AircraftId, AircraftDefinition>([[C172S_DEFINITION.id, C172S_DEFINITION]]);
const pendingDefinitions = new Map<AircraftId, Promise<AircraftDefinition>>();
const presentations = new Map<AircraftId, Promise<AircraftPresentation>>();

/** Dynamic import of ./<id>/index.ts; cached. c172s resolves without a network round trip (statically bundled). */
export function loadAircraft(id: AircraftId): Promise<AircraftDefinition> {
  const have = definitions.get(id);
  if (have) return Promise.resolve(have);
  let pending = pendingDefinitions.get(id);
  if (!pending) {
    if (id === 'c172s' || !Object.hasOwn(DEFINITION_LOADERS, id)) return Promise.reject(new Error(`unknown aircraft '${id}'`));
    pending = DEFINITION_LOADERS[id]().then((m) => {
      // A definition registered while the chunk was loading stays.
      if (!definitions.has(id)) definitions.set(id, m.default);
      return definitions.get(id)!;
    });
    pendingDefinitions.set(id, pending);
    // A chunk that failed to load (network) may be asked for again.
    pending.catch(() => pendingDefinitions.delete(id));
  }
  return pending;
}

/** Dynamic import of ./<id>/presentation.ts; cached. Browser only. */
export function loadPresentation(id: AircraftId): Promise<AircraftPresentation> {
  let presentation = presentations.get(id);
  if (!presentation) {
    if (!Object.hasOwn(PRESENTATION_LOADERS, id)) return Promise.reject(new Error(`unknown aircraft '${id}'`));
    presentation = PRESENTATION_LOADERS[id]().then((m) => m.default);
    presentations.set(id, presentation);
    presentation.catch(() => presentations.delete(id));
  }
  return presentation;
}

/** A definition already loaded (or registered); throws otherwise. */
export function loadedAircraft(id: AircraftId): AircraftDefinition {
  const def = definitions.get(id);
  if (!def) throw new Error(`aircraft '${id}' is not loaded: await loadAircraft('${id}') first`);
  return def;
}

/** Tests and tools: make a definition available synchronously. */
export function registerAircraft(def: AircraftDefinition): void {
  definitions.set(def.id, def);
}
