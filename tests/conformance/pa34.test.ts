// Conformance of the Piper PA-34-200 Seneca I (quick tier always; flown tier with FS_AIRCRAFT=pa34 or all): the
// suite's blocks on the targets of contract 5.4 (targets/pa34.ts) with the twin blocks, the keyboard circuit and the
// keyboard engine-out, and the 5.4 items no generic block measures: the rest attitude and propeller clearance, the
// propeller exercise and the feathering (time and lock-out), the gear horn's manifold pressure, the one-engine rudder
// trim, the hands-off full-power take-off roll, the cylinder heads with the cowl flaps closed and open, the fuel flow
// of the 75 % cruise, and the autopilot hold's rudder.

import { beforeAll, describe } from 'vitest';
import { loadAircraft } from '../../src/aircraft/registry';
import type { AircraftDefinition } from '../../src/aircraft/types';
import { DEG, FT, KT } from '../../src/core/math';
import { PROP_FEATHER_GATE, setEngineControl } from '../../src/core/types';
import { Autopilot } from '../../src/physics';
import { ELEVATION, FRAME, at, flatEnvironment, makeRig, resetTo } from '../fdm/helpers';
import { LOW_TERRAIN, RUNWAY_HEADING, cruiseSpeed, engineOutTrim, restOnGround, rpmDrop, runUpTo, runwayRig, tasForKcas, tasForKias } from '../fdm/measure';
import { keyboardCircuit, keyboardEngineOut } from './keyboard';
import { once } from './plan';
import { describeAircraft, flownTier, item } from './suite';
import {
  PA34_COWL_CHT_C, PA34_CRUISE_ALT, PA34_CRUISE_FUEL_GPH, PA34_FEATHER_S, PA34_HOLD, PA34_HORN_INHG, PA34_OEI_RUDDER_TRIM, PA34_PROP_EXERCISE_RPM,
  PA34_REST, PA34_TAKEOFF_SWING_DEG, PA34_TARGETS,
} from './targets/pa34';

const ID = 'pa34';
const QUICK_MS = 120_000;
const FLOWN_MS = 300_000;
/** kg/s per US gal/h of 100LL. */
const GPH = (3.785411784e-3 * 719) / 3600;
/** Propeller lever for a governed rpm (aircraft/pa34/powerplant.ts: 1700 at the feather gate, 2700 at the stop). */
const propellerFor = (rpm: number) => PROP_FEATHER_GATE + ((1 - PROP_FEATHER_GATE) * (rpm - 1700)) / 1000;

describeAircraft(PA34_TARGETS);
// The circuit pilot flies the Seneca on manifold pressure (targets/pa34.ts KEYBOARD_PILOT_TARGETS).
keyboardCircuit({ aircraft: ID });
keyboardEngineOut({ aircraft: ID });

describe(`conformance ${ID}: items of contract 5.4 outside the generic blocks`, () => {
  let def!: AircraftDefinition;
  beforeAll(async () => {
    def = await loadAircraft(ID);
  });

  describe('rest attitude and propeller clearance', () => {
    const r = once(() => {
      const rest = restOnGround(makeRig({ def, loading: 'maxGross' }));
      // The lowest point of a propeller disc (it stands in the body y-z plane), above the ground.
      const p = def.geometry.propellers[0];
      const pitch = rest.pitchDeg * DEG;
      const tip = -p.hub.x * Math.sin(pitch) + (p.hub.z + p.diameter / 2) * Math.cos(pitch);
      return { pitchDeg: rest.pitchDeg, clearance: rest.height - tip };
    });
    item(ID, 'rest attitude (fuselage pitch on the ground)', () => r().pitchDeg, PA34_REST.pitchDeg, 'deg', QUICK_MS);
    item(ID, 'propeller ground clearance at rest', () => r().clearance, PA34_REST.propClearanceM, 'm', QUICK_MS);
  });

  describe('propellers on the ground: exercise and feather lock-out', () => {
    // Run-up at 2000 rpm (left engine), then the propeller lever back to the low-rpm end short of the feather detent
    // (DSU checklist, s.10). Then at idle, below the 800 rpm of the latches, the lever into feather: the blades stay
    // where they are (OH-2: no feathering below 800 rpm).
    const r = once(() => {
      const rig = makeRig({ def, loading: 'maxGross' });
      runUpTo(rig, 2000, 0);
      const drop = rpmDrop(rig, { propeller: PROP_FEATHER_GATE + 0.01 }, 0, 6);
      resetTo(rig, { onGround: true, position: at(0) });
      rig.controls.throttle = 0;
      rig.run(5);
      const idle = rig.fm.state.engines[0].rpm;
      setEngineControl(rig.controls, 0, 'propeller', 0);
      rig.run(10);
      return { drop, idle, feathered: rig.fm.state.propellers[0].feathered, pitchDeg: rig.fm.state.propellers[0].bladePitch / DEG };
    });
    item(ID, 'propeller exercise at 2000 rpm: rpm drop', () => r().drop, PA34_PROP_EXERCISE_RPM, 'rpm', QUICK_MS);
    item(ID, 'feather selected at idle (below 800 rpm): blade angle after 10 s', () => (r().feathered ? Infinity : r().pitchDeg), { min: 0, max: 17, source: 'OH-2, AFM: latched below 800 rpm (contract 5.4)' }, 'deg', QUICK_MS);
  });

  describe('feathering in flight', () => {
    // Trimmed at Vyse; the right engine's throttle and mixture closed, then its propeller lever into feather: the time
    // until the blades are at the feather stop (OH-2: about 6 s).
    const r = once(() => {
      const rig = makeRig({ def, loading: 'maxGross', env: flatEnvironment(undefined, LOW_TERRAIN) });
      const alt = 1000 * FT;
      resetTo(rig, { position: at(alt), airspeed: tasForKcas(rig, 91, alt) });
      const c = rig.controls, s = rig.fm.state;
      setEngineControl(c, 1, 'throttle', 0);
      setEngineControl(c, 1, 'mixture', 0);
      setEngineControl(c, 1, 'propeller', 0);
      const t0 = s.time;
      let t = Infinity;
      rig.run(15, () => {
        if (s.propellers[1].feathered) {
          t = s.time - t0;
          return true;
        }
      });
      return t;
    });
    item(ID, 'feathering time, right engine at Vyse', () => r(), PA34_FEATHER_S, 's', QUICK_MS);
  });

  describe('gear horn', () => {
    // Gear up at 100 KIAS near sea level with 2000 rpm set, the throttles closed slowly: the manifold pressure when the
    // horn sounds (OH-2: 14 inHg; the quadrant's microswitch, s.9). Then with one throttle open and the other closed
    // (the identify / verify drill on a dead engine) the horn sounds too.
    const r = once(() => {
      const rig = makeRig({ def, loading: 'maxGross', env: flatEnvironment(undefined, LOW_TERRAIN) });
      const alt = 500 * FT;
      resetTo(rig, { position: at(alt), airspeed: tasForKias(def, 100, alt) });
      const c = rig.controls, s = rig.fm.state;
      c.gearLever = 'up';
      c.propeller = propellerFor(2000);
      c.throttle = 0.6;
      rig.run(10);
      let map = NaN;
      rig.run(30, () => {
        c.throttle = Math.max(0, c.throttle - 0.02 * FRAME);
        if (s.gear.warning) {
          map = s.engines[0].manifoldPressure;
          return true;
        }
      });
      c.throttle = 0.6;
      rig.run(2);
      const quietBoth = !s.gear.warning;
      setEngineControl(c, 1, 'throttle', 0);
      rig.run(1);
      return { map, oneClosed: quietBoth && s.gear.warning };
    });
    item(ID, 'gear horn: manifold pressure at the throttle switch, 2000 rpm, sea level', () => r().map, PA34_HORN_INHG, 'inHg', QUICK_MS);
    item(ID, 'gear horn: one throttle closed sounds it', () => (r().oneClosed ? 1 : 0), { min: 1, max: 1, source: 'OH-2, s.9: the dead engine\'s throttle closed (contract 5.4)' }, '', QUICK_MS);
  });

  describe('one-engine rudder trim', () => {
    // The one-engine climb at Vyse (left engine failed and feathered, zero sideslip, live engine full throttle, its
    // cowl flap open): the rudder it needs as a fraction of what the rudder trim can hold (OH-2: "essential").
    const r = once(() => {
      const rig = makeRig({ def, loading: 'aft', env: flatEnvironment(undefined, LOW_TERRAIN) });
      const t = engineOutTrim(rig, { failed: 0, propeller: 'feathered', kcas: 91, altitude: 0, throttle: 1, lateral: 'zeroSideslip', cowlFlaps: [0, 1] });
      const trim = def.controls.rudder.trim!;
      return t.converged ? (Math.abs(t.rudder) * def.controls.rudder.maxDeflection) / trim.authority : NaN;
    });
    item(ID, 'one-engine climb at Vyse, feathered: rudder trim needed', () => r(), PA34_OEI_RUDDER_TRIM, '', QUICK_MS);
  });

  describe('autopilot hold', () => {
    // Heading and altitude hold with the yaw damper, 120 KIAS at 4000 ft, the throttles where the trim left them; 10 s
    // to settle, then 60 s measured: the rudder steady (not limit-cycling) and the speed held.
    const r = once(() => {
      const rig = makeRig({ def, loading: 'maxGross', env: flatEnvironment() });
      const s = rig.fm.state, c = rig.controls;
      const alt = ELEVATION + 4000 * FT;
      resetTo(rig, { position: at(alt), airspeed: tasForKias(def, 120, alt) });
      const ap = new Autopilot(def.autopilot);
      ap.settings = { ...ap.settings, lateral: 'heading', vertical: 'altitude', heading: s.heading, altitude: s.altitudeMSL, autoTrim: false, yawDamper: true };
      const ias0 = s.ias;
      let t = 0, sum = 0, n = 0, beta = 0;
      rig.run(70, () => {
        ap.update(FRAME, s, c);
        t += FRAME;
        if (t > 10) {
          sum += Math.abs(c.rudder);
          n++;
          beta = Math.max(beta, Math.abs(s.beta));
        }
      });
      return { rudder: sum / n, betaDeg: beta / DEG, lossKt: (ias0 - s.ias) / KT };
    });
    item(ID, 'A-key hold 60 s at 120 KIAS: mean |rudder|', () => r().rudder, PA34_HOLD.meanRudder, '', QUICK_MS);
    item(ID, 'A-key hold 60 s at 120 KIAS: largest sideslip', () => r().betaDeg, PA34_HOLD.maxSideslipDeg, 'deg', QUICK_MS);
    item(ID, 'A-key hold 60 s at 120 KIAS: speed lost', () => r().lossKt, PA34_HOLD.speedLossKt, 'kt', QUICK_MS);
  });

  describe.runIf(flownTier(ID))('hands-off full-power take-off roll (flown tier)', () => {
    // Both throttles full from a standstill on the runway centre line, feet and hands off: the heading 10 s later
    // (counter-rotation: no swing).
    const r = once(() => {
      const rig = runwayRig(def, 'maxGross');
      resetTo(rig, { onGround: true, position: at(0), heading: RUNWAY_HEADING });
      const s = rig.fm.state, c = rig.controls;
      c.parkingBrake = false;
      c.brakeLeft = c.brakeRight = 0;
      c.throttle = 1;
      const h0 = s.heading;
      let worst = 0;
      rig.run(10, () => {
        let d = s.heading - h0;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        worst = Math.max(worst, Math.abs(d));
      });
      return worst / DEG;
    });
    item(ID, 'hands-off full-power take-off roll: largest heading change in 10 s', () => r(), PA34_TAKEOFF_SWING_DEG, 'deg', FLOWN_MS);
  });

  describe.runIf(flownTier(ID))('cylinder heads in the climb, cowl flaps closed and open (flown tier)', () => {
    // A full-power climb at Vy held by the autopilot for 5 minutes, once with the cowl flaps open and once closed: the
    // left engine's cylinder heads at the end.
    const r = once(() => {
      const cht = (cowl: number) => {
        const rig = makeRig({ def, loading: 'maxGross', env: flatEnvironment(undefined, LOW_TERRAIN) });
        const alt = 1000 * FT;
        resetTo(rig, { position: at(alt), airspeed: tasForKias(def, 91, alt), flightPathAngle: 6 * DEG });
        const s = rig.fm.state, c = rig.controls;
        c.throttle = 1;
        c.cowlFlaps = cowl;
        const ap = new Autopilot(def.autopilot);
        ap.settings = { ...ap.settings, lateral: 'wingLeveler', vertical: 'airspeed', airspeed: 91 * KT, autoTrim: true, yawDamper: true };
        rig.run(300, () => void ap.update(FRAME, s, c));
        return s.engines[0].cht;
      };
      const open = cht(1), closed = cht(0);
      return { open, closed };
    });
    item(ID, 'CHT in the Vy climb, cowl flaps open', () => r().open, { min: 93, max: 246, source: 'AFM green arc 200-475 F (s.4)' }, 'C', FLOWN_MS);
    item(ID, 'CHT in the Vy climb, cowl flaps closed against open', () => r().closed - r().open, PA34_COWL_CHT_C, 'C', FLOWN_MS);
  });

  describe.runIf(flownTier(ID))('fuel flow in the 75 % cruise (flown tier)', () => {
    // The cruise of the 'cruise and climb at altitude' block (75 % at 6000 ft, leaned for best power), flown for 5 s.
    const r = once(() => {
      const rig = makeRig({ def, loading: 'maxGross', env: flatEnvironment(undefined, LOW_TERRAIN) });
      const c = PA34_TARGETS.cruise!;
      const cruise = cruiseSpeed(rig, { altitude: PA34_CRUISE_ALT, powerFraction: c.powerFraction, bracketKt: c.bracketKt, leanAtKt: c.leanAtKt, resetKt: c.resetKt });
      const trim = rig.fm.solveTrim({ tas: cruise.ktas * KT, altitude: PA34_CRUISE_ALT }, rig.env, { mixture: cruise.mixture });
      resetTo(rig, { position: at(PA34_CRUISE_ALT), airspeed: cruise.ktas * KT });
      rig.controls.mixture = cruise.mixture;
      rig.controls.throttle = trim.throttle;
      rig.run(5);
      return rig.fm.state.engines[0].fuelFlow / GPH;
    });
    item(ID, 'fuel flow per engine at 75 % power, 6000 ft', () => r(), PA34_CRUISE_FUEL_GPH, 'gal/h', FLOWN_MS);
  });
});
