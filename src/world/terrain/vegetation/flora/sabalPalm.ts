// Sabalites fan palm (Late Cretaceous slot 3; flora/index.ts): a slightly leaning fibrous trunk clad in
// criss-crossed leaf bases, and a round head of costapalmate fan fronds on short petioles - young ones
// upright, old ones hanging - each blade folded along its costa (two cards across) and bent down part-way
// out (two cards along), so the head reads as a rounded, ragged ball from any side and from above.
// Height 1 (instances scale to metres); every vertex inside TREE_BOUND_RADIUS of (0, 0.5, 0)
// (tests/terrain/eraFlora.test.ts). 26 fronds (~104 cards) at LOD 0; 14 unbent fronds (~27%) at LOD 1.

import type * as THREE from 'three';
import { mulberry32 } from '../../noise';
import { ERA_ATLAS } from '../foliageTexture';
import type { TreeKit, V3 } from '../treeModels';

const add = (a: V3, b: V3, s = 1): V3 => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (v: V3): V3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const mix = (a: V3, b: V3, ca: number, cb: number): V3 => unit([a[0] * ca + b[0] * cb, a[1] * ca + b[1] * cb, a[2] * ca + b[2] * cb]);

/** Crown centre (the top of the trunk), in tree heights. */
const CROWN: V3 = [0.03, 0.68, 0.01];
/** Petiole and blade length, and the blade's full width (the atlas fan is ~1.9 times as wide as long). */
const PETIOLE = 0.075;
const BLADE = 0.25;
const WIDTH = 0.36;

export function sabalPalm(kit: TreeKit, lod: number): THREE.BufferGeometry {
  const b = new kit.Builder();
  const rnd = mulberry32(707);
  const fibre = ERA_ATLAS.palmFibre;
  // The trunk: a gentle lean, thickest at the boot-clad top.
  b.limb([0, -0.02, 0], [0.012, 0.4, 0.004], 0.022, 0.02, 7, fibre, 0.6);
  b.limb([0.012, 0.4, 0.004], [CROWN[0], CROWN[1] + 0.01, CROWN[2]], 0.02, 0.022, 7, fibre, 0.6);
  const r: V3 = [0.22, 0.17, 0.22];
  const normal = kit.crownNormal(CROWN, r);
  const ao = kit.crownAO(CROWN, r);
  const [u0, v0, u1, v1] = ERA_ATLAS.palmFan;
  const uMid = u0 + (u1 - u0) * 0.5;
  const vMid = (v0 + v1) / 2;
  const fronds = lod ? 14 : 26;
  const fold = 0.38;
  const half = WIDTH / 2;
  for (let i = 0; i < fronds; i++) {
    const t = i / (fronds - 1);
    // Young fronds up, old ones hanging; golden-angle azimuths.
    const elev = 0.72 - 1.4 * Math.pow(t, 0.85) + (rnd() - 0.5) * 0.1;
    const az = i * 2.39996 + (rnd() - 0.5) * 0.3;
    const d: V3 = [Math.cos(elev) * Math.cos(az), Math.sin(elev), Math.cos(elev) * Math.sin(az)];
    // Across the blade (horizontal) and its upper face.
    const s = unit(cross(d, [0, 1, 0]));
    const n = unit(cross(s, d));
    const base = add(CROWN, d, PETIOLE);
    b.limb(add(CROWN, d, 0.01), base, 0.004, 0.0025, 3, fibre, 0.5);
    // The blade bends down part-way out (more on older fronds).
    const bend = 0.35 + 0.5 * t;
    const d2 = mix(d, n, Math.cos(bend), -Math.sin(bend));
    const n2 = unit(cross(s, d2));
    const mid = add(base, d, BLADE * 0.5);
    const tip = lod ? add(base, mix(d, n, Math.cos(bend * 0.5), -Math.sin(bend * 0.5)), BLADE) : add(mid, d2, BLADE * 0.5);
    // Folded halves: each tilted up from the blade plane about the costa.
    const across = (nn: V3, side: number): V3 => mix(s, nn, side * Math.cos(fold), Math.sin(fold));
    const segment = (p0: V3, p1: V3, na: V3, nb: V3, ua: number, ub: number): void => {
      const upA = across(na, 1);
      const upB = across(nb, 1);
      const loA = across(na, -1);
      const loB = across(nb, -1);
      // Upper half: v from vMid (the costa) to v1; lower half: v0 to vMid.
      b.card(p0, p1, add(p1, upB, half), add(p0, upA, half), [ua, vMid, ub, v1], normal, ao);
      b.card(add(p0, loA, half), add(p1, loB, half), p1, p0, [ua, v0, ub, vMid], normal, ao);
    };
    if (lod) segment(base, tip, n, n, u0, u1);
    else {
      segment(base, mid, n, n, u0, uMid);
      segment(mid, tip, n, n2, uMid, u1);
    }
  }
  return b.build();
}
