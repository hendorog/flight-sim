import { afterEach, describe, expect, it, vi } from 'vitest';
import { S269_ANNUNCIATOR_LAMPS, S269_INSTRUMENT_SYSTEMS, S269_PANEL } from '../../src/aircraft/s269/panel';
import { S269_ASI_MARKS, S269_ENGINE_RPM, S269_ROTOR_RPM, S269_ENGINE_SCALES as E, S269_MAP_SCALE,
  S269_DISENGAGED_RPM, s269EngineRpm, s269RotorRpm } from '../../src/aircraft/s269/panelMarkings';
import { S269_VNE_PLACARDS } from '../../src/aircraft/s269/panelPlacards';
import { S269AbsoluteTach, s269TachAngle } from '../../src/aircraft/s269/panelTach';
import { PANEL_CANVAS, PANEL_FACE, PANEL_OUTLINE, PANEL_PX_PER_M } from '../../src/aircraft/s269/dimensions';
import { S269_REFERENCE as V } from '../../src/aircraft/s269/reference';
import { S269_UI } from '../../src/aircraft/s269/ui';
import { S269_TRAINING } from '../../src/aircraft/s269/training';
import { makeMockState } from '../../src/core/mockState';
import { defaultControls, defaultWeather } from '../../src/core/types';
import type { SimContext } from '../../src/core/context';
import { emptyRotorcraftState } from '../../src/physics/rotorcraft/definition';
import { InstrumentSet } from '../../src/instruments/dynamics/instrumentSet';
import { InstrumentPanel } from '../../src/instruments/panel';
import { buildHotspots, hotspotAt } from '../../src/instruments/hotspots';
import { panelLayoutProblems } from '../../src/instruments/panelLayout';
import { gaugeParts, panelParts } from '../../src/instruments/panelParts';
import type { PanelComponent, Rect } from '../../src/instruments/render/component';
import { stubCanvas } from './stubCanvas';
import { run } from './testbed';

function fixture() {
  const s = makeMockState();
  s.rotorcraft = emptyRotorcraftState();
  s.engine.rpm = 2700; s.engine.running = true; s.rotorcraft.rotorRpm = 471;
  s.electrical.busVoltage = 28.2; s.fuel.left = 32.5 * V.kgPerGal;
  const c = defaultControls(); c.rotorClutch = true;
  const set = new InstrumentSet({ systems: S269_INSTRUMENT_SYSTEMS });
  const step = (seconds = 5) => { run(set, seconds, s, c); return set.readings; };
  return { s, c, set, step };
}
afterEach(() => vi.unstubAllGlobals());

const overlaps = (a: Rect, b: Rect): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe('300CB carburetted alternate panel', () => {
  it('keeps the frozen face, true instrument diameters, paint regions and click targets aligned', () => {
    expect(S269_PANEL.size).toBe(PANEL_CANVAS); expect(S269_PANEL.background.outline).toBe(PANEL_OUTLINE);
    expect(PANEL_CANVAS.w / PANEL_PX_PER_M).toBe(PANEL_FACE.width);
    expect(PANEL_CANVAS.h / PANEL_PX_PER_M).toBe(PANEL_FACE.height);
    expect(S269_PANEL.instrumentScale!.large * 172 / PANEL_PX_PER_M).toBeCloseTo(3.125 * 0.0254);
    expect(panelLayoutProblems(S269_PANEL)).toEqual([]);
    const hotspots = buildHotspots(S269_PANEL);
    for (const h of hotspots) expect(hotspotAt(h.x, h.y, hotspots)?.id).toBe(h.id);
    stubCanvas();
    const panel = new InstrumentPanel({ def: S269_PANEL, systems: S269_INSTRUMENT_SYSTEMS });
    const components = (panel as unknown as { components: PanelComponent[] }).components;
    for (const g of S269_PANEL.gauges) expect(components.find(c => c.id === g.id)?.bounds)
      .toEqual(gaugeParts(g, S269_PANEL.apertures, S269_PANEL.instrumentScale)[0].rect);
    panel.dispose();
  });

  it('keeps printed placards clear of dynamic paint rectangles', () => {
    const parts = panelParts(S269_PANEL).flatMap(p => p.paintRects ?? [p.rect]);
    for (const p of S269_PANEL.background.placards) {
      const size = p.size ?? 7.5;
      const w = Math.max(...p.lines.map(l => l.length)) * size * 0.52 + 14;
      const box = { x: p.x - w / 2, y: p.y, w, h: p.lines.length * (size + 3) + 10 };
      expect(box.x, p.lines.join(' ')).toBeGreaterThanOrEqual(0);
      expect(box.x + box.w).toBeLessThanOrEqual(PANEL_CANVAS.w);
      expect(box.y + box.h).toBeLessThanOrEqual(PANEL_CANVAS.h);
      for (const b of parts) expect(overlaps(box, b), p.lines.join(' ')).toBe(false);
    }
  });

  it('uses the RFM carburetted markings, including the idle arc, oil lower radial and CHT caution', () => {
    expect(S269_ASI_MARKS.redLine).toBe(94); expect(S269_ASI_MARKS.arcs).toEqual([]);
    expect(S269_ENGINE_RPM.arcs).toEqual([{ from: 1200, to: 1600, color: 'green' }, { from: 2530, to: 2700, color: 'green' }]);
    expect(S269_ENGINE_RPM.redLines).toEqual([2530, 2700]); expect(S269_DISENGAGED_RPM).toBe(1600);
    expect(S269_ROTOR_RPM.arcs).toEqual([{ from: 390, to: 504, color: 'green' }]);
    expect(S269_ROTOR_RPM.redLines).toEqual([390, 504]);
    expect(E.oilPressure.redLines).toEqual([55, 115]); expect(E.oilPressure.arcs).toEqual([{ from: 55, to: 95, color: 'green' }]);
    expect(E.oilTemp.arcs).toEqual([{ from: 100, to: 245, color: 'green' }]); expect(E.oilTemp.redLines).toEqual([245]);
    expect(E.cht.arcs).toEqual([{ from: 230, to: 450, color: 'green' }, { from: 450, to: 500, color: 'yellow' }]);
    expect(E.cht.redLines).toEqual([500]); expect(E.carb.arcs).toEqual([{ from: -15, to: 5, color: 'yellow' }]);
    expect([E.amps.min, E.amps.max]).toEqual([-70, 70]); expect(E.fuel.max).toBe(32.5);
    expect(S269_MAP_SCALE.arcs).toBeUndefined(); expect(S269_MAP_SCALE.redLines).toBeUndefined();
    expect(S269_PANEL.gauges.some(g => g.kind === 'rotorTach' || g.kind === 'attitude' || g.kind === 'heading')).toBe(false);
  });

  it('prints every original Vne table cell without the interpolated 2000-ft column', () => {
    const columns = S269_VNE_PLACARDS.filter(p => p.y === 722).map(p => p.lines);
    expect(columns.map(c => c[0])).toEqual(['OAT °F', '0', '4', '6', '8', '10', '12']);
    expect(columns[0].slice(1)).toEqual(['0', '20', '40', '60', '80', '100', '120']);
    const rows = Array.from({ length: 7 }, (_, j) => columns.slice(1).map(c => c[j + 1]).join(' '));
    expect(rows).toEqual(['94 94 94 94 83 63', '94 94 94 92 73 53', '94 94 94 82 62 —',
      '94 94 91 71 53 —', '94 94 82 61 — —', '94 92 73 53 — —', '94 85 64 — — —']);
    expect(S269_VNE_PLACARDS.flatMap(p => p.lines)).toContain('MAX VNE DOORS OFF 90 KTS IAS');
  });

  it('reads independent absolute shaft RPM and superimposes the prepared coaxial tach only when coupled', () => {
    const { s, step } = fixture();
    let r = step();
    expect(s269EngineRpm(r)).toBeCloseTo(2700, 5); expect(s269RotorRpm(r)).toBeCloseTo(471, 5);
    expect(s269TachAngle(s269EngineRpm(r))).toBeCloseTo(s269TachAngle(s269RotorRpm(r), true), 10);
    s.engine.rpm = 1500; s.rotorcraft!.rotorRpm = 450; r = step();
    expect(s269EngineRpm(r)).toBeCloseTo(1500, 5); expect(s269RotorRpm(r)).toBeCloseTo(450, 5);
    expect(Math.abs(s269TachAngle(s269EngineRpm(r)) - s269TachAngle(s269RotorRpm(r), true))).toBeGreaterThan(1);
    const stub = stubCanvas(); const tach = new S269AbsoluteTach('tach', 100, 100, 74);
    expect(tach.sample(r)).toBe(true); tach.draw(stub.g); expect(tach.sample(r)).toBe(false);
    for (const label of ['ENGINE', 'ROTOR', 'RPM', '×100', '35', '6']) expect(stub.texts).toContain(label);
    expect(stub.texts).not.toContain('% RPM');
    s.electrical.busVoltage = 0; r = step();
    expect(s269EngineRpm(r)).toBeCloseTo(0, 5); expect(s269RotorRpm(r)).toBeCloseTo(0, 5);
    expect(tach.sample(r)).toBe(true);
  });

  it('shows usable main-tank quantity and the independent one-gallon low-fuel switch', () => {
    const { s, step } = fixture();
    expect(E.fuel.read(step(40))).toBeCloseTo(32.5, 4);
    s.fuel.left = 0.99 * V.kgPerGal; s.fuel.right = 40 * V.kgPerGal;
    expect(step().lamps.lowFuel).toBe(true);
    s.fuel.left = 1.01 * V.kgPerGal; s.fuel.right = 0;
    expect(step().lamps.lowFuel).toBe(false);
  });

  it('does not relabel actuator, engine oil or low-RPM state as missing Schweizer sensors', () => {
    const { s, c, step } = fixture();
    s.rotorcraft!.clutchLight = true; s.rotorcraft!.clutchEngagement = 0;
    s.rotorcraft!.lowRpmHorn = true; s.engine.oilPressure = 0; s.engine.oilTemp = 150;
    s.electrical.busVoltage = 24;
    let r = step(); expect(r.lamps.lowVolts).toBe(true);
    for (const id of ['mrTransmission', 'trChip', 'clutchDisengaged']) expect(r.lamps[id]).toBe(false);
    expect(S269_ANNUNCIATOR_LAMPS.filter(l => l.color === '#ff4538').map(l => l.id)).toEqual(['mrTransmission', 'clutchDisengaged']);
    expect(Object.keys(r.lamps).some(k => ['lowRpm', 'govOff', 'mrChip', 'oil'].includes(k))).toBe(false);
    c.annunciatorTest = true; r = step();
    expect(S269_ANNUNCIATOR_LAMPS.every(l => l.lit(r))).toBe(true);
    s.electrical.busVoltage = 0; r = step();
    expect(S269_ANNUNCIATOR_LAMPS.every(l => !l.lit(r))).toBe(true);
    c.annunciatorTest = false; s.electrical.busVoltage = 28.2;
    expect(step().lamps.lowVolts).toBe(false);
  });

  it('drives estimated CAT and electrical needles from the same 28 V bus', () => {
    const { s, c, step } = fixture(); s.oat = 288.15; c.carbHeat = 0;
    expect(E.carb.read(step(40))).toBeCloseTo(-5, 3);
    c.carbHeat = 1; expect(E.carb.read(step(40))).toBeCloseTo(40, 3);
    s.electrical.busVoltage = 0; const r = step(40);
    expect(E.fuel.read(r)).toBeCloseTo(0, 3); expect(E.carb.read(r)).toBeCloseTo(-40, 3);
    // MAP and pitot/static are direct-reading, not switched off with the bus.
    s.engine.manifoldPressure = 20; expect(S269_MAP_SCALE.read(step())).toBeCloseTo(20, 3);
  });

  it('operates one-detent fuel shutoff, proportional knobs, masters, test and START with guarded ENGAGE/HOLD/RELEASE', () => {
    const c = defaultControls(); c.mixture = 1; c.carbHeat = 0; c.fuelSelector = 'both';
    const h = new Map(buildHotspots(S269_PANEL).map(h => [h.id, h]));
    h.get('mixture')!.turn!(1, c, 1); expect(c.mixture).toBeCloseTo(0.95);
    h.get('carbHeat')!.turn!(1, c, 5); expect(c.carbHeat).toBeCloseTo(0.25);
    h.get('fuelShutoff')!.turn!(1, c, 1); expect(c.fuelSelector).toBe('off');
    h.get('fuelShutoff')!.turn!(1, c, 1); expect(c.fuelSelector).toBe('off');
    h.get('fuelShutoff')!.turn!(-1, c, 1); expect(c.fuelSelector).toBe('both');
    c.masterBattery = false; c.alternator = false;
    h.get('battery')!.toggle!(c); expect(c.masterBattery).toBe(true); expect(c.alternator).toBe(false);
    h.get('alternator')!.toggle!(c); expect(c.alternator).toBe(true);
    h.get('lampTest')!.press!(true, c); expect(c.annunciatorTest).toBe(true);
    h.get('lampTest')!.press!(false, c); expect(c.annunciatorTest).toBe(false);
    expect(h.get('magnetos')!.springHold!.action).toBe('starter');
    expect([...h.keys()].some(k => /governor/i.test(k))).toBe(false);
    c.rotorClutchCommand = 'engage'; c.rotorClutchGuardOpen = false;
    h.get('rotorClutch1')!.toggle!(c); expect(c.rotorClutchCommand).toBe('engage');
    h.get('rotorClutchGuard')!.toggle!(c);
    h.get('rotorClutch1')!.toggle!(c); expect(c.rotorClutchCommand).toBe('hold');
    h.get('rotorClutch2')!.toggle!(c); expect(c.rotorClutchCommand).toBe('release');
    h.get('rotorClutchGuard')!.toggle!(c); expect(c.rotorClutchCommand).toBe('engage');
    expect(h.get('trimLeft')!.hold!.action).toBe('cyclicTrimLeft');
  });

  it('does not erase gauges or placards when distributed lamps and switches redraw', () => {
    const stub = stubCanvas(); const { s, c } = fixture();
    const panel = new InstrumentPanel({ def: S269_PANEL, systems: S269_INSTRUMENT_SYSTEMS });
    const ctx = { state: s, controls: c, weather: defaultWeather(), simTime: 0, cameraMode: 'cockpit' } as SimContext;
    panel.update(0, ctx);
    const inner = panel as unknown as { g: typeof stub.g; components: PanelComponent[] };
    for (const comp of inner.components) if (!['annunciator', 'switches'].includes(comp.id)) comp.sample = () => false;
    const restored: Rect[] = [];
    inner.g = new Proxy(stub.g, { get: (target, key) => key === 'drawImage'
      ? (_image: unknown, x: number, y: number, w: number, h: number) => restored.push({ x, y, w, h }) : Reflect.get(target, key) });
    c.annunciatorTest = true; c.rotorClutchCommand = 'release'; c.rotorClutchGuardOpen = true; c.lights.nav = !c.lights.nav; panel.update(0, ctx);
    expect(restored.length).toBeGreaterThan(5);
    for (const box of restored) for (const [x, y] of [[180, 255], [960, 255], [858, 722], [1000, 1110], [622, 1030]])
      expect(x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h).toBe(false);
    panel.dispose();
  });

  it('reports absolute RPM, actual belt travel and limits without inherited Robinson startup guidance', () => {
    const { s, c } = fixture(); s.rotorcraft!.clutchEngagement = 0.4; s.rotorcraft!.clutchLight = true;
    expect(S269_UI.hud.readouts.find(r => r.label === 'NR')!.text(s)).toBe('471 RPM');
    expect(S269_UI.hud.readouts.find(r => r.label === 'ENG')!.text(s)).toBe('2700 RPM');
    expect(S269_UI.hud.levers.find(l => l.label === 'BELT')!.text!(c, s)).toBe('40% MOVING');
    expect(S269_UI.hud.levers.some(l => l.label === 'GOV')).toBe(false);
    expect(S269_UI.startupSteps.flat().join(' ')).toContain('No guided start');
    expect(S269_UI.starterAdvice(c, 0)).toContain('not validated');
    expect(S269_TRAINING.school?.syllabus).toBe(false); expect(S269_TRAINING.name).toContain('in development');
    expect(S269_TRAINING.unavailableVSpeeds).toContain('Vapp');
    for (const checklist of Object.values(S269_TRAINING.checklists)) expect(checklist.items).toEqual([]);
  });
});
