// Scripted wildlife placements (Deep Time): deterministic and always present in an era with fauna, so the first
// flight meets them. Pure and three-free.
//
// 1. The river herd: ~60 Edmontosaurus on the river bank ~2.5 km beyond the 07 departure end (runway frame along
//    ~ +3.5 km, across ~ +3.0 km, where the river runs parallel ~3 km south): the climb-out reveal. The exact spot
//    is the nearest valid herd ground (habitat.ts herdGround) to that seed point, searched on a fixed spiral.
// 2. The resting pair: two large Quetzalcoatlus standing on the Flats beyond the 25 end (along ~ +1150 m, across
//    ~ +60 m), off the centreline trail and outside the roll; they walk about slowly and quad-launch when the
//    aircraft comes within 400 m on the ground or low. The one scripted exception to "nothing in the flat zone".
// 3. Two kettles of azhdarchids (mixed sizes), each on the real thermal core nearest a point 1.5 km past a
//    departure end, 250-700 m above the ground.

import { AIRPORT } from '../../core/world';
import { localToNed, RUNWAY_HALF_LENGTH } from '../airport/layout';
import { herdGround, type FaunaTerrain } from './habitat';

/** Runway-frame seed of the river herd (along, across), m. */
export const RIVER_HERD_SEED = { u: 3500, v: 3000 } as const;
export const RIVER_HERD_SIZE = 60;
/** Spiral search for valid ground around the seed: rings of this step, up to this many probes. */
const SEARCH_STEP = 60;
const SEARCH_PROBES = 40;

/** The resting pair, runway frame (along, across) m, and their headings (local frame, rad from the 07 direction). */
export const RESTING_PAIR = [
  { u: 1150, v: 60, h: 2.4 },
  { u: 1172, v: 74, h: 3.6 },
] as const;

/** Kettle seed points: 1.5 km past each departure end (07 departs toward +u, 25 toward -u), runway frame. */
export const KETTLE_SEEDS = [
  { u: RUNWAY_HALF_LENGTH + 1500, v: 0 },
  { u: -RUNWAY_HALF_LENGTH - 1500, v: 0 },
] as const;
/** Birds per showcase kettle (mixed sizes) and their height band above the ground, m. */
export const KETTLE_BIRDS = 4;
export const KETTLE_MIN_AGL = 250;
export const KETTLE_MAX_AGL = 700;

export interface ShowcaseSite {
  north: number;
  east: number;
  ground: number;
  /** Heading the herd strings out along (the river's direction near the site), rad. */
  heading: number;
}

/**
 * The river herd's site: the first valid herd ground on a spiral about the seed (deterministic). Costs up to
 * SEARCH_PROBES * 5 terrain samples (once, in init). Falls back to the seed itself if nothing passes.
 */
export function riverHerdSite(terrain: FaunaTerrain): ShowcaseSite {
  const seed = localToNed(RIVER_HERD_SEED.u, RIVER_HERD_SEED.v);
  const g = { h: 0 };
  // Herds string out along the river, which here runs parallel to the runway.
  const heading = AIRPORT.runway.heading + Math.PI;
  for (let k = 0; k < SEARCH_PROBES; k++) {
    const r = k === 0 ? 0 : SEARCH_STEP * Math.sqrt(k);
    const a = k * 2.399963229728653;
    const n = seed.north + r * Math.cos(a);
    const e = seed.east + r * Math.sin(a);
    if (herdGround(n, e, terrain, g) === '') return { north: n, east: e, ground: g.h, heading };
  }
  return { north: seed.north, east: seed.east, ground: terrain.height(seed.north, seed.east), heading };
}

/** The resting pair in NED with true headings; they stand on the Flats at the field elevation. */
export function restingPair(): { north: number; east: number; heading: number; ground: number }[] {
  return RESTING_PAIR.map((p) => {
    const ned = localToNed(p.u, p.v);
    return { north: ned.north, east: ned.east, heading: AIRPORT.runway.heading + p.h, ground: AIRPORT.elevation };
  });
}

/** Kettle seed points in NED. */
export function kettleSeeds(): { north: number; east: number }[] {
  return KETTLE_SEEDS.map((p) => localToNed(p.u, p.v));
}
