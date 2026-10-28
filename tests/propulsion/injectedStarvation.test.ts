// A fuel-injected engine (C172S, DA20) on the ground with the parking brake set: a shut fuel selector seals the lines,
// so the engine runs on what the pump can draw out of them, about a minute at idle; and it catches again when the
// selector is turned back on as it falters, with the electric fuel pump on (POH 3: fuel selector BOTH, fuel pump ON).
import { describe, expect, it } from 'vitest';
import C172S from '../../src/aircraft/c172s/index';
import DA20 from '../../src/aircraft/da20/index';
import type { AircraftDefinition } from '../../src/aircraft/types';
import { ELEVATION, at, makeRig, resetTo } from '../fdm/helpers';

/** Running at `throttle` for 20 s, then the selector off; the seconds until the rpm falls below 300 (NaN: not in 300 s). */
function stopTime(def: AircraftDefinition, throttle: number): number {
  const rig = makeRig({ def });
  resetTo(rig, { onGround: true, position: at(ELEVATION), heading: 0, engineRunning: true });
  const c = rig.controls;
  c.parkingBrake = true;
  c.throttle = throttle;
  c.mixture = 1;
  rig.run(20);
  const t0 = rig.fm.state.time;
  c.fuelSelector = 'off';
  let stop = NaN;
  rig.run(300, (t) => {
    if (rig.fm.state.engines[0].rpm < 300) {
      stop = t - t0;
      return true;
    }
  });
  return stop;
}

describe.each([['c172s', C172S], ['da20', DA20]] as const)('%s injected starvation', (_id, def) => {
  it('selector off: about a minute at closed-throttle idle, under half a minute at 1200 rpm, seconds at full power', () => {
    const idle = stopTime(def, 0);
    expect(idle).toBeGreaterThan(40);
    expect(idle).toBeLessThan(120);
    const taxi = stopTime(def, 0.1);
    expect(taxi).toBeGreaterThan(15);
    expect(taxi).toBeLessThan(45);
    const full = stopTime(def, 1);
    expect(full).toBeGreaterThan(5);
    expect(full).toBeLessThan(20);
  }, 120_000);

  it('catches again when the selector is turned back on as it falters, with the electric fuel pump on', () => {
    const rig = makeRig({ def });
    resetTo(rig, { onGround: true, position: at(ELEVATION), heading: 0, engineRunning: true });
    const c = rig.controls;
    c.parkingBrake = true;
    c.throttle = 0.1;
    c.mixture = 1;
    rig.run(20);
    const running = rig.fm.state.engines[0].rpm;
    c.fuelSelector = 'off';
    rig.run(60, () => rig.fm.state.engines[0].rpm < 0.85 * running);
    expect(rig.fm.state.engines[0].rpm).toBeLessThan(0.85 * running);
    c.fuelSelector = def.controlDefaults?.fuelSelector ?? 'both';
    c.fuelPump = true;
    rig.run(15);
    expect(rig.fm.state.engines[0].rpm).toBeGreaterThan(0.95 * running);
  }, 60_000);
});
