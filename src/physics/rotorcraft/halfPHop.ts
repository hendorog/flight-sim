// The AH-56A "half-P hop" as a SCRIPTED EVENT (ICS configuration only; never AMCS). Owner: AH. Plan revision 2, section 7.4
// and section 0 item 10; owner note O1 ("scripted as an event, not emergent"); docs/ah56-high-speed.md section 4.
//
// What it scripts. The 1969-1971 ICS aircraft had a coupled roll / regressive in-plane / rotor plunge mode whose plunge frequency
// fell to 0.5-0.6 P at high speed and low collective, where it coalesced with body roll (P And-74 pp 185-196); lateral stick
// doublets near 1.5 Hz or cyclic stirs excited it (research-ah56 sect. 5). The repo's slow-amplitude flap reduction has no lag
// or plunge degree of freedom to make it emerge, so the event is a scripted 0.5 P roll moment and plunge force on the body:
//   - DETECTOR. A STIR is the stick's deviation from its trim point (a 4 s low-pass of the stick) turning round the trim point
//     at radius >= stirRadius: each full turn completed in at most 1 / stirHz s counts one cycle; `cycles` consecutive cycles
//     trigger. A single-axis doublet (the flight-test excitation) is the weaker trigger: excursions beyond +/- doubletRadius
//     on one axis, alternating, each reversal within 1 / (2 stirHz) s of the last; `doubletCycles` full cycles trigger. Only
//     at >= minKcas, collective (0.75 R, rad) <= maxCollective, and a gyro configuration in `configs` (read from
//     state.controlGyro.mode on every call, never cached: a restore overwrites it). InitialConditions.forceHalfPHop (URL
//     halfp=1) starts the event at the first clocked step.
//   - EVENT. Roll moment A rollMomentPerUnit sin(phase) and vertical force A plungeForcePerUnit sin(phase) at the CG, where
//     phase = perRev x the rotor's own unwrapped azimuth (state.azimuth wraps at 2 pi and azimuth / 2 is 4 pi periodic, so the
//     event keeps the unwrapped phase in events.halfPHop.phase; continuous across revolutions and across a save). A starts at
//     1 (the onset cue: about +/-3 deg of roll and +/-0.15 g). For the first cueSeconds it cannot grow. Per forcing cycle it
//     then grows by growthPerCycle while the stirring goes on, decays by decayPerCycle while the stick is held still (stick
//     speed below stillRate), and holds otherwise. At strikeAmplitude, events.halfPHop.strike latches and the flight model
//     crashes ("Main rotor struck the fuselage (half-P hop)"). Below endAmplitude it is over.
//   - CLOCK. The detector, the growth and the phase advance only on real steps on the flight's clock (dt > 0 and
//     BodyState.time > 0), so the trim's settle() relaxation (time 0, dt 0.05 s) neither advances nor feels it (as pusher.ts);
//     RK stages (dt = 0) see the phase at their own stage time.
// The detector's history (the trim point, the turn accumulated, the reversals) is private and restarts after a reset or a
// restore; the event's own state (active, amplitude, phase, stirs, strike) is RotorcraftState and persists: after a restore the
// phase continues and the amplitude keeps decaying or growing from its saved value, the 1 s onset fade and the 3 s cue clock
// restart (the private onset time is not saved), and halfp=1 does not re-arm a restored flight.
import { v3, type Vec3 } from '../../core/math';
import type { ControlInputs } from '../../core/types';
import type { BodyState } from '../interfaces';
import type { RotorcraftDefinition, RotorcraftState } from './definition';
import type { GyroConfigId } from './controlGyro';

export interface HalfPHopDef {
  /** Configurations it can occur in: ['ics']. */
  configs: readonly GyroConfigId[];
  /** Forcing frequency per rotor revolution: 0.5 (0.5-0.6 P reported; P And-74). */
  perRev: number;
  /**
   * A STIR is two-axis stick motion about the trim point with about 90 deg phase between the longitudinal and lateral
   * components: >= `cycles` (3) cycles above `stirHz` (0.5 Hz) with radius >= `stirRadius` (0.75 in, as m of stick),
   * at >= `minKcas` (150) with the collective (blade angle at 0.75 R, rad) at or below `maxCollective`. Single-axis
   * reversals beyond +/- `doubletRadius` (m of stick) need `doubletCycles` (4) cycles.
   */
  trigger: { stirHz: number; stirRadius: number; minKcas: number; maxCollective: number; cycles: number; doubletCycles: number;
    doubletRadius: number };
  /** The cue runs at least this long before growth can reach a strike, s (3). */
  cueSeconds: number;
  /** Amplitude multipliers per forcing cycle (stirring / held still), the strike amplitude, and the amplitude below which the
   *  event is over. */
  growthPerCycle: number; decayPerCycle: number; strikeAmplitude: number; endAmplitude: number;
  /** The stick counts as held still below this speed, m/s of stick (low-passed over 0.3 s). */
  stillRate: number;
  /** Roll moment, N m, and vertical force, N, per unit amplitude (onset +/-3 deg roll needs about 94 kN m on
   *  Ixx 10,850 kg m^2; ESTIMATE). */
  rollMomentPerUnit: number; plungeForcePerUnit: number;
}

/** RotorcraftState.events.halfPHop (created in reset for a type with `halfPHop`, never lazily). `phase` is the
 *  continuous (unwrapped) forcing phase, rad: azimuth/2 is 4 pi periodic, so the wrapped azimuth cannot drive it.
 *  `stirs`: qualifying stir cycles in the current sequence (diagnostic). */
export interface HalfPHopState { active: boolean; amplitude: number; phase: number; stirs: number; strike: boolean }

const KT = 1852 / 3600;
const SEA_LEVEL_DENSITY = 1.225;
const TRIM_SECONDS = 4;
const ACTIVITY_SECONDS = 0.3;
const ONSET_SECONDS = 1;

function smoothstep(x: number): number { return x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x); }

function wrap(a: number): number { return Math.atan2(Math.sin(a), Math.cos(a)); }

/** The scripted half-P hop of one aircraft (RotorcraftDefinition.halfPHop). */
export class HalfPHop {
  private readonly out = { force: v3.zero(), moment: v3.zero() };
  // Detector and clock (private: they restart after a reset or a restore).
  private synced = false;
  private time = 0;
  private lastBodyTime = 0;
  private lastAzimuth = 0;
  private trimLat = 0; private trimLon = 0;
  private prevLat = 0; private prevLon = 0;
  private activity = 0;
  private inCircle = false; private turn = 0; private back = 0; private lastAngle = 0; private cycleStart = 0;
  private lastCycle = -Infinity;
  private lastQualifying = -Infinity;
  private readonly axes = [{ sign: 0, last: -Infinity, half: 0 }, { sign: 0, last: -Infinity, half: 0 }];
  private onset = -1;
  private forced = false;
  /** Doublet cycles counted in the current sequence (diagnostic, tests). */
  doublets = 0;

  constructor(readonly def: RotorcraftDefinition, readonly state: RotorcraftState) {}

  /** force: InitialConditions.forceHalfPHop (URL halfp=1), the demo/test hook: the event starts at the first clocked step. */
  reset(force = false): void {
    this.state.events = { ...this.state.events, halfPHop: { active: false, amplitude: 0, phase: 0, stirs: 0, strike: false } };
    this.synced = false; this.time = 0; this.onset = -1; this.forced = force; this.doublets = 0;
  }

  /** Body loads about the CG at this RK stage; advances the detector, the event and the phase only on real clocked steps. */
  forcing(b: BodyState, hubAir: Vec3, density: number, c: ControlInputs, azimuth: number, dt: number): { force: Vec3; moment: Vec3 } {
    const o = this.out, d = this.def.halfPHop!, e = this.state.events?.halfPHop;
    o.force.x = o.force.y = o.force.z = 0; o.moment.x = o.moment.y = o.moment.z = 0;
    // The state is created in reset, never lazily: a state without it (a save from before the event existed) has no event.
    if (!e) return o;
    const mode = this.state.controlGyro?.mode ?? this.def.controlGyro?.default;
    const allowed = mode !== undefined && d.configs.includes(mode);
    if (!allowed) {
      // Never outside its configurations (AMCS): no detector, no event.
      if (e.active || e.amplitude !== 0) { e.active = false; e.amplitude = 0; e.stirs = 0; }
      this.synced = false;
      return o;
    }
    const clocked = b.time > 0;
    if (dt > 0 && clocked) this.advance(b, hubAir, density, c, azimuth, dt, d, e, mode!);
    if (!clocked || !e.active || !(e.amplitude > 0)) return o;
    // The phase at this RK stage's time: the last real step's phase plus the rotor's turn since (stage times run ahead of it).
    const phase = e.phase + d.perRev * Math.max(0, this.state.omega) * Math.max(0, b.time - this.lastBodyTime);
    // The onset fades in over ONSET_SECONDS: a sine moment switched on at full amplitude leaves the body a roll-rate offset of
    // M cos(phase) / (Ixx w), up to 40 deg/s, which the roll damping turns into a steady bank of up to 20 deg.
    const a = e.amplitude * (this.onset < 0 ? 1 : smoothstep((this.time - this.onset) / ONSET_SECONDS)) * Math.sin(phase);
    o.moment.x = a * d.rollMomentPerUnit;
    o.force.z = -a * d.plungeForcePerUnit;
    return o;
  }

  /** One real step of the clock, the detector and the event. */
  private advance(b: BodyState, hubAir: Vec3, density: number, c: ControlInputs, azimuth: number, dt: number, d: HalfPHopDef,
    e: HalfPHopState, mode: GyroConfigId): void {
    // halfp=1 arms only a fresh flight (phase still 0): a restored save's own event state wins (SimPhysics resets with the URL's
    // options before it restores the snapshot).
    if (this.forced && e.phase !== 0) this.forced = false;
    const travel = this.def.controlGyro?.configs[mode].stickTravel;
    const lat = (c.aileron ?? 0) * (travel?.lateral ?? 0.1), lon = (c.elevator ?? 0) * (travel?.longitudinal ?? 0.1);
    // The first step after a reset or a restore has no previous azimuth: the rotor's turn over the previous step stands in, so a
    // restored phase loses no step.
    if (!this.synced) {
      this.synced = true; this.lastAzimuth = azimuth - Math.max(0, this.state.omega) * dt; this.trimLat = this.prevLat = lat; this.trimLon = this.prevLon = lon;
      this.activity = 0; this.inCircle = false; this.turn = 0; this.back = 0; this.lastQualifying = -Infinity; this.lastCycle = -Infinity;
      for (const a of this.axes) { a.sign = 0; a.last = -Infinity; a.half = 0; }
      if (e.active && this.onset < 0) this.onset = this.time;
    }
    this.time += dt; this.lastBodyTime = b.time;
    const t = this.time;
    // The phase: perRev x the rotor's unwrapped azimuth (its own increments, in the rotation's sense).
    e.phase += d.perRev * Math.abs(wrap(azimuth - this.lastAzimuth));
    this.lastAzimuth = azimuth;
    // Stick about its trim point (m), and its speed (m/s, low-passed).
    const kTrim = 1 - Math.exp(-dt / TRIM_SECONDS), kAct = 1 - Math.exp(-dt / ACTIVITY_SECONDS);
    const speed = Math.hypot(lat - this.prevLat, lon - this.prevLon) / dt;
    this.prevLat = lat; this.prevLon = lon;
    this.activity += (speed - this.activity) * kAct;
    this.trimLat += (lat - this.trimLat) * kTrim; this.trimLon += (lon - this.trimLon) * kTrim;
    const dLat = lat - this.trimLat, dLon = lon - this.trimLon, radius = Math.hypot(dLat, dLon);
    const tr = d.trigger, period = 1 / tr.stirHz;
    // STIR: the deviation turning round the trim point, one way (a backtrack over 0.5 rad or a jump starts again), from when
    // its radius reaches stirRadius until it falls below 0.8 of it; consecutive full turns, each within one period.
    if (!this.inCircle && radius >= tr.stirRadius) {
      this.inCircle = true; this.turn = 0; this.back = 0; this.cycleStart = t; this.lastAngle = Math.atan2(dLon, dLat);
    } else if (this.inCircle && radius < 0.8 * tr.stirRadius) {
      this.inCircle = false; this.turn = 0; this.back = 0;
    } else if (this.inCircle) {
      const angle = Math.atan2(dLon, dLat), step = wrap(angle - this.lastAngle);
      this.lastAngle = angle;
      if (this.turn !== 0 && Math.sign(step) !== Math.sign(this.turn)) this.back += Math.abs(step);
      else this.back = Math.max(0, this.back - Math.abs(step));
      if (Math.abs(step) > 0.5 || this.back > 0.5) { this.turn = 0; this.back = 0; this.cycleStart = t; }
      else {
        const before = Math.floor(Math.abs(this.turn) / Math.PI);
        this.turn += step;
        if (Math.floor(Math.abs(this.turn) / Math.PI) > before && t - this.cycleStart <= period) {
          // Half a turn in time: the stirring is "going on"; a full turn in time counts a cycle.
          this.lastQualifying = t;
          if (Math.abs(this.turn) >= 2 * Math.PI) {
            e.stirs = t - this.lastCycle <= period || e.stirs === 0 ? e.stirs + 1 : 1;
            this.lastCycle = t; this.turn -= Math.sign(this.turn) * 2 * Math.PI; this.cycleStart = t;
          }
        }
      }
    }
    if (t - this.cycleStart > period) { this.turn = 0; this.back = 0; this.cycleStart = t; }
    if (t - this.lastCycle > period && !e.active) e.stirs = 0;
    // DOUBLETS: single-axis excursions beyond +/- doubletRadius alternating within half a period, the other axis quiet.
    const devs = [dLat, dLon];
    for (let i = 0; i < 2; i++) {
      const a = this.axes[i], dev = devs[i], other = Math.abs(devs[1 - i]);
      if (Math.abs(dev) >= tr.doubletRadius && other < tr.doubletRadius) {
        const sign = Math.sign(dev);
        if (sign !== a.sign) {
          if (a.sign !== 0 && t - a.last <= period / 2) { a.half++; this.lastQualifying = t; } else a.half = 0;
          a.sign = sign; a.last = t;
        }
      }
      if (t - a.last > period / 2) a.half = 0;
    }
    this.doublets = Math.floor(Math.max(this.axes[0].half, this.axes[1].half) / 2);
    // Conditions: airspeed (KCAS from the hub's air) and collective.
    const m = this.def.main;
    const kcas = Math.hypot(hubAir.x, hubAir.y, hubAir.z) * Math.sqrt(Math.max(density, 0) / SEA_LEVEL_DENSITY) / KT;
    const collective = m.minPitch + Math.min(1, Math.max(0, c.collective ?? 0)) * (m.maxPitch - m.minPitch);
    const condition = kcas >= tr.minKcas && collective <= tr.maxCollective;
    // Trigger.
    if (!e.active && !e.strike && (this.forced || (condition && (e.stirs >= tr.cycles || this.doublets >= tr.doubletCycles)))) {
      e.active = true; e.amplitude = 1; this.onset = t; this.forced = false;
    }
    if (!e.active) return;
    if (this.onset < 0) this.onset = t;
    // Growth and decay per forcing cycle.
    const cycles = d.perRev * Math.max(0, this.state.omega) * dt / (2 * Math.PI);
    const stirring = condition && t - this.lastQualifying <= period;
    if (this.activity < d.stillRate) e.amplitude *= d.decayPerCycle ** cycles;
    else if (stirring && t - this.onset >= d.cueSeconds) e.amplitude *= d.growthPerCycle ** cycles;
    if (e.amplitude >= d.strikeAmplitude) e.strike = true;
    if (e.amplitude < d.endAmplitude) { e.active = false; e.amplitude = 0; e.stirs = 0; this.onset = -1; }
  }
}
