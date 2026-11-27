// Algorithmic siting of hydro-electric dams and exact upstream valley contour flood-filling for impounded reservoirs.
//
// Physical siting criteria ("occasional, where the valley is suitable - reasonably narrow with a largish catchment,
// and favouring larger impounded reservoir lakes"):
//   1. Channel carries a substantial upstream catchment:
//      - Steep mountain / foothill gorges (>= 35 km², Cobb / Patea / Maraetai style): narrow rock throats <= 520 m;
//      - Confined trunk river gorges (>= 85 km², Clyde / Aviemore / Benmore style): confined throats <= 1,040 m
//        (whereas open meandering valleys span 1,800..3,200 m and are rejected).
//   2. Stage 1 computes exact upstream backwater channel reach (`upstreamReachM`) directly from the river's elevation
//      profile so narrow gorge throats sitting immediately below long, low-gradient upstream basins rise to the top
//      instead of steep mountain chutes that only hold small ponds.
//   3. Stage 2 runs a fast coarse (`88 m`) 2D terrain flood-fill (out to 10 km upstream and 14 km² surface area) to
//      verify 100% watertightness and measure true lake area (km²) and storage volume (million m³), strongly weighting
//      larger lakes ("the larger the better") alongside catchment area and throat narrowness.
//   4. Stage 3 builds the high-resolution (`22..28 m`) curvilinear shoreline grid for the winning 0..2 dams per world.
//
// Pure and three.js-free; runs in ~40-75 ms per world seed.

import { isPresent } from '../era/eraState';
import type { ReservoirClearing } from '../terrain/corridorMask';
import { hydrology, makeSample, sampleTerrain, snowLine, terrainHeight } from '../terrain/heightfield';
import { onRoadVerge } from '../terrain/roads';
import { obstacleClearOfAirfields } from './infrastructurePlan';
import type { HeightFn } from './valley';

export type HydroDamKind = 'arch' | 'gravity';

export interface ReservoirGrid {
  /** Dam axis origin on the river thalweg (NED m). */
  originN: number;
  originE: number;
  /** Downstream unit vector (cos heading, sin heading). */
  dn: number;
  de: number;
  /** Grid spacing, m. */
  cell: number;
  /** Upstream-most grid index `k` (`k <= 0`, `k = 0` lies along the dam wall centreline). */
  uMin: number;
  /** Left-most and right-most cross-valley grid indices `c` (`v = c * cell`). */
  vMin: number;
  vMax: number;
  /** Grid dimensions: `rows = 1 - uMin`, `cols = vMax - vMin + 1`. */
  rows: number;
  cols: number;
  /** 1 where flooded in the connected reservoir basin, 2 on the 1-cell shoreline rim, 0 outside. */
  mask: Uint8Array;
  /** Exact terrain bed elevation MSL at every `(r, c)` grid vertex, m. */
  ground: Float32Array;
}

export interface HydroDamSite {
  id: string;
  kind: HydroDamKind;
  /** Dam axis centre on the river thalweg, NED m. */
  north: number;
  east: number;
  /** True heading pointing downstream perpendicular to the dam crest, rad clockwise from north. */
  heading: number;
  /** Lowest riverbed elevation at the dam axis, m MSL. */
  bedElevation: number;
  /** Tailwater surface / bed elevation immediately downstream of the dam toe, m MSL. */
  tailwaterElevation: number;
  /** Impounded reservoir Full Supply Level (water surface), m MSL. */
  waterLevel: number;
  /** Dam crest roadway elevation (`waterLevel + freeboard`), m MSL. */
  crestElevation: number;
  /** Structural dam height (`crestElevation - bedElevation`), m. */
  wallHeight: number;
  /** Distance from `(north, east)` to left-bank (`-v`) and right-bank (`+v`) crest abutments, m. */
  leftSpan: number;
  rightSpan: number;
  /** Total crest length (`leftSpan + rightSpan`), m. */
  crestLength: number;
  /** Upstream parabolic arch bow sagitta at crown (`0` for gravity / composite dams), m. */
  archSagitta: number;
  /** Upstream catchment area draining through the dam, km². */
  catchmentKm2: number;
  /** Surface area of the impounded reservoir lake, km². */
  reservoirAreaKm2: number;
  /** Upstream reach of the impounded reservoir lake behind the dam, m. */
  reservoirLengthM: number;
  /** Tailrace switchyard pad coordinates & ground elevation downstream of the powerhouse toe. */
  switchyardNorth: number;
  switchyardEast: number;
  switchyardElevation: number;
  /** Flooded upstream basin lattice for 3D reservoir water mesh generation and tree/canopy clearing. */
  reservoir: ReservoirGrid;
}

/** Default fine reservoir water-mesh lattice spacing, m (screened at 88 m first for speed). */
export const RESERVOIR_CELL_M = 22;
const COARSE_CELL_M = 88;
const FREEBOARD_M = 3.5;
const MIN_GORGE_CATCHMENT_KM2 = 35;
const MIN_TRUNK_CATCHMENT_KM2 = 85;
const MIN_WALL_HEIGHT_M = 24;
const MAX_WALL_HEIGHT_M = 58;
const MIN_CREST_LEN_M = 50;
const MAX_GORGE_CREST_M = 540;
const MAX_TRUNK_CREST_M = 1040;
const MIN_RESERVOIR_AREA_KM2 = 0.16;
const MAX_RESERVOIR_AREA_KM2 = 14.0;
const MIN_RESERVOIR_LEN_M = 650;

/**
 * Signed downstream offset `u` (m) of the dam wall's structural centreline at cross-valley offset `v` (m, + right bank).
 * Zero for straight gravity dams; negative (`-archSagitta` at crown, `0` at abutments) for upstream-curved arch dams.
 */
export function damWallCenterU(
  leftSpan: number,
  rightSpan: number,
  archSagitta: number,
  v: number,
): number {
  if (archSagitta <= 0) return 0;
  const vc = 0.5 * (rightSpan - leftSpan);
  const hs = Math.max(1, 0.5 * (leftSpan + rightSpan));
  const xi = Math.max(-1, Math.min(1, (v - vc) / hs));
  return -archSagitta * (1 - xi * xi);
}

/**
 * Curvilinear downstream coordinate `u` (m) for reservoir lattice step `k <= 0` (`k = 0` sits identically along the
 * dam wall centreline `damWallCenterU`, decaying smoothly to rectilinear `k * cell` upstream).
 */
export function reservoirGridU(
  leftSpan: number,
  rightSpan: number,
  archSagitta: number,
  cell: number,
  k: number,
  v: number,
): number {
  const u0 = damWallCenterU(leftSpan, rightSpan, archSagitta, v);
  if (u0 === 0) return k * cell;
  const decay = k >= 0 ? 1 : Math.exp((k * cell) / 90);
  return u0 * decay + k * cell;
}

interface ThroatCandidate {
  riverId: number;
  north: number;
  east: number;
  heading: number;
  dn: number;
  de: number;
  bedH: number;
  tailH: number;
  maxConfinedCrest: number;
  maxAllowedCrest: number;
  widthAt28: number;
  upstreamReachM: number;
  catchmentKm2: number;
  prelimScore: number;
}

/**
 * Site 0..2 hydro-electric dams + impounded valley reservoirs for the current world seed and terrain.
 */
export function planHydroDams(
  heightAt: HeightFn = terrainHeight,
  clearOfSettlements?: (n: number, e: number, townPad: number, villagePad: number) => boolean,
): HydroDamSite[] {
  if (!isPresent()) return [];

  const useRealTerrain = heightAt === terrainHeight;
  const samp = makeSample();

  const groundAndWater = (n: number, e: number): { ground: number; standing: number; river: number } => {
    if (!useRealTerrain) {
      const h = heightAt(n, e);
      return { ground: h, standing: h <= 1.0 ? 0 : -Infinity, river: -Infinity };
    }
    sampleTerrain(n, e, samp);
    return { ground: samp.ground, standing: samp.standing, river: samp.river };
  };

  const bedAt = (n: number, e: number): number => (useRealTerrain ? sampleTerrain(n, e, samp).ground : heightAt(n, e));
  const snowAt = (n: number, e: number): number => (useRealTerrain ? snowLine(n, e) : 2500);
  const settlementOk = (n: number, e: number, tp: number, vp: number): boolean =>
    clearOfSettlements ? clearOfSettlements(n, e, tp, vp) : true;

  // -------------------------------------------------------------------------
  // 1. Fast scan of qualifying river/gorge reaches + upstream backwater reach
  // -------------------------------------------------------------------------
  const rawThroats: ThroatCandidate[] = [];

  interface ScanLine {
    id: number;
    north: Float64Array;
    east: Float64Array;
    level: Float64Array;
    s: Float64Array;
    area?: Float64Array;
    braidK?: Float32Array;
    kind?: number;
  }

  const lines: ScanLine[] = hydrology.rivers
    ? hydrology.rivers.map((r, id) => ({
        id,
        north: r.north,
        east: r.east,
        level: r.level,
        s: r.s,
        area: r.area,
        braidK: r.braidK,
        kind: r.kind,
      }))
    : [
        {
          id: 0,
          north: hydrology.river.north,
          east: hydrology.river.east,
          level: hydrology.river.level,
          s: hydrology.river.s,
        },
      ];

  for (const line of lines) {
    const count = line.north.length;
    if (count < 12) continue;
    if (line.area && line.area[count - 1] < MIN_GORGE_CATCHMENT_KM2) continue;

    let lastCheckedS = -1e9;
    for (let i = 4; i < count - 4; i++) {
      const sHere = line.s[i];
      if (sHere - lastCheckedS < 360) continue;
      lastCheckedS = sHere;

      const catchment = line.area ? line.area[i] : 65 + 0.16 * (sHere / 1000) * (sHere / 1000) + 1.8 * (sHere / 1000);
      if (catchment < MIN_GORGE_CATCHMENT_KM2) continue;
      if (line.braidK && line.braidK[i] > 1.25) continue;

      const n0 = line.north[i];
      const e0 = line.east[i];
      const dOrig = Math.hypot(n0, e0);
      if (dOrig < 5000 || dOrig > 25200) continue;

      const lvl = line.level[i];
      if (lvl < 5 || lvl > snowAt(n0, e0) - 260) continue;
      if (useRealTerrain && (hydrology.lakeMask?.at(n0, e0) ?? -Infinity) > -Infinity) continue;

      // Quick O(1) upstream backwater reach check along the channel profile: skip steep chutes that cannot back up >= 650 m!
      const refHead = 46;
      let jUp = i;
      while (jUp > 0 && line.level[jUp - 1] < lvl + refHead && sHere - line.s[jUp - 1] < 9500) {
        jUp--;
      }
      const quickBackwaterM = sHere - line.s[jUp];
      if (quickBackwaterM < MIN_RESERVOIR_LEN_M * 0.9) continue;

      const maxAllowedCrest = catchment >= MIN_TRUNK_CATCHMENT_KM2 ? MAX_TRUNK_CREST_M : MAX_GORGE_CREST_M;
      const maxHalf = maxAllowedCrest * 0.56;

      // Measure valley-aligned downstream tangent over +-220 m along the channel.
      let iBack = i;
      while (iBack > 0 && sHere - line.s[iBack] < 220) iBack--;
      let iFwd = i;
      while (iFwd < count - 1 && line.s[iFwd] - sHere < 220) iFwd++;
      const tdn = line.north[iFwd] - line.north[iBack];
      const tde = line.east[iFwd] - line.east[iBack];
      const tLen = Math.hypot(tdn, tde);
      if (tLen < 40) continue;
      const dn = tdn / tLen;
      const de = tde / tLen;
      const rn = -de;
      const re = dn;

      // Fast 3-point gorge screen before doing full cross-section & obstacle checks.
      const gCenter = bedAt(n0, e0);
      if (
        bedAt(n0 - rn * maxHalf, e0 - re * maxHalf) < gCenter + 25 ||
        bedAt(n0 + rn * maxHalf, e0 + re * maxHalf) < gCenter + 25
      ) {
        continue;
      }

      if (!settlementOk(n0, e0, 950, 620)) continue;
      if (!obstacleClearOfAirfields(n0, e0, lvl, 65)) continue;
      if (useRealTerrain && onRoadVerge(n0, e0, 90)) continue;

      // Locate true thalweg minimum within +-60 m.
      let minBed = gCenter;
      let bestV = 0;
      for (const v of [-48, -24, 24, 48]) {
        const g = bedAt(n0 + rn * v, e0 + re * v);
        if (g < minBed) {
          minBed = g;
          bestV = v;
        }
      }
      const cn = n0 + rn * bestV;
      const ce = e0 + re * bestV;
      const gw0 = groundAndWater(cn, ce);
      if (gw0.standing > gw0.ground - 0.5) continue;

      let maxLeft = -Infinity;
      let maxRight = -Infinity;
      let leftAt28 = -1;
      let rightAt28 = -1;
      for (let d = 24; d <= maxHalf + 36; d += 24) {
        const gl = bedAt(cn - rn * d, ce - re * d);
        if (gl > maxLeft) maxLeft = gl;
        if (leftAt28 < 0 && gl >= minBed + 28) leftAt28 = d;

        const gr = bedAt(cn + rn * d, ce + re * d);
        if (gr > maxRight) maxRight = gr;
        if (rightAt28 < 0 && gr >= minBed + 28) rightAt28 = d;
      }

      if (leftAt28 < 0 || rightAt28 < 0) continue;
      const widthAt28 = leftAt28 + rightAt28;
      if (widthAt28 > maxAllowedCrest) continue;

      const maxConfinedCrest = Math.min(maxLeft, maxRight) - 6.0;
      const maxWall = maxConfinedCrest - minBed;
      if (maxWall < MIN_WALL_HEIGHT_M) continue;

      // Verify downstream river continues falling.
      const tailH = Math.min(
        heightAt(cn + dn * 80, ce + de * 80),
        heightAt(cn + dn * 80 - rn * 24, ce + de * 80 - re * 24),
        heightAt(cn + dn * 80 + rn * 24, ce + de * 80 + re * 24),
      );
      if (tailH > Math.max(minBed, gw0.river) + 2.5) continue;

      // Exact channel backwater reach at this throat's achievable hydraulic head (`usableHead`): strongly rewards
      // narrow gorge outlets situated right below long, low-gradient upstream valley basins!
      const usableHead = Math.min(MAX_WALL_HEIGHT_M, maxWall) - FREEBOARD_M;
      let jHead = i;
      while (jHead > 0 && line.level[jHead - 1] < lvl + usableHead && sHere - line.s[jHead - 1] < 9800) {
        jHead--;
      }
      const upstreamReachM = Math.hypot(line.north[jHead] - cn, line.east[jHead] - ce);
      if (upstreamReachM < MIN_RESERVOIR_LEN_M * 0.85) continue;

      const heading = Math.atan2(de, dn);
      const expectedValleyW = 240 + 24 * Math.sqrt(catchment);
      const narrowness = expectedValleyW / Math.max(120, widthAt28);
      const prelimScore =
        Math.sqrt(upstreamReachM / 1000) * 42 +
        Math.log10(catchment) * 36 +
        narrowness * 24 +
        Math.min(52, maxWall) * 0.4;

      rawThroats.push({
        riverId: line.id,
        north: cn,
        east: ce,
        heading,
        dn,
        de,
        bedH: minBed,
        tailH,
        maxConfinedCrest,
        maxAllowedCrest,
        widthAt28,
        upstreamReachM,
        catchmentKm2: catchment,
        prelimScore,
      });
    }
  }

  if (rawThroats.length === 0) return [];

  // Keep the strongest throat per 1.7 km valley window and test up to 14 distinct gorge candidates.
  rawThroats.sort((a, b) => b.prelimScore - a.prelimScore);
  const distinctThroats: ThroatCandidate[] = [];
  for (const cand of rawThroats) {
    if (distinctThroats.some((d) => Math.hypot(d.north - cand.north, d.east - cand.east) < 1700)) continue;
    distinctThroats.push(cand);
    if (distinctThroats.length >= 14) break;
  }

  // -------------------------------------------------------------------------
  // 2. Coarse 88 m watertightness & reservoir lake-size evaluation
  // -------------------------------------------------------------------------
  const measureSpan = (
    cn: number,
    ce: number,
    rn: number,
    re: number,
    sign: -1 | 1,
    crestElev: number,
    maxHalf: number,
  ): number | null => {
    for (let d = 18; d <= maxHalf; d += 12) {
      const g = bedAt(cn + rn * (sign * d), ce + re * (sign * d));
      if (g >= crestElev + 1.2) {
        const gBack1 = bedAt(cn + rn * (sign * (d + 24)), ce + re * (sign * (d + 24)));
        const gBack2 = bedAt(cn + rn * (sign * (d + 52)), ce + re * (sign * (d + 52)));
        if (gBack1 >= crestElev + 1.8 && gBack2 >= crestElev + 2.2) {
          return d;
        }
      }
    }
    return null;
  };

  const CK_MAX = 115; // 115 * 88 m = 10,120 m upstream reach!
  const CK_DOWN = 2; // +176 m downstream flank leak detector
  const CC_MAX = 38; // +-3,344 m cross-valley reach!
  const C_ROWS = CK_MAX + CK_DOWN + 1;
  const C_COLS = 2 * CC_MAX + 1;
  const cGround = new Float32Array(C_ROWS * C_COLS);
  const cVisited = new Uint8Array(C_ROWS * C_COLS);
  const cQueue = new Int32Array(C_ROWS * C_COLS);

  interface ScreenedDam {
    throat: ThroatCandidate;
    kind: HydroDamKind;
    wallH: number;
    crestElev: number;
    waterLevel: number;
    leftSpan: number;
    rightSpan: number;
    crestLength: number;
    archSagitta: number;
    yardN: number;
    yardE: number;
    yardH: number;
    approxAreaKm2: number;
    coarseMinK: number;
    coarseMinC: number;
    coarseMaxC: number;
    score: number;
  }
  const screened: ScreenedDam[] = [];

  for (const throat of distinctThroats) {
    const { north: cn, east: ce, dn, de, bedH, tailH, maxConfinedCrest, maxAllowedCrest } = throat;
    const rn = -de;
    const re = dn;
    const maxHalf = maxAllowedCrest * 0.58;

    const topWall = Math.min(MAX_WALL_HEIGHT_M, Math.floor(maxConfinedCrest - bedH));
    const wallTrials: number[] = [];
    // Step down smoothly from `topWall` so if the maximum wall barely overtops a saddle rim, the level right below
    // that saddle still captures the largest possible watertight reservoir!
    for (const w of [topWall, Math.round(topWall * 0.86), Math.round(topWall * 0.72), 29]) {
      if (w >= MIN_WALL_HEIGHT_M && !wallTrials.some((x) => Math.abs(x - w) < 4)) wallTrials.push(w);
    }

    for (const wallH of wallTrials) {
      const crestElev = bedH + wallH;
      const waterLevel = crestElev - FREEBOARD_M;
      if (!obstacleClearOfAirfields(cn, ce, bedH, wallH + 26)) continue;

      const leftSpan = measureSpan(cn, ce, rn, re, -1, crestElev, maxHalf);
      const rightSpan = measureSpan(cn, ce, rn, re, 1, crestElev, maxHalf);
      if (leftSpan === null || rightSpan === null) continue;

      const crestLength = leftSpan + rightSpan;
      if (crestLength < MIN_CREST_LEN_M || crestLength > maxAllowedCrest) continue;
      if (crestLength / wallH > 34) continue;

      const kind: HydroDamKind =
        crestLength <= 400 && crestLength / wallH <= 11.5 ? 'arch' : 'gravity';
      const archSagitta = kind === 'arch' ? Math.round(Math.min(44, crestLength * 0.13)) : 0;

      cGround.fill(NaN);
      cVisited.fill(0);

      const worldNE = (k: number, c: number): [number, number] => {
        const v = c * COARSE_CELL_M;
        const u = reservoirGridU(leftSpan, rightSpan, archSagitta, COARSE_CELL_M, k, v);
        return [cn + dn * u + rn * v, ce + de * u + re * v];
      };

      const sampleCoarse = (k: number, c: number): number => {
        const idx = (k + CK_MAX) * C_COLS + (c + CC_MAX);
        let g = cGround[idx];
        if (g !== g) {
          const [wn, we] = worldNE(k, c);
          g = bedAt(wn, we);
          cGround[idx] = g;
        }
        return g;
      };

      const blockedByWall = (k: number, c: number): boolean => {
        if (k <= 0) return false;
        const v = c * COARSE_CELL_M;
        return v >= -leftSpan - COARSE_CELL_M * 1.5 && v <= rightSpan + COARSE_CELL_M * 1.5;
      };

      let qHead = 0;
      let qTail = 0;
      for (const kSeed of [-1, -2]) {
        for (const cSeed of [-1, 0, 1]) {
          if (sampleCoarse(kSeed, cSeed) < waterLevel - 0.5) {
            const sIdx = (kSeed + CK_MAX) * C_COLS + (cSeed + CC_MAX);
            if (!cVisited[sIdx]) {
              cVisited[sIdx] = 1;
              cQueue[qTail++] = sIdx;
            }
          }
        }
      }
      if (qTail === 0) continue;

      const maxCoarseCells = Math.ceil((MAX_RESERVOIR_AREA_KM2 * 1e6) / (COARSE_CELL_M * COARSE_CELL_M));
      let leaked = false;
      let wetCount = 0;
      let depthSumM = 0;
      let minK = 0;
      let minC = 0;
      let maxC = 0;

      while (qHead < qTail) {
        const cur = cQueue[qHead++];
        const r = Math.floor(cur / C_COLS);
        const col = cur % C_COLS;
        const k = r - CK_MAX;
        const c = col - CC_MAX;

        if (k > 0 || k <= -CK_MAX + 1 || Math.abs(c) >= CC_MAX - 1) {
          leaked = true;
          break;
        }
        wetCount++;
        depthSumM += Math.max(0, waterLevel - cGround[cur]);
        if (wetCount > maxCoarseCells) {
          leaked = true;
          break;
        }
        if (k < minK) minK = k;
        if (c < minC) minC = c;
        if (c > maxC) maxC = c;

        const [wn, we] = worldNE(k, c);
        if (!settlementOk(wn, we, 220, 180) || !obstacleClearOfAirfields(wn, we, waterLevel, 12)) {
          leaked = true;
          break;
        }
        if (useRealTerrain) {
          if (onRoadVerge(wn, we, 24)) {
            leaked = true;
            break;
          }
          sampleTerrain(wn, we, samp);
          // Reject if touching the sea (`standing <= 1`) or intersecting a higher perched lake (`standing > waterLevel`).
          if (samp.standing > samp.ground + 1.5 && (samp.standing <= 1.5 || samp.standing > waterLevel + 0.5)) {
            leaked = true;
            break;
          }
        }

        for (let dk = -1; dk <= 1; dk++) {
          for (let dc = -1; dc <= 1; dc++) {
            if (dk === 0 && dc === 0) continue;
            const nk = k + dk;
            const nc = c + dc;
            if (nk > CK_DOWN || nk < -CK_MAX || nc < -CC_MAX || nc > CC_MAX) {
              leaked = true;
              break;
            }
            if (blockedByWall(nk, nc)) continue;
            const nIdx = (nk + CK_MAX) * C_COLS + (nc + CC_MAX);
            if (cVisited[nIdx]) continue;
            if (sampleCoarse(nk, nc) < waterLevel) {
              cVisited[nIdx] = 1;
              cQueue[qTail++] = nIdx;
            }
          }
          if (leaked) break;
        }
        if (leaked) break;
      }

      if (leaked) continue;

      const cellAreaM2 = COARSE_CELL_M * COARSE_CELL_M;
      const approxAreaKm2 = (wetCount * cellAreaM2) / 1e6;
      const volumeMm3 = (depthSumM * cellAreaM2) / 1e6;
      const approxLenM = -minK * COARSE_CELL_M;
      if (approxAreaKm2 < MIN_RESERVOIR_AREA_KM2 * 0.85 || approxLenM < MIN_RESERVOIR_LEN_M * 0.85) continue;

      // Find downstream switchyard pad on dry terrace / valley bench well clear of the dam keep-out (`u >= 115 m`).
      let bestYard: { n: number; e: number; h: number; score: number } | null = null;
      for (let uOff = 120; uOff <= 380; uOff += 40) {
        for (let vOff = -320; vOff <= 320; vOff += 40) {
          if (Math.abs(vOff) < 32 && uOff < 150) continue;
          const yn = cn + dn * uOff + rn * vOff;
          const ye = ce + de * uOff + re * vOff;
          const ygw = groundAndWater(yn, ye);
          const wetHere =
            ygw.ground <= 1.8 ||
            (ygw.standing > -1e6 && ygw.ground <= ygw.standing + 1.2) ||
            (ygw.river > -1e6 && ygw.ground <= ygw.river + 1.2);
          if (wetHere || ygw.ground > crestElev + 55) continue;
          if (!obstacleClearOfAirfields(yn, ye, ygw.ground, 48)) continue;
          if (!settlementOk(yn, ye, 240, 180)) continue;
          if (useRealTerrain && onRoadVerge(yn, ye, 36)) continue;

          const slN = bedAt(yn + 24, ye) - bedAt(yn - 24, ye);
          const slE = bedAt(yn, ye + 24) - bedAt(yn, ye - 24);
          const sl = Math.hypot(slN, slE) / 48;
          if (sl > 0.25) continue;

          const yScore = sl * 12 + uOff / 900 + Math.abs(ygw.ground - (tailH + 10)) / 120;
          if (!bestYard || yScore < bestYard.score) {
            bestYard = { n: yn, e: ye, h: ygw.ground, score: yScore };
          }
        }
      }
      if (!bestYard) continue;

      // Score strongly rewards LARGER IMPOUNDED LAKES (surface area km² + storage volume Mm³ + length km) alongside
      // substantial catchment area and a narrow confining gorge throat!
      const expectedValleyW = 240 + 24 * Math.sqrt(throat.catchmentKm2);
      const narrowness = expectedValleyW / Math.max(120, crestLength);
      const lakeSizeScore =
        Math.sqrt(approxAreaKm2) * 56 +
        Math.log10(1 + volumeMm3) * 26 +
        Math.min(24, (approxLenM / 1000) * 5.5);
      const score =
        lakeSizeScore +
        Math.log10(throat.catchmentKm2) * 32 +
        narrowness * 24;

      screened.push({
        throat,
        kind,
        wallH,
        crestElev,
        waterLevel,
        leftSpan,
        rightSpan,
        crestLength,
        archSagitta,
        yardN: bestYard.n,
        yardE: bestYard.e,
        yardH: bestYard.h,
        approxAreaKm2,
        coarseMinK: minK,
        coarseMinC: minC,
        coarseMaxC: maxC,
        score,
      });
      break; // `wallTrials` is descending, so the first watertight height gives the largest possible lake at this throat!
    }
  }

  if (screened.length === 0) return [];

  // -------------------------------------------------------------------------
  // 3. Occasional selection + fine shoreline grid build ONLY for winners!
  // -------------------------------------------------------------------------
  screened.sort((a, b) => b.score - a.score);
  const chosen: HydroDamSite[] = [];

  for (const cand of screened) {
    // High bar so only genuinely impressive lake + gorge + catchment combinations are built (0..2 per world).
    const minQuality = chosen.length === 0 ? 142 : 172;
    if (cand.score < minQuality) continue;
    if (chosen.some((d) => Math.hypot(d.north - cand.throat.north, d.east - cand.throat.east) < 10500)) continue;

    // Adaptive fine mesh spacing: 22 m for lakes <= 2.4 km², 28 m for huge multi-km² reservoirs so mesh size stays trim.
    const CELL = cand.approxAreaKm2 > 2.4 ? 28 : RESERVOIR_CELL_M;
    const ratio = Math.ceil(COARSE_CELL_M / CELL);
    const { throat, leftSpan, rightSpan, archSagitta, waterLevel } = cand;
    const { north: cn, east: ce, dn, de } = throat;
    const rn = -de;
    const re = dn;

    const uMinBound = Math.max(-420, cand.coarseMinK * ratio - 6);
    const vMinBound = Math.max(-140, cand.coarseMinC * ratio - 6);
    const vMaxBound = Math.min(140, cand.coarseMaxC * ratio + 6);
    const kDown = 3;
    const bRows = kDown - uMinBound + 1;
    const bCols = vMaxBound - vMinBound + 1;
    const fGround = new Float32Array(bRows * bCols).fill(NaN);
    const fVisited = new Uint8Array(bRows * bCols);
    const fQueue = new Int32Array(bRows * bCols);

    const sampleFine = (k: number, c: number): number => {
      const idx = (k - uMinBound) * bCols + (c - vMinBound);
      let g = fGround[idx];
      if (g !== g) {
        const v = c * CELL;
        const u = reservoirGridU(leftSpan, rightSpan, archSagitta, CELL, k, v);
        g = bedAt(cn + dn * u + rn * v, ce + de * u + re * v);
        fGround[idx] = g;
      }
      return g;
    };

    let qH = 0;
    let qT = 0;
    for (const kS of [-1, -2, -3]) {
      for (const cS of [-2, -1, 0, 1, 2]) {
        if (kS < uMinBound || cS < vMinBound || cS > vMaxBound) continue;
        if (sampleFine(kS, cS) < waterLevel - 0.4) {
          const sIdx = (kS - uMinBound) * bCols + (cS - vMinBound);
          if (!fVisited[sIdx]) {
            fVisited[sIdx] = 1;
            fQueue[qT++] = sIdx;
          }
        }
      }
    }
    if (qT === 0) continue;

    let fineLeaked = false;
    let fineWet = 0;
    let minK = 0;
    let minC = 0;
    let maxC = 0;

    while (qH < qT) {
      const cur = fQueue[qH++];
      const r = Math.floor(cur / bCols);
      const col = cur % bCols;
      const k = uMinBound + r;
      const c = vMinBound + col;

      if (k > 0 || k <= uMinBound || c <= vMinBound || c >= vMaxBound) {
        fineLeaked = true;
        break;
      }
      fineWet++;
      if (k < minK) minK = k;
      if (c < minC) minC = c;
      if (c > maxC) maxC = c;

      for (let dk = -1; dk <= 1; dk++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dk === 0 && dc === 0) continue;
          const nk = k + dk;
          const nc = c + dc;
          if (nk > kDown || nk < uMinBound || nc < vMinBound || nc > vMaxBound) {
            fineLeaked = true;
            break;
          }
          if (nk > 0 && nc * CELL >= -leftSpan - CELL * 2 && nc * CELL <= rightSpan + CELL * 2) continue;
          const nIdx = (nk - uMinBound) * bCols + (nc - vMinBound);
          if (fVisited[nIdx]) continue;
          if (sampleFine(nk, nc) < waterLevel) {
            fVisited[nIdx] = 1;
            fQueue[qT++] = nIdx;
          }
        }
        if (fineLeaked) break;
      }
      if (fineLeaked) break;
    }

    if (fineLeaked) continue;
    const reservoirAreaKm2 = (fineWet * CELL * CELL) / 1e6;
    const reservoirLengthM = -minK * CELL;
    if (reservoirAreaKm2 < MIN_RESERVOIR_AREA_KM2 || reservoirLengthM < MIN_RESERVOIR_LEN_M) continue;

    const uMin = Math.max(uMinBound, minK - 2);
    const vMin = Math.max(vMinBound, minC - 2);
    const vMax = Math.min(vMaxBound, maxC + 2);
    const rows = 1 - uMin;
    const cols = vMax - vMin + 1;
    const mask = new Uint8Array(rows * cols);
    const ground = new Float32Array(rows * cols);

    for (let r = 0; r < rows; r++) {
      const k = uMin + r;
      for (let c = 0; c < cols; c++) {
        const col = vMin + c;
        const dst = r * cols + c;
        const src = (k - uMinBound) * bCols + (col - vMinBound);
        ground[dst] = sampleFine(k, col);
        if (fVisited[src]) mask[dst] = 1;
      }
    }
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const dst = r * cols + c;
        if (mask[dst] !== 0) continue;
        let adjWet = false;
        for (let dr = -1; dr <= 1 && !adjWet; dr++) {
          for (let dc = -1; dc <= 1 && !adjWet; dc++) {
            const nr = r + dr;
            const nc = c + dc;
            if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && mask[nr * cols + nc] === 1) {
              adjWet = true;
            }
          }
        }
        if (adjWet) mask[dst] = 2;
      }
    }

    chosen.push({
      id: `dam-${chosen.length + 1}`,
      kind: cand.kind,
      north: cn,
      east: ce,
      heading: throat.heading,
      bedElevation: throat.bedH,
      tailwaterElevation: Math.max(throat.bedH, throat.tailH),
      waterLevel,
      crestElevation: cand.crestElev,
      wallHeight: cand.wallH,
      leftSpan,
      rightSpan,
      crestLength: cand.crestLength,
      archSagitta,
      catchmentKm2: Math.round(throat.catchmentKm2),
      reservoirAreaKm2: Number(reservoirAreaKm2.toFixed(3)),
      reservoirLengthM,
      switchyardNorth: cand.yardN,
      switchyardEast: cand.yardE,
      switchyardElevation: cand.yardH,
      reservoir: {
        originN: cn,
        originE: ce,
        dn,
        de,
        cell: CELL,
        uMin,
        vMin,
        vMax,
        rows,
        cols,
        mask,
        ground,
      },
    });
    if (chosen.length >= 2) break;
  }

  return chosen;
}

/**
 * Convert a `HydroDamSite`'s reservoir grid into a compact, worker-transferable `ReservoirClearing` record.
 */
export function damToReservoirClearing(dam: HydroDamSite): ReservoirClearing {
  const r = dam.reservoir;
  const rn = -r.de;
  const re = r.dn;
  let minN = Infinity;
  let maxN = -Infinity;
  let minE = Infinity;
  let maxE = -Infinity;
  for (const k of [r.uMin, 0]) {
    for (const c of [r.vMin, 0, r.vMax]) {
      const v = c * r.cell;
      const u = reservoirGridU(dam.leftSpan, dam.rightSpan, dam.archSagitta, r.cell, k, v);
      const n = r.originN + r.dn * u + rn * v;
      const e = r.originE + r.de * u + re * v;
      if (n < minN) minN = n;
      if (n > maxN) maxN = n;
      if (e < minE) minE = e;
      if (e > maxE) maxE = e;
    }
  }
  const pad = r.cell * 3 + dam.archSagitta + 35;
  return {
    originN: r.originN,
    originE: r.originE,
    dn: r.dn,
    de: r.de,
    cell: r.cell,
    uMin: r.uMin,
    vMin: r.vMin,
    vMax: r.vMax,
    rows: r.rows,
    cols: r.cols,
    waterLevel: dam.waterLevel,
    archSagitta: dam.archSagitta,
    leftSpan: dam.leftSpan,
    rightSpan: dam.rightSpan,
    mask: r.mask,
    minN: minN - pad,
    maxN: maxN + pad,
    minE: minE - pad,
    maxE: maxE + pad,
  };
}
