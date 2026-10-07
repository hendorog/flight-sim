// Inspection page for the procedural cloud noise: weather map channels, a slice of the shape and detail
// volumes, and a histogram of each (printed as console warnings so scripts/shot.mjs shows them) to tune the coverage remapping against.
import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { createRenderer } from '../core/renderSetup';
import { createCloudNoiseTextures } from '../render/clouds/noiseTextures';

const canvas = document.createElement('canvas');
document.body.style.cssText = 'margin:0;background:#000';
document.body.appendChild(canvas);
const renderer = createRenderer(canvas);
renderer.setSize(1536, 768, false);
const noise = await createCloudNoiseTextures(renderer);

// Top row: weather R, G, B, A. Bottom row: shape slice, shape slice (other z), detail slice, shape side view.
const material = new THREE.ShaderMaterial({
  glslVersion: THREE.GLSL3,
  vertexShader: 'out vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: /* glsl */ `
    precision highp sampler3D;
    in vec2 vUv;
    layout(location = 0) out vec4 outColor;
    uniform sampler2D uWeather;
    uniform sampler3D uShape, uDetail;
    void main() {
      vec2 cell = floor(vUv * vec2(4.0, 2.0));
      vec2 uv = fract(vUv * vec2(4.0, 2.0));
      float v;
      // Weather R thresholded at the top 35 % and 15 % of its (normal-score) values: the cloud cells at those covers.
      if (cell.y > 0.5 && cell.x < 0.5) v = step(0.5 + 0.385 / 6.0, texture(uWeather, uv).r);
      else if (cell.y > 0.5 && cell.x < 1.5) v = step(0.5 + 1.036 / 6.0, texture(uWeather, uv).r);
      else if (cell.y > 0.5) v = texture(uWeather, uv)[int(cell.x)];
      else if (cell.x < 0.5) v = textureLod(uShape, vec3(uv, 0.3), 0.0).r;
      else if (cell.x < 1.5) v = textureLod(uShape, vec3(uv, 0.7), 0.0).r;
      else if (cell.x < 2.5) v = textureLod(uDetail, vec3(uv, 0.5), 0.0).r;
      else v = textureLod(uShape, vec3(uv.x, 0.5, uv.y), 0.0).r;
      outColor = vec4(vec3(v), 1.0);
    }`,
  uniforms: { uWeather: { value: noise.weather }, uShape: { value: noise.shape }, uDetail: { value: noise.detail } },
});
const quad = new FullScreenQuad(material);
const rt = new THREE.WebGLRenderTarget(1536, 768);
renderer.setRenderTarget(rt);
quad.render(renderer);
const pixels = new Uint8Array(1536 * 768 * 4);
await renderer.readRenderTargetPixelsAsync(rt, 0, 0, 1536, 768, pixels);
const names = ['shape z0.3', 'shape z0.7', 'detail', 'shape side', 'weather R>35%', 'weather R>15%', 'weather B', 'weather A'];
for (let panel = 0; panel < 8; panel++) {
  const px0 = (panel % 4) * 384;
  const py0 = Math.floor(panel / 4) * 384;
  const hist = new Array(10).fill(0);
  for (let y = py0; y < py0 + 384; y += 2)
    for (let x = px0; x < px0 + 384; x += 2) hist[Math.min(9, Math.floor(pixels[(y * 1536 + x) * 4] / 25.6))]++;
  const total = hist.reduce((a, b) => a + b, 0);
  console.warn(`[noise] ${names[panel].padEnd(11)} ${hist.map((h) => ((100 * h) / total).toFixed(0).padStart(3)).join(' ')}  (% per 0.1 bin)`);
}
renderer.setRenderTarget(null);
quad.render(renderer);
(window as unknown as { __ready: boolean }).__ready = true;
