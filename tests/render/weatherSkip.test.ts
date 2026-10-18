// SceneEffect.active of the four weather effects (render/weather): false with their weather field absent (after the
// first render, which compiles their shaders), true with it set, and the state a skipped render would have left
// (the shared fog uniform, the strike schedule, the published flash and storm layer). Fake renderer, no WebGL.

import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEventBus, type SimContext, type SimEvents } from '../../src/core/context';
import { makeMockEnvironment } from '../../src/core/mockState';
import { defaultWeather, type StormCell, type WeatherSettings } from '../../src/core/types';
import { Atmosphere } from '../../src/render/sky/Atmosphere';
import { FogEffect } from '../../src/render/weather/FogEffect';
import { fogUniformFor } from '../../src/render/weather/fogGlsl';
import { LightningOverlay } from '../../src/render/weather/LightningOverlay';
import { PrecipOverlay } from '../../src/render/weather/PrecipOverlay';
import { StormCellEffect } from '../../src/render/weather/StormCellEffect';
import { strikesBetween, type Strike } from '../../src/sim/weather/lightning';

function fakeRenderer(): { renderer: THREE.WebGLRenderer; draws: () => number } {
  let draws = 0;
  const r = { autoClear: true, setRenderTarget: () => undefined, getRenderTarget: () => null, render: () => void draws++ };
  return { renderer: r as unknown as THREE.WebGLRenderer, draws: () => draws };
}

const cell = (o: Partial<StormCell> = {}): StormCell => ({
  northM: 20_000,
  eastM: -5_000,
  radiusM: 3000,
  topM: 11_000,
  intensity: 1,
  motionDeg: 270,
  motionKt: 15,
  ...o,
});

function makeCtx(weather: Partial<WeatherSettings> = {}): SimContext {
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 400_000);
  camera.position.set(0, 100, 0);
  camera.updateMatrixWorld();
  return {
    camera,
    weather: { ...defaultWeather(), ...weather },
    quality: 'high',
    cameraMode: 'chase',
    simTime: 0,
    env: makeMockEnvironment(),
    events: createEventBus(),
    sky: { sunDir: new THREE.Vector3(0, 1, 0), skyColor: new THREE.Color(1, 1, 1), sunColor: new THREE.Color(1, 1, 1), hazeColor: new THREE.Color(1, 1, 1), hazeExtinction: 1e-4, hazeScaleHeight: 1200 },
    weatherFx: { flash: { x: 0, y: 0, z: 0, energy: 0 } },
  } as unknown as SimContext;
}

const input = new THREE.Texture();
const depth = new THREE.DepthTexture(4, 4);
const output = new THREE.WebGLRenderTarget(4, 4);

describe('FogEffect.active', () => {
  it('is false without a fog layer and true with one, writing the shared fog uniform either way', () => {
    const { renderer } = fakeRenderer();
    const fog = new FogEffect(renderer);
    const u = fogUniformFor(renderer);
    u.value.set(9, 9, 9, 9);
    expect(fog.active(makeCtx())).toBe(false);
    expect(u.value.toArray()).toEqual([0, 0, 0, 0]);
    expect(fog.active(makeCtx({ fogTopM: 60, fogVisibilityM: 300 }))).toBe(true);
    expect(u.value.w).toBe(1);
    expect(u.value.x).toBeGreaterThan(0);
    fog.dispose();
  });
});

describe('PrecipOverlay.active', () => {
  beforeEach(() => {
    vi.spyOn(Atmosphere, 'for').mockReturnValue({ cloudSky: { directGround: 1 } } as unknown as Atmosphere);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is true until the first render, then false at rate 0 and on low, true in rain on high', () => {
    const { renderer } = fakeRenderer();
    const o = new PrecipOverlay();
    const dry = makeCtx();
    expect(o.active(dry)).toBe(true);
    o.render(renderer, input, depth, output, dry, 0.016);
    expect(o.active(dry)).toBe(false);
    const rain = makeCtx({ precipType: 'rain', precipRateMmH: 4 });
    expect(o.active(rain)).toBe(true);
    rain.quality = 'low';
    expect(o.active(rain)).toBe(false);
    o.dispose();
  });

  it('a skipped frame leaves the motion state a copy (render at rate 0) leaves: the next shower draws the same', () => {
    const { renderer } = fakeRenderer();
    const rain = makeCtx({ precipType: 'rain', precipRateMmH: 4 });
    const dry = makeCtx();
    dry.camera = rain.camera;
    const run = (skip: boolean): PrecipOverlay => {
      const o = new PrecipOverlay();
      rain.camera.position.set(0, 100, 0);
      for (let i = 0; i < 3; i++) {
        rain.camera.position.x += 1;
        rain.camera.updateMatrixWorld();
        o.render(renderer, input, depth, output, rain, 0.016);
      }
      rain.camera.position.z += 5;
      rain.camera.updateMatrixWorld();
      if (skip) expect(o.active(dry)).toBe(false);
      else o.render(renderer, input, depth, output, dry, 0.016);
      expect(o.drawn).toBe(false);
      rain.camera.position.x += 1;
      rain.camera.updateMatrixWorld();
      o.render(renderer, input, depth, output, rain, 0.016);
      return o;
    };
    const skipped = run(true);
    const copied = run(false);
    expect(skipped.vRel).toEqual(copied.vRel);
    const a = skipped.material.uniforms, b = copied.material.uniforms;
    for (const k of ['uShellA', 'uShellB', 'uShellC'] as const) expect(a[k].value).toEqual(b[k].value);
    expect((a.uAxis.value as THREE.Vector3).toArray()).toEqual((b.uAxis.value as THREE.Vector3).toArray());
    skipped.dispose();
    copied.dispose();
  });
});

describe('StormCellEffect.active', () => {
  it('is true until the first render, then only with a cell in the view frustum, publishing the layer either way', () => {
    const { renderer, draws } = fakeRenderer();
    const storms = new StormCellEffect(null);
    storms.setSize(4, 4);
    const none = makeCtx();
    expect(storms.active(none)).toBe(true);
    storms.render(renderer, input, depth, output, none);
    expect(draws()).toBe(2);
    expect(storms.active(none)).toBe(false);
    expect(storms.marched).toBe(false);
    expect(storms.count).toBe(0);
    // A cell 20 km north; the camera looks north (three.js -z), then south.
    const ctx = makeCtx({ storms: [cell()] });
    ctx.camera.lookAt(0, 100, -1000);
    ctx.camera.updateMatrixWorld();
    expect(storms.active(ctx)).toBe(true);
    expect(storms.marched).toBe(true);
    expect(storms.count).toBe(1);
    ctx.camera.lookAt(0, 100, 1000);
    ctx.camera.updateMatrixWorld();
    expect(storms.active(ctx)).toBe(false);
    expect(storms.marched).toBe(false);
    expect(storms.count).toBe(0);
    storms.dispose();
  });
});

describe('LightningOverlay.active', () => {
  it('is true until the first render, then true only while a flash is lit; the events match the schedule', () => {
    const cells = [cell()];
    const ctx = makeCtx({ storms: cells });
    const got: SimEvents['lightning'][] = [];
    ctx.events.on('lightning', (e) => got.push(e));
    const overlay = new LightningOverlay(null, () => null);
    overlay.setSize(4, 4);
    const { renderer, draws } = fakeRenderer();
    expect(overlay.active(ctx)).toBe(true);
    let rendered = 0;
    let lit = 0;
    // The pipeline's frame: active(), then render() only when active.
    for (let i = 0; i <= 36_000; i++) {
      ctx.simTime = i / 60;
      if (overlay.active(ctx)) {
        overlay.render(renderer, input, depth, output, ctx);
        rendered++;
      } else {
        expect(overlay.litCount).toBe(0);
        expect(ctx.weatherFx?.flash.energy).toBe(0);
      }
      if ((ctx.weatherFx?.flash.energy ?? 0) > 0) lit++;
    }
    const expected: Strike[] = [];
    const n = strikesBetween(cells, 0, 600, expected);
    expect(n).toBeGreaterThan(20);
    expect(got.map((e) => e.id).sort((a, b) => a - b)).toEqual(expected.slice(0, n).map((s) => s.id).sort((a, b) => a - b));
    expect(lit).toBeGreaterThan(n);
    expect(rendered).toBeLessThan(36_001);
    expect(draws()).toBe(rendered);
  });

  it('is false with no cells after the first render, and true for an injected strike', () => {
    const ctx = makeCtx({ storms: [cell()] });
    const overlay = new LightningOverlay(null, () => null);
    const { renderer } = fakeRenderer();
    ctx.simTime = 1e-3;
    overlay.render(renderer, input, depth, output, ctx);
    ctx.weather = { ...ctx.weather, storms: [] };
    ctx.simTime = 1;
    expect(overlay.active(ctx)).toBe(false);
    ctx.weather = { ...ctx.weather, storms: [cell()] };
    overlay.inject({ id: 1, cell: 0, kind: 'ic', tStart: 1, north: 20_000, east: -5000, heightFrac: 0.5, strokes: 3, energy: 1 });
    expect(overlay.active(ctx)).toBe(true);
    expect(overlay.litCount).toBe(1);
  });
});
