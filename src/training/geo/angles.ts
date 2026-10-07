// Angle helpers in degrees, shared by the telemetry providers, the predicate compiler and the detectors.

/** Wrap to (-180, 180]. */
export function wrap180(deg: number): number {
  let a = (deg + 180) % 360;
  if (a <= 0) a += 360;
  return a - 180;
}

/** Wrap to [0, 360). */
export function wrap360(deg: number): number {
  const a = deg % 360;
  return a < 0 ? a + 360 : a + 0; // + 0 turns -0 into 0
}

/** Absolute angular difference, degrees [0, 180]. */
export function angleDiff(a: number, b: number): number {
  return Math.abs(wrap180(a - b));
}
