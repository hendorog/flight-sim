// The ceratopsian pose (rig 3, Triceratops): GLSL for the fauna vertex stage (WP2 owns this file; faunaMaterial.ts
// faunaVertexGLSL(3) imports POSE_GLSL; the export name is fixed). A CPU mirror is tests/fauna/ceratopsianPoseMirror.ts
// (keep the two in step, expression for expression).
//
// CONTRACT. POSE_GLSL defines `void faunaPose()`, which runs per vertex before faunaSkin and writes fQ[0..15],
// fSubQ[0..2] (this vertex's limb: uSub base 0 forelimbs elbow / wrist, base 3 hind knee / ankle), fRootOff and
// fFold = 0 (no FAUNA_WINGS on this rig).
//
// GAITS (aInstB.w): 0 graze (head down to the ground, chewing), 1 diagonal walk with a head nod, 2 quadrupedal trot
// (diagonal pairs in phase, a short duty with a suspension). The flap channel aInstC.x is ALERT / FACING: head and
// horns lowered, the frill tipped forward at the threat, stiff, with a slow threat dip of the head.
//
// FEET. Each leg follows an explicit foot path in body space: in stance (the first `duty` of its cycle) the ankle
// moves straight back at exactly the ground speed (stride x the phase rate; the herd advances aInstB.z by distance /
// stride, herds.ts), in swing it returns forward on a lifted arc that leaves and lands at the stance's speed. The
// offsets are NOT scaled by the gait blend (a stop freezes the phase while the blend decays, so scaling would slide
// the planted feet): below blend 1 the legs instead step to rest in diagonal pairs (CERATOPSIAN_GAIT settle). A two-link IK (hip / shoulder -> knee / elbow ->
// ankle / wrist, the pivots and sub-joints of the species, read from uPivots and uSub) puts the ankle there and the
// ankle / wrist sub-joint keeps the foot flat, so a planted foot does not slide. When a target is out of the leg's
// reach (97 % of its length) the whole body drops (fRootOff) until every foot reaches: that is the bob.
// The legs hang off the root (hind) and spine2 (fore); the pose keeps root, spine1 and spine2 still so the IK frame
// is the body frame.

import { PROFILE } from '../species/triceratops.data';
import { BONE, BONE_COUNT } from '../types';

const B = BONE;
/** A float literal for GLSL. */
const f = (x: number): string => (Number.isInteger(x) ? x.toFixed(1) : String(x));

/** Gait constants shared with the CPU mirror. */
export const CERATOPSIAN_GAIT = Object.freeze({
  strideWalk: PROFILE.strideM.walk,
  strideRun: PROFILE.strideM.run,
  /** Share of the cycle a foot is on the ground: walk, trot. */
  dutyWalk: 0.62,
  dutyTrot: 0.4,
  /** Swing foot lift, m: walk, trot. */
  liftWalk: 0.16,
  liftTrot: 0.3,
  /** Right fore's phase lead after the left hind in the walk (diagonal couplets); 0 in the trot. */
  foreLagWalk: 0.15,
  /** A leg reaches at most this share of its length (thigh + shin). */
  reach: 0.97,
  /**
   * SETTLE. As the gait blend falls below 1 (stopping: the herd freezes the phase), each leg steps from its frozen
   * gait position to rest on a lifted arc, in diagonal pairs (HL + FR, then HR + FL), over these windows of
   * (1 - blend); the planted feet hold still meanwhile. Done by blend 0.1.
   */
  settleA: Object.freeze([0, 0.45] as const),
  settleB: Object.freeze([0.45, 0.9] as const),
  /** Settle step lift, m. */
  settleLift: 0.18,
});
const G = CERATOPSIAN_GAIT;

export const POSE_GLSL = /* glsl */ `
// Foot target offset from the rest ankle (dx, dy) at cycle fraction u: stance moves back at the ground speed; swing
// returns on a lifted arc, a Hermite curve leaving and arriving at the stance's speed (no world motion at lift-off
// and touch-down).
vec2 cFootOff(float u, float duty, float S, float lift) {
  if (u < duty) return vec2(S * (0.5 * duty - u), 0.0);
  float w = (u - duty) / (1.0 - duty);
  float w2 = w * w;
  float w3 = w2 * w;
  float m = -S * (1.0 - duty);
  float x = (2.0 * w3 - 3.0 * w2 + 1.0) * (-0.5 * S * duty) + (w3 - 2.0 * w2 + w) * m + (3.0 * w2 - 2.0 * w3) * (0.5 * S * duty) + (w3 - w2) * m;
  return vec2(x, lift * sin(3.14159265 * w));
}
// The settle: the gait offset carried to rest (p 0 -> 1) on a lifted step that rises before it moves forward and
// moves only while clear of the ground (horizontal progress over p 0.2 .. 0.8).
vec2 cSettle(vec2 off, float p, float lift) {
  return off * (1.0 - smoothstep(0.2, 0.8, p)) + vec2(0.0, lift * sin(3.14159265 * p));
}
// How far the body must drop for this leg to reach its target (0 if it reaches).
float cLegDrop(vec2 off, vec2 H, vec2 K, vec2 A) {
  float L = ${f(G.reach)} * (length(K - H) + length(A - K));
  vec2 d0 = A - H;
  float dx = d0.x + off.x;
  float need = sqrt(max(L * L - dx * dx, 0.0));
  return max(0.0, -d0.y - off.y - need);
}
// Two-link IK in the side view: (hip rotation, knee rotation, ankle rotation keeping the foot flat) that put the
// rest ankle A at T, bending the knee to the same side as at rest.
vec3 cLegIK(vec2 H, vec2 K, vec2 A, vec2 T) {
  vec2 t1 = K - H;
  vec2 t2 = A - K;
  float l1 = length(t1);
  float l2 = length(t2);
  float side = sign(t1.x * t2.y - t1.y * t2.x);
  vec2 d = T - H;
  float dl = clamp(length(d), abs(l1 - l2) + 0.001, l1 + l2 - 0.001);
  float g = atan(d.y, d.x);
  float al = acos(clamp((l1 * l1 + dl * dl - l2 * l2) / (2.0 * l1 * dl), -1.0, 1.0));
  float th1 = g - side * al;
  vec2 k2 = H + l1 * vec2(cos(th1), sin(th1));
  vec2 e = T - k2;
  float th2 = atan(e.y, e.x);
  float a = th1 - atan(t1.y, t1.x);
  float k = th2 - atan(t2.y, t2.x) - a;
  return vec3(a, k, -(a + k));
}
void faunaPose() {
  float b = clamp(aInstB.w, 0.0, 2.0);
  float move = clamp(b, 0.0, 1.0);
  float run = clamp(b - 1.0, 0.0, 1.0);
  float alert = clamp(aInstC.x, 0.0, 1.0);
  float graze = (1.0 - move) * (1.0 - alert);
  float u0 = fract(aInstB.z);
  float ph = F_TAU * u0;
  float seed = fract(aInstC.w);
  float t = uTime + seed * 57.0;
  float still = 1.0 - move;
  for (int i = 0; i < ${BONE_COUNT}; i++) fQ[i] = QI;
  // Legs: per-leg foot targets, the body drop that lets every foot reach, then this vertex's leg by IK.
  float S = mix(${f(G.strideWalk)}, ${f(G.strideRun)}, run);
  float duty = mix(${f(G.dutyWalk)}, ${f(G.dutyTrot)}, run);
  float lift = mix(${f(G.liftWalk)}, ${f(G.liftTrot)}, run);
  float oF = ${f(G.foreLagWalk)} * (1.0 - run);
  float pA = smoothstep(${f(G.settleA[0])}, ${f(G.settleA[1])}, still);
  float pB = smoothstep(${f(G.settleB[0])}, ${f(G.settleB[1])}, still);
  vec2 oHL = cSettle(cFootOff(u0, duty, S, lift), pA, ${f(G.settleLift)});
  vec2 oHR = cSettle(cFootOff(fract(u0 + 0.5), duty, S, lift), pB, ${f(G.settleLift)});
  vec2 oFR = cSettle(cFootOff(fract(u0 + oF), duty, S, lift), pA, ${f(G.settleLift)});
  vec2 oFL = cSettle(cFootOff(fract(u0 + 0.5 + oF), duty, S, lift), pB, ${f(G.settleLift)});
  vec2 hH = uPivots[${B.legHR}].xy;
  vec2 hK = uSub[3].xy;
  vec2 hA = uSub[4].xy;
  vec2 fH = uPivots[${B.legFR}].xy;
  vec2 fK = uSub[0].xy;
  vec2 fA = uSub[1].xy;
  float drop = max(max(cLegDrop(oHL, hH, hK, hA), cLegDrop(oHR, hH, hK, hA)), max(cLegDrop(oFL, fH, fK, fA), cLegDrop(oFR, fH, fK, fA)));
  int bone = int(aBone + 0.5);
  fSubQ[0] = QI;
  fSubQ[1] = QI;
  fSubQ[2] = QI;
  if (bone >= ${B.legFL} && bone <= ${B.legHR}) {
    bool hind = bone >= ${B.legHL};
    vec2 off = bone == ${B.legHL} ? oHL : bone == ${B.legHR} ? oHR : bone == ${B.legFL} ? oFL : oFR;
    vec2 H = hind ? hH : fH;
    vec2 K = hind ? hK : fK;
    vec2 A = hind ? hA : fA;
    vec3 ik = cLegIK(H, K, A, A + off + vec2(0.0, drop));
    fQ[bone] = qAx(AZ, ik.x);
    fSubQ[0] = qAx(AZ, ik.y);
    fSubQ[1] = qAx(AZ, ik.z);
  }
  // Neck and head: graze low (beak to the ground, chewing), a nod in the walk, alert / facing = head and horns down,
  // the frill tipped at the threat, with a slow threat dip.
  float yaw = -aInstC.y;
  float look = (graze * 0.18 * sin(t * 0.29) + alert * 0.04 * sin(t * 0.41)) * still;
  float nod = 0.07 * sin(2.0 * ph + 0.6) * move;
  float dip = alert * pow(max(0.0, sin(t * 1.1)), 6.0);
  fQ[${B.neck1}] = qYawPitch(0.35 * yaw + look, -0.22 * graze - 0.05 * alert - 0.05 * run + nod);
  fQ[${B.neck2}] = qYawPitch(0.35 * yaw + 0.6 * look, -0.14 * graze - 0.04 * alert + 0.5 * nod);
  fQ[${B.head}] = qYawPitch(0.3 * yaw, -0.16 * graze - 0.14 * alert - 0.1 * dip + 0.03 * sin(t * 0.7) * graze);
  fQ[${B.jaw}] = qAx(AZ, -(0.01 + 0.07 * graze * (0.5 + 0.5 * sin(t * 6.0))));
  // Short tail: a lagging sway with the gait, a slow idle swing.
  float idle = 0.06 * sin(t * 0.5) * still;
  fQ[${B.tail1}] = qYawPitch(0.05 * sin(ph - 0.6) * move + 0.4 * idle, 0.03 * run);
  fQ[${B.tail2}] = qYawPitch(0.08 * sin(ph - 1.2) * move + 0.7 * idle, -0.02 * cos(2.0 * ph - 1.0) * move);
  fQ[${B.tail3}] = qYawPitch(0.11 * sin(ph - 1.8) * move + idle, -0.03 * cos(2.0 * ph - 1.5) * move);
  fRootOff = vec3(0.0, -drop, 0.0);
  fFold = 0.0;
}
`;
