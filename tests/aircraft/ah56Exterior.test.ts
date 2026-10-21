// AH-56A Cheyenne exterior, heads, gear and crew stations (package AX, plan revision 2 section 7.5). Accuracy rows:
// main rotor diameter 15.62 m (P), fuselage 54 ft 8 in +/- 1 % (S), span 26.7 ft +/- 1 % (P), height 13 ft 8.5 in +/- 2 %
// (S, the ICS head with its gyro X), tail rotor and prop 10 ft (P) at the station table +/- 1 in, belly turret 21 in
// +/- 2 in above the ground (P), main track about 62 in +/- 10 % (D), TR and prop lowest tips about 3 ft above the ground
// (D), and no mesh below the tyre contact plane except the tyres.
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { AH56_VISUAL as def, CANOPY_BOWS, LOFT, LOFT_END_FS, SPINNER, SPONSON, STABILISER, VENTRAL_FIN, WING_PLAN, fs, fsOf, wl }
  from '../../src/aircraft/ah56/visual';
import { AH56_ROTORCRAFT } from '../../src/aircraft/ah56/rotorcraft';
import { AH56_PANEL } from '../../src/aircraft/ah56/panel';
import { AH56_DEFINITION } from '../../src/aircraft/ah56';
import { ah56ExteriorVisualClass } from '../../src/aircraft/ah56/exterior';
import { AH56MainRotor, AH56Pusher, GYRO, PUSHER_FEATHER, hingeOffset } from '../../src/aircraft/ah56/exteriorRotor';
import { AH56Gear, MAIN_RETRACT } from '../../src/aircraft/ah56/exteriorGear';
import { BELLY_TURRET } from '../../src/aircraft/ah56/exteriorWeapons';
import { finChordAt, stabChord, wingChord } from '../../src/aircraft/ah56/exteriorDetails';
import { aerofoilPanel, ah56Materials, revolve } from '../../src/aircraft/ah56/exteriorGeometry';
import * as D from '../../src/aircraft/ah56/dimensions';
import { AH56_PANEL_CANVAS, AH56_PANEL_FACE } from '../../src/aircraft/ah56/panelLayout';
import { AH56_PROP_RATIO } from '../../src/aircraft/ah56/facts';
import { FuselageShape } from '../../src/render/aircraft/fuselageShape';
import { RotorcraftVisual } from '../../src/render/aircraft/RotorcraftVisual';
import { sectionHalfWidth } from '../../src/render/aircraft/fuselage';
import { makeWindowSdf } from '../../src/render/aircraft/livery';
import { frd } from '../../src/render/aircraft/geometry';
import { TeeteringRotor } from '../../src/render/aircraft/rotorcraft/rotor';
import { emptyRotorcraftState, type RotorcraftState } from '../../src/physics/rotorcraft/definition';
import { swashplateCyclic } from '../../src/physics/rotorcraft/swashplate';
import { panelUvBasis } from '../../src/instruments/panelProjection';
import { blankDocument, fakeContext, fakeMaterials, nonFinite } from './meshChecks';

const IN = 0.0254, FT = 0.3048, DEG = Math.PI / 180;
const Visual = ah56ExteriorVisualClass(RotorcraftVisual, FuselageShape, sectionHalfWidth, ctx => ctx.state.rotorcraft);
type V = InstanceType<typeof Visual> & { head: AH56MainRotor; pusher: AH56Pusher; gear: AH56Gear; tailRotor: { rotor: TeeteringRotor } };
/** FRD point of a three.js model-space vector. */
const toFrd = (v: THREE.Vector3): [number, number, number] => [-v.z, v.x, -v.y];

/** Build the complete visual parked, rotors stopped, run `fn`, dispose. */
function withVisual(fn: (visual: V, ctx: ReturnType<typeof fakeContext>) => void, setup?: (s: RotorcraftState) => void): void {
  vi.stubGlobal('document', blankDocument());
  const ctx = fakeContext(); ctx.state.rotorcraft = emptyRotorcraftState(); ctx.state.electrical.busVoltage = 28;
  // Free (uncompressed) struts: the contacts of the gear contract are the free tyre contacts.
  for (const w of ctx.state.wheels) w.compression = 0;
  setup?.(ctx.state.rotorcraft);
  const visual = new Visual(def, ctx, { lightScale: 1, panelEmissiveScale: 1, interiorLodDistance: 50, panelDef: AH56_PANEL }) as V;
  try { visual.update(ctx); visual.root.updateMatrixWorld(true); fn(visual, ctx); }
  finally { visual.dispose(); vi.unstubAllGlobals(); }
}

/** Visible-mesh vertices of the subtree `root` in the model space of `frame` (FRD), skipping the given subtrees. */
function vertices(root: THREE.Object3D, skip: THREE.Object3D[] = [], filter: (m: THREE.Mesh) => boolean = () => true, frame: THREE.Object3D = root): [number, number, number][] {
  const out: [number, number, number][] = [], v = new THREE.Vector3(), m = new THREE.Matrix4(), inv = frame.matrixWorld.clone().invert();
  const walk = (o: THREE.Object3D): void => {
    if (!o.visible || skip.includes(o)) return;
    if (o instanceof THREE.Mesh && !(o instanceof THREE.InstancedMesh) && !o.name.startsWith('shadowProxy') && filter(o)) {
      const p = o.geometry.getAttribute('position');
      m.multiplyMatrices(inv, o.matrixWorld);
      for (let i = 0; i < p.count; i++) out.push(toFrd(v.fromBufferAttribute(p, i).applyMatrix4(m)));
    }
    o.children.forEach(walk);
  };
  walk(root); return out;
}

/** Tip points of an instanced blade mesh (local +X to the radius), in model FRD. */
function bladeTips(rotor: TeeteringRotor, radius: number, root: THREE.Object3D): [number, number, number][] {
  const m = new THREE.Matrix4(), inv = root.matrixWorld.clone().invert(), out: [number, number, number][] = [];
  for (let i = 0; i < rotor.blades.count; i++) {
    rotor.blades.getMatrixAt(i, m);
    for (const z of [-0.1, 0, 0.1]) out.push(toFrd(new THREE.Vector3(radius, 0, z).applyMatrix4(m).applyMatrix4(rotor.blades.matrixWorld).applyMatrix4(inv)));
  }
  return out;
}

/** Area fractions of a closed shell whose triangle winding and vertex normals face away from its centroid. */
function outwardFraction(g: THREE.BufferGeometry): { winding: number; normals: number } {
  const p = g.getAttribute('position'), nAttr = g.getAttribute('normal'), idx = g.getIndex()!;
  const c = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3(), d = new THREE.Vector3(), vn = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) c.add(a.fromBufferAttribute(p, i));
  c.divideScalar(p.count);
  let wOut = 0, nOut = 0, total = 0;
  for (let t = 0; t < idx.count; t += 3) {
    const i0 = idx.getX(t), i1 = idx.getX(t + 1), i2 = idx.getX(t + 2);
    a.fromBufferAttribute(p, i0); b.fromBufferAttribute(p, i1); d.fromBufferAttribute(p, i2);
    const centre = a.clone().add(b).add(d).divideScalar(3).sub(c);
    const n = b.clone().sub(a).cross(d.clone().sub(a)), area = n.length();
    if (area < 1e-12) continue;
    vn.fromBufferAttribute(nAttr, i0).add(new THREE.Vector3().fromBufferAttribute(nAttr, i1)).add(new THREE.Vector3().fromBufferAttribute(nAttr, i2));
    total += area;
    if (n.dot(centre) > 0) wOut += area;
    if (vn.dot(centre) > 0) nOut += area;
  }
  return { winding: wOut / total, normals: nOut / total };
}

/** Extremes without spreading (the arrays exceed the argument limit). */
const maxOf = (a: number[]): number => a.reduce((x, y) => Math.max(x, y), -Infinity);
const minOf = (a: number[]): number => a.reduce((x, y) => Math.min(x, y), Infinity);

const named = (root: THREE.Object3D, name: string): THREE.Object3D => {
  const o = root.getObjectByName(name); if (!o) throw new Error(`no ${name}`); return o;
};

describe('AH-56A exterior', () => {
  it('is a cloneable description carrying the physics rotorcraft and the dimensions.ts geometry, no skids', () => {
    expect(structuredClone(def)).toEqual(def);
    expect(def.rotorcraft).toBe(AH56_ROTORCRAFT);
    expect(def.rotorcraft).toEqual(AH56_DEFINITION.rotorcraft);
    const rv = def.rotorcraftVisual!;
    // Built to dimensions.ts, NOT to the S0 physics stub (the MD 500E rotor with four blades).
    expect(rv.main.hub).toEqual([D.MAIN_HUB.x, D.MAIN_HUB.y, D.MAIN_HUB.z]);
    expect(rv.main.radius).toBe(D.MAIN_ROTOR_RADIUS); expect(2 * rv.main.radius).toBeCloseTo(15.62, 2);
    expect(rv.main.chord).toEqual([D.MAIN_ROTOR_CHORD, D.MAIN_ROTOR_CHORD]);
    expect(rv.tail.hub).toEqual([D.TAIL_HUB.x, D.TAIL_HUB.y, D.TAIL_HUB.z]);
    expect(rv.tail.radius).toBe(D.TAIL_ROTOR_RADIUS);
    // No ground-shadow skid creases; the wheel contacts (tail, left, right) are the gear contract's.
    expect(def.shadow.skids).toBeUndefined();
    expect(def.shadow.restHeight).toBe(D.GROUND_Z);
    expect(def.gear.map(w => w.contact)).toEqual([[D.TAIL_WHEEL.x, 0, D.GROUND_Z], [D.MAIN_GEAR.x, -D.MAIN_GEAR.halfTrack, D.GROUND_Z],
      [D.MAIN_GEAR.x, D.MAIN_GEAR.halfTrack, D.GROUND_Z]]);
    expect(def.gear.every(w => w.retract !== undefined)).toBe(true);
    // The pilot in the REAR seat (seat 0, aft of the gunner's seat 1), eye on dimensions.ts PILOT_EYE.
    expect(def.cockpit.pilotEye).toEqual([D.PILOT_EYE.x, D.PILOT_EYE.y, D.PILOT_EYE.z]);
    expect(def.cockpit.occupants).toEqual([{ seat: 0 }]);
    expect(def.cockpit.seats[0].x).toBeLessThan(def.cockpit.seats[1].x);
    const pilot = def.cockpit.seats[0];
    expect(D.PILOT_EYE.x).toBeLessThan(pilot.x); expect(D.PILOT_EYE.x).toBeGreaterThan(pilot.x - pilot.depth);
    expect(def.livery.registration).toBe('66-8832');
    // The loft runs from the nose (dimensions.ts) to the gearbox face; the spinner closes it 656 in from the nose.
    expect(def.fuselage.frontX).toBe(D.NOSE_X);
    expect(SPINNER.tipFs - D.NOSE_FS).toBe(656);
    expect(LOFT[0][0]).toBe(D.NOSE_FS); expect(LOFT[LOFT.length - 1][0]).toBe(LOFT_END_FS);
    // The registration box of the generic livery is parked aft of the loft (the markings are decals).
    expect(def.livery.lettering.x1).toBeLessThan(def.fuselage.endX);
  });

  it('derives the wing, fin and stabiliser planforms from the published data', () => {
    // Wing: MAC 7.6 ft (P), quarter-MAC FS 308.2 (P) with an unswept trailing edge; tip BL 160.2 (P).
    expect(WING_PLAN.macIn / 12).toBeCloseTo(7.6, 1);
    const yMac = WING_PLAN.tipBl / 3 * (1 + 2 * 0.5) / 1.5;
    expect(WING_PLAN.teFs - (WING_PLAN.rootChordIn + (WING_PLAN.tipChordIn - WING_PLAN.rootChordIn) * yMac / WING_PLAN.tipBl) + WING_PLAN.macIn / 4).toBeCloseTo(308.2, 6);
    const area = (WING_PLAN.rootChordIn + WING_PLAN.tipChordIn) / 2 * WING_PLAN.tipBl * 2 / 144;
    expect(Math.abs(area / 195 - 1)).toBeLessThan(0.01);
    // Incidence: left 11 deg 52 min, right 12 deg 58 min at the reference station (P), LE up; dihedral 5 deg (P).
    for (const [side, inc] of [[-1, 11 + 52 / 60], [1, 12 + 58 / 60]] as const) {
      const c = wingChord(WING_PLAN.refBl, side);
      expect(Math.atan2(c.te[2] - c.le[2], c.le[0] - c.te[0]) / DEG).toBeCloseTo(inc, 6);
      const tip = wingChord(WING_PLAN.tipBl, side), root = wingChord(WING_PLAN.refBl, side);
      const qc = (k: typeof tip) => k.le[2] + (k.te[2] - k.le[2]) * 0.25;
      expect(Math.atan2(qc(root) - qc(tip), Math.abs(tip.le[1] - root.le[1])) / DEG).toBeCloseTo(5, 6);
    }
    // Ventral fin: root WL 114.5, tip WL 37.6, 24.6 ft^2 (P), quarter-MAC FS 620.3 (P).
    const [rl, tl, tt, rt] = VENTRAL_FIN.outline;
    expect(rl[1]).toBe(114.5); expect(tl[1]).toBe(37.6);
    expect(Math.abs(((rt[0] - rl[0]) + (tt[0] - tl[0])) / 2 * (rl[1] - tl[1]) / 144 / 24.6 - 1)).toBeLessThan(0.01);
    const yMacFin = (rl[1] - tl[1]) / 3 * (1 + 2 * 0.587) / 1.587, macFin = finChordAt(rl[1] - yMacFin);
    expect(macFin.le + (macFin.te - macFin.le) / 4).toBeCloseTo(620.3, 1);
    // The fin's trailing edge passes ahead of the prop disc wherever the disc reaches down (WL >= 54.5).
    expect(finChordAt(54.5).te).toBeLessThan(fsOf(D.PUSHER_HUB.x) - 5);
    // The tail wheel sits under the fin tip.
    expect(fsOf(D.TAIL_WHEEL.x)).toBeGreaterThan(tl[0]); expect(fsOf(D.TAIL_WHEEL.x)).toBeLessThan(tt[0]);
    // Stabiliser: span 10.83 ft, quarter-MAC FS 637.18 (P); the LEFT panel bobtailed (its outer trailing edge cut).
    expect((STABILISER.left.tipBl + STABILISER.right.tipBl) / 12).toBeCloseTo(10.83, 2);
    const r0 = stabChord(0), rTip = stabChord(STABILISER.right.tipBl), lTip = stabChord(-STABILISER.left.tipBl);
    expect(r0.le[0] - r0.te[0]).toBeCloseTo(44 * IN * Math.cos(2 * DEG), 6);
    expect(lTip.te[0]).toBeGreaterThan(rTip.te[0] + 8 * IN);
  });

  it('glazes both canopies, keeps the step, the nose and the deck behind them opaque', () => {
    const sdf = makeWindowSdf(def.glazing), skin = new FuselageShape(0, -Infinity, def.fuselage);
    const side = (s: number, w: number, y: number) => sdf(fs(s), y * sectionHalfWidth(skin, fs(s), wl(w)), wl(w));
    for (const y of [-1, 1]) {
      expect(side(100, 110, y)).toBeLessThan(-0.02);   // front canopy side
      expect(side(170, 128, y)).toBeLessThan(-0.02);   // rear canopy side, beside the pilot's eye
      expect(side(100, 80, y)).toBeGreaterThan(0.05);  // below the front sill
      expect(side(175, 100, y)).toBeGreaterThan(0.05); // below the rear sill
      expect(side(230, 130, y)).toBeGreaterThan(0.05); // deck behind the rear canopy
      expect(side(50, 75, y)).toBeGreaterThan(0.05);   // nose
    }
    expect(sdf(fs(110), 0, skin.section(fs(110)).zTop)).toBeLessThan(0);   // front canopy roof
    expect(sdf(fs(175), 0, skin.section(fs(175)).zTop)).toBeLessThan(0);   // rear canopy roof
    expect(sdf(fs(250), 0, skin.section(fs(250)).zTop)).toBeGreaterThan(0);
    // The stepped canopy: the rear top stands at least 15 in above the front (eyes WL 112 / WL 130, dimensions.ts).
    expect(wl(125) - skin.section(fs(175)).zTop).toBeGreaterThan(15 * IN);
    expect(skin.section(fs(168)).zTop).toBeLessThan(D.PILOT_EYE.z - 0.25);
    expect(CANOPY_BOWS.rear[0]).toBeGreaterThan(CANOPY_BOWS.front[CANOPY_BOWS.front.length - 1]);
  });

  it('meets the station table and the published dimensions on the built model (AMCS head)', () => {
    withVisual((visual, ctx) => {
      const r = ctx.state.rotorcraft!, rv = def.rotorcraftVisual!;
      // Main rotor diameter (P): the blade tips about the shaft, over a turn.
      let tipRadius = 0;
      for (let k = 0; k < 8; k++) {
        r.azimuth = k * Math.PI / 4; visual.update(ctx); visual.root.updateMatrixWorld(true);
        for (const p of bladeTips(visual.main, rv.main.radius, visual.root)) tipRadius = Math.max(tipRadius, Math.hypot(p[0] - D.MAIN_HUB.x, p[1]));
      }
      expect(Math.abs(2 * tipRadius - 15.62)).toBeLessThan(0.02);
      // Tail rotor: four blades, 10 ft, on the LEFT at the teeter centre FS 658.5 / WL 114.5 / BL 72 L (P, +/- 1 in).
      const tr = visual.tailRotor.rotor;
      expect(tr.blades.count).toBe(4);
      const trHub = toFrd(tr.group.getWorldPosition(new THREE.Vector3()));
      expect(Math.hypot(trHub[0] - D.TAIL_HUB.x, trHub[1] - D.TAIL_HUB.y, trHub[2] - D.TAIL_HUB.z)).toBeLessThan(IN);
      expect(trHub[1] / IN).toBeCloseTo(-72, 3);
      let trTip = 0, trLowest = Infinity;
      for (let k = 0; k < 8; k++) {
        r.azimuth = k * 0.37; visual.update(ctx); visual.root.updateMatrixWorld(true);
        for (const p of bladeTips(tr, D.TAIL_ROTOR_RADIUS, visual.root)) {
          trTip = Math.max(trTip, Math.hypot(p[0] - trHub[0], p[2] - trHub[2])); trLowest = Math.min(trLowest, D.GROUND_Z - p[2]);
          expect(p[1]).toBeLessThan(-60 * IN);
        }
      }
      expect(Math.abs(2 * trTip / FT - 10)).toBeLessThan(2 * IN / FT);
      // Pusher: three blades, 10 ft, hub FS 675.7 / WL 114.5 on the centreline (P, +/- 1 in).
      const ph = toFrd(visual.pusher.group.getWorldPosition(new THREE.Vector3()));
      expect(Math.hypot(ph[0] - D.PUSHER_HUB.x, ph[1], ph[2] - D.PUSHER_HUB.z)).toBeLessThan(IN);
      expect(visual.pusher.blades).toHaveLength(3);
      const prop = vertices(visual.pusher.group, [], m => m.name.includes('ah56PusherBlade'), visual.root);
      const propR = maxOf(prop.map(p => Math.hypot(p[1] - ph[1], p[2] - ph[2])));
      expect(Math.abs(2 * propR / FT - 10)).toBeLessThan(2 * IN / FT);
      // The prop stands still (no pusher state): its lowest tip over a turn is the hub height less the radius.
      const propLowest = D.GROUND_Z - ph[2] - propR;
      // TR and prop lowest tips about 3 ft above the ground (D: WL 54.5 over the ground line WL 18 is 36.5 in).
      expect(Math.abs(trLowest / IN - 36.5)).toBeLessThan(1.5); expect(Math.abs(propLowest / IN - 36.5)).toBeLessThan(1.5);
      // Fuselage: nose to the spinner tip, 54 ft 8 in (S, +/- 1 %).
      const skin = vertices(named(visual.root, 'fuselageSkin'), [], () => true, visual.root);
      const spinner = vertices(named(visual.pusher.group, 'ah56Spinner'), [], () => true, visual.root);
      const fuselage = maxOf(skin.map(p => p[0])) - minOf(spinner.map(p => p[0]));
      expect(Math.abs(fuselage / (656 * IN) - 1)).toBeLessThan(0.01);
      // Nothing of the airframe, weapons and gear sticks out ahead of the nose except the XM51's barrel.
      const body = vertices(visual.root, [visual.main.group, tr.group, visual.pusher.group, visual.cockpit.group, named(visual.root, 'ah56Weapons')]);
      expect(maxOf(body.map(p => p[0]))).toBeLessThanOrEqual(D.NOSE_X + 0.003);
      // Span: 26.7 ft (P, +/- 1 %), wing tips including their fairings.
      const ys = body.map(p => p[1]);
      const span = maxOf(ys) - minOf(ys);
      expect(Math.abs(span / (26.7 * FT) - 1)).toBeLessThan(0.01);
      // Belly turret: lowest point 21 in above the ground (P, +/- 2 in).
      const turret = vertices(named(visual.root, 'ah56Weapons'), [], () => true, visual.root).filter(p => Math.abs(p[0] - fs(BELLY_TURRET.fs)) < 0.3 && Math.abs(p[1]) < 0.3);
      const clearance = D.GROUND_Z - maxOf(turret.map(p => p[2]));
      expect(Math.abs(clearance / IN - 21)).toBeLessThan(2);
      // Main-gear track, wheel centre to wheel centre: about 62 in (D, +/- 10 %).
      const wheels = visual.gear.legs.slice(1).map(l => toFrd(l.wheel.getWorldPosition(new THREE.Vector3())));
      const track = Math.abs(wheels[1][1] - wheels[0][1]);
      expect(Math.abs(track / (62 * IN) - 1)).toBeLessThan(0.1);
      // AMCS head top (no gyro X).
      const head = vertices(visual.main.group, [], () => true, visual.root).filter(p => Math.hypot(p[0] - D.MAIN_HUB.x, p[1]) < 0.6);
      const amcsHeight = D.GROUND_Z - minOf(head.map(p => p[2]));
      console.log(JSON.stringify({ rotorDiameter: 2 * tipRadius, fuselageFt: fuselage / FT, spanFt: span / FT, trDiameterFt: 2 * trTip / FT,
        propDiameterFt: 2 * propR / FT, trLowestIn: trLowest / IN, propLowestIn: propLowest / IN, bellyTurretIn: clearance / IN,
        trackIn: track / IN, amcsHeadTopIn: amcsHeight / IN }));
    });
  });

  it('stands 13 ft 8.5 in tall to the top of the ICS gyro X (+/- 2 %) and draws the X only in the ICS configuration', () => {
    withVisual((visual, ctx) => {
      const gyro = named(visual.root, 'ah56GyroTilt');
      expect(gyro.visible).toBe(true);
      const all = vertices(visual.root, [visual.tailRotor.rotor.group]);
      const height = D.GROUND_Z - minOf(all.map(p => p[2]));
      expect(Math.abs(height / (164.5 * IN) - 1)).toBeLessThan(0.02);
      // Span over the tip masses 9.7 ft (P), arms 33 deg ahead of the blades (P cant).
      const arms = vertices(named(gyro, 'ah56GyroArms'), [], () => true, visual.root);
      const reach = maxOf(arms.map(p => Math.hypot(p[0] - D.MAIN_HUB.x, p[1])));
      expect(Math.abs(reach * 2 / (9.7 * FT) - 1)).toBeLessThan(0.01);
      expect(GYRO.armLength + GYRO.massRadius).toBeCloseTo(D.ICS_GYRO_SPAN / 2, 12);
      const spin = named(gyro, 'ah56GyroX');
      expect(spin.rotation.y - visual.main.spin.rotation.y).toBeCloseTo(33 * DEG, 9);
      // Tilt: the X's plane normal follows state.controlGyro (pitch + = aft, roll + = right; gyroBladeCyclic).
      Object.assign(ctx.state.rotorcraft!.controlGyro!, { pitch: 5 * DEG, roll: -2 * DEG });
      visual.update(ctx);
      const n = new THREE.Vector3(0, 1, 0).applyQuaternion(gyro.quaternion);
      expect(n.distanceTo(new THREE.Vector3(Math.tan(-2 * DEG), 1, Math.tan(5 * DEG)).normalize())).toBeLessThan(1e-9);
      // Back to AMCS: no X.
      ctx.state.rotorcraft!.controlGyro!.mode = 'amcs'; visual.update(ctx);
      expect(gyro.visible).toBe(false);
      console.log(JSON.stringify({ icsHeightIn: height / IN, gyroSpanFt: 2 * reach / FT }));
    }, s => { s.controlGyro = { mode: 'ics', pitch: 0, roll: 0, pitchRate: 0, rollRate: 0 }; });
  });

  it('puts no mesh below the tyre contact plane except the tyres, gear down and gear up', () => {
    withVisual((visual, ctx) => {
      for (const extension of [1, 0.5, 0]) {
        ctx.state.gear.extension = [extension, extension, extension]; visual.update(ctx); visual.root.updateMatrixWorld(true);
        const notTyres = vertices(visual.root, [], m => m.name !== 'ah56Tyre');
        expect(maxOf(notTyres.map(p => p[2]))).toBeLessThanOrEqual(D.GROUND_Z + 1e-6);
        const tyres = vertices(visual.root, [], m => m.name === 'ah56Tyre');
        expect(tyres.length).toBeGreaterThan(0);
        if (extension === 1) {
          // Down: the three tyres touch the ground plane at their contacts (within 3 mm), nothing below it.
          expect(maxOf(tyres.map(p => p[2]))).toBeLessThanOrEqual(D.GROUND_Z + 0.003);
          for (const [i, c] of def.gear.map(w => w.contact).entries()) {
            const near = tyres.filter(p => Math.hypot(p[0] - c[0], p[1] - c[1]) < 0.35);
            expect(maxOf(near.map(p => p[2])), `wheel ${i}`).toBeCloseTo(D.GROUND_Z, 2);
          }
        } else expect(maxOf(tyres.map(p => p[2]))).toBeLessThan(D.GROUND_Z - 0.02);
      }
    });
  });

  it('retracts the mains into the sponsons and the tail wheel into the ventral fin, compresses and casters', () => {
    const m = ah56Materials(), gear = new AH56Gear(m), root = new THREE.Group(); root.add(gear.group);
    const state = { gear: { extension: [0, 0, 0] as [number, number, number] },
      wheels: [0, 1, 2].map(() => ({ compression: 0, rotation: 0, steerAngle: 0 })) } as never as Parameters<AH56Gear['update']>[0];
    gear.update(state); root.updateMatrixWorld(true);
    // Mains: every tyre vertex inside the sponson envelope (its axis BL 35, WL 70, radius 12.5 in) within 1.5 in.
    for (const leg of gear.legs.slice(1)) {
      for (const p of vertices(leg.wheel, [], x => x.name === 'ah56Tyre', root)) {
        const out = Math.hypot(Math.abs(p[1]) - SPONSON.bl * IN, p[2] - wl(SPONSON.wl)) - 12.5 * IN;
        expect(out).toBeLessThan(1.5 * IN);
        expect(fsOf(p[0])).toBeGreaterThan(195); expect(fsOf(p[0])).toBeLessThan(330);
      }
      expect(leg.pivot.rotation.x).toBeCloseTo(MAIN_RETRACT, 12);
    }
    // Tail wheel: inside the fin's lower-end housing (|y| within its half width, above WL 33, below the tail cone).
    const tail = vertices(gear.legs[0].wheel, [], x => x.name === 'ah56Tyre', root);
    for (const p of tail) { expect(Math.abs(p[1])).toBeLessThan(4.2 * IN); expect(p[2]).toBeLessThan(wl(33)); expect(p[2]).toBeGreaterThan(wl(105)); }
    // Down, compressed by 5 cm: the wheel rides up its leg; the tail yoke casters with the steer angle.
    state!.gear.extension = [1, 1, 1];
    gear.update(state); root.updateMatrixWorld(true);
    const free = toFrd(gear.legs[1].wheel.getWorldPosition(new THREE.Vector3()));
    state!.wheels[1].compression = 0.05; state!.wheels[0].steerAngle = 0.4;
    gear.update(state); root.updateMatrixWorld(true);
    const compressed = toFrd(gear.legs[1].wheel.getWorldPosition(new THREE.Vector3()));
    expect(free[2] - compressed[2]).toBeGreaterThan(0.045);
    expect(gear.legs[0].caster!.rotation.y).toBeCloseTo(-0.4, 12);
    expect(nonFinite(root)).toBe(0);
    root.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); }); Object.values(m).forEach(x => x.dispose());
  });

  it('poses the four hingeless blades about the equivalent hinge from the published pose, swashplate from swashplateCyclic', () => {
    const rv = def.rotorcraftVisual!, m = ah56Materials();
    const rotor = new TeeteringRotor({ ...rv.main, blades: 4, hubType: 'hingeless' }, fakeMaterials());
    const head = new AH56MainRotor(rotor, rv.main, def.rotorcraft!, m), ctx = fakeContext();
    const s = emptyRotorcraftState(); ctx.state.rotorcraft = s;
    const e = hingeOffset(def.rotorcraft!);
    expect(e).toBeCloseTo(def.rotorcraft!.hubModel?.kind === 'hingeless' ? def.rotorcraft!.hubModel.equivalentHingeOffset : 0.1 * D.MAIN_ROTOR_RADIUS, 12);
    s.articulated = { blades: [{ flap: 0.05, lag: 0, pitch: 0.12 }, { flap: 0.02, lag: 0, pitch: 0.08 }, { flap: 0.06, lag: 0, pitch: 0.15 },
      { flap: 0.03, lag: 0, pitch: 0.1 }] };
    ctx.controls.elevator = 0.4; ctx.controls.aileron = -0.3; ctx.controls.collective = 0.5;
    const matrix = new THREE.Matrix4();
    for (const azimuth of [0, 1.1, 4.0]) {
      Object.assign(s, { rotorRpm: 240, azimuth, thrust: 80000 });
      rotor.update(azimuth, 240, 0, 0); head.update(ctx, s);
      s.articulated.blades.forEach((b, i) => {
        rotor.blades.getMatrixAt(i, matrix);
        // A point on the blade axis at radius r rises by (r - e) sin(flap) above the hub plane.
        const p = new THREE.Vector3(rv.main.radius, 0, 0).applyMatrix4(matrix);
        expect(p.y).toBeCloseTo((rv.main.radius - e) * Math.sin(b.flap), 6);
        expect(head.pose[i].pitch).toBe(b.pitch);
      });
      const c = swashplateCyclic(def.rotorcraft!, ctx.controls, s);
      expect(new THREE.Vector3(0, 1, 0).applyQuaternion(head.swashplate.quaternion).distanceTo(new THREE.Vector3(c.right, 1, c.aft).normalize())).toBeLessThan(1e-9);
      expect(nonFinite(rotor.group)).toBe(0);
    }
    // Without a published pose: the rest droop, then coning with thrust, and the first harmonic from the state.
    delete s.articulated; Object.assign(s, { rotorRpm: 0, thrust: 0, flapForward: 0, flapRight: 0 }); head.update(ctx, s);
    head.pose.forEach(p => expect(p.flap).toBeLessThan(0));
    Object.assign(s, { rotorRpm: 240, thrust: 81400, flapForward: 0.02, flapRight: 0, azimuth: Math.PI / 2 }); head.update(ctx, s);
    expect(head.pose[0].flap).toBeLessThan(head.pose[2].flap); // the forward blade (azimuth 90 deg) lower with the disc forward
    rotor.group.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
    rotor.dispose(); Object.values(m).forEach(x => x.dispose());
  });

  it('draws the pusher at state.pusher.beta turning at rotor rpm x 6.98, else stopped and feathered', () => {
    const m = ah56Materials(), pusher = new AH56Pusher(m);
    pusher.update();
    expect(pusher.beta).toBe(PUSHER_FEATHER); expect(pusher.rpm).toBe(0); expect(pusher.spin.rotation.z).toBe(0);
    pusher.blades.forEach(b => expect(b.rotation.y).toBeCloseTo(-PUSHER_FEATHER, 12));
    pusher.update(-12 * DEG, 1.3, 246);
    expect(pusher.rpm).toBeCloseTo(246 * AH56_PROP_RATIO, 9); expect(AH56_PROP_RATIO).toBeCloseTo(6.98, 2);
    expect(pusher.spin.rotation.z).toBeCloseTo(1.3 * AH56_PROP_RATIO, 9);
    pusher.blades.forEach(b => expect(b.rotation.y).toBeCloseTo(12 * DEG, 12));
    // Leading edge forward (-z three.js) for a positive blade angle at 0.7 R.
    pusher.update(25 * DEG, 0, 0); pusher.group.updateMatrixWorld(true);
    const le = new THREE.Vector3(-0.08, 0.7 * D.PUSHER_RADIUS, 0).applyMatrix4(pusher.blades[0].matrixWorld).sub(pusher.group.getWorldPosition(new THREE.Vector3()));
    expect(le.z).toBeLessThan(0);
    pusher.dispose(); Object.values(m).forEach(x => x.dispose());
  });

  it('seats the pilot in the REAR cockpit under the canopy, with the frozen panel face, the stick between the knees and the collective left', () => {
    withVisual((visual, ctx) => {
      const lining = new FuselageShape(0.03, -Infinity, def.fuselage), eye = D.PILOT_EYE, gunner = D.GUNNER_EYE;
      expect(eye.x).toBeLessThan(gunner.x);
      for (const p of [eye, gunner]) {
        expect(p.z - lining.section(p.x).zTop).toBeGreaterThan(0.12);
        expect(sectionHalfWidth(lining, p.x, p.z)).toBeGreaterThan(0.2);
      }
      // The frozen panel face (panelLayout.ts) stands inside the cabin lining at all four corners, under the rear windshield.
      const f = AH56_PANEL_FACE, tilt = f.tiltBackDeg * DEG;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const x = f.centre.x + sz * f.height / 2 * Math.sin(tilt), z = f.centre.z + sz * f.height / 2 * Math.cos(tilt);
        expect(sectionHalfWidth(lining, x, z), `panel corner ${sx} ${sz}`).toBeGreaterThan(f.width / 2 + 0.01);
      }
      const [origin, du, dv] = panelUvBasis(visual.panel.geometry)!;
      const centre = origin.clone().addScaledVector(du, 0.5).addScaledVector(dv, 0.5);
      expect(visual.panel.localToWorld(centre).distanceTo(frd(AH56_PANEL_FACE.centre.x, AH56_PANEL_FACE.centre.y, AH56_PANEL_FACE.centre.z))).toBeLessThan(1e-6);
      expect(du.length() / AH56_PANEL_CANVAS.w).toBeCloseTo(dv.length() / AH56_PANEL_CANVAS.h, 9);
      expect(visual.cockpit.collectives).toHaveLength(1);
      expect(toFrd(visual.cockpit.collectives[0].getWorldPosition(new THREE.Vector3()))[1]).toBeLessThan(-0.2);
      const stick = named(visual.root, 'ah56Cyclic');
      const pivot = toFrd(stick.getWorldPosition(new THREE.Vector3()));
      expect(Math.abs(pivot[1])).toBeLessThan(1e-9);
      expect(pivot[0]).toBeLessThan(AH56_PANEL_FACE.centre.x); expect(pivot[0]).toBeGreaterThan(def.cockpit.seats[0].x);
      ctx.controls.elevator = 0.6; ctx.controls.aileron = -0.4; ctx.controls.propLever = 0.7; ctx.controls.collective = 0.6;
      visual.update(ctx);
      expect(stick.rotation.x).toBeGreaterThan(0);
      expect(named(visual.root, 'ah56PropGrip').rotation.z).toBeCloseTo(-0.7 * 130 * DEG, 9);
      expect(named(visual.root, 'ah56GunnerFigure').visible).toBe(true);
      ctx.cameraMode = 'cockpit'; visual.update(ctx);
      expect(named(visual.root, 'ah56GunnerFigure').visible).toBe(false);
      expect(nonFinite(visual.root)).toBe(0);
    });
  });

  it('hides the generic skids, boom and two-blade tail rotor; the AH-56A parts replace them', () => {
    withVisual(visual => {
      expect(named(visual.root, 'rotorcraftAirframe').visible).toBe(false);
      expect(visual.tail.group.visible).toBe(false);
      for (const name of ['ah56Exterior', 'ah56Weapons', 'ah56Gear', 'ah56TailRotor', 'ah56Pusher', 'ah56MainHead', 'ah56Markings'])
        expect(named(visual.root, name).visible, name).toBe(true);
    });
  });

  it('faces the wing, fin, stabiliser and the bodies of revolution outward (FrontSide)', () => {
    const shells: [string, THREE.BufferGeometry][] = [];
    for (const side of [-1, 1]) {
      const r = wingChord(WING_PLAN.rootBl, side), t = wingChord(WING_PLAN.tipBl, side);
      shells.push([`wing ${side}`, aerofoilPanel(r.le, r.te, t.le, t.te, [Math.sin(r.incidence), -side * 0.087, -Math.cos(r.incidence)], 0.12, 0.08, 10, 41, { m: 0.02, p: 0.4 })]);
    }
    const [rl, tl, tt, rt] = VENTRAL_FIN.outline;
    shells.push(['fin', aerofoilPanel([fs(rl[0]), 0, wl(rl[1])], [fs(rt[0]), 0, wl(rt[1])], [fs(tl[0]), 0, wl(tl[1])], [fs(tt[0]), 0, wl(tt[1])], [0, 1, 0], 0.18, 0.15)]);
    const s0 = stabChord(0), s1 = stabChord(STABILISER.right.tipBl);
    shells.push(['stabiliser', aerofoilPanel(s0.le, s0.te, s1.le, s1.te, [0.035, 0, -1], 0.18, 0.12)]);
    shells.push(['sponson', revolve(SPONSON.profile.map(([s, r]) => [fs(s), r * IN] as const), 0.9, wl(70), 40)]);
    for (const [name, g] of shells) {
      const f = outwardFraction(g);
      expect(f.winding, `${name} winding`).toBeGreaterThan(0.95);
      expect(f.normals, `${name} normals`).toBeGreaterThan(0.95);
      g.dispose();
    }
  });

  it('disposes every geometry, material and texture of the assembly', () => {
    vi.stubGlobal('document', blankDocument());
    const ctx = fakeContext(); ctx.state.rotorcraft = emptyRotorcraftState();
    const visual = new Visual(def, ctx, { lightScale: 1, panelEmissiveScale: 1, interiorLodDistance: 50, panelDef: AH56_PANEL });
    try {
      visual.update(ctx);
      const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>();
      visual.root.traverse(o => {
        if (!(o instanceof THREE.Mesh)) return;
        geometries.add(o.geometry);
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          if (m.name !== 'shadowProxy') materials.add(m);
          for (const t of Object.values(m)) if (t instanceof THREE.Texture) textures.add(t);
        }
      });
      const spies = [...geometries, ...materials, ...textures].map(v => vi.spyOn(v, 'dispose'));
      visual.dispose(); spies.forEach(spy => expect(spy).toHaveBeenCalled());
    } finally { vi.unstubAllGlobals(); }
  });
});
