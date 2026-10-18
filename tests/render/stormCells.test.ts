// The storm-cell render (render/weather): the march's step count stays within its cap, the cell geometry follows the
// cell (motion, clamps, anvil downwind) and its bounding cylinder holds the density's support, and the lightning
// channel runs from BOLT_TOP_ABOVE_BASE_M above the base to the ground point, the same for the same strike id, with
// BRANCH_MIN..BOLT_MAX_BRANCHES branches rooted on it under the base; the cells' optical depth seen by the channel
// (stormTau) is that of the cloud above the base and of the rain below it. The lightning overlay emits one 'lightning' event per scheduled strike, publishes the flash, and copies its input when
// no flash is lit.

import { describe, expect, it } from 'vitest';
import { defaultWeather, type StormCell } from '../../src/core/types';
import { KT } from '../../src/core/math';
import {
  BOLT_MAX_BRANCHES,
  BOLT_POINTS,
  BOLT_ROUGHNESS,
  BOLT_SEGMENTS,
  BOLT_TOP_ABOVE_BASE_M,
  BRANCH_LEN_MAX,
  BRANCH_MIN,
  BRANCH_POINTS,
  BRANCH_SEGMENTS,
  boltBranches,
  boltPath,
} from '../../src/render/weather/boltGeometry';
import { ANVIL_PER_RADIUS, SHAFT_PER_RADIUS, cellGeometry, makeCellGeometry } from '../../src/render/weather/StormCellEffect';
import { STORM_MARCH_FRAG, STORM_STEPS } from '../../src/render/weather/stormGlsl';
import * as THREE from 'three';
import { createEventBus, type SimContext, type SimEvents } from '../../src/core/context';
import { makeMockEnvironment } from '../../src/core/mockState';
import { LightningOverlay, MAX_WINDOW_S, stormTau } from '../../src/render/weather/LightningOverlay';
import { strikesBetween, type Strike } from '../../src/sim/weather/lightning';

const cell = (o: Partial<StormCell> = {}): StormCell => ({
  northM: 20_000,
  eastM: -5_000,
  radiusM: 3000,
  topM: 11_000,
  intensity: 0.8,
  motionDeg: 270,
  motionKt: 15,
  ...o,
});

describe('storm march', () => {
  it('takes at most 56 steps', () => {
    expect(STORM_STEPS).toBeLessThanOrEqual(56);
    expect(STORM_MARCH_FRAG).toContain(`i < ${STORM_STEPS}; i++`);
  });
});

describe('cellGeometry', () => {
  const w = { ...defaultWeather(), windDirectionDeg: 270, windSpeedKt: 30 };

  it('maps NED to three.js and moves the centre with the cell', () => {
    const g = cellGeometry(cell(), w, 0, makeCellGeometry());
    expect(g.x).toBe(-5000);
    expect(g.z).toBe(-20_000);
    // From 270 deg at 15 kt: toward the east.
    const h = cellGeometry(cell(), w, 3600, makeCellGeometry());
    expect(h.x - g.x).toBeCloseTo(15 * KT * 3600, 6);
    expect(h.z).toBeCloseTo(g.z, 6);
  });

  it('sets the base from the weather, the anvil and shaft radii from the core, and clamps', () => {
    const g = cellGeometry(cell(), w, 0, makeCellGeometry());
    expect(g.base).toBe(w.cloudBaseM);
    expect(g.anvilRadius).toBe(ANVIL_PER_RADIUS * 3000);
    expect(g.shaftRadius).toBe(SHAFT_PER_RADIUS * 3000);
    const c = cellGeometry(cell({ radiusM: 50, intensity: 7, topM: 100 }), w, 0, makeCellGeometry());
    expect(c.radius).toBe(500);
    expect(c.intensity).toBe(1);
    expect(c.top).toBeGreaterThanOrEqual(c.base + 2000);
  });

  it('moves the anvil downwind (wind from 270: toward the east) by half its radius in a strong wind', () => {
    const g = cellGeometry(cell(), w, 0, makeCellGeometry());
    expect(g.anvilX - g.x).toBeCloseTo(0.5 * g.anvilRadius, 6);
    expect(g.anvilZ - g.z).toBeCloseTo(0, 6);
    const calm = cellGeometry(cell(), { ...w, windSpeedKt: 0 }, 0, makeCellGeometry());
    expect(calm.anvilX).toBe(calm.x);
  });

  it('bounds the core footprint and the anvil with its cylinder', () => {
    const g = cellGeometry(cell(), w, 0, makeCellGeometry());
    const toCore = Math.hypot(g.x - g.boundX, g.z - g.boundZ);
    const toAnvil = Math.hypot(g.anvilX - g.boundX, g.anvilZ - g.boundZ);
    // The density's support (stormGlsl cellDensity): the core's flare (1.6 R) plus its billow (0.35 R), the anvil's
    // radius plus its billow (0.225 of it).
    expect(toCore + 1.95 * g.radius).toBeLessThanOrEqual(g.boundRadius);
    expect(toAnvil + 1.225 * g.anvilRadius).toBeLessThanOrEqual(g.boundRadius);
  });
});

describe('boltPath', () => {
  const base = 1500;
  const ground = 120;
  const top = { x: 300, y: base + BOLT_TOP_ABOVE_BASE_M, z: -9000 };
  const bottom = { x: 300, y: ground, z: -9000 };

  it('moves each midpoint at most BOLT_ROUGHNESS of its segment sideways and a fifth of that vertically', () => {
    expect(BOLT_SEGMENTS).toBeLessThanOrEqual(32);
    for (const id of [1, 42, 999, 123456]) {
      const p = boltPath(id, top, bottom, new Float32Array(3 * BOLT_POINTS));
      expect(p[1]).toBe(Math.fround(base + 3000));
      expect(p[3 * BOLT_SEGMENTS + 1]).toBe(Math.fround(ground));
      let moved = 0;
      for (let stride = BOLT_SEGMENTS; stride >= 2; stride >>= 1) {
        for (let a = 0; a < BOLT_SEGMENTS; a += stride) {
          const b = a + stride;
          const m = a + stride / 2;
          const len = Math.hypot(p[3 * b] - p[3 * a], p[3 * b + 1] - p[3 * a + 1], p[3 * b + 2] - p[3 * a + 2]);
          const side = Math.hypot(p[3 * m] - 0.5 * (p[3 * a] + p[3 * b]), p[3 * m + 2] - 0.5 * (p[3 * a + 2] + p[3 * b + 2]));
          const up = Math.abs(p[3 * m + 1] - 0.5 * (p[3 * a + 1] + p[3 * b + 1]));
          expect(side).toBeLessThanOrEqual(BOLT_ROUGHNESS * len * (1 + 1e-5) + 1e-2);
          expect(up).toBeLessThanOrEqual(0.2 * BOLT_ROUGHNESS * len * (1 + 1e-5) + 1e-2);
          if (side > 1) moved++;
        }
      }
      expect(moved).toBeGreaterThan(BOLT_SEGMENTS / 2);
    }
  });

  it('is the same for the same id and differs between ids', () => {
    const a = boltPath(42, top, bottom, new Float32Array(3 * BOLT_POINTS));
    const b = boltPath(42, top, bottom, new Float32Array(3 * BOLT_POINTS));
    const c = boltPath(43, top, bottom, new Float32Array(3 * BOLT_POINTS));
    expect(Array.from(b)).toEqual(Array.from(a));
    expect(Array.from(c)).not.toEqual(Array.from(a));
  });

  it('stays within a fraction of the channel length of the straight line', () => {
    const p = boltPath(7, top, bottom, new Float32Array(3 * BOLT_POINTS));
    const len = top.y - bottom.y;
    for (let i = 0; i < BOLT_POINTS; i++) {
      expect(Math.hypot(p[3 * i] - top.x, p[3 * i + 2] - top.z)).toBeLessThan(0.5 * len);
      expect(p[3 * i + 1]).toBeGreaterThan(bottom.y - 0.2 * len);
      expect(p[3 * i + 1]).toBeLessThan(top.y + 0.2 * len);
    }
  });
});

describe('boltBranches', () => {
  const base = 1500;
  const ground = 120;
  const top = { x: 300, y: base + BOLT_TOP_ABOVE_BASE_M, z: -9000 };
  const bottom = { x: 300, y: ground, z: -9000 };

  it('roots BRANCH_MIN..BOLT_MAX_BRANCHES branches on the channel under the base, ending above the ground', () => {
    const counts = new Set<number>();
    for (let id = 0; id < 200; id++) {
      const p = boltPath(id, top, bottom, new Float32Array(3 * BOLT_POINTS));
      const b = new Float32Array(3 * BOLT_MAX_BRANCHES * BRANCH_POINTS);
      const n = boltBranches(id, p, base, b);
      expect(n).toBeGreaterThanOrEqual(BRANCH_MIN);
      expect(n).toBeLessThanOrEqual(BOLT_MAX_BRANCHES);
      counts.add(n);
      for (let k = 0; k < n; k++) {
        const r = 3 * k * BRANCH_POINTS;
        const e = 3 * (k * BRANCH_POINTS + BRANCH_SEGMENTS);
        let onPath = false;
        for (let i = 1; i < BOLT_SEGMENTS; i++) if (p[3 * i] === b[r] && p[3 * i + 1] === b[r + 1] && p[3 * i + 2] === b[r + 2]) onPath = true;
        expect(onPath).toBe(true);
        expect(b[r + 1]).toBeLessThanOrEqual(base);
        expect(b[e + 1]).toBeLessThan(b[r + 1]);
        expect(b[e + 1]).toBeGreaterThan(ground);
        expect(Math.hypot(b[e] - b[r], b[e + 1] - b[r + 1], b[e + 2] - b[r + 2])).toBeLessThanOrEqual(BRANCH_LEN_MAX * (base - ground) * (1 + 1e-5));
      }
    }
    expect(counts.size).toBe(BOLT_MAX_BRANCHES - BRANCH_MIN + 1);
  });

  it('is the same for the same id, and has none when no channel point is under the given height', () => {
    const p = boltPath(42, top, bottom, new Float32Array(3 * BOLT_POINTS));
    const a = new Float32Array(3 * BOLT_MAX_BRANCHES * BRANCH_POINTS);
    const b = new Float32Array(3 * BOLT_MAX_BRANCHES * BRANCH_POINTS);
    expect(boltBranches(42, p, base, b)).toBe(boltBranches(42, p, base, a));
    expect(Array.from(b)).toEqual(Array.from(a));
    expect(boltBranches(42, p, ground - 10, a)).toBe(0);
  });
});

describe('stormTau', () => {
  const g = cellGeometry(cell({ motionKt: 0 }), defaultWeather(), 0, makeCellGeometry());
  const camera = new THREE.Vector3(g.x, 300, g.z + 15_000);
  const tau = { cloud: 0, rain: 0 };

  it('is zero without cells and outside them', () => {
    stormTau([g], 0, camera, g.x, 500, g.z, tau);
    expect(tau).toEqual({ cloud: 0, rain: 0 });
    stormTau([g], 1, camera, g.x + 3000, 500, g.z + 15_000, tau);
    expect(tau).toEqual({ cloud: 0, rain: 0 });
  });

  it('is rain only under the base and opaque cloud a few hundred metres inside the core', () => {
    stormTau([g], 1, camera, g.x, g.base - 300, g.z, tau);
    expect(tau.cloud).toBe(0);
    expect(tau.rain).toBeGreaterThan(0.5);
    stormTau([g], 1, camera, g.x, g.base + 300, g.z, tau);
    expect(tau.cloud).toBeGreaterThan(10);
  });

  it('gives the same depth with a second cell whose bound the ray misses', () => {
    const far = cellGeometry(cell({ motionKt: 0, northM: -60_000 }), defaultWeather(), 0, makeCellGeometry());
    stormTau([g], 1, camera, g.x, g.base - 300, g.z, tau);
    const one = { ...tau };
    stormTau([far, g], 2, camera, g.x, g.base - 300, g.z, tau);
    expect(tau).toEqual(one);
  });
});

/** The part of a WebGLRenderer the full-screen passes use: counts the draws. */
function fakeRenderer(): { renderer: THREE.WebGLRenderer; draws: () => number } {
  let draws = 0;
  const r = { setRenderTarget: () => undefined, getRenderTarget: () => null, render: () => void draws++ };
  return { renderer: r as unknown as THREE.WebGLRenderer, draws: () => draws };
}

describe('LightningOverlay', () => {
  const cells = [cell({ intensity: 1 })];
  const makeCtx = () => {
    const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 400_000);
    camera.updateMatrixWorld();
    return {
      weather: { ...defaultWeather(), storms: cells },
      simTime: 0,
      camera,
      cameraMode: 'chase',
      env: makeMockEnvironment(),
      events: createEventBus(),
      sky: { skyColor: new THREE.Color(300, 400, 600), sunColor: new THREE.Color(1, 1, 1), sunDir: new THREE.Vector3(0, 1, 0), hazeExtinction: 1e-4 },
      weatherFx: { flash: { x: 0, y: 0, z: 0, energy: 0 } },
    } as unknown as SimContext;
  };
  const target = () => new THREE.WebGLRenderTarget(4, 4);

  it('emits one event per scheduled strike over 10 minutes of frames, and lights the flash', () => {
    const ctx = makeCtx();
    const got: SimEvents['lightning'][] = [];
    ctx.events.on('lightning', (e) => got.push(e));
    const overlay = new LightningOverlay(null, () => null);
    overlay.setSize(4, 4);
    const { renderer, draws } = fakeRenderer();
    let lit = 0;
    for (let i = 1; i <= 36_000; i++) {
      ctx.simTime = i / 60;
      overlay.render(renderer, new THREE.Texture(), new THREE.DepthTexture(4, 4), target(), ctx);
      if ((ctx.weatherFx?.flash.energy ?? 0) > 0) lit++;
    }
    const expected: Strike[] = [];
    const n = strikesBetween(cells, 0, 600, expected);
    expect(got.map((e) => e.id).sort((a, b) => a - b)).toEqual(expected.slice(0, n).map((s) => s.id).sort((a, b) => a - b));
    expect(n).toBeGreaterThan(20);
    expect(lit).toBeGreaterThan(n);
    // One draw per frame (the copy, or the lightning material on the first frame and while a flash is lit).
    expect(draws()).toBe(36_000);
    // With the cells gone, every lit flash ends and none starts.
    ctx.weather = { ...ctx.weather, storms: [] };
    ctx.simTime = 600 + MAX_WINDOW_S * 0.9;
    overlay.render(renderer, new THREE.Texture(), new THREE.DepthTexture(4, 4), target(), ctx);
    expect(overlay.litCount).toBe(0);
    expect(ctx.weatherFx?.flash.energy).toBe(0);
    for (const e of got) {
      if (e.kind === 'cg') expect(e.altM).toBe(Math.min(11_000, defaultWeather().cloudBaseM + BOLT_TOP_ABOVE_BASE_M));
    }
  });

  it('emits nothing while the clock stands still, and drops the lit flashes when it goes back', () => {
    const ctx = makeCtx();
    const got: number[] = [];
    ctx.events.on('lightning', (e) => got.push(e.id));
    const overlay = new LightningOverlay(null, () => null);
    ctx.simTime = 100;
    overlay.advance(ctx);
    for (let i = 0; i < 100; i++) overlay.advance(ctx);
    expect(got).toHaveLength(0);
    overlay.inject({ id: 1, cell: 0, kind: 'cg', tStart: 100, north: 20_000, east: -5000, heightFrac: 0.05, strokes: 3, energy: 1 });
    overlay.advance(ctx);
    expect(got).toEqual([1]);
    expect(overlay.litCount).toBe(1);
    ctx.simTime = 0;
    overlay.advance(ctx);
    expect(overlay.litCount).toBe(0);
  });
});
