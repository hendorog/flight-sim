// Ground routes over the taxiway centrelines (src/world/airport/layout.ts): from where the aircraft is (a
// parking stand, or anywhere on a taxiway or the apron taxilane) to a holding point of runway 07/25 or back to
// the stand. The network is the painted yellow lines: the apron taxilane, the B connectors from it to the
// parallel taxiway A, A itself, and the A connectors up to their hold-short points; a stand joins the taxilane
// by its lead-in line. Shortest path (Dijkstra), then the corners are rounded with the painted turn radius
// (CENTRELINE_TURN_RADIUS) so cross-track is measured from the line the pilot actually follows.
//
// Everything is plain geometry in NED metres: node tests use it directly, and the 'taxi' telemetry provider
// tracks progress along the result.

import { RAD } from '../../core/math';
import {
  APRON_RECT, APRON_TAXILANE_V, CENTRELINE_TURN_RADIUS, HOLD_LINE_V, HOLD_SHORT, localHeading, localToNed, nedToLocal,
  PARKING, PARKING_SPOTS, TAXIWAYS, type LocalXY,
} from '../../world/airport/layout';
import type { TaxiAction, TaxiDestination, TaxiRoute, TaxiWaypoint } from '../types';
import { wrap180 } from './angles';

/** Hold-short CG position: 4 m behind the hold line (layout.ts HOLD_SHORT). */
const HOLD_V = HOLD_LINE_V - 4;
/** A turn sharper than this is a waypoint ("turn left onto B1"), deg. */
const TURN_MIN_DEG = 20;
/** The corner radius where no curve is painted (the stand lead-in, the taxilane T junctions), m. */
const TEE_RADIUS = 9;
/** A position this close to a stand starts from the stand's lead-in line, m. */
const STAND_CAPTURE_M = 10;
/** Arc sampling step, m. */
const ARC_STEP_M = 1.5;

interface Seg { name: string; a: LocalXY; b: LocalXY }
interface Node { id: number; u: number; v: number; name?: string }
interface Edge { to: number; len: number; name: string }

/** The painted network as named straight segments (local u, v). */
function networkSegments(): Seg[] {
  const segs: Seg[] = [];
  segs.push({ name: 'apron', a: { u: APRON_RECT.u0 + 8, v: APRON_TAXILANE_V }, b: { u: APRON_RECT.u1 - 8, v: APRON_TAXILANE_V } });
  for (const t of TAXIWAYS) {
    if (t.name === 'A') {
      // The parallel taxiway between its two end connectors (the stubs beyond them lead nowhere).
      const ends = TAXIWAYS.filter((c) => /^A\d$/.test(c.name)).map((c) => c.a.u);
      segs.push({ name: 'A', a: { u: Math.min(...ends), v: t.a.v }, b: { u: Math.max(...ends), v: t.a.v } });
    } else if (t.name.startsWith('B')) {
      segs.push({ name: t.name, a: { u: t.a.u, v: t.a.v }, b: { u: t.a.u, v: APRON_TAXILANE_V } });
    } else {
      segs.push({ name: t.name, a: { u: t.a.u, v: t.a.v }, b: { u: t.a.u, v: HOLD_V } });
    }
  }
  return segs;
}

/** Distance from p to segment ab, and the parameter of the closest point. */
function segProject(p: LocalXY, a: LocalXY, b: LocalXY): { d: number; t: number } {
  const du = b.u - a.u, dv = b.v - a.v;
  const L2 = du * du + dv * dv;
  const t = L2 > 0 ? Math.max(0, Math.min(1, ((p.u - a.u) * du + (p.v - a.v) * dv) / L2)) : 0;
  return { d: Math.hypot(a.u + du * t - p.u, a.v + dv * t - p.v), t };
}

class Graph {
  nodes: Node[] = [];
  adj: Edge[][] = [];

  node(u: number, v: number, name?: string): number {
    const hit = this.nodes.find((n) => Math.hypot(n.u - u, n.v - v) < 0.5);
    if (hit) {
      if (name && !hit.name) hit.name = name;
      return hit.id;
    }
    const id = this.nodes.length;
    this.nodes.push({ id, u, v, name });
    this.adj.push([]);
    return id;
  }

  link(a: number, b: number, name: string): void {
    const na = this.nodes[a], nb = this.nodes[b];
    const len = Math.hypot(na.u - nb.u, na.v - nb.v);
    if (len < 0.01) return;
    this.adj[a].push({ to: b, len, name });
    this.adj[b].push({ to: a, len, name });
  }

  /** Build from segments, splitting each at every node that lies on it. */
  static of(segs: readonly Seg[], extraNodes: readonly LocalXY[]): Graph {
    const g = new Graph();
    for (const s of segs) {
      g.node(s.a.u, s.a.v);
      g.node(s.b.u, s.b.v);
    }
    for (const p of extraNodes) g.node(p.u, p.v);
    for (const s of segs) {
      const on = g.nodes
        .map((n) => ({ n, pr: segProject(n, s.a, s.b) }))
        .filter((x) => x.pr.d < 0.5)
        .sort((x, y) => x.pr.t - y.pr.t);
      for (let i = 1; i < on.length; i++) g.link(on[i - 1].n.id, on[i].n.id, s.name);
    }
    return g;
  }

  /** Shortest path (node ids) and the name of the edge entering each node after the first. */
  path(from: number, to: number): { ids: number[]; names: string[] } | null {
    const n = this.nodes.length;
    const dist = new Array<number>(n).fill(Infinity);
    const prev = new Array<number>(n).fill(-1);
    const via = new Array<string>(n).fill('');
    const done = new Array<boolean>(n).fill(false);
    dist[from] = 0;
    for (;;) {
      let u = -1;
      for (let i = 0; i < n; i++) if (!done[i] && dist[i] < Infinity && (u < 0 || dist[i] < dist[u])) u = i;
      if (u < 0 || u === to) break;
      done[u] = true;
      for (const e of this.adj[u]) {
        const d = dist[u] + e.len;
        if (d < dist[e.to]) {
          dist[e.to] = d;
          prev[e.to] = u;
          via[e.to] = e.name;
        }
      }
    }
    if (dist[to] === Infinity) return null;
    const ids: number[] = [];
    const names: string[] = [];
    for (let v = to; v >= 0; v = prev[v]) {
      ids.unshift(v);
      if (prev[v] >= 0) names.unshift(via[v]);
    }
    return { ids, names };
  }
}

/** Where a taxi from (north, east) starts: a stand's position (its lead-in line) or the nearest centreline point. */
function startPoint(north: number, east: number, segs: readonly Seg[]): { p: LocalXY; stand: LocalXY | null } {
  const p = nedToLocal(north, east);
  const stand = PARKING_SPOTS.find((s) => Math.hypot(s.u - p.u, s.v - p.v) < STAND_CAPTURE_M) ?? null;
  if (stand) return { p: { u: stand.u, v: stand.v }, stand: { u: stand.u, v: stand.v } };
  let best: { d: number; q: LocalXY } | null = null;
  for (const s of segs) {
    const pr = segProject(p, s.a, s.b);
    if (!best || pr.d < best.d) best = { d: pr.d, q: { u: s.a.u + (s.b.u - s.a.u) * pr.t, v: s.a.v + (s.b.v - s.a.v) * pr.t } };
  }
  return { p: best ? best.q : p, stand: null };
}

/** The destination in the local frame. */
function endPoint(to: TaxiDestination): { p: LocalXY; stand: LocalXY | null } {
  if (to === 'parking') {
    const l = nedToLocal(PARKING.north, PARKING.east);
    const s = PARKING_SPOTS.reduce((b, x) => (Math.hypot(x.u - l.u, x.v - l.v) < Math.hypot(b.u - l.u, b.v - l.v) ? x : b));
    return { p: { u: s.u, v: s.v }, stand: { u: s.u, v: s.v } };
  }
  const h = HOLD_SHORT.find((x) => x.name === to);
  if (!h) throw new Error(`taxiRoute: no holding point ${to}`);
  const l = nedToLocal(h.north, h.east);
  return { p: { u: Math.round(l.u * 1000) / 1000, v: HOLD_V }, stand: null };
}

const deg = (rad: number): number => rad * RAD;

/**
 * The route from (north, east) to `to` over the painted lines; null when no route exists (off the airfield).
 * `id` names it for the telemetry provider (a new id restarts the progress tracking).
 */
export function buildTaxiRoute(north: number, east: number, to: TaxiDestination, id = `taxi-${to}`): TaxiRoute | null {
  const segs = networkSegments();
  const start = startPoint(north, east, segs);
  const end = endPoint(to);
  const all = [...segs];
  // Stand lead-in lines: straight from the stand to the taxilane.
  for (const st of [start.stand, end.stand]) {
    if (st) all.push({ name: 'stand', a: st, b: { u: st.u, v: APRON_TAXILANE_V } });
  }
  const g = Graph.of(all, [start.p, end.p]);
  const from = g.node(start.p.u, start.p.v);
  const dest = g.node(end.p.u, end.p.v);
  const path = g.path(from, dest);
  if (!path || path.ids.length < 2) return null;
  // Merge collinear runs so the corners are the real junctions.
  const pts: LocalXY[] = path.ids.map((i) => ({ u: g.nodes[i].u, v: g.nodes[i].v }));
  const names = path.names;
  const corners: { p: LocalXY; nameOut: string }[] = [{ p: pts[0], nameOut: names[0] }];
  for (let i = 1; i < pts.length - 1; i++) {
    const h1 = localHeading(pts[i].u - pts[i - 1].u, pts[i].v - pts[i - 1].v);
    const h2 = localHeading(pts[i + 1].u - pts[i].u, pts[i + 1].v - pts[i].v);
    if (Math.abs(wrap180(deg(h2 - h1))) >= TURN_MIN_DEG || names[i] !== names[i - 1]) corners.push({ p: pts[i], nameOut: names[i] });
  }
  corners.push({ p: pts[pts.length - 1], nameOut: '' });
  return assemble(id, to, corners, end.stand !== null);
}

/** Round the corners, sample the polyline, and list the waypoints. */
function assemble(id: string, to: TaxiDestination, corners: { p: LocalXY; nameOut: string }[], endsAtStand: boolean): TaxiRoute {
  const out: { u: number; v: number }[] = [];
  const turns: { i: number; turnDeg: number; name: string; mid: { u: number; v: number } }[] = [];
  out.push(corners[0].p);
  for (let i = 1; i < corners.length - 1; i++) {
    const a = corners[i - 1].p, p = corners[i].p, b = corners[i + 1].p;
    const l1 = Math.hypot(p.u - a.u, p.v - a.v), l2 = Math.hypot(b.u - p.u, b.v - p.v);
    const d1 = { u: (p.u - a.u) / l1, v: (p.v - a.v) / l1 };
    const d2 = { u: (b.u - p.u) / l2, v: (b.v - p.v) / l2 };
    const turnDeg = wrap180(deg(localHeading(d2.u, d2.v) - localHeading(d1.u, d1.v)));
    const theta = (Math.abs(turnDeg) * Math.PI) / 180;
    if (theta < (TURN_MIN_DEG * Math.PI) / 180) {
      // A name change without a turn ("straight on to A1"): a 'straight' waypoint at the vertex.
      out.push(p);
      turns.push({ i: out.length - 1, turnDeg, name: corners[i].nameOut, mid: p });
      continue;
    }
    // Painted curves (CENTRELINE_ARCS) where a taxiway meets A; a tighter tee on the apron.
    const painted = corners[i].nameOut !== 'apron' && corners[i - 1].nameOut !== 'stand' && corners[i - 1].nameOut !== 'apron';
    let R = painted ? CENTRELINE_TURN_RADIUS : TEE_RADIUS;
    const tanHalf = Math.tan(theta / 2);
    R = Math.min(R, (0.45 * Math.min(l1, l2)) / tanHalf);
    const t = R * tanHalf;
    const A = { u: p.u - d1.u * t, v: p.v - d1.v * t };
    // Left-hand normal in the (u, v) frame: v is to the right of u, so +turn (right) curves toward +v of d1.
    const side = turnDeg > 0 ? 1 : -1;
    const n1 = { u: -d1.v * side, v: d1.u * side };
    const c = { u: A.u + n1.u * R, v: A.v + n1.v * R };
    const a0 = Math.atan2(A.v - c.v, A.u - c.u);
    const sweep = side * theta;
    const steps = Math.max(2, Math.ceil((R * theta) / ARC_STEP_M));
    let mid = A;
    for (let k = 0; k <= steps; k++) {
      const ang = a0 + (sweep * k) / steps;
      const q = { u: c.u + R * Math.cos(ang), v: c.v + R * Math.sin(ang) };
      out.push(q);
      if (k === Math.round(steps / 2)) mid = q;
    }
    turns.push({ i: out.length - 1 - Math.floor(steps / 2), turnDeg, name: corners[i].nameOut, mid });
  }
  out.push(corners[corners.length - 1].p);

  // Along-route distance and NED.
  const points: TaxiRoute['points'] = [];
  let s = 0;
  for (let k = 0; k < out.length; k++) {
    if (k > 0) s += Math.hypot(out[k].u - out[k - 1].u, out[k].v - out[k - 1].v);
    const n = localToNed(out[k].u, out[k].v);
    if (k > 0 && points[points.length - 1] && Math.abs(points[points.length - 1].sM - s) < 1e-6) continue;
    points.push({ north: n.north, east: n.east, sM: s });
  }
  const lengthM = s;
  const sAt = (q: { u: number; v: number }): number => {
    let best = Infinity, bs = 0, acc = 0;
    for (let k = 1; k < out.length; k++) {
      const pr = segProject(q, out[k - 1], out[k]);
      const len = Math.hypot(out[k].u - out[k - 1].u, out[k].v - out[k - 1].v);
      if (pr.d < best) {
        best = pr.d;
        bs = acc + pr.t * len;
      }
      acc += len;
    }
    return bs;
  };
  const waypoints: TaxiWaypoint[] = turns.map((tw) => {
    const n = localToNed(tw.mid.u, tw.mid.v);
    const action: TaxiAction = Math.abs(tw.turnDeg) < TURN_MIN_DEG ? 'straight' : tw.turnDeg > 0 ? 'right' : 'left';
    return { action, name: tw.name, north: n.north, east: n.east, sM: sAt(tw.mid), turnDeg: Math.round(tw.turnDeg), legM: 0 };
  });
  const last = corners[corners.length - 1].p;
  const ln = localToNed(last.u, last.v);
  waypoints.push({ action: endsAtStand ? 'stop' : 'holdShort', name: to === 'parking' ? 'stand' : to, north: ln.north, east: ln.east, sM: lengthM, turnDeg: 0, legM: 0 });
  for (let k = 0; k < waypoints.length - 1; k++) waypoints[k].legM = waypoints[k + 1].sM - waypoints[k].sM;
  return { id, to, points, waypoints, lengthM, holdShort: !endsAtStand };
}

// ---- progress along a route (the taxi telemetry provider) ------------------------------------------------------

export interface RouteFix {
  /** Along-route distance of the closest centreline point, m. */
  sM: number;
  /** + right of the direction of travel, m. */
  xtrackM: number;
  /** Index of the polyline segment. */
  seg: number;
  /** True heading of the centreline there, deg. */
  trackDeg: number;
}

/**
 * The closest point of the route to (north, east). `nearS` (the previous fix) restricts the search to
 * [nearS - 20, nearS + 60] m so a route that passes near itself never jumps; it falls back to the whole route
 * when nothing in the window is within 30 m.
 */
export function fixOnRoute(r: TaxiRoute, north: number, east: number, nearS?: number): RouteFix {
  const pts = r.points;
  const search = (lo: number, hi: number): { d: number; fix: RouteFix } | null => {
    let best: { d: number; fix: RouteFix } | null = null;
    for (let k = 1; k < pts.length; k++) {
      const a = pts[k - 1], b = pts[k];
      if (b.sM < lo || a.sM > hi) continue;
      const dn = b.north - a.north, de = b.east - a.east;
      const L = Math.hypot(dn, de);
      if (L < 1e-6) continue;
      const un = dn / L, ue = de / L;
      const t = Math.max(0, Math.min(L, (north - a.north) * un + (east - a.east) * ue));
      const pn = a.north + un * t, pe = a.east + ue * t;
      const d = Math.hypot(north - pn, east - pe);
      if (!best || d < best.d) {
        best = { d, fix: { sM: a.sM + t, xtrackM: un * (east - a.east) - ue * (north - a.north), seg: k - 1, trackDeg: ((Math.atan2(ue, un) * RAD) + 360) % 360 } };
      }
    }
    return best;
  };
  if (nearS !== undefined && Number.isFinite(nearS)) {
    const w = search(nearS - 20, nearS + 60);
    if (w && w.d < 30) return w.fix;
  }
  return (search(-Infinity, Infinity) ?? { d: 0, fix: { sM: 0, xtrackM: 0, seg: 0, trackDeg: 0 } }).fix;
}

/** Taxiway names as an instructor says them: 'Alpha', 'B1', 'the apron line', 'the stand'. */
export function spokenTaxiway(name: string): string {
  if (name === 'A') return 'Alpha';
  if (name === 'apron') return 'the apron line';
  if (name === 'stand') return 'the stand';
  return name;
}
