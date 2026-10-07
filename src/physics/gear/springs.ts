// Vertical compliance of a landing-gear leg: the strut spring (oleo-pneumatic or steel leg) in series with
// the tyre's radial stiffness. The two springs carry the same axial force, so their deflections add; the
// combination is tabulated once as force(total deflection) to avoid an iterative solve in the hot path.

/** Radial tyre spring with progressive stiffening as the sidewalls fold toward the rim. */
export interface TyreSpring {
  /** Initial radial stiffness, N/m. */
  stiffness: number;
  /** Deflection at which the stiffness has doubled (sidewall close to bottoming on the rim), m. */
  hardening: number;
}

export function tyreSpringForce(t: TyreSpring, deflection: number): number {
  const r = deflection / t.hardening;
  return t.stiffness * deflection * (1 + r * r * r);
}

/** Static force-deflection characteristic of a strut. */
export interface StrutSpring {
  /** Strut compression (m) that carries an axial force (N) in static equilibrium; non-decreasing in force. */
  compressionAt(force: number): number;
}

/**
 * Oleo-pneumatic strut: a nitrogen column compressed polytropically, p V^n = const. The strut is preloaded
 * (fully extended until the axial force exceeds the precharge force) and stops hard at full stroke.
 *   F(s) = F0 (L / (L - s))^n,  L = effective gas column length (gas volume / piston area).
 */
export class OleoPneumaticSpring implements StrutSpring {
  constructor(
    /** Axial force at full extension, N. */
    readonly preload: number,
    /** Effective gas column length, m. */
    readonly gasColumn: number,
    /** Polytropic exponent: 1.0 isothermal (slow), 1.4 adiabatic (fast). */
    readonly polytropic: number,
    /** Usable stroke, m. */
    readonly stroke: number,
  ) {}

  compressionAt(force: number): number {
    if (force <= this.preload) return 0;
    const s = this.gasColumn * (1 - Math.pow(this.preload / force, 1 / this.polytropic));
    return Math.min(s, this.stroke);
  }
}

/** Linear spring: a spring-steel (Wittman) cantilever leg behaves elastically right up to yield. */
export class LinearStrutSpring implements StrutSpring {
  constructor(readonly stiffness: number) {}

  compressionAt(force: number): number {
    return force / this.stiffness;
  }
}

/** Result of evaluating a SeriesSpring. */
export interface SeriesSpringPoint {
  /** Axial force, N. */
  force: number;
  /** Strut share of the total deflection, m. */
  strut: number;
  /** d(strut)/d(total): the fraction of a total deflection rate taken by the strut. */
  strutRatio: number;
}

/** Strut and tyre springs in series, tabulated as a function of the total axial deflection. */
export class SeriesSpring {
  private readonly total: Float64Array;
  private readonly force: Float64Array;
  private readonly strut: Float64Array;

  constructor(strut: StrutSpring, tyre: TyreSpring, maxForce = 250e3, samples = 512) {
    this.total = new Float64Array(samples);
    this.force = new Float64Array(samples);
    this.strut = new Float64Array(samples);
    for (let i = 0; i < samples; i++) {
      // Quadratic spacing in force puts resolution where the aircraft actually operates (0-20 kN).
      const f = maxForce * (i / (samples - 1)) ** 2;
      const s = strut.compressionAt(f);
      this.force[i] = f;
      this.strut[i] = s;
      this.total[i] = s + invertTyre(tyre, f);
    }
  }

  /** Axial force and strut compression at a total deflection x >= 0. Extrapolates linearly past the table. */
  evaluate(x: number, out: SeriesSpringPoint): SeriesSpringPoint {
    const xs = this.total;
    const n = xs.length;
    let lo = 0;
    if (x >= xs[n - 2]) {
      lo = n - 2;
    } else {
      let hi = n - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (xs[mid] <= x) lo = mid;
        else hi = mid;
      }
    }
    const dx = xs[lo + 1] - xs[lo];
    const t = (x - xs[lo]) / dx;
    const ds = this.strut[lo + 1] - this.strut[lo];
    out.force = this.force[lo] + (this.force[lo + 1] - this.force[lo]) * t;
    out.strut = Math.min(this.strut[lo] + ds * t, this.strut[n - 1]);
    out.strutRatio = ds / dx;
    return out;
  }

  /** Total deflection that carries a given axial force (static equilibrium), m. */
  deflectionAt(force: number): number {
    const fs = this.force;
    const n = fs.length;
    if (force <= 0) return 0;
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (fs[mid] <= force) lo = mid;
      else hi = mid;
    }
    const t = Math.min(1, (force - fs[lo]) / (fs[lo + 1] - fs[lo]));
    return this.total[lo] + (this.total[lo + 1] - this.total[lo]) * t;
  }
}

/** Tyre deflection carrying a radial force (bisection; construction time only). */
function invertTyre(tyre: TyreSpring, force: number): number {
  let lo = 0;
  let hi = force / tyre.stiffness; // the linear estimate is an upper bound because the spring only stiffens
  for (let i = 0; i < 60; i++) {
    const mid = 0.5 * (lo + hi);
    if (tyreSpringForce(tyre, mid) < force) lo = mid;
    else hi = mid;
  }
  return 0.5 * (lo + hi);
}
