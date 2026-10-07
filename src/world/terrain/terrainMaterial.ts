// Terrain material: MeshStandardMaterial (so the scene's sun, ambient, shadows and log depth all keep
// working) patched with onBeforeCompile.
//
// Vertex stage: CDLOD geomorph. Each vertex slides from its own lattice toward the parent lattice over the
// level's morph window, measured with the same distance metric the quadtree uses (see quadtree.ts);
// skirt vertices are dropped below the surface.
//
// Fragment stage: procedural splatting in world space, with no tiling texture larger than a few metres:
//   - macro/meso colour variation from a tileable noise texture sampled at 5.2 km, 1.3 km, 260 m, 47 m;
//   - ground materials from GPU-generated detail arrays (textures.ts), anti-tiled near the camera and
//     sampled again at a larger unrelated scale/rotation, used as a relative modulation of a physically
//     plausible base albedo;
//   - farmland parcels with crops, tramlines, furrows, hedgerows and tracks (fields.ts);
//   - forest floor under the near tree meshes; beyond them a canopy shell (the surface lifted by
//     CANOPY_HEIGHT under closed forest, in the vertex stage and the shadow pass) shaded as tree crowns,
//     with forest-edge walls lit by their facet normal;
//   - the airfield inside the perimeter fence as mown turf with view-dependent mowing stripes; farmland
//     up to the fence outside it;
//   - rock with warped strata on steep ground and ridges (from slope and the per-vertex curvature, with a
//     vertical projection on cliffs so they are not smeared) and weathering streaks down the fall line,
//     scree fans and broken rock around outcrops, thin olive alpine turf, snow above an irregular snow line
//     (lower on north faces) that collects in hollows and slides off steep faces, glaciers with bare ice
//     tongues and crevasses in the high hollows, beaches on sea coasts, darker wet ground by water.
//   Detail layers are sampled only where they show and fade to their mean far away (layerTop).

import * as THREE from 'three';
import { AIRPORT } from '../../core/world';
import { FENCE_RECT } from '../airport/layout';
import { FIELDS_GLSL } from './fields';
import { HASH_GLSL, ROT_GLSL } from './glsl';
import { RIVER_STRIP, TREE_LINE_ASPECT } from './biome';
import { RIVER_UNITS, SKIRT_FLAG } from './tileBuilder';
import { TOWN_CORE, TOWN_CORE_FADE, TOWN_PARCEL_MARGIN, TOWN_WOOD_FADE, TOWN_WOOD_MARGIN, townSite } from './townMask';
import { LAYER, LAYER_COUNT, LAYER_ROUGHNESS, LAYER_TILE_M, type TerrainTextures } from './textures';

export const MAX_LEVELS = 16;
/**
 * Beyond the near-tree range, dense forest is drawn as a canopy shell: the terrain surface lifted by this
 * much (m) under closed stands, shaded as the lower, shaded layer of tree crowns. Tree impostors (10-28 m
 * tall) stand in it with their upper crowns above it, so a forest reads as a closed canopy of individual
 * crowns from the air and casts its shadow onto the fields beside it.
 */
export const CANOPY_HEIGHT = 10;
/** How much lower the snow line lies on north faces than on flat ground (and higher on south faces), m. */
export const SNOW_ASPECT = 260;

export interface TerrainUniforms {
  /** Per level: morph window start and 1/(end - start), m. */
  uMorph: { value: THREE.Vector2[] };
  /** Per level: skirt depth, m. */
  uSkirt: { value: number[] };
  /** LOD centre: (three.x, dz, three.z) - camera horizontal position and height above nearby terrain. */
  uLodCenter: { value: THREE.Vector3 };
  /** Distances from the viewer over which the forest canopy shell rises from the ground (forest floor) to its full height, m. */
  uForestFade: { value: THREE.Vector2 };
  /**
   * The tree impostors' thinning (VegetationSystem): full density to x, then (x / d)^1.5, fading out from y to
   * z (m); w = 1 when there are impostors. Where they thin, the canopy shell shows the sunlit crowns itself.
   */
  uCanopyKeep: { value: THREE.Vector4 };
  /** The viewer's position (three.js world). The shadow pass needs it: there cameraPosition is the light's. */
  uViewPos: { value: THREE.Vector3 };
  [name: string]: { value: unknown };
}

/**
 * Linear albedo of bare field soils (ploughed and tilled parcels, and the soil between young maize rows):
 * warm browns to tans, hue 35-47 degrees in sRGB. Blue sky light and the aerial perspective's blue in-scatter
 * pull a distant soil's hue down by 20 degrees or more, so redder browns read grey-mauve from the air.
 */
export const SOIL_ALBEDO = {
  moistLoam: [0.09, 0.07, 0.034],
  loam: [0.135, 0.106, 0.052],
  drySilt: [0.2, 0.17, 0.1],
  clay: [0.14, 0.096, 0.048],
  maizeDark: [0.11, 0.086, 0.043],
  maizeLight: [0.16, 0.134, 0.075],
} as const;

const glslVec = (c: readonly number[]): string => `vec3(${c.map((x) => x.toFixed(4)).join(', ')})`;

const VERTEX_HEAD = /* glsl */ `
// Vertex attributes (tileBuilder.ts): normals (own x, z; parent x, z), morph height, biome, shape
// (curvature, parent forest, level byte).
attribute vec4 aNormals;
attribute float aMorph;
attribute vec4 aBiome;
attribute vec4 aShape;
attribute vec2 aRiver;
varying vec2 vRiver;
uniform vec2 uMorph[${MAX_LEVELS}];
uniform float uSkirt[${MAX_LEVELS}];
uniform vec3 uLodCenter;
uniform vec2 uForestFade;
uniform vec3 uViewPos;
varying vec3 vTerrainPos;
varying vec3 vTerrainNormal;
varying vec4 vBiome;
varying float vCurvature;
// How much of the canopy shell's lift this vertex has (0..1): where it is 0 the shell casts no real shadow.
varying float vLiftK;
// Land-cover slope (vertical normal component on the land-cover lattice, independent of LOD).
varying float vCoverUp;
// Canopy shell lift (m) of a vertex at world position w: closed forest (geomorphed with the vertex, so
// neighbouring LODs still meet), rising with distance from the viewer where the tree meshes end. On coarse
// tiles (vertex spacing beyond ~15 m) a forest edge would be a one-triangle cliff with a saw-tooth outline,
// so the lift fades out over levels 2.5-4.5 (a few km away, where its height no longer shows). The level is
// taken with the morph (level + tMorph), which is continuous across LOD boundaries, so edges still meet.
float canopyLift(vec3 w, float tMorph, float level) {
  float forest = mix(aBiome.x, aShape.y, tMorph);
  float rise = smoothstep(uForestFade.x, uForestFade.y, distance(w, uViewPos));
  float coarse = 1.0 - smoothstep(2.5, 4.5, level + tMorph);
  return smoothstep(0.45, 0.85, forest) * rise * coarse * ${CANOPY_HEIGHT.toFixed(1)};
}
// Level byte: the node level, plus SKIRT_FLAG on skirt vertices.
float levelByte() { return floor(aShape.z * 255.0 + 0.5); }
float tileLevel() {
  float lv = levelByte();
  return lv > ${(SKIRT_FLAG - 0.5).toFixed(1)} ? lv - ${SKIRT_FLAG.toFixed(1)} : lv;
}
// A terrain normal stored as its x and z components (it always points up).
vec3 upNormal(vec2 xz) { return vec3(xz.x, sqrt(max(0.0, 1.0 - dot(xz, xz))), xz.y); }
// Geomorph factor of this vertex (0 = own lattice, 1 = parent lattice) and its skirt drop.
float terrainMorph(vec3 pos, out float drop) {
  bool skirt = levelByte() > ${(SKIRT_FLAG - 0.5).toFixed(1)};
  int level = int(tileLevel());
  vec3 w = (modelMatrix * vec4(pos, 1.0)).xyz;
  vec2 d = w.xz - uLodCenter.xz;
  float dist = sqrt(dot(d, d) + uLodCenter.y * uLodCenter.y);
  vec2 mw = uMorph[level];
  drop = skirt ? uSkirt[level] : 0.0;
  return clamp((dist - mw.x) * mw.y, 0.0, 1.0);
}
`;

const VERTEX_NORMAL = /* glsl */ `
float tDrop;
float tMorph = terrainMorph(position, tDrop);
vec3 objectNormal = normalize(mix(upNormal(aNormals.xy), upNormal(aNormals.zw), tMorph));
#ifdef USE_TANGENT
vec3 objectTangent = vec3(tangent.xyz);
#endif
`;

const VERTEX_BEGIN = /* glsl */ `
vec3 transformed = position;
transformed.y += aMorph * tMorph - tDrop;
{
  vec3 lw = (modelMatrix * vec4(transformed, 1.0)).xyz;
  vLiftK = smoothstep(uForestFade.x, uForestFade.y, distance(lw, uViewPos)) * (1.0 - smoothstep(2.5, 4.5, tileLevel() + tMorph));
  transformed.y += canopyLift(lw, tMorph, tileLevel());
}
vTerrainPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
vTerrainNormal = objectNormal;
vBiome = aBiome;
vCurvature = aShape.x * 2.0 - 1.0;
vCoverUp = aShape.w;
vRiver = aRiver * ${(1 / RIVER_UNITS).toFixed(4)};
`;

const FRAGMENT_HEAD = /* glsl */ `
precision highp sampler2DArray;
uniform sampler2D tNoise;
uniform sampler2DArray tDetailA;
uniform sampler2DArray tDetailN;
uniform float uTile[${LAYER_COUNT}];
// Mean linear albedo of each detail layer (its 1x1 mip, measured once at start-up).
uniform vec3 uLayerMean[${LAYER_COUNT}];
uniform float uLayerRough[${LAYER_COUNT}];
uniform vec2 uForestFade;
uniform vec4 uCanopyKeep;
// Airport geometry: runway centre (east, north) and heading (cos, sin); runway half length and half width,
// the terrain's flat margin and blend distance around it; the perimeter fence in runway coordinates.
uniform vec4 uRunway;
uniform vec4 uRunwayDims;
uniform vec4 uFence;
// Valley town: centre (east, north), radius, 1 if there is one (townMask.ts).
uniform vec4 uTown;
varying vec3 vTerrainPos;
varying vec3 vTerrainNormal;
varying vec4 vBiome;
varying float vCurvature;
varying float vLiftK;
varying float vCoverUp;
// Signed distance from the river centreline and the channel half-width there, m (tileBuilder.ts).
varying vec2 vRiver;
${HASH_GLSL}
${ROT_GLSL}
${FIELDS_GLSL}

struct Mat { vec3 albedo; vec2 slope; float rough; float cavity; float height; };

// Runway coordinates of a world (three.js xz) position: x along the centreline (+ toward the 25 end),
// y across (+ to the right facing 070), as runwayCoords() in core/world.ts.
vec2 runwayLocal(vec2 xz) {
  float de = xz.x - uRunway.x;
  float dn = -xz.y - uRunway.y;
  return vec2(dn * uRunway.z + de * uRunway.w, -dn * uRunway.w + de * uRunway.z);
}
// Signed distance from the perimeter fence, m (negative inside), as fenceDistance() in biome.ts.
float fenceDistance(vec2 rw) {
  vec2 o = max(max(uFence.xz - rw, rw - uFence.yw), 0.0);
  float inside = min(min(rw.x - uFence.x, uFence.y - rw.x), min(rw.y - uFence.z, uFence.w - rw.y));
  return max(o.x, o.y) > 0.0 ? length(o) : -inside;
}
// The terrain's airport blend (0 on the flattened airfield, 1 on natural ground), as in heightfield.ts.
float airportBlendAt(vec2 rw) {
  float d = length(max(abs(rw) - uRunwayDims.xy, 0.0));
  return smoothstep(uRunwayDims.z, uRunwayDims.z + uRunwayDims.w, d);
}

// One ground material from the detail arrays. Albedo comes back as a modulation around 1 (texture / layer
// mean, mostly in luminance so the base colour keeps its hue); slope is the tangent-space normal xy in
// world xz.
//   near scale: fades out by ~45 repeats of distance, where its mips are flat anyway. Up close, two
//               copies with unrelated rotations and offsets are switched by a noise mask about 19
//               repeats across with a height-aware seam, so no repeat of either copy shows;
//   mid scale:  a third copy 4.8x larger, always on, which carries the detail further out.
vec3 detailRatio(vec3 c, vec3 m) {
  vec3 lumW = vec3(0.2126, 0.7152, 0.0722);
  return mix(vec3(dot(c, lumW) / dot(m, lumW)), c / m, 0.35);
}
Mat layerTop(int layer, vec2 xz, float dist) {
  float tile = uTile[layer];
  // Far away (beyond ~800 repeats, several km for most layers) the detail has filtered down to its mean:
  // return the neutral material without sampling.
  float farFade = smoothstep(tile * 550.0, tile * 800.0, dist);
  if (farFade >= 1.0) return Mat(vec3(1.0), vec2(0.0), uLayerRough[layer], 1.0, 0.5);
  float inv = 1.0 / tile;
  float fl = float(layer);
  vec3 m = uLayerMean[layer];
  vec2 uv2 = rot2(xz, 1.7) * (inv * 0.21) + 0.37;
  vec4 a2 = texture(tDetailA, vec3(uv2, fl));
  vec4 n2 = texture(tDetailN, vec3(uv2, fl));
  vec3 c2 = detailRatio(pow(a2.rgb, vec3(2.2)), m);
  vec2 s2 = rot2(n2.xy * 2.0 - 1.0, -1.7);
  Mat o;
  o.albedo = mix(vec3(1.0), c2, 0.6);
  o.slope = 0.5 * s2;
  o.rough = n2.z;
  o.cavity = mix(1.0, n2.w, 0.5);
  o.height = 0.35 + 0.35 * a2.a;
  float near = 1.0 - smoothstep(tile * 30.0, tile * 45.0, dist);
  if (near > 0.0) {
    vec2 uvA = xz * inv;
    vec4 a1 = texture(tDetailA, vec3(uvA, fl));
    vec4 n1 = texture(tDetailN, vec3(uvA, fl));
#if TERRAIN_DETAIL > 0
    float mask = texture(tNoise, xz * (inv / 19.0)).g;
    if (mask > 0.38 && dist < tile * 25.0) {
      vec2 uvB = rot2(xz, 2.4) * (inv * 0.83) + vec2(0.31, 0.77);
      vec4 aB = texture(tDetailA, vec3(uvB, fl));
      vec4 nB = texture(tDetailN, vec3(uvB, fl));
      nB.xy = rot2(nB.xy * 2.0 - 1.0, -2.4) * 0.5 + 0.5;
      float w = clamp((mask - 0.5) * 6.0 + (aB.a - a1.a) * 2.0 + 0.5, 0.0, 1.0);
      a1 = mix(a1, aB, w);
      n1 = mix(n1, nB, w);
    }
#endif
    o.albedo = mix(o.albedo, detailRatio(pow(a1.rgb, vec3(2.2)), m) * o.albedo, near);
    o.slope += (n1.xy * 2.0 - 1.0) * near;
    o.rough = mix(o.rough, n1.z, near);
    o.cavity *= mix(1.0, n1.w, near);
    o.height = mix(o.height, 0.65 * a1.a + 0.35 * a2.a, near);
  }
  if (farFade > 0.0) {
    o.albedo = mix(o.albedo, vec3(1.0), farFade);
    o.slope *= 1.0 - farFade;
    o.rough = mix(o.rough, uLayerRough[layer], farFade);
    o.cavity = mix(o.cavity, 1.0, farFade);
    o.height = mix(o.height, 0.5, farFade);
  }
  return o;
}

// Cliffs: the top projection blended with the dominant vertical one (single scale, which is enough on
// faces seen at an angle), weighted by the normal.
Mat layerCliff(int layer, vec3 p, vec3 n, float dist) {
  Mat t = layerTop(layer, p.xz, dist);
#if TERRAIN_DETAIL > 0
  vec3 an = abs(n);
  if (an.y > 0.9) return t;
  bool xSide = an.x > an.z;
  float fl = float(layer);
  vec2 uv = (xSide ? p.zy : p.xy) / (uTile[layer] * 1.7) + 0.29;
  vec4 a = texture(tDetailA, vec3(uv, fl));
  vec4 nn = texture(tDetailN, vec3(uv, fl));
  vec3 m = uLayerMean[layer];
  float wt = pow(an.y, 4.0);
  float wv = pow(xSide ? an.x : an.z, 4.0);
  float k = wt / (wt + wv);
  vec2 sv = nn.xy * 2.0 - 1.0;
  Mat o;
  o.albedo = mix(detailRatio(pow(a.rgb, vec3(2.2)), m), t.albedo, k);
  o.rough = mix(nn.z, t.rough, k);
  o.cavity = mix(nn.w, t.cavity, k);
  o.height = mix(a.a, t.height, k);
  // The side projection perturbs the normal within its own plane; express that as a world-space tilt.
  o.slope = mix(xSide ? vec2(0.0, sv.x) : vec2(sv.x, 0.0), t.slope, k);
  return o;
#else
  return t;
#endif
}

// Forest canopy: the canopy layer's albedo is used as is (linear, physical). Two copies at unrelated
// scales and rotations, switched by a noise mask, so no repeat shows from the air; the relief (crown
// domes) comes through the normal so low sun leaves the gaps between crowns in shadow.
Mat canopyLayer(vec2 xz, float mask) {
  float tile = uTile[${LAYER.canopy}];
  float fl = ${LAYER.canopy.toFixed(1)};
  vec2 uA = xz / tile;
  vec2 uB = rot2(xz, 2.3) / (tile * 1.37) + vec2(0.41, 0.13);
  vec4 a1 = texture(tDetailA, vec3(uA, fl));
  vec4 n1 = texture(tDetailN, vec3(uA, fl));
  vec4 a2 = texture(tDetailA, vec3(uB, fl));
  vec4 n2 = texture(tDetailN, vec3(uB, fl));
  n2.xy = rot2(n2.xy * 2.0 - 1.0, -2.3) * 0.5 + 0.5;
  float m = clamp((mask - 0.5) * 5.0 + (a2.a - a1.a) * 1.5 + 0.5, 0.0, 1.0);
  vec4 a = mix(a1, a2, m);
  vec4 n = mix(n1, n2, m);
  Mat o;
  o.albedo = pow(a.rgb, vec3(2.2));
  o.slope = (n.xy * 2.0 - 1.0) * 1.6;
  o.rough = 0.85;
  o.cavity = n.w;
  o.height = a.a;
  return o;
}

// Accumulate a weighted material.
void addMat(inout Mat acc, Mat m, vec3 base, float w) {
  acc.albedo += base * m.albedo * w;
  acc.slope += m.slope * w;
  acc.rough += m.rough * w;
  acc.cavity += m.cavity * w;
  acc.height += m.height * w;
}

// Anti-aliased lines at integer x, 'width' (in periods) either side; fades to its mean coverage once the
// period shrinks below a couple of pixels.
float stripe(float x, float width) {
  float fw = fwidth(x);
  float d = abs(fract(x + 0.5) - 0.5);
  float s = 1.0 - smoothstep(width - fw, width + fw, d);
  return mix(s, 2.0 * width, smoothstep(0.2, 0.5, fw));
}

// Crop appearance for a parcel: base albedo (linear), whether it is bare soil, its row pattern and the
// width of the machine passes that stripe it. 'pasture' in [0, 1] is the regional share of grassland (more
// in hilly, higher and wetter country). Early-summer mix: grazed and uncut pasture, hay meadows being mown,
// green and ripening cereals, maize still showing soil between its rows, some bare and some stubble fields,
// and rapeseed in pod. Soils are warm browns to tans (hue 20-45 degrees): moist dark loam, mid brown, pale
// dry silt and a few reddish clays.
vec3 cropColor(float id, float pasture, out float soil, out float rows, out float passW) {
  soil = 0.0;
  rows = 0.0;
  passW = 0.0;
  // Per-parcel brightness and a green-yellow / green-blue shift (variety, vigour, fertiliser).
  float v = 0.76 + 0.48 * fract(id * 17.0);
  float hue = fract(id * 23.7) - 0.5;
  vec3 greenShift = vec3(1.0 + 0.3 * hue, 1.0, 1.0 - 0.45 * hue);
  if (id < pasture) {
    float k = fract(id * 7.31);
    passW = 6.0;
    if (k < 0.35) { passW = 0.0; return vec3(0.046, 0.078, 0.029) * v * greenShift; } // grazed pasture
    if (k < 0.62) { passW = 0.0; return vec3(0.052, 0.088, 0.030) * v * greenShift; } // uncut meadow
    rows = 4.0;
    if (k < 0.85) return vec3(0.080, 0.098, 0.043) * v;                                // freshly mown hay meadow
    return vec3(0.125, 0.115, 0.060) * v;                                               // hay drying in windrows
  }
  id = (id - pasture) / (1.0 - pasture) * 0.7 + 0.3;
  float sub = fract(id * 41.3);
  if (id < 0.52) { rows = 1.0; passW = 6.0; return vec3(0.056, 0.094, 0.030) * v * greenShift; } // young cereal
  if (id < 0.64) { rows = 1.0; passW = 6.0; return mix(vec3(0.20, 0.165, 0.072), vec3(0.15, 0.15, 0.06), sub) * v; } // ripening cereal
  if (id < 0.76) {
    // Ploughed / tilled soil.
    soil = 1.0; rows = 2.0; passW = 4.0;
    // (Yellow-brown at the source: blue sky light and aerial perspective pull soil toward red-grey, so
    // loams with too little green read mauve from the air.)
    vec3 loam = sub < 0.35 ? ${glslVec(SOIL_ALBEDO.moistLoam)} : sub < 0.7 ? ${glslVec(SOIL_ALBEDO.loam)} : sub < 0.9 ? ${glslVec(SOIL_ALBEDO.drySilt)} : ${glslVec(SOIL_ALBEDO.clay)};
    return loam * (0.85 + 0.3 * fract(id * 17.0));
  }
  if (id < 0.86) { rows = 1.0; passW = 7.5; return vec3(0.215, 0.175, 0.098) * v; } // stubble
  if (id < 0.975) { soil = 1.0; rows = 3.0; passW = 4.5; return mix(${glslVec(SOIL_ALBEDO.maizeDark)}, ${glslVec(SOIL_ALBEDO.maizeLight)}, sub) * v; } // young maize over soil
  rows = 1.0;
  passW = 6.0;
  return vec3(0.125, 0.125, 0.045) * v;                               // rapeseed in pod
}

// Coverage of a line band along a field edge, box-filtered over the pixel footprint: d is the distance from the
// edge (m, >= 0 inside this parcel; the neighbouring parcel has its own band on the other side, taken to be as
// wide), w the band's half-width to its soft edge, soft that edge's width and fw the pixel footprint (m). Near
// the camera it is the soft-edged band; once the band is under a pixel wide it fades to its mean coverage
// instead of being sampled once per pixel (which crawls and breaks into dashes in motion).
float bandCover(float d, float w, float soft, float fw) {
  float f = max(soft, fw);
  return clamp((min(d + 0.5 * f, w) - max(d - 0.5 * f, -w)) / f, 0.0, 1.0);
}

// Anti-aliased square wave (+1 / -1) along x with period 1, fading to 0 once a period is under ~2 pixels.
float passWave(float x) {
  float fw = max(fwidth(x), 1e-4);
  float s = clamp((abs(fract(x) - 0.5) - 0.25) / fw + 0.5, 0.0, 1.0) * 2.0 - 1.0;
  return s * (1.0 - smoothstep(0.2, 0.45, fw));
}
`;

const FRAGMENT_SPLAT = /* glsl */ `
vec3 tP = vTerrainPos;
vec2 tXZ = tP.xz;
vec3 tN = normalize(vTerrainNormal);
float tDist = length(tP - cameraPosition);
float tUp = tN.y;
float tH = tP.y;
vec4 tBio = vBiome;

// Tileable noise at four unrelated scales: macro (regional tone), meso (patches), small, fine.
vec4 nA = texture(tNoise, tXZ * (1.0 / 5200.0));
vec4 nB = texture(tNoise, rot2(tXZ, 0.9) * (1.0 / 1300.0));
vec4 nC = texture(tNoise, rot2(tXZ, 2.1) * (1.0 / 260.0));
vec4 nD = texture(tNoise, rot2(tXZ, 4.0) * (1.0 / 47.0));
vec4 sA = (nA - 0.5) * 2.5;
vec4 sB = (nB - 0.5) * 2.5;
vec4 sC = (nC - 0.5) * 2.5;
vec4 sD = (nD - 0.5) * 2.5;

#if NUM_DIR_LIGHTS > 0
vec3 tSunW = normalize((vec4(directionalLights[0].direction, 0.0) * viewMatrix).xyz);
#else
vec3 tSunW = vec3(0.0, 1.0, 0.0);
#endif
// --- Layer weights ---
// Tree line as in biome.ts: higher on sunny south faces, lower on shaded north faces (tN.z < 0 faces north).
float treeLine = 1750.0 + 150.0 * sA.a + ${TREE_LINE_ASPECT.toFixed(1)} * tN.z;
// Summer snow line: lower on shaded north-facing slopes, higher on sunny south faces.
float snowLine = 2500.0 + 180.0 * sA.b + 60.0 * sB.r + ${SNOW_ASPECT.toFixed(1)} * tN.z;
float alpine = smoothstep(treeLine + 150.0, treeLine + 600.0, tH);
// From the tree line up: the zone where bare rock comes out on moderately steep ground.
float highZone = smoothstep(treeLine - 100.0, treeLine + 300.0, tH);
// Landform: ridges and convex breaks (curvature < 0) shed soil and expose rock; hollows and gullies
// (curvature > 0) collect debris, soil and snow.
float convex = clamp(-vCurvature * 1.5, 0.0, 1.0);
float concave = clamp(vCurvature * 1.5, 0.0, 1.0);
// Snow above the snow line, more in hollows, sliding off steep faces.
float snowW = smoothstep(snowLine - 60.0, snowLine + 140.0, tH + 90.0 * sC.r + 150.0 * concave) * smoothstep(0.58, 0.76, tUp + 0.08 * sD.g + 0.1 * concave);
// Rock: steep faces (sooner on ridges), and moderately steep ground high above the tree line (alpine meadow
// holds on gentler slopes and in hollows up to the snow). The slope is mostly the land-cover slope (the
// same the forest is cut by, independent of LOD) with some of the mesh normal's detail: below the tree line
// rock starts where the forest ends (biome.ts FOREST_UP_*), not on top of the canopy.
float rockShift = 0.08 * convex - 0.06 * concave;
float upR = vCoverUp > 0.01 ? mix(vCoverUp, tUp, 0.25) : tUp;
float tUpN = upR + 0.05 * sC.b + 0.035 * sD.r;
// Slope thresholds on interpolated attributes have piecewise-linear contours that zig-zag along coarse
// triangles: in the transition bands, break them up with a fine noise.
float fineN = 0.0;
if ((tUpN > 0.55 && tUpN < 0.9) || (tBio.x > 0.1 && tBio.x < 0.7)) fineN = (texture(tNoise, rot2(tXZ, 5.3) * (1.0 / 13.0)).g - 0.5) * 2.5;
float rockW = smoothstep(mix(0.70, 0.76, highZone) + rockShift, mix(0.60, 0.63, highZone) + rockShift, tUpN + 0.1 * fineN);
rockW = max(rockW, smoothstep(snowLine - 200.0, snowLine + 150.0, tH + 120.0 * sB.g) * smoothstep(0.93 + rockShift, 0.84 + rockShift, tUp + 0.03 * sC.g));
// Scree: debris fans in the hollows below the rock on high ground, a fringe of broken rock around the
// outcrops, and stony patches in the thin alpine turf.
float screeW = (1.0 - rockW) * smoothstep(0.9, 0.8, tUp + 0.04 * sC.a) * alpine * smoothstep(0.1, 0.5, concave + 0.3 * sC.b);
screeW = max(screeW, smoothstep(0.05, 0.45, rockW) * (1.0 - smoothstep(0.55, 0.9, rockW)) * (0.4 + 0.6 * alpine));
screeW = max(screeW, alpine * smoothstep(0.62, 0.82, nD.g + 0.35 * convex) * 0.7);
float sandW = tBio.w;
// The forest attribute is interpolated across triangles, which turns a sharp edge into a saw-tooth along
// the coarse tiles' diagonals: break the threshold up per pixel.
float forestE = tBio.x + 0.1 * sC.r + 0.08 * sD.a + 0.08 * fineN;
// At the tree line the forest breaks up into islands and tongues reaching up the gullies (and stays lower on
// the ridges): a ragged edge rather than one contour.
float treeZone = smoothstep(treeLine - 250.0, treeLine, tH) * (1.0 - smoothstep(treeLine + 250.0, treeLine + 400.0, tH));
forestE += treeZone * (0.5 * (nC.g - 0.5) + 0.4 * (nD.r - 0.5) + 0.25 * (concave - convex));
float forestW = smoothstep(0.22, 0.55, forestE);
// Beyond the tree meshes a stand's edge is a crisp line against the fields (a wall of crowns), not a blur
// over the tens of metres the coarse tiles interpolate the land cover across: threshold it per pixel.
float tFarForest = smoothstep(uForestFade.y, uForestFade.y * 2.5 + 150.0, tDist);
if (tFarForest > 0.0) {
  float fe = forestE + 0.05 * (nD.b - 0.5);
  float few = clamp(fwidth(fe), 0.01, 0.25);
  forestW = mix(forestW, smoothstep(0.42 - few, 0.42 + few, fe), tFarForest);
}
float farmW = smoothstep(0.25, 0.6, tBio.y + 0.12 * sB.a);
if (tFarForest > 0.0) {
  // Land cover multiplies farmland by (1 - forest), so across a wood's edge ramp (a few hundred metres) the
  // two would blend half and half. Far away, recover the farmland share beneath and let the crisp forest
  // mask cut it: the fields run right up to the wall of trees.
  float farmUnder = clamp(tBio.y / max(1.0 - tBio.x, 0.08), 0.0, 1.0);
  farmW = mix(farmW, smoothstep(0.25, 0.6, farmUnder + 0.12 * sB.a) * (1.0 - forestW), tFarForest);
}
float wet = smoothstep(0.78, 1.0, tBio.z);

// --- Land cover base: meadow, fields, forest, sand ---
Mat acc = Mat(vec3(0.0), vec2(0.0), 0.0, 0.0, 0.0);
// Weight of foliage (the canopy shell), which gets the trees' weak, rough-leaf specular response.
float tFoliageW = 0.0;
float dryness = clamp(0.45 + 0.35 * sA.r + 0.25 * sB.g + 0.15 * sC.g - 0.6 * tBio.z + 0.35 * alpine, 0.0, 1.0);
vec3 meadow = mix(vec3(0.038, 0.072, 0.020), vec3(0.105, 0.098, 0.045), dryness);
// Patchwork within meadows: lusher and sparser patches, clover, trampled spots.
meadow *= 0.8 + 0.2 * sD.b + 0.15 * sC.a;
meadow = mix(meadow, meadow * vec3(0.75, 0.92, 0.7), smoothstep(0.35, 0.75, nC.r) * 0.6);
// Above the tree line the turf is thin, short and tussocky: olive and straw rather than lowland green.
meadow = mix(meadow, vec3(0.072, 0.074, 0.040) * (0.8 + 0.25 * sD.b + 0.15 * sC.g), alpine * 0.75);
// Just above the tree line: thickets of dwarf pine and green alder, darkest in the hollows.
float krumm = smoothstep(treeLine - 50.0, treeLine + 100.0, tH) * (1.0 - smoothstep(treeLine + 250.0, treeLine + 450.0, tH));
krumm *= smoothstep(0.5, 0.68, nC.b + 0.35 * (nD.g - 0.5) + 0.25 * concave);
meadow = mix(meadow, vec3(0.022, 0.036, 0.016) * (0.85 + 0.3 * sD.a), krumm * 0.85);
// Airfield: mown grass inside the perimeter fence.
vec2 tRw = runwayLocal(tXZ);
float tFence = fenceDistance(tRw);
float airfield = 1.0 - smoothstep(-1.5, 1.5, tFence);
farmW *= smoothstep(2.0, 6.0, tFence);
if (airfield > 0.001) {
  // Turf: a lush sward with drier and clover-rich patches; the runway strip (the graded area beside the
  // runway) is cut shortest and reads a little lighter and yellower than the outfield.
  float stripArea = 1.0 - smoothstep(60.0, 85.0, abs(tRw.y));
  vec3 turf = mix(vec3(0.046, 0.084, 0.028), vec3(0.078, 0.092, 0.038), clamp(0.3 + 0.3 * sB.g + 0.2 * sC.r + 0.15 * sA.b, 0.0, 1.0));
  turf = mix(turf, turf * vec3(1.1, 1.06, 0.95), stripArea * 0.6);
  turf *= 0.9 + 0.1 * sD.b + 0.08 * sC.a;
  turf = mix(turf, vec3(0.105, 0.095, 0.052), smoothstep(0.64, 0.82, nC.b) * 0.45);
  turf = mix(turf, turf * vec3(0.82, 0.96, 1.0), smoothstep(0.6, 0.78, nD.a) * 0.5);
  // Mowing: gang-mower passes 5.5 m wide parallel to the runway in alternating directions. The cut blades
  // lean with the pass, so a pass looks lighter seen along its direction of travel and darker against
  // it - the stripes show most at grazing angles and vanish seen from above or across them.
  float pp = tRw.y / 5.5;
  float par = mod(floor(pp), 2.0) * 2.0 - 1.0;
  vec3 tV = normalize(cameraPosition - tP);
  vec2 axis = vec2(uRunway.w, -uRunway.z);
  float viewAlong = dot(tV.xz, axis) / max(length(tV.xz), 1e-4);
  float edge = smoothstep(0.0, 0.06, fract(pp)) * smoothstep(1.0, 0.94, fract(pp));
  float stripeVis = 1.0 - smoothstep(0.15, 0.45, fwidth(pp));
  turf *= 1.0 + 0.2 * par * viewAlong * (1.0 - 0.7 * clamp(tV.y, 0.0, 1.0)) * stripeVis * mix(0.5, 1.0, edge);
  meadow = mix(meadow, turf, airfield);
}
// Valley town: no woods in or near it; urban ground (gardens, lawns, shrubs, hard standing) in its built-up
// core, and only grass parcels (see the farmland block) out to its edge. The per-vertex land cover already
// says so, but coarse tiles interpolate it over tens of metres.
float tTownD = 1e9;
float tUrbanW = 0.0;
if (uTown.w > 0.5) {
  tTownD = length(vec2(tXZ.x, -tXZ.y) - uTown.xy);
  forestW *= smoothstep(uTown.z + ${TOWN_WOOD_MARGIN.toFixed(1)}, uTown.z + ${(TOWN_WOOD_MARGIN + TOWN_WOOD_FADE).toFixed(1)}, tTownD);
  float core = 1.0 - smoothstep(uTown.z * ${TOWN_CORE.toFixed(3)}, uTown.z * ${TOWN_CORE_FADE.toFixed(3)}, tTownD + 60.0 * sC.g);
  farmW *= 1.0 - core;
  float urbanW = 1.0 - smoothstep(uTown.z * ${TOWN_CORE.toFixed(3)}, uTown.z + 20.0, tTownD);
  tUrbanW = urbanW;
  if (urbanW > 0.001) {
    float g1 = texture(tNoise, rot2(tXZ, 0.7) * (1.0 / 31.0)).r + 0.5 * (texture(tNoise, rot2(tXZ, 1.9) * (1.0 / 7.0)).b - 0.5);
    float g2 = texture(tNoise, rot2(tXZ, 2.9) * (1.0 / 11.0)).g;
    // Gardens: lawns of uneven tone, shrubberies, hedges and garden trees' shade, paved yards.
    vec3 urban = meadow * vec3(0.95, 1.05, 0.9) * (0.8 + 0.4 * texture(tNoise, rot2(tXZ, 4.4) * (1.0 / 17.0)).a);
    urban = mix(urban, vec3(0.022, 0.034, 0.015), smoothstep(0.44, 0.62, g1) * 0.8);
    urban = mix(urban, vec3(0.11, 0.104, 0.094) * (0.85 + 0.3 * nC.a), smoothstep(0.6, 0.78, g2) * 0.5 * core);
    meadow = mix(meadow, urban, urbanW);
  }
}
// River: the bed under the water, muddy and gravelly banks, then a strip of rough grass, reeds and tall herbs
// (the bankside trees stand in it) before the fields begin. vRiver.x interpolates linearly across the
// channel, so the banks are placed right even on coarse tiles.
float tRiverBank = 0.0;
float tRiverBed = 0.0;
if (vRiver.y > 1.0) {
  float rEdge = abs(vRiver.x) - vRiver.y;
  if (rEdge < ${(RIVER_STRIP + 24).toFixed(1)}) {
    float rFw = max(fwidth(vRiver.x), 0.05);
    float bankW = 2.5 + 0.08 * vRiver.y;
    float rN = 2.0 * sD.r + 1.2 * sC.g;
    tRiverBed = 1.0 - smoothstep(-rFw, rFw, rEdge + 0.5 * sD.b);
    tRiverBank = 1.0 - smoothstep(bankW - rFw, bankW + 1.5 + rFw, rEdge - rN);
    float strip = 1.0 - smoothstep(${RIVER_STRIP.toFixed(1)}, ${(RIVER_STRIP + 16).toFixed(1)}, rEdge + 5.0 * sC.g + 3.0 * sD.a);
    farmW *= 1.0 - strip;
    // Rough bankside vegetation: tussocky, olive and dark, with pale reed beds at the water's edge.
    float reeds = (1.0 - smoothstep(bankW + 1.0, bankW + 6.0, rEdge + 2.0 * sD.g)) * smoothstep(0.45, 0.6, nC.r);
    vec3 rough = mix(vec3(0.040, 0.060, 0.022), vec3(0.075, 0.078, 0.036), smoothstep(0.3, 0.7, nD.g)) * (0.85 + 0.3 * sD.b);
    rough = mix(rough, vec3(0.11, 0.105, 0.05), reeds * 0.7);
    meadow = mix(meadow, rough, strip);
  }
}
float landW = 1.0 - sandW;
// Farmland first (its colour and weight; the ground layer is sampled below, shared with the meadow).
float farmWeight = 0.0;
float farmSoil = 0.0;
vec3 fieldCol = vec3(0.0);
if (farmW > 0.001) {
  Parcel pc = parcelAt(vec2(tP.x, -tP.z));
  float soil, rows, passW;
  // Regional grassland share, evaluated at the parcel centre so a parcel is all crop or all pasture.
  float region = texture(tNoise, vec2(pc.centre.x, -pc.centre.y) * (1.0 / 5200.0)).g;
  float pasture = clamp(0.4 + 1.1 * (region - 0.5), 0.15, 0.9);
  vec3 crop = cropColor(pc.id, pasture, soil, rows, passW);
  // Parcels in and at the edge of the town: paddocks, pasture and gardens only (no crops, no hedgerows).
  float townParcel = step(length(pc.centre - uTown.xy), uTown.z + ${TOWN_PARCEL_MARGIN.toFixed(1)}) * uTown.w;
  if (townParcel > 0.5) {
    float k = fract(pc.id * 7.31);
    vec3 grass = k < 0.45 ? vec3(0.046, 0.078, 0.029) : k < 0.8 ? vec3(0.060, 0.086, 0.034) : vec3(0.085, 0.092, 0.045);
    crop = mix(grass * (0.8 + 0.4 * fract(pc.id * 17.0)), meadow, 0.3 + 0.6 * tUrbanW);
    soil = 0.0;
    rows = 0.0;
    passW = 0.0;
  }
  // Within-field variation: patches of soil moisture, growth and weeds, sampled in the parcel's own frame
  // with a per-parcel offset (neighbouring fields differ), plus a gentle gradient across the field. Bare
  // soil shows it most: wet hollows dark, dry crests pale.
  vec2 lp = pc.local + pc.id * vec2(5731.0, 2917.0);
  float patches = (texture(tNoise, lp * (1.0 / 330.0)).r - 0.5) * 1.6 + (texture(tNoise, lp * (1.0 / 91.0)).g - 0.5) * 1.1;
  crop *= 1.0 + mix(0.16, 0.3, soil) * patches + 0.06 * sD.a;
  float ga = pc.id * 40.0;
  crop *= 1.0 + 0.16 * dot(vec2(cos(ga), sin(ga)), pc.local / pc.size - 0.5);
  // Rows run along the parcel's columns: world direction (east, north) = (-sin a, cos a); three.js xz.
  vec2 rowDir = vec2(-sin(pc.angle), -cos(pc.angle));
  vec3 tV = normalize(cameraPosition - tP);
  float vAlong = dot(tV.xz, rowDir) / max(length(tV.xz), 1e-4);
  float oblique = 1.0 - 0.6 * clamp(tV.y, 0.0, 1.0);
  // Headlands: a band along both ends of the field where the machines turned, worked across the rows.
  float headW = 12.0 + 12.0 * fract(pc.id * 13.1);
  float head = 1.0 - smoothstep(headW - 1.0, headW + 1.0, min(pc.local.y, pc.size.y - pc.local.y));
  if (rows > 0.0) {
    // Directional reflectance of row crops: looking along the rows shows the shaded gaps between them,
    // across them only the lit tops - so fields of different orientation differ in tone with the view.
    float along = mix(abs(vAlong), sqrt(max(0.0, 1.0 - vAlong * vAlong)), head);
    crop *= 1.0 + mix(0.12, 0.2, soil) * (0.5 - along) * oblique;
    // Machine passes: each pass leaves the crop (or the tilth) leaning or rolled its own way, so alternate
    // passes look lighter and darker seen along them (like mowing stripes) - the striping of fields seen
    // from the air, visible for kilometres.
    float wave = passW > 0.0 ? mix(passWave(pc.local.x / passW), passWave(pc.local.y / passW), head) : 0.0;
    float dirSign = mix(vAlong, sqrt(max(0.0, 1.0 - vAlong * vAlong)), head);
    crop *= 1.0 + 0.1 * wave * dirSign * oblique;
    // Compaction on the headland: denser, darker soil; thinner crop.
    crop *= 1.0 - 0.1 * head;
  }
  // Fine row texture along the columns: tramlines for cereals, furrows for ploughed land, maize rows,
  // mowing swaths on cut meadows (they fade to their mean coverage with distance).
  float alongX = mix(pc.local.x, pc.local.y, step(0.5, head));
  if (rows == 1.0) crop = mix(crop, crop * 0.55 + vec3(0.03, 0.025, 0.015), stripe(alongX / 18.0, 0.028) * 0.85);
  if (rows == 2.0) crop *= 0.75 + 0.5 * stripe(alongX / 0.8, 0.25);
  if (rows == 3.0) crop = mix(crop, vec3(0.040, 0.085, 0.026) * (0.9 + 0.2 * sD.a), stripe(alongX / 0.75, 0.22) * 0.9);
  if (rows == 4.0) crop *= 0.9 + 0.22 * stripe(alongX / 6.0, 0.12);
  // Margins: grass strip at every edge, hedgerows (dark, lumpy) and tracks (bare packed soil).
  // Pixel footprint on the ground, m (the edge bands below are filtered over it).
  float edgeFw = max(fwidth(tXZ.x), fwidth(tXZ.y));
  float mEnd = 2.2 + 0.8 * sD.r;
  float margin = bandCover(pc.margin, 0.5 * (1.2 + mEnd), mEnd - 1.2, edgeFw);
  fieldCol = mix(crop, meadow * 1.1, margin);
  float track = bandCover(pc.track, 1.8, 0.8, edgeFw) * (1.0 - townParcel);
  fieldCol = mix(fieldCol, vec3(0.17, 0.135, 0.095) * (0.8 + 0.3 * sD.g), track);
  // No hedgerows where no trees may grow (the obstacle-free airfield surroundings): plain margins there.
  float hEnd = 3.5 + 1.5 * sD.b;
  float hedge = bandCover(pc.hedge, 0.5 * (1.5 + hEnd), hEnd - 1.5, edgeFw) * step(0.25, nD.r) * smoothstep(0.97, 0.995, airportBlendAt(tRw)) * (1.0 - townParcel);
  fieldCol = mix(fieldCol, vec3(0.022, 0.038, 0.014), hedge);
  farmWeight = farmW * landW;
  farmSoil = soil;
  landW *= 1.0 - farmW;
}

if (forestW > 0.001) {
  // Near: forest floor under the instanced trees. Beyond: the canopy shell, tree crowns seen from above.
  float canopy = smoothstep(uForestFade.x, uForestFade.y, tDist);
  // Shaded understorey: litter, moss and low growth. Seen from beyond a few tree spacings the floor shows
  // only through gaps in the crowns, where it lies in their shade: darker with distance.
  vec3 floorCol = vec3(0.036, 0.042, 0.022) * (0.8 + 0.3 * sD.r) * mix(1.0, 0.4, smoothstep(25.0, 90.0, tDist));
  Mat ff = Mat(vec3(1.0), vec2(0.0), 0.9, 1.0, 0.5);
  if (canopy < 0.999) ff = layerTop(${LAYER.forest}, tXZ, tDist);
  Mat fo = ff;
  fo.albedo = floorCol * ff.albedo;
  if (canopy > 0.001) {
    Mat cm = canopyLayer(tXZ, nC.b);
    // Forest edges: where the canopy shell rises steeply over the ground it is the wall of foliage at the
    // edge of the stand. Shade it with the facet normal (so it faces the sun or not) and a side projection
    // of the crowns instead of the stretched top texture.
    vec3 facetN = normalize(cross(dFdx(vTerrainPos), dFdy(vTerrainPos)));
    facetN *= sign(facetN.y + 1e-5);
    float wall = smoothstep(0.15, 0.45, tN.y - facetN.y);
    if (wall > 0.001) {
      vec2 side = normalize(facetN.xz + 1e-5);
      Mat cw = canopyLayer(vec2(dot(tXZ, vec2(-side.y, side.x)), tH * 1.6), nC.b);
      // Seen from the side a stand's edge is foliage over deep shade (and the wall is one coarse triangle
      // tall, so keep its facet's light-dark contrast low or it reads as panels).
      cw.albedo *= 0.5;
      cm.albedo = mix(cm.albedo, cw.albedo, wall);
      cm.cavity = mix(cm.cavity, cw.cavity, wall);
      // The wall's own orientation, expressed as a tilt of the smooth terrain normal.
      cm.slope = mix(cm.slope, (facetN.xz / max(facetN.y, 0.25) - tN.xz / tN.y) * 0.4 + cw.slope * 0.5, wall);
    }
    // Stands: conifers (darker, bluer) with altitude and in planted blocks, broadleaf lighter and yellower;
    // stands of different age and species make the patchwork seen from the air.
    float conifer = smoothstep(0.35, 0.65, smoothstep(400.0, 1300.0, tH + 300.0 * sB.r) + 0.45 * sB.b);
    // Closed canopy seen from above is far darker than grassland (deep shade between the crowns): spruce
    // and fir stands nearly black-green, broadleaf woods a little lighter and yellower.
    vec3 tint = mix(vec3(0.9, 0.92, 0.86), vec3(0.56, 0.62, 0.62), conifer);
    tint *= 0.78 + 0.2 * sC.b + 0.14 * sB.g + 0.1 * sD.a;
    // Stand structure that survives distance (crown clusters, gaps, height classes, a few tens of metres
    // across), as tone and as relief the sun picks out; the crown texture itself filters away beyond ~1 km.
    vec4 nS = texture(tNoise, rot2(tXZ, 1.3) * (1.0 / 37.0));
    vec4 nT = texture(tNoise, rot2(tXZ, 3.7) * (1.0 / 13.0));
    tint *= mix(1.0, 0.72 + 0.34 * nS.r + 0.22 * nT.g, tFarForest);
    cm.slope += ((nS.zw - 0.5) * 1.3 + (nT.xy - 0.5) * 0.8) * tFarForest;
    // Canopy hot spot: looking down-sun the crowns hide their own shadows and the canopy brightens; toward
    // the sun the shaded sides and gaps show (Hapke-style shadow hiding, about 0.3 rad wide).
    if (tSunW.y > 0.0) {
      float phase = acos(clamp(dot(normalize(cameraPosition - tP), tSunW), -1.0, 1.0));
      tint *= mix(1.0, 0.84 + 0.45 * exp(-phase / 0.3), tFarForest);
    }
    // Where the impostors stand at full density the shell is the lower canopy between their crowns, mostly
    // in their shade; as they thin out with distance it becomes the canopy's sunlit top itself.
    float keep = uCanopyKeep.w > 0.5 ? min(1.0, pow(uCanopyKeep.x / max(tDist, 1.0), 1.5)) * (1.0 - smoothstep(uCanopyKeep.y, uCanopyKeep.z, tDist)) : 0.0;
    fo.albedo = mix(fo.albedo, cm.albedo * tint * mix(1.12, 0.8, keep), canopy);
    tFoliageW = canopy * forestW * landW;
    fo.slope = mix(ff.slope, cm.slope, canopy);
    fo.rough = mix(ff.rough, cm.rough, canopy);
    fo.cavity = mix(ff.cavity, cm.cavity, canopy);
  }
  addMat(acc, Mat(vec3(1.0), fo.slope, fo.rough, fo.cavity, fo.height), fo.albedo, forestW * landW);
  landW *= 1.0 - forestW;
}

// Forest edges where the canopy shell no longer stands up (coarse tiles, a few km out) and so casts no real
// shadow: the edge's distance and direction from the land-cover gradient, the fields beside a stand in its
// shadow on the side away from the sun (tree height / tan(sun elevation)), and a sunlit rim of crowns on
// the side facing it.
float tEdgeShade = 1.0;
if (tFarForest > 0.0 && tSunW.y > 0.02 && vLiftK < 0.999 && tBio.x > 0.02 && tBio.x < 0.98) {
  vec2 dpx = dFdx(tXZ);
  vec2 dpy = dFdy(tXZ);
  float fx = dFdx(tBio.x);
  float fy = dFdy(tBio.x);
  float det = dpx.x * dpy.y - dpx.y * dpy.x;
  if (abs(det) > 1e-6) {
    vec2 G = vec2(dpy.y * fx - dpx.y * fy, -dpy.x * fx + dpx.x * fy) / det;
    float gl = length(G);
    if (gl > 1e-5) {
      vec2 gd = G / gl;
      vec2 sunH = normalize(tSunW.xz + 1e-5);
      float toward = dot(gd, sunH);
      // Signed distance to the edge, m: + outside the stand.
      float dEdge = (0.42 - (forestE - 0.08 * fineN)) / gl;
      float fakeW = (1.0 - vLiftK) * tFarForest;
      float shadowLen = 17.0 * sqrt(max(1.0 - tSunW.y * tSunW.y, 0.0)) / tSunW.y;
      float pix = max(length(dpx), length(dpy));
      if (toward > 0.0 && dEdge > 0.0) {
        float reach = min(shadowLen, 400.0) * toward;
        float sh = 1.0 - smoothstep(reach * 0.6, reach + pix, dEdge);
        tEdgeShade = 1.0 - 0.55 * sh * fakeW;
      } else if (toward < 0.0 && dEdge < 0.0) {
        float rim = (1.0 - smoothstep(0.0, 5.0 + pix, -dEdge)) * -toward;
        tEdgeShade = 1.0 + 0.45 * rim * fakeW;
      }
    }
  }
}

// Ground layers, each sampled only where it shows: grass under the meadow and the grassy parcels, soil
// under bare and row-crop parcels.
float grassW = landW + (farmSoil < 0.5 ? farmWeight : 0.0);
if (grassW > 0.001) {
  Mat grass = layerTop(${LAYER.grass}, tXZ, tDist);
  if (farmSoil < 0.5) addMat(acc, grass, fieldCol, farmWeight);
  addMat(acc, grass, meadow, landW);
}
if (farmSoil > 0.5 && farmWeight > 0.001) addMat(acc, layerTop(${LAYER.soil}, tXZ, tDist), fieldCol, farmWeight);
if (sandW > 0.001) addMat(acc, layerTop(${LAYER.sand}, tXZ, tDist), vec3(0.38, 0.33, 0.24) * (0.9 + 0.1 * sC.b), sandW);

acc.albedo *= tEdgeShade;
// Wet ground by water: darker and smoother.
acc.albedo *= 1.0 - 0.35 * wet;
acc.rough *= 1.0 - 0.3 * wet;

// River banks and bed: wet silt and gravel, darker and smoother toward the water.
if (tRiverBank > 0.001) {
  Mat g = layerTop(${LAYER.gravel}, tXZ, tDist);
  vec3 mud = mix(vec3(0.045, 0.040, 0.030), vec3(0.075, 0.068, 0.055) * g.albedo, smoothstep(0.6, 0.8, nD.b + 0.3 * g.height));
  mud = mix(mud, vec3(0.034, 0.031, 0.025), tRiverBed);
  acc.albedo = mix(acc.albedo, mud, tRiverBank);
  acc.slope = mix(acc.slope, g.slope * 0.5, tRiverBank);
  acc.rough = mix(acc.rough, 0.45, tRiverBank);
  acc.cavity = mix(acc.cavity, 1.0, tRiverBank);
  tFoliageW *= 1.0 - tRiverBank;
}

// --- Scree, rock and snow cover the land, with height-aware transitions ---
if (screeW > 0.001) {
  Mat g = layerTop(${LAYER.gravel}, tXZ, tDist);
  vec3 base = vec3(0.15, 0.145, 0.135) * (0.85 + 0.25 * sB.g);
  float w = clamp(screeW * (0.6 + g.height) - 0.1, 0.0, 1.0);
  acc.albedo = mix(acc.albedo, base * g.albedo, w);
  acc.slope = mix(acc.slope, g.slope, w);
  acc.rough = mix(acc.rough, g.rough, w);
  acc.cavity = mix(acc.cavity, g.cavity, w);
}
if (rockW > 0.001) {
  Mat r = layerCliff(${LAYER.rock}, tP, tN, tDist);
  // Sedimentary strata: warped horizontal bands of varying tone with darker bedding planes.
  float sc = tH / 9.0 + sB.r * 5.0 + sC.g * 1.5 + sD.b * 0.3;
  float band = fract(sc);
  float bandRnd = hash2f(int(floor(sc)), 91);
  vec3 tint = mix(vec3(0.86, 0.86, 0.86), vec3(1.08, 1.04, 0.98), bandRnd);
  // Bedding planes: faint, of irregular strength, fading where the band noise says the bed is massive.
  float bed = mix(mix(0.8, 1.0, fract(bandRnd * 7.3)), 1.0, smoothstep(0.0, 0.05, band) * smoothstep(1.0, 0.95, band));
  // Alpine rock is grey (limestone lighter, schists and granite darker), weathered darker on its surface:
  // weathered limestone and gneiss have a warm, yellow-brown cast (a neutral grey hazes to lilac under the
  // blue sky light and aerial perspective).
  vec3 base = mix(vec3(0.098, 0.089, 0.075), vec3(0.19, 0.174, 0.148), nA.g) * tint * bed * (0.78 + 0.3 * nC.a);
  // Weathering streaks down the fall line (water and lichen stains): noise stretched along the slope.
  vec2 fall = normalize(tN.xz + 1e-4);
  vec2 across = vec2(-fall.y, fall.x);
  vec2 sq = vec2(dot(tXZ, across) / 11.0, dot(tXZ, fall) / 90.0);
  float streak = texture(tNoise, sq * 0.25).r;
  base *= mix(1.0, 0.62 + 0.55 * streak, smoothstep(0.85, 0.6, tUp));
  // Ribs and gullies down the fall line, tens of metres apart: relief the sun picks out (one side of each
  // rib lit, the other shaded) where the mesh is far too coarse to carry it, and darker, damper gullies.
  vec2 rq = vec2(dot(tXZ, across) / 38.0, dot(tXZ, fall) / 260.0);
  float ribA = texture(tNoise, rq + vec2(0.08, 0.0)).g;
  float ribB = texture(tNoise, rq - vec2(0.08, 0.0)).g;
  float rib = texture(tNoise, rq).g;
  vec2 ribSlope = across * (ribA - ribB) * 8.0 * smoothstep(0.9, 0.7, tUp);
  base *= 0.7 + 0.6 * rib;
  // Grassy ledges along the bedding (a few strata hold soil and turf on their tops): contour-following
  // green bands across the faces, fewer on the steepest walls.
  float lc = tH / 31.0 + sB.r * 3.0 + sC.g * 0.8;
  float ledgeRnd = hash2f(int(floor(lc)), 57);
  float ledge = step(ledgeRnd, 0.45) * smoothstep(0.1, 0.3, fract(lc)) * smoothstep(0.8, 0.6, fract(lc)) * smoothstep(0.5, 0.68, tUp + 0.08 * sD.r);
  // Height-aware edge, broken up by noise at two scales so outcrops have ragged, irregular outlines (the
  // rock texture's own relief alone gives a regular saw-tooth edge).
  float edgeH = 0.45 * r.height + 0.35 * nD.a + 0.2 * nC.g;
  float w = clamp(rockW * (0.65 + edgeH) - 0.15, 0.0, 1.0);
  // Below the alpine zone outcrops are darker (moss, lichen, soil in the joints) and partly grown over.
  base *= mix(vec3(0.74, 0.76, 0.66) + 0.1 * sD.b, vec3(1.0), alpine);
  w *= mix(0.8 + 0.2 * smoothstep(0.3, 0.7, r.height + 0.3 * sD.g), 1.0, alpine);
  w *= 1.0 - 0.75 * ledge * (1.0 - snowW);
  acc.albedo = mix(acc.albedo, base * r.albedo, w);
  // Rugged faces: meso-scale facets from the noise channels on top of the rock texture's own relief.
  vec2 facets = (nC.xy - 0.5) * 1.6 + (nD.zw - 0.5) * 1.0 + ribSlope;
  acc.slope = mix(acc.slope, r.slope * 1.4 + facets, w);
  acc.rough = mix(acc.rough, r.rough, w);
  acc.cavity = mix(acc.cavity, r.cavity, w);
  acc.height = mix(acc.height, r.height, w);
}
if (snowW > 0.001) {
  Mat s = layerTop(${LAYER.snow}, tXZ, tDist);
  // Snow fills hollows first: height-aware blend against whatever lies beneath.
  float w = clamp((snowW * 1.6 - 0.3) + (0.5 - acc.height) * 0.6, 0.0, 1.0);
  // Old summer snow (firn) is a little grey; fresh snow near 0.8.
  vec3 snowCol = vec3(0.74, 0.76, 0.80) * (0.92 + 0.08 * sC.g);
  // Glaciers: in the big hollows above the snow line the snow flows as ice. Its lower tongue is bare
  // blue-grey ice with dirty moraine edges; where it steepens it breaks into crevasses across the flow.
  float glacier = smoothstep(0.15, 0.55, concave + 0.25 * sB.a) * smoothstep(0.72, 0.85, tUp) * smoothstep(snowLine - 350.0, snowLine - 100.0, tH);
  if (glacier > 0.001) {
    float bare = 1.0 - smoothstep(snowLine - 100.0, snowLine + 200.0, tH + 80.0 * sC.r);
    vec3 ice = mix(vec3(0.42, 0.50, 0.56), vec3(0.30, 0.31, 0.31), smoothstep(0.55, 0.85, nD.b) * 0.7);
    vec2 flow = normalize(tN.xz + 1e-4);
    float crev = stripe(dot(tXZ, flow) / 9.0 + 0.6 * sD.a, 0.08) * smoothstep(0.93, 0.85, tUp);
    snowCol = mix(snowCol, ice, glacier * bare);
    snowCol *= 1.0 - 0.6 * crev * glacier;
    w = max(w, glacier * 0.95);
  }
  acc.albedo = mix(acc.albedo, snowCol * s.albedo, w);
  acc.slope = mix(acc.slope, s.slope, w);
  acc.rough = mix(acc.rough, s.rough, w);
  acc.cavity = mix(acc.cavity, 1.0, w);
}

diffuseColor.rgb = acc.albedo * mix(1.0, acc.cavity, 0.7);
#if TERRAIN_DEBUG == 1
diffuseColor.rgb = vec3(forestW, farmW, rockW) * 0.3;
#elif TERRAIN_DEBUG == 2
diffuseColor.rgb = vec3(tBio.x, tBio.y, snowW) * 0.3;
#elif TERRAIN_DEBUG == 3
diffuseColor.rgb = canopyLayer(tXZ, nC.b).albedo;
#endif
float tRough = clamp(acc.rough, 0.3, 1.0);
vec3 tNormalW = normalize(tN + vec3(acc.slope.x, 0.0, acc.slope.y) * 0.35);
#if TERRAIN_DEBUG == 4
// Unlit albedo (x4), written as emissive in the output patch below.
#endif
`;

/**
 * Shader detail level: 0 = single-scale near detail and top projection only (low quality), 1 = anti-tiled
 * near detail and a cliff projection for rock.
 */
export function setTerrainDetail(mat: THREE.MeshStandardMaterial, detail: 0 | 1): void {
  if (mat.defines?.TERRAIN_DETAIL === detail) return;
  mat.defines = { ...mat.defines, TERRAIN_DETAIL: detail };
  mat.needsUpdate = true;
}

/**
 * Debug views: 0 = off, 1 = land-cover weights (forest, farmland, rock as RGB), 2 = raw biome (forest, farmland,
 * snow), 3 = canopy layer albedo, 4 = unlit final albedo.
 */
export function setTerrainDebug(mat: THREE.MeshStandardMaterial, mode: number): void {
  mat.defines = { ...mat.defines, TERRAIN_DEBUG: mode };
  mat.needsUpdate = true;
}

/** The town site (townMask.ts) as the uTown uniform. */
export function townUniform(): THREE.Vector4 {
  const t = townSite();
  return t ? new THREE.Vector4(t.east, t.north, t.radius, 1) : new THREE.Vector4(0, 0, 0, 0);
}

export function createTerrainMaterial(tex: TerrainTextures, uniforms: TerrainUniforms): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 });
  mat.name = 'terrain';
  mat.defines = { TERRAIN_DETAIL: 1, TERRAIN_DEBUG: 0 };
  Object.assign(uniforms, {
    tNoise: { value: tex.noise },
    tDetailA: { value: tex.albedo },
    tDetailN: { value: tex.normal },
    uTile: { value: LAYER_TILE_M },
    uLayerMean: { value: tex.layerMeans },
    uLayerRough: { value: LAYER_ROUGHNESS },
    uRunway: {
      value: new THREE.Vector4(AIRPORT.runway.center.east, AIRPORT.runway.center.north, Math.cos(AIRPORT.runway.heading), Math.sin(AIRPORT.runway.heading)),
    },
    uRunwayDims: { value: new THREE.Vector4(AIRPORT.runway.length / 2, AIRPORT.runway.width / 2, AIRPORT.flatMargin, AIRPORT.blendDistance) },
    uFence: { value: new THREE.Vector4(FENCE_RECT.u0, FENCE_RECT.u1, FENCE_RECT.v0, FENCE_RECT.v1) },
    uTown: { value: townUniform() },
  });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERTEX_HEAD}`)
      .replace('#include <beginnormal_vertex>', VERTEX_NORMAL)
      .replace('#include <begin_vertex>', VERTEX_BEGIN);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAGMENT_HEAD}`)
      .replace('#include <map_fragment>', FRAGMENT_SPLAT)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = tRough;')
      .replace('#include <normal_fragment_maps>', 'normal = normalize((viewMatrix * vec4(tNormalW, 0.0)).xyz);')
      // Vegetated and rough ground: weaker grazing Fresnel than a smooth dielectric (no plastic sheen).
      .replace(
        '#include <lights_physical_fragment>',
        '#include <lights_physical_fragment>\nmaterial.specularF90 = mix(0.5, 0.15, tFoliageW);\nmaterial.specularColorBlended *= 1.0 - 0.6 * tFoliageW;',
      )
      // Debug view 4: unlit albedo, scaled to be visible under the scene's exposure.
      .replace('#include <opaque_fragment>', '#if TERRAIN_DEBUG == 4\noutgoingLight = diffuseColor.rgb * 4000.0;\n#endif\n#include <opaque_fragment>');
  };
  mat.customProgramCacheKey = () => `terrain-v5-${mat.defines?.TERRAIN_DETAIL}-${mat.defines?.TERRAIN_DEBUG}`;
  return mat;
}

/** Depth material for shadow casting with the same geomorph as the visible surface. */
export function createTerrainDepthMaterial(uniforms: TerrainUniforms): THREE.MeshDepthMaterial {
  const mat = new THREE.MeshDepthMaterial();
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERTEX_HEAD}`)
      .replace(
        '#include <begin_vertex>',
        `float tDrop;\nfloat tMorph = terrainMorph(position, tDrop);\nvec3 transformed = position;\ntransformed.y += aMorph * tMorph - tDrop;\ntransformed.y += canopyLift((modelMatrix * vec4(transformed, 1.0)).xyz, tMorph, tileLevel());`,
      );
    // Shadow maps are orthographic, where log depth is plain window depth: do not write gl_FragDepth
    // (it would disable early depth testing).
    shader.fragmentShader = shader.fragmentShader.replace('#include <logdepthbuf_fragment>', '');
  };
  mat.customProgramCacheKey = () => 'terrain-depth-v4';
  return mat;
}
