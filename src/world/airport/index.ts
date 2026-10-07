// Public entry point of the airport module.
export { AirportSystem, nightFromDayFactor, type AirportSystemOptions } from './AirportSystem';
/** Pavement surface heights above AIRPORT.elevation (m): add to groundElevation on pavement if wheels should sit on it. */
export { RUNWAY_HEIGHT, TAXIWAY_HEIGHT } from './pavement';
export * from './layout';
export { injectFloodlight, type SharedUniforms } from './shared';
export { estimateExposure } from './AirportSystem';
