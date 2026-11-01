// The helicopter sites (src/career/sites.ts) on three world seeds: every site, checked again here rule by rule (level
// within 5 deg over the 10 m touchdown pad and gently sloping out to a 25 m ring, sampled on grids of the test's own,
// grass and dry, at least 300 m beyond every field's area, clear of roads, villages and the town, and no tree or
// clipped hedge within 40 m at any of the four vegetation qualities, also with the town site set as the game sets it),
// with stable unique ids and names, the same list on a second call and after another seed, villages and roads among
// them at seed 0 and some at every seed, none outside the present day. And a real R44 (tests/career/headlessJob.ts),
// placed at a seed-0 site on a medevac whose pickup is that site, lifts to a hover, sets down and shuts down there: the
// 30 s on the ground counts the pickup (1 of 1), and standing shut down at the site is never an outlanding.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadAircraft } from '../../src/aircraft/registry';
import { R44_REFERENCE } from '../../src/aircraft/r44/reference';
import {
  helicopterSites, siteAnchors, siteLevel, siteRefusal, siteWaypoint, SITE_RULES, TREE_CELL_M, TREE_SPACINGS_M, treesNear, type HeliSite,
} from '../../src/career/sites';
import { CAREER_RESET_PREFIX, COMPLETION_RULES } from '../../src/career/types';
import { setGpsTarget } from '../../src/instruments/dynamics/navigation';
import { setStartField } from '../../src/sim/startField';
import { airfields, fieldCoords, HOME_AIRFIELD, type Airfield } from '../../src/world/airfields';
import { TOWN_RADIUS, findTownSite } from '../../src/world/airport/valley';
import { setEra } from '../../src/world/era/eraState';
import { makeSample, sampleTerrain, terrainHeight, terrainNormal, terrainSurface } from '../../src/world/terrain/heightfield';
import { onRoadVerge, villageSites } from '../../src/world/terrain/roads';
import { setTownSite } from '../../src/world/terrain/townMask';
import { buildTreeCell, TREE_STRIDE } from '../../src/world/terrain/vegetation/placement';
import { setWorldSeed } from '../../src/world/worldSeed';
import { HeadlessJob, HeliPilot, hostOffer } from './headlessJob';

const SEEDS = [0, 7, 3] as const;
const lists: Record<number, readonly HeliSite[]> = {};

beforeAll(() => {
  setEra('present');
  for (const seed of SEEDS) {
    setWorldSeed(seed);
    lists[seed] = helicopterSites(airfields());
  }
  setWorldSeed(0);
}, 120_000);
afterAll(() => {
  setStartField(null);
  setGpsTarget(null);
  setEra('present');
  setWorldSeed(0);
});

/** Distance beyond a field's completion box, m (as the rule states it, worked out here again). */
function beyondBox(f: Airfield, n: number, e: number): number {
  const { along, across } = fieldCoords(f, n, e);
  const half = f.kind === 'home' ? SITE_RULES.homeAcrossM : COMPLETION_RULES.acrossM;
  return Math.hypot(Math.max(0, Math.abs(along) - (f.length / 2 + COMPLETION_RULES.alongMarginM)), Math.max(0, Math.abs(across) - half));
}

describe.each(SEEDS)('the sites at seed %i', (seed) => {
  it('pass every rule, checked again here', () => {
    setWorldSeed(seed);
    try {
      const fields = airfields();
      const list = lists[seed];
      expect(list.length).toBeGreaterThanOrEqual(10);
      const town = findTownSite(terrainHeight);
      const sample = makeSample();
      const cosMax = Math.cos((SITE_RULES.maxSlopeDeg * Math.PI) / 180);
      const cosBetween = Math.cos(((SITE_RULES.maxSlopeDeg + SITE_RULES.slopeMarginDeg) * Math.PI) / 180);
      const cosOuter = Math.cos(((SITE_RULES.maxSlopeDeg + 2) * Math.PI) / 180);
      for (const s of list) {
        const at = `${s.id} ${s.name}`;
        for (const f of fields) expect(beyondBox(f, s.north, s.east), `${at} near ${f.code}`).toBeGreaterThanOrEqual(SITE_RULES.fieldClearM);
        expect(s.elevationM).toBeCloseTo(terrainHeight(s.north, s.east), 6);
        expect(onRoadVerge(s.north, s.east, SITE_RULES.roadClearM), at).toBe(false);
        for (const v of villageSites()) expect(Math.hypot(v.north - s.north, v.east - s.east), at).toBeGreaterThanOrEqual(v.radius + SITE_RULES.buildingClearM);
        if (town) expect(Math.hypot(town.north - s.north, town.east - s.east), at).toBeGreaterThanOrEqual(Math.max(town.radius, TOWN_RADIUS) + SITE_RULES.townClearM);
        for (let k = 0; k <= SITE_RULES.ringPoints; k++) {
          const a = (k / SITE_RULES.ringPoints) * 2 * Math.PI;
          const r = k === SITE_RULES.ringPoints ? 0 : SITE_RULES.ringM;
          const n = s.north + Math.cos(a) * r;
          const e = s.east + Math.sin(a) * r;
          expect(terrainSurface(n, e), `${at} surface`).toBe('grass');
          const t = sampleTerrain(n, e, sample);
          expect(t.river, `${at} river`).toBe(-Infinity);
          expect(t.riverDist - t.riverHalfWidth, `${at} river bank`).toBeGreaterThanOrEqual(SITE_RULES.dryMarginM);
          expect(t.ground, `${at} standing water`).toBeGreaterThan(t.standing);
        }
        // Level on grids of the test's own (every 1 m out from the point, 36 bearings), not the rule's: the touchdown
        // pad within 5 deg (between the rule's samples, held slopeMarginDeg under the limit, the ground may reach a
        // little past them), the clearing out to the ring within 5 deg on the rule's coarse grid and gently sloping
        // (under 7 deg) between.
        expect(siteLevel(s), `${at} level`).toBe(true);
        for (let r = 1; r <= SITE_RULES.ringM; r += 1) {
          for (let k = 0; k < 36; k++) {
            const a = ((k + 0.5) / 36) * 2 * Math.PI;
            const up = -terrainNormal(s.north + Math.cos(a) * r, s.east + Math.sin(a) * r).z;
            expect(up, `${at} slope ${r} m`).toBeGreaterThanOrEqual(r <= SITE_RULES.padM ? cosBetween : cosOuter);
          }
        }
        // The full count at all four qualities (not the first-found shortcut the siting uses).
        expect(treesNear(s.north, s.east, SITE_RULES.treeClearM), `${at} trees`).toBe(0);
        expect(siteRefusal(s, fields), at).toBeNull();
      }
      // The game sets the town site before any tree is planted (TerrainSystem), which a node test does not: near
      // the town the trees are counted again with it set, straight from the vegetation's own placement.
      if (town) {
        setTownSite(town);
        try {
          for (const s of list.filter((x) => Math.hypot(town.north - x.north, town.east - x.east) < town.radius + 600)) {
            let n = 0;
            const r = SITE_RULES.treeClearM;
            for (const spacing of TREE_SPACINGS_M) {
              for (let cx = Math.floor((s.east - r) / TREE_CELL_M); cx <= Math.floor((s.east + r) / TREE_CELL_M); cx++) {
                for (let cz = Math.floor((s.north - r) / TREE_CELL_M); cz <= Math.floor((s.north + r) / TREE_CELL_M); cz++) {
                  const c = buildTreeCell({ cx, cz, size: TREE_CELL_M, spacing });
                  for (let i = 0; i < c.count; i++) {
                    if (Math.hypot(c.instances[i * TREE_STRIDE + 2] - s.north, c.instances[i * TREE_STRIDE] - s.east) <= r) n++;
                  }
                }
              }
            }
            expect(n, `${s.id} trees with the town set`).toBe(0);
          }
        } finally {
          setTownSite(null);
        }
      }
    } finally {
      setWorldSeed(0);
    }
  }, 120_000);

  it('have stable unique ids and names, and come back the same', () => {
    setWorldSeed(seed);
    try {
      const list = lists[seed];
      expect(new Set(list.map((s) => s.id)).size).toBe(list.length);
      expect(new Set(list.map((s) => s.name)).size).toBe(list.length);
      const anchorIds = new Set(siteAnchors().map((a) => a.id));
      for (const s of list) expect(anchorIds.has(s.id)).toBe(true);
      expect(JSON.stringify(helicopterSites(airfields()))).toBe(JSON.stringify(list));
    } finally {
      setWorldSeed(0);
    }
  }, 120_000);
});

describe('the site list', () => {
  it('has village and roadside sites at seed 0 and town, lake or riverside sites at every seed', () => {
    const kinds0 = new Set(lists[0].map((s) => s.kind));
    expect(kinds0.has('village')).toBe(true);
    expect(kinds0.has('road')).toBe(true);
    for (const seed of SEEDS) expect(lists[seed].some((s) => s.kind === 'town' || s.kind === 'lake' || s.kind === 'river')).toBe(true);
  });

  it('differs between seeds and is empty outside the present day', () => {
    expect(JSON.stringify(lists[7])).not.toBe(JSON.stringify(lists[0]));
    setEra('cretaceous');
    try {
      expect(helicopterSites(airfields())).toEqual([]);
      expect(siteAnchors()).toEqual([]);
    } finally {
      setEra('present');
    }
  });

  it('gives each site a landing waypoint: 60 m, 30 s on the ground', () => {
    const s = lists[0][0];
    expect(siteWaypoint(s)).toEqual({ name: s.name, north: s.north, east: s.east, radiusM: COMPLETION_RULES.siteRadiusM, landS: COMPLETION_RULES.siteHoldS });
  });
});

describe('a real R44 at a site', () => {
  it('counts the pickup after 30 s on the ground there, and a shutdown at the site is no outlanding', async () => {
    setWorldSeed(0);
    const def = await loadAircraft('r44');
    const home = airfields().find((f) => f.code === HOME_AIRFIELD.code)!;
    // The levellest seed-0 site (the scripted pilot below lands as on an airfield: it does not fly a slope landing).
    const slope = (q: HeliSite) => -terrainNormal(q.north, q.east).z;
    const site = [...lists[0]].sort((a, b) => slope(b) - slope(a) || a.id.localeCompare(b.id))[0];
    const offer = hostOffer(`1-${home.code}-w0`, home, home, {
      kind: 'medevac', minClass: 'heli', refType: 'r44', waypoints: [siteWaypoint(site)], pax: 2,
      payload: [{ kind: 'passenger', label: 'Paramedic', kg: 77 }, { kind: 'patient', label: 'Patient', kg: 77 }], payloadKg: 154,
    });
    const job = new HeadlessJob({ type: 'r44', def, offer });
    // Re-placed cold on the site itself (flying there is not what is under test), as a Career placement.
    const sc = job.scenario('apron', home, 0.5);
    job.physics.resetTo({ ...sc, ic: { ...sc.ic, position: { x: site.north, y: site.east, z: -site.elevationM } } }, job.weather);
    job.events.emit('reset', { scenario: 'apron', lessonId: `${CAREER_RESET_PREFIX}${offer.id}` });
    expect(Math.hypot(job.state.position.x - site.north, job.state.position.y - site.east)).toBeLessThan(1);
    const pilot = new HeliPilot(job, R44_REFERENCE.engineRpm100);
    pilot.install();
    job.run(400, () => pilot.phase === 'hover');
    expect(job.monitor.waypoints.done).toBe(0);   // not yet flown: standing there counts nothing
    job.run(200, () => pilot.phase === 'down');
    expect(job.monitor.everAirborne).toBe(true);
    expect(job.state.onGround).toBe(true);
    expect(Math.hypot(job.state.position.x - site.north, job.state.position.y - site.east)).toBeLessThan(COMPLETION_RULES.siteRadiusM);
    job.run(COMPLETION_RULES.siteHoldS + 1);
    expect(job.monitor.waypoints).toEqual({ done: 1, next: 1, total: 1 });
    // Shut down at the site and stand there a minute: still the job's (no outlanding), landed.
    job.run(120, () => pilot.phase === 'done');
    expect(pilot.phase).toBe('done');
    job.run(60);
    expect(job.crashes).toEqual([]);
    expect(job.monitor.ended).toBeNull();
    expect(job.monitorEvents).toEqual([]);
    expect(job.monitor.phase).toBe('landed');
  }, 180_000);
});
