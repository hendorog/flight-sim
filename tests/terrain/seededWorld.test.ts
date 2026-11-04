// A seeded world's own layout and water (seededLayout.ts, drainage.ts, riverNetwork.ts), across several seeds: the
// home field on dry lowland with its runway level, a coast and a range within reach, generated fields around it; the
// river network finite, every channel's water falling downstream, every tributary ending on another river (or at
// the sea), no channel near the runway; lakes holding water inside their hollows; the same seed giving the same world after another one.

import { afterAll, describe, expect, it } from 'vitest';
import { AIRPORT } from '../../src/core/world';
import { airfields } from '../../src/world/airfields';
import { hydrology, makeSample, naturalHeight, sampleTerrain } from '../../src/world/terrain/heightfield';
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
  it('puts the home field on dry lowland with a coast, a range and generated fields around it', () => {
    setWorldSeed(seed);
    const r = layoutReport();
    expect(r.inlandAtField).toBeGreaterThan(9000);
    expect(r.coastKm).toBeLessThanOrEqual(80);
    expect(r.rangeKm).toBeLessThanOrEqual(80);
    expect(airfields().length).toBeGreaterThanOrEqual(6);
    const s = makeSample();
    const rw = AIRPORT.runway;
    for (const a of [-0.5, 0, 0.5]) {
      sampleTerrain(rw.center.north + Math.cos(rw.heading) * rw.length * a, rw.center.east + Math.sin(rw.heading) * rw.length * a, s);
      expect(s.ground).toBe(AIRPORT.elevation);
    }
  });

  it('has a finite river network whose water falls downstream, with every tributary ending on another river', () => {
    setWorldSeed(seed);
    const rivers = hydrology.rivers;
    expect(rivers && rivers.length).toBeGreaterThan(20);
    const net = hydrology.network!;
    const hits: ChannelNear[] = [];
    let joined = 0;
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
      const k = net.channels(pn, pe, hits);
      let onOther = false;
      for (let j = 0; j < k; j++) if (hits[j].line !== li && hits[j].dist < 60) onOther = true;
      if (!onOther) bad.push(`line ${li} ends at ${pn.toFixed(0)}, ${pe.toFixed(0)} (level ${r.level[n - 1].toFixed(1)}) on no other river`);
      joined++;
    });
    expect(bad.slice(0, 10)).toEqual([]);
    expect(joined).toBeGreaterThan(10);
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
  });
});
