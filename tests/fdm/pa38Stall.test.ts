// PA-38 report 2126: figs 5-1a / 5-3, §§2.5 and 4.35. The aircraft has BOTH pairs of flow strips.
// 21° is the first notch; full flap is 34°. 10° is an intermediate test setting, not a lever detent.
import { describe, expect, it } from 'vitest';
import PA38 from '../../src/aircraft/pa38';
import { DEG, KT, LB } from '../../src/core/math';
import { ELEVATION, at, flatEnvironment, makeRig, resetTo } from './helpers';
import { pedalSteer, stallRun } from './measure';

const FLAPS = [0, 10, 21, 34];

describe('PA-38 slow power-off stalls', () => {
  it('matches the POH in IAS and CAS, with the expected flap and weight trends', () => {
    const results = [1670, 1450].map((weight) => FLAPS.map((flap) => {
      // Light solo training: sample empty aircraft, 20 US gal and 161 lb pilot. Keep the seat station fixed.
      const fuelFraction = weight === 1670 ? 1 : 2 / 3;
      const fuel = PA38.powerplant.fuel.tanks.reduce((sum, tank) => sum + tank.capacity, 0) * fuelFraction;
      const rig = makeRig({ def: PA38, loading: {
        payload: weight * LB - PA38.mass.empty - fuel,
        payloadPosition: PA38.mass.loadings.maxGross.payloadPosition,
      } });
      // Above 1.3 Vs at the 3000-ft entry, allowing the idle transient to settle before warning onset.
      const r = stallRun(rig, { flapLever: flap / 34, entryKt: 75, fuelFraction, trackDeceleration: true });
      console.log(`[pa38-stall] ${weight} lb, ${flap} deg: ${r.vs1gKias.toFixed(2)} KIAS / ${r.vs1g.toFixed(2)} KCAS; CLmax ${r.clMax.toFixed(3)}; horn ${r.warningKias.toFixed(2)} KIAS; peak ${r.peakKias.toFixed(2)} KIAS / ${r.peakKcas.toFixed(2)} KCAS; deceleration ${r.entryDeceleration.toFixed(3)} kt/s`);
      expect(rig.fm.massProperties.mass / LB).toBeCloseTo(weight, 0); // Small fuel burn during the entry.
      expect(r.crashed).toBe(false);
      expect(Math.abs(r.entryDeceleration - 1)).toBeLessThan(0.1);
      expect(r.maxEntryBankDeg).toBeLessThan(1);
      expect(r.warningKias - r.vs1gKias).toBeGreaterThanOrEqual(5);
      expect(r.warningKias - r.vs1gKias).toBeLessThanOrEqual(10);
      return r;
    }));
    // POH figs 5-3 and 5-1a: 52 KIAS ≈54.3 KCAS clean; 49 KIAS ≈52 KCAS full flap.
    // Same 3-knot CAS tolerance as conformance; the graph-derived IAS comparison has a 2-knot band.
    for (const [index, kias, kcas] of [[0, 52, 54.3], [3, 49, 52]]) {
      expect(Math.abs(results[0][index].vs1g - kcas)).toBeLessThan(3);
      expect(Math.abs(results[0][index].vs1gKias - kias)).toBeLessThan(2);
    }
    for (const row of results) for (let j = 1; j < row.length; j++) expect(row[j].vs1g).toBeLessThan(row[j - 1].vs1g);
    // Weight scaling is an estimate, not a POH table for 1450 lb; allow the lower-Re CLmax change.
    for (let j = 0; j < FLAPS.length; j++) {
      expect(Math.abs(results[1][j].vs1g - results[0][j].vs1g * Math.sqrt(1450 / 1670))).toBeLessThan(1);
    }
  }, 120_000);
});

describe('PA-38 runway stall warning', () => {
  for (const flap of FLAPS) for (const headwind of [0, 15]) {
    it(`stays quiet parked, taxiing and rolling to nosewheel lift: flaps ${flap}, ${headwind} kt headwind, full aft yoke`, () => {
      const env = flatEnvironment();
      // Isolate a steady wind: WindField adds mechanical turbulence even with its turbulence slider at zero.
      env.wind = () => ({ x: -headwind * KT, y: 0, z: 0 });
      const rig = makeRig({ def: PA38, loading: 'maxGross', env });
      resetTo(rig, { onGround: true, position: at(ELEVATION), heading: 0 });
      const s = rig.fm.state, c = rig.controls;
      c.flaps = flap / 34;
      c.elevator = 1;
      c.throttle = 0;
      let warnings = 0, maxPitch = 0;
      const observe = () => {
        if (s.stallWarning) warnings++;
        maxPitch = Math.max(maxPitch, Math.abs(s.pitch));
      };
      rig.run(3, observe); // Includes lowering the flaps while parked, brakes on.
      expect(s.groundSpeed).toBeLessThan(0.05);
      c.parkingBrake = false;
      c.brakeLeft = c.brakeRight = 0;
      rig.run(16, () => {
        c.throttle = Math.max(0, Math.min(0.5, 0.15 + 0.1 * (10 - s.groundSpeed / KT)));
        pedalSteer(s, c, 0);
        observe();
      });
      expect(s.groundSpeed / KT).toBeGreaterThan(9);
      expect(s.groundSpeed / KT).toBeLessThan(12);
      expect(s.wheels[0].onGround).toBe(true);
      expect(s.surfaces.flaps / DEG).toBeCloseTo(flap, 6);
      c.throttle = 1;
      rig.run(35, () => {
        if (!s.wheels[0].onGround) return true;
        pedalSteer(s, c, 0);
        observe();
      });
      // Full aft from brake release rotates BEFORE the POH's normal 53-KIAS rotation technique.
      expect(s.wheels[0].onGround).toBe(false);
      expect(s.ias / KT).toBeGreaterThan(28);
      expect(s.ias / KT).toBeLessThan(45);
      expect(maxPitch / DEG).toBeLessThan(4);
      expect(warnings).toBe(0);
      expect(s.crashed).toBe(false);
    }, 60_000);
  }
});
