import { expect, it } from 'vitest';
import { Rotorcraft } from '../../src/physics/rotorcraft/rotorcraft';
import { R22_DEFINITION } from '../../src/aircraft/r22';
import { R44_DEFINITION } from '../../src/aircraft/r44';
import { defaultControls } from '../../src/core/types';
import { quat, v3 } from '../../src/core/math';
import type { EngineUnit } from '../../src/physics/propulsion/engineUnit';
// SHA-256 of every numeric/boolean output in 960 force evaluations per case, from unmodified
// main 8cac779 solver sources (stopped-rotor fix 7157794). The four running-rotor
// digests are unchanged from 0d19506; only the two cold cases change. Independent main capture
// and direct comparison are recorded in docs/s269-round2.md and work/r2/.
const baseline: Record<string, string> = {
  "r22-0": "5dbf5f6ad3dd4c42aabb6d8abfeffab12bf718ad9a967179914b4cf9b40a2ad3",
  "r22-1": "f5275dc60289917c647a67a2c434f4d85868daf5aaaa4e3795ffcd7f6d68f2e2",
  "r22-2": "c22fc7b4ad24aa7a303231a4e7c250d71943e37c650ea827883be6cba11b22fd",
  "r44-0": "8b62003fe094689b1a623e30db2c4a1b316a991701d7fdf5979446f59cdd5ac8",
  "r44-1": "2a165e2b0f9dcf49ff25f0f50b57a8dfe996c615ab4d4f3c06691731c3d010a7",
  "r44-2": "7f4eb4d496f4e2c9a55484cd6bd1ffd61c5fd95daa6f620dd228c56acd7c5331"
};
for (const def of [R22_DEFINITION, R44_DEFINITION]) for (const mode of [0, 1, 2]) it(`${def.id}: exact legacy loads, drive, systems, zero-dt stages (${mode})`, async () => {
  const { createHash } = await import(/* @vite-ignore */ 'node:crypto' as string);
  const hash = createHash('sha256');
  const d = def.rotorcraft!, b = new Rotorcraft(d);
  const engine = () => { const shaft = { omega: (mode === 0 ? 800 : 2670) * Math.PI / 30, inertia: 0.8, shaftTorque: 300,
    get rpm() { return this.omega * 30 / Math.PI; }, state: { rpm: 0, power: 110000, manifoldPressure: 24 } }; return shaft as unknown as EngineUnit; };
  const eb = engine(), c = defaultControls(def);
  b.reset(mode !== 0);
  const body = { time: 0, position: { x: 0, y: 0, z: -10 }, orientation: quat.fromEuler(0.13, -0.08, 0.7),
    velocityBody: { x: mode * 20, y: -2, z: 3 }, angularVelocity: { x: 0.14, y: -0.21, z: 0.04 }, cgOffset: { x: 0.07, y: -0.03, z: 0 }, mass: 600 };
  for (let i = 0; i < 240; i++) {
    Object.assign(c, { collective: 0.2 + 0.2 * Math.sin(i / 30), elevator: 0.1 * Math.cos(i / 20), aileron: -0.12 * Math.sin(i / 20), rudder: 0.15,
      throttle: 0.6 + 0.1 * Math.sin(i / 50), rotorClutch: i < 180, rotorGovernor: mode !== 2, masterBattery: i < 210 });
    b.throttle(1/240, c, eb);
    b.drive(1/240, c, eb);
    for (const dt of [1/240, 0, 0, 0]) {
      b.compute(body, v3.zero(), 1.225, 10, c, dt);
      hash.update(JSON.stringify({ state: b.state, loads: b.compute(body, v3.zero(), 1.225, 10, c, 0), power: b.power,
        h: b.angularMomentum, drive: b.drivePower, engine: eb.omega }));
    }
  }
  expect(hash.digest('hex')).toBe(baseline[`${def.id}-${mode}`]);
});
