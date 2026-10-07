// Energy-conserving bloom (Jimenez 2014, "Next Generation Post Processing in Call of Duty: Advanced
// Warfare"): a 13-tap downsample chain to 1/64 resolution, then a tent-filtered upsample that adds each
// level into the one above. The result is a normalised wide blur of the image which the tone-mapping
// pass mixes in with a small weight, so bloom redistributes energy instead of adding it. The first
// downsample uses Karis's luminance-weighted average so single hot pixels (glints) cannot flicker, and
// caps each tap's exposed luminance (FIREFLY_MAX): tiny, extremely bright sources (a landing light head-on,
// floodlight lenses at 1e4-1e5 cd/m^2) would otherwise pour their whole energy into the 1/32-1/64 levels
// and show as a huge disc of blocky texels. Their own glare is drawn by the light sprites; the sun's
// veiling glare is modelled in the tone mapper. The metering (log average) is barely affected.

import * as THREE from 'three';
import { EXPOSURE_GLSL } from './AutoExposure';
import { FullscreenPass, passMaterial } from './FullscreenPass';

const DOWN_FRAG = /* glsl */ `
${EXPOSURE_GLSL}
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform bool uKaris;
uniform float uFireflyMax;
varying vec2 vUv;
float capScale;
// Non-finite values (a broken shader upstream) are dropped so they cannot spread through the chain.
vec3 tap(float x, float y) {
  vec3 c = texture2D(tSrc, vUv + vec2(x, y) * uTexel).rgb;
  c = any(isnan(c)) || any(isinf(c)) ? vec3(0.0) : min(c, vec3(60000.0));
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  return c * min(1.0, capScale / max(l, 1e-9));
}
// Karis weights are judged on exposed values so they suppress what will look like fireflies on screen.
float karis(vec3 c, float exposure) { return 1.0 / (1.0 + exposure * dot(c, vec3(0.2126, 0.7152, 0.0722))); }
void main() {
  capScale = uKaris ? uFireflyMax / sceneExposure() : 1e30;
  vec3 a = tap(-2.0, 2.0), b = tap(0.0, 2.0), c = tap(2.0, 2.0);
  vec3 d = tap(-2.0, 0.0), e = tap(0.0, 0.0), f = tap(2.0, 0.0);
  vec3 g = tap(-2.0, -2.0), h = tap(0.0, -2.0), i = tap(2.0, -2.0);
  vec3 j = tap(-1.0, 1.0), k = tap(1.0, 1.0), l = tap(-1.0, -1.0), m = tap(1.0, -1.0);
  // Five overlapping 2x2 boxes: the inner one weighted 0.5, the four outer ones 0.125 each.
  vec3 g0 = (j + k + l + m) * 0.25;
  vec3 g1 = (a + b + d + e) * 0.25;
  vec3 g2 = (b + c + e + f) * 0.25;
  vec3 g3 = (d + e + g + h) * 0.25;
  vec3 g4 = (e + f + h + i) * 0.25;
  float w0 = 0.5, w1 = 0.125, w2 = 0.125, w3 = 0.125, w4 = 0.125;
  if (uKaris) {
    float x = sceneExposure();
    w0 *= karis(g0, x); w1 *= karis(g1, x); w2 *= karis(g2, x); w3 *= karis(g3, x); w4 *= karis(g4, x);
  }
  gl_FragColor = vec4((g0 * w0 + g1 * w1 + g2 * w2 + g3 * w3 + g4 * w4) / (w0 + w1 + w2 + w3 + w4), 1.0);
}
`;

const UP_FRAG = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uTexel;
varying vec2 vUv;
vec3 tap(float x, float y) { return texture2D(tSrc, vUv + vec2(x, y) * uTexel).rgb; }
void main() {
  vec3 s = tap(0.0, 0.0) * 4.0
    + (tap(-1.0, 0.0) + tap(1.0, 0.0) + tap(0.0, -1.0) + tap(0.0, 1.0)) * 2.0
    + tap(-1.0, -1.0) + tap(1.0, -1.0) + tap(-1.0, 1.0) + tap(1.0, 1.0);
  gl_FragColor = vec4(s / 16.0, 1.0);
}
`;

/**
 * Largest exposed luminance a pixel contributes to bloom (display white is ~16 in AgX's input range):
 * 2 EV over white, so bright skies and lit clouds bloom as before while point lamps cannot flood the frame.
 */
const FIREFLY_MAX = 64;

export class Bloom {
  private mips: THREE.WebGLRenderTarget[] = [];
  private readonly pass = new FullscreenPass();
  private readonly down: THREE.ShaderMaterial;
  private readonly up = passMaterial({
    fragmentShader: UP_FRAG,
    uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } },
    blending: THREE.AdditiveBlending,
  });

  /** @param exposureUniforms tExposure / uExposureBias for EXPOSURE_GLSL, shared with the tone mapper. */
  constructor(
    exposureUniforms: Record<string, THREE.IUniform>,
    private readonly levels = 6,
  ) {
    this.down = passMaterial({
      fragmentShader: DOWN_FRAG,
      uniforms: { ...exposureUniforms, tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uKaris: { value: false }, uFireflyMax: { value: FIREFLY_MAX } },
    });
  }

  /** Normalised bloom (the full blur chain divided by its level count). */
  get texture(): THREE.Texture {
    return this.mips[0].texture;
  }
  /** Weight that turns `texture` into an energy-normalised blur. */
  get normalisation(): number {
    return 1 / this.levels;
  }
  /** A downsampled copy of the frame at 1/2^(level+1) resolution (valid until the upsample overwrites it). */
  level(i: number): THREE.WebGLRenderTarget {
    return this.mips[i];
  }

  setSize(width: number, height: number): void {
    for (const m of this.mips) m.dispose();
    this.mips = [];
    for (let i = 0; i < this.levels; i++) {
      const w = Math.max(1, width >> (i + 1));
      const h = Math.max(1, height >> (i + 1));
      this.mips.push(
        new THREE.WebGLRenderTarget(w, h, {
          type: THREE.HalfFloatType,
          minFilter: THREE.LinearFilter,
          magFilter: THREE.LinearFilter,
          depthBuffer: false,
        }),
      );
    }
  }

  /** Downsample `input`; `beforeUpsample` may read the mip chain (e.g. for metering) before it is summed. */
  render(renderer: THREE.WebGLRenderer, input: THREE.Texture, beforeUpsample: () => void): void {
    const du = this.down.uniforms;
    let src = input;
    let srcW = this.mips[0].width * 2;
    let srcH = this.mips[0].height * 2;
    this.mips.forEach((mip, i) => {
      du.tSrc.value = src;
      du.uTexel.value.set(1 / srcW, 1 / srcH);
      du.uKaris.value = i === 0;
      this.pass.render(renderer, this.down, mip);
      src = mip.texture;
      srcW = mip.width;
      srcH = mip.height;
    });
    beforeUpsample();
    const uu = this.up.uniforms;
    for (let i = this.levels - 1; i > 0; i--) {
      const lower = this.mips[i];
      uu.tSrc.value = lower.texture;
      uu.uTexel.value.set(1 / lower.width, 1 / lower.height);
      this.pass.render(renderer, this.up, this.mips[i - 1]);
    }
  }

  dispose(): void {
    for (const m of this.mips) m.dispose();
    this.down.dispose();
    this.up.dispose();
  }
}
