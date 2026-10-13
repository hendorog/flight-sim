// Fauna budgets (Deep Time WP5): CPU per frame for 500 animals and 24 flyers, no buffer reallocation, the
// 200-terrain-reads-per-frame cap, and a long soak without NaN. Runs the real FaunaSystem (three.js objects in
// node, no renderer).

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createEventBus, type QualityLevel, type SimContext } from '../../src/core/context';
import { defaultWeather } from '../../src/core/types';
import { createWorldEnvironment } from '../../src/sim/worldEnvironment';
import type { SimEnvironment } from '../../src/physics/environment';
import { eraById } from '../../src/world/era/registry';
import { createFaunaSystem, FaunaSystemImpl } from '../../src/world/fauna/FaunaSystem';
import { countingTerrain, type FaunaTerrain } from '../../src/world/fauna/habitat';
import { FLYER_MODE } from '../../src/world/fauna/flight';
import { FAUNA_PRESETS, TERRAIN_CALLS_PER_FRAME } from '../../src/world/fauna/presets';
import { ROSTERS } from '../../src/world/fauna/roster';
import { makeThermalCore } from '../../src/physics/weather/thermals';
import { FAUNA_STRIDE } from '../../src/world/fauna/types';

const DT = 1 / 60;

/** Counting terrain whose `total` the system never resets (an independent spy on its reads). */
function spyTerrain(): FaunaTerrain & { total: number } {
  const real = countingTerrain();
  const t = {
    calls: 0,
    total: 0,
    sample(n: number, e: number, out: Parameters<FaunaTerrain['sample']>[2]) {
      t.calls++;
      t.total++;
      return real.sample(n, e, out);
    },
    height(n: number, e: number) {
      t.calls++;
      t.total++;
      return real.height(n, e);
    },
  };
  return t;
}

function makeCtx(quality: QualityLevel = 'high') {
  const weather = { ...defaultWeather(), timeOfDay: 12, cloudCover: 0.35, windSpeedKt: 6 };
  const env = createWorldEnvironment(weather);
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 400000);
  const state = {
    position: { x: 0, y: 0, z: -400 },
    velocity: { x: 0, y: 50, z: 0 },
    tas: 50,
    altitudeAGL: 250,
  };
  const ctx = {
    scene: new THREE.Scene(),
    camera,
    state,
    weather,
    env,
    sky: { dayFactor: 1 },
    simTime: 0,
    quality,
    events: createEventBus(),
  };
  return ctx as unknown as SimContext & { state: typeof state; simTime: number };
}

/** Put camera and aircraft at (n, e, alt), looking along +east. */
function place(ctx: ReturnType<typeof makeCtx>, n: number, e: number, alt: number, hdg: number): void {
  ctx.state.position.x = n;
  ctx.state.position.y = e;
  ctx.state.position.z = -alt;
  ctx.state.velocity.x = 50 * Math.cos(hdg);
  ctx.state.velocity.y = 50 * Math.sin(hdg);
  ctx.camera.position.set(e, alt, -n);
  ctx.camera.lookAt(e + 1000 * Math.sin(hdg), alt - 150, -(n + 1000 * Math.cos(hdg)));
  ctx.camera.updateMatrixWorld();
}

function build(quality: QualityLevel = 'high') {
  const terrain = spyTerrain();
  const sys = createFaunaSystem(eraById('cretaceous'), { terrain }) as FaunaSystemImpl;
  const ctx = makeCtx(quality);
  sys.init(ctx);
  return { sys, ctx, terrain };
}

/** Grow the population to ~500 animals and 24 flyers around the river herd. */
function populate(sys: FaunaSystemImpl, ctx: ReturnType<typeof makeCtx>): void {
  const H = sys.herds;
  const h0 = sys.riverHerd;
  const n0 = H.cN[h0];
  const e0 = H.cE[h0];
  // Stream for a while around the herd (cells probed, herds spawned, ambient kettles).
  for (let k = 0; k < 60 * 30; k++) {
    ctx.simTime += DT;
    place(ctx, n0 - 600, e0 - 600 + 30 * Math.sin(k / 200), 300, Math.PI / 4);
    sys.update(DT, ctx);
  }
  // Top up to ~500 animals with copies of the showcase herd along the river.
  let k = 0;
  while (H.members() < 600 && k < 40) {
    const off = 400 * (k + 1) * (k % 2 ? 1 : -1);
    const want = Math.min(80, 600 - H.members());
    H.spawn({ north: n0 + off * Math.cos(1.22), east: e0 + off * Math.sin(1.22), ground: H.cH[h0], size: want, entry: 0, scale: 1, variant: 0, seed: 77 + k, heading: 0, pinned: true }, -1);
    k++;
  }
  // And to 24 flyers on a core near the herd.
  const F = sys.flyers;
  const frame = (ctx.env as unknown as SimEnvironment).windField.thermalFrame();
  const core = makeThermalCore();
  let b = 0;
  while (F.count() < 24 && b < 64) {
    const i = F.spawn({ north: n0, east: e0, alt: H.cH[h0] + 400, ground: H.cH[h0], entry: 2, scale: 0.43, size: 0.43, variant: 1, seed: 900 + b, mode: FLYER_MODE.glide, heading: 0, anchorN: n0, anchorE: e0 });
    if (i >= 0 && F.nearestCore(frame, ctx.simTime, n0 + 300 * b, e0, core)) F.startKettle(i, core, frame, sys.terrain);
    b++;
  }
}

describe('fauna budget', () => {
  it('500 animals and 24 flyers update in <= 0.4 ms mean, with <= 200 terrain reads per frame', () => {
    const { sys, ctx, terrain } = build('high');
    populate(sys, ctx);
    expect(sys.herds.members()).toBeGreaterThanOrEqual(500);
    expect(sys.flyers.count()).toBeGreaterThanOrEqual(24);
    const H = sys.herds;
    const n0 = H.cN[sys.riverHerd];
    const e0 = H.cE[sys.riverHerd];
    // Warm the JIT, then measure 2000 frames with the aircraft weaving low over the herds (brains, flee, snaps).
    // Batch means of 200 frames: the best batch is the budget figure, so a load spike from other test files
    // running in parallel cannot fail it, while a real regression (every batch slow) still does.
    const batches: number[] = [];
    let batch = 0;
    let maxReads = 0;
    let visible = 0;
    // (Ten batches since inc 2 added the showcase animals: more chances of an unloaded window in the full suite.)
    for (let k = 0; k < 2200; k++) {
      ctx.simTime += DT;
      const a = k / 300;
      place(ctx, n0 - 800 + 1600 * Math.sin(a), e0 - 800 + 400 * Math.cos(a * 1.3), H.cH[sys.riverHerd] + 120, 1.0 + 0.3 * Math.sin(a));
      const before = terrain.total;
      const t0 = performance.now();
      sys.update(DT, ctx);
      const ms = performance.now() - t0;
      const reads = terrain.total - before;
      maxReads = Math.max(maxReads, reads);
      expect(sys.stats.terrainCalls).toBe(reads);
      if (k >= 200) {
        batch += ms;
        visible += sys.stats.visible;
        if ((k - 199) % 200 === 0) {
          batches.push(batch / 200);
          batch = 0;
        }
      }
    }
    const mean = Math.min(...batches);
    console.log(`fauna update best batch mean ${mean.toFixed(3)} ms (batches ${batches.map((b) => b.toFixed(3)).join(', ')}), max terrain reads ${maxReads}, mean visible ${(visible / 2000).toFixed(0)}, animals ${H.members()}, flyers ${sys.flyers.count()}`);
    expect(H.members()).toBeGreaterThanOrEqual(500);
    expect(maxReads).toBeLessThanOrEqual(TERRAIN_CALLS_PER_FRAME);
    expect(visible / 2000).toBeGreaterThan(100);
    expect(mean).toBeLessThanOrEqual(0.4);
  });

  it('never reallocates its buffers (quality changes only change counts)', () => {
    const { sys, ctx } = build('ultra');
    const draws = (sys as unknown as { draws: { lod: { array: Float32Array; buffer: unknown }[]; caster: { array: Float32Array; buffer: unknown } }[] }).draws;
    const before = draws.flatMap((d) => [...d.lod, d.caster].map((x) => [x.array, x.buffer]));
    const meshes = sys.root.children.length;
    for (const q of ['low', 'medium', 'high', 'ultra', 'low', 'high'] as QualityLevel[]) {
      ctx.events.emit('qualityChanged', { quality: q });
      for (let k = 0; k < 30; k++) {
        ctx.simTime += DT;
        place(ctx, 0, 0, 300, 1.2);
        sys.update(DT, ctx);
      }
      expect(sys.flyers.count()).toBeLessThanOrEqual(FAUNA_PRESETS[q].flyers);
    }
    const after = draws.flatMap((d) => [...d.lod, d.caster].map((x) => [x.array, x.buffer]));
    expect(after.length).toBe(before.length);
    after.forEach((p, k) => {
      expect(p[0]).toBe(before[k][0]);
      expect(p[1]).toBe(before[k][1]);
    });
    expect(sys.root.children.length).toBe(meshes);
    expect(sys.stats.reallocs).toBe(0);
    // Every roster species (7 in inc 2) x (3 LODs + 1 caster).
    expect(meshes).toBe(new Set(ROSTERS.cretaceous.entries.map((e) => e.species)).size * 4);
    expect(meshes).toBe(28);
  });

  it('soaks 10k frames without NaN, whatever dt it is given', () => {
    const { sys, ctx } = build('high');
    const H = sys.herds;
    const n0 = H.cN[sys.riverHerd];
    const e0 = H.cE[sys.riverHerd];
    const dts = [DT, DT, 0, 0.05, 1, NaN, DT, -1, 1e9, DT];
    for (let k = 0; k < 10000; k++) {
      const dt = dts[k % dts.length];
      if (Number.isFinite(dt) && dt > 0) ctx.simTime += Math.min(dt, 0.1);
      const a = k / 400;
      place(ctx, n0 + 2000 * Math.sin(a), e0 + 2000 * Math.cos(a * 0.7), H.cH[sys.riverHerd] + 40 + 200 * (1 + Math.sin(a * 3)), a);
      sys.update(dt, ctx);
    }
    expect(sys.debug.errors).toBe(0);
    for (let i = 0; i < H.capacity * H.memberCap; i++) {
      expect(Number.isFinite(H.mN[i]) && Number.isFinite(H.mE[i]) && Number.isFinite(H.mH[i])).toBe(true);
    }
    const F = sys.flyers;
    for (let i = 0; i < F.capacity; i++) {
      if (F.active[i]) expect(Number.isFinite(F.n[i]) && Number.isFinite(F.e[i]) && Number.isFinite(F.alt[i])).toBe(true);
    }
    const draws = (sys as unknown as { draws: { lod: { array: Float32Array; count: number }[] }[] }).draws;
    for (const d of draws) for (const l of d.lod) for (let j = 0; j < l.count * FAUNA_STRIDE; j++) expect(Number.isFinite(l.array[j])).toBe(true);
  });

  it('the present day builds no fauna system', () => {
    expect(createFaunaSystem(eraById('present'))).toBeNull();
  });

  it('emits faunaSighted once per species while the approach distance holds', () => {
    const { sys, ctx } = build('high');
    const seen: string[] = [];
    ctx.events.on('faunaSighted', (e) => seen.push(e.species));
    const H = sys.herds;
    const n0 = H.cN[sys.riverHerd];
    const e0 = H.cE[sys.riverHerd];
    for (let k = 0; k < 600; k++) {
      ctx.simTime += DT;
      place(ctx, n0 - 200, e0, H.cH[sys.riverHerd] + 150, 0);
      sys.update(DT, ctx);
    }
    expect(seen.filter((s) => s === 'edmontosaurus')).toHaveLength(1);
  });

  it('emits faunaSighted again on a closer approach, so the guide keeps the closest distance', () => {
    const { sys, ctx } = build('high');
    const dists: number[] = [];
    ctx.events.on('faunaSighted', (e) => {
      if (e.species === 'edmontosaurus') dists.push(e.distanceM);
    });
    const H = sys.herds;
    const h = sys.riverHerd;
    const fly = (back: number, frames: number) => {
      for (let k = 0; k < frames; k++) {
        ctx.simTime += DT;
        place(ctx, H.cN[h] - H.radius[h] - back, H.cE[h], H.cH[h] + 150, 0);
        sys.update(DT, ctx);
      }
    };
    fly(450, 60);
    const first = dists.length;
    expect(first).toBeGreaterThanOrEqual(1);
    fly(40, 60);
    expect(dists.length).toBeGreaterThan(first);
    expect(Math.min(...dists)).toBeLessThan(200);
    // Each repeat is at least 25 m closer than the last, so the emits are bounded (<= 500 / 25 per species).
    for (let k = 1; k < dists.length; k++) expect(dists[k]).toBeLessThanOrEqual(dists[k - 1] - 24);
  });

  it('starting at low quality trims the showcase flyers to the preset', () => {
    const { sys } = build('low');
    expect(sys.flyers.count()).toBeLessThanOrEqual(FAUNA_PRESETS.low.flyers);
    expect(sys.flyers.count()).toBeGreaterThan(0);
  });

  it('a night start roosts the showcase kettles, and they relaunch at dawn', () => {
    const terrain = spyTerrain();
    const sys = createFaunaSystem(eraById('cretaceous'), { terrain }) as FaunaSystemImpl;
    const ctx = makeCtx('high');
    (ctx.sky as { dayFactor: number }).dayFactor = 0;
    sys.init(ctx);
    const F = sys.flyers;
    const roosting: number[] = [];
    for (let i = 0; i < F.capacity; i++) if (F.active[i] && F.mode[i] === FLYER_MODE.roost) roosting.push(i);
    expect(roosting.length).toBeGreaterThanOrEqual(8);
    (ctx.sky as { dayFactor: number }).dayFactor = 1;
    // Far from the birds (no launch from the aircraft), long enough for the 30 s roost hold.
    for (let k = 0; k < 60 * 40; k++) {
      ctx.simTime += DT;
      place(ctx, 30000, 30000, 2000, 0);
      sys.update(DT, ctx);
    }
    for (const i of roosting) expect(F.mode[i]).not.toBe(FLYER_MODE.roost);
  });

  it('a scattered herd is still drawn when its centroid is out of view', () => {
    const { sys, ctx } = build('high');
    const H = sys.herds;
    const h = sys.riverHerd;
    const base = h * H.memberCap;
    // Every member 700 m east of the (unchanged) centroid, as after a long flight.
    for (let k = 0; k < H.size[h]; k++) {
      H.mE[base + k] = H.cE[h] + 700 + (k % 8) * 4;
      H.mN[base + k] = H.cN[h] + Math.floor(k / 8) * 4;
      H.mH[base + k] = H.cH[h];
    }
    // Looking north at the members, 200 m short of them: the centroid is ~74 deg off the view axis.
    place(ctx, H.cN[h] - 200, H.cE[h] + 712, H.cH[h] + 50, 0);
    sys.update(0, ctx);
    const draws = (sys as unknown as { draws: { species: string; lod: { count: number }[] }[] }).draws;
    const herd = draws.find((d) => d.species === 'edmontosaurus')!;
    expect(herd.lod.reduce((a, l) => a + l.count, 0)).toBe(H.size[h]);
  });
});
