// PLACEHOLDER mass/inertia, using POH 6-4 arms and 6-6 sample empty aircraft (not a universal empty weight).
import { LB, v3 } from '../../core/math';
import type { MassDef, PayloadDef } from '../types';
import { R44_REFERENCE as V } from './reference';
import { SEAT_CENTRES } from './dimensions';
export const R44_FUEL_CAPACITY = [V.mainUsableGal * V.kgPerGal, V.auxUsableGal * V.kgPerGal] as const;
const crewPosition = v3.scale(SEAT_CENTRES.reduce((sum, p) => v3.add(sum, p), v3.zero()), 0.25);
const crew: PayloadDef = { payload: 680 * LB, payloadPosition: crewPosition,
  payloadDistribution: SEAT_CENTRES.map(p => ({ fraction: 0.25, offset: v3.sub(p, crewPosition) })) };
export const R44_SOLO: PayloadDef = { payload: 170 * LB, payloadPosition: SEAT_CENTRES[1],
  payloadDistribution: [{ fraction: 1, offset: { x: 0, y: 0, z: 0 } }] };
export const R44_MASS: MassDef = {
  empty: 1510 * LB, maxTakeoff: 2500 * LB, maxLanding: 2500 * LB,
  emptyCg: { x: -6.5 * 0.0254, y: 0.2 * 0.0254, z: 0 }, seatY: 0,
  // ESTIMATED body inertias at four ×170 lb occupants/full fuel. Not measured or flight validated.
  inertia: { about: 'cg', Ixx: 500, Iyy: 1700, Izz: 1500, Ixz: 0 }, inertiaLoading: crew,
  loadings: { typical: R44_SOLO, forward: { ...crew, payloadPosition: { ...crewPosition, x: 1.10 } },
    aft: { ...crew, payloadPosition: { ...crewPosition, x: 0.75 } },
    maxGross: { ...crew, payload: 990 * LB - R44_FUEL_CAPACITY[0] - R44_FUEL_CAPACITY[1] } },
};
