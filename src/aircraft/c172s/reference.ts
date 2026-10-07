// Cessna 172S: the pilot's reference speeds, KIAS (POH, 2004 revision). Plain data. The values the flight model
// also uses come from core/c172.ts; the rest are the same numbers as the training profile's V-speeds
// (training/aircraft/c172s.ts), which tests/aircraft/contract.test.ts asserts.

import { C172 } from '../../core/c172';
import type { ReferenceSpeeds } from '../types';

export const C172S_REFERENCE: ReferenceSpeeds = {
  vs0: 40,
  vs1: 48,
  vr: 55,
  vx: C172.poh.vxKias,
  vy: C172.poh.vyKias,
  vglide: C172.poh.bestGlideKias,
  va: 105,
  // Flaps 10, 20 and 30 degrees.
  vfe: [110, C172.poh.vfeKias, C172.poh.vfeKias],
  vno: C172.poh.vnoKias,
  vne: C172.poh.vneKias,
  vapp: 70,
  vref: 65,
  vcruise: 105,
  vdownwind: 90,
  glideRatio: C172.poh.glideRatio,
};
