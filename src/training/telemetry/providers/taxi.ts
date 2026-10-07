// Taxi provider ('taxi'): progress along TelemetrySources.taxiRoute (geo/taxiRoute.ts), the ground route the
// instructor is guiding: distance along and to go, cross-track from the yellow line, the next junction (its
// action, name, distance and relative bearing) and the distance to the hold-short point. NaN / '' / false
// (evaluates false) while no route is set.
//
// Progress is tracked, not recomputed: each frame searches near the previous fix (geo fixOnRoute), so a route
// that doubles back past itself never jumps ahead. A new route object restarts it.

import { RAD } from '../../../core/math';
import { wrap180 } from '../../geo/angles';
import { fixOnRoute } from '../../geo/taxiRoute';
import type { SignalDef, SignalFrame, SignalProvider, TaxiRoute, TelemetrySources } from '../../types';
import { defineSignals } from './define';

/** A junction counts as passed this far beyond its mid-turn point, m (the turn is then being completed). */
const PASSED_M = 2;

export const TAXI_SIGNALS: readonly SignalDef[] = defineSignals([
  ['taxi.active', 'bool', '', 0, 'A taxi route is being followed'],
  ['taxi.alongM', 'number', 'm', 0, 'Distance along the taxi route from its start'],
  ['taxi.routeDistM', 'number', 'm', 1, 'Distance to go along the taxi route'],
  ['taxi.xtrackM', 'number', 'm', 0.3, 'Distance from the taxi route centreline, + right'],
  ['taxi.nextWp', 'number', '', 0, 'Index of the next junction (TaxiRoute.waypoints)'],
  ['taxi.nextWpDistM', 'number', 'm', 1, 'Distance along the route to the next junction'],
  ['taxi.nextWpRelBrgDeg', 'angle', 'deg', 2, 'Bearing of the next junction relative to the nose, + right'],
  ['taxi.nextAction', 'enum', '', 0, "What happens at the next junction: 'left', 'right', 'straight', 'holdShort', 'stop'"],
  ['taxi.nextName', 'enum', '', 0, "Taxiway entered at the next junction ('B1', 'A', 'A1'; 'apron')"],
  ['taxi.holdShortDistM', 'number', 'm', 1, 'Distance along the route to the hold-short point (NaN: route ends at a stand)'],
]);

export function createTaxiProvider(): SignalProvider {
  let route: TaxiRoute | null = null;
  let s = NaN;
  const clear = (out: SignalFrame): void => {
    out['taxi.active'] = false;
    for (const id of ['taxi.alongM', 'taxi.routeDistM', 'taxi.xtrackM', 'taxi.nextWp', 'taxi.nextWpDistM', 'taxi.nextWpRelBrgDeg', 'taxi.holdShortDistM']) out[id] = NaN;
    out['taxi.nextAction'] = '';
    out['taxi.nextName'] = '';
  };
  return {
    id: 'taxi',
    defs: TAXI_SIGNALS,
    sample(out: SignalFrame, src: TelemetrySources): void {
      const r = src.taxiRoute ?? null;
      if (r !== route) {
        route = r;
        s = NaN;
      }
      if (!r || r.points.length < 2) {
        clear(out);
        return;
      }
      const st = src.state;
      const north = st.position.x;
      const east = st.position.y;
      const fix = fixOnRoute(r, north, east, Number.isFinite(s) ? s : undefined);
      s = fix.sM;
      const wps = r.waypoints;
      let i = wps.findIndex((w) => w.sM > s - PASSED_M);
      if (i < 0) i = wps.length - 1;
      const w = wps[i];
      out['taxi.active'] = true;
      out['taxi.alongM'] = s;
      out['taxi.routeDistM'] = Math.max(0, r.lengthM - s);
      out['taxi.xtrackM'] = fix.xtrackM;
      out['taxi.nextWp'] = i;
      out['taxi.nextWpDistM'] = w.sM - s;
      const brg = Math.atan2(w.east - east, w.north - north) * RAD;
      out['taxi.nextWpRelBrgDeg'] = wrap180(brg - st.heading * RAD);
      out['taxi.nextAction'] = w.action;
      out['taxi.nextName'] = w.name;
      out['taxi.holdShortDistM'] = r.holdShort ? r.lengthM - s : NaN;
    },
  };
}
