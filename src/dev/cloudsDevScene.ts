// Stand-ins for the modules the cloud dev page does not have: a time-of-day sky/light model, a gradient
// sky dome, a terrain with hills and buildings, a distance-haze pass (aerial perspective) and a tone-mapping
// pass (ACES + sRGB). Only good enough to judge the clouds against; not used by the simulator.

import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import type { SimContext } from '../core/context';
import { nedToThree } from '../core/frames';
import { DEPTH_GLSL } from '../core/shaderLib';
import { AIRPORT, sunDirectionNED } from '../core/world';

const smooth = THREE.MathUtils.smoothstep;

/** Approximate sun/sky colours from the sun elevation (Kasten-Young air mass, per-channel extinction). */
export function updateDevSky(ctx: SimContext): void {
  const sky = ctx.sky;
  sky.sunDir.copy(nedToThree(sunDirectionNED(ctx.weather.timeOfDay, ctx.weather.dayOfYear)));
  sky.moonDir.copy(sky.sunDir).negate();
  const s = sky.sunDir.y;
  const elevDeg = Math.max(THREE.MathUtils.radToDeg(Math.asin(s)), -2);
  const airMass = 1 / (Math.max(Math.sin(THREE.MathUtils.degToRad(elevDeg)), 0) + 0.50572 * Math.pow(elevDeg + 6.07995, -1.6364));
  const visible = smooth(s, -0.03, 0.02);
  sky.sunColor.setRGB(
    3.4 * Math.exp(-airMass * 0.055) * visible,
    3.3 * Math.exp(-airMass * 0.12) * visible,
    3.1 * Math.exp(-airMass * 0.28) * visible,
  );
  sky.dayFactor = smooth(s, -0.12, 0.1);
  const high = smooth(s, 0.0, 0.35);
  const night = new THREE.Color(0.004, 0.006, 0.014);
  sky.skyColor.setRGB(0.3 + 0.1 * (1 - high), 0.45 - 0.08 * (1 - high), 0.8 - 0.2 * (1 - high)).multiplyScalar(0.25 + 0.75 * high).lerp(night, 1 - sky.dayFactor);
  sky.hazeColor.setRGB(0.95, 0.68 + 0.14 * high, 0.5 + 0.4 * high).multiplyScalar(0.35 + 0.55 * high).lerp(night, 1 - sky.dayFactor);
}

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize((modelMatrix * vec4(position, 0.0)).xyz);
  gl_Position = projectionMatrix * viewMatrix * vec4((modelMatrix * vec4(position, 1.0)).xyz, 1.0);
}`;

const SKY_FRAG = /* glsl */ `
varying vec3 vDir;
uniform vec3 uSky, uHaze, uSunColor, uSunDir;
void main() {
  vec3 d = normalize(vDir);
  float up = max(d.y, 0.0);
  vec3 col = mix(uSky * 0.85, uHaze, pow(1.0 - up, 5.0));
  float c = max(dot(d, uSunDir), 0.0);
  col += uSunColor * (0.04 * pow(c, 12.0) + 0.25 * pow(c, 300.0) + (c > 0.99996 ? 30.0 : 0.0));
  gl_FragColor = vec4(col, 1.0);
}`;

export function createDevScene(ctx: SimContext): { update(): void } {
  const scene = ctx.scene;
  const skyMat = new THREE.ShaderMaterial({
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    uniforms: {
      uSky: { value: ctx.sky.skyColor },
      uHaze: { value: ctx.sky.hazeColor },
      uSunColor: { value: ctx.sky.sunColor },
      uSunDir: { value: ctx.sky.sunDir },
    },
    side: THREE.BackSide,
    depthTest: false,
    depthWrite: false,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1000, 32, 16), skyMat);
  dome.renderOrder = -1;
  dome.frustumCulled = false;
  scene.add(dome);

  const sun = new THREE.DirectionalLight(0xffffff, 1);
  const hemi = new THREE.HemisphereLight(0xffffff, 0x000000, 1);
  scene.add(sun, sun.target, hemi);

  // Ground: 400 km plane with a tiled value-noise texture so distance and scale can be judged.
  const texSize = 256;
  const data = new Uint8Array(texSize * texSize * 4);
  for (let y = 0; y < texSize; y++)
    for (let x = 0; x < texSize; x++) {
      const n = 0.5 + 0.25 * Math.sin(x * 0.19) * Math.sin(y * 0.23) + 0.25 * Math.sin((x + 2 * y) * 0.061);
      const field = ((x >> 5) + (y >> 5)) & 1;
      const i = (y * texSize + x) * 4;
      data[i] = 70 + 40 * n + field * 25;
      data[i + 1] = 95 + 45 * n + field * 10;
      data[i + 2] = 50 + 20 * n;
      data[i + 3] = 255;
    }
  const groundTex = new THREE.DataTexture(data, texSize, texSize);
  groundTex.wrapS = groundTex.wrapT = THREE.RepeatWrapping;
  groundTex.repeat.set(400, 400);
  groundTex.colorSpace = THREE.SRGBColorSpace;
  groundTex.generateMipmaps = true;
  groundTex.minFilter = THREE.LinearMipmapLinearFilter;
  groundTex.anisotropy = 8;
  groundTex.needsUpdate = true;
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(400_000, 400_000).rotateX(-Math.PI / 2),
    new THREE.MeshLambertMaterial({ map: groundTex }),
  );
  ground.position.y = AIRPORT.elevation;
  scene.add(ground);

  // Hills and a ridge to judge occlusion against clouds, plus a few buildings near the field.
  const hillMat = new THREE.MeshLambertMaterial({ color: 0x5d6b45, flatShading: true });
  const hills: [number, number, number, number][] = [
    [6000, 3000, 2600, 900],
    [9000, -4000, 4000, 1300],
    [-7000, 6000, 3000, 700],
    [14000, 9000, 6000, 1900],
    [-12000, -9000, 5000, 1500],
  ];
  for (const [n, e, r, h] of hills) {
    const hill = new THREE.Mesh(new THREE.ConeGeometry(r, h, 24, 1), hillMat);
    hill.position.copy(nedToThree({ x: n, y: e, z: -(AIRPORT.elevation + h / 2) }));
    scene.add(hill);
  }
  const boxMat = new THREE.MeshLambertMaterial({ color: 0xb8b0a0 });
  for (let i = 0; i < 12; i++) {
    const h = 8 + ((i * 37) % 30);
    const box = new THREE.Mesh(new THREE.BoxGeometry(20, h, 30), boxMat);
    box.position.copy(nedToThree({ x: 260 + (i % 4) * 45, y: -200 - Math.floor(i / 4) * 50, z: -(AIRPORT.elevation + h / 2) }));
    scene.add(box);
  }
  const runway = new THREE.Mesh(
    new THREE.PlaneGeometry(AIRPORT.runway.width, AIRPORT.runway.length).rotateX(-Math.PI / 2),
    new THREE.MeshLambertMaterial({ color: 0x3a3a3c }),
  );
  runway.rotation.y = -AIRPORT.runway.heading;
  runway.position.y = AIRPORT.elevation + 0.05;
  scene.add(runway);

  // Mock aircraft (nose toward -Z) so halos around a thin near object can be judged.
  const white = new THREE.MeshLambertMaterial({ color: 0xf2f2f2 });
  const fuselage = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.3, 7.5), white);
  const wing = new THREE.Mesh(new THREE.BoxGeometry(11, 0.15, 1.5), white);
  wing.position.set(0, 0.8, -0.5);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.15, 1.6, 1.2), white);
  tail.position.set(0, 1.1, 3.4);
  ctx.aircraftRoot.add(fuselage, wing, tail);

  return {
    update() {
      updateDevSky(ctx);
      dome.position.copy(ctx.camera.position);
      sun.color.copy(ctx.sky.sunColor);
      sun.position.copy(ctx.camera.position).addScaledVector(ctx.sky.sunDir, 1000);
      sun.target.position.copy(ctx.camera.position);
      hemi.color.copy(ctx.sky.skyColor).multiplyScalar(Math.PI);
      hemi.groundColor.copy(ctx.sky.skyColor).multiplyScalar(0.8);
    },
  };
}

const HAZE_FRAG = /* glsl */ `
${DEPTH_GLSL}
in vec2 vUv;
layout(location = 0) out vec4 outColor;
uniform sampler2D uScene, uDepth;
uniform mat4 uInvProj, uCamWorld;
uniform vec3 uCamPos, uHazeColor;
uniform vec2 uHaze;
void main() {
  vec4 c = texture(uScene, vUv);
  float d = texture(uDepth, vUv).r;
  if (!isSky(d)) {
    vec4 v = uInvProj * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
    vec3 dv = normalize(v.xyz / v.w);
    float dist = viewZFromDepth(d) / max(-dv.z, 1e-4);
    float y0 = uCamPos.y, y1 = y0 + (mat3(uCamWorld) * dv).y * dist, H = uHaze.y;
    float avg = abs(y1 - y0) < 1.0 ? exp(-y0 / H) : H * (exp(-y0 / H) - exp(-y1 / H)) / (y1 - y0);
    float t = exp(-uHaze.x * dist * avg);
    c.rgb = c.rgb * t + uHazeColor * (1.0 - t);
  }
  outColor = c;
}`;

const TONEMAP_FRAG = /* glsl */ `
in vec2 vUv;
layout(location = 0) out vec4 outColor;
uniform sampler2D uScene;
uniform float uExposure;
vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); } // Narkowicz 2015
vec3 srgb(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
void main() { outColor = vec4(srgb(aces(texture(uScene, vUv).rgb * uExposure)), 1.0); }`;

const VERT = 'out vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

/** Scene -> haze -> (effect) -> tone map, with the render targets a real post pipeline would own. */
export class DevPipeline {
  readonly sceneRT: THREE.WebGLRenderTarget;
  readonly hazedRT: THREE.WebGLRenderTarget;
  readonly effectRT: THREE.WebGLRenderTarget;
  private readonly quad = new FullScreenQuad();
  private readonly hazeMat: THREE.ShaderMaterial;
  private readonly toneMat: THREE.ShaderMaterial;

  constructor(width: number, height: number, exposure: number) {
    const opts = { type: THREE.HalfFloatType, depthBuffer: false };
    this.sceneRT = new THREE.WebGLRenderTarget(width, height, { type: THREE.HalfFloatType, depthTexture: new THREE.DepthTexture(width, height) });
    this.hazedRT = new THREE.WebGLRenderTarget(width, height, opts);
    this.effectRT = new THREE.WebGLRenderTarget(width, height, opts);
    const mat = (frag: string, uniforms: Record<string, THREE.IUniform>) =>
      new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false });
    this.hazeMat = mat(HAZE_FRAG, {
      uScene: { value: this.sceneRT.texture },
      uDepth: { value: this.sceneRT.depthTexture },
      uInvProj: { value: new THREE.Matrix4() },
      uCamWorld: { value: new THREE.Matrix4() },
      uCamPos: { value: new THREE.Vector3() },
      uHazeColor: { value: new THREE.Color() },
      uHaze: { value: new THREE.Vector2() },
    });
    this.toneMat = mat(TONEMAP_FRAG, { uScene: { value: null }, uExposure: { value: exposure } });
  }

  setSize(width: number, height: number): void {
    this.sceneRT.setSize(width, height);
    this.hazedRT.setSize(width, height);
    this.effectRT.setSize(width, height);
  }

  renderScene(ctx: SimContext): void {
    const r = ctx.renderer;
    r.setRenderTarget(this.sceneRT);
    r.clear();
    r.render(ctx.scene, ctx.camera);
    const u = this.hazeMat.uniforms;
    u.uInvProj.value.copy(ctx.camera.projectionMatrixInverse);
    u.uCamWorld.value.copy(ctx.camera.matrixWorld);
    u.uCamPos.value.copy(ctx.camera.position);
    u.uHazeColor.value.copy(ctx.sky.hazeColor);
    u.uHaze.value.set(3.0 / ctx.weather.visibilityM, 1200);
    this.quad.material = this.hazeMat;
    r.setRenderTarget(this.hazedRT);
    this.quad.render(r);
  }

  toneMap(renderer: THREE.WebGLRenderer, source: THREE.Texture): void {
    this.toneMat.uniforms.uScene.value = source;
    this.quad.material = this.toneMat;
    renderer.setRenderTarget(null);
    this.quad.render(renderer);
  }
}
