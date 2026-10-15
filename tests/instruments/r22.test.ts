// R22 panel contract, indication sources and cockpit controls, independent of the developing rotor solver.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fillSynthParams, makeParamBlock } from '../../src/audio/mapping';
import { P } from '../../src/audio/params';
import { R22_PRESENTATION } from '../../src/aircraft/r22/presentation';
import type { SimContext } from '../../src/core/context';
import type { PanelComponent } from '../../src/instruments/render/component';
import { PANEL_CANVAS, PANEL_PX_PER_M } from '../../src/aircraft/r22/dimensions';
import { R22_ASI_MARKS, R22_CAT_SCALE, R22_INSTRUMENT_SYSTEMS, R22_MAP_SCALE, R22_PANEL, R22_TACH_MARKS } from '../../src/aircraft/r22/panel';
import { R22_MAP_PLACARD } from '../../src/aircraft/r22/reference';
import { R22_TRAINING } from '../../src/aircraft/r22/training';
import { R22_UI } from '../../src/aircraft/r22/ui';
import { makeMockState } from '../../src/core/mockState';
import { copyControls, defaultControls, defaultWeather } from '../../src/core/types';
import { InstrumentSet } from '../../src/instruments/dynamics/instrumentSet';
import { buildHotspots, hotspotAt } from '../../src/instruments/hotspots';
import { InstrumentPanel } from '../../src/instruments/panel';
import { panelLayoutProblems } from '../../src/instruments/panelLayout';
import { gaugeParts, panelParts } from '../../src/instruments/panelParts';
import { AnnunciatorPanel } from '../../src/instruments/render/controls';
import { RotorTachGauge } from '../../src/instruments/render/rotorTach';
import { emptyRotorcraftState } from '../../src/physics/rotorcraft/definition';
import { stubCanvas } from './stubCanvas';

function fixture() {
  const s = makeMockState();
  s.rotorcraft = emptyRotorcraftState();
  s.engine.rpm = 2652;
  s.engine.running = true;
  s.engine.oilPressure = 70;
  s.rotorcraft.rotorRpm = 530.4;
  s.electrical.busVoltage = 14.2;
  s.electrical.batteryCharge = 1;
  s.fuel.left = 12 * 2.72155; s.fuel.right = 4 * 2.72155;
  const c = defaultControls();
  c.rotorGovernor = true; c.rotorClutch = true; c.throttle = 0.7;
  const set = new InstrumentSet({ systems: R22_INSTRUMENT_SYSTEMS });
  const step = (seconds = 3) => {
    for (let t = 0; t < seconds; t += 1 / 60) set.step(1 / 60, s, c, defaultWeather());
    return set.readings;
  };
  return { s, c, set, step };
}
afterEach(() => vi.unstubAllGlobals());

describe('R22 console', () => {
  it('keeps the complete operating placards clear of controls, gauges and each other', () => {
    const parts = panelParts(R22_PANEL).flatMap(p => p.paintRects ?? [p.rect]);
    for (const p of R22_PANEL.background.placards) {
      const size = p.size ?? 7.5, w = Math.max(...p.lines.map(l => l.length)) * size * 0.52 + 14;
      const r = { x: p.x - w / 2, y: p.y, w, h: p.lines.length * (size + 3) + 10 };
      for (const other of parts) expect(r.x < other.x + other.w && other.x < r.x + r.w
        && r.y < other.y + other.h && other.y < r.y + r.h, p.lines[0]).toBe(false);
      parts.push(r);
    }
  });
  it('fits the shared canvas at real instrument diameters with usable hotspots', () => {
    expect(R22_PANEL.size).toEqual(PANEL_CANVAS);
    expect(panelLayoutProblems(R22_PANEL)).toEqual([]);
    expect(R22_PANEL.instrumentScale!.large * 172 / PANEL_PX_PER_M).toBeCloseTo(3.125 * 0.0254, 8);
    expect(R22_PANEL.instrumentScale!.small * 120 / PANEL_PX_PER_M).toBeCloseTo(2.25 * 0.0254, 8);
    const spots = buildHotspots(R22_PANEL);
    for (const spot of spots) expect(hotspotAt(spot.x, spot.y, spots)?.id).toBe(spot.id);
    expect(spots.some(h => h.id === 'rotorGovernor')).toBe(false);
    // POH 7-19 seven-hole installation, with the two optional positions populated by electric gyros.
    expect(R22_PANEL.gauges.slice(0, 7).map(g => g.kind)).toEqual(['vsi', 'attitude', 'asi', 'rotorTach', 'altimeter', 'heading', 'single']);
    expect(R22_PANEL.gauges.some(g => g.kind === 'flapLever')).toBe(false);
    const stub = stubCanvas();
    const panel = new InstrumentPanel({ def: R22_PANEL, systems: R22_INSTRUMENT_SYSTEMS });
    expect([panel.canvas.width, panel.canvas.height]).toEqual([PANEL_CANVAS.w, PANEL_CANVAS.h]);
    expect((panel.emissiveTexture.image as { width: number }).width).toBe(PANEL_CANVAS.w);
    // Complete scaled artwork has precisely the bounds used by layout checking and dirty uploads.
    const components = (panel as unknown as { components: { id: string; bounds: unknown }[] }).components;
    for (const g of R22_PANEL.gauges) expect(components.find(c => c.id === g.id)?.bounds).toEqual(gaugeParts(g, R22_PANEL.apertures, R22_PANEL.instrumentScale)[0].rect);
    expect(stub.texts).toContain('VNE 102 KIAS TO 3000 FT DENSITY ALT');
    panel.dispose();
  });

  it('marks the O-360 Beta II operating ranges from the POH, including variable MAP limits', () => {
    expect(R22_ASI_MARKS.arcs).toEqual([{ from: 50, to: 102, color: 'green' }]);
    expect(R22_ASI_MARKS.redLine).toBe(102);
    for (const arcs of [R22_TACH_MARKS.rotorArcs, R22_TACH_MARKS.engineArcs]) {
      expect(arcs).toContainEqual({ from: 101, to: 104, color: 'green' });
      expect(arcs).toContainEqual({ from: 60, to: 70, color: 'yellow' });
    }
    expect(R22_TACH_MARKS.rotorRedLines).toEqual([90, 110]);
    expect(R22_MAP_SCALE.arcs).toEqual([{ from: 19.6, to: 24.1, color: 'yellow' }]);
    expect(R22_MAP_SCALE.redLines).toEqual([24.1]);
    expect(R22_MAP_PLACARD.values[0][2]).toBe(22.1);
    expect(R22_MAP_PLACARD.values[4][4]).toBe(20.9);
    expect(R22_MAP_PLACARD.takeoffIncrementInHg).toBe(0.9);
    expect(R22_CAT_SCALE.arcs).toEqual([{ from: -15, to: 5, color: 'yellow' }]);
    expect(R22_CAT_SCALE.signedNumbers).toBe(true);
  });

  it('joins at 104%, splits in autorotation and powers the tach through the clutch bypass', () => {
    const { s, c, step } = fixture();
    let r = step();
    expect(r.engineRpmPct).toBeCloseTo(104, 5);
    expect(r.rotorRpmPct).toBeCloseTo(104, 5);
    s.engine.rpm = 1400; s.rotorcraft!.rotorRpm = 510;
    r = step();
    expect(r.rotorRpmPct).toBeCloseTo(100, 5);
    expect(r.engineRpmPct).toBeCloseTo(1400 / 25.5, 5);
    stubCanvas();
    const tach = new RotorTachGauge('tach', 100, 100, 74, R22_TACH_MARKS);
    expect(tach.angle(104)).toBe(-tach.angle(104, true));
    expect(Math.abs(tach.angle(r.engineRpmPct))).not.toBeCloseTo(Math.abs(tach.angle(r.rotorRpmPct, true)), 2);
    c.masterBattery = false; c.alternator = false; s.electrical.busVoltage = 0;
    expect(step().rotorRpmPct).toBeCloseTo(100, 5);
    c.rotorClutch = false;
    expect(step().rotorRpmPct).toBeCloseTo(0, 5);
    c.rotorClutch = true; s.electrical.batteryCharge = 0;
    expect(step().engineRpmPct).toBeCloseTo(0, 5);
  });

  it('drives lamps from actual systems and test-illuminates unsupported sensors only with bus power', () => {
    const { s, c, step } = fixture();
    let r = step();
    for (const id of ['clutch', 'lowRpm', 'govOff', 'alt', 'starter', 'oil', 'lowFuel', 'mrTemp', 'mrChip', 'trChip', 'co', 'brake']) expect(r.lamps[id], id).toBe(false);
    s.rotorcraft!.clutchLight = true; s.rotorcraft!.lowRpmLight = true;
    s.rotorcraft!.governorActive = false; // governor armed at idle is not GOV OFF
    s.fuel.left = 1.6 * 2.72155;
    expect(step().lamps.lowFuel).toBe(false);
    s.fuel.left = 1.4 * 2.72155; s.fuel.right = 5 * 2.72155;
    s.engine.oilPressure = 0; s.electrical.busVoltage = 12;
    c.starter = true;
    r = step();
    for (const id of ['clutch', 'lowRpm', 'starter', 'oil', 'lowFuel', 'alt']) expect(r.lamps[id], id).toBe(true);
    expect(r.lamps.govOff).toBe(false);
    c.rotorGovernor = false;
    expect(step().lamps.govOff).toBe(true);
    c.throttle = 1; s.rotorcraft!.governorActive = true; s.rotorcraft!.governorThrottle = 0.99;
    expect(step().lamps.fullThrottle).toBe(true);
    const button = buildHotspots(R22_PANEL).find(h => h.id === 'lampTest')!;
    button.press!(true, c);
    r = step();
    for (const lamp of R22_PANEL.annunciator!.lamps!) expect(r.lamps[lamp.id], lamp.id).toBe(true);
    const stub = stubCanvas();
    const lamps = new AnnunciatorPanel(R22_PANEL.annunciator!.bounds, R22_PANEL.annunciator!.lamps, 13);
    lamps.sample(r); lamps.draw(stub.g); lamps.paintLightMask(stub.g);
    expect(stub.texts).toContain('CARBON MONOXIDE'); expect(stub.fills).toContain('#ffffff');
    button.press!(false, c); s.electrical.busVoltage = 0;
    for (const lamp of R22_PANEL.annunciator!.lamps!) expect(step().lamps[lamp.id], lamp.id).toBe(false);
  });

  it('reads the linkage opening at idle, under governor control and with a pilot throttle limit', () => {
    const { s, c, step } = fixture();
    c.throttle = 1; c.collective = 0;
    s.rotorcraft!.governorActive = false; s.rotorcraft!.governorThrottle = 0.24;
    expect(step().lamps.fullThrottle).toBe(false);
    s.rotorcraft!.governorActive = true;
    expect(step().lamps.fullThrottle).toBe(false);
    s.rotorcraft!.governorThrottle = 1;
    expect(step().lamps.fullThrottle).toBe(true);
    c.throttle = 0.4;
    expect(step().lamps.fullThrottle).toBe(false);
    c.rotorGovernor = false; c.throttle = 1;
    expect(step().lamps.fullThrottle).toBe(true);
    s.electrical.busVoltage = 0;
    expect(step().lamps.fullThrottle).toBe(false);
  });

  it('mutes the steady low-RPM horn independently of the lamp at collective down', () => {
    const { s, c, step } = fixture();
    const x = { surface: 'runway' as const, speedOfSound: 340, turbulence: 0, gyroSpin: 0, flapMotor: 0 };
    const sound = () => fillSynthParams(s, c, x, makeParamBlock(), R22_PRESENTATION.audio)[P.horn];
    s.rotorcraft!.lowRpm = true; s.rotorcraft!.lowRpmLight = true; s.rotorcraft!.lowRpmHorn = false;
    expect(sound()).toBe(0); expect(step().lamps.lowRpm).toBe(true);
    s.rotorcraft!.lowRpm = true; s.rotorcraft!.lowRpmHorn = true; s.ias = 0;
    expect(sound()).toBe(1); expect(step().lamps.lowRpm).toBe(true);
    s.electrical.busVoltage = 0;
    expect(sound()).toBe(0); expect(step().lamps.lowRpm).toBe(false);
    expect(R22_PRESENTATION.audio.stallWarner).toMatchObject({ kind: 'electric', sweepHz: 0 });
  });

  it('does not erase intervening instruments when distributed lights or switches redraw', () => {
    const stub = stubCanvas();
    const panel = new InstrumentPanel({ def: R22_PANEL, systems: R22_INSTRUMENT_SYSTEMS });
    const { s, c } = fixture();
    const ctx = { state: s, controls: c, weather: defaultWeather(), simTime: 0, cameraMode: 'cockpit' } as SimContext;
    panel.update(0, ctx);
    const inner = panel as unknown as { g: typeof stub.g; components: PanelComponent[] };
    // Freeze other components so the only restored rectangles belong to the changing warning/switch group.
    for (const comp of inner.components) if (!['annunciator', 'switches'].includes(comp.id)) comp.sample = () => false;
    const restored: number[][] = [];
    inner.g = new Proxy(stub.g, { get: (target, key) => key === 'drawImage'
      ? (_image: unknown, ...args: number[]) => restored.push(args) : Reflect.get(target, key) });
    c.annunciatorTest = true; c.rotorClutch = false;
    panel.update(0, ctx);
    expect(restored.length).toBeGreaterThan(13);
    for (const [x, y, w, h] of restored) {
      // Neither the ASI nor the engine cluster is inside a control's dirty rectangle.
      for (const [gx, gy] of [[408, 188], [480, 650], [275, 815]]) expect(gx >= x && gx <= x + w && gy >= y && gy <= y + h).toBe(false);
    }
    panel.dispose();
  });

  it('handles absent rotorcraft state and accumulates hours only with the engine running', () => {
    const { s, step } = fixture();
    s.rotorcraft = undefined; s.engine.rpm = 1275;
    let r = step(36);
    expect(r.rotorRpmPct).toBe(0);
    expect(r.engineHours).toBeCloseTo(0.01, 4);
    expect(r.tachHours).not.toBeCloseTo(r.engineHours, 3);
    s.engine.running = false; s.engine.rpm = 0;
    const hours = r.engineHours;
    expect(step(3).engineHours).toBe(hours);
  });

  it('operates mixture guard, continuous heat knobs, clutch and ignition without changing governor selection', () => {
    const c = defaultControls(); c.mixture = 1; c.rotorGovernor = true;
    const spots = new Map(buildHotspots(R22_PANEL).map(h => [h.id, h]));
    spots.get('mixture')!.turn!(1, c, 20);
    expect(c.mixture).toBe(1);
    spots.get('mixtureGuard')!.toggle!(c);
    spots.get('mixture')!.turn!(1, c, 20);
    expect(c.mixture).toBe(0);
    spots.get('carbHeat')!.turn!(1, c, 10);
    expect(c.carbHeat).toBe(0.5);
    spots.get('cabinHeat')!.turn!(1, c, 20);
    expect(c.cabinHeat).toBe(1);
    c.rotorClutch = false; spots.get('rotorClutch')!.toggle!(c);
    expect(c.rotorClutch).toBe(true); expect(c.rotorGovernor).toBe(true);
    const key = spots.get('magnetos')!;
    c.magnetos = 0;
    for (let i = 0; i < 3; i++) key.turn!(1, c, 1);
    expect(key.springHold!.when(c)).toBe(true); expect(key.springHold!.action).toBe('starter');
    c.annunciatorTest = true;
    copyControls(c, defaultControls());
    expect(c).toMatchObject({ cabinHeat: 0, mixtureGuardOpen: false, annunciatorTest: false });
  });

  it('publishes helicopter identity, no airplane checklists, and sensible HUD units', () => {
    expect(R22_TRAINING.classRating).toBeNull();
    expect(R22_TRAINING.vspeeds).toMatchObject({ Vy: 53, Vglide: 75, Vne: 102, Vfe10: 0, VfeFull: 0, Vno: 0 });
    expect(R22_TRAINING.checklists.hasell.items).toEqual([]);
    expect(R22_TRAINING.checklists.engineStart.items.some(i => i.id === 'engage')).toBe(true);
    expect(R22_TRAINING.checklists.engineFailure.items.some(i => i.id === 'glide')).toBe(true);
    const { s } = fixture();
    expect(R22_UI.hud.readouts.find(r => r.label === 'NR')!.text(s)).toBe('104.0%');
    expect(R22_UI.hud.readouts.find(r => r.label === 'ENG')!.text(s)).toBe('104.0%');
    expect(R22_UI.startupSteps.join(' ')).not.toMatch(/parking brake|flaps|F4 throttle full/i);
  });
});
