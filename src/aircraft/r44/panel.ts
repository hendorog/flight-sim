// Raven II eight-hole analog VFR console, individual warning lenses (POH 7-21, 5 Mar 2015;
// IPC figs 95-65/95-73). Optional electric attitude/heading gyros; one unused hole blanked.
// The common face/outline is frozen in dimensions.ts. See docs/r44-panel.md for compromises.
import { DEG } from '../../core/math';
import { engineControl } from '../../core/types';
import type { InstrumentSystemsDef, LampDef, LampInputs, PanelDef, SwitchDef } from '../../instruments/panelDef';
import { PANEL_CANVAS, PANEL_OUTLINE, PANEL_POD_OUTLINE, PANEL_PEDESTAL_OUTLINE, PANEL_PX_PER_M } from './dimensions';
import { R44_REFERENCE as V } from './reference';
import { R44_ASI_MARKS, R44_ENGINE_SCALES as E, R44_MAP_SCALE, R44_TACH_MARKS } from './panelMarkings';
import { R44_LIMIT_PLACARDS } from './panelPlacards';

const SCALE = { large: 3.125 * 0.0254 * PANEL_PX_PER_M / 172, small: 2.25 * 0.0254 * PANEL_PX_PER_M / 120 };
const COL = [220, 450, 680, 910] as const, ROW = [218, 432] as const;
const AMBER = '#ffba35', RED = '#ff4538';
// Fourteen brow lenses, then FULL THROTTLE / BRAKE at the right edge. Colours: IPC 95.65,
// B198-1/-2 (MR TEMP and BRAKE are amber on this installation, not inherited R22 red lights).
export const R44_ANNUNCIATOR_LAMPS: readonly LampDef[] = [
  ['clutch', 'CLUTCH', AMBER], ['mrTemp', 'MR TEMP', AMBER], ['mrChip', 'MR CHIP', AMBER],
  ['co', 'CARBON MONOXIDE', AMBER], ['starter', 'STARTER ON', AMBER], ['trChip', 'TR CHIP', AMBER],
  ['lowFuel', 'LOW FUEL', AMBER], ['lowRpm', 'LOW RPM', AMBER], ['fuelFilter', 'FUEL FILTER', AMBER],
  ['auxPump', 'AUX FUEL PUMP', AMBER], ['alt', 'ALT', AMBER], ['engineFire', 'ENGINE FIRE', RED],
  ['oil', 'OIL', RED], ['govOff', 'GOV OFF', AMBER], ['fullThrottle', 'FULL THROTTLE', AMBER], ['brake', 'BRAKE', AMBER],
].map(([id, text, color]) => ({ id, text, color, lit: r => r.lamps[id] ?? false }));
const switchDef = (id: string, label: string, x: number, on: SwitchDef['on'], toggle: SwitchDef['toggle'], red = false): SwitchDef =>
  ({ id, label, name: label, x, on, toggle, red });

export const R44_PANEL: PanelDef = {
  // Dimmer response ESTIMATE; zero extinguishes dials/displays, never warning lenses.
  console: { podOutline: PANEL_POD_OUTLINE, pedestalOutline: PANEL_PEDESTAL_OUTLINE, hoodOverhang: 0.05,
    color: 0x252c26, pedestalColor: 0x555c50 },
  id: 'r44', lightingRequiresNav: true, lightingDimmerExponent: 2.2, size: PANEL_CANVAS, instrumentScale: SCALE, instrumentBezel: 'round',
  apertures: { large: 74 * SCALE.large, small: 51 * SCALE.small },
  gauges: [
    { kind: 'vsi', id: 'vsi', at: [COL[0], ROW[0]] },
    { kind: 'attitude', id: 'attitude', at: [COL[1], ROW[0]] },
    { kind: 'asi', id: 'asi', at: [COL[2], ROW[0]], marks: R44_ASI_MARKS },
    { kind: 'rotorTach', id: 'tach', at: [COL[3], ROW[0]], marks: R44_TACH_MARKS },
    { kind: 'blank', id: 'optional', at: [COL[0], ROW[1]] },
    { kind: 'heading', id: 'heading', at: [COL[1], ROW[1]] },
    { kind: 'altimeter', id: 'altimeter', at: [COL[2], ROW[1]] },
    { kind: 'single', id: 'map', at: [COL[3], ROW[1]], seed: 344, title: 'MANIFOLD', units: 'IN HG', size: 'large',
      a0: -125 * DEG, a1: 125 * DEG, labels: R44_MAP_SCALE.majors, scale: R44_MAP_SCALE },
    // Generic clock includes OAT. Separate Davtron OAT/voltmeter is not yet a supported component.
    { kind: 'clock', id: 'clock', at: [190, 633] },
    { kind: 'dualSector', id: 'ampsOil', bounds: { x: 525, y: 754, w: 288, h: 90 }, left: E.amps, right: E.oilPressure },
    { kind: 'dualSector', id: 'auxOil', bounds: { x: 525, y: 858, w: 288, h: 90 }, left: E.aux, right: E.oilTemp },
    { kind: 'dualSector', id: 'fuelCht', bounds: { x: 525, y: 962, w: 288, h: 90 }, left: E.main, right: E.cht },
    { kind: 'pushButton', id: 'lampTest', bounds: { x: 380, y: 903, w: 96, h: 78 }, label: 'LIGHT TEST',
      read: c => c.annunciatorTest ?? false, press: (down, c) => { c.annunciatorTest = down; } },
    { kind: 'pullKnob', id: 'mixture', bounds: { x: 720, y: 1110, w: 100, h: 100 }, label: 'MIXTURE', color: '#c8261b',
      read: c => 1 - engineControl(c, 0, 'mixture'), set: (c, v) => { c.mixture = 1 - v; },
      guard: { closed: c => !(c.mixtureGuardOpen ?? false), toggle: c => { c.mixtureGuardOpen = !c.mixtureGuardOpen; } } },
    { kind: 'navcom', id: 'navcom1', bounds: { x: 416, y: 1216, w: 320, h: 76 } },
    { kind: 'xpdr', id: 'xpdr', bounds: { x: 416, y: 1302, w: 320, h: 60 } },
    { kind: 'pullKnob', id: 'cabinHeat', bounds: { x: 358, y: 1793, w: 100, h: 72 }, label: 'CABIN HEAT', color: '#ddd7c3',
      read: c => c.cabinHeat ?? 0, set: (c, v) => { c.cabinHeat = v; } },
    // Simulator engine-running hours; the real POH 7-18 hourmeter is collective-activated.
    { kind: 'hourmeter', id: 'hours', bounds: { x: 610, y: 1803, w: 160, h: 44 } },
  ],
  annunciator: { bounds: { x: 110, y: 16, w: 1010, h: 504 }, lamps: R44_ANNUNCIATOR_LAMPS,
    cells: [...Array.from({ length: 14 }, (_, i) => ({ x: 128 + i * 64, y: 16, w: 63, h: 76 })),
      { x: 1040, y: 305, w: 76, h: 70 }, { x: 1040, y: 455, w: 76, h: 60 }] },
  switchRow: { bounds: { x: 320, y: 570, w: 744, h: 637 }, rockerTop: 586, rockerW: 24, rockerH: 36,
    switches: [
      switchDef('nav', 'NAV', 40, c => c.lights.nav, c => { c.lights.nav = !c.lights.nav; }),
      switchDef('strobe', 'STROBE', 101, c => c.lights.strobe, c => { c.lights.strobe = !c.lights.strobe; }),
      switchDef('landing', 'LAND', 162, c => c.lights.landing, c => { c.lights.landing = !c.lights.landing; }),
      switchDef('avionics', 'AVIONICS', 223, c => c.avionics, c => { c.avionics = !c.avionics; }),
      switchDef('alternator', 'ALT', 284, c => c.alternator, c => { c.alternator = !c.alternator; }),
      switchDef('battery', 'BAT', 345, c => c.masterBattery, c => { c.masterBattery = !c.masterBattery; }, true),
      { ...switchDef('rotorClutch', 'CLUTCH', 550, c => c.rotorClutch ?? false, c => { c.rotorClutch = !c.rotorClutch; }, true), top: 40 },
    ],
    legends: [{ text: 'PANEL', x: 83, y: 441, size: 9 }, { text: 'RADIO', x: 143, y: 441, size: 9 }],
    dimmers: { panel: 83, radio: 143, y: 465 },
  },
  ignition: { kind: 'key', prime: true, at: [996, 633] },
  background: { color: '#30362f', outline: PANEL_OUTLINE, seamsX: [], bushings: [],
    plates: [
      { bounds: { x: 316, y: 738, w: 520, h: 382 }, color: '#17273b' },
      { bounds: { x: 316, y: 1126, w: 520, h: 82 }, color: '#b0b3ac' },
      { bounds: { x: 316, y: 1210, w: 520, h: 540 }, color: '#292e31' },
      { bounds: { x: 316, y: 1756, w: 520, h: 116 }, color: '#92978b' },
    ],
    rack: { rails: { x: 406, y: 1206, w: 340, h: 166 }, blanks: [] },
    placards: [
      { x: 550, y: 556, size: 11, lines: ['ROTOR POWER ON 101–102% / OFF 90–108%', 'ENGINE 101–102% / 100% = 2665 RPM'] },
      { x: 550, y: 610, size: 10, lines: ['100 KIAS POWER-OFF MARK — SEE VNE PLACARD', 'DO NOT EXCEED 110 KIAS EXCEPT IN SMOOTH AIR'] },
      { x: 550, y: 660, size: 10, lines: ['DAY / NIGHT VFR — SOLO FROM RIGHT SEAT ONLY', 'LOW-G PUSHOVERS PROHIBITED'] },
      { x: 426, y: 779, size: 11, lines: ['USABLE FUEL', `${V.mainUsableGal.toFixed(1)} US GAL MAIN`, `AUX ${V.auxUsableGal.toFixed(1)} US GAL`] },
      { x: 670, y: 1068, size: 16, lines: ['R44 Raven II'] },
      ...R44_LIMIT_PLACARDS,
      { x: 576, y: 1780, size: 8, lines: ['DEVELOPMENT PLACEHOLDER'] },
    ] },
  keepOut: [],
  regions: { sixpack: { x: 112, y: 110, w: 906, h: 430 }, engine: { x: 525, y: 754, w: 288, h: 298 },
    stack: { x: 406, y: 1206, w: 340, h: 166 } },
  spots: { asi: { x: COL[2], y: ROW[0], r: 98 }, tach: { x: COL[3], y: ROW[0], r: 98 },
    alt: { x: COL[2], y: ROW[1], r: 98 }, vsi: { x: COL[0], y: ROW[0], r: 98 },
    attitude: { x: COL[1], y: ROW[0], r: 98 }, heading: { x: COL[1], y: ROW[1], r: 98 },
    oil: { x: 741, y: 799, r: 44 }, fuel: { x: 597, y: 1007, r: 44 } },
};

const powered = (i: LampInputs): boolean => i.state.electrical.busVoltage > 18;
export const R44_INSTRUMENT_SYSTEMS: InstrumentSystemsDef = {
  engines: 1, vacuum: null, gyroDrive: { attitude: 'electric', heading: 'electric' },
  fuel: { kgPerGal: V.kgPerGal, tanks: [s => s.fuel.left, s => s.fuel.right] },
  busDeadVolts: 18, tachHourRpm: V.engineRpm100,
  rotorTach: { engineRpm100: V.engineRpm100, rotorRpm100: V.rotorRpm100,
    // POH 7-24: both tach circuits have a battery bypass through the clutch ENGAGE switch.
    powered: i => powered(i) || (!!i.controls.rotorClutch && i.state.electrical.batteryCharge > 0) },
  lamps: [
    { id: 'clutch', lit: (i: LampInputs) => i.state.rotorcraft?.clutchLight ?? false },
    { id: 'lowRpm', lit: (i: LampInputs) => i.state.rotorcraft?.lowRpmLight ?? false },
    { id: 'govOff', lit: (i: LampInputs) => !(i.controls.rotorGovernor ?? false) },
    { id: 'starter', lit: (i: LampInputs) => engineControl(i.controls, 0, 'starter') },
    // ESTIMATES: independent pressure/voltage switch hysteresis is not represented by shared state.
    { id: 'alt', lit: (i: LampInputs) => i.state.electrical.busVoltage < 24.5 },
    { id: 'oil', lit: (i: LampInputs) => i.state.engine.oilPressure < 25 },
    { id: 'lowFuel', lit: (i: LampInputs) => i.fuelGal[0] <= 3 }, // POH 3-9: approximately 3 US gal in main.
    // Linkage-switch threshold ESTIMATE. Use actual linkage, even below governor acquisition RPM.
    { id: 'fullThrottle', lit: (i: LampInputs) => Math.min(engineControl(i.controls, 0, 'throttle'),
      i.state.rotorcraft?.governorThrottle ?? engineControl(i.controls, 0, 'throttle')) >= 0.98 },
    // POH 7-10: auxiliary-pump pressure, independent of mechanical-pump delivery.
    // ESTIMATE warning threshold; no calibrated pressure-switch hysteresis or pump-failure injection.
    { id: 'auxPump', lit: (i: LampInputs) => (i.state.engine.auxFuelPressure ?? 0) < 5 },
    // No independent sensor/actuator states. Test-only.
    ...['mrTemp', 'mrChip', 'trChip', 'co', 'brake', 'engineFire', 'fuelFilter']
      .map(id => ({ id, lit: (_i: LampInputs) => false })),
  ].map(l => ({ id: l.id, lit: (i: LampInputs) => powered(i) && ((i.controls.annunciatorTest ?? false) || l.lit(i)) })),
};
