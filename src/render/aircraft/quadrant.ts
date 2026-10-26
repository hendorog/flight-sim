// Throttle quadrants, pedestals and consoles of the fixed-wing cockpits (render/aircraft/cockpit.ts), from the
// cockpit definition's `quadrant` (airframe/types.ts QuadrantDef): housings extruded from a side outline, slotted
// covers (a drum or a convex face plate round the levers' pivot axis, or a flat plate the levers pass through), the
// lever stems and the knob library (told apart by touch, as 14 CFR 23.781 shapes them: a flat-faced throttle, a
// notched propeller knob, a fluted mixture), friction knobs, gates and detent marks beside the slots, placards printed
// once into one atlas, knurled trim wheels in their mouldings, a flat rudder trim wheel and the small trim knobs.
//
// Everything fixed goes into the cockpit's MeshBatch (merged per material: one draw per material for the whole
// cabin); a lever is its own group (its stem and knob merged per material) so it can swing. The geometry is plain
// three.js built once; nothing is drawn or read back per frame.
//
// Frames: FRD body axes (x forward, y right, z down, m) in the definitions; three's model space (x right, y up,
// z aft) in the meshes (geometry.frd). A lever is built standing up its local +y from its pivot, +z aft, +x right;
// rotation.x = a swings its top aft by a (cockpit.ts update). Arc angles are the same: 0 straight up, + aft, so a
// point at angle a and radius r from the axis (x, z) is (x - r sin a, y, z - r cos a).

import * as THREE from 'three';
import type { CockpitDef, FRD, QuadrantDef, QuadrantKnob, QuadrantMaterial, QuadrantPart, QuadrantSlot } from './airframe/types';
import { frd, MeshBatch } from './geometry';
import type { AircraftMaterials } from './materials';

type EngineControl = CockpitDef['engineControls'][number];
type TrimWheelDef = NonNullable<CockpitDef['trimWheel']>;
type PlacardDef = NonNullable<QuadrantDef['placards']>[number];

/** Model-space direction of an FRD vector. */
const dir = (v: FRD): THREE.Vector3 => new THREE.Vector3(v[1], -v[2], -v[0]);
/** Model-space point of an FRD point. */
const at = (p: FRD): THREE.Vector3 => frd(p[0], p[1], p[2]);
const Y_UP = new THREE.Vector3(0, 1, 0);

// ---- Geometry helpers --------------------------------------------------------------------------------------------

/**
 * Triangles with per-vertex normals, model space. Each face is wound so that its geometric normal agrees with the
 * normal given (or points away from `inside`), so solids come out right whatever order the corners are listed in.
 */
class Mesher {
  private readonly pos: number[] = [];
  private readonly nor: number[] = [];
  private readonly uv: number[] = [];
  private readonly e1 = new THREE.Vector3();
  private readonly e2 = new THREE.Vector3();
  private readonly n = new THREE.Vector3();

  /** A quad a-b-c-d (a convex loop). normals: per corner; or one flat normal; or none: flat, facing away from `inside`. */
  quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, normals?: THREE.Vector3 | readonly THREE.Vector3[], inside?: THREE.Vector3): void {
    this.n.crossVectors(this.e1.subVectors(b, a), this.e2.subVectors(c, a));
    if (this.n.lengthSq() < 1e-16) this.n.crossVectors(this.e1.subVectors(c, a), this.e2.subVectors(d, a));
    this.n.normalize();
    let ref: THREE.Vector3;
    if (normals instanceof THREE.Vector3) ref = normals;
    else if (normals) ref = normals[0].clone().add(normals[1]).add(normals[2]).add(normals[3]);
    else ref = a.clone().add(c).multiplyScalar(0.5).sub(inside ?? new THREE.Vector3());
    const flip = this.n.dot(ref) < 0;
    const corners = flip ? [a, d, c, b] : [a, b, c, d];
    const ns = Array.isArray(normals) ? (flip ? [normals[0], normals[3], normals[2], normals[1]] : normals) : null;
    const flat = flip ? this.n.clone().negate() : this.n.clone();
    for (const [i, j, k] of [[0, 1, 2], [0, 2, 3]] as const) {
      for (const q of [i, j, k]) {
        const p = corners[q];
        this.pos.push(p.x, p.y, p.z);
        const nn = ns ? ns[q] : flat;
        this.nor.push(nn.x, nn.y, nn.z);
        this.uv.push(0, 0);
      }
    }
  }

  get empty(): boolean {
    return this.pos.length === 0;
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    return g;
  }
}

/** FRD point at angle a (rad, 0 up, + aft) and radius r from the lateral axis through (cx, cz), at y. */
function arcPoint(cx: number, cz: number, r: number, a: number, y: number): THREE.Vector3 {
  return frd(cx - r * Math.sin(a), y, cz - r * Math.cos(a));
}
/** Model-space outward radial direction at angle a. */
function arcNormal(a: number): THREE.Vector3 {
  return dir([-Math.sin(a), 0, -Math.cos(a)]);
}

/**
 * A solid annular sector round the lateral axis through (cx, cz): radii rIn..rOut, angles a0..a1 (rad), across y0..y1.
 * The curved faces are smooth; the flat ones flat. `faces` leaves out the inner face or the ends where nothing sees them.
 */
function annularSector(m: Mesher, cx: number, cz: number, rIn: number, rOut: number, a0: number, a1: number, y0: number, y1: number,
                       faces: { inner?: boolean; ends?: boolean } = {}): void {
  const n = Math.max(1, Math.ceil(Math.abs(a1 - a0) / (3.5 * (Math.PI / 180))));
  const mid = arcPoint(cx, cz, (rIn + rOut) / 2, (a0 + a1) / 2, (y0 + y1) / 2);
  for (let k = 0; k < n; k++) {
    const p = a0 + ((a1 - a0) * k) / n;
    const q = a0 + ((a1 - a0) * (k + 1)) / n;
    const np = arcNormal(p);
    const nq = arcNormal(q);
    m.quad(arcPoint(cx, cz, rOut, p, y0), arcPoint(cx, cz, rOut, q, y0), arcPoint(cx, cz, rOut, q, y1), arcPoint(cx, cz, rOut, p, y1), [np, nq, nq, np]);
    if (faces.inner !== false && rIn > 1e-4) {
      const ip = np.clone().negate();
      const iq = nq.clone().negate();
      m.quad(arcPoint(cx, cz, rIn, p, y0), arcPoint(cx, cz, rIn, q, y0), arcPoint(cx, cz, rIn, q, y1), arcPoint(cx, cz, rIn, p, y1), [ip, iq, iq, ip]);
    }
    for (const y of [y0, y1]) m.quad(arcPoint(cx, cz, rIn, p, y), arcPoint(cx, cz, rOut, p, y), arcPoint(cx, cz, rOut, q, y), arcPoint(cx, cz, rIn, q, y), undefined, mid);
  }
  if (faces.ends !== false)
    for (const a of [a0, a1]) m.quad(arcPoint(cx, cz, rIn, a, y0), arcPoint(cx, cz, rOut, a, y0), arcPoint(cx, cz, rOut, a, y1), arcPoint(cx, cz, rIn, a, y1), undefined, mid);
}

/** A closed outline in its own (x, y) plane extruded `depth` along +z, centred on z = 0, with a small bevel. */
function prism(outline: readonly THREE.Vector2[], depth: number, bevel = 0, holes: readonly (readonly THREE.Vector2[])[] = []): THREE.BufferGeometry {
  const shape = new THREE.Shape([...outline]);
  for (const h of holes) shape.holes.push(new THREE.Path([...h]));
  const b = Math.min(bevel, depth / 3);
  // bevelOffset -bevelSize: the bevel rounds the edges inside the outline instead of growing the shape.
  const g = new THREE.ExtrudeGeometry(shape, { depth: depth - 2 * b, bevelEnabled: b > 0, bevelThickness: b, bevelSize: b * 0.9, bevelOffset: -b * 0.9, bevelSegments: 1, curveSegments: 6 });
  g.translate(0, 0, -(depth - 2 * b) / 2);
  return g;
}

/** Rounded rectangle outline w x h centred on the origin, corner radius r. */
function roundedRect(w: number, h: number, r: number, seg = 3): THREE.Vector2[] {
  const out: THREE.Vector2[] = [];
  const rr = Math.min(r, w / 2, h / 2);
  const corners: [number, number, number][] = [[w / 2 - rr, h / 2 - rr, 0], [-w / 2 + rr, h / 2 - rr, 0.5], [-w / 2 + rr, -h / 2 + rr, 1], [w / 2 - rr, -h / 2 + rr, 1.5]];
  for (const [cx, cy, s] of corners)
    for (let k = 0; k <= seg; k++) {
      const a = (s + k / seg / 2) * Math.PI;
      out.push(new THREE.Vector2(cx + rr * Math.cos(a), cy + rr * Math.sin(a)));
    }
  return out;
}

/** A fluted / knurled circle: `n` ridges of `depth` round radius r (flat-topped ridges, V grooves). */
function fluted(r: number, n: number, depth: number, land = 0.5): THREE.Vector2[] {
  const out: THREE.Vector2[] = [];
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    const da = (Math.PI * 2) / n;
    out.push(new THREE.Vector2(Math.cos(a) * r, Math.sin(a) * r));
    out.push(new THREE.Vector2(Math.cos(a + da * land) * r, Math.sin(a + da * land) * r));
    const g = a + da * (land + (1 - land) / 2);
    out.push(new THREE.Vector2(Math.cos(g) * (r - depth), Math.sin(g) * (r - depth)));
  }
  return out;
}

/** A fine straight knurl: n sharp ridges of `depth` round radius r (two outline points a ridge). */
function knurl(r: number, n: number, depth: number): THREE.Vector2[] {
  const out: THREE.Vector2[] = [];
  for (let k = 0; k < 2 * n; k++) {
    const a = (k / (2 * n)) * Math.PI * 2;
    const rr = k % 2 ? r - depth : r;
    out.push(new THREE.Vector2(Math.cos(a) * rr, Math.sin(a) * rr));
  }
  return out;
}

/** A lobed circle: n smooth finger grips (raised knuckles between shallow round hollows) round radius r. */
function lobed(r: number, n: number, depth: number): THREE.Vector2[] {
  const out: THREE.Vector2[] = [];
  const steps = n * 8;
  for (let k = 0; k < steps; k++) {
    const a = (k / steps) * Math.PI * 2;
    const rr = r - depth * Math.sin((n * a) / 2) ** 2;
    out.push(new THREE.Vector2(Math.cos(a) * rr, Math.sin(a) * rr));
  }
  return out;
}

/** A scalloped circle: n round-bottomed scallops cut into radius r. */
function scalloped(r: number, n: number, depth: number): THREE.Vector2[] {
  const out: THREE.Vector2[] = [];
  const steps = 6;
  for (let k = 0; k < n * steps; k++) {
    const a = (k / (n * steps)) * Math.PI * 2;
    const ph = ((k % steps) / steps) * Math.PI * 2;
    const rr = r - depth * Math.max(0, Math.sin(ph)) ** 1.5;
    out.push(new THREE.Vector2(Math.cos(a) * rr, Math.sin(a) * rr));
  }
  return out;
}

/** Turn geometry authored along model +y to stand along `axis` (model), then move it to `p` (model). */
function stand(g: THREE.BufferGeometry, axis: THREE.Vector3, p: THREE.Vector3, spin = 0): THREE.BufferGeometry {
  if (spin) g.rotateY(spin);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(Y_UP, axis.clone().normalize()));
  return g.translate(p.x, p.y, p.z);
}

/** A cylinder along model y from y = 0 to `len`. */
function rod(r: number, len: number, seg = 14): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(r, r, len, seg).translate(0, len / 2, 0);
}

/** A rounded box (min/max corner order free) in model space with a flat bevel: the cheap version, 24 vertices + bevel faces. */
function bevelBox(sx: number, sy: number, sz: number, bevel: number): THREE.BufferGeometry {
  const b = Math.min(bevel, sx / 3, sy / 3, sz / 3);
  return prism(roundedRect(sx, sy, b, 1), sz, b);
}

// ---- Placards ----------------------------------------------------------------------------------------------------

/** Printed resolution of the placards, px per metre (a 3 mm letter is ~12 px). */
const PLACARD_PX_PER_M = 4000;
const ATLAS_W = 2048;
const INK: Record<NonNullable<PlacardDef['ink']>, string> = { white: '#e8e6df', black: '#151515', red: '#c22a20' };
/** Placard grounds; 'cover' is printed straight on a light grey cover (the trimPlastic colour). */
const GROUND: Record<NonNullable<PlacardDef['ground']>, string> = { black: '#121212', white: '#dcdad2', grey: '#8a8b88', red: '#9e1b16', cover: '#a8a49c' };

/**
 * The cockpit's placards, all printed into one canvas once (at construction) and drawn as quads with one material:
 * one draw for every placard of the cabin. No canvas (a test without a DOM): no placards.
 */
export class PlacardAtlas {
  readonly material = new THREE.MeshStandardMaterial({ name: 'placard', roughness: 0.55, metalness: 0 });
  private readonly items: PlacardDef[] = [];
  private texture: THREE.CanvasTexture | null = null;

  add(p: PlacardDef): void {
    this.items.push(p);
  }

  /** Print the placards and add their quads to `batch` (fixed parts). */
  build(batch: MeshBatch): void {
    if (!this.items.length || typeof document === 'undefined') return;
    // Shelf packing in printed px.
    const cells: { x: number; y: number; w: number; h: number }[] = [];
    let x = 0;
    let y = 0;
    let shelf = 0;
    for (const p of this.items) {
      const w = Math.min(ATLAS_W, Math.ceil(p.w * PLACARD_PX_PER_M) + 2);
      const h = Math.ceil(p.h * PLACARD_PX_PER_M) + 2;
      if (x + w > ATLAS_W) {
        x = 0;
        y += shelf;
        shelf = 0;
      }
      cells.push({ x, y, w, h });
      x += w;
      shelf = Math.max(shelf, h);
    }
    const H = Math.max(4, Math.ceil((y + shelf) / 4) * 4);
    const canvas = document.createElement('canvas');
    canvas.width = ATLAS_W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    this.items.forEach((p, i) => {
      const c = cells[i];
      ctx.fillStyle = GROUND[p.ground ?? 'black'];
      ctx.fillRect(c.x, c.y, c.w, c.h);
      ctx.fillStyle = INK[p.ink ?? 'white'];
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const lines = p.lines;
      const lh = (c.h - 2) / Math.max(1, lines.length);
      lines.forEach((line, k) => {
        let size = Math.floor(lh * 0.78);
        ctx.font = `bold ${size}px sans-serif`;
        // (A stand-in context in tests may measure nothing.)
        const wide = ctx.measureText(line)?.width ?? 0;
        if (wide > c.w - 6) {
          size = Math.max(6, Math.floor((size * (c.w - 6)) / wide));
          ctx.font = `bold ${size}px sans-serif`;
        }
        ctx.fillText(line, c.x + c.w / 2, c.y + 1 + lh * (k + 0.5));
      });
    });
    const tex = (this.texture = new THREE.CanvasTexture(canvas));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    this.material.map = tex;
    this.material.needsUpdate = true;
    // Quads: u across, v up the text; a fraction of a millimetre proud of the face.
    const pos: number[] = [];
    const nor: number[] = [];
    const uv: number[] = [];
    this.items.forEach((p, i) => {
      const c = cells[i];
      const n = dir(p.normal).normalize();
      const up = dir(p.up).projectOnPlane(n).normalize();
      const right = new THREE.Vector3().crossVectors(up, n).normalize();
      const o = at(p.pos).addScaledVector(n, 0.0004);
      const u0 = (c.x + 1) / ATLAS_W;
      const u1 = (c.x + c.w - 1) / ATLAS_W;
      const v0 = 1 - (c.y + c.h - 1) / H;
      const v1 = 1 - (c.y + 1) / H;
      const corner = (sx: number, sy: number): THREE.Vector3 => o.clone().addScaledVector(right, (sx * p.w) / 2).addScaledVector(up, (sy * p.h) / 2);
      const quad: [THREE.Vector3, number, number][] = [[corner(-1, -1), u0, v0], [corner(1, -1), u1, v0], [corner(1, 1), u1, v1], [corner(-1, 1), u0, v1]];
      for (const k of [0, 1, 2, 0, 2, 3]) {
        const [v, uu, vv] = quad[k];
        pos.push(v.x, v.y, v.z);
        nor.push(n.x, n.y, n.z);
        uv.push(uu, vv);
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    batch.add(this.material, g);
  }

  setAnisotropy(n: number): void {
    if (this.texture) {
      this.texture.anisotropy = n;
      this.texture.needsUpdate = true;
    }
  }

  dispose(): void {
    this.texture?.dispose();
    this.material.dispose();
  }
}

// ---- Levers ------------------------------------------------------------------------------------------------------

/** Angle (rad, + aft) of a lever's stem at value v (0..1, forward = 1) and reverse r (0..1): as cockpit.ts update poses it, plus its tilt. */
export function leverAngle(e: EngineControl, v: number, r = 0): number {
  return (e.tilt ?? 0) + e.travel * (1 - v - 0.5 + (e.reverseTravel ?? 0) * r);
}

/** The angular swing of a lever's stem: [forward-most, aft-most], rad. */
export function leverSwing(e: EngineControl): [number, number] {
  return [leverAngle(e, 1), leverAngle(e, 0, 1)];
}

/** Stem section by knob: flat steel bar, m (fore-aft width, lateral thickness). */
function stemSection(knob: QuadrantKnob): [number, number] {
  switch (knob) {
    case 'pcl':
      return [0.016, 0.008];
    case 'c208Power':
      return [0.014, 0.006];
    case 'tGrip':
      return [0.01, 0.008];
    default:
      return [0.012, 0.005];
  }
}

/**
 * The knob of `knob` in the lever frame, its base on the stem's top at the origin, standing up +y: parts in the knob
 * colour, and the accessories (the C208 power lever's red beta latch and lift ring, the override lever's stripes).
 */
function knobParts(knob: QuadrantKnob, mat: AircraftMaterials): { main: THREE.BufferGeometry[]; extra: [THREE.Material, THREE.BufferGeometry, boolean][] } {
  const main: THREE.BufferGeometry[] = [];
  /** Accessories: material, geometry, and whether it moves with the knob's lateral offset (on the knob, not the stem). */
  const extra: [THREE.Material, THREE.BufferGeometry, boolean][] = [];
  switch (knob) {
    case 'pistonThrottle': {
      // A flat-faced paddle, wider at the top: its broad flat face to the pilot.
      const w = 0.04;
      const h = 0.026;
      const o = [new THREE.Vector2(-w * 0.36, 0), new THREE.Vector2(w * 0.36, 0), new THREE.Vector2(w / 2, h * 0.72), new THREE.Vector2(w * 0.44, h), new THREE.Vector2(-w * 0.44, h), new THREE.Vector2(-w / 2, h * 0.72)];
      main.push(prism(o, 0.018, 0.003).translate(0, -0.004, 0));
      break;
    }
    case 'notchedProp': {
      // A square-ish block, two notches across its top.
      const w = 0.03;
      const h = 0.03;
      const nw = 0.0055;
      const nd = 0.008;
      const o = [
        new THREE.Vector2(-w / 2, 0), new THREE.Vector2(w / 2, 0), new THREE.Vector2(w / 2, h),
        new THREE.Vector2(w / 6 + nw / 2, h), new THREE.Vector2(w / 6 + nw / 2, h - nd), new THREE.Vector2(w / 6 - nw / 2, h - nd), new THREE.Vector2(w / 6 - nw / 2, h),
        new THREE.Vector2(-w / 6 + nw / 2, h), new THREE.Vector2(-w / 6 + nw / 2, h - nd), new THREE.Vector2(-w / 6 - nw / 2, h - nd), new THREE.Vector2(-w / 6 - nw / 2, h),
        new THREE.Vector2(-w / 2, h),
      ];
      main.push(prism(o, 0.024, 0.0022).translate(0, -0.004, 0));
      break;
    }
    case 'ribbedMixture': {
      // A fluted cylinder lying across the slot.
      main.push(prism(fluted(0.0165, 10, 0.0042, 0.42), 0.026, 0.0015).rotateY(Math.PI / 2).translate(0, 0.0125, 0));
      break;
    }
    case 'scallopedMixture': {
      main.push(prism(scalloped(0.0165, 8, 0.004), 0.022, 0.0015).rotateY(Math.PI / 2).translate(0, 0.0125, 0));
      break;
    }
    case 'cylinderThrottle': {
      // A long cylinder across the slot, most of it outboard (left) of the stem.
      const len = 0.056, off = -0.014;
      main.push(new THREE.CylinderGeometry(0.0145, 0.0145, len, 22).rotateZ(Math.PI / 2).translate(off, 0.012, 0));
      for (const s of [-1, 1]) main.push(new THREE.CylinderGeometry(0.0135, 0.0145, 0.003, 22).rotateZ(Math.PI / 2).translate(off + s * (len / 2 + 0.0015), 0.012, 0));
      break;
    }
    case 'c208Power': {
      // The wide rectangular block (to the left of its stem, clear of the propeller knob), the red beta latch at its
      // left end on the pilot's side, and the lift ring under it on the stem.
      main.push(prism(roundedRect(0.066, 0.032, 0.008), 0.03, 0.004).translate(0, 0.012, 0));
      extra.push([mat.knobRed, bevelBox(0.008, 0.018, 0.008, 0.002).translate(-0.031, 0.01, 0.014), true]);
      extra.push([mat.darkMetal, new THREE.CylinderGeometry(0.011, 0.011, 0.008, 18).translate(0, -0.012, 0), false]);
      extra.push([mat.darkMetal, new THREE.TorusGeometry(0.0115, 0.0022, 6, 18).rotateX(Math.PI / 2).translate(0, -0.016, 0), false]);
      break;
    }
    case 'pcl': {
      // The PC-12/47 PCL grip: a fat round handle lying across the console, its ends domed, on a short neck.
      main.push(new THREE.CylinderGeometry(0.0085, 0.0095, 0.016, 14).translate(0, 0.008, 0));
      main.push(new THREE.CylinderGeometry(0.019, 0.019, 0.044, 24).rotateZ(Math.PI / 2).translate(0, 0.034, 0));
      for (const sx of [-1, 1]) main.push(new THREE.SphereGeometry(0.019, 24, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.4, 1).rotateZ((-sx * Math.PI) / 2).translate(sx * 0.022, 0.034, 0));
      break;
    }
    case 'condition': {
      // A black collar on the stem and the fluted grip across the slot in the lever's colour.
      main.push(prism(fluted(0.0125, 12, 0.0022, 0.45), 0.028, 0.0012).rotateY(Math.PI / 2).translate(0, 0.022, 0));
      extra.push([mat.knobBlack, new THREE.CylinderGeometry(0.0085, 0.01, 0.012, 14).translate(0, 0.006, 0), false]);
      break;
    }
    case 'override': {
      main.push(new THREE.CylinderGeometry(0.0095, 0.0095, 0.03, 16).rotateZ(Math.PI / 2).translate(0, 0.01, 0));
      for (const s of [-1, 0, 1]) extra.push([mat.knobRed, new THREE.CylinderGeometry(0.0098, 0.0098, 0.004, 16).rotateZ(Math.PI / 2).translate(s * 0.008, 0.01, 0), true]);
      break;
    }
    case 'tGrip': {
      main.push(prism(roundedRect(0.044, 0.014, 0.006), 0.018, 0.003).translate(0, 0.006, 0));
      break;
    }
    default:
      main.push(bevelBox(0.024, 0.026, 0.022, 0.004).translate(0, 0.012, 0));
  }
  return { main, extra };
}

/**
 * A quadrant lever (cockpit.ts engineControls kind 'lever' with `knob`): the stem, a flat steel bar from the pivot to
 * `length`, and its knob there, all leaned aft by `tilt`; in `g` (positioned at the pivot), the stem and knob merged as
 * 'lever' (stem darkMetal, knob in its colour) and the accessories as 'leverPart'.
 */
export function buildQuadrantLever(g: THREE.Group, mat: AircraftMaterials, knobMat: THREE.Material, e: EngineControl): void {
  frd(e.pos[0], e.pos[1], e.pos[2], g.position);
  const knob = e.knob!;
  const length = e.length ?? 0.11;
  const tilt = e.tilt ?? 0;
  const [sw, st] = stemSection(knob);
  const b = new MeshBatch();
  // The stem tapers a little toward the knob.
  const stem = prism([new THREE.Vector2(-sw / 2, 0), new THREE.Vector2(sw / 2, 0), new THREE.Vector2(sw * 0.38, length), new THREE.Vector2(-sw * 0.38, length)], st, 0.0008);
  stem.rotateY(Math.PI / 2);
  b.add(mat.darkMetal, stem.rotateX(tilt));
  const parts = knobParts(knob, mat);
  const off = e.knobOffset ?? 0;
  const sc = e.knobScale ?? 1;
  for (const k of parts.main) b.add(knobMat, k.scale(sc, sc, sc).translate(off, length, 0).rotateX(tilt));
  g.add(...b.build('lever').children);
  if (parts.extra.length) {
    const x = new MeshBatch();
    for (const [m, k, onKnob] of parts.extra) x.add(m, k.scale(sc, sc, sc).translate(onKnob ? off : 0, length, 0).rotateX(tilt));
    g.add(...x.build('leverPart').children);
  }
}

/**
 * A Cessna push-pull knob (engineControls kind 'knob' with a plunger `knob`) on its chrome shaft from the panel at the
 * group's origin, the group sliding aft as it is pulled: plunger a smooth domed black knob, plungerMixture a fluted red
 * one with its vernier lock button, plungerCarbHeat a plain grey-white one. Its friction-lock nut and the bushing stay
 * on the panel (`fixed`).
 */
export function buildPlunger(g: THREE.Group, fixed: MeshBatch, mat: AircraftMaterials, knobMat: THREE.Material, e: EngineControl): void {
  frd(e.pos[0], e.pos[1], e.pos[2], g.position);
  const b = new MeshBatch();
  const z0 = 0.074;
  b.add(mat.chrome, new THREE.CylinderGeometry(0.0045, 0.0045, 0.12, 12).rotateX(Math.PI / 2));
  const knob = e.knob!;
  // The face disc: the knob's polished end (a white plastic insert on the carb heat).
  const face = (r: number, z: number, m: THREE.Material): void => b.add(m, new THREE.CylinderGeometry(r, r, 0.003, 24).rotateX(Math.PI / 2).translate(0, 0, z));
  if (knob === 'plungerMixture') {
    // Fluted red knob, its vernier lock button in the face.
    b.add(knobMat, prism(fluted(0.0155, 12, 0.003, 0.45), 0.03, 0.0015).translate(0, 0, z0));
    face(0.0095, z0 + 0.0155, mat.chrome);
  } else if (knob === 'plungerCarbHeat') {
    b.add(knobMat, new THREE.CylinderGeometry(0.0145, 0.0155, 0.02, 24).rotateX(Math.PI / 2).translate(0, 0, z0));
    face(0.0115, z0 + 0.0105, mat.knobWhite);
  } else {
    // Throttle: a smooth black knob with a flange at its back and a polished face.
    b.add(knobMat, new THREE.CylinderGeometry(0.0155, 0.0165, 0.024, 28).rotateX(Math.PI / 2).translate(0, 0, z0));
    b.add(knobMat, new THREE.CylinderGeometry(0.0185, 0.0185, 0.005, 28).rotateX(Math.PI / 2).translate(0, 0, z0 - 0.0105));
    face(0.011, z0 + 0.0125, mat.chrome);
  }
  g.add(...b.build('knob').children);
  // On the panel: a bushing, and for the throttle the knurled friction-lock nut round the shaft.
  const p = at(e.pos);
  // A black bezel ring and a hex bushing nut on the panel; the throttle's knurled friction-lock ring out on the shaft.
  fixed.add(mat.black, new THREE.CylinderGeometry(0.021, 0.022, 0.003, 28).rotateX(Math.PI / 2).translate(p.x, p.y, p.z + 0.0015));
  fixed.add(mat.chrome, new THREE.CylinderGeometry(0.0145, 0.0145, 0.007, 6).rotateX(Math.PI / 2).translate(p.x, p.y, p.z + 0.0055));
  if (knob === 'plunger') fixed.add(mat.knobBlack, prism(fluted(0.0175, 24, 0.0016, 0.5), 0.01, 0.001).translate(p.x, p.y, p.z + 0.014));
}

// ---- Housings, covers, fittings -----------------------------------------------------------------------------------

/** A side outline (x, z) extruded across y0..y1 with a bevel, as a model-space geometry (no axis swap: no winding flip). */
function sideExtrusion(profile: readonly (readonly [number, number])[], y0: number, y1: number, bevel: number): THREE.BufferGeometry {
  // Outline in the model (z, y) plane as shape (s, t) = (-x, -z): s along model +z (aft), t along model +y (up).
  const shape = profile.map(([x, z]) => new THREE.Vector2(-x, -z));
  const b = Math.min(bevel, (y1 - y0) / 3);
  const g = new THREE.ExtrudeGeometry(new THREE.Shape(shape), { depth: y1 - y0 - 2 * b, bevelEnabled: b > 0, bevelThickness: b, bevelSize: b * 0.85, bevelOffset: -b * 0.85, bevelSegments: 2, curveSegments: 8 });
  // A proper rotation (no mirror, so no winding flip): rotateY(-90 deg) takes shape x (s) to model +z and the
  // extrusion's z (-b .. depth + b) to model -x; then shift it to y0 .. y1.
  g.rotateY(-Math.PI / 2);
  g.translate(y1 - b, 0, 0);
  return g;
}

/** The slot of a cover, resolved: lateral centre y and half width, and its angular (arc) or along-plate (plate) range. */
interface Slot { y: number; hw: number; from: number; to: number; lever?: EngineControl; label?: string; stackedLabel?: number }

const SLOT_MARGIN = 0.07;

function arcSlots(def: CockpitDef, slots: readonly QuadrantSlot[], r: number): Slot[] {
  return slots.map((s) => {
    const e = s.lever !== undefined ? def.engineControls[s.lever] : undefined;
    const [f, t] = e ? leverSwing(e) : [s.from!, s.to!];
    // A little past each end of the swing for the stem's own width.
    const m = e ? SLOT_MARGIN * (0.12 / r) * 0.6 : 0;
    return { y: e ? e.pos[1] : s.y!, hw: s.w / 2, from: f - m, to: t + m, lever: e, label: s.label, stackedLabel: s.stackedLabel };
  });
}

/** Lateral intervals of [y0, y1] not cut by `open` slots. */
function solidSpans(y0: number, y1: number, open: readonly Slot[]): [number, number][] {
  const cuts = open.map((s) => [s.y - s.hw, s.y + s.hw] as const).sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  let y = y0;
  for (const [a, b] of cuts) {
    if (a > y) out.push([y, Math.min(a, y1)]);
    y = Math.max(y, b);
  }
  if (y < y1) out.push([y, y1]);
  return out.filter(([a, b]) => b - a > 1e-5);
}

/**
 * Add the quadrant of `def` (def.quadrant) to the fixed parts: its housings, slotted covers with their cheeks, the
 * marks and gates beside the lever slots, its fittings and its placards (into `placards`).
 */
export function addQuadrant(fixed: MeshBatch, mat: AircraftMaterials, def: CockpitDef, placards: PlacardAtlas): void {
  const q = def.quadrant!;
  const M = (m: QuadrantMaterial): THREE.Material => mat[m];
  for (const h of q.housings) fixed.add(M(h.material), sideExtrusion(h.profile, h.y0, h.y1, h.bevel));

  for (const arc of q.arcs ?? []) {
    const [cx, cz] = arc.centre;
    const rOut = arc.r;
    const rIn = arc.r - arc.thickness;
    const slots = arcSlots(def, arc.slots, rOut);
    // Break the shell at every slot end; in each angular band the slots open there cut it across.
    const breaks = [arc.from, arc.to, ...slots.flatMap((s) => [s.from, s.to])].filter((a) => a >= arc.from && a <= arc.to).sort((a, b) => a - b);
    const shell = new Mesher();
    for (let i = 0; i + 1 < breaks.length; i++) {
      const a0 = breaks[i];
      const a1 = breaks[i + 1];
      if (a1 - a0 < 1e-5) continue;
      const mid = (a0 + a1) / 2;
      const open = slots.filter((s) => s.from <= mid && s.to >= mid);
      for (const [y0, y1] of solidSpans(arc.y0, arc.y1, open)) annularSector(shell, cx, cz, rIn, rOut, a0, a1, y0, y1, { inner: false, ends: true });
    }
    fixed.add(M(arc.material), shell.build());
    // The dark core under the slots, and the cheeks closing the drum's ends.
    const core = new Mesher();
    for (const s of slots) annularSector(core, cx, cz, rIn - 0.03, rIn - 0.004, s.from - 0.02, s.to + 0.02, s.y - s.hw - 0.006, s.y + s.hw + 0.006, { inner: false });
    if (!core.empty) fixed.add(mat.black, core.build());
    const cheeks = new Mesher();
    for (const [y0, y1] of [[arc.y0 - 0.004, arc.y0], [arc.y1, arc.y1 + 0.004]] as const) annularSector(cheeks, cx, cz, 0.002, rOut + 0.002, arc.from, arc.to, y0, y1, { inner: false });
    fixed.add(M(arc.cheeks ?? arc.material), cheeks.build());
    // Beside each lever slot: white detent ticks, and for a lever with beta / reverse the idle gate (a stop block on
    // the slot's inboard side) and the red beta range along its edge.
    const marks = new Mesher();
    const red = new Mesher();
    const gates = new Mesher();
    const proud = 0.0006;
    for (const s of slots) {
      const e = s.lever;
      if (!e) continue;
      const side = s.y + s.hw + 0.0035;
      for (const d of e.detents ?? []) {
        const a = leverAngle(e, d);
        const da = 0.0016 / rOut;
        annularSector(marks, cx, cz, rOut, rOut + proud, a - da, a + da, s.y + s.hw + 0.001, s.y + s.hw + 0.009, { inner: false });
      }
      if (e.reverseTravel) {
        const idle = leverAngle(e, 0);
        const full = leverAngle(e, 0, 1);
        annularSector(red, cx, cz, rOut, rOut + proud, idle + 0.02, full, side - 0.0025, side + 0.0025, { inner: false });
        // The gate: a block across half the slot's width, just aft of idle, standing 4 mm proud.
        annularSector(gates, cx, cz, rOut - 0.002, rOut + 0.004, idle + 0.035, idle + 0.035 + 0.006 / rOut, s.y - s.hw - 0.003, s.y + 0.001);
      }
      if (s.label && s.stackedLabel) {
        // Upright letters one under the other down the drum beside the slot, centred on it, each on its own patch.
        const h = s.stackedLabel;
        const w = h * 0.78;
        const step = (h * 1.12) / rOut;
        const letters = [...s.label];
        const mid = (s.from + s.to) / 2;
        letters.forEach((ch, i) => {
          const a = mid + (i - (letters.length - 1) / 2) * step;
          const p = arcPoint(cx, cz, rOut + 0.0004, a, s.y - s.hw - 0.002 - w / 2);
          placards.add({ pos: [-p.z, p.x, -p.y], normal: [-Math.sin(a), 0, -Math.cos(a)], up: [Math.cos(a), 0, -Math.sin(a)], w, h, lines: [ch], ink: 'white', ground: 'black' });
        });
      } else if (s.label) {
        // Toward the slot's upper (forward) end.
        const a = s.from + (s.to - s.from) * 0.35;
        const p = arcPoint(cx, cz, rOut, a, s.y - s.hw - 0.0045);
        const n = arcNormal(a);
        placards.add({ pos: [-p.z, p.x, -p.y], normal: [-n.z, n.x, -n.y], up: [0, -1, 0], w: Math.min(0.05, (s.to - s.from) * rOut * 0.6), h: 0.0055, lines: [s.label],
                       ...(arc.material === 'trimPlastic' ? { ink: 'black' as const, ground: 'cover' as const } : { ink: 'white' as const, ground: 'black' as const }) });
      }
    }
    if (!marks.empty) fixed.add(mat.knobWhite, marks.build());
    if (!red.empty) fixed.add(mat.knobRed, red.build());
    if (!gates.empty) fixed.add(mat.darkMetal, gates.build());
  }

  for (const plate of q.plates ?? []) addPlate(fixed, mat, def, plate, placards);
  for (const part of q.parts ?? []) addPart(fixed, mat, part);
  for (const p of q.placards ?? []) placards.add(p);
}

type PlateDef = NonNullable<QuadrantDef['plates']>[number];

/**
 * A flat plate with slots cut out (Shape with holes, extruded), its top face in the plane through `origin`; a dark well
 * just under each slot; beside a lever's slot its detent ticks (white), and for a lever with beta / reverse the idle
 * gate (a red stop across half the slot) and the red beta range along its edge; the slot's label past its aft end.
 */
function addPlate(fixed: MeshBatch, mat: AircraftMaterials, def: CockpitDef, plate: PlateDef, placards: PlacardAtlas): void {
  const O = new THREE.Vector3(...plate.origin);
  const u = new THREE.Vector3(...plate.u).normalize();
  const v = new THREE.Vector3(...plate.v).normalize();
  const n = new THREE.Vector3().crossVectors(u, v).normalize();
  const basis = new THREE.Matrix4().makeBasis(dir([u.x, u.y, u.z]), dir([v.x, v.y, v.z]), dir([n.x, n.y, n.z]));
  const o = at(plate.origin);
  /** A box in plate coordinates (s along u, t along v, h out of the plate), centred at (s, t, h). */
  const onPlate = (m: THREE.Material, s: number, t: number, h: number, ls: number, lt: number, lh: number): void => {
    fixed.add(m, new THREE.BoxGeometry(ls, lt, lh).translate(s, t, h).applyMatrix4(basis).translate(o.x, o.y, o.z));
  };
  const holes: THREE.Vector2[][] = [];
  for (const s of plate.slots) {
    let from = s.from ?? 0;
    let to = s.to ?? 0;
    let across = s.y ?? 0;
    const e = s.lever !== undefined ? def.engineControls[s.lever] : undefined;
    const hw = s.w / 2;
    if (e) {
      // Where the lever's line crosses the plate at both ends of its swing (FRD).
      const P = new THREE.Vector3(...e.pos);
      const along = (a: number): number => {
        const d = new THREE.Vector3(-Math.sin(a), 0, -Math.cos(a));
        const t = O.clone().sub(P).dot(n) / d.dot(n);
        return P.clone().addScaledVector(d, t).sub(O).dot(u);
      };
      const [a0, a1] = leverSwing(e);
      from = Math.min(along(a0), along(a1)) - 0.008;
      to = Math.max(along(a0), along(a1)) + 0.008;
      across = P.clone().sub(O).dot(v);
      const side = across + hw + 0.004;
      for (const d of e.detents ?? []) onPlate(mat.knobWhite, along(leverAngle(e, d)), side, 0.0005, 0.0018, 0.008, 0.001);
      if (e.reverseTravel) {
        const idle = along(leverAngle(e, 0));
        const full = along(leverAngle(e, 0, 1));
        onPlate(mat.knobRed, idle + 0.006 * Math.sign(full - idle), across - hw * 0.5, 0.002, 0.004, s.w * 0.55, 0.004);
        onPlate(mat.knobRed, (idle + full) / 2, side, 0.0005, Math.abs(full - idle), 0.003, 0.001);
      }
    }
    holes.push(roundedRect(to - from, s.w, hw * 0.95, 3).map((p) => new THREE.Vector2(p.x + (from + to) / 2, p.y + across)).reverse());
    // The well just under the slot.
    onPlate(mat.black, (from + to) / 2, across, -plate.thickness - 0.0015, to - from + 0.006, s.w + 0.006, 0.001);
    if (s.label) {
      const c = new THREE.Vector3().addScaledVector(u, to + 0.009).addScaledVector(v, across).add(O);
      placards.add({ pos: [c.x, c.y, c.z], normal: [n.x, n.y, n.z], up: [-u.x, -u.y, -u.z], w: 0.034, h: 0.007, lines: [s.label], ink: 'white', ground: 'black' });
    }
  }
  const outline = roundedRect(plate.length, plate.width, 0.006, 2).map((p) => new THREE.Vector2(p.x + plate.length / 2, p.y + plate.width / 2));
  const g = prism(outline, plate.thickness, Math.min(0.0015, plate.thickness / 3), holes);
  // Top face on the plane: the prism is centred on z, so move it down by half its thickness.
  g.translate(0, 0, -plate.thickness / 2);
  fixed.add(mat[plate.material], g.applyMatrix4(basis).translate(o.x, o.y, o.z));
}

/** One fixed fitting. */
function addPart(fixed: MeshBatch, mat: AircraftMaterials, part: QuadrantPart): void {
  switch (part.kind) {
    case 'box': {
      const [x0, y0, z0] = part.min;
      const [x1, y1, z1] = part.max;
      const g = bevelBox(Math.abs(y1 - y0), Math.abs(z1 - z0), Math.abs(x1 - x0), part.bevel);
      const c = frd((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
      fixed.add(mat[part.material], g.translate(c.x, c.y, c.z));
      return;
    }
    case 'frictionKnob': {
      const a = dir(part.axis);
      const p = at(part.pos);
      fixed.add(mat.chrome, stand(rod(0.004, 0.012, 10), a, p));
      fixed.add(mat.knobBlack, stand(prism(fluted(part.r, 22, 0.0016, 0.5), 0.014, 0.0012).rotateX(Math.PI / 2).translate(0, 0.016, 0), a, p));
      return;
    }
    case 'pullKnob': {
      const a = dir(part.axis);
      const p = at(part.pos);
      fixed.add(mat.chrome, stand(new THREE.CylinderGeometry(part.r * 0.6, part.r * 0.7, 0.004, 16).translate(0, 0.002, 0), a, p));
      fixed.add(mat.chrome, stand(rod(0.003, 0.016, 8), a, p));
      fixed.add(mat[part.material], stand(prism(fluted(part.r, 12, 0.0018, 0.5), 0.016, 0.0012).rotateX(Math.PI / 2).translate(0, 0.024, 0), a, p));
      return;
    }
    case 'trimKnob': {
      const a = dir(part.axis);
      const p = at(part.pos);
      fixed.add(mat.knobBlack, stand(prism(fluted(part.r, 16, 0.0012, 0.6), 0.012, 0.001).rotateX(Math.PI / 2).translate(0, 0.006, 0), a, p));
      // The pointer bar across its face.
      fixed.add(mat.knobWhite, stand(new THREE.BoxGeometry(0.003, 0.0016, part.r * 1.5).translate(0, 0.0125, -part.r * 0.25), a, p));
      return;
    }
    case 'flatWheel': {
      const a = dir(part.axis);
      const p = at(part.pos);
      fixed.add(mat.black, stand(prism(fluted(part.r, Math.round((2 * Math.PI * part.r) / 0.004), 0.0012, 0.5), part.width, 0.0008).rotateX(Math.PI / 2), a, p));
      return;
    }
    case 'tHandle': {
      const a = dir(part.axis);
      const p = at(part.pos);
      fixed.add(mat.chrome, stand(rod(0.003, 0.02, 8), a, p));
      fixed.add(mat[part.material], stand(new THREE.CapsuleGeometry(0.006, part.length - 0.012, 3, 10).rotateZ(Math.PI / 2).translate(0, 0.024, 0), a, p));
      return;
    }
    case 'frame': {
      const n = dir(part.normal).normalize();
      const up = dir(part.up).projectOnPlane(n).normalize();
      const right = new THREE.Vector3().crossVectors(up, n);
      const basis = new THREE.Matrix4().makeBasis(right, up, n);
      const p = at(part.pos);
      const t = 0.005;
      const put = (g: THREE.BufferGeometry): THREE.BufferGeometry => g.applyMatrix4(basis).translate(p.x, p.y, p.z);
      for (const s of [-1, 1]) {
        fixed.add(mat.black, put(bevelBox(part.w + t, t, part.lip, 0.0015).translate(0, (s * (part.h + t)) / 2, part.lip / 2)));
        fixed.add(mat.black, put(bevelBox(t, part.h + t, part.lip, 0.0015).translate((s * (part.w + t)) / 2, 0, part.lip / 2)));
      }
      return;
    }
    case 'rocker': {
      const a = dir(part.axis);
      const p = at(part.pos);
      const along = dir(part.along).projectOnPlane(a).normalize();
      // Spin about the axis so the rocker's length lies along `along`.
      const g = (geo: THREE.BufferGeometry): THREE.BufferGeometry => {
        const q = new THREE.Quaternion().setFromUnitVectors(Y_UP, a);
        const zAfter = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
        const spin = Math.atan2(new THREE.Vector3().crossVectors(zAfter, along).dot(a), zAfter.dot(along));
        return stand(geo, a, p, spin);
      };
      const s = part.size;
      fixed.add(mat.black, g(bevelBox(s * 0.9, 0.004, s * 1.6, 0.0012).translate(0, 0.002, 0)));
      fixed.add(mat.knobBlack, g(bevelBox(s * 0.55, 0.006, s * 1.2, 0.0015).rotateX(0.12).translate(0, 0.006, 0)));
      return;
    }
  }
}

// ---- Trim wheels -------------------------------------------------------------------------------------------------

/**
 * A knurled trim wheel turning about its own model x axis (the body's y; cockpit.ts turns it a quarter turn for an
 * x-axis wheel), centred on the origin: a fine knurl (~3.5 mm pitch) round the rim, a white index stripe on it, and the
 * hub faces a shade lighter. Its moulding and indicator go into `fixed` round `def.pos`.
 */
export function trimWheelParts(mat: AircraftMaterials, def: TrimWheelDef, fixed: MeshBatch, placards: PlacardAtlas): MeshBatch {
  const r = def.radius ?? 0.075;
  const w = def.width ?? 0.022;
  const b = new MeshBatch();
  // Outline in (z, y) extruded across x: the wheel turns about model x. A fine knurl (~3.5 mm pitch), or finger scallops
  // ~2 cm apart.
  const rim = def.grip === 'scallop' ? lobed(r, Math.round((2 * Math.PI * r) / 0.022), 0.0035) : knurl(r, Math.round((2 * Math.PI * r) / 0.0035), 0.0012);
  // No bevel: the knurl's own facets catch the light, and the wheel stays ~3 000 vertices (each one is baked for the
  // cabin occlusion).
  b.add(mat.black, prism(rim, w).rotateY(Math.PI / 2));
  // Index stripe across the rim, and a dished hub.
  b.add(mat.knobWhite, new THREE.BoxGeometry(w * 0.9, 0.0016, 0.006).translate(0, r + 0.0002, 0));
  for (const s of [-1, 1]) b.add(mat.knobBlack, new THREE.CylinderGeometry(r * 0.32, r * 0.36, 0.003, 24).rotateZ(Math.PI / 2).translate((s * w) / 2, 0, 0));
  const p = at(def.pos);
  // In model space the wheel turns about x for an axis 'y' wheel; about z for an axis 'x' one.
  const turn = def.axis === 'x' ? new THREE.Matrix4().makeRotationY(Math.PI / 2) : new THREE.Matrix4();
  if (def.housing === 'slot') {
    // The moulded bezel round the opening the rim shows through: the opening's plane 0.6 r out of the hub along the
    // face's normal. Built in a frame (x along the wheel's axis, y along the slot, z out of the face), then placed.
    const d = 0.6 * r;
    const half = Math.sqrt(r * r - d * d) + 0.006;
    const gap = w / 2 + 0.005;
    const frame = 0.007;
    const axis = new THREE.Vector3(1, 0, 0).applyMatrix4(turn);
    const n = dir(def.slotNormal ?? [-1, 0, 0]).projectOnPlane(axis).normalize();
    const along = new THREE.Vector3().crossVectors(n, axis).normalize();
    const basis = new THREE.Matrix4().makeBasis(axis, along, n);
    const put = (g: THREE.BufferGeometry): THREE.BufferGeometry => g.applyMatrix4(basis).translate(p.x, p.y, p.z);
    for (const s of [-1, 1]) {
      fixed.add(mat.black, put(bevelBox(frame, 2 * half + 2 * frame, 0.008, 0.002).translate(s * (gap + frame / 2), 0, d + 0.002)));
      fixed.add(mat.black, put(bevelBox(2 * gap + 2 * frame, frame, 0.008, 0.002).translate(0, s * (half + frame / 2), d + 0.002)));
    }
    // The well behind the rim.
    fixed.add(mat.black, put(new THREE.BoxGeometry(2 * gap, 2 * half, 0.004).translate(0, 0, -0.2 * r)));
  } else if (def.housing === 'side') {
    // A guard round the lower half of the wheel and a cheek plate on its outboard face (body -y for a left-side wheel).
    const m = new Mesher();
    // In body terms: the wheel's axis is y through def.pos; the guard spans angles 100..260 deg (aft-low to fore-low).
    const [cx, cy, cz] = def.pos;
    const out = cy < 0 ? -1 : 1;
    annularSector(m, cx, cz, r + 0.003, r + 0.011, Math.PI * 0.62, Math.PI * 1.42, cy - w / 2 - 0.006, cy + w / 2 + 0.006);
    annularSector(m, cx, cz, r * 0.25, r + 0.011, Math.PI * 0.62, Math.PI * 1.42, out < 0 ? cy - w / 2 - 0.01 : cy + w / 2 + 0.006, out < 0 ? cy - w / 2 - 0.006 : cy + w / 2 + 0.01);
    fixed.add(mat.panelPlastic, m.build());
  }
  const ind = def.indicator;
  if (ind) {
    // The indicator: a dark slot plate with its pointer at TAKE OFF, and the NOSE DN / NOSE UP legends at its ends.
    const n = dir(ind.normal).normalize();
    const up = dir(ind.up).projectOnPlane(n).normalize();
    const c = at(ind.pos);
    const q = new THREE.Quaternion().setFromUnitVectors(Y_UP, up);
    const plate = new THREE.BoxGeometry(0.012, ind.length, 0.003).applyQuaternion(q);
    fixed.add(mat.black, plate.translate(c.x, c.y, c.z));
    const pointer = new THREE.BoxGeometry(0.014, 0.003, 0.004).applyQuaternion(q);
    const pp = c.clone().addScaledVector(up, ind.length * 0.12).addScaledVector(n, 0.002);
    fixed.add(mat.knobWhite, pointer.translate(pp.x, pp.y, pp.z));
    const toFrd = (v: THREE.Vector3): FRD => [-v.z, v.x, -v.y];
    const labelUp = ind.labelUp ? toFrd(dir(ind.labelUp)) : toFrd(up);
    for (const [s, text] of [[1, 'NOSE UP'], [-1, 'NOSE DN']] as const) {
      const lp = c.clone().addScaledVector(up, s * (ind.length / 2 + 0.007));
      placards.add({ pos: toFrd(lp), normal: toFrd(n), up: labelUp, w: 0.024, h: 0.007, lines: [text], ink: 'white', ground: 'black' });
    }
  }
  return b;
}
