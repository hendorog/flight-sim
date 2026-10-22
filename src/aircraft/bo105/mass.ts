// MBB Bo 105 CB-4: mass, CG and inertia as data. Owner: BO.
//
// P TCDS p10-11: maximum 2500 kg; datum 3000 mm forward of the levelling point at frame 7 (body x = 3.150 - STA, m,
// dimensions.ts); longitudinal CG forward 3081 mm at 1140 kg, 3038 at 1900 kg, 3082 at 2500 kg; aft 3395 at 2000 kg and
// below, 3270 at 2500 kg; lateral +/-100 mm to 2400 kg. P5 FM 2-2: minimum 1140 kg, pilot in the RIGHT seat. P AR-280
// Table 6.2.1: 2200 kg with Ixx 1433, Iyy 4973, Izz 4099, Ixz 660 kg m^2 (the DLR S-123 flight-test loading). The
// empty mass is S (Jane's); the seat, cargo and tank points are 3V ESTIMATES (FM Fig 1-1 and the cabin photos); the
// empty CG is DERIVED from the two rules below, not measured (no weighing record was found).
import { v3, type Vec3 } from '../../core/math';
import type { MassDef, PayloadDef } from '../types';
import { BO105_POWERPLANT } from './powerplant';
import { BO105_INERTIA, BO105_MASS_KG } from './facts';
import { BO105_REFERENCE as V } from './reference';
import { x, z, PILOT_SEAT_Y } from './dimensions';

/** Body point of a station (m aft of the datum), buttline (m, + right) and height above the skid soles (m). */
const at = (sta: number, bl: number, h: number): Vec3 => ({ x: x(sta), y: bl, z: z(h) });

/**
 * Occupant and cargo centroids (3V ESTIMATE): seated-body centroid 0.25 m above the cushion, the cushion 0.78 m below
 * the pilot's eye (dimensions.ts PILOT_EYE, STA 1.62, 1.70 m) and the body's centroid 0.23 m aft of the eye; the rear
 * bench (three seats, P TCDS p8) under the sliding doors (STA 1.82-2.80); the cargo compartment behind the bench, under
 * the engines, loaded through the aft clamshell doors (P TM 00-6). Order: pilot (front RIGHT, P TCDS p11), front left,
 * rear left, rear centre, rear right, cargo.
 */
export const BO105_SEATS: readonly Vec3[] = [
  at(1.85, PILOT_SEAT_Y, 1.17), at(1.85, -PILOT_SEAT_Y, 1.17),
  at(2.62, -0.50, 1.10), at(2.62, 0, 1.10), at(2.62, 0.50, 1.10),
  at(4.20, 0, 1.05),
];

/** Occupants and cargo in kg, in BO105_SEATS order. */
export function bo105Payload(weights: readonly number[]): PayloadDef {
  if (weights.length !== BO105_SEATS.length || weights.some((w) => !Number.isFinite(w) || w < 0)) throw new Error('Invalid Bo 105 payload masses');
  const payload = weights.reduce((sum, w) => sum + w, 0);
  const payloadPosition = payload > 0 ? v3.scale(BO105_SEATS.reduce((sum, p, i) => v3.add(sum, v3.scale(p, weights[i])), v3.zero()), 1 / payload) : v3.zero();
  return { payload, payloadPosition, payloadDistribution: payload > 0
    ? BO105_SEATS.flatMap((p, i) => weights[i] > 0 ? [{ fraction: weights[i] / payload, offset: v3.sub(p, payloadPosition) }] : [])
    : [{ fraction: 1, offset: v3.zero() }] };
}

const EMPTY = V.emptyKg;
const tanks = BO105_POWERPLANT.fuel.tanks;
const FUEL = tanks.reduce((sum, t) => sum + t.capacity, 0);

/**
 * The AR-280 flight-test loading, 2200 kg with full usable fuel (456 kg): pilot and front passenger 90 kg each, three
 * 80 kg rear passengers and 48 kg of cargo (payload 468 kg). ESTIMATE distribution (AR-280 gives the mass and inertia,
 * not the loading).
 */
export const BO105_TYPICAL = bo105Payload([90, 90, 80, 80, 80, BO105_MASS_KG.typical - EMPTY - FUEL - 420]);

/**
 * Empty-airframe component breakdown, kg at height above the skid soles, m (ESTIMATE; no weighing record or mass
 * statement was found): four blades, 88 kg, at the hub, 2.95 m (22 kg each, ESTIMATE: the 900 kg m^2 uniform blade; the
 * solver's blade of the adopted 850 kg m^2 is 20.7 kg, a 5 kg difference left inside this ESTIMATE breakdown); hub,
 * swashplate and controls 110 kg at 2.85 m; the FS 72B, 152 kg (P MM ch 11 p5) at 2.35 m; two 250-C20B with their
 * accessories and exhausts 160 kg at 2.30 m; deck, cowlings, oil and hydraulic systems 60 kg at 2.20 m; tail boom, fin,
 * stabiliser, tail rotor, gearboxes and shafts 90 kg at 1.85 m; the cabin structure 372 kg at 1.20 m; interior, seats,
 * battery, avionics and glazing 189 kg at 1.10 m; skids 55 kg at 0.25 m. Sum 1276 kg (S Jane's), height 1.75 m.
 */
export const BO105_EMPTY_CG_HEIGHT = (88 * 2.95 + 110 * 2.85 + 152 * 2.35 + 160 * 2.30 + 60 * 2.20 + 90 * 1.85 + 372 * 1.20
  + 189 * 1.10 + 55 * 0.25) / 1276;

/**
 * Empty CG (not a weighing): vertically the component breakdown above; longitudinally placed so that the typical loading's
 * CG sits at mid-envelope for 2200 kg, STA 3.202 m (P TCDS p11: forward 3038 + (3082 - 3038) x 300/600 = 3060 mm, aft
 * 3395 - (3395 - 3270) x 200/500 = 3345 mm; mid 3202.5), so the plan's "2200 kg mid-CG" rows fly it (D). Laterally on
 * the centreline. The arithmetic puts it at about STA 3.43 m.
 *
 * The typical loading's CG then sits about 1.36 m above the skid soles, 1.54 m below the hub, not the 0.96 m of the
 * Theodore model (F METU Table 9: "CG 3.15 ft below hub"; dimensions.ts keeps it as the body REFERENCE point). The METU
 * height cannot hold with the AR-280 inertia and the underfloor tanks: at 0.96 m below the hub the 456 kg of fuel
 * alone, 1.4 m below the CG, would carry 945 of the 1433 kg m^2 of Ixx, and the empty airframe's own roll inertia would
 * come out negative at 1400 kg (pilot and 44 kg of fuel). docs/bo105-flight-model.md "Mass and CG".
 */
const EMPTY_CG: Vec3 = (() => {
  const items: { m: number; p: Vec3 }[] = [
    ...BO105_TYPICAL.payloadDistribution!.map(({ fraction, offset }) => ({ m: BO105_TYPICAL.payload * fraction, p: v3.add(BO105_TYPICAL.payloadPosition, offset) })),
    ...tanks.map((t) => ({ m: t.capacity, p: t.position })),
  ];
  const total = EMPTY + items.reduce((s, i) => s + i.m, 0);
  const mx = items.reduce((s, i) => s + i.m * i.p.x, 0);
  return { x: (x(3.2025) * total - mx) / EMPTY, y: 0, z: z(BO105_EMPTY_CG_HEIGHT) };
})();

/** Maximum mass, 2500 kg, full fuel: two 100 kg crew, three 110 kg rear passengers and 238 kg of cargo (payload 768 kg):
 *  CG STA 3.247 m, inside 3.082-3.270 at 2500 kg (P TCDS p11; five 90 kg occupants with 318 kg of cargo sit at 3.303,
 *  aft of the limit). */
export const BO105_MAX_GROSS = bo105Payload([100, 100, 110, 110, 110, BO105_MASS_KG.max - EMPTY - FUEL - 530]);

export const BO105_MASS: MassDef = {
  empty: EMPTY, maxTakeoff: BO105_MASS_KG.max, maxLanding: BO105_MASS_KG.max,
  emptyCg: EMPTY_CG,
  seatY: PILOT_SEAT_Y,
  // P AR-280 Table 6.2.1, about the CG of the flight-test loading (2200 kg). Other loadings move the point masses
  // (massModel.ts): at 2500 kg the model gives about 1.05-1.1 x these (research-bo105 section 15: <= 1630/5650/4660/750).
  inertia: { about: 'cg', ...BO105_INERTIA },
  inertiaLoading: BO105_TYPICAL,
  loadings: {
    typical: BO105_TYPICAL,
    // Pilot and front passenger (100 kg each), full fuel: 1932 kg at STA 3.236, the most forward of these loadings (the
    // empty CG sits aft, about STA 3.43: the envelope's forward limit, 3.04 at 1900 kg, needs ballast in the nose).
    forward: bo105Payload([100, 100, 0, 0, 0, 0]),
    // Pilot (80 kg), three 100 kg rear passengers and 120 kg of cargo, full fuel: 2232 kg, near the aft limit.
    aft: bo105Payload([80, 0, 100, 100, 100, 120]),
    maxGross: BO105_MAX_GROSS,
  },
};
