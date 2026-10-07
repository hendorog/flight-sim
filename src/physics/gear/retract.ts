// Landing-gear retraction system: the selector, the electro-hydraulic pump, the squat switch, the emergency
// (free-fall) extension and the warning horn of one retractable type, as data in RetractConfig. The actuator
// owns the aircraft's GearState and moves the three legs' extension between 0 (up) and 1 (down and locked).
//
// It is stepped ONCE per physics sub-step by the flight model (never at a Runge-Kutta stage), and its
// `extension` is what LandingGear (GearInput.extension) and the aerodynamic drag of the legs read for the
// whole of that sub-step.
//
// MOTION. Each leg moves linearly: a full extension takes `extendTime`, a full retraction `retractTime`, and a
// leg with a `legDelay` starts that long after the pump does. The pump runs only while the bus holds
// `minBusVolts`, and not for a retraction with weight on a main wheel (`squatInhibit`): the squat switch must
// have been open for SQUAT_DELAY before a retraction starts, so a bounce on the take-off roll with the selector
// UP too early does not unlock the legs, while a lift-off does (on the real systems the pump has to build up
// pressure against the down-lock springs, and some squat circuits carry a time delay). Pulling the emergency
// knob dumps the pressure: all three legs fall together in `freeFallTime`, with or without electrical power
// and whatever the selector says, and the pressure stays dumped until reset(). With a dead bus a system
// without up-locks lets the legs sag down in `deadBusSagTime`; one with up-locks stays where it is.
//
// INDICATION. `locked` are the three greens. `inTransit` is the red light: a leg between its stops, or at the
// stop the selector does not ask for. `warning` is the horn of RetractConfig.warning.

import type { GearLever, GearState } from '../../core/types';
import type { RetractConfig } from './gearConfig';

/** A leg this close to a stop is on it (the sum of sub-step increments does not land on 0 or 1 exactly). */
const STOP = 1e-9;
const NO_DELAY: readonly [number, number, number] = [0, 0, 0];
/** How long the squat switch must have been open (no weight on the mains) before the pump may retract, s. */
export const SQUAT_DELAY = 0.5;

export interface RetractInput {
  lever: GearLever;
  /** Emergency extension knob pulled. */
  emergency: boolean;
  busVoltage: number;
  /** Squat switch: a main wheel carried load in the previous sub-step. */
  weightOnWheels: boolean;
  /** The LOWEST throttle / power lever of any engine, running or not, 0 .. 1. */
  minThrottle: number;
  /** Flap lever position, in the units of RetractConfig.warning.flapsAtOrBeyond. */
  flapLever: number;
  onGround: boolean;
}

export class RetractActuator {
  readonly state: GearState = { retractable: true, lever: 'down', extension: [1, 1, 1], locked: [true, true, true], inTransit: false, warning: false };
  /** Pressure dumped by the emergency knob. */
  private emergency = false;
  /** How long the pump has been running on the present selection, s. */
  private pumpTime = 0;
  /** How long the squat switch has been open, s (counted up to SQUAT_DELAY; in flight it has been open long since). */
  private squatOpen = SQUAT_DELAY;
  /** restore() ran: the next update infers the pump's running time from the legs (it is not in the snapshot). */
  private resumed = false;

  constructor(readonly cfg: RetractConfig) {}

  /** All legs down and locked (selector DOWN) or up (selector UP), the pressure restored, the horn silent. */
  reset(down: boolean): void {
    const s = this.state;
    s.lever = down ? 'down' : 'up';
    s.extension[0] = s.extension[1] = s.extension[2] = down ? 1 : 0;
    s.warning = false;
    this.emergency = false;
    this.pumpTime = 0;
    this.squatOpen = SQUAT_DELAY;
    this.resumed = false;
    this.indicate();
  }

  /** Called ONCE per physics sub-step by the flight model. Returns `state`, changed in place. */
  update(dt: number, i: RetractInput): GearState {
    const cfg = this.cfg;
    const s = this.state;
    const e = s.extension;
    if (this.resumed) {
      this.resumed = false;
      s.lever = i.lever;
      this.pumpTime = this.servedTime();
    } else if (i.lever !== s.lever) this.pumpTime = 0;
    s.lever = i.lever;
    if (i.emergency) this.emergency = true;
    this.squatOpen = i.weightOnWheels ? 0 : Math.min(SQUAT_DELAY, this.squatOpen + dt);

    if (this.emergency) {
      this.pumpTime = 0;
      this.fall(dt / cfg.emergency.freeFallTime);
    } else if (i.busVoltage >= cfg.minBusVolts) {
      const down = s.lever === 'down';
      const target = down ? 1 : 0;
      const held = !down && cfg.squatInhibit && this.squatOpen < SQUAT_DELAY;
      if (held || (e[0] === target && e[1] === target && e[2] === target)) {
        this.pumpTime = 0;
      } else {
        const step = down ? dt / cfg.extendTime : -dt / cfg.retractTime;
        const delay = cfg.legDelay ?? NO_DELAY;
        for (let k = 0; k < 3; k++) {
          if (this.pumpTime >= delay[k]) e[k] = stop(e[k] + step);
        }
        this.pumpTime += dt;
      }
    } else {
      this.pumpTime = 0;
      // No pump. Without up-locks only the trapped pressure holds the legs up: they sag down (deadBusSagTime
      // Infinity: nothing moves). A leg that is down stays on its spring-loaded down-lock either way.
      if (!cfg.upLocks) this.fall(dt / (cfg.deadBusSagTime ?? cfg.emergency.freeFallTime));
    }

    this.indicate();
    const w = cfg.warning;
    const unsafe = !(s.locked[0] && s.locked[1] && s.locked[2]);
    s.warning =
      (unsafe && ((w.throttleBelow !== undefined && i.minThrottle < w.throttleBelow) || (w.flapsAtOrBeyond !== undefined && i.flapLever >= w.flapsAtOrBeyond))) ||
      (w.leverUpOnGround && s.lever === 'up' && i.onGround);
    return s;
  }

  capture(): { extension: [number, number, number]; emergency: boolean } {
    const e = this.state.extension;
    return { extension: [e[0], e[1], e[2]], emergency: this.emergency };
  }

  /**
   * The horn is that of the last update until the next one. The pump's running time is not in the snapshot:
   * the next update infers it from the legs, so a restore in mid-transit does not make the legs with a
   * `legDelay` wait their delays again. The squat switch counts as open long since (a snapshot on the ground
   * has weight on the wheels at the next update anyway).
   */
  restore(s: { extension: [number, number, number]; emergency: boolean }): void {
    const e = this.state.extension;
    for (let k = 0; k < 3; k++) e[k] = Math.max(0, Math.min(1, s.extension[k]));
    this.emergency = s.emergency;
    this.pumpTime = 0;
    this.squatOpen = SQUAT_DELAY;
    this.resumed = true;
    this.indicate();
  }

  /**
   * How long the pump has run on the selection `state.lever`, as the legs between their stops show it: a leg
   * that has left its stop has served its delay and moved for the rest (exact when the motion started from the
   * stop on this selection; after a reversal in mid-transit the delays count as served). 0 with no leg moving.
   */
  private servedTime(): number {
    const cfg = this.cfg;
    const e = this.state.extension;
    const delay = cfg.legDelay ?? NO_DELAY;
    const down = this.state.lever === 'down';
    let t = 0;
    for (let k = 0; k < 3; k++) {
      if (e[k] > 0 && e[k] < 1) t = Math.max(t, delay[k] + (down ? e[k] * cfg.extendTime : (1 - e[k]) * cfg.retractTime));
    }
    return t;
  }

  /** Every leg moves toward down by `step` of its travel. */
  private fall(step: number): void {
    const e = this.state.extension;
    for (let k = 0; k < 3; k++) e[k] = stop(e[k] + step);
  }

  private indicate(): void {
    const s = this.state;
    const e = s.extension;
    const asked = s.lever === 'down' ? 1 : 0;
    for (let k = 0; k < 3; k++) s.locked[k] = e[k] >= 1;
    s.inTransit = e[0] !== asked || e[1] !== asked || e[2] !== asked;
  }
}

function stop(extension: number): number {
  return extension >= 1 - STOP ? 1 : extension <= STOP ? 0 : extension;
}
