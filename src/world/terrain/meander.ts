// River meanders grown the way a river grows them: the channel centreline migrates sideways, eroding the outside of
// its bends, at a rate set by the curvature at that point and, more strongly, by the curvature upstream (Howard &
// Knutson 1984, after Ikeda, Parker & Sawai 1981). The flow carries the outer-bank scour of one bend on into the
// next, so bends grow, skew and travel downstream; when a loop's neck closes the river cuts through it and the loop
// is left behind as an oxbow lake. Pure and deterministic (fixed seed, no Math.random); runs once at module load.

import { clamp } from '../../core/math';
import { gnoise, mulberry32 } from './noise';

/** The valley axis the channel wanders about: a smooth densified centreline with its arc length, m. */
export interface MeanderAxis {
  north: Float64Array;
  east: Float64Array;
  s: Float64Array;
}

export interface MeanderReach {
  /** Channel half-width at valley arc length s, m. */
  halfWidth(s: number): number;
  /** How readily the banks erode, 0 (a confined or bedrock reach that keeps its line) to 1. */
  erodibility(s: number): number;
  /** Half-width of the meander belt (how far the channel may stray from the axis), m. */
  belt(s: number): number;
}

export interface Oxbow {
  north: Float64Array;
  east: Float64Array;
  /** Valley arc length of the loop's middle, m. */
  valleyS: number;
  /** Half-width of the channel it was cut from, m. */
  halfWidth: number;
  /** The step it was cut off at, 0..1 of the run (older loops have had longer to silt up). */
  age: number;
}

export interface MeanderResult {
  north: Float64Array;
  east: Float64Array;
  /** Valley arc length of each channel point's projection on the axis, m. */
  valleyS: Float64Array;
  oxbows: Oxbow[];
}

/** Local and upstream curvature weights of the bank-erosion rate (Howard & Knutson's Omega and Gamma). */
const OMEGA = -1;
const GAMMA = 2.5;
/** Upstream decay length of the curvature's influence, in channel widths: sets the meander wavelength (~10-14 widths). */
const DECAY_WIDTHS = 2.2;
/** A neck cuts through when its banks come within this many channel widths. */
const CUTOFF_WIDTHS = 1.6;

/** Index of the nearest axis segment to (n, e), searching outward from `hint`; writes the arc length and lateral offset. */
function project(axis: MeanderAxis, n: number, e: number, hint: number, out: { seg: number; s: number; lat: number }): void {
  const count = axis.north.length;
  let best = Infinity;
  let seg = hint;
  const lo = Math.max(0, hint - 6);
  const hi = Math.min(count - 2, hint + 6);
  for (let i = lo; i <= hi; i++) {
    const an = axis.north[i];
    const ae = axis.east[i];
    const dn = axis.north[i + 1] - an;
    const de = axis.east[i + 1] - ae;
    const l2 = dn * dn + de * de;
    const t = clamp(l2 > 0 ? ((n - an) * dn + (e - ae) * de) / l2 : 0, 0, 1);
    const qn = an + dn * t - n;
    const qe = ae + de * t - e;
    const d2 = qn * qn + qe * qe;
    if (d2 < best) {
      best = d2;
      seg = i;
      out.s = axis.s[i] + (axis.s[i + 1] - axis.s[i]) * t;
      // Positive to the right of the axis (looking downstream).
      out.lat = (dn * (e - ae) - de * (n - an) >= 0 ? 1 : -1) * Math.sqrt(d2);
    }
  }
  out.seg = seg;
}

/** Resample a polyline to uniform spacing `ds` (the last point kept), carrying the axis hint along. */
function resample(n: number[], e: number[], hint: number[], ds: number): { n: number[]; e: number[]; hint: number[] } {
  const rn: number[] = [n[0]];
  const re: number[] = [e[0]];
  const rh: number[] = [hint[0]];
  let carry = 0;
  for (let i = 0; i < n.length - 1; i++) {
    const seg = Math.hypot(n[i + 1] - n[i], e[i + 1] - e[i]);
    let t = ds - carry;
    while (t <= seg) {
      const f = t / seg;
      rn.push(n[i] + (n[i + 1] - n[i]) * f);
      re.push(e[i] + (e[i + 1] - e[i]) * f);
      rh.push(f < 0.5 ? hint[i] : hint[i + 1]);
      t += ds;
    }
    carry = seg - (t - ds);
  }
  const last = n.length - 1;
  if (carry > 0.25 * ds) {
    rn.push(n[last]);
    re.push(e[last]);
    rh.push(hint[last]);
  } else {
    rn[rn.length - 1] = n[last];
    re[re.length - 1] = e[last];
  }
  return { n: rn, e: re, hint: rh };
}

/**
 * Grow meanders on a channel that starts on the valley axis.
 * @param ds channel sample spacing, m.
 * @param steps migration steps (each moves the fastest-eroding bank by at most a fifth of `ds`).
 */
export function growMeanders(axis: MeanderAxis, reach: MeanderReach, seed: number, ds: number, steps: number): MeanderResult {
  const rnd = mulberry32(seed);
  const count = axis.north.length;
  const hints0: number[] = [];
  for (let i = 0; i < count; i++) hints0.push(Math.min(i, count - 2));
  let { n, e, hint } = resample(Array.from(axis.north), Array.from(axis.east), hints0, ds);
  const proj = { seg: 0, s: 0, lat: 0 };
  // A small random sideways offset to seed the bends (a perfectly straight channel has no curvature to grow).
  for (let i = 1; i < n.length - 1; i++) {
    project(axis, n[i], e[i], hint[i], proj);
    const i0 = Math.max(0, i - 1);
    const i1 = Math.min(n.length - 1, i + 1);
    const tn = n[i1] - n[i0];
    const te = e[i1] - e[i0];
    const tl = Math.hypot(tn, te) || 1;
    const off = reach.halfWidth(proj.s) * 0.6 * (rnd() - 0.5) * reach.erodibility(proj.s);
    n[i] -= (te / tl) * off;
    e[i] += (tn / tl) * off;
  }

  const oxbows: Oxbow[] = [];
  let theta = new Float64Array(0);
  let rate = new Float64Array(0);
  for (let step = 0; step < steps; step++) {
    const m = n.length;
    if (theta.length < m) {
      theta = new Float64Array(m * 2);
      rate = new Float64Array(m * 2);
    }
    for (let i = 0; i < m - 1; i++) theta[i] = Math.atan2(n[i + 1] - n[i], e[i + 1] - e[i]);
    theta[m - 1] = theta[m - 2];
    // Curvature (+ turning left), its upstream-weighted running mean, and the erosion rate of the outer bank.
    let upstream = 0;
    let fastest = 1e-9;
    for (let i = 0; i < m; i++) {
      let dt = i > 0 ? theta[i] - theta[i - 1] : 0;
      if (dt > Math.PI) dt -= 2 * Math.PI;
      else if (dt < -Math.PI) dt += 2 * Math.PI;
      const curv = dt / ds;
      project(axis, n[i], e[i], hint[i], proj);
      hint[i] = proj.seg;
      const w = reach.halfWidth(proj.s);
      // The wavelength varies a little from reach to reach (bank material, discharge).
      const decay = Math.exp(-ds / (DECAY_WIDTHS * (1 + 0.25 * gnoise(proj.s / 5100 + 2.7, 1.9)) * 2 * w));
      upstream = decay * upstream + (1 - decay) * curv;
      // Patchy bank material: some reaches cut faster, so the loops are irregular.
      const patch = clamp(0.9 + 0.7 * gnoise(proj.s / 2300 + 11.3, 4.1) + 0.3 * gnoise(proj.s / 700 + 5.2, 9.4), 0.25, 1.6);
      const r = reach.erodibility(proj.s) * patch * 2 * w * (OMEGA * curv + GAMMA * upstream);
      rate[i] = r;
      fastest = Math.max(fastest, Math.abs(r));
    }
    // Move every point to the outside of its bend (to the right of the flow for a left-hand bend), at most ds / 5.
    const k = (0.2 * ds) / fastest;
    for (let i = 2; i < m - 2; i++) {
      const tn = n[i + 1] - n[i - 1];
      const te = e[i + 1] - e[i - 1];
      const tl = Math.hypot(tn, te) || 1;
      // Flow direction (tn, te); its right-hand normal seen from above (north up, east right) is (-te, tn).
      let dn = (-te / tl) * rate[i] * k;
      let de = (tn / tl) * rate[i] * k;
      // Confinement: the valley walls stop a bend that reaches the edge of the belt.
      project(axis, n[i], e[i], hint[i], proj);
      const belt = reach.belt(proj.s);
      if (belt > 0) {
        const a = proj.seg;
        const an = axis.north[a + 1] - axis.north[a];
        const ae = axis.east[a + 1] - axis.east[a];
        const al = Math.hypot(an, ae) || 1;
        // Unit vector toward positive lateral offset (right of the axis).
        const un = (-ae / al) * Math.sign(proj.lat || 1);
        const ue = (an / al) * Math.sign(proj.lat || 1);
        const outward = dn * un + de * ue;
        const wall = clamp((Math.abs(proj.lat) - 0.6 * belt) / (0.4 * belt), 0, 1);
        if (outward > 0) {
          dn -= un * outward * wall;
          de -= ue * outward * wall;
        }
        if (Math.abs(proj.lat) > belt) {
          dn -= un * 0.05 * ds;
          de -= ue * 0.05 * ds;
        }
      }
      n[i] += dn;
      e[i] += de;
    }
    ({ n, e, hint } = resample(n, e, hint, ds));
    cutoff(n, e, hint, axis, reach, ds, step / steps, oxbows, proj);
  }

  // Drop oxbows (or the parts of them) the channel has since wandered back across.
  const m = n.length;
  const valleyS = new Float64Array(m);
  for (let i = 0; i < m; i++) {
    project(axis, n[i], e[i], hint[i], proj);
    valleyS[i] = proj.s;
  }
  // A loop cut off where an older one lay replaces it (the older is filled in by the newer channel's deposits).
  const kept = oxbows.filter((o, i) => !crossed(o, n, e) && !oxbows.slice(i + 1).some((later) => overlaps(o, later)));
  return { north: Float64Array.from(n), east: Float64Array.from(e), valleyS, oxbows: kept };
}

/** Find the first closed neck (two points far apart along the channel but close across it) and cut through it. */
function cutoff(n: number[], e: number[], hint: number[], axis: MeanderAxis, reach: MeanderReach, ds: number, age: number,
  oxbows: Oxbow[], proj: { seg: number; s: number; lat: number }): void {
  const cell = 120;
  const grid = new Map<number, number[]>();
  const key = (a: number, b: number): number => (a + 32768) * 65536 + (b + 32768);
  for (let i = 0; i < n.length; i++) {
    const cn = Math.floor(n[i] / cell);
    const ce = Math.floor(e[i] / cell);
    project(axis, n[i], e[i], hint[i], proj);
    const w = reach.halfWidth(proj.s);
    const reach2 = (CUTOFF_WIDTHS * 2 * w) ** 2;
    // Far enough along the channel that the two points cannot be neighbours on one bend.
    const gap = Math.ceil((10 * w) / ds);
    for (let a = cn - 1; a <= cn + 1; a++)
      for (let b = ce - 1; b <= ce + 1; b++) {
        const list = grid.get(key(a, b));
        if (!list) continue;
        for (const j of list) {
          if (i - j < gap) continue;
          const d2 = (n[i] - n[j]) ** 2 + (e[i] - e[j]) ** 2;
          if (d2 > reach2) continue;
          const loopN = Float64Array.from(n.slice(j, i + 1));
          const loopE = Float64Array.from(e.slice(j, i + 1));
          project(axis, n[(i + j) >> 1], e[(i + j) >> 1], hint[(i + j) >> 1], proj);
          oxbows.push({ north: loopN, east: loopE, valleyS: proj.s, halfWidth: w, age });
          n.splice(j + 1, i - j - 1);
          e.splice(j + 1, i - j - 1);
          hint.splice(j + 1, i - j - 1);
          return;
        }
      }
    const k = key(cn, ce);
    const list = grid.get(k);
    if (list) list.push(i);
    else grid.set(k, [i]);
  }
}

/** The channel passes within its own width of the oxbow somewhere. */
function crossed(o: Oxbow, n: number[], e: number[]): boolean {
  let n0 = Infinity, n1 = -Infinity, e0 = Infinity, e1 = -Infinity;
  for (let i = 0; i < o.north.length; i++) {
    n0 = Math.min(n0, o.north[i]);
    n1 = Math.max(n1, o.north[i]);
    e0 = Math.min(e0, o.east[i]);
    e1 = Math.max(e1, o.east[i]);
  }
  const r = 3 * o.halfWidth;
  for (let i = 0; i < n.length; i++) {
    if (n[i] < n0 - r || n[i] > n1 + r || e[i] < e0 - r || e[i] > e1 + r) continue;
    for (let k = 0; k < o.north.length; k += 2) if ((n[i] - o.north[k]) ** 2 + (e[i] - o.east[k]) ** 2 < r * r) return true;
  }
  return false;
}

/** The two loops come within a channel width of each other somewhere. */
function overlaps(a: Oxbow, b: Oxbow): boolean {
  const r = 2 * Math.max(a.halfWidth, b.halfWidth);
  for (let i = 0; i < a.north.length; i += 2)
    for (let k = 0; k < b.north.length; k += 2) if ((a.north[i] - b.north[k]) ** 2 + (a.east[i] - b.east[k]) ** 2 < r * r) return true;
  return false;
}

/** Valley arc length of each point of a polyline that follows the axis downstream (a sequential projection). */
export function projectPolyline(axis: MeanderAxis, north: ArrayLike<number>, east: ArrayLike<number>): Float64Array {
  const out = new Float64Array(north.length);
  const proj = { seg: 0, s: 0, lat: 0 };
  // The first point: a full search.
  let hint = 0;
  let best = Infinity;
  for (let i = 0; i < axis.north.length; i++) {
    const d = (axis.north[i] - north[0]) ** 2 + (axis.east[i] - east[0]) ** 2;
    if (d < best) {
      best = d;
      hint = Math.min(i, axis.north.length - 2);
    }
  }
  for (let i = 0; i < north.length; i++) {
    project(axis, north[i], east[i], hint, proj);
    hint = proj.seg;
    out[i] = proj.s;
  }
  return out;
}

/**
 * A polyline packed for a data module: the first point in decimetres as two int32, then each step as two int16
 * decimetre deltas (steps are at most a few tens of metres), little-endian, base64.
 */
export function encodePolyline(north: ArrayLike<number>, east: ArrayLike<number>): string {
  const m = north.length;
  const buf = new DataView(new ArrayBuffer(8 + (m - 1) * 4));
  let pn = Math.round(north[0] * 10);
  let pe = Math.round(east[0] * 10);
  buf.setInt32(0, pn, true);
  buf.setInt32(4, pe, true);
  for (let i = 1; i < m; i++) {
    const qn = Math.round(north[i] * 10);
    const qe = Math.round(east[i] * 10);
    buf.setInt16(8 + (i - 1) * 4, qn - pn, true);
    buf.setInt16(10 + (i - 1) * 4, qe - pe, true);
    pn = qn;
    pe = qe;
  }
  let bin = '';
  const bytes = new Uint8Array(buf.buffer);
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

export function decodePolyline(b64: string): { north: Float64Array; east: Float64Array } {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const buf = new DataView(bytes.buffer);
  const m = 1 + (bytes.length - 8) / 4;
  const north = new Float64Array(m);
  const east = new Float64Array(m);
  let pn = buf.getInt32(0, true);
  let pe = buf.getInt32(4, true);
  north[0] = pn / 10;
  east[0] = pe / 10;
  for (let i = 1; i < m; i++) {
    pn += buf.getInt16(8 + (i - 1) * 4, true);
    pe += buf.getInt16(10 + (i - 1) * 4, true);
    north[i] = pn / 10;
    east[i] = pe / 10;
  }
  return { north, east };
}
