// Small DOM building blocks shared by the school screens: buttons with key hints, grade pips, badges,
// section titles and the key-cap rendering of the briefing's key list.

import { KEY_MAP, keyName, type InputAction } from '../../input/bindings';
import type { Grade, SchoolCommand } from '../../training/types';
import { el } from '../dom';
import { gradeName } from './format';
import type { SchoolCareer, SchoolScreen, SchoolUiDeps } from './models';

/** A rendered modal screen. `onKey` sees keys while it is open and returns true when it used one. */
export interface ScreenView {
  root: HTMLElement;
  onKey?(e: KeyboardEvent): boolean;
  dispose?(): void;
}

/** What a screen may use: the career, the services, and the ways out. */
export interface ScreenCtx {
  career: SchoolCareer;
  deps: SchoolUiDeps;
  send(cmd: SchoolCommand): void;
  go(screen: SchoolScreen): void;
  toast(text: string): void;
}

/** Plain-key test for screen shortcuts (no modifiers, no auto-repeat). */
export function bareKey(e: KeyboardEvent, ...codes: string[]): boolean {
  return !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && codes.includes(e.code);
}

/** True while the user types in a text field (screen shortcuts other than Enter / Esc then stand down). */
export function typing(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) && (t as HTMLInputElement).type !== 'checkbox';
}

/** A button; `key` shows a key-cap hint ("Enter", "Esc") inside it. */
export function button(parent: HTMLElement, text: string, onClick: () => void, opts: { cls?: string; key?: string; title?: string } = {}): HTMLButtonElement {
  const b = el('button', opts.cls ?? '', parent);
  el('span', '', b, text);
  if (opts.key) el('span', 'sc-kbd', b, opts.key);
  if (opts.title) b.title = opts.title;
  // Never keep focus on the school's buttons: the flight keys must keep working once the screen closes.
  b.tabIndex = -1;
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick();
  });
  return b;
}

export function badge(parent: HTMLElement, text: string, tone: '' | 'ok' | 'warn' | 'bad' | 'dim' = ''): HTMLElement {
  return el('span', `sc-badge ${tone}`.trim(), parent, text);
}

/** A grade pip ("3"), coloured by grade; `test` draws the outlined test-standard variant. */
export function gradePip(parent: HTMLElement, g: Grade | null, test = false): HTMLElement {
  const p = el('span', `sc-pip ${g === null ? 'none' : `g${g}`}${test ? ' test' : ''}`, parent, g === null ? '–' : String(g));
  p.title = `${test ? 'Test standard: ' : ''}${gradeName(g)}`;
  return p;
}

export function section(parent: HTMLElement, text: string): HTMLElement {
  return el('div', 'sc-section', parent, text);
}

/** The modal header: kicker, title, subtitle, and a slot on the right. */
export function header(parent: HTMLElement, title: string, sub?: string, kicker?: string): { root: HTMLElement; right: HTMLElement } {
  const root = el('div', 'sc-head', parent);
  const t = el('div', 'sc-titles', root);
  if (kicker) el('div', 'sc-kicker', t, kicker);
  el('h2', '', t, title);
  if (sub) el('p', 'sc-sub', t, sub);
  const right = el('div', 'sc-badges', root);
  return { root, right };
}

// ---- Key caps for the briefing (section 5.3: bindings.ts plus the training keys) ----------------------------

/** Training keys owned by TrainingSystem (section 5.9). */
const TRAINING_KEYS: Record<string, { label: string; keys: string[][] }> = {
  ack: { label: 'Acknowledge / I have control', keys: [['Enter']] },
  handback: { label: 'You have control (hand back)', keys: [['Shift', 'Enter']] },
  sayAgain: { label: 'Say again', keys: [['R']] },
  showMe: { label: 'Show me', keys: [['[']] },
  card: { label: 'Lesson card', keys: [['Tab']] },
  // The id lesson briefings use (content/validate.ts TRAINING_KEY_IDS); 'card' is the UI's own name.
  cycleCard: { label: 'Lesson card', keys: [['Tab']] },
  retryPhase: { label: 'Try this phase again', keys: [['Shift', 'R']] },
  pause: { label: 'Pause', keys: [['P']] },
  menu: { label: 'Menu', keys: [['Esc']] },
  autopilot: { label: 'Autopilot', keys: [['A']] },
};

/** Short labels for the flight actions a briefing lists (the help screen's labels are sentences). */
const ACTION_LABELS: Partial<Record<InputAction, string>> = {
  pitchUp: 'Nose up', pitchDown: 'Nose down', rollLeft: 'Roll left', rollRight: 'Roll right',
  rudderLeft: 'Rudder left', rudderRight: 'Rudder right', brakes: 'Brakes', parkingBrake: 'Parking brake',
  brakeLeft: 'Left brake', brakeRight: 'Right brake',
  throttleUp: 'Throttle up', throttleDown: 'Throttle down', throttleIdle: 'Throttle idle', throttleFull: 'Full throttle',
  flapsUp: 'Flaps up', flapsDown: 'Flaps down', trimNoseUp: 'Trim nose up', trimNoseDown: 'Trim nose down',
  mixtureLean: 'Mixture lean', mixtureRich: 'Mixture rich', starter: 'Starter', magnetoBoth: 'Magnetos both',
  magnetoLeft: 'Magneto left', magnetoRight: 'Magneto right', magnetoOff: 'Magnetos off',
  landingLight: 'Landing light', taxiLight: 'Taxi light', navLights: 'Nav lights', strobes: 'Strobes', beacon: 'Beacon',
  masterSwitch: 'Master', avionics: 'Avionics', fuelPump: 'Fuel pump', fuelSelector: 'Fuel selector',
  pitotHeat: 'Pitot heat', centreControls: 'Centre the controls', headingBugLeft: 'Heading bug left',
  headingBugRight: 'Heading bug right', kollsmanUp: 'Altimeter setting up', kollsmanDown: 'Altimeter setting down',
  dgAlign: 'Align the DG', cameraNext: 'Next view',
  rudderTrimLeft: 'Rudder trim left', rudderTrimRight: 'Rudder trim right',
  gearDown: 'Gear down', gearUp: 'Gear up', gearEmergency: 'Emergency gear extension',
  propDecrease: 'Propeller rpm down', propIncrease: 'Propeller rpm up', propFeather: 'Feather',
  carbHeat: 'Carburettor heat', cowlFlapsOpen: 'Cowl flaps open', cowlFlapsClose: 'Cowl flaps close',
  engineSelect1: 'Left engine', engineSelect2: 'Right engine', engineSelectAll: 'Both engines',
};

/** Label and key combos (each a list of caps) for a briefing key id, or null for an unknown id. */
export function keyCaps(id: string): { label: string; keys: string[][] } | null {
  const t = TRAINING_KEYS[id];
  if (t) return t;
  const maps = KEY_MAP.filter((m) => m.action === id);
  if (maps.length === 0) return null;
  // At most two alternatives keep the table compact (F3 / Page Up).
  const keys = maps.slice(0, 2).map((m) => (m.shift ? ['Shift', keyName(m.code)] : [keyName(m.code)]));
  const label = ACTION_LABELS[id as InputAction] ?? id.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
  return { label, keys };
}

/** Render key combos as <kbd> caps: "Shift + Enter / R". */
export function renderCaps(parent: HTMLElement, keys: string[][]): HTMLElement {
  const box = el('div', '', parent);
  keys.forEach((combo, i) => {
    if (i > 0) box.appendChild(document.createTextNode(' / '));
    combo.forEach((k) => el('kbd', '', box, k));
  });
  return box;
}
