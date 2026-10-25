import { clamp, DEG, KT, wrapPi } from '../../core/math';
import type { AircraftState, ControlInputs } from '../../core/types';
import type { RotorcraftDefinition } from '../../physics/rotorcraft/definition';
import type { AutopilotSettings } from '../../physics/autopilot';
import { ScriptedPilot, observePilot } from './scriptedPilot';
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
    const hover = st.airspeed < 3*KT;
    if (hover && !this.hovering) { this.north = s.position.x; this.east = s.position.y; }
    this.hovering = hover;
    let forward = st.airspeed, side = 0;
    if (hover) {
      const vn = clamp(0.12*(this.north-s.position.x), -2, 2);
      const ve = clamp(0.12*(this.east-s.position.y), -2, 2);
      forward = vn*Math.cos(s.heading) + ve*Math.sin(s.heading);
      side = -vn*Math.sin(s.heading) + ve*Math.cos(s.heading);
    }
    o.sideSpeed -= side;
    const vs = clamp(0.3*(st.altitude-s.altitudeMSL), -1.5, 1.5);
    this.rollModel.enabled = this.pitchModel.enabled = this.adaptive;
    this.rollModel.update(dt, s.angularVelocity.x, c.aileron);
    this.pitchModel.update(dt, s.angularVelocity.y, c.elevator);
    this.pilot.rollGain = 4*this.rollModel.scale; this.pilot.rollDamping = 1.5*this.rollModel.scale;
    this.pilot.pitchGain = 4*this.pitchModel.scale; this.pilot.pitchDamping = 1.5*this.pitchModel.scale;
    this.pilot.heading += clamp(wrapPi(st.heading-this.pilot.heading), -8*DEG*dt, 8*DEG*dt);
    const old = { pitch: this.pilot.pitchI, roll: this.pilot.rollI, yaw: this.pilot.yawI, lift: this.pilot.liftI };
    this.pilot.step(dt, o, c, forward/KT, vs);
    // Prevent the inner integrators from winding farther into actuator saturation.
    if (Math.abs(c.elevator) > 0.98 && c.elevator*(this.pilot.pitchI-old.pitch) > 0) this.pilot.pitchI = old.pitch;
    if (Math.abs(c.aileron) > 0.98 && c.aileron*(this.pilot.rollI-old.roll) > 0) this.pilot.rollI = old.roll;
    if (Math.abs(c.rudder) > 0.98 && c.rudder*(this.pilot.yawI-old.yaw) > 0) this.pilot.yawI = old.yaw;
    if ((c.collective! > 0.98 && this.pilot.liftI > old.lift) ||
        (c.collective! < 0.02 && this.pilot.liftI < old.lift)) this.pilot.liftI = old.lift;
    c.feetOffRudder = false;
    return true;
  }
}

/** Any engine running (a twin flies the hold on either engine: plan revision 2 section 5, T13). One engine: engine 0. */
function anyEngineRunning(s: AircraftState): boolean {
  return s.engine.running || s.engines.some((e) => e.running);
}
