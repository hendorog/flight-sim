// Piper PA-34-200 Seneca I (4200 lb airframes): the pilot's reference speeds, knots. Plain data, transcribed
// from the type's data sheet (pa34.md); "s.N" below is its section N.
//
// The Seneca I manuals give every speed in statute mph CALIBRATED, and the airspeed indicator is marked at
// those numbers. They are entered here as the handbook's numbers in knots (the data sheet's own conversions).
// Flaps up the indicator reads about 2 mph low below 140 mph and with flaps 40 it reads true at the stall
// (s.7), so as INDICATED speeds they are right within 2 kt; the one speed the data sheet gives in both forms
// and that differs by more than a knot, the clean stall, is entered indicated.

import type { ReferenceSpeeds } from '../types';

export const PA34_REFERENCE: ReferenceSpeeds = {
  // s.8: gear and flaps down, power off, 4200 lb: 69 mph calibrated and indicated.
  vs0: 60,
  // s.8: gear down, flaps up: 76 mph (66 kt) calibrated, about 74 mph indicated.
  vs1: 64,
  // s.8: rotate at 80-85 mph (70-74 kt) flaps up; the middle.
  vr: 72,
  // s.8: 90 mph.
  vx: 78,
  // s.8: 105 mph.
  vy: 91,
  // s.8: 105 mph, from a school checklist (the Piper handbook gives no glide speed).
  vglide: 91,
  // s.7: 146 mph at 4200 lb (133 mph, 115 kt, at 2743 lb).
  va: 127,
  // s.7: flaps 10, 25 and 40 degrees: 160 / 140 / 125 mph. Only the last is a limitation (type certificate and
  // flight manual); the first two are the handbook's operating speeds.
  vfe: [139, 122, 109],
  // s.7: 190 mph.
  vno: 165,
  // s.7: 217 mph.
  vne: 188,
  // s.10, s.11: base leg with flaps 25 at 105 mph; final with flaps 40 at 95 mph.
  vapp: 91,
  vref: 83,
  // s.11: normal cruise at 65-75 % shows 140-150 kt low down (75 % at sea level: 149 kt, s.8); the middle. EST.
  vcruise: 145,
  // s.10: downwind at 115 mph.
  vdownwind: 100,
  // s.7: Vmc 80 mph, the red radial.
  vmca: 69,
  // s.7: 105 mph, the blue radial.
  vyse: 91,
  // s.7: not published; the handbook's floor for all one-engine training, 90 mph indicated.
  vsse: 78,
  // s.7: gear extended and extension 150 mph; retraction 125 mph.
  vle: 130,
  vloExtend: 130,
  vloRetract: 109,
  // s.8: not published. EST with both propellers feathered (range 8.5-11); 7 to 7.5 with both windmilling.
  glideRatio: 10,
};
