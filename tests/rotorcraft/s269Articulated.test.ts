import { describe, expect, it } from 'vitest';
import { DEG, v3, quat } from '../../src/core/math';
import { defaultControls } from '../../src/core/types';
import { S269_DEFINITION as def } from '../../src/aircraft/s269';
import { S269_ARTICULATED as p } from '../../src/aircraft/s269/articulated';
import { Rotorcraft } from '../../src/physics/rotorcraft/rotorcraft';
import { uniformBladeMoments, advanceFlap, harmonicFlap, hingeMoment, stepLag, flapForcing } from '../../src/physics/rotorcraft/articulated';
const d = def.rotorcraft!, omega = 471 * Math.PI / 30;

describe('articulated harmonic hub and isolated lag research model', () => {
  it('integrates uniform blade moments about distinct hinges (parallel-axis theorem)', () => {
    const blade = uniformBladeMoments(15, 0.65, 4, 0.18, 0.22);
    const variance = 15 * (4 - 0.65) ** 2 / 12, centre = (4 + 0.65) / 2;
    expect(blade.flapInertia).toBeCloseTo(variance + 15 * (centre - 0.18) ** 2, 12);
    expect(blade.lagInertia).toBeCloseTo(variance + 15 * (centre - 0.22) ** 2, 12);
    expect(blade.polar).toBeCloseTo(variance + 15 * centre ** 2, 12);
  });
  it('zero offset has 90° phase and no bending reaction; finite offset detunes the flap mode', () => {
    const zero = { ...p, flapOffset: 0 }, forcing = { cone: 30, cosine: 10, sine: 0, damping: 8 };
    const free = harmonicFlap(zero, 10, forcing, 1), offset = harmonicFlap(p, 10, forcing, 1);
    expect(free.cosine).toBe(0); expect(free.sine).toBeCloseTo(0.125, 12);
    expect(hingeMoment(zero, 3, 10, free)).toEqual(v3.zero());
    expect(offset.cosine).toBeGreaterThan(0); expect(offset.sine).toBeGreaterThan(0);
    expect(Math.atan2(offset.sine, offset.cosine)).toBeLessThan(Math.PI / 2);
    const frequency = Math.sqrt(1 + p.flapOffset * p.blade.flapFirst / p.blade.flapInertia);
    // A static coning load divided by I*(nu*Omega)^2 supplies an independent stiffness check.
    expect(offset.cone).toBeCloseTo(30 / (p.blade.flapInertia * (frequency * 10) ** 2), 12);
  });
  it('centrifugal stiffness survives zero density; stopped rotor has no hub moment', () => {
    const forcing = flapForcing(d.main, p, omega, 0, 8 * DEG, 0, 0, v3.zero(), 0, v3.zero());
    expect(forcing).toEqual({ cone: 0, cosine: 0, sine: 0, damping: 0 });
    const f = { cone: 10, cosine: 20, sine: 30, damping: 0 };
    expect(harmonicFlap(p, omega, f, 1).cosine).toBeGreaterThan(0);
    expect(hingeMoment(p, 3, 0, { cone: 0.1, cosine: 0.1, sine: -0.2 })).toEqual({ x: -0, y: 0, z: 0 });
    expect(harmonicFlap(p, 0, f, 1)).toEqual({ cone: 0, cosine: 0, sine: 0 });
  });
  it('reversing rotation mirrors cyclic phase and rate coupling', () => {
    for (const rotation of [1, -1] as const) {
      const f = flapForcing(d.main, p, omega, 1.225, 8 * DEG, 0, rotation * 3 * DEG,
        { x: 15, y: rotation * 2, z: -1 }, 5, { x: rotation * 0.1, y: 0.2, z: 0 }, rotation);
      const result = harmonicFlap(p, omega, f, rotation);
      const other = flapForcing(d.main, p, omega, 1.225, 8 * DEG, 0, -rotation * 3 * DEG,
        { x: 15, y: -rotation * 2, z: -1 }, 5, { x: -rotation * 0.1, y: 0.2, z: 0 }, -rotation as 1 | -1);
      const mirrored = harmonicFlap(p, omega, other, -rotation as 1 | -1);
      expect(result.cosine).toBeCloseTo(mirrored.cosine, 12);
      expect(result.sine).toBeCloseTo(-mirrored.sine, 12);
    }
  });
  it('hover is symmetric and forward flight produces aft flapping without cyclic', () => {
    const hover = harmonicFlap(p, omega, flapForcing(d.main, p, omega, 1.225,
      8 * DEG, 0, 0, v3.zero(), 7, v3.zero()), 1);
    expect(hover.cosine).toBeCloseTo(0, 12); expect(hover.sine).toBeCloseTo(0, 12); expect(hover.cone).toBeGreaterThan(0);
    const forward = harmonicFlap(p, omega, flapForcing(d.main, p, omega, 1.225,
      8 * DEG, 0, 0, { x: 25, y: 0, z: 0 }, 3, v3.zero()), 1);
    expect(forward.cosine).toBeGreaterThan(0);
  });
  it('lag damper stores positive elastic energy and closes discrete work at 240/480/960 Hz', () => {
    for (const hz of [240, 480, 960]) {
      let state = { angle: 0.03, rate: 0.1 }, dissipated = 0, work = 0;
      const energy = (s: typeof state) => 0.5 * p.blade.lagInertia * s.rate ** 2 +
        0.5 * (p.damper.stiffness * p.damper.arm ** 2 + omega ** 2 * p.lagOffset * p.blade.lagFirst) * s.angle ** 2;
      const start = energy(state);
      for (let i = 0; i < hz * 2; i++) {
        const step = stepLag(p, state, omega, 0, 0.08, 0, 5 * Math.sin(i / hz), 1 / hz);
        expect(step.dissipation).toBeGreaterThanOrEqual(0);
        expect(step.elasticEnergy).toBeGreaterThanOrEqual(0);
        state = step.state; dissipated += step.dissipation; work += step.forcingWork;
      }
      expect(energy(state) - start + dissipated - work).toBeCloseTo(0, 9);
    }
  });
  it('lag midpoint converges without an artificial damping clamp, including zero RPM', () => {
    for (const speed of [0, omega]) {
      const result = [240, 480, 960, 1920].map(hz => {
        let state = { angle: 0.03, rate: 0.1 };
        for (let i = 0; i < hz; i++) state = stepLag(p, state, speed, 0, 0.08, 0, 0, 1 / hz).state;
        return state;
      });
      const error = (i: number) => Math.hypot(result[i].angle - result[3].angle, result[i].rate - result[3].rate);
      expect(error(1)).toBeLessThan(error(0) / 2); expect(error(2)).toBeLessThan(error(1) / 2);
    }
  });
  it('increasing coning leads the blade; shaft acceleration lags it; undamped work is conserved', () => {
    const undamped = { ...p, damper: { ...p.damper, damping: 0 } }, zero = { angle: 0, rate: 0 };
    expect(stepLag(p, zero, omega, 0, 0.1, 0.2, 0, 1 / 960).state.rate).toBeGreaterThan(0);
    expect(stepLag(p, zero, omega, 1, 0, 0, 0, 1 / 960).state.rate).toBeLessThan(0);
    const step = stepLag(undamped, { angle: 0.03, rate: 0 }, omega, 0, 0, 0, 0, 1 / 240);
    const start = 0.5 * (p.damper.stiffness * p.damper.arm ** 2 + omega ** 2 * p.lagOffset * p.blade.lagFirst) * 0.03 ** 2;
    expect(0.5 * p.blade.lagInertia * step.state.rate ** 2 + step.elasticEnergy + step.centrifugalEnergy).toBeCloseTo(start, 12);
    expect(step.dissipation).toBe(0);
  });
  it('flap transient converges to the harmonic solution at 240/480/960 Hz and remains finite at vanishing RPM', () => {
    const forcing = flapForcing(d.main, p, omega, 1.225, 8 * DEG, 2 * DEG, 3 * DEG,
      { x: 20, y: 1, z: 0 }, 5, v3.zero());
    const target = harmonicFlap(p, omega, forcing, 1);
    for (const hz of [240, 480, 960]) {
      let flap = { cone: 0, cosine: 0, sine: 0 };
      for (let i = 0; i < hz * 2; i++) flap = advanceFlap(p, omega, forcing, flap, 1, 1 / hz);
      expect(flap.cone).toBeCloseTo(target.cone, 8);
      expect(flap.cosine).toBeCloseTo(target.cosine, 8); expect(flap.sine).toBeCloseTo(target.sine, 8);
    }
    const tiny = flapForcing(d.main, p, 1e-10, 1.225, 2.5 * DEG, 0, 0, v3.zero(), 0.02, v3.zero());
    const flap = advanceFlap(p, 1e-10, tiny, { cone: 0, cosine: 0, sine: 0 }, 1, 1 / 240);
    expect(Math.abs(flap.cone)).toBeLessThan(1e-5);
    expect(flap.cosine).toBeCloseTo(0, 12); expect(flap.sine).toBeCloseTo(0, 12);
  });
  it('transports free-disc harmonics through body yaw without a second gyroscopic torque', () => {
    const zero = { ...p, flapOffset: 0 }, start = { cone: 0, cosine: 0.08, sine: 0 };
    const flap = advanceFlap(zero, omega, { cone: 0, cosine: 0, sine: 0, damping: 0 }, start, 1, 0.2, 0.7);
    const initialAxis = v3.normalize({ x: -start.cosine, y: start.sine, z: -1 });
    const finalAxis = quat.rotate(quat.fromEuler(0, 0, 0.14), v3.normalize({ x: -flap.cosine, y: flap.sine, z: -1 }));
    expect(v3.len(v3.sub(initialAxis, finalAxis))).toBeLessThan(1e-12);
  });
  it('force-only calls hold persistent hub states and repeated calls are deterministic', () => {
    const rotor = new Rotorcraft(d), c = defaultControls(def);
    const b = { time: 0, position: v3.zero(), orientation: quat.identity(), velocityBody: { x: 20, y: 1, z: 0 },
      angularVelocity: { x: 0.1, y: -0.2, z: 0.01 }, cgOffset: v3.zero(), mass: 700 };
    rotor.reset(true); c.collective = 0.5; rotor.compute(b, v3.zero(), 1.225, 100, c, 1 / 240);
    const before = { ...rotor.state }, a = structuredClone(rotor.compute(b, v3.zero(), 1.225, 100, c, 0));
    const first = { ...rotor.state }, next = structuredClone(rotor.compute(b, v3.zero(), 1.225, 100, c, 0));
    expect(next).toEqual(a); expect(rotor.state).toEqual(first);
    for (const key of ['coning', 'flapForward', 'flapRight', 'inflow', 'tailInflow', 'azimuth'] as const)
      expect(rotor.state[key]).toBe(before[key]);
    expect(rotor.state.teeterAngle).toBe(0); expect(rotor.state.mastBump).toBe(false);
    expect(rotor.articulatedPower.hub + rotor.articulatedPower.shaft).toBe(0);
  });
});
