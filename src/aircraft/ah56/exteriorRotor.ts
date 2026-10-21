// AH-56A rotors: the four-blade hingeless main rotor head, the four-blade tail rotor on the left stabiliser tip and the
// three-blade pusher on the tail.
//
// Main head (P ASTA-72 p 48, AMCS-73 p 21; hardware proportions 3V from the Rucker, Fort Campbell and Ames photographs):
// - AMCS (1973 ship 7, the default): the hub drum with its cruciform arms, the long blade-root cuffs with leading-edge
//   pitch horns, pitch links up from the rotating swashplate ring, the non-rotating swashplate on the static mast. No
//   gyro on the head (Rucker 66-8832).
// - ICS (state.controlGyro.mode 'ics'): adds the 9.7 ft four-arm control gyro "X" with its tip masses on a post above the
//   hub, its arms 33 deg ahead of the blades (P cant), tilted relative to the shaft by state.controlGyro (pitch + = aft,
//   roll + = right, the gyroBladeCyclic convention); the pitch links then run from the gyro arms to the horns.
// The blades are hingeless: each is posed by a rotation about the EQUIVALENT hinge (hubModel.equivalentHingeOffset when
// the hub is hingeless, else 10 % R ESTIMATE) from the published per-blade pose (state.articulated, which the solver
// publishes for a hingeless hub) or, absent that, a coning/first-harmonic estimate. The swashplate follows
// swashplateCyclic() so every reader agrees.
import * as THREE from 'three';
import type { SimContext } from '../../core/context';
import { DEG } from '../../core/math';
import type { RotorcraftDefinition, RotorcraftState } from '../../physics/rotorcraft/definition';
import { swashplateCyclic } from '../../physics/rotorcraft/swashplate';
import type { RotorcraftVisualDef } from '../../render/aircraft/airframe/types';
import type { AircraftMaterials } from '../../render/aircraft/materials';
import { TeeteringRotor } from '../../render/aircraft/rotorcraft/rotor';
import { bladeBlur } from '../../render/aircraft/bladeBlur';
import { frd, gridGeometry, MeshBatch } from '../../render/aircraft/geometry';
import { box, tube } from '../../render/aircraft/rotorcraft/geometry';
import * as D from './dimensions';
import { AH56_MASS_LB, AH56_NR_100, AH56_PROP_RATIO, AH56_TAIL_RATIO } from './facts';
import { SPINNER, TAIL_PAINT, fs, wl } from './visual';
import { ellipsoid, fitRod, nacaThickness, revolve, type AH56Materials } from './exteriorGeometry';

/** Blade section t/c: (4.6)3012 mod at the root to (0.6)3006 mod at the tip (P research-ah56 section 5). */
export const MAIN_SECTION = { root: 0.12, tip: 0.06 } as const;
/** Equivalent hinge offset when the definition has no hingeless hub yet: 10 % R (ESTIMATE, research-ah56 section 5). */
export const DEFAULT_HINGE_FRACTION = 0.10;
/** Swashplate centre below the blade plane, m (3V: just above the transmission fairing top WL 156). */
export const SWASHPLATE_DROP = 0.15;
/** ICS gyro X: the 9.7 ft (P) span is taken over the tip masses: arm length to the mass centre = span / 2 - mass radius;
 *  tip-mass radius (3V), lead ahead of the blades (P cant 33 deg). `rise` (the X's plane above the blade plane) is an
 *  AGENT choice: no dimensioned drawing of the gyro post was found and no photo ratio was measured, so 0.32 m is SET to
 *  land the published ICS height 13 ft 8.5 in (S) within its 2 % row (the built model reads 162.6 in, -1.2 %). The
 *  height row therefore checks this choice, it does not measure it (docs/ah56-exterior.md). */
const GYRO_MASS_RADIUS = 0.085;
export const GYRO = { armLength: D.ICS_GYRO_SPAN / 2 - GYRO_MASS_RADIUS, rise: 0.32, massRadius: GYRO_MASS_RADIUS, leadDeg: D.ICS_GYRO_CANT_DEG } as const;
/** Static droop of the blade at rest, rad (3V: the museum blades hang a little). */
export const REST_DROOP = -0.9 * DEG;
/** Tail-rotor blade angle range (P ASTA-72: -7.4 to +24.2 deg, 1972-73). */
export const TAIL_PITCH = { min: -7.4 * DEG, max: 24.2 * DEG } as const;
/** Pusher: blade chord from the activity factor AF 142 (P): c/D = 142 / 1562 = 0.091 -> 0.277 m (D, constant chord). */
export const PUSHER_BLADE = { chord: 0.277, root: 0.16, twistDeg: 30, tc: { root: 0.10, tip: 0.04 } } as const;
/** Blade angle (at 0.7 R) the prop is drawn at when there is no pusher (stage 2: stopped and feathered, plan 7.5). */
export const PUSHER_FEATHER = 88 * DEG;

/** Gyro tilt drawn when the definition has no control gyro: +/-45 deg (a guard against tan(90 deg), not a stop). */
export const GYRO_DRAW_LIMIT = 45 * DEG;

/** Largest tilt stop of the configuration `mode` (the gyro is drawn clamped to it), else GYRO_DRAW_LIMIT. The AMCS stops
 *  are asymmetric (up/down/left/right); the drawing clamps symmetrically to the largest, which is all the guard needs. */
export function gyroDrawLimit(def: RotorcraftDefinition, mode: 'amcs' | 'ics'): number {
  const t = def.controlGyro?.configs[mode]?.maxTilt;
  const stop = t ? Math.max(t.up, t.down, t.left, t.right) : NaN;
  return Number.isFinite(stop) && stop > 0 ? Math.min(stop, GYRO_DRAW_LIMIT) : GYRO_DRAW_LIMIT;
}

/** The visual description handed to the generic renderer: the main coning WITHOUT its `bending` block. TeeteringRotor
 *  rewrites every blade vertex from its construction-time (untapered, 12 % t/c) copy whenever the generic tipBend
 *  changes, which would undo taperBladeThickness(); AH56MainRotor poses the blades from the rotor state and ignores the
 *  generic cone/tipBend, so the generic sag is dropped instead. */
export function withoutBladeBending<T extends { rotorcraftVisual?: RotorcraftVisualDef }>(def: T): T {
  const rv = def.rotorcraftVisual, coning = rv?.main.coning;
  if (!rv || !coning?.bending) return def;
  return { ...def, rotorcraftVisual: { ...rv, main: { ...rv.main, coning: { ...coning, bending: undefined } } } };
}

/** Equivalent hinge offset of the definition, m. */
export function hingeOffset(def: RotorcraftDefinition): number {
  return def.hubModel?.kind === 'hingeless' ? def.hubModel.equivalentHingeOffset : DEFAULT_HINGE_FRACTION * D.MAIN_ROTOR_RADIUS;
}

/** Scale the generic NACA 0012 blade grid's thickness to a linear root-to-tip t/c taper (chord, twist, paint kept). */
export function taperBladeThickness(g: THREE.BufferGeometry, spec: { root: number; radius: number; twist: number }, root: number, tip: number): void {
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const f = (p.getX(i) - spec.root) / (spec.radius - spec.root), beta = spec.twist * (f - 0.75);
    const k = THREE.MathUtils.lerp(root, tip, THREE.MathUtils.clamp(f, 0, 1)) / 0.12;
    const y = p.getY(i), z = p.getZ(i), s = Math.sin(beta), c = Math.cos(beta);
    const along = y * s - z * c, thick = (y * c + z * s) * k;
    p.setY(i, along * s + thick * c); p.setZ(i, -along * c + thick * s);
  }
  p.needsUpdate = true; g.computeVertexNormals(); g.computeBoundingSphere();
}

export class AH56MainRotor {
  readonly group = new THREE.Group();
  /** Per-blade root hardware (cuff, horn), posed with the blade (matrix set every frame). */
  readonly cuffs: THREE.Group[] = [];
  readonly swashplate = new THREE.Group();
  /** ICS gyro X: tilt (non-rotating frame) and spin (rotating, 33 deg ahead of the blades). */
  readonly gyroTilt = new THREE.Group();
  readonly gyroSpin = new THREE.Group();
  /** The gyro's own materials (they fade with the rotor speed) and its blur ring. */
  readonly gyroArmMaterial = new THREE.MeshStandardMaterial({ name: 'ah56GyroArm', color: 0x5d6152, roughness: 0.5, metalness: 0.35, transparent: true });
  readonly gyroMassMaterial = new THREE.MeshStandardMaterial({ name: 'ah56GyroMass', color: 0x45472f, roughness: 0.66, transparent: true });
  readonly gyroRingMaterial = new THREE.MeshStandardMaterial({ name: 'ah56GyroBlur', color: 0x45472f, roughness: 0.7, transparent: true, opacity: 0, depthWrite: false });
  private gyroRing!: THREE.Mesh;
  private gyroPost!: THREE.Object3D;
  readonly hinge: number;
  private readonly links: THREE.Mesh[] = [];
  private readonly matrix = new THREE.Matrix4();
  private readonly pitchM = new THREE.Matrix4();
  private readonly flapM = new THREE.Matrix4();
  /** Translations to and from the equivalent hinge (constant: the hinge offset is fixed at construction). */
  private readonly toHinge = new THREE.Matrix4();
  private readonly fromHinge = new THREE.Matrix4();
  private readonly inverse = new THREE.Matrix4();
  private readonly inverseSpin = new THREE.Quaternion();
  private readonly a = new THREE.Vector3();
  private readonly b = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly tilt = new THREE.Vector3();
  private blurCone = NaN;
  /** The pose last drawn: per blade flap and pitch, rad (for tests and the trail). */
  readonly pose: { flap: number; pitch: number }[] = [];

  constructor(private readonly rotor: TeeteringRotor, private readonly spec: RotorcraftVisualDef['main'],
    private readonly definition: RotorcraftDefinition, m: AH56Materials) {
    for (const child of rotor.spin.children) if (child !== rotor.blades && child !== rotor.trail.mesh) child.visible = false;
    rotor.swashplate.visible = false;
    this.group.name = 'ah56MainHead'; rotor.spin.add(this.group);
    this.hinge = hingeOffset(definition);
    this.toHinge.makeTranslation(this.hinge, 0, 0); this.fromHinge.makeTranslation(-this.hinge, 0, 0);
    taperBladeThickness(rotor.blades.geometry, spec, MAIN_SECTION.root, MAIN_SECTION.tip);
    const n = D.MAIN_ROTOR_BLADES;
    // Rotating hub: the drum on the shaft, the cruciform arms to the root fittings and the cap.
    const hub = new MeshBatch();
    hub.add(m.cast, tube([0, 0, 0.11], [0, 0, -0.09], 0.235, 0.235, 40));
    hub.add(m.metal, tube([0, 0, -0.09], [0, 0, -0.13], 0.17, 0.15, 32));
    hub.add(m.dark, ellipsoid([0, 0, -0.13], [0.15, 0.15, 0.045], 28, 10));
    for (let k = 0; k < n; k++) {
      const az = k * 2 * Math.PI / n, c = Math.cos(az), s = Math.sin(az);
      // The arm in the blade direction: body right at azimuth 0, forward at 90 deg (the TeeteringRotor frame).
      const at = (r: number, z: number): [number, number, number] => [r * s, r * c, z];
      const arm = new THREE.BoxGeometry(0.26, 0.12, 0.17);
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), az);
      arm.applyQuaternion(q).translate(...frd(...at(0.32, 0)).toArray());
      hub.add(m.cast, arm);
      // Bearing housings between the arms (the "cruciform" webs).
      const mid = az + Math.PI / n;
      hub.add(m.cast, box([0.24 * Math.sin(mid), 0.24 * Math.cos(mid), 0], [0.07, 0.07, 0.15], 0.012));
    }
    this.group.add(hub.build('ah56HubCruciform'));
    // Per-blade root hardware in the blade frame (x radial, y up, z chordwise: the leading edge at -z for this rotor).
    for (let i = 0; i < n; i++) {
      const cuff = new THREE.Group(); cuff.name = `ah56BladeCuff${i}`; cuff.matrixAutoUpdate = false;
      const parts = new MeshBatch(), root = spec.root;
      const along = (r0: number, r1: number, rad0: number, rad1: number) => new THREE.CylinderGeometry(rad1, rad0, r1 - r0, 24)
        .rotateZ(-Math.PI / 2).translate((r0 + r1) / 2, 0, 0);
      parts.add(m.cast, along(0.40, 0.62, 0.105, 0.10));
      parts.add(m.paintDark, along(0.62, root - 0.06, 0.095, 0.075));
      parts.add(m.metal, along(0.60, 0.64, 0.112, 0.112));
      // Root fairing blending the cuff into the blade's root chord.
      parts.add(m.paintDark, new THREE.SphereGeometry(1, 20, 12).scale(0.14, 0.06, spec.chord[0] * 0.42).translate(root - 0.02, 0, 0.02));
      // Pitch horn on the leading edge with its ball.
      parts.add(m.cast, new THREE.BoxGeometry(0.05, 0.035, 0.17).translate(0.47, -0.045, -0.13));
      parts.add(m.metal, new THREE.SphereGeometry(0.018, 12, 8).translate(0.47, -0.06, -0.215));
      cuff.add(parts.build(`ah56BladeCuffParts${i}`));
      this.group.add(cuff); this.cuffs.push(cuff);
      const link = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1, 10), m.metal);
      link.name = 'ah56PitchLink'; link.castShadow = true; this.group.add(link); this.links.push(link);
      this.pose.push({ flap: 0, pitch: 0 });
    }
    // Swashplate (non-rotating frame) on the static mast.
    const swash = new MeshBatch();
    for (const [r, dz] of [[0.23, 0.014], [0.22, -0.018]] as const) {
      const ring = new THREE.TorusGeometry(r, 0.02, 10, 56); ring.rotateX(Math.PI / 2); ring.translate(0, dz, 0); swash.add(m.cast, ring);
    }
    swash.add(m.metal, tube([0, 0, -0.04], [0, 0, 0.045], 0.09, 0.09, 28));
    for (let k = 0; k < 3; k++) {
      const a = k * 2 * Math.PI / 3 + 0.5;
      swash.add(m.metal, tube([0.22 * Math.cos(a), 0.22 * Math.sin(a), 0.03], [0.2 * Math.cos(a), 0.2 * Math.sin(a), 0.16], 0.012, 0.012, 8));
    }
    this.swashplate.add(swash.build('ah56SwashplateRings'));
    this.swashplate.name = 'ah56Swashplate'; this.swashplate.position.y = -SWASHPLATE_DROP; rotor.group.add(this.swashplate);
    // Rotating scissors from the hub to the upper ring.
    const scissors = new MeshBatch();
    scissors.add(m.cast, tube([0.0, 0.2, 0.09], [0.0, 0.26, 0.12], 0.014));
    scissors.add(m.cast, tube([0.0, 0.26, 0.12], [0.0, 0.24, SWASHPLATE_DROP - 0.02], 0.014));
    this.group.add(scissors.build('ah56Scissors'));
    // ICS gyro X: post, hub, four arms with tip masses; built along the blade azimuths and turned by the lead angle.
    this.gyroTilt.name = 'ah56GyroTilt'; this.gyroSpin.name = 'ah56GyroX';
    this.gyroTilt.position.y = GYRO.rise; rotor.group.add(this.gyroTilt); this.gyroTilt.add(this.gyroSpin);
    const gx = new MeshBatch();
    gx.add(m.metal, tube([0, 0, 0], [0, 0, 0.08], 0.05, 0.05, 16));
    gx.add(m.cast, tube([0, 0, -0.06], [0, 0, 0.06], 0.13, 0.13, 32));
    for (let k = 0; k < n; k++) {
      const az = k * 2 * Math.PI / n, s = Math.sin(az), c = Math.cos(az), L = GYRO.armLength;
      gx.add(this.gyroArmMaterial, tube([0.10 * s, 0.10 * c, 0], [L * s, L * c, 0], 0.036, 0.02, 14));
      gx.add(this.gyroMassMaterial, ellipsoid([L * s, L * c, 0], [GYRO.massRadius, GYRO.massRadius, GYRO.massRadius * 0.8], 20, 12));
    }
    this.gyroSpin.add(gx.build('ah56GyroArms'));
    // The turning X reads as a faint ring of its tip masses (the same perceptual blur as the blades).
    const ring = new THREE.TorusGeometry(GYRO.armLength, GYRO.massRadius * 0.8, 10, 72).rotateX(Math.PI / 2);
    this.gyroRing = new THREE.Mesh(ring, this.gyroRingMaterial); this.gyroRing.name = 'ah56GyroBlur'; this.gyroTilt.add(this.gyroRing);
    const post = new MeshBatch(); post.add(m.metal, tube([0, 0, -0.10], [0, 0, -GYRO.rise + 0.02], 0.045, 0.06, 18));
    this.gyroPost = post.build('ah56GyroPost'); this.group.add(this.gyroPost);
  }

  dispose(): void { for (const x of [this.gyroArmMaterial, this.gyroMassMaterial, this.gyroRingMaterial]) x.dispose(); }

  /** Pose the head from the rotor state; `pose` is the solver's per-blade output (state.articulated) when published. */
  update(ctx: SimContext, state = ctx.state.rotorcraft): void {
    if (!state) return;
    const def = this.definition, n = D.MAIN_ROTOR_BLADES, e = this.hinge;
    // A hingeless hub does not tilt the head: each blade flaps (bends) about its equivalent hinge.
    this.rotor.group.quaternion.identity();
    const ics = state.controlGyro?.mode === 'ics';
    const cyclic = swashplateCyclic(def, ctx.controls, state);
    const collective = THREE.MathUtils.lerp(def.main.minPitch, def.main.maxPitch, ctx.controls.collective ?? 0);
    const published = state.articulated?.blades;
    // Fallback coning: droop at rest, the precone at 1 g of rotor thrust (the hingeless hub's zero-moment angle).
    const weight = AH56_MASS_LB.test * 0.45359237 * 9.80665;
    const spinUp = THREE.MathUtils.smoothstep(state.rotorRpm, 0, 0.5 * AH56_NR_100);
    const cone = THREE.MathUtils.lerp(REST_DROOP, D.MAIN_ROTOR_PRECONE_DEG * DEG * THREE.MathUtils.clamp(state.thrust / weight, 0, 1.6), spinUp);
    this.tilt.set(cyclic.right, 1, cyclic.aft).normalize();
    this.swashplate.quaternion.setFromUnitVectors(this.up, this.tilt);
    this.swashplate.position.y = -SWASHPLATE_DROP + (ctx.controls.collective ?? 0) * 0.04;
    this.gyroTilt.visible = ics; this.gyroPost.visible = ics;
    if (ics) {
      // Clamped to the stops before tan(): a +/-90 deg pose (the dev page takes any gyropitch=/gyroroll=) would give
      // Infinity and a NaN quaternion. A non-finite angle draws level.
      const limit = gyroDrawLimit(def, 'ics'), g = state.controlGyro!;
      const clampTilt = (x: number) => Number.isFinite(x) ? THREE.MathUtils.clamp(x, -limit, limit) : 0;
      this.tilt.set(Math.tan(clampTilt(g.roll)), 1, Math.tan(clampTilt(g.pitch))).normalize();
      this.gyroTilt.quaternion.setFromUnitVectors(this.up, this.tilt);
      this.gyroSpin.rotation.y = this.rotor.spin.rotation.y + GYRO.leadDeg * DEG * D.MAIN_ROTOR_ROTATION;
      const blur = bladeBlur(state.rotorRpm, n);
      this.gyroArmMaterial.opacity = this.gyroMassMaterial.opacity = blur.solid;
      this.gyroArmMaterial.depthWrite = this.gyroMassMaterial.depthWrite = blur.solid === 1;
      this.gyroSpin.visible = blur.solid > 0;
      this.gyroRingMaterial.opacity = 0.45 * (1 - blur.solid);
      this.gyroRing.visible = blur.solid < 1;
    }
    this.rotor.group.updateWorldMatrix(true, true);
    this.inverse.copy(this.group.matrixWorld).invert();
    let meanFlap = 0, forwardFlap = 0, rightFlap = 0, meanPitch = 0;
    for (let i = 0; i < n; i++) {
      const a = state.azimuth + i * 2 * Math.PI / n;
      const actual = published?.[i];
      const flap = actual && Number.isFinite(actual.flap) ? actual.flap : cone - state.flapForward * Math.sin(a) - state.flapRight * Math.cos(a);
      const pitch = actual && Number.isFinite(actual.pitch) ? actual.pitch : collective + cyclic.aft * Math.cos(a) + cyclic.right * Math.sin(a);
      this.pose[i].flap = flap; this.pose[i].pitch = pitch;
      meanFlap += flap / n; forwardFlap += 2 * flap * Math.sin(a) / n; rightFlap += 2 * flap * Math.cos(a) / n; meanPitch += pitch / n;
      // Blade frame: azimuth, the equivalent hinge, flap about it, feathering about the blade axis.
      this.matrix.makeRotationY(i * 2 * Math.PI / n)
        .multiply(this.toHinge)
        .multiply(this.flapM.makeRotationZ(flap))
        .multiply(this.fromHinge)
        .multiply(this.pitchM.makeRotationX(pitch));
      this.rotor.blades.setMatrixAt(i, this.matrix);
      this.cuffs[i].matrix.copy(this.matrix); this.cuffs[i].matrixWorldNeedsUpdate = true;
    }
    this.rotor.blades.instanceMatrix.needsUpdate = true;
    this.group.updateMatrixWorld(true);
    for (let i = 0; i < n; i++) {
      // Horn ball in the blade frame, to the swashplate's rotating ring (AMCS) or the gyro arm (ICS).
      this.b.set(0.47, -0.06, -0.215).applyMatrix4(this.cuffs[i].matrixWorld).applyMatrix4(this.inverse);
      const az = i * 2 * Math.PI / n;
      if (ics) {
        // Gyro arm k (built along blade k's azimuth, turned ahead by the lead in gyroSpin), a third of the way out.
        const r = 0.55;
        this.a.set(r * Math.cos(az), 0, -r * Math.sin(az)).applyMatrix4(this.gyroSpin.matrixWorld).applyMatrix4(this.inverse);
      } else {
        // The rotating ring under the horn (the horn leads the blade axis by about 0.43 rad).
        const t = az + 0.43 + this.rotor.spin.rotation.y;
        this.a.set(0.23 * Math.cos(t), 0.01, -0.23 * Math.sin(t)).applyMatrix4(this.swashplate.matrixWorld).applyMatrix4(this.inverse);
      }
      fitRod(this.links[i], this.a, this.b);
    }
    // The exposure disc and the trail use the same blade solution (mean coning about the hinge, first-harmonic tilt).
    const p = this.rotor.blur.geometry.getAttribute('position');
    if (meanFlap !== this.blurCone) {
      for (let k = 0; k < p.count; k++) {
        const x = this.rotor.discPositions[3 * k], z = this.rotor.discPositions[3 * k + 2], radius = Math.hypot(x, z);
        const projected = e + (radius - e) * Math.cos(meanFlap);
        p.setXYZ(k, x * projected / radius, (radius - e) * Math.sin(meanFlap), z * projected / radius);
      }
      p.needsUpdate = true; this.rotor.blur.geometry.computeVertexNormals(); this.rotor.blur.geometry.computeBoundingSphere();
      this.blurCone = meanFlap;
    }
    this.tilt.set(-Math.tan(rightFlap), 1, Math.tan(forwardFlap)).normalize();
    this.rotor.blur.quaternion.setFromUnitVectors(this.up, this.tilt);
    this.inverseSpin.copy(this.rotor.spin.quaternion).invert();
    const trail = this.rotor.trail.mesh;
    trail.quaternion.copy(this.inverseSpin).multiply(this.rotor.blur.quaternion).multiply(this.rotor.spin.quaternion);
    trail.position.set(0, 0, 0);
    this.rotor.trail.update(bladeBlur(state.rotorRpm, n), meanPitch, meanFlap, e);
  }
}

/** Four-blade teetering tail rotor (P: 10 ft, 4 blades, left stabiliser tip, hub BL 72 L, clockwise seen from the left)
 *  built on the shared blade/blur renderer with its own hub: two teetering yokes crossed at 90 deg and the grips. */
export class AH56TailRotor {
  readonly rotor: TeeteringRotor;
  constructor(m: AH56Materials) {
    // The 'articulated' branch of TeeteringRotor builds only its own placeholder hub; no aircraft materials are read.
    this.rotor = new TeeteringRotor({ radius: D.TAIL_ROTOR_RADIUS, root: 0.20, chord: [D.TAIL_ROTOR_CHORD, D.TAIL_ROTOR_CHORD], twist: 0, tail: true,
      blades: D.TAIL_ROTOR_BLADES, rotation: -1, hubType: 'articulated', paint: TAIL_PAINT }, {} as AircraftMaterials);
    const r = this.rotor;
    r.group.name = 'ah56TailRotor';
    for (const child of r.spin.children) if (child !== r.blades && child !== r.trail.mesh) child.visible = false;
    r.group.position.copy(frd(D.TAIL_HUB.x, D.TAIL_HUB.y, D.TAIL_HUB.z)); r.group.rotation.z = Math.PI / 2;
    // In the spin frame three.js Y is the rotor shaft pointing outboard (left of the stabiliser tip).
    const head = new MeshBatch();
    head.add(m.cast, new THREE.CylinderGeometry(0.075, 0.075, 0.12, 24));
    for (const [k, y] of [[0, 0.03], [1, -0.03]] as const) {
      const yoke = new THREE.BoxGeometry(0.40, 0.04, 0.09).rotateY(k * Math.PI / 2).translate(0, y, 0);
      head.add(m.cast, yoke);
    }
    head.add(m.metal, new THREE.CylinderGeometry(0.03, 0.03, 0.08, 12).translate(0, 0.10, 0));
    for (let k = 0; k < 4; k++) {
      const g = new THREE.CylinderGeometry(0.035, 0.035, 0.12, 14).rotateZ(Math.PI / 2).translate(0.21, 0, 0);
      head.add(m.cast, g.rotateY(k * Math.PI / 2));
    }
    r.spin.add(head.build('ah56TailHub'));
  }

  update(state: RotorcraftState, rudder: number, rotation: number): void {
    const pitch = THREE.MathUtils.lerp(TAIL_PITCH.min, TAIL_PITCH.max, (1 - rudder * rotation) / 2);
    this.rotor.update(-state.azimuth * AH56_TAIL_RATIO, state.rotorRpm * AH56_TAIL_RATIO, pitch, 0);
  }

  dispose(): void {
    this.rotor.group.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
    this.rotor.dispose();
  }
}

/**
 * Three-blade Hamilton Standard pusher (P: 10 ft, 3 blades, AF 142, counter-clockwise seen from behind, hub FS 675.7,
 * WL 114.5) with its spinner. With a pusher state (def.pusher exists; the dev page's pitch=) the blades sit at
 * state.pusher.beta (at 0.7 R) and spin at rotor rpm x 6.980; without one they stand stopped and feathered.
 */
export class AH56Pusher {
  readonly group = new THREE.Group();
  readonly spin = new THREE.Group();
  readonly blades: THREE.Group[] = [];
  readonly disc: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  private readonly bladeMaterial: THREE.MeshStandardMaterial;
  private readonly tipMaterial: THREE.MeshStandardMaterial;
  readonly materials: THREE.Material[] = [];
  /** Blade angle at 0.7 R and rpm last drawn. */
  beta = PUSHER_FEATHER;
  rpm = 0;

  constructor(m: AH56Materials) {
    this.group.name = 'ah56Pusher'; this.spin.name = 'ah56PusherSpin';
    this.group.position.copy(frd(D.PUSHER_HUB.x, D.PUSHER_HUB.y, D.PUSHER_HUB.z));
    this.group.add(this.spin);
    this.bladeMaterial = new THREE.MeshStandardMaterial({ name: 'ah56PusherBlade', color: 0x22241f, roughness: 0.55, transparent: true });
    this.tipMaterial = new THREE.MeshStandardMaterial({ name: 'ah56PusherTip', color: 0xd9b52a, roughness: 0.5, transparent: true });
    this.materials.push(this.bladeMaterial, this.tipMaterial);
    const R = D.PUSHER_RADIUS, tipBand = 0.15;
    for (let k = 0; k < D.PUSHER_BLADES; k++) {
      const arm = new THREE.Group(); arm.rotation.z = k * 2 * Math.PI / D.PUSHER_BLADES;
      const pitch = new THREE.Group(); pitch.name = 'ah56PusherBladePitch'; arm.add(pitch);
      const parts = new MeshBatch();
      parts.add(this.bladeMaterial, pusherBlade(PUSHER_BLADE.root, R - tipBand));
      parts.add(this.tipMaterial, pusherBlade(R - tipBand, R));
      parts.add(m.metal, new THREE.CylinderGeometry(0.045, 0.05, 0.10, 16).translate(0, PUSHER_BLADE.root + 0.02, 0));
      pitch.add(parts.build(`ah56PusherBlade${k}`));
      this.spin.add(arm); this.blades.push(pitch);
    }
    // Spinner over the hub (body of revolution along x, local to the hub).
    const hubX = D.PUSHER_HUB.x, sp = new MeshBatch();
    const prof = [[SPINNER.baseFs, 1.0], [SPINNER.baseFs + 4, 1.0], [675.7, 0.93], [679, 0.78], [682, 0.56], [684.5, 0.3], [SPINNER.tipFs, 0]]
      .map(([s, f]) => [fs(s) - hubX, f * SPINNER.radiusIn * 0.0254] as const);
    sp.add(m.paintDark, revolve(prof, 0, 0, 32));
    this.spin.add(sp.build('ah56Spinner'));
    // Blur disc for a turning prop.
    const disc = new THREE.RingGeometry(PUSHER_BLADE.root, R, 48, 2);
    this.disc = new THREE.Mesh(disc, new THREE.MeshStandardMaterial({ name: 'ah56PusherDisc', color: 0x2a2b26, transparent: true, opacity: 0,
      depthWrite: false, side: THREE.DoubleSide, roughness: 0.8 }));
    this.disc.name = 'ah56PusherDisc'; this.disc.renderOrder = 1; this.group.add(this.disc);
    this.materials.push(this.disc.material);
    this.update();
  }

  /** beta: blade angle at 0.7 R, rad (undefined: feathered and stopped); rotorAzimuth, rotorRpm: the main rotor's. */
  update(beta?: number, rotorAzimuth = 0, rotorRpm = 0, ratio = AH56_PROP_RATIO): void {
    const turning = beta !== undefined;
    this.beta = turning ? beta : PUSHER_FEATHER;
    this.rpm = turning ? rotorRpm * ratio : 0;
    // Counter-clockwise seen from behind: positive about three.js +Z (the axis pointing aft).
    this.spin.rotation.z = turning ? rotorAzimuth * ratio : 0;
    for (const b of this.blades) b.rotation.y = -this.beta;
    const blur = bladeBlur(this.rpm, D.PUSHER_BLADES);
    this.bladeMaterial.opacity = this.tipMaterial.opacity = blur.solid;
    this.bladeMaterial.depthWrite = this.tipMaterial.depthWrite = blur.solid === 1;
    for (const b of this.blades) b.visible = blur.solid > 0;
    this.disc.material.opacity = 0.35 * Math.max(blur.disc, blur.trail * 0.6);
    this.disc.visible = this.disc.material.opacity > 0;
  }

  dispose(): void {
    this.group.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
    this.materials.forEach(x => x.dispose());
  }
}

/** One pusher blade between radii r0 and r1 in the blade frame: radial along +Y, the chord along -X (leading edge, the
 *  rotation direction) at zero blade angle at 0.7 R, built-in twist, thickness along Z (the pressure face aft). */
export function pusherBlade(r0: number, r1: number, rows = 12, cols = 21): THREE.BufferGeometry {
  const R = D.PUSHER_RADIUS, c = PUSHER_BLADE.chord;
  const g = gridGeometry({ rows, cols, wrap: true,
    position(i, j, out) {
      const r = THREE.MathUtils.lerp(r0, r1, i / (rows - 1)), f = r / R;
      const twist = PUSHER_BLADE.twistDeg * DEG * (0.7 - f);
      const a = j / (cols - 1) * Math.PI * 2, xc = (1 - Math.cos(a)) / 2, face = a <= Math.PI ? 1 : -1;
      // Rounded tip and narrower root shank.
      const chord = c * Math.min(1, Math.sqrt(Math.max(0.05, (R - r) / 0.10))) * THREE.MathUtils.lerp(0.55, 1, THREE.MathUtils.smoothstep(r, PUSHER_BLADE.root, 0.4));
      const tc = THREE.MathUtils.lerp(PUSHER_BLADE.tc.root, PUSHER_BLADE.tc.tip, f);
      const along = (0.3 - xc) * chord, thick = face * nacaThickness(tc, xc) * chord;
      // Chord direction at zero blade angle: -X (LE), thickness along +Z; twist turns the LE toward -Z (forward).
      out.set(-along * Math.cos(twist) - thick * Math.sin(twist), r, -along * Math.sin(twist) + thick * Math.cos(twist));
    } });
  return g;
}

