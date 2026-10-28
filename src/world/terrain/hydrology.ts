// Rivers and lakes: fixed geometry placed by hand in the runway frame, with water levels derived from the
// natural (pre-hydrology) terrain at module load so that every body of water sits in its own basin.
// Pure JS; shared by physics, tile workers and tests.

import { AIRPORT } from '../../core/world';
import { fbm, gnoise } from './noise';
import { decodePolyline, growMeanders, projectPolyline, type MeanderAxis, type MeanderReach, type MeanderResult, type Oxbow } from './meander';
import { RIVER_PLANFORM } from './riverPlanform';

/** A lake: a noise-warped ellipse whose bed is carved into the natural terrain. */
export interface Lake {
  north: number;
  east: number;
  /** Semi-axes of the ellipse before warping, m. */
  radiusA: number;
  radiusB: number;
  /** Rotation of the A axis from north toward east, rad. */
  rotation: number;
  /** Depth of the flat bottom below the surface, m. */
  depth: number;
  /** Water surface elevation MSL, m (computed from the terrain). */
  level: number;
  /** Bounding radius of the zone this lake affects, m. */
  bound: number;
}

/** Result of a river proximity query, written into a caller-owned object. */
export interface RiverHit {
  /** Horizontal distance from the river centreline, m (Infinity when far away). */
  dist: number;
  /** Water surface elevation at the nearest centreline point, m. */
  level: number;
  /** Channel half-width at that point, m. */
  halfWidth: number;
  /** Distance along the river from the source, m. */
  s: number;
  /**
   * Which bank the point lies on: +1 right of the flow (looking downstream), -1 left (0 when far away). dist * side is a signed
   * distance that is linear across the channel. Beyond the source it takes the first segment's side.
   */
  side: number;
  /** How far upstream of the source the point lies (along the first segment's direction), m; 0 elsewhere. */
  beyondSource: number;
}

/** Result of a valley-axis query: the smooth line the floodplain and valley walls are carved about. */
export interface ValleyHit {
  /** Horizontal distance from the valley axis, m (Infinity when far away). */
  dist: number;
  /** Water level of the river at this point of the valley, m (the floodplain lies a little above it). */
  level: number;
  /** Half-width of the flat floodplain here, m. */
  floodplain: number;
}

/** Result of an oxbow query: the nearest abandoned loop. */
export interface OxbowHit {
  /** Distance from the loop's centreline, m (Infinity when far away). */
  dist: number;
  /** Its standing water level, m. */
  level: number;
  /** Half-width of its water, m. */
  halfWidth: number;
  /** Depth of its water at the middle, m (older loops have silted up more). */
  depth: number;
}

export interface Hydrology {
  lakes: Lake[];
  /** Densified river channel centreline: north, east, water level, half-width, arc length. */
  river: { north: Float64Array; east: Float64Array; level: Float64Array; halfWidth: Float64Array; s: Float64Array };
  /** The smooth valley axis the channel meanders about. */
  valley: { north: Float64Array; east: Float64Array; level: Float64Array; floodplain: Float64Array; s: Float64Array };
  /** Abandoned meander loops: centreline, water level and half-width. */
  oxbows: ReadonlyArray<{ north: Float64Array; east: Float64Array; level: number; halfWidth: number; depth: number }>;
  /** Nearest point of the river channel centreline. */
  queryRiver(north: number, east: number, out: RiverHit): RiverHit;
  /** Nearest point of the valley axis. */
  queryValley(north: number, east: number, out: ValleyHit): ValleyHit;
  /** Nearest oxbow lake. */
  queryOxbow(north: number, east: number, out: OxbowHit): OxbowHit;
}

/** Valley walls rise over this distance beyond the floodplain (everything closer to the axis is shaped by the valley). */
export const RIVER_INFLUENCE = 2400;
/** Lake zone extends to this multiple of the shoreline ellipse radius. */
export const LAKE_ZONE = 1.2;
/** Cell size of the valley axis index, and of the channel and oxbow indexes, m. */
const INDEX_CELL = 1000;
/** The legacy river's index cell and reach (buildLegacyHydrology), m. */
const LEGACY_INDEX_CELL = 1000;
const LEGACY_RIVER_INFLUENCE = 2400;
const CHANNEL_CELL = 100;
/** The channel is searched for this far from it; further out its distance is estimated from the valley axis, m. */
const CHANNEL_REACH = 450;
const SAMPLE_SPACING = 60;
/** Channel sample spacing, m, and migration steps of the meander growth (meander.ts). */
const CHANNEL_SPACING = 20;
const MEANDER_STEPS = 1500;
const MEANDER_SEED = 0x5ea7e1;
/** Steepest the valley's water level may fall, so the floodplain has no cliffs across it (rapids spread out instead). */
const MAX_VALLEY_GRADIENT = 0.008;
/** Oxbow water stands this far above the river level of its valley section (below the floodplain), m. */
const OXBOW_LEVEL = 0.6;
/** Bank zone of the channel beyond its half-width, m: the cut rises to the floodplain over it. */
export const CHANNEL_BANK = 25;

// River control points in the runway frame (along = toward the 25 end, across = right of rwy 07, i.e. SSE).
// It rises in the alpine valley ENE of the field, runs down the valley parallel to the runway about 3 km to
// the south, then turns south through the coastal hills to the sea.
const RIVER_CONTROL: ReadonlyArray<[number, number]> = [
  [44000, 600],
  [36000, 1000],
  [27000, 1500],
  [18000, 2500],
  [8000, 3300],
  [0, 2900],
  [-7000, 3300],
  [-13000, 4800],
  [-17500, 8200],
  [-20000, 13000],
  [-20500, 19000],
  [-19500, 26000],
];

// Lakes, placed in the runway frame so the layout follows the valley. Levels are filled in below.
const LAKE_DEFS: ReadonlyArray<Omit<Lake, 'level' | 'north' | 'east' | 'bound'> & { along: number; across: number }> = [
  // Valley lake NNW of the field, beside the upper valley.
  { along: 9000, across: -3600, radiusA: 1500, radiusB: 800, rotation: 1.25, depth: 14 },
  // Foothill lake north-west of the field.
  { along: -6000, across: -9000, radiusA: 1100, radiusB: 700, rotation: 0.4, depth: 18 },
  // Alpine tarn in a cirque north of the field.
  { along: 12000, across: -21000, radiusA: 650, radiusB: 420, rotation: 2.2, depth: 25 },
  // Long glacial lake in the upper valley.
  { along: 30000, across: -2900, radiusA: 2600, radiusB: 650, rotation: 1.2, depth: 40 },
];

function toNED(along: number, across: number): { north: number; east: number } {
  const c = Math.cos(AIRPORT.runway.heading);
  const s = Math.sin(AIRPORT.runway.heading);
  return { north: AIRPORT.runway.center.north + along * c - across * s, east: AIRPORT.runway.center.east + along * s + across * c };
}

/** Warped elliptical radius of a lake (1 at the nominal shoreline ellipse). */
export function lakeRadius(lake: Lake, north: number, east: number): number {
  const dn = north - lake.north;
  const de = east - lake.east;
  const c = Math.cos(lake.rotation);
  const s = Math.sin(lake.rotation);
  const a = (dn * c + de * s) / lake.radiusA;
  const b = (-dn * s + de * c) / lake.radiusB;
  const r = Math.sqrt(a * a + b * b);
  // Irregular shoreline: bays and headlands from low-frequency noise in the angle-independent position.
  return r * (1 + 0.22 * fbm(north / 900 + lake.radiusA, east / 900, 3));
}

/** Catmull-Rom interpolation through the control points, densified to roughly SAMPLE_SPACING. */
function densify(points: ReadonlyArray<{ north: number; east: number }>): { n: number[]; e: number[] } {
  const n: number[] = [];
  const e: number[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    const segLen = Math.hypot(p2.north - p1.north, p2.east - p1.east);
    const steps = Math.max(1, Math.ceil(segLen / SAMPLE_SPACING));
    for (let k = 0; k < steps; k++) {
      const t = k / steps;
      const t2 = t * t;
      const t3 = t2 * t;
      const cr = (a: number, b: number, c: number, d: number): number =>
        0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      n.push(cr(p0.north, p1.north, p2.north, p3.north));
      e.push(cr(p0.east, p1.east, p2.east, p3.east));
    }
  }
  const last = points[points.length - 1];
  n.push(last.north);
  e.push(last.east);
  return { n, e };
}

/** The lakes, with their levels found from the natural terrain around each basin. */
export function buildLakes(natural: (north: number, east: number) => number): Lake[] {
  return LAKE_DEFS.map((d) => {
    const p = toNED(d.along, d.across);
    const lake: Lake = { ...d, north: p.north, east: p.east, level: 0, bound: Math.max(d.radiusA, d.radiusB) * LAKE_ZONE * 1.35 };
    // Level: just below the lowest point of the terrain around the shoreline ellipse, so the basin holds water.
    let minRim = Infinity;
    const c = Math.cos(d.rotation);
    const s = Math.sin(d.rotation);
    for (let k = 0; k < 160; k++) {
      const a = (k / 160) * Math.PI * 2;
      // Offset of the unwarped ellipse point at radius 1 in this direction.
      const ca = Math.cos(a) * d.radiusA;
      const sa = Math.sin(a) * d.radiusB;
      const dirN = ca * c - sa * s;
      const dirE = ca * s + sa * c;
      for (const rr of [1.0, 1.1, LAKE_ZONE]) {
        // Scale the offset until the warped radius equals rr (fixed-point iteration converges in a few steps).
        let t = rr;
        for (let it = 0; it < 4; it++) t *= rr / lakeRadius(lake, p.north + dirN * t, p.east + dirE * t);
        minRim = Math.min(minRim, natural(p.north + dirN * t, p.east + dirE * t));
      }
    }
    lake.level = Math.max(0.5, minRim - 1.5);
    return lake;
  });
}

/**
 * Build rivers and lakes against the natural terrain.
 * @param natural terrain height before any water shaping, m MSL.
 */
export function buildHydrology(natural: (north: number, east: number) => number, lakes: Lake[] = buildLakes(natural)): Hydrology {
  // The valley axis: the smooth curve through the control points. Its water level is the running minimum of the
  // natural terrain downstream, always descending, reaching sea level at the coast, and never falling more steeply
  // than MAX_VALLEY_GRADIENT (a drop the terrain would make sharper is spread upstream as a cut).
  const axis = valleyAxis();
  const vCount = axis.north.length;
  const vNorth = axis.north;
  const vEast = axis.east;
  const vS = axis.s;
  const vLevel = new Float64Array(vCount);
  let run = Infinity;
  for (let i = 0; i < vCount; i++) {
    let h = natural(vNorth[i], vEast[i]);
    for (const [dn, de] of [[80, 0], [-80, 0], [0, 80], [0, -80]]) h = Math.min(h, natural(vNorth[i] + dn, vEast[i] + de));
    const cand = h - 2.5;
    run = i === 0 ? cand : Math.min(run - 0.00025 * (vS[i] - vS[i - 1]), cand);
    vLevel[i] = Math.max(0, run);
  }
  for (let i = vCount - 2; i >= 0; i--) vLevel[i] = Math.min(vLevel[i], vLevel[i + 1] + MAX_VALLEY_GRADIENT * (vS[i + 1] - vS[i]));
  const total = vS[vCount - 1];
  const reach = riverReach(total);
  const vFlood = new Float64Array(vCount);
  for (let i = 0; i < vCount; i++) vFlood[i] = reach.floodplain(vS[i]);
  const valleyAt = (sv: number, arr: Float64Array): number => {
    let lo = 0;
    let hi = vCount - 1;
    if (sv <= 0) return arr[0];
    if (sv >= total) return arr[vCount - 1];
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (vS[mid] <= sv) lo = mid;
      else hi = mid;
    }
    const t = (sv - vS[lo]) / (vS[hi] - vS[lo] || 1);
    return arr[lo] + (arr[hi] - arr[lo]) * t;
  };

  // The channel: grown into meanders on the valley floor (meander.ts), baked into riverPlanform.ts (the growth takes
  // seconds). Its level follows the valley's at each point, made to fall monotonically along the channel even where
  // a loop doubles back.
  const grown = RIVER_PLANFORM.channel ? unpackPlanform(axis, reach) : growMeanders(axis, reach, MEANDER_SEED, CHANNEL_SPACING, MEANDER_STEPS);
  const count = grown.north.length;
  const north = grown.north;
  const east = grown.east;
  const s = new Float64Array(count);
  const level = new Float64Array(count);
  const halfWidth = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    if (i > 0) s[i] = s[i - 1] + Math.hypot(north[i] - north[i - 1], east[i] - east[i - 1]);
    const lv = valleyAt(grown.valleyS[i], vLevel);
    level[i] = i === 0 ? lv : Math.min(level[i - 1], lv);
    halfWidth[i] = reach.halfWidth(grown.valleyS[i]);
  }
  const oxbows = grown.oxbows.map((o) => ({
    north: o.north,
    east: o.east,
    level: valleyAt(o.valleyS, vLevel) + OXBOW_LEVEL,
    halfWidth: o.halfWidth * 0.85,
    // Cut off early in the growth (age near 0): longer to fill with silt.
    depth: 0.8 + 2.2 * o.age,
  }));

  const channelIndex = new PolylineIndex([{ north, east }], CHANNEL_REACH, CHANNEL_CELL);
  const valleyIndex = new PolylineIndex([{ north: vNorth, east: vEast }], RIVER_INFLUENCE + reach.maxFloodplain, INDEX_CELL);
  const oxbowIndex = new PolylineIndex(oxbows, 200, CHANNEL_CELL);
  const valleyNear: PolylineNear = { line: 0, seg: 0, t: 0, u: 0, dist: Infinity, side: 0 };
  const near: PolylineNear = { line: 0, seg: 0, t: 0, u: 0, dist: Infinity, side: 0 };

  const queryRiver = (pn: number, pe: number, out: RiverHit): RiverHit => {
    out.dist = Infinity;
    out.side = 0;
    out.beyondSource = 0;
    if (!channelIndex.nearest(pn, pe, near) || near.dist > CHANNEL_REACH) {
      // Out of the channel's reach: no bank, and a distance estimated from the edge of the meander belt.
      if (valleyIndex.nearest(pn, pe, valleyNear)) {
        const sv = vS[valleyNear.seg] + (vS[valleyNear.seg + 1] - vS[valleyNear.seg]) * valleyNear.t;
        out.dist = Math.max(CHANNEL_REACH, valleyNear.dist - reach.belt(sv) - reach.halfWidth(sv));
        out.level = valleyAt(sv, vLevel);
        out.halfWidth = reach.halfWidth(sv);
        out.s = 0;
      }
      return out;
    }
    const bi = near.seg;
    const bt = near.t;
    out.dist = near.dist;
    out.side = near.side;
    if (bi === 0 && near.u < 0) out.beyondSource = -near.u * Math.hypot(north[1] - north[0], east[1] - east[0]);
    out.level = level[bi] + (level[bi + 1] - level[bi]) * bt;
    out.halfWidth = halfWidth[bi] + (halfWidth[bi + 1] - halfWidth[bi]) * bt;
    out.s = s[bi] + (s[bi + 1] - s[bi]) * bt;
    return out;
  };
  const queryValley = (pn: number, pe: number, out: ValleyHit): ValleyHit => {
    out.dist = Infinity;
    if (!valleyIndex.nearest(pn, pe, near)) return out;
    const bi = near.seg;
    const bt = near.t;
    out.dist = near.dist;
    out.level = vLevel[bi] + (vLevel[bi + 1] - vLevel[bi]) * bt;
    out.floodplain = vFlood[bi] + (vFlood[bi + 1] - vFlood[bi]) * bt;
    return out;
  };
  const queryOxbow = (pn: number, pe: number, out: OxbowHit): OxbowHit => {
    out.dist = Infinity;
    if (!oxbowIndex.nearest(pn, pe, near)) return out;
    const o = oxbows[near.line];
    out.dist = near.dist;
    out.level = o.level;
    out.halfWidth = o.halfWidth;
    out.depth = o.depth;
    return out;
  };

  return {
    lakes,
    river: { north, east, level, halfWidth, s },
    valley: { north: vNorth, east: vEast, level: vLevel, floodplain: vFlood, s: vS },
    oxbows,
    queryRiver,
    queryValley,
    queryOxbow,
  };
}

/**
 * The river as it was before its meanders were grown (the Late Cretaceous keeps it: its scenery is placed along this
 * course): noise meanders on the smooth control curve, its valley carved about the channel itself
 * (heightfield.ts legacyRiverProfile). Unchanged, so the era's terrain stays byte-identical.
 */
export function buildLegacyHydrology(natural: (north: number, east: number) => number, lakes: Lake[]): Hydrology {
  // River centreline with meanders superimposed on the smooth control curve.
  const ctrl = RIVER_CONTROL.map(([a, c]) => toNED(a, c));
  const base = densify(ctrl);
  const count = base.n.length;
  const north = new Float64Array(count);
  const east = new Float64Array(count);
  const s = new Float64Array(count);
  let arc = 0;
  for (let i = 0; i < count; i++) {
    if (i > 0) arc += Math.hypot(base.n[i] - base.n[i - 1], base.e[i] - base.e[i - 1]);
    const i0 = Math.max(0, i - 1);
    const i1 = Math.min(count - 1, i + 1);
    const tn = base.n[i1] - base.n[i0];
    const te = base.e[i1] - base.e[i0];
    const tl = Math.hypot(tn, te) || 1;
    // Meander amplitude grows downstream where the valley floor is wide and flat.
    const u = arc / 1000;
    const amp = 60 + 170 * Math.min(1, u / 30);
    const off = amp * (0.7 * gnoise(u / 2.1, 3.7) + 0.3 * gnoise(u / 0.9, 8.3));
    north[i] = base.n[i] - (te / tl) * off;
    east[i] = base.e[i] + (tn / tl) * off;
  }
  arc = 0;
  for (let i = 0; i < count; i++) {
    if (i > 0) arc += Math.hypot(north[i] - north[i - 1], east[i] - east[i - 1]);
    s[i] = arc;
  }

  // Water level: running minimum of the natural terrain downstream, a little below it, always descending,
  // reaching sea level at the coast. Half-width grows downstream (12 m in the mountains to 38 m at the mouth).
  const level = new Float64Array(count);
  const halfWidth = new Float64Array(count);
  let run = Infinity;
  for (let i = 0; i < count; i++) {
    let h = natural(north[i], east[i]);
    for (const [dn, de] of [[80, 0], [-80, 0], [0, 80], [0, -80]]) h = Math.min(h, natural(north[i] + dn, east[i] + de));
    const cand = h - 2.5;
    run = i === 0 ? cand : Math.min(run - 0.00025 * (s[i] - s[i - 1]), cand);
    level[i] = Math.max(0, run);
    halfWidth[i] = 12 + 26 * Math.min(1, s[i] / arc);
  }

  // Spatial index: every cell lists the segments that can influence a point in it.
  const index = new Map<number, number[]>();
  const key = (cx: number, cy: number): number => (cx + 32768) * 65536 + (cy + 32768);
  const pad = Math.ceil(LEGACY_RIVER_INFLUENCE / LEGACY_INDEX_CELL);
  for (let i = 0; i < count - 1; i++) {
    const n0 = Math.floor(Math.min(north[i], north[i + 1]) / LEGACY_INDEX_CELL) - pad;
    const n1 = Math.floor(Math.max(north[i], north[i + 1]) / LEGACY_INDEX_CELL) + pad;
    const e0 = Math.floor(Math.min(east[i], east[i + 1]) / LEGACY_INDEX_CELL) - pad;
    const e1 = Math.floor(Math.max(east[i], east[i + 1]) / LEGACY_INDEX_CELL) + pad;
    for (let cx = n0; cx <= n1; cx++)
      for (let cy = e0; cy <= e1; cy++) {
        const k = key(cx, cy);
        let list = index.get(k);
        if (!list) index.set(k, (list = []));
        list.push(i);
      }
  }
  const cells = new Map<number, Int32Array>();
  for (const [k, list] of index) cells.set(k, Int32Array.from(list));

  const queryRiver = (pn: number, pe: number, out: RiverHit): RiverHit => {
    out.dist = Infinity;
    out.side = 0;
    out.beyondSource = 0;
    const list = cells.get(key(Math.floor(pn / LEGACY_INDEX_CELL), Math.floor(pe / LEGACY_INDEX_CELL)));
    if (!list) return out;
    let best = Infinity;
    let bi = 0;
    let bt = 0;
    let bu = 0;
    for (let k = 0; k < list.length; k++) {
      const i = list[k];
      const an = north[i];
      const ae = east[i];
      const dn = north[i + 1] - an;
      const de = east[i + 1] - ae;
      const l2 = dn * dn + de * de;
      const u = l2 > 0 ? ((pn - an) * dn + (pe - ae) * de) / l2 : 0;
      const t = u < 0 ? 0 : u > 1 ? 1 : u;
      const qn = an + dn * t - pn;
      const qe = ae + de * t - pe;
      const d2 = qn * qn + qe * qe;
      if (d2 < best) {
        best = d2;
        bi = i;
        bt = t;
        bu = u;
      }
    }
    out.dist = Math.sqrt(best);
    {
      const dn = north[bi + 1] - north[bi];
      const de = east[bi + 1] - east[bi];
      // Cross product of the flow direction (north, east) with the offset: > 0 on the right bank (north-east axes are left-handed seen from above).
      const cross = dn * (pe - east[bi]) - de * (pn - north[bi]);
      out.side = cross >= 0 ? 1 : -1;
      if (bi === 0 && bu < 0) out.beyondSource = -bu * Math.hypot(dn, de);
    }
    out.level = level[bi] + (level[bi + 1] - level[bi]) * bt;
    out.halfWidth = halfWidth[bi] + (halfWidth[bi + 1] - halfWidth[bi]) * bt;
    out.s = s[bi] + (s[bi + 1] - s[bi]) * bt;
    return out;
  };

  const axis = valleyAxis();
  return {
    lakes,
    river: { north, east, level, halfWidth, s },
    valley: { north: axis.north, east: axis.east, level: new Float64Array(axis.s.length), floodplain: new Float64Array(axis.s.length), s: axis.s },
    oxbows: [],
    queryRiver,
    queryValley: (_n, _e, out) => ((out.dist = Infinity), out),
    queryOxbow: (_n, _e, out) => ((out.dist = Infinity), out),
  };
}

/** The valley axis: the smooth curve through the river's control points, with its arc length. */
function valleyAxis(): MeanderAxis {
  const base = densify(RIVER_CONTROL.map(([a, c]) => toNED(a, c)));
  const count = base.n.length;
  const s = new Float64Array(count);
  for (let i = 1; i < count; i++) s[i] = s[i - 1] + Math.hypot(base.n[i] - base.n[i - 1], base.e[i] - base.e[i - 1]);
  return { north: Float64Array.from(base.n), east: Float64Array.from(base.e), s };
}

/** The inputs of the channel's meander growth, for the bake (tests/terrain/riverPlanform.test.ts). */
export function meanderSetup(): { axis: MeanderAxis; reach: MeanderReach; seed: number; ds: number; steps: number } {
  const axis = valleyAxis();
  return { axis, reach: riverReach(axis.s[axis.s.length - 1]), seed: MEANDER_SEED, ds: CHANNEL_SPACING, steps: MEANDER_STEPS };
}

/** The baked channel and oxbows, with their valley arc lengths found again by projection. */
function unpackPlanform(axis: MeanderAxis, reach: MeanderReach): MeanderResult {
  const channel = decodePolyline(RIVER_PLANFORM.channel);
  const oxbows: Oxbow[] = RIVER_PLANFORM.oxbows.map((o) => {
    const line = decodePolyline(o.line);
    const sv = projectPolyline(axis, line.north, line.east);
    const valleyS = sv[sv.length >> 1];
    return { ...line, valleyS, halfWidth: reach.halfWidth(valleyS), age: o.age };
  });
  return { ...channel, valleyS: projectPolyline(axis, channel.north, channel.east), oxbows };
}

/**
 * The river's character along its valley (arc length from the source): a mountain torrent, the steep outwash below
 * the range, the long low-gradient valley past the field where it meanders freely, the reach through the coastal
 * hills (meanders confined between spurs), the fall to the coast and the estuary. Half-widths grow downstream.
 */
function riverReach(total: number): MeanderReach & { floodplain(s: number): number; maxFloodplain: number } {
  const km = 1000;
  const table = (pts: ReadonlyArray<[number, number]>) => (sv: number): number => {
    const x = sv / km;
    if (x <= pts[0][0]) return pts[0][1];
    for (let i = 1; i < pts.length; i++) {
      if (x <= pts[i][0]) {
        const t = (x - pts[i - 1][0]) / (pts[i][0] - pts[i - 1][0]);
        const u = t * t * (3 - 2 * t);
        return pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * u;
      }
    }
    return pts[pts.length - 1][1];
  };
  const erodibility = table([[0, 0], [11, 0], [14, 1], [41, 1], [44, 1], [68, 1], [70, 0], [74, 0], [76, 1], [total / km - 1.5, 1], [total / km, 0]]);
  const beltBase = table([[0, 0], [11, 0], [14, 750], [41, 850], [44, 450], [68, 450], [70, 0], [74, 0], [76, 600], [total / km, 600]]);
  // The valley floor narrows and widens: stretches where the river swings wide and others held nearly straight.
  const belt = (sv: number): number => beltBase(sv) * (0.85 + 0.3 * gnoise(sv / 4200 + 3.1, 7.7));
  const halfWidth = (sv: number): number => 12 + 26 * Math.min(1, sv / total);
  // The flat floodplain holds the meander belt with room for the channel and its banks either side.
  const floodplain = (sv: number): number => belt(sv) + halfWidth(sv) + CHANNEL_BANK + 4 * halfWidth(sv) * Math.min(1, belt(sv) / 200);
  return { erodibility, belt, halfWidth, floodplain, maxFloodplain: 850 + 38 * 5 + CHANNEL_BANK };
}

interface PolylineNear {
  /** Which polyline, its nearest segment, the clamped and unclamped parameter along it. */
  line: number;
  seg: number;
  t: number;
  u: number;
  dist: number;
  /** +1 right of the polyline's direction, -1 left. */
  side: number;
}

/** Spatial index over polylines: every cell lists the segments that can be within `reach` of a point in it. */
class PolylineIndex {
  private readonly cells = new Map<number, Int32Array>();
  constructor(private readonly lines: ReadonlyArray<{ north: Float64Array; east: Float64Array }>, reach: number, private readonly cell: number) {
    const lists = new Map<number, number[]>();
    const pad = Math.ceil(reach / cell);
    lines.forEach((l, li) => {
      for (let i = 0; i < l.north.length - 1; i++) {
        const n0 = Math.floor(Math.min(l.north[i], l.north[i + 1]) / cell) - pad;
        const n1 = Math.floor(Math.max(l.north[i], l.north[i + 1]) / cell) + pad;
        const e0 = Math.floor(Math.min(l.east[i], l.east[i + 1]) / cell) - pad;
        const e1 = Math.floor(Math.max(l.east[i], l.east[i + 1]) / cell) + pad;
        for (let cx = n0; cx <= n1; cx++)
          for (let cy = e0; cy <= e1; cy++) {
            const k = cellKey(cx, cy);
            let list = lists.get(k);
            if (!list) lists.set(k, (list = []));
            list.push(li, i);
          }
      }
    });
    for (const [k, list] of lists) this.cells.set(k, Int32Array.from(list));
  }

  /** Nearest point of any polyline listed for the point's cell; false when none is. */
  nearest(pn: number, pe: number, out: PolylineNear): boolean {
    const list = this.cells.get(cellKey(Math.floor(pn / this.cell), Math.floor(pe / this.cell)));
    if (!list) return false;
    let best = Infinity;
    for (let k = 0; k < list.length; k += 2) {
      const l = this.lines[list[k]];
      const i = list[k + 1];
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
      if (d2 < best) {
        best = d2;
        out.line = list[k];
        out.seg = i;
        out.t = t;
        out.u = u;
      }
    }
    out.dist = Math.sqrt(best);
    const l = this.lines[out.line];
    const i = out.seg;
    const dn = l.north[i + 1] - l.north[i];
    const de = l.east[i + 1] - l.east[i];
    // Cross product of the direction (north, east) with the offset: > 0 on the right (north-east axes are left-handed seen from above).
    out.side = dn * (pe - l.east[i]) - de * (pn - l.north[i]) >= 0 ? 1 : -1;
    return true;
  }
}

const cellKey = (cx: number, cy: number): number => (cx + 32768) * 65536 + (cy + 32768);
