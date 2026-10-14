// Fauna habitat (Deep Time WP5): herd sites are deterministic per cell and only on valid ground; the showcase
// placements are valid.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AIRPORT } from '../../src/core/world';
import { LINE_UP, RUNWAY_HALF_WIDTH, nedToLocal } from '../../src/world/airport/layout';
import { LAUNCH_RANGE } from '../../src/world/fauna/flight';
import { treeLine } from '../../src/world/terrain/biome';
import { SEA_LEVEL, makeSample, sampleTerrain, terrainHeight } from '../../src/world/terrain/heightfield';
import {
  HERD_MAX_SLOPE,
  MAX_SITE_PROBES,
  SAMPLES_PER_PROBE,
  countingTerrain,
  herdGround,
  makeSite,
  probeHabitatCell,
} from '../../src/world/fauna/habitat';
import { ROSTERS } from '../../src/world/fauna/roster';
import { KETTLE_SEEDS, kettleSeeds, restingPair, riverHerdSite } from '../../src/world/fauna/showcase';
import { setEra } from '../../src/world/era/eraState';

// The Cretaceous world (terrain with the volcano, environment, flora): createFaunaSystem's era only picks the roster.
beforeAll(() => {
  setEra('cretaceous');
});
afterAll(() => {
  setEra('present');
});

const roster = ROSTERS.cretaceous;

function slopeAt(n: number, e: number, d = 30): number {
  const s = makeSample();
  const he = sampleTerrain(n, e + d, s).ground;
  const hw = sampleTerrain(n, e - d, s).ground;
  const hn = sampleTerrain(n + d, e, s).ground;
  const hs = sampleTerrain(n - d, e, s).ground;
  return Math.hypot((he - hw) / (2 * d), (hn - hs) / (2 * d));
}

/** Every herd site found over +-24 km. */
const sites = (() => {
  const terrain = countingTerrain();
  const out: ReturnType<typeof makeSite>[] = [];
  let maxSamples = 0;
  for (let ci = -12; ci < 12; ci++) {
    for (let cj = -12; cj < 12; cj++) {
      const site = makeSite();
      const ok = probeHabitatCell(ci, cj, roster, terrain, site);
      maxSamples = Math.max(maxSamples, site.samples);
      if (ok) out.push(site);
    }
  }
  return { sites: out, maxSamples };
})();

describe('habitat cells', () => {
  it('finds herds beside the water', () => {
    expect(sites.sites.length).toBeGreaterThan(15);
  });

  it('is deterministic per cell', () => {
    const terrain = countingTerrain();
    for (const s of sites.sites.slice(0, 20)) {
      const again = makeSite();
      expect(probeHabitatCell(s.ci, s.cj, roster, terrain, again)).toBe(true);
      expect(again).toEqual(s);
    }
  });

  it('costs at most 40 terrain samples per cell', () => {
    expect(MAX_SITE_PROBES * SAMPLES_PER_PROBE).toBeLessThanOrEqual(40);
    expect(sites.maxSamples).toBeLessThanOrEqual(40);
  });

  it('never spawns on water, the airfield, the approach corridors, slopes or high ground', () => {
    const s = makeSample();
    for (const site of sites.sites) {
      sampleTerrain(site.north, site.east, s);
      expect(s.ground).toBeGreaterThanOrEqual(Math.max(s.standing, s.river) + 0.3);
      expect(terrainHeight(site.north, site.east)).toBeCloseTo(s.ground, 6);
      expect(s.airportBlend).toBeGreaterThan(0.98);
      expect(s.approach).toBe(0);
      expect(slopeAt(site.north, site.east)).toBeLessThan(HERD_MAX_SLOPE);
      expect(s.ground).toBeLessThan(treeLine(site.north, site.east));
      const lakeShore = s.standing > SEA_LEVEL;
      expect(s.riverDist < 600 || lakeShore).toBe(true);
      expect(site.size).toBeGreaterThanOrEqual(30);
      expect(site.size).toBeLessThanOrEqual(80);
      expect(roster.entries[site.entry].role).toBe('herd');
    }
  });

  it('rejects the flat zone and the river', () => {
    const t = countingTerrain();
    expect(herdGround(0, 0, t)).toBe('airfield');
    // On the river centreline near the showcase.
    const s = makeSample();
    const site = riverHerdSite(t);
    sampleTerrain(site.north, site.east, s);
    expect(s.riverDist).toBeLessThan(600);
  });
});

describe('showcase', () => {
  it('the river herd stands on valid herd ground ~2.5 km beyond the 07 departure end, near the river', () => {
    const site = riverHerdSite(countingTerrain());
    expect(herdGround(site.north, site.east, countingTerrain())).toBe('');
    const local = nedToLocal(site.north, site.east);
    expect(local.u).toBeGreaterThan(2500);
    expect(local.u).toBeLessThan(4500);
    expect(local.v).toBeGreaterThan(2000);
    expect(local.v).toBeLessThan(4000);
  });

  it('the resting pair stands on the Flats beside the strip, off the trail, launch range from neither line-up', () => {
    const s = makeSample();
    for (const p of restingPair()) {
      sampleTerrain(p.north, p.east, s);
      expect(s.airportBlend).toBe(0);
      expect(s.ground).toBe(AIRPORT.elevation);
      const local = nedToLocal(p.north, p.east);
      // Inside the runway's length (passed on the roll both ways), and beyond LAUNCH_RANGE of both line-ups.
      expect(Math.abs(local.u)).toBeLessThan(AIRPORT.runway.length / 2);
      for (const l of LINE_UP) expect(Math.hypot(p.north - l.north, p.east - l.east)).toBeGreaterThan(LAUNCH_RANGE + 100);
      expect(Math.abs(local.v)).toBeGreaterThan(RUNWAY_HALF_WIDTH + 30);
    }
  });

  it('the kettle seeds are 1.5 km past each departure end', () => {
    const seeds = kettleSeeds();
    expect(seeds).toHaveLength(KETTLE_SEEDS.length);
    for (const p of seeds) {
      const local = nedToLocal(p.north, p.east);
      expect(Math.abs(local.u)).toBeCloseTo(AIRPORT.runway.length / 2 + 1500, 6);
    }
  });
});
