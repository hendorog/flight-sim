// Dev probe (not used by the app): evaluates the GPU sky summary shader (SKY_SUMMARY_FRAG) against the
// live atmosphere LUTs of a renderer and the CPU port (cpuSky.ts) for the same state, so the two can be
// compared in the real browser. Use from a page with a running SkySystem, e.g. in scripts/shot.mjs:
//   --eval "import('/src/dev/skyProbe.ts').then(m => m.compareSkySummary(__sim.ctx.renderer))"

import * as THREE from 'three';
import { FullscreenPass, passMaterial } from '../render/post/FullscreenPass';
import { Atmosphere } from '../render/sky/Atmosphere';
import { CpuSky, SUMMARY_BANDS, createSkyBands } from '../render/sky/cpuSky';
import { SKY_SUMMARY_FRAG } from '../render/sky/glsl/luts';

export function compareSkySummary(renderer: THREE.WebGLRenderer): {
  sunMu: number;
  altKm: number;
  gpu: { sky: number[]; horizon: number[] };
  cpu: { sky: number[]; horizon: number[] };
} {
  const atm = Atmosphere.for(renderer);
  const target = new THREE.WebGLRenderTarget(2, 1, { type: THREE.FloatType, depthBuffer: false });
  const mat = passMaterial({ fragmentShader: SKY_SUMMARY_FRAG, uniforms: atm.uniforms });
  const prev = renderer.getRenderTarget();
  new FullscreenPass().render(renderer, mat, target);
  const px = new Float32Array(8);
  renderer.readRenderTargetPixels(target, 0, 0, 2, 1, px);
  renderer.setRenderTarget(prev);
  target.dispose();
  mat.dispose();

  const altKm = atm.uniforms.uCamR.value - 6360;
  const sunMu = atm.celestial.sunDir.y;
  const cpu = new CpuSky();
  cpu.setParams(atm.params);
  const b = createSkyBands();
  const e = atm.sunIlluminance;
  cpu.addSummary(altKm, sunMu, [e.x, e.y, e.z], b);
  const sky = [0, 0, 0];
  for (let i = 0; i < SUMMARY_BANDS; i++) for (let k = 0; k < 3; k++) sky[k] += b.weight[i] * b.band[3 * i + k];
  const r = (v: number): number => Math.round(v * 100) / 100;
  return {
    sunMu: r(sunMu * 1000) / 1000,
    altKm: r(altKm),
    gpu: { sky: Array.from(px.slice(0, 3), r), horizon: Array.from(px.slice(4, 7), r) },
    cpu: { sky: sky.map(r), horizon: Array.from(b.horizon, r) },
  };
}

/** Adapted and target log2 luminance of the eye adaptation, and log2 of the grey-card reference. */
export function exposureState(post: unknown, renderer: THREE.WebGLRenderer): { adapted: number; target: number } {
  const exposure = (post as { exposure: { adapted: THREE.WebGLRenderTarget[] } }).exposure;
  const px = new Float32Array(4);
  renderer.readRenderTargetPixels(exposure.adapted[0], 0, 0, 1, 1, px);
  return { adapted: px[0], target: px[1] };
}
