import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { SimContext } from '../../src/core/context';
import { makeMockEnvironment, makeMockState } from '../../src/core/mockState';
import C172S_DEFINITION from '../../src/aircraft/c172s/index';
import { defaultControls, defaultWeather } from '../../src/core/types';
import { PauseMenu, type MenuHost } from '../../src/ui/menu';
import { FieldGuide } from '../../src/ui/fieldGuide';
import { FIELD_GUIDE_SPECIES, fieldGuideEntry, sightingToastText } from '../../src/world/fauna/fieldGuideData';
import { FAUNA_SPECIES_IDS } from '../../src/world/fauna/types';
import type { EraId } from '../../src/world/era/types';
import { FakeElement, installFakeDom } from './fakeDom';

beforeAll(installFakeDom);
afterAll(() => vi.unstubAllGlobals());

class MemStore {
  m = new Map<string, string>();
  getItem(k: string): string | null { return this.m.get(k) ?? null; }
  setItem(k: string, v: string): void { this.m.set(k, v); }
}
const throwing = { getItem(): never { throw new Error('denied'); }, setItem(): never { throw new Error('denied'); } };

describe('FieldGuide store', () => {
  it('round-trips through storage', () => {
    const s = new MemStore();
    const a = new FieldGuide(s, () => new Date('2026-01-02T03:04:05Z'));
    expect(a.record('edmontosaurus', 240)).toBe(true);
    expect(a.record('edmontosaurus', 90)).toBe(false);
    const b = new FieldGuide(s);
    expect(b.has('edmontosaurus')).toBe(true);
    expect(b.get('edmontosaurus')).toEqual({ seen: true, firstSeen: '2026-01-02T03:04:05.000Z', closestM: 90 });
    expect(b.has('quetzalcoatlus')).toBe(false);
  });
  it('survives a storage throw and corrupt data', () => {
    const g = new FieldGuide(throwing);
    expect(g.record('quetzalcoatlus', 10)).toBe(true);
    expect(g.record('quetzalcoatlus', 10)).toBe(false);
    const s = new MemStore();
    s.setItem(FieldGuide.STORAGE_KEY, '{nope');
    expect(new FieldGuide(s).seenCount).toBe(0);
  });
});

describe('field guide data', () => {
  it('has three facts for every roster species and a toast with name, size and a fact', () => {
    for (const id of FAUNA_SPECIES_IDS) {
      expect(fieldGuideEntry(id).facts).toHaveLength(3);
      expect(fieldGuideEntry(id).name).not.toBe(id);
      const t = sightingToastText(id);
      expect(t).toContain(fieldGuideEntry(id).name);
      expect(t).toContain(fieldGuideEntry(id).size);
    }
  });
});

function menuText(era: EraId, g: FieldGuide): { root: FakeElement; text: string; navHidden: boolean } {
  const ctx = {
    era, state: makeMockState({ heightAGL: 0, tas: 0 }), env: makeMockEnvironment(), controls: defaultControls(C172S_DEFINITION),
    weather: defaultWeather(), simTime: 0, timeScale: 1, cameraMode: 'chase', quality: 'high', commands: {},
  } as unknown as SimContext;
  const host = { ctx, close() {}, toast() {}, weatherEdited() {}, hudEnabled: true, fpsVisible: false, autopilot: null, showHints() {}, fieldGuide: g } as MenuHost;
  const parent = new FakeElement('div');
  const menu = new PauseMenu(parent as unknown as HTMLElement, [], host);
  menu.open('fieldguide');
  let navHidden = false;
  let text = '';
  const walk = (e: FakeElement, hidden: boolean): void => {
    const h = hidden || e.classList.contains('hidden');
    if (e.tagName === 'button' && e.textContent === 'Field Guide') navHidden = h;
    if (!h && e.tagName === 'section') text += e.textContent;
    for (const c of e.children) walk(c, h);
  };
  walk(parent, false);
  return { root: parent, text, navHidden };
}

describe('Field Guide menu page', () => {
  it('lists seen and unseen species in the Cretaceous', () => {
    const g = new FieldGuide(new MemStore());
    g.record(FIELD_GUIDE_SPECIES[0], 120);
    const m = menuText('cretaceous', g);
    expect(m.navHidden).toBe(false);
    expect(m.text).toContain(fieldGuideEntry(FIELD_GUIDE_SPECIES[0]).name);
    expect(m.text).toContain('Not seen yet.');
  });
  it('is hidden in the present day', () => {
    const m = menuText('present', new FieldGuide(new MemStore()));
    expect(m.navHidden).toBe(true);
    expect(m.text).not.toContain('Creatures you have spotted');
  });
});
