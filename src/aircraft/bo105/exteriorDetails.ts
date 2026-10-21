// MBB Bo 105 CB-4 exterior details: the upper deck fairing over the transmission and the two engines (air intakes
// forward, exhausts on top, louvres, panel seams), the mast with its servo rods, the tail boom with the driveshaft
// fairing on top and its root fairing, the swept fin with the intermediate gearbox at its base and the tail-rotor
// gearbox on the LEFT at its top, the stabiliser with endplates, the tail skid, the skid gear with its two bending cross
// tubes, the windscreen centre post, nose bow and frames, the crew-door hinges, the sliding-door rails, the aft
// clamshell doors' centre seam and hinges, the nose-compartment cover, pitot and antennas. dimensions.ts gives the
// stations and heights; shapes and proportions are 3V / photographic ESTIMATES (docs/bo105-exterior.md). Decoration
// never supplies contact or aerodynamic geometry.
import * as THREE from 'three';
import type { AirframeVisualDef, FRD } from '../../render/aircraft/airframe/types';
import { frd, MeshBatch } from '../../render/aircraft/geometry';
import { boom, box, pathTube, tube } from '../../render/aircraft/rotorcraft/geometry';
import * as D from './dimensions';
import { BOOM_ROOT_FAIRING, CLAMSHELL_STA, CROSS_TUBE_RADIUS, CROSS_TUBE_STA, DECK_FAIRING, ENDPLATE, FIN, H, NOSE_BOW,
  S, SKID_TUBE_RADIUS, SLIDING_RAIL_END_STA, STAB, TAIL_END_STA, TAIL_SKID, boomHeight, boomRadius } from './visual';
import { aerofoilPanel, centreStrip, ellipsoid, fairingLoft, ringPoint, roundedLoop, skinPath,
  type Bo105Materials, type Bo105Section, type Bo105SkinWidth } from './exteriorGeometry';
import { HUB_TOP, SWASH_RING, SWASHPLATE_DROP, shaftTilt } from './exteriorRotor';

/** Boxiness of the deck fairing's sections (superellipse exponent). ESTIMATE (photographs). */
export const DECK_N = 3.6;
/** Engine air intakes (one each side at the front of the engine bay) and the louvre panels behind them. ESTIMATE */
export const INTAKE = { sta: 3.62, h: 2.23, halfLength: 0.11, halfHeight: 0.07 } as const;
/** Half thickness of the endplates (8 % sections of the 0.42 m chord), m. */
export const ENDPLATE_HALF_THICKNESS = 0.08 * 0.42 / 2;
/** Skid toe: the front of each skid tube curls up this high over its last 0.35 m (photographs). ESTIMATE */
export const SKID_TOE_RISE = 0.17;

/** The clamshell outline among the glazing doors: the one starting at the clamshell station (it runs past the pod's end). */
const isClamshell = (pts: readonly (readonly [number, number])[]): boolean => Math.abs(pts[0][0] - S(CLAMSHELL_STA)) < 1e-9;

/** A deck-fairing key [STA, top h, bottom h, half width] interpolated at a station. */
export function deckKey(sta: number): [number, number, number] {
  const k = DECK_FAIRING;
  if (sta <= k[0][0]) return [k[0][1], k[0][2], k[0][3]];
  for (let i = 0; i < k.length - 1; i++) if (sta <= k[i + 1][0]) {
    const t = (sta - k[i][0]) / (k[i + 1][0] - k[i][0]);
    return [THREE.MathUtils.lerp(k[i][1], k[i + 1][1], t), THREE.MathUtils.lerp(k[i][2], k[i + 1][2], t), THREE.MathUtils.lerp(k[i][3], k[i + 1][3], t)];
  }
  const l = k[k.length - 1]; return [l[1], l[2], l[3]];
}
/** A point on the deck fairing at a station and section angle a (-pi/2 left edge, 0 top, pi/2 right edge), FRD. */
export function deckPoint(sta: number, a: number, lift = 0): FRD {
  const [top, bottom, hw] = deckKey(sta), s = Math.sin(a), c = Math.cos(a);
  const y = (hw + lift) * Math.sign(s) * Math.pow(Math.abs(s), 2 / DECK_N);
  const h = bottom + (top + lift - bottom) * Math.pow(Math.max(0, c), 2 / DECK_N);
  return [S(sta), y, H(h)];
}

export function buildBo105Exterior(def: AirframeVisualDef, m: Bo105Materials, skin: Bo105SkinWidth, section: Bo105Section) {
  const group = new THREE.Group(); group.name = 'bo105Exterior';
  const b = new MeshBatch(), d = def.rotorcraftVisual!;
  const add = (material: THREE.Material, g: THREE.BufferGeometry) => b.add(material, g);

  // ---------------------------------------------------------------- upper deck: transmission and engine fairing
  add(m.paint, fairingLoft(DECK_FAIRING.map(([s, top, bot, hw]) => [S(s), H(top), H(bot), hw] as const), DECK_N, true));
  // Transmission oil-cooler air inlet across the fairing's rounded front.
  add(m.grille, box(deckPoint(2.755, 0, -0.035), [0.03, 0.40, 0.075], 0.02));
  for (const side of [-1, 1]) {
    // Engine air intake: an oval grille in the fairing side at the front of the engine bay, with a lip.
    const p = deckPoint(INTAKE.sta, side * Math.PI / 2 * 0.86);
    const intake = new THREE.SphereGeometry(1, 24, 12).scale(0.02, INTAKE.halfHeight, INTAKE.halfLength);
    add(m.grille, intake.translate(...frd(p[0], p[1], H(INTAKE.h)).toArray()));
    const lip = new THREE.TorusGeometry(1, 0.012, 8, 32).scale(INTAKE.halfLength, INTAKE.halfHeight, 1).rotateY(Math.PI / 2);
    add(m.paint, lip.translate(...frd(p[0], p[1] + side * 0.004, H(INTAKE.h)).toArray()));
    // Cooling-air louvres on the engine-bay side panels aft of the intakes (D-HILF).
    for (let k = 0; k < 6; k++) {
      const s = 3.90 + k * 0.06, q = deckPoint(s, side * Math.PI / 2 * 0.80, 0.002);
      add(m.dark, box([q[0], q[1], H(2.21)], [0.012, 0.012, 0.15], 0.002));
    }
    // Cowling hinges along the deck's lower edge.
    for (const s of [2.95, 3.40, 3.85, 4.25]) {
      const q = deckPoint(s, side * Math.PI / 2 * 0.97, 0.004);
      add(m.grey, box([q[0], q[1], H(1.93)], [0.05, 0.012, 0.018], 0.003));
    }
  }
  // Panel seams across the deck (transmission cowl, engine cowls).
  for (const s of [2.98, 3.48, 4.34]) {
    const ring: FRD[] = [];
    for (let k = 0; k <= 30; k++) ring.push(deckPoint(s, THREE.MathUtils.lerp(-Math.PI / 2 * 0.98, Math.PI / 2 * 0.98, k / 30), 0.002));
    add(m.dark, pathTube(ring, 0.004, 60));
  }
  // The transmission top under the swashplate: the stationary housing and the mast (drive shaft) up to the hub, on the
  // forward-tilted shaft axis (a point `below` metres under the hub, `x`/`y` off the axis).
  const tilt = shaftTilt(def.rotorcraft!), ct = Math.cos(tilt), st = Math.sin(tilt);
  const shaft = (below: number, x = 0, y = 0): FRD => [D.MAIN_HUB.x - below * st + x * ct, y, D.MAIN_HUB.z + below * ct + x * st];
  const deckBelow = D.HUB_HEIGHT - 2.38, swashBelow = SWASHPLATE_DROP + 0.06;
  add(m.cast, tube(shaft(deckBelow), shaft(swashBelow), 0.15, 0.115, 32));
  add(m.grey, tube(shaft(swashBelow), shaft(HUB_TOP), 0.055, 0.05, 24));
  // Three servo rods from the deck to the stationary swashplate ring.
  for (let i = 0; i < 3; i++) {
    const a = i * Math.PI * 2 / 3 + 0.5, r = SWASH_RING + 0.03;
    const x = -Math.sin(a) * r, y = Math.cos(a) * r;
    add(m.metal, tube(shaft(deckBelow - 0.02, x, y), shaft(swashBelow, x, y), 0.009));
    add(m.cast, tube(shaft(deckBelow + 0.04, x, y), shaft(deckBelow - 0.02, x, y), 0.02, 0.02, 12));
  }
  // Non-rotating scissors from the housing to the stationary ring.
  add(m.cast, tube(shaft(deckBelow - 0.07, 0.12, 0.10), shaft(SWASHPLATE_DROP + 0.04, 0.17, 0.10), 0.01));

  // ---------------------------------------------------------------- tail boom, root fairing, driveshaft fairing
  add(m.paint, boom(d.boom.front, d.boom.rear, d.boom.radii));
  add(m.paint, fairingLoft(BOOM_ROOT_FAIRING.map(([s, top, bot, hw]) => [S(s), H(top), H(bot), hw] as const), 2.6, true));
  const shaftKeys: [number, number, number, number][] = [];
  for (const s of [5.40, 5.55, 6.5, 7.4, 8.2, Math.min(8.62, D.REF_STATION_M - FIN[0][0] + 0.05)]) {
    const top = boomHeight(s) + boomRadius(s) + (s < 5.5 ? 0.02 + (s - 5.40) * 0.33 : 0.07);
    shaftKeys.push([S(s), H(top), H(boomHeight(s)), s < 5.5 ? 0.05 : 0.062]);
  }
  add(m.paint, fairingLoft(shaftKeys, 2.4, true));
  // Boom joint frames.
  for (const s of [6.30, 8.10]) {
    const x = S(s), z = H(boomHeight(s)), r = boomRadius(s);
    add(m.grey, tube([x - 0.004, 0, z], [x + 0.004, 0, z], r + 0.0015, r + 0.0015, 32));
  }

  // ---------------------------------------------------------------- fin, gearboxes, stabiliser, tail skid
  // Swept fin (NACA 00xx-like section along the outline), its trailing edge on the 8.56 m fuselage end.
  add(m.paint, aerofoilPanel(FIN[0], FIN[3], FIN[1], FIN[2], [0, 1, 0], 0.14));
  // Intermediate gearbox at the fin base (the shaft turns up the fin leading edge, P5 FM 7-20) and its fairing.
  const igbSta = D.REF_STATION_M - FIN[0][0] + 0.02;
  add(m.paint, ellipsoid([S(igbSta), 0, H(boomHeight(igbSta) + boomRadius(igbSta) + 0.01)], [0.14, 0.07, 0.065], 20, 12));
  // Tail-rotor gearbox on the LEFT at the fin top with its output shaft to the hub, under a fin-top cover.
  const th = D.TAIL_HUB;
  add(m.paint, ellipsoid([th.x + 0.045, -0.02, th.z - 0.02], [0.15, 0.07, 0.075], 20, 12));
  add(m.cast, ellipsoid([th.x + 0.01, -0.085, th.z], [0.12, 0.075, 0.10], 20, 12));
  add(m.cast, tube([th.x, -0.12, th.z], [th.x, th.y + 0.07, th.z], 0.05, 0.04, 20));
  add(m.metal, tube([th.x, th.y + 0.075, th.z], [th.x, th.y + 0.02, th.z], 0.022, 0.022, 14));
  add(m.dark, tube([th.x + 0.07, -0.08, th.z - 0.09], [th.x + 0.07, -0.08, th.z - 0.12], 0.014, 0.014, 10));
  // Stabiliser at 0 deg incidence (P AR-280) through the boom, and its endplates.
  const half = STAB.span / 2 - ENDPLATE_HALF_THICKNESS, le = STAB.leadingX, te = STAB.leadingX - STAB.chord;
  add(m.paint, aerofoilPanel([le, -half, STAB.z], [te, -half, STAB.z], [le, half, STAB.z], [te, half, STAB.z], [0, 0, -1], 0.10, 4));
  for (const side of [-1, 1]) {
    // The 2.0 m span runs over the endplates' outer faces.
    const y = side * (STAB.span / 2 - ENDPLATE_HALF_THICKNESS), mid = (le + te) / 2, c = ENDPLATE.chord / 2;
    const top = STAB.z - ENDPLATE.height * ENDPLATE.above, bottom = STAB.z + ENDPLATE.height * (1 - ENDPLATE.above);
    add(m.paint, aerofoilPanel([mid + c, y, top], [mid - c, y, top], [mid + c - 0.02, y, bottom], [mid - c, y, bottom], [0, side, 0], 0.08, 4));
    add(m.band, aerofoilPanel([mid + c - 0.002, y, top - 0.002], [mid - c + 0.002, y, top - 0.002],
      [mid + c - 0.004, y, top + 0.05], [mid - c + 0.002, y, top + 0.05], [0, side, 0], 0.10, 3));
  }
  // Tail skid: the bent tube from under the boom to below the fin, with its root fitting.
  add(m.metal, pathTube(TAIL_SKID, d.guardRadius, 40));
  add(m.metal, new THREE.SphereGeometry(d.guardRadius, 10, 8).translate(...frd(...TAIL_SKID[TAIL_SKID.length - 1]).toArray()));
  add(m.cast, box([TAIL_SKID[0][0] + 0.01, 0, TAIL_SKID[0][2] - 0.02], [0.08, 0.05, 0.05], 0.008));

  // ---------------------------------------------------------------- skid landing gear
  const r = SKID_TUBE_RADIUS, zc = D.SKID_Z - r;
  const crossXs = CROSS_TUBE_STA.map(S);
  for (const side of [-1, 1]) {
    const y = side * D.SKID_HALF_TRACK;
    // Straight contact tube, short upturn at the rear and the curled toe at the front (photographs).
    const rail = new THREE.CurvePath<THREE.Vector3>();
    rail.add(new THREE.QuadraticBezierCurve3(frd(D.SKID_REAR_X - 0.04, y, zc - 0.04), frd(D.SKID_REAR_X + 0.02, y, zc), frd(D.SKID_REAR_X + 0.12, y, zc)));
    rail.add(new THREE.LineCurve3(frd(D.SKID_REAR_X + 0.12, y, zc), frd(D.SKID_FRONT_X - 0.35, y, zc)));
    rail.add(new THREE.CubicBezierCurve3(frd(D.SKID_FRONT_X - 0.35, y, zc), frd(D.SKID_FRONT_X - 0.10, y, zc),
      frd(D.SKID_FRONT_X + 0.02, y, zc - SKID_TOE_RISE * 0.5), frd(D.SKID_FRONT_X - 0.02, y, zc - SKID_TOE_RISE)));
    add(m.metal, new THREE.TubeGeometry(rail, 100, r, 14, false));
    add(m.metal, new THREE.SphereGeometry(r, 14, 8).translate(...frd(D.SKID_REAR_X - 0.04, y, zc - 0.04).toArray()));
    add(m.metal, new THREE.SphereGeometry(r, 14, 8).translate(...frd(D.SKID_FRONT_X - 0.02, y, zc - SKID_TOE_RISE).toArray()));
    // Wear shoes under the tube at the cross tubes; saddles clamping the cross tubes.
    for (const x of crossXs) {
      add(m.dark, box([x, y, D.SKID_Z - 0.008], [0.30, 0.03, 0.012], 0.004));
      add(m.cast, box([x, y, zc - r - 0.01], [0.12, 0.09, 0.045], 0.012));
    }
  }
  // The two cross tubes: one bent tube each, from skid to skid under the belly, arched (they bend on landing).
  const belly = H(D.BELLY_HEIGHT);
  for (const [i, x] of crossXs.entries()) {
    const lean = i === 0 ? 0.05 : -0.02, pts: FRD[] = [];
    const ys = [-1.265, -1.18, -1.02, -0.80, -0.55, -0.30, 0, 0.30, 0.55, 0.80, 1.02, 1.18, 1.265];
    const hs = [0.085, 0.16, 0.27, 0.35, 0.385, 0.37, 0.365, 0.37, 0.385, 0.35, 0.27, 0.16, 0.085];
    ys.forEach((yy, k) => pts.push([x + lean * (1 - Math.abs(yy) / 1.265), yy * D.SKID_HALF_TRACK / 1.265, H(hs[k])]));
    add(m.metal, pathTube(pts, CROSS_TUBE_RADIUS, 90));
    // Belly fittings where the cross tube is clamped to the fuselage.
    for (const yy of [-0.42, 0.42]) add(m.cast, box([x + lean * 0.7, yy, belly + 0.025], [0.12, 0.10, 0.06], 0.012));
  }
  // A boarding step on each front cross tube, below the crew doors.
  for (const side of [-1, 1]) add(m.dark, box([crossXs[0] + 0.04, side * 0.98, H(0.30)], [0.22, 0.16, 0.012], 0.004));

  // ---------------------------------------------------------------- glazing frames, doors, nose
  // The clamshell doors' edge as seen on the side: bottom edge from near the end forward, up the front edge, top edge aft.
  const clamshellEdge: [number, number][] = [[S(4.90), H(0.72)], [S(CLAMSHELL_STA), H(0.72)], [S(CLAMSHELL_STA), H(1.72)], [S(4.86), H(1.72)]];
  // Windscreen centre post over the nose, continuing as the roof's centre beam between the roof windows to the roof
  // frame across the cabin.
  const topPost: FRD[] = [];
  for (let i = 0; i <= 40; i++) {
    const x = THREE.MathUtils.lerp(S(0.718), S(1.93), i / 40);
    topPost.push([x, 0, section(x).zTop - 0.004]);
  }
  add(m.paint, pathTube(topPost, 0.016, 80));
  const roofFrame: FRD[] = [];
  for (let k = 0; k <= 24; k++) {
    // Across the roof only (the aft edge of the roof glazing), ending at the roof's shoulders above the doors.
    const a = THREE.MathUtils.lerp(Math.PI * 0.80, Math.PI * 1.20, k / 24), x = S(1.93);
    const p = ringPoint(section, x, a <= Math.PI ? a : 2 * Math.PI - a, 0.003);
    roofFrame.push([p[0], a <= Math.PI ? p[1] : -p[1], p[2]]);
  }
  add(m.paint, pathTube(roofFrame, 0.02, 60));
  // The painted centre strip between the chin windows (it carries the frame down to the keel).
  add(m.paint, centreStrip(section, S(1.15), D.NOSE_X - 0.02, 0.06, false, 0.003, 30));
  // Horizontal bow round the nose between the windscreen and the chin windows (both sides).
  const bow = [...skinPath(skin, -1, NOSE_BOW, 0.003, 24).reverse(), ...skinPath(skin, 1, NOSE_BOW, 0.003, 24)];
  add(m.paint, pathTube(bow, 0.014, 120));
  for (const side of [-1, 1]) {
    for (const door of def.glazing.doors) {
      // The clamshell outline runs past the pod's end (its doors face aft): only its edges on the side are sealed.
      const loop = isClamshell(door.pts) ? clamshellEdge : roundedLoop(door.pts, door.r);
      add(m.rubber, pathTube(skinPath(skin, side, loop, 0.002, 3), 0.004, 160));
      if (door.handle) {
        const p = skinPath(skin, side, [[door.handle.x, door.handle.z]], 0.012)[0];
        add(m.metal, tube([p[0] - 0.045, p[1], p[2]], [p[0] + 0.045, p[1], p[2]], 0.008));
        add(m.dark, box([p[0], p[1] - side * 0.006, p[2]], [0.11, 0.008, 0.03], 0.004));
      }
    }
    // Rubber surrounds on the door windows (glazing.windows 3+; 0 windscreen, 1 roof glazing, 2 chin windows).
    for (const w of def.glazing.windows.slice(3)) add(m.frame, pathTube(skinPath(skin, side, roundedLoop(w.pts, w.r), 0.003, 3), 0.011, 160));
    // A-post: the windscreen's aft frame from the nose bow up to the roof, then the roof window's side frame aft.
    const aPost: [number, number][] = [[S(1.16), H(1.06)], [S(1.22), H(1.31)], [S(1.30), H(1.70)], [S(1.38), H(1.955)], [S(1.93), H(1.985)]];
    add(m.paint, pathTube(skinPath(skin, side, aPost, 0.003, 10), 0.017, 80));
    // Crew-door hinges on its front edge.
    for (const [s, h] of [[1.17, 0.86], [1.23, 1.36]]) add(m.grey, box(skinPath(skin, side, [[S(s), H(h)]], 0.008)[0], [0.025, 0.014, 0.06], 0.004));
    // Sliding-door rails: the top rail under the roof edge and the bottom rail along the sill, running aft over the
    // fixed panel the door slides across.
    const rail = (h: number, offset: number): FRD[] => skinPath(skin, side, [[S(1.84), H(h)], [S(SLIDING_RAIL_END_STA), H(h)]], offset, 24);
    add(m.metal, pathTube(rail(1.965, 0.012), 0.008, 60));
    add(m.metal, pathTube(rail(0.655, 0.012), 0.008, 60));
    // Clamshell-door hinges at their front edges (they open outward about vertical hinges) and a handle.
    for (const h of [0.86, 1.56]) add(m.grey, box(skinPath(skin, side, [[S(CLAMSHELL_STA + 0.01), H(h)]], 0.008)[0], [0.03, 0.014, 0.07], 0.004));
    add(m.metal, box(skinPath(skin, side, [[S(4.85), H(1.06)]], 0.01)[0], [0.09, 0.014, 0.025], 0.005));
    // Fuel filler on the right side of the cabin aft of the sliding door (main tank under the cabin floor). ESTIMATE
    if (side > 0) {
      const f = skinPath(skin, 1, [[S(3.30), H(0.82)]], 0.004)[0];
      add(m.grey, tube([f[0], f[1] - 0.01, f[2]], [f[0], f[1] + 0.006, f[2]], 0.045, 0.045, 20));
    }
  }
  // Clamshell centre seam down the rear end of the pod (the two doors meet on the centreline).
  const seam: FRD[] = [];
  for (let k = 0; k <= 20; k++) {
    const t = k / 20, x = THREE.MathUtils.lerp(S(4.90), S(4.995), Math.sin(t * Math.PI)), s = section(x);
    seam.push([x + 0.002, 0, THREE.MathUtils.lerp(s.zBot, s.zTop, 0.08 + t * 0.84)]);
  }
  add(m.dark, pathTube(seam, 0.005, 40));

  // ---------------------------------------------------------------- small external fittings
  // Pitot tube on the roof ahead of the deck fairing, pointing forward (ESTIMATE), VHF whip on the boom top near the
  // stabiliser and a blade antenna under the belly, landing-light window under the nose.
  const pitotBase: FRD = [S(2.10), 0.18, section(S(2.10)).zTop + 0.005];
  add(m.metal, tube(pitotBase, [pitotBase[0] + 0.02, pitotBase[1], pitotBase[2] - 0.05], 0.008));
  add(m.metal, tube([pitotBase[0] + 0.02, pitotBase[1], pitotBase[2] - 0.05], [pitotBase[0] + 0.16, pitotBase[1], pitotBase[2] - 0.052], 0.0055));
  const whipBase: FRD = [S(7.05), 0, H(boomHeight(7.05) + boomRadius(7.05) + 0.06)];
  add(m.dark, tube(whipBase, [whipBase[0] - 0.10, 0, whipBase[2] - 0.70], 0.004, 0.002, 6));
  add(m.dark, box([S(3.10), 0, H(D.BELLY_HEIGHT) + 0.06], [0.18, 0.008, 0.11], 0.003));
  add(m.lens, ellipsoid([S(1.30), 0, H(0.415)], [0.07, 0.07, 0.012], 16, 8));
  // Anti-collision beacon base on the deck aft of the exhausts.
  add(m.dark, tube([S(4.78), 0, H(2.31)], [S(4.78), 0, H(2.335)], 0.03, 0.03, 16));
  group.add(b.build('bo105Structure'));
  return { group, materials: [] as THREE.Material[], textures: [] as THREE.Texture[] };
}

/** Station of the airframe's aft end (for tests): the fin trailing edge is clipped to it. */
export const AFT_END_STA = TAIL_END_STA;
