// Cabin altitude and differential pressure as a DISPLAY function of pressure altitude (no pressurisation systems model:
// no bleed air, outflow valve or failures). The cabin altitude follows a controller schedule against aircraft altitude
// and moves at no more than a set rate; the differential is the pressure the standard atmosphere gives at the cabin
// altitude less the ambient pressure. Pure: no DOM, no three.js.

export interface CabinSchedule {
  /** Aircraft pressure altitudes of the schedule, ft, ascending, and the cabin altitude the controller holds at each. */
  altFt: readonly number[];
  cabinFt: readonly number[];
  /** Maximum cabin climb / descent rate, ft/min. */
  rateFpm: number;
}

/** Standard-atmosphere static pressure, psi, at pressure altitude h (ft), troposphere formula (valid to 36 000 ft). */
export function standardPressurePsi(h: number): number {
  return 14.6959 * Math.pow(Math.max(0, 1 - 6.8756e-6 * h), 5.2559);
}

export class CabinDisplay {
  cabinAltFt = 0;
  private started = false;

  constructor(readonly schedule: CabinSchedule) {}

  /** The cabin altitude the controller commands at aircraft altitude `altFt`, ft: ambient below the first cabin value, isobaric up to the first schedule point, then the schedule, held above its last point. */
  target(altFt: number): number {
    const { altFt: a, cabinFt: c } = this.schedule;
    if (altFt <= c[0]) return Math.max(altFt, 0);
    if (altFt <= a[0]) return c[0];
    const n = a.length;
    if (altFt >= a[n - 1]) return c[n - 1];
    let i = 1;
    while (a[i] < altFt) i++;
    const t = (altFt - a[i - 1]) / (a[i] - a[i - 1]);
    return c[i - 1] + t * (c[i] - c[i - 1]);
  }

  /** Differential pressure at aircraft altitude `altFt` with the cabin where it is now, psi (never negative). */
  diffPsi(altFt: number): number {
    return Math.max(0, standardPressurePsi(this.cabinAltFt) - standardPressurePsi(altFt));
  }

  /** Jump to the commanded value (first sample, a teleport). */
  reset(altFt: number): void {
    this.cabinAltFt = this.target(altFt);
    this.started = true;
  }

  /** Advance dt seconds at aircraft altitude `altFt`. The first call (or a call after a long gap) resets. */
  step(dt: number, altFt: number): void {
    if (!this.started || dt < 0 || dt > 30) {
      this.reset(altFt);
      return;
    }
    const goal = this.target(altFt);
    const maxMove = (this.schedule.rateFpm / 60) * dt;
    this.cabinAltFt += Math.max(-maxMove, Math.min(maxMove, goal - this.cabinAltFt));
  }
}
