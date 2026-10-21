// Hail and snow lying on the ground near the camera: the ground surface temperature, the lying ice and snow and
// the surface water, for two surface classes (soil, meaning grass and every unpaved surface, and pavement, meaning
// the runway, taxiways and apron), advanced with simulated time from the precipitation at the camera's ground point.
// Read by HailGroundOverlay.ts (the drawn cover per surface class). No three.js import, no allocation per update
// (tests/render/groundCover.test.ts).
//
// Per surface class, one skin layer of heat capacity C (J/m^2/K) at temperature T_g (deg C). The deep ground is at
// T_d = T_a + the surface's deepWarmC (T_a the surface air temperature); T_g starts where the two fluxes below balance without
// precipitation, (K T_d + AIR_H T_a) / (K + AIR_H):
//   C dT_g/dt = K (T_d - T_g) + AIR_H (T_a - T_g)             ground heat from below and heat from the air
//             - m_h [(1 - s_h) e_melt + s_h e_warm]           hail landing: melting on landing, or lying and warming
//             - m_s [(1 - s_s) e_melt + s_s e_warm]           the frozen share of the snow, likewise
//             - m_w C_WATER max(T_g, 0)                       the wet snow's water, warmed from 0 deg C
//             - phi                                           heat into the lying ice and snow, melting it
//   e_melt = L_FUSION + C_ICE (0 - T_p) + C_WATER max(T_g, 0), e_warm = C_ICE (min(T_g, 0) - T_p), T_p the
//   particle's temperature (HAIL_STONE_C for hail, min(T_a, 0) for snow); m in kg/m^2/s from the rate in mm/h liquid
//   equivalent (1 mm/h = 1/3600 kg/m^2/s).
//   s = 1 - smoothstep(0, SETTLE_C, T_g), the share of the arriving particles that lies: HAIL_SETTLE_C for hail,
//   SNOW_SETTLE_C for snow (the lower of the two, so snow needs a skin nearer 0 deg C).
//   phi = MELT_U max(T_g, 0) while ice or snow lies (at most what lies); it melts hail and snow by their mass shares.
//   The snow's frozen share on arrival: 1 - smoothstep(SNOW_WET_C0, SNOW_WET_C1, T_a); the rest arrives as water.
//   Water on the surface (kg/m^2): melted hail and snow, the wet snow's water and the rain; at most WET_HOLD_KGM2
//   (the rest runs off), drying with WET_DRY_S. wetness = water / WET_HOLD_KGM2.
// Visible cover: hail 1 - exp(-ice depth / HAIL_COVER_MM) (ice at ICE_DENSITY), snow 1 - exp(-snow depth /
// SNOW_COVER_MM) (snow at SNOW_DENSITY), combined as 1 - (1 - hail)(1 - snow).
// Integration: explicit steps of at most SUBSTEP_S (the fastest rate, the settling term under 60 mm/h of hail, is
// about 5 per s, so a step's factor stays under 0.5).
// Not modelled: the rain's heat (storm rain at the air temperature would warm the ground), sunshine, evaporation,
// the insulation of a lying layer, compaction of snow, the deep ground cooling.
// Unconfirmed: every constant below except the latent and specific heats is a value chosen so that the times match
// the owner's description (hail lies after a minute or two of moderate to heavy hail, grass before pavement); none
// has been checked against measurements.

import { smoothstep } from '../../core/math';
import { geopotentialAltitude, ISA_SEA_LEVEL } from '../../physics/atmosphere';

/** Latent heat of fusion of ice, J/kg. */
export const L_FUSION = 334_000;
/** Specific heats of ice and water, J/(kg K). */
export const C_ICE = 2100;
export const C_WATER = 4186;
/** Temperature of a hailstone reaching the ground, deg C (unconfirmed). */
export const HAIL_STONE_C = -2;
/** Heat exchange of the surface with the air above it, W/m^2/K (unconfirmed). */
export const AIR_H = 6;
/** Heat into the lying ice and snow per K of the skin above 0 deg C, W/m^2/K (unconfirmed). */
export const MELT_U = 1500;
/** Skin temperature at and above which nothing lies, deg C: hail, snow (unconfirmed). */
export const HAIL_SETTLE_C = 1;
export const SNOW_SETTLE_C = 0.3;
/** Air temperatures between which the falling snow goes from all frozen to all water, deg C (unconfirmed). */
export const SNOW_WET_C0 = 0.5;
export const SNOW_WET_C1 = 3;
/** Densities of the lying ice and of fresh snow, kg/m^3 (snow unconfirmed; fresh snow is about 50 to 150). */
export const ICE_DENSITY = 917;
export const SNOW_DENSITY = 100;
/** Depths at which the cover reaches 1 - 1/e, mm: of ice, of snow (look values). */
export const HAIL_COVER_MM = 0.5;
export const SNOW_COVER_MM = 8;
/** Water the surface holds, kg/m^2 (mm), and its drying time, s (unconfirmed). */
export const WET_HOLD_KGM2 = 0.3;
export const WET_DRY_S = 1800;
/** Longest integration step, s. */
export const SUBSTEP_S = 0.1;
/** Below these the lying mass (kg/m^2) and the water count as gone. */
const LYING_EPS = 1e-6;
const WET_EPS = 1e-4;

export interface SurfaceThermal {
  /** Heat capacity of the skin layer, J/m^2/K. */
  readonly heatCapacity: number;
  /** Conduction from the deep ground, W/m^2/K. */
  readonly conduction: number;
  /** The deep ground's temperature over the surface air temperature, K. */
  readonly deepWarmC: number;
}

/** Grass and soil: a light skin over insulating ground (unconfirmed). */
export const SOIL: SurfaceThermal = Object.freeze({ heatCapacity: 2000, conduction: 4, deepWarmC: 2 });
/** Asphalt and concrete: more heat stored and conducted from below (unconfirmed). */
export const PAVEMENT: SurfaceThermal = Object.freeze({ heatCapacity: 3500, conduction: 14, deepWarmC: 4 });

/** Air temperature at the ground, deg C: ISA plus the deviation at elevation elevM (m MSL). */
export function surfaceAirC(elevM: number, isaDeviation: number): number {
  return ISA_SEA_LEVEL.temperature - 273.15 + isaDeviation - 0.0065 * Math.min(geopotentialAltitude(elevM), 11_000);
}

/** Skin temperature of a surface without precipitation at air temperature airC, deg C. */
export function restingC(t: SurfaceThermal, airC: number): number {
  return airC + (t.conduction * t.deepWarmC) / (t.conduction + AIR_H);
}

/** One surface class's skin temperature, lying ice and snow, and water. */
export class SurfaceCover {
  /** Skin temperature, deg C (NaN before the first update). */
  groundC = Number.NaN;
  /** Lying hail and snow, kg/m^2 (mm liquid equivalent). */
  hailKg = 0;
  snowKg = 0;
  /** Water on the surface, kg/m^2. */
  waterKg = 0;
  /** Shares of the arriving hail and snow that lie, 0..1, at the last step. */
  hailSettle = 0;
  snowSettle = 0;
  /** Visible covers, 0..1: of hail, of snow, combined. */
  hailCover = 0;
  snowCover = 0;
  cover = 0;
  /** 0..1, water over WET_HOLD_KGM2. */
  wetness = 0;

  constructor(readonly thermal: SurfaceThermal) {}

  /** Depth of the lying ice, mm. */
  get hailMm(): number {
    return (this.hailKg * 1000) / ICE_DENSITY;
  }

  /** Depth of the lying snow, mm. */
  get snowMm(): number {
    return (this.snowKg * 1000) / SNOW_DENSITY;
  }

  /**
   * One step of h s: hail mH, frozen snow mS, wet snow mW and rain mR (kg/m^2/s), snow particle temperature snowC,
   * air airC (deg C); dry the water's decay factor for h.
   */
  step(h: number, mH: number, mS: number, mW: number, mR: number, snowC: number, airC: number, dry: number): void {
    const T = this.groundC;
    const Tp = T > 0 ? T : 0;
    const Tn = T < 0 ? T : 0;
    const sH = T <= 0 ? 1 : 1 - smoothstep(0, HAIL_SETTLE_C, T);
    const sS = T <= 0 ? 1 : 1 - smoothstep(0, SNOW_SETTLE_C, T);
    const lying = this.hailKg + this.snowKg;
    let phi = 0;
    if (lying > 0 && Tp > 0) phi = Math.min(MELT_U * Tp, (lying * L_FUSION) / h);
    const eMeltH = L_FUSION - C_ICE * HAIL_STONE_C + C_WATER * Tp;
    const eMeltS = L_FUSION - C_ICE * snowC + C_WATER * Tp;
    const q =
      this.thermal.conduction * (airC + this.thermal.deepWarmC - T) +
      AIR_H * (airC - T) -
      mH * ((1 - sH) * eMeltH + sH * C_ICE * (Tn - HAIL_STONE_C)) -
      mS * ((1 - sS) * eMeltS + sS * C_ICE * (Tn - snowC)) -
      mW * C_WATER * Tp -
      phi;
    this.groundC = T + (q * h) / this.thermal.heatCapacity;
    const melt = phi / L_FUSION;
    const hailShare = lying > 0 ? this.hailKg / lying : 0;
    this.hailKg = Math.max(0, this.hailKg + (mH * sH - melt * hailShare) * h);
    this.snowKg = Math.max(0, this.snowKg + (mS * sS - melt * (1 - hailShare)) * h);
    if (this.hailKg < LYING_EPS && !(mH * sH > 0)) this.hailKg = 0;
    if (this.snowKg < LYING_EPS && !(mS * sS > 0)) this.snowKg = 0;
    const input = mH * (1 - sH) + mS * (1 - sS) + mW + mR + melt;
    const water = this.waterKg + input * h;
    this.waterKg = (water < WET_HOLD_KGM2 ? water : WET_HOLD_KGM2) * dry;
    if (this.waterKg < WET_EPS && !(input > 0)) this.waterKg = 0;
    this.hailSettle = sH;
    this.snowSettle = sS;
  }

  /** The visible covers and the wetness from the state. */
  finish(): void {
    this.hailCover = this.hailKg > 0 ? 1 - Math.exp(-this.hailMm / HAIL_COVER_MM) : 0;
    this.snowCover = this.snowKg > 0 ? 1 - Math.exp(-this.snowMm / SNOW_COVER_MM) : 0;
    this.cover = 1 - (1 - this.hailCover) * (1 - this.snowCover);
    this.wetness = Math.min(1, this.waterKg / WET_HOLD_KGM2);
  }

  reset(): void {
    this.groundC = Number.NaN;
    this.hailKg = this.snowKg = this.waterKg = 0;
    this.hailSettle = this.snowSettle = 0;
    this.hailCover = this.snowCover = this.cover = this.wetness = 0;
  }
}

/** The two surface classes under the same precipitation and air. */
export class GroundCover {
  readonly soil = new SurfaceCover(SOIL);
  readonly pavement = new SurfaceCover(PAVEMENT);
  /** Hail or snow has fallen since the surfaces were last dry (the overlay draws the wetness only then). */
  frozenWet = false;
  /** Surface air temperature of the last update, deg C. */
  airC = Number.NaN;

  /**
   * Advance by dt s of simulated time with hail, snow and rain (mm/h liquid equivalent) and the surface air
   * temperature airC (deg C). Steps of at most SUBSTEP_S; dt 0 only sets the start temperature.
   */
  update(hailMmH: number, snowMmH: number, rainMmH: number, airC: number, dt: number): void {
    this.airC = airC;
    if (Number.isNaN(this.soil.groundC)) this.soil.groundC = restingC(SOIL, airC);
    if (Number.isNaN(this.pavement.groundC)) this.pavement.groundC = restingC(PAVEMENT, airC);
    if (!(dt > 0)) return;
    const mH = hailMmH > 0 ? hailMmH / 3600 : 0;
    const snow = snowMmH > 0 ? snowMmH / 3600 : 0;
    const frozen = 1 - smoothstep(SNOW_WET_C0, SNOW_WET_C1, airC);
    const mS = snow * frozen;
    const mW = snow - mS;
    const mR = rainMmH > 0 ? rainMmH / 3600 : 0;
    const snowC = airC < 0 ? airC : 0;
    const n = Math.ceil(dt / SUBSTEP_S);
    const h = dt / n;
    const dry = Math.exp(-h / WET_DRY_S);
    for (let i = 0; i < n; i++) {
      this.soil.step(h, mH, mS, mW, mR, snowC, airC, dry);
      this.pavement.step(h, mH, mS, mW, mR, snowC, airC, dry);
    }
    this.soil.finish();
    this.pavement.finish();
    if (mH > 0 || mS > 0) this.frozenWet = true;
    else if (this.soil.waterKg === 0 && this.pavement.waterKg === 0) this.frozenWet = false;
  }

  /** Nothing lies and no wetness from hail or snow is left. */
  get clear(): boolean {
    const s = this.soil, p = this.pavement;
    return s.hailKg === 0 && s.snowKg === 0 && p.hailKg === 0 && p.snowKg === 0 && !(this.frozenWet && (s.waterKg > 0 || p.waterKg > 0));
  }

  reset(): void {
    this.soil.reset();
    this.pavement.reset();
    this.frozenWet = false;
    this.airC = Number.NaN;
  }
}
