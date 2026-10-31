// The Career hub (docs/career.md "Hub"): a left card in the school's home-card style over the held sim (company
// and pilot, rank, cash, the reputation bar, the career clock, the selected aircraft and where it stands, then
// Job board, Reposition, Fleet, Pilot, Logbook, Rest until tomorrow and Free flight), and a small right card with
// the job in progress or the last debrief. Banners above the figures say what needs doing first: a crash or
// outlanding waiting for its debrief, a job waiting for another type ("Switch to <type>"), a job stopped at
// another field, a lesson running, the store unable to save.

import { el } from '../../ui/dom';
import { CAREER_PERF } from '../perf';
import { careerBlockHours, rankOf } from '../progression';
import { RANKS } from '../types';
import { careerClock, kindLabel, minutes, outcomeLabel, outcomeTone, phaseLabel, signedUsd, typeName, usd } from './format';
import type { CareerCtx, CareerPageView } from './models';
import { badge, bareKey, button, confirmButton, departuresClosed, repBar, selectedAircraft } from './widgets';

/** The company mark: a swept wing in a ring. */
const BRAND_SVG = `<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="15" fill="rgba(255,178,36,.12)" stroke="#ffb224" stroke-width="1.2"/>
  <path d="M5 19 L27 11 L22 17 L27 21 Z" fill="#eef3f8"/><path d="M9 21 L20 18" stroke="#ffb224" stroke-width="1.6" stroke-linecap="round"/></svg>`;

/** The field's name for a code ("Elmley Aerodrome"), or the code itself. */
function fieldName(ctx: CareerCtx, code: string): string {
  return ctx.model.fields.find((f) => f.code === code)?.name ?? code;
}

/** The hub. Enter opens the job board (when it can be used); Esc is Free flight. */
export function renderHub(parent: HTMLElement, ctx: CareerCtx): CareerPageView {
  const { model } = ctx;
  const save = model.save!;
  const wrap = el('div', 'cr-hub-wrap cr-root', parent);
  const card = el('div', 'card cr-hub', wrap);

  const rank = rankOf(save);
  const brand = el('div', 'sc-home-brand cr-brand', card);
  brand.innerHTML = BRAND_SVG;
  const bt = el('div', '', brand);
  el('b', '', bt, save.company.name);
  el('span', '', bt, `${save.pilot.name} · ${rank.label}`);

  const job = save.active;
  const lesson = !!model.inLesson;
  const banner = (text: string, tone: '' | 'info' | 'bad' = ''): HTMLElement => {
    const b = el('div', `sc-banner${tone ? ` ${tone}` : ''}`, card);
    el('span', '', b, text);
    return b;
  };
  if (model.storage === 'memoryOnly') banner('This career can’t be saved in this browser: export it from the pilot page to keep it.');
  else if (model.storage === 'readOnly') banner('This career was saved by a newer version: it is read-only here.');
  if (lesson) banner('Finish or end the lesson first: the Career waits while the Flight School flies.', 'info');
  let primary: (() => void) | null = null;
  if (job?.pendingReport) {
    const b = banner(`The flight ended: ${outcomeLabel(job.pendingReport.outcome).toLowerCase()}. The debrief settles the job.`, 'bad');
    const go = (): void => ctx.send({ kind: 'settlePending', then: 'debrief' });
    button(b, 'Debrief', go);
    primary = go;
  } else if (job && !job.placed && job.type !== model.bootedType) {
    const b = banner(`${job.offer.title} waits for the ${typeName(job.type)}.`, 'info');
    const go = (): void => ctx.send({ kind: 'switchTo' });
    button(b, `Switch to ${typeName(job.type)}`, go);
    primary = go;
  } else if (job?.phase === 'stopped') {
    const b = banner(`${job.offer.title}: stopped at ${fieldName(ctx, job.stoppedAt ?? '')}.`, 'info');
    const go = (): void => ctx.go('stop');
    button(b, 'Stop', go);
    primary = go;
  } else if (job) {
    const b = banner(`${job.offer.title} is in progress.`, 'info');
    const go = (): void => ctx.send({ kind: 'freeFlight' });
    button(b, 'Back to the flight', go);
    primary = go;
  } else if (departuresClosed(save)) {
    banner('Departures are between 07:00 and 18:00: rest until tomorrow for a new board.', 'info');
  }

  const stats = el('div', 'cr-stats', card);
  const stat = (label: string, cls = ''): HTMLElement => {
    const d = el('div', `cr-stat ${cls}`.trim(), stats);
    el('span', '', d, label);
    return d;
  };
  el('b', `num${save.cash < 0 ? ' bad' : ''}`, stat('Cash'), usd(save.cash));
  el('b', 'num', stat('Career clock'), careerClock(save.clockMin));
  repBar(stat('Reputation', 'wide'), save.reputation);

  const ac = selectedAircraft(save);
  const air = el('div', 'cr-aircraft', card);
  if (ac) {
    const top = el('div', 'cr-aircraft-top', air);
    el('b', '', top, `${ac.registration} · ${typeName(ac.type)}`);
    const grounded = ac.groundedUntilDay !== undefined && Math.floor(save.clockMin / 1440) < ac.groundedUntilDay;
    badge(top, grounded ? `Out of service to day ${ac.groundedUntilDay}` : ac.tenure, grounded ? 'bad' : 'dim');
    el('div', 'cr-aircraft-where', air, `At ${fieldName(ctx, ac.field)} (${ac.field}) · ${Math.round(ac.fuelKg)} kg fuel · ${ac.hours.toFixed(1)} h`);
    if (save.fleet.length > 1) {
      const chips = el('div', 'cr-chips', air);
      for (const a of save.fleet) {
        const chip = button(chips, a.registration, () => ctx.send({ kind: 'select', uid: a.uid }), {
          cls: `cr-chip${a.uid === ac.uid ? ' sel' : ''}`, title: `${typeName(a.type)} at ${a.field}`,
        });
        // "Here" is the job's aircraft until the job ends.
        chip.disabled = !!job || lesson;
      }
    }
  } else {
    el('div', 'cr-aircraft-where', air, 'No aircraft: lease one from the fleet page.');
  }

  const nav = el('div', 'sc-nav cr-nav', card);
  const busy = lesson || !!job;
  const board = button(nav, 'Job board', () => ctx.go('board'), { cls: 'primary wide', key: busy ? undefined : 'Enter' });
  board.disabled = busy || !ac;
  if (job) board.title = 'One job at a time: finish the job in progress first';
  const repo = button(nav, 'Reposition', () => ctx.go('reposition'));
  repo.disabled = busy || !ac;
  button(nav, 'Fleet', () => ctx.go('fleet')).disabled = lesson;
  button(nav, 'Pilot', () => ctx.go('pilot')).disabled = lesson;
  button(nav, 'Logbook', () => ctx.go('logbook'));
  const rest = job?.phase === 'stopped'
    ? confirmButton(nav, 'Rest until tomorrow', 'Confirm: gives up the stopped job', () => ctx.send({ kind: 'rest' }))
    : button(nav, 'Rest until tomorrow', () => ctx.send({ kind: 'rest' }));
  rest.disabled = lesson || (!!job && job.phase !== 'stopped');
  if (!rest.disabled && job?.phase !== 'stopped') rest.title = 'The clock goes to 07:30 tomorrow; idle leases are charged';
  button(nav, 'Free flight', () => ctx.send({ kind: 'freeFlight' }), { key: 'Esc' });

  mini(wrap, ctx);

  return {
    root: wrap,
    onKey(e) {
      if (bareKey(e, 'Enter', 'NumpadEnter')) {
        if (primary) primary();
        else if (!board.disabled) ctx.go('board');
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

/** The right card: the job in progress, or the last debrief, and the rank ladder's next step. */
function mini(wrap: HTMLElement, ctx: CareerCtx): void {
  const save = ctx.model.save!;
  const m = el('div', 'card cr-mini', wrap);
  const job = save.active;
  const last = save.lastSettlement;
  if (job) {
    el('div', 'sc-kicker', m, 'Job in progress');
    el('b', 'cr-mini-title', m, job.offer.title);
    const dest = job.offer.destination.kind === 'field' ? job.offer.destination.code : job.offer.destination.name;
    el('div', 'cr-mini-sub', m, `${kindLabel(job.offer.kind)} · ${job.offer.origin} → ${dest} · ${usd(job.offer.pay)}`);
    const row = el('div', 'cr-mini-row', m);
    badge(row, phaseLabel(job.phase), job.phase === 'stopped' ? 'warn' : '');
    const left = job.offer.deadlineMin - job.elapsedS / 60;
    el('span', `num ${left < 0 ? 'bad' : ''}`.trim(), row, left < 0 ? `${minutes(-left)} late` : `${minutes(left)} left`);
  } else if (last) {
    el('div', 'sc-kicker', m, 'Last job');
    const e = last.logEntry;
    el('b', 'cr-mini-title', m, `${e.jobKind ? kindLabel(e.jobKind) : 'Job'} ${e.from ?? ''} → ${e.to ?? ''}`);
    const row = el('div', 'cr-mini-row', m);
    badge(row, outcomeLabel(last.outcome), outcomeTone(last.outcome));
    el('span', `num ${last.net < 0 ? 'bad' : 'ok'}`, row, signedUsd(last.net));
    const open = button(m, 'Debrief', () => ctx.go('debrief'), { cls: 'cr-mini-btn' });
    open.title = 'Open the last debrief';
  } else {
    el('div', 'sc-kicker', m, 'First day');
    el('b', 'cr-mini-title', m, 'The board has work for you');
    el('div', 'cr-mini-sub', m, 'The first three offers on every board suit a trainer or a four-seater, so there is always a job to start with.');
  }
  const hours = careerBlockHours(save.logbook);
  const rank = rankOf(save);
  const next = RANKS[RANKS.findIndex((r) => r.id === rank.id) + 1];
  const ladder = el('div', 'cr-mini-next', m);
  if (next) {
    el('span', '', ladder, `Next: ${next.label}`);
    el('b', 'num', ladder, `${hours.toFixed(1)}/${next.minHours} h · rep ${Math.round(save.reputation)}/${next.minRep}`);
  } else {
    el('span', '', ladder, 'Top rank');
    el('b', 'num', ladder, `${hours.toFixed(1)} h`);
  }
  const owned = save.fleet.filter((a) => a.tenure === 'owned').length;
  const fleet = el('div', 'cr-mini-next', m);
  el('span', '', fleet, 'Fleet');
  el('b', 'num', fleet, `${save.fleet.length} aircraft${owned ? ` · ${owned} owned` : ''}${save.fleet.length ? ` · ${[...new Set(save.fleet.map((a) => CAREER_PERF[a.type].icaoType))].join(', ')}` : ''}`);
}
