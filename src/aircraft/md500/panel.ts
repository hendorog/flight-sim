// MD 500E (369E, 250-C20B) instrument panel and instrument systems: RFM CSP-E-1 Rev 16 Fig 4-2 (LH command, "layout
// typical"), warning lights Fig 3-1, markings Fig 2-5 / 2-6. See docs/md500-panel.md for what is a compromise.
// The shared systems feed every gauge: N2 % and Nr come through InstrumentSystemsDef.rotorTach, N1 and TOT through
// EngineReadings.ngPct / ittC, torque through md500TorquePsi, the ENGINE OUT / RE-IGN lamps from
// RotorcraftState.turboshaft (T2) with bus power.
import { DEG } from '../../core/math';
import type { ControlInputs } from '../../core/types';
import type { InstrumentSystemsDef, LampDef, LampInputs, PanelDef, SwitchDef } from '../types';
import { MD500_FUEL, MD500_BUS_DEAD_VOLTS, MD500_N2_100_RPM, MD500_NR_100 } from './facts';
import { MD500_ANNUNCIATOR_STRIP as STRIP, MD500_COLS as COL, MD500_CONSOLE_TOP, MD500_PANEL_CANVAS, MD500_PANEL_OUTLINE,
  MD500_PANEL_PX_PER_M, MD500_ROWS as ROW, MD500_STACK_Y as STACK } from './panelLayout';
import { MD500_ASI_MARKS, MD500_KG_PER_GAL, MD500_LB_PER_GAL, MD500_SCALES as E } from './panelMarkings';
import { Md500N1Gauge } from './panelN1';
import { md500VnePlacards } from './panelPlacards';
import { Md500DualTach } from './panelTach';

const SCALE = { large: 3.125 * 0.0254 * MD500_PANEL_PX_PER_M / 172, small: 2.25 * 0.0254 * MD500_PANEL_PX_PER_M / 120 };
const AMBER = '#ffba35', RED = '#ff4538';
const ENGINE_SWEEP = { a0: -125 * DEG, a1: 125 * DEG };
const noRead = <T extends { label: string }>(s: T): T => ({ ...s, label: '' });

/** Fig 3-1, left to right. Colours: red = warning, amber = caution (RFM 3-2..3-25). The three optional lenses are blank. */
const LAMP_ROW: readonly (readonly [string, string, string])[] = [
  ['engineOut', 'ENGINE OUT', RED], ['xmsnOilPress', 'XMSN OIL PRESS', RED], ['xmsnOilTemp', 'XMSN OIL TEMP', RED],
  ['bat160', 'BAT TEMP 160°', RED], ['bat140', 'BAT TEMP 140°', AMBER], ['reign', 'RE-IGN P RST', AMBER],
  ['fuelLow', 'FUEL LEVEL LOW', AMBER], ['fuelFilter', 'FUEL FILTER', AMBER], ['mrChips', 'M/R XMSN CHIPS', AMBER],
  ['trChips', 'T/R XMSN CHIPS', AMBER], ['engChips', 'ENGINE CHIPS', AMBER], ['genOut', 'GEN OUT', AMBER],
  ['opt1', '', AMBER], ['opt2', '', AMBER], ['opt3', '', AMBER], ['pressTest', 'PRESS TO TEST', '#e9e6d6'],
];
export const MD500_ANNUNCIATOR_LAMPS: readonly LampDef[] = LAMP_ROW.map(([id, text, color]) => ({ id, text, color,
  lit: r => r.lamps[id] ?? false,
  // The RE-IGN lens resets the latch when pressed (RFM 4-17/4-18); every lens tests itself; PRESS TO TEST tests all.
  press: id === 'pressTest' ? (down: boolean, c: ControlInputs) => { c.annunciatorTest = down; }
    : (down: boolean, c: ControlInputs) => { c.lampTestId = down ? id : undefined; } }));

const switchDef = (id: string, label: string, i: number, on: SwitchDef['on'], toggle: SwitchDef['toggle'], red = false): SwitchDef =>
  ({ id, label, name: label, x: 24 + i * 40, on, toggle, red });
const CB_NAMES = ['GYRO', 'LDG LT', 'INST', 'PNL LT', 'TRIM', 'N2 GOV', 'ENG OUT', 'GEN', 'AUDIO', 'START', 'COMM 1', 'COMM 2',
  'NAV 1', 'NAV 2', 'ADF', 'XPDR', 'HOOK', 'YSAS'];
/** Ratings: ESTIMATE (the RFM names the breakers but gives no amperage). */
const CB_AMPS = [5, 10, 5, 5, 5, 5, 5, 100, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5];

export const MD500_PANEL: PanelDef = {
  // Fixed 2D view: flight instruments with the N1 dial in the top rows, the engine / right column gauges beside them
  // automatically; the console crop holds the fuel valve, the switch row and the START control.
  fixed: { flightRows: [['asi', 'attitude', 'altimeter', 'n1'], ['tach', 'heading', 'vsi']],
    controls: [{ x: 24, y: MD500_CONSOLE_TOP - 6, w: 654, h: 116 }] },
  id: 'md500', size: MD500_PANEL_CANVAS, instrumentScale: SCALE, instrumentBezel: 'round', lightingDimmerExponent: 2.2,
  apertures: { large: 74 * SCALE.large, small: 51 * SCALE.small },
  gauges: [
    { kind: 'asi', id: 'asi', at: [COL.asi, ROW.top], marks: MD500_ASI_MARKS },
    { kind: 'customRound', id: 'tach', at: [COL.asi, ROW.second], size: 'large',
      create: (id, x, y, aperture) => new Md500DualTach(id, x, y, aperture) },
    { kind: 'attitude', id: 'attitude', at: [COL.att, ROW.top] },
    { kind: 'heading', id: 'heading', at: [COL.att, ROW.second] },
    { kind: 'altimeter', id: 'altimeter', at: [COL.alt, ROW.top] },
    { kind: 'vsi', id: 'vsi', at: [COL.alt, ROW.second] },
    { kind: 'single', id: 'oilTemp', at: [COL.engine, STACK[0]], seed: 501, title: 'OIL TEMP', units: '°C', size: 'small', ...ENGINE_SWEEP,
      labels: E.oilTemp.majors, scale: noRead(E.oilTemp) },
    { kind: 'single', id: 'torque', at: [COL.engine, STACK[1]], seed: 502, title: 'TORQUE', units: 'PSI', size: 'small', ...ENGINE_SWEEP,
      labels: E.torque.majors, scale: noRead(E.torque) },
    { kind: 'single', id: 'tot', at: [COL.engine, STACK[2]], seed: 503, title: 'TOT', units: '°C ×100', size: 'small', ...ENGINE_SWEEP,
      labels: E.tot.majors, scale: noRead(E.tot) },
    { kind: 'customRound', id: 'n1', at: [COL.engine, STACK[3]], size: 'small',
      create: (id, x, y, aperture) => new Md500N1Gauge(id, x, y, aperture) },
    { kind: 'single', id: 'oilPressure', at: [COL.right, STACK[0]], seed: 504, title: 'OIL PRESS', units: 'PSI', size: 'small', ...ENGINE_SWEEP,
      labels: E.oilPressure.majors, scale: noRead(E.oilPressure) },
    { kind: 'single', id: 'fuel', at: [COL.right, STACK[1]], seed: 505, title: 'FUEL', units: 'LBS ×100', size: 'small', ...ENGINE_SWEEP,
      labels: E.fuel.majors, scale: noRead(E.fuel) },
    { kind: 'single', id: 'amps', at: [COL.right, STACK[2]], seed: 506, title: 'DC AMPS', units: '', size: 'small', ...ENGINE_SWEEP,
      labels: E.amps.majors, scale: noRead(E.amps) },
    { kind: 'clock', id: 'clock', at: [COL.right, STACK[3]] },
    // Fuel shutoff valve: pull = closed (RFM 4-2 "OPEN (IN)").
    { kind: 'pullKnob', id: 'fuelValve', bounds: { x: 34, y: MD500_CONSOLE_TOP + 8, w: 100, h: 96 }, label: 'FUEL VALVE', color: '#c8261b',
      read: c => c.fuelSelector === 'off' ? 1 : 0, set: (c, v) => {
        const previous = c.fuelSelector === 'off' ? 1 : 0;
        if (v !== previous) c.fuelSelector = v > previous ? 'off' : 'both';
      } },
    { kind: 'navcom', id: 'navcom1', bounds: { x: 700, y: 660, w: 320, h: 76 } },
    { kind: 'xpdr', id: 'xpdr', bounds: { x: 700, y: 748, w: 320, h: 60 } },
  ],
  annunciator: { bounds: { x: STRIP.x, y: STRIP.y, w: 16 * STRIP.cell, h: STRIP.h }, lamps: MD500_ANNUNCIATOR_LAMPS,
    cells: Array.from({ length: 16 }, (_, i) => ({ x: STRIP.x + i * STRIP.cell, y: STRIP.y, w: STRIP.cell - 2, h: STRIP.h })) },
  switchRow: { bounds: { x: 150, y: MD500_CONSOLE_TOP + 2, w: 412, h: 104 }, rockerTop: 44, rockerW: 28, rockerH: 38,
    switches: [
      // RFM Fig 4-2 lower row: BAT/OFF/EXT PWR, START PUMP, ANTI-COLL, POS LT, LDG LT (utility), PNL LT, GEN. Order ESTIMATE.
      switchDef('battery', 'BAT', 0, c => c.masterBattery, c => { c.masterBattery = !c.masterBattery; }, true),
      switchDef('generator', 'GEN', 1, c => c.alternator, c => { c.alternator = !c.alternator; }),
      switchDef('startPump', 'START PUMP', 2, c => c.fuelPump, c => { c.fuelPump = !c.fuelPump; }),
      switchDef('beacon', 'ANTI-COLL', 3, c => c.lights.beacon, c => { c.lights.beacon = !c.lights.beacon; }),
      switchDef('nav', 'POS LT', 4, c => c.lights.nav, c => { c.lights.nav = !c.lights.nav; }),
      switchDef('landing', 'LDG LT', 5, c => c.lights.landing, c => { c.lights.landing = !c.lights.landing; }),
      switchDef('panelLights', 'PNL LT', 6, c => c.lights.panel > 0, c => { c.lights.panel = c.lights.panel > 0 ? 0 : 1; }),
      switchDef('avionics', 'RADIO', 7, c => c.avionics, c => { c.avionics = !c.avionics; }),
    ],
    legends: [{ text: 'DIMMER', x: 372, y: 26, size: 9 }, { text: 'PANEL', x: 352, y: 40, size: 8 }, { text: 'RADIO', x: 392, y: 40, size: 8 }],
    dimmers: { panel: 352, radio: 392, y: 78 } },
  // START / IGNITION: the real START button is on the collective head (Fig 4-4); this is its console twin. The IGNITION toggle
  // beside it forces continuous ignition (magnetos), which the real aircraft does not have: compromise, docs/md500-panel.md.
  ignition: { kind: 'toggles', at: [630, MD500_CONSOLE_TOP + 52], engines: 1, switches: 'ignition' },
  background: { color: '#2b2e2f', outline: MD500_PANEL_OUTLINE, seamsX: [], bushings: [],
    plates: [
      { bounds: { x: 332, y: 2, w: 92, h: 20 }, color: '#16181a', radius: 10 }, // engine-out horn dome (RFM Fig 3-1 note)
      { bounds: { x: 20, y: 496, w: 620, h: 148 }, color: '#1b1f21' }, // Vne card holder
      { bounds: { x: 20, y: MD500_CONSOLE_TOP - 6, w: 668, h: 178 }, color: '#222628' },
    ],
    breakers: { bounds: { x: 30, y: 770, w: 640, h: 62 }, names: CB_NAMES, amps: CB_AMPS, perRow: 18 },
    rack: { rails: { x: 692, y: 654, w: 336, h: 160 }, blanks: [] },
    placards: [
      { x: 224, y: 14, size: 9, lines: ['MD 500E'] },
      { x: 640, y: 14, size: 8, lines: ['NO SMOKING'] },
      ...md500VnePlacards(28, 502, 200, 6),
      { x: 440, y: 646, size: 7, lines: ['N2 / NR 102–103 % POWER ON · NR 410–523 RPM POWER OFF'] },
      
    ] },
  keepOut: [],
  regions: { sixpack: { x: 20, y: 80, w: 640, h: 400 }, engine: { x: 690, y: 80, w: 310, h: 570 },
    stack: { x: 692, y: 654, w: 336, h: 160 } },
  spots: { asi: { x: COL.asi, y: ROW.top, r: 98 }, tach: { x: COL.asi, y: ROW.second, r: 98 },
    alt: { x: COL.alt, y: ROW.top, r: 98 }, vsi: { x: COL.alt, y: ROW.second, r: 98 },
    attitude: { x: COL.att, y: ROW.top, r: 98 }, heading: { x: COL.att, y: ROW.second, r: 98 },
    oil: { x: COL.right, y: STACK[0], r: 70 }, fuel: { x: COL.right, y: STACK[1], r: 70 } },
};

// 28 V bus; ESTIMATE dead threshold (MD500_BUS_DEAD_VOLTS).
const powered = (i: LampInputs): boolean => i.state.electrical.busVoltage > MD500_BUS_DEAD_VOLTS;
const turboshaft = (i: LampInputs) => i.state.rotorcraft?.turboshaft;
/** Lamps and what lights them. Thresholds with no RFM value are ESTIMATES (marked). */
const LAMP_RULES: Record<string, (i: LampInputs) => boolean> = {
  // RFM 3-3: N1 below 55 % or Nr below 468 rpm; the circuit is bus powered (ENG OUT breaker). Evaluated by T2's turboshaft stage.
  engineOut: i => turboshaft(i)?.engineOutLight ?? false,
  // ESTIMATE thresholds: the RFM gives no switch settings. Lit before start (RFM 4-13) and out within 30 s of light-off.
  xmsnOilPress: i => { const t = i.state.rotorcraft?.transmission; return t === undefined || t.oilPressurePsi < 5; },
  trChips: i => i.state.rotorcraft?.transmission?.tailChips ?? false, // the one chip detector the shared state models
  xmsnOilTemp: i => (i.state.rotorcraft?.transmission?.oilTemperatureC ?? 0) > 121,
  // RFM 3-17: the lens is a latch reset by pressing it; armed by transmission oil pressure.
  reign: i => turboshaft(i)?.reignitionLight ?? false,
  // RFM 3-23: about 35 lb remaining.
  fuelLow: i => i.fuelGal[0] * MD500_LB_PER_GAL <= MD500_FUEL.lowLb,
  // On before start; out when the generator switch is ON and the generator is on line (RFM 4-16).
  genOut: i => !i.controls.alternator || !i.state.engine.running,
};
export const MD500_LAMP_IDS: readonly string[] = LAMP_ROW.map(l => l[0]);
export const MD500_INSTRUMENT_SYSTEMS: InstrumentSystemsDef = {
  engines: 1, vacuum: null, gyroDrive: { attitude: 'electric', heading: 'electric' },
  // Two bladder cells under the floor: the sum, kg indicated as US gal at Jet A (RFM 1-13).
  fuel: { kgPerGal: MD500_KG_PER_GAL, tanks: [s => s.fuel.left + s.fuel.right] },
  busDeadVolts: MD500_BUS_DEAD_VOLTS, tachHourRpm: MD500_N2_100_RPM,
  // Dual tach: N2 is the engine output shaft, Nr the rotor. Tach generators: self-powered (ESTIMATE; the RFM is silent).
  rotorTach: { engineRpm100: MD500_N2_100_RPM, rotorRpm100: MD500_NR_100, powered: () => true },
  lamps: LAMP_ROW.map(([id]) => ({ id, lit: (i: LampInputs) => powered(i) && (!!i.controls.annunciatorTest || i.controls.lampTestId === id ||
    (LAMP_RULES[id]?.(i) ?? false)) })),
};
