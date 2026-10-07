// Expanded lesson card (section 5.4, Tab): lesson, phase and task; the targets with horizontal deviation bars
// (centre target, green ±tol, amber to 1.5 tol, red beyond); the step timer; the active checklist with ticks;
// the last five captions. In assessed tasks the bars read "Assessment: no live feedback". Checklist items
// still to do show the key that answers them (checklistKeys.ts).

import type { Caption, CardModel } from '../../training/types';
import { el, setText } from '../dom';
import { barPosition, formatClock, formatSigned, formatValue } from './format';
import { speakerTag } from './captions';
import { checklistItemHint, checklistItemKeys } from './checklistKeys';
import { renderCaps } from './widgets';

interface TargetRow { key: string; bar: HTMLElement; dot: HTMLElement; value: HTMLElement; dev: HTMLElement }

export class LessonCard {
  readonly root: HTMLElement;
  private readonly lesson: HTMLElement;
  private readonly timer: HTMLElement;
  private readonly task: HTMLElement;
  private readonly targets: HTMLElement;
  private readonly noLive: HTMLElement;
  private readonly checklist: HTMLElement;
  private readonly captions: HTMLElement;
  private rows: TargetRow[] = [];
  private checklistKey = '';
  private captionsKey = '';

  constructor(parent: HTMLElement) {
    this.root = el('div', 'sc-lcard hidden', parent);
    const head = el('div', 'sc-lcard-head', this.root);
    this.lesson = el('span', '', head);
    this.timer = el('b', 'sc-timer', head);
    this.task = el('h4', '', this.root);
    this.targets = el('div', '', this.root);
    this.noLive = el('div', 'sc-nolive hidden', this.root, 'Assessment: no live feedback');
    this.checklist = el('div', 'sc-cklist hidden', this.root);
    this.captions = el('div', 'sc-lcaps hidden', this.root);
  }

  set visible(v: boolean) {
    this.root.classList.toggle('hidden', !v);
  }

  get visible(): boolean {
    return !this.root.classList.contains('hidden');
  }

  render(m: CardModel): void {
    setText(this.lesson, `${m.lessonTitle} · ${m.phaseTitle}`);
    setText(this.timer, formatClock(m.stepT));
    setText(this.task, m.taskTitle);

    const live = m.liveFeedback && m.targets.length > 0;
    this.noLive.classList.toggle('hidden', m.liveFeedback || m.targets.length === 0);
    this.targets.classList.toggle('hidden', !live);
    if (live) this.renderTargets(m);

    const ck = m.checklist;
    const ckKey = ck ? `${ck.title}|${ck.items.map((i) => `${i.id}:${i.state}:${i.key ?? ''}`).join(',')}` : '';
    if (ckKey !== this.checklistKey) {
      this.checklistKey = ckKey;
      this.checklist.replaceChildren();
      this.checklist.classList.toggle('hidden', !ck);
      if (ck) {
        el('b', '', this.checklist, ck.title);
        for (const it of ck.items) {
          const row = el('div', `sc-ck ${it.state}`, this.checklist);
          el('i', '', row);
          el('span', '', row, it.label);
          // The key that answers it, on the items still to do (a done item needs no reminder). A guided item
          // carries its own key for the state it needs (I for the avionics, 4 for magnetos BOTH).
          if (it.state === 'active' || it.state === 'pending') {
            const keys = el('span', 'sc-ck-keys', row);
            renderCaps(keys, it.key ? guidedCaps(it.key) : checklistItemKeys(it.id));
            keys.title = it.key ? `${it.required ?? ''}: ${it.key}`.replace(/^: /, '') : checklistItemHint(it.id);
          }
        }
      }
    }
    this.renderCaptions(m.captions.slice(-5));
  }

  private renderTargets(m: CardModel): void {
    const key = m.targets.map((t) => `${t.label}|${t.unit}`).join(',');
    if (key !== this.rows.map((r) => r.key).join(',')) {
      this.targets.replaceChildren();
      this.rows = m.targets.map((t) => {
        const row = el('div', 'sc-target', this.targets);
        el('span', '', row, t.label);
        const bar = el('div', 'sc-dev', row);
        const dot = el('i', '', bar);
        const value = el('b', '', row);
        const v = el('span', '', value);
        value.appendChild(document.createTextNode(' '));
        const dev = el('small', '', value);
        return { key: `${t.label}|${t.unit}`, bar, dot, value: v, dev };
      });
    }
    m.targets.forEach((t, i) => {
      const r = this.rows[i];
      const angle = t.unit === 'deg' || t.unit === '°';
      const p = barPosition(t.target, t.value, t.tol, angle);
      const zone = `sc-dev ${p.zone === 'green' ? '' : p.zone}`.trim();
      if (r.bar.className !== zone) r.bar.className = zone;
      r.dot.style.left = `${(p.pos * 100).toFixed(1)}%`;
      const heading = angle && /hdg|heading|crs/i.test(t.label);
      setText(r.value, formatValue(t.value, t.unit, heading));
      let e = t.value - t.target;
      if (angle) e = ((((e + 180) % 360) + 360) % 360) - 180;
      setText(r.dev, formatSigned(e, t.unit));
    });
  }

  private renderCaptions(caps: readonly Caption[]): void {
    const key = caps.map((c) => c.id).join(',');
    if (key === this.captionsKey) return;
    this.captionsKey = key;
    this.captions.replaceChildren();
    this.captions.classList.toggle('hidden', caps.length === 0);
    for (const c of caps) {
      const d = el('div', '', this.captions);
      const tag = speakerTag(c.actor);
      if (tag) el('em', `sc-spk-${c.actor}`, d, tag);
      d.appendChild(document.createTextNode(c.text));
    }
  }
}

/** "Shift+O" -> [['Shift', 'O']]; "F2 / F3" -> [['F2'], ['F3']]. */
export function guidedCaps(key: string): string[][] {
  return key.split(' / ').map((k) => (k.startsWith('Shift+') ? ['Shift', k.slice(6)] : [k]));
}
