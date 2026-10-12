// Cessna 208 Caravan 675 (PT6A-114A, 8000 lb): the pilot's reference speeds, KIAS. Plain data. From the 208 POH
// (sections 2, 4 and 5, at 8000 lb); SCHOOL marks common operating practice that is not in the POH.

import type { ReferenceSpeeds } from '../types';

export const C208_REFERENCE: ReferenceSpeeds = {
  // POH sect. 5: flaps FULL, power idle, forward CG, 8000 lb; the bottom of the white arc.
  vs0: 60,
  // POH sect. 5: flaps UP; the bottom of the green arc.
  vs1: 70,
  // POH sect. 4: normal take-off with flaps 20, rotate at 70.
  vr: 70,
  // POH sect. 4: flaps 20, 72 KIAS.
  vx: 72,
  // POH sect. 4: flaps UP, 104 KIAS at sea level (falling to about 95 at 20 000 ft).
  vy: 104,
  // POH sect. 3: flaps UP, propeller feathered, 95 KIAS at 8000 lb.
  vglide: 95,
  // POH sect. 2: 148 KIAS at 8000 lb.
  va: 148,
  // POH sect. 2: 175 to 10 degrees, 150 to 20 degrees, 125 to FULL.
  vfe: [175, 150, 125],
  // POH sect. 2: Vmo 175 KIAS, the red line. A turboprop has no yellow arc: Vno is taken as Vmo.
  vno: 175,
  vne: 175,
  // POH sect. 4: approach flaps 20, 85-95 (SCHOOL: 95 on base, flaps 20).
  vapp: 95,
  // POH sect. 4: normal landing flaps FULL, 75-85; 78 over the fence (SCHOOL).
  vref: 78,
  // POH sect. 5: about 155 KIAS at maximum cruise torque at 10 000 ft (175-180 KTAS).
  vcruise: 155,
  // SCHOOL: downwind at about 110-120 KIAS, flaps UP or 10.
  vdownwind: 115,
  // POH sect. 3: about 9.5 : 1 at 95 KIAS with the propeller feathered (weak datum).
  glideRatio: 9.5,
};
