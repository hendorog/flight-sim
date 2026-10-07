// Diamond DA20-C1: the pilot's reference speeds, KIAS, at 800 kg. Plain data. Transcribed from the DA20-C1
// engineering data sheet (work/aircraft-data/da20.md, kept outside the tree): "s.8" below is its section 8;
// [AFM] is the flight manual DA202-C1 Rev 29, [TRG] the Midwest Air school procedures guide the sheet quotes.
// Its verification notes confirm every V-speed, the stall table and the airspeed calibration against the AFM
// without change.
//
// The airspeed indicator of this type under-reads by 8 to 10 kt near the stall (44 KIAS is 54 KCAS, 36 KIAS is
// 45 KCAS [AFM 5.3.1, 5.3.4; s.8]): the low indicated stall speeds are the handbook's own.

import type { ReferenceSpeeds } from '../types';

export const DA20_REFERENCE: ReferenceSpeeds = {
  /** Flaps LDG, idle, forward CG: 45 KCAS [AFM 5.3.4; s.8]. */
  vs0: 36,
  /** Flaps CRUISE: 54 KCAS [AFM 5.3.4; s.8]. With flaps T/O: 40 KIAS. */
  vs1: 44,
  /** Normal take-off, flaps T/O [AFM 4.4.7; s.8, s.10]. The charted (shortest) take-off lifts off at 52 KIAS. */
  vr: 44,
  /** Flaps CRUISE [AFM 4.2; s.8]. With flaps T/O: 57 KIAS. */
  vx: 60,
  /** Flaps CRUISE [AFM 4.2; s.8]. With flaps T/O: 68 KIAS. */
  vy: 75,
  /** Flaps CRUISE, propeller windmilling [AFM 3.2, 3.3.2; s.8]. */
  vglide: 73,
  /** At maximum weight [AFM 2.2; s.7]. */
  va: 106,
  /** Flaps T/O (15 degrees) and LDG (45 degrees) [AFM 2.2; s.7]. */
  vfe: [100, 78],
  /** [AFM 2.2; s.7] */
  vno: 118,
  /** 159 KCAS [AFM 2.2, 5.3.1; s.7]. */
  vne: 164,
  /**
   * With flaps T/O. ESTIMATE: the AFM gives no normal approach speed for that setting. 60 KIAS is its speed for
   * a forced landing with flaps T/O [AFM 3.2; s.10 emergency speeds], 1.3 x the 50 KCAS stall there.
   */
  vapp: 60,
  /**
   * Approach speed with flaps LDG, the speed of the landing distances [AFM 4.2, 4.4.11, 5.3.12; s.8, s.10].
   * Schools fly 65 on a normal final [TRG; s.11].
   */
  vref: 55,
  /**
   * Training cruise. ESTIMATE [CALC]: the 55 % setting of the cruise table, 2500 rpm at 4000 ft, 112 KTAS
   * [AFM table 3; s.8, s.11] = 105.5 KCAS = 105 KIAS by the calibration of AFM 5.3.1. Below Va, well inside the
   * green arc (Vno is only 118).
   */
  vcruise: 105,
  /** School circuit [TRG 5.3; s.11]. Not an AFM figure. */
  vdownwind: 90,
  /** 11 : 1 at best glide, 1.8 NM per 1000 ft [AFM 3.3.2; s.8]. */
  glideRatio: 11,
};
