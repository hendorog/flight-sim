// Conformance of the Piper PA-38-112 Tomahawk II (quick tier always; flown tier with FS_AIRCRAFT=pa38 or all): the
// suite's blocks on the targets of contract 5.2 (targets/pa38.ts), the keyboard circuit, and the 5.2 items no
// generic block measures: the fuel flow of the 75 % cruise, the rest attitude and propeller clearance, the fuel
// pressure of either pump, the nosewheel-lift speed, the pitch trim change with power, the lateral imbalance after
// an hour on one tank, the take-off trim, and the autopilot hold's rudder.

import { beforeAll, describe } from 'vitest';
import C172S_DEFINITION from '../../src/aircraft/c172s/index';
import { loadAircraft } from '../../src/aircraft/registry';
import type { AircraftDefinition } from '../../src/aircraft/types';
import { DEG, FT, KT } from '../../src/core/math';
import { ELEVATION, FRAME, at, flatEnvironment, makeRig, resetTo, type Rig } from '../fdm/helpers';
import { LOW_TERRAIN, RUNWAY_HEADING, brakePower, centrelineHeading, cruiseSpeed, pedalSteer, restOnGround, runUpTo, runwayRig, tasForKias } from '../fdm/measure';
import { Autopilot } from '../../src/physics';
import type { BladeElementFlightModel } from '../../src/physics/flightModel';
import { keyboardCircuit } from './keyboard';
import { once } from './plan';
import { describeAircraft, flownTier, item } from './suite';
import {
  PA38_CRUISE_ALT, PA38_CRUISE_FUEL_GPH, PA38_FUEL_PRESSURE, PA38_HOLD, PA38_NOSE_LIFT_KIAS, PA38_ONE_TANK_AILERON, PA38_POWER_TRIM_RATIO, PA38_REST,
  PA38_TAKEOFF_TRIM, PA38_TARGETS,
} from './targets/pa38';

const ID = 'pa38';
const QUICK_MS = 120_000;
const FLOWN_MS = 300_000;
/** kg/s per US gal/h of 100LL. */
const GPH = (3.785411784e-3 * 719) / 3600;

describeAircraft(PA38_TARGETS);
// The circuit pilot flies with the Tomahawk's tachometer settings (targets/pa38.ts KEYBOARD_PILOT_TARGETS).
keyboardCircuit({ aircraft: ID });

/** Elevator deflection (rad) trimmed at `kias` and 3000 ft with the throttle fixed. */
function trimmedElevator(rig: Rig<BladeElementFlightModel>, def: AircraftDefinition, kias: number, throttle: number): number {
  const alt = ELEVATION + 3000 * FT;
  resetTo(rig, { position: at(alt), airspeed: tasForKias(def, kias, alt) });
  const t = rig.fm.solveTrim({ tas: tasForKias(def, kias, alt), altitude: alt, throttle }, rig.env);
  if (!t.converged) throw new Error(`${def.id}: trim at ${kias} KIAS, throttle ${throttle} did not converge`);
  return t.elevator;
}

describe(`conformance ${ID}: items of contract 5.2 outside the generic blocks`, () => {
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
    item(ID, 'rest attitude (fuselage pitch on the ground)', () => r().pitchDeg, PA38_REST.pitchDeg, 'deg', QUICK_MS);
    item(ID, 'propeller ground clearance at rest', () => r().clearance, PA38_REST.propClearanceM, 'm', QUICK_MS);
  });

  describe('fuel pressure, either pump', () => {
    // The engine-driven pump alone at the 1800 rpm run-up; the electric pump alone with the engine stopped and the
    // master on. Low wing: no head of fuel adds to either (powerplant.ts).
    const r = once(() => {
      const rig = makeRig({ def, loading: 'maxGross' });
      resetTo(rig, { onGround: true, heading: RUNWAY_HEADING });
      const c = rig.controls;
      c.fuelPump = false;
      runUpTo(rig, 1800);
      const engine = rig.fm.state.engines[0].fuelPressure;
      resetTo(rig, { onGround: true, heading: RUNWAY_HEADING, engineRunning: false });
      c.masterBattery = true;
      c.fuelPump = true;
      rig.run(3);
      return { engine, electric: rig.fm.state.engines[0].fuelPressure, rpm: rig.fm.state.engines[0].rpm };
    });
    item(ID, 'fuel pressure, engine-driven pump at 1800 rpm', () => r().engine, PA38_FUEL_PRESSURE, 'psi', QUICK_MS);
    item(ID, 'fuel pressure, electric pump, engine stopped', () => r().electric, PA38_FUEL_PRESSURE, 'psi', QUICK_MS);
  });

  describe('pitch trim change with power', () => {
    // Elevator trimmed at 70 KIAS with the throttle closed and wide open, against the C172S's at the same speed: the
    // T-tail stands above the slipstream (s.11).
    const r = once(() => {
      const own = makeRig({ def, loading: 'maxGross' });
      const ref = makeRig({ def: C172S_DEFINITION, loading: 'maxGross' });
      const change = Math.abs(trimmedElevator(own, def, 70, 1) - trimmedElevator(own, def, 70, 0));
      const c172 = Math.abs(trimmedElevator(ref, C172S_DEFINITION, 70, 1) - trimmedElevator(ref, C172S_DEFINITION, 70, 0));
      return { change, c172, ratio: change / c172 };
    });
    item(ID, 'elevator change, idle to full power at 70 KIAS', () => r().change / DEG, { min: 0, max: Infinity, source: 'reported' }, 'deg', QUICK_MS);
    item(ID, '  as a fraction of the C172S\'s', () => r().ratio, PA38_POWER_TRIM_RATIO, '', QUICK_MS);
  });

  describe('an hour on one tank', () => {
    // 95 KTAS at 3000 ft with full tanks; then the left tank 6.5 US gal (17.7 kg, an hour at 75 %) lighter: the wings
    // held level by aileron, against the aileron of the balanced aircraft. The fuel sits 1.1 m out (powerplant.ts).
    const r = once(() => {
      const rig = makeRig({ def, loading: 'maxGross' });
      const alt = ELEVATION + 3000 * FT;
      const spec = { tas: 95 * KT, altitude: alt, flightPathAngle: 0 };
      resetTo(rig, { position: at(alt), airspeed: spec.tas });
      const balanced = rig.fm.solveTrim(spec, rig.env).aileron;
      const fm = rig.fm;
      const tanks = Array.from(fm.propulsion.tankQuantities);
      tanks[0] -= 6.5 * 6 * 0.45359237;
      fm.propulsion.reset({ running: true, tanks, rpm: fm.state.engines[0].rpm, warm: true });
      rig.run(1);
      const t = fm.solveTrim(spec, rig.env);
      return { aileron: Math.abs(t.aileron - balanced), converged: t.converged };
    });
    item(ID, 'aileron for wings level after an hour on the left tank', () => (r().converged ? r().aileron : NaN), PA38_ONE_TANK_AILERON, '', QUICK_MS);
  });

  describe('take-off trim', () => {
    // The trim wheel a runway start sets (the full-power climb at Vy, flightModel.ts), typical and forward loadings.
    const r = once(() => {
      const trimFor = (loading: 'typical' | 'forward') => {
        const rig = makeRig({ def, loading });
        resetTo(rig, { onGround: true, heading: RUNWAY_HEADING });
        return rig.fm.trimControls.elevatorTrim;
      };
      return { typical: trimFor('typical'), forward: trimFor('forward') };
    });
    item(ID, 'take-off trim, typical loading', () => r().typical, PA38_TAKEOFF_TRIM, '', QUICK_MS);
    item(ID, 'take-off trim, forward limit at maximum weight', () => r().forward, PA38_TAKEOFF_TRIM, '', QUICK_MS);
  });

  describe('autopilot hold', () => {
    // Heading and altitude hold with the yaw damper, 80 KIAS at 4000 ft, the throttle where the trim left it; 10 s to
    // settle, then 60 s measured.
    const r = once(() => {
      const rig = makeRig({ def, loading: 'maxGross', env: flatEnvironment() });
      const s = rig.fm.state, c = rig.controls;
      const alt = ELEVATION + 4000 * FT;
      resetTo(rig, { position: at(alt), airspeed: tasForKias(def, 80, alt) });
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
    item(ID, 'A-key hold 60 s at 80 KIAS: mean |rudder|', () => r().rudder, PA38_HOLD.meanRudder, '', QUICK_MS);
    item(ID, 'A-key hold 60 s at 80 KIAS: largest sideslip', () => r().betaDeg, PA38_HOLD.maxSideslipDeg, 'deg', QUICK_MS);
    item(ID, 'A-key hold 60 s at 80 KIAS: speed lost', () => r().lossKt, PA38_HOLD.speedLossKt, 'kt', QUICK_MS);
  });

  describe.runIf(flownTier(ID))('nosewheel lift (flown tier)', () => {
    // Full throttle on the runway at the forward limit with the yoke held fully back from brake release: the speed at
    // which the nose wheel leaves the ground ("little elevator authority until about 35 KIAS", s.11).
    const r = once(() => {
      const rig = runwayRig(def, 'forward');
      resetTo(rig, { onGround: true, position: at(0), heading: RUNWAY_HEADING });
      const s = rig.fm.state, c = rig.controls;
      c.parkingBrake = false;
      c.brakeLeft = c.brakeRight = 0;
      c.throttle = 1;
      c.elevator = 1;
      let lift = NaN;
      rig.run(40, () => {
        pedalSteer(s, c, centrelineHeading(s));
        if (Number.isNaN(lift) && !s.wheels[0].onGround && s.wheels[1].onGround) lift = s.ias / KT;
        return !Number.isNaN(lift) || !s.onGround;
      });
      return lift;
    });
    item(ID, 'nosewheel-lift speed, full power, yoke fully back, forward CG', () => r(), PA38_NOSE_LIFT_KIAS, 'KIAS', FLOWN_MS);
  });

  describe.runIf(flownTier(ID))('fuel flow in the 75 % cruise (flown tier)', () => {
    // The cruise of the 'cruise and climb at altitude' block, leaned for best power, flown for 5 s at its throttle.
    const r = once(() => {
      const rig = makeRig({ def, loading: 'maxGross', env: flatEnvironment(undefined, LOW_TERRAIN) });
      const c = PA38_TARGETS.cruise!;
      const cruise = cruiseSpeed(rig, { altitude: PA38_CRUISE_ALT, powerFraction: c.powerFraction, bracketKt: c.bracketKt, leanAtKt: c.leanAtKt, resetKt: c.resetKt });
      const trim = rig.fm.solveTrim({ tas: cruise.ktas * KT, altitude: PA38_CRUISE_ALT }, rig.env, { mixture: cruise.mixture });
      resetTo(rig, { position: at(PA38_CRUISE_ALT), airspeed: cruise.ktas * KT });
      rig.controls.mixture = cruise.mixture;
      rig.controls.throttle = trim.throttle;
      rig.run(5);
      return { gph: rig.fm.state.engines[0].fuelFlow / GPH, power: brakePower(rig.fm) / def.powerplant.engines[0].engine.ratedPower };
    });
    item(ID, 'fuel flow at 75 % power, 7000 ft, best power', () => r().gph, PA38_CRUISE_FUEL_GPH, 'gal/h', FLOWN_MS);
    item(ID, '  power fraction while it is measured', () => r().power, { min: 0.73, max: 0.77, source: 'the cruise point held' }, '', FLOWN_MS);
  });
});
