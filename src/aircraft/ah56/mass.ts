// Lockheed AH-56A Cheyenne: mass, CG and inertia as data. Owner: AG (stage 2).
//
// P: the AMCS test condition 18,300 lb at FS 298.0 +/- 1 in, gear down (AMCS-73 p 37); production empty weight 12,874 lb
// (ASTA-72 App J p 144); maximum gross 20,500 lb (ICS 1972 release) and 19,200 lb (AMCS release, AMCS-73 p 37). The
// TOW-mission gross 18,750 lb (P) is a loading below. Usable fuel 2,500 lb is an ESTIMATE (capacity not found).
// The payload (crew 2 x 200 lb, armour, the turrets and their ammunition, stores: the difference between the empty and
// the test weight, 2,926 lb) sits at FS 250 (ESTIMATE: crew FS 124/170, belly turret FS 190, stores near FS 300); the
// empty CG (FS 308.5, D) then puts the test loading at FS 298 (P). Heights: the CG water line is WL 95 by definition of
// the axes (dimensions.ts, ESTIMATE). Inertias ESTIMATE (plan sect. 0 item 9; research-ah56 sect. 4): the AH-1G's radii
// of gyration scaled by the fuselage length (54.7 / 44.6 ft) with kx raised for the wing and stores.
import { LB, type Vec3 } from '../../core/math';
import type { MassDef, PayloadDef } from '../types';
import { AH56_FUEL_CAPACITY } from './powerplant';
import { AH56_INERTIA, AH56_MASS_LB } from './facts';
import { x, z } from './dimensions';

/** Body point of a fuselage station / water line on the centreline. */
const at = (fs: number, wl: number): Vec3 => ({ x: x(fs), y: 0, z: z(wl) });

const FUEL_LB = AH56_FUEL_CAPACITY / LB;
/** Payload centroid station, in (ESTIMATE, above). */
export const AH56_PAYLOAD_FS = 250;
/** Payload at a total weight, lb, with `fuelFraction` of the usable fuel. */
export function ah56Loading(totalLb: number, fs = AH56_PAYLOAD_FS, fuelFraction = 1): PayloadDef {
  const payload = (totalLb - AH56_MASS_LB.empty - FUEL_LB * fuelFraction) * LB;
  return { payload, payloadPosition: at(fs, 90), fuelFraction };
}

/** The test loading: 18,300 lb with full fuel at FS 298 (P). */
export const AH56_TEST_LOADING = ah56Loading(AH56_MASS_LB.test);
/** Empty CG station, in (D: the test loading balances at FS 298 with the fuel at FS 300). */
const EMPTY_FS = (AH56_MASS_LB.test * 298 - FUEL_LB * 300 - (AH56_MASS_LB.test - AH56_MASS_LB.empty - FUEL_LB) * AH56_PAYLOAD_FS) / AH56_MASS_LB.empty;

export const AH56_MASS: MassDef = {
  empty: AH56_MASS_LB.empty * LB, maxTakeoff: AH56_MASS_LB.maxIcs * LB, maxLanding: AH56_MASS_LB.maxIcs * LB,
  emptyCg: at(EMPTY_FS, 98),
  seatY: 0,
  inertia: { about: 'cg', ...AH56_INERTIA },
  inertiaLoading: AH56_TEST_LOADING,
  loadings: {
    typical: AH56_TEST_LOADING,
    // The TOW-mission gross weight (P 18,750 lb) with the stores forward: FS 294 (forward of the 1972 mid CG 296.4, P).
    forward: ah56Loading(AH56_MASS_LB.towMission, 235),
    // The test weight at the aft limit, FS 299.8 (P 1972 aft CG 299.0-299.8): the payload centroid at FS 261.
    aft: ah56Loading(AH56_MASS_LB.test, 261),
    // The ICS release's 20,500 lb (P).
    maxGross: ah56Loading(AH56_MASS_LB.maxIcs),
  },
};
