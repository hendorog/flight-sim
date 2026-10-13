// Tyrannosaurus rex: the species profile (WP1 owns this file; WP0b stub with the plan's numbers). Pure and
// three-free: profiles.ts imports PROFILE (the export name is fixed).
//
// A solo agent (agents.ts), driven by tyrannosaurus.brain.ts: speed.walk is the stalk walk, speed.run the charge;
// strideM are the theropod pose's walk and charge strides (poses/theropod.ts must cover exactly these).

import type { SpeciesProfile } from '../profiles';
import { HADROSAUR_REACTION } from '../reactions';

export const PROFILE: SpeciesProfile = Object.freeze({
  strideM: Object.freeze({ walk: 3.9, run: 6.5 }),
  speed: Object.freeze({ walk: 1.4, run: 8 }),
  groundOffsetM: 0,
  flapHz: 0,
  formation: Object.freeze({ spacing: 20, personal: 8, stringOut: 1, wanderSpeed: 0.8, memberWalkMax: 1.4, leash: 600, runFrom: 2, runSpan: 6 }),
  reaction: Object.freeze({ kind: 'ignore', ...HADROSAUR_REACTION, alertRange: 300, predatorFleeRange: 0 }),
  render: Object.freeze({
    lod0Max: Object.freeze({ low: 1, medium: 2, high: 2, ultra: 3 }),
    lodRangeScale: 1.5,
    farRangeM: 9000,
    lod0Tris: 4000,
    tris: Object.freeze([4000, 600, 80, 1500] as const),
  }),
});
