// STAB ASSIST: a laptop sim aid for an unaugmented hingeless helicopter at hover and low speed. It is NOT a modelled
// aircraft system: the Bo 105 CB-4 flies without a SAS (P5 FM 7-24; the optional IFR-kit SAS, FMS 11-2, is not
// modelled). Plan bofly F1 (W/bofly/fix-plan.md); the gains are the hands-off probe's (W/bofly/probes sas2.log); the
// heading hold, the speed-tracking datum and the yaw term on unloading skids are round 2's (W/bofly/r2); the trim
// follow-up of the keyboard controls, the heading hold's own authority, the cyclic on light skids and the pilot-only
// heading lead are round 3's (W/bofly/pilot-r3).
//
// Why: the real Bo 105 hover is unstable (ERF 1995 VII-7, P: 45 deg of roll about 14 s after a lateral input; the
// flight-identified hover phugoid doubles in about 2-4 s) and the sim matches it (doubling 2.3 s). ADS-33E-PRF Fig 7
// puts that at Level 3, and 3.3.2.3 names an attitude-hold response type as the way to meet the hover requirement. A
// first-time pilot on a keyboard sits where the delayed test pilot loses the raw hover (W/probes/pilot-bo2). The
// physics stays as sourced; this term only adds to the controls (and walks the keyboard controls, below).
//
// The law (series, controls only), each physics step:
//   da = fade x clamp(-kp p - katt (roll - roll0), +/-authority)
//   de = fade x clamp(-kq q - katt (pitch - pitch0), +/-authority)
//   dr = fade x clamp(clamp(-kr r, +/-yawAuthority) + clamp(-h (kpsi (psi - psi0) + I), +/-holdAuthority), +/-holdAuthority)
//        I = kpsiI x integral of (psi - psi0) dt (hardware pedals; without holdAuthority: one clamp, yawAuthority)
// added to the pilot's aileron / elevator / rudder (the -1..1 axes; authority 0.2 = 10 % of travel) for the flight
// model's step only: after() puts the pilot's controls back, so the input module, the cockpit stick, the control box
// and a snapshot never see the series term (a real series actuator does not move the stick either).
// The cyclic datum is attitude-command / attitude-hold (ADS-33E's ACAH response type): roll0 = rollRef + K (aileron -
// aileronRef), pitch0 likewise, where (rollRef, aileronRef) is the attitude and stick captured together when the assist
// becomes active (a reset, lift-off, the hover hold letting go, the toggle, slowing below fadeKias[1]). Hands off this
// is the probe's attitude retention; a stick held off the captured position commands an attitude (K rad per unit of the
// axis) and the assist holds it. Beyond the series authority the raw aircraft answers (full stick = the raw aircraft).
// The datum tracks the trim through a deceleration for a stick the pilot's hand holds (mouse, joystick): the trim stick
// moves with speed far more than the trim attitude does (0 -> 30 KIAS: 0.26 of the axis forward against 0.8 deg of
// pitch, W/bofly/probes-assess), so a pair captured at one speed commands the wrong attitude at another and the series
// term sits on a bias (7 % of travel in the hover after a capture at 30 KIAS). So while the low-passed airspeed (body
// axes, horizontal) falls and the pilot has moved the cyclic within STICK_ACTIVE_S, the datum relaxes toward the flown
// attitude by one e-fold per datumRelaxKt of slowing. Hands off nothing relaxes (the raw hover diverges), and only
// slowing counts. A keyboard stick does not move itself to the trim, and relaxing there let the roll go with the flown
// roll through the deceleration (the round-2 gate); with followUp the keyboard stick is walked to the trim instead and
// its datum holds.
// Speed fade: full gain below fadeKias[0], none above fadeKias[1]; in between the datum also relaxes toward the flown
// attitude (RELAX_S). For a hand-held stick: attitude, not position (drift is the pilot's, or the hover hold's, A); a
// keyboard cyclic gets the translational rate command and the cruise attitude hold below.
// The pedal term is rate command / direction hold (ADS-33E's RCDH): while the pilot works the pedal (a pedal key held or
// a hardware pedal in use, ControlInputs.pedalWorked, or the pedal moving) the heading datum follows the heading and
// only the rate is damped; PEDAL_REST_S after that stops (the keyboard pedal stays where the keys left it) the heading
// is captured and held through collective changes (torque) and gusts. The captured heading leads by the coasting turn
// (HOLD_LEAD_S) only when the nose turns the way the pilot's pedal last moved: a torque swing the pilot is tapping
// against is stopped where it is, not led on. The rate damping keeps yawAuthority (a full pedal still turns at 90
// deg/s); the hold has holdAuthority (a 0.6 s collective tap needs about 0.26 of the pedal axis). The hold fades out over
// HOLD_FADE_KT up to fadeKias[0] (above that a bank is a turn); the rate damping stays to fadeKias[1].
// Trim follow-up (followUp; keyboard controls only, ControlInputs.keyboardCyclic / keyboardPedals): the keyboard stick and
// pedals stay where the keys leave them, so a lift-off, a deceleration or a collective change leaves them off the new
// trim with the series term at its limit (the round-2 gate: the stick at the 45 KIAS trim, 0.18, in the hover, whose
// trim is 0.51). The series term, low-passed, walks them toward the trim: the cyclic through the spring-trim anchor
// (the input module's keyboard centre follows the anchor, so the stick moves and 5 returns to the followed trim) with
// the stick reference moved along, so the commanded attitude stays and the attitude error is integrated out; the pedals
// through ControlInputs.pedalFollowUp into the keyboard's pedal centre, from the unclamped rate damping and hold terms
// (no integral: the follow-up is the integral, with the pedal's whole travel), while no pedal key is held, so it keeps
// trimming between the beginner's pedal taps. A mouse yoke or hardware axis is the pilot's hand and is never moved.
// Cruise attitude hold (cruiseHold; keyboard cyclic only, tune round 2): above the speed fade the cyclic terms keep the
// cruise gain instead of fading out, so the keys stay attitude command / attitude hold through cruise (the round-1 gate:
// by hand above 50 KIAS the raw aircraft departed on a careless collective or cyclic input); the pedal term and the
// height hold keep their fades. A mouse yoke or hardware stick flies the raw aircraft above the fade, as before.
// Translational rate command (translationalRate; keyboard cyclic only, tune round 2): the attitude datums lean against
// the ground velocity (heading axes) and, once the keyboard stick has rested restS (and restS after a capture), walk to
// the zero-ground-speed trim, so a stick left anywhere at hover and low speed comes back to a hover over the ground
// (ADS-33E's TRC; the attitude hold alone kept a decelerating or knocked attitude and slid away: the round-1 gate's
// let-go crash). A mouse yoke or hardware stick keeps the attitude command.
// Height hold (heightHold): a keyboard collective at rest holds the height; a bare F5 / F6 held airborne is a climb-rate
// command (heightHold.held: the key's move taken back, the lever walked to the commanded rate, the sink slowing near the
// ground, stopped and backed off at the power limit); Shift+F5 / Shift+F6 stay the pilot's.
// The collective-to-pedal crossfeed also works on light skids unless a pedal key was worked on the skids
// (pedalCrossfeed.onLightSkids: the untouched lift-off's yaw).
// AH-56A tune round 3, all opt-in (absent: the law above exactly): sideslipPedal walks the keyboard pedals toward zero sideslip
// in its own speed band, above fadeKias[1] too (the round-2 gate's "one gate": above 25 KIAS the keyboard pedal stayed at the
// hover's, 15-40 kt of sideslip); recaptureOnCentre takes the cyclic datum again where a re-centring keyboard stick
// (InputProfile.centringCyclic) comes back to rest; captureAirborne captures it only fully airborne with the stick quiet.
// AH-56A tune round 4, opt-in: groundRollHeading holds the touchdown heading on the keyboard pedals on the wheels (tail wheel
// locked, in a ground-speed band): the run-on's roll-out swung 120-145 deg with the tail rotor as the collective came down.
// Off on the ground (but working once the skids carry less than groundLoad of the weight, the cyclic datum kept through
// a skid touch in a low hover, the heading held from before lift-off), when crashed, and while the hover hold or an
// instructor flies (the caller's `active`).

import { DEG, G0, KT, clamp } from '../../core/math';
import type { AircraftState, ControlInputs } from '../../core/types';
import type { StabilityAssistTuning } from '../../input/profile';

/** In the fade band the datum relaxes toward the flown attitude with this time constant at zero gain, s. */
const RELAX_S = 2;
/** The pilot's pedal counts as moving when it leaves where it rested by more than this, axis units. */
const PEDAL_EPS = 0.004;
/** The heading is captured this long after the pedal stopped moving, s. */
const PEDAL_REST_S = 0.25;
/** Low-pass time constant of the air velocity the datum tracking reads, s. */
const AIR_FILTER_S = 2;
/** The pilot's cyclic counts as moving when it leaves where it rested by more than this, axis units. */
const STICK_EPS = 0.002;
/** The datum tracks the airspeed only while the pilot has moved the cyclic within this time, s (hands off it holds). */
const STICK_ACTIVE_S = 2;
/**
 * The heading captured when the pedal comes to rest leads the heading by the yaw rate times this, s: about where the
 * yaw would coast to under the assist's rate damping (hover Nr -0.54 1/s plus kr 0.3 x N_ped 2.1: about -1.2 1/s), so a
 * pedal tap's turn is kept rather than pulled back.
 */
const HOLD_LEAD_S = 0.8;
/**
 * The heading hold is full below fadeKias[0] minus this and gone at fadeKias[0], kt: above that a bank is a turn, and a
 * hold on the pedals would fight it with sideslip (the rate damping stays to fadeKias[1], as before).
 */
const HOLD_FADE_KT = 10;
/** A heading error beyond this drags the heading datum along (a held pedal overpowering the hold), rad. */
const HOLD_SLIP = Math.PI / 4;

/** A stick quiet this long counts as quiet since the capture (Infinity in the assist; JSON has none), s. */
const STICK_QUIET_MAX = 1e6;

/** The height hold's modes, by index in a snapshot. */
const HEIGHT_MODES = ['off', 'damp', 'hold'] as const;

/** The assist's state in a snapshot (StabilityAssist.exportState): numbers and flags by name. */
export type StabilityAssistSnapshot = Record<string, number | boolean>;

const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

/** Fraction of the weight the skids (or wheels) carry. */
function groundLoadFraction(s: AircraftState): number {
  const w = s.wheels, weight = s.mass * G0;
  return weight > 0 ? (w[0].load + w[1].load + w[2].load) / weight : 1;
}

/** Follow-up speed, axis units per second: `gain` x (|x| beyond `deadBand` of `authority`), capped at `rate`. */
function followSpeed(x: number, authority: number, deadBand: number, gain: number, rate: number): number {
  const excess = Math.abs(x) - deadBand * authority;
  return excess > 0 ? Math.sign(x) * Math.min(rate, gain * excess) : 0;
}

export class StabilityAssist {
  /**
   * The series command of the last step (axis units), the speed-fade gain applied (the pedal term's) and the cyclic
   * terms' gain (the fade, or the cruise attitude hold's on a keyboard cyclic); all 0 while inactive.
   */
  readonly output = { aileron: 0, elevator: 0, rudder: 0, gain: 0, cyclicGain: 0 };
  /**
   * How far the trim follow-up has moved the keyboard aileron, elevator and pedals since the assist was built, axis units;
   * and the height hold the keyboard collective, travel.
   */
  readonly followed = { aileron: 0, elevator: 0, rudder: 0, collective: 0 };
  /** The height hold's state: off, stopping the climb or sink ('damp'), or holding `heightRef` ('hold'). */
  heightMode: 'off' | 'damp' | 'hold' = 'off';
  /** The heading datum is held (the pedal at rest) rather than following the heading (the pedal being worked). */
  holdingHeading = false;
  private captured = false;
  private rollRef = 0;
  private pitchRef = 0;
  private aileronRef = 0;
  private elevatorRef = 0;
  private airU = 0;
  private airV = 0;
  private stickRestA = 0;
  private stickRestE = 0;
  private stickQuietFor = Infinity;
  /** Time since the cyclic datum was captured, s (the TRC's trim walk waits restS after a capture too). */
  private sinceCapture = 0;
  private yawActive = false;
  private headingRef = 0;
  private pedalRest = 0;
  private pedalRestFor = 0;
  /** The direction the pilot's pedal last moved (+1 right, -1 left, 0 not yet). */
  private pedalDir = 0;
  private yawI = 0;
  /** The follow-up's low-passed series terms. */
  private lpA = 0;
  private lpE = 0;
  private lpR = 0;
  /** The pedal follow-up of this step, applied in after(). */
  private pedalStep = 0;
  /** The height hold's datum, m MSL. */
  private heightRef = 0;
  /** The pedal the height hold's crossfeed holds now (washed out), axis units. */
  private xfeed = 0;
  private collWas = NaN;
  /** The collective as this hold left it (the keys' move is measured from it), travel; NaN: not known. */
  private collLeft = NaN;
  /** The direction of the collective key held (+1 F6, -1 F5, 0 none or not yet seen). */
  private keyDir = 0;
  /** A pedal key was worked since the skids last left the ground (the crossfeed then leaves the lift-off to the pilot). */
  private pedalOnSkids = false;
  /** The climb rate of the last step (the height hold's proportional term reads its change), m/s. */
  private climbWas = NaN;
  private applied = false;
  private readonly pilot = { aileron: 0, elevator: 0, rudder: 0 };
  // AH-56A tune round 3 (the opt-in sideslipPedal / recaptureOnCentre / captureAirborne; unused without them).
  /** The low-passed sideslip the sideslip pedal follow-up reads, rad. */
  private lpBeta = 0;
  /** A keyboard cyclic key moved the stick since the datum was last taken (recaptureOnCentre). */
  private stickMoved = false;
  /** The stick and how long it has rested fully airborne before the capture (captureAirborne), axis units and s. */
  private airRestA = 0;
  private airRestE = 0;
  private airQuietFor = 0;
  // AH-56A tune round 4 (the opt-in groundRollHeading; unused without it).
  /** The ground-roll heading hold has a datum (on the wheels since the touchdown), its heading (rad) and its low-passed term. */
  private rollEngaged = false;
  private rollHeadingRef = 0;
  private lpRoll = 0;

  constructor(readonly tuning: StabilityAssistTuning) {}

  /**
   * The datums, filters and follow-up totals for a snapshot (src/sim/resume.ts), so a restored flight goes on with the
   * same series term instead of capturing a new datum (a step in the controls at the restore).
   */
  exportState(): StabilityAssistSnapshot {
    return {
      captured: this.captured, rollRef: this.rollRef, pitchRef: this.pitchRef, aileronRef: this.aileronRef, elevatorRef: this.elevatorRef,
      airU: this.airU, airV: this.airV, stickRestA: this.stickRestA, stickRestE: this.stickRestE,
      // JSON has no Infinity (a stick at rest since the capture).
      stickQuietFor: Math.min(this.stickQuietFor, STICK_QUIET_MAX), sinceCapture: Math.min(this.sinceCapture, STICK_QUIET_MAX),
      yawActive: this.yawActive, holdingHeading: this.holdingHeading, headingRef: this.headingRef, pedalRest: this.pedalRest,
      pedalRestFor: this.pedalRestFor, pedalDir: this.pedalDir, yawI: this.yawI, lpA: this.lpA, lpE: this.lpE, lpR: this.lpR,
      followedAileron: this.followed.aileron, followedElevator: this.followed.elevator, followedRudder: this.followed.rudder,
      followedCollective: this.followed.collective,
      heightMode: HEIGHT_MODES.indexOf(this.heightMode), heightRef: this.heightRef,
      ...(Number.isFinite(this.climbWas) ? { climbWas: this.climbWas } : {}), xfeed: this.xfeed,
      ...(Number.isFinite(this.collWas) ? { collWas: this.collWas } : {}),
      ...(Number.isFinite(this.collLeft) ? { collLeft: this.collLeft } : {}), keyDir: this.keyDir, pedalOnSkids: this.pedalOnSkids,
      // The opt-in round-3 states, only for a type that has them (the other types' snapshots are as before).
      ...(this.tuning.sideslipPedal ? { lpBeta: this.lpBeta } : {}),
      ...(this.tuning.recaptureOnCentre ? { stickMoved: this.stickMoved } : {}),
      ...(this.tuning.captureAirborne ? { airRestA: this.airRestA, airRestE: this.airRestE, airQuietFor: Math.min(this.airQuietFor, STICK_QUIET_MAX) } : {}),
      ...(this.tuning.groundRollHeading ? { rollEngaged: this.rollEngaged, rollHeadingRef: this.rollHeadingRef, lpRoll: this.lpRoll } : {}),
    };
  }

  /** Go on from a snapshot's state (exportState); a field missing or of the wrong kind keeps reset()'s value. */
  importState(v: StabilityAssistSnapshot): void {
    this.reset();
    const num = (k: string, d: number): number => (typeof v[k] === 'number' && Number.isFinite(v[k]) ? v[k] as number : d);
    const flag = (k: string): boolean => v[k] === true;
    this.captured = flag('captured');
    this.rollRef = num('rollRef', 0); this.pitchRef = num('pitchRef', 0);
    this.aileronRef = num('aileronRef', 0); this.elevatorRef = num('elevatorRef', 0);
    this.airU = num('airU', 0); this.airV = num('airV', 0);
    this.stickRestA = num('stickRestA', 0); this.stickRestE = num('stickRestE', 0);
    const quiet = num('stickQuietFor', STICK_QUIET_MAX);
    this.stickQuietFor = quiet >= STICK_QUIET_MAX ? Infinity : quiet;
    // An older snapshot has none: counted as long since the capture, so the TRC's trim walk goes on at once (as it was).
    this.sinceCapture = num('sinceCapture', STICK_QUIET_MAX);
    this.yawActive = flag('yawActive'); this.holdingHeading = flag('holdingHeading');
    this.headingRef = num('headingRef', 0); this.pedalRest = num('pedalRest', 0); this.pedalRestFor = num('pedalRestFor', 0);
    this.pedalDir = num('pedalDir', 0); this.yawI = num('yawI', 0);
    this.lpA = num('lpA', 0); this.lpE = num('lpE', 0); this.lpR = num('lpR', 0);
    this.followed.aileron = num('followedAileron', 0); this.followed.elevator = num('followedElevator', 0);
    this.followed.rudder = num('followedRudder', 0); this.followed.collective = num('followedCollective', 0);
    this.heightMode = HEIGHT_MODES[num('heightMode', 0)] ?? 'off';
    this.heightRef = num('heightRef', 0); this.climbWas = num('climbWas', NaN);
    this.xfeed = num('xfeed', 0); this.collWas = num('collWas', NaN);
    this.collLeft = num('collLeft', NaN); this.keyDir = Math.sign(num('keyDir', 0)); this.pedalOnSkids = flag('pedalOnSkids');
    this.lpBeta = num('lpBeta', 0); this.stickMoved = flag('stickMoved');
    this.airRestA = num('airRestA', 0); this.airRestE = num('airRestE', 0); this.airQuietFor = num('airQuietFor', 0);
    this.rollEngaged = flag('rollEngaged'); this.rollHeadingRef = num('rollHeadingRef', 0); this.lpRoll = num('lpRoll', 0);
  }

  /**
   * A new flight (a scenario reset, or a restore without the assist's state): reset() and forget a pedal key worked on
   * the skids, which reset() keeps (it runs every step on loaded skids, where that record is made).
   */
  newFlight(): void {
    this.reset();
    this.pedalOnSkids = false;
    this.lpBeta = 0; this.stickMoved = false;
    this.rollEngaged = false; this.lpRoll = 0;
  }

  /** Forget the datums (a reset or a restore): the next active step captures the attitude, stick and heading it finds. */
  reset(): void {
    this.captured = false;
    this.yawActive = false;
    this.holdingHeading = false;
    this.yawI = 0;
    this.lpA = this.lpE = this.lpR = 0;
    this.pedalStep = 0;
    this.heightMode = 'off'; this.climbWas = NaN;
    this.xfeed = 0; this.collWas = NaN; this.collLeft = NaN; this.keyDir = 0;
    this.output.aileron = this.output.elevator = this.output.rudder = this.output.gain = this.output.cyclicGain = 0;
    this.airQuietFor = 0;
  }

  /**
   * Before the flight model's step: add the series command to `c` when `active` (switched on, nobody else flying) and
   * airborne below fadeKias[1] (or on light skids, groundLoad); walk the keyboard controls (followUp). after() must
   * follow the step.
   */
  before(dt: number, s: AircraftState, c: ControlInputs, active: boolean): void {
    const t = this.tuning, o = this.output, fu = t.followUp;
    this.applied = false;
    this.pedalStep = 0;
    const fade = clamp((t.fadeKias[1] - s.ias / KT) / (t.fadeKias[1] - t.fadeKias[0]), 0, 1);
    // The cyclic terms' gain: the speed fade, or on a keyboard cyclic the cruise attitude hold's (cruiseHold).
    const cyc = Math.max(fade, t.cruiseHold && fu && c.keyboardCyclic === true ? t.cruiseHold.gain : 0);
    const lightSkids = s.onGround && t.groundLoad !== undefined && groundLoadFraction(s) < t.groundLoad;
    // A pedal key worked on the skids makes the lift-off's yaw the pilot's (kept through the reset below).
    if (!s.onGround) this.pedalOnSkids = false;
    else if (c.pedalWorked === true) this.pedalOnSkids = true;
    if (!active || s.crashed || !(cyc > 0) || (s.onGround && !lightSkids)) {
      this.reset();
      // Above the fade the sideslip pedal follow-up (opt-in) still trims the keyboard pedals.
      if (t.sideslipPedal && fu && active && !s.crashed && !s.onGround && c.keyboardPedals === true) this.sideslipOnly(dt, s, c);
      // On the wheels the ground-roll heading hold (opt-in) holds the touchdown heading on the keyboard pedals.
      if (t.groundRollHeading) {
        if (fu && active && !s.crashed && s.onGround && c.keyboardPedals === true) this.groundRoll(dt, s, c);
        else if (!s.onGround || s.crashed) { this.rollEngaged = false; this.lpRoll = 0; }
      }
      return;
    }
    // Airborne or on light wheels: the ground-roll hold's datum is the heading at the touchdown (opt-in).
    if (t.groundRollHeading) {
      if (!s.onGround) { this.rollEngaged = false; this.lpRoll = 0; }
      else if (!this.rollEngaged) { this.rollEngaged = true; this.rollHeadingRef = s.heading; this.lpRoll = 0; }
    }
    const w = s.angularVelocity;
    const p = this.pilot;
    p.aileron = c.aileron; p.elevator = c.elevator; p.rudder = c.rudder;
    const kbCyclic = !!fu && c.keyboardCyclic === true, kbPedals = !!fu && c.keyboardPedals === true;

    // Cyclic: airborne, or on light skids with the datum kept through the touch.
    const air = s.airVelocityBody;
    // The capture waits until fully airborne with the stick quiet (captureAirborne, opt-in); the cyclic terms wait with it.
    let cyclicOn = true;
    const ca = t.captureAirborne;
    if (ca && !this.captured) {
      const moved = Math.abs(c.aileron - this.airRestA) > STICK_EPS || Math.abs(c.elevator - this.airRestE) > STICK_EPS;
      this.airRestA = c.aileron; this.airRestE = c.elevator;
      this.airQuietFor = s.onGround || moved ? 0 : this.airQuietFor + dt;
      cyclicOn = this.airQuietFor >= ca.quietS;
    }
    if (!this.captured && cyclicOn) {
      this.stickMoved = false;
      this.captured = true;
      this.rollRef = s.roll; this.pitchRef = s.pitch;
      this.aileronRef = c.aileron; this.elevatorRef = c.elevator;
      this.airU = air.x; this.airV = air.y;
      this.stickRestA = c.aileron; this.stickRestE = c.elevator; this.stickQuietFor = Infinity;
      this.sinceCapture = 0;
    }
    this.sinceCapture += dt;
    if (Math.abs(c.aileron - this.stickRestA) > STICK_EPS || Math.abs(c.elevator - this.stickRestE) > STICK_EPS) {
      this.stickRestA = c.aileron; this.stickRestE = c.elevator; this.stickQuietFor = 0;
    } else this.stickQuietFor += dt;
    // Re-capture on a re-centring keyboard stick back at rest (recaptureOnCentre, opt-in): the datum is where the pilot left
    // the attitude, not where it was captured.
    const rcc = t.recaptureOnCentre;
    if (rcc && kbCyclic && this.captured) {
      if (this.stickQuietFor === 0) this.stickMoved = true;
      const anchor = s.rotorcraft?.springTrim;
      const atAnchor = !anchor || (Math.abs(c.aileron - anchor.roll) <= STICK_EPS && Math.abs(c.elevator - anchor.pitch) <= STICK_EPS);
      if (this.stickMoved && atAnchor && this.stickQuietFor >= rcc.quietS) {
        this.rollRef = s.roll; this.pitchRef = s.pitch; this.aileronRef = c.aileron; this.elevatorRef = c.elevator;
        this.stickMoved = false;
      }
    }
    // Datum relaxation toward the flown attitude: the fade band's (time) and the airspeed change's (datumRelaxKt; a
    // hand-held stick only when the keyboard stick is followed up instead).
    const kFade = cyc < 1 ? Math.min(1, (1 - cyc) * dt / RELAX_S) : 0;
    let kSpeed = 0;
    if (t.datumRelaxKt !== undefined) {
      const a = Math.min(1, dt / AIR_FILTER_S), was = Math.hypot(this.airU, this.airV);
      this.airU += (air.x - this.airU) * a; this.airV += (air.y - this.airV) * a;
      const slowed = was - Math.hypot(this.airU, this.airV);
      if (slowed > 0 && this.stickQuietFor < STICK_ACTIVE_S && !kbCyclic) kSpeed = Math.min(1, slowed / (t.datumRelaxKt * KT));
    }
    let roll0 = this.rollRef + t.stickAttitude * (c.aileron - this.aileronRef);
    let pitch0 = this.pitchRef + t.stickAttitude * (c.elevator - this.elevatorRef);
    // Translational rate command (keyboard cyclic): the datums lean against the ground velocity, and walk to the
    // zero-ground-speed trim while the stick rests.
    const tr = t.translationalRate;
    if (tr && kbCyclic) {
      const vx = s.velocity.x, vy = s.velocity.y, gs = Math.hypot(vx, vy);
      const ft = clamp((tr.fadeKt[1] * KT - gs) / ((tr.fadeKt[1] - tr.fadeKt[0]) * KT), 0, 1);
      if (ft > 0) {
        const ch = Math.cos(s.heading), sh = Math.sin(s.heading);
        const vf = vx * ch + vy * sh, vr = -vx * sh + vy * ch;
        const kv = tr.degPerKt * DEG / KT, lim = tr.limitDeg * DEG;
        pitch0 += ft * clamp(kv * vf, -lim, lim);
        roll0 -= ft * clamp(kv * vr, -lim, lim);
        if (Math.min(this.stickQuietFor, this.sinceCapture) >= tr.restS) {
          const ki = fade * ft * tr.trimDegPerSPerKt * DEG / KT, cap = (tr.trimMaxDegS ?? Infinity) * DEG * dt;
          const dp = clamp(ki * vf * dt, -cap, cap), dr = clamp(ki * vr * dt, -cap, cap);
          this.pitchRef += dp; pitch0 += dp;
          this.rollRef -= dr; roll0 -= dr;
        }
      }
    }
    const k = 1 - (1 - kFade) * (1 - kSpeed);
    if (k > 0) {
      const dr = wrap(s.roll - roll0) * k, dp = (s.pitch - pitch0) * k;
      this.rollRef += dr; this.pitchRef += dp; roll0 += dr; pitch0 += dp;
    }
    const a = t.authority;
    o.aileron = cyc * clamp(-t.kp * w.x - t.katt * wrap(s.roll - roll0), -a, a);
    o.elevator = cyc * clamp(-t.kq * w.y - t.katt * (s.pitch - pitch0), -a, a);
    if (!cyclicOn) { o.aileron = 0; o.elevator = 0; }
    // Cyclic follow-up through the spring-trim anchor: the keyboard stick follows the anchor at the input module's next
    // frame, and the stick reference moves with it now, so the commanded attitude stays.
    const spring = s.rotorcraft?.springTrim;
    if (kbCyclic && spring) {
      const f = Math.min(1, dt / fu!.filterS);
      this.lpA += (o.aileron - this.lpA) * f; this.lpE += (o.elevator - this.lpE) * f;
      const dA = clamp(spring.roll + followSpeed(this.lpA, a, fu!.deadBand, fu!.cyclicGain, fu!.cyclicRate) * dt, -1, 1) - spring.roll;
      const dE = clamp(spring.pitch + followSpeed(this.lpE, a, fu!.deadBand, fu!.cyclicGain, fu!.cyclicRate) * dt, -1, 1) - spring.pitch;
      spring.roll += dA; spring.pitch += dE;
      this.aileronRef += dA; this.elevatorRef += dE; this.stickRestA += dA; this.stickRestE += dE;
      this.followed.aileron += dA; this.followed.elevator += dE;
    } else this.lpA = this.lpE = 0;

    // The height hold walks the keyboard collective (before the pedals: the crossfeed reads the collective it leaves).
    this.heightHold(dt, s, c);

    // Pedals: rate damping while the pilot works them, and the heading held once they rest.
    if (!this.yawActive) {
      this.yawActive = true;
      this.pedalRest = c.rudder; this.pedalRestFor = 0;
      this.holdingHeading = false; this.yawI = 0;
    }
    if (c.pedalWorked === true || Math.abs(c.rudder - this.pedalRest) > PEDAL_EPS) {
      if (c.rudder !== this.pedalRest) this.pedalDir = Math.sign(c.rudder - this.pedalRest);
      this.pedalRest = c.rudder; this.pedalRestFor = 0; this.holdingHeading = false;
    } else this.pedalRestFor += dt;
    const ya = t.yawAuthority, ha = t.holdAuthority ?? ya, kpsi = t.kpsi ?? 0;
    const h = kpsi > 0 ? clamp((t.fadeKias[0] - s.ias / KT) / HOLD_FADE_KT, 0, 1) : 0;
    if (!(h > 0)) { this.holdingHeading = false; this.yawI = 0; }
    if (!this.holdingHeading) {
      this.headingRef = s.heading;
      if (h > 0 && this.pedalRestFor >= PEDAL_REST_S) {
        // Lead only a turn the pilot's pedal made: a torque swing is stopped where it is.
        const lead = Math.sign(w.z) === this.pedalDir ? HOLD_LEAD_S * w.z : 0;
        this.holdingHeading = true; this.headingRef = wrap(s.heading + lead);
      }
    }
    let e = 0;
    if (this.holdingHeading) {
      e = wrap(s.heading - this.headingRef);
      if (Math.abs(e) > HOLD_SLIP) { this.headingRef = wrap(s.heading - Math.sign(e) * HOLD_SLIP); e = Math.sign(e) * HOLD_SLIP; }
    }
    const rd = -t.kr * w.z, hp = -h * kpsi * e;
    const law = t.holdAuthority === undefined
      ? (I: number): number => clamp(rd + hp - h * I, -ya, ya)
      : (I: number): number => clamp(clamp(rd, -ya, ya) + clamp(hp - h * I, -ha, ha), -ha, ha);
    // The integral: airborne and holding only, and only while it does not push the term further into its limit. For
    // keyboard pedals the follow-up is the integral.
    if (kbPedals) this.yawI = 0;
    else if (this.holdingHeading && !s.onGround && t.kpsiI) {
      const next = clamp(this.yawI + t.kpsiI * e * dt, -ha, ha);
      if (Math.abs(law(next)) < ha || Math.abs(next) < Math.abs(this.yawI)) this.yawI = next;
    }
    o.rudder = fade * law(this.yawI);
    o.gain = fade; o.cyclicGain = cyc;
    // Pedal follow-up: from the unclamped terms, while no pedal key is held (the filter keeps its value through a tap);
    // with it the collective crossfeed (pedalCrossfeed), washed out.
    if (kbPedals) {
      const was = this.xfeed, xf = t.pedalCrossfeed, coll = c.collective ?? 0;
      if (xf) {
        // A collective change while a pedal key is held, or on the skids (the lift-off, where the pilot sets the pedal
        // before raising the collective), is the pilot's to pedal; what the crossfeed holds washes out either way (a pedal
        // key moves the pedals from where they are).
        if (c.pedalWorked !== true && (!s.onGround || (xf.onLightSkids === true && !this.pedalOnSkids)) && Number.isFinite(this.collWas)) this.xfeed += xf.perCollective * fade * (coll - this.collWas);
        this.xfeed -= this.xfeed * Math.min(1, dt / xf.washS);
      }
      this.collWas = coll;
      let step = this.xfeed - was;
      if (c.pedalWorked !== true) {
        this.lpR += (fade * (rd + hp) - this.lpR) * Math.min(1, dt / fu!.filterS);
        step += followSpeed(this.lpR, ya, fu!.deadBand, fu!.pedalGain, fu!.pedalRate) * dt;
      }
      // The sideslip pedal follow-up (opt-in; 0 while a pedal key is held or on the ground).
      if (t.sideslipPedal) step += this.sideslipStep(dt, s, c);
      this.pedalStep = clamp(c.rudder + step, -1, 1) - c.rudder;
      this.pedalRest += this.pedalStep;
      this.followed.rudder += this.pedalStep;
    } else { this.lpR = 0; this.xfeed = 0; this.collWas = NaN; }

    c.aileron = clamp(c.aileron + o.aileron, -1, 1);
    c.elevator = clamp(c.elevator + o.elevator, -1, 1);
    c.rudder = clamp(c.rudder + o.rudder, -1, 1);
    this.applied = true;
  }

  /**
   * The sideslip pedal follow-up's step for this physics step (sideslipPedal, opt-in), axis units: the low-passed sideslip (+ =
   * the aircraft moving right through the air: right pedal) times `gain`, within `rate`, weighted by the speed band on the
   * forward air speed (body x); 0 while a pedal key is held or on the ground (the filter keeps running).
   */
  private sideslipStep(dt: number, s: AircraftState, c: ControlInputs): number {
    const sp = this.tuning.sideslipPedal;
    if (!sp) return 0;
    const air = s.airVelocityBody, beta = Math.hypot(air.x, air.y) > 1 ? Math.atan2(air.y, Math.abs(air.x)) : 0;
    this.lpBeta += (beta - this.lpBeta) * Math.min(1, dt / sp.filterS);
    if (c.pedalWorked === true || s.onGround) return 0;
    // Weighted by the FORWARD air speed: a sideways drift (the sideslip near 90 deg) is not a turn to coordinate.
    const fwd = Math.max(0, air.x) / KT, k = sp.kias;
    const wt = clamp((fwd - k[0]) / Math.max(k[1] - k[0], 1e-6), 0, 1) * clamp((k[3] - fwd) / Math.max(k[3] - k[2], 1e-6), 0, 1);
    return wt > 0 ? wt * clamp(sp.gain * this.lpBeta, -sp.rate, sp.rate) * dt : 0;
  }

  /**
   * Above the fade (the assist otherwise inactive): the sideslip pedal follow-up alone, handed to the input module through
   * after() as the main path's follow-up is; the stick and pedals this step are the pilot's.
   */
  private sideslipOnly(dt: number, s: AircraftState, c: ControlInputs): void {
    const step = this.sideslipStep(dt, s, c);
    const p = this.pilot;
    p.aileron = c.aileron; p.elevator = c.elevator; p.rudder = c.rudder;
    this.pedalStep = clamp(c.rudder + step, -1, 1) - c.rudder;
    this.followed.rudder += this.pedalStep;
    this.applied = true;
  }

  /**
   * On the wheels (groundRollHeading, opt-in): the heading at the touchdown held on the keyboard pedals, as a series term (put back
   * in after()) and a walk of the keyboard pedal centre handed to the input module through after(); a held pedal key moves the
   * datum with the heading (the pilot's turn) and the term waits. Nothing with the tail wheel unlocked (the castor's turns are the
   * pilot's) or outside the ground-speed band.
   */
  private groundRoll(dt: number, s: AircraftState, c: ControlInputs): void {
    const g = this.tuning.groundRollHeading!, fu = this.tuning.followUp!;
    if (!this.rollEngaged || c.pedalWorked === true) { this.rollEngaged = true; this.rollHeadingRef = s.heading; this.lpRoll = 0; }
    const gs = s.groundSpeed / KT, k = g.gsKt;
    const wt = c.tailWheelLock === true
      ? clamp((gs - k[0]) / Math.max(k[1] - k[0], 1e-6), 0, 1) * clamp((k[3] - gs) / Math.max(k[3] - k[2], 1e-6), 0, 1) : 0;
    const term = wt * clamp(-g.kpsi * wrap(s.heading - this.rollHeadingRef) - g.kr * s.angularVelocity.z, -g.authority, g.authority);
    this.lpRoll += (term - this.lpRoll) * Math.min(1, dt / g.filterS);
    if (!(wt > 0) || c.pedalWorked === true) return;
    const p = this.pilot;
    p.aileron = c.aileron; p.elevator = c.elevator; p.rudder = c.rudder;
    this.pedalStep = clamp(c.rudder + followSpeed(this.lpRoll, g.authority, fu.deadBand, g.gain, g.rate) * dt, -1, 1) - c.rudder;
    this.followed.rudder += this.pedalStep;
    this.output.rudder = term;
    c.rudder = clamp(c.rudder + term, -1, 1);
    this.applied = true;
  }

  /**
   * The height hold (heightHold; a keyboard collective only): walks ControlInputs.collective itself, as the keys do (the
   * input module adds its keys to it next frame), so nothing is put back in after().
   */
  private heightHold(dt: number, s: AircraftState, c: ControlInputs): void {
    const hh = this.tuning.heightHold, rc = s.rotorcraft;
    const hf = hh ? clamp((hh.fadeKias[1] - s.ias / KT) / (hh.fadeKias[1] - hh.fadeKias[0]), 0, 1) : 0;
    const ts = rc?.turboshaft, tw = rc?.twinTurboshaft;
    const powered = !!rc && s.engines.every((e) => e.running) && !tw?.oei && !ts?.needlesSplit && (ts?.nrPct ?? 100) >= (hh?.minNrPct ?? 0);
    if (!hh || c.keyboardCollective !== true || !(hf > 0) || !powered || c.collective === undefined) {
      this.heightMode = 'off'; this.climbWas = NaN; this.keyDir = 0;
      this.collLeft = c.collective ?? NaN;
      return;
    }
    const w = -s.velocity.z;
    // The proportional term (on the climb rate's change, so a new command does not kick the lever).
    const dw = Number.isFinite(this.climbWas) && dt > 0 ? (w - this.climbWas) / dt : 0;
    this.climbWas = w;
    // What the keys moved the lever by since this hold's last step (the input module adds them between steps).
    const key = Number.isFinite(this.collLeft) ? c.collective - this.collLeft : 0;
    let rate: number, back = 0;
    const held = hh.held;
    if (c.collectiveWorked === true && held && c.collectiveFastWorked !== true && !s.onGround) {
      // A bare F5 / F6 held airborne: a climb-rate command. The key's own move is taken back and the lever is walked to
      // the commanded climb or sink, the sink slowing near the ground.
      this.heightMode = 'off';
      if (key !== 0) this.keyDir = Math.sign(key);
      back = hf * key;
      const sink = clamp(held.landSinkMps + (s.altitudeAGL - held.landAglM) * (held.sinkMps - held.landSinkMps) / held.landBandM,
        held.landSinkMps, held.sinkMps);
      const vsCmd = this.keyDir > 0 ? held.climbMps : this.keyDir < 0 ? -sink : 0;
      rate = clamp(hh.kv * (vsCmd - w) - hh.kp * dw, -held.rate, held.rate);
    } else if (c.collectiveWorked === true) {
      // The pilot moves the lever: the hand-rate keys (Shift+F5 / Shift+F6) raw, a bare key on the skids (or without the
      // climb-rate command) damped; the datum waits for the keys to rest.
      this.heightMode = 'off'; this.keyDir = 0;
      rate = c.collectiveFastWorked === true ? 0 : clamp(-hh.kvHeld * w - hh.kp * dw, -hh.rate, hh.rate);
    } else {
      this.keyDir = 0;
      if (this.heightMode === 'off') this.heightMode = 'damp';
      if (this.heightMode === 'damp' && Math.abs(w) < hh.captureMps) { this.heightMode = 'hold'; this.heightRef = s.altitudeMSL; }
      const vsCmd = this.heightMode === 'hold' ? clamp(hh.kh * (this.heightRef - s.altitudeMSL), -hh.vsMax, hh.vsMax) : 0;
      rate = clamp(hh.kv * (vsCmd - w) - hh.kp * dw, -hh.rate, hh.rate);
    }
    rate *= hf;
    // Never into the power limit (above the maximum continuous power), never below the floor; a held F6 that has
    // carried the lever past the limit (the torque lags the lever) is backed off.
    const overLimit = rc!.powerLimitExceeded || rc!.takeoffPowerSeconds > 0;
    if (rate > 0 && overLimit) rate = 0;
    if (overLimit && this.keyDir > 0 && held?.limitBackRate) rate = -hf * held.limitBackRate;
    const was = c.collective;
    c.collective = clamp(was - back + rate * dt, Math.min(was, hh.floor), 1);
    this.followed.collective += c.collective - was;
    this.collLeft = c.collective;
  }

  /**
   * After the flight model's step: the pilot's own aileron, elevator and rudder back (restored, not subtracted), the
   * rudder with this step's pedal follow-up, which ControlInputs.pedalFollowUp hands to the input module.
   */
  after(c: ControlInputs): void {
    if (!this.applied) return;
    const p = this.pilot;
    c.aileron = p.aileron; c.elevator = p.elevator; c.rudder = p.rudder + this.pedalStep;
    if (this.pedalStep !== 0) c.pedalFollowUp = (c.pedalFollowUp ?? 0) + this.pedalStep;
    this.pedalStep = 0;
    this.applied = false;
  }
}
