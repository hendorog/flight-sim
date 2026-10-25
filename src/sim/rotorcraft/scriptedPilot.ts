import { clamp, DEG, KT, quat, wrapPi } from '../../core/math';
import type { AircraftState, ControlInputs } from '../../core/types';
import { R22_ROTORCRAFT } from '../../aircraft/r22/rotorcraft';
import type { RotorcraftDefinition } from '../../physics/rotorcraft/definition';

/** Instrument readings and outside visual cues only. No flight model, forces, trim solver or rotor internals. */
export interface PilotObservation {
  pitch: number; roll: number; heading: number;
  angularVelocity: Readonly<{ x: number; y: number; z: number }>;
  forwardSpeed: number; sideSpeed: number; groundSpeed: number;
  verticalSpeed: number; height: number; ias: number;
  rotorPercent: number; engineRpm: number; onGround: boolean; crashed: boolean;
}

/** Signed movement relative to the cockpit is the visual drift cue needed to hover, including backwards. */
export function observePilot(s: AircraftState, d: Pick<RotorcraftDefinition, 'referenceRpm' | 'skids'> = R22_ROTORCRAFT): PilotObservation {
  const motion = quat.rotateInv(s.orientation, s.velocity);
  return { pitch: s.pitch, roll: s.roll, heading: s.heading, angularVelocity: { ...s.angularVelocity },
    forwardSpeed: motion.x, sideSpeed: motion.y, groundSpeed: s.groundSpeed, verticalSpeed: s.verticalSpeed,
    height: s.altitudeAGL - d.skids.z, ias: s.ias, rotorPercent: s.rotorcraft!.rotorRpm / d.referenceRpm * 100,
    engineRpm: s.engine.rpm, onGround: s.onGround, crashed: s.crashed };
}

/** Scripted demonstration pilot. Uses visible attitude, motion, tachometers and height; writes ordinary controls.
 * No force, velocity, rotor-state or trim resets occur during flight. Rates are hand-motion limits,
 * not claims about measured R22 pilot transfer functions. Used only during an explicitly started demonstration; never a flight assist.
 */
export class ScriptedPilot {
  pitchI: number; rollI: number; yawI: number; liftI: number;
  speedI: number; driftI: number; pitchCommand: number;
  heading = 0; bank = 0;
  pitchGain = 4; pitchDamping = 1.5; pitchLearning = 0.8;
  rollGain = 4; rollDamping = 1.5; rollLearning = 0.8;
  speedGain = 0.045; speedLearning = 0.005; driftGain = 0.08; driftLearning = 0.015;
  pitchRate = 20 * DEG; cyclicRate = 1;
  /** Collective per m/s of climb-rate error, and its trim integrator's rate (0.05, 0.025; the hold's opt-in tuning may change them). */
  liftGain = 0.05; liftLearning = 0.025;
  /** Yaw rate the pedals' rate damping works about, rad/s (0; the helicopter hold's coordinated turn sets the turn's). */
  yawRateRef = 0;
  /** Hand-rate limit of the lateral cyclic, travel per second (1; the helicopter hold's opt-in tuning may change it). */
  aileronRate = 1;
  /** Anticipate a fraction of the demanded pitch rate; cyclic still passes through the hand-rate limit. */
  pitchLead = 0;
  constructor(s: PilotObservation, c: ControlInputs) {
    this.pitchI = c.elevator; this.rollI = c.aileron; this.yawI = c.rudder;
    this.liftI = c.collective || 0.4; this.speedI = this.pitchCommand = s.pitch; this.driftI = s.roll;
  }
  /** Keep flying the attitude during a run-on. A small nose-up demand anticipates the nose-down
   * ground reaction, without retaining the airborne flare attitude or driving cyclic fully aft. */
  slide(dt: number, s: PilotObservation, c: ControlInputs): void {
    this.pitchLead = 0; this.pitchDamping = 2; this.pitchRate = 12 * DEG; this.cyclicRate = 0.8;
    this.step(dt, s, c, 0, 0, DEG, c.collective, 0.12);
    if (s.groundSpeed < 0.5) c.collective = Math.max(0, c.collective! - 0.2 * dt);
  }
  step(dt: number, s: PilotObservation, c: ControlInputs, kias: number, verticalSpeed: number, pitch?: number, collective?: number, collectiveRate = 0.12): void {

    // Signed fore/aft velocity is essential at hover: an unsigned airspeed loop runs away backwards.
    this.speedI = clamp(this.speedI + this.speedLearning * (s.forwardSpeed - kias * KT) * dt, -20 * DEG, 20 * DEG);
    const target = pitch ?? clamp(this.speedI + this.speedGain * (s.forwardSpeed - kias * KT), -15 * DEG, 25 * DEG);
    const pitchStep = clamp(target - this.pitchCommand, -this.pitchRate * dt, this.pitchRate * dt);
    this.pitchCommand += pitchStep;
    this.driftI = clamp(this.driftI - this.driftLearning * s.sideSpeed * dt, -10 * DEG, 10 * DEG);
    const bank = clamp(this.driftI - this.driftGain * s.sideSpeed, -10 * DEG, 10 * DEG) + this.bank;
    const ep = this.pitchCommand - s.pitch, er = bank - s.roll, ey = wrapPi(this.heading - s.heading);
    this.pitchI = clamp(this.pitchI + this.pitchLearning * ep * dt, -1, 1);
    this.rollI = clamp(this.rollI + this.rollLearning * er * dt, -1, 1);
    this.yawI = clamp(this.yawI + 0.4 * ey * dt, -1, 1);
    const move = (value: number, to: number, rate: number) => value + clamp(clamp(to, -1, 1) - value, -rate * dt, rate * dt);
    c.elevator = move(c.elevator, this.pitchI + this.pitchGain * ep - this.pitchDamping * (s.angularVelocity.y - this.pitchLead * pitchStep / dt), this.cyclicRate);
    c.aileron = move(c.aileron, this.rollI + this.rollGain * er - this.rollDamping * s.angularVelocity.x, this.aileronRate);
    c.rudder = move(c.rudder, this.yawI + 2 * ey - 1.2 * (s.angularVelocity.z - this.yawRateRef), 0.7);
    this.liftI = clamp(this.liftI + this.liftLearning * (verticalSpeed - s.verticalSpeed) * dt, 0, 0.8);
    c.collective = clamp(move(c.collective ?? 0, collective ?? this.liftI + this.liftGain * (verticalSpeed - s.verticalSpeed), collectiveRate), 0, 1);
  }
}
