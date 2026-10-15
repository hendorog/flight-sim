// Azhdarchid flight (Deep Time WP5): kettles on the real thermal cores, ridge soaring without thermals, the
// quad launch, and the 60 m separation from the aircraft.

import { describe, expect, it } from 'vitest';
import { makeThermalCore, thermalUpdraft } from '../../src/physics/weather/thermals';
import type { ThermalFrame } from '../../src/physics/weather/windField';
import { makeSample, type TerrainSample } from '../../src/world/terrain/heightfield';
import type { FaunaTerrain } from '../../src/world/fauna/habitat';
import { FLYER_MODE, FlyerPool, RIDGE_MAX, RIDGE_MIN, SOAR_SINK, turnRadius, KETTLE_BANK } from '../../src/world/fauna/flight';
import type { AircraftView } from '../../src/world/fauna/herds';

const DT = 1 / 60;

/** A planar terrain h = h0 + gN * north + gE * east, counted. */
function planeTerrain(h0: number, gN = 0, gE = 0): FaunaTerrain & { h(n: number, e: number): number } {
  const h = (n: number, e: number) => h0 + gN * n + gE * e;
  const t = {
    calls: 0,
    h,
    sample(n: number, e: number, out: TerrainSample): TerrainSample {
      t.calls++;
      Object.assign(out, makeSample());
      out.ground = h(n, e);
      out.airportBlend = 1;
      return out;
    },
    height(n: number, e: number): number {
      t.calls++;
      return h(n, e);
    },
  };
  return t;
}

function frame(wStar: number, driftN = 0, driftE = 0): ThermalFrame {
  return { seed: 0x7468726d, driftN, driftE, wStar, cloudBaseM: 1700, minDepth: 300 };
}

function spawnBird(pool: FlyerPool, n: number, e: number, alt: number, ground: number, seed = 1): number {
  return pool.spawn({ north: n, east: e, alt, ground, entry: 1, scale: 1, size: 1, variant: 0, seed, mode: FLYER_MODE.glide, heading: 0, anchorN: n, anchorE: e });
}

describe('kettles on real thermal cores', () => {
  it('turn radius at 15 m/s and 20 deg bank is 55-70 m', () => {
    const r = turnRadius(15, KETTLE_BANK);
    expect(r).toBeGreaterThan(55);
    expect(r).toBeLessThan(70);
  });

  it('circles the core at 55-70 m and climbs at thermalUpdraft - 0.8 m/s', () => {
    const terrain = planeTerrain(200);
    const pool = new FlyerPool(8);
    const f = frame(2, 300, -150);
    const core = makeThermalCore();
    const t0 = 200;
    expect(pool.nearestCore(f, t0, 5000, 3000, core)).toBe(true);
    const i = spawnBird(pool, 5000, 3000, 200 + 400, 200);
    pool.startKettle(i, core, f, terrain);
    pool.alt[i] = 200 + 400;
    let t = t0;
    let checked = 0;
    for (let k = 0; k < 60 * 40; k++) {
      t += DT;
      const alt0 = pool.alt[i];
      pool.step(DT, t, f, null, terrain, 200, true, 0, 0);
      if (pool.mode[i] !== FLYER_MODE.kettle) break;
      const climb = (pool.alt[i] - alt0) / DT;
      const w = thermalUpdraft(f.seed, pool.n[i] - f.driftN, pool.e[i] - f.driftE, alt0 - 200, t, f.wStar, Math.max(300, f.cloudBaseM - 200));
      expect(Math.abs(climb - (w - SOAR_SINK))).toBeLessThan(0.1);
      if (k > 60 * 15) {
        const r = Math.hypot(pool.n[i] - (pool.coreX[i] + f.driftN), pool.e[i] - (pool.coreY[i] + f.driftE));
        expect(r).toBeGreaterThan(55);
        expect(r).toBeLessThan(70);
        expect(pool.speed[i]).toBeCloseTo(15, 0);
        expect(Math.abs(pool.bank[i])).toBeCloseTo((20 * Math.PI) / 180, 1);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(60);
  });

  it('a bird in a strong core climbs, tops out near 0.8 zi and glides on to another core', () => {
    const terrain = planeTerrain(100);
    const pool = new FlyerPool(8);
    const f = frame(2.2);
    const core = makeThermalCore();
    // Find a young, strong core.
    let t = 0;
    for (; t < 3000; t += 37) {
      if (pool.nearestCore(f, t, 2000, 2000, core) && core.strength > 1.1 && core.phase < 0.3) break;
    }
    const i = spawnBird(pool, 2000, 2000, 100 + 300, 100);
    pool.startKettle(i, core, f, terrain);
    pool.alt[i] = 400;
    let topped = false;
    let maxAgl = 0;
    for (let k = 0; k < 60 * 900 && !topped; k++) {
      t += DT;
      pool.step(DT, t, f, null, terrain, 200, true, 0, 0);
      maxAgl = Math.max(maxAgl, pool.alt[i] - 100);
      if (pool.mode[i] === FLYER_MODE.glide) topped = true;
    }
    expect(topped).toBe(true);
    expect(maxAgl).toBeGreaterThan(450);
    expect(maxAgl).toBeLessThanOrEqual(0.8 * (1700 - 100) + 2);
  });
});

describe('without thermals', () => {
  it('ridge-soars 80-150 m above the windward slope when w* = 0', () => {
    // Ground rising to the north at 0.2; wind blowing toward the north (up the slope).
    const terrain = planeTerrain(300, 0.2, 0);
    const pool = new FlyerPool(8);
    const i = spawnBird(pool, 0, 0, 300 + 300, 300);
    pool.startRidge(i, terrain, 1, 0);
    expect(pool.mode[i]).toBe(FLYER_MODE.ridge);
    let t = 0;
    for (let k = 0; k < 60 * 120; k++) {
      t += DT;
      pool.step(DT, t, frame(0), null, terrain, 200, true, 1, 0);
      expect(pool.mode[i]).toBe(FLYER_MODE.ridge);
      if (k > 60 * 60) {
        const agl = pool.alt[i] - terrain.h(pool.n[i], pool.e[i]);
        expect(agl).toBeGreaterThanOrEqual(RIDGE_MIN);
        expect(agl).toBeLessThanOrEqual(RIDGE_MAX);
      }
    }
  });

  it('kettle birds switch to the ridge when the thermals die', () => {
    const terrain = planeTerrain(300, 0.15, 0);
    const pool = new FlyerPool(8);
    const core = makeThermalCore();
    const f = frame(2);
    expect(pool.nearestCore(f, 100, 0, 0, core)).toBe(true);
    const i = spawnBird(pool, 0, 0, 800, 300);
    pool.startKettle(i, core, f, terrain);
    pool.step(DT, 100, frame(0), null, terrain, 200, true, 1, 0);
    expect(pool.mode[i]).toBe(FLYER_MODE.ridge);
  });
});

describe('ground and launch', () => {
  it('a standing pair quad-launches when the aircraft rolls within 400 m, and climbs away', () => {
    const terrain = planeTerrain(120);
    const pool = new FlyerPool(8);
    const i = pool.spawn({ north: 0, east: 0, alt: 120, ground: 120, entry: 1, scale: 1, size: 1, variant: 0, seed: 9, mode: FLYER_MODE.stand, heading: 0, anchorN: 0, anchorE: 0 });
    const ac: AircraftView = { n: -800, e: 0, alt: 121.5, vN: 20, vE: 0, vD: 0, tas: 20 };
    let t = 0;
    let launchedAt = -1;
    for (let k = 0; k < 60 * 70; k++) {
      t += DT;
      ac.n += ac.vN * DT;
      pool.step(DT, t, frame(0), ac, terrain, 200, true, 1, 0);
      if (launchedAt < 0 && pool.mode[i] === FLYER_MODE.launch) {
        launchedAt = t;
        expect(Math.hypot(ac.n - pool.n[i], ac.e - pool.e[i])).toBeLessThan(400);
        expect(Math.hypot(ac.n - pool.n[i], ac.e - pool.e[i])).toBeGreaterThan(380);
      }
      if (ac.n > -100) ac.vN = 0; // stops short
    }
    expect(launchedAt).toBeGreaterThan(0);
    expect(pool.alt[i] - 120).toBeGreaterThan(80);
    expect(pool.blend[i]).toBe(2);
  });
});

describe('separation', () => {
  it('never comes within 60 m of the aircraft', () => {
    const terrain = planeTerrain(100);
    const pool = new FlyerPool(16);
    const f = frame(2);
    const core = makeThermalCore();
    expect(pool.nearestCore(f, 50, 0, 0, core)).toBe(true);
    for (let b = 0; b < 8; b++) {
      const i = spawnBird(pool, 0, 0, 100 + 300 + 30 * b, 100, 100 + b);
      pool.startKettle(i, core, f, terrain);
      pool.alt[i] = 400 + 30 * b;
    }
    const cn = core.x;
    const ce = core.y;
    // Repeated passes straight through the kettle at different heights and headings.
    let t = 50;
    let minD = Infinity;
    for (let pass = 0; pass < 12; pass++) {
      const hdg = pass * 0.9;
      const ac: AircraftView = { n: cn - 2000 * Math.cos(hdg), e: ce - 2000 * Math.sin(hdg), alt: 380 + 25 * pass, vN: 55 * Math.cos(hdg), vE: 55 * Math.sin(hdg), vD: 0, tas: 55 };
      for (let k = 0; k < 60 * 75; k++) {
        t += DT;
        ac.n += ac.vN * DT;
        ac.e += ac.vE * DT;
        pool.step(DT, t, f, ac, terrain, 200, true, 0, 0);
        for (let i = 0; i < pool.capacity; i++) {
          if (!pool.active[i]) continue;
          minD = Math.min(minD, Math.hypot(pool.n[i] - ac.n, pool.e[i] - ac.e, pool.alt[i] - ac.alt));
          expect(Number.isFinite(pool.alt[i])).toBe(true);
        }
      }
    }
    expect(minD).toBeGreaterThanOrEqual(60 - 1e-6);
  });
});

describe('review fixes', () => {
  it('joins a far ridge beat no faster than it can fly', () => {
    const terrain = planeTerrain(300, 0.2, 0);
    const pool = new FlyerPool(8);
    const i = spawnBird(pool, 0, 0, 600, 300);
    pool.startRidge(i, terrain, 1, 0);
    // Start well away from the beat (startRidge searches up to 1200 m out).
    pool.n[i] = pool.rN[i] - 1100;
    pool.e[i] = pool.rE[i];
    let t = 0;
    let maxV = 0;
    for (let k = 0; k < 60 * 30; k++) {
      t += DT;
      const n0 = pool.n[i];
      const e0 = pool.e[i];
      pool.step(DT, t, frame(0), null, terrain, 200, true, 1, 0);
      maxV = Math.max(maxV, Math.hypot(pool.n[i] - n0, pool.e[i] - e0) / DT);
    }
    expect(maxV).toBeLessThanOrEqual(1.5 * pool.cruise(i) + 1e-6);
  });

  it('follows the ground under a core drifting over rising terrain (AGL and zi refreshed)', () => {
    // Ground rising 0.08 to the north; the core drifts north 4 km over the run.
    const terrain = planeTerrain(100, 0.08, 0);
    const pool = new FlyerPool(8);
    const f = frame(2);
    const core = makeThermalCore();
    expect(pool.nearestCore(f, 100, 0, 0, core)).toBe(true);
    const i = spawnBird(pool, 0, 0, 500, 100);
    pool.startKettle(i, core, f, terrain);
    pool.alt[i] = terrain.h(core.x, core.y) + 300;
    let t = 100;
    for (let k = 0; k < 60 * 200; k++) {
      t += DT;
      f.driftN += 20 * DT;
      pool.step(DT, t, f, null, terrain, 200, true, 0, 0);
      if (pool.mode[i] !== FLYER_MODE.kettle) break;
      const g = terrain.h(pool.coreX[i] + f.driftN, pool.coreY[i] + f.driftE);
      // Re-read at most CORE_REFRESH_S ago: at 20 m/s and 0.08 that is <= ~3.2 m (+ the kettle's slope).
      expect(Math.abs(pool.coreGround[i] - g)).toBeLessThan(5);
      expect(pool.coreZi[i]).toBeCloseTo(Math.max(f.minDepth, f.cloudBaseM - pool.coreGround[i]), 6);
      expect(pool.alt[i]).toBeGreaterThan(terrain.h(pool.n[i], pool.e[i]));
    }
  });

  it('an evade during the climb-out resumes the climb-out, not a glide to a stale target', () => {
    const terrain = planeTerrain(120);
    const pool = new FlyerPool(8);
    const i = pool.spawn({ north: 0, east: 0, alt: 160, ground: 120, entry: 1, scale: 1, size: 1, variant: 0, seed: 9, mode: FLYER_MODE.climbOut, heading: 0, anchorN: 0, anchorE: 0 });
    pool.tgtX[i] = 0;
    pool.tgtY[i] = 0;
    const ac: AircraftView = { n: 60, e: 0, alt: 180, vN: 0, vE: 0, vD: 0, tas: 0 };
    pool.step(DT, 1, frame(0), ac, terrain, 200, true, 1, 0);
    expect(pool.mode[i]).toBe(FLYER_MODE.evade);
    expect(pool.resume[i]).toBe(FLYER_MODE.climbOut);
    let t = 1;
    let sawGlide = false;
    for (let k = 0; k < 60 * 90; k++) {
      t += DT;
      pool.step(DT, t, frame(0), null, terrain, 200, true, 1, 0);
      if (pool.mode[i] === FLYER_MODE.glide) sawGlide = true;
      if (pool.mode[i] === FLYER_MODE.ridge) break;
    }
    expect(sawGlide).toBe(false);
    expect(pool.mode[i]).toBe(FLYER_MODE.ridge);
  });

  it('a bird placed roosted at night launches again at dawn', () => {
    const terrain = planeTerrain(120);
    const pool = new FlyerPool(8);
    const i = spawnBird(pool, 0, 0, 500, 120);
    pool.startRoosted(i, terrain);
    expect(pool.mode[i]).toBe(FLYER_MODE.roost);
    let t = 0;
    for (let k = 0; k < 60 * 20; k++) pool.step(DT, (t += DT), frame(0), null, terrain, 200, false, 1, 0);
    expect(pool.mode[i]).toBe(FLYER_MODE.roost);
    expect(pool.alt[i]).toBe(120);
    let launched = false;
    for (let k = 0; k < 60 * 40 && !launched; k++) {
      pool.step(DT, (t += DT), frame(0), null, terrain, 200, true, 1, 0);
      launched = pool.mode[i] === FLYER_MODE.launch;
    }
    expect(launched).toBe(true);
  });
});

describe('branch-final review fixes', () => {
  /** A steep cone (1:1 flanks, 900 m high) at (cn, ce) on a 100 m plain, counted. */
  function coneTerrain(cn: number, ce: number): FaunaTerrain & { h(n: number, e: number): number } {
    const h = (n: number, e: number) => 100 + Math.max(0, 900 - Math.hypot(n - cn, e - ce));
    const t = {
      calls: 0,
      h,
      sample(n: number, e: number, out: TerrainSample): TerrainSample {
        t.calls++;
        Object.assign(out, makeSample());
        out.ground = h(n, e);
        out.airportBlend = 1;
        return out;
      },
      height(n: number, e: number): number {
        t.calls++;
        return h(n, e);
      },
    };
    return t;
  }

  it('a glide between cores never passes through a hill in the way', () => {
    const terrain = coneTerrain(2000, 0);
    const pool = new FlyerPool(8);
    const f = frame(2);
    const i = spawnBird(pool, 0, 0, 500, 100);
    // The next core is beyond the cone; the reach was judged from the plain.
    pool.tgtX[i] = 4500;
    pool.tgtY[i] = 0;
    let t = 0;
    let crossed = false;
    for (let k = 0; k < 60 * 400 && pool.mode[i] === FLYER_MODE.glide; k++) {
      pool.step(DT, (t += DT), f, null, terrain, 200, true, 0, 0);
      expect(pool.alt[i]).toBeGreaterThan(terrain.h(pool.n[i], pool.e[i]));
      if (pool.n[i] > 2000) crossed = true;
    }
    expect(crossed).toBe(true);
  });

  it('a grounded bird is not pushed by an aircraft passing well overhead', () => {
    const terrain = planeTerrain(120);
    const pool = new FlyerPool(8);
    const i = pool.spawn({ north: 0, east: 0, alt: 120, ground: 120, entry: 1, scale: 1, size: 1, variant: 0, seed: 3, mode: FLYER_MODE.stand, heading: 0, anchorN: 0, anchorE: 0 });
    const ac: AircraftView = { n: 20, e: 0, alt: 420, vN: 0, vE: 0, vD: 0, tas: 50 };
    pool.step(DT, 1, frame(0), ac, terrain, 200, false, 0, 0);
    expect(pool.n[i]).toBeCloseTo(0, 6);
    expect(pool.e[i]).toBeCloseTo(0, 6);
    // Low over it, it steps aside horizontally to 60 m in 3-D and stays on the ground.
    ac.alt = 130;
    pool.step(DT, 1 + DT, frame(0), ac, terrain, 200, false, 0, 0);
    expect(Math.hypot(pool.n[i] - ac.n, pool.e[i] - ac.e, pool.alt[i] - ac.alt)).toBeCloseTo(60, 3);
    expect(pool.alt[i]).toBe(120);
  });

  it('a bird landed at its roost is on the ground: no evade when the aircraft comes close', () => {
    const terrain = planeTerrain(120);
    const pool = new FlyerPool(8);
    const i = spawnBird(pool, 0, 0, 500, 120);
    pool.startRoosted(i, terrain);
    const ac: AircraftView = { n: pool.n[i] + 90, e: pool.e[i], alt: 140, vN: 0, vE: 0, vD: 0, tas: 30 };
    for (let k = 0; k < 30; k++) pool.step(DT, 1 + k * DT, frame(0), ac, terrain, 200, false, 0, 0);
    expect(pool.mode[i]).toBe(FLYER_MODE.roost);
    expect(pool.alt[i]).toBe(120);
    expect(pool.roosted(i)).toBe(true);
  });

  it('a roost-bound bird that evades flies on to its roost afterwards', () => {
    const terrain = coneTerrain(-3000, -3000);
    const pool = new FlyerPool(8);
    const i = spawnBird(pool, 0, 0, 400, 100, 5);
    pool.step(DT, 0, frame(0), null, terrain, 200, false, 0, 0);
    expect(pool.mode[i]).toBe(FLYER_MODE.roost);
    const roostGround = pool.ground[i];
    const ac: AircraftView = { n: pool.n[i] + 80, e: pool.e[i], alt: pool.alt[i] + 10, vN: 0, vE: 0, vD: 0, tas: 30 };
    pool.step(DT, DT, frame(0), ac, terrain, 200, false, 0, 0);
    expect(pool.mode[i]).toBe(FLYER_MODE.evade);
    let t = DT;
    for (let k = 0; k < 60 * 120; k++) pool.step(DT, (t += DT), frame(0), null, terrain, 200, false, 0, 0);
    expect(pool.mode[i]).toBe(FLYER_MODE.roost);
    expect(pool.ground[i]).toBe(roostGround);
    expect(pool.roosted(i)).toBe(true);
  });
});
