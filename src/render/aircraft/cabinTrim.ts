// Moulded cabin trim fitted to the cabin lining: the side-wall panels of the airframe definition
// (CockpitDef.trimPanels; the Cessna 172S: door panels, a plastic moulding with an integrated armrest and a
// padded insert with a map pocket, the dark kick panels in the footwells, the carpeted lower sidewalls, the
// rear side panels with their armrests and the baggage-bay side panels), the door and window latches and
// the toe boards.
//
// Every panel is a height field over the lining: a grid on the lining surface (FuselageShape, the same loft
// the lining mesh uses), pushed inboard by h(x, z) metres, so it follows the cabin's curvature exactly and
// its mouldings (armrest, pocket lip, rounded edges) are part of one smooth surface. Body (FRD) axes, m.

import * as THREE from 'three';
import { C172S_VISUAL } from '../../aircraft/c172s/visual';
import type { CockpitDef, VisualTrimPanelDef } from './airframe/types';
import { sectionHalfWidth } from './fuselage';
import { type FuselageShape, Ring } from './fuselageShape';
import { frd, gridGeometry, type MeshBatch } from './geometry';
import type { AircraftMaterials } from './materials';

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** 0 on the border of the rectangle [xa, xb] x [za, zb] (any order), rising smoothly to 1 at depth r inside. */
function rectFade(x: number, z: number, xa: number, xb: number, za: number, zb: number, r: number): number {
  const d = Math.min(x - Math.min(xa, xb), Math.max(xa, xb) - x, z - Math.min(za, zb), Math.max(za, zb) - z);
  return smooth(0, r, d);
}

/** Least distance between a trim panel and the lining behind it, m. */
const PANEL_CLEARANCE = 0.002;

/**
 * A panel on one side of the cabin (side +1 right, -1 left) over x0..x1, z0..z1, standing h(x, z) inboard of
 * the lining surface. It faces into the cabin.
 */
export function liningPanel(
  lining: FuselageShape,
  side: 1 | -1,
  x0: number,
  x1: number,
  z0: number,
  z1: number,
  rows: number,
  cols: number,
  h: (x: number, z: number) => number,
): THREE.BufferGeometry {
  const rings: Ring[] = [];
  const xs: number[] = [];
  for (let i = 0; i < rows; i++) {
    const x = x0 + ((x1 - x0) * i) / (rows - 1);
    xs.push(x);
    rings.push(new Ring().set(lining.section(x)));
  }
  const build = (flip: boolean): THREE.BufferGeometry =>
    gridGeometry({
      rows,
      cols,
      flip,
      position(i, j, out) {
        const x = xs[i];
        const z = z0 + ((z1 - z0) * j) / (cols - 1);
        const hw = sectionHalfWidth(lining, x, z, rings[i]);
        // Always a little inboard of the lining, so the panel's edges never z-fight with it.
        frd(x, side * Math.max(0, hw - PANEL_CLEARANCE - h(x, z)), z, out);
      },
    });
  let g = build(false);
  // Face inboard: the model-space X of the normal (body y) must point away from this side.
  const n = g.getAttribute('normal');
  const mid = Math.floor(rows / 2) * cols + Math.floor(cols / 2);
  if (Math.sign(n.getX(mid)) === side) {
    g.dispose();
    g = build(true);
  }
  return g;
}

/**
 * Rounded bolster profile across z: an armrest standing `height` proud with a flattish top, centred at zc
 * with half height hz, tapering over `taper` at its ends x = xa, xb.
 */
function armrest(x: number, z: number, xa: number, xb: number, zc: number, hz: number, height: number, taper: number): number {
  const along = smooth(0, taper, Math.min(x - Math.min(xa, xb), Math.max(xa, xb) - x));
  const q = (z - zc) / hz;
  if (along <= 0 || Math.abs(q) >= 1) return 0;
  return height * along * Math.pow(1 - q * q, 0.45);
}

/** Grid and edge width of a panel that gives none. */
const PANEL_GRID = { rows: 24, cols: 24 };
const PANEL_EDGE = 0.02;

/**
 * Height field of a panel of the definition: rounded edges, then its mouldings: an armrest standing proud, a
 * recess where another panel is let in, a map pocket's lip.
 */
function panelRelief(p: VisualTrimPanelDef): (x: number, z: number) => number {
  const edge = p.edge ?? PANEL_EDGE;
  const offset = p.offset ?? 0;
  // A panel that runs on below the floor does not round off toward its lower edge.
  const zLow = p.openBelow ? Infinity : p.z1;
  const arm = p.armrest;
  const recess = p.recess;
  const pocket = p.pocket;
  return (x, z) => {
    let h = offset + p.relief * rectFade(x, z, p.x0, p.x1, p.z0, zLow, edge);
    if (arm) h += armrest(x, z, arm.xa, arm.xb, arm.zc, arm.hz, arm.height, arm.taper);
    if (recess) h -= recess.depth * rectFade(x, z, recess.x0, recess.x1, recess.z0, recess.z1, recess.edge);
    if (pocket) {
      const along = smooth(0, 0.035, Math.min(x - pocket.x1, pocket.x0 - x));
      const f = (z - pocket.zTop) / pocket.depth;
      h += along > 0 && f < 1 ? pocket.lip * along * smooth(-0.04, 0, f) * Math.min(1, 1 - f) : 0;
    }
    return h;
  };
}

/**
 * Add the trim panels and fittings to the cabin batch.
 * @param lining the cabin lining shape (FuselageShape inset 0.015)
 * @param floorZ cabin floor height (top of the carpet)
 * @param panels the side-wall panels of the cockpit definition (default: the Cessna 172S)
 * @param fittings the cockpit definition's fittings: the door handle, window latch, air outlet and toe board
 *                 are built where it has them (default: the Cessna 172S)
 */
export function addCabinTrim(
  batch: MeshBatch,
  mat: AircraftMaterials,
  lining: FuselageShape,
  floorZ: number,
  panels: readonly VisualTrimPanelDef[] = C172S_VISUAL.cockpit.trimPanels,
  fittings: NonNullable<CockpitDef['fittings']> = C172S_VISUAL.cockpit.fittings ?? {},
): void {
  for (const side of [-1, 1] as const) {
    for (const p of panels) {
      if (p.side !== 0 && p.side !== side) continue;
      const grid = p.grid ?? PANEL_GRID;
      batch.add(mat[p.material], liningPanel(lining, side, p.x0, p.x1, p.z0, p.z1, grid.rows, grid.cols, panelRelief(p)));
    }
    const surface = (x: number, z: number, h: number): THREE.Vector3 => frd(x, side * (sectionHalfWidth(lining, x, z) - h), z);
    // --- Door latches ---
    // Door opening handle: a chrome lever lying along the armrest's front end, in a black recessed cup.
    if (fittings.doorHandle) {
      const [x, z] = fittings.doorHandle;
      const cup = new THREE.CylinderGeometry(0.03, 0.03, 0.012, 24).rotateZ(Math.PI / 2);
      cup.scale(1, 0.65, 1.6);
      const c = surface(x, z, 0.012);
      batch.add(mat.black, cup.translate(c.x, c.y, c.z));
      const lever = new THREE.CapsuleGeometry(0.008, 0.075, 4, 10).rotateX(Math.PI / 2);
      const l = surface(x - 0.005, z, 0.022);
      batch.add(mat.chrome, lever.translate(l.x, l.y, l.z));
    }
    // Window latch on the sill at the bottom rear of the door window: a black lever on a small base.
    if (fittings.windowLatch) {
      const [x, z] = fittings.windowLatch;
      const b = surface(x, z, 0.008);
      batch.add(mat.black, new THREE.BoxGeometry(0.018, 0.03, 0.04).translate(b.x, b.y, b.z));
      const lever = new THREE.CapsuleGeometry(0.006, 0.05, 4, 8).rotateX(Math.PI / 2);
      const l = surface(x + 0.03, z + 0.004, 0.024);
      batch.add(mat.knobBlack, lever.translate(l.x, l.y, l.z));
    }
    // Round cabin-air outlet in the footwell's kick panel.
    if (fittings.airOutlet) {
      const v = surface(fittings.airOutlet[0], fittings.airOutlet[1], 0.012);
      const grille = new THREE.CylinderGeometry(0.035, 0.035, 0.01, 24).rotateZ(Math.PI / 2).translate(v.x, v.y, v.z);
      batch.add(mat.black, grille);
    }
  }

  // --- Toe boards: the floor carpet runs up the firewall behind the pedals ---
  const toe = fittings.toeBoard;
  if (toe) {
    const xa = toe.x0;
    const xb = toe.x1;
    const za = floorZ - 0.002;
    const zb = toe.z;
    const rows = 8;
    const hw = (x: number, z: number): number => sectionHalfWidth(lining, x, z) - 0.012;
    batch.add(
      mat.carpet,
      gridGeometry({
        rows,
        cols: 2,
        // Rows run forward and up, columns to the right: flipped to face up and aft into the cabin.
        flip: true,
        position(i, j, out) {
          const t = i / (rows - 1);
          const x = xa + (xb - xa) * t;
          const z = za + (zb - za) * t;
          frd(x, (j === 0 ? -1 : 1) * hw(x, z), z, out);
        },
      }),
    );
  }
}

/**
 * Texture coordinates in metres for the cabin's textured trim (leather grain, carpet pile, plastic grain):
 * each vertex is projected along the model axis closest to its normal, so the detail has the same scale on
 * every part whatever its own UV layout. Positions must be in model space.
 */
export function projectTrimUv(g: THREE.BufferGeometry): void {
  const p = g.getAttribute('position');
  const n = g.getAttribute('normal');
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i));
    const ay = Math.abs(n.getY(i));
    const az = Math.abs(n.getZ(i));
    let u: number;
    let v: number;
    if (ax >= ay && ax >= az) {
      u = p.getZ(i);
      v = p.getY(i);
    } else if (ay >= az) {
      u = p.getX(i);
      v = p.getZ(i);
    } else {
      u = p.getX(i);
      v = p.getY(i);
    }
    uv[i * 2] = u;
    uv[i * 2 + 1] = v;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}
