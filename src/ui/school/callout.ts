// Control callouts (owner playtest: "the controls are not pointed out, moving the view port around is very
// cumbersome"): when the instructor names a control, a pulsing ring sits on it with a label - its name, the
// state wanted and the key that works it, with the reason underneath. Off screen, an arrow on the screen edge
// points the way. In an outside view the label docks under the lesson strip. Clicking the label presses the
// key. The first time a callout appears with its control off screen, the cockpit camera glances at it (when
// the setting allows) and looks back once it is done, after 6 s, or when the next one replaces it.

import type { CalloutModel, PointTarget } from '../../training/types';
import { el, setText } from '../dom';

/** Where a control is on screen (client px); `behind`: behind the camera. Null: cannot be projected. */
export type CalloutProjector = (target: PointTarget) => { x: number; y: number; behind: boolean } | null;

/** A glance looks back after this long, ms. */
export const GLANCE_MS = 6000;
/**
 * Controls whose key must be held to get there: the mixture travels its whole range (cut-off to rich takes about
 * 4 s of Shift+M). Not the throttle: "a quarter inch" is a tap, and a held F3 started a playtest at 1,800 rpm.
 */
const HELD_TARGETS: ReadonlySet<PointTarget> = new Set<PointTarget>(['mixture']);
/** Margin inside the viewport that counts as on screen, px. */
const EDGE = 56;

export class ControlCallout {
  readonly root: HTMLElement;
  private readonly ring: HTMLElement;
  private readonly arrow: HTMLElement;
  private readonly chip: HTMLElement;
  private readonly name: HTMLElement;
  private readonly state: HTMLElement;
  private readonly key: HTMLElement;
  private readonly why: HTMLElement;
  private readonly more: HTMLElement;
  private model: CalloutModel | null = null;
  /** The callout id glanced for, and when; null: no glance active. */
  private glance: { id: string; at: number } | null = null;
  private glancedIds = new Set<string>();
  private keyHeld: { code: string; shift: boolean } | null = null;
  /** Set by SchoolUi: turn the cockpit camera toward a control (null: look back). */
  onGlance: ((target: PointTarget | null) => boolean | void) | null = null;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'sc-co hidden', parent);
    this.ring = el('div', 'sc-co-ring', this.root);
    this.arrow = el('div', 'sc-co-arrow', this.root);
    this.chip = el('div', 'sc-co-chip', this.root);
    const top = el('div', 'sc-co-top', this.chip);
    this.name = el('b', '', top);
    this.state = el('span', 'sc-co-state', top);
    this.key = el('kbd', 'sc-co-key', top);
    this.why = el('div', 'sc-co-why', this.chip);
    this.more = el('div', 'sc-co-more', this.chip);
    this.chip.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointerup', this.onUp);
  }

  dispose(): void {
    window.removeEventListener('pointerup', this.onUp);
    this.release();
    this.endGlance();
  }

  get current(): CalloutModel | null {
    return this.model;
  }

  /** The glance in progress, for automation (the callout id), or null. */
  get glancing(): string | null {
    return this.glance?.id ?? null;
  }

  set(m: CalloutModel | null): void {
    const prev = this.model;
    if (prev && (!m || m.id !== prev.id)) this.endGlance();
    this.model = m;
    this.root.classList.toggle('hidden', !m);
    if (!m) return;
    setText(this.name, m.label);
    setText(this.state, m.state ? `→ ${m.state}` : '');
    this.state.classList.toggle('hidden', !m.state);
    // Levers move while their key is held, and the starter turns while S is held (playtest 3: Shift+M took
    // three presses to reach RICH because a tap barely moves the knob): say "hold" on the key.
    setText(this.key, m.key ? (HELD_TARGETS.has(m.target) || m.state === 'START' ? `hold ${m.key}` : m.key) : '');
    this.key.classList.toggle('hidden', !m.key);
    setText(this.why, m.why ?? '');
    this.why.classList.toggle('hidden', !m.why);
    setText(this.more, m.queued > 0 ? `+${m.queued} more` : '');
    this.more.classList.toggle('hidden', m.queued <= 0);
    this.root.classList.toggle('done', m.done);
    this.chip.classList.toggle('clickable', !!m.keyCode);
    this.chip.title = m.keyCode ? `Click to press ${m.key}` : '';
    if (m.done) this.endGlance();
  }

  /** Per frame: place the ring, the edge arrow and the label; start or end the glance. */
  update(project: CalloutProjector | null, cockpit: boolean, viewW: number, viewH: number): void {
    const m = this.model;
    if (!m) return;
    const now = performance.now();
    if (this.glance && now - this.glance.at > GLANCE_MS) this.endGlance();
    const p = cockpit && project ? project(m.target) : null;
    if (!p) {
      // Outside view (or no projection): the label docks under the strip, no ring or arrow.
      this.ring.classList.add('hidden');
      this.arrow.classList.add('hidden');
      this.root.classList.add('docked');
      this.chip.style.transform = `translate(${Math.round(viewW / 2 - this.chip.offsetWidth / 2)}px, 84px)`;
      return;
    }
    this.root.classList.remove('docked');
    const on = !p.behind && p.x >= EDGE && p.x <= viewW - EDGE && p.y >= EDGE && p.y <= viewH - EDGE;
    if (!on && m.glance && !m.done && !this.glancedIds.has(m.id) && this.onGlance?.(m.target) !== false) {
      this.glancedIds.add(m.id);
      if (this.glancedIds.size > 64) this.glancedIds = new Set([m.id]);
      this.glance = { id: m.id, at: now };
    }
    const cw = this.chip.offsetWidth || 220;
    const ch = this.chip.offsetHeight || 40;
    if (on) {
      this.ring.classList.remove('hidden');
      this.arrow.classList.add('hidden');
      this.ring.style.transform = `translate(${(p.x - 26).toFixed(1)}px, ${(p.y - 26).toFixed(1)}px)`;
      // Label above the ring when there is room, else below; kept on screen.
      const lx = Math.min(viewW - cw - 8, Math.max(8, p.x - cw / 2));
      const ly = clearOfToasts(lx, p.y - 40 - ch > 70 ? p.y - 40 - ch : Math.min(viewH - ch - 8, p.y + 40), cw, ch, viewW, viewH);
      this.chip.style.transform = `translate(${lx.toFixed(1)}px, ${ly.toFixed(1)}px)`;
      return;
    }
    // Off screen: an arrow on the edge, toward the control (from the centre of the view).
    this.ring.classList.add('hidden');
    this.arrow.classList.remove('hidden');
    const cx = viewW / 2, cy = viewH / 2;
    let dx = p.x - cx, dy = p.y - cy;
    if (p.behind) {
      dx = -dx;
      dy = -dy;
    }
    if (Math.abs(dx) < 1e-3 && Math.abs(dy) < 1e-3) dy = 1;
    const sx = (viewW / 2 - EDGE) / Math.max(1e-3, Math.abs(dx));
    const sy = (viewH / 2 - EDGE) / Math.max(1e-3, Math.abs(dy));
    const k = Math.min(sx, sy);
    const ax = cx + dx * k, ay = cy + dy * k;
    const ang = Math.atan2(dy, dx);
    this.arrow.style.transform = `translate(${(ax - 22).toFixed(1)}px, ${(ay - 22).toFixed(1)}px) rotate(${ang.toFixed(3)}rad)`;
    // The label sits inward of the arrow.
    const lx = Math.min(viewW - cw - 8, Math.max(8, ax - cw / 2 - Math.cos(ang) * (cw / 2 + 44)));
    const ly = clearOfToasts(lx, Math.min(viewH - ch - 8, Math.max(70, ay - ch / 2 - Math.sin(ang) * (ch / 2 + 44))), cw, ch, viewW, viewH);
    this.chip.style.transform = `translate(${lx.toFixed(1)}px, ${ly.toFixed(1)}px)`;
  }

  private endGlance(): void {
    if (!this.glance) return;
    this.glance = null;
    this.onGlance?.(null);
  }

  // ---- clicking the label presses the key (held while the button is down: the starter) ----------------------

  private readonly onDown = (e: PointerEvent): void => {
    const k = this.model?.keyCode;
    if (!k || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    this.keyHeld = k;
    window.dispatchEvent(new KeyboardEvent('keydown', { code: k.code, key: k.code, shiftKey: k.shift, bubbles: true }));
  };

  private readonly onUp = (): void => this.release();

  private release(): void {
    const k = this.keyHeld;
    if (!k) return;
    this.keyHeld = null;
    window.dispatchEvent(new KeyboardEvent('keyup', { code: k.code, key: k.code, shiftKey: k.shift, bubbles: true }));
  }
}

/**
 * Keep the label out of the toast band (ui/styles.ts: centred, 96 px above the bottom): playtest 3, a "Beacon ON"
 * toast covered the fuel selector's reason. A label that would overlap it moves up above the band.
 */
function clearOfToasts(x: number, y: number, w: number, h: number, viewW: number, viewH: number): number {
  const bandTop = viewH - 96 - 48, bandBottom = viewH - 90;
  const overlapsX = x < viewW / 2 + 180 && x + w > viewW / 2 - 180;
  if (!overlapsX || y > bandBottom || y + h < bandTop) return y;
  return Math.max(70, bandTop - h - 8);
}
