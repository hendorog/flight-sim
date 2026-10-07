// Airport buildings and structures, built from simple parts into per-material batches in the airport-local frame
// (three x = v across, y = height above field, z = -u along). Dimensions are typical of small US airfields:
// steel-frame hangars with 10 degree gable roofs and bottom-rolling doors, a single-storey terminal, a 17 m
// control tower, fuel farm, beacon mast and apron floodlight masts.

import * as THREE from 'three';
import { BatchSet, boxGeo, cylGeo, placement, polyGeo, v3 } from './geom';
import {
  BEACON,
  BUILDINGS,
  FLOODLIGHTS,
  FUEL_ISLAND,
  TOWER,
  type BuildingFootprint,
} from './layout';
import { LIGHT_COLORS, LightKind, localToWorld, type LightSpec } from './lights';
import type { MaterialKey } from './materials';

/** Local (u, v, h) to the airport-group frame. */
export const L = (u: number, v: number, h: number): THREE.Vector3 => new THREE.Vector3(v, h, -u);

const DEG = Math.PI / 180;

interface Palette {
  wall: number;
  door: number;
  roof: number;
  trim: number;
}

const PALETTES: Record<string, Palette> = {
  'Hangar 1': { wall: 0xb8bec4, door: 0x8f99a3, roof: 0x9aa1a6, trim: 0x2f4f6f },
  'Hangar 2': { wall: 0xd8d0bc, door: 0x6d7a70, roof: 0x8f9396, trim: 0x5a4a3a },
  Maintenance: { wall: 0xe4e4e0, door: 0x36577a, roof: 0x9fa3a6, trim: 0x36577a },
  'T-hangars': { wall: 0xc9c3b3, door: 0xb04a36, roof: 0x8c8f90, trim: 0x7a3a2c },
};

/** A round bar (5-sided) from a to c. */
function strut(b: BatchSet<MaterialKey>, key: MaterialKey, a: THREE.Vector3, c: THREE.Vector3, r: number, color: number): void {
  const len = a.distanceTo(c);
  const g = cylGeo(r, r, len, 5);
  const m = new THREE.Matrix4().lookAt(a, c, v3(0, 1, 0)).multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
  m.setPosition(a.clone().add(c).multiplyScalar(0.5));
  b.get(key).add(g, m, color);
}

/** Gable-roofed steel hangar; the door is in the eave wall facing the apron (+v). */
function hangar(b: BatchSet<MaterialKey>, f: BuildingFootprint, pal: Palette, lights: LightSpec[]): void {
  const W = f.u1 - f.u0, D = f.v1 - f.v0, H = f.height;
  const cu = (f.u0 + f.u1) / 2, cv = (f.v0 + f.v1) / 2;
  const pitch = 10 * DEG;
  const rise = (D / 2) * Math.tan(pitch);
  const oh = 0.5;
  // Walls and concrete plinth.
  b.get('metalWall').add(boxGeo(D, H - 0.4, W), placement(cv, 0.4 + (H - 0.4) / 2, -cu), pal.wall);
  b.get('concrete').add(boxGeo(D + 0.1, 0.4, W + 0.1), placement(cv, 0.2, -cu), 0xa8a39a);
  // Gable ends.
  for (const end of [-1, 1]) {
    const u = cu + (end * W) / 2;
    b.get('metalWall').add(polyGeo([L(u, f.v0, H), L(u, f.v1, H), L(u, cv, H + rise)], v3(0, 0, -end)), undefined, pal.wall);
  }
  // Roof planes with overhang.
  for (const side of [-1, 1]) {
    const vEave = cv + side * (D / 2 + oh);
    const hEave = H - oh * Math.tan(pitch);
    b.get('metalRoof').add(
      polyGeo([L(f.u0 - oh, vEave, hEave), L(f.u1 + oh, vEave, hEave), L(f.u1 + oh, cv, H + rise), L(f.u0 - oh, cv, H + rise)], v3(side, 1, 0)),
      undefined,
      pal.roof,
    );
    // gutter
    b.get('trim').add(boxGeo(0.18, 0.18, W + 2 * oh), placement(vEave + side * 0.05, hEave - 0.05, -cu), pal.trim);
  }
  b.get('trim').add(boxGeo(0.5, 0.12, W + 2 * oh), placement(cv, H + rise + 0.03, -cu), pal.trim);
  // Bottom-rolling door leaves across 85% of the front, with header and guide rails.
  const doorW = W * 0.85, doorH = H * 0.86, leaves = Math.max(3, Math.round(doorW / 7));
  for (let i = 0; i < leaves; i++) {
    const u = cu - doorW / 2 + (doorW / leaves) * (i + 0.5);
    const inset = i % 2 === 0 ? 0.12 : 0.28;
    b.get('door').add(boxGeo(0.12, doorH, doorW / leaves - 0.04), placement(f.v1 + inset, doorH / 2 + 0.05, -u), pal.door);
    // Band of translucent fibreglass daylight panels, and the leaf's bottom rail.
    b.get('paint').add(boxGeo(0.02, 0.7, doorW / leaves - 0.6), placement(f.v1 + inset + 0.065, doorH * 0.72, -u), 0x9a9f9a);
    b.get('trim').add(boxGeo(0.03, 0.25, doorW / leaves - 0.04), placement(f.v1 + inset + 0.07, 0.18, -u), 0x3a3c3a);
  }
  b.get('trim').add(boxGeo(0.45, 0.5, doorW + 0.6), placement(f.v1 + 0.25, doorH + 0.3, -cu), pal.trim);
  b.get('steel').add(boxGeo(0.35, 0.05, doorW + 0.6), placement(f.v1 + 0.2, 0.03, -cu), 0x505050);
  // Personnel door and office windows on one gable end, clerestory windows on the other.
  b.get('door').add(boxGeo(1.0, 2.1, 0.1), placement(f.v1 - 3, 1.05 + 0.05, -(f.u0 - 0.05)), pal.trim);
  for (let k = 0; k < 3; k++) {
    b.get('glassLit').add(boxGeo(1.6, 1.2, 0.1), placement(f.v1 - 7 - k * 2.6, 1.9, -(f.u0 - 0.05)));
  }
  for (let v = f.v0 + 3; v < f.v1 - 2; v += 3.2) b.get('glass').add(boxGeo(2.2, 0.8, 0.1), placement(v, H - 1.3, -(f.u1 + 0.05)), 0xffffff);
  // Wall-pack lights above the door.
  for (let i = 0; i < 3; i++) {
    const u = cu - doorW / 2 + (doorW * (i + 0.5)) / 3;
    b.get('steel').add(boxGeo(0.35, 0.25, 0.45), placement(f.v1 + 0.3, doorH + 0.9, -u), 0x303030);
    lights.push({ position: localToWorld(u, f.v1 + 0.6, doorH + 0.75), colorA: LIGHT_COLORS.sodium, lens: 0.3, cd: 3000, cdDay: 0, kind: LightKind.CutOff, param: 0.15 });
  }
}

/** Row of T-hangars under a mono-pitch roof, one door per bay. */
function tHangars(b: BatchSet<MaterialKey>, f: BuildingFootprint, pal: Palette): void {
  const W = f.u1 - f.u0, D = f.v1 - f.v0, H = f.height;
  const cu = (f.u0 + f.u1) / 2, cv = (f.v0 + f.v1) / 2;
  const hBack = H - 1.0;
  b.get('metalWall').add(boxGeo(D, hBack, W), placement(cv, hBack / 2, -cu), pal.wall);
  // Front wall strip above the doors up to the high side of the roof.
  b.get('metalWall').add(boxGeo(0.2, H - hBack + 0.8, W), placement(f.v1 - 0.1, hBack - 0.4 + (H - hBack + 0.8) / 2, -cu), pal.wall);
  for (const end of [-1, 1]) {
    const u = cu + (end * W) / 2;
    b.get('metalWall').add(polyGeo([L(u, f.v0, hBack), L(u, f.v1, hBack), L(u, f.v1, H)], v3(0, 0, -end)), undefined, pal.wall);
  }
  b.get('metalRoof').add(
    polyGeo([L(f.u0 - 0.4, f.v0 - 0.6, hBack - 0.05), L(f.u1 + 0.4, f.v0 - 0.6, hBack - 0.05), L(f.u1 + 0.4, f.v1 + 0.5, H + 0.05), L(f.u0 - 0.4, f.v1 + 0.5, H + 0.05)], v3(0, 1, 0)),
    undefined,
    pal.roof,
  );
  const bays = Math.round(W / 13);
  for (let i = 0; i < bays; i++) {
    const u = f.u0 + (W / bays) * (i + 0.5);
    b.get('door').add(boxGeo(0.1, hBack - 0.6, W / bays - 0.9), placement(f.v1 + 0.06, (hBack - 0.6) / 2 + 0.05, -u), i % 3 === 1 ? 0x8a8f94 : pal.door);
    b.get('trim').add(boxGeo(0.25, 0.2, 0.3), placement(f.v1 + 0.15, hBack - 0.3, -(u - W / bays / 2 + 0.2)), pal.trim);
  }
  b.get('concrete').add(boxGeo(D + 0.1, 0.2, W + 0.1), placement(cv, 0.1, -cu), 0xa8a39a);
}

/** Single-storey terminal: rendered block walls, airside glazing, flat roof with parapet, landside canopy. */
function terminal(b: BatchSet<MaterialKey>, f: BuildingFootprint, lights: LightSpec[]): void {
  const W = f.u1 - f.u0, D = f.v1 - f.v0, H = f.height;
  const cu = (f.u0 + f.u1) / 2, cv = (f.v0 + f.v1) / 2;
  b.get('render').add(boxGeo(D, H, W), placement(cv, H / 2, -cu), 0xd9d2c3);
  b.get('trim').add(boxGeo(D + 0.4, 0.5, W + 0.4), placement(cv, H + 0.2, -cu), 0x4a5560); // parapet coping
  b.get('concrete').add(boxGeo(D - 0.6, 0.1, W - 0.6), placement(cv, H + 0.3, -cu), 0x6b6b68); // roof membrane
  // Airside curtain wall with mullions, and a projecting entrance bay.
  const gw = W * 0.7;
  b.get('glassLit').add(boxGeo(0.1, H - 1.6, gw), placement(f.v1 + 0.04, 0.6 + (H - 1.6) / 2, -cu));
  for (let u = cu - gw / 2; u <= cu + gw / 2 + 0.01; u += 1.5) b.get('trim').add(boxGeo(0.16, H - 1.5, 0.08), placement(f.v1 + 0.08, 0.55 + (H - 1.5) / 2, -u), 0x3a3f44);
  b.get('trim').add(boxGeo(0.16, 0.1, gw), placement(f.v1 + 0.08, 3.2, -cu), 0x3a3f44);
  b.get('trim').add(boxGeo(2.4, 0.3, 12), placement(f.v1 + 1.2, H - 1.0, -cu), 0x4a5560); // airside canopy
  // Landside entrance: glazing and a canopy on columns.
  b.get('glassLit').add(boxGeo(0.1, 3.0, 14), placement(f.v0 - 0.04, 1.6, -cu));
  b.get('trim').add(boxGeo(5, 0.35, 18), placement(f.v0 - 2.5, 3.8, -cu), 0x4a5560);
  for (const du of [-8, 8]) b.get('steel').add(cylGeo(0.12, 0.12, 3.7, 10), placement(f.v0 - 4.6, 1.85, -(cu + du)), 0x6a6e72);
  // Ribbon windows on the ends.
  for (const end of [-1, 1]) b.get('glassLit').add(boxGeo(D * 0.7, 1.3, 0.1), placement(cv, 2.2, -(cu + end * (W / 2 + 0.04))));
  // Rooftop HVAC units.
  for (const [du, dv] of [[-18, 2], [-10, -4], [14, 1]]) b.get('steel').add(boxGeo(2.2, 1.4, 3.2), placement(cv + dv, H + 1.0, -(cu + du)), 0x9aa0a4);
  // Name board on the airside parapet (the lettering is drawn by signs.ts; lit from below at night).
  b.get('trim').add(boxGeo(0.2, 1.4, 16), placement(f.v1 - 0.25, H + 1.05, -cu), 0x1c3a58);
  for (const du of [-6, 0, 6]) b.get('steel').add(boxGeo(0.08, 0.9, 0.08), placement(f.v1 - 0.45, H + 0.6, -(cu + du)), 0x505254);
  lights.push({ position: localToWorld(cu, f.v1 + 2.5, H - 1.3), colorA: LIGHT_COLORS.flood, lens: 0.3, cd: 1500, cdDay: 0, kind: LightKind.CutOff, param: 0.2 });
}

/** Control tower: concrete shaft, octagonal glazed cab with outward-leaning panes, roof slab and antenna. */
function tower(b: BatchSet<MaterialKey>): void {
  const x = TOWER.v, z = -TOWER.u;
  const cab0 = TOWER.cabFloor, roof = TOWER.roofHeight - 0.5;
  b.get('concrete').add(boxGeo(4.6, cab0, 4.6), placement(x, cab0 / 2, z), 0xc9c4b8);
  // Stair-well window slits.
  for (let h = 2; h < cab0 - 1; h += 3) b.get('glass').add(boxGeo(0.1, 1.6, 0.6), placement(x + 2.33, h, z), 0xffffff);
  // Base building (equipment and offices).
  b.get('render').add(boxGeo(8, 3.6, 10), placement(x - 5, 1.8, z - 2), 0xd9d2c3);
  b.get('trim').add(boxGeo(8.3, 0.3, 10.3), placement(x - 5, 3.7, z - 2), 0x4a5560);
  // Cab floor slab, catwalk and railing.
  b.get('concrete').add(cylGeo(4.4, 4.4, 0.5, 8), placement(x, cab0 - 0.25, z, Math.PI / 8), 0xb9b4a8);
  b.get('steel').add(cylGeo(4.35, 4.35, 1.0, 8, true), placement(x, cab0 + 0.5, z, Math.PI / 8), 0x707478);
  // Glazing: frustum leaning outward (reduces reflections for the controllers), mullions at the corners.
  const g0 = cab0 + 0.5, g1 = roof - 0.2;
  b.get('glassLit').add(cylGeo(3.6, 3.1, roof - cab0 - 0.4, 8, true), placement(x, cab0 + 0.2 + (roof - cab0 - 0.4) / 2, z, Math.PI / 8));
  // Corner mullions following the outward lean, and a transom rail.
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4 + Math.PI / 8;
    const rAt = (h: number) => 3.1 + ((3.6 - 3.1) * (h - (cab0 + 0.2))) / (roof - cab0 - 0.4) + 0.03;
    strut(b, 'trim', v3(x + rAt(g0) * Math.sin(a), g0, z + rAt(g0) * Math.cos(a)), v3(x + rAt(g1) * Math.sin(a), g1, z + rAt(g1) * Math.cos(a)), 0.06, 0x2a2e33);
  }
  b.get('trim').add(cylGeo(3.52, 3.47, 0.08, 8, true), placement(x, cab0 + 0.2 + (roof - cab0 - 0.4) * 0.8, z, Math.PI / 8), 0x2a2e33);
  b.get('concrete').add(cylGeo(3.1, 3.1, 0.6, 8), placement(x, cab0 + 0.2, z, Math.PI / 8), 0x4a5560);
  b.get('trim').add(cylGeo(4.1, 3.8, 0.6, 8), placement(x, roof + 0.1, z, Math.PI / 8), 0x4a5560);
  b.get('steel').add(cylGeo(0.05, 0.08, 4, 6), placement(x + 1.5, roof + 2.4, z + 1), 0xc0c0c0);
  b.get('steel').add(boxGeo(0.4, 0.8, 0.4), placement(x - 1.2, roof + 0.8, z - 1.2), 0x8a8e92);
}

/** Fuel farm: bunded concrete pad with two horizontal tanks, plus the dispenser at the apron fuel island. */
function fuel(b: BatchSet<MaterialKey>, f: BuildingFootprint): void {
  const cu = (f.u0 + f.u1) / 2, cv = (f.v0 + f.v1) / 2, W = f.u1 - f.u0, D = f.v1 - f.v0;
  b.get('concrete').add(boxGeo(D, 0.15, W), placement(cv, 0.075, -cu), 0xa09b92);
  for (const end of [-1, 1]) {
    b.get('concrete').add(boxGeo(D, 0.7, 0.25), placement(cv, 0.35, -(cu + end * (W / 2 - 0.12))), 0xb0aba2);
    b.get('concrete').add(boxGeo(0.25, 0.7, W), placement(cv + end * (D / 2 - 0.12), 0.35, -cu), 0xb0aba2);
  }
  for (const dv of [-2.4, 2.4]) {
    b.get('paint').add(cylGeo(1.35, 1.35, 9, 20), placement(cv + dv, 1.8, -cu, 0, Math.PI / 2), 0xe8e8e4);
    b.get('paint').add(cylGeo(1.37, 1.37, 0.6, 20, true), placement(cv + dv, 1.8, -cu + 1.5, 0, Math.PI / 2), 0x1f4f9f);
    for (const du of [-3, 3]) b.get('concrete').add(boxGeo(2.4, 0.6, 0.5), placement(cv + dv, 0.45, -(cu + du)), 0x9a958c);
  }
  // Dispenser cabinet, hose reel and bollards on the fuel island.
  const fu = FUEL_ISLAND.u, fv = FUEL_ISLAND.v;
  b.get('concrete').add(boxGeo(2.2, 0.2, 5), placement(fv - 2.5, 0.1, -fu), 0xb5b0a6);
  b.get('paint').add(boxGeo(0.7, 1.8, 1.3), placement(fv - 2.5, 1.1, -fu), 0xe8e8e4);
  b.get('paint').add(boxGeo(0.72, 0.35, 1.32), placement(fv - 2.5, 1.7, -fu), 0x1f4f9f);
  b.get('rubber').add(cylGeo(0.45, 0.45, 0.35, 16), placement(fv - 2.5, 1.0, -(fu + 1.1), 0, 0, Math.PI / 2), 0x151515);
  for (const [du, dv] of [[-2.3, -1.3], [2.3, -1.3], [-2.3, -3.7], [2.3, -3.7]]) {
    b.get('paint').add(cylGeo(0.1, 0.1, 1.1, 10), placement(fv + dv, 0.55, -(fu + du)), 0xe0b020);
  }
}

/** Lattice beacon mast with platform and rotating beacon housing. */
function beaconMast(b: BatchSet<MaterialKey>): void {
  const x = BEACON.v, z = -BEACON.u, H = BEACON.height;
  const base = 1.1, top = 0.45;
  const legs: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  const at = (h: number, s: [number, number]) => {
    const r = base + (top - base) * (h / H);
    return v3(x + s[0] * r, h, z + s[1] * r);
  };
  const bar = (a: THREE.Vector3, c: THREE.Vector3, r: number) => strut(b, 'steel', a, c, r, 0x9aa0a4);
  for (let i = 0; i < 4; i++) bar(at(0, legs[i]), at(H, legs[i]), 0.06);
  for (let h = 0; h < H - 0.1; h += 3) {
    for (let i = 0; i < 4; i++) {
      const a = legs[i], c = legs[(i + 1) % 4];
      bar(at(h, a), at(h + 3 > H ? H : h + 3, c), 0.025);
      bar(at(h + 3 > H ? H : h + 3, a), at(h, c), 0.025);
    }
  }
  b.get('steel').add(boxGeo(1.6, 0.1, 1.6), placement(x, H, z), 0x8a8e92);
  b.get('trim').add(cylGeo(0.35, 0.4, 0.9, 16), placement(x, H + 0.5, z), 0x2a2d30);
  b.get('glass').add(cylGeo(0.36, 0.36, 0.35, 16), placement(x, H + 0.6, z), 0xffffff);
}

/** Apron floodlight masts with a head frame of three fixtures. */
function floodMasts(b: BatchSet<MaterialKey>): void {
  for (const f of FLOODLIGHTS) {
    const x = f.v, z = -f.u;
    b.get('steel').add(cylGeo(0.11, 0.2, f.height, 10), placement(x, f.height / 2, z), 0x9aa0a4);
    b.get('concrete').add(cylGeo(0.4, 0.45, 0.5, 12), placement(x, 0.25, z), 0xa8a39a);
    b.get('steel').add(boxGeo(0.15, 0.15, 2.0), placement(x + 0.2, f.height, z), 0x9aa0a4);
    for (const du of [-0.6, 0, 0.6]) {
      b.get('trim').add(boxGeo(0.55, 0.12, 0.5), placement(x + 0.45, f.height - 0.05, z - du, 0, 0, -35 * DEG), 0x2a2d30);
    }
  }
}

/** Build every airport structure. Returns wall-pack / sign light specs to add to the light system. */
export function buildStructures(b: BatchSet<MaterialKey>): LightSpec[] {
  const lights: LightSpec[] = [];
  for (const f of BUILDINGS) {
    switch (f.kind) {
      case 'hangar':
      case 'maintenance':
        hangar(b, f, PALETTES[f.name], lights);
        break;
      case 'tHangar':
        tHangars(b, f, PALETTES[f.name]);
        break;
      case 'terminal':
        terminal(b, f, lights);
        break;
      case 'tower':
        tower(b);
        break;
      case 'fuelFarm':
        fuel(b, f);
        break;
    }
  }
  beaconMast(b);
  floodMasts(b);
  return lights;
}
