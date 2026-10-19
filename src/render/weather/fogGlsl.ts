// GLSL port of the ground fog medium (fogModel.ts) for the fog composite (FogEffect.ts) and the light sprites that
// add a fog aureole (world/airport/lights.ts, render/aircraft/lights.ts), plus the per-renderer fog uniform those
// sprites read.
//
//   uniform vec4 uFog;   // beta (1/m), yA (m), yTop (m), 1 = fog present / 0 = none
//   float fogDensity(float y)
//   float fogOpticalDepth(vec3 a, vec3 b)                  // straight segment a -> b, three.js world (y = MSL)
//   float fogPhaseHG(float cosTheta, float g)
//
// FOG_GLSL declares uFog itself; a material that includes it adds a uFog uniform (fogUniformFor or its own).

import * as THREE from 'three';
import { AIRPORT } from '../../core/world';
import type { WeatherSettings } from '../../core/types';
import { fogOf, type FogLayer } from '../../core/weatherFields';
import { FOG_FLAT_DY_M, fogShape, type FogShape } from './fogModel';

export const FOG_GLSL = /* glsl */ `
uniform vec4 uFog;
float fogDensity(float y) {
  float h = uFog.z - uFog.y;
  if (!(h > 0.0)) return y < uFog.z ? 1.0 : 0.0;
  return 1.0 - smoothstep(uFog.y, uFog.z, y);
}
// Antiderivative of fogDensity over altitude, relative to yA (fogModel.ts).
float fogCumulative(float y) {
  float h = uFog.z - uFog.y;
  if (!(h > 0.0)) return min(y, uFog.z) - uFog.y;
  float s = clamp((y - uFog.y) / h, 0.0, 1.0);
  float s3 = s * s * s;
  return min(y - uFog.y, 0.0) + h * (s - s3 + 0.5 * s3 * s);
}
float fogOpticalDepth(vec3 a, vec3 b) {
  if (uFog.w < 0.5) return 0.0;
  float d = length(b - a);
  float dy = b.y - a.y;
  if (abs(dy) < ${FOG_FLAT_DY_M.toFixed(2)}) return uFog.x * d * fogDensity(0.5 * (a.y + b.y));
  return uFog.x * d * abs(fogCumulative(b.y) - fogCumulative(a.y)) / abs(dy);
}
float fogPhaseHG(float c, float g) {
  float d = 1.0 + g * g - 2.0 * g * c;
  return (1.0 - g * g) / (12.566371 * d * sqrt(d));
}
`;

const _layer: FogLayer = { topM: 0, visibilityM: 0 };
const _shape: FogShape = { beta: 0, yA: 0, yTop: 0 };

/**
 * The uFog value for a weather, written into `out`: (beta, yA, yTop, 1) with a fog layer, (0, 0, 0, 0) without.
 * Also returns the layer (fogOf) through `layer` when given.
 */
export function fogUniformValue(w: WeatherSettings, out: THREE.Vector4, layer: FogLayer = _layer): THREE.Vector4 {
  fogOf(w, layer);
  if (!(layer.topM > 0)) return out.set(0, 0, 0, 0);
  fogShape(layer.topM, layer.visibilityM, AIRPORT.elevation, _shape);
  return out.set(_shape.beta, _shape.yA, _shape.yTop, 1);
}

const shared = new WeakMap<THREE.WebGLRenderer, THREE.IUniform<THREE.Vector4>>();

/**
 * The fog uniform of a renderer, shared by the effects and sprites that draw with it (one object per renderer,
 * created at (0, 0, 0, 0)). FogEffect writes it every frame. The aircraft light sprites compute their own value
 * from the live weather (fogUniformValue) and copy this one only when no weather is passed to them.
 */
export function fogUniformFor(renderer: THREE.WebGLRenderer): THREE.IUniform<THREE.Vector4> {
  let u = shared.get(renderer);
  if (!u) shared.set(renderer, (u = { value: new THREE.Vector4() }));
  return u;
}
