// The sauropod pose (rig 4, Alamosaurus): GLSL for the fauna vertex stage (WP3 owns this file; faunaMaterial.ts
// faunaVertexGLSL(4) imports POSE_GLSL; the export name is fixed).
//
// CONTRACT. POSE_GLSL defines `void faunaPose()`, which runs per vertex before faunaSkin and must write:
//   fQ[0..15]    each bone's local rotation about its pivot (uPivots[b].xyz; parent uPivots[b].w);
//   fSubQ[0..2]  the limb sub-joint rotations for THIS vertex's limb (aBone), outermost last (uSub[base + k]:
//                base 0 forelimbs, 3 hind limbs; bones 14/15 get no sub-joints on this rig: FAUNA_WINGS is not
//                defined for it);
//   fRootOff     a body-space offset added after the chain (keeps the stance feet on the ground);
//   fFold        0 (no wing fold on this rig).
// It may use the COMMON_GLSL helpers (qAx, qMul, qRot, qPart, qYawPitch, qInFrame, ...), the instance channels
// (aInstB.z gait phase, aInstB.w gait blend, aInstC.x flap/action, aInstC.y head turn, aInstC.w variant) and the
// uniforms uPivots, uSub, uSubBlend, uTime. A CPU mirror of it belongs in tests/fauna/sauropodPoseMirror.ts.
// WP3 wants: gait 0 browse (neck 30-45 deg up, slow sweeps into the canopy), 1 pace-like walk with a phase-lagged tail, 2 = the walk x1.3; headTurn over neck1, neck2, wingL (neck3) and wingR (neck4).
//
// WP0b STUB: a verbatim copy of the hadrosaur pose (faunaMaterial.ts HADROSAUR_POSE), for the stub body
// (the Edmontosaurus mesh and sub-joints, EDMONTOSAURUS_RENDER).

import { EDMONTOSAURUS_HIND_SOLE } from '../species/edmontosaurus';
import { BONE, BONE_COUNT } from '../types';

const B = BONE;
/** A float literal for GLSL. */
const f = (x: number): string => (Number.isInteger(x) ? x.toFixed(1) : String(x));
const SOLE = EDMONTOSAURUS_HIND_SOLE;

/** Hadrosaur pose (stub): quadrupedal diagonal walk -> bipedal run, graze/alert head, tail lag. */
export const POSE_GLSL = /* glsl */ `
vec3 hindLeg(float ph, float walk, float run) {
  // (hip swing, knee flex, ankle): swing forward while sin rises; the knee lifts the foot during the swing and,
  // in the run, gives a little under the body's weight at mid-stance.
  float s = sin(ph), c = max(0.0, cos(ph)), st = max(0.0, -cos(ph));
  float swing = 0.28 * s * walk + 0.5 * s * run;
  float knee = (0.42 * walk + 0.95 * run) * c + 0.3 * run * st;
  return vec3(swing, knee, knee * 0.85 - swing * 0.85);
}
vec2 rotZ(vec2 p, vec2 c, float a) { vec2 d = p - c; float s = sin(a), k = cos(a); return c + vec2(k * d.x - s * d.y, s * d.x + k * d.y); }
// Lowest sole point of a posed hind leg (body xy; every hind-leg rotation is about z, so the side view is exact):
// ankle, knee, hip swing, then the root pitch, as faunaSkin applies them.
float soleLow(vec3 leg, float hipRot, float rootRot) {
  float lo = 1e9;
  for (int k = 0; k < 2; k++) {
    vec2 p = k == 0 ? vec2(${f(SOLE[0])}, ${f(SOLE[1])}) : vec2(${f(SOLE[2])}, ${f(SOLE[3])});
    p = rotZ(p, uSub[4].xy, leg.z);
    p = rotZ(p, uSub[3].xy, -leg.y);
    p = rotZ(p, uPivots[${B.legHR}].xy, hipRot);
    p = rotZ(p, uPivots[${B.root}].xy, rootRot);
    lo = min(lo, p.y);
  }
  return lo;
}
vec3 foreLeg(float ph, float walk, float run) {
  float s = sin(ph), c = max(0.0, cos(ph));
  // Walk swing, or (run) tucked up: arm forward, elbow flexed, hand back.
  float swing = 0.22 * s * walk + 0.55 * run;
  float elbow = 0.4 * c * walk + 1.15 * run;
  return vec3(swing, elbow, -0.5 * elbow - swing * 0.6);
}
void faunaPose() {
  float b = clamp(aInstB.w, 0.0, 2.0);
  float move = clamp(b, 0.0, 1.0);
  float run = clamp(b - 1.0, 0.0, 1.0);
  float walk = move - run;
  float alert = clamp(aInstC.x, 0.0, 1.0);
  float graze = (1.0 - move) * (1.0 - alert);
  float ph = F_TAU * aInstB.z;
  float seed = fract(aInstC.w);
  float t = uTime + seed * 57.0;
  float still = 1.0 - alert * (1.0 - move);
  for (int i = 0; i < ${BONE_COUNT}; i++) fQ[i] = QI;
  float rootPitch = 0.11 * run;
  float rootRot = rootPitch + 0.012 * sin(2.0 * ph) * walk;
  fQ[${B.root}] = qAx(AZ, rootRot);
  fQ[${B.spine1}] = qAx(AY, 0.03 * sin(ph) * move);
  fQ[${B.spine2}] = qAx(AZ, -0.07 * graze);
  float yaw = -aInstC.y;
  float look = (graze * 0.2 * sin(t * 0.31) + (1.0 - graze) * 0.06 * sin(t * 0.23)) * still;
  float nod = 0.035 * sin(2.0 * ph) * move;
  fQ[${B.neck1}] = qYawPitch(0.3 * yaw + look, -0.55 * graze + 0.26 * alert - 0.1 * run + nod);
  fQ[${B.neck2}] = qYawPitch(0.35 * yaw + 0.6 * look, -0.48 * graze + 0.12 * alert + 0.06 * run);
  fQ[${B.head}] = qYawPitch(0.35 * yaw, -0.32 * graze + 0.05 * alert + 0.04 * sin(t * 0.7) * graze);
  fQ[${B.jaw}] = qAx(AZ, -(0.01 + 0.05 * graze * (0.5 + 0.5 * sin(t * 7.0))));
  float idle = 0.05 * sin(t * 0.6) * still;
  fQ[${B.tail1}] = qYawPitch(0.05 * sin(ph - 0.6) * move + 0.4 * idle, 0.06 * run - 0.025 * cos(2.0 * ph - 0.5) * move);
  fQ[${B.tail2}] = qYawPitch(0.07 * sin(ph - 1.2) * move + 0.7 * idle, 0.03 * run - 0.03 * cos(2.0 * ph - 1.0) * move);
  fQ[${B.tail3}] = qYawPitch(0.1 * sin(ph - 1.8) * move + idle, -0.03 * cos(2.0 * ph - 1.5) * move);
  // Diagonal couplets in the walk (left hind with right fore); hind legs alternate in the run.
  vec3 hl = hindLeg(ph, walk, run);
  vec3 hr = hindLeg(ph + 0.5 * F_TAU, walk, run);
  vec3 fr = foreLeg(ph + 0.1 * F_TAU, walk, run);
  vec3 fl = foreLeg(ph + 0.6 * F_TAU, walk, run);
  fQ[${B.legHL}] = qAx(AZ, hl.x - rootPitch);
  fQ[${B.legHR}] = qAx(AZ, hr.x - rootPitch);
  fQ[${B.legFL}] = qAx(AZ, fl.x);
  fQ[${B.legFR}] = qAx(AZ, fr.x);
  int bone = int(aBone + 0.5);
  vec3 leg = bone == ${B.legHL} ? hl : bone == ${B.legHR} ? hr : bone == ${B.legFL} ? fl : fr;
  bool hind = bone == ${B.legHL} || bone == ${B.legHR};
  // Knee flexes backward (shin swings back), elbow forward.
  fSubQ[0] = qAx(AZ, hind ? -leg.y : leg.y);
  fSubQ[1] = qAx(AZ, leg.z);
  fSubQ[2] = QI;
  // The body rides on the lower hind foot, which stays on the ground (the bob follows from the leg pose).
  fRootOff = vec3(0.0, ${f(Math.min(SOLE[1], SOLE[3]))} - min(soleLow(hl, hl.x - rootPitch, rootRot), soleLow(hr, hr.x - rootPitch, rootRot)), 0.0);
  fFold = 0.0;
}
`;
