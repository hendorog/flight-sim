// The Bo 105's control box (UiProfile.controlBox, the flyability pass's F4; gate finding 6: the box showed the
// fixed-wing twin throttle widget): the keyboard centre ring and TRIM text, the collective, NR with LOW / HIGH, the engine
// selection as 1 / 2 / BOTH, the two power levers with the IDLE stop and OFF / IDLE / FLT, the STAB ASSIST chip, and F5 /
// F6 bringing it up. The R22, R44, S269 and MD 500E boxes keep their structure and texts. Built on a stand-in DOM.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { BO105_DEFINITION } from '../../src/aircraft/bo105';
import { BO105_UI } from '../../src/aircraft/bo105/ui';
import { MD500_DEFINITION } from '../../src/aircraft/md500';
import { R22_DEFINITION } from '../../src/aircraft/r22';
import { R44_DEFINITION } from '../../src/aircraft/r44';
import { S269_DEFINITION } from '../../src/aircraft/s269';
import type { AircraftDefinition, UiProfile } from '../../src/aircraft/types';
import { MD500_UI } from '../../src/aircraft/md500/ui';
import { R22_UI } from '../../src/aircraft/r22/ui';
import { R44_UI } from '../../src/aircraft/r44/ui';
import { S269_UI } from '../../src/aircraft/s269/ui';
import type { SimContext } from '../../src/core/context';
import { makeMockEnvironment, makeMockState } from '../../src/core/mockState';
import { defaultControls, defaultWeather, setEngineControl } from '../../src/core/types';
import { ControlsWidget, cyclicTrimText, type WidgetAircraft, type YokeSource } from '../../src/ui/status';
import { FakeElement, installFakeDom } from './fakeDom';

const listeners = new Map<string, (e: unknown) => void>();
beforeAll(() => {
  installFakeDom();
  vi.stubGlobal('window', { devicePixelRatio: 1, addEventListener: (k: string, f: (e: unknown) => void) => void listeners.set(k, f),
    removeEventListener() {}, setTimeout: () => 0, clearTimeout() {} });
});
afterAll(() => vi.unstubAllGlobals());

/** The widget description uiSystem.setAircraft builds for a type. */
function widgetAircraft(def: AircraftDefinition, ui: UiProfile): WidgetAircraft {
  const levers: WidgetAircraft['levers'][number][] = ['throttle'];
  if (def.input.has.propeller) levers.push('propeller');
  if (def.input.has.mixture) levers.push('mixture');
  return { engines: def.engineCount, levers, rudderTrim: def.input.has.rudderTrim, rotorcraft: !!def.rotorcraft,
    ...(ui.controlBox ? { controlBox: ui.controlBox } : {}) };
}
/** Class names of the tree, depth first (the structure a legacy box must keep). */
const tree = (e: FakeElement): string[] => e.children.flatMap((c) => [c.className, ...tree(c).map((x) => `  ${x}`)]);

function bo105Context(o: { nr: number; collective: number; levers: [number, number]; anchor: { pitch: number; roll: number } }) {
  const s = makeMockState({ engines: 2, heightAGL: 10, tas: 0 });
  s.onGround = false; for (const w of s.wheels) w.onGround = false;
  s.ias = 0;
  (s as unknown as { rotorcraft: unknown }).rotorcraft = { turboshaft: { nrPct: o.nr }, springTrim: { ...o.anchor, pitchForce: 0, rollForce: 0 } };
  const c = defaultControls(BO105_DEFINITION);
  c.collective = o.collective;
  setEngineControl(c, 0, 'throttle', o.levers[0]); setEngineControl(c, 1, 'throttle', o.levers[1]);
  const ctx = { state: s, controls: c, env: makeMockEnvironment(), simTime: 0, weather: defaultWeather(), engineSelection: 'all' } as unknown as SimContext;
  return { ctx, s, c };
}

describe('the Bo 105 control box', () => {
  it('shows the anchor, TRIM, COLL, NR, ENG 1 / 2 / BOTH, PWR bars with the IDLE stop and their words, and the STAB ASSIST chip; no throttle widget', () => {
    const parent = new FakeElement('div');
    const w = new ControlsWidget(parent as unknown as HTMLElement);
    w.setAircraft(widgetAircraft(BO105_DEFINITION, BO105_UI));
    let yoke: YokeSource = { mouseYoke: false, source: 'keyboard', keyboardOffCentre: true, stabilityAssist: true };
    w.yoke = () => yoke;
    const { ctx, s } = bo105Context({ nr: 100.2, collective: 0.43, levers: [1, 0.25], anchor: { pitch: 0.46, roll: -0.06 } });
    w.update(ctx, true);
    const text = parent.textContent;
    expect(text).toContain('TRIM 23% AFT · 3% L');
    expect(text).toContain('COLL 43%');
    expect(text).toContain('NR 100%');
    expect(parent.findAll('ctlw-sel')[0].textContent).toBe('ENG BOTH');
    expect(parent.findAll('ctlw-words')[0].childTexts).toEqual(['FLT', 'IDLE']);
    expect(parent.findAll('ctlw-lever')[0].textContent).toContain('PWR');
    expect(text).not.toMatch(/THR/);
    expect(parent.findAll('ctlw-idle').map((t) => t.style.bottom)).toEqual(['25.0%', '25.0%']);
    expect(parent.findAll('ctlw-trim')[0].classList.contains('hidden')).toBe(true);
    expect(parent.findAll('ctlw-coll')[0].children[0].style.height).toBe('43.0%');
    expect(parent.findAll('ctlw-ring')[0].style.transform).toBe('translate(-1.6px, 12.0px)');
    const chip = parent.findAll('ctlw-chip')[0];
    expect(chip.classList.contains('hidden')).toBe(false);
    expect(chip.textContent).toBe('STAB ASSIST');
    expect(chip.attributes.get('title')).toMatch(/sim aid.*no SAS/);
    expect(chip.classList.contains('dim')).toBe(false);
    // Engine 1 selected; NR LOW at 95 % and below (P5 FM 3-16); a lever at OFF; the chip dims above 50 KIAS and goes with the assist.
    (ctx as unknown as { engineSelection: number }).engineSelection = 0;
    (s.rotorcraft as unknown as { turboshaft: { nrPct: number } }).turboshaft.nrPct = 94.6;
    setEngineControl(ctx.controls, 1, 'throttle', 0);
    s.ias = 60 * 0.5144444444444445;
    w.update(ctx, true);
    expect(parent.findAll('ctlw-sel')[0].textContent).toBe('ENG 1');
    expect(parent.findAll('ctlw-nr')[0].textContent).toBe('95% LOW');
    expect(parent.findAll('ctlw-nr')[0].classList.contains('warn')).toBe(true);
    expect(parent.findAll('ctlw-words')[0].childTexts).toEqual(['FLT', 'OFF']);
    expect(chip.classList.contains('dim')).toBe(true);
    (s.rotorcraft as unknown as { turboshaft: { nrPct: number } }).turboshaft.nrPct = 103.4;
    w.update(ctx, true);
    expect(parent.findAll('ctlw-nr')[0].textContent).toBe('103% HIGH');
    yoke = { ...yoke, stabilityAssist: false };
    w.update(ctx, true);
    expect(chip.classList.contains('hidden')).toBe(true);
  });
  it('the ring and TRIM follow the keyboard centre when it differs from the spring anchor (Shift+5)', () => {
    const parent = new FakeElement('div');
    const w = new ControlsWidget(parent as unknown as HTMLElement);
    w.setAircraft(widgetAircraft(BO105_DEFINITION, BO105_UI));
    w.yoke = () => ({ mouseYoke: false, source: 'keyboard', keyboardOffCentre: true, keyboardCentre: { aileron: 0, elevator: -0.2 } });
    const { ctx } = bo105Context({ nr: 100, collective: 0.4, levers: [1, 1], anchor: { pitch: 0.46, roll: 0 } });
    w.update(ctx, true);
    expect(parent.textContent).toContain('TRIM 10% FWD · 0%');
    expect(cyclicTrimText(0, 0)).toBe('0% · 0%');
  });
  it('F5 / F6 (and Shift+F5 / Shift+F6) bring the box up', () => {
    for (const shiftKey of [false, true]) {
      const parent = new FakeElement('div');
      const w = new ControlsWidget(parent as unknown as HTMLElement);
      w.setAircraft(widgetAircraft(BO105_DEFINITION, BO105_UI));
      w.yoke = () => ({ mouseYoke: false, source: 'keyboard' });
      const { ctx } = bo105Context({ nr: 100, collective: 0.4, levers: [1, 1], anchor: { pitch: 0, roll: 0 } });
      w.update(ctx, true);
      listeners.get('keyup')?.({ code: 'F5' });
      expect(w.visible).toBe(false);
      listeners.get('keydown')?.({ code: 'F5', shiftKey, ctrlKey: false, metaKey: false, altKey: false });
      w.update(ctx, true);
      expect(w.visible).toBe(true);
      listeners.get('keyup')?.({ code: 'F5' });
    }
  });
});

describe('the other helicopters keep their box', () => {
  it('R22, R44, S269 and MD 500E: no controlBox, the generic structure (trim wheel, rudder track, TRIM text) and no helicopter parts', () => {
    for (const [def, ui] of [[R22_DEFINITION, R22_UI], [R44_DEFINITION, R44_UI], [S269_DEFINITION, S269_UI], [MD500_DEFINITION, MD500_UI]] as const) {
      expect(ui.controlBox).toBeUndefined();
      const parent = new FakeElement('div');
      const w = new ControlsWidget(parent as unknown as HTMLElement);
      w.setAircraft(widgetAircraft(def, ui));
      w.yoke = () => ({ mouseYoke: false, source: 'keyboard', keyboardOffCentre: true });
      const s = makeMockState({ heightAGL: 10, tas: 0 });
      const c = defaultControls(def);
      w.update({ state: s, controls: c, env: makeMockEnvironment(), simTime: 0, weather: defaultWeather() } as unknown as SimContext, true);
      expect(tree(parent)).toEqual(['ctlw on', '  ctlw-top', '    ctlw-yoke', '      ', '    ctlw-trim', '      ', '  ctlw-rud', '    ',
        '  ctlw-text num', '    ', '  ctlw-hint hidden']);
      expect(parent.findAll('ctlw-text')[0].textContent).toBe('TRIM 0%');
    }
    expect(BO105_UI.controlBox?.engineNames).toEqual(['1', '2']);
  });
});
