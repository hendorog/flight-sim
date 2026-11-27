// Algorithmic siting of regional high-tension power transmission corridors (substations, lattice suspension & strain
// pylons, catenary conductor spans) and radio / telecommunications masts (tall guyed hilltop broadcast masts and
// self-supporting lattice microwave/cellular relay towers) for any world seed.
//
// Pure and deterministic (no three.js, no DOM):
//   - Keyed on the current worldSeed(), era() and live terrain height function;
//   - Returns empty lists outside the present day (Deep Time / Cretaceous stays untouched);
//   - Respects every airfield (home + seeded generated airfields), traffic circuit, 1:35 approach obstacle-limitation
//     funnel, lake, river channel, snowline, town and village keep-out in every seed.

import { AIRPORT, runwayCoords } from '../../core/world';
import { airfields, fieldCoords, generatedAirfields } from '../airfields';
import { isPresent } from '../era/eraState';
import type { CorridorClearings, ReservoirClearing } from '../terrain/corridorMask';
import { hydrology, makeSample, sampleTerrain, snowLine, terrainHeight } from '../terrain/heightfield';
import { onRoadVerge, villageSites } from '../terrain/roads';
import { seeded, worldSeed } from '../worldSeed';
import {
  damToReservoirClearing,
  damWallCenterU,
  planHydroDams,
  type HydroDamKind,
  type HydroDamSite,
  type ReservoirGrid,
} from './hydroDamPlan';
import { rng } from './noise';
import { findTownSite, type HeightFn } from './valley';
export type { HeightFn, HydroDamKind, HydroDamSite, ReservoirGrid };

const WATER_LEVEL = 1;

export type PylonKind = 'suspension' | 'strain';
export type MastKind = 'guyed' | 'lattice';

export interface SubstationSite {
  id: string;
  north: number;
  east: number;
  elevation: number;
  /** True heading (rad clockwise from north) of the yard's long axis. */
  heading: number;
  width: number;
  depth: number;
}

export interface PylonSite {
  index: number;
  corridor: number;
  kind: PylonKind;
  north: number;
  east: number;
  /** Terrain elevation MSL at tower centre, m. */
  ground: number;
  /** Tower peak height above `ground`, m (standard 34 m; up to 54 m at river/crest crossings). */
  height: number;
  /** True heading (rad clockwise from north) perpendicular to the cross-arms (bisector at angle towers). */
  heading: number;
  /** True when flanking a river crossing or tall navigation span (receives top red L-810 obstruction light). */
  obstructionLit: boolean;
}

export interface ConductorSpan {
  corridor: number;
  from: number;
  to: number;
  length: number;
  /** Midspan catenary sag, m. */
  sag: number;
  /** High-visibility aviation-orange marker spheres along the top earth wire (river crossings & long/high spans). */
  markerBalls: boolean;
  /** Minimum height of the lowest phase conductor above underlying ground/water across the span, m. */
  minClearance: number;
}

export interface RadioMastSite {
  id: string;
  kind: MastKind;
  north: number;
  east: number;
  ground: number;
  /** Mast tip height above `ground`, m (guyed broadcast: ~108-146 m; lattice relay: ~40-66 m). */
  height: number;
  /** Topographic prominence above surrounding 1.8 km ring, m. */
  prominence: number;
  /** Structural orientation (rad clockwise from north). */
  heading: number;
  /** True bearings toward linked relay masts / town for aiming microwave dishes. */
  dishBearings: number[];
  /** Guy-anchor ground radius for guyed masts (0 for self-supporting lattice towers), m. */
  anchorRadius: number;
}

export interface SubstationConnection {
  substation: number;
  pylon: number;
}

export interface InfrastructurePlan {
  dams: HydroDamSite[];
  substations: SubstationSite[];
  pylons: PylonSite[];
  spans: ConductorSpan[];
  terminalConnections: SubstationConnection[];
  masts: RadioMastSite[];
}

/** Nominal reference height (m) of the unit pylon geometry, and lowest cross-arm insulator fraction of `height`. */
export const PYLON_REF_HEIGHT = 34;
export const PYLON_LOWEST_INSULATOR_FRAC = 0.54;
const MIN_WIRE_CLEARANCE_M = 12.5;

/**
 * True when an obstacle of `topAGL` metres at `(north, east)` (ground MSL `groundH`) is safely clear of all airfield
 * flat zones, traffic circuits and 1:35 approach/departure obstacle-limitation funnels.
 */
export function obstacleClearOfAirfields(north: number, east: number, groundH: number, topAGL: number): boolean {
  const topMSL = groundH + topAGL;

  // 1. Home airport: circuit box + 8 km 1:35 approach funnels off both ends.
  {
    const { along, across } = runwayCoords(north, east);
    const hl = AIRPORT.runway.length / 2;
    const hw = AIRPORT.runway.width / 2;
    if (Math.abs(along) < hl + AIRPORT.flatMargin + 950 && Math.abs(across) < hw + AIRPORT.flatMargin + 950) return false;
    if (Math.abs(along) < hl + 3600 && Math.abs(across) < 1850) return false;
    const out = Math.abs(along) - hl;
    if (out > 0 && out < 8500) {
      const funnelHalf = 380 + 0.15 * out;
      if (Math.abs(across) < funnelHalf) {
        const limitMSL = AIRPORT.elevation + out / 35 - 20;
        if (topMSL > limitMSL) return false;
      }
    }
  }

  // 2. Seeded generated airfields: circuit box + 5.5 km 1:35 approach funnels.
  for (const f of generatedAirfields()) {
    const rough = Math.hypot(north - f.north, east - f.east);
    if (rough > f.length / 2 + 5800) continue;
    const { along, across } = fieldCoords(f, north, east);
    const hl = f.length / 2;
    const hw = f.width / 2;
    if (Math.abs(along) < hl + f.flatMargin + 550 && Math.abs(across) < hw + f.flatMargin + 550) return false;
    if (Math.abs(along) < hl + 2200 && Math.abs(across) < 950) return false;
    const out = Math.abs(along) - hl;
    if (out > 0 && out < 5500) {
      const funnelHalf = 260 + 0.14 * out;
      if (Math.abs(across) < funnelHalf) {
        const limitMSL = f.elevation + out / 35 - 16;
        if (topMSL > limitMSL) return false;
      }
    }
  }

  return true;
}

/** Distance from point `(n, e)` to segment `(an, ae)-(bn, be)`, m. */
function pointToSegmentDist(n: number, e: number, an: number, ae: number, bn: number, be: number): number {
  const dn = bn - an;
  const de = be - ae;
  const l2 = dn * dn + de * de;
  if (l2 < 1e-6) return Math.hypot(n - an, e - ae);
  const t = Math.max(0, Math.min(1, ((n - an) * dn + (e - ae) * de) / l2));
  return Math.hypot(n - (an + dn * t), e - (ae + de * t));
}

function wrapAngle(a: number): number {
  while (a <= -Math.PI) a += Math.PI * 2;
  while (a > Math.PI) a -= Math.PI * 2;
  return a;
}

/** Smallest unsigned angle between two bearings, rad [0, pi]. */
function angleDiff(a: number, b: number): number {
  return Math.abs(wrapAngle(a - b));
}

/** Tiny binary min-heap on cell indices weighted by `dist`. */
class MinHeap {
  private readonly items: number[] = [];
  constructor(private readonly dist: Float64Array) {}
  get size(): number {
    return this.items.length;
  }
  push(v: number): void {
    const a = this.items;
    a.push(v);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.dist[a[p]] <= this.dist[a[i]]) break;
      const tmp = a[p];
      a[p] = a[i];
      a[i] = tmp;
      i = p;
    }
  }
  pop(): number {
    const a = this.items;
    const top = a[0];
    const last = a.pop()!;
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      const n = a.length;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < n && this.dist[a[l]] < this.dist[a[m]]) m = l;
        if (r < n && this.dist[a[r]] < this.dist[a[m]]) m = r;
        if (m === i) break;
        const tmp = a[m];
        a[m] = a[i];
        a[i] = tmp;
        i = m;
      }
    }
    return top;
  }
}

let cachedKey = '';
let cachedFn: HeightFn | null = null;
let cachedPlan: InfrastructurePlan | null = null;

/**
 * Plan the high-tension power pylon corridors, substations and radio masts for the current world seed and terrain.
 * Cached when called repeatedly with the same `heightAt`, `worldSeed()`, `era()` and `airfields()`.
 */
export function planInfrastructure(heightAt: HeightFn = terrainHeight): InfrastructurePlan {
  if (!isPresent()) {
    return { dams: [], substations: [], pylons: [], spans: [], terminalConnections: [], masts: [] };
  }
  const fields = airfields();
  const key = `${worldSeed()}|${AIRPORT.icao}|${fields.length}|${fields[fields.length - 1]?.code ?? ''}`;
  if (cachedPlan && cachedFn === heightAt && cachedKey === key) return cachedPlan;

  const useRealTerrain = heightAt === terrainHeight;
  const samp = makeSample();
  const rand = rng(seeded(0x51a7e3));

  const slopeAt = (n: number, e: number, step: number): number => {
    const dn = heightAt(n + step, e) - heightAt(n - step, e);
    const de = heightAt(n, e + step) - heightAt(n, e - step);
    return Math.hypot(dn, de) / (2 * step);
  };

  const snowAt = (n: number, e: number): number => (useRealTerrain ? snowLine(n, e) : 2600);
  const town = findTownSite(heightAt);
  const villages = villageSites();

  const clearOfSettlements = (n: number, e: number, townPad: number, villagePad: number): boolean => {
    if (town && Math.hypot(n - town.north, e - town.east) < town.radius + townPad) return false;
    for (const v of villages) {
      if (Math.hypot(n - v.north, e - v.east) < v.radius + villagePad) return false;
    }
    return true;
  };

  // Site 0..2 hydro dams + impounded reservoirs first so power-line routing avoids the new hydro lakes and anchors
  // its generation switchyard directly at the dam powerhouse!
  const dams = planHydroDams(heightAt, clearOfSettlements);
  const damClearings: ReservoirClearing[] = dams.map(damToReservoirClearing);

  const impoundedLevelAt = (n: number, e: number): number => {
    let best = -Infinity;
    for (const res of damClearings) {
      if (n < res.minN || n > res.maxN || e < res.minE || e > res.maxE) continue;
      const dN = n - res.originN;
      const dE = e - res.originE;
      const uRaw = dN * res.dn + dE * res.de;
      const v = -dN * res.de + dE * res.dn;
      const uWall = damWallCenterU(res.leftSpan, res.rightSpan, res.archSagitta, v);
      if (uRaw > uWall + 4) continue;
      let uShift = uRaw - uWall;
      if (uWall !== 0 && uRaw < uWall) {
        for (let it = 0; it < 2; it++) {
          const dec = Math.exp(Math.min(0, uShift) / 90);
          uShift -= (uWall * dec + uShift - uRaw) / Math.max(0.35, 1 + (uWall / 90) * dec);
        }
      }
      const r = Math.round(uShift / res.cell - res.uMin);
      const c = Math.round(v / res.cell - res.vMin);
      if (r >= 0 && r < res.rows && c >= 0 && c < res.cols && res.mask[r * res.cols + c] === 1) {
        if (res.waterLevel > best) best = res.waterLevel;
      }
    }
    return best;
  };

  /**
   * True inside a dam's concrete wall, powerhouse apron or crest keep-out curtain (`u in [-220 .. +52]`, widened past
   * both abutments) so transmission corridors always exit downstream/laterally from the switchyard rather than
   * stringing conductors backwards over the powerhouse roof and dam crest!
   */
  const inDamStructure = (n: number, e: number): boolean => {
    for (const dam of dams) {
      const dn = Math.cos(dam.heading), de = Math.sin(dam.heading);
      const dN = n - dam.north, dE = e - dam.east;
      const u = dN * dn + dE * de;
      const v = -dN * de + dE * dn;
      if (u >= -dam.archSagitta - 220 && u <= 52 && v >= -dam.leftSpan - 320 && v <= dam.rightSpan + 320) return true;
    }
    return false;
  };

  /** Water surface or ground classification: catches sea, natural lakes, impounded hydro reservoirs, oxbows and rivers. */
  const waterCheck = (n: number, e: number): { h: number; wet: boolean; standingLakeOrSea: boolean; riverChannel: boolean; surfaceH: number } => {
    const resLvl = impoundedLevelAt(n, e);
    const damBlocked = inDamStructure(n, e);
    if (!useRealTerrain) {
      const h = heightAt(n, e);
      const sea = h <= WATER_LEVEL + 0.8;
      const impounded = resLvl > h - 0.5;
      return {
        h,
        wet: sea || impounded || damBlocked,
        standingLakeOrSea: sea || impounded || damBlocked,
        riverChannel: false,
        surfaceH: Math.max(h, WATER_LEVEL, impounded ? resLvl : -Infinity),
      };
    }
    sampleTerrain(n, e, samp);
    const sea = samp.ground <= WATER_LEVEL + 0.8;
    const lake = (samp.standing > -1e6 && samp.ground <= samp.standing + 0.9) || resLvl > samp.ground - 0.8;
    const river = samp.river > -1e6 && samp.ground <= samp.river + 0.9;
    const surfaceH = Math.max(
      samp.ground,
      sea ? WATER_LEVEL : -Infinity,
      samp.standing > -1e6 && samp.ground <= samp.standing + 0.9 ? samp.standing : -Infinity,
      resLvl > samp.ground - 0.8 ? resLvl : -Infinity,
      river ? samp.river : -Infinity,
    );
    return {
      h: samp.ground,
      wet: sea || lake || river || damBlocked,
      standingLakeOrSea: sea || lake || damBlocked,
      riverChannel: river && !sea && !lake && !damBlocked,
      surfaceH,
    };
  };

  // Precompute a single 500 m regional terrain & water survey grid over [-27500, +27500] (111 x 111 = 12,321 samples)
  // so prominence, gorge corridor routing (for dams out to 25.2 km) and visibility checks run in ~130 ms!
  const S_MIN = -27500;
  const S_CELL = 500;
  const S_N = 111;
  const sGround = new Float32Array(S_N * S_N);
  const sSurface = new Float32Array(S_N * S_N);
  const sFlags = new Uint8Array(S_N * S_N); // bit 1 = standingLakeOrSea, bit 2 = riverChannel, bit 4 = blockedForLine

  for (let r = 0; r < S_N; r++) {
    const n = S_MIN + r * S_CELL;
    for (let c = 0; c < S_N; c++) {
      const e = S_MIN + c * S_CELL;
      const idx = r * S_N + c;
      const w = waterCheck(n, e);
      sGround[idx] = w.h;
      sSurface[idx] = w.surfaceH;
      let flags = 0;
      if (w.standingLakeOrSea) flags |= 1;
      if (w.riverChannel) flags |= 2;
      if (
        w.standingLakeOrSea ||
        w.h > snowAt(n, e) - 130 ||
        !obstacleClearOfAirfields(n, e, w.h, 54) ||
        !clearOfSettlements(n, e, 160, 120)
      ) {
        flags |= 4;
      }
      sFlags[idx] = flags;
    }
  }

  const gridGround = (n: number, e: number): number => {
    const r = Math.max(0, Math.min(S_N - 1, Math.round((n - S_MIN) / S_CELL)));
    const c = Math.max(0, Math.min(S_N - 1, Math.round((e - S_MIN) / S_CELL)));
    return sGround[r * S_N + c];
  };
  const gridFlags = (n: number, e: number): number => {
    const r = Math.max(0, Math.min(S_N - 1, Math.round((n - S_MIN) / S_CELL)));
    const c = Math.max(0, Math.min(S_N - 1, Math.round((e - S_MIN) / S_CELL)));
    return sFlags[r * S_N + c];
  };

  // =========================================================================
  // 1. SUBSTATION ANCHORS & HIGH-TENSION CORRIDOR ROUTING
  // =========================================================================
  const substations: SubstationSite[] = [];
  const subPadValid = (n: number, e: number): boolean => {
    if (gridFlags(n, e) !== 0) return false;
    const w = waterCheck(n, e);
    if (w.wet || w.h > snowAt(n, e) - 220) return false;
    if (slopeAt(n, e, 28) > 0.1) return false;
    if (!obstacleClearOfAirfields(n, e, w.h, 48)) return false;
    if (!clearOfSettlements(n, e, 240, 180)) return false;
    if (useRealTerrain && onRoadVerge(n, e, 48)) return false;
    for (const [dn, de] of [[20, 20], [20, -20], [-20, 20], [-20, -20]]) {
      if (waterCheck(n + dn, e + de).wet) return false;
    }
    return true;
  };

  // Anchor 0: Town Grid Substation (just outside the town perimeter, or best lowland terrace if no town).
  if (town) {
    let best: { n: number; e: number; h: number; score: number } | null = null;
    const a0 = rand() * Math.PI * 2;
    for (let ring = town.radius + 290; ring <= town.radius + 780; ring += 140) {
      for (let k = 0; k < 24; k++) {
        const a = a0 + (k / 24) * Math.PI * 2;
        const n = town.north + Math.cos(a) * ring;
        const e = town.east + Math.sin(a) * ring;
        if (!subPadValid(n, e)) continue;
        const score = slopeAt(n, e, 28) * 10 + (ring - town.radius) / 2000;
        if (!best || score < best.score) best = { n, e, h: heightAt(n, e), score };
      }
    }
    if (best) {
      substations.push({ id: 'sub-town', north: best.n, east: best.e, elevation: best.h, heading: Math.atan2(town.east - best.e, town.north - best.n), width: 34, depth: 26 });
    }
  }
  if (substations.length === 0) {
    let best: { n: number; e: number; h: number; score: number } | null = null;
    for (let ring = 4200; ring <= 9000; ring += 700) {
      for (let k = 0; k < 24; k++) {
        const a = (k / 24) * Math.PI * 2 + 0.3;
        const n = Math.cos(a) * ring;
        const e = Math.sin(a) * ring;
        if (!subPadValid(n, e)) continue;
        const score = slopeAt(n, e, 28) * 10 + ring / 30000;
        if (!best || score < best.score) best = { n, e, h: heightAt(n, e), score };
      }
    }
    if (best) substations.push({ id: 'sub-valley', north: best.n, east: best.e, elevation: best.h, heading: 0, width: 34, depth: 26 });
  }

  // Additional regional / hydro / intertie substations (2 to 3 more, spread across distinct compass sectors).
  if (substations.length > 0) {
    const hub = substations[0];
    const cands: { n: number; e: number; h: number; bearing: number; hydroScore: number; trunkScore: number }[] = [];
    const valleyHit = { dist: Infinity, level: 0, floodplain: 0 };
    for (let n = -16800; n <= 16800; n += 1200) {
      for (let e = -16800; e <= 16800; e += 1200) {
        const jn = n + (rand() - 0.5) * 360;
        const je = e + (rand() - 0.5) * 360;
        const dOrig = Math.hypot(jn, je);
        const dHub = Math.hypot(jn - hub.north, je - hub.east);
        if (dOrig < 5200 || dOrig > 17600 || dHub < 6200 || dHub > 21000) continue;
        if (!subPadValid(jn, je)) continue;
        const h = heightAt(jn, je);
        const sl = slopeAt(jn, je, 28);
        let riverNear = 9999;
        if (useRealTerrain) {
          hydrology.queryValley(jn, je, valleyHit);
          riverNear = valleyHit.dist;
        }
        const riverBonus = riverNear > 140 && riverNear < 950 ? -0.35 : 0;
        const elevBonus = h > AIRPORT.elevation + 25 && h < AIRPORT.elevation + 520 ? -0.2 : 0;
        let settlementBonus = 0;
        for (const f of generatedAirfields()) {
          const df = Math.hypot(jn - f.north, je - f.east);
          if (df > 2600 && df < 5500) settlementBonus = -0.3;
        }
        for (const v of villages) {
          const dv = Math.hypot(jn - v.north, je - v.east);
          if (dv > 700 && dv < 2400) settlementBonus = -0.3;
        }
        const bearing = Math.atan2(je - hub.east, jn - hub.north);
        cands.push({
          n: jn,
          e: je,
          h,
          bearing,
          hydroScore: sl * 8 + riverBonus + elevBonus + Math.abs(dHub - 11500) / 30000,
          trunkScore: sl * 8 + settlementBonus + Math.abs(dOrig - 13500) / 35000,
        });
      }
    }

    cands.sort((a, b) => a.hydroScore - b.hydroScore);
    const chosenBearings: number[] = [];

    // Anchor hydro generation switchyard(s) directly at any sited hydro dam's tailrace powerhouse!
    dams.forEach((dam, di) => {
      const b = Math.atan2(dam.switchyardEast - hub.east, dam.switchyardNorth - hub.north);
      substations.push({
        id: di === 0 ? 'sub-hydro' : `sub-hydro-${di + 1}`,
        north: dam.switchyardNorth,
        east: dam.switchyardEast,
        elevation: dam.switchyardElevation,
        heading: Math.atan2(hub.east - dam.switchyardEast, hub.north - dam.switchyardNorth),
        width: 34,
        depth: 26,
      });
      chosenBearings.push(b);
    });

    const tryPick = (list: typeof cands, id: string, minAngle: number): void => {
      for (const c of list) {
        if (substations.some((s) => Math.hypot(s.north - c.n, s.east - c.e) < 6500)) continue;
        if (chosenBearings.some((b) => angleDiff(b, c.bearing) < minAngle)) continue;
        substations.push({
          id,
          north: c.n,
          east: c.e,
          elevation: c.h,
          heading: Math.atan2(hub.east - c.e, hub.north - c.n),
          width: 32,
          depth: 24,
        });
        chosenBearings.push(c.bearing);
        return;
      }
    };
    if (dams.length === 0) tryPick(cands, 'sub-hydro', 0);
    const byTrunk = [...cands].sort((a, b) => a.trunkScore - b.trunkScore);
    if (substations.length < 4) tryPick(byTrunk, 'sub-intertie-a', 1.35);
    if (substations.length < 4) tryPick(byTrunk, 'sub-intertie-b', 1.25);
  }

  const pylons: PylonSite[] = [];
  const spans: ConductorSpan[] = [];
  const terminalConnections: SubstationConnection[] = [];

  // Route transmission lines directly over the precomputed survey grid (zero extra terrain queries!).
  if (substations.length >= 2) {
    const CELL = S_CELL;
    const rows = S_N;
    const cols = S_N;
    const count = rows * cols;
    const gPenalty = new Float32Array(count);
    const gBlocked = new Uint8Array(count);
    const gRiver = new Uint8Array(count);

    const cellN = (k: number) => S_MIN + Math.floor(k / cols) * CELL;
    const cellE = (k: number) => S_MIN + (k % cols) * CELL;
    const toCell = (n: number, e: number) => {
      const r = Math.max(0, Math.min(rows - 1, Math.round((n - S_MIN) / CELL)));
      const c = Math.max(0, Math.min(cols - 1, Math.round((e - S_MIN) / CELL)));
      return r * cols + c;
    };

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const k = r * cols + c;
        const flags = sFlags[k];
        if (flags & 4) {
          gBlocked[k] = 1;
          continue;
        }
        if (flags & 2) {
          gRiver[k] = 1;
          gPenalty[k] = 5.5;
        } else {
          const r0 = Math.max(0, r - 1), r1 = Math.min(rows - 1, r + 1);
          const c0 = Math.max(0, c - 1), c1 = Math.min(cols - 1, c + 1);
          const dn = (sGround[r1 * cols + c] - sGround[r0 * cols + c]) / ((r1 - r0 || 1) * CELL);
          const de = (sGround[r * cols + c1] - sGround[r * cols + c0]) / ((c1 - c0 || 1) * CELL);
          const sl = Math.hypot(dn, de);
          // Allow climbing steep gorge walls (up to 0.85 = 40 deg) with quadratic slope cost so hydro dam lines never
          // get walled inside steep canyons, while valley routes still strongly prefer gentle terrain!
          if (sl > 0.85) {
            gBlocked[k] = 1;
            continue;
          }
          gPenalty[k] = sl * sl * 42 + Math.max(0, sGround[k] - (AIRPORT.elevation + 650)) / 450;
        }
      }
    }

    for (const s of substations) {
      const sc = toCell(s.north, s.east);
      gBlocked[sc] = 0;
      const sr = Math.floor(sc / cols), scol = sc % cols;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const nr = sr + dr, nc = scol + dc;
          if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) {
            const nk = nr * cols + nc;
            if (!(sFlags[nk] & 4)) gBlocked[nk] = 0;
          }
        }
      }
    }

    const moves: [number, number, number][] = [];
    for (let dr = -2; dr <= 2; dr++) {
      for (let dc = -2; dc <= 2; dc++) {
        if (dr === 0 && dc === 0) continue;
        if (Math.abs(dr) === 2 && Math.abs(dc) !== 1) continue;
        if (Math.abs(dc) === 2 && Math.abs(dr) !== 1) continue;
        moves.push([dr, dc, Math.hypot(dr, dc) * CELL]);
      }
    }

    const dist = new Float64Array(count);
    const prev = new Int32Array(count);

    const routeBetween = (a: SubstationSite, b: SubstationSite): { n: number; e: number }[] | null => {
      const start = toCell(a.north, a.east);
      const goal = toCell(b.north, b.east);
      dist.fill(Infinity);
      prev.fill(-1);
      dist[start] = 0;
      const heap = new MinHeap(dist);
      heap.push(start);

      while (heap.size > 0) {
        const u = heap.pop();
        if (u === goal) break;
        const ur = Math.floor(u / cols);
        const uc = u % cols;
        const du = dist[u];
        for (const [dr, dc, stepLen] of moves) {
          const vr = ur + dr;
          const vc = uc + dc;
          if (vr < 0 || vr >= rows || vc < 0 || vc >= cols) continue;
          const v = vr * cols + vc;
          if (gBlocked[v]) continue;
          if (Math.abs(dr) === 2 || Math.abs(dc) === 2) {
            const mr = ur + Math.trunc(dr / 2);
            const mc = uc + Math.trunc(dc / 2);
            if (gBlocked[mr * cols + mc]) continue;
          }
          const grade = Math.abs(sSurface[v] - sSurface[u]) / stepLen;
          if (grade > 0.72) continue;
          const riverStepCost = (gRiver[v] ? 1600 : 0) + (gRiver[u] && gRiver[v] ? 3200 : 0);
          const cost = stepLen * (1 + (grade / 0.085) ** 2 + 0.5 * (gPenalty[u] + gPenalty[v])) + riverStepCost;
          const nd = du + cost;
          if (nd < dist[v]) {
            dist[v] = nd;
            prev[v] = u;
            heap.push(v);
          }
        }
      }

      if (!Number.isFinite(dist[goal])) return null;
      const raw: { n: number; e: number }[] = [{ n: b.north, e: b.east }];
      let cur = prev[goal];
      while (cur !== -1 && cur !== start) {
        raw.push({ n: cellN(cur), e: cellE(cur) });
        cur = prev[cur];
      }
      raw.push({ n: a.north, e: a.east });
      raw.reverse();
      return raw;
    };

    /** Fast chord safety check using the survey grid first, then 130 m exact checks. */
    const chordValid = (p0: { n: number; e: number }, p1: { n: number; e: number }): boolean => {
      const len = Math.hypot(p1.n - p0.n, p1.e - p0.e);
      const steps = Math.max(2, Math.ceil(len / 130));
      let wetRun = 0;
      for (let i = 1; i < steps; i++) {
        const t = i / steps;
        const n = p0.n + (p1.n - p0.n) * t;
        const e = p0.e + (p1.e - p0.e) * t;
        if (gridFlags(n, e) & 5) return false;
        const w = waterCheck(n, e);
        if (w.standingLakeOrSea) return false;
        if (!obstacleClearOfAirfields(n, e, w.h, 54) || !clearOfSettlements(n, e, 150, 110)) return false;
        if (w.wet) {
          wetRun += len / steps;
          if (wetRun > 340) return false;
        } else {
          wetRun = 0;
        }
      }
      return true;
    };

    /** Simplify a cell path into realistic long straight tangent runs between angle/strain towers. */
    const simplifyToTangents = (raw: { n: number; e: number }[]): { n: number; e: number }[] => {
      if (raw.length <= 2) return raw;
      const recurse = (lo: number, hi: number): { n: number; e: number }[] => {
        if (hi - lo <= 1) return [raw[lo]];
        let maxDev = -1;
        let split = -1;
        for (let i = lo + 1; i < hi; i++) {
          const d = pointToSegmentDist(raw[i].n, raw[i].e, raw[lo].n, raw[lo].e, raw[hi].n, raw[hi].e);
          if (d > maxDev) {
            maxDev = d;
            split = i;
          }
        }
        const len = Math.hypot(raw[hi].n - raw[lo].n, raw[hi].e - raw[lo].e);
        if (maxDev <= 210 && len <= 4200 && chordValid(raw[lo], raw[hi])) {
          return [raw[lo]];
        }
        if (split === -1) split = (lo + hi) >> 1;
        return [...recurse(lo, split), ...recurse(split, hi)];
      };
      return [...recurse(0, raw.length - 1), raw[raw.length - 1]];
    };

    /** Nudge an intermediate tower along its tangent line if its nominal spot falls in water or on a road. */
    const dryTowerSpot = (
      p0: { n: number; e: number },
      p1: { n: number; e: number },
      tNom: number,
      segLen: number,
    ): { n: number; e: number; h: number } | null => {
      const maxShift = Math.min(0.42, 145 / Math.max(segLen, 1));
      for (let step = 0; step <= 16; step++) {
        for (const sign of step === 0 ? [1] : [-1, 1]) {
          const t = tNom + sign * (step / 16) * maxShift;
          if (t <= 0.07 || t >= 0.93) continue;
          const n = p0.n + (p1.n - p0.n) * t;
          const e = p0.e + (p1.e - p0.e) * t;
          const w = waterCheck(n, e);
          if (w.wet) continue;
          if (useRealTerrain && onRoadVerge(n, e, 8)) continue;
          if (slopeAt(n, e, 16) > 0.68) continue;
          if (!obstacleClearOfAirfields(n, e, w.h, 54)) continue;
          return { n, e, h: w.h };
        }
      }
      return null;
    };

    // Build corridors: hub <-> each satellite substation (connecting to nearest already-connected substation if closer).
    const connected = [0];
    const headingAssigned = new Set<number>();
    let corridorIdx = 0;
    for (let si = 1; si < substations.length; si++) {
      // Try nearest connected substation first, falling back to any other connected substation if blocked.
      const order = [...connected].sort(
        (ca, cb) =>
          Math.hypot(substations[si].north - substations[ca].north, substations[si].east - substations[ca].east) -
          Math.hypot(substations[si].north - substations[cb].north, substations[si].east - substations[cb].east),
      );
      let bestFrom = order[0];
      let raw: { n: number; e: number }[] | null = null;
      for (const candFrom of order) {
        raw = routeBetween(substations[candFrom], substations[si]);
        if (raw && raw.length >= 2) {
          bestFrom = candFrom;
          break;
        }
      }
      if (!raw || raw.length < 2) continue;
      connected.push(si);

      const subA = substations[bestFrom];
      const subB = substations[si];

      // Start & end dead-end towers stand 30..72 m outside each substation pad on dry land along the line direction.
      const pushOff = (sub: SubstationSite, toward: { n: number; e: number }): { n: number; e: number } => {
        const b0 = Math.atan2(toward.e - sub.east, toward.n - sub.north);
        for (const dAng of [0, 0.2, -0.2, 0.42, -0.42, 0.7, -0.7, 1.05, -1.05, 1.45, -1.45, Math.PI]) {
          const b = b0 + dAng;
          for (const d of [34, 46, 58, 72]) {
            const n = sub.north + Math.cos(b) * d;
            const e = sub.east + Math.sin(b) * d;
            const w = waterCheck(n, e);
            if (!w.wet && !(useRealTerrain && onRoadVerge(n, e, 8)) && obstacleClearOfAirfields(n, e, w.h, 48)) {
              return { n, e };
            }
          }
        }
        return { n: sub.north, e: sub.east };
      };
      raw[0] = pushOff(subA, raw[Math.min(1, raw.length - 1)]);
      raw[raw.length - 1] = pushOff(subB, raw[Math.max(0, raw.length - 2)]);
      if (!headingAssigned.has(bestFrom)) {
        subA.heading = Math.atan2(raw[0].e - subA.east, raw[0].n - subA.north);
        headingAssigned.add(bestFrom);
      }
      if (!headingAssigned.has(si)) {
        subB.heading = Math.atan2(raw[raw.length - 1].e - subB.east, raw[raw.length - 1].n - subB.north);
        headingAssigned.add(si);
      }

      // Ensure every tangent-bend vertex sits on dry, road-clear ground before placing angle/strain pylons!
      const dryVertex = (pt: { n: number; e: number }): { n: number; e: number } => {
        const w0 = waterCheck(pt.n, pt.e);
        if (!w0.wet && !(useRealTerrain && onRoadVerge(pt.n, pt.e, 8))) return pt;
        for (const rad of [18, 36, 58, 84, 115]) {
          for (let k = 0; k < 12; k++) {
            const a = (k / 12) * Math.PI * 2;
            const n = pt.n + Math.cos(a) * rad;
            const e = pt.e + Math.sin(a) * rad;
            const w = waterCheck(n, e);
            if (!w.wet && !(useRealTerrain && onRoadVerge(n, e, 8)) && slopeAt(n, e, 16) <= 0.68 && obstacleClearOfAirfields(n, e, w.h, 54)) {
              return { n, e };
            }
          }
        }
        return pt;
      };

      const vertices = simplifyToTangents(raw).map((v, idx, arr) =>
        idx === 0 || idx === arr.length - 1 ? v : dryVertex(v),
      );
      interface CorrTower {
        n: number;
        e: number;
        ground: number;
        height: number;
        kind: PylonKind;
        obstructionLit: boolean;
      }
      const cTowers: CorrTower[] = [];

      for (let vi = 0; vi < vertices.length - 1; vi++) {
        const A = vertices[vi];
        const B = vertices[vi + 1];
        if (vi === 0) {
          cTowers.push({ n: A.n, e: A.e, ground: waterCheck(A.n, A.e).h, height: PYLON_REF_HEIGHT, kind: 'strain', obstructionLit: false });
        }
        const segLen = Math.hypot(B.n - A.n, B.e - A.e);
        const nSpans = Math.max(1, Math.round(segLen / 305));
        for (let k = 1; k < nSpans; k++) {
          const spot = dryTowerSpot(A, B, k / nSpans, segLen);
          if (spot) {
            cTowers.push({ n: spot.n, e: spot.e, ground: spot.h, height: PYLON_REF_HEIGHT, kind: 'suspension', obstructionLit: false });
          }
        }
        cTowers.push({ n: B.n, e: B.e, ground: waterCheck(B.n, B.e).h, height: PYLON_REF_HEIGHT, kind: 'strain', obstructionLit: false });
      }

      // Refine spans for catenary ground/river clearance (split over convex crests or raise river-crossing towers).
      for (let pass = 0; pass < 3; pass++) {
        let inserted = false;
        for (let i = 0; i < cTowers.length - 1; i++) {
          const t0 = cTowers[i];
          const t1 = cTowers[i + 1];
          const L = Math.hypot(t1.n - t0.n, t1.e - t0.e);
          const sag = Math.max(2.2, Math.min(15.0, 0.00007 * L * L));
          let worstClear = Infinity;
          let worstT = 0.5;
          let crossesRiver = false;
          for (let s = 1; s <= 11; s++) {
            const f = s / 12;
            const sn = t0.n + (t1.n - t0.n) * f;
            const se = t0.e + (t1.e - t0.e) * f;
            const w = waterCheck(sn, se);
            if (w.wet) crossesRiver = true;
            const lowY =
              t0.ground +
              t0.height * PYLON_LOWEST_INSULATOR_FRAC * (1 - f) +
              (t1.ground + t1.height * PYLON_LOWEST_INSULATOR_FRAC) * f -
              sag * 4 * f * (1 - f);
            const clear = lowY - w.surfaceH;
            if (clear < worstClear) {
              worstClear = clear;
              worstT = f;
            }
          }
          if (crossesRiver && L > 250) {
            t0.obstructionLit = true;
            t1.obstructionLit = true;
          }
          if (worstClear < MIN_WIRE_CLEARANCE_M) {
            const crest = L > 170 ? dryTowerSpot({ n: t0.n, e: t0.e }, { n: t1.n, e: t1.e }, worstT, L) : null;
            if (crest && pass < 2) {
              cTowers.splice(i + 1, 0, {
                n: crest.n,
                e: crest.e,
                ground: crest.h,
                height: PYLON_REF_HEIGHT + 4,
                kind: 'suspension',
                obstructionLit: false,
              });
              inserted = true;
              i++;
            } else {
              const deficit = MIN_WIRE_CLEARANCE_M - worstClear + 3.0;
              const addH = deficit / PYLON_LOWEST_INSULATOR_FRAC;
              const maxTowerH = 74;
              const cap0 = obstacleClearOfAirfields(t0.n, t0.e, t0.ground, Math.min(maxTowerH, t0.height + addH)) ? maxTowerH : t0.height;
              const cap1 = obstacleClearOfAirfields(t1.n, t1.e, t1.ground, Math.min(maxTowerH, t1.height + addH)) ? maxTowerH : t1.height;
              t0.height = Math.min(cap0, t0.height + addH);
              t1.height = Math.min(cap1, t1.height + addH);
              if (t0.height >= 44) t0.obstructionLit = true;
              if (t1.height >= 44) t1.obstructionLit = true;
            }
          }
        }
        if (!inserted) break;
      }

      // Compute tower headings (bisector of incoming/outgoing span bearings) and emit pylons + spans.
      const baseIndex = pylons.length;
      for (let i = 0; i < cTowers.length; i++) {
        const cur = cTowers[i];
        const prevT = cTowers[Math.max(0, i - 1)];
        const nextT = cTowers[Math.min(cTowers.length - 1, i + 1)];
        const bIn = i > 0 ? Math.atan2(cur.e - prevT.e, cur.n - prevT.n) : Math.atan2(nextT.e - cur.e, nextT.n - cur.n);
        const bOut = i < cTowers.length - 1 ? Math.atan2(nextT.e - cur.e, nextT.n - cur.n) : bIn;
        const turn = angleDiff(bIn, bOut);
        const heading = wrapAngle(bIn + wrapAngle(bOut - bIn) * 0.5);
        const kind: PylonKind = cur.kind === 'strain' || turn > 0.12 ? 'strain' : 'suspension';
        pylons.push({
          index: baseIndex + i,
          corridor: corridorIdx,
          kind,
          north: cur.n,
          east: cur.e,
          ground: cur.ground,
          height: cur.height,
          heading,
          obstructionLit: cur.obstructionLit || cur.height >= 44,
        });
      }

      for (let i = 0; i < cTowers.length - 1; i++) {
        const p0 = pylons[baseIndex + i];
        const p1 = pylons[baseIndex + i + 1];
        const L = Math.hypot(p1.north - p0.north, p1.east - p0.east);
        const sag = Math.max(2.2, Math.min(15.0, 0.00007 * L * L));
        let minClear = Infinity;
        let overRiverOrRoad = false;
        let maxMidAGL = 0;
        for (let s = 1; s <= 11; s++) {
          const f = s / 12;
          const sn = p0.north + (p1.north - p0.north) * f;
          const se = p0.east + (p1.east - p0.east) * f;
          const w = waterCheck(sn, se);
          if (w.wet || (useRealTerrain && onRoadVerge(sn, se, 4))) overRiverOrRoad = true;
          const lowY =
            p0.ground +
            p0.height * PYLON_LOWEST_INSULATOR_FRAC * (1 - f) +
            (p1.ground + p1.height * PYLON_LOWEST_INSULATOR_FRAC) * f -
            sag * 4 * f * (1 - f);
          const topY = p0.ground + p0.height * (1 - f) + (p1.ground + p1.height) * f - sag * 0.85 * 4 * f * (1 - f);
          minClear = Math.min(minClear, lowY - w.surfaceH);
          maxMidAGL = Math.max(maxMidAGL, topY - w.surfaceH);
        }
        spans.push({
          corridor: corridorIdx,
          from: p0.index,
          to: p1.index,
          length: L,
          sag,
          markerBalls: overRiverOrRoad || L > 345 || maxMidAGL > 48,
          minClearance: minClear,
        });
      }
      terminalConnections.push(
        { substation: bestFrom, pylon: baseIndex },
        { substation: si, pylon: pylons.length - 1 },
      );
      corridorIdx++;
    }
  }

  // =========================================================================
  // 2. ALGORITHMIC RADIO & TELECOMMUNICATIONS MASTS
  // =========================================================================
  const masts: RadioMastSite[] = [];

  const clearOfPowerLines = (n: number, e: number, minDist: number): boolean => {
    for (const s of spans) {
      const a = pylons[s.from];
      const b = pylons[s.to];
      if (pointToSegmentDist(n, e, a.north, a.east, b.north, b.east) < minDist) return false;
    }
    for (const sub of substations) {
      if (Math.hypot(n - sub.north, e - sub.east) < minDist + 40) return false;
    }
    return true;
  };

  /** Fast prominence lookup from the 400 m survey grid (O(1) array reads, zero terrain re-sampling!). */
  const prominenceAt = (n: number, e: number, h: number): { prom: number; localCrest: number } => {
    let ringSum = 0;
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      ringSum += gridGround(n + Math.cos(a) * 1800, e + Math.sin(a) * 1800);
    }
    let nearMax = -Infinity;
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      nearMax = Math.max(nearMax, gridGround(n + Math.cos(a) * 400, e + Math.sin(a) * 400));
    }
    return { prom: h - ringSum / 12, localCrest: h - nearMax };
  };

  // 2a. Tall Guyed Broadcast Masts (3 per world, 108..146 m AGL on prominent ridges/hills).
  interface MastCand {
    n: number;
    e: number;
    h: number;
    mastH: number;
    prom: number;
    heading: number;
    anchorR: number;
    score: number;
  }
  const guyedCands: MastCand[] = [];
  for (let n = -18400; n <= 18400; n += 800) {
    for (let e = -18400; e <= 18400; e += 800) {
      const jn = n + (rand() - 0.5) * 260;
      const je = e + (rand() - 0.5) * 260;
      const dOrig = Math.hypot(jn, je);
      if (dOrig < 3800 || dOrig > 19200) continue;
      if (gridFlags(jn, je) !== 0) continue;
      const gApprox = gridGround(jn, je);
      const { prom, localCrest } = prominenceAt(jn, je, gApprox);
      if (localCrest < -12) continue;
      const w = waterCheck(jn, je);
      if (w.wet || w.h < WATER_LEVEL + 6 || w.h > snowAt(jn, je) - 180) continue;
      if (slopeAt(jn, je, 28) > 0.22) continue;
      if (!clearOfSettlements(jn, je, 420, 300)) continue;
      if (useRealTerrain && onRoadVerge(jn, je, 45)) continue;

      const mastH = 108 + Math.round(rand() * 38);
      const anchorR = Math.round(mastH * 0.42);
      if (!obstacleClearOfAirfields(jn, je, w.h, mastH + 16)) continue;
      if (!clearOfPowerLines(jn, je, anchorR + 120)) continue;

      // Verify all 3 guy-wire anchor blocks sit on dry land without extreme drop-offs.
      const heading = rand() * Math.PI * 2;
      let anchorsOk = true;
      for (let k = 0; k < 3; k++) {
        const a = heading + (k * Math.PI * 2) / 3;
        const an = jn + Math.cos(a) * anchorR;
        const ae = je + Math.sin(a) * anchorR;
        const aw = waterCheck(an, ae);
        if (aw.wet || Math.abs(aw.h - w.h) > 36) {
          anchorsOk = false;
          break;
        }
      }
      if (!anchorsOk) continue;

      // Score favours strong prominence + commanding line-of-sight within ~6..15 km of the valley/town.
      const refN = town ? town.north : 0;
      const refE = town ? town.east : 0;
      const dRef = Math.hypot(jn - refN, je - refE);
      const distPenalty = Math.abs(dRef - 9500) * 0.004;
      const score = prom * 1.4 + localCrest * 0.8 - distPenalty;
      guyedCands.push({ n: jn, e: je, h: w.h, mastH, prom, heading, anchorR, score });
    }
  }
  guyedCands.sort((a, b) => b.score - a.score);
  for (const c of guyedCands) {
    if (masts.length >= 3) break;
    if (masts.some((m) => Math.hypot(m.north - c.n, m.east - c.e) < 6500)) continue;
    // Prefer distinct compass sectors for the first 3 broadcast masts when strong candidates exist.
    if (
      masts.length < 3 &&
      guyedCands.length > 12 &&
      masts.some((m) => angleDiff(Math.atan2(m.east, m.north), Math.atan2(c.e, c.n)) < 1.15)
    ) {
      continue;
    }
    masts.push({
      id: `mast-broadcast-${masts.length + 1}`,
      kind: 'guyed',
      north: c.n,
      east: c.e,
      ground: c.h,
      height: c.mastH,
      prominence: Math.max(0, c.prom),
      heading: c.heading,
      dishBearings: [],
      anchorRadius: c.anchorR,
    });
  }
  // Top up to at least 2 guyed masts if sector filter left fewer on coastal/island seeds.
  for (const c of guyedCands) {
    if (masts.length >= 2) break;
    if (masts.some((m) => Math.hypot(m.north - c.n, m.east - c.e) < 5000)) continue;
    masts.push({
      id: `mast-broadcast-${masts.length + 1}`,
      kind: 'guyed',
      north: c.n,
      east: c.e,
      ground: c.h,
      height: c.mastH,
      prominence: Math.max(0, c.prom),
      heading: c.heading,
      dishBearings: [],
      anchorRadius: c.anchorR,
    });
  }

  // 2b. Self-Supporting Lattice Microwave / Cellular Relay Towers (7..9 per world, 40..66 m AGL).
  // First: 1 Town Telecom Tower overlooking the town edge (if town exists).
  if (town) {
    let bestTownMast: { n: number; e: number; h: number; score: number } | null = null;
    for (let ring = town.radius + 150; ring <= town.radius + 520; ring += 90) {
      for (let k = 0; k < 28; k++) {
        const a = (k / 28) * Math.PI * 2 + 0.17;
        const n = town.north + Math.cos(a) * ring;
        const e = town.east + Math.sin(a) * ring;
        const w = waterCheck(n, e);
        if (w.wet || slopeAt(n, e, 20) > 0.2) continue;
        if (useRealTerrain && onRoadVerge(n, e, 28)) continue;
        if (!obstacleClearOfAirfields(n, e, w.h, 66)) continue;
        if (!clearOfPowerLines(n, e, 140)) continue;
        if (masts.some((m) => Math.hypot(m.north - n, m.east - e) < 2200)) continue;
        const score = w.h - slopeAt(n, e, 20) * 30;
        if (!bestTownMast || score > bestTownMast.score) bestTownMast = { n, e, h: w.h, score };
      }
    }
    if (bestTownMast) {
      masts.push({
        id: 'mast-town-relay',
        kind: 'lattice',
        north: bestTownMast.n,
        east: bestTownMast.e,
        ground: bestTownMast.h,
        height: 48 + Math.round(rand() * 12),
        prominence: Math.max(0, bestTownMast.h - heightAt(town.north, town.east)),
        heading: rand() * Math.PI * 0.5,
        dishBearings: [],
        anchorRadius: 0,
      });
    }
  }

  // Regional foothill / spur / coastal headland / highway relay towers.
  const relayCands: MastCand[] = [];
  for (let n = -18000; n <= 18000; n += 900) {
    for (let e = -18000; e <= 18000; e += 900) {
      const jn = n + (rand() - 0.5) * 300;
      const je = e + (rand() - 0.5) * 300;
      const dOrig = Math.hypot(jn, je);
      if (dOrig < 2800 || dOrig > 18800) continue;
      if (gridFlags(jn, je) !== 0) continue;
      const gApprox = gridGround(jn, je);
      const { prom, localCrest } = prominenceAt(jn, je, gApprox);
      if (localCrest < -8) continue;
      const w = waterCheck(jn, je);
      if (w.wet || w.h < WATER_LEVEL + 4 || w.h > snowAt(jn, je) - 200) continue;
      if (slopeAt(jn, je, 20) > 0.24) continue;
      if (!clearOfSettlements(jn, je, 180, 140)) continue;
      if (useRealTerrain && onRoadVerge(jn, je, 30)) continue;

      const mastH = 40 + Math.round(rand() * 26);
      if (!obstacleClearOfAirfields(jn, je, w.h, mastH + 14)) continue;
      if (!clearOfPowerLines(jn, je, 150)) continue;

      const score = prom * 1.1 + localCrest * 0.9 - Math.abs(dOrig - 10500) * 0.0025;
      relayCands.push({ n: jn, e: je, h: w.h, mastH, prom, heading: rand() * Math.PI * 0.5, anchorR: 0, score });
    }
  }
  relayCands.sort((a, b) => b.score - a.score);
  let relayCount = 0;
  for (const c of relayCands) {
    if (relayCount >= 7) break;
    if (masts.some((m) => Math.hypot(m.north - c.n, m.east - c.e) < 3400)) continue;
    relayCount++;
    masts.push({
      id: `mast-relay-${relayCount}`,
      kind: 'lattice',
      north: c.n,
      east: c.e,
      ground: c.h,
      height: c.mastH,
      prominence: Math.max(0, c.prom),
      heading: c.heading,
      dishBearings: [],
      anchorRadius: 0,
    });
  }

  // Point every lattice relay tower's microwave dishes directly at its two nearest peer masts (forming a real link graph).
  for (const m of masts) {
    if (m.kind !== 'lattice') continue;
    const peers = masts
      .filter((p) => p !== m)
      .map((p) => ({ d: Math.hypot(p.north - m.north, p.east - m.east), b: Math.atan2(p.east - m.east, p.north - m.north) }))
      .sort((a, b) => a.d - b.d);
    m.dishBearings = peers.slice(0, 2).map((p) => p.b);
  }

  const plan: InfrastructurePlan = { dams, substations, pylons, spans, terminalConnections, masts };
  cachedKey = key;
  cachedFn = heightAt;
  cachedPlan = plan;
  return plan;
}

/**
 * Extract structured-cloneable right-of-way polylines, substation/mast/dam clearings and impounded reservoir masks
 * from an `InfrastructurePlan` for `setCorridorClearings` and `TerrainSystem` worker broadcast.
 */
export function infrastructureClearings(plan: InfrastructurePlan): CorridorClearings {
  const byCorridor = new Map<number, { north: number[]; east: number[] }>();
  for (const sp of plan.spans) {
    const p0 = plan.pylons[sp.from];
    const p1 = plan.pylons[sp.to];
    let line = byCorridor.get(sp.corridor);
    if (!line) {
      line = { north: [p0.north], east: [p0.east] };
      byCorridor.set(sp.corridor, line);
    }
    line.north.push(p1.north);
    line.east.push(p1.east);
  }
  const corridors = [...byCorridor.values()];

  const pads: [number, number, number][] = [];
  for (const dam of plan.dams) {
    // Clear trees across the curved/straight dam crest, downstream sloped face, rockfill toes and powerhouse apron.
    const dn = Math.cos(dam.heading), de = Math.sin(dam.heading);
    const rn = -de, re = dn;
    const uOffsets = dam.kind === 'arch' ? [-4, 24] : [-4, 30, 58];
    for (const uOff of uOffsets) {
      const north: number[] = [];
      const east: number[] = [];
      const steps = 8;
      for (let s = 0; s <= steps; s++) {
        const v = -dam.leftSpan - 18 + (s / steps) * (dam.crestLength + 36);
        const u = damWallCenterU(dam.leftSpan, dam.rightSpan, dam.archSagitta, v) + uOff;
        north.push(dam.north + dn * u + rn * v);
        east.push(dam.east + de * u + re * v);
      }
      corridors.push({ north, east });
    }
    pads.push([dam.north + dn * 34, dam.east + de * 34, 54]);
    // Also clear any tie-line swath between powerhouse and switchyard.
    corridors.push({
      north: [dam.north + dn * 34, dam.switchyardNorth],
      east: [dam.east + de * 34, dam.switchyardEast],
    });
  }
  for (const tc of plan.terminalConnections) {
    const sub = plan.substations[tc.substation];
    const p = plan.pylons[tc.pylon];
    if (sub && p) {
      corridors.push({ north: [sub.north, p.north], east: [sub.east, p.east] });
    }
  }
  for (const s of plan.substations) {
    pads.push([s.north, s.east, Math.hypot(s.width, s.depth) * 0.5 + 12]);
  }
  for (const m of plan.masts) {
    pads.push([m.north, m.east, m.kind === 'guyed' ? 22 : 17]);
    if (m.kind === 'guyed' && m.anchorRadius > 0) {
      for (let k = 0; k < 3; k++) {
        const az = m.heading + (k * Math.PI * 2) / 3;
        pads.push([m.north + Math.cos(az) * m.anchorRadius, m.east + Math.sin(az) * m.anchorRadius, 8]);
      }
    }
  }

  const reservoirs = plan.dams.map(damToReservoirClearing);
  return { corridors, pads, reservoirs };
}
