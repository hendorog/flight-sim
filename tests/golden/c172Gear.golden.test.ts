// Golden master of the C172 landing gear (src/physics/gear LandingGear) on the frozen 6-DOF gear rig (gravity
// + gear + an optional external force, 240 Hz): forces, moments, wheel states and the rig's motion at fixed
// times, pinned in tests/golden/data/c172Gear.json to a relative 1e-9 (tests/golden/golden.ts).
//
// The rig's own integrator is part of the record (tests/golden/rigs/gear.ts, a frozen copy of tests/gear/rig.ts).
//
// REGENERATE ONLY DELIBERATELY, after a change that is meant to alter the gear, the tyres or the ground
// surfaces, and review the diff of the JSON:
//   FS_GOLDEN_UPDATE=1 npx vitest run tests/golden/c172Gear.golden.test.ts

import { describe, it } from 'vitest';
import { C172 } from '../../src/core/c172';
import { v3 } from '../../src/core/math';
import { DT, GearRig, MASS, planeEnvironment } from './rigs/gear';
import { golden, type Recorder } from './golden';

const FILE = 'c172Gear';

/** The gear's last output and the rigid-body state it produced. */
function record(r: Recorder, key: string, rig: GearRig): void {
  r.gear(key, rig.output);
  r.vec(`${key}/rig.position`, rig.position);
  r.vec(`${key}/rig.velocity`, rig.velocity);
  r.quat(`${key}/rig.orientation`, rig.orientation);
  r.vec(`${key}/rig.angularVelocity`, rig.angularVelocity);
  r.put(`${key}/rig.heightAGL`, rig.heightAGL());
}

/**
 * Run `seconds` at 240 Hz, calling `each` with the time since the start of this run before every step and
 * recording at each of `samples` (s since the start of this run, after that many steps). Touchdown events are
 * recorded as they come, under the step that reported them.
 */
function runAndRecord(r: Recorder, key: string, rig: GearRig, seconds: number, samples: readonly number[], each?: (t: number) => void): void {
  const steps = Math.round(seconds / DT);
  const due = new Map(samples.map((t) => [Math.round(t / DT), t]));
  for (let i = 1; i <= steps; i++) {
    each?.((i - 1) * DT);
    const out = rig.step();
    for (const td of out.touchdowns) r.put(`${key}/touchdown.${td.wheel}@step${i}`, td.sinkRate);
    const t = due.get(i);
    if (t !== undefined) record(r, `${key}/t${t.toFixed(3).padStart(6, '0')}`, rig);
  }
}

/** Hold the body-axis forward speed near `target` with a thrust-like force at the propeller hub (as tests/gear/gear.test.ts). */
function speedHold(rig: GearRig, target: number): void {
  rig.external = { force: { x: 0, y: 0, z: 0 }, point: C172.prop.hub };
  rig.loads = (g) => {
    g.external!.force.x = Math.max(0, Math.min(3000, 800 + 3000 * (target - g.velocityBody().x)));
    return { force: v3.zero(), moment: v3.zero() };
  };
}

describe('C172 landing gear golden master', () => {
  it('resting pose and the settled static state', () => {
    golden(FILE, 'resting', (r) => {
      const rig = new GearRig();
      const poses: Record<string, [number, { x: number; y: number; z: number }]> = {
        rigMass: [MASS, v3.zero()],
        maxTakeoff: [C172.mass.maxTakeoff, { x: -0.05, y: 0, z: -0.02 }],
        forwardCg: [1000, { x: 0.08, y: 0, z: 0 }],
        light: [800, { x: -0.1, y: 0, z: 0.03 }],
      };
      for (const [name, [mass, cg]] of Object.entries(poses)) {
        const pose = rig.gear.restingPose(mass, cg);
        r.put(`pose/${name}/height`, pose.height);
        r.put(`pose/${name}/pitch`, pose.pitch);
      }
      // Released 2 cm above the resting height, heading 1.2 rad: the struts take the weight and come to rest.
      rig.placeOnGround(1.2, 0.02);
      runAndRecord(r, 'settle', rig, 6, [DT, 0.1, 0.25, 0.5, 1, 2, 6]);
    });
  });

  it('drop tests: 0.3 m onto the runway, and a 2.5 m drop that breaks the gear', () => {
    golden(FILE, 'drop', (r) => {
      const rig = new GearRig();
      rig.placeOnGround(0, 0.3);
      runAndRecord(r, 'drop0.3m', rig, 3, [0.2, 0.25, 0.275, 0.3, 0.325, 0.35, 0.4, 0.5, 0.75, 1, 1.5, 3]);

      const hard = new GearRig();
      hard.placeOnGround(0, 2.5);
      runAndRecord(r, 'drop2.5m', hard, 1.5, [0.7, 0.75, 0.8, 1, 1.5]);
    });
  });

  it('braked roll from 30 m/s, and a roll over grass on a cross slope', () => {
    golden(FILE, 'roll', (r) => {
      const rig = new GearRig();
      rig.placeOnGround(0);
      rig.velocity = { x: 30.5, y: 0, z: 0 };
      // Wheels spin up, then the pedals are pressed over 0.3 s; the left brake is released a little at 6 s.
      runAndRecord(r, 'braked', rig, 12, [DT, 0.05, 0.2, 1, 1.1, 1.3, 2, 4, 6, 6.5, 8, 10, 12], (t) => {
        const press = Math.max(0, Math.min(1, (t - 1) / 0.3));
        rig.controls.brakeRight = press;
        rig.controls.brakeLeft = t < 6 ? press : 0.6;
      });

      // Grass, 3 % cross slope, a steady side force at the CG, free rolling with a touch of pedal.
      const grass = new GearRig(planeEnvironment('grass', { x: 0, y: 0.03, z: -1 }));
      grass.placeOnGround(0.4);
      grass.velocity = { x: 15 * Math.cos(0.4), y: 15 * Math.sin(0.4), z: 0 };
      grass.externalNed = { x: 0, y: 300, z: 0 };
      runAndRecord(r, 'grass', grass, 8, [0.1, 0.5, 1, 2, 4, 6, 8], (t) => {
        grass.controls.rudder = t >= 2 && t < 4 ? 0.2 : 0;
      });
    });
  });

  it('steered taxi turns: full pedal, pedal with the inside brake, and the parking brake against thrust', () => {
    golden(FILE, 'taxi', (r) => {
      const turn = (key: string, brake: number) => {
        const rig = new GearRig();
        rig.placeOnGround(0);
        rig.velocity = { x: 2.5, y: 0, z: 0 };
        speedHold(rig, 2.5);
        // Pedal fed in over one second, held, then reversed.
        runAndRecord(r, key, rig, 14, [0.25, 0.5, 1, 2, 4, 7, 10, 10.5, 11, 12, 14], (t) => {
          rig.controls.rudder = t < 10 ? Math.min(1, t) : -1;
          rig.controls.brakeRight = t < 10 ? brake : 0;
        });
      };
      turn('pedal', 0);
      turn('pedalAndBrake', 1);

      const parked = new GearRig();
      parked.placeOnGround(0);
      parked.controls.parkingBrake = true;
      parked.external = { force: { x: 1500, y: 0, z: 0 }, point: C172.prop.hub };
      runAndRecord(r, 'parkingBrake', parked, 8, [0.5, 2, 5], (t) => {
        parked.controls.parkingBrake = t < 5;
      });
      record(r, 'parkingBrake/released3s', parked);
    });
  });
});
