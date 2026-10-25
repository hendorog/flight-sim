// Conformance of the Cessna 208 Caravan 675 (quick tier always; flown tier with FS_AIRCRAFT=c208 or all): the suite's
// blocks on the targets of targets/c208.ts, and the items no generic block measures: the rest attitude and propeller
// clearance, the engine at the take-off power setting (torque, ITT, Ng, Np inside the limits), and the fuel flow
// of the maximum cruise, the idle taxi on the gate and in beta, the idle descents, and the keyboard circuit (flown by torque:
// targets/c208.ts KEYBOARD_PILOT_TARGETS) with the plan's speed, flap, touchdown and beta checks.

import { beforeAll, describe } from 'vitest';
import { loadAircraft } from '../../src/aircraft/registry';
import type { AircraftDefinition } from '../../src/aircraft/types';
import { DEG, FT, KT } from '../../src/core/math';
import { at, flatEnvironment, makeRig, resetTo } from '../fdm/helpers';
import { LOW_TERRAIN, cruiseSpeed, idleDescent, idleTaxi, restOnGround } from '../fdm/measure';
import { once } from './plan';
import { flyCircuit, makeRig as makeKeyboardRig, type FlightLog } from '../input/keyboardPilot';
import { keyboardCircuit, keyboardPilotOptions } from './keyboard';
import { describeAircraft, flownTier, item } from './suite';
import { AIRPORT } from '../../src/core/world';
import { C208_BETA_TAXI, C208_CRUISE_FUEL_PPH, C208_IDLE_DESCENT, C208_KEYBOARD_CIRCUIT, C208_REST, C208_TAKEOFF_LIMITS, C208_TARGETS, KEYBOARD_PILOT_TARGETS } from './targets/c208';

const ID = 'c208';
const QUICK_MS = 120_000;
const FLOWN_MS = 300_000;
/** lb/h per kg/s. */
const PPH = 3600 / 0.45359237;
/** ft lbf per N m. */
const FT_LB = 1 / 1.3558179;

describeAircraft(C208_TARGETS);
// The circuit pilot flies by torque (targets/c208.ts KEYBOARD_PILOT_TARGETS).
keyboardCircuit({ aircraft: ID });

describe(`conformance ${ID}: items outside the generic blocks`, () => {
  let def!: AircraftDefinition;
  beforeAll(async () => {
    def = await loadAircraft(ID);
  });

  describe('rest attitude and propeller clearance', () => {
    const r = once(() => {
      const rest = restOnGround(makeRig({ def, loading: 'maxGross' }));
      const p = def.geometry.propellers[0];
      const pitch = rest.pitchDeg * DEG;
      const tip = -p.hub.x * Math.sin(pitch) + (p.hub.z + p.diameter / 2) * Math.cos(pitch);
      return { pitchDeg: rest.pitchDeg, clearance: rest.height - tip };
    });
    item(ID, 'rest attitude (fuselage pitch on the ground)', () => r().pitchDeg, C208_REST.pitchDeg, 'deg', QUICK_MS);
    item(ID, 'propeller ground clearance at rest', () => r().clearance, C208_REST.propClearanceM, 'm', QUICK_MS);
  });

  describe('the engine at the take-off setting', () => {
    // Static on the brakes at the field, the power lever at the take-off setting of the scripted pilot, 15 s.
    const r = once(() => {
      const rig = makeRig({ def, loading: 'maxGross' });
      resetTo(rig, { onGround: true, position: at(0) });
      rig.controls.throttle = def.sim.autoflight.takeoff.throttle ?? 1;
      rig.controls.mixture = 1;
      rig.run(15);
      const e = rig.fm.state.engines[0];
      const gear = def.powerplant.engines[0].engine.gearRatio;
      return { torque: e.torque * gear * FT_LB, itt: e.itt ?? NaN, ng: e.ng ?? NaN, np: e.propRpm };
    });
    item(ID, 'take-off setting: propeller-shaft torque', () => r().torque, C208_TAKEOFF_LIMITS.torqueFtLb, 'ft lb', QUICK_MS);
    item(ID, '  ITT', () => r().itt, C208_TAKEOFF_LIMITS.ittC, 'C', QUICK_MS);
    item(ID, '  Ng', () => r().ng, C208_TAKEOFF_LIMITS.ng, '%', QUICK_MS);
    item(ID, '  Np', () => r().np, C208_TAKEOFF_LIMITS.np, 'rpm', QUICK_MS);
  });

  describe.runIf(flownTier(ID))('taxi at idle on the gate and in beta (flown tier)', () => {
    // As the suite's idle-taxi block (measure.ts idleTaxi: level runway, no brakes), rolled until the speed is steady:
    // a 3.6 t aircraft on about 1 kN of idle thrust takes minutes to settle.
    for (const k of C208_BETA_TAXI) {
      const idle = k.condition < 0.5 ? 'LOW IDLE' : 'HIGH IDLE';
      const r = once(() => idleTaxi(makeRig({ def, loading: 'maxGross' }), { reverse: k.reverse, condition: k.condition, seconds: 600 }));
      item(ID, `idle taxi, ${k.label} (reverse ${k.reverse}, ${idle}): steady unbraked ground speed`, () => r().speedKt, k.speedKt, 'kt', FLOWN_MS);
      item(ID, `idle taxi, ${k.label}: static thrust on the parking brake`, () => r().staticThrustN, k.thrustN, 'N', FLOWN_MS);
      item(ID, `idle taxi, ${k.label}: Np on the parking brake`, () => r().staticNp, k.np, 'rpm', FLOWN_MS);
      item(ID, `idle taxi, ${k.label}: the speed settled (1 = yes)`, () => Number(r().steady), k.settled, '', FLOWN_MS);
    }
  });

  describe('idle descents: the propeller on its low-pitch stop drags', () => {
    for (const k of C208_IDLE_DESCENT) {
      const r = once(() => idleDescent(makeRig({ def, loading: 'maxGross' }), { kias: k.kias, flapLever: k.flapLever, altitude: AIRPORT.elevation + 5000 * FT }));
      item(ID, `idle descent, ${k.label}: propeller thrust`, () => r().thrustN, k.thrustN, 'N', QUICK_MS);
      item(ID, `idle descent, ${k.label}: flight path below the horizon`, () => r().pathDeg, k.pathDeg, 'deg', QUICK_MS);
    }
  });

  describe.runIf(flownTier(ID))('fuel flow in the maximum cruise (flown tier)', () => {
    const r = once(() => {
      const rig = makeRig({ def, loading: 'maxGross', env: flatEnvironment(undefined, LOW_TERRAIN) });
      const c = C208_TARGETS.cruise!;
      const alt = c.altitudeFt * FT;
      const cruise = cruiseSpeed(rig, { altitude: alt, powerFraction: c.powerFraction, bracketKt: c.bracketKt, resetKt: c.resetKt });
      const trim = rig.fm.solveTrim({ tas: cruise.ktas * KT, altitude: alt }, rig.env);
      resetTo(rig, { position: at(alt), airspeed: cruise.ktas * KT });
      rig.controls.throttle = trim.throttle;
      rig.run(5);
      return rig.fm.state.engines[0].fuelFlow * PPH;
    });
    item(ID, 'fuel flow at maximum cruise, 10 000 ft', () => r(), C208_CRUISE_FUEL_PPH, 'lb/h', FLOWN_MS);
  });

  describe.runIf(flownTier(ID))('keyboard circuit: speeds, flaps, touchdown and beta (flown tier)', () => {
    // The circuit pilot of keyboardCircuit in light turbulence, judged on the numbers a Caravan pilot flies.
    const r = once(() => {
      const res = flyCircuit(makeKeyboardRig({ turbulence: 0.1 }, keyboardPilotOptions(def, KEYBOARD_PILOT_TARGETS)));
      const log = res.log;
      const range = (a: FlightLog[], f: (l: FlightLog) => number): [number, number] => [Math.min(...a.map(f)), Math.max(...a.map(f))];
      const climb = log.filter((l) => l.phase === 'climb' && l.altAgl > 60);
      // Established on the downwind (20 s after the turn) and before the power comes back abeam the threshold.
      const downwind = log.filter((l) => l.phase === 'downwind' && l.t > (res.phaseTimes.downwind ?? 0) + 20 && l.along > -AIRPORT.runway.length / 2 + 100);
      const vfe = def.reference.vfe, detents = def.input.flapDetents;
      const flapOverspeed = log.filter((l) => detents.some((d, i) => i > 0 && l.flaps >= d - 0.01 && l.kias > vfe[i - 1])).length;
      const slow = log.filter((l) => l.phase === 'rollout' && l.kias < 60);
      const takeoff = log.filter((l) => l.phase === 'takeoffRoll' || l.phase === 'rotate' || l.phase === 'climb' || l.phase === 'crosswind');
      return {
        res,
        climb: range(climb, (l) => l.kias),
        downwind: range(downwind, (l) => l.kias),
        flapOverspeed,
        betaBelow60: slow.length ? Math.min(...slow.map((l) => l.reverse ?? 0)) : NaN,
        torqueMax: Math.max(...takeoff.map((l) => l.power)),
        touchdownM: res.touchdown ? res.touchdown.along + AIRPORT.runway.length / 2 : NaN,
      };
    });
    const K = C208_KEYBOARD_CIRCUIT;
    item(ID, 'keyboard circuit: completed to a stop, no crash (1 = yes)', () => Number(!r().res.crashed && r().res.stop !== null), K.completed, '', FLOWN_MS);
    item(ID, 'keyboard circuit: slowest climb speed (flaps 20)', () => r().climb[0], K.climbKias, 'KIAS', FLOWN_MS);
    item(ID, 'keyboard circuit: fastest climb speed (flaps 20)', () => r().climb[1], K.climbKias, 'KIAS', FLOWN_MS);
    item(ID, 'keyboard circuit: slowest downwind speed', () => r().downwind[0], K.downwindKias, 'KIAS', FLOWN_MS);
    item(ID, 'keyboard circuit: fastest downwind speed', () => r().downwind[1], K.downwindKias, 'KIAS', FLOWN_MS);
    item(ID, 'keyboard circuit: highest torque from the take-off to the downwind', () => r().torqueMax, K.torqueFtLb, 'ft lb', FLOWN_MS);
    item(ID, 'keyboard circuit: decisions with the flaps beyond their speed', () => r().flapOverspeed, K.flapOverspeed, '', FLOWN_MS);
    item(ID, 'keyboard circuit: touchdown beyond the threshold', () => r().touchdownM, K.touchdownM, 'm', FLOWN_MS);
    item(ID, 'keyboard circuit: power lever aft of the gate below 60 KIAS on the roll-out (least)', () => r().betaBelow60, K.betaBelow60, '', FLOWN_MS);
  });
});
