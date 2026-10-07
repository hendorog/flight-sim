// Conformance of the Cessna 152 (quick tier always; flown tier with FS_AIRCRAFT=c152 or all): the suite's blocks on
// the targets of contract 5.1 (targets/c152.ts), the keyboard circuit, and the 5.1 items no generic block measures:
// the fuel flow of the 75 % cruise, the rest attitude and propeller clearance, and the carburettor-ice model check;
// a firm unflared arrival, which lands the 152 nose-first; and the last notch of flap selected hands-off.

import { beforeAll, describe } from 'vitest';
import { loadAircraft } from '../../src/aircraft/registry';
import type { AircraftDefinition } from '../../src/aircraft/types';
import { DEG, FT, KT } from '../../src/core/math';
import { Autopilot } from '../../src/physics';
import { ELEVATION, FRAME, at, calmWeather, flatEnvironment, makeRig, resetTo } from '../fdm/helpers';
import { LOW_TERRAIN, brakePower, cruiseSpeed, restOnGround, tasForKias } from '../fdm/measure';
import { keyboardCircuit } from './keyboard';
import { once } from './plan';
import { describeAircraft, flownTier, item } from './suite';
import { C152_CARB_ICE, C152_CRUISE_ALT, C152_CRUISE_FUEL_GPH, C152_REST, C152_TARGETS } from './targets/c152';

const ID = 'c152';
const QUICK_MS = 120_000;
const FLOWN_MS = 300_000;
/** kg/s per US gal/h of 100LL. */
const GPH = (3.785411784e-3 * 719) / 3600;

describeAircraft(C152_TARGETS);
// The circuit pilot flies with the 152's tachometer settings (targets/c152.ts KEYBOARD_PILOT_TARGETS).
keyboardCircuit({ aircraft: ID });

describe(`conformance ${ID}: items of contract 5.1 outside the generic blocks`, () => {
  let def!: AircraftDefinition;
  beforeAll(async () => {
    def = await loadAircraft(ID);
  });

  describe('rest attitude and propeller clearance', () => {
    const r = once(() => {
      const rest = restOnGround(makeRig({ def, loading: 'maxGross' }));
      // The lowest point of the propeller disc (the disc stands in the body y-z plane), above the ground.
      const p = def.geometry.propellers[0];
      const pitch = rest.pitchDeg * DEG;
      const tip = -p.hub.x * Math.sin(pitch) + (p.hub.z + p.diameter / 2) * Math.cos(pitch);
      return { pitchDeg: rest.pitchDeg, clearance: rest.height - tip };
    });
    item(ID, 'rest attitude (fuselage pitch on the ground)', () => r().pitchDeg, C152_REST.pitchDeg, 'deg', QUICK_MS);
    item(ID, 'propeller ground clearance at rest', () => r().clearance, C152_REST.propClearanceM, 'm', QUICK_MS);
  });

  describe('a firm unflared arrival', () => {
    // Flaps 20 at 60 KIAS, 430 ft/min down held by the autopilot onto the runway, throttle closed at the first
    // contact (with a nose gear as strong as 8 x its static load, 14 kN, this folded it): the 152 descends below its ground attitude, so the nose wheel touches first. A student's firm, flat
    // landing; the POH warns of wheelbarrowing, not of a folding nose gear (review F1).
    const r = once(() => {
      const rig = makeRig({ def, loading: 'maxGross', env: flatEnvironment() });
      const s = rig.fm.state, c = rig.controls;
      resetTo(rig, { position: at(ELEVATION + def.geometry.restHeight + 15), airspeed: tasForKias(def, 60, ELEVATION), flaps: 2 / 3, flightPathAngle: -3 * DEG });
      const ap = new Autopilot(def.autopilot);
      ap.settings = { ...ap.settings, lateral: 'wingLeveler', vertical: 'verticalSpeed', verticalSpeed: -2.2, autothrottle: true, airspeed: 60 * KT, autoTrim: true };
      let down = false, nose = 0, sink = 0, first = '';
      rig.run(25, () => {
        if (!down) {
          ap.update(FRAME, s, c);
          const w = s.wheels.find((x) => x.onGround);
          if (w) { down = true; sink = -s.verticalSpeed; first = w.name; }
        }
        if (down) { c.throttle = 0; c.elevator = 0; }
        nose = Math.max(nose, s.wheels[0].load);
        return s.crashed || (down && s.groundSpeed < 10);
      });
      return { crashed: s.crashed, nose, sink, first };
    });
    item(ID, 'unflared arrival: sink at the first contact', () => r().sink, { min: 1.6, max: 2.4, source: 'about 400 ft/min, under the CAR 3 limit sink (2.4 m/s)' }, 'm/s', QUICK_MS);
    item(ID, '  the nose wheel touches first', () => (r().first === 'nose' ? 1 : 0), { min: 1, max: 1, source: 'the descending attitude is below the ground attitude' }, '', QUICK_MS);
    item(ID, '  nose-gear peak load', () => r().nose / 1000, { min: 0, max: 16, source: 'inside the 20 kN limit load (gear.ts)' }, 'kN', QUICK_MS);
    item(ID, '  no crash', () => (r().crashed ? 1 : 0), { min: 0, max: 0, source: 'the gear survives a firm flat landing' }, '', QUICK_MS);
  });

  describe('the last notch of flap, hands off', () => {
    // Trimmed level with flaps 20 at 66 KIAS, 3000 ft; the lever to 30 at 2 s, yoke and throttle left alone for 20 s.
    // The tail sits under the full flap's wake (aero.ts WAKE_MAX_LOSS): with the wake's uncapped loss on its flank the
    // 152 tucked into a steepening dive, -21 deg and 96 KIAS within the 20 s (defect D-accept-D1-01).
    const r = once(() => {
      const rig = makeRig({ def, loading: 'maxGross', env: flatEnvironment() });
      const s = rig.fm.state, c = rig.controls;
      const alt = ELEVATION + 3000 * FT;
      resetTo(rig, { position: at(alt), airspeed: tasForKias(def, 66, alt), flaps: 2 / 3, flightPathAngle: 0 });
      const t0 = s.time;
      let minPitch = Infinity, maxIas = 0;
      rig.run(22, (time) => {
        if (time - t0 >= 2) c.flaps = 1;
        minPitch = Math.min(minPitch, s.pitch / DEG);
        maxIas = Math.max(maxIas, s.ias / KT);
      });
      return { minPitch, maxIas };
    });
    item(ID, 'flaps 20 to 30 hands off: lowest pitch in 20 s', () => r().minPitch, { min: -8, max: Infinity, source: 's.11: a mild trim change, the aircraft stays stable' }, 'deg', QUICK_MS);
    item(ID, '  highest indicated airspeed in 20 s', () => r().maxIas, { min: 0, max: 85, source: 'below VFE 85 KIAS (s.2.1)' }, 'KIAS', QUICK_MS);
  });

  describe.runIf(flownTier(ID))('fuel flow in the 75 % cruise (flown tier)', () => {
    // The cruise of the 'cruise and climb at altitude' block, leaned for best power, flown for 5 s at its throttle.
    const r = once(() => {
      const rig = makeRig({ def, loading: 'maxGross', env: flatEnvironment(undefined, LOW_TERRAIN) });
      const c = C152_TARGETS.cruise!;
      const cruise = cruiseSpeed(rig, { altitude: C152_CRUISE_ALT, powerFraction: c.powerFraction, bracketKt: c.bracketKt, leanAtKt: c.leanAtKt, resetKt: c.resetKt });
      const trim = rig.fm.solveTrim({ tas: cruise.ktas * KT, altitude: C152_CRUISE_ALT }, rig.env, { mixture: cruise.mixture });
      resetTo(rig, { position: at(C152_CRUISE_ALT), airspeed: cruise.ktas * KT });
      rig.controls.mixture = cruise.mixture;
      rig.controls.throttle = trim.throttle;
      rig.run(5);
      return { gph: rig.fm.state.engines[0].fuelFlow / GPH, power: brakePower(rig.fm) / def.powerplant.engines[0].engine.ratedPower };
    });
    item(ID, 'fuel flow at 75 % power, 8000 ft, leaned', () => r().gph, C152_CRUISE_FUEL_GPH, 'gal/h', FLOWN_MS);
    item(ID, '  power fraction while it is measured', () => r().power, { min: 0.73, max: 0.77, source: 'the cruise point held' }, '', FLOWN_MS);
  });

  describe.runIf(flownTier(ID))('carburettor ice (flown tier)', () => {
    // 10 min of level-flight power (2000 rpm at 4000 ft above the field, about 73 KTAS) at 10 C with a 3 K dew-point
    // spread, carburettor heat cold, airspeed held by the autopilot (the aircraft sinks as the power falls); then
    // full heat until the ice has gone, then heat cold again.
    const r = once(() => {
      const k = C152_CARB_ICE;
      const alt = ELEVATION + 4000 * FT;
      const env = flatEnvironment(calmWeather({ isaDeviation: k.oatC - (15 - 0.0065 * alt) }));
      const sample = { dewPointSpread: k.spreadK, inCloud: false };
      env.moisture = () => sample;
      const rig = makeRig({ def, loading: 'maxGross', env });
      let lo = 50 * KT, hi = 110 * KT;
      for (let i = 0; i < 20; i++) {
        const mid = 0.5 * (lo + hi);
        resetTo(rig, { position: at(alt), airspeed: mid });
        if (rig.fm.state.engines[0].rpm < k.rpm) lo = mid;
        else hi = mid;
      }
      resetTo(rig, { position: at(alt), airspeed: lo });
      const s = rig.fm.state, c = rig.controls;
      const ap = new Autopilot(def.autopilot);
      ap.settings = { ...ap.settings, lateral: 'wingLeveler', vertical: 'airspeed', airspeed: s.ias, autoTrim: true };
      const rpm0 = s.engines[0].rpm;
      rig.run(k.minutes * 60, () => ap.update(FRAME, s, c));
      const iced = s.engines[0].rpm;
      c.carbHeat = 1;
      const t0 = s.time;
      let dip = Infinity, melted = Infinity;
      rig.run(90, () => {
        ap.update(FRAME, s, c);
        dip = Math.min(dip, s.engines[0].rpm);
        if (melted === Infinity && s.engines[0].carbIce <= 0.02) melted = s.time - t0;
      });
      c.carbHeat = 0;
      rig.run(30, () => ap.update(FRAME, s, c));
      return { loss: rpm0 - iced, dip: iced - dip, melted, back: s.engines[0].rpm - rpm0, oatC: s.oat - 273.15 };
    });
    item(ID, `rpm lost to ice in ${C152_CARB_ICE.minutes} min at ${C152_CARB_ICE.rpm} rpm, ${C152_CARB_ICE.oatC} C, spread ${C152_CARB_ICE.spreadK} K`, () => r().loss, C152_CARB_ICE.lossRpm, 'rpm', FLOWN_MS);
    item(ID, '  full heat: the further dip before the ice melts', () => r().dip, { min: 10, max: Infinity, source: 'contract 5.1: "after a further dip"' }, 'rpm', FLOWN_MS);
    item(ID, '  full heat: time until the ice has melted', () => r().melted, C152_CARB_ICE.recoverS, 's', FLOWN_MS);
    item(ID, '  heat cold again: rpm against the ice-free figure', () => r().back, { min: -25, max: 25, source: 'the rpm lost is recovered' }, 'rpm', FLOWN_MS);
  });
});
