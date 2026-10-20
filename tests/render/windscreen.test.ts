// Water, snow, hail and cracks on the windscreen (render/weather/windscreenWater.ts, WindscreenOverlay.ts): the state
// model, and active() false with nothing to draw (dry glass, no cracks, the chase view), so PostPipeline skips it and
// the frame is the one without it.
// Fake renderer, no WebGL.

import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEventBus, type SimContext } from '../../src/core/context';
import { makeMockEnvironment } from '../../src/core/mockState';
import { defaultWeather, type WeatherSettings } from '../../src/core/types';
import { emptyLocalPrecip, type LocalPrecip } from '../../src/physics/weather/stormPrecip';
import { emptyHailDamage } from '../../src/sim/weather/hailDamage';
import { Atmosphere } from '../../src/render/sky/Atmosphere';
import {
  AIR_SHARE_HI_MS,
  DRY_TAU_FLYING_S,
  DRY_TAU_PARKED_S,
  WindscreenWater,
  type GlassWeather,
} from '../../src/render/weather/windscreenWater';
import { WindscreenOverlay } from '../../src/render/weather/WindscreenOverlay';
import { hailFallSpeed, hailMeanMm } from '../../src/physics/weather/hail';

const report = (label: string, values: Record<string, number | string>) =>
  console.log(`[windscreen] ${label}: ${Object.entries(values).map(([k, v]) => `${k}=${typeof v === 'number' ? +v.toPrecision(4) : v}`).join('  ')}`);

const glass = (o: Partial<GlassWeather> = {}): GlassWeather => ({ type: 'none', rateMmH: 0, hailMmH: 0, hailMaxMm: 0, tasMs: 0, ...o });

function run(w: WindscreenWater, g: GlassWeather, seconds: number, dt = 0.1): void {
  for (let t = 0; t < seconds; t += dt) w.update(g, dt);
}

describe('windscreen water', () => {
  it('wets in rain, then dries with the parked or the flying time constant, not at once', () => {
    const w = new WindscreenWater();
    expect(w.dry).toBe(true);
    run(w, glass({ type: 'rain', rateMmH: 6 }), 30);
    const wet = w.wetness;
    expect(wet).toBeGreaterThan(0.7);
    const parked = new WindscreenWater(), flying = new WindscreenWater();
    parked.wetness = flying.wetness = wet;
    run(parked, glass(), DRY_TAU_FLYING_S);
    run(flying, glass({ tasMs: AIR_SHARE_HI_MS + 20 }), DRY_TAU_FLYING_S);
    report('after one flying time constant out of rain', { start: wet, parked: parked.wetness, flying: flying.wetness });
    expect(flying.wetness).toBeCloseTo(wet / Math.E, 2);
    expect(parked.wetness).toBeCloseTo(wet * Math.exp(-DRY_TAU_FLYING_S / DRY_TAU_PARKED_S), 2);
    run(flying, glass({ tasMs: 60 }), 60);
    expect(flying.wetness).toBe(0);
    expect(flying.dry).toBe(true);
  });

  it('takes snow and loses it faster at speed, counts hail strikes, and moves the drops with the airflow at speed', () => {
    const w = new WindscreenWater();
    run(w, glass({ type: 'snow', rateMmH: 2 }), 20);
    expect(w.snow).toBeGreaterThan(0.6);
    expect(w.wetness).toBe(0);
    const s = w.snow;
    run(w, glass({ tasMs: 50 }), 3);
    expect(w.snow).toBeLessThan(0.2 * s);
    w.update(glass({ hailMmH: 6, hailMaxMm: 30 }), 0.1);
    const parked = w.hailPerM2s;
    w.update(glass({ hailMmH: 6, hailMaxMm: 30, tasMs: 50 }), 0.1);
    report('hail strikes per m^2 s', { parked, at50ms: w.hailPerM2s, airShare: w.airShare, runSpeed: w.runSpeedMs });
    expect(parked).toBeGreaterThan(0);
    expect(w.hailPerM2s).toBeGreaterThan(parked);
    expect(w.airShare).toBe(1);
    expect(w.runSpeedMs).toBeCloseTo(1, 5);
    // The two parts of the strike rate: the fall part alone parked, the airspeed part growing with the TAS.
    expect(Math.hypot(w.hailFallPerM2s, w.hailAirPerM2s) / w.hailPerM2s).toBeCloseTo(1, 9);
    expect(w.hailAirPerM2s / w.hailFallPerM2s).toBeCloseTo(50 / hailFallSpeed(hailMeanMm(30)), 9);
  });

  it('leaves a slush line after parked snow that outlasts the flakes, and blows it off at speed', () => {
    const w = new WindscreenWater();
    run(w, glass({ type: 'snow', rateMmH: 2 }), 60);
    const s0 = w.slush;
    expect(s0).toBeGreaterThan(0.5);
    run(w, glass(), 60);
    report('slush after 60 s of snow and 60 s without, parked', { slushStart: s0, slush: w.slush, snow: w.snow });
    expect(w.snow).toBeLessThan(0.01);
    expect(w.slush).toBeGreaterThan(0.8 * s0);
    expect(w.dry).toBe(false);
    run(w, glass({ tasMs: 50 }), 40);
    expect(w.slush).toBe(0);
    expect(w.dry).toBe(true);
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

describe('WindscreenOverlay active()', () => {
  beforeEach(() => {
    vi.spyOn(Atmosphere, 'for').mockReturnValue({ cloudSky: { directGround: 1 } } as unknown as Atmosphere);
  });
  afterEach(() => vi.restoreAllMocks());

  it('the windscreen: false when dry and without cracks and outside the cockpit, true in rain or with a crack', () => {
    const r = fakeRenderer();
    const o = new WindscreenOverlay();
    const dry = makeCtx();
    expect(o.active(dry)).toBe(true);
    o.render(r, input, depth, output, dry, 0.016);
    expect(o.active(dry)).toBe(false);
    const rain = makeCtx({}, { ...emptyLocalPrecip(), type: 'rain', rateMmH: 6 });
    rain.simTime = 1;
    expect(o.active(rain)).toBe(true);
    rain.cameraMode = 'chase';
    expect(o.active(rain)).toBe(false);
    const cracked = makeCtx();
    cracked.weatherFx!.damage!.crackCount = 1;
    cracked.weatherFx!.damage!.windscreen = 0.1;
    const o2 = new WindscreenOverlay();
    o2.render(r, input, depth, output, makeCtx(), 0.016);
    expect(o2.active(makeCtx())).toBe(false);
    expect(o2.active(cracked)).toBe(true);
    o.dispose();
    o2.dispose();
  });
});
