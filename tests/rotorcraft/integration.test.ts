import { describe, expect, it } from 'vitest';
import { SimPhysics } from '../../src/sim/SimPhysics';
import { R22_DEFINITION } from '../../src/aircraft/r22';
import { createFlightModelFor } from '../../src/physics';
import { cloneControls, defaultWeather } from '../../src/core/types';
import { calmWeather, flatEnvironment } from '../fdm/helpers';
import { parseSnapshot } from '../../src/sim/resume';
import { quat, v3 } from '../../src/core/math';
import { RotorcraftVisual } from '../../src/render/aircraft/RotorcraftVisual';
import { R22_ROTORCRAFT } from '../../src/aircraft/r22/rotorcraft';

const env = flatEnvironment(undefined, 0);
describe('R22 simulation integration', () => {
  it('initialises forward-flight scenarios with a force-balanced trim', () => {
    const fm = createFlightModelFor(R22_DEFINITION);
    for (const speed of [15, 30, 40]) {
      fm.reset({ position: { x: 0, y: 0, z: -300 }, heading: 1, airspeed: speed, onGround: false, engineRunning: true }, env);
      expect(fm.lastTrim?.converged, `TAS ${speed}`).toBe(true);
      expect(fm.lastTrim!.residual).toBeLessThan(0.001);
      const c = cloneControls(fm.trimControls);
      for (let i = 0; i < 240; i++) fm.step(1/240, c, env);
      expect(fm.state.crashed).toBe(false);
      expect(Math.abs(fm.state.verticalSpeed)).toBeLessThan(1);
    }
  });
  it('lifts off by collective with zero forward airspeed', () => {
    const fm = createFlightModelFor(R22_DEFINITION);
    fm.reset({ position: { x: 0, y: 0, z: 0 }, heading: 0, airspeed: 0, onGround: true, engineRunning: true }, env);
    const c = cloneControls(fm.trimControls); c.collective = 0.57; c.rudder = -0.15;
    for (let i = 0; i < 240; i++) fm.step(1/240, c, env);
    expect(fm.state.onGround).toBe(false);
    expect(fm.state.altitudeAGL).toBeGreaterThan(1);
    expect(fm.state.verticalSpeed).toBeGreaterThan(0);
    expect(fm.state.crashed).toBe(false);
  });
  it('preserves rotor/inflow/governor and controls through a validated saved flight', () => {
    const weather = calmWeather();
    const sim = new SimPhysics({ aircraft: R22_DEFINITION, weather });
    sim.reset('cruise'); sim.controls.collective! += 0.03; sim.step(0.25);
    const snap = sim.captureSnapshot({weather, cameraMode:'cockpit', quality:'low', renderScale:null, resume:true});
    const parsed = parseSnapshot(JSON.stringify(snap)); expect(parsed).not.toBeNull();
    const copy = new SimPhysics({ aircraft: R22_DEFINITION, weather });
    copy.restore(parsed!);
    // Re-publishing recomputes instantaneous loads; dynamic states must not be advanced by restore.
    for (const key of ['omega','azimuth','inflow','tailInflow','flapForward','flapRight','governorThrottle'] as const)
      expect(copy.state.rotorcraft![key]).toBe(snap.systems.rotorcraft![key]);
    expect(copy.controls.collective).toBe(sim.controls.collective);
    copy.setAutoflight(true); expect(copy.autoflight.engaged).toBe(false);
    copy.step(0.1); expect(Number.isFinite(copy.state.rotorcraft!.rotorRpm)).toBe(true);
    const corrupt = structuredClone(snap); corrupt.systems.rotorcraft!.omega = -1;
    expect(parseSnapshot(JSON.stringify(corrupt))).toBeNull();
  });
  it('starts cold, spins up through the clutch, and preserves a stopped rotor until engagement', () => {
    const fm = createFlightModelFor(R22_DEFINITION);
    fm.reset({ position:{x:0,y:0,z:0}, heading:0, airspeed:0, onGround:true, engineRunning:false }, env);
    const c = cloneControls(fm.trimControls);
    c.rotorClutch = false; c.rotorGovernor = false; c.throttle = 0.1; c.mixture = 1;
    c.magnetos = 3; c.masterBattery = true; c.starter = true;
    for(let i=0;i<8*240;i++) fm.step(1/240,c,env);
    expect(fm.state.engine.running).toBe(true);
    expect(fm.state.rotorcraft!.rotorRpm).toBeLessThan(0.001);
    c.starter = false; c.rotorClutch = true; c.rotorGovernor = true; c.throttle = 1;
    for(let i=0;i<20*240;i++) fm.step(1/240,c,env);
    expect(fm.state.rotorcraft!.rotorRpm).toBeGreaterThan(500);
    expect(fm.state.rotorcraft!.rotorRpm).toBeLessThan(550);
    expect(fm.state.crashed).toBe(false);
  });
  it('detects an inverted cabin/rotor impact', () => {
    const fm = createFlightModelFor(R22_DEFINITION);
    fm.reset({ position: { x: 0, y: 0, z: -10 }, heading: 0, airspeed: 0, onGround: false, engineRunning: true }, env);
    fm.setKinematics({position:{x:0,y:0,z:-0.3},orientation:quat.fromEuler(Math.PI,0,0),velocity:v3.zero(),angularVelocity:v3.zero()});
    expect(fm.state.crashed).toBe(true);
  });
  it('builds a separate helicopter exterior with rotating main and tail assemblies', () => {
    const visual = new RotorcraftVisual(R22_ROTORCRAFT);
    expect(visual.main.children).toHaveLength(1);
    expect(visual.tail.children).toHaveLength(1);
    expect(visual.panel.geometry.parameters.width).toBeLessThan(1);
    visual.dispose();
  });
});
