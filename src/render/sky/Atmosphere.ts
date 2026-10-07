// The atmosphere model on the GPU: owns the lookup tables and the per-frame sky state (sun/moon
// position, camera altitude) that the sky dome, lighting and aerial perspective all sample.
//
//   transmittance LUT   256x64   rebuilt when the visibility (aerosol load) changes
//   multi-scatter LUT   32x32    rebuilt with it
//   sky-view LUTs       192x108  one lit by the sun, one by the moon; rebuilt every frame (~0.1 ms)
//
// One instance exists per renderer (Atmosphere.for) so the SkySystem and the post-processing effects
// share it without being wired together. The SkySystem updates it every frame; if it is absent the
// aerial-perspective effect updates it itself.

import * as THREE from 'three';
import type { SimContext } from '../../core/context';
import { FullscreenPass, passMaterial } from '../post/FullscreenPass';
import { Celestial } from './celestial';
import { CloudSky } from './cloudSky';
import { MULTISCATTER_LUT_SIZE, SKYVIEW_LUT_SIZE, TRANSMITTANCE_LUT_SIZE } from './glsl/atmosphere';
import { MULTISCATTER_FRAG, SKYVIEW_FRAG, TRANSMITTANCE_FRAG } from './glsl/luts';
import { ATMOSPHERE_TOP_KM, EARTH_RADIUS_KM, SUN_ILLUMINANCE_TOA, atmosphereParams, type AtmosphereParams } from './params';

/** Moonlight is slightly redder than sunlight: lunar albedo rises toward the red (normalised to Y = 1). */
export const MOON_TINT = new THREE.Vector3(1.07, 0.99, 0.88);

function lutTarget(w: number, h: number): THREE.WebGLRenderTarget {
  return new THREE.WebGLRenderTarget(w, h, {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: THREE.ClampToEdgeWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
    depthBuffer: false,
    generateMipmaps: false,
  });
}

export class Atmosphere {
  private static readonly instances = new WeakMap<THREE.WebGLRenderer, Atmosphere>();

  /** The shared atmosphere of a renderer, created on first use. */
  static for(renderer: THREE.WebGLRenderer): Atmosphere {
    let a = Atmosphere.instances.get(renderer);
    if (!a) Atmosphere.instances.set(renderer, (a = new Atmosphere(renderer)));
    return a;
  }

  readonly celestial = new Celestial();
  params: AtmosphereParams = atmosphereParams(60_000);
  /** Top-of-atmosphere illuminance of the sun and moon, linear RGB scene units. */
  readonly sunIlluminance = new THREE.Vector3(SUN_ILLUMINANCE_TOA, SUN_ILLUMINANCE_TOA, SUN_ILLUMINANCE_TOA);
  readonly moonIlluminance = new THREE.Vector3();
  /** Radiance of the (Lambertian) ground seen far below the horizon, linear RGB scene units; set by the SkySystem. */
  readonly groundRadiance = new THREE.Vector3();
  /** How the cloud layer changes the sky's light (ambient, direct sun below it, air light); set by the SkySystem. */
  readonly cloudSky = new CloudSky();
  /**
   * This frame's aerial-perspective volume (post/AerialPerspectiveEffect, filled before any other scene
   * effect runs): bind these uniforms and sample with AERIAL_ATLAS_GLSL. Null until the effect first runs.
   */
  aerial: { uAerialAtlas: THREE.IUniform<THREE.Texture>; uAerialMax: THREE.IUniform<number> } | null = null;
  /** Camera altitude MSL used for this frame, m. */
  cameraAltitude = 0;

  private readonly transmittance = lutTarget(TRANSMITTANCE_LUT_SIZE[0], TRANSMITTANCE_LUT_SIZE[1]);
  private readonly multiScatter = lutTarget(MULTISCATTER_LUT_SIZE, MULTISCATTER_LUT_SIZE);
  private readonly skyViewSun = lutTarget(SKYVIEW_LUT_SIZE[0], SKYVIEW_LUT_SIZE[1]);
  private readonly skyViewMoon = lutTarget(SKYVIEW_LUT_SIZE[0], SKYVIEW_LUT_SIZE[1]);

  /**
   * Uniforms of ATMOSPHERE_GLSL and SKY_SAMPLING_GLSL. Materials spread these into their own uniforms
   * ({ ...atmosphere.uniforms, ... }) so they share the same objects and see every update.
   */
  readonly uniforms = {
    uRb: { value: EARTH_RADIUS_KM },
    uRt: { value: ATMOSPHERE_TOP_KM },
    uRayleighScat: { value: new THREE.Vector3() },
    uRayleighH: { value: 8 },
    uMieScat: { value: new THREE.Vector3() },
    uMieExt: { value: new THREE.Vector3() },
    uMieH: { value: 1.2 },
    uMieG: { value: 0.8 },
    uOzoneAbs: { value: new THREE.Vector3() },
    uGroundAlbedo: { value: new THREE.Vector3() },
    tTransmittance: { value: this.transmittance.texture },
    tMultiScatter: { value: this.multiScatter.texture },
    tSkyViewSun: { value: this.skyViewSun.texture },
    tSkyViewMoon: { value: this.skyViewMoon.texture },
    uCamR: { value: EARTH_RADIUS_KM + 0.1 },
    uSunDir: { value: this.celestial.sunDir },
    uMoonDir: { value: this.celestial.moonDir },
    uSunE: { value: this.sunIlluminance },
    uMoonE: { value: this.moonIlluminance },
    /** Air light below the cloud layer (aerial perspective, environment): x scale, y desaturation; see cloudSky.ts. */
    uAirLight: { value: new THREE.Vector2(1, 0) },
  };

  private readonly pass = new FullscreenPass();
  private readonly transmittanceMat = passMaterial({ fragmentShader: TRANSMITTANCE_FRAG, uniforms: this.uniforms });
  private readonly multiScatterMat = passMaterial({ fragmentShader: MULTISCATTER_FRAG, uniforms: this.uniforms });
  private readonly skyViewMat = passMaterial({
    fragmentShader: SKYVIEW_FRAG,
    uniforms: { ...this.uniforms, uLightDir: { value: new THREE.Vector3() }, uLightE: { value: new THREE.Vector3() } },
  });
  private visibility = NaN;
  private fresh = false;

  private constructor(private readonly renderer: THREE.WebGLRenderer) {}

  /** Advance the sky to the current time, weather and camera altitude, and rebuild the LUTs that changed. */
  update(ctx: SimContext): void {
    const w = ctx.weather;
    this.celestial.update(w.timeOfDay, w.dayOfYear);
    this.moonIlluminance.copy(MOON_TINT).multiplyScalar(this.celestial.moonIlluminance);

    ctx.camera.updateMatrixWorld();
    this.cameraAltitude = ctx.camera.matrixWorld.elements[13];
    this.uniforms.uCamR.value = EARTH_RADIUS_KM + Math.max(this.cameraAltitude / 1000, 0.002);

    const prevTarget = this.renderer.getRenderTarget();
    if (w.visibilityM !== this.visibility) this.rebuildStaticLuts(w.visibilityM);
    this.renderSkyView(this.skyViewSun, this.celestial.sunDir, this.sunIlluminance);
    this.renderSkyView(this.skyViewMoon, this.celestial.moonDir, this.moonIlluminance);
    this.renderer.setRenderTarget(prevTarget);
    this.fresh = true;
  }

  /** Called by consumers that render after the SkySystem: updates only if nobody has this frame. */
  ensureUpdated(ctx: SimContext): void {
    if (!this.fresh) this.update(ctx);
    this.fresh = false;
  }

  private rebuildStaticLuts(visibilityM: number): void {
    this.visibility = visibilityM;
    const p = (this.params = atmosphereParams(visibilityM));
    const u = this.uniforms;
    u.uRayleighScat.value.fromArray(p.rayleighScattering);
    u.uRayleighH.value = p.rayleighScaleHeight;
    u.uMieScat.value.fromArray(p.mieScattering);
    u.uMieExt.value.fromArray(p.mieExtinction);
    u.uMieH.value = p.mieScaleHeight;
    u.uMieG.value = p.mieG;
    u.uOzoneAbs.value.fromArray(p.ozoneAbsorption);
    u.uGroundAlbedo.value.fromArray(p.groundAlbedo);
    this.pass.render(this.renderer, this.transmittanceMat, this.transmittance);
    this.pass.render(this.renderer, this.multiScatterMat, this.multiScatter);
  }

  private renderSkyView(target: THREE.WebGLRenderTarget, dir: THREE.Vector3, e: THREE.Vector3): void {
    this.skyViewMat.uniforms.uLightDir.value.copy(dir);
    this.skyViewMat.uniforms.uLightE.value.copy(e);
    this.pass.render(this.renderer, this.skyViewMat, target);
  }

  dispose(): void {
    for (const t of [this.transmittance, this.multiScatter, this.skyViewSun, this.skyViewMoon]) t.dispose();
    for (const m of [this.transmittanceMat, this.multiScatterMat, this.skyViewMat]) m.dispose();
    Atmosphere.instances.delete(this.renderer);
  }
}
