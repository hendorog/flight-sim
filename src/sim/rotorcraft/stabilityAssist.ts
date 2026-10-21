// STAB ASSIST: a laptop sim aid for an unaugmented hingeless helicopter at hover and low speed. It is NOT a modelled
// aircraft system: the Bo 105 CB-4 flies without a SAS (P5 FM 7-24; the optional IFR-kit SAS, FMS 11-2, is not
// modelled). Plan bofly F1 (W/bofly/fix-plan.md); the gains are the hands-off probe's (W/bofly/probes sas2.log); the
// heading hold, the speed-tracking datum and the yaw term on unloading skids are round 2's (W/bofly/r2).
//
// Why: the real Bo 105 hover is unstable (ERF 1995 VII-7, P: 45 deg of roll about 14 s after a lateral input; the
// flight-identified hover phugoid doubles in about 2-4 s) and the sim matches it (doubling 2.3 s). ADS-33E-PRF Fig 7
// puts that at Level 3, and 3.3.2.3 names an attitude-hold response type as the way to meet the hover requirement. A
// first-time pilot on a keyboard sits where the delayed test pilot loses the raw hover (W/probes/pilot-bo2). The
// physics stays as sourced; this term only adds to the controls.
//
// The law (series, controls only; never flight-model state), each physics step:
//   da = fade x clamp(-kp p - katt (roll - roll0), +/-authority)
//   de = fade x clamp(-kq q - katt (pitch - pitch0), +/-authority)
//   dr = fade x clamp(-kr r - kpsi (psi - psi0) - I, +/-yawAuthority),  I = kpsiI x integral of (psi - psi0) dt
// added to the pilot's aileron / elevator / rudder (the -1..1 axes; authority 0.2 = 10 % of travel) for the flight
// model's step only: after() puts the pilot's controls back, so the input module, the cockpit stick, the control box
// and a snapshot never see the series term (a real series actuator does not move the stick either).
// The cyclic datum is attitude-command / attitude-hold (ADS-33E's ACAH response type): roll0 = rollRef + K (aileron -
// aileronRef), pitch0 likewise, where (rollRef, aileronRef) is the attitude and stick captured together when the assist
// becomes active (a reset, lift-off, the hover hold letting go, the toggle, slowing below fadeKias[1]). Hands off this
// is the probe's attitude retention; a stick held off the captured position commands an attitude (K rad per unit of the
// axis) and the assist holds it. Beyond the series authority the raw aircraft answers (full stick = the raw aircraft).
// The datum tracks the trim through a deceleration: the trim stick moves with speed far more than the trim attitude
// does (0 -> 30 KIAS: 0.26 of the axis forward against 0.8 deg of pitch, W/bofly/probes-assess), so a pair captured at
// one speed commands the wrong attitude at another and the series term sits on a bias (7 % of travel in the hover after
// a capture at 30 KIAS). So while the low-passed airspeed (body axes, horizontal) falls and the pilot has moved the
// cyclic within STICK_ACTIVE_S, the datum relaxes toward the flown attitude by one e-fold per datumRelaxKt of slowing: a
// deceleration to the hover arrives with the stick at the hover trim and the authority free. Hands off nothing relaxes
// (the raw hover diverges: relaxing on any air-velocity change crashed the hands-off gusty hover in the probe), and only
// slowing counts (speeding up from the hover toward 30 KIAS, the fade band's RELAX_S takes over above it).
// Speed fade: full gain below fadeKias[0], none above fadeKias[1]; in between the datum also relaxes toward the flown
// attitude (RELAX_S). Attitude, not position: drift is the pilot's (or the hover hold's, A).
// The pedal term is rate command / direction hold (ADS-33E's RCDH): while the pilot works the pedal (a pedal key held or
// a hardware pedal in use, ControlInputs.pedalWorked, or the pedal moving) the heading datum follows the heading and
// only the rate is damped; PEDAL_REST_S after that stops (the keyboard pedal stays where the keys left it) the heading
// is captured, leading by the coasting turn (HOLD_LEAD_S), and held through collective changes (torque) and gusts with
// a proportional and an integral term, all inside the same yaw authority (a full pedal still turns at 90 deg/s). The
// hold fades out over HOLD_FADE_KT up to fadeKias[0] (above that a bank is a turn); the rate damping stays to
// fadeKias[1]. Off on the ground (but the pedal term works once the skids carry less than groundYawLoad of the weight,
// so the heading is held from before lift-off), when crashed, and while the hover hold or an instructor flies (the
// caller's `active`).

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

const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

/** Fraction of the weight the skids (or wheels) carry. */
function groundLoadFraction(s: AircraftState): number {
  const w = s.wheels, weight = s.mass * G0;
  return weight > 0 ? (w[0].load + w[1].load + w[2].load) / weight : 1;
}

export class StabilityAssist {
  /** The series command of the last step (axis units) and the speed-fade gain applied; all 0 while inactive. */
  readonly output = { aileron: 0, elevator: 0, rudder: 0, gain: 0 };
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
  private yawI = 0;
  private applied = false;
  private readonly pilot = { aileron: 0, elevator: 0, rudder: 0 };

  constructor(readonly tuning: StabilityAssistTuning) {}

  /** Forget the datums (a reset or a restore): the next active step captures the attitude, stick and heading it finds. */
  reset(): void {
    this.captured = false;
    this.yawActive = false;
    this.holdingHeading = false;
    this.yawI = 0;
    this.output.aileron = this.output.elevator = this.output.rudder = this.output.gain = 0;
  }

  /**
   * Before the flight model's step: add the series command to `c` when `active` (switched on, nobody else flying) and
   * airborne below fadeKias[1] (the yaw term also on unloading skids). after() must follow the step.
   */
  before(dt: number, s: AircraftState, c: ControlInputs, active: boolean): void {
    const t = this.tuning, o = this.output;
    this.applied = false;
    const fade = clamp((t.fadeKias[1] - s.ias / KT) / (t.fadeKias[1] - t.fadeKias[0]), 0, 1);
    const yawOnSkids = s.onGround && t.groundYawLoad !== undefined && groundLoadFraction(s) < t.groundYawLoad;
    if (!active || s.crashed || !(fade > 0) || (s.onGround && !yawOnSkids)) {
      this.reset();
      return;
    }
    const w = s.angularVelocity;
    const p = this.pilot;
    p.aileron = c.aileron; p.elevator = c.elevator; p.rudder = c.rudder;

    // Cyclic: airborne only.
    if (s.onGround) {
      this.captured = false;
      o.aileron = o.elevator = 0;
    } else {
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
      // Datum relaxation toward the flown attitude: the fade band's (time) and the airspeed change's (datumRelaxKt).
      const kFade = fade < 1 ? Math.min(1, (1 - fade) * dt / RELAX_S) : 0;
      let kSpeed = 0;
      if (t.datumRelaxKt !== undefined) {
        const a = Math.min(1, dt / AIR_FILTER_S), was = Math.hypot(this.airU, this.airV);
        this.airU += (air.x - this.airU) * a; this.airV += (air.y - this.airV) * a;
        const slowed = was - Math.hypot(this.airU, this.airV);
        if (slowed > 0 && this.stickQuietFor < STICK_ACTIVE_S) kSpeed = Math.min(1, slowed / (t.datumRelaxKt * KT));
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
    }

    // Pedals: rate damping while the pilot works them, and the heading held once they rest.
    if (!this.yawActive) {
      this.yawActive = true;
      this.pedalRest = c.rudder; this.pedalRestFor = 0;
      this.holdingHeading = false; this.yawI = 0;
    }
    if (c.pedalWorked === true || Math.abs(c.rudder - this.pedalRest) > PEDAL_EPS) {
      this.pedalRest = c.rudder; this.pedalRestFor = 0; this.holdingHeading = false;
    } else this.pedalRestFor += dt;
    const ya = t.yawAuthority, kpsi = t.kpsi ?? 0;
    const h = kpsi > 0 ? clamp((t.fadeKias[0] - s.ias / KT) / HOLD_FADE_KT, 0, 1) : 0;
    if (!(h > 0)) { this.holdingHeading = false; this.yawI = 0; }
    if (!this.holdingHeading) {
      this.headingRef = s.heading;
      if (h > 0 && this.pedalRestFor >= PEDAL_REST_S) { this.holdingHeading = true; this.headingRef = wrap(s.heading + HOLD_LEAD_S * w.z); }
    }
    let e = 0;
    if (this.holdingHeading) {
      e = wrap(s.heading - this.headingRef);
      if (Math.abs(e) > HOLD_SLIP) { this.headingRef = wrap(s.heading - Math.sign(e) * HOLD_SLIP); e = Math.sign(e) * HOLD_SLIP; }
    }
    const pd = -t.kr * w.z - h * kpsi * e;
    // The integral: airborne and holding only, and only while it does not push the term further into its limit.
    if (this.holdingHeading && !s.onGround && t.kpsiI) {
      const next = clamp(this.yawI + t.kpsiI * e * dt, -ya, ya);
      if (Math.abs(pd - h * next) < ya || Math.abs(next) < Math.abs(this.yawI)) this.yawI = next;
    }
    o.rudder = fade * clamp(pd - h * this.yawI, -ya, ya);
    o.gain = fade;

    c.aileron = clamp(c.aileron + o.aileron, -1, 1);
    c.elevator = clamp(c.elevator + o.elevator, -1, 1);
    c.rudder = clamp(c.rudder + o.rudder, -1, 1);
    this.applied = true;
  }

  /** After the flight model's step: the pilot's own aileron, elevator and rudder back (restored, not subtracted). */
  after(c: ControlInputs): void {
    if (!this.applied) return;
    const p = this.pilot;
    c.aileron = p.aileron; c.elevator = p.elevator; c.rudder = p.rudder;
    this.applied = false;
  }
}
