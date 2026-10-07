// Cloud shadows on the ground. A 2D map, centred on the camera, stores the transmittance of sunlight
// through the cloud layer for rays that leave the cloud-base plane toward the sun. Any shader can look it
// up by projecting a world point along the sun direction onto that plane (CLOUD_SHADOW_GLSL).
//
// The stored value is the direct beam only, exp(-tau): the shadow dims the sun's directional term. The light
// a cloud scatters diffusely toward the ground is part of the cloud-aware sky ambient (render/sky/cloudSky.ts),
// so adding it here as well would leave a faint, crisp directional shadow of the aircraft under a cumulus.

import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { CLOUD_MODEL_GLSL, type CloudModel } from './cloudModel';

/** Side length of the square area the shadow map covers, m. */
const SHADOW_EXTENT = 40_000;
/** Minimum sun elevation (sine) used for the projection, so shadows stay bounded at sunrise and sunset. */
const MIN_SUN_Y = 0.12;

/**
 * Uniforms and lookup function for cloud shadows. Include this string in a fragment shader and merge
 * CloudsEffect.shadowUniforms into the material's uniforms (by reference, so they stay current).
 *
 *   float cloudShadow(vec3 worldPos)   // 1 = full sun, lower = shadowed; three.js world space, metres
 */
export const CLOUD_SHADOW_GLSL = /* glsl */ `
uniform sampler2D cloudShadowMap;
uniform vec4 cloudShadowParams;   // map centre x, map centre z, 1 / extent, cloud base altitude
uniform vec4 cloudShadowLight;    // xyz: projection direction toward the light, w: shadow strength 0..1
float cloudShadow(vec3 worldPos) {
  if (cloudShadowLight.w <= 0.0) return 1.0;
  vec3 q = worldPos + cloudShadowLight.xyz * ((cloudShadowParams.w - worldPos.y) / cloudShadowLight.y);
  vec2 uv = (q.xz - cloudShadowParams.xy) * cloudShadowParams.z + 0.5;
  vec2 edge = smoothstep(0.0, 0.08, uv) * smoothstep(1.0, 0.92, uv);
  float t = texture(cloudShadowMap, uv).r;
  // Points above the cloud base see only part of the layer above them.
  float above = clamp((worldPos.y - cloudShadowParams.w) * 0.002, 0.0, 1.0);
  return mix(1.0, t, cloudShadowLight.w * edge.x * edge.y * (1.0 - above));
}
`;

export interface CloudShadowUniforms {
  [name: string]: THREE.IUniform;
  cloudShadowMap: THREE.IUniform<THREE.Texture | null>;
  cloudShadowParams: THREE.IUniform<THREE.Vector4>;
  cloudShadowLight: THREE.IUniform<THREE.Vector4>;
}

const SHADOW_FRAG = /* glsl */ `
${CLOUD_MODEL_GLSL}
in vec2 vUv;
uniform vec2 uCenter;
uniform float uExtent;
uniform vec3 uLight;
layout(location = 0) out vec4 outColor;
void main() {
  vec2 xz = uCenter + (vUv - 0.5) * uExtent;
  float base = uLayer.x, top = uLayer.y;
  float len = (top - base) / uLight.y;
  const int STEPS = 16;
  float ds = len / float(STEPS);
  float tau = 0.0;
  for (int i = 0; i < STEPS; i++) {
    float t = (float(i) + 0.5) * ds;
    vec3 p = vec3(xz.x, base, xz.y) + uLight * t;
    // Slightly blurred field (weather mip 0.5, shape mip 2): shadow edges get the penumbra of a cloud's
    // soft boundary and of the sun's disc instead of a hard outline.
    vec3 wt = cloudWeather(p, 0.5);
    tau += cloudShape(p, (p.y - base) * uLayer.z, wt, 2.0) * ds;
  }
  outColor = vec4(exp(-tau * uExtinction), 0.0, 0.0, 1.0);
}
`;

export class CloudShadowPass {
  readonly uniforms: CloudShadowUniforms;
  private target: THREE.WebGLRenderTarget;
  private readonly quad: FullScreenQuad;
  private readonly material: THREE.ShaderMaterial;
  private readonly light = new THREE.Vector3();
  /** The map holds a valid render (for the stored centre and direction). */
  private rendered = false;

  constructor(model: CloudModel, resolution: number) {
    this.target = this.createTarget(resolution);
    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: 'out vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: SHADOW_FRAG,
      uniforms: {
        ...model.uniforms,
        uCenter: { value: new THREE.Vector2() },
        uExtent: { value: SHADOW_EXTENT },
        uLight: { value: this.light },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.material);
    this.uniforms = {
      cloudShadowMap: { value: this.target.texture },
      cloudShadowParams: { value: new THREE.Vector4(0, 0, 1 / SHADOW_EXTENT, 0) },
      cloudShadowLight: { value: new THREE.Vector4(0, 1, 0, 0) },
    };
  }

  setResolution(resolution: number): void {
    if (this.target.width === resolution) return;
    this.target.dispose();
    this.target = this.createTarget(resolution);
    this.uniforms.cloudShadowMap.value = this.target.texture;
    this.rendered = false;
  }

  /**
   * @param lightDir  unit vector toward the sun (or moon), three.js world space
   * @param strength  0..1 how much the shadow darkens the lit colour (0 disables shadows)
   * @param refresh   false: keep the map (and the centre and direction it was rendered for) from the last
   *                  refresh and only update the strength; the map changes slowly, so it is re-rendered
   *                  every other frame (CloudsEffect)
   */
  render(renderer: THREE.WebGLRenderer, cameraPos: THREE.Vector3, lightDir: THREE.Vector3, cloudBase: number, strength: number, refresh = true): void {
    if (!refresh && this.rendered) {
      this.uniforms.cloudShadowLight.value.w = strength;
      return;
    }
    // Snap the map centre to whole texels so the projected shadows do not shimmer as the camera moves.
    const texel = SHADOW_EXTENT / this.target.width;
    const cx = Math.round(cameraPos.x / texel) * texel;
    const cz = Math.round(cameraPos.z / texel) * texel;
    this.light.copy(lightDir);
    if (this.light.y < MIN_SUN_Y) this.light.setY(MIN_SUN_Y).normalize();
    (this.material.uniforms.uCenter.value as THREE.Vector2).set(cx, cz);
    this.uniforms.cloudShadowParams.value.set(cx, cz, 1 / SHADOW_EXTENT, cloudBase);
    this.uniforms.cloudShadowLight.value.set(this.light.x, this.light.y, this.light.z, strength);
    this.rendered = false;
    if (strength <= 0) return;
    renderer.setRenderTarget(this.target);
    this.quad.render(renderer);
    this.rendered = true;
  }

  /** Render the transmittance for a light direction into an arbitrary target (tools, see CloudsEffect.measureCover). */
  renderTo(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget, center: THREE.Vector3, lightDir: THREE.Vector3, cloudBase: number): void {
    this.light.copy(lightDir);
    if (this.light.y < MIN_SUN_Y) this.light.setY(MIN_SUN_Y).normalize();
    (this.material.uniforms.uCenter.value as THREE.Vector2).set(center.x, center.z);
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(target);
    this.quad.render(renderer);
    renderer.setRenderTarget(prev);
  }

  dispose(): void {
    this.target.dispose();
    this.material.dispose();
    this.quad.dispose();
  }

  private createTarget(resolution: number): THREE.WebGLRenderTarget {
    return new THREE.WebGLRenderTarget(resolution, resolution, {
      format: THREE.RedFormat,
      type: THREE.HalfFloatType,
      depthBuffer: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
    });
  }
}
