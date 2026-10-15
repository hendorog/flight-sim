// A CPU mirror of the sauropod pose (src/world/fauna/poses/sauropod.ts POSE_GLSL), line for line, for the
// Alamosaurus tests: it returns what faunaPose writes for one vertex, and skinPositions (poseMirror.ts) applies it.
// Keep it in step with the GLSL.

import { FORE_IK, HIND_IK, SAUROPOD_GAIT as G, type LimbIK } from '../../src/world/fauna/poses/sauropod';
import { ALAMOSAURUS_RENDER, ALAMOSAURUS_ROOT, alamosaurusSubJoints } from '../../src/world/fauna/species/alamosaurus';
import { BONE as B, BONE_COUNT, type CreatureMeshSet } from '../../src/world/fauna/types';
import type * as THREE from 'three';
import { AZ, QI, TAU, clamp, qAx, qYawPitch, skinPositions, smoothstep, type PoseInput, type PoseOut, type Q, type V } from './poseMirror';

const SUB = alamosaurusSubJoints();

const fract = (x: number): number => x - Math.floor(x);
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;

/** sauLeg: the foot's fore-aft offset and the swing lift at cycle fraction u. */
export function sauLeg(u: number, D: number): [number, number] {
  u = fract(u);
  if (u < G.duty) return [D * (0.5 - u / G.duty), 0];
  const s = (u - G.duty) / (1 - G.duty);
  return [D * (-0.5 * Math.cos(Math.PI * s)), Math.sin(Math.PI * s)];
}

/** sauNeed: how far a girdle must drop for a stance foot at offset x to stay within the leg's reach. */
function need(x: number, k: LimbIK): number {
  const dx = k.ax + x - k.hx;
  return Math.max(0, k.hy - k.ay - Math.sqrt(Math.max(k.dmax * k.dmax - dx * dx, 0)));
}

/** sauIK: (top angle, knee, ankle) for the ankle offset (vx, vy) from the top pivot. */
export function sauIK(vx: number, vy: number, k: LimbIK, tilt: number): [number, number, number] {
  const { a, b } = k;
  const d = clamp(Math.hypot(vx, vy), Math.abs(a - b) + 0.01, k.dmax);
  const psi = Math.atan2(vy, vx);
  const eps = Math.acos(clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1));
  const gam = Math.acos(clamp((a * a + b * b - d * d) / (2 * a * b), -1, 1));
  const top = psi - k.psi0 + k.s * (eps - k.eps0);
  const knee = k.s * (gam - k.gam0);
  return [top, knee, tilt - top - knee];
}

/** The GLSL faunaPose for one vertex of bone `bone`. Also returns the internals the tests check. */
export function sauropodPose(inp: PoseInput, bone: number): PoseOut & { rootPitch: number } {
  const b = clamp(inp.gaitBlend, 0, 2);
  const move = clamp(b, 0, 1);
  const fast = clamp(b - 1, 0, 1);
  const browse = 1 - move;
  const alert = clamp(inp.flap, 0, 1);
  const ph = TAU * inp.phase;
  const seed = fract(inp.seed ?? 0);
  const t = (inp.time ?? 0) + seed * 57;
  const fQ: Q[] = Array.from({ length: BONE_COUNT }, () => QI);

  const D = mix(G.strideWalk, G.strideRun, fast) * G.duty * move;
  const lh = sauLeg(inp.phase, D);
  const rh = sauLeg(inp.phase + 0.5, D);
  const lf = sauLeg(inp.phase + G.foreLag, D);
  const rf = sauLeg(inp.phase + 0.5 + G.foreLag, D);
  const fade = (l: number): number => 1 - smoothstep(0, 0.35, l);
  const dH = Math.max(need(lh[0], HIND_IK) * fade(lh[1]), need(rh[0], HIND_IK) * fade(rh[1]));
  const dF = Math.max(need(lf[0], FORE_IK) * fade(lf[1]), need(rf[0], FORE_IK) * fade(rf[1]));
  const H = HIND_IK;
  const F = FORE_IK;
  const rootPitch = Math.atan2(F.hy - dF - (H.hy - dH), F.hx - H.hx) - Math.atan2(F.hy - H.hy, F.hx - H.hx);
  const tilt = -G.padTilt * move;
  const lift = G.lift * move;
  const ik = (leg: [number, number], k: LimbIK, d: number): [number, number, number] => sauIK(k.ax - k.hx + leg[0], k.ay - k.hy + d + lift * leg[1], k, tilt * leg[1]);
  const jLH = ik(lh, HIND_IK, dH);
  const jRH = ik(rh, HIND_IK, dH);
  const ca = Math.cos(rootPitch);
  const sa = Math.sin(rootPitch);
  const rc = ALAMOSAURUS_ROOT;
  const hd = [H.hx - rc[0], H.hy - rc[1]];
  const sd = [F.hx - rc[0], F.hy - rc[1]];
  const off: V = [H.hx - rc[0] - (ca * hd[0] - sa * hd[1]), H.hy - dH - rc[1] - (sa * hd[0] + ca * hd[1]), 0];
  const shoW = [rc[0] + ca * sd[0] - sa * sd[1] + off[0], rc[1] + sa * sd[0] + ca * sd[1] + off[1]];
  const ikF = (leg: [number, number]): [number, number, number] => sauIK(F.ax - shoW[0] + leg[0], F.ay - shoW[1] + lift * leg[1], F, tilt * leg[1]);
  const jLF = ikF(lf);
  const jRF = ikF(rf);
  fQ[B.root] = qAx(AZ, rootPitch);
  fQ[B.legHL] = qAx(AZ, jLH[0] - rootPitch);
  fQ[B.legHR] = qAx(AZ, jRH[0] - rootPitch);
  fQ[B.legFL] = qAx(AZ, jLF[0] - rootPitch);
  fQ[B.legFR] = qAx(AZ, jRF[0] - rootPitch);
  const j = bone === B.legHL ? jLH : bone === B.legHR ? jRH : bone === B.legFL ? jLF : jRF;
  const fSubQ: Q[] = [qAx(AZ, j[1]), qAx(AZ, j[2]), QI];
  const fRootOff: V = off;

  const cyc = 0.5 + 0.5 * Math.sin(t * ((2 * Math.PI) / G.reachPeriod) + seed * 6);
  const reach = browse * mix(G.reachLow, G.reachHigh, smoothstep(0.1, 0.9, cyc));
  const raise = reach - G.walkLower * move + G.alertRaise * alert + 0.025 * Math.sin(2 * ph) * move;
  const sweep = browse * G.sweep * Math.sin(t * ((2 * Math.PI) / G.sweepPeriod) + 1.3 + seed * 4) + 0.04 * Math.sin(ph) * move;
  const yaw = -(inp.headTurn ?? 0);
  const necks = [B.neck1, B.neck2, B.wingL, B.wingR];
  necks.forEach((nb, k) => {
    fQ[nb] = qYawPitch(G.neckYawShare[k] * (yaw + sweep), G.neckPitchShare[k] * raise - (k === 0 ? rootPitch : 0));
  });
  fQ[B.head] = qAx(AZ, -0.75 * raise - 0.06 * browse * (0.5 + 0.5 * Math.sin(t * 1.7)));

  const tw = move * (1 + 0.3 * fast);
  [B.tail1, B.tail2, B.tail3].forEach((tb, k) => {
    const lag = G.tailLag[k];
    fQ[tb] = qYawPitch(G.tailAmp[k] * (tw * Math.sin(ph - lag) + 0.6 * browse * Math.sin(t * 0.45 - lag)), -0.02 * Math.cos(2 * ph - lag) * move);
  });
  return { fQ, fSubQ, fRootOff, fFold: 0, rootPitch };
}

/** Posed body-space positions of every vertex of `g` (scale 1, no placement). */
export function sauropodPositions(set: CreatureMeshSet, g: THREE.BufferGeometry, inp: PoseInput, filter?: (bone: number) => boolean): V[] {
  return skinPositions(set, g, inp, sauropodPose, { sub: SUB, subBlend: ALAMOSAURUS_RENDER.subBlend, wings: false }, filter);
}
