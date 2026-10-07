// Lesson strip (section 5.4): top centre, at most 560 px wide. Left the authority chip (with instructor-hold
// sub-chips and the "match the throttle" bar), centre the task, right up to four tolerance chips. The DOM is
// built once and only touched where the model changed. While a checklist runs, the line under the task shows
// the item being challenged and the key that answers it, in place of the lesson title (setPrompt).

import type { AuthorityChip, LessonStripModel } from '../../training/types';
import { el, setText } from '../dom';
import { renderCaps } from './widgets';

export const AUTHORITY_TEXT: Record<AuthorityChip, string> = {
  instructor: 'INSTRUCTOR HAS CONTROL',
  followMe: 'FOLLOW ME THROUGH',
  offered: 'OFFERED: PRESS ENTER',
  student: 'YOU HAVE CONTROL',
  solo: 'SOLO',
  skillTest: 'SKILL TEST',
};

export class LessonStrip {
  readonly root: HTMLElement;
  private readonly chip: HTMLElement;
  private readonly holds: HTMLElement;
  private readonly match: HTMLElement;
  private readonly matchFill: HTMLElement;
  private readonly task: HTMLElement;
  private readonly lesson: HTMLElement;
  private readonly chips: HTMLElement;
  private readonly assess: HTMLElement;
  private chipEls: HTMLElement[] = [];
  private lastAuth: AuthorityChip | null = null;
  private lastHolds = '';
  private lessonTitle = '';
  private prompt: { text: string; keys: string[][] } | null = null;
  private promptKey = '';

  constructor(parent: HTMLElement) {
    this.root = el('div', 'sc-strip hidden', parent);
    const auth = el('div', 'sc-auth', this.root);
    this.chip = el('div', 'chip', auth);
    this.holds = el('div', 'sc-hold hidden', auth);
    this.match = el('div', 'sc-match hidden', auth, 'Match the throttle');
    this.matchFill = el('i', '', el('div', 'bar', this.match));
    const mid = el('div', 'sc-task', this.root);
    this.task = el('b', '', mid);
    this.lesson = el('span', '', mid);
    const right = el('div', '', this.root);
    this.chips = el('div', 'sc-tchips', right);
    this.assess = el('div', 'sc-assess hidden', right, 'Assessment');
  }

  get visible(): boolean {
    return !this.root.classList.contains('hidden');
  }

  set visible(v: boolean) {
    this.root.classList.toggle('hidden', !v);
  }

  render(m: LessonStripModel): void {
    if (m.authority !== this.lastAuth) {
      this.lastAuth = m.authority;
      this.chip.className = `chip ${m.authority}`;
      this.chip.textContent = AUTHORITY_TEXT[m.authority];
    }
    const holds = m.holds.join(' · ');
    if (holds !== this.lastHolds) {
      this.lastHolds = holds;
      this.holds.textContent = holds;
      this.holds.classList.toggle('hidden', !holds);
    }
    this.match.classList.toggle('hidden', m.matchThrottle === null);
    if (m.matchThrottle !== null) this.matchFill.style.width = `${Math.round(Math.max(0, Math.min(1, m.matchThrottle)) * 100)}%`;
    setText(this.task, m.taskTitle);
    this.lessonTitle = m.lessonTitle;
    this.renderSubtitle();

    const chips = m.chips.slice(0, 4);
    while (this.chipEls.length < chips.length) this.chipEls.push(el('span', 'sc-tchip', this.chips));
    while (this.chipEls.length > chips.length) this.chipEls.pop()!.remove();
    chips.forEach((c, i) => {
      const e = this.chipEls[i];
      const cls = `sc-tchip ${c.state}`;
      if (e.className !== cls) e.className = cls;
      setText(e, c.text);
    });
    // Only while the student is flying it: not over "Restoring straight and level" or a handover offer.
    const studentFlying = m.authority === 'student' || m.authority === 'solo' || m.authority === 'skillTest';
    this.assess.classList.toggle('hidden', !(m.assessed && chips.length === 0 && studentFlying));
  }

  /** The checklist item being challenged and its keys ("Master switch: On" + W / Enter), or null for the lesson title. */
  setPrompt(p: { text: string; keys: string[][] } | null): void {
    this.prompt = p;
    this.renderSubtitle();
  }

  private renderSubtitle(): void {
    const p = this.prompt;
    const key = p ? `${p.text}|${p.keys.map((k) => k.join('+')).join('/')}` : `title|${this.lessonTitle}`;
    if (key === this.promptKey) return;
    this.promptKey = key;
    this.lesson.replaceChildren();
    this.lesson.classList.toggle('sc-prompt', !!p);
    if (!p) {
      this.lesson.textContent = this.lessonTitle;
      return;
    }
    this.lesson.appendChild(document.createTextNode(`${p.text} `));
    renderCaps(this.lesson, p.keys).className = 'sc-ck-keys';
  }
}
