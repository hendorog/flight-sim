// Tyrannosaurus rex (Hell Creek / Lance, ~68-66 Ma): 12.3 m nose to tail, the hip joint ~3 m up (the back over the
// hips ~3.9 m). Deep Time increment 2, WP1. The export names are fixed: createTyrannosaurus() (species/index.ts
// FAUNA_SPECIES.tyrannosaurus.build) and TYRANNOSAURUS_RENDER (.render).
//
// Body plan (rig.ts, rig 2 'theropod'; types.ts BONE_ALIAS): one loft from the tail tip to the snout (a 5 m
// tapering tail, a horizontal back, a deep barrel, a short S-curved neck and a deep, boxy 1.4 m skull with a rough
// brow); at LOD0 a separate lower-jaw loft on the jaw bone (the roar opens it 35 deg without tearing the skull);
// two digitigrade hind legs with massive thighs (hip -> knee -> ankle -> ball of the foot -> toe tip, with three
// sub-joints: knee, ankle, ball) and two tiny two-finger arms on legFL / legFR (elbow, wrist).
// Origin on the ground under the hips; the toes' soles are on y = 0 in the rest pose (the walk's pose places them
// with inverse kinematics: poses/theropod.ts, which reads the joint constants exported here).
//
// Colour: dark olive-brown back with darker transverse bands, warmer flanks, a pale cream belly and throat, a dark
// rough brow ridge, a dark-red mouth lining and pale teeth (LOD0), AO under the body. Linear albedo 0.03-0.15.

import * as THREE from 'three';
import { sweepGeometry, type GridSpec } from '../../../render/aircraft/geometry';
import {
  chainWeight,
  clampAlbedo,
  identityFold,
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
import { BONE, type CreatureMeshSet, type SpeciesRender } from '../types';

export const TYRANNOSAURUS_LENGTH_M = 12.3;

// Spine (section centre line), x forward, y up. Tail tip (-7.3) to snout tip (5.0) = 12.3 m.
const SPINE: Vec3[] = [
  [-7.3, 2.5, 0],
  [-6.0, 2.82, 0],
  [-4.5, 3.14, 0],
  [-3.0, 3.38, 0],
  [-1.5, 3.5, 0],
  [0.0, 3.46, 0],
  [1.2, 3.32, 0],
  [2.2, 3.12, 0],
  [2.8, 3.04, 0],
  [3.25, 3.2, 0],
  [3.65, 3.42, 0],
  [4.1, 3.45, 0],
  [4.6, 3.36, 0],
  [5.0, 3.26, 0],
];

// Section by station x: halfWidth, halfTop, halfBottom (the full head: skull and lower jaw), superellipse exponent,
// halfBottom of the skull alone (LOD0, where the lower jaw is its own loft).
const SECTION = new Profile([
  [-7.3, 0.02, 0.02, 0.02, 2.0, 0.02],
  [-6.6, 0.07, 0.11, 0.11, 2.1, 0.11],
  [-5.5, 0.15, 0.23, 0.24, 2.2, 0.24],
  [-4.0, 0.28, 0.37, 0.42, 2.3, 0.42],
  [-2.5, 0.44, 0.46, 0.62, 2.3, 0.62],
  [-1.2, 0.62, 0.46, 0.86, 2.4, 0.86],
  [0.0, 0.74, 0.43, 1.1, 2.4, 1.1],
  [1.2, 0.82, 0.41, 1.4, 2.3, 1.4],
  [2.1, 0.7, 0.37, 1.22, 2.2, 1.22],
  [2.7, 0.52, 0.36, 0.82, 2.1, 0.82],
  [3.2, 0.45, 0.38, 0.64, 2.0, 0.64],
  [3.6, 0.5, 0.46, 0.74, 2.2, 0.56],
  [3.95, 0.54, 0.52, 0.78, 2.5, 0.34],
  [4.45, 0.4, 0.4, 0.6, 2.5, 0.27],
  [4.85, 0.26, 0.27, 0.38, 2.5, 0.18],
  [5.0, 0.1, 0.1, 0.12, 2.2, 0.08],
]);

// Joints along the spine (station x): child bone, blend half-width.
const SPINE_JOINTS_TAIL: Joint[] = [
  { at: -1.2, bone: BONE.tail1, blend: 0.5 },
  { at: -3.2, bone: BONE.tail2, blend: 0.55 },
  { at: -5.0, bone: BONE.tail3, blend: 0.5 },
];
const SPINE_JOINTS_FRONT: Joint[] = [
  { at: 1.0, bone: BONE.spine1, blend: 0.5 },
  { at: 2.1, bone: BONE.spine2, blend: 0.45 },
  { at: 2.75, bone: BONE.neck1, blend: 0.25 },
  { at: 3.2, bone: BONE.neck2, blend: 0.22 },
  { at: 3.62, bone: BONE.head, blend: 0.16 },
];

/** The jaw joint (body xy): the lower jaw (BONE.jaw) opens about it. */
const JAW_PIVOT: Vec3 = [3.72, 3.18, 0];
/** Maximum roar gape (poses/theropod.ts opens the jaw this far at flap = 1), rad. */
export const TYRANNOSAURUS_ROAR_GAPE = 35 * (Math.PI / 180);

// Hind limb (right side; the left mirrors z): hip joint -> knee -> ankle -> ball of the foot -> toe tip. The
// pose solves the stance with these joints (poses/theropod.ts), so the path passes through them exactly.
const HIP: Vec3 = [0.05, 3.0, 0.64];
const KNEE: Vec3 = [0.45, 1.75, 0.72];
const ANKLE: Vec3 = [-0.15, 0.62, 0.66];
const BALL: Vec3 = [0.15, 0.1, 0.66];
const TOE: Vec3 = [0.78, 0.085, 0.66];
const HIND: Vec3[] = [HIP, [0.28, 2.38, 0.72], KNEE, [0.16, 1.18, 0.7], ANKLE, [0.0, 0.36, 0.66], BALL, [0.46, 0.09, 0.66], TOE];

/**
 * The hind-limb joints the theropod pose solves (body xy, right side; uSub[3..5] = knee, ankle, ball): the hip
 * (legHR pivot), the knee, the ankle, the ball of the foot (the IK target, ~0.1 m above the sole) and the toe tip.
 */
export const TYRANNOSAURUS_HIND = Object.freeze({
  hip: Object.freeze([HIP[0], HIP[1]] as const),
  knee: Object.freeze([KNEE[0], KNEE[1]] as const),
  ankle: Object.freeze([ANKLE[0], ANKLE[1]] as const),
  ball: Object.freeze([BALL[0], BALL[1]] as const),
  toe: Object.freeze([TOE[0], TOE[1]] as const),
});

// Arms (right side): shoulder -> elbow -> wrist -> the two fingers' tips.
const SHOULDER: Vec3 = [2.2, 2.6, 0.55];
const ELBOW: Vec3 = [2.38, 2.32, 0.66];
const WRIST: Vec3 = [2.56, 2.26, 0.64];
const ARM: Vec3[] = [SHOULDER, ELBOW, WRIST, [2.72, 2.14, 0.6]];

const mirror = (p: Vec3, s: number): Vec3 => [p[0], p[1], p[2] * s];

/** Pivots: rest positions of the bones (ordered so a parent precedes its children). */
export function tyrannosaurusPivots(): Float32Array {
  return packPivots(
    [
      { bone: BONE.root, at: [0, 3.2, 0], parent: -1 },
      { bone: BONE.spine1, at: [1.0, 3.34, 0], parent: BONE.root },
      { bone: BONE.spine2, at: [2.1, 3.14, 0], parent: BONE.spine1 },
      { bone: BONE.neck1, at: [2.75, 3.05, 0], parent: BONE.spine2 },
      { bone: BONE.neck2, at: [3.2, 3.18, 0], parent: BONE.neck1 },
      { bone: BONE.head, at: [3.62, 3.4, 0], parent: BONE.neck2 },
      { bone: BONE.jaw, at: JAW_PIVOT, parent: BONE.head },
      { bone: BONE.tail1, at: [-1.2, 3.5, 0], parent: BONE.root },
      { bone: BONE.tail2, at: [-3.2, 3.36, 0], parent: BONE.tail1 },
      { bone: BONE.tail3, at: [-5.0, 3.05, 0], parent: BONE.tail2 },
      { bone: BONE.legFL, at: mirror(SHOULDER, -1), parent: BONE.spine2 },
      { bone: BONE.legFR, at: SHOULDER, parent: BONE.spine2 },
      { bone: BONE.legHL, at: mirror(HIP, -1), parent: BONE.root },
      { bone: BONE.legHR, at: HIP, parent: BONE.root },
    ],
    { [BONE.wingL]: BONE.spine2, [BONE.wingR]: BONE.spine2 },
  );
}

/** Limb sub-joints for the material (uSub): arms (elbow, wrist), hind limbs (knee, ankle, ball). */
export function tyrannosaurusSubJoints(): Float32Array {
  const hind = new RigPath(HIND);
  const arm = new RigPath(ARM);
  return packSubJoints({
    [SUB_FORE]: [
      { at: ELBOW, coord: arm.distanceTo(ELBOW) },
      { at: WRIST, coord: arm.distanceTo(WRIST) },
    ],
    [SUB_HIND]: [
      { at: KNEE, coord: hind.distanceTo(KNEE) },
      { at: ANKLE, coord: hind.distanceTo(ANKLE) },
      { at: BALL, coord: hind.distanceTo(BALL) },
    ],
  });
}

// Colours (linear albedo). Darker than the Edmontosaurus, with warmer flanks and a strongly pale belly, so the
// predator separates from the herd and from the olive marsh.
const BACK: RGB = [0.052, 0.043, 0.027];
const BAND: RGB = [0.027, 0.024, 0.019];
const FLANK: RGB = [0.098, 0.068, 0.04];
const BELLY: RGB = [0.155, 0.138, 0.1];
const BROW: RGB = [0.03, 0.026, 0.021];
const MOUTH: RGB = [0.1, 0.03, 0.027];
const TEETH: RGB = [0.155, 0.148, 0.12];
const CLAW: RGB = [0.03, 0.028, 0.025];
const EYE: RGB = [0.06, 0.04, 0.015];

function bodyColour(p: THREE.Vector3, n: THREE.Vector3, sectionBottom: number, spineY: number): RGB {
  // Countershading: pale where the surface faces down and below the flank midline; warm flanks between.
  const rel = (p.y - spineY) / Math.max(0.1, sectionBottom);
  const below = smoothstep(0.0, -0.75, rel);
  const down = smoothstep(0.15, -0.6, n.y);
  let c = mixRGB(BACK, FLANK, smoothstep(0.55, -0.1, n.y) * 0.8);
  c = mixRGB(c, BELLY, Math.max(below * 0.85, down));
  // Dark transverse bands over the back and tail, broken up by noise.
  const m = mottle(p, 0.4, 5);
  const band = 0.5 + 0.5 * Math.sin(p.x * 2.1 + 1.7 * m);
  const dorsal = smoothstep(-0.45, 0.4, n.y) * (1 - 0.8 * below);
  c = mixRGB(c, BAND, smoothstep(0.5, 0.82, band) * dorsal * 0.9);
  // Pebbly mottling, stronger on the back.
  c = scaleRGB(c, 0.76 + 0.48 * mottle(p, 0.16, 9) * (0.6 + 0.4 * dorsal));
  // AO under the body and between the legs.
  const ao = 1 - 0.35 * down * smoothstep(1.3, 0.0, Math.abs(p.z) - 0.2);
  return scaleRGB(c, ao);
}

/** The spine parameter at station x (the spine is monotone in x). */
function spineT(spine: RigPath, x: number, tmp: THREE.Vector3): number {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 20; i++) {
    const mid = 0.5 * (lo + hi);
    if (spine.at(mid, tmp).x < x) lo = mid;
    else hi = mid;
  }
  return 0.5 * (lo + hi);
}

/** Superellipse ring point: a = 0 at the top, PI/2 at the right side. */
function ring(a: number, w: number, top: number, bot: number, e: number, out: THREE.Vector2): void {
  const s = Math.sin(a);
  const c = Math.cos(a);
  const ex = 2 / e;
  out.set(w * Math.sign(s) * Math.abs(s) ** ex, (c >= 0 ? top : bot) * Math.sign(c) * Math.abs(c) ** ex);
}

/**
 * A loft along the spine whose rows sit at the given stations (x), so the coarse LODs keep the head and tail mass.
 * `full` = the head section includes the lower jaw.
 */
function bodyLoft(spine: RigPath, stations: readonly number[], cols: number, full: boolean): GridSpec {
  const tmp = new THREE.Vector3();
  const ts = stations.map((x) => spineT(spine, x, tmp));
  const tOf = (u: number): number => {
    const f = Math.min(1, Math.max(0, u)) * (ts.length - 1);
    const i = Math.min(ts.length - 2, Math.floor(f));
    return ts[i] + (ts[i + 1] - ts[i]) * (f - i);
  };
  return sweepGeometry(
    (u, out) => spine.at(tOf(u), out),
    (u, a, out) => {
      spine.at(tOf(u), tmp);
      const x = tmp.x;
      // The rough brow: a ridge over the eye.
      const brow = 0.07 * Math.exp(-(((x - 4.02) / 0.14) ** 2));
      ring(a, SECTION.at(x, 1), SECTION.at(x, 2) + brow, full ? SECTION.at(x, 3) : SECTION.at(x, 5), SECTION.at(x, 4), out);
    },
    stations.length,
    cols,
    new THREE.Vector3(0, 1, 0),
  );
}

/** Evenly spaced stations from the tail tip to the snout, n rows. */
function evenStations(n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(-7.3 + (12.3 * i) / (n - 1));
  return out;
}

interface LodSpec {
  stations: number[];
  cols: number;
  /** The lower jaw as its own loft (rows, cols), or null (carved from the head loft). */
  jaw: [number, number] | null;
  leg: [number, number];
  /** Arm tube rows, cols, or null (no arms). */
  arm: [number, number] | null;
  /** Stick legs (hip -> knee -> foot) for the farthest LOD. */
  stick: boolean;
}

type LodName = 'lod0' | 'lod1' | 'lod2' | 'caster';

const LODS: Record<LodName, LodSpec> = {
  lod0: { stations: evenStations(68), cols: 18, jaw: [16, 10], leg: [20, 10], arm: [8, 6], stick: false },
  lod1: { stations: [-7.3, -6.0, -4.6, -3.2, -1.8, -0.4, 0.9, 2.0, 2.8, 3.35, 3.75, 4.15, 4.55, 4.85, 5.0], cols: 10, jaw: null, leg: [8, 6], arm: [3, 3], stick: false },
  lod2: { stations: [-7.3, -4.9, -2.4, -0.2, 1.6, 2.9, 3.75, 4.45, 5.0], cols: 4, jaw: null, leg: [2, 3], arm: null, stick: true },
  caster: { stations: evenStations(38), cols: 10, jaw: null, leg: [10, 6], arm: [3, 4], stick: false },
};

/** Build one LOD of the body plan. */
export function buildTyrannosaurus(which: LodName): BuiltLod {
  const L = LODS[which];
  const mesh = new RigMesh();
  const spine = new RigPath(SPINE);
  const tmp = new THREE.Vector3();
  const jawLoft = L.jaw !== null;

  // Body loft.
  mesh.add(bodyLoft(spine, L.stations, L.cols, !jawLoft), (info, out) => {
    const x = info.p.x;
    if (x < 0) chainWeight(-x, BONE.root, SPINE_JOINTS_TAIL.map((j) => ({ ...j, at: -j.at })), out);
    else chainWeight(x, BONE.root, SPINE_JOINTS_FRONT, out);
    const sy = spine.at(spineT(spine, Math.min(5, Math.max(-7.3, x)), tmp), tmp).y;
    const head = x > 3.62;
    // Without a jaw loft, the lower half of the head forward of the jaw joint is the lower jaw.
    if (!jawLoft && head && info.p.y < sy - 0.22 && x > JAW_PIVOT[0] - 0.05) {
      out.bone = BONE.jaw;
      out.w = smoothstep(JAW_PIVOT[0] - 0.05, JAW_PIVOT[0] + 0.25, x);
    }
    let c = bodyColour(info.p, info.n, SECTION.at(x, 3), sy);
    if (head) {
      // The brow ridge: darker and rougher above the eye.
      const brow = Math.exp(-(((x - 4.02) / 0.2) ** 2)) * smoothstep(0.0, 0.35, info.p.y - sy);
      c = mixRGB(c, scaleRGB(BROW, 0.7 + 0.6 * mottle(info.p, 0.05, 13)), 0.85 * brow);
      // The skull's lower edge (LOD0): the upper tooth row, and the mouth lining on its underside.
      if (jawLoft && x > 3.8) {
        const lip = sy - SECTION.at(x, 5);
        c = mixRGB(c, TEETH, smoothstep(lip + 0.07, lip + 0.02, info.p.y) * smoothstep(3.85, 4.0, x));
        if (info.n.y < -0.6) c = MOUTH;
      }
      const eye = Math.hypot(x - 3.98, info.p.y - (sy + 0.16), Math.abs(info.p.z) - 0.47);
      if (eye < 0.07) c = EYE;
    }
    out.color = clampAlbedo(c);
  });

  // The lower jaw (LOD0): a loft under the skull from behind the jaw joint to the chin, on the jaw bone.
  if (L.jaw) {
    const JAW_PATH = new RigPath([
      [3.5, 3.08, 0],
      [3.9, 3.04, 0],
      [4.4, 3.08, 0],
      [4.96, 3.12, 0],
    ]);
    // x: halfWidth, halfTop, halfBottom.
    const JS = new Profile([
      [3.5, 0.34, 0.06, 0.36],
      [3.85, 0.5, 0.1, 0.42],
      [4.4, 0.37, 0.1, 0.33],
      [4.85, 0.23, 0.08, 0.18],
      [4.96, 0.08, 0.04, 0.06],
    ]);
    const tj = new THREE.Vector3();
    const spec = sweepGeometry(
      (u, out) => JAW_PATH.at(u, out),
      (u, a, out) => {
        const x = JAW_PATH.at(u, tj).x;
        ring(a, JS.at(x, 1), JS.at(x, 2), JS.at(x, 3), 2.5, out);
      },
      L.jaw[0],
      L.jaw[1],
      new THREE.Vector3(0, 1, 0),
    );
    mesh.add(spec, (info, out) => {
      const x = info.p.x;
      out.bone = BONE.jaw;
      out.w = smoothstep(JAW_PIVOT[0] - 0.15, JAW_PIVOT[0] + 0.12, x);
      let c: RGB;
      if (info.n.y > 0.5) c = MOUTH;
      else if (info.n.y > 0.1 && x > 3.9) c = TEETH;
      else c = scaleRGB(mixRGB(BELLY, FLANK, smoothstep(-0.5, 0.2, info.n.y) * 0.6), 0.8 + 0.4 * mottle(info.p, 0.1, 17));
      out.color = clampAlbedo(c);
    });
  }

  // Hind legs: massive thighs, slim shins, a three-toed foot (one tube; the toes splay as a wide flat foot).
  // Radii by fraction of the limb path: side, fore-aft.
  const legR = new Profile([
    [0, 0.44, 0.66],
    [0.12, 0.48, 0.66],
    [0.2, 0.42, 0.55],
    [0.29, 0.3, 0.36],
    [0.38, 0.23, 0.28],
    [0.5, 0.17, 0.2],
    [0.62, 0.13, 0.14],
    [0.77, 0.14, 0.1],
    [0.84, 0.18, 0.085],
    [0.95, 0.12, 0.07],
    [1, 0.05, 0.04],
  ]);
  const leg = (side: number, bone: number): void => {
    const pts: Vec3[] = L.stick ? [HIP, KNEE, [BALL[0] + 0.15, 0.07, BALL[2]]] : HIND;
    const path = new RigPath(pts.map((p) => mirror(p, side)));
    const len = path.length;
    const k = L.stick ? 0.75 : 1;
    const [rows, cols] = L.leg;
    mesh.add(tubeSpec(path, (t) => (L.stick ? [Math.max(0.12, 0.42 * (1 - t)) * k, Math.max(0.07, 0.55 * (1 - t))] : [legR.at(t, 1), legR.at(t, 2)]), rows, cols), (info, out) => {
      const s = info.u * len;
      out.bone = bone;
      out.w = 0.3 + 0.7 * smoothstep(0, 0.7, s);
      out.limb = s;
      const top = smoothstep(1.0, 0.2, s);
      let c = mixRGB(BACK, FLANK, 0.5 + 0.3 * smoothstep(0.3, -0.5, info.n.y));
      c = mixRGB(c, BELLY, 0.35 * smoothstep(0.2, -0.6, info.n.z * side));
      c = scaleRGB(c, 0.82 + 0.36 * mottle(info.p, 0.14, 21));
      if (info.u > 0.93) c = mixRGB(c, CLAW, smoothstep(0.93, 0.98, info.u));
      const inner = smoothstep(0.2, -0.6, info.n.z * side);
      c = scaleRGB(c, (1 - 0.3 * top) * (1 - 0.2 * inner));
      out.color = clampAlbedo(c);
    });
  };
  leg(1, BONE.legHR);
  leg(-1, BONE.legHL);

  // The tiny two-fingered arms.
  const armSpec = L.arm;
  if (armSpec) {
    const armR = new Profile([
      [0, 0.11, 0.11],
      [0.4, 0.07, 0.075],
      [0.7, 0.05, 0.05],
      [0.85, 0.055, 0.03],
      [1, 0.02, 0.018],
    ]);
    const arm = (side: number, bone: number): void => {
      const path = new RigPath(ARM.map((p) => mirror(p, side)));
      const len = path.length;
      mesh.add(tubeSpec(path, (t) => [armR.at(t, 1), armR.at(t, 2)], armSpec[0], armSpec[1]), (info, out) => {
        const s = info.u * len;
        out.bone = bone;
        out.w = 0.4 + 0.6 * smoothstep(0, 0.2, s);
        out.limb = s;
        let c = scaleRGB(mixRGB(BACK, FLANK, 0.6), 0.85 + 0.3 * mottle(info.p, 0.1, 23));
        if (info.u > 0.85) c = mixRGB(c, CLAW, 0.8);
        out.color = clampAlbedo(c);
      });
    };
    arm(1, BONE.legFR);
    arm(-1, BONE.legFL);
  }

  return { geometry: mesh.build(), triangles: mesh.triangles };
}

/** All LODs, the caster and the shared pivots. */
export function createTyrannosaurus(): CreatureMeshSet {
  return {
    lod0: buildTyrannosaurus('lod0').geometry,
    lod1: buildTyrannosaurus('lod1').geometry,
    lod2: buildTyrannosaurus('lod2').geometry,
    caster: buildTyrannosaurus('caster').geometry,
    pivots: tyrannosaurusPivots(),
    lengthM: TYRANNOSAURUS_LENGTH_M,
  };
}

/** The animated material's view of the theropod rig. */
export const TYRANNOSAURUS_RENDER: SpeciesRender = Object.freeze({ rig: 'theropod', subJoints: tyrannosaurusSubJoints, fold: identityFold, subBlend: 0.12 });
