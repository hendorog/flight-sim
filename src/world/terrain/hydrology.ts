// Rivers and lakes: fixed geometry placed by hand in the runway frame, with water levels derived from the
// natural (pre-hydrology) terrain at module load so that every body of water sits in its own basin.
// Pure JS; shared by physics, tile workers and tests.

import { AIRPORT } from '../../core/world';
import { fbm, gnoise } from './noise';

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

export interface Hydrology {
  lakes: Lake[];
  /** Densified river centreline: north, east, water level, half-width, arc length. */
  river: { north: Float64Array; east: Float64Array; level: Float64Array; halfWidth: Float64Array; s: Float64Array };
  /** Nearest point of the river centreline. */
  queryRiver(north: number, east: number, out: RiverHit): RiverHit;
}

/** Everything within this distance of the river centreline is shaped by it (valley floor and walls). */
export const RIVER_INFLUENCE = 2400;
/** Lake zone extends to this multiple of the shoreline ellipse radius. */
export const LAKE_ZONE = 1.2;
const INDEX_CELL = 1000;
const SAMPLE_SPACING = 60;

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

/**
 * Build rivers and lakes against the natural terrain.
 * @param natural terrain height before any water shaping, m MSL.
 */
export function buildHydrology(natural: (north: number, east: number) => number): Hydrology {
  const lakes: Lake[] = LAKE_DEFS.map((d) => {
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
  const pad = Math.ceil(RIVER_INFLUENCE / INDEX_CELL);
  for (let i = 0; i < count - 1; i++) {
    const n0 = Math.floor(Math.min(north[i], north[i + 1]) / INDEX_CELL) - pad;
    const n1 = Math.floor(Math.max(north[i], north[i + 1]) / INDEX_CELL) + pad;
    const e0 = Math.floor(Math.min(east[i], east[i + 1]) / INDEX_CELL) - pad;
    const e1 = Math.floor(Math.max(east[i], east[i + 1]) / INDEX_CELL) + pad;
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
    const list = cells.get(key(Math.floor(pn / INDEX_CELL), Math.floor(pe / INDEX_CELL)));
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

  return { lakes, river: { north, east, level, halfWidth, s }, queryRiver };
}
