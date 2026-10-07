// Landing-gear behaviour on a 6-DOF rig at 240 Hz. Each test logs its measured numbers.

import { describe, expect, test } from 'vitest';
import { C172 } from '../../src/core/c172';
import { DEG, G0, RAD, quat, v3 } from '../../src/core/math';
import { defaultControls } from '../../src/core/types';
import { LandingGear, classifyImpact } from '../../src/physics/gear';
import { rigidBodyDerivative, rk4Step } from '../../src/physics/rigidBody';
import { DT, GearRig, MASS, planeEnvironment } from './rig';

const W = MASS * G0;
const report = (label: string, values: Record<string, number | string>) =>
  console.log(`[gear] ${label}: ${Object.entries(values).map(([k, v]) => `${k}=${typeof v === 'number' ? +v.toPrecision(4) : v}`).join('  ')}`);

/** Hold the body-axis forward speed near `target` with a thrust-like force at the propeller hub. */
function speedHold(rig: GearRig, target: number): void {
  rig.external = { force: { x: 0, y: 0, z: 0 }, point: C172.prop.hub };
  rig.loads = (r) => {
    r.external!.force.x = Math.max(0, Math.min(3000, 800 + 3000 * (target - r.velocityBody().x)));
    return { force: v3.zero(), moment: v3.zero() };
  };
}

describe('static', () => {
  test('sits at the design height with the right load split, and stays perfectly still', () => {
    const rig = new GearRig();
    rig.placeOnGround(0, 0.02);
    rig.run(10);
    const [nose, left, right] = rig.output.wheels;
    const total = nose.load + left.load + right.load;
    const p0 = { ...rig.position };
    rig.run(30);
    const drift = v3.len(v3.sub(rig.position, p0));
    report('static', {
      height: rig.heightAGL(),
      pitchDeg: rig.euler().pitch * RAD,
      noseShare: nose.load / total,
      noseStrut: nose.compression,
      mainStrut: left.compression,
      drift30s: drift,
      speed: v3.len(rig.velocity),
    });
    expect(Math.abs(rig.heightAGL() - 1.25)).toBeLessThan(0.03);
    expect(Math.abs(total - W) / W).toBeLessThan(0.01);
    expect(nose.load / total).toBeGreaterThan(0.25);
    expect(nose.load / total).toBeLessThan(0.3);
    expect(nose.compression).toBeGreaterThan(0.03);
    expect(nose.compression).toBeLessThan(0.05);
    expect(left.compression).toBeGreaterThan(0.04);
    expect(left.compression).toBeLessThan(0.07);
    expect(Math.abs(left.load - right.load)).toBeLessThan(1);
    expect(drift).toBeLessThan(1e-4);
    expect(v3.len(rig.velocity)).toBeLessThan(1e-5);
  });

  test('restingPose matches the settled simulation', () => {
    const rig = new GearRig();
    const pose = rig.gear.restingPose(MASS, v3.zero());
    rig.placeOnGround(0, 0.02);
    rig.run(10);
    report('restingPose', { height: pose.height, simHeight: rig.heightAGL(), pitchDeg: pose.pitch * RAD, simPitchDeg: rig.euler().pitch * RAD });
    expect(Math.abs(pose.height - rig.heightAGL())).toBeLessThan(0.005);
    expect(Math.abs(pose.pitch - rig.euler().pitch)).toBeLessThan(0.2 * DEG);
  });

  test('parking brake holds 1500 N of thrust without creep; released, the aircraft rolls', () => {
    const rig = new GearRig();
    rig.placeOnGround(0);
    rig.controls.parkingBrake = true;
    rig.external = { force: { x: 1500, y: 0, z: 0 }, point: C172.prop.hub };
    rig.run(10); // let the aircraft finish rocking forward onto the nose oleo
    const p0 = { ...rig.position };
    rig.run(10);
    const creep = v3.len(v3.sub(rig.position, p0));
    report('parked 1500 N', { creep10s: creep, speed: v3.len(rig.velocity), wheelSpin: rig.output.wheels[1].spinRate });
    expect(creep).toBeLessThan(5e-4);
    expect(v3.len(rig.velocity)).toBeLessThan(1e-4);
    expect(rig.output.wheels[1].spinRate).toBe(0);

    rig.controls.parkingBrake = false;
    rig.run(3);
    expect(rig.velocity.x).toBeGreaterThan(2);
  });

  test('brakes hold on an 8 % slope; without brakes the aircraft rolls away', () => {
    const slope = planeEnvironment('runway', { x: 0.08, y: 0, z: -1 });
    const held = new GearRig(slope);
    held.placeOnGround(0);
    held.controls.brakeLeft = held.controls.brakeRight = 1;
    held.run(20);
    const p0 = { ...held.position };
    held.run(10);
    const free = new GearRig(slope);
    free.placeOnGround(0);
    free.run(5);
    report('8% slope', { creepBraked10s: v3.len(v3.sub(held.position, p0)), unbrakedSpeedAfter5s: v3.len(free.velocity) });
    expect(v3.len(v3.sub(held.position, p0))).toBeLessThan(1e-4);
    expect(v3.len(free.velocity)).toBeGreaterThan(2);
  });
});

describe('dynamic', () => {
  test('0.3 m drop settles without bouncing and reports touchdowns', () => {
    const rig = new GearRig();
    rig.placeOnGround(0, 0.3);
    let peak = 0;
    let contacts = 0;
    let wasOn = false;
    let settled = -1;
    const touchdowns: { wheel: string; sinkRate: number }[] = [];
    rig.run(5, (o) => {
      peak = Math.max(peak, -o.force.z / W);
      if (o.onGround && !wasOn) contacts++;
      wasOn = o.onGround;
      touchdowns.push(...o.touchdowns);
      if (settled < 0 && rig.time > 0.3 && Math.abs(rig.velocity.z) < 0.005 && Math.abs(rig.heightAGL() - 1.25) < 0.01) settled = rig.time;
    });
    report('drop 0.3 m', { peakG: peak, contacts, settleTime: settled, touchdowns: touchdowns.map((t) => `${t.wheel}@${t.sinkRate.toFixed(2)}`).join(',') });
    expect(rig.output.crash).toBe('');
    expect(contacts).toBe(1);
    expect(settled).toBeGreaterThan(0);
    expect(settled).toBeLessThan(2);
    expect(peak).toBeLessThan(4);
    expect(touchdowns.map((t) => t.wheel).sort()).toEqual(['left', 'nose', 'right']);
    for (const t of touchdowns) expect(t.sinkRate).toBeGreaterThan(1.8);
  });

  test('full braking from 30 m/s on a dry runway decelerates at light-aircraft rates without locking', () => {
    const rig = new GearRig();
    rig.placeOnGround(0);
    rig.velocity = { x: 30.5, y: 0, z: 0 };
    rig.run(1); // wheels spin up
    const v0 = rig.velocityBody().x;
    const x0 = rig.position.x;
    let steps = 0;
    let skidding = 0;
    const t0 = rig.time;
    rig.run(20, (o) => {
      // Pedals pressed over 0.3 s, as a pilot does.
      rig.controls.brakeLeft = rig.controls.brakeRight = Math.min(1, (rig.time - t0) / 0.3);
      steps++;
      if (o.wheels[1].skid > 0.5) skidding++;
      return rig.velocity.x < 0.05;
    });
    const t = rig.time - t0;
    const decel = v0 / t / G0;
    report('braking', { v0, stopTime: t, distance: rig.position.x - x0, avgDecelG: decel, lockedFraction: skidding / steps });
    expect(decel).toBeGreaterThan(0.3);
    expect(decel).toBeLessThan(0.4);
    expect(skidding / steps).toBeLessThan(0.05);
  });

  test('a steady side load is reacted by tyre cornering forces', () => {
    const rig = new GearRig();
    rig.placeOnGround(0);
    rig.velocity = { x: 20, y: 0, z: 0 };
    rig.run(1);
    const side = 1500;
    rig.external = { force: { x: 0, y: side, z: 0 }, point: v3.zero() };
    rig.run(4);
    const vb = rig.velocityBody();
    const r = rig.angularVelocity.z;
    const tyreSide = rig.output.force.y;
    const centripetal = MASS * vb.x * r;
    // Mean main-gear slip angle vs. the linear cornering-stiffness prediction for the main-gear side force.
    const alphaMain = Math.atan2(vb.y - r * 0.44, vb.x);
    report('side load', {
      applied: side,
      tyreSideForce: tyreSide,
      centripetal,
      balanceError: (side + tyreSide - centripetal) / side,
      driftDeg: Math.atan2(vb.y, vb.x) * RAD,
      mainSlipDeg: alphaMain * RAD,
      yawRate: r,
    });
    // Newton in the body y direction: applied + tyre = m (v_y' + u r), steady v_y.
    expect(Math.abs(side + tyreSide - centripetal) / side).toBeLessThan(0.05);
    expect(tyreSide).toBeLessThan(-400);
    // Slip angles are small (well inside the linear range of the tyre): ~0.5 deg for 1.5 kN.
    expect(Math.abs(alphaMain * RAD)).toBeGreaterThan(0.2);
    expect(Math.abs(alphaMain * RAD)).toBeLessThan(1.5);
    // The aircraft turns gently into the load (castering nosewheel) rather than skidding.
    expect(r).toBeGreaterThan(0);
    expect(r).toBeLessThan(0.1);
  });

  test('taxi turns: 10 degree pedal steering, and a tight turn with differential braking', () => {
    const turn = (brake: number) => {
      const rig = new GearRig();
      rig.placeOnGround(0);
      rig.velocity = { x: 2.5, y: 0, z: 0 };
      rig.controls.rudder = 1;
      rig.controls.brakeRight = brake;
      speedHold(rig, 2.5);
      rig.run(25);
      const v = Math.hypot(rig.velocity.x, rig.velocity.y);
      return { radius: v / rig.angularVelocity.z, steer: rig.output.wheels[0].steerAngle, speed: v };
    };
    const plain = turn(0);
    const braked = turn(1);
    report('taxi turn', {
      radiusSteerOnly: plain.radius,
      steerDeg: plain.steer * RAD,
      radiusWithBrake: braked.radius,
      casterDeg: braked.steer * RAD,
      wingtipRadiusWithBrake: braked.radius + C172.wing.span / 2,
    });
    expect(plain.radius).toBeGreaterThan(8);
    expect(plain.radius).toBeLessThan(11.5);
    expect(braked.radius).toBeGreaterThan(2);
    expect(braked.radius).toBeLessThan(5);
    expect(braked.steer).toBeGreaterThan(15 * DEG);
    expect(braked.steer).toBeLessThanOrEqual(30 * DEG + 1e-9);
  });

  test('the nosewheel does not shimmy at any speed', () => {
    for (const speed of [3, 10, 20, 35, 45]) {
      const rig = new GearRig();
      rig.placeOnGround(0);
      rig.velocity = { x: speed, y: 0, z: 0 };
      rig.run(0.5);
      rig.controls.rudder = 0.6;
      rig.run(0.3);
      rig.controls.rudder = 0;
      let peak = 0;
      let late = 0;
      const release = rig.time;
      rig.run(6, (o) => {
        const s = Math.abs(o.wheels[0].steerAngle);
        peak = Math.max(peak, s);
        if (rig.time > release + 5) late = Math.max(late, s);
      });
      report(`shimmy ${speed} m/s`, { peakDeg: peak * RAD, lastSecondDeg: late * RAD });
      expect(late).toBeLessThan(0.1 * peak);
    }
  });
});

describe('landings and crashes', () => {
  const land = (sink: number, pitch: number, aero: boolean, roll = 0) => {
    const rig = new GearRig();
    rig.placeOnGround(0, 0.05);
    rig.orientation = quat.fromEuler(roll, pitch, 0);
    rig.velocity = { x: 25, y: 0, z: sink };
    if (aero) rig.enableLandingAero();
    let peak = 0;
    rig.run(2, (o) => {
      peak = Math.max(peak, -o.force.z / W);
    });
    return { crash: rig.output.crash, peak };
  };

  test('landing sink-rate tolerance', () => {
    const results: Record<string, string> = {};
    for (const sink of [1, 2, 3, 3.5, 4.5, 6]) {
      const r = land(sink, 6 * DEG, true);
      results[`mainFirst${sink}`] = `${r.peak.toFixed(1)}g ${r.crash || 'ok'}`;
    }
    for (const sink of [2, 2.5, 3.5]) {
      const r = land(sink, 0, true);
      results[`flat${sink}`] = `${r.peak.toFixed(1)}g ${r.crash || 'ok'}`;
    }
    report('landings', results);
    expect(land(3, 6 * DEG, true).crash).toBe('');
    expect(land(2, 0, true).crash).toBe('');
    expect(land(6, 6 * DEG, true).crash).toMatch(/gear collapsed/);
    expect(land(3.5, 0, true).crash).toMatch(/Nose gear collapsed/);
  });

  test('structural strikes', () => {
    /** Aircraft at rest in an attitude, lowered until `point` (body) is `clearance` above the ground, then released. */
    const dropOnto = (roll: number, pitch: number, point: { x: number; y: number; z: number }, clearance: number) => {
      const rig = new GearRig();
      rig.orientation = quat.fromEuler(roll, pitch, 0);
      const below = quat.rotate(rig.orientation, point).z;
      rig.position = { x: 0, y: 0, z: -(120 + below + clearance) };
      rig.run(1.5);
      return rig.output.crash;
    };
    const wingtip = dropOnto(-35 * DEG, 0, { x: -0.1, y: -C172.wing.span / 2, z: -0.79 }, 0.05);
    const prop = dropOnto(0, -27 * DEG, { x: C172.prop.hub.x, y: 0, z: C172.prop.diameter / 2 }, 0.03);

    const hardTail = new GearRig();
    hardTail.placeOnGround(0, 0.8);
    hardTail.orientation = quat.fromEuler(0, 16 * DEG, 0);
    hardTail.velocity = { x: 25, y: 0, z: 2.5 };
    hardTail.run(2);

    // Gentle over-rotation: a pitch-rate servo lifts the nose at ~0.2 rad/s until the tail touches.
    const gentle = new GearRig();
    gentle.placeOnGround(0);
    let tailSpeed = 0;
    gentle.loads = (r) => ({ force: v3.zero(), moment: { x: 0, y: 50000 * (0.25 - r.angularVelocity.y), z: 0 } });
    gentle.run(4, () => {
      tailSpeed = Math.max(tailSpeed, gentle.angularVelocity.y * 4.9);
    });

    // A nose-gear collapse (flat arrival at 4 m/s) drops the nose onto the propeller and cowling.
    const collapse = new GearRig();
    collapse.placeOnGround(0, 0.05);
    collapse.velocity = { x: 25, y: 0, z: 4 };
    collapse.enableLandingAero();
    collapse.run(2);

    const water = new GearRig(planeEnvironment('water'));
    water.placeOnGround(0, 0.1);
    water.run(1);

    report('strikes', {
      wingtip,
      prop,
      hardTail: hardTail.output.crash,
      gentleTailPitchDeg: gentle.euler().pitch * RAD,
      gentleTailSpeed: tailSpeed,
      gentleTail: gentle.output.crash || 'ok',
      collapse: collapse.output.crash,
      collapsePitchDeg: collapse.euler().pitch * RAD,
      water: water.output.crash,
    });
    expect(wingtip).toBe('Left wingtip struck the ground');
    expect(prop).toBe('Propeller strike');
    expect(hardTail.output.crash).toBe('Tail strike');
    expect(gentle.euler().pitch * RAD).toBeGreaterThan(11);
    expect(gentle.output.crash).toBe('');
    expect(collapse.output.crash).toMatch(/^Nose gear collapsed/);
    expect(collapse.output.wheels[0].load).toBe(0);
    expect(collapse.euler().pitch).toBeLessThan(-4 * DEG);
    expect(water.output.crash).toMatch(/water/);
    // The crash reason latches until reset().
    collapse.placeOnGround(0);
    collapse.loads = null;
    collapse.run(0.5);
    expect(collapse.output.crash).toBe('');
  });
});

describe('crash classification', () => {
  /** Aircraft in an attitude, `clearance` m above the ground at its lowest point, flying along `velocity` (NED). */
  const arrive = (pitch: number, velocity: { x: number; y: number; z: number }) => {
    const rig = new GearRig();
    rig.orientation = quat.fromEuler(0, pitch, 0);
    rig.position = { x: 0, y: 0, z: -(120 + 4) };
    rig.velocity = velocity;
    rig.run(1.0);
    return rig.output.crash;
  };

  test('high-energy arrivals are terrain impacts, whatever touches first; landings keep their gear and prop messages', () => {
    const dive = arrive(-77 * DEG, { x: 18, y: 0, z: 80 });
    const shallowFast = arrive(-10 * DEG, { x: 56, y: 0, z: 6 });
    const nosedown = arrive(-20 * DEG, { x: 60, y: 0, z: 10 });
    report('impacts', { dive, shallowFast, nosedown });
    expect(dive).toMatch(/^Terrain impact at 1[56]\d kt, 15\d\d\d fpm descent, 7\d\u00b0 nose down \(propeller first\)$/);
    expect(shallowFast).toMatch(/^Terrain impact at 110 kt/);
    expect(nosedown).toMatch(/^Terrain impact at 1[12]\d kt, \d{4} fpm descent, (19|20|21)\u00b0 nose down/);
    // Absurd leg loads (penalty contact deep in the ground) are not quoted.
    expect(dive).not.toMatch(/kN/);
  });

  test('the classifier', () => {
    expect(classifyImpact({ x: 30, y: 0, z: 2 }, 0)).toBe('');
    expect(classifyImpact({ x: 25, y: 0, z: 6 }, 0)).toBe('');
    expect(classifyImpact({ x: 25, y: 0, z: 8 }, 0)).toMatch(/^Terrain impact at 51 kt, 1575 fpm descent$/);
    expect(classifyImpact({ x: 42, y: 0, z: 8 }, -12 * DEG)).toMatch(/12\u00b0 nose down$/);
  });
});

describe('integration', () => {
  test('works with the RK4 integrator calling compute() at every stage', () => {
    const gear = new LandingGear();
    const env = planeEnvironment();
    const controls = defaultControls();
    const pose = gear.restingPose(MASS, v3.zero());
    const I = { Ixx: C172.mass.Ixx, Iyy: C172.mass.Iyy, Izz: C172.mass.Izz, Ixz: 0 };
    let s = {
      position: { x: 0, y: 0, z: -(120 + pose.height + 0.3) },
      velocity: v3.zero(),
      orientation: quat.fromEuler(0, pose.pitch, 0),
      angularVelocity: v3.zero(),
    };
    let t = 0;
    let peak = 0;
    let touchdowns = 0;
    const offsets = [0, DT / 2, DT / 2, DT];
    for (let i = 0; i < 240 * 8; i++) {
      s = rk4Step(s, DT, (st, stage) => {
        const o = gear.compute({
          body: {
            time: t + offsets[stage],
            position: st.position,
            orientation: st.orientation,
            velocityBody: quat.rotateInv(st.orientation, st.velocity),
            angularVelocity: st.angularVelocity,
            cgOffset: v3.zero(),
            mass: MASS,
          },
          controls,
          env,
          dt: DT,
        });
        if (stage === 0) {
          peak = Math.max(peak, -o.force.z / W);
          touchdowns += o.touchdowns.length;
        }
        return rigidBodyDerivative(st, MASS, I, o);
      });
      t += DT;
    }
    const height = -s.position.z - 120;
    report('rk4 drop 0.3 m', { height, peakG: peak, touchdowns, speed: v3.len(s.velocity) });
    expect(Math.abs(height - 1.25)).toBeLessThan(0.03);
    expect(touchdowns).toBe(3);
    expect(v3.len(s.velocity)).toBeLessThan(1e-3);
  });

  test('cost per compute() call', () => {
    const rig = new GearRig();
    rig.placeOnGround(0);
    rig.velocity = { x: 10, y: 0, z: 0 };
    rig.run(1);
    const body = {
      time: rig.time,
      position: rig.position,
      orientation: rig.orientation,
      velocityBody: rig.velocityBody(),
      angularVelocity: rig.angularVelocity,
      cgOffset: v3.zero(),
      mass: MASS,
    };
    const n = 20000;
    const start = performance.now();
    for (let i = 0; i < n; i++) {
      body.time += DT;
      rig.gear.compute({ body, controls: rig.controls, env: rig.env, dt: DT });
    }
    const us = ((performance.now() - start) / n) * 1000;
    report('performance', { microsecondsPerCall: us });
    expect(us).toBeLessThan(50);
  });
});
