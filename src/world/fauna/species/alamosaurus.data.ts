// Alamosaurus: the species profile (WP3 owns this file; WP0b stub with the plan's numbers). Pure and three-free:
// profiles.ts imports PROFILE (the export name is fixed).
//
// A pinned showcase trio (never ambient in inc 2), reaction 'ignore' (heads turn, nothing else), drawn as LOD2 out
// to farRangeM (12 km) so the necks are a landmark; its LOD bands are lodRangeScale x the preset's.

import type { SpeciesProfile } from '../profiles';
import { HADROSAUR_REACTION } from '../reactions';

export const PROFILE: SpeciesProfile = Object.freeze({
  strideM: Object.freeze({ walk: 3.6, run: 4.7 }),
  speed: Object.freeze({ walk: 0.9, run: 1.3 }),
  groundOffsetM: 0,
  flapHz: 0,
  formation: Object.freeze({ spacing: 22, personal: 12, stringOut: 1.3, wanderSpeed: 0.5, memberWalkMax: 0.9, leash: 300, runFrom: 1.2, runSpan: 1 }),
  reaction: Object.freeze({ kind: 'ignore', ...HADROSAUR_REACTION, alertRange: 400, predatorFleeRange: 0 }),
  render: Object.freeze({
    lod0Max: Object.freeze({ low: 2, medium: 3, high: 4, ultra: 6 }),
    lodRangeScale: 2,
    farRangeM: 12000,
    lod0Tris: 3500,
    tris: Object.freeze([3500, 500, 90, 3500] as const),
  }),
});
