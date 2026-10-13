// A CPU mirror of the theropod pose (src/world/fauna/poses/theropod.ts POSE_GLSL), line for line, for the fauna
// skin mirror (poseMirror.ts skinPositions): posed T. rex geometry in body space, the hind feet's sole points and
// the jaw. Keep it in step with the GLSL.

import { THEROPOD_GAIT as G, THEROPOD_LEG as LEG } from '../../src/world/fauna/poses/theropod';
import { PROFILE } from '../../src/world/fauna/species/tyrannosaurus.data';
import { TYRANNOSAURUS_HIND as H, TYRANNOSAURUS_ROAR_GAPE, tyrannosaurusPivots, tyrannosaurusSubJoints } from '../../src/world/fauna/species/tyrannosaurus';
import { BONE as B, BONE_COUNT, type CreatureMeshSet } from '../../src/world/fauna/types';
import type * as THREE from 'three';
import { AY, AZ, QI, TAU, clamp, qAx, qMul, qRot, skinPositions, type PoseInput, type PoseOut, type Q, type V } from './poseMirror';

const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
const fract = (x: number): number => x - Math.floor(x);
const qYawPitch = (yaw: number, pitch: number): Q => qMul(qAx(AY, yaw), qAx(AZ, pitch));

/** theropodFoot: [ball x, lift, metatarsus angle, toe curl]. */
export function theropodFoot(lp: number, side: number, move: number, run: number, stride: number): [number, number, number, number] {
  const duty = mix(G.dutyWalk, G.dutyRun, run);
  const S = duty * stride * move;
  const cx = H.ball[0] + mix(G.centreWalk, G.centreRun, run) * move + side * G.idleSpread * (1 - move);
  let bx: number;
  let by: number;
  let toe: number;
  let meta: number;
  if (lp < duty) {
    bx = cx + S * (0.5 - lp / duty);
    by = 0;
    toe = 0;
    meta = 0;
  } else {
    const s = (lp - duty) / (1 - duty);
    const e = s * s * (3 - 2 * s);
    const a = Math.sin(3.1415927 * s);
    bx = cx + S * (e - 0.5);
    by = mix(G.liftWalk, G.liftRun, run) * move * a;
    toe = -G.toeCurl * move * a;
    meta = -G.metaSwing * move * a;
  }
  meta += LEG.a3 + G.metaPerM * (bx - cx);
  return [bx, by, meta, toe];
}

/** theropodLegIK: local rotations (hip, knee, ankle, ball), plus the unclamped hip-ankle reach for diagnostics. */
export function theropodLegIK(ft: [number, number, number, number], rootY: number): { q: [number, number, number, number]; reach: number } {
  const hip = [H.hip[0], H.hip[1]];
  const ball = [ft[0], H.ball[1] + ft[1] - rootY];
  const ank = [ball[0] - LEG.LM * Math.cos(ft[2]), ball[1] - LEG.LM * Math.sin(ft[2])];
  const d = [ank[0] - hip[0], ank[1] - hip[1]];
  const reach = Math.hypot(d[0], d[1]);
  const L = clamp(reach, Math.abs(LEG.L1 - LEG.L2) + 0.01, LEG.L1 + LEG.L2 - 0.001);
  const ca = clamp((LEG.L1 * LEG.L1 - LEG.L2 * LEG.L2 + L * L) / (2 * LEG.L1 * L), -1, 1);
  const fem = Math.atan2(d[1], d[0]) + Math.acos(ca);
  const knee = [hip[0] + LEG.L1 * Math.cos(fem), hip[1] + LEG.L1 * Math.sin(fem)];
  const tib = Math.atan2(ank[1] - knee[1], ank[0] - knee[0]);
  const th = fem - LEG.a1;
  const tk = tib - LEG.a2 - th;
  const ta = ft[2] - LEG.a3 - th - tk;
  const tb = ft[3] - (th + tk + ta);
  return { q: [th, tk, ta, tb], reach };
}

/** The theropod faunaPose for one vertex of bone `bone`. */
export function theropodPose(inp: PoseInput, bone: number): PoseOut {
  const b = clamp(inp.gaitBlend, 0, 2);
  const move = clamp(b, 0, 1);
  const run = clamp(b - 1, 0, 1);
  const walk = move - run;
  const roar = clamp(inp.flap, 0, 1);
  const ph = fract(inp.phase);
  const t = (inp.time ?? 0) + (inp.seed ?? 0) * 57;
  const stride = mix(PROFILE.strideM.walk, PROFILE.strideM.run, run);
  const duty = mix(G.dutyWalk, G.dutyRun, run);
  const fQ: Q[] = Array.from({ length: BONE_COUNT }, () => QI);
  const drop = G.dropIdle * (1 - move) + G.dropWalk * walk + G.dropRun * run;
  const bob = -(G.bobWalk * walk + G.bobRun * run) * Math.cos(12.566371 * (ph - 0.5 * duty));
  const rootY = bob - drop;
  const idle = 1 - move;
  const breathe = Math.sin(t * 0.8);
  fQ[B.spine1] = qYawPitch(0.03 * Math.sin(TAU * ph) * move, -0.07 * run + 0.012 * breathe * idle);
  fQ[B.spine2] = qAx(AZ, 0.015 * breathe * idle + 0.07 * roar);
  const yaw = -(inp.headTurn ?? 0);
  const shake = 0.07 * Math.sin(t * 9) * roar;
  const look = 0.16 * Math.sin(t * 0.27) * idle * (1 - roar);
  const nod = 0.035 * Math.sin(2 * TAU * ph) * move;
  fQ[B.neck1] = qYawPitch(0.3 * yaw + look + shake, -0.05 * idle - 0.1 * run + 0.3 * roar + nod);
  fQ[B.neck2] = qYawPitch(0.35 * yaw + 0.6 * look + 0.6 * shake, -0.04 * run + 0.12 * roar);
  fQ[B.head] = qYawPitch(0.35 * yaw, -0.03 * idle + 0.07 * run + 0.12 * roar - 0.6 * nod);
  fQ[B.jaw] = qAx(AZ, -(0.015 + (TYRANNOSAURUS_ROAR_GAPE - 0.015) * roar));
  const sway = 0.045 * Math.sin(t * 0.5) * idle;
  fQ[B.tail1] = qYawPitch(0.05 * Math.sin(TAU * ph - 0.6) * move + 0.4 * sway, 0.07 * run - 0.02 * Math.cos(2 * TAU * ph - 0.5) * move);
  fQ[B.tail2] = qYawPitch(0.08 * Math.sin(TAU * ph - 1.2) * move + 0.7 * sway, 0.035 * run - 0.025 * Math.cos(2 * TAU * ph - 1) * move);
  fQ[B.tail3] = qYawPitch(0.12 * Math.sin(TAU * ph - 1.8) * move + sway, -0.02 * run - 0.03 * Math.cos(2 * TAU * ph - 1.5) * move);
  const armSw = 0.12 * Math.sin(TAU * ph) * walk + 0.25 * run + 0.35 * roar + 0.06 * Math.sin(t * 0.7) * idle;
  fQ[B.legFL] = qAx(AZ, armSw);
  fQ[B.legFR] = qAx(AZ, armSw * 0.9 + 0.05 * roar * Math.sin(t * 11));
  let fSubQ: Q[] = [QI, QI, QI];
  if (bone === B.legHL || bone === B.legHR) {
    const side = bone === B.legHL ? 1 : -1;
    const lp = fract(ph + (bone === B.legHL ? 0 : 0.5));
    const ik = theropodLegIK(theropodFoot(lp, side, move, run, stride), rootY).q;
    fQ[bone] = qAx(AZ, ik[0]);
    fSubQ = [qAx(AZ, ik[1]), qAx(AZ, ik[2]), qAx(AZ, ik[3])];
  } else if (bone === B.legFL || bone === B.legFR) {
    fSubQ = [qAx(AZ, -(0.35 + 0.35 * roar + 0.3 * run)), qAx(AZ, -0.2 - 0.3 * roar), QI];
  }
  return { fQ, fSubQ, fRootOff: [0, rootY, 0], fFold: 0 };
}

let SUB: Float32Array | null = null;
const opts = () => ({ sub: (SUB ??= tyrannosaurusSubJoints()), subBlend: 0.12, wings: false });

/** Posed body-space positions of every vertex of `g` (scale 1, no placement). */
export function theropodPositions(set: CreatureMeshSet, g: THREE.BufferGeometry, inp: PoseInput, filter?: (bone: number) => boolean): V[] {
  return skinPositions(set, g, inp, theropodPose, opts(), filter);
}

let PIV: Float32Array | null = null;

/**
 * Where faunaSkin puts a point of a hind leg's foot (body xy of the RIGHT-side rest point p, limb coordinate past
 * every sub-joint, weight 1): the ball and toe sole points for the slip tests. `bone` = legHL or legHR.
 */
export function footPoint(inp: PoseInput, bone: number, p: readonly [number, number]): V {
  const ps = theropodPose(inp, bone);
  const sub = opts().sub;
  PIV ??= tyrannosaurusPivots();
  let q: V = [p[0], p[1], 0];
  for (let k = 2; k >= 0; k--) {
    const c: V = [sub[(3 + k) * 4], sub[(3 + k) * 4 + 1], 0];
    const r = qRot(ps.fSubQ[k], [q[0] - c[0], q[1] - c[1], q[2] - c[2]]);
    q = [c[0] + r[0], c[1] + r[1], c[2] + r[2]];
  }
  const hv: V = [PIV[bone * 4], PIV[bone * 4 + 1], 0];
  const r = qRot(ps.fQ[bone], [q[0] - hv[0], q[1] - hv[1], q[2] - hv[2]]);
  // The root bone is the identity on this rig; the chain above the leg adds nothing.
  return [hv[0] + r[0] + ps.fRootOff[0], hv[1] + r[1] + ps.fRootOff[1], hv[2] + r[2]];
}

/** The sole points of the foot (body xy, right side): under the ball, and near the toe tip. */
export const SOLE_POINTS: readonly (readonly [number, number])[] = [
  [H.ball[0], 0],
  [H.toe[0] - 0.08, 0],
];
