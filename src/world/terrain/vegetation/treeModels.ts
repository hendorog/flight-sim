// Procedural tree meshes, one per species, normalised to a height of 1 (instances scale them to metres).
// Foliage is alpha-tested cards from the foliage atlas with "volumetric" normals pointing out of the
// crown (so a crown shades like a soft solid, not like flat cards) and vertex-colour ambient occlusion
// that darkens the crown interior. Trunks and main limbs are low-poly tapered cylinders.
//
//   spruce: conical, drooping branch whorls         (~210 cards)
//   pine:   tall bare trunk, irregular tufted crown  (~100 cards)
//   oak:    short trunk, limbs, broad rounded crown  (~145 cards)
//   birch:  slender white trunk, narrow oval crown   (~100 cards)
//
// Another era (Deep Time) puts its own four species in the same slots (flora/index.ts): the builders below
// and in flora/*.ts, picked by slot key; the present day builds exactly today's four.

import * as THREE from 'three';
import { mulberry32 } from '../noise';
import { ATLAS, ERA_ATLAS } from './foliageTexture';
import { era, isPresent } from '../../era/eraState';
import { FLORA, type FloraSlot } from './flora';
import { araucaria } from './flora/araucaria';
import { sabalPalm } from './flora/sabalPalm';

export type V3 = [number, number, number];
export type Rect = readonly [number, number, number, number];

/** Radius of the bounding sphere around (0, 0.5, 0) used for impostor frames, in tree heights. */
export const TREE_BOUND_RADIUS = 0.53;

export class Builder {
  readonly pos: number[] = [];
  readonly nrm: number[] = [];
  readonly uv: number[] = [];
  readonly col: number[] = [];
  readonly idx: number[] = [];
  /** Foliage cards added (the near-mesh budget; geometry.userData.cards). */
  cards = 0;

  private vert(p: V3, n: V3, u: number, v: number, ao: number): number {
    this.pos.push(...p);
    this.nrm.push(...n);
    this.uv.push(u, v);
    this.col.push(ao, ao, ao);
    return this.pos.length / 3 - 1;
  }

  /** A card with corners a (u0,v0), b (u1,v0), c (u1,v1), d (u0,v1) in the atlas rect. */
  card(a: V3, b: V3, c: V3, d: V3, rect: Rect, normal: (p: V3) => V3, ao: (p: V3) => number): void {
    const [u0, v0, u1, v1] = rect;
    const i = this.vert(a, normal(a), u0, v0, ao(a));
    this.vert(b, normal(b), u1, v0, ao(b));
    this.vert(c, normal(c), u1, v1, ao(c));
    this.vert(d, normal(d), u0, v1, ao(d));
    this.idx.push(i, i + 1, i + 2, i, i + 2, i + 3);
    this.cards++;
  }

  /** Tapered open cylinder from p0 (radius r0) to p1 (radius r1). */
  limb(p0: V3, p1: V3, r0: number, r1: number, segs: number, rect: Rect, ao: number): void {
    const axis = new THREE.Vector3(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
    const len = axis.length();
    axis.normalize();
    const side = Math.abs(axis.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const bx = new THREE.Vector3().crossVectors(axis, side).normalize();
    const by = new THREE.Vector3().crossVectors(axis, bx).normalize();
    const [u0, v0, u1, v1] = rect;
    const start = this.pos.length / 3;
    for (let s = 0; s <= segs; s++) {
      const a = (s / segs) * Math.PI * 2;
      const n = bx.clone().multiplyScalar(Math.cos(a)).addScaledVector(by, Math.sin(a));
      for (let e = 0; e < 2; e++) {
        const r = e === 0 ? r0 : r1;
        const c = e === 0 ? p0 : p1;
        this.vert([c[0] + n.x * r, c[1] + n.y * r, c[2] + n.z * r], [n.x, n.y, n.z], u0 + (u1 - u0) * (s / segs), e === 0 ? v0 : v0 + (v1 - v0) * Math.min(1, len), ao);
      }
    }
    for (let s = 0; s < segs; s++) {
      const a = start + s * 2;
      this.idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    g.userData.cards = this.cards;
    return g;
  }
}

export const norm = (v: V3): V3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

/** Crown normal field: out of an ellipsoid centred at c with radii r, tilted a little upward. */
export const crownNormal =
  (c: V3, r: V3) =>
  (p: V3): V3 =>
    norm([(p[0] - c[0]) / r[0], (p[1] - c[1]) / r[1] + 0.35, (p[2] - c[2]) / r[2]]);
/** Ambient occlusion: dark in the crown core, bright on its surface, darker low down. */
export const crownAO =
  (c: V3, r: V3) =>
  (p: V3): number => {
    const d = Math.hypot((p[0] - c[0]) / r[0], (p[1] - c[1]) / r[1], (p[2] - c[2]) / r[2]);
    return Math.min(1, 0.35 + 0.65 * d) * (0.8 + 0.2 * Math.min(1, p[1] / (c[1] + r[1])));
  };

/**
 * A leafy clump: two crossed near-vertical cards and one near-horizontal card through a centre, randomly
 * oriented, so it reads as a volume both from the side and from above.
 */
export function clump(b: Builder, c: V3, size: number, rect: Rect, rnd: () => number, crownN: (p: V3) => V3, crownAo: (p: V3) => number): void {
  const yaw = rnd() * Math.PI;
  const h = size * 0.5;
  // Each clump shades as a small dome of its own on the crown (half its normal from the clump centre, half
  // from the crown), and its underside is shaded by itself: the crown reads as lumpy masses of foliage with
  // lit and shaded sides, not as one smooth dome, from near and in the impostors.
  const normal = (p: V3): V3 => {
    const a = crownN(p);
    const l = norm([p[0] - c[0], p[1] - c[1] + 0.2 * size, p[2] - c[2]]);
    return norm([a[0] * 0.45 + l[0] * 0.55, a[1] * 0.45 + l[1] * 0.55, a[2] * 0.45 + l[2] * 0.55]);
  };
  const ao = (p: V3): number => crownAo(p) * (0.7 + 0.3 * Math.min(1, Math.max(0, 0.5 + (p[1] - c[1]) / size)));
  for (let k = 0; k < 3; k++) {
    const a = yaw + (k * Math.PI) / 2;
    const ux = Math.cos(a) * h;
    const uz = Math.sin(a) * h;
    // Second axis: tilted from vertical for the crossed pair, from horizontal for the third card.
    const tilt = k < 2 ? (rnd() - 0.5) * 0.8 : Math.PI / 2 + (rnd() - 0.5) * 0.8;
    const vx = -Math.sin(a) * Math.sin(tilt) * h;
    const vy = Math.cos(tilt) * h;
    const vz = Math.cos(a) * Math.sin(tilt) * h;
    b.card(
      [c[0] - ux - vx, c[1] - vy, c[2] - uz - vz],
      [c[0] + ux - vx, c[1] - vy, c[2] + uz - vz],
      [c[0] + ux + vx, c[1] + vy, c[2] + uz + vz],
      [c[0] - ux + vx, c[1] + vy, c[2] - uz + vz],
      rect,
      normal,
      ao,
    );
  }
}

/** Random point inside an ellipsoid shell between radius fractions r0 and 1. */
export function inShell(c: V3, r: V3, r0: number, rnd: () => number): V3 {
  const u = rnd() * 2 - 1;
  const a = rnd() * Math.PI * 2;
  const s = Math.sqrt(1 - u * u);
  const f = r0 + (1 - r0) * Math.cbrt(rnd());
  return [c[0] + Math.cos(a) * s * r[0] * f, c[1] + u * r[1] * f, c[2] + Math.sin(a) * s * r[2] * f];
}

function spruce(lod: number): THREE.BufferGeometry {
  const b = new Builder();
  const rnd = mulberry32(101);
  b.limb([0, -0.02, 0], [0, 1, 0], 0.014, 0.002, 6, ATLAS.bark, 0.6);
  const c: V3 = [0, 0.45, 0];
  const r: V3 = [0.22, 0.55, 0.22];
  const normal = crownNormal(c, r);
  const ao = crownAO(c, r);
  const whorls = lod ? 11 : 18;
  const step = 0.86 / (whorls - 1);
  const radiusAt = (t: number): number => 0.21 * Math.pow(1 - t, 1.05) + 0.018;
  for (let w = 0; w < whorls; w++) {
    const t = w / (whorls - 1);
    const y = 0.1 + 0.86 * t;
    const radius = radiusAt(t);
    const n = lod ? (t > 0.85 ? 4 : 5) : t > 0.85 ? 5 : 8;
    const off = rnd() * Math.PI * 2;
    // Branch sprays: from the trunk to the tip, drooping, each rolled about its own axis so the whorl
    // catches light and shows from the side as well as from above.
    for (let k = 0; k < n; k++) {
      const a = off + (k / n) * Math.PI * 2 + (rnd() - 0.5) * 0.5;
      const len = radius * (0.85 + 0.3 * rnd());
      const droop = 0.3 + 0.3 * rnd();
      const roll = (k % 2 === 0 ? 1 : -1) * (0.35 + 0.3 * rnd());
      const dx = Math.cos(a);
      const dz = Math.sin(a);
      const width = (0.55 * len + 0.03) * (lod ? 1.35 : 1);
      const px = -dz * Math.cos(roll) * width * 0.5;
      const py = Math.sin(roll) * width * 0.5;
      const pz = dx * Math.cos(roll) * width * 0.5;
      const tip: V3 = [dx * len, y - droop * len, dz * len];
      b.card([px, y + py, pz], [tip[0] + px, tip[1] + py, tip[2] + pz], [tip[0] - px, tip[1] - py, tip[2] - pz], [-px, y - py, -pz], ATLAS.needles, normal, ao);
    }
    // Silhouette: two crossed vertical cards per whorl, each two sprays hanging left and right of the
    // trunk, so the cone reads solid from the side and in the impostor bake.
    for (let k = 0; k < 2; k++) {
      const a = off + k * (Math.PI / 2) + 0.4;
      for (const side of [-1, 1]) {
        const dx = Math.cos(a) * side;
        const dz = Math.sin(a) * side;
        const top = y + step * 1.2;
        const bottom = y - 0.45 * radius;
        const mid = (top + bottom) / 2;
        const h = (top - bottom) / 2;
        b.card([0, mid - h, 0], [dx * radius, bottom - 0.2 * radius, dz * radius], [dx * radius, mid + 0.3 * h, dz * radius], [0, top, 0], ATLAS.needles, normal, ao);
      }
    }
  }
  clump(b, [0, 0.95, 0], 0.09, ATLAS.needles, rnd, normal, ao);
  return b.build();
}

function pine(lod: number): THREE.BufferGeometry {
  const b = new Builder();
  const rnd = mulberry32(202);
  b.limb([0, -0.02, 0], [0.02, 0.9, 0.01], 0.018, 0.006, 6, ATLAS.bark, 0.6);
  const c: V3 = [0.02, 0.78, 0.01];
  const r: V3 = [0.2, 0.15, 0.2];
  const normal = crownNormal(c, r);
  const ao = crownAO(c, r);
  // A few irregular sub-crowns on short limbs.
  for (let k = 0; k < 6; k++) {
    const a = rnd() * Math.PI * 2;
    const y0 = 0.6 + 0.05 * k;
    const tip: V3 = [0.02 + Math.cos(a) * 0.15, y0 + 0.08, 0.01 + Math.sin(a) * 0.15];
    b.limb([0.02, y0, 0.01], tip, 0.006, 0.002, 4, ATLAS.bark, 0.5);
    const tufts = lod ? 2 : 4;
    for (let t = 0; t < tufts; t++) clump(b, inShell(tip, [0.08, 0.05, 0.08], 0, rnd), (0.13 + 0.05 * rnd()) * (lod ? 1.35 : 1), ATLAS.needles, rnd, normal, ao);
  }
  for (let k = 0; k < (lod ? 5 : 8); k++) clump(b, inShell(c, r, 0.2, rnd), (0.14 + 0.05 * rnd()) * (lod ? 1.25 : 1), ATLAS.needles, rnd, normal, ao);
  return b.build();
}

function broadleaf(seed: number, trunkTop: number, c: V3, r: V3, clumps: number, size: number, birch: boolean, lod: number): THREE.BufferGeometry {
  const b = new Builder();
  const rnd = mulberry32(seed);
  const bark = birch ? ATLAS.birch : ATLAS.bark;
  b.limb([0, -0.02, 0], [0, trunkTop, 0], birch ? 0.012 : 0.03, birch ? 0.006 : 0.014, 6, bark, 0.65);
  const limbs = birch ? 3 : 5;
  for (let k = 0; k < limbs; k++) {
    const a = (k / limbs) * Math.PI * 2 + rnd();
    const end: V3 = [Math.cos(a) * r[0] * 0.6, c[1] + (rnd() - 0.2) * r[1] * 0.6, Math.sin(a) * r[2] * 0.6];
    b.limb([0, trunkTop * (0.75 + 0.2 * rnd()), 0], end, birch ? 0.006 : 0.013, 0.003, 5, bark, 0.5);
  }
  const normal = crownNormal(c, r);
  const ao = crownAO(c, r);
  // The far LOD: under half the clumps, larger, covering the same crown.
  const n = lod ? Math.round(clumps * 0.45) : clumps;
  const grow = lod ? 1.4 : 1;
  for (let k = 0; k < n; k++) clump(b, inShell(c, r, 0.45, rnd), size * grow * (0.8 + 0.4 * rnd()), ATLAS.leaves, rnd, normal, ao);
  // A few clumps over the crown's core, so it is closed seen from above (the aerial and impostor view).
  for (let k = 0; k < (lod ? 3 : 5); k++) {
    const p = inShell([c[0], c[1] + r[1] * 0.35, c[2]], [r[0] * 0.45, r[1] * 0.3, r[2] * 0.45], 0, rnd);
    clump(b, p, size * (1.0 + 0.3 * rnd()), ATLAS.leaves, rnd, normal, ao);
  }
  return b.build();
}

/**
 * Shadow casters, one per species: the crown as a closed low-poly solid (cone or ellipsoid) a little inside
 * the foliage, plus the trunk. Drawn only into the shadow maps in place of the alpha-tested cards, which
 * cost as much as the trees themselves; at shadow-map resolution (tens of centimetres per texel) a solid
 * crown casts the same shadow, and it still shades the far side of its own crown.
 */
export function createShadowProxies(): THREE.BufferGeometry[] {
  const ellipsoid = (c: V3, r: V3): THREE.BufferGeometry => {
    const g = new THREE.IcosahedronGeometry(1, 1);
    g.scale(r[0], r[1], r[2]);
    g.translate(c[0], c[1], c[2]);
    return g;
  };
  const trunk = (top: number, radius: number): THREE.BufferGeometry => {
    const g = new THREE.CylinderGeometry(radius * 0.6, radius, top, 5, 1, true);
    g.translate(0, top / 2, 0);
    return g;
  };
  const cone = (bottom: number, top: number, radius: number): THREE.BufferGeometry => {
    const g = new THREE.ConeGeometry(radius, top - bottom, 9, 1, false);
    g.translate(0, (top + bottom) / 2, 0);
    return g;
  };
  const merge = (parts: THREE.BufferGeometry[]): THREE.BufferGeometry => {
    const pos: number[] = [];
    const idx: number[] = [];
    for (const p of parts) {
      const g = p;
      const base = pos.length / 3;
      const a = g.getAttribute('position');
      for (let i = 0; i < a.count; i++) pos.push(a.getX(i), a.getY(i), a.getZ(i));
      if (g.index) for (let i = 0; i < g.index.count; i++) idx.push(base + g.index.getX(i));
      else for (let i = 0; i < a.count; i++) idx.push(base + i);
      p.dispose();
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    out.setIndex(idx);
    out.computeVertexNormals();
    return out;
  };
  if (!isPresent()) return eraSlots().map((slot) => eraProxy(slot, { ellipsoid, trunk, cone, merge }));
  const k = 0.85;
  return [
    merge([cone(0.12, 0.97, 0.2 * k), trunk(0.2, 0.014)]),
    merge([ellipsoid([0.02, 0.76, 0.01], [0.21 * k, 0.15 * k, 0.21 * k]), trunk(0.72, 0.018)]),
    merge([ellipsoid([0, 0.62, 0], [0.34 * k, 0.3 * k, 0.34 * k]), trunk(0.5, 0.03)]),
    merge([ellipsoid([0, 0.64, 0], [0.17 * k, 0.32 * k, 0.17 * k]), trunk(0.5, 0.012)]),
  ];
}

/**
 * Geometries indexed by species (see SPECIES in placement.ts). lod 0 is the full tree; lod 1, for trees
 * beyond a few tens of metres, has well under half the foliage cards (larger, covering the same crown), which
 * matters most over dense forest where the cards' overdraw dominates.
 */
export function createTreeGeometries(lod: 0 | 1 = 0): THREE.BufferGeometry[] {
  if (!isPresent()) return eraSlots().map((slot) => eraTree(slot.key, lod));
  return [
    spruce(lod),
    pine(lod),
    broadleaf(303, 0.45, [0, 0.62, 0], [0.34, 0.3, 0.34], 48, 0.27, false, lod),
    broadleaf(404, 0.7, [0, 0.64, 0], [0.17, 0.32, 0.17], 34, 0.18, true, lod),
  ];
}

/** Per-species foliage tint (linear multipliers on the atlas colour). */
// The atlas holds single-leaf albedos; whole crowns come out far darker (about 0.03-0.05 in green) through
// their own shading and shadows.
export const SPECIES_TINT: ReadonlyArray<V3> = [
  [0.8, 0.88, 0.95], // spruce: dark blue-green
  [1.0, 0.92, 0.82], // pine: yellower, greyer
  [0.92, 0.95, 0.95], // oak
  [1.08, 1.12, 0.92], // birch: light, yellow-green
];

/** Per-species foliage tint of this thread's era: SPECIES_TINT in the present day. */
export function speciesTints(): ReadonlyArray<V3> {
  if (isPresent()) return SPECIES_TINT;
  return eraSlots().map((s) => [s.tint[0], s.tint[1], s.tint[2]] as V3);
}

// ------------------------------------------------------------------------------------------------ eras

/** What the era builders in flora/*.ts use from here (passed in, so they import nothing from this module). */
export interface TreeKit {
  Builder: typeof Builder;
  clump: typeof clump;
  inShell: typeof inShell;
  crownNormal: typeof crownNormal;
  crownAO: typeof crownAO;
}

const KIT: TreeKit = { Builder, clump, inShell, crownNormal, crownAO };

const eraSlots = (): readonly FloraSlot[] => FLORA[era().flora].slots;

function eraTree(key: string, lod: 0 | 1): THREE.BufferGeometry {
  switch (key) {
    case 'araucaria':
      return araucaria(KIT, lod);
    case 'taxodioid':
      return taxodioid(lod);
    case 'platanoid':
      // The broadleaf builder: a short bole, spreading limbs and a broad, slightly flattened crown of large
      // leaves (the era atlas's leaf rect), clamped inside TREE_BOUND_RADIUS.
      return broadleaf(505, 0.42, [0, 0.605, 0], [0.27, 0.2, 0.27], 52, 0.19, false, lod);
    case 'sabal':
      return sabalPalm(KIT, lod);
    case 'spruce':
      return spruce(lod);
    case 'pine':
      return pine(lod);
    case 'oak':
      return broadleaf(303, 0.45, [0, 0.62, 0], [0.34, 0.3, 0.34], 48, 0.27, false, lod);
    case 'birch':
      return broadleaf(404, 0.7, [0, 0.64, 0], [0.17, 0.32, 0.17], 34, 0.18, true, lod);
    default:
      throw new Error(`no tree builder for flora slot '${key}'`);
  }
}

/**
 * Taxodioid swamp conifer (pine-derived): a straight bole on a flared, buttressed base and a narrow conical
 * crown of feathery sprays on short limbs up the upper two-thirds of the trunk (~174 cards; LOD 1 ~40%).
 */
function taxodioid(lod: number): THREE.BufferGeometry {
  const b = new Builder();
  const rnd = mulberry32(606);
  const bark = ERA_ATLAS.bark;
  // The buttress: a short, strongly tapered flare, then the bole.
  b.limb([0, -0.02, 0], [0, 0.07, 0], 0.05, 0.022, 7, bark, 0.55);
  b.limb([0, 0.07, 0], [0.01, 0.93, 0], 0.022, 0.004, 6, bark, 0.6);
  // Low ridges of the fluted base.
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + 0.4;
    b.limb([Math.cos(a) * 0.04, -0.02, Math.sin(a) * 0.04], [Math.cos(a) * 0.01, 0.1, Math.sin(a) * 0.01], 0.014, 0.004, 4, bark, 0.5);
  }
  const c: V3 = [0.01, 0.66, 0];
  const r: V3 = [0.19, 0.33, 0.19];
  const normal = crownNormal(c, r);
  const ao = crownAO(c, r);
  const radiusAt = (y: number): number => 0.04 + 0.17 * Math.pow(Math.max(0, (1 - y) / 0.62), 0.9);
  const limbs = 9;
  for (let k = 0; k < limbs; k++) {
    const t = k / (limbs - 1);
    const y0 = 0.4 + 0.44 * t;
    const a = k * 2.4 + rnd() * 0.6;
    const reach = radiusAt(y0) * (0.8 + 0.3 * rnd());
    const tip: V3 = [0.01 + Math.cos(a) * reach, y0 + 0.04, Math.sin(a) * reach];
    b.limb([0.01, y0, 0], tip, 0.005, 0.0015, 4, bark, 0.5);
    const tufts = lod ? 2 : 5;
    for (let n = 0; n < tufts; n++) {
      const p = inShell(tip, [reach * 0.45, 0.05, reach * 0.45], 0, rnd);
      p[0] -= (p[0] - 0.01) * 0.25;
      p[2] *= 0.75;
      clump(b, p, (0.11 + 0.04 * rnd()) * (1 - 0.3 * t) * (lod ? 1.35 : 1), ERA_ATLAS.needles, rnd, normal, ao);
    }
  }
  // Fill and the spire, so the cone reads closed from the side and from above.
  const fill = lod ? 5 : 13;
  for (let k = 0; k < fill; k++) {
    const t = k / (fill - 1);
    const y = 0.42 + 0.48 * t;
    const a = rnd() * Math.PI * 2;
    const rr = radiusAt(y) * 0.6 * Math.sqrt(rnd());
    clump(b, [0.01 + Math.cos(a) * rr, y, Math.sin(a) * rr], (0.1 + 0.04 * rnd()) * (1 - 0.35 * t) * (lod ? 1.3 : 1), ERA_ATLAS.needles, rnd, normal, ao);
  }
  return b.build();
}

/** The shadow caster of an era slot from its flora data (see createShadowProxies). */
function eraProxy(
  slot: FloraSlot,
  h: {
    ellipsoid: (c: V3, r: V3) => THREE.BufferGeometry;
    trunk: (top: number, radius: number) => THREE.BufferGeometry;
    cone: (bottom: number, top: number, radius: number) => THREE.BufferGeometry;
    merge: (parts: THREE.BufferGeometry[]) => THREE.BufferGeometry;
  },
): THREE.BufferGeometry {
  const parts = slot.proxy.crown.map((p) => (p.kind === 'cone' ? h.cone(p.y0, p.y1, p.rx) : h.ellipsoid([0, p.y0, 0], [p.rx, p.y1, p.rx])));
  parts.push(h.trunk(slot.proxy.trunk[0], slot.proxy.trunk[1]));
  return h.merge(parts);
}
