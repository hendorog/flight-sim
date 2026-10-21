// AH-56A exterior details: the transmission fairing and T64 cowl with its two bell-mouth intakes and the exhaust nozzle,
// the static mast, the sponsons, the low wing (5 deg dihedral, no control surfaces), the ventral fin with the tail-wheel
// housing at its lower end, the stabiliser (plain right panel, bobtailed left panel carrying the tail-rotor gearbox),
// the canopy bows, sills and the butterfly hinge line, the gunner's sight head, steps, antennas and the US Army
// markings (decals). Stations come from dimensions.ts (P) through visual.ts; shapes are 3V ESTIMATES
// (docs/ah56-exterior.md). Decoration never supplies contact or aerodynamic geometry.
import * as THREE from 'three';
import type { AirframeVisualDef, FRD } from '../../render/aircraft/airframe/types';
import { frd, MeshBatch } from '../../render/aircraft/geometry';
import { box, pathTube, tube } from '../../render/aircraft/rotorcraft/geometry';
import * as D from './dimensions';
import { CANOPY_BOWS, EXHAUST, FRONT_SILL, INTAKE, REAR_SILL, SPONSON, STABILISER, TRANSMISSION_FAIRING, VENTRAL_FIN, WING_PLAN,
  bl, fs, wingChordIn, wingQuarterWl, wl } from './visual';
import { aerofoilPanel, canvasTexture, decalMaterial, ellipsoid, fairingLoft, loftBand, loftDecal, nacaThickness, revolve, ringPoint,
  skinPath, type AH56Materials, type AH56Section, type AH56SkinWidth } from './exteriorGeometry';

const IN = 0.0254;
const DEG = Math.PI / 180;

/** One wing panel's chord line at butt line b (in), side +1 right: leading and trailing edge points (incidence about the
 *  quarter chord, LE up; twist linear from the reference station to the tip). */
export function wingChord(b: number, side: number): { le: FRD; te: FRD; incidence: number } {
  const c = wingChordIn(b) * IN, qcX = fs(WING_PLAN.teFs - 0.75 * wingChordIn(b)), qcZ = wl(wingQuarterWl(b));
  const base = side > 0 ? WING_PLAN.incidenceDeg.right : WING_PLAN.incidenceDeg.left;
  const inc = (base + WING_PLAN.twistDeg * (b - WING_PLAN.refBl) / (WING_PLAN.tipBl - WING_PLAN.refBl)) * DEG;
  const y = side * bl(b);
  return { le: [qcX + c / 4 * Math.cos(inc), y, qcZ - c / 4 * Math.sin(inc)], te: [qcX - 0.75 * c * Math.cos(inc), y, qcZ + 0.75 * c * Math.sin(inc)], incidence: inc };
}

/** Ventral-fin chord at water line w: leading and trailing edge FS (linear between the root and tip of the outline). */
export function finChordAt(w: number): { le: number; te: number } {
  const [rl, tl, tt, rt] = VENTRAL_FIN.outline, t = (rl[1] - w) / (rl[1] - tl[1]);
  return { le: THREE.MathUtils.lerp(rl[0], tl[0], t), te: THREE.MathUtils.lerp(rt[0], tt[0], t) };
}
/** Ventral-fin t/c: NACA 0018 mod at the root to 0015 near the wheel housing (ESTIMATE for the tip). */
const finThickness = (w: number): number => THREE.MathUtils.lerp(VENTRAL_FIN.thickness, 0.15, (114.5 - w) / (114.5 - 37.6));

/** Stabiliser chord line at butt line b (in, left negative). The left panel's trailing edge steps forward outboard of the
 *  bob station. Incidence 2 deg LE up about the quarter chord, on WL 114.5. */
export function stabChord(b: number): { le: FRD; te: FRD } {
  const p = b < 0 ? STABILISER.left : STABILISER.right, a = Math.abs(b);
  const c = (p.rootChordIn + (p.tipChordIn - p.rootChordIn) * a / p.tipBl) * IN;
  const cut = b < 0 && a > STABILISER.bob.fromBl ? STABILISER.bob.cutIn * IN : 0;
  const te = fs(STABILISER.teFs), le = te + c, inc = STABILISER.incidenceDeg * DEG, qc = le - c / 4, z = wl(STABILISER.wl);
  return { le: [qc + c / 4 * Math.cos(inc), bl(b), z - c / 4 * Math.sin(inc)],
    te: [qc - (0.75 * c - cut) * Math.cos(inc), bl(b), z + (0.75 * c - cut) * Math.sin(inc)] };
}

export function buildAH56Exterior(def: AirframeVisualDef, m: AH56Materials, skin: AH56SkinWidth, section: AH56Section) {
  const group = new THREE.Group(); group.name = 'ah56Exterior';
  const b = new MeshBatch();
  const add = (material: THREE.Material, g: THREE.BufferGeometry) => b.add(material, g);
  const materials: THREE.Material[] = [], textures: THREE.Texture[] = [];

  // ---------------------------------------------------------------- transmission fairing, T64 cowl, mast
  add(m.paint, fairingLoft(TRANSMISSION_FAIRING.map(([s, top, bot, hw]) => [fs(s), wl(top), wl(bot), hw * IN] as const), 3.0));
  // Cowl louvres and the sliding-cowl split line (photographs: grille panels on the cowl sides aft of the intakes).
  for (const side of [-1, 1]) for (let k = 0; k < 6; k++) {
    const x = fs(352 + k * 2.6), z = wl(150.5);
    add(m.dark, box([x, side * (12.3 * IN), z], [0.016, 0.012, 0.11], 0.003));
  }
  // Static mast and the transmission top plate (the rotating hardware is exteriorRotor.ts).
  add(m.grey, tube([fs(300), 0, wl(155.5)], [fs(300), 0, wl(159)], 0.135, 0.125, 32));
  add(m.metal, tube([fs(300), 0, wl(159)], [fs(300), 0, wl(162.5)], 0.075, 0.075, 24));

  // ---------------------------------------------------------------- T64 intakes and exhaust
  for (const side of [-1, 1]) {
    const y = side * bl(INTAKE.bl), z = wl(INTAKE.wl), lip = fs(INTAKE.lipFs);
    add(m.paint, revolve([[lip, INTAKE.lipRadiusIn * IN], [fs(INTAKE.lipFs + 4), INTAKE.lipRadiusIn * 0.98 * IN], [fs(318), INTAKE.ductRadiusIn * IN],
      [fs(INTAKE.endFs - 6), 0.85 * INTAKE.ductRadiusIn * IN], [fs(INTAKE.endFs), 0.45 * INTAKE.ductRadiusIn * IN], [fs(INTAKE.endFs + 1), 0]], y, z, 36));
    const ring = new THREE.TorusGeometry((INTAKE.lipRadiusIn - 0.6) * IN, 0.6 * IN, 10, 40).translate(...frd(lip, y, z).toArray());
    add(m.paint, ring);
    add(m.dark, new THREE.CircleGeometry((INTAKE.lipRadiusIn - 0.9) * IN, 36).rotateY(Math.PI).translate(...frd(lip - 0.06, y, z).toArray()));
    add(m.grey, ellipsoid([lip - 0.07, y, z], [0.07, 0.065, 0.065], 16, 10));
  }
  {
    const up = EXHAUST.upDeg * DEG, r = EXHAUST.radiusIn * IN, exit: FRD = [fs(EXHAUST.fs), 0, wl(EXHAUST.wl)];
    const root: FRD = [exit[0] + 0.45 * Math.cos(up), 0, exit[2] + 0.45 * Math.sin(up)];
    add(m.exhaust, tube(root, exit, r * 1.05, r, 32));
    add(m.soot, new THREE.CircleGeometry(r * 0.92, 32).rotateY(Math.PI).rotateX(-up).translate(...frd(exit[0] + 0.004, 0, exit[2]).toArray()));
    add(m.paint, fairingLoft([[fs(410), wl(146), wl(140), 9 * IN], [fs(430), wl(148.2), wl(138), 10 * IN], [exit[0] + 0.05, wl(148.2), wl(139), r / 0.95 + 0.01]], 2.6));
  }

  // ---------------------------------------------------------------- sponsons and the wing
  for (const side of [-1, 1]) {
    add(m.paint, revolve(SPONSON.profile.map(([s, r]) => [fs(s), r * IN] as const), side * bl(SPONSON.bl), wl(SPONSON.wl), 40));
    // Fillet between the sponson and the body side.
    add(m.paint, revolve([[fs(200), 0], [fs(206), 6 * IN], [fs(225), 9 * IN], [fs(345), 9 * IN], [fs(375), 6 * IN], [fs(392), 0]],
      side * bl(26), wl(73), 24, 1.1));
    // The wing: NACA 4-digit (P "originally a 4-digit") at 12 % root to 8 % tip, a light camber standing in for the
    // trailing-edge extension (ESTIMATE). Tip fairing a rounded cap.
    const root = wingChord(WING_PLAN.rootBl, side), tip = wingChord(WING_PLAN.tipBl, side);
    const tc = (bb: number) => THREE.MathUtils.lerp(WING_PLAN.rootThickness, WING_PLAN.tipThickness, bb / WING_PLAN.tipBl);
    const normal: FRD = [Math.sin(root.incidence), -side * Math.sin(WING_PLAN.dihedralDeg * DEG), -Math.cos(root.incidence)];
    add(m.paint, aerofoilPanel(root.le, root.te, tip.le, tip.te, normal, tc(WING_PLAN.rootBl), tc(WING_PLAN.tipBl), 10, 41, { m: 0.02, p: 0.4 }));
    const tipC = wingChordIn(WING_PLAN.tipBl) * IN;
    add(m.paint, ellipsoid([(tip.le[0] + tip.te[0]) / 2, tip.le[1] + side * 0.008, (tip.le[2] + tip.te[2]) / 2], [tipC * 0.48, 0.02, tipC * 0.045], 20, 8));
    // The walkway over the RIGHT sponson (P: entry by a walkway over the right sponson) as a dark anti-slip strip.
    if (side > 0) {
      const walk: FRD[] = [];
      for (let s = 200; s <= 300; s += 10) walk.push([fs(s), side * bl(SPONSON.bl), wl(SPONSON.wl + 13.4)]);
      add(m.dark, pathTube(walk, 0.035, 20));
    }
  }

  // ---------------------------------------------------------------- ventral fin and the tail-wheel housing
  {
    const [rl, tl, tt, rt] = VENTRAL_FIN.outline;
    add(m.paint, aerofoilPanel([fs(rl[0]), 0, wl(rl[1])], [fs(rt[0]), 0, wl(rt[1])], [fs(tl[0]), 0, wl(tl[1])], [fs(tt[0]), 0, wl(tt[1])],
      [0, 1, 0], VENTRAL_FIN.thickness, 0.15, 8, 41));
    // Bulged lower end housing the retracted tail wheel (P "retracts into the ventral fin"): an oval pod.
    add(m.paint, revolve([[fs(628), 0], [fs(631), 2.2 * IN], [fs(637), 3.6 * IN], [fs(648), 4.1 * IN], [fs(664), 4.0 * IN], [fs(670), 2.8 * IN],
      [fs(673), 0]], 0, wl(42), 28, 2.2));
  }

  // ---------------------------------------------------------------- stabiliser and the tail-rotor gearbox
  {
    // Right panel: root inside the cone to the tip (NACA 0018 -> 0012). Left panel: full chord to the bob station, then
    // the cut-back outer panel.
    const r0 = stabChord(0), r1 = stabChord(STABILISER.right.tipBl);
    const n: FRD = [Math.sin(STABILISER.incidenceDeg * DEG), 0, -Math.cos(STABILISER.incidenceDeg * DEG)];
    add(m.paint, aerofoilPanel(r0.le, r0.te, r1.le, r1.te, n, STABILISER.rootThickness, STABILISER.tipThickness, 6, 33));
    const l0 = stabChord(-0.001), lb = stabChord(-STABILISER.bob.fromBl), lb2 = stabChord(-STABILISER.bob.fromBl - 0.01), l1 = stabChord(-STABILISER.left.tipBl);
    const tcAt = (a: number) => THREE.MathUtils.lerp(STABILISER.rootThickness, STABILISER.tipThickness, a / STABILISER.left.tipBl);
    add(m.paint, aerofoilPanel(l0.le, l0.te, lb.le, lb.te, n, STABILISER.rootThickness, tcAt(STABILISER.bob.fromBl), 5, 33));
    add(m.paint, aerofoilPanel(lb2.le, lb2.te, l1.le, l1.te, n, tcAt(STABILISER.bob.fromBl) * 1.15, STABILISER.tipThickness * 1.2, 4, 33));
    // Right tip cap; the left tip carries the tail-rotor gearbox (P: TR at the left stabiliser tip, hub BL 72 L).
    const tipC = r1.le[0] - r1.te[0];
    add(m.paint, ellipsoid([(r1.le[0] + r1.te[0]) / 2, r1.le[1] + 0.006, wl(114.5)], [tipC * 0.48, 0.016, 0.03], 16, 8));
    const th = D.TAIL_HUB;
    add(m.cast, ellipsoid([th.x + 0.02, th.y + 0.13, th.z], [0.30, 0.12, 0.12], 24, 14));
    add(m.cast, tube([th.x, th.y + 0.05, th.z], [th.x, th.y - 0.03, th.z], 0.075, 0.06, 20));
    add(m.metal, tube([th.x, th.y - 0.03, th.z], [th.x, th.y - 0.06, th.z], 0.035, 0.035, 14));
  }

  // ---------------------------------------------------------------- canopy bows, sills, the butterfly hinge line
  {
    const bow = (s: number, sillWl: number, rad: number) => {
      const x = fs(s), zSill = wl(sillWl), right: FRD[] = [];
      for (let k = 0; k <= 32; k++) {
        const p = ringPoint(section, x, Math.PI - k / 32 * Math.PI * 0.62, 0.004);
        if (p[2] > zSill + 0.005) break;
        right.push(p);
      }
      if (right.length < 2) return;
      const path = [...right.slice(1).reverse().map(p => [p[0], -p[1], p[2]] as FRD), ...right];
      add(m.frame, pathTube(path, rad, 60));
    };
    const sillAt = (pts: readonly (readonly [number, number])[], s: number) => {
      for (let i = 0; i < pts.length - 1; i++) if (s >= pts[i][0] - 1e-6 && s <= pts[i + 1][0] + 1e-6)
        return THREE.MathUtils.lerp(pts[i][1], pts[i + 1][1], (s - pts[i][0]) / (pts[i + 1][0] - pts[i][0] || 1));
      return pts[pts.length - 1][1];
    };
    for (const s of CANOPY_BOWS.front) bow(s, sillAt(FRONT_SILL, s), s === CANOPY_BOWS.front[0] || s === 137.5 ? 0.016 : 0.010);
    for (const s of CANOPY_BOWS.rear) bow(s, sillAt(REAR_SILL, s), s === CANOPY_BOWS.rear[0] || s === 206 ? 0.016 : 0.010);
    for (const side of [-1, 1]) for (const sill of [FRONT_SILL, REAR_SILL]) {
      const pts = sill.map(([s, w]) => [fs(s), wl(w)] as const);
      add(m.frame, pathTube(skinPath(skin, side, pts, 0.004, 10), 0.016, 60));
    }
    // Centreline frame over both canopies: the butterfly hinge line, with the hinge blocks.
    const top: FRD[] = [];
    for (let s = 66; s <= 206; s += 2) top.push([fs(s), 0, section(fs(s)).zTop - 0.006]);
    add(m.frame, pathTube(top, 0.011, 140));
    for (const s of [90, 120, 160, 196]) add(m.cast, box([fs(s), 0, section(fs(s)).zTop - 0.02], [0.07, 0.05, 0.03], 0.006));
    // Canopy jettison/handle fittings below the sills (yellow rescue markings on the photographs are not drawn).
    for (const s of [100, 175]) {
      const p = skinPath(skin, 1, [[fs(s), wl(s < 140 ? 93 : 105)]], 0.01)[0];
      add(m.metal, tube([p[0] - 0.04, p[1], p[2]], [p[0] + 0.04, p[1], p[2]], 0.007));
    }
  }

  // ---------------------------------------------------------------- gunner's sight head, steps, antennas, pitot
  // The CP/G sight window on the nose top (Rucker front: the dark oval dome ahead of the windshield).
  add(m.sight, ellipsoid([fs(49), 0, section(fs(49)).zTop + 0.012], [0.21, 0.17, 0.07], 32, 14));
  add(m.frame, new THREE.TorusGeometry(0.17, 0.012, 8, 40).scale(1, 1.25, 1).rotateX(Math.PI / 2).translate(...frd(fs(49), 0, section(fs(49)).zTop + 0.004).toArray()));
  // Folding boarding step under the RIGHT canopy sill and the boarding ladder socket on the aft right sponson (P).
  {
    const p = skinPath(skin, 1, [[fs(150), wl(84)]], 0)[0];
    add(m.metal, box([p[0], p[1] + 0.03, p[2]], [0.16, 0.06, 0.012], 0.004));
    add(m.dark, box([fs(345), bl(SPONSON.bl + 13.2), wl(SPONSON.wl)], [0.12, 0.012, 0.05], 0.004));
  }
  add(m.dark, box([fs(250), 0, section(fs(250)).zBot + 0.05], [0.18, 0.006, 0.10], 0.003));
  add(m.dark, box([fs(395), 0, wl(150.5)], [0.16, 0.006, 0.09], 0.003));
  // Pitot heads on the nose shoulders, behind the nose tip.
  for (const side of [-1, 1]) add(m.metal, tube([fs(47), side * bl(10), wl(80)], [fs(38), side * bl(9), wl(80)], 0.006));
  group.add(b.build('ah56Structure'));

  // ---------------------------------------------------------------- markings (decals)
  const decals = new MeshBatch();
  const decal = (name: string, w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void) => {
    const t = canvasTexture(w, h, draw), mat = decalMaterial(name, t);
    textures.push(t); materials.push(mat); return mat;
  };
  const stencil = '700 {px}px "DIN Condensed", "Arial Narrow", "Helvetica Neue", Arial, sans-serif';
  const army = decal('Army', 1024, 256, (g, w, h) => {
    g.fillStyle = '#161714'; g.font = stencil.replace('{px}', String(Math.round(h * 0.86)));
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('ARMY', w / 2, h * 0.53, w * 0.98);
  });
  const star = decal('Star', 1024, 512, (g, w, h) => {
    const cx = w / 2, cy = h / 2, r = h * 0.44;
    // Bars: white with a red centre stripe, outlined blue; the blue disc with a white five-pointed star.
    g.fillStyle = '#1f2f5a'; g.fillRect(cx - r * 2.05, cy - r * 0.52, r * 4.1, r * 1.04);
    g.fillStyle = '#e8e6dc'; g.fillRect(cx - r * 1.98, cy - r * 0.45, r * 3.96, r * 0.9);
    g.fillStyle = '#a42a24'; g.fillRect(cx - r * 1.98, cy - r * 0.16, r * 3.96, r * 0.32);
    g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fillStyle = '#1f2f5a'; g.fill();
    g.beginPath();
    for (let k = 0; k < 10; k++) {
      const a = -Math.PI / 2 + k * Math.PI / 5, rr = k % 2 === 0 ? r * 0.96 : r * 0.38;
      g[k === 0 ? 'moveTo' : 'lineTo'](cx + rr * Math.cos(a), cy + rr * Math.sin(a));
    }
    g.closePath(); g.fillStyle = '#e8e6dc'; g.fill();
  });
  // The prop-danger band: yellow, with a red arrow pointing AFT at the propeller on each side ("DANGER KEEP AWAY").
  const arrowAft = (right: boolean) => decal(right ? 'DangerR' : 'DangerL', 512, 256, (g, w, h) => {
    const dir = right ? -1 : 1, x0 = w / 2 - dir * w * 0.36, x1 = w / 2 + dir * w * 0.36;
    g.fillStyle = '#a42a24'; g.strokeStyle = '#a42a24'; g.lineWidth = h * 0.1;
    g.beginPath(); g.moveTo(x0, h * 0.62); g.lineTo(x1 - dir * h * 0.2, h * 0.62); g.stroke();
    g.beginPath(); g.moveTo(x1, h * 0.62); g.lineTo(x1 - dir * h * 0.28, h * 0.44); g.lineTo(x1 - dir * h * 0.28, h * 0.8); g.closePath(); g.fill();
    g.font = stencil.replace('{px}', String(Math.round(h * 0.17))); g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('DANGER', w / 2, h * 0.2); g.fillText('KEEP AWAY', w / 2, h * 0.36);
  });
  const finText = decal('FinSerial', 512, 512, (g, w, h) => {
    g.fillStyle = '#161714'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = stencil.replace('{px}', String(Math.round(h * 0.16))); g.fillText('U.S. ARMY', w / 2, h * 0.36, w * 0.96);
    g.font = stencil.replace('{px}', String(Math.round(h * 0.19))); g.fillText('68832', w / 2, h * 0.6, w * 0.9);
  });
  const yellow = new THREE.MeshStandardMaterial({ name: 'ah56PropBand', color: 0xd9b52a, roughness: 0.5,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  materials.push(yellow);
  decals.add(yellow, loftBand(section, fs(540), fs(573), 0.0025, 4, 61));
  for (const side of [-1, 1]) {
    decals.add(army, loftDecal(skin, side, fs(468), fs(534), wl(127), wl(107), 0.004, 20, 10));
    decals.add(star, loftDecal(skin, side, fs(421), fs(463), wl(128.5), wl(107.5), 0.004, 16, 10));
    decals.add(arrowAft(side > 0), loftDecal(skin, side, fs(541), fs(572), wl(124), wl(106), 0.006, 10, 8));
    decals.add(finText, finDecal(side, 604, 638, 92, 64));
  }
  group.add(decals.build('ah56Markings', { cast: false, receive: true }));
  return { group, materials, textures };
}

/** A decal on the ventral fin's side `side` between FS fs0..fs1 and WL wlTop..wlBottom, on the aerofoil surface. */
export function finDecal(side: number, fs0: number, fs1: number, wlTop: number, wlBottom: number, rows = 10, cols = 10): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry(), pos: number[] = [], uv: number[] = [], index: number[] = [];
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
    const s = THREE.MathUtils.lerp(fs0, fs1, i / (rows - 1)), w = THREE.MathUtils.lerp(wlTop, wlBottom, j / (cols - 1));
    const c = finChordAt(w), xc = THREE.MathUtils.clamp((s - c.le) / (c.te - c.le), 0, 1);
    const half = nacaThickness(finThickness(w), xc) * (c.te - c.le) * IN;
    pos.push(...frd(fs(s), side * (half + 0.003), wl(w)).toArray());
    const u = i / (rows - 1);
    uv.push(side > 0 ? 1 - u : u, 1 - j / (cols - 1));
  }
  for (let i = 0; i < rows - 1; i++) for (let j = 0; j < cols - 1; j++) {
    const a = i * cols + j, bb = (i + 1) * cols + j, c = i * cols + j + 1, d = (i + 1) * cols + j + 1;
    index.push(a, bb, c, c, bb, d);
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(index); g.computeVertexNormals();
  return g;
}
