// Herd behaviour (Deep Time WP5): ground contact, the flee reaction and calming down.

import { describe, expect, it } from 'vitest';
import { terrainHeight } from '../../src/world/terrain/heightfield';
import { countingTerrain } from '../../src/world/fauna/habitat';
import { HerdPool, type AircraftView } from '../../src/world/fauna/herds';
import { THREAT, hadrosaurThreat, trackDistance } from '../../src/world/fauna/reactions';
import { riverHerdSite } from '../../src/world/fauna/showcase';

const DT = 1 / 60;

function makeHerd(): { pool: HerdPool; h: number; site: ReturnType<typeof riverHerdSite> } {
  const site = riverHerdSite(countingTerrain());
  const pool = new HerdPool();
  const h = pool.spawn({ north: site.north, east: site.east, ground: site.ground, size: 60, entry: 0, scale: 1, variant: 0, seed: 1234, heading: site.heading, pinned: true }, -1);
  return { pool, h, site };
}

describe('reactions', () => {
  it('flee inside 350 m and below 150 m when closing; alert inside 600 m below 300 m', () => {
    expect(hadrosaurThreat(340, 140, 30, 50)).toBe(THREAT.flee);
    expect(hadrosaurThreat(340, 140, -30, 50)).toBe(THREAT.alert); // going away
    expect(hadrosaurThreat(360, 140, 30, 50)).toBe(THREAT.alert);
    expect(hadrosaurThreat(340, 160, 30, 50)).toBe(THREAT.alert);
    expect(hadrosaurThreat(590, 290, 30, 50)).toBe(THREAT.alert);
    expect(hadrosaurThreat(610, 100, 30, 50)).toBe(THREAT.none);
    expect(hadrosaurThreat(300, 310, 30, 50)).toBe(THREAT.none);
  });
});

describe('herds', () => {
  it('members stand within 0.5 m of the ground after a snap', () => {
    const { pool, h } = makeHerd();
    const terrain = countingTerrain();
    // Run a few seconds (members walk to their slots), then check right after brain ticks.
    for (let k = 0; k < 600; k++) pool.step(DT, null, terrain, 10000, pool.cN[h], pool.cE[h]);
    for (let k = 0; k < 6; k++) pool.step(DT, null, terrain, 10000, pool.cN[h], pool.cE[h]);
    for (let k = 0; k < pool.size[h]; k++) {
      const i = h * pool.memberCap + k;
      expect(Math.abs(pool.mH[i] - terrainHeight(pool.mN[i], pool.mE[i]))).toBeLessThan(0.5);
    }
  });

  it('never exceeds the terrain budget it is given', () => {
    const { pool, h } = makeHerd();
    const terrain = countingTerrain();
    for (let k = 0; k < 300; k++) {
      const used = pool.step(DT, null, terrain, 37, pool.cN[h], pool.cE[h]);
      expect(used).toBeLessThanOrEqual(37);
    }
  });

  it('flees a low pass: away from the ground track, then calms down within 40 s', () => {
    const { pool, h } = makeHerd();
    const terrain = countingTerrain();
    for (let k = 0; k < 120; k++) pool.step(DT, null, terrain, 10000, pool.cN[h], pool.cE[h]);
    // A low pass at 50 m/s, 60 m above the herd, straight over its centre, heading east.
    const ground = pool.cH[h];
    const ac: AircraftView = { n: pool.cN[h], e: pool.cE[h] - 1500, alt: ground + 60, vN: 0, vE: 50, vD: 0, tas: 50 };
    const cN0 = ac.n;
    const cE0 = pool.cE[h];
    const base = h * pool.memberCap;
    const startDist = new Float64Array(pool.size[h]).fill(NaN);
    let lastFleeThreat = -Infinity;
    let fledAt = -1;
    for (let k = 0; k < 60 * 120; k++) {
      ac.e += ac.vE * DT;
      pool.step(DT, ac, terrain, 10000, ac.n, ac.e);
      if (pool.threat[h] === THREAT.flee) lastFleeThreat = pool.time;
      if (pool.fleeing[h] && fledAt < 0) {
        fledAt = pool.time;
        // The alarm started inside the flee envelope.
        const d = Math.hypot(ac.n - cN0, ac.e - cE0, ac.alt - ground) - pool.radius[h];
        expect(d).toBeLessThan(350);
      }
      for (let m = 0; m < pool.size[h]; m++) {
        const i = base + m;
        if (Number.isNaN(startDist[m]) && pool.fleeing[h] && pool.time >= pool.fleeT0[i]) startDist[m] = trackDistance(pool.mN[i], pool.mE[i], cN0, 0, 0, 1);
      }
      if (fledAt > 0 && pool.time - fledAt > 14 && pool.time - fledAt < 14 + DT) {
        // Fourteen seconds in (the wave has crossed the herd): everyone alarmed is farther from the ground track than when it started to run.
        let further = 0;
        let alarmed = 0;
        for (let m = 0; m < pool.size[h]; m++) {
          if (Number.isNaN(startDist[m])) continue;
          alarmed++;
          const i = base + m;
          const d = trackDistance(pool.mN[i], pool.mE[i], cN0, 0, 0, 1);
          if (d > startDist[m] + 5) further++;
          // Running on two legs once under way.
          if (pool.time - pool.fleeT0[i] > 3) expect(pool.blend[i]).toBeGreaterThan(1.3);
        }
        expect(alarmed).toBe(pool.size[h]);
        expect(further / alarmed).toBeGreaterThan(0.9);
      }
      if (fledAt > 0 && pool.time - lastFleeThreat > 40.5) break;
    }
    expect(fledAt).toBeGreaterThan(0);
    expect(pool.time - lastFleeThreat).toBeGreaterThan(40);
    expect(pool.fleeing[h]).toBe(0);
  });

  it('the alarm spreads through the herd as a wave', () => {
    const { pool, h } = makeHerd();
    const terrain = countingTerrain();
    for (let k = 0; k < 60; k++) pool.step(DT, null, terrain, 10000, pool.cN[h], pool.cE[h]);
    const ac: AircraftView = { n: pool.cN[h], e: pool.cE[h] - 300, alt: pool.cH[h] + 50, vN: 0, vE: 50, vD: 0, tas: 50 };
    for (let k = 0; k < 12; k++) pool.step(DT, ac, terrain, 10000, ac.n, ac.e);
    expect(pool.fleeing[h]).toBe(1);
    const base = h * pool.memberCap;
    // West members (nearer the aircraft) are alarmed before east ones, ~15 m/s.
    let west = -1;
    let east = -1;
    for (let m = 0; m < pool.size[h]; m++) {
      const i = base + m;
      if (west < 0 || pool.mE[i] < pool.mE[west]) west = i;
      if (east < 0 || pool.mE[i] > pool.mE[east]) east = i;
    }
    const dt = pool.fleeT0[east] - pool.fleeT0[west];
    const dx = Math.hypot(pool.mN[east] - pool.mN[west], pool.mE[east] - pool.mE[west]);
    expect(dt).toBeGreaterThan(0);
    expect(dx / dt).toBeGreaterThan(10);
    expect(dx / dt).toBeLessThan(25);
  });
});
