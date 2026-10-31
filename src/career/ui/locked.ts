// The locked page (docs/career.md "First open"): without a licence the Career explains how to earn one (the
// Flight School's skill test, lesson 21) and offers "I already hold a licence" for a real pilot, which sends
// 'declareLicence' (the system records the declaration and opens the new-career form). Esc returns to free flight.

import { el } from '../../ui/dom';
import type { CareerCtx, CareerPageView } from './models';
import { bareKey, button } from './widgets';

/** The locked page. Enter declares a licence; Esc closes the Career. */
export function renderLocked(parent: HTMLElement, ctx: CareerCtx): CareerPageView {
  const scrim = el('div', 'scrim cr-root cr-locked', parent);
  const card = el('div', 'card cr-small', scrim);
  const seal = el('div', 'cr-seal locked', card);
  seal.innerHTML = `<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="12" y="21" width="24" height="18" rx="3" fill="none" stroke="currentColor" stroke-width="2.4"/>
    <path d="M17 21 v-5 a7 7 0 0 1 14 0 v5" fill="none" stroke="currentColor" stroke-width="2.4"/><circle cx="24" cy="30" r="2.4" fill="currentColor"/></svg>`;
  el('div', 'sc-kicker', card, 'Career');
  el('h2', '', card, 'Fly for a living');
  el('p', '', card, 'Run a small air operator from the home field: passengers, freight, mail and scenic flights to the eight airfields around it, in the sim’s real aircraft.');
  const need = el('div', 'cr-need', card);
  el('b', '', need, 'Pass the skill test (lesson 21) to start a career');
  el('span', '', need, 'The Flight School’s skill test is the licence the Career asks for.');
  const actions = el('div', 'cr-actions', card);
  button(actions, 'Free flight', () => ctx.send({ kind: 'freeFlight' }), { key: 'Esc' });
  button(actions, 'I already hold a licence', () => ctx.send({ kind: 'declareLicence' }), { cls: 'primary', key: 'Enter' });
  el('div', 'cr-fine', card, 'Declaring a licence is for pilots who hold one in real life; the Career records it on your pilot page.');
  return {
    root: scrim,
    onKey(e) {
      if (bareKey(e, 'Enter', 'NumpadEnter')) {
        ctx.send({ kind: 'declareLicence' });
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
