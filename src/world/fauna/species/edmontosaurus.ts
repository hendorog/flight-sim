// Edmontosaurus annectens (Hell Creek hadrosaur, ~67 Ma): 11.5 m nose to tail, ~3.6 m at the hips.
//
// Body plan (rig.ts): one loft from the tail tip to the broad, flat "duck" bill (deep belly, tall narrow tail
// with high neural spines, a gently arched neck), four tapered limbs (massive three-segment hind legs with
// a flat, hoofed foot; slender forelimbs with a hoof-like hand). Origin on the ground under the hips, so
// aInstA places the feet on the terrain in the quadrupedal stance (the rest pose).
//
// Colour: olive grey-brown back with darker transverse bands and mottling, pale counter-shaded belly, dark
// bill and eye, AO under the body and inside the limbs. Linear albedo 0.03-0.15.

import * as THREE from 'three';
import { BONE, type CreatureMeshSet, type SpeciesRender } from '../types';
import {
  chainWeight,
  identityFold,
  clampAlbedo,
  loftSpec,
  mixRGB,
  mottle,
  packPivots,
  packSubJoints,
  Profile,
  res,
  RigMesh,
  RigPath,
  scaleRGB,
  smoothstep,
  SUB_FORE,
  SUB_HIND,
  tubeSpec,
  type BuiltLod,
  type Joint,
  type RGB,
  type Vec3,
} from '../rig';

export const EDMONTOSAURUS_LENGTH_M = 11.5;

// Spine (section centre line), x forward, y up. Tail tip to bill tip = 11.5 m.
const SPINE: Vec3[] = [
  [-5.9, 2.05, 0],
  [-4.6, 2.45, 0],
  [-3.0, 2.8, 0],
  [-1.3, 3.05, 0],
  [0.0, 3.1, 0],
  [1.3, 2.95, 0],
  [2.55, 2.6, 0],
  [3.3, 2.5, 0],
  [3.9, 2.62, 0],
  [4.4, 2.75, 0],
  [4.95, 2.62, 0],
  [5.6, 2.32, 0],
];

// Section by station x: halfWidth, halfTop, halfBottom, superellipse exponent.
const SECTION = new Profile([
  [-5.95, 0.015, 0.02, 0.02, 2.0],
  [-5.0, 0.09, 0.17, 0.14, 2.2],
  [-3.5, 0.21, 0.46, 0.34, 2.3],
  [-2.0, 0.4, 0.66, 0.55, 2.3],
  [-0.8, 0.64, 0.64, 0.86, 2.4],
  [0.3, 0.88, 0.58, 1.25, 2.4],
  [1.3, 0.94, 0.5, 1.35, 2.3],
  [2.3, 0.76, 0.44, 1.12, 2.2],
  [3.0, 0.44, 0.34, 0.62, 2.1],
  [3.6, 0.26, 0.28, 0.33, 2.0],
  [4.15, 0.23, 0.27, 0.3, 2.0],
  [4.5, 0.27, 0.3, 0.42, 2.2],
  [4.85, 0.25, 0.27, 0.37, 2.3],
  [5.2, 0.21, 0.16, 0.2, 2.5],
  [5.48, 0.21, 0.08, 0.1, 3.0],
  [5.64, 0.12, 0.035, 0.045, 2.6],
  [5.7, 0.02, 0.015, 0.02, 2.0],
]);

// Joints along the spine (station x): child bone, blend half-width.
const SPINE_JOINTS_TAIL: Joint[] = [
  { at: -0.9, bone: BONE.tail1, blend: 0.45 },
  { at: -2.6, bone: BONE.tail2, blend: 0.5 },
  { at: -4.2, bone: BONE.tail3, blend: 0.5 },
];
const SPINE_JOINTS_FRONT: Joint[] = [
  { at: 1.0, bone: BONE.spine1, blend: 0.5 },
  { at: 2.3, bone: BONE.spine2, blend: 0.5 },
  { at: 3.2, bone: BONE.neck1, blend: 0.3 },
  { at: 3.85, bone: BONE.neck2, blend: 0.25 },
  { at: 4.4, bone: BONE.head, blend: 0.18 },
];

// Limbs (right side; the left mirrors z). Joint points: [top, mid knee/elbow, ankle/wrist, toe/hand].
const HIND: Vec3[] = [
  [0.05, 2.75, 0.6],
  [0.3, 2.1, 0.66],
  [0.55, 1.45, 0.66],
  [0.28, 0.95, 0.64],
  [-0.06, 0.48, 0.62],
  [0.16, 0.13, 0.62],
  [0.5, 0.07, 0.62],
];
const HIND_KNEE: Vec3 = [0.55, 1.45, 0.66];
const HIND_ANKLE: Vec3 = [-0.06, 0.48, 0.62];
/** The hind foot's sole points (heel, toe) on the limb path, body xy: the material keeps the lower of the posed
 * feet on the ground with them (faunaMaterial.ts hadrosaur root offset). */
export const EDMONTOSAURUS_HIND_SOLE: readonly [number, number, number, number] = [HIND[5][0], HIND[5][1], HIND[6][0], HIND[6][1]];
const FORE: Vec3[] = [
  [2.6, 2.25, 0.46],
  [2.45, 1.8, 0.52],
  [2.35, 1.32, 0.53],
  [2.5, 0.85, 0.52],
  [2.62, 0.4, 0.5],
  [2.7, 0.07, 0.5],
  [2.82, 0.05, 0.5],
];
const FORE_ELBOW: Vec3 = [2.35, 1.32, 0.53];
const FORE_WRIST: Vec3 = [2.62, 0.4, 0.5];

const HIP: Vec3 = [0.05, 2.75, 0.6];
const SHOULDER: Vec3 = [2.6, 2.25, 0.46];

const mirror = (p: Vec3, s: number): Vec3 => [p[0], p[1], p[2] * s];

/** Pivots: rest positions of the bones (ordered so a parent precedes its children). */
export function edmontosaurusPivots(): Float32Array {
  return packPivots(
    [
      { bone: BONE.root, at: [0, 3.0, 0], parent: -1 },
      { bone: BONE.spine1, at: [1.0, 3.0, 0], parent: BONE.root },
      { bone: BONE.spine2, at: [2.3, 2.62, 0], parent: BONE.spine1 },
      { bone: BONE.neck1, at: [3.2, 2.5, 0], parent: BONE.spine2 },
      { bone: BONE.neck2, at: [3.85, 2.6, 0], parent: BONE.neck1 },
      { bone: BONE.head, at: [4.4, 2.78, 0], parent: BONE.neck2 },
      { bone: BONE.jaw, at: [4.55, 2.6, 0], parent: BONE.head },
      { bone: BONE.tail1, at: [-0.9, 3.08, 0], parent: BONE.root },
      { bone: BONE.tail2, at: [-2.6, 2.86, 0], parent: BONE.tail1 },
      { bone: BONE.tail3, at: [-4.2, 2.55, 0], parent: BONE.tail2 },
      { bone: BONE.legFL, at: mirror(SHOULDER, -1), parent: BONE.spine2 },
      { bone: BONE.legFR, at: SHOULDER, parent: BONE.spine2 },
      { bone: BONE.legHL, at: mirror(HIP, -1), parent: BONE.root },
      { bone: BONE.legHR, at: HIP, parent: BONE.root },
    ],
    { [BONE.wingL]: BONE.spine2, [BONE.wingR]: BONE.spine2 },
  );
}

/** Limb sub-joints for the material (uSub), with limb coordinates measured along the rest paths. */
export function edmontosaurusSubJoints(): Float32Array {
  const hind = new RigPath(HIND);
  const fore = new RigPath(FORE);
  return packSubJoints({
    [SUB_FORE]: [
      { at: FORE_ELBOW, coord: fore.distanceTo(FORE_ELBOW) },
      { at: FORE_WRIST, coord: fore.distanceTo(FORE_WRIST) },
    ],
    [SUB_HIND]: [
      { at: HIND_KNEE, coord: hind.distanceTo(HIND_KNEE) },
      { at: HIND_ANKLE, coord: hind.distanceTo(HIND_ANKLE) },
    ],
  });
}

// Colours (linear albedo). Judged in the sim (blue sky light, the real post pipeline): a near-grey palette reads
// as plain grey there, so the back is a warm olive-brown with strong dark bands.
const BACK: RGB = [0.085, 0.066, 0.038];
const BAND: RGB = [0.03, 0.025, 0.018];
const BELLY: RGB = [0.16, 0.142, 0.105];
const BILL: RGB = [0.035, 0.032, 0.028];
const HOOF: RGB = [0.04, 0.036, 0.032];

function bodyColour(p: THREE.Vector3, n: THREE.Vector3, sectionBottom: number, spineY: number): RGB {
  // Countershading: pale where the surface faces down and below the flank midline.
  const below = smoothstep(0.1, -0.7, (p.y - spineY) / Math.max(0.1, sectionBottom));
  const down = smoothstep(0.2, -0.6, n.y);
  let c = mixRGB(BACK, BELLY, Math.max(below * 0.8, down));
  // Transverse dorsal bands along the back and tail (fading down the flanks), broken up by noise.
  const m = mottle(p, 0.35, 3);
  const band = 0.5 + 0.5 * Math.sin(p.x * 2.6 + 1.5 * m);
  const dorsal = smoothstep(-0.55, 0.35, n.y) * (1 - 0.7 * below);
  c = mixRGB(c, BAND, smoothstep(0.45, 0.8, band) * dorsal * 0.85);
  // Mottling everywhere, stronger on the back.
  c = scaleRGB(c, 0.74 + 0.52 * mottle(p, 0.18, 7) * (0.6 + 0.4 * dorsal));
  // AO under the body and in the armpits.
  const ao = 1 - 0.35 * down * smoothstep(1.2, 0.0, Math.abs(p.z) - 0.2);
  return scaleRGB(c, ao);
}

/** Build one LOD of the body plan. detail 1 = LOD0; LOD2 uses `minimal` (body slab and stick legs). */
export function buildEdmontosaurus(detail: number, minimal = false): BuiltLod {
  const mesh = new RigMesh();
  const spine = new RigPath(SPINE);
  const tmp = new THREE.Vector3();

  // Body loft: rows along the spine, cols around. Rows denser toward the head (the path is arc-length).
  const rows = minimal ? 6 : res(56, detail, 8);
  const cols = minimal ? 4 : res(16, detail, 6);
  mesh.add(
    loftSpec(
      spine,
      (p) => [SECTION.at(p.x, 1), SECTION.at(p.x, 2), SECTION.at(p.x, 3), SECTION.at(p.x, 4)],
      rows,
      cols,
    ),
    (info, out) => {
      const x = info.p.x;
      if (x < 0) chainWeight(-x, BONE.root, SPINE_JOINTS_TAIL.map((j) => ({ ...j, at: -j.at })), out);
      else chainWeight(x, BONE.root, SPINE_JOINTS_FRONT, out);
      // Spine height at this station (the path is monotone in x).
      const sy = spineYAt(spine, x, tmp);
      // The lower jaw: below the head's centre line, forward of the jaw pivot.
      if (x > 4.6 && out.bone === BONE.head && info.p.y < sy - 0.04) {
        out.bone = BONE.jaw;
        out.w = smoothstep(4.6, 4.85, x);
      }
      let c = bodyColour(info.p, info.n, SECTION.at(x, 3), sy);
      // Head: the dark keratinous bill, an eye.
      if (x > 5.05) c = mixRGB(c, BILL, smoothstep(5.05, 5.3, x));
      const eye = Math.hypot(x - 4.68, info.p.y - (sy + 0.12), Math.abs(info.p.z) - 0.2);
      if (eye < 0.07) c = [0.02, 0.018, 0.015];
      out.color = clampAlbedo(c);
    },
  );

  // Limbs.
  const limb = (pts: Vec3[], side: number, bone: number, hind: boolean): void => {
    const path = new RigPath(pts.map((p) => mirror(p, side)));
    const L = path.length;
    const r = hind
      ? new Profile([
          [0, 0.5, 0.62],
          [0.18, 0.44, 0.56],
          [0.3, 0.34, 0.42],
          [0.4, 0.2, 0.24],
          [0.62, 0.13, 0.14],
          [0.78, 0.1, 0.1],
          [0.9, 0.13, 0.08],
          [1, 0.14, 0.06],
        ])
      : new Profile([
          [0, 0.2, 0.22],
          [0.3, 0.13, 0.15],
          [0.5, 0.09, 0.1],
          [0.8, 0.075, 0.08],
          [0.92, 0.1, 0.07],
          [1, 0.1, 0.05],
        ]);
    const lr = minimal ? 2 : res(hind ? 14 : 12, detail, 3);
    const lc = minimal ? 3 : res(hind ? 8 : 7, detail, 3);
    const k = minimal ? 0.8 : 1;
    mesh.add(tubeSpec(path, (t) => [r.at(t, 1) * k, r.at(t, 2) * k], lr, lc), (info, out) => {
      const s = info.u * L;
      out.bone = bone;
      // The top of the limb is buried in the body: blend into the parent so the skin stretches.
      out.w = 0.35 + 0.65 * smoothstep(0, 0.55, s);
      out.limb = s;
      const top = smoothstep(0.9, 0.2, s);
      let c = mixRGB(BACK, BELLY, 0.25 + 0.3 * smoothstep(0.2, -0.6, info.n.y));
      c = scaleRGB(c, 0.85 + 0.3 * mottle(info.p, 0.2, 11));
      if (info.u > 0.88) c = mixRGB(c, HOOF, smoothstep(0.88, 0.96, info.u));
      // AO: inner face and the top, shadowed by the body.
      const inner = smoothstep(0.2, -0.6, info.n.z * side);
      c = scaleRGB(c, (1 - 0.3 * top) * (1 - 0.25 * inner));
      out.color = clampAlbedo(c);
    });
  };
  limb(HIND, 1, BONE.legHR, true);
  limb(HIND, -1, BONE.legHL, true);
  limb(FORE, 1, BONE.legFR, false);
  limb(FORE, -1, BONE.legFL, false);

  return { geometry: mesh.build(), triangles: mesh.triangles };
}

function spineYAt(spine: RigPath, x: number, tmp: THREE.Vector3): number {
  // Bisection on t for the station x (the spine is monotone in x).
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 18; i++) {
    const mid = 0.5 * (lo + hi);
    if (spine.at(mid, tmp).x < x) lo = mid;
    else hi = mid;
  }
  return spine.at(0.5 * (lo + hi), tmp).y;
}

/** All LODs, the caster and the shared pivots. */
export function createEdmontosaurus(): CreatureMeshSet {
  const pivots = edmontosaurusPivots();
  const lod0 = buildEdmontosaurus(1).geometry;
  const lod1 = buildEdmontosaurus(0.36).geometry;
  const lod2 = buildEdmontosaurus(0, true).geometry;
  return { lod0, lod1, lod2, caster: lod1, pivots, lengthM: EDMONTOSAURUS_LENGTH_M };
}

/** The animated material's view of the hadrosaur rig (also the stub render of the inc-2 ground species). */
export const EDMONTOSAURUS_RENDER: SpeciesRender = Object.freeze({ rig: 'hadrosaur', subJoints: edmontosaurusSubJoints, fold: identityFold, subBlend: 0.15 });
