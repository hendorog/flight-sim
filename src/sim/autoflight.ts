// "Flies itself": the physics Autopilot plus a little scripted pilot for the phases a two-axis autopilot
// cannot do (take-off roll and rotation, flare, roll-out). Works only through ControlInputs, like a pilot.
// Used by the ap=1 URL parameter, the A key and the integration tests.
//
//   takeoff   full power, centreline on the rudder, rotate at 55 KIAS, Vy climb on the runway heading,
//             level off at the plan's altitude and hold the cruise speed with the throttle
//   hold      heading + altitude hold, speed on the throttle (scenario demos); engaged by the pilot (A key)
//             it is a KAP 140-style HDG + ALT autopilot: it flies the heading bug, holds the altitude
//             (adjustable), and leaves the throttle to the pilot
//   approach  track the runway 07 centreline down the 3 degree path at the plan's speed, flare, land,
//             brake to a stop on the centreline, then set the parking brake
//   parked    nothing (brakes stay as they are)

import { DEG, FT, KT, clamp, wrapPi } from '../core/math';
import { clearEngineControl, applyControls, type AircraftState, type ControlInputs } from '../core/types';
import { AIRPORT, runwayCoords } from '../core/world';
import { C172S_GEOMETRY } from '../aircraft/c172s/geometry';
import { C172S_REFERENCE } from '../aircraft/c172s/reference';
import { C172S_SIM } from '../aircraft/c172s/sim';
import { C172S_AUTOPILOT, C172S_CONTROLS } from '../aircraft/c172s/systems';
import type { AutoflightPhaseId, AutoflightProfile, AutopilotGains, ControlSystemDef, ReferenceSpeeds } from '../aircraft/types';
// Not from the '../physics' barrel: the barrel carries the flight model, which a node test of the scripted pilot
// alone does not need.
import { Autopilot } from '../physics/autopilot';
import type { AutoflightSnapshot } from './resume';
import { AIM_POINT, GLIDE_PATH, flapLever, type AutoflightPlan } from './scenarios';

const RWY = AIRPORT.runway;
const HALF_LENGTH = RWY.length / 2;
/** Time constant of the drift-angle filter, s. */
const DRIFT_TAU = 3;

/** What the scripted pilot needs of the aircraft besides its profile: the autopilot gains and the flap detents. */
export interface AutoflightAircraft {
  gains: AutopilotGains;
  flaps: Pick<ControlSystemDef['flaps'], 'maxDeflection' | 'detents'>;
}
const C172S_AUTOFLIGHT_AIRCRAFT: AutoflightAircraft = { gains: C172S_AUTOPILOT, flaps: C172S_CONTROLS.flaps };

// The scripted pilot's numbers for the Cessna 172S, as they were named before they moved to C172S_SIM.autoflight.
const A = C172S_SIM.autoflight;
/** Flap lever for the take-off (0 = up). */
export const TAKEOFF_FLAPS = flapLever(C172S_CONTROLS.flaps, A.takeoff.flapsDeg);
/** Rotation speed, KIAS (POH). */
export const ROTATE_KIAS = A.takeoff.rotateKias;
/** Pitch attitude held from the rotation speed, degrees, and its rise over the next ROTATE_BLEND_KT knots. */
export const ROTATE_PITCH_DEG = A.takeoff.rotatePitchDeg[0];
export const ROTATE_PITCH_RISE_DEG = A.takeoff.rotatePitchDeg[1] - A.takeoff.rotatePitchDeg[0];
export const ROTATE_BLEND_KT = A.takeoff.rotateBlendKt;
/** Rotation law: elevator per rad of pitch error, per rad/s of pitch rate, and the steady pull. */
export const ROTATE_PITCH_GAIN = A.takeoff.pitchGain;
export const ROTATE_PITCH_RATE_GAIN = A.takeoff.pitchRateGain;
export const ROTATE_ELEVATOR_BIAS = A.takeoff.elevatorBias;
/** Speed above which the ailerons hold the wings level in the take-off roll, KIAS. */
export const AILERON_ALIVE_KIAS = A.takeoff.aileronAliveKias;
/** Height above the rest height at which the autopilot takes over after lift-off, m. */
export const HANDOVER_HEIGHT = A.takeoff.handoverM;
/** Climb speed, KIAS (Vy), and the vertical-speed limit of the level-off at the plan's altitude, m/s. */
export const CLIMB_KIAS = A.climb.kias;
export const CLIMB_VS_LIMIT = A.climb.vsLimit;
/** Hold: lowest speed the A key holds, KIAS; bank limit, degrees; vertical-speed limit of the altitude capture, m/s. */
export const HOLD_MIN_KIAS = A.hold.minKias;
export const HOLD_MAX_BANK_DEG = A.hold.maxBankDeg;
export const HOLD_VS_LIMIT = A.hold.vsLimit;
/** The flare begins FLARE_TIME seconds above the ground at the present sink rate, and not below FLARE_MIN_HEIGHT, m. */
export const FLARE_MIN_HEIGHT = A.flare.minHeightM;
export const FLARE_TIME = A.flare.timeS;
/** Touchdown attitude: the pitch at the start of the flare plus this rise, limited to the maximum, degrees. */
export const FLARE_PITCH_RISE_DEG = A.flare.pitchRiseDeg;
export const FLARE_MAX_PITCH_DEG = A.flare.maxPitchDeg;
/** Roll-out: brake pressure, and the nose-holding elevator (0 at ROLLOUT_NOSE_HOLD_KIAS, rising over ROLLOUT_NOSE_HOLD_RANGE_KT knots, limited to the maximum). */
export const ROLLOUT_BRAKE = A.rollout.brake;
export const ROLLOUT_NOSE_HOLD_KIAS = A.rollout.noseHoldKias[0];
export const ROLLOUT_NOSE_HOLD_RANGE_KT = A.rollout.noseHoldKias[1] - A.rollout.noseHoldKias[0];
export const ROLLOUT_NOSE_HOLD_MAX = A.rollout.noseHoldMax;
/** Centreline law on the ground: rudder per rad of heading error, per rad/s of yaw rate, and the look-ahead distance, m. */
export const CENTRELINE_HEADING_GAIN = A.centreline.headingGain;
export const CENTRELINE_YAW_RATE_GAIN = A.centreline.yawRateGain;
export const CENTRELINE_LOOK_AHEAD = A.centreline.lookAheadM;

const wrapDeg = (d: number): number => ((d % 360) + 360) % 360;

export type AutoflightPhase = 'off' | 'roll' | 'climb' | 'cruise' | 'hold' | 'approach' | 'flare' | 'rollout' | 'stopped' | 'parked';

/**
 * Heading converging onto a line parallel to the runway, `offset` m to its right, flown on `course`.
 * Exported for the Flight School copilot's ground recovery (src/training/copilot); behaviour unchanged.
 */
export function trackHeading(s: AircraftState, course: number, offset = 0): number {
  const c = runwayCoords(s.position.x, s.position.y);
  const along = Math.cos(course - RWY.heading) > 0 ? 1 : -1;
  return course - Math.atan2((c.across - offset) * along, 250) * 0.8;
}

/**
 * Rudder (and nosewheel) command holding the runway centreline on the ground, by the centreline law of a
 * profile (default the Cessna 172S's). Exported like trackHeading.
 */
export function centrelineRudder(s: AircraftState, course: number, law: AutoflightProfile['centreline'] = A.centreline): number {
  const c = runwayCoords(s.position.x, s.position.y);
  const along = Math.cos(course - RWY.heading) > 0 ? 1 : -1;
  const desired = course - Math.atan2(c.across * along, law.lookAheadM);
  return clamp(law.headingGain * wrapPi(desired - s.heading) - law.yawRateGain * s.angularVelocity.z, -1, 1);
}

/** Every engine's throttle (power lever) to `v`: the scalar, with any per-engine position given up. */
function setAllThrottles(c: ControlInputs, v: number): void {
  c.throttle = v;
  for (let i = 0; i < c.engines.length; i++) if (c.engines[i].throttle !== undefined) clearEngineControl(c, 'throttle', i);
}

export class Autoflight {
  readonly autopilot: Autopilot;
  plan: AutoflightPlan | null = null;
  phase: AutoflightPhase = 'off';
  private flareStartPitch = NaN;
  private flareHeight = NaN;
  /** Highest indicated airspeed reached in the take-off roll, kt (sets the rotation attitude). */
  private rollKiasMax = 0;
  /**
   * Low-passed drift angle (heading minus ground track), rad: the wind-correction angle. Added to the
   * centreline-tracking heading so a crosswind does not leave a steady offset (6 kt across gave ~15 m, the
   * runway half-width, without it).
   */
  private drift = 0;
  /**
   * Heading-indicator card minus true heading, rad (the DG's drift and misalignment). Set by the shell from
   * the panel each frame: the heading bug is a mark on the DG card, so HDG mode flies bug - dgOffset.
   */
  dgOffset = 0;
  /** Flap lever of the take-off. */
  private readonly takeoffFlaps: number;

  /**
   * The scripted pilot of one type: its profile (speeds, laws, ground steering, the controls set as each phase
   * begins), its reference speeds, the height of the reference point above the ground on the wheels, m, and its
   * autopilot gains and flap detents. Every default is the Cessna 172S's.
   */
  constructor(
    readonly profile: AutoflightProfile = C172S_SIM.autoflight,
    readonly reference: ReferenceSpeeds = C172S_REFERENCE,
    readonly restHeight: number = C172S_GEOMETRY.restHeight,
    aircraft: AutoflightAircraft = C172S_AUTOFLIGHT_AIRCRAFT,
  ) {
    this.autopilot = new Autopilot(aircraft.gains);
    this.takeoffFlaps = flapLever(aircraft.flaps, profile.takeoff.flapsDeg);
  }

  get engaged(): boolean {
    return this.phase !== 'off';
  }

  /** Engage with a plan; the first update starts from the current controls (bumpless). */
  engage(plan: AutoflightPlan, s: AircraftState, c: ControlInputs): void {
    this.plan = plan;
    this.autopilot.reset();
    this.flareStartPitch = this.flareHeight = NaN;
    this.rollKiasMax = 0;
    this.drift = s.onGround || s.groundSpeed < 15 ? 0 : wrapPi(s.heading - s.track);
    const ap = this.autopilot;
    ap.settings = { ...ap.settings, yawDamper: true, autoTrim: true, maxBank: this.profile.hold.maxBankDeg * DEG };
    switch (plan.kind) {
      case 'parked':
        this.phase = 'parked';
        break;
      case 'takeoff':
        if (s.onGround) {
          this.phase = 'roll';
          c.parkingBrake = false;
          c.brakeLeft = c.brakeRight = 0;
          c.mixture = 1;
          c.flaps = this.takeoffFlaps;
          this.phaseControls('takeoff', c);
        } else this.enterCruise(plan.heading, plan.climbTo, plan.cruiseKias, s, c);
        break;
      case 'hold':
        this.enterHold(plan.heading, plan.altitude, plan.kias, plan.autothrottle ?? true);
        break;
      case 'approach':
        this.phase = 'approach';
        ap.settings = { ...ap.settings, lateral: 'heading', heading: RWY.heading, vertical: 'verticalSpeed', verticalSpeed: s.verticalSpeed, autothrottle: true, airspeed: plan.kias * KT };
        this.phaseControls('approach', c);
        break;
    }
  }

  /**
   * Engage holding what the aircraft is doing now (the A key), like the KAP 140's HDG mode synchronised to
   * the current heading: the heading, not the ground track, so a crabbing aircraft keeps its crab instead of
   * yawing by the drift angle on engagement.
   */
  engageHere(s: AircraftState, c: ControlInputs): void {
    if (s.onGround) {
      this.engage({ kind: 'parked' }, s, c);
      return;
    }
    // HDG mode synchronised: the bug is set under the card's present heading, so nothing turns on engagement.
    c.headingBugDeg = wrapDeg((s.heading + this.dgOffset) / DEG);
    // Round the held altitude to the nearest 10 ft as the KAP 140 display does.
    const altitude = Math.round(s.altitudeMSL / (10 * FT)) * 10 * FT;
    this.engage({ kind: 'hold', heading: s.heading, altitude, kias: Math.max(this.profile.hold.minKias, s.ias / KT), followBug: true, autothrottle: false }, s, c);
  }

  /** Target altitude of the altitude hold, m MSL (NaN when not holding one). */
  get targetAltitude(): number {
    return this.phase === 'hold' && this.autopilot.settings.vertical === 'altitude' ? this.autopilot.settings.altitude : NaN;
  }

  /** Move the held altitude by `deltaM` (the KAP 140's ALT knob); returns the new target, NaN if not holding. */
  adjustAltitude(deltaM: number): number {
    if (Number.isNaN(this.targetAltitude)) return NaN;
    const ap = this.autopilot.settings;
    ap.altitude = Math.max(AIRPORT.elevation + 150, ap.altitude + deltaM);
    return ap.altitude;
  }

  /** Everything needed to continue exactly where it was (resume on reload, see resume.ts); null when off. */
  exportState(): AutoflightSnapshot | null {
    if (!this.engaged) return null;
    // The physics autopilot keeps its integrators private and has no accessor: copy its plain-data fields
    // by name (whatever is not found starts bumpless on the first update, as on any engagement).
    const integrators: Record<string, number | boolean | string> = {};
    for (const [k, v] of Object.entries(this.autopilot as unknown as Record<string, unknown>)) {
      if (k !== 'settings' && (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string')) integrators[k] = v;
    }
    return {
      phase: this.phase,
      plan: this.plan ? JSON.parse(JSON.stringify(this.plan)) : null,
      settings: { ...this.autopilot.settings },
      drift: this.drift,
      dgOffset: this.dgOffset,
      flareStartPitch: Number.isNaN(this.flareStartPitch) ? null : this.flareStartPitch,
      flareHeight: Number.isNaN(this.flareHeight) ? null : this.flareHeight,
      integrators,
    };
  }

  /** Continue from exportState() (null: disengaged). */
  importState(st: AutoflightSnapshot | null): void {
    this.disengage();
    if (!st || st.phase === 'off' || !st.plan) return;
    this.plan = st.plan;
    this.phase = st.phase;
    this.autopilot.settings = { ...this.autopilot.settings, ...st.settings };
    this.drift = Number.isFinite(st.drift) ? st.drift : 0;
    this.dgOffset = Number.isFinite(st.dgOffset) ? st.dgOffset : 0;
    this.flareStartPitch = st.flareStartPitch ?? NaN;
    this.flareHeight = st.flareHeight ?? NaN;
    const ap = this.autopilot as unknown as Record<string, unknown>;
    for (const [k, v] of Object.entries(st.integrators ?? {})) {
      if (k in ap && typeof ap[k] === typeof v && (typeof v !== 'number' || Number.isFinite(v))) ap[k] = v;
    }
  }

  disengage(): void {
    this.phase = 'off';
    this.plan = null;
    this.autopilot.reset();
  }

  /** The controls the profile sets as a phase begins (gear, propeller levers, carburettor heat, pumps, cowl flaps). */
  private phaseControls(phase: AutoflightPhaseId, c: ControlInputs): void {
    const patch = this.profile.phaseControls[phase];
    if (patch) applyControls(c, patch);
  }

  private enterHold(heading: number, altitude: number, kias: number, autothrottle = true): void {
    this.phase = 'hold';
    const ap = this.autopilot;
    ap.settings = { ...ap.settings, lateral: 'heading', heading, vertical: 'altitude', altitude, verticalSpeed: this.profile.hold.vsLimit, autothrottle, airspeed: kias * KT };
  }

  private enterCruise(heading: number, altitude: number, kias: number, s: AircraftState, c: ControlInputs): void {
    this.phase = s.altitudeMSL < altitude - 30 ? 'climb' : 'cruise';
    const ap = this.autopilot;
    const climb = this.profile.climb;
    if (this.phase === 'climb') ap.settings = { ...ap.settings, lateral: 'heading', heading, vertical: 'airspeed', airspeed: climb.kias * KT, autothrottle: false };
    else ap.settings = { ...ap.settings, lateral: 'heading', heading, vertical: 'altitude', altitude, verticalSpeed: climb.vsLimit, autothrottle: true, airspeed: kias * KT };
    this.phaseControls(this.phase, c);
  }

  /**
   * Ground steering of a type whose nosewheel castors: the rudder command (already in c.rudder) is also put on
   * the brakes below the speed where the rudder steers, fading in as the rudder loses authority, (1 - (V /
   * Veff)^2). The brake on the inside of the turn is added to `base` (the symmetric braking) and the outside one
   * released by the same fraction of it, so the correction keeps its authority under full braking.
   */
  private differentialBrake(c: ControlInputs, s: AircraftState, base: number): void {
    const st = this.profile.steering;
    if (st.kind !== 'differentialBrake') return;
    const v = s.ias / KT / st.rudderEffectiveKias;
    const d = v < 1 ? c.rudder * st.brakeGain * (1 - v * v) : 0;
    c.brakeLeft = clamp(base + Math.max(0, -d) - Math.max(0, d) * base, 0, 1);
    c.brakeRight = clamp(base + Math.max(0, d) - Math.max(0, -d) * base, 0, 1);
  }

  /**
   * Climb-out heading: along the extended centreline of the runway taken off from (with the wind-correction
   * angle), as a pilot flies the departure leg; the plain heading when it is not the runway's.
   */
  private climbOutHeading(s: AircraftState, heading: number): number {
    if (Math.abs(Math.sin(heading - RWY.heading)) > 0.1) return heading;
    return trackHeading(s, heading) + this.drift;
  }

  /** Run one control step (call before every physics step with its dt). */
  update(dt: number, s: AircraftState, c: ControlInputs): void {
    const plan = this.plan;
    if (!plan || this.phase === 'off' || this.phase === 'parked' || s.crashed) return;
    const ap = this.autopilot;
    const p = this.profile;
    if (!s.onGround && s.groundSpeed > 15) this.drift += (wrapPi(s.heading - s.track) - this.drift) * Math.min(1, dt / DRIFT_TAU);
    switch (this.phase) {
      case 'roll': {
        if (plan.kind !== 'takeoff') return;
        const t = p.takeoff;
        setAllThrottles(c, 1);
        const kias = s.ias / KT;
        // Lift the nose wheel at the rotation speed (C172S: 55 KIAS, POH) and let the aircraft fly itself off: the
        // attitude comes up from 4 deg as the speed builds, to 8 deg by 61 KIAS, so the lift-off is at ~58-60 KIAS
        // with a margin over the gusts. Pulling straight to 8 deg at 55 lifted off at ~56 KIAS, and a gust's 3 kt
        // then set the wheels back down.
        this.rollKiasMax = Math.max(this.rollKiasMax, kias);
        const rotatePitch = (t.rotatePitchDeg[0] + (t.rotatePitchDeg[1] - t.rotatePitchDeg[0]) * clamp((this.rollKiasMax - t.rotateKias) / t.rotateBlendKt, 0, 1)) * DEG;
        c.elevator = this.rollKiasMax > t.rotateKias ? clamp(t.pitchGain * (rotatePitch - s.pitch) - t.pitchRateGain * s.angularVelocity.y + t.elevatorBias, -1, 1) : 0;
        const airborne = !s.wheels[0].onGround && !s.wheels[1].onGround && !s.wheels[2].onGround;
        if (!airborne) {
          // On the wheels: centreline on the rudder and nosewheel (a castering type: and the brakes); once the
          // ailerons bite, wings level (a pilot's aileron into the crosswind, and the roll the propeller swirl
          // puts in at lift-off).
          c.rudder = centrelineRudder(s, plan.heading, p.centreline);
          this.differentialBrake(c, s, 0);
          c.aileron = kias > t.aileronAliveKias ? clamp(-2 * s.roll - 0.3 * s.angularVelocity.x, -1, 1) : 0;
          this.autopilot.reset();
        } else {
          // Lift-off: the pilot's hands stay on the pitch (elevator above), the lateral axis flies the
          // extended centreline, crabbed into the wind, with the ball centred (the climb needs right rudder
          // for the propeller's yaw). The autopilot's lateral loops start from the present rudder.
          ap.settings.lateral = 'heading';
          ap.settings.heading = this.climbOutHeading(s, plan.heading);
          ap.settings.vertical = 'off';
          ap.settings.autothrottle = false;
          ap.update(dt, s, c);
        }
        if (s.altitudeAGL > this.restHeight + t.handoverM) {
          // Hand over with the rudder where it is: the yaw damper's integrator restarts from it.
          this.autopilot.reset();
          this.enterCruise(plan.heading, plan.climbTo, plan.cruiseKias, s, c);
        }
        return;
      }
      case 'climb':
        if (plan.kind === 'takeoff') {
          setAllThrottles(c, p.climb.throttle ?? 1);
          ap.settings.heading = this.climbOutHeading(s, plan.heading);
          if (s.altitudeMSL > plan.climbTo - 30) this.enterCruise(plan.heading, plan.climbTo, plan.cruiseKias, s, c);
        }
        break;
      case 'hold':
        if (plan.kind === 'hold' && plan.followBug) ap.settings.heading = wrapPi(c.headingBugDeg * DEG - this.dgOffset);
        break;
      case 'approach': {
        if (plan.kind !== 'approach') return;
        const rc = runwayCoords(s.position.x, s.position.y);
        const agl = s.altitudeMSL - AIRPORT.elevation - this.restHeight;
        ap.settings.heading = trackHeading(s, RWY.heading) + this.drift;
        const toAim = -HALF_LENGTH + AIM_POINT - rc.along;
        const pathHeight = Math.max(toAim, 0) * Math.tan(GLIDE_PATH);
        ap.settings.vertical = 'verticalSpeed';
        ap.settings.verticalSpeed = -s.groundSpeed * Math.tan(GLIDE_PATH) + 0.1 * (pathHeight - agl);
        if (agl < Math.max(p.flare.minHeightM, -p.flare.timeS * s.verticalSpeed)) {
          ap.settings.autothrottle = false;
          this.phase = 'flare';
        }
        break;
      }
      case 'flare': {
        const f = p.flare;
        const agl = s.altitudeMSL - AIRPORT.elevation - this.restHeight;
        setAllThrottles(c, 0);
        if (Number.isNaN(this.flareStartPitch)) {
          this.flareStartPitch = s.pitch;
          this.flareHeight = Math.max(f.minHeightM, -f.timeS * s.verticalSpeed, agl);
        }
        const touchdownPitch = Math.min(this.flareStartPitch + f.pitchRiseDeg * DEG, f.maxPitchDeg * DEG);
        ap.settings.heading = trackHeading(s, RWY.heading) + this.drift;
        ap.settings.vertical = 'pitch';
        ap.settings.pitch = this.flareStartPitch + (touchdownPitch - this.flareStartPitch) * clamp(1 - agl / this.flareHeight, 0, 1);
        if (s.wheels[1].onGround || s.wheels[2].onGround) {
          this.phase = 'rollout';
          this.phaseControls('rollout', c);
        }
        break;
      }
      case 'rollout': {
        const r = p.rollout;
        setAllThrottles(c, 0);
        // Hold the nosewheel off and let it down as the elevator loses authority (not dropped at once).
        c.elevator = clamp((s.ias / KT - r.noseHoldKias[0]) / (r.noseHoldKias[1] - r.noseHoldKias[0]), 0, r.noseHoldMax);
        c.aileron = 0;
        c.flaps = 0;
        c.rudder = centrelineRudder(s, RWY.heading, p.centreline);
        c.brakeLeft = c.brakeRight = s.groundSpeed > 1 ? r.brake : 1;
        this.differentialBrake(c, s, c.brakeLeft);
        if (s.groundSpeed < 0.3) {
          this.phase = 'stopped';
          c.parkingBrake = true;
          c.brakeLeft = c.brakeRight = 0;
          c.rudder = 0;
        }
        return;
      }
      case 'stopped':
        return;
    }
    ap.update(dt, s, c);
  }
}
