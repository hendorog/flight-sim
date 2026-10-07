// Continuous turbulence: MIL-F-8785C Dryden intensities and scale lengths, synthesised as a frozen spatial
// field so it can be sampled at any point (every blade element and the tail see correctly correlated gusts,
// which produces the rotary gust components p_g, q_g, r_g for free) and advected with the mean wind.
//
// INTENSITY AND SCALE (MIL-F-8785C 3.7.3, MIL-HDBK-1797 fig. 256; h in feet, W20 = wind at 20 ft in kt):
//   low altitude,  h < 1000 ft:  L_w = h,  L_u = L_v = h / (0.177 + 0.000823 h)^1.2,
//                                sigma_w = 0.1 W20,  sigma_u = sigma_v = sigma_w / (0.177 + 0.000823 h)^0.4
//   medium/high,  h > 2000 ft:   L_u = L_v = L_w = 1750 ft, sigma_u = sigma_v = sigma_w from the
//                                probability-of-exceedance table (light 1e-2, moderate 1e-3, severe 1e-5)
//   in between: linear interpolation in h.
// The turbulence setting 0..1 maps to none / light (W20 = 15 kt) / moderate (30 kt) / severe (45 kt) at
// 0, 1/3, 2/3, 1. Mechanical turbulence from the actual surface wind is added in quadrature to W20.
//
// SYNTHESIS. Each component is a sum of Fourier modes with horizontal wavevectors of random direction:
//     f(x) = sum_n a_n cos(k_n . (x - D) + kz_n z + w_n t + phi_n)
// For a horizontally isotropic field the 1-D spectrum along any horizontal line is the Abel transform of the
// radial energy distribution. Inverting it for the Dryden forms gives closed-form cumulative energy
// fractions in the wavenumber magnitude k:
//     longitudinal  Phi = sigma^2 (2L/pi) / (1 + (Lk)^2)               ->  F(k) = 1 - 1/sqrt(1 + (Lk)^2)
//     transverse    Phi = sigma^2 (L/pi) (1 + 3(Lk)^2)/(1 + (Lk)^2)^2 ->  F(k) = 1 - 1.5/s + 0.5/s^3,  s = sqrt(1 + (Lk)^2)
// so a mode spanning [k0, k1] gets a_n^2 / 2 = sigma^2 (F(k1) - F(k0)). The mode wavenumbers are fixed and
// only the amplitudes depend on the height-dependent L and sigma, so climbing through the layers changes
// the statistics smoothly without any phase jumps. The along-wind component u takes the longitudinal
// spectrum and v, w the transverse one, i.e. the spectra are exact for flight along the mean wind (the
// MIL-F-8785C low-altitude convention); the synthetic field is not divergence-free.
// D is the mean-wind advection displacement (Taylor's frozen turbulence); a slow per-mode phase drift
// (eddy turnover) keeps the field alive in calm air.

import { FT, KT, interp1 } from '../../core/math';
import { mulberry32 } from './random';

export interface TurbulenceIntensity {
  /** RMS gust velocities along-wind, cross-wind and vertical, m/s. */
  sigmaU: number;
  sigmaV: number;
  sigmaW: number;
  /** Scale lengths, m. */
  lengthU: number;
  lengthV: number;
  lengthW: number;
}

const SEVERITY_W20_KT = [0, 15, 30, 45];
const HIGH_ALTITUDE_FT = [500, 1750, 3750, 7500, 15000, 25000, 35000, 45000];
/** sigma (ft/s) vs altitude for none / light / moderate / severe (MIL-HDBK-1797 fig. 256). */
const HIGH_ALTITUDE_SIGMA_FTPS = [
  [0, 0, 0, 0, 0, 0, 0, 0],
  [6.6, 6.9, 7.4, 6.7, 4.6, 2.7, 0.4, 0],
  [8.6, 9.6, 10.6, 10.1, 8.0, 6.6, 5.0, 4.2],
  [15.6, 17.6, 23.0, 23.6, 22.1, 20.0, 16.0, 15.1],
];
const HIGH_ALTITUDE_SCALE_FT = 1750;
const LOW_ALTITUDE_TOP_FT = 1000;
const HIGH_ALTITUDE_BOTTOM_FT = 2000;
/** The low-altitude model is not defined below 10 ft. */
const MIN_HEIGHT_FT = 10;

/**
 * MIL-F-8785C Dryden intensities and scale lengths at a height above ground.
 * @param severity turbulence setting 0..1 (none, light, moderate, severe at 0, 1/3, 2/3, 1)
 * @param mechanicalW20 mean wind speed at 20 ft AGL that generates mechanical turbulence, m/s
 */
export function milTurbulenceIntensity(heightAGL: number, severity: number, mechanicalW20: number, out: TurbulenceIntensity): TurbulenceIntensity {
  const s = Math.max(0, Math.min(1, severity)) * 3;
  const i0 = Math.min(2, Math.floor(s));
  const f = s - i0;
  const w20Setting = (SEVERITY_W20_KT[i0] + (SEVERITY_W20_KT[i0 + 1] - SEVERITY_W20_KT[i0]) * f) * KT;
  const w20 = Math.hypot(w20Setting, mechanicalW20);

  const hft = Math.max(MIN_HEIGHT_FT, heightAGL / FT);
  // Low-altitude model, evaluated no higher than its 1000 ft ceiling.
  const hl = Math.min(hft, LOW_ALTITUDE_TOP_FT);
  const d = 0.177 + 0.000823 * hl;
  const sigmaWLow = 0.1 * w20;
  const sigmaULow = sigmaWLow / Math.pow(d, 0.4);
  const lengthULow = (hl / Math.pow(d, 1.2)) * FT;
  const lengthWLow = hl * FT;
  // Medium/high-altitude model, evaluated no lower than its 2000 ft floor.
  const hh = Math.max(hft, HIGH_ALTITUDE_BOTTOM_FT);
  const lo = interp1(HIGH_ALTITUDE_FT, HIGH_ALTITUDE_SIGMA_FTPS[i0], hh);
  const hi = interp1(HIGH_ALTITUDE_FT, HIGH_ALTITUDE_SIGMA_FTPS[i0 + 1], hh);
  const sigmaHigh = (lo + (hi - lo) * f) * FT;
  const lengthHigh = HIGH_ALTITUDE_SCALE_FT * FT;

  const b = Math.max(0, Math.min(1, (hft - LOW_ALTITUDE_TOP_FT) / (HIGH_ALTITUDE_BOTTOM_FT - LOW_ALTITUDE_TOP_FT)));
  out.sigmaU = out.sigmaV = sigmaULow + (sigmaHigh - sigmaULow) * b;
  out.sigmaW = sigmaWLow + (sigmaHigh - sigmaWLow) * b;
  out.lengthU = out.lengthV = lengthULow + (lengthHigh - lengthULow) * b;
  out.lengthW = lengthWLow + (lengthHigh - lengthWLow) * b;
  return out;
}

/** Cumulative energy fraction below wavenumber k of the longitudinal Dryden field (see header). */
export function longitudinalEnergyFraction(k: number, L: number): number {
  return 1 - 1 / Math.sqrt(1 + L * L * k * k);
}

/** Cumulative energy fraction below wavenumber k of the transverse Dryden field (see header). */
export function transverseEnergyFraction(k: number, L: number): number {
  const s = Math.sqrt(1 + L * L * k * k);
  return 1 - 1.5 / s + 0.5 / (s * s * s);
}

/** One-sided Dryden spectra (m^2/s^2 per rad/m), for tests and diagnostics. */
export function drydenLongitudinalSpectrum(k: number, sigma: number, L: number): number {
  return (sigma * sigma * 2 * L) / Math.PI / (1 + L * L * k * k);
}
export function drydenTransverseSpectrum(k: number, sigma: number, L: number): number {
  const x = L * L * k * k;
  return ((sigma * sigma * L) / Math.PI) * ((1 + 3 * x) / ((1 + x) * (1 + x)));
}

/** Wavenumber band of the synthesis, rad/m: from ~60 km to ~2 m wavelength (shorter gusts average out over the airframe). */
const K_MIN = 1e-4;
const K_MAX = 3;
/** Eddy turnover speed that slowly decorrelates the frozen field, m/s. */
const EDDY_SPEED = 1.5;

type EnergyFraction = (k: number, L: number) => number;

/** One turbulence velocity component synthesised from random Fourier modes. */
class ModeSet {
  private readonly kx: Float64Array;
  private readonly ky: Float64Array;
  private readonly kz: Float64Array;
  private readonly omega: Float64Array;
  private readonly phase: Float64Array;
  /** Band edges of each mode, rad/m: mode n covers [edges[n], edges[n + 1]]. */
  private readonly edges: Float64Array;
  /** sqrt(2 * energy fraction) of each mode for `cachedLength`. */
  private readonly amplitude: Float64Array;
  private cachedLength = -1;

  constructor(
    private readonly energyFraction: EnergyFraction,
    modes: number,
    rand: () => number,
  ) {
    this.kx = new Float64Array(modes);
    this.ky = new Float64Array(modes);
    this.kz = new Float64Array(modes);
    this.omega = new Float64Array(modes);
    this.phase = new Float64Array(modes);
    this.amplitude = new Float64Array(modes);
    this.edges = new Float64Array(modes + 1);
    // Band 0 spans [0, K_MIN]; the rest are log-spaced up to K_MAX.
    for (let n = 1; n <= modes; n++) this.edges[n] = K_MIN * Math.pow(K_MAX / K_MIN, (n - 1) / (modes - 1));
    for (let n = 0; n < modes; n++) {
      const lo = n === 0 ? 0.5 * K_MIN : this.edges[n];
      const hi = this.edges[n + 1];
      // Random log-position inside the band avoids a periodic, "comb" spectrum.
      const k = lo * Math.pow(hi / lo, 0.2 + 0.6 * rand());
      const dir = 2 * Math.PI * rand();
      this.kx[n] = k * Math.cos(dir);
      this.ky[n] = k * Math.sin(dir);
      this.kz[n] = k * (2 * rand() - 1);
      this.omega[n] = k * EDDY_SPEED * (2 * rand() - 1);
      this.phase[n] = 2 * Math.PI * rand();
    }
  }

  /** Unit-variance (for the full spectrum) sample at a point; L is the local scale length. */
  sample(x: number, y: number, z: number, t: number, L: number): number {
    if (L !== this.cachedLength) this.updateAmplitudes(L);
    const { kx, ky, kz, omega, phase, amplitude } = this;
    let sum = 0;
    for (let n = 0; n < kx.length; n++) {
      const a = amplitude[n];
      if (a > 1e-5) sum += a * Math.cos(kx[n] * x + ky[n] * y + kz[n] * z + omega[n] * t + phase[n]);
    }
    return sum;
  }

  private updateAmplitudes(L: number): void {
    let prev = 0;
    for (let n = 0; n < this.amplitude.length; n++) {
      const next = this.energyFraction(this.edges[n + 1], L);
      this.amplitude[n] = Math.sqrt(2 * Math.max(0, next - prev));
      prev = next;
    }
    this.cachedLength = L;
  }
}

/** Correlated u/v/w turbulence field with height-dependent Dryden statistics. */
export class SpectralTurbulence {
  private readonly u: ModeSet;
  private readonly v: ModeSet;
  private readonly w: ModeSet;

  constructor(seed: number, modesPerComponent = 80) {
    const rand = mulberry32(seed);
    this.u = new ModeSet(longitudinalEnergyFraction, modesPerComponent, rand);
    this.v = new ModeSet(transverseEnergyFraction, modesPerComponent, rand);
    this.w = new ModeSet(transverseEnergyFraction, modesPerComponent, rand);
  }

  /**
   * Gust velocity components (u along the mean wind, v to its right, w up), m/s, at a point in the
   * advected frame (x, y = NED north/east minus the advection displacement; z = NED down).
   */
  sample(x: number, y: number, z: number, t: number, I: TurbulenceIntensity, out: { u: number; v: number; w: number }): void {
    out.u = I.sigmaU > 0 ? I.sigmaU * this.u.sample(x, y, z, t, I.lengthU) : 0;
    out.v = I.sigmaV > 0 ? I.sigmaV * this.v.sample(x, y, z, t, I.lengthV) : 0;
    out.w = I.sigmaW > 0 ? I.sigmaW * this.w.sample(x, y, z, t, I.lengthW) : 0;
  }
}
