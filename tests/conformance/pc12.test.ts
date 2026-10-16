// Conformance of the Pilatus PC-12/47 (quick tier always; flown tier with FS_AIRCRAFT=pc12 or all): the suite's
// blocks on the targets of targets/pc12.ts, the keyboard circuit, and the plan 5.7 items no generic block measures:
// the rest attitude and propeller clearance; the engine at the PCL's torque limit (sea level static, 10 000 ft at
// 150 KIAS), hot and high at the ITT limit; the maximum-cruise rows (TAS, fuel flow, ITT); the torque of a flaps-40
// approach (the flight-idle stop's guard); the pusher speeds at flaps 15 and 30 and the pusher's push at 1 kt/s; the
// landing rolls flown with the chart's technique (ground idle after touchdown); the idle-taxi speeds over 300 s; the
// take-off roll's heading with the rudder trim at zero.

import { beforeAll, describe } from 'vitest';
import { pc12TorquePsi } from '../../src/aircraft/pc12/facts';
import { PC12_GROUND_IDLE } from '../../src/aircraft/pc12/sim';
import { loadAircraft } from '../../src/aircraft/registry';
import type { AircraftDefinition } from '../../src/aircraft/types';
import { DEG, FT, KT, wrapPi } from '../../src/core/math';
import { Autopilot } from '../../src/physics';
import { ELEVATION, FRAME, at, calmWeather, flatEnvironment, makeRig, resetTo } from '../fdm/helpers';
import {
  LOW_TERRAIN, RUNWAY_HEADING, cruiseSpeed, idleTaxi, landingRoll, pedalSteer, restOnGround, runwayRig, stallRun, takeoffRoll, tasForKias,
  type SteerFn,
} from '../fdm/measure';
import { keyboardCircuit } from './keyboard';
import { once } from './plan';
import { describeAircraft, flownTier, item } from './suite';
import {
  PC12_APPROACH_TORQUE, PC12_CRUISE_ROWS, PC12_HOT_HIGH, PC12_LIMITER_10000, PC12_PUSH, PC12_PUSHER_FLAPS, PC12_REST, PC12_STATIC_TAKEOFF,
  PC12_TARGETS, PC12_TAXI, PC12_TAKEOFF_HEADING,
} from './targets/pc12';

const ID = 'pc12';
const QUICK_MS = 120_000;
const FLOWN_MS = 600_000;
/** lb/h per kg/s. */
const PPH = 3600 / 0.45359237;

describeAircraft(PC12_TARGETS);
// The circuit pilot reads the torque gauge, psi (targets/pc12.ts KEYBOARD_PILOT_TARGETS).
keyboardCircuit({ aircraft: ID });

describe(`conformance ${ID}: items of plan 5.7 outside the generic blocks`, () => {
  let def!: AircraftDefinition;
  beforeAll(async () => {
    def = await loadAircraft(ID);
  });
  const engine = (rig: { fm: { state: { engines: { torque: number; ng?: number; itt?: number; propRpm: number; fuelFlow: number }[] } } }) => {
    const e = rig.fm.state.engines[0];
    return { psi: pc12TorquePsi(e.torque), ng: e.ng ?? NaN, itt: e.itt ?? NaN, np: e.propRpm, pph: e.fuelFlow * PPH };
  };

  describe('rest attitude and propeller clearance', () => {
    const r = once(() => {
      const rest = restOnGround(makeRig({ def, loading: 'maxGross' }));
      const p = def.geometry.propellers[0];
      const pitch = rest.pitchDeg * DEG;
      const tip = -p.hub.x * Math.sin(pitch) + (p.hub.z + p.diameter / 2) * Math.cos(pitch);
      return { pitchDeg: rest.pitchDeg, clearance: rest.height - tip };
    });
    item(ID, 'rest attitude (fuselage pitch on the ground)', () => r().pitchDeg, PC12_REST.pitchDeg, 'deg', QUICK_MS);
    item(ID, 'propeller ground clearance at rest', () => r().clearance, PC12_REST.propClearanceM, 'm', QUICK_MS);
  });

  describe('static, PCL full (the torque limiter), sea level ISA', () => {
    // On the brakes on a sea-level runway, condition FLIGHT IDLE, the PCL fully forward for 15 s.
    const r = once(() => {
      const rig = makeRig({ def, loading: 'maxGross', env: flatEnvironment(undefined, 0) });
      resetTo(rig, { onGround: true, position: at(0) });
      rig.controls.throttle = 1;
      rig.controls.mixture = 1;
      rig.run(15);
      return engine(rig);
    });
    item(ID, 'static PCL full: torque', () => r().psi, PC12_STATIC_TAKEOFF.torquePsi, 'psi', QUICK_MS);
    item(ID, '  Ng', () => r().ng, PC12_STATIC_TAKEOFF.ngPct, '%', QUICK_MS);
    item(ID, '  ITT', () => r().itt, PC12_STATIC_TAKEOFF.ittC, 'C', QUICK_MS);
    item(ID, '  Np', () => r().np, PC12_STATIC_TAKEOFF.np, 'rpm', QUICK_MS);
  });

  describe('PCL full at 10 000 ft ISA, 150 KIAS', () => {
    // The full-power trim at 150 KIAS (the path is solved): the powerplant settled at the solution.
    const r = once(() => {
      const rig = makeRig({ def, loading: 'maxGross', env: flatEnvironment(undefined, LOW_TERRAIN) });
      const alt = 10_000 * FT;
      resetTo(rig, { position: at(alt), airspeed: 160 * KT });
      const t = rig.fm.solveTrim({ tas: tasForKias(def, 150, alt, 40, 120), altitude: alt, throttle: 1 }, rig.env);
      const e = rig.fm.propulsion.units[0].state;
      return { converged: t.converged, psi: pc12TorquePsi(e.torque), itt: e.itt ?? NaN };
    });
    item(ID, 'PCL full, 10 000 ft, 150 KIAS: torque', () => r().psi, PC12_LIMITER_10000.torquePsi, 'psi', QUICK_MS);
    item(ID, '  ITT', () => r().itt, PC12_LIMITER_10000.ittC, 'C', QUICK_MS);
  });

  describe('hot and high static: 8000 ft, 26 C, the PCL at the ITT limit', () => {
    // On the brakes at an 8000 ft field at 26 C (ISA + 26.8); the PCL for 800 C ITT found by bisection, 12 s a point.
    const r = once(() => {
      const elevation = 8000 * FT;
      const isaDeviation = 26 - (15 - 6.5 * (elevation / 1000));
      const rig = makeRig({ def, loading: 'maxGross', env: flatEnvironment(calmWeather({ isaDeviation }), elevation) });
      let lo = 0, hi = 1;
      let psi = NaN;
      for (let i = 0; i < 9; i++) {
        const mid = 0.5 * (lo + hi);
        resetTo(rig, { onGround: true, position: at(elevation) });
        rig.controls.throttle = mid;
        rig.controls.mixture = 1;
        rig.run(12);
        const e = engine(rig);
        if (e.itt > 800) hi = mid;
        else {
          lo = mid;
          psi = e.psi;
        }
      }
      return psi;
    });
    item(ID, 'hot and high, 8000 ft 26 C, PCL at ITT 800 C: torque', () => r(), PC12_HOT_HIGH.torquePsi, 'psi', QUICK_MS);
  });

  describe('a flaps-40 approach: the flight-idle stop', () => {
    // MLW (4500 kg: the maxGross payload less 240 kg), Vref 85 KIAS, flaps 40, gear down, a 3 deg path, condition
    // FLIGHT IDLE; the trim's torque.
    const r = once(() => {
      const mg = def.mass.loadings.maxGross;
      const rig = makeRig({ def, loading: { payload: mg.payload - (def.mass.maxTakeoff - def.mass.maxLanding), payloadPosition: mg.payloadPosition } });
      const alt = ELEVATION + 1000 * FT;
      resetTo(rig, { position: at(alt), airspeed: tasForKias(def, 85, alt, 30, 70), flaps: 1, gearDown: true, flightPathAngle: -3 * DEG });
      const t = rig.fm.lastTrim!;
      return { converged: t.converged, psi: engine(rig).psi, pitch: t.pitch / DEG };
    });
    item(ID, 'approach at Vref 85 KIAS, flaps 40, 3 deg path, MLW: torque', () => r().psi, PC12_APPROACH_TORQUE, 'psi', QUICK_MS);
  });

  describe.runIf(flownTier(ID))('maximum cruise rows (flown tier)', () => {
    // At each altitude the speed at 36.9 psi (1000 shp) level, then that trim flown 5 s: fuel flow and ITT.
    for (const row of PC12_CRUISE_ROWS) {
      const r = once(() => {
        const rig = makeRig({ def, loading: 'maxGross', env: flatEnvironment(undefined, LOW_TERRAIN) });
        const alt = row.ft * FT;
        const c = cruiseSpeed(rig, { altitude: alt, powerFraction: 36.9 / 44.34, bracketKt: [190, 290], resetKt: 240 });
        const trim = rig.fm.solveTrim({ tas: c.ktas * KT, altitude: alt }, rig.env);
        resetTo(rig, { position: at(alt), airspeed: c.ktas * KT });
        rig.controls.throttle = trim.throttle;
        rig.run(5);
        return { ktas: c.ktas, ...engine(rig) };
      });
      item(ID, `maximum cruise, ${row.ft} ft ISA, 36.9 psi: TAS`, () => r().ktas, row.ktas, 'KTAS', FLOWN_MS);
      item(ID, `  fuel flow`, () => r().pph, row.fuelPph, 'lb/h', FLOWN_MS);
      if ('ittC' in row) item(ID, `  ITT`, () => r().itt, row.ittC, 'C', FLOWN_MS);
    }
  });

  describe.runIf(flownTier(ID))('pusher speeds at flaps 15 and 30, 10 450 lb (flown tier)', () => {
    for (const p of PC12_PUSHER_FLAPS) {
      const r = once(() => stallRun(makeRig({ def, loading: 'maxGross' }), { flapLever: p.flapDeg / 40, entryKt: p.entryKt }));
      item(ID, `stall speed flaps ${p.flapDeg}, maxGross (first stick push)`, () => r().pusherCas, p.kcas, 'KCAS', FLOWN_MS);
    }
  });

  describe.runIf(flownTier(ID))('the push at 1 kt/s, flaps 40 (flown tier)', () => {
    // Trimmed at 95 KTAS with flaps 40, idle, 3000 ft up; the autopilot slows it 1 kt/s on the yoke until the first push.
    // Then the POH recovery: the pilot lets the yoke go to where the push puts it for 1.5 s, then flies the autopilot's
    // pitch hold back to level flight at full power. Measured from the push: the nose's fall (pitch at the push less
    // the lowest pitch), the height lost to the lowest point, and any later push.
    const r = once(() => {
      const rig = makeRig({ def, loading: 'forward' });
      const s = rig.fm.state, c = rig.controls;
      resetTo(rig, { airspeed: 95 * KT, position: at(ELEVATION + 3000 * FT), flaps: 1 });
      c.throttle = 0;
      const ap = new Autopilot(def.autopilot);
      ap.settings = { ...ap.settings, lateral: 'wingLeveler', vertical: 'airspeed', autoTrim: false };
      let target = s.ias / KT;
      let pushT = NaN, pushPitch = 0, pushAlt = 0, minPitch = Infinity, minAlt = Infinity, pushes = 0, was = false, t = 0;
      rig.run(70, () => {
        t += FRAME;
        if (s.stickPusher && !was) pushes++;
        was = s.stickPusher === true;
        if (Number.isNaN(pushT)) {
          target -= FRAME;
          ap.settings.airspeed = target * KT;
          ap.update(FRAME, s, c);
          if (s.stickPusher) {
            pushT = t;
            pushPitch = s.pitch;
            pushAlt = s.altitudeMSL;
            c.elevator = 0;
          }
          return false;
        }
        const since = t - pushT;
        minPitch = Math.min(minPitch, s.pitch);
        minAlt = Math.min(minAlt, s.altitudeMSL);
        if (since < 1.5) {
          c.elevator = 0;
          return false;
        }
        if (ap.settings.vertical !== 'pitch') {
          ap.settings = { ...ap.settings, vertical: 'pitch', pitch: 5 * DEG };
          ap.reset();
        }
        c.throttle = 1;
        ap.update(FRAME, s, c);
        return since > 25;
      });
      return { pitchDown: (pushPitch - minPitch) / DEG, lostFt: (pushAlt - minAlt) / FT, pushes, crashed: s.crashed };
    });
    item(ID, 'push at 1 kt/s, flaps 40: the nose falls', () => r().pitchDown, PC12_PUSH.pitchDownDeg, 'deg', FLOWN_MS);
    item(ID, '  height lost to the recovery', () => r().lostFt, PC12_PUSH.heightLossFt, 'ft', FLOWN_MS);
    item(ID, '  pushes (one, no second)', () => r().pushes, { min: 1, max: 1, source: '47E-PROXY 7-21 / plan 5.7: no second push' }, '', FLOWN_MS);
  });

  describe.runIf(flownTier(ID))('landing rolls with the chart technique (flown tier)', () => {
    // 47E-PROXY Fig 5-2-52 / 5-2-54: average braking (brake 0.5), the condition lever to GROUND IDLE at touchdown; the
    // first roll on the gate, the second in full reverse, back to the gate below 40 KIAS.
    const groundIdle: SteerFn = (s, c, heading) => {
      if (s.onGround) c.mixture = PC12_GROUND_IDLE;
      pedalSteer(s, c, heading);
    };
    const la = PC12_TARGETS.landing;
    const roll = (reverse: number) => landingRoll(runwayRig(def, 'maxGross'), {
      approachKt: la.approachKt, flapLever: 1, touchdownPitch: la.touchdownPitchDeg * DEG, brake: la.brake, rollReverse: reverse,
      rollReverseCancel: la.reverseCancel, steer: groundIdle,
    });
    const gate = once(() => roll(0));
    const rev = once(() => roll(la.withReverse!.reverse));
    const strip = <T extends { blockedBy?: string }>(l: T): T => ({ ...l, blockedBy: undefined });
    item(ID, 'landing roll, flaps 40, brakes 0.5, ground idle after touchdown, on the gate', () => gate().roll, strip(la.groundRollM), 'm', FLOWN_MS);
    item(ID, '  in full reverse', () => rev().roll, strip(la.withReverse!.groundRollM), 'm', FLOWN_MS);
    item(ID, '  ratio, full reverse / on the gate', () => rev().roll / gate().roll, strip(la.withReverse!.ratio!), '', FLOWN_MS);
    item(ID, '  no crash', () => (gate().crashed || rev().crashed ? 1 : 0), { min: 0, max: 0, source: 'contract' }, '', FLOWN_MS);
  });

  describe.runIf(flownTier(ID))('idle taxi, steady unbraked speeds over 300 s (flown tier)', () => {
    for (const k of PC12_TAXI) {
      const r = once(() => idleTaxi(makeRig({ def, loading: 'maxGross' }), { reverse: k.reverse, condition: PC12_GROUND_IDLE, seconds: 300 }));
      item(ID, `idle taxi, ${k.label}: steady unbraked ground speed`, () => r().speedKt, k.speedKt, 'kt', FLOWN_MS);
      item(ID, `  settled`, () => (r().steady ? 1 : 0), { min: 1, max: 1, source: 'measure.ts idleTaxi: under 0.05 kt over 5 s' }, '', FLOWN_MS);
    }
  });

  describe.runIf(flownTier(ID))('take-off roll heading with the rudder trim at zero (flown tier)', () => {
    // The take-off ground roll of the targets (flaps 15, PCL full) with the rudder trim at zero, the pilot holding the
    // runway heading on the pedals (a PI law: 5 per rad of error, 2.5 per rad/s of yaw rate, the integral at 2 per
    // rad s): the largest heading error and the largest pedal up to lift-off.
    const r = once(() => {
      let maxErr = 0, maxPedal = 0, integral = 0;
      const steer: SteerFn = (s, c) => {
        const e = wrapPi(RUNWAY_HEADING - s.heading);
        integral = Math.max(-0.5, Math.min(0.5, integral + 2 * e * FRAME));
        c.rudder = Math.max(-1, Math.min(1, 5 * e - 2.5 * s.angularVelocity.z + integral));
        if (s.onGround) {
          maxErr = Math.max(maxErr, Math.abs(e) / DEG);
          maxPedal = Math.max(maxPedal, Math.abs(c.rudder));
        }
      };
      const to = PC12_TARGETS.takeoff;
      const run = takeoffRoll(runwayRig(def, 'maxGross'), { flapLever: to.flapDeg / 40, rotateKias: to.rotateKias, pitch: to.pitchDeg * DEG, staticRunUp: to.staticRunUp, throttle: to.throttle, steer, controls: { rudderTrim: 0 } });
      return { maxErr, maxPedal, crashed: run.crashed };
    });
    item(ID, 'take-off roll, rudder trim 0: largest heading error', () => r().maxErr, PC12_TAKEOFF_HEADING.headingErrorDeg, 'deg', FLOWN_MS);
    item(ID, '  largest pedal', () => r().maxPedal, PC12_TAKEOFF_HEADING.pedal, '', FLOWN_MS);
  });
});
