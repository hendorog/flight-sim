// Taxi guidance geometry (owner playtest of L02: "no directions on where the holding point was, which way to
// turn"): the ground route over the real KFBL layout from the parking stand to holding point A1, and the taxi
// telemetry signals sampled while driving along it.

import { describe, expect, it } from 'vitest';
import { RAD } from '../../src/core/math';
import { buildTaxiRoute, fixOnRoute } from '../../src/training/geo/taxiRoute';
import { createTaxiProvider } from '../../src/training/telemetry/providers/taxi';
import { Telemetry } from '../../src/training/telemetry/telemetry';
import type { SignalFrame, TaxiRoute, TelemetrySources } from '../../src/training/types';
import { HOLD_LINE_V, HOLD_SHORT, nedToLocal, PARKING } from '../../src/world/airport/layout';

const route = (): TaxiRoute => {
  const r = buildTaxiRoute(PARKING.north, PARKING.east, 'A1');
  if (!r) throw new Error('no route');
  return r;
};

/** A point along the route, `offM` to the right of it, and the centreline's true heading there. */
function along(r: TaxiRoute, s: number, offM = 0): { north: number; east: number; hdg: number } {
  const p = r.points;
  let k = 1;
  while (k < p.length - 1 && p[k].sM < s) k++;
  const a = p[k - 1], b = p[k];
  const L = Math.hypot(b.north - a.north, b.east - a.east) || 1;
  const t = Math.max(0, Math.min(1, (s - a.sM) / (b.sM - a.sM || 1)));
  const un = (b.north - a.north) / L, ue = (b.east - a.east) / L;
  // Right of a track (un, ue) in NED is (-ue, un).
  return { north: a.north + (b.north - a.north) * t - ue * offM, east: a.east + (b.east - a.east) * t + un * offM, hdg: Math.atan2(ue, un) };
}

function sample(tel: Telemetry, r: TaxiRoute | null, north: number, east: number, heading: number): SignalFrame {
  const src = {
    state: { position: { x: north, y: east, z: 0 }, heading, onGround: true, altitudeMSL: 120, groundSpeed: 3, velocity: { x: 0, y: 0, z: 0 } },
    controls: {}, readings: null, weather: { windDirectionDeg: 0, windSpeedKt: 0 }, env: {}, aircraft: {}, studentInput: true,
    timeScale: 1, route: null, taxiRoute: r,
  } as unknown as TelemetrySources;
  return tel.sample(src, 0.1);
}

describe('taxi route: parking stand to holding point A1', () => {
  it('follows the painted lines: out of the stand right onto the apron line, left down B1, right on Alpha, left into A1, hold short', () => {
    const r = route();
    expect(r.waypoints.map((w) => `${w.action}:${w.name}`)).toEqual(['right:apron', 'left:B1', 'right:A', 'left:A1', 'holdShort:A1']);
    expect(r.holdShort).toBe(true);
    // Leg lengths: ~50 m of apron line, ~155 m of B1, ~800 m of Alpha, ~40 m up A1 to the hold.
    const legs = r.waypoints.map((w) => Math.round(w.legM));
    expect(legs[0]).toBeGreaterThan(30);
    expect(legs[0]).toBeLessThan(70);
    expect(legs[1]).toBeGreaterThan(130);
    expect(legs[1]).toBeLessThan(180);
    expect(legs[2]).toBeGreaterThan(760);
    expect(legs[2]).toBeLessThan(840);
    expect(legs[3]).toBeGreaterThan(25);
    expect(legs[3]).toBeLessThan(60);
    expect(r.lengthM).toBeGreaterThan(1050);
    expect(r.lengthM).toBeLessThan(1150);
    // The route ends at the published hold-short position, 4 m short of the hold line, on A1's centreline.
    const end = r.points[r.points.length - 1];
    const a1 = HOLD_SHORT.find((h) => h.name === 'A1')!;
    expect(Math.hypot(end.north - a1.north, end.east - a1.east)).toBeLessThan(0.6);
    expect(nedToLocal(end.north, end.east).v).toBeLessThan(HOLD_LINE_V);
    // Turns are about 90 degrees each, and the polyline is continuous (no gaps over 2 m).
    for (const w of r.waypoints.slice(0, 4)) expect(Math.abs(Math.abs(w.turnDeg) - 90)).toBeLessThan(2);
    for (let k = 1; k < r.points.length; k++) expect(r.points[k].sM - r.points[k - 1].sM).toBeLessThan(60 * 15);
    // Corners are rounded with the painted radius where taxiway A meets B1 and A1 (14 m): the route passes
    // inside the corner vertex by R(sqrt 2 - 1) = 5.8 m.
    const b1Corner = r.waypoints[2];
    const l = nedToLocal(b1Corner.north, b1Corner.east);
    expect(Math.hypot(l.u - -60, l.v - -120)).toBeGreaterThan(3);
    expect(Math.hypot(l.u - -60, l.v - -120)).toBeLessThan(7);
  });

  it('starts from the nearest centreline when not on a stand (back to A1 from taxiway Alpha)', () => {
    const r = route();
    const mid = along(r, 600);
    const r2 = buildTaxiRoute(mid.north, mid.east, 'A1');
    expect(r2?.waypoints.map((w) => `${w.action}:${w.name}`)).toEqual(['left:A1', 'holdShort:A1']);
    const back = buildTaxiRoute(mid.north, mid.east, 'parking');
    expect(back?.waypoints.at(-1)?.action).toBe('stop');
  });

  it('a fix near the previous one never jumps along the route; cross-track is + right of the line', () => {
    const r = route();
    const p = along(r, 400, 2.5);
    const f = fixOnRoute(r, p.north, p.east, 390);
    expect(f.sM).toBeCloseTo(400, 0);
    expect(f.xtrackM).toBeCloseTo(2.5, 1);
    const q = along(r, 400, -4);
    expect(fixOnRoute(r, q.north, q.east, 395).xtrackM).toBeCloseTo(-4, 1);
  });
});

describe('taxi telemetry (taxi.* signals) along the real layout', () => {
  it('distance along and to go, next junction action/name/distance/bearing, cross-track, hold-short distance', () => {
    const r = route();
    const tel = new Telemetry([createTaxiProvider()]);
    const seen: string[] = [];
    let lastAlong = -1;
    for (let s = 0; s <= r.lengthM; s += 5) {
      const p = along(r, s, 1);
      const f = sample(tel, r, p.north, p.east, p.hdg);
      expect(f['taxi.active']).toBe(true);
      expect(f['taxi.alongM'] as number).toBeGreaterThanOrEqual(lastAlong - 0.5);
      lastAlong = f['taxi.alongM'] as number;
      expect((f['taxi.alongM'] as number) + (f['taxi.routeDistM'] as number)).toBeCloseTo(r.lengthM, 0);
      expect(f['taxi.holdShortDistM']).toBeCloseTo(f['taxi.routeDistM'] as number, 3);
      // 1 m right of the line, except inside the curves where the sampled chord cuts a little.
      expect(Math.abs((f['taxi.xtrackM'] as number) - 1)).toBeLessThan(0.6);
      const key = `${f['taxi.nextAction']}:${f['taxi.nextName']}`;
      if (seen.at(-1) !== key) seen.push(key);
      expect(f['taxi.nextWpDistM'] as number).toBeGreaterThan(-3);
    }
    expect(seen).toEqual(['right:apron', 'left:B1', 'right:A', 'left:A1', 'holdShort:A1']);

    // Lined up on Alpha heading for A1 (300 m short of it): the junction is dead ahead, slightly left.
    const a1 = r.waypoints[3];
    const p = along(r, a1.sM - 300);
    const f = sample(tel, r, p.north, p.east, p.hdg);
    expect(f['taxi.nextAction']).toBe('left');
    expect(f['taxi.nextWpDistM'] as number).toBeCloseTo(300, 0);
    expect(f['taxi.nextWpRelBrgDeg'] as number).toBeLessThan(0);
    expect(f['taxi.nextWpRelBrgDeg'] as number).toBeGreaterThan(-5);
    // Facing the wrong way: the junction is behind.
    const g = sample(tel, r, p.north, p.east, p.hdg + Math.PI);
    expect(Math.abs(g['taxi.nextWpRelBrgDeg'] as number)).toBeGreaterThan(170);
    void RAD;
  });

  it('reads NaN / false without a route', () => {
    const tel = new Telemetry([createTaxiProvider()]);
    const f = sample(tel, null, PARKING.north, PARKING.east, PARKING.heading);
    expect(f['taxi.active']).toBe(false);
    expect(Number.isNaN(f['taxi.routeDistM'])).toBe(true);
    expect(f['taxi.nextAction']).toBe('');
  });
});
