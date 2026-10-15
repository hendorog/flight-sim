// Triceratops horridus (Hell Creek ceratopsian, ~67 Ma): 8.5 m beak to tail, ~2.9 m at the hips. Rig 3 (ceratopsian).
// The export names are fixed: createTriceratops() (species/index.ts FAUNA_SPECIES.triceratops.build) and
// TRICERATOPS_RENDER (.render).
//
// Body plan (rig.ts): one loft from the short tail tip to the parrot beak (a wide barrel body highest over the hips,
// the back sloping down to low shoulders, a short neck, a deep skull carried low), the frill (a lens-shaped plate
// rising back over the neck), two long brow horns and a short nasal horn, and four columnar limbs (massive hind legs,
// shorter forelimbs with the elbow set back). The frill and the horns are rigid on the head bone; the beak's lower
// half is on the jaw (types.ts BONE_ALIAS.ceratopsian). Origin on the ground under the hips.
//
// Colour: a COLOUR MASS for the windscreen (a herd of 7 at 400-1500 m is 6-20 px a body): a dark grey-olive body
// with a pale belly against a rust frill with a cream rim, cream horns. Linear albedo 0.03-0.16.
//
// The pose (poses/ceratopsian.ts) places the feet by two-link IK about the pivots and sub-joints below (the hip /
// shoulder pivot, the knee / elbow and the ankle / wrist).

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

export const TRICERATOPS_LENGTH_M = 8.5;

// Spine (section centre line), x forward, y up. Tail tip (-3.7) to beak tip (4.8) = 8.5 m.
const SPINE: Vec3[] = [
  [-3.7, 1.05, 0],
  [-2.8, 1.45, 0],
  [-1.8, 1.85, 0],
  [-0.8, 2.1, 0],
  [0.0, 2.15, 0],
  [1.0, 2.05, 0],
  [1.9, 1.85, 0],
  [2.5, 1.72, 0],
  [3.1, 1.6, 0],
  [3.7, 1.42, 0],
  [4.3, 1.2, 0],
  [4.8, 0.95, 0],
];

// Section by station x: halfWidth, halfTop, halfBottom, superellipse exponent. The barrel is widest over the belly.
const SECTION = new Profile([
  [-3.72, 0.02, 0.02, 0.02, 2.0],
  [-3.0, 0.12, 0.16, 0.14, 2.1],
  [-2.0, 0.28, 0.36, 0.3, 2.2],
  [-1.0, 0.66, 0.6, 0.62, 2.4],
  [0.0, 1.0, 0.75, 0.95, 2.5],
  [1.0, 1.1, 0.72, 1.0, 2.5],
  [1.9, 0.86, 0.6, 0.78, 2.4],
  [2.5, 0.56, 0.48, 0.52, 2.2],
  [3.1, 0.5, 0.56, 0.56, 2.2],
  [3.7, 0.42, 0.5, 0.62, 2.3],
  [4.3, 0.26, 0.4, 0.46, 2.2],
  [4.65, 0.12, 0.18, 0.22, 2.1],
  [4.8, 0.02, 0.02, 0.02, 2.0],
]);

const SPINE_JOINTS_TAIL: Joint[] = [
  { at: -0.9, bone: BONE.tail1, blend: 0.4 },
  { at: -1.9, bone: BONE.tail2, blend: 0.4 },
  { at: -2.8, bone: BONE.tail3, blend: 0.35 },
];
const SPINE_JOINTS_FRONT: Joint[] = [
  { at: 1.0, bone: BONE.spine1, blend: 0.5 },
  { at: 1.9, bone: BONE.spine2, blend: 0.4 },
  { at: 2.5, bone: BONE.neck1, blend: 0.2 },
  { at: 2.85, bone: BONE.neck2, blend: 0.15 },
  { at: 3.1, bone: BONE.head, blend: 0.12 },
];
/** Jaw pivot station: the beak's lower half forward of it is on the jaw. */
const JAW_X = 3.95;

// Limb joints (right side; the left mirrors z). The IK in the pose works in the side view (x, y) of these.
/** Hind leg: hip pivot, knee, ankle (body space, right side). */
export const TRICERATOPS_HIP: Vec3 = [0.0, 2.1, 0.72];
export const TRICERATOPS_KNEE: Vec3 = [0.35, 1.15, 0.8];
export const TRICERATOPS_ANKLE: Vec3 = [0.0, 0.3, 0.8];
/** Foreleg: shoulder pivot, elbow (set back), wrist. */
export const TRICERATOPS_SHOULDER: Vec3 = [2.05, 1.85, 0.72];
export const TRICERATOPS_ELBOW: Vec3 = [1.8, 1.1, 0.95];
export const TRICERATOPS_WRIST: Vec3 = [2.08, 0.32, 0.92];

const HIND: Vec3[] = [TRICERATOPS_HIP, [0.2, 1.65, 0.78], TRICERATOPS_KNEE, [0.18, 0.72, 0.8], TRICERATOPS_ANKLE, [0.1, 0.12, 0.8], [0.34, 0.05, 0.8]];
const FORE: Vec3[] = [TRICERATOPS_SHOULDER, [1.9, 1.48, 0.86], TRICERATOPS_ELBOW, [1.94, 0.72, 0.95], TRICERATOPS_WRIST, [2.14, 0.12, 0.92], [2.3, 0.05, 0.92]];

// The frill: a lens-shaped plate sweeping back and up over the neck from the skull roof, its forward face tilted up
// 50 deg (the plate at 40 deg to the ground, so the side view shows its length and the front view its width).
// Centre, plane normal (the forward face) and in-plane "up" (toward the rear crest).
const FRILL_C: Vec3 = [2.74, 2.33, 0];
const FRILL_TILT = (50 * Math.PI) / 180;
const FRILL_N: Vec3 = [Math.cos(FRILL_TILT), Math.sin(FRILL_TILT), 0];
const FRILL_UP: Vec3 = [-Math.sin(FRILL_TILT), Math.cos(FRILL_TILT), 0];
const FRILL_W = 0.8; // half-width (z)
const FRILL_TOP = 0.95; // toward the crest
const FRILL_BOT = 0.3; // down into the skull
const FRILL_THICK = 0.085; // half-thickness
/** The frill's sides curl forward (the squamosal margins around the skull), so the side view shows a fan, m at the rim. */
const FRILL_CUP = 0.42;
/**
 * Lens rings across the thickness (back face centre -> rim -> front face centre), by LOD: radius factors. The end
 * rings close each face on its centre (the loft has no caps): 0.005 (a few mm) rather than 0, because the grid's
 * finite-difference normals fall back to +y on a collapsed ring, which would light the back face's centre. LOD2's
 * coarse 3-column lens keeps 0.06: it passes the hole test there (tests/fauna/triceratops.test.ts), and 0.005 left
 * one test ray hitting a single face.
 */
const FRILL_RINGS: Record<'lod0' | 'lod1' | 'lod2', readonly number[]> = {
  lod0: [0.005, 0.6, 0.88, 1, 0.88, 0.6, 0.005],
  lod1: [0.005, 0.75, 1, 0.75, 0.005],
  lod2: [0.06, 1, 0.06],
};

const mirror = (p: Vec3, s: number): Vec3 => [p[0], p[1], p[2] * s];

/** Pivots: rest positions of the bones (parent before child). */
export function triceratopsPivots(): Float32Array {
  return packPivots(
    [
      { bone: BONE.root, at: [0, 2.1, 0], parent: -1 },
      { bone: BONE.spine1, at: [1.0, 2.05, 0], parent: BONE.root },
      { bone: BONE.spine2, at: [1.9, 1.88, 0], parent: BONE.spine1 },
      { bone: BONE.neck1, at: [2.5, 1.74, 0], parent: BONE.spine2 },
      { bone: BONE.neck2, at: [2.85, 1.67, 0], parent: BONE.neck1 },
      { bone: BONE.head, at: [3.1, 1.62, 0], parent: BONE.neck2 },
      { bone: BONE.jaw, at: [JAW_X, 1.3, 0], parent: BONE.head },
      { bone: BONE.tail1, at: [-0.9, 2.08, 0], parent: BONE.root },
      { bone: BONE.tail2, at: [-1.9, 1.82, 0], parent: BONE.tail1 },
      { bone: BONE.tail3, at: [-2.8, 1.45, 0], parent: BONE.tail2 },
      { bone: BONE.legFL, at: mirror(TRICERATOPS_SHOULDER, -1), parent: BONE.spine2 },
      { bone: BONE.legFR, at: TRICERATOPS_SHOULDER, parent: BONE.spine2 },
      { bone: BONE.legHL, at: mirror(TRICERATOPS_HIP, -1), parent: BONE.root },
      { bone: BONE.legHR, at: TRICERATOPS_HIP, parent: BONE.root },
    ],
    { [BONE.wingL]: BONE.spine2, [BONE.wingR]: BONE.spine2 },
  );
}

/** Limb sub-joints (uSub): forelimb elbow, wrist (0, 1); hind knee, ankle (3, 4). */
export function triceratopsSubJoints(): Float32Array {
  const hind = new RigPath(HIND);
  const fore = new RigPath(FORE);
  return packSubJoints({
    [SUB_FORE]: [
      { at: TRICERATOPS_ELBOW, coord: fore.distanceTo(TRICERATOPS_ELBOW) },
      { at: TRICERATOPS_WRIST, coord: fore.distanceTo(TRICERATOPS_WRIST) },
    ],
    [SUB_HIND]: [
      { at: TRICERATOPS_KNEE, coord: hind.distanceTo(TRICERATOPS_KNEE) },
      { at: TRICERATOPS_ANKLE, coord: hind.distanceTo(TRICERATOPS_ANKLE) },
    ],
  });
}

// Colours (linear albedo). Grey-olive body, pale belly; rust frill, cream rim; cream horns with dark tips.
const BACK: RGB = [0.07, 0.075, 0.052];
const SADDLE: RGB = [0.03, 0.032, 0.025];
const BELLY: RGB = [0.19, 0.18, 0.14];
const BEAK: RGB = [0.03, 0.027, 0.024];
const HOOF: RGB = [0.04, 0.036, 0.03];
const RUST: RGB = [0.2, 0.07, 0.025];
const RUST_DARK: RGB = [0.085, 0.03, 0.018];
const CREAM: RGB = [0.21, 0.2, 0.15];
const HORN_TIP: RGB = [0.04, 0.035, 0.03];

function bodyColour(p: THREE.Vector3, n: THREE.Vector3, sectionBottom: number, spineY: number): RGB {
  const below = smoothstep(0.1, -0.75, (p.y - spineY) / Math.max(0.1, sectionBottom));
  const down = smoothstep(0.2, -0.6, n.y);
  let c = mixRGB(BACK, BELLY, Math.max(below * 0.85, down));
  // Dark dorsal saddles, broken up by noise, fading down the flanks.
  const m = mottle(p, 0.4, 5);
  const band = 0.5 + 0.5 * Math.sin(p.x * 2.1 + 1.4 * m);
  const dorsal = smoothstep(-0.5, 0.4, n.y) * (1 - 0.7 * below);
  c = mixRGB(c, SADDLE, smoothstep(0.5, 0.85, band) * dorsal * 0.8);
  c = scaleRGB(c, 0.76 + 0.48 * mottle(p, 0.2, 9) * (0.6 + 0.4 * dorsal));
  const ao = 1 - 0.35 * down * smoothstep(1.3, 0.0, Math.abs(p.z) - 0.2);
  return scaleRGB(c, ao);
}

/**
 * The frill's pattern: rust core, a darker ring, a cream rim with dark scallops (epoccipitals). (dx, dy): the point
 * from the frill centre in the uncupped plate's side view.
 */
function frillColour(p: THREE.Vector3, dx: number, dy: number, front: boolean): RGB {
  const up = dx * FRILL_UP[0] + dy * FRILL_UP[1];
  const u = p.z / FRILL_W;
  const v = up / (up >= 0 ? FRILL_TOP : FRILL_BOT);
  const r = Math.hypot(u, v);
  let c = mixRGB(RUST, RUST_DARK, smoothstep(0.55, 0.7, r) * (1 - smoothstep(0.72, 0.78, r)));
  c = mixRGB(c, CREAM, smoothstep(0.76, 0.84, r));
  // Scallops on the rim.
  const scallop = 0.5 + 0.5 * Math.cos(Math.atan2(v, u) * 9);
  c = mixRGB(c, RUST_DARK, smoothstep(0.93, 0.99, r) * smoothstep(0.6, 0.9, scallop));
  // Toward the skull the frill takes the body colour.
  c = mixRGB(c, BACK, smoothstep(-0.2, -0.8, v));
  c = scaleRGB(c, 0.88 + 0.24 * mottle(p, 0.12, 13));
  return scaleRGB(c, front ? 1 : 0.75);
}

/** Build one LOD of the body plan. detail 1 = LOD0; LOD2 uses `minimal` (a body slab, the frill disc, stick legs). */
export function buildTriceratops(detail: number, minimal = false): BuiltLod {
  const mesh = new RigMesh();
  const spine = new RigPath(SPINE);
  const tmp = new THREE.Vector3();

  // Body loft.
  const rows = minimal ? 4 : res(40, detail, 8);
  const cols = minimal ? 4 : res(16, detail, 6);
  mesh.add(
    loftSpec(spine, (p) => [SECTION.at(p.x, 1), SECTION.at(p.x, 2), SECTION.at(p.x, 3), SECTION.at(p.x, 4)], rows, cols),
    (info, out) => {
      const x = info.p.x;
      if (x < 0) chainWeight(-x, BONE.root, SPINE_JOINTS_TAIL.map((j) => ({ ...j, at: -j.at })), out);
      else chainWeight(x, BONE.root, SPINE_JOINTS_FRONT, out);
      const sy = spineYAt(spine, x, tmp);
      // The beak's lower half: below the head's centre line, forward of the jaw pivot.
      if (x > JAW_X && out.bone === BONE.head && info.p.y < sy - 0.05) {
        out.bone = BONE.jaw;
        out.w = smoothstep(JAW_X, JAW_X + 0.25, x);
      }
      let c = bodyColour(info.p, info.n, SECTION.at(x, 3), sy);
      if (x > 4.3) c = mixRGB(c, BEAK, smoothstep(4.3, 4.55, x));
      const eye = Math.hypot(x - 3.62, info.p.y - (sy + 0.16), Math.abs(info.p.z) - 0.36);
      if (eye < 0.07) c = [0.02, 0.018, 0.015];
      out.color = clampAlbedo(c);
    },
  );

  // The frill: a lens swept along its normal (rings by LOD), its sides curled forward, rigid on the head.
  const rings = FRILL_RINGS[minimal ? 'lod2' : detail >= 0.8 ? 'lod0' : 'lod1'];
  const frillCols = minimal ? 3 : res(16, detail, 8);
  const frillPath = new RigPath([
    [FRILL_C[0] - FRILL_N[0] * FRILL_THICK, FRILL_C[1] - FRILL_N[1] * FRILL_THICK, 0],
    [FRILL_C[0], FRILL_C[1], 0],
    [FRILL_C[0] + FRILL_N[0] * FRILL_THICK, FRILL_C[1] + FRILL_N[1] * FRILL_THICK, 0],
  ]);
  const frill = loftSpec(
    frillPath,
    (_p, t) => {
      const x = t * (rings.length - 1);
      const i = Math.min(rings.length - 2, Math.floor(x));
      const k = rings[i] + (rings[i + 1] - rings[i]) * (x - i);
      return [FRILL_W * k, FRILL_TOP * k, FRILL_BOT * k, 2.2];
    },
    rings.length,
    frillCols,
  );
  const lens = frill.position;
  frill.position = (i, j, out) => {
    lens(i, j, out);
    const u = out.z / FRILL_W;
    const cup = FRILL_CUP * u * u;
    out.x += FRILL_N[0] * cup;
    out.y += FRILL_N[1] * cup;
  };
  mesh.add(frill, (info, out) => {
    out.bone = BONE.head;
    out.w = 1;
    const u = info.p.z / FRILL_W;
    const cup = FRILL_CUP * u * u;
    const dx = info.p.x - FRILL_C[0] - FRILL_N[0] * cup;
    const dy = info.p.y - FRILL_C[1] - FRILL_N[1] * cup;
    out.color = clampAlbedo(frillColour(info.p, dx, dy, dx * FRILL_N[0] + dy * FRILL_N[1] >= 0));
  });

  // Horns (rigid on the head): two long brow horns, a short nasal horn. Not on LOD2 (the beak stays the forward tip).
  if (!minimal) {
    const horn = (pts: Vec3[], r0: number, hornRows: number, hornCols: number): void => {
      const path = new RigPath(pts);
      mesh.add(
        tubeSpec(path, (t) => [Math.max(0.012, r0 * (1 - t) ** 0.9), Math.max(0.012, r0 * (1 - t) ** 0.9)], hornRows, hornCols, new THREE.Vector3(0, 1, 0)),
        (info, out) => {
          out.bone = BONE.head;
          out.w = 1;
          const c = mixRGB(mixRGB(BACK, CREAM, smoothstep(0.0, 0.25, info.u)), HORN_TIP, smoothstep(0.7, 0.95, info.u));
          out.color = clampAlbedo(scaleRGB(c, 0.9 + 0.2 * mottle(info.p, 0.1, 17)));
        },
      );
    };
    const hr = detail >= 0.8 ? 5 : 2;
    const hc = detail >= 0.8 ? 6 : 3;
    for (const s of [1, -1])
      horn(
        [
          [3.62, 1.92, 0.24 * s],
          [3.98, 2.2, 0.29 * s],
          [4.32, 2.4, 0.33 * s],
          [4.6, 2.46, 0.34 * s],
        ],
        0.12,
        hr,
        hc,
      );
    if (detail >= 0.8)
      horn(
        [
          [4.4, 1.42, 0],
          [4.5, 1.6, 0],
          [4.56, 1.74, 0],
        ],
        0.08,
        4,
        5,
      );
  }

  // Limbs.
  const limb = (pts: Vec3[], side: number, bone: number, hind: boolean): void => {
    const path = new RigPath(pts.map((p) => mirror(p, side)));
    const L = path.length;
    const r = hind
      ? new Profile([
          [0, 0.5, 0.6],
          [0.2, 0.42, 0.5],
          [0.38, 0.26, 0.28],
          [0.6, 0.19, 0.2],
          [0.78, 0.17, 0.17],
          [0.9, 0.21, 0.12],
          [1, 0.2, 0.06],
        ])
      : new Profile([
          [0, 0.32, 0.36],
          [0.25, 0.25, 0.27],
          [0.45, 0.19, 0.2],
          [0.7, 0.15, 0.15],
          [0.88, 0.18, 0.11],
          [1, 0.17, 0.05],
        ]);
    const lr = minimal ? 2 : res(hind ? 12 : 10, detail, 3);
    const lc = minimal ? 3 : res(hind ? 8 : 7, detail, 3);
    const k = minimal ? 0.85 : 1;
    mesh.add(tubeSpec(path, (t) => [r.at(t, 1) * k, r.at(t, 2) * k], lr, lc), (info, out) => {
      const s = info.u * L;
      out.bone = bone;
      out.w = 0.35 + 0.65 * smoothstep(0, 0.5, s);
      out.limb = s;
      const top = smoothstep(0.9, 0.2, s);
      let c = mixRGB(BACK, BELLY, 0.2 + 0.25 * smoothstep(0.2, -0.6, info.n.y));
      c = scaleRGB(c, 0.85 + 0.3 * mottle(info.p, 0.2, 11));
      if (info.u > 0.86) c = mixRGB(c, HOOF, smoothstep(0.86, 0.95, info.u));
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
export function createTriceratops(): CreatureMeshSet {
  const pivots = triceratopsPivots();
  const lod0 = buildTriceratops(1).geometry;
  const lod1 = buildTriceratops(0.3).geometry;
  const lod2 = buildTriceratops(0, true).geometry;
  const caster = buildTriceratops(0.5).geometry;
  return { lod0, lod1, lod2, caster, pivots, lengthM: TRICERATOPS_LENGTH_M };
}

/** The animated material's view of the ceratopsian rig (rig 3). */
export const TRICERATOPS_RENDER: SpeciesRender = Object.freeze({ rig: 'ceratopsian', subJoints: triceratopsSubJoints, fold: identityFold, subBlend: 0.12 });
