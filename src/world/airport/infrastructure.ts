// Procedural 3D meshes and ICAO obstruction lighting for high-tension power transmission lines (galvanised lattice
// suspension & angle/strain pylons, ceramic insulators, 7-wire ACSR catenary conductors, orange aerial marker balls,
// switching substations) and algorithmic radio masts (tall red/white banded guyed broadcast masts and self-supporting
// lattice microwave/cellular relay towers).
//
// Draw-call budget across the entire 40 km x 40 km region:
//   1. `infra-pylons-suspension`  InstancedMesh of double-circuit suspension pylons
//   2. `infra-pylons-strain`      InstancedMesh of heavy angle / dead-end strain pylons
//   3. `infra-structures`         Merged vertex-coloured solid structures (masts, dishes, huts, substations, marker balls)
//   4. `infra-cables`             Merged 3D catenary conductors, overhead earth wires & mast guy wires
//   + 0 extra draw calls for obstruction lights (returned as LightSpec[] for AirportSystem's single HDR point batch).

import * as THREE from 'three';
import { nedToThree } from '../../core/frames';
import {
  planInfrastructure,
  PYLON_LOWEST_INSULATOR_FRAC,
  PYLON_REF_HEIGHT,
  type HeightFn,
  type InfrastructurePlan,
  type PylonKind,
  type PylonSite,
} from './infrastructurePlan';
import { LIGHT_COLORS, type LightSpec } from './lights';

export interface InfrastructureResult {
  group: THREE.Group;
  lights: LightSpec[];
  materials: THREE.Material[];
  plan: InfrastructurePlan;
}

const UP = new THREE.Vector3(0, 1, 0);

/** Cross-arm geometry on the reference 34 m double-circuit tower: [lateral offset m, height fraction of H]. */
const PYLON_ARMS: readonly [number, number][] = [
  [4.9, 0.595], // lower cross-arm tip (insulator hangs down to PYLON_LOWEST_INSULATOR_FRAC = 0.54)
  [5.7, 0.735], // middle cross-arm tip
  [4.3, 0.875], // upper cross-arm tip
];
const INSULATOR_DROP_FRAC = PYLON_ARMS[0][1] - PYLON_LOWEST_INSULATOR_FRAC; // 0.055 * H (~1.87 m string)

/** Push a coloured strut (4-sided or N-sided prism) between 3D points `a` and `b` into raw position/normal/color arrays. */
class SolidBuilder {
  readonly pos: number[] = [];
  readonly nor: number[] = [];
  readonly col: number[] = [];

  private readonly u = new THREE.Vector3();
  private readonly v = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();
  private readonly nrm = new THREE.Vector3();

  strut(a: THREE.Vector3, b: THREE.Vector3, rA: number, rB: number, sides: number, color: THREE.Color, cap = false): void {
    this.dir.subVectors(b, a);
    const len = this.dir.length();
    if (len < 1e-5) return;
    this.dir.multiplyScalar(1 / len);
    if (Math.abs(this.dir.y) < 0.92) this.u.crossVectors(this.dir, UP).normalize();
    else this.u.set(1, 0, 0).cross(this.dir).normalize();
    this.v.crossVectors(this.dir, this.u).normalize();

    const step = (Math.PI * 2) / sides;
    for (let i = 0; i < sides; i++) {
      const p0 = i * step + Math.PI / sides;
      const p1 = (i + 1) * step + Math.PI / sides;
      const c0 = Math.cos(p0), s0 = Math.sin(p0);
      const c1 = Math.cos(p1), s1 = Math.sin(p1);
      const cm = Math.cos((p0 + p1) * 0.5), sm = Math.sin((p0 + p1) * 0.5);

      const ax0 = a.x + (this.u.x * c0 + this.v.x * s0) * rA;
      const ay0 = a.y + (this.u.y * c0 + this.v.y * s0) * rA;
      const az0 = a.z + (this.u.z * c0 + this.v.z * s0) * rA;

      const ax1 = a.x + (this.u.x * c1 + this.v.x * s1) * rA;
      const ay1 = a.y + (this.u.y * c1 + this.v.y * s1) * rA;
      const az1 = a.z + (this.u.z * c1 + this.v.z * s1) * rA;

      const bx0 = b.x + (this.u.x * c0 + this.v.x * s0) * rB;
      const by0 = b.y + (this.u.y * c0 + this.v.y * s0) * rB;
      const bz0 = b.z + (this.u.z * c0 + this.v.z * s0) * rB;

      const bx1 = b.x + (this.u.x * c1 + this.v.x * s1) * rB;
      const by1 = b.y + (this.u.y * c1 + this.v.y * s1) * rB;
      const bz1 = b.z + (this.u.z * c1 + this.v.z * s1) * rB;

      this.nrm.set(this.u.x * cm + this.v.x * sm, this.u.y * cm + this.v.y * sm, this.u.z * cm + this.v.z * sm).normalize();
      this.quad(ax0, ay0, az0, ax1, ay1, az1, bx1, by1, bz1, bx0, by0, bz0, this.nrm, color);

      if (cap) {
        this.tri(a.x, a.y, a.z, ax1, ay1, az1, ax0, ay0, az0, this.dir.clone().negate(), color);
        this.tri(b.x, b.y, b.z, bx0, by0, bz0, bx1, by1, bz1, this.dir, color);
      }
    }
  }

  /** Oriented box centred at `center`, rotated by `heading` (true bearing, rad) about +Y, dimensions `(wX, hY, dZ)`. */
  orientedBox(center: THREE.Vector3, wX: number, hY: number, dZ: number, heading: number, color: THREE.Color): void {
    const ch = Math.cos(heading), sh = Math.sin(heading);
    // right = (cos h, 0, sin h), fwd = (sin h, 0, -cos h)
    const rx = ch * (wX * 0.5), rz = sh * (wX * 0.5);
    const fx = sh * (dZ * 0.5), fz = -ch * (dZ * 0.5);
    const hy = hY * 0.5;
    const pt = (sx: number, sy: number, sz: number): [number, number, number] => [
      center.x + sx * rx + sz * fx,
      center.y + sy * hy,
      center.z + sx * rz + sz * fz,
    ];
    const faces: [readonly [number, number, number][], THREE.Vector3][] = [
      [[[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]], new THREE.Vector3(sh, 0, -ch)],
      [[[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]], new THREE.Vector3(-sh, 0, ch)],
      [[[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]], new THREE.Vector3(ch, 0, sh)],
      [[[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]], new THREE.Vector3(-ch, 0, -sh)],
      [[[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]], new THREE.Vector3(0, 1, 0)],
    ];
    for (const [corners, n] of faces) {
      const [p0, p1, p2, p3] = corners.map(([sx, sy, sz]) => pt(sx, sy, sz));
      this.quad(p0[0], p0[1], p0[2], p1[0], p1[1], p1[2], p2[0], p2[1], p2[2], p3[0], p3[1], p3[2], n, color);
    }
  }

  /** Low-poly icosahedral/octahedral marker sphere at `center`. */
  markerSphere(center: THREE.Vector3, radius: number, color: THREE.Color): void {
    const rings = 5;
    const segs = 8;
    for (let r = 0; r < rings; r++) {
      const t0 = (r / rings) * Math.PI;
      const t1 = ((r + 1) / rings) * Math.PI;
      const y0 = Math.cos(t0), sr0 = Math.sin(t0);
      const y1 = Math.cos(t1), sr1 = Math.sin(t1);
      for (let s = 0; s < segs; s++) {
        const a0 = (s / segs) * Math.PI * 2;
        const a1 = ((s + 1) / segs) * Math.PI * 2;
        const v00 = new THREE.Vector3(sr0 * Math.cos(a0), y0, sr0 * Math.sin(a0));
        const v10 = new THREE.Vector3(sr0 * Math.cos(a1), y0, sr0 * Math.sin(a1));
        const v11 = new THREE.Vector3(sr1 * Math.cos(a1), y1, sr1 * Math.sin(a1));
        const v01 = new THREE.Vector3(sr1 * Math.cos(a0), y1, sr1 * Math.sin(a0));
        this.nrm.copy(v00).add(v11).normalize();
        this.quad(
          center.x + v00.x * radius, center.y + v00.y * radius, center.z + v00.z * radius,
          center.x + v10.x * radius, center.y + v10.y * radius, center.z + v10.z * radius,
          center.x + v11.x * radius, center.y + v11.y * radius, center.z + v11.z * radius,
          center.x + v01.x * radius, center.y + v01.y * radius, center.z + v01.z * radius,
          this.nrm,
          color,
        );
      }
    }
  }

  private tri(
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
    cx: number, cy: number, cz: number,
    n: THREE.Vector3,
    c: THREE.Color,
  ): void {
    this.pos.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    for (let k = 0; k < 3; k++) {
      this.nor.push(n.x, n.y, n.z);
      this.col.push(c.r, c.g, c.b);
    }
  }

  private quad(
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
    cx: number, cy: number, cz: number,
    dx: number, dy: number, dz: number,
    n: THREE.Vector3,
    c: THREE.Color,
  ): void {
    this.tri(ax, ay, az, bx, by, bz, cx, cy, cz, n, c);
    this.tri(ax, ay, az, cx, cy, cz, dx, dy, dz, n, c);
  }

  build(): THREE.BufferGeometry | null {
    if (this.pos.length === 0) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    return g;
  }
}

const STEEL_GALV = new THREE.Color(0x9ca4aa);
const STEEL_DARK = new THREE.Color(0x6c7378);
const CONCRETE_COL = new THREE.Color(0x9c988e);
const INSULATOR_GLASS = new THREE.Color(0x52807a);
const HAZARD_RED = new THREE.Color(0xc92a1e);
const HAZARD_WHITE = new THREE.Color(0xeeece6);
const MARKER_ORANGE = new THREE.Color(0xe84814);
const RADOME_WHITE = new THREE.Color(0xf0efe8);
const CABIN_WALL = new THREE.Color(0xb6bab8);
const CABIN_ROOF = new THREE.Color(0x4e5458);
const CABLE_ACSR = new THREE.Color(0x3a3e42);
const GUY_WIRE_COL = new THREE.Color(0x565c62);

/**
 * Build the unit-reference (H = PYLON_REF_HEIGHT = 34 m) double-circuit high-tension steel lattice tower geometry:
 *   local +X = right cross-arm, local +Y = up from tower ground level, local -Z = forward along transmission line.
 * Concrete pier footings extend down to y = -3.8 m so all 4 legs remain anchored on hillsides.
 */
function buildPylonTemplate(kind: PylonKind): THREE.BufferGeometry {
  const b = new SolidBuilder();
  const H = PYLON_REF_HEIGHT;
  const heavy = kind === 'strain';
  const baseHalf = heavy ? 3.65 : 3.05;
  const waistY = H * 0.54;
  const waistHalf = heavy ? 1.45 : 1.18;
  const topCageHalf = heavy ? 1.05 : 0.85;
  const cageTopY = H * 0.9;
  const legR = heavy ? 0.13 : 0.1;
  const braceR = heavy ? 0.065 : 0.052;

  const halfAt = (y: number): number => {
    if (y <= waistY) return baseHalf + (waistHalf - baseHalf) * (y / waistY);
    if (y <= cageTopY) return waistHalf + (topCageHalf - waistHalf) * ((y - waistY) / (cageTopY - waistY));
    return topCageHalf * Math.max(0, 1 - (y - cageTopY) / (H - cageTopY));
  };

  const corners: readonly [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  const cornerPt = (y: number, c: readonly [number, number]) => {
    const r = halfAt(Math.max(0, y));
    // Slope legs continue outward below y = 0 so foundations seat cleanly into sloped ground.
    const rFoot = y < 0 ? baseHalf + ((baseHalf - waistHalf) / waistY) * -y : r;
    return new THREE.Vector3(c[0] * rFoot, y, c[1] * rFoot);
  };

  // 4 concrete footings (-3.8 m .. +0.65 m) + 4 main steel angle legs (0 .. cageTopY) + pyramid peak (cageTopY .. H).
  const peak = new THREE.Vector3(0, H, 0);
  for (let i = 0; i < 4; i++) {
    const c = corners[i];
    b.strut(cornerPt(-3.8, c), cornerPt(0.65, c), 0.34, 0.28, 6, CONCRETE_COL, true);
    b.strut(cornerPt(0, c), cornerPt(waistY, c), legR * 1.15, legR, 4, STEEL_GALV);
    b.strut(cornerPt(waistY, c), cornerPt(cageTopY, c), legR, legR * 0.88, 4, STEEL_GALV);
    b.strut(cornerPt(cageTopY, c), peak, legR * 0.85, legR * 0.65, 4, STEEL_GALV);
  }

  // X-braced lattice bays from y = 0 up to cageTopY.
  const levels = [0, 4.4, 8.8, 13.4, waistY, 21.8, 25.4, 28.6, cageTopY];
  for (let li = 0; li < levels.length - 1; li++) {
    const y0 = levels[li];
    const y1 = levels[li + 1];
    for (let i = 0; i < 4; i++) {
      const cA = corners[i];
      const cB = corners[(i + 1) % 4];
      const a0 = cornerPt(y0, cA), b0 = cornerPt(y0, cB);
      const a1 = cornerPt(y1, cA), b1 = cornerPt(y1, cB);
      b.strut(a1, b1, braceR * 0.9, braceR * 0.9, 4, STEEL_DARK);
      b.strut(a0, b1, braceR, braceR, 4, STEEL_GALV);
      b.strut(b0, a1, braceR, braceR, 4, STEEL_GALV);
    }
  }

  // Three pairs of tapered triangular steel cross-arms + toughened glass insulator strings.
  const insDrop = INSULATOR_DROP_FRAC * H;
  for (const [armSpan, frac] of PYLON_ARMS) {
    const yArm = frac * H;
    const bodyHalf = halfAt(yArm);
    for (const side of [-1, 1] as const) {
      const tip = new THREE.Vector3(side * armSpan, yArm, 0);
      // Lower horizontal chords (front & rear of tower cage) + upper tie chord from yArm + 1.45 m.
      b.strut(new THREE.Vector3(side * bodyHalf, yArm, -bodyHalf * 0.85), tip, 0.08, 0.055, 4, STEEL_GALV);
      b.strut(new THREE.Vector3(side * bodyHalf, yArm, bodyHalf * 0.85), tip, 0.08, 0.055, 4, STEEL_GALV);
      const upperRoot = new THREE.Vector3(side * halfAt(yArm + 1.5), yArm + 1.5, 0);
      b.strut(upperRoot, tip, 0.065, 0.05, 4, STEEL_DARK);
      // Internal cross-arm web brace.
      const midX = side * (bodyHalf + (armSpan - bodyHalf) * 0.52);
      b.strut(new THREE.Vector3(midX, yArm, -bodyHalf * 0.42), new THREE.Vector3(midX, yArm + 0.72, 0), 0.042, 0.042, 4, STEEL_DARK);
      b.strut(new THREE.Vector3(midX, yArm, bodyHalf * 0.42), new THREE.Vector3(midX, yArm + 0.72, 0), 0.042, 0.042, 4, STEEL_DARK);

      if (heavy) {
        // Strain/angle tower: twin fore/aft horizontal tension insulator strings + jumper suspension drop!
        const jumpTip = new THREE.Vector3(side * armSpan, yArm - insDrop, 0);
        for (const dz of [-1, 1] as const) {
          const deadEnd = new THREE.Vector3(side * armSpan, yArm - insDrop * 0.35, dz * 1.45);
          b.strut(tip, deadEnd, 0.13, 0.13, 6, INSULATOR_GLASS, true);
          b.strut(deadEnd, jumpTip, 0.04, 0.04, 4, CABLE_ACSR);
        }
        b.strut(tip, jumpTip, 0.1, 0.1, 6, INSULATOR_GLASS, true);
      } else {
        // Suspension tower: vertical glass/porcelain disc insulator string hanging to yArm - insDrop.
        const insBottom = new THREE.Vector3(side * armSpan, yArm - insDrop, 0);
        b.strut(tip, insBottom, 0.13, 0.13, 6, INSULATOR_GLASS, true);
      }
    }
  }

  // Earth-wire peak finial.
  b.strut(peak, new THREE.Vector3(0, H + 0.7, 0), 0.07, 0.03, 4, STEEL_GALV);
  return b.build()!;
}

/** Compute the exact world-space conductor attachment point on `pylon` for cross-arm `armIdx` (-1 left, +1 right) or top earth wire. */
function pylonAttachWorld(pylon: PylonSite, armIdx: number, side: -1 | 0 | 1, out = new THREE.Vector3()): THREE.Vector3 {
  const scaleY = pylon.height / PYLON_REF_HEIGHT;
  const base = nedToThree({ x: pylon.north, y: pylon.east, z: -pylon.ground }, out);
  if (side === 0) {
    base.y += (PYLON_REF_HEIGHT + 0.55) * scaleY;
    return base;
  }
  const [armSpan, frac] = PYLON_ARMS[armIdx];
  const yLocal = (frac - INSULATOR_DROP_FRAC) * pylon.height;
  // right vector for true heading `h`: (cos h, 0, sin h)
  base.x += Math.cos(pylon.heading) * (side * armSpan);
  base.y += yLocal;
  base.z += Math.sin(pylon.heading) * (side * armSpan);
  return base;
}

/** Add a catenary cable with `segs` subdivisions between world points `a` and `b` into `cables`. */
function addCatenary(
  cables: SolidBuilder,
  a: THREE.Vector3,
  b: THREE.Vector3,
  sag: number,
  radius: number,
  segs: number,
  color: THREE.Color,
): void {
  const p0 = new THREE.Vector3();
  const p1 = new THREE.Vector3();
  for (let i = 0; i < segs; i++) {
    const t0 = i / segs;
    const t1 = (i + 1) / segs;
    p0.lerpVectors(a, b, t0);
    p0.y -= sag * 4 * t0 * (1 - t0);
    p1.lerpVectors(a, b, t1);
    p1.y -= sag * 4 * t1 * (1 - t1);
    cables.strut(p0, p1, radius, radius, 3, color);
  }
}

export function buildInfrastructure(heightAt: HeightFn): InfrastructureResult {
  const plan = planInfrastructure(heightAt);
  const group = new THREE.Group();
  group.name = 'infrastructure';
  const lights: LightSpec[] = [];

  if (plan.pylons.length === 0 && plan.masts.length === 0) {
    return { group, lights, materials: [], plan };
  }

  const structMat = new THREE.MeshStandardMaterial({
    name: 'infra-steel',
    vertexColors: true,
    roughness: 0.48,
    metalness: 0.62,
  });
  const cableMat = new THREE.MeshStandardMaterial({
    name: 'infra-cables',
    vertexColors: true,
    roughness: 0.55,
    metalness: 0.72,
  });
  const materials: THREE.Material[] = [structMat, cableMat];

  // =========================================================================
  // 1. INSTANCED LATTICE POWER PYLONS (SUSPENSION & STRAIN)
  // =========================================================================
  const suspPylons = plan.pylons.filter((p) => p.kind === 'suspension');
  const strainPylons = plan.pylons.filter((p) => p.kind === 'strain');
  const mat4 = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scale = new THREE.Vector3();

  for (const [list, kind, meshName] of [
    [suspPylons, 'suspension', 'infra-pylons-suspension'],
    [strainPylons, 'strain', 'infra-pylons-strain'],
  ] as const) {
    if (list.length === 0) continue;
    const geo = buildPylonTemplate(kind as PylonKind);
    const im = new THREE.InstancedMesh(geo, structMat.clone(), list.length);
    im.material.name = `${meshName}-mat`;
    materials.push(im.material);
    list.forEach((p, idx) => {
      nedToThree({ x: p.north, y: p.east, z: -p.ground }, pos);
      quat.setFromAxisAngle(UP, -p.heading);
      scale.set(1, p.height / PYLON_REF_HEIGHT, 1);
      im.setMatrixAt(idx, mat4.compose(pos, quat, scale));
      if (p.obstructionLit) {
        const peak = pylonAttachWorld(p, 0, 0, new THREE.Vector3());
        peak.y += 0.35;
        lights.push({
          position: peak,
          colorA: LIGHT_COLORS.red,
          lens: 0.16,
          cd: 325,
          cdDay: 35,
          height: p.height + 0.9,
        });
      }
    });
    im.instanceMatrix.needsUpdate = true;
    im.castShadow = true;
    im.receiveShadow = true;
    im.computeBoundingSphere();
    im.name = meshName;
    group.add(im);
  }

  const solids = new SolidBuilder();
  const cables = new SolidBuilder();

  // =========================================================================
  // 2. 3D CATENARY TRANSMISSION CONDUCTORS, EARTH WIRES & MARKER BALLS
  // =========================================================================
  const aPt = new THREE.Vector3();
  const bPt = new THREE.Vector3();
  const mPt = new THREE.Vector3();
  for (const sp of plan.spans) {
    const p0 = plan.pylons[sp.from];
    const p1 = plan.pylons[sp.to];
    // Ensure left/right circuit sides stay uncrossed even if tower headings point opposite ways (never happens along a
    // directed corridor, but guard with dot product for mathematical certainty).
    const sameSense = Math.cos(p0.heading - p1.heading) >= 0 ? 1 : -1;
    for (let armIdx = 0; armIdx < PYLON_ARMS.length; armIdx++) {
      for (const side of [-1, 1] as const) {
        pylonAttachWorld(p0, armIdx, side, aPt);
        pylonAttachWorld(p1, armIdx, (side * sameSense) as -1 | 1, bPt);
        addCatenary(cables, aPt, bPt, sp.sag, 0.042, 8, CABLE_ACSR);
      }
    }
    // Top lightning shield / earth wire + aviation-orange aerial marker balls on river/long/high spans.
    pylonAttachWorld(p0, 0, 0, aPt);
    pylonAttachWorld(p1, 0, 0, bPt);
    const earthSag = sp.sag * 0.82;
    addCatenary(cables, aPt, bPt, earthSag, 0.028, 8, GUY_WIRE_COL);
    if (sp.markerBalls) {
      const ballCount = Math.max(3, Math.min(7, Math.floor(sp.length / 58)));
      for (let bi = 1; bi <= ballCount; bi++) {
        const t = bi / (ballCount + 1);
        mPt.lerpVectors(aPt, bPt, t);
        mPt.y -= earthSag * 4 * t * (1 - t);
        solids.markerSphere(mPt, 0.48, MARKER_ORANGE);
      }
    }
  }

  // =========================================================================
  // 3. SWITCHING SUBSTATION YARDS AT CORRIDOR TERMINALS
  // =========================================================================
  for (const sub of plan.substations) {
    const ch = Math.cos(sub.heading), sh = Math.sin(sub.heading);
    const atSub = (along: number, across: number, up: number) =>
      nedToThree({
        x: sub.north + along * ch - across * sh,
        y: sub.east + along * sh + across * ch,
        z: -(sub.elevation + up),
      });

    // Gravelled concrete pad sunk 3.5 m into slope so edges never float.
    solids.orientedBox(atSub(0, 0, -1.6), sub.width, 3.6, sub.depth, sub.heading, CONCRETE_COL);
    // Control switch-house + twin power transformers with radiator fins + steel busbar portal gantries.
    solids.orientedBox(atSub(-sub.depth * 0.26, -sub.width * 0.25, 1.9), 7.5, 3.6, 5.2, sub.heading, CABIN_WALL);
    solids.orientedBox(atSub(-sub.depth * 0.26, -sub.width * 0.25, 3.85), 7.9, 0.35, 5.6, sub.heading, CABIN_ROOF);
    for (const tx of [-4.5, 5.5]) {
      solids.orientedBox(atSub(1.5, tx, 2.1), 3.6, 3.8, 4.6, sub.heading, STEEL_DARK);
      for (const bx of [-1.0, 0, 1.0]) {
        solids.strut(atSub(1.5 + bx, tx - 0.8, 4.0), atSub(1.5 + bx, tx - 0.8, 5.8), 0.18, 0.14, 6, INSULATOR_GLASS, true);
        solids.strut(atSub(1.5 + bx, tx + 0.8, 4.0), atSub(1.5 + bx, tx + 0.8, 5.8), 0.18, 0.14, 6, INSULATOR_GLASS, true);
      }
    }
    // Twin H-frame portal gantries facing the outgoing transmission line.
    for (const gz of [-4.5, 6.5]) {
      const pL0 = atSub(gz, -9.5, 0.2), pL1 = atSub(gz, -9.5, 11.5);
      const pR0 = atSub(gz, 9.5, 0.2), pR1 = atSub(gz, 9.5, 11.5);
      solids.strut(pL0, pL1, 0.22, 0.16, 4, STEEL_GALV, true);
      solids.strut(pR0, pR1, 0.22, 0.16, 4, STEEL_GALV, true);
      solids.strut(atSub(gz, -10.5, 10.6), atSub(gz, 10.5, 10.6), 0.18, 0.18, 4, STEEL_GALV, true);
    }
    // Yard security floodlight at night.
    lights.push({
      position: atSub(-sub.depth * 0.2, 0, 9.5),
      colorA: LIGHT_COLORS.metalHalide,
      lens: 0.35,
      cd: 3800,
      cdDay: 0,
      height: 9.5,
    });
  }

  // =========================================================================
  // 4. ALGORITHMIC RADIO & TELECOMMUNICATIONS MASTS
  // =========================================================================
  plan.masts.forEach((m, mi) => {
    const ch = Math.cos(m.heading), sh = Math.sin(m.heading);
    const localToWorld = (lx: number, ly: number, lz: number) =>
      nedToThree({
        x: m.north - lz * ch - lx * sh,
        y: m.east - lz * sh + lx * ch,
        z: -(m.ground + ly),
      });

    if (m.kind === 'guyed') {
      // --- Tall Triangular Guyed Broadcast Mast (108..146 m) in 7 ICAO Red/White Hazard Bands ---
      const H = m.height;
      const spireH = 9.5;
      const bodyH = H - spireH;
      const triR = 1.25;
      const legAngles = [0, (Math.PI * 2) / 3, (Math.PI * 4) / 3];

      // Concrete base pedestal + nearby transmitter equipment cabin.
      solids.strut(localToWorld(0, -3.5, 0), localToWorld(0, 0.8, 0), 2.1, 1.85, 6, CONCRETE_COL, true);
      solids.orientedBox(localToWorld(5.8, -1.2, 2.2), 5.6, 3.2, 4.2, m.heading, CONCRETE_COL);
      solids.orientedBox(localToWorld(5.8, 1.9, 2.2), 5.2, 3.1, 3.8, m.heading, CABIN_WALL);
      solids.orientedBox(localToWorld(5.8, 3.6, 2.2), 5.6, 0.3, 4.2, m.heading, CABIN_ROOF);

      // 7 alternating international orange-red & white bands (starts & ends with red per ICAO Annex 14!).
      const bands = 7;
      const baysPerBand = 5;
      for (let bi = 0; bi < bands; bi++) {
        const col = bi % 2 === 0 ? HAZARD_RED : HAZARD_WHITE;
        const yBand0 = (bi / bands) * bodyH;
        const yBand1 = ((bi + 1) / bands) * bodyH;
        for (let a of legAngles) {
          const lx = Math.cos(a) * triR, lz = Math.sin(a) * triR;
          solids.strut(localToWorld(lx, yBand0, lz), localToWorld(lx, yBand1, lz), 0.11, 0.11, 4, col);
        }
        for (let k = 0; k < baysPerBand; k++) {
          const ya = yBand0 + (k / baysPerBand) * (yBand1 - yBand0);
          const yb = yBand0 + ((k + 1) / baysPerBand) * (yBand1 - yBand0);
          for (let li = 0; li < 3; li++) {
            const a0 = legAngles[li], a1 = legAngles[(li + 1) % 3];
            const p00 = localToWorld(Math.cos(a0) * triR, ya, Math.sin(a0) * triR);
            const p10 = localToWorld(Math.cos(a1) * triR, ya, Math.sin(a1) * triR);
            const p11 = localToWorld(Math.cos(a1) * triR, yb, Math.sin(a1) * triR);
            solids.strut(p00, p10, 0.048, 0.048, 3, col);
            solids.strut(p00, p11, 0.045, 0.045, 3, col);
          }
        }
      }

      // Top red-and-white VHF/UHF broadcast dipole spire + dipole crossbars.
      solids.strut(localToWorld(0, bodyH - 0.5, 0), localToWorld(0, bodyH + spireH * 0.5, 0), 0.28, 0.22, 6, HAZARD_WHITE, true);
      solids.strut(localToWorld(0, bodyH + spireH * 0.5, 0), localToWorld(0, H, 0), 0.22, 0.09, 6, HAZARD_RED, true);
      for (let d = 1; d <= 4; d++) {
        const yd = bodyH + (d / 5) * spireH * 0.85;
        solids.strut(localToWorld(-1.1, yd, 0), localToWorld(1.1, yd, 0), 0.04, 0.04, 4, STEEL_GALV);
        solids.strut(localToWorld(0, yd, -1.1), localToWorld(0, yd, 1.1), 0.04, 0.04, 4, STEEL_GALV);
      }

      // 3 concrete guy-anchor blocks at 120 deg + 3 tiers of taut steel guy wires (0.34, 0.64, 0.90 of bodyH).
      for (let k = 0; k < 3; k++) {
        const az = m.heading + (k * Math.PI * 2) / 3;
        const an = m.north + Math.cos(az) * m.anchorRadius;
        const ae = m.east + Math.sin(az) * m.anchorRadius;
        const ag = heightAt(an, ae);
        const anchorTop = nedToThree({ x: an, y: ae, z: -(ag + 0.7) });
        const anchorBot = nedToThree({ x: an, y: ae, z: -(ag - 2.6) });
        solids.strut(anchorBot, anchorTop, 0.95, 0.75, 4, CONCRETE_COL, true);

        const la = legAngles[k];
        for (const tierFrac of [0.34, 0.64, 0.9]) {
          const mastAttach = localToWorld(Math.cos(la) * triR, bodyH * tierFrac, Math.sin(la) * triR);
          addCatenary(cables, mastAttach, anchorTop, 0.9 + tierFrac * 1.1, 0.024, 5, GUY_WIRE_COL);
        }
      }

      // ICAO Annex 14 lighting: synchronized flashing L-864 red beacons at top & mid-mast + steady L-810 at 1/4 & 3/4!
      const phase = (mi * 0.63) % 2.0;
      lights.push({
        position: localToWorld(0, H + 0.45, 0),
        colorA: LIGHT_COLORS.red,
        lens: 0.28,
        cd: 2200,
        cdDay: 650,
        flash: { period: 2.0, phase, duration: 1.05 },
        height: H + 0.45,
      });
      lights.push({
        position: localToWorld(0, H * 0.52, 0),
        colorA: LIGHT_COLORS.red,
        lens: 0.24,
        cd: 1800,
        cdDay: 450,
        flash: { period: 2.0, phase, duration: 1.05 },
        height: H * 0.52,
      });
      for (const qFrac of [0.26, 0.76]) {
        lights.push({
          position: localToWorld(triR + 0.2, H * qFrac, 0),
          colorA: LIGHT_COLORS.red,
          lens: 0.16,
          cd: 325,
          cdDay: 45,
          height: H * qFrac,
        });
      }
    } else {
      // --- Self-Supporting 4-Legged Lattice Microwave / Cellular Relay Tower (40..66 m) ---
      const H = m.height;
      const platY = H - 5.5;
      const baseHalf = Math.max(2.4, H * 0.068);
      const topHalf = 0.82;
      const corners: readonly [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
      const halfAt = (y: number) =>
        y <= 0 ? baseHalf + ((baseHalf - topHalf) / platY) * -y : baseHalf + (topHalf - baseHalf) * Math.min(1, y / platY);
      const pt = (y: number, c: readonly [number, number]) => {
        const r = halfAt(y);
        return localToWorld(c[0] * r, y, c[1] * r);
      };

      // 4 deep concrete foundation piers + 4 galvanized steel corner legs + X-bracing bays.
      for (const c of corners) {
        solids.strut(pt(-3.6, c), pt(0.6, c), 0.36, 0.3, 6, CONCRETE_COL, true);
        solids.strut(pt(0, c), pt(platY, c), 0.12, 0.085, 4, STEEL_GALV);
      }
      const nBays = Math.max(7, Math.round(platY / 5.2));
      for (let bi = 0; bi < nBays; bi++) {
        const y0 = (bi / nBays) * platY;
        const y1 = ((bi + 1) / nBays) * platY;
        for (let i = 0; i < 4; i++) {
          const cA = corners[i], cB = corners[(i + 1) % 4];
          solids.strut(pt(y1, cA), pt(y1, cB), 0.055, 0.055, 4, STEEL_DARK);
          solids.strut(pt(y0, cA), pt(y1, cB), 0.052, 0.052, 4, STEEL_GALV);
          solids.strut(pt(y0, cB), pt(y1, cA), 0.052, 0.052, 4, STEEL_GALV);
        }
      }

      // Upper microwave gallery platform + handrail + central cellular sector mast & lightning whip.
      solids.orientedBox(localToWorld(0, platY + 0.12, 0), topHalf * 2.65, 0.22, topHalf * 2.65, m.heading, STEEL_DARK);
      for (let i = 0; i < 4; i++) {
        const cA = corners[i], cB = corners[(i + 1) % 4];
        const r = topHalf * 1.28;
        solids.strut(localToWorld(cA[0] * r, platY + 0.2, cA[1] * r), localToWorld(cA[0] * r, platY + 1.25, cA[1] * r), 0.04, 0.04, 4, STEEL_GALV);
        solids.strut(localToWorld(cA[0] * r, platY + 1.25, cA[1] * r), localToWorld(cB[0] * r, platY + 1.25, cB[1] * r), 0.04, 0.04, 4, STEEL_GALV);
      }
      solids.strut(localToWorld(0, platY, 0), localToWorld(0, H, 0), 0.14, 0.05, 6, HAZARD_RED, true);

      // 3 vertical white cellular sector panel antennas around the upper mast.
      for (let k = 0; k < 3; k++) {
        const a = m.heading + (k * Math.PI * 2) / 3;
        const px = nedToThree({
          x: m.north + Math.cos(a) * 0.72,
          y: m.east + Math.sin(a) * 0.72,
          z: -(m.ground + platY + 2.3),
        });
        solids.orientedBox(px, 0.36, 2.4, 0.16, a, RADOME_WHITE);
      }

      // Parabolic microwave relay drums aimed directly along `dishBearings` toward peer relay towers!
      m.dishBearings.forEach((bearing, di) => {
        const dishY = platY - 1.6 - di * 3.2;
        const offsetR = halfAt(dishY) + 0.55;
        const back = nedToThree({
          x: m.north + Math.cos(bearing) * (offsetR - 0.35),
          y: m.east + Math.sin(bearing) * (offsetR - 0.35),
          z: -(m.ground + dishY),
        });
        const front = nedToThree({
          x: m.north + Math.cos(bearing) * (offsetR + 0.48),
          y: m.east + Math.sin(bearing) * (offsetR + 0.48),
          z: -(m.ground + dishY),
        });
        const dishR = di === 0 ? 1.15 : 0.88;
        solids.strut(back, front, dishR * 0.78, dishR, 10, RADOME_WHITE, true);
      });

      // Base telecom shelter cabin.
      solids.orientedBox(localToWorld(baseHalf + 2.8, -1.2, 0), 4.2, 3.0, 3.4, m.heading, CONCRETE_COL);
      solids.orientedBox(localToWorld(baseHalf + 2.8, 1.7, 0), 3.9, 2.8, 3.1, m.heading, CABIN_WALL);
      solids.orientedBox(localToWorld(baseHalf + 2.8, 3.2, 0), 4.2, 0.25, 3.4, m.heading, CABIN_ROOF);

      // Top red obstruction beacon (flashing L-864 on towers >= 52 m, steady L-810 on 40..51 m towers).
      lights.push({
        position: localToWorld(0, H + 0.35, 0),
        colorA: LIGHT_COLORS.red,
        lens: 0.2,
        cd: H >= 52 ? 1400 : 350,
        cdDay: H >= 52 ? 280 : 45,
        flash: H >= 52 ? { period: 2.2, phase: (mi * 0.47) % 2.2, duration: 1.15 } : undefined,
        height: H + 0.35,
      });
    }
  });

  const solidGeo = solids.build();
  if (solidGeo) {
    const mesh = new THREE.Mesh(solidGeo, structMat);
    mesh.name = 'infra-structures';
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  const cableGeo = cables.build();
  if (cableGeo) {
    const mesh = new THREE.Mesh(cableGeo, cableMat);
    mesh.name = 'infra-cables';
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    group.add(mesh);
  }

  return { group, lights, materials, plan };
}
