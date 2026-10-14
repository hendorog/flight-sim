// The Pteranodon showcase hook (WP4 owns this file; the export name `showcase` is fixed: showcaseHooks.ts calls it).
// The plan's placement: 3 birds in showcase kettle 0 (with 1 Quetzalcoatlus and 2 small azhdarchids).

import type { ShowcaseContext, ShowcaseSpawn } from '../showcaseHooks';

export function showcase(_ctx: ShowcaseContext): readonly ShowcaseSpawn[] {
  return [{ kind: 'flyer', species: 'pteranodon', kettle: 0, count: 3 }];
}
