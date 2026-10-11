import { LB, v3 } from '../../core/math';
import type { MassDef, PayloadDef } from '../types';
import { SEAT_CENTRES, PILOT_SEAT } from './dimensions';
import { S269_REFERENCE as V } from './reference';
export const S269_FUEL_CAPACITY = V.mainUsableGal * V.kgPerGal;
/** Occupants in kg, left then right. Individual seat arms also preserve loading inertia.
 * Seat arms are published; the empty tensor and seat heights remain estimates. */
export function s269Occupants(weights: readonly [number, number]): PayloadDef {
  if (weights.some(w => !Number.isFinite(w) || w < 0)) throw new Error('Invalid 269 occupant mass');
  const payload = weights[0] + weights[1];
  const payloadPosition = payload > 0 ? v3.scale(SEAT_CENTRES.reduce((sum, p, i) =>
    v3.add(sum, v3.scale(p, weights[i])), v3.zero()), 1 / payload) : v3.zero();
  return { payload, payloadPosition, payloadDistribution: payload > 0 ? SEAT_CENTRES.flatMap((p, i) =>
    weights[i] > 0 ? [{ fraction: weights[i] / payload, offset: v3.sub(p, payloadPosition) }] : [])
    : [{ fraction: 1, offset: v3.zero() }] };
}
export const S269_SOLO = s269Occupants(PILOT_SEAT === 1 ? [0, 170 * LB] : [170 * LB, 0]);
const crew = s269Occupants([170 * LB, 170 * LB]);
const grossSeat = ((1750 - 1105) * LB - S269_FUEL_CAPACITY) / 2;
/** Published sample aircraft only: RFM 6-5/6-6, 1105 lb, FS100.7, lateral +0.6 in.
 * RFM 2-5 / FAA 4H12: 1750 lb maximum. z/inertia ESTIMATES; no mass survey obtained. */
export const S269_MASS: MassDef = {
  empty: 1105 * LB, maxTakeoff: 1750 * LB, maxLanding: 1750 * LB,
  emptyCg: { x: -0.7 * 0.0254, y: 0.6 * 0.0254, z: 0 }, seatY: 0,
  inertia: { about: 'cg', Ixx: 300, Iyy: 750, Izz: 650, Ixz: 0 }, inertiaLoading: crew,
  loadings: { typical: S269_SOLO, forward: crew, aft: S269_SOLO,
    maxGross: s269Occupants([grossSeat, grossSeat]) },
};
