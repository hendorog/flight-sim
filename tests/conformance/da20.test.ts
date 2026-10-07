// Conformance of the Diamond DA20-C1 (quick tier always; flown tier with FS_AIRCRAFT=da20 or all): the suite's blocks
// on the targets of contract 5.3 (targets/da20.ts), the keyboard circuit and taxi (castering nosewheel), and the 5.3
// items no generic block measures: the stall with flaps T/O, the fuel flow of the 74 % cruise leaned, the CG travel
// as the fuselage tank empties, the pedals that do not steer on the ground, the differential-brake turn at walking
// pace, and the propeller's ground clearance.

import { beforeAll, describe } from 'vitest';
import { loadAircraft } from '../../src/aircraft/registry';
import type { AircraftDefinition } from '../../src/aircraft/types';
import { DEG, KT } from '../../src/core/math';
import { createMassModel } from '../../src/physics/massModel';
import { at, flatEnvironment, makeRig, resetTo } from '../fdm/helpers';
import { LOW_TERRAIN, RUNWAY_HEADING, brakePower, cruiseSpeed, flapLever, restOnGround, stallRun } from '../fdm/measure';
import { keyboardCircuit, keyboardTaxi } from './keyboard';
import { once } from './plan';
import { describeAircraft, flownTier, item } from './suite';
import { DA20_CG_TRAVEL_CM, DA20_CRUISE_FUEL, DA20_CRUISE_FUEL_ALT, DA20_PEDAL_TAXI, DA20_REST, DA20_TAKEOFF_FLAP_STALL, DA20_TARGETS } from './targets/da20';

const ID = 'da20';
const QUICK_MS = 120_000;
const FLOWN_MS = 300_000;
/** kg/s per US gal/h of 100LL. */
const GPH = (3.785411784e-3 * 719) / 3600;

describeAircraft(DA20_TARGETS);
// The circuit pilot flies with the DA20's tachometer settings (targets/da20.ts KEYBOARD_PILOT_TARGETS).
keyboardCircuit({ aircraft: ID });
keyboardTaxi({ aircraft: ID });

/**
 * Ground run at `kt` with the rudder held at `rudder` and `brake` of right toe brake: with `idle`, the throttle closed
 * and the speed held with both toe brakes alike; otherwise with the throttle alone. The yaw rate and the turn radius
 * once steady.
 */
function groundRun(def: AircraftDefinition, o: { kt: number; rudder: number; brake: number; idle: boolean }): { yawRateDegS: number; radius: number } {
  const rig = makeRig({ def, loading: 'maxGross', env: flatEnvironment() });
  resetTo(rig, { onGround: true, heading: RUNWAY_HEADING });
  const s = rig.fm.state, c = rig.controls;
  c.parkingBrake = false;
  const hold = () => {
    const e = o.kt * KT - s.groundSpeed;
    if (o.idle) {
      c.throttle = 0;
      c.brakeLeft = c.brakeRight = Math.max(0, Math.min(1, -1.5 * e));
    } else c.throttle = Math.max(0, Math.min(1, 0.1 + 0.1 * e));
  };
  // Up to speed straight ahead (the castering nosewheel trails), then the pedals and the brake.
  rig.run(15, hold);
  c.rudder = o.rudder;
  rig.run(12, () => {
    hold();
    if (o.brake) c.brakeRight = o.brake;
  });
  let r = 0, n = 0;
  rig.run(4, () => {
    hold();
    if (o.brake) c.brakeRight = o.brake;
    r += s.angularVelocity.z;
    n++;
  });
  const rate = r / n;
  return { yawRateDegS: rate / DEG, radius: s.groundSpeed / Math.abs(rate) };
}

describe(`conformance ${ID}: items of contract 5.3 outside the generic blocks`, () => {
  let def!: AircraftDefinition;
  beforeAll(async () => {
    def = await loadAircraft(ID);
  });

  describe('the centre of gravity as the fuselage tank empties', () => {
    // Maximum-weight loading (two 100 kg occupants), full and empty tank: the tank lies 0.53 m behind the CG.
    const r = once(() => {
      const model = createMassModel(def.mass, def.powerplant.fuel.tanks);
      const l = def.mass.loadings.maxGross;
      const full = model.properties({ payload: l.payload, payloadPosition: l.payloadPosition, tanks: [def.powerplant.fuel.tanks[0].capacity] });
      const empty = model.properties({ payload: l.payload, payloadPosition: l.payloadPosition, tanks: [0] });
      return { travel: (empty.cgOffset.x - full.cgOffset.x) * 100 };
    });
    item(ID, 'CG travel forward, full to empty tank', () => r().travel, DA20_CG_TRAVEL_CM, 'cm', QUICK_MS);
  });

  describe('propeller clearance at rest', () => {
    const r = once(() => {
      const rest = restOnGround(makeRig({ def, loading: 'maxGross' }));
      // The lowest point of the propeller disc (the disc stands in the body y-z plane), above the ground.
      const p = def.geometry.propellers[0];
      const pitch = rest.pitchDeg * DEG;
      const tip = -p.hub.x * Math.sin(pitch) + (p.hub.z + p.diameter / 2) * Math.cos(pitch);
      return rest.height - tip;
    });
    item(ID, 'propeller ground clearance at rest', () => r(), DA20_REST.propClearanceM, 'm', QUICK_MS);
  });

  describe('the castering nosewheel on the ground', () => {
    // At 5 kt at idle (the speed held with both toe brakes alike), the pedals below half travel (the keyboard's rudder
    // keys add no toe brake there): the nosewheel is not linked to them. Judged is what the pedals change: the yaw
    // rate with the pedal held against the yaw rate with the feet off.
    const pedals = once(() => {
      const held = groundRun(def, { kt: DA20_PEDAL_TAXI.kt, rudder: DA20_PEDAL_TAXI.rudder, brake: 0, idle: true });
      const off = groundRun(def, { kt: DA20_PEDAL_TAXI.kt, rudder: 0, brake: 0, idle: true });
      return held.yawRateDegS - off.yawRateDegS;
    });
    item(ID, `taxi at idle, ${DA20_PEDAL_TAXI.kt} kt: yaw rate the right pedal ${DA20_PEDAL_TAXI.rudder} adds`, () => pedals(), DA20_PEDAL_TAXI.yawRateDegS, 'deg/s', QUICK_MS);
    // At walking pace (3 kt) with full right pedal and full right brake the aircraft pivots near the braked wheel
    // (the generic block measures the same at 10 kt, where the mains' side force limits the turn).
    const pivot = once(() => groundRun(def, { kt: 3, rudder: 1, brake: 1, idle: false }));
    item(ID, 'differential-brake turn at 3 kt, full right brake: radius', () => pivot().radius, { min: 0, max: 6, source: 'contract 5.3: turns within the wing span (radius under 6 m)' }, 'm', QUICK_MS);
  });

  describe.runIf(flownTier(ID))('stall with flaps T/O (flown tier)', () => {
    const s = DA20_TAKEOFF_FLAP_STALL;
    const r = once(() => stallRun(makeRig({ def, loading: 'forward', env: flatEnvironment() }), { flapLever: flapLever(def, s.flapDeg), entryKt: s.entryKt }));
    item(ID, `stall speed flaps T/O (flaps ${s.flapDeg}), forward CG (V_S1g)`, () => r().vs1g, s.vs1gKcas, 'KCAS', FLOWN_MS);
  });

  describe.runIf(flownTier(ID))('fuel flow in the 74 % cruise, leaned (flown tier)', () => {
    // AFM table 3: 2000 ft, 2700 rpm, 74 %, leaned to 25 F rich of peak EGT. The cruise point of 74 % found with the
    // mixture leaned for best power, flown for 5 s at its throttle.
    const r = once(() => {
      const f = DA20_CRUISE_FUEL;
      const rig = makeRig({ def, loading: 'maxGross', env: flatEnvironment(undefined, LOW_TERRAIN) });
      const cruise = cruiseSpeed(rig, { altitude: DA20_CRUISE_FUEL_ALT, powerFraction: f.powerFraction, bracketKt: f.bracketKt, leanAtKt: f.leanAtKt, resetKt: f.resetKt });
      const trim = rig.fm.solveTrim({ tas: cruise.ktas * KT, altitude: DA20_CRUISE_FUEL_ALT }, rig.env, { mixture: cruise.mixture });
      resetTo(rig, { position: at(DA20_CRUISE_FUEL_ALT), airspeed: cruise.ktas * KT });
      rig.controls.mixture = cruise.mixture;
      rig.controls.throttle = trim.throttle;
      rig.run(5);
      return { gph: rig.fm.state.engines[0].fuelFlow / GPH, power: brakePower(rig.fm) / def.powerplant.engines[0].engine.ratedPower, rpm: rig.fm.state.engines[0].rpm };
    });
    item(ID, 'fuel flow at 74 % power, 2000 ft, leaned', () => r().gph, DA20_CRUISE_FUEL.gph, 'gal/h', FLOWN_MS);
    item(ID, '  power fraction while it is measured', () => r().power, { min: 0.72, max: 0.76, source: 'the cruise point held' }, '', FLOWN_MS);
    item(ID, '  rpm while it is measured', () => r().rpm, { min: 2600, max: 2800, source: 'AFM table 3: 2700 rpm (s.8)' }, 'rpm', FLOWN_MS);
  });
});
