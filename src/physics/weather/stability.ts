// Static stability of the free atmosphere for the mountain-wave solver (orography/): the Brunt-Vaisala frequency
// N^2 = (g / T)(g / cp + dT/dz) from the atmosphere model (uniform ISA deviation, or the temperature profile of the
// manual wind-aloft levels). ISA gives N = 0.0112 1/s at 5 km and 0.0210 1/s above the tropopause.
//
// Daytime convection mixes the lowest layer and weakens the launching of waves: their amplitude is scaled by
// convectiveWaveFactor(wStar) = 1 - CONVECTIVE_WEAKENING wStar / CONVECTIVE_MAX (unconfirmed), applied at lookup, so
// the solution is not recomputed while the clock runs.

import type { AtmosphereSample } from '../../core/types';
import { atmosphereInto, lapseRateAt, type AtmosphereConditions } from '../atmosphere';

const G = 9.80665;
/** Specific heat of dry air at constant pressure, J/(kg K). */
export const CP_AIR = 1004.7;
/** Smallest N^2 the solver is given (a neutral or unstable layer is treated as weakly stable), 1/s^2. Unconfirmed. */
export const MIN_N2 = 1e-6;
/** Share of the wave amplitude removed at the strongest convection (CONVECTIVE_MAX). Unconfirmed. */
const CONVECTIVE_WEAKENING = 0.5;
/** windField.ts CONVECTIVE_MAX, m/s. */
const CONVECTIVE_MAX = 2.2;

const _atm: AtmosphereSample = { temperature: 0, pressure: 0, density: 0, speedOfSound: 0, viscosity: 0 };

/** N^2 at an altitude MSL, 1/s^2 (at least MIN_N2). */
export function bruntVaisala2(altitudeMSL: number, cond: AtmosphereConditions): number {
  const T = atmosphereInto(altitudeMSL, cond, _atm).temperature;
  return Math.max(MIN_N2, (G / T) * (G / CP_AIR + lapseRateAt(altitudeMSL, cond)));
}

/** Multiplier on the wave field for a convective velocity scale w* (WindField.convectiveVelocity), m/s. */
export function convectiveWaveFactor(wStar: number): number {
  return 1 - (CONVECTIVE_WEAKENING * Math.min(wStar, CONVECTIVE_MAX)) / CONVECTIVE_MAX;
}
