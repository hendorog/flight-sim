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
// One water thread on every line: the bed's width follows the law's pattern share (a big gravel river's bed fills most
// of its floor, the water wandering within it), but no secondary threads are drawn (braids are the owner's open choice).
// Pure and three.js-free; read only on a seeded world's path (riverNetwork.ts, heightfield.ts carveNetwork).

import { gnoise, hash2i } from './noise';
import { valueNoise } from './bedrock';

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

/** The largest swing <= om whose amplitude fits in `room` (m). */
export function fitSwing(lam: number, om: number, room: number): number {
  if (!(room > 0)) return 0;
  if (sineAmplitude(lam, om) <= room) return om;
  let lo = 0;
  let hi = om;
  for (let k = 0; k < 30; k++) {
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
 * channel is. The bed widens from W_s toward the belt B by the fitted pattern share (a steep big gravel river with room:
 * the owner's Rakaia), never past the floor (but a single thread's own bed, which cuts its walls in a V); its water is a
 * single thread's at its catchment, whatever the bed's width.
 */
export function formOf(A: number, S: number, F: number): Form {
  const a = Math.max(0.05, A);
  const s = Math.max(0, S);
  const Ws = 4.47 * Math.pow(a, 0.39);
  const pi = s / (0.083 * Math.pow(a, -0.44));
  const sigma = 0.9 * smooth(0.01, 0.15, s);
  const B = 0.6 * 121 * Math.pow(a, 0.345);
  const rho = F / B;
  // (The bed's share: the fitted braid share's, on a big river only - the owner's Rakaia (2576 km²) 'has a very wide bed';
  // the Orari, 'quite similar in size and appearance to our rivers', a single gravel thread that wanders.)
  const betaLaw = smooth(1, 1.5, pi) * (1 - sigma) * smooth(0.5, 1.5, rho) * smooth(BED_BIG[0], BED_BIG[1], a);
  const Wa = Math.min(Math.pow(Ws, 1 - betaLaw) * Math.pow(B, betaLaw), Math.max(Ws, F));
  // (One water thread: a single thread's wet share of its own width W_s.)
  const w = (0.8 - 0.4 * smooth(0.7, 1.2, pi)) * Ws;
  const phi = Math.min(1, w / Wa);
  // (Below the braid threshold's onset a single thread keeps at least the swing that meets DESIGN.md section 7's
  // sinuosity, 1.25 at 1 km, up to pi 0.7, easing to a gravel thread's by pi 1.2: the fit alone stepped it down by
  // 0.7, the Selwyn's pi, and straightened every big lowland river of 0.6-0.8 - p7-8's, om-plains' - against section 7
  // and the owner's kept meanders.)
  const lowland = 0.95 * (1 - smooth(0.7, 1.2, pi));
  const om2 = Math.max(0.35 + 1.4 * (1 - smooth(0.05, 0.7, pi)), lowland);
  const lam2 = 13 * w;
  const om1 = 0.4;
  const lam1 = 378 * Math.pow(a, 0.204);
  const bankH = 0.35 * Math.pow(a, 0.17) * (1 - 0.4 * betaLaw);
  const bankTan = Math.tan(((14 + 36 * smooth(0.005, 0.08, s)) * Math.PI) / 180);
  const stepL = Ws * (1.75 + 7.75 * (1 - smooth(0.05, 0.12, s)));
  const stepH = sigma * s * stepL;
  return { Ws, B, Wa, pi, sigma, betaLaw, phi, om2, lam2, om1, lam1, bankH, bankTan, stepL, stepH };
}

/** formOf: a river's bed widens toward its gravel belt from the first catchment (km²) to the second. */
const BED_BIG = [100, 1000];

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
    north.push(o[0] - o[3] * thread.off[i]);
    east.push(o[1] + o[2] * thread.off[i]);
    valleyS.push(Math.min(total, Math.max(0, vAt(bs))));
    off.push(yAt(bs) + thread.off[i]);
  }
  // Its ends on the axis's ends' cross-lines (the march stops within a step of them).
  return { north, east, valleyS, off };
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
