// Farmland parcel layout, shared by the ground shader (which paints the fields) and the tree placer
// (which plants hedgerows along some field edges). The GLSL and TypeScript versions below implement the
// same function with the same integer hash, so hedgerow trees stand on the painted hedgerows.
//
// Districts are the cells of a jittered Voronoi diagram (about 2.4 km apart) over a domain warped by two
// octaves of value noise, so their borders are irregular winding lines meeting at three-way junctions -
// neither a grid nor periodic. Each district has its own orientation; inside it the land is cut into
// columns of jittered width, and each column into rows of its own length. Each column and row boundary is
// a plain grass margin, a hedgerow or a farm track (column boundaries change kind every few hundred metres,
// so hedges and tracks end and resume rather than running straight across the district); district borders
// are winding lanes.

import { hash2i } from './noise';

export const DISTRICT_M = 2400;
export const COLUMN_M = 150;
/** Domain warp of the district diagram: wavelengths and amplitudes of its two value-noise octaves, m. */
export const WARP = [
  [2200, 260],
  [650, 70],
] as const;
/** Voronoi site jitter, as a fraction of the district spacing either side of the cell centre. */
export const DISTRICT_JITTER = 0.35;
/** Column boundaries change kind (plain / hedge / track) along their length every this many metres. */
export const EDGE_SEGMENT_M = 420;

/** Edge kinds. */
export const EDGE_PLAIN = 0;
export const EDGE_HEDGE = 1;
export const EDGE_TRACK = 2;

export const FIELDS_GLSL = /* glsl */ `
const float DISTRICT_M = ${DISTRICT_M.toFixed(1)};
const float COLUMN_M = ${COLUMN_M.toFixed(1)};
struct Parcel {
  vec2 local;     // position inside the parcel, m (x across columns, y along the column)
  vec2 size;      // parcel size, m
  float id;       // random 0..1 per parcel
  float hedge;    // distance to the nearest hedgerow edge, m (large if none)
  float track;    // distance to the nearest track edge, m
  float margin;   // distance to the nearest edge of any kind, m
  float angle;    // orientation of the district lattice, rad (columns run along angle + 90 degrees)
  vec2 centre;    // parcel centre, world (east, north), m
};
float edgeKind(uint h) { float r = float(h & 0xffffu) / 65535.0; return r < 0.55 ? 0.0 : r < 0.88 ? 1.0 : 2.0; }
float colJitter(int k, int dseed) { return 0.3 * (float(hash2u(k, dseed) & 0xffffu) / 65535.0 - 0.5) * 2.0; }
// Two-component value noise in [-1, 1] on the unit lattice (quintic interpolation).
vec2 fieldNoise(vec2 p, int salt) {
  vec2 i = floor(p);
  vec2 f = p - i;
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  int ix = int(i.x), iy = int(i.y);
  uint a = hash2u(ix, iy + salt), b = hash2u(ix + 1, iy + salt);
  uint c = hash2u(ix, iy + 1 + salt), d = hash2u(ix + 1, iy + 1 + salt);
  vec2 va = vec2(float(a & 0xffffu), float(a >> 16)), vb = vec2(float(b & 0xffffu), float(b >> 16));
  vec2 vc = vec2(float(c & 0xffffu), float(c >> 16)), vd = vec2(float(d & 0xffffu), float(d >> 16));
  return mix(mix(va, vb, u.x), mix(vc, vd, u.x), u.y) * (2.0 / 65535.0) - 1.0;
}
vec2 districtSite(int x, int y) {
  uint h = hash2u(x, y + 7331);
  return vec2(float(x), float(y)) + 0.5 + ${(2 * DISTRICT_JITTER).toFixed(4)} * (vec2(float(h & 0xffffu), float(h >> 16)) / 65535.0 - 0.5);
}
Parcel parcelAt(vec2 p) {
  // District: nearest Voronoi site in the warped domain, and the distance to its border.
  vec2 pw = p + ${WARP[0][1].toFixed(1)} * fieldNoise(p / ${WARP[0][0].toFixed(1)}, 11) + ${WARP[1][1].toFixed(1)} * fieldNoise(p / ${WARP[1][0].toFixed(1)}, 23);
  vec2 g = pw / DISTRICT_M;
  ivec2 gc = ivec2(floor(g));
  ivec2 dc = gc;
  vec2 site = vec2(0.0);
  float best = 1e9;
  for (int y = -1; y <= 1; y++)
    for (int x = -1; x <= 1; x++) {
      vec2 s = districtSite(gc.x + x, gc.y + y);
      vec2 e = g - s;
      float d = dot(e, e);
      if (d < best) { best = d; site = s; dc = gc + ivec2(x, y); }
    }
  float border = 1e9;
  for (int y = -1; y <= 1; y++)
    for (int x = -1; x <= 1; x++) {
      if (x == 0 && y == 0) continue;
      vec2 s = districtSite(dc.x + x, dc.y + y);
      vec2 e = s - site;
      border = min(border, dot(0.5 * (site + s) - g, e) * inversesqrt(dot(e, e)));
    }
  int dseed = int(hash2u(dc.x, dc.y) & 0xffffffu);
  float ang = float(hash2u(dc.y, dc.x) & 0xffffu) / 65535.0 * 3.14159265;
  float c = cos(ang), s = sin(ang);
  vec2 q = vec2(c * p.x + s * p.y, -s * p.x + c * p.y);
  float fx = q.x / COLUMN_M;
  int k = int(floor(fx));
  float left = float(k) + colJitter(k, dseed);
  float right = float(k + 1) + colJitter(k + 1, dseed);
  if (fx < left) { k -= 1; right = left; left = float(k) + colJitter(k, dseed); }
  else if (fx >= right) { k += 1; left = right; right = float(k + 1) + colJitter(k + 1, dseed); }
  uint hk = hash2u(k, dseed + 1);
  float len = COLUMN_M * (0.7 + 1.8 * float(hk & 0xffffu) / 65535.0);
  float fy = q.y / len + float(hk >> 16) / 65535.0;
  int r = int(floor(fy));
  Parcel o;
  o.local = vec2((fx - left) * COLUMN_M, fract(fy) * len);
  o.size = vec2((right - left) * COLUMN_M, len);
  o.id = float(hash2u(int(hk & 0x7fffffffu), r) & 0xffffffu) / 16777215.0;
  o.angle = ang;
  vec2 qc = vec2(0.5 * (left + right) * COLUMN_M, (float(r) + 0.5 - float(hk >> 16) / 65535.0) * len);
  o.centre = vec2(c * qc.x - s * qc.y, s * qc.x + c * qc.y);
  float dL = o.local.x, dR = o.size.x - o.local.x, dB = o.local.y, dT = o.size.y - o.local.y;
  // Column boundaries: the kind changes along the boundary in segments (the same for both columns).
  int seg = int(floor(q.y / ${EDGE_SEGMENT_M.toFixed(1)}));
  float kL = edgeKind(hash2u(k, dseed + 2 + seg * 131)), kR = edgeKind(hash2u(k + 1, dseed + 2 + seg * 131));
  float kB = edgeKind(hash2u(int(hk & 0x7fffffffu), r + 7)), kT = edgeKind(hash2u(int(hk & 0x7fffffffu), r + 8));
  o.hedge = min(min(kL == 1.0 ? dL : 1e4, kR == 1.0 ? dR : 1e4), min(kB == 1.0 ? dB : 1e4, kT == 1.0 ? dT : 1e4));
  o.track = min(min(kL == 2.0 ? dL : 1e4, kR == 2.0 ? dR : 1e4), min(kB == 2.0 ? dB : 1e4, kT == 2.0 ? dT : 1e4));
  o.margin = min(min(dL, dR), min(dB, dT));
  // District borders (where the field grid changes direction) are winding farm lanes, so parcels clipped
  // by them read as fields along a lane rather than stray triangles. Distance in the warped frame, scaled
  // for the warp's typical stretch.
  border *= DISTRICT_M * 0.9;
  o.track = min(o.track, border);
  o.margin = min(o.margin, border);
  return o;
}
`;

export interface Parcel {
  id: number;
  /** Distance to the nearest hedgerow edge, m. */
  hedge: number;
  /** Distance to the nearest farm-track edge, m. */
  track: number;
  /** Distance to the nearest parcel edge of any kind, m. */
  margin: number;
  /** Distance to the district border (a lane), m. */
  border: number;
  /** District cell (Voronoi site index). */
  districtX: number;
  districtY: number;
}

const u16 = (h: number): number => (h & 0xffff) / 65535;
const edgeKind = (h: number): number => {
  const r = u16(h);
  return r < 0.55 ? EDGE_PLAIN : r < 0.88 ? EDGE_HEDGE : EDGE_TRACK;
};
const colJitter = (k: number, dseed: number): number => 0.3 * (u16(hash2i(k, dseed)) - 0.5) * 2;

const noiseOut = { x: 0, y: 0 };
/** TypeScript twin of fieldNoise() in FIELDS_GLSL; result in noiseOut. */
function fieldNoise(px: number, py: number, salt: number): void {
  const ix = Math.floor(px);
  const iy = Math.floor(py);
  const fx = px - ix;
  const fy = py - iy;
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const a = hash2i(ix, iy + salt);
  const b = hash2i(ix + 1, iy + salt);
  const c = hash2i(ix, iy + 1 + salt);
  const d = hash2i(ix + 1, iy + 1 + salt);
  noiseOut.x = bilerp(a & 0xffff, b & 0xffff, c & 0xffff, d & 0xffff, ux, uy) * (2 / 65535) - 1;
  noiseOut.y = bilerp(a >>> 16, b >>> 16, c >>> 16, d >>> 16, ux, uy) * (2 / 65535) - 1;
}

function bilerp(a: number, b: number, c: number, d: number, u: number, v: number): number {
  const top = a + (b - a) * u;
  const bottom = c + (d - c) * u;
  return top + (bottom - top) * v;
}

const siteOut = { x: 0, y: 0 };
function districtSite(x: number, y: number): void {
  const h = hash2i(x, y + 7331);
  siteOut.x = x + 0.5 + 2 * DISTRICT_JITTER * (u16(h) - 0.5);
  siteOut.y = y + 0.5 + 2 * DISTRICT_JITTER * ((h >>> 16) / 65535 - 0.5);
}

/** TypeScript twin of parcelAt() in FIELDS_GLSL. `east`, `north` in m. */
export function parcelAt(east: number, north: number, out: Parcel): Parcel {
  fieldNoise(east / WARP[0][0], north / WARP[0][0], 11);
  let pwx = east + WARP[0][1] * noiseOut.x;
  let pwy = north + WARP[0][1] * noiseOut.y;
  fieldNoise(east / WARP[1][0], north / WARP[1][0], 23);
  pwx += WARP[1][1] * noiseOut.x;
  pwy += WARP[1][1] * noiseOut.y;
  const gx = pwx / DISTRICT_M;
  const gy = pwy / DISTRICT_M;
  const gcx = Math.floor(gx);
  const gcy = Math.floor(gy);
  let dcx = gcx;
  let dcy = gcy;
  let sx = 0;
  let sy = 0;
  let best = Infinity;
  for (let y = -1; y <= 1; y++) {
    for (let x = -1; x <= 1; x++) {
      districtSite(gcx + x, gcy + y);
      const ex = gx - siteOut.x;
      const ey = gy - siteOut.y;
      const d = ex * ex + ey * ey;
      if (d < best) {
        best = d;
        sx = siteOut.x;
        sy = siteOut.y;
        dcx = gcx + x;
        dcy = gcy + y;
      }
    }
  }
  let border = Infinity;
  for (let y = -1; y <= 1; y++) {
    for (let x = -1; x <= 1; x++) {
      if (x === 0 && y === 0) continue;
      districtSite(dcx + x, dcy + y);
      const ex = siteOut.x - sx;
      const ey = siteOut.y - sy;
      const d = ((0.5 * (sx + siteOut.x) - gx) * ex + (0.5 * (sy + siteOut.y) - gy) * ey) / Math.sqrt(ex * ex + ey * ey);
      border = Math.min(border, d);
    }
  }
  const dseed = hash2i(dcx, dcy) & 0xffffff;
  const ang = u16(hash2i(dcy, dcx)) * 3.14159265;
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  const qx = c * east + s * north;
  const qy = -s * east + c * north;
  const fx = qx / COLUMN_M;
  let k = Math.floor(fx);
  let left = k + colJitter(k, dseed);
  let right = k + 1 + colJitter(k + 1, dseed);
  if (fx < left) {
    k -= 1;
    right = left;
    left = k + colJitter(k, dseed);
  } else if (fx >= right) {
    k += 1;
    left = right;
    right = k + 1 + colJitter(k + 1, dseed);
  }
  const hk = hash2i(k, dseed + 1);
  const len = COLUMN_M * (0.7 + 1.8 * u16(hk));
  const fy = qy / len + (hk >>> 16) / 65535;
  const r = Math.floor(fy);
  const lx = (fx - left) * COLUMN_M;
  const ly = (fy - r) * len;
  const sxw = (right - left) * COLUMN_M;
  const hk31 = hk & 0x7fffffff;
  out.id = (hash2i(hk31, r) & 0xffffff) / 16777215;
  const dL = lx;
  const dR = sxw - lx;
  const dB = ly;
  const dT = len - ly;
  const seg = Math.floor(qy / EDGE_SEGMENT_M);
  const kL = edgeKind(hash2i(k, dseed + 2 + seg * 131));
  const kR = edgeKind(hash2i(k + 1, dseed + 2 + seg * 131));
  const kB = edgeKind(hash2i(hk31, r + 7));
  const kT = edgeKind(hash2i(hk31, r + 8));
  border *= DISTRICT_M * 0.9;
  out.border = border;
  out.districtX = dcx;
  out.districtY = dcy;
  out.hedge = Math.min(kL === EDGE_HEDGE ? dL : 1e4, kR === EDGE_HEDGE ? dR : 1e4, kB === EDGE_HEDGE ? dB : 1e4, kT === EDGE_HEDGE ? dT : 1e4);
  const track = Math.min(kL === EDGE_TRACK ? dL : 1e4, kR === EDGE_TRACK ? dR : 1e4, kB === EDGE_TRACK ? dB : 1e4, kT === EDGE_TRACK ? dT : 1e4);
  out.track = Math.min(track, border);
  out.margin = Math.min(dL, dR, dB, dT, border);
  return out;
}

export function makeParcel(): Parcel {
  return { id: 0, hedge: 1e4, track: 1e4, margin: 1e4, border: 1e4, districtX: 0, districtY: 0 };
}
