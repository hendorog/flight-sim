// The job board (docs/career.md "Job board"): today's offers at the selected aircraft's field, as a table with
// aligned figures (route, NM, load, time allowed, least class, weather and wind, reputation, pay) beside a
// north-up map of the nine fields showing the highlighted offer's route. Offers no aircraft here can take are
// greyed with the one-line reason (widgets.ts offerStatus: "Needs reputation 25", "Needs a twin", "Too heavy for
// the C152"); taken offers are hidden. Click or the arrow keys highlight an offer; Enter, a double click or
// Dispatch opens the dispatch page for it ('dispatch').

import { el } from '../../ui/dom';
import type { JobOffer } from '../types';
import { boardMapSvg } from './boardMap';
import { careerClock, classShort, kindLabel, loadText, minutes, nm, typeName, usd, weatherLabel, wind } from './format';
import type { CareerCtx, CareerPageView } from './models';
import { badge, bareKey, button, departuresClosed, modal, offerStatus, selectedAircraft, spacer, type OfferStatus } from './widgets';

/** Memo key of the highlighted offer id. */
const SEL = 'board.sel';

/** The destination's code (or a site's name) of an offer. */
export function destText(o: JobOffer): string {
  if (o.waypoints && o.waypoints.length > 0) return `${o.origin} loop · ${o.waypoints.length} points`;
  return `${o.origin} → ${o.destination.kind === 'field' ? o.destination.code : o.destination.name}`;
}

/** The offers on today's board the player has not taken, in board order. */
export function openOffers(ctx: CareerCtx): JobOffer[] {
  const taken = new Set(ctx.model.save?.taken ?? []);
  return ctx.model.board.filter((o) => !taken.has(o.id));
}

/** The job board. Arrow keys move the highlight, Enter dispatches it, Esc returns to the hub. */
export function renderBoard(parent: HTMLElement, ctx: CareerCtx): CareerPageView {
  const { model } = ctx;
  const save = model.save!;
  const ac = selectedAircraft(save);
  const here = ac?.field ?? null;
  const field = model.fields.find((f) => f.code === here);
  const offers = openOffers(ctx);
  const status = new Map<string, OfferStatus>(offers.map((o) => [o.id, offerStatus(o, model)]));
  const closed = departuresClosed(save);

  const back = (): void => ctx.go('hub');
  const m = modal(parent, ctx, `Job board · ${field?.name ?? here ?? ''}`, `${here ?? ''} · ${careerClock(save.clockMin)}${ac ? ` · ${ac.registration} ${typeName(ac.type)}, ${Math.round(ac.fuelKg)} kg fuel` : ''}`, {
    cls: 'cr-board', onClose: back,
  });
  badge(m.right, `${offers.length} offer${offers.length === 1 ? '' : 's'}`, 'dim');
  if (closed) {
    const b = el('div', 'sc-banner info', m.body);
    el('span', '', b, 'Departures are between 07:00 and 18:00. Rest until tomorrow for a fresh board.');
    button(b, 'Rest until tomorrow', () => ctx.send({ kind: 'rest' }));
  }
  const grid = el('div', 'cr-board-grid', m.body);
  const list = el('div', 'cr-offers', grid);
  const side = el('div', 'cr-board-side', grid);
  const map = el('div', 'cr-map', side);
  const detail = el('div', 'cr-detail', side);

  let sel = (ctx.memo.get(SEL) as string | undefined) ?? '';
  if (!offers.some((o) => o.id === sel)) sel = offers.find((o) => status.get(o.id)?.ok)?.id ?? offers[0]?.id ?? '';

  const table = el('table', 'sc-table cr-offer-table', list);
  const hr = el('tr', '', el('thead', '', table));
  for (const [t, c] of [['Job', ''], ['NM', 'r'], ['Load', 'r'], ['Time', 'r'], ['Class', ''], ['Weather', ''], ['Rep', 'r'], ['Pay', 'r']] as const) el('th', c, hr, t);
  const tbody = el('tbody', '', table);
  const rows = new Map<string, HTMLElement>();
  for (const o of offers) {
    const st = status.get(o.id)!;
    const tr = el('tr', `cr-offer${st.ok ? '' : ' locked'}`, tbody);
    rows.set(o.id, tr);
    const job = el('td', 'cr-offer-job', tr);
    const top = el('div', 'cr-offer-top', job);
    el('span', `cr-kind ${o.kind}`, top, kindLabel(o.kind));
    if (o.premium) el('span', 'cr-kind premium', top, 'Regular client');
    el('b', '', top, o.title);
    el('div', 'cr-offer-sub', job, `${o.client} · ${destText(o)}`);
    if (!st.ok && st.reason) el('div', 'cr-offer-why', job, st.reason);
    el('td', 'r num', tr, nm(o.distanceNm));
    el('td', 'r num', tr, loadText(o.pax, o.payloadKg));
    el('td', 'r num', tr, minutes(o.deadlineMin));
    el('td', '', tr, classShort(o.minClass));
    const wx = el('td', 'cr-wx', tr);
    el('span', `cr-wx-name ${o.weather}`, wx, weatherLabel(o.weather));
    el('span', 'num', wx, wind(o.windDirDeg, o.windKt));
    el('td', `r num${model.save && model.save.reputation < o.repRequired ? ' bad' : ''}`, tr, String(o.repRequired));
    el('td', 'r num cr-pay', tr, usd(o.pay));
    tr.addEventListener('click', () => highlight(o.id));
    tr.addEventListener('dblclick', () => dispatch(o.id));
  }
  if (offers.length === 0) el('div', 'sc-empty', list, 'No more offers here today. Reposition to another field, or rest until tomorrow.');

  button(m.foot, 'Hub', back, { key: 'Esc' });
  spacer(m.foot);
  const note = el('span', 'sc-note', m.foot, '');
  const go = button(m.foot, 'Dispatch', () => dispatch(sel), { cls: 'primary', key: 'Enter' });

  function dispatch(id: string): void {
    const st = status.get(id);
    if (!st?.ok || closed) return;
    ctx.memo.set(SEL, id);
    ctx.send({ kind: 'dispatch', offerId: id });
  }

  function highlight(id: string): void {
    sel = id;
    ctx.memo.set(SEL, id);
    for (const [k, tr] of rows) tr.classList.toggle('sel', k === id);
    const o = offers.find((x) => x.id === id) ?? null;
    map.innerHTML = boardMapSvg(model.fields, here, o);
    detail.replaceChildren();
    const st = o ? status.get(o.id) : undefined;
    go.disabled = !o || !st?.ok || closed;
    note.textContent = !o ? '' : closed ? 'Departures closed for today' : st?.ok ? '' : st?.reason ?? '';
    if (!o) return;
    el('b', 'cr-detail-title', detail, o.title);
    const facts = el('div', 'cr-detail-facts', detail);
    const fact = (label: string, v: string): void => {
      const d = el('div', '', facts);
      el('span', '', d, label);
      el('b', 'num', d, v);
    };
    const dest = o.destination.kind === 'field' ? model.fields.find((f) => f.code === (o.destination as { code: string }).code) : null;
    fact('To', o.waypoints?.length ? 'Back here' : dest ? `${dest.name}` : destText(o));
    fact('Pay', usd(o.pay));
    fact('Least class', classShort(o.minClass));
    fact('Suits', typeName(o.refType));
    if (o.waypoints?.length) el('div', 'cr-detail-wps', detail, o.waypoints.map((w, i) => `${i + 1}. ${w.name}`).join(' · '));
  }
  highlight(sel);

  const move = (d: number): void => {
    if (offers.length === 0) return;
    const i = offers.findIndex((o) => o.id === sel);
    highlight(offers[Math.max(0, Math.min(offers.length - 1, (i < 0 ? 0 : i) + d))].id);
  };

  return {
    root: m.scrim,
    onKey(e) {
      if (bareKey(e, 'Escape')) {
        back();
        return true;
      }
      if (bareKey(e, 'Enter', 'NumpadEnter')) {
        dispatch(sel);
        return true;
      }
      if (bareKey(e, 'ArrowDown')) {
        move(1);
        return true;
      }
      if (bareKey(e, 'ArrowUp')) {
        move(-1);
        return true;
      }
      return false;
    },
  };
}
