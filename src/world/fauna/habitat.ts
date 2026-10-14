// Where the herds live (Deep Time): 2 km habitat cells around the camera, each hashed once (new salt) into "a herd
// lives here" or not, and probed for a valid site with at most MAX_SITE_PROBES candidates (5 terrain samples each,
// <= 40 per cell). Pure, three-free and deterministic: the same cell always yields the same site.
//
// A herd site (Edmontosaurus) needs: gentle ground (slope < 0.15), little forest (< 0.4), dry land, clear of the
// airfield (airportBlend > 0.98) and its approach corridors (approach == 0), below the tree line, and water close
// by: within 600 m of the river or on a lake shore.
//
// All terrain reads go through a FaunaTerrain, which counts them (the fauna's hard cap is 200 per frame).
//
// LAYER 2 (inc 2b, probeCell): a cell layer 1 left empty may host a layer-2 group instead, drawn on its own salt
// (layer2Random) by per-entry occupancy: Edmontosaurus plains herds, Triceratops on open lowland, Alamosaurus at
// forest edges and on the open Araucaria uplands (predicates at layer2Verdict; every number an agent choice). Layer
// 1 is untouched (tests/fixtures/faunaHabitatInc2.json pins it); layer 2 spends what is left of the cell's 40 reads
// and keeps out of the safari's showcase quiet zone.

import { SEA_LEVEL, hydrology, makeSample, sampleTerrain, terrainHeight, type TerrainSample } from '../terrain/heightfield';
import { computeBiome, makeBiome, treeLine } from '../terrain/biome';
import { hash2i } from '../terrain/noise';
import { hashU32 } from '../../physics/weather/random';
import { RIVER_HERD_SITE, ALAMOSAURUS_STAND, TRICERATOPS_GROUP, safariAt, safariStartNed } from '../era/cretaceousAnchors';
import type { FaunaRoster, FaunaRosterEntry, HabitatKind } from './types';

/** Habitat cell size, m. */
export const HABITAT_CELL = 2000;
/** Candidate sites probed per cell at most. */
export const MAX_SITE_PROBES = 6;
/** Terrain samples one candidate costs (the point and four neighbours for the slope). */
export const SAMPLES_PER_PROBE = 5;
/** Share of cells that host a herd (before the habitat test, which most cells fail). */
export const HERD_CELL_OCCUPANCY = 0.7;
/** Herd state (heading, mode) is redrawn per cell every this many seconds of sim time. */
export const HERD_EPOCH_S = 600;

export const HERD_MAX_SLOPE = 0.15;
export const HERD_MAX_FOREST = 0.4;
export const HERD_MIN_AIRPORT_BLEND = 0.98;
export const HERD_MAX_RIVER_DIST = 600;
/** A site this close to the river channel's edge is the bank, not the channel, m. */
export const HERD_BANK_MARGIN = 45;
/** A lake shore: ground within this height of a lake's level, m. */
export const LAKE_SHORE_HEIGHT = 8;
/** Distance between the slope samples, m (the land-cover landform scale). */
const SLOPE_STEP = 30;

/** Fresh salt for every random draw of the fauna (never shared with terrain or vegetation). */
const HABITAT_SALT = 0x0fa1a5e7;

/** Terrain reads for the fauna, counted (calls = terrainHeight-equivalent samples since the last reset). */
export interface FaunaTerrain {
  sample(north: number, east: number, out: TerrainSample): TerrainSample;
  /** Surface (ground or water) elevation MSL, m. */
  height(north: number, east: number): number;
  calls: number;
}

/** The real terrain, counted. */
export function countingTerrain(): FaunaTerrain {
  const t: FaunaTerrain = {
    calls: 0,
    sample(n, e, out) {
      t.calls++;
      return sampleTerrain(n, e, out);
    },
    height(n, e) {
      t.calls++;
      return terrainHeight(n, e);
    },
  };
  return t;
}

/** Uniform [0, 1) draw k of a habitat cell. */
export function cellRandom(ci: number, cj: number, k: number): number {
  return hashU32(hash2i(ci ^ HABITAT_SALT, cj) + Math.imul(k + 1, 0x9e3779b9)) / 4294967296;
}

/** Cell of a horizontal position (north -> ci, east -> cj). */
export const cellIndex = (m: number): number => Math.floor(m / HABITAT_CELL);

/** A probed herd site. */
export interface HabitatSite {
  ci: number;
  cj: number;
  north: number;
  east: number;
  /** Ground elevation MSL at the site, m. */
  ground: number;
  /** Roster entry index of the species. */
  entry: number;
  /** Members. */
  size: number;
  /** Terrain samples the probe took. */
  samples: number;
}

export function makeSite(): HabitatSite {
  return { ci: 0, cj: 0, north: 0, east: 0, ground: 0, entry: -1, size: 0, samples: 0 };
}

const S = makeSample();
const N = makeSample();
const biome = makeBiome();

/** Why a point is not herd ground (for tests and the dev overlay); '' when it is. */
export type HerdGroundVerdict = '' | 'airfield' | 'approach' | 'water' | 'bank' | 'slope' | 'treeline' | 'forest' | 'dry';

/**
 * Herd-ground test at a point: SAMPLES_PER_PROBE terrain samples through `terrain`. Writes the ground height to
 * `ground.h` when it passes.
 */
export function herdGround(north: number, east: number, terrain: FaunaTerrain, ground?: { h: number }): HerdGroundVerdict {
  const s = terrain.sample(north, east, S);
  if (s.airportBlend <= HERD_MIN_AIRPORT_BLEND) return 'airfield';
  if (s.approach > 0) return 'approach';
  const water = Math.max(s.standing, s.river);
  if (s.ground < water + 0.3) return 'water';
  if (s.riverHalfWidth > 0 && s.riverDist < s.riverHalfWidth + HERD_BANK_MARGIN) return 'bank';
  const lakeShore = s.standing > SEA_LEVEL && s.ground - s.standing < LAKE_SHORE_HEIGHT;
  if (!(s.riverDist < HERD_MAX_RIVER_DIST) && !lakeShore) return 'dry';
  // Slope over the land-cover landform scale (as coverShape measures it).
  const he = terrain.sample(north, east + SLOPE_STEP, N).ground;
  const hw = terrain.sample(north, east - SLOPE_STEP, N).ground;
  const hn = terrain.sample(north + SLOPE_STEP, east, N).ground;
  const hs = terrain.sample(north - SLOPE_STEP, east, N).ground;
  const ge = (he - hw) / (2 * SLOPE_STEP);
  const gn = (hn - hs) / (2 * SLOPE_STEP);
  if (Math.hypot(ge, gn) >= HERD_MAX_SLOPE) return 'slope';
  if (s.ground >= treeLine(north, east)) return 'treeline';
  const up = 1 / Math.sqrt(1 + ge * ge + gn * gn);
  computeBiome(north, east, s, up, biome, -gn * up);
  if (biome.forest >= HERD_MAX_FOREST) return 'forest';
  if (ground) ground.h = s.ground;
  return '';
}

const groundOut = { h: 0 };

/**
 * Layer-1 herd entries of a roster (indices), cached per roster: role 'herd', not ambient: false (solo agents and
 * showcase-only species are never streamed), and habitat 'waterside' or absent (the layer-2 kinds are placed by
 * probeCell). For the Cretaceous roster this is [0], the Edmontosaurus, exactly as before inc 2b.
 */
const herdEntriesCache = new WeakMap<FaunaRoster, number[]>();
export function herdEntries(roster: FaunaRoster): number[] {
  let list = herdEntriesCache.get(roster);
  if (!list) {
    list = [];
    roster.entries.forEach((e, i) => e.role === 'herd' && e.ambient !== false && (e.habitat === undefined || e.habitat === 'waterside') && list!.push(i));
    herdEntriesCache.set(roster, list);
  }
  return list;
}

/**
 * Candidate k of a cell. Water draws the herds, so most candidates sit beside the river (a random centreline
 * point inside the cell, offset across the flow) or on a lake shore; the rest are uniform in the cell.
 */
function candidate(ci: number, cj: number, k: number, out: { n: number; e: number }): void {
  const n0 = ci * HABITAT_CELL;
  const e0 = cj * HABITAT_CELL;
  const r0 = cellRandom(ci, cj, 10 + 3 * k);
  const r1 = cellRandom(ci, cj, 11 + 3 * k);
  const r2 = cellRandom(ci, cj, 12 + 3 * k);
  const kind = k % 3;
  if (kind !== 2) {
    // River: the centreline points inside this cell (the densified line is ~1.4k points; scanned once per probe).
    const rv = hydrology.river;
    let count = 0;
    for (let i = 0; i < rv.north.length; i++) {
      const pn = rv.north[i] - n0;
      const pe = rv.east[i] - e0;
      if (pn >= 0 && pn < HABITAT_CELL && pe >= 0 && pe < HABITAT_CELL) count++;
    }
    if (count > 0) {
      let pick = Math.floor(r0 * count);
      for (let i = 0; i < rv.north.length; i++) {
        const pn = rv.north[i] - n0;
        const pe = rv.east[i] - e0;
        if (!(pn >= 0 && pn < HABITAT_CELL && pe >= 0 && pe < HABITAT_CELL)) continue;
        if (pick-- > 0) continue;
        // Across the flow (from the neighbouring points), on a random bank, 70-520 m out.
        const a = Math.max(0, i - 1);
        const b = Math.min(rv.north.length - 1, i + 1);
        const tn = rv.north[b] - rv.north[a];
        const te = rv.east[b] - rv.east[a];
        const tl = Math.hypot(tn, te) || 1;
        const side = r1 < 0.5 ? -1 : 1;
        const off = rv.halfWidth[i] + 70 + 450 * r2;
        out.n = rv.north[i] + (side * -te * off) / tl;
        out.e = rv.east[i] + (side * tn * off) / tl;
        return;
      }
    }
    // Lake shores in this cell: a point just outside the shoreline ellipse.
    const lakes = hydrology.lakes;
    for (let li = 0; li < lakes.length; li++) {
      const l = lakes[li];
      if (l.north + l.bound < n0 || l.north - l.bound > n0 + HABITAT_CELL || l.east + l.bound < e0 || l.east - l.bound > e0 + HABITAT_CELL) continue;
      const ang = 2 * Math.PI * r0;
      const ra = l.radiusA * (1.02 + 0.2 * r2);
      const rb = l.radiusB * (1.02 + 0.2 * r2);
      const ca = Math.cos(l.rotation);
      const sa = Math.sin(l.rotation);
      const x = ra * Math.cos(ang);
      const y = rb * Math.sin(ang);
      out.n = l.north + x * ca - y * sa;
      out.e = l.east + x * sa + y * ca;
      return;
    }
  }
  out.n = n0 + HABITAT_CELL * (0.1 + 0.8 * r0);
  out.e = e0 + HABITAT_CELL * (0.1 + 0.8 * r1);
}

const cand = { n: 0, e: 0 };

/**
 * Probe a habitat cell for a herd site (deterministic per cell). Returns false when no herd lives here. Takes at
 * most MAX_SITE_PROBES * SAMPLES_PER_PROBE terrain samples (counted in out.samples and terrain.calls).
 */
export function probeHabitatCell(ci: number, cj: number, roster: FaunaRoster, terrain: FaunaTerrain, out: HabitatSite): boolean {
  out.ci = ci;
  out.cj = cj;
  out.samples = 0;
  out.entry = -1;
  const entries = herdEntries(roster);
  if (entries.length === 0) return false;
  if (cellRandom(ci, cj, 0) > HERD_CELL_OCCUPANCY) return false;
  // Species by weight among the herd entries.
  let total = 0;
  for (const i of entries) total += roster.entries[i].weight;
  let pick = cellRandom(ci, cj, 1) * total;
  let entry = entries[entries.length - 1];
  for (const i of entries) {
    pick -= roster.entries[i].weight;
    if (pick < 0) {
      entry = i;
      break;
    }
  }
  const before = terrain.calls;
  for (let k = 0; k < MAX_SITE_PROBES; k++) {
    candidate(ci, cj, k, cand);
    const v = herdGround(cand.n, cand.e, terrain, groundOut);
    if (v === '') {
      const e = roster.entries[entry];
      out.north = cand.n;
      out.east = cand.e;
      out.ground = groundOut.h;
      out.entry = entry;
      out.size = e.groupMin + Math.floor(cellRandom(ci, cj, 2) * (e.groupMax - e.groupMin + 1));
      out.samples = terrain.calls - before;
      return true;
    }
  }
  out.samples = terrain.calls - before;
  return false;
}

// ---------------------------------------------------------------------------------------------------------------
// Layer 2 (inc 2b): plains herds, Triceratops and Alamosaurus away from the water

/** Fresh salts (never shared with terrain, vegetation or cellRandom's draws, whose k grows without bound). */
const LAYER2_SALT = 0x2c7a95b3;
const REX_SALT = 0x7e3c1d09;

/** Uniform [0, 1) draw k of a cell's layer-2 group (species pick 0, candidates 1-8, size 9, edge acceptance 10+). */
export function layer2Random(ci: number, cj: number, k: number): number {
  return hashU32(hash2i(ci ^ LAYER2_SALT, cj) + Math.imul(k + 1, 0x9e3779b9)) / 4294967296;
}

/** Uniform [0, 1) draw k of a cell's roaming T. rex (0 occupancy, 1 range, 2 bearing, 3 seed). */
export function rexRandom(ci: number, cj: number, k: number): number {
  return hashU32(hash2i(ci ^ REX_SALT, cj) + Math.imul(k + 1, 0x9e3779b9)) / 4294967296;
}

/** Layer-2 candidates per cell at most (uniform in the cell), within what is left of the cell's 40 reads. */
export const LAYER2_PROBES = 4;
/** A cell's total terrain reads (layers 1 + 2) at most. */
export const CELL_READS = 40;
/** Layer-2 sites keep this far from the showcase anchors (river herd, Triceratops, Alamosaurus), m. */
export const QUIET_ANCHOR_M = 2500;
/** ... and this far from the safari's first-minute path (the start to safariAt(75)), m. */
export const QUIET_PATH_M = 1500;
/** The roaming T. rex keeps this far from the safari footprint (the path and the river herd), m. */
export const REX_QUIET_M = 6000;

/** Layer-2 predicate thresholds (agent choices, plan section 2). */
export const LAYER2 = Object.freeze({
  maxSand: 0.3,
  plain: Object.freeze({ maxSlope: 0.15, maxGround: 450, maxForest: 0.3, minMoisture: 0.5, riverDist: 2000 }),
  open: Object.freeze({ maxSlope: 0.15, maxGround: 700, maxForest: 0.35 }),
  woodland: Object.freeze({ maxSlope: 0.2, minGround: 120, edgeMin: 0.08, edgeMax: 0.55, minUpland: 0.3, lowland: 0.2, lowlandAccept: 0.4 }),
});

/** The safari's first-minute path, start -> safariAt(75) (computed once). */
const PATH_A = safariStartNed();
const PATH_B = (() => {
  const p = safariAt(75);
  return { north: p.north, east: p.east };
})();

/** Squared distance from (n, e) to the segment a -> b. */
function segD2(n: number, e: number, an: number, ae: number, bn: number, be: number): number {
  const sn = bn - an;
  const se = be - ae;
  const l2 = sn * sn + se * se;
  let t = l2 > 0 ? ((n - an) * sn + (e - ae) * se) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dn = n - (an + t * sn);
  const de = e - (ae + t * se);
  return dn * dn + de * de;
}

const d2 = (n: number, e: number, p: { north: number; east: number }): number => (n - p.north) * (n - p.north) + (e - p.east) * (e - p.east);

/** True inside the showcase quiet zone (layer 2 places nothing there). */
export function inQuietZone(n: number, e: number): boolean {
  const a2 = QUIET_ANCHOR_M * QUIET_ANCHOR_M;
  if (d2(n, e, RIVER_HERD_SITE) < a2 || d2(n, e, TRICERATOPS_GROUP) < a2 || d2(n, e, ALAMOSAURUS_STAND) < a2) return true;
  return segD2(n, e, PATH_A.north, PATH_A.east, PATH_B.north, PATH_B.east) < QUIET_PATH_M * QUIET_PATH_M;
}

/** Distance from (n, e) to the safari footprint (the first-minute path and the river herd site), m. */
export function safariFootprintDist(n: number, e: number): number {
  return Math.sqrt(Math.min(segD2(n, e, PATH_A.north, PATH_A.east, PATH_B.north, PATH_B.east), d2(n, e, RIVER_HERD_SITE)));
}

/**
 * The Araucaria share of placement.ts (src/world/terrain/vegetation/placement.ts, `upland[k]`), copied here (not
 * imported from the vegetation): clamp01((ground - 380) / 500 + 1.2 * clamp01((0.97 - up) / 0.08) - 0.05).
 */
export function uplandIndex(ground: number, up: number): number {
  const c = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
  return c((ground - 380) / 500 + 1.2 * c((0.97 - up) / 0.08) - 0.05);
}

/** What a layer-2 probe measured at its last candidate (for tests and the dev overlay). */
export interface Layer2Ground {
  ground: number;
  slope: number;
  forest: number;
  moisture: number;
  sand: number;
  upland: number;
  riverDist: number;
  standing: number;
}
export const layer2Ground: Layer2Ground = { ground: 0, slope: 0, forest: 0, moisture: 0, sand: 0, upland: 0, riverDist: 0, standing: 0 };

/** Why a point is not ground of a layer-2 kind; '' when it is ('edge': a lowland woodland edge left to the draw). */
export type Layer2Verdict = HerdGroundVerdict | 'sand' | 'high' | 'low' | 'edge';

/**
 * Layer-2 habitat test of `kind` at a point: up to SAMPLES_PER_PROBE terrain samples (the point first, so every
 * one-read rejection costs 1), the shared layer-1 exclusions (airfield, approach, water, bank, tree line) plus
 * sand < 0.3 (no beach, no volcanic ash), then the kind's own predicate. `edgeDraw` (a [0, 1) draw) decides whether
 * a lowland woodland edge (upland < 0.2) is accepted (< lowlandAccept), which biases Alamosaurus to the uplands.
 * Fills layer2Ground with what it measured.
 */
export function layer2Verdict(kind: HabitatKind, north: number, east: number, terrain: FaunaTerrain, edgeDraw: number): Layer2Verdict {
  const L = LAYER2;
  const s = terrain.sample(north, east, S);
  const g = layer2Ground;
  g.ground = s.ground;
  g.riverDist = s.riverDist;
  g.standing = s.standing;
  g.slope = g.forest = g.moisture = g.sand = g.upland = 0;
  if (s.airportBlend <= HERD_MIN_AIRPORT_BLEND) return 'airfield';
  if (s.approach > 0) return 'approach';
  if (s.ground < Math.max(s.standing, s.river) + 0.3) return 'water';
  if (s.riverHalfWidth > 0 && s.riverDist < s.riverHalfWidth + HERD_BANK_MARGIN) return 'bank';
  if (s.ground >= treeLine(north, east)) return 'treeline';
  if (kind === 'plain' && s.ground >= L.plain.maxGround) return 'high';
  if (kind === 'open' && s.ground >= L.open.maxGround) return 'high';
  if (kind === 'woodland' && s.ground <= L.woodland.minGround) return 'low';
  // Slope over the land-cover landform scale (as herdGround measures it).
  const he = terrain.sample(north, east + SLOPE_STEP, N).ground;
  const hw = terrain.sample(north, east - SLOPE_STEP, N).ground;
  const hn = terrain.sample(north + SLOPE_STEP, east, N).ground;
  const hs = terrain.sample(north - SLOPE_STEP, east, N).ground;
  const ge = (he - hw) / (2 * SLOPE_STEP);
  const gn = (hn - hs) / (2 * SLOPE_STEP);
  const slope = Math.sqrt(ge * ge + gn * gn);
  const up = 1 / Math.sqrt(1 + ge * ge + gn * gn);
  computeBiome(north, east, s, up, biome, -gn * up);
  g.slope = slope;
  g.forest = biome.forest;
  g.moisture = biome.moisture;
  g.sand = biome.sand;
  g.upland = uplandIndex(s.ground, up);
  if (biome.sand >= L.maxSand) return 'sand';
  if (kind === 'plain') {
    if (slope >= L.plain.maxSlope) return 'slope';
    if (biome.forest >= L.plain.maxForest) return 'forest';
    if (!(biome.moisture >= L.plain.minMoisture || s.riverDist < L.plain.riverDist || s.standing > SEA_LEVEL)) return 'dry';
    return '';
  }
  if (kind === 'open') {
    if (slope >= L.open.maxSlope) return 'slope';
    if (biome.forest >= L.open.maxForest) return 'forest';
    return '';
  }
  if (kind === 'woodland') {
    const W = L.woodland;
    if (slope >= W.maxSlope) return 'slope';
    const edge = biome.forest >= W.edgeMin && biome.forest < W.edgeMax;
    const openUpland = g.upland >= W.minUpland && biome.forest < W.edgeMin;
    if (!edge && !openUpland) return 'forest';
    if (!openUpland && g.upland < W.lowland && !(edgeDraw < W.lowlandAccept)) return 'edge';
    return '';
  }
  return 'dry';
}

/** Layer-2 entries of a roster (role herd, habitat plain / open / woodland, occupancy > 0), cached per roster. */
const layer2Cache = new WeakMap<FaunaRoster, number[]>();
export function layer2Entries(roster: FaunaRoster): number[] {
  let list = layer2Cache.get(roster);
  if (!list) {
    list = [];
    roster.entries.forEach((e, i) => e.role === 'herd' && e.ambient !== false && (e.habitat === 'plain' || e.habitat === 'open' || e.habitat === 'woodland') && (e.occupancy ?? 0) > 0 && list!.push(i));
    layer2Cache.set(roster, list);
  }
  return list;
}

/** The layer-2 entry a cell draws (by cumulative occupancy, roster order), or -1 for none. No terrain reads. */
export function layer2Pick(ci: number, cj: number, roster: FaunaRoster): number {
  const u = layer2Random(ci, cj, 0);
  let acc = 0;
  for (const i of layer2Entries(roster)) {
    acc += roster.entries[i].occupancy ?? 0;
    if (u < acc) return i;
  }
  return -1;
}

/**
 * Probe a habitat cell, both layers (deterministic per cell): layer 1 (probeHabitatCell, unchanged) first; when it
 * finds nothing, the cell's layer-2 pick, if any, at up to LAYER2_PROBES uniform candidates outside the showcase
 * quiet zone, within CELL_READS reads for the cell in all (out.samples counts both layers).
 */
export function probeCell(ci: number, cj: number, roster: FaunaRoster, terrain: FaunaTerrain, out: HabitatSite): boolean {
  if (probeHabitatCell(ci, cj, roster, terrain, out)) return true;
  const entry = layer2Pick(ci, cj, roster);
  if (entry < 0) return false;
  const e: FaunaRosterEntry = roster.entries[entry];
  const kind = e.habitat as HabitatKind;
  const before = terrain.calls - out.samples;
  const n0 = ci * HABITAT_CELL;
  const e0 = cj * HABITAT_CELL;
  const probes = Math.min(LAYER2_PROBES, Math.floor((CELL_READS - out.samples) / SAMPLES_PER_PROBE));
  for (let k = 0; k < probes; k++) {
    const n = n0 + HABITAT_CELL * (0.1 + 0.8 * layer2Random(ci, cj, 1 + 2 * k));
    const ea = e0 + HABITAT_CELL * (0.1 + 0.8 * layer2Random(ci, cj, 2 + 2 * k));
    if (inQuietZone(n, ea)) continue;
    if (layer2Verdict(kind, n, ea, terrain, layer2Random(ci, cj, 10 + k)) !== '') continue;
    out.north = n;
    out.east = ea;
    out.ground = layer2Ground.ground;
    out.entry = entry;
    out.size = e.groupMin + Math.floor(layer2Random(ci, cj, 9) * (e.groupMax - e.groupMin + 1));
    out.samples = terrain.calls - before;
    return true;
  }
  out.samples = terrain.calls - before;
  return false;
}

// ---------------------------------------------------------------------------------------------------------------
// Ambient kettles (inc 2b): the Pteranodon's water bias

/** Near water for a kettle: within 2 km of the river's edge, in a lake zone, or on the coastal strip below 40 m. */
export function kettleNearWater(s: TerrainSample): boolean {
  return s.riverDist - s.riverHalfWidth < 2000 || s.standing > SEA_LEVEL || s.ground < 40;
}

/**
 * The ambient-kettle entry for a [0, 1) draw `u` among `entries` (flyer entries): by roster weight, x waterAffinity
 * near water and / it elsewhere (absent: x 1).
 */
export function kettleEntry(roster: FaunaRoster, entries: readonly number[], u: number, nearWater: boolean): number {
  let total = 0;
  for (const i of entries) total += kettleWeight(roster.entries[i], nearWater);
  let pick = u * total;
  let entry = entries[entries.length - 1];
  for (const i of entries) {
    pick -= kettleWeight(roster.entries[i], nearWater);
    if (pick < 0) {
      entry = i;
      break;
    }
  }
  return entry;
}

function kettleWeight(e: FaunaRosterEntry, nearWater: boolean): number {
  const a = e.waterAffinity !== undefined && e.waterAffinity > 0 ? e.waterAffinity : 1;
  return nearWater ? e.weight * a : e.weight / a;
}
