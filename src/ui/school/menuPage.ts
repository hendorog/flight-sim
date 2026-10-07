// The pause menu's School tab (section 5.6). Outside a lesson: profile summary, "Open Flight School" and the
// training settings. During a lesson: lesson, phase and task; the objective; the live criteria; Try again
// from this phase, Restart lesson, Show me, Abandon lesson (confirmed); the caption log (last 30).

import type { CardModel, Lesson, LessonStripModel } from '../../training/types';
import { el } from '../dom';
import { speakerTag, type CaptionBar } from './captions';
import { barPosition, formatHours, formatSigned, formatValue } from './format';
import { lessonRef } from './home';
import { AUTHORITY_TEXT } from './lessonStrip';
import { buildSettingsForm } from './settings';
import { button, section, type ScreenCtx } from './widgets';

export interface MenuLive {
  strip: LessonStripModel | null;
  card: CardModel | null;
  /** The lesson being flown (from its briefing), for the objective. */
  lesson: Lesson | null;
  captions: CaptionBar['log'];
}

/** Fill the School tab page. `close` closes the menu (after a lesson command). */
export function renderMenuPage(parent: HTMLElement, sc: ScreenCtx, live: MenuLive, close: () => void): void {
  parent.replaceChildren();
  if (live.strip) lessonPage(parent, sc, live, close);
  else profilePage(parent, sc, close);
}

function lessonPage(p: HTMLElement, sc: ScreenCtx, live: MenuLive, close: () => void): void {
  const strip = live.strip!;
  el('h2', '', p, strip.lessonTitle);
  const sub = live.card ? `${live.card.phaseTitle} · ${live.card.taskTitle}` : strip.taskTitle;
  el('p', 'sub', p, `${sub} · ${AUTHORITY_TEXT[strip.authority].toLowerCase()}`);
  if (live.lesson) {
    section(p, 'Objective');
    el('p', 'sc-aim', p, live.lesson.briefing.aim).style.fontSize = '14px';
  }
  const card = live.card;
  if (card && card.targets.length) {
    section(p, card.liveFeedback ? 'Live criteria' : 'Criteria (assessed: no live feedback)');
    const box = el('div', 'sc-menu-live', p);
    for (const t of card.targets) {
      const row = el('div', 'sc-target', box);
      el('span', '', row, t.label);
      const angle = t.unit === 'deg';
      const pos = barPosition(t.target, t.value, t.tol, angle);
      const bar = el('div', `sc-dev ${card.liveFeedback && pos.zone !== 'green' ? pos.zone : ''}`.trim(), row);
      if (card.liveFeedback) el('i', '', bar).style.left = `${(pos.pos * 100).toFixed(1)}%`;
      const heading = angle && /hdg|heading/i.test(t.label);
      // As on the lesson card: the present value and its deviation; the target alone when assessed.
      const v = el('b', '', row, formatValue(card.liveFeedback ? t.value : t.target, t.unit, heading));
      if (card.liveFeedback) {
        let e = t.value - t.target;
        if (angle) e = ((((e + 180) % 360) + 360) % 360) - 180;
        el('small', '', v, ` ${formatSigned(e, t.unit)}`);
      }
    }
  }
  section(p, 'Lesson');
  const row = el('div', 'chips', p);
  const run = (cmd: 'retryPhase' | 'restartLesson' | 'showMe'): void => {
    sc.send({ kind: 'runner', cmd });
    close();
  };
  button(row, 'Try again from this phase', () => run('retryPhase'), { key: 'Shift+R' });
  button(row, 'Restart lesson', () => run('restartLesson'));
  button(row, 'Show me (demonstration)', () => run('showMe'), { key: '[' });
  const confirmBox = el('div', 'hidden', p);
  button(row, 'Abandon lesson', () => confirmBox.classList.remove('hidden'));
  const c = el('div', 'sc-confirm', confirmBox);
  el('span', '', c, 'Abandon the lesson? The flight so far is logged as dual time, and free flight continues.');
  button(c, 'Keep flying', () => confirmBox.classList.add('hidden'));
  button(c, 'Abandon', () => {
    sc.send({ kind: 'runner', cmd: 'abandon' });
    close();
  }, { cls: 'danger' });

  section(p, 'Captions');
  const log = el('div', 'sc-caplog', p);
  if (live.captions.length === 0) el('div', '', log, 'Nothing said yet.').style.color = 'var(--fg-dim)';
  for (const { caption, safety } of live.captions) {
    const d = el('div', '', log);
    const tag = speakerTag(caption.actor);
    if (tag) el('em', `sc-spk-${caption.actor}`, d, tag);
    const t = el('span', '', d, caption.text);
    if (safety) t.style.color = '#ff8a7d';
  }
  // Newest at the bottom, in view.
  requestAnimationFrame(() => (log.scrollTop = log.scrollHeight));
}

function profilePage(p: HTMLElement, sc: ScreenCtx, close: () => void): void {
  const save = sc.career.save;
  el('h2', '', p, 'Flight School');
  if (!save) {
    el('p', 'sub', p, 'A private pilot course with an instructor: twenty lessons and the skill test.');
    const row = el('div', 'chips', p);
    button(row, 'Open Flight School', () => {
      close();
      sc.send({ kind: 'openHome' });
    }, { cls: 'primary' });
    return;
  }
  const a = sc.career.authority;
  const next = sc.deps.nextLesson(save, sc.career.syllabus, a);
  const tot = sc.deps.totals(save.logbook);
  el('p', 'sub', p, `${save.profile.studentName} · ${sc.deps.rank(save, a)} · ${formatHours(tot.totalS)} logged`);
  const row = el('div', 'chips', p);
  button(row, 'Open Flight School', () => {
    close();
    sc.send({ kind: 'openHome' });
  }, { cls: 'primary' });
  if (next) {
    button(row, `Brief lesson ${next.number}: ${next.title}`, () => {
      close();
      sc.send({ kind: 'openLesson', lessonId: next.id });
    }, { title: lessonRef(next, a) });
  }
  buildSettingsForm(p, sc, true);
}
