import { describe, expect, it } from 'vitest';
import { AIRPORT, runwayCoords, runwayThreshold } from '../../src/core/world';
import {
  APPROACH_GRADIENT,
  SEA_LEVEL,
  hydrology,
  makeSample,
  sampleTerrain,
  terrainHeight,
  terrainNormal,
  terrainSurface,
} from '../../src/world/terrain/heightfield';

const RW = AIRPORT.runway;

/** Distance from the runway rectangle, as world.ts defines the airport zone. */
function distFromRunway(north: number, east: number): number {
  const { along, across } = runwayCoords(north, east);
  const ox = Math.max(Math.abs(along) - RW.length / 2, 0);
  const oy = Math.max(Math.abs(across) - RW.width / 2, 0);
  return Math.hypot(ox, oy);
}

/** Deterministic pseudo-random points in a square. */
function points(n: number, half: number, seed = 1): Array<[number, number]> {
  let s = seed;
  const r = (): number => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  return Array.from({ length: n }, () => [(r() * 2 - 1) * half, (r() * 2 - 1) * half]);
}

describe('airport zone', () => {
  it('is exactly flat at the field elevation within flatMargin of the runway rectangle', () => {
    const dir = { n: Math.cos(RW.heading), e: Math.sin(RW.heading) };
    const right = { n: -Math.sin(RW.heading), e: Math.cos(RW.heading) };
    for (let a = -RW.length / 2 - AIRPORT.flatMargin; a <= RW.length / 2 + AIRPORT.flatMargin; a += 37) {
      for (let c = -AIRPORT.flatMargin; c <= AIRPORT.flatMargin; c += 23) {
        const north = RW.center.north + dir.n * a + right.n * c;
        const east = RW.center.east + dir.e * a + right.e * c;
        if (distFromRunway(north, east) > AIRPORT.flatMargin) continue;
        expect(terrainHeight(north, east)).toBe(AIRPORT.elevation);
        const nrm = terrainNormal(north, east);
        if (distFromRunway(north, east) < AIRPORT.flatMargin - 2) expect(nrm.z).toBe(-1);
        expect(terrainSurface(north, east)).toBe('grass');
      }
    }
  });

  it('blends into natural terrain without steps in the blend band', () => {
    // Walk outward from the runway side across the blend band in 1 m steps; the height must change
    // smoothly (no step larger than a steep 1:1 slope over 1 m).
    for (const angle of [0, 0.7, 1.9, 3.3, 4.4, 5.6]) {
      let prev = terrainHeight(RW.center.north, RW.center.east);
      for (let d = 0; d < AIRPORT.flatMargin + AIRPORT.blendDistance + 400; d += 1) {
        const h = terrainHeight(RW.center.north + Math.cos(angle) * d, RW.center.east + Math.sin(angle) * d);
        expect(Math.abs(h - prev)).toBeLessThan(1);
        prev = h;
      }
    }
  });

  it('keeps both approaches below the 3 degree glide path for 10 km', () => {
    const tan3 = Math.tan((3 * Math.PI) / 180);
    for (const end of [0, 1] as const) {
      const t = runwayThreshold(end);
      const out = end === 0 ? -1 : 1; // direction away from the runway along its axis
      for (let x = 0; x <= 10000; x += 50) {
        for (const lateral of [-150, 0, 150]) {
          const north = t.x + out * Math.cos(RW.heading) * x - Math.sin(RW.heading) * lateral;
          const east = t.y + out * Math.sin(RW.heading) * x + Math.cos(RW.heading) * lateral;
          const glide = AIRPORT.elevation + tan3 * x;
          expect(terrainHeight(north, east)).toBeLessThanOrEqual(glide);
        }
      }
    }
    expect(APPROACH_GRADIENT).toBeLessThan(Math.tan((3 * Math.PI) / 180));
  });
});

describe('heightfield', () => {
  it('is deterministic', () => {
    for (const [n, e] of points(200, 60000, 7)) {
      expect(terrainHeight(n, e)).toBe(terrainHeight(n, e));
      expect(terrainSurface(n, e)).toBe(terrainSurface(n, e));
    }
  });

  it('is continuous: no jumps between points 0.25 m apart anywhere', () => {
    let worst = 0;
    for (const [n, e] of points(20000, 60000, 3)) {
      const s = makeSample();
      const a = sampleTerrain(n, e, s).ground;
      const b = sampleTerrain(n + 0.25, e + 0.1, s).ground;
      worst = Math.max(worst, Math.abs(a - b));
    }
    // The steepest real terrain (cliffs in the gully filter) stays well under 2 m per 0.27 m.
    expect(worst).toBeLessThan(2);
  });

  it('is unbounded and finite far from the origin', () => {
    for (const [n, e] of points(200, 2_000_000, 11)) {
      const h = terrainHeight(n, e);
      expect(Number.isFinite(h)).toBe(true);
      expect(h).toBeGreaterThan(-1000);
      expect(h).toBeLessThan(5000);
    }
  });

  it('has an alpine range with 2000-3300 m peaks 20-45 km north', () => {
    let max = 0;
    for (let n = 20000; n <= 45000; n += 250) for (let e = -30000; e <= 30000; e += 250) max = Math.max(max, terrainHeight(n, e));
    expect(max).toBeGreaterThan(2500);
    expect(max).toBeLessThan(3400);
  });

  it('has sea at sea level to the south and water surfaces at their body level', () => {
    const s = makeSample();
    sampleTerrain(-40000, 0, s);
    expect(s.ground).toBeLessThan(SEA_LEVEL);
    expect(terrainHeight(-40000, 0)).toBe(SEA_LEVEL);
    expect(terrainSurface(-40000, 0)).toBe('water');
    for (const lake of hydrology.lakes) {
      sampleTerrain(lake.north, lake.east, s);
      expect(s.ground).toBeLessThan(lake.level);
      expect(terrainHeight(lake.north, lake.east)).toBe(lake.level);
      expect(terrainSurface(lake.north, lake.east)).toBe('water');
    }
  });

  it('has a river that always flows downhill and reaches the sea', () => {
    const r = hydrology.river;
    for (let i = 1; i < r.level.length; i++) expect(r.level[i]).toBeLessThanOrEqual(r.level[i - 1]);
    expect(r.level[r.level.length - 1]).toBe(0);
    // Mid-river the channel is wet and the surface is the river level.
    const i = Math.floor(r.level.length * 0.4);
    expect(terrainSurface(r.north[i], r.east[i])).toBe('water');
    expect(terrainHeight(r.north[i], r.east[i])).toBeCloseTo(r.level[i], 1);
  });

  it('returns unit normals pointing up', () => {
    for (const [n, e] of points(300, 50000, 5)) {
      const v = terrainNormal(n, e);
      expect(Math.hypot(v.x, v.y, v.z)).toBeCloseTo(1, 9);
      expect(v.z).toBeLessThan(0);
    }
  });

  it('is fast enough for the physics (a few microseconds per height)', () => {
    const pts = points(20000, 40000, 9);
    for (const [n, e] of pts.slice(0, 2000)) terrainHeight(n, e); // warm up the JIT
    let t0 = performance.now();
    let sink = 0;
    for (const [n, e] of pts) sink += terrainHeight(n, e);
    const general = ((performance.now() - t0) * 1000) / pts.length;
    // Around the airfield, where the physics spends most of its time.
    const near = points(20000, 1200, 13);
    t0 = performance.now();
    for (const [n, e] of near) sink += terrainHeight(n, e);
    const airfield = ((performance.now() - t0) * 1000) / near.length;
    expect(sink).not.toBeNaN();
    console.log(`terrainHeight: ${general.toFixed(2)} us average over 80x80 km, ${airfield.toFixed(2)} us around the airfield`);
    // Generous bounds: this runs alongside the other test files, so it only guards against a real regression.
    expect(general).toBeLessThan(20);
    expect(airfield).toBeLessThan(10);
  });
});
