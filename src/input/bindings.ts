// Keyboard bindings, kept as data so the help screen and the input system share one source of truth.
//
// Keys are KeyboardEvent.code values (physical key positions, independent of keyboard layout).
// `shift: true` binds only Shift+key, `shift: false` only the bare key, and an omitted `shift` matches
// both (continuous controls keep working if Shift happens to be held). The arrows are the exception:
// Shift+arrow looks around, so the yoke arrows are bound to the bare keys. A key keeps the action it had
// when it went down, so releasing Shift mid-press does not switch a held yoke key to a look key.
//
// Keys owned by other modules and deliberately left unbound here: Escape, F8, F9 (UI); P (pause), A
// (autopilot), T / Shift+T (autopilot altitude), H (dome light), Shift+R (restart), Shift+[ / Shift+] (time
// rate) (the shell, src/sim/Simulator.ts); F11 and the bare F are kept free (Shift+F feathers), and so is the
// bare ] key (the flaps moved to F5 / F6).
// Owned by the Flight School during a lesson (src/training/TrainingSystem.ts, spec section 5.9; TRAINING_KEY_MAP
// below): Enter (acknowledge / "I have control"), Shift+Enter (hand control back), bare R (say again), bare [
// (show me), Tab (lesson card) and Shift+R (try the phase again; the scenario restart outside a lesson).
// Space stays reserved for radio push-to-talk (step 3).
// Pause is also on the Pause/Break key (and the gamepad Start button); see InputSystem.
//
// There is ONE key map for every aircraft type (lesson validation and the Controls tab depend on it). A key
// whose lever or switch a type does not have does nothing there and is left out of its help listing
// (profileHasAction, keyBindingsFor). On a twin the engine keys act on the engine(s) chosen with 8 / 9 / 0.

import { C172S_INPUT } from '../aircraft/c172s/input';
import type { InputProfile } from './profile';

/** Every discrete or continuous action the input system can perform, from a key or a gamepad button. */
export type InputAction =
  | 'rotorClutch' | 'rotorGovernor'
  | 'pitchUp' // yoke back (nose up)
  | 'pitchDown'
  | 'rollLeft'
  | 'rollRight'
  | 'rudderLeft'
  | 'rudderRight'
  | 'brakeLeft'
  | 'brakeRight'
  | 'brakes'
  | 'parkingBrake'
  | 'throttleDown'
  | 'throttleUp'
  | 'throttleIdle'
  | 'throttleFull'
  | 'flapsUp'
  | 'flapsDown'
  | 'trimNoseDown'
  | 'trimNoseUp'
  | 'rudderTrimLeft'
  | 'rudderTrimRight'
  | 'gearDown'
  | 'gearUp'
  | 'gearEmergency'
  | 'mixtureLean'
  | 'mixtureRich'
  | 'propDecrease'
  | 'propIncrease'
  | 'propFeather'
  | 'carbHeat'
  | 'cowlFlapsOpen'
  | 'cowlFlapsClose'
  | 'engineSelect1'
  | 'engineSelect2'
  | 'engineSelectAll'
  | 'starter'
  | 'magnetoOff'
  | 'magnetoRight'
  | 'magnetoLeft'
  | 'magnetoBoth'
  | 'landingLight'
  | 'taxiLight'
  | 'navLights'
  | 'strobes'
  | 'beacon'
  | 'masterSwitch'
  | 'alternator'
  | 'avionics'
  | 'fuelPump'
  | 'fuelSelector'
  | 'pitotHeat'
  | 'panelLights'
  | 'headingBugRight'
  | 'headingBugLeft'
  | 'kollsmanUp'
  | 'kollsmanDown'
  | 'obsUp'
  | 'obsDown'
  | 'dgAlign'
  | 'mouseYoke'
  | 'centreControls'
  | 'cameraNext'
  | 'cameraPrev'
  | 'viewRecentre'
  | 'zoomIn'
  | 'zoomOut'
  | 'mouseLook'
  | 'lookLeft'
  | 'lookRight'
  | 'lookUp'
  | 'lookDown'
  | 'pause';

export interface KeyMapping {
  code: string;
  shift?: boolean;
  action: InputAction;
}

/** Physical key -> action. Order matters only for the help listing (first key of an action is shown first). */
export const KEY_MAP: readonly KeyMapping[] = [
  { code: 'ArrowDown', shift: false, action: 'pitchUp' },
  { code: 'ArrowUp', shift: false, action: 'pitchDown' },
  { code: 'ArrowLeft', shift: false, action: 'rollLeft' },
  { code: 'ArrowRight', shift: false, action: 'rollRight' },
  { code: 'KeyZ', action: 'rudderLeft' },
  { code: 'KeyQ', action: 'rudderLeft' },
  { code: 'KeyX', action: 'rudderRight' },
  { code: 'KeyE', action: 'rudderRight' },
  { code: 'Comma', action: 'brakeLeft' },
  { code: 'Period', action: 'brakeRight' },
  { code: 'KeyB', shift: false, action: 'brakes' },
  { code: 'KeyB', shift: true, action: 'parkingBrake' },
  { code: 'F2', action: 'throttleDown' },
  { code: 'PageDown', action: 'throttleDown' },
  { code: 'F3', action: 'throttleUp' },
  { code: 'PageUp', action: 'throttleUp' },
  { code: 'F1', action: 'throttleIdle' },
  { code: 'F4', action: 'throttleFull' },
  { code: 'Numpad5', action: 'centreControls' },
  { code: 'Digit5', action: 'centreControls' },
  { code: 'Insert', action: 'rotorClutch' },
  { code: 'Delete', action: 'rotorGovernor' },
  { code: 'F5', action: 'flapsUp' },
  { code: 'F6', action: 'flapsDown' },
  // Explicit lever positions, not a toggle: a slip from F6 on final can only select the gear DOWN.
  { code: 'F7', shift: false, action: 'gearDown' },
  { code: 'F7', shift: true, action: 'gearUp' },
  { code: 'F10', action: 'gearEmergency' },
  { code: 'Home', action: 'trimNoseDown' },
  { code: 'Numpad7', action: 'trimNoseDown' },
  { code: 'End', action: 'trimNoseUp' },
  { code: 'Numpad1', action: 'trimNoseUp' },
  { code: 'Digit6', action: 'rudderTrimLeft' },
  { code: 'Digit7', action: 'rudderTrimRight' },
  { code: 'KeyM', shift: false, action: 'mixtureLean' },
  { code: 'KeyM', shift: true, action: 'mixtureRich' },
  { code: 'Semicolon', shift: false, action: 'propDecrease' },
  { code: 'Semicolon', shift: true, action: 'propIncrease' },
  { code: 'KeyF', shift: true, action: 'propFeather' },
  { code: 'Slash', action: 'carbHeat' },
  { code: 'Backslash', shift: false, action: 'cowlFlapsOpen' },
  { code: 'Backslash', shift: true, action: 'cowlFlapsClose' },
  { code: 'Digit8', action: 'engineSelect1' },
  { code: 'Digit9', action: 'engineSelect2' },
  { code: 'Digit0', action: 'engineSelectAll' },
  { code: 'KeyS', action: 'starter' },
  { code: 'Digit1', action: 'magnetoOff' },
  { code: 'Digit2', action: 'magnetoRight' },
  { code: 'Digit3', action: 'magnetoLeft' },
  { code: 'Digit4', action: 'magnetoBoth' },
  { code: 'KeyL', shift: false, action: 'landingLight' },
  { code: 'KeyL', shift: true, action: 'taxiLight' },
  { code: 'KeyN', action: 'navLights' },
  { code: 'KeyO', shift: false, action: 'strobes' },
  { code: 'KeyO', shift: true, action: 'beacon' },
  { code: 'KeyW', shift: false, action: 'masterSwitch' },
  { code: 'KeyW', shift: true, action: 'alternator' },
  { code: 'KeyI', shift: false, action: 'avionics' },
  { code: 'KeyI', shift: true, action: 'pitotHeat' },
  { code: 'KeyJ', shift: false, action: 'fuelPump' },
  { code: 'KeyJ', shift: true, action: 'fuelSelector' },
  { code: 'Quote', action: 'panelLights' },
  { code: 'KeyG', shift: false, action: 'headingBugRight' },
  { code: 'KeyG', shift: true, action: 'headingBugLeft' },
  { code: 'KeyK', shift: false, action: 'kollsmanUp' },
  { code: 'KeyK', shift: true, action: 'kollsmanDown' },
  { code: 'KeyU', shift: false, action: 'obsUp' },
  { code: 'KeyU', shift: true, action: 'obsDown' },
  { code: 'KeyD', action: 'dgAlign' },
  { code: 'KeyY', action: 'mouseYoke' },
  { code: 'KeyC', shift: false, action: 'cameraNext' },
  { code: 'KeyC', shift: true, action: 'cameraPrev' },
  { code: 'KeyV', action: 'viewRecentre' },
  { code: 'Backspace', action: 'viewRecentre' },
  { code: 'Equal', action: 'zoomIn' },
  { code: 'NumpadAdd', action: 'zoomIn' },
  { code: 'Minus', action: 'zoomOut' },
  { code: 'NumpadSubtract', action: 'zoomOut' },
  { code: 'Backquote', action: 'mouseLook' },
  { code: 'ArrowLeft', shift: true, action: 'lookLeft' },
  { code: 'ArrowRight', shift: true, action: 'lookRight' },
  { code: 'ArrowUp', shift: true, action: 'lookUp' },
  { code: 'ArrowDown', shift: true, action: 'lookDown' },
  { code: 'Numpad4', action: 'lookLeft' },
  { code: 'Numpad6', action: 'lookRight' },
  { code: 'Numpad8', action: 'lookUp' },
  { code: 'Numpad2', action: 'lookDown' },
  { code: 'Pause', action: 'pause' },
];

interface ActionInfo {
  label: string;
  category: string;
}

const ACTION_INFO: Record<InputAction, ActionInfo> = {
  pitchUp: { label: 'Yoke back (nose up); stays where you leave it', category: 'Flight controls' },
  pitchDown: { label: 'Yoke forward (nose down); stays where you leave it', category: 'Flight controls' },
  rollLeft: { label: 'Roll left; stays where you leave it', category: 'Flight controls' },
  rollRight: { label: 'Roll right; stays where you leave it', category: 'Flight controls' },
  rudderLeft: { label: 'Left rudder; stays where you leave it', category: 'Flight controls' },
  rudderRight: { label: 'Right rudder; stays where you leave it', category: 'Flight controls' },
  centreControls: { label: 'Centre aileron, elevator and rudder', category: 'Flight controls' },
  trimNoseDown: { label: 'Elevator trim nose down', category: 'Flight controls' },
  trimNoseUp: { label: 'Elevator trim nose up', category: 'Flight controls' },
  rudderTrimLeft: { label: 'Rudder trim nose left (hold)', category: 'Flight controls' },
  rudderTrimRight: { label: 'Rudder trim nose right (hold)', category: 'Flight controls' },
  gearDown: { label: 'Landing gear lever DOWN', category: 'Flight controls' },
  gearUp: { label: 'Landing gear lever UP', category: 'Flight controls' },
  gearEmergency: { label: 'Emergency gear extension (pull the knob)', category: 'Flight controls' },
  rotorClutch: { label: 'Rotor clutch engage / disengage', category: 'Engine' },
  rotorGovernor: { label: 'Rotor governor on / off', category: 'Engine' },
  flapsUp: { label: 'Flaps up one notch', category: 'Flight controls' },
  flapsDown: { label: 'Flaps down one notch', category: 'Flight controls' },
  mouseYoke: { label: 'Toggle mouse yoke', category: 'Flight controls' },
  masterSwitch: { label: 'Master switch (BAT + ALT) on/off', category: 'Switches' },
  alternator: { label: 'Alternator (ALT half of the master) on/off', category: 'Switches' },
  avionics: { label: 'Avionics master on/off', category: 'Switches' },
  pitotHeat: { label: 'Pitot heat on/off', category: 'Switches' },
  fuelPump: { label: 'Auxiliary fuel pump on/off', category: 'Switches' },
  fuelSelector: { label: 'Fuel selector: BOTH, LEFT, RIGHT, OFF', category: 'Switches' },
  panelLights: { label: 'Panel lights: off, dim, medium, bright', category: 'Lights' },
  headingBugRight: { label: 'Heading bug right (hold to turn faster)', category: 'Instruments' },
  headingBugLeft: { label: 'Heading bug left', category: 'Instruments' },
  kollsmanUp: { label: 'Altimeter setting up (1 hPa)', category: 'Instruments' },
  kollsmanDown: { label: 'Altimeter setting down', category: 'Instruments' },
  obsUp: { label: 'NAV1 OBS course up', category: 'Instruments' },
  obsDown: { label: 'NAV1 OBS course down', category: 'Instruments' },
  dgAlign: { label: 'Align heading indicator with the compass (hold)', category: 'Instruments' },
  brakeLeft: { label: 'Left toe brake (hold)', category: 'Brakes' },
  brakeRight: { label: 'Right toe brake (hold)', category: 'Brakes' },
  brakes: { label: 'Both brakes (hold)', category: 'Brakes' },
  parkingBrake: { label: 'Parking brake on/off', category: 'Brakes' },
  throttleDown: { label: 'Throttle back', category: 'Engine' },
  throttleUp: { label: 'Throttle forward', category: 'Engine' },
  throttleIdle: { label: 'Throttle idle', category: 'Engine' },
  throttleFull: { label: 'Throttle full', category: 'Engine' },
  mixtureLean: { label: 'Mixture lean', category: 'Engine' },
  mixtureRich: { label: 'Mixture rich', category: 'Engine' },
  propDecrease: { label: 'Propeller lever back (lower rpm), as far as the feather gate', category: 'Engine' },
  propIncrease: { label: 'Propeller lever forward (higher rpm); out of feather', category: 'Engine' },
  propFeather: { label: 'Feather the propeller of the selected engine', category: 'Engine' },
  carbHeat: { label: 'Carburettor heat cold / hot', category: 'Engine' },
  cowlFlapsOpen: { label: 'Cowl flaps open one step', category: 'Engine' },
  cowlFlapsClose: { label: 'Cowl flaps close one step', category: 'Engine' },
  engineSelect1: { label: 'Engine keys act on the LEFT engine', category: 'Engine' },
  engineSelect2: { label: 'Engine keys act on the RIGHT engine', category: 'Engine' },
  engineSelectAll: { label: 'Engine keys act on both engines', category: 'Engine' },
  starter: { label: 'Starter (hold)', category: 'Engine' },
  magnetoOff: { label: 'Magnetos OFF', category: 'Engine' },
  magnetoRight: { label: 'Magnetos R', category: 'Engine' },
  magnetoLeft: { label: 'Magnetos L', category: 'Engine' },
  magnetoBoth: { label: 'Magnetos BOTH', category: 'Engine' },
  landingLight: { label: 'Landing light', category: 'Lights' },
  taxiLight: { label: 'Taxi light', category: 'Lights' },
  navLights: { label: 'Navigation lights', category: 'Lights' },
  strobes: { label: 'Strobe lights', category: 'Lights' },
  beacon: { label: 'Beacon', category: 'Lights' },
  cameraNext: { label: 'Next camera', category: 'View' },
  cameraPrev: { label: 'Previous camera', category: 'View' },
  viewRecentre: { label: 'Recentre view', category: 'View' },
  zoomIn: { label: 'Zoom in', category: 'View' },
  zoomOut: { label: 'Zoom out', category: 'View' },
  mouseLook: { label: 'Toggle captured mouse-look', category: 'View' },
  lookLeft: { label: 'Look left (hold)', category: 'View' },
  lookRight: { label: 'Look right (hold)', category: 'View' },
  lookUp: { label: 'Look up (hold)', category: 'View' },
  lookDown: { label: 'Look down (hold)', category: 'View' },
  pause: { label: 'Pause', category: 'Simulation' },
};

const KEY_NAMES: Record<string, string> = {
  ArrowDown: '↓',
  ArrowUp: '↑',
  ArrowLeft: '←',
  ArrowRight: '→',
  Comma: ',',
  Period: '.',
  BracketLeft: '[',
  BracketRight: ']',
  Equal: '=',
  Minus: '-',
  Backquote: '`',
  Quote: "'",
  Semicolon: ';',
  Slash: '/',
  Backslash: '\\',
  NumpadAdd: 'Num +',
  NumpadSubtract: 'Num -',
  PageUp: 'Page Up',
  PageDown: 'Page Down',
};

/** Human-readable name of a KeyboardEvent.code. */
export function keyName(code: string): string {
  if (KEY_NAMES[code]) return KEY_NAMES[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
  return code;
}

/** Actions that exist only on a type with the lever or switch they move (InputProfile.has). */
const ACTION_NEEDS: Partial<Record<InputAction, keyof InputProfile['has']>> = {
  mixtureLean: 'mixture',
  mixtureRich: 'mixture',
  fuelPump: 'fuelPump',
  propDecrease: 'propeller',
  propIncrease: 'propeller',
  propFeather: 'feather',
  cowlFlapsOpen: 'cowlFlaps',
  cowlFlapsClose: 'cowlFlaps',
  gearDown: 'gear',
  gearUp: 'gear',
  gearEmergency: 'gear',
  rudderTrimLeft: 'rudderTrim',
  rudderTrimRight: 'rudderTrim',
};

/**
 * The type has something for the action to act on (KEY_MAP is the same for every type). The input system
 * ignores the keys of an action a type lacks, and the help listing leaves them out.
 */
export function profileHasAction(profile: InputProfile, action: InputAction): boolean {
  if (action === 'rotorClutch' || action === 'rotorGovernor') return !!profile.rotorcraft;
  if (profile.rotorcraft && ['trimNoseUp', 'trimNoseDown', 'parkingBrake', 'brakes', 'brakeLeft', 'brakeRight'].includes(action)) return false;
  // ENGINE MASTER switches have no single-magneto positions.
  if (profile.ignition === 'engineMaster' && (action === 'magnetoRight' || action === 'magnetoLeft')) return false;
  // One key for the induction heat of the type: carburettor heat, or alternate air where there is no carburettor.
  if (action === 'carbHeat') return profile.has.carbHeat || profile.has.alternateAir;
  if (action === 'engineSelect1' || action === 'engineSelect2' || action === 'engineSelectAll') return profile.engines > 1;
  const needs = ACTION_NEEDS[action];
  return needs === undefined || profile.has[needs];
}

/** The standard text of an action on a type (before InputProfile.labels). */
function actionLabel(profile: InputProfile, action: InputAction): string {
  if (action === 'carbHeat' && !profile.has.carbHeat) return 'Alternate air off / on';
  return ACTION_INFO[action].label;
}

/**
 * Help-screen listing of one aircraft type: one row per action with every key bound to it, grouped by
 * category. Actions the type has nothing for are left out, and InputProfile.labels replaces the standard texts.
 */
export function keyBindingsFor(profile: InputProfile): { keys: string; action: string; category: string }[] {
  const byAction = new Map<InputAction, string[]>();
  for (const m of KEY_MAP) {
    if (!profileHasAction(profile, m.action)) continue;
    const name = (m.shift ? 'Shift+' : '') + keyName(m.code);
    const list = byAction.get(m.action);
    if (list) list.push(name);
    else byAction.set(m.action, [name]);
  }
  const rows = [...byAction].map(([action, keys]) => ({
    keys: keys.join(' / '),
    action: profile.labels?.[action] ?? actionLabel(profile, action),
    category: ACTION_INFO[action].category,
  }));
  rows.push(
    { keys: 'Drag', action: 'Look around / rotate view', category: 'View' },
    { keys: 'Drag', action: 'Orbit the aircraft (orbit camera)', category: 'View' },
    { keys: 'Mouse wheel', action: 'Zoom / camera distance', category: 'View' },
    { keys: 'Middle click', action: 'Recentre view', category: 'View' },
  );
  const order = ['Flight controls', 'Brakes', 'Engine', 'Switches', 'Lights', 'Instruments', 'View', 'Simulation'];
  return rows.sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category));
}

/** The help-screen listing of the Cessna 172S. */
export const KEY_BINDINGS: { keys: string; action: string; category: string }[] = keyBindingsFor(C172S_INPUT);

/** Look up the action for a key event; exact Shift matches win over shift-agnostic bindings. */
export function actionForKey(code: string, shift: boolean): InputAction | null {
  let loose: InputAction | null = null;
  for (const m of KEY_MAP) {
    if (m.code !== code) continue;
    if (m.shift === shift) return m.action;
    if (m.shift === undefined) loose = m.action;
  }
  return loose;
}

/** The keys bound to an action, first binding first (`shift`: Shift must be held). */
export function keysForAction(action: InputAction): { code: string; shift: boolean }[] {
  return KEY_MAP.filter((m) => m.action === action).map((m) => ({ code: m.code, shift: m.shift === true }));
}

/** The first key of an action as a label ("I", "Shift+O", "F3"), or null when it has no key. */
export function keyLabelForAction(action: InputAction): string | null {
  const k = keysForAction(action)[0];
  return k ? (k.shift ? 'Shift+' : '') + keyName(k.code) : null;
}

/** Every action (the input system works out from it which ones a type lacks). */
export const INPUT_ACTIONS = Object.keys(ACTION_INFO) as readonly InputAction[];

/** True for a known action id (lesson data names keys by action id). */
export function isInputAction(id: string): id is InputAction {
  return KEY_MAP.some((m) => m.action === id);
}

// ---- Flight School keys (owned by TrainingSystem while a lesson runs; spec section 5.9) --------------------

/** Training key ids, as lesson briefings list them (src/training/content/validate.ts TRAINING_KEY_IDS). */
export type TrainingKeyId = 'ack' | 'handback' | 'sayAgain' | 'showMe' | 'cycleCard' | 'retryPhase';

export interface TrainingKeyMapping {
  id: TrainingKeyId;
  /** KeyboardEvent.code values (any of them). */
  codes: readonly string[];
  /** Shift must be held (true) or must not be (false). */
  shift: boolean;
  label: string;
}

/** Physical keys of the training commands. Outside a lesson none of them does anything (Shift+R restarts). */
export const TRAINING_KEY_MAP: readonly TrainingKeyMapping[] = [
  { id: 'ack', codes: ['Enter', 'NumpadEnter'], shift: false, label: 'Acknowledge; "I have control" when offered; confirm a checklist item' },
  { id: 'handback', codes: ['Enter', 'NumpadEnter'], shift: true, label: '"You have control": hand control to the instructor' },
  { id: 'sayAgain', codes: ['KeyR'], shift: false, label: 'Say again' },
  { id: 'showMe', codes: ['BracketLeft'], shift: false, label: 'Show me (a demonstration)' },
  { id: 'cycleCard', codes: ['Tab'], shift: false, label: 'Lesson card: compact, expanded, hidden' },
  { id: 'retryPhase', codes: ['KeyR'], shift: true, label: 'Try again from the start of this phase' },
];

/** The training command for a key press, or null (the caller checks that a lesson is running). */
export function trainingKeyFor(code: string, shift: boolean): TrainingKeyId | null {
  return TRAINING_KEY_MAP.find((k) => k.shift === shift && k.codes.includes(code))?.id ?? null;
}

/** Controls-tab rows for the training keys (same shape as KEY_BINDINGS). */
export const TRAINING_KEYS: { keys: string; action: string; category: string }[] = TRAINING_KEY_MAP.map((k) => ({
  keys: (k.shift ? 'Shift+' : '') + keyName(k.codes[0]),
  action: `${k.label} (during a lesson)`,
  category: 'Flight School',
}));
