// The career logbook (docs/career.md "UI pages"): the Career's own lines on the school's logbook paper, ten a page,
// newest page first, with the page's totals and the totals to date. Job lines carry the flying (type, marks, from
// and to, the job, its outcome, block and airborne time, landings) and every line its net money and reputation;
// business lines (ratings, leases, purchases, sales, idle charges, defuelling, bankruptcy) carry only the money.

import { el } from '../../ui/dom';
import { CAREER_PERF } from '../perf';
import type { CareerLogEntry } from '../types';
import { clockHm, hm, kindLabel, outcomeLabel, outcomeTone, signed, signedUsd } from './format';
import type { CareerCtx, CareerPageView } from './models';
import { bareKey, button, modal, spacer } from './widgets';

/** Lines a page. */
export const LOG_PAGE = 10;
/** Memo key of the page shown (-1: the newest). */
const PAGE = 'logbook.page';

const BUSINESS_WORDS: Readonly<Record<CareerLogEntry['kind'], string>> = {
  job: 'Job', rating: 'Rating', purchase: 'Purchase', lease: 'Lease', sale: 'Sale', return: 'Return', leaseIdle: 'Idle lease',
  refuel: 'Fuel', bankruptcy: 'Bank',
};

/** Sums of a run of lines (job lines' flying, every line's money and reputation). */
export interface LogTotals {
  blockS: number;
  airborneS: number;
  landings: number;
  jobs: number;
  net: number;
  rep: number;
}

/** The totals of `lines`. */
export function logTotals(lines: readonly CareerLogEntry[]): LogTotals {
  const t: LogTotals = { blockS: 0, airborneS: 0, landings: 0, jobs: 0, net: 0, rep: 0 };
  for (const e of lines) {
    if (e.kind === 'job') {
      t.blockS += e.blockS;
      t.airborneS += e.airborneS;
      t.landings += e.landingsDay + e.landingsNight;
      t.jobs++;
    }
    t.net += e.net;
    t.rep += e.repDelta;
  }
  return t;
}

/** The logbook split into pages of LOG_PAGE lines, oldest first (the last page is the newest). Never empty. */
export function logPages(lines: readonly CareerLogEntry[]): CareerLogEntry[][] {
  const pages: CareerLogEntry[][] = [];
  for (let i = 0; i < lines.length; i += LOG_PAGE) pages.push(lines.slice(i, i + LOG_PAGE));
  return pages.length ? pages : [[]];
}

/** The logbook page. Left and right arrows turn pages; Esc returns to the hub. */
export function renderLogbook(parent: HTMLElement, ctx: CareerCtx): CareerPageView {
  const save = ctx.model.save!;
  const back = (): void => ctx.go('hub');
  const pages = logPages(save.logbook);
  let page = Number(ctx.memo.get(PAGE) ?? -1);
  const m = modal(parent, ctx, 'Career logbook', `${save.pilot.name} · ${save.company.name} · ${save.logbook.length} line${save.logbook.length === 1 ? '' : 's'}`, {
    cls: 'cr-logbook', onClose: back,
  });
  const bar = el('div', 'sc-pager cr-logbar', m.body);
  const paperWrap = el('div', '', m.body);
  spacer(bar).style.flex = '1';
  const prev = button(bar, '◀', () => turn(-1), { title: 'Earlier page' });
  const label = el('span', 'num', bar, '');
  const next = button(bar, '▶', () => turn(1), { title: 'Later page' });

  function idx(): number {
    return page < 0 || page >= pages.length ? pages.length - 1 : page;
  }
  function turn(d: number): void {
    const i = Math.max(0, Math.min(pages.length - 1, idx() + d));
    page = i;
    ctx.memo.set(PAGE, i);
    draw();
  }
  function draw(): void {
    const i = idx();
    prev.disabled = i === 0;
    next.disabled = i >= pages.length - 1;
    label.textContent = `Page ${i + 1} of ${pages.length}`;
    paperWrap.replaceChildren();
    const paper = el('div', 'sc-paper cr-paper', paperWrap);
    const t = el('table', '', paper);
    const hr = el('tr', '', el('thead', '', t));
    const cols: [string, string][] = [
      ['Day', 'r'], ['Time', ''], ['Type', ''], ['Reg', ''], ['From', ''], ['To', ''], ['Job', ''], ['Outcome', ''],
      ['Block', 'r'], ['Air', 'r'], ['Ldg', 'r'], ['Net', 'r'], ['Rep', 'r'], ['Remarks', ''],
    ];
    for (const [c, cls] of cols) el('th', cls, hr, c);
    const tb = el('tbody', '', t);
    const rows = pages[i];
    for (const e of rows) {
      const tr = el('tr', e.kind === 'job' ? '' : 'cr-business', tb);
      el('td', 'r', tr, String(e.day));
      el('td', '', tr, clockHm(e.clockMin));
      el('td', '', tr, e.type ? CAREER_PERF[e.type].icaoType : '');
      el('td', '', tr, e.registration ?? '');
      el('td', '', tr, e.from ?? '');
      el('td', '', tr, e.to ?? '');
      el('td', '', tr, e.kind === 'job' ? (e.jobKind ? kindLabel(e.jobKind) : 'Job') : BUSINESS_WORDS[e.kind]);
      const oc = el('td', '', tr);
      if (e.outcome) el('span', `cr-ink ${outcomeTone(e.outcome)}`, oc, outcomeLabel(e.outcome));
      el('td', 'r', tr, e.kind === 'job' ? hm(e.blockS) : '');
      el('td', 'r', tr, e.kind === 'job' ? hm(e.airborneS) : '');
      el('td', 'r', tr, e.kind === 'job' ? String(e.landingsDay + e.landingsNight) : '');
      el('td', `r cr-ink ${e.net < 0 ? 'bad' : e.net > 0 ? 'ok' : ''}`.trim(), tr, signedUsd(e.net));
      el('td', 'r', tr, e.repDelta ? signed(e.repDelta) : '');
      el('td', 'cr-remark', tr, e.remarks);
    }
    for (let k = rows.length; k < LOG_PAGE; k++) {
      const tr = el('tr', '', tb);
      for (let c = 0; c < cols.length; c++) el('td', '', tr);
    }
    const tf = el('tfoot', '', t);
    const total = (labelText: string, x: LogTotals): void => {
      const tr = el('tr', '', tf);
      const l = el('td', '', tr, labelText);
      l.colSpan = 8;
      el('td', 'r', tr, hm(x.blockS));
      el('td', 'r', tr, hm(x.airborneS));
      el('td', 'r', tr, String(x.landings));
      el('td', 'r', tr, signedUsd(x.net));
      el('td', 'r', tr, signed(x.rep));
      el('td', '', tr, `${x.jobs} job${x.jobs === 1 ? '' : 's'}`);
    };
    total('Totals this page', logTotals(rows));
    total('Totals to date', logTotals(pages.slice(0, i + 1).flat()));
    if (save.logbook.length === 0) el('div', 'sc-foot-note', paperWrap, 'Every job, and every purchase, lease and rating, is logged here.');
  }
  draw();

  button(m.foot, 'Hub', back, { key: 'Esc' });
  spacer(m.foot);
  el('span', 'sc-note', m.foot, 'Career time; separate from the Flight School logbook.');
  return {
    root: m.scrim,
    onKey(e) {
      if (bareKey(e, 'Escape')) {
        back();
        return true;
      }
      if (bareKey(e, 'ArrowLeft')) {
        turn(-1);
        return true;
      }
      if (bareKey(e, 'ArrowRight')) {
        turn(1);
        return true;
      }
      return false;
    },
  };
}
