// Fauna rosters per era (Deep Time). Owned by the fauna behaviour package (WP5).
//
// Consumers pick ROSTERS[era().fauna]. Pure data.
//
// Increment 1, Late Cretaceous Laramidia (a composite: Edmontosaurus is northern, Quetzalcoatlus southern):
//   - Edmontosaurus annectens, 11-12 m, herds of 30-80 on the floodplain (the pilot's scale cue from 1500 ft);
//   - Quetzalcoatlus northropi, 10.5 m span, ~5 m standing head height; soars in kettles, stalks the ground;
//   - a small azhdarchid, ~4.5 m span: the same rig at 0.43, with its own crest and colour variant.
// Increment 2 adds Tyrannosaurus rex (12.3 m), Triceratops (8.5 m), Alamosaurus (26 m; southern Laramidia) and
// Pteranodon (6.5 m span; ~86-84 Ma, a seabird: poetic licence, the owner's call).
//
// Increment 2b (fauna across the landscape; every occupancy, group size and affinity below is an agent choice):
//   - layer 1 (habitat.ts probeHabitatCell, unchanged): Edmontosaurus herds of 30-80 beside the river and lakes;
//   - layer 2 (habitat.ts probeCell, cells layer 1 left empty): Edmontosaurus plains herds of 12-35 on moist
//     lowland (entry 7), Triceratops groups of 3-8 on open lowland, Alamosaurus groups of 2-4 at forest edges and
//     on the open Araucaria uplands. In animals: Edmontosaurus common, Triceratops about a tenth of it, Alamosaurus
//     rare;
//   - the T. rex ('nearHerd'): one beside 15 % of the streamed prey herds, never near the safari, at most 2 alive
//     (FaunaSystem); the rarest, always solitary;
//   - Pteranodon kettles are drawn 3x toward water (waterAffinity), the azhdarchids as before.
//
// Fauna across the landscape (AGENT choices, after measuring 14-70 animals per 100 km2 of land beyond 10 km): the
// layer-2 occupancies went plain 0.12 -> 0.35, open 0.06 -> 0.15, woodland 0.10 -> 0.15 (the rise as occupancyExtra,
// drawn after the old bands, so every cell keeps the species it drew before), the plains herds 12-35 -> 20-50, and
// habitat.ts adds a second, independent layer-2-style group per cell (layer 3, the same entries and shares).

import type { RosterId } from '../era/types';
import type { FaunaRoster, FaunaSpeciesId } from './types';

const NONE: FaunaRoster = Object.freeze({ id: 'none', entries: Object.freeze([]) });

const CRETACEOUS: FaunaRoster = Object.freeze({
  id: 'cretaceous',
  entries: Object.freeze([
    Object.freeze({ species: 'edmontosaurus', role: 'herd', groupMin: 30, groupMax: 80, weight: 1, scale: 1, variant: 0 }),
    Object.freeze({ species: 'quetzalcoatlus', role: 'flyer', groupMin: 1, groupMax: 2, weight: 1, scale: 1, variant: 0 }),
    Object.freeze({ species: 'azhdarchidSmall', role: 'flyer', groupMin: 2, groupMax: 4, weight: 1, scale: 0.43, variant: 1 }),
    // Increment 2 (APPEND-ONLY: tests and the showcase address entries 0-2 by index; inc 2b addresses 3-7). The
    // showcase hooks (showcaseHooks.ts) also place Triceratops, Alamosaurus and the T. rex at the safari with their
    // own sizes; from inc 2b the habitat streaming places them across the map too (habitat / occupancy, above).
    // The Pteranodon joins ambient kettles at weight 0.3 against the azhdarchids' 1, x / waterAffinity.
    Object.freeze({ species: 'triceratops', role: 'herd', groupMin: 3, groupMax: 8, weight: 0, scale: 1, variant: 0, ambient: true, habitat: 'open', occupancy: 0.06, occupancyExtra: 0.09 }),
    Object.freeze({ species: 'alamosaurus', role: 'herd', groupMin: 2, groupMax: 4, weight: 0, scale: 1, variant: 0, ambient: true, habitat: 'woodland', occupancy: 0.1, occupancyExtra: 0.05 }),
    Object.freeze({ species: 'tyrannosaurus', role: 'solo', groupMin: 1, groupMax: 1, weight: 0, scale: 1, variant: 0, ambient: true, habitat: 'nearHerd', occupancy: 0.15 }),
    Object.freeze({ species: 'pteranodon', role: 'flyer', groupMin: 2, groupMax: 4, weight: 0.3, scale: 1, variant: 0, ambient: true, waterAffinity: 3 }),
    // Increment 2b: Edmontosaurus plains herds (smaller, away from the banks; weight 0: never the layer-1 pick).
    Object.freeze({ species: 'edmontosaurus', role: 'herd', groupMin: 15, groupMax: 40, weight: 0, scale: 1, variant: 0, habitat: 'plain', occupancy: 0.12, occupancyExtra: 0.08 }),
  ] as const),
});

export const ROSTERS: Readonly<Record<RosterId, FaunaRoster>> = Object.freeze({
  none: NONE,
  cretaceous: CRETACEOUS,
});

/**
 * Real size of each species at roster scale 1, m (length for walkers, span for flyers). The rendered instance scale
 * is entry.scale * SPECIES_REFERENCE_M / mesh.lengthM, so the animals come out at their real size whatever length
 * the species builder reports (the small azhdarchid is the Quetzalcoatlus body at 0.43).
 */
export const SPECIES_REFERENCE_M: Readonly<Record<FaunaSpeciesId, number>> = Object.freeze({
  edmontosaurus: 11.5,
  quetzalcoatlus: 10.5,
  azhdarchidSmall: 10.5,
  tyrannosaurus: 12.3,
  triceratops: 8.5,
  alamosaurus: 26,
  pteranodon: 6.5,
});
