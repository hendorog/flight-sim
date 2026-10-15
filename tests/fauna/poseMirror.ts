// A CPU mirror of the fauna vertex stage (src/world/fauna/faunaMaterial.ts faunaPose + faunaSkin, body space,
// before the instance transform), so tests can measure posed geometry: feet and hands against the ground.
// Keep it in step with the GLSL; it ports the same expressions line for line.
//
// Inc 2: the skinning is exported (skinPositions) with the quaternion helpers, so a rig's own pose mirror
// (tests/fauna/<rig>PoseMirror.ts, WP1-WP3) only ports its faunaPose and calls skinPositions with its sub-joints,
// sub-blend and wings = false (FAUNA_WINGS is defined for the azhdarchid rig only).

import * as THREE from 'three';
import { AZHDARCHID_CROUCH_DROP_M, azhdarchidCrouchFlex, azhdarchidFold, azhdarchidSubJoints } from '../../src/world/fauna/species/azhdarchid';
import { EDMONTOSAURUS_HIND_SOLE, edmontosaurusPivots, edmontosaurusSubJoints } from '../../src/world/fauna/species/edmontosaurus';
import { BONE as B, BONE_COUNT, type CreatureMeshSet } from '../../src/world/fauna/types';

export type Q = [number, number, number, number];
export type V = [number, number, number];
export const TAU = 6.2831853;
export const QI: Q = [0, 0, 0, 1];
export const AX: V = [1, 0, 0];
export const AY: V = [0, 1, 0];
export const AZ: V = [0, 0, 1];

export const clamp = (x: number, a: number, b: number): number => Math.min(b, Math.max(a, x));
export const smoothstep = (a: number, b: number, x: number): number => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const qAx = (a: V, t: number): Q => [a[0] * Math.sin(0.5 * t), a[1] * Math.sin(0.5 * t), a[2] * Math.sin(0.5 * t), Math.cos(0.5 * t)];
export const qMul = (a: Q, b: Q): Q => {
  const c = cross([a[0], a[1], a[2]], [b[0], b[1], b[2]]);
  return [a[3] * b[0] + b[3] * a[0] + c[0], a[3] * b[1] + b[3] * a[1] + c[1], a[3] * b[2] + b[3] * a[2] + c[2], a[3] * b[3] - (a[0] * b[0] + a[1] * b[1] + a[2] * b[2])];
};
export const qRot = (q: Q, v: V): V => {
  const u: V = [q[0], q[1], q[2]];
  const c1 = cross(u, v);
  const t: V = [2 * c1[0], 2 * c1[1], 2 * c1[2]];
  const c2 = cross(u, t);
  return [v[0] + q[3] * t[0] + c2[0], v[1] + q[3] * t[1] + c2[1], v[2] + q[3] * t[2] + c2[2]];
};
export const qPart = (q: Q, w: number): Q => {
  const s = q[3] < 0 ? -1 : 1;
  const m: Q = [QI[0] + (s * q[0] - QI[0]) * w, QI[1] + (s * q[1] - QI[1]) * w, QI[2] + (s * q[2] - QI[2]) * w, QI[3] + (s * q[3] - QI[3]) * w];
  const l = Math.hypot(m[0], m[1], m[2], m[3]);
  return [m[0] / l, m[1] / l, m[2] / l, m[3] / l];
};
export const qMirror = (q: Q, side: number): Q => (side > 0 ? q : [-q[0], -q[1], q[2], q[3]]);
export const qRightUp = (t: number): Q => qAx(AX, -t);
export const qConj = (q: Q): Q => [-q[0], -q[1], -q[2], q[3]];
export const qInFrame = (up: Q, r: Q): Q => qMul(qConj(up), qMul(r, up));
/** qYawPitch of the GLSL: pitch about z, then yaw about y on top. */
export const qYawPitch = (yaw: number, pitch: number): Q => qMul(qAx(AY, yaw), qAx(AZ, pitch));
const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const subv = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

/** Instance channels the pose reads (body space only: no placement). */
export interface PoseInput {
  phase: number;
  gaitBlend: number;
  /** aInstC.x: alert (hadrosaur) or flap (azhdarchid). */
  flap: number;
  headTurn?: number;
  time?: number;
  seed?: number;
}

/** What a faunaPose writes (per vertex: fSubQ depends on the vertex's limb). */
export interface PoseOut {
  fQ: Q[];
  fSubQ: Q[];
  fRootOff: V;
  fFold: number;
}

function hindLeg(ph: number, walk: number, run: number): V {
  const s = Math.sin(ph);
  const c = Math.max(0, Math.cos(ph));
  const st = Math.max(0, -Math.cos(ph));
  const swing = 0.28 * s * walk + 0.5 * s * run;
  const knee = (0.42 * walk + 0.95 * run) * c + 0.3 * run * st;
  return [swing, knee, knee * 0.85 - swing * 0.85];
}
function foreLeg(ph: number, walk: number, run: number): V {
  const s = Math.sin(ph);
  const c = Math.max(0, Math.cos(ph));
  const swing = 0.22 * s * walk + 0.55 * run;
  const elbow = 0.4 * c * walk + 1.15 * run;
  return [swing, elbow, -0.5 * elbow - swing * 0.6];
}

function hadrosaurPose(inp: PoseInput, bone: number): PoseOut {
  const b = clamp(inp.gaitBlend, 0, 2);
  const move = clamp(b, 0, 1);
  const run = clamp(b - 1, 0, 1);
  const walk = move - run;
  const ph = TAU * inp.phase;
  const fQ: Q[] = Array.from({ length: BONE_COUNT }, () => QI);
  const rootPitch = 0.11 * run;
  const rootRot = rootPitch + 0.012 * Math.sin(2 * ph) * walk;
  fQ[B.root] = qAx(AZ, rootRot);
  // (the head, neck, spine and tail rotations do not move the limbs or the root offset; left at rest here)
  const hl = hindLeg(ph, walk, run);
  const hr = hindLeg(ph + 0.5 * TAU, walk, run);
  const fr = foreLeg(ph + 0.1 * TAU, walk, run);
  const fl = foreLeg(ph + 0.6 * TAU, walk, run);
  fQ[B.legHL] = qAx(AZ, hl[0] - rootPitch);
  fQ[B.legHR] = qAx(AZ, hr[0] - rootPitch);
  fQ[B.legFL] = qAx(AZ, fl[0]);
  fQ[B.legFR] = qAx(AZ, fr[0]);
  const leg = bone === B.legHL ? hl : bone === B.legHR ? hr : bone === B.legFL ? fl : fr;
  const hind = bone === B.legHL || bone === B.legHR;
  const fSubQ: Q[] = [qAx(AZ, hind ? -leg[1] : leg[1]), qAx(AZ, leg[2]), QI];
  const fRootOff: V = [0, Math.min(EDMONTOSAURUS_HIND_SOLE[1], EDMONTOSAURUS_HIND_SOLE[3]) - Math.min(soleLow(hl, hl[0] - rootPitch, rootRot), soleLow(hr, hr[0] - rootPitch, rootRot)), 0];
  return { fQ, fSubQ, fRootOff, fFold: 0 };
}

const rotZ = (p: [number, number], c: [number, number], a: number): [number, number] => {
  const dx = p[0] - c[0];
  const dy = p[1] - c[1];
  return [c[0] + Math.cos(a) * dx - Math.sin(a) * dy, c[1] + Math.sin(a) * dx + Math.cos(a) * dy];
};
let ED: { sub: Float32Array; piv: Float32Array } | null = null;
function soleLow(leg: V, hipRot: number, rootRot: number): number {
  ED ??= { sub: edmontosaurusSubJoints(), piv: edmontosaurusPivots() };
  const S = EDMONTOSAURUS_HIND_SOLE;
  let lo = 1e9;
  for (const p0 of [[S[0], S[1]], [S[2], S[3]]] as [number, number][]) {
    let p = rotZ(p0, [ED.sub[16], ED.sub[17]], leg[2]);
    p = rotZ(p, [ED.sub[12], ED.sub[13]], -leg[1]);
    p = rotZ(p, [ED.piv[B.legHR * 4], ED.piv[B.legHR * 4 + 1]], hipRot);
    p = rotZ(p, [ED.piv[B.root * 4], ED.piv[B.root * 4 + 1]], rootRot);
    lo = Math.min(lo, p[1]);
  }
  return lo;
}

let FOLD: Q[] | null = null;
function foldQuats(): Q[] {
  if (!FOLD) {
    const q = azhdarchidFold().quats;
    FOLD = [0, 1, 2, 3].map((k) => [q[k * 4], q[k * 4 + 1], q[k * 4 + 2], q[k * 4 + 3]] as Q);
  }
  return FOLD;
}

function azhdarchidPose(inp: PoseInput, bone: number): PoseOut {
  const b = clamp(inp.gaitBlend, 0, 2);
  const L = clamp(b - 1, 0, 1);
  const walk = clamp(b, 0, 1) * (1 - smoothstep(0, 0.3, L));
  const crouch = smoothstep(0, 0.35, L) * (1 - smoothstep(0.3, 0.55, L));
  const vault = smoothstep(0.3, 0.55, L) * (1 - smoothstep(0.7, 1, L));
  const unfold = smoothstep(0.45, 0.85, L);
  const trail = smoothstep(0.55, 1, L);
  const flap = clamp(inp.flap, 0, 1);
  const ph = TAU * inp.phase;
  const t = (inp.time ?? 0) + (inp.seed ?? 0) * 57;
  const flying = smoothstep(0.8, 1, L);
  const fQ: Q[] = Array.from({ length: BONE_COUNT }, () => QI);
  fQ[B.root] = qAx(AZ, -0.5 * trail + 0.38 * vault + 0.015 * Math.sin(2 * ph) * walk);
  // (neck and head do not move the limbs or the root offset; left at rest here)
  const launchStroke = (0.95 + (-0.45 - 0.95) * smoothstep(0.72, 1, L)) * unfold;
  const flightStroke = flap * 0.62 * Math.sin(ph) + (1 - flap) * (0.12 + 0.02 * Math.sin(t * 0.9));
  const stroke = launchStroke + (flightStroke - launchStroke) * flying;
  const swF = 0.22 * walk;
  const side = bone === B.wingR || bone === B.legHR ? 1 : -1;
  const legPh = ph + (side > 0 ? 0.5 : 0) * TAU;
  const armPh = ph + (side > 0 ? 0.75 : 0.25) * TAU;
  const fFold = 1 - unfold;
  const F = foldQuats();
  const CF = azhdarchidCrouchFlex();
  const wingR = qMul(qAx(AZ, swF * Math.sin(armPh) + 0.5 * trail + CF.shoulder * crouch), qMul(qRightUp(stroke + 0.14 * Math.max(0, Math.cos(armPh)) * walk), qPart(F[0], fFold)));
  fQ[B.wingR] = wingR;
  fQ[B.wingL] = qMirror(wingR, -1);
  const s = Math.sin(legPh);
  const c = Math.max(0, Math.cos(legPh));
  const hip = 0.3 * s * walk + 0.45 * crouch - 0.35 * vault - 1.15 * trail;
  const knee = 0.45 * c * walk + 0.8 * crouch;
  fQ[B.legHL] = qAx(AZ, hip);
  fQ[B.legHR] = fQ[B.legHL];
  let fSubQ: Q[];
  if (bone >= B.wingL) {
    const sweep = -0.28 * flap * flying * Math.max(0, Math.cos(ph));
    const flex = -0.22 * flap * flying * Math.cos(ph) + 0.05 * (1 - flap) * flying;
    const elbowR = qMul(qInFrame(wingR, qAx(AZ, CF.elbow * crouch)), qPart(F[1], fFold));
    const wristR = qMul(qInFrame(qMul(wingR, elbowR), qAx(AZ, CF.wrist * crouch)), qMul(qAx(AY, sweep), qPart(F[2], fFold)));
    fSubQ = [qMirror(elbowR, side), qMirror(wristR, side), qMirror(qMul(qRightUp(flex), qPart(F[3], fFold)), side)];
  } else {
    fSubQ = [qAx(AZ, -knee), qAx(AZ, knee * 0.8), QI];
  }
  const fRootOff: V = [0, -0.03 * (0.5 + 0.5 * Math.cos(2 * ph)) * walk - AZHDARCHID_CROUCH_DROP_M * crouch + 0.3 * vault, 0];
  return { fQ, fSubQ, fRootOff, fFold };
}

/** A rig's pose function: the GLSL faunaPose for one vertex of bone `bone`. */
export type PoseFn = (inp: PoseInput, bone: number) => PoseOut;

export interface SkinOptions {
  /** uSub (rig.ts packSubJoints) and uSubBlend of the species (its render descriptor). */
  sub: Float32Array;
  subBlend: number;
  /** FAUNA_WINGS: true only for the azhdarchid rig (fold tuck, 14/15 mirroring and wing sub-joints). */
  wings: boolean;
}

/** faunaSkin on the CPU: posed body-space positions of every vertex of `g` (scale 1, no placement). */
export function skinPositions(set: CreatureMeshSet, g: THREE.BufferGeometry, inp: PoseInput, pose: PoseFn, opts: SkinOptions, filter?: (bone: number) => boolean): V[] {
  const subRaw = opts.sub;
  const subBlend = opts.subBlend;
  const pos = g.getAttribute('position');
  const boneA = g.getAttribute('aBone');
  const boneWA = g.getAttribute('aBoneW');
  const rigA = g.getAttribute('aRig');
  const piv = set.pivots;
  const out: V[] = [];
  for (let v = 0; v < pos.count; v++) {
    const b = Math.round(boneA.getX(v));
    if (filter && !filter(b)) continue;
    const ps = pose(inp, b);
    let p: V = [pos.getX(v), pos.getY(v), pos.getZ(v)];
    if (opts.wings && b >= B.wingL) p[0] += rigA.getY(v) * ps.fFold * 0.88;
    if (b >= B.legFL && (opts.wings || b <= B.legHR)) {
      const base = opts.wings && b >= B.wingL ? 6 : b >= B.legHL ? 3 : 0;
      const side = b === B.legFR || b === B.legHR || (opts.wings && b === B.wingR) ? 1 : -1;
      for (let k = 2; k >= 0; k--) {
        const j = [subRaw[(base + k) * 4], subRaw[(base + k) * 4 + 1], subRaw[(base + k) * 4 + 2], subRaw[(base + k) * 4 + 3]];
        if (j[3] > 1e5) continue;
        const w = smoothstep(j[3] - subBlend, j[3] + subBlend, rigA.getX(v));
        if (w <= 0) continue;
        const sq = qPart(ps.fSubQ[k], w);
        const c: V = [j[0], j[1], j[2] * side];
        p = add(c, qRot(sq, subv(p, c)));
      }
    }
    const pv: V = [piv[b * 4], piv[b * 4 + 1], piv[b * 4 + 2]];
    let pb = add(pv, qRot(ps.fQ[b], subv(p, pv)));
    let pp = p;
    let i = Math.round(piv[b * 4 + 3]);
    for (let k = 0; k < 8 && i >= 0; k++) {
      const vv: V = [piv[i * 4], piv[i * 4 + 1], piv[i * 4 + 2]];
      const q = ps.fQ[i];
      pb = add(vv, qRot(q, subv(pb, vv)));
      pp = add(vv, qRot(q, subv(pp, vv)));
      i = Math.round(piv[i * 4 + 3]);
    }
    const w = boneWA.getX(v);
    out.push(add([pp[0] + (pb[0] - pp[0]) * w, pp[1] + (pb[1] - pp[1]) * w, pp[2] + (pb[2] - pp[2]) * w], ps.fRootOff));
  }
  return out;
}

/** Posed body-space positions of every vertex of `g` (scale 1, no placement), for the inc-1 rigs 0 and 1. */
export function posePositions(rig: 0 | 1, set: CreatureMeshSet, g: THREE.BufferGeometry, inp: PoseInput, filter?: (bone: number) => boolean): V[] {
  return skinPositions(set, g, inp, rig === 0 ? hadrosaurPose : azhdarchidPose, { sub: rig === 0 ? edmontosaurusSubJoints() : azhdarchidSubJoints(), subBlend: rig === 0 ? 0.15 : 0.09, wings: rig === 1 }, filter);
}

/** The inc-1 pose functions (the inc-2 stubs on rigs 2-4 use hadrosaurPose until their packages replace them). */
export { hadrosaurPose, azhdarchidPose };
