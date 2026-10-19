// Weather: boundary-layer wind, gusts, MIL-F-8785C turbulence, orographic lift, thermals and cumulonimbus cells.
export { WindField, type WindBreakdown } from './windField';
export { milTurbulenceIntensity, type TurbulenceIntensity } from './turbulence';
export { windSpeedFactor, windVeer, gradientWindFactor, ROUGHNESS_LENGTH, REFERENCE_HEIGHT } from './boundaryLayer';
export { cbSample, cbSeverity, downdraftCentreAt, inStormCore, type CbSample } from './convection';
