// Game controller recognition and default mappings. Pure data + logic, no DOM.
//
// The Gamepad API only gives an id string and anonymous axes/buttons. Standard-mapping gamepads have a
// fixed layout; flight hardware does not, so we classify it from its id and apply a layout that matches
// the common devices of each kind (Logitech/Saitek, Thrustmaster, Honeycomb, CH). Every axis can then be
// reassigned and calibrated by the user; see GamepadManager.

import { defaultCalibration, type AxisCalibration } from './axisFilter';
import type { InputAction } from './bindings';

export type DeviceKind = 'gamepad' | 'joystick' | 'yoke' | 'pedals' | 'throttle';

/** A continuous control an axis can drive. `throttleRate` moves the throttle at a rate (self-centring sticks). */
export type AxisControl =
  | 'aileron'
  | 'elevator'
  | 'rudder'
  | 'collective'
  | 'throttle'
  | 'throttleRate'
  | 'mixture'
  | 'brakeLeft'
  | 'brakeRight'
  | 'brakes'
  | 'none';

export const AXIS_CONTROLS: readonly AxisControl[] = [
  'aileron',
  'elevator',
  'rudder',
  'collective',
  'throttle',
  'throttleRate',
  'mixture',
  'brakeLeft',
  'brakeRight',
  'brakes',
  'none',
];

/** Centring controls map to [-1, 1]; the rest are levers mapped to [0, 1]. */
export function isBipolar(control: AxisControl): boolean {
  return control === 'aileron' || control === 'elevator' || control === 'rudder' || control === 'throttleRate';
}

export interface AxisBinding {
  control: AxisControl;
  cal: AxisCalibration;
}

export interface DeviceProfile {
  kind: DeviceKind;
  axes: AxisBinding[];
  /** Analogue buttons used as axes (standard-gamepad triggers), button index -> control. */
  analogButtons: { button: number; control: AxisControl }[];
  /** Button index -> action (same actions as the keyboard). */
  buttons: Record<number, InputAction>;
}

export function classifyDevice(id: string, mapping: string): DeviceKind {
  const s = id.toLowerCase();
  if (/pedal|rudder|\btpr\b|\brpd\b/.test(s)) return 'pedals';
  if (/yoke|alpha flight/.test(s)) return 'yoke';
  if (/quadrant|bravo|tq\b/.test(s) || (/throttle/.test(s) && !/hotas|stick/.test(s))) return 'throttle';
  if (mapping === 'standard') return 'gamepad';
  return 'joystick';
}

const bind = (control: AxisControl, deadzone: number, curve: number, invert = false): AxisBinding => ({
  control,
  cal: defaultCalibration(deadzone, curve, invert),
});

/**
 * Default layout for a device of `kind` with `axisCount` axes. Lever axes are inverted because nearly all
 * flight hardware reports -1 with the lever fully forward; stick Y reports +1 when pulled back, which is
 * already + = nose up in ControlInputs.
 */
export function defaultProfile(kind: DeviceKind, axisCount: number): DeviceProfile {
  let axes: AxisBinding[];
  let analogButtons: DeviceProfile['analogButtons'] = [];
  let buttons: Record<number, InputAction> = {};
  switch (kind) {
    case 'gamepad':
      // Left stick flies, right stick X is rudder and right stick Y moves the throttle; triggers are toe brakes.
      axes = [bind('aileron', 0.1, 0.45), bind('elevator', 0.1, 0.45), bind('rudder', 0.12, 0.4), bind('throttleRate', 0.2, 0, true)];
      analogButtons = [
        { button: 6, control: 'brakeLeft' },
        { button: 7, control: 'brakeRight' },
      ];
      buttons = {
        0: 'brakes',
        1: 'parkingBrake',
        2: 'cameraNext',
        3: 'viewRecentre',
        4: 'flapsUp',
        5: 'flapsDown',
        8: 'starter',
        9: 'pause',
        12: 'trimNoseDown',
        13: 'trimNoseUp',
        14: 'zoomOut',
        15: 'zoomIn',
      };
      break;
    case 'joystick':
      axes = [bind('aileron', 0.03, 0.3), bind('elevator', 0.03, 0.3), bind('rudder', 0.06, 0.3), bind('throttle', 0.02, 0, true)];
      buttons = { 0: 'brakes', 1: 'cameraNext', 2: 'flapsUp', 3: 'flapsDown', 4: 'trimNoseDown', 5: 'trimNoseUp' };
      break;
    case 'yoke':
      axes = [bind('aileron', 0.02, 0.15), bind('elevator', 0.02, 0.15), bind('throttle', 0.02, 0, true), bind('none', 0, 0), bind('mixture', 0.02, 0, true)];
      buttons = { 0: 'brakes', 1: 'cameraNext', 2: 'trimNoseDown', 3: 'trimNoseUp', 4: 'flapsUp', 5: 'flapsDown' };
      break;
    case 'pedals':
      axes = [bind('brakeLeft', 0.03, 0), bind('brakeRight', 0.03, 0), bind('rudder', 0.02, 0.15)];
      break;
    case 'throttle':
      axes = [bind('throttle', 0.02, 0, true), bind('none', 0, 0), bind('mixture', 0.02, 0, true)];
      buttons = { 0: 'flapsUp', 1: 'flapsDown', 2: 'trimNoseDown', 3: 'trimNoseUp' };
      break;
  }
  while (axes.length < axisCount) axes.push(bind('none', 0, 0));
  return { kind, axes: axes.slice(0, Math.max(axisCount, 0)), analogButtons, buttons };
}
