// Landing damage in the UI (physics/damage.ts): a toast per 'damage' event and no crash dialog; the flight cues' DAMAGE
// list and the DAMAGED chip come from the state (so a restored flight shows its damage), and a restart clears them.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createEventBus, type SimContext } from '../../src/core/context';
import { makeMockEnvironment, makeMockState } from '../../src/core/mockState';
import C172S_DEFINITION from '../../src/aircraft/c172s/index';
import { defaultControls, defaultWeather, type AircraftState } from '../../src/core/types';
import { emptyDamage, type DamageItem, type DamageSeverity, type DamageState } from '../../src/physics/damage';
import { UISystem } from '../../src/ui/uiSystem';
import { FlightCues } from '../../src/ui/flightCues';
import { RadioCaptions } from '../../src/ui/school/captions';
import { Annunciators, damageCue } from '../../src/ui/status';
import { Toasts } from '../../src/ui/overlays';
import { FakeElement, installFakeDom } from './fakeDom';

beforeAll(() => {
  installFakeDom();
  vi.stubGlobal('location', { search: '' });
  vi.stubGlobal('window', { ...(globalThis.window as object), setInterval: () => 0, clearInterval() {} });
  vi.stubGlobal('localStorage', { getItem: () => null, setItem() {}, removeItem() {} });
  vi.stubGlobal('navigator', { webdriver: true, getGamepads: () => [] });
});
afterAll(() => vi.unstubAllGlobals());
afterEach(() => vi.restoreAllMocks());

function damage(...events: [DamageItem, DamageSeverity, string][]): DamageState {
  const d = emptyDamage(1);
  for (const [item, severity, text] of events) d.events.push({ time: 1, item, severity, text });
  return d;
}

function stateWith(d: DamageState | undefined, crashed = false): AircraftState {
  const s = makeMockState({ heightAGL: 0, tas: 10 });
  s.damage = d;
  s.crashed = crashed;
  return s;
}

describe('landing damage in the UI', () => {
  it('a damage event gives a toast and a cue line, never the crash dialog; a crash still opens it', () => {
    const toasts: string[] = [];
    vi.spyOn(Toasts.prototype, 'show').mockImplementation((text: string) => void toasts.push(text));
    const ctx = {
      state: makeMockState({ heightAGL: 0, tas: 10 }), env: makeMockEnvironment(), controls: defaultControls(C172S_DEFINITION),
      weather: defaultWeather(), simTime: 0, timeScale: 1, cameraMode: 'cockpit', quality: 'high', events: createEventBus(), commands: {},
      renderer: { domElement: new FakeElement('canvas') },
    } as unknown as SimContext;
    const ui = new UISystem({ bindings: [], parent: new FakeElement('div') as unknown as HTMLElement, hints: 'never' });
    ui.init(ctx);
    ctx.events.emit('damage', { item: 'hardLanding', severity: 'inspection', text: 'Hard landing: inspection required' });
    ctx.events.emit('damage', { item: 'noseGear', severity: 'disabling', text: 'Nose gear collapsed' });
    ctx.events.emit('damage', { item: 'propeller0', severity: 'disabling', text: 'Propeller strike: engine stopped' });
    expect(toasts).toEqual(['Hard landing: inspection required', 'Nose gear collapsed', 'Propeller strike: engine stopped']);
    expect(ui.crashCardOpen).toBe(false);
    // (The fake DOM has no contains(), which the crash path's menu close calls.)
    (FakeElement.prototype as unknown as { contains: () => boolean }).contains ??= () => false;
    ctx.events.emit('crash', { reason: 'terrain impact' });
    expect(ui.crashCardOpen).toBe(true);
  });

  it('the flight cues list the damage from the state, one line per item, and clear with it', () => {
    const cues = new FlightCues(new FakeElement('div') as unknown as HTMLElement);
    cues.update(stateWith(undefined), false);
    expect(cues.damageList).toEqual([]);
    const d = damage(
      ['hardLanding', 'inspection', 'Hard landing: inspection required'],
      ['nose', 'damage', 'Firewall buckled by the nose gear'],
      ['noseGear', 'disabling', 'Nose gear collapsed'],
      ['propeller0', 'damage', 'Propeller strike: engine and propeller inspection required'],
      ['propeller0', 'disabling', 'Propeller strike: engine stopped'],
    );
    cues.update(stateWith(d), false);
    expect(cues.damageList).toEqual(['Hard landing: inspection required', 'Firewall buckled by the nose gear', 'Nose gear collapsed', 'Propeller strike: engine stopped']);
    cues.update(stateWith(emptyDamage(1)), false);
    expect(cues.damageList).toEqual([]);
  });

  it('the DAMAGED chip: none for an inspection note or a crash, amber for damage, red with the restart key when disabled', () => {
    expect(damageCue(stateWith(undefined))).toBeNull();
    expect(damageCue(stateWith(damage(['hardLanding', 'inspection', 'Hard landing: inspection required'])))).toBeNull();
    expect(damageCue(stateWith(damage(['leftMain', 'damage', 'Left main gear bent'])))).toEqual({ text: 'DAMAGED', level: 'warn' });
    const disabled = damage(['leftMain', 'damage', 'Left main gear bent'], ['noseGear', 'disabling', 'Nose gear collapsed']);
    expect(damageCue(stateWith(disabled))).toEqual({ text: 'DAMAGED · Shift+R to restart', level: 'alert' });
    expect(damageCue(stateWith(disabled, true))).toBeNull();

    // The cockpit annunciators (HUD off) show it too.
    const parent = new FakeElement('div');
    const a = new Annunciators(parent as unknown as HTMLElement);
    const ctx = { state: stateWith(disabled), controls: defaultControls(C172S_DEFINITION) } as unknown as SimContext;
    a.update(ctx, false);
    const chip = (a.root as unknown as FakeElement).children.find((c) => c.textContent.startsWith('DAMAGED'));
    expect(chip).toBeDefined();
    expect(chip!.classList.contains('hidden')).toBe(false);
    expect(chip!.classList.contains('alert')).toBe(true);
  });
});

describe('external-view HUD clearance for status and radio captions', () => {
  it('marks #fsui with has-hud and --hud-cues-left in external views, and clears has-hud in cockpit or with HUD off', () => {
    vi.spyOn(performance, 'now').mockReturnValue(1000);
    const parent = new FakeElement('div');
    const ctx = {
      state: makeMockState({ heightAGL: 100, tas: 55 }), env: makeMockEnvironment(), controls: defaultControls(C172S_DEFINITION),
      weather: defaultWeather(), simTime: 1, timeScale: 1, cameraMode: 'cockpit', quality: 'high', events: createEventBus(), commands: {},
      renderer: { domElement: new FakeElement('canvas') },
    } as unknown as SimContext;
    const ui = new UISystem({ bindings: [], parent: parent as unknown as HTMLElement, hints: 'never' });
    ui.init(ctx);
    const fsui = parent.children[0];
    const hudControls = fsui.findAll('controls')[0] as FakeElement & { offsetLeft?: number; offsetWidth?: number };
    hudControls.offsetLeft = 24;
    hudControls.offsetWidth = 268;

    ui.update(1 / 60, ctx);
    expect(fsui.classList.contains('has-hud')).toBe(false);

    ctx.cameraMode = 'chase';
    ui.update(1 / 60, ctx);
    expect(fsui.classList.contains('has-hud')).toBe(true);
    expect(fsui.style['--hud-cues-left']).toBe('306px');

    ui.toggleHud();
    ui.update(1 / 60, ctx);
    expect(fsui.classList.contains('has-hud')).toBe(false);

    ui.toggleHud();
    ctx.cameraMode = 'cockpit';
    ui.update(1 / 60, ctx);
    expect(fsui.classList.contains('has-hud')).toBe(false);
    ui.dispose();
  });

  it('tracks the flight-cues top edge on the same frame when camera views switch', () => {
    let cuesTop = 920;
    const cues = {
      isConnected: true,
      getBoundingClientRect: () => ({ top: cuesTop, height: 66 }),
    };
    const host = new FakeElement('div') as FakeElement & { ownerDocument?: unknown; offsetParent?: unknown };
    host.ownerDocument = { querySelector: (sel: string) => (sel === '#fsui .flight-cues' ? cues : null) };
    const radio = new RadioCaptions(host as unknown as HTMLElement);
    const rRoot = radio.root as unknown as FakeElement & { ownerDocument?: unknown; offsetParent?: unknown };
    rRoot.ownerDocument = host.ownerDocument;
    rRoot.offsetParent = { getBoundingClientRect: () => ({ bottom: 1000 }) };

    radio.show({ id: 'r1', actor: 'tower', channel: 'radio', text: 'Runway two seven, cleared for take-off.', atWall: 1, atSim: 1, spoken: true }, 1);
    radio.update(1.0);
    expect(radio.root.style.bottom).toBe('88px');

    // Switching to Chase raises .flight-cues from bottom 14px to bottom 22px; RadioCaptions follows without a 250 ms delay.
    cuesTop = 912;
    radio.update(1.016);
    expect(radio.root.style.bottom).toBe('96px');
  });
});
