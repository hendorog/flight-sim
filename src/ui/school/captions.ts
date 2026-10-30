// Caption bar (section 5.4): bottom centre above the control widget in the outside views, on the glareshield
// in the cockpit view (see update); speaker tag (INSTRUCTOR teal, EXAMINER
// slate, YOU grey, TOWER amber) and the text; Safety lines in red. A caption stays while it is being spoken
// (estimated from its length: the port gives no end event). During lessons it remains visible; outside
// lessons it fades 3 s later. The last 30 lines remain in the on-screen and menu caption histories.

import type { ActorId, Caption } from '../../training/types';
import { el } from '../dom';

const TAGS: Record<ActorId, string> = {
  instructor: 'INSTRUCTOR', examiner: 'EXAMINER', student: 'YOU', tower: 'TOWER', ground: 'GROUND', atis: 'ATIS', traffic: 'TRAFFIC', system: '',
};

export function speakerTag(a: ActorId): string {
  return TAGS[a] ?? '';
}

/** Seconds a caption is read for: about 2.6 words a second (the synthesiser's pace at rate 1), at least 2 s. */
export function captionHoldS(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(2, words / 2.6);
}

/** Linger after the line ends (section 5.4: fades 3 s after the end). */
const FADE_AFTER_S = 3;
const LOG = 30;
/** How far above the panel's top edge the caption bar starts (the glareshield coaming), CSS px. */
const GLARE_OVERLAP_PX = 24;

export class CaptionBar {
  readonly root: HTMLElement;
  private readonly box: HTMLElement;
  private readonly tag: HTMLElement;
  private readonly text: HTMLElement;
  private hideAt = 0;
  private readonly history: HTMLElement;
  private readonly instruction: HTMLElement;
  private lastInstruction = '';
  /** Lessons keep their latest instruction until the next one or the lesson ends. */
  sticky = false;
  private shown = false;
  readonly log: { caption: Caption; safety: boolean }[] = [];
  /** Retained for old callers; captions now always display, independent of voice preferences. */
  enabled = true;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'sc-captions hidden', parent);
    this.box = el('div', 'sc-caption out', this.root);
    this.tag = el('em', '', this.box);
    this.text = el('span', '', this.box);
    this.box.setAttribute('role', 'status');
    this.instruction = el('div', 'sc-last-instruction hidden', this.root);
    const details = el('details', 'sc-caption-history', this.root);
    el('summary', '', details, 'Caption history');
    this.history = el('div', '', details);
    this.root.addEventListener('pointerdown', e => e.stopPropagation());
    this.root.addEventListener('keydown', e => { if (e.code === 'Enter' || e.code === 'Space') e.stopPropagation(); });
  }

  show(c: Caption, safety: boolean, nowS: number): void {
    const old = this.log.findIndex(line => line.caption.id === c.id);
    if (old >= 0) this.log.splice(old, 1);
    this.log.push({ caption: c, safety });
    if (this.log.length > LOG) this.log.splice(0, this.log.length - LOG);
    this.history.replaceChildren();
    for (const line of this.log.slice().reverse()) {
      const row = el('div', '', this.history);
      el('b', '', row, `${speakerTag(line.caption.actor) || 'FLIGHT'} · ${Math.floor(line.caption.atSim / 60)}:${String(Math.floor(line.caption.atSim % 60)).padStart(2, '0')} `);
      el('span', '', row, line.caption.text);
    }
    const instructor = c.actor === 'instructor' || c.actor === 'examiner';
    if (instructor) this.lastInstruction = `${speakerTag(c.actor)}: ${c.text}`;
    this.instruction.textContent = this.lastInstruction;
    this.instruction.classList.toggle('hidden', instructor || !this.lastInstruction || !this.sticky);
    const tag = speakerTag(c.actor);
    this.tag.textContent = safety && !tag ? 'SAFETY' : tag;
    this.tag.className = c.actor;
    this.tag.classList.toggle('hidden', !this.tag.textContent);
    this.text.textContent = c.text;
    this.box.className = `sc-caption${safety ? ' safety' : ''}${c.actor === 'student' ? ' student-line' : ''}`;
    this.hideAt = nowS + captionHoldS(c.text) + FADE_AFTER_S;
    this.shown = true;
  }

  clear(): void {
    this.shown = false;
    this.lastInstruction = '';
    this.box.classList.add('out');
    this.instruction.classList.add('hidden');
  }

  /**
   * @param glareY screen y of the panel's top edge in the cockpit view: the bar then sits on the glareshield,
   *   across that edge. null keeps the default (bottom centre, for the outside views).
   *
   * Playtesting showed why not just above it, on the windscreen: there the bar covered the top of the cowling
   * against the horizon, the attitude picture the instructor is talking about ("watch the nose against the
   * horizon"). On the glareshield it covers only the coaming and the panel's blank top strip, and a one- or
   * two-line caption still ends above the instruments.
   */
  update(nowS: number, glareY: number | null = null): void {
    if (!this.sticky && this.shown && nowS >= this.hideAt) this.clear();
    // Never up under the lesson strip and its annunciators, never down among the toasts.
    const top = glareY === null ? '' : `${Math.round(Math.max(110, Math.min(window.innerHeight - 190, glareY - GLARE_OVERLAP_PX)))}px`;
    if (this.root.style.top !== top) {
      this.root.style.top = top;
      this.root.style.bottom = top ? 'auto' : '';
    }
  }

  get visibleText(): string | null {
    return this.shown ? this.text.textContent : null;
  }
}
