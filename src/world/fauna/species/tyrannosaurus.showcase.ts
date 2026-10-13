// The T. rex's showcase hook (WP1 owns this file; the export name `showcase` is fixed: showcaseHooks.ts calls it).
// WP0b STUB (the plan's placement, which WP1 keeps): one solo agent at anchors.TREX_LAIR, facing the river herd.

import type { ShowcaseContext, ShowcaseSpawn } from '../showcaseHooks';

export function showcase(ctx: ShowcaseContext): readonly ShowcaseSpawn[] {
  const L = ctx.anchors.TREX_LAIR;
  return [{ kind: 'solo', species: 'tyrannosaurus', north: L.north, east: L.east, ground: L.ground, heading: L.heading, seed: 0x7e3a11 }];
}
