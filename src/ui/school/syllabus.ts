// Syllabus (section 5.2) and challenges (section 4.3). Lesson tiles by stage: locked (grey, prerequisites on
// hover), available (blue), competent (green with stars); gate tiles carry an examiner's stamp. A tile opens
// the briefing. Challenges show the local best five per authority with medals.

import { medalFor } from '../../training/career/challenges';
import type { ChallengeBest, Lesson, LessonProgress } from '../../training/types';
import { el } from '../dom';
import { formatDate, outcomeLabel, starString } from './format';
import { kindWord, lessonRef, STAGES } from './home';
import { bareKey, button, header, type ScreenCtx, type ScreenView } from './widgets';

const ROWS: { title: string; of: Lesson['stage'][]; sub: string }[] = [
  { title: 'Stage 1 · Handling', of: STAGES[0].of, sub: 'Dual, in the training area' },
  { title: 'Stage 2 · Circuits and first solo', of: STAGES[1].of, sub: 'Runway 07, left-hand circuits' },
  { title: 'Stage 3 · Advanced', of: STAGES[2].of, sub: 'Any order after the first solo' },
  { title: 'Stage 4 · Navigation and the skill test', of: STAGES[3].of, sub: '' },
  { title: 'Ratings', of: ['rating'], sub: 'Night: required before the skill test under the FAA' },
];

function modal(parent: HTMLElement, fit = false): { scrim: HTMLElement; card: HTMLElement } {
  const scrim = el('div', 'scrim', parent);
  const card = el('div', `card sc-card sc-wide${fit ? ' sc-fit' : ''}`, scrim);
  return { scrim, card };
}

/** Locked-tile hover text: prerequisites by lesson number and title where they name a lesson. */
function prerequisiteText(missing: string[], syllabus: readonly Lesson[]): string {
  const words = missing.map((m) => {
    const l = syllabus.find((x) => x.id === m);
    return l ? `Lesson ${l.number} ${l.title}` : m;
  });
  return words.length ? `Needs: ${words.join('; ')}` : '';
}

export function renderSyllabus(parent: HTMLElement, sc: ScreenCtx): ScreenView {
  const { scrim, card } = modal(parent);
  const { career, deps } = sc;
  const save = career.save;
  const a = career.authority;
  const h = header(card, 'Syllabus', 'Twenty lessons and the skill test. A lesson opens when the ones before it are competent.', 'KFBL Flight Training');
  button(h.root, '×', () => sc.go('home'), { cls: 'sc-x', title: 'Back (Esc)' });
  const body = el('div', 'sc-body', card);

  const statuses: Record<string, LessonProgress['status']> = save ? deps.lessonStatuses(save, career.syllabus, a) : {};
  const next = save ? deps.nextLesson(save, career.syllabus, a) : null;

  for (const row of ROWS) {
    const lessons = career.syllabus.filter((l) => row.of.includes(l.stage));
    if (lessons.length === 0) continue;
    const r = el('div', 'sc-stage-row', body);
    const h4 = el('h4', '', r, row.title);
    if (row.sub) el('span', '', h4, row.sub);
    const tiles = el('div', 'sc-tiles', r);
    for (const l of lessons) {
      const status = statuses[l.id] ?? 'locked';
      const prog = save?.progress[l.id];
      const open = status !== 'locked' || !!career.unlockAll;
      const gate = l.kind === 'check' || l.kind === 'test';
      const cls = ['sc-tile', status, gate ? 'gate' : '', l.kind === 'test' ? 'test' : '', next?.id === l.id ? 'next' : ''].filter(Boolean).join(' ');
      const t = button(tiles, '', () => {
        if (open) sc.send({ kind: 'openLesson', lessonId: l.id });
      }, { cls });
      t.replaceChildren();
      el('span', 'sc-num', t, l.id.startsWith('L') ? `LESSON ${l.number}` : l.id);
      el('b', '', t, l.title);
      el('span', 'sc-ref', t, `${lessonRef(l, a)} · ${kindWord(l.kind)} · ${l.estMinutes} min`);
      const foot = el('div', 'sc-tile-foot', t);
      if (status === 'competent') {
        el('span', 'sc-stars', foot, starString(prog?.bestStars ?? 1));
        el('span', '', foot, prog?.completedAt ? formatDate(prog.completedAt) : 'Competent');
      } else if (status === 'available') {
        el('span', '', foot, prog?.lastOutcome ? outcomeLabel(prog.lastOutcome) : 'Available');
        el('span', '', foot, prog?.attempts ? `${prog.attempts}×` : '');
      } else {
        const s = el('span', '', foot);
        el('i', 'sc-lock', s);
        s.appendChild(document.createTextNode(career.unlockAll ? 'Practice only' : 'Locked'));
        if (save) t.title = prerequisiteText(deps.missingPrerequisites(save, l, career.syllabus, a), career.syllabus);
      }
      if (!open) t.disabled = true;
    }
  }
  if (career.syllabus.length === 0) el('div', 'sc-empty', body, 'The syllabus is not available.');

  const foot = el('div', 'sc-foot', card);
  button(foot, 'Back', () => sc.go('home'), { key: 'Esc' });
  el('div', 'sc-spacer', foot);
  button(foot, 'Challenges', () => sc.go('challenges'));
  if (next) button(foot, `Brief lesson ${next.number}`, () => sc.send({ kind: 'openLesson', lessonId: next.id }), { cls: 'primary', key: 'Enter' });

  return {
    root: scrim,
    onKey(e) {
      if (bareKey(e, 'Escape')) {
        sc.go('home');
        return true;
      }
      if (bareKey(e, 'Enter', 'NumpadEnter') && next) {
        sc.send({ kind: 'openLesson', lessonId: next.id });
        return true;
      }
      return false;
    },
  };
}

export function renderChallenges(parent: HTMLElement, sc: ScreenCtx): ScreenView {
  const { scrim, card } = modal(parent, true);
  const { career, deps } = sc;
  const save = career.save;
  const a = career.authority;
  const h = header(card, 'Challenges', 'Short precision exercises scored out of 100. They never affect your lessons. Bests are kept per training standard.', 'KFBL Flight Training');
  button(h.root, '×', () => sc.go('home'), { cls: 'sc-x', title: 'Back (Esc)' });
  const body = el('div', 'sc-body', card);
  const statuses = save ? deps.lessonStatuses(save, career.syllabus, a) : {};
  const tiles = el('div', 'sc-tiles', body);
  tiles.style.gridTemplateColumns = 'repeat(auto-fill, minmax(250px, 1fr))';
  for (const c of career.challenges) {
    const unlockLesson = career.syllabus.find((l) => l.id === c.unlockedBy);
    const open = statuses[c.unlockedBy] === 'competent';
    const bests: ChallengeBest[] = (save?.bests[c.id] ?? []).filter((b) => b.authority === a).sort((x, y) => y.score - x.score);
    const t = button(tiles, '', () => {
      if (open) sc.send({ kind: 'startChallenge', challengeId: c.id });
    }, { cls: `sc-tile ${open ? 'available' : 'locked'}` });
    t.replaceChildren();
    t.style.minHeight = '150px';
    el('span', 'sc-num', t, 'CHALLENGE');
    el('b', '', t, c.title);
    el('span', 'sc-ref', t, c.description);
    const foot = el('div', 'sc-tile-foot', t);
    if (!open) {
      const s = el('span', '', foot);
      el('i', 'sc-lock', s);
      s.appendChild(document.createTextNode(unlockLesson ? `After lesson ${unlockLesson.number}` : 'Locked'));
    } else if (bests.length) {
      const best = bests[0];
      const medal = medalFor(best.score);
      const s = el('span', '', foot);
      if (medal) el('i', `sc-medal ${medal}`, s);
      s.appendChild(document.createTextNode(`Best ${Math.round(best.score)}`));
      el('span', '', foot, bests.slice(1, 5).map((b) => Math.round(b.score)).join(' · '));
    } else {
      el('span', '', foot, 'Not flown yet');
      el('span', '', foot, 'Gold 92');
    }
    if (!open) t.disabled = true;
  }
  if (career.challenges.length === 0) el('div', 'sc-empty', body, 'No challenges are available.');
  const foot = el('div', 'sc-foot', card);
  button(foot, 'Back', () => sc.go('home'), { key: 'Esc' });
  el('div', 'sc-spacer', foot);
  el('span', 'sc-note', foot, 'Medals: bronze 60 · silver 80 · gold 92');
  return {
    root: scrim,
    onKey(e) {
      if (bareKey(e, 'Escape')) {
        sc.go('home');
        return true;
      }
      return false;
    },
  };
}
