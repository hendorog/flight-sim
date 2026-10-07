// The cloud-shadow map is re-rendered every other frame (CloudsEffect); between refreshes the uniforms must
// keep describing the map that is actually stored (its centre and projection direction), while the shadow
// strength still follows the light every frame.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CloudModel } from '../../src/render/clouds/cloudModel';
import { CloudShadowPass } from '../../src/render/clouds/cloudShadow';

/** Just enough of a WebGLRenderer for a full-screen pass: counts the draws. */
function fakeRenderer(): { renderer: THREE.WebGLRenderer; draws: () => number } {
  let draws = 0;
  const r = {
    setRenderTarget: () => undefined,
    getRenderTarget: () => null,
    render: () => {
      draws++;
    },
  };
  return { renderer: r as unknown as THREE.WebGLRenderer, draws: () => draws };
}

describe('CloudShadowPass refresh', () => {
  const up = new THREE.Vector3(0.3, 0.9, 0.2).normalize();

  it('renders on the first call even when asked to skip the refresh', () => {
    const pass = new CloudShadowPass(new CloudModel(), 64);
    const { renderer, draws } = fakeRenderer();
    pass.render(renderer, new THREE.Vector3(100, 0, 200), up, 1500, 0.8, false);
    expect(draws()).toBe(1);
    pass.dispose();
  });

  it('keeps the stored centre and direction between refreshes and updates only the strength', () => {
    const pass = new CloudShadowPass(new CloudModel(), 64);
    const { renderer, draws } = fakeRenderer();
    pass.render(renderer, new THREE.Vector3(0, 0, 0), up, 1500, 0.8, true);
    const params = pass.uniforms.cloudShadowParams.value.clone();
    const light = pass.uniforms.cloudShadowLight.value.clone();

    pass.render(renderer, new THREE.Vector3(5_000, 0, -3_000), new THREE.Vector3(0, 1, 0), 1500, 0.4, false);
    expect(draws()).toBe(1);
    expect(pass.uniforms.cloudShadowParams.value.equals(params)).toBe(true);
    expect(pass.uniforms.cloudShadowLight.value.x).toBeCloseTo(light.x, 6);
    expect(pass.uniforms.cloudShadowLight.value.w).toBe(0.4);

    pass.render(renderer, new THREE.Vector3(5_000, 0, -3_000), new THREE.Vector3(0, 1, 0), 1500, 0.4, true);
    expect(draws()).toBe(2);
    expect(pass.uniforms.cloudShadowParams.value.x).not.toBe(params.x);
    pass.dispose();
  });

  it('re-renders after a zero-strength frame, which leaves no valid map', () => {
    const pass = new CloudShadowPass(new CloudModel(), 64);
    const { renderer, draws } = fakeRenderer();
    pass.render(renderer, new THREE.Vector3(), up, 1500, 0, true);
    expect(draws()).toBe(0);
    pass.render(renderer, new THREE.Vector3(), up, 1500, 0.5, false);
    expect(draws()).toBe(1);
    pass.dispose();
  });
});
