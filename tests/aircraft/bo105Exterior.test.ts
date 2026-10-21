// MBB Bo 105 CB-4 exterior, four-blade HINGELESS head and right-seat cockpit (package BX, plan revision 2, section 6.3).
// Accuracy targets (P unless tagged): overall length 11.86 m +/- 1 % (rotors), fuselage 8.56 m +/- 1 %, hull 4.30 x
// 1.58 m +/- 2 %, height to the head 3.00 m +/- 2 %, skid track 2.53 m +/- 2 % (tube centres), rotor 9.84 m, tail rotor
// 1.90 m, stabiliser span 2.0 m +/- 3 %, shaft tilt 3 deg, nothing below the skid sole, the eye within 3 cm of the
// geometry contract's pilot eye (dimensions.ts PILOT_EYE).
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { BO105_VISUAL as def, CHIN_GLASS, CLAMSHELL_STA, H, NOSE_STA, POD_END_STA, S, TAIL_END_STA } from '../../src/aircraft/bo105/visual';
import { BO105_PANEL } from '../../src/aircraft/bo105/panel';
import { BO105_ROTORCRAFT } from '../../src/aircraft/bo105/rotorcraft';
import { BO105_BLADE_CONING } from '../../src/aircraft/bo105/coning';
import { BO105_DEFINITION } from '../../src/aircraft/bo105';
import { bo105ExteriorVisualClass } from '../../src/aircraft/bo105/exterior';
import { BEND_LENGTH, Bo105MainRotor, buildBo105TailHead, equivalentOffset, HUB_TOP, shaftTilt } from '../../src/aircraft/bo105/exteriorRotor';
import { DECK_N, ENDPLATE_HALF_THICKNESS } from '../../src/aircraft/bo105/exteriorDetails';
import { powerLeverAngle } from '../../src/aircraft/bo105/cockpitDetails';
import { aerofoilPanel, BendingNeck, bentAxis, bo105Materials, fairingLoft, outboardBladeMatrix, virtualHinge,
  type BladeBend } from '../../src/aircraft/bo105/exteriorGeometry';
import { BOOM_ROOT_FAIRING, DECK_FAIRING, ENDPLATE, FIN, STAB } from '../../src/aircraft/bo105/visual';
import * as D from '../../src/aircraft/bo105/dimensions';
import { BO105_OVERHEAD_CONSOLE, BO105_PANEL_CANVAS, BO105_PANEL_FACE, BO105_PANEL_OUTLINE, BO105_POWER_LEVERS } from '../../src/aircraft/bo105/panelLayout';
import { FuselageShape } from '../../src/render/aircraft/fuselageShape';
import { RotorcraftVisual } from '../../src/render/aircraft/RotorcraftVisual';
import { sectionHalfWidth } from '../../src/render/aircraft/fuselage';
import { makeWindowSdf } from '../../src/render/aircraft/livery';
import { frd } from '../../src/render/aircraft/geometry';
import { TeeteringRotor } from '../../src/render/aircraft/rotorcraft/rotor';
import { bladeBlur } from '../../src/render/aircraft/bladeBlur';
import { emptyRotorcraftState, type RotorcraftDefinition } from '../../src/physics/rotorcraft/definition';
import { articulatedBladeConing } from '../../src/physics/rotorcraft/coning';
import { swashplateCyclic } from '../../src/physics/rotorcraft/swashplate';
import { Rotorcraft } from '../../src/physics/rotorcraft/rotorcraft';
import { panelUvBasis } from '../../src/instruments/panelProjection';
import { blankDocument, fakeContext, fakeMaterials, nonFinite } from './meshChecks';

/** The heavy whole-visual cases build the textures and every mesh: allow for a loaded machine. */
const HEAVY = 30_000;
const Visual = bo105ExteriorVisualClass(RotorcraftVisual, FuselageShape, sectionHalfWidth, ctx => ctx.state.rotorcraft);
/** FRD point of a three.js model-space vector. */
const toFrd = (v: THREE.Vector3): [number, number, number] => [-v.z, v.x, -v.y];
const rotorcraft = def.rotorcraft!;

/** Build the complete visual parked with the rotors stopped, run `fn`, dispose. */
function withVisual(fn: (visual: InstanceType<typeof Visual> & { hingelessHead: Bo105MainRotor }, ctx: ReturnType<typeof fakeContext>) => void): void {
  vi.stubGlobal('document', blankDocument());
  const ctx = fakeContext(2); ctx.state.rotorcraft = emptyRotorcraftState(); ctx.state.electrical.busVoltage = 28;
  const visual = new Visual(def, ctx, { lightScale: 1, panelEmissiveScale: 1, interiorLodDistance: 50, panelDef: BO105_PANEL }) as
    InstanceType<typeof Visual> & { hingelessHead: Bo105MainRotor };
  try { visual.update(ctx); visual.root.updateMatrixWorld(true); fn(visual, ctx); }
  finally { visual.dispose(); vi.unstubAllGlobals(); }
}

/** Visible-mesh vertices in model space (FRD), skipping the given subtrees. */
function visibleVertices(root: THREE.Object3D, skip: THREE.Object3D[] = [], stride = 3, frame = root): [number, number, number][] {
  const out: [number, number, number][] = [], v = new THREE.Vector3(), m = new THREE.Matrix4(), inv = frame.matrixWorld.clone().invert();
  const walk = (o: THREE.Object3D): void => {
    if (!o.visible || skip.includes(o)) return;
    if (o instanceof THREE.Mesh && !(o instanceof THREE.InstancedMesh) && !o.name.startsWith('shadowProxy')) {
      const p = o.geometry.getAttribute('position');
      m.multiplyMatrices(inv, o.matrixWorld);
      for (let i = 0; i < p.count; i += stride) out.push(toFrd(v.fromBufferAttribute(p, i).applyMatrix4(m)));
    }
    o.children.forEach(walk);
  };
  walk(root); return out;
}

/** Tip points of an instanced blade mesh (local +X to the radius; `chord` points along it), in model FRD. */
function bladeTips(rotor: TeeteringRotor, radius: number, root: THREE.Object3D, chord: readonly number[] = [-0.06, 0, 0.18]): [number, number, number][] {
  const m = new THREE.Matrix4(), inv = root.matrixWorld.clone().invert(), out: [number, number, number][] = [];
  for (let i = 0; i < rotor.blades.count; i++) {
    rotor.blades.getMatrixAt(i, m);
    for (const z of chord) out.push(toFrd(new THREE.Vector3(radius, 0, z).applyMatrix4(m).applyMatrix4(rotor.blades.matrixWorld).applyMatrix4(inv)));
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

/** A copy of the definition with a hingeless hub (the shape RC/BO give it; the S0 stub still flies the MD 500E hub). */
function hingeless(over: Partial<{ equivalentHingeOffset: number; controlPhase: number }> = {}): RotorcraftDefinition {
  return { ...rotorcraft, hubModel: { kind: 'hingeless', equivalentHingeOffset: over.equivalentHingeOffset ?? 0.6, flapFrequency: 1.11,
    precone: D.MAIN_ROTOR_PRECONE_DEG * Math.PI / 180, controlPhase: over.controlPhase } };
}

describe('Bo 105 CB-4 exterior', () => {
  it('is a cloneable description carrying the physics rotor and the shared reference geometry', () => {
    expect(structuredClone(def)).toEqual(def);
    // The visual's rotorcraft IS the physics definition (consistency rule).
    expect(def.rotorcraft).toBe(BO105_ROTORCRAFT); expect(def.rotorcraft).toEqual(BO105_DEFINITION.rotorcraft);
    const rv = def.rotorcraftVisual!;
    expect(rv.main.hub).toEqual([D.MAIN_HUB.x, D.MAIN_HUB.y, D.MAIN_HUB.z]);
    expect(rv.main.radius).toBe(D.MAIN_ROTOR_RADIUS); expect(rv.main.root).toBe(D.MAIN_ROTOR_ROOT_CUTOUT);
    expect(rv.main.chord).toEqual([D.MAIN_ROTOR_CHORD, D.MAIN_ROTOR_CHORD]);
    expect(rv.main.radius).toBe(BO105_ROTORCRAFT.main.radius); expect(rv.main.twist).toBeCloseTo(BO105_ROTORCRAFT.main.twist, 12);
    expect(rv.main.coning).toBe(BO105_BLADE_CONING);
    // Tail rotor on the LEFT of the fin at its top (dimensions.ts).
    expect(rv.tail.hub).toEqual([D.TAIL_HUB.x, D.TAIL_HUB.y, D.TAIL_HUB.z]); expect(rv.tail.hub[1]).toBeLessThan(0);
    expect(rv.tail.radius).toBe(D.TAIL_ROTOR_RADIUS); expect(rv.tail.chord).toBe(D.TAIL_ROTOR_CHORD);
    // The pilot sits RIGHT (P TCDS p11) at the contract's eye; one occupant drawn in that seat.
    expect(def.cockpit.pilotEye).toEqual([D.PILOT_EYE.x, D.PILOT_EYE.y, D.PILOT_EYE.z]);
    expect(def.cockpit.occupants).toEqual([{ seat: 0 }]); expect(def.cockpit.seats[0].y).toBe(D.PILOT_SEAT_Y);
    expect(D.PILOT_SEAT_Y).toBeGreaterThan(0);
    // The frozen cockpit contract's face, outline and canvas.
    expect(rv.panel.outline).toBe(BO105_PANEL_OUTLINE); expect(rv.panel.canvas).toBe(BO105_PANEL_CANVAS);
    expect(rv.panel.centre).toEqual([BO105_PANEL_FACE.centre.x, BO105_PANEL_FACE.centre.y, BO105_PANEL_FACE.centre.z]);
    expect(def.livery.registration).toBe('D-HBOX');
    // The aircraft stands on its skid soles; the shadow and the dev page seat it there.
    expect(def.shadow.restHeight).toBe(D.SKID_Z);
    // Hull: the pod loft is 4.30 m long (P) from the dimensions.ts nose.
    expect(def.fuselage.frontX).toBe(D.NOSE_X); expect(def.fuselage.frontX - def.fuselage.endX).toBeCloseTo(D.HULL_LENGTH, 9);
    expect(POD_END_STA - NOSE_STA).toBeCloseTo(D.HULL_LENGTH, 9);
    // The fin outline's trailing edge is clipped to the 8.56 m fuselage end.
    expect(Math.min(...FIN.map(p => p[0]))).toBeCloseTo(D.TAIL_END_X, 9);
  });

  it('glazes the windscreen, roof, chin and door windows; keeps the posts, door panels, deck and clamshells opaque', () => {
    const sdf = makeWindowSdf(def.glazing), skin = new FuselageShape(0, -Infinity, def.fuselage);
    const side = (s: number, h: number, y: number) => sdf(S(s), y * sectionHalfWidth(skin, S(s), H(h)), H(h));
    for (const y of [-1, 1]) {
      expect(side(0.95, 1.50, y)).toBeLessThan(-0.02);  // windscreen
      expect(side(0.95, 0.80, y)).toBeLessThan(-0.02);  // chin window
      expect(side(1.50, 1.50, y)).toBeLessThan(-0.02);  // crew-door window
      expect(side(1.45, 0.88, y)).toBeLessThan(-0.02);  // crew-door lower window
      expect(side(2.10, 1.50, y)).toBeLessThan(-0.02);  // sliding-door window
      expect(side(2.50, 1.55, y)).toBeLessThan(-0.02);  // sliding-door rear window
      expect(side(1.28, 1.50, y)).toBeGreaterThan(0);    // A-post between the windscreen and the crew-door window
      expect(side(1.80, 1.50, y)).toBeGreaterThan(0.02); // door post between the crew and sliding doors
      expect(side(3.60, 1.50, y)).toBeGreaterThan(0.05); // the cabin side under the deck (lettering panel)
      expect(side(1.16, 1.06, y)).toBeGreaterThan(-0.03); // the nose bow line between windscreen and chin windows
    }
    expect(sdf(S(1.60), 0, skin.section(S(1.60)).zTop)).toBeLessThan(0);   // roof glazing over the crew
    expect(sdf(S(3.20), 0, skin.section(S(3.20)).zTop)).toBeGreaterThan(0); // roof under the deck fairing
    // The chin windows reach the nose (their outline starts at the nose station).
    expect(Math.max(...CHIN_GLASS.map(p => p[0]))).toBeGreaterThanOrEqual(D.NOSE_X - 1e-9);
  });

  it('bends each blade over 0.1 R from the equivalent offset: continuous slope, no hinge, the outboard blade straight', () => {
    const bend: BladeBend = { e: 0.59, length: BEND_LENGTH }, axis: [number, number, number] = [0, 0, 0];
    expect(BEND_LENGTH).toBeCloseTo(0.1 * D.MAIN_ROTOR_RADIUS, 12);
    for (const beta of [-0.04, 0, 0.02, 0.07, 0.12]) {
      // Rigid inboard of e, slope continuous through the arc, then straight at the flap angle.
      expect(bentAxis(0.4, beta, bend, axis)).toEqual([0.4, 0, 0]);
      let last = bentAxis(bend.e, beta, bend, [0, 0, 0]);
      for (let r = bend.e + 0.01; r <= bend.e + bend.length + 0.2; r += 0.01) {
        const p = bentAxis(r, beta, bend, [0, 0, 0]);
        const slope = Math.atan2(p[1] - last[1], p[0] - last[0]);
        expect(Math.abs(slope - (p[2] + last[2]) / 2)).toBeLessThan(2e-4); // the drawn slope is the axis's own
        expect(Math.hypot(p[0] - last[0], p[1] - last[1])).toBeCloseTo(0.01, 6); // arc length preserved (no stretch)
        last = p;
      }
      expect(last[2]).toBe(beta);
      // The outboard part extended inboard crosses the hub plane at the virtual hinge, e + L/2 for small flap.
      const tip = bentAxis(D.MAIN_ROTOR_RADIUS, beta, bend, [0, 0, 0]);
      if (beta !== 0) expect(tip[0] - tip[1] / Math.tan(beta)).toBeCloseTo(virtualHinge(beta, bend), 9);
      expect(Math.abs(virtualHinge(beta, bend) - (bend.e + bend.length / 2))).toBeLessThan(2e-3);
      // The rigid outboard transform lands every outboard point on the axis.
      const m = outboardBladeMatrix(beta, 0.1, bend, new THREE.Matrix4());
      for (const r of [1.1, 2.5, D.MAIN_ROTOR_RADIUS]) {
        const q = new THREE.Vector3(r, 0, 0).applyMatrix4(m);
        bentAxis(r, beta, bend, axis);
        expect(q.distanceTo(new THREE.Vector3(axis[0], axis[1], 0))).toBeLessThan(1e-9);
      }
    }
  });

  it('poses four bent blades from the published state, the roots meeting the blades and the links on the swashplate', () => {
    const d = def.rotorcraftVisual!, mat = bo105Materials();
    const rotor = new TeeteringRotor({ ...d.main, blades: 4, hubType: 'hingeless' }, fakeMaterials());
    const head = new Bo105MainRotor(rotor, d.main, hingeless({ equivalentHingeOffset: 0.62 }), mat), ctx = fakeContext(2);
    expect(head.bend.e).toBe(0.62); // the hub model's equivalent offset when declared
    expect(equivalentOffset(rotorcraft)).toBeCloseTo(D.EQUIVALENT_HINGE_OFFSET_FRACTION * D.MAIN_ROTOR_RADIUS, 12);
    const trailUpdate = vi.spyOn(rotor.trail, 'update');
    ctx.state.rotorcraft = emptyRotorcraftState();
    const blades = [{ flap: 0.07, lag: 0, pitch: 0.15 }, { flap: -0.03, lag: 0, pitch: 0.08 }, { flap: 0.09, lag: 0, pitch: 0.20 }, { flap: 0.02, lag: 0, pitch: 0.11 }];
    ctx.state.rotorcraft.articulated = { blades };
    const matrix = new THREE.Matrix4(), expected = new THREE.Vector3(), actual = new THREE.Vector3(), rest = new THREE.Vector3();
    let named = 0; head.group.traverse(o => { if (/hinge/i.test(o.name) && o !== head.group) named++; });
    expect(named).toBe(0); // no hinge anywhere in the head
    expect(head.arms).toHaveLength(4);
    for (const rpm of [0, 120, 424, 0]) for (const azimuth of [0, 1.7, 5.1]) {
      Object.assign(ctx.state.rotorcraft, { rotorRpm: rpm, azimuth, thrust: 21000, flapForward: 0.04, flapRight: -0.02 });
      const snapshot = structuredClone(ctx.state.rotorcraft);
      rotor.update(azimuth, rpm, 0.13, 0.03); head.update(ctx); rotor.group.updateMatrixWorld(true);
      expect(ctx.state.rotorcraft).toEqual(snapshot); expect(nonFinite(rotor.group)).toBe(0);
      const meanFlap = blades.reduce((s, b) => s + b.flap / 4, 0), meanPitch = blades.reduce((s, b) => s + b.pitch / 4, 0);
      expect(trailUpdate).toHaveBeenLastCalledWith(bladeBlur(rpm, 4), meanPitch, meanFlap, virtualHinge(meanFlap, head.bend));
      head.arms.forEach((arm, i) => {
        expect(head.flaps[i]).toBe(blades[i].flap); expect(arm.pitch.rotation.x).toBe(blades[i].pitch);
        // The instanced blade: the azimuth frame times the rigid outboard transform.
        rotor.blades.getMatrixAt(i, matrix);
        const want = outboardBladeMatrix(blades[i].flap, blades[i].pitch, head.bend, new THREE.Matrix4())
          .premultiply(new THREE.Matrix4().makeRotationY(i * Math.PI / 2));
        expect(matrix.elements.every((v, k) => Math.abs(v - want.elements[k]) < 1e-6)).toBe(true); // Float32 instance storage
        // The bending root: every vertex outboard of the bend lands where the rigid blade transform puts it (so the
        // root meets the aerofoil without a step), and every vertex inboard of e only feathers.
        const neck = head.necks[i], p = neck.geometry.getAttribute('position');
        const restPositions = (neck as unknown as { rest: Float32Array }).rest;
        const outboard = outboardBladeMatrix(blades[i].flap, blades[i].pitch, head.bend, new THREE.Matrix4());
        const feather = new THREE.Matrix4().makeRotationX(blades[i].pitch);
        let checkedOut = 0, checkedIn = 0;
        for (let k = 0; k < p.count; k++) {
          rest.fromArray(restPositions, 3 * k); actual.fromBufferAttribute(p, k);
          if (rest.x >= head.bend.e + head.bend.length) { expected.copy(rest).applyMatrix4(outboard); checkedOut++; }
          else if (rest.x <= head.bend.e) { expected.copy(rest).applyMatrix4(feather); checkedIn++; }
          else continue;
          expect(actual.distanceTo(expected)).toBeLessThan(2e-6);
        }
        expect(checkedOut).toBeGreaterThan(20); expect(checkedIn).toBeGreaterThan(20);
      });
    }
    // Without a published pose the head solves the same coning law as the md500 adapter, about the bend.
    delete ctx.state.rotorcraft.articulated;
    Object.assign(ctx.state.rotorcraft, { rotorRpm: 424, omega: 424 * Math.PI / 30, azimuth: 0.3, thrust: 21000, flapForward: 0.02, flapRight: 0.05 });
    head.update(ctx);
    head.arms.forEach((_, i) => {
      const psi = 0.3 + i * Math.PI / 2;
      expect(head.flaps[i]).toBeCloseTo(articulatedBladeConing(d.main.coning, 424 * Math.PI / 30, 21000 / 4,
        -0.02 * Math.sin(psi) - 0.05 * Math.cos(psi)).angle, 12);
    });
    rotor.group.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
    rotor.dispose(); Object.values(mat).forEach(m => m.dispose());
  });

  it('takes the swashplate from swashplateCyclic (the hingeless control phase), and the head stands on the 3 deg shaft', () => {
    const d = def.rotorcraftVisual!, mat = bo105Materials(), phased = hingeless({ controlPhase: 0.3 });
    const rotor = new TeeteringRotor({ ...d.main, blades: 4, hubType: 'hingeless' }, fakeMaterials());
    const head = new Bo105MainRotor(rotor, d.main, phased, mat), ctx = fakeContext(2);
    ctx.state.rotorcraft = emptyRotorcraftState();
    ctx.controls.elevator = 0.6; ctx.controls.aileron = -0.3; ctx.controls.collective = 0.4;
    head.update(ctx);
    const cyclic = swashplateCyclic(phased, ctx.controls, ctx.state.rotorcraft);
    const normal = new THREE.Vector3(0, 1, 0).applyQuaternion(head.swashplate.quaternion);
    expect(normal.distanceTo(new THREE.Vector3(Math.tan(cyclic.right), 1, Math.tan(cyclic.aft)).normalize())).toBeLessThan(1e-9);
    // The phase turns the plate away from where the raw stick would put it.
    const raw = new THREE.Vector3(ctx.controls.aileron * phased.cyclicLimit, 1, ctx.controls.elevator * phased.cyclicLimit).normalize();
    expect(normal.angleTo(raw)).toBeGreaterThan(0.01);
    // Fallback feathering follows the same cyclic: pitch(psi) = theta0 + rotation (right sin psi + aft cos psi).
    const theta0 = THREE.MathUtils.lerp(phased.main.minPitch, phased.main.maxPitch, 0.4);
    head.arms.forEach((arm, i) => {
      const psi = i * Math.PI / 2;
      expect(arm.pitch.rotation.x).toBeCloseTo(theta0 + phased.rotation * (cyclic.right * Math.sin(psi) + cyclic.aft * Math.cos(psi)), 12);
    });
    // Shaft tilt: 3 deg forward (P5 FM Fig 1-1, AR-280), the shaft top leaning to -Z (forward).
    expect(shaftTilt(rotorcraft)).toBeCloseTo(3 * Math.PI / 180, 12);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(rotor.group.quaternion);
    expect(Math.atan2(-up.z, up.y)).toBeCloseTo(3 * Math.PI / 180, 9); expect(Math.abs(up.x)).toBeLessThan(1e-12);
    rotor.group.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
    rotor.dispose(); Object.values(mat).forEach(m => m.dispose());
  });

  it('follows the physics blade pose (four blades) and tilts the exposure disc with the published flapping', () => {
    const d = def.rotorcraftVisual!, mat = bo105Materials(), physics = new Rotorcraft(rotorcraft);
    const rotor = new TeeteringRotor({ ...d.main, blades: 4, hubType: 'hingeless' }, fakeMaterials());
    const head = new Bo105MainRotor(rotor, d.main, rotorcraft, mat), ctx = fakeContext(2);
    physics.reset(true); ctx.state.rotorcraft = physics.state;
    expect(physics.state.articulated!.blades).toHaveLength(4);
    Object.assign(physics.state, { thrust: 21000, flapForward: 0.03, flapRight: -0.02 });
    ctx.controls.collective = 0.5; ctx.controls.elevator = 0.2; ctx.controls.aileron = -0.1;
    const tilt = new THREE.Vector3(-0.02, 1, -0.03).normalize();
    for (const azimuth of [0, 0.7, 2.5, 5.8]) {
      physics.state.azimuth = azimuth; physics.publishBlades(ctx.controls);
      rotor.update(azimuth, physics.state.rotorRpm, 0, 0); head.update(ctx, physics.state);
      head.flaps.forEach((f, i) => expect(f).toBe(physics.state.articulated!.blades[i].flap));
      expect(new THREE.Vector3(0, 1, 0).applyQuaternion(rotor.blur.quaternion).distanceTo(tilt)).toBeLessThan(1e-5);
    }
    rotor.group.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
    rotor.dispose(); Object.values(mat).forEach(m => m.dispose());
  });

  it('turns a two-blade tail rotor on the LEFT with its grips following the blades', () => {
    const d = def.rotorcraftVisual!, mat = bo105Materials();
    const rotor = new TeeteringRotor({ ...d.tail, chord: [d.tail.chord, d.tail.chord], twist: d.tail.twist ?? 0, tail: true, blades: 2 }, fakeMaterials());
    const update = buildBo105TailHead(rotor, mat);
    rotor.update(1.1, 2229, 0.1, 0); rotor.group.updateMatrixWorld(true); update();
    const grips: THREE.Object3D[] = []; rotor.spin.traverse(o => { if (o.name === 'bo105TailGrip') grips.push(o); });
    const m = new THREE.Matrix4();
    expect(grips).toHaveLength(2);
    grips.forEach((g, i) => { rotor.blades.getMatrixAt(i, m); expect(g.matrix.equals(m)).toBe(true); });
    rotor.group.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
    rotor.dispose(); Object.values(mat).forEach(x => x.dispose());
  });

  it('meets the TCDS / flight-manual dimensions on the built model', () => {
    withVisual((visual, ctx) => {
      const r = ctx.state.rotorcraft!, rv = def.rotorcraftVisual!;
      // Overall length, rotors turning: the forward main-rotor tip (a blade pointing ahead) to the aft TR tip.
      let front = -Infinity, aft = Infinity, tailY = -Infinity, mainR = 0, tailR = 0;
      const hub = new THREE.Vector3(...rv.main.hub), tailHub = new THREE.Vector3(...rv.tail.hub);
      for (let k = 0; k < 72; k++) {
        r.azimuth = k * Math.PI / 36; visual.update(ctx); visual.root.updateMatrixWorld(true);
        for (const p of bladeTips(visual.main, rv.main.radius, visual.root)) front = Math.max(front, p[0]);
        for (const p of bladeTips(visual.main, rv.main.radius, visual.root, [0])) mainR = Math.max(mainR, Math.hypot(p[0] - hub.x, p[1] - hub.y));
        for (const p of bladeTips(visual.tail, rv.tail.radius, visual.root)) { aft = Math.min(aft, p[0]); tailY = Math.max(tailY, p[1]); }
        for (const p of bladeTips(visual.tail, rv.tail.radius, visual.root, [0])) tailR = Math.max(tailR, Math.hypot(p[0] - tailHub.x, p[2] - tailHub.z));
      }
      const overall = front - aft;
      expect(Math.abs(overall / D.OVERALL_LENGTH - 1)).toBeLessThan(0.01);
      expect(Math.abs(2 * mainR / 9.84 - 1)).toBeLessThan(0.01);
      expect(Math.abs(2 * tailR / 1.90 - 1)).toBeLessThan(0.02);
      // The tail rotor turns entirely left of the centreline.
      expect(tailY).toBeLessThan(-0.10);
      // Fuselage (nose to the aft end of the fin) and everything else that is not a rotor or the cabin.
      const airframe = visibleVertices(visual.root, [visual.main.group, visual.tail.group, visual.cockpit.group]);
      const xs = airframe.map(p => p[0]), zs = airframe.map(p => p[2]);
      const fuselage = Math.max(...xs) - Math.min(...xs);
      expect(Math.abs(fuselage / D.FUSELAGE_LENGTH - 1)).toBeLessThan(0.01);
      expect(Math.max(...xs)).toBeCloseTo(D.NOSE_X, 2);
      expect(Math.min(...xs)).toBeGreaterThan(S(TAIL_END_STA) - 0.03);
      // Nothing below the skid sole (spline tessellation tolerance 2 mm).
      expect(Math.max(...zs)).toBeLessThanOrEqual(D.SKID_Z + 0.002);
      // Hull: the skin of the cabin pod, 4.30 x 1.58 m.
      const skin = visual.root.getObjectByName('fuselageSkin') as THREE.Mesh;
      const pod = visibleVertices(skin, [], 1, visual.root);
      const hullLength = Math.max(...pod.map(p => p[0])) - Math.min(...pod.map(p => p[0]));
      const hullWidth = Math.max(...pod.map(p => p[1])) - Math.min(...pod.map(p => p[1]));
      expect(Math.abs(hullLength / D.HULL_LENGTH - 1)).toBeLessThan(0.02);
      expect(Math.abs(hullWidth / D.HULL_WIDTH - 1)).toBeLessThan(0.02);
      // Height to the top of the rotor head (the hub cap): 3.00 m (P TCDS p8).
      const head = visibleVertices(visual.main.group, [visual.main.blades, visual.main.blur, visual.main.trail.mesh], 1, visual.root);
      const top = Math.min(...head.map(p => p[2]));
      const height = D.SKID_Z - top;
      expect(Math.abs(height / D.HEIGHT_TO_HEAD - 1)).toBeLessThan(0.02);
      expect(HUB_TOP).toBeCloseTo(D.HEIGHT_TO_HEAD - D.HUB_HEIGHT, 12);
      const structure = visibleVertices(visual.root.getObjectByName('bo105Exterior')!, [], 1, visual.root);
      // Skid track between the tube centres (2.53 m, P5 FM Fig 1-1), on the straight rails between the cross tubes.
      const low = structure.filter(p => p[2] > D.SKID_Z - 0.03 && p[0] < S(2.4) && p[0] > S(3.7));
      const outer = Math.max(...low.map(p => p[1])) - Math.min(...low.map(p => p[1]));
      const track = outer - 2 * rv.skids.tubeRadius!;
      expect(Math.abs(track / D.SKID_TRACK - 1)).toBeLessThan(0.02);
      // Stabiliser span 2.0 m with its endplates (P AR-280).
      const stab = structure.filter(p => p[0] < STAB.leadingX + 0.05 && p[0] > STAB.leadingX - STAB.chord - 0.05 && Math.abs(p[2] - STAB.z) < 0.3);
      const span = Math.max(...stab.map(p => p[1])) - Math.min(...stab.map(p => p[1]));
      expect(Math.abs(span / D.HORIZONTAL_STABILIZER.span - 1)).toBeLessThan(0.03);
      console.log(JSON.stringify({ overall, fuselage, hullLength, hullWidth, heightToHead: height, track, stabSpan: span,
        rotorDiameter: 2 * mainR, tailRotorDiameter: 2 * tailR }));
    });
  }, HEAVY);

  it('seats the pilot RIGHT with one cyclic, one collective on his left, two pedals, the power levers and a scaled panel', () => {
    withVisual((visual, ctx) => {
      const lining = new FuselageShape(0.026, -Infinity, def.fuselage), eye = D.PILOT_EYE;
      // The eye: on the contract within 3 cm, under the roof and inside the side walls.
      const e = def.cockpit.pilotEye;
      expect(Math.hypot(e[0] - eye.x, e[1] - eye.y, e[2] - eye.z)).toBeLessThan(0.03);
      expect(eye.z - lining.section(eye.x).zTop).toBeGreaterThan(0.15);
      expect(sectionHalfWidth(lining, eye.x, eye.z)).toBeGreaterThan(Math.abs(eye.y) + 0.2);
      // The frozen overhead console and the power-lever pivots hang inside the cabin lining.
      expect(BO105_OVERHEAD_CONSOLE.centre.z - lining.section(BO105_OVERHEAD_CONSOLE.centre.x).zTop).toBeGreaterThan(0.025);
      expect(BO105_POWER_LEVERS.pivot.z - lining.section(BO105_POWER_LEVERS.pivot.x).zTop).toBeGreaterThan(0.01);
      // Seats fit inside the lining.
      for (const seat of def.cockpit.seats.filter(s => s.kind === 'front'))
        for (const x of [seat.x - 0.05, seat.x - seat.depth + 0.05])
          expect(sectionHalfWidth(lining, x, seat.z! + 0.1)).toBeGreaterThan(Math.abs(seat.y) + seat.width / 2 - 0.04);
      const [origin, du, dv] = panelUvBasis(visual.panel.geometry)!;
      const centre = origin.clone().addScaledVector(du, 0.5).addScaledVector(dv, 0.5);
      expect(visual.panel.localToWorld(centre).distanceTo(frd(BO105_PANEL_FACE.centre.x, BO105_PANEL_FACE.centre.y, BO105_PANEL_FACE.centre.z))).toBeLessThan(1e-6);
      expect(du.length() / BO105_PANEL_CANVAS.w).toBeCloseTo(dv.length() / BO105_PANEL_CANVAS.h, 9);
      expect(visual.cockpit.collectives).toHaveLength(1); expect(visual.cockpit.pedals).toHaveLength(2);
      const collective = toFrd(visual.cockpit.collectives[0].getWorldPosition(new THREE.Vector3()));
      expect(collective[1]).toBeLessThan(D.PILOT_SEAT_Y); expect(collective[1]).toBeGreaterThan(0); // on the pilot's left, inboard
      expect(visual.cockpit.throttles[0].visible).toBe(false); // no twist grip: power levers overhead
      const stick = visual.root.getObjectByName('bo105Cyclic')!;
      expect(toFrd(stick.getWorldPosition(new THREE.Vector3()))[1]).toBeCloseTo(D.PILOT_SEAT_Y, 9);
      // Power levers: engine 1 left, engine 2 right, at the frozen pivots, each on its own engine's lever.
      const levers = [1, 2].map(i => visual.root.getObjectByName(`bo105PowerLever${i}`)!);
      levers.forEach((l, i) => expect(toFrd(l.getWorldPosition(new THREE.Vector3()))).toEqual(
        expect.arrayContaining([expect.closeTo(BO105_POWER_LEVERS.pivot.x, 9), expect.closeTo(BO105_POWER_LEVERS.ys[i], 9)])));
      ctx.controls.engines = [{ throttle: 0 }, { throttle: 1 }];
      ctx.controls.elevator = 0.6; ctx.controls.aileron = -0.4; ctx.controls.collective = 0.7;
      ctx.controls.n2Beep = 1; ctx.controls.n2BeepSplit = -1;
      visual.update(ctx);
      expect(levers[0].rotation.x).toBeCloseTo(powerLeverAngle(0), 12); expect(levers[1].rotation.x).toBeCloseTo(powerLeverAngle(1), 12);
      expect(powerLeverAngle(1) - powerLeverAngle(0)).toBeCloseTo(BO105_POWER_LEVERS.travelDeg * Math.PI / 180, 12);
      expect(stick.rotation.x).toBeGreaterThan(0); expect(stick.rotation.z).toBeGreaterThan(0);
      const trim = visual.root.getObjectByName('bo105EngineTrimSwitch')!;
      expect(trim.rotation.x).toBeLessThan(0); expect(trim.rotation.z).toBeGreaterThan(0); // fore (INCREASE), left
      expect(nonFinite(visual.root)).toBe(0);
      ctx.cameraMode = 'cockpit'; visual.update(ctx);
      expect(visual.cockpit.group.getObjectByName('occupants')!.visible).toBe(false);
      // The pedestal hood sits on the frozen face.
      const hood = visual.root.getObjectByName('bo105PedestalHood')!;
      expect(toFrd(hood.getWorldPosition(new THREE.Vector3())).map((v, k) => v - [BO105_PANEL_FACE.centre.x, 0, BO105_PANEL_FACE.centre.z][k])
        .every(v => Math.abs(v) < 1e-9)).toBe(true);
    });
  }, HEAVY);

  it('faces every aerofoil panel, fairing loft and bending root outward (FrontSide)', () => {
    const shells: [string, THREE.BufferGeometry][] = [];
    shells.push(['fin', aerofoilPanel(FIN[0], FIN[3], FIN[1], FIN[2], [0, 1, 0], 0.14)]);
    const half = STAB.span / 2 - ENDPLATE_HALF_THICKNESS, le = STAB.leadingX, te = STAB.leadingX - STAB.chord;
    shells.push(['stabiliser', aerofoilPanel([le, -half, STAB.z], [te, -half, STAB.z], [le, half, STAB.z], [te, half, STAB.z], [0, 0, -1], 0.10, 4)]);
    for (const side of [-1, 1]) {
      const y = side * (STAB.span / 2 - ENDPLATE_HALF_THICKNESS), mid = (le + te) / 2, c = ENDPLATE.chord / 2;
      const top = STAB.z - ENDPLATE.height * ENDPLATE.above, bottom = STAB.z + ENDPLATE.height * (1 - ENDPLATE.above);
      shells.push([`endplate ${side}`, aerofoilPanel([mid + c, y, top], [mid - c, y, top], [mid + c - 0.02, y, bottom], [mid - c, y, bottom], [0, side, 0], 0.08, 4)]);
    }
    shells.push(['deck fairing', fairingLoft(DECK_FAIRING.map(([s, t, b, hw]) => [S(s), H(t), H(b), hw] as const), DECK_N)]);
    shells.push(['boom-root fairing', fairingLoft(BOOM_ROOT_FAIRING.map(([s, t, b, hw]) => [S(s), H(t), H(b), hw] as const), 2.6, true)]);
    const neck = new BendingNeck(0.40, 1.12, { chord: 0.27, thickness: 0.0324, twist: 0.08 });
    shells.push(['blade root, straight', neck.geometry.clone()]);
    neck.pose(0.08, 0.2, { e: 0.59, length: BEND_LENGTH });
    shells.push(['blade root, bent', neck.geometry]);
    for (const [name, g] of shells) {
      const f = outwardFraction(g);
      expect(f.winding, `${name} winding`).toBeGreaterThan(0.95);
      expect(f.normals, `${name} normals`).toBeGreaterThan(0.95);
      g.dispose();
    }
  });

  it('keeps the clamshell doors aft of the cabin and the deck fairing over the roof', () => {
    expect(CLAMSHELL_STA).toBeGreaterThan(2.9); expect(CLAMSHELL_STA).toBeLessThan(POD_END_STA);
    const skin = new FuselageShape(0, -Infinity, def.fuselage);
    // The deck fairing's lower edges stay inside the pod's skin over the pod (no ledge under the cowling).
    for (const [s, , bottom, hw] of DECK_FAIRING) {
      if (s > POD_END_STA - 0.1) continue;
      expect(sectionHalfWidth(skin, S(s), H(bottom))).toBeGreaterThan(hw);
    }
    // ...and the deck stands over the cabin roof behind the crew, the mast rising from it.
    expect(DECK_FAIRING[0][0]).toBeGreaterThan(D.REF_STATION_M - 0.6); expect(DECK_FAIRING[0][0]).toBeLessThan(D.REF_STATION_M);
  });

  it('disposes every geometry, material and texture of the assembly', () => {
    vi.stubGlobal('document', blankDocument());
    const ctx = fakeContext(2); ctx.state.rotorcraft = emptyRotorcraftState();
    const visual = new Visual(def, ctx, { lightScale: 1, panelEmissiveScale: 1, interiorLodDistance: 50, panelDef: BO105_PANEL });
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
  }, HEAVY);
});
