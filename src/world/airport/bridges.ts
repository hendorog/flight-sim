// Road bridges where the regional roads cross the river (terrain/roads.ts; the crossings are baked with the network).
// The floodplain stands only a metre or so above the water, so each bridge is a low concrete beam bridge: a deck
// BRIDGE_CLEARANCE above the water from bank to bank on piers about every PIER_SPACING, abutments at the banks, and
// earth ramps (grassed embankments) carrying the road up to it. The bridge follows the road's own centre line, so the
// painted road runs onto the ramps without a kink.

import * as THREE from 'three';
import { nedToThree } from '../../core/frames';
import { hydrology } from '../terrain/heightfield';
import { ROAD_HALF_WIDTH, regionalRoadKinds, riverCrossings, regionalRoads } from '../terrain/roads';
import type { HeightFn } from './valley';

/** Deck top above the river's water level, m. */
const BRIDGE_CLEARANCE = 3.5;
/** Ramp length from the ground up to the deck on each side, m. */
const RAMP = 40;
/** The deck reaches this far onto the bank beyond the water's edge, m. */
const BANK_SEAT = 4;
const PIER_SPACING = 16;
const DECK_DEPTH = 1.1;
const PARAPET = 0.9;
const STEP = 3;

const CONCRETE = new THREE.Color(0.2, 0.195, 0.18);
const CONCRETE_DARK = new THREE.Color(0.1, 0.098, 0.09);
const SEAL = new THREE.Color(0.05, 0.05, 0.048);
const METAL = new THREE.Color(0.13, 0.115, 0.09);
const GRASS = new THREE.Color(0.06, 0.085, 0.035);

export interface BridgeResult {
  mesh: THREE.Mesh | null;
  material: THREE.Material;
}

export function buildBridges(heightAt: HeightFn): BridgeResult {
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
  material.name = 'bridges';
  const pos: number[] = [];
  const col: number[] = [];
  const v = new THREE.Vector3();
  const put = (n: number, e: number, h: number, c: THREE.Color) => {
    nedToThree({ x: n, y: e, z: -h }, v);
    pos.push(v.x, v.y, v.z);
    col.push(c.r, c.g, c.b);
  };
  /** A quad a-b-c-d (NED points with heights), both triangles. */
  type P = [number, number, number];
  const quad = (a: P, b: P, c: P, d: P, color: THREE.Color) => {
    for (const p of [a, b, c, a, c, d]) put(p[0], p[1], p[2], color);
  };
  const box = (cn: number, ce: number, bearing: number, len: number, wid: number, h0: number, h1: number, color: THREE.Color) => {
    const tn = Math.cos(bearing), te = Math.sin(bearing);
    const ln = -te, le = tn;
    const corner = (s: number, w: number, h: number): P => [cn + tn * s * len / 2 + ln * w * wid / 2, ce + te * s * len / 2 + le * w * wid / 2, h];
    // Four sides (the top is under the deck, the bottom in the river bed).
    const ring: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    for (let k = 0; k < 4; k++) {
      const [s0, w0] = ring[k];
      const [s1, w1] = ring[(k + 1) % 4];
      quad(corner(s0, w0, h0), corner(s1, w1, h0), corner(s1, w1, h1), corner(s0, w0, h1), color);
    }
  };

  const lines = regionalRoads();
  const kinds = regionalRoadKinds();
  const hit = { dist: Infinity, level: 0, halfWidth: 0, s: 0, side: 0, beyondSource: 0 };
  for (const x of riverCrossings()) {
    // The road through the crossing: its line and the arc length there.
    let li = -1, s0 = 0, bd = Infinity;
    lines.forEach((l, k) => {
      let acc = 0;
      for (let i = 0; i + 1 < l.north.length; i++) {
        const dn = l.north[i + 1] - l.north[i], de = l.east[i + 1] - l.east[i];
        const len = Math.hypot(dn, de);
        const t = len > 0 ? Math.max(0, Math.min(1, ((x.north - l.north[i]) * dn + (x.east - l.east[i]) * de) / (len * len))) : 0;
        const d = Math.hypot(l.north[i] + dn * t - x.north, l.east[i] + de * t - x.east);
        if (d < bd) { bd = d; li = k; s0 = acc + t * len; }
        acc += len;
      }
    });
    if (li < 0 || bd > 5) continue;
    const l = lines[li];
    const half = ROAD_HALF_WIDTH[kinds[li]] + 0.6;
    const cum = [0];
    for (let i = 1; i < l.north.length; i++) cum.push(cum[i - 1] + Math.hypot(l.north[i] - l.north[i - 1], l.east[i] - l.east[i - 1]));
    const at = (s: number): { n: number; e: number; b: number } => {
      s = Math.max(0, Math.min(cum[cum.length - 1], s));
      let i = 0;
      while (i + 2 < cum.length && cum[i + 1] < s) i++;
      const t = (s - cum[i]) / Math.max(1e-6, cum[i + 1] - cum[i]);
      return { n: l.north[i] + (l.north[i + 1] - l.north[i]) * t, e: l.east[i] + (l.east[i + 1] - l.east[i]) * t, b: Math.atan2(l.east[i + 1] - l.east[i], l.north[i + 1] - l.north[i]) };
    };
    // The water's extent along the road, and its level.
    hydrology.queryRiver(x.north, x.east, hit);
    const level = hit.level;
    const wet = (s: number) => {
      const p = at(s);
      hydrology.queryRiver(p.n, p.e, hit);
      return hit.dist < hit.halfWidth + 1;
    };
    let sa = s0, sb = s0;
    while (sa > s0 - 300 && wet(sa - 1)) sa -= 1;
    while (sb < s0 + 300 && wet(sb + 1)) sb += 1;
    sa -= BANK_SEAT;
    sb += BANK_SEAT;
    const deck = level + BRIDGE_CLEARANCE;
    const top = (s: number): number => {
      if (s >= sa && s <= sb) return deck;
      const p = at(s);
      const g = heightAt(p.n, p.e) + 0.25;
      const u = s < sa ? (s - (sa - RAMP)) / RAMP : ((sb + RAMP) - s) / RAMP;
      const k = Math.max(0, Math.min(1, u));
      return g + (deck - g) * k * k * (3 - 2 * k);
    };
    const surface = kinds[li] === 0 ? SEAL : METAL;
    for (let s = sa - RAMP; s < sb + RAMP - 1e-6; s += STEP) {
      const s1 = Math.min(s + STEP, sb + RAMP);
      const p = at(s), q = at(s1);
      const hp = top(s), hq = top(s1);
      const off = (o: { n: number; e: number; b: number }, w: number): [number, number] => [o.n - Math.sin(o.b) * w, o.e + Math.cos(o.b) * w];
      const L = (o: typeof p, w: number, h: number): P => [...off(o, w), h] as P;
      // The roadway.
      quad(L(p, -half, hp), L(q, -half, hq), L(q, half, hq), L(p, half, hp), surface);
      const onDeck = s >= sa - 1e-6 && s1 <= sb + 1e-6;
      for (const side of [-1, 1]) {
        if (onDeck) {
          // Deck edge beam and its parapet.
          const w0 = side * half, w1 = side * (half + 0.3);
          quad(L(p, w1, hp - DECK_DEPTH), L(q, w1, hq - DECK_DEPTH), L(q, w1, hq + PARAPET), L(p, w1, hp + PARAPET), CONCRETE);
          quad(L(p, w0, hp), L(q, w0, hq), L(q, w0, hq + PARAPET), L(p, w0, hp + PARAPET), CONCRETE);
          quad(L(p, w0, hp + PARAPET), L(q, w0, hq + PARAPET), L(q, w1, hq + PARAPET), L(p, w1, hp + PARAPET), CONCRETE);
        } else {
          // Embankment: grassed slopes (1 in 1.5) down to the ground.
          const gp = heightAt(...off(p, side * half)), gq = heightAt(...off(q, side * half));
          const dp = Math.max(0, hp - gp), dq = Math.max(0, hq - gq);
          quad(L(p, side * half, hp), L(q, side * half, hq), L(q, side * (half + 1.5 * dq + 0.5), hq - dq - 0.5), L(p, side * (half + 1.5 * dp + 0.5), hp - dp - 0.5), GRASS);
        }
      }
      if (onDeck) quad(L(p, -half - 0.3, hp - DECK_DEPTH), L(p, half + 0.3, hp - DECK_DEPTH), L(q, half + 0.3, hq - DECK_DEPTH), L(q, -half - 0.3, hq - DECK_DEPTH), CONCRETE_DARK);
    }
    // Abutments at the banks, and piers across the channel.
    for (const s of [sa, sb]) {
      const p = at(s);
      box(p.n, p.e, p.b, 1.2, 2 * half + 0.6, level - 2.5, deck - DECK_DEPTH, CONCRETE);
    }
    const spans = Math.max(1, Math.round((sb - sa) / PIER_SPACING));
    for (let k = 1; k < spans; k++) {
      const p = at(sa + ((sb - sa) * k) / spans);
      box(p.n, p.e, p.b, 1.0, 2 * half - 0.5, level - 3, deck - DECK_DEPTH, CONCRETE);
    }
  }
  if (pos.length === 0) return { mesh: null, material };
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, material);
  mesh.name = 'bridges';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  material.side = THREE.DoubleSide;
  return { mesh, material };
}
