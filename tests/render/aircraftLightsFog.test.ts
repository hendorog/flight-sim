// The aircraft light sprites' fog uniform (src/render/aircraft/lights.ts, fogGlsl.ts fogUniformValue): with the live
// weather passed to update() it is computed for this frame; without it the sprites copy the renderer's shared
// uniform, which FogEffect writes during the post pass.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { makeMockState } from '../../src/core/mockState';
import { defaultControls, defaultWeather } from '../../src/core/types';
import { AircraftLights } from '../../src/render/aircraft/lights';
import { fogUniformFor, fogUniformValue } from '../../src/render/weather/fogGlsl';

const renderer = { getDrawingBufferSize: (v: THREE.Vector2) => v.set(640, 360) } as unknown as THREE.WebGLRenderer;

function fogOf(lights: AircraftLights): THREE.Vector4 {
  return (lights as unknown as { glowUniforms: { uFog: THREE.IUniform<THREE.Vector4> } }).glowUniforms.uFog.value;
}

function update(lights: AircraftLights, weather?: ReturnType<typeof defaultWeather>): void {
  const root = new THREE.Group();
  root.add(lights.group);
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 2, 10);
  lights.update(0, makeMockState(), defaultControls(), root, camera, renderer, undefined, weather);
}

describe('aircraft light sprites in fog', () => {
  it('take the fog of the weather they are given in the same frame', () => {
    const lights = new AircraftLights(true, 1, new THREE.Group());
    const w = { ...defaultWeather(), fogTopM: 60, fogVisibilityM: 200 };
    update(lights, w);
    const expected = fogUniformValue(w, new THREE.Vector4());
    expect(expected.w).toBe(1);
    expect(fogOf(lights).toArray()).toEqual(expected.toArray());
  });

  it('read (0, 0, 0, 0) for the default weather', () => {
    const lights = new AircraftLights(true, 1, new THREE.Group());
    update(lights, defaultWeather());
    expect(fogOf(lights).toArray()).toEqual([0, 0, 0, 0]);
  });

  it('copy the shared uniform when no weather is passed', () => {
    const lights = new AircraftLights(true, 1, new THREE.Group());
    fogUniformFor(renderer).value.set(0.02, 150, 180, 1);
    update(lights);
    expect(fogOf(lights).toArray()).toEqual([0.02, 150, 180, 1]);
    fogUniformFor(renderer).value.set(0, 0, 0, 0);
  });
});
