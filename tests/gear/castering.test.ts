// The free-castering nosewheel (SteeringParams.mode 'castering'): the wheel alone with prescribed contact
// kinematics, then on the 6-DOF rig with the C172S gear (CASTER_GEAR) and with an aircraft of DA20-C1
// proportions (DA20_LIKE). Each test states the physical fact it checks and logs what it measured.

import { describe, expect, test } from 'vitest';
import { C172 } from '../../src/core/c172';
import { DEG, G0, RAD, quat, v3, type Vec3 } from '../../src/core/math';
import { defaultControls } from '../../src/core/types';
import type { GearOutput } from '../../src/physics/interfaces';
import { C172_GEAR, LandingGear, SURFACES, type GearConfig } from '../../src/physics/gear';
import { rigidBodyDerivative, rk4Step } from '../../src/physics/rigidBody';
import { WheelDynamics, type SteeringParams, type WheelContact } from '../../src/physics/gear/tyre';
import { DT, GearRig, MASS, planeEnvironment } from './rig';
import { CASTER_GEAR, DA20_CASTER, DA20_LIKE, casterGear } from './testbed';

const report = (label: string, values: Record<string, number | string>) =>
  console.log(`[caster] ${label}: ${Object.entries(values).map(([k, v]) => `${k}=${typeof v === 'number' ? +v.toPrecision(4) : v}`).join('  ')}`);

const NOSE = C172_GEAR.wheels[0].tyre;
const LOAD = 1500;
const FRICTIONLESS: SteeringParams = { ...DA20_CASTER, friction: 0 };

/** A nosewheel rolling at `speed` whose contact patch moves `drift` rad to the right of the aircraft's heading. */
function contact(speed: number, drift: number, extra: Partial<WheelContact> = {}): WheelContact {
  return { va: speed * Math.cos(drift), vb: speed * Math.sin(drift), load: LOAD, surface: SURFACES.runway, brakeTorque: 0, steerCommand: 0, ...extra };
}

function roll(wheel: WheelDynamics, c: WheelContact, seconds: number): void {
  for (let t = 0; t < seconds - 1e-9; t += DT) wheel.advance(c, DT);
}

interface Aircraft { name: string; mass: number; inertia: Readonly<Vec3>; gear: GearConfig; hub: Vec3 }
const C172_CASTER: Aircraft = { name: 'C172S gear', mass: MASS, inertia: { x: C172.mass.Ixx, y: C172.mass.Iyy, z: C172.mass.Izz }, gear: CASTER_GEAR, hub: C172.prop.hub };
const DA20: Aircraft = { name: 'DA20 proportions', mass: DA20_LIKE.mass, inertia: DA20_LIKE.inertia, gear: DA20_LIKE.gear, hub: DA20_LIKE.gear.propellers![0].hub };

function rigOf(a: Aircraft, steering?: SteeringParams): GearRig {
  return new GearRig(planeEnvironment(), a.mass, steering ? casterGear(a.gear, steering) : a.gear, a.inertia);
}

/** Hold the body-axis forward speed near `target` with a thrust-like force at the propeller hub (as gear.test.ts). */
function speedHold(rig: GearRig, target: number, hub: Vec3): void {
  rig.external = { force: { x: 0, y: 0, z: 0 }, point: hub };
  rig.loads = (r) => {
    r.external!.force.x = Math.max(0, Math.min(3000, 800 + 3000 * (target - r.velocityBody().x)));
    return { force: v3.zero(), moment: v3.zero() };
  };
}

/** Direction in which the nosewheel's contact point is moving, rad right of the aircraft's heading. */
function noseDrift(rig: GearRig): number {
  const vb = rig.velocityBody();
  return Math.atan2(vb.y + rig.angularVelocity.z * rig.config.wheels[0].position.x, vb.x);
}

describe('castering wheel alone', () => {
  test('the pedal command does not reach the wheel, and the unused linkage parameters may be zero', () => {
    expect(DA20_CASTER.maxCommand).toBe(0);
    expect(DA20_CASTER.linkStiffness).toBe(0);
    const wheel = new WheelDynamics(NOSE, DA20_CASTER);
    wheel.spin = 10 / NOSE.radius;
    roll(wheel, contact(10, 0, { steerCommand: 20 * DEG }), 2);
    expect(wheel.steer).toBe(0);
    expect(Number.isFinite(wheel.alpha) && Number.isFinite(wheel.spin)).toBe(true);

    // The same wheel on the C172S bungee linkage follows the command (short of it by what the bungee yields).
    const linked = new WheelDynamics(NOSE, C172_GEAR.wheels[0].steering);
    linked.spin = 10 / NOSE.radius;
    roll(linked, contact(10, 0, { steerCommand: 8 * DEG }), 2);
    expect(linked.steer).toBeGreaterThan(4 * DEG);
  });

  test('without friction the wheel points where it is going and carries no side force', () => {
    for (const drift of [-25, 3, 12, 40]) {
      const wheel = new WheelDynamics(NOSE, FRICTIONLESS);
      wheel.spin = 8 / NOSE.radius;
      const c = contact(8, drift * DEG);
      roll(wheel, c, 3);
      const f = wheel.force(c, { fa: 0, fb: 0, skid: 0 });
      // Side force in the wheel's own axes.
      const side = -f.fa * Math.sin(wheel.steer) + f.fb * Math.cos(wheel.steer);
      report(`alignment ${drift} deg`, { steerDeg: wheel.steer * RAD, sideForce: side });
      expect(Math.abs(wheel.steer * RAD - drift)).toBeLessThan(0.01);
      expect(Math.abs(side)).toBeLessThan(0.5);
    }
    // Beyond the swivel stops the wheel stays on the stop and scrubs.
    const wheel = new WheelDynamics(NOSE, FRICTIONLESS);
    wheel.spin = 8 / NOSE.radius;
    roll(wheel, contact(8, 75 * DEG), 3);
    expect(wheel.steer).toBe(DA20_CASTER.casterLimit);
  });

  test('Coulomb friction holds the wheel while the aligning moment is below it', () => {
    const friction = DA20_CASTER.friction!;
    // Side force of a tyre in its linear range: C_alpha N tan(slip). The swivel breaks away at friction / trail.
    const breakaway = Math.atan(friction / DA20_CASTER.trail / (NOSE.corneringStiffness * LOAD));
    const held = new WheelDynamics(NOSE, DA20_CASTER);
    held.spin = 8 / NOSE.radius;
    roll(held, contact(8, 0.8 * breakaway), 3);
    expect(held.steer).toBe(0);

    // Above it the wheel turns toward its direction of travel and stops once the moment has fallen to the
    // friction: within the breakaway angle of its track (an underdamped swivel may stop just past it), holding
    // less than friction / trail.
    const free = new WheelDynamics(NOSE, DA20_CASTER);
    free.spin = 8 / NOSE.radius;
    const c = contact(8, 10 * DEG);
    roll(free, c, 3);
    const f = free.force(c, { fa: 0, fb: 0, skid: 0 });
    const side = -f.fa * Math.sin(free.steer) + f.fb * Math.cos(free.steer);
    report('friction', { breakawayDeg: breakaway * RAD, restsShortDeg: 10 - free.steer * RAD, heldSideForce: side, frictionOverTrail: friction / DA20_CASTER.trail });
    expect(Math.abs(side) * DA20_CASTER.trail).toBeLessThanOrEqual(friction);
    expect(Math.abs(10 * DEG - free.steer)).toBeLessThan(breakaway);
    // The frictionless wheel in the same conditions ends on its track (previous test); this one moved most of the way.
    expect(free.steer).toBeGreaterThan(9.5 * DEG);
  });

  test('the swivel loop is the second-order system of tyre.ts: its slow root is the measured decay rate', () => {
    // s^2 + ((V + trail K) / sigma) s + (V / sigma) K = 0 with K = C_alpha N trail / damper (trail K / sigma: the
    // patch moving with the swivel). A heavy damper separates the roots: at 40 m/s K = 8.4 /s and the slow root
    // is 8.77 /s.
    const st: SteeringParams = { ...FRICTIONLESS, damper: 100 };
    const speed = 40;
    const K = (NOSE.corneringStiffness * LOAD * st.trail) / st.damper;
    const a = (speed + st.trail * K) / NOSE.relaxationLat;
    const slow = (a - Math.sqrt(a * a - (4 * speed * K) / NOSE.relaxationLat)) / 2;
    const wheel = new WheelDynamics(NOSE, st);
    wheel.spin = speed / NOSE.radius;
    wheel.steer = 0.5 * DEG;
    const c = contact(speed, 0);
    roll(wheel, c, 0.2);
    const s0 = wheel.steer;
    roll(wheel, c, 0.2);
    const measured = Math.log(s0 / wheel.steer) / 0.2;
    report('swivel loop', { K, slowRoot: slow, measured });
    expect(K).toBeCloseTo(8.4, 6);
    expect(Math.abs(measured - slow) / slow).toBeLessThan(0.02);
  });

  test('a swivel with next to no damping is still integrated stably: the internal steps follow the loop rate', () => {
    // K = C_alpha N trail / damper = 16 800 /s, and the swivel mode sqrt(V K / sigma) = 1600 rad/s at 40 m/s:
    // far beyond the 240 Hz physics rate, lightly damped (0.05 of critical), and it must still die out.
    const wheel = new WheelDynamics(NOSE, { ...FRICTIONLESS, damper: 0.05 });
    wheel.spin = 40 / NOSE.radius;
    const c = contact(40, 12 * DEG);
    let peak = 0;
    for (let i = 0; i < 480; i++) {
      wheel.advance(c, DT);
      peak = Math.max(peak, Math.abs(wheel.steer));
    }
    report('undamped swivel', { steerDeg: wheel.steer * RAD, peakDeg: peak * RAD });
    expect(wheel.steer * RAD).toBeCloseTo(12, 3);
    expect(peak).toBeLessThan(24 * DEG);
  });

  test('off the ground the wheel centres as a linked wheel does', () => {
    const wheel = new WheelDynamics(NOSE, DA20_CASTER);
    wheel.steer = 30 * DEG;
    roll(wheel, { ...contact(0, 0), load: 0 }, DA20_CASTER.centeringTime);
    expect(wheel.steer / (30 * DEG)).toBeCloseTo(Math.exp(-1), 6);
  });
});

describe.each([C172_CASTER, DA20])('castering nosewheel on the rig: $name', (aircraft) => {
  const nose = aircraft.gear.wheels[0];
  const main = aircraft.gear.wheels[2];
  const wheelbase = nose.position.x - main.position.x;
  const halfTrack = main.position.y;
  const staticNoseLoad = aircraft.mass * G0 * (-main.position.x / wheelbase);

  test('parked, the aircraft and its nosewheel stay perfectly still', () => {
    const rig = rigOf(aircraft);
    rig.placeOnGround(0, 0.02);
    rig.run(10);
    const p0 = { ...rig.position };
    const total = rig.output.wheels.reduce((sum, w) => sum + w.load, 0);
    rig.run(30);
    report(`${aircraft.name} parked`, { drift30s: v3.len(v3.sub(rig.position, p0)), noseShare: rig.output.wheels[0].load / total, steer: rig.output.wheels[0].steerAngle });
    expect(v3.len(v3.sub(rig.position, p0))).toBeLessThan(1e-4);
    expect(rig.output.wheels[0].steerAngle).toBe(0);
    expect(rig.output.crash).toBe('');
  });

  test('pedal alone does not steer', () => {
    const rig = rigOf(aircraft);
    rig.placeOnGround(0);
    rig.velocity = { x: 2.5, y: 0, z: 0 };
    rig.controls.rudder = 1;
    speedHold(rig, 2.5, aircraft.hub);
    rig.run(10);
    expect(rig.output.wheels[0].steerAngle).toBe(0);
    expect(rig.angularVelocity.z).toBe(0);
    expect(rig.position.y).toBe(0);
    expect(rig.position.x).toBeGreaterThan(20);
  });

  test('a toe brake steers: the aircraft turns toward the braked wheel and the nosewheel follows its own track', () => {
    const turn = (brake: number) => {
      const rig = rigOf(aircraft);
      rig.placeOnGround(0);
      rig.velocity = { x: 2.5, y: 0, z: 0 };
      rig.controls.brakeRight = brake;
      speedHold(rig, 2.5, aircraft.hub);
      rig.run(25);
      return { radius: rig.velocityBody().x / rig.angularVelocity.z, steer: rig.output.wheels[0].steerAngle, drift: noseDrift(rig), crash: rig.output.crash };
    };
    const light = turn(0.3);
    const full = turn(1);
    // A swivel held by its friction leaves the wheel short of its track by at most the breakaway slip angle.
    const breakaway = Math.atan(DA20_CASTER.friction! / DA20_CASTER.trail / (nose.tyre.corneringStiffness * 0.7 * staticNoseLoad));
    report(`${aircraft.name} brake turn`, { radiusLight: light.radius, radiusFull: full.radius, steerDeg: full.steer * RAD, trackDeg: full.drift * RAD, breakawayDeg: breakaway * RAD });
    expect(light.crash + full.crash).toBe('');
    expect(light.radius).toBeGreaterThan(0);
    expect(full.radius).toBeLessThan(light.radius / 2);
    expect(full.radius).toBeLessThan(3);
    expect(full.steer).toBeGreaterThan(25 * DEG);
    for (const t of [light, full]) expect(Math.abs(t.steer - t.drift)).toBeLessThan(breakaway + 0.3 * DEG);
  });

  test('pivoting about a locked main wheel sets the nosewheel at atan(wheelbase / half track), or on its stop', () => {
    const rig = rigOf(aircraft);
    rig.placeOnGround(0);
    rig.run(1);
    const start = rig.config.wheels[2].position;
    rig.controls.brakeRight = 1;
    rig.external = { force: { x: 600, y: 0, z: 0 }, point: aircraft.hub };
    rig.run(5);
    const heading = rig.euler().heading;
    // Where the braked wheel's contact point is now (level ground, small attitude changes).
    const wheel = { x: rig.position.x + Math.cos(heading) * start.x - Math.sin(heading) * start.y, y: rig.position.y + Math.sin(heading) * start.x + Math.cos(heading) * start.y };
    const moved = Math.hypot(wheel.x - start.x, wheel.y - start.y);
    const kinematic = Math.min(Math.atan(wheelbase / halfTrack), DA20_CASTER.casterLimit);
    report(`${aircraft.name} pivot`, { headingDeg: heading * RAD, steerDeg: rig.output.wheels[0].steerAngle * RAD, kinematicDeg: kinematic * RAD, brakedWheelMoved: moved, spin: rig.output.wheels[2].spinRate });
    expect(heading).toBeGreaterThan(30 * DEG);
    expect(rig.output.wheels[2].spinRate).toBe(0);
    expect(moved).toBeLessThan(0.1);
    expect(Math.abs(rig.output.wheels[0].steerAngle - kinematic)).toBeLessThan(1 * DEG);
    expect(rig.output.crash).toBe('');
  });

  test('no shimmy from 5 to 40 m/s: after a swerve the wheel only follows the aircraft, which settles', () => {
    for (const friction of [0, DA20_CASTER.friction!, 3 * DA20_CASTER.friction!]) {
      for (const speed of [5, 10, 20, 30, 40]) {
        const rig = rigOf(aircraft, { ...DA20_CASTER, friction });
        rig.placeOnGround(0);
        rig.velocity = { x: speed, y: 0, z: 0 };
        rig.run(0.5);
        rig.controls.brakeRight = 1;
        rig.run(0.3);
        rig.controls.brakeRight = 0;
        const release = rig.time;
        let offTrack = 0;
        let reversals = 0;
        let direction = 0;
        let previous = rig.output.wheels[0].steerAngle;
        const early = { min: Infinity, max: -Infinity };
        const late = { min: Infinity, max: -Infinity };
        let lateYawRate = 0;
        rig.run(14, (o) => {
          const steer = o.wheels[0].steerAngle;
          const t = rig.time - release;
          offTrack = Math.max(offTrack, Math.abs(steer - noseDrift(rig)));
          const d = Math.sign(steer - previous);
          previous = steer;
          if (d !== 0) {
            if (direction !== 0 && d !== direction) reversals++;
            direction = d;
          }
          const window = t < 2 ? early : t > 12 ? late : null;
          if (window) {
            window.min = Math.min(window.min, steer);
            window.max = Math.max(window.max, steer);
          }
          if (t > 12) lateYawRate = Math.max(lateYawRate, Math.abs(rig.angularVelocity.z));
        });
        // What a swivel held by friction can leave behind: a side force of friction / trail at the nosewheel,
        // balanced in yaw by the mains (arm b) and turning the aircraft at r = F (1 + xn / b) / (m u).
        const u = rig.velocityBody().x;
        const held = ((friction / DA20_CASTER.trail) * (1 + nose.position.x / -main.position.x)) / (aircraft.mass * u);
        report(`${aircraft.name} swerve ${speed} m/s, friction ${friction}`, {
          offTrackDeg: offTrack * RAD, reversals, earlyDeg: (early.max - early.min) * RAD, lateDeg: (late.max - late.min) * RAD, lateYawRate, heldBound: held,
        });
        expect(rig.output.crash).toBe('');
        // The wheel never leaves its own track by more than its friction can hold it off plus the lag of a
        // degree-sized swerve: it does not oscillate about its swivel.
        expect(offTrack).toBeLessThan(Math.atan(friction / DA20_CASTER.trail / (nose.tyre.corneringStiffness * staticNoseLoad)) + 0.7 * DEG);
        // Shimmy is 5-30 Hz; what there is, is the aircraft's own yaw oscillation at about 0.5 Hz.
        expect(reversals).toBeLessThan(20);
        expect(late.max - late.min).toBeLessThanOrEqual(0.08 * (early.max - early.min));
        // What is left of the turn: at most what the held swivel sustains, plus the slow tail of the next test.
        expect(lateYawRate).toBeLessThanOrEqual(held * 1.3 + 0.004);
      }
    }
  });

  test('at taxi speed a turn started with the brake dies away at the rate m b u / (Izz + m b^2)', () => {
    // Free-rolling mains do not resist yaw about the middle of their axle, and a free nosewheel resists nothing:
    // only the centre of gravity, b ahead of the axle, has to be turned with the aircraft (v = b r, side force
    // m (b r' + u r) on the mains at arm b). This is why a castering type must be stopped from turning. The
    // rolling resistance of the outer, more heavily loaded wheel adds a few per cent.
    const rig = rigOf(aircraft, FRICTIONLESS);
    rig.placeOnGround(0);
    rig.velocity = { x: 3, y: 0, z: 0 };
    speedHold(rig, 3, aircraft.hub);
    rig.controls.brakeRight = 0.4;
    rig.run(2);
    rig.controls.brakeRight = 0;
    rig.run(1);
    const r0 = rig.angularVelocity.z;
    const u0 = rig.velocityBody().x;
    rig.run(2);
    const u = (u0 + rig.velocityBody().x) / 2;
    const b = -main.position.x;
    const predicted = (aircraft.mass * b * u) / (aircraft.inertia.z + aircraft.mass * b * b);
    const measured = Math.log(r0 / rig.angularVelocity.z) / 2;
    report(`${aircraft.name} turn decay`, { yawRate0: r0, speed: u, predicted, measured });
    expect(r0).toBeGreaterThan(0.1);
    expect(measured / predicted).toBeGreaterThan(1);
    expect(measured / predicted).toBeLessThan(1.15);
  });

  test('the yaw oscillation behind a swerve at speed is that of an aircraft held by its mains alone', () => {
    // Two-wheel model, nosewheel free, mains with cornering stiffness C at arm b behind the centre of gravity:
    //   s^2 + (C / u)(1 / m + b^2 / Izz) s + C b / Izz = 0.
    const speed = 40;
    const swerve = (config: GearConfig) => {
      const rig = new GearRig(planeEnvironment(), aircraft.mass, config, aircraft.inertia);
      const mains = config.wheels[2];
      rig.placeOnGround(0);
      rig.velocity = { x: speed, y: 0, z: 0 };
      rig.run(0.5);
      const C = mains.tyre.corneringStiffness * (rig.output.wheels[1].load + rig.output.wheels[2].load);
      const b = -mains.position.x;
      rig.controls.brakeRight = 0.3;
      rig.run(0.2);
      rig.controls.brakeRight = 0;
      rig.run(0.5);
      const crossings: number[] = [];
      const peaks: number[] = [];
      let peak = 0;
      let last = rig.angularVelocity.z;
      const u0 = rig.velocityBody().x;
      rig.run(6, () => {
        const r = rig.angularVelocity.z;
        if (r * last < 0) {
          crossings.push(rig.time);
          if (crossings.length > 1) peaks.push(peak);
          peak = 0;
        }
        peak = Math.max(peak, Math.abs(r));
        last = r;
      });
      const u = (u0 + rig.velocityBody().x) / 2;
      const omega = Math.sqrt((C * b) / aircraft.inertia.z);
      const zeta = ((C / u) * (1 / aircraft.mass + (b * b) / aircraft.inertia.z)) / (2 * omega);
      const decrement = Math.log(peaks[0] / peaks[1]);
      return {
        period: (2 * Math.PI) / (omega * Math.sqrt(1 - zeta * zeta)),
        measuredPeriod: (2 * (crossings[3] - crossings[0])) / 3,
        zeta,
        measuredZeta: decrement / Math.hypot(Math.PI, decrement),
        crash: rig.output.crash,
      };
    };
    // The model is planar. Made planar (centre of gravity 0.25 m above the tyres, so side force does not roll
    // the aircraft on its legs; a tenth of the tyre's relaxation length; a quick swivel) the rig reproduces it.
    const base = casterGear(aircraft.gear, { ...FRICTIONLESS, damper: 1 });
    const lift = nose.position.z - nose.tyre.radius - 0.1;
    const planar: GearConfig = {
      ...base,
      structure: [],
      propellers: [],
      wheels: base.wheels.map((w) => ({ ...w, position: { ...w.position, z: w.position.z - lift }, tyre: { ...w.tyre, relaxationLat: w.tyre.relaxationLat / 10 } })) as unknown as GearConfig['wheels'],
    };
    const flat = swerve(planar);
    report(`${aircraft.name} yaw mode at ${speed} m/s, planar`, flat);
    expect(flat.crash).toBe('');
    expect(Math.abs(flat.measuredPeriod - flat.period) / flat.period).toBeLessThan(0.03);
    expect(Math.abs(flat.measuredZeta - flat.zeta) / flat.zeta).toBeLessThan(0.06);
    // The aircraft as it stands has the same mode; rolling on its legs, the tyres' relaxation and the swivel's
    // lag take up to a third of the damping away.
    const real = swerve(casterGear(aircraft.gear, FRICTIONLESS));
    report(`${aircraft.name} yaw mode at ${speed} m/s`, real);
    expect(real.crash).toBe('');
    expect(Math.abs(real.measuredPeriod - real.period) / real.period).toBeLessThan(0.1);
    expect(real.measuredZeta / real.zeta).toBeGreaterThan(0.65);
    expect(real.measuredZeta / real.zeta).toBeLessThan(1);
  });
});

// ---- review Bm F1: the contact patch moves sideways as the wheel swivels about its offset pivot --------------
//
// A swivel rate delta' moves the patch, which trails the pivot by e, sideways at -e delta': the slip velocity is
// vy = -V delta - e delta', not -V delta. That term is the trailing wheel's own damping (Pacejka ch. 6); left
// out, the free wheel overshoots at taxi speed and a parked wheel keeps turning on its stored tread deflection.

const DA20_NOSE = DA20_LIKE.gear.wheels[0].tyre;
const DA20_NOSE_LOAD = 0.19 * DA20_LIKE.mass * G0;

/**
 * The linearised swivel of tyre.ts, x = (delta, alpha), small angles, wheel rolling straight at V:
 *   (c + e^2 cd) delta' = -e B alpha - e cd V delta        sigma alpha' + V alpha = V delta + e delta'
 * B = C_alpha N, cd the low-speed tread damping. `patch` false leaves the e delta' terms out (the old law).
 * Integrated finely (RK4, 20 us); returns the deepest point of the response over its start (negative = overshoot).
 */
function linearSwivel(V: number, patch: boolean, seconds = 4): number {
  const e = FRICTIONLESS.trail;
  const c = FRICTIONLESS.damper;
  const B = DA20_NOSE.corneringStiffness * DA20_NOSE_LOAD;
  const sigma = DA20_NOSE.relaxationLat;
  const cd = DA20_NOSE.lowSpeedDamping * DA20_NOSE_LOAD * Math.max(0, 1 - V / 2.5);
  const f = (d: number, a: number): [number, number] => {
    const dd = (-e * B * a - e * cd * V * d) / (patch ? c + e * e * cd : c);
    return [dd, (V * d + (patch ? e * dd : 0) - V * a) / sigma];
  };
  const h = 2e-5;
  let d = 1;
  let a = 0;
  let low = 1;
  for (let i = 0; i < seconds / h; i++) {
    const k1 = f(d, a);
    const k2 = f(d + (h / 2) * k1[0], a + (h / 2) * k1[1]);
    const k3 = f(d + (h / 2) * k2[0], a + (h / 2) * k2[1]);
    const k4 = f(d + h * k3[0], a + h * k3[1]);
    d += (h / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]);
    a += (h / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]);
    low = Math.min(low, d);
  }
  return low;
}

/** The DA20 nosewheel alone, frictionless, rolling straight at V from `start` rad: the deepest point over its start. */
function swivelResponse(V: number, start: number, seconds = 4): number {
  const wheel = new WheelDynamics(DA20_NOSE, FRICTIONLESS);
  wheel.spin = V / DA20_NOSE.radius;
  wheel.steer = start;
  const c: WheelContact = { va: V, vb: 0, load: DA20_NOSE_LOAD, surface: SURFACES.runway, brakeTorque: 0, steerCommand: 0 };
  let low = start;
  for (let t = 0; t < seconds - 1e-9; t += DT) {
    wheel.advance(c, DT);
    low = Math.min(low, wheel.steer);
  }
  return low / start;
}

describe('the contact patch swings with the wheel (review Bm F1)', () => {
  test('small misalignment: the response is that of the linearised equations WITH the patch term, 0.25 to 40 m/s', () => {
    for (const V of [0.25, 1, 3, 10, 40]) {
      const measured = swivelResponse(V, 2 * DEG);
      const withTerm = linearSwivel(V, true);
      const without = linearSwivel(V, false);
      report(`patch term V=${V}`, { measuredOvershoot: -measured, theoryWith: -withTerm, theoryWithout: -without });
      expect(Math.abs(measured - withTerm)).toBeLessThan(0.02);
    }
    // The test can tell the two laws apart: without the term the wheel overshoots by a third at 1 m/s.
    expect(-linearSwivel(1, false)).toBeGreaterThan(0.25);
    expect(-linearSwivel(1, true)).toBeLessThan(0.05);
  });

  test('at walking pace a wheel 20 deg off its track aligns like a shopping cart, without swinging through', () => {
    for (const V of [0.25, 0.5, 1]) {
      const overshoot = -swivelResponse(V, 20 * DEG) * 20;
      report(`kinematic alignment V=${V}`, { overshootDeg: overshoot });
      expect(overshoot).toBeLessThan(1);
    }
  });

  test('parked after a braked stop with the wheel turned, the wheel stays where it stopped', () => {
    const rig = new GearRig(planeEnvironment(), DA20_LIKE.mass, DA20_LIKE.gear, DA20_LIKE.inertia);
    rig.placeOnGround(0);
    rig.run(1);
    rig.velocity = { x: 3, y: 0, z: 0 };
    (rig.gear as unknown as { wheels: { dyn: WheelDynamics }[] }).wheels[0].dyn.steer = 20 * DEG;
    rig.controls.brakeLeft = rig.controls.brakeRight = 1;
    rig.run(3);
    const stopped = rig.output.wheels[0].steerAngle;
    const p0 = { ...rig.position };
    rig.run(5);
    const after = rig.output.wheels[0].steerAngle;
    report('parked after a braked stop', { steerAtStopDeg: stopped * RAD, after5sDeg: after * RAD, creep: v3.len(v3.sub(rig.position, p0)) });
    expect(Math.abs(after - stopped)).toBeLessThan(1 * DEG);
    expect(rig.output.crash).toBe('');
  });
});

describe('integration', () => {
  test('with the RK4 integrator calling compute() at every stage the pivot and the swerve come out the same', () => {
    // The flight model's integrator: the gear's internal states advance by the increase of body.time, half a
    // step at stages 1 and 3. The castering swivel must be as indifferent to that as the linked one is.
    const env = planeEnvironment();
    const controls = defaultControls();
    const I = { Ixx: C172.mass.Ixx, Iyy: C172.mass.Iyy, Izz: C172.mass.Izz, Ixz: 0 };
    const offsets = [0, DT / 2, DT / 2, DT];
    const fly = (seconds: number, speed: number, thrust: number, each: (t: number, yawRate: number, o: GearOutput) => void) => {
      const gear = new LandingGear(CASTER_GEAR);
      const pose = gear.restingPose(MASS, v3.zero());
      let s = { position: { x: 0, y: 0, z: -(120 + pose.height) }, velocity: { x: speed, y: 0, z: 0 }, orientation: quat.fromEuler(0, pose.pitch, 0), angularVelocity: v3.zero() };
      let t = 0;
      let out!: GearOutput;
      for (let i = 0; i < Math.round(seconds / DT); i++) {
        s = rk4Step(s, DT, (st, stage) => {
          const o = gear.compute({ body: { time: t + offsets[stage], position: st.position, orientation: st.orientation, velocityBody: quat.rotateInv(st.orientation, st.velocity), angularVelocity: st.angularVelocity, cgOffset: v3.zero(), mass: MASS }, controls, env, dt: DT });
          if (stage === 0) out = o;
          const hub = C172.prop.hub;
          return rigidBodyDerivative(st, MASS, I, { force: { x: o.force.x + thrust, y: o.force.y, z: o.force.z }, moment: { x: o.moment.x, y: o.moment.y + hub.z * thrust, z: o.moment.z - hub.y * thrust } });
        });
        t += DT;
        each(t, s.angularVelocity.z, out);
      }
      return { heading: quat.toEuler(s.orientation).heading, out };
    };

    // Pivot about the locked right wheel from rest, as on the rig.
    controls.brakeRight = 1;
    const pivot = fly(6, 0, 600, () => undefined);
    const nose = CASTER_GEAR.wheels[0].position;
    const main = CASTER_GEAR.wheels[2].position;
    const kinematic = Math.atan((nose.x - main.x) / main.y);
    report('RK4 pivot', { headingDeg: pivot.heading * RAD, steerDeg: pivot.out.wheels[0].steerAngle * RAD, kinematicDeg: kinematic * RAD });
    expect(pivot.heading).toBeGreaterThan(30 * DEG);
    expect(pivot.out.wheels[2].spinRate).toBe(0);
    expect(Math.abs(pivot.out.wheels[0].steerAngle - kinematic)).toBeLessThan(1 * DEG);
    expect(pivot.out.crash).toBe('');

    // A brake tap at 40 m/s: it settles, without the wheel reversing more often than the yaw mode does.
    controls.brakeRight = 0;
    let reversals = 0;
    let direction = 0;
    let previous = 0;
    let late = 0;
    const swerve = fly(12, 40, 0, (t, yawRate, o) => {
      controls.brakeRight = t > 0.5 && t < 0.8 ? 1 : 0;
      const steer = o.wheels[0].steerAngle;
      const d = Math.sign(steer - previous);
      previous = steer;
      if (d !== 0) {
        if (direction !== 0 && d !== direction) reversals++;
        direction = d;
      }
      if (t > 10) late = Math.max(late, Math.abs(yawRate));
    });
    report('RK4 swerve at 40 m/s', { reversals, lateYawRate: late });
    expect(swerve.out.crash).toBe('');
    expect(reversals).toBeLessThan(20);
    expect(late).toBeLessThan(0.02);
  });
});

describe('cost', () => {
  test('a castering nosewheel costs no more per compute() call than the linked one', () => {
    const timer = (config: GearConfig) => {
      const rig = new GearRig(planeEnvironment(), MASS, config);
      rig.placeOnGround(0);
      rig.velocity = { x: 10, y: 0, z: 0 };
      rig.run(1);
      const body = { time: rig.time, position: rig.position, orientation: rig.orientation, velocityBody: rig.velocityBody(), angularVelocity: rig.angularVelocity, cgOffset: v3.zero(), mass: MASS };
      const input = { body, controls: rig.controls, env: rig.env, dt: DT };
      return () => {
        const start = performance.now();
        for (let i = 0; i < 20000; i++) {
          body.time += DT;
          rig.gear.compute(input);
        }
        return ((performance.now() - start) / 20000) * 1000;
      };
    };
    // Alternating, the minimum of five each: the two see the same machine.
    const timers = [timer(C172_GEAR), timer(CASTER_GEAR)];
    const best = [Infinity, Infinity];
    timers[0]();
    for (let rep = 0; rep < 5; rep++) timers.forEach((run, k) => (best[k] = Math.min(best[k], run())));
    report('cost', { linkedMicroseconds: best[0], casteringMicroseconds: best[1], ratio: best[1] / best[0] });
    expect(best[1] / best[0]).toBeLessThan(1.3);
  }, 60_000);
});
