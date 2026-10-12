import { expect, it } from 'vitest';
import { Rotorcraft } from '../../src/physics/rotorcraft/rotorcraft';
import { SkidGear } from '../../src/physics/rotorcraft/skids';
import { R22_DEFINITION } from '../../src/aircraft/r22';
import { R44_DEFINITION } from '../../src/aircraft/r44';
import { S269_DEFINITION } from '../../src/aircraft/s269';
import { defaultControls } from '../../src/core/types';
import { quat } from '../../src/core/math';
import type { EngineUnit } from '../../src/physics/propulsion/engineUnit';
import { seaLevel, DT } from './helpers';

// Captured independently from main ff242fb1b63f62d1c4c7b6922de1feb63b1a4d87, with original
// definitions and both solvers extracted by git archive. 1,920 evaluations per case include
// loads, complete rotor state, power, momentum, drive, engine and gear. See ground-contact report.
const baseline: Record<string, string> = {
  "r22-0": "efa7ff48f2732bfc32094f77d8c2b74e3f49b57478a748d94f7417dc1432d6da",
  "r22-1": "aeb5e52e30b2967fe4304a68b050f88363b3fcc9c978d2553b3ee703eba70aea",
  "r22-2": "102839cc6347a385eb03e8d1f7bb545633b53e05ee8ce346392b07d41ca4ca3c",
  "r22-3": "1016bf11197e8d266fa6d9d2ed8f9fd016a455d8a185c74d1a34b6db37698a27",
  "r44-0": "9d080bff88eab5d27487f7e9023fa44ac3110ade73da24c83b9ab35b521c0e3f",
  "r44-1": "03b4cfbf165910b1b57cb96c591b7bb1420f397709ff76dc337d6b018ec8dabf",
  "r44-2": "6eb62aad30d9e59363a176c5d03e1cd119c2dad8c9a8ee578cf421d46a80ff0e",
  "r44-3": "9df2d36b9f4e7d5dc74fb59e2362c5c32c4fe1c7275808090b52ae17e1ca100c",
  "s269-0": "7900f536ae2373636c8bda911c2dd903a396ddd49b6ba6bb4f562bc2c2492f1b",
  "s269-1": "1cbdeaf3a57f84d9fc4d8de693b8d418c230eeef72e0e9aaa75500d172d28a50",
  "s269-2": "5681a447fdb6a157b52f0caaf62ee07cdcff042e5d3875c371d36e9187f12328",
  "s269-3": "9522e035df0cc7796af25f6ac02cded48346ba2d442acaf55da7cec69717c374"
};

for (const def of [R22_DEFINITION, R44_DEFINITION, S269_DEFINITION]) for (const mode of [0, 1, 2, 3])
  it(`${def.id}: airborne contact-extension equivalence, mode ${mode}`, async () => {
    const { createHash } = await import(/* @vite-ignore */ 'node:crypto' as string);
    const hash = createHash('sha256'), rotor = new Rotorcraft(def.rotorcraft!), gear = new SkidGear(def.rotorcraft!);
    rotor.reset(mode !== 0);
    const shaft = { omega: (mode === 0 ? 800 : 2670) * Math.PI / 30, inertia: 0.8,
      shaftTorque: mode === 3 ? 0 : 300, get rpm() { return this.omega * 30 / Math.PI; },
      state: { rpm: 0, power: 110000, manifoldPressure: 24 } };
    const engine = shaft as unknown as EngineUnit;
    const controls = defaultControls(def), body = {
      time: 0, position: { x: 0, y: 0, z: -30 }, orientation: quat.fromEuler(0.13, -0.08, 0.7),
      velocityBody: { x: mode * 15, y: -2, z: 3 }, angularVelocity: { x: 0.14, y: -0.21, z: 0.04 },
      cgOffset: { x: 0.07, y: -0.03, z: 0 }, mass: 600,
    };
    for (let i = 0; i < 480; i++) {
      body.time = i * DT;
      Object.assign(controls, { collective: 0.2 + 0.2 * Math.sin(i / 30), elevator: 0.1 * Math.cos(i / 20),
        aileron: -0.12 * Math.sin(i / 20), rudder: 0.15,
        throttle: mode === 3 ? 0 : 0.6 + 0.1 * Math.sin(i / 50), rotorClutch: i < 360,
        rotorGovernor: mode !== 2, masterBattery: i < 420 });
      rotor.throttle(DT, controls, engine); rotor.drive(DT, controls, engine);
      for (const dt of [DT, 0, 0, 0]) {
        const wind = { x: 3 * Math.sin(i / 90), y: 2, z: 0.2 };
        const load = rotor.compute(body, wind, 1.225, 30, controls, dt);
        hash.update(JSON.stringify({ state: rotor.state, load, power: rotor.power, h: rotor.angularMomentum,
          drive: rotor.drivePower, engine: engine.omega,
          gear: gear.compute({ body, controls, env: seaLevel, dt }, rotor.state) }));
      }
    }
    expect(hash.digest('hex')).toBe(baseline[`${def.id}-${mode}`]);
  });
