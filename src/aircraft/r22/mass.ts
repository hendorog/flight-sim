import type { MassDef } from '../types';

const LB = 0.45359237, IN = 0.0254;
export const R22_FUEL_CAPACITY = [16.9 * 6 * LB, 9.4 * 6 * LB] as const;
const crew = { payload: 330 * LB, payloadPosition: { x: 22 * IN, y: 0.7 * IN, z: 0 } };
export const R22_SOLO = { payload: 170 * LB, payloadPosition: { x: 22 * IN, y: 10.7 * IN, z: 0 } };
/** POH 6-6 sample: 880 lb at station 104.0, lateral −0.1 in. Datum is 100 in ahead of mast.
 * Vertical CG and inertias are estimates: radii of gyration ~.60/.95/.91 m at the two-seat loading.
 * Payload uses its actual centroid; the common mass model's symmetric-seat inertia approximation is disabled.
 */
export const R22_MASS: MassDef = {
  empty: 880 * LB, maxTakeoff: 1370 * LB, maxLanding: 1370 * LB,
  emptyCg: { x: -4 * IN, y: -0.1 * IN, z: 0 }, seatY: 0,
  inertia: { about: 'cg', Ixx: 220, Iyy: 560, Izz: 510, Ixz: 0 }, inertiaLoading: crew,
  loadings: { typical: R22_SOLO,
    forward: { ...crew, payloadPosition: { ...crew.payloadPosition, x: 0.62 } },
    aft: { ...R22_SOLO, payloadPosition: { ...R22_SOLO.payloadPosition, x: 0.5 } },
    maxGross: { ...crew, payload: (1370 - 880) * LB - R22_FUEL_CAPACITY[0] - R22_FUEL_CAPACITY[1] } },
};
