// The weather's full-screen effects, created once at boot by the Simulator after the clouds (core/weatherFields.ts
// holds the fields they read). Two groups:
//   - scene effects (PostPipeline.addEffect), after the clouds and before the temporal pass: storm cells, then the
//     ground fog, so the fog covers a cell's base and the cell composites against the cumulus;
//   - overlays (PostPipeline.addOverlay), after the temporal pass and before bloom: precipitation streaks, then
//     lightning. They anti-alias themselves and are not reprojected.
// Each factory lives in its own module and may return null when it has nothing to add (the four here always return
// an effect); an effect it returns creates its materials in its constructor, so Simulator.warmUpShaders compiles them. Per-frame state (the live weather,
// ctx.sky) comes through SceneEffect.render's SimContext; an effect whose weather field is absent copies its input.

import type * as THREE from 'three';
import type { SceneEffect, SimContext } from '../../core/context';
import type { WeatherSettings } from '../../core/types';
import type { CloudsEffect } from '../clouds';
import type { PostPipeline } from '../post/PostPipeline';
import { createFogEffect } from './FogEffect';
import { createLightningOverlay } from './LightningOverlay';
import { createPrecipOverlay } from './PrecipOverlay';
import { createStormCellEffect } from './StormCellEffect';

/** What a weather effect is built with. */
export interface WeatherEffectContext {
  /** The simulation context (quality, events, weatherFx). */
  ctx: SimContext;
  renderer: THREE.WebGLRenderer;
  /** The cumulus layer: reprojectionLayer() gives its front distance and transmittance for compositing. */
  clouds: CloudsEffect;
  /** The pipeline the effects are added to (cabinFromView for the cabin mask). */
  post: PostPipeline;
  /** The live weather; the same object the sky and physics read. */
  weather: WeatherSettings;
}

/** Scene effects after the clouds, in order: storm cells, ground fog (each when its factory returns one). */
export function createWeatherEffects(c: WeatherEffectContext): SceneEffect[] {
  const effects: SceneEffect[] = [];
  const storms = createStormCellEffect(c);
  if (storms) effects.push(storms);
  const fog = createFogEffect(c);
  if (fog) effects.push(fog);
  return effects;
}

/** Post-TAA overlays, in order: precipitation, lightning (each when its factory returns one). */
export function createWeatherOverlays(c: WeatherEffectContext): SceneEffect[] {
  const overlays: SceneEffect[] = [];
  const precip = createPrecipOverlay(c);
  if (precip) overlays.push(precip);
  const lightning = createLightningOverlay(c);
  if (lightning) overlays.push(lightning);
  return overlays;
}
