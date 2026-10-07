// Procedural paint scheme, panel lines, rivets and window masks, baked on the CPU into textures laid out
// on the fuselage's (s, t) surface parameterisation (see fuselageShape.ts). Every texel is evaluated from
// its true 3D body position, so stripes stay straight in side view, the registration reads correctly on
// both sides and window edges are exact, with no UV-unwrapping distortion.
//
// Textures:
//   colour  RGBA  paint colour (sRGB) + skin opacity in alpha (0 = window / inlet opening)
//   detail  RG    R = bump height (0.5 = flush skin, lines recessed, rivet heads raised), G = roughness
//   glass   G     glazing coverage (the windows, extended 5 mm under the skin edge)      } cabin stations
//   lining  G     cabin-lining coverage (window openings inset so the trim overlaps)    } only

import * as THREE from 'three';
import { C172S_VISUAL } from '../../aircraft/c172s/visual';
import type { AirframeVisualDef, GlazingDef, InletDef, OutlineDef } from './airframe/types';
import { FuselageShape, Ring } from './fuselageShape';
import { Pchip } from './geometry';

/** The Cessna 172S registration (the default airframe definition's). */
export const REGISTRATION = C172S_VISUAL.livery.registration;

/**
 * Paint colours, sRGB 0..255: the Cessna 172S scheme (white, navy band, red accent) and what every scheme
 * shares (window seals, exhaust soot, the dark of an inlet).
 */
export const PAINT = {
  white: C172S_VISUAL.livery.palette.base,
  navy: C172S_VISUAL.livery.palette.band,
  red: C172S_VISUAL.livery.palette.accent,
  seal: [22, 22, 24],
  soot: [52, 46, 40],
  inlet: [14, 14, 15],
} as const;

// --- Signed-distance helpers (metres; negative inside) ------------------------------------------------

/** Rounded intersection of two SDFs (Quilez): convex corners get radius r. */
function intersectRound(a: number, b: number, r: number): number {
  const ux = Math.max(r + a, 0);
  const uy = Math.max(r + b, 0);
  return Math.min(-r, Math.max(a, b)) + Math.sqrt(ux * ux + uy * uy);
}

interface HalfPlane {
  nx: number;
  nz: number;
  d: number;
}

/** A convex window outline in side projection (body x, z), corners rounded with radius r. */
class ConvexOutline {
  private readonly planes: HalfPlane[] = [];
  /** Bounding box, used to skip the exact distance far from the outline. */
  readonly x0: number;
  readonly x1: number;
  private readonly z0: number;
  private readonly z1: number;

  constructor(
    pts: readonly (readonly [number, number])[],
    private readonly r: number,
  ) {
    this.x0 = Math.min(...pts.map((p) => p[0]));
    this.x1 = Math.max(...pts.map((p) => p[0]));
    this.z0 = Math.min(...pts.map((p) => p[1]));
    this.z1 = Math.max(...pts.map((p) => p[1]));
    let cx = 0;
    let cz = 0;
    for (const p of pts) {
      cx += p[0] / pts.length;
      cz += p[1] / pts.length;
    }
    for (let i = 0; i < pts.length; i++) {
      const [x0, z0] = pts[i];
      const [x1, z1] = pts[(i + 1) % pts.length];
      let nx = z1 - z0;
      let nz = -(x1 - x0);
      const l = Math.hypot(nx, nz);
      nx /= l;
      nz /= l;
      if (nx * (cx - x0) + nz * (cz - z0) > 0) {
        nx = -nx;
        nz = -nz;
      }
      this.planes.push({ nx, nz, d: -(nx * x0 + nz * z0) });
    }
  }

  /** Signed distance; outside the bounding box it returns the (smaller) distance to the box. */
  sdf(x: number, z: number): number {
    const bx = Math.max(this.x0 - x, x - this.x1);
    const bz = Math.max(this.z0 - z, z - this.z1);
    if (bx > 0 || bz > 0) return Math.max(bx, bz);
    let d = -Infinity;
    for (const p of this.planes) {
      const e = p.nx * x + p.nz * z + p.d;
      d = d === -Infinity ? e : intersectRound(d, e, this.r);
    }
    return d;
  }
}

// --- Openings -----------------------------------------------------------------------------------------

function lineSdf(x: number, z: number, a: readonly [number, number], b: readonly [number, number]): number {
  // Positive to the aft side of the line a -> b (a below b).
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const l = Math.hypot(dx, dz);
  return ((x - a[0]) * dz - (z - a[1]) * dx) / l;
}

/**
 * Windscreen: bounded below by a plane through the glareshield sill (centre) and the lower corners, aft by the
 * A-pillar line, above by `topX` (the wing leading edge of a high wing).
 *
 * postY is the half-width inboard of which the windscreen is on the cabin top rather than its sides. The A-post
 * edge is a side-projection line, and near its top end that line also crosses the side projection of the roof
 * itself (the roof rises to the wing leading edge through the same x, z), so applied everywhere it would close
 * the upper centre of the windscreen well below the wing: the post bounds the glass only on the sides.
 */
function windscreenSdf(w: NonNullable<GlazingDef['windscreen']>, x: number, y: number, z: number): number {
  const sill = (x - w.sillC[0]) * w.sillN[0] + (z - w.sillC[1]) * w.sillN[1];
  const post = lineSdf(x, z, w.post[0], w.post[1]) - Math.max(0, w.postY - Math.abs(y));
  const top = w.topX - x;
  return intersectRound(intersectRound(sill, post, 0.025), top, 0.015);
}

/** An outline of the definition with its distance function; side 0 = both sides, -1 left, 1 right. */
interface SidedOutline {
  outline: ConvexOutline;
  side: 0 | 1 | -1;
  maxX: number;
}

const sided = (o: OutlineDef): SidedOutline => ({
  outline: new ConvexOutline(o.pts, o.r),
  side: o.sides === 'both' ? 0 : o.sides === 'left' ? -1 : 1,
  maxX: o.maxX ?? Infinity,
});

/** Distance to the nearest window edge (negative inside a window) at a body point. */
export type WindowSdf = (x: number, y: number, z: number) => number;

/** The window distance of a glazing definition: the windscreen and every side-projection outline. */
export function makeWindowSdf(g: GlazingDef): WindowSdf {
  const [front, rear] = g.xRange ?? [g.cabinFrontX, g.cabinRearX];
  const screen = g.windscreen;
  const windows = g.windows.map(sided);
  return (x, y, z) => {
    if (x > front || x < rear) return 1;
    let d = screen ? windscreenSdf(screen, x, y, z) : Infinity;
    for (let i = 0; i < windows.length; i++) {
      const w = windows[i];
      if (x < w.maxX && (w.side === 0 || (y < 0 ? -1 : 1) === w.side)) d = Math.min(d, w.outline.sdf(x, z));
    }
    return d;
  };
}

/** Distance to the nearest window edge of the Cessna 172S (negative inside a window). */
export const windowSdf: WindowSdf = makeWindowSdf(C172S_VISUAL.glazing);

/**
 * Relief of the moulded cabin lining (0.5 = the plain surface), baked into the lining texture's R channel
 * and used as its bump map: a raised, rounded surround around every window opening, the parting line of
 * every door (a groove along its outline, on the sides it is on), and the headliner's seams across the roof
 * with the fabric pillowing slightly between them.
 * @param w the window distance at the point
 */
function liningRelief(headliner: GlazingDef['headliner'], doors: readonly SidedOutline[], x: number, y: number, z: number, w: number): number {
  // Window surround: rises over 5 mm from the opening's edge (-8 mm), plateau, falls off 1-3.5 cm out.
  let h = 0.5 + 0.35 * smooth(-0.008, -0.003, w) * (1 - smooth(0.01, 0.035, w));
  if (Math.abs(y) > 0.3) {
    for (let i = 0; i < doors.length; i++) {
      const d = doors[i];
      if (d.side === 0 || (y < 0 ? -1 : 1) === d.side) h -= 0.3 * (1 - smooth(0.0015, 0.004, Math.abs(d.outline.sdf(x, z))));
    }
  }
  // Headliner: fabric stretched between transverse bows.
  if (headliner && z < headliner.z0 && x < headliner.x0 && x > headliner.x1) {
    const roof = smooth(headliner.z0, headliner.z1, z);
    const f = (((x + 2) / headliner.pitch) % 1 + 1) % 1;
    const seam = 1 - smooth(0.004, 0.012, Math.min(f, 1 - f) * headliner.pitch);
    h += roof * (0.12 * Math.sin(Math.PI * f) - 0.3 * seam);
  }
  return Math.min(1, Math.max(0, h));
}

/** An air inlet as its outline is computed: centre (y, z), semi-axes, superellipse exponent n; open forward of xMin. */
export interface InletShape {
  y: number;
  z: number;
  ry: number;
  rz: number;
  n: number;
  xMin: number;
}

/** The outline of a fuselage inlet of the definition (seen from ahead, projected along the body x axis). */
export function inletShape(i: InletDef, frontX = C172S_VISUAL.fuselage.frontX): InletShape {
  return { y: i.y, z: i.z, ry: i.w / 2, rz: i.h / 2, n: i.exponent ?? 3.2, xMin: i.xMin ?? frontX - 0.105 };
}

/**
 * Cowling air inlets of the Cessna 172S either side of the spinner: rounded-rectangle openings about 0.2 m wide
 * and 0.12 m tall. INLET is the right-hand one; the left mirrors it.
 */
export const INLET: InletShape = inletShape(C172S_VISUAL.fuselage.inlets[0]);
const C172S_INLETS: readonly InletShape[] = C172S_VISUAL.fuselage.inlets.map((i) => inletShape(i));

/** Point on the inlet outline at angle a (y, z relative to the inlet centre), scaled by `grow` m outward. */
export function inletOutline(a: number, grow = 0, inlet: InletShape = INLET): [number, number] {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const e = 2 / inlet.n;
  return [Math.sign(c) * Math.pow(Math.abs(c), e) * (inlet.ry + grow), Math.sign(s) * Math.pow(Math.abs(s), e) * (inlet.rz + grow)];
}

export function inletSdf(x: number, y: number, z: number, inlets: readonly InletShape[] = C172S_INLETS): number {
  let d = Infinity;
  for (let i = 0; i < inlets.length; i++) {
    const inlet = inlets[i];
    if (x < inlet.xMin) continue;
    const dy = Math.abs((y - inlet.y) / inlet.ry);
    const dz = Math.abs((z - inlet.z) / inlet.rz);
    // Superellipse "radius" (1 on the outline); close enough to a distance near the edge for anti-aliasing.
    d = Math.min(d, (Math.pow(Math.pow(dy, inlet.n) + Math.pow(dz, inlet.n), 1 / inlet.n) - 1) * Math.min(inlet.ry, inlet.rz));
  }
  return d === Infinity ? 1 : d;
}

// --- Stripes and registration -------------------------------------------------------------------------

const smooth = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Registration lettering rendered once in side projection and sampled per texel. */
class Lettering {
  private readonly data: Uint8ClampedArray;
  private readonly w: number;
  private readonly h: number;
  private readonly x0: number;
  private readonly x1: number;
  private readonly z0: number;
  private readonly z1: number;
  static readonly PX_PER_M = 1400;

  /** @param box the lettering's place on the body side: stations x0 < x1 and heights z0 < z1 */
  constructor(text: string, box: { x0: number; x1: number; z0: number; z1: number }) {
    this.x0 = box.x0;
    this.x1 = box.x1;
    this.z0 = box.z0;
    this.z1 = box.z1;
    this.w = Math.round((this.x1 - this.x0) * Lettering.PX_PER_M);
    this.h = Math.round((this.z1 - this.z0) * Lettering.PX_PER_M);
    // A DOM canvas on the main thread, an OffscreenCanvas inside the bake worker (liveryWorker.ts).
    const c: HTMLCanvasElement | OffscreenCanvas =
      typeof document !== 'undefined' ? Object.assign(document.createElement('canvas'), { width: this.w, height: this.h }) : new OffscreenCanvas(this.w, this.h);
    const g = c.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
    const cap = this.h * 0.84;
    g.font = `700 ${cap}px "Helvetica Neue", Arial, "DejaVu Sans", sans-serif`;
    g.textBaseline = 'middle';
    g.textAlign = 'center';
    g.fillStyle = '#fff';
    // Letter spacing like the stencil-cut vinyl on a real aircraft.
    const spacing = cap * 0.12;
    const widths = [...text].map((ch) => g.measureText(ch).width);
    const total = widths.reduce((a, b) => a + b, 0) + spacing * (text.length - 1);
    const scale = Math.min(1, (this.w * 0.98) / total);
    g.setTransform(scale, 0, 0, 1, this.w / 2 - (total * scale) / 2, 0);
    let x = 0;
    [...text].forEach((ch, i) => {
      g.fillText(ch, x + widths[i] / 2, this.h / 2);
      x += widths[i] + spacing;
    });
    this.data = g.getImageData(0, 0, this.w, this.h).data;
  }

  /** Coverage 0..1 at body (x, z) on the given side, bilinear. */
  sample(x: number, z: number, right: boolean): number {
    if (x < this.x0 || x > this.x1 || z < this.z0 || z > this.z1) return 0;
    // Text reads left to right as the viewer sees it: aft-to-forward on the right side, forward-to-aft on the left.
    const u = right ? (x - this.x0) * Lettering.PX_PER_M : (this.x1 - x) * Lettering.PX_PER_M;
    const v = (z - this.z0) * Lettering.PX_PER_M;
    const i = Math.min(this.w - 2, Math.max(0, Math.floor(u)));
    const j = Math.min(this.h - 2, Math.max(0, Math.floor(v)));
    const fu = u - i;
    const fv = v - j;
    const d = this.data;
    const w = this.w;
    const a = d[(j * w + i) * 4];
    const b = d[(j * w + i + 1) * 4];
    const c = d[((j + 1) * w + i) * 4];
    const e = d[((j + 1) * w + i + 1) * 4];
    return ((a * (1 - fu) + b * fu) * (1 - fv) + (c * (1 - fu) + e * fu) * fv) / 255;
  }
}

// --- Noise for roughness variation --------------------------------------------------------------------

/** Tileable value noise from a 256 x 256 random table, sampled in texel units (cheap enough per texel). */
class NoiseTable {
  private readonly v = new Float32Array(256 * 256);

  constructor(seed: number) {
    let h = seed >>> 0;
    for (let i = 0; i < this.v.length; i++) {
      h = Math.imul(h ^ (h >>> 15), 2246822519) + 0x9e3779b9;
      h ^= h >>> 13;
      this.v[i] = (h >>> 0) / 4294967295;
    }
  }

  at(u: number, v: number): number {
    const xi = Math.floor(u);
    const yi = Math.floor(v);
    let fx = u - xi;
    let fy = v - yi;
    fx = fx * fx * (3 - 2 * fx);
    fy = fy * fy * (3 - 2 * fy);
    const x0 = xi & 255;
    const y0 = yi & 255;
    const x1 = (x0 + 1) & 255;
    const y1 = (y0 + 1) & 255;
    const t = this.v;
    const a = t[y0 * 256 + x0] + (t[y0 * 256 + x1] - t[y0 * 256 + x0]) * fx;
    const b = t[y1 * 256 + x0] + (t[y1 * 256 + x1] - t[y1 * 256 + x0]) * fx;
    return a + (b - a) * fy;
  }
}

// --- Bake ---------------------------------------------------------------------------------------------

export interface FuselageTextures {
  colour: THREE.DataTexture;
  detail: THREE.DataTexture;
  glass: THREE.DataTexture;
  lining: THREE.DataTexture;
}

/** Raw RGBA8 texel data of one baked texture. */
export interface BakedImage {
  data: Uint8Array;
  width: number;
  height: number;
}

/** The baked texel data of all four fuselage textures (what the bake worker sends back). */
export interface FuselageTextureData {
  colour: BakedImage;
  detail: BakedImage;
  glass: BakedImage;
  lining: BakedImage;
}

/** Texture parameters per image (the colour map is sRGB, the rest are data). */
const SRGB: Record<keyof FuselageTextureData, boolean> = { colour: true, detail: false, glass: false, lining: false };

/** Wrap baked data in textures. */
export function fuselageTextures(d: FuselageTextureData): FuselageTextures {
  return {
    colour: dataTexture(d.colour.data, d.colour.width, d.colour.height, SRGB.colour),
    detail: dataTexture(d.detail.data, d.detail.width, d.detail.height, SRGB.detail),
    glass: dataTexture(d.glass.data, d.glass.width, d.glass.height, SRGB.glass),
    lining: dataTexture(d.lining.data, d.lining.width, d.lining.height, SRGB.lining),
  };
}

/**
 * Stand-in textures to build the materials with while the bake runs in a worker: fully painted white
 * skin and closed lining (so the materials compile with the same maps), replaced in place by
 * applyFuselageTextureData() when the bake arrives.
 */
export function placeholderFuselageTextures(base: readonly number[] = PAINT.white): FuselageTextures {
  const px = (r: number, g: number, b: number, a: number): BakedImage => ({ data: new Uint8Array([r, g, b, a]), width: 1, height: 1 });
  return fuselageTextures({
    colour: px(base[0], base[1], base[2], 255),
    detail: px(128, 88, 0, 255),
    glass: px(0, 255, 0, 255),
    lining: px(0, 255, 0, 255),
  });
}

/** Swap baked data into existing textures (same formats, so no material recompiles). */
export function applyFuselageTextureData(t: FuselageTextures, d: FuselageTextureData): void {
  for (const k of ['colour', 'detail', 'glass', 'lining'] as const) {
    const tex = t[k];
    // Free the GPU copy first: its storage was allocated (texStorage2D) at the placeholder's 1x1 size, and
    // three would otherwise upload the baked image into it with texSubImage2D (GL_INVALID_VALUE, the
    // livery never appears). The next use re-allocates at the new size; materials keep their programs.
    tex.dispose();
    tex.image = { data: d[k].data, width: d[k].width, height: d[k].height };
    tex.needsUpdate = true;
  }
}

function dataTexture(data: Uint8Array, w: number, h: number, srgb: boolean): THREE.DataTexture {
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

/**
 * Walk every texel of a W x H texture on a shape's (s, t) grid (s from s0 to s1) column by column. `column(x)` runs once per
 * body station (for work that depends on x only); `texel` gets the body point, the arc length around the
 * section from the bottom centreline, the row and the byte index.
 */
function forEachTexel(
  shape: FuselageShape,
  W: number,
  H: number,
  column: (x: number) => void,
  texel: (x: number, y: number, z: number, arc: number, row: number, idx: number) => void,
  s0 = 0,
  s1 = 1,
): void {
  const ring = new Ring();
  const p = { y: 0, z: 0 };
  for (let col = 0; col < W; col++) {
    const x = shape.x(s0 + ((s1 - s0) * (col + 0.5)) / W);
    ring.set(shape.section(x));
    column(x);
    for (let row = 0; row < H; row++) {
      const t = (row + 0.5) / H;
      ring.at(t, p);
      texel(x, p.y, p.z, t * ring.circumference, row, (row * W + col) * 4);
    }
  }
}

const AA = 0.0016;

/** Paint accumulator of the texel being baked (avoids a closure per texel). */
const rgb = new Float64Array(3);
function mix(c: readonly number[], k: number): void {
  rgb[0] += (c[0] - rgb[0]) * k;
  rgb[1] += (c[1] - rgb[1]) * k;
  rgb[2] += (c[2] - rgb[2]) * k;
}

/** Recessed panel line profile: 1 on the line, 0 away from it. */
const grooveK = (d: number, w = 0.0011): number => 1 - smooth(w * 0.4, w + AA, Math.abs(d));

/** Raised rivet head at distance (dx, along) from a row with the given pitch: 0..1. */
function rivetK(dx: number, along: number, pitch: number): number {
  const q = along / pitch - Math.floor(along / pitch) - 0.5;
  const da = q * pitch;
  return 1 - smooth(0.0012, 0.0024, Math.sqrt(dx * dx + da * da));
}

export function bakeFuselageTextures(outer: FuselageShape, glassShape: FuselageShape, lining: FuselageShape, def: AirframeVisualDef = C172S_VISUAL): FuselageTextures {
  return fuselageTextures(bakeFuselageData(outer, glassShape, lining, def));
}

/**
 * Bake the four fuselage textures' texel data (~0.7-1 s; runs in liveryWorker.ts in the simulator).
 * @param def the airframe whose shapes these are: its paint scheme, glazing, door lines and inlets
 */
export function bakeFuselageData(outer: FuselageShape, glassShape: FuselageShape, lining: FuselageShape, def: AirframeVisualDef = C172S_VISUAL): FuselageTextureData {
  const { livery, glazing } = def;
  const W = livery.texture.w;
  const H = livery.texture.h;
  const colour = new Uint8Array(W * H * 4);
  const detail = new Uint8Array(W * H * 4);
  const letters = new Lettering(livery.registration, livery.lettering);
  const noise = new NoiseTable(1729);
  const base = livery.palette.base;
  const band = livery.palette.band;
  const accent = livery.palette.accent;
  const accentBelow = livery.accentBelow === true;
  const stripeCentre = new Pchip(livery.stripe.xs, livery.stripe.centre);
  const stripeHalf = new Pchip(livery.stripe.xs, livery.stripe.half);
  const shearX = livery.stripe.noseShearX;
  const windowAt = def === C172S_VISUAL ? windowSdf : makeWindowSdf(glazing);
  const [windowsFront, windowsRear] = glazing.xRange ?? [glazing.cabinFrontX, glazing.cabinRearX];
  const inlets = def.fuselage.inlets.map((i) => inletShape(i, def.fuselage.frontX));
  const inletXMin = Math.min(...inlets.map((i) => i.xMin));
  const doors = glazing.doors.map(sided);
  const firewallX = glazing.firewallX;
  const splitZ = livery.cowlSplitZ;
  const soot = livery.soot;
  // Rivets, camlocs and the like are a metal airframe's; a composite one is smooth.
  const metal = livery.construction === 'metal';
  const splitEndX = livery.cowl?.splitEndX ?? def.fuselage.frontX - 0.045;
  const camlocEndX = livery.cowl?.camlocEndX ?? def.fuselage.frontX - 0.105;
  const grille = livery.cowl?.grille;
  const oilDoor = livery.cowl?.oilDoor;
  const floorRivets = metal ? livery.floorRivets : undefined;

  // Per-column state (depends only on the body station x).
  let col = -1;
  let zc = 0;
  let hb = 0;
  let onSide = false;
  let windows = false;
  const nearDoor = doors.map(() => false);
  let fireGroove = 0;
  let jointGroove = 0;
  let jointRivetX = NaN;
  let sootX = 0;
  let sootW = 1;
  let sootY = 0;
  let camlocQ = NaN;
  const column = (x: number): void => {
    col++;
    onSide = x < shearX + 0.005 && x > def.fuselage.endX + 0.05;
    zc = stripeCentre.eval(x);
    hb = stripeHalf.eval(x);
    windows = x <= windowsFront && x >= windowsRear;
    for (let i = 0; i < doors.length; i++) nearDoor[i] = x > doors[i].outline.x0 - 0.01 && x < doors[i].outline.x1 + 0.01;
    fireGroove = grooveK(x - firewallX);
    jointGroove = 0;
    jointRivetX = NaN;
    for (const xr of livery.skinJoints) {
      jointGroove = Math.max(jointGroove, grooveK(x - xr, 0.0009));
      if (metal && Math.abs(x - xr) < 0.03) jointRivetX = x - xr;
    }
    if (soot) {
      const dx = soot.x - x;
      sootX = x < soot.x ? Math.exp(-dx / 1.6) * 0.75 : 0;
      sootW = 0.045 + dx * 0.07;
      sootY = soot.y + dx * 0.025;
    }
    camlocQ = metal && x > firewallX + 0.02 && x < camlocEndX ? (((x - firewallX) / 0.11) % 1) - 0.5 : NaN;
  };

  forEachTexel(outer, W, H, column, (x, y, z, tArc, row, i) => {
    const right = y >= 0;
    // --- openings ---
    const win = windows ? windowAt(x, y, z) : 1;
    const inlet = x > inletXMin ? inletSdf(x, y, z, inlets) : 1;
    const alpha = smooth(-AA, AA, Math.min(win, inlet));

    // --- paint ---
    rgb[0] = base[0];
    rgb[1] = base[1];
    rgb[2] = base[2];
    let rough = 0.34;
    if (onSide) {
      // Main band, with a sheared nose end so it sweeps rather than stopping square; accent line above (or below).
      const keep = 1 - smooth(shearX - AA, shearX + AA, x + (z - zc) * 0.6);
      const dz = Math.abs(z - zc);
      if (dz < hb + 0.045) {
        mix(band, (1 - smooth(hb - AA, hb + AA, dz)) * keep);
        mix(accent, (1 - smooth(0.0085 - AA, 0.0085 + AA, Math.abs(z - (accentBelow ? zc + hb + 0.024 : zc - hb - 0.024)))) * keep);
      }
    }
    const reg = letters.sample(x, z, right);
    if (reg > 0) mix(band, reg);
    // Cowling induction-air inlet grille below the spinner.
    if (grille && x > grille.x && z > grille.z0 && z < grille.z1 && Math.abs(y) < grille.halfWidth) mix(PAINT.inlet, (((y * 90) % 1) + 1) % 1 < 0.35 ? 0.7 : 1);
    // Window rubber seals and inlet lips.
    const seal = win > -0.002 && win < 0.011;
    if (seal) mix(PAINT.seal, 1 - smooth(0.009, 0.011, win));
    if (inlet > -0.002 && inlet < 0.006) mix(PAINT.inlet, 0.7 * (1 - smooth(0.004, 0.006, inlet)));
    // Exhaust soot streaking aft along the belly from the stack on the lower cowl.
    if (sootX > 0.01 && z > 0.12) {
      const q = (y - sootY) / sootW;
      const streak = Math.exp(-q * q) * sootX * smooth(0.12, 0.34, z);
      mix(PAINT.soot, streak);
      rough += streak * 0.4;
    }
    // Blotchy wear (~0.3 m) and fine orange-peel variation, in texel space.
    rough += (noise.at(col / 150, row / 170) - 0.5) * 0.1 + (noise.at(col / 19 + 97, row / 23 + 31) - 0.5) * 0.04;
    if (seal) rough = 0.75;

    // --- panel lines and rivets ---
    let groove = Math.max(fireGroove, jointGroove);
    // The cowling's split line, and the oil filler door in its top.
    if (splitZ !== undefined && x > firewallX && x < splitEndX) groove = Math.max(groove, grooveK(z - splitZ));
    if (oilDoor && z < -0.15 && Math.abs(x - oilDoor.x) < oilDoor.halfLength + 0.02 && Math.abs(y) < oilDoor.halfWidth + 0.03)
      groove = Math.max(groove, grooveK(intersectRound(Math.abs(x - oilDoor.x) - oilDoor.halfLength, Math.abs(y) - oilDoor.halfWidth, 0.02)));
    for (let d = 0; d < doors.length; d++) {
      const door = doors[d];
      if (nearDoor[d] && (door.side === 0 || right === door.side > 0)) groove = Math.max(groove, grooveK(door.outline.sdf(x, z)));
    }
    let h = 0.5 - 0.32 * groove;
    rough += 0.25 * groove;
    // Rivets: circumferential rows beside each tail-cone joint, a row along the cabin floor line.
    if (jointRivetX === jointRivetX) h += 0.16 * Math.max(rivetK(jointRivetX - 0.013, tArc, 0.028), rivetK(jointRivetX + 0.013, tArc, 0.028));
    if (floorRivets && x < firewallX && x > floorRivets.x1 && Math.abs(z - floorRivets.z) < 0.01) h += 0.16 * rivetK(z - floorRivets.z, x, 0.03);
    // Camloc fasteners along the cowling split line: a ring with a slotted centre.
    if (splitZ !== undefined && camlocQ === camlocQ && Math.abs(z - (splitZ + 0.012)) < 0.008) {
      const dq = camlocQ * 0.11;
      const dz = z - (splitZ + 0.012);
      const dd = Math.sqrt(dq * dq + dz * dz);
      if (dd < 0.0065) {
        h += dd > 0.0045 ? 0.12 : -0.05;
        rough += 0.1;
      }
    }

    colour[i] = rgb[0];
    colour[i + 1] = rgb[1];
    colour[i + 2] = rgb[2];
    colour[i + 3] = alpha * 255;
    detail[i] = Math.min(255, Math.max(0, h * 255));
    detail[i + 1] = Math.min(255, Math.max(0, rough * 255));
    detail[i + 3] = 255;
  });

  // Glazing and lining masks cover the cabin only (their meshes' u runs over the same range). The lining
  // edge is seen from 0.3 m in the cockpit, so it gets ~1.5 mm texels; the glazing edge hides under the skin.
  const none = (): void => {};
  const GW = 1024;
  const GH = 512;
  const glass = new Uint8Array(GW * GH * 4);
  forEachTexel(
    glassShape,
    GW,
    GH,
    none,
    (x, y, z, _arc, _row, i) => {
      glass[i + 1] = (1 - smooth(0.004, 0.006, windowAt(x, y, z))) * 255;
      glass[i + 3] = 255;
    },
    glassShape.s(glazing.cabinFrontX),
    glassShape.s(glazing.cabinRearX),
  );
  const LW = 2048;
  const LH = 2048;
  const lin = new Uint8Array(LW * LH * 4);
  forEachTexel(
    lining,
    LW,
    LH,
    none,
    (x, y, z, _arc, _row, i) => {
      // Lining openings are 8 mm smaller than the skin's so the trim hides the gap between the two shells
      // (and the glazing's edge under the skin) from the seats.
      const w = windowAt(x, y, z);
      lin[i + 1] = smooth(-0.01, -0.006, w) * 255;
      lin[i] = liningRelief(glazing.headliner, doors, x, y, z, w) * 255;
      lin[i + 3] = 255;
    },
    lining.s(glazing.cabinFrontX),
    lining.s(glazing.cabinRearX),
  );

  return {
    colour: { data: colour, width: W, height: H },
    detail: { data: detail, width: W, height: H },
    glass: { data: glass, width: GW, height: GH },
    lining: { data: lin, width: LW, height: LH },
  };
}
