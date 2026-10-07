// The valley town (built by the airport module, src/world/airport/valley.ts) keeps land cover off its
// footprint: no woodland, canopy shell, forest-edge walls or trees, and no crop fields, inside it. The site
// comes from the airport module's findTownSite(); the terrain system computes it once on the main thread and
// hands it to its workers (setTownSite), so the tile and tree workers and the ground shader agree.
//
// Pure and three.js-free (runs in the workers).

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

/** 0 inside the town's woodland-free zone, rising to 1 where woods may grow. */
export function townWoodFactor(north: number, east: number): number {
  if (!site) return 1;
  const r = site.radius + TOWN_WOOD_MARGIN;
  return smooth(r, r + TOWN_WOOD_FADE, townDistance(north, east));
}

/** 0 in the town's built-up core, rising to 1 where the field pattern may lie. */
export function townFieldFactor(north: number, east: number): number {
  if (!site) return 1;
  return smooth(site.radius * TOWN_CORE, site.radius * TOWN_CORE_FADE, townDistance(north, east));
}

/** True where no tree may stand: inside the town radius plus the woodland margin. */
export function inTownClearZone(north: number, east: number): boolean {
  return site !== null && townDistance(north, east) < site.radius + TOWN_WOOD_MARGIN;
}
