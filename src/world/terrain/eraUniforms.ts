// Deep Time, increment 2 (WP0a contract, FROZEN): the era's per-frame terrain uniforms, shared by reference with
// every material that declares them (the terrain material outside the present day, and any era effect).
//
//   uEraTime  seconds of simulation since boot (animation clock: lava crust, plume advection). Not wall time.
//   uNight    world/era/eraLight.ts nightRamp of the sun's elevation (0 above +15 deg .. 1 at -6 deg).
//   uLava     (east, north, altitude MSL, intensity) of the volcano's glow, filled by volcano.ts
//             volcanoLavaState (WP5); intensity 0 when ?eraoff=lava or there is no volcano.
//
// ERA_TERRAIN_UNIFORMS_GLSL declares them in the terrain fragment shader (outside the present day only).
// updateEraUniforms is called by TerrainSystem.update each frame, only when !isPresent(); in the present day the
// uniforms are never assigned to a material and never updated.

import * as THREE from 'three';
import { nightRamp } from '../era/eraLight';
import { eraOff } from '../era/eraOff';
import { volcanoLavaState, type LavaState } from './volcano';

export const ERA_UNIFORMS = {
  uEraTime: { value: 0 },
  uNight: { value: 0 },
  uLava: { value: new THREE.Vector4(0, 0, 0, 0) },
};
export type EraUniforms = typeof ERA_UNIFORMS;

/** The declarations, for the terrain fragment head (and any era shader that reads them). */
export const ERA_TERRAIN_UNIFORMS_GLSL = /* glsl */ `uniform float uEraTime;
uniform float uNight;
uniform vec4 uLava;
`;

const LAVA: LavaState = { x: 0, y: 0, z: 0, w: 0 };

/** Advance the era's uniforms by `dt` s of simulation, from the sky's sun direction (three.js world space). */
export function updateEraUniforms(dt: number, sky: { sunDir: { y: number } }, u: EraUniforms = ERA_UNIFORMS): void {
  u.uEraTime.value += Number.isFinite(dt) ? Math.max(0, dt) : 0;
  u.uNight.value = nightRamp(sky.sunDir.y);
  volcanoLavaState(sky, u.uEraTime.value, LAVA);
  u.uLava.value.set(LAVA.x, LAVA.y, LAVA.z, eraOff('lava') ? 0 : LAVA.w);
}
