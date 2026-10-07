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

import * as THREE from 'three';
import { HASH_GLSL } from './glsl';
import { hydrology } from './heightfield';
import { RIPARIAN_GLSL, RIPARIAN_TREE_HEIGHT } from './riparian';
import type { WaterData } from './tileBuilder';

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

const FRAGMENT_MAIN = /* glsl */ `
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
vec3 atten = vec3(1.25, 0.95, 1.05);
vec3 body = vec3(0.030, 0.034, 0.021);
#else
vec3 atten = vec3(0.46, 0.085, 0.07);
vec3 body = mix(vec3(0.0035, 0.013, 0.021), vec3(0.012, 0.03, 0.026), exp(-depth * 0.08));
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
  // Canopy cover of the bank seen edge-on: the gallery is broken (placement plants at most ~60% of its
  // candidates where presence is 1, fewer further from the water), so gaps show the sky between crowns.
  float trees = riparianPresence(sHit, bSide) * (0.25 + 0.35 * texture(tNoise, vec2(sHit / 23.0, bSide * 0.37)).r);
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

export function createWaterMaterial(noise: THREE.Texture, uniforms: WaterUniforms, river: boolean): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.06, metalness: 0, transparent: true, depthWrite: true });
  // Premultiplied blending: the shader writes reflection + body light, and alpha = 1 - transmittance.
  mat.blending = THREE.CustomBlending;
  mat.blendEquation = THREE.AddEquation;
  mat.blendSrc = THREE.OneFactor;
  mat.blendDst = THREE.OneMinusSrcAlphaFactor;
  mat.blendSrcAlpha = THREE.OneFactor;
  mat.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
  mat.name = river ? 'river' : 'water';
  // Single-sided: water is only ever seen from above, and a transparent double-sided material makes three
  // draw it in two passes, flipping its side (and re-resolving its program) twice every frame. The river
  // ribbon's triangles (createRiverGeometry) face up.
  if (river) mat.defines = { RIVER: '' };
  Object.assign(uniforms, { tNoise: { value: noise } });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERTEX_HEAD}`)
      .replace('#include <begin_vertex>', VERTEX_BEGIN);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAGMENT_HEAD}`)
      .replace('#include <map_fragment>', FRAGMENT_MAIN)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = wRough;')
      .replace('#include <lights_physical_pars_fragment>', WATER_LIGHTS_PARS)
      .replace('#include <normal_fragment_maps>', 'normal = normalize((viewMatrix * vec4(wNormal, 0.0)).xyz);')
      .replace('#include <opaque_fragment>', FRAGMENT_OUTPUT);
  };
  mat.customProgramCacheKey = () => (river ? 'river-v4' : 'water-v4');
  return mat;
}

/** Geometry for one node's standing water. */
export function createWaterGeometry(w: WaterData): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(w.positions, 3));
  g.setAttribute('aDepth', new THREE.BufferAttribute(w.depth, 1));
  g.setIndex(new THREE.BufferAttribute(w.index, 1));
  return g;
}

/**
 * The river ribbon in world coordinates: five vertices across (dry bank, half-width, centre, half-width,
 * dry bank) at every centreline sample, at the local water level. It stops at the coast.
 */
export function createRiverGeometry(): THREE.BufferGeometry {
  const r = hydrology.river;
  const count = r.north.length;
  const across = [-1.2, -0.55, 0, 0.55, 1.2];
  const pos: number[] = [];
  const depth: number[] = [];
  const info: number[] = [];
  const tan: number[] = [];
  let rows = 0;
  for (let i = 0; i < count; i++) {
    if (r.level[i] < 0.3) break;
    const i0 = Math.max(0, i - 1);
    const i1 = Math.min(count - 1, i + 1);
    const tn = r.north[i1] - r.north[i0];
    const te = r.east[i1] - r.east[i0];
    const tl = Math.hypot(tn, te) || 1;
    // Unit perpendicular to the direction of flow (east, north components).
    const pe = -tn / tl;
    const pn = te / tl;
    const w = r.halfWidth[i];
    const centreDepth = 2.2 + w * 0.05;
    for (const a of across) {
      const off = a * w;
      const e = r.east[i] + pe * off;
      const n = r.north[i] + pn * off;
      pos.push(e, r.level[i], -n);
      depth.push(Math.abs(a) > 1 ? -0.8 : centreDepth * (1 - a * a));
      // The across offset points to the left bank; RiverHit.side and the shader count toward the right.
      info.push(-off, r.s[i], w);
      tan.push(te / tl, -tn / tl);
    }
    rows++;
  }
  const idx: number[] = [];
  for (let j = 0; j < rows - 1; j++) {
    for (let k = 0; k < across.length - 1; k++) {
      const a = j * across.length + k;
      const b = a + across.length;
      // Counter-clockwise seen from above: rows advance downstream and the across offset points to the
      // left bank (the flow direction turned 90 degrees anticlockwise), so (b - a) x (a+1 - a) is up.
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aDepth', new THREE.Float32BufferAttribute(depth, 1));
  g.setAttribute('aRiverInfo', new THREE.Float32BufferAttribute(info, 3));
  g.setAttribute('aRiverT', new THREE.Float32BufferAttribute(tan, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}
