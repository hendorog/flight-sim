// Where the herds live (Deep Time): 2 km habitat cells around the camera, each hashed once (new salt) into "a herd
// lives here" or not, and probed for a valid site with at most MAX_SITE_PROBES candidates (5 terrain samples each,
// <= 40 per cell). Pure, three-free and deterministic: the same cell always yields the same site.
//
// A herd site (Edmontosaurus) needs: gentle ground (slope < 0.15), little forest (< 0.4), dry land, clear of the
// airfield (airportBlend > 0.98) and its approach corridors (approach == 0), below the tree line, and water close
// by: within 600 m of the river or on a lake shore.
//
// All terrain reads go through a FaunaTerrain, which counts them (the fauna's hard cap is 200 per frame).

import { SEA_LEVEL, hydrology, makeSample, sampleTerrain, terrainHeight, type TerrainSample } from '../terrain/heightfield';
import { computeBiome, makeBiome, treeLine } from '../terrain/biome';
import { hash2i } from '../terrain/noise';
import { hashU32 } from '../../physics/weather/random';
import type { FaunaRoster } from './types';

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

/** Herd entries of a roster (indices), cached per roster. */
const herdEntriesCache = new WeakMap<FaunaRoster, number[]>();
function herdEntries(roster: FaunaRoster): number[] {
  let list = herdEntriesCache.get(roster);
  if (!list) {
    list = [];
    roster.entries.forEach((e, i) => e.role === 'herd' && list!.push(i));
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
