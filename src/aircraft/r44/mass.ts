// POH 6-4 loading arms and 6-6 sample empty aircraft; not a universal factory empty weight.
import { LB, v3 } from '../../core/math';
import type { MassDef, PayloadDef } from '../types';
import { R44_REFERENCE as V } from './reference';
import { SEAT_CENTRES } from './dimensions';
export const R44_FUEL_CAPACITY = [V.mainUsableGal * V.kgPerGal, V.auxUsableGal * V.kgPerGal] as const;
/** Occupants in kg: front left/right, rear left/right. Each occupant retains its own inertia arm.
 * Baggage under a front seat has a different arm (POH 6-4) and is not included in this helper. */
export function r44Occupants(weights: readonly [number, number, number, number]): PayloadDef {
  if (weights.some(w => !Number.isFinite(w) || w < 0)) throw new Error('Invalid R44 occupant mass');
  const payload = weights.reduce((sum, w) => sum + w, 0);
  const payloadPosition = payload > 0 ? v3.scale(SEAT_CENTRES.reduce((sum, p, i) =>
    v3.add(sum, v3.scale(p, weights[i])), v3.zero()), 1 / payload) : v3.zero();
  return { payload, payloadPosition, payloadDistribution: payload > 0 ? SEAT_CENTRES
    .flatMap((p, i) => weights[i] > 0 ? [{ fraction: weights[i] / payload, offset: v3.sub(p, payloadPosition) }] : [])
    : [{ fraction: 1, offset: v3.zero() }] };
}
const crew = r44Occupants([170 * LB, 170 * LB, 170 * LB, 170 * LB]);
const grossSeat = (990 * LB - R44_FUEL_CAPACITY[0] - R44_FUEL_CAPACITY[1]) / 4;
export const R44_SOLO = r44Occupants([0, 170 * LB, 0, 0]);
export const R44_MASS: MassDef = {
  empty: 1510 * LB, maxTakeoff: 2500 * LB, maxLanding: 2500 * LB,
  emptyCg: { x: -6.5 * 0.0254, y: 0.2 * 0.0254, z: 0 }, seatY: 0,
  // ESTIMATE: radii of gyration .67/1.23/1.16 m at four ×170 lb/full fuel.
  // Airframe/engine masses are concentrated near the mast with a long light tailcone; no measured tensor.
  inertia: { about: 'cg', Ixx: 500, Iyy: 1700, Izz: 1500, Ixz: 0 }, inertiaLoading: crew,
  // Representative physical seat loadings, checked at full and zero fuel against POH 2-4.
  loadings: { typical: R44_SOLO, forward: r44Occupants([220 * LB, 220 * LB, 110 * LB, 110 * LB]),
    aft: r44Occupants([0, 150 * LB, 170 * LB, 170 * LB]),
    maxGross: r44Occupants([grossSeat, grossSeat, grossSeat, grossSeat]) },
};
