// Temporal accumulation (low resolution) and depth-aware upsample + composite (full resolution).

import { DEPTH_GLSL } from '../../core/shaderLib';
import { AERIAL_ATLAS_GLSL } from '../post/AerialPerspectiveEffect';
import { CLOUD_SHADOW_GLSL } from './cloudShadow';

export const FULLSCREEN_VERT = /* glsl */ `
out vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const RAY_GLSL = /* glsl */ `
uniform mat4 uInvProj;
uniform mat4 uCamWorld;
uniform vec3 uCamPos;
vec3 rayDirView(vec2 uv) {
  vec4 v = uInvProj * vec4(uv * 2.0 - 1.0, 1.0, 1.0);
  return normalize(v.xyz / v.w);
}
`;

/**
 * Reproject last frame's accumulated clouds using this frame's cloud front distance, clip the history to
 * the variance box of the current frame's 3x3 neighbourhood (Salvi 2016) and blend in the new frame.
 */
export const TEMPORAL_FRAG = /* glsl */ `
${RAY_GLSL}
in vec2 vUv;
layout(location = 0) out vec4 outColor;
uniform sampler2D uCurr;
uniform sampler2D uAux;
uniform sampler2D uHistory;
uniform mat4 uPrevViewProj;
uniform float uBlend;
uniform float uClipGamma;
uniform float uHistoryValid;

// History fetched with a Catmull-Rom filter (9 bilinear taps, Jimenez 2016) instead of a single bilinear
// one: re-sampling bilinearly every frame while the view moves blurs the accumulated clouds into fog.
vec4 historyCatmullRom(vec2 uv) {
  vec2 size = vec2(textureSize(uHistory, 0));
  vec2 pos = uv * size;
  vec2 c = floor(pos - 0.5) + 0.5;
  vec2 f = pos - c;
  vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
  vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
  vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f));
  vec2 w3 = f * f * (-0.5 + 0.5 * f);
  vec2 w12 = w1 + w2;
  vec2 t0 = (c - 1.0) / size, t3 = (c + 2.0) / size, t12 = (c + w2 / w12) / size;
  vec4 r = texture(uHistory, vec2(t0.x, t0.y)) * w0.x * w0.y + texture(uHistory, vec2(t12.x, t0.y)) * w12.x * w0.y + texture(uHistory, vec2(t3.x, t0.y)) * w3.x * w0.y
         + texture(uHistory, vec2(t0.x, t12.y)) * w0.x * w12.y + texture(uHistory, vec2(t12.x, t12.y)) * w12.x * w12.y + texture(uHistory, vec2(t3.x, t12.y)) * w3.x * w12.y
         + texture(uHistory, vec2(t0.x, t3.y)) * w0.x * w3.y + texture(uHistory, vec2(t12.x, t3.y)) * w12.x * w3.y + texture(uHistory, vec2(t3.x, t3.y)) * w3.x * w3.y;
  return max(r, vec4(0.0));
}

void main() {
  ivec2 px = ivec2(gl_FragCoord.xy);
  ivec2 maxPx = textureSize(uCurr, 0) - 1;
  vec4 c = texelFetch(uCurr, px, 0);
  vec4 m1 = c, m2 = c * c;
  vec4 nMin = vec4(1e20), nMax = vec4(-1e20);
  for (int y = -1; y <= 1; y++)
  for (int x = -1; x <= 1; x++) {
    if (x == 0 && y == 0) continue;
    vec4 v = texelFetch(uCurr, clamp(px + ivec2(x, y), ivec2(0), maxPx), 0);
    m1 += v;
    m2 += v * v;
    nMin = min(nMin, v);
    nMax = max(nMax, v);
  }
  // Isolated single-pixel outliers (a ray that slipped through a dense cloud to the sun, a lone bright
  // sample) are clamped to the range of their neighbours; lines and edges are unaffected.
  c = clamp(c, nMin, nMax);
  vec4 mean = m1 / 9.0;
  vec4 sigma = sqrt(max(m2 / 9.0 - mean * mean, 0.0));

  vec4 result = c;
  if (uHistoryValid > 0.5) {
    float front = exp2(texelFetch(uAux, px, 0).r) - 1.0;
    vec3 dir = normalize(mat3(uCamWorld) * rayDirView(vUv));
    vec4 prev = uPrevViewProj * vec4(uCamPos + dir * front, 1.0);
    vec2 puv = prev.xy / prev.w * 0.5 + 0.5;
    if (prev.w > 0.0 && all(greaterThanEqual(puv, vec2(0.0))) && all(lessThanEqual(puv, vec2(1.0)))) {
      vec4 h = historyCatmullRom(puv);
      // The reprojection uses one depth per pixel (the opacity-weighted cloud front), which is only exact for
      // a hard surface: in a translucent volume seen while the camera moves, the history drifts against the
      // parallax of what lies in front of and behind that depth and smears the clouds into fog. The blend
      // therefore rises with the reprojection offset (the single-frame image is clean enough with the blue
      // noise to carry more weight), and the clip box tightens.
      float motion = length((puv - vUv) * vec2(textureSize(uCurr, 0)));
      float moving = smoothstep(0.05, 0.6, motion);
      float gamma = mix(uClipGamma, 0.75, moving);
      h = clamp(h, mean - gamma * sigma, mean + gamma * sigma);
      result = mix(h, c, mix(uBlend, 0.5, moving));
    }
  }
  outColor = result;
}
`;

/**
 * Upsample the clouds with bilinear weights modulated by depth similarity, so clouds neither bleed onto
 * nearby geometry nor leave gaps around it. A tap whose cloud starts behind this pixel's surface
 * contributes "no cloud", which keeps the aircraft and ridgelines clean even where no low-res tap saw
 * them. Then apply cloud shadows to the scene and composite: out = scene * T + L.
 */
export const COMPOSITE_FRAG = /* glsl */ `
${DEPTH_GLSL}
${CLOUD_SHADOW_GLSL}
${RAY_GLSL}
${AERIAL_ATLAS_GLSL}
in vec2 vUv;
layout(location = 0) out vec4 outColor;
uniform float uAerialOn;
uniform sampler2D uScene;
uniform sampler2D uDepth;
uniform sampler2D uClouds;
uniform sampler2D uAux;
uniform vec2 uLowSize;
uniform vec2 uHaze;   // sea-level extinction 1/m, scale height m
uniform float uCompositeShadows;

void main() {
  vec4 scene = texture(uScene, vUv);
  float d = texture(uDepth, vUv).r;
  vec3 dv = rayDirView(vUv);
  bool sky = isSky(d);
  float dist = sky ? 1e7 : viewZFromDepth(d) / max(-dv.z, 1e-4);
  float logD = log2(1.0 + dist);

  // Joint bilateral upsample over the 4x4 low-res texels around the pixel: a spatial tent (wider than
  // bilinear) times a depth-similarity weight. With only the four bilinear taps, a pixel on a thin ridge or
  // tower whose four neighbours all saw the sky (or all the terrain) had no tap of its own depth and took
  // theirs, which shows as blocky low-resolution rectangles along terrain silhouettes; the wider footprint
  // almost always contains a matching tap, and the depth weight then dominates.
  vec2 lp = vUv * uLowSize - 0.5;
  ivec2 i0 = ivec2(floor(lp)) - 1;
  vec2 f = lp - vec2(i0);
  ivec2 maxPx = ivec2(uLowSize) - 1;
  // Where all 16 taps agree in depth (open sky, the clouds' own interior) the weights are Catmull-Rom's,
  // whose negative lobes keep the upscaled clouds as sharp as the march resolution allows (a positive
  // filter blurs the ~1.8x upscale into soft focus); the result is clamped to the range of the central
  // taps so the lobes never ring. Near depth edges the positive tent takes over.
  // Separable weights, per axis: tent^2 and Catmull-Rom.
  vec4 dx = abs(vec4(0.0, 1.0, 2.0, 3.0) - f.x), dy = abs(vec4(0.0, 1.0, 2.0, 3.0) - f.y);
  vec4 tx = max(1.6 - dx, 0.0), ty = max(1.6 - dy, 0.0);
  tx *= tx; ty *= ty;
  vec4 cx = mix(1.0 + dx * dx * (1.5 * dx - 2.5), 2.0 + dx * (-4.0 + dx * (2.5 - 0.5 * dx)), step(1.0, dx));
  vec4 cy = mix(1.0 + dy * dy * (1.5 * dy - 2.5), 2.0 + dy * (-4.0 + dy * (2.5 - 0.5 * dy)), step(1.0, dy));
  vec4 cloud = vec4(0.0), sharp = vec4(0.0);
  vec4 cMin = vec4(1e20), cMax = vec4(-1e20);
  float wsum = 0.0, dmin = 1.0;
  for (int i = 0; i < 16; i++) {
    int ox = i & 3, oy = i >> 2;
    ivec2 q = clamp(i0 + ivec2(ox, oy), ivec2(0), maxPx);
    vec4 aux = texelFetch(uAux, q, 0);
    vec4 c = logD < aux.r - 0.2 ? vec4(0.0, 0.0, 0.0, 1.0) : texelFetch(uClouds, q, 0);
    // Depth differences below ~20 % (0.25 in log2) are ordinary surface slope, not an edge: ignore them,
    // or the weights would alternate with pixel parity on grazing terrain and show as scanlines.
    float dw = max(exp(-max(abs(aux.g - logD) - 0.25, 0.0) * 8.0), 1e-4);
    float w = tx[ox] * ty[oy] * dw;
    cloud += c * w;
    wsum += w;
    sharp += c * (cx[ox] * cy[oy]);
    dmin = min(dmin, dw);
    if ((ox == 1 || ox == 2) && (oy == 1 || oy == 2)) { cMin = min(cMin, c); cMax = max(cMax, c); }
  }
  cloud /= wsum;
  // The Catmull-Rom weights sum to 1.
  if (dmin > 0.5) cloud = mix(cloud, clamp(sharp, cMin, cMax), smoothstep(0.5, 0.9, dmin));

  vec3 color = scene.rgb;
  if (!sky && uCompositeShadows > 0.5) {
    vec3 dir = normalize(mat3(uCamWorld) * dv);
    vec3 wp = uCamPos + dir * dist;
    // Shadows darken only the surface's own light, not the haze in front of it.
    float s = cloudShadow(wp);
    if (uAerialOn > 0.5) {
      // The scene colour is surface * T + inscatter (aerial perspective); shadow only the first term.
      vec3 inscatter = min(aerialPerspective(vUv, dist).rgb, color);
      color = inscatter + (color - inscatter) * s;
    } else {
      float y0 = uCamPos.y, y1 = wp.y, H = uHaze.y;
      float avg = abs(y1 - y0) < 1.0 ? exp(-y0 / H) : H * (exp(-y0 / H) - exp(-y1 / H)) / (y1 - y0);
      float surface = exp(-uHaze.x * dist * avg);
      color *= mix(1.0, s, surface);
    }
  }
  outColor = vec4(color * cloud.a + cloud.rgb, scene.a);
}
`;

export const COPY_FRAG = /* glsl */ `
in vec2 vUv;
layout(location = 0) out vec4 outColor;
uniform sampler2D uScene;
void main() { outColor = texture(uScene, vUv); }
`;
