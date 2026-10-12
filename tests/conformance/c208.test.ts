// Conformance of the Cessna 208 Caravan 675 (quick tier always; flown tier with FS_AIRCRAFT=c208 or all): the suite's
// blocks on the targets of targets/c208.ts, and the items no generic block measures: the rest attitude and propeller
// clearance, the engine at the take-off power setting (torque, ITT, Ng, Np inside the limits), and the fuel flow
// of the maximum cruise. The keyboard circuit is not flown yet: its pilot sets power by rpm, which a governed
// turboprop does not show.

import { beforeAll, describe } from 'vitest';
import { loadAircraft } from '../../src/aircraft/registry';
import type { AircraftDefinition } from '../../src/aircraft/types';
import { DEG, FT, KT } from '../../src/core/math';
import { at, flatEnvironment, makeRig, resetTo } from '../fdm/helpers';
import { LOW_TERRAIN, cruiseSpeed, restOnGround } from '../fdm/measure';
import { once } from './plan';
import { describeAircraft, flownTier, item } from './suite';
import { C208_CRUISE_FUEL_PPH, C208_REST, C208_TAKEOFF_LIMITS, C208_TARGETS } from './targets/c208';

const ID = 'c208';
const QUICK_MS = 120_000;
const FLOWN_MS = 300_000;
/** lb/h per kg/s. */
const PPH = 3600 / 0.45359237;
/** ft lbf per N m. */
const FT_LB = 1 / 1.3558179;

describeAircraft(C208_TARGETS);

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
});
