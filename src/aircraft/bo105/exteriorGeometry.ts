// MBB Bo 105 CB-4 detail helpers: materials, the bent-blade law of the hingeless head, and the shared loft-following
// helpers (re-exported from the MD 500E's pure module, which imports no aircraft file). FRD metres. Decoration never
// supplies contact or aerodynamic geometry: everything the physics reads stays in dimensions.ts.
import * as THREE from 'three';

export { aerofoilPanel, centreStrip, ellipsoid, fairedStrut, fairingLoft, fitRod, ringPoint, roundedLoop, skinPath,
  type MD500Section as Bo105Section, type MD500SkinWidth as Bo105SkinWidth } from '../md500/exteriorGeometry';

export function bo105Materials() {
  const make = (name: string, color: number, roughness: number, metalness = 0) =>
    new THREE.MeshStandardMaterial({ name: `bo105${name}`, color, roughness, metalness });
  return {
    paint: make('Paint', 0xeff0ec, 0.32), band: make('Band', 0x182a5c, 0.36), red: make('Red', 0xb22628, 0.42),
    frame: make('Frame', 0x222629, 0.55, 0.1), metal: make('Metal', 0x9ca3a5, 0.32, 0.7),
    cast: make('Cast', 0x6b7479, 0.5, 0.35), dark: make('Dark', 0x1d2124, 0.7),
    rubber: make('Rubber', 0x151719, 0.9), seat: make('Seat', 0x56606d, 0.88), seatTrim: make('SeatTrim', 0x8f979c, 0.6, 0.2),
    exhaust: make('Exhaust', 0x5e554c, 0.62, 0.35), soot: make('Soot', 0x191714, 0.95),
    grey: make('Grey', 0x8a9095, 0.45, 0.2), lens: make('Lens', 0xdfe6ea, 0.08, 0.4), orange: make('Orange', 0xd65f2f, 0.5),
    // Titanium hub star and the black-painted feathering housings, the light grey-blue blade forks (rotor-head photo).
    titanium: make('Titanium', 0x3b3f43, 0.42, 0.55), housing: make('Housing', 0x24272a, 0.5, 0.2),
    fork: make('Fork', 0x9aa4b2, 0.4, 0.4), blade: make('Blade', 0x6e7376, 0.5, 0.05),
    grille: make('Grille', 0x2c3033, 0.8, 0.3), switchBlack: make('SwitchBlack', 0x111214, 0.6),
  };
}
export type Bo105Materials = ReturnType<typeof bo105Materials>;

/** The bend region of a hingeless blade: it starts at the equivalent hinge offset `e` and runs `length` outboard. */
export interface BladeBend { e: number; length: number }

const sinc = (a: number): number => (Math.abs(a) < 1e-4 ? 1 - a * a / 6 : Math.sin(a) / a);
const cosc = (a: number): number => (Math.abs(a) < 1e-4 ? a / 2 - a * a * a / 24 : (1 - Math.cos(a)) / a);

/**
 * The bent blade axis at radius r in the blade's azimuth frame (three.js: +X out along the blade, +Y up), for a total
 * flap (slope) `beta`: rigid (on the hub plane) inboard of `e`, a circular arc of constant curvature over
 * [e, e + length] whose slope grows from 0 to beta, then straight at slope beta. Writes [x, y, slope] into `out`.
 * No hinge: the slope is continuous everywhere.
 */
export function bentAxis(r: number, beta: number, bend: BladeBend, out: [number, number, number]): [number, number, number] {
  if (r <= bend.e) { out[0] = r; out[1] = 0; out[2] = 0; return out; }
  const s = Math.min(r - bend.e, bend.length), a = beta * s / bend.length;
  let x = bend.e + s * sinc(a), y = s * cosc(a);
  const rest = r - bend.e - bend.length;
  if (rest > 0) { x += rest * Math.cos(beta); y += rest * Math.sin(beta); }
  out[0] = x; out[1] = y; out[2] = s < bend.length ? a : beta;
  return out;
}

/** Where the straight outboard blade, extended inboard, crosses the hub plane: e + (L / beta) tan(beta / 2) (e + L/2
 *  as beta -> 0). The disc and trail use it as their virtual hinge. */
export function virtualHinge(beta: number, bend: BladeBend): number {
  return bend.e + bend.length * (Math.abs(beta) < 1e-4 ? 0.5 + beta * beta / 24 : Math.tan(beta / 2) / beta);
}

const axisTmp: [number, number, number] = [0, 0, 0];
/**
 * Rigid transform of the outboard blade (radius >= e + length) in the azimuth frame: a blade-local point (r, y, z) at
 * feathering `pitch` goes to bentAxis(r0) + Rz(beta) Rx(pitch) (r - r0, y, z), r0 = the start of the straight part.
 */
export function outboardBladeMatrix(beta: number, pitch: number, bend: BladeBend, out: THREE.Matrix4): THREE.Matrix4 {
  const r0 = bend.e + bend.length;
  bentAxis(r0, beta, bend, axisTmp);
  const c = Math.cos(beta), s = Math.sin(beta), cp = Math.cos(pitch), sp = Math.sin(pitch);
  // Rz(beta) * Rx(pitch), then translate so that (r0, 0, 0) lands on the axis point.
  out.set(
    c, -s * cp, s * sp, 0,
    s, c * cp, -c * sp, 0,
    0, sp, cp, 0,
    0, 0, 0, 1);
  out.elements[12] = axisTmp[0] - c * r0; out.elements[13] = axisTmp[1] - s * r0; out.elements[14] = 0;
  return out;
}

/**
 * A blade root ("neck") that bends: a lofted shank from the fork (r0) into the aerofoil root (r1), its section going
 * from a flattened ellipse to the blade's chord, thickness, chordwise position and twist at the root. `pose` moves
 * the vertices (pitch about the blade axis, then the bend), the outboard end landing exactly on the rigid blade.
 */
export class BendingNeck {
  readonly geometry: THREE.BufferGeometry;
  private readonly rest: Float32Array;
  private readonly position: THREE.BufferAttribute;
  private readonly axis: [number, number, number] = [0, 0, 0];
  private lastBeta = NaN;
  private lastPitch = NaN;

  constructor(r0: number, r1: number, root: { chord: number; thickness: number; twist: number }, rows = 26, cols = 25,
    shank = { halfChord: 0.045, halfThickness: 0.030 }) {
    const positions: number[] = [], index: number[] = [];
    for (let i = 0; i < rows; i++) {
      const t = i / (rows - 1), r = THREE.MathUtils.lerp(r0, r1, t), k = Math.pow(THREE.MathUtils.smoothstep(t, 0, 1), 1.2);
      const halfChord = THREE.MathUtils.lerp(shank.halfChord, root.chord / 2, k);
      const halfThick = THREE.MathUtils.lerp(shank.halfThickness, root.thickness / 2, k);
      // Mid-chord: on the feathering axis at the fork, a quarter chord aft of it at the aerofoil root (rotor.ts puts the
      // quarter chord on the axis); the leading edge faces local -Z (the rotor turns +X towards -Z).
      const alongCentre = THREE.MathUtils.lerp(0, -root.chord / 4, k), twist = root.twist * k;
      const st = Math.sin(twist), ct = Math.cos(twist);
      for (let j = 0; j < cols; j++) {
        const a = j / cols * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
        const along = alongCentre + halfChord * Math.sign(ca) * Math.pow(Math.abs(ca), 2 / 2.6);
        const thick = halfThick * Math.sign(sa) * Math.pow(Math.abs(sa), 2 / 2.6);
        // Section frame as rotorBladeGeometry: y = along sin + thick cos, z = -along cos + thick sin.
        positions.push(r, along * st + thick * ct, -along * ct + thick * st);
      }
    }
    for (let i = 0; i < rows - 1; i++) for (let j = 0; j < cols; j++) {
      const a = i * cols + j, b = i * cols + (j + 1) % cols, c = a + cols, d = b + cols;
      index.push(a, b, c, b, d, c);
    }
    // End caps (fans to the section centres).
    for (const [row, flip] of [[0, true], [rows - 1, false]] as const) {
      let cx = 0, cy = 0, cz = 0;
      for (let j = 0; j < cols; j++) { cx += positions[3 * (row * cols + j)]; cy += positions[3 * (row * cols + j) + 1]; cz += positions[3 * (row * cols + j) + 2]; }
      const centre = positions.length / 3; positions.push(cx / cols, cy / cols, cz / cols);
      for (let j = 0; j < cols; j++) {
        const a = row * cols + j, b = row * cols + (j + 1) % cols;
        index.push(...(flip ? [centre, b, a] : [centre, a, b]));
      }
    }
    this.rest = new Float32Array(positions);
    this.geometry = new THREE.BufferGeometry();
    this.position = new THREE.BufferAttribute(new Float32Array(positions), 3);
    this.position.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('position', this.position); this.geometry.setIndex(index);
    this.geometry.computeVertexNormals();
  }

  /** Pose: feathering `pitch` about the blade axis, then the flap bend `beta` over `bend`. */
  pose(beta: number, pitch: number, bend: BladeBend): void {
    if (beta === this.lastBeta && pitch === this.lastPitch) return;
    const cp = Math.cos(pitch), sp = Math.sin(pitch), p = this.position.array as Float32Array, rest = this.rest;
    for (let i = 0; i < rest.length; i += 3) {
      const r = rest[i], y = rest[i + 1] * cp - rest[i + 2] * sp, z = rest[i + 1] * sp + rest[i + 2] * cp;
      bentAxis(r, beta, bend, this.axis);
      const a = this.axis[2];
      p[i] = this.axis[0] - y * Math.sin(a); p[i + 1] = this.axis[1] + y * Math.cos(a); p[i + 2] = z;
    }
    this.position.needsUpdate = true;
    this.geometry.computeVertexNormals(); this.geometry.computeBoundingSphere();
    this.lastBeta = beta; this.lastPitch = pitch;
  }
}
