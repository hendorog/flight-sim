// Procedural noise textures for the cloud renderer, generated on the GPU at start-up (ready ~60 ms after
// construction, ~30 ms of that blocking; nothing is downloaded). All textures tile seamlessly.
//
// Raw noise distributions are narrow and hard to predict, so each volume is auto-levelled: a few slices are
// first rendered to a small 2D target and read back asynchronously, and the 1st-99th percentile range is
// stretched to [0, 1]. The coverage and cirrus channels of the weather map are histogram-equalised on the
// CPU (the coverage fields to normal scores, see coverage.ts), so thresholding them selects an exactly known
// fraction of the area.
//
//   shape   128^3 R16F Perlin-Worley "base shape" noise (Schneider, "The real-time volumetric cloudscapes of
//                     Horizon Zero Dawn", SIGGRAPH 2015): low-frequency Perlin fBm dilated by Worley fBm, then
//                     eroded by three higher-frequency Worley octaves. Gives billowy cauliflower cells.
//   detail   64^3 R16F   Worley fBm used to erode the edges of the shape into billows, turrets and wisps.
//   warp     32^3 RGBA8  a smooth vector field (three gradient-noise fBm) that distorts the erosion's domain
//                        and the outline of each cloud. Separate from the detail so the hot erosion fetches
//                        read 2 bytes per texel instead of 8. Same tile period as the detail.
//   weather 1024^2 RGBA
//                     R, G  two independent large-scale coverage fields (blended over time so the cloud field evolves),
//                           stored as normal scores (coverage.ts)
//                     B     cloud type: 0 = flat stratocumulus, 1 = towering cumulus
//                     A     cirrus coverage: bands and patches elongated along the upper wind
//   cirrus 1024^2 RGBA   R, G  two fields of fine, ridged, domain-warped cirrus fibres (hooks, fall streaks)

import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { equalizeToNormal } from './coverage';

const NOISE_GLSL = /* glsl */ `
uvec3 pcg3d(uvec3 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v;
}
vec3 hash3(ivec3 c, int seed) {
  return vec3(pcg3d(uvec3(c + ivec3(seed * 1013, seed * 7919, seed * 104729)))) * (1.0 / 4294967295.0);
}
ivec3 wrapCell(ivec3 c, ivec3 period) { return ((c % period) + period) % period; }

// Gradient noise with an integer lattice period per axis, result roughly in [-1, 1].
float perlin(vec3 p, ivec3 period, int seed) {
  ivec3 i = ivec3(floor(p));
  vec3 f = fract(p);
  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float n[8];
  for (int k = 0; k < 8; k++) {
    ivec3 o = ivec3(k & 1, (k >> 1) & 1, (k >> 2) & 1);
    vec3 g = normalize(hash3(wrapCell(i + o, period), seed) * 2.0 - 1.0 + 1e-4);
    n[k] = dot(g, f - vec3(o));
  }
  return mix(mix(mix(n[0], n[1], u.x), mix(n[2], n[3], u.x), u.y),
             mix(mix(n[4], n[5], u.x), mix(n[6], n[7], u.x), u.y), u.z) * 1.6;
}

float perlinFbm(vec3 p, ivec3 period, int octaves, int seed) {
  float sum = 0.0, amp = 0.5, norm = 0.0;
  for (int o = 0; o < 8; o++) {
    if (o >= octaves) break;
    sum += perlin(p, period, seed + o) * amp;
    norm += amp;
    p *= 2.0; period *= 2; amp *= 0.5;
  }
  return sum / norm;
}

// Inverted cellular (Worley F1) noise, one feature point per cell: 1 at the points, 0 far from them.
float worley(vec3 p, ivec3 cells, int seed) {
  vec3 q = p * vec3(cells);
  ivec3 i = ivec3(floor(q));
  vec3 f = fract(q);
  float d = 1e9;
  for (int z = -1; z <= 1; z++)
  for (int y = -1; y <= 1; y++)
  for (int x = -1; x <= 1; x++) {
    ivec3 o = ivec3(x, y, z);
    vec3 r = vec3(o) + hash3(wrapCell(i + o, cells), seed) - f;
    d = min(d, dot(r, r));
  }
  return 1.0 - clamp(sqrt(d), 0.0, 1.0);
}

float worleyFbm(vec3 p, int cells, int seed) {
  return worley(p, ivec3(cells), seed) * 0.625
       + worley(p, ivec3(cells * 2), seed + 1) * 0.25
       + worley(p, ivec3(cells * 4), seed + 2) * 0.125;
}

float remap(float v, float a, float b, float c, float d) { return c + (v - a) / (b - a) * (d - c); }
`;

/** Resolution of the weather map (60 m per texel over its 60 km period). */
export const WEATHER_SIZE = 1024;

const VERT = /* glsl */ `
out vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const SHAPE_FRAG = /* glsl */ `
precision highp float;
precision highp int;
${NOISE_GLSL}
in vec2 vUv;
uniform float uZ;
uniform vec2 uLevels;
layout(location = 0) out vec4 outColor;
void main() {
  vec3 p = vec3(vUv, uZ);
  // Perlin fBm dilated by Worley fBm: round billows from Worley, connectedness from Perlin.
  float pn = clamp(perlinFbm(p * 4.0, ivec3(4), 5, 11) * 0.9 + 0.5, 0.0, 1.0);
  float perlinWorley = remap(pn, 0.0, 1.0, worleyFbm(p, 4, 21), 1.0);
  // Higher-frequency Worley octaves erode the shape (Schneider 2015: low_freq_fbm).
  float fbm = worleyFbm(p, 8, 31) * 0.625 + worleyFbm(p, 16, 41) * 0.25 + worleyFbm(p, 32, 51) * 0.125;
  float shape = remap(perlinWorley, fbm - 1.0, 1.0, 0.0, 1.0);
  outColor = vec4(clamp((shape - uLevels.x) / (uLevels.y - uLevels.x), 0.0, 1.0), 0.0, 0.0, 1.0);
}
`;

const DETAIL_FRAG = /* glsl */ `
precision highp float;
precision highp int;
${NOISE_GLSL}
in vec2 vUv;
uniform float uZ;
uniform vec2 uLevels;
layout(location = 0) out vec4 outColor;
void main() {
  vec3 p = vec3(vUv, uZ);
  float d = worleyFbm(p, 3, 61) * 0.625 + worleyFbm(p, 6, 71) * 0.25 + worleyFbm(p, 12, 81) * 0.125;
  outColor = vec4(clamp((d - uLevels.x) / (uLevels.y - uLevels.x), 0.0, 1.0), 0.0, 0.0, 1.0);
}
`;

const WARP_FRAG = /* glsl */ `
precision highp float;
precision highp int;
${NOISE_GLSL}
in vec2 vUv;
uniform float uZ;
uniform vec2 uLevels;
layout(location = 0) out vec4 outColor;
void main() {
  vec3 p = vec3(vUv, uZ);
  // Three smooth, independent gradient-noise fields (two octaves, 2 and 4 cells per tile): a vector field
  // that swirls the sampling domain of the detail erosion (curl-like distortion, Schneider 2015).
  vec3 warp = vec3(perlinFbm(p * 2.0, ivec3(2), 2, 91), perlinFbm(p * 2.0, ivec3(2), 2, 93), perlinFbm(p * 2.0, ivec3(2), 2, 95));
  outColor = vec4(clamp(warp * 0.7 + 0.5, 0.0, 1.0), 1.0);
}
`;

const WEATHER_FRAG = /* glsl */ `
precision highp float;
precision highp int;
${NOISE_GLSL}
in vec2 vUv;
layout(location = 0) out vec4 outColor;

// Coverage: a sum of domain-warped Worley bump octaves (4.3 km, 1.9 km, 830 m, 375 m) over a regional Perlin
// fBm (~10 km). Each octave scatters round cloud cells of one size at random; their weights fall with size
// so thresholding picks a power-law-like mix: many small puffs, fewer mid-sized clouds, the odd large cell
// (where octaves coincide), in clusters and clear areas as real cumulus fields are. The ~900 m warp breaks
// the Voronoi outlines into irregular shapes. The texture spans 60 km. The output is histogram-equalised on
// the CPU (normal scores, coverage.ts), so only the ordering of values matters here.
float bump(vec2 q, int cells, float z, int seed) {
  float w = worley(vec3(q, z), ivec3(cells, cells, 1), seed);
  return w * w;   // rounder, flatter-topped cells than the cone of 1 - F1
}
float coverage(vec2 uv, int seed) {
  vec2 warp = vec2(perlinFbm(vec3(uv * 16.0, 0.13), ivec3(16, 16, 64), 3, seed + 1),
                   perlinFbm(vec3(uv * 16.0, 0.57), ivec3(16, 16, 64), 3, seed + 2));
  vec2 q = uv + warp * 0.012;
  float regional = perlinFbm(vec3(uv * 6.0, 0.5), ivec3(6, 6, 64), 4, seed);
  return 0.5 + regional * 0.3
       + (bump(q, 14, 0.23, seed + 8) - 0.3) * 0.62
       + (bump(q, 32, 0.37, seed + 9) - 0.3) * 0.46
       + (bump(q, 72, 0.61, seed + 10) - 0.3) * 0.34
       + (bump(q, 160, 0.79, seed + 11) - 0.3) * 0.22;
}

void main() {
  float c0 = coverage(vUv, 101);
  float c1 = coverage(vUv, 201);
  // Cloud type: regional (~20 km) plus a cell-scale (~1.2 km) variation, so neighbouring cells of the same
  // strength still reach different heights.
  float type = 0.65 * smoothstep(-0.35, 0.35, perlinFbm(vec3(vUv * 3.0, 0.2), ivec3(3, 3, 64), 3, 301))
             + 0.35 * smoothstep(-0.4, 0.4, perlinFbm(vec3(vUv * 48.0, 0.8), ivec3(48, 48, 64), 2, 311));
  // Cirrus coverage: patches and bands a few km across, elongated along x (the upper-wind axis). The fibrous
  // structure inside them comes from the separate cirrus texture.
  vec2 warp = vec2(perlinFbm(vec3(vUv * 4.0, 0.3), ivec3(4, 4, 64), 3, 401),
                   perlinFbm(vec3(vUv * 4.0, 0.7), ivec3(4, 4, 64), 3, 402));
  vec2 cu = vUv + warp * vec2(0.04, 0.08);
  float cirrus = perlinFbm(vec3(cu.x * 2.0, cu.y * 12.0, 0.9), ivec3(2, 12, 64), 5, 601);
  outColor = vec4(c0, c1, type, cirrus * 0.5 + 0.5);
}
`;

// Cirrus fibres (1024^2, tiles over CIRRUS_FIBRE_PERIOD): ridged, strongly anisotropic Perlin fBm (strands
// ~15x longer than wide along x), domain-warped so strands bend into hooks and fall streaks. R and G are
// two independent fields, sampled at different scales so the pattern never visibly repeats.
const CIRRUS_FRAG = /* glsl */ `
precision highp float;
precision highp int;
${NOISE_GLSL}
in vec2 vUv;
layout(location = 0) out vec4 outColor;

float fibres(vec2 uv, int seed) {
  vec2 warp = vec2(perlinFbm(vec3(uv * 3.0, 0.21), ivec3(3, 3, 64), 3, seed + 1),
                   perlinFbm(vec3(uv * 5.0, 0.63), ivec3(5, 5, 64), 3, seed + 2));
  // Strong cross-axis warp bends the strands; a little along-axis warp breaks up their ends.
  vec2 q = uv + vec2(warp.x * 0.03, warp.y * 0.07);
  float sum = 0.0, amp = 1.0, norm = 0.0;
  ivec3 period = ivec3(2, 32, 64);
  vec3 p = vec3(q.x * 2.0, q.y * 32.0, 0.5);
  for (int o = 0; o < 5; o++) {
    // Ridged noise: thin bright filaments where the gradient noise crosses zero.
    float r = 1.0 - abs(perlin(p, period, seed + 10 + o));
    sum += r * r * r * amp;
    norm += amp;
    p.xy *= 2.0; period.xy *= 2; amp *= 0.55;
  }
  return sum / norm;
}

void main() {
  outColor = vec4(fibres(vUv, 700), fibres(fract(vUv + vec2(0.37, 0.61)), 800), 0.0, 1.0);
}
`;

export interface CloudNoiseTextures {
  shape: THREE.Data3DTexture;
  detail: THREE.Data3DTexture;
  /** Smooth vector field (RGB, 0.5 = zero) for domain warping, 32^3 RGBA8, same tile period as `detail`. */
  warp: THREE.Data3DTexture;
  weather: THREE.Texture;
  /** Cirrus fibres (R, G: two independent fields), 1024^2 RGBA8, tiling. */
  cirrus: THREE.Texture;
  dispose(): void;
}

function makeMaterial(frag: string, withZ: boolean): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: VERT,
    fragmentShader: frag,
    uniforms: withZ ? { uZ: { value: 0 }, uLevels: { value: new THREE.Vector2(0, 1) } } : {},
    depthTest: false,
    depthWrite: false,
  });
}

function make3DTarget(size: number, format: THREE.PixelFormat = THREE.RedFormat, type: THREE.TextureDataType = THREE.HalfFloatType): THREE.WebGL3DRenderTarget {
  const rt = new THREE.WebGL3DRenderTarget(size, size, size, {
    format,
    // Half float by default: magnified close up (the zoomed tower view, flying past a cloud) 8-bit levels
    // show as contour lines across the steep density edge.
    type,
    depthBuffer: false,
  });
  const t = rt.texture;
  t.wrapS = t.wrapT = t.wrapR = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  return rt;
}

/**
 * Run a block of GPU commands between awaits, leaving the renderer's target and auto-clear as they were:
 * the application keeps rendering frames while the textures are being built.
 */
function onGpu<T>(renderer: THREE.WebGLRenderer, fn: () => T): T {
  const prevTarget = renderer.getRenderTarget();
  const prevAutoClear = renderer.autoClear;
  renderer.autoClear = false;
  try {
    return fn();
  } finally {
    renderer.setRenderTarget(prevTarget);
    renderer.autoClear = prevAutoClear;
  }
}

/** Render a full-screen pass into an RGBA8 2D target and read it back without stalling the GPU. */
async function renderAndRead(renderer: THREE.WebGLRenderer, quad: FullScreenQuad, size: number): Promise<Uint8Array> {
  const rt = new THREE.WebGLRenderTarget(size, size, { depthBuffer: false });
  onGpu(renderer, () => {
    renderer.setRenderTarget(rt);
    quad.render(renderer);
  });
  const pixels = new Uint8Array(size * size * 4);
  await renderer.readRenderTargetPixelsAsync(rt, 0, 0, size, size, pixels);
  rt.dispose();
  return pixels;
}

/** 1st and 99th percentile of channel 0 over a few slices of a volume shader, for auto-levelling. */
async function measureLevels(renderer: THREE.WebGLRenderer, quad: FullScreenQuad, material: THREE.ShaderMaterial): Promise<THREE.Vector2> {
  const hist = new Uint32Array(256);
  for (const z of [0.13, 0.41, 0.77]) {
    material.uniforms.uZ.value = z;
    const px = await renderAndRead(renderer, quad, 64);
    for (let i = 0; i < px.length; i += 4) hist[px[i]]++;
  }
  const total = hist.reduce((a, b) => a + b, 0);
  let acc = 0;
  let lo = 0;
  let hi = 255;
  for (let v = 0; v < 256; v++) {
    const prev = acc;
    acc += hist[v];
    if (prev < total * 0.01 && acc >= total * 0.01) lo = v;
    if (prev < total * 0.99 && acc >= total * 0.99) hi = v;
  }
  return new THREE.Vector2(lo / 255, Math.max(hi, lo + 1) / 255);
}

/** Auto-level a volume shader, then render every slice of the 3D target; mipmaps are built once, after the last slice. */
async function fill3D(renderer: THREE.WebGLRenderer, rt: THREE.WebGL3DRenderTarget, material: THREE.ShaderMaterial, level = true): Promise<void> {
  const quad = new FullScreenQuad(material);
  if (level) material.uniforms.uLevels.value = await measureLevels(renderer, quad, material);
  onGpu(renderer, () => {
    const n = rt.depth;
    for (let z = 0; z < n; z++) {
      rt.texture.generateMipmaps = z === n - 1;
      material.uniforms.uZ.value = (z + 0.5) / n;
      renderer.setRenderTarget(rt, z);
      quad.render(renderer);
    }
  });
  quad.dispose();
  material.dispose();
}

/** Replace channel c of an RGBA8 image by its rank (histogram equalisation). */
function equalize(pixels: Uint8Array, c: number): void {
  const hist = new Uint32Array(256);
  for (let i = c; i < pixels.length; i += 4) hist[pixels[i]]++;
  const lut = new Uint8Array(256);
  const total = pixels.length / 4;
  let acc = 0;
  for (let v = 0; v < 256; v++) {
    lut[v] = Math.round(((acc + hist[v] * 0.5) / total) * 255);
    acc += hist[v];
  }
  for (let i = c; i < pixels.length; i += 4) pixels[i] = lut[pixels[i]];
}

async function createWeatherTexture(renderer: THREE.WebGLRenderer): Promise<THREE.DataTexture> {
  const size = WEATHER_SIZE;
  const material = makeMaterial(WEATHER_FRAG, false);
  const quad = new FullScreenQuad(material);
  const pixels = await renderAndRead(renderer, quad, size);
  quad.dispose();
  material.dispose();
  // The coverage fields are stored as normal scores so they can be cross-faded without changing their
  // distribution (coverage.ts); the cirrus field is plainly equalised.
  equalizeToNormal(pixels, 0);
  equalizeToNormal(pixels, 1);
  equalize(pixels, 3);
  const tex = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

async function createCirrusTexture(renderer: THREE.WebGLRenderer): Promise<THREE.DataTexture> {
  const size = 1024;
  const material = makeMaterial(CIRRUS_FRAG, false);
  const quad = new FullScreenQuad(material);
  const pixels = await renderAndRead(renderer, quad, size);
  quad.dispose();
  material.dispose();
  equalize(pixels, 0);
  equalize(pixels, 1);
  const tex = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

/** Build all cloud noise textures. Resolves after a few frames; the GPU is never stalled. */
export async function createCloudNoiseTextures(renderer: THREE.WebGLRenderer): Promise<CloudNoiseTextures> {
  const shapeRT = make3DTarget(128);
  const detailRT = make3DTarget(64);
  const warpRT = make3DTarget(32, THREE.RGBAFormat, THREE.UnsignedByteType);
  const [, , , weather, cirrus] = await Promise.all([
    fill3D(renderer, shapeRT, makeMaterial(SHAPE_FRAG, true)),
    fill3D(renderer, detailRT, makeMaterial(DETAIL_FRAG, true)),
    fill3D(renderer, warpRT, makeMaterial(WARP_FRAG, true), false),
    createWeatherTexture(renderer),
    createCirrusTexture(renderer),
  ]);
  return {
    shape: shapeRT.texture,
    detail: detailRT.texture,
    warp: warpRT.texture,
    weather,
    cirrus,
    dispose() {
      shapeRT.dispose();
      detailRT.dispose();
      warpRT.dispose();
      weather.dispose();
      cirrus.dispose();
    },
  };
}
