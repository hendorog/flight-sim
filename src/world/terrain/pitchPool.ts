// Pitches and pools along a seeded world's steep streams (any seed but 0; streams.ts lines, kind 1).
//
// A stream losing height quickly does not run down an even slope: its water gathers in pools and glides behind steps of
// boulders and rock, then pours over them in short steep pitches of white water. On a steep reach (a step-pool
// channel) the steps lie about one to four channel widths apart; on a gentler one (rapids, riffles) the riffles about
// five to seven widths apart. So the water's profile is cut into units, each a pitch (from its lip down to its foot)
// and the pool below it (from the foot to the next unit's lip), at irregular spacing.
//
// The units are laid out along a "unit coordinate" sigma that grows by one per typical unit length (pitchUnit: from
// the width and the reach's gradient), so the spacing follows the stream as it widens and steepens; unit k's lip lies at
// sigma = k + lipOf(k) and its foot pitchLen(k) further on, both from an integer hash of k (noise.ts hash2i; GLSL twin
// PITCH_GLSL), so the spacing is irregular (half to one and a half units) but the same in every thread and in the
// shaders. Each line's sigma starts at its own offset, so no two streams share a sequence. The ribbon carries sigma and
// where the units are drawn (`on`) per row (water.ts aPitch): the water's shader breaks the pitches white and leaves
// the pools dark and smooth, and the bed's stones (channelStones.ts) crowd onto the pitches and leave the pools clear,
// from the same numbers on both sides.
//
// The new profile never lies above the old one (the water followed the ground down; heightfield.ts carves its bed and
// banks about the water, and carving only lowers): each lip stays on the old level, the pool behind it is held nearly
// level back up to the last pitch's foot (at most POOL_DEEP under the old level there), and the pitch drops from the lip
// to that foot. Pure and three.js-free.

import { hash2i } from './noise';
import type { LineArrays } from './falls';

/** Reach gradient (over GRADIENT_RUN m) from which a stream's water is cut into units (the start of riffles and rapids). */
export const PITCH_G_LO = 0.02;
/** Typical unit length in channel widths on gentle reaches (riffle and pool) and steep ones (step and pool), and the
 * gradients between which the one gives way to the other. */
const UNIT_GENTLE = 6;
const UNIT_STEEP = 2.5;
const UNIT_G0 = 0.04;
const UNIT_G1 = 0.1;
/** Shortest and longest typical unit, m. */
const UNIT_MIN = 9;
const UNIT_MAX = 120;
/** Gradient window for a unit's reach, m (each side half of it). */
const GRADIENT_RUN = 120;
/** A pool's surface falls at POOL_SHARE of the reach's gradient plus POOL_MIN; its head lies at most POOL_DEEP m under
 * the old level (a deeper pool is tilted to keep it). */
const POOL_SHARE = 0.08;
const POOL_MIN = 0.003;
const POOL_DEEP = 2.5;
/** ... plus this share for the smallest unit (unitSize). */
const POOL_RIFFLE = 0.55;
/** No units within this of a fall (its lip or foot), of the line's head and of its mouth, m. */
const FALL_CLEAR = 30;
const HEAD_CLEAR = 20;
const MOUTH_CLEAR = 30;
/** A unit's pool holds a sample of the line when one lies more than this past its foot and short of its next lip, m. */
const POOL_GAP = 0.3;

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Typical unit length for a channel of half-width hw on a reach of gradient g, m. */
export function pitchUnit(hw: number, g: number): number {
  return Math.min(UNIT_MAX, Math.max(UNIT_MIN, 2 * hw * (UNIT_GENTLE + (UNIT_STEEP - UNIT_GENTLE) * smooth(UNIT_G0, UNIT_G1, g))));
}

// Unit k's numbers (k >= -8: the hash's inputs stay positive, as the GLSL twin needs).
const unitHash = (k: number): number => hash2i(k + 8, 0x51ed);
const unitHash2 = (k: number): number => hash2i(k + 8, 0x51ee);
/** Unit k's lip, in units from k: 0.12 to 0.88 (lips a quarter to one and three quarters of a unit apart). */
export const lipOf = (k: number): number => k + 0.12 + 0.76 * ((unitHash(k) & 0xffff) / 65536);
/** Unit k's pitch, lip to foot, in units: 0.14 to 0.32, at most PITCH_SHARE of the way to the next lip. */
const PITCH_SHARE = 0.6;
export const pitchLen = (k: number): number => Math.min(0.14 + 0.18 * ((unitHash(k) >>> 16) / 65536), PITCH_SHARE * (lipOf(k + 1) - lipOf(k)));
/** Unit k's size, 0.3 to 1: a small one is a riffle (its pool runs on down at a good share of the reach's gradient, its
 * pitch a short drop, less white), a big one a step of boulders (a still pool behind it, the drop gathered at it). */
export const unitSize = (k: number): number => 0.3 + 0.7 * ((unitHash2(k) & 0xffff) / 65536);

/** Where sigma lies among the units: its unit `k` (lipOf(k) <= sigma < lipOf(k + 1)) and how far past the lip, in units. */
export interface PitchPhase {
  k: number;
  /** sigma - lipOf(k): 0 at the lip, pitchLen(k) at the foot. */
  u: number;
  /** The pitch's length and the unit's (lip to the next lip), in units; its size (unitSize). */
  pitch: number;
  span: number;
  size: number;
}
export function pitchPhase(sigma: number, out: PitchPhase): PitchPhase {
  let k = Math.floor(sigma);
  let lip = lipOf(k);
  if (sigma < lip) {
    k--;
    lip = lipOf(k);
  }
  out.k = k;
  out.u = sigma - lip;
  out.span = lipOf(k + 1) - lip;
  out.pitch = Math.min(pitchLen(k), out.span * PITCH_SHARE);
  out.size = unitSize(k);
  return out;
}

/**
 * GLSL twins (needs HASH_GLSL's hash2u; the world seed's salt baked in as hash2i adds it in JS):
 * pitchPhase(sigma) -> vec4(u, pitch, span, k).
 */
export function pitchGlsl(saltX: number, saltY: number): string {
  return /* glsl */ `
uint ppHash(int k) { return hash2u(k + 8 + ${saltX}, ${0x51ed} + ${saltY}); }
float ppLip(int k) { return float(k) + 0.12 + 0.76 * float(ppHash(k) & 0xffffu) * (1.0 / 65536.0); }
// (u past the lip, pitch, span to the next lip, size) of sigma's unit.
vec4 pitchPhase(float sigma) {
  int k = int(floor(sigma));
  float lip = ppLip(k);
  if (sigma < lip) { k -= 1; lip = ppLip(k); }
  float span = ppLip(k + 1) - lip;
  float pitch = min(0.14 + 0.18 * float(ppHash(k) >> 16) * (1.0 / 65536.0), ${PITCH_SHARE.toFixed(2)} * span);
  float size = 0.3 + 0.7 * float(hash2u(k + 8 + ${saltX}, ${0x51ee} + ${saltY}) & 0xffffu) * (1.0 / 65536.0);
  return vec4(sigma - lip, pitch, span, size);
}
`;
}

export interface PitchReport {
  /** Units found on the steep reaches, and those shaped (a sample of the line in its pool); their spacing (lip to lip)
   * in channel widths and m, and drops (lip to foot), m. */
  found: number;
  units: number;
  spacingW: number[];
  spacingM: number[];
  drop: number[];
  gradient: number[];
  /** How far the pools' heads lie under the old level, m; samples put in at the feet of units with none in their pool. */
  deepen: number[];
  inserted: number;
  /** Time taken over all streams, ms. */
  ms: number;
}

/**
 * Cut a stream's steep reaches into pitches and pools. `a` its arrays (level final but for this), `line` its index
 * (its sigma's offset), `falls` the arc lengths of its falls' lips and feet (no units near them), `wet` whether a point
 * lies in a lake's water (no units there). Returns the arrays (the level reshaped, on the line's own samples) plus `sigma`
 * and `on`, and `map`: each old sample's new index (a sample put in at the foot of each unit with none in its pool).
 */
export function pitchPool(a: LineArrays, line: number, falls: ReadonlyArray<number>, wet: (north: number, east: number) => boolean, report?: PitchReport): { a: LineArrays; map: Int32Array } {
  const n = a.s.length;
  const s = a.s;
  const L = a.level;
  const end = s[n - 1];
  // --- The reach's gradient about each sample (the old level over GRADIENT_RUN).
  const g = new Float64Array(n);
  {
    const h = GRADIENT_RUN / 2;
    let lo = 0;
    let hi = 0;
    for (let i = 0; i < n; i++) {
      while (lo < i && s[i] - s[lo] > h) lo++;
      while (hi < n - 1 && s[hi + 1] - s[i] <= h) hi++;
      const run = s[hi] - s[lo];
      g[i] = run > 1 ? Math.max(0, (L[lo] - L[hi]) / run) : 0;
    }
  }
  // --- Where units may be: steep enough, dry, clear of the falls and the ends.
  const ok = new Uint8Array(n);
  // (A stream lies in a lake's water only at its ends - an outlet's head, its mouth in a lake: looked at from each end
  // until the first dry sample.)
  const wetAt = new Uint8Array(n);
  for (let i = 0; i < n && wet(a.north[i], a.east[i]); i++) wetAt[i] = 1;
  for (let i = n - 1; i >= 0 && !wetAt[i] && wet(a.north[i], a.east[i]); i--) wetAt[i] = 1;
  for (let i = 0; i < n; i++) {
    if (g[i] < PITCH_G_LO || s[i] < HEAD_CLEAR || s[i] > end - MOUTH_CLEAR || L[i] < 0.5) continue;
    let near = false;
    for (const f of falls) if (Math.abs(f - s[i]) < FALL_CLEAR) near = true;
    if (near || wetAt[i]) continue;
    ok[i] = 1;
  }
  // --- The unit coordinate.
  const sig = new Float64Array(n);
  sig[0] = (hash2i(line, 0x5157) & 1023) + 0.5;
  for (let i = 1; i < n; i++) {
    const u0 = pitchUnit(a.halfWidth[i - 1], g[i - 1]);
    const u1 = pitchUnit(a.halfWidth[i], g[i]);
    sig[i] = sig[i - 1] + (s[i] - s[i - 1]) * (2 / (u0 + u1));
  }
  /** Arc length at unit coordinate v (inverse of sig, linear between samples); its segment in seg.i. */
  const seg = { i: 0 };
  const sOf = (v: number): number => {
    let i = seg.i;
    while (i < n - 2 && sig[i + 1] < v) i++;
    seg.i = i;
    const t = (v - sig[i]) / Math.max(1e-12, sig[i + 1] - sig[i]);
    return s[i] + (s[i + 1] - s[i]) * t;
  };
  /** Whether a unit may lie over the segment holding arc length sv (both its samples allowed). */
  const allowed = (sv: number): boolean => {
    let i = 0;
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      i = (lo + hi) >> 1;
      if (s[i] <= sv) lo = i;
      else hi = i;
    }
    return ok[lo] === 1 && ok[hi] === 1;
  };
  // --- The units: lip, foot and the next lip, all where units may be.
  type Unit = { k: number; lip: number; foot: number; next: number; size: number };
  const units: Unit[] = [];
  {
    seg.i = 0;
    const k0 = Math.floor(sig[0]) - 1;
    const k1 = Math.floor(sig[n - 1]) + 1;
    for (let k = k0; k <= k1; k++) {
      const vl = lipOf(k);
      const vf = vl + Math.min(pitchLen(k), PITCH_SHARE * (lipOf(k + 1) - vl));
      const vn = lipOf(k + 1);
      if (vl <= sig[0] || vn >= sig[n - 1]) continue;
      // (In order: the next unit's lip is this one's next.)
      const lip = sOf(vl);
      const foot = sOf(vf);
      const next = sOf(vn);
      if (allowed(lip) && allowed(foot) && allowed(next)) units.push({ k, lip, foot, next, size: unitSize(k) });
    }
  }
  if (units.length === 0) {
    const out = { ...a, sigma: Float64Array.from(sig), on: new Float64Array(n) } as LineArrays;
    const map = new Int32Array(n);
    for (let i = 0; i < n; i++) map[i] = i;
    return { a: out, map };
  }
  // --- A unit with no sample of the line in its pool (shorter than the samples' spacing there) takes one at its foot,
  // every per-sample array read there; the others are shaped on the line's own samples, wherever they fall.
  const want: number[] = [];
  {
    let q = 0;
    for (const u of units) {
      while (q < n && s[q] <= u.foot + POOL_GAP) q++;
      if (!(q < n && s[q] < u.next - POOL_GAP)) want.push(u.foot);
    }
  }
  const m = n + want.length;
  const ns = new Float64Array(m);
  const src = new Int32Array(m);
  const frac = new Float64Array(m);
  const map = new Int32Array(n);
  for (let i = 0, w = 0, j = 0; i < n; i++) {
    while (w < want.length && want[w] < s[i]) {
      ns[j] = want[w];
      src[j] = Math.max(0, i - 1);
      frac[j++] = i > 0 ? (want[w] - s[i - 1]) / Math.max(1e-9, s[i] - s[i - 1]) : 0;
      w++;
    }
    map[i] = j;
    ns[j] = s[i];
    src[j] = i;
    frac[j++] = 0;
  }
  const out: Record<string, Float64Array> = {};
  const along = (v: Float64Array): Float64Array => {
    if (m === n) return v;
    const o = new Float64Array(m);
    for (let j = 0; j < m; j++) {
      const i = src[j];
      const t = frac[j];
      o[j] = t === 0 ? v[i] : v[i] + (v[i + 1] - v[i]) * t;
    }
    return o;
  };
  for (const k of Object.keys(a)) out[k] = a[k].length === n ? along(a[k]) : a[k];
  out.s = ns;
  const sigma = along(sig);
  const on = new Float64Array(m);
  if (report) report.inserted += want.length;
  // --- Each unit's profile on the samples: its pitch from the lip (on the old level, read between the samples) down to
  // its foot, its pool from the foot nearly level to the next lip; every sample from the lip to the next lip takes the
  // profile there, never above the old level.
  const oldL = out.level;
  const nl = Float64Array.from(oldL);
  /** The old level at arc length sv (read in order along the line). */
  let seg0 = 0;
  const oldAt = (sv: number): number => {
    while (seg0 < m - 2 && ns[seg0 + 1] < sv) seg0++;
    while (seg0 > 0 && ns[seg0] > sv) seg0--;
    const t = Math.min(1, Math.max(0, (sv - ns[seg0]) / Math.max(1e-9, ns[seg0 + 1] - ns[seg0])));
    return oldL[seg0] + (oldL[seg0 + 1] - oldL[seg0]) * t;
  };
  let q = 0;
  for (const u of units) {
    const lipL = oldAt(u.lip);
    const nextL = oldAt(u.next);
    const footOld = oldAt(u.foot);
    const gr = (lipL - nextL) / Math.max(1, u.next - u.lip);
    const poolLen = u.next - u.foot;
    // (A small unit's pool runs on down at a good share of the gradient: a riffle more than a step.)
    let footL = nextL + ((POOL_SHARE + POOL_RIFFLE * (1 - u.size)) * gr + POOL_MIN) * poolLen;
    footL = Math.min(footOld, Math.max(footL, footOld - POOL_DEEP));
    while (q < m && ns[q] < u.lip) q++;
    let pool = false;
    for (let j = q; j < m && ns[j] <= u.next; j++) {
      const target = ns[j] <= u.foot ? lipL + ((footL - lipL) * (ns[j] - u.lip)) / Math.max(1e-6, u.foot - u.lip) : footL + ((nextL - footL) * (ns[j] - u.foot)) / Math.max(1e-6, poolLen);
      nl[j] = Math.min(nl[j], target);
      on[j] = 1;
      if (ns[j] >= u.foot - 1e-6 && ns[j] < u.next - 1e-6) pool = true;
    }
    if (report) {
      const rr = report as PitchReport;
      rr.found++;
      if (!pool) continue;
      rr.units++;
      rr.spacingM.push(u.next - u.lip);
      rr.spacingW.push((u.next - u.lip) / Math.max(0.1, 2 * out.halfWidth[Math.min(m - 1, q)]));
      rr.drop.push(lipL - footL);
      rr.gradient.push(gr);
      rr.deepen.push(footOld - footL);
    }
  }
  for (let j = 1; j < m; j++) nl[j] = Math.min(nl[j], nl[j - 1]);
  out.level = nl;
  out.sigma = sigma;
  out.on = on;
  return { a: out as LineArrays, map };
}
