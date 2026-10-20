// Hail dents on the leading edges (physics/aero/hailDents.ts) through the shared strip aerodynamics of every
// fixed-wing type: the clean model is unchanged after a level was set and cleared, and at full damage the level
// speed at a fixed power falls and the stall speed rises. Each type logs its measured numbers.

import { describe, expect, it } from 'vitest';
import { DEG, G0, KT } from '../../src/core/math';
import type { AircraftId } from '../../src/core/types';
import type { AircraftDefinition } from '../../src/aircraft/types';
import C172S from '../../src/aircraft/c172s/index';
import { loadAircraft } from '../../src/aircraft/registry';
import { AeroModel } from '../../src/physics/aero';
import { atmosphereAt } from '../../src/physics/atmosphere';
import { coefficients, trimmed } from './helpers';
import { cruiseSpeed, LOW_TERRAIN } from '../fdm/measure';
import { flatEnvironment, makeRig } from '../fdm/helpers';

const FIXED_WING: readonly AircraftId[] = ['c172s', 'c152', 'pa38', 'da20', 'pa34', 'da42', 'c208', 'pc12'];

const definition = (id: AircraftId): Promise<AircraftDefinition> => (id === 'c172s' ? Promise.resolve(C172S) : loadAircraft(id));

/** Largest trimmed lift coefficient, flaps up, power off (alpha sweep in 0.5 deg steps, elevator within +-30 deg). */
function clMax(model: AeroModel): number {
  let best = 0;
  for (let a = 2; a <= 24; a += 0.5) {
    const t = trimmed(model, { V: 30, alphaDeg: a, altitude: 0 }, -30 * DEG, 30 * DEG);
    if (t && t.CL > best) best = t.CL;
  }
  return best;
}

describe('leading-edge dents in the aerodynamics', () => {
  it('leave the clean model bit-identical after a level was set and cleared', () => {
    const fresh = new AeroModel(C172S.aero(), { quasiSteady: true });
    const used = new AeroModel(C172S.aero(), { quasiSteady: true });
    used.setLeadingEdgeDamage(0.7);
    const dented = coefficients(used, { V: 50, alphaDeg: 4 });
    used.setLeadingEdgeDamage(0);
    for (const alphaDeg of [0, 4, 12, 18]) {
      const a = coefficients(fresh, { V: 50, alphaDeg });
      const b = coefficients(used, { V: 50, alphaDeg });
      expect([b.CL, b.CD, b.Cm, b.Cl, b.Cn]).toEqual([a.CL, a.CD, a.Cm, a.Cl, a.Cn]);
    }
    expect(dented.CD).toBeGreaterThan(coefficients(fresh, { V: 50, alphaDeg: 4 }).CD);
  });

  it.each(FIXED_WING)('%s: full damage lowers the speed at 65 %% power and raises the stall speed', async (id) => {
    const def = await definition(id);
    // Stall speed from the trimmed CLmax at maximum take-off mass, sea level.
    const clean = new AeroModel(def.aero(), { quasiSteady: true });
    const dented = new AeroModel(def.aero(), { quasiSteady: true });
    dented.setLeadingEdgeDamage(1);
    const cl0 = clMax(clean), cl1 = clMax(dented);
    const W = def.mass.maxTakeoff * G0, S = def.geometry.wing.area, rho = atmosphereAt(0).density;
    const vs = (cl: number) => Math.sqrt((2 * W) / (rho * S * cl)) / KT;
    // Drag coefficient at the clean model's cruise lift coefficient (alpha 2 deg, 60 m/s).
    const cd0 = coefficients(clean, { V: 60, alphaDeg: 2 }).CD, cd1 = coefficients(dented, { V: 60, alphaDeg: 2 }).CD;
    // Level speed at 65 % of rated power, 1500 m.
    const rig = makeRig({ def, env: flatEnvironment(undefined, LOW_TERRAIN) });
    const v0 = cruiseSpeed(rig, { altitude: 1500, powerFraction: 0.65, bracketKt: [50, 330], iterations: 22 }).ktas;
    rig.fm.setAirframeDamage(1);
    const v1 = cruiseSpeed(rig, { altitude: 1500, powerFraction: 0.65, bracketKt: [50, 330], iterations: 22 }).ktas;
    console.log(
      `[hail dents] ${id}: CD at alpha 2 deg ${cd0.toFixed(4)} -> ${cd1.toFixed(4)} (+${(100 * (cd1 / cd0 - 1)).toFixed(1)} %); ` +
        `KTAS at 65 % power, 1500 m ${v0.toFixed(1)} -> ${v1.toFixed(1)} (${(v1 - v0).toFixed(1)} kt); ` +
        `CLmax ${cl0.toFixed(3)} -> ${cl1.toFixed(3)}; stall KTAS (MTOW, sea level, power off) ${vs(cl0).toFixed(1)} -> ${vs(cl1).toFixed(1)} (+${(vs(cl1) - vs(cl0)).toFixed(1)} kt)`,
    );
    expect(cd1).toBeGreaterThan(cd0);
    expect(v1).toBeLessThan(v0 - 1);
    expect(v1).toBeGreaterThan(v0 - 25);
    expect(cl1).toBeLessThan(cl0);
    expect(vs(cl1) - vs(cl0)).toBeGreaterThan(1);
    expect(vs(cl1) - vs(cl0)).toBeLessThan(15);
  }, 240_000);
});
