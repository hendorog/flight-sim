// Piper PA-38-112 Tomahawk II: the pilot's reference speeds, KIAS. Plain data. Transcribed from the PA-38
// engineering data sheet (work/aircraft-data/pa38.md, kept outside the tree; "s.8" below is its section 8, with
// the corrections of its "Verification notes" applied). The handbook is Piper report VB-2126 [POH]. The speeds
// are those of the Tomahawk II standard, both pairs of flow strips fitted (the aircraft with the outboard pair
// only stall 2-4 kt slower and approach at 62), at 1670 lb.

import type { ReferenceSpeeds } from '../types';

export const PA38_REFERENCE: ReferenceSpeeds = {
  /** Flaps 34 deg, power off: the bottom of the white arc [POH 2.5, 4.35; s.7, s.8]. */
  vs0: 49,
  /** Flaps up, power off: the bottom of the green arc [POH 2.5, 4.35; s.7, s.8]. */
  vs1: 52,
  /** Rotate / lift-off [POH 4.5; s.8]. */
  vr: 53,
  /** Flaps up [POH 4.3; s.8]. */
  vx: 61,
  vy: 70,
  /** Flaps up, propeller windmilling [POH 3.3; s.8]. */
  vglide: 70,
  /** At 1670 lb (90 at 1277 lb) [POH 2.3; s.7]. */
  va: 103,
  // Flaps 21 and 34 degrees: one limit for any flap setting [POH 2.3; s.2.2, s.7].
  vfe: [89, 89],
  /** [POH 2.3; s.7]. */
  vno: 110,
  vne: 138,
  /** Flaps 21 deg: the handbook trims to 70 before landing; the sheet's approach is 70, then 67 [POH 4.5; s.10, s.11]. */
  vapp: 70,
  /** Final approach with full flap [POH 4.3; s.8, s.10]. */
  vref: 67,
  /**
   * ESTIMATE [CALC from s.8]: 75 % best power gives 99 KTAS at sea level and 108 KTAS at 7100 ft on the charts,
   * 2-3 kt less on the Tomahawk II's 6.00-6 wheels; that is 95-96 KCAS, 97-98 KIAS with the position error of
   * s.7 (indicated about 2 kt above calibrated at these speeds). 95 is a normal cruise just under it.
   */
  vcruise: 95,
  /**
   * ESTIMATE: typical instruction, 80-85 KIAS, not a handbook figure [K, medium confidence; s.10, s.11]. The
   * lower end keeps 9 kt under Vfe.
   */
  vdownwind: 80,
  /**
   * ESTIMATE: 7.6-7.9 from the slope of POH fig 5-33 (6.6 from the chart's own example); the sheet picks 7.8
   * [s.8, Verification notes].
   */
  glideRatio: 7.8,
};
