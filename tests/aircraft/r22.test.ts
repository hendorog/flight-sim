import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { R22_VISUAL } from '../../src/aircraft/r22/visual';
import { MAIN_HUB, MAIN_ROTOR_RADIUS, PANEL_FACE, PANEL_CANVAS, PILOT_EYE, SKID_Z, TAIL_HUB } from '../../src/aircraft/r22/dimensions';
import { emptyRotorcraftState } from '../../src/physics/rotorcraft/definition';
import { AircraftVisual } from '../../src/render/aircraft/AircraftVisual';
import { frd } from '../../src/render/aircraft/geometry';
import { blankDocument, fakeContext } from './meshChecks';

const point = (p: { x: number; y: number; z: number }): THREE.Vector3 => frd(p.x, p.y, p.z);

describe('R22 procedural exterior and cockpit', () => {
  let visual: AircraftVisual;
  const ctx = fakeContext();
  beforeAll(() => {
    vi.stubGlobal('document', blankDocument());
    ctx.state.rotorcraft = emptyRotorcraftState();
    visual = new AircraftVisual({ airframe: R22_VISUAL, asyncBake: false });
    visual.init(ctx); visual.update(0, ctx); visual.root.updateMatrixWorld(true);
  });
  afterAll(() => { visual.dispose(); vi.unstubAllGlobals(); });

  it('uses the shared hub, right-seat eye and skid datum without aerodynamic geometry copies', () => {
    expect(visual.pilotEye.distanceTo(point(PILOT_EYE))).toBeLessThan(1e-12);
    expect(visual.root.getObjectByName('mainRotor')!.position.distanceTo(point(MAIN_HUB))).toBeLessThan(1e-12);
    const tail = visual.root.getObjectByName('tailRotor')!;
    expect(tail.position.distanceTo(point(TAIL_HUB))).toBeLessThan(1e-12);
    expect(tail.position.x).toBeLessThan(0);
    expect(R22_VISUAL.shadow.restHeight).toBe(SKID_Z);
    expect(R22_VISUAL.cockpit.occupants).toEqual([{ seat: 1 }]);
    expect(R22_VISUAL.rotorcraftVisual!.main.radius).toBe(MAIN_ROTOR_RADIUS);
    expect(R22_VISUAL.rotorcraftVisual!.panel.canvas).toEqual(PANEL_CANVAS);
  });

  it('maps the entire canvas onto the exact tilted face, including raycast UVs at all four corners', () => {
    const panel = visual.getPanelMesh();
    expect(panel.getWorldPosition(new THREE.Vector3()).distanceTo(point(PANEL_FACE.centre))).toBeLessThan(1e-12);
    const normal = new THREE.Vector3(0, 0, 1).transformDirection(panel.matrixWorld);
    const angle = PANEL_FACE.tiltBackDeg * Math.PI / 180;
    expect(normal.y).toBeCloseTo(Math.sin(angle), 12);
    expect(normal.z).toBeCloseTo(Math.cos(angle), 12);
    const g = panel.geometry; g.computeBoundingBox();
    const size = g.boundingBox!.getSize(new THREE.Vector3());
    expect(size.x).toBeCloseTo(PANEL_FACE.width, 6); expect(size.y).toBeCloseTo(PANEL_FACE.height, 6);
    for (const u of [0.001, 0.999]) for (const v of [0.001, 0.999]) {
      const target = panel.localToWorld(new THREE.Vector3((u - 0.5) * PANEL_FACE.width, (v - 0.5) * PANEL_FACE.height, 0));
      const hits = new THREE.Raycaster(target.clone().add(normal), normal.clone().negate()).intersectObject(panel);
      expect(hits.length).toBeGreaterThan(0); expect(hits[0].uv!.x).toBeCloseTo(u, 5); expect(hits[0].uv!.y).toBeCloseTo(v, 5);
    }
    const map = new THREE.Texture(), emissive = new THREE.Texture();
    visual.setPanelTexture(map); visual.setPanelEmissiveTexture(emissive);
    expect((panel.material as THREE.MeshStandardMaterial).map).toBe(map);
    expect((panel.material as THREE.MeshStandardMaterial).emissiveMap).toBe(emissive);
  });

  it('fits all panel corners and the horizon in the default right-seat view', () => {
    const camera = new THREE.PerspectiveCamera(R22_VISUAL.cockpit.defaultFovDeg, 16 / 9, 0.05, 1000);
    camera.position.copy(visual.pilotEye);
    camera.rotation.x = R22_VISUAL.cockpit.defaultPitchDeg * Math.PI / 180;
    camera.updateMatrixWorld(true);
    const panel = visual.getPanelMesh();
    for (const x of [-0.5, 0.5]) for (const y of [-0.5, 0.5]) {
      const p = panel.localToWorld(new THREE.Vector3(x * PANEL_FACE.width, y * PANEL_FACE.height, 0)).project(camera);
      expect(Math.abs(p.x)).toBeLessThan(0.95); expect(Math.abs(p.y)).toBeLessThan(0.95);
    }
    const horizon = visual.pilotEye.clone().add(new THREE.Vector3(0, 0, -500)).project(camera);
    expect(horizon.y).toBeLessThan(0.9); expect(horizon.y).toBeGreaterThan(0);
  });

  it('has finite, bounded meshes and shows a stopped rotor with two drooping blades', () => {
    visual.root.traverse(o => {
      if (!(o instanceof THREE.Mesh)) return;
      const p = o.geometry.getAttribute('position');
      expect(Array.from(p.array).every(Number.isFinite), o.name).toBe(true);
    });
    const rotor = visual.root.getObjectByName('mainRotor')!;
    const blades = rotor.getObjectByName('rotorBlades') as THREE.InstancedMesh;
    expect(blades.count).toBe(2);
    const m = new THREE.Matrix4(); blades.getMatrixAt(0, m);
    const tip = new THREE.Vector3(MAIN_ROTOR_RADIUS, 0, 0).applyMatrix4(m);
    expect(tip.y).toBeLessThan(0);
    expect(Math.abs(tip.length() - MAIN_ROTOR_RADIUS)).toBeLessThan(1e-6);
  });

  it('follows disc flapping, thrust coning, control travel, RPM blur and cockpit occupant visibility', () => {
    const r = ctx.state.rotorcraft!;
    Object.assign(r, { rotorRpm: 530, thrust: 5600, azimuth: 0.8, flapForward: 0.08, flapRight: -0.04 });
    Object.assign(ctx.controls, { collective: 0.7, throttle: 0.8, elevator: 0.3, aileron: -0.4, rudder: 0.5 });
    ctx.cameraMode = 'cockpit'; visual.update(0, ctx); visual.root.updateMatrixWorld(true);
    const rotor = visual.root.getObjectByName('mainRotor')!;
    const axis = new THREE.Vector3(0, 1, 0).applyQuaternion(rotor.quaternion);
    expect(axis.z).toBeLessThan(0); expect(axis.x).toBeLessThan(0);
    expect(rotor.getObjectByName('rotorAzimuth')!.rotation.y).toBe(0.8);
    expect(rotor.getObjectByName('rotorBlur')!.visible).toBe(true);
    const blades = rotor.getObjectByName('rotorBlades') as THREE.InstancedMesh;
    expect(blades.count).toBe(20); expect(blades.castShadow).toBe(false);
    const m = new THREE.Matrix4(); blades.getMatrixAt(0, m);
    expect(new THREE.Vector3(MAIN_ROTOR_RADIUS, 0, 0).applyMatrix4(m).y).toBeGreaterThan(0);
    expect(visual.root.getObjectByName('cyclic')!.rotation.x).not.toBe(0);
    expect(visual.root.getObjectByName('collective')!.rotation.x).toBeGreaterThan(0.3);
    expect(visual.root.getObjectByName('throttleGrip')!.rotation.z).not.toBe(0);
    expect(visual.root.getObjectByName('occupants')!.visible).toBe(false);
    ctx.cameraMode = 'chase'; ctx.quality = 'low'; visual.update(0, ctx);
    expect(visual.root.getObjectByName('occupants')!.visible).toBe(true);
  });
});
