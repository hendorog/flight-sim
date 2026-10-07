// Propeller and spinner from the airframe definition (default: the Cessna 172S, a fixed-pitch McCauley
// 1A170E). The twisted blades (helical pitch angle beta(r) = atan(P / 2 pi r) for the geometric pitch P, round
// shank blending into a cambered section) are shown at low rpm; above that a translucent disc, whose radial
// opacity follows the blades' chord solidity, takes over as a motion-blur stand-in. Rotation is clockwise
// seen from the cockpit (positive about body +x).
//
// A variable-pitch propeller is one blade per face, instanced blades x SMEAR_COPIES times: each instance
// turns the blade about its own axis by the blade angle less the angle the geometry is built at, so the
// blades go to coarse pitch and to feather. `rotation: -1` mirrors the blade (twist and leading edge) and the
// direction of the smear; the spin angle itself comes signed from PropellerState.rotation.
//
// Paint (C172S): satin grey thrust face, matt black back (anti-glare, seen from the cockpit), white tips.

import * as THREE from 'three';
import { C172S_VISUAL } from '../../aircraft/c172s/visual';
import type { PropVisualDef } from './airframe/types';
import { NACA2412, surfacePoint } from './airfoil';
import { frd, gridGeometry, MeshBatch, type GridSpec } from './geometry';
import type { AircraftMaterials } from './materials';

/** What the blade and disc builders need of one propeller definition. */
interface BladeSpec {
  /** The definition: hub, blade count, chord table, tip band. */
  P: PropVisualDef;
  /** Tip radius and the geometric pitch of the blades' helix, m. */
  R: number;
  PITCH_M: number;
  /** Paint of the thrust face, the back and the tips. */
  GREY: THREE.Color;
  BLACK: THREE.Color;
  WHITE: THREE.Color;
}

function bladeSpec(P: PropVisualDef): BladeSpec {
  const R = P.diameter / 2;
  const paint = (c: readonly [number, number, number]): THREE.Color => new THREE.Color().setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace);
  return {
    P,
    R,
    PITCH_M: P.geometricPitch ?? Math.tan(P.referencePitch) * 2 * Math.PI * 0.75 * R,
    GREY: paint(P.paint.face),
    BLACK: paint(P.paint.back),
    WHITE: paint(P.paint.tip),
  };
}

/** Blade chord (m) against r/R, from the definition's table. */
function chordAt(pts: PropVisualDef['chord'], f: number): number {
  for (let i = 1; i < pts.length; i++)
    if (f <= pts[i][0]) {
      const t = (f - pts[i - 1][0]) / (pts[i][0] - pts[i - 1][0]);
      return pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t;
    }
  return pts[pts.length - 1][1];
}

/**
 * One face of a blade (thrust face = upper airfoil surface, facing forward; or the back), in model space,
 * for a blade whose radial direction is `radial` (unit, FRD in the y-z plane).
 */
function bladeFace(blade: BladeSpec, radial: { y: number; z: number }, face: 1 | -1): THREE.BufferGeometry {
  const { P, R, PITCH_M, GREY, BLACK, WHITE } = blade;
  const TIP_BAND = P.paint.tipBand;
  // A variable-pitch blade is drawn blades x SMEAR_COPIES times: a lighter grid keeps a three-blade propeller at
  // the triangles of the two-blade fixed-pitch one.
  const rows = P.variablePitch ? 24 : 34;
  const n = P.variablePitch ? 12 : 18;
  const hub = frd(P.hub[0], P.hub[1], P.hub[2]);
  const rad = frd(0, radial.y, radial.z);
  // Direction of blade motion for positive rotation about +x: x-hat cross radial.
  const tangential = frd(0, -radial.z, radial.y);
  // A propeller turning the other way is the mirror image: its leading edge points the other way round.
  if (P.rotation < 0) tangential.negate();
  const fwd = frd(1, 0, 0);
  const r0 = 0.1;
  const spec: GridSpec = {
    rows,
    cols: n + 1,
    // Column order (TE->LE on the thrust face, LE->TE on the back) already gives both faces outward winding
    // (the mirror image reverses it).
    flip: P.rotation < 0,
    position(i, j, out) {
      const f = r0 / R + (1 - r0 / R) * Math.sin((Math.PI / 2) * (i / (rows - 1)));
      const r = f * R;
      const chord = chordAt(P.chord, f);
      const beta = Math.min(52 * (Math.PI / 180), Math.atan(PITCH_M / (2 * Math.PI * r)));
      // Chord runs trailing edge -> leading edge along j; leading edge first for the back face.
      const xc = 0.5 * (1 - Math.cos((Math.PI * j) / n));
      const xcs = face > 0 ? 1 - xc : xc;
      // Round shank at the root blending into the section by ~0.3 R; thickness thins toward the tip.
      const shank = Math.max(0, Math.min(1, (0.32 - f) / 0.18));
      const tScale = 1 + 0.5 * (1 - f);
      const [ax, ay] = surfacePoint(NACA2412, xcs, face);
      const circle = face * Math.sqrt(Math.max(0, 0.25 - (xcs - 0.5) ** 2));
      const along = (0.35 - (ax * (1 - shank) + xcs * shank)) * chord;
      const thick = (ay * tScale * (1 - shank) + circle * 0.85 * shank) * chord;
      // Tip rounding: fade thickness in the last few percent.
      const tip = Math.sqrt(Math.max(0, 1 - Math.max(0, (f - 0.96) / 0.04) ** 2));
      const cb = Math.cos(beta);
      const sb = Math.sin(beta);
      // Chord direction (TE -> LE) = cos(beta) tangential + sin(beta) forward; thickness normal to it.
      out.copy(hub).addScaledVector(rad, r);
      out.addScaledVector(tangential, along * cb - thick * tip * sb).addScaledVector(fwd, along * sb + thick * tip * cb);
    },
  };
  const g = gridGeometry(spec);
  const colours = new Float32Array(rows * (n + 1) * 3);
  for (let i = 0; i < rows; i++) {
    const f = r0 / R + (1 - r0 / R) * Math.sin((Math.PI / 2) * (i / (rows - 1)));
    const c = f * R > R - TIP_BAND ? WHITE : face > 0 ? GREY : BLACK;
    for (let j = 0; j <= n; j++) c.toArray(colours, (i * (n + 1) + j) * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  return g;
}

/**
 * Perceived density of the blur disc against its time-averaged coverage (the blade solidity
 * sigma(r) = B c(r) / (2 pi r), 3-17 %): a spinning prop flickers at the blade-passage rate (~80 Hz at
 * 2400 rpm), close to the eye's flicker fusion and the camera's frame rate, and the flicker makes the disc
 * read denser than its mean - a faint but plain grey veil from the cockpit, about 12-20 % across the span.
 */
const DISC_FLOOR = 0.08;
const DISC_MAX = 0.2;
/** Density of the painted tip band: the bright paint on a dark disc reads as a distinct ring. */
const DISC_TIP = 0.3;

/**
 * Radial colour (sRGB, the face's paint) and opacity profile of the blur disc for one face: the thrust face
 * satin grey, the back matt black, both with white tips.
 */
function discTexture(blade: BladeSpec, face: 1 | -1): THREE.DataTexture {
  const { P, R, GREY, BLACK, WHITE } = blade;
  const TIP_BAND = P.paint.tipBand;
  const W = 256;
  const data = new Uint8Array(W * 4);
  const body = face > 0 ? GREY : BLACK;
  const tipC = new THREE.Color();
  const bodyC = new THREE.Color();
  WHITE.getRGB(tipC, THREE.SRGBColorSpace);
  body.getRGB(bodyC, THREE.SRGBColorSpace);
  for (let i = 0; i < W; i++) {
    const f = (i + 0.5) / W;
    const r = Math.max(0.12, f * R);
    const sigma = (P.blades * chordAt(P.chord, f)) / (2 * Math.PI * r);
    // Tip band, softened over 1 cm at its inner edge; the disc fades out over the last 2 cm, so it has no
    // hard rim (a real prop at cruise rpm shows no sharp circular outline).
    const tip = Math.min(1, Math.max(0, (f * R - (R - TIP_BAND)) / 0.01 + 0.5));
    const rim = Math.min(1, Math.max(0, (R - f * R) / 0.02));
    const a = (Math.min(DISC_MAX, DISC_FLOOR + sigma) * (1 - tip) + DISC_TIP * tip) * rim * rim * (3 - 2 * rim);
    const c = bodyC.clone().lerp(tipC, tip);
    data.set([c.r * 255, c.g * 255, c.b * 255, a * 255], i * 4);
  }
  const t = new THREE.DataTexture(data, W, 1, THREE.RGBAFormat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

/** Copies of each blade face used to draw the motion blur. */
const SMEAR_COPIES = 16;
/** Exposure the blur represents: one 60 Hz frame. */
const EXPOSURE = 1 / 60;
const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export class Propeller {
  /** Rotates about the prop axis (model -Z). */
  readonly group = new THREE.Group();
  private readonly blades = new THREE.Group();
  private readonly discFront: THREE.MeshStandardMaterial;
  private readonly discBack: THREE.MeshStandardMaterial;
  private readonly bladeMats: THREE.MeshStandardMaterial[];
  private readonly discTex: THREE.DataTexture[];
  private readonly discs: THREE.Mesh[];
  private readonly bladeCopies: THREE.InstancedMesh[] = [];
  private readonly copyMatrix = new THREE.Matrix4();
  private readonly pitchMatrix = new THREE.Matrix4();
  private lastSmear = -1;
  private lastPitch = NaN;
  /** Angle between successive blades. */
  private readonly bladeGap: number;
  private readonly def: PropVisualDef;
  /** Blade materials that are this propeller's own (see the constructor). */
  private readonly ownMats: THREE.Material[] = [];

  /**
   * @param def the propeller of the airframe definition (default: the Cessna 172S)
   * @param ownMaterials give this propeller its own copies of the blade materials: their opacity follows the
   *                     rpm, so of several propellers only one can use the shared ones
   */
  constructor(mat: AircraftMaterials, def: PropVisualDef = C172S_VISUAL.props[0], ownMaterials = false) {
    const blade = bladeSpec(def);
    const { P, R } = blade;
    this.def = def;
    const propFront = ownMaterials ? mat.propFront.clone() : mat.propFront;
    const propBack = ownMaterials ? mat.propBack.clone() : mat.propBack;
    if (ownMaterials) this.ownMats.push(propFront, propBack);
    const SPINNER_BASE_X = P.spinner.baseX;
    const SPINNER_R = P.spinner.radius;
    this.bladeGap = (2 * Math.PI) / P.blades;
    const hub = frd(P.hub[0], P.hub[1], P.hub[2]);
    this.group.position.copy(hub);
    this.group.name = 'propeller';
    const toHub = new THREE.Matrix4().makeTranslation(-hub.x, -hub.y, -hub.z);

    const front = new MeshBatch();
    const back = new MeshBatch();
    // Fixed pitch: all the blades in one geometry per face. Variable pitch: one blade (pointing up), which the
    // instances place round the hub and turn to the blade angle.
    for (let b = 0; b < (P.variablePitch ? 1 : P.blades); b++) {
      const ang = (b / P.blades) * Math.PI * 2;
      const radial = { y: Math.sin(ang), z: -Math.cos(ang) };
      front.add(propFront, bladeFace(blade, radial, 1), toHub);
      back.add(propBack, bladeFace(blade, radial, -1), toHub);
    }
    // Each blade face is instanced SMEAR_COPIES times: the copies spread over the angle the prop sweeps
    // during a frame's exposure (see update), all in one draw per face.
    for (const m of [...front.build('bladeFront').children, ...back.build('bladeBack').children] as THREE.Mesh[]) {
      const inst = new THREE.InstancedMesh(m.geometry, m.material as THREE.Material, SMEAR_COPIES * (P.variablePitch ? P.blades : 1));
      inst.name = m.name;
      inst.count = 1;
      inst.frustumCulled = false;
      inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.bladeCopies.push(inst);
      this.blades.add(inst);
    }
    this.bladeMats = [propFront, propBack];

    // Spinner: an ogive of revolution with a flat backplate, painted like the airframe.
    const spinnerPts: THREE.Vector2[] = [];
    const len = P.spinner.length;
    for (let k = 0; k <= 24; k++) {
      const t = k / 24;
      const r = SPINNER_R * Math.pow(Math.sin((Math.PI / 2) * (1 - t)), 0.62) * (1 - 0.04 * t);
      spinnerPts.push(new THREE.Vector2(Math.max(r, 1e-4), t * len));
    }
    const spinner = new THREE.LatheGeometry(spinnerPts, 48);
    spinner.rotateX(-Math.PI / 2);
    spinner.translate(0, 0, -(SPINNER_BASE_X - P.hub[0]));
    const plate = new THREE.CylinderGeometry(SPINNER_R, SPINNER_R, 0.012, 48);
    plate.rotateX(Math.PI / 2);
    plate.translate(0, 0, -(SPINNER_BASE_X - P.hub[0]) + 0.006);
    const hubParts = new MeshBatch();
    hubParts.add(mat.plainPaint, spinner);
    hubParts.add(mat.plainPaint, plate);
    this.group.add(...hubParts.build('spinner').children);
    this.group.add(this.blades);

    // Blur discs: separate front (grey thrust faces) and back (black) so each side shows its paint.
    this.discTex = [discTexture(blade, 1), discTexture(blade, -1)];
    const discGeo = (facing: 1 | -1): THREE.BufferGeometry => {
      const rows = 6;
      const cols = 72;
      const g = gridGeometry({
        rows,
        cols: cols + 1,
        wrap: true,
        // Radius x angle winding faces +Z (aft); the front disc is flipped to face forward.
        flip: facing > 0,
        position(i, j, out) {
          const r = 0.19 + (R - 0.19) * (i / (rows - 1));
          const a = (j / cols) * Math.PI * 2;
          out.set(Math.cos(a) * r, Math.sin(a) * r, -0.01 * facing);
        },
        uv(i, _j, out) {
          out.set((0.19 + (R - 0.19) * (i / (rows - 1))) / R, 0.5);
        },
      });
      return g;
    };
    const discMat = (map: THREE.Texture, rough: number): THREE.MeshStandardMaterial =>
      new THREE.MeshStandardMaterial({
        roughness: rough,
        metalness: 0,
        map,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.FrontSide,
      });
    this.discFront = discMat(this.discTex[0], 0.5);
    this.discBack = discMat(this.discTex[1], 0.8);
    this.discs = [new THREE.Mesh(discGeo(1), this.discFront), new THREE.Mesh(discGeo(-1), this.discBack)];
    for (const d of this.discs) {
      d.renderOrder = 1;
      d.visible = false;
      this.group.add(d);
    }
    this.group.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && !this.discs.includes(o as THREE.Mesh)) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
  }

  /**
   * @param rotation   accumulated blade angle, rad (positive = clockwise from the cockpit)
   * @param rpm        propeller speed
   * @param bladePitch blade angle at the reference station, rad (PropellerState.bladePitch); only a
   *                   variable-pitch propeller shows it. Default: the angle the geometry is built at.
   */
  update(rotation: number, rpm: number, bladePitch: number = this.def.referencePitch): void {
    // Positive rotation about body +x = about model -Z.
    this.group.rotation.z = -rotation;
    // What a camera (or the eye) integrates over one frame: the blades sweep omega * EXPOSURE, 65 degrees at
    // the 650 rpm idle. The blades are drawn as SMEAR_COPIES copies spread over that angle, each at an
    // opacity of about 2 / copies: a point under the smear is covered by a fraction chord / (r * sweep) of
    // the copies, which is the blade's real time-averaged coverage (times ~2 for the flicker the eye
    // perceives). As the smear approaches the angle between blades the copies band, and the blur disc
    // (the same average, pre-integrated) takes over.
    const BLADE_GAP = this.bladeGap;
    const sweep = Math.min(BLADE_GAP, ((Math.max(0, rpm) * 2 * Math.PI) / 60) * EXPOSURE);
    const toDisc = smoothstep(0.55 * BLADE_GAP, 0.95 * BLADE_GAP, sweep);
    const sharp = sweep < 0.015;
    const dir = this.def.rotation;
    const variable = this.def.variablePitch;
    // The mirror-image blade's pitch axis is mirrored with it.
    const twist = variable ? dir * (bladePitch - this.def.referencePitch) : 0;
    if (Math.abs(sweep - this.lastSmear) > 1e-4 || (variable && !(Math.abs(twist - this.lastPitch) <= 1e-4))) {
      this.lastSmear = sweep;
      this.lastPitch = twist;
      const n = sharp ? 1 : SMEAR_COPIES;
      const blades = variable ? this.def.blades : 1;
      // The blade's own axis is model +Y (it is built pointing up); a positive turn brings its leading edge forward.
      if (variable) this.pitchMatrix.makeRotationY(twist);
      for (const inst of this.bladeCopies) {
        inst.count = n * blades;
        for (let b = 0; b < blades; b++)
          for (let k = 0; k < n; k++) {
            // Trailing copies: earlier positions, i.e. rotated back against the direction of rotation.
            const smear = n > 1 ? (dir * sweep * k) / (n - 1) : 0;
            if (variable) inst.setMatrixAt(b * n + k, this.copyMatrix.makeRotationZ(smear - b * BLADE_GAP).multiply(this.pitchMatrix));
            else inst.setMatrixAt(k, this.copyMatrix.makeRotationZ(smear));
          }
        inst.instanceMatrix.needsUpdate = true;
        // A smeared blade is a transparent blur and casts only a faint flicker of shadow.
        inst.castShadow = sweep < 0.3;
      }
    }
    const perCopy = sharp ? 1 : Math.min(1, 2 / SMEAR_COPIES + (1 - 2 / SMEAR_COPIES) * Math.max(0, 1 - sweep / 0.12));
    const bladeAlpha = perCopy * (1 - toDisc);
    this.blades.visible = bladeAlpha > 0.005;
    for (const m of this.bladeMats) {
      m.opacity = bladeAlpha;
      // Overlapping copies must all show: no depth writes once smeared.
      m.depthWrite = sharp;
    }
    for (const d of this.discs) d.visible = toDisc > 0.01;
    // The cockpit side reads a little denser: the matt black backs against a bright sky.
    this.discFront.opacity = 0.85 * toDisc;
    this.discBack.opacity = toDisc;
  }

  dispose(): void {
    for (const t of this.discTex) t.dispose();
    this.discFront.dispose();
    this.discBack.dispose();
    for (const m of this.ownMats) m.dispose();
  }
}
