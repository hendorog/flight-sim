// The T. rex's showcase hook (WP1; the export name `showcase` is fixed: showcaseHooks.ts calls it).
// One solo agent at anchors.TREX_LAIR (cretaceousAnchors.ts: 260 m from the river herd, placed so that a charge
// from it drives the stampede TREX_FLEE_HEADING, ahead of and in toward the safari track), facing the herd. Its
// brain (tyrannosaurus.brain.ts) stalks, charges and roars on the safari's first-minute timeline.

import type { ShowcaseContext, ShowcaseSpawn } from '../showcaseHooks';

export function showcase(ctx: ShowcaseContext): readonly ShowcaseSpawn[] {
  const L = ctx.anchors.TREX_LAIR;
  return [{ kind: 'solo', species: 'tyrannosaurus', north: L.north, east: L.east, ground: L.ground, heading: L.heading, seed: 0x7e3a11 }];
}
