// Water: the sea and lakes are flat per-node meshes built with the terrain tiles (tileBuilder.ts); the
// river is one ribbon mesh along its centreline, following its falling water level. Both use the same
// transparent MeshStandardMaterial patch, blended premultiplied:
//   - wave normals from a four-octave drifting wave height field, differentiated over a step that grows
//     with distance; the slopes too small to resolve become surface roughness (Cox-Munk slope variance), so
//     far water is a rough mirror whose sun glint spreads into a glitter path;
//   - the bed seen through the water, attenuated over twice the depth (clear coastal sea, turbid river),
//     and the body's own scattered light; shoreline foam in the last half metre;
//   - reflection of scene.environment through the standard PBR path (Fresnel included), at full strength
//     whatever the water's transparency, or of an analytic sky gradient when there is no environment map.
// A seeded world's channels also run (see 'flow' below): whitewater by steepness on the ribbons, and the falls'
// curtains, pool foam and spray as their own meshes; seed 0's text has none of it.

import * as THREE from 'three';
import { PALETTES } from './eraPalette';
import { HASH_GLSL } from './glsl';
import { hydrology, snowLineBase, snowShiftM } from './heightfield';
import { lakeRadius } from './hydrology';
import { REGIME } from './streams';
import { channelStonesGlsl, GRAIN_TOP, grainToUnit, STONE_ACROSS, STONE_ALONG, STONE_FILL } from './channelStones';
import { BEDROCK_GLSL, GALLERY_ROCK_THIN } from './bedrock';
import { hash2i } from './noise';
import { BAR_FAR, BAR_NEAR } from './channelForm';
import { GALLERY_FLOOR, RIPARIAN_GLSL, RIPARIAN_TREE_HEIGHT } from './riparian';
import type { WaterData } from './tileBuilder';
import { era, isPresent } from '../era/eraState';
import { LAYER, LAYER_ROUGHNESS } from './textures';
import { worldSeed } from '../worldSeed';

export interface WaterUniforms {
  uTime: { value: number };
  uSkyColor: { value: THREE.Color };
  uHazeColor: { value: THREE.Color };
  [name: string]: { value: unknown };
}

const VERTEX_HEAD = /* glsl */ `
attribute float aDepth;
varying float vDepth;
varying vec3 vWaterPos;
#ifdef RIVER
// Across the channel (m, + toward the right bank looking downstream), arc length from the source (m) and
// half-width (m); the flow direction (three.js xz).
attribute vec3 aRiverInfo;
attribute vec2 aRiverT;
varying vec3 vRiverInfo;
varying vec2 vRiverT;
#endif
`;

const VERTEX_BEGIN = /* glsl */ `
vec3 transformed = position;
vDepth = aDepth;
#ifdef RIVER
// Far away the terrain lattice is coarser than the channel; lift the ribbon a little so the river stays
// visible over its banks instead of flickering in and out under interpolated terrain.
{
  vec3 wp = (modelMatrix * vec4(position, 1.0)).xyz;
  transformed.y += clamp((distance(wp, cameraPosition) - 4000.0) * 0.0008, 0.0, 6.0);
}
#endif
vWaterPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
#ifdef RIVER
vRiverInfo = aRiverInfo;
vRiverT = aRiverT;
#endif
`;

const FRAGMENT_HEAD = /* glsl */ `
uniform sampler2D tNoise;
uniform float uTime;
uniform vec3 uSkyColor;
uniform vec3 uHazeColor;
varying float vDepth;
varying vec3 vWaterPos;
#ifdef RIVER
varying vec3 vRiverInfo;
varying vec2 vRiverT;
${HASH_GLSL}
${RIPARIAN_GLSL}
#endif
// Wave height field, m: four octaves of drifting noise at unrelated scales and directions. 'energy'
// scales the chop (sheltered shallows and rivers are calmer than open deep water).
float waveHeight(vec2 p, float energy, float e) {
  vec2 q = vec2(0.8 * p.x - 0.6 * p.y, 0.6 * p.x + 0.8 * p.y);
  float h = 0.16 * texture(tNoise, q / 47.0 + uTime * vec2(0.0021, 0.0013)).r;
  h += 0.07 * texture(tNoise, p.yx / 13.7 + uTime * vec2(-0.0071, 0.0049)).g;
  // Octaves shorter than the difference step are sub-pixel: their slopes are in the roughness instead.
  if (e < 3.0) h += 0.03 * texture(tNoise, q / 4.3 + uTime * vec2(0.019, -0.023)).b;
  if (e < 1.0) h += 0.012 * texture(tNoise, p / 1.37 + uTime * vec2(-0.05, 0.061)).a;
  return h * energy;
}
// Surface slope by forward differences; the step grows with distance so the sampled waves are never
// finer than a pixel (the glitter path widens instead of aliasing).
vec2 waveSlope(vec2 p, float dist, float energy) {
  float e = max(0.08, dist * 0.0015);
  float h0 = waveHeight(p, energy, e);
  return vec2(waveHeight(p + vec2(e, 0.0), energy, e) - h0, waveHeight(p + vec2(0.0, e), energy, e) - h0) / e;
}
// Direct (sun, moon) reflection off the waves: a Beckmann facet distribution - Gaussian wave slopes, as Cox
// and Munk measured on the sea - rather than GGX, whose long tails would light the water with the sun's
// glint tens of degrees away from it. alpha^2 is the unresolved slope variance (roughness = alpha^0.5).
vec3 BRDF_Water(vec3 L, vec3 V, vec3 N, float roughness) {
  float a = max(roughness * roughness, 0.02);
  float a2 = a * a;
  vec3 H = normalize(L + V);
  float nl = max(dot(N, L), 1e-4);
  float nv = max(dot(N, V), 1e-4);
  float nh = max(dot(N, H), 1e-4);
  float vh = max(dot(V, H), 0.0);
  float nh2 = nh * nh;
  float D = exp((nh2 - 1.0) / (a2 * nh2)) / (PI * a2 * nh2 * nh2);
  // Smith shadowing for Beckmann, Schlick's form (k = alpha sqrt(2 / pi)), folded into the visibility term.
  float k = a * 0.7979;
  float vis = 0.25 / ((nl * (1.0 - k) + k) * (nv * (1.0 - k) + k));
  float f5 = 1.0 - vh;
  float f2 = f5 * f5;
  float F = 0.02 + 0.98 * f2 * f2 * f5;
  return vec3(F * D * vis);
}
`;

/** The body of the water fragment, coloured from the era's palette (eraPalette.ts; the present strings are today's literals). */
export function fragmentMain(): string {
  const P = PALETTES[era().palette];
  return /* glsl */ `
float wDist = length(vWaterPos - cameraPosition);
float depth = max(vDepth, 0.0);
#ifdef RIVER
float energy = 0.6;
#else
// Open sea (at sea level) carries more chop than sheltered lakes; both calm in the last metres of the
// shallows. (Saturating within a few metres: the bed depth is interpolated differently by neighbouring
// LOD tiles, which must not show as steps in the waves' roughness.)
float energy = mix(0.6, vWaterPos.y < 0.5 ? 1.8 : 1.0, smoothstep(0.5, 6.0, depth));
#endif
// Gusts and lulls: patches of rougher and calmer water drifting with the wind (cat's paws), which break a
// wide sheet of water into brighter and darker reflecting areas.
vec4 gustN = texture(tNoise, vWaterPos.xz * (1.0 / 420.0) + uTime * vec2(0.0011, 0.0007));
float gust = gustN.g + 0.6 * gustN.r - 0.8;
energy *= clamp(1.0 + 1.6 * gust, 0.35, 1.8);
vec2 wSlope = waveSlope(vWaterPos.xz, wDist, energy);
vec3 wNormal = normalize(vec3(-wSlope.x, 1.0, -wSlope.y));
// Surface roughness from the wave slopes too small to resolve in this pixel (Cox-Munk: the sea's total
// slope variance is about 0.003 + 0.005 per m/s of wind; sheltered lakes and rivers much less). Most of it
// sits in waves of centimetres to a metre, so the unresolved share grows with the pixel footprint: close
// up the surface is a rippled mirror, far away a rough one whose sun glint spreads into a glitter path.
vec3 wFoot = max(abs(dFdx(vWaterPos)), abs(dFdy(vWaterPos)));
float footprint = max(length(wFoot), 1e-3);
float slopeVar = mix(0.004, 0.024, smoothstep(0.3, 2.2, energy));
float unresolved = slopeVar * footprint / (footprint + 0.4);
float wRough = clamp(sqrt(sqrt(unresolved)), 0.05, 0.6);
// Optics of the water body. Light reaching the bed and back is attenuated over twice the depth: the sea is
// clear coastal water (red absorbed within metres, blue-green travels far), the river turbid with silt
// (its bed shows only in the last few decimetres of the shallows). What does not reach the bed is scattered
// back by the water itself (the body colour).
#ifdef RIVER
vec3 atten = ${P.riverAtten};
vec3 body = ${P.riverBody};
#else
vec3 atten = ${P.seaAtten};
vec3 body = mix(${P.seaBodyDeep}, ${P.seaBodyShallow}, exp(-depth * 0.08));
#endif
vec3 trans = exp(-2.0 * depth * atten);
float wTrans = dot(trans, vec3(0.25, 0.5, 0.25));
diffuseColor.rgb = body;
// Shoreline foam where the water is shallowest, broken up by drifting noise.
float foamN = texture(tNoise, vWaterPos.xz / 9.0 + uTime * 0.01).b;
// Surf only on the sea (at sea level); lake and river shores are calm, just a thin wet margin.
float surf = 1.0 - smoothstep(0.5, 3.0, vWaterPos.y);
float foam = smoothstep(0.7, 0.0, vDepth) * smoothstep(0.35, 0.6, foamN + 0.25 * sin(uTime * 0.8 + vWaterPos.x * 0.05)) * surf;
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.75), foam);
wTrans *= 1.0 - foam;
`;
}

const FRAGMENT_OUTPUT = /* glsl */ `
vec3 V = normalize(cameraPosition - vWaterPos);
float cosV = clamp(dot(wNormal, V), 0.0, 1.0);
// Water (n = 1.33): 2% at normal incidence.
float fresnel = 0.02 + 0.98 * pow(1.0 - cosV, 5.0);
// Direct glint (BRDF_Water) plus the sky reflection with water's own Fresnel: three's split-sum fit assumes
// GGX tails and F0 = 0.04, which roughly doubles the sky reflected by rough water at mid angles.
vec3 wSky;
#ifdef USE_ENVMAP
wSky = radiance;
#else
{
  // No environment map: reflect an analytic sky (zenith colour to horizon haze).
  vec3 R = reflect(-V, wNormal);
  wSky = mix(uHazeColor, uSkyColor, smoothstep(0.0, 0.5, R.y));
}
#endif
vec3 wDirect = reflectedLight.directSpecular;
#ifdef RIVER
{
  // The far bank in the mirror: follow the reflected ray (it keeps the view's horizontal direction and rises
  // at the view's depression angle) to the bank it heads for. Where it passes below the bank's herbage or
  // the bankside trees there (riparianPresence, the same trees vegetation/placement.ts plants), the water
  // reflects them instead of the sky - the dark band under a wooded bank.
  vec2 dH = vWaterPos.xz - cameraPosition.xz;
  float hd = max(length(dH), 1e-3);
  dH /= hd;
  float rise = max(cameraPosition.y - vWaterPos.y, 0.0) / hd;
  vec2 fT = normalize(vRiverT);
  vec2 fR = vec2(-fT.y, fT.x);
  float c = dot(dH, fR);
  float bSide = c >= 0.0 ? 1.0 : -1.0;
  float ac = max(abs(c), 0.03);
  float x = max(vRiverInfo.z - bSide * vRiverInfo.x, 0.0) / ac;
  float sHit = vRiverInfo.y + dot(dH, fT) * x;
  // Canopy cover of the bank seen edge-on: in another era the gallery is broken (placement plants at most ~60% of
  // its candidates where presence is 1, fewer further from the water), so gaps show the sky between crowns; today
  // the bank is wooded nearly throughout (riparian.ts GALLERY_FLOOR).
  float trees = ${isPresent()
    ? `(${GALLERY_FLOOR.toFixed(2)} + ${(1 - GALLERY_FLOOR).toFixed(2)} * riparianPresence(sHit, bSide)) * (0.6 + 0.35 * texture(tNoise, vec2(sHit / 23.0, bSide * 0.37)).r)`
    : 'riparianPresence(sHit, bSide) * (0.25 + 0.35 * texture(tNoise, vec2(sHit / 23.0, bSide * 0.37)).r)'};
  // Crown outline along the bank: tree-sized bumps of varying height.
  float crowns = texture(tNoise, vec2(sHit / 31.0, 0.61 + bSide * 0.23)).g + 0.5 * texture(tNoise, vec2(sHit / 8.0, 0.13 + bSide * 0.31)).b;
  float hT = ${RIPARIAN_TREE_HEIGHT.toFixed(1)} * clamp(0.35 + 0.75 * crowns, 0.3, 1.5);
  float fw = max(fwidth(x * rise), 0.02);
  float herb = 1.0 - smoothstep(-fw, fw, (x + 1.5 / ac) * rise - 1.4);
  float tree = trees * (1.0 - smoothstep(-fw - 0.5, fw + 0.5, (x + 7.0 / ac) * rise - hT));
  float bank = max(herb, tree);
  if (bank > 0.001) {
    // Light on the bank: the irradiance this water fragment receives (its lit body colour over its albedo),
    // on foliage seen partly in its own shade.
    vec3 irr = (reflectedLight.directDiffuse + reflectedLight.indirectDiffuse) / max(diffuseColor.rgb * RECIPROCAL_PI, vec3(1e-5));
    vec3 foliage = mix(vec3(0.055, 0.07, 0.03), vec3(0.035, 0.055, 0.022), tree / max(bank, 1e-3));
    wSky = mix(wSky, foliage * irr * RECIPROCAL_PI * 0.6, bank);
    wDirect *= 1.0 - bank;
  }
}
#endif
vec3 wSpec = wDirect + wSky * fresnel;
// Premultiplied output (blending ONE, ONE_MINUS_SRC_ALPHA): the reflection adds at full strength; what the
// surface transmits shows the bed (the terrain already drawn behind) scaled by the water's transmittance,
// and the body's own scattered light fills the rest.
float wEdge = smoothstep(-0.05, 0.25, vDepth);
float wSeen = (1.0 - fresnel) * wTrans;
vec3 wColor = totalDiffuse * (1.0 - wTrans) * (1.0 - fresnel) + wSpec;
gl_FragColor = vec4(wColor * wEdge, (1.0 - wSeen) * wEdge);
`;

// ------------------------------------------------------------------------------------------------ ice
// Above the snow line a lake (or river) is frozen and snowed over: flat, matte snow, no chop, no sky reflection
// and no glint, opaque. The test is the terrain shader's own snow test (terrainMaterial.ts fragmentSplat:
// snowLine, snowW and the snow layer's cover weight) evaluated per pixel at the water surface, with the same
// noise samples, so the ice ends where the snow on the shore ends: the shore pixel and the water's edge pixel
// stand at the same height and position and read the same noise. On flat water the aspect term is 0 and the
// slope factor 1. The hollow term (150 m x concavity) comes from the terrain's own curvature at the water's
// lattice vertices (the tile's shape bytes, the very values the terrain mesh interpolates there) at the shore
// only: the bed's curvature means nothing to ice, so from 0.5 m of depth to 3 m the lake takes ICE_LAKE_CONCAVE
// instead (else the bed's bumps print through as floes). A river ribbon has no lattice vertices, so it takes
// ICE_RIVER_CONCAVE. Both are the means measured on the 32 m cover lattice at the shores of the 25 highest lakes
// and along the river banks of seeds 1, 42 and 131 (scripts/probes/shoreConcave): lake shores median 0, mean
// 0.17-0.19, p90 0.57-0.61; river banks median 0, mean 0.10-0.12 (so a constant at the shore itself would be
// up to ~90 m of snow line off along a tenth of it, which is why the shore uses the vertex values).
// Only worlds with water within ICE_REACH of the snow line's base get this code at all (waterFreezes()): the
// shader's noise and hollow terms lower the line by at most ~620 m, so lower water can never freeze. Seed 0's
// water stands 1200 m below it, so its water and river shaders are unchanged, byte for byte.

/** Water further than this below snowLineBase() can never pass the shader's snow test, m. */
const ICE_REACH = 700;
/** Concavity (terrainMaterial.ts 'concave', 0..1) taken for a river ribbon (the mean along river banks). */
const ICE_RIVER_CONCAVE = 0.1;
/** Concavity taken away from a lake's shore (the mean along lake shores). */
const ICE_LAKE_CONCAVE = 0.2;
/**
 * The ice sheet over the whole water: the hollow a lake lies in (a basin's floor: the hollowest tenth of the shores,
 * p90 0.57-0.61) and a river's banks (their mean). With 150 m per unit its midpoint lies 50 m under the snow line for
 * a lake (25 m over it for a river): heightfield.ts terrainSurface's thresholds. Shallow water freezes first: up to
 * ICE_SHALLOW m more lift at the shore, gone by 8 m of depth, so a lake near the line has a rim of ice round open
 * water in its middle rather than floes in the middle of open water.
 */
const ICE_SHEET_LAKE = 0.6;
const ICE_SHALLOW = 30;
const ICE_SHEET_RIVER = ICE_RIVER_CONCAVE;

let freezeKey = '';
let freezeVal = false;
/** Whether any of this world's lakes or rivers stands high enough that the shader's snow test can freeze it. */
export function waterFreezes(): boolean {
  const lim = snowLineBase() - ICE_REACH;
  const key = `${worldSeed()}|${era().id}|${snowShiftM()}`;
  if (key === freezeKey) return freezeVal;
  // A seeded world's every pool (LakeMask: a pond's sub-basins too, not only the lakes listed), else the lakes.
  let any = (hydrology.lakeMask?.pools ?? hydrology.lakes).some((l) => l.level > lim && !('drained' in l && l.drained));
  for (const r of hydrology.rivers ?? [hydrology.river]) {
    if (any) break;
    for (let i = 0; i < r.level.length; i++) if (r.level[i] > lim) { any = true; break; }
  }
  freezeKey = key;
  freezeVal = any;
  return any;
}

const ICE_VERTEX_HEAD = (river: boolean): string => `${river ? '' : 'attribute float aIceShape;\n'}varying float vIceConcave;
`;
// terrainMaterial.ts: vCurvature = aShape.x * 2 - 1, concave = clamp(vCurvature * 1.5, 0, 1).
const ICE_VERTEX = (river: boolean): string =>
  river ? `vIceConcave = ${ICE_RIVER_CONCAVE.toFixed(2)};\n` : 'vIceConcave = clamp((aIceShape * 2.0 - 1.0) * 1.5, 0.0, 1.0);\n';
const ICE_FRAGMENT_HEAD = /* glsl */ `
varying float vIceConcave;
vec2 iceRot2(vec2 p, float a) { float c = cos(a), s = sin(a); return vec2(c * p.x - s * p.y, s * p.x + c * p.y); }
`;
const iceFragment = (): string => /* glsl */ `
// Frozen above the snow line (see water.ts 'ice'): the terrain's snow line and snow weight at this point.
float wIce;
{
  vec2 iXZ = vWaterPos.xz;
  float iA = (texture(tNoise, iXZ * (1.0 / 5200.0)).b - 0.5) * 2.5;
  float iB = (texture(tNoise, iceRot2(iXZ, 0.9) * (1.0 / 1300.0)).r - 0.5) * 2.5;
  vec4 iC = (texture(tNoise, iceRot2(iXZ, 2.1) * (1.0 / 260.0)) - 0.5) * 2.5;
  float iLine = ${snowLineBase().toFixed(1)} + 180.0 * iA + 60.0 * iB;
#ifdef RIVER
  float iOpen = 0.0;
#else
  // Away from the shore (0.5 to 3 m of depth) the lake's own rules: the mean shore hollowness, and a crisp ice
  // edge with a ragged outline (a sheet of ice ends at an edge; it does not fade into the water like snow
  // thinning out on a slope).
  float iOpen = smoothstep(0.5, 3.0, depth);
#endif
  float iConcave = mix(vIceConcave, ${ICE_LAKE_CONCAVE.toFixed(2)}, iOpen);
  float iSnowW = smoothstep(iLine - 60.0, iLine + 140.0, vWaterPos.y + 90.0 * iC.r + 150.0 * iConcave);
  // The snow layer's cover weight over neutral ground (acc.height 0.5).
  wIce = clamp(iSnowW * 1.6 - 0.3, 0.0, 1.0);
  float iRag = 0.3 * (texture(tNoise, iceRot2(iXZ, 4.0) * (1.0 / 47.0)).g - 0.5);
  if (iOpen > 0.0 && wIce > 0.0 && wIce < 1.0) {
    wIce = mix(wIce, smoothstep(-0.04, 0.04, wIce - 0.5 + iRag), iOpen);
  }
  // Above the snow line the water is a sheet of ice, shore to shore: the same test on the water's level against
  // the broad snow line alone (no 260 m patches: they would leave holes of open water in the middle of a frozen
  // lake) with the hollow of the basin it lies in; a crisp, ragged edge only where the line crosses the water.
#ifdef RIVER
  float iSheet = smoothstep(iLine - 60.0, iLine + 140.0, vWaterPos.y + ${(150 * ICE_SHEET_RIVER).toFixed(1)});
#else
  float iSheet = smoothstep(iLine - 60.0, iLine + 140.0, vWaterPos.y + ${(150 * ICE_SHEET_LAKE).toFixed(1)} + ${ICE_SHALLOW.toFixed(1)} * (1.0 - smoothstep(0.5, 8.0, depth)));
#endif
  wIce = max(wIce, smoothstep(-0.04, 0.04, clamp(iSheet * 1.6 - 0.3, 0.0, 1.0) - 0.5 + iRag));
  if (wIce > 0.0) {
    // The terrain's snow colour (firn, a little grey); its detail texture averages to 1. A faint tone of wind
    // drifts on the level snow (as the detail texture's mid scale varies the snow on the shore).
    float iDrift = texture(tNoise, iceRot2(iXZ, 1.3) * (1.0 / 31.0)).b - 0.5;
    diffuseColor.rgb = mix(diffuseColor.rgb, ${PALETTES[era().palette].snow} * (0.92 + 0.08 * iC.g) * (1.0 + 0.12 * iDrift), wIce);
    wNormal = normalize(mix(wNormal, vec3(0.0, 1.0, 0.0), wIce));
    wRough = mix(wRough, ${LAYER_ROUGHNESS[LAYER.snow].toFixed(2)}, wIce);
    wTrans *= 1.0 - wIce;
  }
}
`;
/** The ice code spliced into a water shader (only in a world where waterFreezes()). */
function withIce(shader: { vertexShader: string; fragmentShader: string }, river: boolean): void {
  shader.vertexShader = shader.vertexShader
    .replace('attribute float aDepth;\n', `attribute float aDepth;\n${ICE_VERTEX_HEAD(river)}`)
    .replace('vDepth = aDepth;\n', `vDepth = aDepth;\n${ICE_VERTEX(river)}`);
  shader.fragmentShader = shader.fragmentShader
    .replace('varying float vDepth;\n', `varying float vDepth;\n${ICE_FRAGMENT_HEAD}`)
    .replace('wTrans *= 1.0 - foam;\n', `wTrans *= 1.0 - foam;\n${iceFragment()}`)
    // No sky reflection and no glint off the snow; opaque.
    .replace('vec3 wSpec = wDirect + wSky * fresnel;\n', 'vec3 wSpec = (wDirect + wSky * fresnel) * (1.0 - wIce);\n')
    .replace('gl_FragColor = vec4(wColor * wEdge, (1.0 - wSeen) * wEdge);\n', 'wColor = mix(wColor, totalDiffuse, wIce);\ngl_FragColor = vec4(wColor * wEdge, mix(1.0 - wSeen, 1.0, wIce) * wEdge);\n');
}

// ----------------------------------------------------------------------------------------------- flow
// Running water (a seeded world's network: hydrology.rivers carries each sample's steepness and speed, streams.ts).
// The ribbon carries aFlow = (steepness 0-1, speed m/s, fall weight 0-1) per row. A placid reach (steepness under
// FLOW_FROM) runs none of this code and looks as it did. Above it: the surface's ripples and foam ride downstream at
// the water's speed (sampled along the channel's own arc length, in two cross-faded phases so a reach whose speed
// changes never shears the pattern), broken white water spreads with the steepness (streaks on a riffle, standing
// waves and broken water on rapids, most of a step-pool cascade white), the surface roughens, and between the white
// the water is aerated: lighter and less transparent on a river, shallow and clear over a small stream's stony bed.
// Far away, where a pixel spans the foam pattern, the white takes its mean cover instead (no shimmer, still white).
// Falls (hydrology.falls) are their own meshes on a variant of this material (FALLS): a curtain from the lip to the
// pool, curving out over the lip, its strands falling at the speed a parcel of water has reached there; foam on the
// plunge pool, and a puff of spray over it. The ice (withIce) is spliced after this code, so frozen water stays ice.

/** Steepness (RiverLine.steepness) below which a reach is drawn as placid water, unchanged. */
const FLOW_FROM = 0.2;
/** Top of the speed range the ribbon's aFlow bytes hold, m/s (streams.ts flowOf clamps to 6). */
const FLOW_SPEED_MAX = 6;

let flowOff = false;
/** Turn the running-water look off (or back on) for materials and ribbons built after this (a dev comparison). */
export function setWaterFlow(on: boolean): void {
  flowOff = !on;
  flowKey = '';
}
let flowKey = '';
let flowVal = false;
/** Whether this world's water has running water to draw: a seeded network with reaches steeper than placid, or falls. */
export function waterFlows(): boolean {
  const rivers = hydrology.rivers;
  if (flowOff || !rivers) return false;
  const key = `${worldSeed()}|${era().id}|${snowShiftM()}`;
  if (key === flowKey) return flowVal;
  let any = (hydrology.falls?.length ?? 0) > 0;
  for (const r of rivers) {
    if (any) break;
    const st = r.steepness;
    if (st) for (let i = 0; i < st.length; i++) if (st[i] > FLOW_FROM) { any = true; break; }
  }
  flowKey = key;
  flowVal = any;
  return any;
}

const FLOW_VERTEX_HEAD = (falls: boolean): string =>
  falls
    ? `// Falls: kind (0 the curtain, 1 the pool's foam, 2 spray) and its three numbers (createFallGeometries).
attribute vec4 aFall;
varying vec4 vFall;
`
    : `// Running water: steepness 0-1, speed m/s, fall weight 0-1, the bed's grain (channelStones.ts unit); a stream's unit
// coordinate and where its pitches and pools are drawn (pitchPool.ts).
attribute vec4 aFlow;
varying vec4 vFlow;
attribute vec2 aPitch;
varying vec2 vPitch;
`;
// Spray is a billboard about its centre (the vertex position), upright, turned to face the camera; aFall.yz is the
// corner (-1..1) and aRiverInfo.z its size.
const FALLS_BILLBOARD = /* glsl */ `
if (aFall.x > 1.5) {
  vec3 sC = (modelMatrix * vec4(position, 1.0)).xyz;
  vec2 sTo = cameraPosition.xz - sC.xz;
  vec2 sR = normalize(vec2(-sTo.y, sTo.x) + vec2(1e-4, 0.0));
  transformed += vec3(sR.x, 0.0, sR.y) * (aFall.y * aRiverInfo.z) + vec3(0.0, aFall.z * aRiverInfo.z * 0.75, 0.0);
  // Drawn a little toward the camera, so the card stands clear of the gorge's walls and floor behind it (the depth test
  // would cut its soft edge into a straight line there). (The falls' meshes are in world coordinates.)
  vec3 sTo3 = cameraPosition - sC;
  transformed += sTo3 * min(0.7 * aRiverInfo.z / max(length(sTo3), 1.0), 0.5);
}
`;

/** Global GLSL for the flow (after the stone lattices): the foam a stone makes on the water about it. */
const FLOW_STONE_FOAM = /* glsl */ `
// The foam about one stone st = (s, x, r, submerged) at the fragment (along fSa, across fXa; fSf the fine streak noise,
// fStreak its threshold, fSt the steepness). A rock standing out of the water: a pillow heaped white against its upstream
// face, the water peeling off its two shoulders as white lines that spread downstream (a V) and tear into streaks, a dark
// glassy eddy in its lee, and thin streaks where the water closes behind it. (No collar all round: a white ring about
// every rock read as a halo.) One just under: a glassy hump over it and a boil breaking below it, drawn out downstream.
float chFoam(vec4 st, float fSa, float fXa, float fSf, float fStreak, float fSt, float fTear, inout float fGlass) {
  vec2 d = vec2(fSa - st.x, fXa - st.y) / st.z;
  float rho = length(d);
  float ph = fract(st.x * 0.37 + st.y * 0.71) * 6.2832;
  float rag = 0.12 * sin(3.0 * atan(d.y, d.x) + ph) + 0.25 * (fSf - 0.5) + 0.35 * (fTear - 0.5);
  // (Torn at the rock's own scale: broken white, not a clean crescent.)
  float torn = smoothstep(0.25, 0.65, fTear + 0.3 * (fSf - 0.5));
  float a = d.x;
  float lat = abs(d.y);
  float foam;
  if (st.w < 0.5) {
    float face = clamp(-a / max(rho, 1e-3), 0.0, 1.0);
    float pillow = smoothstep(0.88, 1.0, rho) * (1.0 - smoothstep(1.02 + 0.3 * face, 1.12 + 0.55 * face, rho + rag)) * smoothstep(0.15, 0.7, face + 0.3 * (fSf - 0.5));
    float side = abs(lat - (0.9 + 0.32 * max(a, 0.0)));
    float peel = smoothstep(-0.35, 0.25, a) * (1.0 - smoothstep(0.12, 0.4, side + 0.25 * rag)) * exp(-max(a, 0.0) / (1.8 + 2.4 * fSt)) * (1.0 - smoothstep(4.0, 8.0, a * st.z));
    foam = max(pillow * mix(0.15, 1.0, torn), peel * mix(fStreak, 1.0, 0.3 * exp(-max(a, 0.0))) * mix(0.3, 1.0, torn));
    fGlass = max(fGlass, 0.75 * smoothstep(0.7, 1.1, a) * (1.0 - smoothstep(0.45, 0.85, lat)) * (1.0 - smoothstep(1.4, 2.8, a)));
  } else {
    fGlass = max(fGlass, 1.0 - smoothstep(0.6, 1.05, rho));
    foam = (1.0 - smoothstep(0.3, 1.0, length(vec2((a - 1.5) * 0.4, d.y * 0.9)) + rag)) * fStreak * mix(0.4, 1.0, torn);
  }
  float wid = 0.6 + 0.3 * max(a, 0.0);
  float wake = smoothstep(1.6, 2.6, a) * exp(-a / (2.5 + 3.0 * fSt)) * (1.0 - smoothstep(0.5, 1.0, lat / wid + 0.4 * rag)) * (1.0 - smoothstep(6.0, 11.0, a * st.z));
  return max(foam, wake * fStreak);
}
`;

/** The whitewater on a ribbon: reads vFlow, vPitch, vRiverInfo, vRiverT; adjusts the body, transmittance, roughness and waves. */
const flowFragment = (): string => {
  const P = PALETTES[era().palette];
  return /* glsl */ `
// Running water (water.ts 'flow').
float wSpecCut = 0.0;
float wTreeKeep = 1.0;
// A stream's unit coordinate's rate along the channel (pitchPool.ts: it varies only along, so the screen derivatives'
// ratio is exact on a ribbon triangle), for the stones' pitches. (Out here: derivatives want uniform control flow.)
float fDsx = dFdx(vRiverInfo.y);
float fDsy = dFdy(vRiverInfo.y);
float fDSig = clamp((dFdx(vPitch.x) * fDsx + dFdy(vPitch.x) * fDsy) / max(fDsx * fDsx + fDsy * fDsy, 1e-6), 0.0, 0.25);
// (How much of it a pixel spans: the pitches' edges blur no finer than that far away.)
float fAA = min(fwidth(vPitch.x), 0.1);
if (vFlow.x > ${FLOW_FROM.toFixed(2)} || vFlow.z > 0.001) {
  float fSt = vFlow.x;
  float fW = max(vRiverInfo.z, 0.5);
  float fV = clamp(vFlow.y, 0.3, 6.0);
  float fRun = smoothstep(${FLOW_FROM.toFixed(2)}, 1.0, fSt);
  // A stream cut into pitches and pools (pitchPool.ts; vPitch.y where it is): the white water gathers on each pitch and
  // the plunge below it (fPw), the pool below runs dark and smooth (fPool), and the water slides glassy into the next lip
  // (fTongue). Elsewhere (fOn 0: rivers) the white comes and goes with the reach.
  float fOn = clamp(vPitch.y, 0.0, 1.0);
  // The lip's line is no ruled line across: bowed and skewed (each unit its own way) and ragged, by about the width.
  vec4 fPh = pitchPhase(vPitch.x);
  float fXr = vRiverInfo.x / fW;
  float fSf0 = texture(tNoise, vec2(vRiverInfo.x, vRiverInfo.y) * vec2(1.0 / 5.0, 1.0 / 11.0) + 0.17).g;
  float fBow = fract(fPh.w * 37.13) * 6.2832;
  float fLipBend = fW * (0.35 * sin(1.6 * fXr + fBow) + 0.5 * (fract(fPh.w * 71.7) - 0.5) * fXr + 0.25 * (texture(tNoise, vec2(vRiverInfo.x, vRiverInfo.y) * (1.0 / 13.0) + 0.61).r - 0.5));
  fPh = pitchPhase(vPitch.x + fLipBend * fDSig);
  float fPwRaw = fOn > 0.0 ? smoothstep(-0.04 - fAA, 0.02 + fAA, fPh.x) * (1.0 - smoothstep(fPh.y + 0.02 - fAA, fPh.y + 0.13 + fAA, fPh.x)) : 0.0;
  // (The white in the current's line, which wanders from unit to unit; a big step's across most of the channel, a
  // riffle's down its middle; by the banks the rocks break it.)
  float fLine = abs(fXr - 0.5 * (fract(fPh.w * 53.9) - 0.5) * (1.0 - fPh.w));
  float fLineK = 1.0 - 0.85 * smoothstep(0.2 + 0.5 * fPh.w, 0.45 + 0.55 * fPh.w, fLine + 0.15 * (fSf0 - 0.5));
  fPwRaw *= fLineK;
  // Below the foot the white runs on as streaks drawn out downstream, dying away over a share of the pool (each unit its
  // own); over a short pool all of it, so pitches close together run into one white cascade. Each unit pours its own
  // strength: a small riffle hardly breaks, a big step pours white; and a reach (a kilometre or so) more or less broken
  // than the next. So from far away the bigger steps show, at their own irregular spacing, rather than an even row.
  float fPast = fPh.x - fPh.y;
  float fJoin = 1.0 - smoothstep(0.12, 0.4, fPh.z - fPh.y);
  float fTailL = mix(0.05, 0.22, fract(fPh.w * 91.3)) + 3.0 * fJoin;
  float fTail = fOn > 0.0 ? smoothstep(-0.02, 0.05, fPast) * exp(-max(fPast, 0.0) / fTailL) * fLineK : 0.0;
  float fReachI = smoothstep(0.3, 0.7, texture(tNoise, vWaterPos.xz * (1.0 / 1100.0) + 0.71).r);
  float fUnitI = mix(0.12, 1.0, smoothstep(0.4, 0.95, fPh.w)) * (0.5 + 0.5 * fract(fPh.w * 53.1)) * mix(0.4, 1.0, fReachI);
  // (Whiter down the pitch as the water speeds up and takes in air: most at its foot.)
  float fDown = mix(0.55, 1.0, clamp(fPh.x / max(fPh.y, 1e-3), 0.0, 1.0));
  float fPwAll = max(fPwRaw * fDown, 0.8 * fTail);
  float fPw = fPwRaw * fOn;
  float fPool = fOn * (1.0 - fPwAll);
  float fTongue = fOn * smoothstep(fPh.z - 0.12, fPh.z - 0.02, fPh.x) * (1.0 - fJoin);
  // Share of the surface running white: a few streaks on a riffle, a tenth on gentle rapids, a third on steep ones,
  // over half of a step-pool cascade; a fall's lip and foot all of it. On a stream's units: most of a steep pitch
  // (less of a riffle's), a few drifting streaks over its pool.
  // The stones' share of the bed (channelStones.ts): clumped on a river, crowded onto a stream's pitches. Where the bed
  // is strewn with them the white comes from them (below): the water between keeps only a little broken water of its
  // own, near; far away, where a stone's foam is finer than a pixel, its mean.
  // (Far away, where the lip's line is a pixel or less: the white grows down the pitch from nothing at the lip, most at
  // the foot, and dies away down the pool, so a pitch is a soft streak, not a block with a ruled edge.)
  float fPwFar = fOn > 0.0 ? smoothstep(-0.02, fPh.y + 0.04, fPh.x) * exp(-max(fPast, 0.0) / fTailL) * fLineK : 0.0;
  // (The rocks' share too, far away: their mean cover would otherwise draw each pitch as a block.)
  float fPwRock = mix(fPwRaw, fPwFar * mix(0.5, 1.0, fUnitI), smoothstep(0.5, 3.0, footprint));
  float fRockP = chPresence(fSt) * ${(1 / STONE_FILL).toFixed(3)} * mix(0.6, min(1.0, 0.78 * (0.16 + 1.6 * fPwRock)), fOn);
  float fNearR = 1.0 - smoothstep(0.7, 1.6, footprint);
  // (Where the white is comes from the steps alone - the channel-form law's step white, riverNetwork.ts, carried in the
  // steepness: no 350 m field of patches over it.)
  float fReach = min(0.55 * pow(fRun, 1.7), 0.85);
  float fPitchS = mix(0.3, 0.62, smoothstep(0.5, 0.85, fSt)) * fUnitI * 1.1;
  float fPitchC = mix(0.03, fPitchS, fPwAll);
  // (Far away each unit keeps at least half of the full strength: a run of steep pitches still reads white from
  // 1500 ft, only unevenly so.)
  float fPitchF = fPitchS * mix(0.5, 1.0, fUnitI) / max(fUnitI, 1e-3);
  float fCoverFar = max(mix(fReach, mix(0.03, min(fPitchF, 0.62 * 1.1), fPwFar), fOn) * (1.0 - 0.8 * fRockP * fNearR), vFlow.z);
  float fCover = max(mix(fReach, fPitchC, fOn) * (1.0 - 0.8 * fRockP * fNearR), vFlow.z);
  // Where the water runs white is fixed in the bed: the rocks, steps and bars that break it do not move, so every field
  // that places the white (and the streaks and wakes off the rocks) is a static pattern in the channel's coordinates.
  // Across and along the channel, m, skewed so the tiles' repeats across a wide river do not line up.
  vec2 fQ = vec2(vRiverInfo.x + 0.37 * vRiverInfo.y, vRiverInfo.y);
  // Foam patches drawn out along the flow (a tile 23 m across, 61 m along) and finer streaks (a tile 7 m by 19 m).
  vec2 fS = vec2(1.0 / 23.0, 1.0 / 61.0);
  vec4 fA = texture(tNoise, fQ * fS + vec2(0.29, 0.53));
  vec4 fC = texture(tNoise, fQ * fS * 3.2 + vec2(0.61, 0.37));
  float fN = (fA.r - 0.5) * 0.65 + (fC.g - 0.5) * 0.45;
  // A stream's pitch is a few metres long: its white water pours down it in streaks (a tile 0.9 m across, 7 m along).
  if (fOn > 0.0) {
    vec2 fQp = vec2(vRiverInfo.x, vRiverInfo.y) * vec2(1.0 / 0.9, 1.0 / 7.0);
    float fPf = texture(tNoise, fQp + vec2(0.37, 0.61)).g;
    // (Broken up by clots of foam 2.5 m by 4.5 m, so the streaks are not combed even.)
    vec2 fQc = vec2(vRiverInfo.x, vRiverInfo.y) * vec2(1.0 / 2.5, 1.0 / 4.5);
    float fPc = texture(tNoise, fQc + vec2(0.53, 0.79)).a;
    fPf = 0.5 + 0.6 * (fPf - 0.5) + 0.65 * (fPc - 0.5);
    fN = mix(fN, 0.6 * (fPf - 0.5) + 0.5 * fN, fOn);
  }
  // Only near does the white move: a fine field (a tile 0.8 m across, 2.5 m along) rides the current at the water's
  // speed, tearing and flecking the white's edges, flickering on the crests and rippling the fast water between, gone
  // by a footprint of a quarter metre (a few hundred metres off from low level) so that from higher nothing slides.
  // Two phases 2 s long, each restarting (at a new offset) while the other carries it, so a change of speed along the
  // reach never shears it.
  float fNearM = 1.0 - smoothstep(0.06, 0.25, footprint);
  vec2 fQm = vec2(vRiverInfo.x / 0.8, vRiverInfo.y / 2.5);
  vec2 fQmX = dFdx(fQm);
  vec2 fQmY = dFdy(fQm);
  vec4 fM = vec4(0.5);
  if (fNearM > 0.0) {
    float fPh0 = fract(uTime * 0.5);
    float fPh1 = fract(uTime * 0.5 + 0.5);
    float fB = abs(2.0 * fPh0 - 1.0);
    vec2 fO0 = fract(floor(uTime * 0.5) * vec2(0.37, 0.61));
    vec2 fO1 = fract(floor(uTime * 0.5 + 0.5) * vec2(0.53, 0.29)) + 0.5;
    fM = mix(textureGrad(tNoise, fQm - vec2(0.0, fV * fPh0 * 0.8) + fO0, fQmX, fQmY), textureGrad(tNoise, fQm - vec2(0.0, fV * fPh1 * 0.8) + fO1, fQmX, fQmY), fB);
    // (Cross-fading two fields halves their variance midway: scale it back.)
    fM = 0.5 + (fM - 0.5) * inversesqrt(fB * fB + (1.0 - fB) * (1.0 - fB));
  }
  fN += fNearM * 0.35 * (fM.r - 0.5);
  // Standing waves on rapids: crests fixed in place across the current, their spacing the wavelength whose speed is
  // the water's (2 pi v^2 / g), bent by a fixed noise; white flickering on them as the foam passes. (None in a pool.)
  float fLam = clamp(0.64 * fV * fV, 1.5, 9.0);
  float fBend = texture(tNoise, fQ * vec2(1.0 / 17.0, 1.0 / 53.0) + 0.21).b;
  float fCrest = pow(0.5 + 0.5 * cos(6.2832 * vRiverInfo.y / fLam + fBend * 9.0), 6.0) * smoothstep(0.35, 0.6, fBend);
  float fRapids = smoothstep(0.42, 0.6, fSt) * (1.0 - 0.6 * smoothstep(0.8, 1.0, fSt)) * (1.0 - fPool);
  float fMid = 1.0 - smoothstep(0.3, 1.0, abs(vRiverInfo.x) / fW);
  // (fN is near normal with a deviation of about 0.1: this threshold leaves about fCover of it above.)
  float fThr = 0.34 * (0.5 - fCover);
  float fWhite = smoothstep(fThr - 0.04, fThr + 0.04, fN + 0.12 * fCrest * fRapids * fMid * mix(1.0, 0.3 + 1.4 * fM.g, fNearM));
  // (None at all where the reach turns placid, so the edge of this code never shows; all of it at a full fall weight.)
  fWhite *= max(smoothstep(0.0, 0.2, fRun), max(vFlow.z, fPw));
  fWhite = max(fWhite, step(0.999, fCover));
  // (A pitch's fine tearing is lost in a pixel sooner: its mean cover from a footprint of a metre, torn white over
  // dark water, so greyer than its thickest foam.)
  fWhite = mix(fWhite, 0.8 * fCoverFar, fOn * smoothstep(0.2, 1.0, footprint));
  // The stones (channelStones.ts; vegetation/boulders.ts draws their rocks): chFoam about each, the fine lattice's
  // and the very large blocks'.
  float fRock = 0.0;
  float fGlass = 0.0;
  float fSf = 0.5;
  float fStreakAll = 0.5;
  if (chPresence(fSt) > 0.0 && fNearR > 0.0) {
    float fGrain = ${GRAIN_TOP.toFixed(1)} * vFlow.w * vFlow.w;
    float fSa = vRiverInfo.y;
    float fXa = vRiverInfo.x;
    int fK0 = int(floor(fSa / CH_ALONG));
    int fJ0 = int(floor(fXa / CH_ACROSS + 0.5));
    // Foam streaks of the wakes: a finer field than the one above (tiles 2.7 m across, 9 m along; on a stream's units
    // 1.2 m across: thin streaks off its rocks), fixed behind them.
    vec2 fQf = vec2(fXa / mix(2.7, 1.2, fOn), fSa / 9.0);
    fSf = texture(tNoise, fQf + vec2(0.71, 0.13)).r;
    fStreakAll = 0.5 + (fSf - 0.5) + 0.5 * fN;
    float fStreak = smoothstep(0.42, 0.58, fStreakAll);
    // (And a finer field still, the rocks' own scale: 0.45 m across, 1.6 m along; near, torn by the moving field.)
    vec2 fQr = vec2(fXa / 0.45, fSa / 1.6);
    float fTear = mix(texture(tNoise, fQr + vec2(0.17, 0.89)).b, fM.a, fNearM);
    for (int dk = -3; dk <= 1; dk++) {
      for (int dj = -1; dj <= 1; dj++) {
        vec4 st = chStone(fK0 + dk, fJ0 + dj, fSt, fGrain, fW, fOn, vPitch.x, fSa, fDSig);
        if (st.z > 0.0) fRock = max(fRock, chFoam(st, fSa, fXa, fSf, fStreak, fSt, fTear, fGlass));
      }
    }
    int fBk0 = int(floor(fSa / CH_BIG_ALONG));
    int fBj0 = int(floor(fXa / CH_BIG_ACROSS + 0.5));
    for (int dk = -2; dk <= 0; dk++) {
      for (int dj = -1; dj <= 1; dj++) {
        vec4 st = chBig(fBk0 + dk, fBj0 + dj, fSt, fGrain, fW, fOn, vPitch.x, fSa, fDSig);
        if (st.z > 0.0) fRock = max(fRock, chFoam(st, fSa, fXa, fSf, fStreak, fSt, fTear, fGlass));
      }
    }
  }
  // Steps on a river's step-pool reach (channelStones.ts chStep): a line of stones across it that the water pours over -
  // a dark glassy tongue just above it, a band of broken white water just below, torn along its length. (A stream's
  // units are its steps.)
  if (fRockP > 0.0 && fNearR > 0.0 && fOn < 1.0) {
    int fK1 = int(floor(vRiverInfo.y / CH_ALONG));
    for (int dk = -1; dk <= 0; dk++) {
      float sStep = chStep(fK1 + dk, fSt);
      if (sStep < 0.0) continue;
      float a = vRiverInfo.y - sStep + 0.6 * (fSf - 0.5) + 0.8 * sin(vRiverInfo.x * 0.9 + sStep);
      float band = smoothstep(-0.2, 0.3, a) * (1.0 - smoothstep(1.2, 3.2, a + 1.2 * (fSf - 0.5)));
      float torn = smoothstep(0.3, 0.55, fStreakAll);
      fRock = max(fRock, (1.0 - fOn) * band * mix(0.55, 1.0, torn) * smoothstep(0.95, 0.75, abs(vRiverInfo.x) / fW));
      fGlass = max(fGlass, (1.0 - fOn) * (1.0 - smoothstep(-1.6, -0.2, a)) * smoothstep(-2.6, -1.6, a) * 0.7);
    }
  }
  // A stream's pitch: the lip's line torn white across the channel just below it, the tongue above it glassy.
  fGlass = max(fGlass, 0.8 * fTongue);
  // Far: the stones' mean cover (about six of a stone's square radii of foam per cell).
  // (On a stream's units the rocks crowd the pitches, the rock itself grey between their foam: a little less white.)
  // (A stream's: as strong as the unit's pouring, so the far row of pitches is as uneven as the white.)
  float fRockMean = (fRockP * min(0.55, 6.0 * pow(0.45 * ${GRAIN_TOP.toFixed(1)} * vFlow.w * vFlow.w, 2.0) / ${(STONE_ALONG * STONE_ACROSS).toFixed(1)}) + 0.12 * fRockP) * (1.0 - 0.45 * fOn) * mix(1.0, 0.3 + 0.7 * fUnitI, fOn);
  fRock = mix(fRockMean, fRock, fNearR);
  fWhite = max(fWhite * (1.0 - fGlass), fRock);
  // Far away: the mean cover (the pattern is finer than a pixel; a stream's pitches and pools are not).
  // (A stream's pitch far away: torn white over dark water and grey rock, patchy from one to the next.)
  fWhite = mix(fWhite, max(min(1.0, fCoverFar * (1.0 - 0.05 * fOn) + 0.15 * fRapids) * (1.0 - 0.6 * fRockP), fRockMean), smoothstep(0.8, 5.0, footprint));
  // Between the white: a small stream over its stony bed is shallow and clear; a bigger river aerated, paler, cloudier;
  // a stream's pool deeper, darker and still.
  float fClear = (1.0 - smoothstep(2.0, 9.0, fW)) * smoothstep(0.3, 0.65, fSt) * (1.0 - 0.3 * fPool);
  vec3 fTrans = exp(-2.0 * depth * mix(1.0, 0.3, fClear) * mix(atten, ${P.seaAtten}, fClear));
  wTrans = dot(fTrans, vec3(0.25, 0.5, 0.25)) * (1.0 - 0.45 * fRun * (1.0 - fClear) * (1.0 - 0.7 * fPool));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.07, 0.09, 0.075), 0.5 * fRun * (1.0 - fClear) * (1.0 - fPool));
  // Between the stones the water runs fast, dark and smooth; a pool is dark with its depth.
  diffuseColor.rgb *= (1.0 - 0.5 * fRockP) * (1.0 - 0.12 * fPool);
  wTrans *= 1.0 - 0.3 * fRockP * (1.0 - fClear);
  // Bare rock banks (bedrock.ts): their trees thinned out (vegetation/placement.ts), so fewer in the mirror.
  // (The gallery thinned, and the woods set back behind the rock: lower in the mirror, so half as much again.)
  wTreeKeep = (1.0 - ${GALLERY_ROCK_THIN.toFixed(2)} * bedRock(fSt)) * (1.0 - 0.5 * bedRock(fSt));
  // Beyond the boulders' drawn range (BoulderSystem: a few hundred metres) the rocks crowding a pitch show as grey.
  float fRockTone = min(0.5, 1.6 * fRockMean) * smoothstep(350.0, 650.0, wDist);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.34, 0.33, 0.31), fRockTone);
  fWhite *= 1.0 - 0.6 * fRockTone;
  wTrans *= 1.0 - fRockTone;
  // Thick foam brightest, thin foam and spume over dark water greyer.
  float fThick = smoothstep(fThr, fThr + 0.15, fN);
  diffuseColor.rgb = mix(diffuseColor.rgb, mix(vec3(0.3, 0.33, 0.33), vec3(0.66, 0.69, 0.69), fThick), fWhite);
  wTrans *= 1.0 - 0.9 * fWhite;
  // Choppy, tumbling water: ripples riding the flow (steeper with the steepness, resolved only near), a rougher
  // surface, and no mirror where it is white; a pool's surface smooth, mirroring the banks and the sky.
  vec2 fT = normalize(vRiverT);
  vec2 fRgt = vec2(-fT.y, fT.x);
  vec2 fRip = mix(vec2(fA.g, fC.b), fM.ba, fNearM) - 0.5;
  vec2 fSl = (fRip.x * fT + fRip.y * fRgt) * (1.6 * fRun * (1.0 - 0.75 * fPool)) / (1.0 + footprint);
  wNormal = normalize(wNormal + vec3(-fSl.x, 0.0, -fSl.y));
  wRough = mix(mix(mix(mix(wRough, 0.3, fRun), 0.1, fPool), 0.12, fGlass * (1.0 - fWhite)), 0.75, fWhite);
  // (Fast broken water between the stones mirrors less of the sky.)
  wSpecCut = max(0.85 * fWhite, 0.45 * fRockP * (1.0 - fPool));
}
`;
};

/** The falls' own shading (FALLS): the curtain, the pool's foam, the spray. */
const fallsFragment = (): string => /* glsl */ `
// Falls (water.ts 'flow').
float wSpecCut = 1.0;
float fMist = 0.0;
{
  vec3 fToCam = normalize(cameraPosition - vWaterPos);
  vec3 fFace = normalize(cross(dFdx(vWaterPos), dFdy(vWaterPos)));
  fFace *= dot(fFace, fToCam) < 0.0 ? -1.0 : 1.0;
  float fW = max(vRiverInfo.z, 0.5);
  vec3 fWhiteC = vec3(0.82, 0.84, 0.84);
  if (vFall.x < 0.5) {
    // The curtain: vRiverInfo.x across (m), vFall.y metres fallen from the lip, vFall.z the water's speed at the lip,
    // vFall.w the fall's height. A parcel there went over the lip tY ago: its strands are sampled at that moment, so
    // they fall and stretch out as the water speeds up, and never shear.
    float fY = max(vFall.y, 0.0);
    float fV0 = max(vFall.z, 0.5);
    float fDrop = max(vFall.w, 1.0);
    float fU = clamp(fY / fDrop, 0.0, 1.0);
    float fTau = uTime - (sqrt(fV0 * fV0 + 19.62 * fY) - fV0) / 9.81;
    vec4 fA = texture(tNoise, vec2(vRiverInfo.x / 5.0 + vRiverInfo.y, fTau * 0.55));
    vec4 fB = texture(tNoise, vec2(vRiverInfo.x / 1.6 + vRiverInfo.y * 1.7, fTau * 1.7));
    // Strands: the water gathers in columns (fixed across the lip, a little wandering as it falls), thicker and whiter
    // where it gathers, a thin glassy veil between; on a tall fall the veil tears into separate threads and the
    // threads into spray as they fall.
    float fStrand = texture(tNoise, vec2(vRiverInfo.x / 6.0 + 0.04 * fY / max(1.0, vRiverInfo.z), vRiverInfo.y * 0.37)).g
                  + 0.5 * (texture(tNoise, vec2(vRiverInfo.x / 2.2, vRiverInfo.y * 0.61 + 0.3)).b - 0.5);
    // Glassy over the lip, breaking up white within a couple of metres.
    float fBreak = smoothstep(0.0, 2.0, fY);
    float fN = 0.55 * fA.r + 0.35 * fB.g + 0.7 * (fStrand - 0.5);
    float fWhite = smoothstep(0.5 - 0.22 * fBreak, 0.6 - 0.18 * fBreak, fN) * mix(0.55, 1.0, fBreak);
    float fTall = smoothstep(12.0, 50.0, fDrop);
    // Gaps between the threads: none at the lip, opening down the fall (more on a tall one).
    float fGap = smoothstep(0.42 + 0.12 * fU, 0.3 + 0.1 * fU, fStrand + 0.18 * (fA.g - 0.5)) * smoothstep(0.05, 0.5, fU) * mix(0.55, 1.0, fTall);
    // Lower down a tall fall is more spray than water: fainter, softer.
    float fVeil = fTall * smoothstep(0.55, 1.0, fU);
    fWhite = mix(fWhite, 0.8, smoothstep(0.6, 3.0, footprint));
    diffuseColor.rgb = mix(vec3(0.13, 0.17, 0.15), fWhiteC, fWhite);
    wTrans = mix(0.75 - 0.4 * fBreak, 0.05, fWhite);
    wTrans = mix(wTrans, 1.0, max(fGap * (1.0 - 0.5 * smoothstep(0.6, 3.0, footprint)), 0.55 * fVeil * (1.0 - fB.r)));
    wNormal = normalize(fFace + vec3(0.0, 0.7, 0.0));
    wRough = mix(0.25, 0.8, fWhite);
    wSpecCut = mix(0.3, 1.0, max(fWhite, fGap));
  } else if (vFall.x < 1.5) {
    // Foam on the plunge pool, drifting off downstream: vRiverInfo.x across, vRiverInfo.y along from the foot (m);
    // vDepth runs 1 at the centre to 0 at the rim.
    float fR = clamp(vDepth, 0.0, 1.0);
    float fPh0 = fract(uTime * 0.4);
    float fPh1 = fract(uTime * 0.4 + 0.5);
    float fBl = abs(2.0 * fPh0 - 1.0);
    vec2 fQ = vec2(vRiverInfo.x, vRiverInfo.y) / 6.0;
    float fN = mix(texture(tNoise, fQ - vec2(0.0, fPh0 * 0.8) + fract(floor(uTime * 0.4) * vec2(0.37, 0.61))).r,
                   texture(tNoise, fQ - vec2(0.0, fPh1 * 0.8) + fract(floor(uTime * 0.4 + 0.5) * vec2(0.53, 0.29)) + 0.5).r, fBl);
    // (A ragged rim: the foam's edge torn by the same drifting noise, near and far.)
    float fRim = smoothstep(0.0, 0.35, fR + 0.5 * (fN - 0.5));
    float fWhite = smoothstep(0.62, 0.48, fN - 0.45 * fR + 0.35) * fRim;
    fWhite = mix(fWhite, 0.85 * smoothstep(0.0, 0.6, fR + 0.6 * (fN - 0.5)), smoothstep(0.6, 3.0, footprint));
    diffuseColor.rgb = fWhiteC;
    wTrans = 1.0 - fWhite;
    wNormal = vec3(0.0, 1.0, 0.0);
    wRough = 0.8;
  } else {
    // Spray: soft billows of mist, rising and drifting, densest low over the pool and tearing into wisps at their
    // edges; fainter close to (flying through it shows no card) and denser over a taller fall (vRiverInfo.x its drop).
    // vFall.w: 0 the dense cloud at the foot, 1 the thin veil drifting higher off a tall fall.
    vec2 fC = vFall.yz;
    vec2 fE = vec2(fC.x, fC.y * 1.25 + 0.15);
    float fR2 = dot(fE, fE);
    float fN = texture(tNoise, fC * 0.7 + vec2(vRiverInfo.y, -uTime * 0.05)).r + 0.5 * texture(tNoise, fC * 1.9 + vec2(vRiverInfo.y * 1.3, -uTime * 0.11)).g;
    float fBody = (1.0 - 1.7 * fR2) + 1.1 * (fN - 0.75) - 0.25 * max(fC.y, 0.0);
    // (Never reaching the card's edge.)
    float fCard = 1.0 - smoothstep(0.7, 0.98, length(fC));
    float fD = smoothstep(0.0, 0.9, fBody) * fCard * mix(0.08, 0.2, smoothstep(3.0, 12.0, vRiverInfo.x)) * (1.0 - 0.6 * vFall.w);
    fD *= smoothstep(6.0, 40.0, wDist);
    diffuseColor.rgb = vec3(0.92);
    wTrans = 1.0 - fD;
    wNormal = normalize(fToCam + vec3(0.0, 1.0, 0.0));
    wRough = 1.0;
    fMist = 1.0;
  }
}
`;

/** A seeded world's ribbon is lifted over the coarse terrain from 300 m away, 3 mm a metre (to 15 m): a thread narrower than a coarse tile's triangles, its bars a metre over its water, stays one thread
 * instead of breaking into pools where a triangle's corners stand on the bars. */
const FLOW_LIFT = `{
  vec3 lw = (modelMatrix * vec4(position, 1.0)).xyz;
  transformed.y += clamp((distance(lw, cameraPosition) - 300.0) * 0.003, 0.0, 15.0);
}
`;
/** A seeded world's ribbon spans its bed (ribbonRows: vDepth -1 at the bed's edge, 0 at the water's): from
 * BAR_NEAR m away it draws the gravel bars beyond its water itself, all of them from BAR_FAR - the terrain's own
 * paint of them (terrainMaterial.ts, faded out over the same distances) comes in triangles coarser than the bars,
 * a saw-tooth outline; the ribbon's rows follow the line sample by sample. Lit as the terrain is (the irradiance the
 * water's own body colour received), its edge soft over the outer tenth of the bar. */
const FLOW_BARS = `{
  float bK = (1.0 - smoothstep(-0.12, -0.02, vDepth)) * (1.0 - smoothstep(0.85, 1.0, -vDepth)) * smoothstep(${BAR_NEAR.toFixed(1)}, ${BAR_FAR.toFixed(1)}, wDist);
  if (bK > 0.0) {
    vec4 bN = texture(tNoise, vWaterPos.xz * (1.0 / 37.0) + 0.23);
    vec3 bAlb = vec3(0.2, 0.196, 0.18) * (0.82 + 0.36 * bN.g) * (1.0 - 0.25 * smoothstep(-0.2, -0.05, vDepth));
    vec3 bIrr = (reflectedLight.directDiffuse + reflectedLight.indirectDiffuse) / max(diffuseColor.rgb * RECIPROCAL_PI, vec3(1e-5));
    gl_FragColor = gl_FragColor * (1.0 - bK) + vec4(bAlb * bIrr * RECIPROCAL_PI, 1.0) * bK;
  }
}
`;
/** ... and its water's optical density a multiple of the palette's river (channelForm.ts: its thread is decimetres deep). */
const FLOW_TURBID = 2.5;
/** Splice the running water into a river (or falls) material's shader; `ice`: the ice code follows. */
function withFlow(shader: { vertexShader: string; fragmentShader: string }, falls: boolean, ice: boolean): void {
  shader.vertexShader = shader.vertexShader
    .replace('attribute float aDepth;\n', `attribute float aDepth;\n${FLOW_VERTEX_HEAD(falls)}`)
    .replace('vec3 transformed = position;\n', `vec3 transformed = position;\n${falls ? `vFall = aFall;\n${FALLS_BILLBOARD}` : `vFlow = aFlow * vec4(1.0, ${FLOW_SPEED_MAX.toFixed(1)}, 1.0, 1.0);\nvPitch = aPitch;\n${FLOW_LIFT}`}`);
  // (A seeded world's water is as turbid as its glacial and silt-laden rivers: opaque within a few decimetres, its
  // thread reading as water over the gravel it runs among, not as more of the bed.)
  if (!falls) shader.fragmentShader = shader.fragmentShader.replace(/vec3 atten = (vec3\([^)]*\));\n/, `vec3 atten = ${FLOW_TURBID.toFixed(1)} * $1;\n`).replace('gl_FragColor = vec4(wColor * wEdge, (1.0 - wSeen) * wEdge);\n', `gl_FragColor = vec4(wColor * wEdge, (1.0 - wSeen) * wEdge);\n${FLOW_BARS}`);
  shader.fragmentShader = shader.fragmentShader
    .replace('varying float vDepth;\n', `varying float vDepth;\n${falls ? 'varying vec4 vFall;\n' : 'varying vec4 vFlow;\nvarying vec2 vPitch;\n'}`)
    // (After the hashes: the stone lattice uses hash2u.)
    .replace('// Wave height field, m:', `${falls ? '' : `${channelStonesGlsl()}${FLOW_STONE_FOAM}${BEDROCK_GLSL}`}// Wave height field, m:`)
    // Before the shore foam's last line (the ice goes after it).
    .replace('wTrans *= 1.0 - foam;\n', `${falls ? fallsFragment() : flowFragment()}wTrans *= 1.0 - foam;\n`)
    // White water is no mirror.
    .replace('vec3 wDirect = reflectedLight.directSpecular;\n', 'vec3 wDirect = reflectedLight.directSpecular * (1.0 - wSpecCut);\nfresnel *= 1.0 - wSpecCut;\n');
  // The bank's trees in the mirror thin out as placement.ts thins them along bare rock.
  if (!falls) shader.fragmentShader = shader.fragmentShader.replace('  float bank = max(herb, tree);\n', '  tree *= wTreeKeep;\n  float bank = max(herb, tree);\n');
  // Frozen spray is no snowdrift: it goes with the ice.
  if (falls && ice) shader.fragmentShader = shader.fragmentShader.replace('float wEdge = smoothstep(-0.05, 0.25, vDepth);\n', 'float wEdge = smoothstep(-0.05, 0.25, vDepth) * (1.0 - fMist * wIce);\n');
}

/** three's physical lighting functions with the direct specular swapped for BRDF_Water. */
const GGX_CALL = 'vec3 specularBRDF = BRDF_GGX( directLight.direction, geometryViewDir, geometryNormal, material );';
const WATER_LIGHTS_PARS = (() => {
  const src = THREE.ShaderChunk.lights_physical_pars_fragment;
  if (!src.includes(GGX_CALL)) {
    console.warn('[terrain] water: lights_physical_pars_fragment changed; the sun glint keeps the GGX lobe');
    return src;
  }
  return src.replace(GGX_CALL, 'vec3 specularBRDF = BRDF_Water( directLight.direction, geometryViewDir, geometryNormal, material.roughness );');
})();

/**
 * The water material: standing water (`river` false), the river ribbons, or (`falls`, a river variant) the falls'
 * sheets, plunge-pool foam and spray (createFallGeometries). `mist` is the falls variant drawn without depth writes.
 */
export function createWaterMaterial(noise: THREE.Texture, uniforms: WaterUniforms, river: boolean, falls: 'sheet' | 'mist' | null = null): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.06, metalness: 0, transparent: true, depthWrite: falls !== 'mist' });
  // Premultiplied blending: the shader writes reflection + body light, and alpha = 1 - transmittance.
  mat.blending = THREE.CustomBlending;
  mat.blendEquation = THREE.AddEquation;
  mat.blendSrc = THREE.OneFactor;
  mat.blendDst = THREE.OneMinusSrcAlphaFactor;
  mat.blendSrcAlpha = THREE.OneFactor;
  mat.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
  mat.name = falls ? `falls-${falls}` : river ? 'river' : 'water';
  // Single-sided: water is only ever seen from above, and a transparent double-sided material makes three
  // draw it in two passes, flipping its side (and re-resolving its program) twice every frame. The river
  // ribbon's triangles (createRiverGeometry) face up.
  if (river) mat.defines = falls ? { RIVER: '', FALLS: '' } : { RIVER: '' };
  if (falls) {
    // A curtain of water is seen from either side; one pass (its normal is turned to the camera in the shader).
    mat.side = THREE.DoubleSide;
    mat.forceSinglePass = true;
  }
  Object.assign(uniforms, { tNoise: { value: noise } });
  // Built now, in the era this thread was set in (never at module load).
  const main = fragmentMain();
  const ice = waterFreezes();
  // Running water (whitewater, falls) only on a seeded world's network that has any (waterFlows()): seed 0's water
  // and river text is unchanged.
  const flow = river && waterFlows();
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERTEX_HEAD}`)
      .replace('#include <begin_vertex>', VERTEX_BEGIN);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAGMENT_HEAD}`)
      .replace('#include <map_fragment>', main)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = wRough;')
      .replace('#include <lights_physical_pars_fragment>', WATER_LIGHTS_PARS)
      .replace('#include <normal_fragment_maps>', 'normal = normalize((viewMatrix * vec4(wNormal, 0.0)).xyz);')
      .replace('#include <opaque_fragment>', FRAGMENT_OUTPUT);
    // Before the ice: its splices keep the anchors the flow code needs, and its mix toward snow then overrides it.
    if (flow) withFlow(shader, falls !== null, ice);
    if (ice) withIce(shader, river);
  };
  // The ice code bakes the snow line's base into the text: it is part of the key.
  const key = `${river ? 'river-v4' : 'water-v4'}${isPresent() ? '' : `-${era().id}`}${ice ? `-ice${snowLineBase()}` : ''}${flow ? (falls ? '-falls2' : '-flow2') : ''}`;
  mat.customProgramCacheKey = () => key;
  return mat;
}

/**
 * Geometry for one node's standing water. In a world whose water can freeze (waterFreezes()), `shape` (the
 * node's TileData.shape) gives each water vertex the terrain's curvature there for the ice test.
 */
export function createWaterGeometry(w: WaterData, shape?: Uint8Array): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(w.positions, 3));
  g.setAttribute('aDepth', new THREE.BufferAttribute(w.depth, 1));
  if (shape && waterFreezes()) {
    // The water lattice is the node's lattice (its first vertices); shape holds 4 bytes per vertex, curvature first.
    const count = w.depth.length;
    const curv = new Uint8Array(count);
    for (let v = 0; v < count; v++) curv[v] = shape[v * 4];
    g.setAttribute('aIceShape', new THREE.BufferAttribute(curv, 1, true));
  }
  g.setIndex(new THREE.BufferAttribute(w.index, 1));
  return g;
}

/**
 * The river ribbon in world coordinates: five vertices across (dry bank, half-width, centre, half-width,
 * dry bank) at every centreline sample, at the local water level. It stops at the coast.
 */
export function createRiverGeometry(): THREE.BufferGeometry {
  const b = riverBuffers();
  // A seeded world draws its main river with the rest of its network (createRiverNetworkGeometries).
  if (!hydrology.rivers) ribbonRows(hydrology.river, 0, hydrology.river.north.length, b);
  return riverGeometryOf(b);
}

/** The ribbon's vertex data under construction. */
interface RiverBuffers {
  pos: number[];
  depth: number[];
  info: number[];
  tan: number[];
  idx: number[];
  /** Running water (aFlow, four per vertex): only on a world where waterFlows(). */
  flow: number[];
  /** A stream's pitches and pools (aPitch: its unit coordinate and pitchOn, two per vertex), with the flow. */
  pitch: number[];
}
const riverBuffers = (): RiverBuffers => ({ pos: [], depth: [], info: [], tan: [], idx: [], flow: [], pitch: [] });

/** A line as the ribbon reads it (a seeded network's lines also carry their kind and flow). */
type RibbonLine = { north: Float64Array; east: Float64Array; level: Float64Array; halfWidth: Float64Array; s: Float64Array; depth?: Float32Array; wetR?: Float32Array; wetL?: Float32Array; bedR?: Float32Array; bedL?: Float32Array; kind?: number; regime?: Uint8Array; steepness?: Float32Array; speed?: Float32Array; sigma?: Float32Array; pitchOn?: Float32Array };

/** Whether sample i of a line is a fall's lip whose face (to sample i + 1) is steep enough to draw as a curtain. */
function curtainAt(r: RibbonLine, i: number): boolean {
  if (r.regime?.[i] !== REGIME.fall || i + 1 >= r.level.length) return false;
  const drop = r.level[i] - r.level[i + 1];
  const run = Math.hypot(r.north[i + 1] - r.north[i], r.east[i + 1] - r.east[i]);
  return drop >= 1 && run < 1.5 * drop;
}
const RIBBON_ACROSS = [-1.2, -0.55, 0, 0.55, 1.2];
/** A seeded world's ribbon across its bed (ribbonRows: -3 and 3 the right and left bed edges, -2 and 2 the water's). */
const BED_ACROSS = [-3, -2, -1, 0, 1, 2, 3];
/** A running line's ribbon drops a row its neighbours' rows draw within these: its water within ROW_LEVEL m of the
 * level between them, its centre within ROW_SIDE of its half-width (at least ROW_SIDE_MIN m) of the line between
 * them, its width within ROW_SIDE of theirs; rows at most ROW_RUN m apart. Its fall lips, the row below each and
 * where its pitches start or end are kept. (A steep stream's course is sampled every few metres to follow the ground:
 * thousands of km of ribbon rows.) */
const ROW_LEVEL = 0.25;
const ROW_SIDE = 0.2;
const ROW_SIDE_MIN = 0.3;
const ROW_RUN = 60;

/** The rows of samples [from, to) a running line's ribbon draws (every one for seed 0's river). */
function ribbonKeep(r: RibbonLine, from: number, to: number, flowing: boolean): number[] {
  const out: number[] = [];
  if (!flowing) {
    for (let i = from; i < to; i++) out.push(i);
    return out;
  }
  const must = (k: number): boolean => r.regime![k] === REGIME.fall || (k > 0 && r.regime![k - 1] === REGIME.fall) || (!!r.pitchOn && k > 0 && (r.pitchOn[k] > 0) !== (r.pitchOn[k - 1] > 0));
  let i = from;
  out.push(i);
  while (i < to - 1) {
    let j = i + 1;
    // The furthest row j whose rows between lie close to the line from i to j.
    for (let c = i + 2; c < to && r.s[c] - r.s[i] <= ROW_RUN; c++) {
      if (must(c - 1)) break;
      let ok = true;
      const dn = r.north[c] - r.north[i];
      const de = r.east[c] - r.east[i];
      const L = Math.hypot(dn, de) || 1e-9;
      for (let k = i + 1; k < c && ok; k++) {
        const t = (r.s[k] - r.s[i]) / Math.max(1e-9, r.s[c] - r.s[i]);
        const wk = ribbonHalf(r, k);
        if (Math.abs(r.level[k] - (r.level[i] + (r.level[c] - r.level[i]) * t)) > ROW_LEVEL) ok = false;
        else if (Math.abs(((r.north[k] - r.north[i]) * de - (r.east[k] - r.east[i]) * dn) / L) > Math.max(ROW_SIDE_MIN, ROW_SIDE * wk)) ok = false;
        else if (Math.abs(wk - (ribbonHalf(r, i) + (ribbonHalf(r, c) - ribbonHalf(r, i)) * t)) > Math.max(ROW_SIDE_MIN, ROW_SIDE * wk)) ok = false;
      }
      if (!ok) break;
      j = c;
    }
    out.push(j);
    i = j;
  }
  return out;
}

/** A line's water half-width at sample i as the ribbon draws it: a seeded world's between its water's edges
 * (channelForm.ts: they vary along it and either side), else its half-width. */
const ribbonHalf = (r: RibbonLine, i: number): number => (r.wetR && r.wetL ? 0.5 * (r.wetR[i] + r.wetL[i]) : r.halfWidth[i]);

/** Append the ribbon of samples [from, to) of a river line (it stops at the coast); returns the index after the last row. */
function ribbonRows(r: RibbonLine, from: number, to: number, b: RiverBuffers, flow = false): number {
  const count = r.north.length;
  // (A seeded world's line spans its whole bed, channelForm.ts: its bed's edges, its water's edges, the middle of each
  // side's water and the line - the bars beyond the water drawn far away, where the terrain's triangles are coarser
  // than they are: FLOW_BARS.)
  const bed = !!(r.bedR && r.bedL && r.wetR && r.wetL);
  const across = bed ? BED_ACROSS : RIBBON_ACROSS;
  const { pos, depth, info, tan, idx } = b;
  // Running water: the flow per row, and no ribbon down a fall's face (createFallGeometries draws its curtain).
  const flowing = flow && !!r.steepness && !!r.speed && !!r.regime;
  const curtain: boolean[] = [];
  // A stream's rows in a lake's water (an outlet leaving it, a stream running into it): the lake's own surface is drawn
  // there, so no ribbon (its shallower, paler water would show as a streak across the lake).
  const mask = flowing && r.kind === 1 ? hydrology.lakeMask : undefined;
  const inLake: boolean[] = [];
  const first = pos.length / 3;
  let rows = 0;
  const keep = ribbonKeep(r, from, to, flowing);
  let i = from;
  let atCoast = false;
  for (let ki = 0; ki < keep.length; ki++) {
    i = keep[ki];
    if (r.level[i] < 0.3) {
      atCoast = true;
      break;
    }
    const i0 = Math.max(0, i - 1);
    const i1 = Math.min(count - 1, i + 1);
    const tn = r.north[i1] - r.north[i0];
    const te = r.east[i1] - r.east[i0];
    const tl = Math.hypot(tn, te) || 1;
    // Unit perpendicular to the direction of flow (east, north components).
    const pe = -tn / tl;
    const pn = te / tl;
    // (A seeded world's line: between its water's edges, about their middle - channelForm.ts.)
    const w = ribbonHalf(r, i);
    const mid = r.wetR && r.wetL ? 0.5 * (r.wetR[i] - r.wetL[i]) : 0;
    // (A seeded world's line: its thread's own depth, channelForm.ts - a pool at a bend, a riffle at a crossing.)
    const centreDepth = r.depth ? r.depth[i] : 2.2 + w * 0.05;
    let fall = 0;
    if (flowing) {
      const lip = r.regime![i] === REGIME.fall;
      // Whiter over a lip and below a fall's foot (the row after its lip; its pool's foam is createFallGeometries').
      fall = lip ? 0.3 : i > 0 && r.regime![i - 1] === REGIME.fall ? 0.6 : 0;
      curtain.push(curtainAt(r, i));
      if (mask) {
        const lake = mask.at(r.north[i], r.east[i]);
        inLake.push(lake > -Infinity && r.level[i] <= lake + 0.3);
      }
    }
    for (const a of across) {
      let off = a * w;
      let d = Math.abs(a) > 1 ? -0.8 : centreDepth * (1 - a * a);
      if (bed) {
        // (Across from the right bed edge (a -3) to the left (3), as the plain ribbon's offsets run; the water between
        // -2 and 2, about the line: its depth from the thread's, the bars' -1 at the bed's edge, 0 at the water's.)
        const right = a < 0;
        const wet = right ? r.wetR![i] : r.wetL![i];
        const edge = Math.max(wet + 0.3, right ? r.bedR![i] : r.bedL![i]);
        const u = Math.abs(a);
        const x = u <= 2 ? 0.5 * u * wet : wet + (u - 2) * (edge - wet);
        off = (right ? -1 : 1) * x;
        d = u <= 2 ? centreDepth * (1 - 0.25 * u * u) : -(u - 2);
      }
      // (The across offset points to the left bank: the water's middle lies `mid` right of the line.)
      const sh = bed ? 0 : mid;
      const e = r.east[i] + pe * (off - sh);
      const n = r.north[i] + pn * (off - sh);
      pos.push(e, r.level[i], -n);
      depth.push(d);
      // The across offset points to the left bank; RiverHit.side and the shader count toward the right.
      info.push(-(off - sh + mid), r.s[i], w);
      tan.push(te / tl, -tn / tl);
      if (flowing) {
        b.flow.push(r.steepness![i], r.speed![i], fall, grainToUnit((r as { grain?: Float32Array }).grain?.[i] ?? 0));
        b.pitch.push(r.sigma?.[i] ?? 0, r.pitchOn?.[i] ?? 0);
      }
    }
    rows++;
  }
  for (let j = 0; j < rows - 1; j++) {
    if (curtain[j] || (inLake[j] && inLake[j + 1])) continue;
    for (let k = 0; k < across.length - 1; k++) {
      const a = first + j * across.length + k;
      const c = a + across.length;
      // Counter-clockwise seen from above: rows advance downstream and the across offset points to the
      // left bank (the flow direction turned 90 degrees anticlockwise), so (c - a) x (a+1 - a) is up.
      idx.push(a, c, a + 1, a + 1, c, c + 1);
    }
  }
  return atCoast ? i : to;
}

function riverGeometryOf(b: RiverBuffers): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
  g.setAttribute('aDepth', new THREE.Float32BufferAttribute(b.depth, 1));
  g.setAttribute('aRiverInfo', new THREE.Float32BufferAttribute(b.info, 3));
  g.setAttribute('aRiverT', new THREE.Float32BufferAttribute(b.tan, 2));
  if (b.flow.length) {
    // Bytes (normalised): steepness, speed over FLOW_SPEED_MAX, fall weight, grain (channelStones.ts grainToUnit).
    const f = new Uint8Array(b.flow.length);
    for (let k = 0; k < f.length; k++) f[k] = Math.round(255 * Math.min(1, Math.max(0, k % 4 === 1 ? b.flow[k] / FLOW_SPEED_MAX : b.flow[k])));
    g.setAttribute('aFlow', new THREE.BufferAttribute(f, 4, true));
    // A stream's unit coordinate (floats: it runs to thousands) and where its pitches are drawn (pitchPool.ts).
    g.setAttribute('aPitch', new THREE.Float32BufferAttribute(b.pitch, 2));
  }
  g.setIndex(b.idx);
  g.computeBoundingSphere();
  return g;
}

/** Ribbon pieces are grouped into square chunks this size, m, so the renderer can cull them. */
const RIVER_CHUNK = 10000;
/** Rows per ribbon piece (pieces overlap by one row so they join). */
const RIVER_PIECE = 240;

/** A ribbon piece whose water is never this wide (half-width, m: about 15 km² of catchment, streams.ts
 * channelHalfWidth) is drawn only within SMALL_RIBBON_RANGE m of the viewer (TerrainSystem builds its chunk there and
 * drops it beyond): a narrower stream is under two pixels further off, and a seeded world's mountains hold thousands
 * of km of them (gullies.ts chains). Rivers and wider streams are always drawn. */
export const SMALL_RIBBON_HW = 4;
export const SMALL_RIBBON_RANGE = 9000;

/** A chunk of narrow stream ribbon pieces, built on demand (its pieces' samples' bounds, m). */
export interface SmallRibbonChunk {
  minN: number;
  maxN: number;
  minE: number;
  maxE: number;
  build(): THREE.BufferGeometry | null;
}

/**
 * A seeded world's river network (hydrology.rivers) as ribbon chunks: each line cut into pieces, each piece put in
 * the chunk of its first sample. Empty when the world has no network (seed 0: createRiverGeometry). With `small`,
 * the narrow streams' pieces (SMALL_RIBBON_HW) go there instead, chunk by chunk, to be built near the viewer.
 */
export function createRiverNetworkGeometries(small?: SmallRibbonChunk[]): THREE.BufferGeometry[] {
  const rivers = hydrology.rivers;
  if (!rivers) return [];
  const flow = waterFlows();
  /** Each chunk's pieces, in order: built one chunk at a time below (only one chunk's JS arrays live at once). */
  const chunks = new Map<string, Array<[RibbonLine, number, number]>>();
  const smallPieces = new Map<string, { pieces: Array<[RibbonLine, number, number]>; minN: number; maxN: number; minE: number; maxE: number }>();
  const lakes = hydrology.lakes;
  // Where a river runs through a lake the lake's water covers it: no ribbon there (it would lie in the lake's plane).
  const mask = hydrology.lakeMask;
  const inLake = (n: number, e: number): boolean => {
    if (mask) return mask.at(n, e) > -Infinity;
    for (const l of lakes) {
      if ((n - l.north) ** 2 + (e - l.east) ** 2 > l.bound * l.bound) continue;
      if (lakeRadius(l, n, e) < 0.97) return true;
    }
    return false;
  };
  for (const r of rivers) {
    const count = r.north.length;
    let k = 0;
    while (k < count - 1) {
      // The next run of samples outside every lake: [from, to).
      while (k < count && inLake(r.north[k], r.east[k])) k++;
      if (k >= count - 1) break;
      const from = k;
      while (k < count && !inLake(r.north[k], r.east[k])) k++;
      const to = Math.min(count, k + 1);
      let piece = from;
      let coast = false;
      for (; piece < to - 1 && !coast; piece += RIVER_PIECE) {
        if (r.level[piece] < 0.3) {
          coast = true;
          break;
        }
        const key = `${Math.floor(r.north[piece] / RIVER_CHUNK)},${Math.floor(r.east[piece] / RIVER_CHUNK)}`;
        const end = Math.min(to, piece + RIVER_PIECE + 1);
        if (small) {
          let wide = false;
          for (let i = piece; i < end && !wide; i++) if (ribbonHalf(r as RibbonLine, i) >= SMALL_RIBBON_HW || r.level[i] < 0.3) wide = true;
          if (!wide) {
            let c = smallPieces.get(key);
            if (!c) smallPieces.set(key, (c = { pieces: [], minN: Infinity, maxN: -Infinity, minE: Infinity, maxE: -Infinity }));
            c.pieces.push([r as RibbonLine, piece, end]);
            for (let i = piece; i < end; i++) {
              c.minN = Math.min(c.minN, r.north[i]);
              c.maxN = Math.max(c.maxN, r.north[i]);
              c.minE = Math.min(c.minE, r.east[i]);
              c.maxE = Math.max(c.maxE, r.east[i]);
            }
            continue;
          }
        }
        let list = chunks.get(key);
        if (!list) chunks.set(key, (list = []));
        list.push([r as RibbonLine, piece, end]);
        if (ribbonStops(r as RibbonLine, piece, end, flow)) coast = true;
      }
      if (coast) break;
    }
  }
  if (small) {
    for (const c of smallPieces.values()) {
      small.push({
        minN: c.minN,
        maxN: c.maxN,
        minE: c.minE,
        maxE: c.maxE,
        build: () => {
          const b = riverBuffers();
          for (const [r, from, end] of c.pieces) ribbonRows(r, from, end, b, flow);
          return b.idx.length > 0 ? riverGeometryOf(b) : null;
        },
      });
    }
  }
  const out: THREE.BufferGeometry[] = [];
  for (const list of chunks.values()) {
    const b = riverBuffers();
    for (const [r, from, end] of list) ribbonRows(r, from, end, b, flow);
    if (b.idx.length > 0) out.push(riverGeometryOf(b));
  }
  return out;
}

/** Whether ribbonRows stops at the coast within samples [from, to) of a line (a row it would draw stands at the sea). */
function ribbonStops(r: RibbonLine, from: number, to: number, flow: boolean): boolean {
  const flowing = flow && !!r.steepness && !!r.speed && !!r.regime;
  for (const i of ribbonKeep(r, from, to, flowing)) if (r.level[i] < 0.3) return true;
  return false;
}

/** Rows down a fall's curtain (one per CURTAIN_ROW_M of drop, within CURTAIN_ROWS..CURTAIN_ROWS_MAX), its columns, and
 * the foam patch's lattice (FOAM_N x FOAM_N). */
const CURTAIN_ROWS = 7;
const CURTAIN_ROWS_MAX = 32;
const CURTAIN_ROW_M = 4;
const CURTAIN_ACROSS = Array.from({ length: 13 }, (_, c) => c / 6 - 1);
const FOAM_N = 5;
/** Falls are grouped in square chunks this size, m: few vertices each, so coarser than the ribbons' (fewer draw calls). */
const FALL_CHUNK = 40000;

/** A falls chunk's vertex data: the river ribbon's attributes plus aFall (kind, and two numbers for that kind). */
interface FallBuffers extends RiverBuffers {
  fall: number[];
}

/** A line's value of `v` at arc length sv (clamped to its ends). */
function alongLine(r: RibbonLine, v: Float64Array, sv: number, hint: number): number {
  let i = Math.max(0, Math.min(r.s.length - 2, hint));
  while (i > 0 && r.s[i] > sv) i--;
  while (i < r.s.length - 2 && r.s[i + 1] < sv) i++;
  const t = Math.min(1, Math.max(0, (sv - r.s[i]) / Math.max(1e-6, r.s[i + 1] - r.s[i])));
  return v[i] + (v[i + 1] - v[i]) * t;
}

/**
 * A seeded world's falls (hydrology.falls) as meshes for the falls material, in FALL_CHUNK squares: `sheets`
 * holds each fall's curtain (from the lip, where the ribbon stops, curving out and down to its foot, where the ribbon
 * goes on) and the foam on its plunge pool; `spray` the puff of spray over the pool (drawn after, without depth writes).
 * Empty unless the world's water flows (waterFlows()).
 */
export function createFallGeometries(): { sheets: THREE.BufferGeometry[]; spray: THREE.BufferGeometry[] } {
  const rivers = hydrology.rivers;
  const falls = hydrology.falls;
  if (!rivers || !falls?.length || !waterFlows()) return { sheets: [], spray: [] };
  const sheetChunks = new Map<string, FallBuffers>();
  const sprayChunks = new Map<string, FallBuffers>();
  const chunk = (m: Map<string, FallBuffers>, n: number, e: number): FallBuffers => {
    const key = `${Math.floor(n / FALL_CHUNK)},${Math.floor(e / FALL_CHUNK)}`;
    let b = m.get(key);
    if (!b) m.set(key, (b = { ...riverBuffers(), fall: [] }));
    return b;
  };
  const mask = hydrology.lakeMask;
  falls.forEach((f, fi) => {
    const r = rivers[f.line] as RibbonLine;
    const i = f.index;
    if (i + 1 >= r.level.length || r.level[i] < 0.3) return;
    // Under a lake's water there is no fall to see.
    if (mask && mask.at(r.north[i + 1], r.east[i + 1]) > -Infinity) return;
    const top = r.level[i];
    const bottom = r.level[i + 1];
    const drop = top - bottom;
    if (drop < 1) return;
    const dn = r.north[i + 1] - r.north[i];
    const de = r.east[i + 1] - r.east[i];
    const run = Math.hypot(dn, de) || 1;
    // Flow direction (north, east) and the unit toward the left bank (the ribbon's across direction).
    const un = dn / run;
    const ue = de / run;
    const ln = ue;
    const le = -un;
    const v0 = r.speed?.[i] ?? 1;
    const seed = ((fi * 0.6180339887) % 1) * 40;
    const hw0 = r.halfWidth[i];
    const hw1 = r.halfWidth[i + 1];
    const b = chunk(sheetChunks, r.north[i], r.east[i]);
    if (curtainAt(r, i)) {
      // The curtain: a parabola from the lip (leaving it level) to the foot, y = drop u, out = run sqrt(u); it stands
      // in front of the straight face the terrain is cut to. Narrowing a little as it falls; soft at the sides.
      // A natural lip is no weir's: it bows and wanders along the flow (each fall its own), the water spills lower at
      // its rounded ends, and over a wider fall it parts round the rock into strands (columns left dry).
      const first = b.pos.length / 3;
      const nA = CURTAIN_ACROSS.length;
      const h01 = (k: number): number => (hash2i(fi * 13 + k, 7177) & 0xffff) / 65535;
      const bow = (h01(0) - 0.35) * 0.6 * hw0;
      // (Each column of the lip its own: the rock of a natural lip is broken, some of it standing out of the water.)
      const lipOff = CURTAIN_ACROSS.map((a, c) => bow * (1 - a * a) + (h01(c + 1) - 0.5) * Math.min(0.6 * hw0, 0.4 * run + 2 + 0.25 * hw0));
      // A tall fall's water gathers into a narrower ribbon over the lip and fans out as it falls (a thin fall down a
      // rock face, not a sheet as wide as the stream); a low one stays about as wide as its channel.
      const tall = Math.min(1, Math.max(0, (drop - 12) / 38));
      const hwTop = Math.max(Math.min(hw0, 0.6), hw0 * (1 - 0.55 * tall));
      const rows = Math.min(CURTAIN_ROWS_MAX, Math.max(CURTAIN_ROWS, Math.round(drop / CURTAIN_ROW_M) + 3));
      for (let k = 0; k < rows; k++) {
        const u = k / (rows - 1);
        const hw = hwTop * (1 - 0.12 * u * (1 - tall)) * (1 + tall * 0.8 * u * u) + (hw1 - hw0) * u * (1 - tall);
        // The wandering columns: each sways a little as it falls (fixed per fall).
        for (let c = 0; c < nA; c++) {
          const a = CURTAIN_ACROSS[c];
          const sway = tall * (h01(c + 60) - 0.5) * 0.3 * hwTop * u;
          const out = run * Math.sqrt(u) + lipOff[c] * (1 - 0.5 * u);
          const y = top - drop * u - 0.3 * Math.min(drop, hw0) * a * a * a * a * (1 - u) + 0.03;
          const n = r.north[i] + un * out + ln * (a * hw + sway);
          const e = r.east[i] + ue * out + le * (a * hw + sway);
          b.pos.push(e, y, -n);
          b.depth.push(Math.abs(a) > 0.99 ? -0.05 : 1);
          b.info.push(-a * hw, seed, hw);
          b.tan.push(ue, -un);
          b.fall.push(0, drop * u, v0, drop);
        }
      }
      // Over a wide low fall the water parts round the rock of the lip into separate chutes (columns left dry).
      const dryCol = (c: number): boolean => hw0 > 3 && tall < 0.5 && c > 0 && c < nA - 2 && Math.abs(c - (nA - 2) / 2) > 0.6 && h01(c + 40) < Math.min(0.45, 0.05 * hw0);
      for (let k = 0; k < rows - 1; k++) {
        for (let c = 0; c < nA - 1; c++) {
          if (dryCol(c)) continue;
          const a = first + k * nA + c;
          const d = a + nA;
          b.idx.push(a, d, a + 1, a + 1, d, d + 1);
        }
      }
    }
    // Foam on the plunge pool: an ellipse from just under the curtain to some way downstream, on the water's level.
    const along = 0.5 * drop + 0.8 * hw1 + 1.5;
    const acrossR = 1.25 * hw1 + 1;
    const back = Math.min(run, 1 + 0.2 * drop);
    const sFoot = r.s[i + 1];
    {
      const first = b.pos.length / 3;
      for (let p = 0; p < FOAM_N; p++) {
        // -1 at the upstream end (under the curtain), +1 downstream.
        const x = (2 * p) / (FOAM_N - 1) - 1;
        const dAlong = x < 0 ? x * back : x * along;
        const sv = sFoot + dAlong;
        const cn = alongLine(r, r.north, sv, i + 1);
        const ce = alongLine(r, r.east, sv, i + 1);
        const lv = (dAlong < 0 ? bottom : alongLine(r, r.level, sv, i + 1)) + 0.05;
        for (let q = 0; q < FOAM_N; q++) {
          const z = (2 * q) / (FOAM_N - 1) - 1;
          const n = cn + ln * z * acrossR;
          const e = ce + le * z * acrossR;
          b.pos.push(e, lv, -n);
          b.depth.push(1 - Math.min(1, x * x + z * z));
          b.info.push(-z * acrossR, dAlong, hw1);
          b.tan.push(ue, -un);
          b.fall.push(1, drop, v0, 0);
        }
      }
      for (let p = 0; p < FOAM_N - 1; p++) {
        for (let q = 0; q < FOAM_N - 1; q++) {
          const a = first + p * FOAM_N + q;
          const d = a + FOAM_N;
          b.idx.push(a, d, a + 1, a + 1, d, d + 1);
        }
      }
    }
    // Spray: upright cards turned to the camera in the shader - a cloud low over the pool (never a ball as big as the
    // fall: its size grows slowly with the drop), and off a tall fall a thinner veil drifting higher, downstream.
    {
      const sb = chunk(sprayChunks, r.north[i], r.east[i]);
      const cards: Array<[number, number, number, number]> = [];
      const size0 = Math.min(0.5 * drop + 0.4 * hw1 + 2, 4 + 0.14 * drop + 0.7 * hw1);
      cards.push([size0, 0.15 * drop + 1, 0.55 * size0, 0]);
      if (drop > 20) {
        const size1 = 0.6 * size0 + 0.06 * drop;
        cards.push([size1, 0.25 * drop + 2 + 0.3 * size0, size0 * 0.8 + 0.12 * drop, 1]);
      }
      for (const [size, ahead, rise, kind] of cards) {
        const cn = r.north[i + 1] + un * ahead;
        const ce = r.east[i + 1] + ue * ahead;
        const cy = bottom + rise;
        const first = sb.pos.length / 3;
        for (const [cx, cz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          sb.pos.push(ce, cy, -cn);
          sb.depth.push(1);
          sb.info.push(drop, seed + 7.3 * kind, size);
          sb.tan.push(ue, -un);
          sb.fall.push(2, cx, cz, kind);
        }
        sb.idx.push(first, first + 1, first + 2, first + 2, first + 1, first + 3);
      }
    }
  });
  const build = (b: FallBuffers): THREE.BufferGeometry => {
    const g = riverGeometryOf(b);
    g.setAttribute('aFall', new THREE.Float32BufferAttribute(b.fall, 4));
    // The spray cards stand up to their size over their centre: widen the bounds so they are not culled early.
    g.computeBoundingSphere();
    if (g.boundingSphere) g.boundingSphere.radius += 60;
    return g;
  };
  return {
    sheets: [...sheetChunks.values()].filter((b) => b.idx.length > 0).map(build),
    spray: [...sprayChunks.values()].filter((b) => b.idx.length > 0).map(build),
  };
}
