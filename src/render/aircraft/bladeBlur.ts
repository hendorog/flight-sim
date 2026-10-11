/** A perceptual LOD, not a camera shutter or an assertion of a universal RPM limit.
 *
 * At a reference apparent radius of 8 degrees, retinal tip speed is omega * 8 deg/s.
 * Preserve the real blade through 90 deg/s; smoothly lose pursuit by 180 deg/s
 * (107.4–214.9 RPM). Human pursuit can approach 90–100 deg/s for a predictable target:
 * Meyer et al. (1985), https://pubmed.ncbi.nlm.nih.gov/4060608/ . Actual tracking varies
 * with observer, viewing distance and acceleration. A fixed reference size avoids camera/zoom pumping.
 *
 * Use 1/30 s of effective motion integration after pursuit fails. Visual persistence is
 * stimulus dependent, and pursuit suppresses smear; it is not a literal fixed exposure:
 * https://pmc.ncbi.nlm.nih.gov/articles/PMC2729068/ . The 33 ms value is a rendering choice.
 * Fade to the existing averaged disc at 6–12 blade passages/s (180–360 RPM for two
 * blades, 120–240 for three): intervals of 167–83 ms, bracketing the roughly 100–150 ms
 * pursuit response time (https://pmc.ncbi.nlm.nih.gov/articles/PMC3797972/).
 * This deliberately broad, tuned transition represents loss of individual blade identity, NOT
 * flicker fusion: a helicopter disc can still flicker well below flicker-fusion frequency.
 *
 * Local trail length is r * sweep, so the tip travels farther than the root. Rotor
 * angular speed is the SAME at both; linear and apparent retinal speeds are not.
 * Visible blend boundaries are C1 smooth; no history, frame time, or start/stop hysteresis.
 */
export const BLADE_BLUR = {
  apparentRadiusDeg: 8,
  pursuitStartDegPerSec: 90,
  pursuitEndDegPerSec: 180,
  persistenceSeconds: 1 / 30,
  discStartPassagesPerSec: 6,
  discEndPassagesPerSec: 12,
} as const;

export interface BladeBlurState {
  solid: number;
  trail: number;
  disc: number;
  /** Angular extent in radians; multiply by local radius to get metres of travel. */
  sweep: number;
}

const smooth = (x: number, a: number, b: number): number => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Call with actual shaft RPM (including the tail-rotor ratio) and actual blade count. */
export function bladeBlur(rpm: number, blades: number): BladeBlurState {
  const omega = Math.abs(rpm) * Math.PI / 30;
  const loss = smooth(omega * BLADE_BLUR.apparentRadiusDeg,
    BLADE_BLUR.pursuitStartDegPerSec, BLADE_BLUR.pursuitEndDegPerSec);
  const disc = loss * smooth(Math.abs(rpm) * blades / 60,
    BLADE_BLUR.discStartPassagesPerSec, BLADE_BLUR.discEndPassagesPerSec);
  return {
    solid: (1 - loss) * (1 - disc),
    trail: loss * (1 - disc),
    disc,
    sweep: Math.min(2 * Math.PI / blades * 0.8, omega * BLADE_BLUR.persistenceSeconds * loss),
  };
}
