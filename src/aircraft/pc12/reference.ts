// Pilatus PC-12/47 (PT6A-67B, 4740 kg): the pilot's reference speeds, KIAS (the /47 placards read KIAS; the TCDS
// gives KCAS 2-4 kt higher). Plain data, the type's data sheet for speeds. Owner after the scaffold: P1.
// Tags (docs/pc12-sources.md): TCDS = EASA A.089 sect. C; PHOTO = /47 panel placards (Commons); 47E-PROXY = PC-12/47E
// POH Report 02277 Rev 20 (same airframe, other engine); CHART-READ = read off a 47E-PROXY chart (tolerance given);
// DERIVED = arithmetic shown; SCHOOL = common practice, not in a handbook; ESTIMATE = no source.

import type { ReferenceSpeeds } from '../types';

export const PC12_REFERENCE: ReferenceSpeeds = {
  // CHART-READ +/-2 (47E-PROXY Fig 5-2-1 p. 345, idle, 10 450 lb): flaps 40 about 67 KIAS (65.4 at 9920 lb = 85 / 1.3,
  // DERIVED from the Vref schedule). The published stall speeds are STICK-PUSHER speeds ("stall is defined by pusher
  // activation").
  vs0: 67,
  // CHART-READ +/-2 (same chart): flaps 0 about 95 KIAS at 10 450 lb.
  vs1: 95,
  // 47E-PROXY 4.2 p. 286: flaps 15, 10 450 lb.
  vr: 82,
  // 47E-PROXY 4.2.
  vx: 120,
  // 47E-PROXY 4.2: flaps 0, sea level (125 from 5000 ft, 120 above 20 000 ft).
  vy: 130,
  // 47E-PROXY 3.2 p. 158: propeller feathered, 10 450 lb (116 at 9920, 93 at 6400).
  vglide: 119,
  // TCDS C.III.9: 170 KCAS; the /47 placard gives Vo 163 KIAS at 4740 kg (PHOTO). Vo is used.
  va: 163,
  // Placard (PHOTO): 163 KIAS to 15 deg, 130 beyond (TCDS 165 / 130 KCAS). Detents 15, 30, 40.
  vfe: [163, 130, 130],
  // TCDS / placard: Vmo 240 KCAS = 236 KIAS (PHOTO). A turboprop has no yellow arc: Vno is taken as Vmo.
  vno: 236,
  vne: 236,
  // 47E-PROXY 4.2 (9921 lb): approach flaps 15 at 99 KIAS (flaps 30: 89).
  vapp: 99,
  // 47E-PROXY 4.2, Fig 5-2-50 p. 413: flaps 40, 85 KIAS at 9920 lb.
  vref: 85,
  // 47E-PROXY Fig 5-2-31 sheet 3 (9000 lb, 36.9 psi): 222 KIAS at 8000 ft ISA, 216 at 12 000 ft. ESTIMATE for the /47.
  vcruise: 220,
  // SCHOOL / AGENT: downwind 150-170 KIAS clean, slowing to 130 with flaps 15 before base.
  vdownwind: 160,
  // Placard (PHOTO): Vlo 177 KIAS, Vle 236 KIAS (TCDS 180 / 240 KCAS). One Vlo for extension and retraction.
  vle: 236,
  vloExtend: 177,
  vloRetract: 177,
  // DERIVED from 47E-PROXY Fig 5-2-46 p. 409: 65 NM from 25 000 ft feathered, 65 x 6076 / 25 000 = 15.8.
  glideRatio: 15.8,
};

/** Approach speeds by flap, KIAS, 9921 lb (47E-PROXY 4.2): flaps 0 120, 15 99, 30 89, 40 85. */
export const PC12_APPROACH_KIAS = { 0: 120, 15: 99, 30: 89, 40: 85 } as const;
/** Pusher (stall) speeds at 10 450 lb, idle, KIAS: CHART-READ +/-2 (Fig 5-2-1) and DERIVED (Vr/1.1, V50/1.3, Vref/1.3). */
export const PC12_PUSHER_KIAS = { 0: 95, 15: 78, 30: 70, 40: 67 } as const;
/** Flaps up after take-off above 100 KIAS (47E-PROXY 4.9); emergency gear extension below 110 KIAS (7-4). */
export const PC12_FLAPS_UP_ABOVE_KIAS = 100;
export const PC12_EMERGENCY_GEAR_KIAS = 110;
/** Demonstrated crosswind, kt, by flap (47E-PROXY 4.2): 0 30, 15 25, 30 20, 40 15. */
export const PC12_DEMO_CROSSWIND_KT = { 0: 30, 15: 25, 30: 20, 40: 15 } as const;
