// External threats (Deep Time inc 2, WP0b): setExternalThreat and its precedence over the aircraft, and the
// three reaction kinds (flee / face / ignore) on a flat plain.

import { describe, expect, it } from 'vitest';
import { makeSample, type TerrainSample } from '../../src/world/terrain/heightfield';
import type { FaunaTerrain } from '../../src/world/fauna/habitat';
import { ALARM, HerdPool, REACTION_KIND, type AircraftView } from '../../src/world/fauna/herds';
import { PROFILES } from '../../src/world/fauna/profiles';
import { THREAT, externalFleeDirection } from '../../src/world/fauna/reactions';
import type { FaunaSpeciesId } from '../../src/world/fauna/types';

const DT = 1 / 60;
const G = 100;

function flat(): FaunaTerrain {
  const t = {
    calls: 0,
    sample(_n: number, _e: number, out: TerrainSample): TerrainSample {
      t.calls++;
      Object.assign(out, makeSample());
      out.ground = G;
      out.standing = -1000;
      return out;
    },
    height(): number {
      t.calls++;
      return G;
    },
  };
  return t;
}

function herd(species: FaunaSpeciesId = 'edmontosaurus', size = 30): { pool: HerdPool; h: number; terrain: FaunaTerrain } {
  const pool = new HerdPool();
  const h = pool.spawn({ north: 0, east: 0, ground: G, size, entry: 0, scale: 1, variant: 0, seed: 4242, heading: 0, pinned: true, species }, -1);
  const terrain = flat();
  // Settle into the formation.
  for (let k = 0; k < 120; k++) pool.step(DT, null, terrain, 10000, 0, 0);
  return { pool, h, terrain };
}

const run = (pool: HerdPool, terrain: FaunaTerrain, seconds: number, ac: AircraftView | null = null, onStep?: () => void): void => {
  for (let k = 0; k < Math.round(seconds / DT); k++) {
    onStep?.();
    pool.step(DT, ac, terrain, 10000, 0, 0);
  }
};

const members = (pool: HerdPool, h: number): number[] => Array.from({ length: pool.size[h] }, (_, k) => h * pool.memberCap + k);

describe('external threats', () => {
  it('a flee threat 150 m west of a grazing Edmontosaurus herd sends it east within 3 s, the wave from the west edge', () => {
    const { pool, h, terrain } = herd();
    expect(pool.kind[h]).toBe(REACTION_KIND.flee);
    const t0 = pool.time;
    expect(pool.setExternalThreat(h, 0, -150, 0, 0, t0 + 20, THREAT.flee)).toBe(true);
    run(pool, terrain, 0.15);
    expect(pool.fleeing[h]).toBe(1);
    // The wave starts at the edge nearest the source: the westernmost members are alarmed first.
    const ids = members(pool, h);
    const byEast = [...ids].sort((a, b) => pool.mE[a] - pool.mE[b]);
    const west = byEast.slice(0, 5).reduce((s, i) => s + pool.fleeT0[i], 0) / 5;
    const east = byEast.slice(-5).reduce((s, i) => s + pool.fleeT0[i], 0) / 5;
    expect(west).toBeLessThan(east);
    // The members nearest the source are off at once (the wave starts at the nearest member).
    expect(Math.min(...ids.map((i) => pool.fleeT0[i])) - t0).toBeLessThan(0.5);
    run(pool, terrain, 2.85);
    let vE = 0;
    let vN = 0;
    let running = 0;
    for (const i of ids) {
      vE += Math.sin(pool.yaw[i]) * pool.speed[i];
      vN += Math.cos(pool.yaw[i]) * pool.speed[i];
      if (pool.speed[i] > 1.5) running++;
    }
    // Within 3 s the west side is running (the wave crosses the ~75 m wide herd at 15 m/s) ...
    expect(running).toBeGreaterThan(ids.length * 0.25);
    // ... east: the mean run within 30 deg of due east.
    expect(Math.abs(Math.atan2(vN, vE))).toBeLessThan((30 * Math.PI) / 180);
    // And by 7 s the whole herd runs east.
    run(pool, terrain, 4);
    const east7 = ids.filter((i) => pool.speed[i] > 1.5 && Math.sin(pool.yaw[i]) > 0.7).length;
    expect(east7).toBeGreaterThan(ids.length * 0.9);
  });

  it('a later aircraft flee threat does not re-aim an active external flee, but escalates the members still waiting', () => {
    const { pool, h, terrain } = herd('edmontosaurus', 60);
    pool.setExternalThreat(h, 0, -150, 0, 0, pool.time + 20, THREAT.flee);
    run(pool, terrain, 0.12);
    const ids = members(pool, h);
    const waiting = ids.filter((i) => pool.fleeT0[i] > pool.time + 0.3);
    expect(waiting.length).toBeGreaterThan(3);
    // The aircraft low and closing from the east, flying west along the herd's east-west axis: on its own it
    // would split the herd north and south of its track.
    const ac: AircraftView = { n: 5, e: 200, alt: G + 60, vN: 0, vE: -50, vD: 0, tas: 50 };
    run(pool, terrain, 0.25, ac, () => (ac.e -= 50 * DT));
    // Escalated: every member is running now.
    for (const i of waiting) expect(pool.fleeT0[i]).toBeLessThanOrEqual(pool.time);
    // Not re-aimed: the flee directions still point east, away from the source.
    for (const i of ids) expect(pool.fleeDE[i]).toBeGreaterThan(0.6);
    expect(pool.externalFlee(h)).toBe(true);
  });

  it('an external flee takes over the wave of a herd the aircraft has already alarmed (origin and timing)', () => {
    const { pool, h, terrain } = herd('edmontosaurus', 60);
    // The aircraft alarms the herd first, low and closing from the east.
    const ac: AircraftView = { n: 0, e: 200, alt: G + 60, vN: 0, vE: -50, vD: 0, tas: 50 };
    run(pool, terrain, 10 * DT, ac, () => (ac.e -= 50 * DT));
    expect(pool.fleeing[h]).toBe(1);
    expect(pool.externalFlee(h)).toBe(false);
    const ids = members(pool, h);
    const before = ids.map((i) => pool.fleeT0[i]);
    // Then a predator to the west.
    const now = pool.time;
    expect(pool.setExternalThreat(h, 0, -150, 0, 0, now + 20, THREAT.flee)).toBe(true);
    run(pool, terrain, 0.15);
    expect(pool.externalFlee(h)).toBe(true);
    // The wave now starts at the member nearest the predator (it is off at once) ...
    const near = pool.nearestMember(h, 0, -150);
    expect(pool.fleeT0[near] - now).toBeLessThan(0.5);
    // ... no member starts later than the aircraft's wave had it, and the west side starts earlier.
    ids.forEach((i, k) => expect(pool.fleeT0[i]).toBeLessThanOrEqual(before[k]));
    const sooner = ids.filter((i, k) => pool.fleeT0[i] < before[k] - 0.5);
    expect(sooner.length).toBeGreaterThan(3);
    for (const i of sooner) expect(pool.mE[i]).toBeLessThan(pool.herdCentroid(h, { north: 0, east: 0, ground: 0 }).east + 20);
    // And the direction is the predator's: east, away from it.
    for (const i of ids) expect(pool.fleeDE[i]).toBeGreaterThan(0.6);
    // Repeated calls (moving / extending the threat) do not restart the wave.
    const after = ids.map((i) => pool.fleeT0[i]);
    pool.setExternalThreat(h, 0, -140, 0, 0, now + 25, THREAT.flee);
    run(pool, terrain, 0.15);
    ids.forEach((i, k) => expect(pool.fleeT0[i]).toBe(after[k]));
  });

  it("a 'face' herd that bolted from a predator stops and faces the aircraft once the predator has gone", () => {
    const { pool, h, terrain } = herd('triceratops', 7);
    // A predator right on top of the group: it runs.
    pool.setExternalThreat(h, 0, -60, 0, 0, pool.time + 2, THREAT.flee);
    run(pool, terrain, 2.5);
    expect(pool.externalFlee(h)).toBe(false);
    expect(pool.react[h]).toBe(ALARM.run);
    const ids = members(pool, h);
    expect(ids.some((i) => pool.speed[i] > 2)).toBe(true);
    // The aircraft now: low, closing from the north-east of where the group has run to.
    const c = pool.herdCentroid(h, { north: 0, east: 0, ground: 0 });
    const ac: AircraftView = { n: c.north + 250, e: c.east + 250, alt: G + 50, vN: -35, vE: -35, vD: 0, tas: 50 };
    run(pool, terrain, 2, ac, () => {
      ac.n -= 35 * DT;
      ac.e -= 35 * DT;
    });
    expect(pool.react[h]).toBe(ALARM.face);
    run(pool, terrain, 4);
    expect(pool.fleeing[h]).toBe(1);
    for (const i of ids) {
      expect(pool.speed[i]).toBeLessThan(0.2);
      const want = Math.atan2(pool.faceE[h] - pool.mE[i], pool.faceN[h] - pool.mN[i]);
      expect(Math.abs(((pool.yaw[i] - want + 3 * Math.PI) % (2 * Math.PI)) - Math.PI)).toBeLessThan((35 * Math.PI) / 180);
    }
  });

  it("a 'face' herd stops running once the predator is beyond predatorFleeRange", () => {
    const { pool, h, terrain } = herd('triceratops', 7);
    pool.setExternalThreat(h, 0, -60, 0, 0, pool.time + 30, THREAT.flee);
    run(pool, terrain, 2);
    expect(pool.react[h]).toBe(ALARM.run);
    // The predator backs off to 400 m (the threat still active).
    pool.setExternalThreat(h, 0, -400, 0, 0, pool.time + 30, THREAT.flee);
    run(pool, terrain, 6);
    expect(pool.react[h]).toBe(ALARM.face);
    for (const i of members(pool, h)) expect(pool.speed[i]).toBeLessThan(0.2);
  });

  it('after untilT the aircraft rules apply again', () => {
    const { pool, h, terrain } = herd();
    pool.setExternalThreat(h, 0, -150, 0, 0, pool.time + 1, THREAT.flee);
    run(pool, terrain, 1.5);
    expect(pool.externalFlee(h)).toBe(false);
    // The aircraft low over the herd's east side heading north: members flee west, away from its track.
    const ac: AircraftView = { n: -250, e: 60, alt: G + 60, vN: 50, vE: 0, vD: 0, tas: 50 };
    run(pool, terrain, 1.0, ac, () => (ac.n += 50 * DT));
    const ids = members(pool, h);
    const west = ids.filter((i) => pool.fleeDE[i] < 0).length;
    expect(west).toBeGreaterThan(ids.length * 0.8);
    expect(pool.trackVN[h]).toBeCloseTo(50, 3);
  });

  it("a 'face' herd (Triceratops) ends facing the source, within 30 deg, stopped", () => {
    const { pool, h, terrain } = herd('triceratops', 7);
    expect(pool.kind[h]).toBe(REACTION_KIND.face);
    // 260 m north-east: beyond the herd's predatorFleeRange.
    const sn = 260 * Math.cos(Math.PI / 4);
    const se = 260 * Math.sin(Math.PI / 4);
    expect(Math.hypot(sn, se) - pool.herdRadius(h)).toBeGreaterThan(PROFILES.triceratops.reaction.predatorFleeRange);
    pool.setExternalThreat(h, sn, se, 0, 0, pool.time + 20, THREAT.flee);
    run(pool, terrain, 8);
    expect(pool.fleeing[h]).toBe(1);
    expect(pool.react[h]).toBe(ALARM.face);
    const ids = members(pool, h);
    let facing = 0;
    for (const i of ids) {
      const want = Math.atan2(se - pool.mE[i], sn - pool.mN[i]);
      const d = Math.abs(((pool.yaw[i] - want + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
      if (d < (30 * Math.PI) / 180) facing++;
      expect(pool.speed[i]).toBeLessThan(0.2);
      expect(pool.alert[i]).toBeGreaterThan(0.9);
    }
    expect(facing).toBe(ids.length);
  });

  it("a 'face' herd runs after all when the predator is inside predatorFleeRange", () => {
    const { pool, h, terrain } = herd('triceratops', 7);
    pool.setExternalThreat(h, 0, -60, 0, 0, pool.time + 20, THREAT.flee);
    run(pool, terrain, 3);
    expect(pool.react[h]).toBe(ALARM.run);
    expect(members(pool, h).some((i) => pool.speed[i] > 2)).toBe(true);
  });

  it("an 'ignore' herd (Alamosaurus) only turns its heads", () => {
    const { pool, h, terrain } = herd('alamosaurus', 3);
    expect(pool.kind[h]).toBe(REACTION_KIND.ignore);
    const before = members(pool, h).map((i) => [pool.mN[i], pool.mE[i]]);
    pool.setExternalThreat(h, 0, -200, 0, 0, pool.time + 20, THREAT.flee);
    run(pool, terrain, 4);
    expect(pool.fleeing[h]).toBe(0);
    members(pool, h).forEach((i, k) => {
      // Never runs, never freezes in alarm: stays near where it was, alert channel down.
      expect(Math.hypot(pool.mN[i] - before[k][0], pool.mE[i] - before[k][1])).toBeLessThan(6);
      expect(pool.alert[i]).toBeLessThan(0.1);
    });
    // Heads toward the source (west, to the left of a north-facing animal).
    expect(members(pool, h).filter((i) => pool.head[i] < -0.3).length).toBeGreaterThanOrEqual(2);
  });

  it('an external ALERT raises heads toward the source and stills a flee herd, without a flight', () => {
    const { pool, h, terrain } = herd();
    pool.setExternalThreat(h, 300, 0, 0, 0, pool.time + 10, THREAT.alert);
    run(pool, terrain, 2);
    expect(pool.fleeing[h]).toBe(0);
    const ids = members(pool, h);
    expect(ids.filter((i) => pool.alert[i] > 0.8).length).toBe(ids.length);
  });

  it('externalFleeDirection runs straight away from the source, leaning into its heading with lead', () => {
    const out = { n: 0, e: 0 };
    externalFleeDirection(0, 100, 0, 0, 0, 0, 0, out);
    expect(out.n).toBeCloseTo(0, 6);
    expect(out.e).toBeCloseTo(1, 6);
    externalFleeDirection(0, 100, 0, 0, 8, 0, 0.5, out);
    expect(out.n).toBeGreaterThan(0.5);
    expect(Math.hypot(out.n, out.e)).toBeCloseTo(1, 6);
    // On top of the source: along its heading.
    externalFleeDirection(0, 0, 0, 0, 0, 8, 0, out);
    expect(out.e).toBeCloseTo(1, 6);
  });

  it('herdCentroid, herdRadius and nearestMember', () => {
    const { pool, h } = herd();
    const c = pool.herdCentroid(h, { north: 0, east: 0, ground: 0 });
    expect(c.ground).toBeCloseTo(G, 6);
    expect(pool.herdRadius(h)).toBeGreaterThan(10);
    const i = pool.nearestMember(h, 0, -500);
    for (const j of members(pool, h)) expect(pool.mE[i]).toBeLessThanOrEqual(pool.mE[j] + 1e-9 + Math.abs(pool.mN[j] - pool.mN[i]));
    expect(pool.nearestMember(23, 0, 0)).toBe(-1);
    expect(pool.setExternalThreat(23, 0, 0, 0, 0, 1, THREAT.flee)).toBe(false);
  });

  it('a pinned herd beyond NEAR_SNAP_M takes <= 2 terrain reads per brain tick (walking or grazing)', () => {
    const pool = new HerdPool();
    const h = pool.spawn({ north: 0, east: 0, ground: G, size: 3, entry: 0, scale: 1, variant: 0, seed: 9, heading: 0, pinned: true, species: 'alamosaurus' }, -1);
    const terrain = flat();
    let ticks = 0;
    let walked = false;
    for (let k = 0; k < 60 * 400; k++) {
      terrain.calls = 0;
      pool.step(DT, null, terrain, 10000, 15000, 0);
      expect(terrain.calls).toBeLessThanOrEqual(2 * pool.ticks);
      ticks += pool.ticks;
      walked ||= pool.mode[h] === 1;
    }
    expect(ticks).toBeGreaterThan(1000);
    expect(walked).toBe(true);
  });
});
