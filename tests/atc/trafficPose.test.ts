// A kinematic AI aircraft posed for its exterior (TrafficPilot.pose) stands on the ground under it as the flight
// model does at rest: on the raised pavement, the struts compressed and the nose at its rest attitude, also after
// it has been posed in the air (an arrival), where the gear hangs free.

import { describe, expect, it } from 'vitest';
import C172 from '../../src/aircraft/c172s/index';
import C152 from '../../src/aircraft/c152/index';
import PA38 from '../../src/aircraft/pa38/index';
import DA20 from '../../src/aircraft/da20/index';
import { circuitPath, placeOnLeg } from '../../src/atc/circuit';
import { TrafficPilot, wheelHeight } from '../../src/atc/trafficPilot';
import { HOME_AIRFIELD as H } from '../../src/world/airfields';
import { calmWeather, flatEnvironment } from '../fdm/helpers';

describe('a posed AI aircraft', () => {
  for (const def of [C172, C152, PA38, DA20]) {
    it(`${def.id} stands on the pavement on its compressed gear after being posed in the air`, () => {
      const path = circuitPath(H, 0);
      const pavement = H.elevation + 0.05;
      // The flight model at rest on the same pavement: what the pose should match.
      const env = flatEnvironment(calmWeather(), pavement);
      const ref = new TrafficPilot(def, path);
      const k = { ...placeOnLeg(path, 0, 0.05), onGround: true, height: 0, pitch: 0, bank: 0 };
      ref.start(env, path, k);
      for (let i = 0; i < 240 * 3; i++) ref.step(1 / 240, env);
      const rest = ref.state;

      const p = new TrafficPilot(def, path);
      p.pose({ ...k, onGround: false, height: 120 }, H.elevation, H.elevation, 0.02, true);
      expect(p.state.wheels.every((w) => w.compression === 0)).toBe(true);
      p.pose(k, H.elevation, pavement, 0.02, true);
      const s = p.state;
      expect(s.altitudeMSL - rest.altitudeMSL).toBeCloseTo(0, 2);
      // The pose is the static rest (engine off); idling, the slipstream and thrust pitch it up to 1.2 deg more.
      expect(Math.abs(s.pitch - rest.pitch)).toBeLessThan(1.5 * Math.PI / 180);
      s.wheels.forEach((w, i) => {
        expect(w.onGround).toBe(true);
        expect(Math.abs(w.compression - rest.wheels[i].compression)).toBeLessThan(0.025);
      });
    });
  }

  it('meets the ground without a step: the pavement lift fades in over the last few metres', () => {
    const ground = H.elevation + 0.09;
    expect(wheelHeight(H.elevation, ground, 0)).toBeCloseTo(ground, 9);
    expect(wheelHeight(H.elevation, ground, 10)).toBeCloseTo(H.elevation + 10, 9);
    let last = wheelHeight(H.elevation, ground, 0);
    for (let h = 0.01; h < 10; h += 0.01) {
      const z = wheelHeight(H.elevation, ground, h);
      expect(z - last).toBeGreaterThan(0);
      expect(z - last).toBeLessThan(0.0102);
      last = z;
    }
  });
});
