// The weather's full-screen effects, created once at boot by the Simulator after the clouds effect
// (core/weatherFields.ts holds the fields they read). Two groups:
//   - scene effects (PostPipeline.addEffect), before the temporal pass: the storm cells before the clouds (the
//     cumulus march ends its rays at the cells' front and composites over them), the ground fog after the clouds,
//     so the fog covers a cell's base and the cumulus;
//   - overlays (PostPipeline.addOverlay), after the temporal pass and before bloom: precipitation streaks, then
//     lightning, hail on the ground, then the windscreen's water, snow, hail and cracks. They anti-alias themselves
//     and are not reprojected.
// Each factory lives in its own module and may return null when it has nothing to add (the six here always return
// an effect); an effect it returns creates its materials in its constructor and draws its real material on its first
// render whatever the weather, so Simulator.warmUpShaders compiles them. Per-frame state (the live weather,
// ctx.sky) comes through SceneEffect.render's SimContext; an effect whose weather field is absent reports active() false
// and PostPipeline skips it without a draw.

import type * as THREE from 'three';
import type { SceneEffect, SimContext } from '../../core/context';
import type { WeatherSettings } from '../../core/types';
import type { CloudsEffect } from '../clouds';
import type { PostPipeline } from '../post/PostPipeline';
import { createFogEffect } from './FogEffect';
import { createHailGroundOverlay } from './HailGroundOverlay';
import { createLightningOverlay } from './LightningOverlay';
import { createPrecipOverlay } from './PrecipOverlay';
import { createStormCellEffect } from './StormCellEffect';
import { createWindscreenOverlay } from './WindscreenOverlay';

/** What a weather effect is built with. */
export interface WeatherEffectContext {
  /** The simulation context (quality, events, weatherFx). */
  ctx: SimContext;
  renderer: THREE.WebGLRenderer;
  /** The cumulus layer: reprojectionLayer() gives its front distance and transmittance (the lightning's occlusion). */
  clouds: CloudsEffect;
  /** The pipeline the effects are added to (cabinFromView for the cabin mask). */
  post: PostPipeline;
  /** The live weather; the same object the sky and physics read. */
  weather: WeatherSettings;
}

/** The weather's scene effects around the clouds (each when its factory returns one). */
export interface WeatherSceneEffects {
  /** Added before the clouds: the storm cells. */
  beforeClouds: SceneEffect[];
  /** Added after the clouds: the ground fog. */
  afterClouds: SceneEffect[];
}

/** Scene effects, in order: storm cells (before the clouds), ground fog (after them). */
export function createWeatherEffects(c: WeatherEffectContext): WeatherSceneEffects {
  const out: WeatherSceneEffects = { beforeClouds: [], afterClouds: [] };
  const storms = createStormCellEffect(c);
  if (storms) out.beforeClouds.push(storms);
  const fog = createFogEffect(c);
  if (fog) out.afterClouds.push(fog);
  return out;
}

/**
 * Post-TAA overlays, in order: precipitation, lightning, hail on the ground, the windscreen (each when its factory
 * returns one). The windscreen comes last: the glass is in front of everything outside.
 */
export function createWeatherOverlays(c: WeatherEffectContext): SceneEffect[] {
  const overlays: SceneEffect[] = [];
  const precip = createPrecipOverlay(c);
  if (precip) overlays.push(precip);
  const lightning = createLightningOverlay(c);
  if (lightning) overlays.push(lightning);
  const hailGround = createHailGroundOverlay(c);
  if (hailGround) overlays.push(hailGround);
  const windscreen = createWindscreenOverlay(c);
  if (windscreen) overlays.push(windscreen);
  return overlays;
}
