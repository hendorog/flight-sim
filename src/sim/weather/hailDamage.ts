// Hail damage to the airframe: dents on the leading edges and cracks in the windscreen, accumulated from the energy
// of each stone that strikes them. Advanced by SimPhysics in simulation time (every HAIL_DAMAGE_DT_S), so the result
// is a function of the flight alone (the weather, the clock, the aircraft's path), whatever the frame rate. Node-safe;
// no allocation after construction.
//
// From the precipitation at the aircraft (physics/weather/stormPrecip.ts LocalPrecip) and its air data:
//   stones        HAIL_QUANTILES diameters D_j at the quantiles (j + 0.5) / HAIL_QUANTILES of the size distribution
//                 (hail.ts hailDiameterMm), each carrying 1 / HAIL_QUANTILES of the number density n (hailNumberDensity)
//   velocity      u_j = the air's velocity relative to the aircraft (-TAS along the flight path, body axes) plus the
//                 stone's fall speed v_t(D_j) (hail.ts) in the air density at the aircraft straight down, turned into
//                 body axes
//   surfaces      leading edges: outward normal +x (forward); windscreen: the normal WINDSCREEN_NORMAL_ELEV above +x.
//                 Normal impact speed v_n = max(0, -u_j . n); stone energy E_j = 1/2 rho_h (pi/6) D_j^3 v_n^2
//   dent dose     integral of sum_j (n / Q) v_n E-excess, E-excess = max(0, E_j - DENT_STONE_J), J/m^2
//   crack dose    the same with CRACK_STONE_J on the windscreen
//   levels        leadingEdge = 1 - exp(-dent dose / DENT_DOSE_FULL_JM2), windscreen = 1 - exp(-crack dose /
//                 CRACK_DOSE_FULL_JM2); both only grow during a flight
//   rotor         helicopters: the blade leading edges at ROTOR_STATION of the main rotor's radius, normal speed
//                 v_n = max(0, Omega r + V sin psi) at ROTOR_AZIMUTHS azimuths psi (V the TAS, taken in the disc
//                 plane), averaged over the azimuths: a blade element meets the stones in the volume it sweeps, n v_n
//                 per m^2 of its leading edge. Rotor dose: the dent dose's sum with these speeds and DENT_STONE_J;
//                 rotor = 1 - exp(-rotor dose / DENT_DOSE_FULL_JM2). Both rotors take this level
//                 (Rotorcraft.setDamage)
//   cracks        cracking impacts arrive at WINDSCREEN_AREA_M2 sum_j (n / Q) v_n [E_j >= CRACK_STONE_J] per second;
//                 each whole impact due adds a crack (at most MAX_CRACKS) at a direction from the pilot's eye hashed
//                 from the clock and the crack's index (rainHash), sized by the largest such stone's energy
// No stone above the thresholds: nothing accumulates, and the levels stay 0 (no hail ever: every value 0).
// Unconfirmed: every threshold, dose and the windscreen's normal and area are values chosen for this model; no source
// has been checked for hail damage to light-aircraft skins or acrylic windscreens.

import type { Quat } from '../../core/math';
import { HAIL_DENSITY_KGM3, HAIL_FALL_AIR_DENSITY, hailDiameterMm, hailFallSpeed, hailNumberDensity } from '../../physics/weather/hail';
import { rainHash, type LocalPrecip } from '../../physics/weather/stormPrecip';

/** Interval of the damage update in simulation time, s. */
export const HAIL_DAMAGE_DT_S = 0.1;
/** Size quantiles the distribution is integrated over. */
export const HAIL_QUANTILES = 8;
/** Stone energy from which a stone dents a leading edge, J. Unconfirmed. */
export const DENT_STONE_J = 1;
/** Stone energy from which a stone cracks the windscreen, J. Unconfirmed. */
export const CRACK_STONE_J = 5;
/** Excess impact energy per m^2 of leading edge at which the dent level reaches 1 - 1/e, J/m^2. Unconfirmed. */
export const DENT_DOSE_FULL_JM2 = 1000;
/** Excess impact energy per m^2 of windscreen at which the crack level reaches 1 - 1/e, J/m^2. Unconfirmed. */
export const CRACK_DOSE_FULL_JM2 = 400;
/** Blade station of the rotor's leading-edge strikes, share of the main rotor's radius. */
export const ROTOR_STATION = 0.75;
/** Azimuths the blade's speed through the stones is averaged over. */
export const ROTOR_AZIMUTHS = 8;
/** Elevation of the windscreen's outward normal above the nose, rad (55 deg). Unconfirmed. */
export const WINDSCREEN_NORMAL_ELEV = (55 * Math.PI) / 180;
/** Windscreen area the cracking impacts are counted on, m^2. Unconfirmed. */
export const WINDSCREEN_AREA_M2 = 0.6;
/** Most cracks kept (the shader's uniform array). */
export const MAX_CRACKS = 12;
/** Crack level from which the windscreen is drawn crazed over a large area. Unconfirmed: a look value. */
export const SHATTER_LEVEL = 0.7;
/** Directions the cracks are placed at, from the pilot's eye: azimuth +-CRACK_AZ_RAD, elevation CRACK_EL_RAD. */
export const CRACK_AZ_RAD = (32 * Math.PI) / 180;
export const CRACK_EL_RAD: readonly [number, number] = [(-4 * Math.PI) / 180, (18 * Math.PI) / 180];

/** One windscreen crack: where it is seen from the pilot's eye, how large, and its pattern's seed. */
export interface WindscreenCrack {
  /** Azimuth (+ right) and elevation (+ up) of the impact from the eye, aircraft body axes, rad. */
  az: number;
  el: number;
  /** 0..1: the striking stone's energy over CRACK_STONE_J, log-scaled (crackSize). */
  size: number;
  /** 0..1, the pattern's seed. */
  seed: number;
}

export interface HailDamageState {
  /** Windscreen crack level 0..1. */
  windscreen: number;
  /** Leading-edge (wing, tail, cowl) dent level 0..1. */
  leadingEdge: number;
  /** Rotor blade leading-edge dent level 0..1 (helicopters; 0 on every other type). */
  rotor: number;
  /** Excess impact energy accumulated, J/m^2. */
  windscreenDoseJm2: number;
  leadingEdgeDoseJm2: number;
  rotorDoseJm2: number;
  /** Restores so far (HailDamage.restore): a change tells the toasts that the levels were set, not grown. */
  restores: number;
  /** Cracking impacts due and not yet placed (0..1). */
  crackDue: number;
  /** cracks[0 .. crackCount - 1] are in use; the array always holds MAX_CRACKS objects. */
  crackCount: number;
  readonly cracks: WindscreenCrack[];
}

export const emptyHailDamage = (): HailDamageState => ({
  windscreen: 0,
  leadingEdge: 0,
  rotor: 0,
  windscreenDoseJm2: 0,
  leadingEdgeDoseJm2: 0,
  rotorDoseJm2: 0,
  restores: 0,
  crackDue: 0,
  crackCount: 0,
  cracks: Array.from({ length: MAX_CRACKS }, () => ({ az: 0, el: 0, size: 0, seed: 0 })),
});

/** The snapshot form of the damage (resume.ts): plain JSON, the cracks in use only. */
export interface HailDamageSnapshot {
  windscreen: number;
  leadingEdge: number;
  windscreenDoseJm2: number;
  leadingEdgeDoseJm2: number;
  crackDue: number;
  cracks: WindscreenCrack[];
  /** Present only once a rotor took damage (helicopters). */
  rotor?: number;
  rotorDoseJm2?: number;
}

/** Size 0..1 of a crack from the striking stone's energy: log2(E / CRACK_STONE_J) / 4, 1 at 16 times the threshold. */
export function crackSize(stoneJ: number): number {
  return Math.min(1, Math.max(0, Math.log2(stoneJ / CRACK_STONE_J) / 4));
}

/** Rates of one damage evaluation (hailDamageRates), per second. */
export interface HailDamageRates {
  dentJm2s: number;
  crackJm2s: number;
  cracksPerS: number;
  /** Largest stone energy on the windscreen, J. */
  maxWindscreenJ: number;
}


/**
 * The damage rates for the precipitation `p` at an aircraft flying at true airspeed `tas` (m/s) with angle of attack
 * and sideslip `alpha`, `beta` (rad) and attitude `q` (body -> NED), in air of density `rhoAir` (kg/m^3). Writes
 * `out`. Zero without hail.
 */
export function hailDamageRates(
  p: LocalPrecip,
  tas: number,
  alpha: number,
  beta: number,
  q: Quat,
  out: HailDamageRates,
  rhoAir = HAIL_FALL_AIR_DENSITY,
): HailDamageRates {
  out.dentJm2s = out.crackJm2s = out.cracksPerS = out.maxWindscreenJ = 0;
  if (!(p.hailMmH > 0) || !(p.hailMaxMm > 0)) return out;
  const n = hailNumberDensity(p.hailMmH, p.hailMaxMm) / HAIL_QUANTILES;
  const rho = rhoAir > 0 ? rhoAir : HAIL_FALL_AIR_DENSITY;
  const v = Math.max(0, tas);
  const ca = Math.cos(alpha), cb = Math.cos(beta);
  // Air relative to the aircraft, body axes (from ahead, along the flight path).
  const ax = -v * ca * cb, az = -v * Math.sin(alpha) * cb;
  // The lateral component does not enter the frontal normals (both lie in the plane of symmetry).
  // Straight down (NED +z) in body axes: the third row of the body -> NED rotation matrix.
  const fx = 2 * (q.x * q.z - q.w * q.y), fz = 1 - 2 * (q.x * q.x + q.y * q.y);
  const nwx = Math.cos(WINDSCREEN_NORMAL_ELEV), nwz = -Math.sin(WINDSCREEN_NORMAL_ELEV);
  for (let j = 0; j < HAIL_QUANTILES; j++) {
    const dMm = hailDiameterMm((j + 0.5) / HAIL_QUANTILES, p.hailMaxMm);
    const vt = hailFallSpeed(dMm, rho);
    const ux = ax + vt * fx, uz = az + vt * fz;
    const m = HAIL_DENSITY_KGM3 * (Math.PI / 6) * (dMm / 1000) ** 3;
    // Leading edges face +x.
    const vLe = Math.max(0, -ux);
    const eLe = 0.5 * m * vLe * vLe;
    if (eLe > DENT_STONE_J) out.dentJm2s += n * vLe * (eLe - DENT_STONE_J);
    const vWs = Math.max(0, -(ux * nwx + uz * nwz));
    const eWs = 0.5 * m * vWs * vWs;
    if (eWs >= CRACK_STONE_J) {
      out.crackJm2s += n * vWs * (eWs - CRACK_STONE_J);
      out.cracksPerS += WINDSCREEN_AREA_M2 * n * vWs;
      if (eWs > out.maxWindscreenJ) out.maxWindscreenJ = eWs;
    }
  }
  return out;
}

const ROTOR_SIN = Array.from({ length: ROTOR_AZIMUTHS }, (_, j) => Math.sin((2 * Math.PI * (j + 0.5)) / ROTOR_AZIMUTHS));

/**
 * Dent rate of the rotor blades' leading edges, J/m^2/s, for the precipitation `p`, the blade speed `bladeMs` at
 * ROTOR_STATION (Omega r, m/s) and the airspeed in the disc plane `inPlaneMs` (m/s). Zero without hail or with the
 * rotor stopped.
 */
export function rotorDentRate(p: LocalPrecip, bladeMs: number, inPlaneMs: number): number {
  if (!(p.hailMmH > 0) || !(p.hailMaxMm > 0) || !(bladeMs > 0)) return 0;
  const n = hailNumberDensity(p.hailMmH, p.hailMaxMm) / (HAIL_QUANTILES * ROTOR_AZIMUTHS);
  const v = Math.max(0, inPlaneMs);
  let rate = 0;
  for (let j = 0; j < HAIL_QUANTILES; j++) {
    const dMm = hailDiameterMm((j + 0.5) / HAIL_QUANTILES, p.hailMaxMm);
    const m = HAIL_DENSITY_KGM3 * (Math.PI / 6) * (dMm / 1000) ** 3;
    for (let k = 0; k < ROTOR_AZIMUTHS; k++) {
      const vn = Math.max(0, bladeMs + v * ROTOR_SIN[k]);
      const e = 0.5 * m * vn * vn;
      if (e > DENT_STONE_J) rate += n * vn * (e - DENT_STONE_J);
    }
  }
  return rate;
}

/** The hail damage of one flight (one per SimPhysics). */
export class HailDamage {
  readonly state: HailDamageState = emptyHailDamage();
  private readonly rates: HailDamageRates = { dentJm2s: 0, crackJm2s: 0, cracksPerS: 0, maxWindscreenJ: 0 };

  /**
   * Advance by dt (s) at simulation time t (s) with the precipitation at the aircraft and its air data (`rhoAir` the
   * air density there, kg/m^3; `rotorBladeMs` a helicopter's main-rotor blade speed at ROTOR_STATION, m/s, 0 on
   * other types). Returns true when a level changed (the flight model's dents must then be set again).
   */
  update(
    p: LocalPrecip,
    tas: number,
    alpha: number,
    beta: number,
    q: Quat,
    t: number,
    dt: number,
    rhoAir = HAIL_FALL_AIR_DENSITY,
    rotorBladeMs = 0,
  ): boolean {
    if (!(p.hailMmH > 0) || !(dt > 0)) return false;
    const r = hailDamageRates(p, tas, alpha, beta, q, this.rates, rhoAir);
    const rotorRate = rotorBladeMs > 0 ? rotorDentRate(p, rotorBladeMs, tas) : 0;
    if (!(r.dentJm2s > 0) && !(r.cracksPerS > 0) && !(rotorRate > 0)) return false;
    const s = this.state;
    if (rotorRate > 0) {
      s.rotorDoseJm2 += rotorRate * dt;
      s.rotor = 1 - Math.exp(-s.rotorDoseJm2 / DENT_DOSE_FULL_JM2);
    }
    s.leadingEdgeDoseJm2 += r.dentJm2s * dt;
    s.windscreenDoseJm2 += r.crackJm2s * dt;
    s.leadingEdge = 1 - Math.exp(-s.leadingEdgeDoseJm2 / DENT_DOSE_FULL_JM2);
    s.windscreen = 1 - Math.exp(-s.windscreenDoseJm2 / CRACK_DOSE_FULL_JM2);
    s.crackDue += r.cracksPerS * dt;
    const tick = Math.round(t * 1000);
    while (s.crackDue >= 1) {
      s.crackDue -= 1;
      if (s.crackCount >= MAX_CRACKS) continue;
      const i = s.crackCount++;
      const c = s.cracks[i];
      c.az = (2 * rainHash(tick, i, 0x3c6ef372) - 1) * CRACK_AZ_RAD;
      c.el = CRACK_EL_RAD[0] + rainHash(tick, i, 0x5bd1e995) * (CRACK_EL_RAD[1] - CRACK_EL_RAD[0]);
      c.size = crackSize(r.maxWindscreenJ * (0.5 + 0.5 * rainHash(tick, i, 0x1b873593)));
      c.seed = rainHash(tick, i, 0x68e31da4);
    }
    if (s.crackCount >= MAX_CRACKS) s.crackDue = Math.min(s.crackDue, 0.999);
    return true;
  }

  /** A new flight: no damage. */
  reset(): void {
    const s = this.state;
    s.windscreen = s.leadingEdge = s.windscreenDoseJm2 = s.leadingEdgeDoseJm2 = s.crackDue = 0;
    s.rotor = s.rotorDoseJm2 = 0;
    s.crackCount = 0;
  }

  capture(): HailDamageSnapshot {
    const s = this.state;
    return {
      windscreen: s.windscreen,
      leadingEdge: s.leadingEdge,
      windscreenDoseJm2: s.windscreenDoseJm2,
      leadingEdgeDoseJm2: s.leadingEdgeDoseJm2,
      crackDue: s.crackDue,
      cracks: s.cracks.slice(0, s.crackCount).map((c) => ({ ...c })),
      ...(s.rotorDoseJm2 > 0 ? { rotor: s.rotor, rotorDoseJm2: s.rotorDoseJm2 } : {}),
    };
  }

  /** Restore a snapshot's damage (undefined: none). Counts the restore in state.restores. */
  restore(d: HailDamageSnapshot | undefined): void {
    this.reset();
    const s = this.state;
    s.restores++;
    if (!d) return;
    s.windscreen = d.windscreen;
    s.leadingEdge = d.leadingEdge;
    s.windscreenDoseJm2 = d.windscreenDoseJm2;
    s.leadingEdgeDoseJm2 = d.leadingEdgeDoseJm2;
    s.crackDue = d.crackDue;
    s.rotor = d.rotor ?? 0;
    s.rotorDoseJm2 = d.rotorDoseJm2 ?? 0;
    const n = Math.min(MAX_CRACKS, d.cracks.length);
    for (let i = 0; i < n; i++) Object.assign(s.cracks[i], d.cracks[i]);
    s.crackCount = n;
  }
}
