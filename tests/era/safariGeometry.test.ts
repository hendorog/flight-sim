// Deep Time, increment 2 (WP0a): the safari's first minute, re-derived in node against cretaceousAnchors.ts.
//   - the start: the safari scenario is SAFARI; the hold's straight-line model (SAFARI_FLIGHT) follows the flown
//     path (SimPhysics, the Cretaceous weather at SAFARI.tod) within SAFARI_MODEL_TOLERANCE_M for a minute;
//   - the river herd: the pinned site is riverHerdSite()'s, HERD_LATERAL_M left of the flown path at closest approach
//     (300 m, superseding the plan's 100-150 m: the measured cockpit has no forward window below ~6 deg, so near
//     ground content is staged in the left door window; see the anchors' header);
//   - every anchor re-derived (Triceratops offset, T. rex lair / flee bearing, Alamosaurus open ground beside tall
//     trees, kettle 0's core) with its pinned ground;
//   - every G frame: each listed group is in the frame, not behind cockpit structure, where the frame says
//     (windscreen or door window), within 45 deg of the nose, at least minPx (the plan's body sizes);
//   - the clearance (>= 250 ft over the highest ground or tree top within 500 m of the first 6 km), the sun outside
//     the central 40 % of the frame (the plan's fallback: no westbound dusk track keeps it outside the central 60 %;
//     see the anchors' sweep table), the cone within 15 deg of the nose, dayFactor > 0.25 at SAFARI.tod.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { defaultWeather } from '../../src/core/types';
import { AIRPORT, sunDirectionNED } from '../../src/core/world';
import { applyEraWeather } from '../../src/sim/eraChoice';
import { buildScenario } from '../../src/sim/scenarios';
import { SimPhysics } from '../../src/sim/SimPhysics';
import {
  ALAMOSAURUS_STAND,
  COCKPIT_VIEW,
  FIRST_MINUTE_FRAMES,
  HERD_LATERAL_M,
  KETTLE0_ACROSS_M,
  KETTLE0_EVENING,
  RIVER_HERD_SEED,
  RIVER_HERD_SITE,
  SAFARI,
  SAFARI_FLIGHT,
  SAFARI_MODEL_TOLERANCE_M,
  SILL,
  SILL_PROFILE,
  TREX_FLEE_HEADING,
  TREX_LAIR,
  TRICERATOPS_ALONG_M,
  TRICERATOPS_AWAY_M,
  TRICERATOPS_GROUP,
  groupAnchor,
  inDoorWindow,
  makeProjection,
  nedToPath,
  pathToNed,
  projectFromCockpit,
  safariAt,
  safariHeading,
  safariStartNed,
  visibleFromCockpit,
} from '../../src/world/era/cretaceousAnchors';
import { CRETACEOUS } from '../../src/world/era/cretaceous';
import { nightRamp } from '../../src/world/era/eraLight';
import { setEra } from '../../src/world/era/eraState';
import { countingTerrain, herdGround } from '../../src/world/fauna/habitat';
import { RIVER_HERD_SEED as SHOWCASE_SEED, riverHerdSite } from '../../src/world/fauna/showcase';
import { makeSample, sampleTerrain, terrainHeight } from '../../src/world/terrain/heightfield';
import { buildTreeCell, TREE_STRIDE } from '../../src/world/terrain/vegetation/placement';

const DEG = Math.PI / 180;
beforeAll(() => {
  setEra('cretaceous');
});
afterAll(() => {
  setEra('present');
});

/** Trees (east, ground, north, height) of the era in a NED box, the high preset's spacing. */
function trees(n0: number, e0: number, n1: number, e1: number): { n: number; e: number; top: number; h: number }[] {
  const out: { n: number; e: number; top: number; h: number }[] = [];
  for (let cz = Math.floor(n0 / 256); cz <= Math.floor(n1 / 256); cz++)
    for (let cx = Math.floor(e0 / 256); cx <= Math.floor(e1 / 256); cx++) {
      const c = buildTreeCell({ cx, cz, size: 256, spacing: 5.5 });
      for (let i = 0; i < c.count; i++) {
        const o = i * TREE_STRIDE;
        out.push({ e: c.instances[o], n: c.instances[o + 2], top: c.instances[o + 1] + c.instances[o + 3], h: c.instances[o + 3] });
      }
    }
  return out;
}

describe('the safari start (SAFARI)', () => {
  it('the scenario starts at SAFARI, on the hold', () => {
    const p = new SimPhysics({ weather: defaultWeather() });
    const sc = buildScenario('safari', p.env);
    const s = safariStartNed();
    expect(sc.ic.position.x).toBeCloseTo(s.north, 6);
    expect(sc.ic.position.y).toBeCloseTo(s.east, 6);
    expect(sc.ic.heading).toBeCloseTo(safariHeading(), 9);
    expect(safariHeading() / DEG).toBeCloseTo(250 + SAFARI.trackDeg, 6);
    const ground = terrainHeight(s.north, s.east);
    expect(ground).toBeCloseTo(SAFARI_FLIGHT.startGround, 0);
    expect(-sc.ic.position.z - ground).toBeCloseTo(SAFARI.aglFt * 0.3048, 6);
    expect(SAFARI_FLIGHT.altitudeMSL).toBeCloseTo(SAFARI_FLIGHT.startGround + SAFARI.aglFt * 0.3048, 6);
    expect(sc.engageAutoflight).toBe(true);
    expect(sc.title).toContain(`${SAFARI.aglFt} ft`);
    p.resetTo(sc);
    expect(p.autoflight.engaged).toBe(true);
  });

  it('pathToNed / nedToPath are inverse; the seed is shared with the fauna', () => {
    const a = pathToNed(1234, -321);
    const b = nedToPath(a.north, a.east);
    expect(b.s).toBeCloseTo(1234, 6);
    expect(b.c).toBeCloseTo(-321, 6);
    expect(SHOWCASE_SEED).toBe(RIVER_HERD_SEED);
  });

  it('the hold model follows the flown path for the first minute', () => {
    const w = applyEraWeather(defaultWeather(), CRETACEOUS.weather);
    w.timeOfDay = SAFARI.tod;
    const p = new SimPhysics({ weather: w });
    p.reset('safari');
    const m = { north: 0, east: 0, alt: 0 };
    let worst = 0;
    for (let t = 0; t <= 60; t += 5) {
      safariAt(t, m);
      const s = p.state;
      worst = Math.max(worst, Math.hypot(s.position.x - m.north, s.position.y - m.east));
      expect(Math.abs(s.altitudeMSL - m.alt)).toBeLessThan(40);
      expect(Math.abs(s.pitch / DEG - SAFARI_FLIGHT.pitchDeg)).toBeLessThan(1.5);
      p.step(5);
    }
    expect(worst).toBeLessThan(SAFARI_MODEL_TOLERANCE_M);
  }, 120000);
});

describe('the anchors', () => {
  const herd = riverHerdSite(countingTerrain());
  const q = nedToPath(RIVER_HERD_SITE.north, RIVER_HERD_SITE.east);

  it('the river herd site is riverHerdSite(), HERD_LATERAL_M left of the flown path at closest approach', () => {
    expect(herd.north).toBeCloseTo(RIVER_HERD_SITE.north, 1);
    expect(herd.east).toBeCloseTo(RIVER_HERD_SITE.east, 1);
    expect(herd.ground).toBeCloseTo(RIVER_HERD_SITE.ground, 1);
    const tca = q.s / SAFARI_FLIGHT.groundSpeed;
    const left = SAFARI_FLIGHT.driftRight * tca - q.c;
    expect(Math.abs(left - HERD_LATERAL_M)).toBeLessThan(15);
    expect(q.s).toBeGreaterThan(1000);
  });

  it('Triceratops: the herd site + TRICERATOPS_ALONG_M along, TRICERATOPS_AWAY_M away from the track, on herd ground, clear of the charge', () => {
    const t = pathToNed(q.s + TRICERATOPS_ALONG_M, q.c - TRICERATOPS_AWAY_M);
    expect(TRICERATOPS_GROUP.north).toBeCloseTo(t.north, 0);
    expect(TRICERATOPS_GROUP.east).toBeCloseTo(t.east, 0);
    expect(TRICERATOPS_GROUP.ground).toBeCloseTo(terrainHeight(t.north, t.east), 0);
    expect(herdGround(t.north, t.east, countingTerrain())).toBe('');
    // Facing the T. rex's lair (within 10 deg).
    const toLair = Math.atan2(TREX_LAIR.east - t.east, TREX_LAIR.north - t.north);
    expect(Math.abs(Math.atan2(Math.sin(toLair - TRICERATOPS_GROUP.heading), Math.cos(toLair - TRICERATOPS_GROUP.heading)))).toBeLessThan(10 * DEG);
    // A charge from the lair through the herd site (and on along it) stays >= 200 m away (predatorFleeRange):
    // the group faces the T. rex, it does not bolt.
    const cn = RIVER_HERD_SITE.north - TREX_LAIR.north;
    const ce = RIVER_HERD_SITE.east - TREX_LAIR.east;
    const cl = Math.hypot(cn, ce);
    const along = ((t.north - TREX_LAIR.north) * cn + (t.east - TREX_LAIR.east) * ce) / cl;
    const offLine = Math.abs((t.north - TREX_LAIR.north) * ce - (t.east - TREX_LAIR.east) * cn) / cl;
    expect(along).toBeGreaterThan(cl);
    expect(offLine).toBeGreaterThanOrEqual(200);
    expect(Math.hypot(t.north - RIVER_HERD_SITE.north, t.east - RIVER_HERD_SITE.east)).toBeGreaterThanOrEqual(200);
    // The far side of the herd from the track.
    expect(nedToPath(t.north, t.east).c).toBeLessThan(q.c);
  });

  it('the T. rex lair drives the herd 30-60 deg off the track direction, toward the track', () => {
    const flee = Math.atan2(RIVER_HERD_SITE.east - TREX_LAIR.east, RIVER_HERD_SITE.north - TREX_LAIR.north);
    expect(Math.abs(Math.atan2(Math.sin(flee - TREX_FLEE_HEADING), Math.cos(flee - TREX_FLEE_HEADING)))).toBeLessThan(0.5 * DEG);
    const off = Math.atan2(Math.sin(flee - safariHeading()), Math.cos(flee - safariHeading())) / DEG;
    // The herd is left of the track: toward the track is to the right of the track direction (+).
    expect(off).toBeGreaterThanOrEqual(30);
    expect(off).toBeLessThanOrEqual(60);
    expect(Math.hypot(RIVER_HERD_SITE.north - TREX_LAIR.north, RIVER_HERD_SITE.east - TREX_LAIR.east)).toBeCloseTo(260, 0);
    expect(TREX_LAIR.ground).toBeCloseTo(terrainHeight(TREX_LAIR.north, TREX_LAIR.east), 0);
    expect(herdGround(TREX_LAIR.north, TREX_LAIR.east, countingTerrain())).toBe('');
  });

  it('the Alamosaurus trio stands on open ground left of the track, 25-90 m from trees of 15 m or more', () => {
    const a = ALAMOSAURUS_STAND;
    const pp = nedToPath(a.north, a.east);
    expect(pp.c).toBeLessThan(-280);
    expect(pp.s).toBeGreaterThan(q.s);
    expect(a.ground).toBeCloseTo(terrainHeight(a.north, a.east), 0);
    expect(herdGround(a.north, a.east, countingTerrain())).toBe('');
    let near = Infinity;
    for (const t of trees(a.north - 150, a.east - 150, a.north + 150, a.east + 150)) if (t.h >= 15) near = Math.min(near, Math.hypot(t.n - a.north, t.e - a.east));
    expect(near).toBeGreaterThanOrEqual(25);
    expect(near).toBeLessThanOrEqual(90);
  }, 60000);

  it("kettle 0's evening core is 1993 m along and KETTLE0_ACROSS_M right of the track", () => {
    const k = pathToNed(1993, KETTLE0_ACROSS_M);
    expect(KETTLE0_EVENING.north).toBeCloseTo(k.north, 0);
    expect(KETTLE0_EVENING.east).toBeCloseTo(k.east, 0);
    expect(KETTLE0_EVENING.ground).toBeCloseTo(terrainHeight(k.north, k.east), 0);
  });
});

describe('the cockpit and the G frames', () => {
  it('the sill profile: 91 bins, the windscreen, the A-pillar and the left door window', () => {
    expect(SILL_PROFILE.length).toBe(91);
    SILL_PROFILE.forEach((r, i) => expect(r[0]).toBe(i - 45));
    expect(visibleFromCockpit(0, -5)).toBe(true);
    expect(visibleFromCockpit(0, -SILL.fwdDeg - 0.2)).toBe(false);
    expect(visibleFromCockpit(-16, 0)).toBe(false);
    expect(visibleFromCockpit(SILL.leftFwdBearingDeg, -SILL.leftFwdDeg + 0.5)).toBe(true);
    expect(visibleFromCockpit(-35, -25)).toBe(true);
    expect(visibleFromCockpit(35, -10)).toBe(false);
    expect(visibleFromCockpit(60, 0)).toBe(false);
    expect(COCKPIT_VIEW.focalPx).toBeCloseTo(COCKPIT_VIEW.height / 2 / Math.tan((COCKPIT_VIEW.fovDeg / 2) * DEG), 0);
  });

  it('every G frame shows its groups where it says, at least minPx', () => {
    let last = -1;
    const P = makeProjection();
    for (const f of FIRST_MINUTE_FRAMES) {
      expect(f.t).toBeGreaterThan(last);
      last = f.t;
      for (const e of f.expect) {
        const g = groupAnchor(e.group, CRETACEOUS.terrain.volcano!);
        projectFromCockpit(f.t, g.north, g.east, g.h, P);
        const where = inDoorWindow(P.bodyBearingDeg) ? 'door' : 'windscreen';
        expect({ frame: f.id, group: e.group, visible: P.visible, where }).toEqual({ frame: f.id, group: e.group, visible: true, where: e.where });
        expect(Math.abs(P.bearingDeg)).toBeLessThanOrEqual(45);
        expect(g.size * P.pxPerM).toBeGreaterThanOrEqual(e.minPx);
      }
    }
    expect(FIRST_MINUTE_FRAMES.map((f) => f.id)).toEqual(['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7']);
  });
});

describe('lighting and clearance at SAFARI', () => {
  it('the sun outside the central 40 % of the frame, dayFactor > 0.25, the cone within 15 deg, the crater ramp > 0.15', () => {
    const s = sunDirectionNED(SAFARI.tod, 172);
    const el = Math.asin(-s.z);
    const rel = Math.atan2(Math.sin(Math.atan2(s.y, s.x) - safariHeading()), Math.cos(Math.atan2(s.y, s.x) - safariHeading()));
    const x = COCKPIT_VIEW.focalPx * Math.tan(rel);
    expect(Math.abs(x)).toBeGreaterThan(0.2 * COCKPIT_VIEW.width);
    // WP8 round 2 (tod 20.0): outside the plan's own central 60 % as well.
    expect(Math.abs(x)).toBeGreaterThan(0.3 * COCKPIT_VIEW.width);
    const t = Math.min(1, Math.max(0, (-s.z + 0.12) / 0.22));
    expect(t * t * (3 - 2 * t)).toBeGreaterThan(0.25);
    const V = CRETACEOUS.terrain.volcano!;
    const st = safariStartNed();
    const vb = Math.atan2(V.east - st.east, V.north - st.north) - safariHeading();
    expect(Math.abs(Math.atan2(Math.sin(vb), Math.cos(vb)))).toBeLessThan(15 * DEG);
    expect(nightRamp(Math.sin(el))).toBeGreaterThan(0.15);
  });

  it('>= 250 ft over the highest ground or tree top within 500 m of the first 6 km', () => {
    const S = makeSample();
    let hi = -Infinity;
    for (let s = 0; s <= 6000; s += 25)
      for (let c = -500; c <= 500; c += 25) {
        const p = pathToNed(s, c);
        sampleTerrain(p.north, p.east, S);
        hi = Math.max(hi, S.ground, S.standing, S.river);
      }
    const a = pathToNed(0, 0), b = pathToNed(6000, 0);
    for (const t of trees(Math.min(a.north, b.north) - 600, Math.min(a.east, b.east) - 600, Math.max(a.north, b.north) + 600, Math.max(a.east, b.east) + 600)) {
      const pp = nedToPath(t.n, t.e);
      if (pp.s >= 0 && pp.s <= 6000 && Math.abs(pp.c) <= 500) hi = Math.max(hi, t.top);
    }
    expect((SAFARI_FLIGHT.altitudeMSL - hi) / 0.3048).toBeGreaterThanOrEqual(250);
    expect(AIRPORT.runway.heading / DEG).toBeCloseTo(70, 6);
  }, 120000);
});
