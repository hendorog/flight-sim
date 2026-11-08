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
import { RILL_AREA, RILL_AREA_TOP, RILL_HEAD, RILL_LOOK_CAP, RILL_PATCH, RILL_RANGE, RILL_TEX, RILL_TEXEL, RILL_WET_RAMP, rillSize, RILL_WET_AREA } from './rills';
import { BED_A, BED_B, WATER_A0, WATER_SHARE0 } from './streams';
import { RIVER_AREA } from './drainage';

/** Water this wide (m) opens the canopy over a painted stream's bed and carries it through the fields: from the first,
 * fully from the second (A about 0.15 and 1.2 km², streams.ts channelHalfWidth). */
export const RILL_OPEN = [0.6, 2.0];
/** Patches held around the viewer: SLOTS_SIDE² texture layers. */
export const RILL_SLOTS_SIDE = 6;
export const RILL_SLOTS = RILL_SLOTS_SIDE * RILL_SLOTS_SIDE;
/** Rills fade out from this distance to the next (3D, from the viewer), m: inside the patches held (at least 2.5
 * patches all round). Far enough that from 1500 m the gullies' streams are drawn down into the valley below. */
export const RILL_FADE_NEAR = 4200;
export const RILL_FADE_FAR = 4900;

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
// A size code's catchment (km²) and its look's size (rills.ts rillArea, rillLook).
float rillArea(float s) { return ${f(RILL_AREA)} * pow(${f(RILL_AREA_TOP / RILL_AREA)}, s); }
float rillLook(float s) { return min(1.0, s * ${f(Math.log(RILL_AREA_TOP / RILL_AREA) / Math.log(RILL_LOOK_CAP / RILL_AREA))}); }
// Half-widths of the channel (its bed) and of the water, m, for a size code (rills.ts rillBedHalf, rillWaterHalf): the
// one width law of every channel (streams.ts bedWidth, waterShare), so a painted stream meets the traced one it runs
// into at its width.
float rillBedHalf(float s) { return 0.5 * ${f(BED_A)} * pow(rillArea(s), ${f(BED_B)}) * smoothstep(0.0, ${f(RILL_HEAD)}, s); }
float rillWaterShare(float s) { return ${f(WATER_SHARE0)} + ${f(1 - WATER_SHARE0)} * clamp(log(rillArea(s) / ${f(WATER_A0)}) / ${f(Math.log(RIVER_AREA / WATER_A0))}, 0.0, 1.0); }
float rillWaterHalf(float s) { return s <= ${f(WET0)} ? 0.0 : rillBedHalf(s) * rillWaterShare(s) * min(1.0, (s - ${f(WET0)}) / ${f(RILL_WET_RAMP)}); }
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
// (The derivatives for a fine noise read inside the branch below.)
vec2 tRillDx = dFdx(tXZ) * ${f(1 / 9)};
vec2 tRillDy = dFdy(tXZ) * ${f(1 / 9)};
float tRillBed = 0.0;
float tRillDamp = 0.0;
float tRillWet = 0.0;
float tRillSize = 0.0;
float tRillOpen = 0.0;
// (The water's half-width on the nearest line, m: a stream wide enough opens the canopy and runs through the fields.)
float tRillWaterW = 0.0;
vec2 tRillBank = vec2(0.0);
// (A rill on steep ground, from about 22 to 32 degrees: a torrent bed, rock-walled and broken; see below. The
// smallest, and those on gentler ground, stay lines of damp herbage.)
float tRillSteep = 0.0;
if (tDist < ${f(RILL_FADE_FAR)}) {
  vec4 rl = rillNear(tXZ);
  float fade = 1.0 - smoothstep(${f(RILL_FADE_NEAR)}, ${f(RILL_FADE_FAR)}, tDist);
  if (rl.y > 0.001) {
    float lk = rillLook(rl.y);
    tRillSize = lk;
    tRillSteep = smoothstep(0.925, 0.845, tUp) * smoothstep(0.15, 0.35, lk);
    // The pixel's footprint across the line (a line running toward the viewer is many pixels wide where one running
    // across the view is foreshortened into one); right on the line, where the vector to it vanishes, the whole one.
    float vl = length(rl.zw);
    vec2 an = rl.zw / max(vl, 1e-3);
    float fpA = vl > 0.05 ? max(9.0 * (abs(dot(tRillDx, an)) + abs(dot(tRillDy, an))), 0.02) : tRillFp;
    // Ragged edges and a width that comes and goes a little along the line (a fine noise, 9 m): far less than between
    // a thread and the trunk it feeds, so the hierarchy reads.
    vec4 nr = textureGrad(tNoise, rot2(tXZ, 1.3) * ${f(1 / 9)}, tRillDx, tRillDy);
    float wob = nr.r - 0.5;
    // On steep ground a torrent bed: its width comes and goes over tens of metres (a slot between rock, a wider scoured
    // stretch), and turf or rock bridges it here and there, so it is no even band (an even pale band across a steep
    // slope read as a track).
    float nr2 = textureGrad(tNoise, rot2(tXZ, 0.4) * ${f(1 / 31)}, tRillDx * ${f(9 / 31)}, tRillDy * ${f(9 / 31)}).g;
    float bh = rillBedHalf(rl.y) * (0.8 + 0.25 * nD.g + 0.2 * nr.g) * mix(1.0, 1.6 * (0.4 + 1.2 * nr2), tRillSteep);
    float dr = rl.x + wob * mix(0.6, 1.2, tRillSteep) * bh;
    tRillBed = rillCover(dr, bh, fpA) * fade * mix(1.0, smoothstep(0.33, 0.5, nr2 + 0.3 * (nr.b - 0.5)), 0.9 * tRillSteep);
    // A strip of wetter, greener herbage along the line, from nothing along a thread to a few channels wide along the
    // bigger reaches, stronger down the line; it thins out into the cover around it rather than ending at an edge.
    float mh = (bh * (2.2 + 2.0 * lk) + 0.8) * (0.75 + 0.5 * nr.b);
    tRillDamp = rillCover(rl.x + wob * 1.5 * bh, mh, fpA + 0.3 * mh) * fade * smoothstep(0.0, 0.04, lk) * mix(0.6, 1.0, smoothstep(0.0, 0.5, lk));
    tRillWaterW = rillWaterHalf(rl.y);
    tRillWet = rillCover(dr, tRillWaterW * (0.8 + 0.4 * nr.a), fpA) * fade;
    // The channel is cut into the slope: its banks lean in toward the line (one lit, one shaded), out to a notch wider
    // and deeper down the line; faded as the notch narrows under a pixel.
    float nh = bh * 2.5 + 3.0 * lk;
    float bank = smoothstep(0.3 * bh, 0.9 * bh, rl.x) * (1.0 - smoothstep(0.6 * nh, nh, rl.x));
    tRillBank = an * bank * fade * clamp(nh / fpA - 0.5, 0.0, 1.0) * (0.8 + 1.6 * lk) * (1.0 + 0.6 * tRillSteep);
  }
}
`;

/**
 * Applied to the ground after the rock (before the snow, which covers rills): the damp margin darkens and greens the
 * cover, the bed is wet soil and stones (more stones on steeper ground), the water dark. Not under the canopy shell.
 */
export function rillSplatGlsl(P: { riverBed: string; scree: string; bankRoughA: string; mud: string }, gravelLayer: number, roads: boolean): string {
  return /* glsl */ `
// Not under the canopy, nor in the fields (ploughed and drained: their ditches are not drawn), nor over a road and its
// verges (a culvert takes the water under it). A stream with RILL_OPEN m of water or more opens the canopy over its
// bed and runs on through the fields.
if (max(max(tRillDamp, tRillBed), abs(tRillBank.x) + abs(tRillBank.y)) > 0.001) tRillOpen = mix((1.0 - tFoliageW) * (1.0 - farmWeight), 1.0, smoothstep(${f(RILL_OPEN[0] / 2)}, ${f(RILL_OPEN[1] / 2)}, tRillWaterW))${roads ? ` * smoothstep(tRoad.y + 1.0, tRoad.y + 4.0, tRoad.x)` : ''};
if (tRillOpen > 0.001) {
  float open = tRillOpen;
  float steep = smoothstep(0.92, 0.7, tUp);
  // Damp margin: lush cover (rushes, moss, tall herbs), a deeper green rather than darker (dark ground only shows the
  // sky's grey sheen from the air), in clumps along the line; rough.
  float clump = 0.65 + 0.35 * smoothstep(0.3, 0.7, nD.r + 0.4 * (nC.a - 0.5));
  vec3 lush = mix(${P.bankRoughA} * vec3(0.7, 0.85, 0.5), acc.albedo * vec3(0.5, 0.7, 0.35), 0.2);
  // (Thin on steep ground: a torrent bed runs between rock and scree, its herbage in patches.)
  float dw = tRillDamp * open * clump * (1.0 - 0.6 * tRillSteep) * mix(0.8, 1.0, tRillSize);
  acc.albedo = mix(acc.albedo, lush, dw * 0.95);
  acc.rough = mix(acc.rough, 1.0, dw);
  // (Herbage: the low sheen of foliage, as the canopy's, not bare ground's grey one.)
  tFoliageW = max(tFoliageW, 0.8 * dw);
  acc.slope += tRillBank * 1.1 * open;
  if (tRillBed > 0.001) {
    // Stony where the ground is steep (and more so down the bigger ones), else dark wet soil under rushes.
    float stones = clamp(steep * (0.85 + 0.3 * tRillSize + 0.6 * (nD.b - 0.5)), 0.0, 1.0);
    vec3 soil = mix(${P.bankRoughA} * 0.85, ${P.mud}, 0.35 * smoothstep(0.35, 0.7, nC.r + 0.3 * nD.a));
    vec3 bed = soil;
    float bedRough = 0.95;
    float bedCavity = 1.0;
    vec2 bedSlope = vec2(0.0);
    // (The gravel layer's reads only where there are stones to show.)
    if (stones > 0.02) {
      Mat g = layerTop(${gravelLayer}, tXZ, tDist);
      // (Wet dark rock and boulders on steep ground, in the shadow of its notch: darker and greyer than scree.)
      // (Mottled: boulders lighter, the gaps between them dark.)
      bed = mix(soil, ${P.scree} * mix(0.6, 0.3 + 0.3 * smoothstep(0.35, 0.75, nD.a + 0.4 * (nC.b - 0.5)), tRillSteep) * g.albedo, stones);
      bedRough = mix(0.95, g.rough, stones);
      bedCavity = mix(1.0, g.cavity * mix(1.0, 0.65, tRillSteep), stones);
      bedSlope = g.slope * stones;
    }
    // In the shade of its notch, and wet toward the middle: a dark line cut into the cover.
    bed *= 0.62 * mix(1.0, 0.7, max(tRillWet, 0.4 * smoothstep(0.3, 0.8, tRillBed)));
    bed *= mix(1.0, 0.75, tRillSteep * smoothstep(0.3, 0.9, tRillBed));
    float w = tRillBed * open;
    acc.albedo = mix(acc.albedo, bed, w);
    tFoliageW = max(tFoliageW, 0.6 * w * (1.0 - stones));
    acc.slope += bedSlope * w;
    acc.rough = mix(acc.rough, bedRough, w);
    acc.cavity = mix(acc.cavity, bedCavity, w);
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
