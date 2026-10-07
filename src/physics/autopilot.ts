// A simple two-axis autopilot with yaw damper and autothrottle that flies the aircraft only through the
// pilot's ControlInputs (yoke, pedals, throttle, trim wheel), for demo flights and automated tests.
//
// Structure (outer loops set targets for inner loops):
//   heading  --P-->  bank  --PD (roll rate)-->  aileron
//   altitude --P-->  vertical speed  --PI-->  pitch  --PID (pitch rate)-->  yoke  --> trim wheel (auto-trim)
//   airspeed --PI--> pitch (vertical mode 'airspeed', e.g. climbs and glides)
//   airspeed --PI--> throttle (autothrottle, with any other vertical mode)
//   slip ball + yaw rate --PI--> rudder (turn coordinator / yaw damper)
// Gains on the surfaces are scaled with 1 / dynamic pressure so the loops keep their bandwidth from the
// approach to cruise. Integrators are clamped (anti-windup) and are only fed while their output is not
// saturated.

import { C172S_AUTOPILOT } from '../aircraft/c172s/systems';
import type { AutopilotGains } from '../aircraft/types';
import { G0, clamp, wrapPi } from '../core/math';
import type { AircraftState, ControlInputs } from '../core/types';

export type LateralMode = 'off' | 'wingLeveler' | 'heading' | 'bank';
export type VerticalMode = 'off' | 'pitch' | 'verticalSpeed' | 'altitude' | 'airspeed';

export interface AutopilotSettings {
  lateral: LateralMode;
  vertical: VerticalMode;
  /** Target true heading, rad ('heading'). */
  heading: number;
  /** Target bank angle, rad ('bank'); also the bank limit in 'heading' mode. */
  bank: number;
  maxBank: number;
  /** Target altitude MSL, m ('altitude'). */
  altitude: number;
  /** Target vertical speed, m/s ('verticalSpeed'); also the limit of the altitude-capture climb/descent. */
  verticalSpeed: number;
  /** Target pitch attitude, rad ('pitch'). */
  pitch: number;
  /** Target indicated airspeed, m/s ('airspeed' vertical mode or autothrottle). */
  airspeed: number;
  /** Hold the airspeed with the throttle (not in 'airspeed' vertical mode, where pitch does it). */
  autothrottle: boolean;
  /** Keep the ball centred and damp yaw with the rudder. */
  yawDamper: boolean;
  /** Run the trim wheel so the yoke stays near neutral. */
  autoTrim: boolean;
}

// The Cessna 172S's gains (aircraft/c172s/systems.ts, where each is explained) under the names this module has
// always exported.
/** Defaults of the settings: airspeed, m/s; vertical speed, m/s; bank limit, rad. */
export const DEFAULT_AIRSPEED = C172S_AUTOPILOT.defaults.airspeed;
export const DEFAULT_VERTICAL_SPEED = C172S_AUTOPILOT.defaults.verticalSpeed;
export const DEFAULT_MAX_BANK = C172S_AUTOPILOT.defaults.maxBank;

/** Settings with the defaults of a type's gains (by default the C172S's). */
export function defaultAutopilotSettings(gains: AutopilotGains = C172S_AUTOPILOT): AutopilotSettings {
  return {
    lateral: 'wingLeveler',
    vertical: 'altitude',
    heading: 0,
    bank: 0,
    maxBank: gains.defaults.maxBank,
    altitude: 0,
    verticalSpeed: gains.defaults.verticalSpeed,
    pitch: 0,
    airspeed: gains.defaults.airspeed,
    autothrottle: false,
    yawDamper: true,
    autoTrim: true,
  };
}

/** Dynamic pressure at which the surface gains are nominal (about 90 KTAS at sea level), Pa. */
export const Q_REF = C172S_AUTOPILOT.qRef;
export const PITCH_KP = C172S_AUTOPILOT.pitchKp;
export const PITCH_KI = C172S_AUTOPILOT.pitchKi;
export const PITCH_KQ = C172S_AUTOPILOT.pitchKq;
export const ROLL_KP = C172S_AUTOPILOT.rollKp;
export const ROLL_KD = C172S_AUTOPILOT.rollKd;
export const ROLL_KI = C172S_AUTOPILOT.rollKi;
export const HEADING_K = C172S_AUTOPILOT.headingK;
export const ALTITUDE_K = C172S_AUTOPILOT.altitudeK;
export const VS_KP = C172S_AUTOPILOT.vsKp;
export const VS_KI = C172S_AUTOPILOT.vsKi;
export const SPEED_KP = C172S_AUTOPILOT.speedKp;
export const SPEED_KI = C172S_AUTOPILOT.speedKi;
export const THROTTLE_KP = C172S_AUTOPILOT.throttleKp;
export const THROTTLE_KI = C172S_AUTOPILOT.throttleKi;
export const BALL_KP = C172S_AUTOPILOT.ballKp;
export const BALL_KI = C172S_AUTOPILOT.ballKi;
export const YAW_KR = C172S_AUTOPILOT.yawKr;
export const RUDDER_LIMIT = C172S_AUTOPILOT.rudderLimit;
export const TRIM_RATE = C172S_AUTOPILOT.trimRate;
export const PITCH_LIMIT = C172S_AUTOPILOT.pitchLimit;
/** Yoke travel equivalent to one unit of trim wheel (nose-up float over nose-up yoke travel). */
export const TRIM_EQUIVALENCE = C172S_AUTOPILOT.trimEquivalence;

export class Autopilot {
  settings: AutopilotSettings;
  private pitchI = 0;
  private rollI = 0;
  private vsI = 0;
  private speedI = 0;
  private throttleI = 0;
  private ballI = 0;
  private initialised = false;
  private lastVertical: VerticalMode = 'off';
  private lastAutothrottle = false;
  /** The bank and pitch attitude the last update flew toward, rad (NaN while that axis is not held). */
  lastBankTarget = Number.NaN;
  lastPitchTarget = Number.NaN;

  /** `gains`: the type's loop gains, per unit of normalised control (by default the C172S's). */
  constructor(readonly gains: AutopilotGains = C172S_AUTOPILOT) {
    this.settings = defaultAutopilotSettings(gains);
  }

  /** Clear the integrators; the next update starts from the current control positions. */
  reset(): void {
    this.pitchI = this.rollI = this.vsI = this.speedI = this.throttleI = this.ballI = 0;
    this.initialised = false;
  }

  /** Write yoke, aileron, rudder, throttle and trim into `controls` for the current state. */
  update(dt: number, s: AircraftState, controls: ControlInputs): void {
    const st = this.settings;
    const g = this.gains;
    if (!this.initialised) {
      // Bumpless engagement: the integrators start at the current control positions.
      this.pitchI = controls.elevator;
      this.rollI = 0;
      this.throttleI = controls.throttle;
      this.ballI = controls.rudder;
      this.vsI = s.pitch;
      this.speedI = s.pitch;
      this.lastVertical = st.vertical;
      this.lastAutothrottle = st.autothrottle;
      this.initialised = true;
    }
    // Mode changes are bumpless too: a newly engaged loop starts from the present attitude or throttle.
    if (st.vertical !== this.lastVertical) {
      this.vsI = this.speedI = s.pitch;
      this.lastVertical = st.vertical;
    }
    if (st.autothrottle && !this.lastAutothrottle) this.throttleI = controls.throttle;
    this.lastAutothrottle = st.autothrottle;
    const qScale = clamp(g.qRef / Math.max(0.5 * s.airDensity * s.tas * s.tas, 200), 0.3, 3);
    const p = s.angularVelocity.x;
    const q = s.angularVelocity.y;
    const r = s.angularVelocity.z;

    // --- Lateral ---
    if (st.lateral !== 'off') {
      let bankTarget = 0;
      if (st.lateral === 'heading') bankTarget = clamp(g.headingK * wrapPi(st.heading - s.heading), -st.maxBank, st.maxBank);
      else if (st.lateral === 'bank') bankTarget = clamp(st.bank, -st.maxBank, st.maxBank);
      this.lastBankTarget = bankTarget;
      const e = bankTarget - s.roll;
      const cmd = qScale * (g.rollKp * e - g.rollKd * p) + this.rollI;
      if (Math.abs(cmd) < 1) this.rollI = clamp(this.rollI + qScale * g.rollKi * e * dt, -0.3, 0.3);
      controls.aileron = clamp(cmd, -1, 1);
    } else this.lastBankTarget = Number.NaN;
    if (st.yawDamper) {
      const turnRate = s.tas > 10 ? (G0 * Math.tan(s.roll)) / s.tas : 0;
      const coordinatedR = turnRate * Math.cos(s.roll) * Math.cos(s.pitch);
      // The ball loop's gain grows less at low dynamic pressure than the other loops': near the stall the rudder,
      // in the slipstream, keeps its authority while the ball swings with every wing drop, and a 3x gain there
      // fed the wing rock instead of damping it.
      const yawScale = Math.min(qScale, 1.5);
      const cmd = yawScale * (g.ballKp * s.slipBall - g.yawKr * (r - coordinatedR)) + this.ballI;
      if (Math.abs(cmd) < 1) this.ballI = clamp(this.ballI + yawScale * g.ballKi * s.slipBall * dt, -g.rudderLimit, g.rudderLimit);
      controls.rudder = clamp(cmd, -1, 1);
    }

    // --- Longitudinal ---
    let pitchTarget: number | null = null;
    if (st.vertical === 'pitch') pitchTarget = st.pitch;
    else if (st.vertical === 'altitude' || st.vertical === 'verticalSpeed') {
      const limit = Math.abs(st.verticalSpeed);
      const vsTarget =
        st.vertical === 'altitude' ? clamp(g.altitudeK * (st.altitude - s.altitudeMSL), -limit, limit) : st.verticalSpeed;
      const e = vsTarget - s.verticalSpeed;
      this.vsI = clamp(this.vsI + g.vsKi * e * dt, -g.pitchLimit, g.pitchLimit);
      pitchTarget = g.vsKp * e + this.vsI;
    } else if (st.vertical === 'airspeed') {
      const e = s.ias - st.airspeed;
      this.speedI = clamp(this.speedI + g.speedKi * e * dt, -g.pitchLimit, g.pitchLimit);
      pitchTarget = g.speedKp * e + this.speedI;
    }
    this.lastPitchTarget = pitchTarget === null ? Number.NaN : clamp(pitchTarget, -g.pitchLimit, g.pitchLimit);
    if (pitchTarget !== null) {
      const e = clamp(pitchTarget, -g.pitchLimit, g.pitchLimit) - s.pitch;
      // Keep the pitch loop's own turn compensation: in a bank the aircraft pitches at q = g tan(phi) sin(phi) / V.
      const turnQ = s.tas > 10 ? (G0 * Math.sin(s.roll) * Math.tan(s.roll)) / s.tas : 0;
      const cmd = qScale * (g.pitchKp * e - g.pitchKq * (q - turnQ)) + this.pitchI;
      if (Math.abs(cmd) < 1) this.pitchI = clamp(this.pitchI + qScale * g.pitchKi * e * dt, -1, 1);
      controls.elevator = clamp(cmd, -1, 1);
      if (st.autoTrim) {
        // The trim servo runs toward the held yoke force; the pitch integrator gives back what trim takes.
        const move = clamp(controls.elevator, -1, 1) * g.trimRate * dt;
        const next = clamp(controls.elevatorTrim + move, -1, 1);
        this.pitchI -= (next - controls.elevatorTrim) * g.trimEquivalence;
        controls.elevatorTrim = next;
      }
    }

    if (st.autothrottle && st.vertical !== 'airspeed') {
      const e = st.airspeed - s.ias;
      const cmd = g.throttleKp * e + this.throttleI;
      if (cmd > 0 && cmd < 1) this.throttleI = clamp(this.throttleI + g.throttleKi * e * dt, 0, 1);
      controls.throttle = clamp(cmd, 0, 1);
    }
  }
}
