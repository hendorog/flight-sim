import { DEG, HP, KT } from '../../src/core/math';
import { R22_ROTORCRAFT as d } from '../../src/aircraft/r22/rotorcraft';
import type { AircraftFlightModel } from '../../src/physics/interfaces';
import type { ControlInputs } from '../../src/core/types';

// Optional diagnostics follow the repository's node-types-free test harness pattern.
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
interface TraceFs { mkdirSync(path: string, options: { recursive: boolean }): void; writeFileSync(path: string, data: string): void }
const traceFs = env.R22_TRACE ? await import(/* @vite-ignore */ 'node:fs' as string) as TraceFs : undefined;
export function writeTrace(name: string, data: unknown): void {
  traceFs?.mkdirSync('work', { recursive: true });
  traceFs?.writeFileSync(`work/r22-round2-${name}.json`, JSON.stringify(data));
}

export class FlightRecorder {
  readonly samples: ReturnType<FlightRecorder['sample']>[] = [];
  readonly touchdowns: { time: number; sink: number; groundKts: number; rpm: number }[] = [];
  maxRpm = 0; minFlightRpm = Infinity; maxFlightRpm = 0; maxPower = 0; maxMap = 0;
  exceeded = false; crashed = false;
  constructor(readonly rig: { fm: AircraftFlightModel; c: ControlInputs }) {}
  sample(time: number, phase: string) {
    const { c, fm: { state: s } } = this.rig, r = s.rotorcraft!;
    return { time, phase, height: s.altitudeAGL - d.skids.z, kias: s.ias / KT, groundKts: s.groundSpeed / KT,
      vs: s.verticalSpeed, pitch: s.pitch / DEG, roll: s.roll / DEG, heading: s.heading / DEG,
      rpm: r.rotorRpm / d.referenceRpm * 100, hp: s.engine.power / HP, map: s.engine.manifoldPressure,
      collective: c.collective!, cyclicAft: c.elevator, cyclicRight: c.aileron, pedalRight: c.rudder,
      grip: c.throttle, crashed: s.crashed, crash: s.crashReason, onGround: s.onGround,
      // Diagnostic channels only; none are passed to the scripted pilot.
      thrust: r.thrust, torque: r.torque, driveTorque: r.driveTorque, inflow: r.inflow,
      vortexRing: r.vortexRing, stalledFraction: r.stalledFraction, gLoad: s.gLoad,
      rotorEnergy: 0.5 * (d.main.inertia + d.tail.inertia * d.tailRatio ** 2) * r.omega ** 2 };
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
    if (!this.samples.length || time - this.samples.at(-1)!.time >= 0.25 ||
        this.samples.at(-1)!.phase !== phase || p.crashed) this.samples.push(p);
  }
  save(name: string): void {
    writeTrace(name, { samples: this.samples, touchdowns: this.touchdowns,
      maxRpm: this.maxRpm, minFlightRpm: this.minFlightRpm, maxFlightRpm: this.maxFlightRpm,
      maxPower: this.maxPower, maxMap: this.maxMap, exceeded: this.exceeded, crashed: this.crashed });
  }
}
