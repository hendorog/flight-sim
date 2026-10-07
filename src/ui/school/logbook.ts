// Logbook (section 5.7): a paper-style table, 10 lines a page with page totals, totals brought forward and
// totals to date; filter lessons / free flights; remarks editable in place; lesson lines open their debrief
// (and trace, when stored); "Copy as CSV".

import type { DebriefModel, LogbookEntry, TrainingSave } from '../../training/types';
import { el } from '../dom';
import { renderDebrief } from './debrief';
import { filterLogbook, formatDate, logbookCsv, logbookPages, logColumns, type LogFilter } from './format';
import { bareKey, button, header, type ScreenCtx, type ScreenView } from './widgets';

const PAGE = 10;

/** The stored result a logbook line belongs to (by trace id, else by its end time). */
export function resultFor(save: TrainingSave, e: LogbookEntry): TrainingSave['results'][string][number] | null {
  if (!e.lessonId) return null;
  const list = save.results[e.lessonId] ?? [];
  return (e.traceId ? list.find((r) => r.traceId === e.traceId) : undefined) ?? list.find((r) => r.endedAt === e.date) ?? null;
}

export function renderLogbook(parent: HTMLElement, sc: ScreenCtx): ScreenView {
  const scrim = el('div', 'scrim', parent);
  const save = sc.career.save;
  let filter: LogFilter = 'all';
  let page = -1; // -1: the last page (the newest lines)
  let sub: ScreenView | null = null;

  const openDebrief = (e: LogbookEntry): void => {
    if (!save || !e.lessonId) return;
    const lesson = sc.career.syllabus.find((l) => l.id === e.lessonId);
    const result = resultFor(save, e);
    if (!lesson || !result) return;
    const trace = result.traceId ? sc.deps.loadTrace?.(result.traceId) ?? null : null;
    const m: DebriefModel = { lesson, result, trace, bestTrace: null, logbookPreview: e, retryPhases: [], nextLessonId: null, milestone: null };
    scrim.replaceChildren();
    // The debrief brings its own scrim: ours stops dimming meanwhile.
    scrim.classList.add('sc-passthru');
    sub = renderDebrief(scrim, sc, m, { readOnly: { back: () => {
      sub?.dispose?.();
      sub = null;
      render();
    } } });
  };

  const render = (): void => {
    scrim.replaceChildren();
    scrim.classList.remove('sc-passthru');
    const card = el('div', 'card sc-card sc-wide', scrim);
    const h = header(card, 'Logbook', save ? `${save.profile.studentName} · licence ${save.profile.licenceNo}` : 'No training record yet', 'KFBL Flight Training');
    button(h.root, '×', () => sc.go('home'), { cls: 'sc-x', title: 'Back (Esc)' });
    const body = el('div', 'sc-body', card);
    const entries = filterLogbook(save?.logbook ?? [], filter);
    const pages = logbookPages(entries, sc.deps.totals, PAGE);
    const idx = page < 0 || page >= pages.length ? pages.length - 1 : page;
    const p = pages[idx];

    const bar = el('div', 'sc-pager', body);
    bar.style.marginBottom = '12px';
    const seg = el('div', 'sc-seg', bar);
    for (const [id, text] of [['all', 'All flights'], ['lessons', 'Lessons'], ['free', 'Free flights']] as const) {
      button(seg, text, () => {
        filter = id;
        page = -1;
        render();
      }, { cls: filter === id ? 'sel' : '' });
    }
    el('div', 'sc-spacer', bar).style.flex = '1';
    const prev = button(bar, '◀', () => {
      page = idx - 1;
      render();
    }, { title: 'Earlier page' });
    prev.disabled = idx === 0;
    el('span', 'num', bar, `Page ${idx + 1} of ${pages.length}`);
    const next = button(bar, '▶', () => {
      page = idx + 1;
      render();
    }, { title: 'Later page' });
    next.disabled = idx >= pages.length - 1;

    const paper = el('div', 'sc-paper', body);
    const t = el('table', '', paper);
    const hr = el('tr', '', el('thead', '', t));
    const cols: [string, string][] = [
      ['Date', ''], ['Type', ''], ['Reg', ''], ['From', ''], ['To', ''], ['Dual', 'r'], ['Solo / PIC', 'r'], ['Night', 'r'],
      ['Sim instr', 'r'], ['Ldg D/N', 'r'], ['Exercise', ''], ['Remarks', ''], ['Signature', ''],
    ];
    for (const [c, cls] of cols) el('th', cls, hr, c);
    const tb = el('tbody', '', t);
    for (const e of p.rows) {
      const tr = el('tr', '', tb);
      const c = logColumns(sc.deps.totals([e]));
      el('td', '', tr, formatDate(e.date));
      el('td', '', tr, e.aircraftType);
      el('td', '', tr, e.registration);
      el('td', '', tr, e.from);
      el('td', '', tr, e.to);
      el('td', 'r', tr, e.role === 'dual' || e.role === 'test' ? c.dual : '');
      el('td', 'r', tr, e.role === 'solo' || e.role === 'pic' ? c.solo : '');
      el('td', 'r', tr, e.times.nightS > 0 ? c.night : '');
      el('td', 'r', tr, e.times.instrumentS > 0 ? c.instr : '');
      el('td', 'r', tr, c.ldg);
      const ex = el('td', 'sc-ex-cell', tr);
      const result = save ? resultFor(save, e) : null;
      if (result && sc.career.syllabus.some((l) => l.id === e.lessonId)) {
        const link = button(ex, e.exercise, () => openDebrief(e), { cls: 'sc-link', title: 'Open the debrief' });
        link.style.maxWidth = '100%';
      } else ex.textContent = e.exercise;
      ex.title = e.exercise;
      const rm = el('td', '', tr);
      const input = el('input', 'sc-remark', rm);
      input.type = 'text';
      input.value = e.remarks;
      input.maxLength = 120;
      input.placeholder = '…';
      const commit = (): void => {
        if (input.value !== e.remarks) sc.send({ kind: 'editRemarks', entryId: e.id, remarks: input.value });
      };
      input.addEventListener('change', commit);
      input.addEventListener('keydown', (k) => {
        if (k.code === 'Enter' || k.code === 'NumpadEnter') input.blur();
      });
      const sig = el('td', '', tr);
      if (e.signedBy) el('span', 'sc-sign', sig, e.signedBy);
      if (e.stamp) el('span', 'sc-stamp', sig, e.stamp);
    }
    // Blank ruled lines fill the page, as on paper.
    for (let i = p.rows.length; i < PAGE; i++) {
      const tr = el('tr', '', tb);
      for (let k = 0; k < cols.length; k++) el('td', '', tr);
    }
    const tf = el('tfoot', '', t);
    const total = (label: string, x: typeof p.page): void => {
      const tr = el('tr', '', tf);
      const c = logColumns(x);
      const lab = el('td', '', tr, label);
      lab.colSpan = 5;
      for (const v of [c.dual, c.solo, c.night, c.instr, c.ldg]) el('td', 'r', tr, v);
      const rest = el('td', '', tr, x.flights ? `${x.flights} flight${x.flights === 1 ? '' : 's'}` : '');
      rest.colSpan = 3;
    };
    total('Totals this page', p.page);
    total('Brought forward', p.broughtForward);
    total('Totals to date', p.toDate);
    if (!save || save.logbook.length === 0) el('div', 'sc-foot-note', body, 'Your flights are logged here at the end of every lesson.');

    const foot = el('div', 'sc-foot', card);
    button(foot, 'Back', () => sc.go('home'), { key: 'Esc' });
    el('div', 'sc-spacer', foot);
    el('span', 'sc-note', foot, 'Simulation time; not creditable toward a licence.');
    const csv = button(foot, 'Copy as CSV', () => {
      const text = logbookCsv(filterLogbook(save?.logbook ?? [], filter), sc.deps.totals);
      navigator.clipboard?.writeText(text).then(
        () => sc.toast('Logbook copied as CSV'),
        () => sc.toast('Copy failed: the browser refused clipboard access'),
      );
    });
    csv.disabled = !save || save.logbook.length === 0;
  };
  render();

  return {
    root: scrim,
    onKey(e) {
      if (sub) return sub.onKey?.(e) ?? false;
      if (bareKey(e, 'Escape')) {
        sc.go('home');
        return true;
      }
      return false;
    },
    dispose() {
      sub?.dispose?.();
    },
  };
}
