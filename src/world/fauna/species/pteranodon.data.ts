// Pteranodon: the species profile (WP4 owns this file; WP0b stub with the plan's numbers). Pure and three-free:
// profiles.ts imports PROFILE (the export name is fixed).
//
// A flyer on the azhdarchid rig (Look-only variant): 3 of the 6 birds of showcase kettle 0, and ambient kettles at
// roster weight 0.3. groundOffsetM is the azhdarchid rig's origin height (the Look builder keeps the skeleton).

import type { SpeciesProfile } from '../profiles';
import { HADROSAUR_REACTION } from '../reactions';

export const PROFILE: SpeciesProfile = Object.freeze({
  strideM: Object.freeze({ walk: 2.6, run: 2.6 }),
  speed: Object.freeze({ walk: 1.0, run: 2.0 }),
  // The azhdarchid rig's origin height (profiles.ts AZHDARCHID_ORIGIN_M; a literal: importing a value from
  // profiles.ts here would be an import cycle).
  groundOffsetM: 2.4,
  flapHz: 1.4,
  formation: Object.freeze({ spacing: 7, personal: 4.5, stringOut: 1.5, wanderSpeed: 0.8, memberWalkMax: 1.6, leash: 600, runFrom: 2, runSpan: 3 }),
  reaction: Object.freeze({ kind: 'flee', ...HADROSAUR_REACTION, predatorFleeRange: 0 }),
  render: Object.freeze({
    lod0Max: Object.freeze({ low: 6, medium: 10, high: 14, ultra: 20 }),
    lodRangeScale: 1,
    farRangeM: 0,
    // STUB budgets fit the stub body (the small azhdarchid, ~1.8k tris). WP4: the plan's 1500 / 250 / 40 / 600.
    lod0Tris: 1900,
    tris: Object.freeze([1900, 320, 50, 1900] as const),
  }),
});
