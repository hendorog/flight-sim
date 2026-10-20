// Hail on the airframe: the stones' impact energy, accumulated, and a warning level for the HUD and the toasts. It
// does not act on the flight model (whether and how hail damages the aircraft is an open decision, docs/weather.md).
//
// From the precipitation at the aircraft (physics/weather/stormPrecip.ts LocalPrecip) and its true airspeed V:
//   relative speed   v = sqrt(V^2 + v_t^2), v_t the fall speed of the largest stone (hail.ts; level flight assumed)
//   stone energy     E1 = 1/2 m v^2 of the largest stone (density HAIL_DENSITY_KGM3)
//   energy flux      F = 1/2 M v^3 through a surface facing the relative wind, M = rho_w R / v_t(mean) the stones'
//                    mass concentration, W/m^2
//   dose             the time integral of F, J/m^2 (reset by reset(), a scenario reset)
// Level (HailLevel), only while the rate is above HAIL_WARN_MMH: 'severe' when E1 >= HAIL_SEVERE_STONE_J, F >=
// HAIL_SEVERE_FLUX_WM2 or the dose >= HAIL_SEVERE_DOSE_JM2; else 'moderate' at the MODERATE thresholds; else 'light'.
// Unconfirmed: every threshold is a value chosen for this model; no source has been checked for airframe damage.

import { hailFallSpeed, hailMeanMm, HAIL_DENSITY_KGM3 } from '../../physics/weather/hail';
import type { LocalPrecip } from '../../physics/weather/stormPrecip';

export type HailLevel = 'none' | 'light' | 'moderate' | 'severe';

/** Rank of each level (for comparisons). */
export const HAIL_LEVEL_RANK: Readonly<Record<HailLevel, number>> = Object.freeze({ none: 0, light: 1, moderate: 2, severe: 3 });

/** Hail rate from which the warning shows, mm/h. */
export const HAIL_WARN_MMH = 0.05;
export const HAIL_MODERATE_STONE_J = 1;
export const HAIL_SEVERE_STONE_J = 10;
export const HAIL_MODERATE_FLUX_WM2 = 30;
export const HAIL_SEVERE_FLUX_WM2 = 300;
export const HAIL_MODERATE_DOSE_JM2 = 2_000;
export const HAIL_SEVERE_DOSE_JM2 = 20_000;

/** The hail on the airframe now and its accumulated dose. */
export interface HailState {
  level: HailLevel;
  /** Hail rate, mm/h, and the largest stone, mm, at the aircraft. */
  rateMmH: number;
  maxMm: number;
  /** Speed of the stones relative to the airframe, m/s. */
  relSpeedMs: number;
  /** Kinetic energy of the largest stone at that speed, J. */
  stoneJ: number;
  /** Impact energy flux, W/m^2. */
  fluxWm2: number;
  /** Accumulated impact energy, J/m^2. */
  doseJm2: number;
}

export const emptyHailState = (): HailState => ({ level: 'none', rateMmH: 0, maxMm: 0, relSpeedMs: 0, stoneJ: 0, fluxWm2: 0, doseJm2: 0 });

/** The level for a stone energy (J), flux (W/m^2), dose (J/m^2) and rate (mm/h). */
export function hailLevel(rateMmH: number, stoneJ: number, fluxWm2: number, doseJm2: number): HailLevel {
  if (!(rateMmH >= HAIL_WARN_MMH)) return 'none';
  if (stoneJ >= HAIL_SEVERE_STONE_J || fluxWm2 >= HAIL_SEVERE_FLUX_WM2 || doseJm2 >= HAIL_SEVERE_DOSE_JM2) return 'severe';
  if (stoneJ >= HAIL_MODERATE_STONE_J || fluxWm2 >= HAIL_MODERATE_FLUX_WM2 || doseJm2 >= HAIL_MODERATE_DOSE_JM2) return 'moderate';
  return 'light';
}

/** Accumulates the hail impact energy on the airframe (one per simulator). */
export class HailExposure {
  readonly state: HailState = emptyHailState();

  /** Advance by dt (s) with the precipitation at the aircraft `p` and its true airspeed (m/s). */
  update(p: LocalPrecip, tasMs: number, dt: number): HailState {
    const st = this.state;
    st.rateMmH = p.hailMmH > 0 ? p.hailMmH : 0;
    st.maxMm = st.rateMmH > 0 ? p.hailMaxMm : 0;
    if (st.rateMmH > 0 && st.maxMm > 0) {
      const vMax = hailFallSpeed(st.maxMm);
      const v = Math.hypot(Math.max(0, tasMs), vMax);
      const d = st.maxMm / 1000;
      st.relSpeedMs = v;
      st.stoneJ = 0.5 * HAIL_DENSITY_KGM3 * (Math.PI / 6) * d * d * d * v * v;
      const mass = (1000 * (st.rateMmH / 3.6e6)) / hailFallSpeed(hailMeanMm(st.maxMm));
      st.fluxWm2 = 0.5 * mass * v * v * v;
      if (dt > 0) st.doseJm2 += st.fluxWm2 * dt;
    } else {
      st.relSpeedMs = 0;
      st.stoneJ = 0;
      st.fluxWm2 = 0;
    }
    st.level = hailLevel(st.rateMmH, st.stoneJ, st.fluxWm2, st.doseJm2);
    return st;
  }

  /** A new flight: no dose. */
  reset(): void {
    Object.assign(this.state, emptyHailState());
  }
}
