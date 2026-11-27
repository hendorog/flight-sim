// Cleared right-of-way swaths under high-tension power transmission lines, cleared pads around switching substations,
// radio masts and hydro dams, and impounded hydro-reservoir basin masks. Computed once on the main thread
// (TerrainSystem.init -> infrastructureClearings) and broadcast in WorkerSetup to the tile and tree workers so ground
// forest cover, canopy shells, farmland, plantation stands, hedgerow trees, shelterbelts, clipped hedges and riverbed
// boulders all respect the power-line corridors and impounded reservoirs identically.
//
// Pure and three.js-free (runs in the workers). When unset (`null`), every query is a single pointer check returning
// the untouched world's exact values (`corridorWoodFactor === 1`, `corridorFieldFactor === 1`,
// `inCorridorClearZone === false`, `reservoirLevelAt === -Infinity`).

import { PolylineIndex, type PolylineNear } from './hydrology';

export interface ReservoirClearing {
  originN: number;
  originE: number;
  dn: number;
  de: number;
  cell: number;
  uMin: number;
  vMin: number;
  vMax: number;
  rows: number;
  cols: number;
  waterLevel: number;
  archSagitta: number;
  leftSpan: number;
  rightSpan: number;
  /** 1 where flooded (`ground < waterLevel`), 2 on the 1-cell shoreline margin, 0 outside. */
  mask: Uint8Array;
  minN: number;
  maxN: number;
  minE: number;
  maxE: number;
}

export interface CorridorClearings {
  /** Polylines of high-tension transmission corridors (one per connected corridor). */
  corridors: { north: number[]; east: number[] }[];
  /** Circular tree-free pads around substations, mast bases, guy-wire anchors and dam structures: [north, east, radiusM]. */
  pads: [number, number, number][];
  /** Impounded hydro-dam reservoir basins, if any exist in this seed. */
  reservoirs?: ReservoirClearing[];
}

/** Tree-free half-width on each side of a high-tension transmission line centreline, m (44 m total swath). */
export const CORRIDOR_HALF_WIDTH = 22;
/** Woodland / plantation edge fade beyond CORRIDOR_HALF_WIDTH (and beyond each circular pad / reservoir shore), m. */
export const CORRIDOR_WOOD_FADE = 14;

const INDEX_CELL = 128;
const INDEX_REACH = CORRIDOR_HALF_WIDTH + CORRIDOR_WOOD_FADE + 6;

interface CompiledClearings {
  raw: CorridorClearings;
  index: PolylineIndex | null;
  pads: Float64Array; // [north, east, radius] triples
  padMinN: number;
  padMaxN: number;
  padMinE: number;
  padMaxE: number;
  reservoirs: ReservoirClearing[];
}

let active: CompiledClearings | null = null;
const nearScratch: PolylineNear = { line: 0, seg: 0, t: 0, u: 0, dist: Infinity, side: 0 };

export function setCorridorClearings(c: CorridorClearings | null): void {
  const reservoirs = c?.reservoirs ?? [];
  if (!c || (c.corridors.length === 0 && c.pads.length === 0 && reservoirs.length === 0)) {
    active = null;
    return;
  }
  const lines = c.corridors
    .filter((l) => l.north.length >= 2)
    .map((l) => ({ north: Float64Array.from(l.north), east: Float64Array.from(l.east) }));
  const index = lines.length > 0 ? new PolylineIndex(lines, INDEX_REACH, INDEX_CELL) : null;

  const pads = new Float64Array(c.pads.length * 3);
  let minN = Infinity, maxN = -Infinity, minE = Infinity, maxE = -Infinity;
  c.pads.forEach(([n, e, r], i) => {
    pads[i * 3] = n;
    pads[i * 3 + 1] = e;
    pads[i * 3 + 2] = r;
    const reach = r + CORRIDOR_WOOD_FADE + 4;
    if (n - reach < minN) minN = n - reach;
    if (n + reach > maxN) maxN = n + reach;
    if (e - reach < minE) minE = e - reach;
    if (e + reach > maxE) maxE = e + reach;
  });

  active = { raw: c, index, pads, padMinN: minN, padMaxN: maxN, padMinE: minE, padMaxE: maxE, reservoirs };
}

export function corridorClearings(): CorridorClearings | null {
  return active ? active.raw : null;
}

const smooth = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Invert curvilinear `(u, v)` back to continuous grid step `fk` (`k <= 0` upstream of the dam wall). */
function reservoirGridCoords(res: ReservoirClearing, north: number, east: number): { fk: number; fc: number; uWall: number; uRaw: number; v: number } {
  const dN = north - res.originN;
  const dE = east - res.originE;
  const uRaw = dN * res.dn + dE * res.de;
  const v = -dN * res.de + dE * res.dn;
  let uWall = 0;
  if (res.archSagitta > 0) {
    const vc = 0.5 * (res.rightSpan - res.leftSpan);
    const hs = Math.max(1, 0.5 * (res.leftSpan + res.rightSpan));
    const xi = Math.max(-1, Math.min(1, (v - vc) / hs));
    uWall = -res.archSagitta * (1 - xi * xi);
  }
  // 2-step Newton inversion of `u(k) = uWall * exp(k * cell / 80) + k * cell` for `uRaw <= uWall`.
  let uShifted = uRaw - uWall;
  if (uWall !== 0 && uRaw < uWall) {
    for (let it = 0; it < 2; it++) {
      const decay = Math.exp(Math.min(0, uShifted) / 90);
      const f = uWall * decay + uShifted - uRaw;
      const df = 1 + (uWall / 90) * decay;
      uShifted -= f / Math.max(0.35, df);
    }
  }
  return { fk: uShifted / res.cell, fc: v / res.cell, uWall, uRaw, v };
}

/**
 * Impounded reservoir water surface elevation MSL at `(north, east)`, or `-Infinity` outside every reservoir.
 */
export function reservoirLevelAt(north: number, east: number): number {
  if (!active || active.reservoirs.length === 0) return -Infinity;
  let best = -Infinity;
  for (const res of active.reservoirs) {
    if (north < res.minN || north > res.maxN || east < res.minE || east > res.maxE) continue;
    const { fk, fc, uRaw, uWall } = reservoirGridCoords(res, north, east);
    if (uRaw > uWall + 1.5) continue;
    const r = Math.round(fk - res.uMin);
    const c = Math.round(fc - res.vMin);
    if (r < 0 || r >= res.rows || c < 0 || c >= res.cols) continue;
    if (res.mask[r * res.cols + c] === 1 && res.waterLevel > best) {
      best = res.waterLevel;
    }
  }
  return best;
}

/** Signed distance beyond the cleared edge (<= 0 inside the tree-free zone, > 0 outside), m. */
function distanceBeyondClearing(north: number, east: number): number {
  if (!active) return Infinity;
  let beyond = Infinity;
  if (active.index && active.index.nearest(north, east, nearScratch)) {
    beyond = nearScratch.dist - CORRIDOR_HALF_WIDTH;
  }
  if (north >= active.padMinN && north <= active.padMaxN && east >= active.padMinE && east <= active.padMaxE) {
    const p = active.pads;
    for (let i = 0; i < p.length; i += 3) {
      const d = Math.hypot(north - p[i], east - p[i + 1]) - p[i + 2];
      if (d < beyond) beyond = d;
    }
  }
  for (const res of active.reservoirs) {
    if (north < res.minN || north > res.maxN || east < res.minE || east > res.maxE) continue;
    const { fk, fc, uRaw, uWall } = reservoirGridCoords(res, north, east);
    if (uRaw > uWall + res.cell) continue;
    const r = Math.round(fk - res.uMin);
    const c = Math.round(fc - res.vMin);
    if (r < 0 || r >= res.rows || c < 0 || c >= res.cols) continue;
    const m = res.mask[r * res.cols + c];
    if (m === 1) return -res.cell;
    if (m === 2) {
      beyond = Math.min(beyond, -2);
    } else {
      // Check 1-cell neighbourhood for smooth woodland fade just above the shoreline rim.
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const nr = r + dr;
          const nc = c + dc;
          if (nr >= 0 && nr < res.rows && nc >= 0 && nc < res.cols && res.mask[nr * res.cols + nc] >= 1) {
            const centerK = res.uMin + nr;
            const centerC = res.vMin + nc;
            const distCells = Math.hypot(fk - centerK, fc - centerC) - 0.55;
            const d = Math.max(0.5, distCells * res.cell);
            if (d < beyond) beyond = d;
          }
        }
      }
    }
  }
  return beyond;
}

/** 0 inside a power-line wayleave, substation/mast/dam pad or hydro reservoir, rising smoothly to 1 over CORRIDOR_WOOD_FADE. */
export function corridorWoodFactor(north: number, east: number): number {
  if (!active) return 1;
  const beyond = distanceBeyondClearing(north, east);
  if (beyond >= CORRIDOR_WOOD_FADE) return 1;
  if (beyond <= 0) return 0;
  return smooth(0, CORRIDOR_WOOD_FADE, beyond);
}

/** 0 inside an impounded hydro reservoir or dam/substation pad (keeps crop fields off drowned valley floors), 1 outside. */
export function corridorFieldFactor(north: number, east: number): number {
  if (!active || active.reservoirs.length === 0) return 1;
  for (const res of active.reservoirs) {
    if (north < res.minN || north > res.maxN || east < res.minE || east > res.maxE) continue;
    const { fk, fc, uRaw, uWall } = reservoirGridCoords(res, north, east);
    if (uRaw > uWall + res.cell) continue;
    const r = Math.round(fk - res.uMin);
    const c = Math.round(fc - res.vMin);
    if (r >= 0 && r < res.rows && c >= 0 && c < res.cols && res.mask[r * res.cols + c] >= 1) {
      return 0;
    }
  }
  return 1;
}

/** True where no tree, shelterbelt or clipped hedge may stand: within CORRIDOR_HALF_WIDTH (+ margin) of a line, pad or reservoir. */
export function inCorridorClearZone(north: number, east: number, margin = 0): boolean {
  if (!active) return false;
  return distanceBeyondClearing(north, east) < margin;
}
