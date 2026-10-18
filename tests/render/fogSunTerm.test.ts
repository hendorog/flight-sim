// The ground fog on the sun term of every lit material (src/sim/cloudShadows.ts): inside the fog layer light 0's
// colour is scaled by the fog transmittance toward the layer top, the removed beam returns as diffuse light, and
// without a fog layer the block is skipped by a uniform branch (uFog.w = 0).

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { defaultWeather } from '../../src/core/types';
import { SceneMaterialPatches } from '../../src/sim/cloudShadows';
import { fogUniformValue } from '../../src/render/weather/fogGlsl';

function patches(): SceneMaterialPatches {
  return new SceneMaterialPatches(
    {
      cloudShadowMap: { value: null },
      cloudShadowParams: { value: new THREE.Vector4() },
      cloudShadowLight: { value: new THREE.Vector4() },
    } as unknown as ConstructorParameters<typeof SceneMaterialPatches>[0],
    null,
    null,
  );
}

function compile(m: THREE.Material): { uniforms: Record<string, THREE.IUniform>; fragmentShader: string } {
  const shader = { uniforms: {} as Record<string, THREE.IUniform>, vertexShader: '', fragmentShader: 'void main() {}' };
  (m.onBeforeCompile as unknown as (s: typeof shader, r: unknown) => void)(shader, null);
  return shader;
}

describe('ground fog on the sun term', () => {
  it('installs the fog block after the cloud shadow, inside USE_CLOUD_SHADOW, behind a uniform branch', () => {
    const frag = THREE.ShaderChunk.lights_fragment_begin;
    const cloud = frag.indexOf('directLight.color *= cloudShadow(');
    const fog = frag.indexOf('if ( uFog.w > 0.5 ) {');
    const shadowMap = frag.indexOf('#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0');
    expect(cloud).toBeGreaterThan(0);
    expect(fog).toBeGreaterThan(cloud);
    // Before the cascade shadow: the diffuse share is not shadowed by the aircraft.
    expect(shadowMap).toBeGreaterThan(fog);
    const block = frag.slice(frag.lastIndexOf('#ifdef USE_CLOUD_SHADOW', fog), shadowMap);
    expect(block).toContain('fogOpticalDepth(');
    expect(block).toContain('directLight.color *= fsDirect;');
    expect(block).toContain('RE_IndirectDiffuse( fsDiffuse,');
    expect(block.indexOf('#endif')).toBeGreaterThan(block.indexOf('RE_IndirectDiffuse'));
    const pars = THREE.ShaderChunk.lights_pars_begin;
    expect(pars).toMatch(/#ifdef USE_CLOUD_SHADOW[\s\S]*uniform vec4 uFog;[\s\S]*float fogOpticalDepth\(/);
  });

  it('gives every patched material the shared fog uniform, written from the weather in update()', () => {
    const p = patches();
    const mat = new THREE.MeshStandardMaterial();
    const scene = new THREE.Scene();
    scene.add(new THREE.Mesh(new THREE.BoxGeometry(), mat));
    p.update(scene);
    const shader = compile(mat);
    expect(shader.fragmentShader.startsWith('#define USE_CLOUD_SHADOW\n')).toBe(true);
    expect(shader.uniforms.uFog).toBe(p.fog);
    expect(p.fog.value.toArray()).toEqual([0, 0, 0, 0]);

    const fogged = { ...defaultWeather(), fogTopM: 60, fogVisibilityM: 200 };
    p.update(scene, fogged);
    expect(p.fog.value.toArray()).toEqual(fogUniformValue(fogged, new THREE.Vector4()).toArray());
    expect(p.fog.value.w).toBe(1);

    p.update(scene, defaultWeather());
    expect(p.fog.value.toArray()).toEqual([0, 0, 0, 0]);
  });
});
