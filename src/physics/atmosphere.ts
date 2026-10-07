// International Standard Atmosphere (ICAO Doc 7488 / ISO 2533) with a uniform ISA temperature deviation
// and a non-standard sea-level pressure (QNH), plus the pitot-static relations used by the airspeed
// indicator.
//
// The deviated atmosphere is the hydrostatic solution for T(h) = T_ISA(h) + dT with sea-level pressure
// QNH, so a warm day has higher pressure aloft (and a higher density altitude) exactly as the real air
// does. With dT = 0 and QNH = 1013.25 hPa it reproduces the ISA tables.

import type { AtmosphereSample } from '../core/types';

/** Specific gas constant of dry air, J/(kg K). */
export const R_AIR = 287.05287;
export const GAMMA_AIR = 1.4;
const G0 = 9.80665;
/** Earth radius used by ISA to convert geometric to geopotential altitude, m. */
const EARTH_RADIUS = 6356766;

export const ISA_SEA_LEVEL = {
  temperature: 288.15,
  pressure: 101325,
  density: 1.225,
  speedOfSound: Math.sqrt(GAMMA_AIR * R_AIR * 288.15),
} as const;

/** ISA layers up to 32 km geopotential: base altitude (m), base temperature (K), lapse rate (K/m). */
const LAYERS = [
  { h: 0, T: 288.15, L: -0.0065 },
  { h: 11000, T: 216.65, L: 0 },
  { h: 20000, T: 216.65, L: 0.001 },
  { h: 32000, T: 228.65, L: 0 },
] as const;

export interface AtmosphereConditions {
  /** Deviation from ISA temperature, K. */
  isaDeviation: number;
  /** Sea-level (QNH) pressure, Pa. */
  seaLevelPressure: number;
}

export const STANDARD_CONDITIONS: AtmosphereConditions = { isaDeviation: 0, seaLevelPressure: 101325 };

/** Sutherland's law for air (mu_ref = 1.716e-5 Pa s at 273.15 K, S = 110.4 K). */
export function sutherlandViscosity(T: number): number {
  return (1.458e-6 * T * Math.sqrt(T)) / (T + 110.4);
}

/** Geopotential altitude for a geometric altitude, m. */
export function geopotentialAltitude(h: number): number {
  return (EARTH_RADIUS * h) / (EARTH_RADIUS + h);
}

/** Atmospheric state at a geometric altitude above mean sea level (ISA layers to 32 km, isothermal above). */
export function atmosphereAt(altitudeMSL: number, cond: AtmosphereConditions = STANDARD_CONDITIONS): AtmosphereSample {
  const out: AtmosphereSample = { temperature: 0, pressure: 0, density: 0, speedOfSound: 0, viscosity: 0 };
  return atmosphereInto(altitudeMSL, cond, out);
}

/** Allocation-free variant of atmosphereAt. */
export function atmosphereInto(altitudeMSL: number, cond: AtmosphereConditions, out: AtmosphereSample): AtmosphereSample {
  const H = geopotentialAltitude(altitudeMSL);
  const dT = cond.isaDeviation;
  // Integrate dp/dH = -g p / (R T) layer by layer with the deviated temperature profile.
  let p = cond.seaLevelPressure;
  let T = LAYERS[0].T + dT;
  for (let i = 0; i < LAYERS.length; i++) {
    const layer = LAYERS[i];
    const top = i + 1 < LAYERS.length ? LAYERS[i + 1].h : Infinity;
    const Tbase = layer.T + dT;
    const dh = Math.min(H, top) - layer.h;
    if (layer.L === 0) {
      T = Tbase;
      p *= Math.exp((-G0 * dh) / (R_AIR * Tbase));
    } else {
      T = Tbase + layer.L * dh;
      p *= Math.pow(T / Tbase, -G0 / (R_AIR * layer.L));
    }
    if (H <= top) break;
  }
  out.temperature = T;
  out.pressure = p;
  out.density = p / (R_AIR * T);
  out.speedOfSound = Math.sqrt(GAMMA_AIR * R_AIR * T);
  out.viscosity = sutherlandViscosity(T);
  return out;
}

/** Pressure altitude (standard-atmosphere altitude with the same static pressure), m. */
export function pressureAltitude(staticPressure: number): number {
  // Invert the two lowest ISA layers; above 20 km the aircraft cannot fly.
  const p11 = 22632.06;
  if (staticPressure >= p11) {
    return (288.15 / 0.0065) * (1 - Math.pow(staticPressure / 101325, (R_AIR * 0.0065) / G0));
  }
  return 11000 + ((R_AIR * 216.65) / G0) * Math.log(p11 / staticPressure);
}

// --- Pitot-static relations (subsonic, isentropic; the C172 never approaches M = 1) ---

/** Impact pressure qc = p_total - p_static for a true airspeed in the given air, Pa. */
export function impactPressure(tas: number, atm: AtmosphereSample): number {
  const M = tas / atm.speedOfSound;
  return atm.pressure * (Math.pow(1 + 0.2 * M * M, 3.5) - 1);
}

/** Calibrated airspeed from impact pressure (St Venant with sea-level standard reference), m/s. */
export function casFromImpactPressure(qc: number): number {
  const a0 = ISA_SEA_LEVEL.speedOfSound;
  const ratio = Math.max(qc, 0) / ISA_SEA_LEVEL.pressure + 1;
  return a0 * Math.sqrt(5 * (Math.pow(ratio, 2 / 7) - 1));
}

/** Impact pressure that corresponds to a calibrated airspeed, Pa. */
export function impactPressureFromCas(cas: number): number {
  const m = cas / ISA_SEA_LEVEL.speedOfSound;
  return ISA_SEA_LEVEL.pressure * (Math.pow(1 + 0.2 * m * m, 3.5) - 1);
}

/** Calibrated airspeed for a true airspeed in the given air, m/s. */
export function casFromTas(tas: number, atm: AtmosphereSample): number {
  return casFromImpactPressure(impactPressure(tas, atm));
}

/** True airspeed for a calibrated airspeed in the given air, m/s. */
export function tasFromCas(cas: number, atm: AtmosphereSample): number {
  const qc = impactPressureFromCas(cas);
  const M = Math.sqrt(5 * (Math.pow(qc / atm.pressure + 1, 2 / 7) - 1));
  return M * atm.speedOfSound;
}

/** Equivalent airspeed, m/s. */
export function easFromTas(tas: number, atm: AtmosphereSample): number {
  return tas * Math.sqrt(atm.density / ISA_SEA_LEVEL.density);
}
