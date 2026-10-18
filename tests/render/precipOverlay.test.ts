// PrecipOverlay.render with a fake renderer (no WebGL): which material it draws and the uniforms it sends.

import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SimContext } from '../../src/core/context';
import type { WeatherSettings } from '../../src/core/types';
import { Atmosphere } from '../../src/render/sky/Atmosphere';
import { PRECIP_LOOK, PrecipOverlay } from '../../src/render/weather/PrecipOverlay';
import type { WeatherEffectContext } from '../../src/render/weather/index';

function fakeRenderer(drawn: THREE.Material[]): THREE.WebGLRenderer {
  const r = {
    autoClear: true,
    setRenderTarget: () => undefined,
    getRenderTarget: () => null,
    render: (mesh: THREE.Mesh) => {
      drawn.push(mesh.material as THREE.Material);
    },
  };
  return r as unknown as THREE.WebGLRenderer;
}

function makeCtx(weather: Partial<WeatherSettings>, over: Partial<SimContext> = {}): SimContext {
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 1000);
  camera.position.set(0, 2, 0);
  camera.lookAt(0, 2, -10);
  camera.updateMatrixWorld();
  return {
    camera,
    weather: weather as WeatherSettings,
    quality: 'high',
    cameraMode: 'chase',
    simTime: 0,
    sky: { sunDir: new THREE.Vector3(0, 1, 0), skyColor: new THREE.Color(1, 1, 1), sunColor: new THREE.Color(1, 1, 1) },
    ...over,
  } as unknown as SimContext;
}

const input = new THREE.Texture();
const depth = new THREE.DepthTexture(4, 4);
const output = new THREE.WebGLRenderTarget(4, 4);

describe('PrecipOverlay.render', () => {
  beforeEach(() => {
    vi.spyOn(Atmosphere, 'for').mockReturnValue({ cloudSky: { directGround: 1 } } as unknown as Atmosphere);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('copies its input at rate 0 (after compiling the streak shader once into the warm-up target)', () => {
    const drawn: THREE.Material[] = [];
    const o = new PrecipOverlay();
    o.render(fakeRenderer(drawn), input, depth, output, makeCtx({}), 0.016);
    expect(o.drawn).toBe(false);
    expect(drawn.length).toBe(2);
    expect(drawn[0]).toBe(o.material);
    expect(drawn[1]).not.toBe(o.material);
  });

  it('copies its input on low', () => {
    const drawn: THREE.Material[] = [];
    const o = new PrecipOverlay();
    o.render(fakeRenderer(drawn), input, depth, output, makeCtx({ precipType: 'rain', precipRateMmH: 4 }, { quality: 'low' }), 0.016);
    expect(o.drawn).toBe(false);
    expect(drawn[drawn.length - 1]).not.toBe(o.material);
  });

  it('rain 4 mm/h on high: 4 shells from 2 m, the rain look, vRel straight down at the fall speed', () => {
    const drawn: THREE.Material[] = [];
    const o = new PrecipOverlay();
    o.render(fakeRenderer(drawn), input, depth, output, makeCtx({ precipType: 'rain', precipRateMmH: 4 }), 0.016);
    const u = o.material.uniforms;
    expect(o.drawn).toBe(true);
    expect(drawn[drawn.length - 1]).toBe(o.material);
    expect(u.uShells.value).toBe(4);
    expect((u.uShellA.value as THREE.Vector4[])[0].x).toBe(2);
    expect(u.uOcclusion.value).toBe(PRECIP_LOOK.rain.occlusion);
    expect(u.uCabinOn.value).toBe(0);
    expect(o.vRel.x).toBe(0);
    expect(o.vRel.y).toBe(-7);
    expect(o.vRel.z).toBe(0);
    // Parked: a 0.117 m streak on the 2 m shell needs a cell of 2 CELL_ANGLE, 2 drops, unsaturated at 4 mm/h.
    const c0 = (u.uShellC.value as THREE.Vector4[])[0];
    expect(c0.x).toBe(2);
    expect(c0.y).toBe(1);
  });

  it('masks the cabin only in the cockpit view with a post pipeline', () => {
    const cabin = vi.fn();
    const post = { cabinFromView: cabin } as unknown as WeatherEffectContext['post'];
    const w = { precipType: 'rain', precipRateMmH: 4 } as const;
    const o = new PrecipOverlay(post);
    o.render(fakeRenderer([]), input, depth, output, makeCtx(w, { cameraMode: 'cockpit' }), 0.016);
    expect(o.material.uniforms.uCabinOn.value).toBe(1);
    expect(cabin).toHaveBeenCalledTimes(1);
    o.render(fakeRenderer([]), input, depth, output, makeCtx(w, { cameraMode: 'chase' }), 0.016);
    expect(o.material.uniforms.uCabinOn.value).toBe(0);
    const bare = new PrecipOverlay();
    bare.render(fakeRenderer([]), input, depth, output, makeCtx(w, { cameraMode: 'cockpit' }), 0.016);
    expect(bare.material.uniforms.uCabinOn.value).toBe(0);
  });

  it('a camera mode switch is a cut: a 15 m jump at dt 0.1 s does not become a camera velocity', () => {
    const o = new PrecipOverlay();
    const r = fakeRenderer([]);
    const w = { precipType: 'rain', precipRateMmH: 4 } as const;
    const a = makeCtx(w, { cameraMode: 'cockpit' });
    o.render(r, input, depth, output, a, 0.1);
    const b = makeCtx(w, { cameraMode: 'chase', simTime: 0.1 });
    b.camera.position.set(0, 2, 15);
    b.camera.updateMatrixWorld();
    o.render(r, input, depth, output, b, 0.1);
    expect(o.vRel.z).toBe(0);
    expect(o.vRel.y).toBe(-7);
    // The same jump without a mode change is read as 150 m/s of camera motion (below CUT_SPEED_MS).
    const c = makeCtx(w, { cameraMode: 'chase', simTime: 0.2 });
    c.camera.position.set(0, 2, 30);
    c.camera.updateMatrixWorld();
    o.render(r, input, depth, output, c, 0.1);
    expect(o.vRel.z).toBeLessThan(-50);
  });
});
