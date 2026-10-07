// The UI of a twin, on the synthetic twin of src/ui/testbed.ts: the HUD shows its two lever sets, its
// per-engine read-outs, the gear chip and the Vyse / Vmca marks; the control-position widget marks the selected
// engine and dims the other engine's levers; the hints card carries the type's own rows. The Cessna 172S's HUD
// keeps exactly its four bars and one read-out. Built on a stand-in DOM (fakeDom.ts).

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import C172S_DEFINITION from '../../src/aircraft/c172s/index';
import { C172S_UI } from '../../src/aircraft/c172s/ui';
import type { AircraftDefinition } from '../../src/aircraft/types';
import type { SimContext } from '../../src/core/context';
import { makeMockEnvironment, makeMockState } from '../../src/core/mockState';
import { defaultControls, defaultWeather, setEngineControl, type AircraftState, type ControlInputs } from '../../src/core/types';
import { Hud, type HudAircraft } from '../../src/ui/hud';
import { HintsCard } from '../../src/ui/overlays';
import { ControlsWidget } from '../../src/ui/status';
import { TWIN_TESTBED_UI, twinTestbedDefinition } from '../../src/ui/testbed';
import { FakeElement, installFakeDom } from './fakeDom';
import { vi } from 'vitest';

beforeAll(installFakeDom);
afterAll(() => vi.unstubAllGlobals());

const TWIN: AircraftDefinition = twinTestbedDefinition(C172S_DEFINITION);

function hudAircraft(def: AircraftDefinition, ui = TWIN_TESTBED_UI): HudAircraft {
  return {
    ui,
    reference: def.reference,
    restHeight: def.geometry.restHeight,
    limits: def.limits,
    flapDetents: def.controls.flaps.detents,
    engines: def.engineCount,
    carbHeat: def.input.has.carbHeat,
  };
}

function twinContext(): { ctx: SimContext; s: AircraftState; c: ControlInputs } {
  const s = makeMockState({ engines: 2, heightAGL: 300, tas: 50 });
  s.engines[0].rpm = 2500;
  s.engines[1].rpm = 2210;
  s.gear = { retractable: true, lever: 'down', extension: [1, 1, 1], locked: [true, true, true], inTransit: false, warning: false };
  const c = defaultControls(TWIN);
  c.throttle = 1;
  setEngineControl(c, 1, 'throttle', 0.6);
  setEngineControl(c, 1, 'propeller', 0.8);
  const ctx = { state: s, controls: c, env: makeMockEnvironment(), simTime: 0, weather: defaultWeather(), engineSelection: 0 } as unknown as SimContext;
  return { ctx, s, c };
}

/** The HUD's lever / read-out grid as rows of [label, value]. */
function controlRows(parent: FakeElement): [string, string][] {
  const grid = parent.findAll('controls')[0];
  const rows: [string, string][] = [];
  for (let i = 0; i < grid.children.length; i += 3) rows.push([grid.children[i].textContent, grid.children[i + 2].textContent]);
  return rows;
}

const chipTexts = (parent: FakeElement): string[] =>
  parent.findAll('chip').filter((c) => !c.classList.contains('hidden')).map((c) => c.textContent);

describe('the HUD of a twin', () => {
  it('shows a lever per engine for throttle, propeller and mixture, and each engine\'s rpm', () => {
    const parent = new FakeElement('div');
    const hud = new Hud(parent as unknown as HTMLElement);
    hud.setAircraft(hudAircraft(TWIN));
    const { ctx } = twinContext();
    hud.update(1 / 60, ctx);
    expect(controlRows(parent)).toEqual([
      ['THR L', '100%'],
      ['THR R', '60%'],
      ['PROP L', '100%'],
      ['PROP R', '80%'],
      ['MIX L', '100%'],
      ['MIX R', '100%'],
      ['FLAPS', '0°'],
      ['TRIM', '0%'],
      ['R TRIM', '0%'],
      ['RPM L', '2500'],
      ['RPM R', '2210'],
    ]);
    // The bars stand where the levers are: the right throttle at 60 %.
    const bars = parent.findAll('bar');
    expect(bars[1].children[0].style.width).toBe('60%');
    expect(bars[5].className).toBe('bar mix');
    expect(bars[8].className).toBe('bar trim');
  });

  it('shows three greens with the gear down and locked, IN TRANSIT while it moves, and nothing when up', () => {
    const parent = new FakeElement('div');
    const hud = new Hud(parent as unknown as HTMLElement);
    hud.setAircraft(hudAircraft(TWIN));
    const { ctx, s } = twinContext();
    hud.update(1 / 60, ctx);
    expect(chipTexts(parent)).toEqual(['GEAR ● ● ●']);
    s.gear = { ...s.gear, lever: 'up', extension: [0.5, 0.6, 0.6], locked: [false, false, false], inTransit: true };
    hud.update(1 / 60, ctx);
    expect(chipTexts(parent)).toEqual(['GEAR IN TRANSIT']);
    s.gear = { ...s.gear, extension: [0, 0, 0], inTransit: false };
    hud.update(1 / 60, ctx);
    expect(chipTexts(parent)).toEqual([]);
  });

  it('warns GEAR SPEED after the rule\'s time above Vle, and FLAP SPEED above the detent\'s limit', () => {
    const parent = new FakeElement('div');
    const hud = new Hud(parent as unknown as HTMLElement);
    hud.setAircraft(hudAircraft(TWIN));
    const { ctx, s } = twinContext();
    s.ias = TWIN.limits.vleCas! * 1.05;
    hud.update(0.5, ctx);
    expect(chipTexts(parent)).not.toContain('GEAR SPEED');
    hud.update(0.6, ctx);
    expect(chipTexts(parent)).toContain('GEAR SPEED');
    s.surfaces.flaps = TWIN.controls.flaps.detents[1];
    s.ias = TWIN.limits.vfeCas[1] * 1.05;
    hud.update(1.1, ctx);
    hud.update(0.1, ctx);
    expect(chipTexts(parent)).toContain('FLAP SPEED');
  });
});

describe('the HUD of the Cessna 172S', () => {
  it('keeps its four bars and its rpm read-out, and no type chip', () => {
    const parent = new FakeElement('div');
    const hud = new Hud(parent as unknown as HTMLElement);
    const s = makeMockState({ heightAGL: 300, tas: 50 });
    s.engine.rpm = 2437;
    const c = defaultControls();
    c.throttle = 1;
    c.elevatorTrim = 0.12;
    const ctx = { state: s, controls: c, env: makeMockEnvironment(), simTime: 0, weather: defaultWeather() } as unknown as SimContext;
    hud.update(1 / 60, ctx);
    expect(controlRows(parent)).toEqual([
      ['THR', '100%'],
      ['MIX', '100%'],
      ['FLAPS', '0°'],
      ['TRIM', '12% UP'],
      ['RPM', '2440'],
    ]);
    expect(parent.findAll('bar').map((b) => b.className)).toEqual(['bar ', 'bar mix', 'bar ', 'bar trim']);
    expect(parent.findAll('controls')[0].className).toBe('controls');
    // Flap overspeed is not monitored on the C172S: never a chip, however fast.
    s.surfaces.flaps = 30 * (Math.PI / 180);
    s.ias = 200;
    for (let i = 0; i < 100; i++) hud.update(0.1, ctx);
    expect(chipTexts(parent)).toEqual([]);
  });

  it('setAircraft with the C172S profile does not rebuild the grid', () => {
    const parent = new FakeElement('div');
    const hud = new Hud(parent as unknown as HTMLElement);
    const grid = parent.findAll('controls')[0];
    const before = [...grid.children];
    hud.setAircraft(hudAircraft(C172S_DEFINITION, C172S_UI));
    expect(grid.children).toEqual(before);
    expect(grid.children.every((c, i) => c === before[i])).toBe(true);
  });
});

describe('the control-position widget of a twin', () => {
  function widget(): { parent: FakeElement; w: ControlsWidget } {
    const parent = new FakeElement('div');
    const w = new ControlsWidget(parent as unknown as HTMLElement);
    w.yoke = () => ({ mouseYoke: true, source: 'mouse' });
    w.setAircraft({ engines: 2, levers: ['throttle', 'propeller', 'mixture'], rudderTrim: true });
    return { parent, w };
  }

  it('marks the selected engine and dims the other engine\'s levers', () => {
    const { parent, w } = widget();
    const { ctx } = twinContext();
    w.update(ctx, true);
    expect(parent.findAll('ctlw-sel')[0].textContent).toBe('ENG L');
    const bars = parent.findAll('ctlw-vbar');
    expect(bars.map((b) => b.className)).toEqual([
      'ctlw-vbar throttle', 'ctlw-vbar throttle dim', 'ctlw-vbar propeller', 'ctlw-vbar propeller dim',
      'ctlw-vbar mixture', 'ctlw-vbar mixture dim',
    ]);
    expect(bars.map((b) => b.children[0].style.height)).toEqual(['100.0%', '60.0%', '100.0%', '80.0%', '100.0%', '100.0%']);
    (ctx as { engineSelection?: 'all' | 0 | 1 }).engineSelection = 'all';
    w.update(ctx, true);
    expect(parent.findAll('ctlw-sel')[0].textContent).toBe('ENG BOTH');
    expect(parent.findAll('dim')).toEqual([]);
    (ctx as { engineSelection?: 'all' | 0 | 1 }).engineSelection = 1;
    w.update(ctx, true);
    expect(parent.findAll('ctlw-sel')[0].textContent).toBe('ENG R');
    expect(parent.findAll('dim').length).toBe(3);
  });

  it('puts the rudder-trim mark where the trim is', () => {
    const { parent, w } = widget();
    const { ctx, c } = twinContext();
    c.rudderTrim = -0.4;
    w.update(ctx, true);
    expect(parent.findAll('ctlw-rtrim')[0].style.left).toBe('30.0%');
  });

  it('has no engine block and no rudder-trim mark on a single without rudder trim', () => {
    const parent = new FakeElement('div');
    const w = new ControlsWidget(parent as unknown as HTMLElement);
    const before = parent.findAll('ctlw').length;
    w.setAircraft({ engines: 1, levers: ['throttle', 'mixture'], rudderTrim: false });
    expect(parent.findAll('ctlw-eng')).toEqual([]);
    expect(parent.findAll('ctlw-rtrim')).toEqual([]);
    expect(parent.findAll('ctlw').length).toBe(before);
  });
});

describe('the hints card of a twin', () => {
  it('lists the type\'s own rows before the views, and its start-up steps', () => {
    const parent = new FakeElement('div');
    const card = new HintsCard(parent as unknown as HTMLElement, () => {});
    card.setAircraft({ ui: TWIN_TESTBED_UI, vr: 80, vy: 102 });
    const grids = parent.findAll('hints-grid');
    const startup = grids[0].childTexts;
    expect(startup.filter((_, i) => i % 2 === 0)).toEqual(TWIN_TESTBED_UI.startupSteps.map(([k], i) => `${i + 1}. ${k}`));
    const labels = grids[1].childTexts.filter((_, i) => i % 2 === 0);
    expect(labels.slice(labels.indexOf('Brakes') + 1, labels.indexOf('Views'))).toEqual(['Engines', 'Propellers', 'Gear']);
    expect(parent.textContent).toMatch(/at 80 kt hold ↓ .* climb at 100 kt\./);
  });
});
