// The NAV receivers (src/instruments/dynamics/navigation.ts): what each tuned frequency gives, the generated
// fields' ILSs, and a VOR's needle and TO / FROM from the course set on the OBS.

import { describe, expect, it } from 'vitest';
import { emptyNavSignal, ils07, navaids, receiveNav, vorDeviation } from '../../src/instruments/dynamics/navigation';
import { generatedAirfields, HOME_AIRFIELD } from '../../src/world/airfields';
import { setWorldSeed } from '../../src/world/worldSeed';
import { setEra } from '../../src/world/era/eraState';
import '../../src/world/terrain/heightfield';

setEra('present');
setWorldSeed(0);

/** A point on a field's extended centreline, `back` m before its runway end 0 threshold, on a 3 degree path. */
function onFinal(f: { north: number; east: number; heading: number; length: number; elevation: number }, back: number) {
  const along = -f.length / 2 - back;
  const h = Math.tan((3 * Math.PI) / 180) * (back + 300);
  return { x: f.north + along * Math.cos(f.heading), y: f.east + along * Math.sin(f.heading), z: -(f.elevation + h) };
}

describe('navaids', () => {
  it('has the home ILS and VOR, an ILS at each sealed field on its own channel, and a second VOR', () => {
    const list = navaids();
    expect(list.filter((n) => n.field === HOME_AIRFIELD).map((n) => [n.kind, n.frequency])).toEqual([['ils', 110.3], ['vor', 113.9]]);
    const sealed = generatedAirfields().filter((f) => f.kind === 'sealed');
    const ils = list.filter((n) => n.kind === 'ils');
    expect(ils).toHaveLength(sealed.length + 1);
    expect(new Set(ils.map((n) => n.frequency)).size).toBe(ils.length);
    for (const n of ils) expect(Math.floor(n.frequency * 10 + 1e-6) % 2).toBe(1); // odd tenths
    expect(list.filter((n) => n.kind === 'vor').map((n) => n.frequency)).toEqual([113.9, 116.8]);
  });

  it('the home ILS on 110.30 is the old ILS 07 exactly; another frequency gives nothing', () => {
    const p = onFinal(HOME_AIRFIELD, 6000);
    p.y += 40;
    const a = receiveNav(110.3, p, emptyNavSignal());
    const b = ils07(p, { locValid: false, gsValid: false, loc: 0, gs: 0 });
    expect(a).toMatchObject({ kind: 'ils', locValid: b.locValid, gsValid: b.gsValid, loc: b.loc, gs: b.gs });
    expect(receiveNav(108.0, p, emptyNavSignal())).toMatchObject({ kind: null, locValid: false, gsValid: false });
  });

  it("a generated field's ILS is centred on its own final", () => {
    for (const n of navaids().filter((x) => x.kind === 'ils' && x.field !== HOME_AIRFIELD)) {
      const s = receiveNav(n.frequency, onFinal(n.field, 5000), emptyNavSignal());
      expect(s.locValid && s.gsValid).toBe(true);
      expect(Math.abs(s.loc)).toBeLessThan(0.02);
      expect(Math.abs(s.gs)).toBeLessThan(0.05);
    }
  });

  it('a VOR gives the radial; the needle and TO / FROM follow the OBS', () => {
    const p = { x: HOME_AIRFIELD.north + 20000, y: HOME_AIRFIELD.east, z: -(HOME_AIRFIELD.elevation + 900) };
    const s = receiveNav(113.9, p, emptyNavSignal());
    expect(s.kind).toBe('vor');
    expect(Math.min(s.radialDeg, 360 - s.radialDeg)).toBeLessThan(0.5);
    expect(vorDeviation(0, 0)).toMatchObject({ loc: expect.closeTo(0, 9), toFrom: -1 }); // outbound on the 360 radial: centred, FROM
    expect(vorDeviation(0, 180)).toMatchObject({ loc: expect.closeTo(0, 9), toFrom: 1 }); // inbound 180: centred, TO
    expect(vorDeviation(5, 0).loc).toBeCloseTo(-0.5); // east of the outbound course: needle left
    expect(vorDeviation(5, 180).loc).toBeCloseTo(0.5); // flying 180 east of the line: the course is to the right
    expect(receiveNav(113.9, { x: 400000, y: 0, z: -1000 }, emptyNavSignal()).locValid).toBe(false);
  });
});
