// The seed page (docs/career.md "One world per career", "Seed mismatch"): the career lives in one generated
// world; with another world loaded the board is refused until the player switches the world back
// ('switchWorld', a reload into the career's seed) or starts a new career in this world ('reset', after a
// confirm and an offer to export the old career first).

import { el } from '../../ui/dom';
import { careerClock, usd } from './format';
import type { CareerCtx, CareerPageView } from './models';
import { bareKey, button, confirmButton, kv } from './widgets';

/** The seed mismatch page. Enter switches the world back; Esc closes the Career. */
export function renderSeed(parent: HTMLElement, ctx: CareerCtx): CareerPageView {
  const save = ctx.model.save;
  const scrim = el('div', 'scrim cr-root cr-seedpage', parent);
  const card = el('div', 'card cr-small', scrim);
  const seal = el('div', 'cr-seal world', card);
  seal.innerHTML = `<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="15" fill="none" stroke="currentColor" stroke-width="2.4"/>
    <path d="M9 24 h30 M24 9 c-7 8 -7 22 0 30 M24 9 c7 8 7 22 0 30" fill="none" stroke="currentColor" stroke-width="2"/></svg>`;
  el('div', 'sc-kicker', card, save?.company.name ?? 'Career');
  el('h2', '', card, 'Another world is loaded');
  el('p', '', card, `This career lives in world ${save?.seed ?? '?'}; the sim has world ${ctx.model.worldSeed} loaded. Its aircraft and airfields are in the other world, so the job board waits until you switch back.`);
  if (save) {
    const facts = el('div', 'cr-facts', card);
    kv(facts, 'Company', save.company.name);
    kv(facts, 'Career clock', careerClock(save.clockMin));
    kv(facts, 'Cash', usd(save.cash), save.cash < 0 ? 'bad' : '');
    kv(facts, 'Fleet', `${save.fleet.length} aircraft`);
  }
  const actions = el('div', 'cr-actions stack', card);
  button(actions, `Switch the world to seed ${save?.seed ?? ''}`.trim(), () => ctx.send({ kind: 'switchWorld' }), { cls: 'primary', key: 'Enter' });
  button(actions, 'Export this career to a file', () => ctx.send({ kind: 'exportSave' }));
  confirmButton(actions, 'Start a new career in this world', 'Confirm: the old career is replaced', () => ctx.send({ kind: 'reset' }), { cls: 'cr-danger' });
  const row = el('div', 'cr-actions', card);
  button(row, 'Free flight', () => ctx.send({ kind: 'freeFlight' }), { key: 'Esc' });
  return {
    root: scrim,
    onKey(e) {
      if (bareKey(e, 'Enter', 'NumpadEnter')) {
        ctx.send({ kind: 'switchWorld' });
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
