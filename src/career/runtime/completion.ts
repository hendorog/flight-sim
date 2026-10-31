// Job completion (docs/career.md "Finishing", "Stops", COMPLETION_RULES): when a landed aircraft has finished the
// job, stopped at another field, or come down away from every field.
//
// Nothing is decided until the job has been airborne and the monitor's phase is 'landed' (a magneto drop at the
// run-up, a shutdown at the origin before take-off, does nothing). Then, on the ground, slower than 0.5 m/s and
// with every engine stopped:
//   aeroplanes   the parking brake set for 3 s, or no brake for 12 s ("chocks in"; after 5 s the strip says "Set
//                the parking brake (or wait) to finish");
//   helicopters  3 s, no brake (skids);
// and then, where it stands: inside the destination (|along| <= length/2 + 200 m and |across| <= 250 m in its
// frame, or on its apron: src/career/geo.ts fieldArea) completes the job; inside another field stops it there (a
// precautionary stop, held until Continue or Give up); at no field for 10 s (engines off, stopped) is an
// outlanding. A helicopter flying to a site (wave 4) completes that leg on the ground within 60 m of the spot for
// 30 s, engine running or not (load or unload, idle allowed).
//
// Durations are sums of frame times compared with an allowance (as the school's detectors), so a 0.25 s frame and
// twenty 0.0125 s frames reach the same decision at the same time. Pure state (exportState / restoreState).

import { fieldArea, fieldAt, fieldByCode, type FieldArea } from '../geo';
import type { Airfield } from '../../world/airfields';
import { COMPLETION_RULES, type JobPhase, type JobPlace } from '../types';

/** What completion needs of one frame. */
export interface CompletionInput {
  phase: JobPhase;
  everAirborne: boolean;
  onGround: boolean;
  /** Ground speed, m/s. */
  gsMs: number;
  /** Every engine stopped (AircraftState.engines). */
  enginesStopped: boolean;
  parkingBrake: boolean;
  helicopter: boolean;
  /** Position, NED m. */
  north: number;
  east: number;
}

/** A decision: the job is done here, held at another field, or outlanded. `area`: where in the field it stands. */
export type CompletionDecision =
  | { kind: 'completed'; field: string | null; area: Exclude<FieldArea, null> | 'site' }
  | { kind: 'stopped'; field: string; area: Exclude<FieldArea, null> }
  | { kind: 'outlanded' };

/** The tracker's plain state (exportState). */
export interface CompletionState {
  /** Stopped with the engines off, s. */
  stillS: number;
  /** ...and the parking brake set, s. */
  brakeS: number;
  /** ...and at no field, s. */
  outS: number;
  /** On the ground at the site, s. */
  siteS: number;
}

/** Duration test with an allowance for summed frame times (as src/training/engine/events.ts). */
const reached = (t: number, s: number): boolean => t >= s - 1e-9;

/** Stopped, engines off (the condition every shutdown decision needs). */
export function shutDown(x: Pick<CompletionInput, 'onGround' | 'gsMs' | 'enginesStopped'>): boolean {
  return x.onGround && x.gsMs < COMPLETION_RULES.stoppedMs && x.enginesStopped;
}

/** Tracks one job's arrival (COMPLETION_RULES). */
export class CompletionTracker {
  private s: CompletionState = { stillS: 0, brakeS: 0, outS: 0, siteS: 0 };

  constructor(private readonly destination: JobPlace, private readonly fields: readonly Airfield[]) {}

  /** One frame of `dt` sim seconds; a decision on the frame it is reached, else null. */
  update(x: CompletionInput, dt: number): CompletionDecision | null {
    const R = COMPLETION_RULES;
    const s = this.s;
    if (!x.everAirborne || x.phase !== 'landed') {
      this.reset();
      return null;
    }
    if (!(dt > 0)) return null;
    const dest = this.destination;
    if (dest.kind === 'site') {
      if (x.onGround && Math.hypot(x.north - dest.north, x.east - dest.east) <= R.siteRadiusM) {
        s.siteS += dt;
        if (reached(s.siteS, R.siteHoldS)) return { kind: 'completed', field: null, area: 'site' };
      } else s.siteS = 0;
    }
    if (!shutDown(x)) {
      s.stillS = s.brakeS = s.outS = 0;
      return null;
    }
    s.stillS += dt;
    s.brakeS = x.parkingBrake ? s.brakeS + dt : 0;
    const destField = dest.kind === 'field' ? fieldByCode(dest.code, this.fields) : undefined;
    const destArea = destField ? fieldArea(destField, x.north, x.east) : null;
    const at = destField && destArea ? { field: destField, area: destArea } : fieldAt(x.north, x.east, this.fields);
    if (!at) {
      s.outS += dt;
      return reached(s.outS, R.outlandS) ? { kind: 'outlanded' } : null;
    }
    s.outS = 0;
    const ready = x.helicopter
      ? reached(s.stillS, R.stoppedS)
      : (x.parkingBrake && reached(s.brakeS, R.stoppedS)) || reached(s.stillS, R.chocksS);
    if (!ready) return null;
    if (destField && at.field === destField) return { kind: 'completed', field: destField.code, area: at.area };
    return { kind: 'stopped', field: at.field.code, area: at.area };
  }

  /** The strip should ask for the parking brake: an aeroplane shut down, no brake, for brakeHintS. */
  brakeHint(x: Pick<CompletionInput, 'helicopter' | 'parkingBrake'>): boolean {
    return !x.helicopter && !x.parkingBrake && reached(this.s.stillS, COMPLETION_RULES.brakeHintS);
  }

  /** Seconds stopped with the engines off (0 while not). */
  get stillS(): number {
    return this.s.stillS;
  }

  reset(): void {
    this.s = { stillS: 0, brakeS: 0, outS: 0, siteS: 0 };
  }

  exportState(): CompletionState {
    return { ...this.s };
  }

  /** Continue from exportState(); false (and nothing changed) when `v` is not one. */
  restoreState(v: unknown): boolean {
    if (typeof v !== 'object' || v === null) return false;
    const o = v as Record<string, unknown>;
    const ok = (k: string): boolean => typeof o[k] === 'number' && Number.isFinite(o[k] as number) && (o[k] as number) >= 0;
    if (!['stillS', 'brakeS', 'outS', 'siteS'].every(ok)) return false;
    this.s = { stillS: o.stillS as number, brakeS: o.brakeS as number, outS: o.outS as number, siteS: o.siteS as number };
    return true;
  }
}
