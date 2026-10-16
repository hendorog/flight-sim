// MD 500E (369E): mass, CG and inertia as data. Owner: T2.
//
// RFM 6-1 / 6-3 / 6-7: datum STA 0 = 100 in ahead of the rotor centreline (the body origin is on the mast);
// longitudinal CG 99.0 in forward at all weights, aft 103.0 at 3000 lb to 107.4 at 1538 lb; lateral +/-3.0 in.
// Seats: pilot (LH command) STA 73.5 BL -13.0, RH front passenger BL +15.5, two aft passengers STA 105 BL -/+12.2
// (TCDS p13; RFM Fig 6-2). Empty: the RFM 6-7 sample basic weight, 1510 lb at STA 109.0 (P, a 1982 sample aircraft;
// the 2023 standard empty weight is 1657 lb, M). Heights and the inertia tensor are ESTIMATES (below).
import { LB, v3, type Vec3 } from '../../core/math';
import type { MassDef, PayloadDef } from '../types';
import { MD500_FUEL_CAPACITY } from './powerplant';
import { MD500_REFERENCE as V } from './reference';
import { SKID_Z, GROUND_WL_BELOW } from './dimensions';

const IN = 0.0254;
/** Body point of a station / buttline / waterline (dimensions.ts axes). */
const at = (sta: number, bl: number, wl: number): Vec3 => ({ x: (100 - sta) * IN, y: bl * IN, z: SKID_Z - (wl + GROUND_WL_BELOW) * IN });

/**
 * Occupant centroids: the seat arms above, seated-body centroid ESTIMATE WL 33 (about 11 in above the corner seat
 * pan WL 21.5, RFM Fig 6-3). Order: pilot (front left), front right, aft left, aft right.
 */
export const MD500_SEATS: readonly Vec3[] = [at(73.5, -13.0, 33), at(73.5, 15.5, 33), at(105, -12.2, 33), at(105, 12.2, 33)];

/** Occupants in kg, in MD500_SEATS order. */
export function md500Occupants(weights: readonly number[]): PayloadDef {
  if (weights.length !== MD500_SEATS.length || weights.some((w) => !Number.isFinite(w) || w < 0)) throw new Error('Invalid MD 500E occupant masses');
  const payload = weights.reduce((sum, w) => sum + w, 0);
  const payloadPosition = payload > 0 ? v3.scale(MD500_SEATS.reduce((sum, p, i) => v3.add(sum, v3.scale(p, weights[i])), v3.zero()), 1 / payload) : v3.zero();
  return { payload, payloadPosition, payloadDistribution: payload > 0
    ? MD500_SEATS.flatMap((p, i) => weights[i] > 0 ? [{ fraction: weights[i] / payload, offset: v3.sub(p, payloadPosition) }] : [])
    : [{ fraction: 1, offset: v3.zero() }] };
}

const EMPTY_LB = V.sampleEmpty.lb;
const FUEL_LB = MD500_FUEL_CAPACITY / LB;
/** Four equal occupants bring full fuel to the 3000 lb maximum (CG 100.4 in, inside 99.0-103.0). */
const gross = (V.maxGrossLb - EMPTY_LB - FUEL_LB) / 4 * LB;
/** Pilot alone, full fuel: 2102 lb at 103.9 in. */
export const MD500_SOLO = md500Occupants([170 * LB, 0, 0, 0]);
export const MD500_MAX_GROSS = md500Occupants([gross, gross, gross, gross]);

export const MD500_MASS: MassDef = {
  empty: EMPTY_LB * LB, maxTakeoff: V.maxGrossLb * LB, maxLanding: V.maxGrossLb * LB,
  // RFM 6-7: STA 109.0, BL 0. Height ESTIMATE WL 50 (engine and transmission above the cabin; the OH-6A's loaded CG
  // is WL 49.6, Heffley p38, F).
  emptyCg: at(V.sampleEmpty.stationIn, 0, 50),
  seatY: 0,
  // ESTIMATE at 3000 lb (research-md500 sect. 14): the OH-6A at 2550 lb (Ixx 446, Iyy 1219, Izz 979, Ixz 128 kg m^2;
  // Heffley p38 Fig II-3, F) scaled by the mass (1.18) and about 5 % for the longer boom, T-tail and fifth blade.
  inertia: { about: 'cg', Ixx: 550, Iyy: 1500, Izz: 1200, Ixz: 150 },
  inertiaLoading: MD500_MAX_GROSS,
  loadings: {
    typical: MD500_SOLO,
    // Two 200 lb occupants in front, full fuel: 2332 lb at 100.9 in (the forward side of the envelope).
    forward: md500Occupants([200 * LB, 200 * LB, 0, 0]),
    // Pilot and two 200 lb passengers aft, full fuel: 2502 lb at 104.0 in (aft limit 104.5 at that weight).
    aft: md500Occupants([170 * LB, 0, 200 * LB, 200 * LB]),
    maxGross: MD500_MAX_GROSS,
  },
};
