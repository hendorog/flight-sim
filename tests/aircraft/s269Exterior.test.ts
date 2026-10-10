import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { S269_VISUAL as def } from '../../src/aircraft/s269/visual';
import { S269_PANEL } from '../../src/aircraft/s269/panel';
import { s269ExteriorVisualClass } from '../../src/aircraft/s269/exterior';
import { S269MainRotor, setS269Section, type S269RotorPose } from '../../src/aircraft/s269/exteriorRotor';
import { s269Materials } from '../../src/aircraft/s269/exteriorGeometry';
import * as D from '../../src/aircraft/s269/dimensions';
import { FuselageShape } from '../../src/render/aircraft/fuselageShape';
import { RotorcraftVisual } from '../../src/render/aircraft/RotorcraftVisual';
import { sectionHalfWidth } from '../../src/render/aircraft/fuselage';
import { frd } from '../../src/render/aircraft/geometry';
import { rotorBladeGeometry, TeeteringRotor } from '../../src/render/aircraft/rotorcraft/rotor';
import { emptyRotorcraftState } from '../../src/physics/rotorcraft/definition';
import { Rotorcraft } from '../../src/physics/rotorcraft/rotorcraft';
import { panelUvBasis } from '../../src/instruments/panelProjection';
import { blankDocument, fakeContext, fakeMaterials, nonFinite } from './meshChecks';

describe('300CB exterior', () => {
  it('retains a cloneable description and two seats at the shared arms with right PIC', () => {
    expect(structuredClone(def)).toEqual(def);
    expect(def.cockpit.seats).toHaveLength(2);
    expect(def.cockpit.occupants).toEqual([{ seat: D.PILOT_SEAT }]);
    expect(def.cockpit.pilotEye).toEqual([D.PILOT_EYE.x, D.PILOT_EYE.y, D.PILOT_EYE.z]);
    expect(def.cockpit.seats.map(s => s.y)).toEqual(D.SEAT_CENTRES.map(s => s.y));
    const lining = new FuselageShape(0.015, -Infinity, def.fuselage);
    for (const seat of def.cockpit.seats) {
      expect(seat.z! + 0.21).toBeLessThan(def.cockpit.floor.z);
      for (const x of [seat.x - 0.05, seat.x - seat.depth + 0.05])
        expect(sectionHalfWidth(lining, x, seat.z! + 0.17)).toBeGreaterThan(Math.abs(seat.y) + seat.width / 2 - 0.035);
    }
  });

  it('changes NACA thickness without changing chord, twist or radial span', () => {
    const spec = def.rotorcraftVisual!.main, g = rotorBladeGeometry(spec), p = g.getAttribute('position');
    const before = Array.from({ length: p.count }, (_, i) => new THREE.Vector3().fromBufferAttribute(p, i));
    setS269Section(g, spec, 0.15, 1);
    let maxError = 0;
    for (let i = 0; i < p.count; i++) {
      const b = before[i], beta = spec.twist * ((b.x - spec.root) / (spec.radius - spec.root) - 0.75);
      const c = Math.cos(beta), s = Math.sin(beta);
      expect(p.getX(i)).toBe(b.x);
      maxError = Math.max(maxError, Math.abs((p.getY(i) * s - p.getZ(i) * c) - (b.y * s - b.z * c)),
        Math.abs((p.getY(i) * c + p.getZ(i) * s) - (b.y * c + b.z * s) * 1.25));
    }
    expect(maxError).toBeLessThan(1e-7); g.dispose();
  });

  it('hinges each blade independently and keeps blade roots/links attached without changing physics', () => {
    const d = def.rotorcraftVisual!, mat = s269Materials();
    const rotor = new TeeteringRotor({ ...d.main, blades: 3, hubType: 'articulated' }, fakeMaterials());
    const head = new S269MainRotor(rotor, d.main, def.rotorcraft!, mat), ctx = fakeContext();
    ctx.state.rotorcraft = emptyRotorcraftState();
    const pose: S269RotorPose = { blades: [{ flap: 0.07, lag: 0.04, pitch: 0.15 },
      { flap: -0.03, lag: -0.06, pitch: 0.08 }, { flap: 0.09, lag: 0.01, pitch: 0.20 }] };
    const matrix = new THREE.Matrix4(), expected = new THREE.Vector3(), actual = new THREE.Vector3();
    for (const rpm of [0, 30, 180, 462]) for (const azimuth of [0, 1.7, 5.1]) {
      Object.assign(ctx.state.rotorcraft, { rotorRpm: rpm, azimuth, thrust: 7000, flapForward: 0.04, flapRight: -0.02 });
      const snapshot = structuredClone(ctx.state.rotorcraft);
      rotor.update(azimuth, rpm, 0.13, 0.035 + rpm * 1e-5); head.update(ctx, pose); rotor.group.updateMatrixWorld(true);
      expect(ctx.state.rotorcraft).toEqual(snapshot); expect(nonFinite(rotor.group)).toBe(0);
      const blur = rotor.blur.geometry.getAttribute('position');
      expect(blur.getY(0)).toBeCloseTo((Math.hypot(blur.getX(0), blur.getZ(0)) - D.FLAP_HINGE_OFFSET)
        * Math.sin(pose.blades.reduce((sum, b) => sum + b.flap / 3, 0)), 7);
      const inverse = rotor.spin.matrixWorld.clone().invert();
      head.arms.forEach((arm, i) => {
        expect(arm.flap.position.x).toBe(D.FLAP_HINGE_OFFSET);
        expect(arm.lag.position.x + arm.flap.position.x).toBeCloseTo(D.LAG_HINGE_OFFSET, 12);
        expect(arm.flap.rotation.z).toBe(pose.blades[i].flap); expect(arm.lag.rotation.y).toBe(pose.blades[i].lag);
        rotor.blades.getMatrixAt(i * rotor.blades.count / 3, matrix);
        expected.set(d.main.root - D.LAG_HINGE_OFFSET, 0, 0).applyMatrix4(arm.pitch.matrixWorld).applyMatrix4(inverse);
        actual.set(d.main.root, 0, 0).applyMatrix4(matrix);
        expect(actual.distanceTo(expected)).toBeLessThan(1e-7);
      });
      // The two telescoping damper pieces share their joining point at every independent lag angle.
      const bodies: THREE.Mesh[] = [], rods: THREE.Mesh[] = [];
      head.group.traverse(o => { if (o.name === 's269ElastomericLagDamper') bodies.push(o as THREE.Mesh);
        if (o.name === 's269LagDamperEnd') rods.push(o as THREE.Mesh); });
      bodies.forEach((body, i) => {
        expected.set(0, 0.5, 0).applyMatrix4(body.matrixWorld);
        actual.set(0, -0.5, 0).applyMatrix4(rods[i].matrixWorld);
        expect(actual.distanceTo(expected)).toBeLessThan(1e-8);
      });
    }
    head.update(ctx); head.arms.forEach(a => expect(a.lag.rotation.y).toBe(0));
    rotor.group.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
    rotor.dispose(); Object.values(mat).forEach(m => m.dispose());
  });

  it('keeps the published blade flap and exposure disc aligned with the physical thrust axis', () => {
    const d = def.rotorcraftVisual!, mat = s269Materials(), physics = new Rotorcraft(def.rotorcraft!);
    const rotor = new TeeteringRotor({ ...d.main, blades: 3, hubType: 'articulated' }, fakeMaterials());
    const head = new S269MainRotor(rotor, d.main, def.rotorcraft!, mat), ctx = fakeContext();
    physics.reset(true); ctx.state.rotorcraft = physics.state;
    Object.assign(physics.state, { coning: 0.08, flapForward: 0.03, flapRight: -0.02 });
    ctx.controls.collective = 0.4; ctx.controls.elevator = 0.2; ctx.controls.aileron = -0.1;
    const expected = new THREE.Vector3(-0.02, 1, -0.03).normalize(); // FRD thrust (forward, right, up).
    for (const azimuth of [0, 0.7, 2.5, 5.8]) {
      physics.state.azimuth = azimuth; physics.publishBlades(ctx.controls);
      rotor.update(azimuth, physics.state.rotorRpm, 0, 0);
      head.update(ctx, physics.state.articulated);
      expect(new THREE.Vector3(0, 1, 0).applyQuaternion(rotor.blur.quaternion).distanceTo(expected)).toBeLessThan(1e-5);
      // Blade zero points right at zero azimuth, then forward at π/2. A right-tilted
      // disc lowers its right-hand tip; the fallback preview uses the same convention.
      const angle = physics.state.articulated!.blades[0].flap;
      expect(angle).toBeCloseTo(0.08 - 0.03 * Math.sin(azimuth) + 0.02 * Math.cos(azimuth), 12);
      const angles = head.arms.map(a => a.flap.rotation.z);
      head.update(ctx);
      head.arms.forEach((a, i) => expect(a.flap.rotation.z - head.arms[0].flap.rotation.z)
        .toBeCloseTo(angles[i] - angles[0], 12));
    }
    rotor.group.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
    rotor.dispose(); Object.values(mat).forEach(m => m.dispose());
  });

  it('preserves panel UV/raycast scale, local cyclic pivots, ground datum and disposal in the complete assembly', () => {
    vi.stubGlobal('document', blankDocument());
    const Visual = s269ExteriorVisualClass(RotorcraftVisual, FuselageShape, sectionHalfWidth);
    const ctx = fakeContext(); ctx.state.rotorcraft = emptyRotorcraftState(); ctx.state.electrical.busVoltage = 28;
    const visual = new Visual(def, ctx, { lightScale: 1, panelEmissiveScale: 1, interiorLodDistance: 50, panelDef: S269_PANEL });
    let disposed = false;
    try {
      ctx.controls.aileron = 0.8; ctx.controls.elevator = -0.5; ctx.controls.rudder = 0.9; ctx.controls.collective = 0.7;
      ctx.state.rotorcraft.rotorRpm = 462; ctx.state.rotorcraft.thrust = 7780;
      visual.update(ctx); visual.root.updateMatrixWorld(true); expect(nonFinite(visual.root)).toBe(0);
      const [origin, du, dv] = panelUvBasis(visual.panel.geometry)!;
      const centre = origin.clone().addScaledVector(du, 0.5).addScaledVector(dv, 0.5);
      expect(visual.panel.localToWorld(centre).distanceTo(frd(D.PANEL_FACE.centre.x, D.PANEL_FACE.centre.y, D.PANEL_FACE.centre.z))).toBeLessThan(1e-6);
      expect(du.length() / D.PANEL_CANVAS.w).toBeCloseTo(dv.length() / D.PANEL_CANVAS.h, 9);
      expect(du.length()).toBeCloseTo(D.PANEL_FACE.width, 6); expect(dv.length()).toBeCloseTo(D.PANEL_FACE.height, 6);
      expect(def.rotorcraftVisual!.panel.outline).toBe(D.PANEL_OUTLINE);
      const pivot = frd(...(def.cockpit.column as { pivot: readonly [number, number, number] }).pivot);
      D.SEAT_CENTRES.forEach((s, i) => {
        const cyclic = visual.root.getObjectByName(`s269Cyclic${i}`)!;
        expect(cyclic.getWorldPosition(new THREE.Vector3()).distanceTo(pivot.clone().add(new THREE.Vector3(s.y, 0, 0)))).toBeLessThan(1e-8);
      });
      expect(visual.cockpit.collectives).toHaveLength(2); expect(visual.cockpit.pedals).toHaveLength(4);
      D.SKID_DAMPERS.forEach((d, i) => {
        const oleo = visual.root.getObjectByName(`s269Oleo${i}`)!;
        expect(oleo.userData.upper).toEqual([d.upper.x, d.upper.y, d.upper.z]);
        expect(oleo.userData.lower).toEqual([d.lower.x, d.lower.y, d.lower.z]);
      });
      // Do not introduce hidden contacts below the skid datum. A small spline tessellation tolerance.
      const box = new THREE.Box3().setFromObject(visual.root.getObjectByName('s269Exterior')!);
      expect(box.min.y).toBeGreaterThanOrEqual(-D.SKID_Z - 0.002);
      // The open truss must stay out of the occupied torso/upper-leg volumes. A direct forward
      // crossbeam-to-mast diagonal previously cut through the cabin despite having valid endpoints.
      let frameIntrusions = 0;
      const point = new THREE.Vector3();
      visual.root.getObjectByName('s269Exterior')!.traverse(o => {
        if (!(o instanceof THREE.Mesh) || (o.material as THREE.Material).name !== 's269Frame') return;
        const p = o.geometry.getAttribute('position');
        for (const seat of def.cockpit.seats) for (let i = 0; i < p.count; i++) {
          point.fromBufferAttribute(p, i);
          if (-point.z > seat.x - seat.depth + 0.12 && -point.z < seat.x + 0.05
            && Math.abs(point.x - seat.y) < 0.13 && -point.y < seat.z! - 0.05 && -point.y > seat.z! - 0.65) frameIntrusions++;
        }
      });
      expect(frameIntrusions).toBe(0);
      ctx.cameraMode = 'cockpit'; visual.update(ctx);
      expect(visual.cockpit.group.getObjectByName('occupants')!.visible).toBe(false);
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
      visual.dispose(); disposed = true; spies.forEach(spy => expect(spy).toHaveBeenCalled());
    } finally { if (!disposed) visual.dispose(); vi.unstubAllGlobals(); }
  });
});
