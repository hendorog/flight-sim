// The Career's wiring into the shell (docs/career.md "Integration (exact hooks)", package 3b). The Simulator's source
// keeps the order the design needs: the career store and its boot plan before decideBoot, the CareerSystem after the
// radio, its frame after the radio's and before the UI's, its afterBoot after the school's, its crash actions chained
// after training.init; and every hook sits behind the Career's presence (the store is only made where the school is,
// the hold, the snapshot block and the kept snapshots read a CareerSystem that is null without one). The UI: with a
// Career page open UISystem is modal (its own keys stand down, and the radio, which asks ui.modalOpen, does nothing on
// its keys); with no link attached nothing changes; the HUD moves below the job strip while it shows.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import simulatorSource from '../../src/sim/Simulator.ts?raw';
import { createEventBus, type SimContext } from '../../src/core/context';
import { makeMockEnvironment, makeMockState } from '../../src/core/mockState';
import C172S_DEFINITION from '../../src/aircraft/c172s/index';
import { defaultControls, defaultWeather } from '../../src/core/types';
import { resetRadios } from '../../src/instruments/dynamics/radios';
import { CAREER_STRIP_CLEARANCE } from '../../src/career/ui/strip';
import type { CareerMenuLink, CareerModalLink } from '../../src/career/types';
import { FakeElement, installFakeDom } from '../ui/fakeDom';
import '../../src/world/terrain/heightfield';

vi.mock('../../src/ui/radioMenu', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/ui/radioMenu')>()),
  RadioMenu: class {
    open = false; items: { key?: string; label: string; detail: string }[] = []; root = { remove() {} };
    constructor(_layer: unknown, readonly onPick: (i: number) => void) {}
    show(_t: string, items: { label: string; detail: string }[]) { this.open = true; this.items = items; }
    hide() { this.open = false; }
  },
}));

beforeAll(() => {
  installFakeDom();
  // UISystem reads the page URL and storage at construction (fakeDom covers the rest); the radio listens on window.
  vi.stubGlobal('location', { search: '' });
  vi.stubGlobal('window', { ...(globalThis.window as object), setInterval: () => 0, clearInterval() {}, addEventListener() {}, removeEventListener() {} });
  vi.stubGlobal('localStorage', { getItem: () => null, setItem() {}, removeItem() {} });
  vi.stubGlobal('navigator', { webdriver: true, getGamepads: () => [] });
  (globalThis as { HTMLElement?: unknown }).HTMLElement ??= class {};
});
afterAll(() => vi.unstubAllGlobals());

/** Index of `needle` in the Simulator's source; fails the test when it is missing. */
function at(needle: string): number {
  const i = simulatorSource.indexOf(needle);
  expect(i, `Simulator.ts contains ${needle}`).toBeGreaterThanOrEqual(0);
  return i;
}

/** The body of the Simulator's method or getter that starts with `head` (up to the next blank-line-separated member). */
function member(head: string): string {
  const i = at(head);
  return simulatorSource.slice(i, simulatorSource.indexOf('\n  }\n', i));
}

describe('the Simulator wires the Career in the design order', () => {
  it('loads the career store and plans the boot before decideBoot, only where the school is', () => {
    const gate = at('if (era().world.school) {\n      const cs = (this.careerStore = new CareerStore(');
    expect(at('careerBootPlan(cs.current')).toBeGreaterThan(gate);
    expect(at('careerBootPlan(cs.current')).toBeLessThan(at('const decision = decideBoot('));
    // The store is made nowhere else, so outside the school's eras there is no Career at all.
    expect(simulatorSource.split('new CareerStore(').length).toBe(2);
    expect(simulatorSource.split('new CareerSystem(').length).toBe(2);
    // resume= is the plan's when it has one, the URL's otherwise.
    expect(at('const resumeParam = careerPlan?.resumeParam ?? p.resume;')).toBeLessThan(at('const decision = decideBoot('));
  });

  it("restores a job's payload from the store on resume, and only when the snapshot carries a Career block", () => {
    expect(at('decision.snapshot.career !== undefined ? this.careerStore?.current?.active?.loading')).toBeLessThan(at('physics.restore(decision.snapshot, jobLoading)'));
    expect(simulatorSource).toContain('else physics.restore(decision.snapshot);');
  });

  it('builds the CareerSystem after the radio and training.init, chains its crash actions and attaches its pages', () => {
    const radio = at('this.radio = training ? new RadioSystem(');
    const career = at('const career = new CareerSystem(');
    expect(career).toBeGreaterThan(radio);
    expect(career).toBeGreaterThan(at('training?.init(ctx);'));
    expect(at('chainCrashActions(ui, career);')).toBeGreaterThan(career);
    expect(at('ui.attachCareer(career.modalLink, career.menuLink);')).toBeGreaterThan(career);
    expect(at('if (training && this.careerStore) {')).toBeLessThan(career);
  });

  it("runs the Career's frame after the radio and before the UI, on the frame's simulated time", () => {
    const radio = at("this.run('radio', this.radio, subsystemDt);");
    const career = at("this.run('career', this.career, subsystemDt);");
    expect(career).toBeGreaterThan(radio);
    expect(career).toBeLessThan(at("this.run('ui', s.ui, subsystemDt);"));
    expect(simulatorSource).toContain('this.frameSimDt = simulated;');
    expect(simulatorSource).toContain('this.frameSimDt = subsystemDt;');
  });

  it("follows the school's afterBoot with the Career's", () => {
    expect(at('this.career.afterBoot({ resumed: resumed?.snapshot ?? null, plan: careerPlan })')).toBeGreaterThan(at('training?.afterBoot({ resumed: resumed?.snapshot ?? null'));
    expect(simulatorSource).toContain('explicitScenario: p.explicitScenario || !!careerPlan?.trainingExplicit');
  });

  it('holds, keeps snapshots, writes the block and asks before Shift+R only through the CareerSystem', () => {
    expect(simulatorSource).toContain('const held = ctx.paused || this.holding || this.schoolHold || this.careerHold || s.ui.askOpen;');
    expect(simulatorSource).toContain('if (this.fastForwardLeft > 0 && !ctx.paused && !this.careerHold) {');
    // career=1 is consumed once read; a school=1 left in the URL never opens the school over the Career's boot.
    expect(simulatorSource).toContain("if (p.career.open === true) dropUrlParam('career');");
    expect(simulatorSource).toContain('params: careerPlan?.trainingExplicit && p.school.open === true ? { ...p.school, open: null } : p.school,');
    expect(member('private get saving(): boolean')).toContain("this.params.resume === true || (this.params.resume === null && (this.resumeEnabled || !!this.career?.jobPlaced()))");
    const persist = member('persist(force = false): boolean');
    expect(persist).toContain('const job = this.career?.resumeBlock() ?? null;');
    expect(persist).toContain('if (job) snap.career = job;');
    expect(simulatorSource).toContain('if (!this.career?.confirmReset(() => this.resetBehindCurtain(id))) this.resetBehindCurtain(id);');
  });

  it('flushes the career save before every reload and when the page goes', () => {
    for (const head of ['setAircraft(id: AircraftId, opts', 'setEra(id: EraId): void', 'setSeed(seed: number): void', 'private onLeave(): void']) {
      expect(member(head), head).toContain('this.careerStore?.flush();');
    }
    expect(simulatorSource).toContain("window.addEventListener('pagehide', () => this.onLeave());");
    expect(simulatorSource).toContain("window.addEventListener('beforeunload', () => this.onLeave());");
  });

  it("gives the radio and the traffic the Career's identity first", () => {
    expect(simulatorSource).toContain('player: () => this.career?.radioIdentity() ?? training.radioIdentity()');
    expect(simulatorSource).toContain('identity: () => this.career?.radioIdentity() ?? null, destination: () => this.career?.destination() ?? null');
  });
});

describe('UISystem with a Career page open', () => {
  beforeEach(() => resetRadios());

  async function makeUi() {
    const { UISystem } = await import('../../src/ui/uiSystem');
    const ctx = {
      era: 'present', state: makeMockState({ heightAGL: 0, tas: 0 }), env: makeMockEnvironment(), controls: defaultControls(C172S_DEFINITION),
      weather: defaultWeather(), simTime: 0, timeScale: 1, cameraMode: 'chase', quality: 'high', events: createEventBus(), commands: {},
      renderer: { domElement: new FakeElement('canvas') },
    } as unknown as SimContext;
    const ui = new UISystem({ bindings: [], parent: new FakeElement('div') as unknown as HTMLElement, hints: 'never' });
    ui.init(ctx);
    return { ui, ctx };
  }

  /** A Career link whose page and strip the test switches. */
  function careerLink() {
    const flags = { page: false, strip: false, opened: 0 };
    const modal: CareerModalLink = { screenOpen: () => flags.page, stripVisible: () => flags.strip };
    const menu: CareerMenuLink = { available: () => true, open: () => void flags.opened++, jobActive: () => false, abandon: () => {} };
    return { flags, modal, menu };
  }

  const escape = { code: 'Escape', repeat: false, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, target: null, preventDefault() {}, stopImmediatePropagation() {} };

  it('is not modal with no link, nor with a link and no page open', async () => {
    const { ui } = await makeUi();
    expect(ui.modalOpen).toBe(false);
    expect(ui.career).toBeNull();
    const { modal, menu } = careerLink();
    ui.attachCareer(modal, menu);
    expect(ui.modalOpen).toBe(false);
    expect(ui.career).toBe(menu);
  });

  it('is modal while a page is open, and the menu key stands down', async () => {
    const { ui } = await makeUi();
    const { flags, modal, menu } = careerLink();
    ui.attachCareer(modal, menu);
    flags.page = true;
    expect(ui.modalOpen).toBe(true);
    (ui as unknown as { onKey: (e: unknown) => void }).onKey(escape);
    expect(ui.menuOpen).toBe(false);
    expect(ui.blocksMouseFlight(10, 10, 'move')).toBe(true);
  });

  it('moves the HUD below the job strip while it shows', async () => {
    const { ui, ctx } = await makeUi();
    // The HUD's offset is a setter: what the UI last set it to.
    const hud = { topOffset: -1 };
    Object.defineProperty((ui as unknown as { hud: object }).hud, 'topOffset', { set: (v: number) => void (hud.topOffset = v), configurable: true });
    ui.update(0.016, ctx);
    expect(hud.topOffset).toBe(0);
    const { flags, modal } = careerLink();
    ui.attachCareer(modal);
    flags.strip = true;
    ui.update(0.016, ctx);
    expect(hud.topOffset).toBe(CAREER_STRIP_CLEARANCE);
    flags.strip = false;
    ui.update(0.016, ctx);
    expect(hud.topOffset).toBe(0);
  });

  it('leaves the radio keys doing nothing (the radio asks ui.modalOpen)', async () => {
    const { ui } = await makeUi();
    const { flags, modal } = careerLink();
    ui.attachCareer(modal);
    const { RadioSystem } = await import('../../src/atc/RadioSystem');
    const said: string[] = [];
    const speech = { enqueue: (u: { caption: string }) => said.push(u.caption), busy: () => false, idle: () => true, speaking: () => false, cancel() {} };
    const training = { speech, active: false, input: () => {}, radioIdentity: () => ({ authority: 'easa', registration: 'G-FSCK', icaoType: 'C172' }) };
    const state = { position: { x: 0, y: 0 }, onGround: true, groundSpeed: 0, track: 0, heading: 0, altitudeAGL: 0, altitudeMSL: 0 };
    const ctx = { state, weather: { windDirectionDeg: 70, windSpeedKt: 6, qnhHpa: 1013, timeOfDay: 10, visibilityM: 20000 }, events: { on: () => () => {} }, paused: false };
    const radio = new RadioSystem({ training: training as never, readings: () => ({ avionicsPowered: true }) as never, layer: {} as never, traffic: () => [], comRadios: () => 2, cdiSelect: () => false, blocked: () => ui.modalOpen });
    radio.init(ctx as never);
    const r = radio as unknown as { onKey: (e: unknown) => void; menu: { open: boolean } };
    const key = (code: string) => r.onKey({ ...escape, code });
    flags.page = true;
    key('Space');
    key('KeyR');
    for (let i = 0; i < 20; i++) radio.update(0.1);
    expect(r.menu.open).toBe(false);
    expect(said).toEqual([]);
    // The page closed: the same key opens the radio.
    flags.page = false;
    key('KeyR');
    expect(r.menu.open).toBe(true);
  });
});

describe('the pause menu with and without a Career', () => {
  // FakeElement drops listeners; here they are kept so a test can click a button.
  type Clickable = FakeElement & { listeners?: Map<string, () => void> };
  let spy: { mockRestore(): void } | null = null;
  beforeAll(() => {
    spy = vi.spyOn(FakeElement.prototype, 'addEventListener').mockImplementation(function (this: Clickable, type: string, fn: () => void) {
      (this.listeners ??= new Map()).set(type, fn);
    } as never);
  });
  afterAll(() => spy?.mockRestore());

  const click = (b: FakeElement): void => (b as Clickable).listeners?.get('click')?.();

  /** Every element under `root` not inside a hidden one. */
  function visible(root: FakeElement): FakeElement[] {
    const out: FakeElement[] = [];
    const walk = (e: FakeElement): void => {
      if (e.classList.contains('hidden')) return;
      out.push(e);
      e.children.forEach(walk);
    };
    walk(root);
    return out;
  }
  const buttons = (root: FakeElement, text: string) => visible(root).filter((e) => e.tagName === 'button' && e.textContent === text);
  const confirmTexts = (root: FakeElement) => visible(root).filter((e) => e.classList.contains('sc-confirm')).map((e) => e.textContent);

  /** A PauseMenu on the Flight (or School) tab, recording resets, school commands and Career calls in `log`. */
  async function build(career: { jobActive: boolean } | null, tab: 'flight' | 'school' = 'flight') {
    const { PauseMenu } = await import('../../src/ui/menu');
    const log: string[] = [];
    const ctx = {
      era: 'present', state: makeMockState({ heightAGL: 0, tas: 0 }), env: makeMockEnvironment(), controls: defaultControls(C172S_DEFINITION),
      weather: defaultWeather(), simTime: 0, timeScale: 1, cameraMode: 'chase', quality: 'high',
      commands: { reset: (id: string) => void log.push(`reset ${id}`) },
    } as unknown as SimContext;
    const school = { lessonActive: false, renderMenuPage: () => void log.push('school page'), command: (c: { kind: string }) => void log.push(`school ${c.kind}`) };
    const link: CareerMenuLink | null = career
      ? { available: () => true, open: () => void log.push('career open'), jobActive: () => career.jobActive, abandon: () => void log.push('career abandon') }
      : null;
    const host = { ctx, close() {}, toast() {}, weatherEdited() {}, hudEnabled: true, fpsVisible: false, autopilot: null, showHints() {}, school, career: link };
    const parent = new FakeElement('div');
    const menu = new PauseMenu(parent as unknown as HTMLElement, [], host as never);
    menu.open(tab);
    // The first scenario row: the first button of the grid after the "Scenario" heading.
    const all: FakeElement[] = [];
    const walk = (e: FakeElement): void => {
      all.push(e);
      e.children.forEach(walk);
    };
    walk(parent);
    const heading = all.findIndex((e) => e.tagName === 'h3' && e.textContent === 'Scenario');
    const scenario = all.slice(heading).find((e) => e.classList.contains('scenarios'))?.children[0] ?? null;
    return { parent, log, scenario };
  }

  it('without a Career link: no Career button, and a scenario starts at once (the default path)', async () => {
    const { parent, log, scenario } = await build(null);
    expect(buttons(parent, 'Career')).toHaveLength(0);
    expect(buttons(parent, 'Open Flight School')).toHaveLength(1);
    click(scenario!);
    expect(log).toEqual(['reset runway']);
    expect(confirmTexts(parent)).toEqual([]);
    click(buttons(parent, 'Open Flight School')[0]);
    expect(log).toEqual(['reset runway', 'school openHome']);
  });

  it('with a Career and no job: the Career button opens it, and nothing asks', async () => {
    const { parent, log, scenario } = await build({ jobActive: false });
    click(buttons(parent, 'Career')[0]);
    click(scenario!);
    click(buttons(parent, 'Open Flight School')[0]);
    expect(log).toEqual(['career open', 'reset runway', 'school openHome']);
    expect(confirmTexts(parent)).toEqual([]);
  });

  it('during a job a scenario asks "Abandon the job?"; Keep keeps it, Abandon ends the job and then starts', async () => {
    const { parent, log, scenario } = await build({ jobActive: true });
    click(scenario!);
    expect(log).toEqual([]);
    expect(confirmTexts(parent)[0]).toMatch(/^Abandon the job and start .*\? The job ends with no pay\./);
    click(buttons(parent, 'Keep the job')[0]);
    expect(confirmTexts(parent)).toEqual([]);
    click(scenario!);
    click(buttons(parent, 'Abandon')[0]);
    expect(log).toEqual(['career abandon', 'reset runway']);
  });

  it('during a job the Flight School asks first, from the Flight tab and from the School tab', async () => {
    const flight = await build({ jobActive: true });
    click(buttons(flight.parent, 'Open Flight School')[0]);
    expect(flight.log).toEqual([]);
    expect(confirmTexts(flight.parent)[0]).toContain('Abandon the job and open the Flight School?');
    click(visible(flight.parent).filter((e) => e.tagName === 'button' && e.textContent === 'Abandon')[0]);
    expect(flight.log).toEqual(['career abandon', 'school openHome']);

    // The School tab: the school's own page (its briefings start lessons) is not shown during a job.
    const school = await build({ jobActive: true }, 'school');
    expect(school.log).not.toContain('school page');
    click(buttons(school.parent, 'Keep the job')[0]);
    expect(school.log).toEqual([]);
    click(buttons(school.parent, 'Abandon the job and open the Flight School')[0]);
    expect(school.log).toEqual(['career abandon', 'school openHome']);
    // No job: the school's page as before.
    expect((await build({ jobActive: false }, 'school')).log).toContain('school page');
    expect((await build(null, 'school')).log).toContain('school page');
  });
});
