// Derived training events (section 2.5): detectors that watch the signal frame and emit liftoff, stopped,
// stallWarnOn/Off, stallBreak, goAround, thresholdCrossed and rolloutComplete onto the training bus; the
// LandingDetector that turns a mains touchdown and what follows into a `landing` summary; and the builder of
// step-exact TouchdownData used inside the SimEvents touchdown handler.
//
// The detectors read only the SignalFrame (pilot units, see telemetry/providers), so they run identically on
// live frames and on recorded ones. Speeds in event payloads are indicated (asiKt, what the student sees and
// what grading uses); heights are aglFt of the reference point, which reads about 4 ft on the wheels.
//
// Choices where section 2.5 gives the event but not every detail (all named constants below):
//   liftoff           no wheel on the ground for 1 s with the throttle at >= 0.5 (a bounced landing at idle
//                     is not a lift-off); the payload is taken at the last wheel contact, and the record's
//                     simT is the moment of lift-off (it is emitted 1 s later, when confirmed).
//   stopped           only after the aircraft has moved (> 3 kt) since the last reset or stop, so a run that
//                     starts parked does not begin with a stale 'stopped'.
//   stallWarnOff      after the horn has been silent for 0.5 s (the horn chatters at the threshold).
//   stallBreak        airborne only; re-armed when the horn is off and stallFrac < 0.2 (so a secondary stall
//                     is a second event). Within 10 s of a break the horn-and-nose-dropping rule also needs
//                     stallFrac >= 0.05 (horn chatter in a flap-30 recovery is not a secondary stall).
//   goAround          the throttle pushed through 0.9 while airborne below 500 ft AGL within 1 NM of the
//                     extended centreline (from 3 NM out to 0.5 NM past the far end), then VS > 0 within 5 s;
//                     aglFt is the height at the throttle push. A take-off (full power set on the ground) is
//                     not a go-around.
//   thresholdCrossed  airborne over the 07 threshold (within 100 m of the centreline, heading within 45 deg of
//                     070); height and speed interpolated to the crossing.
//   rolloutComplete   armed by armRollout(); fires when |aiBankDeg| < 3 for 2 s after the turn has been seen
//                     (|aiBankDeg| >= 10); hdgErrDeg = hdgDeg - target when the wings came level.

import { C172 } from '../../core/c172';
import { FT, KT, quat, RAD } from '../../core/math';
import type { AircraftState } from '../../core/types';
import { AIRPORT, runwayCoords } from '../../core/world';
import { AIM_POINT } from '../../sim/scenarios';
import { isOnRunway } from '../../world/airport/layout';
import { angleDiff, wrap180 } from '../geo/angles';
import type { LandingData, SignalFrame, TouchdownData } from '../types';
import type { TrainingBus } from './bus';

const HALF_LENGTH = AIRPORT.runway.length / 2;
const RWY_HDG_DEG = AIRPORT.runway.heading * RAD;
/** aglFt of the reference point with the aircraft resting on its wheels (core/c172.ts: 1.25 m). */
export const REST_AGL_FT = 1.25 / FT;

export const EVENT_RULES = {
  liftoffAirborneS: 1,
  liftoffMinThrottle: 0.5,
  stoppedGsKt: 1,
  stoppedForS: 2,
  stoppedRearmGsKt: 3,
  stallWarnOffDebounceS: 0.5,
  stallBreakFrac: 0.5,
  stallBreakPitchRateDps: -4,
  stallRearmFrac: 0.2,
  /**
   * Within this time of a break, a further break by the horn-and-nose-dropping rule also needs part of the wing
   * stalled (stallFrac >= stallSecondaryMinFrac): in a flap-30 recovery at full power the horn chatters on and
   * off at 40-45 KIAS while the nose pitches, with no part of the wing stalled (round 7), which is not a
   * secondary stall.
   */
  stallSecondaryWindowS: 10,
  stallSecondaryMinFrac: 0.05,
  goAroundThrottle: 0.9,
  goAroundMaxAglFt: 500,
  goAroundClimbWithinS: 5,
  goAroundMaxAcrossM: 1852,
  goAroundAlongM: [-3 * 1852, AIRPORT.runway.length + 926] as const,
  thresholdMaxAcrossM: 100,
  thresholdHdgTolDeg: 45,
  rolloutTurnSeenBankDeg: 10,
  rolloutLevelBankDeg: 3,
  rolloutLevelForS: 2,
} as const;

const num = (f: Readonly<SignalFrame>, id: string): number => {
  const v = f[id];
  return typeof v === 'number' ? v : NaN;
};
const bool = (f: Readonly<SignalFrame>, id: string): boolean => f[id] === true;
/** Duration test with an allowance for summed frame times (10 x 0.1 s is just under 1 s). */
const reached = (t: number, s: number): boolean => t >= s - 1e-9;

export class DerivedEventDetector {
  private prevOnGround: boolean | null = null;
  private prevThrottle = NaN;
  private prevAlong = NaN;
  private prevAgl = NaN;
  private prevAsi = NaN;
  /** liftoff candidate: values at the last wheel contact, and airborne time since. */
  private liftoff: { asi: number; along: number; t: number; airborneS: number; emitted: boolean } | null = null;
  private moved = false;
  private stoppedS = 0;
  private warnOn = false;
  private warnOffS = 0;
  private breakArmed = true;
  /** simT of the last stall break (secondary-stall rule). */
  private lastBreakT = -Infinity;
  private goAround: { aglFt: number; elapsedS: number } | null = null;
  private rollout: { target: number; turnSeen: boolean; levelS: number; errAtLevel: number } | null = null;

  constructor(private readonly bus: TrainingBus) {}

  /** Once per frame after Telemetry.sample, with the run sim time and sim dt. */
  update(frame: Readonly<SignalFrame>, simT: number, dt: number): void {
    const R = EVENT_RULES;
    const h = dt > 0 ? dt : 0;
    const onGround = bool(frame, 'onGround');
    const asi = num(frame, 'asiKt');
    const along = num(frame, 'rwyAlongM');
    const across = num(frame, 'rwyAcrossM');
    const agl = num(frame, 'aglFt');
    const gs = num(frame, 'gsKt');
    const throttle = num(frame, 'throttle');
    const crashed = bool(frame, 'crashed');

    // ---- liftoff
    if (this.prevOnGround === true && !onGround) {
      this.liftoff = { asi: this.prevAsi, along: this.prevAlong, t: simT, airborneS: 0, emitted: false };
    }
    if (onGround) this.liftoff = null;
    else if (this.liftoff && !this.liftoff.emitted) {
      this.liftoff.airborneS += h;
      if (reached(this.liftoff.airborneS, R.liftoffAirborneS) && throttle >= R.liftoffMinThrottle && !crashed) {
        this.liftoff.emitted = true;
        this.bus.emit('liftoff', { kias: this.liftoff.asi, rwyAlongM: this.liftoff.along }, this.liftoff.t);
      }
    }

    // ---- stopped
    if (gs > R.stoppedRearmGsKt) this.moved = true;
    if (onGround && gs < R.stoppedGsKt && this.moved) {
      this.stoppedS += h;
      if (reached(this.stoppedS, R.stoppedForS)) {
        this.bus.emit('stopped', {}, simT);
        this.moved = false;
        this.stoppedS = 0;
      }
    } else this.stoppedS = 0;

    // ---- stall warning
    const warn = bool(frame, 'stallWarn');
    if (warn) {
      this.warnOffS = 0;
      if (!this.warnOn) {
        this.warnOn = true;
        this.bus.emit('stallWarnOn', { kias: asi }, simT);
      }
    } else if (this.warnOn) {
      this.warnOffS += h;
      if (reached(this.warnOffS, R.stallWarnOffDebounceS)) {
        this.warnOn = false;
        this.bus.emit('stallWarnOff', {}, simT);
      }
    }

    // ---- stall break
    const frac = num(frame, 'stallFrac');
    if (!this.breakArmed && !warn && !(frac >= R.stallRearmFrac)) this.breakArmed = true;
    if (this.breakArmed && !onGround && !crashed) {
      const recent = simT - this.lastBreakT <= R.stallSecondaryWindowS;
      const broke = frac >= R.stallBreakFrac
        || (warn && num(frame, 'pitchRateDps') < R.stallBreakPitchRateDps && (!recent || frac >= R.stallSecondaryMinFrac));
      if (broke) {
        this.breakArmed = false;
        this.lastBreakT = simT;
        this.bus.emit('stallBreak', { kias: asi, altFt: num(frame, 'altFt') }, simT);
      }
    }

    // ---- go-around
    const nearRunway =
      Math.abs(across) < R.goAroundMaxAcrossM && along >= R.goAroundAlongM[0] && along <= R.goAroundAlongM[1];
    if (!onGround && !crashed && throttle >= R.goAroundThrottle && this.prevThrottle < R.goAroundThrottle && agl < R.goAroundMaxAglFt && nearRunway) {
      this.goAround = { aglFt: agl, elapsedS: 0 };
    }
    if (this.goAround) {
      this.goAround.elapsedS += h;
      if (crashed || throttle < R.goAroundThrottle || this.goAround.elapsedS > R.goAroundClimbWithinS) this.goAround = null;
      else if (num(frame, 'vsFpm') > 0) {
        this.bus.emit('goAround', { aglFt: this.goAround.aglFt }, simT);
        this.goAround = null;
      }
    }

    // ---- threshold crossing (interpolated to along = 0)
    if (!onGround && this.prevAlong < 0 && along >= 0 && Math.abs(across) < R.thresholdMaxAcrossM && angleDiff(num(frame, 'hdgTrueDeg'), RWY_HDG_DEG) <= R.thresholdHdgTolDeg) {
      const k = -this.prevAlong / (along - this.prevAlong);
      const lerp = (a: number, b: number): number => (Number.isNaN(a) ? b : a + (b - a) * k);
      this.bus.emit('thresholdCrossed', { heightFt: lerp(this.prevAgl, agl), kias: lerp(this.prevAsi, asi) }, simT);
    }

    // ---- roll-out after a task's turn
    const ro = this.rollout;
    if (ro) {
      const bankAbs = Math.abs(num(frame, 'aiBankDeg'));
      if (bankAbs >= R.rolloutTurnSeenBankDeg) ro.turnSeen = true;
      if (ro.turnSeen && bankAbs < R.rolloutLevelBankDeg) {
        if (Number.isNaN(ro.errAtLevel)) ro.errAtLevel = wrap180(num(frame, 'hdgDeg') - ro.target);
        ro.levelS += h;
        if (reached(ro.levelS, R.rolloutLevelForS)) {
          this.rollout = null;
          this.bus.emit('rolloutComplete', { hdgErrDeg: ro.errAtLevel }, simT);
        }
      } else {
        ro.levelS = 0;
        ro.errAtLevel = NaN;
      }
    }

    this.prevOnGround = onGround;
    this.prevThrottle = throttle;
    this.prevAlong = along;
    this.prevAgl = agl;
    this.prevAsi = asi;
  }

  /** Arm rolloutComplete (a task's turn started); the event fires on |bank| < 3° for 2 s. */
  armRollout(targetHdgDeg: number): void {
    this.rollout = { target: targetHdgDeg, turnSeen: false, levelS: 0, errAtLevel: NaN };
  }

  reset(): void {
    this.prevOnGround = null;
    this.prevThrottle = NaN;
    this.prevAlong = NaN;
    this.prevAgl = NaN;
    this.prevAsi = NaN;
    this.liftoff = null;
    this.moved = false;
    this.stoppedS = 0;
    this.warnOn = false;
    this.warnOffS = 0;
    this.breakArmed = true;
    this.lastBreakT = -Infinity;
    this.goAround = null;
    this.rollout = null;
  }
}

/** Constants of the landing detector (section 3.4, landing grader). */
export const LANDING_RULES = {
  /** A landing starts below this height on the approach (reference-point aglFt). */
  startBelowFt: 50,
  /** ...and is abandoned above this without a wheel contact (hysteresis over startBelowFt). */
  abandonAboveFt: 60,
  /** After contact, airborne above this ends it as a touch-and-go / go-around. */
  endAirborneAboveFt: 20,
  /** On the ground at least this long before it can end on the ground. */
  minGroundS: 3,
  /** Full stop below this ground speed. */
  fullStopGsKt: 3,
  /** Vacating the runway on the ground below this speed ends the roll-out (taxiing off counts as a stop). */
  vacateGsKt: 20,
  /** A roll-out that never ends (stuck) closes after this, s. */
  maxRolloutS: 120,
  /** A separation counts as a bounce once airborne this long, s, or this high (wheel height, ft). */
  bounceMinS: 0.25,
  bounceMinFt: 1,
  /** A wheel contact starts a landing only after this long with no wheel on the ground, s (not a taxi bump). */
  minAirborneS: 2,
  /** Float: time from the reference point below this (about 6 ft of wheel height) to the main contact. */
  floatBelowFt: 10,
  /** The glide-path sample is taken descending through this height, and kept this long, s. */
  gpSampleFt: 300,
  gpSampleMaxAgeS: 180,
} as const;

type LandingPhase = 'idle' | 'approach' | 'contact';

/**
 * A landing starts below 50 ft AGL on final and ends on the ground for 3 s or airborne above 20 ft. It emits
 * `mainsTouchdown` at the first main contact and `landing` when the landing ends.
 *
 * "Ends on the ground for 3 s": the landing is past its bounces after 3 s on the ground, but the summary also
 * carries the roll-out (rolloutMaxAcrossM, fullStop), so it is emitted when the roll-out ends: a full stop,
 * vacating the runway at taxi speed, a take-off again (touch-and-go: airborne above 20 ft), a crash, or 120 s.
 * Wheel contacts come step-exact from onTouchdown (SimEvents); without them (recorded frames) the first
 * frame with a main wheel on the ground stands in. "On final" is not required at the start: any descent below
 * 50 ft that meets the ground is a landing (an off-runway landing must be graded too); kiasAt50Ft and
 * gpDevFtAt300 are NaN when those heights were not passed on the way down.
 */
export class LandingDetector {
  private phase: LandingPhase = 'idle';
  /** Seconds with no wheel on the ground, as of the last update. */
  private airborneS = 0;
  private prevAgl = NaN;
  private prevGp = NaN;
  private gp300: { value: number; t: number } | null = null;
  private kiasAt50 = NaN;
  private below10T = NaN;
  private firstWheel: TouchdownData['firstWheel'] | null = null;
  private td: TouchdownData | null = null;
  private tdT = 0;
  private groundS = 0;
  private sepS = 0;
  private sepMaxFt = 0;
  private bounces = 0;
  private maxBounceFt = 0;
  private maxAcross = 0;

  constructor(private readonly bus: TrainingBus) {}

  /** Step-exact contact data from the SimEvents touchdown handler (see touchdownData). */
  onTouchdown(td: TouchdownData, simT: number): void {
    if (this.phase === 'idle') {
      // Contacts on the ground (placing the aircraft at a start, taxi bumps) are not landings.
      if (!reached(this.airborneS, LANDING_RULES.minAirborneS)) return;
      this.begin(NaN);
    }
    if (this.firstWheel === null) this.firstWheel = td.firstWheel;
    if (this.td === null && td.firstWheel !== 'nose') this.mainsContact(td, simT);
  }

  /** Once per frame; returns the summary when a landing just ended (also emitted on the bus). */
  update(frame: Readonly<SignalFrame>, simT: number, dt: number): LandingData | null {
    const L = LANDING_RULES;
    const h = dt > 0 ? dt : 0;
    const agl = num(frame, 'aglFt');
    const onGround = bool(frame, 'onGround');
    const crashed = bool(frame, 'crashed');
    const gp = num(frame, 'gpDevFt');
    let ended: LandingData | null = null;
    this.airborneS = onGround ? 0 : this.airborneS + h;

    // Glide-path sample descending through 300 ft (interpolated), kept for the next landing.
    if (!onGround && this.prevAgl > L.gpSampleFt && agl <= L.gpSampleFt) {
      const k = (this.prevAgl - L.gpSampleFt) / (this.prevAgl - agl);
      this.gp300 = { value: Number.isNaN(this.prevGp) ? gp : this.prevGp + (gp - this.prevGp) * k, t: simT };
    }

    if (this.phase === 'idle') {
      if (!onGround && !crashed && agl < L.startBelowFt && this.prevAgl >= L.startBelowFt) this.begin(num(frame, 'asiKt'));
    }
    if (this.phase === 'approach') {
      if (!onGround && agl < L.floatBelowFt && Number.isNaN(this.below10T)) this.below10T = simT;
      if (this.firstWheel === null && bool(frame, 'noseOnGround')) this.firstWheel = 'nose';
      if (bool(frame, 'mainsOnGround') || (crashed && this.td === null)) {
        // No step-exact contact reported (recorded frames, or a crash before any contact): use this frame.
        this.mainsContact(touchdownFromFrame(frame, this.firstWheel ?? (bool(frame, 'noseOnGround') ? 'nose' : 'left')), simT);
      } else if (!onGround && agl > L.abandonAboveFt) this.phase = 'idle';
    }
    if (this.phase === 'contact') {
      this.maxAcross = Math.max(this.maxAcross, Math.abs(num(frame, 'rwyAcrossM')) || 0);
      if (onGround) {
        // Back on the ground: the separation just ended was a bounce if it was long or high enough. (Counted
        // on re-contact, so the lift-off of a touch-and-go is not a bounce.)
        if (reached(this.sepS, L.bounceMinS) || this.sepMaxFt > L.bounceMinFt) {
          this.bounces++;
          this.maxBounceFt = Math.max(this.maxBounceFt, this.sepMaxFt);
        }
        this.groundS += h;
        this.sepS = 0;
        this.sepMaxFt = 0;
      } else {
        this.groundS = 0;
        this.sepS += h;
        this.sepMaxFt = Math.max(this.sepMaxFt, agl - REST_AGL_FT);
      }
      const gs = num(frame, 'gsKt');
      const sinceContact = simT - this.tdT;
      if (crashed) ended = this.finish(false, true, simT);
      else if (!onGround && agl > L.endAirborneAboveFt) ended = this.finish(false, false, simT);
      else if (onGround && reached(this.groundS, L.minGroundS) && gs < L.fullStopGsKt) ended = this.finish(true, false, simT);
      else if (onGround && reached(this.groundS, L.minGroundS) && gs < L.vacateGsKt && !bool(frame, 'onRunway')) ended = this.finish(true, false, simT);
      else if (sinceContact > L.maxRolloutS) ended = this.finish(gs < L.fullStopGsKt, false, simT);
    }

    this.prevAgl = agl;
    this.prevGp = gp;
    return ended;
  }

  reset(): void {
    this.phase = 'idle';
    this.airborneS = 0;
    this.prevAgl = NaN;
    this.prevGp = NaN;
    this.gp300 = null;
    this.clearLanding();
  }

  private begin(kiasAt50: number): void {
    this.clearLanding();
    this.phase = 'approach';
    this.kiasAt50 = kiasAt50;
  }

  private clearLanding(): void {
    this.kiasAt50 = NaN;
    this.below10T = NaN;
    this.firstWheel = null;
    this.td = null;
    this.tdT = 0;
    this.groundS = 0;
    this.sepS = 0;
    this.sepMaxFt = 0;
    this.bounces = 0;
    this.maxBounceFt = 0;
    this.maxAcross = 0;
  }

  private mainsContact(td: TouchdownData, simT: number): void {
    const data: TouchdownData = { ...td, firstWheel: this.firstWheel ?? td.firstWheel };
    this.td = data;
    this.tdT = simT;
    this.phase = 'contact';
    this.maxAcross = Math.abs(td.rwyAcrossM) || 0;
    this.bus.emit('mainsTouchdown', data, simT);
  }

  private finish(fullStop: boolean, crashed: boolean, simT: number): LandingData {
    const L = LANDING_RULES;
    const td = this.td!;
    const gp = this.gp300 && simT - this.gp300.t <= L.gpSampleMaxAgeS ? this.gp300.value : NaN;
    const data: LandingData = {
      ...td,
      kiasAt50Ft: this.kiasAt50,
      gpDevFtAt300: gp,
      bounces: this.bounces,
      maxBounceFt: this.maxBounceFt,
      floatS: Number.isNaN(this.below10T) ? 0 : Math.max(0, this.tdT - this.below10T),
      rolloutMaxAcrossM: this.maxAcross,
      fullStop,
      crashed,
    };
    this.phase = 'idle';
    this.gp300 = null;
    this.clearLanding();
    this.bus.emit('landing', data, simT);
    return data;
  }
}

/** Main gear midpoint in body axes (core/c172.ts), m. */
const MAINS_BODY = { x: C172.gear.leftMain.x, y: 0, z: C172.gear.leftMain.z };

/**
 * Build TouchdownData from the flight-model state at the exact physics step of a wheel contact. `sinkFpm` is
 * the contact's sink rate in fpm (SimEvents' touchdown sinkRate is m/s: multiply by 196.85). Position fields
 * are of the main gear midpoint: centrelineM grades where the main wheels touch.
 */
export function touchdownData(s: Readonly<AircraftState>, wheel: 'nose' | 'left' | 'right', sinkFpm: number): TouchdownData {
  const off = quat.rotate(s.orientation, MAINS_BODY);
  const { along, across } = runwayCoords(s.position.x + off.x, s.position.y + off.y);
  const alongThr = along + HALF_LENGTH;
  const hdg = s.heading * RAD;
  return {
    sinkFpm,
    kias: s.ias / KT,
    firstWheel: wheel,
    distAimFt: (alongThr - AIM_POINT) / FT,
    rwyAcrossM: across,
    driftDeg: s.groundSpeed / KT < 5 ? 0 : wrap180(hdg - s.track * RAD),
    bankDeg: s.roll * RAD,
    pitchDeg: s.pitch * RAD,
    onRunway: isOnRunway(along, across),
  };
}

/** TouchdownData from a frame (no step-exact contact available): sink from the vertical speed. */
function touchdownFromFrame(f: Readonly<SignalFrame>, firstWheel: TouchdownData['firstWheel']): TouchdownData {
  return {
    sinkFpm: Math.max(0, -num(f, 'vsFpm')),
    kias: num(f, 'kias'),
    firstWheel,
    distAimFt: num(f, 'distAimFt'),
    rwyAcrossM: num(f, 'rwyAcrossM'),
    driftDeg: num(f, 'driftDeg'),
    bankDeg: num(f, 'bankDeg'),
    pitchDeg: num(f, 'pitchDeg'),
    onRunway: bool(f, 'onRunway'),
  };
}
