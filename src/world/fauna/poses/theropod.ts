// The theropod pose (rig 2, Tyrannosaurus rex): GLSL for the fauna vertex stage (WP1 owns this file; faunaMaterial.ts
// faunaVertexGLSL(2) imports POSE_GLSL; the export name is fixed).
//
// CONTRACT. POSE_GLSL defines `void faunaPose()`, which runs per vertex before faunaSkin and must write:
//   fQ[0..15]    each bone's local rotation about its pivot (uPivots[b].xyz; parent uPivots[b].w);
//   fSubQ[0..2]  the limb sub-joint rotations for THIS vertex's limb (aBone), outermost last (uSub[base + k]:
//                base 0 forelimbs, 3 hind limbs);
//   fRootOff     a body-space offset added after the chain;
//   fFold        0 (no wing fold on this rig).
// A CPU mirror of it is tests/fauna/theropodPoseMirror.ts (it ports the same expressions; keep them in step).
//
// CHANNELS (species/index.ts): aInstB.w gaitBlend 0 crouch-idle, 1 heavy biped walk (PROFILE.strideM.walk per
// cycle), 2 charge (strideM.run); aInstB.z the gait phase (cycles; the solo agent pool advances it by distance /
// stride); aInstC.x the ROAR 0..1 (jaw open TYRANNOSAURUS_ROAR_GAPE at 1, head up, neck shake, arms flex);
// aInstC.y the head turn (+ right), spread over neck1, neck2 and the head.
//
// LEGS: the stance is solved, not swung. Each hind foot follows a path in the body frame: on the ground (the ball
// of the foot at its rest height, the toes flat) it moves straight back by duty * stride over the stance (so at the
// pool's phase rate it moves back at exactly the body's speed: no foot slip), then swings forward on a lifted arc
// with the toes curled. The ankle sits a metatarsus length behind the ball at an angle that steepens as the foot
// goes back (heel lift); hip and knee come from a two-bone IK (the knee forward). The root bone never rotates
// (the charge's horizontal lean is in spine1 and the counter-pitched tail), so the solved feet are exactly where the
// skin puts them; fRootOff carries the crouch and the bob, which the foot targets compensate.

import { PROFILE } from '../species/tyrannosaurus.data';
import { TYRANNOSAURUS_HIND, TYRANNOSAURUS_ROAR_GAPE } from '../species/tyrannosaurus';
import { BONE, BONE_COUNT } from '../types';

const B = BONE;
/** A float literal for GLSL. */
const f = (x: number): string => (Number.isInteger(x) ? x.toFixed(1) : String(x));

/** Gait shaping (shared with the CPU mirror). Lengths in body metres, angles in rad. */
export const THEROPOD_GAIT = Object.freeze({
  /** Stance fraction of the cycle: walk, charge. */
  dutyWalk: 0.62,
  dutyRun: 0.4,
  /** Swing foot lift (the ball of the foot), m. */
  liftWalk: 0.34,
  liftRun: 0.62,
  /** Stance centre of the ball, m ahead of its rest x. */
  centreWalk: 0.1,
  centreRun: 0.1,
  /** Crouch-idle: the feet staggered +-this, m; the body lowered below its rest height (idle, walk, charge), m. */
  idleSpread: 0.3,
  dropIdle: 0.32,
  dropWalk: 0.25,
  dropRun: 0.34,
  /** Vertical bob (lowest at mid-stance), m. */
  bobWalk: 0.05,
  bobRun: 0.09,
  /** Metatarsus angle change per metre of foot travel back (heel lift), rad/m; extra steepening in the swing. */
  metaPerM: 0.2,
  metaSwing: 0.35,
  /** Toe curl at mid-swing, rad. */
  toeCurl: 0.7,
});

const G = THEROPOD_GAIT;
const H = TYRANNOSAURUS_HIND;
const L1 = Math.hypot(H.knee[0] - H.hip[0], H.knee[1] - H.hip[1]);
const L2 = Math.hypot(H.ankle[0] - H.knee[0], H.ankle[1] - H.knee[1]);
const LM = Math.hypot(H.ball[0] - H.ankle[0], H.ball[1] - H.ankle[1]);
/** Rest world angles of the femur, tibia, metatarsus and toes (atan2 in the body xy plane). */
export const THEROPOD_LEG = Object.freeze({
  L1,
  L2,
  LM,
  a1: Math.atan2(H.knee[1] - H.hip[1], H.knee[0] - H.hip[0]),
  a2: Math.atan2(H.ankle[1] - H.knee[1], H.ankle[0] - H.knee[0]),
  a3: Math.atan2(H.ball[1] - H.ankle[1], H.ball[0] - H.ankle[0]),
  a4: Math.atan2(H.toe[1] - H.ball[1], H.toe[0] - H.ball[0]),
});
const LEG = THEROPOD_LEG;

/** Theropod pose: crouch-idle, heavy biped walk, charge; roar on the action channel. */
export const POSE_GLSL = /* glsl */ `
// The ball-of-foot target (body xy, before the root offset), the metatarsus angle and the toe curl for a leg at
// its own phase lp (cycles).
vec4 theropodFoot(float lp, float side, float move, float run, float stride) {
  float duty = mix(${f(G.dutyWalk)}, ${f(G.dutyRun)}, run);
  float S = duty * stride * move;
  float cx = ${f(H.ball[0])} + mix(${f(G.centreWalk)}, ${f(G.centreRun)}, run) * move + side * ${f(G.idleSpread)} * (1.0 - move);
  float bx; float by; float toe; float meta;
  if (lp < duty) {
    bx = cx + S * (0.5 - lp / duty);
    by = 0.0;
    toe = 0.0;
    meta = 0.0;
  } else {
    float s = (lp - duty) / (1.0 - duty);
    float e = s * s * (3.0 - 2.0 * s);
    float a = sin(3.1415927 * s);
    bx = cx + S * (e - 0.5);
    by = mix(${f(G.liftWalk)}, ${f(G.liftRun)}, run) * move * a;
    toe = -${f(G.toeCurl)} * move * a;
    meta = -${f(G.metaSwing)} * move * a;
  }
  meta += ${f(LEG.a3)} + ${f(G.metaPerM)} * (bx - cx);
  return vec4(bx, by, meta, toe);
}
// Solve the leg for a foot (theropodFoot) with the body lowered by rootY: (hip, knee, ankle, ball) local rotations.
vec4 theropodLegIK(vec4 ft, float rootY) {
  vec2 hip = vec2(${f(H.hip[0])}, ${f(H.hip[1])});
  vec2 ball = vec2(ft.x, ${f(H.ball[1])} + ft.y - rootY);
  vec2 ank = ball - ${f(LEG.LM)} * vec2(cos(ft.z), sin(ft.z));
  vec2 d = ank - hip;
  float L = clamp(length(d), ${f(Math.abs(L1 - L2) + 0.01)}, ${f(L1 + L2 - 0.001)});
  float ca = clamp((${f(L1 * L1 - L2 * L2)} + L * L) / (${f(2 * L1)} * L), -1.0, 1.0);
  float fem = atan(d.y, d.x) + acos(ca);
  vec2 knee = hip + ${f(L1)} * vec2(cos(fem), sin(fem));
  vec2 kt = ank - knee;
  float tib = atan(kt.y, kt.x);
  float th = fem - ${f(LEG.a1)};
  float tk = tib - ${f(LEG.a2)} - th;
  float ta = ft.z - ${f(LEG.a3)} - th - tk;
  float tb = ft.w - (th + tk + ta);
  return vec4(th, tk, ta, tb);
}
void faunaPose() {
  float b = clamp(aInstB.w, 0.0, 2.0);
  float move = clamp(b, 0.0, 1.0);
  float run = clamp(b - 1.0, 0.0, 1.0);
  float walk = move - run;
  float roar = clamp(aInstC.x, 0.0, 1.0);
  float ph = fract(aInstB.z);
  float seed = fract(aInstC.w);
  float t = uTime + seed * 57.0;
  float stride = mix(${f(PROFILE.strideM.walk)}, ${f(PROFILE.strideM.run)}, run);
  float duty = mix(${f(G.dutyWalk)}, ${f(G.dutyRun)}, run);
  for (int i = 0; i < ${BONE_COUNT}; i++) fQ[i] = QI;
  // Crouch and bob: the body sinks at each foot's mid-stance.
  float drop = ${f(G.dropIdle)} * (1.0 - move) + ${f(G.dropWalk)} * walk + ${f(G.dropRun)} * run;
  float bob = -(${f(G.bobWalk)} * walk + ${f(G.bobRun)} * run) * cos(12.566371 * (ph - 0.5 * duty));
  float rootY = bob - drop;
  float idle = 1.0 - move;
  float breathe = sin(t * 0.8);
  // Spine: the charge lowers the front (a horizontal, head-first lunge); a slow breath at rest.
  fQ[${B.spine1}] = qYawPitch(0.03 * sin(F_TAU * ph) * move, -0.07 * run + 0.012 * breathe * idle);
  fQ[${B.spine2}] = qAx(AZ, 0.015 * breathe * idle + 0.07 * roar);
  // Neck and head: head turn spread over neck1, neck2, head; the roar lifts the head and shakes the neck.
  float yaw = -aInstC.y;
  float shake = 0.07 * sin(t * 9.0) * roar;
  float look = 0.16 * sin(t * 0.27) * idle * (1.0 - roar);
  float nod = 0.035 * sin(2.0 * F_TAU * ph) * move;
  fQ[${B.neck1}] = qYawPitch(0.3 * yaw + look + shake, -0.05 * idle - 0.1 * run + 0.3 * roar + nod);
  fQ[${B.neck2}] = qYawPitch(0.35 * yaw + 0.6 * look + 0.6 * shake, -0.04 * run + 0.12 * roar);
  fQ[${B.head}] = qYawPitch(0.35 * yaw, -0.03 * idle + 0.07 * run + 0.12 * roar - 0.6 * nod);
  fQ[${B.jaw}] = qAx(AZ, -(0.015 + ${f(TYRANNOSAURUS_ROAR_GAPE - 0.015)} * roar));
  // Tail: counter-pitched up in the charge, swaying with the stride, a slow idle sway.
  float sway = 0.045 * sin(t * 0.5) * idle;
  fQ[${B.tail1}] = qYawPitch(0.05 * sin(F_TAU * ph - 0.6) * move + 0.4 * sway, 0.07 * run - 0.02 * cos(2.0 * F_TAU * ph - 0.5) * move);
  fQ[${B.tail2}] = qYawPitch(0.08 * sin(F_TAU * ph - 1.2) * move + 0.7 * sway, 0.035 * run - 0.025 * cos(2.0 * F_TAU * ph - 1.0) * move);
  fQ[${B.tail3}] = qYawPitch(0.12 * sin(F_TAU * ph - 1.8) * move + sway, -0.02 * run - 0.03 * cos(2.0 * F_TAU * ph - 1.5) * move);
  // Arms: a little swing in the walk, tucked in the charge, flexing in the roar.
  float armSw = 0.12 * sin(F_TAU * ph) * walk + 0.25 * run + 0.35 * roar + 0.06 * sin(t * 0.7) * idle;
  fQ[${B.legFL}] = qAx(AZ, armSw);
  fQ[${B.legFR}] = qAx(AZ, armSw * 0.9 + 0.05 * roar * sin(t * 11.0));
  int bone = int(aBone + 0.5);
  fSubQ[0] = QI;
  fSubQ[1] = QI;
  fSubQ[2] = QI;
  if (bone == ${B.legHL} || bone == ${B.legHR}) {
    // Left at the phase, right half a cycle on; at rest the left foot stands forward.
    float side = bone == ${B.legHL} ? 1.0 : -1.0;
    float lp = fract(ph + (bone == ${B.legHL} ? 0.0 : 0.5));
    vec4 ik = theropodLegIK(theropodFoot(lp, side, move, run, stride), rootY);
    fQ[bone] = qAx(AZ, ik.x);
    fSubQ[0] = qAx(AZ, ik.y);
    fSubQ[1] = qAx(AZ, ik.z);
    fSubQ[2] = qAx(AZ, ik.w);
  } else if (bone == ${B.legFL} || bone == ${B.legFR}) {
    fSubQ[0] = qAx(AZ, -(0.35 + 0.35 * roar + 0.3 * run));
    fSubQ[1] = qAx(AZ, -0.2 - 0.3 * roar);
  }
  fRootOff = vec3(0.0, rootY, 0.0);
  fFold = 0.0;
}
`;
