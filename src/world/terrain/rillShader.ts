// The ground shader's part of the hillside rills (rills.ts traces them; RillSystem.ts streams the patches into the
// texture array these uniforms name). A seeded world only, and not with ?rills=0: elsewhere every text here is '' and
// the terrain shader stays as it was (seed 0's text is hashed by tests/era/presentGuard.test.ts).
//
// Each patch's texels hold the vector to the nearest rill point, the distance to it and the rill's size there
// (rills.ts encode). Interpolated, the vector is exact across a straight line, so the line's edge is placed to a
// fraction of a texel; the distance guards against the vector interpolating to zero between two different lines (it
// stays large there). The bed and the water are drawn with their pixel footprint: a line thinner than a pixel is spread
// over the pixel at its mean cover (no shimmer), and the lot fades out with distance before the streamed patches end.

import * as THREE from 'three';
import { hydrology } from './heightfield';
import { RILL_PATCH, RILL_RANGE, RILL_TEX, RILL_TEXEL, rillSize, RILL_WET_AREA } from './rills';

/** Patches held around the viewer: SLOTS_SIDE² texture layers. */
export const RILL_SLOTS_SIDE = 4;
export const RILL_SLOTS = RILL_SLOTS_SIDE * RILL_SLOTS_SIDE;
/** Rills fade out from this distance to the next (3D, from the viewer), m: inside the patches held (at least 1.5
 * patches all round). */
export const RILL_FADE_NEAR = 2300;
export const RILL_FADE_FAR = 2950;

/** `?rills=0` switches the rills off (shader text and streaming): for measuring their cost and before/after shots. */
export function rillsEnabled(): boolean {
  if (typeof location === 'undefined') return true;
  return new URLSearchParams(location.search).get('rills') !== '0';
}

/** Whether this world draws rills: a seeded world (one whose channels carry their flow), unless switched off. */
export function rillsOn(): boolean {
  return !!hydrology.queryFlow && rillsEnabled();
}

/** Shader text for a world with rills ('' otherwise). */
export const rillText = (t: string): string => (rillsOn() ? t : '');

/** The shared uniforms (RillSystem writes them; the terrain material reads them by reference). */
export const RILL_UNIFORMS = {
  tRills: { value: null as THREE.DataArrayTexture | null },
  /** Per slot: the patch it holds (pi, pj), 1 when it holds that patch's rills (0: none there, or not yet). */
  uRillKey: { value: Array.from({ length: RILL_SLOTS }, () => new THREE.Vector4(1e6, 1e6, 0, 0)) },
};

const f = (x: number): string => x.toFixed(4);
const WET0 = rillSize(RILL_WET_AREA);

/** Declarations and the lookup (fragment head). */
export const RILL_HEAD_GLSL = /* glsl */ `
// Hillside rills (rills.ts, rillShader.ts): a texture layer per patch held, and which patch each layer holds.
uniform highp sampler2DArray tRills;
uniform vec4 uRillKey[${RILL_SLOTS}];
// The rill nearest a world (three.js xz) point: (distance to its line, m; its size code 0..1; the vector to the line,
// three.js xz, m). Size 0: none.
vec4 rillNear(vec2 xz) {
  vec2 en = vec2(xz.x, -xz.y);
  vec2 pc = floor(en / ${f(RILL_PATCH)});
  vec2 sl = mod(pc, ${f(RILL_SLOTS_SIDE)});
  int slot = int(sl.x + sl.y * ${f(RILL_SLOTS_SIDE)} + 0.5);
  vec4 key = uRillKey[slot];
  if (key.z < 0.5 || any(greaterThan(abs(key.xy - pc), vec2(0.5)))) return vec4(1e4, 0.0, 0.0, 0.0);
  vec2 uv = ((en - pc * ${f(RILL_PATCH)}) / ${f(RILL_TEXEL)} + 1.0) / ${f(RILL_TEX)};
  vec4 t = textureLod(tRills, vec3(uv, float(slot)), 0.0);
  vec2 v = (t.xy * 255.0 - 127.5) / 127.5 * ${f(RILL_RANGE)};
  // (The stored distance keeps a vector that interpolates through zero between two lines from drawing a third.)
  float d = max(length(v), t.z * ${f(RILL_RANGE)} - ${f(RILL_TEXEL * 0.73)});
  return vec4(d, t.w, v.x, -v.y);
}
// Half-widths of the damp bed and of the water, m, for a size code (rills.ts rillBedHalf, rillWaterHalf).
float rillBedHalf(float s) { return min(1.0, s * 10.0) * (0.7 + 1.8 * s); }
float rillWaterHalf(float s) { return s <= ${f(WET0)} ? 0.0 : min(1.0, (s - ${f(WET0)}) * 8.0) * (0.2 + 0.8 * (s - ${f(WET0)}) / ${f(1 - WET0)}); }
// Cover of a stripe of half-width hw at distance d, seen through a pixel fp across: a stripe thinner than the pixel
// is spread over it at its mean cover.
float rillCover(float d, float hw, float fp) {
  float e = max(hw, 0.5 * fp);
  return (hw / max(e, 1e-4)) * clamp((e - d) / fp + 0.5, 0.0, 1.0);
}
`;

/** At the top of the splat (uniform control flow: the pixel footprint): the bed, its damp margin and the water here. */
export const RILL_SAMPLE_GLSL = /* glsl */ `
// Rills: the bed (damp, stony on steep ground) in a small notch, its water, a damp margin; faded out with distance.
float tRillFp = max(length(fwidth(tXZ)), 0.02);
float tRillBed = 0.0;
float tRillDamp = 0.0;
float tRillWet = 0.0;
float tRillSize = 0.0;
float tRillOpen = 0.0;
vec2 tRillBank = vec2(0.0);
if (tDist < ${f(RILL_FADE_FAR)}) {
  vec4 rl = rillNear(tXZ);
  float fade = 1.0 - smoothstep(${f(RILL_FADE_NEAR)}, ${f(RILL_FADE_FAR)}, tDist);
  if (rl.y > 0.001) {
    tRillSize = rl.y;
    // A ragged edge (the bed's gravel and the grass at its margin), not a ruled one.
    float bh = rillBedHalf(rl.y) * (0.8 + 0.35 * nD.g);
    tRillBed = rillCover(rl.x, bh, tRillFp) * fade;
    tRillDamp = rillCover(rl.x, bh * 2.4 + 2.0, tRillFp) * fade;
    tRillWet = rillCover(rl.x, rillWaterHalf(rl.y) * (0.85 + 0.3 * nC.b), tRillFp) * fade;
    // The banks of its notch lean in toward the line (lit on one side, shaded on the other), out to twice the bed;
    // faded as the notch narrows under a pixel.
    float bank = smoothstep(0.15 * bh, 0.6 * bh, rl.x) * (1.0 - smoothstep(1.2 * bh, 2.2 * bh, rl.x));
    tRillBank = rl.zw / max(rl.x, 1e-3) * bank * fade * clamp(bh / tRillFp - 0.5, 0.0, 1.0) * (0.8 + 0.8 * rl.y);
  }
}
`;

/**
 * Applied to the ground after the rock (before the snow, which covers rills): the damp margin darkens and greens the
 * cover, the bed is wet soil and stones (more stones on steeper ground), the water dark. Not under the canopy shell.
 */
export function rillSplatGlsl(P: { riverBed: string; scree: string; bankRoughA: string; mud: string }, gravelLayer: number): string {
  return /* glsl */ `
if (tRillDamp > 0.001) {
  float open = 1.0 - tFoliageW;
  tRillOpen = open;
  float steep = smoothstep(0.92, 0.7, tUp);
  // Damp margin: lush cover (rushes, moss, tall herbs), a deeper green rather than darker (dark ground only shows the
  // sky's grey sheen from the air), in clumps along the line; rough.
  float clump = 0.65 + 0.35 * smoothstep(0.3, 0.7, nD.r + 0.4 * (nC.a - 0.5));
  vec3 lush = mix(${P.bankRoughA} * vec3(0.7, 0.85, 0.5), acc.albedo * vec3(0.5, 0.7, 0.35), 0.2);
  float dw = tRillDamp * open * clump;
  acc.albedo = mix(acc.albedo, lush, dw * 0.95);
  acc.rough = mix(acc.rough, 1.0, dw);
  // (Herbage: the low sheen of foliage, as the canopy's, not bare ground's grey one.)
  tFoliageW = max(tFoliageW, 0.8 * dw);
  acc.slope += tRillBank * 1.6 * open;
  if (tRillBed > 0.001) {
    Mat g = layerTop(${gravelLayer}, tXZ, tDist);
    // Stony where the ground is steep (and more so down the bigger ones), else dark wet soil under rushes.
    float stones = clamp(steep * (0.85 + 0.3 * tRillSize + 0.6 * (nD.b - 0.5)), 0.0, 1.0);
    vec3 soil = mix(${P.bankRoughA} * 0.85, ${P.mud}, 0.35 * smoothstep(0.35, 0.7, nC.r + 0.3 * nD.a));
    vec3 bed = mix(soil, ${P.scree} * 0.6 * g.albedo, stones);
    // Wet toward the middle.
    bed *= mix(1.0, 0.7, max(tRillWet, 0.4 * smoothstep(0.3, 0.8, tRillBed)));
    float w = tRillBed * open;
    acc.albedo = mix(acc.albedo, bed, w);
    tFoliageW = max(tFoliageW, 0.6 * w * (1.0 - stones));
    acc.slope = mix(acc.slope, acc.slope + g.slope * stones, w);
    acc.rough = mix(acc.rough, mix(0.95, g.rough, stones), w);
    acc.cavity = mix(acc.cavity, mix(1.0, g.cavity, stones), w);
    if (tRillWet > 0.001) {
      float ww = tRillWet * open;
      acc.albedo = mix(acc.albedo, ${P.riverBed} * 0.5, ww);
      acc.slope *= 1.0 - ww;
      acc.cavity = mix(acc.cavity, 1.0, ww);
      tFoliageW *= 1.0 - ww;
    }
  }
}
`;
}

/** After the roughness and before the normal: the water is smooth and level (it mirrors the sky). */
export const RILL_FINISH_GLSL = /* glsl */ `
// (Only where the water fills most of the pixel: a thread thinner than the pixel darkens it, it does not turn the whole
// pixel into a mirror.)
float tRillGloss = smoothstep(0.35, 0.9, tRillWet) * tRillOpen;
tRough = mix(tRough, 0.08, tRillGloss);
`;
