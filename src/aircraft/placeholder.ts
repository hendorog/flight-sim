// Placeholders: the Cessna 172S under another id, so that every loader of the registry resolves before a type's
// own files exist. A type's directory holds three one-line files built from these until its real definition
// lands; `placeholder: true` keeps it out of the chooser (the catalogue row stays unavailable).
//
// The definition side imports the C172S definition only. The presentation is handed in by the placeholder's
// presentation.ts, so loading a placeholder DEFINITION (node, physics tests) does not load the panel, the UI or
// the sound. A placeholder visual.ts does not come through this file at all: the livery worker loads it, and
// this file carries the flight model.

import type { AircraftId } from '../core/types';
import C172S_DEFINITION from './c172s/index';
import type { AircraftDefinition, AircraftPresentation } from './types';

/**
 * The C172S flight model, systems and profiles under `id`, with the names of the type it stands in for. One
 * engine, whatever the type will have.
 */
export function placeholderDefinition(
  id: AircraftId,
  names: Pick<AircraftDefinition, 'name' | 'shortName' | 'variant' | 'icaoType'>,
): AircraftDefinition {
  return { ...C172S_DEFINITION, id, ...names, engineCount: 1, placeholder: true };
}

/** `c172s` (the C172S presentation) under `id`: the same panel, UI, sound and school data; its airframe carries the id. */
export function placeholderPresentation(id: AircraftId, c172s: AircraftPresentation): AircraftPresentation {
  return { ...c172s, id, visual: { ...c172s.visual, id } };
}
