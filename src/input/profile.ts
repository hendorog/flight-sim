// The input description of one aircraft type: which levers and switches exist, the flap detents, the fuel
// selector cycle and the tuning of the keyboard assists. Plain data.

import type { EngineControlKey, FuelSelector } from '../core/types';
import type { KeyAxisTuning } from './virtualYoke';
import type { InputAction } from './bindings';

export interface KeyboardAssistTuning {
  axes: { aileron: KeyAxisTuning; elevator: KeyAxisTuning; rudder: KeyAxisTuning };
  groundElevatorRate: number;
  rotation: { rate: number; rateLead: number; pitchLimitGround: number; pitchLimitAir: number; pitchLead: number; bleed: number };
  /**
   * Ground-steering assist: PID on heading to the rudder, or to differential brake below rudderEffectiveSpeed
   * (m/s IAS) blending to rudder (law in 3.6). pedalBrakeGain: below rudderEffectiveSpeed a keyboard rudder
   * deflection beyond half travel also applies the same-side toe brake, up to this value (default 0.5), so the
   * rudder keys steer a castering type on the ground like every other type.
   *
   * As built (virtualYoke.ts): the PID output always goes to the rudder; with 'differentialBrake' the brakes get
   * output x brakeGain (default 1) x (1 - (IAS / rudderEffectiveSpeed)^2) as well (rudderEffectiveSpeed
   * default 15), and the pedal brake fades out with the same factor.
   */
  steering: { kind: 'rudder' | 'differentialBrake'; kp: number; ki: number; kd: number; limit: number;
              fadeInSpeed: readonly [number, number]; rudderEffectiveSpeed?: number; brakeGain?: number; pedalBrakeGain?: number };
  rollTrim: { ki: number; kb: number; limit: number };
  gStops: { pull: number; push: number };
  handoverSpeed: number;
}

export interface InputProfile {
  engines: 1 | 2;
  /** Flap lever values of the detents, ascending from 0. */
  flapDetents: readonly number[];
  /** Fuel selector positions the selector key cycles through (per selected engine on twins). */
  fuelSelectorCycle: readonly FuelSelector[];
  /** 'engineMaster': the magneto keys act on ENGINE MASTER (Digit1 = off, Digit4 = on); Digit2 / Digit3 do nothing. */
  ignition: 'key' | 'toggles' | 'engineMaster';
  has: { mixture: boolean; propeller: boolean; feather: boolean; carbHeat: boolean; alternateAir: boolean; cowlFlaps: boolean;
         gear: boolean; rudderTrim: boolean; fuelPump: boolean };
  /**
   * Per-engine keys that are ONE control on this type: they write the scalar whatever the engine selection
   * (DA42: ['alternateAir'], one lever for both engines). Absent: none.
   */
  commonControls?: readonly EngineControlKey[];
  /**
   * Twins: `assists.axes.rudder.fullAuthoritySpeed >= Vmca` (m/s) and `authorityExponent <= 1`, so the keyboard
   * rudder keeps more authority (Vfull / V) than an engine-out needs ((Vmca / V)^2) at every speed above Vmca.
   * Asserted by the generic per-type test.
   */
  assists: KeyboardAssistTuning;
  /** Help-listing label overrides ('Stick back (nose up)', 'Power lever forward'). */
  labels?: Partial<Record<InputAction, string>>;
}
