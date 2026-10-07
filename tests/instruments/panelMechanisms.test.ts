// The panel components, hotspots and layout rules the Cessna 172S does not use, on the two test-bed panels
// (twin piston, FADEC diesel twin) and on small synthetic definitions. Markings and limits are the handbooks'
// (work/aircraft-data/pa34.md, da42.md); each test names the fact it checks.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { C172S_ASI_MARKS, C172S_PANEL, C172S_TACH_MARKS } from '../../src/aircraft/c172s/panel';
import type { SimContext } from '../../src/core/context';
import { DEG } from '../../src/core/math';
import { makeMockState } from '../../src/core/mockState';
import { defaultControls, defaultWeather, engineControl, type ControlInputs } from '../../src/core/types';
import type { InputAction } from '../../src/input/bindings';
import { InstrumentSet } from '../../src/instruments/dynamics/instrumentSet';
import { buildHotspots, PANEL_HOTSPOTS, type PanelHotspot } from '../../src/instruments/hotspots';
import { InstrumentPanel } from '../../src/instruments/panel';
import type { GaugeDef, PanelDef, PanelEngineDisplayRow } from '../../src/instruments/panelDef';
import { panelLayoutProblems } from '../../src/instruments/panelLayout';
import { flapLeverValues, ignitionLayout, panelParts } from '../../src/instruments/panelParts';
import { engineSwitch, twinEngineGauge } from '../../src/instruments/panels/gauges';
import { ARC_BLUE, ARC_RED } from '../../src/instruments/render/art';
import type { PanelComponent } from '../../src/instruments/render/component';
import { EngineDisplay, engineDisplayBand, engineDisplayFigure, engineDisplayFigureColor } from '../../src/instruments/render/engineDisplay';
import { SingleGauge, TachometerGauge, TwinNeedleGauge } from '../../src/instruments/render/engineGauges';
import { FLAP_AT_POSITION_DEG, flapLampBits, FlapLights, GearLights, trimBarFraction } from '../../src/instruments/render/lights';
import { AirspeedGauge } from '../../src/instruments/render/pitotStaticGauges';
import { CockpitClicks } from '../../src/ui/cockpitClicks';
import { stubCanvas } from './stubCanvas';
import { FADEC_TESTBED_PANEL, FADEC_TESTBED_SYSTEMS, run, TESTBED_PX_RECT, TWIN_TESTBED_PANEL, TWIN_TESTBED_SYSTEMS, twinControls, twinState } from './testbed';

afterEach(() => vi.unstubAllGlobals());

const gauge = <K extends GaugeDef['kind']>(def: PanelDef, kind: K, id?: string): Extract<GaugeDef, { kind: K }> => {
  const g = def.gauges.find((x) => x.kind === kind && (id === undefined || x.id === id));
  if (!g) throw new Error(`no ${kind} gauge ${id ?? ''}`);
  return g as Extract<GaugeDef, { kind: K }>;
};
const spot = (spots: readonly PanelHotspot[], id: string): PanelHotspot => {
  const h = spots.find((x) => x.id === id);
  if (!h) throw new Error(`no hotspot ${id}`);
  return h;
};

describe('twin-needle gauge', () => {
  const tach = gauge(TWIN_TESTBED_PANEL, 'twinNeedle', 'tach');
  const build = (): TwinNeedleGauge => new TwinNeedleGauge(tach.id, tach.at[0], tach.at[1], 74, tach.seed, tach, tach.scale, tach.left, tach.right, tach.size);

  it('is linear over its sweep: 2700 rpm on a 0-3500 dial of 270 degrees stands at 73.3 degrees', () => {
    stubCanvas();
    const g = build();
    expect(g.angle(0) / DEG).toBeCloseTo(-135, 9);
    expect(g.angle(35) / DEG).toBeCloseTo(135, 9);
    expect(g.angle(27) / DEG).toBeCloseTo(-135 + (270 * 27) / 35, 9);
    // Equal steps of rpm are equal steps of angle.
    expect(g.angle(20) - g.angle(10)).toBeCloseTo(g.angle(30) - g.angle(20), 12);
    // The needle stays on its stop beyond the scale.
    expect(g.angle(50)).toBe(g.angle(35));
    expect(g.angle(-3)).toBe(g.angle(0));
  });

  it('reads the left engine on L and the right engine on R; matched engines are one needle over the other', () => {
    stubCanvas();
    const s = twinState();
    s.engines[0].rpm = 2500;
    s.engines[1].rpm = 2300;
    const set = new InstrumentSet({ systems: TWIN_TESTBED_SYSTEMS });
    run(set, 5, s);
    const r = set.readings;
    expect(tach.left(r)).toBeCloseTo(25, 4);
    expect(tach.right(r)).toBeCloseTo(23, 4);
    const g = build();
    // 200 rpm apart is 200 / 3500 of 270 degrees: 15.4 degrees between the needles.
    expect((g.angle(tach.left(r)) - g.angle(tach.right(r))) / DEG).toBeCloseTo((270 * 200) / 3500, 3);
    s.engines[1].rpm = 2500;
    run(set, 5, s);
    expect(g.angle(tach.right(r))).toBeCloseTo(g.angle(tach.left(r)), 6);
    // It draws, and letters its two needles.
    const canvas = stubCanvas();
    const drawn = build();
    expect(drawn.sample(r)).toBe(true);
    drawn.draw(canvas.g);
    expect(canvas.texts).toEqual(expect.arrayContaining(['L', 'R', 'RPM', 'X100', '0', '35']));
    // Unchanged readings do not redraw it.
    expect(drawn.sample(r)).toBe(false);
  });

  it('paints the avoid band and the limit of the handbook red', () => {
    // pa34.md (AFM): red arc 2200-2400 rpm, red line 2700.
    expect(tach.scale.arcs).toContainEqual({ from: 22, to: 24, color: 'red' });
    expect(tach.scale.redLines).toEqual([27]);
    const canvas = stubCanvas();
    build().draw(canvas.g);
    expect(canvas.strokes).toContain(ARC_RED);
  });

  it('the factory binds the needles to engines 0 and 1', () => {
    const g = twinEngineGauge('mp', [0, 0], { size: 'small', seed: 1, fromDeg: -90, toDeg: 90, title: '', units: '', labels: [], scale: { label: '', min: 10, max: 40, majors: [], minorStep: 5 } }, (e) => e.manifoldInHg);
    if (g.kind !== 'twinNeedle') throw new Error('not a twin-needle gauge');
    const set = new InstrumentSet({ systems: TWIN_TESTBED_SYSTEMS });
    set.readings.engines[0].manifoldInHg = 25;
    set.readings.engines[1].manifoldInHg = 11;
    expect([g.left(set.readings), g.right(set.readings)]).toEqual([25, 11]);
    expect([g.a0, g.a1]).toEqual([-Math.PI / 2, Math.PI / 2]);
  });
});

describe('tachometer and single gauge sizes, airspeed radials', () => {
  it('a small tachometer reads the engine it is given', () => {
    stubCanvas();
    const set = new InstrumentSet({ systems: TWIN_TESTBED_SYSTEMS });
    const s = twinState();
    s.engines[0].rpm = 2400;
    s.engines[1].rpm = 1200;
    run(set, 5, s);
    const right = new TachometerGauge('tachR', 300, 300, 51, C172S_TACH_MARKS, 'small', 1);
    const left = new TachometerGauge('tachL', 100, 300, 51, C172S_TACH_MARKS, 'small', 0);
    right.sample(set.readings);
    left.sample(set.readings);
    const angle = (g: TachometerGauge): number => (g as unknown as { latch: { get(i: number): number } }).latch.get(0);
    // 0-3500 rpm over 270 degrees from -135: 1200 rpm at -42.4 degrees, 2400 at +50.1.
    expect(angle(right) / DEG).toBeCloseTo(-135 + (270 * 1200) / 3500, 1);
    expect(angle(left) / DEG).toBeCloseTo(-135 + (270 * 2400) / 3500, 1);
    expect(right.bounds).toEqual({ x: 234, y: 234, w: 132, h: 132 });
    const canvas = stubCanvas();
    new TachometerGauge('tachR', 300, 300, 51, C172S_TACH_MARKS, 'small', 1).draw(canvas.g);
    expect(canvas.texts.slice(0, 8)).toEqual(['0', '5', '10', '15', '20', '25', '30', '35']);
  });

  it('a large single gauge has the 3-1/8" case and paints the red lines of its scale', () => {
    const canvas = stubCanvas();
    const scale = { label: '', min: 10, max: 40, majors: [10, 20, 30, 40], minorStep: 1, redLines: [36], read: () => 25 };
    const g = new SingleGauge('map', 400, 300, 74, 9, { a0: -135 * DEG, a1: 135 * DEG, labels: [10, 20, 30, 40], title: 'MANIFOLD', units: 'IN HG' }, scale, 'large');
    expect(g.bounds).toEqual({ x: 308, y: 208, w: 184, h: 184 });
    g.draw(canvas.g);
    expect(canvas.strokes).toContain(ARC_RED);
    expect(canvas.texts).toEqual(['10', '20', '30', '40', 'MANIFOLD', 'IN HG']);
  });

  it('marks Vmc with a red radial and Vyse with a blue one, on a twin only', () => {
    // 14 CFR 23.1545(b)(5), (6): a red radial line at Vmc and a blue radial line at the one-engine-inoperative best
    // rate of climb speed. pa34.md: 69 and 91 kt; da42.md: 76 and 85 kt.
    const twin = gauge(TWIN_TESTBED_PANEL, 'asi').marks!;
    const fadec = gauge(FADEC_TESTBED_PANEL, 'asi').marks!;
    expect([twin.redRadial, twin.blueLine, twin.redLine]).toEqual([69, 91, 188]);
    expect([fadec.redRadial, fadec.blueLine, fadec.redLine]).toEqual([76, 85, 188]);
    const canvas = stubCanvas();
    new AirspeedGauge('asi', 300, 300, 74, twin).draw(canvas.g);
    expect(canvas.strokes).toContain(ARC_BLUE);
    // Two red strokes: the line at Vne and the radial at Vmc.
    expect(canvas.strokes.filter((c) => c === ARC_RED)).toHaveLength(2);
    const single = stubCanvas();
    new AirspeedGauge('asi', 300, 300, 74, C172S_ASI_MARKS).draw(single.g);
    expect(single.strokes).not.toContain(ARC_BLUE);
    expect(single.strokes.filter((c) => c === ARC_RED)).toHaveLength(1);
  });
});

describe('gear lights and selector', () => {
  it('lights a green per locked leg and the red in transit', () => {
    const lights = new GearLights('gear', { x: 0, y: 0, w: 120, h: 150 });
    const set = new InstrumentSet({ systems: TWIN_TESTBED_SYSTEMS });
    const s = twinState();
    run(set, 0.1, s);
    lights.sample(set.readings);
    // Red, nose, left, right.
    expect([0, 1, 2, 3].map((i) => lights.lit(i))).toEqual([false, true, true, true]);
    Object.assign(s.gear, { locked: [false, true, false], inTransit: true });
    run(set, 0.1, s);
    expect(lights.sample(set.readings)).toBe(true);
    expect([0, 1, 2, 3].map((i) => lights.lit(i))).toEqual([true, false, true, false]);
    // Fixed gear (no gear readings): nothing lit.
    const fixed = new InstrumentSet();
    run(fixed, 0.1, makeMockState(), defaultControls());
    lights.sample(fixed.readings);
    expect([0, 1, 2, 3].map((i) => lights.lit(i))).toEqual([false, false, false, false]);
  });

  it('the selector is a two-position select hotspot: upper half UP, lower half DOWN', () => {
    const lever = spot(buildHotspots(TWIN_TESTBED_PANEL), 'gearLever');
    const g = gauge(TWIN_TESTBED_PANEL, 'gearLights');
    expect([lever.kind, lever.x, lever.y]).toEqual(['select', g.lever![0], g.lever![1]]);
    const c = twinControls();
    expect(lever.value(c)).toBe('DOWN');
    lever.step!(-1, c);
    expect(c.gearLever).toBe('up');
    expect(lever.value(c)).toBe('UP');
    lever.step!(-1, c);
    expect(c.gearLever).toBe('up');
    lever.step!(1, c);
    expect(c.gearLever).toBe('down');
  });

  it('the emergency knob is a push held through the input module', () => {
    const knob = spot(buildHotspots(TWIN_TESTBED_PANEL), 'gearEmergency');
    expect(knob.kind).toBe('push');
    expect(knob.hold).toEqual({ action: 'gearEmergency' });
    const c = twinControls();
    expect(knob.value(c)).toBe('');
    c.gearEmergency = true;
    expect(knob.value(c)).toBe('PULLED');
    // A knob that belongs to one engine carries it.
    const def: PanelDef = { ...C172S_PANEL, gauges: [{ kind: 'guardedKnob', id: 'test', at: [900, 600], label: 'ECU TEST R', action: 'dgAlign', engine: 1 }] };
    expect(spot(buildHotspots(def), 'test').hold).toEqual({ action: 'dgAlign', engine: 1 });
  });
});

describe('flap lights and switch', () => {
  // da42.md (AFM 7.3): UP, APP 20 deg, LDG 42 deg; lights green = UP, white = APP, white = LDG, two lit = in transit.
  const flaps = gauge(FADEC_TESTBED_PANEL, 'flapLights');
  const levers = flapLeverValues(flaps);
  const lit = (deg: number): boolean[] => [0, 1, 2].map((i) => (flapLampBits(flaps, levers, deg, 0) & (1 << i)) !== 0);

  it('lights the position reached, and both neighbours while the flaps travel', () => {
    expect(flaps.colors).toEqual(['green', 'white', 'white']);
    expect(lit(0)).toEqual([true, false, false]);
    expect(lit(10)).toEqual([true, true, false]);
    expect(lit(20)).toEqual([false, true, false]);
    expect(lit(31)).toEqual([false, true, true]);
    expect(lit(42)).toEqual([false, false, true]);
    // Within the position tolerance either side.
    expect(lit(20 - FLAP_AT_POSITION_DEG)).toEqual([false, true, false]);
    expect(lit(20 + 1.01 * FLAP_AT_POSITION_DEG)).toEqual([false, true, true]);
    // Never dark and never more than two, anywhere in the travel.
    for (let deg = -1; deg <= 44; deg += 0.25) {
      const n = lit(deg).filter(Boolean).length;
      expect(n === 1 || n === 2, `${deg} deg`).toBe(true);
    }
  });

  it('shows the actual flaps, not the lever, and needs the bus', () => {
    stubCanvas();
    const set = new InstrumentSet({ systems: FADEC_TESTBED_SYSTEMS });
    const s = twinState();
    const c = twinControls();
    const lights = new FlapLights(flaps);
    const shown = (): boolean[] => {
      run(set, 0.05, s, c);
      lights.sample(set.readings, c);
      return [0, 1, 2].map((i) => lights.lit(i));
    };
    // LDG selected, the flaps still at APP.
    c.flaps = 1;
    s.surfaces.flaps = 20 * DEG;
    expect(shown()).toEqual([false, true, false]);
    s.surfaces.flaps = 42 * DEG;
    expect(shown()).toEqual([false, false, true]);
    s.electrical.busVoltage = 0;
    expect(shown()).toEqual([false, false, false]);
  });

  it('without deflections the lamps follow the lever, evenly spaced', () => {
    const plain: Extract<GaugeDef, { kind: 'flapLights' }> = { kind: 'flapLights', id: 'f', bounds: { x: 0, y: 0, w: 100, h: 40 }, positions: ['UP', 'T/O', 'LDG'] };
    const even = flapLeverValues(plain);
    expect(even).toEqual([0, 0.5, 1]);
    expect(flapLampBits(plain, even, 33, 0.5)).toBe(0b010);
    expect(flapLampBits(plain, even, 0, 0.8)).toBe(0b100);
  });

  it('the switch selects deflection / maximum deflection, one position per click, and stops at the ends', () => {
    // ControlInputs.flaps is deflection / maximum deflection: APP is 20 / 42 of the lever travel.
    expect(levers).toEqual([0, 20 / 42, 1]);
    const lever = spot(buildHotspots(FADEC_TESTBED_PANEL), 'flapsLever');
    expect(lever.kind).toBe('select');
    const c = twinControls();
    expect(lever.value(c)).toBe('UP');
    lever.step!(1, c);
    expect(c.flaps).toBe(20 / 42);
    expect(lever.value(c)).toBe('APP');
    lever.step!(1, c);
    expect(c.flaps).toBe(1);
    lever.step!(1, c);
    expect(c.flaps).toBe(1);
    expect(lever.value(c)).toBe('LDG');
    lever.step!(-1, c);
    lever.step!(-1, c);
    lever.step!(-1, c);
    expect(c.flaps).toBe(0);
  });
});

describe('trim bars', () => {
  it('put neutral at the middle and the two stops at the ends, nose down and nose left first', () => {
    const c = defaultControls();
    expect(trimBarFraction('elevator', c)).toBe(0.5);
    expect(trimBarFraction('rudder', c)).toBe(0.5);
    // ControlInputs: elevatorTrim + = nose up, rudderTrim + = nose right.
    c.elevatorTrim = -1;
    c.rudderTrim = 1;
    expect(trimBarFraction('elevator', c)).toBe(0);
    expect(trimBarFraction('rudder', c)).toBe(1);
    c.elevatorTrim = 0.4;
    c.rudderTrim = -0.4;
    expect(trimBarFraction('elevator', c)).toBeCloseTo(0.7, 12);
    // Equal and opposite trims stand equally far either side of the middle.
    expect(trimBarFraction('elevator', c) + trimBarFraction('rudder', c)).toBeCloseTo(1, 12);
    c.elevatorTrim = 3;
    expect(trimBarFraction('elevator', c)).toBe(1);
  });
});

describe('engine display', () => {
  const display = gauge(FADEC_TESTBED_PANEL, 'engineDisplay');
  const row = (label: string): PanelEngineDisplayRow => display.rows.find((r) => r.label === label)!;
  const YELLOW = engineDisplayFigureColor(row('LOAD'), 95);
  const RED = engineDisplayFigureColor(row('RPM'), 2400);
  const WHITE = engineDisplayFigureColor(row('LOAD'), 50);

  it('colours a figure by the band of the manual it lies in', () => {
    expect(new Set([YELLOW, RED, WHITE]).size).toBe(3);
    // da42.md (AFM 2.5): LOAD green to 92 %, yellow 92-100; propeller rpm green to 2100, yellow to 2300, red above.
    expect(engineDisplayBand(row('LOAD'), 90)).toBe('green');
    expect(engineDisplayFigureColor(row('LOAD'), 90)).toBe(WHITE);
    expect(engineDisplayFigureColor(row('LOAD'), 96)).toBe(YELLOW);
    expect(engineDisplayFigureColor(row('RPM'), 2050)).toBe(WHITE);
    expect(engineDisplayFigureColor(row('RPM'), 2200)).toBe(YELLOW);
    expect(engineDisplayFigureColor(row('RPM'), 2310)).toBe(RED);
    // Oil pressure, bar: red below 0.9, yellow 0.9-2.5, green 2.5-6.0, yellow 6.0-6.5, red above.
    expect([0.5, 2, 4, 6.2, 6.8].map((v) => engineDisplayBand(row('OIL PRES'), v))).toEqual(['red', 'yellow', 'green', 'yellow', 'red']);
    // Coolant, C: yellow below 60, green 60-95, yellow 95-105, red above 105.
    expect([40, 80, 100, 108].map((v) => engineDisplayBand(row('COOLANT'), v))).toEqual(['yellow', 'green', 'yellow', 'red']);
    // Volts: red below 24.1, green 25-30.
    expect([23, 24.5, 28, 31, 33].map((v) => engineDisplayBand(row('VOLTS'), v))).toEqual(['red', 'yellow', 'green', 'yellow', 'red']);
  });

  it('shows the readings of each engine in the units of the display', () => {
    const s = twinState();
    // Left: take-off power. Right: idling cold.
    Object.assign(s.engines[0], { rpm: 3880, propRpm: 2296, loadPercent: 100, oilTemp: 95, oilPressure: 4.5 / 0.0689476, coolantTemp: 88, gearboxTemp: 70, fuelFlow: (9.3 * 3.785411784 * 0.8) / 3600 });
    Object.assign(s.engines[1], { rpm: 1200, propRpm: 710, loadPercent: 4, oilTemp: 20, oilPressure: 2 / 0.0689476, coolantTemp: 25, gearboxTemp: 18, fuelFlow: 0.0003 });
    s.electrical.alternators[0] = 41;
    s.electrical.alternators[1] = 0;
    s.electrical.busVoltage = 27.8;
    const set = new InstrumentSet({ systems: FADEC_TESTBED_SYSTEMS });
    run(set, 60, s);
    const r = set.readings;
    const read = (label: string, engine: number): string => engineDisplayFigure(row(label), row(label).read(r, engine));
    expect([read('LOAD', 0), read('RPM', 0), read('FUEL FLOW', 0), read('OIL TEMP', 0), read('OIL PRES', 0), read('COOLANT', 0), read('GEARBOX', 0), read('VOLTS', 0), read('AMPS', 0)]).toEqual(
      ['100', '2296', '9.3', '95', '4.5', '88', '70', '27.8', '41'],
    );
    expect([read('LOAD', 1), read('RPM', 1), read('OIL TEMP', 1), read('OIL PRES', 1), read('COOLANT', 1), read('GEARBOX', 1), read('VOLTS', 1), read('AMPS', 1)]).toEqual(
      ['4', '710', '20', '2.0', '25', '18', '27.8', '0'],
    );
    // What it letters on the screen: both columns, the limit figures coloured.
    const canvas = stubCanvas();
    const unit = new EngineDisplay(display.id, display.bounds, display.engines, display.rows);
    expect(unit.sample(r, twinControls(), 0)).toBe(true);
    unit.draw(canvas.g);
    expect(canvas.texts).toEqual(expect.arrayContaining(['L', 'R', 'LOAD', '100', '4', '2296', '710', '9.3', '27.8']));
    expect(canvas.fills).toContain(YELLOW);
    // Dark without the bus: no figure is lettered.
    s.electrical.busVoltage = 0;
    run(set, 0.1, s);
    const dark = stubCanvas();
    expect(unit.sample(r, twinControls(), 10)).toBe(true);
    unit.draw(dark.g);
    expect(dark.texts).toEqual([]);
  });

  it('refreshes four times a second however fast the readings move', () => {
    stubCanvas();
    const set = new InstrumentSet({ systems: FADEC_TESTBED_SYSTEMS });
    const s = twinState();
    run(set, 1, s);
    const r = set.readings;
    const unit = new EngineDisplay(display.id, display.bounds, display.engines, display.rows);
    const c = twinControls();
    let redraws = 0;
    const shown: number[] = [];
    // One second of 60 Hz frames with the rpm figure changing in every one of them.
    for (let frame = 0; frame < 60; frame++) {
      r.engines[0].rpm = 1500 + 7 * frame;
      if (unit.sample(r, c, frame / 60)) redraws++;
      shown.push(unit.shown(1, 0));
    }
    expect(redraws).toBe(4);
    // Between refreshes the figure stands still: 15 frames each.
    expect(new Set(shown).size).toBe(4);
    expect(shown[14]).toBe(1500);
    expect(shown[15]).toBe(1500 + 7 * 15);
  });
});

describe('ignition switches and per-engine switches', () => {
  it('each magneto switch of a twin grounds one magneto of one engine', () => {
    // MagnetoPosition: 0 OFF, 1 R, 2 L, 3 BOTH. pa34.md: four magneto switches and a starter rocker.
    const spots = buildHotspots(TWIN_TESTBED_PANEL);
    const ids = spots.filter((h) => h.id.startsWith('engine')).map((h) => h.id);
    expect(ids).toEqual(['engine1MagnetoLeft', 'engine1MagnetoRight', 'engine2MagnetoLeft', 'engine2MagnetoRight', 'engine1Starter', 'engine2Starter']);
    expect(spots.some((h) => h.id === 'magnetos')).toBe(false);
    const c = twinControls();
    const leftOfLeft = spot(spots, 'engine1MagnetoLeft');
    expect(leftOfLeft.name).toBe('Left engine left magneto');
    expect(leftOfLeft.value(c)).toBe('ON');
    leftOfLeft.toggle!(c);
    // The left engine runs on its right magneto; the right engine is untouched, and so is the all-engines switch.
    expect(engineControl(c, 0, 'magnetos')).toBe(1);
    expect(engineControl(c, 1, 'magnetos')).toBe(3);
    expect(c.magnetos).toBe(3);
    expect(leftOfLeft.value(c)).toBe('OFF');
    spot(spots, 'engine1MagnetoRight').toggle!(c);
    expect(engineControl(c, 0, 'magnetos')).toBe(0);
    spot(spots, 'engine2MagnetoRight').toggle!(c);
    expect(engineControl(c, 1, 'magnetos')).toBe(2);
    // Switching twice is no change.
    leftOfLeft.toggle!(c);
    spot(spots, 'engine1MagnetoRight').toggle!(c);
    expect(engineControl(c, 0, 'magnetos')).toBe(3);
  });

  it('each half of the starter rocker cranks its own engine through the input module', () => {
    const spots = buildHotspots(TWIN_TESTBED_PANEL);
    const left = spot(spots, 'engine1Starter');
    const right = spot(spots, 'engine2Starter');
    expect([left.kind, right.kind]).toEqual(['push', 'push']);
    expect(left.hold).toEqual({ action: 'starter', engine: 0 });
    expect(right.hold).toEqual({ action: 'starter', engine: 1 });
    expect(left.x).toBeLessThan(right.x);
    // The two halves do not cover each other.
    expect(right.x - left.x).toBeGreaterThanOrEqual(left.hw + right.hw);
    // No direct write: the input module rewrites the starter every frame.
    expect(left.press).toBeUndefined();
  });

  it('an ENGINE MASTER switches its own engine only', () => {
    // da42.md (AFM 7.9.3): ENGINE MASTER L / R; one START key, left for the left engine, right for the right.
    const spots = buildHotspots(FADEC_TESTBED_PANEL);
    expect(spots.filter((h) => h.id.startsWith('engine')).map((h) => h.id)).toEqual(['engine1Master', 'engine2Master', 'engine1Starter', 'engine2Starter']);
    const c = twinControls();
    const right = spot(spots, 'engine2Master');
    expect(right.name).toBe('Right engine ENGINE MASTER');
    right.toggle!(c);
    expect(engineControl(c, 1, 'engineMaster')).toBe(false);
    expect(engineControl(c, 0, 'engineMaster')).toBe(true);
    expect(c.engineMaster).toBe(true);
    expect(right.value(c)).toBe('OFF');
    right.toggle!(c);
    expect(engineControl(c, 1, 'engineMaster')).toBe(true);
  });

  it('with one engine the switches are the all-engines controls', () => {
    const def: PanelDef = { ...C172S_PANEL, ignition: { kind: 'toggles', at: [900, 600], engines: 1 } };
    const spots = buildHotspots(def);
    const c = defaultControls();
    spot(spots, 'engine1MagnetoRight').toggle!(c);
    expect(c.magnetos).toBe(2);
    expect(c.engines[0].magnetos).toBeUndefined();
    expect(spot(spots, 'engine1MagnetoLeft').name).toBe('Left magneto');
    expect(spot(spots, 'engine1Starter').hold).toEqual({ action: 'starter', engine: 0 });
    // One starter control, in the middle of its slot.
    const layout = ignitionLayout(def.ignition)!;
    expect(layout.starters).toHaveLength(1);
    expect(layout.toggles.map((t) => t.kind)).toEqual(['magnetoLeft', 'magnetoRight']);
  });

  it('a per-engine rocker of the switch row leaves the other engine alone', () => {
    const c = twinControls();
    const pump = TWIN_TESTBED_PANEL.switchRow.switches.find((s) => s.id === 'rightFuelPump')!;
    expect(pump.on(c)).toBe(false);
    pump.toggle(c);
    expect(pump.on(c)).toBe(true);
    expect(engineControl(c, 1, 'fuelPump')).toBe(true);
    expect(engineControl(c, 0, 'fuelPump')).toBe(false);
    expect(c.fuelPump).toBe(false);
    // The all-engines switch still moves the engine that has no switch position of its own.
    c.fuelPump = true;
    expect(engineControl(c, 0, 'fuelPump')).toBe(true);
    const alt = engineSwitch('a', 'L', 'Left alternator', 0, 'alternator', 0);
    alt.toggle(c);
    expect([engineControl(c, 0, 'alternator'), engineControl(c, 1, 'alternator')]).toEqual([false, true]);
    // Through the hotspot of the row as well.
    const spots = buildHotspots(TWIN_TESTBED_PANEL);
    spot(spots, 'leftFuelPump').toggle!(c);
    expect(engineControl(c, 0, 'fuelPump')).toBe(false);
    expect(engineControl(c, 1, 'fuelPump')).toBe(true);
  });

  it('DG align is held through the input module too (it rewrites dgAlign every frame)', () => {
    expect(spot(PANEL_HOTSPOTS, 'dgAlign').hold).toEqual({ action: 'dgAlign' });
  });
});

describe('panel layout', () => {
  it('finds nothing wrong with the C172S panel, nor with the test-bed panels inside the low panel face', () => {
    expect(panelLayoutProblems(C172S_PANEL)).toEqual([]);
    expect(TESTBED_PX_RECT).toEqual({ x: 0, y: 0, w: 2080, h: 624 });
    expect(panelLayoutProblems(TWIN_TESTBED_PANEL, TESTBED_PX_RECT)).toEqual([]);
    expect(panelLayoutProblems(FADEC_TESTBED_PANEL, TESTBED_PX_RECT)).toEqual([]);
  });

  it('reports what lies outside the face, what overlaps, what a yoke boot covers and a hotspot under another', () => {
    // The C172S panel does not fit the low face: its switch row, flap lever and three engine-row gauges reach below 624.
    const low = panelLayoutProblems(C172S_PANEL, TESTBED_PX_RECT);
    for (const id of ['switches', 'flaps', 'tach', 'fuel', 'oil', 'egtff']) expect(low.some((p) => p.startsWith(`'${id}' `) && p.includes('outside the panel face')), id).toBe(true);
    expect(low.some((p) => p.startsWith("'asi'"))).toBe(false);
    expect(low.some((p) => p.includes("hotspot 'magnetos'") && p.includes('outside'))).toBe(true);

    const moved = (id: string, at: [number, number]): PanelDef => ({ ...C172S_PANEL, gauges: C172S_PANEL.gauges.map((g) => (g.id === id && 'at' in g ? { ...g, at } : g)) });
    // The tachometer pushed half a case to the left stands on the heading indicator's neighbour and on the yoke boot.
    const collide = panelLayoutProblems(moved('tach', [560, 585]));
    expect(collide).toContain("'tach' reaches into the keep-out circle at (499, 632)");
    const onAltimeter = panelLayoutProblems(moved('vsi', [683, 300]));
    expect(onAltimeter).toContain("'vsi' overlaps 'altimeter'");
    // Round 2-1/4" flanges (120 px) may nest closer than their squares: the corners are empty.
    const pair = (dx: number): PanelDef => ({
      ...C172S_PANEL,
      gauges: [
        { kind: 'clock', id: 'clock', at: [1700, 300] },
        { kind: 'suction', id: 'suction', at: [1700 + dx, 300 + dx] },
      ],
    });
    // Centres 127 px apart on the diagonal: the squares intersect, the flanges do not.
    expect(panelLayoutProblems(pair(90)).filter((p) => p.includes('overlaps'))).toEqual([]);
    // 113 px apart: the flanges do.
    expect(panelLayoutProblems(pair(80))).toContain("'suction' overlaps 'clock'");
    // A second altimeter's knob lands on the first one's.
    const twice: PanelDef = { ...C172S_PANEL, gauges: [...C172S_PANEL.gauges.filter((g) => g.kind !== 'cdi'), { kind: 'altimeter', id: 'altimeter2', at: [690, 205] }] };
    expect(panelLayoutProblems(twice)).toEqual(expect.arrayContaining(["'altimeter2' overlaps 'altimeter'", "hotspot 'kollsman' is covered by hotspot 'kollsman'"]));
  });

  it('lists the rectangles the panel builds its components on', () => {
    for (const def of [C172S_PANEL, TWIN_TESTBED_PANEL, FADEC_TESTBED_PANEL]) {
      stubCanvas();
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const panel = new InstrumentPanel({ def, pxRect: def === C172S_PANEL ? undefined : TESTBED_PX_RECT });
      const components = (panel as unknown as { components: PanelComponent[] }).components;
      expect(components.map((c) => [c.id, c.bounds]), def.id).toEqual(panelParts(def).map((p) => [p.id, p.rect]));
      expect(panel.layoutWarnings, def.id).toEqual([]);
      expect(warn, def.id).not.toHaveBeenCalled();
      warn.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it('warns once per finding when a panel is built on a face it does not fit', () => {
    stubCanvas();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const panel = new InstrumentPanel({ pxRect: TESTBED_PX_RECT });
    expect(panel.layoutWarnings.length).toBeGreaterThan(5);
    expect(warn).toHaveBeenCalledTimes(panel.layoutWarnings.length);
    expect(String(warn.mock.calls[0][0])).toMatch(/^\[panel c172s\] /);
    warn.mockRestore();
  });
});

describe('the test-bed panels drawn', () => {
  /** A context good for InstrumentPanel.update: no renderer (nothing is uploaded), the cockpit camera. */
  const context = (state: SimContext['state'], controls: ControlInputs): SimContext =>
    ({ state, controls, weather: defaultWeather(), simTime: 0, cameraMode: 'cockpit', renderer: null }) as unknown as SimContext;

  for (const [name, def, systems] of [
    ['twin', TWIN_TESTBED_PANEL, TWIN_TESTBED_SYSTEMS],
    ['fadec', FADEC_TESTBED_PANEL, FADEC_TESTBED_SYSTEMS],
  ] as const) {
    it(`${name}: every component draws, static art, light mask and all, through a flight with one engine failing`, () => {
      const canvas = stubCanvas();
      const panel = new InstrumentPanel({ def, systems, pxRect: TESTBED_PX_RECT, paintLevers: true });
      const components = (panel as unknown as { components: PanelComponent[] }).components;
      // One component per gauge, plus the selector of each light cluster, the annunciator, the row and the ignition group.
      const levers = def.gauges.filter((g) => (g.kind === 'gearLights' || g.kind === 'flapLights') && g.lever).length;
      expect(components).toHaveLength(def.gauges.length + levers + 3);
      void panel.emissiveTexture;
      const s = twinState();
      const c = twinControls();
      const ctx = context(s, c);
      for (let frame = 0; frame < 240; frame++) {
        ctx.simTime = s.time = frame / 60;
        if (frame === 60) Object.assign(s.engines[0], { running: false, rpm: 0, propRpm: 0, oilPressure: 0, loadPercent: 0 });
        if (frame === 90) Object.assign(s.gear, { lever: 'up', locked: [false, false, false], inTransit: true });
        if (frame === 120) c.flaps = 1;
        c.elevatorTrim = Math.sin(frame / 30);
        s.surfaces.flaps = Math.min(42 * DEG, frame * 0.004);
        panel.update(1 / 60, ctx);
      }
      // The readings the panel drew from are per engine: the left engine stopped, the right one running.
      const r = panel.instruments.readings;
      expect(r.engines[0].rpm).toBeLessThan(5);
      expect(r.engines[1].rpm).toBeGreaterThan(2000);
      expect(r.gear).toEqual({ nose: false, left: false, right: false, inTransit: true });
      for (const component of components) expect(Number.isFinite(component.bounds.x + component.bounds.y + component.bounds.w + component.bounds.h), component.id).toBe(true);
      expect(canvas.texts.length).toBeGreaterThan(100);
      for (const text of canvas.texts) expect(text).not.toMatch(/NaN|undefined/);
      // Every component is a region the 2D overlays can copy.
      for (const component of components) expect(panel.regionRect(component.id), component.id).toEqual(component.bounds);
    });
  }
});

describe('cockpit clicks: momentary actions', () => {
  interface Internals {
    hold(action: InputAction, down: boolean, engine?: number): void;
    release(): void;
    held: unknown;
  }
  const make = (holdAction?: (action: InputAction, down: boolean, engine?: number) => void): { clicks: Internals; events: { type: string; code: string; key: string }[] } => {
    const events: { type: string; code: string; key: string }[] = [];
    vi.stubGlobal('document', { createElement: () => ({ classList: { toggle() {} }, style: {}, remove() {} }) });
    vi.stubGlobal('KeyboardEvent', class { constructor(readonly type: string, readonly init: { code: string; key: string }) {} });
    vi.stubGlobal('window', { dispatchEvent: (e: { type: string; init: { code: string; key: string } }) => void events.push({ type: e.type, code: e.init.code, key: e.init.key }) });
    const parent = { appendChild() {} } as unknown as HTMLElement;
    return { clicks: new CockpitClicks(parent, TWIN_TESTBED_PANEL, holdAction) as unknown as Internals, events };
  };

  it('holds through the function it is given, with the engine of the hotspot', () => {
    const calls: unknown[][] = [];
    const { clicks, events } = make((action, down, engine) => void calls.push([action, down, engine]));
    clicks.hold('starter', true, 1);
    // One mouse button: a second press while holding is not a second hold.
    clicks.hold('starter', true, 1);
    clicks.held = { spot: { kind: 'push' } };
    clicks.release();
    expect(calls).toEqual([
      ['starter', true, 1],
      ['starter', false, 1],
    ]);
    expect(events).toEqual([]);
  });

  it('without one, presses the key of the action, as the C172S key switch always did', () => {
    const { clicks, events } = make();
    clicks.hold('starter', true);
    clicks.held = { spot: { kind: 'knob' } };
    clicks.release();
    expect(events).toEqual([
      { type: 'keydown', code: 'KeyS', key: 's' },
      { type: 'keyup', code: 'KeyS', key: 's' },
    ]);
    clicks.hold('dgAlign', true);
    expect(events[2]).toEqual({ type: 'keydown', code: 'KeyD', key: 'd' });
  });
});
