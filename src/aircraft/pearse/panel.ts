// Richard Pearse 1903 Monoplane: vintage mahogany-and-brass pioneer instrument board and 14 V instrument systems.

import type { AsiMarkings, GaugeDef, InstrumentSystemsDef, LampInputs, PanelDef, Rect, ScaleDef, SwitchDef, TachMarkings } from '../types';
import { PEARSE_FLAP_SLOT, PEARSE_PANEL_PX_RECT, PEARSE_PARKING_BRAKE } from './panelLayout';
import { PEARSE_REFERENCE } from './reference';

const V = PEARSE_REFERENCE;

const COLS = [120, 316, 512, 708] as const;
const TOP_ROW_Y = 112;
const SUB_ROW_Y = 304;
const APERTURES = { large: 74, small: 51 };

/** Low-speed pioneer airspeed dial, 0-80 KIAS, red line at 65 KIAS. */
export const PEARSE_ASI_MARKS: AsiMarkings = {
  scaleKt: [0, 15, 20, 30, 40, 50, 60, 70, 80],
  scaleDeg: [0, 22, 42, 92, 146, 200, 252, 298, 334],
  tickFrom: 15,
  tickTo: 80,
  minorStep: 5,
  numberStep: 10,
  arcs: [
    { from: V.vs1, to: V.vno, color: 'green' },
    { from: V.vno, to: V.vne, color: 'yellow' },
    { from: V.vs0, to: V.vfe[V.vfe.length - 1], color: 'white', inner: true },
  ],
  redLine: V.vne,
};

const RATED_RPM = 1150;
const TACH_HOUR_RPM = 950;

/** Slow-turning direct-drive engine tachometer, 0-1500 rpm, red line 1150 rpm. */
export const PEARSE_TACH_MARKS: TachMarkings = {
  max: 1500,
  majorStep: 250,
  minorStep: 50,
  numberStep: 250,
  arcs: [{ from: 450, to: RATED_RPM, color: 'green' }],
  redLine: RATED_RPM,
  hourRpm: TACH_HOUR_RPM,
};

const FUEL_SCALE: ScaleDef = {
  label: '',
  min: 0,
  max: 3.5,
  majors: [0, 1, 2, 3.5],
  minorStep: 0.5,
  arcs: [{ from: 0, to: 0.3, color: 'red' }],
  read: (r) => r.fuelGal[0],
};

const OIL_PRESS_SCALE: ScaleDef = {
  label: '',
  min: 0,
  max: 60,
  majors: [0, 20, 40, 60],
  minorStep: 10,
  arcs: [
    { from: 0, to: 12, color: 'red' },
    { from: 15, to: 45, color: 'green' },
  ],
  redLines: [12, 50],
  read: (r) => r.engines[0].oilPressurePsi,
};

const ENGINE_ROW = { y: SUB_ROW_Y, w: 112, h: 72, fuel: 340, oil: 500 };
const FLAPS: Rect = { x: PEARSE_FLAP_SLOT.x - 100, y: PEARSE_FLAP_SLOT.y - 80, w: 130, h: 312 };
const SWITCHES: Rect = { x: 165, y: 446, w: 620, h: 116 };
const ROW = {
  rockerTop: 42,
  rockerW: 24,
  rockerH: 40,
  magneto: { x: 224, y: 68 },
  dimmers: { panel: 314, radio: 362, y: 64 },
};

const RX = {
  alt: 52,
  bat: 84,
  avionics: 142,
  nav: 432,
  landing: 474,
} as const;

const rocker = (
  id: string,
  label: string,
  name: string,
  x: number,
  on: SwitchDef['on'],
  toggle: SwitchDef['toggle'],
  opts: { red?: boolean; group?: string } = {},
): SwitchDef => ({ id, label, name, x, on, toggle, ...opts });

const GAUGES: GaugeDef[] = [
  { kind: 'asi', id: 'asi', at: [COLS[0], TOP_ROW_Y], marks: PEARSE_ASI_MARKS },
  { kind: 'altimeter', id: 'alt', at: [COLS[1], TOP_ROW_Y] },
  { kind: 'tach', id: 'tach', at: [COLS[2], TOP_ROW_Y], size: 'large', marks: PEARSE_TACH_MARKS },
  { kind: 'turn', id: 'tc', at: [COLS[3], TOP_ROW_Y] },
  { kind: 'vsi', id: 'vsi', at: [COLS[0], SUB_ROW_Y], scale: 0.78 },
  {
    kind: 'sector',
    id: 'fuel',
    bounds: { x: ENGINE_ROW.fuel - ENGINE_ROW.w / 2, y: ENGINE_ROW.y - ENGINE_ROW.h / 2, w: ENGINE_ROW.w, h: ENGINE_ROW.h },
    title: 'PETROL GAL',
    scale: FUEL_SCALE,
  },
  {
    kind: 'sector',
    id: 'oilPress',
    bounds: { x: ENGINE_ROW.oil - ENGINE_ROW.w / 2, y: ENGINE_ROW.y - ENGINE_ROW.h / 2, w: ENGINE_ROW.w, h: ENGINE_ROW.h },
    title: 'OIL PSI',
    scale: OIL_PRESS_SCALE,
  },
  { kind: 'flapLever', id: 'flaps', bounds: FLAPS, maxDeg: 16, legends: ['0°', '8°', '16°'] },
];

const BIG = APERTURES.large + 18;

export const PEARSE_PANEL: PanelDef = {
  id: 'pearse',
  size: { w: 2080, h: 800 },
  gauges: GAUGES,
  switchRow: {
    bounds: SWITCHES,
    rockerTop: ROW.rockerTop,
    rockerW: ROW.rockerW,
    rockerH: ROW.rockerH,
    switches: [
      rocker('alternator', 'DYN', 'Charging dynamo', RX.alt, (c) => c.alternator, (c) => { c.alternator = !c.alternator; }, { red: true, group: 'master' }),
      rocker('masterBattery', 'ACC', 'Ignition accumulator', RX.bat, (c) => c.masterBattery, (c) => { c.masterBattery = !c.masterBattery; }, { red: true, group: 'master' }),
      rocker('avionics', 'COIL', 'Trembler coil & comms', RX.avionics, (c) => c.avionics, (c) => { c.avionics = !c.avionics; }),
      rocker('nav', 'LAMP', 'Marker lamps', RX.nav, (c) => c.lights.nav, (c) => { c.lights.nav = !c.lights.nav; }, { group: 'lights' }),
      rocker('landing', 'HEAD', 'Forward lamp', RX.landing, (c) => c.lights.landing, (c) => { c.lights.landing = !c.lights.landing; }, { group: 'lights' }),
    ],
    legends: [
      { text: 'MASTER', x: (RX.alt + RX.bat) / 2, y: ROW.rockerTop - 22, size: 8.5 },
      { text: 'DYN', x: RX.alt, y: ROW.rockerTop - 11, size: 8 },
      { text: 'ACC', x: RX.bat, y: ROW.rockerTop - 11, size: 8 },
      { text: 'PANEL LT', x: ROW.dimmers.panel, y: ROW.rockerTop - 11, size: 8 },
      { text: 'LANTERN', x: (RX.nav + RX.landing) / 2, y: ROW.rockerTop - 22, size: 8.5 },
    ],
    dimmers: ROW.dimmers,
  },
  ignition: { kind: 'key', at: [SWITCHES.x + ROW.magneto.x, SWITCHES.y + ROW.magneto.y] },
  background: {
    // Rich oiled mahogany / dark walnut instrument board.
    color: '#3a2618',
    plates: [
      { bounds: { x: 10, y: 10, w: PEARSE_PANEL_PX_RECT.w - 20, h: PEARSE_PANEL_PX_RECT.h - 20 }, color: '#472f1d', radius: 10 },
      { bounds: { x: 152, y: 440, w: 648, h: 124 }, color: '#2b1d12', radius: 6 },
    ],
    seamsX: [985],
    bushings: [
      { at: [PEARSE_PARKING_BRAKE[0], PEARSE_PARKING_BRAKE[1]], text: 'WHEEL BRAKE', sub: 'LATCH' },
    ],
    placards: [
      {
        x: 1130,
        y: 52,
        lines: [
          'R. W. PEARSE',
          'WAITOHI FLAT',
          'TEMUKA · N.Z.',
          '— 1903 —',
          'PATENT NO. 21476',
          '',
          '24 H.P. DOUBLE-ACTING',
          'TWO-CYLINDER ENGINE',
          'MAX 1150 R.P.M.',
          '',
          `STALL ${V.vs1} KT · VNE ${V.vne} KT`,
          'LIMIT +3.0 / -1.2 G',
          'OVERHEAD BRASS TANK',
          '3.2 U.S. GAL PETROL',
        ],
        size: 7.5,
      },
    ],
  },
  keepOut: [],
  apertures: APERTURES,
  instrumentBezel: 'round',
  regions: {
    sixpack: { x: COLS[0] - 92, y: TOP_ROW_Y - 92, w: COLS[3] - COLS[0] + 184, h: 368 },
    engine: { x: ENGINE_ROW.fuel - 65, y: ENGINE_ROW.y - 45, w: 290, h: 90 },
  },
  spots: {
    asi: { x: COLS[0], y: TOP_ROW_Y, r: BIG },
    alt: { x: COLS[1], y: TOP_ROW_Y, r: BIG },
    tach: { x: COLS[2], y: TOP_ROW_Y, r: BIG },
    tc: { x: COLS[3], y: TOP_ROW_Y, r: BIG },
    ball: { x: COLS[3], y: TOP_ROW_Y + APERTURES.large * 0.45, r: APERTURES.large * 0.42 },
    vsi: { x: COLS[0], y: SUB_ROW_Y, r: BIG * 0.78 },
    fuel: { x: ENGINE_ROW.fuel, y: ENGINE_ROW.y, r: 58 },
    oil: { x: ENGINE_ROW.oil, y: ENGINE_ROW.y, r: 58 },
    flaps: { x: FLAPS.x + FLAPS.w / 2, y: FLAPS.y + FLAPS.h / 2, r: FLAPS.h / 2 },
  },
};

const KG_PER_GAL = 2.7216;
const BUS_DEAD_VOLTS = 9;
const powered = (i: LampInputs): boolean => i.state.electrical.busVoltage > BUS_DEAD_VOLTS;

export const PEARSE_INSTRUMENT_SYSTEMS: InstrumentSystemsDef = {
  engines: 1,
  vacuum: null,
  gyroDrive: { attitude: 'electric', heading: 'electric' },
  fuel: { kgPerGal: KG_PER_GAL, tanks: [(s) => s.fuel.left + s.fuel.right] },
  busDeadVolts: BUS_DEAD_VOLTS,
  tachHourRpm: TACH_HOUR_RPM,
  oilPressureDirect: true,
  lamps: [{ id: 'lowVolts', lit: (i) => powered(i) && i.state.electrical.busVoltage < 12.2 }],
};
