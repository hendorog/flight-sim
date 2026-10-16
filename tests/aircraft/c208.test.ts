// Cessna 208 Caravan 675: the type's own checks beyond the conformance suite. The definition is a turboprop and
// what the panel and sound need of it agrees; the panel fits its face; and the whole aircraft (flight model, the
// PT6A on its fuel system and bus) starts from cold and dark with the POH sequence, idles, and stops again.

import { describe, expect, it } from 'vitest';
import C208_DEFINITION from '../../src/aircraft/c208/index';
import { C208_PANEL, C208_PANEL_PX_RECT } from '../../src/aircraft/c208/panel';
import C208_PRESENTATION from '../../src/aircraft/c208/presentation';
import { C208_MAX_NP, PT6A_114A } from '../../src/aircraft/c208/powerplant';
import { C208_REFERENCE } from '../../src/aircraft/c208/reference';
import { loadAircraft, loadPresentation } from '../../src/aircraft/registry';
import { setEngineControl } from '../../src/core/types';
import { buildHotspots } from '../../src/instruments/hotspots';
import { panelLayoutProblems } from '../../src/instruments/panelLayout';
import { CUTOFF_BELOW } from '../../src/physics/propulsion/turbineEngine';
import { SimPhysics } from '../../src/sim/SimPhysics';
import { at, calmWeather, makeRig, resetTo } from '../fdm/helpers';

describe('Cessna 208 Caravan 675', () => {
  it('is what the registry loads: the type itself, a free turbine with a constant-speed feathering propeller', async () => {
    expect(await loadAircraft('c208')).toBe(C208_DEFINITION);
    expect(await loadPresentation('c208')).toBe(C208_PRESENTATION);
    expect(C208_DEFINITION.placeholder).toBeUndefined();
    const install = C208_DEFINITION.powerplant.engines[0];
    expect(install.engine).toBe(PT6A_114A);
    expect(install.engine.kind).toBe('freeTurbine');
    expect(install.propeller.pitchControl.kind).toBe('constantSpeed');
    expect(C208_DEFINITION.reference).toBe(C208_REFERENCE);
    expect(C208_PRESENTATION.audio.engines[0].engine.combustion).toBe('turbine');
  });

  it('every gauge, switch and hotspot lies inside the face the cockpit shows, without overlap', () => {
    expect(panelLayoutProblems(C208_PANEL, C208_PANEL_PX_RECT, buildHotspots(C208_PANEL))).toEqual([]);
  });

  it('starts from cold and dark with the POH sequence, idles at 52 % Ng with the propeller out of feather, and shuts down', () => {
    const rig = makeRig({ def: C208_DEFINITION, loading: 'typical' });
    resetTo(rig, { onGround: true, position: at(0), engineRunning: false });
    const s = rig.fm.state, c = rig.controls;
    expect(s.engine.running).toBe(false);
    // Battery, fuel boost, ignition, power lever idle, condition lever cut-off; the propeller lever forward.
    c.masterBattery = true;
    c.alternator = true;
    c.fuelPump = true;
    c.fuelSelector = 'on';
    c.magnetos = 3;
    c.throttle = 0;
    c.propeller = 1;
    c.mixture = 0;
    c.parkingBrake = true;
    setEngineControl(c, 0, 'starter', true);
    let lightOff = NaN, peakItt = -Infinity, t = 0;
    rig.run(60, () => {
      t += 1 / 60;
      const e = s.engine;
      if (c.mixture < CUTOFF_BELOW && (e.ng ?? 0) >= 13) c.mixture = CUTOFF_BELOW;
      if (Number.isNaN(lightOff) && e.lit) lightOff = t;
      peakItt = Math.max(peakItt, e.itt ?? -Infinity);
      if (c.engines[0].starter && (e.ng ?? 0) >= 50) setEngineControl(c, 0, 'starter', false);
    });
    const e = s.engine;
    expect(lightOff).toBeGreaterThan(0);
    expect(peakItt).toBeGreaterThan(550);
    expect(peakItt).toBeLessThan(1090);
    expect(e.running).toBe(true);
    expect(e.ng).toBeGreaterThan(51);
    expect(e.ng).toBeLessThan(54);
    expect(e.propRpm).toBeGreaterThan(400);
    expect(e.propRpm).toBeLessThan(C208_MAX_NP);
    expect(s.propeller.feathered).toBe(false);
    expect(s.electrical.alternatorAmps).toBeGreaterThan(0);
    // Parked on the brake at low idle.
    expect(s.groundSpeed).toBeLessThan(0.1);
    // Condition lever to cut-off: the flame goes out, the gas generator runs down, the propeller feathers.
    c.mixture = 0;
    rig.run(90);
    expect(s.engine.lit).toBe(false);
    expect(s.engine.ng).toBeLessThan(5);
    expect(s.propeller.feathered).toBe(true);
  }, 60_000);

  it('a scenario reset after reverse puts the power lever forward of the gate (controlDefaults reverse 0)', () => {
    const sim = new SimPhysics({ aircraft: C208_DEFINITION, weather: calmWeather() });
    sim.reset('cruise');
    const trimmed = sim.controls.throttle;
    sim.controls.throttle = 0;
    sim.controls.reverse = 1;
    sim.reset('cruise');
    expect(sim.controls.reverse).toBe(0);
    expect(sim.controls.throttle).toBeCloseTo(trimmed, 6);
    expect(sim.controls.throttle).toBeGreaterThan(0.5);
  });
});
