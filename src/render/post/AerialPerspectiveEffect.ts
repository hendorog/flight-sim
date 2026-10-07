// Aerial perspective: in-scattering and extinction between the camera and every opaque pixel, from the
// same atmosphere as the sky, so distant terrain fades into exactly the sky's horizon colour.
//
// Following Hillaire 2020 (section 5.4) the scattering is integrated per frame into a camera-aligned
// froxel volume (32x32 screen cells x 32 depth slices, slice k at distance MAX * ((k+1)/32)^2, so
// near slices are dense) holding in-scattered radiance (rgb) and green transmittance (a). The volume is
// stored as a 2D atlas of the slices side by side (1024 x 32) and filled in ONE draw (a 3D target needs
// one draw and one framebuffer-layer switch per slice). The composite pass reconstructs each pixel's
// distance from the logarithmic depth buffer and samples the volume (AERIAL_ATLAS_GLSL). The volume is
// published on the shared Atmosphere (Atmosphere.aerial) so other effects (clouds) can fade with exactly
// the same haze instead of integrating their own.
// The scene is FLAT (no curvature drop), so the rays are integrated in flat geometry (see
// FLAT_SCATTERING_GLSL). Sky pixels above the flat horizon pass through untouched; sky pixels below it
// (beyond the terrain's far edge) become flat ground hazed along the same rays, so terrain, sea and the
// horizon sky meet without a band at any altitude. This pass also clamps NaN/Inf from the scene render
// so no stray value can poison bloom and exposure downstream.

import * as THREE from 'three';
import { CAMERA_FAR, type SceneEffect, type SimContext } from '../../core/context';
import { DEPTH_GLSL } from '../../core/shaderLib';
import { Atmosphere } from '../sky/Atmosphere';
import { ATMOSPHERE_GLSL } from '../sky/glsl/atmosphere';
import { FullscreenPass, passMaterial } from './FullscreenPass';

const FROXELS_XY = 32;
const SLICES = 32;
/** Depth of the volume, km: the camera's far plane. */
const MAX_DISTANCE_KM = CAMERA_FAR / 1000;

// The scene geometry is FLAT (no curvature drop), so rays are integrated in flat geometry: altitude
// changes linearly along them and a light's elevation is the same everywhere. A ray that descends toward
// the flat horizon passes through the same dense boundary-layer air as the terrain it ends on, and far
// terrain converges on the saturated in-scattering of the horizon sky.
const FLAT_SCATTERING_GLSL = /* glsl */ `
${ATMOSPHERE_GLSL}
uniform float uCamR;
uniform vec3 uSunDir;
uniform vec3 uMoonDir;
uniform vec3 uSunE;
uniform vec3 uMoonE;
uniform vec2 uAirLight;

vec3 flatLightScattering(float h, vec3 rd, vec3 l, vec3 e, vec3 scatR, vec3 scatM) {
  float r = uRb + h;
  float c = dot(rd, l);
  vec3 single = transmittanceToTop(r, l.y) * planetShadow(r, l.y) * (scatR * phaseRayleigh(c) + scatM * phaseMie(c));
  return e * (single + multiScatter(r, l.y) * (scatR + scatM));
}

// In-scattered radiance (rgb) and green transmittance (a) from the camera to distance tMax km along rd,
// with samples spaced quadratically (dense near the camera, where most of the change happens).
vec4 flatScattering(vec3 rd, float tMax, float steps) {
  float h0 = uCamR - uRb;
  bool second = dot(uMoonE, uMoonE) > 0.0;
  vec3 radiance = vec3(0.0);
  vec3 throughput = vec3(1.0);
  float tPrev = 0.0;
  for (float i = 0.0; i < steps; i += 1.0) {
    float u1 = (i + 1.0) / steps;
    float tNext = tMax * u1 * u1;
    float dt = tNext - tPrev;
    float t = tPrev + 0.5 * dt;
    tPrev = tNext;
    float h = max(h0 + t * rd.y, 0.0);
    vec3 scatR, scatM, extinction;
    sampleMedium(h, scatR, scatM, extinction);
    vec3 s = flatLightScattering(h, rd, uSunDir, uSunE, scatR, scatM);
    if (second) s += flatLightScattering(h, rd, uMoonDir, uMoonE, scatR, scatM);
    vec3 stepT = exp(-extinction * dt);
    radiance += throughput * (s - s * stepT) / max(extinction, vec3(1e-9));
    throughput *= stepT;
  }
  // Below a cloud layer the air is lit only by what the clouds let through (SkySystem / cloudSky.ts).
  radiance = mix(radiance, vec3(dot(radiance, vec3(0.2126, 0.7152, 0.0722))), uAirLight.y) * uAirLight.x;
  return vec4(radiance, throughput.g);
}
`;

const FROXEL_FRAG = /* glsl */ `
${FLAT_SCATTERING_GLSL}
uniform mat3 uCamToWorld;
uniform vec2 uTanHalf;
void main() {
  // Atlas texel -> slice and cell centre.
  vec2 p = floor(gl_FragCoord.xy);
  float slice = floor(p.x / ${FROXELS_XY}.0);
  vec2 uv = (vec2(p.x - slice * ${FROXELS_XY}.0, p.y) + 0.5) / ${FROXELS_XY}.0;
  vec3 rd = normalize(uCamToWorld * vec3((uv * 2.0 - 1.0) * uTanHalf, -1.0));
  float w = (slice + 1.0) / ${SLICES}.0;
  gl_FragColor = flatScattering(rd, ${MAX_DISTANCE_KM.toFixed(1)} * w * w, min(4.0 + slice * 0.6, 20.0));
}
`;

/**
 * Lookup into the aerial-perspective atlas, for any full-screen pass that binds Atmosphere.aerial.uniforms:
 *   vec4 aerialPerspective(vec2 screenUv, float distanceM)  // rgb in-scattered radiance, a green transmittance
 * In front of the first slice both terms grow linearly from zero at the camera.
 */
export const AERIAL_ATLAS_GLSL = /* glsl */ `
uniform sampler2D uAerialAtlas;
uniform float uAerialMax;   // depth of the volume, m
vec4 aerialSlice(vec2 uv, float slice) {
  vec2 c = clamp(uv, vec2(0.5 / ${FROXELS_XY}.0), vec2(1.0 - 0.5 / ${FROXELS_XY}.0));
  return texture(uAerialAtlas, vec2((slice + c.x) / ${SLICES}.0, c.y));
}
vec4 aerialPerspective(vec2 uv, float dist) {
  // Slice k is centred at w = k + 1.
  float w = sqrt(max(dist, 0.0) / uAerialMax) * ${SLICES}.0;
  float s = clamp(w - 1.0, 0.0, ${SLICES - 1}.0);
  float s0 = floor(s);
  vec4 ap = mix(aerialSlice(uv, s0), aerialSlice(uv, min(s0 + 1.0, ${SLICES - 1}.0)), s - s0);
  float near = clamp(w, 0.0, 1.0);
  return vec4(ap.rgb * near, mix(1.0, ap.a, near));
}
`;

/** Haze path below the flat horizon (beyond the terrain's far edge): this many curved-horizon distances ... */
const HORIZON_PATH_FACTOR = 1.5;
/** ... but at least the terrain's drawing range, km. */
const MIN_BEYOND_KM = 150;

const COMPOSITE_FRAG = /* glsl */ `
${DEPTH_GLSL}
${FLAT_SCATTERING_GLSL}
${AERIAL_ATLAS_GLSL}
uniform sampler2D tInput;
uniform sampler2D tDepth;
uniform vec2 uTanHalf;
uniform mat3 uCamToWorld;
uniform vec3 uSpectralRatio;
uniform vec3 uGroundRadiance;
uniform float uCloudDistBase;   // m from the camera up to the cloud base; 0 = no layer above the camera
varying vec2 vUv;

// The volume stores the green transmittance; red and blue follow from the extinction spectrum of the
// low-level air (T_c = T_g ^ (beta_c / beta_g)), so distant terrain loses blue first.
vec3 spectralTransmittance(float tg) { return pow(vec3(max(tg, 1e-6)), uSpectralRatio); }

void main() {
  vec3 c = texture2D(tInput, vUv).rgb;
  c = any(isnan(c)) ? vec3(0.0) : min(c, vec3(60000.0));
  float d = texture2D(tDepth, vUv).r;
  vec3 view = vec3((vUv * 2.0 - 1.0) * uTanHalf, -1.0);
  if (!isSky(d)) {
    vec4 ap = aerialPerspective(vUv, viewZFromDepth(d) * length(view));
    c = c * spectralTransmittance(ap.a) + ap.rgb;
  } else {
    // The dome is the clear-sky LUT. Below a cloud layer the air between the camera and the cloud base
    // is lit only by what the clouds let through, as the terrain's and the clouds' haze already are
    // (uAirLight). Swap the dome's in-scattering over that stretch for the dimmed one: the volume holds it
    // dimmed (M v); the clear value is M^-1 of that. Without this, behind thick haze the sky in the
    // gaps and above the fogged-out clouds and terrain stayed brighter than they, a visible silhouette.
    vec3 rdSky = normalize(uCamToWorld * view);
    if (uCloudDistBase > 0.0 && rdSky.y > 0.0 && (uAirLight.x < 0.999 || uAirLight.y > 0.001)) {
      vec3 dimmed = aerialPerspective(vUv, min(uCloudDistBase / rdSky.y, uAerialMax)).rgb;
      vec3 w = dimmed / max(uAirLight.x, 1e-3);
      vec3 clear = (w - uAirLight.y * dot(w, vec3(0.2126, 0.7152, 0.0722))) / max(1.0 - uAirLight.y, 1e-3);
      c = max(c - clear, vec3(0.0)) + dimmed;
    }
    // Below the flat horizon, beyond the terrain's far edge: flat ground at "infinity", hazed along the
    // same flat ray, instead of the curved-earth sky that the dome draws there. Blended over a
    // 0.6 degrees across the flat horizon so the haze horizon stays soft.
    vec3 rd = normalize(uCamToWorld * view);
    float below = smoothstep(0.003, -0.008, rd.y);
    if (below > 0.0) {
      // The path ends where the flat ray meets sea level, but no farther than ~1.5x the distance to the
      // curved-earth horizon: the sky dome just above is a curved-earth tangent ray, and a longer flat
      // path through low, dense air would saturate to a brighter, redder haze than the sky beside it.
      float h = max(uCamR - uRb, 0.0);
      float tMax = max(${HORIZON_PATH_FACTOR.toFixed(2)} * sqrt(2.0 * uRb * h), ${MIN_BEYOND_KM.toFixed(1)});
      if (rd.y < 0.0) tMax = min(tMax, h / -rd.y);
      vec4 ap = flatScattering(rd, tMax, 24.0);
      c = mix(c, uGroundRadiance * spectralTransmittance(ap.a) + ap.rgb, below);
    }
  }
  gl_FragColor = vec4(c, 1.0);
}
`;

export class AerialPerspectiveEffect implements SceneEffect {
  readonly name = 'aerialPerspective';

  private readonly volume = new THREE.WebGLRenderTarget(FROXELS_XY * SLICES, FROXELS_XY, {
    type: THREE.HalfFloatType,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: THREE.ClampToEdgeWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
    depthBuffer: false,
  });
  /** The published volume (Atmosphere.aerial): bind these uniforms and use AERIAL_ATLAS_GLSL. */
  readonly aerialUniforms = { uAerialAtlas: { value: this.volume.texture as THREE.Texture }, uAerialMax: { value: MAX_DISTANCE_KM * 1000 } };
  private readonly pass = new FullscreenPass();
  private readonly tanHalf = new THREE.Vector2();
  private readonly camToWorld = new THREE.Matrix3();
  private froxelMat: THREE.ShaderMaterial | null = null;
  private readonly compositeMat = passMaterial({
    fragmentShader: COMPOSITE_FRAG,
    uniforms: {
      tInput: { value: null },
      tDepth: { value: null },
      ...this.aerialUniforms,
      uTanHalf: { value: this.tanHalf },
      uSpectralRatio: { value: new THREE.Vector3(1, 1, 1) },
      uCamToWorld: { value: this.camToWorld },
      uCloudDistBase: { value: 0 },
    },
  });
  private compositeReady = false;

  setSize(): void {
    // Resolution independent: the froxel volume is fixed-size and the composite runs at the output size.
  }

  render(
    renderer: THREE.WebGLRenderer,
    input: THREE.Texture,
    depth: THREE.DepthTexture,
    output: THREE.WebGLRenderTarget,
    ctx: SimContext,
  ): void {
    const atmosphere = Atmosphere.for(renderer);
    atmosphere.ensureUpdated(ctx);
    const froxelMat = (this.froxelMat ??= passMaterial({
      fragmentShader: FROXEL_FRAG,
      uniforms: { ...atmosphere.uniforms, uCamToWorld: { value: this.camToWorld }, uTanHalf: { value: this.tanHalf } },
    }));
    atmosphere.aerial = this.aerialUniforms;

    const cam = ctx.camera;
    const tanY = Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2) / cam.zoom;
    this.tanHalf.set(tanY * cam.aspect, tanY);
    this.camToWorld.setFromMatrix4(cam.matrixWorld);

    const p = atmosphere.params;
    const beta = (i: number): number => p.rayleighScattering[i] + p.mieExtinction[i];
    this.compositeMat.uniforms.uSpectralRatio.value.set(beta(0) / beta(1), 1, beta(2) / beta(1));

    this.pass.render(renderer, froxelMat, this.volume);

    if (!this.compositeReady) {
      // Share the atmosphere's uniform objects (LUTs, camera radius, lights) with the composite pass.
      Object.assign(this.compositeMat.uniforms, atmosphere.uniforms, { uGroundRadiance: { value: atmosphere.groundRadiance } });
      this.compositeReady = true;
    }
    const clouds = atmosphere.cloudSky;
    this.compositeMat.uniforms.uCloudDistBase.value = clouds.cover > 0 ? clouds.distBase : 0;
    this.compositeMat.uniforms.tInput.value = input;
    this.compositeMat.uniforms.tDepth.value = depth;
    this.pass.render(renderer, this.compositeMat, output);
  }

  dispose(): void {
    this.volume.dispose();
    this.froxelMat?.dispose();
    this.compositeMat.dispose();
  }
}
