// MD 500E exterior details: engine air-inlet fairing over the mast, static mast, tail boom, T-tail with toed
// endplates, lower fin and tail-skid bumper, tail-rotor gearbox on the left, skid gear with faired struts, step
// plates and upturned toes, windshield and door frames, chin centre strip, antennas. RFM Fig 1-1 / Fig 6-3 give
// the stations and heights (dimensions.ts); shapes and proportions are 3V / photographic ESTIMATES
// (docs/md500-exterior.md). Decoration never supplies contact or aerodynamic geometry.
import * as THREE from 'three';
import type { AirframeVisualDef, FRD } from '../../render/aircraft/airframe/types';
import { frd, MeshBatch } from '../../render/aircraft/geometry';
import { boom, box, pathTube, tube } from '../../render/aircraft/rotorcraft/geometry';
import * as D from './dimensions';
import { ENDPLATE, LOWER_FIN, NOSE_BOW, STRUT_TOP, TAIL_HUB_LEVEL, TAIL_SKID, UPPER_FIN, sta, wl } from './visual';
import { aerofoilPanel, centreStrip, ellipsoid, fairedStrut, fairingLoft, ringPoint, roundedLoop, skinPath,
  type MD500Materials, type MD500Section, type MD500SkinWidth } from './exteriorGeometry';

/** Stabiliser incidence drawn relative to the fuselage waterline: the TCDS 8.92-9.42 deg to the mast normal less the
 * 3 deg forward shaft tilt, leading edge DOWN (a download in forward flight). The sign is T2's call (plan 6.2); the
 * drawing follows HORIZONTAL_STABILIZER.incidenceToMastNormalDeg. */
export const STAB_INCIDENCE_DEG = -(D.HORIZONTAL_STABILIZER.incidenceToMastNormalDeg - D.SHAFT_TILT_DEG);
/** Strut bottoms lean forward of their tops (photographs, G-SSCL / D-HHRM), m. */
export const STRUT_LEAN = 0.08;
/** The engine air-inlet fairing ("doghouse") over the mast and engine: [STA, top WL, bottom WL, half width in]. 3V from
 * the G-SSCL side photograph and the FOX 52 three-view; the mast leaves its top at STA 100. */
export const INLET_FAIRING: readonly (readonly [number, number, number, number])[] = [
  [84.0, 64.0, 60, 3], [85.5, 69.5, 60, 9.5], [88.5, 74.4, 60, 12.0], [93, 76.6, 60, 12.6], [100, 77.0, 60, 12.6],
  [125, 76.2, 58, 12.4], [145, 74.6, 56, 12.0], [153.5, 73.6, 56, 11.4], [156.5, 71.5, 57, 10.0], [158, 66, 57, 6],
  [158.6, 61, 57, 2]];

/** Boom-root fairing: the pod's upper rear sweeps up into the boom (G-SSCL). [STA, top WL, bottom WL, half width in]. 3V. */
export const BOOM_ROOT_FAIRING: readonly (readonly [number, number, number, number])[] = [
  [150, 63.4, 40, 8.2], [160, 62.6, 39, 7.8], [168, 61.8, 38, 7.2], [175, 61.0, 34.5, 6.4], [178, 60.7, 33.5, 6.0],
  [183, 60.2, 44, 5.4], [190, 59.6, 51.5, 4.9], [197, 59.1, 54.6, 4.6]];

export function buildMD500Exterior(def: AirframeVisualDef, m: MD500Materials, skin: MD500SkinWidth, section: MD500Section) {
  const group = new THREE.Group(); group.name = 'md500Exterior';
  const b = new MeshBatch(), d = def.rotorcraftVisual!;
  const add = (material: THREE.Material, g: THREE.BufferGeometry) => b.add(material, g);

  // ---------------------------------------------------------------- engine air-inlet fairing, static mast
  add(m.paint, fairingLoft(INLET_FAIRING.map(([s, top, bot, hw]) => [sta(s), wl(top), wl(bot), hw * 0.0254] as const), 3.2));
  // Engine air inlet on the fairing's front face, and the cooling-air exit louvres on its aft lip (photographs).
  add(m.dark, box([sta(86.4), 0, wl(71.2)], [0.03, 0.40, 0.085], 0.02));
  for (let k = 0; k < 4; k++) add(m.dark, box([sta(140 + k * 3.2), 0, wl(76.0) - 0.004], [0.02, 0.36, 0.006], 0.002));
  // Static mast (carries the lift; the drive shaft runs inside it) from the fairing top to just below the swashplate.
  add(m.grey, tube([0, 0, wl(76.5)], [0, 0, D.MAIN_HUB.z + 0.13], 0.07, 0.062, 28));
  add(m.metal, tube([0, 0, D.MAIN_HUB.z + 0.13], [0, 0, D.MAIN_HUB.z + 0.03], 0.046, 0.046, 20));
  // Three non-rotating control rods from the fairing to the stationary swashplate ring.
  for (let i = 0; i < 3; i++) {
    const a = i * Math.PI * 2 / 3 + 0.4, x = Math.cos(a) * 0.115, y = Math.sin(a) * 0.115;
    add(m.metal, tube([x, y, wl(76.4)], [x, y, D.MAIN_HUB.z + 0.12], 0.0075));
  }

  // ---------------------------------------------------------------- tail boom and its root fairing
  add(m.paint, boom(d.boom.front, d.boom.rear, d.boom.radii));
  // The boom leaves the upper rear of the pod through a blended fairing over the engine compartment.
  add(m.paint, fairingLoft(BOOM_ROOT_FAIRING.map(([s, top, bot, hw]) => [sta(s), wl(top), wl(bot), hw * 0.0254] as const), 2.4, true));
  for (const t of [0.42, 0.97]) {
    const x = THREE.MathUtils.lerp(d.boom.front[0], d.boom.rear[0], t), z = THREE.MathUtils.lerp(d.boom.front[2], d.boom.rear[2], t);
    const r = THREE.MathUtils.lerp(...d.boom.radii, t);
    add(m.grey, tube([x - 0.004, 0, z], [x + 0.004, 0, z], r + 0.0015, r + 0.0015, 32));
  }

  // ---------------------------------------------------------------- tail surfaces
  // Upper fin (swept, carries the T-stab) and lower fin: NACA 00xx-like sections along their published outlines.
  add(m.paint, aerofoilPanel(UPPER_FIN[0], UPPER_FIN[3], UPPER_FIN[1], UPPER_FIN[2], [0, 1, 0], 0.13));
  add(m.paint, aerofoilPanel(LOWER_FIN[0], LOWER_FIN[3], LOWER_FIN[1], LOWER_FIN[2], [0, 1, 0], 0.12));
  const hs = D.HORIZONTAL_STABILIZER, inc = STAB_INCIDENCE_DEG * Math.PI / 180;
  const midX = hs.leadingX - hs.chord / 2;
  // Positive incidence would raise the leading edge (FRD z up is negative): a negative angle puts it down.
  const chordEnd = (y: number, lead: boolean): FRD => {
    const s = lead ? 1 : -1;
    return [midX + s * hs.chord / 2 * Math.cos(inc), y, hs.z - s * hs.chord / 2 * Math.sin(inc)];
  };
  const stabNormal: FRD = [Math.sin(inc), 0, -Math.cos(inc)];
  const half = hs.span / 2 - 0.01;
  add(m.paint, aerofoilPanel(chordEnd(-half, true), chordEnd(-half, false), chordEnd(half, true), chordEnd(half, false), stabNormal, 0.12, 4));
  // Endplates, toed in at the leading edge (photographs: D-HHRM quarter view); 40 % above and 60 % below the stab.
  for (const side of [-1, 1]) {
    const toe = ENDPLATE.toeDeg * Math.PI / 180, y = side * hs.span / 2, c = ENDPLATE.chord / 2;
    const le: FRD = [midX + c * Math.cos(toe), y - side * c * Math.sin(toe), 0];
    const te: FRD = [midX - c * Math.cos(toe), y + side * c * Math.sin(toe), 0];
    const top = hs.z - ENDPLATE.height * 0.4, bottom = hs.z + ENDPLATE.height * 0.6;
    add(m.paint, aerofoilPanel([le[0], le[1], top], [te[0], te[1], top], [le[0] - 0.03, le[1], bottom], [te[0] + 0.01, te[1], bottom],
      [Math.sin(toe) * side, Math.cos(toe), 0], 0.08, 4));
    add(m.band, aerofoilPanel([le[0] - 0.002, le[1], top - 0.002], [te[0] + 0.002, te[1], top - 0.002],
      [le[0] - 0.006, le[1], top + 0.06], [te[0] + 0.004, te[1], top + 0.06], [Math.sin(toe) * side, Math.cos(toe), 0], 0.10, 3));
  }
  // Tail-skid bumper below the lower fin, with its fin-root fitting.
  add(m.metal, pathTube(TAIL_SKID, d.guardRadius, 40));
  add(m.cast, box([TAIL_SKID[0][0] - 0.01, 0, TAIL_SKID[0][2] - 0.02], [0.06, 0.035, 0.05], 0.008));

  // ---------------------------------------------------------------- tail-rotor gearbox (LEFT) and output shaft
  const th = TAIL_HUB_LEVEL;
  add(m.cast, ellipsoid([th.x + 0.03, -0.035, th.z], [0.12, 0.095, 0.10]));
  add(m.cast, tube([th.x, -0.08, th.z], [th.x, th.y + 0.075, th.z], 0.052, 0.04, 20));
  add(m.metal, tube([th.x, th.y + 0.08, th.z], [th.x, th.y + 0.02, th.z], 0.022, 0.022, 14));
  add(m.dark, tube([th.x + 0.06, -0.02, th.z - 0.09], [th.x + 0.06, -0.02, th.z - 0.12], 0.016, 0.016, 10)); // filler/vent

  // ---------------------------------------------------------------- skid landing gear
  const r = D.SKID_TUBE_RADIUS, zSole = D.SKID_Z - r;
  for (const side of [-1, 1]) {
    const y = side * D.SKID_HALF_TRACK;
    // Straight contact rail, slightly upturned at the rear and a tall forward toe curled up and back (photographs).
    const rail = new THREE.CurvePath<THREE.Vector3>();
    rail.add(new THREE.QuadraticBezierCurve3(frd(D.SKID_REAR_X - 0.05, y, zSole - 0.035), frd(D.SKID_REAR_X + 0.02, y, zSole), frd(D.SKID_REAR_X + 0.12, y, zSole)));
    rail.add(new THREE.LineCurve3(frd(D.SKID_REAR_X + 0.12, y, zSole), frd(D.SKID_FRONT_X - 0.30, y, zSole)));
    rail.add(new THREE.CubicBezierCurve3(frd(D.SKID_FRONT_X - 0.30, y, zSole), frd(D.SKID_FRONT_X - 0.06, y, zSole),
      frd(D.SKID_FRONT_X + 0.02, y, zSole - 0.12), frd(D.SKID_FRONT_X - 0.035, y, zSole - 0.22)));
    add(m.dark, new THREE.TubeGeometry(rail, 90, r, 14, false));
    for (const x of [D.SKID_REAR_X - 0.05, D.SKID_FRONT_X - 0.035]) {
      const zEnd = x < 0 ? zSole - 0.035 : zSole - 0.22;
      add(m.dark, new THREE.SphereGeometry(r, 14, 8).translate(...frd(x, y, zEnd).toArray()));
    }
    // Wear shoes under the rail near each strut.
    for (const x of [D.SKID_CONTACT_FRONT_X, D.SKID_CONTACT_REAR_X]) add(m.metal, box([x, y, D.SKID_Z - 0.011], [0.34, 0.03, 0.012], 0.004));
    for (const [i, x] of [D.SKID_CONTACT_FRONT_X, D.SKID_CONTACT_REAR_X].entries()) {
      // Faired strut from the lower fuselage hard point to a saddle on the skid tube (nitrogen damper inside, RFM 1-9).
      const topX = x - STRUT_LEAN, top: FRD = [topX, side * STRUT_TOP.y, STRUT_TOP.z];
      const foot: FRD = [x, y - side * 0.01, zSole - r - 0.035];
      add(m.paint, fairedStrut(top, foot, i === 0 ? 0.13 : 0.12, 0.052));
      add(m.cast, box([x, y, zSole - r - 0.03], [0.15, 0.085, 0.05], 0.014));
      add(m.dark, ellipsoid([topX, side * (STRUT_TOP.y - 0.02), STRUT_TOP.z - 0.02], [0.08, 0.05, 0.05], 14, 10));
      // Step plate on the outboard face of each strut, about a third of the way up.
      const t = 0.62, s: FRD = [THREE.MathUtils.lerp(top[0], foot[0], t), THREE.MathUtils.lerp(top[1], foot[1], t) + side * 0.03,
        THREE.MathUtils.lerp(top[2], foot[2], t)];
      add(m.dark, box([s[0], s[1] + side * 0.04, s[2]], [0.16, 0.10, 0.012], 0.004));
      add(m.dark, tube([s[0], s[1] - side * 0.02, s[2] + 0.005], [s[0], s[1] + side * 0.085, s[2] + 0.005], 0.007));
    }
    // Ground-handling wheel fittings on the skid tube between the struts.
    add(m.cast, box([(D.SKID_CONTACT_FRONT_X + D.SKID_CONTACT_REAR_X) / 2, y, zSole - r - 0.012], [0.07, 0.06, 0.03], 0.008));
  }

  // ---------------------------------------------------------------- glazing frames, door seals, handles
  // Centre post: over the top centreline from the nose tip to the aft frame of the roof glass, and along the chin.
  const topPost: FRD[] = [];
  for (let i = 0; i <= 40; i++) {
    const x = THREE.MathUtils.lerp(sta(15.6), sta(77.5), i / 40);
    topPost.push([x, 0, section(x).zTop - 0.004]);
  }
  add(m.frame, pathTube(topPost, 0.016, 80));
  // The painted centre strip between the chin windows, carrying the landing light (D-HHRM / Kauai head-on).
  add(m.paint, centreStrip(section, sta(15.4), sta(44.6), 0.075, false, 0.003, 30));
  // Horizontal bow round the nose between the windshields and the chin windows (side-projected line, both sides).
  const bow = [...skinPath(skin, -1, NOSE_BOW, 0.003, 24).reverse(), ...skinPath(skin, 1, NOSE_BOW, 0.003, 24)];
  add(m.frame, pathTube(bow, 0.014, 120));
  // Transverse roof frames: between the windshield and the eyebrow glass (STA 51.5) and aft of it (STA 77.5).
  for (const [s, rad] of [[51.5, 0.014], [77.5, 0.022]] as const) {
    const x = sta(s), ring: FRD[] = [];
    for (let k = 0; k <= 24; k++) {
      const a = THREE.MathUtils.lerp(Math.PI * 0.62, Math.PI * 1.38, k / 24);
      const p = ringPoint(section, x, a <= Math.PI ? a : 2 * Math.PI - a, 0.003);
      ring.push([p[0], a <= Math.PI ? p[1] : -p[1], p[2]]);
    }
    add(m.frame, pathTube(ring, rad, 60));
  }
  for (const side of [-1, 1]) {
    for (const door of def.glazing.doors) {
      const loop = roundedLoop(door.pts, door.r);
      add(m.rubber, pathTube(skinPath(skin, side, loop, 0.002, 3), 0.004, 160));
      const p = skinPath(skin, side, [[door.handle!.x, door.handle!.z]], 0.012)[0];
      add(m.metal, tube([p[0] - 0.045, p[1], p[2]], [p[0] + 0.045, p[1], p[2]], 0.008));
      add(m.dark, box([p[0], p[1] - side * 0.006, p[2]], [0.11, 0.008, 0.03], 0.004));
    }
    // Window frames: dark rubber surrounds on the door windows and the windshield aft edge (the A-post).
    for (const w of def.glazing.windows.slice(3)) add(m.frame, pathTube(skinPath(skin, side, roundedLoop(w.pts, w.r), 0.003, 3), 0.011, 160));
    const aPost: [number, number][] = [[sta(44.9), wl(10)], [sta(44.0), wl(29.8)], [sta(49.5), wl(47)], [sta(54.4), wl(61.9)], [sta(61), wl(64.4)]];
    add(m.frame, pathTube(skinPath(skin, side, aPost, 0.003, 10), 0.018, 80));
    // Door hinges on the forward edge of each door.
    for (const [s, w] of [[45, 18], [45.6, 44], [85.6, 18], [85.6, 46]]) {
      const p = skinPath(skin, side, [[sta(s), wl(w)]], 0.008)[0];
      add(m.grey, box(p, [0.025, 0.012, 0.05], 0.004));
    }
  }

  // ---------------------------------------------------------------- small external fittings
  // Pitot tube on the canopy top ahead of the roof frame (G-SSCL), VHF blade under the belly, whip on the boom.
  const pitotBase: FRD = [sta(56), 0, section(sta(56)).zTop];
  add(m.metal, tube(pitotBase, [pitotBase[0] + 0.02, 0, pitotBase[2] - 0.07], 0.006));
  add(m.metal, tube([pitotBase[0] + 0.02, 0, pitotBase[2] - 0.07], [pitotBase[0] + 0.12, 0, pitotBase[2] - 0.072], 0.005));
  add(m.dark, box([sta(110), 0, D.BELLY_Z + 0.05], [0.16, 0.006, 0.10], 0.003));
  add(m.dark, tube([sta(205), 0, wl(boomTopWl(205))], [sta(214), 0, wl(boomTopWl(205)) - 0.32], 0.0035, 0.002, 6));
  // Fuel filler on the right side of the pod, aft of the rear door (RFM 1-13 fuel cell in the aft fuselage).
  const filler = skinPath(skin, 1, [[sta(128), wl(36)]], 0.004)[0];
  add(m.grey, tube([filler[0], filler[1] - 0.01, filler[2]], [filler[0], filler[1] + 0.006, filler[2]], 0.04, 0.04, 20));
  group.add(b.build('md500Structure'));
  return { group, materials: [] as THREE.Material[], textures: [] as THREE.Texture[] };

  function boomTopWl(s: number): number {
    const t = (sta(s) - d.boom.front[0]) / (d.boom.rear[0] - d.boom.front[0]);
    const centre = THREE.MathUtils.lerp(d.boom.front[2], d.boom.rear[2], t), rr = THREE.MathUtils.lerp(...d.boom.radii, t);
    return -(centre - rr - D.SKID_Z) / 0.0254 - D.GROUND_WL_BELOW;
  }
}

