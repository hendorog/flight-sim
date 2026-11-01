// Proves the Career's landmarks (src/career/landmarks.ts): the list is deterministic per world seed (the same after
// another world has been built in between) and differs between seeds; every landmark lies at least 2 NM
// (BOARD_RULES.scenicFieldClearM) from every field, with unique ids and names; each comes from the world's own
// features (the town's built-up core, villageSites, the lakes named as the Flight School's route names them,
// oxbows, horseshoe loops of the river channel, riverCrossings, summits that are real tops of terrainHeight); seed 0
// has every kind, seed 7 (no road network) has no villages or bridges; nothing outside the present day; the town
// mask is left alone; nearestLandmark and landmarkWaypoint; and the strip's waypoint line shows a landmark's name.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AREA_NUDGE, LAKE_NAMES, landmarks, landmarkWaypoint, nearestLandmark, RIVER_BEND, SUMMIT, type Landmark,
} from '../../src/career/landmarks';
import { BOARD_RULES, type JobStripModel } from '../../src/career/types';
import { stripTargetText } from '../../src/career/ui/strip';
import { WAYPOINTS } from '../../src/training/content/syllabus/route';
import { airfields } from '../../src/world/airfields';
import { findTownSite } from '../../src/world/airport/valley';
import { setEra } from '../../src/world/era/eraState';
import { hydrology, terrainHeight } from '../../src/world/terrain/heightfield';
import { lakeRadius } from '../../src/world/terrain/hydrology';
import { riverCrossings, villageSites } from '../../src/world/terrain/roads';
import { townSite } from '../../src/world/terrain/townMask';
import { setWorldSeed } from '../../src/world/worldSeed';

const CLEAR = BOARD_RULES.scenicFieldClearM;

function atSeed(seed: number): readonly Landmark[] {
  setEra('present');
  setWorldSeed(seed);
  return landmarks(airfields());
}

beforeAll(() => {
  setEra('present');
  setWorldSeed(0);
});
afterAll(() => {
  setEra('present');
  setWorldSeed(0);
});

describe('determinism', () => {
  it('gives the same list for a seed after another world was built, and a different one for another seed', () => {
    const a = JSON.parse(JSON.stringify(atSeed(0)));
    const b = JSON.parse(JSON.stringify(atSeed(7)));
    const again = JSON.parse(JSON.stringify(atSeed(0)));
    expect(again).toEqual(a);
    expect(b).not.toEqual(a);
    expect(a.length).toBeGreaterThan(20);
    expect(b.length).toBeGreaterThan(10);
  });

  it('caches the list for the same world and fields', () => {
    expect(atSeed(0)).toBe(atSeed(0));
  });
});

describe.each([0, 7])('the rules at seed %i', (seed) => {
  it('keeps every landmark at least 2 NM from every field, with unique ids and names', () => {
    const list = atSeed(seed);
    const fields = airfields();
    expect(fields.length).toBe(9);
    for (const l of list) {
      for (const f of fields) expect(Math.hypot(l.north - f.north, l.east - f.east), `${l.id} from ${f.code}`).toBeGreaterThanOrEqual(CLEAR);
      expect(Number.isFinite(l.elevationM) && l.radiusM > 0).toBe(true);
    }
    expect(new Set(list.map((l) => l.id)).size).toBe(list.length);
    expect(new Set(list.map((l) => l.name)).size).toBe(list.length);
  });

  it('names the lakes as the Flight School route does, on their water', () => {
    const lakes = atSeed(seed).filter((l) => l.kind === 'lake');
    expect(lakes.map((l) => l.name)).toEqual(LAKE_NAMES);
    const byName = new Map(lakes.map((l) => [l.name, l]));
    for (const [name, wp] of [['Valley Lake', WAYPOINTS.valleyLake], ['Foothill Lake', WAYPOINTS.foothillLake], ['Glacial Lake', WAYPOINTS.glacialLake]] as const) {
      const l = byName.get(name)!;
      expect(Math.hypot(l.north - wp.north, l.east - wp.east), name).toBeLessThan(5);
    }
    lakes.forEach((l, i) => expect(lakeRadius(hydrology.lakes[i], l.north, l.east)).toBeLessThan(AREA_NUDGE.lakeWater));
  });

  it('puts the town over its built-up core, and leaves the town mask alone', () => {
    const before = townSite();
    const town = atSeed(seed).find((l) => l.kind === 'town')!;
    const site = findTownSite(terrainHeight)!;
    expect(town.name).toBe('Fable town');
    expect(Math.hypot(town.north - site.north, town.east - site.east)).toBeLessThanOrEqual(AREA_NUDGE.town * site.radius);
    expect(townSite()).toBe(before);
  });

  it('takes oxbows, river bends and summits from the water and the ground', () => {
    const list = atSeed(seed);
    const hit = { dist: 0, level: 0, halfWidth: 0, depth: 0 };
    const river = { dist: 0, level: 0, halfWidth: 0, s: 0, side: 0, beyondSource: 0 };
    const kinds = (k: Landmark['kind']) => list.filter((l) => l.kind === k);
    expect(kinds('oxbow').length).toBeGreaterThan(0);
    for (const o of kinds('oxbow')) expect(hydrology.queryOxbow(o.north, o.east, hit).dist).toBeLessThan(5);
    // The middle of a horseshoe loop: the channel passes close round it.
    expect(kinds('riverBend').length).toBeGreaterThan(3);
    for (const b of kinds('riverBend')) expect(hydrology.queryRiver(b.north, b.east, river).dist).toBeLessThan(RIVER_BEND.arcM / 2);
    const summits = kinds('summit');
    expect(summits.length).toBeGreaterThan(10);
    for (const s of summits) {
      expect(s.elevationM).toBeCloseTo(terrainHeight(s.north, s.east), 6);
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        expect(terrainHeight(s.north + Math.cos(a) * SUMMIT.finalStepM, s.east + Math.sin(a) * SUMMIT.finalStepM), s.id).toBeLessThanOrEqual(s.elevationM);
      }
    }
    // Highest first, and every one named with its height in feet.
    for (let i = 1; i < summits.length; i++) expect(summits[i].elevationM).toBeLessThanOrEqual(summits[i - 1].elevationM);
    for (const s of summits) expect(s.name).toMatch(/^Summit \d{1,2},?\d{3} ft, \d+(\.\d)? NM [a-z-]+ of [A-Z][a-z]+$/u);
  });
});

describe('the road network (seed 0 only)', () => {
  it('has every kind at seed 0, villages and bridges at their sites', () => {
    const list = atSeed(0);
    expect(new Set(list.map((l) => l.kind))).toEqual(new Set(['town', 'village', 'lake', 'oxbow', 'riverBend', 'bridge', 'summit']));
    const villages = villageSites();
    for (const v of list.filter((l) => l.kind === 'village')) {
      const site = villages[Number(v.id.split('-')[1])];
      expect([v.north, v.east]).toEqual([site.north, site.east]);
      expect(v.name).toMatch(/^Village \d+(\.\d)? NM [a-z-]+ of [A-Z][a-z]+$/u);
    }
    const crossings = riverCrossings();
    for (const b of list.filter((l) => l.kind === 'bridge')) {
      const x = crossings[Number(b.id.split('-')[1])];
      expect([b.north, b.east]).toEqual([x.north, x.east]);
    }
    expect(list.find((l) => l.name === 'Village 3 NM north-east of Fable')).toBeDefined();
  });

  it('has no villages or bridges at seed 7', () => {
    const list = atSeed(7);
    expect(list.some((l) => l.kind === 'village' || l.kind === 'bridge')).toBe(false);
  });
});

describe('outside the present day', () => {
  it('has no landmarks', () => {
    setEra('cretaceous');
    try {
      expect(landmarks(airfields())).toEqual([]);
    } finally {
      setEra('present');
    }
  });
});

describe('lookups', () => {
  it('finds the nearest landmark within a range and makes a turning point over it', () => {
    const list = atSeed(0);
    const valley = list.find((l) => l.name === 'Valley Lake')!;
    expect(nearestLandmark(valley.north + 100, valley.east, list)?.landmark).toBe(valley);
    expect(nearestLandmark(valley.north + 100, valley.east, list, 50)).toBeNull();
    expect(nearestLandmark(0, 0, [])).toBeNull();
    expect(landmarkWaypoint(valley)).toEqual({
      name: 'Valley Lake', north: valley.north, east: valley.east, radiusM: BOARD_RULES.scenicRadiusM, maxAglFt: BOARD_RULES.scenicMaxAglFt,
    });
  });
});

describe('the strip', () => {
  it("shows a landmark's name on the waypoint line", () => {
    const m = {
      target: 'Valley Lake', distanceNm: 4.1, bearingDeg: 120, waypointIndex: 1, waypointsTotal: 3,
    } as JobStripModel;
    expect(stripTargetText(m)).toBe('2 of 3 · Valley Lake · 4.1 NM · 120°');
    expect(stripTargetText({ ...m, target: 'River bend 4 NM south-west of Elmley', waypointIndex: 0, waypointsTotal: 2 }))
      .toBe('1 of 2 · River bend 4 NM south-west of Elmley · 4.1 NM · 120°');
  });
});
