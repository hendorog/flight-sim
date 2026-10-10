// PLACEHOLDER composed from existing instrument components, not the RFM Fig 4-2A layout/markings.
// Own face geometry; no Robinson placards, governor or auxiliary fuel gauge. Real tach uses RPM.
import type { InstrumentSystemsDef, PanelDef, RotorTachMarkings } from '../types';
import { R22_ASI_MARKS, R22_INSTRUMENT_SYSTEMS } from '../r22/panel';
import { PANEL_CANVAS, PANEL_OUTLINE } from './dimensions';
import { S269_REFERENCE as V } from './reference';
const tach: RotorTachMarkings = { min: 0, max: 110, majorStep: 10, minorStep: 2,
  engineArcs: [{ from: 2530 / 2700 * 100, to: 100, color: 'green' }],
  rotorArcs: [{ from: 442 / 471 * 100, to: 100, color: 'green' }], rotorRedLines: [390 / 471 * 100, 504 / 471 * 100] };
export const S269_PANEL: PanelDef = {
  id: 's269', size: PANEL_CANVAS, instrumentBezel: 'round',
  gauges: [
    { kind: 'asi', id: 'asi', at: [216, 230], marks: { ...R22_ASI_MARKS, redLine: V.vne,
      arcs: [{ from: 0, to: V.vne, color: 'green' }] } },
    { kind: 'attitude', id: 'attitude', at: [576, 230] },
    { kind: 'altimeter', id: 'altimeter', at: [936, 230] },
    { kind: 'vsi', id: 'vsi', at: [216, 480] },
    { kind: 'rotorTach', id: 'tach', at: [576, 480], marks: tach },
    { kind: 'single', id: 'map', at: [936, 480], seed: 269, title: 'MANIFOLD', units: 'IN HG', size: 'large',
      a0: -2.18, a1: 2.18, labels: [10, 15, 20, 25, 30],
      scale: { label: '', min: 10, max: 35, majors: [10, 15, 20, 25, 30], minorStep: 1, numbers: true, read: r => r.engines[0].manifoldInHg } },
    { kind: 'dualSector', id: 'fuelOil', bounds: { x: 190, y: 720, w: 320, h: 90 },
      left: { label: 'FUEL GAL', min: 0, max: V.mainUsableGal, majors: [0, 16, 32.5], minorStep: 4, numbers: true, read: r => r.fuelGal[0] },
      right: { label: 'OIL PSI', min: 0, max: 120, majors: [0, 55, 95, 115], minorStep: 10, numbers: true, read: r => r.oilPressurePsi } },
    { kind: 'pullKnob', id: 'carbHeat', bounds: { x: 680, y: 710, w: 120, h: 110 }, label: 'CARB HEAT', color: '#ddd7c3',
      read: c => c.carbHeat, set: (c, v) => { c.carbHeat = v; } },
    { kind: 'pullKnob', id: 'mixture', bounds: { x: 870, y: 710, w: 120, h: 110 }, label: 'MIXTURE', color: '#c8261b',
      read: c => 1 - c.mixture, set: (c, v) => { c.mixture = 1 - v; } },
    { kind: 'navcom', id: 'navcom1', bounds: { x: 416, y: 1080, w: 320, h: 76 } },
  ],
  switchRow: { bounds: { x: 180, y: 870, w: 790, h: 110 }, rockerTop: 38, rockerW: 30, rockerH: 36, legends: [], switches: [
    { id: 'battery', label: 'BAT', name: 'Battery', x: 55, on: c => c.masterBattery, toggle: c => { c.masterBattery = !c.masterBattery; } },
    { id: 'alternator', label: 'ALT', name: 'Alternator', x: 155, on: c => c.alternator, toggle: c => { c.alternator = !c.alternator; } },
    { id: 'avionics', label: 'AVIONICS', name: 'Avionics', x: 275, on: c => c.avionics, toggle: c => { c.avionics = !c.avionics; } },
    { id: 'rotorClutch', label: 'CLUTCH*', name: 'Clutch placeholder', x: 425, on: c => !!c.rotorClutch, toggle: c => { c.rotorClutch = !c.rotorClutch; } },
  ] },
  ignition: { kind: 'key', at: [870, 915] },
  background: { color: '#303534', outline: PANEL_OUTLINE, seamsX: [], bushings: [], placards: [
    { lines: ['300CB — DEVELOPMENT PLACEHOLDER'], x: 576, y: 50, size: 23 },
    { lines: ['TACH %: 100 = 2700 ENGINE / 471 ROTOR RPM'], x: 576, y: 630, size: 17 },
    { lines: ['ARTICULATED DYNAMICS UNFINISHED'], x: 576, y: 1195, size: 15 },
    { lines: ['*CLUTCH HOLD NOT MODELLED'], x: 576, y: 1230, size: 15 },
  ] },
  apertures: { large: 94, small: 66 }, keepOut: [], regions: { sixpack: { x: 90, y: 105, w: 972, h: 500 },
    engine: { x: 150, y: 670, w: 870, h: 165 }, stack: { x: 400, y: 1060, w: 352, h: 110 } },
  spots: { asi: { x: 216, y: 230, r: 90 }, tach: { x: 576, y: 480, r: 90 }, alt: { x: 936, y: 230, r: 90 },
    vsi: { x: 216, y: 480, r: 90 }, attitude: { x: 576, y: 230, r: 90 } },
};
export const S269_INSTRUMENT_SYSTEMS: InstrumentSystemsDef = {
  ...R22_INSTRUMENT_SYSTEMS, busDeadVolts: 18, tachHourRpm: V.engineRpm100,
  fuel: { kgPerGal: V.kgPerGal, tanks: [s => s.fuel.left] },
  rotorTach: { engineRpm100: V.engineRpm100, rotorRpm100: V.rotorRpm100,
    powered: i => i.state.electrical.busVoltage > 18 },
  lamps: [],
};
