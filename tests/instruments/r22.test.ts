// R22 panel contract, indication sources and cockpit controls, independent of the developing rotor solver.
import { afterEach, describe, expect, it, vi } from 'vitest';
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
import { gaugeParts } from '../../src/instruments/panelParts';
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
  it('fits the shared canvas at real instrument diameters with usable hotspots', () => {
    expect(R22_PANEL.size).toEqual(PANEL_CANVAS);
    expect(panelLayoutProblems(R22_PANEL)).toEqual([]);
    expect(R22_PANEL.instrumentScale!.large * 172 / PANEL_PX_PER_M).toBeCloseTo(3.125 * 0.0254, 8);
    expect(R22_PANEL.instrumentScale!.small * 120 / PANEL_PX_PER_M).toBeCloseTo(2.25 * 0.0254, 8);
    const spots = buildHotspots(R22_PANEL);
    for (const spot of spots) expect(hotspotAt(spot.x, spot.y, spots)?.id).toBe(spot.id);
    expect(spots.some(h => h.id === 'rotorGovernor')).toBe(false);
    expect(R22_PANEL.gauges.some(g => ['attitude', 'heading', 'flapLever'].includes(g.kind))).toBe(false);
    const stub = stubCanvas();
    const panel = new InstrumentPanel({ def: R22_PANEL, systems: R22_INSTRUMENT_SYSTEMS });
    expect([panel.canvas.width, panel.canvas.height]).toEqual([1344, 720]);
    expect(panel.emissiveTexture.image.width).toBe(1344);
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
    s.rotorcraft!.clutchLight = true; s.rotorcraft!.lowRpmHorn = true;
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
    s.rotorcraft!.governorActive = true; s.rotorcraft!.governorThrottle = 0.99;
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
    for (const checklist of Object.values(R22_TRAINING.checklists)) expect(checklist.items).toEqual([]);
    const { s } = fixture();
    expect(R22_UI.hud.readouts.find(r => r.label === 'NR')!.text(s)).toBe('104.0%');
    expect(R22_UI.hud.readouts.find(r => r.label === 'ENG')!.text(s)).toBe('104.0%');
    expect(R22_UI.startupSteps.join(' ')).not.toMatch(/parking brake|flaps|F4 throttle full/i);
  });
});
