import { describe, expect, it } from 'vitest';
import { DEG, quat, v3 } from '../../src/core/math';
import { R22_ROTORCRAFT as d } from '../../src/aircraft/r22/rotorcraft';
import { bladeElements, inflowTimeConstant } from '../../src/physics/rotorcraft/rotor';
import { airframeLoads } from '../../src/physics/rotorcraft/airframe';
import type { BladeElementFlightModel } from '../../src/physics/flightModel';
import { R22Flight } from '../../src/sim/rotorcraft/flights';
import { observePilot, ScriptedPilot } from '../../src/sim/rotorcraft/scriptedPilot';
import { DT, rig, seaLevel } from './helpers';

describe('rotorcraft mechanical energy in still air', () => {
  it('blade-element lift transfers work between thrust, H-force and torque without creating it', () => {
    // Includes autorotation, axial flight, reversed thrust, reverse-flow elements and section stall.
    for (const rotor of [d.main, d.tail]) for (const axial of [-18, -6, 0, 12])
      for (const speed of [0, 35, 90]) for (const pitch of [-8, 2.5, 14]) {
        const omega = 54, vi = 4;
        const a = bladeElements(rotor, omega, pitch * DEG, axial, speed, vi, 1.225, 12, 16, rotor === d.main);
        const work = a.thrust * axial - a.inPlane * speed - a.torque * omega;
        expect(work + a.thrust * vi + a.profilePower).toBeCloseTo(0, 7);
        expect(a.profilePower).toBeGreaterThanOrEqual(0);
      }
  });

  it('uniform inflow responds to wake convection in forward flight, rather than retaining its hover lag', () => {
    const hover = inflowTimeConstant(d.main.radius, 0, 0, 7);
    const forward = inflowTimeConstant(d.main.radius, -6, 33, 2);
    expect(hover).toBeGreaterThan(0.06); expect(hover).toBeLessThan(0.09);
    expect(forward).toBeGreaterThan(0.025); expect(forward).toBeLessThan(0.04);
    expect(forward).toBeLessThan(hover);
  });

  it('fixed surfaces dissipate work in forward and backward flight without rotor wash', () => {
    const data = { ...d, fuselageWash: 0, fuselageMoment: { pitch: 0, yaw: 0 }, stabilizer: { ...d.stabilizer, wash: 0 } };
    for (const x of [-30, -3, 0, 3, 30]) for (const y of [-15, 0, 15]) for (const z of [-15, 0, 15]) {
      const air = { x, y, z }, body = { time: 0, position: v3.zero(), orientation: quat.identity(),
        velocityBody: air, angularVelocity: v3.zero(), cgOffset: v3.zero(), mass: 600 };
      const f = airframeLoads(data, body, air, 1.225, 0);
      expect(v3.dot(f.force, air)).toBeLessThanOrEqual(1e-9);
    }
  });

  for (const gross of [true, false]) for (const mode of ['steady', 'constant-collective', 'landing'] as const)
    it(`${gross ? 'gross' : 'solo'} ${mode}: airborne energy decreases and closes against measured work`, () => {
      const r = rig(65, gross), fm = r.fm as BladeElementFlightModel, rotor = fm.rotorcraft!;
      if (mode === 'landing') fm.setKinematics({ position: { x: 0, y: 0, z: -350 },
        orientation: fm.state.orientation, velocity: fm.state.velocity, angularVelocity: fm.state.angularVelocity });
      const pilot = new ScriptedPilot(observePilot(fm.state), r.c), initialPitch = fm.state.pitch;
      const heldCollective = r.c.collective!;
      const flight = mode === 'landing' ? new R22Flight('autorotation', fm.state, r.c, gross) : undefined;
      r.c.mixture = 0;
      if (mode === 'steady') r.c.collective = 0;
      let powers: number[] = [];
      const compute = rotor.compute.bind(rotor);
      rotor.compute = (...args) => {
        const loads = compute(...args), p = rotor.power;
        powers.push(p.mainThrust + p.mainH + p.tailThrust + p.tailH + p.fuselage + p.stabilizer + p.fins + p.moments + p.driveReaction);
        return loads;
      };
      const energy = () => {
        const s = fm.state, mp = fm.massProperties, w = s.angularVelocity, i = mp.inertia;
        const height = -s.position.z - quat.rotate(s.orientation, mp.cgOffset).z;
        return mp.mass * 9.80665 * height + 0.5 * mp.mass * v3.dot(s.velocity, s.velocity) +
          0.5 * (i.Ixx * w.x ** 2 + i.Iyy * w.y ** 2 + i.Izz * w.z ** 2 - 2 * i.Ixz * w.x * w.z) +
          0.5 * (d.main.inertia + d.tail.inertia * d.tailRatio ** 2) * rotor.state.omega ** 2;
      };
      let old = energy(), checked = 0;
      const seconds = mode === 'landing' ? 180 : mode === 'steady' ? 30 : 4;
      for (let step = 0; step < seconds / DT; step++) {
        if (flight) flight.update(DT, fm.state, r.c);
        else if (mode === 'steady') pilot.step(DT, observePilot(fm.state), r.c, 65, -1, undefined, 0);
        else pilot.step(DT, observePilot(fm.state), r.c, 65, 0, initialPitch + Math.min(step * DT, 2) * 8 * DEG, heldCollective);
        powers = []; fm.step(DT, r.c, seaLevel);
        // Contact springs store/release energy; only free flight is in this aircraft-energy budget.
        const s = fm.state;
        // The published gear flag is stage zero. A skid can first compress during a later RK stage
        // in this very step; exclude that contact step too, rather than attributing its work to air.
        const contact = [d.skids.front, d.skids.rear].some(x => [-1, 1].some(side =>
          s.position.z + quat.rotate(s.orientation, { x, y: side * d.skids.halfTrack, z: d.skids.z }).z >= 0));
        if (s.onGround || s.crashed || contact) break;
        const current = energy(), derivative = (current - old) / DT;
        const work = powers.reduce((sum, p, i) => sum + p * [1, 2, 2, 1][i] / 6, 0) + rotor.drivePower.rotorChange;
        if (step * DT > 1 && rotor.drivePower.clutch === 0) {
          expect(derivative).toBeLessThan(0);
          expect(Math.abs(derivative - work)).toBeLessThan(10);
          checked++;
        }
        old = current;
      }
      expect(checked).toBeGreaterThan(240);
    }, 120000);
});
