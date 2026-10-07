// Eye adaptation. The frame's centre-weighted mean log luminance is reduced on the GPU (a 64x64
// log-luminance target averaged through its mip chain), then a 1x1 target adapts toward it over time.
// Nothing is read back to the CPU; the tone-mapping and bloom passes read the 1x1 texture directly.
//
// Exposure follows the classic key-value model (Reinhard 2002) with the key lowered in dark scenes, as
// the eye does (and as photographers do at dusk): a moonlit night stays dark and blue-grey instead of
// being pushed to daylight brightness, and twilight keeps its mood.

import * as THREE from 'three';
import { SCENE_UNITS_PER_LUX } from '../sky/params';
import { FullscreenPass, passMaterial } from './FullscreenPass';

const METER_SIZE = 64;
/** Adaptation time constants, s: faster toward bright (pupil) than toward dark (retina). */
const TAU_BRIGHTEN = 0.6;
const TAU_DARKEN = 1.8;
/**
 * Share of the adaptation target taken from the frame's metering rather than the illumination level
 * (an incident-light reading), for frames darker and brighter than an average scene under that light.
 * Darker frames (a cockpit interior, a shaded valley) pull the exposure up by half their difference, as
 * the eye adapts to what it looks at. Brighter frames (a field of sunlit cumulus, snow) pull it down only a
 * quarter: an averaging meter would render them mid-grey, but they are white, and the eye (like an
 * incident meter) keeps them white.
 */
const METER_WEIGHT_DARK = 0.5;
const METER_WEIGHT_BRIGHT = 0.25;

/**
 * GLSL: exposure multiplier from the adapted luminance texture. Luminances are log2 of scene units.
 * Middle grey maps to 0.18 in daylight; below ~EV 11 (2000 cd/m^2) the key drops 0.2 EV per EV,
 * floored at -4.5 EV for a moonless night.
 */
export const EXPOSURE_GLSL = /* glsl */ `
uniform sampler2D tExposure;
uniform float uExposureBias;
float sceneExposure() {
  float logL = texture2D(tExposure, vec2(0.5)).r;
  float ev = logL - log2(${SCENE_UNITS_PER_LUX.toExponential(6)});
  float keyBias = max(-0.2 * max(0.0, 11.0 - ev), -4.5);
  return 0.18 * exp2(keyBias + uExposureBias - logL);
}
`;

const METER_FRAG = /* glsl */ `
uniform sampler2D tSrc;
varying vec2 vUv;
void main() {
  float lum = dot(texture2D(tSrc, vUv).rgb, vec3(0.2126, 0.7152, 0.0722));
  vec2 p = vUv - 0.5;
  float w = exp(-4.0 * dot(p, p));
  gl_FragColor = vec4(w * log2(max(lum, 1e-9)), w, 0.0, 1.0);
}
`;

const ADAPT_FRAG = /* glsl */ `
uniform sampler2D tMeter;
uniform sampler2D tPrevious;
uniform float uDt;
uniform bool uReset;
uniform vec2 uLimits;
uniform float uReference;
varying vec2 vUv;
void main() {
  vec2 m = textureLod(tMeter, vec2(0.5), ${Math.log2(METER_SIZE).toFixed(1)}).rg;
  // Partly the frame, partly the scene's illumination level: a white wing filling the view should not
  // turn the rest of the world black, as the eye adapts mostly to the ambient light.
  float metered = m.x / max(m.y, 1e-6) - uReference;
  float target = clamp(uReference + metered * (metered < 0.0 ? ${METER_WEIGHT_DARK.toFixed(2)} : ${METER_WEIGHT_BRIGHT.toFixed(2)}), uLimits.x, uLimits.y);
  float prev = texture2D(tPrevious, vec2(0.5)).r;
  float tau = target > prev ? ${TAU_BRIGHTEN.toFixed(2)} : ${TAU_DARKEN.toFixed(2)};
  float adapted = uReset ? target : prev + (target - prev) * (1.0 - exp(-uDt / tau));
  gl_FragColor = vec4(adapted, target, 0.0, 1.0);
}
`;

export class AutoExposure {
  private readonly meter = new THREE.WebGLRenderTarget(METER_SIZE, METER_SIZE, {
    type: THREE.HalfFloatType,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
    generateMipmaps: true,
    depthBuffer: false,
  });
  private adapted = [0, 1].map(() => new THREE.WebGLRenderTarget(1, 1, { type: THREE.FloatType, depthBuffer: false }));
  private readonly pass = new FullscreenPass();
  private readonly meterMat = passMaterial({ fragmentShader: METER_FRAG, uniforms: { tSrc: { value: null } } });
  private readonly adaptMat = passMaterial({
    fragmentShader: ADAPT_FRAG,
    uniforms: {
      tMeter: { value: this.meter.texture },
      tPrevious: { value: null },
      uDt: { value: 0 },
      uReset: { value: true },
      uReference: { value: 0 },
      // Adaptation range: 1e-5 .. 1e5 cd/m^2.
      uLimits: { value: new THREE.Vector2(Math.log2(1e-5 * SCENE_UNITS_PER_LUX), Math.log2(1e5 * SCENE_UNITS_PER_LUX)) },
    },
  });
  private reset = true;

  /** The adapted luminance (log2, scene units) for EXPOSURE_GLSL's tExposure. */
  get texture(): THREE.Texture {
    return this.adapted[0].texture;
  }

  /** Jump straight to the current scene's exposure on the next update (after a teleport or cut). */
  snap(): void {
    this.reset = true;
  }

  /**
   * Meter `source` (any downsampled HDR copy of the frame) and adapt over `dt` seconds of real time.
   * @param referenceLuminance luminance of an 18 % grey card under the current light, scene units
   */
  update(renderer: THREE.WebGLRenderer, source: THREE.Texture, dt: number, referenceLuminance: number): void {
    this.meterMat.uniforms.tSrc.value = source;
    this.pass.render(renderer, this.meterMat, this.meter);
    this.adapted.reverse();
    const u = this.adaptMat.uniforms;
    u.tPrevious.value = this.adapted[1].texture;
    u.uDt.value = dt;
    u.uReset.value = this.reset;
    u.uReference.value = Math.log2(Math.max(referenceLuminance, 1e-9));
    this.pass.render(renderer, this.adaptMat, this.adapted[0]);
    this.reset = false;
  }

  dispose(): void {
    this.meter.dispose();
    for (const t of this.adapted) t.dispose();
    this.meterMat.dispose();
    this.adaptMat.dispose();
  }
}
