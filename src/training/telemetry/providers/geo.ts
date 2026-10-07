// Geo provider ('geo'): airfield geometry in the runway 07 frame (rwyAlongM, rwyAcrossM, distAimFt,
// gpDevFt, onRunway, onPaved, pastHoldLine, circuitLeg, downwindOffsetNm, headwindKt, crosswindKt).
//
// Positions are of the aircraft reference point (AircraftState.position, within a few cm of the CG) except
// pastHoldLine, which uses the spinner: the hold line is crossed when the nose crosses it. The 3 deg path and
// the aim point are the final-approach scenario's (scenarios.ts GLIDE_PATH, AIM_POINT), so a 'final' start
// begins exactly on the path (gpDevFt 0).

import { FT, NM, RAD } from '../../../core/math';
import { C172 } from '../../../core/c172';
import { AIRPORT, runwayCoords } from '../../../core/world';
import { AIM_POINT, GLIDE_PATH } from '../../../sim/scenarios';
import { airportSurface, HOLD_LINE_V, isOnRunway } from '../../../world/airport/layout';
import { classifyCircuitLeg } from '../../geo/circuit';
import type { CircuitLeg, SignalDef, SignalFrame, SignalProvider, TelemetrySources } from '../../types';
import { defineSignals } from './define';

const HALF_LENGTH = AIRPORT.runway.length / 2;
const RWY_HDG_DEG = AIRPORT.runway.heading * RAD;
/** The runway's protected area (inside the hold lines) extends this far beyond each runway end, m. */
const PROTECTED_BEYOND_END_M = 60;

export const GEO_SIGNALS: readonly SignalDef[] = defineSignals([
  ['rwyAlongM', 'number', 'm', 0, 'Distance from the 07 threshold along the runway, + toward the 25 end'],
  ['rwyAcrossM', 'number', 'm', 1, 'Distance from the 07 centreline, + right (dead side)'],
  ['distAimFt', 'number', 'ft', 0, 'Distance beyond the aim point (150 m past the 07 threshold), - short'],
  ['gpDevFt', 'number', 'ft', 0, 'Height above the 3 deg path to the aim point, + high'],
  ['onRunway', 'bool', '', 0, 'Over the runway surface (position, airborne or not)'],
  ['onPaved', 'bool', '', 0, 'Over the runway, a taxiway or the apron'],
  ['pastHoldLine', 'bool', '', 0, 'On the ground with the nose inside the runway hold lines'],
  ['circuitLeg', 'enum', '', 0, 'Leg of the left-hand circuit for 07 (geo/circuit.ts)'],
  ['downwindOffsetNm', 'number', 'NM', 0, 'Distance from the extended centreline, + on the downwind (left) side'],
  ['headwindKt', 'number', 'kt', 0, 'Steady wind along runway 07, + headwind'],
  ['crosswindKt', 'number', 'kt', 0, 'Steady wind across runway 07, + from the right'],
]);

/** Height of the 3 deg path to the aim point above the field, ft, at `alongThrM` past the 07 threshold. */
export function glidePathHeightFt(alongThrM: number): number {
  return (Math.max(0, AIM_POINT - alongThrM) * Math.tan(GLIDE_PATH)) / FT;
}

export function createGeoProvider(): SignalProvider {
  let leg: CircuitLeg = 'none';
  return {
    id: 'geo',
    defs: GEO_SIGNALS,
    sample(out: SignalFrame, src: TelemetrySources): void {
      const s = src.state;
      const n = s.position.x;
      const e = s.position.y;
      const { along, across } = runwayCoords(n, e);
      const alongThr = along + HALF_LENGTH;
      out.rwyAlongM = alongThr;
      out.rwyAcrossM = across;
      out.distAimFt = (alongThr - AIM_POINT) / FT;
      out.gpDevFt = (s.altitudeMSL - AIRPORT.elevation) / FT - glidePathHeightFt(alongThr);
      out.onRunway = isOnRunway(along, across);
      out.onPaved = airportSurface(n, e) !== null;

      const nose = runwayCoords(n + Math.cos(s.heading) * C172.fuselage.noseX, e + Math.sin(s.heading) * C172.fuselage.noseX);
      out.pastHoldLine = s.onGround && Math.abs(nose.across) < -HOLD_LINE_V && Math.abs(nose.along) <= HALF_LENGTH + PROTECTED_BEYOND_END_M;

      leg = classifyCircuitLeg(n, e, s.heading * RAD, s.onGround, leg);
      out.circuitLeg = leg;
      out.downwindOffsetNm = -across / NM;

      const w = src.weather;
      const rel = (w.windDirectionDeg - RWY_HDG_DEG) / RAD;
      out.headwindKt = w.windSpeedKt * Math.cos(rel);
      out.crosswindKt = w.windSpeedKt * Math.sin(rel);
    },
  };
}
