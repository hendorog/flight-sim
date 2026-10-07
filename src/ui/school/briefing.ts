// Briefing (section 5.3), shown while the sim is positioned and held behind the curtain. Left: the aim, the
// key points, airmanship, the "More" theory and the exercise sequence. Right: the numbers from the aircraft
// profile, the tolerance table (lesson and test standard), the diagram, the nav log and the keys.
// Enter starts the flight, Esc goes back.

import { STANDARD_NOTES } from '../../training/grading/standards';
import type { BriefingModel } from '../../training/types';
import { el } from '../dom';
import { diagramSvg } from './diagram';
import { authorityName, formatTol, formatValue, TOL_INFO } from './format';
import { kindWord, lessonRef, startText } from './home';
import { renderNavLog } from './navLog';
import { badge, bareKey, button, header, keyCaps, renderCaps, section, type ScreenCtx, type ScreenView } from './widgets';

const STANDARD_WORDS = { training: 'training', test: 'test', commercial: 'commercial' } as const;

export function renderBriefing(parent: HTMLElement, sc: ScreenCtx, m: BriefingModel): ScreenView {
  const scrim = el('div', 'scrim', parent);
  const card = el('div', 'card sc-card sc-wide', scrim);
  const l = m.lesson;
  const b = l.briefing;
  const h = header(card, l.title, `${startText(l.start)}.`, `Lesson ${l.number} · ${lessonRef(l, m.authority)} · ${kindWord(l.kind)} · about ${l.estMinutes} min`);
  badge(h.right, authorityName(m.authority));
  if (m.practiceOnly) badge(h.right, 'Practice only', 'warn');
  if (l.kind === 'solo') badge(h.right, 'Solo', 'ok');
  if (l.kind === 'test') badge(h.right, 'Examiner', 'dim');

  const body = el('div', 'sc-body', card);
  const grid = el('div', 'sc-brief', body);
  const left = el('div', '', grid);
  const right = el('div', '', grid);

  section(left, 'Aim');
  el('p', 'sc-aim', left, b.aim);
  section(left, 'Key points');
  const pts = el('ul', 'sc-list', left);
  for (const p of b.points) el('li', '', pts, p);
  if (b.airmanship.length) {
    section(left, 'Airmanship');
    const am = el('ul', 'sc-list', left);
    for (const p of b.airmanship) el('li', '', am, p);
  }
  if (b.more) {
    const d = el('details', 'sc-more', left);
    el('summary', '', d, 'More: the theory');
    for (const para of b.more.split(/\n\s*\n/)) el('p', '', d, para);
  }
  if (l.exercises.length) section(left, 'Exercises');
  const chips = el('div', 'sc-chips', left);
  for (const ex of l.exercises) {
    const c = el('span', `sc-chip ${ex.mode}`, chips, ex.title);
    c.title = `${ex.mode === 'demo' ? 'Demonstration' : ex.mode === 'practice' ? 'Practice' : 'Assessed'} · ${STANDARD_WORDS[ex.standard]} standard${ex.required ? ' · required' : ''}`;
  }

  if (m.numbers.length) {
    section(right, 'Numbers');
    const nums = el('div', 'sc-numbers', right);
    for (const n of m.numbers) {
      const d = el('div', 'sc-number', nums);
      el('span', '', d, n.label);
      el('b', '', d, formatValue(n.value, n.unit));
    }
  }

  if (m.tolerances.length) {
    section(right, 'Tolerances');
    const t = el('table', 'sc-table', right);
    const hr = el('tr', '', el('thead', '', t));
    el('th', '', hr, 'Item');
    el('th', 'r', hr, 'This lesson');
    el('th', 'r', hr, `Test (${m.authority.toUpperCase()})`);
    const tb = el('tbody', '', t);
    const notes: string[] = [];
    for (const row of m.tolerances) {
      const info = TOL_INFO[row.key];
      const tr = el('tr', '', tb);
      const name = el('td', '', tr, info.label);
      const note = row.note ?? STANDARD_NOTES[row.key]?.[m.authority];
      if (note) {
        let i = notes.indexOf(note);
        if (i < 0) i = notes.push(note) - 1;
        el('sup', '', name, ` ${i + 1}`);
      }
      el('td', 'r', tr, formatTol(row.lesson, info.unit));
      el('td', 'r', tr, formatTol(row.test, info.unit));
    }
    if (notes.length) el('div', 'sc-foot-note', right, notes.map((n, i) => `${i + 1} ${n}.`).join('  '));
  }

  if (b.diagram) {
    section(right, 'Picture');
    el('div', 'sc-diagram', right).innerHTML = diagramSvg(b.diagram);
  }

  if (l.route) {
    section(right, 'Navigation log');
    renderNavLog(right, l.route);
  }

  const caps = b.keys.map(keyCaps).filter((k): k is NonNullable<typeof k> => !!k);
  // The training keys every lesson uses follow the lesson's own list.
  for (const id of ['ack', 'handback', 'sayAgain', 'showMe', 'card']) {
    const k = keyCaps(id)!;
    if (!caps.some((c) => c.label === k.label)) caps.push(k);
  }
  section(right, 'Keys');
  const keys = el('div', 'sc-keys', right);
  for (const k of caps) {
    const row = el('div', '', keys);
    el('span', '', row, k.label);
    renderCaps(row, k.keys);
  }

  const foot = el('div', 'sc-foot', card);
  button(foot, 'Back', () => sc.send({ kind: 'backFromBriefing' }), { key: 'Esc' });
  const w = el('div', 'sc-weather', foot);
  w.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16"><path d="M2 6h8a2 2 0 1 0-2-2M2 10h11a2 2 0 1 1-2 2" fill="none" stroke="#9aa8b6" stroke-width="1.4" stroke-linecap="round"/></svg>`;
  el('b', '', w, m.weatherLine);
  el('div', 'sc-spacer', foot);
  button(foot, 'Listen', () => sc.send({ kind: 'listenBriefing' }), { title: 'The instructor reads the summary' });
  button(foot, 'Start flight', () => sc.send({ kind: 'startFlight' }), { cls: 'primary', key: 'Enter' });

  return {
    root: scrim,
    onKey(e) {
      if (bareKey(e, 'Enter', 'NumpadEnter')) {
        sc.send({ kind: 'startFlight' });
        return true;
      }
      if (bareKey(e, 'Escape')) {
        sc.send({ kind: 'backFromBriefing' });
        return true;
      }
      return false;
    },
  };
}
