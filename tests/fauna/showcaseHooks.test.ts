// Showcase hooks (Deep Time inc 2, WP0b): the default Cretaceous boot spawns every showcase group through the
// species hooks, kettle composition is data, and the dusk kettles circle the pinned virtual evening core.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createEventBus, type QualityLevel, type SimContext } from '../../src/core/context';
import { defaultWeather } from '../../src/core/types';
import { createWorldEnvironment } from '../../src/sim/worldEnvironment';
import { ALAMOSAURUS_STAND, KETTLE0_EVENING, KETTLE0_LIFT_M, KETTLE_BAND_M, SAFARI_FLIGHT, TREX_LAIR, TRICERATOPS_GROUP } from '../../src/world/era/cretaceousAnchors';
import { eraById } from '../../src/world/era/registry';
import { createFaunaSystem, type FaunaSystemImpl } from '../../src/world/fauna/FaunaSystem';
import { FLYER_MODE } from '../../src/world/fauna/flight';
import { countingTerrain, herdEntries } from '../../src/world/fauna/habitat';
import { FAUNA_PRESETS } from '../../src/world/fauna/presets';
import { PROFILES } from '../../src/world/fauna/profiles';
import { ROSTERS } from '../../src/world/fauna/roster';
import { KETTLE_BIRDS, KETTLE_MAX_AGL, KETTLE_MIN_AGL, SAFARI_AGL_M } from '../../src/world/fauna/showcase';
import { DEFAULT_KETTLE, SHOWCASE_HOOKS, kettleComposition, type ShowcaseSpawn } from '../../src/world/fauna/showcaseHooks';

const DT = 1 / 60;

function makeCtx(tod: number, quality: QualityLevel = 'high') {
  const weather = { ...defaultWeather(), timeOfDay: tod, cloudCover: 0.35, windSpeedKt: 6 };
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 400000);
  const state = { position: { x: 0, y: 0, z: -400 }, velocity: { x: 0, y: -60, z: 0 }, tas: 60, altitudeAGL: 137 };
  const ctx = { scene: new THREE.Scene(), camera, state, weather, env: createWorldEnvironment(weather), sky: { dayFactor: 1 }, simTime: 0, quality, events: createEventBus() };
  return ctx as unknown as SimContext & { state: typeof state; simTime: number };
}

function boot(tod = 19, quality: QualityLevel = 'high') {
  const ctx = makeCtx(tod, quality);
  const sys = createFaunaSystem(eraById('cretaceous'), { terrain: countingTerrain() }) as FaunaSystemImpl;
  sys.init(ctx);
  return { sys, ctx };
}

const speciesOfHerd = (sys: FaunaSystemImpl, h: number): string => ROSTERS.cretaceous.entries[sys.herds.entry[h]].species;
const speciesOfFlyer = (sys: FaunaSystemImpl, i: number): string => ROSTERS.cretaceous.entries[sys.flyers.entry[i]].species;

describe('showcase hooks', () => {
  it('registers one hook per inc-2 species', () => {
    expect(SHOWCASE_HOOKS.map((h) => h.species)).toEqual(['tyrannosaurus', 'triceratops', 'alamosaurus', 'pteranodon']);
  });

  it('kettle composition is data: hook birds replace the default azhdarchids from the end, 6 in total', () => {
    expect(kettleComposition([], 0)).toEqual([...DEFAULT_KETTLE]);
    const spawns: ShowcaseSpawn[] = [
      { kind: 'flyer', species: 'pteranodon', kettle: 0, count: 3 },
      { kind: 'flyer', species: 'quetzalcoatlus', kettle: 1, count: 1 },
    ];
    expect(kettleComposition(spawns, 0)).toEqual(['quetzalcoatlus', 'azhdarchidSmall', 'azhdarchidSmall', 'pteranodon', 'pteranodon', 'pteranodon']);
    expect(kettleComposition(spawns, 1)).toHaveLength(KETTLE_BIRDS);
    expect(kettleComposition([{ kind: 'flyer', species: 'pteranodon', kettle: 0, count: 99 }], 0)).toEqual(Array(KETTLE_BIRDS).fill('pteranodon'));
  });

  it('the kettle band is the safari height +- 60 m', () => {
    expect(SAFARI_AGL_M).toBeCloseTo(450 * 0.3048, 6);
    expect(KETTLE_MIN_AGL).toBeCloseTo(SAFARI_AGL_M - KETTLE_BAND_M, 6);
    expect(KETTLE_MAX_AGL).toBeCloseTo(SAFARI_AGL_M + KETTLE_BAND_M, 6);
  });

  it('the default boot spawns the river herd, the Triceratops 7, the Alamosaurus 3, the T. rex, kettle 0 = 3 + 3, kettle 1 and the pair', () => {
    const { sys } = boot();
    const H = sys.herds;
    expect(sys.riverHerd).toBeGreaterThanOrEqual(0);
    expect(speciesOfHerd(sys, sys.riverHerd)).toBe('edmontosaurus');
    const bySpecies = new Map(sys.showcaseHerds.map((h) => [speciesOfHerd(sys, h), h]));
    const tri = bySpecies.get('triceratops')!;
    const ala = bySpecies.get('alamosaurus')!;
    expect(H.size[tri]).toBe(7);
    expect(H.size[ala]).toBe(3);
    expect(H.pinned[tri]).toBe(1);
    expect(H.pinned[ala]).toBe(1);
    expect(Math.hypot(H.cN[tri] - TRICERATOPS_GROUP.north, H.cE[tri] - TRICERATOPS_GROUP.east)).toBeLessThan(1);
    expect(Math.hypot(H.cN[ala] - ALAMOSAURUS_STAND.north, H.cE[ala] - ALAMOSAURUS_STAND.east)).toBeLessThan(1);
    expect(sys.agents.count()).toBe(1);
    expect(sys.agents.speciesId(0)).toBe('tyrannosaurus');
    expect(Math.hypot(sys.agents.n[0] - TREX_LAIR.north, sys.agents.e[0] - TREX_LAIR.east)).toBeLessThan(1);
    // Flyers: the pair, kettle 0 (3 Pteranodon + 1 Quetzalcoatlus + 2 small) and kettle 1 (6): 14, <= medium.
    const F = sys.flyers;
    const k0: string[] = [];
    let k1 = 0;
    let pair = 0;
    for (let i = 0; i < F.capacity; i++) {
      if (!F.active[i]) continue;
      if (sys.kettleOf[i] === 0) k0.push(speciesOfFlyer(sys, i));
      else if (sys.kettleOf[i] === 1) k1++;
      else if (F.mode[i] === FLYER_MODE.stand) pair++;
    }
    expect(k0.sort()).toEqual(['azhdarchidSmall', 'azhdarchidSmall', 'pteranodon', 'pteranodon', 'pteranodon', 'quetzalcoatlus']);
    // Each bird flies with its species' wingbeat and its size relative to Quetzalcoatlus (speeds scale with it).
    for (let i = 0; i < F.capacity; i++) {
      if (!F.active[i] || speciesOfFlyer(sys, i) !== 'pteranodon') continue;
      expect(F.hz[i]).toBeCloseTo(PROFILES.pteranodon.flapHz, 6);
      expect(F.size[i]).toBeGreaterThan((6.5 / 10.5) * 0.9);
      expect(F.size[i]).toBeLessThan((6.5 / 10.5) * 1.1);
    }
    expect(k1).toBe(KETTLE_BIRDS);
    expect(pair).toBe(2);
    expect(F.count()).toBe(14);
    expect(F.count()).toBeLessThanOrEqual(FAUNA_PRESETS.medium.flyers);
  });

  it('the low preset shows 8 flyers (kettle 1 trimmed)', () => {
    const { sys } = boot(19, 'low');
    expect(sys.flyers.count()).toBe(FAUNA_PRESETS.low.flyers);
    expect(sys.flyers.count()).toBe(8);
    for (let i = 0; i < sys.flyers.capacity; i++) if (sys.flyers.active[i]) expect(sys.kettleOf[i]).not.toBe(1);
  });

  it('at dusk (no thermals) kettle 0 circles the virtual evening core just above eye level (KETTLE0_LIFT_M), and keeps at it', () => {
    const { sys, ctx } = boot(19);
    const F = sys.flyers;
    const k0 = () => Array.from({ length: F.capacity }, (_, i) => i).filter((i) => F.active[i] && sys.kettleOf[i] === 0);
    expect(k0()).toHaveLength(6);
    // Far from the birds (no evade), 30 s.
    ctx.state.position.x = 30000;
    for (let k = 0; k < 30 * 60; k++) {
      ctx.simTime += DT;
      sys.update(DT, ctx);
    }
    for (const i of k0()) {
      expect(F.mode[i]).toBe(FLYER_MODE.kettle);
      expect(F.virt[i]).toBe(1);
      expect(Math.hypot(F.n[i] - KETTLE0_EVENING.north, F.e[i] - KETTLE0_EVENING.east)).toBeLessThan(120);
      expect(Math.abs(F.alt[i] - SAFARI_FLIGHT.altitudeMSL - KETTLE0_LIFT_M)).toBeLessThan(KETTLE_BAND_M + 8);
    }
  });

  it('with thermals (tod 10) the kettles use the real cores, not the virtual one', () => {
    const { sys } = boot(10);
    const F = sys.flyers;
    let kettled = 0;
    for (let i = 0; i < F.capacity; i++) {
      if (!F.active[i] || sys.kettleOf[i] < 0) continue;
      expect(F.virt[i]).toBe(0);
      if (F.mode[i] === FLYER_MODE.kettle) kettled++;
    }
    expect(kettled).toBeGreaterThan(0);
  });

  it('the pinned Alamosaurus trio is not released 15 km away', () => {
    const { sys, ctx } = boot(19);
    const ala = sys.showcaseHerds.find((h) => speciesOfHerd(sys, h) === 'alamosaurus')!;
    ctx.camera.position.set(ALAMOSAURUS_STAND.east + 15000, 500, -ALAMOSAURUS_STAND.north);
    ctx.camera.updateMatrixWorld();
    ctx.state.position.x = ALAMOSAURUS_STAND.north;
    ctx.state.position.y = ALAMOSAURUS_STAND.east + 15000;
    for (let k = 0; k < 120; k++) {
      ctx.simTime += DT;
      sys.update(DT, ctx);
    }
    expect(sys.herds.active[ala]).toBe(1);
    expect(speciesOfHerd(sys, ala)).toBe('alamosaurus');
  });

  it('the habitat streaming never spawns solo or showcase-only species (roster append-only)', () => {
    const R = ROSTERS.cretaceous;
    expect(R.entries.slice(0, 3).map((e) => e.species)).toEqual(['edmontosaurus', 'quetzalcoatlus', 'azhdarchidSmall']);
    expect(herdEntries(R).map((i) => R.entries[i].species)).toEqual(['edmontosaurus']);
    for (const sp of ['triceratops', 'alamosaurus', 'tyrannosaurus'] as const) expect(R.entries.find((e) => e.species === sp)!.ambient).toBe(false);
    expect(R.entries.find((e) => e.species === 'tyrannosaurus')!.role).toBe('solo');
    expect(R.entries.find((e) => e.species === 'pteranodon')!.weight).toBeCloseTo(0.3, 6);
  });
});
