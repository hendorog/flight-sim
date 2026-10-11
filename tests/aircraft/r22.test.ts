import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { panelUvBasis } from '../../src/instruments/panelProjection';
import { buildHotspots, hotspotAt } from '../../src/instruments/hotspots';
import { R22_PANEL } from '../../src/aircraft/r22/panel';
import { R22_VISUAL } from '../../src/aircraft/r22/visual';
import { MAIN_HUB, MAIN_ROTOR_RADIUS, PANEL_FACE, PANEL_CANVAS, PILOT_EYE, SKID_Z, TAIL_HUB } from '../../src/aircraft/r22/dimensions';
import { emptyRotorcraftState } from '../../src/physics/rotorcraft/definition';
import { AircraftVisual } from '../../src/render/aircraft/AircraftVisual';
import { createFuselageShapes, sectionHalfWidth } from '../../src/render/aircraft/fuselage';
import { frd } from '../../src/render/aircraft/geometry';
import { rotorBladeGeometry } from '../../src/render/aircraft/rotorcraft/rotor';
import { blankDocument, fakeContext } from './meshChecks';

const point = (p: { x: number; y: number; z: number }): THREE.Vector3 => frd(p.x, p.y, p.z);

describe('R22 procedural exterior and cockpit', () => {
  let visual: AircraftVisual;
  const ctx = fakeContext();
  beforeAll(() => {
    vi.stubGlobal('document', blankDocument());
    ctx.state.rotorcraft = emptyRotorcraftState();
    visual = new AircraftVisual({ airframe: R22_VISUAL, panelDef: R22_PANEL, asyncBake: false });
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

  it('puts each rotor leading edge into its own direction of rotation', () => {
    const d = R22_VISUAL.rotorcraftVisual!;
    const main = rotorBladeGeometry(d.main);
    const tail = rotorBladeGeometry({ ...d.tail, chord: [d.tail.chord, d.tail.chord], twist: 0, tail: true });
    expect(main.getAttribute('position').getZ(0)).toBeLessThan(0); // positive rotation about local +Y
    expect(tail.getAttribute('position').getZ(0)).toBeGreaterThan(0); // negative rotation about local +Y
    main.dispose(); tail.dispose();
  });

  it('maps every control onto the shaped face with correct raycast UVs from the pilot eye', () => {
    const panel = visual.getPanelMesh();
    expect(panel.name).toBe('instrumentPanel'); // CockpitClicks discovers the face by this name.
    expect(panel.getWorldPosition(new THREE.Vector3()).distanceTo(point(PANEL_FACE.centre))).toBeLessThan(1e-12);
    const normal = new THREE.Vector3(0, 0, 1).transformDirection(panel.matrixWorld);
    const angle = PANEL_FACE.tiltBackDeg * Math.PI / 180;
    expect(normal.y).toBeCloseTo(Math.sin(angle), 12);
    expect(normal.z).toBeCloseTo(Math.cos(angle), 12);
    const g = panel.geometry; g.computeBoundingBox();
    const size = g.boundingBox!.getSize(new THREE.Vector3());
    expect(size.x).toBeCloseTo(PANEL_FACE.width, 6); expect(size.y).toBeCloseTo(PANEL_FACE.height, 6);
    const spots = buildHotspots(R22_PANEL);
    const [origin, du, dv] = panelUvBasis(g)!;
    for (const spot of spots) for (const dx of [-spot.hw, 0, spot.hw]) for (const dy of [-spot.hh, 0, spot.hh]) {
      const u = (spot.x + dx) / PANEL_CANVAS.w, v = 1 - (spot.y + dy) / PANEL_CANVAS.h;
      const target = panel.localToWorld(new THREE.Vector3((u - 0.5) * PANEL_FACE.width, (v - 0.5) * PANEL_FACE.height, 0));
      const mapped = panel.localToWorld(origin.clone().addScaledVector(du, u).addScaledVector(dv, v));
      expect(mapped.distanceTo(target), spot.id).toBeLessThan(1e-6);
      const ray = new THREE.Raycaster(visual.pilotEye, target.clone().sub(visual.pilotEye).normalize());
      const hits = ray.intersectObject(panel);
      expect(hits.length, spot.id).toBeGreaterThan(0);
      expect(hits[0].uv!.x).toBeCloseTo(u, 5); expect(hits[0].uv!.y).toBeCloseTo(v, 5);
      if (dx === 0 && dy === 0) expect(hotspotAt(hits[0].uv!.x * PANEL_CANVAS.w, (1 - hits[0].uv!.y) * PANEL_CANVAS.h, spots)?.id).toBe(spot.id);
    }
    // The old slab's lower outer corners are empty space beside the narrow pedestal.
    for (const u of [0.01, 0.99]) {
      const target = panel.localToWorld(new THREE.Vector3((u - 0.5) * PANEL_FACE.width, -0.45 * PANEL_FACE.height, 0));
      expect(new THREE.Raycaster(target.clone().add(normal), normal.clone().negate()).intersectObject(panel)).toHaveLength(0);
    }
    const map = new THREE.Texture(), emissive = new THREE.Texture();
    visual.setPanelTexture(map); visual.setPanelEmissiveTexture(emissive);
    expect((panel.material as THREE.MeshStandardMaterial).map).toBe(map);
    expect((panel.material as THREE.MeshStandardMaterial).emissiveMap).toBe(emissive);
  });

  it.each([16 / 9, 4 / 3])('fits the panel and horizon in the default right-seat view at aspect %s', aspect => {
    const camera = new THREE.PerspectiveCamera(R22_VISUAL.cockpit.defaultFovDeg, aspect, 0.05, 1000);
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

  it('keeps the enclosure inside the cabin bubble', () => {
    const glass = createFuselageShapes(R22_VISUAL).glass;
    const housing = visual.root.getObjectByName('consoleHousing') as THREE.Mesh;
    const pos = housing.geometry.getAttribute('position');
    let clearance = Infinity;
    for (let i = 0; i < pos.count; i++) {
      const p = visual.root.worldToLocal(housing.localToWorld(new THREE.Vector3().fromBufferAttribute(pos, i)));
      clearance = Math.min(clearance, sectionHalfWidth(glass, -p.z, -p.y) - Math.abs(p.x));
    }
    expect(clearance).toBeGreaterThan(0.005);
  });

  it('leaves the seven flight instruments visible behind the hood and poses the cabin controls', () => {
    const panel = visual.getPanelMesh(), pod = panel.parent!;
    expect(pod.getObjectByName('consoleHood')).toBeDefined();
    expect(pod.getObjectByName('pedestalHousing')).toBeDefined();
    visual.root.updateMatrixWorld(true);
    for (const g of R22_PANEL.gauges.slice(0, 7)) {
      if (!('at' in g)) throw new Error('Expected a round flight instrument');
      const target = panel.localToWorld(new THREE.Vector3((g.at[0] / PANEL_CANVAS.w - 0.5) * PANEL_FACE.width,
        (0.5 - g.at[1] / PANEL_CANVAS.h) * PANEL_FACE.height, 0));
      const ray = new THREE.Raycaster(visual.pilotEye, target.clone().sub(visual.pilotEye).normalize());
      expect(ray.intersectObject(pod, true)[0].object, g.id).toBe(panel);
    }
    const compass = visual.root.getObjectByName('compassCard')!;
    const governor = visual.root.getObjectByName('governorSwitch')!;
    const heat = visual.root.getObjectByName('carbHeatPullControl')!;
    ctx.state.heading = 1.2; ctx.controls.rotorGovernor = true; ctx.controls.carbHeat = 0;
    visual.update(0, ctx); const pushed = heat.position.z, on = governor.rotation.x;
    expect(compass.rotation.y).toBeCloseTo(1.2);
    ctx.controls.rotorGovernor = false; ctx.controls.carbHeat = 1; visual.update(0, ctx);
    expect(governor.rotation.x).toBeGreaterThan(on);
    expect(heat.position.z).toBeGreaterThan(pushed);
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
    // Rigid coning preserves hinge-to-tip length. The pin is offset from the shaft, so
    // shaft-to-tip distance changes slightly; additional elastic sag lives in the geometry.
    const hinge = new THREE.Vector3(R22_VISUAL.rotorcraftVisual!.main.coning.hingeRadius, 0, 0);
    expect(hinge.clone().applyMatrix4(m).distanceTo(hinge)).toBeLessThan(1e-7);
    expect(Math.abs(tip.distanceTo(hinge) - (MAIN_ROTOR_RADIUS - hinge.x))).toBeLessThan(1e-6);
  });

  it('powers the nose lamps and panel from the 14 V bus and keeps the absent second strobe dark', () => {
    ctx.state.electrical.busVoltage = 14;
    ctx.controls.lights.landing = true; ctx.controls.lights.panel = 1;
    visual.update(0, ctx);
    const lights = visual.root.getObjectByName('aircraftLights')!;
    const spots: THREE.SpotLight[] = [], flashes: THREE.PointLight[] = [];
    lights.traverse(o => { if (o instanceof THREE.SpotLight) spots.push(o); if (o instanceof THREE.PointLight) flashes.push(o); });
    expect(spots[0].intensity).toBeGreaterThan(0);
    expect(spots[1].intensity).toBeGreaterThan(0);
    expect(flashes.filter(l => l.visible)).toHaveLength(2); // one strobe, one beacon
    expect((visual.getPanelMesh().material as THREE.MeshStandardMaterial).emissive.r).toBeGreaterThan(0);
    ctx.state.electrical.busVoltage = 0; visual.update(0, ctx);
    expect(spots[0].intensity).toBe(0);
    expect((visual.getPanelMesh().material as THREE.MeshStandardMaterial).emissive.r).toBe(0);
  });

  it('follows disc flapping, thrust coning, control travel, RPM blur and cockpit occupant visibility', () => {
    const r = ctx.state.rotorcraft!;
    Object.assign(r, { rotorRpm: 530, thrust: 5600, azimuth: 0.8, flapForward: 0.08, flapRight: -0.04 });
    Object.assign(ctx.controls, { collective: 0.7, throttle: 0.8, elevator: 0.3, aileron: -0.4, rudder: 0.5 });
    ctx.cameraMode = 'cockpit'; visual.update(0, ctx); visual.root.updateMatrixWorld(true);
    const rotor = visual.root.getObjectByName('mainRotor')!;
    const axis = new THREE.Vector3(0, 1, 0).applyQuaternion(rotor.quaternion);
    expect(axis.z / axis.y).toBeCloseTo(-r.flapForward, 12);
    expect(axis.x / axis.y).toBeCloseTo(r.flapRight, 12);
    expect(rotor.getObjectByName('rotorAzimuth')!.rotation.y).toBe(0.8);
    expect(rotor.getObjectByName('rotorBlur')!.visible).toBe(true);
    const blades = rotor.getObjectByName('rotorBlades') as THREE.InstancedMesh;
    expect(blades.count).toBe(2); expect(blades.visible).toBe(false); expect(blades.castShadow).toBe(false);
    const m = new THREE.Matrix4(); blades.getMatrixAt(0, m);
    expect(new THREE.Vector3(MAIN_ROTOR_RADIUS, 0, 0).applyMatrix4(m).y).toBeGreaterThan(0);
    expect(visual.root.getObjectByName('cyclic')!.rotation.x).not.toBe(0);
    expect(visual.root.getObjectByName('collective')!.rotation.x).toBeGreaterThan(0.3);
    expect(visual.root.getObjectByName('throttleGrip')!.rotation.z).not.toBe(0);
    const pedals: THREE.Object3D[] = []; visual.root.traverse(o => { if (o.name === 'pedal') pedals.push(o); });
    expect(pedals[1].position.z).toBeLessThan(pedals[0].position.z);
    expect(visual.root.getObjectByName('occupants')!.visible).toBe(false);
    ctx.cameraMode = 'chase'; ctx.quality = 'low'; visual.update(0, ctx);
    expect(visual.root.getObjectByName('occupants')!.visible).toBe(true);
  });
});
