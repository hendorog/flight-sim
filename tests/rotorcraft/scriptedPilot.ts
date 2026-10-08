import { clamp, DEG, HP, KT, quat, wrapPi } from '../../src/core/math';
import { R22_ROTORCRAFT as d } from '../../src/aircraft/r22/rotorcraft';
import type { Rig } from './helpers';

// Optional diagnostics follow the repository's node-types-free test harness pattern.
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
interface TraceFs { mkdirSync(path: string, options: { recursive: boolean }): void; writeFileSync(path: string, data: string): void }
const traceFs = env.R22_TRACE ? await import(/* @vite-ignore */ 'node:fs' as string) as TraceFs : undefined;
export function writeTrace(name: string, data: unknown): void {
  traceFs?.mkdirSync('work', { recursive: true });
  traceFs?.writeFileSync(`work/r22-round2-${name}.json`, JSON.stringify(data));
}

/** Test pilot only. Uses visible attitude, motion, tachometers and height; writes ordinary controls.
 * No force, velocity, rotor-state or trim resets occur during flight. Rates are hand-motion limits,
 * not claims about measured R22 pilot transfer functions. This is never installed as a flight assist.
 */
export class ScriptedPilot {
  pitchI: number; rollI: number; yawI: number; liftI: number;
  speedI: number; driftI: number; pitchCommand: number;
  heading = 0; bank = 0;
  pitchGain = 4; pitchDamping = 1.5; pitchLearning = 0.8;
  rollGain = 4; rollDamping = 1.5; rollLearning = 0.8;
  speedGain = 0.045; speedLearning = 0.005; driftGain = 0.08; driftLearning = 0.015;
  pitchRate = 20 * DEG; cyclicRate = 1;
  constructor(readonly rig: Rig) {
    const { c, fm: { state: s } } = rig;
    this.pitchI = c.elevator; this.rollI = c.aileron; this.yawI = c.rudder;
    this.liftI = c.collective || 0.4; this.speedI = this.pitchCommand = s.pitch; this.driftI = s.roll;
  }
  step(dt: number, kias: number, verticalSpeed: number, pitch?: number, collective?: number, collectiveRate = 0.12): void {
    const { c, fm: { state: s } } = this.rig, air = quat.rotateInv(s.orientation, s.velocity);
    // Signed fore/aft velocity is essential at hover: an unsigned airspeed loop runs away backwards.
    this.speedI = clamp(this.speedI + this.speedLearning * (air.x - kias * KT) * dt, -20 * DEG, 20 * DEG);
    const target = pitch ?? clamp(this.speedI + this.speedGain * (air.x - kias * KT), -15 * DEG, 25 * DEG);
    this.pitchCommand += clamp(target - this.pitchCommand, -this.pitchRate * dt, this.pitchRate * dt);
    this.driftI = clamp(this.driftI - this.driftLearning * air.y * dt, -10 * DEG, 10 * DEG);
    const bank = clamp(this.driftI - this.driftGain * air.y, -10 * DEG, 10 * DEG) + this.bank;
    const ep = this.pitchCommand - s.pitch, er = bank - s.roll, ey = wrapPi(this.heading - s.heading);
    this.pitchI = clamp(this.pitchI + this.pitchLearning * ep * dt, -1, 1);
    this.rollI = clamp(this.rollI + this.rollLearning * er * dt, -1, 1);
    this.yawI = clamp(this.yawI + 0.4 * ey * dt, -1, 1);
    const move = (value: number, to: number, rate: number) => value + clamp(clamp(to, -1, 1) - value, -rate * dt, rate * dt);
    c.elevator = move(c.elevator, this.pitchI + this.pitchGain * ep - this.pitchDamping * s.angularVelocity.y, this.cyclicRate);
    c.aileron = move(c.aileron, this.rollI + this.rollGain * er - this.rollDamping * s.angularVelocity.x, 1);
    c.rudder = move(c.rudder, this.yawI + 2 * ey - 1.2 * s.angularVelocity.z, 0.7);
    this.liftI = clamp(this.liftI + 0.025 * (verticalSpeed - s.verticalSpeed) * dt, 0, 0.8);
    c.collective = clamp(move(c.collective ?? 0, collective ?? this.liftI + 0.05 * (verticalSpeed - s.verticalSpeed), collectiveRate), 0, 1);
  }
}

export class FlightRecorder {
  readonly samples: ReturnType<FlightRecorder['sample']>[] = [];
  readonly touchdowns: { time: number; sink: number; groundKts: number; rpm: number }[] = [];
  maxRpm = 0; minFlightRpm = Infinity; maxFlightRpm = 0; maxPower = 0; maxMap = 0;
  exceeded = false; crashed = false;
  constructor(readonly rig: Rig) {}
  sample(time: number, phase: string) {
    const { c, fm: { state: s } } = this.rig, r = s.rotorcraft!;
    return { time, phase, height: s.altitudeAGL - d.skids.z, kias: s.ias / KT, groundKts: s.groundSpeed / KT,
      vs: s.verticalSpeed, pitch: s.pitch / DEG, roll: s.roll / DEG, heading: s.heading / DEG,
      rpm: r.rotorRpm / d.referenceRpm * 100, hp: s.engine.power / HP, map: s.engine.manifoldPressure,
      collective: c.collective!, cyclicAft: c.elevator, cyclicRight: c.aileron, pedalRight: c.rudder,
      grip: c.throttle, crashed: s.crashed, crash: s.crashReason, onGround: s.onGround };
  }
  observe(time: number, phase: string): void {
    const p = this.sample(time, phase), { fm } = this.rig;
    this.maxRpm = Math.max(this.maxRpm, p.rpm); this.maxPower = Math.max(this.maxPower, p.hp);
    if (!p.onGround) {
      this.minFlightRpm = Math.min(this.minFlightRpm, p.rpm); this.maxFlightRpm = Math.max(this.maxFlightRpm, p.rpm);
    }
    if (fm.state.engine.rpm > 0.97 * d.referenceRpm * d.engineRatio) this.maxMap = Math.max(this.maxMap, p.map);
    this.exceeded ||= fm.state.rotorcraft!.powerLimitExceeded || fm.state.rotorcraft!.airspeedLimitExceeded;
    this.crashed ||= p.crashed;
    for (const e of fm.touchdowns) this.touchdowns.push({ time, sink: e.sinkRate, groundKts: p.groundKts, rpm: p.rpm });
    if (!this.samples.length || time - this.samples.at(-1)!.time >= 0.25 || p.crashed) this.samples.push(p);
  }
  save(name: string): void {
    writeTrace(name, { samples: this.samples, touchdowns: this.touchdowns,
      maxRpm: this.maxRpm, minFlightRpm: this.minFlightRpm, maxFlightRpm: this.maxFlightRpm,
      maxPower: this.maxPower, maxMap: this.maxMap, exceeded: this.exceeded, crashed: this.crashed });
  }
}
