// Every registered type uses the same scenario/environment path as the browser. Leave the reset controls
// alone: autoflight must not conceal an unsafe spawn, including a cold rotor in the default apron wind.
import { describe, expect, it } from 'vitest';
import { AIRCRAFT_IDS, loadAircraft } from '../../src/aircraft/registry';
import { defaultWeather } from '../../src/core/types';
import { SCENARIO_IDS } from '../../src/sim/scenarios';
import { SimPhysics } from '../../src/sim/SimPhysics';

describe.each(AIRCRAFT_IDS)('%s scenario spawns', (aircraftId) => {
  it.each(SCENARIO_IDS)('%s: undamaged at reset and after five seconds without input', async (scenario) => {
    const aircraft = await loadAircraft(aircraftId);
    const p = new SimPhysics({ aircraft, weather: defaultWeather() });
    p.autoflightOnReset = false;
    p.reset(scenario);
    const controls = structuredClone(p.controls);
    for (const seconds of [0, 5]) {
      p.step(seconds);
      const s = p.state;
      expect(s.time).toBeCloseTo(seconds, 6);
      expect(s.crashed, `${aircraftId}/${scenario} at ${seconds}s: ${s.crashReason}`).toBe(false);
      expect(s.crashReason).toBe('');
      expect([s.position.x, s.position.y, s.position.z, s.pitch, s.roll, s.heading,
        s.ias, s.engine.rpm, s.verticalSpeed].every(Number.isFinite)).toBe(true);
      expect(p.controls).toEqual(controls);
    }
  }, 60000);
});
