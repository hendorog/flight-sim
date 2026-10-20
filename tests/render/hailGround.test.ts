// Hail on the ground (render/weather/hailGround.ts, HailGroundOverlay.ts): the state model, and active() false with
// nothing to draw (no hail falling or lying, the camera high), so PostPipeline skips it and the frame is the one
// without it. Fake renderer, no WebGL.

import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEventBus, type SimContext } from '../../src/core/context';
import { makeMockEnvironment } from '../../src/core/mockState';
import { defaultWeather, type WeatherSettings } from '../../src/core/types';
import { emptyLocalPrecip, type LocalPrecip } from '../../src/physics/weather/stormPrecip';
import { emptyHailDamage } from '../../src/sim/weather/hailDamage';
import { Atmosphere } from '../../src/render/sky/Atmosphere';
import { bounceHeights, COVER_MELT_S, HAIL_RESTITUTION, HailGround } from '../../src/render/weather/hailGround';
import { HailGroundOverlay } from '../../src/render/weather/HailGroundOverlay';

const report = (label: string, values: Record<string, number | string>) =>
  console.log(`[hail ground] ${label}: ${Object.entries(values).map(([k, v]) => `${k}=${typeof v === 'number' ? +v.toPrecision(4) : v}`).join('  ')}`);

describe('hail on the ground', () => {
  it('bounces at the restitution, covers the ground under heavy hail and melts after it', () => {
    const [h1, h2] = bounceHeights(20);
    report('bounce of a 20 mm stone', { e: HAIL_RESTITUTION, firstM: h1, secondM: h2 });
    expect(h2 / h1).toBeCloseTo(HAIL_RESTITUTION ** 2, 6);
    const g = new HailGround();
    for (let t = 0; t < 120; t += 0.5) g.update(10, 30, 0.5);
    const cover = g.cover;
    expect(cover).toBeGreaterThan(0.5);
    expect(g.impactsPerM2s).toBeGreaterThan(0);
    for (let t = 0; t < COVER_MELT_S; t += 0.5) g.update(0, 0, 0.5);
    expect(g.cover).toBeCloseTo(cover / Math.E, 2);
    expect(g.impactsPerM2s).toBe(0);
    report('ground cover', { after2minAt10mmH: cover, oneMeltTimeLater: g.cover });
  });
});

// ------------------------------------------------------------------------------------------------- active()

function fakeRenderer(): THREE.WebGLRenderer {
  return { autoClear: true, setRenderTarget: () => undefined, getRenderTarget: () => null, render: () => undefined } as unknown as THREE.WebGLRenderer;
}

function makeCtx(weather: Partial<WeatherSettings> = {}, precip: LocalPrecip = emptyLocalPrecip()): SimContext {
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 400_000);
  camera.position.set(0, 121.5, 0);
  camera.updateMatrixWorld();
  const root = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial();
  const g = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  g.name = 'glazing';
  root.add(g);
  return {
    camera,
    aircraftRoot: root,
    weather: { ...defaultWeather(), ...weather },
    quality: 'high',
    cameraMode: 'cockpit',
    simTime: 0,
    state: { tas: 0, alpha: 0, beta: 0, altitudeMSL: 121, altitudeAGL: 1 },
    env: makeMockEnvironment(),
    events: createEventBus(),
    sky: { sunDir: new THREE.Vector3(0, 1, 0), skyColor: new THREE.Color(1, 1, 1), sunColor: new THREE.Color(1, 1, 1), hazeColor: new THREE.Color(1, 1, 1), hazeExtinction: 1e-4, hazeScaleHeight: 1200 },
    weatherFx: { flash: { x: 0, y: 0, z: 0, energy: 0 }, precip, damage: emptyHailDamage() },
  } as unknown as SimContext;
}

const input = new THREE.Texture();
const depth = new THREE.DepthTexture(4, 4);
const output = new THREE.WebGLRenderTarget(4, 4);

describe('HailGroundOverlay active()', () => {
  beforeEach(() => {
    vi.spyOn(Atmosphere, 'for').mockReturnValue({ cloudSky: { directGround: 1 } } as unknown as Atmosphere);
  });
  afterEach(() => vi.restoreAllMocks());

  it('the ground: false without hail and cover, true while it lies', () => {
    const r = fakeRenderer();
    const o = new HailGroundOverlay();
    const dry = makeCtx();
    expect(o.active(dry)).toBe(true);
    o.render(r, input, depth, output, dry, 0.016);
    expect(o.active(dry)).toBe(false);
    o.ground.cover = 0.3;
    expect(o.active(dry)).toBe(true);
    dry.camera.position.y = 1000;
    expect(o.active(dry)).toBe(false);
    o.dispose();
  });
});
