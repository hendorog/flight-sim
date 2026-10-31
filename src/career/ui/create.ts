// The new-career form (docs/career.md "First open"): pilot name (the school profile's by default), company name,
// the radio callsign word (by default the first word of the company name, shown as the field's placeholder as the
// name is typed) and the first aircraft, a leased Cessna 152 or a leased Cessna 172S (the 172S costs more an hour
// but carries three passengers). Start sends 'create'; the system builds the save (src/career/create.ts).

import { el } from '../../ui/dom';
import { defaultCallsign, DEFAULT_COMPANY_NAME, DEFAULT_PILOT_NAME } from '../create';
import { CAREER_PERF } from '../perf';
import { CLOCK_RULES, START_RULES } from '../types';
import { clockHm, kg, typeName, usd } from './format';
import type { CareerCtx, CareerPageView } from './models';
import { bareKey, button, modal, spacer } from './widgets';

/** The first aircraft a career may start with. */
const STARTS = ['c152', 'c172s'] as const;

/** Most characters of a name field. */
const NAME_MAX = 32;

function textField(parent: HTMLElement, label: string, value: string, placeholder: string, hint: string): HTMLInputElement {
  const row = el('div', 'sc-field cr-formrow', parent);
  el('label', '', row, label);
  const box = el('div', 'cr-inputbox', row);
  const input = el('input', '', box);
  input.type = 'text';
  input.value = value;
  input.placeholder = placeholder;
  input.maxLength = NAME_MAX;
  input.spellcheck = false;
  el('span', 'cr-hint', box, hint);
  return input;
}

/** The new-career form. Enter starts the career; Esc closes the Career. */
export function renderCreate(parent: HTMLElement, ctx: CareerCtx): CareerPageView {
  const m = modal(parent, ctx, 'Start your company', `Day 1, ${clockHm(CLOCK_RULES.startMin)} at the home field, with ${usd(START_RULES.cash)} in the bank and reputation ${START_RULES.reputation}.`, {
    cls: 'cr-create', fit: true, onClose: () => ctx.send({ kind: 'freeFlight' }),
  });
  const grid = el('div', 'cr-create-grid', m.body);
  const form = el('div', 'cr-form', grid);
  el('div', 'sc-section', form, 'Pilot and company');
  const pilot = textField(form, 'Pilot name', ctx.model.suggestedPilotName ?? '', DEFAULT_PILOT_NAME, 'As it appears in the logbook.');
  const company = textField(form, 'Company name', '', DEFAULT_COMPANY_NAME, 'Shown on the hub and the debriefs.');
  const callsign = textField(form, 'Radio callsign', '', defaultCallsign(DEFAULT_COMPANY_NAME), 'One word, said with a flight number: “Fable 12”.');
  const syncCallsign = (): void => {
    callsign.placeholder = defaultCallsign(company.value || DEFAULT_COMPANY_NAME);
  };
  company.addEventListener('input', syncCallsign);

  const pick = el('div', 'cr-form', grid);
  el('div', 'sc-section', pick, 'First aircraft (leased)');
  let start: (typeof STARTS)[number] = 'c152';
  const cards: HTMLButtonElement[] = [];
  const choices = el('div', 'cr-starts', pick);
  for (const t of STARTS) {
    const p = CAREER_PERF[t];
    const b = button(choices, '', () => {
      start = t;
      cards.forEach((c, i) => c.classList.toggle('sel', STARTS[i] === t));
    }, { cls: `cr-start${t === start ? ' sel' : ''}` });
    b.replaceChildren();
    const top = el('div', 'cr-start-top', b);
    el('b', '', top, typeName(t));
    el('span', 'cr-icao', top, p.icaoType);
    el('div', 'cr-start-blurb', b, t === 'c152'
      ? 'The cheapest hour in the sky. One passenger, light freight and mail.'
      : 'Three passengers and a bigger hold: tourer work from the first day.');
    const figs = el('div', 'cr-start-figs', b);
    const fig = (label: string, v: string): void => {
      const d = el('div', '', figs);
      el('span', '', d, label);
      el('b', 'num', d, v);
    };
    fig('Seats', `1 + ${p.paxSeats}`);
    fig('Cruise', `${p.cruiseTasKt} kt`);
    fig('Lease', `${usd(p.leaseHourly)}/h`);
    fig('MTOW', kg(p.mtowKg));
    cards.push(b);
  }
  el('div', 'cr-fine', pick, 'A lease costs its hourly rate for every block hour flown and at least one hour a day while it stands idle. You can lease or buy more aircraft once the company has earned the cash and the reputation.');

  const create = (): void => {
    ctx.send({ kind: 'create', pilotName: pilot.value.trim(), companyName: company.value.trim(), callsign: callsign.value.trim(), start });
  };
  button(m.foot, 'Cancel', () => ctx.send({ kind: 'freeFlight' }), { key: 'Esc' });
  spacer(m.foot);
  el('span', 'sc-note', m.foot, 'Names can be changed later on the pilot page.');
  button(m.foot, 'Start the career', create, { cls: 'primary', key: 'Enter' });
  return {
    root: m.scrim,
    onKey(e) {
      if (bareKey(e, 'Enter', 'NumpadEnter')) {
        create();
        return true;
      }
      if (bareKey(e, 'Escape')) {
        ctx.send({ kind: 'freeFlight' });
        return true;
      }
      return false;
    },
  };
}
