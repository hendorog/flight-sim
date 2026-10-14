// The ambient T. rex hunt (Deep Time inc 2b, P2): a roaming T. rex anywhere on the map shadows a nearby herd and
// stalks and charges it when the aircraft comes by (tyrannosaurus.brain.ts "THE AMBIENT HUNT"). HerdPool and
// SoloAgentPool directly, stepped as FaunaSystem does (herds, then agents), on a flat terrain and on the real
// Cretaceous terrain at an away point (V1, the river floodplain ~22 km SW of the start). The scripted lair beat is
// pinned separately (tyrannosaurus.test.ts: its 30 s trace hash, and here the full 150 s cycle's hash).

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as Anchors from '../../src/world/era/cretaceousAnchors';
import { setEra } from '../../src/world/era/eraState';
import { SoloAgentPool } from '../../src/world/fauna/agents';
import { brainFor } from '../../src/world/fauna/brains';
import { countingTerrain, type FaunaTerrain } from '../../src/world/fauna/habitat';
import { ALARM, HerdPool, type AircraftView } from '../../src/world/fauna/herds';
import { AGENT_RESERVE, FLYER_RESERVE, TERRAIN_CALLS_PER_FRAME } from '../../src/world/fauna/presets';
import { THREAT } from '../../src/world/fauna/reactions';
import { RIVER_HERD_SIZE } from '../../src/world/fauna/showcase';
import { TREX_BRAIN, TREX_STATE, TYRANNOSAURUS_BRAIN } from '../../src/world/fauna/species/tyrannosaurus.brain';
import type { FaunaSpeciesId } from '../../src/world/fauna/types';
import { makeSample, sampleTerrain } from '../../src/world/terrain/heightfield';

beforeAll(() => {
  setEra('cretaceous');
});
afterAll(() => {
  setEra('present');
});

const DT = 1 / 60;
const S = TREX_STATE;
const K = TREX_BRAIN;
const HERD_BUDGET = TERRAIN_CALLS_PER_FRAME - FLYER_RESERVE - AGENT_RESERVE;

/** The away point: V1's waterside Edmontosaurus site on the SW river floodplain (22 km from the safari start). */
const AWAY = { north: -14301, east: -13749 };

/**
 * A flat, dry terrain that does not allocate. riverDist is finite (300 m) so a herd's wander look-ahead accepts the
 * ground (it keeps waterside herds within HERD_MAX_RIVER_DIST + 200 of a river) and the herds really roam.
 */
function flatTerrain(g = 120): FaunaTerrain {
  const t: FaunaTerrain = {
    calls: 0,
    sample: (_n, _e, out) => {
      t.calls++;
      out.ground = g;
      out.standing = -1000;
      out.river = -Infinity;
      out.riverDist = 300;
      out.riverHalfWidth = 0;
      out.airportBlend = 1;
      return out;
    },
    height: () => {
      t.calls++;
      return g;
    },
  };
  return t;
}

let seedCounter = 0x51a7e;
function spawnHerd(herds: HerdPool, species: FaunaSpeciesId, n: number, e: number, ground: number, size: number, pinned = false, seed = ++seedCounter): number {
  const h = herds.spawn({ north: n, east: e, ground, size, entry: 0, scale: 1, variant: 0, seed, heading: 0.3, pinned, species }, pinned ? -1 : 1000 + seed);
  expect(h).toBeGreaterThanOrEqual(0);
  return h;
}

function spawnRex(pool: SoloAgentPool, n: number, e: number, ground: number, faceN: number, faceE: number, seed = 0xa3b1e): number {
  const i = pool.spawn({ species: 'tyrannosaurus', entry: 5, north: n, east: e, ground, heading: Math.atan2(faceE - e, faceN - n), scale: 1, variant: 0, seed }, brainFor('tyrannosaurus'));
  expect(i).toBeGreaterThanOrEqual(0);
  return i;
}

const WS = makeSample();
/** A dry bearing from (n, e) at which the whole r m line (every 20 m) is clear of the river and lakes (real terrain). */
function dryBearing(n: number, e: number, r: number): number {
  for (let k = 0; k < 24; k++) {
    const b = (k * Math.PI) / 12;
    let ok = true;
    for (let d = 0; d <= r + 40 && ok; d += 20) {
      const s = sampleTerrain(n + d * Math.cos(b), e + d * Math.sin(b), WS);
      ok = s.riverDist - s.riverHalfWidth > 40 && s.ground > s.standing + 0.5;
    }
    if (ok) return b;
  }
  throw new Error('no dry bearing');
}

interface Scene {
  herds: HerdPool;
  pool: SoloAgentPool;
  terrain: FaunaTerrain;
  prey: number;
  rex: number;
  /** The showcase river herd slot passed as riverHerd (-1 none). */
  river: number;
  ground: number;
}

/**
 * An unpinned prey herd at AWAY and a T. rex `dist` m from it. withRiver: a pinned river herd at the showcase site
 * (22 km away) is passed as riverHerd, as FaunaSystem does; the T. rex's home is far from the lair, so it is ambient.
 */
function scene(terrain: FaunaTerrain, real: boolean, species: FaunaSpeciesId = 'edmontosaurus', size = 40, withRiver = false, dist = 380): Scene {
  const herds = new HerdPool();
  let river = -1;
  if (withRiver) {
    const R = Anchors.RIVER_HERD_SITE;
    river = herds.spawn({ north: R.north, east: R.east, ground: R.ground, size: RIVER_HERD_SIZE, entry: 0, scale: 1, variant: 0, seed: 0x5ca1ab1e, heading: R.heading, pinned: true, species: 'edmontosaurus' }, -1);
  }
  const ground = real ? sampleTerrain(AWAY.north, AWAY.east, WS).ground : terrain.height(AWAY.north, AWAY.east);
  const prey = spawnHerd(herds, species, AWAY.north, AWAY.east, ground, size, false, 0xbee5 + size);
  const b = real ? dryBearing(AWAY.north, AWAY.east, dist) : (200 * Math.PI) / 180;
  const rn = AWAY.north + dist * Math.cos(b);
  const re = AWAY.east + dist * Math.sin(b);
  const pool = new SoloAgentPool(herds, terrain, Anchors);
  const rg = real ? sampleTerrain(rn, re, WS).ground : ground;
  const rex = spawnRex(pool, rn, re, rg, AWAY.north, AWAY.east);
  return { herds, pool, terrain, prey, rex, river, ground };
}

/** A straight pass: from 5 km out along `hdg`, `abeam` m to the side of the herd's home, `agl` m above its ground. */
function passAt(t: number, sc: Scene, ac: AircraftView, agl = 150, abeam = 300, hdg = (60 * Math.PI) / 180, v = 60): AircraftView {
  const along = -5000 + v * t;
  const cn = Math.cos(hdg);
  const se = Math.sin(hdg);
  ac.n = AWAY.north + along * cn - abeam * se;
  ac.e = AWAY.east + along * se + abeam * cn;
  ac.alt = sc.ground + agl;
  ac.vN = v * cn;
  ac.vE = v * se;
  ac.vD = 0;
  ac.tas = v;
  return ac;
}

interface Trace {
  stalk: number;
  charge: number;
  roar: number;
  wander: number;
  /** Re-entered LURK after the hunt, and its distance from home then. */
  lurk: number;
  lurkHome: number;
  fleeSet: number;
  stalkKm: number;
  chargeKm: number;
  maxReads: number;
  /** Nearest the T. rex came to any prey member (m), and the prey ran (ALARM.run) at any time while fleeing. */
  minMember: number;
  ran: boolean;
  faced: boolean;
  finite: boolean;
  lines: string[];
}

const acDist = (ac: AircraftView, sc: Scene): number => Math.sqrt((ac.n - sc.herds.cN[sc.prey]) ** 2 + (ac.e - sc.herds.cE[sc.prey]) ** 2);

/** Fly a pass (and then hold the aircraft where it ends) for `seconds`, stepping herds then agents. */
function fly(sc: Scene, seconds: number, agl = 150): Trace {
  const { herds, pool, terrain, prey, rex } = sc;
  const tr: Trace = { stalk: NaN, charge: NaN, roar: NaN, wander: NaN, lurk: NaN, lurkHome: NaN, fleeSet: NaN, stalkKm: NaN, chargeKm: NaN, maxReads: 0, minMember: Infinity, ran: false, faced: false, finite: true, lines: [] };
  const ac: AircraftView = { n: 0, e: 0, alt: 0, vN: 0, vE: 0, vD: 0, tas: 0 };
  const frames = Math.round(seconds / DT);
  for (let f = 1; f <= frames; f++) {
    const t = f * DT;
    passAt(Math.min(t, 160), sc, ac, agl);
    terrain.calls = 0;
    herds.step(DT, ac, terrain, HERD_BUDGET, ac.n, ac.e);
    const reads = pool.step(DT, ac, terrain, sc.river);
    tr.maxReads = Math.max(tr.maxReads, reads);
    const s = pool.state[rex];
    if (s === S.stalk && Number.isNaN(tr.stalk)) {
      tr.stalk = t;
      tr.stalkKm = acDist(ac, sc) / 1000;
    }
    if (s === S.charge && Number.isNaN(tr.charge)) {
      tr.charge = t;
      tr.chargeKm = acDist(ac, sc) / 1000;
    }
    if (s === S.roar && Number.isNaN(tr.roar)) tr.roar = t;
    if (s === S.wander && Number.isNaN(tr.wander)) tr.wander = t;
    if (s === S.lurk && !Number.isNaN(tr.wander) && Number.isNaN(tr.lurk)) {
      tr.lurk = t;
      tr.lurkHome = Math.hypot(pool.n[rex] - pool.homeN[rex], pool.e[rex] - pool.homeE[rex]);
    }
    if (herds.fleeing[prey] && Number.isNaN(tr.fleeSet)) tr.fleeSet = t;
    if (herds.fleeing[prey] && herds.react[prey] === ALARM.run) tr.ran = true;
    if (herds.fleeing[prey] && herds.react[prey] === ALARM.face) tr.faced = true;
    const k = herds.nearestMember(prey, pool.n[rex], pool.e[rex]);
    if (k >= 0) tr.minMember = Math.min(tr.minMember, Math.hypot(herds.mN[k] - pool.n[rex], herds.mE[k] - pool.e[rex]));
    if (!(Number.isFinite(pool.n[rex]) && Number.isFinite(pool.e[rex]) && Number.isFinite(pool.yaw[rex]) && Number.isFinite(pool.speed[rex]))) tr.finite = false;
    if (f % 30 === 0) tr.lines.push(`${t.toFixed(2)} ${s} ${pool.n[rex].toFixed(4)} ${pool.e[rex].toFixed(4)} ${pool.yaw[rex].toFixed(5)} ${pool.speed[rex].toFixed(4)} ${pool.flap[rex].toFixed(3)} ${herds.fleeing[prey]} ${herds.cN[prey].toFixed(3)} ${herds.cE[prey].toFixed(3)}`);
  }
  return tr;
}

const proc = (globalThis as unknown as { process: { memoryUsage(): { heapUsed: number } } }).process;

// The allocation test runs first (later tests drive the pool with other terrain objects; see tyrannosaurus.test.ts).
// It measures each phase in its steady state (median of 7 runs after a JIT warm-up), so the one-off costs of a
// state change (the base brain's scripted hunt already shows ~12 KB once per hunt in this harness, none per frame)
// do not mask, or fake, a per-frame allocation.
describe('ambient T. rex: allocation', () => {
  // Both prey kinds: 'flee' (Edmontosaurus) and 'face' (Triceratops: the stand-off paths in STALK and CHARGE).
  it.each([
    ['edmontosaurus', 40, 380],
    ['triceratops', 7, 430],
  ] as [FaunaSpeciesId, number, number][])('%s prey: steps every phase of the ambient hunt without allocating per frame', (species, size, dist) => {
    const terrain = flatTerrain();
    const sc = scene(terrain, false, species, size, false, dist);
    const { herds, pool, rex } = sc;
    // The aircraft holds 1000 m north of the herd, 150 m up, heading for it (the range closing: no roar until
    // AMB_ROAR_AFTER), or 2900 m out (a stalk that runs to its timeout).
    const near: AircraftView = { n: AWAY.north + 1000, e: AWAY.east, alt: sc.ground + 150, vN: -50, vE: 0, vD: 0, tas: 50 };
    const far: AircraftView = { n: AWAY.north + 2900, e: AWAY.east, alt: sc.ground + 150, vN: -50, vE: 0, vD: 0, tas: 50 };
    const states = new Set<number>();
    // Warm up over whole hunts, with the herds running so the threats land.
    for (let k = 0; k < 6000; k++) {
      terrain.calls = 0;
      herds.step(DT, near, terrain, 100, near.n, near.e);
      pool.step(DT, near, terrain, -1);
      states.add(pool.state[rex]);
    }
    expect([S.stalk, S.charge, S.roar, S.wander].every((s) => states.has(s))).toBe(true);
    // The herd back at home, calm (it is not stepped in the measure: the pool alone is measured).
    herds.release(sc.prey);
    expect(spawnHerd(herds, species, AWAY.north, AWAY.east, sc.ground, size, false, 0xbee5 + size)).toBe(sc.prey);
    let ac: AircraftView | null = null;
    const step = (): void => {
      terrain.calls = 0;
      pool.step(DT, ac, terrain, -1);
    };
    /** Bytes per frame over `frames` frames of `state`, entered from a T. rex spawned `from` m south of the herd. */
    const phase = (from: number, a: AircraftView | null, state: number, frames: number): number => {
      const runs: number[] = [];
      ac = a;
      for (let r = 0; r < 16; r++) {
        pool.release(rex);
        pool.spawn({ species: 'tyrannosaurus', entry: 5, north: AWAY.north - from, east: AWAY.east, ground: sc.ground, heading: 0, scale: 1, variant: 0, seed: 0xa3b1e }, TYRANNOSAURUS_BRAIN);
        let k = 0;
        while (pool.state[rex] !== state && k++ < 200 / DT) step();
        for (k = 0; k < 60; k++) step();
        expect(pool.state[rex]).toBe(state);
        const a0 = proc.memoryUsage().heapUsed;
        for (k = 0; k < frames; k++) step();
        if (r >= 9) runs.push((proc.memoryUsage().heapUsed - a0) / frames);
        expect(pool.state[rex]).toBe(state);
      }
      runs.sort((x, y) => x - y);
      return runs[3];
    };
    // Each phase twice: the first pass warms its code paths up (unoptimised code boxes its doubles).
    const twice = (from: number, a: AircraftView | null, state: number, frames: number): number => (phase(from, a, state, frames), phase(from, a, state, frames));
    const shadow = twice(1300, null, S.lurk, 900);
    const stalk = twice(400, far, S.stalk, 900);
    const charge = twice(400, near, S.charge, 1200);
    const wander = twice(400, near, S.wander, 900);
    // eslint-disable-next-line no-console
    console.log(`allocation B/frame (${species}): shadow ${shadow.toFixed(2)}, stalk ${stalk.toFixed(2)}, charge ${charge.toFixed(2)}, wander ${wander.toFixed(2)}`);
    expect(shadow).toBeLessThan(8);
    expect(stalk).toBeLessThan(8);
    expect(charge).toBeLessThan(8);
    expect(wander).toBeLessThan(8);
  });
});

describe('ambient T. rex: a low pass at an away point', () => {
  let flat: Trace;
  let real: Trace;
  beforeAll(() => {
    flat = fly(scene(flatTerrain(), false), 140);
    real = fly(scene(countingTerrain(), true, 'edmontosaurus', 40, true), 140);
  });

  it.each([
    ['flat', () => flat],
    ['real terrain (riverHerd = the showcase slot)', () => real],
  ])('%s: stalks 2.5-3.2 km out, charges 0.8-1.6 km out, the herd flees by closest approach, then the roar', (_n, get) => {
    const tr = get();
    const ca = 5000 / 60;
    expect(tr.stalkKm).toBeGreaterThanOrEqual(2.5);
    expect(tr.stalkKm).toBeLessThanOrEqual(3.2);
    expect(tr.chargeKm).toBeGreaterThanOrEqual(0.8);
    expect(tr.chargeKm).toBeLessThanOrEqual(1.6);
    expect(tr.charge - tr.stalk).toBeGreaterThanOrEqual(K.CHARGE_EARLIEST);
    expect(tr.fleeSet).toBeLessThanOrEqual(ca + 3);
    expect(tr.fleeSet).toBeGreaterThan(tr.charge);
    expect(tr.ran).toBe(true);
    expect(tr.roar).toBeGreaterThan(tr.charge);
    expect(tr.wander).toBeGreaterThan(tr.roar);
    expect(tr.minMember).toBeGreaterThan(K.STOP_SHORT - 5);
    expect(tr.finite).toBe(true);
    // eslint-disable-next-line no-console
    console.log(`pass ${_n}: stalk t=${tr.stalk.toFixed(1)} s at ${tr.stalkKm.toFixed(2)} km; charge t=${tr.charge.toFixed(1)} s at ${tr.chargeKm.toFixed(2)} km; flee t=${tr.fleeSet.toFixed(1)} s (closest approach ${ca.toFixed(1)} s); roar t=${tr.roar.toFixed(1)} s; wander t=${tr.wander.toFixed(1)} s; nearest member ${tr.minMember.toFixed(0)} m`);
  });

  it('keeps within the agents terrain reserve (12 reads per frame)', () => {
    expect(AGENT_RESERVE).toBe(12);
    expect(flat.maxReads).toBeLessThanOrEqual(AGENT_RESERVE);
    expect(real.maxReads).toBeLessThanOrEqual(AGENT_RESERVE);
  });

  it('is deterministic: two runs give identical traces', () => {
    const b = fly(scene(flatTerrain(), false), 140);
    expect(b.lines).toEqual(flat.lines);
    expect(b.lines.length).toBe(280);
  });

  it('walks home after the roar, lurks there, and is re-armed only after AMB_REARM_S (120 s)', () => {
    const sc = scene(flatTerrain(), false);
    const tr = fly(sc, 300);
    expect(tr.lurk).toBeGreaterThan(tr.wander);
    expect(tr.lurkHome).toBeLessThan(5);
    // The aircraft now holds 2 km from the herd, 150 m up (it would stalk at once if armed).
    const { herds, pool, terrain, rex, prey } = sc;
    const ac: AircraftView = { n: 0, e: 0, alt: sc.ground + 150, vN: 0, vE: 0, vD: 0, tas: 50 };
    let stalkAgain = Number.NaN;
    for (let f = 1; f <= Math.round(150 / DT) && Number.isNaN(stalkAgain); f++) {
      ac.n = herds.cN[prey] + 2000;
      ac.e = herds.cE[prey];
      terrain.calls = 0;
      herds.step(DT, ac, terrain, HERD_BUDGET, ac.n, ac.e);
      pool.step(DT, ac, terrain, -1);
      if (pool.state[rex] === S.stalk) stalkAgain = herds.time;
    }
    const lurkT = tr.lurk;
    expect(stalkAgain).toBeGreaterThanOrEqual(lurkT + K.AMB_REARM_S);
    expect(stalkAgain).toBeLessThan(lurkT + K.AMB_REARM_S + 10);
  });

  it('a pass 1500 m above the herd triggers nothing', () => {
    const sc = scene(flatTerrain(), false);
    const tr = fly(sc, 140, 1500);
    expect(Number.isNaN(tr.stalk)).toBe(true);
    expect(Number.isNaN(tr.charge)).toBe(true);
    expect(sc.herds.extUntil[sc.prey]).toBe(-Infinity);
  });

  it('an early roar (the aircraft already going away at AMB_ROAR_MIN_S) still sends the herd running', () => {
    // The aircraft holds 1000 m north of the herd, 150 m up, flying away from it (the range opening): the charge
    // starts at CHARGE_EARLIEST into the stalk and the roar comes at AMB_ROAR_MIN_S, long before the T. rex
    // (~320 m out) is within AMB_BREAK_COVER_M of a member or AMB_BREAK_COVER_MAX_S has run.
    const sc = scene(flatTerrain(), false);
    const { herds, pool, terrain, rex, prey } = sc;
    const ac: AircraftView = { n: 0, e: 0, alt: sc.ground + 150, vN: 50, vE: 0, vD: 0, tas: 50 };
    let charge = Number.NaN;
    let roar = Number.NaN;
    let levelAtRoar = -1;
    let ran = false;
    for (let f = 1; f <= Math.round(60 / DT); f++) {
      const t = f * DT;
      ac.n = herds.cN[prey] + 1000;
      ac.e = herds.cE[prey];
      terrain.calls = 0;
      herds.step(DT, ac, terrain, HERD_BUDGET, ac.n, ac.e);
      pool.step(DT, ac, terrain, -1);
      const s = pool.state[rex];
      if (s === S.charge && Number.isNaN(charge)) charge = t;
      if (s === S.roar && Number.isNaN(roar)) {
        roar = t;
        levelAtRoar = herds.extLevel[prey];
      }
      if (herds.fleeing[prey] && herds.react[prey] === ALARM.run) ran = true;
    }
    expect(roar - charge).toBeLessThan(K.AMB_BREAK_COVER_MAX_S);
    // The roar breaks cover: the flee threat goes out no later than the roar.
    expect(levelAtRoar).toBe(THREAT.flee);
    expect(ran).toBe(true);
  });
});

describe('ambient T. rex: Triceratops stand-off', () => {
  it.each([
    ['flat', false],
    ['real terrain', true],
  ])('%s: it pulls up >= 220 m from the nearest member, the group faces it and never runs, and it roars', (_n, realT) => {
    const sc = scene(realT ? countingTerrain() : flatTerrain(), realT, 'triceratops', 7, realT, 430);
    const tr = fly(sc, 140);
    expect(tr.charge).toBeGreaterThan(tr.stalk);
    expect(tr.chargeKm).toBeGreaterThanOrEqual(0.8);
    expect(tr.chargeKm).toBeLessThanOrEqual(1.6);
    expect(tr.minMember).toBeGreaterThanOrEqual(220);
    expect(tr.minMember).toBeLessThan(K.FACE_STANDOFF_M + 40);
    expect(sc.herds.extLevel[sc.prey]).toBe(THREAT.flee);
    expect(tr.faced).toBe(true);
    expect(tr.ran).toBe(false);
    expect(tr.roar).toBeGreaterThan(tr.charge);
    expect(tr.finite).toBe(true);
    // eslint-disable-next-line no-console
    console.log(`stand-off ${realT ? 'real' : 'flat'}: nearest member ${tr.minMember.toFixed(1)} m; charge ${tr.chargeKm.toFixed(2)} km, roar ${(tr.roar - tr.charge).toFixed(1)} s in`);
  });
});

describe('ambient T. rex: what it may hunt', () => {
  it('never threatens a pinned herd 300 m away, and never takes the Alamosaurus as prey', () => {
    const terrain = flatTerrain();
    const sc = scene(terrain, false);
    const { herds, pool, rex } = sc;
    // A pinned Triceratops group (face: the kind the threat fan-out reaches) 300 m from the T. rex, inside
    // FACE_RANGE of it and of the prey; a pinned Edmontosaurus herd nearer than the prey; an unpinned Alamosaurus
    // group nearest of all.
    const b = Math.atan2(pool.e[rex] - AWAY.east, pool.n[rex] - AWAY.north) + Math.PI / 2;
    const pinTri = spawnHerd(herds, 'triceratops', pool.n[rex] + 300 * Math.cos(b), pool.e[rex] + 300 * Math.sin(b), sc.ground, 7, true);
    const pinEd = spawnHerd(herds, 'edmontosaurus', pool.n[rex] - 200 * Math.cos(b), pool.e[rex] - 200 * Math.sin(b), sc.ground, 20, true);
    const alamo = spawnHerd(herds, 'alamosaurus', pool.n[rex] + 150, pool.e[rex] + 60, sc.ground, 3, false);
    const tr = fly(sc, 140);
    expect(tr.charge).toBeGreaterThan(0);
    expect(herds.extLevel[sc.prey]).toBe(THREAT.flee);
    expect(herds.extUntil[pinTri]).toBe(-Infinity);
    expect(herds.extUntil[pinEd]).toBe(-Infinity);
    expect(herds.extUntil[alamo]).toBe(-Infinity);
  });

  it('with only an Alamosaurus group (and a pinned herd) in range it never stalks', () => {
    const terrain = flatTerrain();
    const herds = new HerdPool();
    const pool = new SoloAgentPool(herds, terrain, Anchors);
    const alamo = spawnHerd(herds, 'alamosaurus', AWAY.north, AWAY.east, 120, 3, false);
    const pin = spawnHerd(herds, 'edmontosaurus', AWAY.north + 300, AWAY.east, 120, 20, true);
    const rex = spawnRex(pool, AWAY.north - 380, AWAY.east, 120, AWAY.north, AWAY.east);
    const sc: Scene = { herds, pool, terrain, prey: alamo, rex, river: -1, ground: 120 };
    const tr = fly(sc, 140);
    expect(Number.isNaN(tr.stalk)).toBe(true);
    expect(herds.extUntil[alamo]).toBe(-Infinity);
    expect(herds.extUntil[pin]).toBe(-Infinity);
  });

  it('prefers an Edmontosaurus herd to a nearer Triceratops group', () => {
    const terrain = flatTerrain();
    const sc = scene(terrain, false);
    const { herds, pool, rex } = sc;
    const tri = spawnHerd(herds, 'triceratops', pool.n[rex] - 250, pool.e[rex], sc.ground, 5, false);
    const k0 = herds.nearestMember(sc.prey, pool.n[rex], pool.e[rex]);
    const d0 = Math.hypot(herds.mN[k0] - pool.n[rex], herds.mE[k0] - pool.e[rex]);
    const tr = fly(sc, 140);
    expect(herds.extLevel[sc.prey]).toBe(THREAT.flee);
    // It charged down the Edmontosaurus (against Triceratops prey it would have pulled up at the stand-off).
    expect(tr.minMember).toBeLessThan(d0 - 80);
    expect(tr.minMember).toBeLessThan(K.FACE_STANDOFF_M - 40);
    expect(herds.active[tri]).toBe(1);
  });
});

describe('ambient T. rex: the prey goes away mid-hunt', () => {
  function until(sc: Scene, state: number, max = 140): number {
    const ac: AircraftView = { n: 0, e: 0, alt: 0, vN: 0, vE: 0, vD: 0, tas: 0 };
    for (let f = 1; f <= Math.round(max / DT); f++) {
      passAt(f * DT, sc, ac);
      sc.terrain.calls = 0;
      sc.herds.step(DT, ac, sc.terrain, HERD_BUDGET, ac.n, ac.e);
      sc.pool.step(DT, ac, sc.terrain, sc.river);
      if (sc.pool.state[sc.rex] === state) return f * DT;
    }
    return Number.NaN;
  }

  it.each([
    ['released during the charge', S.charge, false],
    ['its slot reused by another herd during the stalk', S.stalk, true],
  ])('%s: no stale target, no NaN; it goes home and re-picks', (_n, at, reuse) => {
    const terrain = flatTerrain();
    const sc = scene(terrain, false);
    const { herds, pool, rex } = sc;
    expect(until(sc, at)).toBeGreaterThan(0);
    const old = sc.prey;
    herds.release(old);
    const nn = AWAY.north + 700;
    const ne = AWAY.east - 300;
    if (!reuse) {
      // The slot merely inactive (nothing spawned into it yet): the very next frame it has given up the hunt (no
      // charge toward a herd that is gone), and it stays off it while the slot stays empty.
      expect(herds.active[old]).toBe(0);
      for (let f = 1; f <= 60; f++) {
        terrain.calls = 0;
        herds.step(DT, null, terrain, HERD_BUDGET, nn, ne);
        pool.step(DT, null, terrain, -1);
        expect(pool.state[rex]).toBe(S.wander);
        expect(Number.isFinite(pool.n[rex]) && Number.isFinite(pool.e[rex]) && Number.isFinite(pool.yaw[rex])).toBe(true);
      }
    }
    // A new herd elsewhere: in the same slot at once (a new seed), or after the release has been seen (HerdPool
    // takes the first free slot, so this may be the old slot too).
    const fresh = spawnHerd(herds, 'edmontosaurus', nn, ne, sc.ground, 25, false, 0xfeed);
    if (reuse) expect(fresh).toBe(old);
    const ac: AircraftView = { n: 0, e: 0, alt: 0, vN: 0, vE: 0, vD: 0, tas: 0 };
    let sawWander = !reuse;
    let threatenedFresh = false;
    for (let f = 1; f <= Math.round(900 / DT); f++) {
      terrain.calls = 0;
      herds.step(DT, null, terrain, HERD_BUDGET, nn, ne);
      pool.step(DT, null, terrain, -1);
      if (f === 1) {
        // The very next frame it has given up the hunt (no charge or stalk toward a herd that is gone).
        expect(pool.state[rex]).toBe(S.wander);
      }
      if (pool.state[rex] === S.wander) sawWander = true;
      if (herds.extUntil[fresh] > -Infinity) threatenedFresh = true;
      expect(Number.isFinite(pool.n[rex]) && Number.isFinite(pool.e[rex]) && Number.isFinite(pool.yaw[rex])).toBe(true);
    }
    expect(sawWander).toBe(true);
    // The lost hunt's threat never moves on to the new herd (no aircraft: no new hunt).
    expect(threatenedFresh).toBe(false);
    // It re-picked the new herd and shadows it.
    expect(pool.state[rex]).toBe(S.lurk);
    const d = Math.hypot(herds.cN[fresh] - pool.n[rex], herds.cE[fresh] - pool.e[rex]);
    expect(d).toBeGreaterThanOrEqual(K.SHADOW_NEAR - 5);
    expect(d).toBeLessThanOrEqual(K.SHADOW_FAR + 5);
    // And hunts it on the next pass.
    sc.prey = fresh;
    const tr = fly(sc, 140);
    expect(tr.charge).toBeGreaterThan(0);
    expect(herds.extLevel[fresh]).toBe(THREAT.flee);
  });
});

describe('ambient T. rex: shadowing', () => {
  it('keeps a wandering herd 220-450 m away over 10 min', () => {
    const terrain = flatTerrain();
    const sc = scene(terrain, false, 'edmontosaurus', 30);
    const { herds, pool, rex, prey } = sc;
    let lo = Infinity;
    let hi = 0;
    let moved = 0;
    let walked = 0;
    for (let f = 1; f <= Math.round(600 / DT); f++) {
      terrain.calls = 0;
      herds.step(DT, null, terrain, HERD_BUDGET, herds.cN[prey], herds.cE[prey]);
      pool.step(DT, null, terrain, -1);
      const d = Math.hypot(herds.cN[prey] - pool.n[rex], herds.cE[prey] - pool.e[rex]);
      lo = Math.min(lo, d);
      hi = Math.max(hi, d);
      moved = Math.max(moved, Math.hypot(herds.cN[prey] - AWAY.north, herds.cE[prey] - AWAY.east));
      walked += pool.speed[rex] * DT;
      expect(pool.state[rex]).toBe(S.lurk);
    }
    // The herd really roamed, and the T. rex followed it.
    expect(moved).toBeGreaterThan(150);
    expect(walked).toBeGreaterThan(50);
    expect(lo).toBeGreaterThanOrEqual(220);
    expect(hi).toBeLessThanOrEqual(450);
  });
});

// ------------------------------------------------------------------------------------------------ the scripted beat

/** FNV-1a 32-bit over the lines joined by '\n' (hex). */
function traceHash(lines: string[]): string {
  const s = lines.join('\n');
  let h = 0x811c9dc5;
  for (let k = 0; k < s.length; k++) {
    h ^= s.charCodeAt(k);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/**
 * The scripted lair beat over a whole cycle (150 s: stalk, charge, roar, wander home, lurk, the rearm), the river
 * herd and the Triceratops group included, on a flat terrain: hashed with the brain of feat/deep-time-2 at 4f85c4f
 * (before the ambient hunt; the same test run against that tree). Never update it to make a change pass.
 */
const SCRIPTED_CYCLE_HASH_4F85C4F = 'a7c5f54d';

describe('the scripted T. rex is unchanged', () => {
  it('the lair beat with the river herd: the 150 s cycle hashes to the pre-inc-2b value', () => {
    const g = Anchors.RIVER_HERD_SITE.ground;
    const terrain = flatTerrain(g);
    const herds = new HerdPool();
    const R = Anchors.RIVER_HERD_SITE;
    const river = herds.spawn({ north: R.north, east: R.east, ground: R.ground, size: RIVER_HERD_SIZE, entry: 0, scale: 1, variant: 0, seed: 0x5ca1ab1e, heading: R.heading, pinned: true, species: 'edmontosaurus' }, -1);
    const T = Anchors.TRICERATOPS_GROUP;
    const tri = herds.spawn({ north: T.north, east: T.east, ground: T.ground, size: 7, entry: 1, scale: 1, variant: 0, seed: 0x7c1e7a, heading: T.heading, pinned: true, species: 'triceratops' }, -1);
    const pool = new SoloAgentPool(herds, terrain, Anchors);
    const L = Anchors.TREX_LAIR;
    pool.spawn({ species: 'tyrannosaurus', entry: 2, north: L.north, east: L.east, ground: L.ground, heading: L.heading, scale: 1, variant: 0, seed: 0x7e3a11 }, TYRANNOSAURUS_BRAIN);
    const hd = Anchors.safariHeading();
    const AT = { north: 0, east: 0, alt: 0 };
    const ac: AircraftView = { n: 0, e: 0, alt: 0, vN: 0, vE: 0, vD: 0, tas: 56.6 };
    const lines: string[] = [];
    const states = new Set<number>();
    for (let f = 1; f <= Math.round(150 / DT); f++) {
      const t = f * DT;
      // The safari's first 20 s, then the aircraft circles 1.5 km out (it keeps the T. rex armed for a second hunt).
      if (t <= 20) Anchors.safariAt(t, AT);
      else {
        const a = (t - 20) * 0.04;
        AT.north = R.north + 1500 * Math.cos(a);
        AT.east = R.east + 1500 * Math.sin(a);
      }
      ac.n = AT.north;
      ac.e = AT.east;
      ac.alt = R.ground + 150;
      ac.vN = 56 * Math.cos(hd);
      ac.vE = 56 * Math.sin(hd);
      terrain.calls = 0;
      herds.step(DT, ac, terrain, HERD_BUDGET, ac.n, ac.e);
      pool.step(DT, ac, terrain, river);
      states.add(pool.state[0]);
      if (f % 30 === 0) lines.push(`${t.toFixed(2)} ${pool.state[0]} ${pool.n[0].toFixed(4)} ${pool.e[0].toFixed(4)} ${pool.yaw[0].toFixed(5)} ${pool.speed[0].toFixed(4)} ${pool.flap[0].toFixed(3)} ${pool.head[0].toFixed(4)} ${herds.fleeing[river]} ${herds.cN[river].toFixed(3)} ${herds.cE[river].toFixed(3)} ${herds.fleeing[tri]} ${herds.react[tri]} ${herds.extUntil[tri].toFixed(3)}`);
    }
    expect(states.size).toBe(5);
    expect(traceHash(lines)).toBe(SCRIPTED_CYCLE_HASH_4F85C4F);
  });
});
