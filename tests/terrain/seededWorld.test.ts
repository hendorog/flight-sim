// A seeded world's own layout and water (seededLayout.ts, drainage.ts, riverNetwork.ts), across several seeds: the
// home field on dry lowland with its runway level, a coast and a range within reach, generated fields around it; the
// river network finite, every channel's water falling downstream, no channel crossing itself, every tributary ending on another river (or at
// the sea), no channel near the runway; lakes holding water inside their hollows; the same seed giving the same world after another one.

import { afterAll, describe, expect, it } from 'vitest';
import { AIRPORT } from '../../src/core/world';
import { airfields } from '../../src/world/airfields';
import { hydrology, makeSample, naturalHeight, sampleTerrain, terrainHeight } from '../../src/world/terrain/heightfield';
import { LINE_UP, PARKING } from '../../src/world/airport/layout';
import { runwayIds } from '../../src/world/airfields';
import { PATTERN_ALTITUDE } from '../../src/sim/scenarios';
import { DEG } from '../../src/core/math';
import type { ChannelNear } from '../../src/world/terrain/hydrology';
import { layoutReport } from '../../src/world/terrain/seededLayout';
import { setWorldSeed } from '../../src/world/worldSeed';

const SEEDS = [1, 7, 42, 1234, 99991];

afterAll(() => {
  setWorldSeed(0);
});

function fingerprint(): number[] {
  const s = makeSample();
  const out: number[] = [];
  for (let i = 0; i < 64; i++) {
    const n = -60000 + (i % 8) * 17000 + 311;
    const e = -60000 + Math.floor(i / 8) * 17000 + 97;
    sampleTerrain(n, e, s);
    out.push(s.ground, s.river === -Infinity ? -1 : s.river, s.standing);
  }
  out.push(hydrology.rivers?.length ?? 0, hydrology.lakes.length, hydrology.oxbows.length);
  return out;
}

describe.each(SEEDS)('seed %i', (seed) => {
  it('sites its own home field, level, with a coast or a range and generated fields around it', () => {
    setWorldSeed(seed);
    const r = layoutReport();
    expect(r.site).not.toBeNull();
    expect(r.inlandAtField).toBeGreaterThan(1500);
    expect(Math.min(r.coastKm, r.rangeKm)).toBeLessThanOrEqual(80);
    expect(airfields().length).toBeGreaterThanOrEqual(6);
    // Its own name, code, runway and elevation; the designators those of its heading.
    expect(AIRPORT.icao).not.toBe('KFBL');
    expect(AIRPORT.runway.ids).toEqual(runwayIds(AIRPORT.runway.heading));
    expect(AIRPORT.elevation).toBe(r.site!.elevation);
    expect(new Set(airfields().map((f) => f.code)).size).toBe(airfields().length);
    const s = makeSample();
    const rw = AIRPORT.runway;
    for (const a of [-0.5, 0, 0.5]) {
      sampleTerrain(rw.center.north + Math.cos(rw.heading) * rw.length * a, rw.center.east + Math.sin(rw.heading) * rw.length * a, s);
      expect(s.ground).toBe(AIRPORT.elevation);
    }
    for (const p of [...LINE_UP, PARKING]) {
      sampleTerrain(p.north, p.east, s);
      expect(s.ground).toBe(AIRPORT.elevation);
    }
  });

  it('can be flown: a clear 3 degree approach to the low-numbered end and nothing in the circuit above pattern height', () => {
    setWorldSeed(seed);
    const c = Math.cos(AIRPORT.runway.heading);
    const sn = Math.sin(AIRPORT.runway.heading);
    const half = AIRPORT.runway.length / 2;
    for (let b = 500; b <= 10000; b += 250) {
      const along = -half - b;
      expect(terrainHeight(along * c, along * sn), `${b} m short of runway ${AIRPORT.runway.ids[0]}`).toBeLessThan(AIRPORT.elevation + Math.tan(3 * DEG) * b - 15);
    }
    let high = -Infinity;
    for (let a = -3500; a <= 3500; a += 250) {
      for (let x = -1800; x <= 1800; x += 300) high = Math.max(high, terrainHeight(a * c - x * sn, a * sn + x * c));
    }
    expect(high).toBeLessThan(PATTERN_ALTITUDE - 60);
  });

  it('has a finite river network whose water falls downstream, with every tributary ending on another river', () => {
    setWorldSeed(seed);
    const rivers = hydrology.rivers;
    expect(rivers && rivers.length).toBeGreaterThan(20);
    const net = hydrology.network!;
    const hits: ChannelNear[] = [];
    let joined = 0;
    let sunk = 0;
    const bad: string[] = [];
    rivers!.forEach((r, li) => {
      const n = r.north.length;
      if (n < 2) bad.push(`line ${li} has ${n} points`);
      for (let k = 0; k < n; k++) {
        if (!(Number.isFinite(r.north[k]) && Number.isFinite(r.east[k]) && Number.isFinite(r.level[k]) && Number.isFinite(r.s[k]))) bad.push(`line ${li} not finite at ${k}`);
        if (k > 0 && r.level[k] > r.level[k - 1]) bad.push(`line ${li} rises at ${k}`);
      }
      if (r.halfWidth[n - 1] < r.halfWidth[0] - 1e-9) bad.push(`line ${li} narrows`);
      // Its mouth: the sea (water level down to the sea's), the domain's edge, or another river's channel.
      const pn = r.north[n - 1];
      const pe = r.east[n - 1];
      if (r.level[n - 1] < 0.5 || Math.max(Math.abs(pn), Math.abs(pe)) > 155000) return;
      // A stream (streams.ts) may also end in a lake (in its water), or short of water lying above its own (it sinks
      // into the ground there, never cutting under that water).
      if (r.kind === 1 && r.end === 'lake') {
        if (!(hydrology.lakeMask!.at(pn, pe, terrainHeight(pn, pe)) > -Infinity)) bad.push(`stream ${li} ends at ${pn.toFixed(0)}, ${pe.toFixed(0)} in no lake`);
        return;
      }
      if (r.kind === 1 && (r.end === 'sink' || r.end === 'stuck')) {
        sunk++;
        const m = net.channels(pn, pe, hits);
        // Not beside water lying higher (its notch would cut under it; a stream that came down to it and joined it there
        // sinks with it).
        for (let j = 0; j < m; j++) if (hits[j].line !== li && rivers![hits[j].line].joins !== li && hits[j].dist < hits[j].halfWidth + 30 && hits[j].level > r.level[n - 1] + 6) bad.push(`stream ${li} (${r.end}) sinks beside higher water of ${hits[j].line} at ${pn.toFixed(0)}, ${pe.toFixed(0)}: ${r.level[n - 1].toFixed(1)} vs ${hits[j].level.toFixed(1)} ${hits[j].dist.toFixed(0)} m`);
        return;
      }
      const k = net.channels(pn, pe, hits);
      let onOther = false;
      for (let j = 0; j < k; j++) if (hits[j].line !== li && hits[j].dist < 60) onOther = true;
      if (!onOther) bad.push(`line ${li} ends at ${pn.toFixed(0)}, ${pe.toFixed(0)} (level ${r.level[n - 1].toFixed(1)}) on no other river`);
      joined++;
    });
    expect(bad.slice(0, 10)).toEqual([]);
    // Most streams reach a river, a lake or the sea (14-22 % end in a hollow on the seeds probed).
    expect(sunk).toBeLessThan(0.25 * rivers!.filter((r) => r.kind === 1).length);
    // No channel crosses itself (a loop that swings round onto itself is cut off).
    let crossings = 0;
    for (const r of rivers!) {
      const n = r.north.length;
      const grid = new Map<number, number[]>();
      const key = (pn: number, pe: number): number => (Math.floor(pn / 100) + 32768) * 65536 + (Math.floor(pe / 100) + 32768);
      for (let i = 0; i < n - 1; i++) {
        const k = key(r.north[i], r.east[i]);
        const l = grid.get(k);
        if (l) l.push(i);
        else grid.set(k, [i]);
      }
      for (let i = 0; i < n - 1; i++) {
        for (let a = -1; a <= 1; a++) {
          for (let b = -1; b <= 1; b++) {
            for (const j of grid.get(key(r.north[i] + a * 100, r.east[i] + b * 100)) ?? []) {
              if (j <= i + 2) continue;
              const ax = r.east[i], ay = r.north[i], bx = r.east[i + 1], by = r.north[i + 1];
              const cx = r.east[j], cy = r.north[j], dx = r.east[j + 1], dy = r.north[j + 1];
              const d1 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
              const d2 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
              const d3 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
              const d4 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
              if (d1 * d2 < 0 && d3 * d4 < 0) crossings++;
            }
          }
        }
      }
    }
    expect(crossings).toBe(0);
    expect(joined).toBeGreaterThan(10);
    // No bank raised over the plain: a river held up at a basin's rim (hundreds of metres over its own valley floor)
    // raised its 'levees' into walls that high. A tributary arriving lower now cuts the river it joins down instead,
    // and a levee is a few metres at most. Outside lakes (their bowls) and the generated airfields (their pads).
    const sm = makeSample();
    let high = 0;
    let where = '';
    for (const r of rivers!) {
      for (let k = 0; k < r.north.length; k += 3) {
        if (hydrology.lakes.some((l) => Math.hypot(l.north - r.north[k], l.east - r.east[k]) < l.bound)) continue;
        const kn = Math.min(r.north.length - 1, k + 1);
        const tl = Math.hypot(r.north[kn] - r.north[k], r.east[kn] - r.east[k]) || 1;
        for (const side of [-1, 1]) {
          const off = side * (r.halfWidth[k] + 20);
          const pn = r.north[k] - ((r.east[kn] - r.east[k]) / tl) * off;
          const pe = r.east[k] + ((r.north[kn] - r.north[k]) / tl) * off;
          sampleTerrain(pn, pe, sm);
          if (sm.airportBlend < 1) continue;
          // (Over the plain as it lies: a hollow a stream filled to its sill is a flat, streams.ts FillMask.)
          const nat = naturalHeight(pn, pe);
          const raised = sm.ground - (hydrology.network?.fill ? hydrology.network.fill(pn, pe, nat) : nat);
          if (raised > high) {
            high = raised;
            where = `${pn.toFixed(0)}, ${pe.toFixed(0)}`;
          }
        }
      }
    }
    expect(high, where).toBeLessThan(6);
  }, 60_000);

  it('keeps every channel well clear of the home runway, and its lakes hold water', () => {
    setWorldSeed(seed);
    const hit = { dist: 0, level: 0, halfWidth: 0, s: 0, side: 0, beyondSource: 0 };
    for (const a of [-1, -0.5, 0, 0.5, 1]) {
      const rw = AIRPORT.runway;
      hydrology.queryRiver(rw.center.north + Math.cos(rw.heading) * rw.length * a, rw.center.east + Math.sin(rw.heading) * rw.length * a, hit);
      expect(hit.dist).toBeGreaterThan(1200);
    }
    expect(hydrology.lakes.length).toBeGreaterThan(3);
    const s = makeSample();
    for (const l of hydrology.lakes) {
      expect(l.level).toBeGreaterThan(0);
      // Its shore inside the hollow: the water stands over the natural ground at its middle (not in a carved pit).
      expect(l.level, `lake at ${l.north.toFixed(0)}, ${l.east.toFixed(0)}`).toBeGreaterThanOrEqual(naturalHeight(l.north, l.east) + 3);
      sampleTerrain(l.north, l.east, s);
      expect(s.standing, `lake at ${l.north.toFixed(0)}, ${l.east.toFixed(0)}`).toBeGreaterThanOrEqual(l.level - 1e-9);
    }
  });
});

describe('determinism', () => {
  it('gives the same world for a seed after another was built, and a different one for another seed', () => {
    setWorldSeed(42);
    const a = fingerprint();
    setWorldSeed(7);
    const b = fingerprint();
    setWorldSeed(42);
    expect(fingerprint()).toEqual(a);
    expect(b).not.toEqual(a);
  }, 60_000);
});
