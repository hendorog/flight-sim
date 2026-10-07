// Terrain, water and vegetation harness page.
//   dev/terrain.html?cam=north,east,alt&look=north,east,alt&tod=9.5&quality=high&veg=1&haze=1&stats=1
//   camagl=H / lookagl=H: treat the cam / look altitudes as heights above the terrain instead of MSL.
//
// Stands in for the modules that own lighting and post-processing in the real simulator: a Preetham sky
// as background and PMREM environment, a shadow-casting sun that follows the camera, and a simple
// depth-based haze + ACES tone-mapping pass (decoding the log depth buffer like the real post chain).

import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import type { SimContext } from '../core/context';
import { DEPTH_GLSL } from '../core/shaderLib';
import { TerrainSystem, terrainHeight } from '../world/terrain';
import { runHarness } from './harness';

const params = new URLSearchParams(location.search);
const quality = (params.get('quality') ?? 'high') as SimContext['quality'];
const haze = params.get('haze') !== '0';
const showStats = params.get('stats') === '1';

const terrain = new TerrainSystem({ vegetation: params.get('veg') !== '0' });
let sun: THREE.DirectionalLight;
let post: { target: THREE.WebGLRenderTarget; scene: THREE.Scene; camera: THREE.Camera; material: THREE.ShaderMaterial } | null = null;
let statsEl: HTMLPreElement | null = null;

function placeCameraAboveTerrain(camera: THREE.PerspectiveCamera): void {
  const triple = (k: string): number[] | null => params.get(k)?.split(',').map(Number) ?? null;
  const cam = triple('cam');
  const look = triple('look');
  if (!cam || !look) return;
  if (params.has('camagl')) camera.position.y = terrainHeight(cam[0], cam[1]) + Number(params.get('camagl'));
  const ly = params.has('lookagl') ? terrainHeight(look[0], look[1]) + Number(params.get('lookagl')) : look[2];
  camera.lookAt(look[1], ly, -look[0]);
}

function setupLighting(ctx: SimContext): void {
  // Replace the harness's hemisphere light with image-based ambient from the sky, as the sky module does.
  ctx.scene.traverse((o) => {
    if (o instanceof THREE.HemisphereLight) o.visible = false;
    if (o instanceof THREE.DirectionalLight) sun = o;
  });
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = sc.bottom = -250;
  sc.right = sc.top = 250;
  sc.near = 10;
  sc.far = 4000;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.6;

  // three's Sky outputs radiance of order 0.1-1; bring it (and the environment made from it) to the
  // project's photometric scale (core/context.ts), where the harness's fixed exposure expects ~1e3-1e4.
  const SKY_SCALE = 2500;
  const scaleSky = (m: THREE.ShaderMaterial): void => {
    m.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace('gl_FragColor = vec4( texColor, 1.0 );', `gl_FragColor = vec4( texColor * ${SKY_SCALE.toFixed(1)}, 1.0 );`);
    };
  };
  const sky = new Sky();
  scaleSky(sky.material);
  sky.scale.setScalar(300_000);
  const u = sky.material.uniforms;
  u.turbidity.value = 3;
  u.rayleigh.value = 1.2;
  u.mieCoefficient.value = 0.004;
  u.mieDirectionalG.value = 0.8;
  u.sunPosition.value.copy(ctx.sky.sunDir);
  const envScene = new THREE.Scene();
  const envSky = new Sky();
  scaleSky(envSky.material);
  envSky.scale.setScalar(1000);
  envSky.material.uniforms.sunPosition.value.copy(ctx.sky.sunDir);
  for (const k of ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG'] as const)
    envSky.material.uniforms[k].value = u[k].value;
  envScene.add(envSky);
  const pmrem = new THREE.PMREMGenerator(ctx.renderer);
  ctx.scene.environment = pmrem.fromScene(envScene).texture;
  ctx.scene.environmentIntensity = 0.3;
  ctx.scene.background = null;
  ctx.scene.add(sky);
  // ctx.sky's sky and haze colours are the harness's (photometric) daylight values.
}

function setupPost(ctx: SimContext): void {
  const size = ctx.renderer.getDrawingBufferSize(new THREE.Vector2());
  const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
  target.depthTexture = new THREE.DepthTexture(size.x, size.y, THREE.FloatType);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      tColor: { value: target.texture },
      tDepth: { value: target.depthTexture },
      uInvProj: { value: new THREE.Matrix4() },
      uCamWorld: { value: new THREE.Matrix4() },
      uHaze: { value: ctx.sky.hazeColor },
      uExposure: { value: 0.9 },
    },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: /* glsl */ `
      ${DEPTH_GLSL}
      uniform sampler2D tColor; uniform sampler2D tDepth;
      uniform mat4 uInvProj; uniform mat4 uCamWorld; uniform vec3 uHaze; uniform float uExposure;
      varying vec2 vUv;
      void main() {
        vec3 c = texture2D(tColor, vUv).rgb;
        float d = texture2D(tDepth, vUv).r;
        if (!isSky(d)) {
          vec4 v = uInvProj * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
          vec3 dir = normalize(v.xyz / v.w);
          float dist = viewZFromDepth(d) / max(-dir.z, 1e-4);
          vec3 wdir = normalize((uCamWorld * vec4(dir, 0.0)).xyz);
          float camY = uCamWorld[3].y;
          // Exponential height fog integrated along the ray (scale height 1.5 km), 90 km visibility.
          float k = 1.0 / 1500.0;
          float dy = wdir.y * dist;
          float avg = abs(dy) > 1.0 ? exp(-camY * k) * (1.0 - exp(-dy * k)) / (dy * k) : exp(-camY * k);
          float fog = 1.0 - exp(-dist * avg * (3.0 / 90000.0));
          c = mix(c, uHaze, fog);
        }
        gl_FragColor = vec4(c * uExposure, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const scene = new THREE.Scene();
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  scene.add(quad);
  post = { target, scene, camera: new THREE.Camera(), material };
}

void runHarness({
  subsystems: [terrain],
  async setup(ctx) {
    ctx.quality = quality;
    placeCameraAboveTerrain(ctx.camera);
    setupLighting(ctx);
    if (haze) setupPost(ctx);
    if (showStats) {
      statsEl = document.createElement('pre');
      statsEl.style.cssText = 'position:fixed;left:8px;top:4px;margin:0;color:#fff;font:12px monospace;text-shadow:0 0 3px #000';
      document.body.appendChild(statsEl);
    }
  },
  beforeUpdate(_dt, ctx) {
    // Keep the shadow frustum centred on the camera.
    const c = ctx.camera.position;
    sun.target.position.copy(c);
    sun.position.copy(c).addScaledVector(ctx.sky.sunDir, 2000);
    sun.target.updateMatrixWorld();
  },
  render(_dt, ctx) {
    let calls = 0;
    let tris = 0;
    if (!post) {
      ctx.renderer.render(ctx.scene, ctx.camera);
      ({ calls, triangles: tris } = ctx.renderer.info.render);
    } else {
      ctx.renderer.setRenderTarget(post.target);
      ctx.renderer.render(ctx.scene, ctx.camera);
      ({ calls, triangles: tris } = ctx.renderer.info.render);
      ctx.renderer.setRenderTarget(null);
      post.material.uniforms.uInvProj.value.copy(ctx.camera.projectionMatrixInverse);
      post.material.uniforms.uCamWorld.value.copy(ctx.camera.matrixWorld);
      ctx.renderer.render(post.scene, post.camera);
    }
    if (statsEl) {
      const s = terrain.stats;
      statsEl.textContent = `tiles selected ${s.drawn} resident ${s.resident} inflight ${s.inflight}\ntrees ${s.trees} impostors ${s.impostors}\ncalls ${calls} tris ${(tris / 1e6).toFixed(2)}M`;
    }
  },
});
