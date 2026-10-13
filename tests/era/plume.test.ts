// Deep Time, increment 2 (WP5): the volcano's plume (render/post/VolcanoPlumeEffect.ts, via eraEffects.ts).
//   - never constructed in the present day, nor with ?eraoff=plume;
//   - its bounds contain the vent and lean downwind (a 20 kt westerly puts the top east of the vent);
//   - its programs bind (a fake program: every declared uniform has a value and vice versa, one main, balanced
//     braces, the depth decode and the aerial atlas included);
//   - the march's loop runs at most 24 steps.

import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CRETACEOUS } from '../../src/world/era/cretaceous';
import type { WeatherSettings } from '../../src/core/types';

const V = CRETACEOUS.terrain.volcano!;

afterEach(async () => {
  (await import('../../src/world/era/eraState')).setEra('present');
  (await import('../../src/world/era/eraOff')).setEraOff(null);
  vi.doUnmock('../../src/render/post/VolcanoPlumeEffect');
  vi.resetModules();
});

const weather = (dir: number, kt: number) => ({ windDirectionDeg: dir, windSpeedKt: kt }) as unknown as WeatherSettings;
const fakeCtx = () => ({ ctx: {} as never, renderer: {} as never, scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), weather: weather(100, 6) });

/** createEraEffects with the plume's constructor counted. */
async function effects(eraId: 'present' | 'cretaceous', off: 'plume'[] | null = null): Promise<{ n: number; built: number }> {
  let built = 0;
  vi.doMock('../../src/render/post/VolcanoPlumeEffect', async (orig) => {
    const m = await orig<typeof import('../../src/render/post/VolcanoPlumeEffect')>();
    class Counted extends m.VolcanoPlumeEffect {
      constructor(...a: ConstructorParameters<typeof m.VolcanoPlumeEffect>) {
        super(...a);
        built++;
      }
    }
    return { ...m, VolcanoPlumeEffect: Counted };
  });
  vi.resetModules();
  (await import('../../src/world/era/eraState')).setEra(eraId);
  (await import('../../src/world/era/eraOff')).setEraOff(off);
  const { createEraEffects } = await import('../../src/render/post/eraEffects');
  const list = createEraEffects(fakeCtx());
  return { n: list.length, built };
}

describe('construction', () => {
  it('not in the present day', async () => {
    expect(await effects('present')).toEqual({ n: 0, built: 0 });
  });
  it('not with ?eraoff=plume', async () => {
    expect(await effects('cretaceous', ['plume'])).toEqual({ n: 0, built: 0 });
  });
  it('once in the Cretaceous', async () => {
    expect(await effects('cretaceous')).toEqual({ n: 1, built: 1 });
  });
});

describe('bounds', () => {
  it('contain the vent and lean downwind in a 20 kt westerly', async () => {
    const { plumeBounds, makePlumeBounds, PLUME_TOP_MSL } = await import('../../src/render/post/VolcanoPlumeEffect');
    const b = plumeBounds(V, weather(270, 20), makePlumeBounds());
    const vent = new THREE.Vector3(V.east, V.summit - V.craterDepth, -V.north);
    expect(b.vent.distanceTo(vent)).toBe(0);
    expect(b.box.containsPoint(vent)).toBe(true);
    // A westerly blows TO the east: world +x; no north-south lean.
    expect(b.lean.x).toBeGreaterThan(1000);
    expect(Math.abs(b.lean.y)).toBeLessThan(1e-6);
    const top = new THREE.Vector3(vent.x + b.lean.x, PLUME_TOP_MSL, vent.z + b.lean.y);
    expect(b.box.containsPoint(top)).toBe(true);
    expect(b.box.max.y).toBeGreaterThanOrEqual(PLUME_TOP_MSL);
    // Calm: straight up; a northerly leans it south (world +z).
    expect(plumeBounds(V, weather(0, 0), makePlumeBounds()).lean.length()).toBe(0);
    expect(plumeBounds(V, weather(360, 15), makePlumeBounds()).lean.y).toBeGreaterThan(500);
  });
});

/** The uniform names a GLSL text declares (`uniform <type> name;`). */
const declared = (src: string): string[] => [...src.matchAll(/^\s*uniform\s+(?:highp\s+|mediump\s+|lowp\s+)?\w+\s+(\w+)(?:\[[^\]]*\])?\s*;/gm)].map((m) => m[1]);

describe('the programs', () => {
  it('bind under a fake program: uniforms declared and supplied match, one main, balanced braces', async () => {
    const { VolcanoPlumeEffect } = await import('../../src/render/post/VolcanoPlumeEffect');
    const e = new VolcanoPlumeEffect(V, weather(100, 6));
    for (const mat of [e.marchMat, e.compositeMat]) {
      const src = mat.fragmentShader;
      const names = declared(src);
      expect(new Set(names).size).toBe(names.length);
      expect(names.sort()).toEqual(Object.keys(mat.uniforms).sort());
      expect(src.match(/void main\(\)/g)?.length).toBe(1);
      expect(src.split('{').length).toBe(src.split('}').length);
      expect(src.split('(').length).toBe(src.split(')').length);
      expect(src).toContain('viewZFromDepth');
      expect(src).not.toMatch(/\$\{/);
      expect(mat.glslVersion).toBe(THREE.GLSL3);
    }
    expect(e.marchMat.fragmentShader).toContain('aerialPerspective(vUv, front)');
    expect(e.marchMat.fragmentShader).toContain('float lavaGain(float w)');
    expect(e.marchMat.uniforms.uLava).toBe((await import('../../src/world/terrain/eraUniforms')).ERA_UNIFORMS.uLava);
    e.setSize(1600, 900);
    e.dispose();
  });

  it('the march loop runs at most 24 steps', async () => {
    const { PLUME_STEPS, PLUME_MARCH_FRAG } = await import('../../src/render/post/VolcanoPlumeEffect');
    expect(PLUME_STEPS).toBeLessThanOrEqual(24);
    const loops = [...PLUME_MARCH_FRAG.matchAll(/for\s*\(\s*int\s+\w+\s*=\s*0\s*;\s*\w+\s*<\s*(\w+)\s*;/g)].map((m) => m[1]);
    expect(loops.length).toBe(1);
    for (const n of loops) {
      expect(n).toMatch(/^\d+$/);
      expect(Number(n)).toBeLessThanOrEqual(24);
    }
    expect(PLUME_MARCH_FRAG).not.toMatch(/\bwhile\b/);
  });
});
