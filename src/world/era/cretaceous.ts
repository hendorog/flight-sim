// Late Cretaceous Laramidia, ~67 Ma: the same continent, valley, river and lakes as today (so the airfield frame
// and approach corridors are unchanged), with no snow, a higher tree line, no farmland or town, marsh on the
// floodplain, a stratovolcano 17.6 km west of the field, no airport (the flat airport zone is a dry oxbow mud
// flat, "the Flats") and a warm, hazy weather preset. The fauna is a composite of northern (Hell Creek:
// Edmontosaurus) and southern (Javelina: Quetzalcoatlus) Laramidia, hence the label.
//
// Scalars only (WP0); WP8 tunes the numbers. The look (palette), trees (flora) and animals (roster) are in their
// subsystems' tables under the ids named here.

import type { EraParams } from './types';

export const CRETACEOUS: EraParams = Object.freeze({
  id: 'cretaceous',
  label: 'Late Cretaceous Laramidia',
  epoch: '~67 Ma',
  blurb:
    'Fern prairie, swamp cypress and palms along a warm river plain; hadrosaur herds by the water and giant ' +
    'azhdarchid pterosaurs riding the thermals. No airfield: take off from the dry mud flats. Fly at dusk ' +
    '(about 19:30) and the volcano to the west stands black against the sunset.',
  terrain: Object.freeze({
    // Tree line up to ~2350 m.
    treeLineOffset: 600,
    // No snow anywhere: the peaks are bare rock.
    snowLineOffset: 6000,
    farmland: false,
    town: false,
    marsh: true,
    // NED (2000, -17500): 17.6 km from the field on bearing 276 (backlit at sunset, ~26 deg right of the nose
    // lined up on 25), ~1.7 km clear of the nearest lake rim and of the far end of the 07 approach corridor.
    volcano: Object.freeze({ north: 2000, east: -17500, baseRadius: 7000, summit: 2600, craterRadius: 400, craterDepth: 160 }),
  }),
  palette: 'cretaceous',
  flora: 'cretaceous',
  fauna: 'cretaceous',
  world: Object.freeze({ airport: 'flats', flatSurface: 'dirt', school: false, towerCamera: false, defaultScenario: 'safari' }),
  // 45 km visibility keeps the volcano visible from the line-up; a 1500 m MSL cumulus base; ISA +10 (a higher
  // density altitude, honestly); a little cirrus for the low sun to colour at dusk. No sun tint and no colour grade.
  weather: Object.freeze({ visibilityM: 45000, cloudCover: 0.35, cloudBaseM: 1500, cirrusCover: 0.2, isaDeviation: 10 }),
} as const satisfies EraParams);
