// The Alamosaurus showcase hook (WP3 owns this file; the export name `showcase` is fixed: showcaseHooks.ts calls it).
//
// A pinned trio at anchors.ALAMOSAURUS_STAND (open herd ground 330 m left of the track, 87 m from the nearest tall
// crowns), browsing, on its profile's 300 m leash, reaction 'ignore' (heads turn, nothing else). Drawn as LOD2 out
// to 12 km (PROFILE.render.farRangeM), so it is a far teaser at the boot and never released.
//
// Heading: the anchor's heading (0, due north) runs across the track, but at G6 (35 s) the line of sight from the
// door window is ~233 deg, so a northbound animal is seen 53 deg off head-on. SIDE_ON_HEADING turns the trio to
// 323 deg: still across the track (53 deg off it, angled toward it and ahead), but broadside to the G6 view, where
// the body length and the raised neck are the whole read (the members scatter +-34 deg about it).

import type { ShowcaseContext, ShowcaseSpawn } from '../showcaseHooks';

export const SIDE_ON_HEADING = (323 * Math.PI) / 180;

export function showcase(ctx: ShowcaseContext): readonly ShowcaseSpawn[] {
  const S = ctx.anchors.ALAMOSAURUS_STAND;
  return [{ kind: 'herd', species: 'alamosaurus', north: S.north, east: S.east, ground: S.ground, heading: SIDE_ON_HEADING, size: 3, seed: 0xa1a305 }];
}
