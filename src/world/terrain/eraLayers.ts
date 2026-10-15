// Deep Time, increment 2 (WP0a contract, FROZEN): the era's extra world layers under the terrain's root (WP6's near
// understorey; any later era scenery). TerrainSystem calls createEraLayers once in init, next to the airfield grass,
// only when era().flora !== 'present' (never in the present day), adds each layer's object to its root, updates
// them every frame after the vegetation, forwards quality changes, and disposes them with itself.

import type * as THREE from 'three';
import type { QualityLevel, SimContext } from '../../core/context';
import { eraOff } from '../era/eraOff';
import type { TerrainUniforms } from './terrainMaterial';
import { createUnderstorey } from './vegetation/understorey';

/** What a layer is built with. */
export interface EraLayerContext {
  renderer: THREE.WebGLRenderer;
  quality: QualityLevel;
  /** The terrain material's uniforms (uLodCenter, uViewPos, ... ; plus ERA_UNIFORMS' outside the present day). */
  terrainUniforms: TerrainUniforms;
  /** The terrain's tileable noise texture (RGBA, repeat). */
  noise: THREE.Texture;
  /** Ground (or water surface) height MSL at (north, east), m: the physics' terrain (heightfield.ts terrainHeight). */
  heightAt(north: number, east: number): number;
}

export interface EraLayer {
  /** Added under TerrainSystem.root. */
  readonly object: THREE.Object3D;
  update(ctx: SimContext, camera: THREE.Camera, dt: number): void;
  setQuality?(q: QualityLevel): void;
  dispose(): void;
}

/** The era's layers (none when switched off with ?eraoff=understorey). */
export function createEraLayers(ctx: EraLayerContext): EraLayer[] {
  const out: EraLayer[] = [];
  if (!eraOff('understorey')) {
    const u = createUnderstorey(ctx);
    if (u) out.push(u);
  }
  return out;
}
