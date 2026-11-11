// The AI traffic taxis round corners as a smooth curve (docs/known-issues.md, owner report 2026-11-05: corners were
// taken as polygons, the heading stepping at each point of the rounded route). stepTaxi steers on the arc to a point
// a little way along the route with the nosewheel's lag, so the yaw rate builds and dies away; an arrival swings
// round on its spot to face out instead of being turned there at once.

import { describe, expect, it } from 'vitest';
import { stepTaxi, turnOnSpot, type TrafficState } from '../../src/atc/circuit';
import { freeSpots, lineUpRoute, taxiInRoute, taxiOutRoute, vacateRoute } from '../../src/atc/taxi';
import { localHeading, localToNed, type NedXY } from '../../src/world/airport/layout';

const DEG = Math.PI / 180;
const DT = 1 / 60;
const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

/** Distance from a point to the route's polyline, m. */
function offRoute(p: NedXY, route: readonly NedXY[]): number {
  let best = Infinity;
  for (let i = 0; i + 1 < route.length; i++) {
    const a = route[i], b = route[i + 1];
    const dn = b.north - a.north, de = b.east - a.east;
    const t = Math.max(0, Math.min(1, ((p.north - a.north) * dn + (p.east - a.east) * de) / Math.max(dn * dn + de * de, 1e-9)));
    best = Math.min(best, Math.hypot(a.north + t * dn - p.north, a.east + t * de - p.east));
  }
  return best;
}

/** Taxi the whole route at 60 frames a second: the largest yaw acceleration and distance off the route. */
function drive(route: NedXY[]): { s: TrafficState; time: number; yawAccel: number; off: number } {
  const s: TrafficState = {
    north: route[0].north, east: route[0].east, height: 0, heading: Math.atan2(route[1].east - route[0].east, route[1].north - route[0].north),
    bank: 0, pitch: 0, speed: 0, verticalSpeed: 0, leg: 0, onGround: true, rollTime: 0,
  };
  let wp = 0, time = 0, rate = 0, yawAccel = 0, off = 0;
  while (wp < route.length && time < 600) {
    const h = s.heading;
    wp = stepTaxi(s, route, wp, DT);
    time += DT;
    const r = wrap(s.heading - h) / DT;
    yawAccel = Math.max(yawAccel, Math.abs(r - rate) / DT);
    rate = r;
    off = Math.max(off, offRoute(s, route));
  }
  return { s, time, yawAccel, off };
}

describe('AI taxiing', () => {
  const spot = freeSpots()[2];
  const runway = localToNed(0, 0);
  const routes: [string, NedXY[]][] = [
    ['taxi out to A1', taxiOutRoute(spot, 0)],
    ['taxi out to A4', taxiOutRoute(spot, 1)],
    ['line up on 07', lineUpRoute(0)],
    ['vacate at A3', vacateRoute('A3', runway)],
    ['taxi in from A3', taxiInRoute('A3', 0, spot)],
    ['taxi in from A2', taxiInRoute('A2', 1, spot)],
  ];
  for (const [name, route] of routes) {
    it(`${name}: corners as smooth curves, on the centreline`, () => {
      const r = drive(route);
      const end = route[route.length - 1];
      expect(r.time).toBeLessThan(600);
      expect(Math.hypot(r.s.north - end.north, r.s.east - end.east)).toBeLessThan(0.6);
      // The old steering stepped the heading: 1500-3000 deg/s/s at every point of a corner.
      expect(r.yawAccel).toBeLessThan(100 * DEG);
      expect(r.off).toBeLessThan(2);
    });
  }

  it('an arrival swings round on its spot to face out, smoothly and onto the spot', () => {
    const route = taxiInRoute('A3', 0, spot);
    const { s } = drive(route);
    const facing = localHeading(0, spot.facing);
    expect(Math.abs(wrap(s.heading - facing))).toBeGreaterThan(150 * DEG);
    const at = localToNed(spot.u, spot.v);
    let time = 0, rate = 0, yawAccel = 0;
    for (;;) {
      const h = s.heading;
      const done = turnOnSpot(s, facing, at, DT);
      time += DT;
      const r = wrap(s.heading - h) / DT;
      yawAccel = Math.max(yawAccel, Math.abs(r - rate) / DT);
      rate = r;
      if (done || time > 30) break;
    }
    expect(time).toBeLessThan(15);
    expect(Math.abs(wrap(s.heading - facing))).toBeLessThan(0.5 * DEG);
    expect(Math.hypot(s.north - at.north, s.east - at.east)).toBeLessThan(0.01);
    expect(yawAccel).toBeLessThan(100 * DEG);
  });
});
