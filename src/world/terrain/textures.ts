// Procedural textures, generated on the GPU once at start-up (a few milliseconds):
//   - noise: 256^2 RGBA, four independent tileable fBm fields for macro/meso variation;
//   - detail albedo array: per ground material, RGB albedo (gamma 2.2 encoded for precision) + A height;
//   - detail normal array: per material, RG tangent-space normal, B roughness, A cavity (ambient occlusion).
// All tile seamlessly and are mipmapped with anisotropic filtering.

import * as THREE from 'three';
import { HASH_GLSL, PERIODIC_NOISE_GLSL } from './glsl';

/** Ground material layers in the detail arrays. */
export const LAYER = { grass: 0, soil: 1, rock: 2, gravel: 3, snow: 4, sand: 5, forest: 6, canopy: 7 } as const;
export const LAYER_COUNT = 8;
/** World size of one texture repeat per layer, m. */
export const LAYER_TILE_M = [5, 4.5, 17, 3.5, 9, 6, 5, 76];

export interface TerrainTextures {
  noise: THREE.Texture;
  albedo: THREE.DataArrayTexture;
  normal: THREE.DataArrayTexture;
  /** Mean linear albedo of each layer (its top mip), for the shader's detail ratios. */
  layerMeans: THREE.Vector3[];
  /** Resolves once layerMeans hold the measured values (read back asynchronously, without a GPU stall). */
  ready: Promise<void>;
  dispose(): void;
}

const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const NOISE_FRAG = /* glsl */ `
${HASH_GLSL}
${PERIODIC_NOISE_GLSL}
varying vec2 vUv;
void main() {
  gl_FragColor = vec4(
    fbm(vUv, 4, 6, 0.5),
    fbm(vUv + 0.37, 6, 6, 0.55),
    fbm(vUv + 0.71, 8, 5, 0.5),
    fbm(vUv + 0.13, 16, 4, 0.6));
}
`;

const ALBEDO_FRAG = /* glsl */ `
${HASH_GLSL}
${PERIODIC_NOISE_GLSL}
uniform int uLayer;
varying vec2 vUv;
void main() {
  vec2 uv = vUv;
  vec3 col;
  float h;
  if (uLayer == 0) {
    // Grass: clumps, tufts and blades over a little bare soil; some dry blades.
    float clump = fbm(uv, 6, 4, 0.55);
    float fine = fbm(uv, 96, 2, 0.6);
    vec3 v = voronoi(uv, 80, 0.9);
    float tuft = 1.0 - smoothstep(0.0, 0.55, v.x);
    float dry = smoothstep(0.55, 0.85, fbm(uv + 0.5, 4, 3, 0.5) * 0.7 + v.z * 0.45);
    col = mix(vec3(0.060, 0.105, 0.030), vec3(0.150, 0.140, 0.060), dry * 0.7);
    col *= 0.65 + 0.7 * fine * (0.6 + 0.4 * tuft);
    col = mix(col, vec3(0.070, 0.055, 0.040), smoothstep(0.38, 0.28, clump) * 0.55);
    h = 0.35 * clump + 0.45 * tuft + 0.2 * fine;
  } else if (uLayer == 1) {
    // Soil: clods and small stones.
    vec3 c = voronoi(uv, 20, 0.9);
    vec3 s = voronoi(uv, 90, 0.9);
    float clod = 1.0 - smoothstep(0.1, 0.7, c.x);
    float stone = smoothstep(0.22, 0.12, s.x) * step(0.7, s.z);
    float grain = fbm(uv, 64, 3, 0.6);
    col = mix(vec3(0.115, 0.080, 0.052), vec3(0.150, 0.110, 0.075), c.z) * (0.75 + 0.5 * grain);
    col = mix(col * 0.75, col, clod);
    col = mix(col, vec3(0.25, 0.23, 0.20), stone);
    h = 0.55 * clod + 0.25 * grain + 0.35 * stone;
  } else if (uLayer == 2) {
    // Rock: jointed plates with cracks, grain and lichen.
    // Rock: irregular jointed plates (warped Voronoi, so joints wander), fine fractures, grain, lichen.
    vec2 wuv = uv + 0.035 * vec2(fbm(uv, 8, 3, 0.5), fbm(uv + 0.5, 8, 3, 0.5));
    vec3 a = voronoi(wuv, 4, 1.0);
    vec3 b = voronoi(wuv, 15, 1.0);
    float joint = smoothstep(0.0, 0.035, a.y - a.x);
    float fracture = smoothstep(0.0, 0.025, b.y - b.x);
    float grain = fbm(uv, 32, 5, 0.55);
    float lichen = smoothstep(0.6, 0.7, fbm(uv + 0.3, 12, 4, 0.5));
    col = mix(vec3(0.21, 0.20, 0.19), vec3(0.28, 0.25, 0.21), a.z) * (0.7 + 0.55 * grain);
    col = mix(col, vec3(0.22, 0.21, 0.12), lichen * 0.45);
    col *= mix(0.55, 1.0, joint) * mix(0.8, 1.0, fracture);
    h = (0.55 * (1.0 - 0.5 * a.x) + 0.3 * grain + 0.15 * b.z) * mix(0.4, 1.0, joint) * mix(0.85, 1.0, fracture);
  } else if (uLayer == 3) {
    // Gravel / scree: rounded stones of varied tone with dark gaps.
    vec3 v = voronoi(uv, 36, 0.85);
    vec3 w = voronoi(uv, 110, 0.85);
    float dome = sqrt(max(0.0, 1.0 - pow(v.x / max(0.5 * (v.x + v.y), 1e-3), 2.0)));
    float small = sqrt(max(0.0, 1.0 - pow(w.x / max(0.5 * (w.x + w.y), 1e-3), 2.0)));
    col = mix(vec3(0.20, 0.19, 0.18), vec3(0.32, 0.29, 0.25), v.z) * (0.85 + 0.3 * w.z);
    col *= mix(0.35, 1.0, max(dome, small * 0.7));
    h = max(dome, 0.5 * small);
  } else if (uLayer == 4) {
    // Snow: wind-drifted, faintly blue in hollows.
    float d = fbm(uv, 6, 5, 0.5);
    float s = fbm(uv + 0.2, 24, 3, 0.5);
    h = 0.7 * d + 0.3 * s;
    col = mix(vec3(0.70, 0.75, 0.85), vec3(0.88, 0.89, 0.91), smoothstep(0.3, 0.6, h));
  } else if (uLayer == 5) {
    // Sand: wind ripples and grain.
    float warp = fbm(uv, 4, 3, 0.5);
    float rip = 0.5 + 0.5 * sin(6.2831853 * (uv.y * 28.0 + 1.5 * warp + 0.4 * uv.x));
    float grain = fbm(uv, 128, 2, 0.6);
    col = mix(vec3(0.40, 0.35, 0.26), vec3(0.48, 0.43, 0.33), fbm(uv, 8, 3, 0.5)) * (0.85 + 0.3 * grain);
    h = 0.6 * rip + 0.4 * grain;
  } else if (uLayer == 7) {
    // Forest canopy seen from above: tree crowns 4.5-8.5 m across (two sizes), each a leafy dome with its own
    // tone, and deep shadowed gaps between them. Albedo is linear-physical (the shader uses it directly):
    // sunlit leaves ~0.09 green, the gaps a few times darker.
    vec3 big = voronoi(uv, 9, 0.85);
    vec3 small = voronoi(uv + 0.37, 17, 0.9);
    float rb = 0.5 * (big.x + big.y);
    float rs = 0.5 * (small.x + small.y);
    float db = sqrt(max(0.0, 1.0 - pow(big.x / max(rb, 1e-3), 2.0)));
    float ds = sqrt(max(0.0, 1.0 - pow(small.x / max(rs, 1e-3), 2.0)));
    // Leaf clusters on each crown.
    float leafy = fbm(uv, 96, 3, 0.6);
    float clusters = 1.0 - voronoi(uv, 70, 1.0).x;
    float dome = max(db, 0.8 * ds);
    float id = db > 0.8 * ds ? big.z : small.z;
    h = dome * (0.75 + 0.25 * clusters) + 0.08 * leafy;
    vec3 leaf = mix(vec3(0.030, 0.066, 0.022), vec3(0.046, 0.076, 0.026), id);
    leaf *= 0.65 + 0.5 * clusters * leafy + 0.25 * id;
    // Crown edges curve away and are shaded by the neighbours; the gaps are deep understorey shadow.
    leaf *= 0.55 + 0.45 * smoothstep(0.2, 0.9, dome);
    col = mix(vec3(0.006, 0.011, 0.005), leaf, smoothstep(0.08, 0.4, dome));
  } else {
    // Forest floor: needles and leaf litter with moss.
    float litter = fbm(uv, 24, 4, 0.6);
    vec3 v = voronoi(uv, 60, 1.0);
    float moss = smoothstep(0.5, 0.65, fbm(uv + 0.8, 5, 4, 0.5));
    col = mix(vec3(0.075, 0.052, 0.035), vec3(0.11, 0.075, 0.045), v.z) * (0.7 + 0.6 * litter);
    col = mix(col, vec3(0.05, 0.085, 0.03), moss);
    h = 0.6 * litter + 0.4 * (1.0 - v.x) + 0.3 * moss;
  }
  gl_FragColor = vec4(pow(clamp(col, 0.0, 1.0), vec3(1.0 / 2.2)), clamp(h, 0.0, 1.0));
}
`;

const NORMAL_FRAG = /* glsl */ `
precision highp sampler2DArray;
uniform sampler2DArray tAlbedo;
uniform int uLayer;
uniform float uStrength;
uniform float uRoughness;
varying vec2 vUv;
float H(ivec2 p, int size) { return texelFetch(tAlbedo, ivec3((p + size) % size, uLayer), 0).a; }
void main() {
  int size = textureSize(tAlbedo, 0).x;
  ivec2 p = ivec2(vUv * float(size));
  float h = H(p, size);
  float dx = H(p + ivec2(1, 0), size) - H(p - ivec2(1, 0), size);
  float dy = H(p + ivec2(0, 1), size) - H(p - ivec2(0, 1), size);
  vec3 n = normalize(vec3(-dx * uStrength, -dy * uStrength, 1.0));
  // Cavity: how far below its neighbourhood average this texel sits.
  float avg = 0.0;
  for (int y = -3; y <= 3; y += 2) for (int x = -3; x <= 3; x += 2) avg += H(p + ivec2(x, y), size);
  avg /= 16.0;
  float cavity = clamp(1.0 - 2.5 * (avg - h), 0.35, 1.0);
  gl_FragColor = vec4(n.xy * 0.5 + 0.5, clamp(uRoughness + 0.12 * (0.5 - h), 0.0, 1.0), cavity);
}
`;

// Per layer: normal strength (texels per unit height) and base roughness.
const NORMAL_PARAMS: Array<[number, number]> = [
  [4, 0.95], // grass
  [5, 0.95], // soil
  [7, 0.85], // rock
  [6, 0.9], // gravel
  [2, 0.6], // snow
  [3, 0.9], // sand
  [4, 0.95], // forest floor
  [10, 0.9], // canopy
];

/** Base roughness per layer (what the detail textures average to). */
export const LAYER_ROUGHNESS = NORMAL_PARAMS.map((p) => p[1]);

const SIZE = 512;

export function createTerrainTextures(renderer: THREE.WebGLRenderer): TerrainTextures {
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  // One triangle covering the viewport.
  const tri = new THREE.BufferGeometry();
  tri.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  tri.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
  const quad = new THREE.Mesh(tri);
  quad.frustumCulled = false;
  scene.add(quad);

  const prevTarget = renderer.getRenderTarget();
  const prevAutoClear = renderer.autoClear;
  renderer.autoClear = false;
  const aniso = renderer.capabilities.getMaxAnisotropy();

  const noiseRT = new THREE.WebGLRenderTarget(256, 256, {
    type: THREE.UnsignedByteType,
    generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: THREE.RepeatWrapping,
    wrapT: THREE.RepeatWrapping,
    depthBuffer: false,
  });
  const noiseMat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: NOISE_FRAG, uniforms: { uSeed: { value: 11 } } });
  quad.material = noiseMat;
  renderer.setRenderTarget(noiseRT);
  renderer.render(scene, camera);

  const arrayTarget = (): THREE.WebGLArrayRenderTarget => {
    const rt = new THREE.WebGLArrayRenderTarget(SIZE, SIZE, LAYER_COUNT, {
      type: THREE.UnsignedByteType,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
    });
    rt.texture.wrapS = rt.texture.wrapT = THREE.RepeatWrapping;
    rt.texture.anisotropy = aniso;
    return rt;
  };
  const albedoRT = arrayTarget();
  const albedoMat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: ALBEDO_FRAG,
    uniforms: { uSeed: { value: 3 }, uLayer: { value: 0 } },
  });
  quad.material = albedoMat;
  for (let l = 0; l < LAYER_COUNT; l++) {
    albedoMat.uniforms.uLayer.value = l;
    albedoMat.uniforms.uSeed.value = 3 + l * 13;
    renderer.setRenderTarget(albedoRT, l);
    renderer.render(scene, camera);
  }

  const normalRT = arrayTarget();
  const normalMat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: NORMAL_FRAG,
    uniforms: { tAlbedo: { value: albedoRT.texture }, uLayer: { value: 0 }, uStrength: { value: 1 }, uRoughness: { value: 1 } },
  });
  quad.material = normalMat;
  for (let l = 0; l < LAYER_COUNT; l++) {
    normalMat.uniforms.uLayer.value = l;
    normalMat.uniforms.uStrength.value = NORMAL_PARAMS[l][0];
    normalMat.uniforms.uRoughness.value = NORMAL_PARAMS[l][1];
    renderer.setRenderTarget(normalRT, l);
    renderer.render(scene, camera);
  }

  // Layer means: read each layer's 1x1 mip back once (a uniform, instead of a texture fetch per layer and
  // pixel in the terrain shader). The read-back is asynchronous so it does not stall the GPU; the vectors
  // are filled in place when it completes.
  const meanRT = new THREE.WebGLRenderTarget(LAYER_COUNT, 1, { type: THREE.UnsignedByteType, depthBuffer: false });
  const meanMat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: /* glsl */ `
      precision highp sampler2DArray;
      uniform sampler2DArray tAlbedo;
      void main() { gl_FragColor = vec4(textureLod(tAlbedo, vec3(0.5, 0.5, floor(gl_FragCoord.x)), 16.0).rgb, 1.0); }`,
    uniforms: { tAlbedo: { value: albedoRT.texture } },
  });
  quad.material = meanMat;
  renderer.setRenderTarget(meanRT);
  renderer.render(scene, camera);
  const layerMeans = Array.from({ length: LAYER_COUNT }, () => new THREE.Vector3(0.1, 0.1, 0.1));
  const px = new Uint8Array(LAYER_COUNT * 4);
  const ready = renderer
    .readRenderTargetPixelsAsync(meanRT, 0, 0, LAYER_COUNT, 1, px)
    .then(() => {
      layerMeans.forEach((m, l) => {
        const c = (i: number): number => Math.max(1e-3, Math.pow(px[l * 4 + i] / 255, 2.2));
        m.set(c(0), c(1), c(2));
      });
    })
    .finally(() => {
      meanRT.dispose();
      meanMat.dispose();
    });

  renderer.setRenderTarget(prevTarget);
  renderer.autoClear = prevAutoClear;
  noiseMat.dispose();
  albedoMat.dispose();
  normalMat.dispose();
  tri.dispose();

  return {
    noise: noiseRT.texture,
    albedo: albedoRT.texture as unknown as THREE.DataArrayTexture,
    normal: normalRT.texture as unknown as THREE.DataArrayTexture,
    layerMeans,
    ready,
    dispose() {
      noiseRT.dispose();
      albedoRT.dispose();
      normalRT.dispose();
    },
  };
}
