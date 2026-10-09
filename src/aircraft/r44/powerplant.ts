// PLACEHOLDER IO-540 installation. Published rating/displacement/cylinder count and RSA injection;
// thermals, induction, pump pressures, clutch-switched boost pump and start transients need validation.
import { C172_POWERPLANT } from '../../physics/propulsion/c172Powerplant';
import { C152_POWERPLANT } from '../c152/powerplant';
import { R22_DEFINITION } from '../r22';
import type { PowerplantDef } from '../types';
import { R44_REFERENCE as V } from './reference';
import { R44_FUEL_CAPACITY } from './mass';
const base = R22_DEFINITION.powerplant.engines[0];
export const R44_POWERPLANT: PowerplantDef = {
  ...C172_POWERPLANT,
  engines: [{ ...base, engine: { ...base.engine, name: 'Lycoming IO-540-AE1A5 (placeholder)',
    cylinders: 6, displacement: 541.5 * 0.000016387064, ratedPower: V.takeoffPower, ratedRpm: 2718,
    calibration: { power: V.continuousPower, rpm: 2718, manifoldPressure: 22.75 * 3386.389 },
    airStartRpm: V.engineRpm100 * 1.015, groundStartRpm: V.engineRpm100 * 1.015,
    rotatingInertia: 0.8,
    induction: { ...base.engine.induction, carburettor: undefined, inletArea: 0.0023,
      throttleBoreArea: Math.PI * 0.038 ** 2, idleArea: 0.000028 },
    metering: { kind: 'rsaInjection', fullRichPhi: 1.15, leanestFraction: 0.35 } } }],
  fuel: { ...C172_POWERPLANT.fuel, tanks: [
    { id: 'main', side: 'left', capacity: R44_FUEL_CAPACITY[0], position: { x: -6 * 0.0254, y: -13.5 * 0.0254, z: -0.1 } },
    { id: 'aux', side: 'right', capacity: R44_FUEL_CAPACITY[1], position: { x: -2 * 0.0254, y: 13 * 0.0254, z: -0.1 } },
  ], feeds: [{ ...C172_POWERPLANT.fuel.feeds[0], positions: { on: [0, 1], both: [0, 1] } }] },
  // POH 7-13: 28 V. Battery/load/regulator details still inherited estimates.
  electrical: { ...C152_POWERPLANT.electrical,
    loads: { ...C152_POWERPLANT.electrical.loads, fuelPump: 3 } },
};
