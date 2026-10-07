// Cessna 152 (1978 model): the pilot's reference speeds, KIAS. Plain data. Transcribed from the type's engineering
// data sheet (aircraft-data/c152.md in the design work folder; "s.N" is its section N), which takes them from the
// 1978 Pilot's Operating Handbook at 1670 lb; SCHOOL marks common flying-school practice that is not in the POH.

import type { ReferenceSpeeds } from '../types';

export const C152_REFERENCE: ReferenceSpeeds = {
  // s.8 (POH Fig 5-3): flaps 30, power off, forward CG (43 KCAS); the bottom of the white arc (s.7).
  vs0: 35,
  // s.8 (POH Fig 5-3): flaps up, forward CG (48 KCAS); the bottom of the green arc (s.7).
  vs1: 40,
  // s.8 (POH sect. 4): lift the nose wheel at 50.
  vr: 50,
  // s.8 (POH sect. 4): sea level to 10 000 ft.
  vx: 55,
  // s.8 (POH Fig 5-5): at sea level (64 at 5000 ft, 61 at 10 000 ft).
  vy: 67,
  // s.8 (POH Fig 3-1): flaps up, propeller windmilling.
  vglide: 60,
  // s.7 (POH Fig 2-1): at 1670 lb (98 at 1500 lb, 93 at 1350 lb).
  va: 104,
  // s.7 (POH Fig 2-1): 85 at any flap setting; the detents are 10, 20 and 30 degrees (s.2.1).
  vfe: [85, 85, 85],
  // s.7 (POH Fig 2-1): the top of the green arc.
  vno: 111,
  // s.7 (POH Fig 2-1): the red line.
  vne: 149,
  // s.10 (SCHOOL): base leg with flap 20, "trim for 70 then 65"; the middle of the POH's 60-70 flaps-up approach.
  vapp: 65,
  // s.10: final with flap 30, 60-65 (SCHOOL); the middle of the POH's 55-65 flaps-down approach.
  vref: 60,
  // s.11 (SCHOOL): cruise at 2300-2400 rpm gives 90-100; the middle of that range (a pick, not a POH figure).
  vcruise: 95,
  // s.10, s.11 (SCHOOL): downwind at 2100-2200 rpm gives 80-90; the middle of that range (a pick; it equals Vfe).
  vdownwind: 85,
  // s.8 (POH Fig 3-1): the sheet's pick between the chart reading 9.7 and the usually quoted 9.1. Weak datum.
  glideRatio: 9.5,
};
