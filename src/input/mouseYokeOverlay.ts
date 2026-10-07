// On-screen cue for the mouse yoke: a centre ring (the pick-up zone; screen centre = yoke centre), a faint
// frame showing the yoke's full travel, a dot at the commanded deflection, and a short status label. Shown
// only while the mouse yoke is on (the label also briefly confirms switching it off). Pointer-transparent.

import { MOUSE_PICKUP_RADIUS } from './mixer';

/** The mouse yoke reaches full travel at this fraction of the half-width / half-height (see mouseYokeDeflection). */
const FULL_TRAVEL = 0.8;
/** How long the confirmation label stays up after pick-up / switching off, ms. */
const LABEL_MS = 2500;

const CSS = /* css */ `
.fs-myoke { position: fixed; pointer-events: none; z-index: 19; display: none; }
.fs-myoke.on { display: block; }
.fs-myoke .travel { position: absolute; border: 1px dashed rgba(255,255,255,.12); border-radius: 6px; }
.fs-myoke .ring { position: absolute; border: 1.5px solid rgba(255,255,255,.75); border-radius: 50%;
  box-shadow: 0 0 0 1px rgba(0,0,0,.35), inset 0 0 0 1px rgba(0,0,0,.25); transform: translate(-50%, -50%); }
.fs-myoke.armed .ring { border-color: #ffb224; animation: fs-myoke-pulse 1s ease-in-out infinite; }
.fs-myoke .cross { position: absolute; width: 14px; height: 14px; transform: translate(-50%, -50%); }
.fs-myoke .cross::before, .fs-myoke .cross::after { content: ""; position: absolute; background: rgba(255,255,255,.7); }
.fs-myoke .cross::before { left: 6.5px; top: 0; width: 1px; height: 14px; }
.fs-myoke .cross::after { top: 6.5px; left: 0; height: 1px; width: 14px; }
.fs-myoke .dot { position: absolute; width: 10px; height: 10px; border-radius: 50%; background: #52c3ff;
  box-shadow: 0 0 0 1.5px rgba(0,0,0,.5); transform: translate(-50%, -50%); }
.fs-myoke.armed .dot { display: none; }
.fs-myoke-label { position: fixed; left: 50%; transform: translateX(-50%); pointer-events: none; z-index: 19;
  padding: 7px 14px; border-radius: 999px; background: rgba(16,20,27,.78); backdrop-filter: blur(8px);
  color: #eef3f8; font: 500 13px/1.3 Inter, "Segoe UI", system-ui, -apple-system, Roboto, Arial, sans-serif;
  white-space: nowrap; transition: opacity .3s; opacity: 0; }
.fs-myoke-label.show { opacity: 1; }
.fs-myoke-label b { color: #ffb224; font-weight: 700; letter-spacing: .06em; margin-right: 6px; }
@keyframes fs-myoke-pulse { 50% { opacity: .45; } }
`;

export class MouseYokeOverlay {
  private readonly root: HTMLDivElement;
  private readonly travel: HTMLDivElement;
  private readonly ring: HTMLDivElement;
  private readonly cross: HTMLDivElement;
  private readonly dot: HTMLDivElement;
  private readonly label: HTMLDivElement;
  private readonly style: HTMLStyleElement;
  private labelUntil = 0;
  private labelText = '';
  private wasOn = false;
  private wasArmed = false;
  private labelShown = false;

  constructor(parent: HTMLElement) {
    this.style = document.createElement('style');
    this.style.textContent = CSS;
    document.head.appendChild(this.style);
    const div = (cls: string, into: HTMLElement): HTMLDivElement => {
      const d = document.createElement('div');
      d.className = cls;
      into.appendChild(d);
      return d;
    };
    this.root = div('fs-myoke', parent);
    this.travel = div('travel', this.root);
    this.ring = div('ring', this.root);
    this.cross = div('cross', this.root);
    this.dot = div('dot', this.root);
    this.label = div('fs-myoke-label', parent);
  }

  /** The mouse yoke was switched on (armed) or off. */
  announce(on: boolean): void {
    if (on) this.setLabel('<b>MOUSE YOKE</b>Move the pointer to the centre ring to take control', Infinity);
    else this.setLabel('<b>MOUSE YOKE</b>Off', performance.now() + LABEL_MS);
  }

  /** The armed mouse yoke has taken control. */
  pickedUp(): void {
    this.setLabel('<b>MOUSE YOKE</b>In control &middot; screen centre = yoke centre', performance.now() + LABEL_MS);
  }

  private setLabel(html: string, until: number): void {
    if (html !== this.labelText) {
      this.label.innerHTML = html;
      this.labelText = html;
    }
    this.labelUntil = until;
  }

  /**
   * @param rect the view's rectangle (the mouse-yoke coordinates are relative to it), or null if unknown
   */
  update(on: boolean, armed: boolean, aileron: number, elevator: number, rect: () => DOMRect | null): void {
    const now = performance.now();
    const showLabel = now < this.labelUntil;
    if (showLabel !== this.labelShown) this.label.classList.toggle('show', showLabel);
    this.labelShown = showLabel;
    if (!on) {
      if (this.wasOn) this.root.classList.remove('on');
      this.wasOn = false;
      if (showLabel) this.placeLabel(rect());
      return;
    }
    const r = rect();
    if (!r || r.width === 0) return;
    if (!this.wasOn) this.root.classList.add('on');
    this.wasOn = true;
    if (armed !== this.wasArmed) this.root.classList.toggle('armed', armed);
    this.wasArmed = armed;
    const hw = r.width / 2;
    const hh = r.height / 2;
    const st = this.root.style;
    st.left = `${r.left}px`;
    st.top = `${r.top}px`;
    st.width = `${r.width}px`;
    st.height = `${r.height}px`;
    const t = this.travel.style;
    t.left = `${hw * (1 - FULL_TRAVEL)}px`;
    t.top = `${hh * (1 - FULL_TRAVEL)}px`;
    t.width = `${2 * hw * FULL_TRAVEL}px`;
    t.height = `${2 * hh * FULL_TRAVEL}px`;
    const ring = this.ring.style;
    ring.left = this.cross.style.left = `${hw}px`;
    ring.top = this.cross.style.top = `${hh}px`;
    // A circle inside the (rectangular) pick-up zone.
    const d = `${2 * Math.min(hw, hh) * MOUSE_PICKUP_RADIUS}px`;
    ring.width = d;
    ring.height = d;
    if (!armed) {
      // The commanded deflection, drawn linearly inside the travel frame.
      this.dot.style.left = `${hw + aileron * hw * FULL_TRAVEL}px`;
      this.dot.style.top = `${hh + elevator * hh * FULL_TRAVEL}px`;
    }
    if (showLabel) this.placeLabel(r);
  }

  private placeLabel(r: DOMRect | null): void {
    const top = r ? r.top + r.height / 2 + Math.min(r.width, r.height) * MOUSE_PICKUP_RADIUS * 0.5 + 28 : window.innerHeight / 2 + 60;
    this.label.style.top = `${top}px`;
  }

  dispose(): void {
    this.root.remove();
    this.label.remove();
    this.style.remove();
  }
}
