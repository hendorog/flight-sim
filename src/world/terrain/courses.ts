// Course-first valleys (Round X): every valley's course - the 1 km model's channels (erosion.ts floorLines) and the
// threshold hillslopes' own channels (hillslopes.ts) - is first laid as a winding line between the grid points: its
// routed path, smoothed, then swung across its own direction by a seeded wander whose octaves are the calibrated NZ
// sizes (1.5 / 3 / 6 km, 110 / 220 / 380 m; a small valley's scaled down by its catchment), held to a share of the
// room to the next course, and none at a lake, a mouth or a head. A tributary's course ends on its receiver's final
// course. Both the fine-grid valley carve (hill country and foothills) and the threshold-hillslope lower envelope
// (mountains) are built directly about these bent courses, so every valley and the river or stream inside it wind
// together without grid-aligned straight troughs or off-course benches.

import { mulberry32 } from './noise';
import { seeded } from '../worldSeed';

export const COURSE_ON = true;
/** The wander's octaves: wavelength m, amplitude m (as a unit sine's), at full size (catchment 30 km² and more). */
export const WANDER: ReadonlyArray<[number, number]> = [
  [1500, 115],
  [3000, 260],
  [6000, 400],
];
/** A course swings at most this share of the room to the next course (what is left between its floor's edge and the
 * nearest other course's floor's edge). */
export const ROOM_SHARE = 0.45;
/** The room is looked for this far, m (beyond, the wander is not held by it). */
const ROOM_LOOK = 2000;
/** Near a junction a tributary's and its receiver's points are not each other's room within this, m. */
const JOIN_FREE = 2500;
/** A course's wander comes in over this from its head and goes out over this before a mouth, m (by its size). */
const HEAD_IN = 1000;
const MOUTH_OUT = 1500;
/** A tributary's course is blended onto its receiver's final course over this before the junction, m (by its size). */
const JOIN_BLEND = 2000;

/** Lines to bend: line p's points are start[p] .. start[p + 1] - 1. */
export interface BendLines {
  start: Int32Array;
  north: Float32Array;
  east: Float32Array;
  /** Each point's floor's half-width, m (0: a V): the room is what is left between two floors' edges. */
  half?: Float32Array;
}
export interface BendInput {
  lines: BendLines;
  /** Per point, how much of the wander it takes [0, 1] (none at a lake, held pad, or domain edge). */
  weight: Float32Array;
  /** Per line, its size factor (1 at 30 km² and more): the octaves' wavelengths and amplitudes scale by it. */
  size: Float32Array;
  /** Per line, whether its last point is a mouth (the sea, the domain's edge or ground held): none of the wander there. */
  mouth: Uint8Array;
  /** Lines already final that a line here may end on (their points final), or null. */
  fixed: BendLines | null;
}

/** The seeded band noise of one octave along s: four sines of wavelength within 0.75-1.33 of lam, random phases; rms
 * as a unit sine's. */
function band(s: Float64Array, lam: number, rnd: () => number, out: Float64Array, amp: number): void {
  for (let j = 0; j < 4; j++) {
    const l = lam * Math.exp(Math.log(0.75) + rnd() * (Math.log(1.33) - Math.log(0.75)));
    const ph = rnd() * 2 * Math.PI;
    const k = (2 * Math.PI) / l;
    for (let i = 0; i < s.length; i++) out[i] += (amp / 2) * Math.sin(k * s[i] + ph);
  }
}
const smoothstep = (a: number, b: number, v: number): number => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Spatial hash of points (cell `c` m). */
class PointHash {
  private map = new Map<number, number[]>();
  constructor(private c: number) {}
  private key(n: number, e: number): number {
    return Math.floor(n / this.c + 4096) * 8192 + Math.floor(e / this.c + 4096);
  }
  add(n: number, e: number, id: number): void {
    const k = this.key(n, e);
    const a = this.map.get(k);
    if (a) a.push(id);
    else this.map.set(k, [id]);
  }
  near(n: number, e: number, r: number, fn: (id: number) => void): void {
    const c = this.c;
    const i0 = Math.floor((n - r) / c + 4096), i1 = Math.floor((n + r) / c + 4096);
    const j0 = Math.floor((e - r) / c + 4096), j1 = Math.floor((e + r) / c + 4096);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const a = this.map.get(i * 8192 + j);
      if (a) for (const id of a) fn(id);
    }
  }
}

/** Probes: what the last bendCourses did. */
export const bendStats = { lines: 0, points: 0, joined: 0, roomHeld: 0, maxOffset: 0, rmsOffset: 0 };

/**
 * Lay the lines' courses as winding lines (see the head of the file): the new north/east of every point, and per
 * point the displacement from the line as given. Deterministic (the wander is seeded by the world seed and the line's
 * head).
 */
export function bendCourses(inp: BendInput): { north: Float32Array; east: Float32Array; dn: Float32Array; de: Float32Array } {
  const L = inp.lines;
  const P = L.north.length;
  const nL = L.start.length - 1;
  const lineOf = new Int32Array(P);
  for (let p = 0; p < nL; p++) for (let k = L.start[p]; k < L.start[p + 1]; k++) lineOf[k] = p;
  // Arc length and the line's own normal (its tangent smoothed over about 200 m).
  const s = new Float64Array(P);
  const nn = new Float64Array(P);
  const ne = new Float32Array(P);
  for (let p = 0; p < nL; p++) {
    const k0 = L.start[p], k1 = L.start[p + 1] - 1;
    for (let k = k0 + 1; k <= k1; k++) s[k] = s[k - 1] + Math.hypot(L.north[k] - L.north[k - 1], L.east[k] - L.east[k - 1]);
    let a = k0;
    let b = k0;
    for (let k = k0; k <= k1; k++) {
      while (a < k && s[k] - s[a] > 100) a++;
      while (b < k1 && s[b] - s[k] < 100) b++;
      const tn = L.north[b] - L.north[a], te = L.east[b] - L.east[a];
      const l = Math.hypot(tn, te) || 1;
      nn[k] = -te / l;
      ne[k] = tn / l;
    }
  }
  // Each line's receiver: the line (here, or fixed) with a point nearest its last point, within 150 m.
  const hash = new PointHash(500);
  for (let k = 0; k < P; k++) hash.add(L.north[k], L.east[k], k);
  const F = inp.fixed;
  const fhash = new PointHash(500);
  if (F) for (let k = 0; k < F.north.length; k++) fhash.add(F.north[k], F.east[k], k);
  const recv = new Int32Array(nL).fill(-1);
  const recvK = new Int32Array(nL).fill(-1);
  const recvFixed = new Int32Array(nL).fill(-1);
  for (let p = 0; p < nL; p++) {
    if (inp.mouth[p]) continue;
    const k1 = L.start[p + 1] - 1;
    const n0 = L.north[k1], e0 = L.east[k1];
    let best = 150;
    hash.near(n0, e0, 150, (k) => {
      if (lineOf[k] === p) return;
      const d = Math.hypot(L.north[k] - n0, L.east[k] - e0);
      if (d < best) {
        best = d;
        recv[p] = lineOf[k];
        recvK[p] = k;
      }
    });
    if (F) {
      fhash.near(n0, e0, 150, (k) => {
        const d = Math.hypot(F.north[k] - n0, F.east[k] - e0);
        if (d < best) {
          best = d;
          recv[p] = -1;
          recvK[p] = -1;
          recvFixed[p] = k;
        }
      });
    }
  }
  // The room: each point's distance to the nearest point of another line, a tributary and its receiver not each
  // other's near their junction; looked for to ROOM_LOOK. (Fixed lines are room too.)
  const joinAt = new Map<number, Array<[number, number, number]>>();
  for (let p = 0; p < nL; p++) {
    if (recv[p] < 0) continue;
    const k1 = L.start[p + 1] - 1;
    const J: [number, number, number] = [recv[p], L.north[k1], L.east[k1]];
    (joinAt.get(p) ?? joinAt.set(p, []).get(p)!).push(J);
    (joinAt.get(recv[p]) ?? joinAt.set(recv[p], []).get(recv[p])!).push([p, L.north[k1], L.east[k1]]);
  }
  const room = new Float32Array(P).fill(ROOM_LOOK);
  for (let k = 0; k < P; k++) {
    const p = lineOf[k];
    const n0 = L.north[k], e0 = L.east[k];
    const js = joinAt.get(p);
    let best = ROOM_LOOK;
    const h0 = L.half ? L.half[k] : 0;
    hash.near(n0, e0, ROOM_LOOK, (q) => {
      const o = lineOf[q];
      if (o === p) return;
      const d = Math.max(0, Math.hypot(L.north[q] - n0, L.east[q] - e0) - h0 - (L.half ? L.half[q] : 0));
      if (d >= best) return;
      if (js) for (const [ol, jn, je] of js) if (ol === o && Math.hypot(L.north[q] - jn, L.east[q] - je) < JOIN_FREE && Math.hypot(n0 - jn, e0 - je) < JOIN_FREE) return;
      best = d;
    });
    if (F) {
      fhash.near(n0, e0, ROOM_LOOK, (q) => {
        const d = Math.max(0, Math.hypot(F.north[q] - n0, F.east[q] - e0) - h0 - (F.half ? F.half[q] : 0));
        if (d >= best) return;
        if (recvFixed[p] >= 0) {
          const jn = F.north[recvFixed[p]], je = F.east[recvFixed[p]];
          if (Math.hypot(F.north[q] - jn, F.east[q] - je) < JOIN_FREE && Math.hypot(n0 - jn, e0 - je) < JOIN_FREE) return;
        }
        best = d;
      });
    }
    room[k] = best;
  }
  // Order: receivers before their tributaries.
  const order: number[] = [];
  const done = new Uint8Array(nL);
  const visit = (p: number): void => {
    const stack: number[] = [];
    let q = p;
    while (q >= 0 && !done[q]) {
      stack.push(q);
      q = recv[q];
      if (stack.length > nL) break;
    }
    for (let i = stack.length - 1; i >= 0; i--) {
      if (done[stack[i]]) continue;
      done[stack[i]] = 1;
      order.push(stack[i]);
    }
  };
  for (let p = 0; p < nL; p++) visit(p);
  const north = Float32Array.from(L.north);
  const east = Float32Array.from(L.east);
  const dn = new Float32Array(P);
  const de = new Float32Array(P);
  let sum2 = 0;
  let maxO = 0;
  let held = 0;
  let joined = 0;
  for (const p of order) {
    const k0 = L.start[p], k1 = L.start[p + 1] - 1;
    const m = k1 - k0 + 1;
    if (m < 2) continue;
    const f = inp.size[p];
    const len = s[k1];
    const sp = new Float64Array(m);
    for (let i = 0; i < m; i++) sp[i] = s[k0 + i];
    const o = new Float64Array(m);
    const rnd = mulberry32(seeded((Math.round(L.north[k0] / 7) * 73856093) ^ (Math.round(L.east[k0] / 7) * 19349663) ^ 0x5eed));
    for (const [lam, amp] of WANDER) band(sp, lam * f, rnd, o, amp * f);
    // The room, its least within 300 m along, smoothed: the wander held to ROOM_SHARE of it (smoothly).
    const rm = new Float64Array(m);
    for (let i = 0, a = 0, b = 0; i < m; i++) {
      while (sp[i] - sp[a] > 300) a++;
      while (b < m - 1 && sp[b + 1] - sp[i] <= 300) b++;
      let v = Infinity;
      for (let j = a; j <= b; j++) v = Math.min(v, room[k0 + j]);
      rm[i] = v;
    }
    for (let i = 0; i < m; i++) {
      const c = Math.max(1, ROOM_SHARE * rm[i]);
      const v = c * Math.tanh(o[i] / c);
      if (Math.abs(v) < 0.8 * Math.abs(o[i])) held++;
      const head = smoothstep(0, HEAD_IN * f, sp[i]);
      const tail = inp.mouth[p] ? smoothstep(0, MOUTH_OUT * f, len - sp[i]) : 1;
      o[i] = v * head * tail * inp.weight[k0 + i];
    }
    // Onto the receiver's final course: the displacement that takes this line's last point onto it.
    let Jn = 0, Je = 0, hasJ = false;
    if (recv[p] >= 0) {
      const kq = recvK[p];
      Jn = dn[kq];
      Je = de[kq];
      hasJ = true;
    } else if (recvFixed[p] >= 0 && F) {
      Jn = F.north[recvFixed[p]] - L.north[k1];
      Je = F.east[recvFixed[p]] - L.east[k1];
      hasJ = true;
    }
    if (hasJ) joined++;
    for (let i = 0; i < m; i++) {
      const k = k0 + i;
      const wj = hasJ ? smoothstep(len - JOIN_BLEND * f, len, sp[i]) : 0;
      dn[k] = (1 - wj) * nn[k] * o[i] + wj * Jn;
      de[k] = (1 - wj) * ne[k] * o[i] + wj * Je;
      north[k] = L.north[k] + dn[k];
      east[k] = L.east[k] + de[k];
      sum2 += o[i] * o[i];
      maxO = Math.max(maxO, Math.abs(o[i]));
    }
  }
  bendStats.lines = nL;
  bendStats.points = P;
  bendStats.joined = joined;
  bendStats.roomHeld = held;
  bendStats.maxOffset = maxO;
  bendStats.rmsOffset = Math.sqrt(sum2 / Math.max(1, P));
  return { north, east, dn, de };
}

/** The displacement of the model's courses (erosion.ts sets it): looked up for the rivers' axes laid on the same
 * courses (riverNetwork.ts), from the nearest point of the courses as given, within `R` m (else none). */
export class CourseBend {
  private hash = new PointHash(300);
  constructor(private n: Float32Array, private e: Float32Array, private dn: Float32Array, private de: Float32Array) {
    for (let k = 0; k < n.length; k++) this.hash.add(n[k], e[k], k);
  }
  /** The displacement at (north, east): the courses' points' within FIELD_R, weighted (1 - (d / FIELD_R)²)², so a river
   * laid beside a model course (the drainage's routing leaves the model's cells by a cell or so) moves as the course
   * beside it does, and smoothly between courses; false (none) beyond. */
  at(north: number, east: number, out: { n: number; e: number }, R = FIELD_R): boolean {
    let sw = 0, sn = 0, se = 0;
    this.hash.near(north, east, R, (k) => {
      const d = Math.hypot(this.n[k] - north, this.e[k] - east);
      if (d >= R) return;
      const u = 1 - (d / R) * (d / R);
      const w = u * u;
      sw += w;
      sn += w * this.dn[k];
      se += w * this.de[k];
    });
    if (!(sw > 0)) {
      out.n = out.e = 0;
      return false;
    }
    out.n = sn / sw;
    out.e = se / sw;
    return true;
  }
}
/** The rivers' axes take the model's courses' displacement from their points within this, m. */
const FIELD_R = 600;
let lastBend: CourseBend | null = null;
export function setCourseBend(b: CourseBend | null): void {
  lastBend = b;
}
export const courseBend = (): CourseBend | null => lastBend;

/** The stream raster's cells a course runs through: the direction (streams.ts DI/DJ index) to the cell the course
 * lowest in the cell runs on into (-1: none), that course (-1: none), its nearest vertex index, and the courses
 * (heightfield.ts sets them, streams.ts reads them). */
let rasterDir: Int8Array | null = null;
let rasterOwn: Int32Array | null = null;
let rasterOwnK: Int32Array | null = null;
let rasterLines: { start: Int32Array; north: Float32Array; east: Float32Array } | null = null;
export function setCourseRaster(d: Int8Array | null, own: Int32Array | null, ownK: Int32Array | null, lines: { start: Int32Array; north: Float32Array; east: Float32Array } | null): void {
  rasterDir = d;
  rasterOwn = own;
  rasterOwnK = ownK;
  rasterLines = lines;
}
export const courseRasterDir = (): Int8Array | null => rasterDir;
/** The nearest point of the course owning raster cell q to (north, east), into out; false where no course owns it. */
export function courseSnap(q: number, north: number, east: number, out: { n: number; e: number }): boolean {
  if (!rasterOwn || !rasterLines || q < 0 || q >= rasterOwn.length) return false;
  const p = rasterOwn[q];
  if (p < 0) return false;
  const L = rasterLines;
  const s0 = L.start[p];
  const s1 = L.start[p + 1] - 1;
  const ck = rasterOwnK ? rasterOwnK[q] : -1;
  const k0 = ck >= s0 ? Math.max(s0, ck - 12) : s0;
  const k1 = ck >= s0 ? Math.min(s1, ck + 12) : s1;
  let best = Infinity;
  for (let k = k0; k < k1; k++) {
    const an = L.north[k], ae = L.east[k];
    const dn = L.north[k + 1] - an, de = L.east[k + 1] - ae;
    const l2 = dn * dn + de * de;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((north - an) * dn + (east - ae) * de) / l2)) : 0;
    const qn = an + t * dn, qe = ae + t * de;
    const d = Math.hypot(north - qn, east - qe);
    if (d < best) {
      best = d;
      out.n = qn;
      out.e = qe;
    }
  }
  return best < 250;
}
