// Nav provider ('nav'): progress along TelemetrySources.route (nav.xtkNm, nav.distNm, nav.bearingDeg,
// nav.etaErrMin, nav.leg). NaN (evaluates false) while no route is set.
//
// Leg sequencing: the route starts on leg 0 (from waypoints[0], normally the aerodrome, to waypoints[1]).
// The leg clock starts when the aircraft departs: airborne and outside waypoints[0]'s pass radius ("set
// heading overhead and start the clock"); a route set while airborne (a diversion) is timed at once. A leg is complete when the aircraft is overhead its end waypoint
// (within passRadiusNm) or has gone abeam it (the along-track position passes the waypoint), so a student who
// misses a turning point by more than the radius still moves on to the next leg (and is graded for the miss
// by the lesson's own criteria). After the last leg nav.leg reads the number of legs and the geometry stays
// on the final waypoint. A different route object (a diversion) restarts the sequence.
//
// nav.etaErrMin: (time on the leg so far + distance to go / ground speed) minus the planned leg time, minutes;
// + late. NaN before the clock starts and below 30 kt ground speed (no meaningful estimate).

import { KT, NM } from '../../../core/math';
import { DEFAULT_PASS_RADIUS_NM, legCount, legGeometry } from '../../geo/route';
import type { NavRoute, SignalDef, SignalFrame, SignalProvider, TelemetrySources } from '../../types';
import { defineSignals } from './define';

const MIN_ETA_GS_KT = 30;

export const NAV_SIGNALS: readonly SignalDef[] = defineSignals([
  ['nav.xtkNm', 'number', 'NM', 0, 'Cross-track error on the active leg, + right'],
  ['nav.distNm', 'number', 'NM', 0, "Distance to the active leg's end waypoint"],
  ['nav.bearingDeg', 'angle', 'deg', 0, "True bearing to the active leg's end waypoint"],
  ['nav.etaErrMin', 'number', 'min', 0, 'Estimated leg time minus planned leg time, + late'],
  ['nav.leg', 'number', '', 0, 'Active leg index (number of legs when the route is complete)'],
]);

export function createNavProvider(): SignalProvider {
  let route: NavRoute | null = null;
  let leg = 0;
  let clockRunning = false;
  let legT = 0;
  const clear = (out: SignalFrame): void => {
    out['nav.xtkNm'] = NaN;
    out['nav.distNm'] = NaN;
    out['nav.bearingDeg'] = NaN;
    out['nav.etaErrMin'] = NaN;
    out['nav.leg'] = NaN;
  };
  return {
    id: 'nav',
    defs: NAV_SIGNALS,
    sample(out: SignalFrame, src: TelemetrySources, dt: number): void {
      let fresh = false;
      if (src.route !== route) {
        route = src.route;
        leg = 0;
        // A route set in flight (a diversion) is timed from that moment (this frame's dt predates it).
        clockRunning = !src.state.onGround;
        legT = 0;
        fresh = true;
      }
      if (!route || legCount(route) === 0) {
        clear(out);
        return;
      }
      const s = src.state;
      const n = legCount(route);
      const north = s.position.x;
      const east = s.position.y;

      if (!clockRunning) {
        const start = route.waypoints[0];
        const radiusM = (start.passRadiusNm ?? DEFAULT_PASS_RADIUS_NM) * NM;
        if (!s.onGround && Math.hypot(north - start.north, east - start.east) > radiusM) clockRunning = true;
      } else if (dt > 0 && !fresh) legT += dt;

      let g = legGeometry(route, leg, north, east);
      // Sequence (at most one leg per frame) once the clock runs; the final leg's end completes the route.
      if (clockRunning && leg < n && (g.overhead || g.alongPastEndNm >= 0)) {
        leg++;
        legT = 0;
        if (leg < n) g = legGeometry(route, leg, north, east);
      }
      out['nav.xtkNm'] = g.xtkNm;
      out['nav.distNm'] = g.distNm;
      out['nav.bearingDeg'] = g.bearingDeg;
      out['nav.leg'] = leg;
      const gs = s.groundSpeed / KT;
      const planned = route.legMinutes[leg];
      out['nav.etaErrMin'] =
        clockRunning && leg < n && gs >= MIN_ETA_GS_KT && planned !== undefined ? legT / 60 + (g.distNm / gs) * 60 - planned : NaN;
    },
  };
}
