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
import { nightRamp } from '../era/eraLight';

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

// ------------------------------------------------------------------------------------------------ lava (WP5)
//
// Shader-only lava, all through ERA_UNIFORMS (uEraTime, uLava) and no THREE light:
//   - the crater floor: a cracked crust (animated voronoi plates whose seams glow), a molten lake that wanders
//     about its middle, and a hot lip where the floor meets the walls;
//   - LAVA_LOBES: 2-3 flows spilling over the rim and 1-1.5 km down the W/SW flanks along the fall line (radial on
//     the cone, the barrancos' direction), mostly dark crust with glowing seams and a glowing front;
//   - a faked orange irradiance on the ground within LAVA_GLOW_REACH of the vent (the light the lit underside of
//     the plume throws back down) and a short halo either side of each lobe.
// lavaMask() is the pure CPU twin of the GLSL masks (tests/era/lava.test.ts holds them to each other).
//
// Brightness: the auto-exposure spans ~11-18 EV between the safari's dusk start and the night (measured: adapted
// log2 luminance 5.08 at the default boot; at tod 22 -8.08 in the default COCKPIT view, where the lit panel holds
// the adaptation up, and -13.26 in the chase view), so one physical emission cannot be both visible at dusk and
// below FIREFLY_MAX at night. The night peak is sized to the default (cockpit) view: from the safari the crater
// floor and the W/SW lobes are behind the rim, so what reads at 23 km is the glow on the cone's top and the lit
// underside of the plume (PLUME_GLOW_K); close chase views at night may clip into Bloom's FIREFLY clamp (wanted). lavaGain(uLava.w) therefore interpolates the crater's peak
// emission in log space from LAVA_DUSK_PEAK (at the dusk start's ramp value) to LAVA_NIGHT_PEAK (full night):
// an artistic, exposure-tracking glow (poetic license: the lava does not dim, the eye adapts).

/** A lava flow down the cone: its bearing from the vent (deg true), length down the flank from the rim (m), half
 *  width at the rim (m; it widens downhill), and the amplitude (rad) and phase of its gentle meander. */
export interface LavaLobe {
  readonly bearingDeg: number;
  readonly lengthM: number;
  readonly halfWidthM: number;
  readonly wiggle: number;
  readonly phase: number;
}

/** The flows: W and SW flanks, 1.0-1.45 km long (data; WP8 may move them). */
export const LAVA_LOBES: readonly LavaLobe[] = Object.freeze([
  Object.freeze({ bearingDeg: 236, lengthM: 1450, halfWidthM: 42, wiggle: 0.04, phase: 0.4 }),
  Object.freeze({ bearingDeg: 263, lengthM: 1150, halfWidthM: 34, wiggle: 0.035, phase: 2.1 }),
  Object.freeze({ bearingDeg: 211, lengthM: 1000, halfWidthM: 30, wiggle: 0.045, phase: 4.0 }),
]);
/** Wavelength scale of the meander, m: the centre line swings sideways by lavaMeander(s) m (two sines, growing
 *  over the first 200 m below the rim), times the lobe's `wiggle`. */
export const LAVA_MEANDER_M = 120;
/** Sideways swing of the meander at wiggle 1, m. */
export const LAVA_MEANDER_AMP = 1000;
/** The molten crater floor: within this fraction of the crater radius. */
export const LAVA_CRATER_FLOOR = 0.78;
/** Width of the floor's soft edge, m. */
export const LAVA_CRATER_EDGE = 40;
/** The ground glow (and the whole lava term) reaches this far from the vent, m (horizontal). */
export const LAVA_GLOW_REACH = 2000;
/** The ramp value (ERA_UNIFORMS.uNight / uLava.w) at the safari's dusk start (sun 7.2 deg up). */
export const LAVA_DUSK_W = 0.31;
/** Peak crater emission at the dusk start and at full night, scene units (cd/m^2 x 0.1). */
export const LAVA_DUSK_PEAK = 700;
export const LAVA_NIGHT_PEAK = 11;
/** Lobe emission relative to the crater peak (the plan's ~150 against 1500). */
export const LAVA_LOBE_REL = 0.12;
/** Largest factor the crater's crack, lake and flicker terms put on lavaGain (the shader's maximum). */
export const LAVA_PEAK_FACTOR = 1.0;
/**
 * The adapted log2 luminance (AutoExposure, scene units) at night: tod 22, the chase view of the default boot
 * (measured with scripts/shot.mjs, before the lava existed). Documentation only since the look gate: a chase view
 * at night exposes ~5 EV hotter than the cockpit, and the crater may clip into Bloom's clamp there.
 */
export const LAVA_NIGHT_LOG_L = -13.26;
/**
 * The adapted log2 luminance at night in the DEFAULT view: tod 22, the default boot's cockpit at G1 (the panel flood
 * holds it up; measured with the AutoExposure readback, steady from 2 s to 25 s). With EXPOSURE_GLSL's key bias it
 * gives the night exposure the FIREFLY_MAX check uses (tests/era/lava.test.ts).
 */
export const LAVA_NIGHT_LOG_L_COCKPIT = -8.08;
/** Bloom's FIREFLY_MAX (render/post/Bloom.ts, module-private): the largest exposed luminance worth emitting. */
export const LAVA_FIREFLY_MAX = 64;

/**
 * The crater's peak emission (scene units) for the ramp value w = uLava.w: none at 0, LAVA_DUSK_PEAK at the dusk
 * start, log-interpolated down to LAVA_NIGHT_PEAK at 1 (the GLSL lavaGain is the same formula).
 */
export function lavaGain(w: number): number {
  if (!(w > 0)) return 0;
  const t = clamp((w - LAVA_DUSK_W) / (1 - LAVA_DUSK_W), 0, 1);
  const g = Math.pow(2, Math.log2(LAVA_DUSK_PEAK) + (Math.log2(LAVA_NIGHT_PEAK) - Math.log2(LAVA_DUSK_PEAK)) * t);
  return g * smooth(0, LAVA_DUSK_W, w);
}

/** The lobe's centre line s m down the flank from the rim: its sideways offset from the radial line, m. */
function lobeMeander(L: LavaLobe, s: number): number {
  return LAVA_MEANDER_AMP * L.wiggle * (Math.sin(s / LAVA_MEANDER_M + L.phase) + 0.5 * Math.sin(s / (0.39 * LAVA_MEANDER_M) + 2 * L.phase)) * smooth(0, 200, s);
}

/** How much of the lava is at a point. */
export interface LavaMaskValue {
  /** The molten crater floor, 0..1. */
  crater: number;
  /** The strongest lobe, 0..1. */
  lobe: number;
}

export function makeLavaMask(): LavaMaskValue {
  return { crater: 0, lobe: 0 };
}

/** One lobe's weight at a point (dn, de m from the vent, r its distance) on a cone with crater radius rc. */
function lobeWeight(L: LavaLobe, dn: number, de: number, r: number, rc: number): number {
  const s = r - rc;
  const hw0 = L.halfWidthM;
  if (s < -20 || s > L.lengthM + hw0) return 0;
  const b = (L.bearingDeg * Math.PI) / 180;
  const theta = Math.atan2(de, dn);
  const c = Math.cos(theta - b);
  if (c <= 0) return 0;
  const d = Math.abs(r * Math.sin(theta - b) - lobeMeander(L, s));
  const hw = hw0 * (0.55 + 0.6 * clamp(s / L.lengthM, 0, 1));
  return (1 - smooth(0.6 * hw, hw, d)) * smooth(-20, 30, s) * (1 - smooth(L.lengthM - 0.4 * hw, L.lengthM + 0.4 * hw, s));
}

/**
 * The lava's masks at (north, east): the crater floor and the lobes (the CPU twin of VOLCANO_LAVA_HEAD_GLSL's
 * lavaCraterMask / lavaLobes, without the crack pattern). Writes `out` (no allocation) and returns it.
 */
export function lavaMask(north: number, east: number, V: VolcanoSpec, out: LavaMaskValue): LavaMaskValue {
  const dn = north - V.north;
  const de = east - V.east;
  const r = Math.sqrt(dn * dn + de * de);
  const rf = LAVA_CRATER_FLOOR * V.craterRadius;
  out.crater = 1 - smooth(rf - LAVA_CRATER_EDGE, rf, r);
  let lobe = 0;
  for (const L of LAVA_LOBES) lobe = Math.max(lobe, lobeWeight(L, dn, de, r, V.craterRadius));
  out.lobe = lobe;
  return out;
}

const f = (x: number): string => (Number.isInteger(x) ? `${x}.0` : `${x}`);
const lobeGlsl = (L: LavaLobe, i: number): string =>
  `  { float s = r - rc; float hw = ${f(L.halfWidthM)} * (0.55 + 0.6 * clamp(s / ${f(L.lengthM)}, 0.0, 1.0));
    float b = ${((L.bearingDeg * Math.PI) / 180).toFixed(6)};
    float c = cos(theta - b);
    float m = ${f(LAVA_MEANDER_AMP * L.wiggle)} * (sin(s / ${f(LAVA_MEANDER_M)} + ${f(L.phase)}) + 0.5 * sin(s / ${f(0.39 * LAVA_MEANDER_M)} + ${f(2 * L.phase)})) * smoothstep(0.0, 200.0, s);
    float d = abs(r * sin(theta - b) - m);
    float w = c > 0.0 && s > -20.0 && s < ${f(L.lengthM + L.halfWidthM)} ? (1.0 - smoothstep(0.6 * hw, hw, d)) * smoothstep(-20.0, 30.0, s) * (1.0 - smoothstep(${f(L.lengthM)} - 0.4 * hw, ${f(L.lengthM)} + 0.4 * hw, s)) : 0.0;
    float front = smoothstep(${f(L.lengthM)} - 3.0 * hw, ${f(L.lengthM)} - 0.3 * hw, s);
    float halo = c > 0.0 && s > 0.0 && s < ${f(L.lengthM)} ? exp(-max(d - hw, 0.0) / 45.0) * (1.0 - smoothstep(${f(L.lengthM - 100)}, ${f(L.lengthM + 60)}, s)) : 0.0;
    if (w > best.x) best = vec4(w, front, s, ${f(i)} + min(d / hw, 0.999));
    glow = max(glow, halo);
  }
`;

/** GLSL twin of lavaGain (also used by the plume's underglow, render/post/VolcanoPlumeEffect.ts). */
export const LAVA_GAIN_GLSL = /* glsl */ `float lavaGain(float w) {
  if (w <= 0.0) return 0.0;
  float t = clamp((w - ${f(LAVA_DUSK_W)}) / ${(1 - LAVA_DUSK_W).toFixed(4)}, 0.0, 1.0);
  return exp2(mix(${Math.log2(LAVA_DUSK_PEAK).toFixed(6)}, ${Math.log2(LAVA_NIGHT_PEAK).toFixed(6)}, t)) * smoothstep(0.0, ${f(LAVA_DUSK_W)}, w);
}
`;

/**
 * Lava, fragment HEAD slot (WP5): functions and constants, emitted in the terrain fragment shader's head inside
 * `#if VOLCANO` (after VOLCANO_GLSL and ERA_TERRAIN_UNIFORMS_GLSL: uVolcano, uEraTime, uNight, uLava and the
 * terrain helpers / tNoise are in scope).
 */
export const VOLCANO_LAVA_HEAD_GLSL = /* glsl */ `// Lava (volcano.ts): the crater's peak emission for the ramp w (lavaGain), the masks and the crust pattern.
${LAVA_GAIN_GLSL}float lavaCraterMask(float r, float rc) {
  float rf = ${f(LAVA_CRATER_FLOOR)} * rc;
  return 1.0 - smoothstep(rf - ${f(LAVA_CRATER_EDGE)}, rf, r);
}
// The strongest lobe at a point r m from the vent on bearing theta (rad): x = weight, y = how near its front,
// z = metres down the flank, w = which lobe + the distance from its centre line in half widths (fract, < 1);
// glow = the halo either side of any lobe.
vec4 lavaLobes(float r, float theta, float rc, out float glow) {
  vec4 best = vec4(0.0);
  glow = 0.0;
${LAVA_LOBES.map(lobeGlsl).join('')}  return best;
}
vec2 lavaHash2(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return fract(sin(p) * 43758.5453);
}
// Crust plates: the distance to the nearest seam between voronoi cells (cell units), the plates creeping slowly.
float lavaSeam(vec2 p, float t) {
  vec2 i = floor(p), fp = fract(p);
  float d1 = 8.0, d2 = 8.0;
  for (int y = -1; y <= 1; y++)
  for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y));
    vec2 h = lavaHash2(i + g);
    vec2 o = 0.5 + 0.38 * sin(t * (0.04 + 0.05 * h.yx) + 6.2831 * h);
    float d = length(g + o - fp);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
  }
  return d2 - d1;
}
// Seam glow 0..1 of a crust with cells cell m across at footprint fp m per pixel: thin bright seams up close,
// their mean coverage once a cell is only a few pixels wide (no aliasing).
float lavaCracks(vec2 xz, float cell, float t, float fp) {
  float seam = lavaSeam(xz / cell, t);
  float sharp = exp(-seam * 14.0) + 0.35 * exp(-seam * 4.0);
  return mix(sharp, 0.22, smoothstep(0.08, 0.4, fp / cell));
}
const vec3 LAVA_DEEP = vec3(1.0, 0.24, 0.035);
const vec3 LAVA_HOT = vec3(1.0, 0.36, 0.07);
const vec3 LAVA_CORE = vec3(1.0, 0.62, 0.24);
const vec3 LAVA_GLOW = vec3(0.9, 0.35, 0.08);
`;

/**
 * Lava, BODY slot (WP5): emitted inside `#if VOLCANO` immediately before `#include <opaque_fragment>` of the terrain
 * material, adding to `outgoingLight` (linear HDR scene units). Everything is gated on the ramp (uLava.w > 0) and on
 * the vent's reach, so the day and the rest of the world never run it. Switched off by ?eraoff=lava.
 */
export const VOLCANO_LAVA_GLSL = /* glsl */ `{
  vec2 lvRel = vec2(tXZ.x, -tXZ.y) - uVolcano.xy;
  float lvR = length(lvRel);
  if (uLava.w > 0.0 && lvR < ${f(LAVA_GLOW_REACH)}) {
    float lvGain = lavaGain(uLava.w);
    float lvT = uEraTime;
    // Footprint of a pixel on the ground, m (no derivatives: this is non-uniform control flow).
    float lvFp = tDist * 0.0015 / max(abs(dot(normalize(tP - cameraPosition), tN)), 0.15);
    float lvFlick = 0.9 + 0.1 * sin(lvT * 1.3 + 0.004 * tXZ.x) * sin(lvT * 0.71 - 0.003 * tXZ.y);
    vec3 lvEm = vec3(0.0);
    // The crater floor: crust plates with glowing seams, a wandering molten lake, a hot lip at the walls.
    float lvCm = lavaCraterMask(lvR, uVolcano.w);
    if (lvCm > 0.0) {
      float cracks = lavaCracks(tXZ, 22.0, lvT, lvFp);
      vec2 lakeC = vec2(sin(lvT * 0.013), cos(lvT * 0.017)) * 60.0;
      float lake = 1.0 - smoothstep(35.0, 75.0, length(lvRel - lakeC) + 40.0 * (texture(tNoise, tXZ / 260.0 + lvT * 0.002).r - 0.5));
      float lip = smoothstep(${f(LAVA_CRATER_FLOOR - 0.25)} * uVolcano.w, ${f(LAVA_CRATER_FLOOR)} * uVolcano.w, lvR);
      float heat = max(0.015 + 0.45 * cracks * cracks, max(lake * (0.7 + 0.3 * cracks), 0.5 * lip * cracks));
      lvEm += mix(LAVA_HOT, LAVA_CORE, lake) * (lvCm * min(heat, 1.0) * lvFlick * lvGain);
    }
    // The lobes: dark crust with glowing seams, brightest at the front; a halo either side of them.
    float lvHalo;
    vec4 lvL = lavaLobes(lvR, atan(lvRel.x, lvRel.y), uVolcano.w, lvHalo);
    if (lvL.x > 0.0) {
      // Width pulsing along the flow and ragged edges and breakouts; the noise only ever narrows lavaMask's
      // envelope, so the GLSL lobe stays inside the CPU twin.
      float lvId = floor(lvL.w), lvDn = fract(lvL.w);
      float lvN1 = texture(tNoise, vec2(lvL.z / 230.0, 0.31 * lvId + 0.1)).g;
      float lvN2 = texture(tNoise, tXZ / 31.0 + 0.53 * lvId).r;
      float wide = 0.3 + 0.75 * smoothstep(0.25, 0.75, lvN1);
      float core = lvL.x * (1.0 - smoothstep(0.75 * wide, wide, lvDn + 0.22 * (lvN2 - 0.5)));
      float rim = core * smoothstep(0.35 * wide, 0.9 * wide, lvDn + 0.22 * (lvN2 - 0.5));
      float cracks = lavaCracks(vec2(tXZ.x + 37.0 * lvId, tXZ.y), 11.0, lvT * 3.0, lvFp);
      float hotSpots = smoothstep(0.6, 0.85, texture(tNoise, tXZ / 140.0 - 0.21 * lvId + lvT * 0.0005).b);
      float heat = core * (0.002 + cracks * (0.015 + 0.6 * hotSpots)) + 0.6 * rim * cracks + 0.9 * core * lvL.y * (0.4 + 0.6 * cracks);
      lvEm += mix(LAVA_DEEP, LAVA_HOT, smoothstep(0.1, 0.6, heat)) * (min(heat, 1.0) * lvFlick * lvGain * ${f(LAVA_LOBE_REL * 2)});
    }
    // Ground glow: the lit underside of the plume (and the lobes) throw an orange light on the cone around them.
    vec3 lvToV = vec3(uLava.x, uLava.z + 400.0, -uLava.y) - tP;
    float lvD = length(lvToV);
    float lvNdl = 0.35 + 0.65 * max(dot(tN, lvToV / max(lvD, 1.0)), 0.0);
    float lvIrr = 1.2 * lvNdl / (1.0 + lvD * lvD / (450.0 * 450.0)) * (1.0 - smoothstep(${f(LAVA_GLOW_REACH - 600)}, ${f(LAVA_GLOW_REACH)}, lvR));
    lvIrr += 0.25 * lvHalo * ${f(LAVA_LOBE_REL)};
    lvEm += diffuseColor.rgb * LAVA_GLOW * (lvIrr * lvGain * lvFlick);
    outgoingLight += lvEm;
  }
}
`;

/** (east, north, altitude MSL, intensity): the uLava uniform's value. */
export interface LavaState {
  x: number;
  y: number;
  z: number;
  w: number;
}

/**
 * The volcano's glow for ERA_UNIFORMS.uLava at sim time `t`: the crater floor's position and altitude, and the
 * intensity w = the night ramp of the sun's elevation (world/era/eraLight.ts: 0 above +15 deg, 1 at -6 deg). The
 * flicker and crust animation live in the shaders (uEraTime), so w is exactly the ramp. ?eraoff=lava is applied by
 * the caller (eraUniforms.ts). Allocation-free; writes `out`.
 */
export function volcanoLavaState(sky: { sunDir: { y: number } }, t: number, out: LavaState): LavaState {
  const V = era().terrain.volcano;
  if (!V) {
    out.x = out.y = out.z = out.w = 0;
    return out;
  }
  void t;
  out.x = V.east;
  out.y = V.north;
  out.z = V.summit - V.craterDepth;
  out.w = nightRamp(sky.sunDir.y);
  return out;
}
