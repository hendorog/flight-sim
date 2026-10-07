// A fuselage (or nacelle) as a lofted surface: a table of cross-sections along the body x axis,
// interpolated monotonically, each section a pair of superellipse halves (flat-sided cabin, rounder
// cowling and tail cone) plus a narrow dorsal ridge that grows into the fin fillet.
//
// The surface is parameterised by (s, t): s is normalised arc length along the body from the cowling face
// to the tail (so texels are evenly spread even where the cowling face turns sharply), t is normalised arc
// length around the section starting at the bottom centreline and running up the right side. The livery
// and window masks are baked on exactly this parameterisation, so geometry and textures always agree.
//
// The table is the airframe definition's (LoftDef: aircraft/<id>/visual.ts); the default is the Cessna 172S,
// whose cabin top between the wing roots follows the root airfoil so the wing carry-through is faired.

import { C172S_VISUAL } from '../../aircraft/c172s/visual';
import type { LoftDef } from './airframe/types';
import { Pchip } from './geometry';

export interface Section {
  x: number;
  /** z of the top and bottom centreline, and of the widest point (FRD, z down). */
  zTop: number;
  zBot: number;
  zMid: number;
  /** Half width at zMid. */
  hw: number;
  /** Superellipse exponents of the upper and lower halves (2 = ellipse, larger = boxier). */
  nTop: number;
  nBot: number;
  /** Height of the dorsal ridge above zTop on the centreline, and its half width. */
  ridge: number;
  ridgeW: number;
}

// The Cessna 172S stations, for the modules and tests that name them.
/** Cowling face / spinner backplate station and tail cone end. */
export const FUSELAGE_FRONT_X = C172S_VISUAL.fuselage.frontX;
export const FUSELAGE_END_X = C172S_VISUAL.fuselage.endX;
/** Firewall station (cowling / cabin joint). */
export const FIREWALL_X = C172S_VISUAL.glazing.firewallX;
/** Cabin extent covered by glazing and lining (firewall to the baggage bulkhead). */
export const CABIN_FRONT_X = C172S_VISUAL.glazing.cabinFrontX;
export const CABIN_REAR_X = C172S_VISUAL.glazing.cabinRearX;

/** How far the Cessna 172S cabin belly is lowered from its base key table, m (applied in its definition). */
export const BELLY_DROP = 0.1;

/** Half width of the dorsal ridge where the table gives none, m. */
const RIDGE_W = 0.055;

const ARC_SAMPLES = 256;

/** Arc-length parameterised ring of one section. */
export class Ring {
  readonly y = new Float64Array(ARC_SAMPLES + 1);
  readonly z = new Float64Array(ARC_SAMPLES + 1);
  readonly len = new Float64Array(ARC_SAMPLES + 1);
  /** Perimeter of the section, m. */
  circumference = 0;
  private cursor = 0;

  set(sec: Section): this {
    for (let k = 0; k <= ARC_SAMPLES; k++) {
      const th = (k / ARC_SAMPLES) * Math.PI * 2;
      const right = th <= Math.PI;
      const a = right ? th : 2 * Math.PI - th;
      const s = Math.sin(a);
      const c = Math.cos(a);
      let yy: number;
      let zz: number;
      if (a <= Math.PI / 2) {
        yy = sec.hw * Math.pow(s, 2 / sec.nBot);
        zz = sec.zMid + (sec.zBot - sec.zMid) * Math.pow(Math.max(0, c), 2 / sec.nBot);
      } else {
        yy = sec.hw * Math.pow(s, 2 / sec.nTop);
        zz = sec.zMid - (sec.zMid - sec.zTop) * Math.pow(Math.max(0, -c), 2 / sec.nTop);
        if (sec.ridge > 0 && yy < sec.ridgeW) {
          const q = 1 - (yy / sec.ridgeW) ** 2;
          zz -= sec.ridge * q * q;
        }
      }
      this.y[k] = right ? yy : -yy;
      this.z[k] = zz;
      this.len[k] = k === 0 ? 0 : this.len[k - 1] + Math.hypot(this.y[k] - this.y[k - 1], this.z[k] - this.z[k - 1]);
    }
    const L = this.len[ARC_SAMPLES];
    this.circumference = L;
    for (let k = 0; k <= ARC_SAMPLES; k++) this.len[k] /= L;
    this.cursor = 0;
    return this;
  }

  /** Point at arc-length fraction t. Fastest when called with increasing t. */
  at(t: number, out: { y: number; z: number }): void {
    let k = this.cursor;
    if (k >= ARC_SAMPLES || this.len[k] > t) k = 0;
    while (k < ARC_SAMPLES - 1 && this.len[k + 1] < t) k++;
    this.cursor = k;
    const span = this.len[k + 1] - this.len[k];
    const f = span > 0 ? Math.min(1, Math.max(0, (t - this.len[k]) / span)) : 0;
    out.y = this.y[k] + (this.y[k + 1] - this.y[k]) * f;
    out.z = this.z[k] + (this.z[k + 1] - this.z[k]) * f;
  }
}

const S_TABLE = 2048;

export class FuselageShape {
  private readonly curves: Pchip[];
  private readonly xOfS = new Float64Array(S_TABLE + 1);
  private readonly sec: Section = { x: 0, zTop: 0, zBot: 0, zMid: 0, hw: 0, nTop: 2, nBot: 2, ridge: 0, ridgeW: 0.05 };
  private readonly ridgeW: number;

  /**
   * @param inset  Uniform inward offset, m: 0 is the outer skin; the cabin lining and window glass use
   *               inset copies with the same (s, t) parameterisation.
   * @param roofLimit  Optional highest allowed top (FRD z) for the inset surface (cabin headliner).
   * @param loft  The station table (default: the Cessna 172S fuselage).
   */
  constructor(
    readonly inset = 0,
    private readonly roofLimit = -Infinity,
    private readonly loft: LoftDef = C172S_VISUAL.fuselage,
  ) {
    const keys = loft.keys;
    this.ridgeW = loft.ridgeW ?? RIDGE_W;
    const xs = keys.map((k) => -k[0]);
    this.curves = [1, 2, 3, 4, 5, 6, 7].map((c) => new Pchip(xs, keys.map((k) => k[c])));
    // Arc length along the body, measured on the section outline, defines s.
    const n = 4000;
    const L = new Float64Array(n + 1);
    const X = new Float64Array(n + 1);
    let prev = this.section(this.xAt(0, n));
    X[0] = prev.x;
    let prevTop = prev.zTop;
    let prevBot = prev.zBot;
    let prevHw = prev.hw;
    for (let i = 1; i <= n; i++) {
      const x = this.xAt(i, n);
      prev = this.section(x);
      X[i] = x;
      L[i] = L[i - 1] + Math.hypot(X[i] - X[i - 1], prev.zTop - prevTop, prev.zBot - prevBot, 1.6 * (prev.hw - prevHw));
      prevTop = prev.zTop;
      prevBot = prev.zBot;
      prevHw = prev.hw;
    }
    let k = 0;
    for (let j = 0; j <= S_TABLE; j++) {
      const target = (L[n] * j) / S_TABLE;
      while (k < n - 1 && L[k + 1] < target) k++;
      const f = (target - L[k]) / (L[k + 1] - L[k] || 1);
      this.xOfS[j] = X[k] + (X[k + 1] - X[k]) * Math.min(1, Math.max(0, f));
    }
  }

  private xAt(i: number, n: number): number {
    return this.loft.frontX + ((this.loft.endX - this.loft.frontX) * i) / n;
  }

  /** Body x at surface parameter s. */
  x(s: number): number {
    const f = Math.min(1, Math.max(0, s)) * S_TABLE;
    const j = Math.min(S_TABLE - 1, Math.floor(f));
    return this.xOfS[j] + (this.xOfS[j + 1] - this.xOfS[j]) * (f - j);
  }

  /** Surface parameter s at body x (inverse of x(s)). */
  s(x: number): number {
    let lo = 0;
    let hi = S_TABLE;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.xOfS[mid] >= x) lo = mid;
      else hi = mid;
    }
    const f = (x - this.xOfS[lo]) / (this.xOfS[hi] - this.xOfS[lo] || 1);
    return (lo + Math.min(1, Math.max(0, f))) / S_TABLE;
  }

  /** Section at body x. The returned object is reused by the next call. */
  section(x: number): Section {
    const c = this.curves;
    const u = -x;
    const d = this.inset;
    const s = this.sec;
    s.x = x;
    s.zTop = Math.max(this.roofLimit, c[0].eval(u) + d);
    s.zBot = c[1].eval(u) - d;
    s.zMid = c[2].eval(u);
    s.hw = Math.max(0.01, c[3].eval(u) - d);
    s.nTop = c[4].eval(u);
    s.nBot = c[5].eval(u);
    s.ridge = Math.max(0, c[6].eval(u) - d * 2);
    s.ridgeW = this.ridgeW;
    return s;
  }
}
