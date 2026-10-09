// R22 demonstration flights. The acceptance tests and the app run these same controls at 240 Hz.
// These are reproductions of the engineering test pilot, not validated flight-training procedures.

import { clamp, DEG, FT, KT } from '../../core/math';
import { cloneControls, copyControls, type AircraftState, type ControlInputs } from '../../core/types';
import { R22_ROTORCRAFT as d } from '../../aircraft/r22/rotorcraft';
import type { StepController } from '../../training/types';
import { observePilot, ScriptedPilot, type PilotObservation } from './scriptedPilot';

export const R22_DEMOS = ['startup', 'hover', 'approach', 'autorotation', 'circuit'] as const;
export type R22DemoId = typeof R22_DEMOS[number];
export const DEMO_TITLES: Record<R22DemoId, string> = {
  startup: 'Cold start to hover', hover: 'Hover to cruise', approach: 'Approach and landing',
  autorotation: 'Autorotation · known landing gap', circuit: 'Full cold-start circuit',
};
export function isR22Demo(value: string | null): value is R22DemoId {
  return R22_DEMOS.includes(value as R22DemoId);
}

export const PHASE_ACTIONS: Record<string, string> = {
  start: 'Cranking with clutch disengaged', clutch: 'Engaging clutch; holding the grip at idle',
  governor: 'Governor on; opening the twist grip smoothly', warmup: 'Holding RPM; warming up',
  hover: 'Balancing cyclic and pedals; holding a 3 m hover', ETL: 'Forward cyclic through translational lift',
  climb: 'Climbing at 60 KIAS', accelerate: 'Lowering the nose; accelerating to 85 KIAS',
  cruise: 'Holding cruise', descend: 'Reducing speed and collective',
  approach: 'Decelerating and descending to the hover', land: 'Lowering collective for a vertical landing',
  autorotate: 'Power off; collective low; holding 65 KIAS', flare: '60 ft flare: following a decreasing sink schedule with cyclic',
  level: '8 ft: forward cyclic to level the helicopter', cushion: 'Sink rebuilding: progressively raising collective', park: 'Lowering collective after touchdown',
};

/** After contact, return weight to the skids before centring cyclic and pedals. */
function park(c: ControlInputs, dt: number, rate = 0.2): void {
  c.collective = Math.max(0, c.collective! - rate * dt);
  if (c.collective === 0) for (const axis of ['elevator', 'aileron', 'rudder'] as const)
    c[axis] += clamp(-c[axis], -0.5 * dt, 0.5 * dt);
}

export interface DemoSample {
  time: number; phase: string; height: number; kias: number; vs: number; rpm: number;
  collective: number; cyclicAft: number; cyclicRight: number; pedalRight: number; grip: number;
}

export type DemoOutcome = 'flying' | 'complete' | 'taken-over' | 'crashed' | 'timeout';

/** StepController is the same integration point used by Flight School. It owns controls, never state.
 * Keep a private control output, as InstructorPilot does: idle input polling must not release START or
 * overwrite the grip between physics steps. stop() releases authority with controls where they were.
 */
export class R22Flight implements StepController {
  time = 0;
  phase = 'start';
  outcome: DemoOutcome = 'flying';
  landed = false;
  private pilot: ScriptedPilot | undefined;
  private readonly out: ControlInputs;
  private readonly heading: number;
  private steps = 0;
  private landedAt = Infinity;
  private lastRpm = 103.5;
  private lastVs = 0;
  private rpmTrend = 0;
  private verticalAcceleration = 0;
  readonly samples: DemoSample[] = [];
  readonly phases: { time: number; phase: string }[] = [];

  constructor(readonly id: R22DemoId, s: AircraftState, c: ControlInputs, readonly gross = true) {
    this.heading = s.heading;
    this.out = cloneControls(c);
    if (id === 'startup' || id === 'circuit') Object.assign(this.out, {
      rotorClutch: false, rotorGovernor: false, throttle: 0.1, mixture: 1,
      magnetos: 3, masterBattery: true, starter: true,
    });
    else {
      // Reproduce the existing power-failure test's entry configuration, including collective already down.
      if (id === 'autorotation') { this.out.mixture = 0; this.out.collective = 0; }
      this.pilot = new ScriptedPilot(observePilot(s), this.out);
      this.pilot.heading = this.heading;
      this.phase = id === 'autorotation' ? 'autorotate' : id === 'hover' ? 'hover' : 'approach';
    }
    copyControls(c, this.out);
  }

  get flying(): boolean { return this.outcome === 'flying'; }
  get action(): string { return PHASE_ACTIONS[this.phase] ?? this.phase; }
  stop(): void { this.outcome = 'taken-over'; }

  update(dt: number, state: AircraftState, controls: ControlInputs): void {
    if (!this.flying || !(dt > 0)) return;
    const s = observePilot(state), t = this.time, c = this.out;
    if (s.crashed) { this.outcome = 'crashed'; return; }
    if (this.id === 'approach') this.approach(dt, t, s, c);
    else if (this.id === 'autorotation') this.autorotation(dt, t, s, c);
    else this.powered(dt, this.id === 'hover' ? t + 95 : t, s, c);
    copyControls(controls, c);
    if (!this.samples.length || t - this.samples.at(-1)!.time >= 0.25 || this.phases.at(-1)?.phase !== this.phase) this.samples.push({
      time: t, phase: this.phase, height: s.height, kias: s.ias / KT, vs: s.verticalSpeed,
      rpm: s.rotorPercent, collective: c.collective ?? 0, cyclicAft: c.elevator,
      cyclicRight: c.aileron, pedalRight: c.rudder, grip: c.throttle,
    });
    if (this.phases.at(-1)?.phase !== this.phase) this.phases.push({ time: t, phase: this.phase });
    // Integer steps preserve the original tests' i * DT phase boundaries.
    this.time = ++this.steps * dt;
    if ((this.id === 'startup' && t >= 115) || (this.id === 'hover' && t >= 145) ||
        this.landed && c.collective === 0 && t - this.landedAt > 5) this.outcome = 'complete';
    const limit = this.id === 'circuit' ? 520 : this.id === 'autorotation' ? 90 : 160;
    if (this.flying && this.time >= limit) this.outcome = 'timeout';
  }

  private touch(t: number, onGround: boolean): void {
    if (onGround && !this.landed) { this.landed = true; this.landedAt = t; }
  }

  private approach(dt: number, t: number, s: PilotObservation, c: ControlInputs): void {
    const speed = t < 35 ? 60 : t < 65 ? 60 - 2 * (t - 35) : 0;
    const height = t < 45 ? 90 - t * 1.5 : t < 70 ? Math.max(3, 22.5 - (t - 45)) : t < 100 ? 3 : Math.max(-0.3, 3 - (t - 100) * 0.25);
    if (t > 110) this.touch(t, s.onGround);
    if (this.landed) park(c, dt);
    else this.pilot!.step(dt, s, c, speed, clamp(0.5 * (height - s.height), -1.5, 1.5));
    this.phase = this.landed ? 'park' : t < 70 ? 'approach' : t < 100 ? 'hover' : 'land';
  }

  private powered(dt: number, t: number, s: PilotObservation, c: ControlInputs): void {
    if (this.id !== 'hover') {
      if (t > 8) { c.starter = false; c.rotorClutch = true; }
      if (t > 65 && t < 95) {
        c.rotorGovernor = true;
        // The grip overrides the governor while moving; release it at 101%.
        if (s.engineRpm < 1.01 * d.referenceRpm * d.engineRatio) c.throttle += 0.02 * dt;
      }
    }
    this.phase = t <= 8 ? 'start' : t <= 65 ? 'clutch' : t < 85 ? 'governor' : 'warmup';
    if (t <= 95) { if (this.id === 'hover') this.phase = 'hover'; return; }
    if (!this.pilot) {
      this.pilot = new ScriptedPilot(s, c);
      this.pilot.heading = this.heading;
    }
    const pilot = this.pilot;
    let speed = 0, height = 3;
    if (t < 115 || this.id === 'startup') this.phase = 'hover';
    else if (t < 145) { this.phase = 'ETL'; speed = Math.min(60, (t - 115) * 2); height = 3 + Math.max(0, t - 125) * 2; }
    else if (t < 185) { this.phase = 'climb'; speed = 60; height = 43 + (t - 145) * 2.5; }
    else if (t < 215) { this.phase = 'accelerate'; speed = Math.min(85, 60 + t - 185); height = 143; }
    else if (t < 365) {
      this.phase = 'cruise'; speed = 85; height = 143;
      if (this.id === 'circuit') {
        pilot.heading = this.heading + (t - 215) * 2 * Math.PI / 150;
        pilot.bank = Math.atan(speed * KT * (2 * Math.PI / 150) / 9.80665);
      }
    } else if (t < 400) { this.phase = 'descend'; speed = Math.max(60, 85 - (t - 365)); height = 143 - (t - 365) * 1.5; }
    else if (t < 430) { this.phase = 'approach'; speed = Math.max(0, 60 - 2 * (t - 400)); height = 90.5 - (t - 400) * 2.8; }
    else if (t < 465) this.phase = 'hover';
    else { this.phase = 'land'; height = Math.max(-0.3, 3 - (t - 465) * 0.25); }
    if (t >= 365) { pilot.heading = this.heading + 2 * Math.PI; pilot.bank = 0; }
    const vs = clamp(0.5 * (height - s.height), t >= 420 ? -1.5 : -2.5, t < 115 ? 0.5 : 2.5);
    if (t > 465) this.touch(t, s.onGround);
    if (this.landed) { park(c, dt); this.phase = 'park'; } else pilot.step(dt, s, c, speed, vs);
  }

  private autorotation(dt: number, t: number, s: PilotObservation, c: ControlInputs): void {
    const pilot = this.pilot!, h = s.height, rpm = s.rotorPercent;
    // Trends in visible sink and tachometer readings, smoothed over a pilot's response time.
    const lag = 1 - Math.exp(-dt / 0.3);
    this.rpmTrend += ((rpm - this.lastRpm) / dt - this.rpmTrend) * lag;
    this.verticalAcceleration += ((s.verticalSpeed - this.lastVs) / dt - this.verticalAcceleration) * lag;
    // Start the hand movement with 0.6 s of visual height/sink anticipation, so the nose is already
    // rising near the owner's 60 ft cue. Waiting for 60 ft before moving hid the flare below 40 ft.
    if (this.phase === 'autorotate' && h + 0.6 * s.verticalSpeed < 60 * FT) {
      this.phase = 'flare'; pilot.pitchRate = 6 * DEG; pilot.cyclicRate = 0.8; pilot.pitchLead = 0.5;
    }
    if (this.phase === 'flare' && h < 8 * FT) {
      this.phase = 'level'; pilot.pitchRate = 12 * DEG; pilot.pitchLead = 0.3; pilot.pitchDamping = 2;
    }
    // Do not wait for a fixed near-ground height: the loss of support is the cue to begin the pull.
    else if (this.phase === 'level' && this.verticalAcceleration < -0.2) this.phase = 'cushion';
    this.touch(t, s.onGround);
    if (this.landed) { park(c, dt, 0.5); this.phase = 'park'; }
    else if (this.phase === 'autorotate') pilot.step(dt, s, c, 65, -1, undefined, clamp(0.04 + 0.02 * (rpm - 102), 0, 0.5), 1);
    else {
      // Engineering schedule, not POH performance data: 1575 / 895 / 444 / 222 / 197 fpm down at
      // 60 / 45 / 30 / 15 / 8 ft. Reduce sink early enough to allow deceleration, then keep descending
      // instead of holding a large attitude until the helicopter balloons. Attitude follows sink error
      // and its observed trend; 18 deg is a stop, not a target. Hand/attitude rates remain estimates.
      const portion = clamp((h - 8 * FT) / (52 * FT), 0, 1);
      const targetVs = -1 - 7 * portion ** 2;
      const targetAcceleration = -14 / (52 * FT) * portion * s.verticalSpeed;
      const pitch = this.phase === 'flare' ? clamp(pilot.pitchCommand +
        (8 * (targetVs - s.verticalSpeed) + 3 * (targetAcceleration - this.verticalAcceleration)) * DEG * dt, -10 * DEG, 18 * DEG) : 0;
      // Until cushioning, collective responds only to the tachometer: aim inside the 101–104% green
      // arc (POH 2-8), allowing for proportional droop and the observed RPM trend. The light entry can
      // remain below green with collective fully down. Cushion with sink/trend feedback, spending rotor
      // energy before contact, with no mass, thrust, inflow or energy estimate available to the pilot.
      const collective = this.phase !== 'cushion' ? clamp(0.08 * (rpm - 101.5) + 0.04 * this.rpmTrend, 0, 0.8) :
        clamp((c.collective ?? 0) + (0.4 * (-0.8 - s.verticalSpeed) - 0.2 * this.verticalAcceleration) * dt, 0, 1);
      pilot.step(dt, s, c, 0, targetVs, pitch, collective, 0.5);
    }
    this.lastRpm = rpm; this.lastVs = s.verticalSpeed;
  }
}
