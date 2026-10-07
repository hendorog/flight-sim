// Fuel, mixture and combustion characteristics of a spark-ignition aircraft engine (the IO-360-L2A burning 100LL
// by default).
//
// Everything is expressed against the equivalence ratio phi = (fuel/air) / (fuel/air)_stoichiometric.
// The curves follow the classic spark-ignition data (Heywood, Internal Combustion Engine Fundamentals,
// figs. 5-9 and 15-8; Lycoming Key Reprints on leaning): best power near phi 1.15, best economy (minimum
// BSFC) near phi 0.9, peak EGT at stoichiometric, peak CHT slightly rich of peak EGT, lean misfire below
// about phi 0.6 and rich misfire above about 2.

import { interp1 } from '../../core/math';
import { C172_ENGINE } from './c172Powerplant';
import { AVGAS_100LL, type FuelMeteringDef } from './defs';

/** What a mixture lever meters: the full-rich equivalence ratio and the leanest fraction of it. */
export interface LeverMetering {
  /** NaN when the definition gives the take-off fuel flow instead: the engine solves it at its rating (PistonEngine). */
  fullRichPhi: number;
  leanestFraction: number;
}

/** The lever metering of a spark engine's definition (a FADEC diesel has no mixture lever). */
export function leverMetering(def: FuelMeteringDef): LeverMetering {
  if (def.kind === 'fadecDiesel') throw new Error('combustion: a FADEC diesel has no mixture lever');
  if (def.fullRichPhi === undefined && def.takeoffFuelFlow === undefined) throw new Error('combustion: the metering needs fullRichPhi or takeoffFuelFlow');
  return { fullRichPhi: def.fullRichPhi ?? NaN, leanestFraction: def.leanestFraction };
}

const C172_METERING = leverMetering(C172_ENGINE.metering);

// The fuel of the Cessna 172S (100LL) and the settings of its servo: C172_POWERPLANT's values under the names
// this module has always exported.
export const STOICH_FAR = AVGAS_100LL.stoichFar;
export const FUEL_LHV = AVGAS_100LL.lhv;
export const FUEL_DENSITY = AVGAS_100LL.density;
export const FULL_RICH_PHI = C172_METERING.fullRichPhi;
/** Mixture lever positions below this are idle cut-off. */
export const IDLE_CUTOFF = 0.02;
export const LEANEST_FRACTION = C172_METERING.leanestFraction;
const SEA_LEVEL_DENSITY = 1.225;

// Relative indicated power per unit of stoichiometric fuel energy: g = phi * (fuel conversion efficiency)
// normalised to 1 at best power. The BSFC ratio phi/g bottoms out near phi 0.88.
const PHI = [0.5, 0.58, 0.62, 0.7, 0.8, 0.88, 0.95, 1.0, 1.08, 1.15, 1.22, 1.3, 1.4, 1.6, 1.8, 1.95, 2.1];
const POWER = [0, 0, 0.42, 0.66, 0.79, 0.87, 0.925, 0.955, 0.985, 1.0, 0.997, 0.985, 0.96, 0.88, 0.72, 0.4, 0];

/**
 * Equivalence ratio the fuel servo meters for a given mixture lever and ambient density. The RSA servo meters
 * on venturi pressure, so fuel flow tracks air mass flow / sqrt(density): the mixture richens with altitude by
 * sqrt(rho0 / rho), which is why the pilot must lean when climbing. `fullRichPhi` is the equivalence ratio at
 * full rich and sea-level density, `leanestFraction` the fraction of it just above cut-off.
 */
export function meteredPhi(
  mixtureLever: number,
  ambientDensity: number,
  fullRichPhi = FULL_RICH_PHI,
  leanestFraction = LEANEST_FRACTION,
): number {
  if (mixtureLever < IDLE_CUTOFF) return 0;
  const lever = (mixtureLever - IDLE_CUTOFF) / (1 - IDLE_CUTOFF);
  const fraction = leanestFraction + (1 - leanestFraction) * lever;
  return fullRichPhi * fraction * Math.sqrt(SEA_LEVEL_DENSITY / ambientDensity);
}

/** Relative indicated power (0 outside the flammability limits, 1 at best power). */
export function mixturePower(phi: number): number {
  return interp1(PHI, POWER, phi);
}

/**
 * Drop of EGT below its peak (at phi = 1), K. About 55 K (100 F) at best power and 30 K (50 F) lean of peak,
 * rounded near the peak as on a real EGT gauge while leaning.
 */
export function egtDropFromPeak(phi: number): number {
  const d = phi - 1;
  const slope = d > 0 ? 370 : 420;
  return slope * (Math.sqrt(d * d + 0.0009) - 0.03);
}

/** Relative heat flux into the cylinder heads; peaks slightly rich of stoichiometric. */
export function headHeatFactor(phi: number): number {
  const d = (phi - 1.05) / 0.7;
  return Math.exp(-d * d);
}
