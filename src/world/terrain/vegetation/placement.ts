// Tree placement for one square vegetation cell. Pure and deterministic (runs in the tile workers):
// the same biome function that paints the forest floor decides where trees stand, so the two agree.
//
// Candidates sit on a jittered lattice; each is accepted with a probability from the forest density
// (interpolated from a coarser lattice for speed), plus a sprinkle of lone trees near woods and
// hedgerow trees and shrubs along the hedged field edges of farmland (fields.ts). Every
// tree gets a random rank; instances are sorted by rank so distant LODs can draw a thinned prefix.

import { computeBiome, CoverShapeField, makeBiome, makeCoverShape } from '../biome';
import { RIPARIAN_FAR, RIPARIAN_NEAR, riparianPresence } from '../riparian';
import { makeSample, sampleTerrain } from '../heightfield';
import { makeParcel, parcelAt } from '../fields';
import { fbm, hash2i } from '../noise';
import { inTownClearZone } from '../townMask';

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
   * Per tree: east, ground height, north, tree height (m), yaw (rad), species + 0.99 * rank.
   * Sorted by rank, ascending.
   */
  instances: Float32Array;
  count: number;
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
export const SPECIES = { spruce: 0, pine: 1, oak: 2, birch: 3 } as const;
export const SPECIES_COUNT = 4;

const LATTICE = 16;
const sample = makeSample();
const biome = makeBiome();
const parcel = makeParcel();
const shape = makeCoverShape();
const shapeField = new CoverShapeField();

const rnd = (h: number, salt: number): number => hash2i(h, salt) / 4294967296;

export function buildTreeCell(req: TreeCellRequest): TreeCellData {
  const { cx, cz, size, spacing } = req;
  const e0 = cx * size;
  const n0 = cz * size;

  // Forest density on a coarse lattice (with slope from neighbouring samples), bilinearly interpolated.
  const m = Math.ceil(size / LATTICE) + 1;
  // Landform on the same world lattice the terrain tiles use, so trees and ground agree.
  shapeField.build(n0, e0, n0 + (m - 1) * LATTICE, e0 + (m - 1) * LATTICE);
  const dens = new Float32Array(m * m);
  const cons = new Float32Array(m * m);
  const farm = new Float32Array(m * m);
  // Distance from the river's water edge (m, large away from it) for the bankside trees.
  const bank = new Float32Array(m * m);
  for (let j = 0; j < m; j++) {
    for (let i = 0; i < m; i++) {
      const north = n0 + j * LATTICE;
      const east = e0 + i * LATTICE;
      sampleTerrain(north, east, sample);
      shapeField.at(north, east, shape);
      computeBiome(north, east, sample, shape.up, biome, shape.north);
      dens[j * m + i] = biome.forest;
      farm[j * m + i] = biome.farmland;
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
        hedge = parcel.hedge < 2.2 ? u < 0.85 : parcel.margin < 3 && u < 0.004;
      }
      // Bankside trees (alder, willow, poplar - here birch and oak) in a broken gallery along the river, where
      // riparianPresence says (the water shader reflects the same trees).
      let riparian = false;
      if (!hedge && u >= p + lone) {
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
      }
      // No trees in the valley town (hedgerows of its paddocks included).
      if (inTownClearZone(north, east)) continue;
      sampleTerrain(north, east, sample);
      if (sample.ground < Math.max(sample.standing, sample.river) + 1 || sample.airportBlend < 0.98 || sample.approach > 0) continue;
      // Never in the river channel (nor on the first metres of its bank), whatever the coarse lattice says.
      if (sample.riverHalfWidth > 0 && sample.riverDist < sample.riverHalfWidth + 2.5) continue;
      let species: number;
      let height: number;
      if (riparian) {
        species = rnd(h0, 5) < 0.65 ? SPECIES.birch : SPECIES.oak;
        height = 7 + 11 * rnd(h0, 6);
      } else if (hedge) {
        const r = rnd(h0, 5);
        species = r < 0.7 ? SPECIES.oak : r < 0.85 ? SPECIES.birch : SPECIES.spruce;
        // Half are shrubs; the rest hedgerow trees.
        height = rnd(h0, 6) < 0.5 ? 3.5 + 3 * rnd(h0, 9) : 7 + 9 * rnd(h0, 9);
      } else {
        const conifer = rnd(h0, 4) < lerp2(cons, fx, fz);
        species = conifer ? (rnd(h0, 5) < 0.7 ? SPECIES.spruce : SPECIES.pine) : rnd(h0, 5) < 0.7 ? SPECIES.oak : SPECIES.birch;
        // Heights (m): forest-grown conifers 14-28, broadleaves 10-22; edge and lone trees a bit shorter.
        const vigour = 0.75 + 0.25 * Math.min(1, f * 1.5);
        height = (conifer ? 14 + 14 * rnd(h0, 6) : 10 + 12 * rnd(h0, 6)) * vigour;
      }
      out.push(east, sample.ground, north, height, rnd(h0, 7) * Math.PI * 2, species + 0.99 * rnd(h0, 8));
    }
  }

  // Sort by rank (the fractional part of the last field).
  const count = out.length / TREE_STRIDE;
  const order = Array.from({ length: count }, (_, k) => k);
  const rank = (k: number): number => {
    const v = out[k * TREE_STRIDE + 5];
    return v - Math.floor(v);
  };
  order.sort((a, b) => rank(a) - rank(b));
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
  return { cx, cz, instances, count, order: byBucket, bucketStart };
}
