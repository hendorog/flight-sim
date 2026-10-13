// A CPU mirror of the ceratopsian pose (src/world/fauna/poses/ceratopsian.ts POSE_GLSL), expression for expression,
// for poseMirror.ts skinPositions (wings = false): tests measure the posed Triceratops against the ground.

import { CERATOPSIAN_GAIT as G } from '../../src/world/fauna/poses/ceratopsian';
import { TRICERATOPS_RENDER, triceratopsPivots, triceratopsSubJoints } from '../../src/world/fauna/species/triceratops';
import { BONE as B, BONE_COUNT } from '../../src/world/fauna/types';
import { AZ, QI, TAU, clamp, qAx, smoothstep, qYawPitch, skinPositions, type PoseInput, type PoseOut, type Q, type V } from './poseMirror';
import type { CreatureMeshSet } from '../../src/world/fauna/types';
import type { BufferGeometry } from 'three';

type V2 = [number, number];
const len = (v: V2): number => Math.hypot(v[0], v[1]);
const sub2 = (a: V2, b: V2): V2 => [a[0] - b[0], a[1] - b[1]];
const fract = (x: number): number => x - Math.floor(x);

export function footOff(u: number, duty: number, S: number, lift: number): V2 {
  if (u < duty) return [S * (0.5 * duty - u), 0];
  const w = (u - duty) / (1 - duty);
  const w2 = w * w;
  const w3 = w2 * w;
  const m = -S * (1 - duty);
  const x = (2 * w3 - 3 * w2 + 1) * (-0.5 * S * duty) + (w3 - 2 * w2 + w) * m + (3 * w2 - 2 * w3) * (0.5 * S * duty) + (w3 - w2) * m;
  return [x, lift * Math.sin(3.14159265 * w)];
}

/** The settle: the gait offset carried to rest (p 0 -> 1) on a lifted step (horizontal over p 0.2 .. 0.8). */
export function settle(off: V2, p: number, lift: number): V2 {
  const h = 1 - smoothstep(0.2, 0.8, p);
  return [off[0] * h, off[1] * h + lift * Math.sin(3.14159265 * p)];
}

function legDrop(off: V2, H: V2, K: V2, A: V2): number {
  const L = G.reach * (len(sub2(K, H)) + len(sub2(A, K)));
  const d0 = sub2(A, H);
  const dx = d0[0] + off[0];
  const need = Math.sqrt(Math.max(L * L - dx * dx, 0));
  return Math.max(0, -d0[1] - off[1] - need);
}

export function legIK(H: V2, K: V2, A: V2, T: V2): V {
  const t1 = sub2(K, H);
  const t2 = sub2(A, K);
  const l1 = len(t1);
  const l2 = len(t2);
  const side = Math.sign(t1[0] * t2[1] - t1[1] * t2[0]);
  const d = sub2(T, H);
  const dl = clamp(len(d), Math.abs(l1 - l2) + 0.001, l1 + l2 - 0.001);
  const g = Math.atan2(d[1], d[0]);
  const al = Math.acos(clamp((l1 * l1 + dl * dl - l2 * l2) / (2 * l1 * dl), -1, 1));
  const th1 = g - side * al;
  const k2: V2 = [H[0] + l1 * Math.cos(th1), H[1] + l1 * Math.sin(th1)];
  const e = sub2(T, k2);
  const th2 = Math.atan2(e[1], e[0]);
  const a = th1 - Math.atan2(t1[1], t1[0]);
  const k = th2 - Math.atan2(t2[1], t2[0]) - a;
  return [a, k, -(a + k)];
}

let RIG: { piv: Float32Array; sub: Float32Array } | null = null;
const rig = (): { piv: Float32Array; sub: Float32Array } => (RIG ??= { piv: triceratopsPivots(), sub: triceratopsSubJoints() });

/** The leg rig in the side view: [hip / shoulder, knee / elbow, ankle / wrist]. */
export function legJoints(hind: boolean): [V2, V2, V2] {
  const { piv, sub } = rig();
  if (hind) return [[piv[B.legHR * 4], piv[B.legHR * 4 + 1]], [sub[12], sub[13]], [sub[16], sub[17]]];
  return [[piv[B.legFR * 4], piv[B.legFR * 4 + 1]], [sub[0], sub[1]], [sub[4], sub[5]]];
}

export interface CeratopsianLegs {
  /** Foot target offsets per leg bone (HL, HR, FL, FR). */
  off: Record<number, V2>;
  drop: number;
}

/** The per-instance part of the pose: each leg's foot target offset and the body drop. */
export function ceratopsianLegs(inp: PoseInput): CeratopsianLegs {
  const b = clamp(inp.gaitBlend, 0, 2);
  const move = clamp(b, 0, 1);
  const run = clamp(b - 1, 0, 1);
  const u0 = fract(inp.phase);
  const S = G.strideWalk + (G.strideRun - G.strideWalk) * run;
  const duty = G.dutyWalk + (G.dutyTrot - G.dutyWalk) * run;
  const lift = G.liftWalk + (G.liftTrot - G.liftWalk) * run;
  const oF = G.foreLagWalk * (1 - run);
  const still = 1 - move;
  const pA = smoothstep(G.settleA[0], G.settleA[1], still);
  const pB = smoothstep(G.settleB[0], G.settleB[1], still);
  const off: Record<number, V2> = {
    [B.legHL]: settle(footOff(u0, duty, S, lift), pA, G.settleLift),
    [B.legHR]: settle(footOff(fract(u0 + 0.5), duty, S, lift), pB, G.settleLift),
    [B.legFR]: settle(footOff(fract(u0 + oF), duty, S, lift), pA, G.settleLift),
    [B.legFL]: settle(footOff(fract(u0 + 0.5 + oF), duty, S, lift), pB, G.settleLift),
  };
  const [hH, hK, hA] = legJoints(true);
  const [fH, fK, fA] = legJoints(false);
  const drop = Math.max(legDrop(off[B.legHL], hH, hK, hA), legDrop(off[B.legHR], hH, hK, hA), legDrop(off[B.legFL], fH, fK, fA), legDrop(off[B.legFR], fH, fK, fA));
  return { off, drop };
}

/** faunaPose of rig 3 for one vertex of bone `bone`. */
export function ceratopsianPose(inp: PoseInput, bone: number): PoseOut {
  const b = clamp(inp.gaitBlend, 0, 2);
  const move = clamp(b, 0, 1);
  const run = clamp(b - 1, 0, 1);
  const alert = clamp(inp.flap, 0, 1);
  const graze = (1 - move) * (1 - alert);
  const ph = TAU * fract(inp.phase);
  const t = (inp.time ?? 0) + (inp.seed ?? 0) * 57;
  const still = 1 - move;
  const fQ: Q[] = Array.from({ length: BONE_COUNT }, () => QI);
  const { off, drop } = ceratopsianLegs(inp);
  let fSubQ: Q[] = [QI, QI, QI];
  if (bone >= B.legFL && bone <= B.legHR) {
    const [H, K, A] = legJoints(bone >= B.legHL);
    const o = off[bone];
    const ik = legIK(H, K, A, [A[0] + o[0], A[1] + o[1] + drop]);
    fQ[bone] = qAx(AZ, ik[0]);
    fSubQ = [qAx(AZ, ik[1]), qAx(AZ, ik[2]), QI];
  }
  const yaw = -(inp.headTurn ?? 0);
  const look = (graze * 0.18 * Math.sin(t * 0.29) + alert * 0.04 * Math.sin(t * 0.41)) * still;
  const nod = 0.07 * Math.sin(2 * ph + 0.6) * move;
  const dip = alert * Math.pow(Math.max(0, Math.sin(t * 1.1)), 6);
  fQ[B.neck1] = qYawPitch(0.35 * yaw + look, -0.22 * graze - 0.05 * alert - 0.05 * run + nod);
  fQ[B.neck2] = qYawPitch(0.35 * yaw + 0.6 * look, -0.14 * graze - 0.04 * alert + 0.5 * nod);
  fQ[B.head] = qYawPitch(0.3 * yaw, -0.16 * graze - 0.14 * alert - 0.1 * dip + 0.03 * Math.sin(t * 0.7) * graze);
  fQ[B.jaw] = qAx(AZ, -(0.01 + 0.07 * graze * (0.5 + 0.5 * Math.sin(t * 6))));
  const idle = 0.06 * Math.sin(t * 0.5) * still;
  fQ[B.tail1] = qYawPitch(0.05 * Math.sin(ph - 0.6) * move + 0.4 * idle, 0.03 * run);
  fQ[B.tail2] = qYawPitch(0.08 * Math.sin(ph - 1.2) * move + 0.7 * idle, -0.02 * Math.cos(2 * ph - 1) * move);
  fQ[B.tail3] = qYawPitch(0.11 * Math.sin(ph - 1.8) * move + idle, -0.03 * Math.cos(2 * ph - 1.5) * move);
  return { fQ, fSubQ, fRootOff: [0, -drop, 0], fFold: 0 };
}

/** Posed body-space positions of the Triceratops (scale 1, no placement). */
export function ceratopsianPositions(set: CreatureMeshSet, g: BufferGeometry, inp: PoseInput, filter?: (bone: number) => boolean): V[] {
  return skinPositions(set, g, inp, ceratopsianPose, { sub: rig().sub, subBlend: TRICERATOPS_RENDER.subBlend, wings: false }, filter);
}
