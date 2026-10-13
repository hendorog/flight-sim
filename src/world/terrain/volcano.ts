// Deep Time (WP6): the stratovolcano of an era with EraTerrain.volcano (world/era/types.ts VolcanoSpec), a
// landmark cone 17.6 km west of the field in the Late Cretaceous. Pure, allocation-free and three.js-free like the
// rest of the heightfield (physics, tile workers and tests get identical answers).
//
// Shape: a concave stratovolcano profile summit * (1 - rr)^1.6 from the crater rim (rr = 0) to the foot (rr = 1),
// its foot made irregular by a seam-free angular warp (lobes of old flows, a fuller flank here and a steeper one
// there); radial barrancos cut into the flanks by the slope-aligned gully filter (noise.gullies) with the downhill
// direction pointing radially outward, shallow below the rim, deepest on the mid flanks and fading out on the
// apron; a crater craterRadius wide and craterDepth deep with a sharp, slightly ragged rim.
//
// naturalHeight (heightfield.ts) merges it with a smooth maximum whose band shrinks to 0 at the cone's foot, so
// beyond volcanoBound() and wherever the cone lies below the land the terrain is exactly unchanged (the
// hydrology, the approach corridors and the airfield never see it; tests/era/volcano.test.ts).
//
// The look: volcanoMask() gives the basalt cone weight (a radial function, twinned in VOLCANO_GLSL for the
// terrain shader) and the ash weight (biome.ts puts it on the sand channel, which the shader paints as ash
// inside the cone's reach).

import { clamp } from '../../core/math';
import type { VolcanoSpec } from '../era/types';
import { fbm, gullies, type Deriv } from './noise';
import { era } from '../era/eraState';

/** Exponent of the concave flank profile. */
export const VOLCANO_PROFILE = 1.6;
/** Relative amplitude of the angular warp of the foot (fraction of the base radius, either way). */
const FOOT_WARP = 0.1;
/** Largest smooth-maximum band where the cone meets the land, m (it shrinks to 0 at the foot). */
const MERGE_BAND = 140;
/** Coarsest barranco cell, m; and the depth of the barrancos on the mid flanks, m. */
const GULLY_CELL = 800;
const GULLY_DEPTH = 150;
const GULLY_OCTAVES = 3;

/** Radial cone weight (basalt), as a fraction of the base radius: full inside CONE_IN, none beyond CONE_OUT. */
export const CONE_IN = 0.55;
export const CONE_OUT = 0.82;
/**
 * Bare basalt crags on the cone (VOLCANO_GLSL volcanoCrag): the cone weight times the slope ramp, from none at an up
 * component of CRAG_UP_NONE to full at CRAG_UP_FULL, times the radial ramp, full inside CRAG_R_FULL base radii and
 * none beyond CRAG_R_NONE.
 */
export const CRAG_UP_NONE = 0.95;
export const CRAG_UP_FULL = 0.86;
export const CRAG_R_FULL = 0.35;
export const CRAG_R_NONE = 0.75;
/** The shader breaks the crag edge with noise on the slope; the woods keep this far (in up) clear of it. */
const CRAG_WOOD_MARGIN = 0.03;
/** The shader paints the sand channel as ash inside ASH_REACH base radii (beaches are far beyond it). */
export const ASH_REACH = 1.15;

const D: Deriv = { dx: 0, dy: 0 };

const smooth = (e0: number, e1: number, x: number): number => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Horizontal distance beyond which the cone never reaches, m (the foot's warp included). */
export function volcanoBound(V: VolcanoSpec): number {
  return V.baseRadius * (1 + FOOT_WARP + 0.04);
}

/**
 * Angular warp of the foot radius at the direction (ux, uy) (a unit vector, east and north): smooth and seam-free
 * because it is noise of the direction vector, not of the angle. About [-1, 1].
 */
function footWarp(ux: number, uy: number): number {
  return 0.8 * fbm(ux * 1.1 + 4.13, uy * 1.1 - 2.71, 2) + 0.35 * fbm(ux * 3.3 - 8.2, uy * 3.3 + 1.9, 2);
}

/**
 * The cone's surface at (north, east), m MSL: the summit (rim) at craterRadius, falling concavely to 0 at the
 * (warped) foot and below 0 beyond it. Only meaningful inside volcanoBound(); merge it with volcanoMerge().
 */
export function volcanoHeight(north: number, east: number, V: VolcanoSpec): number {
  const dn = north - V.north;
  const de = east - V.east;
  const r = Math.sqrt(dn * dn + de * de);
  const rc = V.craterRadius;
  if (r < rc) {
    // Crater: a bowl from the rim down to a flat-ish floor craterDepth below, the rim ragged by a few metres.
    const ux = r > 1e-6 ? de / r : 1;
    const uy = r > 1e-6 ? dn / r : 0;
    const t = r / rc;
    const q = 1 - t * t;
    return V.summit + 6 * footWarp(ux, uy) * t - V.craterDepth * q * q;
  }
  const ux = de / r;
  const uy = dn / r;
  const w = footWarp(ux, uy);
  const foot = V.baseRadius * (1 + FOOT_WARP * w);
  const rr = (r - rc) / (foot - rc);
  if (rr >= 1) return -V.summit * (rr - 1);
  const s = 1 - rr;
  // The rim's raggedness (the crater's) fades out over the first 120 m of the outer flank.
  let h = V.summit * Math.pow(s, VOLCANO_PROFILE) + 6 * w * (1 - smooth(rc, rc + 120, r));

  // Barrancos: radial gullies (the filter's downhill direction is radial), branching as erode() does. Their depth
  // grows away from the rim, peaks on the mid flanks and fades out on the apron.
  const depth = GULLY_DEPTH * smooth(0.0, 0.18, rr) * (1 - smooth(0.55, 0.95, rr));
  if (depth > 0) {
    let x = east / GULLY_CELL;
    let y = north / GULLY_CELL;
    let dx = ux;
    let dy = uy;
    let bx = 0;
    let by = 0;
    let amp = 0.6;
    let sum = 0;
    for (let o = 0; o < GULLY_OCTAVES; o++) {
      const gx = dx + bx * 1.2;
      const gy = dy + by * 1.2;
      const k = 0.9 / Math.sqrt(gx * gx + gy * gy + 1e-9);
      sum += amp * gullies(x, y, gx * k, gy * k, D);
      bx += amp * D.dx;
      by += amp * D.dy;
      amp *= 0.5;
      const nx = (0.8 * x - 0.6 * y) * 2 + 0.29;
      y = (0.6 * x + 0.8 * y) * 2 - 0.47;
      x = nx;
      const rx = 0.8 * dx - 0.6 * dy;
      dy = 0.6 * dx + 0.8 * dy;
      dx = rx;
      const cx = 0.8 * bx - 0.6 * by;
      by = 0.6 * bx + 0.8 * by;
      bx = cx;
    }
    // Ridged: narrow V-shaped ravines between broad spurs (the filter's troughs are its minima).
    h += depth * (sum - 0.35 * Math.abs(sum));
  }
  return h;
}

/**
 * The land h merged with the cone c (volcanoHeight): a smooth maximum whose band narrows to 0 as the cone falls
 * to its foot, so where the cone lies below the land (and beyond its foot) h comes back exactly.
 */
export function volcanoMerge(h: number, c: number): number {
  if (c <= h - MERGE_BAND) return h;
  const k = MERGE_BAND * smooth(0, 600, c);
  if (k <= 1e-9) return Math.max(h, c);
  const t = clamp(0.5 + (0.5 * (c - h)) / k, 0, 1);
  return h + (c - h) * t + k * t * (1 - t);
}

/** Weights of the volcano's look at a point. */
export interface VolcanoMask {
  /** Basalt cone, 0..1: radial (twinned in VOLCANO_GLSL volcanoCone). */
  cone: number;
  /** Ash and scoria, 0..1: the bare upper cone and a ragged apron blown east (downwind) over the lower flanks. */
  ash: number;
  /** Distance from the centre in base radii. */
  rN: number;
}

export function makeVolcanoMask(): VolcanoMask {
  return { cone: 0, ash: 0, rN: 0 };
}

/**
 * The bare basalt crag weight the terrain shader paints at a point (the CPU twin of VOLCANO_GLSL volcanoCrag, without
 * its noise), from the cone weight, the distance in base radii and the land-cover up component (the shader's
 * vCoverUp). `margin` shifts the slope ramp toward gentler ground.
 */
export function volcanoCrag(cone: number, rN: number, up: number, margin = 0): number {
  return cone * smooth(CRAG_UP_NONE + margin, CRAG_UP_FULL + margin, up) * smooth(CRAG_R_NONE, CRAG_R_FULL, rN);
}

/** How much the cone thins the woods at a point: bare where the shader paints crags or ash, half elsewhere on it. */
export function volcanoWoodsCut(m: VolcanoMask, up: number): number {
  return Math.max(m.cone * 0.5, volcanoCrag(m.cone, m.rN, up, CRAG_WOOD_MARGIN), m.ash);
}

/** Radial cone weight from the distance in base radii (the CPU twin of VOLCANO_GLSL volcanoCone). */
export function volcanoCone(rN: number): number {
  return 1 - smooth(CONE_IN, CONE_OUT, rN);
}

/** The volcano's look at (north, east). Writes into `out` (no allocation) and returns it. */
export function volcanoMask(north: number, east: number, V: VolcanoSpec, out: VolcanoMask): VolcanoMask {
  const dn = north - V.north;
  const de = east - V.east;
  const r = Math.sqrt(dn * dn + de * de);
  const rN = r / V.baseRadius;
  out.cone = volcanoCone(rN);
  out.rN = rN;
  if (rN >= ASH_REACH) {
    out.ash = 0;
    return out;
  }
  // Bare upper cone: loose ash and scoria nothing has taken hold on, its lower edge broken into tongues.
  const n1 = fbm(east / 1100 + 3.7, north / 1100 - 6.1, 3);
  const upper = 1 - smooth(0.22, 0.36, rN + 0.06 * n1);
  // The apron: fresh fall streaked downwind (east, toward the field), in ragged lobes.
  const lee = r > 1e-6 ? de / r : 0;
  const n2 = fbm(east / 1800 - 1.3, north / 700 + 2.2, 3);
  const apron = smooth(0.15, 0.55, n2 + 0.2 * lee) * (1 - smooth(0.35, 0.8, rN - 0.12 * lee)) * 0.85;
  out.ash = Math.max(upper, apron);
  return out;
}

/**
 * GLSL twin of volcanoCone (the cone weight from the world position), and the uVolcano uniform it reads:
 * (east, north, baseRadius, craterRadius). Emitted only under the VOLCANO define, outside the present day.
 */
export const VOLCANO_GLSL = /* glsl */ `uniform vec4 uVolcano;
// Distance from the volcano's centre in base radii, at a world (three.js xz) position.
float volcanoR(vec2 xz) { return length(vec2(xz.x, -xz.y) - uVolcano.xy) / uVolcano.z; }
// Basalt cone weight (volcano.ts volcanoCone).
float volcanoCone(float rN) { return 1.0 - smoothstep(${CONE_IN.toFixed(3)}, ${CONE_OUT.toFixed(3)}, rN); }
// Bare basalt crags (volcano.ts volcanoCrag): steep ground on the upper cone, the slope edge broken by noise.
float volcanoCrag(float cone, float rN, float up) { return cone * smoothstep(${CRAG_UP_NONE.toFixed(3)}, ${CRAG_UP_FULL.toFixed(3)}, up) * smoothstep(${CRAG_R_NONE.toFixed(3)}, ${CRAG_R_FULL.toFixed(3)}, rN); }
`;

// ------------------------------------------------------------------------------------------------ increment 2
//
// WP0a contract (FROZEN names; WP5 owns the contents): the volcano's colours as GLSL literals, the lava shader
// slots of the terrain material, and the lava state behind ERA_UNIFORMS.uLava.

/**
 * The volcano's terrain colours (linear albedo), as the exact GLSL text the terrain material splices in
 * (terrainMaterial.ts VOLCANO_ROCK, VOLCANO_ASH, VOLCANO_CRATER). Strings, not numbers, so the shader text is
 * byte-identical to the literals they replaced (tests/era/eraHooks.test.ts). WP5 lifts them.
 */
export const VOLCANO_PALETTE = Object.freeze({
  /** Near-black basalt of the cone. */
  basalt: 'vec3(0.052, 0.049, 0.046)',
  /** Oxidised red-brown scoria near the top. */
  scoria: 'vec3(0.12, 0.052, 0.03)',
  /** Ash and scoria fall (the sand channel within the cone's reach), and its paler patches. */
  ash: 'vec3(0.05, 0.048, 0.046)',
  ashPale: 'vec3(0.095, 0.088, 0.078)',
  /** Hydrothermally altered crater floor: ochre, sulphur-yellow, pale crusts. */
  craterOchre: 'vec3(0.16, 0.09, 0.04)',
  craterSulphur: 'vec3(0.52, 0.44, 0.12)',
  craterPale: 'vec3(0.5, 0.48, 0.42)',
});

/**
 * Lava, fragment HEAD slot (WP5): functions and constants, emitted in the terrain fragment shader's head inside
 * `#if VOLCANO` (after VOLCANO_GLSL and ERA_TERRAIN_UNIFORMS_GLSL: uVolcano, uEraTime, uNight, uLava and the
 * terrain helpers / tNoise are in scope). Empty: nothing is emitted (the stub).
 */
export const VOLCANO_LAVA_HEAD_GLSL = '';

/**
 * Lava, BODY slot (WP5): emitted inside `#if VOLCANO` immediately before `#include <opaque_fragment>` of the terrain
 * material (MeshStandardMaterial), where `outgoingLight` (linear HDR scene units: cd/m^2 x 0.1, before fog and tone
 * mapping) can be added to. In scope: everything of the splat (tP, tXZ, tN, tUp, tDist, tVolR, tVolc, the noise
 * samples nA..nD, sB..sD, acc) and the uniforms above. Empty: nothing is emitted (the stub). Switched off by
 * ?eraoff=lava (the slot stays empty).
 */
export const VOLCANO_LAVA_GLSL = '';

/** (east, north, altitude MSL, intensity): the uLava uniform's value. */
export interface LavaState {
  x: number;
  y: number;
  z: number;
  w: number;
}

/**
 * The volcano's glow for ERA_UNIFORMS.uLava at sim time `t` (WP5 fills the intensity from the night ramp and its
 * own animation). Stub: the crater's position and summit, intensity 0 (no glow). Allocation-free; writes `out`.
 */
export function volcanoLavaState(sky: { sunDir: { y: number } }, t: number, out: LavaState): LavaState {
  const V = era().terrain.volcano;
  if (!V) {
    out.x = out.y = out.z = out.w = 0;
    return out;
  }
  out.x = V.east;
  out.y = V.north;
  out.z = V.summit - V.craterDepth;
  // The stub glows not at all. WP5: e.g. nightRamp(sky.sunDir.y) (world/era/eraLight.ts) times its flicker at t.
  void sky;
  void t;
  out.w = 0;
  return out;
}
