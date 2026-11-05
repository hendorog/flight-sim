// A seeded world's rivers and lakes (any seed but 0), built from its drainage (drainage.ts) at load in every thread.
// Seed 0 keeps the hand-placed river and lakes of hydrology.ts.
//
// Each drainage line becomes a river: its 1 km lattice course jittered and smoothed into a valley axis, its width from
// the catchment area, the big lowland rivers swung into meanders about the axis (a skewed sine whose wavelength
// follows the width, so no growth simulation has to run at load), and its water level falling from the source,
// meeting the river it joins at the confluence and lying level through any lake on its course. Lakes are the ponds
// the drainage leaves behind its breach cuts (drainage.ts LakeMask: the water covers the ground below the pond's level
// across its lattice cells); ellipses fitted to them place what goes by a lake.

import { fbm, hash2i, gnoise } from './noise';
import { LAKE_ZONE, PolylineIndex, CHANNEL_BANK, type PolylineNear, type ChannelNear, type Hydrology, type Lake, type NetworkQuery, type OxbowHit, type RiverHit, type RiverLine, type ValleyHit, type ValleyNear } from './hydrology';
import { cellEast, cellNorth, DRAIN_CELL, LAKE_RASTER, type Drainage, type LakeMask } from './drainage';
import { AIRPORT } from '../../core/world';

/** A loop is cut off when its neck has closed to this fraction of the meander length (or a few channel widths). */
const NECK_FACTOR = 0.22;
/** Oxbow water stands this far above the river level of its valley section, m (as hydrology.ts). */
const OXBOW_LEVEL = 0.6;
/** Amplitude of the courses' wander off the lattice, m: a broad one (6 km) and a shorter one (2.5 km) that bends the
 * straight runs drainage takes down even slopes. */
const WANDER = 900;
const WANDER_SHORT = 350;
/** In a valley the erosion pass cut deeper than PIN_CUT[1], m, a course wanders this fraction of WANDER, WANDER_SHORT
 * and the jitter (all of them shallower than PIN_CUT[0]). */
const PINNED_WANDER = 0.15;
const PIN_CUT = [20, 80];
/** Past a lake's outlet the river keeps the lake's level over this stretch, m (while its banks stand over it). */
const OUTLET_RUN = 800;
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

/**
 * The lakes of a seeded world, as Lake records for what places things by a lake (landmarks, sites, habitat, airfield
 * siting): an ellipse fitted to the water of each pond's main pool (drainage.ts LakeMask, its wet raster points), centred
 * on that water's centroid and sized by its spread about the same point (a uniform ellipse of semi-axis a has a spread of
 * a / 2 along it), at its level. The water itself is the LakeMask; these ellipses are not carved into the terrain. A
 * pond the flood left no water in has none.
 */
export function networkLakes(d: Drainage, mask: LakeMask): Lake[] {
  const out: Lake[] = [];
  for (let k = 0; k < d.lakes.length; k++) {
    const id = mask.main[k];
    if (id < 0) continue;
    const p = mask.pools[id];
    // Each wet raster point stands for a square LAKE_RASTER a side: add its own spread so a one-row lake has width.
    const snn = p.snn + (LAKE_RASTER * LAKE_RASTER) / 12;
    const see = p.see + (LAKE_RASTER * LAKE_RASTER) / 12;
    const sne = p.sne;
    const tr = snn + see;
    const det = snn * see - sne * sne;
    const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
    const l1 = tr / 2 + disc;
    const l2 = Math.max(1, tr / 2 - disc);
    const radiusA = Math.max(150, 2 * Math.sqrt(l1));
    const radiusB = Math.max(120, 2 * Math.sqrt(l2));
    out.push({
      north: p.north,
      east: p.east,
      radiusA,
      radiusB,
      rotation: 0.5 * Math.atan2(2 * sne, snn - see),
      depth: Math.min(40, Math.max(4, (p.level - p.bottom) * 0.6)),
      level: p.level,
      bound: Math.max(radiusA, radiusB) * LAKE_ZONE * 1.35,
    });
  }
  return out;
}

/** Build a seeded world's hydrology from its drainage and lakes. */
export function buildNetworkHydrology(natural: (north: number, east: number) => number, d: Drainage, lakes: Lake[], mask: LakeMask, valleyCut?: Float32Array): Hydrology {
  const lines = d.lines;
  // How freely a course may wander off its lattice cells (1) or keeps to them (PINNED_WANDER): a valley the erosion
  // pass cut (erosion.ts, `valleyCut` per cell, <= 0) is the river's own, and its floor lies along the lattice path; a
  // course wandering a kilometre off it would ride up the valley side (its level held far under the ground there,
  // its meanders swinging back down onto a floor below its water).
  const free = (c: number): number => (valleyCut ? 1 - (1 - PINNED_WANDER) * smooth(PIN_CUT[0], PIN_CUT[1], -valleyCut[c]) : 1);
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
    const wn = (c: number, i: number): number => {
      const pn = cellNorth(d, c);
      const pe = cellEast(d, c);
      return pn + fade(i) * free(c) * (WANDER * fbm(pn / 6000 + 3.7, pe / 6000 - 1.9, 3) + jitter(c, 0));
    };
    const we = (c: number, i: number): number => {
      const pn = cellNorth(d, c);
      const pe = cellEast(d, c);
      return pe + fade(i) * free(c) * (WANDER * fbm(pn / 6000 - 8.1, pe / 6000 + 5.3, 3) + jitter(c, 1));
    };
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
  // First each line's own course and water level (the running minimum of the ground), then the confluences, then
  // the rest of each valley from its final level.
  const pre: Array<{ north: Float64Array; east: Float64Array; s: Float64Array; area: Float64Array; level: Float64Array; wet: Uint8Array }> = [];
  for (let li = 0; li < lines.length; li++) {
    const L = lines[li];
    const c = courses[li];
    const pts = catmullRom(c.n, c.e, AXIS_SPACING);
    // The shorter wander, on the dense axis (on the 1 km lattice points the smoothing would erase it): a warp of the
    // plane, so a confluence shared by two lines moves alike for both; none at a mouth on the sea.
    const last = pts.n.length - 1;
    const cells = L.cells;
    for (let i = 0; i <= last; i++) {
      const u = pts.t[i];
      const k = Math.max(0, Math.min(cells.length - 2, Math.floor(u)));
      const f = cells.length < 2 ? free(cells[0]) : free(cells[k]) + (free(cells[k + 1]) - free(cells[k])) * (u - k);
      const w = f * (L.joins >= 0 ? 1 : Math.min(1, ((last - i) * AXIS_SPACING) / 1500));
      const pn = pts.n[i];
      const pe = pts.e[i];
      pts.n[i] = pn + w * WANDER_SHORT * gnoise(pn / 2500 - 6.2, pe / 2500 + 0.9);
      pts.e[i] = pe + w * WANDER_SHORT * gnoise(pn / 2500 + 4.4, pe / 2500 - 7.3);
    }
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
      // A sample in a lake counts as a bank over its water (by a lake's outlet the side samples fall in the lake: the
      // river leaving it runs on at its level, not dropped below it).
      const at = (pn: number, pe: number): number => Math.max(natural(pn, pe), mask.at(pn, pe) + 2.5);
      ground[i] = Math.min(at(north[i], east[i]), at(north[i] + qn, east[i] + qe), at(north[i] - qn, east[i] - qe));
    }
    for (let i = 1; i < count - 1; i += 2) ground[i] = Math.min(ground[i - 1], ground[i + 1]);
    const level = new Float64Array(count);
    const wet = new Uint8Array(count);
    let run = Infinity;
    // The lake at each point (-Infinity: none), and the next one downstream: its level and where the river reaches it.
    const lakeAt = new Float64Array(count);
    for (let i = 0; i < count; i++) lakeAt[i] = mask.at(north[i], east[i]);
    const next = new Float64Array(count).fill(-Infinity);
    const nextAt = new Float64Array(count);
    for (let i = count - 2; i >= 0; i--) {
      if (lakeAt[i + 1] > -Infinity) (next[i] = lakeAt[i + 1]), (nextAt[i] = s[i + 1]);
      else (next[i] = next[i + 1]), (nextAt[i] = nextAt[i + 1]);
    }
    // The last lake the river ran through: its level and where the river left it.
    let left = -Infinity;
    let leftAt = 0;
    for (let i = 0; i < count; i++) {
      const lake = lakeAt[i];
      if (lake > -Infinity) {
        run = lake;
        wet[i] = 1;
        left = lake;
        leftAt = s[i];
      } else {
        // Past a lake's outlet the river runs on at its level while the banks stand over it (a few decimetres), only
        // dropping its usual depth under them over the next OUTLET_RUN m: no step down from the lake to the river.
        // Likewise into a lake: a river reaching one comes in at its level, not under it.
        const out = left > -Infinity ? 1 - smooth(OUTLET_RUN * 0.5, OUTLET_RUN, s[i] - leftAt) : 0;
        const inn = next[i] > -Infinity ? 1 - smooth(OUTLET_RUN * 0.5, OUTLET_RUN, nextAt[i] - s[i]) : 0;
        let cand = ground[i] - 2.5;
        if (out > 0) cand = Math.max(cand, Math.min(left, ground[i] - 0.3) * out + (ground[i] - 2.5) * (1 - out));
        if (inn > 0) cand = Math.max(cand, Math.min(next[i], ground[i] - 0.3) * inn + (ground[i] - 2.5) * (1 - inn));
        run = i === 0 ? cand : Math.min(run - 0.00025 * (s[i] - s[i - 1]), cand);
      }
      level[i] = Math.max(0, run);
    }
    pre.push({ north, east, s, area, level, wet });
  }
  // --- Confluences. A tributary that arrives lower than the river it joins has cut down through a rim (it drains a
  // closed basin the routing filled: a big hollow is not a lake, drainage.ts): the river it joins cuts down with it
  // below the confluence - a gorge - rather than the tributary being held up at the rim, hundreds of metres over its
  // own valley floor. Tributaries first (they come after the lines they join), so a cut carries on down the network.
  for (let li = lines.length - 1; li >= 0; li--) {
    const L = lines[li];
    if (L.joins < 0) continue;
    const c = pre[li];
    const p = pre[L.joins];
    const mouth = c.level[c.level.length - 1];
    // A lake below the confluence holds its own level: the cut ends at its shore.
    for (let i = nearestIndex(p, c.north[c.north.length - 1], c.east[c.east.length - 1]); i < p.level.length && !p.wet[i]; i++) p.level[i] = Math.min(p.level[i], mouth);
  }
  for (let li = 0; li < lines.length; li++) {
    const L = lines[li];
    const { north, east, s, area, level, wet } = pre[li];
    const count = north.length;
    if (L.joins >= 0) {
      const p = axes[L.joins];
      const at = p.s[nearestIndex(p, north[count - 1], east[count - 1])];
      const lj = sampleAt(p.s, p.level, at);
      for (let i = 0; i < count; i++) level[i] = Math.max(level[i], lj);
      level[count - 1] = lj;
    }
    // No cliffs: a small stream may fall steeply, a big river at most MAX_GRADIENT (the drop is spread upstream).
    // A lake holds its level: the drop below its outlet stays there (rapids, a fall), not spread up through the lake.
    for (let i = count - 2; i >= 0; i--) {
      if (wet[i]) continue;
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
      // None across a lake (its water hides the course; the loops would only cost time).
      const mFree = (1 - wet[i]) * lowland * big * tail * clampUnit(0.8 + 0.4 * gnoise(s[i] / 5200 + li * 7.31, 2.7 + li));
      const m = mFree * nearField;
      meander[i] = m;
      // Meander wavelength about 18 channel widths (the long end of Leopold & Wolman's range: broad loops, as seed 0's
      // river has), varied along the river.
      wavelength[i] = Math.max(160, 36 * hw) * (0.85 + 0.3 * gnoise(s[i] / 3000 + li * 3.3, 9.1));
      // Half-width of the belt the channel swings across (meanderChannel keeps the channel inside it).
      belt[i] = wavelength[i] * (0.06 + 0.55 * m);
      // The floodplain keeps the width the free meanders would need, so it does not pinch where they are held in.
      const freeBelt = wavelength[i] * (0.06 + 0.55 * mFree);
      floodplain[i] = freeBelt + hw + CHANNEL_BANK + 4 * hw * Math.min(1, freeBelt / 200);
      influence[i] = 500 + 1900 * smooth(30, 2000, area[i]);
    }
    // The floodplain's width changes only gradually along the river: inside a bend the nearest axis point jumps from
    // one stretch to another, and two different widths there would leave a step in the valley wall.
    smoothAlong(floodplain, Math.ceil(1500 / AXIS_SPACING), 3);
    confineBelt(natural, north, east, level, belt, wavelength);
    axes.push({ north, east, s, area, level, halfWidth, belt, meander, wavelength, floodplain, influence });
  }

  // --- Channels: meandering curves about the axis (Ferguson's disturbed periodic model), some loops cut off as oxbows; a tributary's end on its parent's channel.
  const rivers: Array<RiverLine & { valleyS: Float64Array }> = [];
  const oxbows: Array<{ north: Float64Array; east: Float64Array; level: number; halfWidth: number; depth: number }> = [];
  for (let li = 0; li < lines.length; li++) {
    const a = axes[li];
    const total = a.s[a.s.length - 1];
    const ch = meanderChannel(a, (hash2i(li, 0x3ea) & 0xffff) / 65536 * Math.PI * 2);
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
    const north = ch.north;
    const east = ch.east;
    const valleyS = ch.valleyS;
    let steps = north.length - 1;
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
    // Nothing may cross itself: a curl the pull onto the parent (or a loop the cutoffs missed) folds in is cut out.
    untangle(north, east, valleyS);
    steps = north.length - 1;
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
    rivers.push({ north: Float64Array.from(north), east: Float64Array.from(east), level, halfWidth, s, valleyS: Float64Array.from(valleyS) });
  }

  // --- Indexes: every cell lists the segments (line, index) that can reach a point in it.
  // Each axis segment is listed out to the largest reach of the segments near it along the river: the query takes a
  // line's nearest listed segment, so a nearer one left unlisted (a smaller reach) would put a seam at a cell edge.
  const valleyReach = axes.map((a) => {
    const m = a.north.length;
    const own = new Float64Array(m);
    for (let i = 0; i < m; i++) own[i] = a.floodplain[i] + a.influence[i];
    const out = new Float64Array(m);
    const W = Math.ceil(4000 / AXIS_SPACING);
    // Sliding-window maximum (monotone deque) over +-W samples.
    const dq: number[] = [];
    for (let i = 0, j = 0; i < m; i++) {
      for (; j < m && j <= i + W; j++) {
        while (dq.length && own[dq[dq.length - 1]] <= own[j]) dq.pop();
        dq.push(j);
      }
      while (dq[0] < i - W) dq.shift();
      out[i] = own[dq[0]];
    }
    return out;
  });
  const valleyIndex = new SegmentIndex(axes, (li, i) => Math.max(valleyReach[li][i], valleyReach[li][i + 1]), VALLEY_CELL);
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
    lakeMask: mask,
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

/** Distance from the home runway's centreline segment, m. */
function runwayDistance(pn: number, pe: number): number {
  const c = AIRPORT.runway.center;
  const RW_C = Math.cos(AIRPORT.runway.heading);
  const RW_S = Math.sin(AIRPORT.runway.heading);
  const dn = pn - c.north;
  const de = pe - c.east;
  const along = Math.max(-RW_HALF, Math.min(RW_HALF, dn * RW_C + de * RW_S));
  return Math.hypot(dn - along * RW_C, de - along * RW_S);
}

/** Push course points lying near the home runway out to RUNWAY_CLEAR from it (in place). */
function clearOfRunway(n: number[], e: number[]): void {
  const c = AIRPORT.runway.center;
  const RW_C = Math.cos(AIRPORT.runway.heading);
  const RW_S = Math.sin(AIRPORT.runway.heading);
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

/** Box-filter arr in place over +-half samples, `passes` times (ends shortened, never padded). */
/**
 * Meanders stay on ground over the water: where the ground a loop could reach (half the belt and the whole belt out to
 * either side of the axis) lies under the river's level - a lower valley beside it, the floor of a valley the erosion
 * pass cut (erosion.ts) that the axis runs above - the belt narrows to the reach still over the water, so the loops
 * keep to the valley floor and do not swing out over lower ground with the water standing above it. Checked every
 * CONFINE_EVERY axis points where the belt is wide; the narrowed belt is spread along the river (the lowest of the
 * neighbouring checks), so it changes gradually.
 */
function confineBelt(natural: (north: number, east: number) => number, north: Float64Array, east: Float64Array, level: Float64Array, belt: Float64Array, wavelength: Float64Array): void {
  const count = north.length;
  const limit: number[] = [];
  for (let i = 0; i < count; i += CONFINE_EVERY) {
    const b = belt[i];
    if (b < CONFINE_MIN) {
      limit.push(Infinity);
      continue;
    }
    const i0 = Math.max(0, i - 1);
    const i1 = Math.min(count - 1, i + 1);
    const tl = Math.hypot(north[i1] - north[i0], east[i1] - east[i0]) || 1;
    const un = -(east[i1] - east[i0]) / tl;
    const ue = (north[i1] - north[i0]) / tl;
    const floor = level[i] + 1;
    // The widest of the tested reaches with ground over the water on both sides.
    let ok = Infinity;
    for (const f of [0.5, 1]) {
      const r = b * f;
      if (natural(north[i] + un * r, east[i] + ue * r) < floor || natural(north[i] - un * r, east[i] - ue * r) < floor) {
        ok = f === 0.5 ? Math.max(CONFINE_MIN * 0.5, wavelength[i] * 0.06) : b * 0.5;
        break;
      }
    }
    limit.push(ok);
  }
  // Each point takes the lowest limit of the checks either side of it.
  for (let i = 0; i < count; i++) {
    const k = Math.floor(i / CONFINE_EVERY);
    const lim = Math.min(limit[k], limit[Math.min(limit.length - 1, k + 1)], limit[Math.max(0, k - 1)]);
    if (lim < belt[i]) belt[i] = lim;
  }
}
/** confineBelt's checks: every this many axis points, where the belt is at least CONFINE_MIN, m. */
const CONFINE_EVERY = 4;
const CONFINE_MIN = 150;

function smoothAlong(arr: Float64Array, half: number, passes: number): void {
  const m = arr.length;
  const tmp = new Float64Array(m);
  for (let p = 0; p < passes; p++) {
    let sum = 0;
    let lo = 0;
    let hi = -1;
    for (let i = 0; i < m; i++) {
      while (hi < Math.min(m - 1, i + half)) sum += arr[++hi];
      while (lo < i - half) sum -= arr[lo++];
      tmp[i] = sum / (hi - lo + 1);
    }
    arr.set(tmp);
  }
}

/** Bessel J0 (series; |x| < 2.5): the ratio of valley length to channel length of a sine-generated curve. */
const besselJ0 = (x: number): number => {
  const q = (x * x) / 4;
  return 1 - q + (q * q) / 4 - (q * q * q) / 36 + (q * q * q * q) / 576;
};

/**
 * The channel about a valley axis (Ferguson 1976, the disturbed periodic model): its direction relative to the axis
 * follows a damped oscillator at the meander length driven by random disturbances, so the loops vary in size,
 * length and lean from one to the next. Big lowland rivers (meander near 1) swing widely enough for horseshoe loops;
 * streams wander a little. Marched in the axis frame (along, offset), steered back if it drifts outside the belt.
 */
function meanderChannel(a: Axis, phase0: number): { north: number[]; east: number[]; valleyS: number[]; off: number[] } {
  const total = a.s[a.s.length - 1];
  const n: number[] = [];
  const e: number[] = [];
  const vs: number[] = [];
  const os: number[] = [];
  let along = 0;
  let off = 0;
  // Ferguson's disturbed periodic model: the channel's direction (relative to the valley) is a damped oscillator at
  // the meander length, driven by random disturbances - an AR(2) process step by step. Its loops come in all sizes,
  // lean either way and now and then double up, as real ones do; the damping wanders along the river, so some
  // reaches swing regularly and others are confused.
  let th1 = 0;
  let th2 = 0;
  const seed = Math.floor(phase0 * 1e6) | 0;
  let step = 0;
  const put = (sv: number, y: number): void => {
    const i = segmentAt(a.s, sv);
    const t = Math.min(1, Math.max(0, (sv - a.s[i]) / Math.max(1e-9, a.s[i + 1] - a.s[i])));
    const tn = a.north[i + 1] - a.north[i];
    const te = a.east[i + 1] - a.east[i];
    const tl = Math.hypot(tn, te) || 1;
    // Offset to the left of the flow, which side does not matter.
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
    const ds = Math.min(40, Math.max(15, lambda / 10));
    // How far it swings (the spread of the direction, as a sine of amplitude omega would have) and how orderly.
    const omega = Math.min(2, 0.5 + 1.5 * m);
    const damping = 0.22 + 0.3 * clampUnit(0.5 + 0.9 * gnoise(along / (4 * lambda) + phase0 * 13.1, 4.4));
    // The oscillator's period is the meander length measured along the channel: the valley's, times the sinuosity.
    const k = (2 * Math.PI * Math.max(0.25, besselJ0(omega))) / lambda;
    const z = k * ds;
    const r = Math.exp(-damping * z);
    const a1 = 2 * r * Math.cos(z * Math.sqrt(1 - damping * damping));
    const a2 = -r * r;
    // Noise scaled so the process's stationary spread is omega / sqrt(2).
    const sigma = (omega / Math.SQRT2) * Math.sqrt(Math.max(1e-9, ((1 + a2) * ((1 - a2) * (1 - a2) - a1 * a1)) / (1 - a2)));
    let q = 0;
    for (let j = 0; j < 4; j++) q += (hash2i(seed + j * 7919, step) & 0xffff) / 65536;
    step++;
    const eps = (q - 2) * Math.sqrt(3);
    const th = a1 * th1 + a2 * th2 + sigma * eps;
    th2 = th1;
    th1 = Math.max(-2.3, Math.min(2.3, th));
    // Keep within the belt: steer back in proportion to the drift, firmly once past the belt's edge.
    const drift = off / Math.max(1, belt);
    let theta = th1 - 0.22 * drift - 2 * Math.max(0, Math.abs(drift) - 1) * Math.sign(drift);
    // Outside the belt it heads back across the valley but always downstream (a steer that turned it upstream could
    // circle without ever reaching the end of the river).
    const lim = Math.abs(drift) > 1 ? 1.2 : 2;
    theta = Math.max(-lim, Math.min(lim, theta));
    along += Math.cos(theta) * ds;
    off += Math.sin(theta) * ds;
    // The end of the line: back onto the axis.
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

/**
 * Cut every loop where the polyline crosses itself (in place): the points between the two crossing segments go, and
 * the crossing point joins them. Segments are found through a 200 m grid, so a long channel costs little.
 */
function untangle(n: number[], e: number[], vs: number[]): void {
  const CELL = 200;
  for (let pass = 0; pass < 8; pass++) {
    const grid = new Map<number, number[]>();
    const key = (a: number, b: number): number => (Math.floor(a / CELL) + 32768) * 65536 + (Math.floor(b / CELL) + 32768);
    for (let i = 0; i < n.length - 1; i++) {
      const k = key((n[i] + n[i + 1]) / 2, (e[i] + e[i + 1]) / 2);
      const l = grid.get(k);
      if (l) l.push(i);
      else grid.set(k, [i]);
    }
    let cut = false;
    for (let i = 0; i < n.length - 1 && !cut; i++) {
      const mn = (n[i] + n[i + 1]) / 2, me = (e[i] + e[i + 1]) / 2;
      let hit = -1;
      let t = 0;
      for (let a = -1; a <= 1; a++) {
        for (let b = -1; b <= 1; b++) {
          for (const j of grid.get(key(mn + a * CELL, me + b * CELL)) ?? []) {
            if (j <= i + 1 || j <= hit) continue;
            // Segment i (p -> q) against segment j (r -> s): p + t (q - p) = r + u (s - r).
            const px = e[i], py = n[i], qx = e[i + 1] - px, qy = n[i + 1] - py;
            const rx = e[j], ry = n[j], sx = e[j + 1] - rx, sy = n[j + 1] - ry;
            const den = qx * sy - qy * sx;
            if (Math.abs(den) < 1e-12) continue;
            const tt = ((rx - px) * sy - (ry - py) * sx) / den;
            const uu = ((rx - px) * qy - (ry - py) * qx) / den;
            if (tt > 0 && tt < 1 && uu > 0 && uu < 1) {
              hit = j;
              t = tt;
            }
          }
        }
      }
      if (hit < 0) continue;
      // Keep 0..i, the crossing point, then hit+1.. (the outermost crossing of segment i, so the whole curl goes).
      const xn = n[i] + t * (n[i + 1] - n[i]);
      const xe = e[i] + t * (e[i + 1] - e[i]);
      const xs = vs[i] + t * (vs[i + 1] - vs[i]);
      n.splice(i + 1, hit - i, xn);
      e.splice(i + 1, hit - i, xe);
      vs.splice(i + 1, hit - i, Math.min(xs, vs[i + 1 + (hit - i)] ?? xs));
      cut = true;
    }
    if (!cut) return;
  }
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
 * Neck cutoffs: where a strongly meandering channel has swung a loop round until its neck is narrow (two points with
 * a full loop of channel between them lie within NECK_FACTOR meander lengths), some loops are abandoned - the channel
 * takes the short way across the neck and the loop is left beside it as an oxbow lake, trimmed clear of the new
 * channel (about a third of the narrow necks; the rest stay as horseshoe loops). Edits the channel in place (it gets
 * shorter); returns the oxbows.
 */
function cutOffLoops(ch: { north: number[]; east: number[]; valleyS: number[]; off: number[] }, a: Axis, li: number): CutLoop[] {
  const out: CutLoop[] = [];
  const { north, east, valleyS, off } = ch;
  const N = north.length;
  const cuts: Array<[number, number]> = [];
  let lastCut = -Infinity;
  let k = 0;
  while (k < N - 2) {
    const i = segmentAt(a.s, Math.max(0, valleyS[k]));
    const lambda = a.wavelength[i];
    const hw = a.halfWidth[i];
    // The nearest point a loop or more further on (a loop's channel is about 1-3 meander lengths; a tight curl less).
    const touchAt = 2 * hw + 2 * CHANNEL_BANK;
    let arc = 0;
    let best = -1;
    let bestD = Infinity;
    let touch = -1;
    for (let j = k + 1; j < N && arc < 3.5 * lambda; j++) {
      arc += Math.hypot(north[j] - north[j - 1], east[j] - east[j - 1]);
      if (arc < 2 * touchAt) continue;
      const d = Math.hypot(north[j] - north[k], east[j] - east[k]);
      // A loop swung round onto itself (always cut: a river cannot cross its own channel); the furthest such point.
      if (d < touchAt) touch = j;
      if (arc < Math.max(8 * hw + 4 * CHANNEL_BANK, 0.4 * lambda)) continue;
      if (arc >= 1.1 * lambda && d < bestD) {
        bestD = d;
        best = j;
      }
    }
    if (touch >= 0) {
      best = touch;
    } else {
      // Of the merely narrow necks on strongly meandering stretches, about a third, spaced along the river.
      const narrow = best >= 0 && bestD <= Math.max(NECK_FACTOR * lambda, 3 * hw + 30);
      if (!narrow || a.meander[i] < 0.45 || valleyS[k] - lastCut < 2000 || (hash2i(li * 7919 + k, 0x0b0) & 0xff) > 90) {
        k++;
        continue;
      }
    }
    // The loop's crescent, clear of the short channel across the neck.
    const cn = north[k];
    const ce = east[k];
    const dn = north[best] - cn;
    const de = east[best] - ce;
    const l2 = dn * dn + de * de || 1;
    const clear = 2 * hw + CHANNEL_BANK + 15;
    const on: number[] = [];
    const oe: number[] = [];
    for (let j = k; j <= best; j++) {
      const u = Math.min(1, Math.max(0, ((north[j] - cn) * dn + (east[j] - ce) * de) / l2));
      if (Math.hypot(north[j] - cn - dn * u, east[j] - ce - de * u) > clear) {
        on.push(north[j]);
        oe.push(east[j]);
      }
    }
    // A loop too small to leave a lake behind is still cut when it touches itself.
    if (on.length >= 5) out.push({ north: Float64Array.from(on), east: Float64Array.from(oe), valleyS: valleyS[(k + best) >> 1], halfWidth: hw, age: (hash2i(li, k) & 0xffff) / 65536 });
    if (on.length >= 5 || touch >= 0) {
      cuts.push([k, best]);
      lastCut = valleyS[best];
      k = best;
    } else k++;
  }
  if (cuts.length === 0) return out;
  // Rebuild the channel: each cut loop replaced by the neck, sampled every 20 m.
  const n2: number[] = [];
  const e2: number[] = [];
  const v2: number[] = [];
  const o2: number[] = [];
  let c = 0;
  for (let j = 0; j < N; j++) {
    n2.push(north[j]);
    e2.push(east[j]);
    v2.push(valleyS[j]);
    o2.push(off[j]);
    if (c < cuts.length && j === cuts[c][0]) {
      const to = cuts[c][1];
      const len = Math.hypot(north[to] - north[j], east[to] - east[j]);
      const steps = Math.max(1, Math.ceil(len / 20));
      for (let q = 1; q < steps; q++) {
        const t = q / steps;
        n2.push(north[j] + (north[to] - north[j]) * t);
        e2.push(east[j] + (east[to] - east[j]) * t);
        v2.push(valleyS[j] + (valleyS[to] - valleyS[j]) * t);
        o2.push(off[j] + (off[to] - off[j]) * t);
      }
      j = to - 1;
      c++;
    }
  }
  ch.north = n2;
  ch.east = e2;
  ch.valleyS = v2;
  ch.off = o2;
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
