// Public surface of the physics package.

import type { AircraftDefinition } from '../aircraft/types';
import { C172FlightModel, type C172Options } from './c172FlightModel';
import { BladeElementFlightModel } from './flightModel';
import type { FlightModelOptions } from './interfaces';

export { C172FlightModel, DEFAULT_PAYLOAD, DEFAULT_PAYLOAD_POSITION, DEFAULT_PHYSICS_RATE, MAX_GROSS_PAYLOAD, type C172Options } from './c172FlightModel';
export { BladeElementFlightModel, engineStopControls, type EngineStopMode } from './flightModel';
export { Autopilot, defaultAutopilotSettings, type AutopilotSettings, type LateralMode, type VerticalMode } from './autopilot';
export { trimFlight, trimAttitude, solveNewton, type TrimSpec, type TrimResult, type TrimPlant, type TrimCondition } from './trim';
export { createEnvironment, type SimEnvironment, type TerrainProvider, type EnvironmentOptions } from './environment';
export { atmosphereAt, casFromTas, tasFromCas, pressureAltitude } from './atmosphere';
export { createAirData, indicatedAirspeed, type AirData } from './airData';
export { createMassModel, massProperties, type Loading, type MassLoading, type MassModel, type MassProperties } from './massModel';
export { ControlLaw, ControlSystem, pitchControlsFor, surfaceTargets } from './controlSystem';

/** The simulator's flight model: a Cessna 172S. Call reset() before the first step(). */
export function createFlightModel(options?: C172Options): C172FlightModel {
  return new C172FlightModel(options);
}

/** The flight model of any type, built from its definition. Call reset() before the first step(). */
export function createFlightModelFor(def: AircraftDefinition, options?: FlightModelOptions): BladeElementFlightModel {
  return new BladeElementFlightModel(def, options);
}
