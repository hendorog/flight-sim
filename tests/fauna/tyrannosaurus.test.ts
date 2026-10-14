// Tyrannosaurus rex (Deep Time inc 2, WP1): the theropod pose through its CPU mirror (no foot slip at walk and
// charge, the jaw opens on the roar) and the brain on the scripted safari (stalk, charge, the river herd's flee,
// the roar; deterministic, allocation-free, within the agents' terrain reserve, the flee 30-60 deg off the track).

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as Anchors from '../../src/world/era/cretaceousAnchors';
import { SoloAgentPool } from '../../src/world/fauna/agents';
import { countingTerrain, type FaunaTerrain } from '../../src/world/fauna/habitat';
import { ALARM, HerdPool, type AircraftView } from '../../src/world/fauna/herds';
import { AGENT_RESERVE, FLYER_RESERVE, TERRAIN_CALLS_PER_FRAME } from '../../src/world/fauna/presets';
import { PROFILES } from '../../src/world/fauna/profiles';
import { THREAT } from '../../src/world/fauna/reactions';
import { RIVER_HERD_SIZE } from '../../src/world/fauna/showcase';
import { buildFaunaSpecies } from '../../src/world/fauna/species/index';
import { TREX_STATE, TYRANNOSAURUS_BRAIN } from '../../src/world/fauna/species/tyrannosaurus.brain';
import { TYRANNOSAURUS_ROAR_GAPE } from '../../src/world/fauna/species/tyrannosaurus';
import { BONE } from '../../src/world/fauna/types';
import { makeSample, sampleTerrain } from '../../src/world/terrain/heightfield';
import { SOLE_POINTS, footPoint, theropodFoot, theropodLegIK, theropodPositions } from './theropodPoseMirror';
import { THEROPOD_GAIT, THEROPOD_LEG } from '../../src/world/fauna/poses/theropod';
import { era, setEra } from '../../src/world/era/eraState';

// The Cretaceous world (terrain with the volcano, environment, flora): createFaunaSystem's era only picks the roster.
beforeAll(() => {
  setEra('cretaceous');
});
afterAll(() => {
  setEra('present');
});

const DT = 1 / 60;
const rex = buildFaunaSpecies('tyrannosaurus');
const P = PROFILES.tyrannosaurus;

describe('theropod pose (CPU mirror)', () => {
  const hind = [BONE.legHL, BONE.legHR];

  // Gait blend -> (speed, stride): the solo pool's mapping (agents.ts move): blend 1 up to runFrom, then 1 + (v - runFrom) / runSpan.
  const cases: [string, number, number][] = [
    ['walk', 1, P.speed.walk],
    ['charge', 2, P.speed.run],
  ];
  it.each(cases)('%s: the planted foot does not slip (< 0.15 m/s) and stays on the ground', (_name, gaitBlend, v) => {
    const run = Math.max(0, gaitBlend - 1);
    const stride = P.strideM.walk + (P.strideM.run - P.strideM.walk) * run;
    const duty = THEROPOD_GAIT.dutyWalk + (THEROPOD_GAIT.dutyRun - THEROPOD_GAIT.dutyWalk) * run;
    const rate = v / stride; // cycles per second
    const dph = 1 / 400;
    let worst = 0;
    let samples = 0;
    for (const bone of hind) {
      const legOff = bone === BONE.legHL ? 0 : 0.5;
      // Stance only, away from touch-down and lift-off.
      for (let k = 2; k < 38; k++) {
        const lp = (duty * k) / 40;
        const ph = lp - legOff;
        for (const sp of SOLE_POINTS) {
          const a = footPoint({ phase: ph, gaitBlend, flap: 0 }, bone, sp);
          const b = footPoint({ phase: ph + dph, gaitBlend, flap: 0 }, bone, sp);
          // In the world the body moves forward at v: the planted point's world velocity is its body velocity + v.
          const vx = ((b[0] - a[0]) / dph) * rate + v;
          const vy = ((b[1] - a[1]) / dph) * rate;
          worst = Math.max(worst, Math.hypot(vx, vy));
          expect(Math.abs(a[1])).toBeLessThan(0.03);
          samples++;
        }
      }
    }
    expect(samples).toBeGreaterThan(100);
    expect(worst).toBeLessThan(0.15);
  });

  it('keeps the IK within reach at every phase of every gait (no clamped, sliding leg)', () => {
    for (const gb of [0, 0.5, 1, 1.25, 1.5, 1.75, 2]) {
      const move = Math.min(1, gb);
      const run = Math.max(0, gb - 1);
      const walk = move - run;
      const stride = P.strideM.walk + (P.strideM.run - P.strideM.walk) * run;
      const duty = THEROPOD_GAIT.dutyWalk + (THEROPOD_GAIT.dutyRun - THEROPOD_GAIT.dutyWalk) * run;
      for (let k = 0; k < 64; k++) {
        const ph = k / 64;
        const G = THEROPOD_GAIT;
        const drop = G.dropIdle * (1 - move) + G.dropWalk * walk + G.dropRun * run;
        const bob = -(G.bobWalk * walk + G.bobRun * run) * Math.cos(12.566371 * (ph - 0.5 * duty));
        for (const side of [1, -1]) {
          const { reach } = theropodLegIK(theropodFoot(ph, side, move, run, stride), bob - drop);
          expect(reach).toBeLessThan(THEROPOD_LEG.L1 + THEROPOD_LEG.L2 - 0.02);
          expect(reach).toBeGreaterThan(1.0);
        }
      }
    }
  });

  it('no foot sinks below the ground at any gait (whole posed legs)', () => {
    const legs = (b: number): boolean => b === BONE.legHL || b === BONE.legHR;
    for (const gaitBlend of [0, 1, 1.5, 2]) {
      for (let k = 0; k < 8; k++) {
        const p = theropodPositions(rex, rex.lod1, { phase: k / 8, gaitBlend, flap: 0 }, legs);
        expect(Math.min(...p.map((v) => v[1]))).toBeGreaterThan(-0.06);
      }
    }
  });

  it('opens the jaw on the roar (35 deg) and lifts the head', () => {
    const jaw = (b: number): boolean => b === BONE.jaw;
    const chin = (flap: number): [number, number, number] => theropodPositions(rex, rex.lod0, { phase: 0, gaitBlend: 0, flap }, jaw).reduce((m, p) => (p[0] > m[0] ? p : m));
    const shut = chin(0);
    const open = chin(1);
    // The chin drops (relative to the skull, which itself rises with the head): ~0.75 m at 35 deg over ~1.3 m.
    const head = (b: number): boolean => b === BONE.head;
    const snout = (flap: number): [number, number, number] => theropodPositions(rex, rex.lod0, { phase: 0, gaitBlend: 0, flap }, head).reduce((m, p) => (p[0] > m[0] ? p : m));
    const gapShut = snout(0)[1] - shut[1];
    const gapOpen = snout(1)[1] - open[1];
    expect(gapOpen - gapShut).toBeGreaterThan(0.45);
    expect(snout(1)[1]).toBeGreaterThan(snout(0)[1] + 0.3);
    expect(TYRANNOSAURUS_ROAR_GAPE).toBeCloseTo((35 * Math.PI) / 180, 6);
  });
});

// ------------------------------------------------------------------------------------------------ the brain

interface Trace {
  stalk: number;
  charge: number;
  fleeSet: number;
  roar: number;
  faceSet: number;
  /** The Triceratops herd ran (ALARM.run) at any time while alarmed in the first 25 s. */
  triRan: boolean;
  fleeBearing: number;
  maxAgentReads: number;
  /** Closest the T. rex came to the river channel's edge (m; negative = in the water), sampled every 0.5 s. */
  riverClear: number;
  lines: string[];
}

/**
 * A flat, dry terrain at the river herd's ground that does not allocate (the real terrain allocates internally;
 * the allocation test measures the brain and the pool, not the terrain).
 */
function flatTerrain(): FaunaTerrain {
  const g = Anchors.RIVER_HERD_SITE.ground;
  const t: FaunaTerrain = {
    calls: 0,
    sample: (_n, _e, out) => {
      t.calls++;
      out.ground = g;
      out.standing = -1000;
      out.river = -Infinity;
      out.riverDist = Infinity;
      out.riverHalfWidth = 0;
      return out;
    },
    height: () => {
      t.calls++;
      return g;
    },
  };
  return t;
}

function setup(terrain: FaunaTerrain): { herds: HerdPool; pool: SoloAgentPool; river: number; tri: number } {
  const herds = new HerdPool();
  const R = Anchors.RIVER_HERD_SITE;
  const river = herds.spawn({ north: R.north, east: R.east, ground: R.ground, size: RIVER_HERD_SIZE, entry: 0, scale: 1, variant: 0, seed: 0x5ca1ab1e, heading: R.heading, pinned: true, species: 'edmontosaurus' }, -1);
  const T = Anchors.TRICERATOPS_GROUP;
  const tri = herds.spawn({ north: T.north, east: T.east, ground: T.ground, size: 7, entry: 1, scale: 1, variant: 0, seed: 0x7c1e7a, heading: T.heading, pinned: true, species: 'triceratops' }, -1);
  const pool = new SoloAgentPool(herds, terrain, Anchors);
  const L = Anchors.TREX_LAIR;
  pool.spawn({ species: 'tyrannosaurus', entry: 2, north: L.north, east: L.east, ground: L.ground, heading: L.heading, scale: 1, variant: 0, seed: 0x7e3a11 }, TYRANNOSAURUS_BRAIN);
  return { herds, pool, river, tri };
}

const hd = Anchors.safariHeading();
const WS = makeSample();
const AT = { north: 0, east: 0, alt: 0 };
function aircraftAt(t: number, ac: AircraftView): AircraftView {
  Anchors.safariAt(t, AT);
  ac.n = AT.north;
  ac.e = AT.east;
  ac.alt = AT.alt;
  const gs = Anchors.SAFARI_FLIGHT.groundSpeed;
  ac.vN = gs * Math.cos(hd);
  ac.vE = gs * Math.sin(hd);
  ac.vD = 0;
  ac.tas = 56.6;
  return ac;
}

/** Fly the safari for `seconds` with the herds and the T. rex as FaunaSystem steps them (herds, then agents). */
function runSafari(seconds: number, terrain: FaunaTerrain = flatTerrain()): Trace {
  const { herds, pool, river, tri } = setup(terrain);
  const tr: Trace = { stalk: NaN, charge: NaN, fleeSet: NaN, roar: NaN, faceSet: NaN, triRan: false, fleeBearing: NaN, maxAgentReads: 0, riverClear: Infinity, lines: [] };
  const ac: AircraftView = { n: 0, e: 0, alt: 0, vN: 0, vE: 0, vD: 0, tas: 0 };
  const frames = Math.round(seconds / DT);
  for (let f = 1; f <= frames; f++) {
    const t = f * DT;
    aircraftAt(t, ac);
    terrain.calls = 0;
    herds.step(DT, ac, terrain, TERRAIN_CALLS_PER_FRAME - FLYER_RESERVE - AGENT_RESERVE, ac.n, ac.e);
    const reads = pool.step(DT, ac, terrain, river);
    tr.maxAgentReads = Math.max(tr.maxAgentReads, reads);
    const s = pool.state[0];
    if (s === TREX_STATE.stalk && Number.isNaN(tr.stalk)) tr.stalk = t;
    if (s === TREX_STATE.charge && Number.isNaN(tr.charge)) tr.charge = t;
    if (s === TREX_STATE.roar && Number.isNaN(tr.roar)) tr.roar = t;
    if (herds.fleeing[river] && Number.isNaN(tr.fleeSet)) tr.fleeSet = t;
    if (herds.fleeing[tri] && Number.isNaN(tr.faceSet)) tr.faceSet = t;
    if (herds.fleeing[tri] && t < 25 && herds.react[tri] === ALARM.run) tr.triRan = true;
    // The stampede's direction while the external flee owns it (~12 s), off the track heading (+ right).
    if (Number.isNaN(tr.fleeBearing) && t >= 12 && herds.fleeing[river]) {
      let sn = 0;
      let se = 0;
      const base = river * herds.memberCap;
      for (let k = 0; k < herds.size[river]; k++) {
        sn += herds.fleeDN[base + k];
        se += herds.fleeDE[base + k];
      }
      const b = Math.atan2(se, sn) - hd;
      tr.fleeBearing = (Math.atan2(Math.sin(b), Math.cos(b)) * 180) / Math.PI;
    }
    if (f % 30 === 0) {
      const w = sampleTerrain(pool.n[0], pool.e[0], WS);
      tr.riverClear = Math.min(tr.riverClear, w.riverDist - w.riverHalfWidth);
    }
    if (f % 30 === 0) tr.lines.push(`${t.toFixed(2)} ${s} ${pool.n[0].toFixed(4)} ${pool.e[0].toFixed(4)} ${pool.yaw[0].toFixed(5)} ${pool.speed[0].toFixed(4)} ${pool.flap[0].toFixed(3)} ${pool.head[0].toFixed(4)} ${herds.fleeing[river]} ${herds.cN[river].toFixed(3)} ${herds.cE[river].toFixed(3)}`);
  }
  return tr;
}

// The allocation test runs first: later tests drive the pool with other terrain objects, and the polymorphic
// terrain calls they leave behind box doubles that the game (one terrain) never sees.
const proc = (globalThis as unknown as { process: { memoryUsage(): { heapUsed: number } } }).process;

describe('T. rex brain allocation', () => {
  it('steps 1000 frames through every state without allocating', () => {
    const terrain = flatTerrain();
    const { herds, pool, river } = setup(terrain);
    // A fixed aircraft 900 m from the herd: stalk -> charge -> roar -> wander -> lurk (re-armed) cycles.
    const ac: AircraftView = { n: Anchors.RIVER_HERD_SITE.north + 900, e: Anchors.RIVER_HERD_SITE.east, alt: 300, vN: 0, vE: -50, vD: 0, tas: 50 };
    const states = new Set<number>();
    const step = (): void => {
      terrain.calls = 0;
      pool.step(DT, ac, terrain, river);
    };
    // Warm up (JIT) over the beat, with the herds running so the threats land.
    for (let k = 0; k < 1500; k++) {
      herds.step(DT, ac, terrain, 100, ac.n, ac.e);
      step();
      states.add(pool.state[0]);
    }
    expect(states.has(TREX_STATE.charge) && states.has(TREX_STATE.roar) && states.has(TREX_STATE.wander)).toBe(true);
    expect(herds.extLevel[river]).toBe(THREAT.flee);
    const runs: number[] = [];
    // The first 25 runs warm the JIT up (a once-a-frame brain is optimised late; their numbers are discarded): the
    // median of the last 7 is the measure.
    for (let r = 0; r < 32; r++) {
      // Restart the beat each run so the 1000 measured steps cover the stalk, the charge (threat calls) and the roar.
      pool.release(0);
      const L = Anchors.TREX_LAIR;
      pool.spawn({ species: 'tyrannosaurus', entry: 2, north: L.north, east: L.east, ground: L.ground, heading: L.heading, scale: 1, variant: 0, seed: 0x7e3a11 }, TYRANNOSAURUS_BRAIN);
      const a = proc.memoryUsage().heapUsed;
      for (let k = 0; k < 1000; k++) step();
      if (r >= 25) runs.push((proc.memoryUsage().heapUsed - a) / 1000);
    }
    runs.sort((x, y) => x - y);
    expect(runs[3]).toBeLessThan(8);
  });
});

const flatTerrainShared = flatTerrain();

describe('T. rex brain on the scripted safari', () => {
  let tr: Trace;
  beforeAll(() => {
    tr = runSafari(30);
  });

  it('stalks at boot, charges in [4, 10] s, puts the herd to flight in [5, 12] s and roars in [9, 16] s', () => {
    expect(tr.stalk).toBeGreaterThanOrEqual(0);
    expect(tr.stalk).toBeLessThanOrEqual(3);
    expect(tr.charge).toBeGreaterThanOrEqual(4);
    expect(tr.charge).toBeLessThanOrEqual(10);
    expect(tr.fleeSet).toBeGreaterThanOrEqual(5);
    expect(tr.fleeSet).toBeLessThanOrEqual(12);
    expect(tr.roar).toBeGreaterThanOrEqual(9);
    expect(tr.roar).toBeLessThanOrEqual(16);
  });

  it('makes the Triceratops group face it (they stand: no run)', () => {
    expect(tr.faceSet).toBeGreaterThan(tr.charge);
    expect(tr.faceSet).toBeLessThan(tr.charge + 5);
    // Faced throughout (never ALARM.run: the charge stays outside their predatorFleeRange).
    expect(tr.triRan).toBe(false);
  });

  it('drives the stampede 30-60 deg off the track direction, toward the track side (right)', () => {
    expect(tr.fleeBearing).toBeGreaterThanOrEqual(30);
    expect(tr.fleeBearing).toBeLessThanOrEqual(60);
  });

  it('is deterministic: two runs give identical traces', () => {
    const b = runSafari(30);
    expect(b.lines).toEqual(tr.lines);
    expect(b.lines.length).toBe(60);
  });

  it('keeps within 12 terrain reads per frame and stops at the river (the real terrain)', () => {
    expect(era().id).toBe('cretaceous');
    const real = runSafari(40, countingTerrain());
    expect(real.riverClear).toBeGreaterThan(0);
    expect(real.roar).toBeCloseTo(tr.roar, 0);
    expect(real.maxAgentReads).toBeLessThanOrEqual(AGENT_RESERVE);
    expect(AGENT_RESERVE).toBe(12);
    expect(real.charge).toBeCloseTo(tr.charge, 6);
  });

  it('goes home after the roar and lurks there, rearmed later', () => {
    const { herds, pool, river } = setup(flatTerrain());
    const ac: AircraftView = { n: 0, e: 0, alt: 0, vN: 0, vE: 0, vD: 0, tas: 0 };
    let home = Number.NaN;
    for (let f = 1; f <= Math.round(120 / DT) && Number.isNaN(home); f++) {
      aircraftAt(Math.min(f * DT, 15), ac);
      herds.step(DT, ac, flatTerrainShared, 100, ac.n, ac.e);
      pool.step(DT, ac, flatTerrainShared, river);
      if (f * DT > 20 && pool.state[0] === TREX_STATE.lurk) home = Math.hypot(pool.n[0] - pool.homeN[0], pool.e[0] - pool.homeE[0]);
    }
    expect(home).toBeLessThan(5);
    // It does not stalk again at once (the aircraft is still within range): re-armed only after REARM_S.
    for (let f = 0; f < Math.round(30 / DT); f++) {
      herds.step(DT, ac, flatTerrainShared, 100, ac.n, ac.e);
      pool.step(DT, ac, flatTerrainShared, river);
      expect(pool.state[0]).toBe(TREX_STATE.lurk);
    }
  });
});

