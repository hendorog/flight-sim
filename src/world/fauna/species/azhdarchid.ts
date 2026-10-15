// Azhdarchid pterosaurs: Quetzalcoatlus northropi (10.5 m span, ~5 m standing head height; Javelina Fm.,
// southern Laramidia) and a small azhdarchid on the same rig (the roster draws it at scale 0.43, ~4.5 m span)
// with a taller crest and darker, warmer colours.
//
// Body plan (rig.ts): a compact torso loft that runs on into the long stiff neck, a separate 2.7 m skull and
// beak with a sagittal crest plate, two hind legs, and per side a wing: a tapered bone tube (humerus, forearm,
// the very long wing metacarpal, the comparatively short wing finger) with a two-faced membrane from the
// wing bones back to the flank. The REST POSE is the wings spread (so the span is the bounding width) with the
// legs standing: the material folds the wings into the walking forelimbs (azhdarchids were terrestrial
// stalkers, walking on the folded forelimbs) or trails the legs and extends the neck in flight.
//
// Origin: the centre of mass, AZHDARCHID_GROUND_OFFSET_M above the ground in the standing pose (scale 1).
//
// Colour: pale pycnofibre-covered body and neck, pale beak, rust crest, dark brown membrane (speculative but
// plausible). Linear albedo 0.03-0.15.

import * as THREE from 'three';
import { Pchip } from '../../../render/aircraft/geometry';
import { BONE, type CreatureMeshSet, type SpeciesRender } from '../types';
import {
  chainWeight,
  clampAlbedo,
  loftSpec,
  membraneSpec,
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
  SUB_HIND,
  SUB_WING,
  tubeSpec,
  type BuiltLod,
  type Joint,
  type RGB,
  type Vec3,
} from '../rig';

export const AZHDARCHID_SPAN_M = 10.5;
/** Height of the origin (centre of mass) above the ground when standing, at scale 1, m. */
export const AZHDARCHID_GROUND_OFFSET_M = 2.4;

const G = AZHDARCHID_GROUND_OFFSET_M;
/** Authoring is in ground coordinates (y = 0 on the ground); geometry is shifted to the centre of mass. */
const g = (p: Vec3): Vec3 => [p[0], p[1] - G, p[2]];
const mirror = (p: Vec3, s: number): Vec3 => [p[0], p[1], p[2] * s];

// Torso into neck (ground coordinates).
const TORSO: Vec3[] = [
  [-0.95, 1.95, 0],
  [-0.5, 2.15, 0],
  [0.0, 2.45, 0],
  [0.35, 2.72, 0],
  [0.62, 3.05, 0],
  [1.0, 3.6, 0],
  [1.45, 4.2, 0],
  [1.85, 4.74, 0],
];
const TORSO_SECTION = new Profile([
  [-0.97, 0.02, 0.02, 0.02, 2],
  [-0.6, 0.15, 0.15, 0.16, 2],
  [-0.2, 0.28, 0.25, 0.34, 2.2],
  [0.2, 0.3, 0.27, 0.34, 2.2],
  [0.45, 0.22, 0.2, 0.24, 2],
  [0.68, 0.15, 0.14, 0.15, 2],
  [1.0, 0.11, 0.105, 0.11, 2],
  [1.5, 0.09, 0.09, 0.09, 2],
  [1.8, 0.1, 0.1, 0.1, 2],
  [1.9, 0.11, 0.11, 0.11, 2],
]);

// Skull and beak.
const HEAD: Vec3[] = [
  [1.62, 4.9, 0],
  [1.95, 4.82, 0],
  [2.6, 4.42, 0],
  [3.3, 3.96, 0],
  [3.98, 3.52, 0],
];
const HEAD_SECTION = new Profile([
  [0, 0.05, 0.05, 0.05, 2],
  [0.06, 0.1, 0.16, 0.14, 2.2],
  [0.2, 0.1, 0.15, 0.16, 2.3],
  [0.45, 0.07, 0.095, 0.11, 2.4],
  [0.75, 0.042, 0.052, 0.058, 2.3],
  [0.97, 0.012, 0.014, 0.016, 2],
  [1, 0.004, 0.004, 0.004, 2],
]);

// Wing (right; rest = spread). Shoulder, elbow, wrist, knuckle (wing-finger joint), tip.
const SHOULDER: Vec3 = [0.38, 2.75, 0.18];
const ELBOW: Vec3 = [0.42, 2.78, 0.8];
const WRIST: Vec3 = [0.52, 2.8, 2.18];
const KNUCKLE: Vec3 = [0.45, 2.82, 3.58];
const TIP: Vec3 = [-0.45, 2.88, AZHDARCHID_SPAN_M / 2];
const WING: Vec3[] = [SHOULDER, ELBOW, WRIST, KNUCKLE, TIP];
// Trailing edge x (and y) by span z.
const TRAIL = new Profile([
  [0.15, -0.85, 2.62],
  [1.0, -1.08, 2.66],
  [2.2, -1.02, 2.72],
  [3.6, -0.78, 2.78],
  [4.6, -0.58, 2.84],
  [5.25, -0.45, 2.88],
]);

// Hind leg (right).
const HIND: Vec3[] = [
  [-0.45, 2.12, 0.2],
  [-0.3, 1.62, 0.25],
  [-0.2, 1.15, 0.26],
  [-0.36, 0.68, 0.24],
  [-0.5, 0.22, 0.23],
  [-0.38, 0.06, 0.23],
  [-0.2, 0.04, 0.23],
];
const HIND_KNEE: Vec3 = [-0.2, 1.15, 0.26];
const HIND_ANKLE: Vec3 = [-0.5, 0.22, 0.23];

// How far the crest plate reaches down from its top edge to the skull roof, as a fraction of its height.
const CREST_DEPTH = new Pchip([0, 0.33, 0.66, 1], [0, 0.5, 1.0, 0.8]);

const PIVOT = {
  root: [0, 2.4, 0] as Vec3,
  spine1: [0.05, 2.5, 0] as Vec3,
  spine2: [0.32, 2.72, 0] as Vec3,
  neck1: [0.62, 3.05, 0] as Vec3,
  neck2: [1.22, 3.9, 0] as Vec3,
  head: [1.8, 4.78, 0] as Vec3,
};

/** Pivots (body space, origin at the centre of mass). */
export function azhdarchidPivots(): Float32Array {
  return packPivots(
    [
      { bone: BONE.root, at: g(PIVOT.root), parent: -1 },
      { bone: BONE.spine1, at: g(PIVOT.spine1), parent: BONE.root },
      { bone: BONE.spine2, at: g(PIVOT.spine2), parent: BONE.spine1 },
      { bone: BONE.neck1, at: g(PIVOT.neck1), parent: BONE.spine2 },
      { bone: BONE.neck2, at: g(PIVOT.neck2), parent: BONE.neck1 },
      { bone: BONE.head, at: g(PIVOT.head), parent: BONE.neck2 },
      { bone: BONE.legHL, at: g(mirror(HIND[0], -1)), parent: BONE.root },
      { bone: BONE.legHR, at: g(HIND[0]), parent: BONE.root },
      { bone: BONE.wingL, at: g(mirror(SHOULDER, -1)), parent: BONE.spine2 },
      { bone: BONE.wingR, at: g(SHOULDER), parent: BONE.spine2 },
    ],
    {
      [BONE.jaw]: BONE.head,
      [BONE.tail1]: BONE.root,
      [BONE.tail2]: BONE.root,
      [BONE.tail3]: BONE.root,
      [BONE.legFL]: BONE.spine2,
      [BONE.legFR]: BONE.spine2,
    },
  );
}

/** Sub-joints: hind knee/ankle (limb coordinate along the leg), wing elbow/wrist/knuckle (coordinate = rest |z|). */
export function azhdarchidSubJoints(): Float32Array {
  const hind = new RigPath(HIND);
  return packSubJoints({
    [SUB_HIND]: [
      { at: g(HIND_KNEE), coord: hind.distanceTo(HIND_KNEE) },
      { at: g(HIND_ANKLE), coord: hind.distanceTo(HIND_ANKLE) },
    ],
    [SUB_WING]: [
      { at: g(ELBOW), coord: ELBOW[2] },
      { at: g(WRIST), coord: WRIST[2] },
      { at: g(KNUCKLE), coord: KNUCKLE[2] },
    ],
  });
}

const sub = (a: Vec3, b: Vec3): THREE.Vector3 => new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);

function foldDirections(): { len: number[]; dirs: THREE.Vector3[] } {
  const segs = [sub(SHOULDER, ELBOW), sub(ELBOW, WRIST), sub(WRIST, KNUCKLE), sub(KNUCKLE, TIP)];
  const len = segs.map((v) => v.length());
  const d0 = new THREE.Vector3(-0.4, -0.55, 0.72).normalize();
  const d1 = new THREE.Vector3(0.2, -0.97, -0.12).normalize();
  const handY = 0.06;
  const drop = SHOULDER[1] + len[0] * d0.y + len[1] * d1.y - handY;
  const dy = -Math.min(0.98, drop / len[2]);
  const hor = Math.sqrt(1 - dy * dy);
  const d2 = new THREE.Vector3(0.998 * hor, dy, -0.06 * hor).normalize();
  // The wing finger folds back up along the metacarpal and forearm, a little outboard of them.
  const d3 = d2.clone().multiplyScalar(-0.62).addScaledVector(d1, -0.38).add(new THREE.Vector3(-0.08, 0, 0.1)).normalize();
  return { len, dirs: [d0, d1, d2, d3] };
}

/**
 * The folded (walking) wing of the right side: local rotations (x, y, z, w) of the shoulder, elbow, wrist and
 * knuckle, each about its rest pivot, child first (uFold[4]). The humerus points back, down and out, the
 * forearm nearly straight down, the long metacarpal down and forward to the hand on the ground, and the wing
 * finger folds back up along the arm. The metacarpal's slope is solved so the hand rests on the ground.
 */
export function azhdarchidFold(): { quats: Float32Array; hand: THREE.Vector3 } {
  const segs = [sub(SHOULDER, ELBOW), sub(ELBOW, WRIST), sub(WRIST, KNUCKLE), sub(KNUCKLE, TIP)];
  const { len, dirs } = foldDirections();
  const [d0, d1, d2] = dirs;
  const globals = segs.map((s, k) => new THREE.Quaternion().setFromUnitVectors(s.clone().normalize(), dirs[k]));
  const quats = new Float32Array(16);
  let prev = new THREE.Quaternion();
  globals.forEach((q, k) => {
    const local = prev.clone().invert().multiply(q);
    quats.set([local.x, local.y, local.z, local.w], k * 4);
    prev = q;
  });
  const hand = new THREE.Vector3(...SHOULDER)
    .addScaledVector(d0, len[0])
    .addScaledVector(d1, len[1])
    .addScaledVector(d2, len[2]);
  hand.y -= G;
  return { quats, hand };
}

/** How far the quad-launch crouch lowers the body, m (scale 1; the material's root offset at full crouch). */
export const AZHDARCHID_CROUCH_DROP_M = 0.42;

/**
 * The folded forelimb's flex at full crouch: body-frame pitch rotations (rad, about +z, nose-up positive) of
 * the shoulder, elbow and wrist that keep the wrist where it was on the ground while the body sinks by
 * AZHDARCHID_CROUCH_DROP_M, with the metacarpal (and so the hand) unturned: a planar two-link solve of the
 * humerus and forearm in the side view (pitch rotations leave z alone, so the side-view projections decouple).
 */
export function azhdarchidCrouchFlex(drop = AZHDARCHID_CROUCH_DROP_M): { shoulder: number; elbow: number; wrist: number } {
  const { len, dirs } = foldDirections();
  const [d0, d1] = dirs;
  const sx = SHOULDER[0];
  const sy = SHOULDER[1];
  const ex = sx + len[0] * d0.x;
  const ey = sy + len[0] * d0.y;
  const wx = ex + len[1] * d1.x;
  const wy = ey + len[1] * d1.y;
  const r0 = Math.hypot(ex - sx, ey - sy);
  const r1 = Math.hypot(wx - ex, wy - ey);
  // The wrist's target relative to the lowered shoulder.
  const tx = wx - sx;
  const ty = wy + drop - sy;
  const dist = Math.hypot(tx, ty);
  // The two elbow solutions on the circles about the shoulder and the wrist; keep the one nearer the rest elbow.
  const a = (r0 * r0 - r1 * r1 + dist * dist) / (2 * dist);
  const h = Math.sqrt(Math.max(0, r0 * r0 - a * a));
  const mx = (a * tx) / dist;
  const my = (a * ty) / dist;
  const cands = [
    [mx - (h * ty) / dist, my + (h * tx) / dist],
    [mx + (h * ty) / dist, my - (h * tx) / dist],
  ];
  const near = (c: number[]): number => Math.hypot(c[0] - (ex - sx), c[1] - (ey - sy));
  const [nx, ny] = near(cands[0]) <= near(cands[1]) ? cands[0] : cands[1];
  // Signed angle from (x0, y0) to (x1, y1), in (-pi, pi].
  const turn = (x0: number, y0: number, x1: number, y1: number): number => Math.atan2(x0 * y1 - y0 * x1, x0 * x1 + y0 * y1);
  const shoulder = turn(ex - sx, ey - sy, nx, ny);
  const forearm = turn(wx - ex, wy - ey, tx - nx, ty - ny);
  return { shoulder, elbow: forearm - shoulder, wrist: -forearm };
}

export interface AzhdarchidLook {
  body: RGB;
  back: RGB;
  neck: RGB;
  beak: RGB;
  crest: RGB;
  membrane: RGB;
  membraneEdge: RGB;
  /** Crest plate: start and end along the skull (0 back .. 1 beak tip), peak height m, how far it sweeps back. */
  crestFrom: number;
  crestTo: number;
  crestHeight: number;
  crestBack: number;
}

export const QUETZALCOATLUS_LOOK: AzhdarchidLook = {
  body: [0.135, 0.13, 0.12],
  back: [0.1, 0.095, 0.085],
  neck: [0.14, 0.135, 0.125],
  beak: [0.11, 0.1, 0.082],
  crest: [0.12, 0.05, 0.032],
  membrane: [0.055, 0.042, 0.034],
  membraneEdge: [0.034, 0.027, 0.023],
  crestFrom: 0.05,
  crestTo: 0.45,
  crestHeight: 0.2,
  crestBack: 0.15,
};

export const SMALL_AZHDARCHID_LOOK: AzhdarchidLook = {
  body: [0.085, 0.07, 0.052],
  back: [0.06, 0.048, 0.036],
  neck: [0.11, 0.095, 0.075],
  beak: [0.075, 0.07, 0.06],
  crest: [0.16, 0.045, 0.02],
  membrane: [0.045, 0.034, 0.028],
  membraneEdge: [0.11, 0.1, 0.085],
  crestFrom: 0.0,
  crestTo: 0.32,
  crestHeight: 0.42,
  crestBack: 0.45,
};

/** Build one LOD. detail 1 = LOD0; `minimal` = LOD2 (body, single-quad wings, no legs). */
export function buildAzhdarchid(detail: number, look: AzhdarchidLook, minimal = false): BuiltLod {
  const mesh = new RigMesh();

  // Torso and neck: bone chain by arc length along the path.
  const torso = new RigPath(TORSO.map(g));
  const at = (p: Vec3): number => torso.distanceTo(g(p));
  const torsoJoints: Joint[] = [
    { at: at(PIVOT.spine1), bone: BONE.spine1, blend: 0.15 },
    { at: at(PIVOT.spine2), bone: BONE.spine2, blend: 0.15 },
    { at: at(PIVOT.neck1), bone: BONE.neck1, blend: 0.15 },
    { at: at(PIVOT.neck2), bone: BONE.neck2, blend: 0.3 },
    { at: at(PIVOT.head), bone: BONE.head, blend: 0.08 },
  ];
  const neckStart = at(PIVOT.neck1);
  mesh.add(
    loftSpec(
      torso,
      (p) => [TORSO_SECTION.at(p.x, 1), TORSO_SECTION.at(p.x, 2), TORSO_SECTION.at(p.x, 3), TORSO_SECTION.at(p.x, 4)],
      minimal ? 5 : res(28, detail, 9),
      minimal ? 3 : res(12, detail, 5),
    ),
    (info, out) => {
      const s = info.u * torso.length;
      chainWeight(s, BONE.root, torsoJoints, out);
      const neck = smoothstep(neckStart - 0.2, neckStart + 0.4, s);
      let c = mixRGB(look.back, look.body, smoothstep(0.5, -0.4, info.n.y));
      c = mixRGB(c, look.neck, neck);
      c = scaleRGB(c, 0.9 + 0.2 * mottle(info.p, 0.12, 21));
      c = scaleRGB(c, 1 - 0.25 * smoothstep(0, -0.8, info.n.y) * (1 - neck));
      out.color = clampAlbedo(c);
    },
  );

  // Skull and beak, with an eye.
  const head = new RigPath(HEAD.map(g));
  mesh.add(
    loftSpec(
      head,
      (_p, t) => [HEAD_SECTION.at(t, 1), HEAD_SECTION.at(t, 2), HEAD_SECTION.at(t, 3), HEAD_SECTION.at(t, 4)],
      minimal ? 2 : res(16, detail, 5),
      minimal ? 3 : res(10, detail, 4),
    ),
    (info, out) => {
      out.bone = BONE.head;
      out.w = 1;
      let c = mixRGB(look.neck, look.beak, smoothstep(0.12, 0.3, info.u));
      c = scaleRGB(c, 1 - 0.3 * smoothstep(0.8, 1, info.u));
      // A dark gape line along the beak's side.
      if (info.u > 0.15 && Math.abs(info.n.y) < 0.12) c = scaleRGB(c, 0.6);
      const ep = head.at(0.1, new THREE.Vector3());
      const eye = Math.hypot(info.p.x - ep.x, info.p.y - (ep.y + 0.04), Math.abs(info.p.z) - 0.09);
      if (eye < 0.045) c = [0.02, 0.018, 0.016];
      out.color = clampAlbedo(c);
    },
  );

  // Crest: a thin sagittal plate on the skull roof (skipped at LOD2).
  if (!minimal) {
    const p0 = head.at(look.crestFrom, new THREE.Vector3());
    const p1 = head.at(look.crestTo, new THREE.Vector3());
    const top0 = HEAD_SECTION.at(look.crestFrom, 2) * 0.8;
    const top1 = HEAD_SECTION.at(look.crestTo, 2) * 0.8;
    // Path from the front of the crest back over the skull, rising and sweeping back.
    const crest = new RigPath([
      [p1.x, p1.y + top1, 0],
      [0.5 * (p0.x + p1.x), 0.5 * (p0.y + p1.y) + 0.5 * (top0 + top1) + look.crestHeight * 0.45, 0],
      [p0.x - look.crestBack * 0.6, p0.y + top0 + look.crestHeight * 0.95, 0],
      [p0.x - look.crestBack, p0.y + top0 + look.crestHeight * 0.75, 0],
    ]);
    mesh.add(
      loftSpec(crest, (_p, t) => [0.014 * (1 - 0.6 * t), 0.02 + 0.03 * Math.sin(Math.PI * t), 0.07 + look.crestHeight * CREST_DEPTH.eval(t), 2.5], res(8, detail, 4), res(6, detail, 4)),
      (info, out) => {
        out.bone = BONE.head;
        out.w = 1;
        out.color = clampAlbedo(scaleRGB(look.crest, 0.85 + 0.3 * mottle(info.p, 0.05, 5)));
      },
    );
  }

  // Hind legs.
  if (!minimal)
    for (const side of [1, -1]) {
      const path = new RigPath(HIND.map((p) => g(mirror(p, side))));
      const L = path.length;
      const r = new Profile([
        [0, 0.12, 0.13],
        [0.3, 0.07, 0.08],
        [0.5, 0.045, 0.05],
        [0.85, 0.032, 0.035],
        [0.93, 0.05, 0.03],
        [1, 0.045, 0.02],
      ]);
      mesh.add(tubeSpec(path, (t) => [r.at(t, 1), r.at(t, 2)], res(9, detail, 3), res(5, detail, 3)), (info, out) => {
        const s = info.u * L;
        out.bone = side > 0 ? BONE.legHR : BONE.legHL;
        out.w = 0.4 + 0.6 * smoothstep(0, 0.35, s);
        out.limb = s;
        let c = mixRGB(look.body, look.beak, smoothstep(0.5, 0.9, info.u));
        c = scaleRGB(c, 1 - 0.3 * smoothstep(0.4, 0, s));
        out.color = clampAlbedo(c);
      });
    }

  // Wings: bone tube and the two-faced membrane, per side.
  const wing = new RigPath(WING.map(g));
  const wr = new Profile([
    [0.18, 0.085, 0.09],
    [0.8, 0.07, 0.075],
    [2.18, 0.05, 0.055],
    [3.58, 0.04, 0.045],
    [4.6, 0.024, 0.026],
    [5.25, 0.008, 0.008],
  ]);
  const le = new THREE.Vector3();
  for (const side of [1, -1]) {
    const bone = side > 0 ? BONE.wingR : BONE.wingL;
    const wingAttr = (info: { p: THREE.Vector3; n: THREE.Vector3 }, out: { bone: number; w: number; limb: number }): void => {
      const span = Math.abs(info.p.z);
      out.bone = bone;
      out.w = smoothstep(0.12, 0.42, span);
      out.limb = span;
    };
    if (!minimal) {
      const path = new RigPath(WING.map((p) => g(mirror(p, side))));
      mesh.add(
        tubeSpec(path, (t) => {
          path.at(t, le);
          const z = Math.abs(le.z);
          return [wr.at(z, 1), wr.at(z, 2)];
        }, res(18, detail, 6), res(5, detail, 3), new THREE.Vector3(0, 1, 0)),
        (info, out) => {
          wingAttr(info, out);
          let c = mixRGB(look.body, look.membraneEdge, smoothstep(1.0, 3.0, out.limb) * 0.6);
          c = scaleRGB(c, 0.9 + 0.2 * mottle(info.p, 0.1, 31));
          out.color = clampAlbedo(c);
        },
      );
    }
    const leAt = (s: number, out: THREE.Vector3): void => {
      wing.at(0.03 + 0.97 * s, out);
      out.z *= side;
    };
    const teAt = (s: number, out: THREE.Vector3): void => {
      leAt(s, out);
      const z = Math.abs(out.z);
      out.set(TRAIL.at(z, 1), TRAIL.at(z, 2) - G, out.z);
    };
    const rows = minimal ? 3 : res(14, detail, 5);
    const cols = minimal ? 2 : res(4, detail, 2);
    for (const lift of [0.006, -0.006]) {
      mesh.add(membraneSpec(leAt, teAt, rows, cols, lift, side < 0), (info, out) => {
        wingAttr(info, out);
        leAt(Math.min(1, Math.max(0, info.u)), le);
        out.chord = Math.max(0, le.x - info.p.x);
        // Darker toward the trailing edge and the tip; faint actinofibril streaks along the span.
        const tChord = info.v;
        let c = mixRGB(look.membrane, look.membraneEdge, smoothstep(0.55, 1.0, tChord) * 0.7 + smoothstep(0.75, 1.0, info.u) * 0.5);
        c = scaleRGB(c, 0.92 + 0.04 * Math.sin(info.p.z * 3.1 + info.p.x * 1.3) + 0.1 * mottle(info.p, 0.3, 41));
        out.color = clampAlbedo(c);
      });
    }
  }

  return { geometry: mesh.build(), triangles: mesh.triangles };
}

function buildSet(look: AzhdarchidLook): CreatureMeshSet {
  const pivots = azhdarchidPivots();
  const lod0 = buildAzhdarchid(1, look).geometry;
  const lod1 = buildAzhdarchid(0.34, look).geometry;
  const lod2 = buildAzhdarchid(0, look, true).geometry;
  return { lod0, lod1, lod2, caster: lod1, pivots, lengthM: AZHDARCHID_SPAN_M };
}

/**
 * A complete azhdarchid mesh set from a Look (inc 2, for Look-only variants such as the Pteranodon, WP4): LOD0
 * (detail 1), LOD1 (0.34), LOD2 (minimal) and the LOD1 as the caster, on the shared azhdarchid pivots, with
 * lengthM = AZHDARCHID_SPAN_M (the roster's SPECIES_REFERENCE_M scales it to the species' span). For other LOD
 * details call buildAzhdarchid(detail, look, minimal) directly. Uses the rig's sub-joints and fold
 * (AZHDARCHID_RENDER) unchanged.
 */
export function createAzhdarchidSet(look: AzhdarchidLook): CreatureMeshSet {
  return buildSet(look);
}

/** The animated material's view of the azhdarchid rig (sub-joints, wing fold): every azhdarchid-rig species uses it. */
export const AZHDARCHID_RENDER: SpeciesRender = Object.freeze({ rig: 'azhdarchid', subJoints: azhdarchidSubJoints, fold: () => azhdarchidFold().quats, subBlend: 0.09 });

/** Quetzalcoatlus northropi at scale 1 (10.5 m span). */
export function createQuetzalcoatlus(): CreatureMeshSet {
  return buildSet(QUETZALCOATLUS_LOOK);
}

/** The small azhdarchid: the same rig and size at scale 1; the roster draws it at scale 0.43 (~4.5 m span). */
export function createSmallAzhdarchid(): CreatureMeshSet {
  return buildSet(SMALL_AZHDARCHID_LOOK);
}
