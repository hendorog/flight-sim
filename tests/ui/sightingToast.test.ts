// Deep Time inc 2 (WP7): a Field Guide sighting shows its toast without a cockpit cue line repeating it;
// every other toast is still echoed as a cue line.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createEventBus, type SimContext } from '../../src/core/context';
import { makeMockEnvironment, makeMockState } from '../../src/core/mockState';
import C172S_DEFINITION from '../../src/aircraft/c172s/index';
import { defaultControls, defaultWeather } from '../../src/core/types';
import { UISystem } from '../../src/ui/uiSystem';
import { FlightCues } from '../../src/ui/flightCues';
import { Toasts } from '../../src/ui/overlays';
import { setEra } from '../../src/world/era/eraState';
import { sightingToastText } from '../../src/world/fauna/fieldGuideData';
import { FakeElement, installFakeDom } from './fakeDom';

beforeAll(() => {
  installFakeDom();
  // UISystem reads the page URL and storage at construction (fakeDom covers the rest).
  vi.stubGlobal('location', { search: '' });
  vi.stubGlobal('window', { ...(globalThis.window as object), setInterval: () => 0, clearInterval() {} });
  vi.stubGlobal('localStorage', { getItem: () => null, setItem() {}, removeItem() {} });
  vi.stubGlobal('navigator', { webdriver: true, getGamepads: () => [] });
});
afterAll(() => vi.unstubAllGlobals());
afterEach(() => {
  setEra('present');
  vi.restoreAllMocks();
});

function makeUi(): { ui: UISystem; ctx: SimContext; toasts: string[]; cues: string[] } {
  const toasts: string[] = [];
  const cues: string[] = [];
  vi.spyOn(Toasts.prototype, 'show').mockImplementation((text: string) => void toasts.push(text));
  vi.spyOn(FlightCues.prototype, 'say').mockImplementation((text: string) => void cues.push(text));
  const ctx = {
    era: 'cretaceous', state: makeMockState({ heightAGL: 300, tas: 50 }), env: makeMockEnvironment(), controls: defaultControls(C172S_DEFINITION),
    weather: defaultWeather(), simTime: 0, timeScale: 1, cameraMode: 'cockpit', quality: 'high', events: createEventBus(), commands: {},
    renderer: { domElement: new FakeElement('canvas') },
  } as unknown as SimContext;
  const ui = new UISystem({ bindings: [], parent: new FakeElement('div') as unknown as HTMLElement, hints: 'never' });
  ui.init(ctx);
  return { ui, ctx, toasts, cues };
}

describe('Field Guide sighting toast', () => {
  it('one sighting gives one toast and no cue line', () => {
    setEra('cretaceous');
    const { ui, ctx, toasts, cues } = makeUi();
    // A fresh guide (no stored sightings) so the first sighting is new.
    vi.spyOn(ui.fieldGuide, 'record').mockReturnValueOnce(true).mockReturnValue(false);
    ctx.events.emit('faunaSighted', { species: 'edmontosaurus', distanceM: 300 });
    ctx.events.emit('faunaSighted', { species: 'edmontosaurus', distanceM: 200 });
    expect(toasts).toEqual([sightingToastText('edmontosaurus')]);
    expect(cues).toEqual([]);
  });

  it('other callers give both a toast and a cue line', () => {
    const { ui, ctx, toasts, cues } = makeUi();
    ui.showToast('Parking brake set');
    ctx.events.emit('cameraMode', { mode: 'chase' });
    expect(toasts).toHaveLength(2);
    expect(cues).toEqual(toasts);
  });
});
