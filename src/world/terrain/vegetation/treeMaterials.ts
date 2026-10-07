// Materials for instanced trees. All are MeshStandardMaterial / MeshDepthMaterial patches, so trees are
// lit by the scene's sun and sky, receive shadows and use the log depth buffer like everything else.
//
// Instances come from two attributes (see VegetationSystem): aInstA = (east, ground height, north, tree
// height in m) and aInstB = (yaw, species + 0.99 * rank). The mesh itself sits at the origin.
//
// LOD hand-over is a short screen-door cross-fade: with the same per-pixel threshold, a near tree
// discards exactly the pixels its impostor keeps, so nothing pops and nothing is drawn twice. Far
// impostors are thinned by rank (a tree of rank r shrinks away where the kept fraction drops below r).

import * as THREE from 'three';
import { HEMI_OCT_GLSL, IMPOSTOR_FRAME, IMPOSTOR_GRID } from './impostors';
import { SPECIES_TINT, TREE_BOUND_RADIUS } from './treeModels';

export interface TreeUniforms {
  uTime: { value: number };
  /**
   * x, y: distances over which near meshes hand over to impostors; z, w: distances over which the
   * impostors thin out to nothing (full density inside z), m.
   */
  uFade: { value: THREE.Vector4 };
  /** Impostors keep full density to this distance, then thin as (d0/d)^1.5. */
  uDensityRange: { value: number };
  /** Viewer position (three.js world); in the shadow pass cameraPosition is the light's, so pass it. */
  uViewPos: { value: THREE.Vector3 };
  /** Near trees cast shadows only within this distance of the viewer, m. */
  uShadowRange: { value: number };
  /** Distances over which the full tree meshes (LOD 0) hand over to the reduced ones (LOD 1), m. */
  uLodFade: { value: THREE.Vector2 };
  [name: string]: { value: unknown };
}

const INSTANCE_GLSL = /* glsl */ `
attribute vec4 aInstA;
attribute vec2 aInstB;
uniform float uTime;
uniform vec4 uFade;
uniform float uDensityRange;
uniform vec3 uViewPos;
uniform float uShadowRange;
uniform vec3 uSpeciesTint[4];
varying float vFade;
varying vec3 vTint;
float treeSpecies() { return floor(aInstB.y); }
float treeRank() { return fract(aInstB.y) / 0.99; }
vec3 treeBase() { return vec3(aInstA.x, aInstA.y, -aInstA.z); }
vec3 treeTint() {
  float r = treeRank();
  // Per-tree variation: brightness, and a yellow/blue shift.
  vec3 t = uSpeciesTint[int(treeSpecies())] * (0.7 + 0.55 * fract(r * 37.13));
  return t * mix(vec3(1.12, 1.0, 0.75), vec3(0.88, 1.0, 1.12), fract(r * 91.7));
}
// Per-tree crown width relative to its height.
float treeWidth() { return 0.8 + 0.45 * fract(treeRank() * 13.71); }
vec3 rotY(vec3 p, float c, float s) { return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z); }
`;

// Foliage is a rough, porous scatterer: much weaker grazing-angle Fresnel than a smooth dielectric.
const FOLIAGE_SPECULAR = '#include <lights_physical_fragment>\nmaterial.specularF90 = 0.15;\nmaterial.specularColorBlended *= 0.4;';
// Sky light on foliage: the diffuse irradiance from the environment only. The specular environment lookup
// (two cube-map fetches per fragment, on many layers of foliage) adds nothing visible to rough leaves.
const FOLIAGE_IBL = /* glsl */ `
#if defined( RE_IndirectDiffuse ) && defined( USE_ENVMAP ) && defined( ENVMAP_TYPE_CUBE_UV )
iblIrradiance += getIBLIrradiance( geometryNormal );
#endif
`;
// A crown's outline is ragged and its leaves translucent, so it does not darken toward the silhouette like a
// solid sphere: lean the shading normal toward the viewer (view space +z) and up, which keeps sunlit and
// shaded sides but removes the dark outline ring.
const FOLIAGE_NORMAL = 'normal = normalize(normal + vec3(0.0, 0.0, 0.55) + 0.25 * (viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);';

/**
 * Logarithmic depth written from the vertex stage instead of per fragment. three's log depth writes
 * gl_FragDepth, which turns off early depth testing, so every covered layer of alpha-tested foliage was
 * fully shaded. Tree cards are small next to their distance, so interpolating the log depth across a card
 * is accurate to far below the spacing between cards and the ground; with it the GPU rejects hidden
 * foliage before shading (the instance lists are sorted front to back).
 */
export const VERTEX_LOG_DEPTH_PARS = /* glsl */ `
#ifdef USE_LOGARITHMIC_DEPTH_BUFFER
uniform float logDepthBufFC;
#endif
`;
export const VERTEX_LOG_DEPTH = /* glsl */ `
#ifdef USE_LOGARITHMIC_DEPTH_BUFFER
if (isPerspectiveMatrix(projectionMatrix)) gl_Position.z = (log2(max(1e-6, 1.0 + gl_Position.w)) * logDepthBufFC - 1.0) * gl_Position.w;
#endif
`;

/** Apply vertex-stage log depth to a patched shader (see VERTEX_LOG_DEPTH). */
export function useVertexLogDepth(shader: { vertexShader: string; fragmentShader: string }): void {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${VERTEX_LOG_DEPTH_PARS}`)
    .replace('#include <logdepthbuf_vertex>', VERTEX_LOG_DEPTH);
  shader.fragmentShader = shader.fragmentShader.replace('#include <logdepthbuf_fragment>', '');
}

const DITHER_GLSL = /* glsl */ `
varying float vFade;
// Interleaved gradient noise (Jimenez 2014): a stable per-pixel threshold in [0, 1).
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
`;

const NEAR_BEGIN = /* glsl */ `
float tH = aInstA.w;
float tc = cos(aInstB.x), ts = sin(aInstB.x);
vec3 tp = position * tH;
tp.xz *= treeWidth();
// Wind sway grows with the square of the height above the base.
float sway = position.y * position.y * tH * 0.012;
float ph = treeRank() * 40.0;
tp.x += sway * sin(uTime * 1.3 + ph);
tp.z += sway * cos(uTime * 1.1 + ph * 1.7);
vec3 transformed = rotY(tp, tc, ts) + treeBase();
vFade = smoothstep(uFade.x, uFade.y, distance(treeBase(), cameraPosition));
`;
// Mesh LODs: LOD 0 hands over to LOD 1 over uLodFade with the same complementary screen-door dither as the
// hand-over to impostors (the two bands do not overlap). Trees wholly handed over (the instance lists keep
// a margin beyond each band) are dropped in the vertex stage rather than rasterised and discarded.
const LOD_VERTEX = /* glsl */ `
uniform vec2 uLodFade;
varying float vLod;
`;
const NEAR_CULL = /* glsl */ `
vLod = smoothstep(uLodFade.x, uLodFade.y, distance(treeBase(), cameraPosition));
#if TREE_LOD == 0
if (vFade >= 1.0 || vLod >= 1.0) transformed = vec3(0.0, -1e6, 0.0);
#else
if (vFade >= 1.0 || vLod <= 0.0) transformed = vec3(0.0, -1e6, 0.0);
#endif
`;
// With MSAA (medium and above) the fades are alpha-to-coverage: a smooth dissolve, and antialiased leaf
// edges from the alpha test. Without it, a screen-door dither with complementary thresholds.
const NEAR_DISCARD = /* glsl */ `
#ifdef ALPHA_TO_COVERAGE
#if TREE_LOD == 0
diffuseColor.a *= 1.0 - max(vFade, vLod);
#else
diffuseColor.a *= min(vLod, 1.0 - vFade);
#endif
if (diffuseColor.a <= 0.0) discard;
#else
float tDither = ign(gl_FragCoord.xy);
#if TREE_LOD == 0
if (tDither < max(vFade, vLod)) discard;
#else
if (tDither < vFade || tDither >= vLod) discard;
#endif
#endif
`;

/** Uniforms every tree material reads besides TreeUniforms. */
function speciesTint(): { uSpeciesTint: { value: THREE.Vector3[] } } {
  return { uSpeciesTint: { value: SPECIES_TINT.map((t) => new THREE.Vector3(...t)) } };
}

export function createNearTreeMaterial(foliage: THREE.Texture, uniforms: TreeUniforms, lod: 0 | 1 = 0): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    map: foliage,
    alphaTest: 0.5,
    vertexColors: true,
    side: THREE.DoubleSide,
    roughness: 0.85,
    metalness: 0,
  });
  mat.name = `tree-lod${lod}`;
  mat.defines = { TREE_LOD: lod };
  const tint = speciesTint();
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms, tint);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${INSTANCE_GLSL}\n${LOD_VERTEX}`)
      .replace(
        '#include <beginnormal_vertex>',
        'vec3 objectNormal = rotY(normal, cos(aInstB.x), sin(aInstB.x));\n#ifdef USE_TANGENT\nvec3 objectTangent = vec3(tangent.xyz);\n#endif',
      )
      .replace('#include <begin_vertex>', `${NEAR_BEGIN}\n${NEAR_CULL}\nvTint = treeTint();`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${DITHER_GLSL}\nvarying vec3 vTint;\nvarying float vLod;`)
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= vTint;')
      .replace('#include <alphatest_fragment>', `#include <alphatest_fragment>\n${NEAR_DISCARD}`)
      // Cards are double-sided but their normals describe the crown volume: undo three's back-face flip.
      .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>\nnormal *= faceDirection;\n${FOLIAGE_NORMAL}`)
      .replace('#include <lights_physical_fragment>', FOLIAGE_SPECULAR)
      .replace('#include <lights_fragment_maps>', FOLIAGE_IBL);
    useVertexLogDepth(shader);
  };
  mat.customProgramCacheKey = () => `tree-near-v6-${lod}`;
  return mat;
}

/**
 * Materials for the shadow proxies (treeModels.ts createShadowProxies): `main` draws nothing (every vertex
 * is dropped, so the proxies cost a few vertices in the camera pass), `depth` casts the proxy into the
 * shadow maps with the same instancing and sway as the tree, near the viewer only and not into the
 * coarsest cascades.
 */
export function createShadowProxyMaterials(uniforms: TreeUniforms): { main: THREE.Material; depth: THREE.MeshDepthMaterial } {
  const main = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
  main.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', 'vec3 transformed = vec3(0.0, -1e6, 0.0);');
  };
  main.customProgramCacheKey = () => 'tree-proxy-main-v1';
  const depth = new THREE.MeshDepthMaterial();
  depth.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${INSTANCE_GLSL}`)
      .replace(
        '#include <begin_vertex>',
        `${NEAR_BEGIN}\nfloat viewDist = distance(treeBase(), uViewPos);\nif (viewDist > uShadowRange || projectionMatrix[0][0] < 0.001) transformed = vec3(0.0, -1e6, 0.0);`,
      );
    shader.fragmentShader = shader.fragmentShader.replace('#include <logdepthbuf_fragment>', '');
  };
  depth.customProgramCacheKey = () => 'tree-proxy-depth-v1';
  return { main, depth };
}

const IMPOSTOR_VERTEX_HEAD = /* glsl */ `
${INSTANCE_GLSL}
${HEMI_OCT_GLSL}
varying vec2 vImpUv;
varying vec2 vGrid;
varying float vSpecies;
varying float vYawC;
varying float vYawS;
`;

const IMPOSTOR_BEGIN = /* glsl */ `
float tH = aInstA.w;
float tc = cos(aInstB.x), ts = sin(aInstB.x);
vec3 centre = treeBase() + vec3(0.0, 0.5 * tH, 0.0);
// Trees stand on the exact heightfield, while distant terrain is a coarser mesh that can lie a metre or
// two above or below it: sink far impostors a little, since a buried trunk base is invisible and a
// floating one is not.
centre.y -= clamp((distance(centre, cameraPosition) - 800.0) * 0.0008, 0.0, 2.5);
vec3 toCam = cameraPosition - centre;
float dist = length(toCam);
vec3 d = toCam / dist;
// View direction in the tree's own frame (undo its yaw), kept in the baked upper hemisphere.
vec3 dl = vec3(tc * d.x - ts * d.z, max(d.y, 0.02), ts * d.x + tc * d.z);
vec2 e = hemiOctEncode(normalize(dl));
vGrid = clamp((e * 0.5 + 0.5) * ${IMPOSTOR_GRID.toFixed(1)} - 0.5, 0.0, ${(IMPOSTOR_GRID - 1).toFixed(1)});
// Keep full density to uDensityRange, then thin as (d0/d)^1.5; the kept trees grow a little to cover.
// A tree leaving the kept fraction shrinks away rather than dithering out (no noise without TAA).
float keep = min(1.0, pow(uDensityRange / max(dist, 1.0), 1.5)) * (1.0 - smoothstep(uFade.z, uFade.w, dist));
float thin = smoothstep(0.0, 1.0, clamp((keep - treeRank()) * 8.0, 0.0, 1.0));
float grow = (1.0 + 0.5 * (1.0 - sqrt(clamp(keep, 0.0, 1.0)))) * thin;
// Hand-over from the near mesh: the complement of its dither.
vFade = thin > 0.0 ? smoothstep(uFade.x, uFade.y, dist) : 0.0;
vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), d));
vec3 up = cross(d, right);
float R = ${TREE_BOUND_RADIUS.toFixed(3)} * tH * grow;
// Crown width variation stretches the quad sideways (exact for side views, close enough from above).
vec3 transformed = centre + (right * position.x * treeWidth() + up * position.y) * R + d * (0.2 * tH);
vImpUv = position.xy * 0.5 + 0.5;
vSpecies = treeSpecies();
vYawC = tc;
vYawS = ts;
vTint = treeTint();
if (vFade <= 0.0) transformed = vec3(0.0, -1e6, 0.0);
`;

const IMPOSTOR_FRAGMENT_HEAD = /* glsl */ `
${DITHER_GLSL}
uniform sampler2D tImpAlbedo;
uniform sampler2D tImpNormal;
varying vec2 vImpUv;
varying vec2 vGrid;
varying float vSpecies;
varying float vYawC;
varying float vYawS;
varying vec3 vTint;
vec2 frameUv(vec2 frame) {
  vec2 quadrant = vec2(mod(vSpecies, 2.0), floor(vSpecies / 2.0));
  // Inset by half a texel so bilinear filtering stays inside the frame.
  vec2 uv = clamp(vImpUv, 0.5 / ${IMPOSTOR_FRAME.toFixed(1)}, 1.0 - 0.5 / ${IMPOSTOR_FRAME.toFixed(1)});
  return (quadrant * ${IMPOSTOR_GRID.toFixed(1)} + frame + uv) / ${(2 * IMPOSTOR_GRID).toFixed(1)};
}
`;

const IMPOSTOR_FRAGMENT_MAIN = /* glsl */ `
// Albedo and coverage blend the four frames around the view direction (bilinear in the frame grid); the
// normal comes from the dominant frame only, fetched after the alpha test.
vec2 g0 = floor(vGrid);
vec2 gf = vGrid - g0;
vec2 g1 = min(g0 + 1.0, ${(IMPOSTOR_GRID - 1).toFixed(1)});
vec4 w = vec4((1.0 - gf.x) * (1.0 - gf.y), gf.x * (1.0 - gf.y), (1.0 - gf.x) * gf.y, gf.x * gf.y);
vec2 u00 = frameUv(g0), u10 = frameUv(vec2(g1.x, g0.y)), u01 = frameUv(vec2(g0.x, g1.y)), u11 = frameUv(g1);
vec4 alb = texture2D(tImpAlbedo, u00) * w.x + texture2D(tImpAlbedo, u10) * w.y + texture2D(tImpAlbedo, u01) * w.z + texture2D(tImpAlbedo, u11) * w.w;
// Mipmapping averages alpha toward the foliage coverage; sharpen it so distant crowns do not thin out.
float fw = length(fwidth(vImpUv)) * ${IMPOSTOR_FRAME.toFixed(1)};
float a = alb.a * (1.0 + 0.3 * log2(max(fw, 1.0)));
#ifdef ALPHA_TO_COVERAGE
// Antialiased silhouette and a smooth hand-over from the near meshes, as coverage.
diffuseColor.a = smoothstep(0.5, 0.5 + max(fwidth(a), 1e-3), a) * vFade;
if (diffuseColor.a <= 0.0) discard;
#else
if (a < 0.5 || ign(gl_FragCoord.xy) >= vFade) discard;
#endif
vec2 un = w.x >= max(w.y, max(w.z, w.w)) ? u00 : w.y >= max(w.z, w.w) ? u10 : w.z >= w.w ? u01 : u11;
vec4 nrm = texture2D(tImpNormal, un);
// Transparent texels were cleared to a foliage colour, so straight (non-premultiplied) filtering is fine.
diffuseColor.rgb = pow(alb.rgb, vec3(2.2)) * vTint;
vec3 nl = normalize(nrm.xyz * 2.0 - 1.0);
vec3 impNormalW = vec3(vYawC * nl.x + vYawS * nl.z, nl.y, -vYawS * nl.x + vYawC * nl.z);
`;

export function createImpostorMaterial(albedo: THREE.Texture, normal: THREE.Texture, uniforms: TreeUniforms): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0 });
  mat.name = 'tree-impostor';
  const extra = { ...speciesTint(), tImpAlbedo: { value: albedo }, tImpNormal: { value: normal } };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms, extra);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${IMPOSTOR_VERTEX_HEAD}`)
      .replace('#include <begin_vertex>', IMPOSTOR_BEGIN);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${IMPOSTOR_FRAGMENT_HEAD}`)
      .replace('#include <map_fragment>', IMPOSTOR_FRAGMENT_MAIN)
      .replace('#include <normal_fragment_maps>', `normal = normalize((viewMatrix * vec4(impNormalW, 0.0)).xyz);\n${FOLIAGE_NORMAL}`)
      .replace('#include <lights_physical_fragment>', FOLIAGE_SPECULAR)
      .replace('#include <lights_fragment_maps>', FOLIAGE_IBL);
    useVertexLogDepth(shader);
  };
  mat.customProgramCacheKey = () => 'tree-impostor-v5';
  return mat;
}

/**
 * Shadows of the impostors: in the shadow pass each impostor is a billboard facing the light, alpha-tested
 * against the atlas frame seen from the light's direction - the tree's own silhouette seen from the sun,
 * so the shadow on the ground has the tree's shape and length. It covers the trees beyond the shadow proxies
 * (uShadowRange), with the same distance thinning as the visible impostors, and only in cascades fine
 * enough for a tree to show (texels up to about 8 m: at low sun a 15 m tree's shadow is over 150 m long).
 */
export function createImpostorDepthMaterial(albedo: THREE.Texture, uniforms: TreeUniforms): THREE.MeshDepthMaterial {
  const mat = new THREE.MeshDepthMaterial({ side: THREE.DoubleSide });
  mat.name = 'impostor-depth';
  const extra = { tImpAlbedo: { value: albedo } };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms, extra);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${INSTANCE_GLSL}\n${HEMI_OCT_GLSL}\nvarying vec2 vImpUv;\nvarying vec2 vFrame;\nvarying float vSpecies;`)
      .replace('#include <begin_vertex>', IMPOSTOR_SHADOW_BEGIN);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform sampler2D tImpAlbedo;\nvarying vec2 vImpUv;\nvarying vec2 vFrame;\nvarying float vSpecies;`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n${IMPOSTOR_SHADOW_FRAGMENT}`)
      .replace('#include <logdepthbuf_fragment>', '');
  };
  mat.customProgramCacheKey = () => 'tree-impostor-depth-v2';
  return mat;
}

const IMPOSTOR_SHADOW_BEGIN = /* glsl */ `
vec3 transformed = vec3(0.0, -1e6, 0.0);
vImpUv = vec2(0.0);
vFrame = vec2(0.0);
vSpecies = 0.0;
float tH = aInstA.w;
// Orthographic (sun) cascades only, and only those whose half-width is under 8 km.
bool sunCascade = projectionMatrix[3][3] == 1.0 && projectionMatrix[0][0] > 1.0 / 8000.0;
vec3 centre = treeBase() + vec3(0.0, 0.5 * tH, 0.0);
float dist = distance(centre, uViewPos);
if (tH > 0.0 && sunCascade && dist > uShadowRange) {
  // The visible impostors' thinning (IMPOSTOR_BEGIN), by the distance from the viewer.
  float keep = min(1.0, pow(uDensityRange / max(dist, 1.0), 1.5)) * (1.0 - smoothstep(uFade.z, uFade.w, dist));
  float thin = smoothstep(0.0, 1.0, clamp((keep - treeRank()) * 8.0, 0.0, 1.0));
  if (thin > 0.0) {
    float grow = (1.0 + 0.5 * (1.0 - sqrt(clamp(keep, 0.0, 1.0)))) * thin;
    centre.y -= clamp((dist - 800.0) * 0.0008, 0.0, 2.5);
    // Toward the light: the shadow camera's +z axis.
    vec3 d = normalize(vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]));
    float tc = cos(aInstB.x), ts = sin(aInstB.x);
    vec3 dl = vec3(tc * d.x - ts * d.z, max(d.y, 0.02), ts * d.x + tc * d.z);
    vec2 e = hemiOctEncode(normalize(dl));
    vFrame = floor(clamp((e * 0.5 + 0.5) * ${IMPOSTOR_GRID.toFixed(1)} - 0.5, 0.0, ${(IMPOSTOR_GRID - 1).toFixed(1)}) + 0.5);
    vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), d));
    vec3 up = cross(d, right);
    float R = ${TREE_BOUND_RADIUS.toFixed(3)} * tH * grow;
    // The billboard stands at the back of the crown (seen from the light). Sliding a caster along the light
    // direction leaves its shadow on the ground unchanged, but a flat caster through the crown's centre would
    // cut neighbouring crowns that reach into it with straight-edged shadows, and shade its own front half.
    transformed = centre + (right * position.x * treeWidth() + up * position.y) * R - d * (0.7 * R);
    vImpUv = position.xy * 0.5 + 0.5;
    vSpecies = treeSpecies();
  }
}
`;

const IMPOSTOR_SHADOW_FRAGMENT = /* glsl */ `
{
  vec2 quadrant = vec2(mod(vSpecies, 2.0), floor(vSpecies / 2.0));
  vec2 uv = clamp(vImpUv, 0.5 / ${IMPOSTOR_FRAME.toFixed(1)}, 1.0 - 0.5 / ${IMPOSTOR_FRAME.toFixed(1)});
  // Mipmapped coverage: a lower threshold keeps the shadow of a distant crown as wide as the crown.
  if (texture2D(tImpAlbedo, (quadrant * ${IMPOSTOR_GRID.toFixed(1)} + vFrame + uv) / ${(2 * IMPOSTOR_GRID).toFixed(1)}).a < 0.4) discard;
}
`;
