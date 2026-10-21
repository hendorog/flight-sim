// STAB ASSIST: a laptop sim aid for an unaugmented hingeless helicopter at hover and low speed. It is NOT a modelled
// aircraft system: the Bo 105 CB-4 flies without a SAS (P5 FM 7-24; the optional IFR-kit SAS, FMS 11-2, is not
// modelled). Plan bofly F1 (W/bofly/fix-plan.md); the gains are the hands-off probe's (W/bofly/probes sas2.log).
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
//   dr = fade x clamp(-kr r, +/-yawAuthority)
// added to the pilot's aileron / elevator / rudder (the -1..1 axes; authority 0.2 = 10 % of travel) for the flight
// model's step only: after() puts the pilot's controls back, so the input module, the cockpit stick, the control box
// and a snapshot never see the series term (a real series actuator does not move the stick either).
// The datum is attitude-command / attitude-hold (ADS-33E's ACAH response type): roll0 = rollRef + K (aileron -
// aileronRef), pitch0 likewise, where (rollRef, aileronRef) is the attitude and stick captured together when the assist
// becomes active (a reset, lift-off, the hover hold letting go, the toggle, slowing below fadeKias[1]). Hands off this
// is the probe's attitude retention; a stick held off the captured position commands an attitude (K rad per unit of the
// axis) and the assist holds it. Beyond the series authority the raw aircraft answers (full stick = the raw aircraft).
// The pedal term damps the yaw rate only: the heading stays the pilot's. Attitude, not position: drift is the pilot's
// (or the hover hold's, A).
// Speed fade: full gain below fadeKias[0], none above fadeKias[1]; in between the datum also relaxes toward the flown
// attitude (RELAX_S), so the stick-to-attitude datum taken at the band's top does not carry a speed change into the
// hover. Off on the ground, when crashed, and while the hover hold or an instructor flies (the caller's `active`).

import { KT, clamp } from '../../core/math';
import type { AircraftState, ControlInputs } from '../../core/types';
import type { StabilityAssistTuning } from '../../input/profile';

/** In the fade band the datum relaxes toward the flown attitude with this time constant at zero gain, s. */
const RELAX_S = 2;

const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

export class StabilityAssist {
  /** The series command of the last step (axis units) and the speed-fade gain applied; all 0 while inactive. */
  readonly output = { aileron: 0, elevator: 0, rudder: 0, gain: 0 };
  private captured = false;
  private rollRef = 0;
  private pitchRef = 0;
  private aileronRef = 0;
  private elevatorRef = 0;
  private applied = false;
  private readonly pilot = { aileron: 0, elevator: 0, rudder: 0 };

  constructor(readonly tuning: StabilityAssistTuning) {}

  /** Forget the datum (a reset or a restore): the next active step captures the attitude and stick it finds. */
  reset(): void {
    this.captured = false;
    this.output.aileron = this.output.elevator = this.output.rudder = this.output.gain = 0;
  }

  /**
   * Before the flight model's step: add the series command to `c` when `active` (switched on, nobody else flying) and
   * airborne below fadeKias[1]. after() must follow the step.
   */
  before(dt: number, s: AircraftState, c: ControlInputs, active: boolean): void {
    const t = this.tuning, o = this.output;
    this.applied = false;
    const fade = clamp((t.fadeKias[1] - s.ias / KT) / (t.fadeKias[1] - t.fadeKias[0]), 0, 1);
    if (!active || s.onGround || s.crashed || !(fade > 0)) {
      this.captured = false;
      o.aileron = o.elevator = o.rudder = o.gain = 0;
      return;
    }
    if (!this.captured) {
      this.captured = true;
      this.rollRef = s.roll; this.pitchRef = s.pitch;
      this.aileronRef = c.aileron; this.elevatorRef = c.elevator;
    }
    let roll0 = this.rollRef + t.stickAttitude * (c.aileron - this.aileronRef);
    let pitch0 = this.pitchRef + t.stickAttitude * (c.elevator - this.elevatorRef);
    if (fade < 1) {
      const k = Math.min(1, (1 - fade) * dt / RELAX_S), dr = wrap(s.roll - roll0) * k, dp = (s.pitch - pitch0) * k;
      this.rollRef += dr; this.pitchRef += dp; roll0 += dr; pitch0 += dp;
    }
    const w = s.angularVelocity, a = t.authority;
    o.aileron = fade * clamp(-t.kp * w.x - t.katt * wrap(s.roll - roll0), -a, a);
    o.elevator = fade * clamp(-t.kq * w.y - t.katt * (s.pitch - pitch0), -a, a);
    o.rudder = fade * clamp(-t.kr * w.z, -t.yawAuthority, t.yawAuthority);
    o.gain = fade;
    const p = this.pilot;
    p.aileron = c.aileron; p.elevator = c.elevator; p.rudder = c.rudder;
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
