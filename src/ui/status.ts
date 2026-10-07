// Cues visible in every view (the HUD is for external views only):
//  - Annunciators: PARKING BRAKE (turns red with the release key when the pilot opens the throttle against
//    it) and CRASHED with the restart key once the crash dialog is dismissed. Shown when the HUD is not.
//  - Control-position widget: yoke (aileron / elevator), rudder and elevator trim as commanded, shown while
//    the pilot flies with the keyboard (and fading a few seconds after the last flight key) or in mouse-yoke
//    mode, like X-Plane's control box. It tells a keyboard pilot what the yoke is doing and how much trim is
//    set, and suggests trimming when a pitch key is held for a long time in flight. On a twin the engine
//    levers are off the panel, so it also shows which engine the engine keys act on (L / R / BOTH) and one bar
//    per lever per engine, and it comes up while those keys are used; a type with rudder trim gets a mark on
//    the rudder track (WidgetAircraft, setAircraft).

import type { SimContext } from '../core/context';
import { engineControl, type AircraftState, type ControlInputs } from '../core/types';
import { keysForAction, type InputAction } from '../input/bindings';
import { trimLabel } from './cues';
import { el, setText } from './dom';
import { engineSelectionLabel } from './hudCues';

export type CueLevel = 'warn' | 'alert';

/** Throttle above which a set parking brake is surely a mistake (the pilot is trying to go). */
const THROTTLE_AGAINST_BRAKE = 0.5;

/** The parking-brake annunciation for the current controls, or null when it is released. */
export function parkingBrakeCue(c: ControlInputs, s: AircraftState): { text: string; level: CueLevel } | null {
  if (!c.parkingBrake) return null;
  if (c.throttle > THROTTLE_AGAINST_BRAKE && s.engine.running) return { text: 'PARKING BRAKE SET · Shift+B to release', level: 'alert' };
  return { text: 'PARKING BRAKE', level: 'warn' };
}

export const CRASHED_CUE = 'CRASHED · Shift+R to restart';

export class Annunciators {
  readonly root: HTMLDivElement;
  private readonly park: HTMLElement;
  private readonly crash: HTMLElement;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'annunc status-annunc', parent);
    this.park = el('div', 'chip warn hidden', this.root, 'PARKING BRAKE');
    this.crash = el('div', 'chip alert hidden', this.root, CRASHED_CUE);
  }

  set visible(v: boolean) {
    this.root.classList.toggle('hidden', !v);
  }

  update(ctx: SimContext, crashDialogOpen: boolean): void {
    applyParkingCue(this.park, parkingBrakeCue(ctx.controls, ctx.state));
    this.crash.classList.toggle('hidden', !ctx.state.crashed || crashDialogOpen);
  }
}

/** Show / restyle a parking-brake chip. */
export function applyParkingCue(chip: HTMLElement, cue: { text: string; level: CueLevel } | null): void {
  chip.classList.toggle('hidden', !cue);
  if (!cue) return;
  setText(chip, cue.text);
  chip.classList.toggle('warn', cue.level === 'warn');
  chip.classList.toggle('alert', cue.level === 'alert');
}

/** Keys that fly the aircraft (the input module's defaults for yoke, rudder and trim; unshifted). */
const FLIGHT_KEYS = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'KeyZ',
  'KeyX',
  'KeyQ',
  'KeyE',
  'Home',
  'End',
  'Numpad7',
  'Numpad1',
  'Numpad5',
  'Digit5',
]);
const PITCH_KEYS = new Set(['ArrowUp', 'ArrowDown']);

/** What the widget shows of the type flown beyond yoke, rudder and elevator trim. */
export interface WidgetAircraft {
  engines: number;
  /** Lever kinds with a lever per engine (shown on twins), in quadrant order. */
  levers: readonly ('throttle' | 'propeller' | 'mixture')[];
  rudderTrim: boolean;
}

/** The Cessna 172S: nothing beyond yoke, rudder and elevator trim. */
export const SINGLE_WIDGET: WidgetAircraft = { engines: 1, levers: ['throttle', 'mixture'], rudderTrim: false };

const LEVER_LABELS: Record<WidgetAircraft['levers'][number], string> = { throttle: 'THR', propeller: 'PROP', mixture: 'MIX' };

/** Keys (with or without Shift) that bring the widget up on a twin: the engine levers and the engine selection. */
const ENGINE_KEY_ACTIONS: readonly InputAction[] = [
  'throttleDown', 'throttleUp', 'throttleIdle', 'throttleFull', 'mixtureLean', 'mixtureRich', 'propDecrease', 'propIncrease',
  'propFeather', 'engineSelect1', 'engineSelect2', 'engineSelectAll',
];
const RUDDER_TRIM_ACTIONS: readonly InputAction[] = ['rudderTrimLeft', 'rudderTrimRight'];

/** Seconds the widget stays after the last flight key is released. */
const LINGER_S = 4;
/** The yoke held off centre (a pitch key held, or the hold-position keyboard yoke left back / forward) this long in flight suggests trimming. */
const TRIM_SUGGEST_S = 2.5;

/** What the widget needs from the input module (InputSystem.getYokeIndicator()). */
export interface YokeSource {
  mouseYoke: boolean;
  source: 'keyboard' | 'mouse' | 'hardware';
  /** The hold-position keyboard yoke or rudder is left off centre: keep the widget up so the pilot sees where. */
  keyboardOffCentre?: boolean;
  /** Keyboard elevator relative to its centre (+ = held back). */
  keyboardElevator?: number;
  /** Someone else is flying (the flight school's instructor): the trim suggestion is not the pilot's to act on. */
  othersFlying?: boolean;
}

export class ControlsWidget {
  readonly root: HTMLDivElement;
  private readonly dot: HTMLElement;
  private readonly rudder: HTMLElement;
  private readonly trim: HTMLElement;
  private readonly trimText: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly held = new Set<string>();
  private pitchHeldSince = -1;
  private lastKeyAt = -Infinity;
  private shown = false;
  /** Keys of the type that also bring the widget up, Shift allowed (twin engine keys, rudder trim). */
  private readonly typeKeys = new Set<string>();
  private rudderTrimMark: HTMLElement | null = null;
  private engineBlock: HTMLElement | null = null;
  private selection: HTMLElement | null = null;
  private engineBars: { kind: WidgetAircraft['levers'][number]; engine: number; bar: HTMLElement; fill: HTMLElement }[] = [];
  /** Optional input-module link: shows the widget in mouse-yoke mode. */
  yoke: (() => YokeSource) | null = null;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'ctlw', parent);
    const top = el('div', 'ctlw-top', this.root);
    const box = el('div', 'ctlw-yoke', top);
    this.dot = el('i', '', box);
    const trim = el('div', 'ctlw-trim', top);
    this.trim = el('i', '', trim);
    this.rudder = el('i', '', el('div', 'ctlw-rud', this.root));
    const t = el('div', 'ctlw-text num', this.root, 'TRIM ');
    this.trimText = el('b', '', t);
    this.hint = el('div', 'ctlw-hint hidden', this.root);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
  }

  get visible(): boolean {
    return this.shown;
  }

  /** The type flown: a twin gets the engine block, a type with rudder trim the mark on the rudder track. */
  setAircraft(a: WidgetAircraft): void {
    this.rudderTrimMark?.remove();
    this.rudderTrimMark = null;
    this.engineBlock?.remove();
    this.engineBlock = this.selection = null;
    this.engineBars = [];
    this.typeKeys.clear();
    const keysOf = (actions: readonly InputAction[]): void => {
      for (const action of actions) for (const k of keysForAction(action)) this.typeKeys.add(k.code);
    };
    if (a.rudderTrim) {
      this.rudderTrimMark = el('b', 'ctlw-rtrim', this.rudder.parentElement!);
      keysOf(RUDDER_TRIM_ACTIONS);
    }
    if (a.engines > 1) {
      keysOf(ENGINE_KEY_ACTIONS);
      const block = (this.engineBlock = el('div', 'ctlw-eng', this.root));
      this.root.insertBefore(block, this.hint);
      const sel = el('div', 'ctlw-sel num', block, 'ENG ');
      this.selection = el('b', '', sel);
      const quadrant = el('div', 'ctlw-quad', block);
      for (const kind of a.levers) {
        const group = el('div', 'ctlw-lever', quadrant);
        const pair = el('div', 'ctlw-pair', group);
        for (let i = 0; i < a.engines; i++) {
          const bar = el('div', `ctlw-vbar ${kind}`, pair);
          this.engineBars.push({ kind, engine: i, bar, fill: el('i', '', bar) });
        }
        el('span', '', group, LEVER_LABELS[kind]);
      }
    }
  }

  /** @param allowed false while a modal is open or the UI hides cues. */
  update(ctx: SimContext, allowed: boolean): void {
    const now = performance.now() / 1000;
    const y = this.yoke?.();
    const keyboard = this.held.size > 0 || now - this.lastKeyAt < LINGER_S || !!y?.keyboardOffCentre;
    const show = allowed && (keyboard || !!y?.mouseYoke);
    if (show !== this.shown) {
      this.shown = show;
      this.root.classList.toggle('on', show);
    }
    if (!show) return;
    const c = ctx.controls;
    // Yoke box: right = right roll, down = yoke back (as the pilot pulls toward himself).
    this.dot.style.transform = `translate(${(clamp1(c.aileron) * 26).toFixed(1)}px, ${(clamp1(c.elevator) * 26).toFixed(1)}px)`;
    this.rudder.style.left = `${(50 + clamp1(c.rudder) * 50).toFixed(1)}%`;
    // Trim wheel sense: nose-up trim is drawn above the neutral mark.
    this.trim.style.top = `${(50 - clamp1(c.elevatorTrim) * 50).toFixed(1)}%`;
    setText(this.trimText, trimLabel(c.elevatorTrim));
    if (this.rudderTrimMark) this.rudderTrimMark.style.left = `${(50 + clamp1(c.rudderTrim) * 50).toFixed(1)}%`;
    if (this.selection) {
      const sel = ctx.engineSelection;
      setText(this.selection, engineSelectionLabel(sel));
      for (const b of this.engineBars) {
        const v = Math.max(0, Math.min(1, engineControl(c, b.engine, b.kind)));
        b.fill.style.height = `${(v * 100).toFixed(1)}%`;
        b.bar.classList.toggle('dim', sel !== undefined && sel !== 'all' && sel !== b.engine);
      }
    }

    // The keyboard yoke holds position, so "holding" is either a pitch key held or the yoke left off centre.
    const pitchHeld = [...this.held].some((k) => PITCH_KEYS.has(k)) || Math.abs(y?.keyboardElevator ?? 0) > 0.04;
    const airborne = !ctx.state.wheels.some((w) => w.onGround);
    if (!pitchHeld || !airborne) this.pitchHeldSince = -1;
    else if (this.pitchHeldSince < 0) this.pitchHeldSince = now;
    const suggest = this.pitchHeldSince >= 0 && now - this.pitchHeldSince > TRIM_SUGGEST_S && Math.abs(c.elevator) > 0.04 && !y?.othersFlying;
    this.hint.classList.toggle('hidden', !suggest);
    if (suggest) setText(this.hint, c.elevator > 0 ? 'Yoke held back: trim nose up (End)' : 'Yoke held forward: trim nose down (Home)');
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.shiftKey || !FLIGHT_KEYS.has(e.code)) {
      if (!this.typeKeys.has(e.code)) return;
    }
    this.held.add(e.code);
    this.lastKeyAt = performance.now() / 1000;
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    if (this.held.delete(e.code)) this.lastKeyAt = performance.now() / 1000;
  };

  private readonly onBlur = (): void => {
    this.held.clear();
  };
}

const clamp1 = (v: number): number => Math.max(-1, Math.min(1, v));
