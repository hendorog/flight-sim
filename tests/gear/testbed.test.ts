// The test-bed configurations of testbed.ts are what their comments say: the same aircraft as the Cessna 172S
// where they claim to be, and the DA20-C1 proportions where they claim those.

import { describe, expect, test } from 'vitest';
import { DEG, G0, RAD, v3 } from '../../src/core/math';
import { C172_GEAR, LandingGear } from '../../src/physics/gear';
import { GearRig, MASS, planeEnvironment } from './rig';
import { CASTER_GEAR, DA20_LIKE, DA42_RETRACT, PA34_RETRACT, RETRACT_GEAR, TWIN_RETRACT_GEAR } from './testbed';

describe('test-bed gear configurations', () => {
  test('the castering and retractable test-beds stand exactly as the Cessna 172S does', () => {
    const c172 = new LandingGear().restingPose(MASS, v3.zero());
    for (const config of [CASTER_GEAR, RETRACT_GEAR, TWIN_RETRACT_GEAR]) expect(new LandingGear(config).restingPose(MASS, v3.zero())).toEqual(c172);
    expect(CASTER_GEAR.wheels[0].steering?.mode).toBe('castering');
    expect(CASTER_GEAR.wheels[1]).toBe(C172_GEAR.wheels[1]);
    expect(C172_GEAR.wheels[0].steering?.mode).toBeUndefined();
    expect(C172_GEAR.retract).toBeUndefined();
    expect(C172_GEAR.wheels.some((w) => w.stowed !== undefined)).toBe(false);
    expect(C172_GEAR.structure.some((p) => p.belly !== undefined || p.part !== undefined)).toBe(false);
  });

  test('the retractable test-beds stow every leg inside the airframe and name their belly points', () => {
    expect(RETRACT_GEAR.retract).toBe(PA34_RETRACT);
    const lowest = Math.max(...RETRACT_GEAR.structure.filter((p) => p.belly).map((p) => p.position.z));
    expect(RETRACT_GEAR.structure.filter((p) => p.belly).length).toBe(2);
    for (const w of RETRACT_GEAR.wheels) {
      expect(w.stowed).toBeDefined();
      expect(w.stowed!.z).toBeLessThan(lowest);
    }
    const [left, right] = TWIN_RETRACT_GEAR.propellers!;
    expect(TWIN_RETRACT_GEAR.propellers!.length).toBe(2);
    expect(left.hub).toEqual({ ...right.hub, y: -right.hub.y });
    expect([left.part, right.part]).toEqual(['left propeller', 'right propeller']);
    expect(TWIN_RETRACT_GEAR.structure.filter((p) => p.belly).length).toBe(4);
    // Rule of thumb of GearConfig.impact for a 60 kt stall: 1.6 and 1.4 times it.
    const vs0 = 60 * (1852 / 3600);
    expect(TWIN_RETRACT_GEAR.impact!.speed / vs0).toBeCloseTo(1.6, 1);
    expect(TWIN_RETRACT_GEAR.impact!.steepSpeed / vs0).toBeCloseTo(1.4, 1);
    // The handbook bands of the two systems.
    expect(PA34_RETRACT.extendTime).toBeGreaterThanOrEqual(6);
    expect(PA34_RETRACT.extendTime).toBeLessThanOrEqual(7);
    expect(DA42_RETRACT.extendTime).toBeGreaterThanOrEqual(6);
    expect(DA42_RETRACT.extendTime).toBeLessThanOrEqual(10);
    expect(DA42_RETRACT.emergency.freeFallTime).toBeLessThanOrEqual(20);
    expect(PA34_RETRACT.upLocks || DA42_RETRACT.upLocks).toBe(false);
  });

  test('the DA20-proportioned aircraft sits, drops and brakes like one', () => {
    const { mass, inertia, gear, wheelbase, track } = DA20_LIKE;
    const [nose, left, right] = gear.wheels;
    expect(nose.position.x - left.position.x).toBeCloseTo(wheelbase, 3);
    expect(right.position.y - left.position.y).toBeCloseTo(track, 3);
    const pose = new LandingGear(gear).restingPose(mass, v3.zero());
    const rig = new GearRig(planeEnvironment(), mass, gear, inertia);
    rig.placeOnGround(0, 0.3);
    let peak = 0;
    rig.run(8, (o) => {
      peak = Math.max(peak, -o.force.z / (mass * G0));
    });
    const loads = rig.output.wheels.map((w) => w.load);
    const total = loads[0] + loads[1] + loads[2];
    const tip = gear.propellers![0];
    const clearance = rig.heightAGL() - (tip.hub.z + tip.radius);
    console.log(`[testbed] DA20 proportions: rest ${rig.heightAGL().toFixed(3)} m (pose ${pose.height.toFixed(3)}), pitch ${(rig.euler().pitch * RAD).toFixed(2)} deg, nose share ${(loads[0] / total).toFixed(3)}, 0.3 m drop ${peak.toFixed(2)} g, propeller clearance ${clearance.toFixed(3)} m`);
    // Rest height 1.07 m with the propeller tip 0.31 m clear (three-view), 19 % of the weight on the nosewheel.
    expect(rig.output.crash).toBe('');
    expect(Math.abs(rig.heightAGL() - 1.07)).toBeLessThan(0.03);
    expect(Math.abs(pose.height - rig.heightAGL())).toBeLessThan(0.005);
    expect(Math.abs(rig.euler().pitch)).toBeLessThan(0.5 * DEG);
    expect(Math.abs(total - mass * G0) / (mass * G0)).toBeLessThan(0.01);
    expect(loads[0] / total).toBeGreaterThan(0.18);
    expect(loads[0] / total).toBeLessThan(0.2);
    expect(Math.abs(clearance - 0.31)).toBeLessThan(0.03);
    expect(peak).toBeLessThan(4);

    // Full braking from 25 m/s: light-aircraft deceleration, nothing breaks.
    rig.placeOnGround(0);
    rig.velocity = { x: 25, y: 0, z: 0 };
    rig.run(1);
    const v0 = rig.velocityBody().x;
    const t0 = rig.time;
    rig.run(20, () => {
      rig.controls.brakeLeft = rig.controls.brakeRight = Math.min(1, (rig.time - t0) / 0.3);
      return rig.velocity.x < 0.05;
    });
    const decel = v0 / (rig.time - t0) / G0;
    console.log(`[testbed] DA20 proportions: full braking ${decel.toFixed(3)} g`);
    expect(rig.output.crash).toBe('');
    expect(decel).toBeGreaterThan(0.28);
    expect(decel).toBeLessThan(0.42);
  });
});
