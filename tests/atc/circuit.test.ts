// The AI circuit (src/atc/circuit.ts): the legs sit where the radio's circuitLeg() names them, and the stepper flies
// a whole circuit with a touch and go on the runway, within the circuit's radius and height.

import { describe, expect, it } from 'vitest';
import { activeFrame, circuitLeg, CIRCUIT_RADIUS } from '../../src/atc/calls';
import { CIRCUIT_HEIGHT, circuitPath, pathPoint, placeOnLeg, stepTraffic, type LegId } from '../../src/atc/circuit';
import { HOME_AIRFIELD as H, type Airfield } from '../../src/world/airfields';

const right: Airfield = { ...H, circuit: 'right' };
/** A short grass strip like the smallest generated fields. */
const strip: Airfield = { ...H, length: 650, width: 30, circuit: 'right' };

describe.each([
  ['left, 07', H, 0],
  ['left, 25', H, 1],
  ['right, 07', right, 0],
  ['right, 25', right, 1],
  ['650 m strip, 07', strip, 0],
  ['650 m strip, 25', strip, 1],
] as const)('circuit %s', (_name, field, end) => {
  const path = circuitPath(field, end);

  it('names each leg at its midpoint as the radio menu would', () => {
    for (const [i, l] of path.legs.entries()) {
      const s = placeOnLeg(path, i, 0.5);
      expect(circuitLeg(field, end, s.north, s.east, s.heading)).toBe(l.id);
    }
  });

  it('flies the circuit: legs in order, a touchdown in the touchdown zone, inside the circuit', () => {
    // Placed late on final: the first landing must fit the runway too.
    const s = placeOnLeg(path, 4, 0.9);
    const legs: LegId[] = [];
    const touchdowns: number[] = [];
    let maxDist = 0, maxH = 0, maxBank = 0, t = 0;
    let wasGround = false;
    for (; t < 900; t += 0.1) {
      const c = stepTraffic(path, s, 0.1);
      if (c !== null) legs.push(path.legs[c].id);
      if (wasGround && !s.onGround) expect(activeFrame(field, end, s.north, s.east).along).toBeLessThan(field.length / 2 - 50);
      if (s.onGround && !wasGround) {
        touchdowns.push(activeFrame(field, end, s.north, s.east).along);
      }
      wasGround = s.onGround;
      maxDist = Math.max(maxDist, Math.hypot(s.north - field.north, s.east - field.east));
      maxH = Math.max(maxH, s.height);
      maxBank = Math.max(maxBank, Math.abs(s.bank));
      if (!s.onGround && s.leg === 4) {
        const { across } = activeFrame(field, end, s.north, s.east);
        const thr = pathPoint(path, -field.length / 2, 0);
        if (Math.hypot(s.north - thr.north, s.east - thr.east) < 800) expect(Math.abs(across)).toBeLessThan(15);
      }
    }
    expect(legs.slice(0, 6)).toEqual(['upwind', 'crosswind', 'downwind', 'base', 'final', 'upwind']);
    for (const a of touchdowns) {
      expect(a).toBeGreaterThan(-field.length / 2 + 30);
      expect(a).toBeLessThan(-field.length / 2 + 450);
    }
    expect(touchdowns.length).toBeGreaterThanOrEqual(2);
    expect(maxDist).toBeLessThan(CIRCUIT_RADIUS);
    expect(maxH).toBeLessThan(CIRCUIT_HEIGHT + 10);
    expect(maxBank).toBeLessThanOrEqual((25 * Math.PI) / 180 + 1e-9);
  });
});
