// Lazy loader of the airframe visual definitions (src/aircraft/<id>/visual.ts: plain data). This is the ONE
// aircraft module the livery worker imports: it imports nothing but a type, so a worker that loads it carries
// no flight model, no panel and no three.js. The main thread reaches it through aircraft/registry.ts.

import type { AirframeVisualDef } from '../render/aircraft/airframe/types';

// Literal import paths, so the bundler makes one chunk per type.
const LOADERS: Readonly<Record<string, () => Promise<{ default: AirframeVisualDef }>>> = {
  c172s: () => import('./c172s/visual'),
  c152: () => import('./c152/visual'),
  pa38: () => import('./pa38/visual'),
  da20: () => import('./da20/visual'),
  pa34: () => import('./pa34/visual'),
  da42: () => import('./da42/visual'),
};

const cache = new Map<string, Promise<AirframeVisualDef>>();

/** Dynamic import of ./<id>/visual.ts (plain data); cached. `id` is a string so the worker needs no core import. */
export function loadAirframeVisual(id: string): Promise<AirframeVisualDef> {
  let visual = cache.get(id);
  if (!visual) {
    if (!Object.hasOwn(LOADERS, id)) return Promise.reject(new Error(`unknown aircraft '${id}'`));
    visual = LOADERS[id]().then((m) => m.default);
    cache.set(id, visual);
    // A chunk that failed to load (network) may be asked for again.
    visual.catch(() => cache.delete(id));
  }
  return visual;
}
