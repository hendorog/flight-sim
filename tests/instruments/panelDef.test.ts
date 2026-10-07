// The instruments module built from a panel definition: the hotspots, the instrument dynamics and the panel's
// components follow the definition they are given, and with the Cessna 172S definition they are what the
// module was before it took one (the hotspot list below was written out from that module).

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  C172S_AMMETER_SCALE,
  C172S_ANNUNCIATOR_LAMPS,
  C172S_ASI_MARKS,
  C172S_INSTRUMENT_SYSTEMS,
  C172S_PANEL,
  C172S_SUCTION_SCALE,
  C172S_TACH_MARKS,
} from '../../src/aircraft/c172s/panel';
import { C172 } from '../../src/core/c172';
import { makeMockState } from '../../src/core/mockState';
import { defaultControls, defaultWeather, type ControlInputs } from '../../src/core/types';
import { KG_PER_GAL, Tachometer } from '../../src/instruments/dynamics/engineSystems';
import { InstrumentSet } from '../../src/instruments/dynamics/instrumentSet';
import {
  buildHotspots,
  hotspotAt,
  hotspotValue,
  PANEL_HOTSPOTS,
  pressHotspot,
  toggleHotspot,
  turnHotspot,
  type HotspotId,
  type PanelHotspot,
} from '../../src/instruments/hotspots';
import { InstrumentPanel } from '../../src/instruments/panel';
import type { GaugeDef, InstrumentSystemsDef, PanelDef } from '../../src/instruments/panelDef';
import { ARC_BLUE, ARC_GREEN, ARC_RED, ARC_WHITE, ARC_YELLOW } from '../../src/instruments/render/art';
import type { Ctx2D } from '../../src/instruments/render/canvas';
import type { PanelComponent } from '../../src/instruments/render/component';
import { TachometerGauge } from '../../src/instruments/render/engineGauges';
import { AirspeedGauge } from '../../src/instruments/render/pitotStaticGauges';

/**
 * A canvas that accepts every drawing call and draws nothing, so components can be built and painted without a
 * DOM. It keeps the lettering (fillText) and the stroke colours it was given.
 */
function stubCanvas(): { g: Ctx2D; texts: string[]; strokes: string[] } {
  const texts: string[] = [];
  const strokes: string[] = [];
  const pixels = new Uint8ClampedArray(0);
  const sink: unknown = new Proxy(function () {}, {
    get: (_t, key) => {
      if (key === Symbol.toPrimitive) return () => 0;
      if (key === 'data') return pixels;
      if (key === 'fillText') return (text: string) => void texts.push(text);
      return sink;
    },
    set: (_t, key, value) => {
      if (key === 'strokeStyle') strokes.push(String(value));
      return true;
    },
    apply: () => sink,
  });
  vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => sink }) });
  return { g: sink as Ctx2D, texts, strokes };
}

afterEach(() => vi.unstubAllGlobals());

const KNOB = 'scroll, or click left / right half';
const SWITCH = 'click to switch';
/** The hotspots of the C172S panel as the module listed them before it built them from the definition. */
const C172S_HOTSPOTS: [id: string, kind: string, x: number, y: number, hw: number, hh: number, name: string, hint: string][] = [
  ['kollsman', 'knob', 613, 277, 15, 15, 'Altimeter setting', KNOB],
  ['headingBug', 'knob', 570, 464, 15, 15, 'Heading bug', KNOB],
  ['dgAlign', 'push', 428, 464, 15, 15, 'Heading indicator', 'hold to align with the compass'],
  ['obs', 'knob', 797, 277, 15, 15, 'NAV 1 course (OBS)', KNOB],
  ['panelDimmer', 'knob', 670, 746, 15, 15, 'Panel lights', KNOB],
  ['radioDimmer', 'knob', 730, 746, 15, 15, 'Radio lights', KNOB],
  ['magnetos', 'knob', 78, 752, 30, 30, 'Magnetos', 'click right to turn (hold at START), left to turn back'],
  ['alternator', 'toggle', 158, 745, 15, 25, 'Master ALT', SWITCH],
  ['battery', 'toggle', 183, 745, 15, 25, 'Master BAT', SWITCH],
  ['fuelPump', 'toggle', 242, 745, 15, 25, 'Fuel pump', SWITCH],
  ['beacon', 'toggle', 300, 745, 15, 25, 'Beacon', SWITCH],
  ['landing', 'toggle', 342, 745, 15, 25, 'Landing light', SWITCH],
  ['taxi', 'toggle', 384, 745, 15, 25, 'Taxi light', SWITCH],
  ['nav', 'toggle', 426, 745, 15, 25, 'Nav lights', SWITCH],
  ['strobe', 'toggle', 468, 745, 15, 25, 'Strobes', SWITCH],
  ['avionics', 'toggle', 536, 745, 15, 25, 'Avionics master', SWITCH],
  ['pitotHeat', 'toggle', 604, 745, 15, 25, 'Pitot heat', SWITCH],
];

const row = (h: PanelHotspot): unknown[] => [h.id, h.kind, h.x, h.y, h.hw, h.hh, h.name, h.hint];

describe('buildHotspots', () => {
  it('gives the C172S panel the hotspots it had, in the same order', () => {
    expect(buildHotspots(C172S_PANEL).map(row)).toEqual(C172S_HOTSPOTS);
    expect(PANEL_HOTSPOTS.map(row)).toEqual(C172S_HOTSPOTS);
  });

  it('puts on each record what the id-based functions do', () => {
    const spots = buildHotspots(C172S_PANEL);
    const start = (): ControlInputs => {
      const c = defaultControls();
      c.kollsmanHpa = 1009;
      c.headingBugDeg = 358;
      c.obsDeg = 2;
      c.magnetos = 2;
      return c;
    };
    for (const spot of spots) {
      const id = spot.id as HotspotId;
      for (const dir of [1, -1] as const) {
        for (const coarse of [1, 5]) {
          const a = start();
          const b = start();
          for (let i = 0; i < 3; i++) {
            spot.turn?.(dir, a, coarse);
            turnHotspot(id, dir, b, coarse);
            expect(a, `${id} turn ${dir} x${coarse}`).toEqual(b);
            expect(spot.value(a), id).toBe(hotspotValue(id, b));
          }
        }
      }
      const a = start();
      const b = start();
      spot.toggle?.(a);
      toggleHotspot(id, b);
      expect(a, `${id} toggle`).toEqual(b);
      expect(spot.value(a), id).toBe(hotspotValue(id, b));
      spot.press?.(true, a);
      pressHotspot(id, true, b);
      expect(a, `${id} press`).toEqual(b);
      expect(spot.value(a), id).toBe(hotspotValue(id, b));
      // A knob turns, a switch toggles, a push button is pressed, and nothing else.
      expect([!!spot.turn, !!spot.toggle, !!spot.press], id).toEqual([spot.kind === 'knob', spot.kind === 'toggle', spot.kind === 'push']);
    }
  });

  it('marks the magneto key as the one knob with a spring-loaded step that does not repeat', () => {
    const special = buildHotspots(C172S_PANEL).filter((h) => h.springHold || h.noRepeat);
    expect(special.map((h) => h.id)).toEqual(['magnetos']);
    const key = special[0];
    expect(key.noRepeat).toBe(true);
    expect(key.springHold?.action).toBe('starter');
    const c = defaultControls();
    // Only from BOTH does a further clockwise click hold the starter.
    for (const magnetos of [0, 1, 2, 3] as const) {
      c.magnetos = magnetos;
      expect(key.springHold?.when(c), String(magnetos)).toBe(magnetos === 3);
    }
    c.starter = true;
    expect(key.value(c)).toBe('START');
  });

  it('follows the definition: places, switches, dimmers and the kind of ignition', () => {
    const at = (kind: GaugeDef['kind']): readonly [number, number] => (C172S_PANEL.gauges.find((g) => g.kind === kind) as { at: readonly [number, number] }).at;
    const moved: PanelDef = {
      ...C172S_PANEL,
      gauges: C172S_PANEL.gauges.map((g) => (g.kind === 'altimeter' ? { ...g, at: [g.at[0] + 100, g.at[1] - 50] } : g)),
      switchRow: {
        ...C172S_PANEL.switchRow,
        bounds: { ...C172S_PANEL.switchRow.bounds, x: 120 },
        switches: [
          ...C172S_PANEL.switchRow.switches.slice(0, 2),
          { id: 'carbHeat', label: 'CARB HEAT', name: 'Carburettor heat', x: 300, on: (c) => c.carbHeat > 0.5, toggle: (c) => void (c.carbHeat = c.carbHeat > 0.5 ? 0 : 1) },
        ],
        dimmers: undefined,
      },
      ignition: { kind: 'toggles', at: [78, 752], engines: 2 },
    };
    const spots = buildHotspots(moved);
    // No key: the magneto switches and the starter of each engine take its place.
    expect(spots.map((h) => h.id)).toEqual([
      'kollsman', 'headingBug', 'dgAlign', 'obs',
      'engine1MagnetoLeft', 'engine1MagnetoRight', 'engine2MagnetoLeft', 'engine2MagnetoRight', 'engine1Starter', 'engine2Starter',
      'alternator', 'battery', 'carbHeat',
    ]);
    const kollsman = spots[0];
    expect([kollsman.x, kollsman.y]).toEqual([at('altimeter')[0] + 100 - 70, at('altimeter')[1] - 50 + 72]);
    const carbHeat = spots[12];
    expect([carbHeat.kind, carbHeat.x, carbHeat.y, carbHeat.name]).toEqual(['toggle', 120 + 300, 745, 'Carburettor heat']);
    const c = defaultControls();
    expect(carbHeat.value(c)).toBe('OFF');
    carbHeat.toggle?.(c);
    expect(c.carbHeat).toBe(1);
    expect(carbHeat.value(c)).toBe('ON');
    // hotspotAt searches the list it is given; without one, the C172S list.
    expect(hotspotAt(carbHeat.x, carbHeat.y, spots)?.id).toBe('carbHeat');
    expect(hotspotAt(kollsman.x, kollsman.y, spots)?.id).toBe('kollsman');
    expect(hotspotAt(kollsman.x, kollsman.y)).toBeNull();
    expect(hotspotAt(78, 752, spots)?.id).toBe('engine1Starter');
    expect(hotspotAt(78, 752)?.id).toBe('magnetos');
  });
});

describe('InstrumentSet and the instrument systems definition', () => {
  const run = (set: InstrumentSet, seconds: number, s = makeMockState(), c = defaultControls()): void => {
    const w = defaultWeather();
    for (let t = 0; t < seconds; t += 0.02) set.step(0.02, s, c, w);
  };

  it('gauges the fuel through the tanks and the density of the definition', () => {
    const systems: InstrumentSystemsDef = {
      ...C172S_INSTRUMENT_SYSTEMS,
      // Twice as heavy a fuel, and the gauges the other way round.
      fuel: { kgPerGal: 2 * KG_PER_GAL, tanks: [(s) => s.fuel.right, (s) => s.fuel.left] },
    };
    const s = makeMockState();
    s.fuel.left = 30;
    s.fuel.right = 50;
    s.engine.fuelFlow = 0.01;
    const own = new InstrumentSet({ systems });
    const c172 = new InstrumentSet();
    run(own, 30, s);
    run(c172, 30, s);
    expect(c172.readings.fuelLeftGal).toBeCloseTo(30 / KG_PER_GAL, 3);
    expect(c172.readings.fuelRightGal).toBeCloseTo(50 / KG_PER_GAL, 3);
    expect(own.readings.fuelLeftGal).toBeCloseTo(50 / (2 * KG_PER_GAL), 3);
    expect(own.readings.fuelRightGal).toBeCloseTo(30 / (2 * KG_PER_GAL), 3);
    expect(own.readings.fuelFlowGph).toBeCloseTo(c172.readings.fuelFlowGph / 2, 6);
  });

  it('takes the dead-bus voltage, the lamp rules and the tach hour rate from the definition', () => {
    const systems: InstrumentSystemsDef = {
      ...C172S_INSTRUMENT_SYSTEMS,
      busDeadVolts: 9,
      tachHourRpm: Tachometer.HOUR_RPM / 2,
      // A 14 V system: its own low-voltage threshold, a low-fuel lamp that reads the first gauge, nothing else.
      lamps: [
        { id: 'lowVolts', lit: (i) => i.state.electrical.busVoltage < 12.5 },
        { id: 'lowFuelLeft', lit: (i) => i.fuelGal[0] < 3 },
      ],
    };
    const s = makeMockState({ rpm: 2400 });
    s.electrical.busVoltage = 12;
    s.fuel.left = 2 * KG_PER_GAL;
    s.engine.oilPressure = 0;
    const own = new InstrumentSet({ systems, tachHours: 100 });
    const c172 = new InstrumentSet({ tachHours: 100 });
    run(own, 60, s);
    run(c172, 60, s);
    // 12 V is a dead bus on the 28 V C172S and a live one here.
    expect(c172.readings.busPowered).toBe(false);
    expect(own.readings.busPowered).toBe(true);
    expect(own.readings.annunciators).toEqual({ lowFuelLeft: true, lowFuelRight: false, oilPress: false, lowVolts: true, vacuum: false });
    s.electrical.busVoltage = 13.8;
    s.fuel.left = 4 * KG_PER_GAL;
    run(own, 1, s);
    expect(own.readings.annunciators).toEqual({ lowFuelLeft: false, lowFuelRight: false, oilPress: false, lowVolts: false, vacuum: false });
    // The hour meter runs twice as fast at half the hour rpm (and this set has run a second longer).
    expect((own.readings.tachHours - 100) / (c172.readings.tachHours - 100)).toBeCloseTo((2 * 61) / 60, 2);
    expect(c172.readings.tachHours - 100).toBeCloseTo(60 / 3600, 4);
  });

  it('feeds the gyros from the pumps of the definition, and holds no suction without a vacuum system', () => {
    const pump = (inHg: number): InstrumentSystemsDef => ({
      ...C172S_INSTRUMENT_SYSTEMS,
      vacuum: { engines: [0], regulatedInHg: inHg, ratedInHg: inHg, suction: (rpm) => (rpm > 0 ? inHg : 0) },
    });
    const s = makeMockState({ rpm: 2300 });
    const weak = new InstrumentSet({ systems: pump(2), gyrosSpunUp: false });
    run(weak, 120, s);
    expect(weak.readings.suctionInHg).toBeCloseTo(2, 6);
    // 2 inHg is rated suction for this system's gyros: they are up to speed.
    expect(weak.attitude.rotor.spin).toBeGreaterThan(0.95);
    // The same suction on the C172S gyros (rated 4.5 inHg) leaves them slow.
    const c172Gyros = new InstrumentSet({ systems: { ...pump(2), vacuum: { ...pump(2).vacuum!, ratedInHg: 4.5 } }, gyrosSpunUp: false });
    run(c172Gyros, 120, s);
    expect(c172Gyros.attitude.rotor.spin).toBeLessThan(0.5);
    const none = new InstrumentSet({ systems: { ...C172S_INSTRUMENT_SYSTEMS, vacuum: null } });
    expect(none.readings.suctionInHg).toBe(0);
    run(none, 5, s);
    expect(none.readings.suctionInHg).toBe(0);
    none.reset(s);
    run(none, 1, s);
    expect(none.readings.suctionInHg).toBe(0);
  });

  it('reads the engine from engines[0] of the state', () => {
    const s = makeMockState({ rpm: 2400 });
    // A copy of the state (the render state, a restored snapshot) holds engines[0] by value.
    s.engines = [{ ...s.engine, rpm: 1500, oilPressure: 61 }];
    const set = new InstrumentSet();
    run(set, 20, s);
    expect(set.readings.rpm).toBeCloseTo(1500, 0);
    expect(set.readings.oilPressurePsi).toBeCloseTo(61, 1);
    // After a reset the gyros are spun up when an engine runs.
    s.engines[0].running = true;
    set.reset(s);
    expect(set.attitude.rotor.spin).toBe(1);
    s.engines[0].running = false;
    set.reset(s);
    expect(set.attitude.rotor.spin).toBe(0);
    run(set, 0.02, s);
    expect(set.readings.suctionInHg).toBeLessThan(1);
  });
});

describe('InstrumentPanel and the panel definition', () => {
  const built = (def?: PanelDef): { components: PanelComponent[]; panel: InstrumentPanel } => {
    stubCanvas();
    const panel = new InstrumentPanel(def ? { def } : {});
    return { components: (panel as unknown as { components: PanelComponent[] }).components, panel };
  };

  it('builds the C172S panel in the order it always drew it', () => {
    expect(built().components.map((c) => c.id)).toEqual([
      'asi', 'attitude', 'altimeter', 'turn', 'heading', 'vsi', 'cdi1', 'cdi2', 'clock', 'suction', 'ammeter', 'tach',
      'fuel', 'oil', 'egtff', 'annunciator', 'switches', 'flaps', 'gps', 'navcom2', 'xpdr',
    ]);
    expect(built(C172S_PANEL).components.map((c) => [c.id, c.bounds])).toEqual(built().components.map((c) => [c.id, c.bounds]));
  });

  it('builds one component per gauge of the definition, with its id and at its place', () => {
    const gauges: GaugeDef[] = [
      { kind: 'tach', id: 'rpm', at: [400, 300], size: 'large', marks: C172S_TACH_MARKS },
      { kind: 'asi', id: 'speed', at: [200, 300], marks: C172S_ASI_MARKS },
      { kind: 'suction', id: 'vac', at: [600, 300] },
      { kind: 'single', id: 'map', at: [750, 300], seed: 7, size: 'small', a0: -2, a1: 2, title: 'MANIFOLD', units: 'IN HG', labels: [10, 20, 30], scale: { ...C172S_SUCTION_SCALE, min: 10, max: 30 } },
      { kind: 'gps', id: 'nav', bounds: { x: 1000, y: 100, w: 320, h: 236 } },
    ];
    const def: PanelDef = { ...C172S_PANEL, gauges, annunciator: undefined, regions: { left: { x: 0, y: 0, w: 500, h: 800 } } };
    const { components, panel } = built(def);
    expect(components.map((c) => c.id)).toEqual(['rpm', 'speed', 'vac', 'map', 'switches', 'nav']);
    for (const g of gauges) {
      const b = components.find((c) => c.id === g.id)!.bounds;
      if ('at' in g) expect([b.x + b.w / 2, b.y + b.h / 2], g.id).toEqual(g.at);
      else expect(b, g.id).toEqual(g.bounds);
    }
    // 3-1/8" and 2-1/4" cases.
    expect(components.map((c) => c.bounds.w).slice(0, 4)).toEqual([184, 184, 132, 132]);
    expect(panel.regionRect('left')).toEqual({ x: 0, y: 0, w: 500, h: 800 });
    expect(panel.regionRect('sixpack')).toBeUndefined();
    expect(panel.regionRect('full')).toEqual({ x: 0, y: 0, w: 2080, h: 800 });
    expect(panel.regionRect('map')).toEqual(components[3].bounds);
  });

  it('has a component for the kinds and sizes the C172S panel does not use', () => {
    stubCanvas();
    const def: PanelDef = { ...C172S_PANEL, gauges: [{ kind: 'trimBar', id: 'pitchTrim', bounds: { x: 0, y: 0, w: 60, h: 200 }, axis: 'elevator' }] };
    expect(new InstrumentPanel({ def }).regionRect('pitchTrim')).toEqual({ x: 0, y: 0, w: 60, h: 200 });
    const small: PanelDef = { ...C172S_PANEL, gauges: [{ kind: 'tach', id: 'left', at: [100, 100], size: 'small', marks: C172S_TACH_MARKS }] };
    // A 2-1/4" case: 120 px bezel and its shadow margin.
    expect(new InstrumentPanel({ def: small }).regionRect('left')).toEqual({ x: 34, y: 34, w: 132, h: 132 });
  });
});

describe('gauge markings', () => {
  it('the C172S markings are the POH figures the gauge classes held', () => {
    const poh = C172.poh;
    expect(C172S_ASI_MARKS).toEqual({
      scaleKt: [0, 40, 60, 80, 100, 120, 140, 160, 180, 200, 215],
      scaleDeg: [0, 30, 74, 118, 158, 196, 233, 268, 300, 330, 348],
      tickFrom: 40,
      tickTo: 200,
      minorStep: 5,
      numberStep: 20,
      arcs: [
        { from: 48, to: 129, color: 'green' },
        { from: 129, to: 163, color: 'yellow' },
        { from: 40, to: 85, color: 'white', inner: true },
      ],
      redLine: 163,
    });
    expect([poh.vnoKias, poh.vneKias, poh.vfeKias]).toEqual([129, 163, 85]);
    expect(C172S_TACH_MARKS).toEqual({ max: 3500, majorStep: 500, minorStep: 100, numberStep: 500, arcs: [{ from: 2100, to: 2700, color: 'green' }], redLine: 2700, hourRpm: 2400 });
    expect(C172S_TACH_MARKS.hourRpm).toBe(C172S_INSTRUMENT_SYSTEMS.tachHourRpm);
    expect({ ...C172S_SUCTION_SCALE, read: null }).toEqual({ label: '', min: 2.6, max: 7, majors: [3, 4, 5, 6, 7], minorStep: 0.5, arcs: [{ from: 4.5, to: 5.5, color: 'green' }], read: null });
    expect({ ...C172S_AMMETER_SCALE, read: null }).toEqual({ label: '', min: -60, max: 60, majors: [-60, -30, 0, 30, 60], minorStep: 10, read: null });
    expect(C172S_ANNUNCIATOR_LAMPS.map((l) => [l.id, l.text, l.color])).toEqual([
      ['lowFuelLeft', 'L LOW FUEL', '#ffb21e'],
      ['oilPress', 'OIL PRESS', '#ff3b2a'],
      ['vacuum', 'LOW VAC', '#ffb21e'],
      ['lowVolts', 'LOW VOLTS', '#ff3b2a'],
      ['lowFuelRight', 'LOW FUEL R', '#ffb21e'],
    ]);
    // Each lamp shows the annunciator of its id.
    const set = new InstrumentSet();
    for (const lamp of C172S_ANNUNCIATOR_LAMPS) {
      const a = set.readings.annunciators;
      for (const on of [true, false]) {
        a[lamp.id as keyof typeof a] = on;
        expect(lamp.lit(set.readings), lamp.id).toBe(on);
      }
    }
  });

  it('the airspeed indicator letters and colours its dial from the markings it is given', () => {
    const c172 = stubCanvas();
    new AirspeedGauge('asi', 300, 300, 74, C172S_ASI_MARKS).draw(c172.g);
    expect(c172.texts).toEqual(['40', '60', '80', '100', '120', '140', '160', '180', '200', 'AIRSPEED', 'KNOTS']);
    for (const paint of [ARC_GREEN, ARC_YELLOW, ARC_WHITE, ARC_RED]) expect(c172.strokes).toContain(paint);
    expect(c172.strokes).not.toContain(ARC_BLUE);

    const other = stubCanvas();
    const marks = { ...C172S_ASI_MARKS, tickFrom: 30, tickTo: 150, numberStep: 30, arcs: [{ from: 35, to: 110, color: 'blue' as const }] };
    new AirspeedGauge('asi', 300, 300, 74, marks).draw(other.g);
    expect(other.texts).toEqual(['30', '60', '90', '120', '150', 'AIRSPEED', 'KNOTS']);
    expect(other.strokes).toContain(ARC_BLUE);
    expect(other.strokes).not.toContain(ARC_GREEN);
  });

  it('the tachometer numbers its dial in hundreds of rpm up to the maximum of its markings', () => {
    const c172 = stubCanvas();
    new TachometerGauge('tach', 300, 300, 74, C172S_TACH_MARKS).draw(c172.g);
    expect(c172.texts.slice(0, 8)).toEqual(['0', '5', '10', '15', '20', '25', '30', '35']);
    expect(c172.strokes).toContain(ARC_GREEN);
    const other = stubCanvas();
    new TachometerGauge('tach', 300, 300, 74, { ...C172S_TACH_MARKS, max: 3000, numberStep: 1000, arcs: [] }).draw(other.g);
    expect(other.texts.slice(0, 4)).toEqual(['0', '10', '20', '30']);
    expect(other.strokes).not.toContain(ARC_GREEN);
  });
});
