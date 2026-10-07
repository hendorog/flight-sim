// Airfield signs (AC 150/5340-18, AC 150/5345-44), all drawn into one canvas atlas and one mesh:
//   - runway holding position signs at A1-A4: mandatory "25-07" (white on red, the left number is the runway end to
//     the viewer's left) beside the location sign (yellow on black), with a location sign on the back;
//   - runway distance remaining signs (white numerals on black) every 1000 ft on the north side of the runway,
//     two-faced, the numbers on the two faces adding up to the runway length in thousands of feet;
//   - direction / location sign arrays on taxiway A before every junction ("A" location, then black-on-yellow
//     direction legends with arrows);
//   - the terminal's name board.
// Signs are internally lit: the material's emissive map is the atlas itself (AirportSystem sets the intensity).

import * as THREE from 'three';
import { AIRPORT } from '../../core/world';
import { boxGeo, GeometryBatch, placement } from './geom';
import { buildingByName, HOLD_LINE_V, PARALLEL_TAXIWAY_V, RUNWAY_CONNECTORS, RUNWAY_HALF_LENGTH, RUNWAY_HALF_WIDTH, TAXIWAY_WIDTH, TAXIWAYS } from './layout';

type Style = 'mandatory' | 'location' | 'direction' | 'distance' | 'board';
/** Arrow direction for direction legends, degrees clockwise from up (e.g. -90 = left, 45 = up-right). */
interface Segment {
  text: string;
  style: Style;
  arrow?: number;
  /** Draw the arrow after (right of) the text instead of before it. */
  arrowAfter?: boolean;
}
type Face = Segment[];
/** Face normal direction in the airport frame. */
type Normal = 'u+' | 'u-' | 'v+' | 'v-';

interface SignDef {
  u: number;
  v: number;
  normal: Normal;
  front: Face;
  back?: Face;
  /** Panel height, m (legend panel only; the cabinet adds a frame). */
  height: number;
  /** Height of the panel's bottom edge above the ground, m. */
  base: number;
}

const ROW_PX = 128;
const ATLAS_W = 2048;
const COLORS: Record<Style, { bg: string; fg: string }> = {
  mandatory: { bg: '#c8141e', fg: '#ffffff' },
  location: { bg: '#141414', fg: '#f2c200' },
  direction: { bg: '#f2c200', fg: '#141414' },
  distance: { bg: '#141414', fg: '#ffffff' },
  board: { bg: '#1c3a58', fg: '#f4f4f0' },
};

const FT = 0.3048;

/** The airport's signs. */
function signDefs(): SignDef[] {
  const defs: SignDef[] = [];
  const H = 0.76; // size 2 panel (30 in)
  // Holding position signs on the pilot's left when facing the runway (+v): larger u.
  for (const cn of RUNWAY_CONNECTORS) {
    const t = TAXIWAYS.find((s) => s.name === cn.name)!;
    defs.push({
      u: t.a.u + TAXIWAY_WIDTH / 2 + 4,
      v: HOLD_LINE_V - 0.5,
      normal: 'v-',
      front: [{ text: cn.name, style: 'location' }, { text: '25-07', style: 'mandatory' }],
      back: [{ text: cn.name, style: 'location' }],
      height: H,
      base: 0.35,
    });
  }
  // Distance remaining: the fractional 906 ft split between the two ends.
  const lengthFt = AIRPORT.runway.length / FT;
  const n = Math.floor(lengthFt / 1000);
  const start = (lengthFt - n * 1000) / 2;
  for (let j = 0; j < n; j++) {
    const d = (start + 1000 * j) * FT; // from the 07 threshold
    const u = -RUNWAY_HALF_LENGTH + d;
    if (TAXIWAYS.some((t) => t.a.u === t.b.u && Math.abs(t.a.u - u) < TAXIWAY_WIDTH)) continue;
    const for07 = n - j, for25 = n + 1 - for07;
    defs.push({
      u,
      v: -(RUNWAY_HALF_WIDTH + 17),
      normal: 'u-', // the 07 take-off roll comes from -u
      front: [{ text: String(for07), style: 'distance' }],
      back: [{ text: String(for25), style: 'distance' }],
      height: 1.1,
      base: 0.4,
    });
  }
  // Direction signs on taxiway A, on the left 25 m before each junction, for traffic in both directions.
  const A = TAXIWAYS[0];
  const uMin = Math.min(A.a.u, A.b.u), uMax = Math.max(A.a.u, A.b.u);
  for (const t of TAXIWAYS.slice(1)) {
    const toRunway = t.b.v > t.a.v; // A* connectors go to the runway (+v), B* to the apron (-v)
    for (const dir of [1, -1]) {
      const u = t.a.u - dir * (TAXIWAY_WIDTH / 2 + 25);
      if (u < uMin + 20 || u > uMax - 20) continue;
      // v is positive to the right when facing +u, so the left of a pilot moving along +u is -v.
      const v = PARALLEL_TAXIWAY_V - dir * (TAXIWAY_WIDTH / 2 + 9);
      // Arrow: a connector toward +v (the runway) turns off to the right of a pilot moving along +u.
      const left = (toRunway ? -1 : 1) * dir > 0;
      const face: Face = left
        ? [{ text: t.name, style: 'direction', arrow: -90 }, { text: 'A', style: 'location' }]
        : [{ text: 'A', style: 'location' }, { text: t.name, style: 'direction', arrow: 90, arrowAfter: true }];
      defs.push({ u, v, normal: dir > 0 ? 'u-' : 'u+', front: face, height: H, base: 0.35 });
    }
  }
  return defs;
}

// ---------------------------------------------------------------------------------------------------------------
// Atlas drawing

interface Placed {
  /** Atlas rectangle in px. */
  x: number;
  y: number;
  w: number;
}

function drawArrow(g: CanvasRenderingContext2D, cx: number, cy: number, size: number, deg: number, color: string): void {
  g.save();
  g.translate(cx, cy);
  g.rotate((deg * Math.PI) / 180);
  g.fillStyle = color;
  const s = size / 2;
  g.beginPath();
  g.moveTo(0, -s);
  g.lineTo(s * 0.75, -s * 0.1);
  g.lineTo(s * 0.22, -s * 0.1);
  g.lineTo(s * 0.22, s);
  g.lineTo(-s * 0.22, s);
  g.lineTo(-s * 0.22, -s * 0.1);
  g.lineTo(-s * 0.75, -s * 0.1);
  g.closePath();
  g.fill();
  g.restore();
}

class Atlas {
  readonly canvas = document.createElement('canvas');
  private readonly g: CanvasRenderingContext2D;
  private x = 0;
  private y = 0;

  constructor(rows: number) {
    this.canvas.width = ATLAS_W;
    this.canvas.height = ROW_PX * rows;
    this.g = this.canvas.getContext('2d')!;
    this.g.fillStyle = '#000';
    this.g.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  private font(px: number): string {
    return `bold ${px}px "DejaVu Sans Condensed", "Arial Narrow", "Helvetica Neue", Arial, sans-serif`;
  }

  /** Width in px of a face drawn at row height. */
  measure(face: Face): number {
    const g = this.g;
    let w = 0;
    for (const s of face) {
      g.font = this.font(s.style === 'board' ? ROW_PX * 0.5 : ROW_PX * 0.64);
      w += g.measureText(s.text).width + (s.style === 'board' ? ROW_PX * 0.8 : ROW_PX * 0.5) + (s.arrow !== undefined ? ROW_PX * 0.75 : 0);
    }
    return Math.ceil(w);
  }

  draw(face: Face): Placed {
    const g = this.g;
    const w = this.measure(face);
    if (this.x + w > ATLAS_W) {
      this.x = 0;
      this.y += ROW_PX;
    }
    const out = { x: this.x, y: this.y, w };
    let x = this.x;
    const y = this.y;
    for (const s of face) {
      const c = COLORS[s.style];
      const fontPx = s.style === 'board' ? ROW_PX * 0.5 : ROW_PX * 0.64;
      g.font = this.font(fontPx);
      const tw = g.measureText(s.text).width;
      const segW = tw + (s.style === 'board' ? ROW_PX * 0.8 : ROW_PX * 0.5) + (s.arrow !== undefined ? ROW_PX * 0.75 : 0);
      g.fillStyle = c.bg;
      g.fillRect(x, y, segW, ROW_PX);
      if (s.style === 'location') {
        g.strokeStyle = c.fg;
        g.lineWidth = 6;
        g.strokeRect(x + 9, y + 9, segW - 18, ROW_PX - 18);
      }
      let tx = x + (s.style === 'board' ? ROW_PX * 0.4 : ROW_PX * 0.25);
      if (s.arrow !== undefined && !s.arrowAfter) {
        drawArrow(g, tx + ROW_PX * 0.3, y + ROW_PX / 2, ROW_PX * 0.62, s.arrow, c.fg);
        tx += ROW_PX * 0.75;
      }
      g.fillStyle = c.fg;
      g.textAlign = 'left';
      g.textBaseline = 'middle';
      g.fillText(s.text, tx, y + ROW_PX / 2 + ROW_PX * 0.03);
      if (s.arrow !== undefined && s.arrowAfter) drawArrow(g, tx + tw + ROW_PX * 0.42, y + ROW_PX / 2, ROW_PX * 0.62, s.arrow, c.fg);
      x += segW;
      // Thin black separator between segments of an array.
      g.fillStyle = '#000';
      g.fillRect(x - 2, y, 4, ROW_PX);
    }
    this.x += w + 8;
    return out;
  }
}

/** A plane for one face: width w (m), height h, UVs from the atlas rectangle. */
function facePlane(p: Placed, atlas: HTMLCanvasElement, w: number, h: number): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(w, h);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  const W = atlas.width, Hh = atlas.height;
  for (let k = 0; k < uv.count; k++) {
    const x = (p.x + uv.getX(k) * p.w) / W;
    const y = 1 - (p.y + (1 - uv.getY(k)) * ROW_PX) / Hh;
    uv.setXY(k, x, y);
  }
  return g;
}

const NORMAL_ROT: Record<Normal, number> = { 'v-': -Math.PI / 2, 'v+': Math.PI / 2, 'u+': Math.PI, 'u-': 0 };

export function createSigns(anisotropy: number): { mesh: THREE.Mesh; material: THREE.MeshStandardMaterial } {
  const defs = signDefs();
  const terminal = buildingByName('Terminal');
  const boardFace: Face = [{ text: 'FABLE REGIONAL AIRPORT  ·  KFBL', style: 'board' }];
  const atlas = new Atlas(8);
  const faces = new GeometryBatch();
  const frames = new GeometryBatch();

  for (const d of defs) {
    const pf = atlas.draw(d.front);
    const pb = d.back ? atlas.draw(d.back) : null;
    const wf = (pf.w / ROW_PX) * d.height, wb = pb ? (pb.w / ROW_PX) * d.height : 0;
    const L = Math.max(wf, wb);
    const rot = NORMAL_ROT[d.normal];
    // Local offsets rotated like the face: +z of the plane maps to the face normal.
    const nx = Math.sin(rot), nz = Math.cos(rot);
    const x = d.v, z = -d.u, y = d.base + d.height / 2;
    const depth = 0.24;
    faces.add(facePlane(pf, atlas.canvas, wf, d.height), placement(x + nx * (depth / 2 + 0.005), y, z + nz * (depth / 2 + 0.005), rot));
    if (pb) faces.add(facePlane(pb, atlas.canvas, wb, d.height), placement(x - nx * (depth / 2 + 0.005), y, z - nz * (depth / 2 + 0.005), rot + Math.PI));
    frames.add(boxGeo(L + 0.08, d.height + 0.08, depth), placement(x, y, z, rot), 0x2c2e30);
    // Two frangible legs.
    const tx = Math.cos(rot), tz = -Math.sin(rot); // along the panel
    for (const s of [-1, 1]) {
      const o = s * (L / 2 - 0.3);
      frames.add(boxGeo(0.06, d.base, 0.06), placement(x + tx * o, d.base / 2, z + tz * o), 0x505254);
    }
  }
  // Terminal name board on the airside parapet (the dark panel in buildings.ts), 16 m long.
  {
    const p = atlas.draw(boardFace);
    const h = 1.3, w = Math.min((p.w / ROW_PX) * h, 15.8);
    const cu = (terminal.u0 + terminal.u1) / 2;
    faces.add(facePlane(p, atlas.canvas, w, h), placement(terminal.v1 - 0.14, terminal.height + 1.05, -cu, Math.PI / 2));
  }

  const tex = new THREE.CanvasTexture(atlas.canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = anisotropy;
  const material = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.6 });
  const mesh = new THREE.Mesh(faces.build(), material);
  const frame = new THREE.Mesh(frames.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }));
  frame.castShadow = true;
  frame.receiveShadow = true;
  mesh.add(frame);
  mesh.name = 'signs';
  mesh.receiveShadow = true;
  return { mesh, material };
}
