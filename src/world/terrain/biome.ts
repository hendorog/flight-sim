// Land cover: where forest, farmland, beaches and wet ground are. One CPU function feeds both the
// terrain vertex attributes (which drive the ground shader's splatting) and the tree placement, so trees
// stand exactly where the ground is painted as forest floor. Rock and snow are decided per pixel in the
// shader from slope, curvature and altitude (they need to be crisp at every LOD); terrainSurface() in
// heightfield.ts mirrors those thresholds for the physics.

import { clamp } from '../../core/math';
import { runwayCoords } from '../../core/world';
import { FENCE_RECT } from '../airport/layout';
import { SEA_LEVEL, makeSample, sampleTerrain, snowLine, type TerrainSample } from './heightfield';
import { fbm } from './noise';
import { townFieldFactor, townWoodFactor } from './townMask';

export interface Biome {
  /** Tree cover density, 0..1. Trees are placed where this is above 0.2 (dense stands from ~0.8). */
  forest: number;
  /** Cultivated land (the field patchwork), 0..1. */
  farmland: number;
  /** Soil moisture, 0..1 (greener grass, darker wet ground near water). */
  moisture: number;
  /** Beach sand, 0..1. */
  sand: number;
}

export function makeBiome(): Biome {
  return { forest: 0, farmland: 0, moisture: 0, sand: 0 };
}

const smooth = (e0: number, e1: number, x: number): number => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

const shapeScratch = makeSample();
/** Scale of the landform measures used for land cover, m: coarse enough to ignore small bumps, and
 * independent of mesh LOD. */
const SHAPE_STEP = 30;

/** Landform at a point, measured over SHAPE_STEP. */
export interface CoverShape {
  /** Vertical component of the unit normal (1 = flat). */
  up: number;
  /** Laplacian of the ground height, 1/m: negative on ridges and convex breaks, positive in hollows. */
  curvature: number;
  /** Northward horizontal component of the unit normal: > 0 on slopes facing north (shaded), < 0 facing south. */
  north: number;
}

export function makeCoverShape(): CoverShape {
  return { up: 1, curvature: 0, north: 0 };
}

/**
 * Slope and curvature from central differences over SHAPE_STEP, given the ground height h at the point.
 * Land cover uses these rather than mesh normals so it does not change with tile resolution.
 */
export function coverShape(north: number, east: number, h: number, out: CoverShape): CoverShape {
  const d = SHAPE_STEP;
  const he = sampleTerrain(north, east + d, shapeScratch).ground;
  const hw = sampleTerrain(north, east - d, shapeScratch).ground;
  const hn = sampleTerrain(north + d, east, shapeScratch).ground;
  const hs = sampleTerrain(north - d, east, shapeScratch).ground;
  const ge = (he - hw) / (2 * d);
  const gn = (hn - hs) / (2 * d);
  out.up = 1 / Math.sqrt(1 + ge * ge + gn * gn);
  out.curvature = (he + hw + hn + hs - 4 * h) / (d * d);
  out.north = -gn * out.up;
  return out;
}

/**
 * Signed distance from the airport perimeter fence, m: negative inside the fenced airfield, positive
 * outside. Inside is mown airfield grass; farmland runs up to the fence outside.
 */
export function fenceDistance(north: number, east: number): number {
  const { along: u, across: v } = runwayCoords(north, east);
  const f = FENCE_RECT;
  const du = Math.max(f.u0 - u, 0, u - f.u1);
  const dv = Math.max(f.v0 - v, 0, v - f.v1);
  if (du > 0 || dv > 0) return Math.hypot(du, dv);
  return -Math.min(u - f.u0, f.u1 - u, v - f.v0, f.v1 - v);
}

/** Spacing of the world-aligned lattice CoverShapeField measures landform on, m. */
export const SHAPE_LATTICE = 32;

/**
 * Landform (slope and curvature) on the world-aligned SHAPE_LATTICE grid over a rectangle, interpolated
 * bilinearly to points inside it. Every tile and tree cell that covers a point measures it on the same
 * lattice, so land cover does not change with tile LOD - at a small fraction of the cost of coverShape()
 * per point (one height sample per lattice node instead of four extra per point).
 */
export class CoverShapeField {
  private i0 = 0;
  private j0 = 0;
  private nx = 0;
  private nz = 0;
  private up = new Float32Array(0);
  private curv = new Float32Array(0);
  private nor = new Float32Array(0);
  private hts = new Float64Array(0);
  private readonly scratch = makeSample();

  /** Measure the lattice covering north [n0, n1] x east [e0, e1]. */
  build(n0: number, e0: number, n1: number, e1: number): this {
    const L = SHAPE_LATTICE;
    this.i0 = Math.floor(e0 / L);
    this.j0 = Math.floor(n0 / L);
    this.nx = Math.ceil(e1 / L) - this.i0 + 1;
    this.nz = Math.ceil(n1 / L) - this.j0 + 1;
    const w = this.nx + 2;
    const h = this.nz + 2;
    if (this.hts.length < w * h) this.hts = new Float64Array(w * h);
    if (this.up.length < this.nx * this.nz) {
      this.up = new Float32Array(this.nx * this.nz);
      this.curv = new Float32Array(this.nx * this.nz);
      this.nor = new Float32Array(this.nx * this.nz);
    }
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++) this.hts[j * w + i] = sampleTerrain((this.j0 + j - 1) * L, (this.i0 + i - 1) * L, this.scratch).ground;
    for (let j = 0; j < this.nz; j++) {
      for (let i = 0; i < this.nx; i++) {
        const c = (j + 1) * w + i + 1;
        const hc = this.hts[c];
        const he = this.hts[c + 1];
        const hw = this.hts[c - 1];
        const hn = this.hts[c + w];
        const hs = this.hts[c - w];
        const ge = (he - hw) / (2 * L);
        const gn = (hn - hs) / (2 * L);
        this.up[j * this.nx + i] = 1 / Math.sqrt(1 + ge * ge + gn * gn);
        this.curv[j * this.nx + i] = (he + hw + hn + hs - 4 * hc) / (L * L);
        this.nor[j * this.nx + i] = -gn * this.up[j * this.nx + i];
      }
    }
    return this;
  }

  /** Landform at a point inside the measured rectangle. */
  at(north: number, east: number, out: CoverShape): CoverShape {
    const fx = Math.min(Math.max(east / SHAPE_LATTICE - this.i0, 0), this.nx - 1.000001);
    const fz = Math.min(Math.max(north / SHAPE_LATTICE - this.j0, 0), this.nz - 1.000001);
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const tx = fx - i;
    const tz = fz - j;
    const k = j * this.nx + i;
    const lerp2 = (a: Float32Array): number => {
      const a0 = a[k] + (a[k + 1] - a[k]) * tx;
      const a1 = a[k + this.nx] + (a[k + this.nx + 1] - a[k + this.nx]) * tx;
      return a0 + (a1 - a0) * tz;
    };
    out.up = lerp2(this.up);
    out.curvature = lerp2(this.curv);
    out.north = lerp2(this.nor);
    return out;
  }
}

/** Width of the uncultivated strip along each river bank (the ground shader's riparian strip), m. */
export const RIVER_STRIP = 14;

/** Tree line elevation on level ground, m: forests thin out above it and stop 250 m higher. */
export function treeLine(north: number, east: number): number {
  return 1750 + 150 * fbm(east / 4000 - 7.1, north / 4000 + 2.6, 2);
}

/** How much higher the tree line lies on a sunny south face than on level ground (and lower facing north),
 * per unit of the normal's horizontal southward component, m. */
export const TREE_LINE_ASPECT = 260;

/**
 * Slopes steeper than this (vertical normal component below COVER_ROCK_UP) are bare rock; forest thins out
 * from FOREST_UP_FULL and is gone at FOREST_UP_MIN. The ground shader uses the same landform slope (the
 * shape attribute) for its rock, so rock and forest share the slope instead of overlapping.
 */
export const FOREST_UP_FULL = 0.74;
export const FOREST_UP_MIN = 0.64;

/**
 * Land cover at a point.
 * @param s   terrain sample at the point
 * @param up  vertical component of the unit surface normal (1 = flat), from coverShape
 * @param faceNorth  northward horizontal component of that normal (CoverShape.north)
 */
export function computeBiome(north: number, east: number, s: TerrainSample, up: number, out: Biome, faceNorth = 0): Biome {
  const h = s.ground;
  const waterLevel = Math.max(s.standing, s.river);
  const aboveWater = h - waterLevel;
  const riverNear = 1 - smooth(20, 400, s.riverDist);

  // Moisture: large-scale noise plus proximity to water and low ground.
  const m0 = 0.5 + 0.5 * fbm(east / 2500 + 3.3, north / 2500 - 8.8, 3);
  const moisture = clamp(0.25 + 0.6 * m0 + 0.5 * riverNear + 0.4 * (1 - smooth(0, 6, aboveWater)) - 0.00015 * h, 0, 1);

  // Beaches on sea coasts only, a few metres either side of the waterline on gentle slopes.
  const seaCoast = s.standing === SEA_LEVEL ? 1 : 0;
  const sand = seaCoast * (1 - smooth(1.5, 4.5, h)) * smooth(0.8, 0.95, up) * (h > -6 ? 1 : 0);

  // Woods first: patchy in the lowlands (about a quarter of the land), closing into continuous forest on
  // hill and mountain slopes, thinning toward the tree line; never on the airfield, in the clear zone of
  // the approaches, on bare steep rock, in water or on beaches.
  const flatness = smooth(0.94, 0.985, up);
  const patches = fbm(east / 1700 + 9.2, north / 1700 - 0.6, 4) + 0.3 * fbm(east / 350 - 2.2, north / 350 + 5.1, 2);
  const hilly = 0.5 * (1 - flatness) + 0.35 * smooth(500, 1100, h);
  // The tree line climbs on sunny south faces and drops on shaded north faces.
  const tl = treeLine(north, east) - TREE_LINE_ASPECT * faceNorth;
  const woods = smooth(-0.1, 0.1, patches + hilly - 0.12);
  const forest =
    woods *
    (1 - smooth(tl, tl + 250, h)) *
    smooth(FOREST_UP_MIN, FOREST_UP_FULL, up) *
    smooth(3, 12, aboveWater) *
    (1 - sand) *
    (1 - s.approach) *
    smooth(0.98, 1.0, s.airportBlend) *
    townWoodFactor(north, east) *
    (h < snowLine(north, east) ? 1 : 0);

  // Farmland (crop fields and hedged pastures): the gentle land outside the woods up into the foothills,
  // except occasional commons and rough grazing. Around the airport it runs up to the perimeter fence (the
  // flattened valley floor is prime farmland); inside the fence is airfield grass. The shader picks crops
  // vs pasture per parcel.
  const commons = fbm(east / 4000 - 1.9, north / 4000 + 4.7, 3);
  const lowland = 1 - smooth(800, 1150, h);
  const nearField = 1 - s.airportBlend;
  // Along the river the fields stop short of the bank: a strip of rough grass, reeds and bankside trees.
  const riverStrip = s.riverHalfWidth > 0 ? smooth(s.riverHalfWidth + RIVER_STRIP, s.riverHalfWidth + RIVER_STRIP + 16, s.riverDist) : 1;
  const farmland =
    clamp(
      Math.max(flatness, nearField) * lowland * Math.max(smooth(-0.45, -0.2, commons), nearField) * smooth(2, 6, aboveWater) * (1 - sand) * (1 - forest),
      0,
      1,
    ) *
    smooth(4, 20, s.airportBlend < 1 ? fenceDistance(north, east) : 1e4) *
    townFieldFactor(north, east) *
    riverStrip;

  out.forest = forest;
  out.farmland = farmland;
  out.moisture = moisture;
  out.sand = sand;
  return out;
}
