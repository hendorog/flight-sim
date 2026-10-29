// Tree placement for one square vegetation cell. Pure and deterministic (runs in the tile workers):
// the same biome function that paints the forest floor decides where trees stand, so the two agree.
//
// Candidates sit on a jittered lattice; each is accepted with a probability from the forest density
// (interpolated from a coarser lattice for speed), plus a sprinkle of lone trees near woods and
// hedgerow trees and shrubs along the hedged field edges of farmland (fields.ts). Every
// tree gets a random rank; instances are sorted by rank so distant LODs can draw a thinned prefix.

import { computeBiome, CoverShapeField, makeBiome, makeCoverShape } from '../biome';
import { GALLERY_FAR, GALLERY_FLOOR, GALLERY_NEAR, GALLERY_SCRUB, RIPARIAN_FAR, RIPARIAN_NEAR, riparianPresence } from '../riparian';
import { makeSample, sampleTerrain } from '../heightfield';
import { COLUMN_M, columnEdge, districtHasBelts, edgeRandom, isShelterbelt, makeParcel, parcelAt } from '../fields';
import { fbm, hash2i } from '../noise';
import { inTownClearZone } from '../townMask';
import { CLEARFELL_YEARS, compartmentAt, PLANT_EUC_ID, PLANT_FIR_ID, makeCompartment, standHeight, type Compartment } from '../plantation';
import { era } from '../../era/eraState';
import { FLORA } from './flora';

export interface TreeCellRequest {
  cx: number;
  cz: number;
  /** Cell edge length, m. Cell (cx, cz) covers east [cx*size, ...), north [cz*size, ...). */
  size: number;
  /** Mean spacing of candidate positions in dense forest, m. */
  spacing: number;
}

/** Floats per instance in TreeCellData.instances. */
export const TREE_STRIDE = 6;

export interface TreeCellData {
  cx: number;
  cz: number;
  /**
   * Per tree: east, ground height, north, tree height (m), yaw (rad), species + 0.99 * rank; outside closed
   * forest, species + SPECIES_COUNT + 0.99 * OPEN_RANK * rank.
   * The trees outside closed forest first (openCount of them), then those in it, each sorted by rank,
   * ascending: the impostors keep a rank-sorted prefix of each part, by their own laws (VegetationSystem).
   */
  instances: Float32Array;
  count: number;
  openCount: number;
  /**
   * The same trees grouped by BUCKETS x BUCKETS sub-squares of the cell (index = bz * BUCKETS + bx, bx
   * east, bz north): order[bucketStart[b] .. bucketStart[b + 1]) are the instance indices in bucket b.
   * Lets a fully drawn cell be written roughly front to back (VegetationSystem).
   */
  order: Uint16Array;
  bucketStart: Uint16Array;
}

/** Sub-squares per cell side in TreeCellData.order. */
export const BUCKETS = 8;

/** Species indices; see treeModels.ts. */
export const SPECIES = { spruce: 0, pine: 1, oak: 2, birch: 3, poplar: 4, macrocarpa: 5, willow: 6, eucalypt: 7 } as const;
export const SPECIES_COUNT = 8;

const LATTICE = 16;
/**
 * Rank scale of the trees that show (hedgerows, bankside, lone and scattered trees, forest density under
 * 0.5, and the forest's edge trees, within EDGE_REACH of land where it drops below that). They are the ones
 * seen against fields and sky; a forest's interior is seen as a canopy, which the terrain's canopy shell
 * stands in for. The impostors thin out by rank with distance: scaling the rank keeps these to
 * (1 / OPEN_RANK)^(2/3), about 2.5 times, the distance of interior trees (they are about a quarter of all
 * trees), and they keep their meshes further (VegetationSystem nearOpen). The terrain's stand-in for the
 * ones not drawn follows the same law (terrainMaterial.ts).
 */
export const OPEN_RANK = 0.25;
/** A forest tree within this distance of land under forest density 0.5 is an edge tree (OPEN_RANK), m. */
const EDGE_REACH = 25;
/** Lattice samples beyond the cell on each side, for the edge test. */
const EDGE_MARGIN = Math.ceil(EDGE_REACH / LATTICE);
const sample = makeSample();
const biome = makeBiome();
const parcel = makeParcel();
const shape = makeCoverShape();
const shapeField = new CoverShapeField();

const rnd = (h: number, salt: number): number => hash2i(h, salt) / 4294967296;

export function buildTreeCell(req: TreeCellRequest): TreeCellData {
  if (era().flora !== 'present') return buildTreeCellEra(req);
  const { cx, cz, size, spacing } = req;
  const e0 = cx * size;
  const n0 = cz * size;

  // Forest density on a coarse lattice (with slope from neighbouring samples), bilinearly interpolated.
  const m = Math.ceil(size / LATTICE) + 1;
  // For the edge test, the density also on EDGE_MARGIN samples beyond the cell on each side.
  const M = EDGE_MARGIN;
  const mx = m + 2 * M;
  const densX = new Float32Array(mx * mx);
  // Landform on the same world lattice the terrain tiles use, so trees and ground agree.
  shapeField.build(n0 - M * LATTICE, e0 - M * LATTICE, n0 + (m - 1 + M) * LATTICE, e0 + (m - 1 + M) * LATTICE);
  const dens = new Float32Array(m * m);
  const cons = new Float32Array(m * m);
  const farm = new Float32Array(m * m);
  // Distance from the river's water edge (m, large away from it) for the bankside trees.
  const bank = new Float32Array(m * m);
  // Forestry plantation estate weight (biome.ts; over 0.5 the estate's compartments are planted in rows below).
  const plant = new Float32Array(m * m);
  for (let jx = 0; jx < mx; jx++) {
    for (let ix = 0; ix < mx; ix++) {
      const i = ix - M;
      const j = jx - M;
      const north = n0 + j * LATTICE;
      const east = e0 + i * LATTICE;
      sampleTerrain(north, east, sample);
      shapeField.at(north, east, shape);
      computeBiome(north, east, sample, shape.up, biome, shape.north);
      densX[jx * mx + ix] = biome.forest;
      if (i < 0 || j < 0 || i >= m || j >= m) continue;
      dens[j * m + i] = biome.forest;
      farm[j * m + i] = biome.farmland;
      plant[j * m + i] = biome.plantation;
      bank[j * m + i] = sample.riverHalfWidth > 0 ? Math.min(1e4, sample.riverDist - sample.riverHalfWidth) : 1e4;
      // Conifer share: more with altitude and on dry ground, plus planted conifer stands in lowland woods.
      const stand = fbm(east / 900 + 4.1, north / 900 - 2.3, 2);
      cons[j * m + i] = Math.min(1, Math.max(0, 0.15 + (sample.ground - 450) / 900 + 0.35 * (0.5 - biome.moisture) + 1.5 * (stand - 0.1)));
    }
  }
  const lerp2 = (arr: Float32Array, fx: number, fz: number): number => {
    const i = Math.min(m - 2, Math.floor(fx));
    const j = Math.min(m - 2, Math.floor(fz));
    const tx = fx - i;
    const tz = fz - j;
    const a = arr[j * m + i] + (arr[j * m + i + 1] - arr[j * m + i]) * tx;
    const b = arr[(j + 1) * m + i] + (arr[(j + 1) * m + i + 1] - arr[(j + 1) * m + i]) * tx;
    return a + (b - a) * tz;
  };

  // Whether land under forest density 0.5 lies within EDGE_REACH of lattice position (fx, fz): the lowest
  // density of the lattice samples within reach (each bilinear corner can only lie between them).
  const reach = EDGE_REACH / LATTICE;
  const nearOpenLand = (fx: number, fz: number): boolean => {
    for (let j = Math.ceil(fz - reach); j <= Math.floor(fz + reach); j++) {
      for (let i = Math.ceil(fx - reach); i <= Math.floor(fx + reach); i++) {
        if ((i - fx) ** 2 + (j - fz) ** 2 <= reach * reach && densX[(j + M) * mx + i + M] < 0.5) return true;
      }
    }
    return false;
  };

  const per = Math.round(size / spacing);
  const out: number[] = [];
  for (let j = 0; j < per; j++) {
    for (let i = 0; i < per; i++) {
      // Global lattice indices make the hash independent of the cell size and position.
      const gi = cx * per + i;
      const gj = cz * per + j;
      const h0 = hash2i(gi, gj);
      // Full-cell jitter: neighbours may nearly touch, and no lattice rows show in dense stands.
      const east = e0 + (i + rnd(h0, 1)) * spacing;
      const north = n0 + (j + rnd(h0, 2)) * spacing;
      const fx = (east - e0) / LATTICE;
      const fz = (north - n0) / LATTICE;
      // Plantation estates are planted in rows (below), not scattered.
      if (lerp2(plant, fx, fz) > 0.5) continue;
      const f = lerp2(dens, fx, fz);
      // Dense stands where f is high, scattered trees at the edges, rare lone trees in open land.
      const p = f < 0.2 ? 0 : Math.min(1, (f - 0.2) * 1.6);
      const lone = f < 0.1 ? 0 : 0.004;
      const u = rnd(h0, 3);
      // Hedgerows: trees and bushes along the field edges the ground shader paints as hedges.
      let hedge = false;
      if (p < 0.05 && lerp2(farm, fx, fz) > 0.2) {
        parcelAt(east, north, parcel);
        // A hedgerow: shrubs and trees along most of its length (the painted hedge is a band about 4 m
        // wide, so each candidate on it stands for a few metres of hedge).
        // (A shelterbelt, planted below, replaces any hedge along its boundary.)
        hedge = parcel.shelter < 6 ? false : parcel.hedge < 2.2 ? u < 0.85 : parcel.margin < 3 && u < 0.004;
      }
      // Bankside trees (willow, poplar, with birch and oak standing in for alder and ash): a wooded bank from the
      // water's edge out to GALLERY_FAR, thinning a little toward the fields, with few gaps (fewer trees where
      // riparianPresence is low; the water shader reflects the same trees), scrub in its first metres.
      let riparian = false;
      let scrub = false;
      if (!hedge && u >= p + lone) {
        const be = lerp2(bank, fx, fz);
        if (be > GALLERY_NEAR - 4 && be < GALLERY_FAR + 4) {
          sampleTerrain(north, east, sample);
          const edge = sample.riverDist - sample.riverHalfWidth;
          if (sample.riverHalfWidth > 0 && edge > GALLERY_NEAR && edge < GALLERY_FAR) {
            const pr = riparianPresence(sample.riverArc, Math.sign(sample.riverSigned));
            const t = (edge - GALLERY_NEAR) / (GALLERY_FAR - GALLERY_NEAR);
            riparian = u < 0.95 * (GALLERY_FLOOR + (1 - GALLERY_FLOOR) * pr) * (1 - 0.45 * t * t);
            scrub = riparian && edge < GALLERY_SCRUB && rnd(h0, 11) < 0.6;
          }
        }
        if (!riparian) continue;
      }
      // No trees in the valley town (hedgerows of its paddocks included).
      if (inTownClearZone(north, east)) continue;
      sampleTerrain(north, east, sample);
      if (sample.ground < Math.max(sample.standing, sample.river) + 1 || sample.airportBlend < 0.98 || sample.approach > 0) continue;
      // Never in the river channel (nor on the first metres of its bank), whatever the coarse lattice says.
      if (sample.riverHalfWidth > 0 && sample.riverDist < sample.riverHalfWidth + (scrub ? 1.2 : 2.5)) continue;
      let species: number;
      let height: number;
      if (scrub) {
        // Bank scrub: young willows, birch and bramble-height bushes (oak) down to the water.
        const r = rnd(h0, 5);
        species = r < 0.55 ? SPECIES.willow : r < 0.8 ? SPECIES.birch : SPECIES.oak;
        height = 2.5 + 4.5 * rnd(h0, 6);
      } else if (riparian) {
        const r = rnd(h0, 5);
        species = r < 0.4 ? SPECIES.willow : r < 0.48 ? SPECIES.poplar : r < 0.75 ? SPECIES.birch : SPECIES.oak;
        height = species === SPECIES.willow ? 8 + 6 * rnd(h0, 6) : species === SPECIES.poplar ? 15 + 12 * rnd(h0, 6) : 7 + 11 * rnd(h0, 6);
      } else if (hedge) {
        const r = rnd(h0, 5);
        species = r < 0.45 ? SPECIES.oak : r < 0.65 ? SPECIES.macrocarpa : r < 0.75 ? SPECIES.birch : r < 0.85 ? SPECIES.poplar : r < 0.95 ? SPECIES.spruce : SPECIES.eucalypt;
        // Half are shrubs; the rest hedgerow trees (a poplar or eucalypt is always a tree, and a tall one).
        const tall = species === SPECIES.poplar || species === SPECIES.eucalypt;
        height = tall ? 14 + 12 * rnd(h0, 9) : rnd(h0, 6) < 0.5 ? 3.5 + 3 * rnd(h0, 9) : 7 + 9 * rnd(h0, 9);
      } else {
        const conifer = rnd(h0, 4) < lerp2(cons, fx, fz);
        const r = rnd(h0, 5);
        // In the open (scattered and lone trees in paddocks) gums and macrocarpas join them.
        const paddock = f < 0.5 && rnd(h0, 10) < 0.35;
        species = paddock
          ? (conifer ? SPECIES.macrocarpa : SPECIES.eucalypt)
          : conifer ? (r < 0.7 ? SPECIES.spruce : SPECIES.pine) : r < 0.6 ? SPECIES.oak : r < 0.9 ? SPECIES.birch : SPECIES.eucalypt;
        // Heights (m): forest-grown conifers 14-28, broadleaves 10-22, gums 16-34; edge and lone trees a bit
        // shorter.
        const vigour = 0.75 + 0.25 * Math.min(1, f * 1.5);
        const base = species === SPECIES.eucalypt ? 16 + 18 * rnd(h0, 6) : species === SPECIES.macrocarpa ? 9 + 11 * rnd(h0, 6) : conifer ? 14 + 14 * rnd(h0, 6) : 10 + 12 * rnd(h0, 6);
        height = base * vigour;
      }
      const open = hedge || riparian || f < 0.5 || nearOpenLand(fx, fz);
      out.push(east, sample.ground, north, height, rnd(h0, 7) * Math.PI * 2, species + (open ? SPECIES_COUNT : 0) + 0.99 * rnd(h0, 8) * (open ? OPEN_RANK : 1));
    }
  }

  plantRows(e0, n0, size, spacing, m, plant, dens, lerp2, nearOpenLand, out);
  plantShelterbelts(e0, n0, size, m, farm, plant, lerp2, out);
  return finishCell(cx, cz, size, out);
}

const comp = makeCompartment();
const rowComp = makeCompartment();

/**
 * Plantation compartments in this cell: each planted on its own grid (rows ROW_SPACING x spacing apart, trees along
 * them TREE_SPACING x spacing apart, wider once thinned), turned to its row direction, the trees all of the
 * compartment's age. A few are missing, a strip along every compartment border is left for the forestry roads and
 * firebreaks, and fresh clear-fells carry none. One species a compartment (plantation.ts PLANT_FIR_ID): mostly radiata
 * pine, some Douglas-fir (the spruce model) and eucalypt.
 */
function plantRows(e0: number, n0: number, size: number, spacing: number, m: number, plant: Float32Array, dens: Float32Array,
  lerp2: (a: Float32Array, fx: number, fz: number) => number, nearOpenLand: (fx: number, fz: number) => boolean, out: number[]): void {
  // The compartments that reach into the cell: probe it on a coarse grid.
  const found = new Map<string, Compartment>();
  const step = size / 8;
  for (let j = 0; j <= 8; j++)
    for (let i = 0; i <= 8; i++) {
      const fx = Math.min(m - 1, (i * step) / LATTICE);
      const fz = Math.min(m - 1, (j * step) / LATTICE);
      if (lerp2(plant, fx, fz) <= 0.5) continue;
      compartmentAt(e0 + i * step, n0 + j * step, comp);
      const key = `${comp.cellX},${comp.cellY}`;
      if (!found.has(key) && comp.years >= CLEARFELL_YEARS) found.set(key, { ...comp });
    }
  for (const c of found.values()) {
    const thinned = smoothstep(10, 16, c.years);
    const along = spacing * (TREE_SPACING + 0.4 * thinned);
    const across = spacing * (ROW_SPACING + 0.3 * thinned);
    const ue = Math.cos(c.angle);
    const un = Math.sin(c.angle);
    // The cell's corners in the compartment's row frame: a along the rows, b across them.
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const [de, dn] of [[0, 0], [size, 0], [0, size], [size, size]]) {
      const re = e0 + de - c.siteE;
      const rn = n0 + dn - c.siteN;
      const a = re * ue + rn * un;
      const b = -re * un + rn * ue;
      a0 = Math.min(a0, a); a1 = Math.max(a1, a); b0 = Math.min(b0, b); b1 = Math.max(b1, b);
    }
    const height = standHeight(c.years);
    const species = c.id < PLANT_FIR_ID ? SPECIES.pine : c.id < PLANT_EUC_ID ? SPECIES.spruce : SPECIES.eucalypt;
    for (let bj = Math.ceil(b0 / across); bj <= Math.floor(b1 / across); bj++) {
      for (let ai = Math.ceil(a0 / along); ai <= Math.floor(a1 / along); ai++) {
        const h0 = hash2i(ai * 31 + c.cellX * 7919, bj * 37 + c.cellY * 104729);
        if (rnd(h0, 1) < 0.04) continue;
        const a = ai * along + 0.25 * (rnd(h0, 2) - 0.5);
        const b = bj * across + 0.25 * (rnd(h0, 3) - 0.5);
        const east = c.siteE + a * ue - b * un;
        const north = c.siteN + a * un + b * ue;
        if (east < e0 || east >= e0 + size || north < n0 || north >= n0 + size) continue;
        const fx = (east - e0) / LATTICE;
        const fz = (north - n0) / LATTICE;
        if (lerp2(plant, fx, fz) <= 0.5) continue;
        const f = lerp2(dens, fx, fz);
        if (f < 0.25) continue;
        compartmentAt(east, north, rowComp);
        if (rowComp.cellX !== c.cellX || rowComp.cellY !== c.cellY || rowComp.border < ROAD_HALF_WIDTH) continue;
        if (inTownClearZone(north, east)) continue;
        sampleTerrain(north, east, sample);
        if (sample.ground < Math.max(sample.standing, sample.river) + 1 || sample.airportBlend < 0.98 || sample.approach > 0) continue;
        if (sample.riverHalfWidth > 0 && sample.riverDist < sample.riverHalfWidth + 2.5) continue;
        const open = rowComp.border < 15 || c.years < 7 || f < 0.5 || nearOpenLand(fx, fz);
        // Ordered rank, not random: as the impostors thin with distance whole rows go (every other one, then
        // every fourth), then every other tree along those left, so what remains is still planted in rows.
        const rank = (BIT_REV4[((bj % 4) + 4) % 4] + (BIT_REV4[((ai % 4) + 4) % 4] + 0.9 * rnd(h0, 6)) / 4) / 4;
        out.push(east, sample.ground, north, height * (0.9 + 0.2 * rnd(h0, 4)), rnd(h0, 5) * Math.PI * 2,
          species + (open ? SPECIES_COUNT : 0) + 0.99 * rank * (open ? OPEN_RANK : 1));
      }
    }
  }
}

const beltParcel = makeParcel();
const beltProbe = makeParcel();

/**
 * Shelterbelts (fields.ts): a single row along each shelterbelt boundary of the field pattern through this cell, one
 * species and about one height per belt - tall Lombardy poplars, a dense dark wall of macrocarpa (often kept trimmed),
 * or pines - evenly spaced, a few gaps. Only where the land either side is farmland. Like the plantation rows, the
 * row thins with distance a tree in two, then in four, so a far belt still reads as a line.
 */
function plantShelterbelts(e0: number, n0: number, size: number, m: number, farm: Float32Array, plant: Float32Array,
  lerp2: (a: Float32Array, fx: number, fz: number) => number, out: number[]): void {
  const seen = new Set<string>();
  for (const [de, dn] of [[0.5, 0.5], [0, 0], [1, 0], [0, 1], [1, 1]]) {
    parcelAt(e0 + de * size, n0 + dn * size, beltParcel);
    const dx = beltParcel.districtX;
    const dy = beltParcel.districtY;
    const key = `${dx},${dy}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!districtHasBelts(dx, dy)) continue;
    const { angle, dseed } = beltParcel;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    // The cell in the district's frame: x across the columns, y along them.
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const [ce, cn] of [[e0, n0], [e0 + size, n0], [e0, n0 + size], [e0 + size, n0 + size]]) {
      const qx = c * ce + s * cn;
      const qy = -s * ce + c * cn;
      x0 = Math.min(x0, qx); x1 = Math.max(x1, qx); y0 = Math.min(y0, qy); y1 = Math.max(y1, qy);
    }
    for (let k = Math.floor(x0 / COLUMN_M) - 1; k <= Math.floor(x1 / COLUMN_M) + 1; k++) {
      if (!isShelterbelt(k, dseed)) continue;
      const x = columnEdge(k, dseed);
      if (x < x0 || x > x1) continue;
      const r = edgeRandom(k, dseed, 0);
      const species = r < 0.4 ? SPECIES.poplar : r < 0.75 ? SPECIES.macrocarpa : SPECIES.pine;
      const along = species === SPECIES.poplar ? 4.5 : species === SPECIES.macrocarpa ? 3.2 : 4;
      const tall = species === SPECIES.poplar ? 17 + 9 * edgeRandom(k, dseed, 1) : species === SPECIES.macrocarpa ? 7 + 9 * edgeRandom(k, dseed, 1) : 13 + 8 * edgeRandom(k, dseed, 1);
      for (let j = Math.ceil(y0 / along); j * along <= y1; j++) {
        const qy = j * along;
        const east = c * x - s * qy;
        const north = s * x + c * qy;
        if (east < e0 || east >= e0 + size || north < n0 || north >= n0 + size) continue;
        const h0 = hash2i(k * 7 + j, dseed + 99);
        if (rnd(h0, 1) < 0.03) continue;
        const fx = (east - e0) / LATTICE;
        const fz = (north - n0) / LATTICE;
        if (lerp2(farm, fx, fz) < 0.2 || lerp2(plant, fx, fz) > 0.3) continue;
        // Still this district's boundary here (not across a lane into the next district), and off the lanes.
        parcelAt(east, north, beltProbe);
        if (beltProbe.districtX !== dx || beltProbe.districtY !== dy || beltProbe.shelter > 1 || beltProbe.border < 6) continue;
        if (inTownClearZone(north, east)) continue;
        sampleTerrain(north, east, sample);
        if (sample.ground < Math.max(sample.standing, sample.river) + 1 || sample.airportBlend < 0.98 || sample.approach > 0) continue;
        if (sample.riverHalfWidth > 0 && sample.riverDist < sample.riverHalfWidth + GALLERY_FAR) continue;
        const rank = (BIT_REV4[((j % 4) + 4) % 4] + 0.9 * rnd(h0, 2)) / 4;
        out.push(east + 0.3 * (rnd(h0, 3) - 0.5), sample.ground, north + 0.3 * (rnd(h0, 4) - 0.5), tall * (0.92 + 0.16 * rnd(h0, 5)), rnd(h0, 6) * Math.PI * 2,
          species + SPECIES_COUNT + 0.99 * rank * OPEN_RANK);
      }
    }
  }
}

/** Bit-reversed 0..3: the order rows (and trees along them) are kept in as the plantation thins. */
const BIT_REV4 = [0, 2, 1, 3];
/** Plantation spacing in multiples of the forest candidate spacing: along the rows, and between them. */
const TREE_SPACING = 0.75;
const ROW_SPACING = 1.0;
/** Half-width of the unplanted strip along compartment borders (roads, firebreaks), m. */
const ROAD_HALF_WIDTH = 4;

const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Sorts a cell's instances (open trees first, then forest trees, each by rank) and buckets them. */
function finishCell(cx: number, cz: number, size: number, out: number[]): TreeCellData {
  const e0 = cx * size;
  const n0 = cz * size;
  const count = out.length / TREE_STRIDE;
  const order = Array.from({ length: count }, (_, k) => k);
  const isOpen = (k: number): number => (out[k * TREE_STRIDE + 5] >= SPECIES_COUNT ? 0 : 1);
  const rank = (k: number): number => {
    const v = out[k * TREE_STRIDE + 5];
    return v - Math.floor(v);
  };
  order.sort((a, b) => isOpen(a) - isOpen(b) || rank(a) - rank(b));
  let openCount = 0;
  while (openCount < count && isOpen(order[openCount]) === 0) openCount++;
  const instances = new Float32Array(count * TREE_STRIDE);
  for (let k = 0; k < count; k++) for (let c = 0; c < TREE_STRIDE; c++) instances[k * TREE_STRIDE + c] = out[order[k] * TREE_STRIDE + c];
  // Counting sort of the instances into sub-square buckets.
  const bucketOf = new Uint8Array(count);
  const bucketStart = new Uint16Array(BUCKETS * BUCKETS + 1);
  const sub = size / BUCKETS;
  for (let k = 0; k < count; k++) {
    const bx = Math.min(BUCKETS - 1, Math.max(0, Math.floor((instances[k * TREE_STRIDE] - e0) / sub)));
    const bz = Math.min(BUCKETS - 1, Math.max(0, Math.floor((instances[k * TREE_STRIDE + 2] - n0) / sub)));
    bucketOf[k] = bz * BUCKETS + bx;
    bucketStart[bucketOf[k] + 1]++;
  }
  for (let b = 0; b < BUCKETS * BUCKETS; b++) bucketStart[b + 1] += bucketStart[b];
  const fill = bucketStart.slice(0, BUCKETS * BUCKETS);
  const byBucket = new Uint16Array(count);
  for (let k = 0; k < count; k++) byBucket[fill[bucketOf[k]]++] = k;
  return { cx, cz, instances, count, openCount, order: byBucket, bucketStart };
}

// ------------------------------------------------------------------------------------------------ eras
//
// Another era's trees (Deep Time; flora/index.ts). The same cell, lattice and exclusions as the present
// buildTreeCell above, with the era's four species by habitat and every random draw on a new hash salt (11+):
//   slot 0 (araucaria)  uplands and slopes
//   slot 1 (taxodioid)  wet ground: riverbanks, marsh (biome.marsh, nonzero only when the era has
//                       marsh), wet lowland forest
//   slot 2 (platanoid)  lowland forest, the majority (angiosperm-dominated)
//   slot 3 (palm)       lone trees and clumps on the open, flat, moist floodplain; some in forest edges and
//                       with the cypresses along the river
// No hedgerows (no farmland). Heights within each slot's range. Palms, bankside trees and trees in thin forest
// (density under 0.5) are open trees, as in the present (no forest-edge reach).

const ARAUCARIA = 0;
const TAXODIOID = 1;
const PLATANOID = 2;
const PALM = 3;

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

function buildTreeCellEra(req: TreeCellRequest): TreeCellData {
  const { cx, cz, size, spacing } = req;
  const E = era();
  const slots = FLORA[E.flora].slots;
  const marshChannel = E.terrain.marsh;
  const e0 = cx * size;
  const n0 = cz * size;

  const m = Math.ceil(size / LATTICE) + 1;
  shapeField.build(n0, e0, n0 + (m - 1) * LATTICE, e0 + (m - 1) * LATTICE);
  const dens = new Float32Array(m * m);
  // Share of araucaria among forest trees (uplands, slopes), of taxodioids (wet ground) and the open
  // floodplain's suitability for palms.
  const upland = new Float32Array(m * m);
  const wet = new Float32Array(m * m);
  const plain = new Float32Array(m * m);
  const bank = new Float32Array(m * m);
  for (let j = 0; j < m; j++) {
    for (let i = 0; i < m; i++) {
      const north = n0 + j * LATTICE;
      const east = e0 + i * LATTICE;
      sampleTerrain(north, east, sample);
      shapeField.at(north, east, shape);
      computeBiome(north, east, sample, shape.up, biome, shape.north);
      const k = j * m + i;
      dens[k] = biome.forest;
      bank[k] = sample.riverHalfWidth > 0 ? Math.min(1e4, sample.riverDist - sample.riverHalfWidth) : 1e4;
      const marsh = marshChannel ? biome.marsh : 0;
      const slope = clamp01((0.97 - shape.up) / 0.08);
      upland[k] = clamp01((sample.ground - 380) / 500 + 1.2 * slope - 0.05);
      wet[k] = clamp01(1.6 * marsh + 1.5 * (biome.moisture - 0.7) + (bank[k] < 150 ? 0.4 : 0) - Math.max(0, (sample.ground - 300) / 400) - slope);
      plain[k] = clamp01((biome.moisture - 0.35) * 3) * clamp01((shape.up - 0.975) / 0.015) * clamp01((700 - sample.ground) / 300) * (1 - 0.7 * marsh);
    }
  }
  const lerp2 = (arr: Float32Array, fx: number, fz: number): number => {
    const i = Math.min(m - 2, Math.floor(fx));
    const j = Math.min(m - 2, Math.floor(fz));
    const tx = fx - i;
    const tz = fz - j;
    const a = arr[j * m + i] + (arr[j * m + i + 1] - arr[j * m + i]) * tx;
    const b = arr[(j + 1) * m + i] + (arr[(j + 1) * m + i + 1] - arr[(j + 1) * m + i]) * tx;
    return a + (b - a) * tz;
  };
  const heightOf = (s: number, t: number): number => {
    const [lo, hi] = slots[s].height;
    return lo + (hi - lo) * clamp01(t);
  };

  const per = Math.round(size / spacing);
  const out: number[] = [];
  for (let j = 0; j < per; j++) {
    for (let i = 0; i < per; i++) {
      const gi = cx * per + i;
      const gj = cz * per + j;
      const h0 = hash2i(gi, gj);
      const east = e0 + (i + rnd(h0, 11)) * spacing;
      const north = n0 + (j + rnd(h0, 12)) * spacing;
      const fx = (east - e0) / LATTICE;
      const fz = (north - n0) / LATTICE;
      const f = lerp2(dens, fx, fz);
      const p = f < 0.2 ? 0 : Math.min(1, (f - 0.2) * 1.6);
      const lone = f < 0.1 ? 0 : 0.004;
      const u = rnd(h0, 13);
      let kind: 'forest' | 'riparian' | 'palm' = 'forest';
      if (u >= p + lone) {
        // Palm groves: clumps of a few to a few dozen on the open floodplain, and the odd lone palm.
        const pl = lerp2(plain, fx, fz);
        let palm = false;
        if (pl > 0.05) {
          const grove = fbm(east / 160 + 17.3, north / 160 - 5.9, 2);
          const pp = pl * (grove > 0.32 ? Math.min(0.5, (grove - 0.32) * 3) : 0.0025);
          palm = rnd(h0, 14) < pp;
        }
        if (palm) kind = 'palm';
        else {
          // Bankside trees along the river where riparianPresence says (the water shader reflects them).
          let riparian = false;
          const be = lerp2(bank, fx, fz);
          if (be > RIPARIAN_NEAR - 4 && be < RIPARIAN_FAR + 4) {
            sampleTerrain(north, east, sample);
            const edge = sample.riverDist - sample.riverHalfWidth;
            if (sample.riverHalfWidth > 0 && edge > RIPARIAN_NEAR && edge < RIPARIAN_FAR) {
              const pr = riparianPresence(sample.riverArc, Math.sign(sample.riverSigned));
              riparian = u < 0.6 * pr * (1 - 0.6 * (edge - RIPARIAN_NEAR) / (RIPARIAN_FAR - RIPARIAN_NEAR));
            }
          }
          if (!riparian) continue;
          kind = 'riparian';
        }
      }
      if (inTownClearZone(north, east)) continue;
      sampleTerrain(north, east, sample);
      if (sample.ground < Math.max(sample.standing, sample.river) + 1 || sample.airportBlend < 0.98 || sample.approach > 0) continue;
      if (sample.riverHalfWidth > 0 && sample.riverDist < sample.riverHalfWidth + 2.5) continue;
      let species: number;
      let height: number;
      if (kind === 'riparian') {
        species = rnd(h0, 15) < 0.72 ? TAXODIOID : PALM;
        height = heightOf(species, rnd(h0, 16));
      } else if (kind === 'palm') {
        species = PALM;
        // Taller palms in the middle of a grove, a few young ones.
        height = heightOf(PALM, 0.15 + 0.85 * rnd(h0, 16));
      } else {
        const r = rnd(h0, 15);
        const up = lerp2(upland, fx, fz);
        const w = lerp2(wet, fx, fz);
        if (r < up) species = ARAUCARIA;
        else if (rnd(h0, 19) < w) species = TAXODIOID;
        // Palms in the understorey of open, low, edge woodland.
        else if (f < 0.55 && rnd(h0, 20) < 0.12 * lerp2(plain, fx, fz) + 0.03) species = PALM;
        else species = PLATANOID;
        // Edge and lone trees are shorter than forest-grown ones.
        const vigour = 0.55 + 0.45 * Math.min(1, f * 1.5);
        height = heightOf(species, rnd(h0, 16) * vigour + (1 - vigour) * 0.15);
      }
      const open = kind !== 'forest' || f < 0.5;
      out.push(east, sample.ground, north, height, rnd(h0, 17) * Math.PI * 2, species + (open ? SPECIES_COUNT : 0) + 0.99 * rnd(h0, 18) * (open ? OPEN_RANK : 1));
    }
  }

  return finishCell(cx, cz, size, out);
}
