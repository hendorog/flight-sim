// Caption bar (section 5.4): bottom centre above the control widget in the outside views, on the glareshield
// in the cockpit view (see update); speaker tag (INSTRUCTOR teal, EXAMINER
// slate, YOU grey, TOWER amber) and the text; Safety lines in red. A caption stays while it is being spoken
// (estimated from its length: the port gives no end event) and fades 3 s after that. The last 30 are kept
// for the menu's caption log.

import type { ActorId, Caption } from '../../training/types';
import { el } from '../dom';

const TAGS: Record<ActorId, string> = {
  instructor: 'INSTRUCTOR', examiner: 'EXAMINER', student: 'YOU', tower: 'TOWER', ground: 'GROUND', atis: 'ATIS', system: '',
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
  private shown = false;
  readonly log: { caption: Caption; safety: boolean }[] = [];
  /** Captions switched off in the settings: the bar stays hidden (the card and the log still record them). */
  enabled = true;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'sc-captions', parent);
    this.box = el('div', 'sc-caption out', this.root);
    this.tag = el('em', '', this.box);
    this.text = el('span', '', this.box);
  }

  show(c: Caption, safety: boolean, nowS: number): void {
    this.log.push({ caption: c, safety });
    if (this.log.length > LOG) this.log.splice(0, this.log.length - LOG);
    if (!this.enabled && !safety) return;
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
    this.box.classList.add('out');
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
    if (this.shown && nowS >= this.hideAt) this.clear();
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
