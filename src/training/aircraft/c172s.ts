// Compatibility path and shared training helpers; the C172S profile lives with its aircraft data.
import type { AircraftTypeDef } from '../types';
export { C172S } from '../../aircraft/c172s/training';

/** The fictitious registration shown in the logbook for an authority (section 2.1). */
export function registrationFor(authority: 'easa' | 'faa'): string {
  return authority === 'easa' ? 'G-FSCK' : 'N172FS';
}

/**
 * Flap lever (ControlInputs.flaps) for a flap angle in degrees: exact at the detents, linear between them
 * (a lever moved part-way). Used by the copilot and starts for `flapsDeg` values.
 */
export function flapLeverFor(type: AircraftTypeDef, deg: number): number {
  const d = type.flapDetentsDeg;
  if (deg <= d[0]) return type.flapLeverForDeg[d[0]];
  for (let i = 1; i < d.length; i++) {
    if (deg <= d[i]) {
      const a = type.flapLeverForDeg[d[i - 1]];
      const b = type.flapLeverForDeg[d[i]];
      return a + ((b - a) * (deg - d[i - 1])) / (d[i] - d[i - 1]);
    }
  }
  return type.flapLeverForDeg[d[d.length - 1]];
}

/** Inverse of flapLeverFor: the flap angle (degrees) a lever position selects. */
export function flapDegForLever(type: AircraftTypeDef, lever: number): number {
  const d = type.flapDetentsDeg;
  const lv = (deg: number) => type.flapLeverForDeg[deg];
  if (lever <= lv(d[0])) return d[0];
  for (let i = 1; i < d.length; i++) {
    if (lever <= lv(d[i])) return d[i - 1] + ((d[i] - d[i - 1]) * (lever - lv(d[i - 1]))) / (lv(d[i]) - lv(d[i - 1]));
  }
  return d[d.length - 1];
}
