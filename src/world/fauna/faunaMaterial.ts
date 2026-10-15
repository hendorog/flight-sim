// Animated instanced material for the fauna (Deep Time, WP4).
//
// A MeshStandardMaterial patched in onBeforeCompile (as the tree materials): the vertex stage poses each
// vertex with analytic bones and places the instance, so creatures are lit by the scene's sun and sky, receive
// the cascaded sun shadows, keep three's depth handling (log or reversed-Z) and take the cloud-shadow patch
// (sim/cloudShadows.ts chains onBeforeCompile and customProgramCacheKey). A matching MeshDepthMaterial shares
// the vertex code for the shadow casters.
//
// SKINNING. Every vertex has a bone (aBone) and a weight (aBoneW; the rest goes to the bone's parent). Each
// bone's local rotation (a quaternion about its rest pivot uPivots[b].xyz) is computed per vertex from the
// instance's gait channels; the vertex is rotated by its bone, then walked up the parent chain (uPivots[b].w)
// to the root, once with and once without its own bone, and the two are blended. Limb bones also have up to
// three sub-joints (knee/ankle, elbow/wrist, wing elbow/wrist/knuckle: uSub, selected by the limb coordinate
// aRig.x) applied first, outermost first. The azhdarchid's wings are modelled spread; uFold holds the local
// rotations that fold them into the walking forelimbs, and aRig.y (chord distance behind the leading edge)
// tucks the membrane in as they fold.
//
// The channel meanings (gait, alert, launch, flap) are documented in species/index.ts.

import * as THREE from 'three';
import { POSE_GLSL as CERATOPSIAN_POSE } from './poses/ceratopsian';
import { POSE_GLSL as SAUROPOD_POSE } from './poses/sauropod';
import { POSE_GLSL as THEROPOD_POSE } from './poses/theropod';
import { AZHDARCHID_CROUCH_DROP_M, azhdarchidCrouchFlex } from './species/azhdarchid';
import { EDMONTOSAURUS_HIND_SOLE } from './species/edmontosaurus';
import { FAUNA_SPECIES } from './species/index';
import { SUB_COUNT } from './rig';
import { BONE, BONE_COUNT, FAUNA_ATTR, FAUNA_STRIDE, RIG, type CreatureMeshSet, type FaunaSpeciesId, type RigIndex } from './types';

/** Rig kind of a species (the FAUNA_RIG define, types.ts RIG), from its render descriptor (species/index.ts). */
export function rigOf(id: FaunaSpeciesId): RigIndex {
  return RIG[FAUNA_SPECIES[id].render.rig];
}

const B = BONE;

/** A float literal for GLSL. */
const f = (x: number): string => (Number.isInteger(x) ? x.toFixed(1) : String(x));
const SOLE = EDMONTOSAURUS_HIND_SOLE;
const CROUCH = azhdarchidCrouchFlex();

const COMMON_GLSL = /* glsl */ `
attribute vec4 aInstA;
attribute vec4 aInstB;
attribute vec4 aInstC;
attribute float aBone;
attribute float aBoneW;
attribute vec2 aRig;
uniform vec4 uPivots[${BONE_COUNT}];
uniform vec4 uSub[${SUB_COUNT}];
uniform vec4 uFold[4];
uniform float uSubBlend;
uniform float uTime;
uniform vec3 uVariantTint[4];
varying vec3 vFaunaTint;

#define F_TAU 6.2831853
#define AX vec3(1.0, 0.0, 0.0)
#define AY vec3(0.0, 1.0, 0.0)
#define AZ vec3(0.0, 0.0, 1.0)
#define QI vec4(0.0, 0.0, 0.0, 1.0)

vec4 qAx(vec3 a, float t) { return vec4(a * sin(0.5 * t), cos(0.5 * t)); }
vec4 qMul(vec4 a, vec4 b) { return vec4(a.w * b.xyz + b.w * a.xyz + cross(a.xyz, b.xyz), a.w * b.w - dot(a.xyz, b.xyz)); }
vec3 qRot(vec4 q, vec3 v) { vec3 t = 2.0 * cross(q.xyz, v); return v + q.w * t + cross(q.xyz, t); }
// A fraction w of rotation q (normalised lerp from the identity; smooth and cheap).
vec4 qPart(vec4 q, float w) { return normalize(mix(QI, q.w < 0.0 ? -q : q, w)); }
// The left-side twin of a right-side rotation (reflection through the body's xy plane).
vec4 qMirror(vec4 q, float side) { return side > 0.0 ? q : vec4(-q.x, -q.y, q.z, q.w); }
// Rotation about z then a second about y (pitch, then yaw on top), the common neck/head case.
vec4 qYawPitch(float yaw, float pitch) { return qMul(qAx(AY, yaw), qAx(AZ, pitch)); }
// Roll about the body x axis with the right side (+z) going UP for positive t (a right-handed +x rotation
// takes +z down). Right-wing rotations go through this; qMirror makes the left wing's twin.
vec4 qRightUp(float t) { return qAx(AX, -t); }
vec4 qConj(vec4 q) { return vec4(-q.xyz, q.w); }
// A body-frame rotation r applied at a joint whose parent chain has rotated by up, as the joint's local rotation.
vec4 qInFrame(vec4 up, vec4 r) { return qMul(qConj(up), qMul(r, up)); }

vec4 fQ[${BONE_COUNT}];
vec4 fSubQ[3];
vec3 fRootOff;
float fFold;
vec3 fWorldP;
vec3 fWorldN;
`;

/** Hadrosaur pose: quadrupedal diagonal walk -> bipedal run, graze/alert head, tail lag. */
const HADROSAUR_POSE = /* glsl */ `
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

/** Azhdarchid pose: folded-wing quadrupedal walk, quad launch, flapping and gliding flight. */
const AZHDARCHID_POSE = /* glsl */ `
void faunaPose() {
  float b = clamp(aInstB.w, 0.0, 2.0);
  float L = clamp(b - 1.0, 0.0, 1.0);
  float walk = clamp(b, 0.0, 1.0) * (1.0 - smoothstep(0.0, 0.3, L));
  float crouch = smoothstep(0.0, 0.35, L) * (1.0 - smoothstep(0.3, 0.55, L));
  float vault = smoothstep(0.3, 0.55, L) * (1.0 - smoothstep(0.7, 1.0, L));
  float unfold = smoothstep(0.45, 0.85, L);
  float trail = smoothstep(0.55, 1.0, L);
  float flap = clamp(aInstC.x, 0.0, 1.0);
  float ph = F_TAU * aInstB.z;
  float seed = fract(aInstC.w);
  float t = uTime + seed * 57.0;
  // Launch hands over to flight over its last fifth (the first downstroke blends into the flight stroke).
  float flying = smoothstep(0.8, 1.0, L);
  float ground = 1.0 - trail;
  for (int i = 0; i < ${BONE_COUNT}; i++) fQ[i] = QI;
  // Torso: sloped when standing, level in flight; pitched up in the vault.
  fQ[${B.root}] = qAx(AZ, -0.5 * trail + 0.38 * vault + 0.015 * sin(2.0 * ph) * walk);
  float yaw = -aInstC.y;
  float idle = 0.28 * sin(t * 0.21) * (1.0 - walk) * ground;
  fQ[${B.neck1}] = qYawPitch(0.4 * yaw + idle, -0.32 * trail - 0.18 * crouch + 0.05 * sin(2.0 * ph) * walk + 0.03 * sin(t * 0.4) * ground);
  fQ[${B.neck2}] = qYawPitch(0.3 * yaw + 0.5 * idle, -0.12 * trail);
  fQ[${B.head}] = qYawPitch(0.3 * yaw + 0.3 * idle, 1.25 * trail - 0.04 * sin(2.0 * ph) * walk + 0.05 * sin(t * 0.33) * ground);
  // Wings. Stroke about the body x axis (+ = right tip up): launch raises them and makes the first downstroke;
  // in flight a sine stroke (flap) or the soaring dihedral (glide).
  float launchStroke = mix(0.95, -0.45, smoothstep(0.72, 1.0, L)) * unfold;
  float flightStroke = flap * 0.62 * sin(ph) + (1.0 - flap) * (0.12 + 0.02 * sin(t * 0.9));
  float stroke = mix(launchStroke, flightStroke, flying);
  // Folded walk: the forelimbs swing about the shoulder (lateral sequence; hind left at phase 0).
  float swF = 0.22 * walk;
  int bone = int(aBone + 0.5);
  float side = (bone == ${B.wingR} || bone == ${B.legHR}) ? 1.0 : -1.0;
  float legPh = ph + (side > 0.0 ? 0.5 : 0.0) * F_TAU;
  float armPh = ph + (side > 0.0 ? 0.75 : 0.25) * F_TAU;
  fFold = 1.0 - unfold;
  vec4 wingR = qMul(qAx(AZ, swF * sin(armPh) + 0.5 * trail + ${f(CROUCH.shoulder)} * crouch), qMul(qRightUp(stroke + 0.14 * max(0.0, cos(armPh)) * walk), qPart(uFold[0], fFold)));
  fQ[${B.wingR}] = wingR;
  fQ[${B.wingL}] = qMirror(wingR, -1.0);
  // Hind legs: walk, crouch and push, trail in flight.
  float s = sin(legPh), c = max(0.0, cos(legPh));
  float hip = 0.3 * s * walk + 0.45 * crouch - 0.35 * vault - 1.15 * trail;
  float knee = 0.45 * c * walk + 0.8 * crouch;
  // Limbs are leaf bones: a vertex needs only its own side's phase (side, armPh, legPh above).
  fQ[${B.legHL}] = qAx(AZ, hip);
  fQ[${B.legHR}] = fQ[${B.legHL}];
  if (bone >= ${B.wingL}) {
    // Wing sub-joints: elbow, wrist (swept back on the upstroke), knuckle (tip flex lagging the stroke).
    float sweep = -0.28 * flap * flying * max(0.0, cos(ph));
    float flex = -0.22 * flap * flying * cos(ph) + 0.05 * (1.0 - flap) * flying;
    // The crouch flexes the folded elbow and wrist (body-frame pitch, azhdarchidCrouchFlex) so the hands stay put.
    vec4 elbowR = qMul(qInFrame(wingR, qAx(AZ, ${f(CROUCH.elbow)} * crouch)), qPart(uFold[1], fFold));
    vec4 wristR = qMul(qInFrame(qMul(wingR, elbowR), qAx(AZ, ${f(CROUCH.wrist)} * crouch)), qMul(qAx(AY, sweep), qPart(uFold[2], fFold)));
    fSubQ[0] = qMirror(elbowR, side);
    fSubQ[1] = qMirror(wristR, side);
    fSubQ[2] = qMirror(qMul(qRightUp(flex), qPart(uFold[3], fFold)), side);
  } else {
    fSubQ[0] = qAx(AZ, -knee);
    fSubQ[1] = qAx(AZ, knee * 0.8);
    fSubQ[2] = QI;
  }
  fRootOff = vec3(0.0, -0.03 * (0.5 + 0.5 * cos(2.0 * ph)) * walk - ${f(AZHDARCHID_CROUCH_DROP_M)} * crouch + 0.3 * vault, 0.0);
}
`;

// Hide is a rough, dusty scatterer: a smooth dielectric's grazing-angle Fresnel reflects the bright sky as a pale
// grey sheen over the whole silhouette and washes out the baked pattern under the sim's sky light (as foliage,
// treeMaterials.ts). Keep a little of it for form.
const SKIN_SPECULAR = '#include <lights_physical_fragment>\nmaterial.specularF90 = 0.3;\nmaterial.specularColorBlended *= 0.5;';

const SKIN_IBL = /* glsl */ `
#if defined( RE_IndirectDiffuse ) && defined( USE_ENVMAP ) && defined( ENVMAP_TYPE_CUBE_UV )
iblIrradiance += getIBLIrradiance( geometryNormal );
#endif
`;

const SKIN_GLSL = /* glsl */ `
void faunaSkin() {
  faunaPose();
  int b = int(aBone + 0.5);
  vec3 p = position;
  vec3 n = normal;
#ifdef FAUNA_WINGS
  // Folding wings: the membrane tucks in toward the leading edge.
  if (b >= ${B.wingL}) p.x += aRig.y * fFold * 0.88;
  // Limb sub-joints: forelimbs (uSub 0-2), hind limbs (3-5), wings (6-8); the right side as packed, the left mirrored.
  if (b >= ${B.legFL}) {
    int base = b >= ${B.wingL} ? 6 : (b >= ${B.legHL} ? 3 : 0);
    float side = (b == ${B.legFR} || b == ${B.legHR} || b == ${B.wingR}) ? 1.0 : -1.0;
#else
  // No wings on this rig: bones 14/15 are plain bones (the sauropod's neck3/neck4), with no sub-joints.
  if (b >= ${B.legFL} && b <= ${B.legHR}) {
    int base = b >= ${B.legHL} ? 3 : 0;
    float side = (b == ${B.legFR} || b == ${B.legHR}) ? 1.0 : -1.0;
#endif
    for (int k = 2; k >= 0; k--) {
      vec4 j = uSub[base + k];
      if (j.w > 1e5) continue;
      float w = smoothstep(j.w - uSubBlend, j.w + uSubBlend, aRig.x);
      if (w <= 0.0) continue;
      vec4 sq = qPart(fSubQ[k], w);
      vec3 c = vec3(j.xy, j.z * side);
      p = c + qRot(sq, p - c);
      n = qRot(sq, n);
    }
  }
  vec4 pv = uPivots[b];
  vec3 pb = pv.xyz + qRot(fQ[b], p - pv.xyz);
  vec3 nb = qRot(fQ[b], n);
  vec3 pp = p;
  vec3 np = n;
  int i = int(pv.w);
  for (int k = 0; k < 8; k++) {
    if (i < 0) break;
    vec4 v = uPivots[i];
    vec4 q = fQ[i];
    pb = v.xyz + qRot(q, pb - v.xyz);
    pp = v.xyz + qRot(q, pp - v.xyz);
    nb = qRot(q, nb);
    np = qRot(q, np);
    i = int(v.w);
  }
  vec3 bp = mix(pp, pb, aBoneW) + fRootOff;
  // Guarded blend: near-opposite parent and own-bone normals at aBoneW ~ 0.5 cancel to ~0, and normalize(0) is NaN
  // (black or sky-blue single pixels in far herds). Fall back to the parent's normal there.
  vec3 bm = mix(np, nb, aBoneW);
  vec3 bn = dot(bm, bm) > 1e-8 ? normalize(bm) : np;
  // Instance: scale, bank (right wing down +), pitch (nose up +), yaw (heading, 0 = north, clockwise).
  // (a right-handed +x rotation takes the right side down: exactly right-wing-down-positive bank)
  vec4 qi = qMul(qAx(AY, 1.5707963 - aInstA.w), qMul(qAx(AZ, aInstB.x), qAx(AX, aInstB.y)));
  fWorldP = qRot(qi, bp * aInstC.z) + vec3(aInstA.x, aInstA.y, -aInstA.z);
  fWorldN = qRot(qi, bn);
  float seed = fract(aInstC.w);
  int variant = int(floor(aInstC.w)) & 3;
  vFaunaTint = uVariantTint[variant] * (0.86 + 0.28 * fract(seed * 37.13)) * mix(vec3(1.06, 1.0, 0.92), vec3(0.95, 1.0, 1.06), fract(seed * 91.7));
}
`;

export interface FaunaUniforms {
  uTime: { value: number };
  uPivots: { value: THREE.Vector4[] };
  uSub: { value: THREE.Vector4[] };
  uFold: { value: THREE.Vector4[] };
  uSubBlend: { value: number };
  uVariantTint: { value: THREE.Vector3[] };
  [name: string]: { value: unknown };
}

export interface FaunaMaterials {
  material: THREE.MeshStandardMaterial;
  depth: THREE.MeshDepthMaterial;
  /** Shared by both materials: set uTime each frame (seconds; drives only secondary motion). */
  uniforms: FaunaUniforms;
}

const vec4s = (a: Float32Array, n: number): THREE.Vector4[] =>
  Array.from({ length: n }, (_, i) => new THREE.Vector4(a[i * 4], a[i * 4 + 1], a[i * 4 + 2], a[i * 4 + 3]));

/** The pose code of each rig (types.ts RIG): rigs 2-4 come from poses/*.ts (WP1-WP3). */
const POSES: Readonly<Record<RigIndex, string>> = { 0: HADROSAUR_POSE, 1: AZHDARCHID_POSE, 2: THEROPOD_POSE, 3: CERATOPSIAN_POSE, 4: SAUROPOD_POSE };

/**
 * The full vertex code of a rig (exported for tests and the shader-text check). The material also defines
 * FAUNA_RIG = rig and, for the azhdarchid rig only, FAUNA_WINGS (faunaDefines).
 */
export function faunaVertexGLSL(rig: RigIndex): string {
  return `${COMMON_GLSL}\n${POSES[rig]}\n${SKIN_GLSL}`;
}

/** The material defines of a rig: FAUNA_RIG, and FAUNA_WINGS (wing fold, 14/15 mirroring, wing sub-joints) for rig 1. */
export function faunaDefines(rig: RigIndex): Record<string, number> {
  return rig === RIG.azhdarchid ? { FAUNA_RIG: rig, FAUNA_WINGS: 1 } : { FAUNA_RIG: rig };
}

/** The animated material and depth material of a species, with their shared uniforms. */
export function createFaunaMaterials(id: FaunaSpeciesId, set: CreatureMeshSet): FaunaMaterials {
  const render = FAUNA_SPECIES[id].render;
  const rig = RIG[render.rig];
  const sub = render.subJoints();
  const fold = render.fold();
  const uniforms: FaunaUniforms = {
    uTime: { value: 0 },
    uPivots: { value: vec4s(set.pivots, BONE_COUNT) },
    uSub: { value: vec4s(sub, SUB_COUNT) },
    uFold: { value: vec4s(fold, 4) },
    uSubBlend: { value: render.subBlend },
    uVariantTint: {
      value: [new THREE.Vector3(1, 1, 1), new THREE.Vector3(1.08, 0.97, 0.88), new THREE.Vector3(0.9, 0.95, 1.0), new THREE.Vector3(1.1, 1.05, 0.95)],
    },
  };
  const defines = faunaDefines(rig);
  const vertex = faunaVertexGLSL(rig);

  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
  material.name = `fauna-${id}`;
  material.defines = { ...defines };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${vertex}`)
      .replace(
        '#include <beginnormal_vertex>',
        'faunaSkin();\nvec3 objectNormal = fWorldN;\n#ifdef USE_TANGENT\nvec3 objectTangent = vec3(tangent.xyz);\n#endif',
      )
      .replace('#include <begin_vertex>', 'vec3 transformed = fWorldP;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFaunaTint;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= vFaunaTint;')
      .replace('#include <lights_physical_fragment>', SKIN_SPECULAR)
      .replace('#include <lights_fragment_maps>', SKIN_IBL);
  };
  material.customProgramCacheKey = () => `fauna-v2-${rig}`;

  const depth = new THREE.MeshDepthMaterial();
  depth.name = `fauna-depth-${id}`;
  depth.defines = { ...defines };
  depth.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${vertex}`)
      .replace('#include <begin_vertex>', 'faunaSkin();\nvec3 transformed = fWorldP;');
  };
  depth.customProgramCacheKey = () => `fauna-depth-v1-${rig}`;
  return { material, depth, uniforms };
}

/** One preallocated, interleaved instance buffer (FAUNA_STRIDE floats per instance). */
export interface FaunaInstances {
  readonly capacity: number;
  readonly array: Float32Array;
  readonly buffer: THREE.InstancedInterleavedBuffer;
  /** Instances in use; set with setCount. */
  count: number;
  /** Set the drawn count and upload only that range (never reallocates; clamps to capacity). */
  setCount(n: number): void;
}

export function createFaunaInstances(capacity: number): FaunaInstances {
  const array = new Float32Array(Math.max(1, capacity) * FAUNA_STRIDE);
  const buffer = new THREE.InstancedInterleavedBuffer(array, FAUNA_STRIDE);
  buffer.setUsage(THREE.DynamicDrawUsage);
  const geometries: THREE.InstancedBufferGeometry[] = [];
  const inst: FaunaInstances & { geometries: THREE.InstancedBufferGeometry[] } = {
    capacity,
    array,
    buffer,
    count: 0,
    geometries,
    setCount(n: number) {
      const c = Math.max(0, Math.min(capacity, Math.floor(Number.isFinite(n) ? n : 0)));
      inst.count = c;
      for (const g of geometries) g.instanceCount = c;
      buffer.clearUpdateRanges();
      if (c > 0) buffer.addUpdateRange(0, c * FAUNA_STRIDE);
      buffer.needsUpdate = true;
    },
  };
  return inst;
}

/** An instanced geometry over a species LOD geometry and an instance buffer. */
export function createFaunaGeometry(base: THREE.BufferGeometry, inst: FaunaInstances): THREE.InstancedBufferGeometry {
  const g = new THREE.InstancedBufferGeometry();
  g.index = base.index;
  for (const [k, a] of Object.entries(base.attributes)) g.setAttribute(k, a);
  for (const [name, offset] of Object.entries(FAUNA_ATTR)) g.setAttribute(name, new THREE.InterleavedBufferAttribute(inst.buffer, 4, offset));
  g.instanceCount = inst.count;
  (inst as FaunaInstances & { geometries: THREE.InstancedBufferGeometry[] }).geometries.push(g);
  return g;
}

/** A drawable: a Mesh at the origin (the vertex stage places the instances), not frustum culled. */
export function createFaunaMesh(base: THREE.BufferGeometry, inst: FaunaInstances, mats: FaunaMaterials): THREE.Mesh {
  const mesh = new THREE.Mesh(createFaunaGeometry(base, inst), mats.material);
  mesh.customDepthMaterial = mats.depth;
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  return mesh;
}

/** Write instance i (see species/index.ts for the channel meanings). */
export function writeFaunaInstance(
  a: Float32Array,
  i: number,
  east: number,
  alt: number,
  north: number,
  yaw: number,
  pitch: number,
  bank: number,
  gaitPhase: number,
  gaitBlend: number,
  flap: number,
  headTurn: number,
  scale: number,
  variant: number,
): void {
  const o = i * FAUNA_STRIDE;
  a[o] = east;
  a[o + 1] = alt;
  a[o + 2] = north;
  a[o + 3] = yaw;
  a[o + 4] = pitch;
  a[o + 5] = bank;
  a[o + 6] = gaitPhase - Math.floor(gaitPhase);
  a[o + 7] = gaitBlend;
  a[o + 8] = flap;
  a[o + 9] = headTurn;
  a[o + 10] = scale;
  a[o + 11] = variant;
}
