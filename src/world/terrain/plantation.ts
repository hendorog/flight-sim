// Forestry plantations: estates of planted conifers in the hill country, cut into compartments that were each
// planted in one year, so the hills carry the patchwork of age classes a working forest has - dark mature
// stands, paler young ones, and the brown of fresh clear-fells - with the trees in rows. The GLSL and TypeScript
// versions below implement the same function with the same integer hash (as fields.ts does), so the tones the
// ground shader paints far away lie under the trees the placer plants near by.
//
// Estates: a value noise on a ESTATE_M lattice above a threshold, within a band of ground height (biome.ts adds
// the rest: off the valley floor, out of the approaches, the town and the water). Compartments: the cells of a
// jittered Voronoi diagram about BLOCK_M apart (straight borders, as surveyed boundaries are). Each compartment
// has its age (years since planting, over a ROTATION_YEARS rotation) and its row direction, which follows the
// estate's with a little turn of its own. Present day only.

import { fieldNoise, noiseOut } from './fields';
import { hash2i } from './noise';

/** Estate noise lattice, m, its hash salt and the threshold ramp of the noise (in -1..1). */
export const ESTATE_M = 5200;
export const ESTATE_SALT = 401;
export const ESTATE_ON: readonly [number, number] = [0.46, 0.56];
/** Domain warp of the estate noise (so estate boundaries wander off its lattice): wavelength and amplitude, m. */
export const ESTATE_WARP: readonly [number, number] = [2300, 1100];
/** Ground heights the estates keep within, m: ramps at either end. */
export const ESTATE_LOW: readonly [number, number] = [60, 110];
export const ESTATE_HIGH: readonly [number, number] = [780, 920];
/** Compartment spacing, m, and the Voronoi site jitter (fraction of the spacing either side of the cell centre). */
export const BLOCK_M = 420;
export const BLOCK_JITTER = 0.38;
const BLOCK_SALT = 9157;
/** Species zones: a value noise on this lattice, m, at the compartment's site, so neighbours share a species. */
export const SPECIES_M = 1500;
const SPECIES_SALT = 404;
/** Rotation (years from planting to felling), and how long a felled compartment lies bare before it shows again. */
export const ROTATION_YEARS = 28;
export const CLEARFELL_YEARS = 2.5;

/**
 * What a compartment is planted with, by its species zone (about 60 %, 28 % and 12 % of them): radiata pine below
 * PLANT_FIR_ID, Douglas-fir (darker, denser; the spruce slot) up to PLANT_EUC_ID, eucalypt (broadleaf, grey-green)
 * above.
 */
export const PLANT_FIR_ID = 0.59;
export const PLANT_EUC_ID = 0.79;

/** Height of a compartment's trees at an age, m (about 1.25 m a year once established, to ~34 m). */
export function standHeight(years: number): number {
  return Math.min(34, Math.max(1.5, 1.25 * (years - 1.5)));
}

export interface Compartment {
  /** Years since planting, 0..ROTATION_YEARS. */
  years: number;
  /** Row direction, rad (rows run along this angle from east toward north). */
  angle: number;
  /** Distance to the compartment's border, m. */
  border: number;
  /** Its Voronoi site, world east and north, m. */
  siteE: number;
  siteN: number;
  /** Species zone 0..1 at its site (a smooth field, so neighbouring compartments mostly agree; PLANT_FIR_ID). */
  id: number;
  /** Integer cell of its site (a key for the compartment). */
  cellX: number;
  cellY: number;
}

export function makeCompartment(): Compartment {
  return { years: 0, angle: 0, border: 0, siteE: 0, siteN: 0, id: 0, cellX: 0, cellY: 0 };
}

const smooth = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
const u16 = (h: number): number => (h & 0xffff) / 65535;

/** How much of an estate this is (0..1) at a point of the given ground height (TypeScript twin of estateWeight()). */
export function estateWeight(east: number, north: number, ground: number): number {
  fieldNoise(east / ESTATE_WARP[0], north / ESTATE_WARP[0], ESTATE_SALT + 1);
  const we = east + ESTATE_WARP[1] * noiseOut.x;
  const wn = north + ESTATE_WARP[1] * noiseOut.y;
  fieldNoise(we / ESTATE_M, wn / ESTATE_M, ESTATE_SALT);
  return smooth(ESTATE_ON[0], ESTATE_ON[1], noiseOut.x) * smooth(ESTATE_LOW[0], ESTATE_LOW[1], ground) * (1 - smooth(ESTATE_HIGH[0], ESTATE_HIGH[1], ground));
}

const site = { x: 0, y: 0 };
function blockSite(x: number, y: number): void {
  const h = hash2i(x, y + BLOCK_SALT);
  site.x = x + 0.5 + 2 * BLOCK_JITTER * (u16(h) - 0.5);
  site.y = y + 0.5 + 2 * BLOCK_JITTER * ((h >>> 16) / 65535 - 0.5);
}

/** The compartment at a point (TypeScript twin of compartmentAt()). `east`, `north` in m. */
export function compartmentAt(east: number, north: number, out: Compartment): Compartment {
  const px = east / BLOCK_M;
  const py = north / BLOCK_M;
  const ix = Math.floor(px);
  const iy = Math.floor(py);
  let best = Infinity;
  let bx = 0;
  let by = 0;
  let sx = 0;
  let sy = 0;
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      blockSite(ix + dx, iy + dy);
      const d = (site.x - px) ** 2 + (site.y - py) ** 2;
      if (d < best) {
        best = d;
        bx = ix + dx;
        by = iy + dy;
        sx = site.x;
        sy = site.y;
      }
    }
  // Distance to the nearest Voronoi border: to each bisector between this site and a neighbour's.
  let border = Infinity;
  for (let dy = -2; dy <= 2; dy++)
    for (let dx = -2; dx <= 2; dx++) {
      if (dx === 0 && dy === 0) continue;
      blockSite(bx + dx, by + dy);
      const mx = site.x - sx;
      const my = site.y - sy;
      const l = Math.sqrt(mx * mx + my * my);
      const d = ((px - sx) * mx + (py - sy) * my) / l;
      border = Math.min(border, 0.5 * l - d);
    }
  const h = hash2i(bx, by + BLOCK_SALT + 1);
  fieldNoise((sx * BLOCK_M) / ESTATE_M, (sy * BLOCK_M) / ESTATE_M, ESTATE_SALT);
  out.years = ROTATION_YEARS * ((h >>> 16) / 65535);
  out.angle = noiseOut.y * Math.PI + 0.6 * (u16(h) - 0.5);
  out.border = border * BLOCK_M;
  out.siteE = sx * BLOCK_M;
  out.siteN = sy * BLOCK_M;
  fieldNoise((sx * BLOCK_M) / SPECIES_M, (sy * BLOCK_M) / SPECIES_M, SPECIES_SALT);
  out.id = 0.5 + 0.5 * noiseOut.x;
  out.cellX = bx;
  out.cellY = by;
  return out;
}

/**
 * GLSL twins (needs FIELDS_GLSL's fieldNoise and hash2u). xz is world (east, north). compartmentAt returns
 * (years, angle, border m, species zone id).
 */
export const PLANTATION_GLSL = /* glsl */ `
float estateWeight(vec2 en, float ground) {
  vec2 w = en + ${ESTATE_WARP[1].toFixed(1)} * fieldNoise(en / ${ESTATE_WARP[0].toFixed(1)}, ${ESTATE_SALT + 1});
  vec2 nz = fieldNoise(w / ${ESTATE_M.toFixed(1)}, ${ESTATE_SALT});
  return smoothstep(${ESTATE_ON[0].toFixed(3)}, ${ESTATE_ON[1].toFixed(3)}, nz.x)
    * smoothstep(${ESTATE_LOW[0].toFixed(1)}, ${ESTATE_LOW[1].toFixed(1)}, ground)
    * (1.0 - smoothstep(${ESTATE_HIGH[0].toFixed(1)}, ${ESTATE_HIGH[1].toFixed(1)}, ground));
}
vec2 blockSite(int x, int y) {
  uint h = hash2u(x, y + ${BLOCK_SALT});
  return vec2(float(x) + 0.5 + ${(2 * BLOCK_JITTER).toFixed(3)} * (float(h & 0xffffu) / 65535.0 - 0.5),
              float(y) + 0.5 + ${(2 * BLOCK_JITTER).toFixed(3)} * (float(h >> 16) / 65535.0 - 0.5));
}
vec4 compartmentAt(vec2 en) {
  vec2 p = en / ${BLOCK_M.toFixed(1)};
  ivec2 c = ivec2(floor(p));
  float best = 1e9;
  ivec2 b = c;
  vec2 s = vec2(0.0);
  for (int dy = -1; dy <= 1; dy++)
    for (int dx = -1; dx <= 1; dx++) {
      vec2 q = blockSite(c.x + dx, c.y + dy);
      float d = dot(q - p, q - p);
      if (d < best) { best = d; b = c + ivec2(dx, dy); s = q; }
    }
  float border = 1e9;
  for (int dy = -2; dy <= 2; dy++)
    for (int dx = -2; dx <= 2; dx++) {
      if (dx == 0 && dy == 0) continue;
      vec2 m = blockSite(b.x + dx, b.y + dy) - s;
      float l = length(m);
      border = min(border, 0.5 * l - dot(p - s, m) / l);
    }
  uint h = hash2u(b.x, b.y + ${BLOCK_SALT + 1});
  vec2 nz = fieldNoise(s * ${(BLOCK_M / ESTATE_M).toFixed(6)}, ${ESTATE_SALT});
  float years = ${ROTATION_YEARS.toFixed(1)} * (float(h >> 16) / 65535.0);
  float angle = nz.y * 3.14159265 + 0.6 * (float(h & 0xffffu) / 65535.0 - 0.5);
  float id = 0.5 + 0.5 * fieldNoise(s * ${(BLOCK_M / SPECIES_M).toFixed(6)}, ${SPECIES_SALT}).x;
  return vec4(years, angle, border * ${BLOCK_M.toFixed(1)}, id);
}
`;
