// The condition lever's detents (InputProfile.conditionDetents) against the REAL engine of each type that has them:
// M tapped and held from FLIGHT IDLE leaves the PT6A burning at GROUND IDLE, and only a fresh press held
// CONDITION_CUTOFF_HOLD at that detent stops it. Real SimPhysics through the real InputSystem (keyboardPilot's rig).

import { describe, expect, it } from 'vitest';
import type { AircraftDefinition } from '../../src/aircraft/types';
import C208_DEFINITION from '../../src/aircraft/c208/index';
import { C208_INPUT } from '../../src/aircraft/c208/input';
import PC12_DEFINITION from '../../src/aircraft/pc12/index';
import { PC12_INPUT } from '../../src/aircraft/pc12/input';
import { CONDITION_CUTOFF_HOLD } from '../../src/input/InputSystem';
import type { InputProfile } from '../../src/input/profile';
import { CUTOFF_BELOW } from '../../src/physics/propulsion/turbineEngine';
import { SimPhysics } from '../../src/sim/SimPhysics';
import { frame, FRAME, makeRig, type Rig } from './keyboardPilot';

const TYPES: readonly [string, AircraftDefinition, InputProfile][] = [
  ['PC-12', PC12_DEFINITION, PC12_INPUT],
  ['C208', C208_DEFINITION, C208_INPUT],
];
const run = (r: Rig, s: number): void => { for (let i = 0, n = Math.round(s / FRAME); i < n; i++) frame(r); };
function hold(r: Rig, code: string, s: number): void {
  r.input.keyDown(code);
  run(r, s);
  r.input.keyUp(code);
  run(r, FRAME);
}

describe('the condition lever with detents against the real engine', () => {
  for (const [name, def, profile] of TYPES) {
    it(`${name}: M held from FLIGHT IDLE, then tapped, leaves the engine running at GROUND IDLE; a fresh held press stops it`, () => {
      const r = makeRig({ turbulence: 0, windSpeedKt: 0, gustKt: 0 }, { profile, makePhysics: (o) => new SimPhysics({ ...o, aircraft: def }) });
      r.ctx.events.emit('reset', { scenario: r.physics.scenario.id });
      const c = r.physics.controls, e = r.physics.renderState.engine;
      c.parkingBrake = true;
      c.throttle = 0;
      run(r, 2);
      expect(e.running).toBe(true);
      const ngIdle = e.ng ?? 0;
      // Held from FLIGHT IDLE: the lever stops on GROUND IDLE however long M is held.
      hold(r, 'KeyM', 3);
      expect(c.mixture).toBe(CUTOFF_BELOW);
      // A tap at GROUND IDLE arms the cut-off but is let go before CONDITION_CUTOFF_HOLD: the lever stays.
      hold(r, 'KeyM', 0.1);
      run(r, 20);
      expect(c.mixture).toBe(CUTOFF_BELOW);
      expect(e.running).toBe(true);
      // Burning at ground idle: Ng a little below the flight-idle schedule, nowhere near a spool-down.
      expect(e.ng ?? 0).toBeGreaterThan(0.75 * ngIdle);
      hold(r, 'KeyM', CONDITION_CUTOFF_HOLD + 0.1);
      expect(c.mixture).toBe(0);
      run(r, 20);
      expect(e.running).toBe(false);
      expect(e.ng ?? 0).toBeLessThan(0.5 * ngIdle);
    }, 60_000);
  }
});
