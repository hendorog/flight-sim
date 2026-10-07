// Public API of the instruments module.

export { InstrumentPanel, PANEL_DIAL_LIGHT, PANEL_HEIGHT, PANEL_LAYOUT, PANEL_WIDTH, type InstrumentPanelOptions, type PanelRegion } from './panel';
export { InstrumentSet, type EngineReadings, type GearReadings, type InstrumentReadings, type InstrumentSetOptions } from './dynamics/instrumentSet';
export { AirspeedIndicator, Altimeter, VerticalSpeedIndicator, pressureAltitudeFt, STD_PRESSURE_HPA } from './dynamics/pitotStatic';
export { AttitudeIndicator, HeadingIndicator, TurnCoordinator } from './dynamics/gyroInstruments';
export { GyroRotor, vacuumSuction, SUCTION_RATED_INHG, SUCTION_REGULATED_INHG } from './dynamics/gyro';
export {
  Tachometer,
  ElectricNeedle,
  electricalLoadAmps,
  batteryCurrentAmps,
  evaluateAnnunciators,
  KG_PER_GAL,
  BUS_DEAD_VOLTS,
  type Annunciators,
  type AnnunciatorInputs,
} from './dynamics/engineSystems';
export { ils07, gpsToAirport, type IlsSignal, type GpsData } from './dynamics/navigation';
export { lagStep, SecondOrder } from './dynamics/filters';
export { DEFAULT_TUNING, type RadioTuning } from './render/avionics';
export type { Rect } from './render/component';
export {
  PANEL_HOTSPOTS,
  buildHotspots,
  hotspotAt,
  hotspotValue,
  pressHotspot,
  toggleHotspot,
  turnHotspot,
  type HotspotId,
  type HotspotKind,
  type PanelHotspot,
} from './hotspots';
export { panelLayoutProblems } from './panelLayout';
export { panelParts, type PanelPart } from './panelParts';
