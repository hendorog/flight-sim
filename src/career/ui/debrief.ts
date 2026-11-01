// The debrief card (docs/career.md "Finishing", "Settlement"): the settled job (src/career/economy.ts Settlement)
// as the player reads it: the outcome and net in large type, the instructor-voice summary, the money lines with
// their amounts aligned (pay and bonuses, penalties, then the costs), the cash after, the reputation lines and the
// new figure, a promotion or demotion, the landing and comfort scores, and the logbook line. Buttons: Job board
// (from where the aircraft now stands) and Hub. Any line the system adds (an idle lease) is shown as given.

import { el } from '../../ui/dom';
import { RANKS, type ComfortFactor, type Settlement } from '../types';
import { clockHm, hm, kindLabel, minutes, outcomeLabel, outcomeTone, signed, signedUsd, usd } from './format';
import type { CareerCtx, CareerPageView } from './models';
import { badge, bareKey, button, kv, modal, repBar, section, spacer } from './widgets';

const COMFORT_WORDS: Readonly<Record<ComfortFactor, string>> = {
  vertical: 'bumps and pull-ups', lateral: 'sideways slips', bank: 'steep banks', pitch: 'steep pitch', descent: 'fast descents',
  stall: 'the stall warning', landing: 'the landing',
};

const rankLabel = (id: Settlement['rankAfter']): string => RANKS.find((r) => r.id === id)?.label ?? id;

/** A 0..100 score with a bar, coloured by band (85 and up good, under 50 poor). */
function score(parent: HTMLElement, label: string, value: number, note: string): void {
  const row = el('div', 'cr-score', parent);
  const top = el('div', 'cr-score-top', row);
  el('span', '', top, label);
  const tone = value >= 85 ? 'ok' : value >= 50 ? '' : 'bad';
  el('b', `num ${tone}`.trim(), top, `${Math.round(value)}`);
  const bar = el('div', `cr-bar ${tone}`.trim(), row);
  el('i', '', bar).style.width = `${Math.max(0, Math.min(100, value))}%`;
  if (note) el('div', 'cr-score-note', row, note);
}

/** The debrief of `ctx.model.save.lastSettlement`. Enter opens the board here; Esc the hub. */
export function renderDebrief(parent: HTMLElement, ctx: CareerCtx): CareerPageView {
  const save = ctx.model.save!;
  const s = save.lastSettlement;
  const hub = (): void => ctx.go('hub');
  const board = (): void => ctx.go('board');
  if (!s) {
    const m = modal(parent, ctx, 'Debrief', 'No job has been settled yet.', { fit: true, cls: 'cr-debrief', onClose: hub });
    el('div', 'sc-empty', m.body, 'Fly a job from the board: its debrief appears here.');
    button(m.foot, 'Hub', hub, { key: 'Esc' });
    return { root: m.scrim, onKey: (e) => (bareKey(e, 'Escape') ? (hub(), true) : false) };
  }
  const e = s.logEntry;
  const r = s.report;
  const tone = outcomeTone(s.outcome);
  const m = modal(parent, ctx, 'Debrief', `${e.jobKind ? kindLabel(e.jobKind) : 'Job'} ${e.from ?? ''} → ${e.to ?? ''} · ${e.registration ?? ''} · day ${e.day}, ${clockHm(e.clockMin)}${r.test ? ' · test arrival' : ''}`, {
    cls: 'cr-debrief', fit: true, onClose: hub,
  });
  badge(m.right, `Aircraft at ${s.aircraftAt}`, 'dim');

  const top = el('div', 'cr-deb-top', m.body);
  const head = el('div', 'cr-deb-head', top);
  el('div', `sc-outcome ${tone}`, head, outcomeLabel(s.outcome));
  el('div', 'cr-deb-sum', head, s.summary);
  const big = el('div', 'cr-deb-net', top);
  el('span', '', big, 'Net');
  el('b', `num ${s.net < 0 ? 'bad' : 'ok'}`, big, signedUsd(s.net));
  el('small', 'num', big, `Cash ${usd(s.cashAfter)}`);

  if (s.rankAfter !== s.rankBefore) {
    const up = RANKS.findIndex((x) => x.id === s.rankAfter) > RANKS.findIndex((x) => x.id === s.rankBefore);
    const b = el('div', `sc-banner ${up ? 'info cr-promo' : ''}`.trim(), m.body);
    el('span', '', b, up ? `Promoted: ${rankLabel(s.rankAfter)}` : `Rank now ${rankLabel(s.rankAfter)}`);
  }
  if (s.groundedUntilDay !== undefined) {
    const b = el('div', 'sc-banner', m.body);
    el('span', '', b, `${e.registration ?? 'The aircraft'} is out of service for repairs until day ${s.groundedUntilDay}.`);
  }

  const grid = el('div', 'cr-deb-grid', m.body);
  const money = el('div', 'cr-col', grid);
  section(money, 'Money');
  const ml = el('div', 'cr-sheet cr-lines', money);
  for (const l of s.lines) kv(ml, l.label, signedUsd(l.amount), l.amount > 0 ? 'ok' : l.amount < 0 ? '' : 'dim');
  kv(ml, 'Net', signedUsd(s.net), s.net < 0 ? 'bad' : 'ok').classList.add('cr-total');

  const rep = el('div', 'cr-col', grid);
  section(rep, 'Reputation');
  const rl = el('div', 'cr-sheet cr-lines', rep);
  if (s.repLines.length === 0) kv(rl, 'No change', '0', 'dim');
  for (const l of s.repLines) kv(rl, l.reason, signed(l.delta), l.delta > 0 ? 'ok' : l.delta < 0 ? 'bad' : 'dim');
  kv(rl, 'Change', signed(s.repDelta), s.repDelta < 0 ? 'bad' : 'ok').classList.add('cr-total');
  const ra = el('div', 'cr-repafter', rep);
  el('span', '', ra, 'Reputation now');
  repBar(ra, s.repAfter);

  const fl = el('div', 'cr-col', grid);
  section(fl, 'The flight');
  if (r.landing) {
    const L = r.landing;
    const bits = [`${Math.round(L.sinkFpm)} fpm`];
    if (L.bounces > 0) bits.push(`${L.bounces} bounce${L.bounces === 1 ? '' : 's'}`);
    if (L.helicopter && L.spotDistM !== undefined) bits.push(`${Math.round(L.spotDistM)} m from the spot`);
    if (!L.helicopter && L.centrelineM !== undefined) bits.push(`${L.centrelineM.toFixed(1)} m off the centreline`);
    if (!L.helicopter && L.distAimFt !== undefined) bits.push(`${Math.round(Math.abs(L.distAimFt))} ft ${L.distAimFt >= 0 ? 'past' : 'short of'} the aim point`);
    if (!L.onTarget) bits.push(L.helicopter ? 'off the spot' : 'off the runway');
    score(fl, 'Landing', L.score, bits.join(' · '));
  } else {
    el('div', 'cr-score-note', fl, 'No landing graded.');
  }
  const worst = (Object.entries(r.comfort.deductions) as [ComfortFactor, number][]).sort((a, b) => b[1] - a[1])[0];
  score(fl, 'Comfort', r.comfort.score, worst && worst[1] >= 1 ? `Most lost to ${COMFORT_WORDS[worst[0]]} (${Math.round(worst[1])})` : 'A smooth ride');
  const ff = el('div', 'cr-sheet', fl);
  kv(ff, 'Time', minutes(r.elapsedMin));
  kv(ff, 'Block / airborne', `${hm(r.blockS)} / ${hm(r.airborneS)}`);
  kv(ff, 'Fuel at shutdown', `${Math.round(r.fuelAtEndKg)} kg`);
  if (r.waypointsTotal > 0) kv(ff, 'Turning points', `${r.waypointsDone} of ${r.waypointsTotal}`, r.waypointsDone < r.waypointsTotal ? 'warn' : 'ok');
  if (r.crashReason) kv(ff, 'Cause', r.crashReason, 'bad');

  section(m.body, 'Logbook');
  const paper = el('div', 'sc-paper cr-paper cr-logline', m.body);
  const t = el('table', '', paper);
  const hr = el('tr', '', el('thead', '', t));
  for (const c of ['Day', 'Reg', 'From', 'To', 'Job', 'Block', 'Air', 'Ldg', 'Net', 'Rep', 'Remarks']) el('th', '', hr, c);
  const tr = el('tr', '', el('tbody', '', t));
  for (const v of [String(e.day), e.registration ?? '', e.from ?? '', e.to ?? '', e.jobKind ? kindLabel(e.jobKind) : '', hm(e.blockS), hm(e.airborneS),
    String(e.landingsDay + e.landingsNight), signedUsd(e.net), signed(e.repDelta), e.remarks]) el('td', '', tr, v);

  button(m.foot, 'Hub', hub, { key: 'Esc' });
  spacer(m.foot);
  el('span', 'sc-note', m.foot, `Next board from ${s.aircraftAt}`);
  button(m.foot, 'Job board', board, { cls: 'primary', key: 'Enter' });
  return {
    root: m.scrim,
    onKey(ev) {
      if (bareKey(ev, 'Escape')) {
        hub();
        return true;
      }
      if (bareKey(ev, 'Enter', 'NumpadEnter')) {
        board();
        return true;
      }
      return false;
    },
  };
}
