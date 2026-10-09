import { describe, expect, it } from 'vitest';
import { R44_DEFINITION as def } from '../../src/aircraft/r44';
import { createFlightModelFor } from '../../src/physics';
import type { BladeElementFlightModel } from '../../src/physics/flightModel';
import { bladeElements } from '../../src/physics/rotorcraft/rotor';
import { airframeLoads } from '../../src/physics/rotorcraft/airframe';
import { DEG, KT, quat, v3 } from '../../src/core/math';
import { cloneControls } from '../../src/core/types';
import { ScriptedPilot, observePilot } from '../../src/sim/rotorcraft/scriptedPilot';
import { flatEnvironment } from '../fdm/helpers';
const d = def.rotorcraft!, DT = 1 / 240;
const world = flatEnvironment(undefined, 0), env = { ...world, atmosphere: () => world.atmosphere(0) };

describe('R44 work closure with the production rotor/skid solver', () => {
  it('closes blade-element lift work and dissipates profile work in powered/reversed/autorotative flow', () => {
    for (const rotor of [d.main, d.tail]) for (const axial of [-18, -6, 0, 12])
      for (const speed of [0, 35, 90]) for (const pitch of [-8, 1.75, 14.75]) {
        const omega = rotor === d.main ? 406 * Math.PI / 30 : 406 * Math.PI / 30 * d.tailRatio;
        const a = bladeElements(rotor, omega, pitch * DEG, axial, speed, 4, 1.225, 12, 16, rotor === d.main);
        expect(a.thrust * axial - a.inPlane * speed - a.torque * omega + a.thrust * 4 + a.profilePower).toBeCloseTo(0, 7);
        expect(a.profilePower).toBeGreaterThanOrEqual(0);
      }
  });
  it('fixed surfaces dissipate work without rotor wash', () => {
    const data = { ...d, fuselageWash: 0, fuselageMoment: { pitch: 0, yaw: 0 }, stabilizer: { ...d.stabilizer, wash: 0 } };
    for (const x of [-30, -3, 0, 3, 30]) for (const y of [-15, 0, 15]) for (const z of [-15, 0, 15]) {
      const air = { x, y, z }, body = { time: 0, position: v3.zero(), orientation: quat.identity(),
        velocityBody: air, angularVelocity: v3.zero(), cgOffset: v3.zero(), mass: 1134 };
      expect(v3.dot(airframeLoads(data, body, air, 1.225, 0).force, air)).toBeLessThanOrEqual(1e-9);
    }
  });
  for (const gross of [true, false]) for (const mode of ['steady', 'cyclic-flare'] as const)
    it(`${gross ? 'gross' : 'solo'} ${mode}: total mechanical energy closes against measured force/shaft work`, () => {
      const fm = createFlightModelFor(def) as BladeElementFlightModel;
      if (gross) fm.setLoading(def.mass.loadings.maxGross);
      fm.reset({ position: { x: 0, y: 0, z: -1500 }, heading: 0, airspeed: 65 * KT,
        onGround: false, engineRunning: true, fuelFraction: gross ? 1 : 0.5 }, env);
      const c = cloneControls(fm.trimControls), rotor = fm.rotorcraft!;
      const pilot = new ScriptedPilot(observePilot(fm.state, d), c), initialPitch = fm.state.pitch;
      c.mixture = 0; c.collective = 0;
      let powers: number[] = [];
      const compute = rotor.compute.bind(rotor);
      rotor.compute = (...args) => {
        const loads = compute(...args), p = rotor.power;
        powers.push(p.mainThrust + p.mainH + p.tailThrust + p.tailH + p.fuselage + p.stabilizer + p.fins + p.moments + p.driveReaction);
        return loads;
      };
      const energy = () => {
        const s = fm.state, mp = fm.massProperties, w = s.angularVelocity, i = mp.inertia;
        return mp.mass * 9.80665 * (-s.position.z - quat.rotate(s.orientation, mp.cgOffset).z) +
          0.5 * mp.mass * v3.dot(s.velocity, s.velocity) +
          0.5 * (i.Ixx * w.x ** 2 + i.Iyy * w.y ** 2 + i.Izz * w.z ** 2 - 2 * i.Ixz * w.x * w.z) +
          0.5 * (d.main.inertia + d.tail.inertia * d.tailRatio ** 2) * rotor.state.omega ** 2;
      };
      let old = energy(), checked = 0, maxError = 0;
      for (let step = 0; step < (mode === 'steady' ? 25 : 5) / DT; step++) {
        pilot.step(DT, observePilot(fm.state, d), c, 65, -1,
          mode === 'steady' ? undefined : initialPitch + Math.min(step * DT, 2) * 8 * DEG, 0);
        powers = []; fm.step(DT, c, env);
        const current = energy(), derivative = (current - old) / DT;
        const work = powers.reduce((sum, p, i) => sum + p * [1, 2, 2, 1][i] / 6, 0) + rotor.drivePower.rotorChange;
        if (step * DT > 1 && rotor.drivePower.clutch === 0) {
          expect(derivative).toBeLessThan(0);
          maxError = Math.max(maxError, Math.abs(derivative - work)); checked++;
        }
        expect(fm.state.crashed).toBe(false);
        old = current;
      }
      expect(checked).toBeGreaterThan(240);
      // Same 10 W closure allowance as the R22 audit, despite the larger R44 energy scale.
      expect(maxError).toBeLessThan(10);
    }, 120000);
});
