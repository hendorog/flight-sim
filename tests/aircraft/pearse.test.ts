// Richard Pearse 1903 Waitohi Monoplane: definition, physics, gear stance, performance and 3D open-airframe tests.

import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import PEARSE_DEFINITION from '../../src/aircraft/pearse/index';
import PEARSE_PRESENTATION from '../../src/aircraft/pearse/presentation';
import { PEARSE_PANEL } from '../../src/aircraft/pearse/panel';
import { PEARSE_VISUAL } from '../../src/aircraft/pearse/visual';
import { aircraftSummary } from '../../src/aircraft/registry';
import { defaultWeather } from '../../src/core/types';
import { AIRPORT } from '../../src/core/world';
import { LandingGear } from '../../src/physics/gear';
import { AircraftVisual } from '../../src/render/aircraft/AircraftVisual';
import { SimPhysics } from '../../src/sim/SimPhysics';
import { assertDefinitionConsistent } from './consistency';
import { blankDocument, fakeContext, nonFinite } from './meshChecks';

describe('Richard Pearse 1903 Monoplane', () => {
  beforeAll(() => vi.stubGlobal('document', blankDocument()));
  afterAll(() => vi.unstubAllGlobals());

  it('agrees across definition, presentation and catalogue', () => {
    assertDefinitionConsistent(PEARSE_DEFINITION, PEARSE_PRESENTATION, aircraftSummary('pearse'));
    expect(aircraftSummary('pearse').available).toBe(true);
  });

  it('rests on its tricycle undercarriage at restHeight within 3 cm', () => {
    const gear = new LandingGear(PEARSE_DEFINITION.gear());
    const typMass = PEARSE_DEFINITION.mass.empty + PEARSE_DEFINITION.mass.loadings.typical.payload + 8.7;
    const pose = gear.restingPose(typMass, { x: 0.01, y: 0, z: 0.02 });
    expect(Math.abs(pose.height - PEARSE_DEFINITION.geometry.restHeight)).toBeLessThan(0.03);
    // Nearly level pioneer tricycle stance, with safe airscrew clearance above ground.
    expect(Math.abs((pose.pitch * 180) / Math.PI)).toBeLessThan(3.5);
    const propClearance = pose.height - PEARSE_DEFINITION.geometry.propellers[0].hub.z - PEARSE_DEFINITION.geometry.propellers[0].diameter / 2;
    expect(propClearance).toBeGreaterThan(0.2);
  });

  it('accelerates from rest on the 24 hp double-acting twin, lifts off near 31 kt and climbs cleanly', () => {
    const sim = new SimPhysics({ aircraft: PEARSE_DEFINITION, weather: { ...defaultWeather(), windSpeedKt: 0, turbulence: 0 } });
    sim.autoflightOnReset = true;
    sim.reset('runway');
    sim.step(30);
    const s = sim.state;
    expect(s.crashed, s.crashReason).toBe(false);
    expect(s.engine.running).toBe(true);
    expect(s.engine.rpm).toBeGreaterThan(850);
    expect(s.engine.rpm).toBeLessThan(1250);
    // Airborne and climbing out past 31 kt!
    expect(-s.position.z - AIRPORT.elevation).toBeGreaterThan(15);
    expect(s.ias * 1.943844).toBeGreaterThan(30);
    expect(s.ias * 1.943844).toBeLessThan(PEARSE_DEFINITION.reference.vne);

    // Trimmed 46 KIAS cruise stays squarely inside the 1150 rpm red line.
    sim.reset('cruise');
    sim.step(5);
    expect(sim.state.crashed).toBe(false);
    expect(sim.state.engine.rpm).toBeGreaterThan(850);
    expect(sim.state.engine.rpm).toBeLessThan(1150);
  });

  it('builds the Waitohi grid-wing, centre sail, diamond-paddle airscrew and thin spoked bicycle wheels', () => {
    const ctx = fakeContext(1);
    const visual = new AircraftVisual({ asyncBake: false, airframe: PEARSE_VISUAL, panelDef: PEARSE_PANEL });
    visual.setPanelEmissiveTexture(new THREE.Texture());
    visual.init(ctx);

    expect(nonFinite(visual.root)).toBe(0);
    const openFrame = visual.root.getObjectByName('pearseExterior');
    expect(openFrame).toBeDefined();
    expect(openFrame!.visible).toBe(true);

    // Enclosed cabin fuselage skin/glass are hidden so the open frame is unobstructed.
    const hiddenSkin = visual.root.getObjectByName('fuselageSkin');
    if (hiddenSkin) expect(hiddenSkin.visible).toBe(false);

    // Verify custom tubular frame, grid-wing, diamond-paddle and wire-rigging materials exist and animate cleanly.
    const matNames = new Set<string>();
    openFrame!.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      if (m && !Array.isArray(m) && m.name) matNames.add(m.name);
    });
    expect([...matNames]).toEqual(expect.arrayContaining(['pearseFrameSteel', 'pearseBamboo', 'pearsePaddle', 'pearseCastIron', 'pearseWire']));

    ctx.state.wheels[0].steerAngle = 0.2;
    ctx.state.wheels[0].rotation = 1.5;
    ctx.state.wheels[1].compression = 0.04;
    ctx.state.propellers[0].rotation = 1.1;
    ctx.state.propellers[0].rpm = 950;
    visual.update(1 / 60, ctx);
    expect(nonFinite(visual.root)).toBe(0);
    visual.dispose();
  });
});
