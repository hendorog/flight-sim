import { describe, expect, it } from 'vitest';
import { Rotorcraft } from '../../src/physics/rotorcraft/rotorcraft';
import { R22_ROTORCRAFT as d } from '../../src/aircraft/r22/rotorcraft';
import { R22_DEFINITION } from '../../src/aircraft/r22';
import { defaultControls, cloneControls } from '../../src/core/types';
import { quat, v3 } from '../../src/core/math';
import type { BodyState } from '../../src/physics/interfaces';
import { createFlightModelFor } from '../../src/physics';
import { flatEnvironment } from '../fdm/helpers';
import { makeInputRig } from '../input/testbed';
import { R22_INPUT } from '../../src/aircraft/r22/input';
import { C152_INPUT } from '../../src/aircraft/c152/input';
import { bladeElements } from '../../src/physics/rotorcraft/rotor';

const body = (speed = 0): BodyState => ({ time: 0, position: { x: 0, y: 0, z: -100 }, orientation: quat.identity(),
  velocityBody: { x: speed, y: 0, z: 0 }, angularVelocity: v3.zero(), cgOffset: v3.zero(), mass: 615 });
function held(height = 100, speed = 0, collective = 0.5, rho = 1.225) {
  const r = new Rotorcraft(d); r.reset(true); r.state.rotorRpm = d.nominalRpm;
  const c = defaultControls(R22_DEFINITION); c.collective = collective;
  r.settle(body(speed), v3.zero(), rho, height, c);
  return { r, c };
}
const env = flatEnvironment(undefined, 0);
function flight() {
  const fm = createFlightModelFor(R22_DEFINITION, { structuralFailure: false });
  fm.reset({ position: { x: 0, y: 0, z: -100 }, heading: 0, airspeed: 0, onGround: false, engineRunning: true }, env);
  return { fm, c: cloneControls(fm.trimControls) };
}
const run = (f: ReturnType<typeof flight>, seconds: number) => { for (let i = 0; i < seconds * 240; i++) f.fm.step(1/240, f.c, env); };

describe('rotor mechanisms', () => {
  it('collective increases lift and shaft load; density reduces lift', () => {
    const low = held(100, 0, 0.4).r.state, high = held(100, 0, 0.6).r.state;
    expect(high.thrust).toBeGreaterThan(low.thrust * 1.3);
    expect(high.torque).toBeGreaterThan(low.torque);
    expect(held(100, 0, 0.6, 0.8).r.state.thrust).toBeLessThan(high.thrust * 0.8);
  });
  it('ground effect and translational lift reduce induced losses', () => {
    const oge = held().r.state, ige = held(0.9).r.state, forward = held(100, 15).r.state;
    expect(ige.inflow).toBeLessThan(oge.inflow);
    expect(ige.thrust).toBeGreaterThan(oge.thrust);
    expect(forward.inflow).toBeLessThan(oge.inflow);
    expect(forward.thrust).toBeGreaterThan(oge.thrust);
  });
  it('azimuth and radial refinement converge for hover and forward flight', () => {
    for (const speed of [0, 30]) {
      const a = bladeElements(d.main, 55.5, 0.13, 0, speed, 6, 1.225);
      const b = bladeElements(d.main, 55.5, 0.13, 0, speed, 6, 1.225, 48, 64);
      expect(Math.abs(a.thrust / b.thrust - 1)).toBeLessThan(0.03);
      expect(Math.abs(a.torque / b.torque - 1)).toBeLessThan(0.03);
    }
  });
  it('cyclic and pedals produce the commanded roll, pitch and yaw signs', () => {
    const roll = flight(); roll.c.aileron += 0.15; run(roll, 0.3);
    expect(roll.fm.state.angularVelocity.x).toBeGreaterThan(0.02);
    const pitch = flight(); pitch.c.elevator += 0.15; run(pitch, 0.3);
    expect(pitch.fm.state.angularVelocity.y).toBeGreaterThan(0.01);
    const yaw = flight(); yaw.c.rudder += 0.15; run(yaw, 0.3);
    expect(yaw.fm.state.angularVelocity.z).toBeGreaterThan(0.02);
  });
  it('an abrupt collective increase draws rotor kinetic energy before the governor responds', () => {
    const f = flight(); f.c.collective! += 0.2; run(f, 0.2);
    expect(f.fm.state.rotorcraft!.rotorRpm).toBeLessThan(530);
    expect(f.fm.state.verticalSpeed).toBeGreaterThan(0.1);
  });
  it('engine failure opens the freewheel and lowering collective preserves RPM', () => {
    const high = flight(), low = flight();
    high.c.mixture = low.c.mixture = 0; low.c.collective = 0;
    run(high, 1); run(low, 1);
    expect(high.fm.state.rotorcraft!.driveTorque).toBe(0);
    expect(high.fm.state.rotorcraft!.rotorRpm).toBeLessThan(520);
    expect(low.fm.state.rotorcraft!.rotorRpm).toBeGreaterThan(high.fm.state.rotorcraft!.rotorRpm + 10);
    expect(high.fm.state.engine.rpm / d.engineRatio).toBeLessThan(high.fm.state.rotorcraft!.rotorRpm);
  });
  it('retains a trimmed hover over ten seconds without an attitude hold', () => {
    const f = flight(); run(f, 10);
    expect(Math.abs(f.fm.state.verticalSpeed)).toBeLessThan(0.5);
    expect(Math.abs(f.fm.state.roll)).toBeLessThan(0.15);
    expect(f.fm.state.rotorcraft!.rotorRpm).toBeGreaterThan(510);
    expect(f.fm.state.rotorcraft!.rotorRpm).toBeLessThan(550);
  });
});

describe('helicopter controls', () => {
  it('holds F5/F6 to move collective independently of throttle and flaps', () => {
    const r = makeInputRig(R22_INPUT, { collective: 0.3, throttle: 0.7 });
    r.tap('F6', false, 1); expect(r.c.collective).toBeCloseTo(0.45, 4);
    r.tap('F5', false, 2); expect(r.c.collective).toBeCloseTo(0.15, 4);
    expect(r.c.throttle).toBe(0.7); expect(r.c.flaps).toBe(0);
    r.tap('Insert'); expect(r.c.rotorClutch).toBe(true);
    r.tap('Delete'); expect(r.c.rotorGovernor).toBe(true);
  });
  it('does not add rotor controls to an airplane', () => {
    const r = makeInputRig(C152_INPUT);
    r.tap('Insert'); r.tap('Delete');
    expect(r.c.rotorClutch).toBeUndefined(); expect(r.c.rotorGovernor).toBeUndefined();
    r.tap('F6'); expect(r.c.flaps).toBeCloseTo(1/3);
  });
});
