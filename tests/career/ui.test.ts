// Proves the Career pages (src/career/ui/*) on the stand-in DOM (tests/ui/fakeDom.ts), from fixture careers played
// through the pure core (src/career/ui/fixtures.ts) on nine synthetic fields: every page (locked, create, seed, hub,
// reposition, board with its map, dispatch with a defuel and a losesMoney warning, a refused type switch, fleet,
// market, pilot, logbook, stop, bankrupt, debrief) renders with the expected text and disabled states; every button
// sends its command (or does the UI's own navigation); Escape goes back and Enter takes the primary action; the
// board map is north-up and keeps every field and the route inside the frame; the job strip formats early and
// late, the waypoint "2 of 3", the projected reserve and the helicopter spot line.
//
// fakeDom's addEventListener is a no-op and its elements have no click(), so this file records listeners on the
// FakeElement prototype and dispatches them itself (a disabled button ignores clicks, as in a browser).

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadSheet } from '../../src/career/loadsheet';
import { CAREER_PERF } from '../../src/career/perf';
import { mapBounds, MAP_H, MAP_W, project, scaleBarNm, boardMapSvg } from '../../src/career/ui/boardMap';
import { CareerUi, resolvePage } from '../../src/career/ui/careerUi';
import { careerFixture, FIXTURE_SCREENS, playedCareer, type FixtureScreen } from '../../src/career/ui/fixtures';
import { careerClock, minutes, signedUsd, usd } from '../../src/career/ui/format';
import type { CareerUiModel } from '../../src/career/ui/models';
import { JobStrip, stripFuel, stripSpotText, stripTargetText, stripTime } from '../../src/career/ui/strip';
import { offerStatus } from '../../src/career/ui/widgets';
import type { CareerCommand, JobStripModel } from '../../src/career/types';
import { HOME_AIRFIELD, type Airfield, type AirfieldKind } from '../../src/world/airfields';
import { FakeElement, installFakeDom } from '../ui/fakeDom';

// ---- Events on the stand-in DOM -------------------------------------------------------------------------------

type Listener = (e: unknown) => void;
const listeners = new WeakMap<FakeElement, Map<string, Listener[]>>();
const proto = FakeElement.prototype as unknown as Record<string, unknown>;
const saved = { add: proto.addEventListener, click: proto.click };

function fire(el: FakeElement, type: string, extra: Record<string, unknown> = {}): void {
  for (const fn of listeners.get(el)?.get(type) ?? []) fn({ stopPropagation() {}, preventDefault() {}, target: el, ...extra });
}

beforeAll(() => {
  installFakeDom();
  proto.addEventListener = function (this: FakeElement, type: string, fn: Listener) {
    const m = listeners.get(this) ?? new Map<string, Listener[]>();
    m.set(type, [...(m.get(type) ?? []), fn]);
    listeners.set(this, m);
  };
  proto.click = function (this: FakeElement & { disabled?: boolean }) {
    if (!this.disabled) fire(this, 'click');
  };
});

afterAll(() => {
  proto.addEventListener = saved.add;
  proto.click = saved.click;
  vi.unstubAllGlobals();
});

// ---- The world: the home field and eight synthetic fields around it -------------------------------------------

function field(code: string, name: string, kind: AirfieldKind, length: number, north: number, east: number, headingDeg: number): Airfield {
  return {
    code, name, kind, north, east, elevation: 60, heading: (headingDeg * Math.PI) / 180, ids: ['09', '27'], length, width: kind === 'grass' ? 25 : 23,
    flatMargin: 50, blend: 100, approachLength: 1000, circuit: 'left', frequency: 122.5, apronAlong: 200,
  };
}

const FIELDS: readonly Airfield[] = [
  HOME_AIRFIELD,
  field('XALD', 'Aldbury Aerodrome', 'sealed', 1100, 24000, 9000, 40),
  field('XBRK', 'Brookfold Airstrip', 'grass', 620, 15000, -21000, 110),
  field('XCAV', 'Cavendale Regional', 'sealed', 1400, -26000, 14000, 160),
  field('XDUN', 'Dunmere Airstrip', 'grass', 520, -12000, -30000, 80),
  field('XELM', 'Elmley Aerodrome', 'sealed', 900, 36000, -14000, 20),
  field('XFEN', 'Fenwick Airfield', 'grass', 780, -38000, -8000, 130),
  field('XGLE', 'Glenholt Aerodrome', 'sealed', 1250, 8000, 33000, 60),
  field('XHOL', 'Holthurst Airstrip', 'grass', 450, -6000, 22000, 170),
];

// ---- Mounting and finding ---------------------------------------------------------------------------------------

interface Mounted {
  ui: CareerUi;
  layer: FakeElement;
  sent: CareerCommand[];
  model: CareerUiModel;
  changes: boolean[];
}

const fixtures = new Map<FixtureScreen, ReturnType<typeof careerFixture>>();
function fixture(s: FixtureScreen): ReturnType<typeof careerFixture> {
  if (!fixtures.has(s)) fixtures.set(s, careerFixture(s, FIELDS));
  return structuredClone(fixtures.get(s)!);
}

function mount(screen: FixtureScreen, over: Partial<CareerUiModel> = {}): Mounted {
  const fx = fixture(screen);
  const layer = new FakeElement('div');
  const ui = new CareerUi(layer as unknown as HTMLElement);
  const sent: CareerCommand[] = [];
  const changes: boolean[] = [];
  ui.onCommand = (c) => sent.push(c);
  ui.onScreenChange = (open) => changes.push(open);
  const model = { ...fx.model, ...over };
  ui.setModel(model);
  if (fx.dispatchOfferId) ui.setDispatchOffer(fx.dispatchOfferId);
  if (fx.memo) ui.presetMemo(fx.memo);
  if (fx.strip) ui.setStrip(fx.strip.model, { canAbandon: fx.strip.canAbandon });
  if (fx.page) ui.open(fx.page);
  return { ui, layer, sent, model, changes };
}

function walk(root: FakeElement, out: FakeElement[] = []): FakeElement[] {
  for (const c of root.children) {
    out.push(c);
    walk(c, out);
  }
  return out;
}

/** The buttons whose label (the first span: the key cap is the second) is exactly `label`. */
function buttons(root: FakeElement, label: string): (FakeElement & { disabled?: boolean })[] {
  return walk(root).filter((e) => e.tagName === 'button' && (e.children[0]?.textContent ?? e.textContent) === label);
}

function button(root: FakeElement, label: string): FakeElement & { disabled?: boolean; title?: string } {
  const b = buttons(root, label);
  if (b.length === 0) throw new Error(`no button "${label}" in: ${walk(root).filter((e) => e.tagName === 'button').map((e) => e.children[0]?.textContent ?? e.textContent).join(' | ')}`);
  return b[0];
}

const click = (b: FakeElement): void => (b as unknown as { click(): void }).click();
const key = (ui: CareerUi, code: string): boolean => ui.handleKey({ code, repeat: false, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, target: null } as unknown as KeyboardEvent);
const text = (m: Mounted): string => m.layer.textContent;
const byClass = (root: FakeElement, cls: string): FakeElement[] => root.findAll(cls);

// ---- Tests ------------------------------------------------------------------------------------------------------

describe('the fixtures', () => {
  it('play a real career: a dozen settled jobs, several aircraft and a two-page logbook', () => {
    const s = playedCareer(FIELDS);
    expect(s.logbook.filter((e) => e.kind === 'job').length).toBeGreaterThanOrEqual(10);
    expect(s.logbook.length).toBeGreaterThan(10);
    expect(s.fleet.map((a) => a.type)).toEqual(expect.arrayContaining(['c152', 'pa38', 'pc12', 'r44']));
    expect(s.clockMin % 1440).toBe(10 * 60 + 40);
  });

  it('render every screen with a Career root or the job strip, and nothing else needed', () => {
    for (const s of FIXTURE_SCREENS) {
      const m = mount(s);
      const roots = byClass(m.layer, 'cr-root').length + byClass(m.layer, 'cr-strip').filter((e) => !e.classList.contains('hidden')).length;
      expect(roots, s).toBeGreaterThan(0);
    }
  });
});

describe('page gates and the modal link', () => {
  it('resolve to locked without a licence, create without a save, seed in another world and bankrupt when overdrawn', () => {
    const base = fixture('hub').model;
    expect(resolvePage('hub', { ...base, save: null, licence: null })).toBe('locked');
    expect(resolvePage('hub', { ...base, save: null, licence: 'declared' })).toBe('create');
    expect(resolvePage('board', { ...base, worldSeed: 9 })).toBe('seed');
    expect(resolvePage('fleet', { ...base, save: { ...base.save!, cash: -6000 } })).toBe('bankrupt');
    expect(resolvePage('debrief', { ...base, save: { ...base.save!, cash: -6000 } })).toBe('debrief');
    expect(resolvePage('create', base)).toBe('hub');
  });

  it('report the screen open and closed, and keys do nothing once closed', () => {
    const m = mount('hub');
    expect(m.ui.screenOpen()).toBe(true);
    expect(m.changes).toEqual([true]);
    m.ui.close();
    expect(m.ui.screenOpen()).toBe(false);
    expect(m.changes).toEqual([true, false]);
    expect(key(m.ui, 'Escape')).toBe(false);
  });
});

describe('the locked page', () => {
  it('asks for the skill test and declares a licence on the button or Enter', () => {
    const m = mount('locked');
    expect(text(m)).toContain('Pass the skill test (lesson 21) to start a career');
    click(button(m.layer, 'I already hold a licence'));
    expect(key(m.ui, 'Enter')).toBe(true);
    expect(m.sent).toEqual([{ kind: 'declareLicence' }, { kind: 'declareLicence' }]);
  });

  it('closes to free flight on Escape', () => {
    const m = mount('locked');
    key(m.ui, 'Escape');
    expect(m.sent).toEqual([{ kind: 'freeFlight' }]);
    expect(m.ui.screenOpen()).toBe(false);
  });
});

describe('the new-career form', () => {
  it('sends the typed names and the chosen first aircraft, and suggests the callsign from the company', () => {
    const m = mount('create');
    const inputs = walk(m.layer).filter((e) => e.tagName === 'input') as unknown as { value: string; placeholder: string }[];
    expect(inputs[0].value).toBe('Alex Morgan');
    inputs[1].value = 'Skylark Charter';
    fire(inputs[1] as unknown as FakeElement, 'input');
    expect(inputs[2].placeholder).toBe('Skylark');
    const starts = byClass(m.layer, 'cr-start');
    expect(starts.map((s) => s.textContent)).toEqual([expect.stringContaining('Cessna 152'), expect.stringContaining('Cessna 172S')]);
    click(starts[1]);
    expect(starts[1].classList.contains('sel')).toBe(true);
    click(button(m.layer, 'Start the career'));
    expect(m.sent).toEqual([{ kind: 'create', pilotName: 'Alex Morgan', companyName: 'Skylark Charter', callsign: '', start: 'c172s' }]);
    key(m.ui, 'Enter');
    expect(m.sent).toHaveLength(2);
  });
});

describe('the seed page', () => {
  it('names both worlds, switches back on Enter and starts again only after a confirm', () => {
    const m = mount('seed');
    expect(text(m)).toContain('This career lives in world 0; the sim has world 7 loaded');
    expect(key(m.ui, 'Enter')).toBe(true);
    const fresh = button(m.layer, 'Start a new career in this world');
    click(fresh);
    expect(m.sent).toEqual([{ kind: 'switchWorld' }]);
    click(fresh);
    click(button(m.layer, 'Export this career to a file'));
    expect(m.sent).toEqual([{ kind: 'switchWorld' }, { kind: 'reset' }, { kind: 'exportSave' }]);
  });
});

describe('the hub', () => {
  it('shows the company, cash, clock, reputation and the selected aircraft where it stands', () => {
    const m = mount('hub');
    const s = m.model.save!;
    const ac = s.fleet.find((a) => a.uid === s.selectedUid)!;
    expect(text(m)).toContain('Fable Air');
    expect(text(m)).toContain(usd(s.cash));
    expect(text(m)).toContain(careerClock(s.clockMin));
    expect(text(m)).toContain(`${ac.registration} · Cessna 152`);
    expect(text(m)).toContain(`(${ac.field}) · ${Math.round(ac.fuelKg)} kg fuel`);
    expect(byClass(m.layer, 'cr-rep')[0].textContent).toBe('48');
  });

  it('navigates locally to the board, reposition, fleet, pilot and logbook', () => {
    for (const [label, page] of [['Job board', 'board'], ['Reposition', 'reposition'], ['Fleet', 'fleet'], ['Pilot', 'pilot'], ['Logbook', 'logbook']] as const) {
      const m = mount('hub');
      click(button(m.layer, label));
      expect(m.ui.page(), label).toBe(page);
      expect(m.sent).toEqual([]);
    }
    const m = mount('hub');
    expect(key(m.ui, 'Enter')).toBe(true);
    expect(m.ui.page()).toBe('board');
  });

  it('sends rest, select, free flight (closing the pages) and shows the last debrief', () => {
    const m = mount('hub');
    const s = m.model.save!;
    click(button(m.layer, 'Rest until tomorrow'));
    const other = s.fleet.find((a) => a.uid !== s.selectedUid)!;
    click(button(m.layer, other.registration));
    click(button(m.layer, 'Free flight'));
    expect(m.sent).toEqual([{ kind: 'rest' }, { kind: 'select', uid: other.uid }, { kind: 'freeFlight' }]);
    expect(m.ui.screenOpen()).toBe(false);
    const n = mount('hub');
    click(button(n.layer, 'Debrief'));
    expect(n.ui.page()).toBe('debrief');
  });

  it('with a job in progress refuses the board, reposition and rest, and offers the flight back', () => {
    const m = mount('hub-job');
    expect(button(m.layer, 'Job board').disabled).toBe(true);
    expect(button(m.layer, 'Reposition').disabled).toBe(true);
    expect(button(m.layer, 'Rest until tomorrow').disabled).toBe(true);
    expect(text(m)).toContain('Job in progress');
    expect(text(m)).toContain('min left');
    key(m.ui, 'Enter');
    expect(m.sent).toEqual([{ kind: 'freeFlight' }]);
  });

  it('offers Switch to the type a waiting job needs, and the debrief of a pending crash', () => {
    const fx = fixture('hub-job');
    const job = { ...fx.model.save!.active!, placed: false, type: 'c172s' as const };
    const m = mount('hub', { save: { ...fx.model.save!, active: job } });
    click(button(m.layer, 'Switch to Cessna 172S'));
    expect(m.sent).toEqual([{ kind: 'switchTo' }]);
    const report = fixture('debrief-crash').model.save!.lastSettlement!.report;
    const p = mount('hub', { save: { ...fx.model.save!, active: { ...fx.model.save!.active!, pendingReport: report } } });
    expect(text(p)).toContain('The flight ended: crashed');
    key(p.ui, 'Enter');
    expect(p.sent).toEqual([{ kind: 'settlePending', then: 'debrief' }]);
  });

  it('says to finish the lesson first while the Flight School flies', () => {
    const m = mount('hub', { inLesson: true });
    expect(text(m)).toContain('Finish or end the lesson first');
    expect(button(m.layer, 'Job board').disabled).toBe(true);
    expect(button(m.layer, 'Fleet').disabled).toBe(true);
  });
});

describe('the job board', () => {
  it('lists the untaken offers with aligned figures, greys the ones nothing here can fly with the reason', () => {
    const m = mount('board');
    const s = m.model.save!;
    const offers = m.model.board.filter((o) => !s.taken.includes(o.id));
    const rows = byClass(m.layer, 'cr-offer');
    expect(rows).toHaveLength(offers.length);
    offers.forEach((o, i) => {
      const st = offerStatus(o, m.model);
      expect(rows[i].classList.contains('locked'), o.id).toBe(!st.ok);
      expect(rows[i].textContent).toContain(usd(o.pay));
      if (!st.ok) expect(rows[i].textContent).toContain(st.reason!);
    });
    expect(offers.some((o) => !offerStatus(o, m.model).ok)).toBe(true);
    const reasons = offers.map((o) => offerStatus(o, m.model).reason).filter(Boolean).join(' / ');
    expect(reasons).toMatch(/Needs reputation \d+|Needs an? |Too heavy for the |Too many passengers|Runway too short|No grass strips/);
  });

  it('hides a taken offer', () => {
    const fx = fixture('board');
    const first = fx.model.board.find((o) => !fx.model.save!.taken.includes(o.id))!;
    const m = mount('board', { save: { ...fx.model.save!, taken: [...fx.model.save!.taken, first.id] } });
    expect(byClass(m.layer, 'cr-offer')).toHaveLength(fx.model.board.filter((o) => !fx.model.save!.taken.includes(o.id)).length - 1);
    expect(byClass(m.layer, 'cr-offer').some((r) => r.textContent.includes(first.title) && r.textContent.includes(first.client))).toBe(false);
  });

  it('moves the highlight with the arrow keys, draws its route and dispatches it on Enter', () => {
    const m = mount('board');
    const ok = m.model.board.filter((o) => !m.model.save!.taken.includes(o.id) && offerStatus(o, m.model).ok);
    const sel = (): number => byClass(m.layer, 'cr-offer').findIndex((r) => r.classList.contains('sel'));
    const start = sel();
    key(m.ui, 'ArrowDown');
    expect(sel()).toBe(Math.min(start + 1, m.model.board.length - 1));
    key(m.ui, 'ArrowUp');
    expect(sel()).toBe(start);
    expect(byClass(m.layer, 'cr-map')[0].innerHTML).toContain('cr-map-route');
    expect(byClass(m.layer, 'cr-map')[0].innerHTML).toContain(`>${FIELDS[1].code}<`);
    key(m.ui, 'Enter');
    expect(m.sent).toEqual([{ kind: 'dispatch', offerId: ok[0].id }]);
    expect(m.ui.page()).toBe('dispatch');
  });

  it('refuses Dispatch on a greyed offer and returns to the hub on Escape', () => {
    const m = mount('board');
    const rows = byClass(m.layer, 'cr-offer');
    const locked = rows.findIndex((r) => r.classList.contains('locked'));
    fire(rows[locked], 'click');
    expect(button(m.layer, 'Dispatch').disabled).toBe(true);
    fire(rows[locked], 'dblclick');
    key(m.ui, 'Enter');
    expect(m.sent).toEqual([]);
    key(m.ui, 'Escape');
    expect(m.ui.page()).toBe('hub');
  });
});

describe('the board map', () => {
  it('is north-up with east to the right, and keeps every field inside the frame', () => {
    const b = mapBounds(FIELDS);
    const [xA, yA] = project(b, 1000, 0);
    const [xB, yB] = project(b, 0, 1000);
    expect(yA).toBeLessThan(project(b, 0, 0)[1]);
    expect(xB).toBeGreaterThan(project(b, 0, 0)[0]);
    expect(xA).toBeCloseTo(project(b, 0, 0)[0], 9);
    expect(yB).toBeCloseTo(project(b, 0, 0)[1], 9);
    for (const f of FIELDS) {
      const [x, y] = project(b, f.north, f.east);
      expect(x).toBeGreaterThanOrEqual(30);
      expect(x).toBeLessThanOrEqual(MAP_W - 30);
      expect(y).toBeGreaterThanOrEqual(30);
      expect(y).toBeLessThanOrEqual(MAP_H - 30);
    }
    expect([1, 2, 5, 10, 20]).toContain(scaleBarNm(200));
  });

  it('draws a scenic offer as a loop through its numbered turning points, inside the frame', () => {
    const fx = fixture('board');
    const scenic = fx.model.board.find((o) => (o.waypoints?.length ?? 0) > 0);
    if (!scenic) return;
    const svg = boardMapSvg(FIELDS, scenic.origin, scenic);
    expect(svg).toContain('<polyline class="cr-map-route"');
    expect(svg).toContain(`>${scenic.waypoints!.length}</text>`);
    const b = mapBounds(FIELDS, scenic.waypoints);
    for (const w of scenic.waypoints!) {
      const [x, y] = project(b, w.north, w.east);
      expect(x > 0 && x < MAP_W && y > 0 && y < MAP_H).toBe(true);
    }
  });
});

describe('dispatch', () => {
  it('starts an overweight Tomahawk at the most the load allows, defuelling with the credit, and accepts that', () => {
    const m = mount('dispatch');
    const s = m.model.save!;
    const pa38 = s.fleet.find((a) => a.type === 'pa38')!;
    const offer = m.model.board.find((o) => o.id === fixture('dispatch').dispatchOfferId)!;
    const sheet = loadSheet(offer, pa38, CAREER_PERF.pa38.usableFuelKg, s, FIELDS);
    expect(sheet.maxFuelKg).toBeLessThan(pa38.fuelKg);
    expect(text(m)).toContain('(half-price credit)');
    const ok = loadSheet(offer, pa38, sheet.maxFuelKg, s, FIELDS);
    expect(text(m)).toContain(signedUsd(ok.defuelCredit));
    expect(ok.ok).toBe(true);
    expect(button(m.layer, 'Accept').disabled).toBe(false);
    key(m.ui, 'Enter');
    expect(m.sent).toEqual([{ kind: 'accept', offerId: offer.id, uid: pa38.uid, fuelKg: sheet.maxFuelKg }]);
    // The figure sent passes the same load sheet the system will run (no rounding past MTOW).
    const sent = m.sent[0] as Extract<CareerCommand, { kind: 'accept' }>;
    expect(loadSheet(offer, pa38, sent.fuelKg, s, FIELDS).ok).toBe(true);
  });

  it('blocks Accept below the required fuel with the red warning, and allows it again at Required', () => {
    const m = mount('dispatch');
    const slider = walk(m.layer).find((e) => e.className === 'cr-slider')! as unknown as FakeElement & { value: string };
    slider.value = '2';
    fire(slider, 'input');
    expect(button(m.layer, 'Accept').disabled).toBe(true);
    expect(byClass(m.layer, 'cr-warn').some((w) => w.classList.contains('block') && w.textContent.includes('below the'))).toBe(true);
    click(walk(m.layer).find((e) => e.tagName === 'button' && e.textContent.startsWith('Required'))!);
    expect(byClass(m.layer, 'cr-warn').some((w) => w.classList.contains('block') && w.textContent.includes('below the'))).toBe(false);
    expect(button(m.layer, 'Accept').disabled).toBe(false);
    key(m.ui, 'Enter');
    // Exactly the required fuel, which the system's sheet accepts (a 0.1 kg rounding down would be fuelShort).
    const sent = m.sent[0] as Extract<CareerCommand, { kind: 'accept' }>;
    const s = m.model.save!;
    const offer = m.model.board.find((o) => o.id === sent.offerId)!;
    const ac = s.fleet.find((a) => a.uid === sent.uid)!;
    expect(sent.fuelKg).toBe(loadSheet(offer, ac, ac.fuelKg, s, FIELDS).requiredFuelKg);
    expect(loadSheet(offer, ac, sent.fuelKg, s, FIELDS).ok).toBe(true);
  });

  it('refuses another offer while a job is in progress, on the board and on the dispatch page', () => {
    const fx = fixture('dispatch');
    const other = fixture('hub-job').model.save!.active!;
    const m = mount('dispatch', { save: { ...fx.model.save!, active: { ...other, offer: { ...other.offer, id: 'elsewhere' } } } });
    expect(button(m.layer, 'Accept').disabled).toBe(true);
    expect(text(m)).toContain('One job at a time');
    key(m.ui, 'Enter');
    expect(m.sent).toEqual([]);
    key(m.ui, 'Escape');
    expect(m.ui.page()).toBe('board');
    expect(byClass(m.layer, 'cr-offer').every((r) => r.classList.contains('locked'))).toBe(true);
    expect(text(m)).toContain('Finish the job in progress first');
    expect(button(m.layer, 'Dispatch').disabled).toBe(true);
  });

  it('warns that a PC-12 on a trainer job loses money, lists the aircraft away as disabled, and keeps Accept allowed', () => {
    const m = mount('dispatch');
    const s = m.model.save!;
    const pc12 = s.fleet.find((a) => a.type === 'pc12')!;
    const r44 = s.fleet.find((a) => a.type === 'r44')!;
    const pick = (reg: string): FakeElement & { disabled?: boolean } => byClass(m.layer, 'cr-pick').find((p) => p.textContent.startsWith(reg))!;
    expect(pick(r44.registration).disabled).toBe(true);
    expect(pick(r44.registration).textContent).toContain(`At ${r44.field}`);
    click(pick(pc12.registration));
    expect(byClass(m.layer, 'cr-warn').some((w) => w.classList.contains('warn') && w.textContent.startsWith('Estimated to lose'))).toBe(true);
    expect(text(m)).toContain('Accept reloads the sim into the PC-12 first');
    if (button(m.layer, 'Accept').disabled) throw new Error(byClass(m.layer, 'cr-warn').map((w) => w.textContent).join(' / '));
    expect(button(m.layer, 'Accept').disabled).toBe(false);
    key(m.ui, 'Enter');
    expect(m.sent[0]).toMatchObject({ kind: 'accept', uid: pc12.uid });
  });

  it('refuses a type switch with the memory store, and returns to the board on Escape', () => {
    const m = mount('dispatch-switch');
    expect(text(m)).toContain('kept in memory only (cstore=mem)');
    expect(button(m.layer, 'Accept').disabled).toBe(true);
    key(m.ui, 'Enter');
    expect(m.sent).toEqual([]);
    key(m.ui, 'Escape');
    expect(m.ui.page()).toBe('board');
  });
});

describe('reposition', () => {
  it('lists every other field with its cost, flies to the highlighted one and refuses a strip the type cannot use', () => {
    const m = mount('reposition');
    const rows = byClass(m.layer, 'cr-offer');
    expect(rows).toHaveLength(FIELDS.length - 1);
    expect(text(m)).toContain('no pay, the fuel, fees and hours are the company’s');
    const okRow = rows.findIndex((r) => !r.classList.contains('locked'));
    fire(rows[okRow], 'click');
    click(button(m.layer, 'Fly there'));
    expect(m.sent).toHaveLength(1);
    expect(m.sent[0].kind).toBe('reposition');
    key(m.ui, 'Escape');
    expect(m.ui.page()).toBe('hub');
  });
});

describe('the stop page', () => {
  it('shows the rest of the way, refuels when short (Enter), continues and gives up only after a confirm', () => {
    const m = mount('stop');
    const job = m.model.save!.active!;
    expect(text(m)).toContain('Stopped at');
    expect(text(m)).toContain('The rest of the way');
    expect(text(m)).toContain('Fuel required');
    key(m.ui, 'Enter');
    const refuel = m.sent[0] as Extract<CareerCommand, { kind: 'refuel' }>;
    expect(refuel.kind).toBe('refuel');
    expect(refuel.fuelKg).toBeGreaterThan(9.5);
    click(button(m.layer, 'Continue'));
    const give = button(m.layer, 'Give up');
    click(give);
    expect(m.sent.map((c) => c.kind)).toEqual(['refuel', 'continueJob']);
    click(give);
    expect(m.sent.map((c) => c.kind)).toEqual(['refuel', 'continueJob', 'giveUp']);
    expect(job.phase).toBe('stopped');
  });
});

describe('fleet and market', () => {
  it('selects, defuels (inline, with the credit), sells an owned aircraft and returns a lease after confirms', () => {
    const m = mount('fleet');
    const s = m.model.save!;
    const pc12 = s.fleet.find((a) => a.type === 'pc12')!;
    const pa38 = s.fleet.find((a) => a.type === 'pa38')!;
    click(buttons(m.layer, 'Select')[0]);
    expect(m.sent[0]).toEqual({ kind: 'select', uid: s.fleet.find((a) => a.uid !== s.selectedUid)!.uid });
    const rowOf = (reg: string): FakeElement => walk(m.layer).find((e) => e.tagName === 'tr' && e.textContent.startsWith(reg))!;
    click(button(rowOf(pa38.registration), 'Defuel'));
    expect(text(m)).toContain(`Drain ${pa38.registration} to`);
    click(button(m.layer, 'Drain'));
    expect(m.sent[1]).toEqual({ kind: 'defuel', uid: pa38.uid, fuelKg: Math.round(pa38.fuelKg / 2) });
    const sell = button(rowOf(pc12.registration), 'Sell');
    click(sell);
    expect(m.sent).toHaveLength(2);
    click(sell);
    expect(m.sent[2]).toEqual({ kind: 'sell', uid: pc12.uid });
    const ret = button(rowOf(pa38.registration), 'Return');
    click(ret);
    click(ret);
    expect(m.sent[3]).toEqual({ kind: 'returnLease', uid: pa38.uid });
  });

  it('shows the market with the lease refused for reputation and allowed for a trainer', () => {
    const m = mount('market');
    const rowOf = (name: string): FakeElement => walk(m.layer).find((e) => e.tagName === 'tr' && e.textContent.startsWith(name))!;
    const pc12 = rowOf('PC-12');
    expect(button(pc12, 'Lease').disabled).toBe(true);
    expect(button(pc12, 'Lease').title).toBe('Needs reputation 60');
    const c152 = rowOf('Cessna 152');
    const lease = button(c152, 'Lease');
    expect(lease.disabled).toBe(false);
    click(lease);
    click(lease);
    expect(m.sent).toEqual([{ kind: 'lease', type: 'c152' }]);
    click(button(m.layer, 'Your fleet'));
    expect(text(m)).toContain('Hours');
  });
});

describe('the pilot page', () => {
  it('shows the rank ladder and hours by class, trains a rating after a confirm, saves settings, exports and imports', () => {
    const m = mount('pilot');
    expect(text(m)).toContain('Junior pilot');
    expect(text(m)).toContain('Chief pilot');
    expect(text(m)).toContain('Hours by class');
    expect(byClass(m.layer, 'cr-rating').filter((r) => r.classList.contains('held'))).toHaveLength(4);
    const m2 = mount('pilot', { save: { ...fixture('pilot').model.save!, ratings: ['sep', 'heli'], cash: 50000 } });
    const train = buttons(m2.layer, 'Train');
    expect(train.length).toBe(2);
    const usable = train.find((b) => !b.disabled);
    expect(usable).toBeDefined();
    click(usable!);
    expect(m2.sent).toEqual([]);
    click(usable!);
    expect(m2.sent[0].kind).toBe('buyRating');
    m2.sent.length = 0;
    click(button(m2.layer, 'Save company settings'));
    const check = walk(m2.layer).find((e) => e.tagName === 'input' && (e as unknown as { type: string }).type === 'checkbox') as unknown as { checked: boolean };
    expect(m2.sent[0]).toMatchObject({ kind: 'settings', settings: { companyCallsign: check.checked }, companyName: 'Fable Air', callsign: 'Fable' });
    click(button(m2.layer, 'Export to a file'));
    const area = walk(m2.layer).find((e) => e.tagName === 'textarea') as unknown as { value: string };
    area.value = '{"format":"fs-career"}';
    const imp = button(m2.layer, 'Import');
    click(imp);
    click(imp);
    expect(m2.sent.slice(1)).toEqual([{ kind: 'exportSave' }, { kind: 'importSave', json: '{"format":"fs-career"}' }]);
  });
});

describe('the logbook', () => {
  it('shows ten lines a page, newest page first, with page totals, and turns pages with the arrows', () => {
    const m = mount('logbook');
    const n = m.model.save!.logbook.length;
    const pages = Math.ceil(n / 10);
    expect(text(m)).toContain(`Page ${pages} of ${pages}`);
    expect(text(m)).toContain('Totals this page');
    expect(text(m)).toContain('Totals to date');
    key(m.ui, 'ArrowLeft');
    expect(text(m)).toContain(`Page ${pages - 1} of ${pages}`);
    const body = walk(m.layer).find((e) => e.tagName === 'tbody')!;
    expect(body.children).toHaveLength(10);
    key(m.ui, 'Escape');
    expect(m.ui.page()).toBe('hub');
  });
});

describe('the bankruptcy page', () => {
  it('offers the bank sale when it clears the overdraft, else only the restart after a confirm', () => {
    const m = mount('bankrupt');
    expect(text(m)).toContain('The bank has called in the overdraft');
    click(button(m.layer, 'The bank sells your owned aircraft'));
    expect(m.sent).toEqual([{ kind: 'bankruptcy', choice: 'sellOwned' }]);
    const fx = fixture('bankrupt');
    const deep = mount('bankrupt', { save: { ...fx.model.save!, cash: -900000 } });
    expect(buttons(deep.layer, 'The bank sells your owned aircraft')).toHaveLength(0);
    expect(text(deep)).toContain('Selling the owned aircraft would not clear the overdraft.');
    key(deep.ui, 'Enter');
    expect(deep.sent).toEqual([]);
    key(deep.ui, 'Enter');
    expect(deep.sent).toEqual([{ kind: 'bankruptcy', choice: 'restart' }]);
    // Free flight leaves without choosing; the Career opens on this page again.
    key(deep.ui, 'Escape');
    expect(deep.sent.at(-1)).toEqual({ kind: 'freeFlight' });
    expect(deep.ui.screenOpen()).toBe(false);
    deep.ui.open('hub');
    expect(deep.ui.page()).toBe('bankrupt');
  });
});

describe('the debrief', () => {
  it('shows the outcome, every money line, the net and the reputation, and goes to the board on Enter', () => {
    const m = mount('debrief');
    const s = m.model.save!.lastSettlement!;
    expect(byClass(m.layer, 'sc-outcome')[0].textContent).toBe('Completed');
    for (const l of s.lines) expect(text(m)).toContain(l.label);
    expect(text(m)).toContain(signedUsd(s.net));
    expect(text(m)).toContain(s.summary);
    expect(text(m)).toContain('Landing');
    key(m.ui, 'Enter');
    expect(m.ui.page()).toBe('board');
    const c = mount('debrief-crash');
    expect(byClass(c.layer, 'sc-outcome')[0].textContent).toBe('Crashed');
    expect(text(c)).toContain('Nose gear collapsed');
    key(c.ui, 'Escape');
    expect(c.ui.page()).toBe('hub');
  });
});

describe('the job strip', () => {
  const base: JobStripModel = {
    title: '2 passengers to Holthurst', target: 'XHOL Holthurst Airstrip', distanceNm: 12.44, bearingDeg: 87, etaMin: 14, remainingMin: 22,
    enduranceMin: 120, projectedReserveMin: 38, waypointIndex: null, waypointsTotal: null, windDirDeg: 270, windKt: 12, spotDistM: null,
    comfort: 92, phase: 'airborne', hint: 'Fly to the destination',
  };

  it('formats early, projected late and past the deadline', () => {
    expect(stripTime(base)).toEqual({ text: '8 min early', sub: 'ETA 14 min · 22 min left', tone: 'green' });
    expect(stripTime({ ...base, etaMin: 19 }).tone).toBe('amber');
    expect(stripTime({ ...base, etaMin: 25 })).toMatchObject({ text: '3 min late', tone: 'amber' });
    expect(stripTime({ ...base, remainingMin: -6 })).toEqual({ text: '6 min late', sub: 'ETA 14 min', tone: 'red' });
    expect(minutes(65)).toBe('1 h 05 min');
  });

  it('formats the target with "2 of 3" on a scenic flight, the projected reserve and the helicopter spot', () => {
    expect(stripTargetText(base)).toBe('XHOL Holthurst Airstrip · 12.4 NM · 087°');
    expect(stripTargetText({ ...base, target: 'Point B, 7 NM north-east', waypointIndex: 1, waypointsTotal: 3 })).toBe('2 of 3 · Point B, 7 NM north-east · 12.4 NM · 087°');
    expect(stripFuel(base)).toEqual({ text: 'Reserve 38 min', sub: 'Endurance 2 h', tone: 'green' });
    expect(stripFuel({ ...base, projectedReserveMin: 15 }).tone).toBe('amber');
    expect(stripFuel({ ...base, projectedReserveMin: -4 })).toMatchObject({ text: 'Short 4 min', tone: 'red' });
    expect(stripSpotText(base)).toBeNull();
    expect(stripSpotText({ ...base, spotDistM: 41.6 })).toBe('Spot 42 m');
  });

  it('shows the model, hides for null, and its Abandon sends abandon through the UI when allowed', () => {
    const layer = new FakeElement('div');
    const strip = new JobStrip(layer as unknown as HTMLElement);
    strip.update({ ...base, spotDistM: 30 });
    expect(strip.root.classList.contains('hidden')).toBe(false);
    expect(strip.root.textContent).toContain('8 min early');
    expect(strip.root.textContent).toContain('Spot 30 m');
    expect(strip.root.textContent).toContain('270° / 12 kt');
    strip.update(null);
    expect(strip.root.classList.contains('hidden')).toBe(true);

    const m = mount('strip');
    expect(m.ui.screenOpen()).toBe(false);
    expect(m.ui.stripVisible).toBe(true);
    m.ui.open('hub');
    expect(m.ui.stripVisible).toBe(false);
    m.ui.close();
    expect(m.ui.stripVisible).toBe(true);
    const ab = byClass(m.layer, 'cr-abandon')[0];
    expect(ab.classList.contains('hidden')).toBe(true);
    m.ui.setStrip(fixture('strip').strip!.model, { canAbandon: true });
    expect(ab.classList.contains('hidden')).toBe(false);
    fire(ab, 'click');
    expect(m.sent).toEqual([{ kind: 'abandon' }]);
    expect(byClass(m.layer, 'cr-strip')[0].textContent).toContain('2 of 3');
  });
});
