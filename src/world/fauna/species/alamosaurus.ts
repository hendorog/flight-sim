// Alamosaurus sanjuanensis (southern Laramidia titanosaur, ~69-66 Ma): 26 m nose to tail, ~4 m at the shoulder.
// (WP3 owns this file. The export names are fixed: createAlamosaurus() for species/index.ts
// FAUNA_SPECIES.alamosaurus.build and ALAMOSAURUS_RENDER for .render.)
//
// Body plan (rig.ts): one loft from the tip of the 11 m tail, over a deep, broad barrel body, up a 9 m neck carried
// ~30 deg above the horizontal to a small head (~9.7 m off the ground at rest); four columnar, near-straight limbs
// with elephantine pads, the forelimbs taller than the hind limbs so the back rises toward the shoulders. Origin
// on the ground under the hips, so aInstA places the feet on the terrain.
//
// RIG 4 (the sauropod: fauna/types.ts BONE_ALIAS): the neck runs neck1 -> neck2 -> wingL (neck3) -> wingR (neck4)
// -> head, so the head's chain to the root is 7 parents (head -> wingR -> wingL -> neck2 -> neck1 -> spine2 ->
// spine1 -> root) against faunaSkin's bound of 8. There is no jaw: its pivot is parked on the head (parent head, 8
// parents, no vertices). The tail is tail1-3. Limb sub-joints: knee/ankle and elbow/wrist; the wing slots (uSub
// 6-8) stay unused (w = 1e6): FAUNA_WINGS is not defined for this rig.
//
// The rest pose is the body the pose (poses/sauropod.ts) works from: the neck at ~30 deg, so the bounding length is
// the 26 m nose-to-tail (lengthM; SPECIES_REFERENCE_M is also 26, so the drawn unit is 1 and the mesh strides are
// the herds' 3.6 m). The pose raises the neck a few degrees more while browsing and lowers it on the walk.
//
// Colour: grey-brown, darker along the back with large soft blotches, a pale belly, and a lighter, mottled neck
// with faint skin-fold rings (the neck is the read at range). Linear albedo 0.03-0.15.
//
// LODs: lod0 ~3360 tris, lod1 ~460, lod2 ~80 (one loft along the whole spine with a triangular section, so the
// neck and tail survive as tapered prisms, plus four two-row legs; still animated).

import * as THREE from 'three';
import { BONE, type CreatureMeshSet, type SpeciesRender } from '../types';
import {
  chainWeight,
  clampAlbedo,
  identityFold,
  loftSpec,
  mixRGB,
  mottle,
  packPivots,
  packSubJoints,
  Profile,
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

export const ALAMOSAURUS_LENGTH_M = 26;

// Spine (section centre line), x forward, y up. Tail tip (-12.5) to snout (13.5) = 26 m.
const SPINE: Vec3[] = [
  [-12.5, 1.5, 0],
  [-10.5, 2.1, 0],
  [-8.0, 2.9, 0],
  [-5.5, 3.6, 0],
  [-3.0, 4.15, 0],
  [-0.8, 4.45, 0],
  [1.2, 4.55, 0],
  [3.0, 4.7, 0],
  [4.4, 4.95, 0],
  [5.6, 5.45, 0],
  [7.0, 6.3, 0],
  [8.6, 7.3, 0],
  [10.2, 8.3, 0],
  [11.6, 9.15, 0],
  [12.5, 9.6, 0],
  [13.1, 9.66, 0],
  [13.5, 9.42, 0],
];

// Section by station x: halfWidth, halfTop, halfBottom, superellipse exponent.
const SECTION = new Profile([
  [-12.5, 0.03, 0.03, 0.03, 2.0],
  [-11.0, 0.11, 0.14, 0.13, 2.0],
  [-8.0, 0.25, 0.33, 0.3, 2.1],
  [-5.5, 0.46, 0.55, 0.56, 2.2],
  [-3.0, 0.82, 0.68, 1.02, 2.3],
  [-0.8, 1.3, 0.75, 1.7, 2.4],
  [1.2, 1.52, 0.75, 2.02, 2.4],
  [3.0, 1.32, 0.7, 1.82, 2.3],
  [4.4, 0.85, 0.66, 1.12, 2.2],
  [5.6, 0.55, 0.52, 0.7, 2.1],
  [7.0, 0.42, 0.4, 0.49, 2.0],
  [8.6, 0.34, 0.33, 0.38, 2.0],
  [10.2, 0.28, 0.28, 0.31, 2.0],
  [11.6, 0.22, 0.22, 0.24, 2.0],
  [12.4, 0.2, 0.22, 0.22, 2.1],
  [12.9, 0.23, 0.28, 0.25, 2.2],
  [13.3, 0.17, 0.18, 0.15, 2.4],
  [13.5, 0.03, 0.03, 0.03, 2.0],
]);

// Joints along the spine (station x): child bone, blend half-width. Each joint's previous bone is its pivot parent.
const SPINE_JOINTS_TAIL: Joint[] = [
  { at: -2.0, bone: BONE.tail1, blend: 0.9 },
  { at: -5.5, bone: BONE.tail2, blend: 1.0 },
  { at: -8.8, bone: BONE.tail3, blend: 1.0 },
];
const SPINE_JOINTS_FRONT: Joint[] = [
  { at: 1.0, bone: BONE.spine1, blend: 0.8 },
  { at: 3.2, bone: BONE.spine2, blend: 0.6 },
  { at: 4.6, bone: BONE.neck1, blend: 0.5 },
  { at: 6.6, bone: BONE.neck2, blend: 0.6 },
  { at: 8.6, bone: BONE.wingL, blend: 0.6 },
  { at: 10.6, bone: BONE.wingR, blend: 0.6 },
  { at: 12.3, bone: BONE.head, blend: 0.25 },
];
/** The spine stations of the bone pivots (exported for the tests). */
export const ALAMOSAURUS_STATIONS = Object.freeze({ tail1: -2.0, tail2: -5.5, tail3: -8.8, spine1: 1.0, spine2: 3.2, neck1: 4.6, neck2: 6.6, neck3: 8.6, neck4: 10.6, head: 12.3 });

// Limbs (right side; the left mirrors z). Columnar: hip/shoulder -> knee/elbow -> ankle/wrist -> the pad, whose
// last segment is vertical so the pad's bottom ring is level at y = 0 (the pose keeps it level in the stance).
const HIND: Vec3[] = [
  [-0.6, 4.0, 0.95],
  [-0.45, 3.0, 1.0],
  [-0.3, 2.0, 1.0],
  [-0.42, 1.2, 1.0],
  [-0.5, 0.55, 1.0],
  [-0.45, 0.25, 1.0],
  [-0.44, 0.0, 1.0],
];
const FORE: Vec3[] = [
  [3.3, 4.3, 0.9],
  [3.2, 3.4, 0.95],
  [3.05, 2.5, 0.95],
  [3.15, 1.5, 0.95],
  [3.25, 0.55, 0.95],
  [3.27, 0.25, 0.95],
  [3.28, 0.0, 0.95],
];
const HIND_PAD = 0.36;
const FORE_PAD = 0.28;

/** One limb's joints (right side, body xyz): the top pivot, the knee / elbow, the ankle / wrist and the pad's centre
 * on the ground. The pose's two-link IK works on top -> knee -> ankle and keeps the pad level under the ankle. */
export interface SauropodLimb {
  top: Vec3;
  knee: Vec3;
  ankle: Vec3;
  pad: Vec3;
  /** Pad radius, m. */
  padR: number;
}
export const ALAMOSAURUS_LIMBS: Readonly<{ hind: SauropodLimb; fore: SauropodLimb }> = Object.freeze({
  hind: Object.freeze({ top: HIND[0], knee: HIND[2], ankle: HIND[4], pad: HIND[6], padR: HIND_PAD }),
  fore: Object.freeze({ top: FORE[0], knee: FORE[2], ankle: FORE[4], pad: FORE[6], padR: FORE_PAD }),
});

const mirror = (p: Vec3, s: number): Vec3 => [p[0], p[1], p[2] * s];

let spinePath: RigPath | null = null;
const spine = (): RigPath => (spinePath ??= new RigPath(SPINE));

/** The spine's arc-length parameter at station x (the path is monotone in x). */
function spineT(x: number): number {
  const s = spine();
  const p = new THREE.Vector3();
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 22; i++) {
    const mid = 0.5 * (lo + hi);
    if (s.at(mid, p).x < x) lo = mid;
    else hi = mid;
  }
  return 0.5 * (lo + hi);
}
/** The spine's centre-line point at station x. */
function spineAt(x: number, out = new THREE.Vector3()): THREE.Vector3 {
  return spine().at(spineT(x), out);
}

/**
 * The spine with its rows placed at chosen stations (LOD2: one row per bone, so every neck and tail bone keeps a
 * station and the prism still bends): row i of `stations.length` rows samples the spine at stations[i].
 */
class StationPath extends RigPath {
  private readonly knots: number[];
  constructor(stations: readonly number[]) {
    super(SPINE);
    this.knots = stations.map(spineT);
  }
  override at(t: number, out: THREE.Vector3): THREE.Vector3 {
    const n = this.knots.length - 1;
    const f = Math.min(n, Math.max(0, t * n));
    const i = Math.min(n - 1, Math.floor(f));
    return super.at(this.knots[i] + (this.knots[i + 1] - this.knots[i]) * (f - i), out);
  }
}
/** LOD2's spine stations: tail3, tail2, tail1, the body, neck1, neck2, neck3, neck4 and the head. */
const LOD2_STATIONS = [-12.5, -9.6, -6.4, -2.6, 1.6, 4.5, 7.4, 9.6, 11.6, 13.5];

const onSpine = (x: number): Vec3 => {
  const p = spineAt(x);
  return [p.x, p.y, 0];
};

/** The root pivot (on the spine above the hips), body xyz. */
export const ALAMOSAURUS_ROOT: Vec3 = [0, 4.5, 0];

/** Pivots: rest positions of the bones. NOT parent-before-child (the head hangs off wingR = neck4). */
export function alamosaurusPivots(): Float32Array {
  const S = ALAMOSAURUS_STATIONS;
  const head = onSpine(S.head);
  return packPivots(
    [
      { bone: BONE.root, at: ALAMOSAURUS_ROOT, parent: -1 },
      { bone: BONE.spine1, at: onSpine(S.spine1), parent: BONE.root },
      { bone: BONE.spine2, at: onSpine(S.spine2), parent: BONE.spine1 },
      { bone: BONE.neck1, at: onSpine(S.neck1), parent: BONE.spine2 },
      { bone: BONE.neck2, at: onSpine(S.neck2), parent: BONE.neck1 },
      { bone: BONE.wingL, at: onSpine(S.neck3), parent: BONE.neck2 },
      { bone: BONE.wingR, at: onSpine(S.neck4), parent: BONE.wingL },
      { bone: BONE.head, at: head, parent: BONE.wingR },
      { bone: BONE.jaw, at: head, parent: BONE.head },
      { bone: BONE.tail1, at: onSpine(S.tail1), parent: BONE.root },
      { bone: BONE.tail2, at: onSpine(S.tail2), parent: BONE.tail1 },
      { bone: BONE.tail3, at: onSpine(S.tail3), parent: BONE.tail2 },
      { bone: BONE.legFL, at: mirror(FORE[0], -1), parent: BONE.spine2 },
      { bone: BONE.legFR, at: FORE[0], parent: BONE.spine2 },
      { bone: BONE.legHL, at: mirror(HIND[0], -1), parent: BONE.root },
      { bone: BONE.legHR, at: HIND[0], parent: BONE.root },
    ],
    {},
  );
}

/** Limb sub-joints for the material (uSub): knee/ankle and elbow/wrist; the wing slots 6-8 unused (w = 1e6). */
export function alamosaurusSubJoints(): Float32Array {
  const hind = new RigPath(HIND);
  const fore = new RigPath(FORE);
  return packSubJoints({
    [SUB_FORE]: [
      { at: FORE[2], coord: fore.distanceTo(FORE[2]) },
      { at: FORE[4], coord: fore.distanceTo(FORE[4]) },
    ],
    [SUB_HIND]: [
      { at: HIND[2], coord: hind.distanceTo(HIND[2]) },
      { at: HIND[4], coord: hind.distanceTo(HIND[4]) },
    ],
  });
}

// Colours (linear albedo): a dark warm grey-brown. It is judged from the door window at ~700 m, where the trio
// lies against sunlit olive-brown floodplain under haze: a darker silhouette than the ground is the read.
const BACK: RGB = [0.05, 0.043, 0.034];
const BLOTCH: RGB = [0.028, 0.025, 0.021];
const BELLY: RGB = [0.19, 0.17, 0.13];
const NECK: RGB = [0.09, 0.08, 0.065];
const PAD: RGB = [0.04, 0.036, 0.032];

function bodyColour(p: THREE.Vector3, n: THREE.Vector3, station: number, sectionBottom: number, spineY: number): RGB {
  // Countershading: pale where the surface faces down and below the flank midline.
  const below = smoothstep(0.1, -0.7, (p.y - spineY) / Math.max(0.1, sectionBottom));
  const down = smoothstep(0.2, -0.6, n.y);
  const neck = smoothstep(4.6, 6.4, station) * (1 - smoothstep(12.6, 13.2, station));
  const back = mixRGB(BACK, NECK, neck * 0.85);
  let c = mixRGB(back, BELLY, Math.max(below * 0.75, down * 0.9));
  const dorsal = smoothstep(-0.55, 0.35, n.y) * (1 - 0.7 * below);
  // Large soft dark blotches over the back and tail; on the neck, pale mottling and faint skin-fold rings.
  const blotch = smoothstep(0.55, 0.75, mottle(p, 0.9, 5));
  c = mixRGB(c, BLOTCH, blotch * dorsal * (1 - 0.6 * neck) * 0.8);
  const pale = smoothstep(0.5, 0.72, mottle(p, 0.32, 9));
  c = mixRGB(c, BELLY, pale * neck * 0.55);
  const ring = 0.5 + 0.5 * Math.sin(station * 9.0 + 2.0 * mottle(p, 0.5, 4));
  c = scaleRGB(c, 1 - 0.14 * neck * smoothstep(0.75, 0.95, ring));
  // Fine mottling everywhere.
  c = scaleRGB(c, 0.8 + 0.4 * mottle(p, 0.2, 7));
  // AO under the body and in the armpits.
  const ao = 1 - 0.35 * down * smoothstep(1.4, 0.0, Math.abs(p.z) - 0.3);
  return scaleRGB(c, ao);
}

interface LodSpec {
  /** Loft rows and columns (3 columns = the triangular prism of LOD2). */
  rows: number;
  cols: number;
  /** Limb rows and columns. */
  legRows: number;
  legCols: number;
}

const LODS: readonly LodSpec[] = [
  { rows: 80, cols: 16, legRows: 14, legCols: 8 },
  { rows: 24, cols: 8, legRows: 4, legCols: 4 },
  { rows: LOD2_STATIONS.length, cols: 3, legRows: 2, legCols: 3 },
];

/** Build one LOD of the body plan (0, 1, 2). */
export function buildAlamosaurus(lod: 0 | 1 | 2): BuiltLod {
  const L = LODS[lod];
  const mesh = new RigMesh();
  const path = lod === 2 ? new StationPath(LOD2_STATIONS) : spine();
  const tmp = new THREE.Vector3();
  // LOD2's triangle is a little fatter, so the prism keeps the body's mass at range.
  const k = lod === 2 ? 1.2 : 1;

  mesh.add(
    loftSpec(path, (p) => [SECTION.at(p.x, 1) * k, SECTION.at(p.x, 2) * k, SECTION.at(p.x, 3) * k, SECTION.at(p.x, 4)], L.rows, L.cols),
    (info, out) => {
      // The station is the row's spine point (not the vertex x: on the raised neck the two differ).
      const c0 = path.at(info.u, tmp);
      const x = c0.x;
      const sy = c0.y;
      if (x < 0) chainWeight(-x, BONE.root, SPINE_JOINTS_TAIL.map((j) => ({ ...j, at: -j.at })), out);
      else chainWeight(x, BONE.root, SPINE_JOINTS_FRONT, out);
      let c = bodyColour(info.p, info.n, x, SECTION.at(x, 3), sy);
      // Head: a dark eye and mouth line.
      const eye = Math.hypot(x - 13.0, info.p.y - (sy + 0.1), Math.abs(info.p.z) - 0.2);
      if (eye < 0.07) c = [0.02, 0.018, 0.015];
      if (x > 12.9 && Math.abs(info.p.y - (sy - 0.06)) < 0.03) c = scaleRGB(c, 0.5);
      out.color = clampAlbedo(c);
    },
  );

  const limb = (pts: Vec3[], side: number, bone: number, hind: boolean): void => {
    const lp = new RigPath(pts.map((p) => mirror(p, side)));
    const len = lp.length;
    const r = hind
      ? new Profile([
          [0, 0.62, 0.7],
          [0.2, 0.52, 0.58],
          [0.4, 0.38, 0.42],
          [0.6, 0.3, 0.32],
          [0.8, 0.28, 0.3],
          [0.92, 0.34, 0.34],
          [1, HIND_PAD, HIND_PAD],
        ])
      : new Profile([
          [0, 0.52, 0.56],
          [0.2, 0.42, 0.44],
          [0.4, 0.3, 0.32],
          [0.7, 0.23, 0.24],
          [0.9, 0.25, 0.25],
          [1, FORE_PAD, FORE_PAD],
        ]);
    const kk = lod === 2 ? 0.9 : 1;
    mesh.add(tubeSpec(lp, (t) => [r.at(t, 1) * kk, r.at(t, 2) * kk], L.legRows, L.legCols), (info, out) => {
      const s = info.u * len;
      out.bone = bone;
      // The top of the limb is buried in the body: blend into the parent so the skin stretches.
      out.w = 0.35 + 0.65 * smoothstep(0, 0.8, s);
      out.limb = s;
      const top = smoothstep(1.2, 0.2, s);
      let c = mixRGB(BACK, BELLY, 0.2 + 0.25 * smoothstep(0.2, -0.6, info.n.y));
      c = scaleRGB(c, 0.85 + 0.3 * mottle(info.p, 0.25, 11));
      if (info.u > 0.9) c = mixRGB(c, PAD, smoothstep(0.9, 0.97, info.u));
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

/** All LODs, the caster (LOD1) and the shared pivots. */
export function createAlamosaurus(): CreatureMeshSet {
  const pivots = alamosaurusPivots();
  const lod0 = buildAlamosaurus(0).geometry;
  const lod1 = buildAlamosaurus(1).geometry;
  const lod2 = buildAlamosaurus(2).geometry;
  return { lod0, lod1, lod2, caster: lod1, pivots, lengthM: ALAMOSAURUS_LENGTH_M };
}

/** The animated material's view of the sauropod rig (rig 4: poses/sauropod.ts). */
export const ALAMOSAURUS_RENDER: SpeciesRender = Object.freeze({ rig: 'sauropod', subJoints: alamosaurusSubJoints, fold: identityFold, subBlend: 0.2 });
