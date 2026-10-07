// The Cessna 172S flight model: the blade-element flight model (flightModel.ts) built from the C172S definition
// (aircraft/c172s), with the single-engine powerplant facade as `propulsion`, and the C172S numbers under the
// names this module has always exported.

import { C172S_DEFINITION } from '../aircraft/c172s/index';
import type { Vec3 } from '../core/math';
import { BladeElementFlightModel } from './flightModel';
import type { FlightModelOptions } from './interfaces';
import type { PropulsionSystem } from './propulsion';

export { DEFAULT_PHYSICS_RATE } from './flightModel';
/** Payload that makes a full-fuel C172S exactly maximum take-off weight, kg. */
export { MAX_GROSS_PAYLOAD } from './massModel';

/**
 * Default loading: the two front-seat occupants of core/c172.ts plus 40 kg of bags and jackets on the rear
 * seat and in the baggage area (aircraft/c172s/systems.ts, the 'typical' loading).
 */
export const DEFAULT_PAYLOAD: number = C172S_DEFINITION.mass.loadings.typical.payload;
export const DEFAULT_PAYLOAD_POSITION: Vec3 = C172S_DEFINITION.mass.loadings.typical.payloadPosition;

/** Options of the C172S flight model (FlightModelOptions; the payload defaults to DEFAULT_PAYLOAD at DEFAULT_PAYLOAD_POSITION). */
export type C172Options = FlightModelOptions;

// Normal category limits (POH): +3.8 / -1.52 g flaps up; ultimate = 1.5 x limit.
export const LIMIT_LOAD_POSITIVE = C172S_DEFINITION.limits.loadFactorPositive;
export const LIMIT_LOAD_NEGATIVE = C172S_DEFINITION.limits.loadFactorNegative;
export const ULTIMATE_FACTOR = C172S_DEFINITION.limits.ultimateFactor;
/** Design dive speed: 14 CFR 23 sets Vne <= 0.9 Vd. Structural failure (flutter, overload) beyond it, m/s. */
export const DIVE_SPEED = C172S_DEFINITION.limits.diveSpeedCas;
/** Response time of the wing structure to a load (first bending mode ~6-8 Hz), s. */
export const STRUCTURE_TIME = C172S_DEFINITION.limits.structureTime;
/** Rotor speed used for an in-flight start before the powerplant settles, and on the ground, rpm. */
export const AIR_START_RPM = C172S_DEFINITION.powerplant.engines[0].engine.airStartRpm;
export const GROUND_START_RPM = C172S_DEFINITION.powerplant.engines[0].engine.groundStartRpm;

export class C172FlightModel extends BladeElementFlightModel {
  /** The single-engine facade (engine, propeller, thermal, omega, rpm, fuelLeft / fuelRight, the two-tank reset). */
  declare readonly propulsion: PropulsionSystem;

  constructor(options: C172Options = {}) {
    super(C172S_DEFINITION, options);
  }
}
