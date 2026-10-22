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
// attitude (RELAX_S). Attitude, not position: drift is the pilot's (or the hover hold's, A).
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
// Off on the ground (but working once the skids carry less than groundLoad of the weight, the cyclic datum kept through
// a skid touch in a low hover, the heading held from before lift-off), when crashed, and while the hover hold or an
// instructor flies (the caller's `active`).

import { G0, KT, clamp } from '../../core/math';
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
  /** The series command of the last step (axis units) and the speed-fade gain applied; all 0 while inactive. */
  readonly output = { aileron: 0, elevator: 0, rudder: 0, gain: 0 };
  /** How far the trim follow-up has moved the keyboard aileron, elevator and pedals since the assist was built, axis units. */
  readonly followed = { aileron: 0, elevator: 0, rudder: 0 };
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
  private applied = false;
  private readonly pilot = { aileron: 0, elevator: 0, rudder: 0 };

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
      stickQuietFor: Math.min(this.stickQuietFor, STICK_QUIET_MAX),
      yawActive: this.yawActive, holdingHeading: this.holdingHeading, headingRef: this.headingRef, pedalRest: this.pedalRest,
      pedalRestFor: this.pedalRestFor, pedalDir: this.pedalDir, yawI: this.yawI, lpA: this.lpA, lpE: this.lpE, lpR: this.lpR,
      followedAileron: this.followed.aileron, followedElevator: this.followed.elevator, followedRudder: this.followed.rudder,
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
    this.yawActive = flag('yawActive'); this.holdingHeading = flag('holdingHeading');
    this.headingRef = num('headingRef', 0); this.pedalRest = num('pedalRest', 0); this.pedalRestFor = num('pedalRestFor', 0);
    this.pedalDir = num('pedalDir', 0); this.yawI = num('yawI', 0);
    this.lpA = num('lpA', 0); this.lpE = num('lpE', 0); this.lpR = num('lpR', 0);
    this.followed.aileron = num('followedAileron', 0); this.followed.elevator = num('followedElevator', 0);
    this.followed.rudder = num('followedRudder', 0);
  }

  /** Forget the datums (a reset or a restore): the next active step captures the attitude, stick and heading it finds. */
  reset(): void {
    this.captured = false;
    this.yawActive = false;
    this.holdingHeading = false;
    this.yawI = 0;
    this.lpA = this.lpE = this.lpR = 0;
    this.pedalStep = 0;
    this.output.aileron = this.output.elevator = this.output.rudder = this.output.gain = 0;
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
    const lightSkids = s.onGround && t.groundLoad !== undefined && groundLoadFraction(s) < t.groundLoad;
    if (!active || s.crashed || !(fade > 0) || (s.onGround && !lightSkids)) {
      this.reset();
      return;
    }
    const w = s.angularVelocity;
    const p = this.pilot;
    p.aileron = c.aileron; p.elevator = c.elevator; p.rudder = c.rudder;
    const kbCyclic = !!fu && c.keyboardCyclic === true, kbPedals = !!fu && c.keyboardPedals === true;

    // Cyclic: airborne, or on light skids with the datum kept through the touch.
    const air = s.airVelocityBody;
    if (!this.captured) {
      this.captured = true;
      this.rollRef = s.roll; this.pitchRef = s.pitch;
      this.aileronRef = c.aileron; this.elevatorRef = c.elevator;
      this.airU = air.x; this.airV = air.y;
      this.stickRestA = c.aileron; this.stickRestE = c.elevator; this.stickQuietFor = Infinity;
    }
    if (Math.abs(c.aileron - this.stickRestA) > STICK_EPS || Math.abs(c.elevator - this.stickRestE) > STICK_EPS) {
      this.stickRestA = c.aileron; this.stickRestE = c.elevator; this.stickQuietFor = 0;
    } else this.stickQuietFor += dt;
    // Datum relaxation toward the flown attitude: the fade band's (time) and the airspeed change's (datumRelaxKt; a
    // hand-held stick only when the keyboard stick is followed up instead).
    const kFade = fade < 1 ? Math.min(1, (1 - fade) * dt / RELAX_S) : 0;
    let kSpeed = 0;
    if (t.datumRelaxKt !== undefined) {
      const a = Math.min(1, dt / AIR_FILTER_S), was = Math.hypot(this.airU, this.airV);
      this.airU += (air.x - this.airU) * a; this.airV += (air.y - this.airV) * a;
      const slowed = was - Math.hypot(this.airU, this.airV);
      if (slowed > 0 && this.stickQuietFor < STICK_ACTIVE_S && !kbCyclic) kSpeed = Math.min(1, slowed / (t.datumRelaxKt * KT));
    }
    let roll0 = this.rollRef + t.stickAttitude * (c.aileron - this.aileronRef);
    let pitch0 = this.pitchRef + t.stickAttitude * (c.elevator - this.elevatorRef);
    const k = 1 - (1 - kFade) * (1 - kSpeed);
    if (k > 0) {
      const dr = wrap(s.roll - roll0) * k, dp = (s.pitch - pitch0) * k;
      this.rollRef += dr; this.pitchRef += dp; roll0 += dr; pitch0 += dp;
    }
    const a = t.authority;
    o.aileron = fade * clamp(-t.kp * w.x - t.katt * wrap(s.roll - roll0), -a, a);
    o.elevator = fade * clamp(-t.kq * w.y - t.katt * (s.pitch - pitch0), -a, a);
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
    o.gain = fade;
    // Pedal follow-up: from the unclamped terms, while no pedal key is held (the filter keeps its value through a tap).
    if (kbPedals) {
      if (c.pedalWorked !== true) {
        this.lpR += (fade * (rd + hp) - this.lpR) * Math.min(1, dt / fu!.filterS);
        this.pedalStep = clamp(c.rudder + followSpeed(this.lpR, ya, fu!.deadBand, fu!.pedalGain, fu!.pedalRate) * dt, -1, 1) - c.rudder;
        this.pedalRest += this.pedalStep;
        this.followed.rudder += this.pedalStep;
      }
    } else this.lpR = 0;

    c.aileron = clamp(c.aileron + o.aileron, -1, 1);
    c.elevator = clamp(c.elevator + o.elevator, -1, 1);
    c.rudder = clamp(c.rudder + o.rudder, -1, 1);
    this.applied = true;
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
