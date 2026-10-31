// Passenger comfort (docs/career.md "The job runtime", COMFORT_RULES): a running score out of 100 that the job
// strip shows on passenger jobs and the settlement turns into the comfort line. Deductions are points per second
// while the condition holds, kept per factor (ComfortFactor) so the debrief can name the worst:
//
//   vertical  |nz - 1| above 0.25 g 1.5/s, above 0.5 g 5/s, divided by (1 + 2 x weather.turbulence): a rough day
//             is not all the pilot's fault
//   lateral   |ny| above 0.12 g 1/s, above 0.25 g 3/s (skids and slips)
//   bank      above 30 deg 0.5/s, above 45 deg 3/s
//   pitch     above +15 deg or below -10 deg 1/s
//   descent   faster than 1,000 fpm held for 5 s, 0.3/s from then on (unpressurised types only: ears)
//   stall     the stall warning 3/s (helicopters: the low rotor RPM horn where the type has one, else nothing),
//             only above 50 ft AGL, which also keeps out the landing flare: a well-flared trainer sounds the horn
//             in the last few feet and that costs nothing
//   landing   (sink - 360 fpm) / 15 points at each landing, and 5 per bounce
//
// nz = -specificForce.z and ny = specificForce.y (body, g; level flight is nz 1, ny 0), each low-passed with a 1 s
// time constant so a single step's spike is not a bump. The per-second deductions count only airborne or above
// 30 kt on the ground: a taxi turn or the run-up is not the passengers' flight. The filter runs all the time (and
// starts from the first sample) so it is settled when counting begins. dt is sim time; 0 (paused) changes nothing.
//
// Pure state (exportState / restoreState plain JSON) so a resumed flight carries its comfort on.

import { FPM, FT, KT, RAD } from '../../core/math';
import type { AircraftState } from '../../core/types';
import { COMFORT_RULES, type ComfortFactor, type ComfortSummary } from '../types';

/** One sample of what the passengers feel, from the step-exact (or render) aircraft state. */
export interface ComfortSample {
  /** Body specific force, g (AircraftState.specificForce: level = (0, 0, -1)). */
  specificForce: { y: number; z: number };
  bankDeg: number;
  pitchDeg: number;
  /** Vertical speed, fpm (+ up). */
  vsFpm: number;
  aglFt: number;
  onGround: boolean;
  gsKt: number;
  /** The stall warning (an aeroplane's horn, a helicopter's low rotor RPM horn; false on a type without one). */
  warning: boolean;
  /** WeatherSettings.turbulence, 0..1. */
  turbulence: number;
}

/** A ComfortSample from an AircraftState and the weather (helicopters: the low rotor RPM horn; aeroplanes: the stall warning). */
export function comfortSample(s: Readonly<AircraftState>, turbulence: number, helicopter: boolean): ComfortSample {
  return {
    specificForce: s.specificForce,
    bankDeg: s.roll * RAD,
    pitchDeg: s.pitch * RAD,
    vsFpm: s.verticalSpeed / FPM,
    aglFt: s.altitudeAGL / FT,
    onGround: s.onGround,
    gsKt: s.groundSpeed / KT,
    warning: helicopter ? s.rotorcraft?.lowRpmHorn === true : s.stallWarning,
    turbulence,
  };
}

/** The meter's plain state (exportState). */
export interface ComfortState {
  nz: number;
  ny: number;
  /** The filters have been seeded. */
  seeded: boolean;
  /** Seconds the descent has been faster than descentFpm. */
  descentS: number;
  deductions: Record<ComfortFactor, number>;
}

const FACTORS: readonly ComfortFactor[] = ['vertical', 'lateral', 'bank', 'pitch', 'descent', 'stall', 'landing'];
const zero = (): Record<ComfortFactor, number> => ({ vertical: 0, lateral: 0, bank: 0, pitch: 0, descent: 0, stall: 0, landing: 0 });

/** Points per second of a banded rule ([[threshold, rate], ...] rising): the rate of the highest band exceeded. */
function bandRate(x: number, bands: readonly (readonly [number, number])[]): number {
  let r = 0;
  for (const [above, rate] of bands) if (x > above) r = rate;
  return r;
}

/** Passenger comfort over one job (COMFORT_RULES). */
export class ComfortMeter {
  private s: ComfortState = { nz: 1, ny: 0, seeded: false, descentS: 0, deductions: zero() };

  /** `pressurised`: no descent-rate deduction (CareerPerf.pressurised). */
  constructor(readonly pressurised = false) {}

  /** One frame of `dt` sim seconds. */
  update(x: ComfortSample, dt: number): void {
    const R = COMFORT_RULES;
    const s = this.s;
    const nz = -x.specificForce.z;
    const ny = x.specificForce.y;
    if (!s.seeded) {
      s.nz = nz;
      s.ny = ny;
      s.seeded = true;
    }
    if (!(dt > 0)) return;
    const k = 1 - Math.exp(-dt / R.filterS);
    s.nz += (nz - s.nz) * k;
    s.ny += (ny - s.ny) * k;

    const counting = !x.onGround || x.gsKt > R.minGroundKt;
    if (!counting) {
      s.descentS = 0;
      return;
    }
    const d = s.deductions;
    d.vertical += (bandRate(Math.abs(s.nz - 1), R.verticalG) / (1 + R.turbulenceRelief * Math.max(0, x.turbulence))) * dt;
    d.lateral += bandRate(Math.abs(s.ny), R.lateralG) * dt;
    d.bank += bandRate(Math.abs(x.bankDeg), R.bankDeg) * dt;
    if (x.pitchDeg > R.pitchUpDeg || x.pitchDeg < R.pitchDownDeg) d.pitch += R.pitchRate * dt;
    if (!this.pressurised && x.vsFpm < -R.descentFpm) {
      // Only the time past the hold counts (a frame that crosses it counts its part beyond).
      const before = Math.max(0, s.descentS - R.descentHoldS);
      s.descentS += dt;
      d.descent += R.descentRate * (Math.max(0, s.descentS - R.descentHoldS) - before);
    } else s.descentS = 0;
    if (x.warning && !x.onGround && x.aglFt > R.stallMinAglFt) d.stall += R.stallRate * dt;
  }

  /** A landing (any: full stop or touch and go): sink above landingSinkFpm and each bounce cost points. */
  landing(sinkFpm: number, bounces: number): void {
    const R = COMFORT_RULES;
    this.s.deductions.landing += Math.max(0, (sinkFpm - R.landingSinkFpm) / R.landingSinkPerPoint) + R.bouncePoints * Math.max(0, bounces);
  }

  /** 100 less every deduction, clamped 0..100. */
  get score(): number {
    let sum = 0;
    for (const f of FACTORS) sum += this.s.deductions[f];
    return Math.min(100, Math.max(0, 100 - sum));
  }

  summary(): ComfortSummary {
    return { score: this.score, deductions: { ...this.s.deductions } };
  }

  exportState(): ComfortState {
    return structuredClone(this.s);
  }

  /** Continue from exportState(); false (and nothing changed) when `v` is not one. */
  restoreState(v: unknown): boolean {
    if (typeof v !== 'object' || v === null) return false;
    const o = v as Record<string, unknown>;
    const fin = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
    if (!fin(o.nz) || !fin(o.ny) || typeof o.seeded !== 'boolean' || !fin(o.descentS)) return false;
    const d = o.deductions as Record<string, unknown> | null;
    if (typeof d !== 'object' || d === null || !FACTORS.every((f) => fin(d[f]) && (d[f] as number) >= 0)) return false;
    const deductions = zero();
    for (const f of FACTORS) deductions[f] = d[f] as number;
    this.s = { nz: o.nz, ny: o.ny, seeded: o.seeded, descentS: o.descentS, deductions };
    return true;
  }
}
