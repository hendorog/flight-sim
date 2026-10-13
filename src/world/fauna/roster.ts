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

import type { RosterId } from '../era/types';
import type { FaunaRoster, FaunaSpeciesId } from './types';

const NONE: FaunaRoster = Object.freeze({ id: 'none', entries: Object.freeze([]) });

const CRETACEOUS: FaunaRoster = Object.freeze({
  id: 'cretaceous',
  entries: Object.freeze([
    Object.freeze({ species: 'edmontosaurus', role: 'herd', groupMin: 30, groupMax: 80, weight: 1, scale: 1, variant: 0 }),
    Object.freeze({ species: 'quetzalcoatlus', role: 'flyer', groupMin: 1, groupMax: 2, weight: 1, scale: 1, variant: 0 }),
    Object.freeze({ species: 'azhdarchidSmall', role: 'flyer', groupMin: 2, groupMax: 4, weight: 1, scale: 0.43, variant: 1 }),
    // Increment 2 (APPEND-ONLY: tests and the showcase address entries 0-2 by index). Triceratops, Alamosaurus and
    // the T. rex are showcase-only (ambient false: the habitat streaming never spawns them; showcaseHooks.ts places
    // them); the Pteranodon also joins ambient kettles, at weight 0.3 against the azhdarchids' 1.
    Object.freeze({ species: 'triceratops', role: 'herd', groupMin: 5, groupMax: 9, weight: 0, scale: 1, variant: 0, ambient: false }),
    Object.freeze({ species: 'alamosaurus', role: 'herd', groupMin: 2, groupMax: 4, weight: 0, scale: 1, variant: 0, ambient: false }),
    Object.freeze({ species: 'tyrannosaurus', role: 'solo', groupMin: 1, groupMax: 1, weight: 0, scale: 1, variant: 0, ambient: false }),
    Object.freeze({ species: 'pteranodon', role: 'flyer', groupMin: 2, groupMax: 4, weight: 0.3, scale: 1, variant: 0, ambient: true }),
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
