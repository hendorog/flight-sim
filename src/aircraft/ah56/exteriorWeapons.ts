// AH-56A weapons and stores: the XM51 nose turret (40 mm XM129 grenade launcher; the XM53 minigun fitted the same ball),
// the XM52 belly turret at FS 190 (30 mm XM140) whose lowest point stands 21 in above the ground (P ASTA-72 para 91),
// the four wing pylons at BL 70 and BL 117 (P ASTA-72 App J p 144) and the default stores: one TOW launcher on each
// inboard pylon (the "TOW pair"; three tubes each, ESTIMATE from the Anefo 1971 in-flight photograph). Shapes follow the
// Commons XM51 / XM52 armament drawings (PD, US Army TACOM); sizes are ESTIMATES. Nothing here is physics geometry.
import * as THREE from 'three';
import type { FRD } from '../../render/aircraft/airframe/types';
import { frd, MeshBatch } from '../../render/aircraft/geometry';
import { box, tube } from '../../render/aircraft/rotorcraft/geometry';
import * as D from './dimensions';
import { PYLONS, WING_PLAN, bl, fs, wl } from './visual';
import { aerofoilPanel, ellipsoid, nacaThickness, revolve, type AH56Materials, type AH56Section } from './exteriorGeometry';
import { wingChord } from './exteriorDetails';

const IN = 0.0254;

/** XM51 nose turret ball: centre FS 37, WL 48, radius 8 in (3V; the drawing shows the ball under the nose tip). */
export const NOSE_TURRET = { fs: 37, wl: 48, radiusIn: 8 } as const;
/** XM52 belly turret: a drum of radius 10 in at FS 190 (P station) from the belly down to WL 39 = 21 in above the
 *  ground (P), 30 mm barrel forward. */
export const BELLY_TURRET = { fs: 190, radiusIn: 10, bottomWl: D.GROUND_WL + D.BELLY_TURRET.clearanceM / IN } as const;
/** Pylon depth below the wing lower surface, in (ESTIMATE). */
export const PYLON_DEPTH_IN = 6.5;
/** TOW launcher: three tubes of 8.6 in, 50 in long (ESTIMATE). */
export const TOW = { tubeRadiusIn: 4.3, lengthIn: 50 } as const;

/** Point on a wing panel's lower surface at butt line b (in, side +1 right) and chord fraction xc. */
export function wingLower(b: number, side: number, xc: number): FRD {
  const c = wingChord(b, side), chord = Math.hypot(c.te[0] - c.le[0], c.te[2] - c.le[2]);
  const tc = THREE.MathUtils.lerp(WING_PLAN.rootThickness, WING_PLAN.tipThickness, b / WING_PLAN.tipBl);
  const down = nacaThickness(tc, xc) * chord;
  return [THREE.MathUtils.lerp(c.le[0], c.te[0], xc), c.le[1], THREE.MathUtils.lerp(c.le[2], c.te[2], xc) + down];
}

export function buildAH56Weapons(m: AH56Materials, section: AH56Section) {
  const group = new THREE.Group(); group.name = 'ah56Weapons';
  const b = new MeshBatch();
  const add = (material: THREE.Material, g: THREE.BufferGeometry) => b.add(material, g);

  // ---------------------------------------------------------------- XM51 nose turret with the XM129 grenade launcher
  {
    const c: FRD = [fs(NOSE_TURRET.fs), 0, wl(NOSE_TURRET.wl)], r = NOSE_TURRET.radiusIn * IN;
    add(m.paintDark, ellipsoid(c, [r, r * 0.96, r * 0.92], 32, 20));
    add(m.dark, box([c[0] + r * 0.82, 0, c[2] + 0.01], [0.05, 0.07, 0.15], 0.01));
    add(m.dark, tube([c[0] + r * 0.6, 0, c[2] + 0.015], [c[0] + r + 0.30, 0, c[2] + 0.015], 0.032, 0.03, 16));
    add(m.black, tube([c[0] + r + 0.30, 0, c[2] + 0.015], [c[0] + r + 0.36, 0, c[2] + 0.015], 0.036, 0.036, 16));
    add(m.metal, tube([c[0] + r * 0.4, -0.05, c[2] + 0.05], [c[0] + r * 0.4, 0.05, c[2] + 0.05], 0.022, 0.022, 12));
  }

  // ---------------------------------------------------------------- XM52 belly turret with the XM140 30 mm gun
  {
    const x = fs(BELLY_TURRET.fs), r = BELLY_TURRET.radiusIn * IN, belly = section(x).zBot, bottom = wl(BELLY_TURRET.bottomWl);
    const capH = 0.06;
    add(m.paintDark, tube([x, 0, belly - 0.04], [x, 0, bottom - capH], r, r, 36));
    add(m.paintDark, new THREE.SphereGeometry(1, 36, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2).scale(r, capH, r).translate(...frd(x, 0, bottom - capH).toArray()));
    add(m.cast, tube([x, 0, belly + 0.005], [x, 0, belly + 0.025], r + 0.012, r + 0.012, 36));
    // Gun cradle on the forward face and the barrel with its muzzle brake.
    const gz = bottom - 0.16;
    add(m.dark, box([x + r * 0.85, 0, gz], [0.16, 0.12, 0.11], 0.012));
    add(m.dark, tube([x + r * 0.9, 0, gz], [x + r + 0.95, 0, gz], 0.032, 0.03, 16));
    add(m.black, tube([x + r + 0.95, 0, gz], [x + r + 1.07, 0, gz], 0.042, 0.042, 16));
    add(m.dark, box([x + r - 0.02, 0, gz + 0.06], [0.05, 0.16, 0.06], 0.01));
  }

  // ---------------------------------------------------------------- wing pylons and the TOW pair
  for (const side of [-1, 1]) for (const p of PYLONS) {
    const front = wingLower(p, side, 0.18), rear = wingLower(p, side, 0.62);
    const bottomZ = Math.max(front[2], rear[2]) + PYLON_DEPTH_IN * IN, y = side * bl(p);
    add(m.paintDark, aerofoilPanel([front[0], y, front[2] - 0.02], [rear[0], y, rear[2] - 0.02], [front[0] - 0.04, y, bottomZ], [rear[0] + 0.02, y, bottomZ],
      [0, 1, 0], 0.14, 0.14, 4, 25));
    // Bomb-rack fitting at the pylon foot with its two sway braces each side.
    const mid = (front[0] + rear[0]) / 2;
    add(m.dark, box([mid, y, bottomZ + 0.01], [0.42, 0.06, 0.025], 0.005));
    if (p !== PYLONS[0]) continue;
    // TOW launcher (three tubes in a triangle, front ends open), hung on the inboard pylon.
    const tr = TOW.tubeRadiusIn * IN, len = TOW.lengthIn * IN, cx = mid + 0.12, cz = bottomZ + tr + 0.035;
    for (const [dy, dz] of [[-tr, 0], [tr, 0], [0, tr * 1.75]] as const) {
      const yy = y + dy, zz = cz + dz;
      add(m.paintDark, tube([cx + len / 2, yy, zz], [cx - len / 2, yy, zz], tr, tr, 24));
      add(m.dark, new THREE.CircleGeometry(tr * 0.86, 24).rotateY(Math.PI).translate(...frd(cx + len / 2 + 0.002, yy, zz).toArray()));
      add(m.dark, new THREE.CircleGeometry(tr * 0.86, 24).translate(...frd(cx - len / 2 - 0.002, yy, zz).toArray()));
    }
    for (const k of [-0.32, 0.0, 0.32]) add(m.cast, revolve([[cx + k * len + 0.03, 0], [cx + k * len + 0.03, tr * 2.15], [cx + k * len - 0.03, tr * 2.15],
      [cx + k * len - 0.03, 0]], y, cz + tr * 0.6, 28, 0.95));
  }
  group.add(b.build('ah56WeaponsAndStores'));
  return { group };
}
