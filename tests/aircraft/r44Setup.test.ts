// Groundwork contracts, not R44 aerodynamic/handling acceptance.
import * as THREE from 'three';
import { expect, it, vi } from 'vitest';
import { R44_DEFINITION as def } from '../../src/aircraft/r44';
import { R44_PRESENTATION as pres } from '../../src/aircraft/r44/presentation';
import { R44_MASS, R44_SOLO } from '../../src/aircraft/r44/mass';
import * as D from '../../src/aircraft/r44/dimensions';
import { R44_MAP } from '../../src/aircraft/r44/limits';
import { R22_ROTORCRAFT } from '../../src/aircraft/r22/rotorcraft';
import { aircraftSummary, loadAircraft, loadPresentation } from '../../src/aircraft/registry';
import { createMassModel } from '../../src/physics/massModel';
import { Rotorcraft } from '../../src/physics/rotorcraft/rotorcraft';
import { placardMap } from '../../src/physics/rotorcraft/limits';
import type { EngineUnit } from '../../src/physics/propulsion/engineUnit';
import { defaultControls } from '../../src/core/types';
import { FT, v3 } from '../../src/core/math';
import { panelLayoutProblems } from '../../src/instruments/panelLayout';
import { panelUvBasis } from '../../src/instruments/panelProjection';
import { AircraftVisual } from '../../src/render/aircraft/AircraftVisual';
import { blankDocument, fakeContext } from './meshChecks';
import { assertDefinitionConsistent } from './consistency';
import { SimPhysics } from '../../src/sim/SimPhysics';
import { parseSnapshot } from '../../src/sim/resume';
import { calmWeather } from '../fdm/helpers';

it('registers an explicitly unfinished R44 with its own geometry and presentation, hidden from the chooser', async () => {
  expect(await loadAircraft('r44')).toBe(def);
  expect(await loadPresentation('r44')).toBe(pres);
  expect(def.placeholder).toBe(true);
  expect(aircraftSummary('r44').available).toBe(false);
  assertDefinitionConsistent(def, pres, aircraftSummary('r44'));
  expect(def.rotorcraft!.main.hub).toBe(D.MAIN_HUB);
  expect(def.rotorcraft!.tail.hub).toBe(D.TAIL_HUB);
  expect(def.geometry.fuselage.pilotEye).toBe(D.PILOT_EYE);
  expect(pres.visual.cockpit.seats).toHaveLength(4);
  expect(pres.visual.cockpit.occupants).toEqual([{ seat: 1 }]);
  expect(def.input.has.carbHeat).toBe(false);
  expect(def.powerplant.engines[0].engine.metering.kind).toBe('rsaInjection');
  expect(def.powerplant.engines[0].engine.cylinders).toBe(6);
  expect(pres.audio.engines[0].engine.cylinders).toBe(6);
  expect(def.rotorcraft!.controlSystem).toEqual({ cyclic: 'hydraulic', collective: 'hydraulic', pedals: 'mechanical' });
  expect(D.MAIN_ROTOR_RADIUS * 2).toBeCloseTo(33 * 0.3048, 10);
  expect(D.TAIL_HUB.y).toBeLessThan(0);
  expect(D.MAIN_ROTOR_RADIUS - D.TAIL_HUB.x + D.TAIL_ROTOR_RADIUS).toBeCloseTo(D.OVERALL_LENGTH, 12);
});

it('keeps the placeholder panel layout, UV face, hubs and electrical lighting consistent', () => {
  expect(panelLayoutProblems(pres.panel)).toEqual([]);
  vi.stubGlobal('document', blankDocument());
  const ctx = fakeContext();
  const visual = new AircraftVisual({ airframe: pres.visual, panelDef: pres.panel, asyncBake: false });
  try {
    visual.init(ctx); visual.update(0, ctx); visual.root.updateMatrixWorld(true);
    expect(visual.root.getObjectByName('r44ExteriorDetails')).toBeDefined();
    const face = visual.getPanelMesh();
    const [origin, du, dv] = panelUvBasis(face.geometry)!;
    const point = origin.clone().addScaledVector(du, 0.5).addScaledVector(dv, 0.5);
    expect(face.localToWorld(point).distanceTo(new THREE.Vector3(D.PANEL_FACE.centre.y, -D.PANEL_FACE.centre.z, -D.PANEL_FACE.centre.x))).toBeLessThan(1e-6);
    expect(pres.panel.size).toBe(D.PANEL_CANVAS);
    expect(pres.visual.rotorcraftVisual!.panel.outline).toBe(D.PANEL_OUTLINE);
    ctx.state.electrical.busVoltage = 14; visual.update(0, ctx);
    expect((face.material as THREE.MeshStandardMaterial).emissive.r).toBe(0);
    ctx.state.electrical.busVoltage = 28; visual.update(0, ctx);
    expect((face.material as THREE.MeshStandardMaterial).emissive.r).toBeGreaterThan(0);
    visual.root.traverse(o => {
      if (o instanceof THREE.Mesh) expect(Array.from(o.geometry.getAttribute('position').array).every(Number.isFinite), o.name).toBe(true);
    });
  } finally { visual.dispose(); vi.unstubAllGlobals(); }
});

it('places solo payload at the right front arm and resolves four separate masses for inertia', () => {
  const tanks = def.powerplant.fuel.tanks;
  const model = createMassModel(R44_MASS, tanks);
  const solo = model.properties({ ...R44_SOLO, tanks: [0, 0] });
  const expected = v3.scale(v3.add(v3.scale(R44_MASS.emptyCg!, R44_MASS.empty),
    v3.scale(R44_SOLO.payloadPosition, R44_SOLO.payload)), 1 / (R44_MASS.empty + R44_SOLO.payload));
  expect(solo.cgOffset).toEqual(expected);
  const crew = model.properties({ ...R44_MASS.inertiaLoading, tanks: tanks.map(t => t.capacity) });
  for (const key of ['Ixx', 'Iyy', 'Izz', 'Ixz'] as const) expect(crew.inertia[key]).toBeCloseTo(R44_MASS.inertia[key], 10);
  const collapsed = model.properties({ ...R44_MASS.inertiaLoading, payloadDistribution: undefined, tanks: tanks.map(t => t.capacity) });
  expect(crew.cgOffset.x).toBeCloseTo(collapsed.cgOffset.x, 12);
  expect(crew.inertia.Iyy).toBeGreaterThan(collapsed.inertia.Iyy + 40);
  expect(crew.inertia.Ixx).toBeGreaterThan(collapsed.inertia.Ixx + 20);
});

it('uses aircraft-specific governor and warning thresholds rather than the R22 constants', () => {
  const d = { ...R22_ROTORCRAFT, referenceRpm: 400, engineRatio: 6,
    systems: { ...R22_ROTORCRAFT.systems, governorEngage: 0.7, lowRpmWarning: 0.95, hornCollectiveMin: 0.1 } };
  const rotor = new Rotorcraft(d), c = defaultControls(def);
  const shaft = { omega: 0, inertia: 1, get rpm() { return this.omega * 30 / Math.PI; },
    state: { rpm: 0, power: 0, manifoldPressure: 0 } };
  const engine = shaft as unknown as EngineUnit;
  c.throttle = 0.3; c.collective = 0.05;
  engine.omega = 0.72 * 400 * 6 * Math.PI / 30;
  rotor.throttle(0, c, engine); expect(rotor.state.governorActive).toBe(true);
  rotor.state.omega = 0.96 * 400 * Math.PI / 30;
  rotor.drive(0, c, engine); expect(rotor.state.lowRpm).toBe(false);
  rotor.state.omega = 0.94 * 400 * Math.PI / 30;
  rotor.drive(0, c, engine); expect(rotor.state.lowRpmHorn).toBe(false);
  c.collective = 0.11; rotor.drive(0, c, engine); expect(rotor.state.lowRpmHorn).toBe(true);
});

it('interpolates mixed MAP cells but leaves an all-full-throttle region unbounded', () => {
  // 10°C: 21.0 at 6000 ft and 20.6 at 8000 ft; extrapolate only toward a mixed FT corner.
  expect(placardMap(R44_MAP, 9000 * FT, 283.15)).toBeCloseTo(20.4, 10);
  expect(placardMap(R44_MAP, 11000 * FT, 283.15)).toBe(Infinity);
  expect(placardMap(R44_MAP, 12000 * FT, 283.15)).toBe(Infinity);
});

it('starts on the runway and restores R44 rotor systems through the shared saved-flight path', () => {
  const weather = calmWeather(), sim = new SimPhysics({ aircraft: def, weather });
  sim.reset('runway'); sim.step(0.1);
  expect(sim.state.onGround).toBe(true);
  expect(sim.state.crashed).toBe(false);
  expect(Number.isFinite(sim.state.rotorcraft!.rotorRpm)).toBe(true);
  const snap = sim.captureSnapshot({ weather, cameraMode: 'cockpit', quality: 'low', renderScale: null, resume: true });
  const parsed = parseSnapshot(JSON.stringify(snap));
  expect(parsed?.aircraft).toBe('r44');
  const copy = new SimPhysics({ aircraft: def, weather });
  copy.restore(parsed!);
  for (const key of ['omega', 'inflow', 'governorIntegral', 'clutchEngagement', 'clutchLight', 'governorActive', 'lowRpmHorn'] as const)
    expect(copy.state.rotorcraft![key]).toBe(snap.systems.rotorcraft![key]);
  const missing = structuredClone(snap);
  delete missing.systems.rotorcraft;
  expect(parseSnapshot(JSON.stringify(missing))).toBeNull();
});
