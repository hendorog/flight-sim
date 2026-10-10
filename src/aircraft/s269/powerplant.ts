// Carburetted HO-360-C1A, selected S/N 0106–0138. No injection, governor or STAR kit.
import { LB } from '../../core/math';
import type { EngineDef, PowerplantDef } from '../../physics/propulsion/defs';
import { R22_DEFINITION } from '../r22';
import { C172_POWERPLANT } from '../../physics/propulsion/c172Powerplant';
import { S269_FUEL_CAPACITY } from './mass';
import { S269_REFERENCE as V } from './reference';
const base = R22_DEFINITION.powerplant;
export const S269_ENGINE: EngineDef = {
  ...base.engines[0].engine, name: 'Lycoming HO-360-C1A',
  // Lycoming 60297-12 §2-2: 361 in³, 8.5:1, four cylinders, 180 hp at 2700 RPM.
  // RFM 2-6: same rating for takeoff and continuous operation. Generic engine calibrates WOT
  // at SL/15°C/full rich, not the Robinson part-throttle derating carried by the scaffold.
  cylinders: 4, displacement: 361 * 0.000016387064, compressionRatio: 8.5,
  ratedPower: V.continuousPower, ratedRpm: 2700, calibration: undefined,
  airStartRpm: 2650, groundStartRpm: 2650,
  // ESTIMATES: crank/fan inertia, starter, induction, mixture enrichment and thermal paths.
  rotatingInertia: 0.55,
  // Lycoming 60297-12 Fig 3-39, printed 3-53: ~14.8 US gal/h minimum at 100% of
  // 180 hp (HO-360-C1A explicitly listed). Use that boundary as the full-rich rating
  // anchor, not as a measured carburettor flow curve. Generic altitude enrichment is estimated.
  metering: { kind: 'floatCarburettor', fullRichPhi: undefined,
    takeoffFuelFlow: 14.8 * 6 * LB / 3600, leanestFraction: 0.35 },
  starter: { ...C172_POWERPLANT.engines[0].engine.starter },
};
export const S269_POWERPLANT: PowerplantDef = {
  ...base, engines: [{ ...base.engines[0], engine: S269_ENGINE }],
  // RFM Fig 4-2A/4-12: 24 V battery, 28 V charging. Capacity and electrical loads estimated.
  electrical: { ...C172_POWERPLANT.electrical },
  fuel: { ...base.fuel, tanks: [
    // RFM 6-6/6-10, single-tank example. z is an ESTIMATE.
    { id: 'main', side: 'left', capacity: S269_FUEL_CAPACITY,
      position: { x: -8.5 * 0.0254, y: -17 * 0.0254, z: -0.1 } },
  ], feeds: base.fuel.feeds.map(f => ({ ...f, positions: { on: [0], both: [0] } })) },
};
