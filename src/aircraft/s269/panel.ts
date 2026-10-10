// Carburetted 300CB S/N 0106–0138, right PIC, no STAR. RFM CSP-C1-1 Fig 4-2A, p4-10.1.
// Optional VSI and COM/transponder occupy the figure's vacant area. Frozen PANEL_* face unchanged.
// Renderer gaps: two absolute tach dials replace the coaxial instrument; clutch is a two-position
// stand-in and spring trim an inactive location marker. See docs/s269-panel.md for integration requests.
import { DEG } from '../../core/math';
import type { InstrumentSystemsDef, LampDef, LampInputs, PanelDef, ScaleDef, SwitchDef } from '../types';
import { PANEL_CANVAS, PANEL_OUTLINE, PANEL_PX_PER_M } from './dimensions';
import { S269_REFERENCE as V } from './reference';
import { S269_ASI_MARKS, S269_ENGINE_RPM, S269_ROTOR_RPM, S269_ENGINE_SCALES as E, S269_MAP_SCALE } from './panelMarkings';
import { S269_VNE_PLACARDS } from './panelPlacards';

const SCALE = { large: 3.125 * 0.0254 * PANEL_PX_PER_M / 172, small: 2.25 * 0.0254 * PANEL_PX_PER_M / 120 };
const AMBER = '#ffba35', RED = '#ff4538';
export const S269_ANNUNCIATOR_LAMPS: readonly LampDef[] = [
  ['lowVolts', 'LOW VOLTAGE', AMBER], ['lowFuel', 'FUEL LOW', AMBER],
  ['mrTransmission', 'M/R XMSN TEMP/PRESS', RED], ['trChip', 'T/R XMSN CHIPS', AMBER],
  ['clutchDisengaged', 'CLUTCH DISENGAGED', RED],
].map(([id, text, color]) => ({ id, text, color, lit: r => r.lamps[id] ?? false }));
const switchDef = (id: string, label: string, x: number, on: SwitchDef['on'], toggle: SwitchDef['toggle']): SwitchDef =>
  ({ id, label, name: label, x, on, toggle });
// Fallback reads RPM ×100, never percent. panelTach.ts needs a generic factory hook to replace these dials.
const hundreds = (s: ScaleDef): ScaleDef => ({ ...s, min: s.min / 100, max: s.max / 100,
  majors: s.majors.map(v => v / 100), minorStep: s.minorStep / 100,
  arcs: s.arcs?.map(a => ({ ...a, from: a.from / 100, to: a.to / 100 })),
  redLines: s.redLines?.map(v => v / 100), read: r => s.read(r) / 100 });

export const S269_PANEL: PanelDef = {
  id: 's269', size: PANEL_CANVAS, instrumentScale: SCALE, instrumentBezel: 'round', lightingDimmerExponent: 2.2,
  apertures: { large: 74 * SCALE.large, small: 51 * SCALE.small },
  gauges: [
    { kind: 'single', id: 'map', at: [180, 255], seed: 269, title: 'MANIFOLD', units: 'IN HG', size: 'large',
      a0: -125 * DEG, a1: 125 * DEG, labels: S269_MAP_SCALE.majors, scale: S269_MAP_SCALE },
    { kind: 'asi', id: 'asi', at: [440, 255], marks: S269_ASI_MARKS },
    { kind: 'vsi', id: 'vsi', at: [700, 255] },
    { kind: 'altimeter', id: 'altimeter', at: [960, 255] },
    { kind: 'single', id: 'tach', at: [180, 495], seed: 270, title: 'ENGINE', units: 'RPM ×100', size: 'large',
      a0: -125 * DEG, a1: 125 * DEG, labels: hundreds(S269_ENGINE_RPM).majors, scale: hundreds(S269_ENGINE_RPM) },
    { kind: 'single', id: 'rotorTach', at: [440, 495], seed: 271, title: 'ROTOR', units: 'RPM ×100', size: 'large',
      a0: -125 * DEG, a1: 125 * DEG, labels: hundreds(S269_ROTOR_RPM).majors, scale: hundreds(S269_ROTOR_RPM) },
    { kind: 'navcom', id: 'navcom1', bounds: { x: 708, y: 444, w: 320, h: 76 } },
    { kind: 'xpdr', id: 'xpdr', bounds: { x: 708, y: 532, w: 320, h: 60 } },
    { kind: 'dualSector', id: 'fuelCht', bounds: { x: 84, y: 670, w: 370, h: 108 }, left: E.fuel, right: E.cht },
    { kind: 'dualSector', id: 'oil', bounds: { x: 84, y: 824, w: 370, h: 108 }, left: E.oilPressure, right: E.oilTemp },
    // The RFM ammeter is a third rectangular sector beside the oil pair; separate case is a renderer compromise.
    { kind: 'single', id: 'amps', at: [544, 878], seed: 272, title: 'AMPS', units: '', size: 'small',
      a0: -50 * DEG, a1: 50 * DEG, labels: E.amps.majors, scale: E.amps },
    { kind: 'single', id: 'cat', at: [996, 1020], seed: 273, title: 'CARB TEMP', units: '°C', size: 'small',
      a0: -65 * DEG, a1: 65 * DEG, labels: E.carb.majors, scale: E.carb },
    { kind: 'pullKnob', id: 'carbHeat', bounds: { x: 814, y: 973, w: 100, h: 104 }, label: 'CARB HEAT', color: '#d9d7c5',
      read: c => c.carbHeat, set: (c, v) => { c.carbHeat = v; } },
    { kind: 'hourmeter', id: 'hours', bounds: { x: 86, y: 1002, w: 144, h: 44 } },
    { kind: 'pullKnob', id: 'mixture', bounds: { x: 572, y: 1250, w: 100, h: 100 }, label: 'MIXTURE', color: '#c8261b',
      read: c => 1 - c.mixture, set: (c, v) => { c.mixture = 1 - v; } },
    { kind: 'pullKnob', id: 'fuelShutoff', bounds: { x: 1000, y: 1250, w: 110, h: 100 }, label: 'FUEL', color: '#d9d7c5',
      read: c => c.fuelSelector === 'off' ? 1 : 0, set: (c, v) => {
        const previous = c.fuelSelector === 'off' ? 1 : 0;
        if (v !== previous) c.fuelSelector = v > previous ? 'off' : 'both';
      } },
    // Simulator all-lens test; RFM specifies individual press-to-test fuel/chip lenses.
    { kind: 'pushButton', id: 'lampTest', bounds: { x: 266, y: 985, w: 100, h: 78 }, label: 'LAMP TEST',
      read: c => c.annunciatorTest ?? false, press: (down, c) => { c.annunciatorTest = down; } },
  ],
  annunciator: { bounds: { x: 478, y: 62, w: 372, h: 1300 }, lamps: S269_ANNUNCIATOR_LAMPS,
    cells: [{ x: 478, y: 62, w: 80, h: 86 }, { x: 564, y: 62, w: 80, h: 86 },
      { x: 650, y: 62, w: 94, h: 86 }, { x: 750, y: 62, w: 90, h: 86 },
      { x: 768, y: 1292, w: 82, h: 70 }] },
  switchRow: { bounds: { x: 80, y: 1100, w: 900, h: 242 }, rockerTop: 66, rockerW: 28, rockerH: 38,
    switches: [
      switchDef('panelLights', 'PANEL', 152, c => c.lights.panel > 0, c => { c.lights.panel = c.lights.panel > 0 ? 0 : 1; }),
      switchDef('nav', 'POSITION', 226, c => c.lights.nav, c => { c.lights.nav = !c.lights.nav; }),
      switchDef('beacon', 'BEACON', 300, c => c.lights.beacon, c => { c.lights.beacon = !c.lights.beacon; }),
      switchDef('landing', 'LAND', 374, c => c.lights.landing, c => { c.lights.landing = !c.lights.landing; }),
      switchDef('avionics', 'RADIO', 448, c => c.avionics, c => { c.avionics = !c.avionics; }),
      switchDef('battery', 'BAT', 542, c => c.masterBattery, c => { c.masterBattery = !c.masterBattery; }),
      switchDef('alternator', 'ALT', 608, c => c.alternator, c => { c.alternator = !c.alternator; }),
      { ...switchDef('rotorClutch', 'CLUTCH*', 660, c => !!c.rotorClutch, c => { c.rotorClutch = !c.rotorClutch; }),
        top: 172, name: 'Clutch — two-position simulator control; HOLD unavailable' },
    ],
    legends: [{ text: 'DIMMER', x: 58, y: 32, size: 9 }, { text: 'PANEL', x: 36, y: 46, size: 8 },
      { text: 'RADIO', x: 82, y: 46, size: 8 }], dimmers: { panel: 36, radio: 82, y: 82 },
  },
  ignition: { kind: 'key', at: [916, 1295] },
  background: { color: '#414645', outline: PANEL_OUTLINE, seamsX: [],
    // No spring-trim commands exist. Mark its position without changing airplane trim or cyclic.
    bushings: [{ at: [622, 1030], text: 'TRIM', sub: 'LEFT / RIGHT — INOP' }],
    plates: [{ bounds: { x: 68, y: 651, w: 566, h: 300 }, color: '#303737' },
      { bounds: { x: 648, y: 651, w: 414, h: 280 }, color: '#282e2f' },
      { bounds: { x: 680, y: 1210, w: 182, h: 170 }, color: '#303536' }],
    rack: { rails: { x: 698, y: 434, w: 340, h: 168 }, blanks: [] },
    placards: [
      { x: 180, y: 76, size: 18, lines: ['SCHWEIZER', '300CB'] },
      { x: 1000, y: 99, size: 12, lines: ['NO SMOKING'] },
      { x: 700, y: 366, size: 10, lines: ['OPTIONAL VSI'] },
      { x: 312, y: 601, size: 10, lines: ['ENGINE: 2530–2700 RPM / ROTOR POWER ON: 442–471 RPM',
        '1600 MAX ENGINE RPM WITH ROTOR DISENGAGED'] },
      { x: 542, y: 714, size: 10, lines: ['32.5 US GAL', 'USABLE FUEL'] },
      { x: 266, y: 791, size: 10, lines: ['600 LB MAXIMUM GROSS IN CABIN'] },
      ...S269_VNE_PLACARDS,
      { x: 1000, y: 1110, size: 9, lines: ['KEEP CARB TEMP OUT', 'OF YELLOW ARC'] },
      { x: 622, y: 1360, size: 10, lines: ['PULL LEAN'] },
      { x: 1055, y: 1360, size: 10, lines: ['PULL OFF'] },
      { x: 740, y: 1216, size: 9, lines: ['ENGAGE / RELEASE'] },
      { x: 320, y: 1240, size: 10, lines: ['DAY / NIGHT VFR', 'SOLO RIGHT SEAT'] },
      { x: 320, y: 1310, size: 7.5, lines: ['THIS HELICOPTER MUST BE OPERATED IN COMPLIANCE',
        'WITH THE OPERATING LIMITATIONS SPECIFIED IN THE', 'FAA APPROVED ROTORCRAFT FLIGHT MANUAL'] },
      { x: 576, y: 1398, size: 11, lines: ['DEVELOPMENT PLACEHOLDER — *CLUTCH HOLD / SPRING TRIM UNAVAILABLE'] },
    ] },
  keepOut: [], regions: { sixpack: { x: 72, y: 144, w: 996, h: 465 },
    engine: { x: 68, y: 651, w: 566, h: 300 }, stack: { x: 698, y: 434, w: 340, h: 168 } },
  spots: { asi: { x: 440, y: 255, r: 98 }, tach: { x: 180, y: 495, r: 98 },
    alt: { x: 960, y: 255, r: 98 }, vsi: { x: 700, y: 255, r: 98 },
    fuel: { x: 177, y: 724, r: 54 }, oil: { x: 177, y: 878, r: 54 } },
};

// Shared 28 V bus; threshold and low-voltage set point are estimates, not calibrated switches.
const powered = (i: LampInputs): boolean => i.state.electrical.busVoltage > 18;
export const S269_INSTRUMENT_SYSTEMS: InstrumentSystemsDef = {
  engines: 1, vacuum: null, gyroDrive: { attitude: 'electric', heading: 'electric' },
  fuel: { kgPerGal: V.kgPerGal, tanks: [s => s.fuel.left] }, busDeadVolts: 18, tachHourRpm: V.engineRpm100,
  rotorTach: { engineRpm100: V.engineRpm100, rotorRpm100: V.rotorRpm100, powered },
  // ESTIMATE: no carb probe thermal state. Venturi cooling and shroud heat approximate the indication.
  carbAirTempC: (s, c) => s.oat - 273.15 + (s.engine.running ? 45 * c.carbHeat - 20 : 0),
  lamps: [
    { id: 'lowVolts', lit: (i: LampInputs) => i.state.electrical.busVoltage < 24.5 },
    { id: 'lowFuel', lit: (i: LampInputs) => i.fuelGal[0] <= 1 }, // RFM 3-3: about one usable gallon.
    // Independent sensors and clutch-disengaged limit switch are absent on this base.
    // clutchLight means actuator movement, NOT CLUTCH DISENGAGED. These lenses are test-only.
    ...['mrTransmission', 'trChip', 'clutchDisengaged'].map(id => ({ id, lit: (_i: LampInputs) => false })),
  ].map(l => ({ id: l.id, lit: (i: LampInputs) => powered(i) && (!!i.controls.annunciatorTest || l.lit(i)) })),
};
