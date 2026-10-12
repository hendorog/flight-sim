import { describe, expect, it } from 'vitest';
import { DEG, quat, v3 } from '../../src/core/math';
import { defaultControls } from '../../src/core/types';
import { R22_DEFINITION } from '../../src/aircraft/r22';
import { R44_DEFINITION } from '../../src/aircraft/r44';
import { S269_DEFINITION } from '../../src/aircraft/s269';
import type { BodyState } from '../../src/physics/interfaces';
import { cloneRotorcraftState, emptyRotorcraftState } from '../../src/physics/rotorcraft/definition';
import { Rotorcraft } from '../../src/physics/rotorcraft/rotorcraft';
import { SkidGear } from '../../src/physics/rotorcraft/skids';
import { emptySuspension, gasForce, suspensionLoad, suspensionStroke } from '../../src/physics/rotorcraft/skidSuspension';
import { advanceGroundRotor, bladeAirframeStrike, bladePath, stepTeeter } from '../../src/physics/rotorcraft/groundRotor';
import { DT, seaLevel } from './helpers';

const aircraft = [R22_DEFINITION, R44_DEFINITION, S269_DEFINITION];
const body = (a = R22_DEFINITION): BodyState => ({ time: 0,
  position: { x: 0, y: 0, z: -a.rotorcraft!.skids.z + 0.02 }, orientation: quat.identity(),
  velocityBody: v3.zero(), angularVelocity: v3.zero(), cgOffset: v3.zero(), mass: a.mass.maxTakeoff });

describe.each([R22_DEFINITION, R44_DEFINITION])('$id structural skid flexure', a => {
  it('absorbs work through plastic yielding and retains set/spread without changing elastic stiffness', () => {
    const d = a.rotorcraft!.skids, k = d.stiffness, yieldDepth = d.flexure!.yieldForce / k;
    let s = emptySuspension(), work = 0, previousForce = 0, previousDepth = 0;
    const peak = yieldDepth * 1.7, n = 2000;
    for (let i = 0; i <= 2 * n; i++) {
      const depth = peak * (i <= n ? i / n : (2 * n - i) / n);
      const r = suspensionLoad(d, s, depth, 0, 0, DT);
      work += (previousForce + r.load) * 0.5 * (depth - previousDepth);
      s = r.state; previousForce = r.load; previousDepth = depth;
      if (i === n) {
        expect(r.load).toBeLessThan(k * depth);
        expect(r.spread).toBeGreaterThan(0); expect(s.plastic).toBeGreaterThan(0);
      }
    }
    expect(s.plasticWork).toBeGreaterThan(0);
    // Loading work = irrecoverable yield work + energy in isotropic hardening at zero contact load.
    expect(work).toBeCloseTo(s.plasticWork + 0.5 * d.flexure!.hardening * s.plastic ** 2, 3);
    const elastic = suspensionLoad(d, emptySuspension(), yieldDepth / 2, 0, 0, DT);
    expect(elastic.load).toBeCloseTo(k * yieldDepth / 2, 10);
    expect(elastic.state.plastic).toBe(0);
  });

  it('dissipates impact energy through damping and plasticity with timestep convergence', () => {
    const d = a.rotorcraft!.skids, mass = a.mass.maxTakeoff / 4;
    const drop = (dt: number) => {
      let q = 0, speed = 3, s = emptySuspension(), maxLoad = 0;
      const start = 0.5 * mass * speed ** 2;
      for (let t = 0; t < 2; t += dt) {
        const r = suspensionLoad(d, s, Math.max(0, q), q >= 0 ? speed : 0, 0, dt);
        s = r.state;
        const f = q >= 0 ? r.load : 0;
        speed += (9.80665 - f / mass) * dt; q += speed * dt;
        maxLoad = Math.max(maxLoad, f);
      }
      const r = suspensionLoad(d, s, Math.max(q, 0), 0, 0, 0);
      const residual = 0.5 * mass * speed ** 2 - mass * 9.80665 * q + r.elasticEnergy + s.plasticWork + s.dampingWork - start;
      return { residual, maxLoad, s, q };
    };
    const coarse = drop(1 / 2000), fine = drop(1 / 4000);
    expect(fine.s.plasticWork + fine.s.dampingWork).toBeGreaterThan(0);
    expect(Math.abs(fine.residual)).toBeLessThan(Math.abs(coarse.residual));
    expect(Math.abs(fine.residual)).toBeLessThan(0.01 * 0.5 * mass * 3 ** 2);
    expect(fine.maxLoad).toBeCloseTo(coarse.maxLoad, -2);
  });
});

describe('269 oleo support', () => {
  it('has a progressive gas spring, inverse static stroke and passive compression/rebound/relief', () => {
    const d = S269_DEFINITION.rotorcraft!.skids, o = d.oleo!;
    for (const station of [0, 1]) {
      const f1 = gasForce(o, 0.02, station), f2 = gasForce(o, 0.04, station);
      expect(f2 - gasForce(o, 0, station)).toBeGreaterThan(2 * (f1 - gasForce(o, 0, station)));
      expect(suspensionStroke(d, f2, station)).toBeCloseTo(0.04 + f2 / o.contactStiffness, 12);
      for (const speed of [-3, -0.1, 0.1, 3]) {
        const r = suspensionLoad(d, emptySuspension(), 0.04, speed, station, DT);
        expect((r.load - suspensionLoad(d, emptySuspension(), 0.04, 0, station, 0).load) * speed).toBeGreaterThanOrEqual(0);
        expect(r.state.dampingWork).toBeGreaterThan(0);
        expect(r.load).toBeGreaterThanOrEqual(0);
      }
    }
    expect(gasForce(o, 0.04, 1)).toBeGreaterThan(gasForce(o, 0.04, 0));
  });

  it('gas stored energy differentiates to support force and unloads without plastic set', () => {
    const d = S269_DEFINITION.rotorcraft!.skids, q = 0.05, h = 1e-6;
    const lo = suspensionLoad(d, emptySuspension(), q - h, 0, 0, 0);
    const hi = suspensionLoad(d, emptySuspension(), q + h, 0, 0, 0);
    expect((hi.elasticEnergy - lo.elasticEnergy) / (2 * h)).toBeCloseTo(suspensionLoad(d, emptySuspension(), q, 0, 0, 0).load, 2);
    expect(hi.state.plastic).toBe(0);
  });
});

describe('terrain snagging', () => {
  it('adds a toe/edge reaction on a ledge, applies its roll moment below the CG, and releases when lifted', () => {
    const a = R22_DEFINITION, d = a.rotorcraft!, b = body(), c = defaultControls(a);
    b.velocityBody.y = 2;
    const gear = new SkidGear(d), edge = d.skids.halfTrack + 0.01;
    const env = { ...seaLevel, surface: () => 'rock' as const,
      groundElevation: (_x: number, y: number) => y > edge ? 0.10 : 0 };
    const flat = new SkidGear(d).compute({ body: b, controls: c, env: { ...env, groundElevation: () => 0 }, dt: DT });
    const snag = gear.compute({ body: b, controls: c, env, dt: DT });
    expect(gear.contact.some(s => s.snagForce > 0)).toBe(true);
    expect(snag.force.y).toBeLessThan(flat.force.y);
    expect(snag.moment.x).toBeGreaterThan(flat.moment.x);
    expect(v3.dot(snag.force, b.velocityBody)).toBeLessThan(0);
    b.position.z -= 0.05; // foot lifted from the floor, still below the top of the ledge
    const lifting = gear.compute({ body: b, controls: c, env, dt: DT });
    expect(lifting.onGround).toBe(false); expect(lifting.force.y).toBeLessThan(0);
    b.position.z -= 0.5;
    expect(gear.compute({ body: b, controls: c, env, dt: DT }).force).toEqual(v3.zero());
    expect(gear.contact.every(s => s.snagForce === 0)).toBe(true);
  });

  it('has a one-skid pivot on a slope and rolls beyond the torque critical angle despite opposite cyclic', () => {
    // Constrained-pivot reduction isolates rollover from throttle/trim and crash termination.
    // The critical angle comes from weight, thrust, CG/hub height and cyclic travel; no 5–8° switch.
    const a = R22_DEFINITION, d = a.rotorcraft!, b = body(), c = defaultControls(a), weight = b.mass * 9.80665;
    const pivot = { x: 0, y: d.skids.halfTrack, z: d.skids.z }, slope = 6 * DEG;
    const env = { ...seaLevel, groundElevation: (_x: number, y: number) => -y * Math.tan(slope),
      groundNormal: () => v3.normalize({ x: 0, y: Math.tan(slope), z: -1 }) };
    const moment = (roll: number, fraction: number) => {
      const gravity = quat.rotateInv(quat.fromEuler(roll, 0, 0), { x: 0, y: 0, z: weight });
      const thrust = { x: 0, y: -fraction * weight * Math.sin(d.cyclicLimit), z: -fraction * weight * Math.cos(d.cyclicLimit) };
      return v3.cross(v3.scale(pivot, -1), gravity).x + v3.cross(v3.sub(d.main.hub, pivot), thrust).x;
    };
    let lo = slope, hi = Math.PI / 3;
    for (let i = 0; i < 48; i++) {
      const mid = (lo + hi) / 2;
      if (moment(mid, 0.98) > 0) hi = mid; else lo = mid;
    }
    const critical = (lo + hi) / 2;
    expect(critical).toBeGreaterThan(slope);
    expect(moment(critical - DEG, 0.98)).toBeLessThan(0);
    expect(moment(critical + DEG, 0.98)).toBeGreaterThan(0);
    b.orientation = quat.fromEuler(critical + DEG, 0, 0);
    const foot = quat.rotate(b.orientation, pivot);
    b.position.z = -foot.z + foot.y * Math.tan(slope) + 0.005;
    const support = new SkidGear(d).compute({ body: b, controls: c, env, dt: DT });
    expect(support.wheels[1].load).toBe(0); expect(support.wheels[2].load).toBeGreaterThan(0);
    // All support forces act through that skid: they cannot provide a restoring pivot torque.
    expect(support.moment.x - v3.cross(pivot, support.force).x).toBeCloseTo(0, 8);
    const evolve = (fraction: number) => {
      let roll = critical + DEG, rate = 0;
      const inertia = 600 + b.mass * (pivot.y ** 2 + pivot.z ** 2);
      for (let i = 0; i < 1 / DT; i++) {
        rate += moment(roll, fraction) / inertia * DT; roll += rate * DT;
      }
      return roll;
    };
    expect(evolve(0.98)).toBeGreaterThan(critical + 2 * DEG);
    expect(evolve(0.2)).toBeLessThan(critical);
  });

  it('does not misinterpret a planar slope as an edge, and pure forward sliding remains benign', () => {
    const a = R22_DEFINITION, d = a.rotorcraft!, b = body(), c = defaultControls(a), slope = Math.tan(6 * DEG);
    b.orientation = quat.fromEuler(-6 * DEG, 0, 0); b.velocityBody.x = 15;
    const gear = new SkidGear(d), env = { ...seaLevel, groundElevation: (_x: number, y: number) => y * slope,
      groundNormal: () => v3.normalize({ x: 0, y: -slope, z: -1 }) };
    const g = gear.compute({ body: b, controls: c, env, dt: DT });
    expect(g.crash).toBe(''); expect(gear.contact.every(s => s.snagForce === 0)).toBe(true);
    expect(g.force.x).toBeLessThan(0);
  });
});

describe.each(aircraft)('$id blade/airframe clearance', a => {
  it('has no false airframe strike through a calm startup/shutdown and normal-RPM full cyclic sweep', () => {
    const d = a.rotorcraft!, r = new Rotorcraft(d), b = body(a), c = defaultControls(a), gear = new SkidGear(d);
    r.reset(false);
    for (let i = 0; i < 2400; i++) {
      const fraction = i < 1200 ? i / 1200 : (2400 - i) / 1200;
      r.state.omega = fraction * d.nominalRpm * Math.PI / 30; r.state.rotorRpm = r.state.omega * 30 / Math.PI;
      r.state.azimuth += d.rotation * r.state.omega * DT;
      r.compute(b, v3.zero(), 1.225, d.skids.z, c, DT);
      const g = gear.compute({ body: b, controls: c, env: seaLevel, dt: DT }, r.state);
      expect(g.crash).not.toMatch(/Main rotor/);
    }
    r.reset(true);
    for (let i = 0; i < 1440; i++) {
      c.elevator = Math.sin(i * Math.PI / 360); c.aileron = Math.cos(i * Math.PI / 360);
      r.compute(b, v3.zero(), 1.225, d.skids.z, c, DT);
      expect(bladeAirframeStrike(d, r.state, c)).toBe('');
    }
  });

  it('requires geometric intersection, and detects an excessive aft flap passing through the tailcone', () => {
    const d = a.rotorcraft!, s = emptyRotorcraftState(), c = defaultControls(a);
    s.omega = d.nominalRpm * Math.PI / 30;
    expect(bladeAirframeStrike(d, s, c)).toBe('');
    s.mastBump = true; // Damage flag alone cannot manufacture a collision.
    expect(bladeAirframeStrike(d, s, c)).toBe('');
    s.flapForward = -Math.tan(25 * DEG); c.elevator = 1;
    expect(bladeAirframeStrike(d, s, c)).toBe('Main rotor / tailcone strike');
  });

  it('keeps the blade collision path clear on slopes within six degrees', () => {
    const d = a.rotorcraft!, b = body(a), r = new Rotorcraft(d), c = defaultControls(a);
    r.reset(true);
    for (const slope of [-6, 6]) {
      b.orientation = quat.fromEuler(slope * DEG, 0, 0);
      r.state.flapRight = Math.tan(slope * DEG); r.state.thrust = b.mass * 9.80665;
      const points = bladePath(d, r.state, c);
      expect(bladeAirframeStrike(d, r.state, c)).toBe('');
      expect(points.every(p => Number.isFinite(p.z))).toBe(true);
    }
  });
});

describe('teeter stop friction and sailing', () => {
  it('produces an actual stopped-rotor sail into the tailcone, with no injected excessive flap', () => {
    const a = R22_DEFINITION, d = a.rotorcraft!, s = emptyRotorcraftState(), b = body(), c = defaultControls(a);
    s.azimuth = Math.PI / 2; c.elevator = 1;
    let strike = '';
    for (let i = 0; i < 5 / DT && !strike; i++) {
      advanceGroundRotor(d, s, b, c, { x: 0, y: 18, z: 0 }, 1.225, 9.80665, DT);
      strike = bladeAirframeStrike(d, s, c);
    }
    expect(strike).toBe('Main rotor / tailcone strike');
    expect(s.flapForward).toBe(0); expect(s.flapRight).toBe(0);
    expect(s.contactRotor!.angle).toBeLessThanOrEqual(d.teeterLimit);
  });
  it('holds below breakaway torque, dissipates work above it, and removes energy at a stop', () => {
    expect(stepTeeter(0, 0, 100, 0, 0, 9, 10, 0.2, 0.1).angle).toBe(0);
    const step = stepTeeter(0, 0, 100, 0, 0, 20, 10, 0.2, 0.1);
    expect(step.angle).toBeGreaterThan(0); expect(step.frictionWork).toBeGreaterThan(0);
    expect(20 * step.angle - 0.5 * 100 * step.rate ** 2 - step.frictionWork).toBeCloseTo(0, 12);
    const stop = stepTeeter(0.199, 1, 100, 0, 0, 0, 0, 0.2, 0.1);
    expect(stop.angle).toBe(0.2); expect(stop.rate).toBe(0); expect(stop.stopWork).toBeGreaterThan(0);
    const rest = stepTeeter(0, 0.001, 100, 0, 0, 0, 10, 0.2, 0.1);
    expect(rest.rate).toBe(0);
    expect(rest.frictionWork).toBeCloseTo(0.5 * 100 * 0.001 ** 2, 12);
  });

  it.each([R22_DEFINITION, R44_DEFINITION])('$id responds to wind azimuth/gusts at low RPM and owns snapshot state', a => {
    const d = a.rotorcraft!, b = body(a), c = defaultControls(a);
    const run = (wind: number, azimuth: number) => {
      const s = emptyRotorcraftState(); s.azimuth = azimuth; s.omega = 20 * Math.PI / 30;
      for (let i = 0; i < 2 / DT; i++) {
        s.azimuth += s.omega * DT;
        advanceGroundRotor(d, s, b, c, { x: wind * (1 + 0.3 * Math.sin(i * DT * 3)), y: 0, z: 0 }, 1.225, 9.80665, DT);
      }
      return s;
    };
    const calm = run(0, 0), gust = run(18, 0), shifted = run(18, Math.PI / 2);
    expect(Math.abs(calm.contactRotor!.angle)).toBeLessThan(1e-12);
    expect(Math.abs(gust.contactRotor!.angle)).toBeGreaterThan(1e-4);
    expect(Math.abs(gust.contactRotor!.angle - shifted.contactRotor!.angle)).toBeGreaterThan(1e-4);
    expect(Math.abs(gust.contactRotor!.angle)).toBeLessThanOrEqual(d.teeterLimit);
    const clone = cloneRotorcraftState(gust); clone.contactRotor!.angle += 0.1;
    expect(clone.contactRotor!.angle).not.toBe(gust.contactRotor!.angle);
  });
});
