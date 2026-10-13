// How the animals react to the aircraft (Deep Time). Pure functions, three-free; the herd and flyer brains call
// them at 10 Hz with the aircraft's position and velocity (ctx.state).
//
// Edmontosaurus:
//   - ALERT (heads up, freeze) when the aircraft is within 600 m slant and below 300 m above the herd's ground;
//   - FLEE when within 350 m and below 150 m and closing. The alarm spreads through the herd as a wave at 15 m/s;
//     a fleeing animal breaks into the bipedal run (2 -> 7 m/s) away from the aircraft's projected ground track,
//     and calms down 20-40 s after the last threat.
//   - Airspeed is the noise proxy: a slow, quiet aircraft (taxiing, a glider-slow pass) is noticed closer in;
//     from NOISE_FULL_TAS up the ranges are the full ones above.
// Azhdarchids in flight: a wing-over and a burst of flaps away from the aircraft inside 120 m; they never come
// within 60 m (the flyer integrator enforces it).
//
// No collision in v1: creatures are visual only.

export const HADROSAUR_REACTION = Object.freeze({
  alertRange: 600,
  alertHeight: 300,
  fleeRange: 350,
  fleeHeight: 150,
  /** Speed of the alarm wave through the herd, m/s. */
  waveSpeed: 15,
  /** Run speed: starts at fleeSpeed0 and builds to fleeSpeed1 over fleeAccelS, m/s. */
  fleeSpeed0: 2,
  fleeSpeed1: 7,
  fleeAccelS: 3,
  calmMinS: 20,
  calmMaxS: 40,
});

export const FLYER_REACTION = Object.freeze({
  /** Inside this a flyer breaks away (wing-over and flap burst), m. */
  evadeRange: 120,
  /** Hard minimum separation from the aircraft, m. */
  minSeparation: 60,
  /** How long a break-away lasts, s. */
  evadeS: 4,
});

/** Airspeed from which the reaction ranges are full, m/s. */
export const NOISE_FULL_TAS = 40;

export const THREAT = { none: 0, alert: 1, flee: 2 } as const;
export type Threat = (typeof THREAT)[keyof typeof THREAT];

/** Range factor 0.6..1 from the true airspeed (the noise proxy). */
export function noiseFactor(tas: number): number {
  const f = 0.6 + (0.4 * Math.max(0, tas)) / NOISE_FULL_TAS;
  return f > 1 ? 1 : f;
}

/**
 * Closing speed of the aircraft toward a point, m/s (> 0 closing). rel = aircraft - point (NED), v = aircraft
 * velocity (NED).
 */
export function closingSpeed(relN: number, relE: number, relD: number, vN: number, vE: number, vD: number): number {
  const d = Math.sqrt(relN * relN + relE * relE + relD * relD);
  if (d < 1e-6) return 0;
  return -(relN * vN + relE * vE + relD * vD) / d;
}

/**
 * The herd's threat level from an aircraft at slant distance `slant` (m) and `height` (m) above the herd's
 * ground, closing at `closing` m/s, flying at `tas`.
 */
export function hadrosaurThreat(slant: number, height: number, closing: number, tas: number): Threat {
  if (!(slant >= 0) || !(height === height)) return THREAT.none;
  const k = noiseFactor(tas);
  const R = HADROSAUR_REACTION;
  if (slant < R.fleeRange * k && height < R.fleeHeight && closing > 0) return THREAT.flee;
  if (slant < R.alertRange * k && height < R.alertHeight) return THREAT.alert;
  return THREAT.none;
}

/** When the alarm reaches an animal `dist` m from where it started, s after the start. */
export function alarmDelay(dist: number): number {
  return dist / HADROSAUR_REACTION.waveSpeed;
}

/** Run speed `t` s into a flight, m/s. */
export function fleeSpeed(t: number): number {
  const R = HADROSAUR_REACTION;
  const f = Math.min(1, Math.max(0, t / R.fleeAccelS));
  return R.fleeSpeed0 + (R.fleeSpeed1 - R.fleeSpeed0) * f * (2 - f);
}

/** Calm-down delay after the last threat for a herd hash u in [0, 1), s. */
export function calmDelay(u: number): number {
  const R = HADROSAUR_REACTION;
  return R.calmMinS + (R.calmMaxS - R.calmMinS) * u;
}

/**
 * Direction to flee: away from the aircraft's projected ground track (the line through the aircraft along its
 * horizontal velocity), mixed with a little "away from the aircraft". Writes a unit (north, east) vector to out.
 * acN/acE aircraft position, vN/vE its ground velocity, n/e the animal.
 */
export function fleeDirection(n: number, e: number, acN: number, acE: number, vN: number, vE: number, out: { n: number; e: number }): { n: number; e: number } {
  const dn = n - acN;
  const de = e - acE;
  const sp = Math.hypot(vN, vE);
  let fn: number;
  let fe: number;
  if (sp > 1) {
    const tn = vN / sp;
    const te = vE / sp;
    // Perpendicular from the track line to the animal.
    const along = dn * tn + de * te;
    let pn = dn - along * tn;
    let pe = de - along * te;
    let pl = Math.hypot(pn, pe);
    if (pl < 1) {
      // Right under the track: break to the right of it.
      pn = -te;
      pe = tn;
      pl = 1;
    }
    fn = pn / pl;
    fe = pe / pl;
    // A little away from the aircraft too (never toward it).
    const dl = Math.hypot(dn, de) || 1;
    fn += (0.3 * dn) / dl;
    fe += (0.3 * de) / dl;
  } else {
    fn = dn;
    fe = de;
  }
  const l = Math.hypot(fn, fe) || 1;
  out.n = fn / l;
  out.e = fe / l;
  return out;
}

/** Perpendicular distance from the aircraft's ground-track line (through acN/acE along vN/vE) to a point, m. */
export function trackDistance(n: number, e: number, acN: number, acE: number, vN: number, vE: number): number {
  const sp = Math.hypot(vN, vE);
  const dn = n - acN;
  const de = e - acE;
  if (sp < 1e-6) return Math.hypot(dn, de);
  return Math.abs(dn * vE - de * vN) / sp;
}
