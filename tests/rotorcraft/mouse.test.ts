import { describe, expect, it } from 'vitest';
import { R22_DEFINITION } from '../../src/aircraft/r22';
import { R44_DEFINITION } from '../../src/aircraft/r44';
import { createFlightModelFor } from '../../src/physics';
import { flatEnvironment } from '../fdm/helpers';
import { makeInputRig } from '../input/testbed';

const env = flatEnvironment(undefined, 0);

describe('mouse cyclic through input and rotor physics', () => {
  for (const aircraft of [R22_DEFINITION, R44_DEFINITION]) {
    for (const direction of ['right', 'forward'] as const) it(`${aircraft.id}: pointer ${direction} tilts the helicopter ${direction}`, () => {
      const fm = createFlightModelFor(aircraft);
      fm.reset({ position: { x: 0, y: 0, z: -50 }, heading: 0, airspeed: 0,
        onGround: false, engineRunning: true }, env);
      const r = makeInputRig(aircraft.input, fm.trimControls);
      r.ctx.state = fm.state;
      const pointer = r.input as unknown as { mouseNx: number; mouseNy: number; mouseMoves: number };
      r.input.setMouseYoke(true);
      pointer.mouseMoves++; r.input.update(0, r.ctx);
      const trim = { ...r.c };
      pointer.mouseNx = direction === 'right' ? 0.35 : 0;
      pointer.mouseNy = direction === 'forward' ? -0.35 : 0;
      pointer.mouseMoves++;
      r.input.update(1 / 60, r.ctx);
      if (direction === 'right') expect(r.c.aileron).toBeGreaterThan(trim.aileron);
      else expect(r.c.elevator).toBeLessThan(trim.elevator);
      for (let i = 0; i < 72; i++) fm.step(1 / 240, r.c, env);
      if (direction === 'right') expect(fm.state.angularVelocity.x).toBeGreaterThan(0.01);
      else expect(fm.state.angularVelocity.y).toBeLessThan(-0.01);
      expect(fm.state.crashed).toBe(false);
    });
  }
});
