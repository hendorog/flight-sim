// The Alamosaurus showcase hook (WP3 owns this file; the export name `showcase` is fixed: showcaseHooks.ts calls it).
// WP0b STUB (the plan's placement): a pinned trio at anchors.ALAMOSAURUS_STAND, heading across the safari track.

import type { ShowcaseContext, ShowcaseSpawn } from '../showcaseHooks';

export function showcase(ctx: ShowcaseContext): readonly ShowcaseSpawn[] {
  const S = ctx.anchors.ALAMOSAURUS_STAND;
  return [{ kind: 'herd', species: 'alamosaurus', north: S.north, east: S.east, ground: S.ground, heading: S.heading, size: 3, seed: 0xa1a305 }];
}
