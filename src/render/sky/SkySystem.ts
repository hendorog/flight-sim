// The sky subsystem: atmosphere, sky dome, sun/moon light with cascaded shadows, environment map, and
// the per-frame ctx.sky lighting summary other modules read.
//
// Run it after whatever positions the camera each frame: the shadow cascades are fitted to the camera
// as it is when update() runs.

import * as THREE from 'three';
import type { QualityLevel, SimContext, Subsystem } from '../../core/context';
import { AIRPORT } from '../../core/world';
import { Atmosphere } from './Atmosphere';
import { EnvironmentProbe } from './EnvironmentProbe';
import { SkyDome } from './SkyDome';
import { SkySummary } from './SkySummary';
import { createSkyBands } from './cpuSky';
import { SunShadows } from './SunShadows';
import { fitHaze, SURFACE_ALBEDO, type AtmosphereParams } from './params';
import { transmittanceToSpace } from './transmittance';

const ENV_CUBE_SIZE: Record<QualityLevel, number> = { low: 64, medium: 128, high: 128, ultra: 256 };
/** Refresh the environment map when the sun or moon has moved this far (rad) ... */
const ENV_ANGLE_THRESHOLD = 0.004;
/** ... the camera altitude has changed by this fraction of itself (min 150 m) ... */
const ENV_ALTITUDE_FRACTION = 0.15;
/** ... the sky ambient (with clouds) has changed by this fraction ... */
const ENV_AMBIENT_FRACTION = 0.08;
/** ... or at least this often, s. */
const ENV_MAX_AGE = 10;

/**
 * Ground under the aircraft for the environment map's nadir: surface types sampled at the aircraft and at
 * LOCAL_SAMPLE_M around it, standing for a patch of LOCAL_RADIUS_M; its share of the lower hemisphere
 * falls with height (the patch subtends tan(theta) < radius / height).
 */
const LOCAL_SAMPLE_M = 25;
const LOCAL_RADIUS_M = 40;
/** Height of the fuselage underside's view point above the wheels' contact, m. */
const LOCAL_EYE_M = 1.2;
/** Refresh the environment map when the local ground radiance changes by this fraction. */
const ENV_LOCAL_FRACTION = 0.15;

/** Shadow cascades kept while the moon is the key light. */
const MOON_SHADOW_CASCADES = 2;

const _groundSun = new THREE.Color();
const _groundMoon = new THREE.Color();
const _moonColor = new THREE.Color();
const _layerLight = new THREE.Color();
const _shadowColor = new THREE.Color();
const _sunE = [0, 0, 0];
const _moonE = [0, 0, 0];
const _lightE: [number, number, number] = [0, 0, 0];
const _size = new THREE.Vector2();

export class SkySystem implements Subsystem {
  private atmosphere!: Atmosphere;
  private dome!: SkyDome;
  private readonly summary = new SkySummary();
  private readonly bands = createSkyBands();
  private env!: EnvironmentProbe;
  private readonly shadows = new SunShadows();
  private quality: QualityLevel | null = null;
  private readonly groundRadiance = new THREE.Vector3();
  private hazeFitFor: AtmosphereParams | null = null;
  private readonly hazeFit = new THREE.Vector2();

  // State the current environment map was rendered with.
  private readonly envSun = new THREE.Vector3();
  private readonly envMoon = new THREE.Vector3();
  private envAltitude = 0;
  private envVisibility = 0;
  private envAge = 0;
  private envAmbient = 0;
  private envCloud = '';
  private envLocal = 0;
  private readonly localAlbedo = new THREE.Vector3();
  private readonly localGround = new THREE.Vector4();

  init(ctx: SimContext): void {
    const { renderer, scene } = ctx;
    // PCFSoftShadowMap was removed in r18x; PCF with a Vogel-disc kernel is the soft option now.
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    scene.background = null;

    this.atmosphere = Atmosphere.for(renderer);
    this.dome = new SkyDome(this.atmosphere);
    scene.add(this.dome.mesh, this.shadows.group);
    this.applyQuality(ctx);

    this.atmosphere.update(ctx);
    this.updateState(ctx, 0);
    this.env.refreshNow();
    this.markEnvironment(ctx);
    scene.environment = this.env.texture;
  }

  update(dt: number, ctx: SimContext): void {
    if (ctx.quality !== this.quality) this.applyQuality(ctx);
    this.atmosphere.update(ctx);
    this.updateState(ctx, dt);

    if (!this.env.busy && this.environmentStale(ctx)) {
      this.markEnvironment(ctx);
      this.env.requestRefresh();
    }
    if (this.env.advance()) ctx.scene.environment = this.env.texture;
  }

  private applyQuality(ctx: SimContext): void {
    this.quality = ctx.quality;
    this.shadows.setQuality(ctx.quality);
    const probe = new EnvironmentProbe(ctx.renderer, this.dome.envMesh, ENV_CUBE_SIZE[ctx.quality]);
    if (this.env) {
      probe.refreshNow();
      ctx.scene.environment = probe.texture;
      this.env.dispose();
    }
    this.env = probe;
  }

  /** Publish ctx.sky, drive the light and shadows, and feed the dome its per-frame uniforms. */
  private updateState(ctx: SimContext, dt: number): void {
    const a = this.atmosphere;
    const c = a.celestial;
    const p = a.params;
    const sky = ctx.sky;
    const camKm = a.cameraAltitude / 1000;
    const groundKm = AIRPORT.elevation / 1000;

    // Direct light at the camera: what lights the aircraft and what the pilot sees on nearby terrain.
    // (Clear sky: the clouds module lights the clouds with it; cloud shadows are applied separately.)
    directLight(p, camKm, c.sunDir, a.sunIlluminance, sky.sunColor);
    directLight(p, camKm, c.moonDir, a.moonIlluminance, _moonColor);
    sky.sunDir.copy(c.sunDir);
    sky.moonDir.copy(c.moonDir);
    sky.dayFactor = THREE.MathUtils.smoothstep(c.sunDir.y, -0.12, 0.1);
    sky.moonColor.copy(_moonColor);
    // Haze for effects that fade with distance like the aerial perspective does: the best single
    // exponential fit of the green-channel extinction (aerosol + Rayleigh), exact at sea level.
    if (p !== this.hazeFitFor) {
      this.hazeFitFor = p;
      fitHaze(p, this.hazeFit);
    }
    sky.hazeExtinction = this.hazeFit.x;
    sky.hazeScaleHeight = this.hazeFit.y;

    // One light casts shadows: the sun, or the moon once it outshines the set sun.
    const moonLeads = luminance(_moonColor) > luminance(sky.sunColor);
    const keyDir = moonLeads ? c.moonDir : c.sunDir;

    // Clear sky at the camera (CPU, refreshed as the sun and the altitude change), then the cloud layer.
    this.summary.update(p, camKm, c.sunDir.y, c.moonDir.y);
    a.sunIlluminance.toArray(_sunE);
    a.moonIlluminance.toArray(_moonE);
    this.summary.combine(_sunE, _moonE, this.bands);
    const w = ctx.weather;
    const layerKm = (0.5 * (w.cloudBaseM + w.cloudTopM)) / 1000;
    directLight(p, layerKm, keyDir, moonLeads ? a.moonIlluminance : a.sunIlluminance, _layerLight).toArray(_lightE);
    const clouds = a.cloudSky;
    clouds.update(
      {
        cover: w.cloudCover,
        baseM: Math.min(w.cloudBaseM, w.cloudTopM - 100),
        topM: Math.max(w.cloudTopM, w.cloudBaseM + 100),
        cameraAltitudeM: a.cameraAltitude,
        lightMu: keyDir.y,
        lightX: keyDir.x,
        lightZ: keyDir.z,
        lightE: _lightE,
        hazeExtinction: sky.hazeExtinction,
        hazeScaleHeight: sky.hazeScaleHeight,
      },
      this.bands,
    );
    clouds.summarize(this.bands, sky.skyColor, sky.hazeColor);
    a.uniforms.uAirLight.value.set(clouds.airScale, clouds.airGrey);
    this.dome.setClouds(clouds, keyDir);

    // The closed deck stops the direct beam for everything below it (the broken layer's shadows are the
    // clouds module's local shadow map).
    _shadowColor.copy(moonLeads ? _moonColor : sky.sunColor).multiplyScalar(clouds.deckDirect);
    // Moonlight casts faint shadows that matter only near the camera: the nearest cascades only.
    this.shadows.update(ctx.camera, keyDir, _shadowColor, moonLeads ? MOON_SHADOW_CASCADES : Infinity);

    // Ground below the horizon (and in the environment map): Lambertian ground lit by sun, moon and sky,
    // with the mean direct transmission of the cloud layer.
    const direct = clouds.directGround;
    directLight(p, groundKm, c.sunDir, a.sunIlluminance, _groundSun).multiplyScalar(Math.max(c.sunDir.y, 0) * direct);
    directLight(p, groundKm, c.moonDir, a.moonIlluminance, _groundMoon).multiplyScalar(Math.max(c.moonDir.y, 0) * direct);
    const albedo = p.groundAlbedo;
    this.groundRadiance.set(
      albedo[0] * ((_groundSun.r + _groundMoon.r) / Math.PI + sky.skyColor.r),
      albedo[1] * ((_groundSun.g + _groundMoon.g) / Math.PI + sky.skyColor.g),
      albedo[2] * ((_groundSun.b + _groundMoon.b) / Math.PI + sky.skyColor.b),
    );
    a.groundRadiance.copy(this.groundRadiance);
    this.updateLocalGround(ctx, albedo);

    ctx.renderer.getDrawingBufferSize(_size);
    const pixelAngle = (2 * Math.tan(THREE.MathUtils.degToRad(ctx.camera.fov) / 2)) / (ctx.camera.zoom * Math.max(_size.y, 1));
    this.dome.update(ctx.simTime, pixelAngle, this.groundRadiance);
    this.envAge += dt;
  }

  /**
   * The environment map's ground near the nadir: the mean albedo of the surfaces around the aircraft, lit
   * like the regional ground (per unit albedo), so a white underside over a concrete apron picks up a
   * neutral grey bounce, over grass a green one.
   */
  private updateLocalGround(ctx: SimContext, regional: readonly number[]): void {
    const env = ctx.env;
    const pos = ctx.state?.position;
    const u = this.dome.uniforms.uLocalGround.value as THREE.Vector4;
    if (!env || !pos || typeof env.surface !== 'function') {
      u.set(0, 0, 0, 0);
      return;
    }
    const n = pos.x;
    const e = pos.y;
    const acc = this.localAlbedo.set(0, 0, 0);
    const offsets = [
      [0, 0],
      [LOCAL_SAMPLE_M, 0],
      [-LOCAL_SAMPLE_M, 0],
      [0, LOCAL_SAMPLE_M],
      [0, -LOCAL_SAMPLE_M],
    ];
    for (const [dn, de] of offsets) {
      const alb = SURFACE_ALBEDO[env.surface(n + dn, e + de)] ?? SURFACE_ALBEDO.grass;
      acc.x += alb[0] / offsets.length;
      acc.y += alb[1] / offsets.length;
      acc.z += alb[2] / offsets.length;
    }
    const height = Math.max(-pos.z - env.groundElevation(n, e), 0) + LOCAL_EYE_M;
    const g = this.groundRadiance;
    this.localGround.set(
      regional[0] > 0 ? (g.x / regional[0]) * acc.x : 0,
      regional[1] > 0 ? (g.y / regional[1]) * acc.y : 0,
      regional[2] > 0 ? (g.z / regional[2]) * acc.z : 0,
      LOCAL_RADIUS_M / height,
    );
    u.copy(this.localGround);
  }

  /** Luminance of the local ground as the environment map sees it (its share of the hemisphere times radiance). */
  private localKey(): number {
    const l = this.localGround;
    const k = l.w * l.w;
    return (0.2126 * l.x + 0.7152 * l.y + 0.0722 * l.z) * (k / (1 + k));
  }

  private environmentStale(ctx: SimContext): boolean {
    const c = this.atmosphere.celestial;
    const alt = this.atmosphere.cameraAltitude;
    return (
      c.sunDir.angleTo(this.envSun) > ENV_ANGLE_THRESHOLD ||
      (c.moonDir.y > 0 && c.moonDir.angleTo(this.envMoon) > ENV_ANGLE_THRESHOLD) ||
      Math.abs(alt - this.envAltitude) > Math.max(150, ENV_ALTITUDE_FRACTION * Math.abs(this.envAltitude)) ||
      ctx.weather.visibilityM !== this.envVisibility ||
      Math.abs(luminance(ctx.sky.skyColor) - this.envAmbient) > ENV_AMBIENT_FRACTION * this.envAmbient ||
      cloudKey(ctx) !== this.envCloud ||
      // Relative to at least a fifth of the regional ground, so small changes of a patch seen from altitude
      // (a small share of the hemisphere) do not keep refreshing the map.
      Math.abs(this.localKey() - this.envLocal) >
        ENV_LOCAL_FRACTION * Math.max(this.envLocal, 0.2 * (0.2126 * this.groundRadiance.x + 0.7152 * this.groundRadiance.y + 0.0722 * this.groundRadiance.z), 1e-9) ||
      this.envAge > ENV_MAX_AGE
    );
  }

  private markEnvironment(ctx: SimContext): void {
    const c = this.atmosphere.celestial;
    this.envSun.copy(c.sunDir);
    this.envMoon.copy(c.moonDir);
    this.envAltitude = this.atmosphere.cameraAltitude;
    this.envVisibility = ctx.weather.visibilityM;
    this.envAmbient = luminance(ctx.sky.skyColor);
    this.envCloud = cloudKey(ctx);
    this.envLocal = this.localKey();
    this.envAge = 0;
  }

  dispose(): void {
    this.dome.mesh.removeFromParent();
    this.dome.dispose();
    this.shadows.dispose();
    this.env.dispose();
    this.atmosphere.dispose();
  }
}

/** Light from a body with top-of-atmosphere illuminance `e` reaching altitude `km`, into `out`. */
function directLight(p: AtmosphereParams, km: number, dir: THREE.Vector3, e: THREE.Vector3, out: THREE.Color): THREE.Color {
  transmittanceToSpace(p, km, dir.y, out);
  return out.setRGB(out.r * e.x, out.g * e.y, out.b * e.z);
}

/** Cloud layer state the environment map depends on (refresh when it changes). */
function cloudKey(ctx: SimContext): string {
  const w = ctx.weather;
  return `${w.cloudCover.toFixed(3)}|${w.cloudBaseM.toFixed(0)}|${w.cloudTopM.toFixed(0)}`;
}

function luminance(c: THREE.Color): number {
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}
