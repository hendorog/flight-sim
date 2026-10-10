// PLACEHOLDER carburetted Lycoming carrier. RFM 1-6/2-6 establishes identity, rating and fuel system;
// R22 induction, mixture, thermals, crank inertia and starter coefficients remain uncalibrated estimates.
import type { PowerplantDef } from '../../physics/propulsion/defs';
import { R22_DEFINITION } from '../r22';
import { C172_POWERPLANT } from '../../physics/propulsion/c172Powerplant';
import { S269_FUEL_CAPACITY } from './mass';
import { S269_REFERENCE as V } from './reference';
const base = R22_DEFINITION.powerplant;
export const S269_POWERPLANT: PowerplantDef = {
  ...base,
  engines: [{ ...base.engines[0], engine: { ...base.engines[0].engine,
    name: 'Lycoming HO-360-C1A (placeholder)', ratedPower: V.continuousPower,
    ratedRpm: 2700, calibration: undefined, airStartRpm: 2650, groundStartRpm: 2650,
    // 24 V starter constants are an estimate, inherited from the generic 28 V Lycoming installation.
    starter: { ...C172_POWERPLANT.engines[0].engine.starter },
  } }],
  // RFM Fig 4-2A/4-12: 24 V battery, 28 V charging. Other electrical coefficients are placeholders.
  electrical: { ...C172_POWERPLANT.electrical },
  fuel: { ...base.fuel, tanks: [
    // RFM 6-6/6-10, single-tank example. z is an ESTIMATE.
    { id: 'main', side: 'left', capacity: S269_FUEL_CAPACITY,
      position: { x: -8.5 * 0.0254, y: -17 * 0.0254, z: -0.1 } },
  ], feeds: base.fuel.feeds.map(f => ({ ...f, positions: { on: [0], both: [0] } })) },
};
