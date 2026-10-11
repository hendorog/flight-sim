// Setup boundaries and shared multi-blade/manual-throttle paths, not 300CB performance acceptance.
import * as THREE from 'three';
import { expect, it, vi } from 'vitest';
import { S269_DEFINITION as def } from '../../src/aircraft/s269';
import { S269_PRESENTATION as pres } from '../../src/aircraft/s269/presentation';
import * as D from '../../src/aircraft/s269/dimensions';
import { aircraftSummary, loadAircraft, loadPresentation } from '../../src/aircraft/registry';
import { defaultControls } from '../../src/core/types';
import { Rotorcraft } from '../../src/physics/rotorcraft/rotorcraft';
import type { EngineUnit } from '../../src/physics/propulsion/engineUnit';
import { panelLayoutProblems } from '../../src/instruments/panelLayout';
import { panelUvBasis } from '../../src/instruments/panelProjection';
import { AircraftVisual } from '../../src/render/aircraft/AircraftVisual';
import { bladeBlur } from '../../src/render/aircraft/bladeBlur';
import { emptyRotorcraftState } from '../../src/physics/rotorcraft/definition';
import { blankDocument, fakeContext } from './meshChecks';
import { assertDefinitionConsistent } from './consistency';
import { SimPhysics } from '../../src/sim/SimPhysics';
import { parseSnapshot } from '../../src/sim/resume';
import { calmWeather } from '../fdm/helpers';

it('loads the carburetted CB with consistent three-blade geometry/audio and a right pilot', async () => {
  expect(await loadAircraft('s269')).toBe(def);
  expect(await loadPresentation('s269')).toBe(pres);
  expect(aircraftSummary('s269').available).toBe(true);
  expect(def.placeholder).toBeUndefined();
  assertDefinitionConsistent(def, pres, aircraftSummary('s269'));
  expect(def.rotorcraft!.main.hub).toBe(D.MAIN_HUB);
  expect(def.rotorcraft!.tail.hub).toBe(D.TAIL_HUB);
  expect(def.rotorcraft!.main.blades).toBe(3);
  expect(pres.audio.engines[0].prop.blades).toBe(3);
  expect(pres.visual.cockpit.occupants).toEqual([{ seat: 1 }]);
  expect(def.geometry.fuselage.pilotEye).toBe(D.PILOT_EYE);
  expect(D.PILOT_EYE.y).toBeGreaterThan(0);
  expect(D.TAIL_HUB.y).toBeLessThan(0);
  expect(D.MAIN_ROTOR_RADIUS * 2).toBeCloseTo(26.83 * 0.3048, 10);
  expect(def.input.has.carbHeat).toBe(true);
  expect(def.powerplant.engines[0].engine.metering.kind).not.toBe('rsaInjection');
  expect(def.powerplant.fuel.tanks).toHaveLength(1);
  expect(pres.training.school?.syllabus).toBe(false);
});

it('keeps the physical blade spacing, panel face and mesh finite in the new render path', () => {
  expect(panelLayoutProblems(pres.panel)).toEqual([]);
  vi.stubGlobal('document', blankDocument());
  const ctx = fakeContext(), visual = new AircraftVisual({ airframe: pres.visual, panelDef: pres.panel, asyncBake: false });
  try {
    visual.init(ctx); visual.update(0, ctx); visual.root.updateMatrixWorld(true);
    expect(visual.root.getObjectByName('s269ArticulatedHead')).toBeDefined();
    const rotors: THREE.InstancedMesh[] = [];
    visual.root.traverse(o => { if (o instanceof THREE.InstancedMesh && o.name === 'rotorBlades') rotors.push(o); });
    expect(rotors.map(r => r.count)).toEqual([3, 2]);
    const m = new THREE.Matrix4(), tips = [0, 1, 2].map(i => {
      rotors[0].getMatrixAt(i, m);
      const tip = new THREE.Vector3(1, 0, 0).applyMatrix4(m);
      tip.y = 0; return tip.normalize(); // Compare azimuth spacing, independent of coning/droop.
    });
    for (let i = 0; i < 3; i++) expect(tips[i].dot(tips[(i + 1) % 3])).toBeCloseTo(-0.5, 3);
    ctx.state.rotorcraft = emptyRotorcraftState();
    for (const rpm of [0, 20, 30, 60, 120, 180, 250, 462, 120, 30, 0]) {
      ctx.state.rotorcraft.rotorRpm = rpm; ctx.state.rotorcraft.azimuth = 1.3;
      visual.update(0, ctx);
      rotors.forEach((rotor, i) => {
        const blades = i === 0 ? 3 : 2, shaftRpm = i === 0 ? rpm : rpm * def.rotorcraft!.tailRatio;
        const blur = bladeBlur(shaftRpm, blades), spin = rotor.parent!, group = spin.parent!;
        expect(rotor.count).toBe(blades); expect(rotor.instanceMatrix.count).toBe(blades);
        expect((rotor.material as THREE.Material).opacity).toBe(blur.solid);
        expect((rotor.material as THREE.Material).depthWrite).toBe(blur.solid === 1);
        expect(rotor.customDepthMaterial!.opacity).toBe(blur.solid);
        expect(rotor.castShadow).toBe(blur.solid > 0);
        expect(rotor.visible).toBe(blur.solid > 0);
        const trail = spin.getObjectByName('bladeTrail') as THREE.Mesh;
        expect(trail.visible).toBe(blur.trail > 0);
        expect((trail.material as THREE.Material).opacity).toBe(blur.trail);
        const disc = group.getObjectByName('rotorBlur') as THREE.Mesh;
        expect(disc.visible).toBe(blur.disc > 0);
        expect((disc.material as THREE.Material).opacity).toBe(blur.disc);
        if (i === 1) spin.children.filter(c => c.name === 's269TailGrip').forEach((cuff, blade) => {
          rotor.getMatrixAt(blade, m); expect(cuff.matrix.elements).toEqual(m.elements);
        });
      });
    }
    const face = visual.getPanelMesh(), [origin, du, dv] = panelUvBasis(face.geometry)!;
    const middle = origin.clone().addScaledVector(du, 0.5).addScaledVector(dv, 0.5);
    expect(face.localToWorld(middle).distanceTo(new THREE.Vector3(D.PANEL_FACE.centre.y, -D.PANEL_FACE.centre.z, -D.PANEL_FACE.centre.x))).toBeLessThan(1e-6);
    visual.root.traverse(o => {
      if (o instanceof THREE.Mesh) expect(Array.from(o.geometry.getAttribute('position').array).every(Number.isFinite), o.name).toBe(true);
    });
  } finally { visual.dispose(); vi.unstubAllGlobals(); }
});

it('cannot acquire a governor on a manual-throttle installation even with a stale saved switch on', () => {
  const r = new Rotorcraft(def.rotorcraft!), c = defaultControls(def);
  r.reset(false); c.rotorGovernor = true; c.masterBattery = true; c.throttle = 0.6;
  const e = { rpm: 2700 } as EngineUnit;
  r.throttle(1 / 240, c, e);
  expect(r.state.governorActive).toBe(false);
  expect(r.throttle(1, c, e)).toBe(0.6);
});

it('loads runway state and preserves the rotor systems in a saved s269 flight', () => {
  const weather = calmWeather(), sim = new SimPhysics({ aircraft: def, weather });
  sim.reset('runway'); sim.step(0.1);
  expect(sim.state.onGround).toBe(true); expect(sim.state.crashed).toBe(false);
  expect(Number.isFinite(sim.state.rotorcraft!.rotorRpm)).toBe(true);
  expect(sim.state.rotorcraft!.governorActive).toBe(false);
  const snap = sim.captureSnapshot({ weather, cameraMode: 'cockpit', quality: 'low', renderScale: null, resume: true });
  const parsed = parseSnapshot(JSON.stringify(snap));
  expect(parsed?.aircraft).toBe('s269');
  const copy = new SimPhysics({ aircraft: def, weather }); copy.restore(parsed!);
  for (const key of ['omega', 'inflow', 'clutchEngagement', 'clutchLight', 'governorActive', 'lowRpmHorn'] as const)
    expect(copy.state.rotorcraft![key]).toBe(snap.systems.rotorcraft![key]);
});
