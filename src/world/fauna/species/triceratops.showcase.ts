// The Triceratops showcase hook (WP2 owns this file; the export name `showcase` is fixed: showcaseHooks.ts calls it).
// WP0b STUB (the plan's placement): a pinned herd of 7 at anchors.TRICERATOPS_GROUP, facing the T. rex's lair.

import type { ShowcaseContext, ShowcaseSpawn } from '../showcaseHooks';

export function showcase(ctx: ShowcaseContext): readonly ShowcaseSpawn[] {
  const G = ctx.anchors.TRICERATOPS_GROUP;
  return [{ kind: 'herd', species: 'triceratops', north: G.north, east: G.east, ground: G.ground, heading: G.heading, size: 7, seed: 0x7c1e7a }];
}
