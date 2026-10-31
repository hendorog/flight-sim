// The pilot page (docs/career.md "Progression"): the rank ladder (career block hours and reputation both needed,
// the pay bonus of each rank, progress to the next), hours by class from the logbook (block and airborne, totals,
// night, landings day and night, jobs done and failed by kind: progression.ts careerHours, never stored), the
// ratings shop (bought as training, effective at once: progression.ts ratingRefusal), the company settings
// (names, the radio callsign word, whether the radio uses it) and the save file (export, import by pasting).

import { el } from '../../ui/dom';
import { defaultCallsign } from '../create';
import { careerBlockHours, careerHours, rankOf, ratingRefusal } from '../progression';
import { RANKS, RATINGS, type AircraftClass, type JobKind, type RatingId } from '../types';
import { classShort, hoursDec, kindLabel, usd } from './format';
import type { CareerCtx, CareerPageView } from './models';
import { badge, bareKey, button, confirmButton, modal, section, spacer } from './widgets';

const CLASSES: readonly AircraftClass[] = ['trainer', 'tourer', 'twin', 'turbine', 'heli', 'heliTurbine'];
const KINDS: readonly JobKind[] = ['charter', 'freight', 'mail', 'scenic', 'positioning', 'medevac', 'utility'];
const RATING_IDS: readonly RatingId[] = ['sep', 'mep', 'turbine', 'heli'];
const LICENCE_TEXT = { school: 'licence from the Flight School skill test', declared: 'licence declared (held in real life)', unlock: 'unlocked for this session' } as const;

/** The pilot page. Esc returns to the hub. */
export function renderPilot(parent: HTMLElement, ctx: CareerCtx): CareerPageView {
  const save = ctx.model.save!;
  const back = (): void => ctx.go('hub');
  const rank = rankOf(save);
  const blockH = careerBlockHours(save.logbook);
  const hours = careerHours(save.logbook);
  const m = modal(parent, ctx, save.pilot.name, `${rank.label} · ${hoursDec(blockH)} career block time · reputation ${Math.round(save.reputation)} · ${LICENCE_TEXT[save.pilot.licence]}`, {
    cls: 'cr-pilot', onClose: back,
  });
  const grid = el('div', 'cr-pilot-grid', m.body);

  // Rank ladder.
  const a = el('div', 'cr-col', grid);
  section(a, 'Rank');
  const ladder = el('div', 'cr-ladder', a);
  const at = RANKS.findIndex((r) => r.id === rank.id);
  RANKS.forEach((r, i) => {
    const row = el('div', `cr-rung${i < at ? ' done' : i === at ? ' current' : i === at + 1 ? ' next' : ''}`, ladder);
    el('i', '', row);
    const txt = el('div', 'cr-rung-text', row);
    el('b', '', txt, r.label);
    el('span', '', txt, i === 0 ? 'Where every career starts' : `${r.minHours} h and reputation ${r.minRep}`);
    el('span', 'cr-rung-pay num', row, r.payBonus > 0 ? `+${Math.round(r.payBonus * 100)} % pay` : '');
    if (i === at + 1) {
      const prog = el('div', 'cr-rung-prog', row);
      const bar = (label: string, v: number, need: number): void => {
        const d = el('div', 'cr-prog', prog);
        el('span', '', d, label);
        const track = el('i', 'cr-bar', d);
        el('i', '', track).style.width = `${Math.min(100, (v / need) * 100)}%`;
        el('b', 'num', d, `${label === 'Hours' ? v.toFixed(1) : Math.round(v)} / ${need}`);
      };
      bar('Hours', blockH, r.minHours);
      bar('Reputation', save.reputation, r.minRep);
    }
  });

  // Hours.
  const b = el('div', 'cr-col', grid);
  section(b, 'Hours by class');
  const ht = el('table', 'sc-table', b);
  const hh = el('tr', '', el('thead', '', ht));
  el('th', '', hh, 'Class');
  el('th', 'r', hh, 'Block');
  el('th', 'r', hh, 'Airborne');
  const hb = el('tbody', '', ht);
  for (const c of CLASSES) {
    const h = hours.byClass[c];
    const tr = el('tr', h.blockH > 0 ? '' : 'cr-dimrow', hb);
    el('td', '', tr, classShort(c));
    el('td', 'r num', tr, hoursDec(h.blockH));
    el('td', 'r num', tr, hoursDec(h.airborneH));
  }
  const tot = el('tr', 'cr-totalrow', hb);
  el('td', '', tot, 'Total');
  el('td', 'r num', tot, hoursDec(hours.totalBlockH));
  el('td', 'r num', tot, hoursDec(hours.totalAirborneH));
  const facts = el('div', 'cr-minifacts', b);
  const fact = (label: string, v: string): void => {
    const d = el('div', '', facts);
    el('b', 'num', d, v);
    el('span', '', d, label);
  };
  fact('Night', hoursDec(hours.nightH));
  fact('Landings day', String(hours.landingsDay));
  fact('Landings night', String(hours.landingsNight));
  section(b, 'Jobs');
  const jt = el('table', 'sc-table', b);
  const jh = el('tr', '', el('thead', '', jt));
  el('th', '', jh, 'Kind');
  el('th', 'r', jh, 'Done');
  el('th', 'r', jh, 'Failed');
  const jb = el('tbody', '', jt);
  for (const k of KINDS) {
    if ((k === 'medevac' || k === 'utility') && hours.jobsDone[k] + hours.jobsFailed[k] === 0) continue;
    const tr = el('tr', hours.jobsDone[k] + hours.jobsFailed[k] > 0 ? '' : 'cr-dimrow', jb);
    el('td', '', tr, kindLabel(k));
    el('td', 'r num', tr, String(hours.jobsDone[k]));
    el('td', `r num${hours.jobsFailed[k] > 0 ? ' bad' : ''}`, tr, String(hours.jobsFailed[k]));
  }

  // Ratings, company, save file.
  const c = el('div', 'cr-col', grid);
  section(c, 'Ratings');
  const rl = el('div', 'cr-ratings', c);
  for (const id of RATING_IDS) {
    const r = RATINGS[id];
    const held = save.ratings.includes(id);
    const no = ratingRefusal(save, id);
    const row = el('div', `cr-rating${held ? ' held' : ''}`, rl);
    const txt = el('div', '', row);
    el('b', '', txt, r.label);
    el('span', '', txt, held ? 'Held' : `${usd(r.cost)} · ${r.minHours} h · rep ${r.minRep}${no ? ` · ${no.text}` : ''}`);
    if (held) badge(row, 'Held', 'ok');
    else {
      const buy = confirmButton(row, 'Train', `Pay ${usd(r.cost)}`, () => ctx.send({ kind: 'buyRating', rating: id }), { cls: 'cr-small-btn' });
      buy.disabled = no !== null;
      if (no) buy.title = no.text;
    }
  }

  section(c, 'Company');
  const form = el('div', 'cr-companyform', c);
  const input = (label: string, value: string, placeholder: string): HTMLInputElement => {
    const row = el('label', 'cr-inrow', form);
    el('span', '', row, label);
    const i = el('input', '', row);
    i.type = 'text';
    i.value = value;
    i.placeholder = placeholder;
    i.maxLength = 32;
    return i;
  };
  const company = input('Company', save.company.name, save.company.name);
  const callsign = input('Callsign', save.company.callsign, defaultCallsign(save.company.name));
  const tg = el('label', 'toggle cr-toggle', form);
  const check = el('input', '', tg);
  check.type = 'checkbox';
  check.checked = save.settings.companyCallsign;
  el('span', '', tg, `Use “${save.company.callsign} ${save.flightNo}” on the radio (off: the registration)`);
  const saveBtn = button(form, 'Save company settings', () => ctx.send({
    kind: 'settings', settings: { companyCallsign: check.checked }, companyName: company.value.trim() || undefined, callsign: callsign.value.trim() || undefined,
  }), { cls: 'cr-small-btn' });
  saveBtn.title = 'Names apply from the next job';

  section(c, 'Save file');
  const io = el('div', 'cr-io', c);
  button(io, 'Export to a file', () => ctx.send({ kind: 'exportSave' }), { cls: 'cr-small-btn' });
  const area = el('textarea', 'cr-import', io);
  area.placeholder = 'Paste an exported career (JSON) here to import it';
  area.rows = 2;
  confirmButton(io, 'Import', 'Confirm: replaces this career', () => {
    const json = area.value.trim();
    if (json) ctx.send({ kind: 'importSave', json });
    else ctx.toast('Paste an exported career first');
  }, { cls: 'cr-small-btn cr-danger' });

  button(m.foot, 'Hub', back, { key: 'Esc' });
  spacer(m.foot);
  el('span', 'sc-note', m.foot, 'Hours come from the career logbook. Simulation time; not creditable.');
  return {
    root: m.scrim,
    onKey(e) {
      if (bareKey(e, 'Escape')) {
        back();
        return true;
      }
      return false;
    },
  };
}
