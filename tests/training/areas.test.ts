// Training areas (section 2.8): terrain <= working altitude - 2,000 ft over each area's whole radius.
//
// The survey that placed the training area is recorded here. Section 2.8 puts it at (4000 N, -8000 E), the
// cruise scenario's start, and asks for the centre to move along the cruise track (heading 100 true) to the
// nearest point that passes if the survey fails there. It fails for the 3,500 ft lessons (terrain within
// 3 NM peaks at 1,727 ft), and no point on the track passes for 2,500 ft (the lowest 3 NM circle on it peaks
// at 1,280 ft): L04 cannot start at the 2,500 ft of section 4.1 in this world (the content module starts it
// at 3,500 ft; see stage1.ts).

import { describe, expect, it } from 'vitest';
import { DEG, FT, NM } from '../../src/core/math';
import { AIRPORT, runwayCoords } from '../../src/core/world';
import { buildScenario } from '../../src/sim/scenarios';
import { makeMockEnvironment } from '../../src/core/mockState';
import { AREAS, distFromAreaNm, inArea } from '../../src/training/geo/areas';
import type { AreaDef, AreaId, Lesson, StartSpec } from '../../src/training/types';
import { terrainHeight } from '../../src/world/terrain/heightfield';

const CLEARANCE_FT = 2000;
/** Kept in hand when choosing a centre, for the 100 m terrain sampling (not part of the clearance rule). */
const SURVEY_MARGIN_FT = 50;

/** Highest terrain (ft MSL) within `radiusNm` of a point: a 100 m grid plus the rim every 2 degrees. */
function maxTerrainFt(north: number, east: number, radiusNm: number): number {
  const r = radiusNm * NM;
  let m = -Infinity;
  for (let dn = -r; dn <= r; dn += 100) {
    for (let de = -r; de <= r; de += 100) {
      if (dn * dn + de * de <= r * r) m = Math.max(m, terrainHeight(north + dn, east + de));
    }
  }
  for (let a = 0; a < 360; a += 2) m = Math.max(m, terrainHeight(north + r * Math.cos(a * DEG), east + r * Math.sin(a * DEG)));
  return m / FT;
}

/** Lowest working altitude (ft MSL) flown at each area by the section 4.1 lessons (L04 excepted, above). */
const SPEC_WORKING_ALT_FT: Record<AreaId, number> = {
  trainingArea: 3500, // L01, L03, L05 (L06, L15, L19: 4,000; L07: 4,500)
  pflHighKey: 3000 + AIRPORT.elevation / FT, // L16: 3,000 ft AAL
  fieldOverhead: 2000 + AIRPORT.elevation / FT, // the L20 rejoin overhead at 2,000 ft AAL
};

describe('training areas', () => {
  for (const [id, alt] of Object.entries(SPEC_WORKING_ALT_FT) as [AreaId, number][]) {
    it(`${id}: terrain clears ${Math.round(alt)} ft MSL by ${CLEARANCE_FT} ft over its ${AREAS[id].radiusNm} NM radius`, () => {
      const a = AREAS[id];
      expect(a.id).toBe(id);
      expect(maxTerrainFt(a.north, a.east, a.radiusNm)).toBeLessThanOrEqual(alt - CLEARANCE_FT);
    });
  }

  it('the training area sits on the cruise track at the nearest point that passes for 3,500 ft', () => {
    const sc = buildScenario('cruise', makeMockEnvironment());
    const start = sc.ic.position;
    expect([start.x, start.y]).toEqual([4000, -8000]);
    const hdg = sc.ic.heading;
    expect(hdg).toBeCloseTo(100 * DEG, 9);
    const a = AREAS.trainingArea;
    // On the track (within 5 m of the line through the start along heading 100).
    const dn = a.north - start.x;
    const de = a.east - start.y;
    const alongTrack = dn * Math.cos(hdg) + de * Math.sin(hdg);
    const crossTrack = -dn * Math.sin(hdg) + de * Math.cos(hdg);
    expect(Math.abs(crossTrack)).toBeLessThan(5);
    expect(Math.abs(alongTrack - 12750)).toBeLessThan(5);
    // The spec's own point fails; every 250 m step between it and the chosen centre fails.
    const pass = (d: number): boolean =>
      maxTerrainFt(start.x + Math.cos(hdg) * d, start.y + Math.sin(hdg) * d, a.radiusNm) <=
      SPEC_WORKING_ALT_FT.trainingArea - CLEARANCE_FT - SURVEY_MARGIN_FT;
    expect(pass(0)).toBe(false);
    for (let d = 250; d < alongTrack - 1; d += 250) expect(pass(d), `${d} m along`).toBe(false);
    // Upstream (west) of the start nothing passes within the same distance either.
    for (let d = -1000; d >= -alongTrack; d -= 1000) expect(pass(d), `${d} m`).toBe(false);
    expect(pass(12750)).toBe(true);
  }, 60000);

  it('no point on the cruise track gives 2,000 ft of clearance at 2,500 ft (why L04 cannot start there)', () => {
    const sc = buildScenario('cruise', makeMockEnvironment());
    const p = sc.ic.position;
    let best = Infinity;
    for (let d = -20000; d <= 40000; d += 1000) {
      best = Math.min(best, maxTerrainFt(p.x + Math.cos(sc.ic.heading) * d, p.y + Math.sin(sc.ic.heading) * d, 3));
    }
    expect(best).toBeGreaterThan(2500 - CLEARANCE_FT);
  }, 60000);

  it('pflHighKey is abeam the upwind end of 07 on the dead side; fieldOverhead over the runway midpoint', () => {
    const k = runwayCoords(AREAS.pflHighKey.north, AREAS.pflHighKey.east);
    expect(k.along).toBeCloseTo(AIRPORT.runway.length / 2, 6);
    expect(k.across).toBeGreaterThan(0);
    const f = runwayCoords(AREAS.fieldOverhead.north, AREAS.fieldOverhead.east);
    expect([f.along, f.across]).toEqual([0, 0]);
  });

  it('inArea / distFromAreaNm', () => {
    const a: AreaDef = { id: 'trainingArea', name: 'x', north: 0, east: 0, radiusNm: 1 };
    expect(distFromAreaNm(a, 0, NM)).toBeCloseTo(1, 12);
    expect(inArea(a, 0, NM)).toBe(true);
    expect(inArea(a, NM, NM)).toBe(false);
  });
});

// ---- every area start in the syllabus (once module 6 has landed it) ------------------------------------

// Imported dynamically: while the content module is in progress the syllabus may be a placeholder that throws
// on access (or fail to import); the area checks above do not depend on it.
const syllabus: readonly Lesson[] | null = await import('../../src/training/content/syllabus/index')
  .then((m) => [...m.SYLLABUS])
  .catch(() => null);

/** Every start in a lesson that is placed at an area, with its working altitude in ft MSL. */
function areaStarts(lesson: Lesson): { where: string; at: AreaId; altFt: number }[] {
  const out: { where: string; at: AreaId; altFt: number }[] = [];
  const add = (where: string, s: StartSpec | undefined): void => {
    if (!s) return;
    if (s.kind === 'air' && typeof s.at === 'string') out.push({ where, at: s.at, altFt: s.altFt + (s.altRef === 'field' ? AIRPORT.elevation / FT : 0) });
    if (s.kind === 'attitude') out.push({ where, at: s.at, altFt: s.altFt });
  };
  add('start', lesson.start);
  for (const ph of lesson.flow) {
    add(`${ph.id}.retryFrom`, ph.retryFrom);
    for (const st of ph.steps) if (st.kind === 'setup') add(`${ph.id}.${st.id}`, st.reposition);
  }
  return out;
}

describe.skipIf(syllabus === null)('syllabus area starts', () => {
  const cache = new Map<AreaId, number>();
  const terrain = (id: AreaId): number => {
    if (!cache.has(id)) cache.set(id, maxTerrainFt(AREAS[id].north, AREAS[id].east, AREAS[id].radiusNm));
    return cache.get(id)!;
  };
  it('every lesson start at an area clears the terrain under the whole area by 2,000 ft', () => {
    const failures: string[] = [];
    for (const lesson of syllabus ?? []) {
      for (const s of areaStarts(lesson)) {
        const t = terrain(s.at);
        if (t > s.altFt - CLEARANCE_FT) failures.push(`${lesson.id} ${s.where}: ${s.at} at ${Math.round(s.altFt)} ft over terrain ${Math.round(t)} ft`);
      }
    }
    expect(failures).toEqual([]);
  }, 60000);
});
