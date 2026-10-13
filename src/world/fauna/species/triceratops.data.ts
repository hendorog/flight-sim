// Triceratops: the species profile (WP2 owns this file). Pure and three-free:
// profiles.ts imports PROFILE (the export name is fixed).
//
// A showcase herd (pinned, never ambient in inc 2) whose reaction is 'face': alarmed members turn on the spot
// toward the threat and stop (herds.ts), calming after 15-30 s. A predator source nearer than predatorFleeRange
// to the herd's edge makes it flee instead.

import type { SpeciesProfile } from '../profiles';
import { HADROSAUR_REACTION } from '../reactions';

export const PROFILE: SpeciesProfile = Object.freeze({
  strideM: Object.freeze({ walk: 2.4, run: 4.4 }),
  speed: Object.freeze({ walk: 1.2, run: 6 }),
  groundOffsetM: 0,
  flapHz: 0,
  formation: Object.freeze({ spacing: 6, personal: 3.5, stringOut: 1.2, wanderSpeed: 0.6, memberWalkMax: 1.2, leash: 300, runFrom: 2, runSpan: 4 }),
  reaction: Object.freeze({ kind: 'face', ...HADROSAUR_REACTION, alertRange: 400, calmMinS: 15, calmMaxS: 30, predatorFleeRange: 200 }),
  render: Object.freeze({
    lod0Max: Object.freeze({ low: 8, medium: 12, high: 16, ultra: 24 }),
    lodRangeScale: 1,
    farRangeM: 0,
    // The plan's budgets (lod0 / lod1 / lod2 / caster); bodies.test holds the meshes to them.
    lod0Tris: 2200,
    tris: Object.freeze([2200, 350, 60, 900] as const),
  }),
});
