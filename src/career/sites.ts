// Helicopter landing sites off the airfields (docs/career.md "Build plan", wave 4, 4a): where a medevac helicopter
// picks its patient up. A site is a patch of open, level, dry grass beside something a casualty would be found at:
//
// - the edge of a village (src/world/terrain/roads.ts villageSites(); seed 0 only, the owner's road choice);
// - a road (roads.ts regionalRoads(), every SITE_RULES.roadStepM along each road; seed 0 only);
// - the edge of the town (src/world/airport/valley.ts findTownSite, every seed);
// - a lake shore and the river bank (hydrology.lakes, hydrology.river, every seed), so every world has sites.
//
// Each anchor (siteAnchors: cheap, no tree query) is tried at a fixed list of candidate points (rings round a village,
// the town or a lake; offsets square to a road or the river), in a fixed order, and the first that passes every rule
// is its site (siteOf, SITE_RULES; an anchor may have none):
//
//   level     the terrain normal within maxSlopeDeg of vertical at the point and across the disc of ringM round it
//             (every slopeGridM over the touchdown pad of padM, the skids and the rotor disc, and every 4 x slopeGridM
//             out to the ring, so a fold between the ring's points is not missed), from the terrain sampler
//             (heightfield.ts terrainNormal);
//   dry       grass (heightfield.ts terrainSurface: not water, rock, snow or beach) at the point and on the ring, at
//             least dryMarginM from the river's water, an oxbow's water and a lake's shore;
//   clear     at least fieldClearM beyond every field's area (the completion box of COMPLETION_RULES: a site is never
//             "inside" a field), roadClearM beyond a road verge, buildingClearM beyond a village's built-up radius and
//             townClearM beyond the town's (past its woodland margin and fade, townMask.ts, plus the tree check's
//             radius: the trees there depend on whether TerrainSystem has set the town site, which a node test has not,
//             so the query must not look there), outside every approach corridor's obstacle-clear zone;
//   no trees  no tree (nor clipped hedge) within treeClearM by the vegetation query itself
//             (src/world/terrain/vegetation/placement.ts buildTreeCell, the tile workers' own function, on the
//             VegetationSystem's 256 m cells at every quality's candidate spacing, TREE_SPACINGS_M, since each
//             quality plants its own trees).
//
// A site is resolved only when a board draws its anchor (the tree query costs a few ms a cell, and seed 0 has about
// a hundred anchors), then cached. Pure reads of the world (never the siting code, never world state); deterministic
// per era, seed and fields; empty outside the present day. Names follow 4b's landmarks, in tenths of a NM since each
// is made alone: "Village edge 3.2 NM north-east of Fable", "Shore of Valley Lake", "Roadside 4.0 NM west of Dundale".
// The landing point is `siteWaypoint(site)`: a Waypoint with landS (COMPLETION_RULES.siteRadiusM, siteHoldS).

import { NM } from '../core/math';
import { era, isPresent } from '../world/era/eraState';
import { fieldCoords, type Airfield } from '../world/airfields';
import { findTownSite, TOWN_RADIUS } from '../world/airport/valley';
import { hydrology, makeSample, sampleTerrain, terrainHeight, terrainNormal, terrainSurface } from '../world/terrain/heightfield';
import { lakeRadius, type OxbowHit } from '../world/terrain/hydrology';
import { onRoadVerge, regionalRoads, villageSites } from '../world/terrain/roads';
import { TOWN_WOOD_FADE, TOWN_WOOD_MARGIN } from '../world/terrain/townMask';
import { buildTreeCell, TREE_STRIDE, WALL_STRIDE, type TreeCellData } from '../world/terrain/vegetation/placement';
import { worldSeed } from '../world/worldSeed';
import { bearingDeg, compassName, nearestField, placeName, type NedPoint } from './geo';
import { LAKE_NAMES } from './landmarks';
import { COMPLETION_RULES, type Waypoint } from './types';

/** What a site is beside. */
export type SiteKind = 'village' | 'road' | 'town' | 'lake' | 'river';

/** A helicopter landing site off the airfields. */
export interface HeliSite {
  /** Stable within a world: `village-<i>`, `road-<road>-<n>`, `town-<n>`, `lake-<i>`, `river-<n>` (the anchor's own index). */
  id: string;
  kind: SiteKind;
  /** Unique within the list ("Village edge 3 NM north-east of Fable"). */
  name: string;
  /** The landing point, NED m. */
  north: number;
  east: number;
  /** Ground there, m MSL. */
  elevationM: number;
}

/** The rules every site passes (see the header). Distances m, angles deg. */
export const SITE_RULES = {
  maxSlopeDeg: 5,
  /** The level and dry ring round the point (skids and rotor disc), m, and its points. */
  ringM: 25, ringPoints: 8,
  /**
   * The level check: a square grid of slopeGridM over the touchdown pad (padM round the point: the skids and the
   * rotor disc) and of slopeGridM x 4 out to ringM. The 25 m ring alone missed folds up to 6.8 deg, and the ground's
   * 2 m gradient can change by a degree within 1.5 m.
   */
  padM: 10, slopeGridM: 1.25,
  /** The samples are held this much under maxSlopeDeg, so the ground between them stays within about it. */
  slopeMarginDeg: 0.25,
  dryMarginM: 30,
  /** Beyond every field's completion box (|along| <= length/2 + alongMarginM, |across| <= acrossM). */
  fieldClearM: 300,
  /** The home field's apron lies beyond acrossM from its runway: its box is this wide across. */
  homeAcrossM: 700,
  roadClearM: 25,
  buildingClearM: 80,
  /** Beyond the town's radius: TOWN_WOOD_MARGIN + TOWN_WOOD_FADE (160 m) plus treeClearM. */
  townClearM: TOWN_WOOD_MARGIN + TOWN_WOOD_FADE + 40,
  treeClearM: 40,
  /** Road anchors this far apart along each road, m. */
  roadStepM: 4000,
  /** River anchors this far apart along the channel, m. */
  riverStepM: 5000,
} as const;

/**
 * Candidate spacings of the vegetation (VegetationSystem PRESETS low, medium, high, ultra), m: each quality plants
 * its own jittered lattice, so a site is checked against all of them.
 */
export const TREE_SPACINGS_M: readonly number[] = [6.5, 6, 5.5, 5];
/** The VegetationSystem's cell edge, m (its CELL). */
export const TREE_CELL_M = 256;

/** Ring distances beyond an area's edge, m, and bearings tried (deg from north, in order). */
const AREA_RINGS_M = [150, 300, 450] as const;
const BEARINGS_DEG = Array.from({ length: 12 }, (_, i) => i * 30);
/** Offsets square to a road (each side), m. */
const ROAD_OFFSETS_M = [70, 120, 180, -70, -120, -180] as const;
/** Offsets square to the river beyond its half width, m. */
const RIVER_OFFSETS_M = [120, 220, 350, -120, -220, -350] as const;

const sample = makeSample();
const oxbowHit: OxbowHit = { dist: Infinity, level: 0, halfWidth: 0, depth: 0 };
const UP_MIN = Math.cos(((SITE_RULES.maxSlopeDeg - SITE_RULES.slopeMarginDeg) * Math.PI) / 180);

// --------------------------------------------------------------------------------------------- rules

/** Distance beyond a field's completion box, m (0 inside it). */
function beyondField(f: Airfield, p: NedPoint): number {
  const { along, across } = fieldCoords(f, p.north, p.east);
  const halfAcross = f.kind === 'home' ? SITE_RULES.homeAcrossM : COMPLETION_RULES.acrossM;
  const da = Math.max(0, Math.abs(along) - (f.length / 2 + COMPLETION_RULES.alongMarginM));
  const dc = Math.max(0, Math.abs(across) - halfAcross);
  return Math.hypot(da, dc);
}

/** The ring of points round `p` (radius ringM) and `p` itself. */
function footprint(p: NedPoint): NedPoint[] {
  const out: NedPoint[] = [p];
  for (let k = 0; k < SITE_RULES.ringPoints; k++) {
    const a = (k / SITE_RULES.ringPoints) * 2 * Math.PI;
    out.push({ north: p.north + Math.cos(a) * SITE_RULES.ringM, east: p.east + Math.sin(a) * SITE_RULES.ringM });
  }
  return out;
}

/**
 * Level round `p`: a square grid of 4 x slopeGridM out to ringM (first, so steep ground is refused after a few
 * samples), then of slopeGridM over the touchdown pad (padM); each grid takes in its disc's own edge.
 */
export function siteLevel(p: NedPoint): boolean {
  return levelOn(p, SITE_RULES.slopeGridM * 4, SITE_RULES.ringM) && levelOn(p, SITE_RULES.slopeGridM, SITE_RULES.padM);
}

function levelOn(p: NedPoint, g: number, R: number): boolean {
  const k = Math.ceil(R / g);
  for (let i = -k; i <= k; i++) {
    for (let j = -k; j <= k; j++) {
      const dn = Math.max(-R, Math.min(R, i * g));
      const de = Math.max(-R, Math.min(R, j * g));
      if (dn * dn + de * de > R * R + 1e-6) continue;
      if (-terrainNormal(p.north + dn, p.east + de).z < UP_MIN) return false;
    }
  }
  return true;
}

/** Dry at one point (the surface, the river, oxbows, lakes, standing water). */
function dry(q: NedPoint): string | null {
  if (terrainSurface(q.north, q.east) !== 'grass') return 'surface';
  const s = sampleTerrain(q.north, q.east, sample);
  if (s.river > -Infinity || s.riverDist - s.riverHalfWidth < SITE_RULES.dryMarginM) return 'river';
  if (s.ground < s.standing + 0.5) return 'water';
  if (s.approach > 0) return 'approach';
  hydrology.queryOxbow(q.north, q.east, oxbowHit);
  if (oxbowHit.dist - oxbowHit.halfWidth < SITE_RULES.dryMarginM) return 'oxbow';
  for (const lake of hydrology.lakes) {
    const size = Math.min(lake.radiusA, lake.radiusB);
    if (lakeRadius(lake, q.north, q.east) < 1 + SITE_RULES.dryMarginM / size) return 'lake';
  }
  return null;
}

let town: { key: string; site: { north: number; east: number; radius: number } | null } | null = null;

/** The town's centre and radius (findTownSite searches the terrain: kept per era and seed). */
function townOf(): { north: number; east: number; radius: number } | null {
  const key = `${era().id}|${worldSeed()}`;
  if (town?.key !== key) town = { key, site: findTownSite(terrainHeight) };
  return town.site;
}

/** Tree cells built for the tree check, by spacing and cell (a few at a time: each is tens of kB). */
const cells = new Map<string, TreeCellData>();
let cellsKey = '';
const MAX_CELLS = 64;

function treeCell(cx: number, cz: number, spacing: number): TreeCellData {
  const worldKey = `${era().id}|${worldSeed()}`;
  if (cellsKey !== worldKey) {
    cells.clear();
    cellsKey = worldKey;
  }
  const k = `${spacing}|${cx}|${cz}`;
  let c = cells.get(k);
  if (!c) {
    if (cells.size >= MAX_CELLS) cells.clear();
    c = buildTreeCell({ cx, cz, size: TREE_CELL_M, spacing });
    cells.set(k, c);
  }
  return c;
}

/** Point to segment distance, m. */
function segDist(pn: number, pe: number, an: number, ae: number, bn: number, be: number): number {
  const dn = bn - an;
  const de = be - ae;
  const l2 = dn * dn + de * de;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((pn - an) * dn + (pe - ae) * de) / l2)) : 0;
  return Math.hypot(pn - (an + t * dn), pe - (ae + t * de));
}

/**
 * Trees (and clipped hedges) within `radiusM` of a point at any quality (TREE_SPACINGS_M), by the vegetation's own
 * placement (buildTreeCell on the VegetationSystem's cells): how many there are (0: clear). `firstOnly`: stop at the
 * first one found (the densest spacing is searched first), so a wooded point costs one quality's cells.
 */
export function treesNear(north: number, east: number, radiusM: number, firstOnly = false): number {
  let count = 0;
  const cx0 = Math.floor((east - radiusM) / TREE_CELL_M);
  const cx1 = Math.floor((east + radiusM) / TREE_CELL_M);
  const cz0 = Math.floor((north - radiusM) / TREE_CELL_M);
  const cz1 = Math.floor((north + radiusM) / TREE_CELL_M);
  const spacings = [...TREE_SPACINGS_M].sort((a, b) => a - b);
  for (const spacing of spacings) {
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cz = cz0; cz <= cz1; cz++) {
        const c = treeCell(cx, cz, spacing);
        const t = c.instances;
        for (let i = 0; i < c.count; i++) {
          const e = t[i * TREE_STRIDE];
          const n = t[i * TREE_STRIDE + 2];
          if (Math.hypot(n - north, e - east) <= radiusM) {
            count++;
            if (firstOnly) return count;
          }
        }
        const w = c.walls;
        for (let i = 0; i + WALL_STRIDE <= w.length; i += WALL_STRIDE) {
          if (segDist(north, east, w[i + 1], w[i], w[i + 4], w[i + 3]) <= radiusM) {
            count++;
            if (firstOnly) return count;
          }
        }
      }
    }
  }
  return count;
}

/**
 * Why a point is no helicopter site, or null when it is one (every rule of SITE_RULES against `fields`; the tree
 * query last, as it is the dearest).
 */
export function siteRefusal(p: NedPoint, fields: readonly Airfield[]): string | null {
  for (const f of fields) if (beyondField(f, p) < SITE_RULES.fieldClearM) return 'field';
  if (onRoadVerge(p.north, p.east, SITE_RULES.roadClearM)) return 'road';
  for (const v of villageSites()) {
    if (Math.hypot(v.north - p.north, v.east - p.east) < v.radius + SITE_RULES.buildingClearM) return 'village';
  }
  const town = townOf();
  if (town && Math.hypot(town.north - p.north, town.east - p.east) < Math.max(town.radius, TOWN_RADIUS) + SITE_RULES.townClearM) return 'town';
  for (const q of footprint(p)) {
    const why = dry(q);
    if (why) return why;
  }
  if (!siteLevel(p)) return 'slope';
  if (treesNear(p.north, p.east, SITE_RULES.treeClearM, true) > 0) return 'trees';
  return null;
}

// --------------------------------------------------------------------------------------------- anchors

/**
 * Where a site may be looked for: what it is beside (its centre, NED m) and how its name reads. Cheap to list (no
 * tree query): a board draws among the anchors near its field and resolves only the ones it draws (siteOf).
 */
export interface SiteAnchor {
  /** The site's id (`village-<i>`, `road-<road>-<n>`, `town`, `lake-<i>`, `river-<n>`). */
  id: string;
  kind: SiteKind;
  north: number;
  east: number;
  /** The name's prefix ("Village edge"), or its whole fixed form ("Shore of Valley Lake"). */
  prefix: string;
  fixedName?: string;
  /** The candidate points, in the order they are tried. */
  candidates(): NedPoint[];
}

/** Points on rings `edge + d` (d in AREA_RINGS_M) round a centre, every 30 deg. */
function rings(c: NedPoint, edge: number): NedPoint[] {
  const out: NedPoint[] = [];
  for (const d of AREA_RINGS_M) {
    for (const b of BEARINGS_DEG) {
      const a = (b * Math.PI) / 180;
      out.push({ north: c.north + Math.cos(a) * (edge + d), east: c.east + Math.sin(a) * (edge + d) });
    }
  }
  return out;
}

/** Points square to a polyline at index i, `offsets` m beyond `base` (+ right of its direction). */
function squareTo(line: { north: ArrayLike<number>; east: ArrayLike<number> }, i: number, offsets: readonly number[], base = 0): NedPoint[] {
  const n = line.north.length;
  const a = Math.max(0, i - 1);
  const b = Math.min(n - 1, i + 1);
  const dn = line.north[b] - line.north[a];
  const de = line.east[b] - line.east[a];
  const l = Math.hypot(dn, de) || 1;
  // Right of the direction (dn, de) on a north-up map is (-de, dn).
  const rn = -de / l;
  const re = dn / l;
  return offsets.map((o) => {
    const d = Math.sign(o) * (Math.abs(o) + base);
    return { north: line.north[i] + rn * d, east: line.east[i] + re * d };
  });
}

/** Indices along a polyline every `step` m of its length (from half a step in). */
function stations(line: { north: ArrayLike<number>; east: ArrayLike<number> }, step: number): number[] {
  const out: number[] = [];
  let run = step / 2;
  for (let i = 1; i < line.north.length; i++) {
    run -= Math.hypot(line.north[i] - line.north[i - 1], line.east[i] - line.east[i - 1]);
    if (run <= 0) {
      out.push(i);
      run += step;
    }
  }
  return out;
}

let anchorCache: { key: string; list: readonly SiteAnchor[] } | null = null;

/** Every anchor of the world, in order: villages, roads, the town, lakes, the river (cached per era and seed). */
export function siteAnchors(): readonly SiteAnchor[] {
  if (!isPresent()) return [];
  const key = `${era().id}|${worldSeed()}`;
  if (anchorCache?.key === key) return anchorCache.list;
  const out: SiteAnchor[] = [];
  villageSites().forEach((v, i) => {
    out.push({ id: `village-${i}`, kind: 'village', north: v.north, east: v.east, prefix: 'Village edge', candidates: () => rings(v, v.radius) });
  });
  regionalRoads().forEach((road, r) => {
    stations(road, SITE_RULES.roadStepM).forEach((i, n) => {
      out.push({ id: `road-${r}-${n}`, kind: 'road', north: road.north[i], east: road.east[i], prefix: 'Roadside', candidates: () => squareTo(road, i, ROAD_OFFSETS_M) });
    });
  });
  const town = townOf();
  if (town) {
    out.push({
      id: 'town', kind: 'town', north: town.north, east: town.east, prefix: 'Town edge',
      candidates: () => rings(town, Math.max(town.radius, TOWN_RADIUS) + SITE_RULES.townClearM - AREA_RINGS_M[0]),
    });
  }
  hydrology.lakes.forEach((lake, i) => {
    const edge = Math.max(lake.radiusA, lake.radiusB);
    out.push({
      id: `lake-${i}`, kind: 'lake', north: lake.north, east: lake.east, prefix: 'Lake shore',
      fixedName: LAKE_NAMES[i] ? `Shore of ${LAKE_NAMES[i]}` : undefined, candidates: () => rings(lake, edge),
    });
  });
  const river = hydrology.river;
  stations(river, SITE_RULES.riverStepM).forEach((i, n) => {
    out.push({
      id: `river-${n}`, kind: 'river', north: river.north[i], east: river.east[i], prefix: 'Riverbank',
      candidates: () => squareTo(river, i, RIVER_OFFSETS_M, river.halfWidth[i]),
    });
  });
  const list = Object.freeze(out.map((a) => Object.freeze(a)));
  anchorCache = { key, list };
  return list;
}

// --------------------------------------------------------------------------------------------- sites

/** "3.2 NM north-east of Elmley" from the nearest field. */
function relativeTo(p: NedPoint, fields: readonly Airfield[]): string {
  const near = nearestField(p.north, p.east, fields);
  if (!near) return '';
  const nm = (Math.round((near.distanceM / NM) * 10) / 10).toFixed(1);
  return `${nm} NM ${compassName(bearingDeg(near.field, p))} of ${placeName(near.field)}`;
}

/** Resolved anchors per world and fields (a few worlds kept): the site, or null for an anchor with none. */
const resolvedByWorld = new Map<string, Map<string, HeliSite | null>>();
const RESOLVED_WORLDS = 4;

/**
 * An anchor's site: its first candidate that passes every rule (siteRefusal against `fields`), named, or null when
 * none does. Cached per era, world seed and fields, so a board pays the tree query once per anchor it draws.
 */
export function siteOf(a: SiteAnchor, fields: readonly Airfield[]): HeliSite | null {
  const key = `${era().id}|${worldSeed()}|${fields.map((f) => `${f.code}:${f.north}:${f.east}`).join(',')}`;
  let resolved = resolvedByWorld.get(key);
  if (!resolved) {
    if (resolvedByWorld.size >= RESOLVED_WORLDS) resolvedByWorld.clear();
    resolved = new Map();
    resolvedByWorld.set(key, resolved);
  }
  const hit = resolved.get(a.id);
  if (hit !== undefined) return hit;
  let site: HeliSite | null = null;
  for (const p of a.candidates()) {
    if (siteRefusal(p, fields) !== null) continue;
    site = Object.freeze({
      id: a.id, kind: a.kind, name: a.fixedName ?? `${a.prefix} ${relativeTo(p, fields)}`,
      north: p.north, east: p.east, elevationM: terrainHeight(p.north, p.east),
    });
    break;
  }
  resolved.set(a.id, site);
  return site;
}

/**
 * Every site of the world against the fields given (the Career passes airfields()), in anchor order (villages,
 * roads, the town, lakes, the river): each anchor's site where it has one. Deterministic per era, world seed and
 * fields. Empty outside the present day. It resolves every anchor (seconds at seed 0): for tests and tools; a
 * board resolves only the anchors it draws.
 */
export function helicopterSites(fields: readonly Airfield[]): readonly HeliSite[] {
  const out: HeliSite[] = [];
  for (const a of siteAnchors()) {
    const s = siteOf(a, fields);
    if (s) out.push(s);
  }
  return out;
}

/** The landing point of a site: a Waypoint named after it with COMPLETION_RULES' site radius and hold (landS). */
export function siteWaypoint(s: HeliSite): Waypoint {
  return { name: s.name, north: s.north, east: s.east, radiusM: COMPLETION_RULES.siteRadiusM, landS: COMPLETION_RULES.siteHoldS };
}
