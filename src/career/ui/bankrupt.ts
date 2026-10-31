// The bankruptcy page (docs/career.md "Bankruptcy"): below the overdraft the bank steps in. "The bank sells your
// owned aircraft" (each at its sale value, leases kept) is offered only when that lifts the cash above the
// overdraft (progression.ts bankruptcyOptions); "Start a new career" always is. Both send 'bankruptcy'. Free flight
// (Esc) closes the pages without choosing; the Career opens on this page again until one is chosen.

import { el } from '../../ui/dom';
import { CAREER_PERF } from '../perf';
import { bankruptcyOptions, saleValue } from '../progression';
import { START_RULES } from '../types';
import { typeName, usd } from './format';
import type { CareerCtx, CareerPageView } from './models';
import { bareKey, button, confirmButton, kv } from './widgets';

/** The bankruptcy page. Enter takes the first offered choice (the sale, or the restart after its confirm); Esc is Free flight. */
export function renderBankrupt(parent: HTMLElement, ctx: CareerCtx): CareerPageView {
  const save = ctx.model.save!;
  const options = bankruptcyOptions(save);
  const scrim = el('div', 'scrim cr-root cr-bankrupt', parent);
  const card = el('div', 'card cr-small wide', scrim);
  const seal = el('div', 'cr-seal bad', card);
  seal.innerHTML = `<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 8 L42 38 H6 Z" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linejoin="round"/>
    <path d="M24 19 v9" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><circle cx="24" cy="33" r="1.9" fill="currentColor"/></svg>`;
  el('div', 'sc-kicker', card, save.company.name);
  el('h2', '', card, 'The bank has called in the overdraft');
  el('p', '', card, `${save.company.name} is ${usd(-save.cash)} overdrawn, past the ${usd(-START_RULES.overdraftLimit)} the bank allows.`);
  const facts = el('div', 'cr-facts', card);
  kv(facts, 'Cash', usd(save.cash), 'bad');
  kv(facts, 'Overdraft limit', usd(START_RULES.overdraftLimit));

  const owned = save.fleet.filter((a) => a.tenure === 'owned' && save.active?.aircraftUid !== a.uid);
  let sell: HTMLButtonElement | null = null;
  if (owned.length > 0) {
    el('div', 'sc-section', card, 'Owned aircraft the bank would sell');
    const t = el('div', 'cr-facts', card);
    let total = 0;
    for (const a of owned) {
      const v = saleValue(a.type);
      total += v;
      kv(t, `${a.registration} · ${typeName(a.type)} (${CAREER_PERF[a.type].icaoType})`, usd(v));
    }
    kv(t, 'Cash after the sale', usd(save.cash + total), save.cash + total > START_RULES.overdraftLimit ? 'ok' : 'bad');
  }
  const actions = el('div', 'cr-actions stack', card);
  if (options.includes('sellOwned')) {
    sell = button(actions, 'The bank sells your owned aircraft', () => ctx.send({ kind: 'bankruptcy', choice: 'sellOwned' }), { cls: 'primary', key: 'Enter' });
  } else {
    el('div', 'cr-fine', actions, owned.length > 0
      ? 'Selling the owned aircraft would not clear the overdraft.'
      : 'The company owns no aircraft the bank could sell.');
  }
  const restart = confirmButton(actions, 'Start a new career', 'Confirm: this career ends', () => ctx.send({ kind: 'bankruptcy', choice: 'restart' }), {
    cls: 'cr-danger', key: sell ? undefined : 'Enter',
  });
  // A way out without choosing (the pages hold the sim and take every key); the Career opens here again.
  const row = el('div', 'cr-actions', card);
  button(row, 'Free flight', () => ctx.send({ kind: 'freeFlight' }), { key: 'Esc' });
  return {
    root: scrim,
    onKey(e) {
      if (bareKey(e, 'Enter', 'NumpadEnter')) {
        (sell ?? restart).click();
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
