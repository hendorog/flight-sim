// The valley town (built by the airport module, src/world/airport/valley.ts) keeps land cover off its
// footprint: no woodland, canopy shell, forest-edge walls or trees, and no crop fields, inside it. The site
// comes from the airport module's findTownSite(); the terrain system computes it once on the main thread and
// hands it to its workers (setTownSite), so the tile and tree workers and the ground shader agree.
//
// The villages of today's road network (roads.ts villageSites) are kept clear the same way, on a smaller scale: no
// woods within VILLAGE_WOOD_MARGIN of their edge, gardens rather than crops in their cores.
//
// Pure and three.js-free (runs in the workers).

import { villageSites } from './roads';

export interface TownSite {
  north: number;
  east: number;
  /** Built-up radius, m (streets and houses reach about 0.94 of it plus 40 m). */
  radius: number;
}

/** Woodland stays this far beyond the town's radius (the airport module's clear margin), m. */
export const TOWN_WOOD_MARGIN = 60;
/** ... and fades in over this much beyond that, m. */
export const TOWN_WOOD_FADE = 100;
/**
 * The town's built-up edge varies with bearing between about 0.44 and 1.0 of its radius. Inside TOWN_CORE of
 * the radius it is built up in every direction: urban ground, no farmland (fading out to TOWN_CORE_FADE).
 * Between the core and radius + TOWN_PARCEL_MARGIN the field pattern stays, but as grass parcels (pasture,
 * paddocks, gardens) without crops or hedgerows, so houses never stand on striped crops.
 */
export const TOWN_CORE = 0.42;
export const TOWN_CORE_FADE = 0.62;
export const TOWN_PARCEL_MARGIN = 40;

/** Woodland keeps this far beyond a village's radius, and fades in over VILLAGE_WOOD_FADE beyond that, m. */
export const VILLAGE_WOOD_MARGIN = 30;
export const VILLAGE_WOOD_FADE = 60;
/** A village's core (no crops) reaches this share of its radius, fading out to VILLAGE_CORE_FADE. */
export const VILLAGE_CORE = 0.35;
export const VILLAGE_CORE_FADE = 0.6;

let site: TownSite | null = null;

/** Set (or clear, with null) the town site used by land cover in this thread. */
export function setTownSite(s: TownSite | null): void {
  site = s ? { north: s.north, east: s.east, radius: s.radius } : null;
}

export function townSite(): TownSite | null {
  return site;
}

const smooth = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Distance from the town centre, m (Infinity when there is no town). */
export function townDistance(north: number, east: number): number {
  if (!site) return Infinity;
  return Math.hypot(north - site.north, east - site.east);
}

/** Distance beyond the edge of the nearest village (negative inside it) and that village's radius, m. */
function nearestVillage(north: number, east: number): { beyond: number; radius: number } {
  let beyond = Infinity;
  let radius = 0;
  for (const v of villageSites()) {
    const b = Math.hypot(north - v.north, east - v.east) - v.radius;
    if (b < beyond) {
      beyond = b;
      radius = v.radius;
    }
  }
  return { beyond, radius };
}

/** 0 inside the town's (or a village's) woodland-free zone, rising to 1 where woods may grow. */
export function townWoodFactor(north: number, east: number): number {
  const v = nearestVillage(north, east).beyond;
  const village = v < VILLAGE_WOOD_MARGIN + VILLAGE_WOOD_FADE ? smooth(VILLAGE_WOOD_MARGIN, VILLAGE_WOOD_MARGIN + VILLAGE_WOOD_FADE, v) : 1;
  if (!site) return village;
  const r = site.radius + TOWN_WOOD_MARGIN;
  return smooth(r, r + TOWN_WOOD_FADE, townDistance(north, east)) * village;
}

/** 0 in the town's (or a village's) built-up core, rising to 1 where the field pattern may lie. */
export function townFieldFactor(north: number, east: number): number {
  const v = nearestVillage(north, east);
  const village = v.radius > 0 && v.beyond < 0 ? smooth(VILLAGE_CORE, VILLAGE_CORE_FADE, (v.beyond + v.radius) / v.radius) : 1;
  if (!site) return village;
  return smooth(site.radius * TOWN_CORE, site.radius * TOWN_CORE_FADE, townDistance(north, east)) * village;
}

/** True where no tree may stand: inside the town radius plus the woodland margin, or a village's plus its own. */
export function inTownClearZone(north: number, east: number): boolean {
  if (site !== null && townDistance(north, east) < site.radius + TOWN_WOOD_MARGIN) return true;
  return nearestVillage(north, east).beyond < VILLAGE_WOOD_MARGIN;
}
