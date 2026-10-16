// MD 500E exterior, five-blade articulated head and LH-command cockpit (package M2). Accuracy targets (plan 6.3):
// overall length 9.391 m +/- 1 % and fuselage 7.279 m +/- 1 % (RFM Fig 1-1), hub-fairing top 2.658 m +/- 2 %,
// skid track 6.45 ft outside +/- 2 %, tail-rotor lowest tip 0.61 m +/- 0.05 (Fig 1-1: a GROUND-ATTITUDE height,
// 4.7 deg nose up), nothing below the skid sole, pilot's eye on dimensions.ts PILOT_EYE (within 3 cm).
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { MD500_VISUAL as def, ENDPLATE, LOWER_FIN, GROUND_ATTITUDE_DEG, TAIL_HUB_LEVEL, TAIL_HUB_WL, BOOM, boomWl, sta, wl, SEAT, UPPER_FIN } from '../../src/aircraft/md500/visual';
import { MD500_PANEL } from '../../src/aircraft/md500/panel';
import { MD500_ROTORCRAFT, STAB_ZERO_LIFT_DEG } from '../../src/aircraft/md500/rotorcraft';
import { md500ExteriorVisualClass } from '../../src/aircraft/md500/exterior';
import { MD500MainRotor, buildMD500TailHead, DOME_RISE, MD500_MAIN_SECTION, type MD500RotorPose } from '../../src/aircraft/md500/exteriorRotor';
import { BOOM_ROOT_FAIRING, INLET_FAIRING, STAB_INCIDENCE_DEG } from '../../src/aircraft/md500/exteriorDetails';
import { aerofoilPanel, fairingLoft, md500Materials } from '../../src/aircraft/md500/exteriorGeometry';
import * as D from '../../src/aircraft/md500/dimensions';
import { MD500_PANEL_CANVAS, MD500_PANEL_FACE, MD500_PANEL_OUTLINE } from '../../src/aircraft/md500/panelLayout';
import { FuselageShape } from '../../src/render/aircraft/fuselageShape';
import { RotorcraftVisual } from '../../src/render/aircraft/RotorcraftVisual';
import { sectionHalfWidth } from '../../src/render/aircraft/fuselage';
import { makeWindowSdf } from '../../src/render/aircraft/livery';
import { frd } from '../../src/render/aircraft/geometry';
import { rotorBladeGeometry, setRotorBladeThickness, TeeteringRotor } from '../../src/render/aircraft/rotorcraft/rotor';
import { bladeBlur } from '../../src/render/aircraft/bladeBlur';
import { emptyRotorcraftState } from '../../src/physics/rotorcraft/definition';
import { Rotorcraft } from '../../src/physics/rotorcraft/rotorcraft';
import { panelUvBasis } from '../../src/instruments/panelProjection';
import { blankDocument, fakeContext, fakeMaterials, nonFinite } from './meshChecks';

const FT = 0.3048;
const Visual = md500ExteriorVisualClass(RotorcraftVisual, FuselageShape, sectionHalfWidth, ctx => ctx.state.rotorcraft?.articulated);
/** FRD point of a three.js model-space vector. */
const toFrd = (v: THREE.Vector3): [number, number, number] => [-v.z, v.x, -v.y];

/** Build the complete visual parked with the rotors stopped, run `fn`, dispose. */
function withVisual(fn: (visual: InstanceType<typeof Visual>, ctx: ReturnType<typeof fakeContext>) => void): void {
  vi.stubGlobal('document', blankDocument());
  const ctx = fakeContext(); ctx.state.rotorcraft = emptyRotorcraftState(); ctx.state.electrical.busVoltage = 28;
  const visual = new Visual(def, ctx, { lightScale: 1, panelEmissiveScale: 1, interiorLodDistance: 50, panelDef: MD500_PANEL });
  try { visual.update(ctx); visual.root.updateMatrixWorld(true); fn(visual, ctx); }
  finally { visual.dispose(); vi.unstubAllGlobals(); }
}

/** Visible-mesh vertices in model space (FRD), skipping the given subtrees. */
function visibleVertices(root: THREE.Object3D, skip: THREE.Object3D[] = []): [number, number, number][] {
  const out: [number, number, number][] = [], v = new THREE.Vector3(), m = new THREE.Matrix4(), inv = root.matrixWorld.clone().invert();
  const walk = (o: THREE.Object3D): void => {
    if (!o.visible || skip.includes(o)) return;
    if (o instanceof THREE.Mesh && !(o instanceof THREE.InstancedMesh) && !o.name.startsWith('shadowProxy')) {
      const p = o.geometry.getAttribute('position');
      m.multiplyMatrices(inv, o.matrixWorld);
      for (let i = 0; i < p.count; i += 3) out.push(toFrd(v.fromBufferAttribute(p, i).applyMatrix4(m)));
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
    for (const z of [-0.08, 0, 0.08]) out.push(toFrd(new THREE.Vector3(radius, 0, z).applyMatrix4(m).applyMatrix4(rotor.blades.matrixWorld).applyMatrix4(inv)));
  }
  return out;
}

/** Area fractions of a closed (or skin-sitting) shell whose triangle winding and vertex normals face away from its centroid. */
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

describe('MD 500E exterior', () => {
  it('is a cloneable description carrying the physics rotor and the shared reference geometry', () => {
    expect(structuredClone(def)).toEqual(def);
    expect(def.rotorcraft).toBe(MD500_ROTORCRAFT);
    const rv = def.rotorcraftVisual!;
    expect(rv.main.hub).toEqual([D.MAIN_HUB.x, D.MAIN_HUB.y, D.MAIN_HUB.z]);
    expect(rv.main.radius).toBe(D.MAIN_ROTOR_RADIUS); expect(rv.main.root).toBe(D.MAIN_BLADE_ROOT);
    expect(rv.main.chord).toEqual([D.MAIN_ROTOR_CHORD, D.MAIN_ROTOR_CHORD]);
    expect(rv.tail.radius).toBe(D.TAIL_ROTOR_RADIUS); expect(rv.tail.chord).toBe(D.TAIL_ROTOR_CHORD);
    // Tail-rotor hub: station and side from dimensions.ts; the level-axis height derived from the same RFM inputs.
    expect(rv.tail.hub[0]).toBe(D.TAIL_HUB.x); expect(rv.tail.hub[1]).toBe(D.TAIL_HUB.y); expect(rv.tail.hub[1]).toBeLessThan(0);
    expect(TAIL_HUB_WL).toBeCloseTo(51.4, 1);
    // Cross-check of the ground-attitude rule: the fin top 8.4 ft at STA ~293 lands on the stabiliser top WL 102.17.
    const finTopWl = 8.4 * 12 - D.GROUND_WL_BELOW + (293 - 100) * Math.sin(GROUND_ATTITUDE_DEG * Math.PI / 180);
    expect(Math.abs(finTopWl - 102.17)).toBeLessThan(1.5);
    // The boom passes the tailboom-root cant (STA 197.78, WL 55.34) and ends at the hub height.
    expect(boomWl(197.78)).toBeCloseTo(55.34, 9); expect(boomWl(284)).toBeCloseTo(TAIL_HUB_WL, 9);
    expect(BOOM.rear[2]).toBeCloseTo(wl(boomWl(281.12)), 12);
    // The upper fin reaches down to the boom (the shared outline's root stops 5 in above it).
    expect(UPPER_FIN[0][2]).toBeCloseTo(wl(boomWl(276)), 9);
    expect(def.cockpit.pilotEye).toEqual([D.PILOT_EYE.x, D.PILOT_EYE.y, D.PILOT_EYE.z]);
    expect(def.cockpit.occupants).toEqual([{ seat: D.PILOT_SEAT }]); expect(D.SEAT_CENTRES[D.PILOT_SEAT].y).toBeLessThan(0);
    expect(def.rotorcraftVisual!.panel.outline).toBe(MD500_PANEL_OUTLINE);
    expect(def.livery.registration).toBe('N500EA');
  });

  it('glazes the windshields and chin windows, keeps the nose bow, door posts and roof opaque', () => {
    const sdf = makeWindowSdf(def.glazing), skin = new FuselageShape(0, -Infinity, def.fuselage);
    const side = (s: number, w: number, y: number) => sdf(sta(s), y * sectionHalfWidth(skin, sta(s), wl(w)), wl(w));
    for (const y of [-1, 1]) {
      expect(side(30, 45, y)).toBeLessThan(-0.02);   // windshield
      expect(side(32, 18, y)).toBeLessThan(-0.02);   // chin window
      expect(side(30, 26.8, y)).toBeGreaterThan(0);   // horizontal bow between them
      expect(side(65, 45, y)).toBeLessThan(-0.02);   // front-door window
      expect(side(100, 45, y)).toBeLessThan(-0.02);  // rear-door window
      expect(side(84, 45, y)).toBeGreaterThan(0.015); // door post between the doors
      expect(side(140, 40, y)).toBeGreaterThan(0.05); // engine bay
    }
    expect(sdf(sta(30), 0, skin.section(sta(30)).zTop)).toBeLessThan(0);   // over the nose (centre post is geometry)
    expect(sdf(sta(65), 0, skin.section(sta(65)).zTop)).toBeLessThan(0);   // eyebrow roof glass
    expect(sdf(sta(95), 0, skin.section(sta(95)).zTop)).toBeGreaterThan(0); // roof under the engine fairing
  });

  it('thickens the main blades to NACA 0015 without changing chord, twist or span', () => {
    const spec = def.rotorcraftVisual!.main, g = rotorBladeGeometry(spec), p = g.getAttribute('position');
    const before = Array.from({ length: p.count }, (_, i) => new THREE.Vector3().fromBufferAttribute(p, i));
    setRotorBladeThickness(g, spec, MD500_MAIN_SECTION, 1);
    let maxError = 0;
    for (let i = 0; i < p.count; i++) {
      const b = before[i], beta = spec.twist * ((b.x - spec.root) / (spec.radius - spec.root) - 0.75);
      const c = Math.cos(beta), s = Math.sin(beta);
      expect(p.getX(i)).toBe(b.x);
      maxError = Math.max(maxError, Math.abs((p.getY(i) * s - p.getZ(i) * c) - (b.y * s - b.z * c)),
        Math.abs((p.getY(i) * c + p.getZ(i) * s) - (b.y * c + b.z * s) * MD500_MAIN_SECTION / 0.12));
    }
    expect(maxError).toBeLessThan(1e-7); g.dispose();
  });

  it('poses five blades at their own hinges from the published state, links and dampers attached', () => {
    const d = def.rotorcraftVisual!, mat = md500Materials();
    const rotor = new TeeteringRotor({ ...d.main, blades: 5, hubType: 'articulated' }, fakeMaterials());
    const head = new MD500MainRotor(rotor, d.main, def.rotorcraft!, mat), ctx = fakeContext();
    const trailUpdate = vi.spyOn(rotor.trail, 'update');
    ctx.state.rotorcraft = emptyRotorcraftState();
    const pose: MD500RotorPose = { blades: [{ flap: 0.07, lag: 0.04, pitch: 0.15 }, { flap: -0.03, lag: -0.06, pitch: 0.08 },
      { flap: 0.09, lag: 0.01, pitch: 0.20 }, { flap: 0.02, lag: 0.0, pitch: 0.11 }, { flap: 0.05, lag: -0.02, pitch: 0.13 }] };
    const matrix = new THREE.Matrix4(), expected = new THREE.Vector3(), actual = new THREE.Vector3();
    expect(head.arms).toHaveLength(5);
    for (const rpm of [0, 120, 492, 0]) for (const azimuth of [0, 1.7, 5.1]) {
      Object.assign(ctx.state.rotorcraft, { rotorRpm: rpm, azimuth, thrust: 13000, flapForward: 0.04, flapRight: -0.02 });
      const snapshot = structuredClone(ctx.state.rotorcraft);
      rotor.update(azimuth, rpm, 0.13, 0.03); head.update(ctx, pose); rotor.group.updateMatrixWorld(true);
      expect(ctx.state.rotorcraft).toEqual(snapshot); expect(nonFinite(rotor.group)).toBe(0);
      expect(rotor.blades.count).toBe(5);
      const meanFlap = pose.blades.reduce((sum, b) => sum + b.flap / 5, 0), meanPitch = pose.blades.reduce((sum, b) => sum + b.pitch! / 5, 0);
      expect(trailUpdate).toHaveBeenLastCalledWith(bladeBlur(rpm, 5), meanPitch, meanFlap, D.FLAP_HINGE_OFFSET);
      const inverse = rotor.spin.matrixWorld.clone().invert();
      head.arms.forEach((arm, i) => {
        expect(arm.flap.position.x).toBe(D.FLAP_HINGE_OFFSET);
        expect(arm.lag.position.x + arm.flap.position.x).toBeCloseTo(D.LAG_HINGE_OFFSET, 12);
        expect(arm.flap.rotation.z).toBe(pose.blades[i].flap); expect(arm.lag.rotation.y).toBe(pose.blades[i].lag);
        expect(arm.pitch.rotation.x).toBe(pose.blades[i].pitch);
        rotor.blades.getMatrixAt(i, matrix);
        for (const [r, y, z] of [[d.main.root, 0, 0], [d.main.radius, 0.03, 0.08]]) {
          expected.set(r - D.LAG_HINGE_OFFSET, y, z).applyMatrix4(arm.pitch.matrixWorld).applyMatrix4(inverse);
          actual.set(r, y, z).applyMatrix4(matrix);
          expect(actual.distanceTo(expected)).toBeLessThan(3e-7);
        }
      });
      const bodies: THREE.Mesh[] = [], rods: THREE.Mesh[] = [];
      head.group.traverse(o => { if (o.name === 'md500ElastomericLagDamper') bodies.push(o as THREE.Mesh);
        if (o.name === 'md500LagDamperEnd') rods.push(o as THREE.Mesh); });
      expect(bodies).toHaveLength(5);
      bodies.forEach((body, i) => {
        expected.set(0, 0.5, 0).applyMatrix4(body.matrixWorld); actual.set(0, -0.5, 0).applyMatrix4(rods[i].matrixWorld);
        expect(actual.distanceTo(expected)).toBeLessThan(1e-8);
      });
    }
    head.update(ctx); head.arms.forEach(a => expect(a.lag.rotation.y).toBe(0));
    rotor.group.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
    rotor.dispose(); Object.values(mat).forEach(m => m.dispose());
  });

  it('follows the physics blade pose (five blades) and tilts the exposure disc with the published flapping', () => {
    const d = def.rotorcraftVisual!, mat = md500Materials(), physics = new Rotorcraft(def.rotorcraft!);
    const rotor = new TeeteringRotor({ ...d.main, blades: 5, hubType: 'articulated' }, fakeMaterials());
    const head = new MD500MainRotor(rotor, d.main, def.rotorcraft!, mat), ctx = fakeContext();
    physics.reset(true); ctx.state.rotorcraft = physics.state;
    expect(physics.state.articulated!.blades).toHaveLength(5);
    Object.assign(physics.state, { thrust: 13000, flapForward: 0.03, flapRight: -0.02 });
    ctx.controls.collective = 0.5; ctx.controls.elevator = 0.2; ctx.controls.aileron = -0.1;
    const expected = new THREE.Vector3(-0.02, 1, -0.03).normalize();
    for (const azimuth of [0, 0.7, 2.5, 5.8]) {
      physics.state.azimuth = azimuth; physics.publishBlades(ctx.controls);
      rotor.update(azimuth, physics.state.rotorRpm, 0, 0); head.update(ctx, physics.state.articulated);
      head.arms.forEach((a, i) => expect(a.flap.rotation.z).toBe(physics.state.articulated!.blades[i].flap));
      expect(new THREE.Vector3(0, 1, 0).applyQuaternion(rotor.blur.quaternion).distanceTo(expected)).toBeLessThan(1e-5);
    }
    rotor.group.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
    rotor.dispose(); Object.values(mat).forEach(m => m.dispose());
  });

  it('turns a two-blade tail rotor on the LEFT with its grips following the blades', () => {
    const d = def.rotorcraftVisual!, mat = md500Materials();
    const rotor = new TeeteringRotor({ ...d.tail, chord: [d.tail.chord, d.tail.chord], twist: d.tail.twist ?? 0, tail: true, blades: 2 }, fakeMaterials());
    const update = buildMD500TailHead(rotor, mat);
    rotor.update(1.1, 2900, 0.1, 0); rotor.group.updateMatrixWorld(true); update();
    const grips: THREE.Object3D[] = []; rotor.spin.traverse(o => { if (o.name === 'md500TailGrip') grips.push(o); });
    const m = new THREE.Matrix4();
    grips.forEach((g, i) => { rotor.blades.getMatrixAt(i, m); expect(g.matrix.equals(m)).toBe(true); });
    rotor.group.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
    rotor.dispose(); Object.values(mat).forEach(x => x.dispose());
  });

  it('meets the RFM Fig 1-1 dimensions on the built model', () => {
    withVisual((visual, ctx) => {
      const r = ctx.state.rotorcraft!;
      // Overall length, rotors turning: the forward main-rotor tip (a blade pointing ahead) to the aft TR tip.
      let front = -Infinity, aft = Infinity, lowestTip = Infinity, tailY = -Infinity;
      for (let k = 0; k < 72; k++) {
        r.azimuth = k * Math.PI / 36; visual.update(ctx); visual.root.updateMatrixWorld(true);
        for (const p of bladeTips(visual.main, def.rotorcraftVisual!.main.radius, visual.root)) front = Math.max(front, p[0]);
        for (const p of bladeTips(visual.tail, def.rotorcraftVisual!.tail.radius, visual.root)) {
          aft = Math.min(aft, p[0]); lowestTip = Math.min(lowestTip, D.SKID_Z - p[2]); tailY = Math.max(tailY, p[1]);
        }
      }
      const overall = front - aft;
      expect(Math.abs(overall / (30.81 * FT) - 1)).toBeLessThan(0.01);
      // The tail rotor turns entirely left of the centreline.
      expect(tailY).toBeLessThan(-0.15);
      // Lowest TR tip: 0.99 m above the sole in level axes (regression); 0.61 +/- 0.05 m in the 4.7 deg ground attitude.
      expect(lowestTip).toBeCloseTo(0.99, 1);
      const groundAttitude = lowestTip - (0 - TAIL_HUB_LEVEL.x) * Math.sin(GROUND_ATTITUDE_DEG * Math.PI / 180);
      expect(Math.abs(groundAttitude - 2.0 * FT)).toBeLessThan(0.05);
      // Fuselage (nose to the aft-most fin/endplate) and everything else that is not a rotor.
      const airframe = visibleVertices(visual.root, [visual.main.group, visual.tail.group, visual.cockpit.group]);
      const xs = airframe.map(p => p[0]), zs = airframe.map(p => p[2]);
      const fuselage = Math.max(...xs) - Math.min(...xs);
      expect(Math.abs(fuselage / (23.88 * FT) - 1)).toBeLessThan(0.01);
      expect(Math.max(...xs)).toBeCloseTo(D.NOSE_X, 2);
      // Nothing below the skid sole (spline tessellation tolerance 2 mm).
      expect(Math.max(...zs)).toBeLessThanOrEqual(D.SKID_Z + 0.002);
      // Hub-fairing (dome) top: 8.72 ft above the ground (RFM Fig 1-1).
      const domeTop = Math.min(...visibleVertices(visual.root, [visual.tail.group, visual.cockpit.group])
        .filter(p => Math.hypot(p[0], p[1]) < 0.25).map(p => p[2]));
      expect(Math.abs((D.SKID_Z - domeTop) / (8.72 * FT) - 1)).toBeLessThan(0.02);
      expect(D.MAIN_HUB.z - DOME_RISE).toBeCloseTo(D.HUB_FAIRING_TOP_Z, 12);
      // Skid track, outside of the tubes, near the ground.
      const low = airframe.filter(p => p[2] > D.SKID_Z - 0.09 && p[0] < D.SKID_FRONT_X - 0.4 && p[0] > D.SKID_REAR_X + 0.2);
      const track = Math.max(...low.map(p => p[1])) - Math.min(...low.map(p => p[1]));
      expect(Math.abs(track / (6.45 * FT) - 1)).toBeLessThan(0.02);
      console.log(JSON.stringify({ overall, fuselage, domeTop: D.SKID_Z - domeTop, track, lowestTipLevel: lowestTip, lowestTipGround: groundAttitude }));
    });
  });

  it('seats the pilot LEFT under the roof, with one cyclic, one collective, four pedals and a correctly scaled panel', () => {
    withVisual((visual, ctx) => {
      const lining = new FuselageShape(0.026, -Infinity, def.fuselage), eye = D.PILOT_EYE;
      // Headroom: the eye sits at least 15 cm under the cabin lining at its station; and inside the side walls.
      expect(eye.z - lining.section(eye.x).zTop).toBeGreaterThan(0.15);
      expect(sectionHalfWidth(lining, eye.x, eye.z)).toBeGreaterThan(Math.abs(eye.y) + 0.2);
      // Seat back on the STA 78.5 bulkhead; cushion fits inside the lining.
      const seat = def.cockpit.seats[D.PILOT_SEAT];
      expect(seat.x - seat.depth).toBeCloseTo(sta(78.5) + 0.005, 6);
      for (const x of [seat.x - 0.05, seat.x - seat.depth + 0.05])
        expect(sectionHalfWidth(lining, x, SEAT.z + 0.1)).toBeGreaterThan(Math.abs(seat.y) + seat.width / 2 - 0.04);
      const [origin, du, dv] = panelUvBasis(visual.panel.geometry)!;
      const centre = origin.clone().addScaledVector(du, 0.5).addScaledVector(dv, 0.5);
      expect(visual.panel.localToWorld(centre).distanceTo(frd(MD500_PANEL_FACE.centre.x, MD500_PANEL_FACE.centre.y, MD500_PANEL_FACE.centre.z))).toBeLessThan(1e-6);
      expect(du.length() / MD500_PANEL_CANVAS.w).toBeCloseTo(dv.length() / MD500_PANEL_CANVAS.h, 9);
      expect(visual.cockpit.collectives).toHaveLength(1); expect(visual.cockpit.pedals).toHaveLength(4);
      const collective = visual.cockpit.collectives[0].getWorldPosition(new THREE.Vector3());
      expect(toFrd(collective)[1]).toBeLessThan(D.SEAT_CENTRES[D.PILOT_SEAT].y); // on the pilot's left
      const stick = visual.root.getObjectByName('md500Cyclic')!;
      const pivot = def.cockpit.column as { pivot: readonly [number, number, number] };
      expect(stick.getWorldPosition(new THREE.Vector3()).distanceTo(frd(pivot.pivot[0], D.SEAT_CENTRES[D.PILOT_SEAT].y, pivot.pivot[2]))).toBeLessThan(1e-8);
      ctx.controls.elevator = 0.6; ctx.controls.aileron = -0.4; ctx.controls.collective = 0.7; ctx.controls.throttle = 1;
      visual.update(ctx); expect(stick.rotation.x).toBeGreaterThan(0); expect(nonFinite(visual.root)).toBe(0);
      ctx.cameraMode = 'cockpit'; visual.update(ctx);
      expect(visual.cockpit.group.getObjectByName('occupants')!.visible).toBe(false);
    });
  });

  it('faces every aerofoil panel and fairing loft outward (FrontSide), whichever way the caller orders it', () => {
    const shells: [string, THREE.BufferGeometry][] = [];
    shells.push(['upper fin', aerofoilPanel(UPPER_FIN[0], UPPER_FIN[3], UPPER_FIN[1], UPPER_FIN[2], [0, 1, 0], 0.13)]);
    shells.push(['lower fin', aerofoilPanel(LOWER_FIN[0], LOWER_FIN[3], LOWER_FIN[1], LOWER_FIN[2], [0, 1, 0], 0.12)]);
    shells.push(['lower fin, normal reversed', aerofoilPanel(LOWER_FIN[0], LOWER_FIN[3], LOWER_FIN[1], LOWER_FIN[2], [0, -1, 0], 0.12)]);
    shells.push(['upper fin, root and tip swapped', aerofoilPanel(UPPER_FIN[1], UPPER_FIN[2], UPPER_FIN[0], UPPER_FIN[3], [0, 1, 0], 0.13)]);
    // Stabiliser and endplates exactly as exteriorDetails.ts builds them.
    const hs = D.HORIZONTAL_STABILIZER, inc = STAB_INCIDENCE_DEG * Math.PI / 180, midX = hs.leadingX - hs.chord / 2;
    const chordEnd = (y: number, lead: boolean): [number, number, number] => {
      const k = lead ? 1 : -1; return [midX + k * hs.chord / 2 * Math.cos(inc), y, hs.z - k * hs.chord / 2 * Math.sin(inc)];
    };
    const half = hs.span / 2 - 0.01;
    shells.push(['stabiliser', aerofoilPanel(chordEnd(-half, true), chordEnd(-half, false), chordEnd(half, true), chordEnd(half, false),
      [Math.sin(inc), 0, -Math.cos(inc)], 0.12, 4)]);
    for (const side of [-1, 1]) {
      const toe = ENDPLATE.toeDeg * Math.PI / 180, y = side * hs.span / 2, c = ENDPLATE.chord / 2;
      const le = [midX + c * Math.cos(toe), y - side * c * Math.sin(toe)], te = [midX - c * Math.cos(toe), y + side * c * Math.sin(toe)];
      const top = hs.z - ENDPLATE.height * 0.4, bottom = hs.z + ENDPLATE.height * 0.6;
      shells.push([`endplate ${side}`, aerofoilPanel([le[0], le[1], top], [te[0], te[1], top], [le[0] - 0.03, le[1], bottom],
        [te[0] + 0.01, te[1], bottom], [Math.sin(toe) * side, Math.cos(toe), 0], 0.08, 4)]);
    }
    const inlet = INLET_FAIRING.map(([s, top, bot, hw]) => [sta(s), wl(top), wl(bot), hw * 0.0254] as const);
    const root = BOOM_ROOT_FAIRING.map(([s, top, bot, hw]) => [sta(s), wl(top), wl(bot), hw * 0.0254] as const);
    shells.push(['inlet fairing', fairingLoft(inlet, 3.2)], ['boom-root fairing', fairingLoft(root, 2.4, true)]);
    shells.push(['inlet fairing, rear to front', fairingLoft([...inlet].reverse(), 3.2)]);
    shells.push(['boom-root fairing, rear to front', fairingLoft([...root].reverse(), 2.4, true)]);
    for (const [name, g] of shells) {
      const f = outwardFraction(g);
      expect(f.winding, `${name} winding`).toBeGreaterThan(0.95);
      expect(f.normals, `${name} normals`).toBeGreaterThan(0.95);
      g.dispose();
    }
  });

  it('draws the stabiliser leading edge up at the TCDS incidence less the shaft tilt, the angle the flight model flies', () => {
    expect(STAB_INCIDENCE_DEG).toBeCloseTo(D.HORIZONTAL_STABILIZER.incidenceToMastNormalDeg - D.SHAFT_TILT_DEG, 12);
    expect(STAB_INCIDENCE_DEG).toBeGreaterThan(5); expect(STAB_INCIDENCE_DEG).toBeLessThan(7);
    // The flight model's surface: the same geometric angle less the inverted section's zero-lift angle.
    expect(MD500_ROTORCRAFT.stabilizer.incidence * 180 / Math.PI).toBeCloseTo(STAB_INCIDENCE_DEG - STAB_ZERO_LIFT_DEG, 9);
  });

  it('disposes every geometry, material and texture of the assembly', () => {
    vi.stubGlobal('document', blankDocument());
    const ctx = fakeContext(); ctx.state.rotorcraft = emptyRotorcraftState();
    const visual = new Visual(def, ctx, { lightScale: 1, panelEmissiveScale: 1, interiorLodDistance: 50, panelDef: MD500_PANEL });
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

