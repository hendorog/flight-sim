// Frozen lakes: water above the snow line is drawn as snow (water.ts 'ice'). The ice code goes into the water
// shaders only in a world whose water can freeze; seed 0's water shaders stay as they were (presentGuard pins them).
import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { hydrology, setSnowShift, snowLine, terrainSurface } from '../../src/world/terrain/heightfield';
import { createWaterGeometry, createWaterMaterial, waterFreezes, type WaterUniforms } from '../../src/world/terrain/water';
import { setWorldSeed } from '../../src/world/worldSeed';

interface FakeShader {
  uniforms: Record<string, { value: unknown }>;
  vertexShader: string;
  fragmentShader: string;
}

function patch(river: boolean): { shader: FakeShader; key: string } {
  const uniforms: WaterUniforms = { uTime: { value: 0 }, uSkyColor: { value: new THREE.Color() }, uHazeColor: { value: new THREE.Color() } };
  const mat = createWaterMaterial(new THREE.Texture(), uniforms, river);
  const src = THREE.ShaderLib.standard;
  const shader: FakeShader = { uniforms: {}, vertexShader: src.vertexShader, fragmentShader: src.fragmentShader };
  (mat.onBeforeCompile as unknown as (s: FakeShader, r: unknown) => void)(shader, null);
  return { shader, key: mat.customProgramCacheKey() };
}

const ICE_LINES = [
  'float wIce;',
  'vec3 wSpec = (wDirect + wSky * fresnel) * (1.0 - wIce);',
  'wColor = mix(wColor, totalDiffuse, wIce);',
  'mix(1.0 - wSeen, 1.0, wIce)',
];

describe('frozen lakes', () => {
  afterEach(() => {
    setSnowShift(0);
    setWorldSeed(0);
  });

  it('seed 0: no water near the snow line, no ice code', () => {
    setWorldSeed(0);
    expect(waterFreezes()).toBe(false);
    for (const river of [false, true]) {
      const { shader, key } = patch(river);
      expect(shader.fragmentShader).not.toContain('wIce');
      expect(key).not.toContain('ice');
    }
  });

  it('with the snow line below a lake, every ice splice lands in both water shaders', () => {
    setWorldSeed(0);
    // Seed 0's highest lake stands at 1280 m: a 1300 m lower snow line puts it 80 m above the line's base.
    setSnowShift(-1300);
    expect(waterFreezes()).toBe(true);
    for (const river of [false, true]) {
      const { shader, key } = patch(river);
      for (const l of ICE_LINES) expect(shader.fragmentShader).toContain(l);
      expect(shader.fragmentShader).toContain('float iLine = 1200.0 +');
      expect(shader.vertexShader).toContain('vIceConcave =');
      expect(shader.vertexShader.includes('attribute float aIceShape;')).toBe(!river);
      expect(key).toContain('-ice1200');
    }
  });

  it('the water geometry carries the terrain curvature byte only in a world whose water can freeze', () => {
    setWorldSeed(0);
    const water = { positions: new Float32Array(12), depth: new Float32Array(4), index: new Uint16Array([0, 1, 2]) };
    const shape = new Uint8Array([10, 1, 2, 3, 20, 1, 2, 3, 30, 1, 2, 3, 40, 1, 2, 3, 99, 99, 99, 99]);
    expect(createWaterGeometry(water, shape).getAttribute('aIceShape')).toBeUndefined();
    setSnowShift(-1300);
    const a = createWaterGeometry(water, shape).getAttribute('aIceShape') as THREE.BufferAttribute;
    expect(Array.from(a.array as Uint8Array)).toEqual([10, 20, 30, 40]);
    expect(a.normalized).toBe(true);
  });

  it('a frozen lake is snow underfoot, an open one water', () => {
    setWorldSeed(0);
    const lake = [...hydrology.lakes].sort((a, b) => b.level - a.level)[0];
    expect(terrainSurface(lake.north, lake.east)).toBe('water');
    setSnowShift(lake.level - snowLine(lake.north, lake.east) - 100);
    expect(terrainSurface(lake.north, lake.east)).toBe('snow');
  });
});
