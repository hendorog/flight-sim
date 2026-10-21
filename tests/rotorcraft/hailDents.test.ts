// Hail dents on the rotor blades (physics/rotorcraft/rotor.ts dent, Rotorcraft.setDamage; the dose in
// sim/weather/hailDamage.ts): the undamaged rotor is bit-identical at level 0, and at full damage the trimmed hover
// needs more shaft power. Each type logs its measured numbers.

import { describe, expect, it } from 'vitest';
import { HP } from '../../src/core/math';
import { cloneControls } from '../../src/core/types';
import { R22_DEFINITION } from '../../src/aircraft/r22';
import { R44_DEFINITION } from '../../src/aircraft/r44';
import type { AircraftDefinition } from '../../src/aircraft/types';
import { createFlightModelFor } from '../../src/physics';
import { bladeElements } from '../../src/physics/rotorcraft/rotor';
import { emptyLocalPrecip } from '../../src/physics/weather/stormPrecip';
import { HailDamage, rotorDentRate, ROTOR_STATION } from '../../src/sim/weather/hailDamage';
import { quat } from '../../src/core/math';
import { seaLevel } from './helpers';

/** Shaft horsepower of a trimmed out-of-ground-effect hover at maximum gross weight, sea level, rotor dents `dent`. */
function hoverHp(def: AircraftDefinition, dent: number): { hp: number; profileHp: number; collective: number; converged: boolean } {
  const fm = createFlightModelFor(def);
  fm.setLoading(def.mass.loadings.maxGross);
  fm.setAirframeDamage(0, dent);
  fm.reset({ position: { x: 0, y: 0, z: -1000 }, heading: 0, airspeed: 0, onGround: false, engineRunning: true, fuelFraction: 1 }, seaLevel);
  const r = fm.state.rotorcraft!;
  const rc = (fm as unknown as { rotorcraft: { power: { mainProfile: number; tailProfile: number } } }).rotorcraft;
  return { hp: (r.torque * r.omega) / def.rotorcraft!.transmissionEfficiency / HP, profileHp: -(rc.power.mainProfile + rc.power.tailProfile) / HP, collective: cloneControls(fm.trimControls).collective!, converged: !!fm.lastTrim?.converged };
}

describe('hail dents on the rotor blades', () => {
  it('leave the blade elements bit-identical at level 0', () => {
    const d = R22_DEFINITION.rotorcraft!.main;
    for (const [pitch, speed] of [[0.1, 0], [0.15, 30], [0.25, 50]]) {
      const a = bladeElements(d, 55.5, pitch, 0, speed, 6, 1.225, 12, 16, true);
      const b = bladeElements(d, 55.5, pitch, 0, speed, 6, 1.225, 12, 16, true, 0);
      expect(b).toEqual(a);
    }
    const c = bladeElements(d, 55.5, 0.15, 0, 30, 6, 1.225, 12, 16, true, 1);
    expect(c.profilePower).toBeGreaterThan(bladeElements(d, 55.5, 0.15, 0, 30, 6, 1.225, 12, 16, true).profilePower);
  });

  it('take a dose from the blade speed: far more than the airframe in the hover, none with the rotor stopped', () => {
    const p = { ...emptyLocalPrecip(), type: 'rain' as const, rateMmH: 30, stormRainMmH: 30, hailMmH: 6, hailMaxMm: 20 };
    const d = R22_DEFINITION.rotorcraft!;
    const blade = ((d.nominalRpm * Math.PI) / 30) * ROTOR_STATION * d.main.radius;
    const hover = rotorDentRate(p, blade, 0), cruise = rotorDentRate(p, blade, 40);
    expect(rotorDentRate(p, 0, 0)).toBe(0);
    expect(rotorDentRate(emptyLocalPrecip(), blade, 0)).toBe(0);
    expect(cruise).toBeGreaterThan(hover);
    const h = new HailDamage();
    for (let k = 1; k <= 50; k++) h.update(p, 0, 0, 0, quat.identity(), 0.1 * k, 0.1, 1.225, blade);
    console.log(`[rotor dents] R22 blade speed at ${ROTOR_STATION} R ${blade.toFixed(1)} m/s; 6 mm/h, largest stone 20 mm: ` +
      `rotor dent rate ${hover.toFixed(1)} J/m^2/s in the hover, ${cruise.toFixed(1)} at 40 m/s; after 5 s in the hover rotor ${h.state.rotor.toFixed(3)}, airframe ${h.state.leadingEdge.toFixed(3)}`);
    expect(h.state.rotor).toBeGreaterThan(0);
    expect(h.state.leadingEdge).toBe(0);
    // The snapshot keeps the rotor's damage; a fixed-wing snapshot has no rotor fields.
    const back = new HailDamage();
    back.restore(h.capture());
    expect([back.state.rotor, back.state.rotorDoseJm2]).toEqual([h.state.rotor, h.state.rotorDoseJm2]);
    expect('rotor' in new HailDamage().capture()).toBe(false);
  });

  it.each([
    ['r22', R22_DEFINITION],
    ['r44', R44_DEFINITION],
  ] as const)('%s: full rotor damage raises the hover power', (id, def) => {
    const clean = hoverHp(def, 0), dented = hoverHp(def, 1);
    console.log(`[rotor dents] ${id}: hover OGE, max gross, sea level: shaft ${clean.hp.toFixed(1)} -> ${dented.hp.toFixed(1)} hp ` +
      `(+${(100 * (dented.hp / clean.hp - 1)).toFixed(1)} %), rotor profile power ${clean.profileHp.toFixed(1)} -> ${dented.profileHp.toFixed(1)} hp, collective ${clean.collective.toFixed(3)} -> ${dented.collective.toFixed(3)}`);
    expect(clean.converged && dented.converged).toBe(true);
    expect(dented.hp).toBeGreaterThan(clean.hp * 1.02);
    expect(dented.hp).toBeLessThan(clean.hp * 1.3);
  }, 120_000);
});
