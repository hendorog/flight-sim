// Running water (water.ts 'flow'): a seeded world's river ribbons carry each row's steepness, speed, fall weight and grain,
// its falls get curtains, pool foam and spray, and the whitewater code goes into the river (and falls) shaders only
// on such a world; seed 0's water and river shaders are unchanged (presentGuard pins them). Where the water can also
// freeze, the ice code follows the flow code so a frozen reach stays ice.
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { hydrology, setSnowShift } from '../../src/world/terrain/heightfield';
import { REGIME } from '../../src/world/terrain/streams';
import { createFallGeometries, createRiverNetworkGeometries, createWaterMaterial, waterFlows, waterFreezes, type WaterUniforms } from '../../src/world/terrain/water';
import { setWorldSeed } from '../../src/world/worldSeed';
// (Under a full parallel suite run its slowest test here takes up to about 22 s, over the 5 s default: round T repairs.)
vi.setConfig({ testTimeout: 60_000 });

interface FakeShader {
  uniforms: Record<string, { value: unknown }>;
  vertexShader: string;
  fragmentShader: string;
}

function patch(river: boolean, falls: 'sheet' | 'mist' | null = null): { shader: FakeShader; key: string } {
  const uniforms: WaterUniforms = { uTime: { value: 0 }, uSkyColor: { value: new THREE.Color() }, uHazeColor: { value: new THREE.Color() } };
  const mat = createWaterMaterial(new THREE.Texture(), uniforms, river, falls);
  const src = THREE.ShaderLib.standard;
  const shader: FakeShader = { uniforms: {}, vertexShader: src.vertexShader, fragmentShader: src.fragmentShader };
  (mat.onBeforeCompile as unknown as (s: FakeShader, r: unknown) => void)(shader, null);
  return { shader, key: mat.customProgramCacheKey() };
}

describe('running water', () => {
  afterEach(() => {
    setSnowShift(0);
    setWorldSeed(0);
  });

  it('seed 0: no flow code, no flow attribute, no falls', () => {
    setWorldSeed(0);
    expect(waterFlows()).toBe(false);
    for (const river of [false, true]) {
      const { shader, key } = patch(river);
      expect(shader.fragmentShader).not.toContain('wSpecCut');
      expect(shader.vertexShader).not.toContain('aFlow');
      expect(key).not.toContain('flow');
    }
    expect(createFallGeometries().sheets.length).toBe(0);
  });

  it('seed 42: every flow splice lands; the lake shader is untouched', () => {
    setWorldSeed(42);
    expect(waterFlows()).toBe(true);
    const river = patch(true);
    expect(river.key).toContain('-flow3');
    expect(river.shader.vertexShader).toContain('attribute vec4 aFlow;');
    expect(river.shader.vertexShader).toContain('vFlow = aFlow * vec4(1.0, 6.0, 1.0, 1.0);');
    expect(river.shader.fragmentShader).toContain('varying vec4 vFlow;');
    // The bed's stone lattice (channelStones.ts) after the hashes it uses, and the bank trees thinned in the mirror.
    const fsr = river.shader.fragmentShader;
    expect(fsr.indexOf('vec4 chStone(')).toBeGreaterThan(fsr.indexOf('uint hash2u('));
    expect(fsr).toContain('tree *= wTreeKeep;\n  float bank = max(herb, tree);');
    expect(river.shader.fragmentShader).toContain('// Running water (water.ts');
    expect(river.shader.fragmentShader).toContain('vec3 wDirect = reflectedLight.directSpecular * (1.0 - wSpecCut);');
    const lake = patch(false);
    expect(lake.shader.fragmentShader).not.toContain('wSpecCut');
    for (const kind of ['sheet', 'mist'] as const) {
      const f = patch(true, kind);
      expect(f.key).toContain('-falls2');
      expect(f.shader.vertexShader).toContain('attribute vec4 aFall;');
      expect(f.shader.vertexShader).toContain('if (aFall.x > 1.5) {');
      expect(f.shader.fragmentShader).toContain('// Falls (water.ts');
      expect(f.shader.fragmentShader).not.toContain('vFlow');
    }
  });

  it('where the water also freezes the ice code follows the flow code (ice wins)', () => {
    setWorldSeed(42);
    setSnowShift(-2500);
    expect(waterFreezes()).toBe(true);
    for (const falls of [null, 'sheet'] as const) {
      const { shader, key } = patch(true, falls);
      const fs = shader.fragmentShader;
      const flowAt = fs.indexOf(falls ? '// Falls (water.ts' : '// Running water (water.ts');
      const iceAt = fs.indexOf('float wIce;');
      expect(flowAt).toBeGreaterThan(0);
      expect(iceAt).toBeGreaterThan(flowAt);
      expect(fs).toContain('vec3 wSpec = (wDirect + wSky * fresnel) * (1.0 - wIce);');
      expect(fs).toContain('mix(1.0 - wSeen, 1.0, wIce)');
      expect(fs).toContain('fresnel *= 1.0 - wSpecCut;');
      if (falls) expect(fs).toContain('* (1.0 - fMist * wIce);');
      expect(key).toMatch(/-ice-?\d+-(flow3|falls2)$/);
    }
  });

  it('seed 42: ribbons carry the flow; each steep fall has a curtain and the ribbon stops down its face', () => {
    setWorldSeed(42);
    const geos = createRiverNetworkGeometries();
    let rows = 0;
    let white = 0;
    for (const g of geos) {
      const f = g.getAttribute('aFlow') as THREE.BufferAttribute;
      expect(f).toBeDefined();
      expect(f.count).toBe(g.getAttribute('position').count);
      rows += f.count;
      for (let v = 0; v < f.count; v++) if (f.getX(v) > 0.75) white++;
    }
    expect(rows).toBeGreaterThan(0);
    expect(white / rows).toBeGreaterThan(0.01);
    const falls = hydrology.falls!;
    const { sheets, spray } = createFallGeometries();
    let cards = 0;
    for (const g of spray) cards += g.getAttribute('position').count / 4;
    let curtainVerts = 0;
    for (const g of sheets) {
      const k = g.getAttribute('aFall') as THREE.BufferAttribute;
      for (let v = 0; v < k.count; v++) if (k.getX(v) === 0) curtainVerts++;
    }
    // Most falls are steep 3 m faces: nearly all get a curtain (at least 7 rows x 13) and every one not under a lake its
    // spray (a tall one two cards).
    expect(cards).toBeGreaterThan(falls.length * 0.9);
    expect(curtainVerts / 91).toBeGreaterThan(falls.length * 0.9);
    // Lip rows are marked as falls in the line data the ribbon reads.
    const f0 = falls[0];
    expect(hydrology.rivers![f0.line].regime![f0.index]).toBe(REGIME.fall);
  });
});
