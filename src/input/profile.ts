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
  /**
   * Series authority of the pedal term's rate damping, +/- axis units; without `holdAuthority`, of the whole pedal term
   * (rate damping, heading hold and its integral together).
   */
  yawAuthority: number;
  /**
   * Series authority of the heading-hold part of the pedal term (the held heading's proportional and integral terms), and
   * of the whole pedal term, +/- axis units; the rate damping stays within `yawAuthority`. While the pilot works the
   * pedals the hold part is the integral alone, so a full-pedal turn meets the rate damping's authority only. Absent:
   * `yawAuthority` for everything.
   */
  holdAuthority?: number;
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
   * Not for a keyboard cyclic when `followUp` is set (the follow-up walks that stick to the trim instead).
   */
  datumRelaxKt?: number;
  /**
   * The assist also works on the ground once the skids carry less than this fraction of the weight (a lift-off, a skid
   * touching in a low hover), the cyclic datum kept through the touch. Absent: airborne only.
   */
  groundLoad?: number;
  /** Full gain below [0], none above [1], KIAS. */
  fadeKias: readonly [number, number];
  /**
   * Trim follow-up of the KEYBOARD controls (ControlInputs.keyboardCyclic / keyboardPedals; a mouse yoke or hardware axis
   * is the pilot's hand and is never moved): the series term, low-passed over `filterS`, beyond `deadBand` of its
   * authority, walks the keyboard stick and pedals toward it at `cyclicGain` / `pedalGain` per second of the excess,
   * capped at `cyclicRate` / `pedalRate` of the axis per second, so the term washes out and the keys rest at the trim.
   * The cyclic moves through the spring-trim anchor (the keyboard centre follows it, so 5 returns to the followed trim)
   * with the attitude datum moved along (the commanded attitude stays); the pedals through
   * ControlInputs.pedalFollowUp into the keyboard's pedal centre, only while no pedal key is held. For keyboard pedals the
   * follow-up replaces the heading hold's integral (it is the integral, with the pedal's whole travel). Absent: none.
   */
  followUp?: { filterS: number; deadBand: number; cyclicGain: number; cyclicRate: number; pedalGain: number; pedalRate: number };
  /**
   * Height hold on the KEYBOARD collective (ControlInputs.keyboardCollective; a hardware lever is the pilot's hand), at
   * hover and low speed: ADS-33E's rate command / height hold. The keys move the lever as before. Once they rest the
   * assist walks the lever to stop the climb or sink (a PI on the climb rate: `kv` of the travel per second per m/s of
   * climb-rate error and `kp` of the travel per m/s of its change, at most `rate` per second) and, once the climb rate is
   * under `captureMps`, holds that height (a climb-rate command of `kh` per m of height error, at most `vsMax`). While a
   * key is held the lever is damped by `kvHeld` and `kp` alone, so a held key is close to a climb-rate command. Full below
   * fadeKias[0], none above fadeKias[1]. Off on the ground (on light skids, groundLoad, it keeps working), with an
   * engine not running, one engine out or the needles split, and with NR under `minNrPct`; it never raises the lever
   * above the maximum continuous power nor lowers it below `floor` of the travel. Absent: the collective is the pilot's.
   */
  heightHold?: { fadeKias: readonly [number, number]; kv: number; kp: number; kvHeld: number; rate: number; captureMps: number;
    kh: number; vsMax: number; floor: number; minNrPct: number;
    /**
     * A bare collective key held AIRBORNE (not Shift+F5 / Shift+F6, ControlInputs.collectiveFastWorked) is a climb-rate
     * command: the key's own move of the lever is taken back and the hold walks the lever (the same PI, at most `rate`
     * per second) to `climbMps` up (F6) or `sinkMps` down (F5), the sink falling linearly to `landSinkMps` over the
     * `landBandM` above `landAglM` (the reference point's height above the ground; the Bo 105's sits about 1.4 m up on the
     * skids), so a held F5 lands softly. On the skids the keys move the lever as before. Absent: a held key only damped.
     */
    held?: { climbMps: number; sinkMps: number; landSinkMps: number; landAglM: number; landBandM: number; rate: number;
      /** While F6 is held above the maximum continuous power the lever is lowered at this rate, travel per second. */
      limitBackRate?: number;
      /**
       * The climb-rate command works at every speed (the keyboard collective's protection in cruise: a held F5 / F6 walks
       * the lever to the commanded rate, never into the power limit), not only inside the height hold's fadeKias; the
       * capture and the hold once the keys rest keep that fade; the limit back-off never takes the lever below where the
       * key found it (above the maximum continuous power in cruise a held F6 then holds the lever). Absent: the command
       * fades with the height hold.
       */
      everySpeed?: boolean };
    /**
     * One engine out (RotorcraftState.twinTurboshaft.oei; tune pass 2 fix), airborne on the keyboard collective, faded IN
     * over fadeKias (none below fadeKias[0], whole above fadeKias[1]): a held bare F5 / F6 stays the climb-rate command
     * (`held`), F6 stopped by the limits the survivor is judged on then (powerLimitExceeded from the OEI ratings) and never
     * backed off; whatever NR (a held F5 is how NR comes back). The hold at rest stays off and the lever stays where the
     * keys leave it; Shift+F5 / Shift+F6 stay raw, and so do the keys below the band (an OEI landing's cushion pulls past
     * the limits). Absent: with an engine out the collective is the pilot's.
     */
    oei?: boolean };
  /**
   * Collective-to-pedal crossfeed on the KEYBOARD pedals (with `followUp`, through its pedal channel), airborne: while no
   * pedal key is held, every change of the collective (the pilot's keys or lever, the height hold's walk) moves the
   * pedals by `perCollective` of the axis per unit of the collective (the trim slope), scaled by the speed fade, and that
   * pedal washes out with `washS` (a high-pass: the quick torque change is the crossfeed's, the slow trim the
   * follow-up's). A collective change made while a pedal key is held, or on the skids (a lift-off, where the pilot sets
   * the pedal first), is the pilot's to pedal. The washout goes on while a pedal key is held (the key moves the pedals
   * from where they are): this is load-bearing, freezing it or handing the crossfed pedal to the pilot at a key press
   * let it pile up through the keyboard deceleration (9 of 10 decelerations reached the hover against 3-4; W/tune/bo105
   * d_hh_g7 / g8). Absent: none.
   */
  pedalCrossfeed?: { perCollective: number; washS: number; onLightSkids?: boolean };
  /**
   * Translational rate command on the KEYBOARD cyclic (ControlInputs.keyboardCyclic; a mouse yoke or hardware stick is
   * the pilot's hand and keeps the attitude command): ADS-33E's TRC response type at hover and low speed. The attitude
   * datums get `degPerKt` of pitch up per kt of forward GROUND speed and of roll left per kt to the right (heading axes),
   * at most `limitDeg`, and while the keyboard stick has rested `restS` the datums themselves walk `trimDegPerSPerKt` per
   * second per kt the same way (the trim that holds zero ground speed: the pilot's last attitude command is washed out),
   * so a stick left anywhere comes back to a hover over the ground; that walk waits `restS` after a capture too (the
   * hover hold letting go) and is at most `trimMaxDegS` per second. Full below fadeKt[0] of ground speed, none above
   * fadeKt[1]. Absent: attitude command / attitude hold only.
   */
  /**
   * Cruise attitude hold on the KEYBOARD cyclic (with `followUp`): above the speed fade the cyclic terms (rate damping,
   * attitude hold, the keyboard stick's attitude command and its trim follow-up) keep this gain instead of fading out;
   * the pedal term and the height hold keep their own fades. Absent: everything fades out by fadeKias[1].
   */
  cruiseHold?: { gain: number;
    /**
     * A HAND-HELD cyclic too (ControlInputs.keyboardCyclic false: the mouse yoke, a hardware stick; tune pass 2 fix): the
     * cyclic terms keep `gain` at every speed, so the stick is attitude command / attitude hold in cruise as the keys are
     * (the hand holds the stick: no trim follow-up; the datum still tracks the trim while slowing, datumRelaxKt). Without
     * the input module's report (keyboardCyclic absent) nothing changes. Absent: a hand-held stick flies the raw aircraft
     * above the fade.
     */
    handHeld?: boolean };
  translationalRate?: { degPerKt: number; limitDeg: number; trimDegPerSPerKt: number; restS: number; trimMaxDegS?: number;
    fadeKt: readonly [number, number];
    /**
     * The rest is the arrow keys' (ControlInputs.cyclicWorked, set by the input module when this is set): the trim walk
     * waits `restS` after an arrow key was last held, whatever moves the stick meanwhile (a key held against the
     * keyboardLimit leaves the stick still but is the pilot's command; the limit's re-centring after the rest, or 5, is
     * not). Absent: the stick's movement.
     */
    keyRest?: boolean;
    /**
     * While the input module reports the keyboardLimit's landing condition (ControlInputs.cyclicLanding) the trim walk
     * waits only this (0: whenever no arrow key is held), so a pilot tapping the attitude while letting down cannot keep
     * a datum off the zero-ground-speed trim. Absent: restS always.
     */
    landingRestS?: number };
  /**
   * Keyboard cyclic limit at hover and low speed (tune pass 2; the input module applies it, src/input/InputSystem.ts):
   * with the STAB ASSIST on and the cyclic on the keys, below fadeKt[0] of ground speed the arrow keys cannot move the
   * keyboard stick more than `travel` of the axis from where it last rested (the trim the follow-up keeps; where the hover
   * hold or a reset left it), so a held key commands at most `travel` x stickAttitude of attitude and stays inside the
   * series authority; the limit opens linearly to the whole travel at fadeKt[1]. It only stops a key driving the stick
   * further out (a key back toward the rest moves as before). Absent: the keys reach the whole travel.
   */
  keyboardLimit?: { travel: number; fadeKt: readonly [number, number];
    /**
     * Once the arrow keys have rested `restS`, the keyboard stick glides back to where it last rested at `rate` of the
     * axis per second (faded out with the limit over fadeKt): the attitude the keys commanded is taken back and the TRC
     * stops the helicopter, and a key held to the limit and let go has the full limit again. `landing`: with the reference point under `aglM` above the
     * ground and a bare F5 held within the last `f5S` s (letting down), it waits only `restS` of its own (0: as soon as
     * no arrow key is held), so the attitude taps of a pilot letting down cannot add up to a slide.
     * Absent: the keyboard stick stays where the keys leave it.
     */
    recentre?: { rate: number; restS: number; landing?: { aglM: number; restS: number; f5S: number } };
    /**
     * At speed (tune pass 2 fix; needs `recentre`): the limit opens to `travel` of the axis by fadeKt[1] instead of the
     * whole travel, and above fadeKt[0], once the arrow keys have rested `restS`, the stick's position is the new rest (the
     * attitude hold keeps what the keys commanded), so one press, however long, moves the stick at most the limit, a held
     * key cannot take it past the series authority into the raw aircraft, and taps do not add up. Absent: the whole
     * travel.
     */
    cruise?: { travel: number; restS: number } };
  // ---- AH-56A tune round 3 (opt-in; absent = the law as before, so no other type's rows move).
  /**
   * Sideslip pedal follow-up on the KEYBOARD pedals (with `followUp`): airborne, while no pedal key is held, the keyboard pedal
   * centre walks toward zero sideslip at `gain` of the axis per second per rad of the sideslip (low-passed over `filterS`), at
   * most `rate` of the axis per second, weighted 0 -> 1 between kias[0] and kias[1] of FORWARD air speed (body x, kt: a sideways
   * drift is not a turn to coordinate), full to kias[2], none from kias[3]. It
   * runs above fadeKias[1] too (the pedal trim keeps moving with speed in the cruise), and adds to the heading hold's and the
   * rate damping's follow-up below it. Absent: none (above the heading hold's fade the keyboard pedal stays where the hover
   * left it).
   */
  sideslipPedal?: { kias: readonly [number, number, number, number]; gain: number; rate: number; filterS: number };
  /**
   * The cyclic datum is taken again where the aircraft is once a RE-CENTRING keyboard stick (InputProfile.centringCyclic) has
   * come back to rest for `quietS` after a key moved it: attitude hold at the attitude the pilot left (as the control gyro
   * itself does), instead of an attitude command back to the captured one. Absent: the captured datum stays.
   */
  recaptureOnCentre?: { quietS: number };
  /**
   * The cyclic datum is captured only fully airborne (no wheel or skid load) with the stick quiet for `quietS`; until then the
   * cyclic terms wait (the pedal term works as before, on light skids or wheels too). Absent: captured at the first active
   * step (light skids included).
   */
  captureAirborne?: { quietS: number };
  // ---- AH-56A tune round 4 (opt-in; absent = the law as before).
  /**
   * Heading hold on the KEYBOARD pedals on the wheels (with `followUp`): on the ground with the tail wheel locked
   * (ControlInputs.tailWheelLock) and no pedal key held, a series pedal term clamp(-kpsi (psi - psi0) - kr r, +/-authority),
   * weighted 0 -> 1 from gsKt[0] to gsKt[1] of ground speed, full to gsKt[2], none from gsKt[3]; psi0 is the heading at the
   * touchdown (or where a pedal key last let go). The keyboard pedal centre is walked by the term (low-passed over `filterS`) at
   * `gain` of the axis per second per unit of it, at most `rate`, so what it holds stays when it fades. Absent: none (on the
   * wheels the pedals are the pilot's).
   */
  groundRollHeading?: { gsKt: readonly [number, number, number, number]; kpsi: number; kr: number; authority: number; gain: number;
    rate: number; filterS: number };
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
  collectiveFastRate?: { down: number; up: number; downStop?: number;
    /** The raising key stops there (travel 0..1) and never takes the collective above it while every engine runs (an engine
     *  failure's cushion takes the whole travel); bare F6 goes on up. Absent: to the top. */
    upStop?: number;
    /** The lowering key acts as the bare key (F5: collectiveRate, and the STAB ASSIST's held-key sink command) while every
     *  engine runs below `minKias` of forward air speed (body x, kt): the hand-speed drop is the autorotation entry, for forward
     *  flight or an engine failure, not for the powered hover (the AH-56A's tune round 4: Shift+F5 for 1 s in the 15 m hover
     *  hit the ground at 2,640 fpm). Absent: always at hand speed. */
    downGate?: { minKias: number } };
  /** Keyboard re-centring rate (5 / Numpad 5), travel per second. Absent: virtualYoke CENTRE_RATE (4). */
  centreRate?: number;
  /**
   * Shift+5 / Shift+Numpad 5 set the keyboard's centre to where the stick is now (a sim convenience on a spring-trim type
   * whose real trim is a beep switch only); the physics' spring anchor is left alone. Absent: no such key.
   */
  setTrimHere?: boolean;
  /**
   * 5 / Numpad 5 glide the keyboard cyclic back to its centre and leave the keyboard pedals where they are (the pedal
   * trim the keys and the STAB ASSIST's follow-up set). Absent: 5 centres the pedals too.
   */
  centreKeepsPedals?: boolean;
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
     *  touches the grip, while every engine runs: lever position against indicated airspeed, kt (plain tables; AC fills them
     *  from the pusher's trim schedule). Absent: no assist. */
    schedule?: { kias: readonly number[]; lever: readonly number[];
      /** The assist starts ON for this type (tune round 3, the AH-56A's keyboard pilot: the P transition technique is the
       *  propeller). Absent: off, as before. */
      default?: boolean } };
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
  /** The keyboard pedals re-centre too: with no pedal key held they glide back (at the Numpad-5 rate) to the keyboard pedal
   *  centre, which the STAB ASSIST's follow-up walks to the trim (ControlInputs.pedalFollowUp). Absent: they stay where the keys
   *  left them. */
  centringPedals?: boolean;
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
