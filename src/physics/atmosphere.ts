// International Standard Atmosphere (ICAO Doc 7488 / ISO 2533) with a uniform ISA temperature deviation
// and a non-standard sea-level pressure (QNH), plus the pitot-static relations used by the airspeed
// indicator. An optional temperature profile (TemperatureProfile: the deviation linear in geopotential altitude
// between nodes, from the temperatures of the manual wind-aloft levels) replaces the uniform deviation.
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
  /**
   * Optional non-uniform temperature deviation (temperatureProfile). When present it replaces isaDeviation; absent,
   * the uniform-deviation code path is used unchanged.
   */
  profile?: TemperatureProfile;
}

/**
 * A temperature deviation from ISA that varies with height: linear in geopotential altitude between nodes and
 * constant below the first and above the last node. Stored as segments split at the nodes and the ISA layer bounds,
 * each with its base altitude, base temperature, lapse rate and base pressure as a ratio to the sea-level pressure,
 * so the pressure at any altitude is the closed-form hydrostatic solution of its segment.
 */
export interface TemperatureProfile {
  readonly count: number;
  /** Segment base, geopotential m (the first is 0). */
  readonly baseH: Float64Array;
  /** Temperature at the segment base, K. */
  readonly baseT: Float64Array;
  /** dT/dH in the segment, K per geopotential m. */
  readonly lapse: Float64Array;
  /** Pressure at the segment base divided by the sea-level pressure. */
  readonly pRatio: Float64Array;
}

/** Lapse rates smaller than this are treated as isothermal, K/m. */
const ISOTHERMAL_LAPSE = 1e-9;

/** ISA temperature at a geopotential altitude, K. */
export function isaTemperature(H: number): number {
  let T: number = LAYERS[0].T;
  for (let i = 0; i < LAYERS.length; i++) {
    const top = i + 1 < LAYERS.length ? LAYERS[i + 1].h : Infinity;
    T = LAYERS[i].T + LAYERS[i].L * (Math.min(H, top) - LAYERS[i].h);
    if (H <= top) break;
  }
  return T;
}

function isaLapse(H: number): number {
  for (let i = LAYERS.length - 1; i >= 0; i--) if (H >= LAYERS[i].h) return LAYERS[i].L;
  return LAYERS[0].L;
}

/**
 * Build a TemperatureProfile from nodes: geopotential altitudes `nodeH` (m, strictly ascending, >= 0) and the ISA
 * deviation at each, `nodeDT` (K). Allocates (call on a settings change, not per sample).
 */
export function temperatureProfile(nodeH: readonly number[], nodeDT: readonly number[]): TemperatureProfile {
  const n = nodeH.length;
  const dTAt = (H: number): number => {
    if (n === 0) return 0;
    if (H <= nodeH[0]) return nodeDT[0];
    for (let i = 1; i < n; i++) {
      if (H <= nodeH[i]) return nodeDT[i - 1] + ((nodeDT[i] - nodeDT[i - 1]) * (H - nodeH[i - 1])) / (nodeH[i] - nodeH[i - 1]);
    }
    return nodeDT[n - 1];
  };
  const bounds = [0];
  for (const L of LAYERS) if (L.h > 0) bounds.push(L.h);
  for (const h of nodeH) if (h > 0) bounds.push(h);
  bounds.sort((a, b) => a - b);
  const uniq = bounds.filter((b, i) => i === 0 || b > bounds[i - 1]);
  const count = uniq.length;
  const baseH = new Float64Array(count);
  const baseT = new Float64Array(count);
  const lapse = new Float64Array(count);
  const pRatio = new Float64Array(count);
  let ratio = 1;
  for (let i = 0; i < count; i++) {
    const h0 = uniq[i];
    const T0 = isaTemperature(h0) + dTAt(h0);
    baseH[i] = h0;
    baseT[i] = T0;
    pRatio[i] = ratio;
    if (i + 1 < count) {
      const h1 = uniq[i + 1];
      let L = (isaTemperature(h1) + dTAt(h1) - T0) / (h1 - h0);
      // An isothermal segment computed with rounding error is isothermal (the power law degenerates as L -> 0).
      if (Math.abs(L) < ISOTHERMAL_LAPSE) L = 0;
      lapse[i] = L;
      ratio *= L === 0 ? Math.exp((-G0 * (h1 - h0)) / (R_AIR * T0)) : Math.pow((T0 + L * (h1 - h0)) / T0, -G0 / (R_AIR * L));
    } else {
      lapse[i] = isaLapse(h0);
    }
  }
  return { count, baseH, baseT, lapse, pRatio };
}

/** Temperature and pressure ratio at geopotential altitude H in a profile, written into out[0], out[1]. */
function profileState(p: TemperatureProfile, H: number, out: Float64Array): void {
  let i = p.count - 1;
  while (i > 0 && H < p.baseH[i]) i--;
  const dh = H - p.baseH[i];
  const T0 = p.baseT[i];
  const L = p.lapse[i];
  const T = T0 + L * dh;
  out[0] = T;
  out[1] = p.pRatio[i] * (L === 0 ? Math.exp((-G0 * dh) / (R_AIR * T0)) : Math.pow(T / T0, -G0 / (R_AIR * L)));
}

const _state = new Float64Array(2);

/**
 * Temperature lapse dT/dz at a geometric altitude, K per geometric m (negative when the temperature falls with
 * height): the segment's lapse in geopotential altitude times dH/dz.
 */
export function lapseRateAt(altitudeMSL: number, cond: AtmosphereConditions): number {
  const H = geopotentialAltitude(altitudeMSL);
  const r = EARTH_RADIUS / (EARTH_RADIUS + altitudeMSL);
  const p = cond.profile;
  if (!p) return isaLapse(H) * r * r;
  let i = p.count - 1;
  while (i > 0 && H < p.baseH[i]) i--;
  return p.lapse[i] * r * r;
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
  if (cond.profile) {
    profileState(cond.profile, H, _state);
    const T = _state[0];
    const p = cond.seaLevelPressure * _state[1];
    out.temperature = T;
    out.pressure = p;
    out.density = p / (R_AIR * T);
    out.speedOfSound = Math.sqrt(GAMMA_AIR * R_AIR * T);
    out.viscosity = sutherlandViscosity(T);
    return out;
  }
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
