// A float carburettor engine (C152, PA-38) on the ground with the parking brake set: how long it runs after the fuel
// selector is shut or the mixture pulled to idle cut-off, and that it catches again when either is put back in time.
import { describe, expect, it } from 'vitest';
import C152 from '../../src/aircraft/c152/index';
import PA38 from '../../src/aircraft/pa38/index';
import type { AircraftDefinition } from '../../src/aircraft/types';
import { ELEVATION, at, makeRig, resetTo } from '../fdm/helpers';

/** Running at `throttle` for 20 s, then `act`; the seconds until the rpm falls below 300 (NaN: not in `limit`). */
function stopTime(def: AircraftDefinition, throttle: number, act: 'selector' | 'mixture', limit = 300): { stop: number; rpm: (s: number) => number } {
  const rig = makeRig({ def });
  resetTo(rig, { onGround: true, position: at(ELEVATION), heading: 0, engineRunning: true });
  const c = rig.controls;
  c.parkingBrake = true;
  c.throttle = throttle;
  c.mixture = 1;
  rig.run(20);
  const t0 = rig.fm.state.time;
  if (act === 'selector') c.fuelSelector = 'off';
  else c.mixture = 0;
  const trace: number[] = [];
  let stop = NaN;
  rig.run(limit, (t) => {
    const rpm = rig.fm.state.engines[0].rpm;
    trace.push(rpm);
    if (rpm < 300) {
      stop = t - t0;
      return true;
    }
  });
  return { stop, rpm: (s) => trace[Math.min(trace.length - 1, Math.round(s * 60))] };
}

describe.each([['c152', C152], ['pa38', PA38]] as const)('%s float carburettor starvation', (_id, def) => {
  it('selector off: runs on the float bowl, a couple of minutes at closed-throttle idle, under a minute at 1200 rpm, seconds at full power', () => {
    expect(stopTime(def, 0, 'selector').stop).toBeGreaterThan(90);
    expect(stopTime(def, 0, 'selector').stop).toBeLessThan(200);
    const taxi = stopTime(def, 0.1, 'selector').stop;
    expect(taxi).toBeGreaterThan(25);
    expect(taxi).toBeLessThan(70);
    // Long enough to notice and turn it back on.
    expect(stopTime(def, 1, 'selector').stop).toBeGreaterThan(10);
  }, 120_000);

  it('idle cut-off at idle: fires on for a moment on the fuel beyond the mixture valve, then stops', () => {
    const idle = stopTime(def, 0, 'mixture', 30);
    expect(idle.rpm(1.5)).toBeGreaterThan(500);
    expect(idle.stop).toBeGreaterThan(2.5);
    expect(idle.stop).toBeLessThan(6);
    expect(stopTime(def, 1, 'mixture', 30).stop).toBeLessThan(6);
  });

  it('catches again when the selector is turned back on as it falters, or the mixture pushed back in at once', () => {
    const rig = makeRig({ def });
    resetTo(rig, { onGround: true, position: at(ELEVATION), heading: 0, engineRunning: true });
    const c = rig.controls;
    c.parkingBrake = true;
    c.throttle = 0.1;
    c.mixture = 1;
    rig.run(20);
    const running = rig.fm.state.engines[0].rpm;
    c.fuelSelector = 'off';
    rig.run(120, () => rig.fm.state.engines[0].rpm < 0.85 * running);
    expect(rig.fm.state.engines[0].rpm).toBeLessThan(0.85 * running);
    c.fuelSelector = def.controlDefaults?.fuelSelector ?? 'both';
    rig.run(15);
    expect(rig.fm.state.engines[0].rpm).toBeGreaterThan(0.95 * running);
    c.mixture = 0;
    rig.run(0.7);
    c.mixture = 1;
    rig.run(10);
    expect(rig.fm.state.engines[0].rpm).toBeGreaterThan(0.95 * running);
  }, 60_000);
});
