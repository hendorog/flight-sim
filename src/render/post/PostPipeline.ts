// The frame renderer used by the main loop:
//
//   scene -> HDR target (RGBA16F, MSAA, float depth texture for the log depth buffer)
//         -> SceneEffects in order (aerial perspective first; clouds etc. added by other modules)
//         -> temporal stabilisation (TemporalAA.ts; not on 'low')
//         -> bloom chain (its 1/8-res level also feeds the exposure meter and the local-exposure map)
//         -> eye adaptation -> bloom mix, sun glare, partial white balance, Purkinje shift,
//            global x local exposure, AgX, sRGB, dither -> canvas (FXAA on 'low')
//
// Anti-aliasing is MSAA on the HDR target for geometry edges (ridgelines, the airframe against the sky);
// texture detail (runway markings) is the job of mipmaps and anisotropic filtering, specular aliasing is
// reduced in the lighting itself (SunShadows.ts, Tokuyoshi-Kaplanyan), and sub-pixel shader detail that
// would crawl in motion (distant field edges, roads) is integrated over time by an unjittered TAA that
// reprojects the aircraft with its own motion (TemporalAA.ts).
//
// Non-finite values from any upstream shader are dropped at the aerial-perspective, bloom and tone-map
// inputs, so one broken pixel cannot spread through the blur chain.

import * as THREE from 'three';
import type { QualityLevel, SceneEffect, SimContext } from '../../core/context';
import { AerialPerspectiveEffect } from './AerialPerspectiveEffect';
import { AutoExposure } from './AutoExposure';
import { Bloom } from './Bloom';
import { FullscreenPass, passMaterial } from './FullscreenPass';
import { FXAA_FRAG } from './Fxaa';
import { LocalExposure } from './LocalExposure';
import { TemporalAA } from './TemporalAA';
import { TONEMAP_FRAG } from './ToneMap';
import { Atmosphere } from '../sky/Atmosphere';
import { cabinLamps } from '../aircraft/cabinLight';
import { SCENE_UNITS_PER_LUX, SUN_ANGULAR_RADIUS } from '../sky/params';

/**
 * MSAA samples of the HDR scene target. Ultra stays at 4x: 8x on an RGBA16F + D32F target cost ~1.6x
 * the scene pass of 4x (5.7 -> 9.4 ms inside cloud at 1440p) for edges that 4x plus specular AA already
 * resolve; resolution is better spent through the render scale (sim, scale=).
 */
const MSAA_SAMPLES: Record<QualityLevel, number> = { low: 0, medium: 2, high: 4, ultra: 4 };
/** Share of the frame's energy redistributed by bloom (1-4 % is typical of good camera lenses). */
const BLOOM_WEIGHT = 0.03;
/** Veiling-glare constant: Stiles-Holladay gives 10 for the eye (cd/m^2 per lux x deg^2); a coated camera
 * lens scatters less, and a display has far less range than the eye, so a low sun must not wash out the frame. */
const SUN_GLARE = 3;
/** Radiance clamp of the sky dome (half-float headroom), see glsl/skyDome.ts. */
const SKY_RADIANCE_CLAMP = 60000;
const SUN_SOLID_ANGLE = Math.PI * SUN_ANGULAR_RADIUS * SUN_ANGULAR_RADIUS;
/** Bloom level metered for exposure (1/8 resolution, already low-pass filtered). */
const METER_LEVEL = 2;
/**
 * Local exposure: EV of lift per EV a region lies below the adapted level, and of cut per EV above
 * diffuse white (2.3 EV over the adapted level, see LocalExposure.ts), and the most lift / cut in EV. The
 * lift brings a cockpit interior toward a bright outside view (as the eye and a camera's HDR mode do); the
 * cut holds back only what is brighter than white (the sky around a low sun), so sunlit clouds and white
 * paint keep their brightness. The lift is smaller at night so dark surroundings stay dark.
 */
const LOCAL_LIFT = 0.3;
const LOCAL_CUT = 0.4;
const LOCAL_MAX_LIFT_DAY = 2.0;
const LOCAL_MAX_LIFT_NIGHT = 0.7;
const LOCAL_MAX_CUT = 0.7;
/**
 * Degree of chromatic adaptation to the scene illuminant (0 = none, as a camera on fixed daylight white
 * balance; 1 = full). The eye and a camera on auto white balance adapt partially: a sunset stays warm
 * and twilight stays blue, but the purple cast of a twilight-lit scene is mostly neutralised.
 */
const WHITE_BALANCE_DEGREE = 0.45;
const WHITE_BALANCE_LIMITS = [0.6, 1.6] as const;

const _illuminant = new THREE.Vector3();

/** Starlight + airglow illuminance on a moonless night, ~1e-3 lux (Roach & Gordon, The Light of the Night Sky). */
const NIGHT_SKY_ILLUMINANCE = 1e-3 * SCENE_UNITS_PER_LUX;

/**
 * Interior lamps as incident light for the eye in the cockpit view: the panel flood (a ~45 degree spot,
 * ~1.9 sr) spreads over the panel and glareshield, ~1 m^2; the dome light (a downward Lambertian emitter,
 * PI sr) over the cabin floor and seats, ~3 m^2. See render/aircraft/cabinLight.ts cabinLamps.
 */
const FLOOD_SOLID_ANGLE = 1.9;
const FLOOD_AREA = 1.0;
const DOME_AREA = 3.0;

/**
 * Luminance of an 18 % grey card under the light the eye adapts to, scene units: sun, moon, sky and
 * starlight outside (upward-facing card; `directShare` is the mean share of the direct light the cloud
 * layer lets through to the camera) plus, in the cockpit view, the interior lamps. At night a pilot's
 * eye adapts to the lit panel and displays, not to the moonlit landscape: without the lamps in the
 * reference the dark outside pulled the adaptation down until a 1-2 lx panel flood looked like a dusk
 * cabin (panel face and door lining mid-grey).
 */
function greyCardLuminance(ctx: SimContext, moonIlluminance: THREE.Vector3, directShare: number, artificial: number): number {
  const { sunColor, skyColor, sunDir, moonDir } = ctx.sky;
  const direct = (lum(sunColor) * Math.max(sunDir.y, 0) + moonIlluminance.y * Math.max(moonDir.y, 0)) * directShare;
  let lamps = 0;
  if (ctx.cameraMode === 'cockpit') {
    lamps = (lum(cabinLamps.floodColor.value) * FLOOD_SOLID_ANGLE) / FLOOD_AREA + (lum(cabinLamps.domeColor.value) * Math.PI) / DOME_AREA;
  }
  return 0.18 * ((direct + NIGHT_SKY_ILLUMINANCE + lamps + artificial) / Math.PI + lum(skyColor));
}

function lum(c: THREE.Color): number {
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

function colorTarget(w: number, h: number, type: THREE.TextureDataType = THREE.HalfFloatType): THREE.WebGLRenderTarget {
  return new THREE.WebGLRenderTarget(w, h, {
    type,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: false,
  });
}

export class PostPipeline {
  /** Exposure compensation in EV on top of the automatic exposure. */
  exposureBias = 0;
  /** Veiling-glare constant of the sun (see SUN_GLARE); 0 disables the glare. */
  sunGlare = SUN_GLARE;
  /** Local exposure (lifts a dark cockpit against a bright sky); false gives a purely global exposure. */
  localExposure = true;
  /** Temporal stabilisation (not on 'low'); false for A/B comparison. */
  temporalAA = true;
  /**
   * Artificial illuminance at the viewer (floodlit apron), scene units; set each frame by the shell from
   * AirportSystem.artificialIlluminance. Added to the exposure reference so the eye adapts to the lamps.
   */
  artificialIlluminance = 0;

  private width = 1;
  private height = 1;
  private samples = -1;
  private hdr!: THREE.WebGLRenderTarget;
  private ping: THREE.WebGLRenderTarget[] = [];
  private ldr: THREE.WebGLRenderTarget | null = null;
  private readonly effects: SceneEffect[] = [];
  private readonly exposure = new AutoExposure();
  private readonly exposureUniforms = { tExposure: { value: this.exposure.texture }, uExposureBias: { value: 0 } };
  private readonly bloom = new Bloom(this.exposureUniforms);
  private readonly pass = new FullscreenPass();
  private readonly local = new LocalExposure();
  private readonly taa = new TemporalAA();
  private readonly tonemap = passMaterial({
    fragmentShader: TONEMAP_FRAG,
    uniforms: {
      ...this.exposureUniforms,
      tScene: { value: null },
      tBloom: { value: null },
      uBloomWeight: { value: BLOOM_WEIGHT },
      uBloomScale: { value: 0 },
      uTanHalf: { value: new THREE.Vector2() },
      uSunView: { value: new THREE.Vector3() },
      uSunUv: { value: new THREE.Vector2() },
      uSunTap: { value: new THREE.Vector2() },
      uSunGlare: { value: new THREE.Vector3() },
      uSunExpected: { value: 0 },
      uWhiteBalance: { value: new THREE.Vector3(1, 1, 1) },
      tLocal: { value: this.local.texture },
      uLocal: { value: new THREE.Vector4() },
    },
  });
  private readonly fxaa = passMaterial({ fragmentShader: FXAA_FRAG, uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } } });
  private readonly size = new THREE.Vector2();
  private lastTime = -1;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera,
  ) {
    renderer.getDrawingBufferSize(this.size);
    this.addEffect(new AerialPerspectiveEffect());
    this.allocate(Math.max(1, this.size.x), Math.max(1, this.size.y), MSAA_SAMPLES.high);
  }

  /** Resize all targets (drawing-buffer pixels). Also done automatically when the canvas size changes. */
  setSize(width: number, height: number): void {
    this.allocate(width, height, this.samples);
  }

  addEffect(effect: SceneEffect): void {
    effect.setSize(this.width, this.height);
    this.effects.push(effect);
  }

  /**
   * The aircraft drawn: its bounding radius about the reference point, m (geometry.bounds.radius, the value
   * CameraSystem.setAircraft takes). The temporal pass adds its own margin. Not called: the Cessna 172S's.
   */
  setAircraftRadius(radius: number): void {
    this.taa.setAircraftRadius(radius);
  }

  /** Drop the temporal-AA history (camera cuts the TAA's own cut detection misses). */
  resetTemporalHistory(): void {
    this.taa.reset();
  }

  /** Jump the eye adaptation to the current scene (after a scenario reset or camera cut). */
  snapExposure(): void {
    this.exposure.snap();
    this.taa.reset();
  }

  render(ctx: SimContext, dt: number): void {
    const r = this.renderer;
    r.getDrawingBufferSize(this.size);
    const samples = MSAA_SAMPLES[ctx.quality];
    if (this.size.x !== this.width || this.size.y !== this.height || samples !== this.samples) this.allocate(this.size.x, this.size.y, samples);

    // Eye adaptation runs on wall-clock time so it keeps working while the simulation is paused.
    const now = performance.now() / 1000;
    const realDt = this.lastTime < 0 ? 0 : Math.min(now - this.lastTime, 0.25);
    this.lastTime = now;

    r.setRenderTarget(this.hdr);
    r.clear();
    r.render(this.scene, this.camera);

    let src = this.hdr.texture;
    this.effects.forEach((effect, i) => {
      const out = this.ping[i % 2];
      effect.render(r, src, this.hdr.depthTexture as THREE.DepthTexture, out, ctx, dt);
      src = out.texture;
    });

    this.taa.enabled = this.temporalAA && ctx.quality !== 'low';
    src = this.taa.render(r, src, this.hdr.depthTexture as THREE.DepthTexture, this.camera, ctx.aircraftRoot ?? null, (m, t) => this.pass.render(r, m, t));

    this.exposureUniforms.uExposureBias.value = this.exposureBias;
    const atmosphere = Atmosphere.for(r);
    const reference = greyCardLuminance(ctx, atmosphere.moonIlluminance, atmosphere.cloudSky.directCamera, this.artificialIlluminance);
    this.bloom.render(r, src, () => {
      this.exposure.update(r, this.bloom.level(METER_LEVEL).texture, realDt, reference);
      this.local.update(r, this.bloom.level(METER_LEVEL));
    });
    this.exposureUniforms.tExposure.value = this.exposure.texture;

    const u = this.tonemap.uniforms;
    u.tScene.value = src;
    u.tBloom.value = this.bloom.texture;
    u.uBloomScale.value = BLOOM_WEIGHT * this.bloom.normalisation;
    u.tLocal.value = this.local.texture;
    u.uLocal.value.set(
      this.localExposure ? LOCAL_LIFT : 0,
      THREE.MathUtils.lerp(LOCAL_MAX_LIFT_NIGHT, LOCAL_MAX_LIFT_DAY, ctx.sky.dayFactor),
      LOCAL_MAX_CUT,
      this.localExposure ? LOCAL_CUT : 0,
    );
    this.updateSunGlare(ctx);
    this.updateWhiteBalance(ctx, atmosphere.moonIlluminance, atmosphere.cloudSky.directCamera);
    if (this.ldr) {
      this.pass.render(r, this.tonemap, this.ldr);
      this.fxaa.uniforms.tSrc.value = this.ldr.texture;
      this.pass.render(r, this.fxaa, null);
    } else {
      this.pass.render(r, this.tonemap, null);
    }
  }

  /** Von Kries gains that partially neutralise the colour of the light on a horizontal surface. */
  private updateWhiteBalance(ctx: SimContext, moonIlluminance: THREE.Vector3, directShare: number): void {
    const { sunColor, skyColor, sunDir, moonDir } = ctx.sky;
    const mu = Math.max(sunDir.y, 0) * directShare;
    const mm = Math.max(moonDir.y, 0) * directShare;
    const e = _illuminant.set(
      sunColor.r * mu + moonIlluminance.x * mm + Math.PI * skyColor.r,
      sunColor.g * mu + moonIlluminance.y * mm + Math.PI * skyColor.g,
      sunColor.b * mu + moonIlluminance.z * mm + Math.PI * skyColor.b,
    );
    const wb = this.tonemap.uniforms.uWhiteBalance.value as THREE.Vector3;
    const y = 0.2126 * e.x + 0.7152 * e.y + 0.0722 * e.z;
    if (!(y > 1e-12) || Math.min(e.x, e.y, e.z) <= 0) {
      wb.set(1, 1, 1);
      return;
    }
    const [lo, hi] = WHITE_BALANCE_LIMITS;
    const gain = (c: number): number => THREE.MathUtils.clamp(Math.pow(y / c, WHITE_BALANCE_DEGREE), lo, hi);
    wb.set(gain(e.x), gain(e.y), gain(e.z));
    // Keep the luminance of a neutral surface under this light unchanged (exposure is metered separately).
    const k = y / (0.2126 * e.x * wb.x + 0.7152 * e.y * wb.y + 0.0722 * e.z * wb.z);
    wb.multiplyScalar(k);
  }

  /** Sun position on screen and brightness for the veiling-glare term of the tone-mapping pass. */
  private updateSunGlare(ctx: SimContext): void {
    const u = this.tonemap.uniforms;
    const cam = this.camera;
    const tanY = Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2) / cam.zoom;
    u.uTanHalf.value.set(tanY * cam.aspect, tanY);
    const s = u.uSunView.value.copy(ctx.sky.sunDir).transformDirection(cam.matrixWorldInverse);
    const sunLum = lum(ctx.sky.sunColor);
    if (s.z >= -0.05 || sunLum <= 0) {
      u.uSunExpected.value = 0;
      return;
    }
    const tan = u.uTanHalf.value;
    u.uSunUv.value.set((s.x / -s.z / tan.x) * 0.5 + 0.5, (s.y / -s.z / tan.y) * 0.5 + 0.5);
    // Taps at 70 % of the disc radius; the expected radiance there matches the sky shader's clamp.
    u.uSunTap.value.set((0.7 * SUN_ANGULAR_RADIUS * 0.5) / tan.x, (0.7 * SUN_ANGULAR_RADIUS * 0.5) / tan.y);
    u.uSunExpected.value = Math.min(SKY_RADIANCE_CLAMP, sunLum / SUN_SOLID_ANGLE);
    u.uSunGlare.value.set(ctx.sky.sunColor.r, ctx.sky.sunColor.g, ctx.sky.sunColor.b).multiplyScalar(this.sunGlare);
  }

  private allocate(width: number, height: number, samples: number): void {
    this.width = width;
    this.height = height;
    this.samples = samples;
    this.hdr?.dispose();
    for (const t of this.ping) t.dispose();
    this.ldr?.dispose();

    this.hdr = new THREE.WebGLRenderTarget(width, height, {
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      samples,
      depthTexture: new THREE.DepthTexture(width, height, THREE.FloatType),
    });
    this.ping = [colorTarget(width, height), colorTarget(width, height)];
    this.ldr = samples === 0 ? colorTarget(width, height, THREE.UnsignedByteType) : null;
    this.fxaa.uniforms.uTexel.value.set(1 / width, 1 / height);
    this.bloom.setSize(width, height);
    this.local.setSize(width, height);
    this.taa.setSize(width, height);
    for (const e of this.effects) e.setSize(width, height);
  }

  dispose(): void {
    this.hdr.dispose();
    for (const t of this.ping) t.dispose();
    this.ldr?.dispose();
    for (const e of this.effects) e.dispose?.();
    this.bloom.dispose();
    this.exposure.dispose();
    this.local.dispose();
    this.taa.dispose();
    this.tonemap.dispose();
    this.fxaa.dispose();
  }
}
