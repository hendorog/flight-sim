// Diamond DA 42 NG: the pilot's reference speeds, KIAS, at 1900 kg. Plain data, transcribed from the
// engineering data sheet of the type (da42.md; "s.N" below is its section N). AFM = Airplane Flight Manual
// Doc. 7.01.15-E Rev. 7; EST = an estimate, because Diamond publishes no value.

import type { ReferenceSpeeds } from '../types';

export const DA42_REFERENCE: ReferenceSpeeds = {
  vs0: 62, // s.8 (AFM 5.3.4): gear down, flaps LDG, 1900 kg (61 KCAS)
  vs1: 69, // s.8 (AFM 5.3.4): gear up, flaps UP, 1900 kg (68 KCAS)
  vr: 80, // s.8 (AFM 4A.2): flaps UP (76 with flaps APP)
  vx: 82, // s.8 (AFM 4A.2): with flaps APP; not published for flaps UP
  vy: 90, // s.8 (AFM 4A.2): flaps UP, up to 1900 kg
  // s.8 "Glide", EST of low confidence: no best-glide speed is published. Both propellers feathered, gear and
  // flaps up: best lift / drag at about 95-105 KIAS.
  vglide: 100,
  va: 122, // s.7 (AFM 2.2): Vo above 1800 kg (119 from 1700 kg, 112 below); the AFM uses Vo, not Va
  // APP (20 degrees) and LDG (42 degrees): s.7 (AFM 2.2).
  vfe: [133, 113],
  vno: 151, // s.7 (AFM 2.2)
  vne: 188, // s.7 (AFM 2.2)
  // EST from s.10 (AFM 4A.6.11, 4A.6.12): the minimum with flaps APP is 84 and the go-around minimum 90;
  // schools fly the base leg at 95 and cross the fence at 85.
  vapp: 90,
  vref: 84, // s.8 (AFM 4A.2, 5.3.11): flaps LDG, up to 1900 kg
  // EST from s.8 (AFM 5.3.10): the recommended 75 % gives 149-153 KTAS at 2000-6000 ft, which is 141-137 KIAS
  // (s.7 calibration: the indicator reads 3 to 4 kt low there).
  vcruise: 140,
  vdownwind: 100, // s.10, s.11: flaps APP abeam the threshold, about 50 % LOAD (school practice, not AFM)
  vmca: 76, // s.7 (AFM 2.2): flaps UP, the red radial (73 with flaps APP)
  vyse: 85, // s.7 (AFM 2.3, 3.1.2): the blue line
  vsse: 85, // s.7, EST: the AFM defines Vsse but gives no value; taken as Vyse
  vle: 188, // s.7 (AFM 2.2)
  vloExtend: 188, // s.7 (AFM 2.2)
  vloRetract: 152, // s.7 (AFM 2.2); also the limit for the emergency extension
  // s.8 "Glide", EST of low confidence (11.5-13): both feathered, clean, 1900 kg. With the levers at idle the
  // propellers sit on the fine stop and the glide is much steeper.
  glideRatio: 12,
};
