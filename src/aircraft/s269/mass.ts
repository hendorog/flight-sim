import { LB } from '../../core/math';
import type { MassDef } from '../types';
import { SEAT_CENTRES, PILOT_SEAT } from './dimensions';
import { S269_REFERENCE as V } from './reference';
export const S269_FUEL_CAPACITY = V.mainUsableGal * V.kgPerGal;
export const S269_SOLO = { payload: 170 * LB, payloadPosition: SEAT_CENTRES[PILOT_SEAT],
  payloadDistribution: [{ fraction: 1, offset: { x: 0, y: 0, z: 0 } }] };
const crewY = (SEAT_CENTRES[0].y + SEAT_CENTRES[1].y) / 2;
const crew = { payload: 340 * LB, payloadPosition: { ...SEAT_CENTRES[0], y: crewY },
  payloadDistribution: SEAT_CENTRES.map(p => ({ fraction: 0.5, offset: { x: 0, y: p.y - crewY, z: 0 } })) };
/** Published sample aircraft only: RFM 6-5/6-6, 1105 lb, FS100.7, lateral +0.6 in.
 * RFM 2-5 / FAA 4H12: 1750 lb maximum. z/inertia ESTIMATES; no mass survey obtained. */
export const S269_MASS: MassDef = {
  empty: 1105 * LB, maxTakeoff: 1750 * LB, maxLanding: 1750 * LB,
  emptyCg: { x: -0.7 * 0.0254, y: 0.6 * 0.0254, z: 0 }, seatY: 0,
  inertia: { about: 'cg', Ixx: 300, Iyy: 750, Izz: 650, Ixz: 0 }, inertiaLoading: crew,
  loadings: { typical: S269_SOLO, forward: crew, aft: S269_SOLO,
    maxGross: { ...crew, payload: (1750 - 1105) * LB - S269_FUEL_CAPACITY } },
};
