// One channel-form law for a seeded world's channels (organic-map DESIGN.md, sections 2-4), prototype.
//
// Every shape of a channel is set by its reach state - catchment A (km²), water gradient S (m/m) and the room its floor
// gives it - in its own width, with constants fitted to twelve Canterbury reaches (LINZ lidar and aerials), and one
// seeded stationary field `h` for the heterogeneity real reaches have. No zone, kind or site constant.
//   - formOf: the widths, the wet share, the swings and wavelengths, the bank, the steps.
//   - beltOffsets: where the belt runs across its floor - it wanders the whole floor, now in the middle, now against
//     one wall for a stretch (the owner's Rakaia and Orari): the floor is shaped by where the water has been
//     (riverNetwork.ts floorAt), so the water lies on its floor's lowest line wherever the belt goes.
//   - layThread: the channel about its belt, a bounded sine-generated curve (Langbein & Leopold, with Kinoshita skew),
//     high-passed (bounded with no steer), scaled into the room bend by bend, its swing lowered to fit the room and its
//     curvature capped (no bend tighter than 1.2 active widths).
//   - formSection: the cross-section about the thread: its wet bed, the bars to the bed's edge, the bank.
//   - braidAt: a braided bed's threads beside its main one (K - 1 of them: the owner, 2026-11-20, 'yes to enabling
//     braids again'), drawn by the ribbon (water.ts FLOW_BARS, braidGlsl) and cut under the water in the ground
//     (heightfield.ts carveNetwork, braidTwin: read as the ribbon's triangles read them).
// The bed's width follows the law's pattern share (a braided bed fills most of its floor, its threads wandering within
// it). Pure and three.js-free; read only on a seeded world's path (riverNetwork.ts, heightfield.ts carveNetwork).

import { gnoise, hash2i } from './noise';
import { valueNoise } from './bedrock';
import { seedSaltX, seedSaltY } from '../worldSeed';

/** From BAR_NEAR m away a seeded world's ribbon draws its bed's gravel bars, all of them from BAR_FAR, and the terrain's
 * paint of them fades out over the same distances (water.ts FLOW_BARS, terrainMaterial.ts): beyond, the terrain's
 * triangles are coarser than the bars. */
export const BAR_NEAR = 250;
export const BAR_FAR = 550;

export const smooth = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Bessel J0 (power series; ample for |x| < 3). */
export function besselJ0(x: number): number {
  const q = -(x * x) / 4;
  let term = 1;
  let sum = 1;
  for (let k = 1; k < 14; k++) {
    term *= q / (k * k);
    sum += term;
  }
  return sum;
}

/** Struve H0 (power series; ample for |x| < 3). */
export function struveH0(x: number): number {
  const q = -(x * x) / 4;
  let term = (2 * x) / Math.PI;
  let sum = term;
  for (let k = 0; k < 14; k++) {
    term *= q / ((k + 1.5) * (k + 1.5));
    sum += term;
  }
  return sum;
}

/** Peak-to-axis amplitude of a sine-generated curve of valley wavelength lam and swing om (rad), m. */
export const sineAmplitude = (lam: number, om: number): number => (lam * struveH0(om)) / (4 * Math.max(0.05, besselJ0(om)));

/** The largest swing <= om whose amplitude fits in `room` (m), to a 65536th of om. */
export function fitSwing(lam: number, om: number, room: number): number {
  if (!(room > 0)) return 0;
  if (sineAmplitude(lam, om) <= room) return om;
  let lo = 0;
  let hi = om;
  for (let k = 0; k < 16; k++) {
    const mid = 0.5 * (lo + hi);
    if (sineAmplitude(lam, mid) <= room) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** Standard deviation of the three-octave sum in hField (measured over 10^6 points, tests/terrain/channelForm). */
const H_STD = 0.3506;
/** Standard deviation of one octave of gnoise (hSmooth). */
const G_STD = 0.306;

/** A smooth twin of hField (one octave, unit spread): for the jitter of the bends, which must not wrinkle within one. */
export function hSmooth(x: number, y: number, salt: number): number {
  const o = salt * 37.31;
  return gnoise(x + o, y - 0.71 * o) / G_STD;
}

/**
 * hSmooth read at world metres (x, y) with a correlation length `scale` (m) that may change from point to point (a line's
 * catchment's width along it): blended between the two fixed octaves 2^k <= scale < 2^(k + 1) by its log, each octave a
 * field of its own, kept to unit spread. Smooth along a line however its scale changes - x / scale was not: where a
 * river's catchment grew 4 % a sample its widths and bed edges jumped from sample to sample (saw-tooth, stair-cornered
 * edges), the argument moving a cell or more between samples 25 m apart.
 */
export function hAt(x: number, y: number, scale: number, salt: number): number {
  const L = Math.log2(Math.max(1e-3, scale));
  const k = Math.floor(L);
  const f = L - k;
  const t = f * f * (3 - 2 * f);
  const s0 = Math.pow(2, k);
  const a = hSmooth(x / s0, y / s0, salt + 0.37 * k);
  const b = hSmooth(x / (2 * s0), y / (2 * s0), salt + 0.37 * (k + 1));
  return ((1 - t) * a + t * b) / Math.sqrt((1 - t) * (1 - t) + t * t);
}

/**
 * The heterogeneity field: a seeded, stationary fBm of unit variance and zero mean, its correlation length one unit.
 * Callers pass world coordinates divided by the scale that matters (twice the local width for a bank, a wavelength
 * for a bend) and a salt that separates the uses.
 */
export function hField(x: number, y: number, salt: number): number {
  const o = salt * 37.31;
  const v = gnoise(x + o, y - 0.71 * o) + 0.5 * gnoise(2.03 * x - 17.1 + o, 2.03 * y + 9.4) + 0.25 * gnoise(4.11 * x + 31.7, 4.11 * y - 5.3 - o);
  return v / H_STD;
}

/** The law's numbers for one reach state. */
export interface Form {
  /** Single-thread bank-full width W_s, the gravel belt B, the active (bed) width W_a without h, m. */
  Ws: number;
  B: number;
  Wa: number;
  /** Pattern ratio, step share, and the bed's pattern share (as fitted: 0 a single-thread bed W_s wide, 1 a gravel bed
   * as wide as the belt B). */
  pi: number;
  sigma: number;
  betaLaw: number;
  /** Its threads (1: one; a braided bed's more, braidAt). */
  K: number;
  /** Wet share of the bed (one water thread, a single thread's water: W_s's wet share of W_s, over W_a). */
  phi: number;
  /** Swings (rad) and valley wavelengths (m) of the thread and of the belt's bends (about its line across the floor,
   * beltOffsets). */
  om2: number;
  lam2: number;
  om1: number;
  lam1: number;
  /** Bank height over the water, m, and the bank's slope (tan of its angle). */
  bankH: number;
  bankTan: number;
  /** Step spacing and height, m (H under 0.3 m is a riffle). */
  stepL: number;
  stepH: number;
}

/**
 * The law (DESIGN.md section 2) at catchment A (km²), water gradient S (m/m) and floor width F (m: the room on both
 * sides of the course). W_a here leaves out the heterogeneity term exp(0.45 h), which the caller applies where the
 * channel is. The bed widens from W_s toward the belt B by the fitted pattern share (braided: steep for its catchment,
 * not step-pool, with room - the owner's Rakaia), never past the floor (but a single thread's own bed, which cuts its
 * walls in a V); its main thread's water is a single thread's at its catchment, whatever the bed's width, and a braided
 * bed has K threads in all.
 */
export function formOf(A: number, S: number, F: number): Form {
  const a = Math.max(0.05, A);
  const s = Math.max(0, S);
  const Ws = 4.47 * Math.pow(a, 0.39);
  const pi = s / (0.083 * Math.pow(a, -0.44));
  const sigma = 0.9 * smooth(0.01, 0.15, s);
  const B = 0.6 * 121 * Math.pow(a, 0.345);
  const rho = F / B;
  // (The braid share from the reach's own state alone: braided over the pattern threshold (pi), unless steep enough to go
  // step-pool (sigma) or hemmed in (rho: a gorge's floor is narrower than half the belt). It sorts all twelve NZ reaches:
  // the upper Waimakariri (287 km²), the upper Rakaia and the Rakaia and Rangitata plains 0.8-1; the gorges, the Selwyn,
  // the Banks Peninsula streams and the torrents 0-0.01. A size gate (BED_BIG, 100-1000 km²) put the upper Waimakariri
  // at 0.09.)
  const betaLaw = smooth(1, 1.5, pi) * (1 - sigma) * smooth(0.5, 1.5, rho);
  const Wa = Math.min(Math.pow(Ws, 1 - betaLaw) * Math.pow(B, betaLaw), Math.max(Ws, F));
  // (Its threads: one dominant main trunk stream, plus graded secondary and minor longitudinal streams and low-angle
  // cross-bar chutes splitting and rejoining across the shingle bed in braidAt.)
  const K = 1 + betaLaw * 1.95 * Math.pow(a, 0.26);
  // (One water thread: a single thread's wet share of its own width W_s.)
  const w = (0.8 - 0.4 * smooth(0.7, 1.2, pi)) * Ws;
  const phi = Math.min(1, w / Wa);
  // (Below the braid threshold's onset a single thread keeps at least the swing that meets DESIGN.md section 7's
  // sinuosity, 1.25 at 1 km, up to pi 0.7, easing to a gravel thread's by pi 1.2: the fit alone stepped it down by
  // 0.7, the Selwyn's pi, and straightened every big lowland river of 0.6-0.8 - p7-8's, om-plains' - against section 7
  // and the owner's kept meanders.)
  const lowland = 0.95 * (1 - smooth(0.7, 1.2, pi));
  // Confined / semi-confined single-thread valley rivers (pi >= 0.7, betaLaw ~ 0, Wa ~ Ws): without this floor, om2
  // dropped to 0.35 rad (sinuosity 1.027 — dead straight down the valley floor). Scaled by Ws / Wa so wide braided or
  // transitional beds never bend tighter than Wa, and eased on steep step-pool torrents (sigma).
  const valleySingle = 0.72 * (Ws / Math.max(Ws, Wa)) * (1 - 0.75 * sigma);
  const om2 = Math.max(0.35 + 1.4 * (1 - smooth(0.05, 0.7, pi)), lowland, valleySingle);
  const lam2 = 13 * w;
  const om1 = 0.4 + 0.22 * smooth(0.65, 1.05, pi) * (1 - betaLaw) * (1 - 0.75 * sigma);
  const lam1 = 378 * Math.pow(a, 0.204);
  const bankH = 0.35 * Math.pow(a, 0.17) * (1 - 0.4 * betaLaw);
  const bankTan = Math.tan(((14 + 36 * smooth(0.005, 0.08, s)) * Math.PI) / 180);
  const stepL = Ws * (1.75 + 7.75 * (1 - smooth(0.05, 0.12, s)));
  const stepH = sigma * s * stepL;
  return { Ws, B, Wa, pi, sigma, betaLaw, K, phi, om2, lam2, om1, lam1, bankH, bankTan, stepL, stepH };
}

/** The thread's depth at its middle, m: shallow at a crossing, deep in a pool at a bend's apex (kap 0..1). */
export const threadDepth = (w: number, kap: number): number => (0.15 + w / 20) * (0.7 + 0.6 * kap);

/** White water on a step: none while the step is lower than the water is deep. */
export const stepWhite = (stepH: number, depth: number): number => (stepH < 0.3 ? 0 : smooth(1, 2, stepH / Math.max(0.05, depth)));

/** A polyline with a smooth frame: cubic Hermite through its points with averaged tangents (a C1 curve). */
class Frame {
  readonly s: Float64Array;
  readonly n: Float64Array;
  readonly e: Float64Array;
  private readonly tn: Float64Array;
  private readonly te: Float64Array;
  constructor(n: ArrayLike<number>, e: ArrayLike<number>) {
    const m = n.length;
    this.n = Float64Array.from(n);
    this.e = Float64Array.from(e);
    this.s = new Float64Array(m);
    for (let i = 1; i < m; i++) this.s[i] = this.s[i - 1] + Math.hypot(this.n[i] - this.n[i - 1], this.e[i] - this.e[i - 1]);
    this.tn = new Float64Array(m);
    this.te = new Float64Array(m);
    for (let i = 0; i < m; i++) {
      let sn = 0;
      let se = 0;
      for (const [a, b] of [[i - 1, i], [i, i + 1]]) {
        if (a < 0 || b >= m) continue;
        const dn = this.n[b] - this.n[a];
        const de = this.e[b] - this.e[a];
        const l = Math.hypot(dn, de);
        if (l > 1e-9) {
          sn += dn / l;
          se += de / l;
        }
      }
      const l = Math.hypot(sn, se) || 1;
      this.tn[i] = sn / l;
      this.te[i] = se / l;
    }
  }
  get total(): number {
    return this.s[this.s.length - 1];
  }
  private seg(sv: number): number {
    const s = this.s;
    let lo = 0;
    let hi = s.length - 1;
    if (sv <= s[0]) return 0;
    if (sv >= s[hi]) return Math.max(0, hi - 1);
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (s[mid] <= sv) lo = mid;
      else hi = mid;
    }
    return lo;
  }
  /** The point at arc sv and the unit tangent there, into o = [north, east, tn, te]. */
  at(sv: number, o: number[]): void {
    const m = this.s.length;
    if (m < 2) {
      o[0] = this.n[0];
      o[1] = this.e[0];
      o[2] = 1;
      o[3] = 0;
      return;
    }
    const i = this.seg(sv);
    const L = Math.max(1e-9, this.s[i + 1] - this.s[i]);
    const t = Math.min(1, Math.max(0, (sv - this.s[i]) / L));
    const t2 = t * t;
    const t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = t3 - 2 * t2 + t;
    const h01 = -2 * t3 + 3 * t2;
    const h11 = t3 - t2;
    o[0] = h00 * this.n[i] + h10 * L * this.tn[i] + h01 * this.n[i + 1] + h11 * L * this.tn[i + 1];
    o[1] = h00 * this.e[i] + h10 * L * this.te[i] + h01 * this.e[i + 1] + h11 * L * this.te[i + 1];
    const d00 = 6 * t2 - 6 * t;
    const d10 = 3 * t2 - 4 * t + 1;
    const d01 = -6 * t2 + 6 * t;
    const d11 = 3 * t2 - 2 * t;
    let dn = d00 * this.n[i] + d10 * L * this.tn[i] + d01 * this.n[i + 1] + d11 * L * this.tn[i + 1];
    let de = d00 * this.e[i] + d10 * L * this.te[i] + d01 * this.e[i + 1] + d11 * L * this.te[i + 1];
    const l = Math.hypot(dn, de) || 1;
    dn /= l;
    de /= l;
    o[2] = dn;
    o[3] = de;
  }
}

/** Linear interpolation of arr (on ascending positions s) at sv. */
/** The segment each of the last few arc arrays was read in (the march reads them in order: most reads fall in the same
 * segment or the next, found without a search; the segment found is the search's own). */
const segHint: Array<{ s: ArrayLike<number> | null; lo: number }> = [{ s: null, lo: 0 }, { s: null, lo: 0 }, { s: null, lo: 0 }, { s: null, lo: 0 }];
let segNext = 0;
function lerpAt(s: ArrayLike<number>, arr: ArrayLike<number>, sv: number): number {
  const m = s.length;
  if (m === 1 || sv <= s[0]) return arr[0];
  if (sv >= s[m - 1]) return arr[m - 1];
  let lo = -1;
  let h = segHint[0].s === s ? segHint[0] : segHint[1].s === s ? segHint[1] : segHint[2].s === s ? segHint[2] : segHint[3].s === s ? segHint[3] : null;
  if (h) {
    const k = h.lo;
    if (k < m - 1 && s[k] <= sv && sv < s[k + 1]) lo = k;
    else if (k + 1 < m - 1 && s[k + 1] <= sv && sv < s[k + 2]) lo = k + 1;
  } else {
    h = segHint[segNext];
    segNext = (segNext + 1) & 3;
    h.s = s;
  }
  if (lo < 0) {
    lo = 0;
    let hi = m - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (s[mid] <= sv) lo = mid;
      else hi = mid;
    }
  }
  h.lo = lo;
  const hi = lo + 1;
  const t = (sv - s[lo]) / Math.max(1e-9, s[hi] - s[lo]);
  return arr[lo] + (arr[hi] - arr[lo]) * t;
}

/** Each bend's length is the law's times exp(JITTER n), n a seeded draw of unit spread (DESIGN.md's phase jitter: at
 * 0.45 the drawn bends came out in trains of near-equal hairpins, their lengths' CV under the NZ reaches' 0.24-0.48 once
 * the curvature cap had evened out the short ones). */
const JITTER = 0.6;
/** Each bend's swing is the law's times 1 + SWING_JITTER tanh(n). */
const SWING_JITTER = 0.45;
/** ... but never past this (rad): a sine-generated curve's loops close on each other from about 2.2. */
const SWING_TOP = 1.9;
/** No bend tighter than this many active widths. */
const BEND_MIN = 1.2;
/** A half-bend that would reach past its room is scaled down whole to reach this share of it (marchLevel). */
const ROOM_FILL = 0.95;

/** One level's march along its parent: valley distance, offset (right of the parent: +), heading rate. */
interface Level {
  along: number[];
  off: number[];
  /** |dθ/ds| at each sample (1/m): the level's own curvature. */
  curv: number[];
  /** Signed curvature over the local peak, + turning right (its inside on the right). */
  kap: number[];
}

/**
 * March one level of the sine-generated curve along a parent of length total (distance along the parent), its
 * wavelength, swing, curvature cap and room each side read at that distance. High-passed over three wavelengths and
 * scaled into the room half-bend by half-bend.
 */
function marchLevel(total: number, lam: (sv: number) => number, om: (sv: number) => number, cap: (sv: number) => number, roomL: (sv: number) => number, roomR: (sv: number) => number, dsOf: (sv: number) => number, salt: number): Level {
  const along: number[] = [0];
  const off: number[] = [0];
  const curv: number[] = [0];
  const kap: number[] = [0];
  let a = 0;
  let o = 0;
  // The phase starts at a seeded place. Each bend has its own length and swing (DESIGN.md's jitter, as a seeded draw
  // per bend): the length (the phase rate) changes only at an inflection, where the curve has no curvature, and the
  // swing only at an apex, where the heading is along the parent - so neither change folds the curve. A swing is capped
  // for the quicker of the two bend lengths it spans, so no bend is tighter than the cap.
  let ph = (((salt * 2654435761) >>> 0) / 4294967296) * 2 * Math.PI;
  const draw = (k: number, which: number): number => {
    // About normal, unit spread (three uniform draws), clipped to +-1.6.
    let q = 0;
    for (let j = 0; j < 3; j++) q += (hash2i(salt * 7919 + which * 104729 + j, k) & 0xffff) / 65536;
    return Math.max(-1.6, Math.min(1.6, (q - 1.5) * 2));
  };
  // (Each bend's draws once: the march reads them step after step.)
  const rateMemo = new Map<number, number>();
  const swingMemo = new Map<number, number>();
  const rateMul = (j: number): number => {
    let v = rateMemo.get(j);
    if (v === undefined) rateMemo.set(j, (v = Math.exp(JITTER * draw(j, 1))));
    return v;
  };
  const swingMul = (k: number): number => {
    let v = swingMemo.get(k);
    if (v === undefined) swingMemo.set(k, (v = 1 + SWING_JITTER * Math.tanh(draw(k, 2))));
    return v;
  };
  let thPrev = 0;
  const guard = Math.ceil(total / 2) + 100;
  for (let g = 0; a < total && g < guard; g++) {
    const sv = Math.min(total, Math.max(0, a));
    const L = Math.max(10, lam(sv));
    const w0 = om(sv);
    const ds = dsOf(sv);
    const base = (2 * Math.PI * besselJ0(w0)) / L;
    // Rate half-cycle j covers phases (j - 1/2) pi .. (j + 1/2) pi; swing half-cycle k covers k pi .. (k + 1) pi.
    const j = Math.floor(ph / Math.PI + 0.5);
    const k = Math.floor(ph / Math.PI);
    const rate = base * rateMul(j);
    let w = Math.min(SWING_TOP, w0 * swingMul(k));
    // The curvature cap on the swing (not on the step): |dθ/ds| <= w rate (1 + 3 w² / 32) <= cap.
    const c = cap(sv);
    const rMax = base * Math.max(rateMul(k), rateMul(k + 1));
    for (let q = 0; q < 3; q++) if (w * rMax * (1 + (3 * w * w) / 32) > c) w = c / (rMax * (1 + (3 * w * w) / 32));
    ph += rate * ds;
    // (A safeguard: the heading follows the curve no faster than the cap allows.)
    const target = w * Math.sin(ph) + ((w * w * w) / 32) * Math.cos(3 * ph);
    const th = thPrev + Math.max(-c * ds, Math.min(c * ds, target - thPrev));
    thPrev = th;
    a += Math.cos(th) * ds;
    o += Math.sin(th) * ds;
    const dth = w * Math.cos(ph) - ((3 * w * w * w) / 32) * Math.sin(3 * ph);
    along.push(a);
    off.push(o);
    curv.push(Math.abs(dth) * rate);
    kap.push(dth / Math.max(1e-9, w + (3 * w * w * w) / 32));
  }
  // High-pass: the offset's running mean over three wavelengths is taken off (bounded, no steering); the ends padded.
  const m = off.length;
  const pre = new Float64Array(m + 1);
  for (let i = 0; i < m; i++) pre[i + 1] = pre[i] + off[i];
  const hp = new Float64Array(m);
  for (let i = 0; i < m; i++) {
    const sv = Math.min(total, Math.max(0, along[i]));
    const half = Math.max(1, Math.round((1.5 * Math.max(10, lam(sv))) / Math.max(1, dsOf(sv))));
    const lo = i - half;
    const hi = i + half;
    const l0 = Math.max(0, lo);
    const h0 = Math.min(m - 1, hi);
    let sum = pre[h0 + 1] - pre[l0];
    if (lo < 0) sum += -lo * off[0];
    if (hi > m - 1) sum += (hi - (m - 1)) * off[m - 1];
    hp[i] = off[i] - sum / (2 * half + 1);
  }
  // Into the room: each half-bend (between two crossings of the line) is scaled down whole as far as its tightest
  // sample needs (ROOM_FILL of the room there) - a clip of its peak alone (a soft clamp) flattened it against the wall
  // and bent it sharply where the flat met the curve.
  const room = new Float64Array(m);
  for (let i = 0; i < m; i++) {
    const sv = Math.min(total, Math.max(0, along[i]));
    room[i] = hp[i] >= 0 ? Math.max(0, roomR(sv)) : Math.max(0, roomL(sv));
    along[i] = sv;
  }
  for (let a = 0; a < m; ) {
    let b = a + 1;
    while (b < m && (hp[b] >= 0) === (hp[a] >= 0)) b++;
    let f = 1;
    for (let i = a; i < b; i++) {
      const v = Math.abs(hp[i]);
      if (v > 1e-9) f = Math.min(f, (ROOM_FILL * room[i]) / v);
    }
    for (let i = a; i < b; i++) off[i] = Math.max(-room[i], Math.min(room[i], hp[i] * f));
    a = b;
  }
  return { along, off, curv, kap };
}

/** The channel's law along its valley axis, per axis sample. */
export interface ThreadLaw {
  /** The belt's line across its floor: its offset from the axis (right of the flow: +), m (beltOffsets). */
  belt: ArrayLike<number>;
  /** Valley wavelengths (m) and swings (rad) of the belt's bends about that line and of the thread about the belt,
   * already fitted to the room. */
  lam1: ArrayLike<number>;
  om1: ArrayLike<number>;
  lam2: ArrayLike<number>;
  om2: ArrayLike<number>;
  /** Active width (m, for the curvature cap) and the thread's centreline room left and right of the axis, m. */
  Wa: ArrayLike<number>;
  roomL: ArrayLike<number>;
  roomR: ArrayLike<number>;
  /** A braided bed's main thread (braidAt), added to the thread once laid: the bed's line off the belt's (shift, m),
   * and how far it wanders about the bed's line (wander, m) at the braid's phase (phase, braidWander). Absent: none. */
  braid?: { shift: ArrayLike<number>; wander: ArrayLike<number>; phase: ArrayLike<number> };
}

/**
 * Where a belt runs across its floor, per axis sample (arc lengths s): its offset from the axis (right: +), between `lo`
 * and `hi` (the offsets that keep the thread's swing and the bed on the floor), at tanh(BELT_WANDER n) of the way from
 * the middle to either end, n a seeded smooth field of unit spread read at the distance along the axis in units of
 * `wave` (m, how far the belt runs between crossings of its floor): it wanders the whole floor, within a third of the
 * middle about a third of the way and past nine tenths of the way to a wall about a tenth. Smoothed along over a
 * quarter wave.
 */
export function beltOffsets(s: ArrayLike<number>, lo: ArrayLike<number>, hi: ArrayLike<number>, wave: ArrayLike<number>, salt: number): Float64Array {
  const m = s.length;
  const out = new Float64Array(m);
  let ph = 0;
  for (let i = 0; i < m; i++) {
    if (i > 0) ph += (s[i] - s[i - 1]) / Math.max(1, 0.5 * (wave[i] + wave[i - 1]));
    const c = 0.5 * (lo[i] + hi[i]);
    const half = Math.max(0, 0.5 * (hi[i] - lo[i]));
    out[i] = c + half * Math.tanh(BELT_WANDER * hSmooth(ph, 0.5, salt));
  }
  // (Smoothed along: a floor that narrows or widens from one station to the next moves the belt gently.)
  const sm = new Float64Array(m);
  let lo0 = 0;
  let hi0 = 0;
  let sum = 0;
  for (let i = 0; i < m; i++) {
    const r = 0.125 * wave[i];
    while (hi0 < m && s[hi0] <= s[i] + r) sum += out[hi0++];
    while (lo0 < hi0 && s[lo0] < s[i] - r) sum -= out[lo0++];
    sm[i] = sum / Math.max(1, hi0 - lo0);
  }
  for (let i = 0; i < m; i++) sm[i] = Math.max(Math.min(lo[i], hi[i]), Math.min(Math.max(lo[i], hi[i]), sm[i]));
  return sm;
}
/** beltOffsets: the belt's share of the way from its floor's middle to a wall is tanh(BELT_WANDER n), n of unit spread:
 * past 0.9 of the way about a tenth of its length, within a third of the middle about a third. */
const BELT_WANDER = 0.9;

/**
 * Lay the channel (its main thread) about a valley axis: the belt's line across the floor (law.belt), the belt's bends
 * about it, the thread about the belt. Returns the thread's points, their distance along the valley axis and their
 * offset from it (right: +).
 */
export function layThread(axisN: ArrayLike<number>, axisE: ArrayLike<number>, law: ThreadLaw, salt: number): { north: number[]; east: number[]; valleyS: number[]; off: number[] } {
  const ax = new Frame(axisN, axisE);
  const total = ax.total;
  const S = ax.s;
  const at = (arr: ArrayLike<number>) => (sv: number): number => lerpAt(S, arr, sv);
  const lam2 = at(law.lam2);
  const om2 = at(law.om2);
  const Wa = at(law.Wa);
  const rL = at(law.roomL);
  const rR = at(law.roomR);
  const yB = at(law.belt);
  // (A braided bed's main thread wanders its bed as its other threads do: off the laid thread by yT - added once the
  // thread is laid, so its bends and their phase down the line are a single thread's.)
  const br = law.braid;
  const shift = br ? at(br.shift) : null;
  const wander = br ? at(br.wander) : null;
  const wPhase = br ? at(br.phase) : null;
  const yT = (sv: number): number => (shift && wander && wPhase ? shift(sv) + wander(sv) * braidWander(wPhase(sv)) : 0);
  // The axis's own curvature (the valley's bends), smoothed: the levels' curvature budget is what it leaves.
  const m = S.length;
  const kAx = new Float64Array(m);
  for (let i = 1; i < m - 1; i++) {
    const an = Math.atan2(axisE[i] - axisE[i - 1], axisN[i] - axisN[i - 1]);
    const bn = Math.atan2(axisE[i + 1] - axisE[i], axisN[i + 1] - axisN[i]);
    let d = bn - an;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    kAx[i] = Math.abs(d) / Math.max(1, 0.5 * (S[i + 1] - S[i - 1]));
  }
  const kAxS = Float64Array.from(kAx);
  for (let i = 0; i < m; i++) {
    let sum = 0;
    let c = 0;
    for (let j = Math.max(0, i - 2); j <= Math.min(m - 1, i + 2); j++) {
      sum += kAx[j];
      c++;
    }
    kAxS[i] = sum / c;
  }
  const kAxis = at(kAxS);
  const capAll = (sv: number): number => 1 / (BEND_MIN * Math.max(1, Wa(sv)));
  // The belt's bends about its line across the floor (yB): a quarter of the curvature budget at most (its bends are
  // long; the thread's swing takes the rest), in the room the line leaves either side.
  const lam1 = at(law.lam1);
  const om1 = at(law.om1);
  const bend = marchLevel(total, lam1, om1, (sv) => Math.max(1e-5, 0.25 * capAll(sv) - kAxis(sv)), (sv) => rL(sv) + yB(sv), (sv) => rR(sv) - yB(sv), (sv) => Math.min(60, Math.max(10, lam1(sv) / 40)), salt * 3 + 11);
  // The belt's points in the plane.
  const o = [0, 0, 0, 0];
  const bn: number[] = [];
  const be: number[] = [];
  const bAlong: number[] = [];
  const bOff: number[] = [];
  for (let k = 0; k < bend.along.length; k++) {
    const sv = bend.along[k];
    ax.at(sv, o);
    const y = yB(sv) + bend.off[k];
    // Right of the flow: (-te, tn) in (north, east).
    bn.push(o[0] - o[3] * y);
    be.push(o[1] + o[2] * y);
    bAlong.push(sv);
    bOff.push(y);
  }
  const B = new Frame(bn, be);
  const bS = B.s;
  // (The belt's own curvature, smoothed as the axis's: the thread's budget is what the belt's and the axis's leave.)
  const nB = bS.length;
  const bK = new Float64Array(nB);
  for (let i = 1; i < nB - 1; i++) {
    const a0 = Math.atan2(be[i] - be[i - 1], bn[i] - bn[i - 1]);
    const a1 = Math.atan2(be[i + 1] - be[i], bn[i + 1] - bn[i]);
    let d = a1 - a0;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    bK[i] = Math.abs(d) / Math.max(1, 0.5 * (bS[i + 1] - bS[i - 1]));
  }
  const bCurv = Float64Array.from(bK);
  for (let i = 0; i < nB; i++) {
    let sum = 0;
    let c = 0;
    for (let j = Math.max(0, i - 2); j <= Math.min(nB - 1, i + 2); j++) (sum += bK[j]), c++;
    bCurv[i] = sum / c;
  }
  // The thread along the belt: its parameters where the belt is in the valley; its room each side what the belt's
  // offset leaves; its curvature what the belt's and the axis's leave of the budget.
  const vAt = (bs: number): number => lerpAt(bS, bAlong, bs);
  const yAt = (bs: number): number => lerpAt(bS, bOff, bs);
  const thread = marchLevel(
    B.total,
    (bs) => lam2(vAt(bs)),
    (bs) => om2(vAt(bs)),
    (bs) => {
      const sv = vAt(bs);
      return Math.max(0.3 * capAll(sv), capAll(sv) - lerpAt(bS, bCurv, bs) - kAxis(sv));
    },
    (bs) => rL(vAt(bs)) + yAt(bs),
    (bs) => rR(vAt(bs)) - yAt(bs),
    (bs) => Math.min(40, Math.max(8, lam2(vAt(bs)) / 12)),
    salt * 3 + 12,
  );
  const north: number[] = [];
  const east: number[] = [];
  const valleyS: number[] = [];
  const off: number[] = [];
  for (let i = 0; i < thread.along.length; i++) {
    const bs = thread.along[i];
    B.at(bs, o);
    const v = vAt(bs);
    const y = thread.off[i] + yT(v);
    north.push(o[0] - o[3] * y);
    east.push(o[1] + o[2] * y);
    valleyS.push(Math.min(total, Math.max(0, v)));
    off.push(yAt(bs) + y);
  }
  // Its ends on the axis's ends' cross-lines (the march stops within a step of them).
  return { north, east, valleyS, off };
}

// --- Braids (organic-map DESIGN.md section 3; the NZ braided reaches b1, b2, c1, c2 of NZREF-REPORT.md). A braided bed
// (formOf: K threads) has, beside its main thread (the line, drawn and carved as every line's), K - 1 more: each wanders
// across the bed over about BRAID_WAVE bed widths, its middle anywhere on it alike (no thread lingers at an edge), so
// the threads cross and part as they go - a split and a join every few hundred metres; each also strays a little from
// its own course every BRAID_LENS bed widths (the lens-shaped bars between two threads) and bends on its own (BRAID_WIG).
// Their widths are a share of the main thread's falling with their rank, each varied along it. Where the bed's share
// of its threads falls (K toward 1: the braid's ends) a thread draws in to the main one and joins it; where its bed
// narrows (a junction's blend) the threads draw in with it. One water level across the bed: the threads are the line's
// own water. Read in the bed's frame: u across it (-1 its right edge... +1 its left: (x - xc) / hb), the braid's phase
// `ph` along it (per line sample: the integral of ds / (BRAID_WAVE bed widths), from a seeded start) and the bends'
// phase `ps` (ds / max(BRAID_WIG_MIN, BRAID_WIG main widths)). The ribbon draws them (water.ts FLOW_BARS: braidGlsl, the
// GLSL twin) and the ground under them is cut under the water (heightfield.ts carveNetwork: braidAt), so what is drawn
// wet is wet where the sim asks (landing, ditching).

/** A braided bed's threads wander across it over about this many bed widths (the noise's cell). */
export const BRAID_WAVE = 1.55;
/** ... strays gently from its course every BRAID_LENS bed widths or so, by up to about BRAID_LENS_AMP bed widths ... */
const BRAID_LENS = 0.58;
const BRAID_LENS_AMP = 0.042;
/** ... and bends on its own about every BRAID_WIG of the main thread's widths (at least BRAID_WIG_MIN m), by up to
 * BRAID_WIG_AMP of its own width. */
export const BRAID_WIG = 24;
export const BRAID_WIG_MIN = 150;
const BRAID_WIG_AMP = 0.55;
/** A thread nearer another before it (the main thread first, then each in turn) than BRAID_JOIN[1] of their mean width
 * (between their middles) curves tangentially into it: the two merge cleanly into one channel and peel apart at an
 * acute V-angle without kinks or parallel double-tracking. */
const BRAID_JOIN = [0.0, 1.95];
/** Secondary & minor longitudinal thread k's width steps down steeply from the main trunk: BRAID_W (k + 1)^-0.62,
 * giving 2-3 medium secondary branches and up to ~10 narrow minor streams (2-5 m wide) across wide Rakaia-scale beds. */
const BRAID_W = 0.56;
const BRAID_W_EXP = -0.62;
const BRAID_W_SPREAD = 0.38;
/** Longitudinal threads beside the main trunk, at most (connected by gentle low-angle cross-bar chutes). */
export const BRAID_MAX = 13;
/** A longitudinal thread's middle keeps within this share of the way from its bed's middle to its edge. */
export const BRAID_SPAN = 0.93;

const bHash = (i: number, key: number): number => (hash2i(i, key) & 0xffff) / 65536;
/** A smooth (Catmull-Rom) value noise of unit cells, about -1..1 (its argument kept positive: braid phases start at 64). */
export function bNoise(t: number, key: number): number {
  const i = Math.floor(t);
  const f = t - i;
  const p0 = 2 * bHash(i - 1, key) - 1;
  const p1 = 2 * bHash(i, key) - 1;
  const p2 = 2 * bHash(i + 1, key) - 1;
  const p3 = 2 * bHash(i + 2, key) - 1;
  return 0.5 * (2 * p1 + (p2 - p0) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f * f + (3 * p1 - p0 - 3 * p2 + p3) * f * f * f);
}
/** bNoise spread evenly over -1..1: an odd quintic fitted to its distribution (10^6 points; flat within 1 %). */
function bSpread(n: number): number {
  const n2 = n * n;
  return Math.max(-1, Math.min(1, n * (1.2194 - n2 * (0.1539 + 0.078 * n2))));
}
/** The main thread's wander across its bed (-1..1, layThread's yT) at braid phase ph. */
export const braidWander = (ph: number): number => bSpread(bNoise(ph, 90));
/** A line's braid phases start here, a seeded draw on (64, 576) per line: the noise's argument stays positive. */
export const braidStart = (line: number, which: number): number => 64 + 512 * bHash(line, 70 + which);
/** braidAt's other output: the half-width of the thread it found, m. */
export const braidHit = { half: 0 };

/**
 * How far into the nearest of a braided bed's coherent streams beside its main trunk a point lies, m (> 0 inside it;
 * its half-width in braidHit.half): graded secondary and minor longitudinal streams (1..BRAID_MAX) wandering across the
 * full gravel bed at varied bar-scale wavelengths (merging tangentially via BRAID_JOIN), connected by gentle low-angle
 * C1-alternating cross-bar distributary chutes and almond-bar splits. No periodic outer scallop loops or steep S-hooks.
 */
const braidXs = new Float64Array(BRAID_MAX + 1);
const braidWs = new Float64Array(BRAID_MAX + 1);
const braidSortX = new Float64Array(BRAID_MAX + 1);
const braidSortW = new Float64Array(BRAID_MAX + 1);
export function braidAt(u: number, um: number, hb: number, K: number, ph: number, ps: number, w: number): number {
  let best = -Infinity;
  braidHit.half = 0;
  const x = u * hb;
  braidXs[0] = um * hb;
  braidWs[0] = w;
  let nMaj = 0;
  for (let k = 1; k <= BRAID_MAX; k++) {
    const p = Math.min(1, K - k);
    if (p <= 0) break;
    nMaj = k;
    const rate = 0.86 + 0.08 * (k % 5);
    const uk = BRAID_SPAN * bSpread(bNoise(ph * rate + 31.1 * k, 100 + k));
    const lens = BRAID_LENS_AMP * 2 * hb * bNoise(ph * (BRAID_WAVE / BRAID_LENS) * rate + 7.7 * k, 150 + k);
    const bankCusp = 0.18 * w * bNoise(ps * 4.1 + 5.9 * k, 350 + k);
    const wk = Math.max(1.6, w * BRAID_W * Math.pow(k + 1, BRAID_W_EXP)) * Math.exp(BRAID_W_SPREAD * bNoise(ph * 4.2 + 3.3 * k, 300 + k) + 0.18 * bNoise(ps * 3.7 + 2.1 * k, 320 + k)) * (0.35 + 0.65 * p);
    const wig = BRAID_WIG_AMP * wk * bNoise(ps * (1.5 + 0.4 * bHash(k, 401)) + 11.3 * k, 400 + k) + bankCusp;
    let xk = braidXs[0] + p * (uk * hb + lens + wig - braidXs[0]);
    for (let j = 0; j < k; j++) xk = braidXs[j] + (xk - braidXs[j]) * smooth(BRAID_JOIN[0], BRAID_JOIN[1], Math.abs(xk - braidXs[j]) / (0.5 * (wk + braidWs[j])));
    const lim = Math.max(0, hb - 0.5 * wk - 1.5);
    xk = Math.max(-lim, Math.min(lim, xk));
    braidXs[k] = xk;
    braidWs[k] = wk;
    const inside = 0.5 * wk - Math.abs(x - xk);
    if (inside > best) {
      best = inside;
      braidHit.half = 0.5 * wk;
    }
  }
  if (K > 1.25 && nMaj >= 1) {
    const bOn = smooth(1.25, 2.2, K);
    for (let i = 0; i <= nMaj; i++) {
      const xi = braidXs[i];
      const wi = braidWs[i];
      let j = i - 1;
      while (j >= 0 && braidSortX[j] > xi) {
        braidSortX[j + 1] = braidSortX[j];
        braidSortW[j + 1] = braidSortW[j];
        j--;
      }
      braidSortX[j + 1] = xi;
      braidSortW[j + 1] = wi;
    }
    const limC = Math.max(0, hb - 2);
    // Gentle low-angle C1-alternating cross-bar distributary chutes (ph * 0.92: ~650 m run across 25-60 m bar corridors,
    // keeping divergence angles to natural 4-10 deg braided-river splits with zero steep S-curves).
    for (let g = 0; g < nMaj; g++) {
      const xA0 = braidSortX[g];
      const xB0 = braidSortX[g + 1];
      const gap = xB0 - xA0;
      const clearGap = gap - 0.5 * (braidSortW[g] + braidSortW[g + 1]);
      if (!(clearGap > 3.5)) continue;
      const gapKeep = smooth(3.5, 14, clearGap) * bOn;
      const tc = ph * 0.92 + g * 3.71;
      const qc = Math.floor(tc);
      const tau = tc - qc;
      const even = ((qc + g) & 1) === 0;
      const xStart = even ? xA0 : xB0;
      const xEnd = even ? xB0 : xA0;
      const sTau = tau * tau * (3 - 2 * tau);
      const s1 = Math.sin(3.14159265 * tau);
      const arch = s1 * s1;
      const bow = arch * (0.12 * Math.min(gap, 70) * bNoise(tc * 2.1 + 5.3 * g, 720) + 0.24 * w * bNoise(ps * 2.6 + 9.1 * g, 740) + 0.12 * w * bNoise(ps * 5.3 + 3.1 * g, 750));
      const xc = Math.max(-limC, Math.min(limC, xStart + (xEnd - xStart) * sTau + bow));
      const cid = qc * 13 + g * 7;
      const wc = Math.max(1.6, w * (0.10 + 0.07 * bNoise(tc * 1.7 + g * 4.1, 760)) * Math.exp(0.30 * bNoise(ps * 3.9 + 2.3 * g, 780))) * gapKeep;
      if (wc > 0.4) {
        const inside = 0.5 * wc - Math.abs(x - xc);
        if (inside > best) {
          best = inside;
          braidHit.half = 0.5 * wc;
        }
        if (clearGap > 24 && tau > 0.14 && tau < 0.86) {
          const hc2 = bHash(cid + 11, 790);
          if (hc2 > 0.35) {
            const uSub = (tau - 0.14) * (1 / 0.72);
            const su = Math.sin(3.14159265 * uSub);
            const subArch = su * su;
            const wSub = 0.70 * wc * smooth(24, 45, clearGap);
            if (wSub > 0.4) {
              const offSub = (hc2 > 0.67 ? 1 : -1) * subArch * Math.min(0.26 * clearGap, (2.2 + 1.8 * hc2) * wc);
              const xSub = Math.max(-limC, Math.min(limC, xc + offSub));
              const inSub = 0.5 * wSub - Math.abs(x - xSub);
              if (inSub > best) {
                best = inSub;
                braidHit.half = 0.5 * wSub;
              }
            }
          }
        }
      }
    }
  }
  return best;
}
/**
 * A braided bed's rows (water.ts ribbonRows draws its ribbon on them): each sample's row lies across the line on the
 * direction from the line's point ROW_TURN bed half-widths behind it to the one as far ahead - a frame as smooth as the
 * bed is wide, whose rows never cross within it (on each sample's own normal, rows hundreds of metres long crossed where
 * the thread bent and drew its threads and edges in shards). Returns each row's unit direction (north, east).
 */
export function braidRows(north: ArrayLike<number>, east: ArrayLike<number>, s: ArrayLike<number>, hb: ArrayLike<number>): { tn: Float32Array; te: Float32Array } {
  const m = s.length;
  const tn = new Float32Array(m);
  const te = new Float32Array(m);
  let a = 0;
  let b = 0;
  const at = (k: number, sv: number, out: number[]): number => {
    while (k > 0 && s[k] > sv) k--;
    while (k < m - 2 && s[k + 1] < sv) k++;
    const t = Math.min(1, Math.max(0, (sv - s[k]) / Math.max(1e-9, s[k + 1] - s[k])));
    out[0] = north[k] + (north[k + 1] - north[k]) * t;
    out[1] = east[k] + (east[k + 1] - east[k]) * t;
    return k;
  };
  const p0 = [0, 0];
  const p1 = [0, 0];
  for (let i = 0; i < m; i++) {
    const d = Math.max(0.5 * ((s[Math.min(m - 1, i + 1)] - s[Math.max(0, i - 1)]) || 1), ROW_TURN * hb[i]);
    a = at(a, Math.max(0, s[i] - d), p0);
    b = at(b, Math.min(s[m - 1], s[i] + d), p1);
    const dn = p1[0] - p0[0];
    const de = p1[1] - p0[1];
    const l = Math.hypot(dn, de) || 1;
    tn[i] = dn / l;
    te[i] = de / l;
  }
  return { tn, te };
}
/** braidRows: a row's direction is read ROW_TURN bed half-widths either side (smooth around bends, no chevrons). */
const ROW_TURN = 1.8;
/** rowFrame's output: the row j the point lies after, how far on to row j + 1 (t) and its offset right of the line, m. */
export const rowHit = { j: 0, t: 0, x: 0 };
/**
 * Where a point (pn, pe) lies in a braided bed's rows (braidRows: tn, te at each sample; the ribbon's frame): between
 * rows j and j + 1, found from sample i0 on (the line's nearest), its place between them by its distance along each,
 * and its offset right of the line there (rowHit). False: not between any two rows within 64 of i0.
 */
export function rowFrame(north: ArrayLike<number>, east: ArrayLike<number>, tn: ArrayLike<number>, te: ArrayLike<number>, i0: number, pn: number, pe: number): boolean {
  const m = north.length;
  const along = (j: number): number => (pn - north[j]) * tn[j] + (pe - east[j]) * te[j];
  let j = Math.max(0, Math.min(m - 2, i0));
  let a0 = along(j);
  let a1 = along(j + 1);
  for (let g = 0; g < 64 && !(a0 >= 0 && a1 <= 0); g++) {
    if (a0 < 0) {
      if (j === 0) return false;
      j--;
      a1 = a0;
      a0 = along(j);
    } else {
      if (j + 2 >= m) return false;
      j++;
      a0 = a1;
      a1 = along(j + 1);
    }
  }
  if (!(a0 >= 0 && a1 <= 0)) return false;
  const t = a0 - a1 > 1e-9 ? a0 / (a0 - a1) : 0;
  const ln = north[j] + (north[j + 1] - north[j]) * t;
  const le = east[j] + (east[j + 1] - east[j]) * t;
  // (Right of the flow: (-te, tn) in (north, east).)
  const rn = -(te[j] + (te[j + 1] - te[j]) * t);
  const re = tn[j] + (tn[j + 1] - tn[j]) * t;
  const rl = Math.hypot(rn, re) || 1;
  rowHit.j = j;
  rowHit.t = t;
  rowHit.x = ((pn - ln) * rn + (pe - le) * re) / rl;
  return true;
}

/** A braided line as its ribbon is drawn (water.ts ribbonRows): its points, its rows' directions (braidRows), its bed's
 * and water's edges right and left, its threads and phases, per sample; and the samples that are rows (ascending). */
export interface BraidRibbon {
  north: ArrayLike<number>;
  east: ArrayLike<number>;
  tn: ArrayLike<number>;
  te: ArrayLike<number>;
  bedR: ArrayLike<number>;
  bedL: ArrayLike<number>;
  wetR: ArrayLike<number>;
  wetL: ArrayLike<number>;
  K: ArrayLike<number>;
  ph: ArrayLike<number>;
  ps: ArrayLike<number>;
  level?: ArrayLike<number>;
  rows: Int32Array;
}
/** The braided ribbon's columns across a row (water.ts: -3 and 3 the right and left bed edges, -2 and 2 the main
 * water's, with two extra columns across each gravel bar so linear interpolation across wide bars never kinks threads). */
export const BRAID_ACROSS = [-3, -2.667, -2.333, -2, -1, 0, 1, 2, 2.333, 2.667, 3];
const TWIN_COLS = BRAID_ACROSS.length;
/** braidTwin's output: what the ribbon's fragment there reads - u, um, the bed's half-width, K, the phases, the main
 * water's width, the interpolated ribbon surface level - and whether it lies in the main water's columns (main). */
export const twinHit = { u: 0, um: 0, hb: 1, K: 0, ph: 0, ps: 0, w: 0, level: 0, main: false };
const twinV = new Float64Array(2 * TWIN_COLS * 2);
const twinA = new Float64Array(2 * TWIN_COLS * 8);
/**
 * The ribbon's own reading of a braided bed at a point (pn, pe): its two rows about it (rowFrame's guess from row r0,
 * then the quads either side), its vertices and their attributes as ribbonRows builds them, the triangle (as it indexes
 * them) the point lies in, and the attributes there by its barycentric weights - the GPU's interpolation, so the ground
 * cut under a thread is cut where the thread is drawn. False: the point is on none of its triangles.
 */
export function braidTwin(L: BraidRibbon, r0: number, pn: number, pe: number): boolean {
  const R = L.rows;
  for (const dj of [0, -1, 1, -2, 2, -3, 3, -4, 4, -5, 5, -6, 6, -7, 7, -8, 8]) {
    const q = r0 + dj;
    if (q < 0 || q + 1 >= R.length) continue;
    const i0 = R[q];
    const i1 = R[q + 1];
    const reach = Math.max(L.bedR[i0], L.bedL[i0], L.bedR[i1], L.bedL[i1], L.wetR[i0] + 1, L.wetL[i0] + 1, L.wetR[i1] + 1, L.wetL[i1] + 1) + 2;
    if (pn < Math.min(L.north[i0], L.north[i1]) - reach || pn > Math.max(L.north[i0], L.north[i1]) + reach || pe < Math.min(L.east[i0], L.east[i1]) + 0 - reach || pe > Math.max(L.east[i0], L.east[i1]) + reach) continue;
    // The quad's 2 * TWIN_COLS vertices (rows q, q + 1; columns across) and their attributes.
    for (let h = 0; h < 2; h++) {
      const i = R[q + h];
      const tl = Math.hypot(L.tn[i], L.te[i]) || 1;
      const pnn = L.te[i] / tl;
      const pen = -L.tn[i] / tl;
      const wR = L.wetR[i];
      const wL = L.wetL[i];
      const w = 0.5 * (wR + wL);
      const mid = 0.5 * (wR - wL);
      const xc = 0.5 * (L.bedR[i] - L.bedL[i]);
      const hb = Math.max(1, 0.5 * (L.bedR[i] + L.bedL[i]));
      const lvl = L.level ? L.level[i] : 0;
      for (let c = 0; c < TWIN_COLS; c++) {
        const a = BRAID_ACROSS[c];
        const right = a < 0;
        const wet = right ? wR : wL;
        const edge = Math.max(wet + 0.3, right ? L.bedR[i] : L.bedL[i]);
        const ua = Math.abs(a);
        const x = ua <= 2 ? 0.5 * ua * wet : wet + (ua - 2) * (edge - wet);
        const off = (right ? -1 : 1) * x;
        const v = h * TWIN_COLS + c;
        twinV[2 * v] = L.north[i] + pnn * off;
        twinV[2 * v + 1] = L.east[i] + pen * off;
        const at = 8 * v;
        twinA[at] = (-off - xc) / hb;
        twinA[at + 1] = (mid - xc) / hb;
        twinA[at + 2] = hb;
        twinA[at + 3] = L.K[i];
        twinA[at + 4] = L.ph[i];
        twinA[at + 5] = L.ps[i];
        twinA[at + 6] = 2 * w;
        twinA[at + 7] = lvl;
      }
    }
    // Its triangles as ribbonRows indexes them: (a, c, a + 1) and (a + 1, c, c + 1), a = row q column k, c = row q + 1.
    for (let k = 0; k < TWIN_COLS - 1; k++) {
      for (const tri of [[k, TWIN_COLS + k, k + 1], [k + 1, TWIN_COLS + k, TWIN_COLS + k + 1]]) {
        const [v0, v1, v2] = tri;
        const n0 = twinV[2 * v0], e0 = twinV[2 * v0 + 1], n1 = twinV[2 * v1], e1 = twinV[2 * v1 + 1], n2 = twinV[2 * v2], e2 = twinV[2 * v2 + 1];
        const det = (e1 - e2) * (n0 - n2) + (n2 - n1) * (e0 - e2);
        if (Math.abs(det) < 1e-9) continue;
        const l0 = ((e1 - e2) * (pn - n2) + (n2 - n1) * (pe - e2)) / det;
        const l1 = ((e2 - e0) * (pn - n2) + (n0 - n2) * (pe - e2)) / det;
        const l2 = 1 - l0 - l1;
        if (l0 < -1e-9 || l1 < -1e-9 || l2 < -1e-9) continue;
        const f = (o: number): number => l0 * twinA[8 * v0 + o] + l1 * twinA[8 * v1 + o] + l2 * twinA[8 * v2 + o];
        twinHit.u = f(0);
        twinHit.um = f(1);
        twinHit.hb = f(2);
        twinHit.K = f(3);
        twinHit.ph = f(4);
        twinHit.ps = f(5);
        twinHit.w = f(6);
        twinHit.level = f(7);
        // (The main water's columns, -2..2: the shader draws no other thread there.)
        twinHit.main = k >= 3 && k <= 6;
        return true;
      }
    }
  }
  return false;
}

/**
 * GLSL twin of braidAt (needs HASH_GLSL's hash2u; the world seed's salt baked in as hash2i adds it in JS):
 * evaluates the major branches, cross-bar diagonal chutes (with second-order almond-bar splits), and outer/flanking
 * anabranch minor streams identically to CPU braidAt. Call when building a material.
 */
export function braidGlsl(): string {
  const f = (v: number): string => v.toFixed(6);
  return /* glsl */ `
float bHash(int i, int key) { return float(hash2u(i + ${seedSaltX()}, key + ${seedSaltY()}) & 0xffffu) * (1.0 / 65536.0); }
float bNoise(float t, int key) {
  float fi = floor(t);
  int i = int(fi);
  float f = t - fi;
  float p0 = 2.0 * bHash(i - 1, key) - 1.0;
  float p1 = 2.0 * bHash(i, key) - 1.0;
  float p2 = 2.0 * bHash(i + 1, key) - 1.0;
  float p3 = 2.0 * bHash(i + 2, key) - 1.0;
  return 0.5 * (2.0 * p1 + (p2 - p0) * f + (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * f * f + (3.0 * p1 - p0 - 3.0 * p2 + p3) * f * f * f);
}
float bSpread(float n) {
  float n2 = n * n;
  return clamp(n * (1.2194 - n2 * (0.1539 + 0.078 * n2)), -1.0, 1.0);
}
float braidAt(float u, float um, float hb, float K, float ph, float ps, float w, out float half_) {
  float best = -1e9;
  half_ = 0.0;
  float x = u * hb;
  float xs[${BRAID_MAX + 1}];
  float ws[${BRAID_MAX + 1}];
  xs[0] = um * hb;
  ws[0] = w;
  int nMaj = 0;
  for (int k = 1; k <= ${BRAID_MAX}; k++) {
    float fk = float(k);
    float p = min(1.0, K - fk);
    if (p <= 0.0) break;
    nMaj = k;
    float rate = 0.86 + 0.08 * float(k - 5 * (k / 5));
    float uk = ${f(BRAID_SPAN)} * bSpread(bNoise(ph * rate + 31.1 * fk, 100 + k));
    float lens = ${f(BRAID_LENS_AMP * 2)} * hb * bNoise(ph * ${f(BRAID_WAVE / BRAID_LENS)} * rate + 7.7 * fk, 150 + k);
    float bankCusp = 0.18 * w * bNoise(ps * 4.1 + 5.9 * fk, 350 + k);
    float wk = max(1.6, w * ${f(BRAID_W)} * pow(fk + 1.0, ${f(BRAID_W_EXP)})) * exp(${f(BRAID_W_SPREAD)} * bNoise(ph * 4.2 + 3.3 * fk, 300 + k) + 0.18 * bNoise(ps * 3.7 + 2.1 * fk, 320 + k)) * (0.35 + 0.65 * p);
    float wig = ${f(BRAID_WIG_AMP)} * wk * bNoise(ps * (1.5 + 0.4 * bHash(k, 401)) + 11.3 * fk, 400 + k) + bankCusp;
    float xk = xs[0] + p * (uk * hb + lens + wig - xs[0]);
    for (int j = 0; j < k; j++) xk = xs[j] + (xk - xs[j]) * smoothstep(${f(BRAID_JOIN[0])}, ${f(BRAID_JOIN[1])}, abs(xk - xs[j]) / (0.5 * (wk + ws[j])));
    float lim = max(0.0, hb - 0.5 * wk - 1.5);
    xk = clamp(xk, -lim, lim);
    xs[k] = xk;
    ws[k] = wk;
    float inside = 0.5 * wk - abs(x - xk);
    if (inside > best) { best = inside; half_ = 0.5 * wk; }
  }
  if (K > 1.25 && nMaj >= 1) {
    float bOn = smoothstep(1.25, 2.2, K);
    float xS[${BRAID_MAX + 1}];
    float wS[${BRAID_MAX + 1}];
    for (int i = 0; i <= ${BRAID_MAX}; i++) {
      if (i > nMaj) break;
      float xi = xs[i];
      float wi = ws[i];
      int j = i - 1;
      for (int step_ = 0; step_ < ${BRAID_MAX}; step_++) {
        if (j < 0 || xS[j] <= xi) break;
        xS[j + 1] = xS[j];
        wS[j + 1] = wS[j];
        j--;
      }
      xS[j + 1] = xi;
      wS[j + 1] = wi;
    }
    float limC = max(0.0, hb - 2.0);
    for (int g = 0; g < ${BRAID_MAX}; g++) {
      if (g >= nMaj) break;
      float fg = float(g);
      float xA0 = xS[g];
      float xB0 = xS[g + 1];
      float gap = xB0 - xA0;
      float clearGap = gap - 0.5 * (wS[g] + wS[g + 1]);
      if (clearGap <= 3.5) continue;
      float gapKeep = smoothstep(3.5, 14.0, clearGap) * bOn;
      float tc = ph * 0.92 + fg * 3.71;
      float qc = floor(tc);
      float tau = tc - qc;
      int iqc = int(qc);
      bool even = ((iqc + g) & 1) == 0;
      float xStart = even ? xA0 : xB0;
      float xEnd = even ? xB0 : xA0;
      float sTau = tau * tau * (3.0 - 2.0 * tau);
      float s1 = sin(3.14159265 * tau);
      float arch = s1 * s1;
      float bow = arch * (0.12 * min(gap, 70.0) * bNoise(tc * 2.1 + 5.3 * fg, 720) + 0.24 * w * bNoise(ps * 2.6 + 9.1 * fg, 740) + 0.12 * w * bNoise(ps * 5.3 + 3.1 * fg, 750));
      float xc = clamp(xStart + (xEnd - xStart) * sTau + bow, -limC, limC);
      int cid = iqc * 13 + g * 7;
      float wc = max(1.6, w * (0.10 + 0.07 * bNoise(tc * 1.7 + fg * 4.1, 760)) * exp(0.30 * bNoise(ps * 3.9 + 2.3 * fg, 780))) * gapKeep;
      if (wc > 0.4) {
        float inside = 0.5 * wc - abs(x - xc);
        if (inside > best) { best = inside; half_ = 0.5 * wc; }
        if (clearGap > 24.0 && tau > 0.14 && tau < 0.86) {
          float hc2 = bHash(cid + 11, 790);
          if (hc2 > 0.35) {
            float uSub = (tau - 0.14) * (1.0 / 0.72);
            float su = sin(3.14159265 * uSub);
            float subArch = su * su;
            float wSub = 0.70 * wc * smoothstep(24.0, 45.0, clearGap);
            if (wSub > 0.4) {
              float offSub = (hc2 > 0.67 ? 1.0 : -1.0) * subArch * min(0.26 * clearGap, (2.2 + 1.8 * hc2) * wc);
              float xSub = clamp(xc + offSub, -limC, limC);
              float inSub = 0.5 * wSub - abs(x - xSub);
              if (inSub > best) { best = inSub; half_ = 0.5 * wSub; }
            }
          }
        }
      }
    }
  }
  return best;
}
`;
}

/**
 * Signed bend of a polyline at each point over its local peak (DESIGN.md κ̂: 0 at a crossing, ±1 at an apex; + where
 * it turns right, its inside on the right): heading smoothed over `smoothM` m of arc, curvature over the largest
 * against a bend of radius `refR` (m) at each point: 1 there or tighter.
 */
export function bendOf(north: ArrayLike<number>, east: ArrayLike<number>, smoothM: ArrayLike<number>, refR: ArrayLike<number>): Float32Array {
  const m = north.length;
  const out = new Float32Array(m);
  if (m < 3) return out;
  const s = new Float64Array(m);
  for (let i = 1; i < m; i++) s[i] = s[i - 1] + Math.hypot(north[i] - north[i - 1], east[i] - east[i - 1]);
  // Unwrapped heading per point (from the neighbouring segments).
  const hd = new Float64Array(m);
  let prev = 0;
  for (let i = 0; i < m; i++) {
    const a = Math.max(0, i - 1);
    const b = Math.min(m - 1, i + 1);
    let h = Math.atan2(east[b] - east[a], north[b] - north[a]);
    if (i > 0) {
      while (h - prev > Math.PI) h -= 2 * Math.PI;
      while (h - prev < -Math.PI) h += 2 * Math.PI;
    }
    hd[i] = h;
    prev = h;
  }
  // Heading smoothed by a moving average over smoothM of arc.
  const sm = new Float64Array(m);
  let lo = 0;
  let hi = 0;
  let sum = 0;
  for (let i = 0; i < m; i++) {
    const r = 0.5 * smoothM[i];
    while (hi < m && s[hi] <= s[i] + r) sum += hd[hi++];
    while (lo < hi && s[lo] < s[i] - r) sum -= hd[lo++];
    sm[i] = sum / Math.max(1, hi - lo);
  }
  // Curvature: heading east of north increases clockwise seen from above, i.e. turning right.
  const k = new Float64Array(m);
  for (let i = 0; i < m; i++) {
    const a = Math.max(0, i - 1);
    const b = Math.min(m - 1, i + 1);
    k[i] = (sm[b] - sm[a]) / Math.max(1e-6, s[b] - s[a]);
  }
  // Against a full bend's curvature: a radius of refR or tighter is an apex (1); a gentle bend's a share of one, a
  // straight reach's none - not each wiggle over its own local peak, which made every sample's noise an apex.
  for (let i = 0; i < m; i++) out[i] = Math.max(-1, Math.min(1, k[i] * refR[i]));
  return out;
}

/**
 * The cross-section about a line's thread (DESIGN.md section 4), height over its water level at distance d on one
 * side: its wet bed (a parabola `depth` deep, rising just over the water at the wet edge `wet`), the bar from there to
 * the bed's edge `bed` (rising to 0.6 of the bank's height), then the bank at its slope (tan) to the bank's height; past
 * it the cut rises on at the bank's slope to the ground standing `over` m over the water there (a floor, a valley's
 * side), more steeply only as it must to meet that ground within BANK_JOIN m (the carve's reach): a cut at a fixed 45
 * degrees left a trench with walls beside every line a few metres under the ground beside it (the airfields' fieldBanks
 * and heldOver); at the bank's slope alone it reached past the carve's reach and left a step there.
 */
export function formSection(d: number, wet: number, bed: number, depth: number, bankH: number, bankTan: number, over: number): number {
  if (d < wet) {
    const t = d / wet;
    return WET_EDGE - (depth + WET_EDGE) * (1 - t * t);
  }
  const top = Math.max(WET_EDGE, 0.6 * bankH);
  if (d < bed) return WET_EDGE + ((top - WET_EDGE) * (d - wet)) / Math.max(0.01, bed - wet);
  const b = d - bed;
  const run = (bankH * 0.4) / Math.max(1e-3, bankTan);
  if (b <= run) return top + b * bankTan;
  const tb = top + run * bankTan;
  // (Rising to BANK_PAST m past the ground by then, so the carve's smooth minimum with the ground leaves the ground as
  // it is there, not a little under it to the carve's reach.)
  return tb + (b - run) * Math.max(bankTan, (over - tb + BANK_PAST) / BANK_JOIN);
}
/** formSection: past its bank a cut meets the ground within this far, m (inside the carve's reach: hydrology.ts
 * CHANNEL_BANK + 45 beyond the bed), rising to BANK_PAST m over it by then. */
const BANK_JOIN = 50;
const BANK_PAST = 4;
/** The bed stands this far over the water at the wet edge, m (the water's edge lies just inside it). */
const WET_EDGE = 0.08;

/**
 * The riparian corridor of a seeded world's channels (DESIGN.md section 5, prototype): its trees stand in runs with gaps
 * (a value noise of the world position at about 45 m, thresholded to a share near a half: NZ runs of 20-185 m, gaps of
 * 10-600 m), and its width (how far beyond the bed the bank's trees and rough grass reach before the fields) wanders
 * between a third of GALLERY_FAR and its 1.3 times over a few hundred metres - no ruled line parallel to the water. The
 * ground shader's twin is CORRIDOR_GLSL (on bedrock.ts ROCK_EDGE_GLSL's rockVN); tree placement reads these.
 */
export function corridorRuns(east: number, north: number): number {
  const v = 0.7 * valueNoise(east / RUN_CELL + 31.7, north / RUN_CELL - 12.9) + 0.3 * valueNoise(east / RUN_FINE - 5.3, north / RUN_FINE + 8.1);
  return smooth(0.44, 0.56, v);
}
export function corridorFar(east: number, north: number, far: number): number {
  return far * (0.3 + valueNoise(east / WIDE_CELL + 3.1, north / WIDE_CELL - 7.7));
}
const RUN_CELL = 45;
const RUN_FINE = 17;
const WIDE_CELL = 230;
export const CORRIDOR_GLSL = /* glsl */ `
float corridorRuns(vec2 en) {
  float v = 0.7 * rockVN(en * ${(1 / RUN_CELL).toFixed(6)} + vec2(31.7, -12.9)) + 0.3 * rockVN(en * ${(1 / RUN_FINE).toFixed(6)} + vec2(-5.3, 8.1));
  return smoothstep(0.44, 0.56, v);
}
float corridorFar(vec2 en, float far) { return far * (0.3 + rockVN(en * ${(1 / WIDE_CELL).toFixed(6)} + vec2(3.1, -7.7))); }
`;
