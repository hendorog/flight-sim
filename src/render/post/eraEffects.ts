// Deep Time, increment 2 (WP0a contract; WP5 fills it): the era's full-screen scene effects, inserted by the
// Simulator into the post pipeline IMMEDIATELY BEFORE the clouds (so the cumulus in front of an effect occludes it)
// and only when !isPresent(): in the present day this module's function is never called.
//
// WP5 returns its VolcanoPlumeEffect (src/render/post/VolcanoPlumeEffect.ts) from createEraEffects when
// era().terrain.volcano exists and !eraOff('plume'). An effect is a SceneEffect (core/context.ts): it composites
// over the HDR scene with the scene depth (DEPTH_GLSL) and reads ctx.sky / ctx.weather / ERA_UNIFORMS
// (world/terrain/eraUniforms.ts: uEraTime, uNight, uLava) each frame in render(). It owns its targets (setSize) and
// frees them in dispose().

import type * as THREE from 'three';
import type { SceneEffect, SimContext } from '../../core/context';
import type { WeatherSettings } from '../../core/types';
import { era, isPresent } from '../../world/era/eraState';
import { eraOff } from '../../world/era/eraOff';
import { VolcanoPlumeEffect } from './VolcanoPlumeEffect';

/** What an era effect is built with (per-frame state comes through SceneEffect.render's SimContext). */
export interface EraEffectContext {
  /** The simulation context (quality, era, events: e.g. ctx.events.on('qualityChanged', ...)). */
  ctx: SimContext;
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** The live weather (wind, time of day); the same object the sky and physics read. */
  weather: WeatherSettings;
}

/**
 * The era's scene effects, in order: the volcano's plume when the era has a volcano and ?eraoff=plume is not set.
 * Called once at boot, outside the present day only (and returns none in the present day regardless).
 */
export function createEraEffects(ctx: EraEffectContext): SceneEffect[] {
  if (isPresent()) return [];
  const effects: SceneEffect[] = [];
  const V = era().terrain.volcano;
  if (V && !eraOff('plume')) effects.push(new VolcanoPlumeEffect(V, ctx.weather));
  return effects;
}
