// Ground fog layer (WeatherSettings.fogTopM, fogVisibilityM): a scene effect after the storm cells and the clouds,
// before the temporal pass. One full-resolution draw: per pixel the analytic optical depth of the layer between the
// camera and the surface (fogModel.ts, GLSL in fogGlsl.ts), then out = in * e^-tau + L with the in-scatter L of
// fogModel.fogRadiance. Without a fog layer (fogOf(w).topM === 0) the draw is a plain copy.
//
// Path length per pixel: opaque pixels use the log-depth distance (viewZFromDepth x the view ray's length, as
// AerialPerspectiveEffect); sky pixels looking up end where the ray leaves the fog top (nothing when the camera is
// above it), sky pixels looking down run to the far plane. In the cockpit view, pixels inside the cabin box
// (PostPipeline.cabinFromView) are left unfogged; the view out through the glazing is fogged from the eye.
//
// The aerial perspective has already hazed the input over the whole path, so the fog adds only its own extinction
// and in-scatter. Recorded error: with the camera above the fog and a cloud between the camera and the fog, the
// fog's in-scatter is not dimmed by that cloud. The ambient term is ctx.sky.hazeColor, which carries the cloud
// layer's dimming of the air light (cloudSky.ts summarize); the sun term is scaled by cloudSky.directGround.
//
// The fog uniform (fogGlsl.ts fogUniformFor) is written here every frame for the aircraft light sprites.

import * as THREE from 'three';
import { CAMERA_FAR, type SceneEffect, type SimContext } from '../../core/context';
import { DEPTH_GLSL } from '../../core/shaderLib';
import { FullscreenPass, passMaterial } from '../post/FullscreenPass';
import type { PostPipeline } from '../post/PostPipeline';
import { Atmosphere } from '../sky/Atmosphere';
import { FOG_GLSL, fogUniformFor, fogUniformValue } from './fogGlsl';
import { FOG_SUN_G, FOG_SUN_SHARE, fogSunTransmittance } from './fogModel';
import type { WeatherEffectContext } from './index';

const COMPOSITE_FRAG = /* glsl */ `
${DEPTH_GLSL}
${FOG_GLSL}
uniform sampler2D tInput;
uniform sampler2D tDepth;
uniform vec2 uTanHalf;
uniform mat3 uCamToWorld;
uniform vec3 uCamPos;
uniform vec3 uSunDir;
uniform vec3 uFogAmbient;   // ambient air light, scene units
uniform vec3 uFogSun;       // sun colour x directGround x FOG_SUN_SHARE x transmittance through the fog above the camera
uniform mat4 uCabinFromView;
uniform float uCabin;       // 1 in the cockpit view: no fog inside the cabin box
varying vec2 vUv;

void main() {
  vec4 input4 = texture2D(tInput, vUv);
  float d = texture2D(tDepth, vUv).r;
  vec3 view = vec3((vUv * 2.0 - 1.0) * uTanHalf, -1.0);
  vec3 rd = normalize(uCamToWorld * view);
  float dist;
  if (!isSky(d)) {
    float z = viewZFromDepth(d);
    if (uCabin > 0.5) {
      vec3 b = (uCabinFromView * vec4(view * z, 1.0)).xyz;
      if (all(lessThan(abs(b), vec3(1.0)))) {
        gl_FragColor = input4;
        return;
      }
    }
    dist = z * length(view);
  } else if (rd.y > 0.0) {
    dist = max(uFog.z - uCamPos.y, 0.0) / rd.y;
  } else {
    dist = ${CAMERA_FAR.toFixed(1)};
  }
  float tau = fogOpticalDepth(uCamPos, uCamPos + rd * dist);
  float t = exp(-tau);
  vec3 L = (1.0 - t) * (uFogAmbient + uFogSun * fogPhaseHG(dot(rd, uSunDir), ${FOG_SUN_G.toFixed(3)}));
  // Keep the scene's alpha (the tone map's point-source flag, post/ToneMap.ts).
  gl_FragColor = vec4(input4.rgb * t + L, input4.a);
}
`;

const COPY_FRAG = /* glsl */ `
uniform sampler2D tInput;
varying vec2 vUv;
void main() {
  gl_FragColor = texture2D(tInput, vUv);
}
`;

export class FogEffect implements SceneEffect {
  readonly name = 'groundFog';

  private readonly pass = new FullscreenPass();
  private readonly tanHalf = new THREE.Vector2();
  private readonly camToWorld = new THREE.Matrix3();
  private readonly camPos = new THREE.Vector3();
  private readonly fog: THREE.IUniform<THREE.Vector4>;
  private readonly compositeMat: THREE.ShaderMaterial;
  private readonly copyMat = passMaterial({ fragmentShader: COPY_FRAG, uniforms: { tInput: { value: null } } });

  constructor(
    renderer: THREE.WebGLRenderer,
    private readonly post: PostPipeline | null = null,
  ) {
    this.fog = fogUniformFor(renderer);
    // Created here so Simulator.warmUpShaders compiles it with the other effects.
    this.compositeMat = passMaterial({
      fragmentShader: COMPOSITE_FRAG,
      uniforms: {
        tInput: { value: null },
        tDepth: { value: null },
        uTanHalf: { value: this.tanHalf },
        uCamToWorld: { value: this.camToWorld },
        uCamPos: { value: this.camPos },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uFogAmbient: { value: new THREE.Vector3() },
        uFogSun: { value: new THREE.Vector3() },
        uCabinFromView: { value: new THREE.Matrix4() },
        uCabin: { value: 0 },
        uFog: this.fog,
      },
    });
  }

  setSize(): void {
    // Resolution independent: one full-screen draw at the output size.
  }

  render(
    renderer: THREE.WebGLRenderer,
    input: THREE.Texture,
    depth: THREE.DepthTexture,
    output: THREE.WebGLRenderTarget,
    ctx: SimContext,
  ): void {
    const fog = fogUniformValue(ctx.weather, this.fog.value);
    if (fog.w === 0) {
      this.copyMat.uniforms.tInput.value = input;
      this.pass.render(renderer, this.copyMat, output);
      return;
    }
    const u = this.compositeMat.uniforms;
    const cam = ctx.camera;
    cam.updateMatrixWorld();
    const tanY = Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2) / cam.zoom;
    this.tanHalf.set(tanY * cam.aspect, tanY);
    this.camToWorld.setFromMatrix4(cam.matrixWorld);
    this.camPos.setFromMatrixPosition(cam.matrixWorld);

    const sky = ctx.sky;
    const cloudSky = Atmosphere.for(renderer).cloudSky;
    (u.uSunDir.value as THREE.Vector3).copy(sky.sunDir);
    (u.uFogAmbient.value as THREE.Vector3).set(sky.hazeColor.r, sky.hazeColor.g, sky.hazeColor.b);
    const sunK = sky.sunDir.y > 0 ? FOG_SUN_SHARE * cloudSky.directGround * fogSunTransmittance(fog.x, fog.y, fog.z, this.camPos.y, sky.sunDir.y) : 0;
    (u.uFogSun.value as THREE.Vector3).set(sky.sunColor.r * sunK, sky.sunColor.g * sunK, sky.sunColor.b * sunK);
    const cockpit = ctx.cameraMode === 'cockpit' && this.post !== null;
    u.uCabin.value = cockpit ? 1 : 0;
    if (cockpit) this.post!.cabinFromView(ctx, u.uCabinFromView.value as THREE.Matrix4);
    u.tInput.value = input;
    u.tDepth.value = depth;
    this.pass.render(renderer, this.compositeMat, output);
  }

  dispose(): void {
    this.compositeMat.dispose();
    this.copyMat.dispose();
  }
}

/** The ground-fog scene effect. Always created (the weather can gain a fog layer at any time); a copy without fog. */
export function createFogEffect(c: WeatherEffectContext): SceneEffect | null {
  return new FogEffect(c.renderer, c.post);
}
