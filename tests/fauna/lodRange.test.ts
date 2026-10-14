// Render budgeting (Deep Time inc 2, WP0b): per-species LOD ranges (lodRangeScale, farRangeM), per-species LOD0
// caps per quality, the shared LOD0 triangle pool, and hidden count-0 meshes with stats.tris / stats.draws.

import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEventBus, type SimContext } from '../../src/core/context';
import { defaultWeather } from '../../src/core/types';
import { createWorldEnvironment } from '../../src/sim/worldEnvironment';
import { eraById } from '../../src/world/era/registry';
import { createFaunaSystem, type FaunaSystemImpl } from '../../src/world/fauna/FaunaSystem';
import { countingTerrain } from '../../src/world/fauna/habitat';
import { FAUNA_PRESETS } from '../../src/world/fauna/presets';
import { PROFILES } from '../../src/world/fauna/profiles';
import { ROSTERS } from '../../src/world/fauna/roster';
import type { FaunaSpeciesId } from '../../src/world/fauna/types';
import { setEra } from '../../src/world/era/eraState';

// The Cretaceous world (terrain with the volcano, environment, flora): createFaunaSystem's era only picks the roster.
beforeAll(() => {
  setEra('cretaceous');
});
afterAll(() => {
  setEra('present');
});

// Far from every showcase group (they stand within ~5 km of the field).
const N0 = 40000;
const E0 = 40000;
const GROUND = 0;

interface Draw {
  species: string;
  tris: [number, number, number];
  lod: { count: number; mesh: THREE.Mesh }[];
  caster: { count: number; mesh: THREE.Mesh };
}

function boot() {
  const weather = { ...defaultWeather(), timeOfDay: 12, cloudCover: 0.35, windSpeedKt: 6 };
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 400000);
  const state = { position: { x: N0, y: E0, z: -300 }, velocity: { x: 50, y: 0, z: 0 }, tas: 50, altitudeAGL: 300 };
  const ctx = { scene: new THREE.Scene(), camera, state, weather, env: createWorldEnvironment(weather), sky: { dayFactor: 1 }, simTime: 0, quality: 'high', events: createEventBus() } as unknown as SimContext;
  const sys = createFaunaSystem(eraById('cretaceous'), { terrain: countingTerrain() }) as FaunaSystemImpl;
  sys.init(ctx);
  // Only the test's herds: drop the showcase and stop the streaming (no other animals near N0, E0 anyway).
  for (let h = 0; h < sys.herds.capacity; h++) sys.herds.release(h);
  for (let i = 0; i < sys.flyers.capacity; i++) sys.flyers.release(i);
  for (let i = 0; i < sys.agents.capacity; i++) sys.agents.release(i);
  // 30 m up, looking north and a little down.
  camera.position.set(E0, GROUND + 30, -N0);
  camera.lookAt(E0, GROUND, -(N0 + 1000));
  camera.updateMatrixWorld();
  const draws = (sys as unknown as { draws: Draw[] }).draws;
  return { sys, ctx, draws };
}

const entry = (sp: FaunaSpeciesId): number => ROSTERS.cretaceous.entries.findIndex((e) => e.species === sp);

function addHerd(sys: FaunaSystemImpl, sp: FaunaSpeciesId, ahead: number, size: number, spread = 0): number {
  return sys.herds.spawn({ north: N0 + ahead, east: E0 + spread, ground: GROUND, size, entry: entry(sp), scale: 1, variant: 0, seed: 7 + ahead, heading: 0, pinned: true, species: sp }, -1);
}

const counts = (draws: Draw[], sp: string): number[] => draws.find((d) => d.species === sp)!.lod.map((l) => l.count);

describe('per-species LOD ranges and the LOD0 pool', () => {
  it("an Alamosaurus herd (farRangeM 12 km) 10 km away draws as LOD2; an Edmontosaurus herd there draws nothing", () => {
    const { sys, ctx, draws } = boot();
    expect(PROFILES.alamosaurus.render.farRangeM).toBe(12000);
    expect(FAUNA_PRESETS.high.lod2Range * PROFILES.edmontosaurus.render.lodRangeScale).toBeLessThan(10000);
    addHerd(sys, 'alamosaurus', 10000, 3);
    addHerd(sys, 'edmontosaurus', 10000, 20, 200);
    sys.update(0, ctx);
    expect(counts(draws, 'alamosaurus')).toEqual([0, 0, 3]);
    expect(counts(draws, 'edmontosaurus')).toEqual([0, 0, 0]);
    // And beyond its farRangeM, nothing.
    for (let h = 0; h < sys.herds.capacity; h++) sys.herds.release(h);
    addHerd(sys, 'alamosaurus', 13000, 3);
    sys.update(0, ctx);
    expect(counts(draws, 'alamosaurus')).toEqual([0, 0, 0]);
  });

  it('lodRangeScale stretches the LOD bands (Alamosaurus x2: LOD0 at 600 m on high)', () => {
    const { sys, ctx, draws } = boot();
    addHerd(sys, 'alamosaurus', 600, 2);
    addHerd(sys, 'edmontosaurus', 600, 2, 30);
    sys.update(0, ctx);
    expect(counts(draws, 'alamosaurus')[0]).toBe(2);
    expect(counts(draws, 'edmontosaurus')[0]).toBe(0);
  });

  it('the shared pool caps LOD0 triangles; the species cap caps LOD0 instances', () => {
    const { sys, ctx, draws } = boot();
    // 80 Edmontosaurus within the LOD0 range: their cap is 60 on high, but 60 x ~2.5k tris > the 130k pool.
    addHerd(sys, 'edmontosaurus', 150, 80);
    sys.update(0, ctx);
    const ed = draws.find((d) => d.species === 'edmontosaurus')!;
    const lod0 = ed.lod[0].count;
    expect(lod0 * ed.tris[0]).toBeLessThanOrEqual(FAUNA_PRESETS.high.lod0TriPool);
    expect(lod0).toBe(Math.min(PROFILES.edmontosaurus.render.lod0Max.high, Math.floor(FAUNA_PRESETS.high.lod0TriPool / ed.tris[0])));
    expect(ed.lod[1].count).toBe(80 - lod0);
    expect(sys.stats.tris).toBe(lod0 * ed.tris[0] + ed.lod[1].count * ed.tris[1]);
    // A species cap below the pool: Alamosaurus (4 on high).
    for (let h = 0; h < sys.herds.capacity; h++) sys.herds.release(h);
    addHerd(sys, 'alamosaurus', 300, 6);
    sys.update(0, ctx);
    expect(counts(draws, 'alamosaurus')[0]).toBe(PROFILES.alamosaurus.render.lod0Max.high);
  });

  it('meshes with no instances are hidden and stats.draws counts the drawn ones', () => {
    const { sys, ctx, draws } = boot();
    addHerd(sys, 'edmontosaurus', 1000, 10);
    sys.update(0, ctx);
    let visible = 0;
    for (const d of draws) {
      for (const l of d.lod) {
        expect(l.mesh.visible).toBe(l.count > 0);
        if (l.mesh.visible) visible++;
      }
      expect(d.caster.mesh.visible).toBe(d.caster.count > 0);
    }
    expect(visible).toBeGreaterThan(0);
    expect(sys.stats.draws).toBe(visible);
    expect(sys.stats.visible).toBe(10);
  });
});
