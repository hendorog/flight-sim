// The pause menu's era gates on a stand-in DOM (fakeDom.ts): in the Cretaceous the Flight School tab and the
// tower camera chip are gone; in the present day both are there. Built through the real PauseMenu, so removing
// the gating in src/ui/menu.ts fails here (tests/ui/eraChooser.test.ts covers only eraGates itself).

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { SimContext } from '../../src/core/context';
import { makeMockEnvironment, makeMockState } from '../../src/core/mockState';
import C172S_DEFINITION from '../../src/aircraft/c172s/index';
import { defaultControls, defaultWeather } from '../../src/core/types';
import { PauseMenu, type MenuHost, type SchoolMenuLink } from '../../src/ui/menu';
import type { EraId } from '../../src/world/era/types';
import { FakeElement, installFakeDom } from './fakeDom';

beforeAll(installFakeDom);
afterAll(() => vi.unstubAllGlobals());

function build(era: EraId): FakeElement {
  const ctx = {
    era,
    state: makeMockState({ heightAGL: 0, tas: 0 }),
    env: makeMockEnvironment(),
    controls: defaultControls(C172S_DEFINITION),
    weather: defaultWeather(),
    simTime: 0,
    timeScale: 1,
    cameraMode: 'chase',
    quality: 'high',
    commands: {},
  } as unknown as SimContext;
  const school: SchoolMenuLink = { lessonActive: false, renderMenuPage() {}, command() {} };
  const host = { ctx, close() {}, toast() {}, weatherEdited() {}, hudEnabled: true, fpsVisible: false, autopilot: null, showHints() {}, school } as MenuHost;
  const parent = new FakeElement('div');
  const menu = new PauseMenu(parent as unknown as HTMLElement, [], host);
  menu.open('school');
  return parent;
}

/** Visible buttons whose own text is exactly `text`. */
function visibleButtons(root: FakeElement, text: string): FakeElement[] {
  const out: FakeElement[] = [];
  const walk = (e: FakeElement, hidden: boolean): void => {
    const h = hidden || e.classList.contains('hidden');
    if (e.tagName === 'button' && e.textContent === text && !h) out.push(e);
    for (const c of e.children) walk(c, h);
  };
  walk(root, false);
  return out;
}

describe('pause menu era gates', () => {
  it('the present day has the Flight School tab and the tower camera', () => {
    const root = build('present');
    expect(visibleButtons(root, 'Flight School')).toHaveLength(1);
    // The School tab opens (it is not redirected to Flight); the Display page holds the Tower chip.
    expect(visibleButtons(root, 'Flight School')[0].classList.contains('active')).toBe(true);
    const tower = root.children[0].children[0].children.filter((p) => p.tagName === 'section').flatMap((p) => p.findAll('chips'))
      .flatMap((c) => c.children).filter((b) => b.textContent === 'Tower');
    expect(tower).toHaveLength(1);
  });

  it('the Cretaceous hides the Flight School tab and has no tower camera', () => {
    const root = build('cretaceous');
    expect(visibleButtons(root, 'Flight School')).toHaveLength(0);
    // Asking for the School tab lands on Flight.
    expect(visibleButtons(root, 'Flight')[0].classList.contains('active')).toBe(true);
    const all: FakeElement[] = [];
    const walk = (e: FakeElement): void => {
      if (e.tagName === 'button' && e.textContent === 'Tower') all.push(e);
      e.children.forEach(walk);
    };
    walk(root);
    expect(all).toHaveLength(0);
  });
});
