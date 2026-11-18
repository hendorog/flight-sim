// A scenario reset in the same SimPhysics after a weather change: the start meets the air of the new weather, the
// terrain waves included, exactly as a SimPhysics built with that weather does (OrographyField.reset takes the
// current weather in full; SimPhysics.resetTo restarts the wind field before hoverIntoWind samples it).

import { describe, expect, it } from 'vitest';
import { loadAircraft } from '../../src/aircraft/registry';
import type { Vec3 } from '../../src/core/math';
import { defaultWeather, type WeatherSettings } from '../../src/core/types';
import { hoverScenario } from '../../src/sim/rotorcraft/starts';
import { SimPhysics } from '../../src/sim/SimPhysics';

const A: Partial<WeatherSettings> = { windDirectionDeg: 315, windSpeedKt: 25, dayOfYear: 172 };
const B: Partial<WeatherSettings> = { windDirectionDeg: 250, windSpeedKt: 18, dayOfYear: 15 };
/** Points over the range north of the airport, where the waves are, m NED. */
const PTS: Vec3[] = [
  { x: 30_000, y: 0, z: -4000 },
  { x: 40_000, y: 10_000, z: -3000 },
  { x: 25_000, y: -15_000, z: -5000 },
];

const winds = (p: SimPhysics, pts: Vec3[], t: number) => pts.map((q) => ({ ...p.env.wind(q, t) }));

describe('scenario reset after a weather change', () => {
  it('C172 cruise: the same air as a SimPhysics built with the new weather, whatever weather flew before', () => {
    const w = { ...defaultWeather(), ...A };
    const p = new SimPhysics({ weather: w });
    p.reset('cruise');
    p.step(5);
    winds(p, PTS, p.time);
    Object.assign(w, B);
    p.reset('cruise');
    const fresh = new SimPhysics({ weather: { ...defaultWeather(), ...B } });
    fresh.reset('cruise');
    const at = [{ ...p.state.position }, ...PTS];
    let largestWave = 0;
    for (const t of [0, 0.5, 1.5, 2.5, 4]) {
      expect(winds(p, at, t)).toEqual(winds(fresh, at, t));
      for (const q of PTS) largestWave = Math.max(largestWave, Math.abs(fresh.env.windField.breakdown(q, t).wave.z));
    }
    expect(p.state.position).toEqual(fresh.state.position);
    expect(largestWave).toBeGreaterThan(0.05);
  }, 300_000);

  it('Bo 105 hover start: heading and wind as with a SimPhysics built with the new weather', async () => {
    const def = await loadAircraft('bo105');
    const w = { ...defaultWeather(), ...A };
    const p = new SimPhysics({ weather: w, aircraft: def });
    p.resetTo(hoverScenario(p.env, def.rotorcraft!));
    p.step(5);
    Object.assign(w, B);
    p.resetTo(hoverScenario(p.env, def.rotorcraft!));
    const fresh = new SimPhysics({ weather: { ...defaultWeather(), ...B }, aircraft: def });
    fresh.resetTo(hoverScenario(fresh.env, def.rotorcraft!));
    expect(p.state.heading).toBe(fresh.state.heading);
    const at = [{ ...p.state.position }, ...PTS];
    for (const t of [0, 1, 3]) expect(winds(p, at, t)).toEqual(winds(fresh, at, t));
  }, 300_000);
});
