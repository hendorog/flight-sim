import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SimContext } from '../../src/core/context';
import { DEG } from '../../src/core/math';
import { makeMockState } from '../../src/core/mockState';
import { defaultControls, defaultWeather } from '../../src/core/types';
import { PANEL_CANVAS, PANEL_OUTLINE, PANEL_PX_PER_M } from '../../src/aircraft/r44/dimensions';
import { R44_ANNUNCIATOR_LAMPS, R44_INSTRUMENT_SYSTEMS, R44_PANEL } from '../../src/aircraft/r44/panel';
import { R44_ASI_MARKS, R44_ENGINE_SCALES, R44_MAP_SCALE, R44_TACH_MARKS } from '../../src/aircraft/r44/panelMarkings';
import { R44_LIMIT_PLACARDS } from '../../src/aircraft/r44/panelPlacards';
import { R44_REFERENCE as V } from '../../src/aircraft/r44/reference';
import { R44_TRAINING } from '../../src/aircraft/r44/training';
import { R44_UI } from '../../src/aircraft/r44/ui';
import { InstrumentSet } from '../../src/instruments/dynamics/instrumentSet';
import { buildHotspots, hotspotAt } from '../../src/instruments/hotspots';
import { InstrumentPanel } from '../../src/instruments/panel';
import type { Rect } from '../../src/instruments/panelDef';
import { panelLayoutProblems } from '../../src/instruments/panelLayout';
import { gaugeParts, panelParts } from '../../src/instruments/panelParts';
import type { PanelComponent } from '../../src/instruments/render/component';
import { RotorTachGauge } from '../../src/instruments/render/rotorTach';
import { emptyRotorcraftState } from '../../src/physics/rotorcraft/definition';
import { stubCanvas } from './stubCanvas';

function fixture() {
  const s = makeMockState(), c = defaultControls();
  s.rotorcraft = emptyRotorcraftState();
  s.engine.rpm = 2704.975; s.engine.running = true; s.engine.oilPressure = 70; s.engine.auxFuelPressure = 25;
  s.rotorcraft.rotorRpm = 406; s.rotorcraft.governorThrottle = 0.7;
  s.electrical.busVoltage = 28.2; s.electrical.batteryCharge = 1;
  s.fuel.left = 12 * V.kgPerGal; s.fuel.right = 5 * V.kgPerGal;
  c.rotorGovernor = true; c.rotorClutch = true; c.throttle = 0.8;
  const set = new InstrumentSet({ systems: R44_INSTRUMENT_SYSTEMS });
  const step = (seconds = 3) => {
    for (let t = 0; t < seconds; t += 1 / 60) set.step(1 / 60, s, c, defaultWeather());
    return set.readings;
  };
  return { s, c, set, step };
}

// The shared layout checker tests only the canvas rectangle, not the outline. Sample complete edges
// as well as corners so an item straddling the pod-to-pedestal notch cannot pass by accident.
function insideOutline(x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = PANEL_OUTLINE.length - 1; i < PANEL_OUTLINE.length; j = i++) {
    const [ax, ay] = PANEL_OUTLINE[i], [bx, by] = PANEL_OUTLINE[j];
    if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) inside = !inside;
  }
  return inside;
}
function expectInside(r: Rect, label: string): void {
  for (let i = 0; i <= 20; i++) {
    const t = i / 20;
    for (const [x, y] of [[r.x + t * r.w, r.y], [r.x + t * r.w, r.y + r.h],
      [r.x, r.y + t * r.h], [r.x + r.w, r.y + t * r.h]]) expect(insideOutline(x, y), `${label}: ${x},${y}`).toBe(true);
  }
}
const overlaps = (a: Rect, b: Rect): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
afterEach(() => vi.unstubAllGlobals());

describe('R44 eight-hole console', () => {
  it('fits real-size instruments, paint and click regions inside the frozen pod and narrow pedestal', () => {
    expect(R44_PANEL.size).toBe(PANEL_CANVAS);
    expect(R44_PANEL.background.outline).toBe(PANEL_OUTLINE);
    expect(panelLayoutProblems(R44_PANEL)).toEqual([]);
    expect(R44_PANEL.instrumentScale!.large * 172 / PANEL_PX_PER_M).toBeCloseTo(3.125 * 0.0254, 8);
    expect(R44_PANEL.instrumentScale!.small * 120 / PANEL_PX_PER_M).toBeCloseTo(2.25 * 0.0254, 8);
    for (const p of panelParts(R44_PANEL)) for (const r of p.paintRects ?? [p.rect]) expectInside(r, p.id);
    const spots = buildHotspots(R44_PANEL);
    for (const h of spots) {
      expectInside({ x: h.x - h.hw, y: h.y - h.hh, w: h.hw * 2, h: h.hh * 2 }, h.id);
      expect(hotspotAt(h.x, h.y, spots)?.id).toBe(h.id);
    }
    // Governor belongs to the collective; no fictitious hydraulic, pump or carb-heat panel switches.
    for (const id of ['rotorGovernor', 'hydraulics', 'fuelPump', 'carbHeat']) expect(spots.some(h => h.id === id)).toBe(false);
  });

  it('keeps every placard readable inside the face and clear of moving instruments and controls', () => {
    const parts = panelParts(R44_PANEL).flatMap(p => p.paintRects ?? [p.rect]);
    const placards: Rect[] = [];
    for (const p of R44_PANEL.background.placards) {
      const size = p.size ?? 7.5;
      const w = Math.max(...p.lines.map(l => l.length)) * size * 0.52 + 14;
      const r = { x: p.x - w / 2, y: p.y, w, h: p.lines.length * (size + 3) + 10 };
      expectInside(r, p.lines[0]);
      for (const other of [...parts, ...placards]) expect(overlaps(r, other), p.lines[0]).toBe(false);
      placards.push(r);
    }
  });

  it('renders all component bounds consistently and prints both complete placards', () => {
    const stub = stubCanvas();
    const panel = new InstrumentPanel({ def: R44_PANEL, systems: R44_INSTRUMENT_SYSTEMS });
    expect([panel.canvas.width, panel.canvas.height]).toEqual([1152, 1872]);
    const components = (panel as unknown as { components: PanelComponent[] }).components;
    for (const g of R44_PANEL.gauges) expect(components.find(c => c.id === g.id)?.bounds)
      .toEqual(gaugeParts(g, R44_PANEL.apertures, R44_PANEL.instrumentScale)[0].rect);
    expect(stub.texts).toContain('MAXIMUM CONTINUOUS POWER / OAT °C');
    expect(stub.texts).toContain('NF = NO FLIGHT / OVER 2200 LB: SUBTRACT 10 KIAS');
    expect(stub.texts).toContain('FOR AUTOROTATION: SUBTRACT 30 KIAS');
    expect(stub.texts).toContain('100 KIAS MAX: POWER ABOVE MCP OR ANY DOOR OFF');
    panel.dispose();
  });

  it('carries Raven II POH markings, including both overlapping MAP ranges and the 100-knot mark', () => {
    expect(R44_ASI_MARKS.arcs).toContainEqual({ from: 0, to: 110, color: 'green' });
    expect(R44_ASI_MARKS.arcs).toContainEqual({ from: 110, to: 130, color: 'yellow' });
    expect(R44_ASI_MARKS.redLine).toBe(130);
    expect(R44_ASI_MARKS.crossHatchedLine).toBe(100);
    expect(R44_ASI_MARKS.arcs.some(a => a.color === 'white')).toBe(false);
    expect(R44_TACH_MARKS.rotorArcs).toEqual([{ from: 90, to: 108, color: 'green' }]);
    expect(R44_TACH_MARKS.rotorRedLines).toEqual([90, 108]);
    expect(R44_TACH_MARKS.engineArcs).toContainEqual({ from: 101, to: 102, color: 'green' });
    expect(R44_TACH_MARKS.engineRedLines).toEqual([101, 102]);
    expect(R44_MAP_SCALE.arcs).toEqual([{ from: 15, to: 23.3, color: 'green' }, { from: 19.1, to: 26.1, color: 'yellow', inner: true }]);
    expect(R44_MAP_SCALE.redLines).toEqual([26.1]);
    expect(R44_ENGINE_SCALES.oilPressure.arcs).toEqual([{ from: 25, to: 55, color: 'yellow' },
      { from: 55, to: 95, color: 'green' }, { from: 95, to: 115, color: 'yellow' }]);
    expect(R44_ENGINE_SCALES.oilPressure.redLines).toEqual([25, 115]);
    expect(R44_ENGINE_SCALES.oilTemp.arcs).toEqual([{ from: 75, to: 245, color: 'green' }]);
    expect(R44_ENGINE_SCALES.oilTemp.redLines).toEqual([245]);
    expect(R44_ENGINE_SCALES.cht.arcs).toEqual([{ from: 200, to: 500, color: 'green' }]);
    expect(R44_ENGINE_SCALES.cht.redLines).toEqual([500]);
  });

  it('prints the POH 2-9 altitude/OAT tables with full-throttle and no-flight cells distinguished', () => {
    const cols = (y: number) => R44_LIMIT_PLACARDS.filter(p => p.y === y).map(p => p.lines);
    expect(cols(1417)[0]).toEqual(['ALT FT', 'SL', '2000', '4000', '6000', '8000', '10000', '12000']);
    expect(cols(1417)[1]).toEqual(['-30', '21.5', '20.9', '20.4', '19.9', '19.5', '19.1', 'FT']);
    expect(cols(1417)[8]).toEqual(['40', '23.3', '22.8', '22.2', '21.7', '21.3', 'FT', 'FT']);
    expect(cols(1599)[8]).toEqual(['40', '130', '123', '114', '103', '91', 'NF', 'NF', 'NF']);
    expect(R44_LIMIT_PLACARDS.flatMap(p => p.lines)).toContain('FT = FULL THROTTLE / 5 MIN TAKEOFF: ADD 2.8 IN HG');
  });

  it('joins at 101.5%, splits with the freewheel, and preserves the clutch-switch tach battery bypass', () => {
    const { s, c, step } = fixture();
    expect(step().rotorRpmPct).toBeCloseTo(101.5, 5);
    expect(step().engineRpmPct).toBeCloseTo(101.5, 5);
    s.engine.rpm = 1599; s.rotorcraft!.rotorRpm = 400;
    const r = step();
    expect(r.engineRpmPct).toBeCloseTo(60, 5); expect(r.rotorRpmPct).toBeCloseTo(100, 5);
    stubCanvas();
    const tach = new RotorTachGauge('tach', 100, 100, 74, R44_TACH_MARKS);
    expect(tach.angle(101.5)).toBe(-tach.angle(101.5, true));
    expect(Math.abs(tach.angle(r.engineRpmPct))).not.toBeCloseTo(Math.abs(tach.angle(r.rotorRpmPct, true)), 2);
    c.masterBattery = false; c.alternator = false; s.electrical.busVoltage = 0;
    expect(step().rotorRpmPct).toBeCloseTo(100, 5);
    c.rotorClutch = false; expect(step().rotorRpmPct).toBeCloseTo(0, 5);
    c.rotorClutch = true; s.electrical.batteryCharge = 0; expect(step().engineRpmPct).toBeCloseTo(0, 5);
  });

  it('reads main and auxiliary bladder tanks independently in usable US gallons', () => {
    const { s, step } = fixture();
    s.fuel.left = 29.5 * V.kgPerGal; s.fuel.right = 17 * V.kgPerGal;
    // Allow the shared 2.5-second sender lag to settle before checking the units.
    const r = step(40);
    expect(R44_ENGINE_SCALES.main.read(r)).toBeCloseTo(29.5, 3);
    expect(R44_ENGINE_SCALES.aux.read(r)).toBeCloseTo(17, 3);
    s.fuel.left = 2.9 * V.kgPerGal;
    expect(step().lamps.lowFuel).toBe(true); // A full auxiliary tank must not mask the main-tank float.
    s.fuel.left = 3.1 * V.kgPerGal; s.fuel.right = 0;
    expect(step().lamps.lowFuel).toBe(false);
  });

  it('uses actuator/light states directly and keeps governor selection distinct from acquisition', () => {
    const { s, c, step } = fixture();
    s.rotorcraft!.clutchEngagement = 0.4; s.rotorcraft!.clutchLight = false;
    s.rotorcraft!.governorActive = false; s.rotorcraft!.lowRpm = true; s.rotorcraft!.lowRpmHorn = false;
    let r = step();
    for (const id of ['clutch', 'govOff', 'lowRpm']) expect(r.lamps[id], id).toBe(false);
    s.rotorcraft!.clutchLight = true; s.rotorcraft!.lowRpmLight = true; c.rotorGovernor = false;
    r = step();
    for (const id of ['clutch', 'govOff', 'lowRpm']) expect(r.lamps[id], id).toBe(true);
  });

  it('shows supported warnings and tests all 16 lenses only with bus power', () => {
    const { s, c, step } = fixture();
    s.engine.oilPressure = 20; s.electrical.busVoltage = 24; c.starter = true;
    let r = step();
    for (const id of ['oil', 'alt', 'starter']) expect(r.lamps[id], id).toBe(true);
    const sensors = ['mrTemp', 'mrChip', 'trChip', 'co', 'brake', 'engineFire', 'fuelFilter', 'auxPump'];
    for (const id of sensors) expect(r.lamps[id], id).toBe(false);
    s.engine.auxFuelPressure = 0; expect(step().lamps.auxPump).toBe(true);
    s.engine.auxFuelPressure = 25; expect(step().lamps.auxPump).toBe(false);
    expect(R44_ANNUNCIATOR_LAMPS).toHaveLength(16);
    expect(R44_ANNUNCIATOR_LAMPS.filter(l => l.color === '#ff4538').map(l => l.id)).toEqual(['engineFire', 'oil']);
    const button = buildHotspots(R44_PANEL).find(h => h.id === 'lampTest')!;
    button.press!(true, c); r = step();
    for (const l of R44_ANNUNCIATOR_LAMPS) expect(l.lit(r), l.id).toBe(true);
    s.electrical.busVoltage = 0; r = step();
    for (const l of R44_ANNUNCIATOR_LAMPS) expect(l.lit(r), l.id).toBe(false);
    button.press!(false, c); s.electrical.busVoltage = 28.2;
    for (const id of sensors) expect(step().lamps[id], id).toBe(false);
  });

  it('reads full-throttle linkage even at idle, constrained by the pilot throttle', () => {
    const { s, c, step } = fixture();
    c.throttle = 1; s.rotorcraft!.governorActive = false; s.rotorcraft!.governorThrottle = 0.24;
    expect(step().lamps.fullThrottle).toBe(false);
    s.rotorcraft!.governorThrottle = 1; expect(step().lamps.fullThrottle).toBe(true);
    c.throttle = 0.4; expect(step().lamps.fullThrottle).toBe(false);
    c.throttle = 1; s.rotorcraft!.governorActive = true;
    expect(step().lamps.fullThrottle).toBe(true);
  });

  it('powers optional electric gyros without vacuum and lets them coast down after bus loss', () => {
    const { s, set, step } = fixture();
    expect(R44_PANEL.gauges.filter(g => g.kind === 'attitude' || g.kind === 'heading')).toHaveLength(2);
    expect(R44_INSTRUMENT_SYSTEMS.vacuum).toBeNull();
    s.engine.running = false; s.engine.rpm = 0;
    step(150); expect(set.attitude.rotor.spin).toBeGreaterThan(0.95);
    expect(set.heading.rotor.spin).toBeGreaterThan(0.95);
    s.electrical.busVoltage = 0; step(600);
    expect(set.attitude.rotor.spin).toBeLessThan(0.1); expect(set.heading.rotor.spin).toBeLessThan(0.1);
    const before = set.readings.headingDeg;
    s.heading += 30 * DEG;
    expect(Math.abs(step().headingDeg - before)).toBeLessThan(2);
  });

  it('operates the mixture guard, independent masters, clutch, key and radio power', () => {
    const c = defaultControls(); c.mixture = 1; c.rotorGovernor = true;
    const spots = new Map(buildHotspots(R44_PANEL).map(h => [h.id, h]));
    spots.get('mixture')!.turn!(1, c, 20); expect(c.mixture).toBe(1);
    spots.get('mixtureGuard')!.toggle!(c); spots.get('mixture')!.turn!(1, c, 20); expect(c.mixture).toBe(0);
    spots.get('mixture')!.turn!(-1, c, 20); expect(c.mixture).toBe(1);
    c.masterBattery = false; c.alternator = false;
    spots.get('battery')!.toggle!(c); expect(c.masterBattery).toBe(true); expect(c.alternator).toBe(false);
    spots.get('alternator')!.toggle!(c); expect(c.alternator).toBe(true);
    c.rotorClutch = false; spots.get('rotorClutch')!.toggle!(c);
    expect(c.rotorClutch).toBe(true); expect(c.rotorGovernor).toBe(true);
    c.magnetos = 0; const key = spots.get('magnetos')!;
    for (let i = 0; i < 3; i++) key.turn!(1, c, 1);
    expect(c.magnetos).toBe(3); expect(key.springHold!.when(c)).toBe(true);
    expect(key.springHold!.action).toBe('fuelPrime');
    c.avionics = false; spots.get('avionics')!.toggle!(c); expect(c.avionics).toBe(true);
  });

  it('does not erase gauges or placards when the distributed lights and clutch switch change', () => {
    const stub = stubCanvas();
    const panel = new InstrumentPanel({ def: R44_PANEL, systems: R44_INSTRUMENT_SYSTEMS });
    const { s, c } = fixture();
    const ctx = { state: s, controls: c, weather: defaultWeather(), simTime: 0, cameraMode: 'cockpit' } as SimContext;
    panel.update(0, ctx);
    const inner = panel as unknown as { g: typeof stub.g; components: PanelComponent[] };
    for (const comp of inner.components) if (!['annunciator', 'switches'].includes(comp.id)) comp.sample = () => false;
    const restored: Rect[] = [];
    inner.g = new Proxy(stub.g, { get: (target, key) => key === 'drawImage'
      ? (_image: unknown, x: number, y: number, w: number, h: number) => restored.push({ x, y, w, h }) : Reflect.get(target, key) });
    c.annunciatorTest = true; c.rotorClutch = false;
    panel.update(0, ctx);
    expect(restored.length).toBeGreaterThan(16);
    for (const r of restored) for (const [x, y] of [[680, 218], [600, 800], [550, 670], [576, 1470]]) {
      expect(x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h).toBe(false);
    }
    panel.dispose();
  });

  it('reports percent RPM, governor acquisition and actual clutch travel without inventing startup validation', () => {
    const { s, c } = fixture();
    expect(R44_UI.hud.readouts.find(r => r.label === 'NR')!.text(s)).toBe('101.5%');
    expect(R44_UI.hud.readouts.find(r => r.label === 'ENG')!.text(s)).toBe('101.5%');
    expect(R44_UI.hud.readouts.find(r => r.label === 'BUS')!.text(s)).toBe('28.2 V');
    const gov = R44_UI.hud.levers.find(l => l.label === 'GOV')!;
    expect(gov.text!(c, s)).toBe('ARMED'); s.rotorcraft!.governorActive = true;
    expect(gov.text!(c, s)).toBe('ACTIVE'); c.rotorGovernor = false;
    expect(gov.text!(c, s)).toBe('OFF');
    s.rotorcraft!.clutchEngagement = 0.4; s.rotorcraft!.clutchLight = true;
    const clutch = R44_UI.hud.levers.find(l => l.label === 'CLUTCH')!;
    expect(clutch.read(c, s)).toBe(0.4); expect(clutch.text!(c, s)).toBe('40% MOVING');
    expect(R44_UI.startupSteps.flat().join(' ')).toContain('cold start is not validated');
    expect(R44_TRAINING.name).toContain('placeholder'); expect(R44_TRAINING.school?.syllabus).toBe(false);
    for (const checklist of Object.values(R44_TRAINING.checklists)) expect(checklist.items).toEqual([]);
  });
});
