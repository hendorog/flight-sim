// Public surface of the aerodynamics module.

export { AeroModel, type AeroModelOptions, type StripDiagnostics } from './aeroModel';
export { createC172AeroDefinition, type AircraftAeroDefinition } from './c172Aero';
export type { Strip, SurfaceId } from './strips';
