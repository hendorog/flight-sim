// PLACEHOLDER eight-hole panel. Locations share dimensions.ts; the panel agent will replace this layout.
// POH 2-7/2-8 markings and 7-21 layout are the references, not inherited R22 instrument limits.
import { DEG } from '../../core/math';
import type { GaugeDef, InstrumentSystemsDef, LampInputs, PanelDef, ScaleDef } from '../../instruments/panelDef';
import { PANEL_CANVAS, PANEL_OUTLINE, PANEL_PX_PER_M } from './dimensions';
import { R44_REFERENCE as V } from './reference';
const scale = (label: string, min: number, max: number, read: ScaleDef['read']): ScaleDef =>
  ({ label, min, max, majors: [min, (min + max) / 2, max], minorStep: (max - min) / 10, read, numbers: true });
const columns = [230, 460, 690, 920], rows = [240, 470];
const SCALE = { large: 3.125 * 0.0254 * PANEL_PX_PER_M / 172, small: 2.25 * 0.0254 * PANEL_PX_PER_M / 120 };
const holes: GaugeDef[] = [
  { kind: 'vsi', id: 'vsi', at: [columns[0], rows[0]] },
  { kind: 'blank', id: 'optional1', at: [columns[1], rows[0]] },
  { kind: 'asi', id: 'asi', at: [columns[2], rows[0]], marks: {
    scaleKt: [0, 20, 40, 60, 80, 100, 120, 140], scaleDeg: [0, 30, 75, 120, 165, 215, 270, 320],
    tickFrom: 0, tickTo: 140, minorStep: 5, numberStep: 20,
    arcs: [{ from: 0, to: 110, color: 'green' }, { from: 110, to: 130, color: 'yellow' }], redLine: V.vne,
  } },
  { kind: 'rotorTach', id: 'tach', at: [columns[3], rows[0]], marks: {
    min: 40, max: 110, majorStep: 10, minorStep: 2,
    engineArcs: [{ from: 101, to: 102, color: 'green' }],
    rotorArcs: [{ from: 90, to: 108, color: 'green' }], rotorRedLines: [90, 108],
  } },
  { kind: 'blank', id: 'optional2', at: [columns[0], rows[1]] },
  { kind: 'blank', id: 'optional3', at: [columns[1], rows[1]] },
  { kind: 'altimeter', id: 'altimeter', at: [columns[2], rows[1]] },
  { kind: 'single', id: 'map', at: [columns[3], rows[1]], seed: 344, title: 'MANIFOLD', units: 'IN HG', size: 'large',
    a0: -125 * DEG, a1: 125 * DEG, labels: [10, 15, 20, 25, 30], scale: {
      ...scale('', 10, 30, r => r.engines[0].manifoldInHg), majors: [10, 15, 20, 25, 30], minorStep: 1,
      arcs: [{ from: 15, to: 23.3, color: 'green' }, { from: 19.1, to: 26.1, color: 'yellow' }], redLines: [26.1],
    } },
];
const lampIds = ['clutch', 'lowRpm', 'govOff', 'alt', 'oil', 'lowFuel', 'starter'] as const;
export const R44_PANEL: PanelDef = {
  id: 'r44', size: PANEL_CANVAS, instrumentScale: SCALE, apertures: { large: 74 * SCALE.large, small: 51 * SCALE.small },
  gauges: [...holes,
    { kind: 'clock', id: 'clock', at: [230, 655] },
    { kind: 'dualSector', id: 'fuel', bounds: { x: 350, y: 790, w: 450, h: 90 },
      left: scale('MAIN GAL', 0, V.mainUsableGal, r => r.fuelGal[0]), right: scale('AUX GAL', 0, V.auxUsableGal, r => r.fuelGal[1]) },
    { kind: 'dualSector', id: 'oil', bounds: { x: 350, y: 900, w: 450, h: 90 },
      left: scale('OIL PSI', 0, 120, r => r.oilPressurePsi), right: scale('OIL °F', 50, 250, r => r.oilTempF) },
    { kind: 'dualSector', id: 'engine', bounds: { x: 350, y: 1010, w: 450, h: 90 },
      left: scale('AMPS', -60, 60, r => r.ammeterAmps), right: scale('CHT °F', 0, 550, r => r.engines[0].chtF) },
    { kind: 'navcom', id: 'navcom1', bounds: { x: 386, y: 1380, w: 380, h: 90 } },
    { kind: 'xpdr', id: 'xpdr', bounds: { x: 386, y: 1490, w: 380, h: 75 } },
    { kind: 'pullKnob', id: 'mixture', bounds: { x: 650, y: 1660, w: 120, h: 120 }, label: 'MIXTURE', color: '#c8261b',
      read: c => 1 - c.mixture, set: (c, v) => { c.mixture = 1 - v; },
      guard: { closed: c => !(c.mixtureGuardOpen ?? false), toggle: c => { c.mixtureGuardOpen = !c.mixtureGuardOpen; } } },
    { kind: 'pushButton', id: 'lampTest', bounds: { x: 405, y: 1670, w: 100, h: 85 }, label: 'LIGHT TEST',
      read: c => c.annunciatorTest ?? false, press: (down, c) => { c.annunciatorTest = down; } },
  ],
  annunciator: { bounds: { x: 175, y: 45, w: 805, h: 55 },
    lamps: lampIds.map(id => ({ id, text: id.toUpperCase(), color: '#ffba35', lit: r => r.lamps[id] ?? false })),
    cells: lampIds.map((_, i) => ({ x: 175 + i * 115, y: 45, w: 113, h: 55 })) },
  switchRow: { bounds: { x: 330, y: 1190, w: 490, h: 160 }, rockerTop: 35, rockerW: 30, rockerH: 45,
    switches: [
      { id: 'battery', label: 'BAT', name: 'Battery', x: 60, on: c => c.masterBattery, toggle: c => { c.masterBattery = !c.masterBattery; } },
      { id: 'alternator', label: 'ALT', name: 'Alternator', x: 145, on: c => c.alternator, toggle: c => { c.alternator = !c.alternator; } },
      { id: 'avionics', label: 'AVIONICS', name: 'Avionics', x: 230, on: c => c.avionics, toggle: c => { c.avionics = !c.avionics; } },
      { id: 'rotorClutch', label: 'CLUTCH', name: 'Clutch', x: 315, on: c => c.rotorClutch ?? false, toggle: c => { c.rotorClutch = !c.rotorClutch; }, red: true },
      { id: 'rotorGovernor', label: 'GOV', name: 'Governor', x: 400, on: c => c.rotorGovernor ?? false, toggle: c => { c.rotorGovernor = !c.rotorGovernor; } },
    ], legends: [], dimmers: { panel: 85, radio: 160, y: 130 } },
  ignition: { kind: 'key', at: [990, 650] },
  background: { color: '#25272a', outline: PANEL_OUTLINE, seamsX: [], bushings: [],
    rack: { rails: { x: 376, y: 1370, w: 400, h: 205 }, blanks: [] },
    placards: [{ x: 576, y: 1130, size: 17, lines: ['R44 RAVEN II', 'DEVELOPMENT PLACEHOLDER'] },
      { x: 576, y: 1590, size: 10, lines: ['NR POWER ON 101–102%', 'POWER OFF 90–108%', 'LAYOUT AND SYSTEMS UNFINISHED'] }] },
  keepOut: [], regions: { sixpack: { x: 125, y: 130, w: 900, h: 460 }, engine: { x: 350, y: 790, w: 450, h: 320 },
    stack: { x: 376, y: 1370, w: 400, h: 205 } },
  spots: { asi: { x: 690, y: 240, r: 100 }, tach: { x: 920, y: 240, r: 100 }, alt: { x: 690, y: 470, r: 100 } },
};
const powered = (i: LampInputs): boolean => i.state.electrical.busVoltage > 18;
export const R44_INSTRUMENT_SYSTEMS: InstrumentSystemsDef = {
  engines: 1, vacuum: null, gyroDrive: { attitude: 'electric', heading: 'electric' },
  fuel: { kgPerGal: V.kgPerGal, tanks: [s => s.fuel.left, s => s.fuel.right] },
  busDeadVolts: 18, tachHourRpm: V.engineRpm100,
  rotorTach: { engineRpm100: V.engineRpm100, rotorRpm100: V.rotorRpm100,
    powered: i => powered(i) || (!!i.controls.rotorClutch && i.state.electrical.batteryCharge > 0) },
  lamps: [
    { id: 'clutch', lit: (i: LampInputs) => i.state.rotorcraft?.clutchLight ?? false },
    { id: 'lowRpm', lit: (i: LampInputs) => i.state.rotorcraft?.lowRpmHorn ?? false },
    { id: 'govOff', lit: (i: LampInputs) => !(i.controls.rotorGovernor ?? false) },
    { id: 'alt', lit: (i: LampInputs) => i.state.electrical.busVoltage < 24.5 },
    { id: 'oil', lit: (i: LampInputs) => i.state.engine.oilPressure < 25 },
    { id: 'lowFuel', lit: (i: LampInputs) => i.fuelGal[0] <= 3 }, // POH 3-9, approximately 3 gal.
    { id: 'starter', lit: (i: LampInputs) => i.controls.starter },
  ].map(l => ({ id: l.id, lit: (i: LampInputs) => powered(i) && ((i.controls.annunciatorTest ?? false) || l.lit(i)) })),
};
