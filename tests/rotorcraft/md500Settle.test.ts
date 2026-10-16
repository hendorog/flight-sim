// settle() with the MD 500E's Pitt-Peters tail inflow (TailRotorDef.pittPetersInflow). The 50 ms relaxation step of
// the settle loop is far longer than that inflow's time constant at low tail thrust, and the explicit update fell into
// a 2-cycle (hover, pedal 0.3: tail thrust -659 / +1102 N about a true 100 N). The settled state must be the fixed
// point the time-accurate integration converges to.

import { describe, expect, it } from 'vitest';
import { MD500_DEFINITION } from '../../src/aircraft/md500';
import { MD500_ROTORCRAFT as d } from '../../src/aircraft/md500/rotorcraft';
import { defaultControls } from '../../src/core/types';
import { quat, v3 } from '../../src/core/math';
import type { BodyState } from '../../src/physics/interfaces';
import { Rotorcraft } from '../../src/physics/rotorcraft/rotorcraft';

const body = (speed: number): BodyState => ({ time: 0, position: { x: 0, y: 0, z: -100 }, orientation: quat.identity(),
  velocityBody: { x: speed, y: 0, z: 0 }, angularVelocity: v3.zero(), cgOffset: v3.zero(), mass: 1100 });

describe('MD 500E settle() with Pitt-Peters tail inflow', () => {
  it('settles the tail on the fixed point of the time-accurate inflow, including near zero tail thrust', () => {
    expect(d.tail.pittPetersInflow).toBe(true);
    for (const speed of [0, 20, 60]) for (const pedal of [-1, -0.3, 0, 0.3, 0.6, 1]) {
      const r = new Rotorcraft(d); r.reset(true); r.state.rotorRpm = d.nominalRpm;
      const c = defaultControls(MD500_DEFINITION); c.collective = 0.5; c.rudder = pedal;
      const b = body(speed);
      r.settle(b, v3.zero(), 1.225, 100, c);
      const settled = r.state.tailThrust;
      // The slow states held, 4 s at 2 ms (stable): the tail must not move off the settled value.
      for (let i = 0; i < 2000; i++) r.compute(b, v3.zero(), 1.225, 100, c, 0.002);
      expect(Math.abs(r.state.tailThrust - settled), `${speed} m/s, pedal ${pedal}`).toBeLessThan(2);
    }
  });
  it('reports the same tail thrust from consecutive settles (no 2-cycle phase left in the result)', () => {
    const r = new Rotorcraft(d); r.reset(true); r.state.rotorRpm = d.nominalRpm;
    const c = defaultControls(MD500_DEFINITION); c.collective = 0.5; c.rudder = 0.3;
    r.settle(body(0), v3.zero(), 1.225, 100, c);
    const first = r.state.tailThrust;
    r.settle(body(0), v3.zero(), 1.225, 100, c);
    expect(r.state.tailThrust).toBeCloseTo(first, 6);
    expect(first).toBeGreaterThan(50);
    expect(first).toBeLessThan(150);
  });
});
