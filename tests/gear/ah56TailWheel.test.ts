// The AH-56A's lockable, full-swivelling tail wheel (SteeringParams.lock; P ASTA-72 App B para 2: "full-swivelling,
// lockable"; para 79: locked for take-off and landing, unlocked for turns) and its gear on the 6-DOF rig with the
// AH-56A's mass and inertia (plan revision 2 section 7.2, G13's ground-handling rows). The thrust that taxis the rig is a
// stand-in for the pusher (stage 4, AC) and the yaw moment for the tail rotor's pedal authority. Each test logs what it
// measured.
import { describe, expect, test } from 'vitest';
import { DEG, KT, RAD, quat, v3, type Vec3 } from '../../src/core/math';
import { SURFACES } from '../../src/physics/gear';
import { WheelDynamics, type WheelContact } from '../../src/physics/gear/tyre';
import { wheelRestingPose } from '../../src/physics/rotorcraft/wheels';
import { ah56Gear } from '../../src/aircraft/ah56/gear';
import { AH56_DEFINITION } from '../../src/aircraft/ah56';
import { AH56_INERTIA } from '../../src/aircraft/ah56/facts';
import { GearRig, planeEnvironment } from './rig';

const report = (label: string, values: Record<string, number | string>) =>
  console.log(`[ah56 gear] ${label}: ${Object.entries(values).map(([k, v]) => `${k}=${typeof v === 'number' ? +v.toPrecision(4) : v}`).join('  ')}`);

const GEAR = ah56Gear();
const TAIL = GEAR.wheels[0];
const MASS = 8301;
const INERTIA: Vec3 = { x: AH56_INERTIA.Ixx, y: AH56_INERTIA.Iyy, z: AH56_INERTIA.Izz };

function contact(speed: number, drift: number, locked: boolean): WheelContact {
  return { va: speed * Math.cos(drift), vb: speed * Math.sin(drift), load: 6500, surface: SURFACES.runway, brakeTorque: 0, steerCommand: 0, locked };
}
function roll(wheel: WheelDynamics, c: WheelContact, seconds: number): void {
  for (let t = 0; t < seconds - 1e-9; t += 1 / 240) wheel.advance(c, 1 / 240);
}

describe('the lock pin (tail wheel alone)', () => {
  test('unlocked the wheel casters to its track; locked and aligned it stays straight and carries the side force', () => {
    const free = new WheelDynamics(TAIL.tyre, TAIL.steering);
    free.spin = 4 / TAIL.tyre.radius;
    roll(free, contact(4, 20 * DEG, false), 3);
    const pinned = new WheelDynamics(TAIL.tyre, TAIL.steering);
    pinned.spin = 4 / TAIL.tyre.radius;
    const c = contact(4, 20 * DEG, true);
    roll(pinned, c, 3);
    const side = pinned.force(c, { fa: 0, fb: 0, skid: 0 }).fb;
    report('lock', { freeSteerDeg: free.steer * RAD, pinnedSteerDeg: pinned.steer * RAD, pinnedSideForceN: side });
    expect(free.steer * RAD).toBeGreaterThan(15);
    expect(pinned.steer).toBe(0);
    expect(Math.abs(side)).toBeGreaterThan(500);
  });

  test('locked while swung over, the pin drops in only when the wheel swings back within 2 deg of centre', () => {
    const w = new WheelDynamics(TAIL.tyre, TAIL.steering);
    w.spin = 4 / TAIL.tyre.radius;
    roll(w, contact(4, 30 * DEG, false), 3);
    expect(w.steer * RAD).toBeGreaterThan(20);
    // Lock selected while still on the 30 deg track: it keeps castering.
    roll(w, contact(4, 30 * DEG, true), 1);
    expect(w.steer * RAD).toBeGreaterThan(20);
    // Back on a straight track it swings toward centre, the pin engages and holds it there.
    roll(w, contact(4, 0, true), 3);
    expect(w.steer).toBe(0);
  });
});

/** The rig at rest on the AH-56A's wheels (wheelRestingPose: the tail wheel lies aft of the mains). */
function onWheels(heading = 0): GearRig {
  const rig = new GearRig(planeEnvironment(), MASS, GEAR, INERTIA);
  const pose = wheelRestingPose(AH56_DEFINITION.geometry.gear, MASS, v3.zero());
  rig.position = { x: 0, y: 0, z: -(rig.env.groundElevation(0, 0) + pose.height) };
  rig.orientation = quat.fromEuler(pose.roll, pose.pitch, heading);
  rig.controls.parkingBrake = false;
  return rig;
}
/** Hold the forward speed with a thrust at the CG (the pusher's stand-in); add a yaw moment (the tail rotor's). */
function drive(rig: GearRig, target: number, yawMoment = 0): void {
  rig.loads = (r) => ({ force: { x: Math.max(0, Math.min(15e3, 2500 + 8000 * (target - r.velocityBody().x))), y: 0, z: 0 },
    moment: { x: 0, y: 0, z: yawMoment } });
}

describe('the AH-56A on its wheels (rig)', () => {
  test('rests level on three wheels at the design loading; the tail wheel carries about 8 %', () => {
    const rig = onWheels();
    rig.run(3);
    const loads = rig.output.wheels.map((w) => w.load);
    const e = rig.euler();
    report('rest', { tailKN: loads[0] / 1e3, leftKN: loads[1] / 1e3, rightKN: loads[2] / 1e3, pitchDeg: e.pitch * RAD, rollDeg: e.roll * RAD,
      settleMm: (rig.heightAGL() - wheelRestingPose(AH56_DEFINITION.geometry.gear, MASS, v3.zero()).height) * 1e3 });
    expect(loads.every((l) => l > 0)).toBe(true);
    expect(loads[0] / loads.reduce((a, b) => a + b, 0)).toBeCloseTo(0.08, 1);
    expect(Math.abs(e.pitch)).toBeLessThan(0.5 * DEG);
    expect(Math.abs(rig.heightAGL() - wheelRestingPose(AH56_DEFINITION.geometry.gear, MASS, v3.zero()).height)).toBeLessThan(0.01);
  });

  test('tail wheel locked at 15 kt: after a half-second brake tap it tracks straight within 2 deg over 200 m', () => {
    const track = (locked: boolean) => {
      const rig = onWheels();
      rig.controls.tailWheelLock = locked;
      rig.velocity = { x: 15 * KT, y: 0, z: 0 };
      drive(rig, 15 * KT);
      rig.controls.brakeRight = 0.5;
      rig.run(0.5);
      rig.controls.brakeRight = 0;
      const start = { ...rig.position };
      let worst = 0;
      const wrap = (h: number) => Math.atan2(Math.sin(h), Math.cos(h));
      rig.run(60, () => {
        worst = Math.max(worst, Math.abs(wrap(rig.euler().heading)));
        return Math.hypot(rig.position.x - start.x, rig.position.y - start.y) > 200;
      });
      return worst;
    };
    const locked = track(true), free = track(false);
    report('brake tap 15 kt', { lockedWorstHeadingDeg: locked * RAD, unlockedWorstHeadingDeg: free * RAD, target: '<= 2 locked' });
    expect(locked * RAD).toBeLessThanOrEqual(2);
    expect(free).toBeGreaterThan(locked);
  });

  test('tail wheel unlocked: the tail rotor and the inside brake turn it within a 10 m radius; locked the turn is far wider', () => {
    const turn = (locked: boolean) => {
      const rig = onWheels();
      rig.controls.tailWheelLock = locked;
      rig.velocity = { x: 5 * KT, y: 0, z: 0 };
      // Part left pedal: about 15 kN m of tail-rotor yaw moment (ESTIMATE), and some left (inside) brake.
      drive(rig, 5 * KT, -15e3);
      rig.controls.brakeLeft = 0.3;
      rig.run(10);
      const v = Math.hypot(rig.velocity.x, rig.velocity.y), r = Math.abs(rig.angularVelocity.z);
      return { radius: v / Math.max(r, 1e-6), speedKt: v / KT, yawRateDeg: r * RAD };
    };
    const free = turn(false), locked = turn(true);
    report('turn', { unlockedRadiusM: free.radius, unlockedKt: free.speedKt, lockedRadiusM: locked.radius, lockedKt: locked.speedKt,
      target: '<= 10 m unlocked' });
    expect(free.radius).toBeLessThanOrEqual(10);
    expect(locked.radius).toBeGreaterThan(2 * free.radius);
  });

  test('a hard tail-first arrival collapses the leg in the tail wheel\'s words', () => {
    const rig = new GearRig(planeEnvironment(), MASS, GEAR, INERTIA);
    const pose = wheelRestingPose(AH56_DEFINITION.geometry.gear, MASS, v3.zero());
    rig.position = { x: 0, y: 0, z: -(rig.env.groundElevation(0, 0) + pose.height + 0.6) };
    rig.orientation = quat.fromEuler(0, 12 * DEG, 0);
    rig.velocity = { x: 0, y: 0, z: 9 };
    rig.run(1);
    report('tail-first', { crash: rig.output.crash });
    expect(rig.output.crash.toLowerCase()).toContain('tail');
  });
});
