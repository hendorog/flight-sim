import { describe, expect, it } from 'vitest';
import { loadAircraft } from '../../src/aircraft/registry';
import { DEG, KT } from '../../src/core/math';
import { AeroModel } from '../../src/physics/aero';
import { makeInput } from './helpers';

describe('leading-edge stall warning on the runway', () => {
  for (const id of ['pa38', 'c152', 'c172s', 'da20', 'pa34'] as const) {
    it(`${id}: no warning at level tricycle attitude across taxi and ground-roll airspeeds`, async () => {
      const def = await loadAircraft(id);
      const model = new AeroModel(def.aero(), { quasiSteady: true });
      const flaps = id === 'pa38' ? [0, 10 * DEG, 21 * DEG, 34 * DEG] : def.controls.flaps.detents;
      for (const flap of flaps) for (const kts of [0, 5, 10, 15, 20, 30, 40, 50]) for (const aft of [false, true]) {
        const out = model.compute(makeInput({ V: kts * KT, altitude: 0, alphaDeg: 0,
          heightAGL: def.geometry.restHeight,
          surfaces: { flaps: flap, elevator: aft ? -def.geometry.hTail.elevator.maxUp : 0 },
        }));
        expect(out.stallWarning, `${id}, ${flap / DEG} deg, ${kts} kt, aft=${aft}`).toBe(false);
      }
    });
  }

  it('a vane retains its rigged clean trip angle when speed changes', async () => {
    for (const id of ['pa38', 'pa34'] as const) {
      const def = await loadAircraft(id);
      const model = new AeroModel(def.aero(), { quasiSteady: true });
      const thresholds = [6, 10, 30, 50].map((V) => {
        model.compute(makeInput({ V, alphaDeg: 0 }));
        return model.stallWarningDiagnostics.threshold;
      });
      expect(Math.max(...thresholds) - Math.min(...thresholds)).toBeLessThan(1e-8);
    }
  });

  it('the PA-38 single vane has no artificial changeover at 10 degrees of flap', async () => {
    const model = new AeroModel((await loadAircraft('pa38')).aero(), { quasiSteady: true });
    model.compute(makeInput({ V: 30, surfaces: { flaps: 9.99 * DEG } }));
    const before = model.stallWarningDiagnostics.threshold;
    model.compute(makeInput({ V: 30, surfaces: { flaps: 10.01 * DEG } }));
    expect(Math.abs(model.stallWarningDiagnostics.threshold - before) / DEG).toBeLessThan(0.02);
  });

  it('a real upward gust can still trip the PA-38 vane at runway height', async () => {
    const def = await loadAircraft('pa38');
    const model = new AeroModel(def.aero(), { quasiSteady: true });
    const input = makeInput({ V: 20, heightAGL: def.geometry.restHeight });
    expect(model.compute(input).stallWarning).toBe(false);
    input.windNED.z = -5;
    expect(model.compute(input).stallWarning).toBe(true);
    expect(model.stallWarningDiagnostics.reserve).toBeLessThan(0);
  });
});
