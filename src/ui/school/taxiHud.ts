// Taxi guidance HUD (owner playtest: "There were no directions on where the holding point was, which way to
// turn while taxiing"): top right, under where the strip ends. A big arrow for the next action (left, right,
// straight, or the hold-short bars), the taxiway it leads onto and the distance to it, the two actions after
// it, a centreline bar (where the yellow line is relative to the aircraft) and the ground speed, amber above
// 15 kt. Approaching the hold line it turns red: HOLD SHORT A1, 35 m.

import type { TaxiAction, TaxiGuideModel } from '../../training/types';
import { el, setText } from '../dom';

const ARROWS: Record<TaxiAction, string> = {
  // 40 x 40 viewBox; stroke-drawn so they read at any size.
  left: '<path d="M28 34 V18 Q28 12 22 12 H10" /><path d="M16 5 L9 12 L16 19" />',
  right: '<path d="M12 34 V18 Q12 12 18 12 H30" /><path d="M24 5 L31 12 L24 19" />',
  straight: '<path d="M20 35 V8" /><path d="M13 15 L20 7 L27 15" />',
  holdShort: '<path d="M6 12 H34" /><path d="M6 18 H34" /><path d="M6 25 H10 M14 25 H18 M22 25 H26 M30 25 H34" /><path d="M6 31 H10 M14 31 H18 M22 31 H26 M30 31 H34" />',
  stop: '<rect x="10" y="10" width="20" height="20" rx="3" />',
};
/** Cross-track beyond which the main wheels are off the paved taxiway (half the 35 ft ADG II width, world/airport/layout.ts), m. */
const OFF_TAXIWAY_M = 5.5;
const WORDS: Record<TaxiAction, string> = { left: 'LEFT', right: 'RIGHT', straight: 'STRAIGHT', holdShort: 'HOLD SHORT', stop: 'STOP' };

export class TaxiHud {
  readonly root: HTMLElement;
  private readonly icon: HTMLElement;
  private readonly action: HTMLElement;
  private readonly onto: HTMLElement;
  private readonly dist: HTMLElement;
  private readonly then: HTMLElement;
  private readonly lineDot: HTMLElement;
  private readonly lineText: HTMLElement;
  private readonly gs: HTMLElement;
  private lastIcon: TaxiAction | null = null;
  private model: TaxiGuideModel | null = null;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'sc-taxi hidden', parent);
    const head = el('div', 'sc-taxi-head', this.root, 'TAXI GUIDANCE');
    void head;
    const main = el('div', 'sc-taxi-main', this.root);
    this.icon = el('div', 'sc-taxi-icon', main);
    const txt = el('div', 'sc-taxi-txt', main);
    this.action = el('div', 'sc-taxi-action', txt);
    this.onto = el('div', 'sc-taxi-onto', txt);
    this.dist = el('div', 'sc-taxi-dist', main);
    this.then = el('div', 'sc-taxi-then', this.root);
    const line = el('div', 'sc-taxi-line', this.root);
    const bar = el('div', 'sc-taxi-bar', line);
    el('i', 'sc-taxi-centre', bar);
    this.lineDot = el('b', 'sc-taxi-dot', bar);
    this.lineText = el('span', '', line);
    this.gs = el('div', 'sc-taxi-gs', this.root);
  }

  get current(): TaxiGuideModel | null {
    return this.model;
  }

  set(m: TaxiGuideModel | null): void {
    this.model = m;
    this.root.classList.toggle('hidden', !m);
    if (!m) return;
    const action: TaxiAction = m.holdShort ? 'holdShort' : m.action;
    if (action !== this.lastIcon) {
      this.lastIcon = action;
      this.icon.innerHTML = `<svg viewBox="0 0 40 40" width="44" height="44">${ARROWS[action]}</svg>`;
    }
    this.root.classList.toggle('hold', m.holdShort);
    setText(this.action, WORDS[action]);
    setText(this.onto, m.holdShort || action === 'holdShort' ? m.name : action === 'stop' ? 'at the stand' : `onto ${m.name}`);
    const d = m.holdShort && m.holdShortDistM !== null ? m.holdShortDistM : m.distM;
    setText(this.dist, `${d >= 100 ? Math.round(d / 10) * 10 : Math.round(d)} m`);
    setText(this.then, m.then.length ? `then ${m.then.map((t) => (t.action === 'holdShort' ? `hold short ${t.name}` : t.action === 'stop' ? 'stop' : `${t.action} ${t.name}`)).join(', ')}` : '');
    this.then.classList.toggle('hidden', m.then.length === 0 || m.holdShort);
    // Centreline bar: the yellow tick is the yellow line, the dot is the aircraft, +-6 m across the bar
    // (playtest 3: the dot moved the other way, so "21 m left of the line" showed the dot right of the tick).
    const x = Number.isFinite(m.xtrackM) ? Math.max(-6, Math.min(6, m.xtrackM)) : 0;
    this.lineDot.style.left = `${50 + (x / 6) * 46}%`;
    const off = Number.isFinite(m.xtrackM) ? Math.abs(m.xtrackM) : 0;
    this.lineDot.classList.toggle('off', off > 3);
    // Beyond the taxiway edge the next junction is not what matters: say which way to steer back (playtest 3:
    // 21 m left of Alpha, on the grass, the panel still led with "LEFT onto A1, 750 m").
    const offTaxiway = off > OFF_TAXIWAY_M;
    this.root.classList.toggle('offtw', offTaxiway);
    setText(this.lineText, off < 1 ? 'on the line'
      : offTaxiway ? `OFF THE TAXIWAY: steer ${m.xtrackM > 0 ? 'left' : 'right'}, ${Math.round(off)} m`
        : `${off.toFixed(off < 10 ? 1 : 0)} m ${m.xtrackM > 0 ? 'right' : 'left'} of the line`);
    const gs = Number.isFinite(m.gsKt) ? Math.max(0, m.gsKt) : 0;
    setText(this.gs, `GS ${Math.round(gs)} kt`);
    this.gs.classList.toggle('fast', gs > 15);
  }
}
