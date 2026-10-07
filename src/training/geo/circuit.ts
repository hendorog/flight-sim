// Circuit leg classification for the left-hand circuit of runway 07 (rules in section 2.3).
//
// Geometry is in the runway frame of core/world.ts: `along` from the runway centre (+ toward the 25 end, the
// direction of the 07 take-off), `across` + right of the 07 centreline. Left-hand circuits for 07 put the
// downwind leg on the north-west side (across < 0); the right side (across > 0) is the dead side. "Near
// threshold" is the 07 landing threshold (along -900 m), "far threshold" the 25 end (along +900 m).
//
// The section 2.3 rules, checked in this order (first match wins):
//   ground     on the ground
//   final      heading within 30 deg of 070, short of the 07 threshold, |across| < 400 m
//   downwind   heading within 30 deg of 250, 500-2000 m on the downwind side
//   base       heading within 40 deg of 160, beyond the near threshold (along < -900 m)
//   crosswind  after upwind (prev upwind or crosswind), turned more than 30 deg off 070 toward the
//              downwind side, until the downwind rule takes over
//   upwind     beyond the far threshold with |across| < 600 m
//   deadside   on the right of the runway within 1.5 NM
//   none       anything else
// Where the spec is silent, four additions keep a flown circuit continuous (each uses `prev`, like crosswind):
//   - Once on final, the heading may be up to 45 deg off 070 (correcting an overshoot of the centreline on
//     the turn from base) before it stops reading final.
//   - Over the runway: a final continues over the runway (the flare, a low approach) while still aligned;
//     otherwise an aligned aircraft over the runway is 'upwind' (the climb-out after take-off or a go-around
//     is the start of the upwind leg). Upwind also needs the heading within 45 deg of 070, so an aircraft
//     crossing the runway's far end the other way is not on upwind.
//   - Crosswind lasts while the heading is within 100 deg of 340, so the roll-out onto a downwind that is
//     still inside 500 m stays crosswind.
//   - Turning: during the left turn from crosswind, downwind or base toward the next leg (heading between the
//     leg's own and 90 deg left of it, within 3 NM of the runway) the leg persists until the next leg's rule
//     matches, instead of reading 'none' halfway round the turn.

import { NM } from '../../core/math';
import { AIRPORT, runwayCoords } from '../../core/world';
import type { CircuitLeg } from '../types';
import { angleDiff, wrap180 } from './angles';

const RWY_HDG = (AIRPORT.runway.heading * 180) / Math.PI; // 070
const HALF_LENGTH = AIRPORT.runway.length / 2;
const HALF_WIDTH = AIRPORT.runway.width / 2;

/** Nominal heading of each leg of the left-hand circuit for 07, degrees true. */
export const LEG_HEADING_DEG = {
  upwind: RWY_HDG, // 070
  crosswind: RWY_HDG - 90, // 340
  downwind: RWY_HDG + 180, // 250
  base: RWY_HDG + 90, // 160
  final: RWY_HDG, // 070
} as const;

export const CIRCUIT_RULES = {
  finalHdgTolDeg: 30,
  /** Once on final, the heading may swing this far while correcting an overshoot of the centreline. */
  finalStayHdgTolDeg: 45,
  finalMaxAcrossM: 400,
  downwindHdgTolDeg: 30,
  downwindOffsetM: [500, 2000] as const,
  baseHdgTolDeg: 40,
  crosswindMinTurnDeg: 30,
  crosswindMaxOffLegDeg: 100,
  upwindHdgTolDeg: 45,
  upwindMaxAcrossM: 600,
  deadsideRangeM: 1.5 * NM,
  /** A leg persists through the turn onto the next while within this distance of the runway. */
  turnRangeM: 3 * NM,
} as const;

/**
 * Classify a position and heading (true, degrees) into a circuit leg. `prev` is the previous result: the
 * crosswind leg is "turning toward the downwind side" after upwind, which needs it.
 */
export function classifyCircuitLeg(north: number, east: number, hdgDeg: number, onGround: boolean, prev: CircuitLeg): CircuitLeg {
  if (onGround) return 'ground';
  if (!Number.isFinite(north) || !Number.isFinite(east) || !Number.isFinite(hdgDeg)) return 'none';
  const R = CIRCUIT_RULES;
  const { along, across } = runwayCoords(north, east);
  const offRwy = angleDiff(hdgDeg, RWY_HDG);
  const overRunway = along >= -HALF_LENGTH && along <= HALF_LENGTH;

  const finalHdgTol = prev === 'final' ? R.finalStayHdgTolDeg : R.finalHdgTolDeg;
  if (offRwy <= finalHdgTol && Math.abs(across) < R.finalMaxAcrossM && (along < -HALF_LENGTH || (prev === 'final' && overRunway))) return 'final';
  if (angleDiff(hdgDeg, LEG_HEADING_DEG.downwind) <= R.downwindHdgTolDeg && -across >= R.downwindOffsetM[0] && -across <= R.downwindOffsetM[1]) return 'downwind';
  if (angleDiff(hdgDeg, LEG_HEADING_DEG.base) <= R.baseHdgTolDeg && along < -HALF_LENGTH) return 'base';
  if ((prev === 'upwind' || prev === 'crosswind') && offRwy > R.crosswindMinTurnDeg && angleDiff(hdgDeg, LEG_HEADING_DEG.crosswind) <= R.crosswindMaxOffLegDeg) {
    return 'crosswind';
  }
  if (Math.abs(across) < R.upwindMaxAcrossM && offRwy <= R.upwindHdgTolDeg && along >= -HALF_LENGTH) return 'upwind';
  const dist = distToRunwayM(along, across);
  if ((prev === 'crosswind' || prev === 'downwind' || prev === 'base') && dist <= R.turnRangeM) {
    const turnedLeft = wrap180(LEG_HEADING_DEG[prev] - hdgDeg);
    if (turnedLeft >= 0 && turnedLeft <= 90) return prev;
  }
  if (across > HALF_WIDTH && dist <= R.deadsideRangeM) return 'deadside';
  return 'none';
}

/** Horizontal distance from the runway centreline segment (threshold to threshold), m. */
function distToRunwayM(along: number, across: number): number {
  const beyond = Math.max(0, Math.abs(along) - HALF_LENGTH);
  return Math.hypot(beyond, across);
}
