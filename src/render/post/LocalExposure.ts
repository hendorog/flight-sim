// Local exposure (local tone mapping), as a good camera's HDR processing or the eye's local adaptation
// does: large regions much darker than the adapted level (a cockpit interior against a bright sky, a
// valley in shadow) are lifted, and regions much brighter are held back, while detail within a region
// keeps its full contrast.
//
// A 1/32-resolution map of the frame's mean log luminance is built from the bloom chain's 1/8 level
// (one pass, 16 bilinear taps per texel). The tone-mapping pass upsamples it with a joint bilateral
// filter guided by each pixel's own luminance (LOCAL_EXPOSURE_GLSL), so a panel pixel next to a bright
// window takes the interior's level, not the window's: no halo around the window frame.

import * as THREE from 'three';
import { FullscreenPass, passMaterial } from './FullscreenPass';

/** Downsampling factor of the local luminance map relative to the output. */
export const LOCAL_MAP_SCALE = 32;

const LOCAL_MAP_FRAG = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uSrcTexel;
varying vec2 vUv;
void main() {
  // The 1/8 source has 4x4 texels per output texel. 4x4 bilinear taps two texels apart (each averaging a
  // 2x2 block) cover the 8x8 texels around it, a little wider than the texel itself for a smooth map,
  // and average in log space (a geometric mean, so a few very bright pixels do not dominate).
  float s = 0.0;
  for (int i = 0; i < 4; i++) {
    for (int j = 0; j < 4; j++) {
      vec2 o = (vec2(float(i), float(j)) - 1.5) * uSrcTexel;
      float l = dot(texture2D(tSrc, vUv + o).rgb, vec3(0.2126, 0.7152, 0.0722));
      s += log2(clamp(isnan(l) ? 0.0 : l, 1e-9, 6e4));
    }
  }
  gl_FragColor = vec4(s / 16.0, 0.0, 0.0, 1.0);
}
`;

/**
 * GLSL for the tone-mapping pass: localExposureEV(logL, pivot) returns the EV adjustment for a pixel of
 * log2 luminance logL, given the globally adapted log2 luminance `pivot`.
 */
export const LOCAL_EXPOSURE_GLSL = /* glsl */ `
uniform sampler2D tLocal;
uniform vec4 uLocal; // lift (EV per EV below the pivot), max lift (EV), max cut (EV), cut (EV per EV above)
float localExposureEV(float logL, float pivot) {
  if (uLocal.x <= 0.0 && uLocal.w <= 0.0) return 0.0;
  ivec2 size = textureSize(tLocal, 0);
  vec2 p = vUv * vec2(size) - 0.5;
  ivec2 base = ivec2(floor(p)) - 1;
  vec2 f = p - floor(p);
  float sum = 0.0;
  float wsum = 0.0;
  for (int j = 0; j < 4; j++) {
    for (int i = 0; i < 4; i++) {
      ivec2 q = clamp(base + ivec2(i, j), ivec2(0), size - 1);
      float l = texelFetch(tLocal, q, 0).r;
      // Spatial cubic B-spline (radius 2 texels): zero with zero slope at the edge of the 4x4 window, so
      // the result stays smooth (no Mach bands in sky gradients) as the window steps from texel to
      // texel. Times a range Gaussian (sigma 1.5 EV) around the pixel's own level; the tiny
      // spatial-only term is the fallback when nothing matches.
      vec2 d = abs(vec2(float(i - 1), float(j - 1)) - f);
      vec2 t = mix((4.0 - 6.0 * d * d + 3.0 * d * d * d), pow(max(2.0 - d, 0.0), vec2(3.0)), step(1.0, d)) / 6.0;
      float ws = t.x * t.y;
      float dl = (l - logL) / 1.5;
      float w = ws * (exp(-0.5 * dl * dl) + 1e-4);
      sum += w * l;
      wsum += w;
    }
  }
  float d = sum / wsum - pivot;
  // Regions up to diffuse white under the adapted light (~2.3 EV over the adapted grey) are not cut:
  // sunlit cloud and white paint keep their brightness; only brighter regions (the sky around a low sun,
  // specular glare) are held back.
  return d < 0.0 ? min(-uLocal.x * d, uLocal.y) : -min(uLocal.w * max(d - 2.3, 0.0), uLocal.z);
}
`;

export class LocalExposure {
  private target = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
    format: THREE.RedFormat,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    depthBuffer: false,
  });
  private readonly pass = new FullscreenPass();
  private readonly mat = passMaterial({ fragmentShader: LOCAL_MAP_FRAG, uniforms: { tSrc: { value: null }, uSrcTexel: { value: new THREE.Vector2() } } });

  get texture(): THREE.Texture {
    return this.target.texture;
  }

  setSize(width: number, height: number): void {
    this.target.setSize(Math.max(1, Math.ceil(width / LOCAL_MAP_SCALE)), Math.max(1, Math.ceil(height / LOCAL_MAP_SCALE)));
  }

  /** @param eighth the frame downsampled to 1/8 resolution (bloom level 2), before the bloom upsample */
  update(renderer: THREE.WebGLRenderer, eighth: THREE.WebGLRenderTarget): void {
    this.mat.uniforms.tSrc.value = eighth.texture;
    this.mat.uniforms.uSrcTexel.value.set(2 / eighth.width, 2 / eighth.height);
    this.pass.render(renderer, this.mat, this.target);
  }

  dispose(): void {
    this.target.dispose();
    this.mat.dispose();
  }
}
