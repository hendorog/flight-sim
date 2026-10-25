import { clamp, DEG, G0, KT, interp1, wrapPi } from '../../core/math';
import type { AircraftState, ControlInputs } from '../../core/types';
import type { RotorcraftDefinition } from '../../physics/rotorcraft/definition';
import type { AutopilotSettings } from '../../physics/autopilot';
import { ScriptedPilot, observePilot, type PilotObservation } from './scriptedPilot';
import type { HeliHoldTuning } from '../../aircraft/types';

export type { HeliHoldGains, HeliHoldTuning } from '../../aircraft/types';
import { OnlinePencil } from '../../physics/identification/onlinePencil';

/** Experimental control-only helicopter hold. Never writes flight-model state.
 * The proven demo attitude loops form the baseline; position capture adds a slow
 * velocity demand at hover. Collective handles height, cyclic handles speed/drift,
 * pedals handle heading. Throttle/governor remain with the pilot/aircraft systems.
 */
export class HelicopterAutopilot {
  private pilot: ScriptedPilot | null = null;
  private north = 0;
  private east = 0;
  private hovering = false;
  reason = '';
  readonly rollModel = new OnlinePencil();
  readonly pitchModel = new OnlinePencil();
  adaptive = false;
  engagementSpeed = 0;
  /**
   * Engaged slower than `belowKt` of ground speed, the held speed runs down to a hover at `ktPerS` (the hold then
   * captures the position as it does when engaged nearly stopped). Null: the engagement speed is held. Set by the shell
   * from SimProfile.heliHoldSlowToHover (the Bo 105); null on every other type.
   */
  slowToHover: { belowKt: number; ktPerS: number } | null = null;
  /**
   * Engaged moving forward, the held speed is the speed over the ground (s.groundSpeed), not its component along the nose:
   * the hold then turns the side speed into forward speed instead of dropping it. Set by the shell from
   * SimProfile.heliHoldGroundSpeed (the Bo 105); false on every other type.
   */
  groundSpeedTarget = false;
  /** The type's opt-in laws (SimProfile.heliHold, set by the shell); null on every type but the AH-56A. */
  tuning: HeliHoldTuning | null = null;
  /** Tuned path state: the held speed walking to st.airspeed (m/s, in its measure), the climb-rate demand (m/s), the bank
   *  demand (rad), coordinated turns on, the hover capture's ground velocity demand (m/s north, east; null: not running), the
   *  low-passed cyclic of the trim follow-up, the pusher lever written, the first step after engagement. */
  private speedCmd = 0;
  private vsCmd = 0;
  private bankCmd = 0;
  private bankTrim = 0;
  private turning = false;
  private capture: { vn: number; ve: number } | null = null;
  private stickLp = { pitch: 0, roll: 0 };
  private rudLp = 0;
  private pedalCentre = 0;
  private prop = NaN;
  private first = false;
  /** Engaged in a bank with coordinated turns: the heading bug follows the nose until the wings are level. */
  private syncBug = false;
  /** The held speed is running down to the hover (slowToHover), and the value it last wrote, m/s. */
  private slowing = false;
  private slowedTo = 0;
  get status(): string { return `roll: ${this.rollModel.status} (${this.rollModel.scale.toFixed(2)}×), pitch: ${this.pitchModel.status} (${this.pitchModel.scale.toFixed(2)}×)`; }
  constructor(readonly definition: RotorcraftDefinition) {}
  reset(): void { this.pilot = null; this.reason = ''; this.rollModel.reset(); this.pitchModel.reset(); }
  engage(s: AircraftState, c: ControlInputs): boolean {
    this.reset();
    if (s.onGround || s.crashed || !anyEngineRunning(s) || !s.rotorcraft ||
        s.rotorcraft.rotorRpm / this.definition.referenceRpm < 0.9 || s.altitudeAGL < 2) {
      this.reason = 'Hold requires airborne flight, running engine and normal rotor RPM';
      return false;
    }
    const observation = observePilot(s, this.definition);
    this.engagementSpeed = observation.forwardSpeed;
    if (this.groundSpeedTarget && observation.forwardSpeed > 0) this.engagementSpeed = Math.max(observation.forwardSpeed, s.groundSpeed);
    this.pilot = new ScriptedPilot(observation, c);
    this.pilot.heading = s.heading;
    this.north = s.position.x; this.east = s.position.y;
    this.hovering = s.groundSpeed < 3;
    this.slowing = !!this.slowToHover && !this.hovering && s.groundSpeed < this.slowToHover.belowKt * KT;
    this.slowedTo = Infinity;
    const t = this.tuning;
    if (t) {
      // The held speed in its measure: the IAS above airspeedAboveKias, else the forward ground speed (as shared).
      if (t.airspeedAboveKias !== undefined && s.ias > t.airspeedAboveKias*KT) this.engagementSpeed = s.ias;
      this.speedCmd = Math.max(0, this.engagementSpeed);
      if (s.groundSpeed < 3 || s.ias < 3*KT) this.speedCmd = 0;
      this.vsCmd = s.verticalSpeed;
      this.bankCmd = s.roll;
      this.turning = !!t.turns && s.ias >= t.turns.onKias*KT && this.speedCmd >= 3*KT;
      this.syncBug = this.turning && Math.abs(s.roll) > 5*DEG;
      this.bankTrim = this.syncBug ? 0 : clamp(s.roll, -5*DEG, 5*DEG);
      // Drifting into the hover hold: stop first, then hold the point where it stopped.
      this.capture = t.hoverCapture && this.speedCmd === 0 && s.groundSpeed > t.hoverCapture.minMs ? { vn: s.velocity.x, ve: s.velocity.y } : null;
      this.stickLp = { pitch: c.elevator, roll: c.aileron };
      this.rudLp = this.pedalCentre = c.rudder;
      this.prop = c.propLever ?? NaN;
      this.first = true;
    }
    return true;
  }
  update(dt: number, s: AircraftState, c: ControlInputs, st: AutopilotSettings): boolean {
    if (!this.pilot || !Number.isFinite(dt) || dt <= 0) return false;
    const o = observePilot(s, this.definition);
    if (s.crashed || s.onGround || !anyEngineRunning(s) || o.rotorPercent < 85 || o.rotorPercent > 115 ||
        Math.abs(s.roll) > 45*DEG || Math.abs(s.pitch) > 40*DEG ||
        ![s.roll, s.pitch, s.heading, s.altitudeMSL, s.verticalSpeed].every(Number.isFinite)) {
      this.reason = 'Helicopter hold disconnected: flight envelope or rotor RPM'; return false;
    }
    // Slowing to the hover: the held speed runs down (a speed set from elsewhere, e.g. the dev panel, ends it).
    if (this.slowing) {
      if (st.airspeed > this.slowedTo + 1e-9) this.slowing = false;
      else st.airspeed = this.slowedTo = Math.max(0, st.airspeed - this.slowToHover!.ktPerS * KT * dt);
    }
    const t = this.tuning;
    let forward: number, vs: number;
    if (t) ({ forward, vs } = this.outer(t, dt, s, st, o));
    else {
      const hover = st.airspeed < 3*KT;
      if (hover && !this.hovering) { this.north = s.position.x; this.east = s.position.y; }
      this.hovering = hover;
      forward = st.airspeed; let side = 0;
      if (hover) {
        const vn = clamp(0.12*(this.north-s.position.x), -2, 2);
        const ve = clamp(0.12*(this.east-s.position.y), -2, 2);
        forward = vn*Math.cos(s.heading) + ve*Math.sin(s.heading);
        side = -vn*Math.sin(s.heading) + ve*Math.cos(s.heading);
      }
      o.sideSpeed -= side;
      vs = clamp(0.3*(st.altitude-s.altitudeMSL), -1.5, 1.5);
    }
    this.rollModel.enabled = this.pitchModel.enabled = this.adaptive;
    this.rollModel.update(dt, s.angularVelocity.x, c.aileron);
    this.pitchModel.update(dt, s.angularVelocity.y, c.elevator);
    this.pilot.rollGain = 4*this.rollModel.scale; this.pilot.rollDamping = 1.5*this.rollModel.scale;
    this.pilot.pitchGain = 4*this.pitchModel.scale; this.pilot.pitchDamping = 1.5*this.pitchModel.scale;
    const inner = this.tuning?.inner?.[s.rotorcraft?.controlGyro?.mode ?? 'amcs'];
    if (inner) {
      const p = this.pilot, rs = this.rollModel.scale, ps = this.pitchModel.scale;
      p.rollGain = inner.rollGain*rs; p.rollDamping = inner.rollDamping*rs; p.rollLearning = inner.rollLearning;
      p.pitchGain = inner.pitchGain*ps; p.pitchDamping = inner.pitchDamping*ps; p.pitchLearning = inner.pitchLearning;
      p.cyclicRate = p.aileronRate = inner.cyclicRate;
    }
    if (!t?.turns || !this.turning) this.pilot.heading += clamp(wrapPi(st.heading-this.pilot.heading), -8*DEG*dt, 8*DEG*dt);
    else this.coordinate(t.turns, dt, s, c, st, o);
    const old = { pitch: this.pilot.pitchI, roll: this.pilot.rollI, yaw: this.pilot.yawI, lift: this.pilot.liftI };
    this.pilot.step(dt, o, c, forward/KT, vs);
    // Prevent the inner integrators from winding farther into actuator saturation.
    if (Math.abs(c.elevator) > 0.98 && c.elevator*(this.pilot.pitchI-old.pitch) > 0) this.pilot.pitchI = old.pitch;
    if (Math.abs(c.aileron) > 0.98 && c.aileron*(this.pilot.rollI-old.roll) > 0) this.pilot.rollI = old.roll;
    if (Math.abs(c.rudder) > 0.98 && c.rudder*(this.pilot.yawI-old.yaw) > 0) this.pilot.yawI = old.yaw;
    if ((c.collective! > 0.98 && this.pilot.liftI > old.lift) ||
        (c.collective! < 0.02 && this.pilot.liftI < old.lift)) this.pilot.liftI = old.lift;
    c.feetOffRudder = false;
    if (t) this.after(t, dt, s, c);
    return true;
  }

  /** The tuned outer loops (SimProfile.heliHold): the held speed, the hover capture, the climb-rate demand. */
  private outer(t: HeliHoldTuning, dt: number, s: AircraftState, st: AutopilotSettings, o: PilotObservation): { forward: number; vs: number } {
    const pilot = this.pilot!;
    // Held speed: walks to the setting (a set from elsewhere: the dev panel) instead of stepping.
    const rate = (t.speedRateKtS ?? Infinity)*KT*dt;
    this.speedCmd += clamp(st.airspeed - this.speedCmd, -rate, rate);
    const airspeed = t.airspeedAboveKias !== undefined && this.speedCmd > t.airspeedAboveKias*KT;
    if (airspeed) o.forwardSpeed = s.ias;
    const hover = this.speedCmd < 3*KT;
    if (hover && !this.hovering) { this.north = s.position.x; this.east = s.position.y; }
    if (!hover) this.capture = null;
    this.hovering = hover;
    let forward = this.speedCmd, side = 0;
    if (hover) {
      let vn: number, ve: number;
      if (this.capture) {
        // Stopping: the demand runs down to zero; the point held moves with the aircraft until it has stopped.
        const k = this.capture, v = Math.hypot(k.vn, k.ve), dv = t.hoverCapture!.decel*dt;
        const f = v > dv ? (v - dv)/v : 0;
        k.vn *= f; k.ve *= f;
        vn = k.vn; ve = k.ve;
        this.north = s.position.x; this.east = s.position.y;
        if (f === 0) this.capture = null;
      } else {
        vn = clamp(0.12*(this.north-s.position.x), -2, 2);
        ve = clamp(0.12*(this.east-s.position.y), -2, 2);
      }
      forward = vn*Math.cos(s.heading) + ve*Math.sin(s.heading);
      side = -vn*Math.sin(s.heading) + ve*Math.cos(s.heading);
    }
    o.sideSpeed -= side;
    // Coordinated turns: the sideways-drift bank stands down (the turn law sets the bank).
    if (t.turns) {
      const ias = s.ias/KT;
      if (!this.turning && ias >= t.turns.onKias && !hover) { this.turning = true; this.bankCmd = s.roll; this.bankTrim = clamp(s.roll, -5*DEG, 5*DEG); }
      else if (this.turning && (ias < t.turns.offKias || hover)) {
        this.turning = false; pilot.heading = s.heading; pilot.bank = 0; pilot.yawRateRef = 0;
        pilot.driftI = clamp(s.roll, -10*DEG, 10*DEG);
      }
      if (this.turning) o.sideSpeed = 0;
    }
    let vs: number;
    if (t.climb) {
      const k = t.climb;
      if (this.first && Math.abs(this.vsCmd) > 0.2) st.altitude = s.altitudeMSL + this.vsCmd*Math.abs(this.vsCmd)/(2*k.accel);
      const law = clamp(k.heightGain*(st.altitude-s.altitudeMSL), -k.maxClimb, k.maxClimb);
      this.vsCmd += clamp(law - this.vsCmd, -k.accel*dt, k.accel*dt);
      vs = this.vsCmd;
      pilot.liftGain = k.liftGain; pilot.liftLearning = k.liftLearning;
    } else vs = clamp(0.3*(st.altitude-s.altitudeMSL), -1.5, 1.5);
    this.first = false;
    return { forward, vs };
  }

  /** Coordinated turn (HeliHoldTuning.turns): bank for the heading, pedals for zero sideslip. */
  private coordinate(k: NonNullable<HeliHoldTuning['turns']>, dt: number, s: AircraftState, c: ControlInputs, st: AutopilotSettings, o: PilotObservation): void {
    const pilot = this.pilot!;
    // Engaged in a bank: the wings come level first and the heading bug follows the nose until they are (the heading
    // then held is the one rolled out on, not the one A was pressed on, which a turn back to would need).
    if (this.syncBug) {
      c.headingBugDeg = (((c.headingBugDeg + wrapPi(s.heading - st.heading)/DEG) % 360) + 360) % 360;
      st.heading = s.heading;
      if (Math.abs(this.bankCmd) < 1*DEG) this.syncBug = false;
    }
    const e = wrapPi(st.heading - s.heading), rate = k.rateDegS*DEG;
    const yawRate = clamp(k.headingGain*e, -rate, rate);
    const v = Math.max(s.tas, 10), maxBank = k.maxBankDeg*DEG;
    // The trim bank (the wings-level flight of a rigid rotor and its tail rotor is a degree or so off level): learnt from a
    // small heading error, as the drift law's integrator learns the side speed, so the heading settles on the bug.
    if (Math.abs(e) < 10*DEG && !this.syncBug) this.bankTrim = clamp(this.bankTrim + k.trimLearning*e*dt, -5*DEG, 5*DEG);
    const target = clamp(Math.atan(v*yawRate/G0) + this.bankTrim, -maxBank, maxBank);
    const roll = k.rollRateDegS*DEG*dt;
    this.bankCmd += clamp(target - this.bankCmd, -roll, roll);
    // The drift term (frozen: its side speed is zeroed) plus pilot.bank is the bank flown; make it the turn's.
    pilot.bank = this.bankCmd - clamp(pilot.driftI - pilot.driftGain*o.sideSpeed, -10*DEG, 10*DEG);
    pilot.heading = s.heading + k.slipGain*s.beta;
    pilot.yawRateRef = G0*Math.sin(s.roll)/v;
  }

  /** After the shared step (tuned path): the pusher grip and the trim follow-up. */
  private after(t: HeliHoldTuning, dt: number, s: AircraftState, c: ControlInputs): void {
    if (t.pusher && c.propLever !== undefined) {
      const k = t.pusher, want = clamp(interp1(k.kias, k.lever, this.speedCmd/KT), 0, 1);
      if (!Number.isFinite(this.prop)) this.prop = c.propLever;
      this.prop += clamp(want - this.prop, -k.ratePerS*dt, k.ratePerS*dt);
      c.propLever = this.prop;
    }
    const spring = s.rotorcraft?.springTrim;
    if (t.trimFollowUp && spring) {
      const f = Math.min(1, dt/t.trimFollowUp.tauS);
      this.stickLp.pitch += (c.elevator - this.stickLp.pitch)*f;
      this.stickLp.roll += (c.aileron - this.stickLp.roll)*f;
      // Full trim rate beyond 0.02 of the stick, proportional inside it.
      c.cyclicTrimPitch = clamp((this.stickLp.pitch - spring.pitch)/0.02, -1, 1);
      c.cyclicTrimRoll = clamp((this.stickLp.roll - spring.roll)/0.02, -1, 1);
    }
    // Keyboard pedals: their centre (what they return to at A off) walked to the hold's pedal, as the STAB ASSIST's
    // follow-up walks it (ControlInputs.pedalFollowUp), from where the pedals rested when A was pressed.
    if (t.trimFollowUp && c.keyboardPedals) {
      this.rudLp += (c.rudder - this.rudLp)*Math.min(1, dt/t.trimFollowUp.tauS);
      const step = clamp(this.rudLp - this.pedalCentre, -t.trimFollowUp.pedalRate*dt, t.trimFollowUp.pedalRate*dt);
      if (step !== 0) { c.pedalFollowUp = (c.pedalFollowUp ?? 0) + step; this.pedalCentre += step; }
    }
  }
}

/** Any engine running (a twin flies the hold on either engine: plan revision 2 section 5, T13). One engine: engine 0. */
function anyEngineRunning(s: AircraftState): boolean {
  return s.engine.running || s.engines.some((e) => e.running);
}
