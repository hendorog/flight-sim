// Builds the vertex data of one terrain quadtree node. Pure and three.js-free: it runs in the tile
// workers (and in tests). The main thread only wraps the returned typed arrays in BufferAttributes.
//
// Node (level, ix, iz) covers east [ix*size, (ix+1)*size] and north [iz*size, (iz+1)*size], where
// size = leafSize * 2^level, sampled on a (grid+1)^2 lattice. Local mesh coordinates: x = east - e0,
// y = height MSL, z = -(north - n0), so the mesh is placed at three.js (e0, 0, -n0).
//
// Geomorphing (CDLOD): each vertex also stores where it would be on the parent's half-resolution
// lattice (height delta and normal); the vertex shader slides toward that as the node nears the end of
// its LOD range, so a node meets its coarser neighbour exactly and LOD switches do not pop.
//
// Vertex format (36 bytes): position f32x3, normals snorm16x4, morph height f32, biome unorm8x4, shape
// unorm8x4, river int16x2. Terrain normals always point up, so each is stored as its x and z components only.

import { computeBiome, CoverShapeField, makeBiome, makeCoverShape, SHAPE_LATTICE } from './biome';
import { hydrology, makeSample, sampleTerrain, type TerrainSample } from './heightfield';
import type { RiverHit } from './hydrology';

export interface TileRequest {
  level: number;
  ix: number;
  iz: number;
  /** Quads per node side; a power of two. */
  grid: number;
  /** Size of a level-0 node, m. */
  leafSize: number;
}

export interface WaterData {
  /** Local positions (x, water level, z). */
  positions: Float32Array;
  /** Water depth (level - bed) per vertex, m; negative on dry shore vertices. */
  depth: Float32Array;
  index: Uint16Array;
}

export interface TileData {
  level: number;
  ix: number;
  iz: number;
  /** Local positions (x, bed height, z), lattice first then skirt vertices. */
  positions: Float32Array;
  /**
   * Per vertex, snorm16 x4: the unit normal of this level's lattice (x, z; three.js world axes, y > 0 is
   * recovered in the shader) and the parent lattice's normal (x, z) - the geomorph target.
   */
  normals: Int16Array;
  /** Geomorph height delta to the parent lattice per vertex, m. */
  morph: Float32Array;
  /** Land cover per vertex, unorm8: forest, farmland, moisture, sand. */
  biome: Uint8Array;
  /**
   * Per vertex, unorm8 x4: terrain curvature (0.5 = planar, below = convex ridges, above = hollows), the
   * forest density on the parent lattice (the geomorph target of the canopy lift, see terrainMaterial.ts),
   * the node level (+ SKIRT_FLAG on skirt vertices, as a raw byte) and the land-cover slope (the vertical
   * normal component measured on the land-cover lattice, independent of LOD; the shader's rock uses it).
   */
  shape: Uint8Array;
  /**
   * Per vertex, int16 x2 in units of 1/RIVER_UNITS m: the signed distance from the river centreline (+ right
   * bank, - left; clamped to +-RIVER_FAR) and the channel half-width there. The signed distance is linear
   * across the channel, so interpolating it over a triangle puts the banks right even where the lattice is
   * far coarser than the river.
   */
  river: Int16Array;
  minHeight: number;
  maxHeight: number;
  water: WaterData | null;
}

/** Border of extra samples around the lattice, enough for central differences at twice the spacing. */
const BORDER = 2;
/** Skirt vertex flag added to the level byte of the shape attribute. */
export const SKIRT_FLAG = 16;

export function tileVertexCount(grid: number): number {
  return (grid + 1) * (grid + 1) + 4 * (grid + 1);
}

/**
 * Triangle indices shared by every node with the same grid: the lattice (every quad split along the
 * (i, j)-(i+1, j+1) diagonal, which the geomorph interpolation assumes) plus a skirt hanging from each
 * edge, a safety net against sub-pixel gaps at LOD boundaries.
 */
export function buildTileIndices(grid: number): Uint16Array {
  const n = grid + 1;
  const idx = new Uint16Array((grid * grid + 8 * grid) * 6);
  let k = 0;
  const tri = (a: number, b: number, c: number): void => {
    idx[k++] = a;
    idx[k++] = b;
    idx[k++] = c;
  };
  // Lattice: a=(i,j) b=(i+1,j) c=(i,j+1) d=(i+1,j+1); counter-clockwise seen from above in three.js.
  for (let j = 0; j < grid; j++) {
    for (let i = 0; i < grid; i++) {
      const a = j * n + i;
      tri(a, a + 1, a + n + 1);
      tri(a, a + n + 1, a + n);
    }
  }
  // Skirts: edge e has its own row of n vertices after the lattice. Both windings are emitted so a gap
  // is covered whichever side it is seen from.
  const edgeVertex = [(t: number) => t, (t: number) => grid * n + t, (t: number) => t * n, (t: number) => t * n + grid];
  for (let e = 0; e < 4; e++) {
    const s = n * n + e * n;
    for (let t = 0; t < grid; t++) {
      const a = edgeVertex[e](t);
      const b = edgeVertex[e](t + 1);
      tri(a, s + t, b);
      tri(b, s + t, s + t + 1);
      tri(a, b, s + t);
      tri(b, s + t + 1, s + t);
    }
  }
  return idx;
}

/** Fixed-point scale of TileData.river (units per metre). */
export const RIVER_UNITS = 8;
/** Signed river distances are clamped to this, m (also used where the river is out of reach). */
export const RIVER_FAR = 4000;

const riverScratch: RiverHit = { dist: Infinity, level: 0, halfWidth: 0, s: 0, side: 0, beyondSource: 0 };

/**
 * Fill the river attribute: signed distance and half-width per lattice vertex. Where the river is out of
 * reach its side is unknown; those vertices take the side of the nearest vertex that knows it (so no
 * triangle interpolates through a false zero crossing) at RIVER_FAR.
 */
function fillRiver(n: number, signed: Float64Array, width: Float64Array, known: Uint8Array, out: Int16Array): void {
  const count = n * n;
  let anyKnown = false;
  for (let v = 0; v < count; v++) if (known[v]) anyKnown = true;
  if (anyKnown) {
    // Propagate the side outward from known vertices, one ring per pass.
    const side = new Int8Array(count);
    for (let v = 0; v < count; v++) if (known[v]) side[v] = signed[v] >= 0 ? 1 : -1;
    let changed = true;
    while (changed) {
      changed = false;
      for (let j = 0; j < n; j++)
        for (let i = 0; i < n; i++) {
          const v = j * n + i;
          if (side[v] !== 0) continue;
          const s = (i > 0 ? side[v - 1] : 0) || (i < n - 1 ? side[v + 1] : 0) || (j > 0 ? side[v - n] : 0) || (j < n - 1 ? side[v + n] : 0);
          if (s !== 0) {
            side[v] = s;
            changed = true;
          }
        }
    }
    for (let v = 0; v < count; v++) if (!known[v]) signed[v] = side[v] * RIVER_FAR;
  } else signed.fill(RIVER_FAR, 0, count);
  const lim = RIVER_FAR * RIVER_UNITS;
  for (let v = 0; v < count; v++) {
    out[v * 2] = Math.round(Math.max(-lim, Math.min(lim, signed[v] * RIVER_UNITS)));
    out[v * 2 + 1] = known[v] ? Math.round(width[v] * RIVER_UNITS) : 0;
  }
}

/** A unit-range value as a normalised signed 16-bit integer. */
const snorm16 = (x: number): number => Math.round(Math.max(-1, Math.min(1, x)) * 32767);

const sample: TerrainSample = makeSample();
const biome = makeBiome();
const shape = makeCoverShape();
const shapeField = new CoverShapeField();
/** Curvature (1/m) to unorm8 scale: +-0.017/m (a 15 m bump over 30 m) spans the range. */
const CURVATURE_SCALE = 30;

export function buildTile(req: TileRequest): TileData {
  const { level, ix, iz, grid } = req;
  const size = req.leafSize * 2 ** level;
  const sp = size / grid;
  const n0 = iz * size;
  const e0 = ix * size;
  const n = grid + 1;
  const w = n + 2 * BORDER;

  // Height samples on the bordered lattice; full samples kept for the lattice itself.
  const hts = new Float64Array(w * w);
  const standing = new Float64Array(n * n);
  const river = new Float64Array(n * n);
  const airport = new Float64Array(n * n);
  const riverDist = new Float64Array(n * n);
  const riverSigned = new Float64Array(n * n);
  const riverWidth = new Float64Array(n * n);
  const riverKnown = new Uint8Array(n * n);
  const approach = new Float64Array(n * n);
  for (let gj = 0; gj < w; gj++) {
    const north = n0 + (gj - BORDER) * sp;
    for (let gi = 0; gi < w; gi++) {
      const east = e0 + (gi - BORDER) * sp;
      sampleTerrain(north, east, sample);
      hts[gj * w + gi] = sample.ground;
      const i = gi - BORDER;
      const j = gj - BORDER;
      if (i >= 0 && i < n && j >= 0 && j < n) {
        const v = j * n + i;
        standing[v] = sample.standing;
        river[v] = sample.river;
        airport[v] = sample.airportBlend;
        riverDist[v] = sample.riverDist;
        approach[v] = sample.approach;
        if (sample.airportBlend === 0) {
          // (sampleTerrain skips the river inside the flat airport zone; the ground shader still needs it.)
          hydrology.queryRiver(north, east, riverScratch);
          if (riverScratch.side !== 0) {
            riverSigned[v] = riverScratch.dist * riverScratch.side;
            riverWidth[v] = riverScratch.halfWidth;
            riverKnown[v] = 1;
          }
        } else if (Number.isFinite(sample.riverDist)) {
          riverSigned[v] = sample.riverSigned;
          riverWidth[v] = sample.riverHalfWidth;
          riverKnown[v] = 1;
        }
      }
    }
  }
  const H = (i: number, j: number): number => hts[(j + BORDER) * w + i + BORDER];

  const count = tileVertexCount(grid);
  const positions = new Float32Array(count * 3);
  const normals = new Int16Array(count * 4);
  const morph = new Float32Array(count);
  const bio = new Uint8Array(count * 4);
  const form = new Uint8Array(count * 4);
  const riv = new Int16Array(count * 2);
  fillRiver(n, riverSigned, riverWidth, riverKnown, riv);
  // Parent-lattice normals at even vertices (x, z components; y is recovered in the shader).
  const cnx = new Float64Array(n * n);
  const cnz = new Float64Array(n * n);
  let minH = Infinity;
  let maxH = -Infinity;

  // Landform for land cover: on the shared world lattice while the vertex spacing is finer than it (so land
  // cover is the same at every LOD there); coarser tiles measure it on their own lattice.
  const fineShape = sp < SHAPE_LATTICE;
  if (fineShape) shapeField.build(n0, e0, n0 + size, e0 + size);

  // Surface y = h(east, north) with three.js z = -north: normal = normalize(-dh/de, 1, dh/dn).
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const v = j * n + i;
      const h = H(i, j);
      minH = Math.min(minH, h);
      maxH = Math.max(maxH, h);
      positions[v * 3] = i * sp;
      positions[v * 3 + 1] = h;
      positions[v * 3 + 2] = -j * sp;
      const ge = (H(i + 1, j) - H(i - 1, j)) / (2 * sp);
      const gn = (H(i, j + 1) - H(i, j - 1)) / (2 * sp);
      const inv = 1 / Math.sqrt(ge * ge + gn * gn + 1);
      normals[v * 4] = snorm16(-ge * inv);
      normals[v * 4 + 1] = snorm16(gn * inv);
      if ((i & 1) === 0 && (j & 1) === 0) {
        const ce = (H(i + 2, j) - H(i - 2, j)) / (4 * sp);
        const cn = (H(i, j + 2) - H(i, j - 2)) / (4 * sp);
        const ci = 1 / Math.sqrt(ce * ce + cn * cn + 1);
        cnx[v] = -ce * ci;
        cnz[v] = cn * ci;
      }

      // Land cover, from the full sample at this vertex.
      sample.ground = h;
      sample.standing = standing[v];
      sample.river = river[v];
      sample.airportBlend = airport[v];
      sample.riverDist = riverDist[v];
      sample.approach = approach[v];
      if (fineShape) shapeField.at(n0 + j * sp, e0 + i * sp, shape);
      else {
        shape.up = inv;
        shape.curvature = (H(i + 1, j) + H(i - 1, j) + H(i, j + 1) + H(i, j - 1) - 4 * h) / (sp * sp);
        shape.north = -gn * inv;
      }
      computeBiome(n0 + j * sp, e0 + i * sp, sample, shape.up, biome, shape.north);
      form[v * 4 + 3] = Math.round(Math.min(1, Math.max(0, shape.up)) * 255);
      form[v * 4] = Math.round(Math.min(1, Math.max(0, 0.5 + shape.curvature * CURVATURE_SCALE)) * 255);
      bio[v * 4] = Math.round(biome.forest * 255);
      bio[v * 4 + 1] = Math.round(biome.farmland * 255);
      bio[v * 4 + 2] = Math.round(biome.moisture * 255);
      bio[v * 4 + 3] = Math.round(biome.sand * 255);
    }
  }

  // Parent-lattice targets: odd vertices lie on a parent edge or on a parent quad's diagonal, so the
  // parent surface there is the mean of the two parent vertices at the ends of that edge/diagonal.
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const v = j * n + i;
      const oi = i & 1;
      const oj = j & 1;
      let a = v;
      let b = v;
      if (oi && oj) {
        a = (j - 1) * n + i - 1;
        b = (j + 1) * n + i + 1;
      } else if (oi) {
        a = v - 1;
        b = v + 1;
      } else if (oj) {
        a = v - n;
        b = v + n;
      }
      const hc = 0.5 * (positions[a * 3 + 1] + positions[b * 3 + 1]);
      let nx = 0.5 * (cnx[a] + cnx[b]);
      let nz = 0.5 * (cnz[a] + cnz[b]);
      const l = Math.sqrt(nx * nx + nz * nz);
      if (l > 0.999) {
        nx *= 0.999 / l;
        nz *= 0.999 / l;
      }
      morph[v] = hc - positions[v * 3 + 1];
      form[v * 4 + 1] = (bio[a * 4] + bio[b * 4] + 1) >> 1;
      form[v * 4 + 2] = level;
      normals[v * 4 + 2] = snorm16(nx);
      normals[v * 4 + 3] = snorm16(nz);
    }
  }

  // Skirt vertices: copies of the edge vertices, flagged so the shader drops them below the surface.
  const edgeVertex: Array<(t: number) => number> = [(t) => t, (t) => grid * n + t, (t) => t * n, (t) => t * n + grid];
  for (let e = 0; e < 4; e++) {
    for (let t = 0; t < n; t++) {
      const src = edgeVertex[e](t);
      const dst = n * n + e * n + t;
      positions.copyWithin(dst * 3, src * 3, src * 3 + 3);
      normals.copyWithin(dst * 4, src * 4, src * 4 + 4);
      morph[dst] = morph[src];
      bio.copyWithin(dst * 4, src * 4, src * 4 + 4);
      form.copyWithin(dst * 4, src * 4, src * 4 + 4);
      form[dst * 4 + 2] = level + SKIRT_FLAG;
      riv.copyWithin(dst * 2, src * 2, src * 2 + 2);
    }
  }

  return {
    level,
    ix,
    iz,
    positions,
    normals,
    morph,
    biome: bio,
    shape: form,
    river: riv,
    minHeight: minH,
    maxHeight: maxH,
    water: buildWater(grid, sp, positions, standing),
  };
}

/**
 * Standing water (sea and lakes) over this node: the lattice triangles with at least one submerged
 * vertex, flat at the water level. Terrain above the waterline hides the rest through the depth test,
 * so the shoreline is exact per pixel.
 */
function buildWater(grid: number, sp: number, positions: Float32Array, standing: Float64Array): WaterData | null {
  const n = grid + 1;
  const wet = new Uint8Array(n * n);
  let any = false;
  for (let v = 0; v < n * n; v++) {
    if (positions[v * 3 + 1] < standing[v]) {
      wet[v] = 1;
      any = true;
    }
  }
  if (!any) return null;
  const tris: number[] = [];
  for (let j = 0; j < grid; j++) {
    for (let i = 0; i < grid; i++) {
      const a = j * n + i;
      const b = a + 1;
      const c = a + n;
      const d = c + 1;
      if (wet[a] || wet[b] || wet[d]) tris.push(a, b, d);
      if (wet[a] || wet[d] || wet[c]) tris.push(a, d, c);
    }
  }
  const pos = new Float32Array(n * n * 3);
  const depth = new Float32Array(n * n);
  for (let v = 0; v < n * n; v++) {
    pos[v * 3] = positions[v * 3];
    pos[v * 3 + 1] = standing[v];
    pos[v * 3 + 2] = positions[v * 3 + 2];
    depth[v] = standing[v] - positions[v * 3 + 1];
  }
  return { positions: pos, depth, index: Uint16Array.from(tris) };
}
