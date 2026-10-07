// Small overlays: loading screen, toasts, crash dialog and the frame-time readout.

import { C172S_REFERENCE } from '../aircraft/c172s/reference';
import { C172S_UI } from '../aircraft/c172s/ui';
import type { UiProfile } from '../aircraft/types';
import { parkingBrakeStepText } from './cues';
import { el } from './dom';

/** Loading-screen title when the shell gives none. */
const DEFAULT_TITLE = 'Cessna 172S Skyhawk';

const LOADING_TIPS = [
  'Tip: in the cockpit, click the panel switches and scroll over the knobs to set them.',
  'Tip: Esc opens the menu: scenarios, weather, time of day, graphics and controls.',
  'Tip: set the altimeter with its knob (lower left of the altimeter) when the QNH changes.',
  'Tip: drag to look around; the wheel zooms, a middle click recentres the view.',
  'Tip: A engages the autopilot once airborne; it holds the current track, altitude and speed.',
  'Tip: keep the slip ball centred with the rudder (Z / X): "step on the ball".',
];

export class LoadingScreen {
  private readonly root: HTMLDivElement;
  private readonly fill: HTMLElement;
  private readonly label: HTMLElement;

  constructor(parent: HTMLElement, title = DEFAULT_TITLE) {
    this.root = el('div', 'loading', parent);
    el('div', 'title', this.root, title);
    el('div', 'tag', this.root, 'Flight simulator');
    const track = el('div', 'track', this.root);
    this.fill = el('i', '', track);
    this.label = el('div', 'label', this.root);
    const tip = el('div', 'tip', this.root, LOADING_TIPS[Math.floor(Math.random() * LOADING_TIPS.length)]);
    tip.setAttribute('aria-live', 'off');
  }

  setProgress(fraction: number, label?: string): void {
    this.root.classList.remove('hidden', 'done');
    this.fill.style.width = `${Math.max(0, Math.min(1, fraction)) * 100}%`;
    if (label !== undefined) this.label.textContent = label;
  }

  hide(): void {
    if (this.root.classList.contains('hidden')) return;
    this.root.classList.add('done');
    // Remove from hit-testing immediately; drop from layout after the fade.
    this.root.style.pointerEvents = 'none';
    window.setTimeout(() => {
      if (this.root.classList.contains('done')) this.root.classList.add('hidden');
      this.root.style.pointerEvents = '';
    }, 650);
  }
}

export class Toasts {
  private readonly root: HTMLDivElement;
  private static readonly MAX = 4;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'toasts', parent);
  }

  /**
   * Show a toast. With a key, a toast still on screen with the same key is updated in place and its timer
   * restarted (a lever being moved reads as one changing toast, not a stack).
   */
  show(text: string, durationMs = 2200, key?: string): void {
    if (key) {
      const live = Array.from(this.root.children).find((t) => (t as HTMLElement).dataset.key === key && !t.classList.contains('out')) as HTMLElement | undefined;
      if (live) {
        if (live.textContent !== text) live.textContent = text;
        this.arm(live, durationMs);
        return;
      }
    }
    // Replace an identical toast instead of stacking duplicates (e.g. toggling a switch repeatedly).
    for (const t of Array.from(this.root.children)) if (t.textContent === text) t.remove();
    while (this.root.children.length >= Toasts.MAX) this.root.lastElementChild?.remove();
    const t = el('div', 'toast', undefined, text);
    if (key) t.dataset.key = key;
    this.root.prepend(t);
    this.arm(t, durationMs);
  }

  private arm(t: HTMLElement, durationMs: number): void {
    const prev = Number(t.dataset.timer);
    if (prev) window.clearTimeout(prev);
    t.dataset.timer = String(
      window.setTimeout(() => {
        t.classList.add('out');
        window.setTimeout(() => t.remove(), 400);
      }, durationMs),
    );
  }

  /** Texts currently shown (newest first); for automation and tests. */
  get texts(): string[] {
    return Array.from(this.root.children, (t) => t.textContent ?? '');
  }
}

export interface CrashActions {
  restart(): void;
  chooseScenario(): void;
}

/**
 * A custom crash-dialog action (the Flight School's lesson crash panel: Debrief, Try again from checkpoint,
 * Restart lesson). `keys` are KeyboardEvent.code values that trigger it while the dialog is open; the
 * primary action is the default button.
 */
export interface CrashAction {
  label: string;
  run(): void;
  primary?: boolean;
  keys?: string[];
}

export class CrashDialog {
  readonly root: HTMLDivElement;
  private readonly title: HTMLElement;
  private readonly reason: HTMLElement;
  private readonly row: HTMLElement;
  private readonly card: HTMLElement;
  private actions: CrashAction[] = [];

  constructor(parent: HTMLElement, private readonly defaults: CrashActions) {
    this.root = el('div', 'scrim hidden', parent);
    const card = (this.card = el('div', 'card crash', this.root));
    el('div', 'icon', card, '!');
    this.title = el('h2', '', card, 'Aircraft damaged');
    this.reason = el('p', '', card);
    this.row = el('div', 'actions', card);
  }

  get isOpen(): boolean {
    return !this.root.classList.contains('hidden');
  }

  /** The generic dialog: restart the scenario (Enter, R, Shift+R) or choose another. */
  open(reason: string, restartLabel: string): void {
    this.openWith(reason, [
      { label: restartLabel, run: () => this.defaults.restart(), primary: true, keys: ['Enter', 'NumpadEnter', 'KeyR'] },
      { label: 'Choose scenario…', run: () => this.defaults.chooseScenario() },
    ]);
  }

  /** The dialog with a custom action set (`title` replaces "Aircraft damaged"). */
  openWith(reason: string, actions: CrashAction[], title = 'Aircraft damaged'): void {
    this.title.textContent = title;
    this.reason.textContent = reason ? `${reason[0].toUpperCase()}${reason.slice(1)}.` : 'The aircraft has crashed.';
    this.actions = actions;
    // Three actions fit on one row in a wider card.
    this.card.style.width = actions.length > 2 ? 'min(560px, calc(100vw - 32px))' : '';
    this.row.replaceChildren();
    let primary: HTMLButtonElement | null = null;
    for (const a of actions) {
      const b = el('button', a.primary ? 'primary' : '', this.row, a.label);
      b.addEventListener('click', () => this.trigger(a));
      if (a.primary && !primary) primary = b;
    }
    this.root.classList.remove('hidden');
    // Enter / Space then trigger the default button; the UI also maps each action's keys.
    primary?.focus({ preventScroll: true });
  }

  /** Run the action bound to a key code; false when none is. */
  handleKey(code: string): boolean {
    const a = this.actions.find((x) => x.keys?.includes(code));
    if (!a) return false;
    this.trigger(a);
    return true;
  }

  /** The default (primary) action. */
  restart(): void {
    const a = this.actions.find((x) => x.primary) ?? this.actions[0];
    if (a) this.trigger(a);
  }

  /** Every action closes the dialog first, so a custom action never has to reach back for it. */
  private trigger(a: CrashAction): void {
    this.close();
    a.run();
  }

  close(): void {
    this.root.classList.add('hidden');
    if (this.root.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
  }
}

/** Frame-time readout from wall-clock intervals between frames (independent of pause / time scale). */
export class FpsMeter {
  private readonly root: HTMLDivElement;
  private last = 0;
  private acc = 0;
  private n = 0;
  private worst = 0;
  private windowStart = 0;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'fps hidden', parent);
  }

  /** Extra diagnostic line(s) shown under the frame time (e.g. the audio status). */
  private extraFn: (() => string) | null = null;

  set extra(fn: (() => string) | null) {
    this.extraFn = fn;
    this.root.style.whiteSpace = 'pre';
  }

  get extra(): (() => string) | null {
    return this.extraFn;
  }

  get visible(): boolean {
    return !this.root.classList.contains('hidden');
  }

  set visible(v: boolean) {
    this.root.classList.toggle('hidden', !v);
  }

  frame(now: number): void {
    if (this.last > 0) {
      const ms = now - this.last;
      this.acc += ms;
      this.n++;
      this.worst = Math.max(this.worst, ms);
    }
    this.last = now;
    if (!this.visible) return;
    if (now - this.windowStart >= 500 && this.n > 0) {
      const avg = this.acc / this.n;
      const extra = this.extra?.();
      this.root.textContent = `${(1000 / avg).toFixed(0).padStart(3)} fps  ${avg.toFixed(1).padStart(5)} ms  max ${this.worst.toFixed(1)}${extra ? `\n${extra}` : ''}`;
      this.acc = this.n = this.worst = 0;
      this.windowStart = now;
    }
  }
}

/** What the hints card says that depends on the type. */
export interface HintsAircraft {
  ui: Pick<UiProfile, 'controlName' | 'startupSteps' | 'hints'>;
  /** Rotation and best-rate climb speeds, KIAS (the take-off line). */
  vr: number;
  vy: number;
}

export const C172S_HINTS: HintsAircraft = { ui: C172S_UI, vr: C172S_REFERENCE.vr, vy: C172S_REFERENCE.vy };

/** The type-independent rows of the flying part (keys every type has); the type's own rows go before 'Views'. */
function flyingRows(h: HintsAircraft): [string, string][] {
  const rows: [string, string][] = [
    [h.ui.controlName === 'stick' ? 'Stick' : 'Yoke', '← → roll · ↑ nose down · ↓ nose up (stays where you leave it)'],
    ['Rudder', 'Z / X (stays where you leave it)'],
    ['Centre', `5 or Num 5: ${h.ui.controlName} and rudder to centre`],
    ['Throttle', 'F2 back · F3 forward · F1 idle · F4 full'],
    ['Flaps', 'F5 up · F6 down'],
    ['Trim', 'Home nose down · End nose up'],
    ['Brakes', 'B hold · Shift+B parking brake'],
  ];
  for (const [k, v] of h.ui.hints) rows.push([k, v]);
  rows.push(
    ['Views', 'C next camera · drag to look · wheel to zoom'],
    ['Panel', 'Click switches; scroll or click knobs'],
    ['Autopilot', 'A (once airborne)'],
    ['Pause / menu', 'P · Esc'],
  );
  return rows;
}

/** The take-off line: rotate at Vr, climb at Vy rounded to 5 kt. */
function takeoffText(h: HintsAircraft): string {
  const climb = Math.round(h.vy / 5) * 5;
  return `Take-off: release the parking brake (Shift+B), full throttle (F4), keep the centreline with the rudder (Z / X), at ${h.vr} kt hold ↓ until the nose starts to rise, then ease it with ↑ (or press 5) to climb at ${climb} kt.`;
}

/**
 * First-flight hints: a small non-modal card with the essentials. It never takes focus or keys (only its
 * buttons take clicks) and is remembered as dismissed in localStorage.
 */
export class HintsCard {
  readonly root: HTMLDivElement;
  /** v2: the flying keys changed (hold-position yoke, F5 / F6 flaps), so the card shows once more. */
  static readonly STORAGE_KEY = 'fs.ui.hintsDismissed.v2';
  private readonly startup: HTMLElement;
  private readonly startupGrid: HTMLElement;
  private readonly flyingGrid: HTMLElement;
  private readonly takeoff: HTMLElement;
  private readonly title: HTMLElement;
  private readonly flying: HTMLElement[] = [];
  private aircraft: HintsAircraft;
  /** The live parking-brake step (its text follows the brake's state). */
  private brakeStep: HTMLElement | null = null;
  private brakeSet: boolean | null = null;

  constructor(parent: HTMLElement, onMenu: () => void, aircraft: HintsAircraft = C172S_HINTS) {
    this.aircraft = aircraft;
    this.root = el('div', 'hints card hidden', parent);
    const head = el('div', 'hints-head', this.root);
    this.title = el('b', '', head, 'How to fly');
    const close = el('button', 'x', head, '×');
    close.title = 'Close';
    close.tabIndex = -1;
    close.addEventListener('click', () => this.dismiss());
    // Engine start, shown while the engine is not running (apron: cold and dark).
    this.startup = el('div', 'hints-startup hidden', this.root);
    el('div', 'hints-sub', this.startup, 'Engine start');
    this.startupGrid = el('div', 'hints-grid', this.startup);
    this.flyingGrid = el('div', 'hints-grid', this.root);
    this.flying.push(this.flyingGrid);
    this.takeoff = el('p', '', this.root);
    this.flying.push(this.takeoff);
    this.fill(aircraft);
    const row = el('div', 'hints-actions', this.root);
    const all = el('button', '', row, 'All controls…');
    all.tabIndex = -1;
    all.addEventListener('click', () => {
      this.dismiss();
      onMenu();
    });
    const ok = el('button', 'primary', row, 'Got it');
    ok.tabIndex = -1;
    ok.addEventListener('click', () => this.dismiss());
  }

  /** The type flown (its start-up steps, its own rows and its take-off speeds). */
  setAircraft(aircraft: HintsAircraft): void {
    const was = this.aircraft;
    if (aircraft.ui.startupSteps === was.ui.startupSteps && aircraft.ui.hints === was.ui.hints && aircraft.ui.controlName === was.ui.controlName && aircraft.vr === was.vr && aircraft.vy === was.vy) return;
    this.aircraft = aircraft;
    this.fill(aircraft);
  }

  private fill(h: HintsAircraft): void {
    const sgrid = this.startupGrid;
    sgrid.replaceChildren();
    this.brakeStep = null;
    this.brakeSet = null;
    h.ui.startupSteps.forEach(([k, v], i) => {
      el('span', '', sgrid, `${i + 1}. ${k}`);
      const span = el('span', '', sgrid, v);
      // The parking-brake check follows the brake's actual state (parkingBrake).
      if (k === 'Parking brake') this.brakeStep = span;
    });
    const grid = this.flyingGrid;
    grid.replaceChildren();
    for (const [k, v] of flyingRows(h)) {
      el('span', '', grid, k);
      el('span', '', grid, v);
    }
    this.takeoff.textContent = takeoffText(h);
  }

  get isOpen(): boolean {
    return !this.root.classList.contains('hidden');
  }

  /** Show unless dismissed before (force: always). */
  show(force = false): void {
    if (!force) {
      try {
        if (localStorage.getItem(HintsCard.STORAGE_KEY)) return;
      } catch {
        // Storage unavailable: show it.
      }
    }
    this.root.classList.remove('hidden');
  }

  hide(): void {
    this.root.classList.add('hidden');
  }

  /**
   * Engine-start mode (while the engine is not running): the start procedure replaces the flying keys, which
   * come back once the engine runs.
   */
  set startupVisible(on: boolean) {
    this.startup.classList.toggle('hidden', !on);
    for (const e of this.flying) e.classList.toggle('hidden', on);
    this.title.textContent = on ? 'Cold and dark: start the engine' : 'How to fly';
  }

  /** Show the parking-brake step for the brake's current state (cheap: only touches the DOM on change). */
  set parkingBrake(set: boolean) {
    if (set === this.brakeSet || !this.brakeStep) return;
    this.brakeSet = set;
    this.brakeStep.textContent = parkingBrakeStepText(set);
  }

  get startupVisible(): boolean {
    return !this.startup.classList.contains('hidden');
  }

  dismiss(): void {
    this.hide();
    try {
      localStorage.setItem(HintsCard.STORAGE_KEY, '1');
    } catch {
      // Private mode: it will show again next time.
    }
  }
}
