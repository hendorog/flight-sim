import { describe, expect, it } from 'vitest';
import { Rotorcraft } from '../../src/physics/rotorcraft/rotorcraft';
import { R22_ROTORCRAFT as d } from '../../src/aircraft/r22/rotorcraft';
import { R22_DEFINITION } from '../../src/aircraft/r22';
import { defaultControls } from '../../src/core/types';
import { DEG, HP, KT, quat, v3 } from '../../src/core/math';
import type { BodyState } from '../../src/physics/interfaces';
import type { EngineUnit } from '../../src/physics/propulsion/engineUnit';
import { rig, run } from './helpers';

const body = (): BodyState => ({ time: 0, position: { x: 0, y: 0, z: -1000 }, orientation: quat.identity(),
  velocityBody: v3.zero(), angularVelocity: v3.zero(), cgOffset: v3.zero(), mass: 621.42 });
const shaft = (rpm: number): EngineUnit => {
  const e = { omega: rpm * Math.PI / 30, inertia: 0.5,
    get rpm() { return this.omega * 30 / Math.PI; }, state: { rpm, power: 0 } };
  return e as unknown as EngineUnit;
};

describe('R22 rotor energy, controls and damage', () => {
  it('sprag opens for a slower engine and cannot back-drive it; belt coupling dissipates slip energy', () => {
    const r = new Rotorcraft(d), c = defaultControls(R22_DEFINITION), e = shaft(2000);
    r.reset(true); const omega = e.omega;
    r.drive(1/240, c, e);
    expect(e.omega).toBe(omega); expect(r.state.driveTorque).toBe(0);
    e.omega = 2900 * Math.PI / 30;
    const inertia = d.main.inertia + d.tail.inertia * d.tailRatio ** 2;
    const before = e.inertia * e.omega ** 2 / 2 + inertia * r.state.omega ** 2 / 2;
    r.drive(1/240, c, e);
    const after = e.inertia * e.omega ** 2 / 2 + inertia * r.state.omega ** 2 / 2;
    expect(r.state.driveTorque).toBeGreaterThan(0); expect(after).toBeLessThan(before);
  });

  it('governor threshold is 80% engine tach; grip override and collective correlation work independently', () => {
    const r = new Rotorcraft(d), c = defaultControls(R22_DEFINITION), e = shaft(0.79 * 2550);
    r.reset(false); c.throttle = 0.2;
    r.throttle(0.1, c, e); expect(r.state.governorActive).toBe(false);
    e.omega = 0.81 * 2550 * Math.PI / 30;
    r.throttle(0.1, c, e); expect(r.state.governorActive).toBe(true);
    c.rotorGovernor = false;
    const before = r.throttle(0.1, c, e); c.collective = 0.2;
    expect(r.throttle(0.1, c, e)).toBeGreaterThan(before);
    c.rotorGovernor = true; c.throttle = 0;
    expect(r.throttle(0.1, c, e)).toBe(0);
    c.collective = 1; expect(r.throttle(0.1, c, e)).toBe(0);
  });

  it('97% low-RPM horn is inhibited only at full-down collective or with battery off', () => {
    const r = new Rotorcraft(d), c = defaultControls(R22_DEFINITION), e = shaft(0);
    r.reset(false); c.collective = 0.1;
    r.state.omega = 0.96 * d.referenceRpm * Math.PI / 30;
    r.drive(0, c, e); expect(r.state.lowRpmHorn).toBe(true);
    c.collective = 0; r.drive(0, c, e); expect(r.state.lowRpmHorn).toBe(false);
    c.collective = 0.1; c.masterBattery = false;
    r.drive(0, c, e); expect(r.state.lowRpmHorn).toBe(false);
  });

  it('124 hp continuous / 131 hp five-minute limits report exceedance without an invented engine power cut', () => {
    const r = new Rotorcraft(d), c = defaultControls(R22_DEFINITION), e = shaft(0);
    r.reset(true); e.state.power = 128 * HP;
    r.drive(299, c, e); expect(r.state.powerLimitExceeded).toBe(false);
    r.drive(2, c, e); expect(r.state.powerLimitExceeded).toBe(true);
    e.state.power = 120 * HP; r.drive(1, c, e);
    expect(r.state.takeoffPowerSeconds).toBe(0); expect(r.state.powerLimitExceeded).toBe(false);
    e.state.power = 134 * HP; r.drive(0.1, c, e); expect(r.state.powerLimitExceeded).toBe(true);
  });

  it('a low-G pushover rolls right from the elevated tail thrust line and loses cyclic control power', () => {
    const flight = rig(65), initialRoll = flight.fm.state.roll;
    flight.c.collective = 0.05; flight.c.elevator = -1;
    run(flight, 0.3);
    expect(flight.fm.state.gLoad).toBeLessThan(0.2);
    expect(flight.fm.state.angularVelocity.x).toBeGreaterThan(0);
    expect(flight.fm.state.roll).toBeGreaterThan(initialRoll);
    const response = (collective: number, roll: number) => {
      const r = new Rotorcraft(d), c = defaultControls(R22_DEFINITION), b = body(); r.reset(true);
      c.collective = collective; c.aileron = roll; c.rudder = -0.3;
      const f = r.settle(b, v3.zero(), 1.225, 1000, c);
      return f.moment.x;
    };
    const low = response(0, 0.1) - response(0, 0), high = response(0.5, 0.1) - response(0.5, 0);
    expect(low).toBeGreaterThan(0); expect(low).toBeLessThan(high * 0.4);
  });

  it('excess rotor-to-mast teeter angle is latched and reported as crash damage', () => {
    const r = rig(65), s = r.fm.state;
    r.c.collective = 0;
    // An imposed already-developed body roll while the rotor is unloaded isolates the contact mechanism.
    r.fm.setKinematics({ position: s.position, orientation: s.orientation, velocity: s.velocity,
      angularVelocity: { x: 4, y: 0, z: 0 } });
    r.c.aileron = -1; run(r, 0.3);
    expect(r.fm.state.rotorcraft!.mastBump).toBe(true);
    expect(r.fm.state.crashed).toBe(true);
    expect(r.fm.state.crashReason).toContain('teeter stop');
  });

  it('coning and transverse flow create lateral flapping; heavy high-speed retreating-blade stall adds blowback', () => {
    const r = new Rotorcraft(d), c = defaultControls(R22_DEFINITION), b = body(); r.reset(true);
    c.collective = 0.5; r.settle(b, v3.zero(), 1.225, 1000, c);
    expect(r.state.coning / DEG).toBeGreaterThan(1); expect(r.state.coning / DEG).toBeLessThan(5);
    b.velocityBody.x = 20 * KT; r.settle(b, v3.zero(), 1.225, 1000, c);
    expect(r.state.flapRight).toBeGreaterThan(0);
    b.velocityBody.x = 110 * KT; c.collective = 0.9; r.settle(b, v3.zero(), 0.85, 1000, c);
    expect(r.state.stalledFraction).toBeGreaterThan(0.02);
    expect(r.state.retreatingFlap).toBeGreaterThan(0);
    expect(r.state.flapForward).toBeLessThan(0);
  });

  it('hard skid landings and tail-disc strikes are detected at the actual shared geometry', () => {
    const hard = rig(0), hs = hard.fm.state;
    hard.fm.setKinematics({ position: { x: 0, y: 0, z: -0.92 }, orientation: quat.identity(),
      velocity: { x: 0, y: 0, z: 5 }, angularVelocity: v3.zero() });
    run(hard, 0.05); expect(hs.crashed).toBe(true); expect(hs.crashReason).toContain('skid');
    const tail = rig(0), ts = tail.fm.state;
    tail.fm.setKinematics({ position: { x: 0, y: 0, z: -d.skids.z }, orientation: quat.fromEuler(0, 20 * DEG, 0),
      velocity: v3.zero(), angularVelocity: v3.zero() });
    expect(ts.crashed).toBe(true); expect(ts.crashReason).toContain('Tail rotor');
  });

  it('a rolling single-skid contact can overturn under thrust; lowering collective permits recovery', () => {
    const trials = [0.4, 0].map(collective => {
      const r = rig(0), roll = 10 * DEG;
      r.fm.setKinematics({ position: { x: 0, y: 0,
        z: -(d.skids.z * Math.cos(roll) + d.skids.halfTrack * Math.sin(roll) - 0.01) },
        orientation: quat.fromEuler(roll, 0, 0), velocity: v3.zero(), angularVelocity: { x: 0.3, y: 0, z: 0 } });
      r.c.collective = collective; r.c.aileron = 0;
      let contacts = 0;
      for (let i = 0; i < 720 && !r.fm.state.crashed; i++) {
        run(r, 1/240); if (r.fm.state.onGround) contacts++;
      }
      return { state: r.fm.state, contacts };
    });
    // An already rolling 10° departure checks the contact mechanism, not a certified critical angle.
    expect(trials[0].contacts).toBeGreaterThan(240);
    expect(trials[0].state.roll).toBeGreaterThan(40 * DEG);
    expect(trials[0].state.crashReason).toBe('Main rotor strike');
    expect(trials[1].state.crashed).toBe(false);
    expect(Math.abs(trials[1].state.roll)).toBeLessThan(DEG);
  });
});
