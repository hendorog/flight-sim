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
// A line-for-line CPU mirror lives in tests/fauna/sauropodPoseMirror.ts (keep the two in step).
//
// CHANNELS (species/index.ts): gaitBlend 0 browse, 1 pace-like walk, 2 = the walk x1.3 (the profile's run stride,
// 4.7 m against 3.6, at 1.3 m/s); flap = ALERT 0..1 (neck raised); headTurn spread over the 4 neck bones (neck1,
// neck2, wingL = neck3, wingR = neck4).
//
// THE POSE
// - Browse (gait 0): the neck, modelled at ~30 deg, rises a further 2-13 deg into the canopy and sinks again over a
//   10 s cycle while it sweeps +-16 deg side to side over 13 s (per-animal timing from the variant fraction); the
//   head stays near level and nibbles. The head is >= 9.5 m off the ground throughout.
// - Walk (gait 1-2): a pace-like lateral-sequence walk (the ipsilateral fore foot lands foreLag of a cycle after
//   its hind foot, the right side half a cycle after the left), duty factor 0.65, on near-straight columnar legs.
//   Each stance pad moves back under the body linearly in the gait phase, by exactly the stride x the duty, so it
//   stays planted while the herds advance the phase by distance / stride; the swing brings it forward on a half
//   cosine, lifted and tipped toe-down. Every leg is a two-link IK (top -> knee -> ankle; the ankle keeps the pad
//   level in the stance), so the pads land exactly where the walk puts them. Each girdle drops as far as its most
//   stretched stance leg needs (a vaulting bob of ~0.1-0.2 m); the other stance leg bends to stay down. The girdle
//   drops become a root offset and a root pitch, which the legs counter-rotate. The neck lowers ~6 deg and bobs;
//   the tail swings side to side with a lag that grows down the tail (tailLag).

import { PROFILE } from '../species/alamosaurus.data';
import { ALAMOSAURUS_LIMBS, ALAMOSAURUS_ROOT, type SauropodLimb } from '../species/alamosaurus';
import { BONE, BONE_COUNT } from '../types';

const B = BONE;
/** A float literal for GLSL. */
const f = (x: number): string => (Number.isInteger(x) ? x.toFixed(1) : String(x));

/** The walk's numbers, shared with the CPU mirror. */
export const SAUROPOD_GAIT = Object.freeze({
  /** Fraction of a cycle each foot is on the ground. */
  duty: 0.65,
  /** The fore foot's phase after its own side's hind foot, cycles (pace-like: small). */
  foreLag: 0.1,
  /** Stride per cycle at gaitBlend 1 and 2, m (the profile's: the herds advance the phase by distance / stride). */
  strideWalk: PROFILE.strideM.walk,
  strideRun: PROFILE.strideM.run,
  /** Swing: how high the pad lifts (m at full lift) and how far it tips toe-down (rad). */
  lift: 0.4,
  padTilt: 0.25,
  /** The legs straighten at most this far from their rest bend toward fully straight (0 rest .. 1 straight). */
  reach: 1.0,
  /** Tail sway phase lag (rad behind the gait phase) and amplitude (rad) for tail1, tail2, tail3. */
  tailLag: Object.freeze([0.55, 1.15, 1.8] as const),
  tailAmp: Object.freeze([0.045, 0.075, 0.11] as const),
  /** Browse: the neck's raise over its rest pose (rad, low and high of the cycle) and the cycle period (s). */
  reachLow: 0.04,
  reachHigh: 0.23,
  reachPeriod: 10,
  /** Browse: the side-to-side sweep amplitude (rad, summed over the neck) and its period (s). */
  sweep: 0.28,
  sweepPeriod: 13,
  /** Walk: the neck lowers this much (rad); alert raises it this much. */
  walkLower: 0.1,
  alertRaise: 0.12,
  /** How the neck raise and sweep / head turn spread over neck1, neck2, wingL (neck3), wingR (neck4). */
  neckPitchShare: Object.freeze([0.34, 0.28, 0.22, 0.16] as const),
  neckYawShare: Object.freeze([0.3, 0.3, 0.2, 0.2] as const),
});

const G = SAUROPOD_GAIT;

/** A limb's two-link IK constants (top -> knee -> ankle, right side, body xy). */
export interface LimbIK {
  /** Top pivot (hip / shoulder) and the ankle / wrist at rest. */
  hx: number;
  hy: number;
  ax: number;
  ay: number;
  /** Thigh and shin lengths. */
  a: number;
  b: number;
  /** +1 when the knee bends forward (hind), -1 when the elbow bends back (fore). */
  s: number;
  /** Rest: the top -> ankle direction, the thigh's angle off it, the knee's interior angle (rad). */
  psi0: number;
  eps0: number;
  gam0: number;
  /** Longest top -> ankle distance the legs reach. */
  dmax: number;
}

const lawAngle = (a: number, b: number, c: number): number => Math.acos(Math.min(1, Math.max(-1, (a * a + b * b - c * c) / (2 * a * b))));

export function limbIK(L: SauropodLimb, s: number): LimbIK {
  const a = Math.hypot(L.knee[0] - L.top[0], L.knee[1] - L.top[1]);
  const b = Math.hypot(L.ankle[0] - L.knee[0], L.ankle[1] - L.knee[1]);
  const vx = L.ankle[0] - L.top[0];
  const vy = L.ankle[1] - L.top[1];
  const d0 = Math.hypot(vx, vy);
  return {
    hx: L.top[0],
    hy: L.top[1],
    ax: L.ankle[0],
    ay: L.ankle[1],
    a,
    b,
    s,
    psi0: Math.atan2(vy, vx),
    eps0: lawAngle(a, d0, b),
    gam0: lawAngle(a, b, d0),
    dmax: d0 + G.reach * (a + b - d0),
  };
}
export const HIND_IK = limbIK(ALAMOSAURUS_LIMBS.hind, 1);
export const FORE_IK = limbIK(ALAMOSAURUS_LIMBS.fore, -1);
const HI = HIND_IK;
const FI = FORE_IK;
const ikArgs = (k: LimbIK): string => [k.a, k.b, k.s, k.psi0, k.eps0, k.gam0, k.dmax].map(f).join(', ');

/** Sauropod pose: browse with a raised, sweeping neck; a pace-like walk on columnar legs; a lagging tail. */
export const POSE_GLSL = /* glsl */ `
// A leg at gait-cycle fraction u: x = the foot's fore-aft offset from its rest spot (body m), y = swing lift 0..1.
// Stance (u < duty): from +D/2 back to -D/2, linear in u (the planted foot); swing: forward on a half cosine.
vec2 sauLeg(float u, float D) {
  u = fract(u);
  if (u < ${f(G.duty)}) return vec2(D * (0.5 - u / ${f(G.duty)}), 0.0);
  float s = (u - ${f(G.duty)}) / ${f(1 - G.duty)};
  return vec2(D * (-0.5 * cos(3.14159265 * s)), sin(3.14159265 * s));
}
// How far the girdle must drop for a stance foot at offset x to stay within the leg's reach (m, >= 0).
float sauNeed(float x, vec2 h, vec2 a0, float dmax) {
  float dx = a0.x + x - h.x;
  return max(0.0, (h.y - a0.y) - sqrt(max(dmax * dmax - dx * dx, 0.0)));
}
// Two-link IK (top -> knee -> ankle) to the ankle offset v from the top pivot: (top angle, knee, ankle), the ankle
// keeping the pad at \`tilt\` in the body frame (level in the stance).
vec3 sauIK(vec2 v, float a, float b, float s, float psi0, float eps0, float gam0, float dmax, float tilt) {
  float d = clamp(length(v), abs(a - b) + 0.01, dmax);
  float psi = atan(v.y, v.x);
  float eps = acos(clamp((a * a + d * d - b * b) / (2.0 * a * d), -1.0, 1.0));
  float gam = acos(clamp((a * a + b * b - d * d) / (2.0 * a * b), -1.0, 1.0));
  float top = psi - psi0 + s * (eps - eps0);
  float knee = s * (gam - gam0);
  return vec3(top, knee, tilt - top - knee);
}
void faunaPose() {
  float b = clamp(aInstB.w, 0.0, 2.0);
  float move = clamp(b, 0.0, 1.0);
  float fast = clamp(b - 1.0, 0.0, 1.0);
  float browse = 1.0 - move;
  float alert = clamp(aInstC.x, 0.0, 1.0);
  float ph = F_TAU * aInstB.z;
  float seed = fract(aInstC.w);
  float t = uTime + seed * 57.0;
  for (int i = 0; i < ${BONE_COUNT}; i++) fQ[i] = QI;

  // Legs: the stance sweep D = stride x duty (x move, so a standing animal's legs are at rest).
  float D = mix(${f(G.strideWalk)}, ${f(G.strideRun)}, fast) * ${f(G.duty)} * move;
  vec2 lh = sauLeg(aInstB.z, D);
  vec2 rh = sauLeg(aInstB.z + 0.5, D);
  vec2 lf = sauLeg(aInstB.z + ${f(G.foreLag)}, D);
  vec2 rf = sauLeg(aInstB.z + ${f(0.5 + G.foreLag)}, D);
  // Each girdle drops as far as its most stretched stance leg needs (the vaulting bob); the other legs bend.
  vec2 hH = vec2(${f(HI.hx)}, ${f(HI.hy)}), hA = vec2(${f(HI.ax)}, ${f(HI.ay)});
  vec2 fH = vec2(${f(FI.hx)}, ${f(FI.hy)}), fA = vec2(${f(FI.ax)}, ${f(FI.ay)});
  float dH = max(sauNeed(lh.x, hH, hA, ${f(HI.dmax)}) * (1.0 - smoothstep(0.0, 0.35, lh.y)), sauNeed(rh.x, hH, hA, ${f(HI.dmax)}) * (1.0 - smoothstep(0.0, 0.35, rh.y)));
  float dF = max(sauNeed(lf.x, fH, fA, ${f(FI.dmax)}) * (1.0 - smoothstep(0.0, 0.35, lf.y)), sauNeed(rf.x, fH, fA, ${f(FI.dmax)}) * (1.0 - smoothstep(0.0, 0.35, rf.y)));
  // The root turns the hip -> shoulder line onto the dropped girdles and moves the hip pivot onto its drop.
  vec2 hipT = hH - vec2(0.0, dH);
  vec2 shoT = fH - vec2(0.0, dF);
  float rootPitch = atan(shoT.y - hipT.y, shoT.x - hipT.x) - ${f(Math.atan2(FI.hy - HI.hy, FI.hx - HI.hx))};
  float tilt = -${f(G.padTilt)} * move;
  vec3 jLH = sauIK(hA - hH + vec2(lh.x, dH + ${f(G.lift)} * lh.y), ${ikArgs(HI)}, tilt * lh.y);
  vec3 jRH = sauIK(hA - hH + vec2(rh.x, dH + ${f(G.lift)} * rh.y), ${ikArgs(HI)}, tilt * rh.y);
  // The root offset puts the hip pivot exactly on its drop; the shoulder lands within millimetres of its own, and
  // the fore legs reach from where it actually is.
  vec2 rc = vec2(${f(ALAMOSAURUS_ROOT[0])}, ${f(ALAMOSAURUS_ROOT[1])});
  float ca = cos(rootPitch), sa = sin(rootPitch);
  vec2 hd = hH - rc, sd = fH - rc;
  vec2 off = hipT - rc - vec2(ca * hd.x - sa * hd.y, sa * hd.x + ca * hd.y);
  vec2 shoW = rc + vec2(ca * sd.x - sa * sd.y, sa * sd.x + ca * sd.y) + off;
  vec3 jLF = sauIK(fA - shoW + vec2(lf.x, ${f(G.lift)} * lf.y), ${ikArgs(FI)}, tilt * lf.y);
  vec3 jRF = sauIK(fA - shoW + vec2(rf.x, ${f(G.lift)} * rf.y), ${ikArgs(FI)}, tilt * rf.y);
  fQ[${B.root}] = qAx(AZ, rootPitch);
  fQ[${B.legHL}] = qAx(AZ, jLH.x - rootPitch);
  fQ[${B.legHR}] = qAx(AZ, jRH.x - rootPitch);
  fQ[${B.legFL}] = qAx(AZ, jLF.x - rootPitch);
  fQ[${B.legFR}] = qAx(AZ, jRF.x - rootPitch);
  int bone = int(aBone + 0.5);
  vec3 j = bone == ${B.legHL} ? jLH : bone == ${B.legHR} ? jRH : bone == ${B.legFL} ? jLF : jRF;
  fSubQ[0] = qAx(AZ, j.y);
  fSubQ[1] = qAx(AZ, j.z);
  fSubQ[2] = QI;
  fRootOff = vec3(off, 0.0);

  // Neck: the browse reach cycle and sweep, lowered on the walk, raised when alert; the head turn over 4 bones.
  float cyc = 0.5 + 0.5 * sin(t * ${f((2 * Math.PI) / G.reachPeriod)} + seed * 6.0);
  float reach = browse * mix(${f(G.reachLow)}, ${f(G.reachHigh)}, smoothstep(0.1, 0.9, cyc));
  float raise = reach - ${f(G.walkLower)} * move + ${f(G.alertRaise)} * alert + 0.025 * sin(2.0 * ph) * move;
  float sweep = browse * ${f(G.sweep)} * sin(t * ${f((2 * Math.PI) / G.sweepPeriod)} + 1.3 + seed * 4.0) + 0.04 * sin(ph) * move;
  float yaw = -aInstC.y;
  // neck1 also takes out the walk's root pitch, so the head rides steady over the rocking body.
  fQ[${B.neck1}] = qYawPitch(${f(G.neckYawShare[0])} * (yaw + sweep), ${f(G.neckPitchShare[0])} * raise - rootPitch);
  fQ[${B.neck2}] = qYawPitch(${f(G.neckYawShare[1])} * (yaw + sweep), ${f(G.neckPitchShare[1])} * raise);
  fQ[${B.wingL}] = qYawPitch(${f(G.neckYawShare[2])} * (yaw + sweep), ${f(G.neckPitchShare[2])} * raise);
  fQ[${B.wingR}] = qYawPitch(${f(G.neckYawShare[3])} * (yaw + sweep), ${f(G.neckPitchShare[3])} * raise);
  fQ[${B.head}] = qAx(AZ, -0.75 * raise - 0.06 * browse * (0.5 + 0.5 * sin(t * 1.7)));

  // Tail: the walk's side-to-side swing, lagging more down the tail (x1.3 at gait 2), and a slow idle sway.
  float tw = move * (1.0 + 0.3 * fast);
  fQ[${B.tail1}] = qYawPitch(${f(G.tailAmp[0])} * (tw * sin(ph - ${f(G.tailLag[0])}) + 0.6 * browse * sin(t * 0.45 - ${f(G.tailLag[0])})), -0.02 * cos(2.0 * ph - ${f(G.tailLag[0])}) * move);
  fQ[${B.tail2}] = qYawPitch(${f(G.tailAmp[1])} * (tw * sin(ph - ${f(G.tailLag[1])}) + 0.6 * browse * sin(t * 0.45 - ${f(G.tailLag[1])})), -0.02 * cos(2.0 * ph - ${f(G.tailLag[1])}) * move);
  fQ[${B.tail3}] = qYawPitch(${f(G.tailAmp[2])} * (tw * sin(ph - ${f(G.tailLag[2])}) + 0.6 * browse * sin(t * 0.45 - ${f(G.tailLag[2])})), -0.02 * cos(2.0 * ph - ${f(G.tailLag[2])}) * move);
  fFold = 0.0;
}
`;
