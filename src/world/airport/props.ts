// Parked general-aviation aircraft (high-wing Cessna 172 and low-wing PA-28 types) and apron vehicles.
// Aircraft are instanced per part: white airframe, accent trim (per-instance colour), glass and dark parts.
// Model frame: nose toward -z, right wing +x, up +y, origin at the C172 reference point (1.25 m above ground).

import * as THREE from 'three';
import { C172 } from '../../core/c172';
import { CG_HEIGHT_ON_GROUND } from '../../core/mockState';
import { boxGeo, cylGeo, GeometryBatch, placement, polyGeo, v3 } from './geom';
import { BUILDINGS, FUEL_ISLAND, nedToLocal, PARKING, PARKING_SPOTS } from './layout';
import { rng } from './noise';
import { forInstancing, type MaterialSet } from './materials';
import { TAXIWAY_HEIGHT } from './pavement';

/** Fuselage station: FRD x (m), width, height, centre height (three y). */
type Station = [number, number, number, number];

const FUSELAGE: Station[] = [
  [2.25, 0.02, 0.02, -0.08],
  [2.1, 0.36, 0.36, -0.08],
  [1.95, 0.76, 0.72, -0.08],
  [1.3, 1.0, 1.02, -0.05],
  [0.6, 1.06, 1.16, 0.0],
  [0.0, 1.06, 1.22, 0.02],
  [-1.2, 1.0, 1.1, 0.02],
  [-2.2, 0.72, 0.82, 0.08],
  [-4.0, 0.36, 0.52, 0.18],
  [-5.3, 0.2, 0.36, 0.26],
  [-6.03, 0.06, 0.18, 0.3],
];

/**
 * Lofted body through superelliptic cross-sections. angle0..angle1 (radians, 0 = right side, PI/2 = top)
 * restricts it to a band (used for the trim stripe); `grow` inflates it slightly so the band sits proud.
 */
function loft(stations: Station[], seg = 16, angle0 = 0, angle1 = Math.PI * 2, grow = 0): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  const closed = angle1 - angle0 >= Math.PI * 2 - 1e-6;
  const ring = closed ? seg : seg + 1;
  for (const [x, w, h, cy] of stations) {
    for (let i = 0; i < ring; i++) {
      const a = angle0 + ((angle1 - angle0) * i) / seg;
      const c = Math.cos(a), s = Math.sin(a);
      // superellipse, exponent 2.6: boxy but rounded, like a riveted light-aircraft fuselage
      const e = 2 / 2.6;
      const px = Math.sign(c) * Math.pow(Math.abs(c), e) * (w / 2 + grow);
      const py = Math.sign(s) * Math.pow(Math.abs(s), e) * (h / 2 + grow);
      pos.push(px, cy + py, -x);
    }
  }
  for (let k = 0; k < stations.length - 1; k++) {
    for (let i = 0; i < (closed ? ring : ring - 1); i++) {
      const a = k * ring + i, b = k * ring + ((i + 1) % ring), c = a + ring, d = b + ring;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Tapered flat surface (wing, tail) as a thin box between two chord lines. */
function surface(rootLE: THREE.Vector3, rootTE: THREE.Vector3, tipLE: THREE.Vector3, tipTE: THREE.Vector3, thick: number, up: THREE.Vector3): THREE.BufferGeometry[] {
  const off = up.clone().multiplyScalar(thick / 2);
  const top = [rootLE, tipLE, tipTE, rootTE].map((p) => p.clone().add(off));
  const bot = [rootLE, tipLE, tipTE, rootTE].map((p) => p.clone().sub(off));
  const parts = [polyGeo(top, up), polyGeo(bot, up.clone().negate())];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    const mid = top[i].clone().add(top[j]).add(bot[i]).add(bot[j]).multiplyScalar(0.25);
    const centre = top.reduce((s, p) => s.add(p), new THREE.Vector3()).multiplyScalar(0.25);
    parts.push(polyGeo([top[i], top[j], bot[j], bot[i]], mid.sub(centre)));
  }
  return parts;
}

/**
 * Wing panel with a NACA 2412 section (12 % thick, 2 % camber) lofted from the root to the tip, with a closed
 * tip. Leading-edge points in model space; the chord runs aft along +z.
 */
export function airfoilWing(rootLE: THREE.Vector3, tipLE: THREE.Vector3, rootChord: number, tipChord: number): THREE.BufferGeometry {
  const n = 12;
  const section: [number, number][] = []; // (x along chord 0..1, y) closed loop: upper TE -> LE -> lower TE
  const pt = (x: number, upper: boolean): [number, number] => {
    const t = 0.12, m = 0.02, p = 0.4;
    const yt = 5 * t * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
    const yc = x < p ? (m / (p * p)) * (2 * p * x - x * x) : (m / ((1 - p) ** 2)) * (1 - 2 * p + 2 * p * x - x * x);
    return [x, yc + (upper ? yt : -yt)];
  };
  for (let i = n; i >= 0; i--) section.push(pt(0.5 - 0.5 * Math.cos((Math.PI * i) / n), true));
  for (let i = 1; i < n; i++) section.push(pt(0.5 - 0.5 * Math.cos((Math.PI * i) / n), false));
  const ring = section.length;
  const pos: number[] = [];
  for (const [le, c] of [[rootLE, rootChord], [tipLE, tipChord]] as [THREE.Vector3, number][]) {
    for (const [x, y] of section) pos.push(le.x, le.y + y * c, le.z + x * c);
  }
  const idx: number[] = [];
  // The skin winding that faces outward depends on which way the panel runs (left or right wing).
  const flip = tipLE.x > rootLE.x;
  const tri = (a: number, b: number, c: number) => (flip ? idx.push(a, c, b) : idx.push(a, b, c));
  for (let i = 0; i < ring; i++) {
    const j = (i + 1) % ring;
    tri(i, j, ring + i);
    tri(j, ring + j, ring + i);
  }
  // Tip and root caps (fans from the mid-chord point).
  for (const s of [0, 1]) {
    const base = pos.length / 3;
    const le = s === 0 ? rootLE : tipLE, c = s === 0 ? rootChord : tipChord;
    pos.push(le.x, le.y + 0.02 * c, le.z + 0.4 * c);
    for (let i = 0; i < ring; i++) {
      const j = (i + 1) % ring;
      if (s === 1) tri(base, s * ring + i, s * ring + j);
      else tri(base, s * ring + j, s * ring + i);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
  g.setIndex(idx);
  // Orient consistently: flip if the first quad's normal points into the section.
  g.computeVertexNormals();
  return g.toNonIndexed();
}

/** Cylinder between two points. */
function rod(a: THREE.Vector3, b: THREE.Vector3, r: number): { geo: THREE.BufferGeometry; m: THREE.Matrix4 } {
  const len = a.distanceTo(b);
  const m = new THREE.Matrix4().lookAt(a, b, Math.abs(b.y - a.y) > 0.99 * len ? v3(1, 0, 0) : v3(0, 1, 0));
  m.multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2)).setPosition(a.clone().add(b).multiplyScalar(0.5));
  return { geo: cylGeo(r, r, len, 6), m };
}

interface AircraftParts {
  body: THREE.BufferGeometry;
  trim: THREE.BufferGeometry;
  glass: THREE.BufferGeometry;
  dark: THREE.BufferGeometry;
}

function buildAircraft(lowWing: boolean): AircraftParts {
  const body = new GeometryBatch(), trim = new GeometryBatch(), glass = new GeometryBatch(), dark = new GeometryBatch();
  const up = v3(0, 1, 0);
  body.add(loft(FUSELAGE));
  // Accent stripes along both sides.
  trim.add(loft(FUSELAGE.slice(2), 6, -0.35, -0.12, 0.01));
  trim.add(loft(FUSELAGE.slice(2), 6, Math.PI + 0.12, Math.PI + 0.35, 0.01));

  const w = C172.wing;
  const span = lowWing ? 10.7 : w.span;
  const wy = lowWing ? -0.42 : -w.quarterChord.z + 0.05;
  const rc = lowWing ? 1.6 : w.rootChord, tc = lowWing ? 1.6 : w.tipChord;
  const dihedral = lowWing ? 7 * Math.PI / 180 : w.dihedral;
  for (const side of [-1, 1]) {
    const tipY = wy + (span / 2) * Math.tan(dihedral);
    body.add(airfoilWing(v3(side * 0.5, wy, -rc / 4), v3((side * span) / 2, tipY, -tc / 4), rc, tc));
    if (!lowWing) {
      const s = w.strut;
      const r = rod(v3(side * s.fuselage.y, -s.fuselage.z, -s.fuselage.x), v3(side * s.wing.y, -s.wing.z, -s.wing.x), 0.035);
      body.add(r.geo, r.m);
    }
    // Wing-tip accent.
    trim.add(boxGeo(0.1, 0.18, tc * 0.9), placement((side * span) / 2, tipY, tc / 4));
  }
  // Horizontal tail and fin.
  const ht = C172.hTail;
  const hx = -ht.quarterChord.x, hy = -ht.quarterChord.z + (lowWing ? -0.1 : 0);
  for (const side of [-1, 1]) {
    for (const g of surface(v3(side * 0.2, hy, hx - ht.rootChord / 4), v3(side * 0.2, hy, hx + (3 * ht.rootChord) / 4), v3((side * ht.span) / 2, hy, hx - ht.tipChord / 4 + 0.25), v3((side * ht.span) / 2, hy, hx + (3 * ht.tipChord) / 4), 0.08, up)) body.add(g);
  }
  const fin = surface(v3(0, 0.25, 4.1), v3(0, 0.25, 6.0), v3(0, 1.5, 5.05), v3(0, 1.5, 5.75), 0.08, v3(1, 0, 0));
  fin.forEach((g) => body.add(g));
  trim.add(boxGeo(0.1, 0.22, 1.2), placement(0, 1.1, 5.35));

  // Windows: windscreen and cabin side windows.
  glass.add(polyGeo([v3(-0.44, 0.48, -1.3), v3(0.44, 0.48, -1.3), v3(0.5, 0.65, -0.35), v3(-0.5, 0.65, -0.35)], v3(0, 1, -1)));
  for (const side of [-1, 1]) {
    glass.add(polyGeo([v3(side * 0.537, 0.12, -0.55), v3(side * 0.537, 0.12, 1.25), v3(side * 0.51, 0.5, 1.1), v3(side * 0.537, 0.55, -0.3)], v3(side, 0, 0)));
  }

  // Landing gear, wheels and propeller.
  const g = C172.gear;
  for (const side of [-1, 1]) {
    const wheel = v3(side * g.leftMain.y * -1, -g.leftMain.z + g.mainWheelRadius, -g.leftMain.x);
    const leg = rod(v3(side * 0.45, -0.5, wheel.z), wheel, 0.04);
    body.add(leg.geo, leg.m);
    dark.add(cylGeo(g.mainWheelRadius, g.mainWheelRadius, 0.15, 14), placement(wheel.x, wheel.y, wheel.z, 0, 0, Math.PI / 2));
    // Wheel fairing (speed fairing): a small lofted teardrop around the wheel.
    const f: Station[] = [[0.42, 0.02, 0.02, 0.0], [0.3, 0.18, 0.3, 0.0], [0.0, 0.24, 0.4, 0.02], [-0.3, 0.2, 0.3, 0.05], [-0.55, 0.04, 0.06, 0.08]];
    body.add(loft(f, 12), placement(wheel.x, wheel.y + 0.04, wheel.z));
  }
  const nw = v3(0, -g.nose.z + g.noseWheelRadius, -g.nose.x);
  const ns = rod(v3(0, -0.45, nw.z + 0.1), nw, 0.05);
  dark.add(ns.geo, ns.m, 0x999999);
  dark.add(cylGeo(g.noseWheelRadius, g.noseWheelRadius, 0.13, 14), placement(nw.x, nw.y, nw.z, 0, 0, Math.PI / 2));
  // Spinner and a two-blade propeller.
  body.add(cylGeo(0.02, 0.17, 0.36, 16), placement(0, -0.08, -2.43, 0, -Math.PI / 2));
  for (const s of [-1, 1]) {
    dark.add(boxGeo(0.11, 0.9, 0.035), placement(0, -0.08 + s * 0.52, -2.3, 0, 0, s * 0.02).multiply(placement(0, 0, 0, s * 0.35)));
  }
  return { body: body.build(), trim: trim.build(), glass: glass.build(), dark: dark.build() };
}

const TRIM_COLORS = [0x1f3f7a, 0x7a1f1f, 0x2a5a2a, 0x8a6a1a, 0x303030, 0x1a5a7a, 0x6a2a6a];

export interface ApronProps {
  meshes: THREE.Object3D[];
}

/** Parked aircraft on about half the apron spots (never the player's spot), plus a fuel truck and a tug. */
export function createProps(mats: MaterialSet): ApronProps {
  const r = rng(172);
  const player = nedToLocal(PARKING.north, PARKING.east);
  const placements: { m: THREE.Matrix4; low: boolean; trim: THREE.Color; body: THREE.Color }[] = [];
  for (const s of PARKING_SPOTS) {
    if (Math.hypot(s.u - player.u, s.v - player.v) < 1) continue;
    if (r() > 0.55) continue;
    const rot = s.facing > 0 ? -Math.PI / 2 : Math.PI / 2;
    placements.push({
      m: placement(s.v, CG_HEIGHT_ON_GROUND + TAXIWAY_HEIGHT, -s.u, rot + (r() - 0.5) * 0.08),
      low: r() < 0.35,
      trim: new THREE.Color(TRIM_COLORS[Math.floor(r() * TRIM_COLORS.length)]),
      body: new THREE.Color().setHSL(0.1, 0.1, 0.86 + r() * 0.08),
    });
  }
  const meshes: THREE.Object3D[] = [];
  for (const low of [false, true]) {
    const list = placements.filter((p) => p.low === low);
    if (list.length === 0) continue;
    const parts = buildAircraft(low);
    const partMats: [keyof AircraftParts, THREE.Material][] = [['body', mats.paint], ['trim', mats.paint], ['glass', mats.glass], ['dark', mats.rubber]];
    for (const [key, mat] of partMats) {
      const im = new THREE.InstancedMesh(parts[key], forInstancing(mat), list.length);
      list.forEach((p, i) => {
        im.setMatrixAt(i, p.m);
        im.setColorAt(i, key === 'body' ? p.body : key === 'trim' ? p.trim : new THREE.Color(key === 'glass' ? 0xffffff : 0x1c1c1c));
      });
      im.castShadow = im.receiveShadow = true;
      im.name = `parked-${low ? 'pa28' : 'c172'}-${key}`;
      meshes.push(im);
    }
  }
  meshes.push(...vehicles(mats));
  return { meshes };
}

/** Fuel truck by the fuel island and a tow tug by hangar 1. */
function vehicles(mats: MaterialSet): THREE.Mesh[] {
  const paint = new GeometryBatch(), dark = new GeometryBatch();
  // Fuel truck: cab + tank, nose toward +u, parked beside the island.
  const tu = FUEL_ISLAND.u - 1, tv = FUEL_ISLAND.v + 4;
  const tr = placement(tv, TAXIWAY_HEIGHT, -tu, Math.PI);
  const t = (x: number, y: number, z: number, g: THREE.BufferGeometry, color: number, target = paint, rz = 0, rx = 0) =>
    target.add(g, tr.clone().multiply(placement(x, y, z, 0, rx, rz)), color);
  t(0, 1.4, 3.2, boxGeo(2.3, 2.0, 2.0), 0xe8e8e4);
  t(0, 1.8, 2.3, boxGeo(2.2, 0.9, 0.1), 0x20262c, dark);
  t(0, 0.75, -1.0, boxGeo(2.2, 0.35, 7.0), 0x303030, dark);
  t(0, 1.9, -1.4, cylGeo(1.05, 1.05, 5.6, 18), 0x1f4f9f, paint, 0, Math.PI / 2);
  for (const z of [3.1, -0.6, -2.8]) for (const x of [-1.05, 1.05]) t(x, 0.5, z, cylGeo(0.5, 0.5, 0.35, 14), 0x151515, dark, Math.PI / 2);
  // Tug in front of hangar 1.
  const h1 = BUILDINGS.find((b) => b.name === 'Hangar 1')!;
  const gu = (h1.u0 + h1.u1) / 2 + 9, gv = h1.v1 + 6;
  paint.add(boxGeo(1.4, 0.7, 2.2), placement(gv, TAXIWAY_HEIGHT + 0.6, -gu, 0.4), 0xd0a020);
  paint.add(boxGeo(1.0, 0.8, 0.8), placement(gv, TAXIWAY_HEIGHT + 1.3, -gu + 0.3, 0.4), 0x303030);
  for (const [x, z] of [[-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7], [0.7, 0.7]]) {
    const c = Math.cos(0.4), s = Math.sin(0.4);
    dark.add(cylGeo(0.3, 0.3, 0.25, 12), placement(gv + x * c + z * s, TAXIWAY_HEIGHT + 0.3, -gu - x * s + z * c, 0.4, 0, Math.PI / 2), 0x151515);
  }
  const out = [new THREE.Mesh(paint.build(), mats.paint), new THREE.Mesh(dark.build(), mats.rubber)];
  for (const m of out) m.castShadow = m.receiveShadow = true;
  return out;
}
