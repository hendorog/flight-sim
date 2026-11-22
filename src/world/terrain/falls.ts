// A seeded world's waterfalls (any seed but 0), and the shape of its channels' beds about them. A channel's water
// otherwise follows the ground down as a continuous cascade (streams.ts refineSteep); it falls only where the ground
// itself breaks:
//  - at a fault (faults.ts): the rock on the upstream side stands higher by the fault's throw. The channel's drop
//    gathers there: a fall of the throw (a short flight of falls over FLIGHT_STEP), then a gorge the fall has cut back
//    through, its floor at a gentle gradient, until it meets the channel's own fall again.
//  - over the lip of a hanging valley: a side valley high in the ranges whose floor ends at the wall of a main valley
//    far below. Where the ground drops steeply and far there (STEP_GRADIENT, HANG_MIN), the tributary goes over it as
//    one tall fall, its foot at the bottom of the wall.
//  - just past a lake's outlet where the ground beyond its rim drops away as steeply: the lake spills over a cliff.
// A fall's lip and foot are adjacent samples of its line (its face is the segment between, FALL_RUN or the wall's
// run), so the terrain carved about the line's water (heightfield.ts carveNetwork) steps down there onto rock, and
// the falls' curtains (water.ts) hang from lip to foot.
//
// Also the channels' beds: the grain of the stones on the bed at every sample (RiverLine.grain), from boulders by the
// heads and on the steep pitches to gravel on the calm lowland reaches.

import { bedWidth } from './streams';
import type { Fall, FallCause } from './streams';
import { FALL_RUN } from './streams';
import type { FaultIndex } from './faults';
import { hash2i } from './noise';

/** A channel line's per-sample arrays (the level, positions and arc length, and any others of the same length). */
export type LineArrays = Record<string, Float64Array> & { north: Float64Array; east: Float64Array; level: Float64Array; halfWidth: Float64Array; s: Float64Array };

/** Least drop a fault's fall is drawn for, m (a smaller throw is a riffle over the rock). */
export const FALL_MIN = 3;
/** A fault's throw over this is a flight of falls, each at most this high, FLIGHT_STEP apart along the channel, m. */
const FLIGHT_MAX = 15;
const FLIGHT_STEP = 30;
/** The gorge below a fault's fall: its floor falls at this share of the channel's own gradient below the fault (at
 * least GORGE_GRADIENT_MIN), and it is at most GORGE_MAX long (a bigger throw than that allows is cut down), m. */
const GORGE_SHARE = 0.4;
const GORGE_GRADIENT_MIN = 0.004;
const GORGE_MAX = 1500;
/** A fall needs this much channel either side of it, m (not at a confluence or a source). */
const FALL_CLEAR = 120;
/** A channel's stones are at most this share of its bed's width (bedGrain). */
const GRAIN_BED = 0.25;
/** A hanging valley's wall falls at least HANG_WALL (an outlet's OUTLET_WALL) m/m over 40-400 m, at least HANG_MIN
 * (OUTLET_FALL_MIN) m high: its fall is that drop, at most HANG_MAX m. */
const HANG_WALL = 0.3;
const HANG_MIN = 40;
const HANG_MAX = 150;
const OUTLET_WALL = 0.5;
const OUTLET_FALL_MIN = 30;
/** The floor above a wall's lip falls at most this share of the wall's gradient (a break of slope). */
const WALL_FLOOR_SHARE = 0.5;
/** Below a wall's fall the water runs on at this gradient (its plunge pool and the gorge it has cut back into the
 * wall) until it meets the line's own level at the wall's foot. */
const WALL_GORGE = 0.03;
/** Falls on one line lie at least this far apart, m (else the later is left out). */
const FALL_SPACING = 200;
/** A hanging valley's lip lies within this of its mouth, m, at least HANG_ABOVE over the water it joins, its floor above
 * the lip falling no more than HANG_FLOOR m/m over HANG_FLOOR_RUN m. */
const HANG_REACH = 1500;
const HANG_ABOVE = 60;
const HANG_FLOOR = 0.15;
const HANG_FLOOR_RUN = 400;
/** An outlet's fall lies within this of the lake's edge, m. */
const OUTLET_REACH = 600;

/** Index of the sample at arc length sv, inserting one (interpolated) unless one lies within `tol`; returns the arrays. */
function insertAt(a: LineArrays, sv: number, tol = 0.5): { a: LineArrays; i: number } {
  const s = a.s;
  const n = s.length;
  let i = 0;
  while (i < n - 1 && s[i + 1] <= sv) i++;
  if (Math.abs(s[i] - sv) <= tol) return { a, i };
  if (i < n - 1 && Math.abs(s[i + 1] - sv) <= tol) return { a, i: i + 1 };
  if (i >= n - 1) return { a, i: n - 1 };
  const t = (sv - s[i]) / (s[i + 1] - s[i]);
  const out: Record<string, Float64Array> = {};
  for (const k of Object.keys(a)) {
    const v = a[k];
    if (v.length !== n) {
      out[k] = v;
      continue;
    }
    const w = new Float64Array(n + 1);
    w.set(v.subarray(0, i + 1), 0);
    w[i + 1] = v[i] + (v[i + 1] - v[i]) * t;
    w.set(v.subarray(i + 1), i + 2);
    out[k] = w;
  }
  return { a: out as LineArrays, i: i + 1 };
}

/** The arrays without samples i0..i1 (inclusive). */
function removeRange(a: LineArrays, i0: number, i1: number): LineArrays {
  if (i1 < i0) return a;
  const n = a.s.length;
  const out: Record<string, Float64Array> = {};
  for (const k of Object.keys(a)) {
    const v = a[k];
    if (v.length !== n) {
      out[k] = v;
      continue;
    }
    const w = new Float64Array(n - (i1 - i0 + 1));
    w.set(v.subarray(0, i0), 0);
    w.set(v.subarray(i1 + 1), i0);
    out[k] = w;
  }
  return out as LineArrays;
}

/** Level at arc length sv (clamped). */
function levelAt(a: LineArrays, sv: number): number {
  const s = a.s;
  let i = 0;
  while (i < s.length - 2 && s[i + 1] < sv) i++;
  const t = Math.min(1, Math.max(0, (sv - s[i]) / Math.max(1e-9, s[i + 1] - s[i])));
  return a.level[i] + (a.level[i + 1] - a.level[i]) * t;
}

/**
 * A fault's fall at arc length sv on the line `a` (its level as it stands), for a throw of `throwM` m: the gorge below as
 * steep as GORGE_SHARE of the channel's own fall over GORGE_MAX below the fault (at least GORGE_GRADIENT_MIN), and the
 * drop what the throw and the gorge leave of that fall. Fall and gorge together drop no more than the channel does
 * over GORGE_MAX, so the gorge meets the line's level again within it. (Taking only the share for the drop, the least
 * gradient on a gentle reach, or a second fault's fall within the first's gorge, measured on the level before the
 * first, overshot it: the gorge never met the river's level again and ran on at 0.4-0.6 % down to the sea's level.)
 */
function faultFit(a: LineArrays, sv: number, throwM: number): { drop: number; gorge: number } {
  const total = a.s[a.s.length - 1];
  const below = levelAt(a, sv) - levelAt(a, Math.min(total, sv + GORGE_MAX));
  const gorge = Math.max(GORGE_GRADIENT_MIN, (GORGE_SHARE * below) / GORGE_MAX);
  return { drop: Math.min(throwM, below - gorge * GORGE_MAX), gorge };
}

/**
 * A fall at arc length sLip of `drop` m: a lip sample there and a foot FALL_RUN on (samples between them go), the water
 * from the foot on lowered to a gorge whose floor falls at `gorge` (m/m) from the foot until it meets the line's own
 * level again, never under `floor` (the water the line ends in). Returns the arrays and the lip's index.
 */
function cutFall(a0: LineArrays, sLip: number, drop: number, gorge: number, floor: number): { a: LineArrays; lip: number } {
  let { a, i } = insertAt(a0, sLip);
  const sFoot = a.s[i] + FALL_RUN;
  const f = insertAt(a, sFoot);
  a = f.a;
  let j = f.i;
  if (j > i + 1) {
    a = removeRange(a, i + 1, j - 1);
    j = i + 1;
  }
  const lip = a.level[i];
  const foot = Math.max(floor, lip - drop);
  const L = a.level;
  for (let k = j; k < L.length; k++) {
    const g = foot - gorge * (a.s[k] - a.s[j]);
    if (L[k] <= g) break;
    L[k] = Math.max(floor, g);
  }
  return { a, lip: i };
}

/**
 * The tallest break of slope in [s0, s1] a fall can gather: a lip where a flatter floor above (falling at most
 * `maxFloor` over `floorRun` m, and at most WALL_FLOOR_SHARE of the wall's gradient) ends at a wall falling at least
 * `minWall` over 40-400 m to its foot, at least `minDrop` high. Its arc length and drop (null: none).
 */
function wallStep(a: LineArrays, s0: number, s1: number, minDrop: number, minWall: number, floorRun: number, maxFloor: number, headFloor = false): { s: number; drop: number } | null {
  const { s, level: L } = a;
  const n = s.length;
  let best: { s: number; drop: number } | null = null;
  for (let i = 0; i < n - 1; i++) {
    if (s[i] < s0) continue;
    if (s[i] > s1) break;
    // (A floor above it: not a line's head, unless that is a lake's level, `headFloor`.)
    if (s[i] < floorRun && !headFloor) continue;
    const gf = (levelAt(a, Math.max(0, s[i] - floorRun)) - L[i]) / floorRun;
    if (gf > maxFloor) continue;
    for (let j = i + 1; j < n && s[j] - s[i] <= 400; j++) {
      const run = s[j] - s[i];
      if (run < 40) continue;
      const drop = L[i] - L[j];
      if (drop < minDrop || drop < minWall * run || gf > WALL_FLOOR_SHARE * (drop / run)) continue;
      if (!best || drop > best.drop) best = { s: s[i], drop };
    }
  }
  return best;
}

/** One line for shapeLines: its arrays, kind, catchment (for its grain), what it joins and where, its lake flags. */
export interface ShapeInput {
  a: LineArrays;
  kind: number;
  /** Line it joins (-1: none) and the arc length along that line, m. */
  joins: number;
  joinS: number;
  /** Whether a sample lies in a lake's water (no fall there) and whether the line leaves a lake (an outlet). */
  wet: (north: number, east: number) => boolean;
  outlet: boolean;
  /** High in the ranges (the alpine uplift there), for a hanging valley's lip. */
  alpine: (north: number, east: number) => boolean;
  /** The steepest its last reach comes down to its mouth, m/m (shapeLines' `confluence` when absent). */
  confluence?: number;
}

export interface ShapeReport {
  faultCrossings: number;
  faultFalls: number;
  hanging: number;
  outletFalls: number;
  /** Hanging-valley candidates: tributaries high in the ranges dropping HANG_ABOVE or more over their last HANG_REACH. */
  hangCandidates: number;
}

/**
 * Shape every line's falls, receivers first (a line only ever joins one before it): its mouth put on the water it
 * joins (lowered there, and its last reach as a cascade of at most `confluence` m/m), a hanging valley's lip, an outlet's
 * fall and its faults' falls. Edits `lines[k].a` (and returns the falls, lips per line).
 */
export function shapeLines(lines: ShapeInput[], faults: FaultIndex | null, confluence: number): { falls: Fall[]; lips: number[][]; report: ShapeReport } {
  const falls: Fall[] = [];
  const lips: number[][] = lines.map(() => []);
  const report: ShapeReport = { faultCrossings: 0, faultFalls: 0, hanging: 0, outletFalls: 0, hangCandidates: 0 };
  let flight = 0;
  const push = (li: number, a: LineArrays, i: number, cause: FallCause, fl: number): void => {
    const j = Math.min(a.s.length - 1, i + 1);
    const dn = a.north[j] - a.north[i];
    const de = a.east[j] - a.east[i];
    const len = Math.hypot(dn, de) || 1;
    falls.push({ line: li, index: i, north: a.north[i], east: a.east[i], footNorth: a.north[j], footEast: a.east[j], top: a.level[i], bottom: a.level[j], height: a.level[i] - a.level[j], width: 2 * a.halfWidth[i], dirN: dn / len, dirE: de / len, cause, flight: fl });
  };
  for (let li = 0; li < lines.length; li++) {
    const L = lines[li];
    let a = L.a;
    const n = a.s.length;
    const total = a.s[n - 1];
    // --- Its mouth on the water it joins (that line's shape is final).
    let mouth = -Infinity;
    if (L.joins >= 0) {
      mouth = levelAt(lines[L.joins].a, L.joinS);
      a.level[n - 1] = Math.min(a.level[n - 1], mouth);
      mouth = a.level[n - 1];
    }
    const floor = mouth > -Infinity ? mouth : a.level[n - 1];
    // The falls this line gathers, by arc length: a hanging valley's lip, an outlet's cliff, the faults it crosses.
    const want: Array<{ s: number; drop: number; gorge: number; cause: FallCause; throw?: number }> = [];
    // --- A hanging valley: a tributary high in the ranges whose last reach drops far into its receiver, over a break
    // of slope: the drop of its wall gathered at the lip, its foot in a gorge cut back into the wall.
    if (L.joins >= 0) {
      const sFrom = Math.max(0, total - HANG_REACH);
      if (levelAt(a, sFrom) - mouth >= HANG_ABOVE && L.alpine(a.north[n - 1], a.east[n - 1])) {
        report.hangCandidates++;
        const w = wallStep(a, sFrom, total - FALL_CLEAR, HANG_MIN, HANG_WALL, HANG_FLOOR_RUN, HANG_FLOOR);
        if (w && !L.wet(a.north[0], a.east[0]) && levelAt(a, w.s) - mouth >= HANG_ABOVE * 0.6) want.push({ s: w.s, drop: Math.min(HANG_MAX, w.drop), gorge: WALL_GORGE, cause: 'hanging' });
      }
    }
    // --- An outlet over a cliff: a lake perched at the top of a wall.
    if (L.outlet) {
      let s0 = -1;
      for (let i = 0; i < n; i++) {
        if (!L.wet(a.north[i], a.east[i])) {
          s0 = a.s[i];
          break;
        }
      }
      if (s0 >= 0) {
        const w = wallStep(a, s0, Math.min(s0 + OUTLET_REACH, total - FALL_CLEAR), OUTLET_FALL_MIN, OUTLET_WALL, HANG_FLOOR_RUN, HANG_FLOOR, true);
        if (w) want.push({ s: w.s, drop: Math.min(HANG_MAX, w.drop), gorge: WALL_GORGE, cause: 'outlet' });
      }
    }
    // --- Faults: the drop gathered at each crossing.
    if (faults) {
      for (const c of faults.crossings(a.north, a.east)) {
        report.faultCrossings++;
        const sv = a.s[c.seg] + (a.s[c.seg + 1] - a.s[c.seg]) * c.t;
        if (sv < FALL_CLEAR || sv > total - FALL_CLEAR) continue;
        const pn = a.north[c.seg] + (a.north[c.seg + 1] - a.north[c.seg]) * c.t;
        const pe = a.east[c.seg] + (a.east[c.seg + 1] - a.east[c.seg]) * c.t;
        if (L.wet(pn, pe) || levelAt(a, sv) < 2) continue;
        const fit = faultFit(a, sv, c.throw);
        if (fit.drop < FALL_MIN) continue;
        want.push({ s: sv, ...fit, cause: 'fault', throw: c.throw });
      }
    }
    want.sort((x, y) => x.s - y.s);
    let lastS = -Infinity;
    let lastLip = -1;
    for (const f of want) {
      // (One break at a time: a fall within FALL_SPACING of the last is left out.)
      if (f.s - lastS < FALL_SPACING) continue;
      // A fault's fall fitted again to the level as the falls before it left it (they gathered its fall into theirs).
      const fit = f.throw !== undefined ? faultFit(a, f.s, f.throw) : f;
      const room = levelAt(a, f.s) - floor - 1;
      const drop = Math.min(fit.drop, room);
      if (drop < FALL_MIN) continue;
      // A fault's throw over FLIGHT_MAX is a short flight of falls.
      const k = f.cause === 'fault' ? Math.ceil(drop / FLIGHT_MAX) : 1;
      const id = k > 1 ? flight++ : -1;
      for (let q = 0; q < k; q++) {
        const r = cutFall(a, f.s + q * FLIGHT_STEP, drop / k, fit.gorge, floor);
        a = r.a;
        lips[li].push(r.lip);
        lastLip = r.lip;
        push(li, a, r.lip, f.cause, id);
        if (f.cause === 'fault') report.faultFalls++;
        else if (f.cause === 'hanging') report.hanging++;
        else report.outletFalls++;
      }
      lastS = f.s + (k - 1) * FLIGHT_STEP;
    }
    // --- The last reach comes down to the mouth as a cascade, no steeper than `confluence` (below the last fall's foot).
    if (mouth > -Infinity) {
      const m = a.s.length;
      for (let i = m - 2; i > lastLip; i--) {
        const cap = mouth + (L.confluence ?? confluence) * (a.s[m - 1] - a.s[i]);
        if (a.level[i] <= cap) break;
        a.level[i] = cap;
      }
    }
    L.a = a;
  }
  return { falls, lips, report };
}

/**
 * The grain of the stones on a channel's bed at each sample, m (a typical stone's size): boulders of 2-5 m by the
 * heads and on the steep pitches, where the water cannot move them on (they came down the slopes), worn smaller as
 * they travel (Sternberg's law: the size falls off with the distance carried, here GRAIN_DECAY km per e-fold, the
 * distance from the catchment by Hack's law, 1.4 A^0.6 km for A km², or from the lake above an outlet, which keeps its
 * own stones), and sorted by the flow: a calm reach keeps its gravel and sand, a riffle its cobbles (0.1-0.3 m), rapids
 * their boulders. Big stones lie at the foot of every fall.
 */
export function bedGrain(c: { s: Float64Array; north: Float64Array; east: Float64Array }, area: Float64Array, gradient: Float32Array, fromLake: boolean, feet: ReadonlyArray<{ index: number; height: number }>): Float32Array {
  const n = c.s.length;
  const g = new Float32Array(n);
  // (The distance carried changes slowly along a line: worked out every GRAIN_EVERY samples, interpolated between.)
  const at = (i: number): number => {
    const hack = 1.4 * Math.pow(Math.max(0.5, area[i]), 0.6);
    const km = fromLake ? Math.min(hack, 1 + c.s[i] / 1000) : hack;
    return GRAIN_FLOOR + GRAIN_HEAD * Math.exp(-km / GRAIN_DECAY);
  };
  let i0 = 0;
  let c0 = at(0);
  let i1 = Math.min(n - 1, GRAIN_EVERY);
  let c1 = at(i1);
  for (let i = 0; i < n; i++) {
    if (i > i1) {
      i0 = i1;
      c0 = c1;
      i1 = Math.min(n - 1, i1 + GRAIN_EVERY);
      c1 = at(i1);
    }
    const carried = i1 > i0 ? c0 + ((c1 - c0) * (i - i0)) / (i1 - i0) : c0;
    const S = gradient[i];
    let d = carried * (GRAIN_CALM + (1 - GRAIN_CALM) * smoothStep01(0.003, 0.05, S));
    // A steep pitch is choked with blocks too big to move whatever the distance: 1.5 to 4 m.
    const steep = smoothStep01(0.02, 0.15, S);
    if (steep > 0) {
      const u = (hash2i(Math.round(c.north[i] / 25), Math.round(c.east[i] / 25)) & 0xffff) / 65535;
      d = Math.max(d, (1.5 + 2.5 * u) * steep);
    }
    g[i] = Math.min(5, Math.max(0.002, d));
  }
  // Below a fall (its foot and the next samples): the blocks it has broken off, bigger under a taller fall.
  for (const f of feet) for (let j = f.index + 1; j < Math.min(n, f.index + 4); j++) g[j] = Math.max(g[j], 1.5 + 2.5 * smoothStep01(5, 60, f.height));
  // (A channel's stones are a share of its bed at most (streams.ts bedWidth): a small torrent's boulders are its own
  // size, not a big river's, so its bed reads as narrow as it is from the air.)
  for (let i = 0; i < n; i++) g[i] = Math.min(g[i], Math.max(0.002, GRAIN_BED * bedWidth(area[i])));
  return g;
}
/** bedGrain's stones: by the heads GRAIN_HEAD + GRAIN_FLOOR m, falling off over GRAIN_DECAY km to GRAIN_FLOOR; a calm
 * reach keeps GRAIN_CALM of that. */
const GRAIN_HEAD = 2.5;
const GRAIN_FLOOR = 0.04;
const GRAIN_DECAY = 12;
const GRAIN_CALM = 0.25;
const GRAIN_EVERY = 8;
const smoothStep01 = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
