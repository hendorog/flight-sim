// Which key sets each checklist item (the C172S lists in src/training/aircraft/c172s.ts), so the lesson card
// and the strip can show it next to the challenge. Found in playtesting: the challenge-and-response lists give
// 10 s per item, and a new player who has to look up "master switch" in the briefing's key table misses it.
// Items with no control of their own (lookout, "propeller area clear", "flight controls free") are answered
// with Enter, which is what the card then shows.

import type { InputAction } from '../../input/bindings';
import { keyCaps } from './widgets';

/** Checklist item id -> the action that sets it (by the C172S checklist ids; unknown ids answer with Enter). */
const ITEM_ACTIONS: Readonly<Record<string, InputAction>> = {
  parkingBrake: 'parkingBrake',
  parkingBrakeOff: 'parkingBrake',
  brakes: 'parkingBrake',
  avionicsOff: 'avionics',
  avionicsOn: 'avionics',
  master: 'masterSwitch',
  masterOff: 'masterSwitch',
  ammeter: 'alternator',
  beacon: 'beacon',
  navLights: 'navLights',
  strobes: 'strobes',
  strobesOff: 'strobes',
  landingLight: 'landingLight',
  landingLightOff: 'landingLight',
  taxiLight: 'taxiLight',
  panelLights: 'panelLights',
  fuelSelector: 'fuelSelector',
  fuelSelectorTank: 'fuelSelector',
  fuelOff: 'fuelSelector',
  mixture: 'mixtureRich',
  mixtureCutoff: 'mixtureLean',
  engine: 'mixtureRich',
  fuelPump: 'fuelPump',
  fuelPumpPrime: 'fuelPump',
  throttleOpen: 'throttleUp',
  rpm: 'throttleUp',
  runupRpm: 'throttleUp',
  idle: 'throttleIdle',
  throttleIdle: 'throttleIdle',
  climbPower: 'throttleFull',
  start: 'starter',
  mags: 'magnetoBoth',
  magsOff: 'magnetoOff',
  flaps: 'flapsUp',
  flapsUp: 'flapsUp',
  flapsLanding: 'flapsDown',
  trim: 'trimNoseUp',
};

/**
 * The keys that answer a checklist item, as key-cap combos: its control's key and Enter (an item that is
 * already in the right state is confirmed with Enter, and pressing a switch's key would flip it the wrong
 * way: the card does not know the switch's state), or Enter alone for items with no control.
 */
export function checklistItemKeys(itemId: string): string[][] {
  const action = ITEM_ACTIONS[itemId];
  const caps = action ? keyCaps(action) : null;
  return caps ? [caps.keys[0], ['Enter']] : [['Enter']];
}

/** Tooltip for the key hint of a checklist item. */
export function checklistItemHint(itemId: string): string {
  const action = ITEM_ACTIONS[itemId];
  const caps = action ? keyCaps(action) : null;
  return caps
    ? `Set it with ${caps.keys[0].join('+')}; if it is already set, answer with Enter.`
    : 'Check it, then answer with Enter.';
}
