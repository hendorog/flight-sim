// A seeded world's rivers and lakes (any seed but 0), built from its drainage (drainage.ts) at load in every thread.
// Seed 0 keeps the hand-placed river and lakes of hydrology.ts.
//
// Each drainage line becomes a river: its 1 km lattice course jittered and smoothed into a valley axis, its width from
// the catchment area, the big lowland rivers swung into meanders about the axis (a skewed sine whose wavelength
// follows the width, so no growth simulation has to run at load), and its water level falling from the source,
// meeting the river it joins at the confluence and lying level through any lake on its course. Lakes are the deep
// filled hollows of the drainage, as warped ellipses fitted to the hollow.

import { fbm, hash2i, gnoise } from './noise';
import { lakeAt, lakeRadius, PolylineIndex, CHANNEL_BANK, type PolylineNear, type ChannelNear, type Hydrology, type Lake, type NetworkQuery, type OxbowHit, type RiverHit, type RiverLine, type ValleyHit, type ValleyNear } from './hydrology';
import { cellEast, cellNorth, DRAIN_CELL, type Drainage } from './drainage';
import { AIRPORT } from '../../core/world';

/** A lake's water stands at least this far over the natural ground at its middle, m. */
const MIN_LAKE_DEPTH = 3;
/** Oxbow water stands this far above the river level of its valley section, m (as hydrology.ts). */
const OXBOW_LEVEL = 0.6;
/** Amplitude of the courses' wander off the lattice, m. */
const WANDER = 900;
/** Valley-axis sample spacing, m. */
const AXIS_SPACING = 120;
/** Index cells, m. */
const CHANNEL_CELL = 500;
const VALLEY_CELL = 1000;
/** Channels are searched this far beyond their half-width (bank and levee), m. */
const CHANNEL_MARGIN = CHANNEL_BANK + 45;
/** Beyond the channel index's reach, queryRiver estimates the distance from the valley axis. */
const CHANNEL_REACH = 450;
/** Catchment (km²) above which a river meanders on low ground, and the valley gradient below which it does. */
const MEANDER_AREA = 250;
const MEANDER_GRADIENT = 0.004;

/** Channel half-width for a catchment area, m. */
export const halfWidthFor = (area: number): number => Math.min(45, Math.max(3, 1.5 + 0.85 * Math.sqrt(area)));

const smooth = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

interface Axis {
  north: Float64Array;
  east: Float64Array;
  s: Float64Array;
  area: Float64Array;
  level: Float64Array;
  halfWidth: Float64Array;
  belt: Float64Array;
  /** Meander strength, [0, 1] (streams wiggle a little at 0), and the meander wavelength along the valley, m. */
  meander: Float64Array;
  wavelength: Float64Array;
  floodplain: Float64Array;
  influence: Float64Array;
}

/** The lakes of a seeded world: ellipses fitted to the drainage's lake hollows, levels from the natural terrain. */
export function networkLakes(natural: (north: number, east: number) => number, d: Drainage): Lake[] {
  const out: Lake[] = [];
  for (const l of d.lakes) {
    let mn = 0;
    let me = 0;
    let deep = l.cells[0];
    for (const c of l.cells) {
      mn += cellNorth(d, c);
      me += cellEast(d, c);
      if (d.filled[c] - d.height[c] > d.filled[deep] - d.height[deep]) deep = c;
    }
    mn /= l.cells.length;
    me /= l.cells.length;
    let snn = 0;
    let see = 0;
    let sne = 0;
    for (const c of l.cells) {
      const dn = cellNorth(d, c) - mn;
      const de = cellEast(d, c) - me;
      snn += dn * dn;
      see += de * de;
      sne += dn * de;
    }
    const k = l.cells.length;
    // Each cell is a 1 km square: add its own spread so single-row hollows still have width.
    snn = snn / k + (DRAIN_CELL * DRAIN_CELL) / 12;
    see = see / k + (DRAIN_CELL * DRAIN_CELL) / 12;
    sne /= k;
    const tr = snn + see;
    const det = snn * see - sne * sne;
    const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
    const l1 = tr / 2 + disc;
    const l2 = Math.max(1, tr / 2 - disc);
    // Major axis direction from north toward east.
    const rotation = 0.5 * Math.atan2(2 * sne, snn - see);
    const depth = Math.min(40, Math.max(8, l.depth * 0.6));
    // The shoreline must stay inside the hollow: its level comes from the lowest ground round the shore, so a shore
    // reaching over the rim onto falling ground would leave the water in a pit. Try the hollow's centre and its
    // deepest cell, shrinking the ellipse until the water stands at least MIN_LAKE_DEPTH over the natural ground at
    // the middle; a hollow where no size does has no lake.
    let lake: Lake | null = null;
    for (const [cn, ce] of [[mn, me], [cellNorth(d, deep), cellEast(d, deep)]]) {
      for (let f = 1; f >= 0.3 && !lake; f *= 0.8) {
        const radiusA = Math.max(300, 1.7 * Math.sqrt(l1) * f);
        const radiusB = Math.max(220, 1.7 * Math.sqrt(l2) * f);
        const cand = lakeAt(natural, { radiusA, radiusB, rotation, depth }, { north: cn, east: ce });
        if (cand.level >= natural(cn, ce) + MIN_LAKE_DEPTH) lake = cand;
      }
      if (lake) break;
    }
    if (lake) out.push(lake);
  }
  return out;
}

/** Build a seeded world's hydrology from its drainage and lakes. */
export function buildNetworkHydrology(natural: (north: number, east: number) => number, d: Drainage, lakes: Lake[]): Hydrology {
  const lines = d.lines;
  // --- Lattice courses: jittered (the same jitter for a cell shared by two lines) and smoothed; a tributary's last
  // point is put back on its parent's smoothed course.
  const jitter = (c: number, k: number): number => ((hash2i(c, 0x51ed + k) & 0xffff) / 65536 - 0.5) * DRAIN_CELL * 0.55;
  const courses: Array<{ n: number[]; e: number[] }> = [];
  for (let li = 0; li < lines.length; li++) {
    const L = lines[li];
    // A smooth wander (a warp of the plane, so a cell shared by two lines moves the same way) breaks up the straight
    // runs the lattice routes across plains, then a little per-cell jitter.
    // A river that reaches the sea keeps its mouth on its outlet cell (the wander fades over the last two cells).
    const last = L.cells.length - 1;
    const fade = (i: number): number => (L.joins >= 0 ? 1 : Math.min(1, (last - i) / 2));
    const wn = (c: number, i: number): number => cellNorth(d, c) + fade(i) * (WANDER * fbm(cellNorth(d, c) / 6000 + 3.7, cellEast(d, c) / 6000 - 1.9, 3) + jitter(c, 0));
    const we = (c: number, i: number): number => cellEast(d, c) + fade(i) * (WANDER * fbm(cellNorth(d, c) / 6000 - 8.1, cellEast(d, c) / 6000 + 5.3, 3) + jitter(c, 1));
    let n = L.cells.map(wn);
    let e = L.cells.map(we);
    clearOfRunway(n, e);
    for (let pass = 0; pass < 3; pass++) {
      const n2 = n.slice();
      const e2 = e.slice();
      for (let i = 1; i < n.length - 1; i++) {
        n2[i] = 0.25 * n[i - 1] + 0.5 * n[i] + 0.25 * n[i + 1];
        e2[i] = 0.25 * e[i - 1] + 0.5 * e[i] + 0.25 * e[i + 1];
      }
      n = n2;
      e = e2;
    }
    clearOfRunway(n, e);
    if (L.joins >= 0) {
      n[n.length - 1] = courses[L.joins].n[L.joinAt];
      e[e.length - 1] = courses[L.joins].e[L.joinAt];
    }
    courses.push({ n, e });
  }

  // --- Valley axes: densified courses with catchment, level, width, meander belt, floodplain.
  const axes: Axis[] = [];
  const lakeAtPoint = (pn: number, pe: number): Lake | null => {
    for (const lake of lakes) {
      const dn = pn - lake.north;
      const de = pe - lake.east;
      if (dn * dn + de * de > lake.bound * lake.bound) continue;
      if (lakeRadius(lake, pn, pe) < 1) return lake;
    }
    return null;
  };
  for (let li = 0; li < lines.length; li++) {
    const L = lines[li];
    const c = courses[li];
    const pts = catmullRom(c.n, c.e, AXIS_SPACING);
    // The spline can swing inside the clearance between two points that keep outside it.
    clearOfRunway(pts.n, pts.e);
    const count = pts.n.length;
    const north = Float64Array.from(pts.n);
    const east = Float64Array.from(pts.e);
    const s = new Float64Array(count);
    for (let i = 1; i < count; i++) s[i] = s[i - 1] + Math.hypot(north[i] - north[i - 1], east[i] - east[i - 1]);
    const area = new Float64Array(count);
    for (let i = 0; i < count; i++) {
      const u = pts.t[i];
      const k = Math.min(L.area.length - 2, Math.floor(u));
      area[i] = L.area[k] + (L.area[k + 1] - L.area[k]) * (u - k);
    }
    // Water level: the running minimum of the natural terrain downstream, level across lakes, meeting the parent.
    // The ground is sampled at every other point (the lowest of the centre and 80 m either side across the valley);
    // the points between take the lower of their neighbours.
    const ground = new Float64Array(count);
    for (let i = 0; i < count; i++) {
      if (i % 2 === 1 && i < count - 1) continue;
      const i0 = Math.max(0, i - 1);
      const i1 = Math.min(count - 1, i + 1);
      const tl = Math.hypot(north[i1] - north[i0], east[i1] - east[i0]) || 1;
      const qn = (-(east[i1] - east[i0]) / tl) * 80;
      const qe = ((north[i1] - north[i0]) / tl) * 80;
      ground[i] = Math.min(natural(north[i], east[i]), natural(north[i] + qn, east[i] + qe), natural(north[i] - qn, east[i] - qe));
    }
    for (let i = 1; i < count - 1; i += 2) ground[i] = Math.min(ground[i - 1], ground[i + 1]);
    const level = new Float64Array(count);
    let run = Infinity;
    for (let i = 0; i < count; i++) {
      const lake = lakeAtPoint(north[i], east[i]);
      if (lake) {
        run = lake.level;
      } else {
        const cand = ground[i] - 2.5;
        run = i === 0 ? cand : Math.min(run - 0.00025 * (s[i] - s[i - 1]), cand);
      }
      level[i] = Math.max(0, run);
    }
    if (L.joins >= 0) {
      const p = axes[L.joins];
      const at = p.s[nearestIndex(p, north[count - 1], east[count - 1])];
      const lj = sampleAt(p.s, p.level, at);
      for (let i = 0; i < count; i++) level[i] = Math.max(level[i], lj);
      level[count - 1] = lj;
    }
    // No cliffs: a small stream may fall steeply, a big river at most MAX_GRADIENT (the drop is spread upstream).
    for (let i = count - 2; i >= 0; i--) {
      const cap = 0.008 + 0.6 * (1 - smooth(100, 1500, area[i]));
      level[i] = Math.min(level[i], level[i + 1] + cap * (s[i + 1] - s[i]));
    }
    const halfWidth = new Float64Array(count);
    const belt = new Float64Array(count);
    const meander = new Float64Array(count);
    const wavelength = new Float64Array(count);
    const floodplain = new Float64Array(count);
    const influence = new Float64Array(count);
    for (let i = 0; i < count; i++) {
      const hw = halfWidthFor(area[i]);
      halfWidth[i] = hw;
      // Meanders: big rivers on gentle ground swing wide; none in the last stretch of a tributary (it meets its parent).
      const j0 = Math.max(0, i - 8);
      const j1 = Math.min(count - 1, i + 8);
      const grad = (level[j0] - level[j1]) / Math.max(1, s[j1] - s[j0]);
      const lowland = 1 - smooth(MEANDER_GRADIENT * 0.5, MEANDER_GRADIENT, grad);
      const big = smooth(MEANDER_AREA * 0.6, MEANDER_AREA * 1.6, area[i]);
      const tail = L.joins >= 0 ? smooth(0, 2500, s[count - 1] - s[i]) : 1;
      // No wide loops by the home runway.
      const nearField = smooth(3000, 6000, runwayDistance(north[i], east[i]));
      const m = lowland * big * tail * nearField * clampUnit(0.8 + 0.4 * gnoise(s[i] / 5200 + li * 7.31, 2.7 + li));
      meander[i] = m;
      // Meander wavelength about 18 channel widths (the long end of Leopold & Wolman's range: broad loops, as seed 0's
      // river has), varied along the river.
      wavelength[i] = Math.max(160, 36 * hw) * (0.85 + 0.3 * gnoise(s[i] / 3000 + li * 3.3, 9.1));
      // Half-width of the belt the channel swings across (sineGenerated keeps the channel inside it).
      belt[i] = wavelength[i] * (0.06 + 0.42 * m);
      floodplain[i] = belt[i] + hw + CHANNEL_BANK + 4 * hw * Math.min(1, belt[i] / 200);
      influence[i] = 500 + 1900 * smooth(30, 2000, area[i]);
    }
    axes.push({ north, east, s, area, level, halfWidth, belt, meander, wavelength, floodplain, influence });
  }

  // --- Channels: sine-generated curves about the axis, some loops cut off as oxbows; a tributary's end on its parent's channel.
  const rivers: Array<RiverLine & { valleyS: Float64Array }> = [];
  const oxbows: Array<{ north: Float64Array; east: Float64Array; level: number; halfWidth: number; depth: number }> = [];
  for (let li = 0; li < lines.length; li++) {
    const a = axes[li];
    const total = a.s[a.s.length - 1];
    const ch = sineGenerated(a, (hash2i(li, 0x3ea) & 0xffff) / 65536 * Math.PI * 2);
    for (const o of cutOffLoops(ch, a, li)) {
      oxbows.push({
        north: o.north,
        east: o.east,
        level: sampleAt(a.s, a.level, o.valleyS) + OXBOW_LEVEL,
        halfWidth: o.halfWidth * 0.85,
        // Cut off long ago (age near 0): more silted up, as hydrology.ts's oxbows.
        depth: 0.8 + 2.2 * o.age,
      });
    }
    const north = Float64Array.from(ch.north);
    const east = Float64Array.from(ch.east);
    const valleyS = Float64Array.from(ch.valleyS);
    const steps = north.length - 1;
    const L = lines[li];
    if (L.joins >= 0) {
      // Pull the last stretch onto the parent's channel at the confluence.
      const p = rivers[L.joins];
      const j = nearestOnChannel(p, north[steps], east[steps]);
      const dn = p.north[j] - north[steps];
      const de = p.east[j] - east[steps];
      // Over a stretch three times the gap (the parent's loop may swing a few hundred metres from its axis), so no kink.
      const span = Math.min(total, Math.max(600, 3 * Math.hypot(dn, de)));
      for (let k = 0; k <= steps; k++) {
        const w = smooth(total - span, total, valleyS[k]);
        north[k] += dn * w;
        east[k] += de * w;
      }
    }
    const count = steps + 1;
    const s = new Float64Array(count);
    const level = new Float64Array(count);
    const halfWidth = new Float64Array(count);
    for (let k = 0; k < count; k++) {
      if (k > 0) s[k] = s[k - 1] + Math.hypot(north[k] - north[k - 1], east[k] - east[k - 1]);
      const lv = sampleAt(a.s, a.level, valleyS[k]);
      level[k] = k === 0 ? lv : Math.min(level[k - 1], lv);
      halfWidth[k] = sampleAt(a.s, a.halfWidth, valleyS[k]);
    }
    rivers.push({ north, east, level, halfWidth, s, valleyS });
  }

  // --- Indexes: every cell lists the segments (line, index) that can reach a point in it.
  const valleyIndex = new SegmentIndex(axes, (li, i) => Math.max(axes[li].floodplain[i], axes[li].floodplain[i + 1]) + Math.max(axes[li].influence[i], axes[li].influence[i + 1]), VALLEY_CELL);
  // One channel index serves both the carving (within the bank) and queryRiver (out to CHANNEL_REACH).
  const channelIndex = new SegmentIndex(rivers, () => CHANNEL_REACH, CHANNEL_CELL);
  const wideIndex = channelIndex;
  const oxbowIndex = new PolylineIndex(oxbows, 200, 100);
  const oxNear: PolylineNear = { line: 0, seg: 0, t: 0, u: 0, dist: Infinity, side: 0 };

  const valleyHits: ValleyNear[] = [];
  const channelHits: ChannelNear[] = [];
  const network: NetworkQuery = {
    valleys(pn, pe, out) {
      return valleyIndex.perLine(pn, pe, (li, i, t, dist, _side, _u, k) => {
        const a = axes[li];
        const o = out[k] ?? (out[k] = { dist: 0, level: 0, floodplain: 0, influence: 0 });
        o.dist = dist;
        o.level = a.level[i] + (a.level[i + 1] - a.level[i]) * t;
        o.floodplain = a.floodplain[i] + (a.floodplain[i + 1] - a.floodplain[i]) * t;
        o.influence = a.influence[i] + (a.influence[i + 1] - a.influence[i]) * t;
        return dist < o.floodplain + o.influence;
      });
    },
    channels(pn, pe, out) {
      return channelIndex.perLine(pn, pe, (li, i, t, dist, side, u, k) => {
        const r = rivers[li];
        const o = out[k] ?? (out[k] = { line: 0, dist: 0, side: 0, level: 0, halfWidth: 0, s: 0, beyondSource: 0 });
        o.line = li;
        o.dist = dist;
        o.side = side;
        o.level = r.level[i] + (r.level[i + 1] - r.level[i]) * t;
        o.halfWidth = r.halfWidth[i] + (r.halfWidth[i + 1] - r.halfWidth[i]) * t;
        o.s = r.s[i] + (r.s[i + 1] - r.s[i]) * t;
        o.beyondSource = i === 0 && u < 0 ? -u * Math.hypot(r.north[1] - r.north[0], r.east[1] - r.east[0]) : 0;
        return dist < o.halfWidth + CHANNEL_MARGIN;
      });
    },
  };

  const queryRiver = (pn: number, pe: number, out: RiverHit): RiverHit => {
    out.dist = Infinity;
    out.side = 0;
    out.beyondSource = 0;
    let best = -1;
    let bestD = Infinity;
    wideIndex.perLine(pn, pe, (li, i, t, dist, side, u) => {
      if (dist < bestD) {
        bestD = dist;
        best = li;
        const r = rivers[li];
        out.dist = dist;
        out.side = side;
        out.level = r.level[i] + (r.level[i + 1] - r.level[i]) * t;
        out.halfWidth = r.halfWidth[i] + (r.halfWidth[i + 1] - r.halfWidth[i]) * t;
        out.s = r.s[i] + (r.s[i + 1] - r.s[i]) * t;
        out.beyondSource = i === 0 && u < 0 ? -u * Math.hypot(r.north[1] - r.north[0], r.east[1] - r.east[0]) : 0;
      }
      return false;
    });
    if (best >= 0 && bestD <= CHANNEL_REACH) return out;
    out.dist = Infinity;
    out.side = 0;
    out.beyondSource = 0;
    // Out of reach of every channel: a distance estimated from the nearest valley axis and its meander belt.
    let vd = Infinity;
    valleyIndex.perLine(pn, pe, (li, i, t, dist) => {
      const a = axes[li];
      const est = Math.max(CHANNEL_REACH, dist - (a.belt[i] + (a.belt[i + 1] - a.belt[i]) * t) - a.halfWidth[i]);
      if (est < vd) {
        vd = est;
        out.dist = est;
        out.level = a.level[i] + (a.level[i + 1] - a.level[i]) * t;
        out.halfWidth = a.halfWidth[i];
        out.s = 0;
      }
      return false;
    });
    return out;
  };
  const queryValley = (pn: number, pe: number, out: ValleyHit): ValleyHit => {
    out.dist = Infinity;
    const k = network.valleys(pn, pe, valleyHits);
    for (let j = 0; j < k; j++) {
      const v = valleyHits[j];
      // The valley that shapes the point most: the one whose floodplain edge is nearest.
      if (out.dist === Infinity || v.dist - v.floodplain < out.dist - out.floodplain) {
        out.dist = v.dist;
        out.level = v.level;
        out.floodplain = v.floodplain;
      }
    }
    return out;
  };
  const queryOxbow = (pn: number, pe: number, out: OxbowHit): OxbowHit => {
    out.dist = Infinity;
    if (!oxbowIndex.nearest(pn, pe, oxNear)) return out;
    const o = oxbows[oxNear.line];
    out.dist = oxNear.dist;
    out.level = o.level;
    out.halfWidth = o.halfWidth;
    out.depth = o.depth;
    return out;
  };
  void channelHits;

  const main = rivers[0] ?? { north: new Float64Array(0), east: new Float64Array(0), level: new Float64Array(0), halfWidth: new Float64Array(0), s: new Float64Array(0) };
  const mainAxis = axes[0];
  return {
    lakes,
    river: { north: main.north, east: main.east, level: main.level, halfWidth: main.halfWidth, s: main.s },
    valley: mainAxis
      ? { north: mainAxis.north, east: mainAxis.east, level: mainAxis.level, floodplain: mainAxis.floodplain, s: mainAxis.s }
      : { north: new Float64Array(0), east: new Float64Array(0), level: new Float64Array(0), floodplain: new Float64Array(0), s: new Float64Array(0) },
    oxbows,
    rivers: rivers.map((r, li) => ({ north: r.north, east: r.east, level: r.level, halfWidth: r.halfWidth, s: r.s, joins: lines[li].joins })),
    network,
    queryRiver,
    queryValley,
    queryOxbow,
  };
}

/** Courses keep this far from the home runway's centreline segment, m (the meander belt then still clears it). */
const RUNWAY_CLEAR = 2500;
const RW_HALF = AIRPORT.runway.length / 2;
const RW_C = Math.cos(AIRPORT.runway.heading);
const RW_S = Math.sin(AIRPORT.runway.heading);

/** Distance from the home runway's centreline segment, m. */
function runwayDistance(pn: number, pe: number): number {
  const c = AIRPORT.runway.center;
  const dn = pn - c.north;
  const de = pe - c.east;
  const along = Math.max(-RW_HALF, Math.min(RW_HALF, dn * RW_C + de * RW_S));
  return Math.hypot(dn - along * RW_C, de - along * RW_S);
}

/** Push course points lying near the home runway out to RUNWAY_CLEAR from it (in place). */
function clearOfRunway(n: number[], e: number[]): void {
  const c = AIRPORT.runway.center;
  for (let i = 0; i < n.length; i++) {
    const dn = n[i] - c.north;
    const de = e[i] - c.east;
    const along = Math.max(-RW_HALF, Math.min(RW_HALF, dn * RW_C + de * RW_S));
    const qn = dn - along * RW_C;
    const qe = de - along * RW_S;
    const d = Math.hypot(qn, qe);
    if (d >= RUNWAY_CLEAR) continue;
    // Straight out from the runway (across it, or off its end); a point on the centreline goes to the right.
    const un = d > 1 ? qn / d : -RW_S;
    const ue = d > 1 ? qe / d : RW_C;
    n[i] = c.north + along * RW_C + un * RUNWAY_CLEAR;
    e[i] = c.east + along * RW_S + ue * RUNWAY_CLEAR;
  }
}

const clampUnit = (x: number): number => Math.min(1, Math.max(0, x));

/** Bessel J0 (series; |x| < 2.5): the ratio of valley length to channel length of a sine-generated curve. */
const besselJ0 = (x: number): number => {
  const q = (x * x) / 4;
  return 1 - q + (q * q) / 4 - (q * q * q) / 36 + (q * q * q * q) / 576;
};

/**
 * The channel about a valley axis as a sine-generated curve (Langbein & Leopold): its direction swings about the
 * axis's as omega sin(phi), with the Kinoshita third harmonic for the skewed, flattened loops of real meanders. Big
 * lowland rivers (meander near 1) swing up to ~115 degrees and form horseshoe loops; streams wiggle at 0.5 rad. Marched in
 * the axis frame (along, offset), steered back if it drifts outside the belt.
 */
function sineGenerated(a: Axis, phase0: number): { north: number[]; east: number[]; valleyS: number[]; off: number[] } {
  const total = a.s[a.s.length - 1];
  const n: number[] = [];
  const e: number[] = [];
  const vs: number[] = [];
  const os: number[] = [];
  let along = 0;
  let off = 0;
  let phi = phase0;
  const put = (sv: number, y: number): void => {
    const i = segmentAt(a.s, sv);
    const t = Math.min(1, Math.max(0, (sv - a.s[i]) / Math.max(1e-9, a.s[i + 1] - a.s[i])));
    const tn = a.north[i + 1] - a.north[i];
    const te = a.east[i + 1] - a.east[i];
    const tl = Math.hypot(tn, te) || 1;
    // Offset to the left of the flow (as the old offset meanders), which side does not matter.
    n.push(a.north[i] + tn * t - (te / tl) * y);
    e.push(a.east[i] + te * t + (tn / tl) * y);
    vs.push(sv);
    os.push(y);
  };
  put(0, 0);
  // A bound on the march: the channel is at most a few times longer than its valley.
  const maxSteps = Math.ceil((total / 15) * 12) + 200;
  for (let guard = 0; along < total && guard < maxSteps; guard++) {
    const sv = Math.min(total, Math.max(0, along));
    const i = segmentAt(a.s, sv);
    const m = a.meander[i];
    const lambda = a.wavelength[i];
    const belt = a.belt[i];
    // Loop to loop: the swing and the loop length vary, so no two bends are alike.
    const omega = Math.min(2, (0.5 + 1.5 * m) * (0.85 + 0.3 * gnoise(along / (1.7 * lambda) + phase0 * 13.1, 4.4)));
    let theta = omega * Math.sin(phi) + omega * omega * omega * (Math.sin(3 * phi) / 32 - Math.cos(3 * phi) / 192);
    // Keep within the belt: steer back in proportion to the drift, firmly once past the belt's edge.
    const drift = off / Math.max(1, belt);
    theta -= 0.35 * drift + 2 * Math.max(0, Math.abs(drift) - 1) * Math.sign(drift);
    // Outside the belt it heads back across the valley but always downstream (a steer that turned it upstream could
    // circle without ever reaching the end of the river).
    const lim = Math.abs(drift) > 1 ? 1.2 : 2.15;
    theta = Math.max(-lim, Math.min(lim, theta));
    const ds = Math.min(40, Math.max(15, lambda / 10));
    along += Math.cos(theta) * ds;
    off += Math.sin(theta) * ds;
    // The channel's own wavelength is longer than the valley's by the sinuosity 1/J0(omega).
    phi += ((2 * Math.PI * ds * Math.max(0.25, besselJ0(omega))) / lambda) * (1 + 0.45 * gnoise(along / (0.9 * lambda) - phase0 * 7.7, 1.3));
    // The end of the line: back onto the axis over the last few samples.
    if (along >= total) {
      put(total, 0);
      break;
    }
    put(Math.max(0, along), off);
  }
  // Not expected: had it stalled, close the gap along the axis rather than with one straight jump.
  if (vs[vs.length - 1] < total) {
    const from = Math.max(0, vs[vs.length - 1]);
    const y0 = os[os.length - 1];
    const k = Math.max(1, Math.ceil((total - from) / 40));
    for (let j = 1; j <= k; j++) put(from + ((total - from) * j) / k, y0 * (1 - j / k));
  }
  return { north: n, east: e, valleyS: vs, off: os };
}

/** An oxbow cut off by cutOffLoops: the abandoned loop's centreline, where it lies along the valley, and its age. */
interface CutLoop {
  north: Float64Array;
  east: Float64Array;
  valleyS: number;
  halfWidth: number;
  age: number;
}

/**
 * Neck cutoffs: on the strongly meandering stretches some of the widest loops are abandoned - the channel runs
 * straight across the loop's neck and the loop is left as an oxbow lake beside it, trimmed clear of the new channel.
 * Edits the channel in place; returns the oxbows.
 */
function cutOffLoops(ch: { north: number[]; east: number[]; valleyS: number[]; off: number[] }, a: Axis, li: number): CutLoop[] {
  const out: CutLoop[] = [];
  const { north, east, valleyS, off } = ch;
  let k0 = 0;
  let lastCut = -Infinity;
  let loop = 0;
  for (let k = 1; k < off.length; k++) {
    if (Math.sign(off[k]) === Math.sign(off[k - 1]) || off[k - 1] === 0) continue;
    // A loop between two crossings of the axis: [k0, k].
    const k1 = k;
    const from = k0;
    k0 = k;
    loop++;
    if (k1 - from < 6) continue;
    const i = segmentAt(a.s, valleyS[from]);
    if (a.meander[i] < 0.55) continue;
    let apex = 0;
    for (let j = from; j <= k1; j++) apex = Math.max(apex, Math.abs(off[j]));
    if (apex < 0.6 * a.belt[i]) continue;
    // Roughly one loop in five goes, none within 2.5 km of the last cutoff along the valley.
    if ((hash2i(li * 7919 + loop, 0x0b0) & 0xff) > 52 || valleyS[from] - lastCut < 2500) continue;
    const hw = a.halfWidth[i];
    // The loop's crescent, clear of the chord the channel now takes.
    const cn = north[from];
    const ce = east[from];
    const dn = north[k1] - cn;
    const de = east[k1] - ce;
    const l2 = dn * dn + de * de || 1;
    const clear = 2 * hw + CHANNEL_BANK + 15;
    const on: number[] = [];
    const oe: number[] = [];
    for (let j = from; j <= k1; j++) {
      const u = Math.min(1, Math.max(0, ((north[j] - cn) * dn + (east[j] - ce) * de) / l2));
      if (Math.hypot(north[j] - cn - dn * u, east[j] - ce - de * u) > clear) {
        on.push(north[j]);
        oe.push(east[j]);
      }
    }
    if (on.length < 5) continue;
    out.push({ north: Float64Array.from(on), east: Float64Array.from(oe), valleyS: valleyS[(from + k1) >> 1], halfWidth: hw, age: (hash2i(li, loop) & 0xffff) / 65536 });
    // The channel across the neck: straight from crossing to crossing.
    for (let j = from + 1; j < k1; j++) {
      const t = (j - from) / (k1 - from);
      north[j] = cn + dn * t;
      east[j] = ce + de * t;
      valleyS[j] = valleyS[from] + (valleyS[k1] - valleyS[from]) * t;
      off[j] = 0;
    }
    lastCut = valleyS[k1];
  }
  return out;
}

/** Catmull-Rom through the points at about `spacing`; `t` is each sample's fractional index into the points. */
function catmullRom(pn: number[], pe: number[], spacing: number): { n: number[]; e: number[]; t: number[] } {
  const n: number[] = [];
  const e: number[] = [];
  const t: number[] = [];
  const m = pn.length;
  if (m === 1) return { n: [pn[0], pn[0]], e: [pe[0], pe[0] + 1], t: [0, 0] };
  for (let i = 0; i < m - 1; i++) {
    const i0 = Math.max(0, i - 1);
    const i3 = Math.min(m - 1, i + 2);
    const seg = Math.hypot(pn[i + 1] - pn[i], pe[i + 1] - pe[i]);
    const steps = Math.max(1, Math.ceil(seg / spacing));
    for (let k = 0; k < steps; k++) {
      const u = k / steps;
      const u2 = u * u;
      const u3 = u2 * u;
      const cr = (a: number, b: number, c: number, d: number): number => 0.5 * (2 * b + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u2 + (-a + 3 * b - 3 * c + d) * u3);
      n.push(cr(pn[i0], pn[i], pn[i + 1], pn[i3]));
      e.push(cr(pe[i0], pe[i], pe[i + 1], pe[i3]));
      t.push(i + u);
    }
  }
  n.push(pn[m - 1]);
  e.push(pe[m - 1]);
  t.push(m - 1);
  return { n, e, t };
}

/** Index of the segment containing arc length sv (clamped). */
function segmentAt(s: Float64Array, sv: number): number {
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

/** Linear interpolation of arr at arc length sv. */
function sampleAt(s: Float64Array, arr: Float64Array, sv: number): number {
  if (s.length === 1) return arr[0];
  const i = segmentAt(s, sv);
  const t = Math.min(1, Math.max(0, (sv - s[i]) / Math.max(1e-9, s[i + 1] - s[i])));
  return arr[i] + (arr[i + 1] - arr[i]) * t;
}

function nearestIndex(a: { north: Float64Array; east: Float64Array }, pn: number, pe: number): number {
  let best = 0;
  let bd = Infinity;
  for (let i = 0; i < a.north.length; i++) {
    const d = (a.north[i] - pn) ** 2 + (a.east[i] - pe) ** 2;
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return best;
}
const nearestOnChannel = nearestIndex;

/**
 * Spatial index over many polylines with a reach per segment: each cell lists (line, segment) pairs whose reach
 * covers some of the cell. perLine visits, for every line listed at a point, its nearest segment.
 */
class SegmentIndex {
  private readonly cells = new Map<number, Int32Array>();
  private readonly bestD: Float64Array;
  private readonly bestSeg: Int32Array;
  private readonly bestT: Float64Array;
  private readonly bestU: Float64Array;
  private readonly stamp: Int32Array;
  private readonly touched: Int32Array;
  private tick = 0;
  constructor(private readonly lines: ReadonlyArray<{ north: Float64Array; east: Float64Array }>, reach: (line: number, seg: number) => number, private readonly cell: number) {
    const lists = new Map<number, number[]>();
    lines.forEach((l, li) => {
      for (let i = 0; i < l.north.length - 1; i++) {
        const r = reach(li, i);
        const n0 = Math.floor((Math.min(l.north[i], l.north[i + 1]) - r) / cell);
        const n1 = Math.floor((Math.max(l.north[i], l.north[i + 1]) + r) / cell);
        const e0 = Math.floor((Math.min(l.east[i], l.east[i + 1]) - r) / cell);
        const e1 = Math.floor((Math.max(l.east[i], l.east[i + 1]) + r) / cell);
        for (let cx = n0; cx <= n1; cx++)
          for (let cy = e0; cy <= e1; cy++) {
            const k = (cx + 32768) * 65536 + (cy + 32768);
            let list = lists.get(k);
            if (!list) lists.set(k, (list = []));
            list.push(li, i);
          }
      }
    });
    for (const [k, list] of lists) this.cells.set(k, Int32Array.from(list));
    const L = lines.length;
    this.bestD = new Float64Array(L);
    this.bestSeg = new Int32Array(L);
    this.bestT = new Float64Array(L);
    this.bestU = new Float64Array(L);
    this.stamp = new Int32Array(L);
    this.touched = new Int32Array(L);
  }

  /**
   * For every line listed at the point, call f with its nearest segment, the clamped and unclamped parameter, the
   * distance and the side (+1 right of the flow); f returns whether to count it (k is the running count). Returns the count.
   */
  perLine(pn: number, pe: number, f: (line: number, seg: number, t: number, dist: number, side: number, u: number, k: number) => boolean): number {
    const list = this.cells.get((Math.floor(pn / this.cell) + 32768) * 65536 + (Math.floor(pe / this.cell) + 32768));
    if (!list) return 0;
    const tick = ++this.tick;
    let nt = 0;
    for (let k = 0; k < list.length; k += 2) {
      const li = list[k];
      const i = list[k + 1];
      const l = this.lines[li];
      const an = l.north[i];
      const ae = l.east[i];
      const dn = l.north[i + 1] - an;
      const de = l.east[i + 1] - ae;
      const l2 = dn * dn + de * de;
      const u = l2 > 0 ? ((pn - an) * dn + (pe - ae) * de) / l2 : 0;
      const t = u < 0 ? 0 : u > 1 ? 1 : u;
      const qn = an + dn * t - pn;
      const qe = ae + de * t - pe;
      const d2 = qn * qn + qe * qe;
      if (this.stamp[li] !== tick) {
        this.stamp[li] = tick;
        this.touched[nt++] = li;
        this.bestD[li] = Infinity;
      }
      if (d2 < this.bestD[li]) {
        this.bestD[li] = d2;
        this.bestSeg[li] = i;
        this.bestT[li] = t;
        this.bestU[li] = u;
      }
    }
    let count = 0;
    for (let j = 0; j < nt; j++) {
      const li = this.touched[j];
      const i = this.bestSeg[li];
      const l = this.lines[li];
      const dn = l.north[i + 1] - l.north[i];
      const de = l.east[i + 1] - l.east[i];
      const side = dn * (pe - l.east[i]) - de * (pn - l.north[i]) >= 0 ? 1 : -1;
      if (f(li, i, this.bestT[li], Math.sqrt(this.bestD[li]), side, this.bestU[li], count)) count++;
    }
    return count;
  }
}
