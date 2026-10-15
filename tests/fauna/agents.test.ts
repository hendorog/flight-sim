// Solo agents (Deep Time inc 2, WP0b): the SoloAgentPool moves 4 agents for 600 frames without allocating, within
// AGENT_RESERVE terrain reads per frame, and FaunaSystem draws them (the showcase T. rex at its lair).

import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEventBus, type SimContext } from '../../src/core/context';
import { defaultWeather } from '../../src/core/types';
import { createWorldEnvironment } from '../../src/sim/worldEnvironment';
import * as Anchors from '../../src/world/era/cretaceousAnchors';
import { eraById } from '../../src/world/era/registry';
import { AGENT_MEM, SoloAgentPool, type SoloBrain } from '../../src/world/fauna/agents';
import { BRAINS, WANDER_BRAIN, brainFor } from '../../src/world/fauna/brains';
import { createFaunaSystem, type FaunaSystemImpl } from '../../src/world/fauna/FaunaSystem';
import { countingTerrain, type FaunaTerrain } from '../../src/world/fauna/habitat';
import { HerdPool, type AircraftView } from '../../src/world/fauna/herds';
import { AGENT_RESERVE, MAX_AGENTS } from '../../src/world/fauna/presets';
import { THREAT } from '../../src/world/fauna/reactions';
import { TYRANNOSAURUS_BRAIN } from '../../src/world/fauna/species/tyrannosaurus.brain';
import { setEra } from '../../src/world/era/eraState';

// The Cretaceous world (terrain with the volcano, environment, flora): createFaunaSystem's era only picks the roster.
beforeAll(() => {
  setEra('cretaceous');
});
afterAll(() => {
  setEra('present');
});

const DT = 1 / 60;

const proc = (globalThis as unknown as { process: { memoryUsage(): { heapUsed: number } } }).process;

/**
 * Heap bytes allocated per call of fn: the median over 7 runs of 2000 calls of the heapUsed growth (a run that
 * spans a GC comes out negative and the median ignores it). 0 within noise for allocation-free code; one boxed
 * number (16 B) or one Math.hypot (~64 B) per call shows.
 */
function bytesPerCall(fn: () => void): number {
  for (let k = 0; k < 20000; k++) fn();
  const runs: number[] = [];
  for (let r = 0; r < 7; r++) {
    const a = proc.memoryUsage().heapUsed;
    for (let k = 0; k < 2000; k++) fn();
    runs.push((proc.memoryUsage().heapUsed - a) / 2000);
  }
  runs.sort((x, y) => x - y);
  return runs[3];
}

/** A brain that reads the terrain greedily (to prove the reserve) and drives a herd threat. */
const GREEDY: SoloBrain = {
  init(pool, i) {
    pool.setState(i, 0);
  },
  step(pool, i, ctx) {
    while (ctx.terrainLeft() > 2) ctx.terrain.height(pool.n[i], pool.e[i]);
    pool.wantSpeed[i] = 6;
    pool.wantYaw[i] += 0.3 * ctx.dt;
    pool.flap[i] = 0.5 + 0.5 * Math.sin(ctx.time);
    pool.mem[i * AGENT_MEM] += ctx.dt;
    if (ctx.riverHerd >= 0 && pool.state[i] === 0 && ctx.time > 1) {
      ctx.herds.setExternalThreat(ctx.riverHerd, pool.n[i], pool.e[i], 0, 0, ctx.time + 5, THREAT.alert);
      pool.setState(i, 1);
    }
  },
};

function pool4(brain: SoloBrain): { pool: SoloAgentPool; terrain: FaunaTerrain; herds: HerdPool } {
  const terrain = countingTerrain();
  const herds = new HerdPool();
  const pool = new SoloAgentPool(herds, terrain, Anchors);
  const L = Anchors.TREX_LAIR;
  for (let k = 0; k < MAX_AGENTS; k++) {
    expect(pool.spawn({ species: 'tyrannosaurus', entry: 0, north: L.north + 40 * k, east: L.east, ground: L.ground, heading: k, scale: 1, variant: 0, seed: 100 + k }, brain)).toBe(k);
  }
  expect(pool.spawn({ species: 'tyrannosaurus', entry: 0, north: 0, east: 0, ground: 0, heading: 0, scale: 1, variant: 0, seed: 9 }, brain)).toBe(-1);
  return { pool, terrain, herds };
}

describe('solo agents', () => {
  it('registers the T. rex brain and a wander fallback', () => {
    expect(BRAINS.tyrannosaurus).toBe(TYRANNOSAURUS_BRAIN);
    expect(brainFor('tyrannosaurus')).toBe(TYRANNOSAURUS_BRAIN);
    expect(brainFor('triceratops')).toBe(WANDER_BRAIN);
  });

  it('4 agents over 600 frames: terrain reads <= AGENT_RESERVE per frame, moving on the ground, finite', () => {
    const { pool, terrain } = pool4(GREEDY);
    const ac: AircraftView = { n: 0, e: 0, alt: 500, vN: 0, vE: 50, vD: 0, tas: 50 };
    let maxReads = 0;
    for (let k = 0; k < 600; k++) {
      terrain.calls = 0;
      const used = pool.step(DT, ac, terrain, -1);
      maxReads = Math.max(maxReads, used, terrain.calls);
    }
    expect(maxReads).toBeLessThanOrEqual(AGENT_RESERVE);
    expect(AGENT_RESERVE).toBe(12);
    for (let i = 0; i < MAX_AGENTS; i++) {
      expect(Math.hypot(pool.n[i] - pool.homeN[i], pool.e[i] - pool.homeE[i])).toBeGreaterThan(20);
      expect(pool.speed[i]).toBeGreaterThan(5);
      // Walk-to-run gait from the speed (6 m/s: past the theropod's runFrom).
      expect(pool.blend[i]).toBeGreaterThan(1.3);
      expect(Math.abs(pool.h[i] - terrain.height(pool.n[i], pool.e[i]))).toBeLessThan(1.5);
      expect(pool.mem[i * AGENT_MEM]).toBeCloseTo(10, 3);
    }
  });

  it('steps 4 agents without allocating (the stub brain and the pool)', () => {
    const { pool, terrain } = pool4(TYRANNOSAURUS_BRAIN);
    const ac: AircraftView = { n: Anchors.TREX_LAIR.north, e: Anchors.TREX_LAIR.east + 200, alt: 300, vN: 0, vE: 50, vD: 0, tas: 50 };
    // A terrain without allocation of its own (the real terrainHeight allocates internally).
    const flat = { calls: 0, sample: terrain.sample, height: () => (flat.calls++, 150) } as FaunaTerrain;
    const bytes = bytesPerCall(() => {
      flat.calls = 0;
      pool.step(DT, ac, flat, -1);
    });
    expect(bytes).toBeLessThan(8);
  });

  it('an agent brain can set an external threat on the herds (on the herds clock)', () => {
    const { pool, terrain, herds } = pool4(GREEDY);
    const L = Anchors.RIVER_HERD_SITE;
    const h = herds.spawn({ north: L.north, east: L.east, ground: L.ground, size: 20, entry: 0, scale: 1, variant: 0, seed: 1, heading: 0, pinned: true }, -1);
    for (let k = 0; k < 120; k++) {
      terrain.calls = 0;
      herds.step(DT, null, terrain, 100, L.north, L.east);
      pool.step(DT, null, terrain, h);
    }
    expect(pool.time).toBeCloseTo(herds.time, 9);
    expect(herds.extLevel[h]).toBe(THREAT.alert);
    expect(herds.extUntil[h]).toBeGreaterThan(herds.time);
  });

  it('FaunaSystem spawns the showcase T. rex at its lair and draws it', () => {
    const weather = { ...defaultWeather(), timeOfDay: 19, cloudCover: 0.35, windSpeedKt: 6 };
    const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 400000);
    const L = Anchors.TREX_LAIR;
    const state = { position: { x: L.north - 300, y: L.east, z: -(L.ground + 100) }, velocity: { x: 50, y: 0, z: 0 }, tas: 50, altitudeAGL: 100 };
    const ctx = { scene: new THREE.Scene(), camera, state, weather, env: createWorldEnvironment(weather), sky: { dayFactor: 1 }, simTime: 0, quality: 'high', events: createEventBus() } as unknown as SimContext;
    camera.position.set(L.east, L.ground + 100, -(L.north - 300));
    camera.lookAt(L.east, L.ground, -L.north);
    camera.updateMatrixWorld();
    const sys = createFaunaSystem(eraById('cretaceous'), { terrain: countingTerrain() }) as FaunaSystemImpl;
    sys.init(ctx);
    expect(sys.agents.count()).toBe(1);
    expect(sys.agents.speciesId(0)).toBe('tyrannosaurus');
    expect(Math.hypot(sys.agents.n[0] - L.north, sys.agents.e[0] - L.east)).toBeLessThan(1);
    let reads = 0;
    for (let k = 0; k < 120; k++) {
      sys.update(DT, ctx);
      reads = Math.max(reads, sys.debug.agentTerrainCalls);
    }
    expect(reads).toBeLessThanOrEqual(AGENT_RESERVE);
    const draws = (sys as unknown as { draws: { species: string; lod: { count: number; mesh: THREE.Mesh }[] }[] }).draws;
    const rex = draws.find((d) => d.species === 'tyrannosaurus')!;
    expect(rex.lod.reduce((a, l) => a + l.count, 0)).toBe(1);
    expect(rex.lod.filter((l) => l.mesh.visible).length).toBe(1);
    sys.dispose();
  });
});
