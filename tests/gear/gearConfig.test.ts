// What LandingGear takes from its configuration instead of a Cessna 172S constant: the list of propeller
// discs, the wording of the first part in a terrain-impact message, the impact thresholds and the penalty
// contact of the airframe points. Every case is the C172S configuration with one member replaced, so the
// C172S itself reaches none of the replaced paths.

import { describe, expect, test } from 'vitest';
import { C172 } from '../../src/core/c172';
import { DEG, G0, quat, v3, type Vec3 } from '../../src/core/math';
import { C172_GEAR, LandingGear, classifyImpact, type GearConfig } from '../../src/physics/gear';
import { C172_PROPELLER, C172_STRUCTURE, STRUCTURE_CONTACT } from '../../src/physics/gear/structure';
import { GearRig, MASS, planeEnvironment } from './rig';

const ELEVATION = 120;
const PROP_TIP: Vec3 = { x: C172.prop.hub.x, y: 0, z: C172.prop.diameter / 2 };

/** One call of the gear with the aircraft held in an attitude, `point` (body) `depth` m under the ground, moving along `velocity` (NED). */
function touch(config: GearConfig, roll: number, pitch: number, point: Vec3, depth: number, velocity: Vec3 = v3.zero()) {
  const rig = new GearRig(planeEnvironment(), MASS, config);
  rig.orientation = quat.fromEuler(roll, pitch, 0);
  rig.position = { x: 0, y: 0, z: -(ELEVATION + quat.rotate(rig.orientation, point).z - depth) };
  rig.velocity = velocity;
  return rig.step();
}

describe('propeller discs', () => {
  test('the Cessna 172S lists its one disc; an empty list strikes nothing', () => {
    expect(C172_GEAR.propellers).toEqual([C172_PROPELLER]);
    expect(new LandingGear().config).toBe(C172_GEAR);
    expect(touch(C172_GEAR, 0, -27 * DEG, PROP_TIP, 0.02).crash).toBe('Propeller strike');
    expect(touch({ ...C172_GEAR, propellers: [] }, 0, -27 * DEG, PROP_TIP, 0.02).crash).toBe('');
  });

  test('every disc of a list is tested, each with its own message', () => {
    const left = { hub: { x: 1.2, y: -1.6, z: 0.6 }, radius: 0.95, message: 'Left propeller strike' };
    const right = { hub: { x: 1.2, y: 1.6, z: 0.6 }, radius: 0.95, message: 'Right propeller strike' };
    const twin: GearConfig = { ...C172_GEAR, propellers: [left, right] };
    // The lowest point of a disc is found from the attitude: banked, the disc on the low side touches first.
    const drop = (roll: number) => {
      const rig = new GearRig(planeEnvironment(), MASS, twin);
      rig.orientation = quat.fromEuler(roll, -27 * DEG, 0);
      rig.position = { x: 0, y: 0, z: -(ELEVATION + 2.5) };
      rig.run(1.5);
      return rig.output.crash;
    };
    expect(drop(-10 * DEG)).toBe('Left propeller strike');
    expect(drop(10 * DEG)).toBe('Right propeller strike');

    // Both discs in the ground at once (and nothing else): the load does not depend on the order of the list,
    // and it is twice that of one disc, without its rolling moment.
    const tip = { x: 1.2, y: 0, z: 0.6 + 0.95 };
    const a = touch(twin, 0, -27 * DEG, tip, 0.05);
    const b = touch({ ...twin, propellers: [right, left] }, 0, -27 * DEG, tip, 0.05);
    const one = touch({ ...twin, propellers: [left] }, 0, -27 * DEG, tip, 0.05);
    expect(a.crash).toBe('Left propeller strike');
    expect(b.crash).toBe('Right propeller strike');
    expect(one.force.z).toBeCloseTo(-STRUCTURE_CONTACT.stiffness * 0.05 * Math.cos(27 * DEG), 4);
    for (const k of ['x', 'y', 'z'] as const) {
      expect(a.force[k]).toBeCloseTo(b.force[k], 6);
      expect(a.moment[k]).toBeCloseTo(b.moment[k], 6);
    }
    expect(a.force.z).toBeCloseTo(2 * one.force.z, 6);
    expect(Math.abs(a.moment.x)).toBeLessThan(1e-6);
    expect(Math.abs(one.moment.x)).toBeGreaterThan(1000);
  });
});

describe('first part of a terrain impact', () => {
  const fast = { x: 60, y: 0, z: 0 };

  test('a point without a label is named from its message, as the Cessna 172S points are', () => {
    expect(touch(C172_GEAR, 0, -27 * DEG, PROP_TIP, 0.02, fast).crash).toBe('Terrain impact at 117 kt, 0 fpm descent, 27° nose down (propeller first)');
    const tip = C172_STRUCTURE[0].position;
    expect(touch(C172_GEAR, -60 * DEG, 0, tip, 0.02, fast).crash).toBe('Terrain impact at 117 kt, 0 fpm descent (left wingtip first)');
  });

  test('a labelled disc or airframe point is named by its label', () => {
    const disc = { ...C172_PROPELLER, message: 'Left propeller strike' };
    const unlabelled: GearConfig = { ...C172_GEAR, propellers: [disc] };
    const labelled: GearConfig = { ...C172_GEAR, propellers: [{ ...disc, part: 'left propeller' }] };
    expect(touch(unlabelled, 0, -27 * DEG, PROP_TIP, 0.02, fast).crash).toMatch(/\(left propeller strike\)$/);
    expect(touch(labelled, 0, -27 * DEG, PROP_TIP, 0.02, fast).crash).toBe('Terrain impact at 117 kt, 0 fpm descent, 27° nose down (left propeller first)');
    // The label is wording for the impact message only: a landing-like contact keeps the point's message.
    expect(touch(labelled, 0, -27 * DEG, PROP_TIP, 0.02).crash).toBe('Left propeller strike');

    const structure = C172_STRUCTURE.map((p, i) => (i === 0 ? { ...p, part: 'left wing' } : p));
    const tip = C172_STRUCTURE[0].position;
    expect(touch({ ...C172_GEAR, structure }, -60 * DEG, 0, tip, 0.02, fast).crash).toBe('Terrain impact at 117 kt, 0 fpm descent (left wing first)');
    expect(touch({ ...C172_GEAR, structure }, -60 * DEG, 0, tip, 0.02).crash).toBe('Left wingtip struck the ground');
  });
});

describe('impact thresholds', () => {
  const slow = { sinkRate: 5, speed: 25, steepSpeed: 22, steepPath: 12 * DEG };

  test('the classifier takes the thresholds; without them it uses the Cessna 172S figures', () => {
    expect(classifyImpact({ x: 30, y: 0, z: 2 }, 0)).toBe('');
    expect(classifyImpact({ x: 30, y: 0, z: 2 }, 0, undefined)).toBe('');
    expect(classifyImpact({ x: 30, y: 0, z: 2 }, 0, slow)).toBe('Terrain impact at 58 kt, 394 fpm descent');
    expect(classifyImpact({ x: 20, y: 0, z: 6 }, 0, slow)).toBe('Terrain impact at 41 kt, 1181 fpm descent');
    expect(classifyImpact({ x: 23, y: 0, z: 4 }, 0, slow)).toBe('');
    expect(classifyImpact({ x: 23, y: 0, z: 4 }, 0, { ...slow, steepPath: 8 * DEG })).toBe('Terrain impact at 45 kt, 787 fpm descent');
  });

  test('a configuration with its own thresholds classifies its crashes with them', () => {
    const arrival = { x: 30, y: 0, z: 0 };
    expect(touch(C172_GEAR, 0, -27 * DEG, PROP_TIP, 0.02, arrival).crash).toBe('Propeller strike');
    expect(touch({ ...C172_GEAR, impact: slow }, 0, -27 * DEG, PROP_TIP, 0.02, arrival).crash).toBe('Terrain impact at 58 kt, 0 fpm descent, 27° nose down (propeller first)');
  });
});

describe('airframe contact', () => {
  // A probe under the wheels, which tolerates any contact: the only part in the ground.
  const probe = { position: { x: 0, y: 0, z: 2 }, message: 'Probe', tolerance: 100 };
  const sliding = { x: 5, y: 0, z: 1 };
  const load = (config: GearConfig) => touch(config, 0, 0, probe.position, 0.1, sliding);

  test('stiffness, damping and friction come from the configuration; the default is the present contact', () => {
    const k = STRUCTURE_CONTACT;
    const standard = load({ ...C172_GEAR, structure: [probe] });
    expect(standard.crash).toBe('');
    expect(standard.onGround).toBe(false);
    expect(-standard.force.z).toBeCloseTo(k.stiffness * 0.1 + k.damping * 1, 4);
    expect(standard.force.x / standard.force.z).toBeCloseTo(k.friction, 9);

    const soft = load({ ...C172_GEAR, structure: [probe], contact: { stiffness: 1e5, damping: 5e3, friction: 0.2 } });
    expect(-soft.force.z).toBeCloseTo(1e5 * 0.1 + 5e3 * 1, 4);
    expect(soft.force.x / soft.force.z).toBeCloseTo(0.2, 9);
  });

  test('a point may have its own friction', () => {
    const skid = load({ ...C172_GEAR, structure: [{ ...probe, friction: 0.8 }] });
    expect(-skid.force.z).toBeCloseTo(STRUCTURE_CONTACT.stiffness * 0.1 + STRUCTURE_CONTACT.damping * 1, 4);
    expect(skid.force.x / skid.force.z).toBeCloseTo(0.8, 9);
    const ice = load({ ...C172_GEAR, structure: [{ ...probe, friction: 0 }], contact: { ...STRUCTURE_CONTACT, friction: 0.3 } });
    expect(ice.force.x).toBeCloseTo(0, 9);
  });
});

describe('the rig', () => {
  test('carries the Cessna 172S unless it is given another aircraft', () => {
    const standard = new GearRig();
    expect(standard.gear.config).toBe(C172_GEAR);
    expect(standard.mass).toBe(MASS);
    expect(standard.inertia).toEqual({ x: C172.mass.Ixx, y: C172.mass.Iyy, z: C172.mass.Izz });

    const config: GearConfig = { ...C172_GEAR, propellers: [{ ...C172_PROPELLER, radius: 0.8 }] };
    const inertia = { x: 2000, y: 2600, z: 4200 };
    const heavy = new GearRig(planeEnvironment(), 1300, config, inertia);
    expect(heavy.gear.config).toBe(config);
    expect(heavy.inertia).toBe(inertia);
    standard.placeOnGround(0, 0.02);
    standard.run(8);
    heavy.placeOnGround(0, 0.02);
    heavy.run(8);
    const total = heavy.output.wheels.reduce((sum, w) => sum + w.load, 0);
    expect(Math.abs(total - 1300 * G0) / (1300 * G0)).toBeLessThan(0.01);
    expect(heavy.heightAGL()).toBeLessThan(standard.heightAGL() - 0.005);
    expect(heavy.output.crash).toBe('');
  });
});
