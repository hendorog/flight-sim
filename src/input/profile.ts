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

/**
 * STAB ASSIST tuning (a laptop sim aid, not a modelled aircraft system; src/sim/rotorcraft/stabilityAssist.ts has the
 * law). Gains in units of the -1..1 control axis: per rad/s for the rates, per rad for the attitude error.
 */
export interface StabilityAssistTuning {
  /** On when the type loads (Shift+A toggles it for the session; the URL's stab=0 / stab=1 overrides it). */
  default: boolean;
  /** Roll, pitch and yaw rate gains. */
  kp: number; kq: number; kr: number;
  /** Attitude-error gain (roll and pitch). */
  katt: number;
  /** The datum's attitude per unit of stick moved from where it was captured (attitude command), rad. */
  stickAttitude: number;
  /** Series authority of the cyclic terms, +/- axis units (0.2 = 10 % of the full travel). */
  authority: number;
  /** Series authority of the pedal term (rate damping, heading hold and its integral together), +/- axis units. */
  yawAuthority: number;
  /**
   * Heading hold (rate command / direction hold): the heading captured when the pilot's pedal rests is held with this
   * gain, axis units per rad of heading error, and `kpsiI` per rad s of its integral (airborne only). Absent: the pedal
   * term damps the yaw rate only.
   */
  kpsi?: number;
  kpsiI?: number;
  /**
   * The cyclic datum relaxes toward the flown attitude by one e-fold per this much fall of the (low-passed) airspeed while
   * the pilot is flying the cyclic, kt: a deceleration to the hover arrives at the hover trim. Absent: no such tracking.
   */
  datumRelaxKt?: number;
  /** The pedal term also works on the ground once the skids carry less than this fraction of the weight. Absent: no. */
  groundYawLoad?: number;
  /** Full gain below [0], none above [1], KIAS. */
  fadeKias: readonly [number, number];
}

export interface InputProfile {
  /** Mouse response: cubic blend (0 = linear, 1 = cubic) and dead zone as fractions of travel. */
  mouseYoke?: { expo: number; deadzone: number };
  /** Helicopter cyclic/pedals: no fixed-wing keyboard stabilisation; F5/F6 drive collective. */
  rotorcraft?: boolean;
  /** False hides the governor binding on manual-throttle helicopters. */
  rotorGovernor?: boolean;
  threePositionClutch?: boolean;
  springTrim?: boolean;
  /** Keyboard collective travel per second. Hardware axes remain absolute position inputs. */
  collectiveRate?: number;
  /**
   * A second, hand-rate pair of collective keys (Shift+F5 lower, Shift+F6 raise), travel per second while held: for the
   * autorotation entry, where the fine F5 / F6 rate is too slow. Absent: no such keys (Shift+F5 / F6 stay the fine
   * pair). `downStop`: the lowering key stops there (the autorotation entry position, travel 0..1) and never takes the
   * collective below it, held or pressed again; bare F5 goes on to the floor. Absent: the lowering key runs to the floor.
   */
  collectiveFastRate?: { down: number; up: number; downStop?: number };
  /** Keyboard re-centring rate (5 / Numpad 5), travel per second. Absent: virtualYoke CENTRE_RATE (4). */
  centreRate?: number;
  /**
   * Shift+5 / Shift+Numpad 5 set the keyboard's centre to where the stick is now (a sim convenience on a spring-trim type
   * whose real trim is a beep switch only); the physics' spring anchor is left alone. Absent: no such key.
   */
  setTrimHere?: boolean;
  /** STAB ASSIST (a sim aid; Shift+A toggles it). Absent: none, and the key does nothing. */
  stabilityAssist?: StabilityAssistTuning;
  engines: 1 | 2;
  /** Flap lever values of the detents, ascending from 0. */
  flapDetents: readonly number[];
  /** Fuel selector positions the selector key cycles through (per selected engine on twins). */
  fuelSelectorCycle: readonly FuelSelector[];
  /** Key's clockwise hold primes; starter is a separate button. J holds PRIME on this installation. */
  primeKey?: boolean;
  /** 'engineMaster': the magneto keys act on ENGINE MASTER (Digit1 = off, Digit4 = on); Digit2 / Digit3 do nothing. */
  ignition: 'key' | 'toggles' | 'engineMaster';
  has: { mixture: boolean; propeller: boolean; feather: boolean; carbHeat: boolean; alternateAir: boolean; cowlFlaps: boolean;
         gear: boolean; rudderTrim: boolean; fuelPump: boolean;
         /** Power lever aft of the gate into beta and reverse (ControlInputs.reverse): Shift+F2 / Shift+Page Down (InputSystem). Absent = false. */
         reverse?: boolean };
  /**
   * Twist-grip turboshaft (MD 500E): ControlInputs.throttle is the grip. F1 stops at `groundIdle`; CUTOFF (below
   * `cutoffBelow`) needs the idle release. Deep-equals RotorcraftDefinition.systems.turboshaft.grip. Absent: a
   * throttle lever. Shift+F1 is CUTOFF; F1 / F3 / F4 bring the grip out of it (InputSystem).
   */
  twistGrip?: { cutoffBelow: number; groundIdle: number };
  /**
   * Turboprop condition lever with three detents on ControlInputs.mixture: CUT-OFF (0), the low idle at `groundIdle`
   * (PC-12 GROUND IDLE, C208 LOW IDLE: turbineEngine CUTOFF_BELOW) and the high idle at 1 (FLIGHT IDLE / HIGH IDLE).
   * The mixture keys step between the detents, a press each (InputSystem): back from above the low idle stops on it,
   * forward goes to the next detent up. From the low idle to CUT-OFF the lean key has to be pressed afresh there and
   * held for CONDITION_CUTOFF_HOLD s, so a tap or a held key on the roll-out cannot shut the engine down. A
   * hardware mixture axis still sets the lever directly. Absent: the mixture keys move the lever continuously.
   */
  conditionDetents?: { groundIdle: number };
  /** Governor beep switch on the collective: the propDecrease / propIncrease keys drive ControlInputs.n2Beep while held. */
  n2Beep?: boolean;
  // ---- Hingeless / rigid-rotor programme (plan revision 2, section 5). Declared at S0; TW implements them (it owns
  // src/input/**). Absent: today's behaviour.
  /** Twin turboshaft levers: 'overheadPowerLevers' (Bo 105: two levers OFF - IDLE - FLIGHT on the per-engine
   *  ControlInputs.engines[i].throttle with the twistGrip stops; the engine-select keys move the selected lever). */
  engineLever?: 'twistGrip' | 'overheadPowerLevers';
  /** ENGINE TRIM left/right keys drive ControlInputs.n2BeepSplit while held (Bo 105). */
  n2BeepSplit?: boolean;
  /** Pusher twist grip (AH-56A): the propeller increase/decrease keys move ControlInputs.propLever (the Nf beep, when
   *  `n2Beep` is also set, moves to a shifted pair); `snaps` are lever positions for the snap keys (hover detent
   *  -2.2 deg, autorotation +8 deg, full reverse -12 deg), `detent` the hover detent. */
  propLever?: { detent: number; snaps: readonly number[];
    /** The trim schedule the optional laptop assist (InputAssists.propSchedule, off by default) follows until the pilot
     *  touches the grip: lever position against indicated airspeed, kt (plain tables; AC fills them from the pusher's
     *  trim schedule). Absent: no assist. */
    schedule?: { kias: readonly number[]; lever: readonly number[] } };
  /** Tail-wheel lock toggle key (ControlInputs.tailWheelLock). */
  tailWheelLock?: boolean;
  /** Gear lever keys on a rotorcraft with retractable wheels. */
  gearLever?: boolean;
  /** Toe brakes and the parking brake on a WHEELED rotorcraft: the brake actions are not hidden for this profile
   *  (bindings.ts hides them for every rotorcraft today). */
  wheelBrakes?: boolean;
  /** Keyboard cyclic re-centres to the spring-trim anchor (at the Numpad-5 recentring rate) when no cyclic key is held,
   *  and the mouse yoke has a small deadzone: a rate-command control gyro (AH-56A AMCS) holds attitude at stick centre. */
  centringCyclic?: boolean;
  /** Stick pusher interrupt button on the control wheel (Shift+D, held): ControlInputs.pusherInterrupt. Absent: none. */
  pusherInterrupt?: boolean;
  /**
   * STARTER INTERRUPT switch (Shift+N, held) of a latching start switch (EngineDef.starterLatch). It writes
   * ControlInputs.starterInterrupt, which cancels the latch in the turbine core (a second press of the starter
   * does too). Absent: none.
   */
  starterInterrupt?: boolean;
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
